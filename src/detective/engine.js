const { findFpMatch, detectFamily, FINGERPRINTS } = require('./fingerprints');
const store = require('../store');
const { PROBE_TEXTS, matchFingerprint, classifyConfidence, classifyLatency } = require('./modeldb');

// ── Helpers ──
function extractFirstJson(text) {
  const start = text.indexOf('{'); if (start === -1) return '{}';
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++; else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start);
}

function editDistance(a, b) {
  const m = a.length, n = b.length, dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function similarity(a, b) { const mx = Math.max(a.length, b.length); return mx === 0 ? 1 : 1 - editDistance(a.toLowerCase(), b.toLowerCase()) / mx; }
function normWs(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

const KNOWN_MODELS = [
  // OpenAI — match longest first to avoid partial matches
  'gpt-5.5-pro','gpt-5.5','gpt-5.4-pro','gpt-5.4-mini','gpt-5.4-nano','gpt-5.4',
  'gpt-5.3','gpt-5.2','gpt-5.1','gpt-5-pro','gpt-5-mini','gpt-5-nano','gpt-5',
  'gpt-4.5','gpt-4.1-mini','gpt-4.1-nano','gpt-4.1','gpt-4o-mini','gpt-4o','gpt-4-turbo','gpt-4','gpt-3.5',
  'o4-mini','o4','o3-pro','o3-mini','o3','o1-pro','o1-preview','o1-mini','o1',
  // Anthropic
  'claude-opus-4.7','claude-opus-4.6','claude-opus-4.5','claude-opus-4.1','claude-opus-4','claude-opus',
  'claude-sonnet-4.6','claude-sonnet-4.5','claude-sonnet-4','claude-sonnet',
  'claude-3.7-sonnet','claude-3.5-sonnet','claude-3.5-haiku','claude-3-opus','claude-3-sonnet','claude-3-haiku',
  'claude-haiku','claude',
  // Google
  'gemini-3.1','gemini-3','gemini-2.5','gemini-2.0','gemini-1.5','gemini',
  // DeepSeek
  'deepseek-r1','deepseek-v4','deepseek-v3','deepseek-v2','deepseek-coder','deepseek',
  // Qwen
  'qwq','qwen3.5','qwen3','qwen2.5','qwen-max','qwen-plus','qwen-turbo','qwen',
  // Others
  'grok-4','grok-3','grok-2','grok',
  'llama-4','llama-3.3','llama-3.1','llama-3','llama',
  'mistral-large','mistral-medium','mistral-small','mistral','mixtral','codestral','pixtral',
  'glm-5','glm-4','glm','kimi','moonshot','doubao','yi-large','yi',
  'minimax','abab','hunyuan','ernie','wenxin','spark',
];

// ── API call helper (non-streaming) ──
async function apiCall(endpoint, key, modelId, messages, opts = {}, channelType = 'openai') {
  const ep = endpoint.replace(/\/+$/, '');

  if (channelType === 'anthropic') {
    const sysMsg = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const userMsgs = messages.filter(m => m.role !== 'system');
    const body = { model: modelId, messages: userMsgs, max_tokens: opts.max_tokens || 500, ...(sysMsg ? { system: sysMsg } : {}), ...(opts.temperature != null ? { temperature: opts.temperature } : {}) };
    const r = await fetch(`${ep}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!r.ok) { const e = await r.text().catch(() => ''); throw new Error(`HTTP ${r.status}: ${e.slice(0, 200)}`); }
    const d = await r.json();
    return { choices: [{ message: { content: d.content?.[0]?.text || '', role: 'assistant' } }], model: d.model || '', usage: { prompt_tokens: d.usage?.input_tokens || 0, completion_tokens: d.usage?.output_tokens || 0, total_tokens: (d.usage?.input_tokens || 0) + (d.usage?.output_tokens || 0) } };
  }

  const body = { model: modelId, messages, max_tokens: opts.max_tokens || 500, stream: false, ...(opts.temperature != null ? { temperature: opts.temperature } : {}), ...(opts.logprobs ? { logprobs: true, top_logprobs: opts.top_logprobs || 5 } : {}) };
  const r = await fetch(`${ep}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!r.ok) { const e = await r.text().catch(() => ''); throw new Error(`HTTP ${r.status}: ${e.slice(0, 200)}`); }
  return await r.json();
}

// ══════════════════════════════════════════
// MAIN DETECTION ENGINE
// ══════════════════════════════════════════
async function detectModel(channel, modelId, onProgress) {
  const probes = {};
  const claimedFp = findFpMatch(modelId);
  const key = channel.keys[0];
  const _api = (msgs, opts = {}) => apiCall(channel.endpoint, key, modelId, msgs, opts, channel.type);
  const log = (msg) => { if (onProgress) onProgress(msg); };

  // ══ Batch 1/3: Composite + TTFT (2 parallel) ══
  await Promise.all([
  (async () => {
  log('Running composite probe...');
  try {
    const compositePrompt = `Answer ALL of the following in strict JSON format. Output ONLY the JSON object, no other text:
{
  "identity": "What AI model are you? Give your exact name and version number",
  "math": "Calculate 1234 × 5678. Give only the number",
  "logic": "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost in cents? Give only the number",
  "strawberry": "How many letter 'r' are in the word 'strawberry'? Give only the number",
  "knowledge": "When was the 2024 Paris Olympics opening ceremony? Give only YYYY-MM-DD"
}`;
    const compResp = await _api([{ role: 'user', content: compositePrompt }], { temperature: 0, max_tokens: 400 });
    const compText = compResp.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(extractFirstJson(compText)); } catch (_) { parsed = {}; }

    // Identity
    const idText = (parsed.identity || compText).toLowerCase();
    const detectedFamily = detectFamily(idText);
    probes.identity = { pass: true, summary: (parsed.identity || '').slice(0, 60), detected: detectedFamily };

    // Identity model match
    const selfReport = (parsed.identity || '').toLowerCase();
    let selfModelId = null;
    for (const km of KNOWN_MODELS) { if (selfReport.includes(km)) { selfModelId = km; break; } }
    if (selfModelId) {
      const claimedNorm = modelId.toLowerCase().replace(/[^a-z0-9]/g, '');
      const selfNorm = selfModelId.replace(/[^a-z0-9]/g, '');
      const idModelMatch = claimedNorm.includes(selfNorm) || selfNorm.includes(claimedNorm);
      probes.identityModel = { pass: idModelMatch, summary: idModelMatch ? `${selfModelId} ✓` : `Self: ${selfModelId} ≠ Claimed: ${modelId}`, selfModelId };
    } else {
      probes.identityModel = { pass: 'warn', summary: 'Could not extract specific model', selfModelId: null };
    }

    // Reasoning tokens
    const compReasoningToks = compResp.usage?.completion_tokens_details?.reasoning_tokens || 0;
    const claimedIsReasoning = claimedFp?.reasoning === true;
    if (compReasoningToks > 0 && !claimedIsReasoning) {
      probes.reasoning = { pass: false, summary: `${compReasoningToks} tokens! Smoking gun for o-series substitution`, reasoningToks: compReasoningToks };
    } else if (compReasoningToks > 0 && claimedIsReasoning) {
      probes.reasoning = { pass: true, summary: `${compReasoningToks} tokens (expected)`, reasoningToks: compReasoningToks };
    } else {
      probes.reasoning = { pass: !claimedIsReasoning, summary: claimedIsReasoning ? 'No reasoning tokens (unexpected)' : 'No reasoning tokens (correct)', reasoningToks: 0 };
    }

    // Math
    const mathAns = parseInt(String(parsed.math || '').replace(/[^0-9-]/g, ''));
    probes.math = { pass: mathAns === 7006652, summary: mathAns === 7006652 ? '7006652 ✓' : `${mathAns || '?'} (expected 7006652)` };

    // Logic
    const logicAns = parseInt(String(parsed.logic || '').replace(/[^0-9.]/g, ''));
    probes.logic = { pass: logicAns === 5, summary: logicAns === 5 ? '5¢ ✓' : `${logicAns || '?'}¢ (expected 5)` };

    // Strawberry
    const strawAns = parseInt(String(parsed.strawberry || '').replace(/[^0-9]/g, ''));
    probes.strawberry = { pass: strawAns === 3, summary: strawAns === 3 ? '3 ✓' : `${strawAns || '?'} (expected 3)` };

    // Knowledge
    const knowText = String(parsed.knowledge || '');
    probes.knowledge = { pass: knowText.includes('2024-07-26'), summary: knowText.includes('2024-07-26') ? '2024-07-26 ✓' : `${knowText.slice(0, 15)}` };

    // Model Field check (zero-cost: extracted from composite response)
    const returnedModel = (compResp.model || '').toLowerCase();
    if (returnedModel) {
      const reqNorm = modelId.toLowerCase().replace(/[^a-z0-9]/g, '');
      const retNorm = returnedModel.replace(/[^a-z0-9]/g, '');
      const exactMatch = reqNorm === retNorm;
      const prefixMatch = retNorm.startsWith(reqNorm) || reqNorm.startsWith(retNorm);
      const retFamily = detectFamily(returnedModel);
      const reqFamily = detectFamily(modelId);
      const familyMatch = retFamily === reqFamily || retFamily === 'unknown' || reqFamily === 'unknown';
      if (exactMatch || prefixMatch) {
        probes.modelField = { pass: true, summary: `${compResp.model} ✓`, returnedModel: compResp.model };
      } else if (!familyMatch) {
        probes.modelField = { pass: false, summary: `${compResp.model} ✗ family ${retFamily}≠${reqFamily}`, returnedModel: compResp.model };
      } else {
        probes.modelField = { pass: 'warn', summary: `${compResp.model} ≠ ${modelId}`, returnedModel: compResp.model };
      }
    } else {
      probes.modelField = { pass: 'warn', summary: 'No model field in response' };
    }

    // Token Usage fingerprint (zero-cost: extracted from composite response)
    const compTokens = compResp.usage?.completion_tokens || 0;
    if (compTokens > 0 && claimedFp?.toksRange) {
      const [tMin, tMax] = claimedFp.toksRange;
      const margin = Math.max(30, (tMax - tMin) * 0.5);
      const inRange = compTokens >= (tMin - margin) && compTokens <= (tMax + margin);
      const extremeOff = compTokens > tMax * 2.5 || compTokens < tMin * 0.2;
      probes.tokenUsage = { pass: extremeOff ? false : inRange ? true : 'warn', summary: `${compTokens} tok ${inRange ? '✓' : extremeOff ? `✗ expected ~${tMin}-${tMax}` : `⚠ expected ~${tMin}-${tMax}`}`, completionTokens: compTokens };
    } else if (compTokens > 0) {
      probes.tokenUsage = { pass: 'warn', summary: `${compTokens} tok (no baseline)`, completionTokens: compTokens };
    } else {
      probes.tokenUsage = { pass: 'warn', summary: 'No usage data' };
    }
  } catch (e) {
    ['identity', 'identityModel', 'reasoning', 'math', 'logic', 'strawberry', 'knowledge', 'modelField', 'tokenUsage'].forEach(k => {
      probes[k] = { pass: 'warn', summary: `Error: ${e.message.slice(0, 50)}` };
    });
  }
  })(),
  (async () => {
  log('Running TTFT probe...');
  try {
    const ttftPrompt = 'Say hello.';
    const t0 = Date.now();
    const ttftResp = await _api([{ role: 'user', content: ttftPrompt }], { temperature: 0, max_tokens: 5 });
    const ttftMs = Date.now() - t0;
    probes._ttftPromptTokens = ttftResp.usage?.prompt_tokens || 0;
    const ttftRanges = { S: [150, 3000], A: [100, 2500], B: [80, 2000], C: [50, 1500], R: [1000, 30000] };
    const expectedTtft = claimedFp ? (ttftRanges[claimedFp.tier] || [50, 5000]) : [50, 5000];
    const ttftOk = ttftMs >= expectedTtft[0] && ttftMs <= expectedTtft[1];
    probes.ttft = {
      pass: ttftOk ? true : 'warn',
      summary: `${ttftMs}ms ${ttftOk ? '✓' : `⚠ expected ${expectedTtft[0]}-${expectedTtft[1]}ms`}`,
      ttftMs,
    };
  } catch (e) {
    probes.ttft = { pass: 'warn', summary: `Error: ${e.message.slice(0, 50)}` };
  }
  })(),
  ]);

  // ══ Batch 2/3: TempConsist + LongCtx (2 parallel) ══
  await Promise.all([
  (async () => {
  log('Running temperature consistency...');
  try {
    const tempPrompt = 'Complete this fibonacci sequence with exactly the next 5 numbers, comma-separated: 1, 1, 2, 3, 5, 8';
    const [t1, t2] = await Promise.all([
      _api([{ role: 'user', content: tempPrompt }], { temperature: 0, max_tokens: 60 }),
      _api([{ role: 'user', content: tempPrompt }], { temperature: 0, max_tokens: 60 }),
    ]);
    const r1 = normWs(t1.choices?.[0]?.message?.content || '');
    const r2 = normWs(t2.choices?.[0]?.message?.content || '');
    const consistent = r1 === r2;
    const sim = similarity(r1, r2);
    probes.tempConsist = { pass: consistent || sim > 0.95, summary: consistent ? 'Identical ✓' : `Sim ${(sim * 100).toFixed(0)}%` };
  } catch (e) {
    probes.tempConsist = { pass: 'warn', summary: `Error: ${e.message.slice(0, 50)}` };
  }
  })(),
  (async () => {
  log('Running long context probe...');
  try {
    const uuid = require('crypto').randomUUID();
    const filler = 'The following is background context for reference. '.repeat(15);
    const lcResp = await _api([
      { role: 'system', content: `You are a helpful assistant. ${filler}` },
      { role: 'user', content: `Remember this code: ${uuid}. I will ask you about it next.` },
      { role: 'assistant', content: `I've noted the code: ${uuid}. I'll remember it.` },
      { role: 'user', content: 'What was the code I asked you to remember? Reply with ONLY the code, nothing else.' }
    ], { temperature: 0, max_tokens: 100 });
    const lcText = (lcResp.choices?.[0]?.message?.content || '').trim();
    probes.longCtx = { pass: lcText.includes(uuid), summary: lcText.includes(uuid) ? 'Recalled ✓' : 'Failed to recall' };
  } catch (e) {
    probes.longCtx = { pass: 'warn', summary: `Error: ${e.message.slice(0, 50)}` };
  }
  })(),
  ]);

  // ══ Batch 3/3: Logprobs + Tokenizer (2 parallel) ══
  await Promise.all([
  (async () => {
  if (channel.type !== 'anthropic') {
    log('Running logprobs probe...');
    try {
      const lpPrompt = 'What is the capital of France? Answer in one word.';
      const lpResp = await _api([{ role: 'user', content: lpPrompt }], { temperature: 0, max_tokens: 5, logprobs: true, top_logprobs: 5 });
      const topLogprobs = lpResp.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs;
      if (topLogprobs && topLogprobs.length > 0) {
        const probs = topLogprobs.map(lp => Math.exp(lp.logprob));
        const sumP = probs.reduce((a, b) => a + b, 0);
        const normProbs = probs.map(p => p / sumP);
        const entropy = -normProbs.reduce((acc, p) => acc + (p > 0 ? p * Math.log2(p) : 0), 0);
        const topToken = topLogprobs[0]?.token || '?';
        const topProb = (normProbs[0] * 100).toFixed(1);
        const tierEntropy = { S: [0, 0.5], A: [0, 0.8], B: [0, 1.2], C: [0.3, 2.0], R: [0, 0.5] };
        const expectedRange = claimedFp ? (tierEntropy[claimedFp.tier] || [0, 2]) : [0, 2];
        const entropyOk = entropy >= expectedRange[0] && entropy <= expectedRange[1];
        probes.logprobs = {
          pass: entropyOk,
          summary: `H=${entropy.toFixed(2)} top="${topToken}"(${topProb}%) ${entropyOk ? '✓' : '⚠ unusual'}`,
          entropy, topToken, topProb: normProbs[0], rawLogprobs: topLogprobs.slice(0, 5).map(lp => ({ token: lp.token, logprob: lp.logprob })),
        };
      } else {
        probes.logprobs = { pass: 'warn', summary: 'API did not return logprobs' };
      }
    } catch (e) {
      probes.logprobs = { pass: 'warn', summary: `Error: ${e.message.slice(0, 50)}` };
    }
  } else {
    probes.logprobs = { pass: 'warn', summary: 'N/A (Anthropic)' };
  }
  })(),
  (async () => {
  // ── 6. Tokenizer fingerprint probe ──
  // Reference: 樱子 52-model real tiktoken measurements (2026-05-17)
  // CN column is strongest discriminator: 7→9→10→12→13→16→18→20→26→33
  log('Running tokenizer probe...');
  try {
    const tokRefText = '今天天气真好，我们一起去公园散步吧 The quick brown fox 1234567890';
    const tokResp = await _api([{ role: 'user', content: tokRefText }], { temperature: 0, max_tokens: 5 });
    const promptToks = tokResp.usage?.prompt_tokens;
    if (promptToks && promptToks > 0) {
      // prompt_tokens = text_tokens(CN+EN_partial+NUM_partial) + message_overhead(3-8)
      // 52-model real data: family → [min, max] expected prompt_tokens
      const tokFamilyRanges = {
        // ── CN=9 (CJK top): text~16-18, +overhead → 19-27 ──
        deepseek:  [18, 27],   // V3/R1: CN=9 EN=9 NUM=24 JP=9
        glm:       [18, 28],   // GLM-4/Z1: CN=9 NUM=29(独特)
        minimax:   [18, 27],   // Text-01/M1: CN=9 NUM=24 JP=6
        kimi:      [18, 27],   // K2: CN=9 NUM=24
        // ── CN=10 (CJK good): text~18-20, +overhead → 20-29 ──
        doubao:    [19, 28],   // 豆包/Seed-Coder: CN=10 NUM=24
        qwen:      [20, 31],   // Qwen 1.5-3: CN=10 NUM=42
        yi:        [20, 31],   // Yi 1.0/1.5: CN=10 NUM=43
        ernie:     [19, 28],   // 文心一言: EN=10 CN=10 NUM=22
        // ── CN=12-13 (modern): text~20-22, +overhead → 22-30 ──
        google:    [21, 30],   // Gemini: EN=10 CN=12 NUM=20 JP=11
        openai:    [22, 37],   // o200k(CN=13)+cl100k(CN=20), tokVar handles precision
        meta:      [22, 30],   // Llama 3/4: CN=13 NUM=24
        // ── CN=16 (mid): text~24-25, +overhead → 27-35 ──
        anthropic: [27, 35],   // Claude 3/3.5/4: EN=11 CN=16 NUM=22 JP=14
        mistral:   [26, 38],   // Small(CN=16) to 7B(CN=18)
        // ── CN=26+ (poor/worst): text~35+, +overhead → 38+ ──
        grok:      [34, 48],   // Grok-1: CN=26 NUM=43
        // ── Other Chinese (estimated CJK-top) ──
        hunyuan:   [18, 28],   // 腾讯混元: 估算CN≈9-10
        spark:     [18, 28],   // 讯飞星火: 估算CN≈9-10
      };

      // Tokenizer variant overrides for same-family cross-generation precision
      const tokVarRanges = {
        // OpenAI: o200k(CN=13) vs cl100k(CN=20) vs p50k(CN=33)
        o200k:  [22, 30],   // GPT-4o/4.1/5.x/o-series
        cl100k: [28, 37],   // GPT-4/4-Turbo/3.5-Turbo
        p50k:   [38, 48],   // GPT-3/Codex/GPT-2
        // DeepSeek: V3(CN=9,NUM=24) vs V2(CN=10,NUM=42)
        ds_v3:  [18, 26],   // DeepSeek V3/R1
        ds_v2:  [20, 30],   // DeepSeek V2/Coder V2
        // Mistral: Small(CN=16) vs 7B/Mixtral(CN=18)
        mst_sm: [26, 34],   // Mistral Small/Medium/Large
        mst_7b: [28, 38],   // Mistral 7B/Mixtral
        // Llama: 3+(CN=13) vs 2(CN=28)
        llama3: [22, 30],   // Llama 3/3.1/3.3/4
        llama2: [30, 42],   // CodeLlama/Llama 2
      };

      // 3-tier system: only catches GROSS cross-tier mismatches
      // Tier boundary at 30: below=CJK/modern(CN≤13), above=Western(CN≥16)
      // Tier boundary at 40: above=ancient(CN≥26)
      const tierFamilies = {
        cjk:     ['deepseek','glm','minimax','kimi','qwen','yi','doubao','ernie','openai','meta','google','hunyuan','spark'],
        western: ['anthropic','mistral'],
        ancient: ['grok'],
      };

      const _claimedFam = claimedFp?.family || 'unknown';
      const _tokVar = claimedFp?.tokVar || null;
      const expectedRange = _tokVar ? (tokVarRanges[_tokVar] || null)
        : (_claimedFam !== 'unknown' ? (tokFamilyRanges[_claimedFam] || null) : null);

      // Detect actual tier from prompt_tokens (conservative boundaries)
      const actualTier = promptToks < 30 ? 'cjk' : promptToks < 40 ? 'western' : 'ancient';
      // Determine claimed tier
      let claimedTier = 'unknown';
      for (const [tierName, fams] of Object.entries(tierFamilies)) {
        if (fams.includes(_claimedFam)) { claimedTier = tierName; break; }
      }

      // English cross-check from TTFT "Say hello." (zero extra cost)
      const engToks = probes._ttftPromptTokens || 0;
      const engRanges = {
        openai: [4, 10], anthropic: [8, 15], google: [5, 12],
        deepseek: [4, 10], qwen: [4, 10], glm: [4, 11], minimax: [4, 11],
        meta: [4, 10], mistral: [5, 12], kimi: [4, 11], doubao: [4, 11],
        yi: [4, 11], grok: [4, 12], ernie: [4, 11], hunyuan: [4, 11], spark: [4, 11],
      };
      const engExpected = engRanges[_claimedFam] || null;
      const engOk = engToks > 0 && engExpected ? (engToks >= engExpected[0] && engToks <= engExpected[1]) : null;

      // Sanity: max possible for our ref text is ~48 (worst tokenizer) + ~8 overhead = ~56
      // If prompt_tokens > 100, the channel injects extra system content → token count unreliable
      const overheadInflated = promptToks > 100;
      const engInflated = engToks > 50;

      let tokPass = 'warn';
      let tokSummary = `${promptToks} prompt_tok`;
      if (overheadInflated) {
        tokSummary += ` ⚠ 渠道overhead过大，跳过tokenizer判定`;
      } else if (expectedRange) {
        const inRange = promptToks >= expectedRange[0] && promptToks <= expectedRange[1];
        if (inRange) {
          tokPass = true;
          tokSummary += ' ✓';
        } else if (claimedTier !== 'unknown' && actualTier !== claimedTier) {
          tokPass = false;
          tokSummary += ` ✗ ${actualTier} tokenizer ≠ ${_claimedFam}(${claimedTier})`;
        } else {
          tokSummary += ` ⚠ expected ~${expectedRange[0]}-${expectedRange[1]}`;
        }
      } else {
        tokSummary += ` (${actualTier} tokenizer)`;
      }
      if (engToks > 0 && !engInflated) tokSummary += ` · EN:${engToks}${engOk === true ? '✓' : engOk === false ? '✗' : ''}`;

      // Find all families whose ranges include the observed prompt_tokens
      const matchedFamilies = [];
      if (!overheadInflated) {
        for (const [fam, range] of Object.entries(tokFamilyRanges)) {
          if (promptToks >= range[0] && promptToks <= range[1]) matchedFamilies.push(fam);
        }
      }
      probes.tokenizer = { pass: tokPass, summary: tokSummary, promptTokens: promptToks, engPromptTokens: engToks, actualTier: overheadInflated ? 'inflated' : actualTier, matchedFamilies };
    } else {
      probes.tokenizer = { pass: 'warn', summary: 'No prompt_tokens in response' };
    }
  } catch (e) {
    probes.tokenizer = { pass: 'warn', summary: `Error: ${e.message.slice(0, 50)}` };
  }
  })(),
  ]);

  // ══════════════════════════════════════════
  // SCORING
  // ══════════════════════════════════════════
  log('Calculating scores...');
  let detectedFam = probes.identity?.detected || 'unknown';
  // Fallback: if self-report didn't reveal family, try model ID string or fingerprint DB
  if (detectedFam === 'unknown') {
    const fromModelId = detectFamily(modelId);
    if (fromModelId !== 'unknown') detectedFam = fromModelId;
    else if (claimedFp) detectedFam = claimedFp.family;
  }
  const claimedFam = claimedFp?.family || 'unknown';
  const famMatch = detectedFam === claimedFam || detectedFam === 'unknown';

  const scores = {};
  // High-value probes (hard to fake)
  scores.reasoning = { v: probes.reasoning?.pass === true ? 100 : probes.reasoning?.pass === 'warn' ? 40 : 0, w: 8 };
  scores.identityModel = { v: probes.identityModel?.pass === true ? 100 : probes.identityModel?.pass === 'warn' ? 50 : 0, w: 6 };
  scores.identity = { v: famMatch ? 100 : detectedFam === 'unknown' ? 50 : 0, w: 4 };
  scores.logprobs = { v: probes.logprobs?.pass === true ? 100 : probes.logprobs?.pass === 'warn' ? 50 : 20, w: probes.logprobs?.pass === 'warn' ? 0 : 5 };
  // Medium-value probes — weight scales up when claimedFp says the model SHOULD pass
  const capW = (expected) => expected ? 3 : 1;
  scores.math = { v: probes.math?.pass === true ? 100 : probes.math?.pass === 'warn' ? 50 : claimedFp ? (claimedFp.math === probes.math?.pass ? 100 : 0) : 50, w: capW(claimedFp?.math) };
  scores.logic = { v: probes.logic?.pass === true ? 100 : probes.logic?.pass === 'warn' ? 50 : claimedFp ? (claimedFp.logic === probes.logic?.pass ? 100 : 0) : 50, w: capW(claimedFp?.logic) };
  scores.strawberry = { v: probes.strawberry?.pass === true ? 100 : probes.strawberry?.pass === 'warn' ? 50 : claimedFp ? (claimedFp.strawberry === (probes.strawberry?.pass === true) ? 100 : 0) : 50, w: capW(claimedFp?.strawberry) };
  scores.knowledge = { v: probes.knowledge?.pass === true ? 100 : probes.knowledge?.pass === 'warn' ? 50 : 30, w: 1 };
  // Low-value probes (noisy signals)
  scores.tempConsist = { v: probes.tempConsist?.pass === true ? 100 : probes.tempConsist?.pass === 'warn' ? 50 : 30, w: 2 };
  scores.longCtx = { v: probes.longCtx?.pass === true ? 100 : probes.longCtx?.pass === 'warn' ? 50 : 20, w: 1 };
  scores.ttft = { v: probes.ttft?.pass === true ? 100 : probes.ttft?.pass === 'warn' ? 50 : 20, w: 1 };
  // New zero-cost probes
  scores.modelField = { v: probes.modelField?.pass === true ? 100 : probes.modelField?.pass === 'warn' ? 50 : 0, w: probes.modelField?.pass === false ? 7 : probes.modelField?.pass === true ? 3 : 0 };
  scores.tokenUsage = { v: probes.tokenUsage?.pass === true ? 100 : probes.tokenUsage?.pass === 'warn' ? 50 : 0, w: probes.tokenUsage?.pass === false ? 5 : probes.tokenUsage?.pass === true ? 2 : 0 };
  // Tokenizer fingerprint (very hard to fake)
  scores.tokenizer = { v: probes.tokenizer?.pass === true ? 100 : probes.tokenizer?.pass === 'warn' ? 50 : 0, w: probes.tokenizer?.pass === false ? 8 : probes.tokenizer?.pass === true ? 4 : 0 };

  if (claimedFp) {
    if (claimedFp.math && probes.math?.pass === false) scores.math.v = 0;
    if (claimedFp.logic && probes.logic?.pass === false) scores.logic.v = 0;
    if (claimedFp.strawberry && probes.strawberry?.pass === false) scores.strawberry.v = 0;
    if (!famMatch && detectedFam !== 'unknown') { scores.identity.v = 0; scores.identity.w = 5; }
  }

  // Tier mismatch penalty: claimed S/A but actual C → significant deduction
  const tierRank = { S: 4, A: 3, B: 2, C: 1, R: 3 };
  const claimedRank = tierRank[claimedFp?.tier] || 0;
  const actualMathOk = probes.math?.pass === true, actualLogicOk = probes.logic?.pass === true, actualStrawOk = probes.strawberry?.pass === true;
  const actualRank = (actualMathOk && actualLogicOk && actualStrawOk) ? 4 : (actualMathOk && actualLogicOk) ? 3 : (actualMathOk || actualLogicOk) ? 2 : 1;
  if (claimedRank > 0 && claimedRank - actualRank >= 2) {
    scores._tierDrop = { v: 0, w: 6 };
  }

  const totalW = Object.values(scores).reduce((a, s) => a + s.w, 0);
  const totalV = Object.values(scores).reduce((a, s) => a + s.v * s.w, 0);
  const finalScore = totalW > 0 ? Math.round(totalV / totalW) : 0;

  // Evidence sufficiency
  const MIN_EVIDENCE = 3;
  const coreProbeKeys = ['identity', 'identityModel', 'math', 'logic', 'strawberry', 'reasoning', 'tempConsist', 'longCtx', 'logprobs', 'ttft', 'modelField', 'tokenUsage', 'tokenizer'];
  let validCount = 0;
  for (const k of coreProbeKeys) {
    if (probes[k] && (probes[k].pass === true || probes[k].pass === false)) validCount++;
  }
  const insufficient = validCount < MIN_EVIDENCE;

  // Suspect model
  let suspect = insufficient ? null : modelId;
  if (!insufficient) {
    const selfId = probes.identityModel?.selfModelId;
    if (selfId && probes.identityModel?.pass === false) {
      const selfFp = findFpMatch(selfId);
      suspect = selfFp ? selfFp.id : selfId;
    } else if (finalScore < 80) {
      let bestMatch = null, bestScore = -1;
      for (const fp of FINGERPRINTS) {
        let ms = 0, mw = 0;
        if (detectedFam === fp.family) { ms += 100 * 4; mw += 4; } else if (detectedFam === 'unknown') { ms += 50 * 4; mw += 4; } else { mw += 4; }
        const hasRT = probes.reasoning?.reasoningToks > 0;
        if (fp.reasoning === hasRT) { ms += 100 * 5; mw += 5; } else { mw += 5; }
        if (fp.math === (probes.math?.pass === true)) { ms += 100 * 2; mw += 2; } else { mw += 2; }
        if (fp.logic === (probes.logic?.pass === true)) { ms += 100 * 2; mw += 2; } else { mw += 2; }
        if (fp.strawberry === (probes.strawberry?.pass === true)) { ms += 100 * 2; mw += 2; } else { mw += 2; }
        const score = mw > 0 ? ms / mw : 0;
        if (score > bestScore) { bestScore = score; bestMatch = fp; }
      }
      if (bestMatch && bestScore > 50) suspect = bestMatch.id;
    }
  }

  // Tier
  const mathOk = probes.math?.pass === true, logicOk = probes.logic?.pass === true, strawOk = probes.strawberry?.pass === true;
  let tier = '?';
  if (insufficient) tier = '—';
  else if (mathOk && logicOk && strawOk) tier = 'S';
  else if (mathOk && logicOk) tier = 'A';
  else if (mathOk || logicOk) tier = 'B';
  else tier = 'C';

  // Verdict: pass / weak / family_mismatch
  // suspect is kept internally for family cross-check, not shown as model name in UI
  const suspectFp = suspect ? findFpMatch(suspect) : null;
  const suspectFam = suspectFp?.family || detectedFam;
  const crossFamily = !insufficient && detectedFam !== 'unknown' && claimedFam !== 'unknown' && detectedFam !== claimedFam;
  const modelFieldCrossFamily = !insufficient && probes.modelField?.pass === false;
  // Dynamic threshold: high-tier models need higher scores to pass
  const tierThreshold = { S: 85, A: 80, B: 75, C: 70, R: 80 };
  const weakThreshold = claimedFp ? (tierThreshold[claimedFp.tier] || 80) : 80;
  let verdict = 'pass';
  if (insufficient) verdict = 'insufficient';
  else if (crossFamily || modelFieldCrossFamily) verdict = 'family_mismatch';
  else if (finalScore < weakThreshold) verdict = 'weak';

  const result = {
    channelId: channel.id,
    model: modelId,
    status: insufficient ? 'insufficient' : 'done',
    score: insufficient ? null : finalScore,
    verdict,
    suspect,
    suspectFamily: crossFamily ? detectedFam : modelFieldCrossFamily ? (probes.modelField?.returnedModel ? detectFamily(probes.modelField.returnedModel) : detectedFam) : null,
    family: insufficient ? null : detectedFam,
    claimedFamily: claimedFam !== 'unknown' ? claimedFam : null,
    tier,
    probes,
    scores,
    validCount,
  };

  // Persist to DB
  store.saveDetectResult(result);
  log(`Done: score=${finalScore}, verdict=${verdict}, tier=${tier}`);
  return result;
}

// ── Detect all models in a channel ──
async function detectChannel(channel, onProgress) {
  const results = [];
  for (const modelId of channel.models) {
    try {
      const r = await detectModel(channel, modelId, (msg) => {
        if (onProgress) onProgress(`[${modelId}] ${msg}`);
      });
      results.push(r);
    } catch (e) {
      results.push({ channelId: channel.id, model: modelId, status: 'error', error: e.message });
      if (onProgress) onProgress(`[${modelId}] Error: ${e.message}`);
    }
  }
  return results;
}

// ══════════════════════════════════════════
// DEEP DETECTION ENGINE (5-dim delta tokenizer)
// ══════════════════════════════════════════
async function deepDetect(channel, modelId, onProgress) {
  const key = channel.keys[0];
  const _api = (msgs, opts = {}) => apiCall(channel.endpoint, key, modelId, msgs, opts, channel.type);
  const log = (msg) => { if (onProgress) onProgress(msg); };

  const REPEATS = 3;
  const probeKeys = ['EN', 'CN', 'CODE', 'NUM', 'JP'];
  const allDeltas = { EN: [], CN: [], CODE: [], NUM: [], JP: [] };
  const latencies = [];
  const baselines = [];

  // Extract reliable prompt token count from usage object
  const getPromptToks = (usage) => {
    if (!usage) return 0;
    const pt = usage.prompt_tokens || 0;
    const ct = usage.completion_tokens || 0;
    const tt = usage.total_tokens || 0;
    if (tt > 0 && ct > 0 && tt >= ct) return tt - ct;
    return pt;
  };

  // ── Phase 1: Tokenizer fingerprint (delta method × 3 rounds) ──
  for (let round = 0; round < REPEATS; round++) {
    log(`[${round + 1}/${REPEATS}] 测量 tokenizer 指纹...`);
    try {
      const t0 = Date.now();
      const baseResp = await _api([{ role: 'user', content: 'x' }], { temperature: 0, max_tokens: 1 });
      const baselineToks = getPromptToks(baseResp.usage);
      baselines.push(baselineToks);
      latencies.push(Date.now() - t0);
      log(`  baseline[${round}]: ${baselineToks} (raw pt=${baseResp.usage?.prompt_tokens||0} ct=${baseResp.usage?.completion_tokens||0} tt=${baseResp.usage?.total_tokens||0})`);
      if (!baselineToks) { log(`  ⚠ Round ${round + 1}: no baseline tokens`); continue; }

      // Early abort: if baseline drifted >20 from round 0, overhead is variable
      if (baselines.length > 1 && Math.abs(baselineToks - baselines[0]) > 20) {
        log(`  ⚠ baseline 漂移 ${baselines[0]}→${baselineToks} (Δ${Math.abs(baselineToks - baselines[0])}), 渠道 overhead 不稳定，跳过 tokenizer`);
        break;
      }

      for (let i = 0; i < probeKeys.length; i += 2) {
        const batch = probeKeys.slice(i, i + 2);
        const results = await Promise.all(batch.map(async (pk) => {
          const resp = await _api([{ role: 'user', content: PROBE_TEXTS[pk] }], { temperature: 0, max_tokens: 1 });
          return { key: pk, toks: getPromptToks(resp.usage) };
        }));
        for (const r of results) {
          const delta = r.toks - baselineToks;
          if (r.toks > 0 && delta > 0 && delta < 50) {
            allDeltas[r.key].push(delta);
          }
        }
      }
    } catch (e) {
      log(`  ✗ Round ${round + 1} error: ${e.message.slice(0, 60)}`);
    }
  }

  // Baseline consistency check
  const baselineStable = baselines.length >= 2 && (Math.max(...baselines) - Math.min(...baselines)) <= 20;
  const tokReliable = baselineStable || baselines.length < 2;

  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const measured = probeKeys.map(k => median(allDeltas[k]));
  const hasFull = measured.every(v => v !== null);

  log(`  实测指纹: EN=${measured[0]}, CN=${measured[1]}, CODE=${measured[2]}, NUM=${measured[3]}, JP=${measured[4]}${!tokReliable ? ' [overhead 不稳定]' : ''}`);

  // ── Phase 2: Behavioral fingerprint (1 API call) ──
  log('行为指纹测试...');
  let behavioral = {};
  try {
    const bhResp = await _api([{ role: 'user', content: `Answer in strict JSON:\n{"strawberry": "How many r in strawberry? number only", "math": "13*17=? number only", "self_id": "What AI model are you? one sentence"}` }], { temperature: 0, max_tokens: 200 });
    const bhText = bhResp.choices?.[0]?.message?.content || '';
    let bhParsed;
    try { bhParsed = JSON.parse(extractFirstJson(bhText)); } catch (_) { bhParsed = {}; }
    behavioral = {
      strawberry: parseInt(String(bhParsed.strawberry || '').replace(/[^0-9]/g, '')) || null,
      math: parseInt(String(bhParsed.math || '').replace(/[^0-9]/g, '')) || null,
      selfId: String(bhParsed.self_id || '').slice(0, 100),
    };
    log(`  strawberry: ${behavioral.strawberry}${behavioral.strawberry === 3 ? ' ✓' : ' ✗'}`);
    log(`  math 13×17: ${behavioral.math}${behavioral.math === 221 ? ' ✓' : ' ✗'}`);
    log(`  self_id: ${behavioral.selfId.slice(0, 50)}`);
  } catch (e) {
    log(`  ✗ 行为测试失败: ${e.message.slice(0, 50)}`);
  }

  // ── Self-ID reverse lookup: infer family from self-identification ──
  const SELF_ID_PATTERNS = [
    { re: /claude/i, family: 'anthropic', name: 'Claude' },
    { re: /gpt[-\s]?4o/i, family: 'openai', name: 'GPT-4o' },
    { re: /gpt[-\s]?4/i, family: 'openai', name: 'GPT-4' },
    { re: /gpt[-\s]?3/i, family: 'openai', name: 'GPT-3.5' },
    { re: /openai/i, family: 'openai', name: 'OpenAI model' },
    { re: /gemini/i, family: 'google', name: 'Gemini' },
    { re: /deepseek/i, family: 'deepseek', name: 'DeepSeek' },
    { re: /qwen/i, family: 'qwen', name: 'Qwen' },
    { re: /llama/i, family: 'meta', name: 'Llama' },
    { re: /mistral|mixtral/i, family: 'mistral', name: 'Mistral' },
    { re: /grok/i, family: 'xai', name: 'Grok' },
    { re: /kimi|moonshot/i, family: 'moonshot', name: 'Kimi' },
    { re: /glm|chatglm/i, family: 'zhipu', name: 'GLM' },
    { re: /ernie|wenxin|文心/i, family: 'baidu', name: 'ERNIE' },
    { re: /doubao|豆包/i, family: 'bytedance', name: 'Doubao' },
    { re: /minimax|abab/i, family: 'minimax', name: 'MiniMax' },
    { re: /yi[-\s]?light|yi[-\s]?large|零一/i, family: 'yi', name: 'Yi' },
    { re: /kiro/i, family: 'anthropic', name: 'Kiro (Claude-based)' },
    { re: /copilot/i, family: 'openai', name: 'Copilot (OpenAI-based)' },
    { re: /cursor/i, family: 'anthropic/openai', name: 'Cursor' },
  ];
  let selfIdMatch = null;
  if (behavioral.selfId) {
    for (const p of SELF_ID_PATTERNS) {
      if (p.re.test(behavioral.selfId)) { selfIdMatch = p; break; }
    }
    if (selfIdMatch) log(`  self-ID 反查: ${selfIdMatch.name} (${selfIdMatch.family})`);
  }
  behavioral.selfIdMatch = selfIdMatch;

  // ── Phase 3: Match against database ──
  let candidates = [];
  let confidence = { level: 'none', label: '✗ 无法匹配', labelEn: '✗ Cannot match' };
  if (hasFull && tokReliable) {
    candidates = matchFingerprint(measured).slice(0, 8);
    confidence = classifyConfidence(candidates[0]?.distance || 999);
    log(`匹配结果: ${confidence.label} → ${candidates[0]?.name} (d=${candidates[0]?.distance.toFixed(2)})`);
  } else if (!tokReliable && selfIdMatch) {
    // Tokenizer unreliable but self-ID gives us a clue
    confidence = { level: 'behavioral', label: `⚡ 行为推断: ${selfIdMatch.name}`, labelEn: `⚡ Behavioral: ${selfIdMatch.name}` };
    log(`Tokenizer 不可用，基于行为推断: ${selfIdMatch.name} (${selfIdMatch.family})`);
  } else if (hasFull && !tokReliable) {
    log(`⚠ baseline 不稳定但指纹完整，尝试匹配（低可信度）`);
    candidates = matchFingerprint(measured).slice(0, 8);
    const cls = classifyConfidence(candidates[0]?.distance || 999);
    confidence = { level: 'low', label: `⚠ 低可信: ${cls.label}`, labelEn: `⚠ Low conf: ${cls.labelEn}` };
  } else {
    const missing = probeKeys.filter((k, i) => measured[i] === null);
    log(`⚠ 指纹不完整 (${missing.join(',')})，该渠道可能不返回准确的 token 计数`);
  }

  // Latency classification
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const latencyTier = avgLatency ? classifyLatency(avgLatency) : null;

  const result = {
    channelId: channel.id,
    model: modelId,
    status: hasFull && tokReliable ? 'done' : 'partial',
    tokReliable,
    measured: { EN: measured[0], CN: measured[1], CODE: measured[2], NUM: measured[3], JP: measured[4] },
    baselines,
    rawDeltas: allDeltas,
    candidates: candidates.map(c => ({ name: c.name, family: c.family, distance: +c.distance.toFixed(2), known: c.known })),
    confidence,
    behavioral,
    latency: { avgMs: avgLatency, tier: latencyTier },
    ts: Date.now(),
  };

  return result;
}

module.exports = { detectModel, detectChannel, deepDetect };
