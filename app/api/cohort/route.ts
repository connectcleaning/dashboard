import { NextRequest, NextResponse } from 'next/server';
import { query } from '../../lib/db';

export const dynamic = 'force-dynamic';

interface CohortRow {
  display_name: string | null;
  channel: string;
  ltv: number;
  job_count: number;
  first_job_date: string | null;
}

// Won customers acquired in a given month, optionally filtered to one channel.
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';   // "YYYY-MM"
  const channel = req.nextUrl.searchParams.get('channel') ?? ''; // optional

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
  }
  const allowedChannels = ['Google LSA', 'Meta Ads', 'Google Ads'];
  const channelFilter = channel && allowedChannels.includes(channel)
    ? `and ll.channel = '${channel}'`
    : `and ll.channel in ('Google LSA', 'Meta Ads', 'Google Ads')`;

  try {
    const rows = await query<CohortRow>(`
      select
        c.display_name,
        ll.channel,
        ll.ltv::float        as ltv,
        ll.job_count::int    as job_count,
        ll.first_job_date::text as first_job_date
      from marts.fact_lead_ltv ll
      left join core.customer c on c.customer_id = ll.customer_id
      where to_char(ll.acquired_month, 'YYYY-MM') = '${month}'
        and ll.job_count > 0
        ${channelFilter}
      order by ll.ltv desc
    `);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
