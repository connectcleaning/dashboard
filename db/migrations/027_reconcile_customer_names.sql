-- Fill blank customer names from source systems.
--
-- core.customer is built by the external identity-matching ETL, which sets
-- display_name from the GHL contact. Google LSA leads arrive in GHL phone-only,
-- so their name is blank there — even after HCP captures a real name when they
-- become a job (e.g. Isobel Gruin showed as "(unknown)" in LSA ROI). This
-- reconciliation resolves a name from the best available source and only ever
-- fills blanks (never overwrites an existing name). Run on a schedule so it
-- self-heals regardless of what the ETL writes.

create or replace function core.reconcile_customer_names() returns integer as $$
declare
  updated_count integer;
begin
  with resolved as (
    select
      c.customer_id,
      coalesce(
        -- 1) HCP person name
        (select nullif(trim(coalesce(h.first_name,'') || ' ' || coalesce(h.last_name,'')), '')
           from core.customer_source_link l
           join raw.hcp_customers h on h.hcp_customer_id = l.source_id
          where l.customer_id = c.customer_id and l.source = 'hcp'
          order by h.updated_at desc nulls last
          limit 1),
        -- 2) HCP company name (commercial accounts)
        (select nullif(trim(h.company), '')
           from core.customer_source_link l
           join raw.hcp_customers h on h.hcp_customer_id = l.source_id
          where l.customer_id = c.customer_id and l.source = 'hcp'
          order by h.updated_at desc nulls last
          limit 1),
        -- 3) GHL contact name
        (select nullif(trim(coalesce(g.first_name,'') || ' ' || coalesce(g.last_name,'')), '')
           from core.customer_source_link l
           join raw.ghl_contacts g on g.ghl_contact_id = l.source_id
          where l.customer_id = c.customer_id and l.source = 'ghl'
          order by g.date_added desc nulls last
          limit 1)
      ) as name
    from core.customer c
    where c.display_name is null or trim(c.display_name) = ''
  )
  update core.customer c
     set display_name = r.name
    from resolved r
   where c.customer_id = r.customer_id
     and r.name is not null;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$ language plpgsql;
