import { getStore } from '@netlify/blobs';
import { safeEq } from '../lib/strava-core.mjs';
import { responder, roleOf } from '../lib/http.mjs';
import { loadData, applyAction } from '../lib/friends-core.mjs';

export default async (req) => {
  const { json, preflight } = responder(req);
  const env = process.env;
  if (req.method === 'OPTIONS') return preflight();
  if (!env.DASH_KEY) return json({ ok: false, error: 'config' }, 500);
  const role = roleOf(req, env);
  if (!role) return json({ ok: false, error: 'key' }, 401);
  if (req.method === 'POST' && role !== 'admin') return json({ ok: false, error: 'readonly' }, 403);
  try {
    const store = getStore('friends');
    if (req.method === 'GET') return json({ ok: true, role, ...(await loadData(store)) });
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
    const text = await req.text();
    if (text.length > 300000) return json({ ok: false, error: 'size' }, 413);
    let body = null; try { body = JSON.parse(text); } catch {}
    const r = await applyAction(store, body);
    return json(r.body, r.status);
  } catch {
    return json({ ok: false, error: 'unknown' }, 500);
  }
};
