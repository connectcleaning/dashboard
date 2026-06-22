-- Recurring revenue (MRR) per customer, derived from HouseCall Pro's recurrence
-- rule on scheduled jobs. Because recurring visits are booked at sale time, this
-- gives us each customer's MRR the moment a deal closes — no waiting for cadence
-- to build up, no manual data entry.
--
-- HCP stores an iCal RRULE on recurring jobs, e.g.
--   FREQ=WEEKLY;INTERVAL=4;BYDAY=TU  -> every 4 weeks
-- We parse FREQ + INTERVAL into a period length and annualize the visit price.

create or replace view marts.customer_mrr as
with recurring as (
  -- every job that carries a recurrence rule (the recurring visits, not one-offs)
  select
    j.hcp_customer_id,
    j.scheduled_start,
    j.created_at,
    round(j.total_amount / 100.0, 2)        as visit_price,
    j.raw_json->>'recurrence_rule'          as rrule
  from raw.hcp_jobs j
  where coalesce(j.raw_json->>'recurrence_rule', '') <> ''
),
latest as (
  -- current plan = the customer's most recently scheduled recurring job
  select distinct on (hcp_customer_id)
    hcp_customer_id, visit_price, rrule
  from recurring
  order by hcp_customer_id, scheduled_start desc nulls last, created_at desc nulls last
),
parsed as (
  select
    hcp_customer_id,
    visit_price,
    rrule,
    substring(rrule from 'FREQ=([A-Z]+)')                                  as freq,
    coalesce(nullif(substring(rrule from 'INTERVAL=([0-9]+)'), '')::numeric, 1) as intvl
  from latest
),
calc as (
  select
    *,
    case freq
      when 'WEEKLY'  then 7      * intvl
      when 'DAILY'   then 1      * intvl
      when 'MONTHLY' then 30.44  * intvl
      when 'YEARLY'  then 365    * intvl
    end as period_days
  from parsed
)
select
  l.customer_id,
  c.hcp_customer_id,
  c.visit_price,
  c.rrule,
  c.freq,
  c.intvl::int                                          as interval,
  round(c.visit_price * 30.44 / nullif(c.period_days, 0), 2) as mrr
from calc c
join marts._hcp_to_customer l on l.hcp_customer_id = c.hcp_customer_id
where c.period_days is not null;

-- New MRR booked per acquisition channel per cohort month.
-- Answers: "we spent $X on LSA last month — how much recurring revenue did it book?"
create or replace view marts.channel_new_mrr as
select
  ll.acquired_month                       as month,
  ll.channel,
  count(m.customer_id)                    as recurring_customers,
  round(sum(m.mrr), 2)                    as new_mrr
from marts.fact_lead_ltv ll
join marts.customer_mrr m on m.customer_id = ll.customer_id
where ll.channel in ('Google LSA', 'Meta Ads', 'Google Ads')
group by 1, 2;
