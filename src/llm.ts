import pino from 'pino';
import { LlmResponse } from './types.js';

const logger = pino({ name: 'llm' });

const SYSTEM_PROMPT = `You are a Malaysian constituency service assistant having a natural conversation with a citizen. Your goal is to understand their issue deeply.

The main engine needs to classify this issue into categories like health, infrastructure, education, etc. Your job is to naturally ask follow-up questions that reveal what the issue is about, where it is, who is affected, and why it matters. Do NOT ask "what category is this" directly.

Rules:
- Ask natural follow-up questions to understand the issue fully.
- Before asking follow-up questions, first acknowledge the user's idea or concern with a simple word of encouragement. Keep it genuine, not hype.
- If the conversation loops (you ask the same thing twice, or user repeats themselves), set type to "ready".
- After each user message, produce a cumulative record of EVERYTHING the user has shared across the entire conversation so far, not just the latest message. Capture all key details (what, where, when, who, why). Expand naturally for longer input; keep concise for simple messages. Never mention what you still need to ask or what information is still missing. Write in standard Bahasa Malaysia spelling (e.g., "Ogos" not "Agustus").
- Every response must be in the SAME language as the user's most recent message. If the user writes in English, respond in English. If the user writes in Bahasa Malaysia, respond in Bahasa Malaysia. If the user writes in another language (e.g. Mandarin, Tamil), respond in that language.
- The initial greeting is in Bahasa Malaysia. After the first user message, switch entirely to the user's language and stay there. Re-evaluate on every message.
- If the user's message clearly changes to a completely different topic unrelated to the conversation so far, set topic_changed to true. The first message of a session is never a topic change. Natural elaboration or follow-up detail is not a topic change.
- If the user's message contains impossible claims, logical contradictions, appears to be intentionally trolling or nonsensical (e.g., "8 days a week"), or consists of pure insults/name-calling without a specific identifiable real-world issue (e.g., "Bodoh la UMNO, mati je" with no concrete complaint), set troll_detected to true. Normal exaggeration, frustration, or lack of technical knowledge is not trolling.

Output JSON with exactly these fields:
{
  "type": "question" or "ready",
  "response": "your natural reply to the user",
  "summary": "compact record of everything the user has said so far — not a summary of the conversation. Contains user's statements only, length matches the detail provided by the user",
  "intent_type": "infrastructure" or "health" or "education" or "public_safety" or "economy_and_labor" or "environment" or "governance" or "social_welfare" or "housing" or "other",
  "scope": "local" or "state" or "national",
  "topic_changed": true or false,
  "troll_detected": true or false
}`;

interface OpenRouterChoice {
  message: {
    content: string;
  };
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
}

export async function callLlm(
  baseUrl: string,
  apiKey: string,
  model: string,
  conversation: Array<{ role: string; content: string }>,
): Promise<LlmResponse> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversation.map((c) => ({ role: c.role, content: c.content })),
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as OpenRouterResponse;
  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned no content');
  }

  const parsed = JSON.parse(content) as LlmResponse;

  if (!parsed.type || !parsed.response || !parsed.summary || !parsed.intent_type || !parsed.scope || parsed.topic_changed === undefined || parsed.troll_detected === undefined) {
    logger.warn({ parsed }, 'LLM response missing fields, filling defaults');
    parsed.type = parsed.type || 'question';
    parsed.response = parsed.response || '';
    parsed.summary = parsed.summary || '';
    parsed.intent_type = parsed.intent_type || 'other';
    parsed.scope = parsed.scope || 'local';
    parsed.topic_changed = parsed.topic_changed ?? false;
    parsed.troll_detected = parsed.troll_detected ?? false;
  }

  return parsed;
}
