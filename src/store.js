const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let db = null;

function init() {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, 'gateapi.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      model TEXT NOT NULL,
      channel_id INTEGER,
      channel_name TEXT,
      status_code INTEGER,
      duration_ms INTEGER,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      stream INTEGER DEFAULT 0,
      error TEXT,
      user_id INTEGER DEFAULT 0,
      api_key_id INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_logs_ts ON request_logs(ts);
    CREATE INDEX IF NOT EXISTS idx_logs_model ON request_logs(model);
    CREATE INDEX IF NOT EXISTS idx_logs_channel ON request_logs(channel_id);
    CREATE INDEX IF NOT EXISTS idx_logs_user ON request_logs(user_id);

    CREATE TABLE IF NOT EXISTS detect_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      score INTEGER,
      status TEXT,
      suspect TEXT,
      probes TEXT,
      family TEXT,
      tier TEXT,
      verdict TEXT,
      claimed_family TEXT,
      suspect_family TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_detect_ch ON detect_results(channel_id);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'active',
      quota_total INTEGER DEFAULT -1,
      quota_used INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name ON users(username);

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      name TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      quota_total INTEGER DEFAULT -1,
      quota_used INTEGER DEFAULT 0,
      rate_limit INTEGER DEFAULT 60,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_apikeys_key ON api_keys(key);
    CREATE INDEX IF NOT EXISTS idx_apikeys_user ON api_keys(user_id);
  `);
  // Ensure system user exists for standalone API keys (user_id=0)
  const now = Date.now();
  db.prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, salt, role, status, quota_total, quota_used, created_at, updated_at) VALUES (0, '__system__', '', '', 'system', 'active', -1, 0, ?, ?)`).run(now, now);

  // Migration: add columns to existing tables
  const cols = db.pragma('table_info(request_logs)').map(c => c.name);
  if (!cols.includes('user_id')) db.exec('ALTER TABLE request_logs ADD COLUMN user_id INTEGER DEFAULT 0');
  if (!cols.includes('api_key_id')) db.exec('ALTER TABLE request_logs ADD COLUMN api_key_id INTEGER DEFAULT 0');
  // Migration: add new columns to detect_results
  const detCols = db.pragma('table_info(detect_results)').map(c => c.name);
  if (!detCols.includes('verdict')) db.exec('ALTER TABLE detect_results ADD COLUMN verdict TEXT');
  if (!detCols.includes('claimed_family')) db.exec('ALTER TABLE detect_results ADD COLUMN claimed_family TEXT');
  if (!detCols.includes('suspect_family')) db.exec('ALTER TABLE detect_results ADD COLUMN suspect_family TEXT');
  console.log('[store] SQLite initialized');
}

const _insertLog = () => db.prepare(`
  INSERT INTO request_logs (ts, model, channel_id, channel_name, status_code, duration_ms, prompt_tokens, completion_tokens, stream, error, user_id, api_key_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let _insertLogStmt = null;

function logRequest(data) {
  if (!_insertLogStmt) _insertLogStmt = _insertLog();
  try {
    _insertLogStmt.run(
      Date.now(), data.model || '', data.channelId || 0, data.channelName || '',
      data.statusCode || 0, data.durationMs || 0,
      data.promptTokens || 0, data.completionTokens || 0,
      data.stream ? 1 : 0, data.error || null,
      data.userId || 0, data.apiKeyId || 0
    );
  } catch (e) {
    console.error('[store] logRequest error:', e.message);
  }
}

function getStats(hours = 24) {
  const since = Date.now() - hours * 3600000;
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as failed,
      AVG(duration_ms) as avg_duration,
      SUM(prompt_tokens) as total_prompt_tokens,
      SUM(completion_tokens) as total_completion_tokens
    FROM request_logs WHERE ts > ?
  `).get(since);

  const byModel = db.prepare(`
    SELECT model, COUNT(*) as count,
      SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as success,
      AVG(duration_ms) as avg_duration
    FROM request_logs WHERE ts > ? GROUP BY model ORDER BY count DESC LIMIT 20
  `).all(since);

  const byChannel = db.prepare(`
    SELECT channel_id, channel_name, COUNT(*) as count,
      SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as success,
      AVG(duration_ms) as avg_duration
    FROM request_logs WHERE ts > ? GROUP BY channel_id ORDER BY count DESC
  `).all(since);

  return { since, summary, byModel, byChannel };
}

function getRecentLogs(limit = 50) {
  return db.prepare(`
    SELECT * FROM request_logs ORDER BY ts DESC LIMIT ?
  `).all(limit);
}

function saveDetectResult(data) {
  db.prepare(`
    INSERT INTO detect_results (ts, channel_id, model, score, status, suspect, probes, family, tier, verdict, claimed_family, suspect_family)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Date.now(), data.channelId, data.model,
    data.score ?? null, data.status || '', data.suspect || '',
    JSON.stringify(data.probes || {}), data.family || '', data.tier || '',
    data.verdict || '', data.claimedFamily || '', data.suspectFamily || ''
  );
}

function getDetectResults(channelId) {
  return db.prepare(`
    SELECT * FROM detect_results WHERE channel_id = ? ORDER BY ts DESC LIMIT 50
  `).all(channelId);
}

// ── User management ──
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(derived.toString('hex'));
    });
  });
}

async function createUser(username, password, opts = {}) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  const now = Date.now();
  const stmt = db.prepare(`INSERT INTO users (username, password_hash, salt, role, status, quota_total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(username, hash, salt, opts.role || 'user', 'active', opts.quota ?? -1, now, now);
  return { id: info.lastInsertRowid, username, role: opts.role || 'user' };
}

async function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  const hash = await hashPassword(password, user.salt);
  return hash === user.password_hash ? user : null;
}

function getUser(id) { return db.prepare('SELECT id,username,role,status,quota_total,quota_used,created_at,updated_at FROM users WHERE id=?').get(id); }
function getUserByName(name) { return db.prepare('SELECT id,username,role,status,quota_total,quota_used,created_at,updated_at FROM users WHERE username=?').get(name); }
function listUsers() { return db.prepare('SELECT id,username,role,status,quota_total,quota_used,created_at,updated_at FROM users ORDER BY id').all(); }
function updateUser(id, data) {
  const fields = [];
  const vals = [];
  for (const k of ['role','status','quota_total']) {
    if (data[k] !== undefined) { fields.push(`${k}=?`); vals.push(data[k]); }
  }
  if (!fields.length) return null;
  fields.push('updated_at=?'); vals.push(Date.now()); vals.push(id);
  db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...vals);
  return getUser(id);
}
function deleteUser(id) {
  db.prepare('DELETE FROM api_keys WHERE user_id=?').run(id);
  return db.prepare('DELETE FROM users WHERE id=?').run(id).changes > 0;
}

// ── API Key management ──
function generateApiKey() { return 'sk-tg-' + crypto.randomBytes(24).toString('hex'); }

function createApiKey(opts = {}) {
  const key = generateApiKey();
  const now = Date.now();
  const stmt = db.prepare(`INSERT INTO api_keys (key, user_id, name, status, quota_total, rate_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(key, 0, opts.name || '', 'active', opts.quota ?? -1, opts.rateLimit ?? 60, now);
  return { id: info.lastInsertRowid, key, name: opts.name || '' };
}

function getApiKeyByKey(key) { return db.prepare('SELECT * FROM api_keys WHERE key=?').get(key); }
function listAllApiKeys() {
  return db.prepare(`SELECT id, key, substr(key,1,12)||'...'||substr(key,-4) as key_preview, name, status, quota_total, quota_used, rate_limit, created_at, last_used_at FROM api_keys ORDER BY id`).all();
}
function updateApiKey(id, data) {
  const fields = [];
  const vals = [];
  for (const k of ['name','status','quota_total','rate_limit']) {
    if (data[k] !== undefined) { fields.push(`${k}=?`); vals.push(data[k]); }
  }
  if (!fields.length) return null;
  vals.push(id);
  db.prepare(`UPDATE api_keys SET ${fields.join(',')} WHERE id=?`).run(...vals);
  return db.prepare('SELECT * FROM api_keys WHERE id=?').get(id);
}
function getApiKey(id) { return db.prepare('SELECT id, substr(key,1,12)||\'...\'||substr(key,-4) as key_preview, user_id, name, status, quota_total, quota_used, rate_limit, created_at, last_used_at FROM api_keys WHERE id=?').get(id); }
function deleteApiKey(id) { return db.prepare('DELETE FROM api_keys WHERE id=?').run(id).changes > 0; }

async function resetPassword(userId, newPassword) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPassword(newPassword, salt);
  db.prepare('UPDATE users SET password_hash=?, salt=?, updated_at=? WHERE id=?').run(hash, salt, Date.now(), userId);
  return true;
}

function consumeQuota(apiKeyRow, promptTokens, completionTokens) {
  const total = promptTokens + completionTokens;
  db.prepare('UPDATE api_keys SET quota_used = quota_used + ?, last_used_at = ? WHERE id = ?').run(total, Date.now(), apiKeyRow.id);
}

function checkQuota(apiKeyRow) {
  if (apiKeyRow.status !== 'active') return { ok: false, reason: 'Key disabled' };
  if (apiKeyRow.quota_total > 0 && apiKeyRow.quota_used >= apiKeyRow.quota_total) return { ok: false, reason: 'Key quota exceeded' };
  return { ok: true };
}

function getUsageStats(userId, hours = 24) {
  const since = Date.now() - hours * 3600000;
  return db.prepare(`
    SELECT model, COUNT(*) as count,
      SUM(prompt_tokens) as prompt_tokens,
      SUM(completion_tokens) as completion_tokens,
      AVG(duration_ms) as avg_duration
    FROM request_logs WHERE ts > ? AND user_id = ? GROUP BY model ORDER BY count DESC
  `).all(since, userId);
}

// ── Enhanced statistics for dashboard charts ──

function getHourlyStats(hours = 24) {
  const since = Date.now() - hours * 3600000;
  return db.prepare(`
    SELECT
      CAST((ts / 3600000) AS INTEGER) * 3600000 as hour_ts,
      COUNT(*) as total,
      SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as failed,
      AVG(duration_ms) as avg_duration,
      SUM(prompt_tokens + completion_tokens) as total_tokens
    FROM request_logs WHERE ts > ?
    GROUP BY hour_ts ORDER BY hour_ts
  `).all(since);
}

function getUsageByModel(hours = 168) {
  const since = Date.now() - hours * 3600000;
  return db.prepare(`
    SELECT model,
      COUNT(*) as count,
      SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as success,
      AVG(duration_ms) as avg_duration,
      SUM(prompt_tokens) as prompt_tokens,
      SUM(completion_tokens) as completion_tokens,
      SUM(prompt_tokens + completion_tokens) as total_tokens
    FROM request_logs WHERE ts > ?
    GROUP BY model ORDER BY total_tokens DESC
  `).all(since);
}

function getUsageByChannel(hours = 168) {
  const since = Date.now() - hours * 3600000;
  return db.prepare(`
    SELECT channel_id, channel_name,
      COUNT(*) as count,
      SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as success,
      AVG(duration_ms) as avg_duration,
      SUM(prompt_tokens) as prompt_tokens,
      SUM(completion_tokens) as completion_tokens,
      SUM(prompt_tokens + completion_tokens) as total_tokens
    FROM request_logs WHERE ts > ?
    GROUP BY channel_id ORDER BY total_tokens DESC
  `).all(since);
}

function getDailyUsage(days = 30) {
  const since = Date.now() - days * 86400000;
  return db.prepare(`
    SELECT
      CAST((ts / 86400000) AS INTEGER) * 86400000 as day_ts,
      COUNT(*) as total,
      SUM(CASE WHEN error IS NULL THEN 1 ELSE 0 END) as success,
      SUM(prompt_tokens) as prompt_tokens,
      SUM(completion_tokens) as completion_tokens,
      SUM(prompt_tokens + completion_tokens) as total_tokens,
      AVG(duration_ms) as avg_duration
    FROM request_logs WHERE ts > ?
    GROUP BY day_ts ORDER BY day_ts
  `).all(since);
}

function getDB() { return db; }

module.exports = {
  init, logRequest, getStats, getRecentLogs, saveDetectResult, getDetectResults, getDB,
  createUser, verifyUser, getUser, getUserByName, listUsers, updateUser, deleteUser, resetPassword,
  createApiKey, getApiKeyByKey, getApiKey, listAllApiKeys, updateApiKey, deleteApiKey,
  consumeQuota, checkQuota, hashPassword,
  getHourlyStats, getUsageByModel, getUsageByChannel, getDailyUsage
};
