// Catalog loading and validation. No third-party dependencies, so it can run
// before `pnpm install` (e.g. `node scripts/build-assets.mjs --check`).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const STATUSES = ['published', 'draft', 'rejected'];
const REQUIRED = [
  'id', 'name', 'slug', 'description', 'aliases', 'tags', 'collection',
  'sourcePath', 'format', 'license', 'version', 'status',
];
// Drafts (e.g. fresh from the studio) only need enough to be identified and found.
const REQUIRED_DRAFT = ['id', 'slug', 'collection', 'sourcePath', 'status'];
const UNDECIDED_LICENSE = 'UNDECIDED';
/** Default quality bar; override with "quality": { "minSourcePixels": n } in collections.json. */
export const MIN_SOURCE_PIXELS = 600;

/** Long side, in pixels, of the largest image embedded in an SVG (0 when there is none). */
export function embeddedImageSide(svg) {
  let best = 0;
  for (const m of svg.matchAll(/data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)/g)) {
    const b = Buffer.from(m[2].slice(0, 80_000), 'base64');
    let w = 0, h = 0;
    if (b[0] === 0x89) { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
    else for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    best = Math.max(best, w, h);
  }
  return best;
}

export function loadCatalog(root) {
  const assets = JSON.parse(readFileSync(join(root, 'data/assets.json'), 'utf8'));
  const meta = JSON.parse(readFileSync(join(root, 'data/collections.json'), 'utf8'));
  return { assets, ...meta };
}

/** Effective license for an asset: its own, or its collection's when "inherit". */
export function resolveLicense(asset, collections) {
  if (asset.license && asset.license !== 'inherit') return asset.license;
  return collections.find((c) => c.id === asset.collection)?.license ?? '';
}

/** Reads width/height/viewBox from the root <svg> element. */
export function readSvgBox(svg) {
  const tag = svg.match(/<svg\b[^>]*>/)?.[0];
  if (!tag) return null;
  const viewBox = tag.match(/\bviewBox="([^"]+)"/)?.[1] ?? null;
  const nums = viewBox?.trim().split(/[\s,]+/).map(Number);
  return {
    viewBox,
    width: nums ? Math.round(nums[2]) : null,
    height: nums ? Math.round(nums[3]) : null,
  };
}

/**
 * Source files use width/height="100%", which has no intrinsic size.
 * Rasterizers and <img> need real dimensions, so this sets them from the viewBox.
 */
export function withIntrinsicSize(svg, width, height) {
  return svg.replace(/<svg\b[^>]*>/, (tag) => {
    let t = tag.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '');
    return t.replace(/^<svg\b/, `<svg width="${width}" height="${height}"`);
  });
}

/**
 * Validates the catalog. Returns { errors, warnings, published }.
 * Errors fail the build; warnings are printed.
 */
export function validateCatalog(root, catalog) {
  const errors = [];
  const warnings = [];
  const { assets, collections } = catalog;
  const ids = new Map();
  const slugs = new Map();
  const minPx = catalog.quality?.minSourcePixels ?? MIN_SOURCE_PIXELS;
  const excused = [];
  const collectionIds = new Set(collections.map((c) => c.id));

  for (const c of collections) {
    if (!c.license) errors.push(`collection ${c.id}: missing license`);
    else if (c.license === UNDECIDED_LICENSE)
      warnings.push(`collection ${c.id}: license is still ${UNDECIDED_LICENSE}; pages will say "all rights reserved"`);
  }

  for (const [i, a] of assets.entries()) {
    const where = `asset[${i}]${a.id ? ` (${a.id})` : ''}`;
    for (const key of a.status === 'published' ? REQUIRED : REQUIRED_DRAFT) {
      if (a[key] === undefined || a[key] === null || a[key] === '') errors.push(`${where}: missing "${key}"`);
    }
    if (a.id && !ID_RE.test(a.id)) errors.push(`${where}: invalid id "${a.id}"`);
    if (a.slug && !SLUG_RE.test(a.slug)) errors.push(`${where}: invalid slug "${a.slug}" (lowercase, a-z0-9 and single dashes)`);
    if (a.id) {
      if (ids.has(a.id)) errors.push(`${where}: duplicate id (also at asset[${ids.get(a.id)}])`);
      ids.set(a.id, i);
    }
    if (a.slug) {
      if (slugs.has(a.slug)) errors.push(`${where}: duplicate slug "${a.slug}"`);
      slugs.set(a.slug, i);
    }
    if (a.status && !STATUSES.includes(a.status)) errors.push(`${where}: unknown status "${a.status}"`);
    if (a.collection && !collectionIds.has(a.collection)) errors.push(`${where}: unknown collection "${a.collection}"`);
    if (!Array.isArray(a.tags) || !Array.isArray(a.aliases)) errors.push(`${where}: tags and aliases must be arrays`);
    if (a.version && !/^\d+\.\d+\.\d+$/.test(a.version)) errors.push(`${where}: version must look like 1.0.0`);

    const license = resolveLicense(a, collections);
    if (!license) errors.push(`${where}: no license (set one on the asset or its collection)`);

    for (const rel of a.related ?? []) {
      if (!assets.some((b) => b.id === rel.id)) errors.push(`${where}: related asset "${rel.id}" does not exist`);
    }
    if (a.duplicateOf) {
      if (!assets.some((b) => b.id === a.duplicateOf)) errors.push(`${where}: duplicateOf "${a.duplicateOf}" does not exist`);
      if (a.status === 'published') errors.push(`${where}: marked duplicateOf ${a.duplicateOf} but published; review it first`);
    }

    if (!a.sourcePath) continue;
    const src = join(root, a.sourcePath);
    if (!existsSync(src)) {
      (a.status === 'published' ? errors : warnings).push(`${where}: source file not found: ${a.sourcePath}`);
      continue;
    }
    if (a.format === 'svg') {
      const svg = readFileSync(src, 'utf8');
      const box = readSvgBox(svg);
      if (!box?.viewBox) errors.push(`${where}: source SVG has no viewBox`);
      else {
        if (a.viewBox && a.viewBox !== box.viewBox) warnings.push(`${where}: catalog viewBox "${a.viewBox}" != source "${box.viewBox}"`);
        if (a.width !== box.width || a.height !== box.height)
          warnings.push(`${where}: catalog size ${a.width}x${a.height} != source ${box.width}x${box.height}`);
      }
      const hasRaster = svg.includes('data:image/') || /<image\b/.test(svg);
      if (Boolean(a.containsRaster) !== hasRaster)
        errors.push(`${where}: containsRaster should be ${hasRaster}`);

      // Quality: published drawings are traced vectors, traced from enough pixels to keep their detail.
      if (a.status === 'published') {
        const px = a.provenance?.pixels;
        const problem = hasRaster
          ? `not traced: it's a ${embeddedImageSide(svg)} px image inside an SVG`
          : typeof px === 'number' && px < minPx ? `traced from only ${px} px (minimum ${minPx})` : null;
        if (problem && a.qualityException) excused.push(`${a.id} ${a.name ?? ''}: ${problem}`);
        else if (problem)
          errors.push(`${where}: ${problem}. Re-extract it with quick-editor from a sharper scan, keep it as a draft, or set "qualityException" with a reason.`);
      }
    }
    const size = statSync(src).size;
    if (a.fileSize !== size) warnings.push(`${where}: catalog fileSize ${a.fileSize} != actual ${size}`);
  }

  for (const id of catalog.featured ?? []) {
    const a = assets.find((b) => b.id === id);
    if (!a) errors.push(`featured: "${id}" does not exist`);
    else if (a.status !== 'published') errors.push(`featured: "${id}" is not published`);
  }

  if (excused.length)
    warnings.push(`${excused.length} published drawing(s) below the quality bar, allowed by "qualityException":\n      ${excused.join('\n      ')}`);

  const published = assets.filter((a) => a.status === 'published');
  if (published.length === 0) errors.push('no published assets');
  return { errors, warnings, published };
}
