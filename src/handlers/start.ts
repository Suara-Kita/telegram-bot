import { type Context } from "telegraf";
import type { Redis } from "ioredis";
import { createSession, saveSession } from "../session.js";
import { getLokalDuns, loadCachedConstituency } from "../constituency.js";

const WELCOME =
  "*Saya Onn AI, persona Dato' Onn Hafiz.*\n\n"
  + "Sengaja saya nak ajak korang sembang santai kat sini sebab saya nak dengar sendiri setiap suara rakyat.\n\n"
  + "Sebelum kita mula,\n\n"
  + "📌 Pilih DUN Mengundi Korang\n\n"
  + "Korang bawah DUN mana ya? Bagi yang belum pasti, boleh buat semakan senarai daftar pemilih dulu kat pautan bawah ni:\n\n"
  + "🔗 Semak Di Sini: https://mysprsemak.spr.gov.my/semakan/daftarPemilih";

export async function startHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = createSession();
  await saveSession(redis, chatId, session);

  const cached = await loadCachedConstituency(redis, chatId);

  if (cached) {
    const msg = await ctx.reply(`DUN anda: ${cached.dun} (${cached.parlimen})`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Ya, sambung", callback_data: "use_cached_dun" },
            { text: "✏️ Tukar DUN", callback_data: "change_dun" },
          ],
        ],
      },
    });
    session.systemMessageIds = [msg.message_id];
    await saveSession(redis, chatId, session);
  } else {
    const lokal = getLokalDuns();
    const buttons = lokal.map((d) => [
      {
        text: `${d.dun} (${d.parlimen})`,
        callback_data: `dun_${d.code_dun.toLowerCase().replace(/\./g, "")}`,
      },
    ]);

    const msg = await ctx.reply(WELCOME, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          ...buttons,
          [{ text: "🌐 Lain-lain DUN", callback_data: "dun_lain" }],
        ],
      },
    });
    session.systemMessageIds = [msg.message_id];
    await saveSession(redis, chatId, session);
  }
}
