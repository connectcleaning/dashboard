// Apply a .sql migration file through Supabase's run_sql RPC.
// Usage: node scripts/run-sql.mjs db/migrations/019_monthly_churn_fix.sql
//
// Requires env vars SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// Splits the file into individual statements so multi-statement migrations
// work even though run_sql executes one statement at a time. The splitter is
// aware of single-quoted strings, line/block comments, and dollar-quoted
// bodies ($$ … $$ / $tag$ … $tag$), so functions and DO blocks split correctly.

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

// Split SQL into statements on top-level semicolons only — never inside a
// string, comment, or dollar-quoted block.
function splitStatements(sql) {
  const stmts = [];
  let cur = '';
  let inLine = false, inBlock = false, inSingle = false, dollar = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], c2 = sql[i + 1];
    if (inLine) { cur += c; if (c === '\n') inLine = false; continue; }
    if (inBlock) { cur += c; if (c === '*' && c2 === '/') { cur += c2; i++; inBlock = false; } continue; }
    if (inSingle) { cur += c; if (c === "'") { if (c2 === "'") { cur += c2; i++; } else inSingle = false; } continue; }
    if (dollar) { if (sql.startsWith(dollar, i)) { cur += dollar; i += dollar.length - 1; dollar = null; } else cur += c; continue; }
    if (c === '-' && c2 === '-') { inLine = true; cur += c; continue; }
    if (c === '/' && c2 === '*') { inBlock = true; cur += c; continue; }
    if (c === "'") { inSingle = true; cur += c; continue; }
    if (c === '$') {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (m) { dollar = m[0]; cur += dollar; i += dollar.length - 1; continue; }
    }
    if (c === ';') { stmts.push(cur); cur = ''; continue; }
    cur += c;
  }
  stmts.push(cur);
  // Keep only statements that contain real SQL (not just comments/whitespace).
  return stmts.filter((s) => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().length > 0);
}

const statements = splitStatements(readFileSync(file, 'utf8'));

for (let i = 0; i < statements.length; i++) {
  const { error } = await sb.rpc('run_sql', { query: statements[i].trim() });
  if (error) {
    console.error(`✗ statement ${i + 1}/${statements.length} failed: ${error.message}`);
    console.error(statements[i].trim().slice(0, 300));
    process.exit(1);
  }
  console.log(`✓ statement ${i + 1}/${statements.length}`);
}
console.log(`done: ${file}`);
