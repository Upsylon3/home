const https = require('node:https');
const dns = require('node:dns').promises;
const ipaddr = require('ipaddr.js');
const { LIMIT, strictJSON, fail } = require('./peerWire');
const { originValue } = require('./peerState');
const ROUTES = Object.freeze({ accept: '/federation/v1/accept', confirm: '/federation/v1/confirm',
  activate: '/federation/v1/activate', status: '/federation/v1/status', revoke: '/federation/v1/revoke' });

function publicAddress(value) {
  if (typeof value !== 'string' || !ipaddr.isValid(value)) return false;
  const address = ipaddr.parse(value);
  if (address.range() !== 'unicast') return false;
  return address.kind() === 'ipv4' || address.match(ipaddr.parse('2000::'), 3);
}
async function resolveAddresses(hostname, signal) {
  const resolver = new dns.Resolver();
  const abort = () => resolver.cancel();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const answers = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    if (signal.aborted) fail(504, 'PEER_TIMEOUT');
    const addresses = [];
    for (const answer of answers) {
      if (answer.status === 'fulfilled') addresses.push(...answer.value);
      else if (!['ENODATA', 'ENOTFOUND'].includes(answer.reason.code)) fail(502, 'PEER_DNS');
    }
    return addresses;
  } finally { signal.removeEventListener('abort', abort); }
}

// Dependencies are injected only by tests. Runtime configuration cannot disable
// address/TLS validation or supply a proxy, arbitrary route or custom CA.
function createPeerTransport({ resolve = resolveAddresses, isPublic = publicAddress,
  request = https.request, ca, timeoutMs = 5000 } = {}) {
  const running = new Map();
  let total = 0;
  return async function send(origin, operation, body) {
    originValue(origin);
    if (!Object.hasOwn(ROUTES, operation)) fail(400, 'PEER_OPERATION');
    const encoded = Buffer.from(JSON.stringify(body));
    if (encoded.length > LIMIT) fail(413, 'PEER_SIZE');
    const count = running.get(origin) || 0;
    if (count >= 4 || total >= 32) fail(503, 'PEER_CAPACITY');
    running.set(origin, count + 1); total++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let agent;
    try {
      const url = new URL(origin);
      const addresses = await Promise.race([resolve(url.hostname, controller.signal), new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { code: 'ABORT_ERR' })), { once: true });
      })]);
      if (!Array.isArray(addresses) || !addresses.length || addresses.length > 16 || addresses.some(value => !isPublic(value))) fail(403, 'PEER_ADDRESS');
      const selected = addresses[0], family = ipaddr.parse(selected).kind() === 'ipv4' ? 4 : 6;
      agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0, proxyEnv: {} });
      return await new Promise((resolveResult, reject) => {
        let verified = false;
        const req = request({ hostname: url.hostname, port: url.port || 443, path: ROUTES[operation], method: 'POST',
          servername: url.hostname, rejectUnauthorized: true, ca, agent, family,
          signal: controller.signal, maxHeaderSize: 8192,
          lookup: (_host, options, callback) => callback(null, options.all ? [{ address: selected, family }] : selected, family),
          headers: { 'Content-Type': 'application/json', 'Content-Length': encoded.length, Accept: 'application/json' }
        }, res => {
          if (!verified || res.statusCode !== 200 || !/^application\/json(?:;|$)/i.test(res.headers['content-type'] || '') ||
              (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') ||
              Number(res.headers['content-length'] || 0) > LIMIT) {
            res.destroy(); reject(Object.assign(new Error(), { code: 'PEER_RESPONSE' })); return;
          }
          const chunks = []; let size = 0;
          res.on('data', chunk => {
            size += chunk.length;
            if (size > LIMIT) { res.destroy(); reject(Object.assign(new Error(), { code: 'PEER_RESPONSE' })); }
            else chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => {
            try { resolveResult(strictJSON(Buffer.concat(chunks))); } catch (error) { reject(error); }
          });
        });
        req.on('socket', socket => socket.once('secureConnect', () => {
          try {
            if (!socket.authorized || ipaddr.process(socket.remoteAddress).toString() !== ipaddr.process(selected).toString()) {
              req.destroy(Object.assign(new Error(), { code: 'PEER_ADDRESS' })); return;
            }
            verified = true;
            req.end(encoded);
          } catch { req.destroy(Object.assign(new Error(), { code: 'PEER_ADDRESS' })); }
        }));
        req.on('error', reject);
      });
    } catch (error) {
      if (error.status) throw error;
      fail(error.code === 'ABORT_ERR' || controller.signal.aborted ? 504 : 502, 'PEER_UNAVAILABLE');
    } finally {
      clearTimeout(timer); agent?.destroy(); total--;
      const remaining = (running.get(origin) || 1) - 1;
      if (remaining) running.set(origin, remaining); else running.delete(origin);
    }
  };
}

module.exports = { createPeerTransport, publicAddress, resolveAddresses, ROUTES };
