import { upsert } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { ghlGet } from '../clients/ghl.js';

interface Stage {
  id: string;
  name: string;
  position: number;
  [k: string]: unknown;
}

interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
  [k: string]: unknown;
}

export async function syncGhlPipelines(): Promise<number> {
  const data = await ghlGet<{ pipelines: Pipeline[] }>('/opportunities/pipelines');
  const pipelineRows: Record<string, unknown>[] = [];
  const stageRows: Record<string, unknown>[] = [];

  for (const p of data.pipelines ?? []) {
    pipelineRows.push({ pipeline_id: p.id, name: p.name, raw_json: p });
    for (const s of p.stages ?? []) {
      stageRows.push({ stage_id: s.id, pipeline_id: p.id, name: s.name, position: s.position, raw_json: s });
    }
  }

  await upsert('raw', 'ghl_pipelines', pipelineRows, 'pipeline_id');
  if (stageRows.length) await upsert('raw', 'ghl_stages', stageRows, 'stage_id');
  logger.info('ghl_pipelines synced', { count: pipelineRows.length });
  return pipelineRows.length;
}
