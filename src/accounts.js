const fs = require('fs');
const path = require('path');

const ACCOUNTS_PATH = path.join(__dirname, '..', 'data', 'accounts.json');

let _data = { accounts: [], _nextId: 1 };

// ── Persistence ──

function load() {
  try {
    if (fs.existsSync(ACCOUNTS_PATH)) {
      _data = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8'));
      if (!_data._nextId) {
        _data._nextId = (_data.accounts || []).reduce((max, a) => Math.max(max, a.id || 0), 0) + 1;
      }
    }
  } catch (e) {
    console.log('[accounts] Failed to load accounts.json, starting fresh:', e.message);
    _data = { accounts: [], _nextId: 1 };
  }
  console.log(`[accounts] Loaded ${_data.accounts.length} accounts`);
}

function save() {
  const dir = path.dirname(ACCOUNTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const toSave = JSON.parse(JSON.stringify(_data));
  delete toSave._nextId;
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(toSave, null, 2), 'utf8');
}

// ── Password encoding (simple base64, not encryption) ──

function encodePassword(plain) { return Buffer.from(plain).toString('base64'); }
function decodePassword(encoded) { return Buffer.from(encoded, 'base64').toString('utf8'); }

// ── Platform Detection ──

async function detectPlatform(siteUrl) {
  const base = siteUrl.replace(/\/+$/, '');

  // Try New-API status endpoint
  try {
    const r = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json();
      // New-API /api/status typically returns {success: true, data: {...}} or system_name field
      if (d.success || d.data?.system_name || d.data?.version) {
        return 'new-api';
      }
    }
  } catch (_) {}

  // Try New-API login page indicator
  try {
    const r = await fetch(`${base}/api/user/self`, { signal: AbortSignal.timeout(5000) });
    // 401 means it exists but needs auth → New-API
    if (r.status === 401 || r.status === 403) {
      return 'new-api';
    }
  } catch (_) {}

  // Try Sub2API auth endpoint
  try {
    const r = await fetch(`${base}/api/v1/auth/me`, { signal: AbortSignal.timeout(5000) });
    if (r.status === 401 || r.status === 403) {
      return 'sub2api';
    }
  } catch (_) {}

  return 'unknown';
}

// ── New-API Login ──

async function loginNewApi(siteUrl, username, password) {
  const base = siteUrl.replace(/\/+$/, '');
  try {
    const resp = await fetch(`${base}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
    });
    const d = await resp.json();
    if (!resp.ok && resp.status !== 302) {
      return { ok: false, error: d.message || `HTTP ${resp.status}` };
    }
    if (d.success === false) {
      return { ok: false, error: d.message || 'Login failed' };
    }

    const userId = d.data?.id || null;

    // Priority 1: Extract session cookie from Set-Cookie header
    const setCookie = resp.headers.get('set-cookie') || '';
    const sessionMatch = setCookie.match(/session=([^;]+)/);
    if (sessionMatch) {
      return { ok: true, token: sessionMatch[1], authType: 'cookie', userId };
    }

    // Priority 2: Token in JSON body (some New-API forks)
    const token = d.data?.token || d.token;
    if (token && typeof token === 'string') {
      return { ok: true, token, authType: 'bearer', userId };
    }

    return { ok: false, error: 'Login succeeded but no session cookie or token found' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── New-API: Query User Info (balance + API key) ──

async function queryUserInfo(siteUrl, sessionToken, authType, userId) {
  const base = siteUrl.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (authType === 'cookie') {
    headers['Cookie'] = `session=${sessionToken}`;
  } else {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }
  if (userId) headers['New-Api-User'] = String(userId);
  try {
    const resp = await fetch(`${base}/api/user/self`, { headers, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const d = await resp.json();
    if (!d.success && !d.data) return { ok: false, error: d.message || 'Invalid response' };
    const user = d.data || d;
    const quota = user.quota ?? 0;
    const usedQuota = user.used_quota ?? 0;
    // New-API: quota = remaining balance, used_quota = historical usage
    const remaining = quota / 500000;
    const used = usedQuota / 500000;
    const total = remaining + used;
    return {
      ok: true,
      total,
      used,
      remaining,
      percent: total > 0 ? Math.round(used / total * 100) : 0,
      unit: 'USD',
      username: user.username || user.display_name || '',
      email: user.email || '',
      apiKey: user.access_token || user.token || null,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── New-API: Check-in ──

async function checkInNewApi(siteUrl, sessionToken, authType, userId) {
  const base = siteUrl.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (authType === 'cookie') {
    headers['Cookie'] = `session=${sessionToken}`;
  } else {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }
  if (userId) headers['New-Api-User'] = String(userId);
  try {
    const resp = await fetch(`${base}/api/user/check_in`, {
      method: 'POST', headers, signal: AbortSignal.timeout(10000),
    });
    const d = await resp.json();
    if (d.success === false) {
      return { ok: false, error: d.message || 'Check-in failed' };
    }
    return { ok: true, message: d.message || 'Check-in successful', data: d.data || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Sub2API Login ──

async function loginSub2Api(siteUrl, email, password) {
  const base = siteUrl.replace(/\/+$/, '');
  try {
    const resp = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000),
    });
    const d = await resp.json();
    if (!resp.ok || d.code !== 0) {
      return { ok: false, error: d.message || `HTTP ${resp.status}` };
    }
    const token = d.data?.access_token;
    const userId = d.data?.user?.id || null;
    if (!token) {
      return { ok: false, error: 'No access_token in response' };
    }
    return { ok: true, token, authType: 'bearer', userId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Sub2API: Query User Info (balance) ──

async function queryUserInfoSub2Api(siteUrl, token) {
  const base = siteUrl.replace(/\/+$/, '');
  try {
    const resp = await fetch(`${base}/api/v1/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const d = await resp.json();
    if (d.code !== 0 || !d.data) return { ok: false, error: d.message || 'Invalid response' };
    const user = d.data;
    const balance = user.balance ?? 0;
    return {
      ok: true,
      total: balance,
      used: 0,
      remaining: balance,
      percent: 0,
      unit: 'USD',
      username: user.username || user.email || '',
      email: user.email || '',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── CRUD ──

function getAll() { return _data.accounts; }

function getById(id) { return _data.accounts.find(a => a.id === id) || null; }

function add(account) {
  account.id = _data._nextId++;
  account.createdAt = Date.now();
  account.password = encodePassword(account.password || '');
  if (!account.platform) account.platform = 'unknown';
  _data.accounts.push(account);
  save();
  return account;
}

function update(id, updates) {
  const acct = _data.accounts.find(a => a.id === id);
  if (!acct) return null;
  if (updates.password !== undefined) {
    updates.password = encodePassword(updates.password);
  }
  Object.assign(acct, updates);
  acct.id = id;
  save();
  return acct;
}

function remove(id) {
  const idx = _data.accounts.findIndex(a => a.id === id);
  if (idx === -1) return false;
  _data.accounts.splice(idx, 1);
  save();
  return true;
}

// ── High-level: Add account with auto-detection and login ──

async function addAccountFull(siteUrl, username, password, opts = {}) {
  const base = siteUrl.replace(/\/+$/, '').replace(/\/v1\/?$/, '');

  // Step 1: Detect platform
  const platform = await detectPlatform(base);

  const acct = {
    siteUrl: base,
    username,
    password,
    platform,
    sessionToken: null,
    siteLabel: opts.siteLabel || base.replace(/^https?:\/\//, ''),
    color: opts.color || '#6366f1',
    notes: opts.notes || '',
    autoCheckin: opts.autoCheckin || false,
    lastCheckin: null,
    lastCheckinMsg: '',
    lastBalance: null,
    lastLogin: null,
    channelId: opts.channelId || null,
  };

  // Step 2: Try login based on platform
  let loginResult = null;
  if (platform === 'new-api') {
    loginResult = await loginNewApi(base, username, password);
  } else if (platform === 'sub2api') {
    loginResult = await loginSub2Api(base, username, password);
  }

  if (loginResult) {
    if (loginResult.ok) {
      acct.sessionToken = loginResult.token;
      acct.authType = loginResult.authType || 'cookie';
      acct.userId = loginResult.userId || null;
      acct.lastLogin = Date.now();
      // Step 3: Try getting user info (balance)
      const info = platform === 'sub2api'
        ? await queryUserInfoSub2Api(base, loginResult.token)
        : await queryUserInfo(base, loginResult.token, acct.authType, acct.userId);
      if (info.ok) {
        acct.lastBalance = { ok: true, total: info.total, used: info.used, remaining: info.remaining, percent: info.percent, queriedAt: Date.now() };
      }
    } else {
      acct.loginError = loginResult.error;
    }
  }

  const saved = add(acct);
  return { account: _sanitize(saved), platform, loginOk: !!acct.sessionToken };
}

// ── Sanitize (hide sensitive fields) ──

function _sanitize(acct) {
  if (!acct) return null;
  const copy = { ...acct };
  delete copy.password;
  if (copy.sessionToken) copy.sessionToken = '***';
  return copy;
}

function getAllSanitized() {
  return _data.accounts.map(_sanitize);
}

// ── Keep-alive & balance sync cron ──

let _cronTimer = null;
const KEEPALIVE_INTERVAL = 30 * 60 * 1000; // 30 minutes

async function refreshAccount(acct) {
  const pwd = decodePassword(acct.password);
  let token = acct.sessionToken;
  let authType = acct.authType || 'cookie';
  let userId = acct.userId || null;

  // Re-login to refresh session
  let login;
  if (acct.platform === 'new-api') {
    login = await loginNewApi(acct.siteUrl, acct.username, pwd);
  } else if (acct.platform === 'sub2api') {
    login = await loginSub2Api(acct.siteUrl, acct.username, pwd);
  } else {
    return;
  }

  if (login.ok) {
    token = login.token;
    authType = login.authType || 'cookie';
    userId = login.userId || null;
    update(acct.id, { sessionToken: token, authType, userId, lastLogin: Date.now(), loginError: null });
  } else {
    update(acct.id, { loginError: login.error });
    return;
  }

  // Query balance
  const info = acct.platform === 'sub2api'
    ? await queryUserInfoSub2Api(acct.siteUrl, token)
    : await queryUserInfo(acct.siteUrl, token, authType, userId);
  if (info.ok) {
    update(acct.id, { lastBalance: { ok: true, total: info.total, used: info.used, remaining: info.remaining, percent: info.percent, queriedAt: Date.now() } });
  }
}

async function refreshAllAccounts() {
  const all = _data.accounts.filter(a => a.platform === 'new-api' || a.platform === 'sub2api');
  if (all.length === 0) return;
  console.log(`[accounts] Keep-alive: refreshing ${all.length} accounts...`);
  for (const acct of all) {
    try {
      await refreshAccount(acct);
    } catch (e) {
      console.log(`[accounts] Keep-alive error for ${acct.siteLabel}: ${e.message}`);
    }
  }
  console.log(`[accounts] Keep-alive done.`);
}

function startKeepAlive() {
  if (_cronTimer) return;
  _cronTimer = setInterval(refreshAllAccounts, KEEPALIVE_INTERVAL);
  // Also run once after 10s on startup
  setTimeout(refreshAllAccounts, 10000);
  console.log(`[accounts] Keep-alive started (every ${KEEPALIVE_INTERVAL / 60000}min)`);
}

function stopKeepAlive() {
  if (_cronTimer) { clearInterval(_cronTimer); _cronTimer = null; }
}

module.exports = {
  load, save, getAll, getAllSanitized, getById, add, update, remove,
  detectPlatform, loginNewApi, queryUserInfo, checkInNewApi,
  loginSub2Api, queryUserInfoSub2Api,
  addAccountFull, decodePassword, encodePassword, _sanitize,
  refreshAccount, refreshAllAccounts, startKeepAlive, stopKeepAlive,
};
