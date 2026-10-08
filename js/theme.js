/* Sistema de tema claro / oscuro con persistencia */
'use strict';
(() => {
  const KEY = 'bst-theme';

  const getSaved = () => {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  };
  const getSystem = () => (
    window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light' : 'dark'
  );

  function current() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function paintToggle(theme) {
    const icon = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');
    const btn = document.getElementById('themeToggle');
    if (!icon || !label || !btn) return;
    const isDark = theme === 'dark';
    icon.className = isDark ? 'fas fa-sun me-2' : 'fas fa-moon me-2';
    label.textContent = isDark ? 'Claro' : 'Oscuro';
    btn.setAttribute('aria-pressed', String(!isDark));
    btn.title = isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  }

  function apply(theme, save = true) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    // Sincroniza los componentes nativos de Bootstrap 5.3
    document.documentElement.setAttribute('data-bs-theme', t);
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.append(meta);
    }
    meta.content = t === 'dark' ? '#0d1117' : '#eef2f7';
    if (save) {
      try { localStorage.setItem(KEY, t); } catch (e) { /* noop */ }
    }
    paintToggle(t);
  }

  function toggle() {
    apply(current() === 'dark' ? 'light' : 'dark');
  }

  function init() {
    // El pre-script del <head> ya aplicó el tema; aquí solo se sincroniza el botón.
    // Si no hay preferencia guardada se respeta el sistema sin escribir todavía.
    const saved = getSaved();
    apply(saved || getSystem(), false);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', toggle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.BST = window.BST || {};
  window.BST.getTheme = current;
  window.BST.setTheme = apply;
  window.BST.toggleTheme = toggle;
})();
