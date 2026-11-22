// Layer effects for Compose, built from standard SVG filter primitives
// (feTurbulence, feDisplacementMap, feMorphology, feGaussianBlur, feOffset, feImage…).
// The same filter markup drives the editor preview and the SVG export, so effects
// survive export as live SVG filters. Pure functions: no DOM, testable with Node.

export type ParamKind = 'range' | 'color' | 'int';

export interface ParamDef {
  key: string;
  label: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  step?: number;
  default: number | string;
}

export interface Effect {
  /** effect type, a key of EFFECTS */
  type: string;
  /** param values; `seed` is used by effects with randomness */
  params: Record<string, number | string>;
  /** switched off (kept in the stack, not applied) */
  off?: boolean;
}

export interface EffectDef {
  label: string;
  group: 'Distort' | 'Glitch' | 'Texture' | 'Focus' | 'Color' | 'Repeat';
  hint: string;
  params: ParamDef[];
  /** extra room the effect needs around the drawing, in units of S (the drawing's long side) */
  pad: (p: Record<string, number | string>) => number;
  /** SVG filter primitives reading from `input`, ending in `result` */
  build: (p: Record<string, any>, ctx: BuildCtx) => string;
}

interface BuildCtx {
  input: string;
  result: string;
  /** long side of the drawing, in user units */
  S: number;
  /** unique prefix for intermediate result names */
  id: string;
  /** filter region (user units), for feImage */
  region: { x: number; y: number; w: number; h: number };
}

const r = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const rad = (deg: number) => (deg * Math.PI) / 180;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const seedParam: ParamDef = { key: 'seed', label: 'Seed', kind: 'int', min: 1, max: 9999, step: 1, default: 7 };

/** A tiny SVG as a data URL, for feImage fills (gradients, dot screens). */
const svgUrl = (body: string, w: number, h: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}" height="${r(h)}" viewBox="0 0 ${r(w)} ${r(h)}">${body}</svg>`)}`;

/** Mulberry32: deterministic random numbers from a seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EFFECTS: Record<string, EffectDef> = {
  warp: {
    label: 'Warp',
    group: 'Distort',
    hint: 'Bends the lines like heat haze or water.',
    params: [
      { key: 'amount', label: 'Amount', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.35 },
      { key: 'size', label: 'Wave size', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'detail', label: 'Detail', kind: 'int', min: 1, max: 5, step: 1, default: 2 },
      seedParam,
    ],
    pad: (p) => +p.amount * 0.08,
    build: (p, c) =>
      `<feTurbulence type="fractalNoise" baseFrequency="${r(1 / (c.S * (0.02 + p.size * 0.35)), 6)}" numOctaves="${p.detail}" seed="${p.seed}" result="${c.id}n"/>` +
      `<feDisplacementMap in="${c.input}" in2="${c.id}n" scale="${r(p.amount * c.S * 0.16)}" xChannelSelector="R" yChannelSelector="G" result="${c.result}"/>`,
  },

  melt: {
    label: 'Melt',
    group: 'Distort',
    hint: 'Drips the drawing downwards, column by column.',
    params: [
      { key: 'amount', label: 'Drip', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'width', label: 'Drip width', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
      seedParam,
    ],
    pad: (p) => +p.amount * 0.12,
    // noise that only varies along x, used as a vertical offset
    build: (p, c) =>
      `<feTurbulence type="fractalNoise" baseFrequency="${r(1 / (c.S * (0.005 + p.width * 0.15)), 6)} 0" numOctaves="2" seed="${p.seed}" result="${c.id}n"/>` +
      `<feColorMatrix in="${c.id}n" type="matrix" values="0 0 0 0 0.5  1 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="${c.id}m"/>` +
      `<feDisplacementMap in="${c.input}" in2="${c.id}m" scale="${r(p.amount * c.S * 0.24)}" xChannelSelector="R" yChannelSelector="G" result="${c.result}"/>`,
  },

  glitch: {
    label: 'Slice',
    group: 'Glitch',
    hint: 'Cuts the drawing into horizontal slices and shifts them sideways.',
    params: [
      { key: 'amount', label: 'Shift', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: 'slices', label: 'Slices', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      seedParam,
    ],
    pad: (p) => +p.amount * 0.1,
    build: (p, c) => {
      const rand = rng(+p.seed);
      const steps = Array.from({ length: 9 }, () => r(rand())).join(' ');
      return (
        `<feTurbulence type="fractalNoise" baseFrequency="0 ${r((4 + p.slices * 40) / c.S, 6)}" numOctaves="1" seed="${p.seed}" result="${c.id}n"/>` +
        `<feComponentTransfer in="${c.id}n" result="${c.id}d"><feFuncR type="discrete" tableValues="${steps}"/><feFuncG type="linear" slope="0" intercept="0.5"/></feComponentTransfer>` +
        `<feDisplacementMap in="${c.input}" in2="${c.id}d" scale="${r(p.amount * c.S * 0.2)}" xChannelSelector="R" yChannelSelector="G" result="${c.result}"/>`
      );
    },
  },

  rgbsplit: {
    label: 'RGB split',
    group: 'Glitch',
    hint: 'Red and cyan ghosts pulled apart, like a broken screen or 3D glasses.',
    params: [
      { key: 'distance', label: 'Split', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.35 },
      { key: 'angle', label: 'Direction', kind: 'range', min: 0, max: 360, step: 1, default: 0 },
    ],
    pad: (p) => +p.distance * 0.04,
    build: (p, c) => {
      const d = p.distance * c.S * 0.025;
      const dx = r(Math.cos(rad(p.angle)) * d), dy = r(Math.sin(rad(p.angle)) * d);
      return (
        `<feOffset in="${c.input}" dx="${dx}" dy="${dy}" result="${c.id}a"/>` +
        `<feFlood flood-color="#ff1a3c" result="${c.id}ra"/><feComposite in="${c.id}ra" in2="${c.id}a" operator="in" result="${c.id}red"/>` +
        `<feOffset in="${c.input}" dx="${-dx}" dy="${-dy}" result="${c.id}b"/>` +
        `<feFlood flood-color="#00e1ff" result="${c.id}cb"/><feComposite in="${c.id}cb" in2="${c.id}b" operator="in" result="${c.id}cyan"/>` +
        `<feBlend in="${c.id}red" in2="${c.id}cyan" mode="multiply" result="${c.id}rc"/>` +
        `<feMerge result="${c.id}m"><feMergeNode in="${c.id}red"/><feMergeNode in="${c.id}cyan"/><feMergeNode in="${c.id}rc"/></feMerge>` +
        `<feBlend in="${c.input}" in2="${c.id}m" mode="multiply" result="${c.result}"/>`
      );
    },
  },

  pixelate: {
    label: 'Pixelate',
    group: 'Glitch',
    hint: 'Chunky square pixels, like a low-res screenshot.',
    params: [{ key: 'size', label: 'Pixel size', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.25 }],
    pad: (p) => +p.size * 0.02,
    // the classic SVG pixelate: sample one point per cell (tiled flood), then grow each sample to fill its cell
    build: (p, c) => {
      const cell = Math.max(2, Math.round(c.S * (0.004 + p.size * 0.03)));
      const { x, y } = c.region;
      return (
        `<feFlood x="${r(x + cell / 2)}" y="${r(y + cell / 2)}" width="1" height="1" flood-color="#000" result="${c.id}dot"/>` +
        `<feComposite in="${c.id}dot" in2="${c.id}dot" operator="over" x="${r(x)}" y="${r(y)}" width="${cell}" height="${cell}" result="${c.id}cell"/>` +
        `<feTile in="${c.id}cell" result="${c.id}grid"/>` +
        `<feComposite in="${c.input}" in2="${c.id}grid" operator="in" result="${c.id}s"/>` +
        `<feMorphology in="${c.id}s" operator="dilate" radius="${r(cell / 2)}" result="${c.result}"/>`
      );
    },
  },

  scanlines: {
    label: 'Scanlines',
    group: 'Glitch',
    hint: 'Cuts thin horizontal gaps through the ink, like an old monitor.',
    params: [
      { key: 'density', label: 'Lines', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'gap', label: 'Gap', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
    ],
    pad: () => 0,
    build: (p, c) => {
      const period = c.S * (0.004 + (1 - p.density) * 0.03);
      const gap = Math.max(0.5, period * (0.15 + p.gap * 0.6));
      const { x, y, w, h } = c.region;
      const img = svgUrl(
        `<pattern id="l" width="${r(w)}" height="${r(period)}" patternUnits="userSpaceOnUse"><rect width="${r(w)}" height="${r(gap)}"/></pattern><rect width="100%" height="100%" fill="url(#l)"/>`,
        w, h,
      );
      return (
        `<feImage href="${esc(img)}" x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" preserveAspectRatio="none" result="${c.id}i"/>` +
        `<feComposite in="${c.input}" in2="${c.id}i" operator="out" result="${c.result}"/>`
      );
    },
  },

  datamosh: {
    label: 'Datamosh',
    group: 'Glitch',
    hint: 'Shoves rectangular blocks around, like a corrupted video frame.',
    params: [
      { key: 'amount', label: 'Chaos', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'blocks', label: 'Block size', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
      seedParam,
    ],
    pad: (p) => +p.amount * 0.08,
    build: (p, c) => {
      const rand = rng(+p.seed * 7 + 1);
      const steps = () => Array.from({ length: 7 }, () => r(0.5 + (rand() - 0.5) * (rand() < 0.5 ? 0 : 1))).join(' ');
      const f = 1 / (c.S * (0.02 + p.blocks * 0.25));
      return (
        `<feTurbulence type="fractalNoise" baseFrequency="${r(f, 6)} ${r(f * 0.6, 6)}" numOctaves="1" seed="${p.seed}" result="${c.id}n"/>` +
        `<feComponentTransfer in="${c.id}n" result="${c.id}d"><feFuncR type="discrete" tableValues="${steps()}"/><feFuncG type="discrete" tableValues="${steps()}"/></feComponentTransfer>` +
        `<feDisplacementMap in="${c.input}" in2="${c.id}d" scale="${r(p.amount * c.S * 0.32)}" xChannelSelector="R" yChannelSelector="G" result="${c.result}"/>`
      );
    },
  },

  spread: {
    label: 'Ink spread',
    group: 'Texture',
    hint: 'Melts lines together into blobby, gooey shapes.',
    params: [{ key: 'amount', label: 'Spread', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.35 }],
    pad: (p) => +p.amount * 0.04,
    build: (p, c) =>
      `<feGaussianBlur in="${c.input}" stdDeviation="${r(0.5 + p.amount * c.S * 0.012)}" result="${c.id}b"/>` +
      `<feComponentTransfer in="${c.id}b" result="${c.result}"><feFuncA type="linear" slope="18" intercept="-7"/></feComponentTransfer>`,
  },

  weight: {
    label: 'Line weight',
    group: 'Texture',
    hint: 'Thins or fattens every stroke.',
    params: [{ key: 'amount', label: 'Thin to fat', kind: 'range', min: -1, max: 1, step: 0.01, default: 0.4 }],
    pad: (p) => Math.max(0, +p.amount) * 0.01,
    build: (p, c) =>
      `<feMorphology in="${c.input}" operator="${p.amount < 0 ? 'erode' : 'dilate'}" radius="${r(Math.abs(p.amount) * c.S * 0.006)}" result="${c.result}"/>`,
  },

  outline: {
    label: 'Hollow',
    group: 'Texture',
    hint: 'Keeps only an outline around the strokes.',
    params: [{ key: 'thickness', label: 'Thickness', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.3 }],
    pad: (p) => +p.thickness * 0.012,
    build: (p, c) =>
      `<feMorphology in="${c.input}" operator="dilate" radius="${r(0.5 + p.thickness * c.S * 0.008)}" result="${c.id}d"/>` +
      `<feComposite in="${c.id}d" in2="${c.input}" operator="out" result="${c.result}"/>`,
  },

  grain: {
    label: 'Dry brush',
    group: 'Texture',
    hint: 'Eats holes into the ink, like a dry pen or a worn print.',
    params: [
      { key: 'amount', label: 'Wear', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
      { key: 'size', label: 'Grain size', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
      seedParam,
    ],
    pad: () => 0,
    build: (p, c) => {
      const t = 0.3 + p.amount * 0.4;
      return (
        `<feTurbulence type="fractalNoise" baseFrequency="${r(1 / (c.S * (0.0015 + p.size * 0.015)), 6)}" numOctaves="3" seed="${p.seed}" result="${c.id}n"/>` +
        `<feColorMatrix in="${c.id}n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  24 0 0 0 ${r(-24 * t)}" result="${c.id}h"/>` +
        `<feComposite in="${c.input}" in2="${c.id}h" operator="in" result="${c.result}"/>`
      );
    },
  },

  blur: {
    label: 'Blur',
    group: 'Focus',
    hint: 'Out of focus, or streaked like motion.',
    params: [
      { key: 'amount', label: 'Blur', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: 'streak', label: 'Round to streak', kind: 'range', min: 0, max: 1, step: 0.01, default: 0 },
    ],
    pad: (p) => +p.amount * 0.06 * (1 + +p.streak * 3),
    build: (p, c) => {
      const base = p.amount * c.S * 0.02;
      return `<feGaussianBlur in="${c.input}" stdDeviation="${r(base * (1 + p.streak * 3))} ${r(base * (1 - p.streak * 0.95))}" result="${c.result}"/>`;
    },
  },

  glow: {
    label: 'Glow',
    group: 'Focus',
    hint: 'A soft halo of color behind the ink.',
    params: [
      { key: 'color', label: 'Color', kind: 'color', default: '#ff4fd8' },
      { key: 'size', label: 'Size', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
    ],
    pad: (p) => +p.size * 0.1,
    build: (p, c) =>
      `<feGaussianBlur in="${c.input}" stdDeviation="${r(1 + p.size * c.S * 0.03)}" result="${c.id}b"/>` +
      `<feFlood flood-color="${esc(String(p.color))}" result="${c.id}f"/>` +
      `<feComposite in="${c.id}f" in2="${c.id}b" operator="in" result="${c.id}g"/>` +
      `<feMerge result="${c.result}"><feMergeNode in="${c.id}g"/><feMergeNode in="${c.id}g"/><feMergeNode in="${c.input}"/></feMerge>`,
  },

  misprint: {
    label: 'Misprint',
    group: 'Color',
    hint: 'A second ink layer out of register, like a riso print.',
    params: [
      { key: 'color', label: 'Second ink', kind: 'color', default: '#ff4a2e' },
      { key: 'distance', label: 'Offset', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.35 },
      { key: 'angle', label: 'Direction', kind: 'range', min: 0, max: 360, step: 1, default: 35 },
    ],
    pad: (p) => +p.distance * 0.05,
    build: (p, c) => {
      const d = p.distance * c.S * 0.04;
      return (
        `<feOffset in="${c.input}" dx="${r(Math.cos(rad(p.angle)) * d)}" dy="${r(Math.sin(rad(p.angle)) * d)}" result="${c.id}o"/>` +
        `<feFlood flood-color="${esc(String(p.color))}" result="${c.id}f"/>` +
        `<feComposite in="${c.id}f" in2="${c.id}o" operator="in" result="${c.id}c"/>` +
        `<feBlend in="${c.input}" in2="${c.id}c" mode="multiply" result="${c.result}"/>`
      );
    },
  },

  gradient: {
    label: 'Gradient ink',
    group: 'Color',
    hint: 'Fills the strokes with a two-color gradient.',
    params: [
      { key: 'from', label: 'From', kind: 'color', default: '#2b3cff' },
      { key: 'to', label: 'To', kind: 'color', default: '#ff2fa0' },
      { key: 'angle', label: 'Angle', kind: 'range', min: 0, max: 360, step: 1, default: 90 },
    ],
    pad: () => 0,
    build: (p, c) => {
      const a = rad(p.angle);
      const [x1, y1, x2, y2] = [0.5 - Math.cos(a) / 2, 0.5 - Math.sin(a) / 2, 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2].map((v) => r(v));
      const { x, y, w, h } = c.region;
      const img = svgUrl(
        `<linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${esc(String(p.from))}"/><stop offset="1" stop-color="${esc(String(p.to))}"/></linearGradient><rect width="100%" height="100%" fill="url(#g)"/>`,
        w, h,
      );
      return (
        `<feImage href="${esc(img)}" x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" preserveAspectRatio="none" result="${c.id}i"/>` +
        `<feComposite in="${c.id}i" in2="${c.input}" operator="in" result="${c.result}"/>`
      );
    },
  },

  dots: {
    label: 'Dot screen',
    group: 'Color',
    hint: 'Turns the ink into a field of printed dots.',
    params: [
      { key: 'size', label: 'Dot size', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: 'angle', label: 'Angle', kind: 'range', min: 0, max: 90, step: 1, default: 15 },
    ],
    pad: () => 0,
    build: (p, c) => {
      const cell = c.S * (0.006 + p.size * 0.03);
      const { x, y, w, h } = c.region;
      const img = svgUrl(
        `<pattern id="d" width="${r(cell)}" height="${r(cell)}" patternUnits="userSpaceOnUse" patternTransform="rotate(${p.angle})"><circle cx="${r(cell / 2)}" cy="${r(cell / 2)}" r="${r(cell * 0.34)}"/></pattern><rect width="100%" height="100%" fill="url(#d)"/>`,
        w, h,
      );
      return (
        `<feImage href="${esc(img)}" x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" preserveAspectRatio="none" result="${c.id}i"/>` +
        // dots take the ink's colour: keep the ink, but only where there's a dot
        `<feComposite in="${c.input}" in2="${c.id}i" operator="in" result="${c.result}"/>`
      );
    },
  },

  echo: {
    label: 'Echo',
    group: 'Repeat',
    hint: 'Fading copies trailing behind, like a long exposure.',
    params: [
      { key: 'count', label: 'Copies', kind: 'int', min: 1, max: 8, step: 1, default: 4 },
      { key: 'distance', label: 'Spacing', kind: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: 'angle', label: 'Direction', kind: 'range', min: 0, max: 360, step: 1, default: 200 },
    ],
    pad: (p) => +p.count * +p.distance * 0.06,
    build: (p, c) => {
      const d = p.distance * c.S * 0.06;
      const n = Math.round(p.count);
      let out = '';
      const nodes: string[] = [];
      for (let k = n; k >= 1; k--) {
        out +=
          `<feOffset in="${c.input}" dx="${r(Math.cos(rad(p.angle)) * d * k)}" dy="${r(Math.sin(rad(p.angle)) * d * k)}" result="${c.id}o${k}"/>` +
          `<feColorMatrix in="${c.id}o${k}" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${r(0.7 * (1 - k / (n + 1)))} 0" result="${c.id}e${k}"/>`;
        nodes.push(`<feMergeNode in="${c.id}e${k}"/>`);
      }
      return out + `<feMerge result="${c.result}">${nodes.join('')}<feMergeNode in="${c.input}"/></feMerge>`;
    },
  },
};

export const EFFECT_TYPES = Object.keys(EFFECTS);

export function defaultEffect(type: string, seed = 1 + Math.floor(Math.random() * 9999)): Effect {
  const def = EFFECTS[type];
  const params: Record<string, number | string> = {};
  for (const p of def.params) params[p.key] = p.key === 'seed' ? seed : p.default;
  return { type, params };
}

const PALETTE = ['#ff4a2e', '#2b3cff', '#ff2fa0', '#00a86b', '#ffb000', '#7a2bff', '#00b7ff', '#111111'];

/** Random values for every param of an effect (within its range), from a random source. */
export function randomEffect(type: string, rand: () => number = Math.random): Effect {
  const def = EFFECTS[type];
  const params: Record<string, number | string> = {};
  for (const p of def.params) {
    if (p.kind === 'color') params[p.key] = PALETTE[Math.floor(rand() * PALETTE.length)];
    else if (p.key === 'seed') params[p.key] = 1 + Math.floor(rand() * 9999);
    else {
      const min = p.min ?? 0, max = p.max ?? 1, step = p.step ?? 0.01;
      // keep random values away from the extremes, which tend to destroy the drawing
      const v = min + (max - min) * (0.15 + rand() * 0.6);
      params[p.key] = Math.round(v / step) * step;
    }
  }
  return { type, params };
}

/** One to three random effects from different groups: a starting point, never the same twice. */
export function surprise(rand: () => number = Math.random): Effect[] {
  const groups = [...new Set(EFFECT_TYPES.map((t) => EFFECTS[t].group))].sort(() => rand() - 0.5);
  const n = 1 + Math.floor(rand() * 3);
  return groups.slice(0, n).map((g) => {
    const options = EFFECT_TYPES.filter((t) => EFFECTS[t].group === g);
    return randomEffect(options[Math.floor(rand() * options.length)], rand);
  });
}

/** Clamps and fills params so documents from older versions or by hand still render. */
export function normalizeEffect(e: any): Effect | null {
  const def = EFFECTS[e?.type];
  if (!def) return null;
  const params: Record<string, number | string> = {};
  for (const p of def.params) {
    const v = e.params?.[p.key];
    if (p.kind === 'color') params[p.key] = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : p.default;
    else {
      const n = Number(v);
      params[p.key] = Number.isFinite(n) ? Math.min(p.max ?? n, Math.max(p.min ?? n, n)) : p.default;
    }
  }
  return e.off ? { type: e.type, params, off: true } : { type: e.type, params };
}

/** Extra room (in user units) the effect stack needs around a drawing whose long side is S. */
export function effectsPad(effects: Effect[] | undefined, S: number): number {
  if (!effects?.length) return 0;
  return Math.ceil(S * Math.min(0.6, effects.reduce((sum, e) => sum + (e.off ? 0 : EFFECTS[e.type]?.pad(e.params) ?? 0), 0)));
}

/**
 * A complete <filter> for a layer: optional ink colour first, then each effect in order.
 * Coordinates are in the drawing's own user space (0..w, 0..h), padded by `pad`.
 * Returns '' when there is nothing to do.
 */
export function filterMarkup(id: string, opts: { color: string | null; effects?: Effect[]; w: number; h: number; pad: number }): string {
  const { color, w, h, pad } = opts;
  const effects = (opts.effects ?? []).filter((e) => !e.off);
  if (!color && !effects.length) return '';
  const S = Math.max(w, h);
  const region = { x: -pad, y: -pad, w: w + 2 * pad, h: h + 2 * pad };
  let body = '';
  let input = 'SourceGraphic';
  if (color) {
    body += `<feFlood flood-color="${esc(color)}" result="${id}c0"/><feComposite in="${id}c0" in2="SourceAlpha" operator="in" result="${id}ink"/>`;
    input = `${id}ink`;
  }
  effects.forEach((e, i) => {
    const def = EFFECTS[e.type];
    if (!def) return;
    const result = `${id}r${i}`;
    body += def.build(e.params, { input, result, S, id: `${id}x${i}`, region });
    input = result;
  });
  return (
    `<filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="${r(region.x)}" y="${r(region.y)}" width="${r(region.w)}" height="${r(region.h)}" color-interpolation-filters="sRGB">` +
    body +
    `</filter>`
  );
}

/**
 * A standalone SVG of one layer's drawing with its colour and effects, for the editor to
 * rasterise. `href` is a data: URL of the drawing; `px` the long side to render at.
 */
export function layerSvg(opts: { href: string; w: number; h: number; color: string | null; effects?: Effect[]; px: number; clip?: boolean }): { svg: string; pad: number } {
  const { href, w, h, color, effects, px, clip = false } = opts;
  // clip: keep the result inside the image's own bounds (used for whole-composition effects)
  const pad = clip ? 0 : effectsPad(effects, Math.max(w, h));
  const W = w + 2 * pad, H = h + 2 * pad;
  const k = px / Math.max(W, H);
  const filter = filterMarkup('f', { color, effects, w, h, pad });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * k)}" height="${Math.round(H * k)}" viewBox="${-pad} ${-pad} ${W} ${H}">` +
    (filter ? `<defs>${filter}</defs>` : '') +
    `<image href="${esc(href)}" width="${w}" height="${h}" preserveAspectRatio="none"${filter ? ' filter="url(#f)"' : ''}/>` +
    `</svg>`;
  return { svg, pad };
}
