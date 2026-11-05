const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function credentials(directory) {
  const openssl = process.platform === 'win32' && fs.existsSync('C:/Program Files/Git/usr/bin/openssl.exe')
    ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  const config = path.join(directory, 'openssl.cnf'), cert = path.join(directory, 'tls-cert.pem'), key = path.join(directory, 'tls-key.pem');
  fs.writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=peer.example.com\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:a.example.com,DNS:b.example.com,DNS:peer.example.com\n');
  const result = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-config', config, '-keyout', key, '-out', cert], { stdio: 'ignore', windowsHide: true });
  if (result.status !== 0) throw new Error('Disposable peer TLS fixture requires OpenSSL.');
  fs.chmodSync(key, 0o600);
  return { cert, key };
}
module.exports = { credentials };
