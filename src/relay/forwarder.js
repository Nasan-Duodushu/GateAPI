const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('../config');
const store = require('../store');
const { nextKey, resolveModel, recordLatency, record429, clear429 } = require('./distributor');
const { maybeSampleDetect } = require('../scheduler');

// ── Health tracking ──
const _failCounts = new Map(); // channelId -> consecutive fail count
const FAIL_THRESHOLD = 5;
const RECOVERY_MS = 300000; // 5 min

function recordSuccess(channelId) {
  _failCounts.set(channelId, 0);
  clear429(channelId);
}
function recordFailure(channel) {
  const count = (_failCounts.get(channel.id) || 0) + 1;
  _failCounts.set(channel.id, count);
  if (count >= FAIL_THRESHOLD && channel.status === 'enabled') {
    channel.status = 'degraded';
    console.log(`[health] Channel ${channel.id} (${channel.name}) auto-degraded after ${count} failures`);
    setTimeout(() => {
      if (channel.status === 'degraded') {
        channel.status = 'enabled';
        _failCounts.set(channel.id, 0);
        console.log(`[health] Channel ${channel.id} (${channel.name}) auto-recovered`);
      }
    }, RECOVERY_MS);
  }
}

// ── OpenAI ↔ Anthropic conversion ──
function oaiToAnthropicBody(oaiBody, actualModel) {
  const msgs = oaiBody.messages || [];
  const sysTexts = msgs.filter(m => m.role === 'system').map(m => m.content);
  const nonSys = msgs.filter(m => m.role !== 'system');
  const body = {
    model: actualModel,
    messages: nonSys,
    max_tokens: oaiBody.max_tokens || oaiBody.max_completion_tokens || 4096,
  };
  if (sysTexts.length) body.system = sysTexts.join('\n');
  if (oaiBody.temperature != null) body.temperature = oaiBody.temperature;
  if (oaiBody.top_p != null) body.top_p = oaiBody.top_p;
  if (oaiBody.stream) body.stream = true;
  if (oaiBody.stop) body.stop_sequences = Array.isArray(oaiBody.stop) ? oaiBody.stop : [oaiBody.stop];
  return body;
}

function anthropicToOaiResponse(anthData, requestedModel) {
  const content = (anthData.content || []).map(b => b.text || '').join('');
  return {
    id: anthData.id || 'msg-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: anthData.stop_reason === 'end_turn' ? 'stop' : (anthData.stop_reason || 'stop')
    }],
    usage: {
      prompt_tokens: anthData.usage?.input_tokens || 0,
      completion_tokens: anthData.usage?.output_tokens || 0,
      total_tokens: (anthData.usage?.input_tokens || 0) + (anthData.usage?.output_tokens || 0)
    }
  };
}

function anthropicStreamToOai(chunk, requestedModel) {
  if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
    return `data: ${JSON.stringify({
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{ index: 0, delta: { content: chunk.delta.text }, finish_reason: null }]
    })}\n\n`;
  }
  if (chunk.type === 'message_stop') {
    return `data: ${JSON.stringify({
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    })}\n\ndata: [DONE]\n\n`;
  }
  return null;
}

async function forward(req, res, channel, requestedModel) {
  const cfg = config.get();
  const key = nextKey(channel);
  if (!key) return res.status(500).json({ error: { message: 'No API key available for channel', type: 'server_error' } });

  const actualModel = resolveModel(requestedModel, channel);
  const isStream = req.body.stream === true;
  const isAnthUpstream = channel.type === 'anthropic';

  const reqBody = isAnthUpstream
    ? oaiToAnthropicBody(req.body, actualModel)
    : { ...req.body, model: actualModel };
  const body = JSON.stringify(reqBody);

  const endpoint = channel.endpoint.replace(/\/+$/, '');
  const targetUrl = isAnthUpstream
    ? `${endpoint}/v1/messages`
    : `${endpoint}/chat/completions`;

  const parsed = new URL(targetUrl);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  const headers = { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' };
  if (isAnthUpstream) {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${key}`;
  }

  const startTime = Date.now();
  const logData = {
    model: requestedModel, channelId: channel.id, channelName: channel.name,
    stream: isStream, statusCode: 0, durationMs: 0, error: null,
    userId: req._userId || 0, apiKeyId: req._apiKeyId || 0
  };

  return new Promise((resolve) => {
    const timeout = cfg.relay.timeout || 60000;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout
    };

    const proxyReq = transport.request(options, (proxyRes) => {
      logData.statusCode = proxyRes.statusCode;

      if (proxyRes.statusCode >= 400) {
        let errBody = '';
        proxyRes.on('data', (chunk) => { errBody += chunk; });
        proxyRes.on('end', () => {
          logData.durationMs = Date.now() - startTime;
          logData.error = errBody.slice(0, 500);
          recordLatency(channel.id, logData.durationMs);
          if (proxyRes.statusCode === 429) record429(channel.id);
          else recordFailure(channel);
          store.logRequest(logData);
          res.status(proxyRes.statusCode);
          res.set('Content-Type', 'application/json');
          res.end(errBody);
          resolve({ ok: false, status: proxyRes.statusCode });
        });
        return;
      }

      if (isStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-GateAPI-Channel': channel.name,
        });
        if (isAnthUpstream) {
          // Convert Anthropic SSE → OpenAI SSE
          let buf = '';
          proxyRes.on('data', (chunk) => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (!data) continue;
              try {
                const evt = JSON.parse(data);
                const converted = anthropicStreamToOai(evt, requestedModel);
                if (converted) res.write(converted);
              } catch (_) {}
            }
          });
          proxyRes.on('end', () => {
            logData.durationMs = Date.now() - startTime;
            recordLatency(channel.id, logData.durationMs);
            recordSuccess(channel.id);
            store.logRequest(logData);
            maybeSampleDetect(channel, requestedModel);
            if (!res.writableEnded) res.end();
            resolve({ ok: true, status: 200 });
          });
        } else {
          proxyRes.pipe(res);
          proxyRes.on('end', () => {
            logData.durationMs = Date.now() - startTime;
            recordLatency(channel.id, logData.durationMs);
            recordSuccess(channel.id);
            store.logRequest(logData);
            maybeSampleDetect(channel, requestedModel);
            resolve({ ok: true, status: 200 });
          });
        }
        proxyRes.on('error', (e) => {
          logData.durationMs = Date.now() - startTime;
          logData.error = e.message;
          recordFailure(channel);
          store.logRequest(logData);
          if (!res.writableEnded) res.end();
          resolve({ ok: false, status: 502 });
        });
      } else {
        let data = '';
        proxyRes.on('data', (chunk) => { data += chunk; });
        proxyRes.on('end', () => {
          logData.durationMs = Date.now() - startTime;
          try {
            const obj = JSON.parse(data);

            // Detect empty content: upstream returned 200 but no actual content
            const content = isAnthUpstream
              ? (obj.content || []).map(b => b.text || '').join('')
              : (obj.choices?.[0]?.message?.content ?? obj.choices?.[0]?.message?.reasoning_content ?? null);
            if (content === null || content === '') {
              const compTok = isAnthUpstream
                ? (obj.usage?.output_tokens || 0)
                : (obj.usage?.completion_tokens || 0);
              if (compTok === 0) {
                const promptTok = isAnthUpstream ? (obj.usage?.input_tokens || 0) : (obj.usage?.prompt_tokens || 0);
                console.log(`[relay] Empty content from ch${channel.id}(${channel.name}) model=${requestedModel} prompt_tokens=${promptTok} — upstream returned 200 but message.content is null/empty with 0 completion_tokens`);
                logData.error = `upstream_empty_content: ch${channel.id}(${channel.name}) returned 200 but content=null, completion_tokens=0`;
                recordFailure(channel);
                store.logRequest(logData);
                resolve({ ok: false, status: 502 });
                return;
              }
            }

            recordSuccess(channel.id);
            if (isAnthUpstream) {
              const converted = anthropicToOaiResponse(obj, requestedModel);
              logData.promptTokens = converted.usage.prompt_tokens;
              logData.completionTokens = converted.usage.completion_tokens;
              store.logRequest(logData);
              recordLatency(channel.id, logData.durationMs);
              if (req._apiKeyRow) store.consumeQuota(req._apiKeyRow, logData.promptTokens, logData.completionTokens);
              maybeSampleDetect(channel, requestedModel);
              res.set('Content-Type', 'application/json');
              res.set('X-GateAPI-Channel', channel.name);
              res.end(JSON.stringify(converted));
            } else {
              if (obj.usage) {
                logData.promptTokens = obj.usage.prompt_tokens || 0;
                logData.completionTokens = obj.usage.completion_tokens || 0;
              }
              store.logRequest(logData);
              recordLatency(channel.id, logData.durationMs);
              if (req._apiKeyRow) store.consumeQuota(req._apiKeyRow, logData.promptTokens, logData.completionTokens);
              maybeSampleDetect(channel, requestedModel);
              res.set('Content-Type', 'application/json');
              res.set('X-GateAPI-Channel', channel.name);
              res.end(data);
            }
          } catch (_) {
            store.logRequest(logData);
            res.set('Content-Type', 'application/json');
            res.end(data);
          }
          resolve({ ok: true, status: 200 });
        });
      }
    });

    proxyReq.on('error', (e) => {
      logData.durationMs = Date.now() - startTime;
      logData.error = e.message;
      recordFailure(channel);
      store.logRequest(logData);
      if (!res.headersSent) {
        res.status(502).json({ error: { message: `Upstream error: ${e.message}`, type: 'upstream_error' } });
      }
      resolve({ ok: false, status: 502 });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      logData.durationMs = Date.now() - startTime;
      logData.error = 'timeout';
      recordFailure(channel);
      store.logRequest(logData);
      if (!res.headersSent) {
        res.status(504).json({ error: { message: 'Upstream timeout', type: 'timeout_error' } });
      }
      resolve({ ok: false, status: 504 });
    });

    proxyReq.write(body);
    proxyReq.end();
  });
}

module.exports = { forward, recordSuccess, recordFailure, _failCounts };
