import { env } from '../lib/env.js';
import { fetchWithRetry } from '../lib/http.js';

const BASE = 'https://services.leadconnectorhq.com';

const headers = {
  Authorization: `Bearer ${env.GHL_API_TOKEN}`,
  Version: '2021-07-28',
  'Content-Type': 'application/json',
};

export async function* ghlPages<T>(
  path: string,
  params: Record<string, string> = {},
  pageSize = 100,
): AsyncGenerator<T[]> {
  let startAfter: string | undefined;
  while (true) {
    const qs = new URLSearchParams({
      locationId: env.GHL_LOCATION_ID,
      limit: String(pageSize),
      ...params,
      ...(startAfter ? { startAfter } : {}),
    });
    const res = await fetchWithRetry(`${BASE}${path}?${qs}`, { headers });
    const data = await res.json() as { [k: string]: unknown };

    // GHL responses vary by resource — extract the array from the first array-valued key
    const rows = Object.values(data).find(Array.isArray) as T[] | undefined ?? [];
    if (rows.length === 0) break;
    yield rows;

    const meta = data['meta'] as { startAfter?: string; nextPageUrl?: string } | undefined;
    if (!meta?.startAfter) break;
    startAfter = meta.startAfter;
  }
}

export async function ghlGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ locationId: env.GHL_LOCATION_ID, ...params });
  const res = await fetchWithRetry(`${BASE}${path}?${qs}`, { headers });
  return res.json() as Promise<T>;
}
