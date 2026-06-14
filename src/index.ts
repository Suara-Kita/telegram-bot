import 'dotenv/config';
import { Telegraf } from 'telegraf';
import pino from 'pino';
import { loadConfig } from './config.js';
import { getRedis } from './redis.js';
import { startHandler } from './handlers/start.js';
import { messageHandler } from './handlers/message.js';
import { submitAction, cancelAction } from './handlers/actions.js';

const logger = pino({ name: 'telegram-bot' });
const config = loadConfig();
const redis = getRedis(config);

const bot = new Telegraf(config.telegramBotToken);

bot.start(async (ctx) => {
  await startHandler(ctx, redis);
});

bot.on('text', async (ctx) => {
  await messageHandler(ctx, redis, config);
});

bot.action('submit', async (ctx) => {
  await submitAction(ctx, redis, config);
});

bot.action('cancel', async (ctx) => {
  await cancelAction(ctx, redis);
});

process.once('SIGINT', () => {
  logger.info('Received SIGINT, shutting down');
  bot.stop();
});

process.once('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down');
  bot.stop();
});

bot.launch().then(() => {
  logger.info('Telegram bot started');
}).catch((err) => {
  logger.error({ err }, 'Failed to start bot');
  process.exit(1);
});
