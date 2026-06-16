import { v4 as uuidv4 } from 'uuid';
import { Session, VoterInput } from './types.js';

export function buildVoterInput(
  chatId: number,
  displayName: string | null,
  session: Session,
): VoterInput {
  return {
    pipeline_metadata: {
      ingestion_id: uuidv4(),
      source_channel: 'telegram',
      ingested_at: new Date().toISOString(),
      trace_url: null,
    },
    source_profile: {
      client_identifier: `tg_${chatId}`,
      display_name: displayName,
      contact_info: null,
      inferred_constituency: session.constituency
        ? `${session.constituency.parlimen} - ${session.constituency.dun}`
        : null,
    },
    content_payload: {
      raw_text: session.latestSummary,
      content_type: 'text_only',
      media_attachments: [],
    },
    context_anchor: null,
  };
}
