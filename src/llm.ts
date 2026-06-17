import pino from 'pino';
import { LlmResponse } from './types.js';

const logger = pino({ name: 'llm' });

const SYSTEM_PROMPT = `You are a Malaysian constituency service assistant having a natural conversation with a citizen. Your goal is to understand their issue deeply.

The main engine needs to classify this issue into categories like health, infrastructure, education, etc. Your job is to naturally ask follow-up questions that reveal what the issue is about, where it is, who is affected, and why it matters. Do NOT ask "what category is this" directly.

Rules:
- Ask natural follow-up questions to understand the issue fully.
- Before asking follow-up questions, first acknowledge the user's idea or concern with a simple word of encouragement. Keep it genuine, not hype.
- If the conversation loops (you ask the same thing twice, or user repeats themselves), set type to "ready".
- After each user message, produce a cumulative record of EVERYTHING the user has shared across the entire conversation so far, not just the latest message. Capture all key details (what, where, when, who, why). Expand naturally for longer input; keep concise for simple messages. Never mention what you still need to ask or what information is still missing. Write in standard Bahasa Malaysia spelling (e.g., "Ogos" not "Agustus"). In the summary field, always refer to the user as "pengundi" (never "pengguna").
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

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        if (attempt < 2) continue;
        throw new Error(`LLM request failed (${response.status}): ${text}`);
      }

      const data = (await response.json()) as OpenRouterResponse;
      const content = data.choices[0]?.message?.content;
      if (!content) {
        if (attempt < 2) continue;
        throw new Error('LLM returned no content');
      }

      let parsed: LlmResponse;
      try {
        parsed = JSON.parse(content) as LlmResponse;
      } catch {
        if (attempt < 2) {
          messages.push({ role: 'assistant', content });
          messages.push({
            role: 'user',
            content: `Response was not valid JSON: ${content.slice(0, 100)}. Respond with ONLY valid JSON matching the requested schema.`,
          });
          continue;
        }
        logger.warn({ content }, 'LLM returned invalid JSON on final attempt, using raw text');
        return {
          type: 'question',
          response: content,
          summary: '',
          intent_type: 'other',
          scope: 'local',
          topic_changed: false,
          troll_detected: false,
        };
      }

      const missing: string[] = [];
      if (!parsed.type) missing.push('type');
      if (!parsed.response) missing.push('response');
      if (!parsed.summary) missing.push('summary');
      if (!parsed.intent_type) missing.push('intent_type');
      if (!parsed.scope) missing.push('scope');
      if (parsed.topic_changed === undefined) missing.push('topic_changed');
      if (parsed.troll_detected === undefined) missing.push('troll_detected');

      if (missing.length > 0) {
        if (attempt < 2) {
          messages.push({ role: 'assistant', content });
          messages.push({
            role: 'user',
            content: `Response is missing required fields: ${missing.join(', ')}. Provide a complete response with all fields.`,
          });
          continue;
        }
        logger.warn({ parsed, missing }, 'LLM response missing fields on final attempt, filling defaults');
        parsed.type = parsed.type || 'question';
        parsed.response = parsed.response || '';
        parsed.summary = parsed.summary || '';
        parsed.intent_type = parsed.intent_type || 'other';
        parsed.scope = parsed.scope || 'local';
        parsed.topic_changed = parsed.topic_changed ?? false;
        parsed.troll_detected = parsed.troll_detected ?? false;
      }

      return parsed;
    } catch (e) {
      if (attempt < 2) continue;
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    type: 'question',
    response: 'Maaf, saya tidak dapat memproses mesej awak. Sila cuba sebentar lagi.',
    summary: '',
    intent_type: 'other',
    scope: 'local',
    topic_changed: false,
    troll_detected: false,
  };
}
