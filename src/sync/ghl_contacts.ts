import { sql } from '../lib/db.js';
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

  let count = 0;
  for await (const page of ghlPages<GhlContact>('/contacts/', params)) {
    for (const c of page) {
      await sql`
        insert into raw.ghl_contacts (
          ghl_contact_id, first_name, last_name, email, phone,
          source, tags, date_added, raw_json, synced_at
        ) values (
          ${c.id}, ${c.firstName ?? null}, ${c.lastName ?? null},
          ${c.email ?? null}, ${c.phone ?? null}, ${c.source ?? null},
          ${c.tags ?? []}, ${c.dateAdded ?? null},
          ${sql.json(c as never)}, now()
        )
        on conflict (ghl_contact_id) do update set
          first_name = excluded.first_name,
          last_name  = excluded.last_name,
          email      = excluded.email,
          phone      = excluded.phone,
          source     = excluded.source,
          tags       = excluded.tags,
          raw_json   = excluded.raw_json,
          synced_at  = now()
      `;
      count++;
    }
  }
  logger.info('ghl_contacts synced', { count });
  return count;
}
