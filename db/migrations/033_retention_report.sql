-- Supporting data for the "Retention & Revenue" report.
--
-- 1) monthly_churn_rate gains active_start_mrr, so we can compute revenue
--    retention (1 - churned_mrr / active_start_mrr), not just logo churn.
-- 2) save_list: churned recurring customers ranked by the MRR at stake, with
--    contact + last-cleaner + recency, so the office can work the biggest,
--    freshest, most-winnable losses first.

create or replace view marts.monthly_churn_rate as
with months as (
  select generate_series(date_trunc('month', now() - interval '11 months'), date_trunc('month', now()), '1 month'::interval) as month
),
cust as (
  select hcp_customer_id, segment, period_days, mrr, next_scheduled
  from marts.customer_churn where status <> 'seasonal' and period_days is not null
),
visits as (
  select c.hcp_customer_id, (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz as completed_at
  from raw.hcp_jobs j join cust c on c.hcp_customer_id = j.hcp_customer_id
  where j.work_status in ('complete rated', 'complete unrated') and (j.raw_json->'work_timestamps'->>'completed_at') is not null
),
cm as (
  select c.hcp_customer_id, c.segment, c.period_days, c.mrr, c.next_scheduled, m.month,
    (m.month + interval '1 month - 1 second') as month_end,
    (select max(v.completed_at) from visits v where v.hcp_customer_id = c.hcp_customer_id and v.completed_at <= m.month + interval '1 month - 1 second') as last_visit
  from cust c cross join months m
),
flagged as (
  select *, ((last_visit is not null and last_visit >= month_end - make_interval(days => (2*period_days)::int)) or (month = date_trunc('month', now()) and next_scheduled is not null)) as was_active
  from cm
),
with_prev as (
  select *, lag(was_active) over (partition by hcp_customer_id order by month) as prev_active
  from flagged
)
select
  coalesce(segment, 'All')                                              as segment,
  month::text,
  count(*) filter (where prev_active)                                   as active_start,
  count(*) filter (where prev_active and not was_active)                as churned,
  round(100.0 * count(*) filter (where prev_active and not was_active) / nullif(count(*) filter (where prev_active), 0), 1) as churn_pct,
  round(sum(mrr) filter (where prev_active and not was_active), 2)      as churned_mrr,
  round(sum(mrr) filter (where prev_active), 2)                         as active_start_mrr
from with_prev
where month >= date_trunc('month', now() - interval '11 months')
group by grouping sets ((segment, month), (month))
order by segment, month;

-- Highest-value, most-winnable losses to work first.
create or replace view marts.save_list as
select
  cc.customer_id,
  coalesce(c.display_name, '(unnamed)')       as customer,
  c.primary_phone_e164                        as phone,
  cc.segment,
  cc.service_bucket,
  cc.cleaner_name,
  cc.reason,
  cc.last_completed,
  (now()::date - cc.last_completed::date)      as days_since_last,
  cc.mrr
from marts.customer_churn cc
left join core.customer c on c.customer_id = cc.customer_id
where cc.status = 'churned'
  and cc.mrr > 0
  and cc.last_completed >= now() - interval '6 months'   -- still realistically winnable
order by cc.mrr desc, cc.last_completed desc;
