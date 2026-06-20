import { sql } from '../lib/db.js';
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
  let count = 0;
  for (const p of data.pipelines ?? []) {
    await sql`
      insert into raw.ghl_pipelines (pipeline_id, name, raw_json)
      values (${p.id}, ${p.name}, ${sql.json(p as never)})
      on conflict (pipeline_id) do update set name = excluded.name, raw_json = excluded.raw_json
    `;
    for (const s of p.stages ?? []) {
      await sql`
        insert into raw.ghl_stages (stage_id, pipeline_id, name, position, raw_json)
        values (${s.id}, ${p.id}, ${s.name}, ${s.position}, ${sql.json(s as never)})
        on conflict (stage_id) do update set name = excluded.name, position = excluded.position, raw_json = excluded.raw_json
      `;
    }
    count++;
  }
  logger.info('ghl_pipelines synced', { count });
  return count;
}
