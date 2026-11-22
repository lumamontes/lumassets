import assetsJson from '../../data/assets.json';
import collectionsJson from '../../data/collections.json';
// Written by scripts/build-assets.mjs (runs before dev, build and check).
import manifestJson from '../generated/assets.json';

export type Status = 'published' | 'draft' | 'rejected';

export interface Asset {
  id: string;
  name: string;
  slug: string;
  description: string;
  aliases: string[];
  tags: string[];
  collection: string;
  sourcePath: string;
  originalPath?: string;
  backingPath?: string;
  format: 'svg';
  width: number;
  height: number;
  viewBox: string;
  fileSize: number;
  containsRaster: boolean;
  license: string;
  version: string;
  status: Status;
  duplicateOf?: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  license: string;
  licenseUrl?: string;
  attribution: string;
  version: string;
}

/** Generated files for an asset (see scripts/build-assets.mjs). */
export interface Files {
  vector: boolean;
  /** What the grid and panel show, trimmed to the ink. */
  display: string;
  w: number;
  h: number;
  svg: string;
  png: string;
  pngW: number;
  pngH: number;
}

export const RELEASE: string = collectionsJson.releaseVersion;
export const COLLECTIONS = collectionsJson.collections as Collection[];
const FILES = manifestJson as Record<string, Files>;

/** Only published entries reach the site. */
export const ASSETS: Asset[] = (assetsJson as Asset[]).filter((a) => a.status === 'published' && FILES[a.id]);

/** Whole scanned pages (overviews), shown after the single drawings. */
export const isFullPage = (a: Asset) => a.tags.includes('full-page');

export const filesOf = (a: Asset): Files => FILES[a.id];

export const collectionOf = (a: Asset): Collection => {
  const c = COLLECTIONS.find((c) => c.id === a.collection);
  if (!c) throw new Error(`Unknown collection ${a.collection} for ${a.id}`);
  return c;
};

export function licenseOf(a: Asset): { name: string; url?: string; undecided: boolean; attribution: string } {
  const c = collectionOf(a);
  const own = a.license && a.license !== 'inherit';
  const name = own ? a.license : c.license;
  return { name, url: own ? undefined : c.licenseUrl, undecided: name === 'UNDECIDED', attribution: c.attribution };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Lowercased text the search matches against. */
export const searchText = (a: Asset) =>
  [a.name, a.id, a.slug, a.description, ...a.aliases, ...a.tags, collectionOf(a).name]
    .join(' ')
    .toLowerCase();

/** Everything the grid panel needs, serialised once into the page. */
export const panelData = (a: Asset) => {
  const f = filesOf(a);
  const lic = licenseOf(a);
  return {
    id: a.id,
    slug: a.slug,
    name: a.name,
    description: a.description,
    tags: a.tags,
    collection: collectionOf(a).name,
    version: a.version,
    vector: f.vector,
    display: f.display,
    svg: f.svg,
    png: f.png,
    pngW: f.pngW,
    pngH: f.pngH,
    license: lic.undecided ? `© ${lic.attribution}, all rights reserved (license not chosen yet)` : lic.name,
    licenseUrl: lic.url ?? '',
    credit: `${a.name} @ ${lic.attribution}, from lumassets${lic.undecided ? '' : `, ${lic.name} (no credit needed)`}`,
  };
};
