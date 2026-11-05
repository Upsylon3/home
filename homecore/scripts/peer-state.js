// Offline operator tool. Never loads .env, starts Core, reads user credentials,
// contacts a peer or activates federation. Only public metadata goes to stdout.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openPeerState } = require('../src/homecore/peerState');

function refuse(message) { throw Object.assign(new Error(message), { safePeerError: true }); }

function main(args) {
  const command = args.shift(), options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (Object.hasOwn(options, key) || !key.startsWith('--')) refuse('Invalid options.');
    if (key === '--confirm-offline') options[key] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) refuse('Missing option value.');
      options[key] = args[++i];
    }
  }
  const extra = { init: ['--origin'], identity: [], list: [], stage: ['--peer', '--fingerprint'],
    suspend: ['--pair'], revoke: ['--pair'], recover: [] }[command];
  const required = ['--database', '--state-dir', '--confirm-offline', ...(extra || [])];
  if (!extra || Object.keys(options).length !== required.length || required.some(key => !options[key]) ||
      !path.isAbsolute(options['--database']) || !path.isAbsolute(options['--state-dir'])) {
    refuse('Use init|identity|list|stage|suspend|revoke|recover with --database <absolute existing Core DB> --state-dir <absolute private directory> --confirm-offline and documented command options.');
  }
  const databasePath = fs.realpathSync(options['--database']), coreDir = path.dirname(databasePath);
  const stateDir = fs.realpathSync(options['--state-dir']);
  const contains = (a, b) => { const relative = path.relative(a, b); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
  if (contains(coreDir, stateDir) || contains(stateDir, coreDir)) refuse('Authority directory must be separate from the Core data directory.');
  const core = new Database(databasePath, { readonly: true, fileMustExist: true });
  let namespace;
  try { namespace = core.prepare('SELECT namespace_id FROM hc_peer_namespace WHERE id = 1').get()?.namespace_id; }
  finally { core.close(); }
  if (!namespace) refuse('Upgrade Core once before preparing peer identity.');
  const store = openPeerState({ stateDir: options['--state-dir'], namespaceId: namespace,
    initialize: command === 'init', origin: options['--origin'] });
  try {
    let result;
    if (command === 'init' || command === 'identity') result = store.identity();
    if (command === 'list') result = store.list();
    if (command === 'stage') {
      if (!path.isAbsolute(options['--peer'])) refuse('Peer descriptor path must be absolute.');
      const fd = fs.openSync(options['--peer'], 'r');
      let raw;
      try {
        if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > 16384) refuse('Peer descriptor must be a regular file of at most 16 KiB.');
        const buffer = Buffer.alloc(16385), size = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (size > 16384) refuse('Peer descriptor is too large.');
        raw = buffer.subarray(0, size).toString('utf8').trim();
      } finally { fs.closeSync(fd); }
      const value = JSON.parse(raw);
      // Accept the unmodified compact export only. Duplicate members, invalid
      // UTF-8 and alternate encodings cannot hide behind JSON.parse normalization.
      if (JSON.stringify(value) !== raw) refuse('Use an unmodified compact public descriptor export.');
      result = store.stage(value, options['--fingerprint']);
    }
    if (command === 'suspend' || command === 'revoke') result = store.transition(options['--pair'], command === 'suspend' ? 'suspended' : 'revoked');
    if (command === 'recover') result = store.recover();
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { store.close(); }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    // Do not echo parser/SQLite errors: imported content and private state must
    // never appear in shell logs. Operator documentation covers recovery limits.
    console.error(error.safePeerError ? `Peer preparation refused: ${error.message}` :
      'Peer preparation refused. Check public descriptor, private paths and Core schema. Existing authority is never replaced automatically.');
    process.exitCode = 1;
  }
}
module.exports = { main };
