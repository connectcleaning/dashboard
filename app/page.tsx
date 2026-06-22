import { query } from './lib/db';
import { DateRangePicker } from './components/DateRangePicker';
import { DashboardTabs } from './components/DashboardTabs';
import type {
  MrrRow, MonthlyRow, SummaryRow, OppsRow, SourceRow,
  SpendRow, AdRoiRow, CategoryRow, ChannelRow, ChannelRoiRow,
} from './components/DashboardTabs';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

type SearchParams = { from?: string; to?: string };

function dateRange(sp: SearchParams) {
  const to   = sp.to   || new Date().toISOString().slice(0, 10);
  const from = sp.from || (() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10);
  })();
  return { from, to };
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { from, to } = dateRange(sp);

  const [mrr, monthly, summary, opps, sources, spend, adRoi, categories, channelSummary, channelRoi] = await Promise.all([
    query<MrrRow>(`select month::text, recurring_jobs, recurring_revenue::float from marts.mrr where month between $1 and $2 order by month`, [from, to]),
    query<MonthlyRow>(`select date_trunc('month', job_date)::text as month, count(*) as jobs, sum(revenue)::float as total_revenue from marts.fact_job where job_date between $1 and $2 group by 1 order by 1`, [from, to]),
    query<SummaryRow>(`select sum(revenue)::float as total_revenue, avg(revenue)::float as avg_job_size, count(*) as total_jobs from marts.fact_job where job_date between $1 and $2`, [from, to]),
    query<OppsRow>(`select status, count(*) from raw.ghl_opportunities group by status order by count desc`),
    query<SourceRow>(`select coalesce(nullif(trim(source),''), 'Unknown') as source, count(*) as total, sum(case when status='won' then 1 else 0 end) as won, round(100.0 * sum(case when status='won' then 1 else 0 end) / count(*), 1) as close_rate from raw.ghl_opportunities group by 1 having count(*) >= 5 order by close_rate desc`),
    query<SpendRow>(`select month::text, total_spend::float from marts.monthly_spend where month between $1 and $2 order by month`, [from, to]).catch(() => []),
    query<AdRoiRow>(`select month::text, ad_spend::float, revenue::float, roi::float from marts.ad_roi where month between $1 and $2 order by month`, [from, to]).catch(() => []),
    query<CategoryRow>(`select coalesce(category, 'Uncategorized') as category, sum(spend)::float as spend from marts.spend_by_category where month between $1 and $2 group by 1 order by 2 desc limit 10`, [from, to]).catch(() => []),
    query<ChannelRow>(`select channel, leads::int, converted::int, conversion_pct::float, total_revenue::float, avg_ltv::float from marts.channel_summary`).catch(() => []),
    query<ChannelRoiRow>(`select month::text, channel, leads::int, cohort_ltv::float, channel_spend::float, roi::float from marts.channel_roi_by_month where month between $1 and $2 order by month, channel`, [from, to]).catch(() => []),
  ]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Connect Cleaning</h1>
          <p style={{ color: '#6b7280', fontSize: 13 }}>updates hourly</p>
        </div>
        <Suspense>
          <DateRangePicker from={from} to={to} />
        </Suspense>
      </div>

      <DashboardTabs data={{ mrr, monthly, summary, opps, sources, spend, adRoi, categories, channelSummary, channelRoi }} />
    </div>
  );
}
