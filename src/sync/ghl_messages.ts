import { upsert } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { fetchWithRetry } from '../lib/http.js';

interface GhlConversation {
  id: string;
  contactId: string;
  lastMessageDate?: string;
  type?: string;
  [k: string]: unknown;
}

interface GhlMessage {
  id: string;
  conversationId: string;
  contactId?: string;
  type: string;
  direction: string;
  dateAdded: string;
  [k: string]: unknown;
}

const BASE = 'https://services.leadconnectorhq.com';
const headers = {
  Authorization: `Bearer ${env.GHL_API_TOKEN}`,
  Version: '2021-07-28',
  'Content-Type': 'application/json',
};

export async function syncGhlMessages(since?: Date): Promise<number> {
  let total = 0;
  let page = 1;

  while (true) {
    const qs = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, limit: '20', page: String(page) });
    if (since) qs.set('startAfterDate', since.toISOString());

    const res = await fetchWithRetry(`${BASE}/conversations/search?${qs}`, { headers });
    const data = await res.json() as { conversations?: GhlConversation[]; meta?: { total?: number } };
    const convs = data.conversations ?? [];
    if (convs.length === 0) break;

    for (const conv of convs) {
      try {
        const msgRes = await fetchWithRetry(`${BASE}/conversations/${conv.id}/messages?limit=100`, { headers });
        const msgData = await msgRes.json() as { messages?: GhlMessage[] };
        const messages = Array.isArray(msgData.messages) ? msgData.messages : [];
        const rows: Record<string, unknown>[] = [];
        const seen = new Set<string>();
        for (const msg of messages) {
          if (seen.has(msg.id)) continue;
          seen.add(msg.id);
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
        if (rows.length) await upsert('raw', 'ghl_messages', rows, 'message_id');
        total += rows.length;
      } catch {
        // skip individual conversation errors
      }
    }

    page++;
  }

  logger.info('ghl_messages synced', { count: total });
  return total;
}
