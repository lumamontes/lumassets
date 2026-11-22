// Run with `pnpm test` (Node 22.18+ strips TypeScript types natively).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layerFor, newDoc, ownToEditorAsset, parseDoc, parseOwnAssets, safeFilename, svgDataUrl, toSvg, withProvenance, type EditorAsset } from '../src/lib/composition.ts';

const asset: EditorAsset = {
  id: 'sq3-01', name: 'Chevron Wedge', slug: 'chevron-wedge', version: '1.0.0', width: 1071, height: 684,
  license: 'CC BY 4.0', vector: true, display: '', raster: '', embed: '', searchText: '',
};
const assets = new Map([[asset.id, asset]]);

test('new layers fit inside the canvas', () => {
  const doc = newDoc('0.1.0');
  const l = layerFor(asset, doc);
  assert.ok(asset.width * l.scale <= doc.canvas.width * 0.6 + 0.5);
  assert.ok(asset.height * l.scale <= doc.canvas.height * 0.6 + 0.5);
  assert.equal(l.assetVersion, '1.0.0');
});

test('round-trips through JSON with provenance', () => {
  let doc = newDoc('0.1.0');
  doc.layers.push(layerFor(asset, doc));
  doc = withProvenance(doc, assets);
  assert.deepEqual(doc.provenance.assets, [{ id: 'sq3-01', name: 'Chevron Wedge', version: '1.0.0', license: 'CC BY 4.0' }]);
  const parsed = parseDoc(JSON.stringify(doc), assets);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.doc?.layers, doc.layers);
});

test('refuses compositions that reference unknown assets', () => {
  const doc = newDoc('0.1.0');
  doc.layers.push({ ...layerFor(asset, doc), assetId: 'gone-99' });
  const parsed = parseDoc(JSON.stringify(doc), assets);
  assert.equal(parsed.doc, undefined);
  assert.match(parsed.errors.join(' '), /gone-99/);
});

test('warns when an asset version changed', () => {
  const doc = newDoc('0.1.0');
  doc.layers.push({ ...layerFor(asset, doc), assetVersion: '0.9.0' });
  const parsed = parseDoc(JSON.stringify(doc), assets);
  assert.ok(parsed.doc);
  assert.equal(parsed.warnings.length, 1);
});

test('rejects non-compositions and bad JSON', () => {
  assert.ok(parseDoc('{', assets).errors.length);
  assert.ok(parseDoc('{"format":"other"}', assets).errors.length);
});

test('SVG export embeds each asset once and applies transforms', () => {
  const doc = newDoc('0.1.0');
  const a = layerFor(asset, doc);
  doc.layers.push(a, { ...a, id: 'b', flipX: true, color: '#ff0000', blendMode: 'multiply', opacity: 0.5 });
  const svg = toSvg(withProvenance(doc, assets), assets, new Map([[asset.id, svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>')]]));
  assert.equal(svg.match(/<image /g)?.length, 1);
  assert.equal(svg.match(/<use /g)?.length, 2);
  assert.match(svg, /mix-blend-mode:multiply/);
  assert.match(svg, /feFlood flood-color="#ff0000"/);
  assert.match(svg, /scale\(-/);
  assert.match(svg, /<rect width="1600" height="1000" fill="#ffffff"\/>/);
  assert.match(svg, /href="data:image\/svg\+xml;base64,/);
});

test('safe filenames', () => {
  assert.equal(safeFilename('Ação: Shards & Lines!'), 'acao-shards-lines');
  assert.equal(safeFilename('***'), 'composition');
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const mine = { id: 'own-abc123', name: 'Cat', width: 300, height: 200, vector: false, data: PNG };

test('own drawings travel inside the saved file and reopen without the library', () => {
  let doc = newDoc('0.1.0');
  doc.layers.push(layerFor(asset, doc), layerFor(ownToEditorAsset(mine), doc));
  const withOwn = new Map([...assets, [mine.id, ownToEditorAsset(mine)]]);
  doc = { ...withProvenance(doc, withOwn), ownAssets: [mine] };
  assert.equal(doc.provenance.assets[1].license, 'Your own drawing');
  const parsed = parseDoc(JSON.stringify(doc), assets); // library only: the file brings its own drawing
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.own, [mine]);
  assert.equal(parsed.doc?.layers[1].assetId, 'own-abc123');
});

test('a file without its own drawing is refused, not guessed', () => {
  const doc = newDoc('0.1.0');
  doc.layers.push(layerFor(ownToEditorAsset(mine), doc));
  assert.match(parseDoc(JSON.stringify(doc), assets).errors.join(' '), /own-abc123/);
});

test('own drawings must be images under the size limit', () => {
  const bad = parseOwnAssets([
    { ...mine, data: 'data:text/html;base64,PGgxPg==' },
    { ...mine, id: '../etc' },
    { ...mine, width: -1 },
    { ...mine, data: 'data:image/svg+xml;base64,PHN2Zy8+', name: '' },
  ]);
  assert.equal(bad.errors.length, 3);
  assert.deepEqual(bad.assets.map((a) => [a.vector, a.name]), [[true, 'My drawing']]);
  assert.match(parseOwnAssets('nope').errors[0], /list/);
});

test('SVG export embeds own drawings like library ones', () => {
  const doc = newDoc('0.1.0');
  doc.layers.push(layerFor(ownToEditorAsset(mine), doc));
  const svg = toSvg(withProvenance(doc, new Map([[mine.id, ownToEditorAsset(mine)]])), new Map([[mine.id, ownToEditorAsset(mine)]]), new Map([[mine.id, PNG]]));
  assert.match(svg, /<image id="asset-own-abc123" width="300" height="200"/);
  assert.match(svg, /Cat \(own-abc123 v1, Your own drawing\)/);
});

import { compositionFromSvg, pngTextFor, PNG_KEYS } from '../src/lib/composition.ts';
import { readPngText, withPngText } from '../src/lib/png-meta.ts';
import { inflateSync } from 'node:zlib';

// a real 1×1 PNG (signature, IHDR, IDAT, IEND)
const PNG1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

test('exported PNGs carry where they come from, and the composition itself', () => {
  let doc = newDoc('0.1.0');
  doc.title = 'Ação ✦';
  doc.layers.push(layerFor(asset, doc));
  doc = withProvenance(doc, assets);
  doc.provenance.url = 'https://lumassets.pages.dev/compose/';
  const png = withPngText(PNG1, pngTextFor(doc));
  const text = readPngText(png);
  assert.equal(text.Software, 'lumassets composer');
  assert.equal(text.Source, 'https://lumassets.pages.dev/compose/');
  assert.equal(text.Title, 'Ação ✦'); // UTF-8 survives (iTXt)
  assert.match(text.Description, /Chevron Wedge \(sq3-01/);
  const reopened = parseDoc(text[PNG_KEYS.composition], assets);
  assert.deepEqual(reopened.errors, []);
  assert.equal(reopened.doc?.provenance.url, 'https://lumassets.pages.dev/compose/');
  // still a valid PNG: chunk order kept, IEND last, image data untouched
  assert.equal(Buffer.from(png.subarray(png.length - 8, png.length - 4)).toString(), 'IEND');
  const idat = Buffer.from(png).indexOf('IDAT');
  const len = Buffer.from(png).readUInt32BE(idat - 4);
  assert.equal(inflateSync(Buffer.from(png.subarray(idat + 4, idat + 4 + len))).length, 5);
});

test('exported SVGs carry the composition too', () => {
  let doc = newDoc('0.1.0');
  doc.title = 'A <b> & "c"';
  doc.layers.push(layerFor(asset, doc));
  doc = withProvenance(doc, assets);
  const svg = toSvg(doc, assets, new Map([[asset.id, 'data:image/svg+xml;base64,PHN2Zy8+']]));
  const json = compositionFromSvg(svg)!;
  const reopened = parseDoc(json, assets);
  assert.deepEqual(reopened.errors, []);
  assert.equal(reopened.doc?.title, 'A <b> & "c"');
  assert.equal(compositionFromSvg('<svg/>'), null);
});

test('PNG text keys from a file cannot reach the object prototype', () => {
  const text = readPngText(withPngText(PNG1, Object.fromEntries([['__proto__', 'x'], ['constructor', 'y']])));
  assert.equal(Object.getPrototypeOf(text), null);
  assert.equal(text.__proto__, 'x'); // just a key like any other
  assert.equal(({} as Record<string, unknown>).constructor, Object);
});

test('SVG keeps excluded layers in their original stacking order', () => {
  const doc = newDoc('0.1.0');
  doc.effects = [{ type: 'rgbsplit', params: { distance: 12 } }];
  doc.layers = [101, 202, 303].map((x) => ({ ...layerFor(asset, doc), x }));
  doc.layers[1].excludeFromEverything = true;
  const svg = toSvg(doc, assets, new Map([[asset.id, 'data:image/svg+xml;base64,AA==']]));
  const [before, between, after] = [101, 202, 303].map((x) => svg.indexOf(`translate(${x} `));
  const filters = [...svg.matchAll(/<g filter="url\(#fx-all\)">/g)].map((match) => match.index);
  assert.equal(filters.length, 2);
  assert.ok(filters[0] < before && before < between && between < filters[1] && filters[1] < after);
  assert.equal(parseDoc(JSON.stringify(doc), assets).doc?.layers[1].excludeFromEverything, true);
});
