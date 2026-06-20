import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from './db.js';
import { logger } from './logger.js';

const migrationsDir = join(process.cwd(), 'db', 'migrations');

const files = (await readdir(migrationsDir))
  .filter(f => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const ddl = await readFile(join(migrationsDir, file), 'utf8');
  logger.info('running migration', { file });
  await sql.unsafe(ddl);
  logger.info('done', { file });
}

await sql.end();
logger.info('all migrations complete');
