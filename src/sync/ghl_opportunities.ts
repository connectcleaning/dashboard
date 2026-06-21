import { upsert } from '../lib/db.js';
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

  const rows: Record<string, unknown>[] = [];
  for await (const page of ghlPages<GhlOpportunity>('/opportunities/search', params)) {
    for (const o of page) {
      rows.push({
        ghl_opportunity_id: o.id,
        ghl_contact_id: o.contact?.id ?? null,
        pipeline_id: o.pipelineId ?? null,
        stage_id: o.pipelineStageId ?? null,
        status: o.status ?? null,
        monetary_value: o.monetaryValue ?? null,
        source: o.source ?? null,
        created_at: o.createdAt ?? null,
        updated_at: o.updatedAt ?? null,
        raw_json: o,
        synced_at: new Date().toISOString(),
      });
    }
  }
  await upsert('raw', 'ghl_opportunities', rows, 'ghl_opportunity_id');
  logger.info('ghl_opportunities synced', { count: rows.length });
  return rows.length;
}
