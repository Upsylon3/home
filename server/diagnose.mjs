import { Resolver } from 'node:dns/promises';
import tls from 'node:tls';
import net from 'node:net';
import { validateDomain } from './runtime.mjs';

const nonPublic = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3]]) nonPublic.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10],
  ['ff00::', 8], ['2001:db8::', 32]]) nonPublic.addSubnet(address, prefix, 'ipv6');

export function isPublicAddress(address) {
  const family = net.isIP(address);
  return !!family && !nonPublic.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export async function resolveAddresses(domain, timeout = 5000, resolver = new Resolver({ timeout, tries: 1 })) {
  const timer = setTimeout(() => resolver.cancel(), timeout);
  try {
    const results = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
    return results.map((result, index) => ({ family: index ? 'AAAA' : 'A',
      addresses: result.status === 'fulfilled' ? result.value : [],
      error: result.status === 'rejected' ? result.reason.code : null }));
  } finally { clearTimeout(timer); }
}

export function checkCertificate(domain, { host = 'tls', port = 443, timeout = 5000, ca } = {}) {
  return new Promise(resolve => {
    // DNS never chooses the target: connect only to this installation's TLS service.
    const socket = tls.connect({ host, port, servername: domain, rejectUnauthorized: true, ca });
    const finish = result => { clearTimeout(timer); socket.destroy(); resolve(result); };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeout);
    socket.once('secureConnect', () => finish({ ok: true }));
    socket.once('error', error => finish({ ok: false, reason: error.code }));
  });
}

export async function diagnoseAccess(access, { resolve = resolveAddresses, certificate = checkCertificate } = {}) {
  if (!['local', 'lan', 'public'].includes(access?.mode)) throw new Error('Invalid access mode.');
  const lines = [`Access mode: ${access.mode}.`];
  if (access.mode !== 'public') {
    lines.push('Public HTTPS is not enabled. Run the access action to configure a hostname after creating the owner locally.',
      'Never forward HTTP port 8080 to the internet.');
    return { ok: true, lines };
  }
  const domain = validateDomain(access.domain);
  const [records, secure] = await Promise.all([resolve(domain), certificate(domain)]);
  let ok = true;
  lines.push(`Public hostname: ${domain}`);
  for (const record of records) {
    lines.push(`DNS ${record.family}: ${record.addresses.join(', ') || 'no records'}.`);
    if (record.error && !['ENODATA', 'ENOTFOUND'].includes(record.error)) {
      ok = false;
      lines.push(`DNS ${record.family} lookup failed or timed out. Check the server's DNS resolver and retry.`);
    }
  }
  const addresses = records.flatMap(record => record.addresses);
  if (!addresses.length) {
    ok = false;
    lines.push('No address resolved. Check the hostname at your DNS provider and allow time for DNS changes.');
  } else if (addresses.some(address => !isPublicAddress(address))) {
    ok = false;
    lines.push('DNS includes a private, shared or reserved address. Check public DNS separately; this resolver may use split DNS.');
  }
  if (secure.ok) lines.push('Local HTTPS: certificate chain and hostname verified on this HOME TLS service.');
  else {
    ok = false;
    lines.push('Local HTTPS: not verified. Check status and TLS logs for startup, certificate issuance or renewal errors.');
  }
  lines.push('Compare DNS A records with your router public/WAN IPv4. Update dynamic DNS if the public IP changed.',
    'If the router WAN address is private or 100.64.0.0–100.127.255.255, check for double NAT or provider CGNAT.',
    'Forward TCP 80/443 to the reserved server LAN IP and allow those ports in its firewall. Never forward 8080.',
    'If AAAA records exist, verify IPv6 routing and firewall rules too; remove stale records at your DNS provider.',
    'Outside access is NOT proven. Turn off phone Wi-Fi and open https://' + domain + ' using mobile data.',
    'If incoming access is blocked by your provider, ask for a public IP or use an optional private network. See START-HERE.md.');
  return { ok, lines };
}
