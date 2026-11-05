// Isolated real Core process for the peer TLS integration test. Test-only
// dependency injection maps fixture DNS to loopback with a disposable CA.
const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');
let app, server, db;
process.once('message', async options => {
  try {
    process.env.DATA_DIR = options.dataDir;
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.HOMECORE_INTERNAL_SECRET = crypto.randomBytes(32).toString('hex');
    process.env.HOME_SETUP_REQUIRED = 'false';
    process.env.HOME_PEER_PROTOCOL_ENABLED = options.enabled === false ? 'false' : 'true';
    process.env.HOME_PEER_STATE_DIR = options.stateDir;
    process.env.DISABLE_RATE_LIMIT_FOR_TESTS = 'true';
    const ca = fs.readFileSync(options.cert);
    db = require('../src/db').db;
    server = https.createServer({ key: fs.readFileSync(options.key), cert: ca }, (req, res) => app(req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `https://${options.name}.example.com:${server.address().port}`;
    if (!options.missingState) {
      const store = require('../src/homecore/peerState').openPeerState({ stateDir: options.stateDir,
        namespaceId: db.prepare('SELECT namespace_id FROM hc_peer_namespace').get().namespace_id, initialize: true, origin });
      store.close();
    }
    const transport = require('../src/homecore/peerTransport'), original = transport.createPeerTransport;
    transport.createPeerTransport = () => original({ resolve: async () => ['127.0.0.1'], isPublic: address => address === '127.0.0.1', ca });
    const routes = require('../src/homecore/peerRoutes'), create = routes.createPeerRuntime;
    routes.createPeerRuntime = options => create({ ...options, background: false });
    app = require('../src/app').app;
    process.send({ origin });
  } catch { process.send({ error: 'Isolated peer fixture failed.' }); process.exitCode = 1; server?.close(); db?.close(); }
});
process.on('message', message => {
  if (message !== 'stop' || !server) return;
  server.closeAllConnections(); server.close(() => {
    app?.locals.peerRuntime.close(); db.close(); process.exit(0);
  });
});
