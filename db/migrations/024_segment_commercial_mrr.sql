-- Customer segment (House Cleaning vs Commercial) + visit-derived economics
-- for commercial accounts.
--
-- Two problems this fixes:
--   1. No segmentation. customer.kind cleanly splits the base: 'homeowner' =
--      House Cleaning (residential), 'business' = Commercial. Full coverage,
--      and the 14 business accounts match the 'Commercial' job tag exactly.
--   2. Commercial cadence/MRR is garbage. Commercial accounts are booked as
--      several separate recurring series (San Simeon has 10) so they can carry
--      different monthly task checklists, and their recurrence templates are
--      often $0-priced (billed per visit instead). Deriving cadence/MRR from a
--      single recurrence rule therefore mislabels frequency (Monarch/Trang is
--      3x weekly, shown as "Weekly") and reports $0 MRR ($6.5k/mo of run-rate
--      revenue was invisible).
--
-- For business accounts we instead derive economics from ACTUAL completed
-- visits:
--   period_days = average gap between completed visits (span / (visits-1))
--   mrr         = billed revenue run-rate = total_revenue * 30.44 / span_days
--   service_bucket = frequency label from the real average gap
-- Residential accounts (single priced series) keep the recurrence-rule method.
-- Accounts with <2 completed visits fall back to the recurrence-rule values.
--
-- Appends a `segment` column; all existing columns keep name/type/order so
-- dependent views (monthly_churn_rate, churn_window_*, cohort_retention,
-- ltv_by_service) stay valid. Migration 025 makes those segment-aware.

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
-- customer kind: business vs homeowner (most recent job wins)
vkind as (
  select distinct on (hcp_customer_id)
    hcp_customer_id, raw_json->'customer'->>'kind' as kind
  from raw.hcp_jobs
  order by hcp_customer_id, created_at desc
),
-- actual completed-visit statistics per customer
vstats as (
  select hcp_customer_id,
    count(*)          as vcnt,
    min(cat)          as first_v,
    max(cat)          as last_v,
    sum(amt)          as total_rev
  from (
    select hcp_customer_id,
      (raw_json->'work_timestamps'->>'completed_at')::timestamptz as cat,
      total_amount / 100.0 as amt
    from raw.hcp_jobs
    where work_status in ('complete rated', 'complete unrated')
      and (raw_json->'work_timestamps'->>'completed_at') is not null
  ) x
  group by 1
),
-- effective economics: commercial derived from actual visits, else recurrence rule
eff as (
  select c.*,
    (k.kind = 'business')                                            as is_commercial,
    case when k.kind = 'business' then 'Commercial' else 'House Cleaning' end as segment,
    vs.vcnt,
    vs.total_rev,
    extract(epoch from (vs.last_v - vs.first_v)) / 86400.0           as span_days
  from calc c
  left join vkind  k  on k.hcp_customer_id  = c.hcp_customer_id
  left join vstats vs on vs.hcp_customer_id = c.hcp_customer_id
),
eff2 as (
  select *,
    (case when is_commercial and vcnt > 1 and span_days > 0
       then span_days / (vcnt - 1)
       else period_days end)::numeric                               as eff_period_days,
    case when is_commercial and vcnt > 1 and span_days > 0
       then round(total_rev * 30.44 / span_days, 2)
       else round(visit_price * 30.44 / nullif(period_days, 0), 2) end as eff_mrr,
    case when is_commercial and vcnt > 1 and span_days > 0 then
      case
        when span_days / (vcnt - 1) < 3    then '3x+ Weekly'
        when span_days / (vcnt - 1) < 5.5  then '2x Weekly'
        when span_days / (vcnt - 1) < 10   then 'Weekly'
        when span_days / (vcnt - 1) < 21   then 'Bi-weekly'
        when span_days / (vcnt - 1) < 45   then 'Monthly'
        else 'Occasional'
      end
      else service_bucket end                                       as eff_bucket
  from eff
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
  c.eff_bucket                                       as service_bucket,
  c.eff_period_days                                  as period_days,
  lc.cleaner_id,
  coalesce(nullif(lc.cleaner_name,''), 'Unassigned') as cleaner_name,
  coalesce(
    cr.status,
    case
      when cp.last_completed is not null
           and cp.last_completed >= now() - make_interval(days => (2 * c.eff_period_days)::int)
        then 'active'
      when cp.last_completed is not null
        then 'churned'
      when u.next_scheduled is not null
        then 'pending'
      else 'churned'
    end
  ) as status,
  cr.reason,
  cp.last_completed,
  fc.first_completed,
  u.next_scheduled,
  c.eff_mrr                                          as mrr,
  c.segment
from eff2 c
join marts._hcp_to_customer l on l.hcp_customer_id = c.hcp_customer_id
left join completed cp on cp.hcp_customer_id = c.hcp_customer_id
left join first_completed fc on fc.hcp_customer_id = c.hcp_customer_id
left join upcoming u on u.hcp_customer_id = c.hcp_customer_id
left join last_cleaner lc on lc.hcp_customer_id = c.hcp_customer_id
left join ops.churn_review cr on cr.hcp_customer_id = c.hcp_customer_id
where c.period_days is not null;
