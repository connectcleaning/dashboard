import { upsert } from '../lib/db.js';
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

  let total = 0;
  for await (const page of hcpPages<HcpInvoice>('/invoices', params)) {
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const inv of page) {
      if (seen.has(inv.id)) continue;
      seen.add(inv.id);
      rows.push({
        hcp_invoice_id: inv.id,
        hcp_job_id: inv.job?.id ?? null,
        hcp_customer_id: inv.customer?.id ?? null,
        amount: inv.total_amount ?? null,
        paid_amount: inv.amount_paid ?? null,
        status: inv.status ?? null,
        sent_at: inv.sent_at ?? null,
        paid_at: inv.paid_at ?? null,
        raw_json: inv,
        synced_at: new Date().toISOString(),
      });
    }
    if (rows.length) await upsert('raw', 'hcp_invoices', rows, 'hcp_invoice_id');
    total += rows.length;
  }
  logger.info('hcp_invoices synced', { count: total });
  return total;
}
