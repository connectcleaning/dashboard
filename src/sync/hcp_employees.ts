import { upsert } from '../lib/db.js';
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
  let total = 0;
  for await (const page of hcpPages<HcpEmployee>('/employees')) {
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const e of page) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      rows.push({
        hcp_employee_id: e.id,
        name: e.name ?? null,
        role: e.role ?? null,
        is_active: e.is_active ?? null,
        email: e.email ?? null,
        raw_json: e,
        synced_at: new Date().toISOString(),
      });
    }
    if (rows.length) await upsert('raw', 'hcp_employees', rows, 'hcp_employee_id');
    total += rows.length;
  }
  logger.info('hcp_employees synced', { count: total });
  return total;
}
