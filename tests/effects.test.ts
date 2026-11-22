import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EFFECTS, EFFECT_TYPES, defaultEffect, effectsPad, filterMarkup, layerSvg, normalizeEffect, randomEffect, rng, surprise } from '../src/lib/effects.ts';
import { layerFor, newDoc, parseDoc, svgDataUrl, toSvg, withProvenance, type EditorAsset } from '../src/lib/composition.ts';

const wellFormed = (markup: string) => {
  assert.doesNotMatch(markup, /NaN|undefined|Infinity/, markup.slice(0, 200));
  // every result referenced as an input was produced earlier (or is a built-in)
  const produced = new Set(['SourceGraphic', 'SourceAlpha']);
  for (const m of markup.matchAll(/<(fe\w+)\b([^>]*)>/g)) {
    for (const ref of m[2].matchAll(/\b(?:in|in2)="([^"]+)"/g)) assert.ok(produced.has(ref[1]), `${m[1]} reads unknown "${ref[1]}"`);
    const res = m[2].match(/\bresult="([^"]+)"/);
    if (res) produced.add(res[1]);
  }
};

test('every effect builds a well-formed filter, alone and stacked', () => {
  for (const t of EFFECT_TYPES) wellFormed(filterMarkup('f', { color: null, effects: [defaultEffect(t, 3)], w: 400, h: 300, pad: 20 }));
  const all = EFFECT_TYPES.map((t) => randomEffect(t, rng(9)));
  wellFormed(filterMarkup('f', { color: '#ff0000', effects: all, w: 400, h: 300, pad: 50 }));
});

test('no colour and no effects means no filter', () => {
  assert.equal(filterMarkup('f', { color: null, effects: [], w: 10, h: 10, pad: 0 }), '');
});

test('random effects stay inside each param range, and surprise is reproducible by seed', () => {
  for (let i = 0; i < 50; i++) {
    for (const t of EFFECT_TYPES) {
      const e = randomEffect(t, rng(i));
      for (const p of EFFECTS[t].params) {
        const v = e.params[p.key];
        if (p.kind === 'color') assert.match(String(v), /^#[0-9a-f]{6}$/i);
        else assert.ok(+v >= (p.min ?? -Infinity) && +v <= (p.max ?? Infinity), `${t}.${p.key}=${v}`);
      }
    }
  }
  assert.deepEqual(surprise(rng(5)), surprise(rng(5)));
  assert.notDeepEqual(surprise(rng(5)), surprise(rng(6)));
});

test('normalizeEffect clamps values and drops unknown effects', () => {
  assert.equal(normalizeEffect({ type: 'nope', params: {} }), null);
  const e = normalizeEffect({ type: 'warp', params: { amount: 99, size: 'x', seed: 3 } })!;
  assert.equal(e.params.amount, 1);
  assert.equal(e.params.size, EFFECTS.warp.params.find((p) => p.key === 'size')!.default);
  assert.equal(normalizeEffect({ type: 'glow', params: { color: 'red' } })!.params.color, '#ff4fd8');
});

test('distortions get room around the drawing; clean layers get none', () => {
  assert.equal(effectsPad([], 1000), 0);
  assert.ok(effectsPad([defaultEffect('warp')], 1000) > 0);
  const { svg, pad } = layerSvg({ href: 'data:,', w: 1000, h: 500, color: null, effects: [defaultEffect('echo')], px: 800 });
  assert.ok(pad > 0);
  assert.match(svg, new RegExp(`viewBox="${-pad} ${-pad} ${1000 + 2 * pad} ${500 + 2 * pad}"`));
  assert.match(svg, /width="800"/);
});

test('effects survive the composition file and the SVG export', () => {
  const asset: EditorAsset = { id: 'a', name: 'A', slug: 'a', version: '1.0.0', width: 400, height: 300, license: 'CC BY 4.0', vector: true, display: '', raster: '', embed: '', searchText: '' };
  const assets = new Map([[asset.id, asset]]);
  let doc = newDoc('0.1.0');
  doc.layers.push({ ...layerFor(asset, doc), effects: [defaultEffect('melt', 11), defaultEffect('misprint')] });
  doc = withProvenance(doc, assets);
  const parsed = parseDoc(JSON.stringify(doc), assets);
  assert.deepEqual(parsed.doc!.layers[0].effects, doc.layers[0].effects);

  const svg = toSvg(doc, assets, new Map([['a', svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>')]]));
  assert.match(svg, /<filter id="fx-0"/);
  assert.match(svg, /feTurbulence[^>]*seed="11"/);
  assert.match(svg, /feBlend/);
  assert.match(svg, /<use href="#asset-a" filter="url\(#fx-0\)"\/>/);
});

test('older composition files without effects still open', () => {
  const asset: EditorAsset = { id: 'a', name: 'A', slug: 'a', version: '1.0.0', width: 4, height: 3, license: '', vector: true, display: '', raster: '', embed: '', searchText: '' };
  const doc = newDoc('0.1.0');
  const { effects, ...old } = layerFor(asset, doc);
  doc.layers.push(old as any);
  assert.deepEqual(parseDoc(JSON.stringify(doc), new Map([['a', asset]])).doc!.layers[0].effects, []);
});

test('whole-composition effects wrap every layer but not the background', () => {
  const asset: EditorAsset = { id: 'a', name: 'A', slug: 'a', version: '1.0.0', width: 400, height: 300, license: '', vector: true, display: '', raster: '', embed: '', searchText: '' };
  const assets = new Map([[asset.id, asset]]);
  let doc = newDoc('0.1.0');
  doc.layers.push(layerFor(asset, doc), layerFor(asset, doc));
  doc.effects = [defaultEffect('glitch', 4)];
  doc = withProvenance(doc, assets);
  const svg = toSvg(doc, assets, new Map([['a', 'data:,']]));
  assert.match(svg, /<filter id="fx-all"[^>]*x="0" y="0" width="1600" height="1000"/);
  const rect = svg.indexOf('<rect'), group = svg.indexOf('<g filter="url(#fx-all)">'), close = svg.lastIndexOf('</g>');
  assert.ok(rect < group, 'background is outside the filtered group');
  assert.equal(svg.slice(group, close).match(/<use /g)?.length, 2);
  assert.deepEqual(parseDoc(JSON.stringify(doc), assets).doc!.effects, doc.effects);
  const { svg: comp, pad } = layerSvg({ href: 'data:,', w: 1600, h: 1000, color: null, effects: doc.effects, px: 800, clip: true });
  assert.equal(pad, 0);
  assert.match(comp, /viewBox="0 0 1600 1000"/);
});
