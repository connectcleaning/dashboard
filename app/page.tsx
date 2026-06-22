import { query } from './lib/db';
import { RevenueChart } from './components/RevenueChart';

interface MrrRow { month: string; recurring_jobs: number; recurring_revenue: number }
interface MonthlyRow { month: string; jobs: number; total_revenue: number }
interface SummaryRow { total_revenue: number; avg_job_size: number; total_jobs: number }
interface OppsRow { status: string; count: number }
interface SourceRow { source: string; total: number; won: number; close_rate: number }

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const [mrr, monthly, summary, opps, sources] = await Promise.all([
    query<MrrRow>(`select month::text, recurring_jobs, recurring_revenue::float from marts.mrr where month >= now() - interval '12 months' order by month`),
    query<MonthlyRow>(`select date_trunc('month', job_date)::text as month, count(*) as jobs, sum(revenue)::float as total_revenue from marts.fact_job where job_date >= now() - interval '12 months' group by 1 order by 1`),
    query<SummaryRow>(`select sum(revenue)::float as total_revenue, avg(revenue)::float as avg_job_size, count(*) as total_jobs from marts.fact_job where job_date >= now() - interval '12 months'`),
    query<OppsRow>(`select status, count(*) from raw.ghl_opportunities group by status order by count desc`),
    query<SourceRow>(`select coalesce(nullif(trim(source),''), 'Unknown') as source, count(*) as total, sum(case when status='won' then 1 else 0 end) as won, round(100.0 * sum(case when status='won' then 1 else 0 end) / count(*), 1) as close_rate from raw.ghl_opportunities group by 1 having count(*) >= 5 order by close_rate desc`),
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

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Connect Cleaning</h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>Last 12 months · updates hourly</p>

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
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>12-month total: <strong>${fmt(s?.total_revenue ?? 0)}</strong></p>
        <RevenueChart data={monthly.map(r => ({ month: r.month.slice(0, 7), revenue: r.total_revenue }))} color="#10b981" />
      </div>

      {/* MRR chart */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Monthly Recurring Revenue</h2>
        <RevenueChart data={mrr.map(r => ({ month: r.month.slice(0, 7), revenue: r.recurring_revenue }))} color="#6366f1" />
      </div>

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
