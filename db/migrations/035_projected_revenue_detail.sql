-- Per-account backup for the Projected Revenue KPI's "not yet invoiced" figure.
--
-- Lists, per month, each lump-billed account (Commercial, Vacation Rental)
-- with a non-cancelled job that month: how much is actually billed so far,
-- the expected monthly run-rate, and the shortfall being filled in
-- (uninvoiced_fill = greatest(run-rate - actual, 0)). Summing uninvoiced_fill
-- for a month equals that month's uninvoiced_fill in
-- marts.projected_revenue_by_month. Accounts whose lump is already entered
-- show fill = 0, so the office can see exactly what's outstanding.

create or replace view marts.projected_revenue_detail as
with churn as (
  select distinct on (cc.hcp_customer_id)
    cc.hcp_customer_id, cc.customer_id, cc.segment, cc.service_bucket, cc.mrr
  from marts.customer_churn cc
  order by cc.hcp_customer_id, cc.mrr desc nulls last
),
per_cust_month as (
  select
    date_trunc('month', j.scheduled_start) as month,
    j.hcp_customer_id,
    count(*)                          as visits,
    sum(j.total_amount) / 100.0       as actual
  from raw.hcp_jobs j
  where j.work_status in ('complete rated', 'complete unrated', 'in progress', 'scheduled')
    and j.scheduled_start is not null
  group by 1, 2
)
select
  p.month::date                                        as month,
  coalesce(cust.display_name, '(unnamed)')             as customer,
  c.segment,
  c.service_bucket,
  p.visits,
  round(p.actual, 2)                                   as actual_billed,
  round(c.mrr, 2)                                      as expected_mrr,
  round(greatest(coalesce(c.mrr, 0) - p.actual, 0), 2) as uninvoiced_fill
from per_cust_month p
join churn c on c.hcp_customer_id = p.hcp_customer_id
left join core.customer cust on cust.customer_id = c.customer_id
where c.segment in ('Commercial', 'Vacation Rental')
order by p.month, uninvoiced_fill desc, expected_mrr desc;
