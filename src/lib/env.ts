function require(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string): string {
  return process.env[name] ?? '';
}

export const env = {
  DATABASE_URL:              require('DATABASE_URL'),
  SUPABASE_URL:              require('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: require('SUPABASE_SERVICE_ROLE_KEY'),
  HCP_API_KEY:               optional('HCP_API_KEY'),
  HCP_WEBHOOK_SECRET:        optional('HCP_WEBHOOK_SECRET'),
  GHL_API_TOKEN:             optional('GHL_API_TOKEN'),
  GHL_LOCATION_ID:           optional('GHL_LOCATION_ID'),
  GHL_WEBHOOK_SECRET:        optional('GHL_WEBHOOK_SECRET'),
};
