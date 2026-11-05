import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import net from 'node:net';
import dgram from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { spawnSync } from 'node:child_process';
import { diagnoseAccess, isPublicAddress, checkCertificate, resolveAddresses } from '../diagnose.mjs';

const records = (a = ['8.8.8.8'], aaaa = []) => [
  { family: 'A', addresses: a, error: null }, { family: 'AAAA', addresses: aaaa, error: aaaa.length ? null : 'ENODATA' }
];
const dependencies = (dns = records(), ok = true) => ({ resolve: async () => dns, certificate: async () => ({ ok }) });

test('local and LAN diagnostics make no network calls; invalid hostnames are refused first', async () => {
  const fail = () => assert.fail('Network probe must not run');
  for (const mode of ['local', 'lan']) {
    const result = await diagnoseAccess({ mode }, { resolve: fail, certificate: fail });
    assert.equal(result.ok, true);
    assert.match(result.lines.join('\n'), /Public HTTPS is not enabled/);
  }
  await assert.rejects(diagnoseAccess({ mode: 'public', domain: 'https://bad/path' }, { resolve: fail, certificate: fail }));
  await assert.rejects(diagnoseAccess({ mode: 'unknown' }));
});

test('DNS and certificate results distinguish local checks from outside reachability', async () => {
  const access = { mode: 'public', domain: 'home.example.org' };
  const original = structuredClone(access);
  const good = await diagnoseAccess(access, dependencies());
  assert.equal(good.ok, true);
  assert.match(good.lines.join('\n'), /certificate chain and hostname verified/);
  assert.match(good.lines.join('\n'), /Outside access is NOT proven/);
  for (const [dns, secure, expected] of [
    [records([], []), true, /No address resolved/],
    [records(['100.64.0.1']), true, /private, shared or reserved/],
    [records(['8.8.8.8'], ['fd00::1']), true, /split DNS/],
    [[{ family: 'A', addresses: ['8.8.8.8'] }, { family: 'AAAA', addresses: [], error: 'ETIMEOUT' }], true, /lookup failed or timed out/],
    [records(), false, /Local HTTPS: not verified/]
  ]) {
    const result = await diagnoseAccess(access, dependencies(dns, secure));
    assert.equal(result.ok, false);
    assert.match(result.lines.join('\n'), expected);
  }
  assert.deepEqual(access, original);
});

test('private, shared, loopback, mapped and reserved DNS addresses cannot pass public checks', () => {
  for (const address of ['bad', '0.0.0.0', '10.0.0.1', '100.64.0.1', '100.127.255.255',
    '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::', '::1',
    'fd00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:192.168.1.1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
});

test('TLS uses real certificate verification, hostname checks and a bounded handshake', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-diagnose-tls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const keyFile = path.join(root, 'key.pem'), certFile = path.join(root, 'cert.pem');
  const gitOpenSSL = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/usr/bin/openssl.exe');
  const openssl = process.env.HOME_TEST_OPENSSL || (process.platform === 'win32' && fs.existsSync(gitOpenSSL) ? gitOpenSSL : 'openssl');
  const configFile = path.join(root, 'openssl.cnf');
  fs.writeFileSync(configFile, '[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=home.example.test\n[extensions]\nsubjectAltName=DNS:home.example.test\n');
  const generated = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-config', configFile,
    '-keyout', keyFile, '-out', certFile], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(generated.status, 0, generated.error?.message || generated.stderr);
  const ca = fs.readFileSync(certFile);
  const server = tls.createServer({ key: fs.readFileSync(keyFile), cert: ca }, socket => socket.end());
  server.on('tlsClientError', () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const options = { host: '127.0.0.1', port: server.address().port, ca };
  assert.equal((await checkCertificate('home.example.test', options)).ok, true);
  assert.equal((await checkCertificate('wrong.example.test', options)).ok, false);
  assert.equal((await checkCertificate('home.example.test', { ...options, ca: undefined })).ok, false);
  const sockets = new Set();
  const stalled = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => stalled.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => stalled.close(resolve)); });
  const result = await checkCertificate('home.example.test', { host: '127.0.0.1', port: stalled.address().port, timeout: 50 });
  assert.deepEqual(result, { ok: false, reason: 'timeout' });
});

test('real DNS handles A answers, absent AAAA and cancellation without external lookups', async t => {
  const server = dgram.createSocket('udp4');
  await new Promise(resolve => server.bind(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  let drop = false;
  server.on('message', (query, peer) => {
    if (drop) return;
    const answer = Buffer.from(query);
    const ipv4 = query.readUInt16BE(query.length - 4) === 1;
    answer.writeUInt16BE(ipv4 ? 0x8180 : 0x8183, 2);
    answer.writeUInt16BE(ipv4 ? 1 : 0, 6);
    const record = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 8, 8, 8, 8]);
    server.send(ipv4 ? Buffer.concat([answer, record]) : answer, peer.port, peer.address);
  });
  const resolver = new Resolver();
  resolver.setServers([`127.0.0.1:${server.address().port}`]);
  const result = await resolveAddresses('home.example.test', 1000, resolver);
  assert.deepEqual(result[0].addresses, ['8.8.8.8']);
  assert.deepEqual(result[1].addresses, []);
  assert.equal(result[1].error, 'ENOTFOUND');
  drop = true;
  const cancelled = await resolveAddresses('timeout.example.test', 50, resolver);
  assert.ok(cancelled.every(record => record.error === 'ECANCELLED'));
});

test('diagnose CLI reads only installation state and preserves every fixture file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'home-diagnose-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'setup'));
  fs.mkdirSync(path.join(root, 'configuration'));
  for (const file of ['cli.mjs', 'setup.mjs', 'runtime.mjs', 'upgrade.mjs', 'source-import.mjs', 'diagnose.mjs']) {
    fs.copyFileSync('server/' + file, path.join(root, 'setup', file));
  }
  const stateFile = path.join(root, 'configuration/installation.json');
  const state = JSON.stringify({ schema: 1, installationId: '11111111-1111-1111-1111-111111111111', access: { mode: 'local' } });
  fs.writeFileSync(stateFile, state);
  const result = spawnSync(process.execPath, [path.join(root, 'setup/cli.mjs'), 'diagnose'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Public HTTPS is not enabled/);
  assert.doesNotMatch(result.stdout, /setup code|registration code/);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), state);
  assert.deepEqual(fs.readdirSync(path.join(root, 'configuration')), ['installation.json']);
  assert.deepEqual(fs.readdirSync(root).sort(), ['configuration', 'setup']);
});
