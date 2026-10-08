/* Config global + helpers compartidos */
'use strict';

window.BST = window.BST || {};

const $ = (id) => document.getElementById(id);
window.BST.$ = $;

window.BST.ilog = (m) => {
  const el = $('imgLog');
  if (!el) return;
  el.textContent += m + '\n';
  el.scrollTop = el.scrollHeight;
};

window.BST.alog = (m) => {
  const el = $('audLog');
  if (!el) return;
  el.textContent += m + '\n';
  el.scrollTop = el.scrollHeight;
};

window.BST.toast = (msg, type = 'success') => {
  const box = $('toasts');
  if (!box) return;
  const icon = type === 'success' ? 'fa-check-circle text-success'
    : type === 'danger' ? 'fa-exclamation-circle text-danger'
    : 'fa-info-circle text-primary';
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const el = document.createElement('div');
  el.className = 'toast align-items-center show';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="d-flex">
      <div class="toast-body"><i class="fas ${icon} me-2"></i>${msg}</div>
      <button type="button" class="btn-close ${isLight ? '' : 'btn-close-white'} me-2 m-auto" aria-label="Close"></button>
    </div>`;
  el.querySelector('button').onclick = () => el.remove();
  box.append(el);
  setTimeout(() => el.remove(), 4500);
};

window.BST.setProgress = (barId, done, total) => {
  const bar = $(barId);
  if (!bar) return;
  const pct = total ? Math.round((done / total) * 100) : 0;
  bar.style.width = pct + '%';
  bar.textContent = total ? `${done}/${total} (${pct}%)` : '';
  bar.setAttribute('aria-valuenow', pct);
};

window.BST.downloadBlob = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
};

/* Asegura que JSZip esté disponible (CDN). Lo carga bajo demanda. */
window.BST.ensureJSZip = () => new Promise((resolve, reject) => {
  if (window.JSZip) return resolve();
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  s.onload = () => resolve();
  s.onerror = () => reject(new Error('No se pudo cargar JSZip (revisa tu conexión).'));
  document.head.append(s);
});

/* Descarga un conjunto de Blobs como un único .zip */
window.BST.downloadAsZip = async (files, zipName, logFn) => {
  if (!files.length) throw new Error('No hay archivos convertidos para empaquetar.');
  await window.BST.ensureJSZip();
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  logFn?.(`Comprimiendo ${files.length} archivo(s) en ${zipName}…`);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  window.BST.downloadBlob(blob, zipName);
  logFn?.(`ZIP listo: ${zipName} (${(blob.size / 1024).toFixed(1)} KB)`);
  window.BST.toast(`<b>${zipName}</b> descargado con ${files.length} archivo(s).`);
};
