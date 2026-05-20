<p align="center">
  <img src="logo.jpg" width="200" alt="GateAPI Logo">
</p>

# ⬡ GateAPI

[![version](https://img.shields.io/badge/version-0.2.0-blue)](https://github.com/Nasan-Duodushu/GateAPI/releases)
[![platform](https://img.shields.io/badge/platform-Linux%20%7C%20Docker-brightgreen)](https://github.com/Nasan-Duodushu/GateAPI)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js)](https://nodejs.org/)
[![license](https://img.shields.io/badge/license-Apache%202.0-orange)](LICENSE)
[![LINUX.DO](https://img.shields.io/badge/LINUX.DO-Community-blue?logo=discourse)](https://linux.do)

**English** | **[中文](README_ZH.md)**

**LLM API Aggregation Gateway + Model Functional Detection Engine**

[Screenshots](#screenshots) · [Quick Start](#quick-start) · [Docker](#docker) · [Linux Deploy](#linux-server-deployment) · [Detection Engine](#detection-engine) · [Smart Routing](#smart-routing-engine) · [Admin API](#admin-api) · [Update](#update) · [Contributing](CONTRIBUTING.md)

If you find this useful, a ⭐ Star would mean a lot.

---

## About

Got a bunch of API keys from different resellers — some use OpenAI protocol, some Anthropic, each supporting different models — managing all of them is a pain.

GateAPI keeps it simple: **aggregate all your API providers into one unified output endpoint**. No matter what protocol the upstream uses, your downstream just calls `/v1/chat/completions` and it works. If the same model is available from multiple providers, requests are automatically distributed by priority and weight. If one goes down or gets slow, traffic shifts to another channel — zero manual intervention.

Beyond aggregation, GateAPI has a built-in **detection engine**. First, connectivity testing — batch-test all models across all channels to see what's reachable and what's not, at a glance. Then, functional detection — 13 probes cross-verify from math capability, logical reasoning, tokenizer fingerprints, and more, checking whether the model's actual performance matches expectations.

> **⚠️ Note:** Default admin password is `admin123`. **Change it immediately after first login!**

> **Disclaimer:** Detection results are for reference only. Results may vary due to network conditions, upstream status, and model version updates. The detection engine provides supplementary evidence — final decisions should be based on your own judgment.

---

## Features

**API Aggregation Gateway**
- Multiple providers unified into a single `/v1/chat/completions` endpoint — seamless downstream switching
- OpenAI / Anthropic dual-protocol auto-conversion, no format headaches
- Priority + dynamic weight smart routing — high latency auto-downweighted, 429s auto-cooled and skipped
- Error rate tracking with sliding window — high-error channels auto-deprioritized
- Built-in API key management with quota and rate limiting

**Prompt Engine**
- System prompt injection — prepend or append a system message to every request
- Context compression — limit conversation history length, preserving system messages + latest N turns

**Model Detection Engine**
- Connectivity testing: batch-test all models across all channels — see what's up, what's down, and latency at a glance
- Functional detection: 13 probes (math, logic, tokenizer fingerprint, response latency, token usage, etc.) to verify actual model performance
- 50+ model tokenizer fingerprint database for model family identification
- Auto-scoring after detection — underperforming channels get flagged immediately

**Admin Panel**
- Built-in web admin panel — manage channels, view logs, run detection, all from the browser
- Dashboard with real-time request stats, success rate, latency, and detection status
- Webhook notifications (Telegram / Discord / HTTP) for detection alerts
- Request caching with configurable TTL and max entries
- Account hub for managing upstream platform accounts (login, check-in, balance query)
- Provider presets for quick channel setup (OpenAI, Anthropic, DeepSeek, Moonshot, etc.)
- Chinese / English bilingual support + dark mode
- One-click update check + online upgrade

---

## Screenshots

| | |
|:---:|:---:|
| ![Login](docs/screenshots/1.png) | ![Dashboard](docs/screenshots/6.png) |
| Login | Dashboard |
| ![Channels](docs/screenshots/2.png) | ![Models](docs/screenshots/3.png) |
| Channel Management | Model Aggregation |
| ![Detection](docs/screenshots/4.png) | ![Keys](docs/screenshots/5.png) |
| Detection Engine | Key Management |
| ![Stats](docs/screenshots/7.png) | ![Logs](docs/screenshots/8.png) |
| Statistics | Request Logs |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          GateAPI                                │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │  Router   │───▶│  Distributor  │───▶│     Forwarder         │  │
│  │          │    │              │    │                       │  │
│  │ /v1/chat │    │ Priority     │    │ HTTP Forward          │  │
│  │ /v1/msg  │    │ Dynamic Wt   │    │ Protocol OAI↔Anth    │  │
│  │ /v1/mdls │    │ Sticky Sess  │    │ SSE Passthrough       │  │
│  │          │    │ 429 Adaptive │    │ Empty Detection+Retry │  │
│  │          │    │ Error Rate   │    │ Prompt Engine         │  │
│  └──────────┘    └──────────────┘    └───────┬───────────────┘  │
│                                              │                  │
│  ┌──────────┐    ┌──────────────┐    ┌──────┴────────────────┐  │
│  │  Admin   │    │  Detective    │    │  Prompt Engine        │  │
│  │  API     │    │  Engine       │    │  System Prompt Inject │  │
│  │          │    │              │    │  Context Compression  │  │
│  │ Ch. CRUD │    │ 13 Probes    │    └───────────────────────┘  │
│  │ Key Mgmt │    │ 50+ FP DB   │                               │
│  │ Logs     │    │ Scoring      │                               │
│  └──────────┘    └──────────────┘                               │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │  Store   │    │  Scheduler   │    │  Webhook + Cache      │  │
│  │ SQLite   │    │ Cron Detect  │    │  TG/Discord/HTTP      │  │
│  │ Req Logs │    │ Sampling     │    │  Response Cache       │  │
│  │ Results  │    │ Auto Degrade │    │  Account Hub          │  │
│  └──────────┘    └──────────────┘    └───────────────────────┘  │
└──────────────────────────────────────────────┼──────────────────┘
                                               │
                    ┌──────────────────────────────────────┐
                    │        Upstream LLM Providers         │
                    │                                      │
                    │  ┌─────────┐ ┌─────────┐ ┌────────┐ │
                    │  │ OpenAI  │ │Anthropic│ │ Proxy  │ │
                    │  │ Compat. │ │ Compat. │ │ (any)  │ │
                    │  └─────────┘ └─────────┘ └────────┘ │
                    └──────────────────────────────────────┘
```

## Features

### Core
- **Unified API Endpoint** — Aggregate multiple LLM providers into one OpenAI-compatible endpoint
- **Dual Protocol Support** — Native OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) endpoints
- **Model Functional Detection** — 13 probes to verify model authenticity (identity, math, logic, tokenizer fingerprint, etc.)
- **SSE Streaming** — Full streaming support including Anthropic SSE → OpenAI SSE real-time conversion
- **Empty Content Detection** — Auto-detect upstream 200 OK with empty content and trigger retry

### Smart Routing Engine
- **Latency-Aware Routing** — Track rolling average latency per channel, prefer faster channels
- **Error Rate Tracking** — Sliding window (last 50 calls) per channel; >50% error → weight ×0.1, >30% → ×0.3, >10% → ×0.7
- **429 Rate-Limit Adaptive** — Exponential backoff cooldown (30s→5min), auto-redirect during cooldown
- **Sticky Sessions** — Same user + same model reuses the same channel for 10 minutes
- **Priority + Dynamic Weights** — Base weight adjusted by latency, error rate, and rate-limit status in real-time
- **Auto Failover** — 5 consecutive failures → auto-degrade for 5 minutes, then auto-recover
- **Multi-Channel Retry** — On failure, automatically switch to another channel serving the same model

### Prompt Engine
- **System Prompt Injection** — Automatically prepend or append a system-level message to every request
- **Context Compression** — Limit total messages per request; preserves all system messages + most recent N user/assistant turns

### Model Management
- **Global Model Aliases** — Unify different provider model names to canonical names
- **Per-Model Disable** — Disable specific models on specific channels without affecting others
- **Detection-Linked Actions** — Auto-disable problematic models; degrade entire channel if all models fail

### Operations & UI
- **Admin Panel** — Dark/Light theme Web UI with English/Chinese i18n
- **Routing Dashboard** — Real-time latency, 429 cooldown status, sticky session counts
- **Detection Health Overview** — Dashboard showing pass rates and at-risk channels
- **Zero-Dependency Deploy** — Only 3 production dependencies (Express + better-sqlite3 + cors)

## Quick Start

### 1. Install

```bash
git clone https://github.com/Nasan-Duodushu/GateAPI.git
cd gateapi
npm install
```

### 2. Configure

```bash
cp config.example.json data/config.json
```

Edit `data/config.json`:

```json
{
  "server": {
    "port": 3000,
    "adminToken": "admin123",
    "apiKeys": ["sk-your-api-key"]
  },
  "relay": {
    "timeout": 60000,
    "retryTimes": 2,
    "retryOnStatusCodes": [429, 500, 502, 503]
  },
  "channels": [
    {
      "name": "Provider-A",
      "type": "openai",
      "endpoint": "https://api.example.com/v1",
      "keys": ["sk-upstream-key"],
      "models": ["gpt-4o", "claude-opus-4-7"],
      "weight": 10,
      "priority": 1,
      "status": "enabled"
    }
  ]
}
```

### 3. Start

```bash
npm start
```

Visit `http://localhost:3000` to access the admin panel. Log in with your `adminToken`.

### 4. API Usage

```bash
# List available models
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer sk-your-api-key"

# Chat Completions (OpenAI protocol)
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'

# Streaming
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}],"stream":true}'

# Anthropic native protocol
curl http://localhost:3000/v1/messages \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-7","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'
```

## Docker

```bash
docker build -t gateapi .
docker run -d -p 3000:3000 -v ./data:/app/data gateapi
```

Or with docker-compose:

```bash
docker-compose up -d
```

## Project Structure

```
gateapi/
├── src/
│   ├── index.js              # Express entry + startup banner
│   ├── config.js             # Config loader + hot reload + model index
│   ├── store.js              # SQLite storage (request logs + detection results + API keys)
│   ├── router.js             # External API routes (dual protocol + retry loop)
│   ├── scheduler.js          # Cron detection + passive sampling + auto-degrade
│   ├── prompt-engine.js      # Prompt engine (system prompt injection + context compression)
│   ├── cache.js              # Response cache with TTL
│   ├── webhook.js            # Webhook notifications (Telegram / Discord / HTTP)
│   ├── accounts.js           # Account hub (login, check-in, balance query)
│   ├── balance.js            # Channel balance query
│   ├── relay/
│   │   ├── distributor.js    # Routing engine (priority + dynamic weight + sticky + 429 + error rate)
│   │   └── forwarder.js      # Request forwarding (protocol convert + SSE + empty detect + prompt engine)
│   ├── admin/
│   │   └── api.js            # Admin API (channel CRUD / stats / detection / key management / prompt engine)
│   └── detective/
│       ├── engine.js         # Detection engine (13 probes + 3-batch parallel + weighted scoring)
│       ├── fingerprints.js   # Model fingerprint database (50+ models)
│       └── modeldb.js        # Model database (probe texts + fingerprint matching)
├── web/
│   └── index.html            # Admin panel SPA (TailwindCSS + dark/light + i18n)
├── data/
│   ├── config.json           # Runtime config (auto-generated)
│   └── gateapi.db            # SQLite database (auto-generated)
├── config.example.json       # Config template
├── Dockerfile                # Docker image
├── docker-compose.yml        # Docker Compose
└── package.json              # 3 production dependencies
```

## Detection Engine

GateAPI's core differentiator — automatically detect whether upstream API providers are substituting low-cost models for premium ones using multi-dimensional probes.

> **Important:** Detection results are for reference only. Due to the probabilistic nature of LLM outputs and evolving model capabilities, 100% accuracy cannot be guaranteed. Use detection results as one factor among many when evaluating upstream service quality.

### Probe Matrix

| Probe | Type | Dynamic Weight | Detection Method |
|-------|------|---------------|-----------------|
| **Reasoning Tokens** | Hard signal | 8 | Non-reasoning model produces reasoning tokens → o-series substitution |
| **Tokenizer Fingerprint** | Hard signal | 4~8 | 52-model tokenizer fingerprint DB, CJK/Western/Ancient 3-tier classification |
| **Model Field** | Hard signal | 3~7 | Response `model` field doesn't match request → cross-family substitution |
| **Identity Model** | Medium signal | 6 | Model self-reported identity vs claimed model |
| **Logprobs Entropy** | Medium signal | 0~5 | Top-5 logprobs entropy distribution matches model tier |
| **Identity Family** | Medium signal | 4~5 | Detect model family (OpenAI/Anthropic/Google/DeepSeek…) |
| **Math** | Capability test | 1~3 | 1234×5678=7006652 |
| **Logic** | Capability test | 1~3 | Classic CRT bat-and-ball problem (5¢) |
| **Strawberry** | Capability test | 1~3 | How many r's in "strawberry" (3) |
| **Temp Consistency** | Behavior test | 2 | temp=0 two calls, result consistency |
| **Token Usage** | Auxiliary | 0~5 | completion_tokens within expected range for model |
| **Long Context** | Auxiliary | 1 | Multi-turn UUID recall |
| **TTFT** | Auxiliary | 1 | Time-to-first-token matches model tier |
| **Knowledge** | Auxiliary | 1 | 2024 Paris Olympics date (2024-07-26) |

### Tokenizer Fingerprint Detection

Based on real-world tokenizer data from 52 models, leveraging CJK tokenization differences across model families:

```
CN Token Count ("今天天气真好，我们一起去公园散步吧"):

 7  ████████               Orion-14B
 9  ████████████           DeepSeek V3/R1, GLM-4, MiniMax, Kimi
10  █████████████          Qwen, Yi, Doubao, ERNIE
12  ███████████████        Gemini
13  ████████████████       GPT-4o/o1/o3, Llama 3
16  ███████████████████    Claude 3/3.5/4
18  █████████████████████  Mistral 7B/Mixtral
20  ███████████████████████ GPT-4/3.5-Turbo
26  █████████████████████████████ Grok-1
33  ████████████████████████████████████ GPT-3/GPT-2
```

If a model claims to be Claude (CN=16) but prompt_tokens shows CN≈9, it's likely substituted with DeepSeek.

### Scoring & Verdict

| Score | Meaning |
|-------|---------|
| **80-100** | Highly consistent, functional behavior matches claimed model |
| **50-79** | Suspicious, some probes failed |
| **< 50** | Severe inconsistency, consider switching channels |

| Tier | Criteria |
|------|----------|
| **S** | Math + Logic + Strawberry all pass |
| **A** | Math + Logic pass |
| **B** | Math or Logic passes one |
| **C** | Below baseline capability |

| Verdict | Meaning |
|---------|---------|
| **pass** | Passed (score ≥ dynamic threshold) |
| **weak** | Below standard (score below threshold) |
| **family_mismatch** | Family mismatch (e.g., claims Claude but is GPT) |
| **insufficient** | Insufficient evidence (< 3 valid probes) |

## Smart Routing Engine

```
                    Request Incoming
                       │
                       ▼
              ┌─ Sticky Session ─┐
              │ Same user+model   │
              │ Reuse for 10min   │──── Hit ───▶ Direct Use
              └────────┬─────────┘
                       │ Miss
                       ▼
              ┌─ Priority Groups ──┐
              │ priority descending│
              │ Highest group first│
              └────────┬──────────┘
                       │
                       ▼
              ┌─ Dynamic Weighted ──┐
              │ base weight          │
              │ × latency factor     │
              │  >3s → ×0.5         │
              │  >8s → ×0.25        │
              │ × error rate factor  │
              │  >50% → ×0.1        │
              │  >30% → ×0.3        │
              │  >10% → ×0.7        │
              │ × 429 status         │
              │  cooling → ×0       │
              └────────┬────────────┘
                       │
                       ▼
              ┌─ Forward + Retry ──┐
              │ Fail → exclude ch. │
              │ Pick next available │
              │ Up to N retries     │
              └────────────────────┘
```

### Health Protection

- **Consecutive Failure Degradation** — 5 consecutive failures → `status=degraded`, skipped during routing
- **Auto Recovery** — Degraded channels auto-recover to `enabled` after 5 minutes
- **429 Exponential Backoff** — 30s → 60s → 120s → 240s → 300s (max)
- **Empty Content Detection** — Upstream returns HTTP 200 but `content=null` + `completion_tokens=0` → treated as failure, triggers retry

## Admin API

All admin APIs require `Authorization: Bearer <adminToken>` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/channels` | List all channels |
| POST | `/admin/channels` | Add channel |
| PUT | `/admin/channels/:id` | Update channel |
| DELETE | `/admin/channels/:id` | Delete channel |
| POST | `/admin/channels/:id/test` | Connectivity test |
| POST | `/admin/channels/:id/detect` | Trigger detection |
| GET | `/admin/detect/:channelId` | View detection results |
| GET | `/admin/stats` | Statistics |
| GET | `/admin/logs` | Request logs |
| GET | `/admin/models` | Aggregated model list |
| PUT | `/admin/channels/:id/models/:model/toggle` | Enable/disable specific model |
| GET | `/admin/model-aliases` | View global model aliases |
| PUT | `/admin/model-aliases` | Update global model aliases |
| GET | `/admin/routing-stats` | Routing engine real-time status |
| GET | `/admin/prompt-engine` | Get prompt engine config |
| PUT | `/admin/prompt-engine` | Update prompt engine config |
| GET | `/admin/webhook` | Get webhook config |
| PUT | `/admin/webhook` | Update webhook config |
| POST | `/admin/webhook/test` | Send test notification |
| GET | `/admin/cache` | Cache stats |
| PUT | `/admin/cache` | Update cache config |
| DELETE | `/admin/cache` | Clear cache |
| GET | `/admin/accounts` | List accounts |
| POST | `/admin/accounts` | Add account |
| POST | `/admin/config/reload` | Hot reload config |

## Channel Configuration

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Channel name |
| `type` | string | `openai` or `anthropic` |
| `endpoint` | string | Upstream API URL |
| `keys` | string[] | API key list (auto round-robin) |
| `models` | string[] | Supported model list |
| `modelMapping` | object | Model name mapping `{"external":"actual"}` |
| `disabledModels` | string[] | Disabled models (skipped during routing) |
| `weight` | number | Weight (dynamic weighted random within same priority) |
| `priority` | number | Priority (higher number = higher priority) |
| `status` | string | `enabled` / `disabled` / `degraded` |

## Linux Server Deployment

### Prerequisites

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt install -y nodejs

# Install build tools (better-sqlite3 requires native compilation)
sudo apt install -y build-essential python3
```

### Install & Configure

```bash
git clone https://github.com/Nasan-Duodushu/GateAPI.git /opt/gateapi
cd /opt/gateapi
npm install --production

cp config.example.json data/config.json
nano data/config.json   # Fill in channels and keys
```

### systemd Service

```bash
sudo nano /etc/systemd/system/gateapi.service
```

```ini
[Unit]
Description=GateAPI - LLM API Gateway
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/gateapi
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable gateapi
sudo systemctl start gateapi

# Check status & logs
sudo systemctl status gateapi
sudo journalctl -u gateapi -f
```

### Nginx Reverse Proxy + HTTPS

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/gateapi
```

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;          # Required for SSE streaming
        proxy_cache off;
        chunked_transfer_encoding on;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/gateapi /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL certificate (auto-configures HTTPS)
sudo certbot --nginx -d api.yourdomain.com
```

> **⚠️ Important:** `proxy_buffering off` is required for SSE streaming responses, otherwise streams will be buffered and returned all at once.

### Firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### Update

Pull latest code from GitHub and restart:

```bash
cd /opt/gateapi
git pull
npm install --production
sudo systemctl restart gateapi
```

Docker update:

```bash
cd /opt/gateapi
git pull
docker compose down
docker compose up -d --build
```

> The `data/` directory is mounted as a volume — updates won't affect your config or detection data.

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express
- **Database**: SQLite (better-sqlite3)
- **Frontend**: Vanilla HTML + TailwindCSS CDN (single-file SPA)
- **Production Dependencies**: Only 4 (express, better-sqlite3, cors, node-cron)

## Disclaimer

The model detection feature provided by this project is for reference only and does not represent definitive conclusions. Detection results may be affected by:

- Network latency and connection stability
- Upstream API service status
- Model version updates and capability changes
- API proxy additional processing (e.g., system prompt injection, token billing)

**Detection results cannot guarantee 100% accuracy.** Do not use them as the sole basis for judgment. We recommend combining multiple detection results with actual usage experience to comprehensively evaluate upstream service quality.

## Acknowledgments

This project actively participates in and acknowledges the [LINUX.DO](https://linux.do) community. Thanks to the community members for their feedback and support.

[![LINUX.DO Acknowledged](https://img.shields.io/badge/LINUX.DO-Acknowledged-blue?style=flat-square&logo=discourse)](https://linux.do)

## License

Apache License 2.0
