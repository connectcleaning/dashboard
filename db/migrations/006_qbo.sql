-- QuickBooks Online: token storage, raw expense data, and spend marts.

-- OAuth token store. Refresh tokens rotate on every refresh, so we persist
-- the latest one here (one row per company / realm).
create table if not exists ops.qbo_tokens (
  realm_id                 text primary key,
  refresh_token            text not null,
  access_token             text,
  access_token_expires_at  timestamptz,
  updated_at               timestamptz not null default now()
);

-- Raw expense sources -------------------------------------------------------

create table if not exists raw.qbo_vendors (
  qbo_id       text primary key,
  display_name text,
  active       boolean,
  raw_json     jsonb not null,
  synced_at    timestamptz not null default now()
);

-- "Purchase" = cash / credit-card / check expenses
create table if not exists raw.qbo_purchases (
  qbo_id        text primary key,
  txn_date      date,
  total_amount  numeric(12,2),
  payment_type  text,
  vendor_name   text,
  updated_at    timestamptz,
  raw_json      jsonb not null,
  synced_at     timestamptz not null default now()
);

-- "Bill" = accounts-payable expenses
create table if not exists raw.qbo_bills (
  qbo_id        text primary key,
  txn_date      date,
  total_amount  numeric(12,2),
  vendor_name   text,
  updated_at    timestamptz,
  raw_json      jsonb not null,
  synced_at     timestamptz not null default now()
);

-- Marts ---------------------------------------------------------------------

-- Line-level spend across both sources, with category (account) + vendor.
create or replace view marts.fact_spend as
select
  'purchase'                                            as source,
  p.qbo_id,
  p.txn_date,
  date_trunc('month', p.txn_date)                       as month,
  coalesce(p.vendor_name, p.raw_json->'EntityRef'->>'name') as vendor,
  line->'AccountBasedExpenseLineDetail'->'AccountRef'->>'name' as category,
  (line->>'Amount')::numeric(12,2)                      as amount
from raw.qbo_purchases p,
     lateral jsonb_array_elements(p.raw_json->'Line') line
where line->>'DetailType' = 'AccountBasedExpenseLineDetail'
union all
select
  'bill'                                                as source,
  b.qbo_id,
  b.txn_date,
  date_trunc('month', b.txn_date)                       as month,
  coalesce(b.vendor_name, b.raw_json->'VendorRef'->>'name') as vendor,
  line->'AccountBasedExpenseLineDetail'->'AccountRef'->>'name' as category,
  (line->>'Amount')::numeric(12,2)                      as amount
from raw.qbo_bills b,
     lateral jsonb_array_elements(b.raw_json->'Line') line
where line->>'DetailType' = 'AccountBasedExpenseLineDetail';

-- Total spend per month.
create or replace view marts.monthly_spend as
select month, sum(amount) as total_spend, count(*) as line_items
from marts.fact_spend
where month is not null
group by 1
order by 1;

-- Spend per category per month.
create or replace view marts.spend_by_category as
select month, coalesce(category, 'Uncategorized') as category, sum(amount) as spend
from marts.fact_spend
where month is not null
group by 1, 2
order by 1, 3 desc;

-- Advertising spend: paid digital ad channels only, matched on category.
-- (See 007_qbo_adspend.sql — tuned to this company's chart of accounts.)
create or replace view marts.ad_spend as
select month, sum(amount) as ad_spend
from marts.fact_spend
where month is not null
  and (
    category ilike '%Google LSA%'
    or category ilike '%Meta Ads%'
    or category ilike '%Google Ads%'
  )
group by 1
order by 1;

-- Blended ad ROI: monthly completed-job revenue vs ad spend.
-- Note: this is blended (all revenue / all ad spend), not per-lead attribution.
create or replace view marts.ad_roi as
select
  a.month,
  a.ad_spend,
  coalesce(r.revenue, 0)                                as revenue,
  case when a.ad_spend > 0
       then round(coalesce(r.revenue, 0) / a.ad_spend, 2)
  end                                                   as roi
from marts.ad_spend a
left join (
  select date_trunc('month', job_date) as month, sum(revenue) as revenue
  from marts.fact_job
  where job_date is not null
  group by 1
) r on r.month = a.month
order by a.month;
