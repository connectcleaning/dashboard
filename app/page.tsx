import { query } from './lib/db';
import { RevenueChart } from './components/RevenueChart';

interface MrrRow { month: string; recurring_jobs: number; recurring_revenue: number }
interface SummaryRow { total_revenue: number; avg_job_size: number; total_jobs: number }
interface OppsRow { status: string; count: number }

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const [mrr, summary, opps] = await Promise.all([
    query<MrrRow>(`select month::text, recurring_jobs, recurring_revenue::float from marts.mrr where month >= now() - interval '12 months' order by month`),
    query<SummaryRow>(`select sum(revenue)::float as total_revenue, avg(revenue)::float as avg_job_size, count(*) as total_jobs from marts.fact_job where job_date >= now() - interval '12 months'`),
    query<OppsRow>(`select status, count(*) from raw.ghl_opportunities group by status order by count desc`),
  ]);

  const s = summary[0];
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
      <p style={{ color: '#6b7280', marginBottom: 32 }}>Last 12 months · updates every 15 min</p>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 40 }}>
        <Card label="MRR" value={`$${currentMrr ? fmt(currentMrr.recurring_revenue) : '—'}`} sub={mrrChange ? `${mrrChange}% vs last month` : ''} />
        <Card label="Total Revenue (12mo)" value={`$${fmt(s?.total_revenue ?? 0)}`} />
        <Card label="Avg Job Size" value={`$${(s?.avg_job_size ?? 0).toFixed(0)}`} />
        <Card label="Close Rate" value={`${closeRate}%`} sub={`${wonOpps} won of ${totalOpps}`} />
      </div>

      {/* Revenue chart */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Monthly Recurring Revenue</h2>
        <RevenueChart data={mrr.map(r => ({ month: r.month.slice(0, 7), revenue: r.recurring_revenue }))} />
      </div>

      {/* Pipeline */}
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
