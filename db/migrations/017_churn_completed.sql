-- Churn definition v3: based on actual completed visits, not scheduled ones.
--
--   v1 (past UNTIL date)        -> overstated churn (~64%); HCP stamps end
--                                  dates on active clients.
--   v2 (no upcoming visit)      -> understated churn (~2%); HCP leaves future
--                                  occurrences on the calendar after a client
--                                  effectively stops.
--   v3 (this): a recurring customer is CHURNED if their most recent COMPLETED
--      visit is more than 2x their normal interval ago (or they never had one).
--      This measures whether they're actually still being served.

drop view if exists marts.churn_by_service cascade;
drop view if exists marts.churn_by_subcontractor cascade;
drop view if exists marts.customer_churn cascade;

create view marts.customer_churn as
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
-- most recent COMPLETED visit per customer (any job, recurring or not)
completed as (
  select
    hcp_customer_id,
    max((raw_json->'work_timestamps'->>'completed_at')::timestamptz) as last_completed
  from raw.hcp_jobs
  where work_status in ('complete rated', 'complete unrated')
  group by 1
),
-- current plan = the customer's most recently scheduled recurring visit
latest as (
  select distinct on (hcp_customer_id)
    hcp_customer_id, visit_price, rrule
  from recurring
  order by hcp_customer_id, scheduled_start desc nulls last, created_at desc nulls last
),
parsed as (
  select
    hcp_customer_id, visit_price, rrule,
    substring(rrule from 'FREQ=([A-Z]+)')                                  as freq,
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
         coalesce(j.raw_json->'assigned_employees'->0->>'last_name',''))  as cleaner_name
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
  lc.cleaner_id,
  coalesce(nullif(lc.cleaner_name,''), 'Unassigned') as cleaner_name,
  -- churned: no completed visit, or last one is older than 2x the interval
  (cp.last_completed is null
     or cp.last_completed < now() - make_interval(days => (2 * c.period_days)::int)) as is_churned,
  cp.last_completed                                  as churn_date,
  round(c.visit_price * 30.44 / nullif(c.period_days,0), 2) as mrr
from calc c
join marts._hcp_to_customer l on l.hcp_customer_id = c.hcp_customer_id
left join completed cp on cp.hcp_customer_id = c.hcp_customer_id
left join last_cleaner lc on lc.hcp_customer_id = c.hcp_customer_id
where c.period_days is not null;

create view marts.churn_by_service as
select
  service_bucket,
  count(*)                                                                          as recurring_customers,
  sum(case when is_churned then 1 else 0 end)                                       as churned_customers,
  round(100.0 * sum(case when is_churned then 1 else 0 end) / nullif(count(*),0), 1) as churn_pct,
  round(sum(case when is_churned then mrr else 0 end), 2)                           as churned_mrr,
  round(sum(case when not is_churned then mrr else 0 end), 2)                       as active_mrr
from marts.customer_churn
group by 1 order by churn_pct desc nulls last;

create view marts.churn_by_subcontractor as
select
  cleaner_id,
  cleaner_name,
  count(*)                                                                          as recurring_customers,
  sum(case when is_churned then 1 else 0 end)                                       as churned_customers,
  round(100.0 * sum(case when is_churned then 1 else 0 end) / nullif(count(*),0), 1) as churn_pct,
  round(sum(case when is_churned then mrr else 0 end), 2)                           as churned_mrr,
  round(sum(case when not is_churned then mrr else 0 end), 2)                       as active_mrr
from marts.customer_churn
group by 1, 2 order by churn_pct desc nulls last;
