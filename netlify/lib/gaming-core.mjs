// Datos de gaming para las tarjetas del dashboard: Steam, Xbox (OpenXBL), PlayStation (psn-api, no oficial) y Nintendo.
// Cada plataforma se pide por separado y se guarda 30 minutos para no gastar peticiones ni tiempo de función.
export class GamingError extends Error {
  constructor(kind, status, msg) { super(msg || kind); this.kind = kind; this.status = status || null; }
}
export const CACHE_MS = 30 * 60 * 1000;
export const PLATFORMS = ['steam', 'xbox', 'ps', 'nintendo'];
const r1 = n => Math.round(n * 10) / 10;
const enc = encodeURIComponent;

async function getJson(url, fetchImpl, headers) {
  let res;
  try { res = await fetchImpl(url, headers ? { headers } : undefined); } catch { throw new GamingError('network'); }
  if (res.status === 401 || res.status === 403) throw new GamingError('auth', res.status);
  if (res.status === 429) throw new GamingError('rate', 429);
  if (!res.ok) throw new GamingError('api', res.status);
  try { return await res.json(); } catch { throw new GamingError('api', res.status, 'respuesta no válida'); }
}

// ---------- Steam (API oficial). Necesita perfil con "detalles de juego" en público. ----------
export async function getSteam({ env, fetchImpl = fetch }) {
  if (!env.STEAM_API_KEY || !env.STEAM_ID) throw new GamingError('config');
  const j = await getJson(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${enc(env.STEAM_API_KEY)}&steamid=${enc(env.STEAM_ID)}&include_appinfo=1&include_played_free_games=1&format=json`, fetchImpl);
  const games = j?.response?.games;
  if (!Array.isArray(games)) throw new GamingError('private'); // perfil privado o sin juegos
  const sum = k => games.reduce((a, g) => a + (+g[k] || 0), 0);
  const recent = games.filter(g => g.playtime_2weeks > 0).sort((a, b) => b.playtime_2weeks - a.playtime_2weeks).slice(0, 8);
  const top = games.reduce((a, g) => (!a || g.playtime_forever > a.playtime_forever ? g : a), null);
  return {
    hours: Math.round(sum('playtime_forever') / 60), two: r1(sum('playtime_2weeks') / 60),
    bars: recent.map(g => r1(g.playtime_2weeks / 60)), names: recent.map(g => g.name || 'Juego ' + g.appid),
    top: top && top.playtime_forever > 0 ? { name: top.name || 'Juego ' + top.appid, hours: Math.round(top.playtime_forever / 60) } : null,
  };
}

// ---------- Xbox (OpenXBL, xbl.io). No hay API oficial. ----------
// OpenXBL: busca el gamertag y el gamerscore tanto en "settings" ([{id,value}]) como en campos sueltos, a cualquier profundidad.
function findProfile(root) {
  let tag = null, score = null;
  const seen = new Set(), q = [root];
  while (q.length && (tag === null || score === null)) {
    const o = q.shift();
    if (!o || typeof o !== 'object' || seen.has(o)) continue;
    seen.add(o);
    if (!Array.isArray(o) && typeof o.id === 'string' && 'value' in o) {
      const id = o.id.toLowerCase();
      if (tag === null && (id === 'gamertag' || id === 'moderngamertag') && o.value) tag = String(o.value);
      if (score === null && id === 'gamerscore' && o.value !== '' && !isNaN(+o.value)) score = +o.value;
    }
    for (const [k, v] of Object.entries(o)) {
      const kk = k.toLowerCase();
      if (tag === null && (kk === 'gamertag' || kk === 'moderngamertag') && typeof v === 'string' && v) tag = v;
      if (score === null && kk === 'gamerscore' && v !== '' && v != null && typeof v !== 'object' && !isNaN(+v)) score = +v;
      if (v && typeof v === 'object') q.push(v);
    }
  }
  return { tag, score };
}
export async function getXbox({ env, fetchImpl = fetch }) {
  if (!env.XBL_API_KEY) throw new GamingError('config');
  const h = { 'X-Authorization': env.XBL_API_KEY, accept: 'application/json', 'accept-language': 'es-ES' };
  const acc = await getJson('https://api.xbl.io/v2/account', fetchImpl, h);
  const { tag, score: sc } = findProfile(acc);
  if (!tag) {
    const keys = acc && typeof acc === 'object' ? Object.keys(acc).slice(0, 8).join(', ') : typeof acc;
    throw new GamingError('api', null, 'sin gamertag; campos recibidos: ' + (keys || 'ninguno'));
  }
  const score = sc || 0;
  let ach = null, last = null;
  try {
    const a = await getJson('https://api.xbl.io/v2/achievements', fetchImpl, h);
    const titles = Array.isArray(a?.titles) ? a.titles : [];
    ach = titles.reduce((s, t) => s + (+t?.achievement?.currentAchievements || 0), 0);
    const withDate = titles.filter(t => t?.lastUnlock && !String(t.lastUnlock).startsWith('0001')).sort((x, y) => String(y.lastUnlock).localeCompare(String(x.lastUnlock)));
    if (withDate[0]) last = { game: withDate[0].name || 'Juego', at: withDate[0].lastUnlock };
  } catch (e) { if (e.kind === 'rate') throw e; }
  return { tag, score, ach, last };
}

// ---------- PlayStation (psn-api, no oficial). El NPSSO equivale a tu contraseña de PlayStation. ----------
export async function getPsn({ env, store, now = Date.now(), psn }) {
  if (!env.NPSSO) throw new GamingError('config');
  psn = psn || await import('psn-api');
  let auth = await store.get('psn-auth', { type: 'json' }).catch(() => null);
  try {
    if (!auth || !(auth.accessAt > now)) {
      let t;
      if (auth?.refreshToken && auth.refreshAt > now) {
        try { t = await psn.exchangeRefreshTokenForAuthTokens(auth.refreshToken); } catch { t = null; }
      }
      if (!t) t = await psn.exchangeAccessCodeForAuthTokens(await psn.exchangeNpssoForAccessCode(env.NPSSO));
      auth = {
        accessToken: t.accessToken, accessAt: now + Math.max(60, (t.expiresIn || 3600) - 120) * 1000,
        refreshToken: t.refreshToken, refreshAt: now + Math.max(60, (t.refreshTokenExpiresIn || 0) - 3600) * 1000,
      };
      await store.setJSON('psn-auth', auth);
    }
  } catch { throw new GamingError('auth'); }
  const a = { accessToken: auth.accessToken };
  let sum, titles;
  try { sum = await psn.getUserTrophyProfileSummary(a, 'me'); } catch (e) { throw new GamingError(e?.status === 429 ? 'rate' : 'api'); }
  try { titles = await psn.getUserTitles(a, 'me', { limit: 1 }); } catch { titles = null; }
  const e = sum?.earnedTrophies || {};
  if (sum?.trophyLevel == null) throw new GamingError('api', null, 'sin nivel de trofeos');
  const t0 = titles?.trophyTitles?.[0];
  return {
    level: +sum.trophyLevel || 0, plat: +e.platinum || 0, gold: +e.gold || 0, silver: +e.silver || 0, bronze: +e.bronze || 0,
    last: t0 ? { game: t0.trophyTitleName || 'Juego', at: t0.lastUpdatedDateTime || null } : null,
  };
}

// ---------- Nintendo: no hay API; solo se devuelve tu código de amigo guardado en Netlify. ----------
export async function getNintendo({ env }) {
  const code = String(env.NINTENDO_CODE || '').trim().toUpperCase();
  if (!code) throw new GamingError('config');
  if (!/^SW-\d{4}-\d{4}-\d{4}$/.test(code)) throw new GamingError('format');
  return { code };
}

const LOADERS = { steam: getSteam, xbox: getXbox, ps: getPsn, nintendo: getNintendo };

// Devuelve datos guardados si tienen menos de 30 minutos; si si la plataforma falla, devuelve lo último guardado marcándolo como antiguo.
export async function platformData(p, { env, store, fetchImpl = fetch, now = Date.now(), force = false, psn }) {
  if (!LOADERS[p]) throw new GamingError('platform');
  const key = 'cache-' + p;
  const saved = await store.get(key, { type: 'json' }).catch(() => null);
  if (saved && !force && now - saved.at < CACHE_MS) return { data: saved.data, updated: new Date(saved.at).toISOString(), cached: true };
  try {
    const data = await LOADERS[p]({ env, store, fetchImpl, now, psn });
    await store.setJSON(key, { at: now, data });
    return { data, updated: new Date(now).toISOString(), cached: false };
  } catch (e) {
    if (saved && e.kind !== 'config') return { data: saved.data, updated: new Date(saved.at).toISOString(), cached: true, stale: true };
    throw e;
  }
}
