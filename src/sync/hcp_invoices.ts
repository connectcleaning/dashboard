import { sql } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { hcpPages } from '../clients/hcp.js';

interface HcpInvoice {
  id: string;
  job?: { id: string };
  customer?: { id: string };
  total_amount: number;
  amount_paid: number;
  status: string;
  sent_at: string;
  paid_at: string;
  [k: string]: unknown;
}

export async function syncHcpInvoices(since?: Date): Promise<number> {
  const params: Record<string, string> = {};
  if (since) params['updated_at[gte]'] = since.toISOString();

  let count = 0;
  for await (const page of hcpPages<HcpInvoice>('/invoices', params)) {
    for (const inv of page) {
      await sql`
        insert into raw.hcp_invoices (
          hcp_invoice_id, hcp_job_id, hcp_customer_id,
          amount, paid_amount, status, sent_at, paid_at, raw_json, synced_at
        ) values (
          ${inv.id}, ${inv.job?.id ?? null}, ${inv.customer?.id ?? null},
          ${inv.total_amount ?? null}, ${inv.amount_paid ?? null}, ${inv.status ?? null},
          ${inv.sent_at ?? null}, ${inv.paid_at ?? null},
          ${sql.json(inv as never)}, now()
        )
        on conflict (hcp_invoice_id) do update set
          amount      = excluded.amount,
          paid_amount = excluded.paid_amount,
          status      = excluded.status,
          paid_at     = excluded.paid_at,
          raw_json    = excluded.raw_json,
          synced_at   = now()
      `;
      count++;
    }
  }
  logger.info('hcp_invoices synced', { count });
  return count;
}
