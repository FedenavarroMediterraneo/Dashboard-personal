// Kilómetros de amigos: validación y operaciones sobre un almacén (Netlify Blobs en producción).
export const MAX_ENTRIES = 5000, MAX_FRIENDS = 12, MAX_IMPORT = 2000;
const clean = s => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
const validDate = d => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === d;
};
export function validEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const n = clean(e.n), km = Math.round(Number(e.km) * 100) / 100;
  if (!n || !validDate(e.d) || !Number.isFinite(km) || km <= 0 || km > 500) return null;
  return { n, d: e.d, km };
}
export function validFriends(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const x of list) {
    const n = clean(x);
    if (n && !out.some(o => o.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out.length <= MAX_FRIENDS ? out : null;
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const num = (v, mx) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= mx ? n : 0; };
export function validPs(p) {
  if (!p || typeof p !== 'object') return null;
  return { level: num(p.level, 999), plat: num(p.plat, 9999), gold: num(p.gold, 9999), silver: num(p.silver, 9999), bronze: num(p.bronze, 99999),
    last: String(p.last ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) };
}

export async function loadData(store) {
  const d = await store.get('data', { type: 'json' }).catch(() => null);
  return { friends: Array.isArray(d?.friends) ? d.friends : null, entries: Array.isArray(d?.entries) ? d.entries : [], ps: d?.ps && typeof d.ps === 'object' ? d.ps : null };
}

// Devuelve { status, body }
export async function applyAction(store, body) {
  const data = await loadData(store);
  const bad = msg => ({ status: 400, body: { ok: false, error: msg } });
  switch (body?.action) {
    case 'add': {
      const e = validEntry(body.entry ?? body);
      if (!e) return bad('invalid');
      if (data.entries.length >= MAX_ENTRIES) return bad('full');
      const entry = { id: newId(), ...e };
      data.entries.push(entry);
      await store.setJSON('data', data);
      return { status: 200, body: { ok: true, entry } };
    }
    case 'del': {
      const id = String(body.id ?? '');
      data.entries = data.entries.filter(x => x.id !== id);
      await store.setJSON('data', data);
      return { status: 200, body: { ok: true } };
    }
    case 'friends': {
      const f = validFriends(body.list);
      if (!f) return bad('invalid');
      data.friends = f;
      await store.setJSON('data', data);
      return { status: 200, body: { ok: true } };
    }
    case 'ps': {
      const p = validPs(body.ps);
      if (!p) return bad('invalid');
      data.ps = p;
      await store.setJSON('data', data);
      return { status: 200, body: { ok: true } };
    }
    case 'import': {
      // Solo si el servidor está vacío: sube lo que había guardado en el navegador.
      if (data.entries.length || data.friends) return { status: 200, body: { ok: true, imported: 0 } };
      const entries = (Array.isArray(body.entries) ? body.entries.slice(0, MAX_IMPORT) : []).map(validEntry).filter(Boolean).map(e => ({ id: newId(), ...e }));
      const f = body.friends == null ? null : validFriends(body.friends);
      data.entries = entries; data.friends = f;
      await store.setJSON('data', data);
      return { status: 200, body: { ok: true, imported: entries.length } };
    }
    default:
      return bad('action');
  }
}
