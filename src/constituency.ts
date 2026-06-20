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

export interface LlmDunCandidate {
  code_dun: string;
  dun_name: string;
  parlimen: string;
  code_parlimen: string;
  state: string;
}

export interface LlmDunResult {
  candidates: LlmDunCandidate[];
  message: string;
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

export function flattenCode(code: string): string {
  return code.toLowerCase().replace(/\./g, '');
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
  const flatQ = flattenCode(q);

  let code: DunProperties | null = null;
  let partial: DunProperties | null = null;

  for (const d of duns) {
    const dunLower = d.dun.toLowerCase();
    if (dunLower === q) {
      return d;
    }
    if (flattenCode(d.code_dun) === flatQ) {
      code = d;
    }
    if (dunLower.includes(q) && !partial) {
      partial = d;
    }
  }

  return code ?? partial;
}

function trigramSimilarity(a: string, b: string): number {
  const trigrams = (s: string) => {
    const result = new Set<string>();
    for (let i = 0; i < s.length - 2; i++) {
      result.add(s.substring(i, i + 3));
    }
    return result;
  };
  const aT = trigrams(a);
  const bT = trigrams(b);
  if (aT.size === 0 || bT.size === 0) return 0;
  const intersection = new Set([...aT].filter(t => bT.has(t)));
  return intersection.size / Math.min(aT.size, bT.size);
}

export function searchDunFuzzy(query: string): DunMatch | null {
  const duns = loadDuns();
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;

  let best: { match: DunProperties; score: number } | null = null;

  for (const d of duns) {
    const target = d.dun.toLowerCase();
    const score = trigramSimilarity(q, target);
    if (score > 0.5 && (!best || score > best.score)) {
      best = { match: d, score };
    }
  }

  return best?.match ?? null;
}

export function findDunByFlatCode(flatCode: string): DunMatch | null {
  const duns = loadDuns();
  const fc = flatCode.toLowerCase().replace(/\./g, '');
  for (const d of duns) {
    if (flattenCode(d.code_dun) === fc) {
      return d;
    }
  }
  return null;
}

export async function searchDunWithLlm(
  query: string,
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<LlmDunResult> {
  const duns = loadDuns();
  const dunList = duns
    .map((d) => `${d.code_dun} ${d.dun} | ${d.code_parlimen} ${d.parlimen} | ${d.state}`)
    .join('\n');

  const systemPrompt = `You are a Malaysian DUN (state constituency) matcher. Return ONLY valid JSON with no other text.

Given a voter's search query, find the best matching DUN(s) from the list below.

RULES:
- Query like "Pemanis", "N.03" → return that single DUN as candidate
- Query like "Sekijang" (parliament name) → return ALL DUNs under that parliament
- Query like "Johor" (state) → candidates empty, message: "Terlalu umum, sila nyatakan DUN yang lebih spesifik (cth: Pemanis, Larkin)"
- Query unrecognizable → candidates empty, message: "Tiada padanan ditemui. Cuba taip nama atau kod DUN yang lain."
- Handle misspellings and partial names
- Return DUN names exactly as shown in the list (with N.xx prefix)

Response JSON format:
{
  "candidates": [{ "code_dun": "N.03", "dun_name": "N.03 Pemanis", "parlimen": "P.141 Sekijang", "code_parlimen": "P.141", "state": "Johor" }],
  "message": "User-facing message in Bahasa Melayu"
}

DUN LIST:
${dunList}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Cari DUN untuk: "${query}"` },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { candidates: [], message: '' };
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { candidates: [], message: '' };
    }

    const parsed = JSON.parse(content) as LlmDunResult;
    return {
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      message: parsed.message || '',
    };
  } catch {
    return { candidates: [], message: '' };
  } finally {
    clearTimeout(timeoutId);
  }
}
