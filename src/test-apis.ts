import { hcpPages } from './clients/hcp.js';
import { ghlGet } from './clients/ghl.js';

// Test HCP
console.log('Testing HCP...');
let hcpCount = 0;
for await (const page of hcpPages('/employees')) {
  hcpCount += page.length;
  const first = page[0] as Record<string, unknown>;
  console.log('HCP employee fields:', Object.keys(first).join(', '));
  break;
}
console.log('HCP employees found:', hcpCount);

// Test GHL
console.log('\nTesting GHL...');
const pipelines = await ghlGet<{ pipelines?: unknown[] }>('/opportunities/pipelines');
console.log('GHL pipelines found:', pipelines.pipelines?.length ?? 0);

console.log('\nBoth APIs connected successfully.');
