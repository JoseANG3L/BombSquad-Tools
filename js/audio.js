/* Cola y conversión de audio + descarga individual y en ZIP */
'use strict';
(() => {
  const { $, alog, toast, setProgress, downloadBlob, downloadAsZip } = window.BST;

  let audQ = [], _aq = 0, actx = null;
  const AC = () => actx || (actx = new (window.AudioContext || window.webkitAudioContext)());

  const drop = $('audDrop');
  drop.onclick = (e) => { if (e.target.closest('.q')) return; $('audFile').click(); };
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('audFile').click(); } };
  for (const e of ['dragover', 'dragenter']) drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); });
  for (const e of ['dragleave', 'drop']) drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (ev) => addAud(ev.dataTransfer.files));
  $('audFile').addEventListener('change', (ev) => { addAud(ev.target.files); ev.target.value = ''; });
  $('audClear').onclick = () => {
    audQ = []; renderAud();
    setProgress('audProgress', 0, 0);
    refreshZipBtn();
    alog('Cola vaciada.');
  };

  function addAud(fs) {
    for (const f of fs) {
      audQ.push({
        id: ++_aq, file: f, status: 'pendiente', url: URL.createObjectURL(f),
        buf: null, outBlob: null, outName: null, info: '',
      });
    }
    alog(`Añadidos ${fs.length}. Cola: ${audQ.length}`);
    renderAud();
    for (const q of audQ.slice(-fs.length)) decodeInfo(q);
  }

  async function decodeInfo(q) {
    try {
      const ab = await q.file.arrayBuffer();
      const b = await AC().decodeAudioData(ab.slice(0));
      q.buf = b;
      q.info = `${b.duration.toFixed(1)}s · ${b.sampleRate}Hz · ${b.numberOfChannels}ch`;
      q.status = 'listo';
    } catch (e) { q.status = 'no decodificable'; q.info = String(e.message || e); }
    renderAud();
  }

  function renderAud() {
    $('audCount').textContent = audQ.length + ' en cola';
    $('audGo').disabled = !audQ.length;
    const b = $('audQueue');
    if (!audQ.length) { b.innerHTML = '<span class="hint">Cola vacía.</span>'; return; }
    b.innerHTML = '';
    for (const q of audQ) {
      const d = document.createElement('div');
      d.className = 'q';
      d.innerHTML = '<div class="badge-custom"><i class="fas fa-music"></i></div><span class="nm"></span><span class="st"></span>';
      d.querySelector('.nm').textContent = q.file.name;
      d.querySelector('.nm').title = q.file.name + ' ' + q.info;
      d.querySelector('.st').textContent = q.status + (q.info ? ' · ' + q.info : '');
      const v = document.createElement('button');
      v.className = 'btn btn-view'; v.innerHTML = '<i class="fas fa-play me-1"></i>Oír';
      v.onclick = () => { $('audPlayer').src = q.url; $('audInfo').textContent = q.file.name + ' — ' + (q.info || ''); };
      const x = document.createElement('button');
      x.className = 'btn btn-delete'; x.innerHTML = '<i class="fas fa-times"></i>';
      x.onclick = () => { audQ = audQ.filter((y) => y.id !== q.id); alog('Eliminado: ' + q.file.name); renderAud(); refreshZipBtn(); };
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

  function refreshZipBtn() {
    const done = audQ.filter((q) => q.outBlob);
    const btn = $('audZip');
    btn.disabled = !done.length;
    btn.innerHTML = done.length
      ? `<i class="fas fa-file-archive me-2"></i>Descargar todo en ZIP (${done.length})`
      : '<i class="fas fa-file-archive me-2"></i>Descargar todo en ZIP';
  }

  function wavBlob(buf) {
    const n = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length, bytes = 44 + len * n * 2;
    const ab = new ArrayBuffer(bytes), dv = new DataView(ab);
    let o = 0;
    const ws = (s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)); };
    ws('RIFF'); dv.setUint32(o, bytes - 8, true); o += 4;
    ws('WAVE'); ws('fmt '); dv.setUint32(o, 16, true); o += 4;
    dv.setUint16(o, 1, true); o += 2; dv.setUint16(o, n, true); o += 2;
    dv.setUint32(o, sr, true); o += 4; dv.setUint32(o, sr * n * 2, true); o += 4;
    dv.setUint16(o, n * 2, true); o += 2; dv.setUint16(o, 16, true); o += 2;
    ws('data'); dv.setUint32(o, len * n * 2, true); o += 4;
    const ch = [];
    for (let c = 0; c < n; c++) ch.push(buf.getChannelData(c));
    for (let i = 0; i < len; i++) for (let c = 0; c < n; c++) {
      const s = Math.max(-1, Math.min(1, ch[c][i]));
      dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function ensureLame() {
    return new Promise((res, rej) => {
      if (window.lamejs && window.lamejs.Mp3Encoder) return res();
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js';
      s.onload = () => res();
      s.onerror = () => rej(new Error('No se pudo cargar lamejs (sin internet)'));
      document.head.append(s);
    });
  }

  async function mp3Blob(buf, kbps) {
    await ensureLame();
    const n = buf.numberOfChannels, sr = buf.sampleRate;
    const enc = new lamejs.Mp3Encoder(n, sr, kbps);
    const L = buf.getChannelData(0), R = n > 1 ? buf.getChannelData(1) : null;
    const i16 = (a) => {
      const o = new Int16Array(a.length);
      for (let i = 0; i < a.length; i++) { const s = Math.max(-1, Math.min(1, a[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; }
      return o;
    };
    const l = i16(L), r = R ? i16(R) : null, data = [];
    const N = 1152;
    for (let i = 0; i < l.length; i += N) {
      const cl = l.subarray(i, i + N), cr = r ? r.subarray(i, i + N) : cl;
      const d = n > 1 ? enc.encodeBuffer(cl, cr) : enc.encodeBuffer(cl);
      if (d.length) data.push(new Int8Array(d));
    }
    const end = enc.flush();
    if (end.length) data.push(new Int8Array(end));
    return new Blob(data, { type: 'audio/mpeg' });
  }

  function pickMime() {
    const c = ['audio/ogg;codecs=opus', 'audio/ogg', 'audio/webm;codecs=opus', 'audio/webm'];
    for (const m of c) {
      try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* noop */ }
    }
    return '';
  }

  async function oggBlob(buf) {
    const mime = pickMime();
    if (!mime) throw new Error('MediaRecorder OGG no soportado en este navegador. Usa WAV.');
    const ctx = AC();
    await ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);
    const rec = new MediaRecorder(dest.stream, { mimeType: mime });
    const ch = [];
    await new Promise((res, rej) => {
      rec.ondataavailable = (e) => { if (e.data.size) ch.push(e.data); };
      rec.onstop = res; rec.onerror = rej;
      rec.start(200); src.start();
      src.onended = () => setTimeout(() => { try { rec.stop(); } catch (e) { res(); } }, 150);
      setTimeout(() => { try { rec.stop(); } catch (e) { /* noop */ } }, (buf.duration * 1000) + 1200);
    });
    const type = mime.includes('ogg') ? 'audio/ogg' : 'audio/webm';
    return { blob: new Blob(ch, { type }), isOgg: mime.includes('ogg'), mime };
  }

  $('audZip').onclick = async () => {
    const done = audQ.filter((q) => q.outBlob).map((q) => ({ name: q.outName, blob: q.outBlob }));
    const btn = $('audZip');
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Comprimiendo…';
    try {
      await downloadAsZip(done, 'bombsquad_audios.zip', alog);
    } catch (e) { alog('ZIP: ' + e.message); toast(e.message, 'danger'); }
    btn.innerHTML = old;
    refreshZipBtn();
  };

  $('audGo').onclick = async () => {
    $('audGo').disabled = true;
    $('audGo').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Convirtiendo…';
    const target = $('audTarget').value;
    let ok = 0;
    setProgress('audProgress', 0, audQ.length);
    for (let i = 0; i < audQ.length; i++) {
      const q = audQ[i];
      try {
        q.status = 'convirtiendo…'; renderAud();
        if (!q.buf) {
          const ab = await q.file.arrayBuffer();
          q.buf = await AC().decodeAudioData(ab);
        }
        const base = q.file.name.replace(/\.[^.]+$/, '');
        if (target === 'wav') { q.outBlob = wavBlob(q.buf); q.outName = base + '.wav'; }
        else if (target === 'mp3') {
          q.outBlob = await mp3Blob(q.buf, parseInt($('mp3Bitrate').value, 10));
          q.outName = base + '.mp3';
        } else {
          const r = await oggBlob(q.buf);
          q.outBlob = r.blob;
          q.outName = base + (r.isOgg ? '.ogg' : '.webm');
          if (!r.isOgg) alog('Aviso: tu navegador grabó ' + r.mime + ', se guardó .webm.');
        }
        q.status = 'OK → ' + q.outName; ok++;
        alog(`OK: ${q.file.name} → ${q.outName}`);
      } catch (e) { q.status = 'error'; alog('ERROR ' + q.file.name + ': ' + (e.message || e)); }
      renderAud(); refreshZipBtn();
      setProgress('audProgress', i + 1, audQ.length);
    }
    $('audGo').disabled = false;
    $('audGo').innerHTML = '<i class="fas fa-cog me-2"></i>Convertir audios';
    // Descarga en paquete: 1 archivo → directo, varios → un solo ZIP
    const done = audQ.filter((q) => q.outBlob);
    if (done.length === 1) {
      downloadBlob(done[0].outBlob, done[0].outName);
      alog('Lote terminado (1 archivo descargado).');
    } else if (done.length > 1) {
      alog(`Lote terminado (${ok}/${audQ.length}). Descargando paquete ZIP…`);
      try {
        await downloadAsZip(done.map((q) => ({ name: q.outName, blob: q.outBlob })), 'bombsquad_audios.zip', alog);
      } catch (e) { alog('ZIP: ' + e.message); }
    } else {
      alog('Lote terminado sin resultados.');
    }
    toast(`Audios: ${ok}/${audQ.length} convertidos.`);
  };
})();
