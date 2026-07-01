import { query } from './lib/db';
import { DateRangePicker } from './components/DateRangePicker';
import { DashboardTabs } from './components/DashboardTabs';
import type {
  MrrRow, MonthlyRow, SummaryRow, OppsRow, SourceRow,
  SpendRow, AdRoiRow, CategoryRow, ChannelRow, ChannelRoiRow, ChannelMrrRow,
  ChurnServiceRow, ChurnSubRow, MonthlyChurnRow, ChurnWindowServiceRow, RetentionRow, LtvServiceRow,
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

  const [mrr, monthly, summary, opps, sources, spend, adRoi, categories, channelSummary, channelRoi, channelNewMrr, churnService, churnSub, monthlyChurn, churnWindowService, retention, ltvService] = await Promise.all([
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
    query<ChannelMrrRow>(`select month::text, channel, recurring_customers::int, new_mrr::float from marts.channel_new_mrr where month between $1 and $2 order by month, channel`, [from, to]).catch(() => []),
    query<ChurnServiceRow>(`select service_bucket, recurring_customers::int, churned_customers::int, churn_pct::float, churned_mrr::float, active_mrr::float from marts.churn_by_service order by churn_pct desc nulls last`).catch(() => []),
    query<ChurnSubRow>(`select cleaner_name, active_customers::int, base_customers::int, churned_customers::int, churn_pct::float, churned_mrr::float from marts.churn_window_by_subcontractor order by churn_pct desc nulls last`).catch(() => []),
    query<MonthlyChurnRow>(`select month::text, active_start::int, churned::int, churn_pct::float, churned_mrr::float from marts.monthly_churn_rate order by month`).catch(() => []),
    query<ChurnWindowServiceRow>(`select service_bucket, active_customers::int, base_customers::int, churned_customers::int, churn_pct::float, churned_mrr::float from marts.churn_window_by_service order by churn_pct desc nulls last`).catch(() => []),
    query<RetentionRow>(`select months_since_start::int, customers_observed::int, retention_pct::float, retained_mrr::float from marts.retention_curve order by months_since_start`).catch(() => []),
    query<LtvServiceRow>(`select service_bucket, customers::int, avg_ltv::float, median_ltv::float, avg_visits::float, avg_mrr::float, avg_tenure_months::float, total_ltv::float from marts.ltv_by_service order by customers desc`).catch(() => []),
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

      <DashboardTabs data={{ mrr, monthly, summary, opps, sources, spend, adRoi, categories, channelSummary, channelRoi, channelNewMrr, churnService, churnSub, monthlyChurn, churnWindowService, retention, ltvService }} />
    </div>
  );
}
