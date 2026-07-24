import { NextRequest, NextResponse } from 'next/server';
import { runSql } from '../../lib/hub';

export const dynamic = 'force-dynamic';

// Fill any blank customer names from HCP/GHL. Runs on a daily Vercel Cron
// (see vercel.json) so names self-heal regardless of what the external ETL
// writes. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await runSql('select core.reconcile_customer_names() as names_filled');
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
