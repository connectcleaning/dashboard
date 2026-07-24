-- Projected monthly revenue: what a month will actually bill once the
-- lump-billed recurring accounts are invoiced.
--
-- Why we need it: house-cleaning and one-off jobs carry a price on every job,
-- so summing job amounts gives the real number. But commercial and vacation-
-- rental accounts are invoiced as a lump — the whole month's revenue is added
-- to ONE visit (usually the first or second of the month) and the rest show
-- $0. Early in the month, before that lump is entered, those accounts read $0
-- even though the work is scheduled and will be billed. Example: The Carlysle
-- (2x/week commercial) shows eight $0 visits in July until the ~$2.5k lump is
-- added at invoicing time.
--
-- Fix: for lump-billed segments (Commercial, Vacation Rental) take the GREATER
-- of what's actually billed this month and the account's expected monthly
-- run-rate (marts.customer_churn.mrr). If the lump is already entered, actual
-- wins (real number); if the account still shows $0, the run-rate fills it in.
-- Per-job-priced work (House Cleaning, one-offs) is always counted at actual.
-- Cancelled jobs (user/pro canceled, needs scheduling) are excluded entirely.

create or replace view marts.projected_revenue_by_month as
with churn as (
  -- one segment + run-rate per HCP customer (customer_churn can carry >1 row
  -- for merged records; prefer the highest-MRR row)
  select distinct on (cc.hcp_customer_id)
    cc.hcp_customer_id, cc.segment, cc.mrr
  from marts.customer_churn cc
  order by cc.hcp_customer_id, cc.mrr desc nulls last
),
per_cust_month as (
  select
    date_trunc('month', j.scheduled_start) as month,
    j.hcp_customer_id,
    sum(j.total_amount) / 100.0 as actual
  from raw.hcp_jobs j
  where j.work_status in ('complete rated', 'complete unrated', 'in progress', 'scheduled')
    and j.scheduled_start is not null
  group by 1, 2
),
proj as (
  select
    p.month,
    p.actual,
    case
      when c.segment in ('Commercial', 'Vacation Rental')
        then greatest(p.actual, coalesce(c.mrr, 0))
      else p.actual
    end as projected
  from per_cust_month p
  left join churn c on c.hcp_customer_id = p.hcp_customer_id
)
select
  month::date                                as month,
  round(sum(actual), 2)                      as actual_revenue,
  round(sum(projected), 2)                   as projected_revenue,
  round(sum(projected) - sum(actual), 2)     as uninvoiced_fill
from proj
group by 1
order by 1;
