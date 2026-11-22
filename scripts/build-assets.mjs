// Validates the catalog and prepares every published asset for the site:
//   public/generated/display/   what the grid and panel show (trimmed to the ink)
//   public/generated/download/  SVG + PNG downloads, named with slug and version
//   public/generated/og/site.png social preview
//   src/generated/assets.json   sizes and URLs, imported by the site
//
// Vector assets (from the studio) are used as-is. Older "raster in SVG" assets are rendered at
// their real resolution (never upscaled) and trimmed to the ink.
//
//   node scripts/build-assets.mjs           validate + generate (needs sharp)
//   node scripts/build-assets.mjs --check   validate only (no dependencies)
//   node scripts/build-assets.mjs --force   regenerate everything
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, readSvgBox, validateCatalog, withIntrinsicSize } from './catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const out = join(root, 'public/generated');
const manifestPath = join(root, 'src/generated/assets.json');

const DISPLAY_MAX = 800; // grid/panel raster size cap (long side)
const PNG_VECTOR = 2048; // PNG download size for vector assets
const PNG_RASTER_MAX = 4096; // cap for very large raster sources (e.g. full sheets)

const catalog = loadCatalog(root);
const { errors, warnings, published } = validateCatalog(root, catalog);
for (const w of warnings) console.warn(`  warn  ${w}`);
for (const e of errors) console.error(`  error ${e}`);
if (errors.length) {
  console.error(`\nCatalog has ${errors.length} error(s). Fix data/assets.json before building.`);
  process.exit(1);
}
console.log(`Catalog OK: ${published.length} published of ${catalog.assets.length} entries (${warnings.length} warnings).`);
if (args.has('--check')) process.exit(0);

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('sharp is not installed. Run `pnpm install` first.');
  process.exit(1);
}

if (args.has('--force')) rmSync(out, { recursive: true, force: true });
for (const dir of ['display', 'download', 'og']) mkdirSync(join(out, dir), { recursive: true });
mkdirSync(dirname(manifestPath), { recursive: true });

const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const manifest = {};
let made = 0;

/** Real pixel density of the raster(s) embedded in an SVG, relative to its user units. */
function nativeScale(svg) {
  let best = 1;
  for (const m of svg.matchAll(/<image\b[^>]*>/g)) {
    const tag = m[0];
    const w = parseFloat(tag.match(/\swidth="([\d.]+)/)?.[1] ?? '0');
    const h = parseFloat(tag.match(/\sheight="([\d.]+)/)?.[1] ?? '0');
    const b64 = tag.match(/base64,([A-Za-z0-9+/=\s]{40,})/)?.[1]?.replace(/\s/g, '');
    if (!w || !h || !b64) continue;
    const head = Buffer.from(b64.slice(0, 64), 'base64');
    if (head.toString('ascii', 1, 4) !== 'PNG') continue;
    const pw = head.readUInt32BE(16), ph = head.readUInt32BE(20);
    // the image may be rotated inside the SVG, so compare long sides
    best = Math.max(best, Math.max(pw, ph) / Math.max(w, h));
  }
  return best;
}

/** Crops an RGBA raster to its visible ink. */
async function trimToInk(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      // ink = opaque and dark (some sources have white paper inside the bitmap)
      if (data[i + 3] > 24 && data[i] + data[i + 1] + data[i + 2] < 600) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('no ink found');
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.01) + 1;
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  const width = Math.min(info.width, x1 + pad + 1) - left, height = Math.min(info.height, y1 + pad + 1) - top;
  return sharp(png).extract({ left, top, width, height }).png().toBuffer({ resolveWithObject: true });
}

/** Any white paper left inside old raster sources becomes transparent; ink becomes pure black. */
async function inkOnly(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    const ink = Math.round(Math.max(0, Math.min(1, (235 - lum) / 120)) * data[i + 3]);
    data[i] = data[i + 1] = data[i + 2] = 0;
    data[i + 3] = ink;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

for (const a of published) {
  const src = join(root, a.sourcePath);
  const svgName = `lumassets-${a.slug}-v${a.version}.svg`;
  const pngName = `lumassets-${a.slug}-v${a.version}.png`;
  const prev = previous[a.id];
  const srcTime = statSync(src).mtimeMs;
  const fresh =
    !args.has('--force') && prev && prev.srcTime === srcTime && prev.svg.endsWith(svgName) &&
    existsSync(join(root, 'public', prev.display)) && existsSync(join(out, 'download', pngName));
  if (fresh) {
    manifest[a.id] = prev;
    continue;
  }

  const svgText = readFileSync(src, 'utf8');
  copyFileSync(src, join(out, 'download', svgName));
  const box = readSvgBox(svgText);
  const sized = Buffer.from(withIntrinsicSize(svgText, box.width, box.height));
  let entry;

  if (!a.containsRaster) {
    // Vector: the SVG is the download; the grid gets a light PNG (traced pages can be MBs of
    // paths), rendered from the vector at 2x the display size so it stays crisp on retina screens.
    const scale = PNG_VECTOR / Math.max(box.width, box.height);
    const png = await sharp(sized, { density: 72 * scale, limitInputPixels: false })
      .resize({ width: Math.round(box.width * scale) }).png().toBuffer({ resolveWithObject: true });
    writeFileSync(join(out, 'download', pngName), png.data);
    const display = `display/${a.id}.png`;
    const d = await sharp(png.data)
      .resize({ width: DISPLAY_MAX, height: DISPLAY_MAX, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer({ resolveWithObject: true });
    writeFileSync(join(out, display), d.data);
    entry = { vector: true, display: `/generated/${display}`, w: d.info.width, h: d.info.height, png: `/generated/download/${pngName}`, pngW: png.info.width, pngH: png.info.height };
  } else {
    // Raster in SVG: render at the embedded image's own resolution, then trim to the ink.
    let scale = nativeScale(svgText);
    const longPx = Math.max(box.width, box.height) * scale;
    if (longPx > PNG_RASTER_MAX) scale *= PNG_RASTER_MAX / longPx;
    const rendered = await sharp(sized, { density: 72 * scale, limitInputPixels: false })
      .resize({ width: Math.max(1, Math.round(box.width * scale)) })
      .png()
      .toBuffer();
    const trimmed = await trimToInk(await inkOnly(rendered));
    writeFileSync(join(out, 'download', pngName), trimmed.data);
    const display = `display/${a.id}.png`;
    const d = await sharp(trimmed.data)
      .resize({ width: DISPLAY_MAX, height: DISPLAY_MAX, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer({ resolveWithObject: true });
    writeFileSync(join(out, display), d.data);
    entry = { vector: false, display: `/generated/${display}`, w: d.info.width, h: d.info.height, png: `/generated/download/${pngName}`, pngW: trimmed.info.width, pngH: trimmed.info.height };
    if (Math.max(trimmed.info.width, trimmed.info.height) < 400)
      console.warn(`  warn  ${a.id}: only ${trimmed.info.width}×${trimmed.info.height}px of real detail; re-export it with the studio`);
  }
  manifest[a.id] = { ...entry, svg: `/generated/download/${svgName}`, srcTime };
  made++;
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// Site-wide social image: featured drawings on white.
const siteOg = join(out, 'og', 'site.png');
if (made || !existsSync(siteOg)) {
  const picks = (catalog.featured ?? []).filter((id) => manifest[id]).slice(0, 4);
  const cell = 270;
  const tiles = await Promise.all(picks.map(async (id, i) => {
    const m = manifest[id];
    const input = await sharp(join(root, 'public', m.png)).resize({ width: cell, height: cell, fit: 'inside' }).toBuffer({ resolveWithObject: true });
    return { input: input.data, left: 60 + i * (cell + 20) + Math.round((cell - input.info.width) / 2), top: 70 + Math.round((cell - input.info.height) / 2) };
  }));
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <text x="60" y="520" font-family="Helvetica,Arial,sans-serif" font-size="64" font-weight="600" fill="#000">lumassets</text>
    <text x="62" y="568" font-family="Menlo,monospace" font-size="24" fill="#000">${published.length} hand-drawn assets by Luma Montes</text>
  </svg>`);
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#ffffff' } })
    .composite([...tiles, { input: label, left: 0, top: 0 }])
    .png()
    .toFile(siteOg);
}

console.log(made ? `Prepared ${made} asset(s).` : 'Generated assets are up to date.');
