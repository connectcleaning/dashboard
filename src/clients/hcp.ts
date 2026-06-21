import { env } from '../lib/env.js';
import { fetchWithRetry } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const BASE = 'https://api.housecallpro.com';

const headers = {
  Authorization: `Token ${env.HCP_API_KEY}`,
  'Content-Type': 'application/json',
};

function extractArray<T>(data: Record<string, unknown>): T[] {
  // Try common wrapper keys in order of likelihood
  for (const key of ['data', 'results', 'employees', 'customers', 'jobs',
                      'invoices', 'estimates', 'leads', 'pros']) {
    if (Array.isArray(data[key])) return data[key] as T[];
  }
  // Fallback: find the first array-valued key
  for (const val of Object.values(data)) {
    if (Array.isArray(val)) return val as T[];
  }
  return [];
}

export async function* hcpPages<T>(
  path: string,
  params: Record<string, string> = {},
  pageSize = 100,
): AsyncGenerator<T[]> {
  let page = 1;
  while (true) {
    const qs = new URLSearchParams({ ...params, page: String(page), page_size: String(pageSize) });
    const res = await fetchWithRetry(`${BASE}${path}?${qs}`, { headers });
    const data = await res.json() as Record<string, unknown>;

    if (page === 1) {
      // Log top-level keys on first page so we can debug response shape
      logger.info('hcp response keys', { path, keys: Object.keys(data) });
    }

    const rows = extractArray<T>(data);
    if (rows.length === 0) break;
    yield rows;

    const totalPages = (data['total_pages'] ?? data['totalPages']) as number | undefined;
    if (totalPages && page >= totalPages) break;
    page++;
  }
}

export async function hcpGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params);
  const url = qs.size ? `${BASE}${path}?${qs}` : `${BASE}${path}`;
  const res = await fetchWithRetry(url, { headers });
  return res.json() as Promise<T>;
}
