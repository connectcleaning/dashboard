import { sql } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { hcpPages } from '../clients/hcp.js';

interface LineItem {
  id: string;
  kind: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  [k: string]: unknown;
}

interface Assignment {
  employee?: { id: string };
  [k: string]: unknown;
}

interface HcpJob {
  id: string;
  customer?: { id: string };
  work_status: string;
  total_amount: number;
  outstanding_balance: number;
  schedule?: { scheduled_start?: string };
  completed_at: string;
  invoice?: { id: string };
  job_type: string;
  tags: string[];
  address?: { city?: string; zip?: string };
  created_at: string;
  updated_at: string;
  line_items?: LineItem[];
  assigned_employees?: Assignment[];
  [k: string]: unknown;
}

export async function syncHcpJobs(since?: Date): Promise<number> {
  const params: Record<string, string> = {};
  if (since) params['updated_at[gte]'] = since.toISOString();

  let count = 0;
  for await (const page of hcpPages<HcpJob>('/jobs', params)) {
    for (const j of page) {
      await sql`
        insert into raw.hcp_jobs (
          hcp_job_id, hcp_customer_id, work_status, total_amount, outstanding_balance,
          scheduled_start, completed_at, hcp_invoice_id, job_type, tags,
          address_city, address_zip, created_at, updated_at, raw_json, synced_at
        ) values (
          ${j.id}, ${j.customer?.id ?? null}, ${j.work_status},
          ${j.total_amount ?? null}, ${j.outstanding_balance ?? null},
          ${j.schedule?.scheduled_start ?? null}, ${j.completed_at ?? null},
          ${j.invoice?.id ?? null}, ${j.job_type ?? null}, ${j.tags ?? []},
          ${j.address?.city ?? null}, ${j.address?.zip ?? null},
          ${j.created_at ?? null}, ${j.updated_at ?? null},
          ${sql.json(j as never)}, now()
        )
        on conflict (hcp_job_id) do update set
          work_status         = excluded.work_status,
          total_amount        = excluded.total_amount,
          outstanding_balance = excluded.outstanding_balance,
          completed_at        = excluded.completed_at,
          hcp_invoice_id      = excluded.hcp_invoice_id,
          tags                = excluded.tags,
          updated_at          = excluded.updated_at,
          raw_json            = excluded.raw_json,
          synced_at           = now()
      `;

      // assignments
      if (j.assigned_employees?.length) {
        for (const a of j.assigned_employees) {
          if (!a.employee?.id) continue;
          await sql`
            insert into raw.hcp_job_assignments (hcp_job_id, hcp_employee_id)
            values (${j.id}, ${a.employee.id})
            on conflict do nothing
          `;
        }
      }

      // line items
      if (j.line_items?.length) {
        for (const li of j.line_items) {
          await sql`
            insert into raw.hcp_line_items (id, hcp_job_id, kind, name, quantity, unit_price, amount, raw_json)
            values (${li.id}, ${j.id}, ${li.kind ?? null}, ${li.name ?? null},
                    ${li.quantity ?? null}, ${li.unit_price ?? null}, ${li.total_amount ?? null},
                    ${sql.json(li as never)})
            on conflict (id) do update set
              kind       = excluded.kind,
              name       = excluded.name,
              quantity   = excluded.quantity,
              unit_price = excluded.unit_price,
              amount     = excluded.amount,
              raw_json   = excluded.raw_json
          `;
        }
      }

      count++;
    }
  }
  logger.info('hcp_jobs synced', { count });
  return count;
}
