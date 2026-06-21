import { env } from './lib/env.js';

const BASE = 'https://api.housecallpro.com';
const headers = {
  Authorization: `Token ${env.HCP_API_KEY}`,
  'Content-Type': 'application/json',
};

console.log('--- HCP /employees (page 1, size 5) ---');
const empRes = await fetch(`${BASE}/employees?page=1&page_size=5`, { headers });
const empData = await empRes.json();
console.log(JSON.stringify(empData, null, 2));

console.log('\n--- HCP /customers (page 1, size 2) ---');
const custRes = await fetch(`${BASE}/customers?page=1&page_size=2`, { headers });
const custData = await custRes.json();
console.log(JSON.stringify(custData, null, 2));
