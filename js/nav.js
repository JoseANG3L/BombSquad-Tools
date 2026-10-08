/* Navegación por pestañas */
'use strict';
(() => {
  const secs = { nHome: 'sHome', nImg: 'sImg', nAud: 'sAud', nHelp: 'sHelp' };
  for (const [id, s] of Object.entries(secs)) {
    document.getElementById(id).onclick = () => {
      for (const b of Object.keys(secs)) document.getElementById(b).classList.remove('active');
      document.getElementById(id).classList.add('active');
      for (const x of Object.values(secs)) document.getElementById(x).classList.remove('on');
      document.getElementById(s).classList.add('on');
    };
  }
})();
