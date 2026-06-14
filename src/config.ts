import { Config } from './types.js';

export function loadConfig(): Config {
  const missing: string[] = [];
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) missing.push('TELEGRAM_BOT_TOKEN');
  if (!process.env.OPENROUTER_API_KEY) missing.push('OPENROUTER_API_KEY');

  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  return {
    telegramBotToken: token!,
    redisHost: process.env.REDIS_HOST || 'localhost',
    redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
    redisPassword: process.env.REDIS_PASSWORD || '',
    queueVoterInputs: process.env.QUEUE_VOTER_INPUTS || 'queue:voter_inputs',
    openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    openrouterApiKey: process.env.OPENROUTER_API_KEY!,
    llmModel: process.env.LLM_MODEL || 'openai/gpt-oss-120b',
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}
