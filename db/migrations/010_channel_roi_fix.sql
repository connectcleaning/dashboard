-- Fix: Facebook ROI/spend was always blank because the spend side labels Meta
-- spend as "Meta Ads" (from the QBO category) while leads normalize to
-- "Facebook". The channel join never matched, so Facebook showed LTV but no
-- spend and no ROI. Align "Meta Ads" → "Facebook" in the join.

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
      and case when s.channel = 'Meta Ads' then 'Facebook' else s.channel end = ll.channel
where ll.acquired_month is not null
  and ll.channel in ('Google LSA', 'Facebook', 'Google Ads')
group by ll.acquired_month, ll.channel, s.spend
order by ll.acquired_month, ll.channel;
