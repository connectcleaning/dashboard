create table if not exists ops.sync_state (
  resource    text primary key,
  cursor      timestamptz,
  last_run_at timestamptz
);

create table if not exists ops.sync_runs (
  id            bigserial primary key,
  resource      text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  rows_upserted int,
  status        text,
  error         text
);

create index if not exists idx_sync_runs_resource on ops.sync_runs(resource, started_at desc);
