import { type Context } from 'telegraf';
import type { Redis } from 'ioredis';
import { createSession, saveSession } from '../session.js';

const GREETING = 'Selamat datang! Sila huraikan isu atau cadangan awak.';

export async function startHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = createSession();
  session.conversation.push({ role: 'assistant', content: GREETING });
  await saveSession(redis, chatId, session);

  await ctx.reply(GREETING);
}
