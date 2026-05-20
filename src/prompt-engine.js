const config = require('./config');

/**
 * Process messages: system prompt injection + context compression.
 * Returns a new body object with modified messages array.
 * If prompt engine is disabled, returns original body unchanged.
 */
function processMessages(body) {
  const cfg = config.get();
  const pe = cfg.promptEngine;
  if (!pe || !pe.enabled) return body;
  if (!body.messages || !Array.isArray(body.messages)) return body;

  let messages = body.messages.map(m => ({ ...m }));

  // 1. System prompt injection
  if (pe.systemPrompt && pe.systemPrompt.trim()) {
    const sysMsg = { role: 'system', content: pe.systemPrompt.trim() };
    const mode = pe.injectMode || 'prepend';

    if (mode === 'prepend') {
      messages.unshift(sysMsg);
    } else {
      // append: insert after the last existing system message
      let lastSysIdx = -1;
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'system') lastSysIdx = i;
      }
      if (lastSysIdx >= 0) {
        messages.splice(lastSysIdx + 1, 0, sysMsg);
      } else {
        // No system messages exist, prepend
        messages.unshift(sysMsg);
      }
    }
  }

  // 2. Context compression: keep all system messages + last N non-system messages
  const maxMsg = pe.maxMessages || 0;
  if (maxMsg > 0 && messages.length > maxMsg) {
    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    const keepCount = Math.max(0, maxMsg - systemMsgs.length);
    messages = [...systemMsgs, ...nonSystemMsgs.slice(-keepCount)];
  }

  return { ...body, messages };
}

module.exports = { processMessages };
