import { sql } from '../lib/db.js';
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

  let count = 0;
  for await (const page of hcpPages<HcpCustomer>('/customers', params)) {
    for (const c of page) {
      await sql`
        insert into raw.hcp_customers (
          hcp_customer_id, first_name, last_name, company, email,
          mobile_phone, home_phone, address_city, address_zip,
          tags, created_at, updated_at, raw_json, synced_at
        ) values (
          ${c.id}, ${c.first_name ?? null}, ${c.last_name ?? null}, ${c.company ?? null},
          ${c.email ?? null}, ${c.mobile_number ?? null}, ${c.home_number ?? null},
          ${c.address?.city ?? null}, ${c.address?.zip ?? null},
          ${c.tags ?? []}, ${c.created_at ?? null}, ${c.updated_at ?? null},
          ${sql.json(c as never)}, now()
        )
        on conflict (hcp_customer_id) do update set
          first_name   = excluded.first_name,
          last_name    = excluded.last_name,
          company      = excluded.company,
          email        = excluded.email,
          mobile_phone = excluded.mobile_phone,
          home_phone   = excluded.home_phone,
          address_city = excluded.address_city,
          address_zip  = excluded.address_zip,
          tags         = excluded.tags,
          updated_at   = excluded.updated_at,
          raw_json     = excluded.raw_json,
          synced_at    = now()
      `;
      count++;
    }
  }
  logger.info('hcp_customers synced', { count });
  return count;
}
