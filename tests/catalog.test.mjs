import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, readSvgBox, validateCatalog, withIntrinsicSize } from '../scripts/catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the real catalog validates', () => {
  const { errors, published } = validateCatalog(root, loadCatalog(root));
  assert.deepEqual(errors, []);
  assert.ok(published.length > 0);
});

test('drafts never count as published', () => {
  const catalog = loadCatalog(root);
  const { published } = validateCatalog(root, catalog);
  assert.ok(published.every((a) => a.status === 'published'));
});

test('detects duplicate ids and bad slugs', () => {
  const catalog = loadCatalog(root);
  const [a, b] = catalog.assets;
  const broken = { ...catalog, assets: [a, { ...b, id: a.id, slug: 'Not OK' }] };
  const { errors } = validateCatalog(root, broken);
  assert.ok(errors.some((e) => e.includes('duplicate id')));
  assert.ok(errors.some((e) => e.includes('invalid slug')));
});

test('sets intrinsic size from the viewBox', () => {
  const svg = '<svg width="100%" height="100%" viewBox="0 0 10 20"><g/></svg>';
  const out = withIntrinsicSize(svg, 10, 20);
  assert.match(out, /^<svg width="10" height="20" viewBox="0 0 10 20">/);
  assert.deepEqual(readSvgBox(out), { viewBox: '0 0 10 20', width: 10, height: 20 });
});

test('published drawings must be traced vectors from enough pixels', () => {
  const catalog = loadCatalog(root);
  const only = (a) => validateCatalog(root, { ...catalog, featured: [], assets: [a] });
  const { qualityException, ...traced } = catalog.assets.find((x) => x.status === 'published' && !x.containsRaster && x.previousSources?.length);
  // an untraced image (its old image-in-SVG file) fails…
  const image = { ...traced, sourcePath: traced.previousSources[0], containsRaster: true };
  for (const k of ['width', 'height', 'viewBox', 'fileSize']) delete image[k];
  assert.ok(only(image).errors.some((e) => e.includes('not traced')));
  // …unless it's a draft
  assert.ok(!only({ ...image, status: 'draft' }).errors.some((e) => e.includes('not traced')));
  // a vector traced from too few pixels fails too
  const tiny = { ...traced, provenance: { pixels: 120 } };
  assert.ok(only(tiny).errors.some((e) => e.includes('traced from only 120 px')));
  // an exception lets it through, but it's listed, not hidden
  const r = only({ ...tiny, qualityException: 'waiting for a rescan' });
  assert.ok(!r.errors.some((e) => e.includes('traced from only')));
  assert.ok(r.warnings.some((w) => w.includes(traced.id)));
  // enough pixels: no error, no warning
  assert.ok(!only({ ...traced, provenance: { pixels: 900 } }).errors.length);
});
