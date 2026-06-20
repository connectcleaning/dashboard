import { sql } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { hcpPages } from '../clients/hcp.js';

interface HcpEmployee {
  id: string;
  name: string;
  role: string;
  is_active: boolean;
  email: string;
  [k: string]: unknown;
}

export async function syncHcpEmployees(): Promise<number> {
  let count = 0;
  for await (const page of hcpPages<HcpEmployee>('/employees')) {
    for (const e of page) {
      await sql`
        insert into raw.hcp_employees (hcp_employee_id, name, role, is_active, email, raw_json, synced_at)
        values (${e.id}, ${e.name}, ${e.role}, ${e.is_active}, ${e.email ?? null}, ${sql.json(e as never)}, now())
        on conflict (hcp_employee_id) do update set
          name      = excluded.name,
          role      = excluded.role,
          is_active = excluded.is_active,
          email     = excluded.email,
          raw_json  = excluded.raw_json,
          synced_at = now()
      `;
      count++;
    }
  }
  logger.info('hcp_employees synced', { count });
  return count;
}
