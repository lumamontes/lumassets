// Runs Lighthouse on the main pages of a running site and saves HTML reports.
// Not part of CI (scores vary between runs); run it by hand when you want numbers.
//
//   pnpm lighthouse                                   local production build (starts `astro preview`)
//   pnpm lighthouse https://<branch>.lumassets.pages.dev   a deployed PR preview or production
//   pnpm lighthouse <url> --desktop                   desktop profile instead of mobile
//
// Chrome: uses CHROME_PATH if set, otherwise Playwright's Chromium, otherwise your installed Chrome.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const desktop = args.includes('--desktop');
const target = args.find((a) => !a.startsWith('--'));
const THRESHOLD = 90; // spec: at least 90 for SEO, accessibility and best practices
const GATED = ['accessibility', 'best-practices', 'seo'];

const pages = ['/', '/about/', '/compose/'];

if (!process.env.CHROME_PATH) {
  try {
    const { chromium } = await import('@playwright/test');
    process.env.CHROME_PATH = chromium.executablePath();
  } catch {
    /* fall back to an installed Chrome */
  }
}

let server;
let base = target?.replace(/\/$/, '');
if (!base) {
  const port = 4392;
  base = `http://localhost:${port}`;
  console.log('No URL given: serving the local build (run `pnpm build` first if it is stale).');
  server = spawn('pnpm', ['preview', '--port', String(port)], { cwd: root, stdio: 'ignore' });
  await waitFor(base);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(root, 'lighthouse-reports', stamp);
mkdirSync(outDir, { recursive: true });

const rows = [];
let failed = false;
try {
  for (const path of pages) {
    const url = base + path;
    const name = path === '/' ? 'home' : path.replace(/^\/|\/$/g, '').replaceAll('/', '_');
    process.stdout.write(`Lighthouse ${url} … `);
    const json = await runLighthouse(url, join(outDir, name));
    const scores = Object.fromEntries(Object.entries(json.categories).map(([k, v]) => [k, Math.round(v.score * 100)]));
    const low = GATED.filter((k) => scores[k] < THRESHOLD);
    if (low.length) failed = true;
    rows.push({ page: path, ...scores, ...(low.length ? { below: low.join(', ') } : {}) });
    console.log(low.length ? `below ${THRESHOLD}: ${low.join(', ')}` : 'ok');
  }
} finally {
  server?.kill();
}

console.table(rows);
console.log(`Reports: ${outDir}`);
console.log(`Profile: ${desktop ? 'desktop' : 'mobile (simulated slow 4G)'}. Performance is informational; scores vary between runs.`);
process.exit(failed ? 1 : 0);

function runLighthouse(url, outPath) {
  return new Promise((resolve, reject) => {
    const cli = [
      'exec', 'lighthouse', url,
      '--quiet',
      '--only-categories=performance,accessibility,best-practices,seo',
      '--output=json', '--output=html',
      `--output-path=${outPath}`,
      '--chrome-flags=--headless=new --no-sandbox',
      ...(desktop ? ['--preset=desktop'] : []),
    ];
    const p = spawn('pnpm', cli, { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Lighthouse failed for ${url}:\n${err}`));
      resolve(JSON.parse(readFileSync(`${outPath}.report.json`, 'utf8')));
    });
  });
}

async function waitFor(url, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${url} did not start`);
}
