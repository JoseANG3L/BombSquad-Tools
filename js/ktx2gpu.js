/* Decodificación GPU de niveles KTX2 con compresión por bloques (BC7/ETC2/ASTC).
 * Los navegadores no traen decodificadores software de estos formatos, pero la
 * propia GPU sí sabe mostrarlos: se sube el nivel con compressedTexImage2D a
 * WebGL2, se dibuja a un framebuffer y se lee con readPixels. Los formatos
 * BC1/BC2/BC3 se resuelven por software (ver parseKTX2) y no pasan por aquí.
 * Si el equipo no expone la extensión necesaria se lanza un error que indica
 * la alternativa CLI (KTX-Software). */
'use strict';
window.BST = window.BST || {};

// vkFormat: { etiqueta, extensión WebGL (null = core WebGL2), formato interno GL,
//             bloque [ancho, alto, bytes], sRGB }
const GPU_TABLE = {
  145: { tag: 'BC7_UNORM', ext: 'EXT_texture_compression_bptc', gl: 0x8E8C, blk: [4, 4, 16], srgb: false },
  146: { tag: 'BC7_SRGB', ext: 'EXT_texture_compression_bptc', gl: 0x8E8D, blk: [4, 4, 16], srgb: true },
  147: { tag: 'ETC2_RGB8', ext: null, gl: 0x9274, blk: [4, 4, 8], srgb: false },
  148: { tag: 'ETC2_SRGB8', ext: null, gl: 0x9275, blk: [4, 4, 8], srgb: true },
  149: { tag: 'ETC2_RGB8A1', ext: null, gl: 0x9276, blk: [4, 4, 8], srgb: false },
  150: { tag: 'ETC2_SRGB8A1', ext: null, gl: 0x9277, blk: [4, 4, 8], srgb: true },
  151: { tag: 'ETC2_RGBA8', ext: null, gl: 0x9278, blk: [4, 4, 16], srgb: false },
  152: { tag: 'ETC2_SRGB8A8', ext: null, gl: 0x9279, blk: [4, 4, 16], srgb: true },
};
// ASTC LDR 2D: vkFormat 157..184, pares UNORM/SRGB por tamaño de bloque.
const ASTC_BLOCKS = ['4x4', '5x4', '5x5', '6x5', '6x6', '8x5', '8x6', '8x8', '10x5', '10x6', '10x8', '10x10', '12x10', '12x12'];
for (let i = 0; i < ASTC_BLOCKS.length; i++) {
  const [bw, bh] = ASTC_BLOCKS[i].split('x').map(Number);
  GPU_TABLE[157 + i * 2] = { tag: `ASTC_${ASTC_BLOCKS[i]}_UNORM`, ext: 'WEBGL_compressed_texture_astc', gl: 0x93B0 + i * 2, blk: [bw, bh, 16], srgb: false };
  GPU_TABLE[157 + i * 2 + 1] = { tag: `ASTC_${ASTC_BLOCKS[i]}_SRGB`, ext: 'WEBGL_compressed_texture_astc', gl: 0x93B1 + i * 2, blk: [bw, bh, 16], srgb: true };
}

function ktx2GpuInfo(vkFormat) {
  return GPU_TABLE[vkFormat] || null;
}

/* Bytes esperados del nivel base para un formato de bloques dado. */
function ktx2GpuLevelBytes(vkFormat, w, h) {
  const e = ktx2GpuInfo(vkFormat);
  if (!e) return 0;
  const [bw, bh, bb] = e.blk;
  return Math.ceil(w / bw) * Math.ceil(h / bh) * bb;
}

let _gl = null, _prog = null, _vbo = null;

function gpuContext() {
  if (_gl) return _gl;
  if (typeof document === 'undefined') {
    throw new Error('Decodificación GPU no disponible fuera del navegador. Usa KTX-Software CLI: `ktx extract` para este formato.');
  }
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: false });
  if (!gl) throw new Error('WebGL2 no disponible en este navegador. Usa KTX-Software CLI: `ktx extract` para este formato.');
  _gl = gl;
  return gl;
}

function gpuProgram(gl) {
  if (_prog) return _prog;
  const vs = `#version 300 es\nin vec2 p;in vec2 t;out vec2 v;void main(){v=t;gl_Position=vec4(p,0.,1.);}`;
  const fs = `#version 300 es\nprecision mediump float;uniform sampler2D u;in vec2 v;out vec4 o;void main(){o=texture(u,v);}`;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader GPU no compiló: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('Programa GPU no enlazó');
  _prog = pr;
  _vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, _vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1,
  ]), gl.STATIC_DRAW);
  return pr;
}

/* Decodifica el nivel base (bytes comprimidos) a RGBA8. Devuelve Uint8Array top-down. */
function decodeKTX2LevelGPU(raw, w, h, vkFormat) {
  const e = ktx2GpuInfo(vkFormat);
  if (!e) throw new Error(`vkFormat ${vkFormat} sin decodificador GPU`);
  const gl = gpuContext();
  if (e.ext && !gl.getExtension(e.ext)) {
    throw new Error(
      `Tu GPU/navegador no expone ${e.ext} (${e.tag}). Prueba en Chrome/Edge de escritorio ` +
      `o usa KTX-Software CLI: \`ktx extract\` / \`ktx transcode\` para este formato.`
    );
  }
  const pr = gpuProgram(gl);
  gl.useProgram(pr);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.compressedTexImage2D(gl.TEXTURE_2D, 0, e.gl, w, h, 0, new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));

  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorage(gl.RENDERBUFFER, e.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, w, h);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Framebuffer GPU incompleto para ' + e.tag);
  }
  gl.viewport(0, 0, w, h);
  gl.bindBuffer(gl.ARRAY_BUFFER, _vbo);
  const lp = gl.getAttribLocation(pr, 'p'), lt = gl.getAttribLocation(pr, 't');
  gl.enableVertexAttribArray(lp);
  gl.enableVertexAttribArray(lt);
  gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(lt, 2, gl.FLOAT, false, 16, 8);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteRenderbuffer(rb);
  gl.deleteTexture(tex);

  // readPixels entrega primero la fila 0 del framebuffer. Como el quad mapea
  // la coordenada de textura (0,0) —primer byte en memoria— a la parte inferior
  // de la pantalla, la fila 0 del framebuffer YA es la primera fila en memoria:
  // el resultado conserva el orden del archivo (top-down según KTX2) tal cual.
  // El volteo por orientación (KTXorientation) se aplica en parseKTX2, no aquí.
  return px;
}

Object.assign(window.BST, { ktx2GpuInfo, ktx2GpuLevelBytes, decodeKTX2LevelGPU });
