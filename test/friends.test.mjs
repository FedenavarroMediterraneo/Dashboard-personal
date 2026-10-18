import assert from 'node:assert/strict';
import { applyAction, loadData, validEntry, validFriends } from '../netlify/lib/friends-core.mjs';
const mem = () => { const m = new Map(); return { async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; }, async setJSON(k, v) { m.set(k, JSON.stringify(v)); } }; };
let n = 0; const t = (name, f) => f().then(() => console.log('ok  ', name)).catch(e => { n++; console.log('FAIL', name, e.message); });

await t('validEntry: acepta, redondea y limpia', async () => {
  assert.deepEqual(validEntry({ n: ' Sergi ', d: '2026-10-17', km: '5.456' }), { n: 'Sergi', d: '2026-10-17', km: 5.46 });
  assert.equal(validEntry({ n: '<b>x</b>', d: '2026-10-17', km: 1 }).n, 'bx/b');
});
await t('validEntry: rechaza datos malos', async () => {
  for (const e of [null, {}, { n: '', d: '2026-10-17', km: 1 }, { n: 'a', d: '2026-02-30', km: 1 }, { n: 'a', d: '17/10/2026', km: 1 },
    { n: 'a', d: '2026-10-17', km: 0 }, { n: 'a', d: '2026-10-17', km: -3 }, { n: 'a', d: '2026-10-17', km: 501 }, { n: 'a', d: '2026-10-17', km: 'x' }, { n: 'a', d: '2026-10-17' }])
    assert.equal(validEntry(e), null, JSON.stringify(e));
});
await t('validFriends: duplicados sin importar mayúsculas, límite', async () => {
  assert.deepEqual(validFriends(['Sergi', 'sergi', ' Raúl ', '']), ['Sergi', 'Raúl']);
  assert.equal(validFriends(Array.from({ length: 13 }, (_, i) => 'a' + i)), null);
  assert.equal(validFriends('x'), null);
});
await t('add, listar y borrar', async () => {
  const s = mem();
  const r = await applyAction(s, { action: 'add', entry: { n: 'Sergi', d: '2026-10-17', km: 8 } });
  assert.equal(r.status, 200); assert.ok(r.body.entry.id);
  assert.equal((await loadData(s)).entries.length, 1);
  assert.equal((await applyAction(s, { action: 'add', entry: { n: '', d: '2026-10-17', km: 8 } })).status, 400);
  await applyAction(s, { action: 'del', id: r.body.entry.id });
  assert.equal((await loadData(s)).entries.length, 0);
  assert.equal((await applyAction(s, { action: 'del', id: 'noexiste' })).status, 200);
});
await t('lista de amigos: guardar y rechazar mala', async () => {
  const s = mem();
  assert.equal((await applyAction(s, { action: 'friends', list: ['Sergi', 'Raúl'] })).status, 200);
  assert.deepEqual((await loadData(s)).friends, ['Sergi', 'Raúl']);
  assert.equal((await applyAction(s, { action: 'friends', list: 'x' })).status, 400);
  assert.deepEqual((await loadData(s)).friends, ['Sergi', 'Raúl']);
});
await t('import: solo con el servidor vacío, filtra inválidos', async () => {
  const s = mem();
  let r = await applyAction(s, { action: 'import', friends: ['A'], entries: [{ n: 'A', d: '2026-10-01', km: 3 }, { n: 'A', d: 'mal', km: 3 }] });
  assert.equal(r.body.imported, 1);
  r = await applyAction(s, { action: 'import', friends: ['B'], entries: [{ n: 'B', d: '2026-10-01', km: 9 }] });
  assert.equal(r.body.imported, 0);
  const d = await loadData(s); assert.equal(d.entries.length, 1); assert.deepEqual(d.friends, ['A']);
});
await t('PlayStation a mano: guarda, sanea y no se pierde con otras acciones', async () => {
  const s = mem();
  assert.equal((await applyAction(s, { action: 'ps', ps: { level: 12, plat: 1, gold: 2, silver: 3, bronze: 4, last: 'Juego<b>' } })).status, 200);
  await applyAction(s, { action: 'friends', list: ['A'] });
  const d = await loadData(s);
  assert.deepEqual(d.ps, { level: 12, plat: 1, gold: 2, silver: 3, bronze: 4, last: 'Juegob' });
  assert.equal((await applyAction(s, { action: 'ps', ps: 'x' })).status, 400);
});
await t('roleOf: admin, solo lectura y claves malas', async () => {
  const { roleOf } = await import('../netlify/lib/http.mjs');
  const rq = k => ({ headers: { get: () => k } });
  const env = { DASH_KEY: 'admin-secreta-123', VIEW_KEY: 'solo-ver-456789' };
  assert.equal(roleOf(rq('admin-secreta-123'), env), 'admin');
  assert.equal(roleOf(rq('solo-ver-456789'), env), 'view');
  assert.equal(roleOf(rq('otra'), env), null);
  assert.equal(roleOf(rq(null), env), null);
  assert.equal(roleOf(rq('corta'), { DASH_KEY: 'x'.repeat(20), VIEW_KEY: 'corta' }), null);
  assert.equal(roleOf(rq(''), { DASH_KEY: 'x'.repeat(20) }), null);
});
await t('acción desconocida o cuerpo vacío', async () => {
  const s = mem();
  assert.equal((await applyAction(s, { action: 'borrar-todo' })).status, 400);
  assert.equal((await applyAction(s, null)).status, 400);
});
await t('datos corruptos en el almacén no rompen', async () => {
  const s = mem(); await s.setJSON('data', { friends: 'x', entries: 5 });
  assert.deepEqual(await loadData(s), { friends: null, entries: [], ps: null });
});
if (n) { console.log(n + ' fallos'); process.exit(1); } else console.log('todo OK');
