-- Keep irregular-cadence customers (Vacation Rental, period_days is null) out of
-- the cadence-based retention curve. Their "active_until" can't be derived from
-- a 2x-cadence rule, so including them distorts the blended survival curve
-- (they'd read retained at month 0 then drop to 0). Retention for Vacation
-- Rental would need its own recency-based definition; excluded here for now.

create or replace view marts.retention_curve as
with base as (
  select hcp_customer_id, segment, period_days, mrr,
    date_trunc('month', first_completed) as cohort_month,
    last_completed + make_interval(days => (2 * period_days)::int) as active_until
  from marts.customer_churn
  where status <> 'seasonal'
    and period_days is not null
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
