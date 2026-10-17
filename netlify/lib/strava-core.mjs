// Lógica de Strava sin dependencias de Netlify, para poder probarla.
import { timingSafeEqual, createHmac } from 'node:crypto';

export const API = 'https://www.strava.com/api/v3';
export const TOKEN_URL = 'https://www.strava.com/oauth/token';
export const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);
export const CACHE_MS = 15 * 60 * 1000;

export class StravaError extends Error {
  constructor(kind, status, msg) { super(msg || kind); this.kind = kind; this.status = status; }
}

export function safeEq(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}

// Estado firmado para el flujo de conexión (evita que un tercero enlace su cuenta).
export function signState(secret, ts = Date.now()) {
  const h = createHmac('sha256', secret).update(String(ts)).digest('hex');
  return `${ts}.${h}`;
}
export function checkState(secret, state, now = Date.now()) {
  const [ts, h] = String(state || '').split('.');
  if (!ts || !h || !/^\d+$/.test(ts)) return false;
  if (now - Number(ts) > 10 * 60 * 1000 || Number(ts) > now + 60000) return false;
  return safeEq(h, createHmac('sha256', secret).update(ts).digest('hex'));
}

export async function saveTokens(store, t) {
  await store.setJSON('token', {
    access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at,
  });
}

export async function exchangeCode({ env, code, fetchImpl = fetch }) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET,
      code, grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new StravaError('exchange', res.status, 'No se pudo canjear el código');
  return res.json();
}

export async function getAccessToken({ env, store, fetchImpl = fetch, now = Date.now() }) {
  const saved = await store.get('token', { type: 'json' }).catch(() => null);
  if (saved?.access_token && saved.expires_at * 1000 - now > 60000) return saved.access_token;
  const refresh = saved?.refresh_token || env.STRAVA_REFRESH_TOKEN;
  if (!refresh) throw new StravaError('not_connected', 401, 'Strava no está conectado');
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token', refresh_token: refresh,
    }),
  });
  if (res.status === 429) throw new StravaError('rate', 429);
  if (!res.ok) throw new StravaError(res.status === 400 || res.status === 401 ? 'not_connected' : 'token', res.status, 'Fallo al renovar el token');
  const t = await res.json();
  // Strava puede devolver un refresh token nuevo: se guarda siempre el último.
  await saveTokens(store, { ...t, refresh_token: t.refresh_token || refresh });
  return t.access_token;
}

async function api(path, token, fetchImpl) {
  const res = await fetchImpl(API + path, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 429) throw new StravaError('rate', 429);
  if (res.status === 401) throw new StravaError('not_connected', 401);
  if (!res.ok) throw new StravaError('api', res.status, `Strava respondió ${res.status}`);
  return res.json();
}

// Fecha "de hoy" en Madrid
export function madridNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

const r1 = n => Math.round(n * 10) / 10;

// activities: lista cruda de Strava. Fechas por start_date_local ("2026-10-05T07:00:00Z" es hora local).
export function aggregate(activities, today) {
  const { y, m, d } = today;
  const months = Array(12).fill(0), monthsPrev = Array(12).fill(0);
  let prevSame = 0, prevFull = 0, monthActs = 0, yearActs = 0;
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  for (const a of activities) {
    if (!RUN_TYPES.has(a.sport_type || a.type)) continue;
    const s = String(a.start_date_local || '');
    const ay = +s.slice(0, 4), am = +s.slice(5, 7), ad = +s.slice(8, 10);
    if (!ay || !am) continue;
    const km = (a.distance || 0) / 1000;
    if (ay === y) {
      months[am - 1] += km; yearActs++;
      if (am === m) monthActs++;
    } else if (ay === y - 1) monthsPrev[am - 1] += km;
    if (ay === py && am === pm) { prevFull += km; if (ad <= d) prevSame += km; }
  }
  const monthKm = months[m - 1];
  const vsPrev = prevSame > 0 ? Math.round((monthKm / prevSame - 1) * 100) : null;
  return {
    months: months.map(r1), monthsPrev: monthsPrev.map(r1), monthKm: r1(monthKm), year: r1(months.reduce((a, b) => a + b, 0)),
    acts: monthActs, yearActs, vsPrev, prevMonthKm: r1(prevFull),
  };
}

// ---------- Análisis ampliado ----------
export const PR_NAMES = { '1k': 1, '5k': 5, '10k': 10, 'Half-Marathon': 21.0975, 'Marathon': 42.195 };
export const EFFORT_BATCH = 20;
const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
const dayStr = n => new Date(n * 86400000).toISOString().slice(0, 10);
const weekStart = n => n - ((new Date(n * 86400000).getUTCDay() + 6) % 7);

export function trim(a) {
  return {
    id: a.id, d: String(a.start_date_local || ''), km: (a.distance || 0) / 1000, t: a.moving_time || 0,
    e: a.total_elevation_gain || 0, hr: a.average_heartrate || null, g: a.gear_id || null,
    n: a.name || '', p: a.map?.summary_polyline || null,
  };
}

export function analyze(runs, today) {
  const { y, m, d } = today, todayN = Date.UTC(y, m - 1, d) / 86400000;
  const mk = () => ({ km: 0, t: 0, e: 0, hrT: 0, hrW: 0 });
  const mon = Array.from({ length: 12 }, mk), yr = mk();
  const days = new Map(), weeks = new Map(), wd = Array(7).fill(0);
  let km84 = 0, last = null;
  for (const r of runs) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(r.d)) continue;
    const n = dayNum(r.d), ry = +r.d.slice(0, 4), rm = +r.d.slice(5, 7);
    days.set(n, (days.get(n) || 0) + r.km);
    const w = weekStart(n); weeks.set(w, (weeks.get(w) || 0) + r.km);
    if (n > todayN - 84 && n <= todayN) km84 += r.km;
    if (!last || r.d > last.d) last = r;
    if (ry === y) {
      for (const b of [mon[rm - 1], yr]) {
        b.km += r.km; b.t += r.t; b.e += r.e;
        if (r.hr) { b.hrT += r.t; b.hrW += r.hr * r.t; }
      }
      wd[(new Date(n * 86400000).getUTCDay() + 6) % 7] += r.km;
    }
  }
  const pace = b => (b.km > 0 ? Math.round(b.t / b.km) : null);
  const hr = b => (b.hrT > 0 ? Math.round(b.hrW / b.hrT) : null);
  const cm = mon[m - 1];
  // rachas
  let dayStreak = 0, c = days.has(todayN) ? todayN : todayN - 1;
  while (days.has(c)) { dayStreak++; c--; }
  const thisW = weekStart(todayN);
  let weekStreak = 0; c = weeks.has(thisW) ? thisW : thisW - 7;
  while (weeks.has(c)) { weekStreak++; c -= 7; }
  let best = null;
  for (const [w, km] of weeks) if (!best || km > best.km) best = { w, km };
  const cal = {};
  for (const [n, km] of days) if (n > todayN - 371 && n <= todayN) cal[dayStr(n)] = r1(km);
  const runDays = [...days.keys()].filter(n => dayStr(n).startsWith(String(y))).length;
  return {
    pace: { month: pace(cm), year: pace(yr) }, time: { month: cm.t, year: yr.t },
    elev: { month: Math.round(cm.e), year: Math.round(yr.e) }, hr: { month: hr(cm), year: hr(yr) },
    paceMonths: mon.map(pace), km84: r1(km84), weekdays: wd.map(r1), days: cal,
    streak: { days: dayStreak, weeks: weekStreak, bestWeekKm: best ? r1(best.km) : 0, bestWeekStart: best ? dayStr(best.w) : null, runDays },
    last: last && { id: last.id, name: last.n, date: last.d.slice(0, 10), time: last.d.slice(11, 16), km: r1(last.km), sec: last.t, pace: last.km > 0 ? Math.round(last.t / last.km) : null, hr: last.hr ? Math.round(last.hr) : null, elev: Math.round(last.e), poly: last.p },
  };
}

export function buildPrs(done, index) {
  const date = new Map(index.map(r => [r.id, r.d]));
  const items = {};
  for (const [id, ef] of Object.entries(done)) {
    for (const [k, t] of Object.entries(ef)) {
      if (!items[k] || t < items[k].t) items[k] = { t, id: +id, d: (date.get(+id) || '').slice(0, 10) };
    }
  }
  const total = index.length, scanned = index.filter(r => done[r.id]).length;
  return { items, scanned, total, pending: total - scanned };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; await fn(it); }
  }));
}

// Procesa un lote de carreras sin analizar para sacar sus mejores esfuerzos (1 petición por carrera).
export async function stepEfforts({ env, store, fetchImpl = fetch, now = Date.now(), batch = EFFORT_BATCH }) {
  const index = (await store.get('runs', { type: 'json' }).catch(() => null)) || [];
  const done = (await store.get('efforts', { type: 'json' }).catch(() => null)) || {};
  const todo = index.filter(r => !done[r.id]).sort((a, b) => b.d.localeCompare(a.d)).slice(0, batch);
  let rateHit = false;
  if (todo.length) {
    const token = await getAccessToken({ env, store, fetchImpl, now });
    await pool(todo, 5, async r => {
      if (rateHit) return;
      try {
        const det = await api(`/activities/${r.id}`, token, fetchImpl);
        const ef = {};
        for (const b of det.best_efforts || []) if (b.name in PR_NAMES && b.elapsed_time > 0) ef[b.name] = Math.min(ef[b.name] ?? Infinity, b.elapsed_time);
        done[r.id] = ef;
      } catch (e) {
        if (e.kind === 'rate') rateHit = true;
        else if (e.status === 404) done[r.id] = {};
      }
    });
    await store.setJSON('efforts', done);
  }
  return { prs: buildPrs(done, index), rate: rateHit };
}

async function loadGear(ids, token, store, fetchImpl, now) {
  const cache = (await store.get('gear', { type: 'json' }).catch(() => null)) || {};
  let err = false;
  await pool(ids.filter(id => !cache[id] || now - cache[id].at > 864e5), 4, async id => {
    try {
      const g = await api(`/gear/${id}`, token, fetchImpl);
      cache[id] = { at: now, name: g.name || [g.brand_name, g.model_name].filter(Boolean).join(' ') || null, km: (g.distance || 0) / 1000, retired: !!g.retired };
    } catch { err = true; }
  });
  await store.setJSON('gear', cache).catch(() => {});
  return { cache, err };
}

export async function fetchDashboardData({ env, store, fetchImpl = fetch, now = new Date() }) {
  const token = await getAccessToken({ env, store, fetchImpl, now: now.getTime() });
  const today = madridNow(now);
  // Todo el historial (200 por página): sirve para total, récords, zapatillas y comparación anual.
  const all = [];
  for (let page = 1; page <= 15; page++) {
    const batch = await api(`/athlete/activities?per_page=200&page=${page}`, token, fetchImpl);
    all.push(...batch);
    if (batch.length < 200) break;
  }
  const runsRaw = all.filter(a => RUN_TYPES.has(a.sport_type || a.type));
  const runs = runsRaw.map(trim);
  const index = runs.filter(r => r.km >= 1).map(r => ({ id: r.id, d: r.d }));
  await store.setJSON('runs', index);
  let athleteId = (await store.get('athlete', { type: 'json' }).catch(() => null))?.id;
  if (!athleteId) {
    athleteId = (await api('/athlete', token, fetchImpl)).id;
    await store.setJSON('athlete', { id: athleteId });
  }
  const stats = await api(`/athletes/${athleteId}/stats`, token, fetchImpl);
  const agg = aggregate(all, today);
  const ana = analyze(runs, today);
  // zapatillas
  const used = new Map();
  for (const r of runs) if (r.g) { const u = used.get(r.g) || { km: 0, last: '' }; u.km += r.km; if (r.d > u.last) u.last = r.d; used.set(r.g, u); }
  const { cache: gc, err: gearErr } = await loadGear([...used.keys()], token, store, fetchImpl, now.getTime());
  let gear = [...used].map(([id, u]) => ({ id, name: gc[id]?.name || null, km: r1(gc[id]?.km ?? u.km), kmRuns: r1(u.km), retired: !!gc[id]?.retired, last: u.last.slice(0, 10) }));
  const active = gear.filter(g => !g.retired);
  gear = (active.length ? active : gear).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 6);
  const done = (await store.get('efforts', { type: 'json' }).catch(() => null)) || {};
  return {
    ok: true, updated: now.toISOString(), ...agg, ...ana, gear, gearErr,
    prs: buildPrs(done, index),
    total: r1((stats.all_run_totals?.distance || 0) / 1000),
    totalActs: stats.all_run_totals?.count || 0,
  };
}
