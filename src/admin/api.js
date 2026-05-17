const express = require('express');
const config = require('../config');
const store = require('../store');
const { detectModel, detectChannel, deepDetect } = require('../detective/engine');
const { autoDegrade } = require('../scheduler');
const { getRoutingStats } = require('../relay/distributor');

const router = express.Router();

// Admin auth middleware
function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers['x-admin-token'] || '';
  const cfg = config.get();
  if (!token || token !== cfg.server.adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(adminAuth);
router.use(express.json());

// GET /admin/channels
router.get('/channels', (req, res) => {
  const channels = config.getAllChannels().map(ch => ({
    ...ch,
    keys: ch.keys.map(k => k.slice(0, 8) + '...' + k.slice(-4)),
    _keyIndex: undefined
  }));
  res.json({ channels });
});

// GET /admin/channels/:id
router.get('/channels/:id', (req, res) => {
  const ch = config.getChannel(parseInt(req.params.id));
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  res.json({ channel: { ...ch, keys: ch.keys.map(k => k.slice(0, 8) + '...' + k.slice(-4)), _keyIndex: undefined } });
});

// POST /admin/channels
router.post('/channels', (req, res) => {
  const { name, type, endpoint, keys, models, modelMapping, weight, priority } = req.body;
  if (!name || !endpoint || !keys || !keys.length) {
    return res.status(400).json({ error: 'Missing required fields: name, endpoint, keys' });
  }
  const ch = config.addChannel({ name, type, endpoint, keys, models: models || [], modelMapping, weight, priority });
  res.json({ channel: ch, message: 'Channel added' });
});

// PUT /admin/channels/:id
router.put('/channels/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const ch = config.updateChannel(id, req.body);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  res.json({ channel: ch, message: 'Channel updated' });
});

// DELETE /admin/channels/:id
router.delete('/channels/:id', (req, res) => {
  const ok = config.deleteChannel(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Channel not found' });
  res.json({ message: 'Channel deleted' });
});

// POST /admin/channels/:id/test — quick connectivity test
router.post('/channels/:id/test', async (req, res) => {
  const ch = config.getChannel(parseInt(req.params.id));
  if (!ch) return res.status(404).json({ error: 'Channel not found' });

  const key = ch.keys[0];
  const endpoint = ch.endpoint.replace(/\/+$/, '');
  const testModel = req.body?.model || ch.models[0] || 'gpt-4o';
  const start = Date.now();

  try {
    const isAnth = ch.type === 'anthropic';
    const url = isAnth ? `${endpoint}/v1/messages` : `${endpoint}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (isAnth) {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const body = isAnth
      ? { model: testModel, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 }
      : { model: testModel, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10, stream: false };

    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const elapsed = Date.now() - start;
    const data = await r.json().catch(() => null);

    if (r.ok) {
      const content = isAnth
        ? data?.content?.[0]?.text || ''
        : data?.choices?.[0]?.message?.content || '';
      res.json({ ok: true, status: r.status, responseTime: elapsed, model: testModel, returnedModel: data?.model || '', content: content.slice(0, 100) });
    } else {
      res.json({ ok: false, status: r.status, responseTime: elapsed, error: JSON.stringify(data).slice(0, 300) });
    }
  } catch (e) {
    res.json({ ok: false, status: 0, responseTime: Date.now() - start, error: e.message });
  }
});

// POST /admin/channels/fetch-models — discover models from upstream
router.post('/channels/fetch-models', async (req, res) => {
  const { endpoint, key, type } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  const base = endpoint.replace(/\/+$/, '');
  try {
    if (type === 'anthropic') {
      // Anthropic doesn't have a /models endpoint, return common models
      const models = [
        'claude-opus-4-20250918','claude-sonnet-4-20250514',
        'claude-3-7-sonnet-latest','claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022','claude-3-opus-20240229'
      ];
      return res.json({ models, source: 'preset' });
    }
    const url = `${base}/models`;
    const headers = {};
    if (key) headers['Authorization'] = `Bearer ${key}`;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.json({ error: `HTTP ${r.status}: ${txt.slice(0, 200)}`, models: [] });
    }
    const d = await r.json();
    const list = (d.data || d.models || d || [])
      .map(m => typeof m === 'string' ? m : m.id)
      .filter(Boolean)
      .sort();
    res.json({ models: list, source: 'api', total: list.length });
  } catch (e) {
    res.json({ error: e.message, models: [] });
  }
});

// PUT /admin/channels/:id/models/:model/toggle — enable/disable a model in a channel
router.put('/channels/:id/models/:model/toggle', (req, res) => {
  const id = parseInt(req.params.id);
  const model = decodeURIComponent(req.params.model);
  const ch = config.getChannel(id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const enabled = req.body.enabled !== false; // default true
  if (!Array.isArray(ch.disabledModels)) ch.disabledModels = [];
  if (enabled) {
    ch.disabledModels = ch.disabledModels.filter(m => m !== model);
  } else {
    if (!ch.disabledModels.includes(model)) ch.disabledModels.push(model);
  }
  config.updateChannel(id, { disabledModels: ch.disabledModels });
  res.json({ message: `Model "${model}" ${enabled ? 'enabled' : 'disabled'} in channel ${id}`, disabledModels: ch.disabledModels });
});

// GET /admin/model-aliases — get global model aliases
router.get('/model-aliases', (req, res) => {
  const cfg = config.get();
  res.json({ aliases: cfg.modelAliases || {} });
});

// PUT /admin/model-aliases — update global model aliases
router.put('/model-aliases', (req, res) => {
  const cfg = config.get();
  cfg.modelAliases = req.body.aliases || {};
  config.save();
  config.load(); // rebuild index with new aliases
  res.json({ message: 'Model aliases updated', aliases: cfg.modelAliases });
});

// GET /admin/stats
router.get('/stats', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  res.json(store.getStats(hours));
});

// GET /admin/logs
router.get('/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json({ logs: store.getRecentLogs(limit) });
});

// GET /admin/models — list all aggregated models
router.get('/models', (req, res) => {
  const models = config.getAllModels();
  const index = config.getModelIndex();
  const detail = models.map(m => ({
    id: m,
    channels: (index.get(m) || []).map(ch => ({ id: ch.id, name: ch.name, priority: ch.priority, weight: ch.weight }))
  }));
  res.json({ total: models.length, models: detail });
});

// POST /admin/config/reload
router.post('/config/reload', (req, res) => {
  try {
    config.load();
    const { startCron, stopCron } = require('../scheduler');
    stopCron(); startCron(); // restart cron with new config
    res.json({ message: 'Config reloaded', channels: config.getAllChannels().length, models: config.getAllModels().length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/detect-config — get detection settings
router.get('/detect-config', (req, res) => {
  const cfg = config.get();
  const d = cfg.detect || {};
  res.json({
    sampleRate: d.sampleRate || 0,
    cronIntervalHours: d.cronIntervalHours || 0,
    degradeThreshold: d.degradeThreshold || 0,
    degradeAction: d.degradeAction || 'weight',
  });
});

// PUT /admin/detect-config — update detection settings
router.put('/detect-config', (req, res) => {
  const cfg = config.get();
  if (!cfg.detect) cfg.detect = {};
  const { sampleRate, cronIntervalHours, degradeThreshold, degradeAction } = req.body;
  if (sampleRate != null) cfg.detect.sampleRate = Math.max(0, Math.min(1, parseFloat(sampleRate) || 0));
  if (cronIntervalHours != null) cfg.detect.cronIntervalHours = Math.max(0, parseInt(cronIntervalHours) || 0);
  if (degradeThreshold != null) cfg.detect.degradeThreshold = Math.max(0, Math.min(100, parseInt(degradeThreshold) || 0));
  if (degradeAction) cfg.detect.degradeAction = ['weight', 'disable'].includes(degradeAction) ? degradeAction : 'weight';
  config.save();
  // Restart cron
  const { startCron, stopCron } = require('../scheduler');
  stopCron(); startCron();
  res.json({ message: 'Detection config updated', detect: cfg.detect });
});

// GET /admin/routing-stats — routing engine live stats
router.get('/routing-stats', (req, res) => {
  res.json(getRoutingStats());
});

// GET /admin/detect/:channelId — get detection results
router.get('/detect/:channelId', (req, res) => {
  const results = store.getDetectResults(parseInt(req.params.channelId));
  // Parse probes JSON
  const parsed = results.map(r => ({
    ...r,
    probes: r.probes ? JSON.parse(r.probes) : {},
    claimedFamily: r.claimed_family || null,
    suspectFamily: r.suspect_family || null,
  }));
  res.json({ results: parsed });
});

// POST /admin/channels/:id/detect — trigger detection
const _detectRunning = new Set();
router.post('/channels/:id/detect', async (req, res) => {
  const id = parseInt(req.params.id);
  const ch = config.getChannel(id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  if (_detectRunning.has(id)) return res.status(409).json({ error: 'Detection already running for this channel' });

  const modelId = req.body.model; // optional: detect single model
  _detectRunning.add(id);

  try {
    if (modelId) {
      if (!ch.models.includes(modelId)) return res.status(400).json({ error: `Model "${modelId}" not in channel` });
      const result = await detectModel(ch, modelId, (msg) => console.log(`[detect] CH${id} ${msg}`));
      _detectRunning.delete(id);
      res.json({ result });
    } else {
      const results = await detectChannel(ch, (msg) => console.log(`[detect] CH${id} ${msg}`));
      _detectRunning.delete(id);
      autoDegrade(ch, results);
      res.json({ results });
    }
  } catch (e) {
    _detectRunning.delete(id);
    res.status(500).json({ error: e.message });
  }
});

// POST /admin/channels/:id/deep-detect — trigger deep detection for a single model
router.post('/channels/:id/deep-detect', async (req, res) => {
  const id = parseInt(req.params.id);
  const ch = config.getChannel(id);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  const modelId = req.body.model;
  if (!modelId) return res.status(400).json({ error: 'model is required' });
  if (!ch.models.includes(modelId)) return res.status(400).json({ error: `Model "${modelId}" not in channel` });

  const logs = [];
  try {
    const result = await deepDetect(ch, modelId, (msg) => {
      logs.push(msg);
      console.log(`[deep-detect] CH${id} ${msg}`);
    });
    res.json({ result, logs });
  } catch (e) {
    res.status(500).json({ error: e.message, logs });
  }
});

// POST /admin/detect/all — detect all channels
router.post('/detect/all', async (req, res) => {
  const channels = config.getAllChannels().filter(ch => ch.status === 'enabled');
  res.json({ message: `Detection started for ${channels.length} channels`, channelIds: channels.map(c => c.id) });
  // Run in background
  for (const ch of channels) {
    if (_detectRunning.has(ch.id)) continue;
    _detectRunning.add(ch.id);
    try {
      const results = await detectChannel(ch, (msg) => console.log(`[detect] CH${ch.id} ${msg}`));
      autoDegrade(ch, results);
    } catch (e) {
      console.error(`[detect] CH${ch.id} error:`, e.message);
    }
    _detectRunning.delete(ch.id);
  }
});

// ══════════════════════════════════════════
// API KEY MANAGEMENT
// ══════════════════════════════════════════
router.get('/keys', (req, res) => {
  res.json({ keys: store.listAllApiKeys() });
});

router.post('/keys', (req, res) => {
  const { name, quota, rateLimit } = req.body;
  const key = store.createApiKey({ name, quota, rateLimit });
  res.json({ key, message: 'API key created' });
});

router.get('/keys/:id', (req, res) => {
  const key = store.getApiKey(parseInt(req.params.id));
  if (!key) return res.status(404).json({ error: 'Key not found' });
  res.json({ key });
});

router.put('/keys/:id', (req, res) => {
  const key = store.updateApiKey(parseInt(req.params.id), req.body);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  res.json({ key, message: 'Key updated' });
});

router.delete('/keys/:id', (req, res) => {
  const ok = store.deleteApiKey(parseInt(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Key not found' });
  res.json({ message: 'Key deleted' });
});

// ── Password Change ─────────────────────────────────────────────

router.put('/password', (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const cfg = config.get();
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Missing oldPassword or newPassword' });
  if (oldPassword !== cfg.server.adminToken) return res.status(403).json({ error: 'Old password incorrect' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  cfg.server.adminToken = newPassword;
  config.save();
  res.json({ message: 'Password updated' });
});

// ── Version Check & Update ──────────────────────────────────────

const https = require('https');
const { execSync, exec } = require('child_process');
const currentVersion = require('../../package.json').version;

function fetchLatestRelease(repo) {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const opts = { headers: { 'User-Agent': 'GateAPI-Updater', Accept: 'application/vnd.github.v3+json' } };
    https.get(url, opts, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        if (resp.statusCode === 404) {
          return fetchLatestTag(repo).then(resolve).catch(reject);
        }
        if (resp.statusCode !== 200) return reject(new Error(`GitHub API ${resp.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function fetchLatestTag(repo) {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${repo}/tags?per_page=1`;
    const opts = { headers: { 'User-Agent': 'GateAPI-Updater', Accept: 'application/vnd.github.v3+json' } };
    https.get(url, opts, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        if (resp.statusCode !== 200) return reject(new Error(`GitHub API ${resp.statusCode}`));
        try {
          const tags = JSON.parse(data);
          if (!tags.length) return resolve({ tag_name: currentVersion, body: '' });
          resolve({ tag_name: tags[0].name, body: '' });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

router.get('/check-update', async (req, res) => {
  try {
    const cfg = config.get();
    const repo = cfg.server.githubRepo || '';
    if (!repo) return res.json({ current: currentVersion, latest: currentVersion, hasUpdate: false, note: 'githubRepo not configured' });

    const release = await fetchLatestRelease(repo);
    const latest = release.tag_name.replace(/^v/, '');
    const hasUpdate = compareVersions(currentVersion, latest) < 0;

    res.json({
      current: currentVersion,
      latest,
      hasUpdate,
      changelog: release.body || '',
      url: release.html_url || `https://github.com/${repo}/releases`
    });
  } catch (err) {
    res.status(500).json({ error: err.message, current: currentVersion });
  }
});

let _updating = false;

router.post('/update', async (req, res) => {
  if (_updating) return res.status(409).json({ error: 'Update already in progress' });
  _updating = true;

  const projectRoot = require('path').join(__dirname, '..', '..');

  try {
    const pullOutput = execSync('git pull', { cwd: projectRoot, timeout: 30000, encoding: 'utf8' });

    let npmOutput = '';
    if (!pullOutput.includes('Already up to date')) {
      npmOutput = execSync('npm install --production', { cwd: projectRoot, timeout: 120000, encoding: 'utf8' });
    }

    const newPkg = JSON.parse(require('fs').readFileSync(require('path').join(projectRoot, 'package.json'), 'utf8'));

    res.json({
      success: true,
      message: 'Update complete, restarting...',
      pullOutput: pullOutput.trim(),
      npmOutput: npmOutput.trim(),
      newVersion: newPkg.version
    });

    setTimeout(() => {
      console.log('[update] Restarting process...');
      process.exit(0);
    }, 1000);
  } catch (err) {
    _updating = false;
    res.status(500).json({ error: err.message, stdout: err.stdout, stderr: err.stderr });
  }
});

module.exports = router;
