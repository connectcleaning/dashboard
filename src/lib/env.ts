import { config } from 'node:process';

function require(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const env = {
  DATABASE_URL:              require('DATABASE_URL'),
  SUPABASE_URL:              require('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: require('SUPABASE_SERVICE_ROLE_KEY'),
  HCP_API_KEY:               require('HCP_API_KEY'),
  HCP_WEBHOOK_SECRET:        process.env['HCP_WEBHOOK_SECRET'] ?? '',
  GHL_API_TOKEN:             require('GHL_API_TOKEN'),
  GHL_LOCATION_ID:           require('GHL_LOCATION_ID'),
  GHL_WEBHOOK_SECRET:        process.env['GHL_WEBHOOK_SECRET'] ?? '',
};
