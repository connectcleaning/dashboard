import { upsert } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { hcpPages } from '../clients/hcp.js';

interface HcpCustomer {
  id: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  mobile_number: string;
  home_number: string;
  address?: { city?: string; zip?: string };
  tags: string[];
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}

export async function syncHcpCustomers(since?: Date): Promise<number> {
  const params: Record<string, string> = {};
  if (since) params['updated_at[gte]'] = since.toISOString();

  let total = 0;
  for await (const page of hcpPages<HcpCustomer>('/customers', params)) {
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const c of page) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      rows.push({
        hcp_customer_id: c.id,
        first_name: c.first_name ?? null,
        last_name: c.last_name ?? null,
        company: c.company ?? null,
        email: c.email ?? null,
        mobile_phone: c.mobile_number ?? null,
        home_phone: c.home_number ?? null,
        address_city: c.address?.city ?? null,
        address_zip: c.address?.zip ?? null,
        tags: c.tags ?? [],
        created_at: c.created_at ?? null,
        updated_at: c.updated_at ?? null,
        raw_json: c,
        synced_at: new Date().toISOString(),
      });
    }
    if (rows.length) await upsert('raw', 'hcp_customers', rows, 'hcp_customer_id');
    total += rows.length;
  }
  logger.info('hcp_customers synced', { count: total });
  return total;
}
