import 'node:process';
import { orchestrate } from './sync/orchestrator.js';
import { sql } from './lib/db.js';
import { resolveIdentities } from './match/resolve.js';
import { logger } from './lib/logger.js';

const command = process.argv[2];

if (!command) {
  console.error('Usage: tsx src/cli.ts <full|incremental|match>');
  process.exit(1);
}

try {
  if (command === 'full') {
    await orchestrate('full');
  } else if (command === 'incremental') {
    await orchestrate('incremental');
  } else if (command === 'match') {
    await resolveIdentities();
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
} catch (err) {
  logger.error('cli error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
} finally {
  await sql.end();
}
