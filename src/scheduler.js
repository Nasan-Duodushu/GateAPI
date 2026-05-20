const config = require('./config');
const { detectChannel } = require('./detective/engine');

let _cronTask = null;       // node-cron ScheduledTask or setInterval id
let _cronMode = 'none';     // 'cron' | 'interval' | 'none'
let _cronRunning = false;
const _sampleLock = new Map();
const SAMPLE_COOLDOWN_MS = 60000;

// ── Webhook hooks: registered callbacks invoked after scheduled detection ──
const _hooks = [];

function onDetectComplete(fn) {
  if (typeof fn === 'function') _hooks.push(fn);
}

function _fireHooks(summary) {
  for (const fn of _hooks) {
    try { fn(summary); } catch (e) { console.error('[hook] Error:', e.message); }
  }
}

// ── Passive sampling ──
function maybeSampleDetect(channel, model) {
  const cfg = config.get();
  const rate = cfg.detect?.sampleRate || 0;
  if (rate <= 0 || Math.random() > rate) return;

  const lockKey = `${channel.id}:${model}`;
  const now = Date.now();
  if (_sampleLock.has(lockKey) && (now - _sampleLock.get(lockKey) < SAMPLE_COOLDOWN_MS)) return;
  _sampleLock.set(lockKey, now);

  setImmediate(async () => {
    try {
      const { detectModel } = require('./detective/engine');
      console.log(`[sample] Triggered passive detection: ${channel.name} / ${model}`);
      await detectModel(channel, model, (msg) => console.log(`[sample] ${msg}`));
    } catch (e) {
      console.error(`[sample] Error: ${e.message}`);
    } finally {
      _sampleLock.delete(lockKey);
    }
  });
}

// ── Core detection runner (shared by cron and interval) ──
async function _runScheduledDetection() {
  if (_cronRunning) { console.log('[cron] Skipped (previous run still active)'); return; }
  _cronRunning = true;
  const startTime = Date.now();
  console.log('[cron] Starting scheduled detection...');

  const channels = config.getAllChannels().filter(ch => ch.status === 'enabled');
  const summary = { ts: startTime, channels: [], totalModels: 0, passed: 0, failed: 0, errors: 0 };

  for (const ch of channels) {
    const chSummary = { id: ch.id, name: ch.name, models: [], avgScore: 0 };
    try {
      const results = await detectChannel(ch, (msg) => console.log(`[cron] CH${ch.id} ${msg}`));
      const arr = Array.isArray(results) ? results : [];
      for (const r of arr) {
        summary.totalModels++;
        if (r.score != null && r.score >= 70) summary.passed++;
        else if (r.score != null) summary.failed++;
        else summary.errors++;
        chSummary.models.push({ model: r.model, score: r.score, verdict: r.verdict });
      }
      if (arr.length) chSummary.avgScore = Math.round(arr.reduce((s, r) => s + (r.score || 0), 0) / arr.length);
    } catch (e) {
      console.error(`[cron] CH${ch.id} error:`, e.message);
      summary.errors++;
    }
    summary.channels.push(chSummary);
  }

  summary.durationMs = Date.now() - startTime;
  _cronRunning = false;
  console.log(`[cron] Detection complete: ${summary.totalModels} models, ${summary.passed} passed, ${summary.failed} failed, ${summary.errors} errors (${summary.durationMs}ms)`);

  // Auto-degrade check
  for (const ch of channels) {
    const chSum = summary.channels.find(c => c.id === ch.id);
    if (chSum) autoDegrade(ch, chSum.models);
  }

  // Fire registered hooks (for webhook notifications etc.)
  _fireHooks(summary);
}

// ── Start scheduler: supports cronExpression (node-cron) or cronIntervalHours (setInterval) ──
function startCron() {
  stopCron();
  const cfg = config.get();
  const detect = cfg.detect || {};

  // Priority 1: cron expression (e.g. "0 */6 * * *")
  if (detect.cronExpression) {
    try {
      const cron = require('node-cron');
      if (!cron.validate(detect.cronExpression)) {
        console.error(`[cron] Invalid cron expression: "${detect.cronExpression}"`);
        return;
      }
      _cronTask = cron.schedule(detect.cronExpression, () => {
        _runScheduledDetection();
      }, { scheduled: true, timezone: detect.cronTimezone || undefined });
      _cronMode = 'cron';
      console.log(`[cron] Scheduled with expression: "${detect.cronExpression}"${detect.cronTimezone ? ` (TZ: ${detect.cronTimezone})` : ''}`);
      return;
    } catch (e) {
      console.error(`[cron] Failed to start cron:`, e.message);
    }
  }

  // Priority 2: legacy interval hours
  const intervalMs = (detect.cronIntervalHours || 0) * 3600000;
  if (intervalMs > 0) {
    _cronTask = setInterval(() => { _runScheduledDetection(); }, intervalMs);
    _cronMode = 'interval';
    console.log(`[cron] Scheduled every ${detect.cronIntervalHours}h (legacy interval mode)`);
    return;
  }

  _cronMode = 'none';
  console.log('[cron] Disabled (no cronExpression or cronIntervalHours set)');
}

function stopCron() {
  if (_cronTask) {
    if (_cronMode === 'cron' && typeof _cronTask.stop === 'function') {
      _cronTask.stop();
    } else if (_cronMode === 'interval') {
      clearInterval(_cronTask);
    }
    _cronTask = null;
  }
  _cronMode = 'none';
}

function getCronStatus() {
  const cfg = config.get();
  const detect = cfg.detect || {};
  return {
    mode: _cronMode,
    expression: detect.cronExpression || null,
    intervalHours: detect.cronIntervalHours || 0,
    running: _cronRunning,
    timezone: detect.cronTimezone || null,
  };
}

// ── Auto-degrade: log-only mode ──
function autoDegrade(channel, modelResults) {
  const cfg = config.get();
  const threshold = cfg.detect?.degradeThreshold || 0;
  if (threshold <= 0) return;

  for (const r of modelResults) {
    if (r.score != null && r.score < threshold) {
      console.log(`[detect-warn] CH${channel.id} "${channel.name}" model "${r.model}" score ${r.score} < ${threshold} — flagged as suspicious (no auto-action)`);
    }
  }
}

module.exports = { maybeSampleDetect, startCron, stopCron, getCronStatus, autoDegrade, onDetectComplete };
