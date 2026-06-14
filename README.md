# Telegram Bot — Suara Kita Ingestion

Conversational Telegram bot that receives citizen messages, analyzes them via LLM, and pushes structured payloads to a Redis queue for downstream processing.

## Architecture

```
Citizen → Telegram → Telegraf bot → LLM (OpenRouter) → Redis LPUSH queue:voter_inputs
                                                        ↓
                                              main-engine-processor (consumer)
```

## Features

- **Conversational sessions** — Redis-backed with 1h TTL, keyed by `session:telegram:{chatId}`
- **LLM analysis** — Calls `gpt-oss-120b` on OpenRouter for intent, urgency, sentiment, language detection
- **Language matching** — Responds in the same language as the user's latest message (Malay / English / Tamil / Mandarin)
- **Troll detection** — Rejects impossible claims and pure insults without a concrete issue
- **Topic change detection** — Warns when user switches topic mid-conversation
- **Confirmation flow** — Users review and confirm/cancel before submission
- **Redis counters** — `stats:telegram-bot:messages_ingested`

## Quick Start

```bash
cp .env.example .env
# Edit .env with your values
npm install
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather | — |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6380` |
| `REDIS_PASSWORD` | Redis password | `redis` |
| `OPENROUTER_API_KEY` | OpenRouter API key | — |
| `LLM_ENDPOINT` | LLM endpoint URL | `https://openrouter.ai/api/v1` |
| `LLM_MODEL` | LLM model | `openai/gpt-oss-120b` |

## Contracts

- `contracts/voter_input.json` — Payload schema pushed to `queue:voter_inputs`

## Related Repositories

- [main-engine-processor](https://github.com/Suara-Kita/main-engine-processor) — Rust triage engine that consumes from `queue:voter_inputs`
- [dashboard](https://github.com/Suara-Kita/dashboard) — Admin UI for monitoring and approving issues
