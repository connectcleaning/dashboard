-- Churn snapshot fix: classify by completed-visit recency, not lingering schedule.
--
-- Migration 018 defined a recurring customer as CHURNED only if their last
-- completed visit was stale (older than 2x cadence) AND they had no upcoming
-- scheduled visit. But HomeAdvisor/HCP perpetually auto-generates the next
-- recurring occurrence, so `next_scheduled` is almost never null -- even for
-- customers whose most recent real visit was 12-19 months ago. That gate
-- re-classified dead accounts as "active" and collapsed churn to ~2%.
--
-- Diagnostic (2026-07-01) of the 91 "active" customers found:
--   * 35  fresh          -> served within 2x their cadence           (truly active)
--   * 13  onboarding      -> never completed a visit, first one booked (pending)
--   * 43  lapsed          -> last completed >2x cadence ago, only kept
--                            "active" by a lingering scheduled tick    (churned)
--
-- This drops the `next_scheduled` gate. A customer's status is now driven by
-- whether they have actually been served recently:
--   active   -> has a completed visit within 2x their cadence
--   churned  -> has completed visits, but the most recent is older than 2x
--   pending  -> never completed a visit, but a first visit is on the books
--               (new/onboarding -- not yet active, but not churned either)
--   churned  -> never completed and nothing upcoming (a signup that never took)
--   seasonal -> manual override from ops.churn_review
--
-- Column set is unchanged, so this is a CREATE OR REPLACE (dependent views
-- churn_by_service / churn_by_subcontractor / monthly_churn_rate are untouched;
-- they already scope their denominators to status in ('active','churned'), so
-- the new 'pending' status is naturally excluded from churn rates).

create or replace view marts.customer_churn as
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
completed as (
  select hcp_customer_id,
    max((raw_json->'work_timestamps'->>'completed_at')::timestamptz) as last_completed
  from raw.hcp_jobs
  where work_status in ('complete rated', 'complete unrated')
  group by 1
),
first_completed as (
  select hcp_customer_id,
    min((raw_json->'work_timestamps'->>'completed_at')::timestamptz) as first_completed
  from raw.hcp_jobs
  where work_status in ('complete rated', 'complete unrated')
  group by 1
),
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
  coalesce(
    cr.status,
    case
      -- served within 2x their cadence -> genuinely active
      when cp.last_completed is not null
           and cp.last_completed >= now() - make_interval(days => (2 * c.period_days)::int)
        then 'active'
      -- served before, but the most recent visit is older than 2x cadence -> churned
      when cp.last_completed is not null
        then 'churned'
      -- never served, but a first visit is booked -> onboarding, not yet active
      when u.next_scheduled is not null
        then 'pending'
      -- never served and nothing upcoming -> a signup that never took
      else 'churned'
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
