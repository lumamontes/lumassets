// Turns a visitor's own file into a drawing Compose can use. Runs only in their browser:
// nothing is uploaded. SVGs stay vectors and raster imports have a treatment preview.
import { OWN_MAX_CHARS, svgDataUrl, type OwnAsset } from '../lib/composition';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 2400; // longest side kept for raster drawings
const PREVIEW_SIDE = 1400; // canvas preview for SVGs

export interface Imported {
  own: OwnAsset;
  note: string;
}

const nameOf = (file: File) =>
  file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 60) || 'My drawing';

async function hashId(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `own-${[...new Uint8Array(digest).slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This image couldn't be read."));
    img.src = src;
  });
}

const readAs = (file: File, kind: 'text' | 'url') =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    kind === 'text' ? r.readAsText(file) : r.readAsDataURL(file);
  });

export async function importFile(file: File): Promise<Imported | null> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over 15 MB.`);
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (isSvg) return importSvg(file);
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error(`${file.name} isn't an SVG, PNG, JPG or WebP.`);
  return importRaster(file);
}

// ---------- SVG: keep it a vector ----------
async function importSvg(file: File): Promise<Imported> {
  const text = await readAs(file, 'text');
  const dom = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = dom.documentElement;
  if (svg.nodeName !== 'svg' || dom.querySelector('parsererror')) throw new Error(`${file.name} isn't a valid SVG.`);
  // Images never run scripts, but keep the stored file clean anyway.
  dom.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
  for (const el of dom.querySelectorAll('*'))
    for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);

  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const num = (v: string | null) => (v && !v.endsWith('%') ? parseFloat(v) : NaN);
  let w = vb.length === 4 ? vb[2] : num(svg.getAttribute('width'));
  let h = vb.length === 4 ? vb[3] : num(svg.getAttribute('height'));
  if (!(w > 0 && h > 0)) throw new Error(`${file.name} has no size (no viewBox or width/height).`);
  if (vb.length !== 4) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  // A concrete size so browsers rasterise it predictably.
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  const data = svgDataUrl(new XMLSerializer().serializeToString(dom));
  if (data.length > OWN_MAX_CHARS) throw new Error(`${file.name} is too large.`);
  return { own: { id: await hashId(data), name: nameOf(file), width: w, height: h, vector: true, data }, note: 'Added as a vector.' };
}

/** PNG preview of an SVG drawing for the canvas (sharp at any zoom the editor uses). */
export async function rasterFor(own: OwnAsset): Promise<string> {
  if (!own.vector) return own.data;
  const img = await loadImg(own.data);
  const k = PREVIEW_SIDE / Math.max(own.width, own.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(own.width * k));
  c.height = Math.max(1, Math.round(own.height * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

// ---------- raster: preview the selected treatment before adding it ----------
async function importRaster(file: File): Promise<Imported | null> {
  const original = await readAs(file, 'url');
  const img = await loadImg(original);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const dialog = document.querySelector<HTMLDialogElement>('#photo-import')!;
  const preview = dialog.querySelector<HTMLCanvasElement>('#photo-preview')!;
  const mode = dialog.querySelector<HTMLSelectElement>('#photo-mode')!;
  const tolerance = dialog.querySelector<HTMLInputElement>('#photo-tolerance')!;
  const background = dialog.querySelector<HTMLElement>('#photo-background')!;
  const status = dialog.querySelector<HTMLElement>('#photo-status')!;
  const add = dialog.querySelector<HTMLButtonElement>('#photo-add')!;

  dialog.querySelector('#photo-name')!.textContent = file.name;
  preview.width = width;
  preview.height = height;
  preview.style.setProperty('--photo-width', `${width}px`);
  preview.style.setProperty('--photo-ratio', String(width / height));
  const ctx = preview.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, width, height);
  const source = ctx.getImageData(0, 0, width, height);
  const transparent = hasTransparency(source.data);
  mode.value = 'original';
  tolerance.value = '32';
  dialog.returnValue = '';
  let sample = 0;
  let box = { x: 0, y: 0, w: width, h: height };

  function render() {
    dialog.dataset.mode = mode.value;
    background.hidden = mode.value !== 'background';
    const px = new ImageData(new Uint8ClampedArray(source.data), width, height);
    if (mode.value === 'paper' && !transparent) removePaper(px.data, width, height);
    if (mode.value === 'background') clearConnectedColor(px, sample, tolerance.valueAsNumber);

    const bounds = mode.value === 'original' ? { x: 0, y: 0, w: width, h: height } : inkBox(px, width, height);
    add.disabled = !bounds;
    status.textContent = bounds ? '' : 'This treatment removed the whole image. Try a lower tolerance or keep the original.';
    if (bounds) box = bounds;
    ctx.putImageData(px, 0, 0);
  }

  const events = new AbortController();
  const options = { signal: events.signal };
  mode.addEventListener('change', render, options);
  tolerance.addEventListener('input', render, options);
  preview.addEventListener('click', (event) => {
    if (mode.value !== 'background') return;
    const rect = preview.getBoundingClientRect();
    const x = Math.max(0, Math.min(width - 1, Math.floor((event.clientX - rect.left) * width / rect.width)));
    const y = Math.max(0, Math.min(height - 1, Math.floor((event.clientY - rect.top) * height / rect.height)));
    sample = y * width + x;
    render();
  }, options);

  render();
  const accepted = await new Promise<boolean>((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'add' && !add.disabled), { once: true });
    dialog.showModal();
  });
  events.abort();
  if (!accepted) return null;

  const out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  out.getContext('2d')!.drawImage(preview, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const keep = mode.value === 'original';
  const data = keep && scale === 1 && /^data:image\/(png|jpeg|webp);base64,/.test(original)
    ? original
    : out.toDataURL(keep && file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.94);
  if (data.length > OWN_MAX_CHARS) throw new Error(`${file.name} is too large.`);
  const notes: Record<string, string> = {
    original: 'Added with the original background.',
    paper: transparent ? 'Added with its existing transparency.' : 'Added with the paper removed.',
    background: 'Added with the selected backdrop cleared.',
  };
  return {
    own: { id: await hashId(data), name: nameOf(file), width: box.w, height: box.h, vector: false, data },
    note: notes[mode.value],
  };
}

/** Clear the connected region that matches the sampled color, leaving other regions intact. */
function clearConnectedColor({ data, width, height }: ImageData, seed: number, tolerance: number) {
  const offset = seed * 4;
  const [r, g, b, alpha] = data.subarray(offset, offset + 4);
  const visited = new Uint8Array(width * height);
  const queue = new Uint32Array(visited.length);
  let end = 0;

  function enqueue(pixel: number) {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    const i = pixel * 4;
    if (Math.abs(data[i + 3] - alpha) > tolerance) return;
    if (Math.max(Math.abs(data[i] - r), Math.abs(data[i + 1] - g), Math.abs(data[i + 2] - b)) > tolerance) return;
    queue[end++] = pixel;
  }

  enqueue(seed);
  for (let head = 0; head < end; head++) {
    const pixel = queue[head];
    const x = pixel % width;
    data[pixel * 4 + 3] = 0;
    if (x > 0) enqueue(pixel - 1);
    if (x < width - 1) enqueue(pixel + 1);
    if (pixel >= width) enqueue(pixel - width);
    if (pixel < queue.length - width) enqueue(pixel + width);
  }
}

/** True when a meaningful share of pixels is already see-through (a cut-out PNG). */
function hasTransparency(d: Uint8ClampedArray) {
  let clear = 0;
  const step = 4 * 7;
  for (let i = 3; i < d.length; i += step) if (d[i] < 250) clear++;
  return clear / (d.length / step) > 0.01;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Estimates the page's lighting: the paper colour at every point, ignoring the ink. Same idea as
 * quick-editor's flattening (a morphological close, then a blur), on a small grid so it's instant:
 * brightest pixel per cell → max filter (removes ink) → box blur (smooth light).
 */
function paperLight(d: Uint8ClampedArray, w: number, h: number) {
  const cell = Math.max(2, Math.round(Math.max(w, h) / 160));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  let g = new Float32Array(gw * gh * 3);
  const gl = new Float32Array(gw * gh).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, k = Math.floor(y / cell) * gw + Math.floor(x / cell);
      const l = lum(d[i], d[i + 1], d[i + 2]);
      if (l > gl[k]) { gl[k] = l; g[k * 3] = d[i]; g[k * 3 + 1] = d[i + 1]; g[k * 3 + 2] = d[i + 2]; }
    }
  const pass = (src: Float32Array, r: number, op: 'max' | 'mean') => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        let best = -1, sr = 0, sg = 0, sb = 0, n = 0, bi = 0;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const yy = y + dy, xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
            const k = (yy * gw + xx) * 3;
            if (op === 'max') { const l = lum(src[k], src[k + 1], src[k + 2]); if (l > best) { best = l; bi = k; } }
            else { sr += src[k]; sg += src[k + 1]; sb += src[k + 2]; n++; }
          }
        const o = (y * gw + x) * 3;
        if (op === 'max') { out[o] = src[bi]; out[o + 1] = src[bi + 1]; out[o + 2] = src[bi + 2]; }
        else { out[o] = sr / n; out[o + 1] = sg / n; out[o + 2] = sb / n; }
      }
    return out;
  };
  g = pass(g, 2, 'max');
  g = pass(pass(g, 3, 'mean'), 3, 'mean');
  /** Paper colour at a full-size pixel (bilinear). */
  return (x: number, y: number, out: number[]) => {
    const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5)), fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    for (let c = 0; c < 3; c++) {
      const a = g[(y0 * gw + x0) * 3 + c] * (1 - tx) + g[(y0 * gw + x1) * 3 + c] * tx;
      const b = g[(y1 * gw + x0) * 3 + c] * (1 - tx) + g[(y1 * gw + x1) * 3 + c] * tx;
      out[c] = Math.max(1, a * (1 - ty) + b * ty);
    }
  };
}

/**
 * Paper → transparent, ink → opaque, keeping the ink's own colour. First the lighting is divided
 * out (shadows and tinted paper become white), then everything close to white is dropped and
 * the rest becomes ink, with its colour un-mixed from the white so coloured ink stays coloured.
 */
function removePaper(d: Uint8ClampedArray, w: number, h: number) {
  const light = paperLight(d, w, h);
  const bg = [0, 0, 0];
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      light(x, y, bg);
      for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, (d[i + c] / bg[c]) * 255);
      hist[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++;
    }
  // darkest 0.5% is "full ink"; paper texture lives just under white
  let acc = 0, ink = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= (d.length / 4) * 0.005) { ink = v; break; } }
  const hi = 215;
  ink = Math.min(ink, hi - 70);
  for (let i = 0; i < d.length; i += 4) {
    const t = (hi - lum(d[i], d[i + 1], d[i + 2])) / (hi - ink);
    if (t <= 0.06) { d[i + 3] = 0; continue; }
    const a = Math.min(1, t) ** 0.8;
    for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, (d[i + c] - 255 * (1 - a)) / a));
    d[i + 3] = Math.round(a * 255);
  }
}

/** Bounding box of the visible ink, with a small margin. */
function inkBox(px: ImageData, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px.data[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02) + 2;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
  x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
