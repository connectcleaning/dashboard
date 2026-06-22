-- Refine ad-spend detection now that we can see the real chart of accounts.
-- Connect Cleaning uses an "Advertising & marketing" parent with clean
-- sub-accounts, so we match on category exactly rather than guessing on
-- vendor names (which wrongly caught e.g. Google Workspace subscriptions).
--
-- "Ad spend" = paid digital ad channels only: Google LSA, Meta Ads, Google Ads.

create or replace view marts.ad_spend as
select month, sum(amount) as ad_spend
from marts.fact_spend
where month is not null
  and (
    category ilike '%Google LSA%'
    or category ilike '%Meta Ads%'
    or category ilike '%Google Ads%'
  )
group by 1
order by 1;

-- Ad spend broken out by channel per month.
create or replace view marts.ad_spend_by_channel as
select
  month,
  case
    when category ilike '%Google LSA%' then 'Google LSA'
    when category ilike '%Meta Ads%'   then 'Meta Ads'
    when category ilike '%Google Ads%' then 'Google Ads'
  end as channel,
  sum(amount) as spend
from marts.fact_spend
where month is not null
  and (
    category ilike '%Google LSA%'
    or category ilike '%Meta Ads%'
    or category ilike '%Google Ads%'
  )
group by 1, 2
order by 1, 3 desc;
