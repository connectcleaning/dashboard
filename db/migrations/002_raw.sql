create table if not exists raw.hcp_employees (
  hcp_employee_id text primary key,
  name            text,
  role            text,
  is_active       boolean,
  email           text,
  raw_json        jsonb,
  synced_at       timestamptz not null default now()
);

create table if not exists raw.hcp_customers (
  hcp_customer_id text primary key,
  first_name      text,
  last_name       text,
  company         text,
  email           text,
  mobile_phone    text,
  home_phone      text,
  address_city    text,
  address_zip     text,
  tags            text[],
  created_at      timestamptz,
  updated_at      timestamptz,
  raw_json        jsonb not null,
  synced_at       timestamptz not null default now()
);

create table if not exists raw.hcp_jobs (
  hcp_job_id          text primary key,
  hcp_customer_id     text,
  work_status         text,
  total_amount        numeric(12,2),
  outstanding_balance numeric(12,2),
  scheduled_start     timestamptz,
  completed_at        timestamptz,
  hcp_invoice_id      text,
  job_type            text,
  tags                text[],
  address_city        text,
  address_zip         text,
  created_at          timestamptz,
  updated_at          timestamptz,
  raw_json            jsonb,
  synced_at           timestamptz not null default now()
);

create table if not exists raw.hcp_job_assignments (
  hcp_job_id      text,
  hcp_employee_id text,
  primary key (hcp_job_id, hcp_employee_id)
);

create table if not exists raw.hcp_line_items (
  id          text primary key,
  hcp_job_id  text,
  kind        text,
  name        text,
  quantity    numeric,
  unit_price  numeric(12,2),
  amount      numeric(12,2),
  raw_json    jsonb
);

create table if not exists raw.hcp_invoices (
  hcp_invoice_id  text primary key,
  hcp_job_id      text,
  hcp_customer_id text,
  amount          numeric(12,2),
  paid_amount     numeric(12,2),
  status          text,
  sent_at         timestamptz,
  paid_at         timestamptz,
  raw_json        jsonb,
  synced_at       timestamptz not null default now()
);

create table if not exists raw.ghl_contacts (
  ghl_contact_id text primary key,
  first_name     text,
  last_name      text,
  email          text,
  phone          text,
  source         text,
  tags           text[],
  date_added     timestamptz,
  raw_json       jsonb,
  synced_at      timestamptz not null default now()
);

create table if not exists raw.ghl_pipelines (
  pipeline_id text primary key,
  name        text,
  raw_json    jsonb
);

create table if not exists raw.ghl_stages (
  stage_id    text primary key,
  pipeline_id text,
  name        text,
  position    int,
  raw_json    jsonb
);

create table if not exists raw.ghl_opportunities (
  ghl_opportunity_id text primary key,
  ghl_contact_id     text,
  pipeline_id        text,
  stage_id           text,
  status             text,
  monetary_value     numeric(12,2),
  source             text,
  created_at         timestamptz,
  updated_at         timestamptz,
  raw_json           jsonb,
  synced_at          timestamptz not null default now()
);

create table if not exists raw.ghl_messages (
  message_id      text primary key,
  ghl_contact_id  text,
  conversation_id text,
  channel         text,
  direction       text,
  created_at      timestamptz,
  raw_json        jsonb
);
