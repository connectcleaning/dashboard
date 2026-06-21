import { upsert } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { fetchWithRetry } from '../lib/http.js';

interface GhlConversation {
  id: string;
  contactId: string;
  lastMessageDate?: string;
  lastMessageType?: string;
  type?: string;
  unreadCount?: number;
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
    const qs = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, limit: '100', page: String(page) });
    if (since) qs.set('startAfterDate', since.toISOString());

    const res = await fetchWithRetry(`${BASE}/conversations/search?${qs}`, { headers });
    const data = await res.json() as { conversations?: GhlConversation[]; meta?: { total?: number } };
    const convs = data.conversations ?? [];
    if (convs.length === 0) break;
    // Stop once we've fetched all records reported by the API
    const apiTotal = data.meta?.total ?? Infinity;
    if (total >= apiTotal) break;

    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const conv of convs) {
      if (seen.has(conv.id)) continue;
      seen.add(conv.id);
      const lastMsgDate = conv.lastMessageDate
        ? (String(conv.lastMessageDate).length > 10
            ? new Date(Number(conv.lastMessageDate)).toISOString()
            : new Date(Number(conv.lastMessageDate) * 1000).toISOString())
        : null;
      rows.push({
        message_id: conv.id,
        ghl_contact_id: conv.contactId ?? null,
        conversation_id: conv.id,
        channel: conv.type ?? null,
        direction: null,
        created_at: lastMsgDate,
        raw_json: conv,
      });
    }
    if (rows.length) await upsert('raw', 'ghl_messages', rows, 'message_id');
    total += rows.length;
    page++;
  }

  logger.info('ghl_conversations synced', { count: total });
  return total;
}
