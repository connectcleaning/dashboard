// Apply a .sql migration file through Supabase's run_sql RPC.
// Usage: node scripts/run-sql.mjs db/migrations/019_monthly_churn_fix.sql
//
// Requires env vars SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// Splits the file into individual statements so multi-statement migrations
// work even though run_sql executes one statement at a time.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/run-sql.mjs <path-to.sql>');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

// Strip `--` line comments, then split on `;`. Our migrations don't use
// semicolons inside string literals or dollar-quoted bodies, so this is safe.
const raw = readFileSync(file, 'utf8');
const stripped = raw
  .split('\n')
  .map((line) => {
    const i = line.indexOf('--');
    return i >= 0 ? line.slice(0, i) : line;
  })
  .join('\n');

const statements = stripped.split(';').map((s) => s.trim()).filter(Boolean);

for (let i = 0; i < statements.length; i++) {
  const { error } = await sb.rpc('run_sql', { query: statements[i] });
  if (error) {
    console.error(`✗ statement ${i + 1}/${statements.length} failed: ${error.message}`);
    console.error(statements[i].slice(0, 300));
    process.exit(1);
  }
  console.log(`✓ statement ${i + 1}/${statements.length}`);
}
console.log(`done: ${file}`);
