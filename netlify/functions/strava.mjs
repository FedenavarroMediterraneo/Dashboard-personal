import { getStore } from '@netlify/blobs';
import { safeEq, fetchDashboardData, stepEfforts, StravaError, CACHE_MS } from '../lib/strava-core.mjs';

// ALLOWED_ORIGIN: orígenes del dashboard separados por comas (p. ej. https://tuusuario.github.io). Sin definir, solo mismo origen.
let CORS = {};
const setCors = req => {
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
  const o = req.headers.get('origin');
  CORS = o && allowed.includes(o) ? { 'access-control-allow-origin': o, vary: 'Origin' } : {};
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});

export default async (req) => {
  const env = process.env;
  setCors(req);
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-headers': 'x-dash-key', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400' } });
  if (!env.DASH_KEY || !env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET)
    return json({ ok: false, error: 'config' }, 500);
  if (!safeEq(req.headers.get('x-dash-key'), env.DASH_KEY)) return json({ ok: false, error: 'key' }, 401);

  const store = getStore('strava');
  const cached = await store.get('cache', { type: 'json' }).catch(() => null);
  if (new URL(req.url).searchParams.get('step') === 'efforts') {
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
  const fresh = cached && Date.now() - new Date(cached.updated).getTime() < CACHE_MS;
  if (fresh && !new URL(req.url).searchParams.has('force')) return json({ ...cached, cached: true });

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
