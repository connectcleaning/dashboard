import { sql } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { ghlPages } from '../clients/ghl.js';

interface GhlOpportunity {
  id: string;
  contact?: { id: string };
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  monetaryValue: number;
  source: string;
  createdAt: string;
  updatedAt: string;
  [k: string]: unknown;
}

export async function syncGhlOpportunities(since?: Date): Promise<number> {
  const params: Record<string, string> = {};
  if (since) params['startAfterDate'] = since.toISOString();

  let count = 0;
  for await (const page of ghlPages<GhlOpportunity>('/opportunities/search', params)) {
    for (const o of page) {
      await sql`
        insert into raw.ghl_opportunities (
          ghl_opportunity_id, ghl_contact_id, pipeline_id, stage_id,
          status, monetary_value, source, created_at, updated_at, raw_json, synced_at
        ) values (
          ${o.id}, ${o.contact?.id ?? null}, ${o.pipelineId ?? null},
          ${o.pipelineStageId ?? null}, ${o.status ?? null},
          ${o.monetaryValue ?? null}, ${o.source ?? null},
          ${o.createdAt ?? null}, ${o.updatedAt ?? null},
          ${sql.json(o as never)}, now()
        )
        on conflict (ghl_opportunity_id) do update set
          stage_id       = excluded.stage_id,
          status         = excluded.status,
          monetary_value = excluded.monetary_value,
          updated_at     = excluded.updated_at,
          raw_json       = excluded.raw_json,
          synced_at      = now()
      `;
      count++;
    }
  }
  logger.info('ghl_opportunities synced', { count });
  return count;
}
