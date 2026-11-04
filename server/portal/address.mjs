export function normalizeAddress(value) {
  let input = value.trim();
  if (!input || input.length > 2048) throw new Error('Enter your HOME address.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = 'http://' + input;
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') throw new Error('Use the server address only, without credentials, a page path or a setup code.');
  const host = url.hostname.toLowerCase();
  const parts = host.split('.').map(Number);
  const privateIPv4 = parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
  const privateIPv6 = host === '[::1]' || /^\[f[cd][0-9a-f]{2}:/.test(host) || /^\[fe[89ab][0-9a-f]:/.test(host);
  const local = privateIPv4 || privateIPv6 || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
  if (url.protocol === 'http:' && !local) throw new Error('Use https:// for an outside address. For a local IP, include http:// explicitly.');
  return url.origin + '/';
}
