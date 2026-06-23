-- Fix channel_new_mrr to only count customers who actually converted (job_count > 0),
-- matching the drill-down filter in the cohort API.

create or replace view marts.channel_new_mrr as
select
  ll.acquired_month                       as month,
  ll.channel,
  count(m.customer_id)                    as recurring_customers,
  round(sum(m.mrr), 2)                    as new_mrr
from marts.fact_lead_ltv ll
join marts.customer_mrr m on m.customer_id = ll.customer_id
where ll.channel in ('Google LSA', 'Meta Ads', 'Google Ads')
  and ll.job_count > 0
group by 1, 2;
