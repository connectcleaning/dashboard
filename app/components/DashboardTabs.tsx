'use client';

import { useState } from 'react';
import { RevenueChart } from './RevenueChart';
import { RevenueMrrChart } from './RevenueMrrChart';

interface CohortRow { display_name: string | null; channel: string; ltv: number; job_count: number; first_job_date: string | null; mrr: number }

// ── shared types ─────────────────────────────────────────────────────────────
export interface MrrRow       { month: string; recurring_jobs: number; recurring_revenue: number }
export interface MonthlyRow   { month: string; jobs: number; total_revenue: number }
export interface SummaryRow   { total_revenue: number; avg_job_size: number; total_jobs: number }
export interface OppsRow      { status: string; count: number }
export interface SourceRow    { source: string; total: number; won: number; close_rate: number }
export interface SpendRow     { month: string; total_spend: number }
export interface AdRoiRow     { month: string; ad_spend: number; revenue: number; roi: number | null }
export interface CategoryRow  { category: string; spend: number }
export interface ChannelRow   { channel: string; leads: number; converted: number; conversion_pct: number; total_revenue: number; avg_ltv: number }
export interface ChannelRoiRow { month: string; channel: string; leads: number; cohort_ltv: number; channel_spend: number | null; roi: number | null }
export interface ChannelMrrRow { month: string; channel: string; recurring_customers: number; new_mrr: number }
export interface ChurnServiceRow { service_bucket: string; recurring_customers: number; churned_customers: number; churn_pct: number | null; churned_mrr: number; active_mrr: number }
export interface ChurnSubRow    { cleaner_name: string; recurring_customers: number; churned_customers: number; churn_pct: number | null; churned_mrr: number; active_mrr: number }

export interface DashboardData {
  mrr: MrrRow[]; monthly: MonthlyRow[]; summary: SummaryRow[];
  opps: OppsRow[]; sources: SourceRow[];
  spend: SpendRow[]; adRoi: AdRoiRow[]; categories: CategoryRow[];
  channelSummary: ChannelRow[]; channelRoi: ChannelRoiRow[]; channelNewMrr: ChannelMrrRow[];
  churnService: ChurnServiceRow[]; churnSub: ChurnSubRow[];
}

// ── helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
}
function fmtMonth(m: string) {
  const [y, mo] = m.slice(0, 7).split('-');
  const name = ['January','February','March','April','May','June','July','August','September','October','November','December'][Number(mo) - 1];
  return name ? `${name} ${y}` : m;
}
function fmtMonthShort(m: string) {
  const [y, mo] = m.slice(0, 7).split('-');
  const name = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(mo) - 1];
  return name ? `${name} ${y}` : m;
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

const TABS = ['Operations', 'Finance', 'Marketing & Sales'] as const;
type Tab = typeof TABS[number];

// ── main component ────────────────────────────────────────────────────────────
export function DashboardTabs({ data }: { data: DashboardData }) {
  const [tab, setTab] = useState<Tab>('Operations');
  const [openCell, setOpenCell] = useState<string | null>(null);       // "YYYY-MM|Channel"
  const [cohort, setCohort] = useState<Record<string, CohortRow[]>>({});
  const [loadingCell, setLoadingCell] = useState<string | null>(null);
  const { mrr, monthly, summary, opps, sources, spend, adRoi, categories, channelSummary, channelRoi, channelNewMrr, churnService, churnSub } = data;
  const newMrrLookup = Object.fromEntries(channelNewMrr.map(r => [`${r.month.slice(0, 7)}|${r.channel}`, r]));

  async function toggleCell(month: string, channel: string) {
    const key = `${month.slice(0, 7)}|${channel}`;
    if (openCell === key) { setOpenCell(null); return; }
    setOpenCell(key);
    if (!cohort[key]) {
      setLoadingCell(key);
      try {
        const res = await fetch(`/api/cohort?month=${month.slice(0, 7)}&channel=${encodeURIComponent(channel)}`);
        const json = await res.json();
        setCohort(prev => ({ ...prev, [key]: json.rows ?? [] }));
      } catch {
        setCohort(prev => ({ ...prev, [key]: [] }));
      } finally {
        setLoadingCell(null);
      }
    }
  }

  const s = summary[0];
  const currentMonth = monthly[monthly.length - 1];
  const prevMonth    = monthly[monthly.length - 2];
  const revenueChange = currentMonth && prevMonth
    ? ((currentMonth.total_revenue - prevMonth.total_revenue) / prevMonth.total_revenue * 100).toFixed(1)
    : null;
  const currentMrr = mrr[mrr.length - 1];
  const prevMrr    = mrr[mrr.length - 2];
  const mrrChange  = currentMrr && prevMrr
    ? ((currentMrr.recurring_revenue - prevMrr.recurring_revenue) / prevMrr.recurring_revenue * 100).toFixed(1)
    : null;
  const mrrByMonth = Object.fromEntries(mrr.map(r => [r.month.slice(0, 7), Number(r.recurring_revenue)]));
  const wonOpps   = opps.find(o => o.status === 'won')?.count ?? 0;
  const totalOpps = opps.reduce((a, o) => a + Number(o.count), 0);
  const closeRate = totalOpps ? ((Number(wonOpps) / totalOpps) * 100).toFixed(1) : '—';

  const totalSpend   = spend.reduce((a, s) => a + Number(s.total_spend), 0);
  const totalAdSpend = adRoi.reduce((a, r) => a + Number(r.ad_spend), 0);
  const totalAdRev   = adRoi.reduce((a, r) => a + Number(r.revenue), 0);
  const blendedRoi   = totalAdSpend > 0 ? totalAdRev / totalAdSpend : null;
  const hasSpend     = spend.length > 0;
  const hasChannels  = channelSummary.length > 0;

  const hasChurn = churnService.length > 0 || churnSub.length > 0;
  const churnTotals = churnService.reduce(
    (a, r) => ({
      customers: a.customers + Number(r.recurring_customers),
      churned: a.churned + Number(r.churned_customers),
      churnedMrr: a.churnedMrr + Number(r.churned_mrr),
      activeMrr: a.activeMrr + Number(r.active_mrr),
    }),
    { customers: 0, churned: 0, churnedMrr: 0, activeMrr: 0 },
  );
  const overallChurnPct = churnTotals.customers > 0 ? (churnTotals.churned / churnTotals.customers) * 100 : null;

  const roiChannels = ['Google LSA', 'Meta Ads', 'Google Ads'];
  const channelRoiMonths = Array.from(new Set(channelRoi.map(r => r.month))).sort();

  const ttmCutoff = (() => { const d = new Date(); d.setMonth(d.getMonth() - 11); return d.toISOString().slice(0, 7); })();
  const inTtm = (m: string) => m.slice(0, 7) >= ttmCutoff;
  const ttmAdRoi = adRoi.filter(r => inTtm(r.month)).reduce(
    (a, r) => ({ spend: a.spend + Number(r.ad_spend), revenue: a.revenue + Number(r.revenue) }),
    { spend: 0, revenue: 0 },
  );
  const ttmByChannel = Object.fromEntries(roiChannels.map(ch => {
    const rows = channelRoi.filter(r => r.channel === ch && inTtm(r.month));
    const spend = rows.reduce((a, r) => a + Number(r.channel_spend ?? 0), 0);
    const ltv   = rows.reduce((a, r) => a + Number(r.cohort_ltv), 0);
    const newMrr = channelNewMrr.filter(r => r.channel === ch && inTtm(r.month)).reduce((a, r) => a + Number(r.new_mrr), 0);
    return [ch, { spend, ltv, roi: spend > 0 ? ltv / spend : null, newMrr }];
  })) as Record<string, { spend: number; ltv: number; roi: number | null; newMrr: number }>;

  return (
    <>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 32, borderBottom: '1px solid #e5e7eb', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 20px',
              fontWeight: tab === t ? 600 : 400,
              fontSize: 14,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: tab === t ? '#111' : '#6b7280',
              borderBottom: tab === t ? '2px solid #111' : '2px solid transparent',
              marginBottom: -1,
              borderRadius: 0,
              transition: 'color 0.15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── OPERATIONS ── */}
      {tab === 'Operations' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 40 }}>
            <Card label="This Month Revenue" value={`$${currentMonth ? fmt(currentMonth.total_revenue) : '—'}`} sub={revenueChange ? `${revenueChange}% vs last month` : ''} />
            <Card label="MRR" value={`$${currentMrr ? fmt(currentMrr.recurring_revenue) : '—'}`} sub={mrrChange ? `${mrrChange}% vs last month` : ''} />
            <Card label="Avg Job Size" value={`$${(s?.avg_job_size ?? 0).toFixed(0)}`} />
            <Card label="Total Jobs" value={(s?.total_jobs ?? 0).toString()} />
          </div>

          <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Total Monthly Revenue</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Period total: <strong>${fmt(s?.total_revenue ?? 0)}</strong> · MRR shown as the inner segment of each bar</p>
            <RevenueMrrChart data={monthly.map(r => ({
              month: fmtMonthShort(r.month),
              revenue: r.total_revenue,
              mrr: mrrByMonth[r.month.slice(0, 7)] ?? 0,
            }))} />
          </div>

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

          {/* ── CHURN ── */}
          {hasChurn && (
            <div style={{ marginTop: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                <Card label="Recurring Customers" value={churnTotals.customers.toString()} />
                <Card label="Churned" value={churnTotals.churned.toString()} sub={overallChurnPct != null ? `${overallChurnPct.toFixed(1)}% churn rate` : ''} />
                <Card label="Active MRR" value={`$${fmt(churnTotals.activeMrr)}`} />
                <Card label="Lost MRR" value={`$${fmt(churnTotals.churnedMrr)}`} sub="from churned schedules" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* By service type */}
                <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Churn by Service Cadence</h2>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Recurring frequency · churned = schedule past its end date</p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Service</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Cust</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Churned</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Churn %</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Lost MRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {churnService.map(r => (
                        <tr key={r.service_bucket} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 0' }}>{r.service_bucket}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.recurring_customers}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.churned_customers}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: Number(r.churn_pct) >= 25 ? '#ef4444' : '#111' }}>{r.churn_pct != null ? `${r.churn_pct}%` : '—'}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.churned_mrr > 0 ? `$${fmt(r.churned_mrr)}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* By subcontractor */}
                <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Churn by Subcontractor</h2>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Attributed to the cleaner on the last completed visit</p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Cleaner</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Cust</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Churned</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Churn %</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Lost MRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {churnSub.map(r => (
                        <tr key={r.cleaner_name} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 0' }}>{r.cleaner_name}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.recurring_customers}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.churned_customers}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: Number(r.churn_pct) >= 25 ? '#ef4444' : '#111' }}>{r.churn_pct != null ? `${r.churn_pct}%` : '—'}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.churned_mrr > 0 ? `$${fmt(r.churned_mrr)}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── FINANCE ── */}
      {tab === 'Finance' && (
        <>
          {hasSpend ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
                <Card label="Total Spend" value={`$${fmt(totalSpend)}`} />
                <Card label="Ad Spend" value={`$${fmt(totalAdSpend)}`} />
                <Card label="Blended Ad ROI" value={blendedRoi != null ? `${blendedRoi.toFixed(1)}x` : '—'} sub={blendedRoi != null ? `$${fmt(totalAdRev)} rev / $${fmt(totalAdSpend)} ad spend` : ''} />
              </div>

              <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Total Monthly Spend</h2>
                <RevenueChart data={spend.map(s => ({ month: fmtMonthShort(s.month), revenue: s.total_spend }))} color="#ef4444" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
                          <td style={{ padding: '10px 0' }}>{fmtMonth(r.month)}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>${fmt(r.ad_spend)}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>${fmt(r.revenue)}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: r.roi != null && r.roi >= 3 ? '#10b981' : '#111' }}>{r.roi != null ? `${r.roi.toFixed(1)}x` : '—'}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                        <td style={{ padding: '10px 0', fontWeight: 700 }}>Trailing 12 mo</td>
                        <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 700 }}>${fmt(ttmAdRoi.spend)}</td>
                        <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 700 }}>${fmt(ttmAdRoi.revenue)}</td>
                        <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 700, color: ttmAdRoi.spend > 0 && ttmAdRoi.revenue / ttmAdRoi.spend >= 3 ? '#10b981' : '#111' }}>{ttmAdRoi.spend > 0 ? `${(ttmAdRoi.revenue / ttmAdRoi.spend).toFixed(1)}x` : '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <p style={{ color: '#6b7280' }}>QuickBooks data not yet synced.</p>
          )}
        </>
      )}

      {/* ── MARKETING & SALES ── */}
      {tab === 'Marketing & Sales' && (
        <>
          {/* Channel summary cards */}
          {hasChannels && (
            <>
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                {/* All-channels LTV table */}
                <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>All Channels — Lifetime Value</h2>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>First opportunity source → total HCP revenue</p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Channel</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Leads</th>
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
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{c.conversion_pct}%</td>
                          <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600 }}>${fmt(c.total_revenue)}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{c.avg_ltv ? `$${fmt(c.avg_ltv)}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Close rate by source */}
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
            </>
          )}

          {/* Per-channel ROI by month */}
          {channelRoi.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Per-Channel ROI by Month Acquired</h2>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                Cohort LTV of leads acquired in that month ÷ channel ad spend that month. ROI builds over time as customers return. <strong>New MRR</strong> is the recurring monthly revenue booked from that cohort (from HCP recurring schedules). Click any ROI cell to see that channel&apos;s won customers.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Month</th>
                      {roiChannels.map(ch => (
                        <th key={ch} colSpan={4} style={{ textAlign: 'center', padding: '8px 8px', color: '#6b7280', fontWeight: 500, borderLeft: '1px solid #f3f4f6' }}>{ch}</th>
                      ))}
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '4px 0' }} />
                      {roiChannels.map(ch => (
                        <>
                          <th key={`${ch}-spend`} style={{ textAlign: 'right', padding: '4px 8px', color: '#9ca3af', fontWeight: 400, fontSize: 12, borderLeft: '1px solid #f3f4f6' }}>Spend</th>
                          <th key={`${ch}-ltv`}   style={{ textAlign: 'right', padding: '4px 8px', color: '#9ca3af', fontWeight: 400, fontSize: 12 }}>LTV</th>
                          <th key={`${ch}-mrr`}   style={{ textAlign: 'right', padding: '4px 8px', color: '#9ca3af', fontWeight: 400, fontSize: 12 }}>New MRR</th>
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
                      const ym = month.slice(0, 7);
                      const openHere = openCell?.startsWith(`${ym}|`) ? openCell : null;
                      const openChannel = openHere ? openHere.split('|')[1] : null;
                      const rows = openHere ? cohort[openHere] : undefined;
                      return (
                        <>
                          <tr key={month} style={{ borderBottom: '1px solid #f3f4f6', background: openHere ? '#f9fafb' : undefined }}>
                            <td style={{ padding: '10px 0' }}>{fmtMonth(month)}</td>
                            {roiChannels.map(ch => {
                              const r = byChannel[ch];
                              const cellKey = `${ym}|${ch}`;
                              const isOpen = openCell === cellKey;
                              const clickable = !!r;
                              return (
                                <>
                                  <td key={`${ch}-spend`} style={{ padding: '10px 8px', textAlign: 'right', borderLeft: '1px solid #f3f4f6' }}>{r?.channel_spend != null ? `$${fmt(r.channel_spend)}` : '—'}</td>
                                  <td key={`${ch}-ltv`}   style={{ padding: '10px 8px', textAlign: 'right' }}>{r ? `$${fmt(r.cohort_ltv)}` : '—'}</td>
                                  <td key={`${ch}-mrr`}   style={{ padding: '10px 8px', textAlign: 'right', color: '#6366f1' }}>{(() => { const nm = newMrrLookup[cellKey]; return nm && nm.new_mrr > 0 ? `$${fmt(nm.new_mrr)}` : '—'; })()}</td>
                                  <td
                                    key={`${ch}-roi`}
                                    onClick={clickable ? () => toggleCell(month, ch) : undefined}
                                    title={clickable ? 'Click to see won customers' : undefined}
                                    style={{
                                      padding: '10px 8px', textAlign: 'right', fontWeight: 600,
                                      color: r?.roi != null && r.roi >= 3 ? '#10b981' : '#111',
                                      cursor: clickable ? 'pointer' : undefined,
                                      textDecoration: clickable ? 'underline dotted' : undefined,
                                      background: isOpen ? '#eef2ff' : undefined,
                                    }}
                                  >
                                    {r?.roi != null ? `${r.roi.toFixed(1)}x` : (r ? '0.0x' : '—')}
                                  </td>
                                </>
                              );
                            })}
                          </tr>
                          {openHere && (
                            <tr key={`${month}-detail`}>
                              <td colSpan={1 + roiChannels.length * 4} style={{ padding: 0, background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                                <div style={{ padding: '12px 16px' }}>
                                  <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px', fontWeight: 600 }}>
                                    {openChannel} — won customers acquired {fmtMonth(month)}
                                    {rows && rows.length > 0 && (() => {
                                      const totalMrr = rows.reduce((a, cu) => a + Number(cu.mrr), 0);
                                      return totalMrr > 0 ? <span style={{ color: '#6366f1' }}>{`  ·  $${fmt(totalMrr)}/mo new MRR`}</span> : null;
                                    })()}
                                  </p>
                                  {loadingCell === openHere ? (
                                    <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>Loading…</p>
                                  ) : !rows || rows.length === 0 ? (
                                    <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>No won customers in this cohort.</p>
                                  ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                      <thead>
                                        <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#9ca3af' }}>
                                          <th style={{ textAlign: 'left', padding: '4px 0', fontWeight: 500 }}>Customer</th>
                                          <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 500 }}>Jobs</th>
                                          <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 500 }}>LTV</th>
                                          <th style={{ textAlign: 'right', padding: '4px 0', fontWeight: 500 }}>MRR</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {rows.map((cu, i) => (
                                          <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                            <td style={{ padding: '6px 0' }}>{cu.display_name ?? '(unnamed)'}</td>
                                            <td style={{ padding: '6px 0', textAlign: 'right' }}>{cu.job_count}</td>
                                            <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600 }}>${fmt(cu.ltv)}</td>
                                            <td style={{ padding: '6px 0', textAlign: 'right', color: '#6366f1' }}>{cu.mrr > 0 ? `$${fmt(cu.mrr)}` : '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                    <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                      <td style={{ padding: '10px 0', fontWeight: 700 }}>Trailing 12 mo</td>
                      {roiChannels.map(ch => {
                        const t = ttmByChannel[ch];
                        return (
                          <>
                            <td key={`${ch}-tspend`} style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, borderLeft: '1px solid #f3f4f6' }}>{t.spend > 0 ? `$${fmt(t.spend)}` : '—'}</td>
                            <td key={`${ch}-tltv`}   style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700 }}>{t.ltv > 0 ? `$${fmt(t.ltv)}` : '—'}</td>
                            <td key={`${ch}-tmrr`}   style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#6366f1' }}>{t.newMrr > 0 ? `$${fmt(t.newMrr)}` : '—'}</td>
                            <td key={`${ch}-troi`}   style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: t.roi != null && t.roi >= 3 ? '#10b981' : '#111' }}>{t.roi != null ? `${t.roi.toFixed(1)}x` : '—'}</td>
                          </>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
