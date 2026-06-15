import { type Context } from 'telegraf';
import type { Redis } from 'ioredis';
import { createSession, saveSession } from '../session.js';

const GREETING = 'Selamat datang ke Suara Sekijang! 👋\n\nJom fokus pada masa depan Sekijang. Platform ini dibina khas sebagai ruang sembang \'no filter\' dan 100% rahsia (anon) untuk kita sembang apa sahaja pasal landskap politik dan hala tuju anak muda.\n\nKongsi idea korang, luahkan pandangan politik, kritik cara lama, bincang pasal peluang ekonomi belia, berkongsi visi, atau hantar isu setempat seperti banjir dan fasiliti awam—semuanya tanpa perlu risau tentang identiti korang.\n\n⚙️ Dibangunkan & dipacu secara telus oleh Pasukan Digital Barisan Nasional Sekijang.\n\n🔒 Suara korang, identiti korang kekal selamat. Jom mula berdiskusi atau taip apa sahaja di bawah: 👇';

export async function startHandler(ctx: Context, redis: Redis): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = createSession();
  session.conversation.push({ role: 'assistant', content: GREETING });
  await saveSession(redis, chatId, session);

  await ctx.reply(GREETING);
}
