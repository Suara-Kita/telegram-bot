import { type Context } from 'telegraf';
import type { Redis } from 'ioredis';
import pino from 'pino';
import type { Config } from '../types.js';
import { loadSession, deleteSession, saveSession } from '../session.js';
import { pushToQueue, incrementCounter } from '../redis.js';
import { buildVoterInput } from '../normalizer.js';
import { callSimpleLlm } from '../llm.js';
import {
  getLokalDuns,
  saveCachedConstituency,
  loadCachedConstituency,
  deleteCachedConstituency,
  findDunByFlatCode,
} from '../constituency.js';

const logger = pino({ name: 'action-handler' });

const THUMBS_UP_STICKER = 'CAACAgUAAxUAAWoyQyBoXkA4i5nQgtBHk0eV0CscAAKmHAACl9WRVdQJ5syd0wWfPAQ';

const APA_KABAR = "Assalamualaikum dan selamat sejahtera, awak apa khabar?";

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
  const oldIds = session.systemMessageIds || [];
  session.systemMessageIds = [];
  session.conversation.push({ role: 'assistant', content: `✅ DUN dipilih: ${match.dun} (${match.parlimen})` });
  session.conversation.push({ role: 'assistant', content: APA_KABAR });
  await Promise.all([
    saveSession(redis, chatId, session),
    saveCachedConstituency(redis, chatId, match),
  ]);

  await ctx.answerCbQuery();
  for (const id of oldIds) {
    await ctx.deleteMessage(id).catch(() => {});
  }
  const dunMsg = await ctx.reply(`✅ DUN dipilih: ${match.dun} (${match.parlimen})`);
  await new Promise(r => setTimeout(r, 2000));
  await ctx.deleteMessage(dunMsg.message_id).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));
  await ctx.reply(APA_KABAR);
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
  const oldIds = session.systemMessageIds || [];
  session.systemMessageIds = [];
  session.conversation.push({ role: 'assistant', content: `✅ DUN dipilih: ${cached.dun} (${cached.parlimen})` });
  session.conversation.push({ role: 'assistant', content: APA_KABAR });
  await saveSession(redis, chatId, session);

  await ctx.answerCbQuery();
  for (const id of oldIds) {
    await ctx.deleteMessage(id).catch(() => {});
  }
  const dunMsg = await ctx.reply(`✅ DUN dipilih: ${cached.dun} (${cached.parlimen})`);
  await new Promise(r => setTimeout(r, 2000));
  await ctx.deleteMessage(dunMsg.message_id).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));
  await ctx.reply(APA_KABAR);
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
  await ctx.reply(
    '📌 Semakan DUN Mengundi\n\nSila pilih DUN anda. Bagi yang belum pasti, anda boleh membuat semakan senarai daftar pemilih melalui pautan di bawah:\n\n🔗 Semak Di Sini: https://mysprsemak.spr.gov.my/semakan/daftarPemilih',
    {
      reply_markup: {
        inline_keyboard: [
          ...buttons,
          [{ text: '🌐 Lain-lain DUN', callback_data: 'dun_lain' }],
        ],
      },
    },
  );
}

export async function triggerDunSearchHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCbQuery(); return; }

  const session = await loadSession(redis, chatId);
  if (!session) { await ctx.answerCbQuery(); return; }

  session.state = 'awaiting_dun_search';
  await saveSession(redis, chatId, session);

  await ctx.answerCbQuery();
  await ctx.reply('Taip nama DUN anda (contoh: Pemanis, Kemelah, Larkin, atau kod macam N.44):', {
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
  const oldIds = session.systemMessageIds || [];
  session.systemMessageIds = [];
  session.conversation.push({ role: 'assistant', content: `✅ DUN dipilih: ${match.dun} (${match.parlimen})` });
  session.conversation.push({ role: 'assistant', content: APA_KABAR });
  await Promise.all([
    saveSession(redis, chatId, session),
    saveCachedConstituency(redis, chatId, match!),
  ]);

  await ctx.answerCbQuery();
  for (const id of oldIds) {
    await ctx.deleteMessage(id).catch(() => {});
  }
  const dunMsg = await ctx.reply(`✅ DUN dipilih: ${match.dun} (${match.parlimen})`);
  await new Promise(r => setTimeout(r, 2000));
  await ctx.deleteMessage(dunMsg.message_id).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));
  await ctx.reply(APA_KABAR);
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
  await ctx.reply('Pilih DUN anda:', {
    reply_markup: {
      inline_keyboard: [
        ...buttons,
        [{ text: '🌐 Lain-lain DUN', callback_data: 'dun_lain' }],
      ],
    },
  });
}

export async function selectCandidateHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) { await ctx.answerCbQuery(); return; }

  const data = (ctx as any).callbackQuery?.data as string;
  const flatCode = data?.replace('dun_candidate_', '');
  const match = findDunByFlatCode(flatCode);
  if (!match) { await ctx.answerCbQuery(); return; }

  const session = await loadSession(redis, chatId);
  if (!session) { await ctx.answerCbQuery(); return; }

  session.pendingDun = match;
  await saveSession(redis, chatId, session);

  await ctx.answerCbQuery();
  await ctx.reply(`Anda maksudkan **${match.dun} (${match.parlimen})**?`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Ya', callback_data: 'confirm_dun' },
          { text: '❌ Tidak', callback_data: 'retry_dun' },
        ],
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

  const ringkasanId = session.ringkasanMessageId;
  const userLanguage = session.language || 'malay';
  const summary = session.latestSummary;
  const constituency = session.constituency;

  await ctx.answerCbQuery();

  if (ringkasanId != null) {
    await ctx.deleteMessage(ringkasanId).catch(() => {});
  }

  const displayName = ctx.from?.first_name ?? null;
  const voterInput = buildVoterInput(chatId, displayName, session);

  try {
    await pushToQueue(redis, config.queueVoterInputs, JSON.stringify(voterInput));
    await incrementCounter(redis, 'stats:telegram-bot:messages_ingested');

    const languageMap: Record<string, string> = {
      malay: 'Bahasa Malaysia',
      english: 'English',
      mandarin: 'Mandarin',
      tamil: 'Tamil',
    };
    const langLabel = languageMap[userLanguage] || 'Bahasa Malaysia';

    const thankYouPrompt = [
      {
        role: 'system',
        content: `You are a warm Malaysian constituency service assistant. Generate a short thank-you message (2-3 sentences) in ${langLabel}. Thank the user for sharing their feedback, say your team will carefully review it and take it into consideration, and that their voice matters. Keep it warm, genuine, and natural. Do NOT use markdown. Do NOT use emoji.`,
      },
      {
        role: 'user',
        content: `Constituency: ${constituency ? `${constituency.dun}, ${constituency.parlimen}` : 'N/A'}\nFeedback summary: ${summary}`,
      },
    ];

    const [thankYouText] = await Promise.all([
      callSimpleLlm(
        config.openrouterBaseUrl,
        config.openrouterApiKey,
        config.llmModel,
        thankYouPrompt,
      ),
      ctx.replyWithSticker(THUMBS_UP_STICKER).catch(() => {}),
    ]);

    await ctx.reply(thankYouText);
    await deleteSession(redis, chatId);
  } catch (err) {
    logger.error({ err, chatId }, 'Failed to process submission');
    await ctx.reply('Maaf, berlaku ralat semasa menghantar aduan. Sila cuba lagi.');
    await deleteSession(redis, chatId);
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

  const session = await loadSession(redis, chatId);
  const ringkasanId = session?.ringkasanMessageId;

  await deleteSession(redis, chatId);
  await ctx.answerCbQuery();

  if (ringkasanId != null) {
    await ctx.deleteMessage(ringkasanId).catch(() => {});
  }
}
