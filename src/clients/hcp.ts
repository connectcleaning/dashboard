import { env } from '../lib/env.js';
import { fetchWithRetry } from '../lib/http.js';

const BASE = 'https://api.housecallpro.com';

const headers = {
  Authorization: `Token ${env.HCP_API_KEY}`,
  'Content-Type': 'application/json',
};

export async function* hcpPages<T>(
  path: string,
  params: Record<string, string> = {},
  pageSize = 100,
): AsyncGenerator<T[]> {
  let page = 1;
  while (true) {
    const qs = new URLSearchParams({ ...params, page: String(page), page_size: String(pageSize) });
    const res = await fetchWithRetry(`${BASE}${path}?${qs}`, { headers });
    const data = await res.json() as { data?: T[]; results?: T[]; total_pages?: number; [k: string]: unknown };

    const rows = (data.data ?? data.results ?? []) as T[];
    if (rows.length === 0) break;
    yield rows;

    const totalPages = data.total_pages as number | undefined;
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
