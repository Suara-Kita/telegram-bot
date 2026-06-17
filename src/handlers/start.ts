import { type Context } from 'telegraf';
import type { Redis } from 'ioredis';
import { createSession, saveSession } from '../session.js';
import { getLokalDuns, loadCachedConstituency } from '../constituency.js';

const WELCOME = 'Selamat datang ke Suara Sekijang! 👋\n\nJom fokus pada masa depan Sekijang. Platform ini dibina khas sebagai ruang sembang \'no filter\' dan 100% rahsia (anon) untuk kita sembang apa sahaja pasal landskap politik dan hala tuju anak muda.\n\nKongsi idea anda, luahkan pandangan politik, kritik cara lama, bincang pasal peluang ekonomi belia, berkongsi visi, atau hantar isu setempat seperti banjir dan fasiliti awam—semuanya tanpa perlu risau tentang identiti anda.\n\n⚙️ Dibangunkan & dipacu secara telus oleh Pasukan Digital Barisan Nasional Sekijang.\n\n🔒 Suara anda, identiti anda kekal selamat.';

const GREETING = 'Jom mula berdiskusi atau taip apa sahaja di bawah: 👇';

export async function startHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = createSession();
  await saveSession(redis, chatId, session);

  const cached = await loadCachedConstituency(redis, chatId);

  if (cached) {
    await ctx.reply(
      `DUN anda: ${cached.dun} (${cached.parlimen})`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Ya, sambung', callback_data: 'use_cached_dun' },
              { text: '✏️ Tukar DUN', callback_data: 'change_dun' },
            ],
          ],
        },
      },
    );
  } else {
    const lokal = getLokalDuns();
    const buttons = lokal.map((d) => [
      { text: `${d.dun} (${d.parlimen})`, callback_data: `dun_${d.code_dun.toLowerCase().replace(/\./g, '')}` },
    ]);

    await ctx.reply(WELCOME, {
      reply_markup: {
        inline_keyboard: [
          ...buttons,
          [{ text: '🌐 Lain-lain DUN', callback_data: 'dun_lain' }],
        ],
      },
    });
  }
}
