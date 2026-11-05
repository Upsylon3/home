const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { createPeerTransport, publicAddress } = require('../src/homecore/peerTransport');
const { credentials } = require('../test-support/peer-tls.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-peer-transport-'));
let tls, ca;
before(() => { tls = credentials(root); ca = fs.readFileSync(tls.cert); });
after(() => fs.rmSync(root, { recursive: true, force: true }));
async function server(handler, action) {
  const listener = https.createServer({ key: fs.readFileSync(tls.key), cert: ca }, handler);
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  try { await action(`https://peer.example.com:${listener.address().port}`); }
  finally { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); }
}
const local = options => createPeerTransport({ resolve: async () => ['127.0.0.1'], isPublic: () => true, ca, ...options });

test('public-address policy rejects private, mapped, reserved and transition ranges', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.1', '198.51.100.1',
    '203.0.113.1', '::1', '::', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:8.8.8.8', '2001:db8::1',
    '2002:0808:0808::1', '64:ff9b::808:808', 'invalid']) assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(publicAddress(address), true, address);
});

test('every DNS answer is checked; malformed origins, private/mixed answers and arbitrary operations never connect', async () => {
  let calls = 0;
  for (const answers of [['127.0.0.1'], ['8.8.8.8', '::1'], [], ['::ffff:8.8.8.8']]) {
    const send = createPeerTransport({ resolve: async () => answers, request: () => { calls++; throw new Error(); } });
    await assert.rejects(send('https://peer.example.com', 'status', { message: 'test' }));
  }
  const send = createPeerTransport({ resolve: async () => ['8.8.8.8'], request: () => { calls++; throw new Error(); } });
  for (const origin of ['http://peer.example.com', 'https://127.0.0.1', 'https://2130706433',
    'https://user:pass@peer.example.com', 'https://peer.example.com/path', 'https://peer.example.com?target=local']) {
    await assert.rejects(send(origin, 'status', {}));
  }
  await assert.rejects(send('https://peer.example.com', 'https://127.0.0.1', {}));
  assert.equal(calls, 0);
});

test('validated address is pinned without a second DNS lookup; unexpected connected address sends no body', async () => {
  let resolutions = 0, sent = 0;
  const send = createPeerTransport({ resolve: async () => { resolutions++; return ['8.8.8.8']; }, request: options => {
    options.lookup('peer.example.com', {}, (error, address, family) => {
      assert.equal(address, '8.8.8.8'); assert.equal(family, 4); assert.equal(error, null);
    });
    const request = new EventEmitter();
    request.end = () => { sent++; };
    request.destroy = error => queueMicrotask(() => request.emit('error', error));
    queueMicrotask(() => {
      const socket = Object.assign(new EventEmitter(), { authorized: true, remoteAddress: '127.0.0.1' });
      request.emit('socket', socket); socket.emit('secureConnect');
    });
    return request;
  } });
  await assert.rejects(send('https://peer.example.com', 'status', { secret: 'disposable-canary' }));
  assert.equal(resolutions, 1); assert.equal(sent, 0);
});

test('real TLS verifies hostname/certificate and delivers only to the fixed protocol route', async () => {
  let calls = 0;
  await server((req, res) => {
    calls++; assert.equal(req.url, '/federation/v1/status'); assert.equal(req.method, 'POST');
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks)), { message: 'fixture' });
      res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}');
    });
  }, async origin => {
    assert.deepEqual(await local()(origin, 'status', { message: 'fixture' }), { ok: true });
    await assert.rejects(local()(origin.replace('peer.example.com', 'wrong.example.com'), 'status', {}));
    await assert.rejects(local({ ca: undefined })(origin, 'status', {}));
    assert.equal(calls, 1);
  });
});

test('redirects, oversized/malformed/encoded responses and stalled bodies fail closed', async () => {
  for (const handler of [
    (req, res) => { res.writeHead(302, { Location: 'https://127.0.0.1' }); res.end(); },
    (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '40000' }); res.end('x'.repeat(40000)); },
    (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"a":1,"a":2}'); },
    (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }); res.end('bad'); },
    (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders(); res.write('{'); }
  ]) await server(handler, async origin => { await assert.rejects(local({ timeoutMs: 100 })(origin, 'status', {})); });
});

test('one deadline covers DNS/TLS/body and four in-flight requests exhaust peer capacity', async () => {
  let calls = 0;
  const send = createPeerTransport({ timeoutMs: 60, resolve: async () => { calls++; return new Promise(() => {}); } });
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => send('https://peer.example.com', 'status', {})));
  assert.equal(calls, 4);
  assert.equal(results.filter(value => value.status === 'rejected' && value.reason.status === 503).length, 1);
  assert.equal(results.filter(value => value.status === 'rejected' && value.reason.status === 504).length, 4);
});
