import { upsert } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { ghlPages } from '../clients/ghl.js';

interface GhlContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  tags: string[];
  dateAdded: string;
  [k: string]: unknown;
}

export async function syncGhlContacts(since?: Date): Promise<number> {
  const params: Record<string, string> = {};
  if (since) params['startAfterDate'] = since.toISOString();

  const rows: Record<string, unknown>[] = [];
  for await (const page of ghlPages<GhlContact>('/contacts/', params)) {
    for (const c of page) {
      rows.push({
        ghl_contact_id: c.id,
        first_name: c.firstName ?? null,
        last_name: c.lastName ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        source: c.source ?? null,
        tags: c.tags ?? [],
        date_added: c.dateAdded ?? null,
        raw_json: c,
        synced_at: new Date().toISOString(),
      });
    }
  }
  await upsert('raw', 'ghl_contacts', rows, 'ghl_contact_id');
  logger.info('ghl_contacts synced', { count: rows.length });
  return rows.length;
}
