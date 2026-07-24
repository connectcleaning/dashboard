'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

export function RetentionChart({ data }: { data: { n: number; retention: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis dataKey="n" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} tickFormatter={v => `M${v}`} />
        <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} width={40} />
        <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Retained']} labelFormatter={l => `Month ${l}`} />
        <ReferenceLine y={50} stroke="#e5e7eb" strokeDasharray="4 4" />
        <Line type="monotone" dataKey="retention" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
