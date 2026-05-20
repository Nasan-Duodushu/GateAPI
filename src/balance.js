const config = require('./config');

// ── Balance query adapters for different upstream API types ──

// New-API / One-API: GET /api/user/self → { data: { quota, used_quota } }
async function queryNewApi(endpoint, key) {
  const base = endpoint.replace(/\/v1\/?$/, '');
  // Try multiple auth methods (some forks only accept raw key, some need Bearer)
  const authHeaders = [
    { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    { 'Authorization': key, 'Content-Type': 'application/json' },
    { 'Authorization': `Bearer ${key}`, 'New-Api-User': 'true', 'Content-Type': 'application/json' },
  ];
  // Try multiple known endpoints
  const paths = ['/api/user/self', '/api/user/dashboard'];
  
  for (const path of paths) {
    for (const headers of authHeaders) {
      try {
        const resp = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(8000) });
        if (!resp.ok) continue;
        const d = await resp.json();
        if (d.data && (d.data.quota != null || d.data.balance != null)) {
          const quota = d.data.quota ?? d.data.total_balance ?? 0;
          const used = d.data.used_quota ?? d.data.used_balance ?? 0;
          // New-API quotas are in 1/500000 of a dollar
          return { total: quota / 500000, used: used / 500000, unit: 'USD', raw: d.data };
        }
      } catch (_) { continue; }
    }
  }
  throw new Error('New-API balance endpoint not accessible');
}

// OpenAI official: GET /v1/dashboard/billing/subscription + /usage
async function queryOpenAI(endpoint, key) {
  const base = endpoint.replace(/\/v1\/?$/, '');
  const headers = { 'Authorization': `Bearer ${key}` };
  const [subResp, usageResp] = await Promise.all([
    fetch(`${base}/v1/dashboard/billing/subscription`, { headers, signal: AbortSignal.timeout(10000) }),
    fetch(`${base}/v1/dashboard/billing/usage?start_date=${getDateStr(-90)}&end_date=${getDateStr(1)}`, { headers, signal: AbortSignal.timeout(10000) }),
  ]);
  if (!subResp.ok) throw new Error(`Subscription HTTP ${subResp.status}`);
  const sub = await subResp.json();
  let total = sub.hard_limit_usd || sub.system_hard_limit_usd || 0;
  let used = 0;
  if (usageResp.ok) {
    const u = await usageResp.json();
    used = (u.total_usage || 0) / 100; // cents to dollars
  }
  // Auto-detect New-API format: quotas stored as raw integers (1/500000 of a dollar)
  if (total > 1000000) {
    total = total / 500000;
    used = used > 1000000 ? used / 500000 : used;
  }
  return { total, used, unit: 'USD', raw: { subscription: sub } };
}

// CloseAI / compatible: GET /dashboard/billing/subscription
async function queryCloseAI(endpoint, key) {
  const base = endpoint.replace(/\/v1\/?$/, '');
  const headers = { 'Authorization': `Bearer ${key}` };
  const resp = await fetch(`${base}/dashboard/billing/subscription`, { headers, signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const d = await resp.json();
  return { total: d.hard_limit_usd || d.total_granted || 0, used: d.total_used || d.used || 0, unit: 'USD', raw: d };
}

function getDateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

// ── Main balance query function ──
async function queryBalance(channel) {
  const endpoint = channel.endpoint;
  const key = channel.keys[channel._keyIndex || 0];
  const explicitType = channel.balanceType;

  const adapters = {
    'new-api': queryNewApi,
    'one-api': queryNewApi,
    'openai': queryOpenAI,
    'close-ai': queryCloseAI,
  };

  // If explicit type set, use it directly
  if (explicitType && adapters[explicitType]) {
    return _tryAdapter(adapters[explicitType], endpoint, key, channel);
  }

  // Auto-detect: only try New-API (most transit stations use this)
  // DO NOT fallback to OpenAI — it returns system hard_limit, not user quota on transit stations
  const result = await _tryAdapter(queryNewApi, endpoint, key, channel);
  if (result.ok) return result;
  return { ok: false, channelId: channel.id, channelName: channel.name, error: 'Balance API not accessible (set balanceType in channel config if needed)' };
}

async function _tryAdapter(adapter, endpoint, key, channel) {
  try {
    const result = await adapter(endpoint, key);
    return {
      ok: true,
      channelId: channel.id,
      channelName: channel.name,
      total: result.total,
      used: result.used,
      remaining: result.total - result.used,
      unit: result.unit,
      percent: result.total > 0 ? Math.round(result.used / result.total * 100) : 0,
      queriedAt: Date.now(),
    };
  } catch (e) {
    return { ok: false, channelId: channel.id, channelName: channel.name, error: e.message };
  }
}

// ── Query all channels ──
async function queryAllBalances() {
  const channels = config.getAllChannels().filter(ch => ch.status === 'enabled');
  const results = [];
  for (const ch of channels) {
    const r = await queryBalance(ch);
    results.push(r);
  }
  return results;
}

// ── Check-in for New-API sites ──
async function checkIn(endpoint, key) {
  const base = endpoint.replace(/\/v1\/?$/, '');
  const authHeaders = [
    { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    { 'Authorization': key, 'Content-Type': 'application/json' },
  ];
  for (const headers of authHeaders) {
    try {
      const resp = await fetch(`${base}/api/user/check_in`, {
        method: 'POST', headers, signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const d = await resp.json();
      if (d.message || d.data) {
        return { ok: true, message: d.message || 'Check-in successful', data: d.data || null };
      }
    } catch (_) { continue; }
  }
  return { ok: false, error: 'Check-in endpoint not accessible' };
}

module.exports = { queryBalance, queryAllBalances, checkIn };
