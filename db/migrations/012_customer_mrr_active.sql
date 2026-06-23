-- Filter out expired recurring schedules from customer_mrr.
-- Some RRULE entries include an UNTIL date (e.g. UNTIL=20250130T160000Z) for
-- customers who cancelled. We exclude those so MRR only reflects active schedules.

create or replace view marts.customer_mrr as
with recurring as (
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
    coalesce(nullif(substring(rrule from 'INTERVAL=([0-9]+)'), '')::numeric, 1) as intvl,
    -- Extract UNTIL date if present: format is UNTIL=YYYYMMDDTHHmmssZ
    nullif(substring(rrule from 'UNTIL=(\d{8}T\d{6}Z)'), '')              as until_str
  from latest
),
parsed_until as (
  select
    *,
    -- Parse UNTIL string into a timestamp for comparison
    case when until_str is not null
      then to_timestamp(until_str, 'YYYYMMDD"T"HH24MISS"Z"') at time zone 'UTC'
      else null
    end as until_ts
  from parsed
),
active as (
  -- Keep only schedules with no UNTIL date, or UNTIL date in the future
  select * from parsed_until
  where until_ts is null or until_ts > now()
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
  from active
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

-- Rebuild dependent view (unchanged logic, just depends on customer_mrr)
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
