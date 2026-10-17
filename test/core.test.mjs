import assert from 'node:assert/strict';
import { aggregate, analyze, syncRuns, buildPrs, stepEfforts, trim, getAccessToken, fetchDashboardData, signState, checkState, safeEq, StravaError } from '../netlify/lib/strava-core.mjs';

const mem = () => { const m = new Map(); return { m,
  async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
  async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
  async delete(k) { m.delete(k); } }; };
const act = (d, km, t = 'Run') => ({ start_date_local: d + 'T07:00:00Z', distance: km * 1000, sport_type: t });
const env = { STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: 's' };
let n = 0; const t = (name, f) => f().then(() => console.log('ok  ', name)).catch(e => { n++; console.log('FAIL', name, e.message); });

await t('aggregate: filtra deportes, meses y comparación mismo día', async () => {
  const a = aggregate([
    act('2026-10-02', 10), act('2026-10-10', 5), act('2026-10-12', 99, 'Ride'), act('2026-10-14', 3, 'TrailRun'),
    act('2026-09-05', 10), act('2026-09-20', 40), act('2026-01-01', 7), act('2025-10-05', 500),
  ], { y: 2026, m: 10, d: 15 });
  assert.equal(a.monthKm, 18); assert.equal(a.acts, 3); assert.equal(a.year, 75);
  assert.equal(a.months[9], 18); assert.equal(a.months[8], 50); assert.equal(a.months[0], 7);
  assert.equal(a.prevMonthKm, 50); assert.equal(a.vsPrev, 80); // 18 vs 10 (hasta el día 15)
});
await t('aggregate: enero compara con diciembre anterior; sin base -> null', async () => {
  const a = aggregate([act('2026-01-03', 12), act('2025-12-02', 6), act('2025-12-30', 50)], { y: 2026, m: 1, d: 10 });
  assert.equal(a.vsPrev, 100);
  assert.equal(aggregate([act('2026-10-02', 5)], { y: 2026, m: 10, d: 5 }).vsPrev, null);
});
await t('aggregate: vacío y fechas rotas', async () => {
  const a = aggregate([{ distance: 5 }, { sport_type: 'Run' }], { y: 2026, m: 10, d: 1 });
  assert.equal(a.year, 0); assert.equal(a.months.length, 12);
});
await t('token: usa el guardado si no ha caducado', async () => {
  const s = mem(); await s.setJSON('token', { access_token: 'A', refresh_token: 'R', expires_at: 2e9 });
  assert.equal(await getAccessToken({ env, store: s, fetchImpl: () => { throw new Error('no debe llamar'); }, now: 1e12 }), 'A');
});
await t('token: renueva y guarda el refresh token nuevo (rotación)', async () => {
  const s = mem(); await s.setJSON('token', { access_token: 'old', refresh_token: 'R1', expires_at: 1 });
  let body;
  const f = async (u, o) => { body = String(o.body); return { ok: true, status: 200, json: async () => ({ access_token: 'N', refresh_token: 'R2', expires_at: 2e9 }) }; };
  assert.equal(await getAccessToken({ env, store: s, fetchImpl: f, now: 1e12 }), 'N');
  assert.match(body, /refresh_token=R1/);
  assert.equal((await s.get('token')).refresh_token, 'R2');
});
await t('token: si no devuelve refresh nuevo conserva el anterior', async () => {
  const s = mem(); await s.setJSON('token', { access_token: 'o', refresh_token: 'R1', expires_at: 1 });
  const f = async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'N', expires_at: 2e9 }) });
  await getAccessToken({ env, store: s, fetchImpl: f, now: 1e12 });
  assert.equal((await s.get('token')).refresh_token, 'R1');
});
await t('token: sin conexión -> not_connected; 429 -> rate; 400 -> not_connected', async () => {
  await assert.rejects(getAccessToken({ env, store: mem(), fetchImpl: fetch }), e => e.kind === 'not_connected');
  const s = mem(); await s.setJSON('token', { refresh_token: 'R', expires_at: 1 });
  await assert.rejects(getAccessToken({ env, store: s, fetchImpl: async () => ({ ok: false, status: 429 }) }), e => e.kind === 'rate');
  await assert.rejects(getAccessToken({ env, store: s, fetchImpl: async () => ({ ok: false, status: 400 }) }), e => e.kind === 'not_connected');
});
await t('token: variable de entorno como respaldo', async () => {
  let body; const f = async (u, o) => { body = String(o.body); return { ok: true, status: 200, json: async () => ({ access_token: 'N', refresh_token: 'R9', expires_at: 2e9 }) }; };
  await getAccessToken({ env: { ...env, STRAVA_REFRESH_TOKEN: 'ENV' }, store: mem(), fetchImpl: f });
  assert.match(body, /refresh_token=ENV/);
});
const run = (id, d, km, extra = {}) => ({ id, start_date_local: d + 'T07:30:00Z', distance: km * 1000, moving_time: Math.round(km * 330), total_elevation_gain: km * 5, sport_type: 'Run', name: 'Carrera ' + id, ...extra });
await t('analyze: rachas, semanas, ritmo, calendario, día de la semana', async () => {
  // hoy = viernes 2026-10-16
  const runs = [run(1, '2026-10-16', 10, { average_heartrate: 150 }), run(2, '2026-10-15', 5, { average_heartrate: 140 }), run(3, '2026-10-14', 5),
    run(4, '2026-10-10', 8), run(5, '2026-10-01', 20), run(6, '2026-09-30', 7)].map(trim);
  const a = analyze(runs, { y: 2026, m: 10, d: 16 });
  assert.equal(a.streak.days, 3); // 14,15,16 (el 13 no hay)
  assert.equal(a.streak.weeks, 3); // semanas del 12/10, 5/10 y 28/9 (con 30/09 y 01/10)... 5/10: 10/10 sí; 28/9: 30/9 y 1/10 sí
  assert.equal(a.pace.month, 330); assert.equal(a.pace.year, 330);
  assert.equal(a.hr.month, Math.round((150 * 3300 + 140 * 1650) / (3300 + 1650)));
  assert.equal(a.weekdays[4], 10); // viernes
  assert.equal(a.days['2026-10-16'], 10); assert.equal(a.km84, 55);
  assert.equal(a.last.name, 'Carrera 1'); assert.equal(a.last.km, 10);
  assert.equal(a.streak.bestWeekKm, 27); // semana 28/9: 7+20; la del 12/10 suma 20
});
await t('analyze: si hoy no has corrido la racha sigue desde ayer; vacío no rompe', async () => {
  const a = analyze([run(1, '2026-10-15', 5)].map(trim), { y: 2026, m: 10, d: 16 });
  assert.equal(a.streak.days, 1); assert.equal(a.streak.weeks, 1);
  const e = analyze([], { y: 2026, m: 10, d: 16 });
  assert.equal(e.last, null); assert.equal(e.pace.year, null); assert.equal(e.streak.days, 0); assert.equal(e.streak.bestWeekStart, null);
});
await t('analyze: semana que cruza de año y racha tras fin de año', async () => {
  const a = analyze([run(1, '2026-01-01', 5), run(2, '2025-12-31', 5), run(3, '2025-12-30', 5)].map(trim), { y: 2026, m: 1, d: 2 });
  assert.equal(a.streak.days, 3); assert.equal(a.streak.weeks, 1); // 30/12, 31/12 y 1/1 caen en la misma semana (lunes 29/12)
});
await t('buildPrs: elige el mejor y cuenta pendientes', async () => {
  const index = [{ id: 1, d: '2026-01-01T07:00:00Z' }, { id: 2, d: '2026-02-01T07:00:00Z' }, { id: 3, d: '2026-03-01T07:00:00Z' }];
  const p = buildPrs({ 1: { '5k': 1500 }, 2: { '5k': 1400, '10k': 3000 } }, index);
  assert.equal(p.items['5k'].t, 1400); assert.equal(p.items['5k'].id, 2); assert.equal(p.items['5k'].d, '2026-02-01');
  assert.equal(p.pending, 1); assert.equal(p.scanned, 2);
});
const authStore = async () => { const s = mem(); await s.setJSON('token', { access_token: 'A', refresh_token: 'R', expires_at: 2e9 }); return s; };
await t('stepEfforts: lote, solo nombres útiles, no repite, 404 se marca', async () => {
  const s = await authStore();
  await s.setJSON('runs', Array.from({ length: 5 }, (_, i) => ({ id: i + 1, d: `2026-0${i + 1}-01T07:00:00Z` })));
  const calls = [];
  const f = async u => {
    calls.push(u); const id = +u.split('/').pop();
    if (id === 2) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => ({ best_efforts: [{ name: '5k', elapsed_time: 1400 + id }, { name: '400m', elapsed_time: 90 }, { name: '5k', elapsed_time: 1500 }] }) };
  };
  let r = await stepEfforts({ env, store: s, fetchImpl: f, batch: 3 });
  assert.equal(calls.length, 3); assert.equal(r.prs.pending, 2); assert.equal(r.prs.items['5k'].t, 1403); // lote más reciente: ids 5,4,3 -> mejor 1403
  r = await stepEfforts({ env, store: s, fetchImpl: f, batch: 3 });
  assert.equal(calls.length, 5); assert.equal(r.prs.pending, 0);
  r = await stepEfforts({ env, store: s, fetchImpl: f, batch: 3 });
  assert.equal(calls.length, 5);
});
await t('stepEfforts: 429 a mitad conserva lo hecho y avisa', async () => {
  const s = await authStore();
  await s.setJSON('runs', [{ id: 1, d: '2026-05-01T07:00:00Z' }, { id: 2, d: '2026-04-01T07:00:00Z' }]);
  let n = 0;
  const f = async () => (++n === 1 ? { ok: true, status: 200, json: async () => ({ best_efforts: [{ name: '1k', elapsed_time: 200 }] }) } : { ok: false, status: 429 });
  const r = await stepEfforts({ env, store: s, fetchImpl: f, batch: 5 });
  assert.equal(r.rate, true); assert.ok(r.prs.scanned >= 1); assert.ok(r.prs.pending <= 1);
});
await t('fetchDashboardData: historial completo, zapatillas, athlete en caché, total', async () => {
  const s = await authStore();
  const calls = [];
  const page1 = Array.from({ length: 200 }, (_, i) => run(1000 + i, '2025-03-01', 0.1, { gear_id: 'g1' }));
  const f = async u => {
    calls.push(u);
    const json = u.includes('page=1') ? page1 : u.includes('page=2') ? [run(1, '2026-10-03', 10, { gear_id: 'g2', map: { summary_polyline: 'abc' } })]
      : u.endsWith('/athlete') ? { id: 42 } : u.includes('/gear/g1') ? { name: 'Vieja', distance: 900000, retired: true }
      : u.includes('/gear/g2') ? { name: 'Nike Pegasus', distance: 123400 } : { all_run_totals: { distance: 4582000, count: 300 } };
    return { ok: true, status: 200, json: async () => json };
  };
  const now = new Date('2026-10-15T10:00:00Z');
  const d = await fetchDashboardData({ env, store: s, fetchImpl: f, now });
  assert.equal(d.total, 4582); assert.equal(d.totalActs, 300); assert.equal(d.monthKm, 10); assert.equal(d.monthsPrev[2], 20);
  assert.equal(d.gear.length, 1); assert.equal(d.gear[0].name, 'Nike Pegasus'); assert.equal(d.gear[0].km, 123.4);
  assert.equal(d.last.poly, 'abc'); assert.equal(d.prs.total, 1); // las 200 de 0,1 km no cuentan
  assert.equal(d.prs.pending, 1); assert.equal(d.gearErr, false);
  await fetchDashboardData({ env, store: s, fetchImpl: f, now });
  assert.equal(calls.filter(c => c.endsWith('/athlete')).length, 1);
  assert.equal(calls.filter(c => c.includes('/gear/')).length, 2); // gear cacheado 24 h
});
await t('fetchDashboardData: sin permiso de zapatillas no rompe', async () => {
  const s = await authStore();
  const f = async u => u.includes('/gear/') ? { ok: false, status: 403 }
    : { ok: true, status: 200, json: async () => (u.includes('activities?') ? [run(1, '2026-10-03', 10, { gear_id: 'g2' })] : u.endsWith('/athlete') ? { id: 1 } : { all_run_totals: {} }) };
  const d = await fetchDashboardData({ env, store: s, fetchImpl: f, now: new Date('2026-10-15T10:00:00Z') });
  assert.equal(d.gearErr, true); assert.equal(d.gear[0].name, null); assert.equal(d.gear[0].km, 10);
});
await t('fetchDashboardData: error 429 en actividades', async () => {
  const s = await authStore();
  await assert.rejects(fetchDashboardData({ env, store: s, fetchImpl: async () => ({ ok: false, status: 429 }) }), e => e instanceof StravaError && e.kind === 'rate');
});
await t('syncRuns: primera vez completa, luego incremental con after=, fusiona y vuelve a bajar todo cada 24 h', async () => {
  const s = await authStore(); const calls = [];
  let serve = [run(1, '2026-10-01', 10, { map: { summary_polyline: 'AAA' } }), run(2, '2026-09-01', 5, { map: { summary_polyline: 'BBB' } }), run(9, '2026-10-02', 99, { sport_type: 'Ride' })];
  const f = async u => { calls.push(u); return { ok: true, status: 200, json: async () => serve }; };
  const t0 = new Date('2026-10-16T08:00:00Z');
  let r = await syncRuns({ token: 'A', store: s, fetchImpl: f, now: t0 });
  assert.equal(r.full, true); assert.ok(!calls[0].includes('after=')); assert.equal(r.runs.length, 2);
  // incremental: una carrera editada (id 1: 12 km) y una nueva (id 3)
  serve = [run(1, '2026-10-01', 12), run(3, '2026-10-16', 6, { map: { summary_polyline: 'CCC' } })];
  r = await syncRuns({ token: 'A', store: s, fetchImpl: f, now: new Date(t0.getTime() + 3600e3) });
  assert.equal(r.full, false); assert.match(calls[1], /after=\d+&per_page=200&page=1/);
  const after = +calls[1].match(/after=(\d+)/)[1];
  assert.equal(after, Math.floor(t0.getTime() / 1000) - 7 * 86400);
  assert.deepEqual(r.runs.map(x => x.id).sort(), [1, 2, 3]); assert.equal(r.runs.find(x => x.id === 1).km, 12);
  assert.equal(r.runs.find(x => x.id === 3).p, 'CCC'); assert.equal(r.runs.find(x => x.id === 1).p, null); assert.equal(r.runs.find(x => x.id === 2).p, null);
  // pasadas 24 h: completa otra vez y se descarta lo que ya no existe en Strava (id 2)
  serve = [run(1, '2026-10-01', 12), run(3, '2026-10-16', 6)];
  r = await syncRuns({ token: 'A', store: s, fetchImpl: f, now: new Date(t0.getTime() + 25 * 3600e3) });
  assert.equal(r.full, true); assert.ok(!calls[2].includes('after=')); assert.deepEqual(r.runs.map(x => x.id).sort(), [1, 3]);
});
await t('syncRuns: si Strava falla en incremental no se pierde lo guardado', async () => {
  const s = await authStore();
  await syncRuns({ token: 'A', store: s, fetchImpl: async () => ({ ok: true, status: 200, json: async () => [run(1, '2026-10-01', 10)] }), now: new Date('2026-10-16T08:00:00Z') });
  await assert.rejects(syncRuns({ token: 'A', store: s, fetchImpl: async () => ({ ok: false, status: 429 }), now: new Date('2026-10-16T09:00:00Z') }), e => e.kind === 'rate');
  assert.equal((await s.get('activities')).runs.length, 1);
});
await t('estado firmado: válido, manipulado, caducado, vacío', async () => {
  const st = signState('k', 1000);
  assert.ok(checkState('k', st, 2000)); assert.ok(!checkState('otra', st, 2000));
  assert.ok(!checkState('k', st, 1000 + 11 * 60000)); assert.ok(!checkState('k', '', 2000)); assert.ok(!checkState('k', 'x.y', 2000));
});
await t('safeEq', async () => { assert.ok(safeEq('ab', 'ab')); assert.ok(!safeEq('ab', 'ac')); assert.ok(!safeEq('', '')); assert.ok(!safeEq(null, 'a')); });

if (n) { console.log(n + ' fallos'); process.exit(1); } else console.log('todo OK');
