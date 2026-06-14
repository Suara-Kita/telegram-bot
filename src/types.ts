export interface Config {
  telegramBotToken: string;
  redisHost: string;
  redisPort: number;
  redisPassword: string;
  queueVoterInputs: string;
  openrouterBaseUrl: string;
  openrouterApiKey: string;
  llmModel: string;
  logLevel: string;
}

export interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface Session {
  state: 'conversing';
  conversation: ConversationEntry[];
  latestSummary: string;
  intentType: string;
  scope: string;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export interface LlmResponse {
  type: 'question' | 'ready';
  response: string;
  summary: string;
  intent_type: string;
  scope: string;
  topic_changed: boolean;
  troll_detected: boolean;
}

export interface VoterInput {
  pipeline_metadata: {
    ingestion_id: string;
    source_channel: string;
    ingested_at: string;
    trace_url: string | null;
  };
  source_profile: {
    client_identifier: string;
    display_name: string | null;
    contact_info: string | null;
    inferred_constituency: string | null;
  };
  content_payload: {
    raw_text: string;
    content_type: string;
    media_attachments: string[];
  };
  context_anchor: null;
}
