import { getStore } from '@netlify/blobs';
import { safeEq } from '../lib/strava-core.mjs';
import { responder } from '../lib/http.mjs';
import { platformData, GamingError } from '../lib/gaming-core.mjs';

export default async (req) => {
  const { json, preflight } = responder(req);
  const env = process.env;
  if (req.method === 'OPTIONS') return preflight();
  if (!env.DASH_KEY) return json({ ok: false, error: 'config' }, 500);
  if (!safeEq(req.headers.get('x-dash-key'), env.DASH_KEY)) return json({ ok: false, error: 'key' }, 401);
  const q = new URL(req.url).searchParams;
  try {
    const store = getStore('gaming');
    const r = await platformData(q.get('p'), { env, store, force: q.get('force') === '1' });
    return json({ ok: true, p: q.get('p'), ...r });
  } catch (e) {
    if (e instanceof GamingError) return json({ ok: false, error: e.kind, status: e.status, ...(e.kind === 'api' && e.message && e.message !== 'api' ? { detail: e.message } : {}) }, e.kind === 'platform' ? 400 : e.kind === 'config' ? 200 : 502);
    return json({ ok: false, error: 'unknown' }, 500);
  }
};
