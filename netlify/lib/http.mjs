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
