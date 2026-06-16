import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Redis } from 'ioredis';
import type { Constituency } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface DunProperties {
  state: string;
  parlimen: string;
  code_parlimen: string;
  dun: string;
  code_dun: string;
}

let allDuns: DunProperties[] | null = null;

function loadDuns(): DunProperties[] {
  if (allDuns) return allDuns;
  const path = join(__dirname, '..', 'data', 'duns.json');
  const raw = readFileSync(path, 'utf-8');
  allDuns = JSON.parse(raw) as DunProperties[];
  return allDuns;
}

export interface DunMatch {
  state: string;
  parlimen: string;
  code_parlimen: string;
  dun: string;
  code_dun: string;
}

export function getLokalDuns(): DunMatch[] {
  const duns = loadDuns();
  return duns.filter(
    (d) => d.dun === 'N.03 Pemanis' || d.dun === 'N.04 Kemelah',
  );
}

function constituencyKey(chatId: number): string {
  return `constituency:telegram:${chatId}`;
}

export async function saveCachedConstituency(redis: Redis, chatId: number, c: Constituency): Promise<void> {
  await redis.set(constituencyKey(chatId), JSON.stringify(c));
}

export async function loadCachedConstituency(redis: Redis, chatId: number): Promise<Constituency | null> {
  const raw = await redis.get(constituencyKey(chatId));
  if (!raw) return null;
  return JSON.parse(raw) as Constituency;
}

export async function deleteCachedConstituency(redis: Redis, chatId: number): Promise<void> {
  await redis.del(constituencyKey(chatId));
}

export function searchDun(query: string): DunMatch | null {
  const duns = loadDuns();
  const q = query.trim().toLowerCase();

  let exact: DunProperties | null = null;
  let code: DunProperties | null = null;
  let partial: DunProperties | null = null;

  for (const d of duns) {
    const dunLower = d.dun.toLowerCase();
    if (dunLower === q) {
      return d;
    }
    if (d.code_dun.toLowerCase() === q) {
      code = d;
    }
    if (dunLower.includes(q) && !partial) {
      partial = d;
    }
  }

  return code ?? partial;
}
