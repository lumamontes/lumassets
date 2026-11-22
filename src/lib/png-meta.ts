// Text metadata inside PNG files (PNG spec, section 11.3.4: tEXt and iTXt chunks).
// Pure functions, no DOM: unit-tested in Node. Values are written as iTXt (UTF-8), so titles
// in any language survive; readers also accept plain tEXt.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const isPng = (b: Uint8Array) => SIGNATURE.every((v, i) => b[i] === v);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** iTXt: keyword \0, compression flag 0, method 0, language "" \0, translated keyword "" \0, UTF-8 text. */
function iTXt(keyword: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const key = enc.encode(keyword.slice(0, 79));
  const body = enc.encode(text);
  const data = new Uint8Array(key.length + 5 + body.length);
  data.set(key, 0);
  // bytes after the keyword: \0, flag 0, method 0, \0 (language), \0 (translated keyword)
  data.set(body, key.length + 5);
  return chunk('iTXt', data);
}

/** A copy of `png` with text entries added right before IEND. */
export function withPngText(png: Uint8Array, entries: Record<string, string>): Uint8Array<ArrayBuffer> {
  if (!isPng(png)) throw new Error('Not a PNG');
  const iend = findChunk(png, 'IEND');
  if (iend < 0) throw new Error('PNG has no IEND chunk');
  const extra = Object.entries(entries).map(([k, v]) => iTXt(k, v));
  const size = png.length + extra.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(size);
  out.set(png.subarray(0, iend), 0);
  let at = iend;
  for (const c of extra) { out.set(c, at); at += c.length; }
  out.set(png.subarray(iend), at);
  return out;
}

/** All tEXt / iTXt entries of a PNG (uncompressed ones; compressed iTXt is skipped). */
export function readPngText(png: Uint8Array): Record<string, string> {
  const out: Record<string, string> = Object.create(null); // keys come from the file: no prototype to poke at
  if (!isPng(png)) return out;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const latin1 = new TextDecoder('latin1');
  const utf8 = new TextDecoder();
  for (let at = 8; at + 12 <= png.length;) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    const nul = data.indexOf(0);
    if (type === 'tEXt' && nul > 0) out[latin1.decode(data.subarray(0, nul))] = latin1.decode(data.subarray(nul + 1));
    if (type === 'iTXt' && nul > 0 && data[nul + 1] === 0) {
      const lang = data.indexOf(0, nul + 3);
      const translated = lang < 0 ? -1 : data.indexOf(0, lang + 1);
      if (translated >= 0) out[latin1.decode(data.subarray(0, nul))] = utf8.decode(data.subarray(translated + 1));
    }
    if (type === 'IEND') break;
    at += 12 + len;
  }
  return out;
}

function findChunk(png: Uint8Array, type: string): number {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = 8; at + 12 <= png.length;) {
    const len = view.getUint32(at);
    if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === type) return at;
    at += 12 + len;
  }
  return -1;
}
