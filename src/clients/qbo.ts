import { env } from '../lib/env.js';
import { rawSql } from '../lib/db.js';
import { fetchWithRetry } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function apiBase(): string {
  return env.QBO_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

interface TokenRow {
  realm_id: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

async function loadTokenRow(): Promise<TokenRow | undefined> {
  const rows = await rawSql(
    `select realm_id, refresh_token, access_token, access_token_expires_at
       from ops.qbo_tokens limit 1`,
  );
  return rows[0] as unknown as TokenRow | undefined;
}

// Seed the token store from env (one-time) if it's empty. The seed refresh
// token comes from the Intuit OAuth Playground; after the first refresh the
// DB holds the live, rotating token and the env seed is no longer used.
async function ensureSeeded(): Promise<void> {
  const existing = await loadTokenRow();
  if (existing) return;
  if (!env.QBO_REALM_ID || !env.QBO_SEED_REFRESH_TOKEN) {
    throw new Error(
      'QBO not seeded: set QBO_REALM_ID and QBO_SEED_REFRESH_TOKEN (from the Intuit OAuth Playground)',
    );
  }
  await rawSql(
    `insert into ops.qbo_tokens (realm_id, refresh_token)
       values ('${esc(env.QBO_REALM_ID)}', '${esc(env.QBO_SEED_REFRESH_TOKEN)}')
       on conflict (realm_id) do nothing`,
  );
  logger.info('qbo token store seeded from env', { realmId: env.QBO_REALM_ID });
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const basic = Buffer.from(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`).toString('base64');
  const res = await fetchWithRetry(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

// Returns a valid access token + realm id, refreshing and persisting as needed.
async function getAuth(): Promise<{ accessToken: string; realmId: string }> {
  await ensureSeeded();
  const row = await loadTokenRow();
  if (!row) throw new Error('qbo token row missing after seed');

  const stillValid =
    row.access_token &&
    row.access_token_expires_at &&
    new Date(row.access_token_expires_at).getTime() - Date.now() > 120_000; // 2-min buffer

  if (stillValid) {
    return { accessToken: row.access_token as string, realmId: row.realm_id };
  }

  const next = await refreshAccessToken(row.refresh_token);
  const expiresAt = new Date(Date.now() + next.expiresIn * 1000).toISOString();
  await rawSql(
    `update ops.qbo_tokens
        set refresh_token = '${esc(next.refreshToken)}',
            access_token = '${esc(next.accessToken)}',
            access_token_expires_at = '${expiresAt}',
            updated_at = now()
      where realm_id = '${esc(row.realm_id)}'`,
  );
  logger.info('qbo access token refreshed', { realmId: row.realm_id });
  return { accessToken: next.accessToken, realmId: row.realm_id };
}

// Run a QBO SQL-like query, transparently paging via STARTPOSITION/MAXRESULTS.
export async function* qboQuery<T>(entity: string, where = ''): AsyncGenerator<T[]> {
  const { accessToken, realmId } = await getAuth();
  const base = apiBase();
  const pageSize = 1000;
  let start = 1;

  while (true) {
    const q = `select * from ${entity}${where ? ` where ${where}` : ''} startposition ${start} maxresults ${pageSize}`;
    const url = `${base}/v3/company/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=70`;
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const data = await res.json() as { QueryResponse?: Record<string, unknown> };
    const qr = data.QueryResponse ?? {};
    const rows = (qr[entity] as T[] | undefined) ?? [];
    if (rows.length === 0) break;
    yield rows;
    if (rows.length < pageSize) break;
    start += pageSize;
  }
}

// QBO wants timestamps like 2026-01-01T00:00:00-00:00
export function qboTimestamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '-00:00');
}
