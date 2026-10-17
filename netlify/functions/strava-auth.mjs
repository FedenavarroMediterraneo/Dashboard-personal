import { getStore } from '@netlify/blobs';
import { safeEq, signState, checkState, exchangeCode, saveTokens } from '../lib/strava-core.mjs';

const page = (title, msg, status = 200) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font:17px system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1>${title}</h1><p>${msg}</p>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

// Uso: /.netlify/functions/strava-auth?key=TU_CLAVE  (una sola vez)
export default async (req) => {
  const env = process.env, url = new URL(req.url);
  if (!env.DASH_KEY || !env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET)
    return page('Falta configuración', 'Define DASH_KEY, STRAVA_CLIENT_ID y STRAVA_CLIENT_SECRET en Netlify.', 500);

  const code = url.searchParams.get('code');
  if (!code) {
    if (url.searchParams.get('error')) return page('Conexión cancelada', 'No se autorizó el acceso a Strava.', 400);
    if (!safeEq(url.searchParams.get('key'), env.DASH_KEY)) return page('Acceso denegado', 'Falta la clave.', 401);
    const auth = new URL('https://www.strava.com/oauth/authorize');
    auth.search = new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID, response_type: 'code', approval_prompt: 'force',
      redirect_uri: url.origin + url.pathname, scope: 'activity:read_all,profile:read_all', state: signState(env.DASH_KEY),
    });
    return Response.redirect(auth.toString(), 302);
  }
  if (!checkState(env.DASH_KEY, url.searchParams.get('state'))) return page('Enlace caducado', 'Vuelve a empezar desde el principio.', 400);
  if (!/activity:read/.test(url.searchParams.get('scope') || ''))
    return page('Permisos insuficientes', 'Marca la casilla para permitir ver tus actividades y repite la conexión.', 400);
  try {
    const t = await exchangeCode({ env, code });
    await saveTokens(getStore('strava'), t);
    await getStore('strava').delete('cache').catch(() => {});
    return page('Strava conectado', 'Ya puedes cerrar esta pestaña y abrir tu dashboard.');
  } catch {
    return page('No se pudo conectar', 'Strava rechazó el código. Inténtalo de nuevo.', 502);
  }
};
