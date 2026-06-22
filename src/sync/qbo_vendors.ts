import { upsert } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { qboQuery } from '../clients/qbo.js';

interface QboVendor {
  Id: string;
  DisplayName?: string;
  Active?: boolean;
  [k: string]: unknown;
}

export async function syncQboVendors(): Promise<number> {
  let total = 0;
  for await (const page of qboQuery<QboVendor>('Vendor')) {
    const rows = page.map(v => ({
      qbo_id: v.Id,
      display_name: v.DisplayName ?? null,
      active: v.Active ?? null,
      raw_json: v,
      synced_at: new Date().toISOString(),
    }));
    if (rows.length) await upsert('raw', 'qbo_vendors', rows, 'qbo_id');
    total += rows.length;
  }
  logger.info('qbo_vendors synced', { count: total });
  return total;
}
