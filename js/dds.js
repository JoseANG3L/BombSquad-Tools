/* Formato DDS: escritura RGBA8 32-bit + lectura RGBA8 / DXT1 / DXT3 / DXT5 */
'use strict';
window.BST = window.BST || {};

function buildDDS(levelsRGBA, w, h) {
  const n = levelsRGBA.length;
  const buf = new ArrayBuffer(128 + levelsRGBA.reduce((a, l) => a + l.data.length, 0));
  const dv = new DataView(buf), u = new Uint8Array(buf);
  dv.setUint32(0, 0x20534444, true); dv.setUint32(4, 124, true);
  let flags = 0x1 | 0x2 | 0x4 | 0x1000 | 0x8;
  if (n > 1) flags |= 0x20000;
  dv.setUint32(8, flags, true);
  dv.setUint32(12, h, true); dv.setUint32(16, w, true);
  dv.setUint32(20, w * 4, true); dv.setUint32(24, 0, true);
  dv.setUint32(28, n, true);
  for (let i = 0; i < 11; i++) dv.setUint32(32 + i * 4, 0, true);
  dv.setUint32(76, 32, true); dv.setUint32(80, 0x41, true);
  dv.setUint32(84, 0, true); dv.setUint32(88, 32, true);
  dv.setUint32(92, 0x00FF0000, true); dv.setUint32(96, 0x0000FF00, true);
  dv.setUint32(100, 0x000000FF, true); dv.setUint32(104, 0xFF000000, true);
  let caps = 0x1000;
  if (n > 1) caps |= 0x8 | 0x400000;
  dv.setUint32(108, caps, true);
  dv.setUint32(112, 0, true); dv.setUint32(116, 0, true);
  dv.setUint32(120, 0, true); dv.setUint32(124, 0, true);
  let off = 128;
  for (const l of levelsRGBA) {
    const bgra = new Uint8Array(l.data.length);
    for (let i = 0; i < l.data.length; i += 4) {
      bgra[i] = l.data[i + 2]; bgra[i + 1] = l.data[i + 1];
      bgra[i + 2] = l.data[i]; bgra[i + 3] = l.data[i + 3];
    }
    u.set(bgra, off); off += bgra.length;
  }
  return buf;
}

function dxtColor(c) {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

function decDXT1(w, h, src) {
  const out = new Uint8Array(w * h * 4);
  const bw = (w + 3) >> 2, bh = (h + 3) >> 2;
  let p = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const c0 = src[p] | (src[p + 1] << 8), c1 = src[p + 2] | (src[p + 3] << 8);
    const [a0r, a0g, a0b] = dxtColor(c0), [a1r, a1g, a1b] = dxtColor(c1);
    let pal;
    if (c0 > c1) {
      pal = [[a0r, a0g, a0b, 255], [a1r, a1g, a1b, 255],
        [(2 * a0r + a1r) / 3 | 0, (2 * a0g + a1g) / 3 | 0, (2 * a0b + a1b) / 3 | 0, 255],
        [(a0r + 2 * a1r) / 3 | 0, (a0g + 2 * a1g) / 3 | 0, (a0b + 2 * a1b) / 3 | 0, 255]];
    } else {
      pal = [[a0r, a0g, a0b, 255], [a1r, a1g, a1b, 255],
        [(a0r + a1r) / 2 | 0, (a0g + a1g) / 2 | 0, (a0b + a1b) / 2 | 0, 255], [0, 0, 0, 0]];
    }
    const idx = src[p + 4] | (src[p + 5] << 8) | (src[p + 6] << 16) | (src[p + 7] << 24);
    p += 8;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const px = bx * 4 + x, py = by * 4 + y;
      if (px >= w || py >= h) continue;
      const s = pal[(idx >> (2 * (4 * y + x))) & 3], d = (py * w + px) * 4;
      out[d] = s[0]; out[d + 1] = s[1]; out[d + 2] = s[2]; out[d + 3] = s[3];
    }
  }
  return out;
}

function decDXT5(w, h, src) {
  const out = new Uint8Array(w * h * 4);
  const bw = (w + 3) >> 2, bh = (h + 3) >> 2;
  let p = 0;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const a0 = src[p], a1 = src[p + 1];
    const ab = new Uint8Array(8); ab[0] = a0; ab[1] = a1;
    if (a0 > a1) { for (let i = 0; i < 6; i++) ab[2 + i] = ((6 - i) * a0 + (1 + i) * a1) / 7 | 0; }
    else { for (let i = 0; i < 4; i++) ab[2 + i] = ((4 - i) * a0 + (1 + i) * a1) / 5 | 0; ab[6] = 0; ab[7] = 255; }
    let ai = 0;
    for (let i = 0; i < 6; i++) ai |= (src[p + 2 + i] << (8 * i));
    p += 8;
    const c0 = src[p] | (src[p + 1] << 8), c1 = src[p + 2] | (src[p + 3] << 8);
    const [a0r, a0g, a0b] = dxtColor(c0), [a1r, a1g, a1b] = dxtColor(c1);
    const pal = [[a0r, a0g, a0b], [a1r, a1g, a1b],
      [(2 * a0r + a1r) / 3 | 0, (2 * a0g + a1g) / 3 | 0, (2 * a0b + a1b) / 3 | 0],
      [(a0r + 2 * a1r) / 3 | 0, (a0g + 2 * a1g) / 3 | 0, (a0b + 2 * a1b) / 3 | 0]];
    const idx = src[p + 4] | (src[p + 5] << 8) | (src[p + 6] << 16) | (src[p + 7] << 24);
    p += 8;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const px = bx * 4 + x, py = by * 4 + y;
      if (px >= w || py >= h) continue;
      const ci = (idx >> (2 * (4 * y + x))) & 3, alp = ab[(ai >> (3 * (4 * y + x))) & 7], d = (py * w + px) * 4;
      out[d] = pal[ci][0]; out[d + 1] = pal[ci][1]; out[d + 2] = pal[ci][2]; out[d + 3] = alp;
    }
  }
  return out;
}

function parseDDS(buf) {
  const dv = new DataView(buf), u = new Uint8Array(buf);
  if (dv.getUint32(0, true) !== 0x20534444) throw new Error('No es DDS');
  const h = dv.getUint32(12, true), w = dv.getUint32(16, true);
  const mips = dv.getUint32(28, true) || 1;
  const fcc = dv.getUint32(84, true), bits = dv.getUint32(88, true);
  const rM = dv.getUint32(92, true);
  const fccS = String.fromCharCode(u[84], u[85], u[86], u[87]);
  const off = 128;
  const lvlSize = (ww, hh) => fccS === 'DXT1' ? (((ww + 3) >> 2) * ((hh + 3) >> 2) * 8)
    : (fccS === 'DXT5' || fccS === 'DXT3') ? (((ww + 3) >> 2) * ((hh + 3) >> 2) * 16) : ww * hh * 4;
  const sz = lvlSize(w, h);
  if (off + sz > u.length) throw new Error('DDS truncado');
  const raw = u.slice(off, off + sz);
  if (fccS === 'DXT1') return { w, h, data: decDXT1(w, h, raw), levels: mips, fmt: 'DXT1' };
  if (fccS === 'DXT5') return { w, h, data: decDXT5(w, h, raw), levels: mips, fmt: 'DXT5' };
  if (fccS === 'DXT3') {
    const bw = (w + 3) >> 2, bh = (h + 3) >> 2, out = new Uint8Array(w * h * 4);
    let p = 0;
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const alphaBytes = raw.slice(p, p + 8); p += 8;
      const c0 = raw[p] | (raw[p + 1] << 8), c1 = raw[p + 2] | (raw[p + 3] << 8);
      const [a0r, a0g, a0b] = dxtColor(c0), [a1r, a1g, a1b] = dxtColor(c1);
      const pal = [[a0r, a0g, a0b], [a1r, a1g, a1b],
        [(2 * a0r + a1r) / 3 | 0, (2 * a0g + a1g) / 3 | 0, (2 * a0b + a1b) / 3 | 0],
        [(a0r + 2 * a1r) / 3 | 0, (a0g + 2 * a1g) / 3 | 0, (a0b + 2 * a1b) / 3 | 0]];
      const idx = raw[p + 4] | (raw[p + 5] << 8) | (raw[p + 6] << 16) | (raw[p + 7] << 24);
      p += 8;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const px = bx * 4 + x, py = by * 4 + y;
        if (px >= w || py >= h) continue;
        const ci = (idx >> (2 * (4 * y + x))) & 3, d = (py * w + px) * 4;
        const a4 = (alphaBytes[(4 * y + x) >> 1] >> (((4 * y + x) & 1) * 4)) & 15;
        out[d] = pal[ci][0]; out[d + 1] = pal[ci][1]; out[d + 2] = pal[ci][2]; out[d + 3] = (a4 * 255 / 15) | 0;
      }
    }
    return { w, h, data: out, levels: mips, fmt: 'DXT3' };
  }
  if (fcc !== 0) throw new Error('FourCC ' + fccS + ' no soportado');
  if (bits !== 32) throw new Error('DDS de ' + bits + 'bpp no soportado (solo 32-bit, DXT1/3/5)');
  const out = new Uint8Array(w * h * 4);
  const isBGRA = (rM === 0x00FF0000);
  for (let i = 0, j = 0; i < out.length; i += 4, j += 4) {
    if (isBGRA) { out[i] = raw[j + 2]; out[i + 1] = raw[j + 1]; out[i + 2] = raw[j]; out[i + 3] = raw[j + 3]; }
    else { out[i] = raw[j]; out[i + 1] = raw[j + 1]; out[i + 2] = raw[j + 2]; out[i + 3] = raw[j + 3]; }
  }
  return { w, h, data: out, levels: mips, fmt: 'RGBA8' };
}

Object.assign(window.BST, { buildDDS, parseDDS, decDXT1, decDXT5 });
