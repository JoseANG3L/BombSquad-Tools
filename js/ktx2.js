/* Utilidades y formato KTX 2.0 (Khronos).
 * Escritura propia sin comprimir (RGBA8/RGB8 sRGB) compatible con el layout
 * de `toktx` / `ktx create` de KTX-Software. Lectura del nivel base para:
 * RGB(A)8/BGR(A)8 sin comprimir, BC1/BC2/BC3 (software, vía js/dds.js) y
 * BC7/ETC2/ASTC LDR (vía GPU WebGL2, ver js/ktx2gpu.js). Los KTX2 universales
 * (BasisLZ/UASTC, vkFormat 0) y supercomprimidos se derivan a las
 * herramientas CLI oficiales. Referencia: ktx-parse (MIT) y KTX spec 2.0. */
'use strict';
window.BST = window.BST || {};

const K2ID = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];

// VkFormat que sabemos decodificar / generar sin compresión.
const VKF = {
  R8G8B8_UNORM: 23,
  R8G8B8_SRGB: 29,
  B8G8R8_UNORM: 30,
  B8G8R8_SRGB: 36,
  R8G8B8A8_UNORM: 37,
  R8G8B8A8_SRGB: 43,
  B8G8R8A8_UNORM: 44,
  B8G8R8A8_SRGB: 50,
};
const VKF_NAME = {
  23: 'R8G8B8_UNORM', 29: 'R8G8B8_SRGB',
  30: 'B8G8R8_UNORM', 36: 'B8G8R8_SRGB',
  37: 'R8G8B8A8_UNORM', 43: 'R8G8B8A8_SRGB',
  44: 'B8G8R8A8_UNORM', 50: 'B8G8R8A8_SRGB',
};
const SCHEME_NAME = { 0: 'ninguna', 1: 'BasisLZ', 2: 'Zstandard', 3: 'ZLIB' };

function isKTX2(buf) {
  const u = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
  if (u.length < 12) return false;
  for (let i = 0; i < 12; i++) if (u[i] !== K2ID[i]) return false;
  return true;
}

function lcm(a, b) {
  let m = Math.max(a, b);
  while (m % Math.min(a, b) !== 0) m += Math.max(a, b);
  return m;
}

function encText(s) {
  return new TextEncoder().encode(s);
}

/* DFD BASICFORMAT para RGB(A)8 sRGB, como lo escribe libktx/toktx. */
function dfdBytes(rgba) {
  const n = rgba ? 4 : 3;
  const buf = new ArrayBuffer(28 + n * 16);
  const dv = new DataView(buf);
  dv.setUint32(0, buf.byteLength, true); // dfdTotalSize
  dv.setUint16(4, 0, true);  // vendorId Khronos
  dv.setUint16(6, 0, true);  // descriptorType BASICFORMAT
  dv.setUint16(8, 2, true);  // version
  dv.setUint16(10, 24 + n * 16, true); // descriptorBlockSize
  dv.setUint8(12, 1);  // colorModel RGBSDA
  dv.setUint8(13, 1);  // colorPrimaries SRGB/BT709
  dv.setUint8(14, 2);  // transferFunction SRGB
  dv.setUint8(15, 0);  // flags: alfa no premultiplicada
  dv.setUint8(16, 0); dv.setUint8(17, 0); dv.setUint8(18, 0); dv.setUint8(19, 0); // bloque 1x1x1
  dv.setUint8(20, rgba ? 4 : 3); // bytesPlane0
  for (let i = 1; i < 8; i++) dv.setUint8(20 + i, 0);
  const chans = rgba ? [0, 1, 2, 15] : [0, 1, 2];
  for (let i = 0; i < n; i++) {
    const o = 28 + i * 16;
    dv.setUint16(o, i * 8, true); // bitOffset
    dv.setUint8(o + 2, 7);        // bitLength (8 bits -> 7)
    dv.setUint8(o + 3, chans[i]); // channelId
    dv.setUint8(o + 4, 0); dv.setUint8(o + 5, 0);
    dv.setUint8(o + 6, 0); dv.setUint8(o + 7, 0);
    dv.setUint32(o + 8, 0, true);   // sampleLower
    dv.setUint32(o + 12, 255, true); // sampleUpper
  }
  return new Uint8Array(buf);
}

/* Bloque Key/Value con padding a 4 bytes. */
function kvEntry(key, valueStr) {
  const kb = encText(key);
  const vb = encText(valueStr);
  const len = kb.length + 1 + vb.length + 1; // + NUL de clave y de valor
  const pad = (4 - (len % 4)) % 4;
  const out = new Uint8Array(4 + len + pad);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len, true);
  out.set(kb, 4);
  out[4 + kb.length] = 0;
  out.set(vb, 4 + kb.length + 1);
  return out; // padding ya es 0
}

/* Construye un KTX 2.0 sin comprimir. levels: [{w,h,data RGBA}] base->pequeño. */
function buildKTX2(levels, w, h, rgba) {
  if (!levels.length) throw new Error('Sin niveles para KTX2');
  const vkFormat = rgba ? VKF.R8G8B8A8_SRGB : VKF.R8G8B8_SRGB;
  const bpp = rgba ? 4 : 3;
  const dfd = dfdBytes(rgba);

  // Datos de nivel empaquetados (filas sin padding en KTX2).
  const packed = levels.map((l) => {
    if (rgba) return new Uint8Array(l.data);
    const o = new Uint8Array(l.w * l.h * 3);
    for (let i = 0, j = 0; i < l.data.length; i += 4, j += 3) {
      o[j] = l.data[i]; o[j + 1] = l.data[i + 1]; o[j + 2] = l.data[i + 2];
    }
    return o;
  });

  // KVD ordenado por clave, como recomienda la especificación.
  const kvdParts = [
    kvEntry('KTXorientation', 'rd'),
    kvEntry('KTXwriter', 'BombSquad Tools KTX2 (uncompressed RGBA8/RGB8)'),
  ].sort((a, b) => {
    const ka = new TextDecoder().decode(a.slice(4, a.indexOf(0, 4)));
    const kb = new TextDecoder().decode(b.slice(4, b.indexOf(0, 4)));
    return ka > kb ? 1 : -1;
  });
  let kvdLen = 0;
  for (const p of kvdParts) kvdLen += p.length;
  const kvd = new Uint8Array(kvdLen);
  let ko = 0;
  for (const p of kvdParts) { kvd.set(p, ko); ko += p.length; }

  const nLv = levels.length;
  const dfdOff = 12 + 68 + nLv * 24;
  const kvdOff = dfdOff + dfd.length;

  // Niveles en archivo de pequeño->grande, con mipPadding a lcm(bloque,4).
  const align = lcm(bpp, 4);
  const offsets = new Array(nLv);
  let dataOff = kvdOff + kvdLen;
  const chunks = [];
  for (let i = nLv - 1; i >= 0; i--) {
    const pad = (align - (dataOff % align)) % align;
    if (pad) { chunks.push(new Uint8Array(pad)); dataOff += pad; }
    offsets[i] = dataOff;
    chunks.push(packed[i]);
    dataOff += packed[i].length;
  }

  const total = dataOff;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  K2ID.forEach((x, i) => out[i] = x);
  let o = 12;
  const u32 = (v) => { dv.setUint32(o, v, true); o += 4; };
  u32(vkFormat); u32(1); u32(w); u32(h); u32(0); // vkFormat..pixelDepth
  u32(0); u32(1); u32(nLv); u32(0);              // layerCount..supercompression(NONE)
  u32(dfdOff); u32(dfd.length); u32(kvdOff); u32(kvdLen);
  dv.setBigUint64(o, 0n, true); o += 8;          // sgdByteOffset
  dv.setBigUint64(o, 0n, true); o += 8;          // sgdByteLength
  for (let i = 0; i < nLv; i++) {                // índice grande->pequeño
    dv.setBigUint64(o, BigInt(offsets[i]), true); o += 8;
    dv.setBigUint64(o, BigInt(packed[i].length), true); o += 8;
    dv.setBigUint64(o, BigInt(packed[i].length), true); o += 8;
  }
  out.set(dfd, dfdOff);
  out.set(kvd, kvdOff);
  let p = kvdOff + kvdLen;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out.buffer;
}

/* Volteo vertical de un buffer RGBA top-down (p. ej. archivos bottom-up). */
function flipYRGBA(data, w, h) {
  const out = new Uint8Array(data.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) out.set(data.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
  return out;
}

/* Lee el metadato KTXorientation del KVD. Devuelve 'u' (bottom-up, hay que
 * voltear) o 'd' (top-down, valor por defecto KTX2 y el que escribe toktx). */
function readKTX2Orientation(u, kvdOff, kvdLen) {
  try {
    if (!kvdOff || !kvdLen) return 'd';
    const end = kvdOff + kvdLen;
    let p = kvdOff;
    const dec = new TextDecoder();
    while (p + 4 <= end) {
      const len = new DataView(u.buffer, u.byteOffset + p, 4).getUint32(0, true);
      if (len < 1 || p + 4 + len > end) break;
      const kv = u.slice(p + 4, p + 4 + len);
      const z = kv.indexOf(0);
      const key = dec.decode(kv.slice(0, z < 0 ? kv.length : z));
      if (key === 'KTXorientation') {
        const val = dec.decode(kv.slice((z < 0 ? kv.length : z) + 1)).replace(/\0/g, '').trim();
        if (/T\s*=\s*u/i.test(val)) return 'u';
        const compact = val.replace(/[^a-z]/gi, '');
        if (compact.length === 2 && compact[1].toLowerCase() === 'u') return 'u';
        return 'd';
      }
      p += 4 + len + ((4 - (len % 4)) % 4);
    }
  } catch (e) { /* ante la duda, top-down */ }
  return 'd';
}

/* Lee el nivel base de un KTX2: RGB(A)8 sin comprimir, bloques BC1/BC2/BC3
 * (software) y BC7/ETC2/ASTC (vía GPU WebGL2, ver js/ktx2gpu.js). */
function parseKTX2(buf) {
  const u = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (!isKTX2(buf)) throw new Error('No es KTX 2.0');
  const vkFormat = dv.getUint32(12, true);
  const w = dv.getUint32(20, true), h = dv.getUint32(24, true);
  const layerCount = dv.getUint32(32, true), faceCount = dv.getUint32(36, true);
  const levelCount = dv.getUint32(40, true) || 1;
  const scheme = dv.getUint32(44, true);
  const flip = readKTX2Orientation(u, dv.getUint32(56, true), dv.getUint32(60, true)) === 'u';
  if (vkFormat === 0) {
    throw new Error('KTX2 universal (BasisLZ/UASTC, vkFormat 0). Usa KTX-Software CLI: `ktx transcode` o `ktx extract`.');
  }
  if (scheme !== 0) {
    throw new Error(`KTX2 con supercompresión ${SCHEME_NAME[scheme] || scheme}. Usa KTX-Software CLI para inflarlo.`);
  }
  if (faceCount !== 1) throw new Error(`KTX2 cubemap/array (faces=${faceCount}) no soportado`);
  if (layerCount > 1) throw new Error(`KTX2 array (layers=${layerCount}) no soportado`);
  // Clasificación: sin comprimir, bloques por software o bloques por GPU.
  let bpp = 0, swapBR = false, block = null;
  if (vkFormat === VKF.R8G8B8A8_UNORM || vkFormat === VKF.R8G8B8A8_SRGB) bpp = 4;
  else if (vkFormat === VKF.R8G8B8_UNORM || vkFormat === VKF.R8G8B8_SRGB) bpp = 3;
  else if (vkFormat === VKF.B8G8R8A8_UNORM || vkFormat === VKF.B8G8R8A8_SRGB) { bpp = 4; swapBR = true; }
  else if (vkFormat === VKF.B8G8R8_UNORM || vkFormat === VKF.B8G8R8_SRGB) { bpp = 3; swapBR = true; }
  else if (vkFormat >= 131 && vkFormat <= 134) block = { dec: 'dxt1', bytes: 8, bw: 4, bh: 4, tag: 'BC1' };
  else if (vkFormat === 135 || vkFormat === 136) block = { dec: 'dxt3', bytes: 16, bw: 4, bh: 4, tag: 'BC2' };
  else if (vkFormat === 137 || vkFormat === 138) block = { dec: 'dxt5', bytes: 16, bw: 4, bh: 4, tag: 'BC3' };
  else if (window.BST.ktx2GpuInfo && window.BST.ktx2GpuInfo(vkFormat)) block = { dec: 'gpu', tag: null };
  else throw new Error(`vkFormat ${VKF_NAME[vkFormat] || vkFormat} no soportado en web. Usa KTX-Software CLI: \`ktx transcode\` o \`ktx extract\`.`);
  const idxOff = 12 + 68; // índice del nivel base (nivel más grande)
  const byteOffset = Number(dv.getBigUint64(idxOff, true));
  const byteLength = Number(dv.getBigUint64(idxOff + 8, true));
  if (byteOffset + byteLength > u.length) throw new Error('KTX2 truncado');
  if (!block) {
    const need = w * h * bpp;
    if (byteLength < need) throw new Error('Nivel base KTX2 incompleto');
    const raw = u.slice(byteOffset, byteOffset + need);
    const out = new Uint8Array(w * h * 4);
    for (let i = 0, j = 0; i < out.length; i += 4, j += bpp) {
      if (bpp === 4) {
        out[i] = swapBR ? raw[j + 2] : raw[j];
        out[i + 1] = raw[j + 1];
        out[i + 2] = swapBR ? raw[j] : raw[j + 2];
        out[i + 3] = raw[j + 3];
      } else {
        out[i] = swapBR ? raw[j + 2] : raw[j];
        out[i + 1] = raw[j + 1];
        out[i + 2] = swapBR ? raw[j] : raw[j + 2];
        out[i + 3] = 255;
      }
    }
    return { w, h, data: flip ? flipYRGBA(out, w, h) : out, levels: levelCount, fmt: VKF_NAME[vkFormat] || ('vk' + vkFormat) };
  }
  // Formatos de bloques: se decodifica solo el nivel base (los mipmaps se regeneran).
  if (block.dec === 'gpu') {
    const { ktx2GpuLevelBytes, decodeKTX2LevelGPU, ktx2GpuInfo } = window.BST;
    if (!ktx2GpuLevelBytes || !decodeKTX2LevelGPU) {
      throw new Error('Módulo GPU (js/ktx2gpu.js) no cargado. Usa KTX-Software CLI: `ktx extract` para este formato.');
    }
    const need = ktx2GpuLevelBytes(vkFormat, w, h);
    if (byteLength < need) throw new Error('Nivel base KTX2 incompleto');
    const data = decodeKTX2LevelGPU(u.slice(byteOffset, byteOffset + need), w, h, vkFormat);
    const tag = (ktx2GpuInfo(vkFormat) || {}).tag || ('vk' + vkFormat);
    return { w, h, data: flip ? flipYRGBA(data, w, h) : data, levels: levelCount, fmt: 'KTX2-' + tag };
  }
  const dec = block.dec === 'dxt1' ? window.BST.decDXT1
    : block.dec === 'dxt3' ? window.BST.decDXT3 : window.BST.decDXT5;
  if (!dec) throw new Error('Decodificador DXT (js/dds.js) no cargado');
  const need = Math.ceil(w / block.bw) * Math.ceil(h / block.bh) * block.bytes;
  if (byteLength < need) throw new Error('Nivel base KTX2 incompleto');
  const data = dec(w, h, u.slice(byteOffset, byteOffset + need));
  return { w, h, data: flip ? flipYRGBA(data, w, h) : data, levels: levelCount, fmt: 'KTX2-' + block.tag };
}

Object.assign(window.BST, { buildKTX2, parseKTX2, isKTX2, KTX2_ID: K2ID, VKF });
