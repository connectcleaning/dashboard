-- Fix monthly_churn_rate to reconstruct each customer's month-by-month activity
-- from their real completed-visit history (the previous version only had each
-- customer's single most-recent visit, so it dumped all churn into one month).
--
-- For each month-end, a customer is "active" if they had a completed visit
-- within 2x their cadence as of that date. Churned in month M = active at the
-- end of M-1 but not at the end of M. The in-progress current month also
-- counts an upcoming scheduled visit as active to avoid false positives.

create or replace view marts.monthly_churn_rate as
with months as (
  select generate_series(
    date_trunc('month', now() - interval '11 months'),
    date_trunc('month', now()),
    '1 month'::interval
  ) as month
),
cust as (
  select hcp_customer_id, period_days, mrr, next_scheduled
  from marts.customer_churn
  where status <> 'seasonal'
),
visits as (
  select c.hcp_customer_id,
    (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz as completed_at
  from raw.hcp_jobs j
  join cust c on c.hcp_customer_id = j.hcp_customer_id
  where j.work_status in ('complete rated', 'complete unrated')
    and (j.raw_json->'work_timestamps'->>'completed_at') is not null
),
cm as (
  select
    c.hcp_customer_id, c.period_days, c.mrr, c.next_scheduled, m.month,
    (m.month + interval '1 month - 1 second') as month_end,
    (select max(v.completed_at) from visits v
       where v.hcp_customer_id = c.hcp_customer_id
         and v.completed_at <= m.month + interval '1 month - 1 second') as last_visit
  from cust c
  cross join months m
),
flagged as (
  select *,
    (
      (last_visit is not null
        and last_visit >= month_end - make_interval(days => (2 * period_days)::int))
      or (month = date_trunc('month', now()) and next_scheduled is not null)
    ) as was_active
  from cm
),
with_prev as (
  select *,
    lag(was_active) over (partition by hcp_customer_id order by month) as prev_active
  from flagged
)
select
  month::text,
  count(*) filter (where prev_active)                                   as active_start,
  count(*) filter (where prev_active and not was_active)                as churned,
  round(100.0 * count(*) filter (where prev_active and not was_active)
    / nullif(count(*) filter (where prev_active), 0), 1)               as churn_pct,
  round(sum(mrr) filter (where prev_active and not was_active), 2)      as churned_mrr
from with_prev
where month >= date_trunc('month', now() - interval '11 months')
group by 1
order by 1;
