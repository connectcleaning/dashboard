-- Fix churn attribution to match how HCP actually stores the data:
--   * raw.hcp_job_assignments is empty; the assigned cleaner lives in
--     raw.hcp_jobs.raw_json->'assigned_employees' (a JSON array).
--   * recurring jobs carry no job_type or line items, so there is no stored
--     "service category". The meaningful service dimension for recurring work
--     is the cadence (Weekly / Bi-weekly / Every N weeks / Monthly), which we
--     derive from the iCal recurrence rule.

create or replace view marts.customer_churn as
with recurring as (
  select
    j.hcp_customer_id,
    j.scheduled_start,
    j.created_at,
    round(j.total_amount / 100.0, 2)        as visit_price,
    j.raw_json->>'recurrence_rule'          as rrule
  from raw.hcp_jobs j
  where coalesce(j.raw_json->>'recurrence_rule', '') <> ''
),
-- current plan = the customer's most recently scheduled recurring job
latest as (
  select distinct on (hcp_customer_id)
    hcp_customer_id, visit_price, rrule
  from recurring
  order by hcp_customer_id, scheduled_start desc nulls last, created_at desc nulls last
),
parsed as (
  select
    hcp_customer_id,
    visit_price,
    rrule,
    substring(rrule from 'FREQ=([A-Z]+)')                                  as freq,
    coalesce(nullif(substring(rrule from 'INTERVAL=([0-9]+)'), '')::numeric, 1) as intvl,
    nullif(substring(rrule from 'UNTIL=(\d{8}T\d{6}Z)'), '')              as until_str
  from latest
),
calc as (
  select
    *,
    case when until_str is not null
      then to_timestamp(until_str, 'YYYYMMDD"T"HH24MISS"Z"') at time zone 'UTC'
      else null
    end as until_ts,
    case freq
      when 'WEEKLY'  then 7      * intvl
      when 'DAILY'   then 1      * intvl
      when 'MONTHLY' then 30.44  * intvl
      when 'YEARLY'  then 365    * intvl
    end as period_days,
    -- Human-readable cadence used as the "service type" for recurring work.
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
-- last cleaner = first assigned tech on the customer's most recent completed
-- job that actually has an assigned employee (assignments live in raw_json).
last_cleaner as (
  select distinct on (j.hcp_customer_id)
    j.hcp_customer_id,
    j.raw_json->'assigned_employees'->0->>'id'                                          as cleaner_id,
    trim(coalesce(j.raw_json->'assigned_employees'->0->>'first_name', '') || ' ' ||
         coalesce(j.raw_json->'assigned_employees'->0->>'last_name', ''))               as cleaner_name
  from raw.hcp_jobs j
  where j.work_status in ('complete rated', 'complete unrated')
    and jsonb_array_length(coalesce(j.raw_json->'assigned_employees', '[]'::jsonb)) > 0
  order by j.hcp_customer_id,
           (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz desc nulls last
)
select
  l.customer_id,
  c.hcp_customer_id,
  c.service_bucket,
  lc.cleaner_id,
  coalesce(nullif(lc.cleaner_name, ''), 'Unassigned')       as cleaner_name,
  (c.until_ts is not null and c.until_ts < now())           as is_churned,
  c.until_ts                                                as churn_date,
  round(c.visit_price * 30.44 / nullif(c.period_days, 0), 2) as mrr
from calc c
join marts._hcp_to_customer l on l.hcp_customer_id = c.hcp_customer_id
left join last_cleaner lc on lc.hcp_customer_id = c.hcp_customer_id
where c.period_days is not null;
