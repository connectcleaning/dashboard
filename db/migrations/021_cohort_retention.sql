-- Cohort retention curves.
--
-- Period churn rate (marts.monthly_churn_rate) answers "how fast are we bleeding
-- right now." Cohort retention answers the complementary question "how long does
-- a customer last" -- which is the right way to express "practically everyone
-- eventually cancels": as a survival curve that decays over tenure, read as a
-- median lifetime and a shape, not as a single runaway percentage.
--
-- Cohort = calendar month of a customer's FIRST completed visit. For each
-- months-since-start offset N, retention = the share of that cohort still active
-- N months later. A customer is treated as active through
--   active_until = last_completed + 2x cadence
-- (their coverage extends 2x their cadence past their last real visit before we
-- call them lapsed -- the same recency rule the rest of the churn model uses).
-- Everyone is retained through the end of their own signup month by definition
-- (you can't churn the month you were acquired), so every curve starts at 100%.
--
-- Right-censoring: a cohort only reports offset N once that offset has actually
-- elapsed (as_of <= now()), so young cohorts contribute only their early months
-- and don't drag the curve down artificially.

create or replace view marts.cohort_retention as
with base as (
  select
    hcp_customer_id,
    period_days,
    mrr,
    first_completed,
    date_trunc('month', first_completed) as cohort_month,
    -- active through 2x cadence past the most recent completed visit
    last_completed + make_interval(days => (2 * period_days)::int) as active_until
  from marts.customer_churn
  where status <> 'seasonal'
    and first_completed is not null
    and last_completed is not null
),
offsets as (
  select generate_series(0, 11) as n
),
grid as (
  select b.*, o.n,
    (b.cohort_month + make_interval(months => o.n) + interval '1 month - 1 second') as as_of
  from base b
  cross join offsets o
),
observable as (
  select
    cohort_month,
    n,
    hcp_customer_id,
    mrr,
    -- retained if still covered as of this offset; floored so month 0 = 100%
    (greatest(active_until, cohort_month + interval '1 month - 1 second') >= as_of) as retained
  from grid
  where as_of <= now()
)
select
  to_char(cohort_month, 'YYYY-MM')                                            as cohort,
  n                                                                          as months_since_start,
  count(*)                                                                   as cohort_observed,
  count(*) filter (where retained)                                           as retained,
  round(100.0 * count(*) filter (where retained) / nullif(count(*), 0), 1)   as retention_pct,
  round(sum(mrr) filter (where retained), 2)                                 as retained_mrr
from observable
group by 1, 2
order by 1, 2;

-- Blended survival curve across all cohorts: the single "how long do customers
-- last" curve. Weighted by how many customers have actually reached each offset.
create or replace view marts.retention_curve as
select
  months_since_start,
  sum(cohort_observed)                                                       as customers_observed,
  round(100.0 * sum(retained) / nullif(sum(cohort_observed), 0), 1)          as retention_pct,
  round(sum(retained_mrr), 2)                                                as retained_mrr
from marts.cohort_retention
group by 1
order by 1;
