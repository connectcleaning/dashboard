-- Make the churn / retention / LTV aggregates segment-aware.
--
-- Each view now carries a `segment` column and, via GROUP BY GROUPING SETS,
-- emits one set of rows per segment ('House Cleaning', 'Commercial') plus an
-- 'All' roll-up row set. The dashboard's segment toggle just filters rows to
-- the selected segment, keeping every rate/aggregate computed correctly in SQL.

-- ── churn_by_service (feeds the Active Recurring / Active MRR tiles) ───────────
drop view if exists marts.churn_by_service cascade;
create view marts.churn_by_service as
select
  coalesce(segment, 'All')                                             as segment,
  service_bucket,
  count(*) filter (where status in ('active','churned'))              as recurring_customers,
  count(*) filter (where status = 'churned')                          as churned_customers,
  round(100.0 * count(*) filter (where status = 'churned')
    / nullif(count(*) filter (where status in ('active','churned')), 0), 1) as churn_pct,
  round(sum(mrr) filter (where status = 'churned'), 2)               as churned_mrr,
  round(sum(mrr) filter (where status = 'active'), 2)                as active_mrr
from marts.customer_churn
group by grouping sets ((segment, service_bucket), (service_bucket))
order by segment, churn_pct desc nulls last;

-- ── monthly_churn_rate ────────────────────────────────────────────────────────
drop view if exists marts.monthly_churn_rate cascade;
create view marts.monthly_churn_rate as
with months as (
  select generate_series(
    date_trunc('month', now() - interval '11 months'),
    date_trunc('month', now()),
    '1 month'::interval
  ) as month
),
cust as (
  select hcp_customer_id, segment, period_days, mrr, next_scheduled
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
    c.hcp_customer_id, c.segment, c.period_days, c.mrr, c.next_scheduled, m.month,
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
  coalesce(segment, 'All')                                              as segment,
  month::text,
  count(*) filter (where prev_active)                                   as active_start,
  count(*) filter (where prev_active and not was_active)                as churned,
  round(100.0 * count(*) filter (where prev_active and not was_active)
    / nullif(count(*) filter (where prev_active), 0), 1)               as churn_pct,
  round(sum(mrr) filter (where prev_active and not was_active), 2)      as churned_mrr
from with_prev
where month >= date_trunc('month', now() - interval '11 months')
group by grouping sets ((segment, month), (month))
order by segment, month;

-- ── _churn_window_state gains segment; window aggregates roll up ──────────────
drop view if exists marts._churn_window_state cascade;
create view marts._churn_window_state as
with cust as (
  select hcp_customer_id, segment, cleaner_id, cleaner_name, service_bucket, period_days, mrr
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
  hcp_customer_id, segment, cleaner_id, cleaner_name, service_bucket, period_days, mrr,
  (last_now is not null
     and last_now >= now() - make_interval(days => (2 * period_days)::int)) as active_now,
  (last_at_start is not null
     and last_at_start >= now() - interval '90 days' - make_interval(days => (2 * period_days)::int)) as active_at_start
from state;

drop view if exists marts.churn_window_by_subcontractor cascade;
create view marts.churn_window_by_subcontractor as
select
  coalesce(segment, 'All')                                                  as segment,
  cleaner_id,
  cleaner_name,
  count(*) filter (where active_now)                                        as active_customers,
  count(*) filter (where active_at_start)                                   as base_customers,
  count(*) filter (where active_at_start and not active_now)                as churned_customers,
  round(100.0 * count(*) filter (where active_at_start and not active_now)
    / nullif(count(*) filter (where active_at_start), 0), 1)               as churn_pct,
  round(sum(mrr) filter (where active_at_start and not active_now), 2)      as churned_mrr
from marts._churn_window_state
group by grouping sets ((segment, cleaner_id, cleaner_name), (cleaner_id, cleaner_name))
having count(*) filter (where active_at_start) > 0
order by segment, churn_pct desc nulls last;

drop view if exists marts.churn_window_by_service cascade;
create view marts.churn_window_by_service as
select
  coalesce(segment, 'All')                                                  as segment,
  service_bucket,
  count(*) filter (where active_now)                                        as active_customers,
  count(*) filter (where active_at_start)                                   as base_customers,
  count(*) filter (where active_at_start and not active_now)                as churned_customers,
  round(100.0 * count(*) filter (where active_at_start and not active_now)
    / nullif(count(*) filter (where active_at_start), 0), 1)               as churn_pct,
  round(sum(mrr) filter (where active_at_start and not active_now), 2)      as churned_mrr
from marts._churn_window_state
group by grouping sets ((segment, service_bucket), (service_bucket))
having count(*) filter (where active_at_start) > 0
order by segment, churn_pct desc nulls last;

-- ── retention_curve (blended survival curve, per segment + All) ────────────────
drop view if exists marts.retention_curve cascade;
create view marts.retention_curve as
with base as (
  select hcp_customer_id, segment, period_days, mrr,
    date_trunc('month', first_completed) as cohort_month,
    last_completed + make_interval(days => (2 * period_days)::int) as active_until
  from marts.customer_churn
  where status <> 'seasonal'
    and first_completed is not null
    and last_completed is not null
),
offsets as (select generate_series(0, 11) as n),
grid as (
  select b.*, o.n,
    (b.cohort_month + make_interval(months => o.n) + interval '1 month - 1 second') as as_of
  from base b cross join offsets o
),
obs as (
  select segment, n, mrr,
    (greatest(active_until, cohort_month + interval '1 month - 1 second') >= as_of) as retained
  from grid
  where as_of <= now()
)
select
  coalesce(segment, 'All')                                                  as segment,
  n                                                                        as months_since_start,
  count(*)                                                                 as customers_observed,
  round(100.0 * count(*) filter (where retained) / nullif(count(*), 0), 1) as retention_pct,
  round(sum(mrr) filter (where retained), 2)                               as retained_mrr
from obs
group by grouping sets ((segment, n), (n))
order by segment, months_since_start;

-- ── ltv_by_service (per segment + All) ────────────────────────────────────────
drop view if exists marts.ltv_by_service cascade;
create view marts.ltv_by_service as
with cust as (
  select hcp_customer_id, segment, service_bucket, mrr, first_completed, last_completed
  from marts.customer_churn
),
rev as (
  select hcp_customer_id,
    count(*)                            as visits,
    round(sum(total_amount) / 100.0, 2) as total_revenue
  from raw.hcp_jobs
  where work_status in ('complete rated', 'complete unrated')
  group by 1
),
joined as (
  select
    c.hcp_customer_id, c.segment, c.service_bucket, c.mrr,
    coalesce(r.visits, 0)        as visits,
    coalesce(r.total_revenue, 0) as total_revenue,
    case when c.first_completed is not null and c.last_completed is not null
      then extract(epoch from (c.last_completed - c.first_completed)) / 2629800.0
    end as tenure_months
  from cust c
  left join rev r on r.hcp_customer_id = c.hcp_customer_id
),
bucketed as (
  select
    segment,
    case when count(*) over (partition by segment, service_bucket) >= 3
         then service_bucket else 'Other' end as service_bucket,
    mrr, visits, total_revenue, tenure_months
  from joined
)
select
  coalesce(segment, 'All')                                                 as segment,
  service_bucket,
  count(*)                                                                 as customers,
  round(avg(total_revenue))                                                as avg_ltv,
  round(percentile_cont(0.5) within group (order by total_revenue))        as median_ltv,
  round(avg(visits), 1)                                                     as avg_visits,
  round(avg(mrr))                                                          as avg_mrr,
  round(avg(tenure_months), 1)                                             as avg_tenure_months,
  round(sum(total_revenue))                                                as total_ltv
from bucketed
group by grouping sets ((segment, service_bucket), (service_bucket))
order by segment, customers desc;
