-- Churn reporting for recurring customers.
--
-- A recurring customer is considered CHURNED when the iCal recurrence rule on
-- their most recent recurring job carries an UNTIL date that has already passed
-- (e.g. UNTIL=20250130T160000Z). Customers with no UNTIL, or an UNTIL in the
-- future, are still active.
--
-- Service type  = service bucket of their most recent recurring job.
-- Subcontractor = the cleaner on the customer's most recent completed visit
--                 (i.e. who they had when they left).

create or replace view marts.customer_churn as
with recurring as (
  select
    j.hcp_customer_id,
    j.scheduled_start,
    j.created_at,
    j.job_type,
    round(j.total_amount / 100.0, 2)        as visit_price,
    j.raw_json->>'recurrence_rule'          as rrule
  from raw.hcp_jobs j
  where coalesce(j.raw_json->>'recurrence_rule', '') <> ''
),
-- current plan = the customer's most recently scheduled recurring job
latest as (
  select distinct on (hcp_customer_id)
    hcp_customer_id, visit_price, rrule, job_type
  from recurring
  order by hcp_customer_id, scheduled_start desc nulls last, created_at desc nulls last
),
parsed as (
  select
    hcp_customer_id,
    visit_price,
    rrule,
    job_type,
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
    end as period_days
  from parsed
),
-- last cleaner = cleaner on the customer's most recent completed job
last_cleaner as (
  select distinct on (j.hcp_customer_id)
    j.hcp_customer_id,
    a.hcp_employee_id
  from raw.hcp_jobs j
  join raw.hcp_job_assignments a on a.hcp_job_id = j.hcp_job_id
  where j.work_status in ('complete rated', 'complete unrated')
  order by j.hcp_customer_id,
           (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz desc nulls last
)
select
  l.customer_id,
  c.hcp_customer_id,
  coalesce(sm.service_bucket, c.job_type, 'Unknown')        as service_bucket,
  lc.hcp_employee_id                                        as cleaner_id,
  coalesce(e.name, 'Unassigned')                            as cleaner_name,
  (c.until_ts is not null and c.until_ts < now())           as is_churned,
  c.until_ts                                                as churn_date,
  round(c.visit_price * 30.44 / nullif(c.period_days, 0), 2) as mrr
from calc c
join marts._hcp_to_customer l on l.hcp_customer_id = c.hcp_customer_id
left join core.service_bucket_map sm on sm.match_value = c.job_type and sm.match_type = 'job_type'
left join last_cleaner lc on lc.hcp_customer_id = c.hcp_customer_id
left join raw.hcp_employees e on e.hcp_employee_id = lc.hcp_employee_id
where c.period_days is not null;

-- Churn rate by service type.
create or replace view marts.churn_by_service as
select
  service_bucket,
  count(*)                                                              as recurring_customers,
  sum(case when is_churned then 1 else 0 end)                           as churned_customers,
  round(100.0 * sum(case when is_churned then 1 else 0 end) / nullif(count(*), 0), 1) as churn_pct,
  round(sum(case when is_churned then mrr else 0 end), 2)               as churned_mrr,
  round(sum(case when not is_churned then mrr else 0 end), 2)           as active_mrr
from marts.customer_churn
group by 1
order by churn_pct desc nulls last;

-- Churn rate by subcontractor (last cleaner).
create or replace view marts.churn_by_subcontractor as
select
  cleaner_id,
  cleaner_name,
  count(*)                                                              as recurring_customers,
  sum(case when is_churned then 1 else 0 end)                           as churned_customers,
  round(100.0 * sum(case when is_churned then 1 else 0 end) / nullif(count(*), 0), 1) as churn_pct,
  round(sum(case when is_churned then mrr else 0 end), 2)               as churned_mrr,
  round(sum(case when not is_churned then mrr else 0 end), 2)           as active_mrr
from marts.customer_churn
group by 1, 2
order by churn_pct desc nulls last;
