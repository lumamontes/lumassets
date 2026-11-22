import { approvedPost, publicPost, type D1Like } from './wall-api.ts';

export const WALL_ENTRY_TEMPLATE = '/wall/entry-template/';
export const wallEntryPath = (id: string) => `/wall/post/${encodeURIComponent(id)}/`;

export const wallEntrySlots = {
  title: 'LUMASSETS_WALL_ENTRY_TITLE',
  description: 'LUMASSETS_WALL_ENTRY_DESCRIPTION',
  canonical: 'https://wall-entry.invalid/canonical',
  image: 'https://wall-entry.invalid/image.png',
  width: 'LUMASSETS_WALL_ENTRY_WIDTH',
  height: 'LUMASSETS_WALL_ENTRY_HEIGHT',
  byline: 'LUMASSETS_WALL_ENTRY_BYLINE',
  remix: 'https://wall-entry.invalid/remix',
} as const;

const slots = wallEntrySlots;

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => entities[char]);
const markers = new RegExp(Object.values(slots).map((slot) => slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

export async function serveWallEntry(request: Request, db: D1Like | undefined, assets: { fetch(request: Request): Promise<Response> }) {
  const url = new URL(request.url);
  const id = url.pathname.match(/^\/wall\/post\/([a-z0-9]{12})\/?$/)?.[1];
  const headers = { 'cache-control': 'no-store' };
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
  const row = id && db ? await approvedPost(db, id) : null;
  if (!row) return new Response('This wall post isn’t available.', { status: 404, headers });
  const post = publicPost(row);
  const canonicalPath = wallEntryPath(post.id);
  if (url.pathname !== canonicalPath)
    return new Response(null, { status: 308, headers: { ...headers, location: canonicalPath + url.search } });

  const canonical = new URL(canonicalPath, url).href;
  const byline = post.author ? `by ${post.author}` : '';
  const values: Record<string, string> = {
    [slots.title]: post.title,
    [slots.description]: byline ? `${byline} · Made with the Lumassets Composer.` : 'Made with the Lumassets Composer.',
    [slots.canonical]: canonical,
    [slots.image]: new URL(`/wall/image/${post.id}.png`, url).href,
    [slots.width]: String(post.width),
    [slots.height]: String(post.height),
    [slots.byline]: byline,
    [slots.remix]: `/compose/?wall=${encodeURIComponent(post.id)}`,
  };

  const template = await assets.fetch(new Request(new URL(WALL_ENTRY_TEMPLATE, url)));
  if (!template.ok) return new Response('This wall post couldn’t be loaded.', { status: 503, headers });
  const html = request.method === 'HEAD' ? null : (await template.text()).replace(markers, (slot) => escapeHtml(values[slot]));
  const responseHeaders = new Headers(template.headers);
  for (const name of ['content-length', 'content-encoding', 'etag', 'last-modified']) responseHeaders.delete(name);
  responseHeaders.set('cache-control', 'no-store');
  return new Response(html, { headers: responseHeaders });
}
