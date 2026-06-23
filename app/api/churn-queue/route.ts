import { NextResponse } from 'next/server';
import { query } from '../../lib/db';

export const dynamic = 'force-dynamic';

export interface ChurnQueueRow {
  hcp_customer_id: string;
  display_name: string | null;
  service_bucket: string;
  cleaner_name: string;
  last_completed: string | null;
  next_scheduled: string | null;
  period_days: number;
  mrr: number;
  reason: string | null;
  status: string;
}

export async function GET() {
  try {
    const rows = await query<ChurnQueueRow>(`
      select
        cc.hcp_customer_id,
        c.display_name,
        cc.service_bucket,
        cc.cleaner_name,
        cc.last_completed::text,
        cc.next_scheduled::text,
        cc.period_days::float,
        cc.mrr::float,
        cc.reason,
        cc.status
      from marts.customer_churn cc
      left join core.customer c on c.customer_id = cc.customer_id
      where cc.status in ('churned', 'seasonal')
      order by cc.last_completed asc nulls first
    `);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
