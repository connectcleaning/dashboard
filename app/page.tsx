import { query } from './lib/db';
import { RevenueChart } from './components/RevenueChart';
import { DateRangePicker } from './components/DateRangePicker';
import { Suspense } from 'react';

interface MrrRow { month: string; recurring_jobs: number; recurring_revenue: number }
interface MonthlyRow { month: string; jobs: number; total_revenue: number }
interface SummaryRow { total_revenue: number; avg_job_size: number; total_jobs: number }
interface OppsRow { status: string; count: number }
interface SourceRow { source: string; total: number; won: number; close_rate: number }
interface SpendRow { month: string; total_spend: number }
interface AdRoiRow { month: string; ad_spend: number; revenue: number; roi: number | null }
interface CategoryRow { category: string; spend: number }
interface ChannelRow { channel: string; leads: number; converted: number; conversion_pct: number; total_revenue: number; avg_ltv: number }
interface ChannelRoiRow { month: string; channel: string; leads: number; cohort_ltv: number; channel_spend: number | null; roi: number | null }

export const dynamic = 'force-dynamic';

type SearchParams = { from?: string; to?: string };

// Default window: last 12 months
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

  const s = summary[0];
  const currentMonth = monthly[monthly.length - 1];
  const prevMonth = monthly[monthly.length - 2];
  const revenueChange = currentMonth && prevMonth
    ? ((currentMonth.total_revenue - prevMonth.total_revenue) / prevMonth.total_revenue * 100).toFixed(1)
    : null;

  const currentMrr = mrr[mrr.length - 1];
  const prevMrr = mrr[mrr.length - 2];
  const mrrChange = currentMrr && prevMrr
    ? ((currentMrr.recurring_revenue - prevMrr.recurring_revenue) / prevMrr.recurring_revenue * 100).toFixed(1)
    : null;

  const wonOpps = opps.find(o => o.status === 'won')?.count ?? 0;
  const totalOpps = opps.reduce((a, o) => a + Number(o.count), 0);
  const closeRate = totalOpps ? ((Number(wonOpps) / totalOpps) * 100).toFixed(1) : '—';

  const totalSpend = spend.reduce((a, s) => a + Number(s.total_spend), 0);
  const totalAdSpend = adRoi.reduce((a, r) => a + Number(r.ad_spend), 0);
  const totalAdRevenue = adRoi.reduce((a, r) => a + Number(r.revenue), 0);
  const blendedRoi = totalAdSpend > 0 ? (totalAdRevenue / totalAdSpend) : null;
  const hasSpend = spend.length > 0;
  const hasChannels = channelSummary.length > 0;

  // Pivot channel ROI rows for table display
  const channelRoiMonths = Array.from(new Set(channelRoi.map(r => r.month))).sort();
  const roiChannels = ['Google LSA', 'Meta Ads', 'Google Ads'];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Connect Cleaning</h1>
          <p style={{ color: '#6b7280' }}>updates hourly</p>
        </div>
        <Suspense>
          <DateRangePicker from={from} to={to} />
        </Suspense>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 40 }}>
        <Card label="This Month Revenue" value={`$${currentMonth ? fmt(currentMonth.total_revenue) : '—'}`} sub={revenueChange ? `${revenueChange}% vs last month` : ''} />
        <Card label="MRR" value={`$${currentMrr ? fmt(currentMrr.recurring_revenue) : '—'}`} sub={mrrChange ? `${mrrChange}% vs last month` : ''} />
        <Card label="Avg Job Size" value={`$${(s?.avg_job_size ?? 0).toFixed(0)}`} />
        <Card label="Close Rate" value={`${closeRate}%`} sub={`${wonOpps} won of ${totalOpps}`} />
      </div>

      {/* Total monthly revenue chart */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Total Monthly Revenue</h2>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Period total: <strong>${fmt(s?.total_revenue ?? 0)}</strong></p>
        <RevenueChart data={monthly.map(r => ({ month: r.month.slice(0, 7), revenue: r.total_revenue }))} color="#10b981" />
      </div>

      {/* MRR chart */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Monthly Recurring Revenue</h2>
        <RevenueChart data={mrr.map(r => ({ month: r.month.slice(0, 7), revenue: r.recurring_revenue }))} color="#6366f1" />
      </div>

      {/* Spend & ROI (QuickBooks) */}
      {hasSpend && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24, marginTop: 16 }}>
            <Card label="Total Spend" value={`$${fmt(totalSpend)}`} />
            <Card label="Ad Spend" value={`$${fmt(totalAdSpend)}`} />
            <Card label="Blended Ad ROI" value={blendedRoi != null ? `${blendedRoi.toFixed(1)}x` : '—'} sub={blendedRoi != null ? `$${fmt(totalAdRevenue)} rev / $${fmt(totalAdSpend)} ad spend` : ''} />
          </div>

          <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Total Monthly Spend</h2>
            <RevenueChart data={spend.map(s => ({ month: s.month.slice(0, 7), revenue: s.total_spend }))} color="#ef4444" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Top Spend Categories</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Category</th>
                    <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map(c => (
                    <tr key={c.category} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 0' }}>{c.category}</td>
                      <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600 }}>${fmt(c.spend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Blended Ad ROI by Month</h2>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Total revenue ÷ total ad spend per month</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Month</th>
                    <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Ad Spend</th>
                    <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Revenue</th>
                    <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {adRoi.map(r => (
                    <tr key={r.month} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 0' }}>{r.month.slice(0, 7)}</td>
                      <td style={{ padding: '10px 0', textAlign: 'right' }}>${fmt(r.ad_spend)}</td>
                      <td style={{ padding: '10px 0', textAlign: 'right' }}>${fmt(r.revenue)}</td>
                      <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: r.roi != null && r.roi >= 3 ? '#10b981' : '#111' }}>{r.roi != null ? `${r.roi.toFixed(1)}x` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Per-channel attribution */}
      {hasChannels && (
        <>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '32px 0 16px' }}>Channel Attribution</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, marginTop: -12 }}>
            Lifetime revenue attributed to each lead&apos;s acquisition channel (all-time cohort view, not filtered by date range above)
          </p>

          {/* Channel summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
            {channelSummary.filter(c => ['Google LSA', 'Meta Ads', 'Google Ads'].includes(c.channel)).map(c => (
              <div key={c.channel} style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.channel}</p>
                <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>${fmt(c.total_revenue)}</p>
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                  {c.leads} leads · {c.converted} converted ({c.conversion_pct}%) · avg LTV ${fmt(c.avg_ltv)}
                </p>
              </div>
            ))}
          </div>

          {/* Channel LTV all-time summary table */}
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>All Channels — Lifetime Value Summary</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>First opportunity source → total HCP revenue (customers matched across both systems)</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Channel</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Leads</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Converted</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Conv %</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Total LTV</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Avg LTV</th>
                </tr>
              </thead>
              <tbody>
                {channelSummary.map(c => (
                  <tr key={c.channel} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 0' }}>{c.channel}</td>
                    <td style={{ padding: '10px 0', textAlign: 'right' }}>{c.leads}</td>
                    <td style={{ padding: '10px 0', textAlign: 'right' }}>{c.converted}</td>
                    <td style={{ padding: '10px 0', textAlign: 'right' }}>{c.conversion_pct}%</td>
                    <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600 }}>${fmt(c.total_revenue)}</td>
                    <td style={{ padding: '10px 0', textAlign: 'right' }}>{c.avg_ltv ? `$${fmt(c.avg_ltv)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-channel ROI by month (cohort month × channel spend) */}
          {channelRoi.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Per-Channel ROI by Month Acquired</h2>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                Cohort LTV of leads acquired in that month ÷ channel ad spend that month. ROI builds over time as customers return.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Month</th>
                      {roiChannels.map(ch => (
                        <th key={ch} colSpan={3} style={{ textAlign: 'center', padding: '8px 8px', color: '#6b7280', fontWeight: 500, borderLeft: '1px solid #f3f4f6' }}>{ch}</th>
                      ))}
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '4px 0' }} />
                      {roiChannels.map(ch => (
                        <>
                          <th key={`${ch}-spend`} style={{ textAlign: 'right', padding: '4px 8px', color: '#9ca3af', fontWeight: 400, fontSize: 12, borderLeft: '1px solid #f3f4f6' }}>Spend</th>
                          <th key={`${ch}-ltv`}   style={{ textAlign: 'right', padding: '4px 8px', color: '#9ca3af', fontWeight: 400, fontSize: 12 }}>LTV</th>
                          <th key={`${ch}-roi`}   style={{ textAlign: 'right', padding: '4px 8px', color: '#9ca3af', fontWeight: 400, fontSize: 12 }}>ROI</th>
                        </>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {channelRoiMonths.map(month => {
                      const byChannel = Object.fromEntries(
                        channelRoi.filter(r => r.month === month).map(r => [r.channel, r])
                      );
                      return (
                        <tr key={month} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 0' }}>{month.slice(0, 7)}</td>
                          {roiChannels.map(ch => {
                            const r = byChannel[ch];
                            return (
                              <>
                                <td key={`${ch}-spend`} style={{ padding: '10px 8px', textAlign: 'right', borderLeft: '1px solid #f3f4f6' }}>{r?.channel_spend != null ? `$${fmt(r.channel_spend)}` : '—'}</td>
                                <td key={`${ch}-ltv`}   style={{ padding: '10px 8px', textAlign: 'right' }}>{r ? `$${fmt(r.cohort_ltv)}` : '—'}</td>
                                <td key={`${ch}-roi`}   style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600, color: r?.roi != null && r.roi >= 3 ? '#10b981' : '#111' }}>{r?.roi != null ? `${r.roi.toFixed(1)}x` : '—'}</td>
                              </>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Pipeline + Close by source side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Pipeline by Status</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Status</th>
                <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {opps.map(o => (
                <tr key={o.status} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 0', textTransform: 'capitalize' }}>{o.status}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600 }}>{o.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Close Rate by Lead Source</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Source</th>
                <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Leads</th>
                <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Won</th>
                <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Close %</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.source} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 0' }}>{s.source}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right' }}>{s.total}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right' }}>{s.won}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: Number(s.close_rate) >= 20 ? '#10b981' : '#111' }}>{s.close_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
}
