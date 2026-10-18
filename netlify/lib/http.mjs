import { safeEq } from './strava-core.mjs';
// Rol según la clave: 'admin' (DASH_KEY, todo) o 'view' (VIEW_KEY, solo lectura). VIEW_KEY debe tener 12+ caracteres.
export function roleOf(req, env) {
  const k = req.headers.get('x-dash-key');
  if (env.DASH_KEY && safeEq(k, env.DASH_KEY)) return 'admin';
  if (env.VIEW_KEY && env.VIEW_KEY.length >= 12 && safeEq(k, env.VIEW_KEY)) return 'view';
  return null;
}
// Respuestas JSON y CORS por petición. ALLOWED_ORIGIN: orígenes del dashboard separados por comas.
export function responder(req) {
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
  const o = req.headers.get('origin');
  const cors = o && allowed.includes(o) ? { 'access-control-allow-origin': o, vary: 'Origin' } : {};
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
  });
  const preflight = () => new Response(null, {
    status: 204,
    headers: { ...cors, 'access-control-allow-headers': 'x-dash-key, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '86400' },
  });
  return { json, preflight };
}
