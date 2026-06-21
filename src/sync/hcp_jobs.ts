import { upsert } from '../lib/db.js';
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

  const jobRows: Record<string, unknown>[] = [];
  const assignmentRows: Record<string, unknown>[] = [];
  const lineItemRows: Record<string, unknown>[] = [];

  for await (const page of hcpPages<HcpJob>('/jobs', params)) {
    for (const j of page) {
      jobRows.push({
        hcp_job_id: j.id,
        hcp_customer_id: j.customer?.id ?? null,
        work_status: j.work_status,
        total_amount: j.total_amount ?? null,
        outstanding_balance: j.outstanding_balance ?? null,
        scheduled_start: j.schedule?.scheduled_start ?? null,
        completed_at: j.completed_at ?? null,
        hcp_invoice_id: j.invoice?.id ?? null,
        job_type: j.job_type ?? null,
        tags: j.tags ?? [],
        address_city: j.address?.city ?? null,
        address_zip: j.address?.zip ?? null,
        created_at: j.created_at ?? null,
        updated_at: j.updated_at ?? null,
        raw_json: j,
        synced_at: new Date().toISOString(),
      });

      for (const a of j.assigned_employees ?? []) {
        if (a.employee?.id) {
          assignmentRows.push({ hcp_job_id: j.id, hcp_employee_id: a.employee.id });
        }
      }

      for (const li of j.line_items ?? []) {
        lineItemRows.push({
          id: li.id,
          hcp_job_id: j.id,
          kind: li.kind ?? null,
          name: li.name ?? null,
          quantity: li.quantity ?? null,
          unit_price: li.unit_price ?? null,
          amount: li.total_amount ?? null,
          raw_json: li,
        });
      }
    }
  }

  await upsert('raw', 'hcp_jobs', jobRows, 'hcp_job_id');
  if (assignmentRows.length) await upsert('raw', 'hcp_job_assignments', assignmentRows, 'hcp_job_id,hcp_employee_id');
  if (lineItemRows.length) await upsert('raw', 'hcp_line_items', lineItemRows, 'id');

  logger.info('hcp_jobs synced', { count: jobRows.length });
  return jobRows.length;
}
