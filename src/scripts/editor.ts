import { downloadFile } from './download';
// Composition editor. Loaded only on /compose.
// The CompositionDoc is the source of truth; the Fabric canvas is a view of it.
import { ActiveSelection, Canvas, Control, FabricImage, controlsUtils, type FabricObject } from 'fabric';
import {
  CANVAS_LIMITS, DEFAULT_TITLE, PNG_KEYS, compositionFromSvg, everythingRuns, layerUnderlay, layerFor, layerId, newDoc, parseDoc, pngTextFor, round, safeFilename, toSvg, withProvenance,
  type BlendMode, type CompositionDoc, type EditorAsset, type Layer, type OwnAsset, ownToEditorAsset,
} from '../lib/composition';
import { icon, type IconName } from '../lib/icons';
import { importFile, rasterFor } from './own-drawings';
import { enclosedFill } from './layer-fill';
import { readPngText, withPngText } from '../lib/png-meta';
import { EFFECTS, EFFECT_TYPES, defaultEffect, layerSvg, randomEffect, surprise, type Effect } from '../lib/effects';

type LayerObject = FabricObject & { layerId?: string };
/** A layer's rendered image; `unitsW` is its width in the drawing's units (larger than the
 *  drawing when effects need room around it). */
type Source = (HTMLImageElement | HTMLCanvasElement) & { unitsW?: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function startEditor() {
  const boot = JSON.parse($('boot').textContent!) as { release: string; assets: EditorAsset[]; turnstileSiteKey: string };
  const assets = new Map(boot.assets.map((a) => [a.id, a]));
  /** The visitor's own drawings this session (kept out of undo snapshots: they can be large). */
  const own = new Map<string, OwnAsset>();

  let doc = newDoc(boot.release);
  let selectedId: string | null = null;
  const snapshots: string[] = [];
  let cursor = -1;
  let renderToken = 0;

  const ui = {
    stage: $('stage'),
    status: $('status'),
    cw: $<HTMLInputElement>('cw'),
    ch: $<HTMLInputElement>('ch'),
    bg: $<HTMLInputElement>('bg'),
    transparent: $<HTMLInputElement>('transparent'),
    fields: $<HTMLFieldSetElement>('layer-fields'),
    noLayer: $('no-layer'),
    opacity: $<HTMLInputElement>('opacity'),
    scale: $<HTMLInputElement>('scale'),
    rotation: $<HTMLInputElement>('rotation'),
    blend: $<HTMLSelectElement>('blend'),
    useColor: $<HTMLInputElement>('use-color'),
    color: $<HTMLInputElement>('color'),
    layers: $('layers'),
    picker: $('picker'),
    search: $<HTMLInputElement>('lib-search'),
    open: $<HTMLInputElement>('open'),
  };

  const layerColors = [
    { key: 'color', checkbox: ui.useColor, picker: ui.color },
    { key: 'fill', checkbox: $<HTMLInputElement>('use-fill'), picker: $<HTMLInputElement>('fill') },
    { key: 'background', checkbox: $<HTMLInputElement>('use-layer-background'), picker: $<HTMLInputElement>('layer-background') },
  ] as const;

  const canvas = new Canvas($<HTMLCanvasElement>('canvas'), {
    selection: false, // one layer at a time keeps the document model simple
    preserveObjectStacking: true,
    uniformScaling: true,
  });

  const say = (msg: string) => { ui.status.textContent = msg; };

  // ---------- images ----------
  const imageCache = new Map<string, Promise<HTMLImageElement>>();

  function loadImage(asset: EditorAsset) {
    let p = imageCache.get(asset.id);
    if (!p) {
      p = new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Couldn't load ${asset.name}`));
        img.src = asset.raster;
      });
      imageCache.set(asset.id, p);
      p.catch(() => imageCache.delete(asset.id));
    }
    return p;
  }

  // Drawings as data: URLs, shared by effect rendering and SVG export.
  const embedCache = new Map<string, Promise<string>>();
  const toDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  function embedUrl(asset: EditorAsset) {
    let p = embedCache.get(asset.id);
    if (!p) {
      p = fetch(asset.embed).then((res) => {
        if (!res.ok) throw new Error(`Couldn't load the file for ${asset.name}`);
        return res.blob();
      }).then(toDataUrl);
      embedCache.set(asset.id, p);
      p.catch(() => embedCache.delete(asset.id));
    }
    return p;
  }

  /** Ink colour + effects are rendered by the browser's own SVG filter engine (the same
   *  filter markup the SVG export writes), then rasterised once into a canvas and cached. */
  const rendered = new Map<string, Promise<Source>>();
  const RENDER_PX = 1400;
  const fillCache = new Map<string, Promise<string>>();
  async function fillFor(layer: Layer) {
    if (!layer.fill) return undefined;
    const asset = assets.get(layer.assetId)!;
    const color = layer.fill;
    const key = JSON.stringify([asset.id, color]);
    let fill = fillCache.get(key);
    if (!fill) {
      fill = loadImage(asset).then((image) => enclosedFill(image, asset.width, asset.height, color));
      fillCache.set(key, fill);
      fill.catch(() => fillCache.delete(key));
      if (fillCache.size > 24) fillCache.delete(fillCache.keys().next().value!);
    }
    return fill;
  }
  async function sourceFor(layer: Layer): Promise<Source> {
    const asset = assets.get(layer.assetId)!;
    if (!layer.color && !layer.fill && !layer.background && !layer.effects?.length) {
      const img: Source = await loadImage(asset);
      img.unitsW = asset.width;
      return img;
    }
    const key = JSON.stringify([layer.assetId, layer.color, layer.fill, layer.background, layer.effects]);
    let p = rendered.get(key);
    if (!p) {
      p = (async () => {
        const href = await embedUrl(asset);
        const { svg, pad } = layerSvg({ href, w: asset.width, h: asset.height, color: layer.color, effects: layer.effects, px: RENDER_PX,
          underlay: layerUnderlay(asset.width, asset.height, layer.background, await fillFor(layer)),
        });
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error(`Couldn't render effects for ${asset.name}`));
            i.src = url;
          });
          const c: Source = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d')!.drawImage(img, 0, 0);
          c.unitsW = asset.width + 2 * pad;
          return c;
        } finally {
          URL.revokeObjectURL(url);
        }
      })();
      rendered.set(key, p);
      p.catch(() => rendered.delete(key));
      if (rendered.size > 60) rendered.delete(rendered.keys().next().value!);
    }
    return p;
  }

  // ---------- doc <-> canvas ----------
  /** Fabric scale for a layer: drawing units per pixel of its rendered image. */
  const pixelRatio = (layer: Layer, el: Source) =>
    (el.unitsW ?? assets.get(layer.assetId)!.width) / (el instanceof HTMLImageElement ? el.naturalWidth : el.width);

  function applyLayer(obj: LayerObject, layer: Layer, el: HTMLImageElement | HTMLCanvasElement) {
    const k = layer.scale * pixelRatio(layer, el);
    obj.set({
      left: layer.x, top: layer.y, angle: layer.rotation,
      scaleX: k, scaleY: k, flipX: layer.flipX, flipY: layer.flipY,
      opacity: layer.opacity,
      globalCompositeOperation: layer.blendMode === 'normal' ? 'source-over' : layer.blendMode,
    });
    obj.setCoords();
  }

  function readLayer(obj: LayerObject, layer: Layer) {
    const el = (obj as FabricImage).getElement() as HTMLImageElement | HTMLCanvasElement;
    layer.x = round(obj.left ?? layer.x);
    layer.y = round(obj.top ?? layer.y);
    layer.rotation = round(normalizeAngle(obj.angle ?? 0), 2);
    layer.scale = round((obj.scaleX ?? 1) / pixelRatio(layer, el), 4);
  }

  const normalizeAngle = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

  let zoom = 1;
  function fitStage() {
    const wrap = ui.stage.parentElement!;
    const availW = Math.max(200, wrap.clientWidth - 48);
    const availH = Math.max(200, window.innerHeight - 260);
    zoom = Math.min(availW / doc.canvas.width, availH / doc.canvas.height, 1);
    canvas.setDimensions({ width: Math.round(doc.canvas.width * zoom), height: Math.round(doc.canvas.height * zoom) });
    canvas.setZoom(zoom);
    canvas.requestRenderAll();
  }

  // ---------- canvas handles: a clear rotate handle above the layer, ink-coloured corners ----------
  const rotateGlyph = new Path2D('M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5'); // same as the "reset" icon
  const rotateControl = new Control({
    x: 0, y: -0.5, offsetY: -30, sizeX: 30, sizeY: 30, withConnection: true,
    actionName: 'rotate', cursorStyle: 'grab',
    actionHandler: controlsUtils.rotationWithSnapping,
    render(ctx, left, top) {
      ctx.save();
      ctx.translate(left, top);
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.translate(-7.2, -7.2);
      ctx.scale(0.6, 0.6);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(rotateGlyph);
      ctx.restore();
    },
  });
  function styleHandles(obj: LayerObject) {
    obj.set({
      borderColor: '#000', borderScaleFactor: 1.5, padding: 4,
      cornerColor: '#fff', cornerStrokeColor: '#000', cornerStyle: 'circle', cornerSize: 11, transparentCorners: false,
    });
    obj.controls = { ...obj.controls, mtr: rotateControl };
    obj.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
  }

  const objectFor = (id: string) => canvas.getObjects().find((o) => (o as LayerObject).layerId === id) as LayerObject | undefined;

  let rebuilding = false;
  async function render() {
    let failed = 0;
    const token = ++renderToken;
    const built = await Promise.allSettled(doc.layers.map(async (l) => {
      const el = await sourceFor(l);
      const obj = new FabricImage(el, { originX: 'center', originY: 'center' }) as LayerObject;
      obj.layerId = l.id;
      styleHandles(obj);
      return { obj, layer: l, source: el };
    }));
    if (token !== renderToken) return; // a newer render started
    endDragView();
    // clearing and re-selecting fire Fabric selection events; they must not change selectedId
    rebuilding = true;
    try {
      canvas.clear();
      canvas.backgroundColor = doc.canvas.background ?? '';
      for (const result of built) {
        if (result.status === 'rejected') { failed++; continue; }
        const { obj, layer, source } = result.value;
        // A different drawing may have been loading while this layer was edited.
        applyLayer(obj, layer, source);
        canvas.add(obj);
      }
      fitStage();
      const sel = selectedId && objectFor(selectedId);
      if (sel) canvas.setActiveObject(sel);
    } finally {
      rebuilding = false;
    }
    canvas.requestRenderAll();
    if (failed) say(`${failed} layer image(s) failed to load. Check your connection and reload.`);
    syncPanels();
    globalSoon();
  }

  // ---------- history ----------
  function commit(label?: string) {
    snapshots.splice(cursor + 1);
    snapshots.push(JSON.stringify(doc));
    if (snapshots.length > 100) snapshots.shift();
    cursor = snapshots.length - 1;
    if (label) say(label);
    syncPanels();
  }

  function travel(step: number) {
    const next = cursor + step;
    if (next < 0 || next >= snapshots.length) return;
    cursor = next;
    doc = JSON.parse(snapshots[cursor]);
    if (selectedId && !doc.layers.some((l) => l.id === selectedId)) selectedId = null;
    render();
    say(step < 0 ? 'Undone.' : 'Redone.');
  }

  // ---------- selection & panels ----------
  const selected = () => doc.layers.find((l) => l.id === selectedId) ?? null;

  function select(id: string | null) {
    selectedId = id;
    const obj = id ? objectFor(id) : undefined;
    // A layer can be selected in the list before its Fabric object has loaded.
    // Clearing the previous Fabric selection must not clear that pending choice.
    rebuilding = true;
    try {
      if (obj) canvas.setActiveObject(obj);
      else canvas.discardActiveObject();
    } finally {
      rebuilding = false;
    }
    canvas.requestRenderAll();
    syncPanels();
  }

  // ---------- effects panels (one for the selected layer, one for the whole composition) ----------
  type FxOwner = { key: string; effects: Effect[] };

  /** Effects whose controls are expanded (new ones open, so you can tweak right away). */
  const openFx = new WeakSet<Effect>();

  /** Builds an effect-stack editor in `listId`. `owner()` returns whose stack it edits (or null);
   *  `live` re-renders during drags, `done` is called after a finished change. */
  function fxEditor(listId: string, countId: string, owner: () => FxOwner | null, live: () => void, done: (msg?: string) => void) {
    let sig = '';
    return function sync() {
      const o = owner();
      const list = $(listId);
      const on = o ? o.effects.filter((e) => !e.off).length : 0;
      $(countId).textContent = o && o.effects.length ? (on === o.effects.length ? `${on}` : `${on}/${o.effects.length}`) : '';
      const next = o ? `${o.key}|${o.effects.map((e) => `${e.type}${e.off ? '-' : ''}${openFx.has(e) ? '+' : ''}`).join(',')}` : '';
      if (o && next === sig) {
        // same stack: refresh values (after undo etc.), never the control being dragged
        list.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((input) => {
          if (input === document.activeElement) return;
          input.value = String(o.effects[+input.dataset.i!]?.params[input.dataset.key!] ?? input.value);
        });
        return;
      }
      sig = next;
      list.replaceChildren();
      if (!o) return;
      o.effects.forEach((fx, i) => {
        const def = EFFECTS[fx.type];
        const li = document.createElement('li');
        li.className = `fx${fx.off ? ' off' : ''}`;
        const head = document.createElement('div');
        head.className = 'fx-head';
        const expanded = openFx.has(fx);
        const name = document.createElement('button');
        name.type = 'button';
        name.className = 'fx-name';
        name.setAttribute('aria-expanded', String(expanded));
        name.innerHTML = icon('chevron', 12);
        name.append(def.label);
        const group = document.createElement('small');
        group.textContent = def.group;
        name.append(group);
        name.addEventListener('click', () => { expanded ? openFx.delete(fx) : openFx.add(fx); sig = ''; sync(); });
        const btn = (glyph: IconName, aria: string, fn: () => void, disabled = false) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'icon';
          b.innerHTML = icon(glyph, 14);
          b.title = aria;
          b.setAttribute('aria-label', `${aria}: ${def.label}`);
          b.disabled = disabled;
          b.addEventListener('click', fn);
          return b;
        };
        head.append(
          name,
          btn(fx.off ? 'eye-off' : 'eye', fx.off ? 'Switch on' : 'Switch off', () => { fx.off = !fx.off || undefined; if (!fx.off) delete fx.off; done(fx.off ? `${def.label} off.` : `${def.label} on.`); }),
          btn('shuffle', 'Shuffle', () => { const n = randomEffect(fx.type); if (openFx.has(fx)) openFx.add(n); o.effects[i] = n; done(`Shuffled ${def.label}.`); }),
          btn('up', 'Move up (applied earlier)', () => { [o.effects[i - 1], o.effects[i]] = [o.effects[i], o.effects[i - 1]]; done(); }, i === 0),
          btn('x', 'Remove', () => { o.effects.splice(i, 1); done(`Removed ${def.label}.`); }),
        );
        li.append(head);
        const body = document.createElement('div');
        body.className = 'fx-body';
        body.hidden = !expanded;
        const hint = document.createElement('p');
        hint.className = 'fx-hint';
        hint.textContent = def.hint;
        body.append(hint);
        for (const p of def.params) {
          if (p.key === 'seed') continue; // the Shuffle button changes the seed
          const label = document.createElement('label');
          label.textContent = p.label;
          const input = document.createElement('input');
          if (p.kind === 'color') {
            input.type = 'color';
          } else {
            input.type = 'range';
            input.min = String(p.min ?? 0);
            input.max = String(p.max ?? 1);
            input.step = String(p.step ?? 0.01);
          }
          input.value = String(fx.params[p.key]);
          input.dataset.i = String(i);
          input.dataset.key = p.key;
          const read = () => (p.kind === 'color' ? input.value : Number(input.value));
          input.addEventListener('input', () => { fx.params[p.key] = read(); live(); });
          input.addEventListener('change', () => { fx.params[p.key] = read(); commit(); });
          label.append(input);
          body.append(label);
        }
        li.append(body);
        list.append(li);
      });
    };
  }

  const syncEffects = fxEditor(
    'fx-list', 'fx-count',
    () => { const l = selected(); return l ? { key: l.id, effects: (l.effects ??= []) } : null; },
    () => renderSoon(),
    (msg) => { commit(msg); render(); },
  );
  const syncGlobalEffects = fxEditor(
    'gfx-list', 'gfx-count',
    () => ({ key: 'all', effects: (doc.effects ??= []) }),
    () => globalSoon(),
    (msg) => { commit(msg); globalSoon(); },
  );

  // ---------- whole-composition effects: a filtered copy of the canvas, shown over it ----------
  // The layers (without the background) are captured from Fabric, run through the same SVG
  // filter the export writes, and the result is shown in an overlay. While you drag a layer,
  // the other layers keep their effects (see "drag view" below); everything is recomputed
  // when you let go.
  const overlay = document.createElement('div');
  overlay.className = 'global-fx';
  overlay.setAttribute('aria-hidden', 'true');
  const overlayImg = document.createElement('img');
  overlayImg.alt = '';
  overlay.append(overlayImg);
  canvas.lowerCanvasEl.after(overlay);
  let globalToken = 0;
  let globalTimer: ReturnType<typeof setTimeout> | undefined;
  // drag view state (see below)
  let dragging = false;
  let dragStarting = false;
  let dragView: { hidden: FabricObject[] } | null = null;
  const globalSoon = () => { clearTimeout(globalTimer); globalTimer = setTimeout(updateGlobal, 180); };

  function showOverlay(on: boolean) {
    overlay.hidden = !on;
    canvas.lowerCanvasEl.style.opacity = on ? '0' : '1';
    canvas.requestRenderAll();
  }

  // Fabric normally draws the selection on the lower canvas, which Everything hides.
  // Draw it on the pointer canvas while the filtered preview is covering the artwork.
  canvas.on('after:render', ({ ctx }) => {
    if (ctx !== canvas.getContext() && ctx !== canvas.contextTop) return;
    canvas.clearContext(canvas.contextTop);
    if (!overlay.hidden && !dragView) canvas.drawControls(canvas.contextTop);
  });

  /** Renders a preview without the background or selection controls. */
  async function globalImage(multiplier: number, except?: Set<string>): Promise<HTMLImageElement | null> {
    if (!doc.effects?.length || !doc.layers.length) return null;
    if (doc.layers.some((layer) => layer.excludeFromEverything))
      return renderEverythingRuns(multiplier, except);

    const bg = canvas.backgroundColor;
    // Show temporarily hidden objects for a full capture, then restore the drag view.
    const hidden = except ? undefined : dragView?.hidden;
    hidden?.forEach((object) => (object.visible = true));
    canvas.backgroundColor = '';
    let href: string;
    try {
      // Fabric's export already skips controls. Discarding selection here would end
      // an active resize or rotation, even if we immediately reselected the object.
      href = canvas.toDataURL({
        format: 'png',
        multiplier,
        filter: except ? (object) => !except.has((object as LayerObject).layerId ?? '') : undefined,
      });
    } finally {
      canvas.backgroundColor = bg;
      hidden?.forEach((object) => (object.visible = false));
    }
    canvas.requestRenderAll();
    return filterEverything(href, multiplier, doc.canvas, doc.effects);
  }

  async function filterEverything(href: string, multiplier: number, { width: W, height: H }: CompositionDoc['canvas'], effects?: Effect[]) {
    const { svg } = layerSvg({ href, w: W, h: H, color: null, effects, px: Math.max(W, H) * multiplier * zoom, clip: true });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Couldn't apply the composition's effects"));
        img.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function renderEverythingRuns(multiplier: number, except?: Set<string>) {
    const runs = everythingRuns(except ? doc.layers.filter((layer) => !except.has(layer.id)) : doc.layers);
    const { effects, canvas: dimensions } = doc;
    const output = document.createElement('canvas');
    output.width = Math.round(canvas.width * multiplier);
    output.height = Math.round(canvas.height * multiplier);
    const ctx = output.getContext('2d')!;
    const bg = canvas.backgroundColor;
    // Capture synchronously so all runs correspond to the same canvas state.
    dragView?.hidden.forEach((obj) => (obj.visible = true));
    canvas.backgroundColor = '';
    let captures: string[];
    try {
      captures = runs.map((run) => {
        const ids = new Set(run.map((layer) => layer.id));
        return canvas.toDataURL({ format: 'png', multiplier, filter: (obj) => ids.has((obj as LayerObject).layerId ?? '') });
      });
    } finally {
      canvas.backgroundColor = bg;
      dragView?.hidden.forEach((obj) => (obj.visible = false));
      canvas.requestRenderAll();
    }
    for (const [i, run] of runs.entries()) {
      const excluded = run[0].excludeFromEverything;
      const image = await filterEverything(captures[i], multiplier, dimensions, excluded ? undefined : effects);
      ctx.globalCompositeOperation = excluded && run[0].blendMode !== 'normal' ? run[0].blendMode : 'source-over';
      ctx.drawImage(image, 0, 0, output.width, output.height);
    }
    const image = new Image();
    image.src = output.toDataURL();
    await image.decode();
    return image;
  }

  const hasEverythingEffects = () => Boolean(doc.effects?.length && doc.layers.some((layer) => !layer.excludeFromEverything));

  async function updateGlobal() {
    const token = ++globalToken;
    overlay.style.background = doc.canvas.background ?? 'transparent';
    if (!hasEverythingEffects()) { endDragView(); showOverlay(false); return; }
    try {
      const img = await globalImage(1);
      if (token !== globalToken || dragging) return;
      endDragView();
      if (!img) { showOverlay(false); return; }
      overlayImg.src = img.src;
      showOverlay(true);
    } catch (e) {
      endDragView();
      showOverlay(false);
      say((e as Error).message);
    }
  }
  showOverlay(false);

  // ---------- drag view: moving a layer without losing the composition's effects ----------
  // Fabric draws the moving layer on its lower canvas, which sits under the overlay. So while
  // a layer is moved, scaled or rotated, the *other* layers are captured once with the
  // effects and shown under the canvas, and the canvas draws only what is moving (without
  // the composition's effects, which depend on where everything is). On release the whole
  // composition is recomputed, and the drag view stays until the new overlay is ready.
  const upperCanvasEl = canvas.upperCanvasEl;

  function layerIdsOf(target: FabricObject) {
    const objs = target instanceof ActiveSelection ? target.getObjects() : [target];
    return new Set(objs.map((o) => (o as LayerObject).layerId).filter((id): id is string => !!id));
  }

  async function startDragView(target: FabricObject) {
    const ids = layerIdsOf(target);
    if (!ids.size || dragView || dragStarting) return;
    dragStarting = true;
    clearTimeout(globalTimer);
    ++globalToken; // a refresh that was on its way would show the old positions
    try {
      const img = await globalImage(1, ids);
      if (!dragging || dragView || !img) return; // released already: the release recomputes
      await img.decode().catch(() => {});
      if (!dragging || dragView) return;
      overlayImg.src = img.src;
      const hidden = canvas.getObjects().filter((o) => o.visible && !ids.has((o as LayerObject).layerId ?? ''));
      dragView = { hidden };
      hidden.forEach((o) => (o.visible = false));
      canvas.backgroundColor = ''; // the overlay carries the background
      overlay.hidden = false;
      overlay.style.zIndex = '0';
      Object.assign(canvas.lowerCanvasEl.style, { position: 'relative', zIndex: '1', opacity: '1' });
      upperCanvasEl.style.zIndex = '2';
      canvas.requestRenderAll();
    } catch {
      // keep dragging without effects; the release recomputes them
    } finally {
      dragStarting = false;
    }
  }

  function endDragView() {
    if (!dragView) return;
    dragView.hidden.forEach((o) => (o.visible = true));
    canvas.backgroundColor = doc.canvas.background ?? '';
    dragView = null;
    overlay.style.zIndex = '';
    Object.assign(canvas.lowerCanvasEl.style, { position: '', zIndex: '' });
    upperCanvasEl.style.zIndex = '';
    canvas.requestRenderAll();
  }

  function syncPanels() {
    syncEffects();
    syncGlobalEffects();
    ui.cw.value = String(doc.canvas.width);
    ui.ch.value = String(doc.canvas.height);
    ui.transparent.checked = doc.canvas.background === null;
    ui.bg.value = doc.canvas.background ?? '#ffffff';
    ui.bg.disabled = doc.canvas.background === null;

    const l = selected();
    ui.fields.disabled = !l;
    ui.noLayer.hidden = Boolean(l);
    $('layer-count').textContent = doc.layers.length ? String(doc.layers.length) : '';
    $('layers-empty').hidden = doc.layers.length > 0;
    const inks = new Set(doc.layers.map((x) => x.color));
    if (inks.size === 1 && [...inks][0]) $<HTMLInputElement>('ink-all').value = [...inks][0]!;
    if (l) {
      ui.opacity.value = String(l.opacity);
      ui.scale.value = String(l.scale);
      ui.rotation.value = String(Math.round(l.rotation));
      ui.blend.value = l.blendMode;
      for (const { key, checkbox, picker } of layerColors) {
        checkbox.checked = Boolean(l[key]);
        if (l[key]) picker.value = l[key];
      }
    }

    document.querySelectorAll<HTMLButtonElement>('[data-cmd="undo"]').forEach((b) => (b.disabled = cursor <= 0));
    document.querySelectorAll<HTMLButtonElement>('[data-cmd="redo"]').forEach((b) => (b.disabled = cursor >= snapshots.length - 1));

    const exclusions = $('everything-exclusions');
    const focused = document.activeElement instanceof HTMLInputElement && exclusions.contains(document.activeElement)
      ? document.activeElement.dataset.layerId : undefined;
    exclusions.replaceChildren(...doc.layers.map((layer, index) => {
      const label = document.createElement('label');
      label.className = 'check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(layer.excludeFromEverything);
      input.dataset.layerId = layer.id;
      input.addEventListener('change', () => {
        layer.excludeFromEverything = input.checked;
        commit();
        globalSoon();
      });
      label.append(input, `${index + 1}. ${assets.get(layer.assetId)!.name}`);
      return label;
    }));
    if (!doc.layers.length) exclusions.textContent = 'Add a drawing to choose which layers to exclude.';
    if (focused) Array.from(exclusions.querySelectorAll('input')).find((input) => input.dataset.layerId === focused)?.focus();

    ui.layers.replaceChildren(...doc.layers.map((layer, i) => {
      const a = assets.get(layer.assetId)!;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(layer.id === selectedId));
      const img = document.createElement('img');
      img.src = a.display;
      img.className = a.own ? '' : 'art';
      img.alt = '';
      const span = document.createElement('span');
      span.textContent = `${i + 1}. ${a.name}`;
      b.append(img, span);
      b.addEventListener('click', () => { select(layer.id); showTab('layer'); });
      li.append(b);
      return li;
    }));
  }

  // ---------- commands ----------
  /** The colour last picked in "Ink for all". New drawings get it too, as long as every layer
   *  still has it (so undoing the recolour, or "Original ink", stops it). */
  let inkForAll: string | null = null;
  const activeInkForAll = () =>
    inkForAll && doc.layers.every((l) => l.color === inkForAll) ? inkForAll : null;

  async function addAsset(id: string) {
    const a = assets.get(id);
    if (!a) { say(`Asset "${id}" isn't in the library.`); return; }
    const layer = layerFor(a, doc);
    const ink = activeInkForAll();
    if (ink) layer.color = ink;
    // Cascade new layers a little so they don't stack exactly.
    const n = doc.layers.length % 6;
    layer.x += n * 24; layer.y += n * 24;
    doc.layers.push(layer);
    selectedId = layer.id;
    showTab('layer');
    commit(`Added ${a.name}.`);
    await render();
  }

  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  const renderSoon = () => { clearTimeout(renderTimer); renderTimer = setTimeout(render, 120); };

  /** Live preview while a colour picker is being dragged: re-renders only the given layers'
   *  images (cached per colour), at most every ~50 ms, without rebuilding the canvas. */
  let refreshIds = new Set<string>();
  let refreshTimer = 0;
  let refreshing = false;
  function refreshSoon(ids: string[]) {
    ids.forEach((id) => refreshIds.add(id));
    if (refreshTimer || refreshing) return;
    refreshTimer = window.setTimeout(async () => {
      refreshTimer = 0;
      refreshing = true;
      const todo = refreshIds;
      refreshIds = new Set();
      try {
        await Promise.all([...todo].map(async (id) => {
          const l = doc.layers.find((x) => x.id === id);
          const obj = l && objectFor(id);
          if (!l || !obj) return;
          const el = await sourceFor(l);
          (obj as FabricImage).setElement(el);
          applyLayer(obj, l, el);
        }));
        canvas.requestRenderAll();
        globalSoon();
      } finally {
        refreshing = false;
        if (refreshIds.size) refreshSoon([]);
      }
    }, 50);
  }

  function updateSelected(patch: Partial<Layer>, rerender = false) {
    const l = selected();
    if (!l) return;
    Object.assign(l, patch);
    const obj = objectFor(l.id);
    if (rerender || !obj) { renderSoon(); return; }
    applyLayer(obj, l, (obj as FabricImage).getElement() as HTMLImageElement);
    canvas.requestRenderAll();
    globalSoon();
  }

  function reorder(delta: number) {
    const i = doc.layers.findIndex((l) => l.id === selectedId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= doc.layers.length) return;
    [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]];
    commit(delta > 0 ? 'Moved forward.' : 'Moved backward.');
    render();
  }

  /** A named composition (opened from a file, or titled when shared) keeps its name; others get a dated one. */
  const baseName = () => {
    if (doc.title !== DEFAULT_TITLE) return safeFilename(doc.title);
    const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
    return `lumassets-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };
  const finalDoc = (): CompositionDoc => {
    const d = withProvenance(doc, assets);
    d.provenance = { ...d.provenance, url: `${location.origin}/compose/` };
    const used = [...new Set(doc.layers.map((l) => l.assetId))].filter((id) => own.has(id));
    return used.length ? { ...d, ownAssets: used.map((id) => own.get(id)!) } : d;
  };

  /** The composition as a PNG at full size, tagged with where it came from and the composition itself. */
  async function compositionPng(maxSide = 0): Promise<Blob> {
    clearTimeout(renderTimer);
    await render();
    const snapshot = structuredClone(finalDoc());
    const { width, height, background } = snapshot.canvas;
    let blob: Blob;
    if (hasEverythingEffects()) {
      // background first, then the layers with the composition's effects, at full size
      say('Applying effects to everything…');
      const fx = await globalImage(1 / zoom);
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const ctx = out.getContext('2d')!;
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, out.width, out.height); }
      if (fx) ctx.drawImage(fx, 0, 0, out.width, out.height);
      blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'));
    } else {
      const url = canvas.toDataURL({ format: 'png', multiplier: 1 / zoom });
      blob = await (await fetch(url)).blob();
    }
    if (maxSide && Math.max(width, height) > maxSide) {
      const k = maxSide / Math.max(width, height);
      const img = await createImageBitmap(blob);
      const small = document.createElement('canvas');
      small.width = Math.round(width * k);
      small.height = Math.round(height * k);
      const ctx = small.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, small.width, small.height);
      blob = await new Promise<Blob>((res, rej) => small.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'));
    }
    // where it came from + the composition itself, so the PNG can be opened here again
    const tagged = withPngText(new Uint8Array(await blob.arrayBuffer()), pngTextFor(snapshot));
    return new Blob([tagged], { type: 'image/png' });
  }

  async function exportPng() {
    if (!doc.layers.length) { say('Add an asset before exporting.'); return; }
    downloadFile(`${baseName()}.png`, await compositionPng(), 'compose-png');
    say('Exported PNG.');
  }

  // ---------- share to the wall (shown after Luma approves it)
  const shareDialog = $<HTMLDialogElement>('share');
  let shareBlob: Blob | null = null;
  let turnstileToken = '';
  let turnstileWidget: string | undefined;
  type Turnstile = { render(el: HTMLElement, o: Record<string, unknown>): string; reset(id?: string): void };
  const turnstile = () => (window as unknown as { turnstile?: Turnstile }).turnstile;
  function loadTurnstile(): Promise<void> {
    if (turnstile()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't load the spam check."));
      document.head.append(s);
    });
  }
  async function openShare() {
    if (!doc.layers.length) { say('Add a drawing before sharing.'); return; }
    const status = $('share-status');
    status.textContent = 'Preparing the image…';
    $<HTMLInputElement>('share-title').value = doc.title === DEFAULT_TITLE ? '' : doc.title;
    $<HTMLButtonElement>('share-send').disabled = true;
    shareDialog.showModal();
    shareBlob = await compositionPng(1600);
    const img = $<HTMLImageElement>('share-preview');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(shareBlob);
    status.textContent = '';
    try {
      await loadTurnstile();
      const box = $('share-turnstile');
      if (turnstileWidget !== undefined) turnstile()!.reset(turnstileWidget);
      else turnstileWidget = turnstile()!.render(box, {
        sitekey: boot.turnstileSiteKey, size: 'flexible', action: 'share', // the wall checks the action
        callback: (t: string) => { turnstileToken = t; syncShare(); },
        'expired-callback': () => { turnstileToken = ''; syncShare(); },
      });
    } catch (e) {
      status.textContent = (e as Error).message;
    }
    syncShare();
  }
  function syncShare() {
    $<HTMLButtonElement>('share-send').disabled = !(shareBlob && turnstileToken && $<HTMLInputElement>('share-ok').checked);
  }
  $('share-ok').addEventListener('change', syncShare);
  $('share-cancel').addEventListener('click', () => shareDialog.close());
  $('share-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!shareBlob) return;
    const status = $('share-status');
    const send = $<HTMLButtonElement>('share-send');
    send.disabled = true;
    status.textContent = 'Sending…';
    const form = new FormData();
    form.append('image', shareBlob, `${baseName()}.png`);
    form.append('title', $<HTMLInputElement>('share-title').value || (doc.title === DEFAULT_TITLE ? '' : doc.title));
    form.append('author', $<HTMLInputElement>('share-author').value);
    form.append('turnstile', turnstileToken);
    try {
      const res = await fetch('/api/wall', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The wall answered ${res.status}.`);
      const shared = $<HTMLInputElement>('share-title').value.trim();
      if (shared) { doc.title = shared.slice(0, 120); commit(); }  // its name from now on (file names too)
      status.textContent = 'Sent! It shows up on the wall once it’s approved.';
      turnstileToken = '';
      say('Shared. It shows up on the wall once it’s approved.');
    } catch (err) {
      status.textContent = (err as Error).message === 'Failed to fetch' ? "Couldn't reach the wall. Try again later." : (err as Error).message;
      turnstileToken = '';
      if (turnstileWidget !== undefined) turnstile()?.reset(turnstileWidget);
      syncShare();
    }
  });

  async function exportSvg() {
    if (!doc.layers.length) { say('Add an asset before exporting.'); return; }
    say('Preparing SVG…');
    const snapshot = structuredClone(finalDoc());
    const filename = baseName();
    const ids = [...new Set(snapshot.layers.map((l) => l.assetId))];
    const embeds = new Map<string, string>();
    const fills = new Map<string, string>();
    try {
      await Promise.all([
        ...ids.map(async (id) => embeds.set(id, await embedUrl(assets.get(id)!))),
        ...snapshot.layers.filter((layer) => layer.fill).map(async (layer) => fills.set(layer.id, (await fillFor(layer))!)),
      ]);
    } catch (e) {
      say((e as Error).message);
      return;
    }
    const svg = toSvg(snapshot, assets, embeds, fills);
    downloadFile(`${filename}.svg`, new Blob([svg], { type: 'image/svg+xml' }), 'compose-svg');
    const raster = ids.some((id) => !assets.get(id)!.vector);
    say(raster ? 'Exported SVG. The drawings inside stay scanned images, not vector paths.' : 'Exported SVG.');
  }

  const docJson = () => JSON.stringify(finalDoc(), null, 2);

  async function openDoc(text: string) {
    const result = parseDoc(text, assets);
    if (!result.doc) { say(result.errors.join(' ')); return; }
    try {
      for (const o of result.own) await registerOwn(o);
    } catch (e) {
      say((e as Error).message);
      return;
    }
    doc = result.doc;
    selectedId = null;
    const inks = new Set(doc.layers.map((l) => l.color));
    inkForAll = inks.size === 1 ? [...inks][0] : null;
    commit(result.warnings.length ? result.warnings.join(' ') : doc.title === DEFAULT_TITLE ? 'Opened the composition.' : `Opened “${doc.title}”.`);
    await render();
  }

  /** Opens a .json composition, or a PNG / SVG exported from here (they carry the composition). */
  async function openFile(file: File) {
    // by content, not by name: a PNG starts with \x89PNG, an SVG has an <svg> tag
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const json = readPngText(bytes)[PNG_KEYS.composition];
      if (!json) { say("This PNG wasn't exported from the lumassets composer, so there's no composition inside to open."); return; }
      return openDoc(json);
    }
    const text = new TextDecoder().decode(bytes);
    if (/^\s*(<\?xml[^>]*>\s*)?<svg\b/.test(text)) {
      const json = compositionFromSvg(text);
      if (!json) { say("This SVG wasn't exported from the lumassets composer, so there's no composition inside to open."); return; }
      return openDoc(json);
    }
    return openDoc(text);
  }

  const commands: Record<string, () => void | Promise<void>> = {
    undo: () => travel(-1),
    redo: () => travel(1),
    'ink-all-reset': () => {
      if (!doc.layers.some((l) => l.color)) return;
      inkForAll = null;
      for (const l of doc.layers) l.color = null;
      commit('Every layer back to its original ink.');
      render();
    },
    share: () => openShare(),
    'reset-layer': () => {
      const l = selected();
      if (!l) return;
      const fresh = layerFor(assets.get(l.assetId)!, doc);
      Object.assign(l, { scale: fresh.scale, rotation: 0, flipX: false, flipY: false, opacity: 1, blendMode: 'normal', color: null, fill: null, background: null, excludeFromEverything: false, effects: [] });
      commit('Layer reset: effects, colour, size and rotation. Undo brings them back.');
      render();
    },
    // ---------- generators: copies of the selected layer, all in one undo step ----------
    scatter: () => {
      const l = selected();
      if (!l) return;
      const n = Number($<HTMLInputElement>('scatter-count').value);
      const vary = Number($<HTMLInputElement>('scatter-vary').value);
      const fresh = $<HTMLInputElement>('scatter-fx').checked;
      const { width: W, height: H } = doc.canvas;
      const rand = (a: number, b: number) => a + Math.random() * (b - a);
      const copies: Layer[] = [];
      for (let k = 0; k < n; k++) {
        const c: Layer = { ...structuredClone(l), id: layerId() };
        c.x = rand(W * 0.05, W * 0.95);
        c.y = rand(H * 0.05, H * 0.95);
        c.scale = round(l.scale * rand(1 - 0.8 * vary, 1 + 0.6 * vary), 4);
        c.rotation = round(rand(-180, 180) * vary, 2);
        c.flipX = vary > 0.3 && Math.random() < 0.5 ? !l.flipX : l.flipX;
        if (fresh) c.effects = (c.effects ?? []).map((e) => randomEffect(e.type));
        copies.push(c);
      }
      doc.layers.splice(doc.layers.indexOf(l) + 1, 0, ...copies);
      commit(`Scattered ${n} copies. Undo removes them all.`);
      render();
    },
    'mirror-x': () => mirror('x'),
    'mirror-y': () => mirror('y'),
    kaleidoscope: () => {
      const l = selected();
      if (!l) return;
      const n = Number($<HTMLInputElement>('kaleido-count').value);
      const cx = doc.canvas.width / 2, cy = doc.canvas.height / 2;
      const copies: Layer[] = [];
      for (let k = 1; k < n; k++) {
        const a = (k * 2 * Math.PI) / n;
        const dx = l.x - cx, dy = l.y - cy;
        const c: Layer = { ...structuredClone(l), id: layerId() };
        c.x = round(cx + dx * Math.cos(a) - dy * Math.sin(a));
        c.y = round(cy + dx * Math.sin(a) + dy * Math.cos(a));
        c.rotation = round(((((l.rotation + (k * 360) / n) + 180) % 360) + 360) % 360 - 180, 2);
        copies.push(c);
      }
      doc.layers.splice(doc.layers.indexOf(l) + 1, 0, ...copies);
      commit(`Kaleidoscope: ${n} around the centre. Move the original first to change the radius.`);
      render();
    },
    'global-surprise': () => {
      doc.effects = surprise();
      commit(`Surprise on everything: ${doc.effects.map((e) => EFFECTS[e.type].label).join(' + ')}. Press again for another.`);
      syncPanels();
      globalSoon();
    },
    surprise: () => {
      const l = selected();
      if (!l) return;
      l.effects = surprise();
      commit(`Surprise: ${l.effects.map((e) => EFFECTS[e.type].label).join(' + ')}. Press again for another.`);
      render();
    },
    reset: () => {
      if (doc.layers.length && !confirmReset()) return;
      const title = doc.title;
      doc = newDoc(boot.release);
      doc.title = title;
      selectedId = null;
      commit('Composition reset. Undo brings it back.');
      render();
    },
    'export-png': exportPng,
    'export-svg': exportSvg,
    save: () => {
      downloadFile(`${baseName()}.lumassets.json`, new Blob([docJson()], { type: 'application/json' }), 'compose-json');
      say('Saved the composition file. Open it here any time to keep working.');
    },
    'flip-x': () => { const l = selected(); if (l) { updateSelected({ flipX: !l.flipX }); commit(); } },
    'flip-y': () => { const l = selected(); if (l) { updateSelected({ flipY: !l.flipY }); commit(); } },
    forward: () => reorder(1),
    backward: () => reorder(-1),
    duplicate: () => {
      const l = selected();
      if (!l) return;
      const copy: Layer = { ...structuredClone(l), id: layerId(), x: l.x + 30, y: l.y + 30 };
      doc.layers.splice(doc.layers.indexOf(l) + 1, 0, copy);
      selectedId = copy.id;
      commit('Duplicated.');
      render();
    },
    delete: () => {
      const l = selected();
      if (!l) return;
      doc.layers = doc.layers.filter((x) => x !== l);
      selectedId = null;
      commit('Deleted. Undo brings it back.');
      render();
    },
  };

  /** A mirrored copy across the canvas centre line. */
  function mirror(axis: 'x' | 'y') {
    const l = selected();
    if (!l) return;
    const c: Layer = { ...structuredClone(l), id: layerId() };
    if (axis === 'x') { c.x = round(doc.canvas.width - l.x); c.flipX = !l.flipX; }
    else { c.y = round(doc.canvas.height - l.y); c.flipY = !l.flipY; }
    c.rotation = round(-l.rotation, 2);
    doc.layers.splice(doc.layers.indexOf(l) + 1, 0, c);
    commit(axis === 'x' ? 'Mirrored left to right.' : 'Mirrored top to bottom.');
    render();
  }

  // A native confirm is the simplest accessible option here.
  const confirmReset = () => window.confirm('Clear the canvas? You can undo this.');

  // ---------- tabs: Layer / Everything / Layers ----------
  const tabs = ['layer', 'all'] as const;
  function showTab(name: (typeof tabs)[number], focus = false) {
    for (const t of tabs) {
      const tab = $(`tab-${t}`);
      tab.setAttribute('aria-selected', String(t === name));
      tab.tabIndex = t === name ? 0 : -1;
      $(`pane-${t}`).hidden = t !== name;
    }
    if (focus) $(`tab-${name}`).focus();
  }
  tabs.forEach((t, i) => {
    const tab = $(`tab-${t}`);
    tab.addEventListener('click', () => showTab(t));
    tab.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); showTab(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });

  // ---------- wiring ----------
  const groups = [...new Set(EFFECT_TYPES.map((t) => EFFECTS[t].group))];
  function effectPicker(id: string, target: () => Effect[] | null, after: () => void) {
    const grid = $(id);
    const details = grid.closest('details')!;
    for (const g of groups) {
      const h = document.createElement('h4');
      h.textContent = g;
      const opts = document.createElement('div');
      opts.className = 'opts';
      for (const t of EFFECT_TYPES.filter((t) => EFFECTS[t].group === g)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.role = 'menuitem';
        b.textContent = EFFECTS[t].label;
        b.title = EFFECTS[t].hint;
        b.addEventListener('click', () => {
          const list = target();
          if (!list) return;
          const fx = defaultEffect(t);
          for (const other of list) openFx.delete(other); // keep only the new one open
          openFx.add(fx);
          list.push(fx);
          details.open = false;
          commit(`Added ${EFFECTS[t].label}. ${EFFECTS[t].hint}`);
          after();
        });
        opts.append(b);
      }
      grid.append(h, opts);
    }
    // close when clicking elsewhere or pressing Escape
    document.addEventListener('pointerdown', (e) => { if (details.open && !details.contains(e.target as Node)) details.open = false; });
    details.addEventListener('keydown', (e) => { if (e.key === 'Escape') { details.open = false; details.querySelector('summary')!.focus(); } });
  }
  effectPicker('fx-add', () => { const l = selected(); return l ? (l.effects ??= []) : null; }, () => render());
  effectPicker('gfx-add', () => (doc.effects ??= []), () => { syncPanels(); globalSoon(); });

  document.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) =>
    b.addEventListener('click', () => {
      b.closest<HTMLDetailsElement>('details.menu')?.removeAttribute('open');
      commands[b.dataset.cmd!]?.();
    }),
  );
  // the "More" menu closes on Esc and on a click anywhere else
  const more = $<HTMLDetailsElement>('more');
  document.addEventListener('click', (e) => { if (more.open && !more.contains(e.target as Node)) more.open = false; });
  more.addEventListener('keydown', (e) => { if (e.key === 'Escape' && more.open) { more.open = false; more.querySelector('summary')!.focus(); } });
  $('open').addEventListener('change', () => (more.open = false));

  canvas.on('object:modified', (e) => {
    const obj = e.target as LayerObject | undefined;
    const l = obj?.layerId && doc.layers.find((x) => x.id === obj.layerId);
    if (!obj || !l) return;
    readLayer(obj, l);
    commit();
    globalSoon();
  });
  // rotating: Shift snaps to 15°, and the Rotation slider follows live
  canvas.on('object:rotating', (e) => {
    const obj = e.target as LayerObject;
    obj.snapAngle = e.e.shiftKey ? 15 : undefined;
    ui.rotation.value = String(Math.round(normalizeAngle(obj.angle ?? 0)));
  });
  // while a layer moves, the others keep the composition's effects (drag view above)
  const onTransform = (e: { target: FabricObject }) => {
    if (!hasEverythingEffects() || dragView || dragStarting) return;
    dragging = true;
    startDragView(e.target);
  };
  canvas.on('object:moving', onTransform);
  canvas.on('object:scaling', onTransform);
  canvas.on('object:rotating', onTransform);
  canvas.on('mouse:up', () => {
    const wasDragging = dragging;
    dragging = false;
    if (doc.effects?.length && (wasDragging || dragView)) globalSoon();
  });
  canvas.on('selection:created', (e) => { if (rebuilding) return; selectedId = (e.selected?.[0] as LayerObject)?.layerId ?? null; showTab('layer'); syncPanels(); });
  canvas.on('selection:updated', (e) => { if (rebuilding) return; selectedId = (e.selected?.[0] as LayerObject)?.layerId ?? null; syncPanels(); });
  canvas.on('selection:cleared', () => { if (rebuilding) return; selectedId = null; syncPanels(); });

  // Live preview on input, one history entry on change.
  const live = (el: HTMLInputElement | HTMLSelectElement, patch: () => Partial<Layer>, rerender = false) => {
    el.addEventListener('input', () => updateSelected(patch(), rerender));
    el.addEventListener('change', () => { updateSelected(patch(), rerender); commit(); });
  };
  live(ui.opacity, () => ({ opacity: Number(ui.opacity.value) }));
  live(ui.scale, () => ({ scale: Number(ui.scale.value) }));
  live(ui.rotation, () => ({ rotation: Number(ui.rotation.value) }));
  live(ui.blend, () => ({ blendMode: ui.blend.value as BlendMode }));
  for (const { key, checkbox, picker } of layerColors) {
    // A native color picker can finish after the inspector has changed layers.
    let editingLayer: Layer | null = null;
    const beginPick = () => { editingLayer = selected(); };
    picker.addEventListener('pointerdown', beginPick);
    picker.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') beginPick();
    });
    checkbox.addEventListener('change', () => {
      updateSelected({ [key]: checkbox.checked ? picker.value : null }, true);
      commit();
    });
    picker.addEventListener('input', () => {
      const current = selected();
      const layer = editingLayer ?? current;
      if (!layer || !doc.layers.includes(layer)) { syncPanels(); return; }
      editingLayer = layer;
      layer[key] = picker.value;
      if (layer === current) checkbox.checked = true;
      else syncPanels();
      refreshSoon([layer.id]);
    });
    picker.addEventListener('change', () => {
      const current = selected();
      const layer = editingLayer ?? current;
      editingLayer = null;
      if (!layer || !doc.layers.includes(layer)) { syncPanels(); return; }
      if (layer === current) {
        updateSelected({ [key]: picker.value }, true);
      }
      // If selection moved, the last input already updated the original layer.
      commit();
    });
  }

  const setCanvasSize = () => {
    const clamp = (v: number) => Math.min(CANVAS_LIMITS.max, Math.max(CANVAS_LIMITS.min, Math.round(v) || CANVAS_LIMITS.min));
    doc.canvas.width = clamp(Number(ui.cw.value));
    doc.canvas.height = clamp(Number(ui.ch.value));
    commit(`Canvas is ${doc.canvas.width}×${doc.canvas.height}.`);
    fitStage();
    globalSoon();
  };
  ui.cw.addEventListener('change', setCanvasSize);
  ui.ch.addEventListener('change', setCanvasSize);
  // Ink for all: every layer in one colour, live while picking, one undo step
  const inkAll = $<HTMLInputElement>('ink-all');
  inkAll.addEventListener('input', () => {
    if (!doc.layers.length) return;
    for (const l of doc.layers) l.color = inkAll.value;
    refreshSoon(doc.layers.map((l) => l.id));
  });
  inkAll.addEventListener('change', () => {
    inkForAll = inkAll.value;
    if (!doc.layers.length) { say(`New drawings will be ${inkAll.value}.`); return; }
    for (const l of doc.layers) l.color = inkAll.value;
    commit(doc.layers.length === 1 ? `Ink: ${inkAll.value}.` : `All ${doc.layers.length} layers in ${inkAll.value}.`);
    refreshSoon(doc.layers.map((l) => l.id));
  });

  function setBackground(color: string | null) {
    doc.canvas.background = color;
    overlay.style.background = color ?? 'transparent';
    canvas.backgroundColor = dragView ? '' : color ?? '';
    canvas.requestRenderAll();
  }

  // Keep the composition current while the picker is open. Other actions may repaint
  // the canvas before the final change event adds the color to undo history.
  ui.bg.addEventListener('input', () => setBackground(ui.bg.value));
  ui.bg.addEventListener('change', () => { setBackground(ui.bg.value); commit(); });
  ui.transparent.addEventListener('change', () => {
    setBackground(ui.transparent.checked ? null : ui.bg.value);
    commit();
    globalSoon();
  });

  ui.open.addEventListener('change', async () => {
    const file = ui.open.files?.[0];
    if (file) await openFile(file);
    ui.open.value = '';
  });

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea, [contenteditable]')) return;
    if (document.querySelector('dialog[open]')) return; // e.g. Backspace in the share dialog must not delete a layer behind it
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); travel(e.shiftKey ? 1 : -1); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); travel(1); return; }
    const l = selected();
    if (!l) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); commands.delete(); return; }
    // [ and ] rotate by 15° (Shift: by 1°)
    if (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}') {
      e.preventDefault();
      const by = (e.shiftKey ? 1 : 15) * (e.key === '[' || e.key === '{' ? -1 : 1);
      updateSelected({ rotation: round(normalizeAngle(l.rotation + by), 2) });
      commit();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (move[e.key]) {
      e.preventDefault();
      updateSelected({ x: l.x + move[e.key][0], y: l.y + move[e.key][1] });
      commit();
    }
  });

  window.addEventListener('resize', fitStage);
  window.addEventListener('beforeunload', (e) => {
    if (doc.layers.length) e.preventDefault();
  });

  // ---------- your own drawings ----------
  const ownPicker = $('own-picker');
  function pickerItem(a: EditorAsset) {
    const li = document.createElement('li');
    li.dataset.search = a.searchText;
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `Add ${a.name}`;
    const img = document.createElement('img');
    img.src = a.display;
    img.className = a.own ? '' : 'art';
    img.alt = `Add ${a.name}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    b.append(img);
    b.addEventListener('click', () => addAsset(a.id));
    li.append(b);
    return li;
  }
  async function registerOwn(o: OwnAsset) {
    if (assets.has(o.id)) return assets.get(o.id)!;
    const a = ownToEditorAsset(o, await rasterFor(o));
    assets.set(o.id, a);
    own.set(o.id, o);
    ownPicker.append(pickerItem(a));
    ownPicker.hidden = false;
    return a;
  }
  async function addOwnFiles(files: Iterable<File>) {
    const list = [...files];
    if (!list.length) return;
    const notes: string[] = [];
    let added = 0;
    for (const f of list) {
      say(`Reading ${f.name}…`);
      try {
        const imported = await importFile(f);
        if (!imported) continue;
        const { own: o, note } = imported;
        const known = assets.has(o.id);
        await registerOwn(o);
        await addAsset(o.id);
        added++;
        notes.push(known ? `${o.name} was already added; placed another copy.` : `${o.name}: ${note}`);
      } catch (e) {
        notes.push((e as Error).message);
      }
    }
    say(notes.join(' ') || 'No images added.');
    if (added) showTab('layer');
  }
  let ownImportQueue = Promise.resolve();
  function queueOwnFiles(files: Iterable<File>) {
    const pending = [...files];
    ownImportQueue = ownImportQueue.then(() => addOwnFiles(pending));
  }
  const ownInput = $<HTMLInputElement>('own-file');
  ownInput.addEventListener('change', () => { queueOwnFiles(ownInput.files ?? []); ownInput.value = ''; });
  // drop files anywhere on the editor
  const editorEl = ui.stage.closest('.editor') as HTMLElement;
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  editorEl.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); editorEl.classList.add('dropping'); });
  editorEl.addEventListener('dragleave', (e) => { if (e.target === editorEl || !editorEl.contains(e.relatedTarget as Node)) editorEl.classList.remove('dropping'); });
  editorEl.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    editorEl.classList.remove('dropping');
    queueOwnFiles(e.dataTransfer!.files);
  });

  // Library picker
  ui.picker.replaceChildren(...boot.assets.map(pickerItem));
  ui.search.addEventListener('input', () => {
    const terms = ui.search.value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const list of [ui.picker, ownPicker])
      for (const li of list.children as HTMLCollectionOf<HTMLLIElement>)
        li.hidden = !terms.every((t) => li.dataset.search!.includes(t));
  });

  // Start
  commit();
  const params = new URLSearchParams(location.search);
  const toAdd = params.get('add');
  const fromWall = params.get('wall');
  if (fromWall && /^[a-z0-9]{12}$/.test(fromWall)) {
    // remix something from the wall: its PNG carries the whole composition
    history.replaceState(null, '', location.pathname);
    say('Opening it from the wall…');
    fetch(`/api/wall/${fromWall}.png`)
      .then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); })
      .then((b) => openFile(new File([b], 'wall.png', { type: 'image/png' })))
      .catch(() => { render(); say("Couldn't open that one from the wall."); });
  } else if (toAdd) {
    history.replaceState(null, '', location.pathname);
    addAsset(toAdd);
  } else {
    render();
    say('Pick a drawing from the library, or drop your own files here.');
  }
}
