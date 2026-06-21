import { rawSql, upsert } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export async function resolveIdentities(): Promise<void> {
  // Find phone + email matches
  const matches = await rawSql(`
    with hcp as (
      select hcp_customer_id,
             lower(trim(coalesce(email, ''))) as email_n,
             regexp_replace(coalesce(mobile_phone, home_phone, ''), '\\D', '', 'g') as phone_d
      from raw.hcp_customers
    ),
    ghl as (
      select ghl_contact_id,
             lower(trim(coalesce(email, ''))) as email_n,
             regexp_replace(coalesce(phone, ''), '\\D', '', 'g') as phone_d
      from raw.ghl_contacts
    ),
    phone_matches as (
      select h.hcp_customer_id, g.ghl_contact_id, 'phone' as method
      from hcp h join ghl g
        on length(h.phone_d) >= 10 and right(h.phone_d,10) = right(g.phone_d,10)
    ),
    email_matches as (
      select h.hcp_customer_id, g.ghl_contact_id, 'email' as method
      from hcp h join ghl g on h.email_n <> '' and h.email_n = g.email_n
      where not exists (
        select 1 from phone_matches pm
        where pm.hcp_customer_id = h.hcp_customer_id and pm.ghl_contact_id = g.ghl_contact_id
      )
    )
    select * from phone_matches union all select * from email_matches
  `) as { hcp_customer_id: string; ghl_contact_id: string; method: string }[];

  for (const m of matches) {
    const existingHcp = await rawSql(`select customer_id from core.customer_source_link where source='hcp' and source_id='${m.hcp_customer_id}'`);
    const existingGhl = await rawSql(`select customer_id from core.customer_source_link where source='ghl' and source_id='${m.ghl_contact_id}'`);

    if (existingHcp.length && existingGhl.length &&
        (existingHcp[0] as { customer_id: string }).customer_id !== (existingGhl[0] as { customer_id: string }).customer_id) {
      await upsert('core', 'match_review', [{
        hcp_customer_id: m.hcp_customer_id,
        ghl_contact_id: m.ghl_contact_id,
        reason: 'conflict: already linked to different customers',
      }], 'id');
      continue;
    }

    let customerId = (existingHcp[0] as { customer_id: string } | undefined)?.customer_id
                  ?? (existingGhl[0] as { customer_id: string } | undefined)?.customer_id;

    if (!customerId) {
      const hcpRow = await rawSql(`select first_name, last_name, email, mobile_phone from raw.hcp_customers where hcp_customer_id='${m.hcp_customer_id}'`);
      const r = hcpRow[0] as { first_name?: string; last_name?: string; email?: string; mobile_phone?: string } | undefined;
      const name = [r?.first_name, r?.last_name].filter(Boolean).join(' ') || null;
      const inserted = await rawSql(
        `insert into core.customer (display_name, primary_email, primary_phone_e164) values (${name ? `'${name.replace(/'/g, "''")}'` : 'null'}, ${r?.email ? `'${r.email}'` : 'null'}, ${r?.mobile_phone ? `'${r.mobile_phone}'` : 'null'}) returning customer_id`
      );
      customerId = (inserted[0] as { customer_id: string })?.customer_id;
    }

    if (!customerId) continue;

    if (!existingHcp.length) {
      await rawSql(`insert into core.customer_source_link (customer_id, source, source_id, match_method, match_confidence) values ('${customerId}','hcp','${m.hcp_customer_id}','${m.method}','high') on conflict (source, source_id) do nothing`);
    }
    if (!existingGhl.length) {
      await rawSql(`insert into core.customer_source_link (customer_id, source, source_id, match_method, match_confidence) values ('${customerId}','ghl','${m.ghl_contact_id}','${m.method}','high') on conflict (source, source_id) do nothing`);
    }
  }

  // Tier-3: same last name + zip
  const tier3 = await rawSql(`
    select h.hcp_customer_id, g.ghl_contact_id
    from raw.hcp_customers h
    join raw.ghl_contacts g
      on lower(trim(h.last_name)) = lower(trim(g.last_name))
     and h.address_zip is not null
     and h.address_zip = (g.raw_json->>'postalCode')
    where not exists (
      select 1 from core.customer_source_link hlink
      join core.customer_source_link glink using (customer_id)
      where hlink.source='hcp' and hlink.source_id=h.hcp_customer_id
        and glink.source='ghl' and glink.source_id=g.ghl_contact_id
    )
  `) as { hcp_customer_id: string; ghl_contact_id: string }[];

  for (const t of tier3) {
    await rawSql(`insert into core.match_review (hcp_customer_id, ghl_contact_id, reason) values ('${t.hcp_customer_id}','${t.ghl_contact_id}','tier3: last name + zip') on conflict do nothing`);
  }

  // Singletons
  const unlinkedHcp = await rawSql(`select hcp_customer_id, first_name, last_name, email, mobile_phone from raw.hcp_customers where hcp_customer_id not in (select source_id from core.customer_source_link where source='hcp')`) as { hcp_customer_id: string; first_name?: string; last_name?: string; email?: string; mobile_phone?: string }[];
  for (const r of unlinkedHcp) {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || null;
    const ins = await rawSql(`insert into core.customer (display_name, primary_email, primary_phone_e164) values (${name ? `'${name.replace(/'/g, "''")}'` : 'null'},${r.email ? `'${r.email}'` : 'null'},${r.mobile_phone ? `'${r.mobile_phone}'` : 'null'}) returning customer_id`);
    const cid = (ins[0] as { customer_id: string })?.customer_id;
    if (cid) await rawSql(`insert into core.customer_source_link (customer_id, source, source_id, match_method, match_confidence) values ('${cid}','hcp','${r.hcp_customer_id}','singleton','high') on conflict do nothing`);
  }

  const unlinkedGhl = await rawSql(`select ghl_contact_id, first_name, last_name, email, phone from raw.ghl_contacts where ghl_contact_id not in (select source_id from core.customer_source_link where source='ghl')`) as { ghl_contact_id: string; first_name?: string; last_name?: string; email?: string; phone?: string }[];
  for (const r of unlinkedGhl) {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || null;
    const ins = await rawSql(`insert into core.customer (display_name, primary_email, primary_phone_e164) values (${name ? `'${name.replace(/'/g, "''")}'` : 'null'},${r.email ? `'${r.email}'` : 'null'},${r.phone ? `'${r.phone}'` : 'null'}) returning customer_id`);
    const cid = (ins[0] as { customer_id: string })?.customer_id;
    if (cid) await rawSql(`insert into core.customer_source_link (customer_id, source, source_id, match_method, match_confidence) values ('${cid}','ghl','${r.ghl_contact_id}','singleton','high') on conflict do nothing`);
  }

  logger.info('identity resolution complete', {
    matched: matches.length,
    tier3_flagged: tier3.length,
    hcp_singletons: unlinkedHcp.length,
    ghl_singletons: unlinkedGhl.length,
  });
}
