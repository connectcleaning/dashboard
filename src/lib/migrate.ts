import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rawSql } from './db.js';
import { logger } from './logger.js';

const migrationsDir = join(process.cwd(), 'db', 'migrations');

const files = (await readdir(migrationsDir))
  .filter(f => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const ddl = await readFile(join(migrationsDir, file), 'utf8');
  logger.info('running migration', { file });
  await rawSql(ddl);
  logger.info('done', { file });
}

logger.info('all migrations complete');
