import { type Context } from 'telegraf';
import type { Redis } from 'ioredis';
import pino from 'pino';
import type { Config } from '../types.js';
import { loadSession, saveSession, createSession } from '../session.js';
import { callLlm } from '../llm.js';
import { detectLanguage } from '../language.js';
import { searchDun, loadCachedConstituency } from '../constituency.js';

const logger = pino({ name: 'message-handler' });
const GREETING = 'Jom mula berdiskusi atau taip apa sahaja di bawah: 👇';

export async function messageHandler(
  ctx: Context,
  redis: Redis,
  config: Config,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
  if (!chatId || !text) return;

  let session = await loadSession(redis, chatId);

  if (!session) {
    const cached = await loadCachedConstituency(redis, chatId);
    if (cached) {
      session = createSession();
      session.state = 'conversing';
      session.constituency = cached;
      session.conversation.push({ role: 'assistant', content: GREETING });
      await saveSession(redis, chatId, session);
      await ctx.reply(`🧭 Diskusi seterusnya adalah untuk DUN: ${cached.dun}. Sila taip isu atau cadangan korang.`);
      return;
    }
    await ctx.reply('Sila mulakan dengan /start untuk pilih DUN korang.');
    return;
  }

  if (session.state === 'awaiting_constituency') {
    await ctx.reply('Sila pilih DUN korang menggunakan butang di atas, atau taip /start.');
    return;
  }

  if (session.state === 'awaiting_dun_search') {
    const match = searchDun(text);
    if (match) {
      session.pendingDun = match;
      await saveSession(redis, chatId, session);
      await ctx.reply(
        `Korang maksudkan **${match.dun} (${match.parlimen})**?`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Ya', callback_data: 'confirm_dun' },
                { text: '❌ Tidak', callback_data: 'retry_dun' },
              ],
            ],
          },
        },
      );
    } else {
      await ctx.reply(
        `Tiada padanan untuk "${text}". Cuba taip nama atau kod DUN lain, atau klik kembali:`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Kembali ke pilihan DUN', callback_data: 'back_dun' }],
            ],
          },
        },
      );
    }
    return;
  }

  session.conversation.push({ role: 'user', content: text });

  let llmResult;
  try {
    llmResult = await callLlm(
      config.openrouterBaseUrl,
      config.openrouterApiKey,
      config.llmModel,
      session.conversation,
    );
  } catch (err) {
    logger.error({ err, chatId }, 'LLM call failed');
    await ctx.reply('Maaf, saya tidak dapat memproses mesej awak. Sila cuba sebentar lagi.');
    return;
  }

  if (llmResult.topic_changed) {
    session.conversation.pop();

    const topicChangeMsg = 'Nampaknya awak beralih ke isu yang lain. Isu sebelum ini masih belum selesai. Sila hantar atau batalkan isu semasa dahulu sebelum beralih kepada isu baru.';
    const replyText = `${topicChangeMsg}\n\n—\n📋 Ringkasan:\n${session.latestSummary}`;

    await ctx.reply(replyText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Hantar', callback_data: 'submit' },
            { text: '❌ Batal', callback_data: 'cancel' },
          ],
        ],
      },
    });
    return;
  }

  if (llmResult.troll_detected) {
    session.conversation.pop();

    const trollMsg = 'Harap berikan respons yang serius. Isu sebelum ini masih belum selesai.';
    const replyText = `${trollMsg}\n\n—\n📋 Ringkasan:\n${session.latestSummary}`;

    await ctx.reply(replyText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Hantar', callback_data: 'submit' },
            { text: '❌ Batal', callback_data: 'cancel' },
          ],
        ],
      },
    });
    return;
  }

  session.conversation.push({ role: 'assistant', content: llmResult.response });
  session.latestSummary = llmResult.summary;
  session.intentType = llmResult.intent_type;
  session.scope = llmResult.scope;
  session.language = detectLanguage(text);

  await saveSession(redis, chatId, session);

  const wordCount = llmResult.summary.trim().split(/\s+/).length;
  const showSubmit = wordCount > 7;

  const replyText = showSubmit
    ? `${llmResult.response}\n\n—\n📋 Ringkasan:\n${llmResult.summary}\n\n_Korang boleh terus klik 'Hantar' kalau rasa ringkasan ni dah cukup padu!_`
    : llmResult.response;

  await ctx.reply(replyText, {
    parse_mode: 'Markdown',
    ...(showSubmit && {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Hantar', callback_data: 'submit' },
            { text: '❌ Batal', callback_data: 'cancel' },
          ],
        ],
      },
    }),
  });
}
