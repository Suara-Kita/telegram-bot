import type { Redis } from 'ioredis';
import type { Session } from './types.js';

const SESSION_TTL = 3600;

function sessionKey(chatId: number): string {
  return `session:telegram:${chatId}`;
}

export async function loadSession(redis: Redis, chatId: number): Promise<Session | null> {
  const raw = await redis.get(sessionKey(chatId));
  if (!raw) return null;
  return JSON.parse(raw) as Session;
}

export async function saveSession(redis: Redis, chatId: number, session: Session): Promise<void> {
  session.updatedAt = new Date().toISOString();
  await redis.setex(sessionKey(chatId), SESSION_TTL, JSON.stringify(session));
}

export async function deleteSession(redis: Redis, chatId: number): Promise<void> {
  await redis.del(sessionKey(chatId));
}

export function createSession(): Session {
  const now = new Date().toISOString();
  return {
    state: 'awaiting_constituency',
    conversation: [],
    latestSummary: '',
    intentType: '',
    scope: '',
    language: 'ms',
    constituency: null,
    pendingDun: null,
    createdAt: now,
    updatedAt: now,
  };
}
