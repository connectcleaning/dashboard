-- Rename the Meta lead channel from "Facebook" to "Meta Ads" so it (a) matches
-- the QBO "Meta Ads" spend category exactly — fixing the blank Facebook
-- spend/ROI — and (b) accurately covers all FB/IG ad placements.

-- Normalize Meta-sourced opportunities to "Meta Ads".
create or replace view marts.fact_lead_ltv as
with source_normalized as (
  select
    opportunity_id,
    customer_id,
    created_at,
    case
      when lower(source) in ('facebook', 'facebook form', 'ig', 'instagram') then 'Meta Ads'
      when lower(source) = 'google lsa'  then 'Google LSA'
      when lower(source) = 'google ads'  then 'Google Ads'
      when source is null or source = '' or lower(source) = 'none' then 'Unattributed'
      else source
    end as channel
  from marts.fact_opportunity
),
first_opp as (
  select distinct on (customer_id)
    customer_id,
    channel,
    created_at as acquired_at
  from source_normalized
  where customer_id is not null
  order by customer_id, created_at asc
),
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

-- Spend and lead channels now share the "Meta Ads" label → plain join.
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
      and s.channel = ll.channel
where ll.acquired_month is not null
  and ll.channel in ('Google LSA', 'Meta Ads', 'Google Ads')
group by ll.acquired_month, ll.channel, s.spend
order by ll.acquired_month, ll.channel;
