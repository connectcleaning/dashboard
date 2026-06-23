-- Churn review system + monthly churn rate.
--
-- 1. ops.churn_review: manual triage records for churned customers.
-- 2. Updated marts.customer_churn: churned = no completed visit in 2x cadence
--    AND no upcoming scheduled visit. Seasonal customers are flagged separately.
-- 3. marts.monthly_churn_rate: proper periodic churn rate per month.

-- ── 1. Triage table ───────────────────────────────────────────────────────────
create table if not exists ops.churn_review (
  hcp_customer_id  text primary key,
  status           text not null check (status in ('churned','seasonal','active')),
  reason           text check (reason in (
                     'unhappy_quality','cheaper_option','financial',
                     'moved_deceased','seasonal','other')),
  notes            text,
  reviewed_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── 2. Rebuild customer_churn with combined signal + seasonal awareness ───────
drop view if exists marts.churn_by_service cascade;
drop view if exists marts.churn_by_subcontractor cascade;
drop view if exists marts.customer_churn cascade;

create view marts.customer_churn as
with recurring as (
  select
    j.hcp_customer_id,
    j.scheduled_start,
    j.created_at,
    round(j.total_amount / 100.0, 2) as visit_price,
    j.raw_json->>'recurrence_rule'   as rrule
  from raw.hcp_jobs j
  where coalesce(j.raw_json->>'recurrence_rule', '') <> ''
),
-- most recent completed visit per customer
completed as (
  select hcp_customer_id,
    max((raw_json->'work_timestamps'->>'completed_at')::timestamptz) as last_completed
  from raw.hcp_jobs
  where work_status in ('complete rated', 'complete unrated')
  group by 1
),
-- first completed visit (used for monthly churn cohort)
first_completed as (
  select hcp_customer_id,
    min((raw_json->'work_timestamps'->>'completed_at')::timestamptz) as first_completed
  from raw.hcp_jobs
  where work_status in ('complete rated', 'complete unrated')
  group by 1
),
-- next upcoming recurring visit
upcoming as (
  select hcp_customer_id,
    min(scheduled_start) filter (where scheduled_start > now()) as next_scheduled
  from recurring
  group by 1
),
latest as (
  select distinct on (hcp_customer_id) hcp_customer_id, visit_price, rrule
  from recurring
  order by hcp_customer_id, scheduled_start desc nulls last, created_at desc nulls last
),
parsed as (
  select hcp_customer_id, visit_price, rrule,
    substring(rrule from 'FREQ=([A-Z]+)') as freq,
    coalesce(nullif(substring(rrule from 'INTERVAL=([0-9]+)'), '')::numeric, 1) as intvl
  from latest
),
calc as (
  select *,
    case freq
      when 'WEEKLY'  then 7      * intvl
      when 'DAILY'   then 1      * intvl
      when 'MONTHLY' then 30.44  * intvl
      when 'YEARLY'  then 365    * intvl
    end as period_days,
    case
      when freq = 'WEEKLY'  and intvl = 1 then 'Weekly'
      when freq = 'WEEKLY'  and intvl = 2 then 'Bi-weekly'
      when freq = 'WEEKLY'  and intvl = 4 then 'Every 4 weeks'
      when freq = 'WEEKLY'                then 'Every ' || intvl || ' weeks'
      when freq = 'MONTHLY' and intvl = 1 then 'Monthly'
      when freq = 'MONTHLY'               then 'Every ' || intvl || ' months'
      when freq = 'DAILY'                 then 'Every ' || intvl || ' days'
      when freq = 'YEARLY'                then 'Yearly'
      else coalesce(freq, 'Unknown')
    end as service_bucket
  from parsed
),
last_cleaner as (
  select distinct on (j.hcp_customer_id)
    j.hcp_customer_id,
    j.raw_json->'assigned_employees'->0->>'id' as cleaner_id,
    trim(coalesce(j.raw_json->'assigned_employees'->0->>'first_name','') || ' ' ||
         coalesce(j.raw_json->'assigned_employees'->0->>'last_name','')) as cleaner_name
  from raw.hcp_jobs j
  where j.work_status in ('complete rated', 'complete unrated')
    and jsonb_array_length(coalesce(j.raw_json->'assigned_employees','[]'::jsonb)) > 0
  order by j.hcp_customer_id,
    (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz desc nulls last
)
select
  l.customer_id,
  c.hcp_customer_id,
  c.service_bucket,
  c.period_days,
  lc.cleaner_id,
  coalesce(nullif(lc.cleaner_name,''), 'Unassigned') as cleaner_name,
  coalesce(cr.status,
    case
      -- seasonal: manually flagged
      when cr.status = 'seasonal' then 'seasonal'
      -- churned: no recent completed visit AND no upcoming visit
      when (cp.last_completed is null
            or cp.last_completed < now() - make_interval(days => (2 * c.period_days)::int))
           and u.next_scheduled is null
        then 'churned'
      else 'active'
    end
  ) as status,
  cr.reason,
  cp.last_completed,
  fc.first_completed,
  u.next_scheduled,
  round(c.visit_price * 30.44 / nullif(c.period_days, 0), 2) as mrr
from calc c
join marts._hcp_to_customer l on l.hcp_customer_id = c.hcp_customer_id
left join completed cp on cp.hcp_customer_id = c.hcp_customer_id
left join first_completed fc on fc.hcp_customer_id = c.hcp_customer_id
left join upcoming u on u.hcp_customer_id = c.hcp_customer_id
left join last_cleaner lc on lc.hcp_customer_id = c.hcp_customer_id
left join ops.churn_review cr on cr.hcp_customer_id = c.hcp_customer_id
where c.period_days is not null;

create view marts.churn_by_service as
select
  service_bucket,
  count(*) filter (where status in ('active','churned'))               as recurring_customers,
  count(*) filter (where status = 'churned')                           as churned_customers,
  round(100.0 * count(*) filter (where status = 'churned')
    / nullif(count(*) filter (where status in ('active','churned')), 0), 1) as churn_pct,
  round(sum(mrr) filter (where status = 'churned'), 2)                as churned_mrr,
  round(sum(mrr) filter (where status = 'active'), 2)                 as active_mrr
from marts.customer_churn
group by 1 order by churn_pct desc nulls last;

create view marts.churn_by_subcontractor as
select
  cleaner_id,
  cleaner_name,
  count(*) filter (where status in ('active','churned'))               as recurring_customers,
  count(*) filter (where status = 'churned')                           as churned_customers,
  round(100.0 * count(*) filter (where status = 'churned')
    / nullif(count(*) filter (where status in ('active','churned')), 0), 1) as churn_pct,
  round(sum(mrr) filter (where status = 'churned'), 2)                as churned_mrr,
  round(sum(mrr) filter (where status = 'active'), 2)                 as active_mrr
from marts.customer_churn
group by 1, 2 order by churn_pct desc nulls last;

-- ── 3. Monthly churn rate ─────────────────────────────────────────────────────
-- A customer is "active" in a given month if their last_completed visit
-- was within 2x their cadence as of that month-end, OR they had an upcoming
-- visit at that point. Churned in month M = was active in M-1, not active in M.
create or replace view marts.monthly_churn_rate as
with months as (
  select generate_series(
    date_trunc('month', now() - interval '11 months'),
    date_trunc('month', now()),
    '1 month'::interval
  ) as month
),
-- for each customer, generate their active window
-- active from first_completed until they go 2x-cadence without a visit
-- (we approximate: active in month M if last_completed <= end of M
--  and last_completed >= end of M minus 2x period)
customer_months as (
  select
    cc.hcp_customer_id,
    cc.mrr,
    m.month,
    -- was this customer active at end of this month?
    (
      cc.last_completed is not null
      and cc.last_completed <= (m.month + interval '1 month - 1 second')
      and cc.first_completed <= (m.month + interval '1 month - 1 second')
      and (
        cc.last_completed >= (m.month + interval '1 month - 1 second')
                             - make_interval(days => (2 * cc.period_days)::int)
        or cc.next_scheduled > (m.month + interval '1 month - 1 second')
      )
    ) as was_active
  from marts.customer_churn cc
  cross join months m
  where cc.status <> 'seasonal'
),
-- flag churned: active last month, not active this month
with_prev as (
  select *,
    lag(was_active) over (partition by hcp_customer_id order by month) as was_active_prev
  from customer_months
)
select
  month::text,
  count(*) filter (where was_active_prev)                              as active_start,
  count(*) filter (where was_active_prev and not was_active)           as churned,
  round(100.0 * count(*) filter (where was_active_prev and not was_active)
    / nullif(count(*) filter (where was_active_prev), 0), 1)          as churn_pct,
  round(sum(mrr) filter (where was_active_prev and not was_active), 2) as churned_mrr
from with_prev
where month >= date_trunc('month', now() - interval '11 months')
group by 1
order by 1;
