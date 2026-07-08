import { supabase } from './db';

// Run arbitrary SQL through the same run_sql RPC the rest of the app uses.
export async function runSql(sql: string): Promise<unknown> {
  const { data, error } = await supabase.rpc('run_sql', { query: sql });
  if (error) throw new Error(error.message);
  return data;
}

// Escape a value as a SQL string literal. Webhook data is untrusted, so every
// interpolated value goes through this (single quotes doubled); standard
// conforming strings mean this is sufficient to prevent injection.
function lit(v: string | null | undefined): string {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function jsonLit(obj: unknown): string {
  return obj === undefined ? 'null' : `${lit(JSON.stringify(obj ?? null))}::jsonb`;
}

export type HubEvent = {
  source: string;
  event_type?: string | null;
  external_id?: string | null;
  payload: unknown;
  action?: string | null;
  action_detail?: unknown;
};

// Append one row to the hub event log. Never let a logging failure bubble up
// into a webhook response — callers wrap this in try/catch.
export async function logEvent(e: HubEvent): Promise<void> {
  const sql =
    `insert into hub.events (source, event_type, external_id, payload, action, action_detail) values (` +
    `${lit(e.source)}, ${lit(e.event_type ?? null)}, ${lit(e.external_id ?? null)}, ` +
    `${jsonLit(e.payload)}, ${lit(e.action ?? null)}, ${jsonLit(e.action_detail)})`;
  await runSql(sql);
}
