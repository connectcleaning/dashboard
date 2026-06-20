import { sql } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export async function resolveIdentities(): Promise<void> {
  // Find phone + email matches between HCP customers and GHL contacts
  const matches = await sql<{
    hcp_customer_id: string;
    ghl_contact_id: string;
    method: string;
  }[]>`
    with hcp as (
      select
        hcp_customer_id,
        lower(trim(coalesce(email, '')))                                       as email_n,
        regexp_replace(coalesce(mobile_phone, home_phone, ''), '\D', '', 'g') as phone_d
      from raw.hcp_customers
    ),
    ghl as (
      select
        ghl_contact_id,
        lower(trim(coalesce(email, '')))                    as email_n,
        regexp_replace(coalesce(phone, ''), '\D', '', 'g') as phone_d
      from raw.ghl_contacts
    ),
    phone_matches as (
      select h.hcp_customer_id, g.ghl_contact_id, 'phone' as method
      from hcp h join ghl g
        on length(h.phone_d) >= 10
       and right(h.phone_d, 10) = right(g.phone_d, 10)
    ),
    email_matches as (
      select h.hcp_customer_id, g.ghl_contact_id, 'email' as method
      from hcp h join ghl g
        on h.email_n <> '' and h.email_n = g.email_n
      where not exists (
        select 1 from phone_matches pm
        where pm.hcp_customer_id = h.hcp_customer_id
          and pm.ghl_contact_id = g.ghl_contact_id
      )
    )
    select * from phone_matches
    union all
    select * from email_matches
  `;

  for (const m of matches) {
    // Detect conflict: phone match to customer A, email match to customer B
    const existingHcp = await sql<{ customer_id: string }[]>`
      select customer_id from core.customer_source_link
      where source = 'hcp' and source_id = ${m.hcp_customer_id}
    `;
    const existingGhl = await sql<{ customer_id: string }[]>`
      select customer_id from core.customer_source_link
      where source = 'ghl' and source_id = ${m.ghl_contact_id}
    `;

    if (existingHcp.length && existingGhl.length &&
        existingHcp[0]!.customer_id !== existingGhl[0]!.customer_id) {
      // Conflict — flag for manual review
      await sql`
        insert into core.match_review (hcp_customer_id, ghl_contact_id, reason)
        values (${m.hcp_customer_id}, ${m.ghl_contact_id},
                ${'conflict: already linked to different customers'})
        on conflict do nothing
      `;
      continue;
    }

    const customerId = existingHcp[0]?.customer_id ?? existingGhl[0]?.customer_id;

    if (!customerId) {
      // Create a new unified customer
      const hcpRow = await sql<{ first_name: string; last_name: string; email: string; mobile_phone: string }[]>`
        select first_name, last_name, email, mobile_phone from raw.hcp_customers
        where hcp_customer_id = ${m.hcp_customer_id}
      `;
      const row = hcpRow[0];
      const [inserted] = await sql<{ customer_id: string }[]>`
        insert into core.customer (display_name, primary_email, primary_phone_e164)
        values (
          ${[row?.first_name, row?.last_name].filter(Boolean).join(' ') || null},
          ${row?.email ?? null},
          ${row?.mobile_phone ?? null}
        )
        returning customer_id
      `;
      if (!inserted) continue;

      await sql`
        insert into core.customer_source_link (customer_id, source, source_id, match_method, match_confidence)
        values (${inserted.customer_id}, 'hcp', ${m.hcp_customer_id}, ${m.method}, 'high')
        on conflict (source, source_id) do nothing
      `;
      await sql`
        insert into core.customer_source_link (customer_id, source, source_id, match_method, match_confidence)
        values (${inserted.customer_id}, 'ghl', ${m.ghl_contact_id}, ${m.method}, 'high')
        on conflict (source, source_id) do nothing
      `;
    } else {
      // Link to existing customer
      if (!existingHcp.length) {
        await sql`
          insert into core.customer_source_link (customer_id, source, source_id, match_method, match_confidence)
          values (${customerId}, 'hcp', ${m.hcp_customer_id}, ${m.method}, 'high')
          on conflict (source, source_id) do nothing
        `;
      }
      if (!existingGhl.length) {
        await sql`
          insert into core.customer_source_link (customer_id, source, source_id, match_method, match_confidence)
          values (${customerId}, 'ghl', ${m.ghl_contact_id}, ${m.method}, 'high')
          on conflict (source, source_id) do nothing
        `;
      }
    }
  }

  // Tier-3: same last name + same zip, no phone/email match — flag for review
  const tier3 = await sql<{ hcp_customer_id: string; ghl_contact_id: string }[]>`
    select h.hcp_customer_id, g.ghl_contact_id
    from raw.hcp_customers h
    join raw.ghl_contacts g
      on lower(trim(h.last_name)) = lower(trim(g.last_name))
     and h.address_zip is not null
     and h.address_zip = (g.raw_json->>'postalCode')
    where not exists (
      select 1 from core.customer_source_link hlink
      join core.customer_source_link glink using (customer_id)
      where hlink.source = 'hcp' and hlink.source_id = h.hcp_customer_id
        and glink.source = 'ghl' and glink.source_id = g.ghl_contact_id
    )
  `;

  for (const t of tier3) {
    await sql`
      insert into core.match_review (hcp_customer_id, ghl_contact_id, reason)
      values (${t.hcp_customer_id}, ${t.ghl_contact_id}, 'tier3: last name + zip')
      on conflict do nothing
    `;
  }

  // Singletons: any source record with no link yet gets its own customer
  const unlinkedHcp = await sql<{ hcp_customer_id: string; first_name: string; last_name: string; email: string; mobile_phone: string }[]>`
    select hcp_customer_id, first_name, last_name, email, mobile_phone
    from raw.hcp_customers
    where hcp_customer_id not in (select source_id from core.customer_source_link where source='hcp')
  `;
  for (const r of unlinkedHcp) {
    const [ins] = await sql<{ customer_id: string }[]>`
      insert into core.customer (display_name, primary_email, primary_phone_e164)
      values (
        ${[r.first_name, r.last_name].filter(Boolean).join(' ') || null},
        ${r.email ?? null}, ${r.mobile_phone ?? null}
      )
      returning customer_id
    `;
    if (!ins) continue;
    await sql`
      insert into core.customer_source_link (customer_id, source, source_id, match_method, match_confidence)
      values (${ins.customer_id}, 'hcp', ${r.hcp_customer_id}, 'singleton', 'high')
      on conflict do nothing
    `;
  }

  const unlinkedGhl = await sql<{ ghl_contact_id: string; first_name: string; last_name: string; email: string; phone: string }[]>`
    select ghl_contact_id, first_name, last_name, email, phone
    from raw.ghl_contacts
    where ghl_contact_id not in (select source_id from core.customer_source_link where source='ghl')
  `;
  for (const r of unlinkedGhl) {
    const [ins] = await sql<{ customer_id: string }[]>`
      insert into core.customer (display_name, primary_email, primary_phone_e164)
      values (
        ${[r.first_name, r.last_name].filter(Boolean).join(' ') || null},
        ${r.email ?? null}, ${r.phone ?? null}
      )
      returning customer_id
    `;
    if (!ins) continue;
    await sql`
      insert into core.customer_source_link (customer_id, source, source_id, match_method, match_confidence)
      values (${ins.customer_id}, 'ghl', ${r.ghl_contact_id}, 'singleton', 'high')
      on conflict do nothing
    `;
  }

  logger.info('identity resolution complete', {
    matched: matches.length,
    tier3_flagged: tier3.length,
    hcp_singletons: unlinkedHcp.length,
    ghl_singletons: unlinkedGhl.length,
  });
}
