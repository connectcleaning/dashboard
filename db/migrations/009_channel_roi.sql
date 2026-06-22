-- Per-channel ROI attribution.
-- Normalizes GHL opportunity source → channel, takes the earliest opportunity
-- per customer as their acquisition channel, then joins to HCP job revenue (LTV).

-- Normalized channel labels from raw GHL source values.
create or replace view marts.fact_lead_ltv as
with source_normalized as (
  select
    opportunity_id,
    customer_id,
    created_at,
    case
      when lower(source) in ('facebook', 'facebook form', 'ig', 'instagram') then 'Facebook'
      when lower(source) = 'google lsa'  then 'Google LSA'
      when lower(source) = 'google ads'  then 'Google Ads'
      when source is null or source = '' or lower(source) = 'none' then 'Unattributed'
      else source
    end as channel
  from marts.fact_opportunity
),
-- First opportunity per customer = acquisition channel
first_opp as (
  select distinct on (customer_id)
    customer_id,
    channel,
    created_at as acquired_at
  from source_normalized
  where customer_id is not null
  order by customer_id, created_at asc
),
-- Lifetime revenue per customer from completed HCP jobs
customer_ltv as (
  select
    customer_id,
    sum(revenue)      as ltv,
    count(*)          as job_count,
    min(job_date)     as first_job_date,
    max(job_date)     as last_job_date
  from marts.fact_job
  where job_date is not null
  group by customer_id
)
select
  fo.customer_id,
  fo.channel,
  fo.acquired_at,
  date_trunc('month', fo.acquired_at) as acquired_month,
  coalesce(cl.ltv, 0)                 as ltv,
  coalesce(cl.job_count, 0)           as job_count,
  cl.first_job_date,
  cl.last_job_date
from first_opp fo
left join customer_ltv cl using (customer_id);

-- Channel-level aggregates: leads acquired, revenue generated, avg LTV.
create or replace view marts.channel_summary as
select
  channel,
  count(*)                              as leads,
  count(*) filter (where job_count > 0) as converted,
  round(count(*) filter (where job_count > 0)::numeric / nullif(count(*), 0) * 100, 1) as conversion_pct,
  round(sum(ltv), 2)                    as total_revenue,
  round(avg(ltv) filter (where job_count > 0), 2) as avg_ltv
from marts.fact_lead_ltv
group by channel
order by total_revenue desc nulls last;

-- Monthly per-channel ROI: leads acquired that month × their LTV vs that month's ad spend.
-- Note: LTV accumulates over time, so revenue here is total LTV of cohort acquired in month.
create or replace view marts.channel_roi_by_month as
select
  ll.acquired_month                                     as month,
  ll.channel,
  count(*)                                              as leads,
  round(sum(ll.ltv), 2)                                 as cohort_ltv,
  s.spend                                               as channel_spend,
  case when s.spend > 0
       then round(sum(ll.ltv) / s.spend, 2)
  end                                                   as roi
from marts.fact_lead_ltv ll
left join marts.ad_spend_by_channel s
       on s.month = ll.acquired_month
      -- Spend labels Meta as "Meta Ads" (QBO category); leads normalize to
      -- "Facebook". Align the two so Facebook ROI picks up Meta spend.
      and case when s.channel = 'Meta Ads' then 'Facebook' else s.channel end = ll.channel
where ll.acquired_month is not null
  and ll.channel in ('Google LSA', 'Facebook', 'Google Ads')
group by ll.acquired_month, ll.channel, s.spend
order by ll.acquired_month, ll.channel;
