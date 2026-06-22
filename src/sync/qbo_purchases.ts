import { upsert } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { qboQuery, qboTimestamp } from '../clients/qbo.js';

interface QboPurchase {
  Id: string;
  TxnDate?: string;
  TotalAmt?: number;
  PaymentType?: string;
  EntityRef?: { name?: string };
  MetaData?: { LastUpdatedTime?: string };
  [k: string]: unknown;
}

export async function syncQboPurchases(since?: Date): Promise<number> {
  const where = since ? `MetaData.LastUpdatedTime > '${qboTimestamp(since)}'` : '';
  let total = 0;
  for await (const page of qboQuery<QboPurchase>('Purchase', where)) {
    const rows = page.map(p => ({
      qbo_id: p.Id,
      txn_date: p.TxnDate ?? null,
      total_amount: p.TotalAmt ?? null,
      payment_type: p.PaymentType ?? null,
      vendor_name: p.EntityRef?.name ?? null,
      updated_at: p.MetaData?.LastUpdatedTime ?? null,
      raw_json: p,
      synced_at: new Date().toISOString(),
    }));
    if (rows.length) await upsert('raw', 'qbo_purchases', rows, 'qbo_id');
    total += rows.length;
  }
  logger.info('qbo_purchases synced', { count: total });
  return total;
}
