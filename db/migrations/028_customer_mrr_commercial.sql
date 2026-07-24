-- Fix MRR under-counting in channel ROI (LSA / Facebook).
--
-- marts.customer_mrr computed MRR from the recurring-job template
-- (visit_price * 30.44 / period_days). Commercial accounts are booked as
-- multiple $0-priced recurring series, so this returned $0 for them — hiding
-- ~$13k/mo of real commercial MRR from the channel ROI (e.g. Trang / The Monarch
-- showed $0 despite thousands/mo, attributed to Google LSA).
--
-- marts.customer_churn already carries the corrected, segment-aware MRR
-- (commercial derived from actual billed-visit run-rate), so source mrr from
-- there. Every consumer — the cohort drill-down and channel_new_mrr — then gets
-- the true number. Output columns are unchanged, so dependents stay valid.

create or replace view marts.customer_mrr as
with recurring as (
  select j.hcp_customer_id, j.scheduled_start, j.created_at,
    round(j.total_amount / 100.0, 2) as visit_price,
    j.raw_json ->> 'recurrence_rule' as rrule
  from raw.hcp_jobs j
  where coalesce(j.raw_json ->> 'recurrence_rule', '') <> ''
),
latest as (
  select distinct on (hcp_customer_id) hcp_customer_id, visit_price, rrule
  from recurring
  order by hcp_customer_id, scheduled_start desc nulls last, created_at desc nulls last
),
parsed as (
  select hcp_customer_id, visit_price, rrule,
    substring(rrule, 'FREQ=([A-Z]+)') as freq,
    coalesce(nullif(substring(rrule, 'INTERVAL=([0-9]+)'), '')::numeric, 1) as intvl
  from latest
),
calc as (
  select *,
    case freq
      when 'WEEKLY'  then 7::numeric     * intvl
      when 'DAILY'   then 1::numeric     * intvl
      when 'MONTHLY' then 30.44          * intvl
      when 'YEARLY'  then 365::numeric   * intvl
    end as period_days
  from parsed
)
select
  l.customer_id,
  c.hcp_customer_id,
  c.visit_price,
  c.rrule,
  c.freq,
  c.intvl::integer as interval,
  coalesce(cc.mrr, round(c.visit_price * 30.44 / nullif(c.period_days, 0), 2)) as mrr
from calc c
join marts._hcp_to_customer l on l.hcp_customer_id = c.hcp_customer_id
left join marts.customer_churn cc on cc.customer_id = l.customer_id
where c.period_days is not null;
