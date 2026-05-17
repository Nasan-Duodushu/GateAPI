const FINGERPRINTS = [
// ══════════════════════════════════════
// OpenAI — GPT-5.x series
// ══════════════════════════════════════
{id:'gpt-5.5',aliases:['gpt-5-5','gpt-5.5-0516'],family:'openai',tier:'S',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2026-01',identityKw:['chatgpt','gpt-5.5','gpt-5','openai'],behavior:'direct',structured:.99,encoding:true,multilingual:.97,toksRange:[50,110]},
{id:'gpt-5.5-pro',aliases:['gpt-5-5-pro'],family:'openai',tier:'S',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2026-01',identityKw:['chatgpt','gpt-5.5','gpt-5','openai'],behavior:'direct',structured:.99,encoding:true,multilingual:.97,toksRange:[40,100]},
{id:'gpt-5.4',aliases:['gpt-5-4','gpt-5.4-0516'],family:'openai',tier:'S',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['chatgpt','gpt-5.4','gpt-5','openai'],behavior:'direct',structured:.99,encoding:true,multilingual:.96,toksRange:[60,120]},
{id:'gpt-5.4-pro',aliases:['gpt-5-4-pro'],family:'openai',tier:'S',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['chatgpt','gpt-5.4','gpt-5','openai'],behavior:'direct',structured:.99,encoding:true,multilingual:.96,toksRange:[50,110]},
{id:'gpt-5.4-mini',aliases:['gpt-5-4-mini'],family:'openai',tier:'A',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['chatgpt','gpt-5.4-mini','gpt-5','openai'],behavior:'direct',structured:.97,encoding:true,multilingual:.93,toksRange:[80,150]},
{id:'gpt-5.4-nano',aliases:['gpt-5-4-nano'],family:'openai',tier:'B',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-06',identityKw:['chatgpt','gpt-5.4-nano','gpt-5','openai'],behavior:'direct',structured:.93,encoding:true,multilingual:.88,toksRange:[100,180]},
{id:'gpt-5.3',aliases:['gpt-5-3'],family:'openai',tier:'S',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['chatgpt','gpt-5.3','gpt-5','openai'],behavior:'direct',structured:.98,encoding:true,multilingual:.96,toksRange:[60,120]},
{id:'gpt-5.2',aliases:['gpt-5-2'],family:'openai',tier:'S',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['chatgpt','gpt-5.2','gpt-5','openai'],behavior:'direct',structured:.98,encoding:true,multilingual:.95,toksRange:[60,120]},
{id:'gpt-5.1',aliases:['gpt-5-1'],family:'openai',tier:'S',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['chatgpt','gpt-5.1','gpt-5','openai'],behavior:'direct',structured:.98,encoding:true,multilingual:.95,toksRange:[60,120]},
{id:'gpt-5',aliases:['gpt-5-0326'],family:'openai',tier:'S',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['chatgpt','gpt-5','openai'],behavior:'direct',structured:.98,encoding:true,multilingual:.95,toksRange:[60,120]},
{id:'gpt-5-pro',aliases:['gpt-5-pro-0326'],family:'openai',tier:'S',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['chatgpt','gpt-5','openai'],behavior:'direct',structured:.98,encoding:true,multilingual:.95,toksRange:[50,100]},
{id:'gpt-5-mini',aliases:['gpt-5-mini-0326'],family:'openai',tier:'A',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['chatgpt','gpt-5-mini','gpt-5','openai'],behavior:'direct',structured:.95,encoding:true,multilingual:.90,toksRange:[80,160]},
{id:'gpt-5-nano',aliases:['gpt-5-nano-0326'],family:'openai',tier:'B',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['chatgpt','gpt-5-nano','gpt-5','openai'],behavior:'direct',structured:.90,encoding:true,multilingual:.85,toksRange:[100,180]},
// ── OpenAI — GPT-4.x series ──
{id:'gpt-4.1',aliases:['gpt-4-1','gpt-4.1-2025-04-14'],family:'openai',tier:'A',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['chatgpt','gpt-4.1','gpt-4','openai'],behavior:'direct',structured:.97,encoding:true,multilingual:.93,toksRange:[60,130]},
{id:'gpt-4.1-mini',aliases:['gpt-4-1-mini','gpt-4.1-mini-2025-04-14'],family:'openai',tier:'B',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['chatgpt','gpt-4.1-mini','gpt-4','openai'],behavior:'direct',structured:.93,encoding:true,multilingual:.87,toksRange:[80,160]},
{id:'gpt-4.1-nano',aliases:['gpt-4-1-nano','gpt-4.1-nano-2025-04-14'],family:'openai',tier:'C',tokVar:'o200k',reasoning:false,math:true,logic:false,strawberry:false,knowledge:'2025-03',identityKw:['chatgpt','gpt-4.1-nano','gpt-4','openai'],behavior:'direct',structured:.88,encoding:false,multilingual:.80,toksRange:[100,200]},
{id:'gpt-4.5-preview',aliases:['gpt-4-5-preview'],family:'openai',tier:'A',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-02',identityKw:['chatgpt','gpt-4.5','gpt-4','openai'],behavior:'direct',structured:.97,encoding:true,multilingual:.93,toksRange:[40,80]},
{id:'gpt-4o',aliases:['gpt-4o-2024','gpt-4o-2024-08-06','gpt-4o-2024-11-20','gpt-4o-latest','chatgpt-4o-latest'],family:'openai',tier:'A',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2024-10',identityKw:['chatgpt','gpt-4o','openai'],behavior:'direct',structured:.97,encoding:true,multilingual:.92,toksRange:[80,130]},
{id:'gpt-4o-mini',aliases:['gpt-4o-mini-2024','gpt-4o-mini-2024-07-18'],family:'openai',tier:'B',tokVar:'o200k',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-07',identityKw:['chatgpt','gpt-4o-mini','openai'],behavior:'direct',structured:.93,encoding:true,multilingual:.85,toksRange:[100,160]},
{id:'gpt-4-turbo',aliases:['gpt-4-turbo-2024','gpt-4-turbo-2024-04-09','gpt-4-1106-preview','gpt-4-0125-preview'],family:'openai',tier:'A',tokVar:'cl100k',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-04',identityKw:['chatgpt','gpt-4-turbo','gpt-4','openai'],behavior:'direct',structured:.95,encoding:true,multilingual:.90,toksRange:[40,80]},
{id:'gpt-4',aliases:['gpt-4-0613','gpt-4-0314'],family:'openai',tier:'A',tokVar:'cl100k',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2023-09',identityKw:['chatgpt','gpt-4','openai'],behavior:'direct',structured:.93,encoding:true,multilingual:.88,toksRange:[20,50]},
{id:'gpt-3.5-turbo',aliases:['gpt-3.5-turbo-0125','gpt-3.5-turbo-1106','gpt-3.5-turbo-0613','gpt-35-turbo'],family:'openai',tier:'C',tokVar:'cl100k',reasoning:false,math:false,logic:false,strawberry:false,knowledge:'2021-09',identityKw:['chatgpt','gpt-3.5','openai'],behavior:'direct',structured:.75,encoding:false,multilingual:.65,toksRange:[80,150]},
// ── OpenAI — o-series (reasoning models) ──
{id:'o4',aliases:['o4-2025'],family:'openai',tier:'R',tokVar:'o200k',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['chatgpt','o4','openai'],behavior:'reasoning',structured:.97,encoding:true,multilingual:.93,toksRange:[8,30]},
{id:'o4-mini',aliases:['o4-mini-2025','o4-mini-2025-04-16'],family:'openai',tier:'R',tokVar:'o200k',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['chatgpt','o4-mini','o4','openai'],behavior:'reasoning',structured:.95,encoding:true,multilingual:.90,toksRange:[15,50]},
{id:'o3',aliases:['o3-2025','o3-2025-04-16'],family:'openai',tier:'R',tokVar:'o200k',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['chatgpt','o3','openai'],behavior:'reasoning',structured:.97,encoding:true,multilingual:.93,toksRange:[10,40]},
{id:'o3-pro',aliases:['o3-pro-2025'],family:'openai',tier:'R',tokVar:'o200k',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['chatgpt','o3-pro','o3','openai'],behavior:'reasoning',structured:.98,encoding:true,multilingual:.95,toksRange:[5,25]},
{id:'o3-mini',aliases:['o3-mini-2025','o3-mini-2025-01-31'],family:'openai',tier:'R',tokVar:'o200k',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['chatgpt','o3-mini','openai'],behavior:'reasoning',structured:.92,encoding:true,multilingual:.85,toksRange:[20,60]},
{id:'o1',aliases:['o1-2024','o1-2024-12-17'],family:'openai',tier:'R',tokVar:'o200k',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2024-10',identityKw:['chatgpt','o1','openai'],behavior:'reasoning',structured:.95,encoding:true,multilingual:.90,toksRange:[10,40]},
{id:'o1-pro',aliases:['o1-pro-2025'],family:'openai',tier:'R',tokVar:'o200k',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2024-10',identityKw:['chatgpt','o1-pro','o1','openai'],behavior:'reasoning',structured:.96,encoding:true,multilingual:.92,toksRange:[5,30]},
{id:'o1-mini',aliases:['o1-mini-2024','o1-mini-2024-09-12'],family:'openai',tier:'R',tokVar:'o200k',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2024-07',identityKw:['chatgpt','o1-mini','openai'],behavior:'reasoning',structured:.90,encoding:true,multilingual:.82,toksRange:[20,60]},
{id:'o1-preview',aliases:['o1-preview-2024','o1-preview-2024-09-12'],family:'openai',tier:'R',tokVar:'o200k',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2024-07',identityKw:['chatgpt','o1-preview','o1','openai'],behavior:'reasoning',structured:.93,encoding:true,multilingual:.88,toksRange:[10,40]},
// ══════════════════════════════════════
// Anthropic — Claude 4.x
// ══════════════════════════════════════
{id:'claude-opus-4.7',aliases:['claude-opus-4-7','claude-opus-4-7-20250517'],family:'anthropic',tier:'S',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['claude','anthropic','opus'],behavior:'helpful',structured:.98,encoding:true,multilingual:.95,toksRange:[40,90]},
{id:'claude-opus-4.6',aliases:['claude-opus-4-6','claude-opus-4-6-20250414'],family:'anthropic',tier:'S',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['claude','anthropic','opus'],behavior:'helpful',structured:.98,encoding:true,multilingual:.95,toksRange:[40,90]},
{id:'claude-opus-4.5',aliases:['claude-opus-4-5'],family:'anthropic',tier:'S',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-04',identityKw:['claude','anthropic','opus'],behavior:'helpful',structured:.97,encoding:true,multilingual:.94,toksRange:[40,90]},
{id:'claude-opus-4.1',aliases:['claude-opus-4-1'],family:'anthropic',tier:'S',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['claude','anthropic','opus'],behavior:'helpful',structured:.97,encoding:true,multilingual:.94,toksRange:[40,90]},
{id:'claude-opus-4',aliases:['claude-opus-4-0','claude-opus-4-20250318'],family:'anthropic',tier:'A',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['claude','anthropic','opus'],behavior:'helpful',structured:.96,encoding:true,multilingual:.93,toksRange:[40,90]},
{id:'claude-sonnet-4.6',aliases:['claude-sonnet-4-6'],family:'anthropic',tier:'A',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['claude','anthropic','sonnet'],behavior:'helpful',structured:.97,encoding:true,multilingual:.93,toksRange:[60,120]},
{id:'claude-sonnet-4.5',aliases:['claude-sonnet-4-5','claude-sonnet-4-5-20250414'],family:'anthropic',tier:'A',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-04',identityKw:['claude','anthropic','sonnet'],behavior:'helpful',structured:.96,encoding:true,multilingual:.92,toksRange:[60,120]},
{id:'claude-sonnet-4',aliases:['claude-sonnet-4-0','claude-sonnet-4-20250318'],family:'anthropic',tier:'A',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['claude','anthropic','sonnet'],behavior:'helpful',structured:.95,encoding:true,multilingual:.91,toksRange:[60,120]},
{id:'claude-4.5-haiku',aliases:['claude-haiku-4-5','claude-haiku-4.5'],family:'anthropic',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['claude','anthropic','haiku'],behavior:'helpful',structured:.92,encoding:true,multilingual:.85,toksRange:[80,160]},
// ── Anthropic — Claude 3.x ──
{id:'claude-3.7-sonnet',aliases:['claude-3-7-sonnet','claude-3-7-sonnet-latest','claude-3-7-sonnet-20250219'],family:'anthropic',tier:'A',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-02',identityKw:['claude','anthropic','sonnet'],behavior:'helpful',structured:.96,encoding:true,multilingual:.92,toksRange:[50,100]},
{id:'claude-3.5-sonnet',aliases:['claude-3-5-sonnet','claude-3-5-sonnet-20241022','claude-3-5-sonnet-20240620','claude-3-5-sonnet-latest','claude-3-5-sonnet-v2'],family:'anthropic',tier:'A',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2024-04',identityKw:['claude','anthropic','sonnet'],behavior:'helpful',structured:.96,encoding:true,multilingual:.92,toksRange:[50,100]},
{id:'claude-3.5-haiku',aliases:['claude-3-5-haiku','claude-3-5-haiku-20241022','claude-3-5-haiku-latest'],family:'anthropic',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-07',identityKw:['claude','anthropic','haiku'],behavior:'helpful',structured:.88,encoding:false,multilingual:.80,toksRange:[80,150]},
{id:'claude-3-opus',aliases:['claude-3-opus-20240229','claude-3-opus-latest'],family:'anthropic',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-02',identityKw:['claude','anthropic','opus'],behavior:'helpful',structured:.94,encoding:true,multilingual:.90,toksRange:[20,50]},
{id:'claude-3-sonnet',aliases:['claude-3-sonnet-20240229'],family:'anthropic',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-02',identityKw:['claude','anthropic','sonnet'],behavior:'helpful',structured:.88,encoding:false,multilingual:.82,toksRange:[60,120]},
{id:'claude-3-haiku',aliases:['claude-3-haiku-20240307'],family:'anthropic',tier:'C',reasoning:false,math:false,logic:true,strawberry:false,knowledge:'2024-02',identityKw:['claude','anthropic','haiku'],behavior:'helpful',structured:.80,encoding:false,multilingual:.72,toksRange:[100,180]},
// ══════════════════════════════════════
// Google — Gemini
// ══════════════════════════════════════
{id:'gemini-3.1-pro',aliases:['gemini-3-1-pro','gemini-3.1-pro-latest'],family:'google',tier:'S',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2026-01',identityKw:['gemini','google'],behavior:'analytical',structured:.97,encoding:true,multilingual:.95,toksRange:[60,120]},
{id:'gemini-3-pro',aliases:['gemini-3.0-pro','gemini-3-pro-latest'],family:'google',tier:'S',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['gemini','google'],behavior:'analytical',structured:.96,encoding:true,multilingual:.94,toksRange:[60,120]},
{id:'gemini-3-flash',aliases:['gemini-3.0-flash','gemini-3-flash-latest'],family:'google',tier:'A',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['gemini','google'],behavior:'analytical',structured:.94,encoding:true,multilingual:.90,toksRange:[100,200]},
{id:'gemini-2.5-pro',aliases:['gemini-2-5-pro','gemini-2.5-pro-latest','gemini-2.5-pro-preview-0506'],family:'google',tier:'A',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['gemini','google'],behavior:'analytical',structured:.95,encoding:true,multilingual:.92,toksRange:[40,100]},
{id:'gemini-2.5-flash',aliases:['gemini-2-5-flash','gemini-2.5-flash-latest','gemini-2.5-flash-preview-0417'],family:'google',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['gemini','google'],behavior:'analytical',structured:.90,encoding:true,multilingual:.85,toksRange:[80,160]},
{id:'gemini-2.0-flash',aliases:['gemini-2-0-flash','gemini-2.0-flash-001','gemini-2.0-flash-latest'],family:'google',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-08',identityKw:['gemini','google'],behavior:'analytical',structured:.88,encoding:true,multilingual:.82,toksRange:[80,160]},
{id:'gemini-2.0-flash-lite',aliases:['gemini-2-0-flash-lite','gemini-2.0-flash-lite-001'],family:'google',tier:'C',reasoning:false,math:true,logic:false,strawberry:false,knowledge:'2024-08',identityKw:['gemini','google'],behavior:'analytical',structured:.82,encoding:false,multilingual:.75,toksRange:[100,200]},
{id:'gemini-1.5-pro',aliases:['gemini-1-5-pro','gemini-1.5-pro-latest','gemini-1.5-pro-002','gemini-1.5-pro-001'],family:'google',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-04',identityKw:['gemini','google'],behavior:'analytical',structured:.92,encoding:true,multilingual:.88,toksRange:[40,100]},
{id:'gemini-1.5-flash',aliases:['gemini-1-5-flash','gemini-1.5-flash-latest','gemini-1.5-flash-002','gemini-1.5-flash-001'],family:'google',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-04',identityKw:['gemini','google'],behavior:'analytical',structured:.85,encoding:false,multilingual:.80,toksRange:[80,160]},
{id:'gemini-1.0-pro',aliases:['gemini-1-0-pro','gemini-pro'],family:'google',tier:'B',reasoning:false,math:true,logic:false,strawberry:false,knowledge:'2024-02',identityKw:['gemini','google'],behavior:'analytical',structured:.80,encoding:false,multilingual:.72,toksRange:[60,120]},
// ══════════════════════════════════════
// DeepSeek
// ══════════════════════════════════════
{id:'deepseek-v4',aliases:['deepseek-v4-pro','deepseek-chat-v4'],family:'deepseek',tier:'S',tokVar:'ds_v3',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['deepseek'],behavior:'thorough',structured:.96,encoding:true,multilingual:.93,toksRange:[40,100]},
{id:'deepseek-v4-flash',aliases:['deepseek-v4-flash-high'],family:'deepseek',tier:'A',tokVar:'ds_v3',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['deepseek'],behavior:'thorough',structured:.93,encoding:true,multilingual:.90,toksRange:[80,160]},
{id:'deepseek-v3',aliases:['deepseek-chat','deepseek-v3-0324'],family:'deepseek',tier:'A',tokVar:'ds_v3',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['deepseek'],behavior:'thorough',structured:.93,encoding:true,multilingual:.90,toksRange:[40,100]},
{id:'deepseek-r1',aliases:['deepseek-reasoner','deepseek-r1-250120'],family:'deepseek',tier:'R',tokVar:'ds_v3',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2025-01',identityKw:['deepseek','r1'],behavior:'reasoning',structured:.90,encoding:true,multilingual:.88,toksRange:[15,50]},
{id:'deepseek-r1-lite',aliases:['deepseek-r1-lite-preview'],family:'deepseek',tier:'R',tokVar:'ds_v3',reasoning:true,math:true,logic:true,strawberry:false,knowledge:'2025-01',identityKw:['deepseek','r1'],behavior:'reasoning',structured:.85,encoding:true,multilingual:.82,toksRange:[20,60]},
{id:'deepseek-v2.5',aliases:['deepseek-v2-5','deepseek-chat-v2.5'],family:'deepseek',tier:'A',tokVar:'ds_v2',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-09',identityKw:['deepseek'],behavior:'thorough',structured:.88,encoding:true,multilingual:.85,toksRange:[40,100]},
{id:'deepseek-coder-v2',aliases:['deepseek-coder-v2-0724','deepseek-coder'],family:'deepseek',tier:'B',tokVar:'ds_v2',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-07',identityKw:['deepseek','coder'],behavior:'thorough',structured:.85,encoding:true,multilingual:.78,toksRange:[40,100]},
// ══════════════════════════════════════
// Qwen (Alibaba)
// ══════════════════════════════════════
{id:'qwen3.5-397b',aliases:['qwen3-5-397b-a17b','qwen3.5-a17b'],family:'qwen',tier:'S',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['qwen','tongyi'],behavior:'structured',structured:.96,encoding:true,multilingual:.94,toksRange:[40,100]},
{id:'qwen3.5-72b',aliases:['qwen3-5-72b'],family:'qwen',tier:'A',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-06',identityKw:['qwen','tongyi'],behavior:'structured',structured:.94,encoding:true,multilingual:.90,toksRange:[40,100]},
{id:'qwen3-235b',aliases:['qwen3-235b-a22b','qwen3-235b-instruct'],family:'qwen',tier:'S',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-04',identityKw:['qwen','tongyi'],behavior:'structured',structured:.95,encoding:true,multilingual:.92,toksRange:[40,100]},
{id:'qwen3-32b',aliases:['qwen3-32b-instruct','qwen3-32b-a3b'],family:'qwen',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-04',identityKw:['qwen','tongyi'],behavior:'structured',structured:.90,encoding:true,multilingual:.88,toksRange:[50,120]},
{id:'qwen3-30b-a3b',aliases:['qwen3-30b'],family:'qwen',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-04',identityKw:['qwen','tongyi'],behavior:'structured',structured:.88,encoding:true,multilingual:.85,toksRange:[50,120]},
{id:'qwq-32b',aliases:['qwq-32b-preview'],family:'qwen',tier:'R',reasoning:true,math:true,logic:true,strawberry:true,knowledge:'2025-03',identityKw:['qwen','qwq','tongyi'],behavior:'reasoning',structured:.90,encoding:true,multilingual:.85,toksRange:[15,50]},
{id:'qwen2.5-72b',aliases:['qwen2-5-72b-instruct','qwen2.5-72b-instruct'],family:'qwen',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-09',identityKw:['qwen','tongyi'],behavior:'structured',structured:.90,encoding:true,multilingual:.88,toksRange:[40,100]},
{id:'qwen2.5-coder-32b',aliases:['qwen2-5-coder-32b-instruct'],family:'qwen',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-09',identityKw:['qwen','tongyi'],behavior:'structured',structured:.88,encoding:true,multilingual:.82,toksRange:[40,100]},
{id:'qwen-max',aliases:['qwen-max-latest','qwen-max-2025'],family:'qwen',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['qwen','tongyi'],behavior:'structured',structured:.92,encoding:true,multilingual:.90,toksRange:[40,100]},
{id:'qwen-plus',aliases:['qwen-plus-latest'],family:'qwen',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['qwen','tongyi'],behavior:'structured',structured:.88,encoding:true,multilingual:.85,toksRange:[60,130]},
{id:'qwen-turbo',aliases:['qwen-turbo-latest'],family:'qwen',tier:'C',reasoning:false,math:true,logic:false,strawberry:false,knowledge:'2025-03',identityKw:['qwen','tongyi'],behavior:'structured',structured:.82,encoding:false,multilingual:.78,toksRange:[80,160]},
// ══════════════════════════════════════
// xAI Grok
// ══════════════════════════════════════
{id:'grok-4',aliases:['grok-4-0709'],family:'grok',tier:'S',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-12',identityKw:['grok','xai'],behavior:'witty',structured:.95,encoding:true,multilingual:.90,toksRange:[40,100]},
{id:'grok-3',aliases:['grok-3-beta','grok-3-latest'],family:'grok',tier:'A',reasoning:false,math:true,logic:true,strawberry:true,knowledge:'2025-02',identityKw:['grok','xai'],behavior:'witty',structured:.90,encoding:true,multilingual:.82,toksRange:[40,100]},
{id:'grok-3-mini',aliases:['grok-3-mini-beta','grok-3-mini-latest'],family:'grok',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-02',identityKw:['grok','xai'],behavior:'witty',structured:.85,encoding:true,multilingual:.78,toksRange:[60,140]},
{id:'grok-2',aliases:['grok-2-1212','grok-2-latest'],family:'grok',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-08',identityKw:['grok','xai'],behavior:'witty',structured:.85,encoding:true,multilingual:.78,toksRange:[50,120]},
// ══════════════════════════════════════
// Meta Llama
// ══════════════════════════════════════
{id:'llama-4-maverick',aliases:['llama-4-maverick-instruct','meta-llama-4-maverick','llama-4-maverick-17b-128e'],family:'llama',tier:'A',tokVar:'llama3',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['llama','meta'],behavior:'direct_en',structured:.88,encoding:false,multilingual:.75,toksRange:[60,140]},
{id:'llama-4-scout',aliases:['llama-4-scout-instruct','meta-llama-4-scout','llama-4-scout-17b-16e'],family:'llama',tier:'B',tokVar:'llama3',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['llama','meta'],behavior:'direct_en',structured:.85,encoding:false,multilingual:.72,toksRange:[60,140]},
{id:'llama-3.3-70b',aliases:['llama-3-3-instruct-70b','llama-3.3-70b-instruct','meta-llama-3.3-70b'],family:'llama',tier:'A',tokVar:'llama3',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-12',identityKw:['llama','meta'],behavior:'direct_en',structured:.88,encoding:false,multilingual:.75,toksRange:[50,120]},
{id:'llama-3.1-405b',aliases:['llama-3-1-405b-instruct','meta-llama-3.1-405b','llama-3.1-405b-instruct'],family:'llama',tier:'A',tokVar:'llama3',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-07',identityKw:['llama','meta'],behavior:'direct_en',structured:.90,encoding:true,multilingual:.80,toksRange:[30,80]},
{id:'llama-3.1-70b',aliases:['llama-3-1-70b-instruct','meta-llama-3.1-70b','llama-3.1-70b-instruct'],family:'llama',tier:'A',tokVar:'llama3',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-07',identityKw:['llama','meta'],behavior:'direct_en',structured:.85,encoding:false,multilingual:.75,toksRange:[40,100]},
{id:'llama-3.1-8b',aliases:['llama-3-1-8b-instruct','meta-llama-3.1-8b','llama-3.1-8b-instruct'],family:'llama',tier:'C',tokVar:'llama3',reasoning:false,math:false,logic:false,strawberry:false,knowledge:'2024-07',identityKw:['llama','meta'],behavior:'direct_en',structured:.70,encoding:false,multilingual:.55,toksRange:[80,180]},
{id:'llama-3-70b',aliases:['llama-3-70b-instruct','meta-llama-3-70b','meta-llama-3-70b-instruct'],family:'llama',tier:'A',tokVar:'llama3',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-03',identityKw:['llama','meta'],behavior:'direct_en',structured:.82,encoding:false,multilingual:.70,toksRange:[40,100]},
{id:'llama-3-8b',aliases:['llama-3-8b-instruct','meta-llama-3-8b','meta-llama-3-8b-instruct'],family:'llama',tier:'C',tokVar:'llama3',reasoning:false,math:false,logic:false,strawberry:false,knowledge:'2024-03',identityKw:['llama','meta'],behavior:'direct_en',structured:.65,encoding:false,multilingual:.50,toksRange:[80,180]},
// ══════════════════════════════════════
// Mistral
// ══════════════════════════════════════
{id:'mistral-large-3',aliases:['mistral-large-latest','mistral-large-2501'],family:'mistral',tier:'A',tokVar:'mst_sm',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-01',identityKw:['mistral'],behavior:'concise',structured:.92,encoding:true,multilingual:.88,toksRange:[40,100]},
{id:'mistral-large-2',aliases:['mistral-large-2407'],family:'mistral',tier:'A',tokVar:'mst_sm',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-07',identityKw:['mistral'],behavior:'concise',structured:.90,encoding:true,multilingual:.85,toksRange:[40,100]},
{id:'mistral-medium',aliases:['mistral-medium-latest','mistral-medium-2505'],family:'mistral',tier:'B',tokVar:'mst_sm',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['mistral'],behavior:'concise',structured:.88,encoding:true,multilingual:.82,toksRange:[60,130]},
{id:'mistral-small',aliases:['mistral-small-latest','mistral-small-2503'],family:'mistral',tier:'B',tokVar:'mst_sm',reasoning:false,math:true,logic:false,strawberry:false,knowledge:'2025-03',identityKw:['mistral'],behavior:'concise',structured:.85,encoding:false,multilingual:.78,toksRange:[80,160]},
{id:'codestral',aliases:['codestral-latest','codestral-2501'],family:'mistral',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-01',identityKw:['mistral','codestral'],behavior:'concise',structured:.90,encoding:true,multilingual:.75,toksRange:[40,100]},
{id:'pixtral-large',aliases:['pixtral-large-latest','pixtral-large-2411'],family:'mistral',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-11',identityKw:['mistral','pixtral'],behavior:'concise',structured:.88,encoding:true,multilingual:.82,toksRange:[40,100]},
{id:'mixtral-8x22b',aliases:['mixtral-8x22b-instruct','mixtral-8x22b-instruct-v0.1'],family:'mistral',tier:'B',tokVar:'mst_7b',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-04',identityKw:['mistral','mixtral'],behavior:'concise',structured:.85,encoding:false,multilingual:.78,toksRange:[40,100]},
{id:'mixtral-8x7b',aliases:['mixtral-8x7b-instruct','mixtral-8x7b-instruct-v0.1'],family:'mistral',tier:'C',tokVar:'mst_7b',reasoning:false,math:false,logic:false,strawberry:false,knowledge:'2024-01',identityKw:['mistral','mixtral'],behavior:'concise',structured:.75,encoding:false,multilingual:.65,toksRange:[60,140]},
// ══════════════════════════════════════
// Chinese models
// ══════════════════════════════════════
{id:'glm-5',aliases:['glm-5-non-reasoning','glm-5-plus','glm-5-air'],family:'glm',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-06',identityKw:['glm','chatglm','zhipu','智谱'],behavior:'academic_cn',structured:.90,encoding:true,multilingual:.85,toksRange:[40,100]},
{id:'glm-4',aliases:['glm-4-plus','glm-4-0520','glm-4-air','glm-4-flash'],family:'glm',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-06',identityKw:['glm','chatglm','zhipu','智谱'],behavior:'academic_cn',structured:.85,encoding:false,multilingual:.80,toksRange:[40,100]},
{id:'kimi-k2',aliases:['kimi-k2-6','moonshot-v1-128k','kimi-latest'],family:'kimi',tier:'A',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-06',identityKw:['kimi','moonshot','月之暗面'],behavior:'conversational_cn',structured:.90,encoding:true,multilingual:.85,toksRange:[40,100]},
{id:'doubao-pro',aliases:['doubao-1.5-pro','doubao-pro-32k','seed-1.6','doubao-lite'],family:'doubao',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['doubao','bytedance','豆包','字节'],behavior:'conversational_cn',structured:.85,encoding:false,multilingual:.78,toksRange:[50,120]},
{id:'yi-large',aliases:['yi-large-latest','yi-large-turbo','yi-medium'],family:'yi',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-06',identityKw:['yi','零一万物','01.ai','lingyiwanwu'],behavior:'academic_cn',structured:.85,encoding:false,multilingual:.80,toksRange:[40,100]},
{id:'minimax-abab',aliases:['minimax-abab-7b','minimax-abab-6.5','abab6.5s-chat'],family:'minimax',tier:'B',reasoning:false,math:true,logic:false,strawberry:false,knowledge:'2024-09',identityKw:['minimax','abab','海螺'],behavior:'conversational_cn',structured:.82,encoding:false,multilingual:.72,toksRange:[50,120]},
{id:'hunyuan-pro',aliases:['hunyuan-pro-latest','hunyuan-large','hunyuan-lite'],family:'hunyuan',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['hunyuan','tencent','腾讯','混元'],behavior:'conversational_cn',structured:.85,encoding:false,multilingual:.78,toksRange:[50,120]},
{id:'ernie-4',aliases:['ernie-4.0','ernie-4.0-turbo','ernie-4.0-8k','ernie-bot-4','wenxin-4'],family:'ernie',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2024-06',identityKw:['ernie','wenxin','baidu','百度','文心'],behavior:'conversational_cn',structured:.85,encoding:false,multilingual:.78,toksRange:[40,100]},
{id:'spark-4',aliases:['spark-v4','spark-pro','spark-max','spark-ultra'],family:'spark',tier:'B',reasoning:false,math:true,logic:true,strawberry:false,knowledge:'2025-03',identityKw:['spark','iflytek','讯飞','星火'],behavior:'conversational_cn',structured:.82,encoding:false,multilingual:.75,toksRange:[50,120]},
];

function findFpMatch(modelId) {
  const lo = modelId.toLowerCase();
  let bestMatch = null, bestLen = 0;

  for (const fp of FINGERPRINTS) {
    const fid = fp.id.toLowerCase();
    // Exact match on id → immediate return
    if (lo === fid) return fp;
    // Exact match on alias → immediate return
    for (const a of fp.aliases) { if (lo === a.toLowerCase()) return fp; }
    // Prefix match → track longest to avoid gpt-5.4 beating gpt-5.4-mini
    if (lo.startsWith(fid + '-') || lo.startsWith(fid + '.')) {
      if (fid.length > bestLen) { bestMatch = fp; bestLen = fid.length; }
    }
    for (const a of fp.aliases) {
      const aid = a.toLowerCase();
      if (lo.startsWith(aid + '-') || lo.startsWith(aid + '.')) {
        if (aid.length > bestLen) { bestMatch = fp; bestLen = aid.length; }
      }
    }
  }
  if (bestMatch) return bestMatch;

  // Fuzzy fallback (normalized substring match)
  const norm = lo.replace(/[^a-z0-9]/g, '');
  for (const fp of FINGERPRINTS) {
    const fid = fp.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm.includes(fid) && fid.length >= 4) return fp;
    for (const a of fp.aliases) {
      const aid = a.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (norm.includes(aid) && aid.length >= 6) return fp;
    }
  }
  return null;
}

function detectFamily(text) {
  const lo = (text || '').toLowerCase();
  const families = [
    // Specific families first (avoid false positives from generic keywords like 'google')
    { family: 'glm', kw: ['glm', 'chatglm', 'zhipu', '智谱'] },
    { family: 'deepseek', kw: ['deepseek'] },
    { family: 'qwen', kw: ['qwen', 'qwq', 'alibaba', 'tongyi', '通义'] },
    { family: 'kimi', kw: ['kimi', 'moonshot', '月之暗面'] },
    { family: 'doubao', kw: ['doubao', 'bytedance', '豆包', '字节'] },
    { family: 'minimax', kw: ['minimax', 'abab', '海螺'] },
    { family: 'yi', kw: ['yi-', '01.ai', '零一万物', 'lingyiwanwu'] },
    { family: 'hunyuan', kw: ['hunyuan', '混元'] },
    { family: 'ernie', kw: ['ernie', 'wenxin', '文心', '百度'] },
    { family: 'spark', kw: ['spark', 'iflytek', '讯飞', '星火'] },
    { family: 'grok', kw: ['grok', 'xai', 'x.ai'] },
    { family: 'mistral', kw: ['mistral', 'mixtral', 'codestral', 'pixtral'] },
    { family: 'llama', kw: ['llama', 'meta ai', 'meta-llama'] },
    // Broad families last (their keywords like 'google', 'openai' appear in many contexts)
    { family: 'anthropic', kw: ['claude', 'anthropic'] },
    { family: 'google', kw: ['gemini', 'google', 'bard'] },
    { family: 'openai', kw: ['chatgpt', 'gpt-4', 'gpt-3', 'gpt-5', 'openai', 'o1-', 'o3-', 'o4-'] },
  ];
  for (const f of families) { for (const kw of f.kw) { if (lo.includes(kw)) return f.family; } }
  return 'unknown';
}

module.exports = { FINGERPRINTS, findFpMatch, detectFamily };
