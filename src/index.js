const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const store = require('./store');
const apiRouter = require('./router');
const adminRouter = require('./admin/api');
const { startCron } = require('./scheduler');
const webhook = require('./webhook');
const cache = require('./cache');
const accounts = require('./accounts');

// Load config
config.load();

// Init SQLite
store.init();

// Init accounts
accounts.load();
accounts.startKeepAlive();

// Init cache
const cacheCfg = config.get().cache || {};
cache.configure(cacheCfg);

// Init webhook hooks
webhook.init();

const app = express();
app.use(cors());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: require('../package.json').version, uptime: process.uptime() });
});

// OpenAPI spec
app.get('/openapi.json', (req, res) => {
  res.json(require('./openapi.json'));
});

// Serve web UI
app.use(express.static(path.join(__dirname, '..', 'web')));

// Admin API
app.use('/admin', adminRouter);

// External API (OpenAI-compatible)
app.use(apiRouter);

// Start server
const port = config.get().server.port || 3000;
app.listen(port, () => {
  const cfg = config.get();
  console.log(`
╔══════════════════════════════════════════════╗
║           GateAPI v${require('../package.json').version}                  ║
║  LLM API Gateway with Authenticity Detection ║
╠══════════════════════════════════════════════╣
║  API:    http://localhost:${port}/v1              ║
║  Admin:  http://localhost:${port}/admin            ║
║  Panel:  http://localhost:${port}/                 ║
╠══════════════════════════════════════════════╣
║  Channels: ${String(cfg.channels.length).padEnd(3)} | Models: ${String(config.getAllModels().length).padEnd(4)}          ║
║  API Keys: ${String(cfg.server.apiKeys.length).padEnd(3)}                              ║
╚══════════════════════════════════════════════╝
  `);
  startCron();
});
