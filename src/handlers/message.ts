import { type Context } from "telegraf";
import type { Redis } from "ioredis";
import pino from "pino";
import type { Config } from "../types.js";
import { loadSession, saveSession, createSession } from "../session.js";
import { callLlm } from "../llm.js";
import { detectLanguage } from "../language.js";
import { searchDun, searchDunFuzzy, searchDunWithLlm, flattenCode, loadCachedConstituency } from "../constituency.js";

const logger = pino({ name: "message-handler" });
const GREETING =
  "Jom mula berdiskusi atau taip apa sahaja di bawah: 👇\n\n_💡 Jika tidak pasti untuk memulakan diskusi, kita bermula dengan minat anda, apa anda suka lakukan?_";

export async function messageHandler(
  ctx: Context,
  redis: Redis,
  config: Config,
): Promise<void> {
  const chatId = ctx.chat?.id;
  const text =
    ctx.message && "text" in ctx.message ? ctx.message.text : undefined;
  if (!chatId || !text) return;

  let session = await loadSession(redis, chatId);

  if (!session) {
    const cached = await loadCachedConstituency(redis, chatId);
    if (cached) {
      session = createSession();
      session.state = "conversing";
      session.constituency = cached;
      session.conversation.push({ role: "assistant", content: GREETING });
      await saveSession(redis, chatId, session);
      await ctx.reply(
        `🧭 Diskusi seterusnya adalah untuk DUN: ${cached.dun}. Sila taip isu atau cadangan anda.`,
      );
      return;
    }
    await ctx.reply("Sila mulakan dengan /start untuk pilih DUN anda.");
    return;
  }

  if (session.state === "awaiting_constituency") {
    await ctx.reply(
      "Sila pilih DUN anda menggunakan butang di atas, atau taip /start.",
    );
    return;
  }

  if (session.state === "awaiting_dun_search") {
    let match = searchDun(text);
    if (!match) match = searchDunFuzzy(text);
    if (!match) {
      const llmResult = await searchDunWithLlm(
        text,
        config.openrouterBaseUrl,
        config.openrouterApiKey,
        config.llmModel,
      );
      if (llmResult.candidates.length > 0) {
        if (llmResult.candidates.length === 1) {
          const c = llmResult.candidates[0];
          session.pendingDun = {
            code_dun: c.code_dun,
            dun: c.dun_name,
            parlimen: c.parlimen,
            code_parlimen: c.code_parlimen,
          };
          await saveSession(redis, chatId, session);
          const text = `Anda maksudkan **${c.dun_name} (${c.parlimen})**?`;
          await ctx.reply(text, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Ya", callback_data: "confirm_dun" },
                  { text: "❌ Tidak", callback_data: "retry_dun" },
                ],
              ],
            },
          });
        } else if (llmResult.candidates.length <= 5) {
          const buttons = llmResult.candidates.map((c) => [
            {
              text: `${c.dun_name} (${c.parlimen})`,
              callback_data: `dun_candidate_${flattenCode(c.code_dun)}`,
            },
          ]);
          await ctx.reply(
            llmResult.message || "Sila pilih DUN yang anda maksudkan:",
            {
              reply_markup: {
                inline_keyboard: [
                  ...buttons,
                  [
                    {
                      text: "🔙 Kembali ke pilihan DUN",
                      callback_data: "back_dun",
                    },
                  ],
                ],
              },
            },
          );
        } else {
          await ctx.reply(llmResult.message);
        }
      } else if (llmResult.message) {
        await ctx.reply(llmResult.message, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🔙 Kembali ke pilihan DUN",
                  callback_data: "back_dun",
                },
              ],
            ],
          },
        });
      } else {
        await ctx.reply(
          `Tiada padanan untuk "${text}". Cuba taip nama atau kod DUN lain, atau klik kembali:\n\n🔗 Semak Di Sini: https://mysprsemak.spr.gov.my/semakan/daftarPemilih`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "🔙 Kembali ke pilihan DUN",
                    callback_data: "back_dun",
                  },
                ],
              ],
            },
          },
        );
      }
      return;
    }

    session.pendingDun = match;
    await saveSession(redis, chatId, session);
    await ctx.reply(`Anda maksudkan **${match.dun} (${match.parlimen})**?`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Ya", callback_data: "confirm_dun" },
            { text: "❌ Tidak", callback_data: "retry_dun" },
          ],
        ],
      },
    });
    return;
  }

  session.conversation.push({ role: "user", content: text });

  const userLanguage = detectLanguage(text);

  const useFallback = userLanguage === "mandarin" || userLanguage === "tamil";
  const activeBaseUrl =
    useFallback && config.fallbackOpenrouterBaseUrl
      ? config.fallbackOpenrouterBaseUrl
      : config.openrouterBaseUrl;
  const activeApiKey =
    useFallback && config.fallbackOpenrouterApiKey
      ? config.fallbackOpenrouterApiKey
      : config.openrouterApiKey;
  const activeModel = useFallback ? config.fallbackLlmModel : config.llmModel;

  let llmResult;
  try {
    llmResult = await callLlm(
      activeBaseUrl,
      activeApiKey,
      activeModel,
      session.conversation,
      userLanguage,
    );
  } catch (err) {
    logger.error({ err, chatId }, "LLM call failed");
    await ctx.reply(
      "Maaf, saya tidak dapat memproses mesej awak. Sila cuba sebentar lagi.",
    );
    return;
  }

  if (llmResult.troll_detected) {
    session.conversation.pop();

    const trollMsg =
      "Harap berikan respons yang serius. Isu sebelum ini masih belum selesai.";
    const replyText = `${trollMsg}\n\n—\n📌 *Ringkasan Maklum Balas:*\n_${session.latestSummary}_`;

    await ctx.reply(replyText, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Hantar", callback_data: "submit" },
            { text: "❌ Batal", callback_data: "cancel" },
          ],
        ],
      },
    });
    return;
  }

  session.conversation.push({ role: "assistant", content: llmResult.response });
  session.latestSummary = llmResult.summary;
  session.intentType = llmResult.intent_type;
  session.scope = llmResult.scope;
  session.language = userLanguage;

  await saveSession(redis, chatId, session);

  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(llmResult.summary);
  const wordCount = hasCJK
    ? llmResult.summary.replace(/[\s\p{P}]/gu, "").length
    : llmResult.summary.trim().split(/\s+/).length;
  const showSubmit = hasCJK ? wordCount >= 15 : wordCount > 7;

  const formattedResponse = llmResult.response
    .replace(/\.\s*/, ".\n\n")
    .replace(/\?\s*/g, "?\n");

  const replyText = showSubmit
    ? `${formattedResponse}\n\n—\n📌 *Ringkasan Maklum Balas:*\n_${llmResult.summary}_\n\n_💡 Jika ringkasan ini sudah tepat, anda boleh terus klik 'Hantar'!_`
    : formattedResponse;

  await ctx.reply(replyText, {
    parse_mode: "Markdown",
    ...(showSubmit && {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Hantar", callback_data: "submit" },
            { text: "❌ Batal", callback_data: "cancel" },
          ],
        ],
      },
    }),
  });
}
