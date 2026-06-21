import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function query<T>(sql: string): Promise<T[]> {
  const { data, error } = await supabase.rpc('run_sql', { query: sql });
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
