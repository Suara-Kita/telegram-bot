import { type Context } from 'telegraf';
import type { Redis } from 'ioredis';
import pino from 'pino';
import type { Config } from '../types.js';
import { loadSession, deleteSession, saveSession } from '../session.js';
import { pushToQueue, incrementCounter } from '../redis.js';
import { buildVoterInput } from '../normalizer.js';
import {
  getLokalDuns,
  saveCachedConstituency,
  loadCachedConstituency,
  deleteCachedConstituency,
} from '../constituency.js';

const logger = pino({ name: 'action-handler' });

const GREETING = 'Jom mula berdiskusi atau taip apa sahaja di bawah: 👇';

function flattenCode(code: string): string {
  return code.toLowerCase().replace(/\./g, '');
}

export async function constituencyHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCbQuery(); return; }

  const data = (ctx as any).callbackQuery?.data as string;
  const flatCode = data?.replace('dun_', '');
  const match = getLokalDuns().find((d) => flattenCode(d.code_dun) === flatCode) ?? null;
  if (!match) { await ctx.answerCbQuery(); return; }

  const session = await loadSession(redis, chatId);
  if (!session) { await ctx.answerCbQuery(); return; }

  session.state = 'conversing';
  session.constituency = match;
  session.conversation.push({ role: 'assistant', content: GREETING });
  await Promise.all([
    saveSession(redis, chatId, session),
    saveCachedConstituency(redis, chatId, match),
  ]);

  await ctx.answerCbQuery();
  await ctx.reply(GREETING);
}

export async function useCachedDunHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCbQuery(); return; }

  const [session, cached] = await Promise.all([
    loadSession(redis, chatId),
    loadCachedConstituency(redis, chatId),
  ]);
  if (!session || !cached) { await ctx.answerCbQuery(); return; }

  session.state = 'conversing';
  session.constituency = cached;
  session.conversation.push({ role: 'assistant', content: GREETING });
  await saveSession(redis, chatId, session);

  await ctx.answerCbQuery();
  await ctx.reply(GREETING);
}

export async function changeDunHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCbQuery(); return; }

  const session = await loadSession(redis, chatId);
  if (!session) { await ctx.answerCbQuery(); return; }

  session.state = 'awaiting_constituency';
  session.constituency = null;
  session.pendingDun = null;
  await Promise.all([
    saveSession(redis, chatId, session),
    deleteCachedConstituency(redis, chatId),
  ]);

  const lokal = getLokalDuns();
  const buttons = lokal.map((d) => [
    { text: `${d.dun} (${d.parlimen})`, callback_data: `dun_${d.code_dun.toLowerCase().replace(/\./g, '')}` },
  ]);

  await ctx.answerCbQuery();
  await ctx.reply('Pilih DUN korang:', {
    reply_markup: {
      inline_keyboard: [
        ...buttons,
        [{ text: '🌐 Lain-lain DUN', callback_data: 'dun_lain' }],
      ],
    },
  });
}

export async function triggerDunSearchHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCbQuery(); return; }

  const session = await loadSession(redis, chatId);
  if (!session) { await ctx.answerCbQuery(); return; }

  session.state = 'awaiting_dun_search';
  await saveSession(redis, chatId, session);

  await ctx.answerCbQuery();
  await ctx.reply('Taip nama DUN korang (contoh: Pemanis, Kemelah, Larkin, atau kod macam N.44):', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Kembali ke pilihan DUN', callback_data: 'back_dun' }],
      ],
    },
  });
}

export async function confirmDunHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCbQuery(); return; }

  const session = await loadSession(redis, chatId);
  if (!session || !session.pendingDun) { await ctx.answerCbQuery(); return; }

  const match = session.pendingDun;
  session.state = 'conversing';
  session.constituency = match;
  session.pendingDun = null;
  session.conversation.push({ role: 'assistant', content: GREETING });
  await Promise.all([
    saveSession(redis, chatId, session),
    saveCachedConstituency(redis, chatId, match!),
  ]);

  await ctx.answerCbQuery();
  await ctx.reply(GREETING);
}

export async function retryDunHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCbQuery(); return; }

  const session = await loadSession(redis, chatId);
  if (!session) { await ctx.answerCbQuery(); return; }

  session.state = 'awaiting_dun_search';
  await saveSession(redis, chatId, session);

  await ctx.answerCbQuery();
  await ctx.reply('Taip nama atau kod DUN sekali lagi:');
}

export async function backToConstituencyHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCbQuery(); return; }

  const session = await loadSession(redis, chatId);
  if (!session) { await ctx.answerCbQuery(); return; }

  session.state = 'awaiting_constituency';
  session.pendingDun = null;
  await saveSession(redis, chatId, session);

  const lokal = getLokalDuns();
  const buttons = lokal.map((d) => [
    { text: `${d.dun} (${d.parlimen})`, callback_data: `dun_${flattenCode(d.code_dun)}` },
  ]);

  await ctx.answerCbQuery();
  await ctx.reply('Pilih DUN korang:', {
    reply_markup: {
      inline_keyboard: [
        ...buttons,
        [{ text: '🌐 Lain-lain DUN', callback_data: 'dun_lain' }],
      ],
    },
  });
}

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
    await ctx.reply(
      'Suara Berjaya Disimpan! (100% Anon)\n\n'
      + 'Terima kasih! Isu atau diskusi korang dah selamat masuk ke dalam database kami. '
      + 'Pasukan digital kami akan mula proses idea ni untuk tindakan seterusnya.\n\n'
      + '💬 Ada benda lain yang korang nak bincangkan?\n\n'
      + 'Kalau ada perkara lain yang korang nak kritik, nak sembang pasal peluang ekonomi '
      + 'belia, atau apa-apa isu kejiranan yang berbeza, boleh terus taip kat bawah sekarang: 👇',
    );
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
