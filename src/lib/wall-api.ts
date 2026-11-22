import { DOWNLOAD_LABELS, type DownloadKind } from './download-metrics.ts';
// The wall: compositions people share from the composer, published immediately.
// Runs on Cloudflare Workers (src/worker.ts) with a private R2 bucket for the
// images and a D1 database for the list. Moderators can take posts off the wall, and a rejected
// post is deleted for good. No framework; only the storage methods it uses are typed below, so
// it's unit-tested in Node against real SQLite (D1 is SQLite) and an in-memory R2.
//
// Routes
//   GET  /api/wall?before=<iso>&limit=<n>   approved posts, newest first
//   POST /api/wall                         multipart: image (PNG from the composer), title, author, turnstile
//   GET  /api/wall/<id>.png                an approved post's image (any status with the admin token)
//   GET  /api/admin/wall?status=pending     admin: list (Authorization: Bearer <ADMIN_TOKEN>)
//   POST /api/admin/wall/<id>              admin: {"action": "approve" | "wait" | "hide" | "reject"}
import { readPngText } from './png-meta.ts';

export const COMPOSITION_KEY = 'lumassets:composition';
export const LIMITS = { bytes: 8 * 1024 * 1024, side: 6000, title: 80, author: 40, page: 60 };
/** The Turnstile widget in the composer is rendered with this action. */
export const TURNSTILE_ACTION = 'share';
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Cloudflare's Turnstile test secrets (always pass / always fail…): only for localhost. */
const TURNSTILE_TEST_SECRET = /^[123]x0{20,}AA$/;

// ---------------------------------------------------------------- storage (only what's used)

export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}
export interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream | null; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<unknown>;
}
export interface WallEnv {
  DB: D1Like;
  WALL: R2Like;
  /** Secret: the password of the approval page (/wall/admin/). */
  ADMIN_TOKEN?: string;
  /** Secret: Cloudflare Turnstile secret key. */
  TURNSTILE_SECRET?: string;
}

export interface Post {
  id: string;
  title: string;
  author: string | null;
  status: 'pending' | 'approved' | 'hidden';
  created_at: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------- helpers

const SAFE = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SAFE, ...headers } });
const fail = (status: number, error: string) => json({ error }, status);

/** Plain text, no control characters, trimmed and capped. */
export const cleanText = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]|\u2028|\u2029/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

export const POST_ID = /^[a-z0-9]{12}$/;
function newId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => alphabet[b % alphabet.length]).join('');
}

/** Constant-time comparison, so the token can't be guessed byte by byte from response times. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function isAdmin(req: Request, env: WallEnv): boolean {
  const auth = req.headers.get('authorization') ?? '';
  return Boolean(env.ADMIN_TOKEN) && auth.startsWith('Bearer ') && sameSecret(auth.slice(7), env.ADMIN_TOKEN!);
}

/** Checks the upload is a PNG exported by the composer. Returns its size, or an error. */
export function checkComposerPng(bytes: Uint8Array): { width: number; height: number } | { error: string } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !sig.every((v, i) => bytes[i] === v)) return { error: 'Only PNG images can be shared.' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > LIMITS.side || height > LIMITS.side) return { error: 'The image size is out of range.' };
  const doc = readPngText(bytes)[COMPOSITION_KEY];
  try {
    if (!doc || JSON.parse(doc)?.format !== 'lumassets-composition') throw new Error();
  } catch {
    return { error: 'Only images exported from the lumassets composer can be shared.' };
  }
  return { width, height };
}

const isLocal = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

/** Turnstile said yes, for a token made on this site by the share dialog (not one minted elsewhere). */
async function turnstileOk(token: string, env: WallEnv, ip: string | null, url: URL, fetchImpl: typeof fetch): Promise<boolean> {
  if (!env.TURNSTILE_SECRET || !token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY, { method: 'POST', body: form });
    const out = (await res.json()) as { success?: boolean; hostname?: string; action?: string };
    if (!out.success) return false;
    // the test keys answer with a made-up hostname, and they only work on localhost anyway
    const hostOk = isLocal(url) || out.hostname === url.hostname;
    const actionOk = out.action === TURNSTILE_ACTION || (isLocal(url) && out.action === undefined);
    return hostOk && actionOk;
  } catch {
    return false;
  }
}

const SHARE_WINDOW_SECONDS = 600;
const SHARE_WINDOW_LIMIT = 5;

async function reserveShareAttempt(db: D1Like, ip: string, secret: string, now: number) {
  const windowStart = Math.floor(now / SHARE_WINDOW_SECONDS) * SHARE_WINDOW_SECONDS;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`wall-share:${windowStart}:${ip}`));
  const client = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  await db.prepare('DELETE FROM share_limits WHERE window_start < ?1').bind(windowStart).run();
  const reservation = await db.prepare(`
    INSERT INTO share_limits (window_start, client, attempts) VALUES (?1, ?2, 1)
    ON CONFLICT (window_start, client) DO UPDATE SET attempts = attempts + 1
    WHERE attempts < ?3
    RETURNING attempts
  `).bind(windowStart, client, SHARE_WINDOW_LIMIT).first();
  return reservation ? null : windowStart + SHARE_WINDOW_SECONDS - now;
}

export const publicPost = (p: Post) => ({ id: p.id, title: p.title, author: p.author, createdAt: p.created_at, width: p.width, height: p.height, image: `/api/wall/${p.id}.png` });

export function approvedPost(db: D1Like, id: string) {
  return db.prepare("SELECT * FROM posts WHERE id = ?1 AND status = 'approved'").bind(id).first<Post>();
}

// ---------------------------------------------------------------- router

export async function handle(req: Request, env: WallEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (!env.DB || !env.WALL) return fail(503, 'The wall is not set up yet.');

  if (path === '/api/downloads' && req.method === 'POST') {
    if (req.headers.get('origin') !== url.origin) return fail(403, 'Wrong origin.');
    const kind = url.searchParams.get('kind') ?? '';
    if (!Object.hasOwn(DOWNLOAD_LABELS, kind)) return fail(400, 'Unknown download type.');
    await env.DB.prepare(`
      INSERT INTO download_counts (day, kind, count) VALUES (date('now'), ?1, 1)
      ON CONFLICT (day, kind) DO UPDATE SET count = count + 1
    `).bind(kind).run();
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  // list approved posts
  if (path === '/api/wall' && req.method === 'GET') {
    const limit = Math.min(LIMITS.page, Math.max(1, Number(url.searchParams.get('limit')) || 30));
    const before = url.searchParams.get('before') ?? '9999';
    const { results } = await env.DB.prepare(
      "SELECT * FROM posts WHERE status = 'approved' AND created_at < ?1 ORDER BY created_at DESC LIMIT ?2",
    ).bind(before, limit).all<Post>();
    return json({ posts: results.map(publicPost) }, 200, { 'cache-control': 'public, max-age=60' });
  }

  // share
  if (path === '/api/wall' && req.method === 'POST') {
    // the always-pass test key must never protect the real site
    if (!env.TURNSTILE_SECRET || (TURNSTILE_TEST_SECRET.test(env.TURNSTILE_SECRET) && !isLocal(url)))
      return fail(503, 'Sharing is not set up yet.');
    // refuse oversized uploads before reading them (the form adds a little on top of the image)
    if (Number(req.headers.get('content-length') ?? 0) > LIMITS.bytes + 64 * 1024) return fail(413, 'The image is over 8 MB. Try a smaller canvas.');
    const ip = req.headers.get('cf-connecting-ip');
    if (ip && !isLocal(url)) {
      const retryAfter = await reserveShareAttempt(env.DB, ip, env.TURNSTILE_SECRET, Math.floor(Date.now() / 1000));
      if (retryAfter !== null) return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429, { 'retry-after': String(retryAfter) });
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail(400, 'Expected a form upload.');
    }
    const image = form.get('image');
    if (!image || typeof image === 'string') return fail(400, 'No image.');
    if (image.size > LIMITS.bytes) return fail(413, 'The image is over 8 MB. Try a smaller canvas.');
    if (!(await turnstileOk(String(form.get('turnstile') ?? ''), env, ip, url, fetchImpl)))
      return fail(403, "Couldn't verify you're a person. Reload and try again.");
    const bytes = new Uint8Array(await image.arrayBuffer());
    const check = checkComposerPng(bytes);
    if ('error' in check) return fail(400, check.error);
    const post: Post = {
      id: newId(),
      title: cleanText(form.get('title'), LIMITS.title) || 'Untitled',
      author: cleanText(form.get('author'), LIMITS.author) || null,
      status: 'approved',
      created_at: new Date().toISOString(),
      ...check,
    };
    await env.WALL.put(`wall/${post.id}.png`, bytes, { httpMetadata: { contentType: 'image/png' } });
    try {
      await env.DB.prepare(`
        INSERT INTO posts (id, title, author, status, created_at, width, height)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      `).bind(post.id, post.title, post.author, post.status, post.created_at, post.width, post.height).run();
    } catch (e) {
      await env.WALL.delete(`wall/${post.id}.png`); // no image without its entry
      throw e;
    }
    return json({ id: post.id, status: post.status }, 201);
  }

  // an image
  const img = path.match(/^\/api\/wall\/([a-z0-9]{12})\.png$/);
  if (img && (req.method === 'GET' || req.method === 'HEAD')) {
    const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ?1').bind(img[1]).first<Post>();
    const admin = isAdmin(req, env);
    if (!post || (post.status !== 'approved' && !admin)) return fail(404, 'Not found.');
    const obj = await env.WALL.get(`wall/${post.id}.png`);
    if (!obj) return fail(404, 'Not found.');
    return new Response(req.method === 'HEAD' ? null : obj.body ?? (await obj.arrayBuffer()), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'private, no-store',
        ...SAFE,
        'content-disposition': `inline; filename="lumassets-wall-${post.id}.png"`,
      },
    });
  }

  // admin
  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(req, env)) return fail(401, 'Wrong or missing token.');
    if (path === '/api/admin/downloads' && req.method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT kind, sum(count) AS count FROM download_counts
        WHERE day >= date('now', '-29 days') GROUP BY kind ORDER BY kind
      `).bind().all<{ kind: DownloadKind; count: number }>();
      return json({ downloads: results });
    }
    if (path === '/api/admin/wall' && req.method === 'GET') {
      const asked = url.searchParams.get('status') ?? '';
      const status = ['pending', 'approved', 'hidden'].includes(asked) ? asked : 'pending';
      const { results } = await env.DB.prepare('SELECT * FROM posts WHERE status = ?1 ORDER BY created_at DESC LIMIT 200').bind(status).all<Post>();
      return json({ posts: results.map((p) => ({ ...publicPost(p), status: p.status })) });
    }
    const one = path.match(/^\/api\/admin\/wall\/([a-z0-9]{12})$/);
    if (one && req.method === 'POST') {
      let action = '';
      try { action = String(((await req.json()) as { action?: string }).action); } catch { /* handled below */ }
      const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ?1').bind(one[1]).first<Post>();
      if (!post) return fail(404, 'Not found.');
      const status = { approve: 'approved', wait: 'pending', hide: 'hidden' } as const;
      if (action === 'approve' || action === 'wait' || action === 'hide') {
        const nextStatus = status[action];
        await env.DB.prepare('UPDATE posts SET status = ?1 WHERE id = ?2').bind(nextStatus, post.id).run();
        return json({ id: post.id, status: nextStatus });
      }
      if (action === 'reject') {
        await env.WALL.delete(`wall/${post.id}.png`);
        await env.DB.prepare('DELETE FROM posts WHERE id = ?1').bind(post.id).run();
        return json({ id: post.id, status: 'deleted' });
      }
      return fail(400, 'Unknown action.');
    }
  }

  return fail(404, 'Not found.');
}
