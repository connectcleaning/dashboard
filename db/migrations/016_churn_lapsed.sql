-- Switch churn definition from "past iCal UNTIL date" to "no upcoming visit".
--
-- HCP books all future recurring visits at sale time, and it also stamps an
-- UNTIL end date on the recurrence rule even for active clients — so a past
-- UNTIL is NOT a reliable churn signal (it massively overstated churn).
--
-- A recurring customer is ACTIVE if they have at least one recurring visit
-- scheduled on or after today, and CHURNED if their schedule has run out with
-- nothing upcoming on the books.

-- churn_date changes type (timestamptz), so drop and recreate the view tree.
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
-- per-customer schedule span
agg as (
  select
    hcp_customer_id,
    max(scheduled_start)                                       as last_scheduled,
    max(scheduled_start) filter (where scheduled_start > now()) as next_scheduled
  from recurring
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
    hcp_customer_id,
    visit_price,
    rrule,
    substring(rrule from 'FREQ=([A-Z]+)')                                  as freq,
    coalesce(nullif(substring(rrule from 'INTERVAL=([0-9]+)'), '')::numeric, 1) as intvl
  from latest
),
calc as (
  select
    *,
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
  (a.next_scheduled is null)                                as is_churned,  -- no upcoming visit
  a.last_scheduled                                          as churn_date,
  round(c.visit_price * 30.44 / nullif(c.period_days, 0), 2) as mrr
from calc c
join marts._hcp_to_customer l on l.hcp_customer_id = c.hcp_customer_id
join agg a on a.hcp_customer_id = c.hcp_customer_id
left join last_cleaner lc on lc.hcp_customer_id = c.hcp_customer_id
where c.period_days is not null;

-- Recreate the aggregate views on top of the rebuilt customer_churn.
create view marts.churn_by_service as
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

create view marts.churn_by_subcontractor as
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
