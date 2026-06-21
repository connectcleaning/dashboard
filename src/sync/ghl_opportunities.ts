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
  // Opportunities endpoint uses location_id (not locationId) and page-based pagination
  const { env } = await import('../lib/env.js');
  const { fetchWithRetry } = await import('../lib/http.js');

  const BASE = 'https://services.leadconnectorhq.com';
  const headers = {
    Authorization: `Bearer ${env.GHL_API_TOKEN}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
  };

  let total = 0;
  let page = 1;
  while (true) {
    const qs = new URLSearchParams({ location_id: env.GHL_LOCATION_ID, limit: '100', page: String(page) });
    if (since) qs.set('startAfterDate', since.toISOString());
    const res = await fetchWithRetry(`${BASE}/opportunities/search?${qs}`, { headers });
    const data = await res.json() as { opportunities?: GhlOpportunity[]; meta?: { total?: number } };
    const opps = data.opportunities ?? [];
    if (opps.length === 0) break;

    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const o of opps) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
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
    if (rows.length) await upsert('raw', 'ghl_opportunities', rows, 'ghl_opportunity_id');
    total += rows.length;
    page++;
  }

  logger.info('ghl_opportunities synced', { count: total });
  return total;
}
