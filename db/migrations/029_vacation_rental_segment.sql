-- Add Vacation Rental (Airbnb) customers to customer_churn as a recurring segment.
--
-- Airbnb turnovers are booked per guest-stay (no recurrence rule), so they were
-- excluded from the recurring model entirely — invisible in MRR and channel ROI.
-- Identify them by job description ("Vacation Rental Cleaning" / "Airbnb
-- Turnover"). A customer counts as a recurring Vacation Rental when they have
-- >= 3 scheduled jobs and real revenue in the last 12 months (excludes one-off
-- cleans and the free partner account). MRR = last-12-month revenue averaged
-- over the months that actually had revenue. Active if cleaned within the last
-- 3 months, otherwise churned. period_days is null (irregular cadence), so the
-- cadence-based churn/retention views naturally skip them.
--
-- customer_mrr is also redefined to project straight off customer_churn, so the
-- corrected commercial MRR and the new Vacation Rental MRR both flow into the
-- channel ROI without any per-view changes.

create or replace view marts.customer_churn as
with
airbnb_ids as (
  select distinct hcp_customer_id
  from raw.hcp_jobs
  where raw_json->>'description' ilike any (array['%vacation rental%', '%airbnb%'])
),
airbnb_stats as (
  select j.hcp_customer_id,
    count(*) filter (where j.scheduled_start is not null) as scheduled_jobs,
    max((j.raw_json->'work_timestamps'->>'completed_at')::timestamptz) as last_completed,
    min((j.raw_json->'work_timestamps'->>'completed_at')::timestamptz) as first_completed,
    coalesce(sum(j.total_amount) filter (
      where j.work_status in ('complete rated', 'complete unrated')
        and (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz >= now() - interval '12 months'
    ), 0) / 100.0 as rev_12mo,
    count(distinct date_trunc('month', (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz)) filter (
      where (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz >= now() - interval '12 months'
    ) as active_months
  from raw.hcp_jobs j
  join airbnb_ids a on a.hcp_customer_id = j.hcp_customer_id
  group by 1
),
airbnb_cleaner as (
  select distinct on (j.hcp_customer_id)
    j.hcp_customer_id,
    j.raw_json->'assigned_employees'->0->>'id' as cleaner_id,
    trim(coalesce(j.raw_json->'assigned_employees'->0->>'first_name','') || ' ' ||
         coalesce(j.raw_json->'assigned_employees'->0->>'last_name','')) as cleaner_name
  from raw.hcp_jobs j
  join airbnb_ids a on a.hcp_customer_id = j.hcp_customer_id
  where j.work_status in ('complete rated', 'complete unrated')
    and jsonb_array_length(coalesce(j.raw_json->'assigned_employees','[]'::jsonb)) > 0
  order by j.hcp_customer_id, (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz desc nulls last
),
recurring as (
  select j.hcp_customer_id, j.scheduled_start, j.created_at,
    round(j.total_amount / 100.0, 2) as visit_price,
    j.raw_json->>'recurrence_rule' as rrule
  from raw.hcp_jobs j
  where coalesce(j.raw_json->>'recurrence_rule', '') <> ''
),
completed as (
  select hcp_customer_id, max((raw_json->'work_timestamps'->>'completed_at')::timestamptz) as last_completed
  from raw.hcp_jobs where work_status in ('complete rated', 'complete unrated') group by 1
),
first_completed as (
  select hcp_customer_id, min((raw_json->'work_timestamps'->>'completed_at')::timestamptz) as first_completed
  from raw.hcp_jobs where work_status in ('complete rated', 'complete unrated') group by 1
),
upcoming as (
  select hcp_customer_id, min(scheduled_start) filter (where scheduled_start > now()) as next_scheduled
  from recurring group by 1
),
latest as (
  select distinct on (hcp_customer_id) hcp_customer_id, visit_price, rrule
  from recurring order by hcp_customer_id, scheduled_start desc nulls last, created_at desc nulls last
),
parsed as (
  select hcp_customer_id, visit_price, rrule,
    substring(rrule from 'FREQ=([A-Z]+)') as freq,
    coalesce(nullif(substring(rrule from 'INTERVAL=([0-9]+)'), '')::numeric, 1) as intvl
  from latest
),
calc as (
  select *,
    case freq
      when 'WEEKLY' then 7 * intvl when 'DAILY' then 1 * intvl
      when 'MONTHLY' then 30.44 * intvl when 'YEARLY' then 365 * intvl end as period_days,
    case
      when freq = 'WEEKLY'  and intvl = 1 then 'Weekly'
      when freq = 'WEEKLY'  and intvl = 2 then 'Bi-weekly'
      when freq = 'WEEKLY'  and intvl = 4 then 'Every 4 weeks'
      when freq = 'WEEKLY'                then 'Every ' || intvl || ' weeks'
      when freq = 'MONTHLY' and intvl = 1 then 'Monthly'
      when freq = 'MONTHLY'               then 'Every ' || intvl || ' months'
      when freq = 'DAILY'                 then 'Every ' || intvl || ' days'
      when freq = 'YEARLY'                then 'Yearly'
      else coalesce(freq, 'Unknown')
    end as service_bucket
  from parsed
),
vkind as (
  select distinct on (hcp_customer_id) hcp_customer_id, raw_json->'customer'->>'kind' as kind
  from raw.hcp_jobs order by hcp_customer_id, created_at desc
),
vstats as (
  select hcp_customer_id, count(*) as vcnt, min(cat) as first_v, max(cat) as last_v, sum(amt) as total_rev
  from (
    select hcp_customer_id, (raw_json->'work_timestamps'->>'completed_at')::timestamptz as cat, total_amount / 100.0 as amt
    from raw.hcp_jobs
    where work_status in ('complete rated', 'complete unrated') and (raw_json->'work_timestamps'->>'completed_at') is not null
  ) x group by 1
),
eff as (
  select c.*, (k.kind = 'business') as is_commercial,
    case when k.kind = 'business' then 'Commercial' else 'House Cleaning' end as segment,
    vs.vcnt, vs.total_rev, extract(epoch from (vs.last_v - vs.first_v)) / 86400.0 as span_days
  from calc c
  left join vkind k on k.hcp_customer_id = c.hcp_customer_id
  left join vstats vs on vs.hcp_customer_id = c.hcp_customer_id
),
eff2 as (
  select *,
    (case when is_commercial and vcnt > 1 and span_days > 0 then span_days / (vcnt - 1) else period_days end)::numeric as eff_period_days,
    case when is_commercial and vcnt > 1 and span_days > 0 then round(total_rev * 30.44 / span_days, 2)
         else round(visit_price * 30.44 / nullif(period_days, 0), 2) end as eff_mrr,
    case when is_commercial and vcnt > 1 and span_days > 0 then
      case when span_days / (vcnt - 1) < 3 then '3x+ Weekly' when span_days / (vcnt - 1) < 5.5 then '2x Weekly'
           when span_days / (vcnt - 1) < 10 then 'Weekly' when span_days / (vcnt - 1) < 21 then 'Bi-weekly'
           when span_days / (vcnt - 1) < 45 then 'Monthly' else 'Occasional' end
      else service_bucket end as eff_bucket
  from eff
),
last_cleaner as (
  select distinct on (j.hcp_customer_id) j.hcp_customer_id,
    j.raw_json->'assigned_employees'->0->>'id' as cleaner_id,
    trim(coalesce(j.raw_json->'assigned_employees'->0->>'first_name','') || ' ' ||
         coalesce(j.raw_json->'assigned_employees'->0->>'last_name','')) as cleaner_name
  from raw.hcp_jobs j
  where j.work_status in ('complete rated', 'complete unrated')
    and jsonb_array_length(coalesce(j.raw_json->'assigned_employees','[]'::jsonb)) > 0
  order by j.hcp_customer_id, (j.raw_json->'work_timestamps'->>'completed_at')::timestamptz desc nulls last
),
cadence as (
  select
    l.customer_id, c.hcp_customer_id, c.eff_bucket as service_bucket, c.eff_period_days as period_days,
    lc.cleaner_id, coalesce(nullif(lc.cleaner_name,''), 'Unassigned') as cleaner_name,
    coalesce(cr.status, case
        when cp.last_completed is not null and cp.last_completed >= now() - make_interval(days => (2 * c.eff_period_days)::int) then 'active'
        when cp.last_completed is not null then 'churned'
        when u.next_scheduled is not null then 'pending'
        else 'churned' end) as status,
    cr.reason, cp.last_completed, fc.first_completed, u.next_scheduled, c.eff_mrr as mrr, c.segment
  from eff2 c
  join marts._hcp_to_customer l on l.hcp_customer_id = c.hcp_customer_id
  left join completed cp on cp.hcp_customer_id = c.hcp_customer_id
  left join first_completed fc on fc.hcp_customer_id = c.hcp_customer_id
  left join upcoming u on u.hcp_customer_id = c.hcp_customer_id
  left join last_cleaner lc on lc.hcp_customer_id = c.hcp_customer_id
  left join ops.churn_review cr on cr.hcp_customer_id = c.hcp_customer_id
  where c.period_days is not null
    and c.hcp_customer_id not in (select hcp_customer_id from airbnb_ids)
),
airbnb as (
  select
    l.customer_id, s.hcp_customer_id, 'Vacation Rental'::text as service_bucket, null::numeric as period_days,
    ac.cleaner_id, coalesce(nullif(ac.cleaner_name,''), 'Unassigned') as cleaner_name,
    (case when s.last_completed >= now() - interval '3 months' then 'active' else 'churned' end)::text as status,
    null::text as reason, s.last_completed, s.first_completed, null::timestamptz as next_scheduled,
    round(s.rev_12mo / nullif(s.active_months, 0), 2)::numeric as mrr,
    'Vacation Rental'::text as segment
  from airbnb_stats s
  join marts._hcp_to_customer l on l.hcp_customer_id = s.hcp_customer_id
  left join airbnb_cleaner ac on ac.hcp_customer_id = s.hcp_customer_id
  where s.scheduled_jobs >= 3 and s.rev_12mo > 0
)
select * from cadence
union all
select * from airbnb;

-- Project customer_mrr straight off customer_churn so every MRR consumer (the
-- ROI drill-down and channel_new_mrr) picks up commercial + vacation-rental MRR.
create or replace view marts.customer_mrr as
select
  customer_id,
  hcp_customer_id,
  null::numeric  as visit_price,
  null::text     as rrule,
  null::text     as freq,
  null::integer  as "interval",
  mrr
from marts.customer_churn;
