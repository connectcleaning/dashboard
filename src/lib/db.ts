import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Thin wrapper so sync modules can call: await upsert('raw', 'hcp_employees', rows, 'hcp_employee_id')
export async function upsert(
  schema: string,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .schema(schema)
    .from(table)
    .upsert(rows, { onConflict });
  if (error) throw new Error(`upsert ${schema}.${table}: ${error.message}`);
}

// For complex SQL (identity resolution, sync_runs bookkeeping)
export async function rawSql(query: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.rpc('run_sql', { query });
  if (error) throw new Error(`SQL: ${error.message}\n${query}`);
  return (data ?? []) as Record<string, unknown>[];
}
