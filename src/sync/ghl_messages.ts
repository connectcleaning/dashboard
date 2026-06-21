import { upsert } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { ghlPages, ghlGet } from '../clients/ghl.js';

interface GhlConversation {
  id: string;
  contactId: string;
  [k: string]: unknown;
}

interface GhlMessage {
  id: string;
  conversationId: string;
  contactId: string;
  type: string;
  direction: string;
  dateAdded: string;
  [k: string]: unknown;
}

export async function syncGhlMessages(since?: Date): Promise<number> {
  const params: Record<string, string> = { limit: '20' };
  if (since) params['startAfterDate'] = since.toISOString();

  let count = 0;
  for await (const page of ghlPages<GhlConversation>('/conversations/search', params)) {
    const rows: Record<string, unknown>[] = [];
    for (const conv of page) {
      const msgData = await ghlGet<{ messages?: GhlMessage[] }>(`/conversations/${conv.id}/messages`);
      for (const msg of msgData.messages ?? []) {
        rows.push({
          message_id: msg.id,
          ghl_contact_id: conv.contactId ?? null,
          conversation_id: conv.id,
          channel: msg.type ?? null,
          direction: msg.direction ?? null,
          created_at: msg.dateAdded ?? null,
          raw_json: msg,
        });
      }
    }
    if (rows.length) await upsert('raw', 'ghl_messages', rows, 'message_id');
    count += rows.length;
  }
  logger.info('ghl_messages synced', { count });
  return count;
}
