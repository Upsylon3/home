const crypto = require('node:crypto');
const { CompactSign, compactVerify } = require('jose');
const { validateDescriptor } = require('./peerState');

const LIMIT = 32768;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
function fail(status = 403, code = 'PEER_REFUSED') {
  throw Object.assign(new Error('Peer operation refused.'), { status, code });
}
function fields(value, names) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function nonce(value) {
  return typeof value === 'string' && NONCE.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('base64url'); }
function random() { return crypto.randomBytes(32).toString('base64url'); }

// JSON.parse establishes the grammar. This bounded structural walk rejects
// duplicate member names (including escaped equivalents) at every depth.
// Signed bytes stay untouched; this is not JSON canonicalization.
function strictJSON(input) {
  if (Buffer.byteLength(input) > LIMIT) fail(413, 'PEER_SIZE');
  let text, value;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(input)); value = JSON.parse(text); }
  catch { fail(400, 'PEER_JSON'); }
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) || [];
  let position = 0;
  function walk(depth) {
    if (depth > 16) fail(400, 'PEER_JSON');
    const token = tokens[position++];
    if (token === '{') {
      const keys = new Set();
      while (tokens[position] !== '}') {
        const key = JSON.parse(tokens[position++]);
        if (keys.has(key) || keys.size >= 64) fail(400, 'PEER_JSON');
        keys.add(key); position++; walk(depth + 1);
        if (tokens[position] !== ',') break;
        position++;
      }
      position++;
    } else if (token === '[') {
      let count = 0;
      while (tokens[position] !== ']') {
        if (++count > 64) fail(400, 'PEER_JSON');
        walk(depth + 1);
        if (tokens[position] !== ',') break;
        position++;
      }
      position++;
    }
  }
  try { walk(0); } catch (error) { if (error.code) throw error; fail(400, 'PEER_JSON'); }
  if (position !== tokens.length) fail(400, 'PEER_JSON');
  return value;
}
function decode(token) {
  if (typeof token !== 'string' || Buffer.byteLength(token) > 24000 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail(400, 'PEER_JWS');
  const parts = token.split('.');
  const buffers = parts.map(part => {
    const buffer = Buffer.from(part, 'base64url');
    if (buffer.toString('base64url') !== part) fail(400, 'PEER_JWS');
    return buffer;
  });
  const header = strictJSON(buffers[0]), payload = strictJSON(buffers[1]);
  if (!fields(header, ['alg', 'typ', 'kid']) || header.alg !== 'EdDSA' || !nonce(header.kid) || buffers[2].length !== 64) fail();
  return { header, payload };
}
async function sign(payload, type, identity, privateKey) {
  const message = await new CompactSign(Buffer.from(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'EdDSA', typ: type, kid: identity.keyId }).sign(privateKey);
  if (Buffer.byteLength(message) > 24000) fail(413, 'PEER_SIZE');
  return message;
}
async function verify(token, type, descriptor) {
  const decoded = decode(token);
  try { validateDescriptor(descriptor); } catch { fail(400, 'PEER_DESCRIPTOR'); }
  if (decoded.header.typ !== type || decoded.header.kid !== descriptor.keyId) fail();
  try {
    await compactVerify(token, crypto.createPublicKey({ key: descriptor.publicKey, format: 'jwk' }), { algorithms: ['EdDSA'] });
  } catch { fail(); }
  return decoded.payload;
}
function timeClaims(payload, now, lifetime) {
  const current = Math.floor(now / 1000);
  if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.iat < 0 ||
      payload.exp <= payload.iat || payload.exp - payload.iat > lifetime ||
      payload.iat > current + 30 || payload.exp < current - 30) fail(403, 'PEER_EXPIRED');
}
const transcript = (offer, acceptance) => hash(`home-pair-transcript-v1\n${offer}\n${acceptance}`);

module.exports = { LIMIT, fields, uuid, nonce, hash, random, strictJSON, decode, sign, verify, timeClaims, transcript, fail };
