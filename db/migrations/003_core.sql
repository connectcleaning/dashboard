create table if not exists core.customer (
  customer_id   uuid primary key default gen_random_uuid(),
  display_name  text,
  primary_phone_e164 text,
  primary_email text,
  created_at    timestamptz not null default now()
);

create table if not exists core.customer_source_link (
  customer_id       uuid        not null references core.customer(customer_id),
  source            text        not null check (source in ('hcp','ghl')),
  source_id         text        not null,
  match_method      text,
  match_confidence  text,
  linked_at         timestamptz not null default now(),
  primary key (source, source_id)
);

create index if not exists idx_csl_customer_id on core.customer_source_link(customer_id);

create table if not exists core.match_review (
  id                bigserial primary key,
  hcp_customer_id   text,
  ghl_contact_id    text,
  reason            text,
  resolved          boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists core.service_bucket_map (
  match_value    text primary key,
  match_type     text not null default 'job_type' check (match_type in ('job_type','tag')),
  service_bucket text,
  is_recurring   boolean not null default false
);

create table if not exists core.job_costs (
  hcp_job_id   text primary key,
  gross_profit numeric(12,2),
  sub_pay      numeric(12,2)
);
