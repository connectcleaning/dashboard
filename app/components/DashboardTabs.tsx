'use client';

import { useState } from 'react';
import { RevenueChart } from './RevenueChart';
import { RevenueMrrChart } from './RevenueMrrChart';
import { RetentionChart } from './RetentionChart';

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
export interface ChurnServiceRow  { segment: string; service_bucket: string; recurring_customers: number; churned_customers: number; churn_pct: number | null; churned_mrr: number; active_mrr: number }
export interface ChurnSubRow      { segment: string; cleaner_name: string; active_customers: number; base_customers: number; churned_customers: number; churn_pct: number | null; churned_mrr: number }
export interface MonthlyChurnRow  { segment: string; month: string; active_start: number; churned: number; churn_pct: number | null; churned_mrr: number; active_start_mrr: number }
export interface SaveListRow      { customer: string; phone: string | null; segment: string; service_bucket: string; cleaner_name: string; reason: string | null; last_completed: string | null; days_since_last: number; mrr: number }
export interface ChurnWindowServiceRow { segment: string; service_bucket: string; active_customers: number; base_customers: number; churned_customers: number; churn_pct: number | null; churned_mrr: number }
export interface RetentionRow     { segment: string; months_since_start: number; customers_observed: number; retention_pct: number | null; retained_mrr: number }
export interface LtvServiceRow    { segment: string; service_bucket: string; customers: number; avg_ltv: number; median_ltv: number; avg_visits: number; avg_mrr: number; avg_tenure_months: number | null; total_ltv: number }
export interface ProjectedRevRow  { month: string; actual_revenue: number; projected_revenue: number; uninvoiced_fill: number }
export interface ProjectedDetailRow { customer: string; segment: string; service_bucket: string; visits: number; actual_billed: number; expected_mrr: number; uninvoiced_fill: number }

export interface DashboardData {
  mrr: MrrRow[]; monthly: MonthlyRow[]; summary: SummaryRow[];
  opps: OppsRow[]; sources: SourceRow[];
  spend: SpendRow[]; adRoi: AdRoiRow[]; categories: CategoryRow[];
  channelSummary: ChannelRow[]; channelRoi: ChannelRoiRow[]; channelNewMrr: ChannelMrrRow[];
  churnService: ChurnServiceRow[]; churnSub: ChurnSubRow[]; monthlyChurn: MonthlyChurnRow[];
  churnWindowService: ChurnWindowServiceRow[]; retention: RetentionRow[];
  ltvService: LtvServiceRow[]; saveList: SaveListRow[];
  projectedRev: ProjectedRevRow[];
  projectedDetail: ProjectedDetailRow[];
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
  const [segment, setSegment] = useState<'All' | 'House Cleaning' | 'Commercial'>('All');
  const [openCell, setOpenCell] = useState<string | null>(null);       // "YYYY-MM|Channel"
  const [cohort, setCohort] = useState<Record<string, CohortRow[]>>({});
  const [loadingCell, setLoadingCell] = useState<string | null>(null);
  const [showProjDetail, setShowProjDetail] = useState(false);

  // churn review queue
  type ChurnQueueRow = { hcp_customer_id: string; display_name: string | null; service_bucket: string; cleaner_name: string; last_completed: string | null; period_days: number; mrr: number; reason: string | null; status: string };
  const [churnQueue, setChurnQueue] = useState<ChurnQueueRow[] | null>(null);
  const [churnQueueLoading, setChurnQueueLoading] = useState(false);
  const [openChurn, setOpenChurn] = useState<string | null>(null);   // hcp_customer_id
  const [churnEdits, setChurnEdits] = useState<Record<string, { status: string; reason: string; notes: string }>>({});
  const [savingChurn, setSavingChurn] = useState<string | null>(null);

  async function loadChurnQueue() {
    if (churnQueue !== null) return;
    setChurnQueueLoading(true);
    try {
      const res = await fetch('/api/churn-queue');
      const json = await res.json();
      setChurnQueue(json.rows ?? []);
    } catch { setChurnQueue([]); }
    finally { setChurnQueueLoading(false); }
  }

  async function saveChurnReview(hcp_customer_id: string) {
    const edit = churnEdits[hcp_customer_id];
    if (!edit) return;
    setSavingChurn(hcp_customer_id);
    try {
      await fetch('/api/churn-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hcp_customer_id, ...edit }),
      });
      // update local queue
      setChurnQueue(prev => prev ? prev.map(r =>
        r.hcp_customer_id === hcp_customer_id
          ? { ...r, status: edit.status, reason: edit.reason || null }
          : r
      ) : prev);
      setOpenChurn(null);
    } finally { setSavingChurn(null); }
  }

  function getChurnEdit(row: ChurnQueueRow) {
    return churnEdits[row.hcp_customer_id] ?? { status: row.status, reason: row.reason ?? '', notes: '' };
  }
  const { mrr, monthly, summary, opps, sources, spend, adRoi, categories, channelSummary, channelRoi, channelNewMrr, churnService, churnSub, monthlyChurn, churnWindowService, retention, ltvService, saveList, projectedRev, projectedDetail } = data;
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
  // Projected revenue for the current month: actual billed jobs plus, for
  // lump-billed recurring accounts still showing $0, their expected run-rate.
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const projThisMonth = projectedRev.find(r => r.month.slice(0, 7) === thisMonthKey);
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
  // The churn views carry a `segment` column with per-segment rows plus an 'All'
  // roll-up. Filter every dataset to the selected segment so the toggle rescopes
  // the whole section.
  const churnServiceF       = churnService.filter(r => r.segment === segment);
  const churnSubF           = churnSub.filter(r => r.segment === segment);
  const monthlyChurnF       = monthlyChurn.filter(r => r.segment === segment);
  const churnWindowServiceF = churnWindowService.filter(r => r.segment === segment);
  const retentionF          = retention.filter(r => r.segment === segment);
  const ltvServiceF         = ltvService.filter(r => r.segment === segment);
  const churnTotals = churnServiceF.reduce(
    (a, r) => ({
      customers: a.customers + Number(r.recurring_customers),
      churned: a.churned + Number(r.churned_customers),
      churnedMrr: a.churnedMrr + Number(r.churned_mrr),
      activeMrr: a.activeMrr + Number(r.active_mrr),
    }),
    { customers: 0, churned: 0, churnedMrr: 0, activeMrr: 0 },
  );
  const overallChurnPct = churnTotals.customers > 0 ? (churnTotals.churned / churnTotals.customers) * 100 : null;
  // The last monthly_churn_rate row is the current, in-progress month: churn
  // can't be observed until a customer misses enough visits, so it always reads
  // 0/—. Report the last COMPLETED month instead.
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const completedChurnMonths = monthlyChurnF.filter(r => r.month.slice(0, 7) < currentMonthKey);
  const lastChurnMonth = completedChurnMonths[completedChurnMonths.length - 1];
  const retentionData = retentionF.map(r => ({ n: r.months_since_start, retention: r.retention_pct }));
  const retentionFloor = retentionF.length > 0 ? retentionF[retentionF.length - 1] : null;

  // ── Retention & Revenue scoreboard (Hormozi lens) ──
  const CHURN_BENCHMARK = 5; // healthy monthly churn for recurring/consumer services
  const saveListF = saveList.filter(r => segment === 'All' || r.segment === segment);
  const last3 = completedChurnMonths.slice(-3);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avg3Churn = avg(last3.map(r => Number(r.churn_pct) || 0));
  const avgLifetimeMo = avg3Churn && avg3Churn > 0 ? 100 / avg3Churn : null;
  const avg3RevRet = avg(last3.map(r => {
    const s = Number(r.active_start_mrr) || 0, c = Number(r.churned_mrr) || 0;
    return s > 0 ? (1 - c / s) * 100 : 100;
  }));
  const revAtRisk = saveListF.reduce((a, r) => a + Number(r.mrr), 0);
  const churnColor = avg3Churn == null ? '#111' : avg3Churn <= CHURN_BENCHMARK ? '#10b981' : '#ef4444';

  // segment-level driver rollup (dollar-ranked)
  const segmentRollup = ['House Cleaning', 'Commercial', 'Vacation Rental'].map(seg => {
    const rows = churnService.filter(r => r.segment === seg);
    const activeMrr = rows.reduce((a, r) => a + Number(r.active_mrr), 0);
    const churnedMrr = rows.reduce((a, r) => a + Number(r.churned_mrr), 0);
    const active = rows.reduce((a, r) => a + (Number(r.recurring_customers) - Number(r.churned_customers)), 0);
    const churned = rows.reduce((a, r) => a + Number(r.churned_customers), 0);
    return { seg, activeMrr, churnedMrr, active, churned };
  }).filter(s => s.active + s.churned > 0).sort((a, b) => b.churnedMrr - a.churnedMrr);

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: projThisMonth && showProjDetail ? 16 : 40 }}>
            <div
              onClick={() => projThisMonth && setShowProjDetail(v => !v)}
              style={{
                background: '#fff', borderRadius: 12, padding: '20px 24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                cursor: projThisMonth ? 'pointer' : 'default',
                outline: showProjDetail ? '2px solid #111' : 'none',
              }}
            >
              <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Projected Revenue</p>
              <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>${projThisMonth ? fmt(projThisMonth.projected_revenue) : '—'}</p>
              {projThisMonth && (
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  this month · <span style={{ color: '#2563eb', textDecoration: 'underline', textUnderlineOffset: 2 }}>${fmt(projThisMonth.uninvoiced_fill)} not yet invoiced {showProjDetail ? '▲' : '▼'}</span>
                </p>
              )}
            </div>
            <Card label="This Month Revenue" value={`$${currentMonth ? fmt(currentMonth.total_revenue) : '—'}`} sub={revenueChange ? `${revenueChange}% vs last month` : ''} />
            <Card label="MRR" value={`$${currentMrr ? fmt(currentMrr.recurring_revenue) : '—'}`} sub={mrrChange ? `${mrrChange}% vs last month` : ''} />
            <Card label="Avg Job Size" value={`$${(s?.avg_job_size ?? 0).toFixed(0)}`} />
            <Card label="Total Jobs" value={(s?.total_jobs ?? 0).toString()} />
          </div>

          {projThisMonth && showProjDetail && (
            <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 40 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>What&rsquo;s behind the projection — {fmtMonth(projThisMonth.month)}</h2>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                Lump-billed accounts (Commercial &amp; Vacation Rental). While a month is open these show $0 until the invoice lump is entered, so we fill in each account&rsquo;s run-rate. <strong>Already entered</strong> = the lump is in HCP (nothing to project). <strong>To invoice</strong> = still owed, and what the ${fmt(projThisMonth.uninvoiced_fill)} is based on.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ padding: '8px 0' }}>Account</th>
                    <th style={{ padding: '8px 0' }}>Segment</th>
                    <th style={{ padding: '8px 0' }}>Cadence</th>
                    <th style={{ padding: '8px 0', textAlign: 'right' }}>Visits</th>
                    <th style={{ padding: '8px 0', textAlign: 'right' }}>Billed so far</th>
                    <th style={{ padding: '8px 0', textAlign: 'right' }}>Run-rate</th>
                    <th style={{ padding: '8px 0', textAlign: 'right' }}>To invoice</th>
                    <th style={{ padding: '8px 0', textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...projectedDetail]
                    .sort((a, b) => Number(b.uninvoiced_fill) - Number(a.uninvoiced_fill) || Number(b.expected_mrr) - Number(a.expected_mrr))
                    .map((r, i) => {
                      const owed = Number(r.uninvoiced_fill) > 0.5;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #f3f4f6', opacity: owed ? 1 : 0.55 }}>
                          <td style={{ padding: '8px 0', fontWeight: 500 }}>{r.customer}</td>
                          <td style={{ padding: '8px 0', color: '#6b7280' }}>{r.segment}</td>
                          <td style={{ padding: '8px 0', color: '#6b7280' }}>{r.service_bucket}</td>
                          <td style={{ padding: '8px 0', textAlign: 'right' }}>{r.visits}</td>
                          <td style={{ padding: '8px 0', textAlign: 'right' }}>${fmt(Number(r.actual_billed))}</td>
                          <td style={{ padding: '8px 0', textAlign: 'right' }}>${fmt(Number(r.expected_mrr))}</td>
                          <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: owed ? 700 : 400, color: owed ? '#b45309' : '#9ca3af' }}>${fmt(Number(r.uninvoiced_fill))}</td>
                          <td style={{ padding: '8px 0', textAlign: 'right' }}>
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: owed ? '#fef3c7' : '#dcfce7', color: owed ? '#92400e' : '#166534', whiteSpace: 'nowrap' }}>
                              {owed ? 'To invoice' : 'Already entered'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #e5e7eb', fontWeight: 700 }}>
                    <td style={{ padding: '10px 0' }} colSpan={6}>Not yet invoiced</td>
                    <td style={{ padding: '10px 0', textAlign: 'right', color: '#b45309' }}>${fmt(Number(projThisMonth.uninvoiced_fill))}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

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
              {/* Segment toggle */}
              <div style={{ display: 'inline-flex', gap: 2, marginBottom: 16, background: '#f3f4f6', borderRadius: 8, padding: 3 }}>
                {(['All', 'House Cleaning', 'Commercial'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setSegment(s)}
                    style={{
                      fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 6, cursor: 'pointer', border: 'none',
                      background: segment === s ? '#fff' : 'transparent',
                      color: segment === s ? '#111' : '#6b7280',
                      boxShadow: segment === s ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {/* Scoreboard — the vital few */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
                {[
                  { label: 'Active MRR', value: `$${fmt(churnTotals.activeMrr)}`, sub: `${churnTotals.customers - churnTotals.churned} customers`, color: '#111' },
                  { label: 'Monthly Churn', value: avg3Churn != null ? `${avg3Churn.toFixed(1)}%` : '—', sub: `vs ${CHURN_BENCHMARK}% target · last mo ${lastChurnMonth?.churn_pct ?? '—'}%`, color: churnColor },
                  { label: 'Revenue Retention', value: avg3RevRet != null ? `${avg3RevRet.toFixed(1)}%` : '—', sub: 'monthly · 3-mo avg', color: avg3RevRet != null && avg3RevRet >= 95 ? '#10b981' : '#111' },
                  { label: 'Avg Lifetime', value: avgLifetimeMo != null ? `${avgLifetimeMo.toFixed(0)} mo` : '—', sub: 'at current churn', color: '#111' },
                  { label: 'Revenue at Risk', value: `$${fmt(revAtRisk)}`, sub: `${saveListF.length} winnable`, color: revAtRisk > 0 ? '#d97706' : '#111' },
                ].map(k => (
                  <div key={k.label} style={{ background: '#fff', borderRadius: 12, padding: '18px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{k.label}</p>
                    <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: k.color }}>{k.value}</p>
                    <p style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 4 }}>{k.sub}</p>
                  </div>
                ))}
              </div>

              {/* Where the money leaks — by segment, dollar-ranked */}
              {segmentRollup.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Where the money leaks</h2>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Recurring revenue by segment — active vs churned, ranked by dollars lost</p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Segment</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Active MRR</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Churned MRR</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Retained</th>
                      </tr>
                    </thead>
                    <tbody>
                      {segmentRollup.map(s => {
                        const ret = s.activeMrr + s.churnedMrr > 0 ? (100 * s.activeMrr / (s.activeMrr + s.churnedMrr)) : null;
                        return (
                          <tr key={s.seg} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '10px 0', fontWeight: 500 }}>{s.seg}</td>
                            <td style={{ padding: '10px 0', textAlign: 'right', color: '#6366f1' }}>${fmt(s.activeMrr)}</td>
                            <td style={{ padding: '10px 0', textAlign: 'right', color: '#ef4444' }}>${fmt(s.churnedMrr)}</td>
                            <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: ret != null && ret >= 60 ? '#10b981' : '#ef4444' }}>{ret != null ? `${ret.toFixed(0)}%` : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Monthly churn trend + breakdown tables */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                {/* Monthly trend */}
                {monthlyChurnF.length > 0 && (
                  <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Monthly Churn Rate</h2>
                    <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Customers lost ÷ active at start of month</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Month</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Active</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Churned</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Rate</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Lost MRR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyChurnF.map(r => (
                          <tr key={r.month} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '8px 0' }}>{fmtMonth(r.month)}</td>
                            <td style={{ padding: '8px 0', textAlign: 'right' }}>{r.active_start}</td>
                            <td style={{ padding: '8px 0', textAlign: 'right' }}>{r.churned}</td>
                            <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, color: Number(r.churn_pct) >= 5 ? '#ef4444' : '#10b981' }}>
                              {r.churn_pct != null ? `${r.churn_pct}%` : '—'}
                            </td>
                            <td style={{ padding: '8px 0', textAlign: 'right' }}>{r.churned_mrr > 0 ? `$${fmt(r.churned_mrr)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* By subcontractor */}
                <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Churn by Subcontractor</h2>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Cleaner on last completed visit · churn over last 90 days</p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Cleaner</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Active</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Churned&nbsp;90d</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {churnSubF.filter(r => Number(r.base_customers) >= 3).sort((a, b) => Number(b.churned_mrr) - Number(a.churned_mrr)).map(r => (
                        <tr key={r.cleaner_name} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 0' }}>{r.cleaner_name}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.active_customers}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.churned_customers}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: Number(r.churn_pct) >= 25 ? '#ef4444' : '#111' }}>{r.churn_pct != null ? `${r.churn_pct}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Churn by service (windowed) + retention curve */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                {/* By service type */}
                <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Churn by Service Type</h2>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Cadence · churn over last 90 days</p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Service</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Active</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Churned&nbsp;90d</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {churnWindowServiceF.filter(r => Number(r.base_customers) >= 3).sort((a, b) => Number(b.churned_mrr) - Number(a.churned_mrr)).map(r => (
                        <tr key={r.service_bucket} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 0' }}>{r.service_bucket}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.active_customers}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.churned_customers}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: Number(r.churn_pct) >= 25 ? '#ef4444' : '#111' }}>{r.churn_pct != null ? `${r.churn_pct}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Retention curve */}
                {retentionF.length > 0 && (
                  <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Retention Curve</h2>
                    <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                      Share of a signup cohort still active N months later
                      {retentionFloor?.retention_pct != null && ` · ${retentionFloor.retention_pct}% at month ${retentionFloor.months_since_start}`}
                    </p>
                    <RetentionChart data={retentionData} />
                  </div>
                )}
              </div>

              {/* LTV by service type */}
              {ltvServiceF.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Lifetime Value by Service Type</h2>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Revenue earned to date per recurring customer · a floor (active customers keep paying)</p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Service</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Customers</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Avg LTV</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Median LTV</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Avg Visits</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Avg MRR</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Avg Tenure</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ltvServiceF.map(r => (
                        <tr key={r.service_bucket} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 0', fontWeight: 500 }}>{r.service_bucket}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.customers}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: '#6366f1' }}>${fmt(r.avg_ltv)}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>${fmt(r.median_ltv)}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.avg_visits}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>${fmt(r.avg_mrr)}</td>
                          <td style={{ padding: '10px 0', textAlign: 'right' }}>{r.avg_tenure_months != null ? `${r.avg_tenure_months} mo` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Save list — highest-value winnable churns */}
              {saveListF.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16, borderTop: '3px solid #d97706' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Save List — work these this week</h2>
                  <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Churned recurring customers ranked by MRR at stake · {saveListF.length} winnable · ${fmt(revAtRisk)}/mo on the table</p>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 560 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Customer</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>MRR</th>
                          <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6b7280', fontWeight: 500 }}>Segment</th>
                          <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Last cleaner</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Last clean</th>
                          <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {saveListF.slice(0, 12).map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '10px 0', fontWeight: 500 }}>{r.customer}</td>
                            <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600, color: '#6366f1' }}>${fmt(r.mrr)}</td>
                            <td style={{ padding: '10px 12px', color: '#6b7280' }}>{r.segment}</td>
                            <td style={{ padding: '10px 0', color: '#6b7280' }}>{r.cleaner_name}</td>
                            <td style={{ padding: '10px 0', textAlign: 'right', color: r.days_since_last <= 60 ? '#d97706' : '#9ca3af' }}>{r.days_since_last}d ago</td>
                            <td style={{ padding: '10px 0', textAlign: 'right', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{r.phone ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Churn review queue */}
              <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600 }}>Churned Customers — Needs Review</h2>
                  {churnQueue === null && (
                    <button
                      onClick={loadChurnQueue}
                      disabled={churnQueueLoading}
                      style={{ fontSize: 13, padding: '6px 14px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer' }}
                    >
                      {churnQueueLoading ? 'Loading…' : 'Load queue'}
                    </button>
                  )}
                </div>
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                  Classify each churned customer so the reason is tracked and seasonals are excluded from churn metrics.
                </p>
                {churnQueue === null ? (
                  <p style={{ fontSize: 13, color: '#9ca3af' }}>Click &ldquo;Load queue&rdquo; to see churned customers.</p>
                ) : churnQueue.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#10b981', fontWeight: 600 }}>No unreviewed churned customers.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Customer</th>
                        <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Cadence</th>
                        <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Cleaner</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Last Visit</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>MRR</th>
                        <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 500 }}>Status</th>
                        <th style={{ padding: '8px 0' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {churnQueue.map(row => {
                        const isOpen = openChurn === row.hcp_customer_id;
                        const edit = getChurnEdit(row);
                        const statusColor = row.status === 'seasonal' ? '#f59e0b' : '#ef4444';
                        return (
                          <>
                            <tr
                              key={row.hcp_customer_id}
                              style={{ borderBottom: '1px solid #f3f4f6', background: isOpen ? '#f9fafb' : undefined }}
                            >
                              <td style={{ padding: '10px 0', fontWeight: 500 }}>{row.display_name ?? '(unnamed)'}</td>
                              <td style={{ padding: '10px 0', color: '#6b7280' }}>{row.service_bucket}</td>
                              <td style={{ padding: '10px 0', color: '#6b7280' }}>{row.cleaner_name}</td>
                              <td style={{ padding: '10px 0', textAlign: 'right', color: '#6b7280' }}>
                                {row.last_completed ? new Date(row.last_completed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                              </td>
                              <td style={{ padding: '10px 0', textAlign: 'right', color: '#6366f1' }}>{row.mrr > 0 ? `$${fmt(row.mrr)}` : '—'}</td>
                              <td style={{ padding: '10px 0', textAlign: 'right' }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: statusColor }}>
                                  {row.status === 'seasonal' ? 'Seasonal' : 'Churned'}
                                </span>
                              </td>
                              <td style={{ padding: '10px 0', textAlign: 'right' }}>
                                <button
                                  onClick={() => setOpenChurn(isOpen ? null : row.hcp_customer_id)}
                                  style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: isOpen ? '#eef2ff' : '#f9fafb', cursor: 'pointer' }}
                                >
                                  {isOpen ? 'Close' : 'Review'}
                                </button>
                              </td>
                            </tr>
                            {isOpen && (
                              <tr key={`${row.hcp_customer_id}-edit`}>
                                <td colSpan={7} style={{ padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
                                    <div>
                                      <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Status</label>
                                      <select
                                        value={edit.status}
                                        onChange={e => setChurnEdits(prev => ({ ...prev, [row.hcp_customer_id]: { ...getChurnEdit(row), status: e.target.value } }))}
                                        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13 }}
                                      >
                                        <option value="churned">Churned</option>
                                        <option value="seasonal">Seasonal / Pausing</option>
                                        <option value="active">Still Active</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Reason</label>
                                      <select
                                        value={edit.reason}
                                        onChange={e => setChurnEdits(prev => ({ ...prev, [row.hcp_customer_id]: { ...getChurnEdit(row), reason: e.target.value } }))}
                                        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13 }}
                                      >
                                        <option value="">— select reason —</option>
                                        <option value="unhappy_quality">Unhappy with quality</option>
                                        <option value="cheaper_option">Found cheaper option</option>
                                        <option value="financial">Financial situation changed</option>
                                        <option value="moved_deceased">Moved or deceased</option>
                                        <option value="seasonal">Seasonal / out of town</option>
                                        <option value="other">Other</option>
                                      </select>
                                    </div>
                                    <button
                                      onClick={() => saveChurnReview(row.hcp_customer_id)}
                                      disabled={savingChurn === row.hcp_customer_id}
                                      style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#111', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
                                    >
                                      {savingChurn === row.hcp_customer_id ? 'Saving…' : 'Save'}
                                    </button>
                                  </div>
                                  <div style={{ marginTop: 8 }}>
                                    <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Notes (optional)</label>
                                    <input
                                      type="text"
                                      value={edit.notes}
                                      placeholder="e.g. Moving to Orlando in January"
                                      onChange={e => setChurnEdits(prev => ({ ...prev, [row.hcp_customer_id]: { ...getChurnEdit(row), notes: e.target.value } }))}
                                      style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13, boxSizing: 'border-box' }}
                                    />
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                )}
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
                Cohort LTV of leads acquired in that month ÷ channel ad spend that month. ROI builds over time as customers return. <strong>Active MRR</strong> is the recurring monthly revenue still active from that cohort — churned customers are excluded, so it reflects what the channel is currently worth. Click any ROI cell to see that channel&apos;s won customers.
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
                          <th key={`${ch}-mrr`}   style={{ textAlign: 'right', padding: '4px 8px', color: '#9ca3af', fontWeight: 400, fontSize: 12 }}>Active MRR</th>
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
