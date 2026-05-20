const express = require('express');
const config = require('./config');
const store = require('./store');
const cache = require('./cache');
const { selectChannel, selectChannelWithRetry } = require('./relay/distributor');
const { forward } = require('./relay/forwarder');

const router = express.Router();

// ── Rate limiter (sliding window, per API key) ──
const _rateBuckets = new Map(); // keyId -> [timestamps]
const RATE_WINDOW_MS = 60000;

function checkRateLimit(keyId, limit) {
  if (limit <= 0) return true;
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  let bucket = _rateBuckets.get(keyId);
  if (!bucket) { bucket = []; _rateBuckets.set(keyId, bucket); }
  // Prune old entries
  while (bucket.length && bucket[0] < cutoff) bucket.shift();
  if (bucket.length >= limit) return false;
  bucket.push(now);
  return true;
}
// Cleanup stale buckets every 5 min
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [k, b] of _rateBuckets) { if (!b.length || b[b.length-1] < cutoff) _rateBuckets.delete(k); }
}, 300000);

// Auth middleware: supports config apiKeys (legacy) + DB api_keys (with quota + rate limit)
function apiAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: { message: 'Missing API key', type: 'authentication_error' } });

  // Legacy: config-based keys (no quota, no rate limit)
  const cfg = config.get();
  if (cfg.server.apiKeys.includes(token)) {
    req._apiKeyId = 0;
    req._apiKeyRow = null;
    return next();
  }

  // DB-based key
  const keyRow = store.getApiKeyByKey(token);
  if (!keyRow) return res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });

  const quota = store.checkQuota(keyRow);
  if (!quota.ok) return res.status(429).json({ error: { message: quota.reason, type: 'quota_exceeded' } });

  if (!checkRateLimit(keyRow.id, keyRow.rate_limit)) {
    return res.status(429).json({ error: { message: `Rate limit exceeded (${keyRow.rate_limit}/min)`, type: 'rate_limit_exceeded' } });
  }

  req._apiKeyId = keyRow.id;
  req._apiKeyRow = keyRow;
  next();
}

// GET /v1/models
router.get('/v1/models', apiAuth, (req, res) => {
  const models = config.getAllModels();
  res.json({
    object: 'list',
    data: models.map(id => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'gateapi'
    }))
  });
});

// POST /v1/chat/completions
router.post('/v1/chat/completions', apiAuth, express.json({ limit: '10mb' }), async (req, res) => {
  const model = req.body?.model;
  if (!model) return res.status(400).json({ error: { message: 'Missing "model" in request body', type: 'invalid_request_error' } });

  // Cache lookup (non-streaming only)
  const isStream = req.body.stream;
  if (!isStream && cache.isEnabled()) {
    const cached = cache.get(model, req.body.messages, req.body);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }
  }

  // Hook to capture response for caching
  if (!isStream && cache.isEnabled()) {
    const origJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode === 200 && data && !data.error) {
        cache.set(model, req.body.messages, req.body, data);
      }
      res.setHeader('X-Cache', 'MISS');
      return origJson(data);
    };
  }

  const cfg = config.get();
  const maxRetries = cfg.relay.retryTimes || 0;
  const retryOn = new Set(cfg.relay.retryOnStatusCodes || []);

  // Build model chain: [primary, ...fallbacks]
  const fallbacks = cfg.modelFallback || {};
  const modelChain = [model, ...(fallbacks[model] || [])];

  for (const currentModel of modelChain) {
    const excludeIds = [];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const channel = attempt === 0
        ? selectChannel(currentModel)
        : selectChannelWithRetry(currentModel, excludeIds);

      if (!channel) break; // no channel for this model, try next in chain

      // Override request model for fallback
      const origModel = req.body.model;
      req.body.model = currentModel;
      const result = await forward(req, res, channel, currentModel);
      req.body.model = origModel;

      if (res.headersSent || res.writableEnded) return;
      if (result.ok || !retryOn.has(result.status)) return;

      excludeIds.push(channel.id);
      console.log(`[relay] Retry ${attempt + 1}/${maxRetries} for model=${currentModel}, excluding channel ${channel.id}`);
    }
    if (currentModel !== model) {
      console.log(`[relay] Fallback model=${currentModel} exhausted, trying next`);
    }
  }

  // All models in chain exhausted
  if (!res.headersSent && !res.writableEnded) {
    const tried = modelChain.length > 1 ? ` (chain: ${modelChain.join(' → ')})` : '';
    res.status(502).json({ error: { message: `All channels failed for model "${model}"${tried}`, type: 'upstream_error' } });
  }
});

// POST /v1/messages (Anthropic native endpoint)
// Accepts Anthropic protocol, converts internally, routes through the same channels
router.post('/v1/messages', apiAuth, express.json({ limit: '10mb' }), async (req, res) => {
  const model = req.body?.model;
  if (!model) return res.status(400).json({ type: 'error', error: { type: 'invalid_request_error', message: 'Missing "model"' } });

  // Convert Anthropic request → OpenAI internal format for routing
  const msgs = [];
  if (req.body.system) msgs.push({ role: 'system', content: req.body.system });
  for (const m of (req.body.messages || [])) msgs.push(m);
  req.body = {
    model,
    messages: msgs,
    max_tokens: req.body.max_tokens || 4096,
    temperature: req.body.temperature,
    top_p: req.body.top_p,
    stream: req.body.stream || false,
    stop: req.body.stop_sequences,
  };
  // Mark this request as needing Anthropic response format
  req._anthropicOutput = true;

  const cfg = config.get();
  const maxRetries = cfg.relay.retryTimes || 0;
  const retryOn = new Set(cfg.relay.retryOnStatusCodes || []);

  const fallbacks = cfg.modelFallback || {};
  const modelChain = [model, ...(fallbacks[model] || [])];

  for (const currentModel of modelChain) {
    const excludeIds = [];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const channel = attempt === 0
        ? selectChannel(currentModel)
        : selectChannelWithRetry(currentModel, excludeIds);

      if (!channel) break;

      const origModel = req.body.model;
      req.body.model = currentModel;
      const result = await forward(req, res, channel, currentModel);
      req.body.model = origModel;

      if (res.headersSent || res.writableEnded) return;
      if (result.ok || !retryOn.has(result.status)) return;
      excludeIds.push(channel.id);
    }
  }

  if (!res.headersSent && !res.writableEnded) {
    res.status(502).json({ type: 'error', error: { type: 'overloaded', message: `All channels failed for "${model}"` } });
  }
});

// POST /v1/embeddings (passthrough)
router.post('/v1/embeddings', apiAuth, express.json({ limit: '10mb' }), async (req, res) => {
  const model = req.body?.model;
  if (!model) return res.status(400).json({ error: { message: 'Missing "model"', type: 'invalid_request_error' } });
  const channel = selectChannel(model);
  if (!channel) return res.status(404).json({ error: { message: `No channel for "${model}"`, type: 'model_not_found' } });
  await forward(req, res, channel, model);
});

module.exports = router;
