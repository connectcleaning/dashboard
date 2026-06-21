create or replace view marts.dim_cleaner as
  select hcp_employee_id as cleaner_id, name, is_active
  from raw.hcp_employees;

create or replace view marts._hcp_to_customer as
  select source_id as hcp_customer_id, customer_id
  from core.customer_source_link
  where source = 'hcp';

create or replace view marts._ghl_to_customer as
  select source_id as ghl_contact_id, customer_id
  from core.customer_source_link
  where source = 'ghl';

-- One row per completed job. Jobs with multiple cleaners appear once;
-- cleaner_ids are aggregated into an array to avoid revenue double-counting.
create or replace view marts.fact_job as
select
  j.hcp_job_id                                    as job_id,
  c.customer_id,
  array_agg(distinct a.hcp_employee_id)           as cleaner_ids,
  coalesce(m.service_bucket, j.job_type)          as service_bucket,
  coalesce(m.is_recurring, false)                 as recurring_flag,
  j.address_city                                  as city,
  j.completed_at::date                            as job_date,
  j.total_amount                                  as revenue,
  cost.gross_profit,
  cost.sub_pay
from raw.hcp_jobs j
left join marts._hcp_to_customer c   on c.hcp_customer_id = j.hcp_customer_id
left join raw.hcp_job_assignments a  on a.hcp_job_id = j.hcp_job_id
left join core.service_bucket_map m  on m.match_value = j.job_type
                                     and m.match_type = 'job_type'
left join core.job_costs cost        on cost.hcp_job_id = j.hcp_job_id
where j.work_status in ('complete rated', 'complete unrated')
group by j.hcp_job_id, c.customer_id, m.service_bucket, m.is_recurring,
         j.address_city, j.completed_at, j.total_amount,
         cost.gross_profit, cost.sub_pay;

create or replace view marts.fact_opportunity as
select
  o.ghl_opportunity_id                                          as opportunity_id,
  l.customer_id,
  o.status,
  o.source,
  o.monetary_value                                              as value,
  o.created_at,
  case when o.status in ('won','lost')
       then extract(day from (o.updated_at - o.created_at))::int
  end                                                           as days_to_close
from raw.ghl_opportunities o
left join marts._ghl_to_customer l on l.ghl_contact_id = o.ghl_contact_id;

-- Speed-to-lead: time from first inbound message to first outbound reply, per contact
create or replace view marts.speed_to_lead as
with first_inbound as (
  select ghl_contact_id, min(created_at) as first_in
  from raw.ghl_messages
  where direction = 'inbound'
  group by ghl_contact_id
),
first_outbound as (
  select m.ghl_contact_id, min(m.created_at) as first_out
  from raw.ghl_messages m
  join first_inbound fi on fi.ghl_contact_id = m.ghl_contact_id
  where m.direction = 'outbound'
    and m.created_at > fi.first_in
  group by m.ghl_contact_id
)
select
  fi.ghl_contact_id,
  l.customer_id,
  fi.first_in,
  fo.first_out,
  extract(epoch from (fo.first_out - fi.first_in)) / 60.0 as minutes_to_respond
from first_inbound fi
left join first_outbound fo on fo.ghl_contact_id = fi.ghl_contact_id
left join marts._ghl_to_customer l on l.ghl_contact_id = fi.ghl_contact_id;
