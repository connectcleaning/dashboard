-- Trailing-window churn rate by subcontractor / service.
--
-- churn_by_subcontractor and churn_by_service compute rate as
-- churned / (active + churned) off the customer_churn snapshot. But that
-- snapshot keeps every customer who ever lapsed flagged 'churned' forever,
-- while 'active' only reflects the current book -- so those rates accumulate a
-- cleaner's/service's entire lifetime of losses and drift toward 100% over
-- time (a cleaner who stopped taking work pins at 100% permanently). Same
-- cumulative-churn flaw as an all-time percentage, just sliced by cleaner.
--
-- These views replace that with a proper trailing-window rate: of the customers
-- active at the START of the window, what share churned DURING it. It's
-- comparable period-over-period and does not accumulate. Window = 90 days.
--
--   active as of a date D = has a completed visit within 2x their cadence of D
--   base   = active as of (now - 90d)          -- the at-risk denominator
--   churned = active at window start, not active now
--   rate   = churned / base
--
-- Activity is reconstructed from real completed-visit history (like
-- monthly_churn_rate), not from the single last_completed on the snapshot,
-- so a customer whose last visit landed inside the window is correctly counted
-- as active at the window start.

create or replace view marts._churn_window_state as
with cust as (
  select hcp_customer_id, cleaner_id, cleaner_name, service_bucket, period_days, mrr
  from marts.customer_churn
  where status <> 'seasonal' and period_days is not null
),
visits as (
  select c.hcp_customer_id,
    (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz as completed_at
  from raw.hcp_jobs j
  join cust c on c.hcp_customer_id = j.hcp_customer_id
  where j.work_status in ('complete rated', 'complete unrated')
    and (j.raw_json->'work_timestamps'->>'completed_at') is not null
),
state as (
  select c.*,
    (select max(v.completed_at) from visits v
       where v.hcp_customer_id = c.hcp_customer_id
         and v.completed_at <= now()) as last_now,
    (select max(v.completed_at) from visits v
       where v.hcp_customer_id = c.hcp_customer_id
         and v.completed_at <= now() - interval '90 days') as last_at_start
  from cust c
)
select
  hcp_customer_id, cleaner_id, cleaner_name, service_bucket, period_days, mrr,
  (last_now is not null
     and last_now >= now() - make_interval(days => (2 * period_days)::int)) as active_now,
  (last_at_start is not null
     and last_at_start >= now() - interval '90 days' - make_interval(days => (2 * period_days)::int)) as active_at_start
from state;

create or replace view marts.churn_window_by_subcontractor as
select
  cleaner_id,
  cleaner_name,
  count(*) filter (where active_now)                                        as active_customers,
  count(*) filter (where active_at_start)                                   as base_customers,
  count(*) filter (where active_at_start and not active_now)                as churned_customers,
  round(100.0 * count(*) filter (where active_at_start and not active_now)
    / nullif(count(*) filter (where active_at_start), 0), 1)               as churn_pct,
  round(sum(mrr) filter (where active_at_start and not active_now), 2)      as churned_mrr
from marts._churn_window_state
group by 1, 2
having count(*) filter (where active_at_start) > 0
order by churn_pct desc nulls last;

create or replace view marts.churn_window_by_service as
select
  service_bucket,
  count(*) filter (where active_now)                                        as active_customers,
  count(*) filter (where active_at_start)                                   as base_customers,
  count(*) filter (where active_at_start and not active_now)                as churned_customers,
  round(100.0 * count(*) filter (where active_at_start and not active_now)
    / nullif(count(*) filter (where active_at_start), 0), 1)               as churn_pct,
  round(sum(mrr) filter (where active_at_start and not active_now), 2)      as churned_mrr
from marts._churn_window_state
group by 1
having count(*) filter (where active_at_start) > 0
order by churn_pct desc nulls last;
