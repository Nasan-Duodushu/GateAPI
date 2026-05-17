// ══════════════════════════════════════════
// 52-Model Tokenizer Fingerprint Database
// Source: 樱子 real tiktoken measurements (2026-05-17)
// Each entry: [EN, CN, CODE, NUM, JP] — pure text tokens (no message overhead)
// ══════════════════════════════════════════

// Probe texts (must match deep detection probes exactly)
const PROBE_TEXTS = {
  EN:   'The quick brown fox jumps over the lazy dog',
  CN:   '今天天气真好，我们一起去公园散步吧',
  CODE: 'def fib(n): return n if n<=1 else fib(n-1)+fib(n-2)',
  NUM:  '1234567890 3.14159 2.71828 1.41421 0.57721',
  JP:   '東京タワーから富士山が見えます',
};

// Weights: CN strongest, NUM second, JP third, EN/CODE weakest
const PROBE_WEIGHTS = [1.0, 2.5, 1.0, 2.0, 1.5]; // EN, CN, CODE, NUM, JP

// Known model fingerprints: [EN, CN, CODE, NUM, JP]
const MODEL_DB = [
  // ── CN=7 (special) ──
  { name: 'Orion-14B',                  family: 'orion',     tokens: [10,  7, 20, 24,  7] },

  // ── CN=9 (CJK top) ──
  { name: 'DeepSeek V3 / R1',           family: 'deepseek',  tokens: [ 9,  9, 20, 24,  9] },
  { name: 'GLM-4 / Z1',                 family: 'glm',       tokens: [ 9,  9, 20, 29,  9] },
  { name: 'MiniMax Text-01 / M1',       family: 'minimax',   tokens: [ 9,  9, 20, 24,  6] },
  { name: 'Kimi K2',                    family: 'kimi',      tokens: [ 9,  9, 20, 24,  9] },
  { name: 'Baichuan 2/3/4',             family: 'baichuan',  tokens: [ 9,  9, 20, 42,  9] },
  { name: 'Aquila 2',                   family: 'aquila',    tokens: [ 9,  9, 20, 24,  9] },
  { name: 'ChatGLM3',                   family: 'glm',       tokens: [ 9,  9, 20, 24,  9] },

  // ── CN=10 (CJK good) ──
  { name: 'Qwen 1.5-3',                 family: 'qwen',      tokens: [10, 10, 20, 42, 10] },
  { name: 'Yi 1.0/1.5',                 family: 'yi',        tokens: [10, 10, 20, 43, 10] },
  { name: 'DeepSeek V2 / Coder V2',     family: 'deepseek',  tokens: [10, 10, 20, 42, 10] },
  { name: 'Doubao / Seed-Coder',        family: 'doubao',    tokens: [10, 10, 20, 24, 10] },
  { name: 'MiniCPM',                    family: 'minicpm',   tokens: [10, 10, 20, 24, 10] },
  { name: 'ERNIE / 文心一言',           family: 'ernie',     tokens: [10, 10, 20, 22, 10] },

  // ── CN=12 (modern) ──
  { name: 'Gemini 1.5/2.0/2.5',         family: 'google',    tokens: [10, 12, 20, 20, 11] },

  // ── CN=13 (modern) ──
  { name: 'GPT-4o / 4.1 / o-series',    family: 'openai',    tokens: [10, 13, 20, 24, 11] },
  { name: 'Llama 3/3.1/3.3/4',          family: 'meta',      tokens: [10, 13, 20, 24, 13] },

  // ── CN=16 (mid) ──
  { name: 'Claude 3/3.5/4 (Anthropic)',  family: 'anthropic', tokens: [11, 16, 22, 22, 14] },
  { name: 'Mistral Small 24B',          family: 'mistral',   tokens: [10, 16, 20, 42, 14] },

  // ── CN=18 (mid) ──
  { name: 'Mistral 7B / Mixtral',       family: 'mistral',   tokens: [11, 18, 20, 42, 16] },
  { name: 'InternLM 3',                 family: 'internlm',  tokens: [11, 18, 20, 42, 16] },

  // ── CN=20 (legacy) ──
  { name: 'GPT-4 / 4-Turbo / 3.5-Turbo', family: 'openai',  tokens: [10, 20, 20, 24, 18] },
  { name: 'Phi-4 / OLMo 2',            family: 'phi',       tokens: [10, 20, 20, 43, 18] },

  // ── CN=26+ (poor) ──
  { name: 'Grok-1',                     family: 'grok',      tokens: [10, 26, 20, 43, 22] },
  { name: 'CodeLlama / Llama 2',        family: 'meta',      tokens: [10, 28, 20, 42, 24] },
  { name: 'Phi-3 / Snowflake Arctic',   family: 'phi',       tokens: [10, 28, 20, 42, 24] },

  // ── CN=33+ (worst) ──
  { name: 'GPT-3 / GPT-2',             family: 'openai',    tokens: [10, 33, 20, 20, 28] },
  { name: 'Phi-2',                      family: 'phi',       tokens: [10, 33, 20, 20, 28] },
  { name: 'SmolLM 2',                   family: 'smollm',    tokens: [10, 35, 20, 42, 30] },
];

// Calculate weighted Euclidean distance
function calcDistance(measured, known) {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    const d = measured[i] - known[i];
    sum += PROBE_WEIGHTS[i] * d * d;
  }
  return Math.sqrt(sum);
}

// Match measured fingerprint against database, return sorted candidates
function matchFingerprint(measured) {
  const results = MODEL_DB.map(m => ({
    name: m.name,
    family: m.family,
    known: m.tokens,
    distance: calcDistance(measured, m.tokens),
  }));
  results.sort((a, b) => a.distance - b.distance);
  return results;
}

// Classify match confidence
function classifyConfidence(distance) {
  if (distance < 1.0)  return { level: 'exact',  label: '★ 精确匹配',    labelEn: '★ Exact Match' };
  if (distance < 3.0)  return { level: 'high',   label: '● 高置信度',    labelEn: '● High Confidence' };
  if (distance < 6.0)  return { level: 'medium', label: '◐ 中置信度',    labelEn: '◐ Medium Confidence' };
  if (distance < 10.0) return { level: 'low',    label: '○ 低置信度',    labelEn: '○ Low Confidence' };
  return                       { level: 'none',   label: '✗ 无匹配',      labelEn: '✗ No Match' };
}

// Latency tier classification
function classifyLatency(avgMs) {
  if (avgMs < 1500)  return { tier: 'fast',     label: 'Haiku/Mini/Flash 级' };
  if (avgMs < 3500)  return { tier: 'standard', label: 'Sonnet/4o/Pro 级' };
  if (avgMs < 8000)  return { tier: 'heavy',    label: 'Opus/o1/Ultra 级' };
  return              { tier: 'thinking', label: 'o3/R1 推理模型级' };
}

module.exports = { PROBE_TEXTS, PROBE_WEIGHTS, MODEL_DB, matchFingerprint, classifyConfidence, classifyLatency };
