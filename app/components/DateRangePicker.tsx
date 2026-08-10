'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

const PRESETS: { value: string; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

export function DateRangePicker({ preset, from, to }: { preset: string; from: string; to: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function go(next: URLSearchParams) {
    startTransition(() => router.push(`?${next.toString()}`));
  }

  function pickPreset(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set('range', value);
    if (value !== 'custom') { next.delete('from'); next.delete('to'); }
    else {
      if (!next.get('from')) next.set('from', from);
      if (!next.get('to')) next.set('to', to);
    }
    go(next);
  }

  function setCustom(key: 'from' | 'to', value: string) {
    const next = new URLSearchParams(params.toString());
    next.set('range', 'custom');
    if (value) next.set(key, value); else next.delete(key);
    go(next);
  }

  const inputStyle = { padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, background: '#fff' };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: pending ? 0.6 : 1 }}>
      <select value={preset} onChange={e => pickPreset(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
        {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {preset === 'custom' && (
        <>
          <input type="date" value={from} onChange={e => setCustom('from', e.target.value)} style={inputStyle} />
          <span style={{ color: '#6b7280', fontSize: 14 }}>to</span>
          <input type="date" value={to} onChange={e => setCustom('to', e.target.value)} style={inputStyle} />
        </>
      )}
    </div>
  );
}
