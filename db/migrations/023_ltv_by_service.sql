-- Lifetime value (LTV) by service type.
--
-- Population: every customer with recurring jobs (i.e. everyone in
-- marts.customer_churn), bucketed by their service cadence.
--
-- LTV here is REALIZED lifetime value: the total revenue a customer has
-- actually generated across all their completed visits to date. It's the
-- honest, concrete number ("this cadence has paid us $X on average"). Note it
-- understates still-active customers, who will keep paying -- so read it as a
-- floor, and use median alongside average since a few commercial accounts skew
-- the mean.
--
-- Service buckets with fewer than 3 customers (one-off cadences, data quirks)
-- are rolled into 'Other' so the table isn't dominated by single-customer
-- outliers.

create or replace view marts.ltv_by_service as
with cust as (
  select hcp_customer_id, service_bucket, mrr, status, first_completed, last_completed
  from marts.customer_churn
),
rev as (
  select hcp_customer_id,
    count(*)                          as visits,
    round(sum(total_amount) / 100.0, 2) as total_revenue
  from raw.hcp_jobs
  where work_status in ('complete rated', 'complete unrated')
  group by 1
),
joined as (
  select
    c.hcp_customer_id,
    c.service_bucket,
    c.mrr,
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
    case when count(*) over (partition by service_bucket) >= 3
         then service_bucket else 'Other' end as service_bucket,
    mrr, visits, total_revenue, tenure_months
  from joined
)
select
  service_bucket,
  count(*)                                                                 as customers,
  round(avg(total_revenue))                                                as avg_ltv,
  round(percentile_cont(0.5) within group (order by total_revenue))        as median_ltv,
  round(avg(visits), 1)                                                     as avg_visits,
  round(avg(mrr))                                                          as avg_mrr,
  round(avg(tenure_months), 1)                                             as avg_tenure_months,
  round(sum(total_revenue))                                                as total_ltv
from bucketed
group by 1
order by customers desc;
