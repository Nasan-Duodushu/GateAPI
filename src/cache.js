const crypto = require('crypto');

// ── LRU Cache with TTL for API response caching ──

const _cache = new Map(); // hash -> { data, ts, hits }
let _maxSize = 500;
let _ttlMs = 300000; // 5 min default
let _enabled = false;

function configure(opts) {
  if (opts.enabled != null) _enabled = !!opts.enabled;
  if (opts.maxSize != null) _maxSize = Math.max(1, Math.min(10000, parseInt(opts.maxSize)));
  if (opts.ttlSeconds != null) _ttlMs = Math.max(0, parseInt(opts.ttlSeconds)) * 1000;
}

function isEnabled() { return _enabled; }

function _hashKey(model, messages, params) {
  const payload = JSON.stringify({ model, messages, temperature: params.temperature, top_p: params.top_p, max_tokens: params.max_tokens });
  return crypto.createHash('md5').update(payload).digest('hex');
}

function get(model, messages, params) {
  if (!_enabled) return null;
  const key = _hashKey(model, messages, params);
  const entry = _cache.get(key);
  if (!entry) return null;
  if (_ttlMs === 0 || Date.now() - entry.ts > _ttlMs) {
    _cache.delete(key);
    return null;
  }
  entry.hits++;
  // Move to end (LRU refresh)
  _cache.delete(key);
  _cache.set(key, entry);
  return entry.data;
}

function set(model, messages, params, data) {
  if (!_enabled) return;
  const key = _hashKey(model, messages, params);
  // Evict oldest if full
  if (_cache.size >= _maxSize) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(key, { data, ts: Date.now(), hits: 0 });
}

function clear() {
  const size = _cache.size;
  _cache.clear();
  return size;
}

function stats() {
  let totalHits = 0;
  let expired = 0;
  const now = Date.now();
  for (const [, entry] of _cache) {
    totalHits += entry.hits;
    if (now - entry.ts > _ttlMs) expired++;
  }
  return {
    enabled: _enabled,
    size: _cache.size,
    maxSize: _maxSize,
    ttlSeconds: Math.round(_ttlMs / 1000),
    totalHits,
    expired,
  };
}

module.exports = { configure, isEnabled, get, set, clear, stats };
