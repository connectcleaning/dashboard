import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../lib/db';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['churned', 'seasonal', 'active'] as const;
const VALID_REASONS  = ['unhappy_quality','cheaper_option','financial','moved_deceased','seasonal','other'] as const;

export async function POST(req: NextRequest) {
  let body: { hcp_customer_id?: string; status?: string; reason?: string; notes?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { hcp_customer_id, status, reason, notes } = body;
  if (!hcp_customer_id || typeof hcp_customer_id !== 'string')
    return NextResponse.json({ error: 'hcp_customer_id required' }, { status: 400 });
  if (!status || !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number]))
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  if (reason && !VALID_REASONS.includes(reason as typeof VALID_REASONS[number]))
    return NextResponse.json({ error: 'Invalid reason' }, { status: 400 });

  const { error } = await supabase.from('churn_review').upsert({
    hcp_customer_id,
    status,
    reason: reason ?? null,
    notes: notes ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'hcp_customer_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
