import { type Context } from 'telegraf';
import type { Redis } from 'ioredis';
import pino from 'pino';
import type { Config } from '../types.js';
import { loadSession, deleteSession } from '../session.js';
import { pushToQueue, incrementCounter } from '../redis.js';
import { buildVoterInput } from '../normalizer.js';

const logger = pino({ name: 'action-handler' });

export async function submitAction(
  ctx: Context,
  redis: Redis,
  config: Config,
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCbQuery();
    return;
  }

  const session = await loadSession(redis, chatId);
  if (!session) {
    await ctx.answerCbQuery();
    await ctx.reply('Sesi telah tamat. Sila mulakan semula dengan /start.');
    return;
  }

  if (!session.latestSummary) {
    await ctx.answerCbQuery();
    await ctx.reply('Tiada ringkasan untuk dihantar. Sila taip mesej terlebih dahulu.');
    return;
  }

  const displayName = ctx.from?.first_name ?? null;
  const voterInput = buildVoterInput(chatId, displayName, session);

  try {
    await pushToQueue(redis, config.queueVoterInputs, JSON.stringify(voterInput));
    await incrementCounter(redis, 'stats:telegram-bot:messages_ingested');
    await deleteSession(redis, chatId);

    await ctx.answerCbQuery();
    await ctx.reply('Terima kasih! Diskusi awak telah diterima dan akan diproses.');
  } catch (err) {
    logger.error({ err, chatId }, 'Failed to process submission');
    await ctx.answerCbQuery();
    await ctx.reply('Maaf, berlaku ralat semasa menghantar aduan. Sila cuba lagi.');
  }
}

export async function cancelAction(
  ctx: Context,
  redis: Redis,
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCbQuery();
    return;
  }

  await deleteSession(redis, chatId);
  await ctx.answerCbQuery();
  await ctx.reply('Baik, diskusi ini tidak diteruskan.');
}
