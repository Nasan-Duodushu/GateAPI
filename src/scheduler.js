const config = require('./config');
const { detectChannel } = require('./detective/engine');

let _cronTimer = null;
let _cronRunning = false;
const _sampleLock = new Map(); // key: 'channelId:model' -> timestamp
const SAMPLE_COOLDOWN_MS = 60000; // 60s cooldown per channel+model

// ── Passive sampling: call after forwarding to randomly trigger detection ──
function maybeSampleDetect(channel, model) {
  const cfg = config.get();
  const rate = cfg.detect?.sampleRate || 0; // 0-1, e.g. 0.01 = 1%
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

// ── Cron: periodic full channel detection ──
function startCron() {
  const cfg = config.get();
  const intervalMs = (cfg.detect?.cronIntervalHours || 0) * 3600000;
  if (intervalMs <= 0) {
    console.log('[cron] Disabled (cronIntervalHours not set)');
    return;
  }

  console.log(`[cron] Scheduled every ${cfg.detect.cronIntervalHours}h`);
  _cronTimer = setInterval(async () => {
    if (_cronRunning) { console.log('[cron] Skipped (previous run still active)'); return; }
    _cronRunning = true;
    console.log('[cron] Starting scheduled detection...');

    const channels = config.getAllChannels().filter(ch => ch.status === 'enabled');
    for (const ch of channels) {
      try {
        await detectChannel(ch, (msg) => console.log(`[cron] CH${ch.id} ${msg}`));
      } catch (e) {
        console.error(`[cron] CH${ch.id} error:`, e.message);
      }
    }

    _cronRunning = false;
    console.log('[cron] Scheduled detection complete');
  }, intervalMs);
}

function stopCron() {
  if (_cronTimer) { clearInterval(_cronTimer); _cronTimer = null; }
}

// ── Auto-degrade: log-only mode (detection not accurate enough for auto-action yet) ──
function autoDegrade(channel, results) {
  const cfg = config.get();
  const threshold = cfg.detect?.degradeThreshold || 0; // 0 = disabled
  if (threshold <= 0) return;

  const scored = results.filter(r => r.score != null);
  if (!scored.length) return;

  // Log warnings only — no automatic model disable or channel degrade
  for (const r of scored) {
    if (r.score < threshold) {
      console.log(`[detect-warn] CH${channel.id} "${channel.name}" model "${r.model}" score ${r.score} < ${threshold} — flagged as suspicious (no auto-action)`);
    }
  }
}

module.exports = { maybeSampleDetect, startCron, stopCron, autoDegrade };
