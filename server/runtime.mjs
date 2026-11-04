import net from 'node:net';

export function validateDomain(value) {
  const domain = value.trim().toLowerCase();
  if (domain.length > 253 || net.isIP(domain) || !domain.includes('.') ||
      !domain.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) {
    throw new Error('Enter a hostname such as myhome.duckdns.org, without https://, a port or a path.');
  }
  return domain;
}

export function runtimeCompose(source, version, access = { mode: 'local' }) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid bundle version.');
  if (!['local', 'lan', 'public'].includes(access.mode)) throw new Error('Invalid access mode.');
  const result = structuredClone(source);
  // Separate project/network from source-based installations on the same host.
  result.name = 'home-server';
  delete result.volumes;
  for (const [name, service] of Object.entries(result.services)) {
    if (service.build) {
      service.image = `home-server-${name}:${version}`;
      delete service.build;
    } else if (name === 'tls') {
      service.image = `home-server-tls:${version}`;
    }
    service.pull_policy = 'never';
    if (service.env_file) service.env_file = [{ path: './configuration/core.env', required: true }];
    for (const mount of service.volumes || []) {
      if (mount.type === 'volume') {
        mount.type = 'bind';
        mount.source = `./data/${mount.source}`;
        delete mount.volume;
        mount.bind = { create_host_path: false };
      } else if (mount.target === '/backups') {
        mount.source = './backups';
        mount.bind = { create_host_path: false };
      } else if (mount.target === '/etc/caddy/Caddyfile') {
        mount.source = './configuration/Caddyfile';
        mount.bind = { create_host_path: false };
      } else {
        throw new Error(`Unrecognized host mount in ${name}: ${mount.target}`);
      }
    }
  }
  result.services.homecore.environment.HOME_SETUP_REQUIRED = 'true';
  result.services.gateway.ports = [{
    target: 80, published: '8080', protocol: 'tcp',
    host_ip: access.mode === 'lan' ? '0.0.0.0' : '127.0.0.1'
  }];
  result.services.tls.environment.HOME_DOMAIN = access.mode === 'public' ? validateDomain(access.domain) : '';
  // Compose expands profiles from its environment; users never have to remember flags.
  if (access.mode === 'public') delete result.services.tls.profiles;
  // Keep Docker's logical default network, without the source project's concrete name.
  result.networks = { default: {} };
  return result;
}
