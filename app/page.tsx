import { query } from './lib/db';
import { DateRangePicker } from './components/DateRangePicker';
import { DashboardTabs } from './components/DashboardTabs';
import type {
  MrrRow, MonthlyRow, PeriodRow, OppsRow, SourceRow,
  SpendRow, AdRoiRow, CategoryRow, ChannelRow, ChannelRoiRow, ChannelMrrRow,
  ChurnServiceRow, ChurnSubRow, MonthlyChurnRow, ChurnWindowServiceRow, RetentionRow, LtvServiceRow, SaveListRow, ProjectedRevRow, ProjectedDetailRow,
} from './components/DashboardTabs';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

type SearchParams = { range?: string; from?: string; to?: string };

// Resolve the selected preset (or a custom range) into a concrete window plus
// the equivalent previous window, so every KPI can show a "vs previous period"
// delta. Dates are ISO YYYY-MM-DD in UTC, matching the rest of the app.
function resolveRange(sp: SearchParams) {
  const preset = sp.range || 'month';
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  const mk = (Y: number, M: number, D: number) => new Date(Date.UTC(Y, M, D));

  let from: Date, to: Date, prevFrom: Date, prevTo: Date, label: string;
  switch (preset) {
    case 'week': {
      const dow = now.getUTCDay();               // 0 Sun .. 6 Sat
      const monOffset = dow === 0 ? 6 : dow - 1; // week starts Monday
      const start = mk(y, m, d - monOffset);
      from = start; to = now;
      prevFrom = mk(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - 7);
      prevTo = mk(y, m, d - 7);
      label = 'This week';
      break;
    }
    case 'last_month': {
      from = mk(y, m - 1, 1); to = mk(y, m, 0);          // full previous month
      prevFrom = mk(y, m - 2, 1); prevTo = mk(y, m - 1, 0);
      label = 'Last month';
      break;
    }
    case 'ytd': {
      from = mk(y, 0, 1); to = now;
      prevFrom = mk(y - 1, 0, 1); prevTo = mk(y - 1, m, d);
      label = 'Year to date';
      break;
    }
    case 'year': {
      from = mk(y, 0, 1); to = mk(y, 11, 31);
      prevFrom = mk(y - 1, 0, 1); prevTo = mk(y - 1, 11, 31);
      label = 'This year';
      break;
    }
    case 'custom': {
      from = sp.from ? new Date(sp.from + 'T00:00:00Z') : mk(y, m, 1);
      to = sp.to ? new Date(sp.to + 'T00:00:00Z') : now;
      const spanDays = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
      prevTo = mk(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - 1);
      prevFrom = new Date(prevTo.getTime() - spanDays * 86400000);
      label = 'Custom';
      break;
    }
    case 'month':
    default: {
      from = mk(y, m, 1); to = now;                       // month to date
      prevFrom = mk(y, m - 1, 1); prevTo = mk(y, m - 1, d); // last month, same day
      label = 'This month';
      break;
    }
  }
  return {
    preset, label,
    from: ymd(from), to: ymd(to),
    prevFrom: ymd(prevFrom), prevTo: ymd(prevTo),
  };
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const { from, to, prevFrom, prevTo } = range;

  // Trend chart, Finance and Marketing views always read a fixed trailing
  // 12-month window so narrowing the KPI period never starves them.
  const now = new Date();
  const ttmFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString().slice(0, 10);
  const ttmTo   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  const periodSql = `select
      coalesce(sum(revenue) filter (where recurring_flag), 0)::float      as recurring_revenue,
      coalesce(sum(revenue) filter (where not recurring_flag), 0)::float  as onetime_revenue,
      coalesce(sum(revenue), 0)::float                                    as total_revenue,
      coalesce(avg(revenue), 0)::float                                    as avg_job_size,
      count(*)::int                                                       as total_jobs
    from marts.fact_job where job_date between $1 and $2`;

  const [mrr, monthly, period, periodPrev, projectedPeriod, opps, sources, spend, adRoi, categories, channelSummary, channelRoi, channelNewMrr, churnService, churnSub, monthlyChurn, churnWindowService, retention, ltvService, saveList, projectedRev, projectedDetail] = await Promise.all([
    query<MrrRow>(`select month::text, recurring_jobs, recurring_revenue::float from marts.mrr where month between $1 and $2 order by month`, [ttmFrom, ttmTo]),
    query<MonthlyRow>(`select date_trunc('month', job_date)::text as month, count(*) as jobs, sum(revenue)::float as total_revenue from marts.fact_job where job_date between $1 and $2 group by 1 order by 1`, [ttmFrom, ttmTo]),
    query<PeriodRow>(periodSql, [from, to]),
    query<PeriodRow>(periodSql, [prevFrom, prevTo]),
    query<{ projected: number }>(`select coalesce(sum(projected_revenue), 0)::float as projected from marts.projected_revenue_by_month where month between date_trunc('month', $1::date) and $2::date`, [from, to]),
    query<OppsRow>(`select status, count(*) from raw.ghl_opportunities group by status order by count desc`),
    query<SourceRow>(`select coalesce(nullif(trim(source),''), 'Unknown') as source, count(*) as total, sum(case when status='won' then 1 else 0 end) as won, round(100.0 * sum(case when status='won' then 1 else 0 end) / count(*), 1) as close_rate from raw.ghl_opportunities group by 1 having count(*) >= 5 order by close_rate desc`),
    query<SpendRow>(`select month::text, total_spend::float from marts.monthly_spend where month between $1 and $2 order by month`, [ttmFrom, ttmTo]).catch(() => []),
    query<AdRoiRow>(`select month::text, ad_spend::float, revenue::float, roi::float from marts.ad_roi where month between $1 and $2 order by month`, [ttmFrom, ttmTo]).catch(() => []),
    query<CategoryRow>(`select coalesce(category, 'Uncategorized') as category, sum(spend)::float as spend from marts.spend_by_category where month between $1 and $2 group by 1 order by 2 desc limit 10`, [ttmFrom, ttmTo]).catch(() => []),
    query<ChannelRow>(`select channel, leads::int, converted::int, conversion_pct::float, total_revenue::float, avg_ltv::float from marts.channel_summary`).catch(() => []),
    query<ChannelRoiRow>(`select month::text, channel, leads::int, cohort_ltv::float, channel_spend::float, roi::float from marts.channel_roi_by_month where month between $1 and $2 order by month, channel`, [ttmFrom, ttmTo]).catch(() => []),
    query<ChannelMrrRow>(`select month::text, channel, recurring_customers::int, new_mrr::float from marts.channel_new_mrr where month between $1 and $2 order by month, channel`, [ttmFrom, ttmTo]).catch(() => []),
    query<ChurnServiceRow>(`select segment, service_bucket, recurring_customers::int, churned_customers::int, churn_pct::float, churned_mrr::float, active_mrr::float from marts.churn_by_service order by churn_pct desc nulls last`).catch(() => []),
    query<ChurnSubRow>(`select segment, cleaner_name, active_customers::int, base_customers::int, churned_customers::int, churn_pct::float, churned_mrr::float from marts.churn_window_by_subcontractor order by churn_pct desc nulls last`).catch(() => []),
    query<MonthlyChurnRow>(`select segment, month::text, active_start::int, churned::int, churn_pct::float, churned_mrr::float, active_start_mrr::float from marts.monthly_churn_rate order by month`).catch(() => []),
    query<ChurnWindowServiceRow>(`select segment, service_bucket, active_customers::int, base_customers::int, churned_customers::int, churn_pct::float, churned_mrr::float from marts.churn_window_by_service order by churn_pct desc nulls last`).catch(() => []),
    query<RetentionRow>(`select segment, months_since_start::int, customers_observed::int, retention_pct::float, retained_mrr::float from marts.retention_curve order by months_since_start`).catch(() => []),
    query<LtvServiceRow>(`select segment, service_bucket, customers::int, avg_ltv::float, median_ltv::float, avg_visits::float, avg_mrr::float, avg_tenure_months::float, total_ltv::float from marts.ltv_by_service order by customers desc`).catch(() => []),
    query<SaveListRow>(`select customer, phone, segment, service_bucket, cleaner_name, reason, last_completed::text, days_since_last::int, mrr::float from marts.save_list limit 25`).catch(() => []),
    query<ProjectedRevRow>(`select month::text, actual_revenue::float, projected_revenue::float, uninvoiced_fill::float from marts.projected_revenue_by_month where month >= date_trunc('month', now()) - interval '13 months' order by month`).catch(() => []),
    query<ProjectedDetailRow>(`select customer, segment, service_bucket, visits::int, actual_billed::float, expected_invoice::float, uninvoiced_fill::float from marts.projected_revenue_detail where month = date_trunc('month', now())::date order by uninvoiced_fill desc, expected_invoice desc`).catch(() => []),
  ]);

  const projectedPeriodTotal = projectedPeriod[0]?.projected ?? 0;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Connect Cleaning</h1>
          <p style={{ color: '#6b7280', fontSize: 13 }}>updates hourly</p>
        </div>
        <Suspense>
          <DateRangePicker preset={range.preset} from={from} to={to} />
        </Suspense>
      </div>

      <DashboardTabs
        periodLabel={range.label}
        projectedPeriodTotal={projectedPeriodTotal}
        data={{ mrr, monthly, period, periodPrev, opps, sources, spend, adRoi, categories, channelSummary, channelRoi, channelNewMrr, churnService, churnSub, monthlyChurn, churnWindowService, retention, ltvService, saveList, projectedRev, projectedDetail }}
      />
    </div>
  );
}
