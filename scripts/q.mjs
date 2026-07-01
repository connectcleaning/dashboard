import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const q = process.argv[2];
const { data, error } = await sb.rpc('run_sql', { query: q });
if (error) { console.error('ERROR:', error.message); process.exit(1); }
console.log(JSON.stringify(data, null, 2));
