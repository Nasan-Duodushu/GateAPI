const express = require('express');
const config = require('../config');
const store = require('../store');
const { detectModel, detectChannel, deepDetect } = require('../detective/engine');
const { autoDegrade, getCronStatus } = require('../scheduler');
const { getRoutingStats } = require('../relay/distributor');
const { queryBalance, queryAllBalances } = require('../balance');
const accounts = require('../accounts');
const cache = require('../cache');

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

// POST /admin/channels/fetch-models — discover models from upstream (smart probing)
router.post('/channels/fetch-models', async (req, res) => {
  const { endpoint, key, type } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  // Anthropic: no /models endpoint, return preset list
  if (type === 'anthropic') {
    const models = [
      'claude-opus-4-20250918','claude-sonnet-4-20250514',
      'claude-3-7-sonnet-latest','claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022','claude-3-opus-20240229'
    ];
    return res.json({ models, source: 'preset' });
  }

  // Build candidate URLs to try in order
  const cleaned = endpoint.replace(/\/+$/, '');
  // strip trailing version segments (/v1, /v2, /api/v1, /api, /zen/v1) for base
  const root = cleaned
    .replace(/\/api\/v\d+$/i, '')
    .replace(/\/zen\/v\d+$/i, '')
    .replace(/\/v\d+$/i, '')
    .replace(/\/api$/i, '');

  // Candidate paths (deduplicated, ordered by likelihood)
  const candidatePaths = Array.from(new Set([
    `${cleaned}/models`,         // user's endpoint + /models
    `${root}/v1/models`,         // standard OpenAI
    `${root}/zen/v1/models`,     // OpenCode Zen
    `${root}/api/v1/models`,     // some New-API variants
    `${root}/models`,            // root /models
  ]));

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'TrueGate/0.1.0',
  };
  if (key) headers['Authorization'] = `Bearer ${key}`;

  const attempts = [];
  for (const url of candidatePaths) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      const ct = r.headers.get('content-type') || '';
      let body = '';
      let parsed = null;
      try {
        body = await r.text();
        if (ct.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('[')) {
          parsed = JSON.parse(body);
        }
      } catch (_) {}

      attempts.push({ url, status: r.status });

      // Success: HTTP 2xx and parseable JSON with model list shape
      if (r.ok && parsed) {
        const raw = parsed.data || parsed.models || (Array.isArray(parsed) ? parsed : null);
        if (Array.isArray(raw)) {
          const list = raw
            .map(m => typeof m === 'string' ? m : (m.id || m.name || m.model))
            .filter(Boolean)
            .sort();
          if (list.length > 0) {
            return res.json({ models: list, source: 'api', total: list.length, matchedUrl: url, attempts });
          }
        }
      }
    } catch (e) {
      attempts.push({ url, error: e.message });
    }
  }

  // All attempts failed: build friendly error message
  const lastStatuses = attempts.map(a => a.status).filter(Boolean);
  let hint;
  if (lastStatuses.includes(401)) {
    hint = 'API Key 无效或缺失，请检查 Key';
  } else if (lastStatuses.includes(403)) {
    hint = '拒绝访问（可能 IP 限制、UA 限制或 Key 权限不足）';
  } else if (lastStatuses.every(s => s === 404)) {
    hint = `所有候选 URL 返回 404，请检查 endpoint 是否正确（例如 Minimax 应填 https://api.minimaxi.com/v1，OpenCode Zen 应填 https://opencode.ai/zen/v1）`;
  } else {
    hint = '无法获取模型列表，请检查 endpoint 和 Key';
  }

  res.json({ error: hint, models: [], attempts });
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

// GET /admin/stats/hourly — hourly trend data for charts
router.get('/stats/hourly', (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const data = store.getHourlyStats(hours);
  res.json({ hours, data });
});

// GET /admin/stats/usage — multi-dimension usage stats
router.get('/stats/usage', (req, res) => {
  const hours = parseInt(req.query.hours) || 168;
  const byModel = store.getUsageByModel(hours);
  const byChannel = store.getUsageByChannel(hours);
  // Attach costRate from config to each channel entry
  const channels = config.getAllChannels();
  const costMap = {};
  for (const ch of channels) costMap[ch.id] = ch.costRate || 1.0;
  const byChannelWithCost = byChannel.map(c => ({
    ...c,
    costRate: costMap[c.channel_id] || 1.0,
    estimatedCost: ((c.prompt_tokens || 0) + (c.completion_tokens || 0)) * (costMap[c.channel_id] || 1.0) / 1000000
  }));
  res.json({ hours, byModel, byChannel: byChannelWithCost });
});

// GET /admin/stats/daily — daily usage for long-term trends
router.get('/stats/daily', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const data = store.getDailyUsage(days);
  res.json({ days, data });
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
    channels: (index.get(m) || []).map(ch => ({ id: ch.id, name: ch.name, priority: ch.priority, weight: ch.weight, costRate: ch.costRate ?? 1.0, type: ch.type })),
    minCost: Math.min(...(index.get(m) || []).map(ch => ch.costRate ?? 1.0)),
    maxCost: Math.max(...(index.get(m) || []).map(ch => ch.costRate ?? 1.0)),
  }));
  res.json({ total: models.length, models: detail });
});

// GET /admin/export-tool — generate config for external tools
router.get('/export-tool', (req, res) => {
  const format = req.query.format || 'openai';
  const cfg = config.get();
  const host = req.headers.host || `localhost:${cfg.server.port || 3000}`;
  const baseUrl = `http://${host}/v1`;
  const models = config.getAllModels();
  const apiKey = cfg.server.apiKeys[0] || 'sk-your-key';

  if (format === 'cherrystudio') {
    // CherryStudio provider config
    res.json({
      format: 'cherrystudio',
      config: {
        id: 'gateapi',
        name: 'GateAPI',
        apiKey,
        baseUrl,
        models: models.map(m => ({ id: m, name: m })),
      }
    });
  } else if (format === 'cursor') {
    // Cursor settings.json snippet
    res.json({
      format: 'cursor',
      config: {
        "openai.apiBase": baseUrl,
        "openai.apiKey": apiKey,
        "openai.models": models,
      },
      instructions: 'Add these to your Cursor settings or .cursor/settings.json'
    });
  } else {
    // Generic OpenAI-compatible config
    res.json({
      format: 'openai',
      config: { baseUrl, apiKey, models },
      env: `OPENAI_API_BASE=${baseUrl}\nOPENAI_API_KEY=${apiKey}`,
      curl: `curl ${baseUrl}/chat/completions -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d '{"model":"${models[0] || 'gpt-4o'}","messages":[{"role":"user","content":"Hi"}]}'`
    });
  }
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
    cronExpression: d.cronExpression || '',
    cronTimezone: d.cronTimezone || '',
    degradeThreshold: d.degradeThreshold || 0,
    degradeAction: d.degradeAction || 'weight',
  });
});

// GET /admin/cron-status — get current cron scheduler status
router.get('/cron-status', (req, res) => {
  res.json(getCronStatus());
});

// PUT /admin/detect-config — update detection settings
router.put('/detect-config', (req, res) => {
  const cfg = config.get();
  if (!cfg.detect) cfg.detect = {};
  const { sampleRate, cronIntervalHours, cronExpression, cronTimezone, degradeThreshold, degradeAction } = req.body;
  if (sampleRate != null) cfg.detect.sampleRate = Math.max(0, Math.min(1, parseFloat(sampleRate) || 0));
  if (cronIntervalHours != null) cfg.detect.cronIntervalHours = Math.max(0, parseInt(cronIntervalHours) || 0);
  if (cronExpression != null) {
    const expr = String(cronExpression).trim();
    if (expr) {
      try {
        const cron = require('node-cron');
        if (!cron.validate(expr)) return res.status(400).json({ error: `Invalid cron expression: "${expr}"` });
      } catch (e) { return res.status(500).json({ error: 'node-cron not available' }); }
    }
    cfg.detect.cronExpression = expr || undefined;
  }
  if (cronTimezone != null) cfg.detect.cronTimezone = String(cronTimezone).trim() || undefined;
  if (degradeThreshold != null) cfg.detect.degradeThreshold = Math.max(0, Math.min(100, parseInt(degradeThreshold) || 0));
  if (degradeAction) cfg.detect.degradeAction = ['weight', 'disable'].includes(degradeAction) ? degradeAction : 'weight';
  config.save();
  // Restart cron
  const { startCron, stopCron } = require('../scheduler');
  stopCron(); startCron();
  res.json({ message: 'Detection config updated', detect: cfg.detect, cronStatus: getCronStatus() });
});

// GET /admin/model-fallback — get model fallback chain config
router.get('/model-fallback', (req, res) => {
  const cfg = config.get();
  res.json({ modelFallback: cfg.modelFallback || {} });
});

// PUT /admin/model-fallback — update model fallback chain config
router.put('/model-fallback', (req, res) => {
  const cfg = config.get();
  const { modelFallback } = req.body;
  if (modelFallback && typeof modelFallback === 'object') {
    cfg.modelFallback = modelFallback;
    config.save();
  }
  res.json({ message: 'Model fallback updated', modelFallback: cfg.modelFallback });
});

// GET /admin/prompt-engine — get prompt engine config
router.get('/prompt-engine', (req, res) => {
  const cfg = config.get();
  res.json({ promptEngine: cfg.promptEngine || {} });
});

// PUT /admin/prompt-engine — update prompt engine config
router.put('/prompt-engine', (req, res) => {
  const cfg = config.get();
  if (!cfg.promptEngine) cfg.promptEngine = {};
  const { enabled, systemPrompt, injectMode, maxMessages } = req.body;
  if (enabled != null) cfg.promptEngine.enabled = !!enabled;
  if (systemPrompt != null) cfg.promptEngine.systemPrompt = String(systemPrompt);
  if (injectMode != null) cfg.promptEngine.injectMode = ['prepend', 'append'].includes(injectMode) ? injectMode : 'prepend';
  if (maxMessages != null) cfg.promptEngine.maxMessages = Math.max(0, parseInt(maxMessages) || 0);
  config.save();
  res.json({ message: 'Prompt engine config updated', promptEngine: cfg.promptEngine });
});

// GET /admin/routing-stats — routing engine live stats
router.get('/routing-stats', (req, res) => {
  res.json(getRoutingStats());
});

// GET /admin/cache — cache stats
router.get('/cache', (req, res) => {
  const cfg = config.get();
  res.json({ ...cache.stats(), config: cfg.cache || {} });
});

// PUT /admin/cache — update cache config
router.put('/cache', (req, res) => {
  const cfg = config.get();
  if (!cfg.cache) cfg.cache = {};
  const { enabled, maxSize, ttlSeconds } = req.body;
  if (enabled != null) cfg.cache.enabled = !!enabled;
  if (maxSize != null) cfg.cache.maxSize = parseInt(maxSize) || 500;
  if (ttlSeconds != null) cfg.cache.ttlSeconds = parseInt(ttlSeconds) || 300;
  config.save();
  cache.configure(cfg.cache);
  res.json({ message: 'Cache config updated', ...cache.stats() });
});

// DELETE /admin/cache — clear cache
router.delete('/cache', (req, res) => {
  const cleared = cache.clear();
  res.json({ message: `Cache cleared (${cleared} entries)` });
});

// GET /admin/webhook — get webhook config
router.get('/webhook', (req, res) => {
  const cfg = config.get();
  const wh = cfg.webhook || {};
  res.json({
    enabled: wh.enabled || false,
    notifyAlways: wh.notifyAlways || false,
    telegram: { enabled: wh.telegram?.enabled || false, token: wh.telegram?.token ? '***' : '', chatId: wh.telegram?.chatId || '', url: wh.telegram?.url || '' },
    discord: { enabled: wh.discord?.enabled || false, url: wh.discord?.url ? '***configured***' : '' },
    http: { enabled: wh.http?.enabled || false, url: wh.http?.url || '' },
  });
});

// PUT /admin/webhook — update webhook config
router.put('/webhook', (req, res) => {
  const cfg = config.get();
  if (!cfg.webhook) cfg.webhook = {};
  const { enabled, notifyAlways, telegram, discord, http } = req.body;
  if (enabled != null) cfg.webhook.enabled = !!enabled;
  if (notifyAlways != null) cfg.webhook.notifyAlways = !!notifyAlways;
  if (telegram) {
    if (!cfg.webhook.telegram) cfg.webhook.telegram = {};
    if (telegram.enabled != null) cfg.webhook.telegram.enabled = !!telegram.enabled;
    if (telegram.token != null && telegram.token !== '***') cfg.webhook.telegram.token = telegram.token;
    if (telegram.chatId != null) cfg.webhook.telegram.chatId = String(telegram.chatId);
    if (telegram.url != null) cfg.webhook.telegram.url = telegram.url;
  }
  if (discord) {
    if (!cfg.webhook.discord) cfg.webhook.discord = {};
    if (discord.enabled != null) cfg.webhook.discord.enabled = !!discord.enabled;
    if (discord.url != null && discord.url !== '***configured***') cfg.webhook.discord.url = discord.url;
  }
  if (http) {
    if (!cfg.webhook.http) cfg.webhook.http = {};
    if (http.enabled != null) cfg.webhook.http.enabled = !!http.enabled;
    if (http.url != null) cfg.webhook.http.url = http.url;
  }
  config.save();
  res.json({ message: 'Webhook config updated', webhook: { enabled: cfg.webhook.enabled, notifyAlways: cfg.webhook.notifyAlways } });
});

// POST /admin/webhook/test — send test notification
router.post('/webhook/test', async (req, res) => {
  try {
    const { testWebhook } = require('../webhook');
    const results = await testWebhook();
    if (!results.length) return res.json({ message: 'No webhook channels enabled', results: [] });
    res.json({ message: 'Test sent', results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/balance — query all channel balances
router.get('/balance', async (req, res) => {
  try {
    const results = await queryAllBalances();
    // Cache each successful balance in _accountMeta
    for (const r of results) {
      if (r.ok) {
        const ch = config.getChannel(r.channelId);
        if (ch) {
          const meta = ch._accountMeta || {};
          meta.lastBalance = { ok: true, total: r.total, used: r.used, remaining: r.remaining, percent: r.percent, queriedAt: Date.now() };
          config.updateChannel(ch.id, { _accountMeta: meta });
        }
      }
    }
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/balance/:channelId — query single channel balance
router.get('/balance/:channelId', async (req, res) => {
  const ch = config.getChannel(parseInt(req.params.channelId));
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  try {
    const result = await queryBalance(ch);
    // Cache balance in _accountMeta
    if (result.ok) {
      const meta = ch._accountMeta || {};
      meta.lastBalance = { ok: true, total: result.total, used: result.used, remaining: result.remaining, percent: result.percent, queriedAt: Date.now() };
      config.updateChannel(ch.id, { _accountMeta: meta });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// ── Config Export/Import ────────────────────────────────────────

router.get('/config/export', (req, res) => {
  const cfg = config.get();
  const exportData = JSON.parse(JSON.stringify(cfg));
  // Strip runtime fields
  for (const ch of exportData.channels || []) { delete ch._keyIndex; }
  delete exportData._nextId;
  res.setHeader('Content-Disposition', 'attachment; filename="gateapi-config.json"');
  res.setHeader('Content-Type', 'application/json');
  res.json(exportData);
});

router.post('/config/import', (req, res) => {
  const importData = req.body;
  if (!importData || !importData.server || !Array.isArray(importData.channels)) {
    return res.status(400).json({ error: 'Invalid config format: missing server or channels' });
  }
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, '..', '..', 'data', 'config.json');
    // Backup current config
    const backupPath = configPath + '.backup.' + Date.now();
    if (fs.existsSync(configPath)) fs.copyFileSync(configPath, backupPath);
    // Write new config
    fs.writeFileSync(configPath, JSON.stringify(importData, null, 2), 'utf8');
    // Reload
    config.load();
    const { startCron, stopCron } = require('../scheduler');
    stopCron(); startCron();
    res.json({ message: 'Config imported successfully', backup: backupPath, channels: config.getAllChannels().length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// PUT /admin/password — change admin password
router.put('/password', (req, res) => {
  const cfg = config.get();
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Missing fields' });
  if (oldPassword !== cfg.server.adminToken) return res.status(403).json({ error: 'Current password is incorrect' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'Password too short (min 4)' });
  cfg.server.adminToken = newPassword;
  config.save();
  res.json({ message: 'Password updated' });
});

// ══════════════════════════════════════════
// Account Hub APIs (independent from channels)
// ══════════════════════════════════════════

// GET /admin/accounts — list all accounts (sanitized)
router.get('/accounts', (req, res) => {
  res.json({ accounts: accounts.getAllSanitized() });
});

// POST /admin/accounts — add new account (auto-detect platform + login)
router.post('/accounts', async (req, res) => {
  const { siteUrl, username, password, siteLabel, color, notes, autoCheckin } = req.body;
  if (!siteUrl || !username || !password) {
    return res.status(400).json({ error: 'Missing required fields: siteUrl, username, password' });
  }
  try {
    const result = await accounts.addAccountFull(siteUrl, username, password, { siteLabel, color, notes, autoCheckin });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /admin/accounts/checkin-all — batch check-in (must be before :id routes)
router.post('/accounts/checkin-all', async (req, res) => {
  const all = accounts.getAll().filter(a => a.autoCheckin && a.platform === 'new-api');
  const results = [];
  for (const acct of all) {
    let token = acct.sessionToken;
    let authType = acct.authType || 'cookie';
    if (!token) {
      const pwd = accounts.decodePassword(acct.password);
      const login = await accounts.loginNewApi(acct.siteUrl, acct.username, pwd);
      if (!login.ok) { results.push({ id: acct.id, siteLabel: acct.siteLabel, ok: false, error: login.error }); continue; }
      token = login.token;
      authType = login.authType || 'cookie';
      const uid = login.userId || null;
      accounts.update(acct.id, { sessionToken: token, authType, userId: uid, lastLogin: Date.now() });
    }
    const r = await accounts.checkInNewApi(acct.siteUrl, token, authType, acct.userId);
    if (r.ok) accounts.update(acct.id, { lastCheckin: Date.now(), lastCheckinMsg: r.message });
    results.push({ id: acct.id, siteLabel: acct.siteLabel, ...r });
  }
  res.json({ results, total: results.length, ok: results.filter(r => r.ok).length });
});

// GET /admin/accounts/:id — get single account
router.get('/accounts/:id', (req, res) => {
  const acct = accounts.getById(parseInt(req.params.id));
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  res.json({ account: accounts._sanitize(acct) });
});

// PUT /admin/accounts/:id — update account metadata
router.put('/accounts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const acct = accounts.getById(id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  const { siteLabel, color, notes, autoCheckin } = req.body;
  const updates = {};
  if (siteLabel !== undefined) updates.siteLabel = siteLabel;
  if (color !== undefined) updates.color = color;
  if (notes !== undefined) updates.notes = notes;
  if (autoCheckin !== undefined) updates.autoCheckin = autoCheckin;
  const updated = accounts.update(id, updates);
  res.json({ ok: true, account: accounts._sanitize(updated) });
});

// DELETE /admin/accounts/:id — delete account
router.delete('/accounts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!accounts.getById(id)) return res.status(404).json({ error: 'Account not found' });
  accounts.remove(id);
  res.json({ ok: true, message: 'Account deleted' });
});

// POST /admin/accounts/:id/login — re-login to refresh session token
router.post('/accounts/:id/login', async (req, res) => {
  const id = parseInt(req.params.id);
  const acct = accounts.getById(id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  if (acct.platform !== 'new-api' && acct.platform !== 'sub2api') return res.status(400).json({ error: 'Login not supported for this platform' });
  const pwd = accounts.decodePassword(acct.password);
  const result = acct.platform === 'sub2api'
    ? await accounts.loginSub2Api(acct.siteUrl, acct.username, pwd)
    : await accounts.loginNewApi(acct.siteUrl, acct.username, pwd);
  if (result.ok) {
    accounts.update(id, { sessionToken: result.token, authType: result.authType || 'cookie', userId: result.userId || null, lastLogin: Date.now(), loginError: null });
    res.json({ ok: true, message: 'Login successful' });
  } else {
    res.json({ ok: false, error: result.error });
  }
});

// POST /admin/accounts/:id/checkin — check in (New-API only)
router.post('/accounts/:id/checkin', async (req, res) => {
  const id = parseInt(req.params.id);
  const acct = accounts.getById(id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  if (acct.platform !== 'new-api') return res.status(400).json({ error: 'Check-in only supported for New-API platforms' });
  if (!acct.sessionToken) {
    // Try auto-login first
    const pwd = accounts.decodePassword(acct.password);
    const login = await accounts.loginNewApi(acct.siteUrl, acct.username, pwd);
    if (!login.ok) return res.json({ ok: false, error: 'Session expired, re-login failed: ' + login.error });
    accounts.update(id, { sessionToken: login.token, authType: login.authType || 'cookie', userId: login.userId || null, lastLogin: Date.now() });
    acct.sessionToken = login.token;
    acct.authType = login.authType || 'cookie';
    acct.userId = login.userId || null;
  }
  const result = await accounts.checkInNewApi(acct.siteUrl, acct.sessionToken, acct.authType, acct.userId);
  if (result.ok) {
    accounts.update(id, { lastCheckin: Date.now(), lastCheckinMsg: result.message });
  }
  res.json(result);
});

// GET /admin/accounts/:id/balance — query balance (New-API + Sub2API)
router.get('/accounts/:id/balance', async (req, res) => {
  const id = parseInt(req.params.id);
  const acct = accounts.getById(id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  if (acct.platform !== 'new-api' && acct.platform !== 'sub2api') return res.json({ ok: false, error: 'Balance query not supported for this platform' });
  if (!acct.sessionToken) {
    const pwd = accounts.decodePassword(acct.password);
    const login = acct.platform === 'sub2api'
      ? await accounts.loginSub2Api(acct.siteUrl, acct.username, pwd)
      : await accounts.loginNewApi(acct.siteUrl, acct.username, pwd);
    if (!login.ok) return res.json({ ok: false, error: 'Session expired, re-login failed: ' + login.error });
    accounts.update(id, { sessionToken: login.token, authType: login.authType || 'cookie', userId: login.userId || null, lastLogin: Date.now() });
    acct.sessionToken = login.token;
    acct.authType = login.authType || 'cookie';
    acct.userId = login.userId || null;
  }
  const info = acct.platform === 'sub2api'
    ? await accounts.queryUserInfoSub2Api(acct.siteUrl, acct.sessionToken)
    : await accounts.queryUserInfo(acct.siteUrl, acct.sessionToken, acct.authType, acct.userId);
  if (info.ok) {
    accounts.update(id, { lastBalance: { ok: true, total: info.total, used: info.used, remaining: info.remaining, percent: info.percent, queriedAt: Date.now() } });
  }
  res.json(info);
});

module.exports = router;
