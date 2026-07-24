-- Integration hub — raw event log for all inbound webhooks (HCP, GHL, QBO…).
--
-- Every webhook lands here first. It is the spine of the hub: the dispatcher
-- records what it did with each event (sent / suppressed / ignored / error),
-- and the dashboard + AI layer read the same log. Keeping the raw payload lets
-- us refine field mapping against real payloads without re-plumbing anything.

create schema if not exists hub;

create table if not exists hub.events (
  id            bigint generated always as identity primary key,
  source        text not null,                 -- 'hcp' | 'ghl' | 'qbo'
  event_type    text,                          -- e.g. 'job.completed'
  external_id   text,                          -- source object id (job / appointment / contact)
  payload       jsonb not null,                -- the raw webhook body
  action        text,                          -- 'sent_sms' | 'suppressed_opt_out' | 'suppressed_no_text' | 'ignored' | 'error'
  action_detail jsonb,                         -- message sent, reason skipped, error text, etc.
  received_at   timestamptz not null default now()
);

create index if not exists events_source_type_idx on hub.events (source, event_type, received_at desc);
create index if not exists events_external_id_idx  on hub.events (external_id);
create index if not exists events_action_idx       on hub.events (action, received_at desc);
