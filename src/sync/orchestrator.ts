import { rawSql } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { syncHcpEmployees } from './hcp_employees.js';
import { syncHcpCustomers } from './hcp_customers.js';
import { syncHcpJobs } from './hcp_jobs.js';
import { syncHcpInvoices } from './hcp_invoices.js';
import { syncGhlPipelines } from './ghl_pipelines.js';
import { syncGhlContacts } from './ghl_contacts.js';
import { syncGhlOpportunities } from './ghl_opportunities.js';
import { syncGhlMessages } from './ghl_messages.js';
import { resolveIdentities } from '../match/resolve.js';

type Mode = 'full' | 'incremental';

async function getCursor(): Promise<Date | undefined> {
  const rows = await rawSql(`select cursor from ops.sync_state where resource = '__global'`);
  const val = rows[0]?.['cursor'];
  return val ? new Date(val as string) : undefined;
}

async function run(resource: string, fn: () => Promise<number>): Promise<void> {
  const runRow = await rawSql(
    `insert into ops.sync_runs (resource, started_at, status) values ('${resource}', now(), 'running') returning id`
  );
  const id = (runRow[0] as { id: number })?.id;

  try {
    const rows_upserted = await fn();
    await rawSql(`update ops.sync_runs set finished_at = now(), rows_upserted = ${rows_upserted}, status = 'ok' where id = ${id}`);
    await rawSql(`insert into ops.sync_state (resource, last_run_at, cursor) values ('${resource}', now(), now()) on conflict (resource) do update set last_run_at = now(), cursor = now()`);
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/'/g, "''");
    await rawSql(`update ops.sync_runs set finished_at = now(), status = 'error', error = '${msg}' where id = ${id}`);
    logger.error('sync failed', { resource, error: msg });
    throw err;
  }
}

export async function orchestrate(mode: Mode): Promise<void> {
  logger.info('orchestrator start', { mode });

  const since = mode === 'incremental' ? await getCursor() : undefined;

  await run('hcp_employees',  () => syncHcpEmployees());
  await run('hcp_customers',  () => syncHcpCustomers(since));
  await run('hcp_jobs',       () => syncHcpJobs(since));
  await run('hcp_invoices',   () => syncHcpInvoices(since));

  await run('ghl_pipelines',     () => syncGhlPipelines());
  await run('ghl_contacts',      () => syncGhlContacts(since));
  await run('ghl_opportunities', () => syncGhlOpportunities(since));
  await run('ghl_messages',      () => syncGhlMessages(since));

  await run('match', async () => { await resolveIdentities(); return 0; });

  await rawSql(`insert into ops.sync_state (resource, last_run_at, cursor) values ('__global', now(), now()) on conflict (resource) do update set last_run_at = now(), cursor = now()`);

  logger.info('orchestrator complete', { mode });
}
