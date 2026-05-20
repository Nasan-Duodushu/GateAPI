const config = require('./config');
const { onDetectComplete } = require('./scheduler');

// ── Webhook notification module ──
// Supports: Telegram Bot API, Discord Webhook, Generic HTTP POST

async function sendTelegram(url, token, chatId, message) {
  const endpoint = url || `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' });
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: url ? body : body,
  });
  if (!resp.ok) throw new Error(`Telegram ${resp.status}: ${await resp.text()}`);
}

async function sendDiscord(webhookUrl, message) {
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
  });
  if (!resp.ok) throw new Error(`Discord ${resp.status}: ${await resp.text()}`);
}

async function sendGenericHttp(url, payload) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

function formatDetectSummary(summary) {
  const lines = [];
  lines.push(`🔍 *GateAPI 定时检测完成*`);
  lines.push(`⏱ 耗时: ${(summary.durationMs / 1000).toFixed(1)}s`);
  lines.push(`📊 模型: ${summary.totalModels} | ✅ ${summary.passed} | ❌ ${summary.failed} | ⚠️ ${summary.errors}`);

  // List failed/risk channels
  const riskChannels = summary.channels.filter(ch => ch.models.some(m => m.score != null && m.score < 70));
  if (riskChannels.length) {
    lines.push('');
    lines.push('⚠️ *风险渠道:*');
    for (const ch of riskChannels) {
      const failModels = ch.models.filter(m => m.score != null && m.score < 70);
      lines.push(`  • ${ch.name} (avg: ${ch.avgScore}) — ${failModels.map(m => `${m.model}:${m.score}`).join(', ')}`);
    }
  }

  if (!riskChannels.length && summary.failed === 0) {
    lines.push('');
    lines.push('✅ 所有渠道检测正常');
  }

  return lines.join('\n');
}

async function notify(summary) {
  const cfg = config.get();
  const wh = cfg.webhook;
  if (!wh || !wh.enabled) return;

  const message = formatDetectSummary(summary);

  // Only notify if there are issues, or if notifyAlways is true
  const hasIssues = summary.failed > 0 || summary.errors > 0;
  if (!hasIssues && !wh.notifyAlways) return;

  const tasks = [];

  // Telegram
  if (wh.telegram?.enabled && (wh.telegram.token || wh.telegram.url) && wh.telegram.chatId) {
    tasks.push(
      sendTelegram(wh.telegram.url, wh.telegram.token, wh.telegram.chatId, message)
        .catch(e => console.error('[webhook] Telegram error:', e.message))
    );
  }

  // Discord
  if (wh.discord?.enabled && wh.discord.url) {
    tasks.push(
      sendDiscord(wh.discord.url, message)
        .catch(e => console.error('[webhook] Discord error:', e.message))
    );
  }

  // Generic HTTP
  if (wh.http?.enabled && wh.http.url) {
    tasks.push(
      sendGenericHttp(wh.http.url, { type: 'detect_complete', summary, message })
        .catch(e => console.error('[webhook] HTTP error:', e.message))
    );
  }

  if (tasks.length) {
    await Promise.allSettled(tasks);
    console.log(`[webhook] Sent ${tasks.length} notification(s)`);
  }
}

// ── Test webhook (send a test message) ──
async function testWebhook() {
  const cfg = config.get();
  const wh = cfg.webhook;
  if (!wh) throw new Error('Webhook not configured');

  const testMsg = `🧪 *GateAPI Webhook 测试*\n\n连接成功！时间: ${new Date().toLocaleString()}`;
  const results = [];

  if (wh.telegram?.enabled && (wh.telegram.token || wh.telegram.url) && wh.telegram.chatId) {
    try {
      await sendTelegram(wh.telegram.url, wh.telegram.token, wh.telegram.chatId, testMsg);
      results.push({ type: 'telegram', ok: true });
    } catch (e) { results.push({ type: 'telegram', ok: false, error: e.message }); }
  }

  if (wh.discord?.enabled && wh.discord.url) {
    try {
      await sendDiscord(wh.discord.url, testMsg);
      results.push({ type: 'discord', ok: true });
    } catch (e) { results.push({ type: 'discord', ok: false, error: e.message }); }
  }

  if (wh.http?.enabled && wh.http.url) {
    try {
      await sendGenericHttp(wh.http.url, { type: 'test', message: testMsg, ts: Date.now() });
      results.push({ type: 'http', ok: true });
    } catch (e) { results.push({ type: 'http', ok: false, error: e.message }); }
  }

  return results;
}

// ── Register hook with scheduler ──
function init() {
  onDetectComplete(notify);
  console.log('[webhook] Hook registered');
}

module.exports = { init, notify, testWebhook };
