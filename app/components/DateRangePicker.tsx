'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export function DateRangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: 'from' | 'to', value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    startTransition(() => router.push(`?${next.toString()}`));
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: pending ? 0.6 : 1 }}>
      <input
        type="month"
        value={from.slice(0, 7)}
        onChange={e => update('from', e.target.value ? `${e.target.value}-01` : '')}
        style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 }}
      />
      <span style={{ color: '#6b7280', fontSize: 14 }}>to</span>
      <input
        type="month"
        value={to.slice(0, 7)}
        onChange={e => update('to', e.target.value ? `${e.target.value}-01` : '')}
        style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 }}
      />
      {(params.get('from') || params.get('to')) && (
        <button
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            next.delete('from'); next.delete('to');
            startTransition(() => router.push(`?${next.toString()}`));
          }}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: 'none', fontSize: 13, color: '#6b7280', cursor: 'pointer' }}
        >
          Reset
        </button>
      )}
    </div>
  );
}
