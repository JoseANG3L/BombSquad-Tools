/* Cola y conversión de imágenes + descarga individual y en ZIP */
'use strict';
(() => {
  const { $, ilog, toast, setProgress, downloadBlob, downloadAsZip } = window.BST;

  let imgQ = [], _iq = 0;
  const imgKind = (f) => /\.ktx2$/i.test(f.name) ? 'ktx2' : /\.ktx$/i.test(f.name) ? 'ktx' : /\.dds$/i.test(f.name) ? 'dds' : 'img';

  const drop = $('imgDrop');
  const openPicker = (e) => { if (e.target.closest('.q')) return; $('imgFile').click(); };
  drop.onclick = openPicker;
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('imgFile').click(); } };
  for (const e of ['dragover', 'dragenter']) drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); });
  for (const e of ['dragleave', 'drop']) drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (ev) => addImg(ev.dataTransfer.files));
  $('imgFile').addEventListener('change', (ev) => { addImg(ev.target.files); ev.target.value = ''; });
  $('imgClear').onclick = () => {
    imgQ = []; renderImg();
    $('imgPreview').src = '';
    delete $('imgPreview').dataset.full;
    $('imgDims').textContent = 'Sin vista previa.';
    setProgress('imgProgress', 0, 0);
    refreshZipBtn();
    ilog('Cola vaciada.');
  };

  function addImg(fs) {
    for (const f of fs) {
      imgQ.push({
        id: ++_iq, file: f, kind: imgKind(f), status: 'pendiente',
        url: imgKind(f) === 'img' ? URL.createObjectURL(f) : null,
        outBlob: null, outName: null,
      });
    }
    ilog(`Añadidos ${fs.length}. Cola: ${imgQ.length}`);
    renderImg(); refreshZipBtn();
    if (imgQ.length) prevImg(imgQ[0].id);
  }

  function renderImg() {
    $('imgCount').textContent = imgQ.length + ' en cola';
    $('imgGo').disabled = !imgQ.length;
    const b = $('imgQueue');
    if (!imgQ.length) { b.innerHTML = '<span class="hint">Cola vacía.</span>'; return; }
    b.innerHTML = '';
    for (const q of imgQ) {
      const d = document.createElement('div');
      d.className = 'q';
      d.innerHTML = q.kind === 'img'
        ? '<img><span class="nm"></span><span class="st"></span>'
        : `<div class="badge-custom"><i class="fas ${q.kind === 'ktx2' ? 'fa-cube' : 'fa-file-image'}"></i></div><span class="nm"></span><span class="st"></span>`;
      if (q.kind === 'img') d.querySelector('img').src = q.url;
      d.querySelector('.nm').textContent = q.file.name;
      d.querySelector('.st').textContent = q.status;
      const v = document.createElement('button');
      v.className = 'btn btn-view'; v.innerHTML = '<i class="fas fa-eye me-1"></i>Ver';
      v.onclick = () => prevImg(q.id);
      const x = document.createElement('button');
      x.className = 'btn btn-delete'; x.innerHTML = '<i class="fas fa-times"></i>';
      x.onclick = () => { imgQ = imgQ.filter((y) => y.id !== q.id); ilog('Eliminado: ' + q.file.name); renderImg(); refreshZipBtn(); };
      d.append(v, x);
      if (q.outBlob) {
        const dl = document.createElement('button');
        dl.className = 'btn btn-download'; dl.innerHTML = '<i class="fas fa-download me-1"></i>Descargar';
        dl.onclick = () => downloadBlob(q.outBlob, q.outName);
        d.append(dl);
      }
      b.append(d);
    }
  }

  async function srcToRGBA(q) {
    const { loadImg, rgbaOf, parseKTX, parseKTX2, parseDDS } = window.BST;
    if (q.kind === 'img') {
      const im = await loadImg(q.url);
      const r = rgbaOf(im);
      const ext = (q.file.name.split('.').pop() || '').toUpperCase();
      return { ...r, img: im, fmt: ext || 'IMG' };
    }
    const buf = await q.file.arrayBuffer();
    if (q.kind === 'ktx') { const k = parseKTX(buf); return { w: k.w, h: k.h, data: k.data, fmt: 'KTX1' }; }
    if (q.kind === 'ktx2') { const k = parseKTX2(buf); return { w: k.w, h: k.h, data: k.data, fmt: k.fmt }; }
    const d = parseDDS(buf); return { w: d.w, h: d.h, data: d.data, fmt: d.fmt };
  }

  async function prevImg(id) {
    const q = imgQ.find((x) => x.id === id);
    if (!q) return;
    try {
      const s = await srcToRGBA(q);
      const url = window.BST.canvasOf(s.data, s.w, s.h).toDataURL();
      const pv = $('imgPreview');
      pv.src = url;
      pv.dataset.full = url;
      pv.dataset.name = q.file.name;
      $('imgDims').textContent = `${q.file.name} — ${s.w}×${s.h} · ${s.fmt || ''} · vista a escala real (clic para ampliar)`;
      q.status = `${s.w}×${s.h}${s.fmt ? ' · ' + s.fmt : ''}`;
    } catch (e) {
      q.status = 'error';
      $('imgDims').textContent = 'Sin vista previa: ' + e.message;
      ilog('Vista previa ' + q.file.name + ': ' + e.message);
    }
    renderImg();
  }
  $('imgPreview').onclick = () => {
    const pv = $('imgPreview');
    if (pv.dataset.full) window.open(pv.dataset.full, '_blank');
  };

  function refreshZipBtn() {
    const done = imgQ.filter((q) => q.outBlob);
    const btn = $('imgZip');
    btn.disabled = !done.length;
    btn.innerHTML = done.length
      ? `<i class="fas fa-file-archive me-2"></i>Descargar todo en ZIP (${done.length})`
      : '<i class="fas fa-file-archive me-2"></i>Descargar todo en ZIP';
  }

  $('imgZip').onclick = async () => {
    const done = imgQ.filter((q) => q.outBlob).map((q) => ({ name: q.outName, blob: q.outBlob }));
    const btn = $('imgZip');
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Comprimiendo…';
    try {
      await downloadAsZip(done, 'bombsquad_texturas.zip', ilog);
    } catch (e) { ilog('ZIP: ' + e.message); toast(e.message, 'danger'); }
    btn.innerHTML = old;
    refreshZipBtn();
  };

  $('imgGo').onclick = async () => {
    const { hasAlphaArr, flipArr, compToBg, padRows, buildKTX, buildKTX2, buildDDS, mipChain, canvasOf } = window.BST;
    $('imgGo').disabled = true;
    $('imgGo').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Convirtiendo…';
    const target = $('imgTarget').value, mode = $('imgMode').value,
      bg = $('imgBg').value, flip = $('imgFlip').checked,
      withMip = $('imgMip').value === '1';
    let ok = 0;
    setProgress('imgProgress', 0, imgQ.length);
    for (let i = 0; i < imgQ.length; i++) {
      const q = imgQ[i];
      try {
        q.status = 'convirtiendo…'; renderImg();
        const s = await srcToRGBA(q);
        let data = new Uint8Array(s.data);
        if (flip) data = flipArr(data, s.w, s.h);
        const alpha = hasAlphaArr(data);
        const rgba = mode === 'rgba' ? true : mode === 'rgb' ? false : alpha;
        if (target === 'jpg' || (!rgba && mode === 'rgb')) data = compToBg(data, s.w, s.h, bg);
        const isRgba = target === 'jpg' ? false : rgba;
        const base = q.file.name.replace(/\.[^.]+$/, '');
        if (target === 'ktx') {
          const chain = mipChain(data, s.w, s.h, withMip);
          const lv = chain.map((l) => {
            if (isRgba) return padRows(new Uint8Array(l.data), l.w, 4);
            const o = new Uint8Array(l.w * l.h * 3);
            for (let k = 0, j = 0; k < l.data.length; k += 4, j += 3) {
              o[j] = l.data[k]; o[j + 1] = l.data[k + 1]; o[j + 2] = l.data[k + 2];
            }
            return padRows(o, l.w, 3);
          });
          q.outBlob = new Blob([buildKTX(lv, s.w, s.h, isRgba)], { type: 'image/ktx' });
          q.outName = `${base}_${isRgba ? 'RGBA8' : 'RGB8'}${withMip ? '_mip' : ''}.ktx`;
        } else if (target === 'ktx2') {
          const chain = mipChain(data, s.w, s.h, withMip);
          q.outBlob = new Blob([buildKTX2(chain, s.w, s.h, isRgba)], { type: 'image/ktx2' });
          q.outName = `${base}_${isRgba ? 'RGBA8' : 'RGB8'}${withMip ? '_mip' : ''}.ktx2`;
        } else if (target === 'dds') {
          const chain = mipChain(data, s.w, s.h, withMip);
          q.outBlob = new Blob([buildDDS(chain, s.w, s.h)], { type: 'image/vnd-ms.dds' });
          q.outName = `${base}_RGBA8${withMip ? '_mip' : ''}.dds`;
        } else {
          const c = canvasOf(data, s.w, s.h);
          if (target === 'png') {
            q.outBlob = await new Promise((r) => c.toBlob(r, 'image/png'));
            q.outName = base + '.png';
          } else {
            const t = document.createElement('canvas');
            t.width = s.w; t.height = s.h;
            const x = t.getContext('2d');
            x.fillStyle = bg === 'white' ? '#fff' : bg === 'magenta' ? '#f0f' : '#000';
            x.fillRect(0, 0, s.w, s.h); x.drawImage(c, 0, 0);
            q.outBlob = await new Promise((r) => t.toBlob(r, 'image/jpeg', 0.92));
            q.outName = base + '.jpg';
          }
        }
        q.status = 'OK → ' + q.outName; ok++;
        ilog(`OK: ${q.file.name} → ${q.outName} (${s.w}×${s.h})`);
      } catch (e) { q.status = 'error'; ilog('ERROR ' + q.file.name + ': ' + e.message); }
      renderImg(); refreshZipBtn();
      setProgress('imgProgress', i + 1, imgQ.length);
    }
    $('imgGo').disabled = false;
    $('imgGo').innerHTML = '<i class="fas fa-cog me-2"></i>Convertir imágenes';
    // Descarga en paquete: 1 archivo → directo, varios → un solo ZIP
    const done = imgQ.filter((q) => q.outBlob);
    if (done.length === 1) {
      downloadBlob(done[0].outBlob, done[0].outName);
      ilog('Lote terminado (1 archivo descargado). Usa ↓ para re-descargar.');
    } else if (done.length > 1) {
      ilog(`Lote terminado (${ok}/${imgQ.length}). Descargando paquete ZIP…`);
      try {
        await downloadAsZip(done.map((q) => ({ name: q.outName, blob: q.outBlob })), 'bombsquad_texturas.zip', ilog);
      } catch (e) { ilog('ZIP: ' + e.message); }
    } else {
      ilog('Lote terminado sin resultados.');
    }
    toast(`Imágenes: ${ok}/${imgQ.length} convertidas.`);
  };

  window.BST_images = { renderImg, refreshZipBtn };
})();
