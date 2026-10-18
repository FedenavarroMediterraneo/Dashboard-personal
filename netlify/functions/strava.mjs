import { getStore } from '@netlify/blobs';
import { safeEq, fetchDashboardData, stepEfforts, StravaError, CACHE_MS } from '../lib/strava-core.mjs';
import { responder, roleOf } from '../lib/http.mjs';

export default async (req) => {
  const { json, preflight } = responder(req);
  const env = process.env;
  if (req.method === 'OPTIONS') return preflight();
  if (!env.DASH_KEY || !env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET)
    return json({ ok: false, error: 'config' }, 500);
  const role = roleOf(req, env);
  if (!role) return json({ ok: false, error: 'key' }, 401);

  const store = getStore('strava');
  const cached = await store.get('cache', { type: 'json' }).catch(() => null);
  const q = new URL(req.url).searchParams;
  const fresh = cached && Date.now() - new Date(cached.updated).getTime() < CACHE_MS;
  // Primera pintura rápida: devuelve lo último guardado sin tocar Strava, aunque tenga más de 15 minutos.
  // Solo lectura: nunca toca Strava, devuelve lo último guardado.
  if (role !== 'admin') return cached ? json({ ...cached, cached: true, viewer: true }) : json({ ok: false, error: 'nodata' }, 404);
  if (q.get('cached') === '1') return cached ? json({ ...cached, cached: true, stale: !fresh }) : json({ ok: false, error: 'nodata' }, 404);
  if (q.get('step') === 'efforts') {
    if (!cached) return json({ ok: false, error: 'nodata' }, 409);
    try {
      const { prs, rate } = await stepEfforts({ env, store });
      const merged = { ...cached, prs };
      await store.setJSON('cache', merged);
      return json({ ...merged, cached: true, ...(rate ? { error: 'rate' } : {}) });
    } catch (e) {
      return json({ ...cached, cached: true, error: e.kind || 'api' });
    }
  }
  if (fresh && !q.has('force')) return json({ ...cached, cached: true });

  try {
    const data = await fetchDashboardData({ env, store });
    await store.setJSON('cache', data);
    return json(data);
  } catch (e) {
    if (cached) return json({ ...cached, cached: true, stale: true, error: e.kind || 'api' });
    if (e instanceof StravaError) return json({ ok: false, error: e.kind }, e.kind === 'not_connected' ? 401 : e.status === 429 ? 429 : 502);
    return json({ ok: false, error: 'unknown' }, 500);
  }
};
