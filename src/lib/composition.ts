// The composition document: the canonical, portable record of a composition.
// Pure functions only (no DOM, no Fabric) so it can be unit-tested with Node.
import { effectsPad, filterMarkup, normalizeEffect, type Effect } from './effects.ts';

export const FORMAT = 'lumassets-composition';
export const FORMAT_VERSION = 1;

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Minimal asset info the editor needs. Built from the catalog at page build time. */
export interface EditorAsset {
  id: string;
  name: string;
  slug: string;
  version: string;
  /** Size in layer units: the SVG viewBox for vectors, the trimmed PNG for scans. */
  width: number;
  height: number;
  license: string;
  /** True for traced vector assets; false for scans wrapped in SVG. */
  vector: boolean;
  /** Small image for the picker and layer list. */
  display: string;
  /** Raster drawn on the canvas (PNG, same aspect as width/height). */
  raster: string;
  /** File embedded in SVG exports: the vector SVG, or the trimmed PNG for scans. */
  embed: string;
  searchText: string;
  /** A drawing the visitor added from their own files (lives in their browser and their saved file). */
  own?: boolean;
}

/** A visitor's own drawing, stored inside the saved composition file so it opens anywhere. */
export interface OwnAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  /** True for SVG files. */
  vector: boolean;
  /** The drawing itself: a data: URL (SVG, or PNG with a transparent background). */
  data: string;
}

export const OWN_LICENSE = 'Your own drawing';
const OWN_DATA = /^data:image\/(svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const OWN_MAX_CHARS = 20_000_000; // ~15 MB per drawing, base64

/** The editor's view of an own drawing. `raster` defaults to the data itself. */
export function ownToEditorAsset(o: OwnAsset, raster = o.data): EditorAsset {
  return {
    id: o.id, name: o.name, slug: o.id, version: '1', width: o.width, height: o.height,
    license: OWN_LICENSE, vector: o.vector, display: raster, raster, embed: o.data,
    searchText: `${o.name} yours own`.toLowerCase(), own: true,
  };
}

/** Validates the `ownAssets` block of a saved file. Bad entries are reported, never guessed at. */
export function parseOwnAssets(raw: unknown): { assets: OwnAsset[]; errors: string[] } {
  const assets: OwnAsset[] = [];
  const errors: string[] = [];
  if (raw === undefined) return { assets, errors };
  if (!Array.isArray(raw)) return { assets, errors: ['"ownAssets" must be a list.'] };
  raw.forEach((o: any, i) => {
    const where = `Own drawing ${i + 1}`;
    if (typeof o?.id !== 'string' || !/^own-[a-z0-9]{4,40}$/.test(o.id)) return errors.push(`${where}: bad id.`);
    if (typeof o.data !== 'string' || o.data.length > OWN_MAX_CHARS || !OWN_DATA.test(o.data))
      return errors.push(`${where}: the image must be an SVG, PNG, JPEG or WebP data URL under 15 MB.`);
    if (!isNum(o.width) || !isNum(o.height) || o.width <= 0 || o.height <= 0 || o.width > 20000 || o.height > 20000)
      return errors.push(`${where}: bad size.`);
    assets.push({
      id: o.id,
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : 'My drawing',
      width: o.width, height: o.height,
      vector: o.data.startsWith('data:image/svg+xml'),
      data: o.data,
    });
  });
  return { assets, errors };
}

export interface Layer {
  id: string;
  assetId: string;
  assetVersion: string;
  /** Center of the layer in canvas pixels. */
  x: number;
  y: number;
  /** 1 = the asset drawn at its viewBox size. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  blendMode: BlendMode;
  /** Ink color (replaces the drawing's color, keeps its shape). null = original ink. */
  color: string | null;
  fill?: string | null;
  background?: string | null;
  excludeFromEverything?: boolean;
  /** Effect stack, applied in order after the ink color. */
  effects?: Effect[];
}

export interface CompositionDoc {
  format: typeof FORMAT;
  formatVersion: typeof FORMAT_VERSION;
  title: string;
  createdAt: string;
  updatedAt: string;
  canvas: { width: number; height: number; background: string | null };
  /** Bottom to top. */
  layers: Layer[];
  /** Effects on the whole composition (all layers together, not the background). */
  effects?: Effect[];
  /** Only in saved files: the visitor's own drawings used by the layers. */
  ownAssets?: OwnAsset[];
  provenance: {
    generator: string;
    /** Where it was made: the composer's address. */
    url?: string;
    catalogRelease: string;
    assets: { id: string; name: string; version: string; license: string }[];
  };
}

export const CANVAS_LIMITS = { min: 64, max: 6000 };

/** Title of a composition nobody named. Not shown in the editor; exports get a dated file name instead. */
export const DEFAULT_TITLE = 'lumassets composition';

export function newDoc(release: string, now = new Date()): CompositionDoc {
  const t = now.toISOString();
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    title: DEFAULT_TITLE,
    createdAt: t,
    updatedAt: t,
    canvas: { width: 1600, height: 1000, background: '#ffffff' },
    layers: [],
    effects: [],
    provenance: { generator: 'lumassets', catalogRelease: release, assets: [] },
  };
}

let counter = 0;
export const layerId = () => `l${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A new layer centered on the canvas, scaled to fit about 60% of it. */
export function layerFor(asset: EditorAsset, doc: CompositionDoc): Layer {
  const { width: W, height: H } = doc.canvas;
  const scale = Math.min((0.6 * W) / asset.width, (0.6 * H) / asset.height);
  return {
    id: layerId(),
    assetId: asset.id,
    assetVersion: asset.version,
    x: W / 2,
    y: H / 2,
    scale: round(scale, 4),
    rotation: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    blendMode: 'normal',
    color: null,
    effects: [],
  };
}

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Rebuilds the provenance block from the layers actually used. */
export function withProvenance(doc: CompositionDoc, assets: Map<string, EditorAsset>): CompositionDoc {
  const used = [...new Set(doc.layers.map((l) => l.assetId))];
  return {
    ...doc,
    updatedAt: new Date().toISOString(),
    provenance: {
      ...doc.provenance,
      assets: used.map((id) => {
        const a = assets.get(id);
        const layer = doc.layers.find((l) => l.assetId === id)!;
        return { id, name: a?.name ?? id, version: layer.assetVersion, license: a?.license ?? 'unknown' };
      }),
    },
  };
}

export interface ParseResult {
  doc?: CompositionDoc;
  /** Own drawings carried by the file; the caller registers them before rendering. */
  own: OwnAsset[];
  errors: string[];
  warnings: string[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/**
 * Parses and validates a composition document. Unknown assets are an error:
 * a composition never silently swaps in a different asset.
 */
export function parseDoc(text: string, assets: Map<string, EditorAsset>): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { errors: ['This file is not valid JSON.'], warnings, own: [] };
  }
  if (raw?.format !== FORMAT) return { errors: ['This is not a lumassets composition file.'], warnings, own: [] };
  if (raw.formatVersion !== FORMAT_VERSION)
    return { errors: [`Unsupported composition format version ${raw.formatVersion}.`], warnings, own: [] };

  const own = parseOwnAssets(raw.ownAssets);
  errors.push(...own.errors);
  const known = new Map(assets);
  for (const o of own.assets) if (!known.has(o.id)) known.set(o.id, ownToEditorAsset(o));

  const c = raw.canvas;
  if (!c || !isNum(c.width) || !isNum(c.height)) errors.push('Canvas size is missing.');
  else if ([c.width, c.height].some((n) => n < CANVAS_LIMITS.min || n > CANVAS_LIMITS.max))
    errors.push(`Canvas size must be between ${CANVAS_LIMITS.min} and ${CANVAS_LIMITS.max} px.`);
  if (c && c.background !== null && !isColor(c.background)) errors.push('Canvas background must be a #rrggbb color or null.');
  if (!Array.isArray(raw.layers)) errors.push('Layers are missing.');

  const missing = new Set<string>();
  for (const [i, l] of (Array.isArray(raw.layers) ? raw.layers : []).entries()) {
    const where = `Layer ${i + 1}`;
    if (typeof l?.assetId !== 'string') { errors.push(`${where}: missing asset id.`); continue; }
    const asset = known.get(l.assetId);
    if (!asset) { missing.add(l.assetId); continue; }
    if (l.assetVersion !== asset.version)
      warnings.push(`${where} used ${asset.name} v${l.assetVersion}; the library now has v${asset.version}.`);
    for (const k of ['x', 'y', 'scale', 'rotation', 'opacity'] as const)
      if (!isNum(l[k])) errors.push(`${where}: "${k}" must be a number.`);
    if (isNum(l.scale) && l.scale <= 0) errors.push(`${where}: scale must be positive.`);
    if (!BLEND_MODES.includes(l.blendMode)) errors.push(`${where}: unknown blend mode "${l.blendMode}".`);
    for (const key of ['fill', 'background'] as const)
      if (l[key] != null && !isColor(l[key])) errors.push(`${where}: "${key}" must be #rrggbb or null.`);
    if (l.color !== null && !isColor(l.color)) errors.push(`${where}: color must be #rrggbb or null.`);
  }
  if (missing.size)
    errors.push(`These assets are not in the library, so the composition can't be opened as saved: ${[...missing].join(', ')}.`);
  if (errors.length) return { errors, warnings, own: [] };

  const doc: CompositionDoc = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    title: typeof raw.title === 'string' && raw.title.trim() && raw.title !== 'Untitled composition' ? raw.title.slice(0, 120) : DEFAULT_TITLE,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    canvas: { width: Math.round(c.width), height: Math.round(c.height), background: c.background },
    layers: raw.layers.map((l: any): Layer => ({
      id: typeof l.id === 'string' ? l.id : layerId(),
      assetId: l.assetId,
      assetVersion: String(l.assetVersion),
      x: l.x, y: l.y, scale: l.scale, rotation: l.rotation,
      flipX: Boolean(l.flipX), flipY: Boolean(l.flipY),
      opacity: Math.min(1, Math.max(0, l.opacity)),
      blendMode: l.blendMode,
      color: l.color,
      ...(l.fill ? { fill: l.fill } : {}),
      ...(l.background ? { background: l.background } : {}),
      ...(l.excludeFromEverything === true ? { excludeFromEverything: true } : {}),
      effects: Array.isArray(l.effects) ? l.effects.map(normalizeEffect).filter((e: Effect | null): e is Effect => e !== null) : [],
    })),
    effects: Array.isArray(raw.effects) ? raw.effects.map(normalizeEffect).filter((e: Effect | null): e is Effect => e !== null) : [],
    provenance: {
      generator: 'lumassets',
      ...(typeof raw.provenance?.url === 'string' ? { url: raw.provenance.url } : {}),
      catalogRelease: String(raw.provenance?.catalogRelease ?? ''),
      assets: Array.isArray(raw.provenance?.assets) ? raw.provenance.assets : [],
    },
  };
  const used = new Set(doc.layers.map((l) => l.assetId));
  return { doc, errors, warnings, own: own.assets.filter((o) => used.has(o.id)) };
}

const escXml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);

/**
 * Serializes a composition as SVG. `embeds` maps asset ids to data: URLs of the file to embed
 * (asset.embed). Each asset is embedded once and reused. Scans stay raster inside the SVG;
 * the caller must say so to the user.
 */
/** Consecutive affected layers share a filter without moving excluded layers in the stack. */
export function everythingRuns(layers: Layer[]): Layer[][] {
  const runs: Layer[][] = [];
  for (const layer of layers) {
    const last = runs.at(-1);
    if (!layer.excludeFromEverything && last && !last[0].excludeFromEverything) last.push(layer);
    else runs.push([layer]);
  }
  return runs;
}

export function layerUnderlay(w: number, h: number, background?: string | null, fillImage?: string): string {
  return (background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : '') +
    (fillImage ? `<image width="${w}" height="${h}" preserveAspectRatio="none" href="${fillImage}"/>` : '');
}

export function toSvg(doc: CompositionDoc, assets: Map<string, EditorAsset>, embeds: Map<string, string>, fills = new Map<string, string>()): string {
  const { width: W, height: H, background } = doc.canvas;
  const used = [...new Set(doc.layers.map((l) => l.assetId))];
  const defs: string[] = [];
  for (const id of used) {
    const a = assets.get(id)!;
    defs.push(`<image id="asset-${id}" width="${a.width}" height="${a.height}" preserveAspectRatio="none" href="${embeds.get(id)!}"/>`);
  }
  const body = new Map<Layer, string>();
  doc.layers.forEach((l, i) => {
    const a = assets.get(l.assetId)!;
    const sx = l.scale * (l.flipX ? -1 : 1);
    const sy = l.scale * (l.flipY ? -1 : 1);
    // ink colour + effects as one live SVG filter, in the drawing's own coordinates
    const pad = effectsPad(l.effects, Math.max(a.width, a.height));
    const markup = filterMarkup(`fx-${i}`, { color: l.color, effects: l.effects, w: a.width, h: a.height, pad });
    if (markup) defs.push(markup);
    const filter = markup ? ` filter="url(#fx-${i})"` : '';
    const style = l.blendMode !== 'normal' ? ` style="mix-blend-mode:${l.blendMode}"` : '';
    const opacity = l.opacity < 1 ? ` opacity="${round(l.opacity, 3)}"` : '';
    body.set(l,
      `<g transform="translate(${round(l.x)} ${round(l.y)}) rotate(${round(l.rotation, 3)}) scale(${round(sx, 5)} ${round(sy, 5)})"${opacity}${style}>` +
        `<g transform="translate(${-a.width / 2} ${-a.height / 2})">${layerUnderlay(a.width, a.height, l.background, fills.get(l.id))}<use href="#asset-${l.assetId}"${filter}/></g></g>`,
    );
  });
  // whole-composition effects: one filter around all layers (the background stays out of it)
  const global = filterMarkup('fx-all', { color: null, effects: doc.effects, w: W, h: H, pad: 0 });
  if (global) defs.push(global);
  // the whole composition rides along, so the SVG can be opened in the composer again
  const meta = JSON.stringify(doc);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<title>${escXml(doc.title)}</title>`,
    `<desc>Made with the lumassets composer${doc.provenance.url ? ` (${escXml(doc.provenance.url)})` : ''}. Assets: ${escXml(doc.provenance.assets.map((a) => `${a.name} (${a.id} v${a.version}, ${a.license})`).join('; '))}</desc>`,
    `<metadata id="lumassets-composition">${escXml(meta)}</metadata>`,
    `<defs>${defs.join('')}</defs>`,
    background ? `<rect width="${W}" height="${H}" fill="${background}"/>` : '',
    ...everythingRuns(doc.layers).map((run) => {
      const markup = run.map((layer) => body.get(layer)).join('');
      return global && !run[0].excludeFromEverything ? `<g filter="url(#fx-all)">${markup}</g>` : markup;
    }),
    `</svg>`,
  ].filter(Boolean).join('\n');
}

const unescXml = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e as 'lt']);

/** The composition JSON inside an SVG exported by the composer, or null. */
export function compositionFromSvg(svg: string): string | null {
  const m = svg.match(/<metadata id="lumassets-composition">([\s\S]*?)<\/metadata>/);
  return m ? unescXml(m[1]) : null;
}

/** Text entries written into exported PNGs (see png-meta.ts). */
export const PNG_KEYS = { composition: 'lumassets:composition' } as const;

export function pngTextFor(doc: CompositionDoc): Record<string, string> {
  const assets = doc.provenance.assets.map((a) => `${a.name} (${a.id} v${a.version}, ${a.license})`).join('; ');
  return {
    Title: doc.title,
    Software: 'lumassets composer',
    ...(doc.provenance.url ? { Source: doc.provenance.url } : {}),
    Description: `Made with the lumassets composer${doc.provenance.url ? ` (${doc.provenance.url})` : ''}. Assets: ${assets}`,
    'Creation Time': doc.updatedAt,
    [PNG_KEYS.composition]: JSON.stringify(doc),
  };
}

/** data: URL for SVG text (for vector embeds). */
export function svgDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

export const safeFilename = (title: string) =>
  title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) ||
  'composition';
