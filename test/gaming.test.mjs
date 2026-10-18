import assert from 'node:assert/strict';
import { getSteam, getXbox, getPsn, getNintendo, platformData, GamingError, CACHE_MS } from '../netlify/lib/gaming-core.mjs';
const mem = () => { const m = new Map(); return { async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; }, async setJSON(k, v) { m.set(k, JSON.stringify(v)); } }; };
let n = 0; const t = (name, f) => f().then(() => console.log('ok  ', name)).catch(e => { n++; console.log('FAIL', name, e.message); });
const resp = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const rejects = async (p, kind) => { try { await p; } catch (e) { assert.equal(e.kind, kind); return; } assert.fail('debía fallar con ' + kind); };

await t('steam: horas, últimas 2 semanas, barras y más jugado', async () => {
  const games = [{ appid: 1, name: 'Factorio', playtime_forever: 18720, playtime_2weeks: 300 }, { appid: 2, name: 'Hades', playtime_forever: 600, playtime_2weeks: 90 }, { appid: 3, name: 'Viejo', playtime_forever: 60 }];
  const seen = []; const f = async u => { seen.push(u); return resp({ response: { games } }); };
  const d = await getSteam({ env: { STEAM_API_KEY: 'K', STEAM_ID: '7656' }, fetchImpl: f });
  assert.equal(d.hours, 323); assert.equal(d.two, 6.5);
  assert.deepEqual(d.bars, [5, 1.5]); assert.deepEqual(d.names, ['Factorio', 'Hades']);
  assert.deepEqual(d.top, { name: 'Factorio', hours: 312 });
  assert.ok(seen[0].includes('steamid=7656'));
});
await t('steam: perfil privado, clave mala, sin configurar', async () => {
  await rejects(getSteam({ env: { STEAM_API_KEY: 'K', STEAM_ID: '1' }, fetchImpl: async () => resp({ response: {} }) }), 'private');
  await rejects(getSteam({ env: { STEAM_API_KEY: 'K', STEAM_ID: '1' }, fetchImpl: async () => resp({}, 403) }), 'auth');
  await rejects(getSteam({ env: {}, fetchImpl: async () => resp({}) }), 'config');
});
await t('xbox: gamertag, gamerscore, logros y último juego', async () => {
  const f = async u => u.endsWith('/account')
    ? resp({ profileUsers: [{ settings: [{ id: 'Gamertag', value: 'FedeNavarro' }, { id: 'Gamerscore', value: '57683' }] }] })
    : resp({ titles: [{ name: 'A', lastUnlock: '2026-10-10T10:00:00Z', achievement: { currentAchievements: 10 } }, { name: 'B', lastUnlock: '2026-10-15T10:00:00Z', achievement: { currentAchievements: 5 } }, { name: 'C', lastUnlock: '0001-01-01T00:00:00Z', achievement: { currentAchievements: 0 } }] });
  const d = await getXbox({ env: { XBL_API_KEY: 'k' }, fetchImpl: f });
  assert.equal(d.tag, 'FedeNavarro'); assert.equal(d.score, 57683); assert.equal(d.ach, 15); assert.deepEqual(d.last, { game: 'B', at: '2026-10-15T10:00:00Z' });
});
await t('xbox: si fallan los logros, sigue dando el perfil; respuesta rara = error', async () => {
  const f = async u => u.endsWith('/account') ? resp({ profileUsers: [{ settings: [{ id: 'Gamertag', value: 'X' }] }] }) : resp({}, 500);
  const d = await getXbox({ env: { XBL_API_KEY: 'k' }, fetchImpl: f });
  assert.equal(d.tag, 'X'); assert.equal(d.ach, null); assert.equal(d.last, null);
  await rejects(getXbox({ env: { XBL_API_KEY: 'k' }, fetchImpl: async () => resp({ nada: 1 }) }), 'api');
  await rejects(getXbox({ env: {}, fetchImpl: async () => resp({}) }), 'config');
});
const fakePsn = (calls = []) => ({
  exchangeNpssoForAccessCode: async () => { calls.push('npsso'); return 'code'; },
  exchangeAccessCodeForAuthTokens: async () => { calls.push('code'); return { accessToken: 'A1', expiresIn: 3600, refreshToken: 'R1', refreshTokenExpiresIn: 5184000 }; },
  exchangeRefreshTokenForAuthTokens: async () => { calls.push('refresh'); return { accessToken: 'A2', expiresIn: 3600, refreshToken: 'R2', refreshTokenExpiresIn: 5184000 }; },
  getUserTrophyProfileSummary: async (a) => { calls.push('sum:' + a.accessToken); return { trophyLevel: 412, earnedTrophies: { platinum: 12, gold: 102, silver: 432, bronze: 2981 } }; },
  getUserTitles: async () => ({ trophyTitles: [{ trophyTitleName: 'Final Fantasy XVI', lastUpdatedDateTime: '2026-10-13T20:00:00Z' }] }),
});
await t('psn: trofeos y sesión guardada (NPSSO, luego refresco, luego caché)', async () => {
  const s = mem(), calls = [], psn = fakePsn(calls), t0 = 1e12;
  const d = await getPsn({ env: { NPSSO: 'x' }, store: s, now: t0, psn });
  assert.equal(d.level, 412); assert.equal(d.plat, 12); assert.equal(d.bronze, 2981); assert.equal(d.last.game, 'Final Fantasy XVI');
  assert.deepEqual(calls.slice(0, 3), ['npsso', 'code', 'sum:A1']);
  calls.length = 0; await getPsn({ env: { NPSSO: 'x' }, store: s, now: t0 + 600e3, psn });
  assert.deepEqual(calls, ['sum:A1']); // token de acceso aún válido
  calls.length = 0; await getPsn({ env: { NPSSO: 'x' }, store: s, now: t0 + 2 * 3600e3, psn });
  assert.deepEqual(calls, ['refresh', 'sum:A2']); // caducó el acceso, se usa el refresco y no el NPSSO
});
await t('psn: NPSSO inválido = auth; sin NPSSO = config', async () => {
  const bad = { ...fakePsn(), exchangeNpssoForAccessCode: async () => { throw new Error('x'); } };
  await rejects(getPsn({ env: { NPSSO: 'x' }, store: mem(), psn: bad }), 'auth');
  await rejects(getPsn({ env: {}, store: mem(), psn: fakePsn() }), 'config');
});
await t('nintendo: valida el formato del código', async () => {
  assert.deepEqual(await getNintendo({ env: { NINTENDO_CODE: ' sw-1234-5678-9012 ' } }), { code: 'SW-1234-5678-9012' });
  await rejects(getNintendo({ env: { NINTENDO_CODE: '1234' } }), 'format');
  await rejects(getNintendo({ env: {} }), 'config');
});
await t('caché de 30 min, force y datos antiguos si la plataforma falla', async () => {
  const s = mem(), env = { NINTENDO_CODE: 'SW-1111-2222-3333', STEAM_API_KEY: 'k', STEAM_ID: '1' }; let calls = 0;
  const f = async () => { calls++; return calls > 1 ? resp({}, 500) : resp({ response: { games: [{ appid: 1, name: 'A', playtime_forever: 60 }] } }); };
  const a = await platformData('steam', { env, store: s, fetchImpl: f, now: 1000 });
  assert.equal(a.cached, false); assert.equal(a.data.hours, 1);
  const b = await platformData('steam', { env, store: s, fetchImpl: f, now: 1000 + 60e3 });
  assert.equal(b.cached, true); assert.equal(calls, 1);
  const c = await platformData('steam', { env, store: s, fetchImpl: f, now: 1000 + CACHE_MS + 1 });
  assert.equal(c.stale, true); assert.equal(c.data.hours, 1);
  await rejects(platformData('xyz', { env, store: s }), 'platform');
  await rejects(platformData('xbox', { env: {}, store: s }), 'config');
});
if (n) { console.log(n + ' fallos'); process.exit(1); } else console.log('todo OK');
