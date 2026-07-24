-- Make channel MRR churn-aware: show recurring revenue we STILL have, not what
-- we've since lost.
--
-- channel_new_mrr summed every acquired customer's MRR regardless of status, so
-- a channel's "New MRR" included customers who have since churned — MRR we no
-- longer have. Split it: new_mrr now = ACTIVE MRR (still recurring), plus a
-- churned_mrr column (lost) so channel retention is visible. Customers are
-- collapsed to one row per customer_id first (merged HCP records), preferring
-- their active row, so counts and MRR aren't double-counted.

create or replace view marts.channel_new_mrr as
with cust as (
  select distinct on (cc.customer_id)
    cc.customer_id, cc.status, cc.mrr
  from marts.customer_churn cc
  order by cc.customer_id,
    case cc.status when 'active' then 0 when 'pending' then 1 else 2 end,
    cc.mrr desc nulls last
)
select
  ll.acquired_month                                                    as month,
  ll.channel,
  count(*) filter (where c.status in ('active','pending'))             as recurring_customers,
  round(sum(c.mrr) filter (where c.status = 'active'), 2)              as new_mrr,        -- = active MRR (kept name for compat)
  round(sum(c.mrr) filter (where c.status = 'active'), 2)              as active_mrr,
  round(sum(c.mrr) filter (where c.status = 'churned'), 2)             as churned_mrr,
  count(*) filter (where c.status = 'churned')                        as churned_customers
from marts.fact_lead_ltv ll
join cust c on c.customer_id = ll.customer_id
where ll.channel in ('Google LSA', 'Meta Ads', 'Google Ads') and ll.job_count > 0
group by 1, 2;
