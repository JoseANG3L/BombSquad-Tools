/* Utilidades y formato KTX 1.0 (RGBA8/RGB8 sin compresión) */
'use strict';
window.BST = window.BST || {};

const GL = { U8: 0x1401, RGB: 0x1907, RGBA: 0x1908, RGB8: 0x8051, RGBA8: 0x8058 };
const KID = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x31, 0x31, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];

const loadImg = (url) => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => rej(new Error('No se pudo leer imagen'));
  i.src = url;
});

function canvasOf(rgba, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return c;
}

function rgbaOf(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  return { w: c.width, h: c.height, data: new Uint8Array(d.data) };
}

function hasAlphaArr(a) {
  for (let i = 3; i < a.length; i += 4) if (a[i] < 255) return true;
  return false;
}

function flipArr(a, w, h) {
  const o = new Uint8Array(a.length), r = w * 4;
  for (let y = 0; y < h; y++) o.set(a.subarray(y * r, (y + 1) * r), (h - 1 - y) * r);
  return o;
}

function compToBg(a, w, h, bg) {
  const o = new Uint8Array(a);
  for (let i = 0; i < o.length; i += 4) {
    const al = o[i + 3] / 255;
    let br = 0, bgc = 0, bb = 0;
    if (bg === 'white') { br = bgc = bb = 255; }
    else if (bg === 'magenta') { br = 255; bb = 255; }
    o[i] = Math.round(o[i] * al + br * (1 - al));
    o[i + 1] = Math.round(o[i + 1] * al + bgc * (1 - al));
    o[i + 2] = Math.round(o[i + 2] * al + bb * (1 - al));
    o[i + 3] = 255;
  }
  return o;
}

function padRows(px, w, bpp) {
  const r = w * bpp, p = (r + 3) & ~3;
  if (p === r) return px;
  const o = new Uint8Array(p * (px.length / r));
  for (let i = 0; i < px.length / r; i++) o.set(px.subarray(i * r, (i + 1) * r), i * p);
  return o;
}

function buildKTX(levels, w, h, rgba) {
  const glF = rgba ? GL.RGBA : GL.RGB, glI = rgba ? GL.RGBA8 : GL.RGB8;
  let t = 64;
  for (const l of levels) t += 4 + l.length + ((4 - (l.length % 4)) % 4);
  const b = new ArrayBuffer(t), dv = new DataView(b), u = new Uint8Array(b);
  KID.forEach((x, i) => u[i] = x);
  dv.setUint32(12, 0x04030201, true); dv.setUint32(16, GL.U8, true);
  dv.setUint32(20, 1, true); dv.setUint32(24, glF, true);
  dv.setUint32(28, glI, true); dv.setUint32(32, glF, true);
  dv.setUint32(36, w, true); dv.setUint32(40, h, true);
  dv.setUint32(44, 0, true); dv.setUint32(48, 0, true);
  dv.setUint32(52, 1, true); dv.setUint32(56, levels.length, true);
  dv.setUint32(60, 0, true);
  let o = 64;
  for (const l of levels) {
    dv.setUint32(o, l.length, true); o += 4;
    u.set(l, o); o += l.length; o += (4 - (l.length % 4)) % 4;
  }
  return b;
}

function parseKTX(buf) {
  const u = new Uint8Array(buf), dv = new DataView(buf);
  for (let i = 0; i < 12; i++) if (u[i] !== KID[i]) throw new Error('No es KTX 1.0');
  if (dv.getUint32(12, true) !== 0x04030201) throw new Error('KTX big-endian no soportado');
  const glType = dv.getUint32(16, true), glF = dv.getUint32(24, true), glI = dv.getUint32(28, true);
  const w = dv.getUint32(36, true), h = dv.getUint32(40, true),
    m = dv.getUint32(56, true) || 1, kv = dv.getUint32(60, true);
  if (glType === 0) throw new Error('KTX comprimido (0x' + glI.toString(16) + '). Usa Mali Tool/astcenc.');
  if (glType !== GL.U8) throw new Error('glType 0x' + glType.toString(16) + ' no soportado');
  const bpp = glF === GL.RGBA ? 4 : glF === GL.RGB ? 3 : 0;
  if (!bpp) throw new Error('glFormat 0x' + glF.toString(16) + ' no soportado');
  let off = 64 + kv;
  const lv = [];
  for (let i = 0; i < m; i++) {
    const s = dv.getUint32(off, true); off += 4;
    lv.push(u.slice(off, off + s)); off += s; off += (4 - (s % 4)) % 4;
  }
  const raw = lv[0], pr = (w * bpp + 3) & ~3, out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const s = r * pr + c * bpp, d = (r * w + c) * 4;
    if (bpp === 4) { out[d] = raw[s]; out[d + 1] = raw[s + 1]; out[d + 2] = raw[s + 2]; out[d + 3] = raw[s + 3]; }
    else { out[d] = raw[s]; out[d + 1] = raw[s + 1]; out[d + 2] = raw[s + 2]; out[d + 3] = 255; }
  }
  return { w, h, data: out, levels: lv.length };
}

function mipChain(rgba, w, h, withMip) {
  const c0 = canvasOf(rgba, w, h);
  const chain = [{ w, h, data: new Uint8Array(rgba) }];
  if (!withMip) return chain;
  let cw = w, ch = h;
  while (cw > 1 || ch > 1) {
    cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1);
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    c.getContext('2d').drawImage(c0, 0, 0, cw, ch);
    const d = c.getContext('2d').getImageData(0, 0, cw, ch);
    chain.push({ w: cw, h: ch, data: new Uint8Array(d.data) });
  }
  return chain;
}

Object.assign(window.BST, {
  loadImg, canvasOf, rgbaOf, hasAlphaArr, flipArr, compToBg,
  padRows, buildKTX, parseKTX, mipChain,
});
