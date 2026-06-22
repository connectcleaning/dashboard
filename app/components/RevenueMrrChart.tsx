'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

interface Datum { month: string; revenue: number; mrr: number }

interface TooltipPayloadItem { payload: { month: string; mrr: number; oneTime: number; revenue: number } }

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const row = (label: string, value: number, color: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
      <span style={{ color }}>{label}</span>
      <strong>${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
    </div>
  );
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 13 }}>{d.month}</p>
      {row('Total Revenue', d.revenue, '#111')}
      {row('MRR (recurring)', d.mrr, '#6366f1')}
      {row('One-time', d.oneTime, '#10b981')}
    </div>
  );
}

export function RevenueMrrChart({ data }: { data: Datum[] }) {
  const rows = data.map(d => ({
    month: d.month,
    mrr: d.mrr,
    oneTime: Math.max(d.revenue - d.mrr, 0),
    revenue: d.revenue,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} width={48} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="mrr" stackId="rev" fill="#6366f1" name="MRR" />
        <Bar dataKey="oneTime" stackId="rev" fill="#10b981" name="One-time" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
