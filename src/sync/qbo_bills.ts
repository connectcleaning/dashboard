import { upsert } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { qboQuery, qboTimestamp } from '../clients/qbo.js';

interface QboBill {
  Id: string;
  TxnDate?: string;
  TotalAmt?: number;
  VendorRef?: { name?: string };
  MetaData?: { LastUpdatedTime?: string };
  [k: string]: unknown;
}

export async function syncQboBills(since?: Date): Promise<number> {
  const where = since ? `MetaData.LastUpdatedTime > '${qboTimestamp(since)}'` : '';
  let total = 0;
  for await (const page of qboQuery<QboBill>('Bill', where)) {
    const rows = page.map(b => ({
      qbo_id: b.Id,
      txn_date: b.TxnDate ?? null,
      total_amount: b.TotalAmt ?? null,
      vendor_name: b.VendorRef?.name ?? null,
      updated_at: b.MetaData?.LastUpdatedTime ?? null,
      raw_json: b,
      synced_at: new Date().toISOString(),
    }));
    if (rows.length) await upsert('raw', 'qbo_bills', rows, 'qbo_id');
    total += rows.length;
  }
  logger.info('qbo_bills synced', { count: total });
  return total;
}
