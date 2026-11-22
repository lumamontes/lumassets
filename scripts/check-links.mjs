// Checks the built site (dist/) for broken internal links. No network, no dependencies.
// Every href/src/srcset/og:image that points inside the site must resolve to a built file,
// and every #fragment must match an id on the target page.
//
//   pnpm build && pnpm check:links
//   node scripts/check-links.mjs path/to/dist   (custom directory)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/site.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.argv[2] ?? join(root, 'dist');
const siteUrl = new URL(SITE.url);

if (!existsSync(dist)) {
  console.error(`No build found at ${dist}. Run \`pnpm build\` first.`);
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const htmlFiles = walk(dist).filter((f) => f.endsWith('.html'));
const idCache = new Map();

/** The URL path a built HTML file is served at. */
const pageUrl = (file) => {
  const rel = relative(dist, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return `/${rel}`;
};

/** Built file for a site path, or null. Mirrors static hosting: /x/ → x/index.html, /x → x, x.html or x/index.html. */
function resolveFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidates = pathname.endsWith('/')
    ? [join(dist, clean, 'index.html')]
    : [join(dist, clean), join(dist, `${clean}.html`), join(dist, clean, 'index.html')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function idsIn(file) {
  if (!idCache.has(file)) {
    const html = readFileSync(file, 'utf8');
    idCache.set(file, new Set([...html.matchAll(/\s(?:id|name)="([^"]+)"/g)].map((m) => m[1])));
  }
  return idCache.get(file);
}

/** All URL-ish attribute values in a page. Skips inline <script> and <style> bodies. */
function linksIn(html) {
  const body = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const out = [];
  for (const tag of body.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [, name, attrs] = tag;
    const attr = (n) => attrs.match(new RegExp(`\\s${n}="([^"]*)"`, 'i'))?.[1];
    const lower = name.toLowerCase();
    for (const n of ['href', 'src', 'poster']) {
      const v = attr(n);
      if (v !== undefined) out.push({ tag: lower, url: v });
    }
    const srcset = attr('srcset');
    if (srcset) for (const part of srcset.split(',')) out.push({ tag: lower, url: part.trim().split(/\s+/)[0] });
    // Social images use absolute URLs on the production domain.
    if (lower === 'meta' && /(og:image|twitter:image)"/.test(attrs)) {
      const v = attr('content');
      if (v) out.push({ tag: 'meta', url: v });
    }
  }
  return out;
}

const problems = [];
let checked = 0;

for (const file of htmlFiles) {
  const from = pageUrl(file);
  const html = readFileSync(file, 'utf8');
  for (const { tag, url: raw } of linksIn(html)) {
    const url = raw.replaceAll('&amp;', '&').trim();
    if (!url || /^(mailto|tel|data|javascript|blob):/i.test(url)) continue;
    let target;
    try {
      target = new URL(url, new URL(from, siteUrl));
    } catch {
      problems.push({ from, url, why: 'not a valid URL' });
      continue;
    }
    if (target.origin !== siteUrl.origin) continue; // external: not checked here
    checked++;
    const targetFile = resolveFile(target.pathname);
    if (!targetFile) {
      problems.push({ from, url, why: `no file for ${target.pathname}` });
      continue;
    }
    if (target.hash && targetFile.endsWith('.html') && tag === 'a') {
      const id = decodeURIComponent(target.hash.slice(1));
      if (!idsIn(targetFile).has(id)) problems.push({ from, url, why: `no element with id="${id}" on ${target.pathname}` });
    }
  }
}

if (problems.length) {
  console.error(`Found ${problems.length} broken link(s) in ${htmlFiles.length} pages:\n`);
  for (const p of problems) console.error(`  ${p.from}\n    → ${p.url}  (${p.why})`);
  process.exit(1);
}
console.log(`Links OK: ${checked} internal links across ${htmlFiles.length} pages.`);
