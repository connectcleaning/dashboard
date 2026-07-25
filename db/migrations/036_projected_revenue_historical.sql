-- Rebase Projected Revenue on actual jobs + historical commercial invoices.
--
-- Change from the run-rate approach:
--   * Base = actual billed on non-cancelled jobs (completed / in progress /
--     scheduled), same as before.
--   * A Commercial account that still shows $0 this month (lump-billed: the
--     month's revenue is dropped on one visit at invoicing time) is filled
--     from the account's OWN recent invoices — the average of its actual
--     monthly billed totals over the last 6 completed months, counting only
--     months that were actually invoiced (billed > 0). Grounded in what they
--     really bill, not a smoothed run-rate.
--   * A Commercial account that already has ANY revenue entered this month is
--     trusted at its actual — we never top real job revenue up to an average
--     (that's what "just base it on the jobs" means; per-visit accounts like
--     Trang keep accruing real dollars).
--   * Vacation Rental / Airbnb get NO projection. If a stay is scheduled it
--     already carries its price (counted in actual); if it isn't scheduled we
--     don't want to invent revenue for it.

-- Per-commercial-customer typical monthly invoice: average of recent months
-- that were actually invoiced. Excludes the current (possibly un-invoiced)
-- month; months still showing $0 fall out via the billed > 0 filter.
create or replace view marts._commercial_hist_invoice as
select
  hcp_customer_id,
  round(avg(monthly_billed), 2) as hist_monthly_invoice,
  count(*)                      as invoice_months
from (
  select
    j.hcp_customer_id,
    date_trunc('month', (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz) as m,
    sum(j.total_amount) / 100.0 as monthly_billed
  from raw.hcp_jobs j
  where j.work_status in ('complete rated', 'complete unrated')
    and (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz >= date_trunc('month', now()) - interval '6 months'
    and (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz <  date_trunc('month', now())
  group by 1, 2
  having sum(j.total_amount) > 0
) m
group by 1;

create or replace view marts.projected_revenue_by_month as
with churn as (
  select distinct on (cc.hcp_customer_id) cc.hcp_customer_id, cc.segment
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
      when c.segment = 'Commercial' and p.actual < 1
        then coalesce(h.hist_monthly_invoice, 0)   -- $0 lump account: fill from history
      else p.actual   -- real job revenue (any segment) is trusted as-is
    end as projected
  from per_cust_month p
  left join churn c on c.hcp_customer_id = p.hcp_customer_id
  left join marts._commercial_hist_invoice h on h.hcp_customer_id = p.hcp_customer_id
)
select
  month::date                                as month,
  round(sum(actual), 2)                      as actual_revenue,
  round(sum(projected), 2)                   as projected_revenue,
  round(sum(projected) - sum(actual), 2)     as uninvoiced_fill
from proj
group by 1
order by 1;

-- Per-account backup for the current month: only the Commercial lump accounts,
-- since they are the only thing now projected. (dropped first: a column was
-- renamed expected_mrr -> expected_invoice, which create-or-replace can't do.)
drop view if exists marts.projected_revenue_detail;
create view marts.projected_revenue_detail as
with churn as (
  select distinct on (cc.hcp_customer_id)
    cc.hcp_customer_id, cc.customer_id, cc.segment, cc.service_bucket
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
  p.month::date                                                    as month,
  coalesce(cust.display_name, '(unnamed)')                         as customer,
  c.segment,
  c.service_bucket,
  p.visits,
  round(p.actual, 2)                                               as actual_billed,
  round(coalesce(h.hist_monthly_invoice, 0), 2)                    as expected_invoice,
  case when p.actual < 1 then round(coalesce(h.hist_monthly_invoice, 0), 2) else 0 end as uninvoiced_fill
from per_cust_month p
join churn c on c.hcp_customer_id = p.hcp_customer_id
left join marts._commercial_hist_invoice h on h.hcp_customer_id = p.hcp_customer_id
left join core.customer cust on cust.customer_id = c.customer_id
where c.segment = 'Commercial'
order by p.month, uninvoiced_fill desc, expected_invoice desc;
