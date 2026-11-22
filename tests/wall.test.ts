// The wall API against real SQLite (D1 is SQLite) and an in-memory R2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { layerFor, newDoc, pngTextFor, withProvenance, type EditorAsset } from '../src/lib/composition.ts';
import { withPngText } from '../src/lib/png-meta.ts';
import { checkComposerPng, cleanText, handle, type D1Like, type R2Like, type WallEnv } from '../src/lib/wall-api.ts';

function d1(): D1Like {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_wall.sql', import.meta.url), 'utf8'));
  return {
    prepare: (sql) => ({
      bind: (...v) => {
        // D1 uses ?1 ?2…; node:sqlite accepts the same numbered parameters
        const st = db.prepare(sql);
        return {
          run: async () => st.run(...(v as never[])),
          all: async <T>() => ({ results: st.all(...(v as never[])) as T[] }),
          first: async <T>() => (st.get(...(v as never[])) as T) ?? null,
        };
      },
    }),
  };
}
function r2(): R2Like & { keys: () => string[] } {
  const m = new Map<string, Uint8Array>();
  return {
    keys: () => [...m.keys()],
    put: async (k, v) => void m.set(k, new Uint8Array(v as ArrayBuffer)),
    get: async (k) => (m.has(k) ? { body: null, arrayBuffer: async () => m.get(k)!.slice().buffer } : null),
    delete: async (k) => void m.delete(k),
  };
}
const PNG1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const asset: EditorAsset = { id: 'sq3-19', name: 'quadrado-50', slug: 'q', version: '1.1.0', width: 10, height: 10, license: 'CC0 1.0', vector: true, display: '', raster: '', embed: '', searchText: '' };
function composerPng() {
  let doc = newDoc('0.1.0');
  doc.layers.push(layerFor(asset, doc));
  doc = withProvenance(doc, new Map([[asset.id, asset]]));
  return withPngText(PNG1, pngTextFor(doc));
}
const okTurnstile = (async () => new Response(JSON.stringify({ success: true }))) as unknown as typeof fetch;
const noTurnstile = (async () => new Response(JSON.stringify({ success: false }))) as unknown as typeof fetch;
const env = (): WallEnv & { WALL: ReturnType<typeof r2> } => ({ DB: d1(), WALL: r2(), ADMIN_TOKEN: 'secret-token', TURNSTILE_SECRET: 'real-secret' });
const base = 'https://lumassets.test';
function share(png: Uint8Array<ArrayBuffer>, fields: Record<string, string> = {}, origin = base) {
  const form = new FormData();
  form.append('image', new Blob([png], { type: 'image/png' }), 'a.png');
  form.append('turnstile', 'token');
  for (const [k, v] of Object.entries({ title: 'Weird one', author: 'ana', ...fields })) form.append(k, v);
  return new Request(`${origin}/api/wall`, { method: 'POST', body: form });
}
const admin = (path: string, init: RequestInit = {}) =>
  new Request(`${base}${path}`, { ...init, headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' } });

test('share → pending (not public) → approve → on the wall', async () => {
  const e = env();
  const res = await handle(share(composerPng()), e, okTurnstile);
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };
  assert.deepEqual(e.WALL.keys(), [`wall/${id}.png`]);

  // not public yet: not listed, and its image is a 404
  assert.deepEqual(((await (await handle(new Request(`${base}/api/wall`), e)).json()) as { posts: unknown[] }).posts, []);
  assert.equal((await handle(new Request(`${base}/api/wall/${id}.png`), e)).status, 404);
  // the admin sees it, image included
  const queue = (await (await handle(admin('/api/admin/wall?status=pending'), e)).json()) as { posts: { id: string; title: string }[] };
  assert.deepEqual(queue.posts.map((p) => [p.id, p.title]), [[id, 'Weird one']]);
  assert.equal((await handle(admin(`/api/wall/${id}.png`), e)).status, 200);

  await handle(admin(`/api/admin/wall/${id}`, { method: 'POST', body: JSON.stringify({ action: 'approve' }) }), e);
  const wall = (await (await handle(new Request(`${base}/api/wall`), e)).json()) as { posts: { id: string; author: string; width: number }[] };
  assert.deepEqual(wall.posts.map((p) => [p.id, p.author, p.width]), [[id, 'ana', 1]]);
  const img = await handle(new Request(`${base}/api/wall/${id}.png`), e);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  // hide: off the wall again, kept for the admin
  await handle(admin(`/api/admin/wall/${id}`, { method: 'POST', body: JSON.stringify({ action: 'hide' }) }), e);
  assert.equal((await handle(new Request(`${base}/api/wall/${id}.png`), e)).status, 404);
});

test('reject deletes the image and the entry', async () => {
  const e = env();
  const { id } = (await (await handle(share(composerPng()), e, okTurnstile)).json()) as { id: string };
  const r = await handle(admin(`/api/admin/wall/${id}`, { method: 'POST', body: JSON.stringify({ action: 'reject' }) }), e);
  assert.equal(r.status, 200);
  assert.deepEqual(e.WALL.keys(), []);
  assert.equal((await handle(admin(`/api/wall/${id}.png`), e)).status, 404);
});

test('only PNGs from the composer, only people, only with the token', async () => {
  const e = env();
  assert.equal((await handle(share(PNG1), e, okTurnstile)).status, 400); // a PNG, but not from the composer
  assert.equal((await handle(share(new TextEncoder().encode('<svg/>')), e, okTurnstile)).status, 400);
  assert.equal((await handle(share(composerPng()), e, noTurnstile)).status, 403); // Turnstile said no
  assert.equal((await handle(share(composerPng()), { ...e, TURNSTILE_SECRET: undefined }, okTurnstile)).status, 503); // not set up
  const huge = new Request(`${base}/api/wall`, { method: 'POST', body: 'x', headers: { 'content-length': String(20 * 1024 * 1024) } });
  assert.equal((await handle(huge, e, okTurnstile)).status, 413); // refused before reading the body
  assert.deepEqual(e.WALL.keys(), []);
  assert.equal((await handle(new Request(`${base}/api/admin/wall`), e)).status, 401);
  const wrong = new Request(`${base}/api/admin/wall`, { headers: { authorization: 'Bearer nope' } });
  assert.equal((await handle(wrong, e)).status, 401);
  assert.equal((await handle(admin('/api/admin/wall'), { ...e, ADMIN_TOKEN: undefined })).status, 401); // no token set: admin off
});

test("Cloudflare's always-pass test key only works on localhost", async () => {
  const e = { ...env(), TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' };
  assert.equal((await handle(share(composerPng()), e, okTurnstile)).status, 503);
  assert.equal((await handle(share(composerPng(), {}, 'http://localhost:8788'), e, okTurnstile)).status, 201);
});

test('titles and names are plain, short text', () => {
  assert.equal(cleanText('  hi\u0000 <b>there</b>\n\n', 80), 'hi <b>there</b>'); // shown with textContent, never as HTML
  assert.equal(cleanText('x'.repeat(200), 80).length, 80);
  assert.equal(cleanText(42, 80), '');
  assert.deepEqual(checkComposerPng(composerPng()), { width: 1, height: 1 });
});

test('answers carry nosniff, and a broken database leaves no orphan image', async () => {
  const e = env();
  assert.equal((await handle(new Request(`${base}/api/wall`), e)).headers.get('x-content-type-options'), 'nosniff');
  const broken = { ...e, DB: { prepare: () => ({ bind: () => ({ run: () => Promise.reject(new Error('db down')), all: () => Promise.resolve({ results: [] }), first: () => Promise.resolve(null) }) }) } } as WallEnv;
  await assert.rejects(handle(share(composerPng()), broken, okTurnstile));
  assert.deepEqual(e.WALL.keys(), []);
});

test('without bindings the API says so instead of crashing', async () => {
  assert.equal((await handle(new Request(`${base}/api/wall`), {} as WallEnv)).status, 503);
});
