import { sql } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { ghlPages } from '../clients/ghl.js';

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
    for (const conv of page) {
      // fetch messages for each conversation
      const msgData = await import('../clients/ghl.js').then(m =>
        m.ghlGet<{ messages?: GhlMessage[] }>(`/conversations/${conv.id}/messages`),
      );
      for (const msg of msgData.messages ?? []) {
        await sql`
          insert into raw.ghl_messages (
            message_id, ghl_contact_id, conversation_id, channel, direction, created_at, raw_json
          ) values (
            ${msg.id}, ${conv.contactId ?? null}, ${conv.id},
            ${msg.type ?? null}, ${msg.direction ?? null},
            ${msg.dateAdded ?? null}, ${sql.json(msg as never)}
          )
          on conflict (message_id) do nothing
        `;
        count++;
      }
    }
  }
  logger.info('ghl_messages synced', { count });
  return count;
}
