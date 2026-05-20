const config = require('../config');

// ── Latency tracking (rolling average, last 20 requests) ──
const _latency = new Map(); // channelId -> { samples: number[], avg: number }
const LATENCY_WINDOW = 20;

function recordLatency(channelId, ms) {
  if (!_latency.has(channelId)) _latency.set(channelId, { samples: [], avg: 0 });
  const entry = _latency.get(channelId);
  entry.samples.push(ms);
  if (entry.samples.length > LATENCY_WINDOW) entry.samples.shift();
  entry.avg = Math.round(entry.samples.reduce((a, b) => a + b, 0) / entry.samples.length);
}

function getLatency(channelId) {
  return _latency.get(channelId)?.avg || 0;
}

// ── Error rate tracking (sliding window, last 50 calls) ──
const _errorRate = new Map(); // channelId -> { samples: boolean[], successCount: number }
const ERROR_WINDOW = 50;

function recordResult(channelId, success) {
  if (!_errorRate.has(channelId)) _errorRate.set(channelId, { samples: [], successCount: 0 });
  const entry = _errorRate.get(channelId);
  entry.samples.push(success);
  if (success) entry.successCount++;
  if (entry.samples.length > ERROR_WINDOW) {
    const removed = entry.samples.shift();
    if (removed) entry.successCount--;
  }
}

function getErrorRate(channelId) {
  const entry = _errorRate.get(channelId);
  if (!entry || !entry.samples.length) return 0;
  return 1 - (entry.successCount / entry.samples.length);
}

// ── 429 Rate limit tracking ──
const _rateLimits = new Map(); // channelId -> { count: number, cooldownUntil: number }
const RL_COOLDOWN_BASE = 30000; // 30s base cooldown
const RL_COOLDOWN_MAX = 300000; // 5 min max

function record429(channelId) {
  if (!_rateLimits.has(channelId)) _rateLimits.set(channelId, { count: 0, cooldownUntil: 0 });
  const rl = _rateLimits.get(channelId);
  rl.count++;
  // Exponential backoff: 30s, 60s, 120s, 240s, max 300s
  const cooldown = Math.min(RL_COOLDOWN_BASE * Math.pow(2, rl.count - 1), RL_COOLDOWN_MAX);
  rl.cooldownUntil = Date.now() + cooldown;
  console.log(`[429] CH${channelId} rate limited, cooldown ${Math.round(cooldown/1000)}s (hit #${rl.count})`);
}

function clear429(channelId) {
  const rl = _rateLimits.get(channelId);
  if (rl) { rl.count = 0; rl.cooldownUntil = 0; }
}

function isRateLimited(channelId) {
  const rl = _rateLimits.get(channelId);
  if (!rl) return false;
  if (Date.now() >= rl.cooldownUntil) { rl.count = 0; rl.cooldownUntil = 0; return false; }
  return true;
}

// ── Sticky session LRU cache ──
const _sticky = new Map(); // "userId:model" -> { channelId, ts }
const STICKY_TTL = 600000; // 10 min
const STICKY_MAX = 5000;

function _stickyKey(userId, model) { return `${userId}:${model}`; }

function getStickyChannel(userId, model) {
  if (!userId) return null;
  const key = _stickyKey(userId, model);
  const entry = _sticky.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > STICKY_TTL) { _sticky.delete(key); return null; }
  // Refresh timestamp on access
  entry.ts = Date.now();
  return entry.channelId;
}

function setStickyChannel(userId, model, channelId) {
  if (!userId) return;
  const key = _stickyKey(userId, model);
  _sticky.set(key, { channelId, ts: Date.now() });
  // Evict oldest if too large
  if (_sticky.size > STICKY_MAX) {
    const oldest = _sticky.keys().next().value;
    _sticky.delete(oldest);
  }
}

// ── Dynamic weight: base weight adjusted by latency, 429 & error rate ──
function _effectiveWeight(ch) {
  let w = ch.weight || 1;
  // Latency penalty: if avg > 3000ms, halve weight; > 8000ms, quarter it
  const avg = getLatency(ch.id);
  if (avg > 8000) w *= 0.25;
  else if (avg > 3000) w *= 0.5;
  // Error rate penalty
  const errRate = getErrorRate(ch.id);
  if (errRate > 0.5) w *= 0.1;
  else if (errRate > 0.3) w *= 0.3;
  else if (errRate > 0.1) w *= 0.7;
  // 429 penalty: in cooldown → weight = 0 (skip)
  if (isRateLimited(ch.id)) return 0;
  return Math.max(0.1, w);
}

function selectChannel(model, userId) {
  const index = config.getModelIndex();
  const candidates = index.get(model);
  if (!candidates || !candidates.length) return null;

  // Sticky session: try to reuse previous channel
  if (userId) {
    const stickyId = getStickyChannel(userId, model);
    if (stickyId != null) {
      const stickyCh = candidates.find(ch => ch.id === stickyId && ch.status === 'enabled' && !isRateLimited(ch.id));
      if (stickyCh) return stickyCh;
    }
  }

  // Group by priority (higher = better)
  const groups = new Map();
  for (const ch of candidates) {
    if (ch.status !== 'enabled') continue;
    const p = ch.priority ?? 0;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(ch);
  }
  if (groups.size === 0) return null;

  // Sort priorities descending, try highest first
  const sorted = [...groups.keys()].sort((a, b) => b - a);

  for (const prio of sorted) {
    const group = groups.get(prio);
    const ch = _weightedRandom(group);
    if (ch) {
      setStickyChannel(userId, model, ch.id);
      return ch;
    }
  }
  return null;
}

function selectChannelWithRetry(model, excludeIds = [], userId) {
  const index = config.getModelIndex();
  const candidates = (index.get(model) || []).filter(ch => ch.status === 'enabled' && !excludeIds.includes(ch.id));
  if (!candidates.length) return null;

  const groups = new Map();
  for (const ch of candidates) {
    const p = ch.priority ?? 0;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(ch);
  }
  const sorted = [...groups.keys()].sort((a, b) => b - a);
  for (const prio of sorted) {
    const ch = _weightedRandom(groups.get(prio));
    if (ch) {
      setStickyChannel(userId, model, ch.id);
      return ch;
    }
  }
  return null;
}

function _weightedRandom(channels) {
  if (!channels.length) return null;
  if (channels.length === 1) {
    return _effectiveWeight(channels[0]) > 0 ? channels[0] : null;
  }
  // Filter out zero-weight (rate-limited) channels
  const viable = channels.filter(ch => _effectiveWeight(ch) > 0);
  if (!viable.length) return null;
  if (viable.length === 1) return viable[0];
  const totalWeight = viable.reduce((sum, ch) => sum + _effectiveWeight(ch), 0);
  let rand = Math.random() * totalWeight;
  for (const ch of viable) {
    rand -= _effectiveWeight(ch);
    if (rand <= 0) return ch;
  }
  return viable[viable.length - 1];
}

function nextKey(channel) {
  const keys = channel.keys;
  if (!keys.length) return null;
  const key = keys[channel._keyIndex % keys.length];
  channel._keyIndex = (channel._keyIndex + 1) % keys.length;
  return key;
}

function resolveModel(model, channel) {
  // 1. Explicit model mapping takes highest priority
  if (channel.modelMapping && channel.modelMapping[model]) {
    return channel.modelMapping[model];
  }
  // 2. If the channel has this exact model name, use it directly
  if (channel.models.includes(model)) return model;
  // 3. Alias: find which variant name the channel actually has
  const cfg = require('../config');
  const aliases = cfg.get().modelAliases || {};
  const variants = aliases[model] || [];
  for (const v of variants) {
    if (channel.models.includes(v)) return v;
  }
  // 4. Fallback: use the requested name as-is
  return model;
}

// ── Stats export for dashboard ──
function getRoutingStats() {
  const latencies = {};
  for (const [id, entry] of _latency) latencies[id] = entry.avg;
  const rateLimits = {};
  for (const [id, rl] of _rateLimits) {
    if (rl.cooldownUntil > Date.now()) rateLimits[id] = { count: rl.count, cooldownRemaining: Math.round((rl.cooldownUntil - Date.now()) / 1000) };
  }
  const errorRates = {};
  for (const [id, entry] of _errorRate) {
    if (entry.samples.length) errorRates[id] = { rate: Math.round(getErrorRate(id) * 1000) / 1000, samples: entry.samples.length };
  }
  return { latencies, rateLimits, errorRates, stickySessions: _sticky.size };
}

module.exports = { selectChannel, selectChannelWithRetry, nextKey, resolveModel, recordLatency, getLatency, record429, clear429, isRateLimited, recordResult, getErrorRate, getRoutingStats };
