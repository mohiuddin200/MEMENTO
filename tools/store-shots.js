/*
 * Regenerate every product image from the real UI (needs google-chrome or
 * CHROME=…): the landing page's settings crop, the store's setup crop, and
 * the five Chrome Web Store screenshots. Run: node tools/store-shots.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const file = (p) => 'file://' + path.join(root, p);
const shot = (args) => execFileSync('node', [path.join(__dirname, 'shot.js')].concat(args), { stdio: 'inherit' });

// The settings modal, opened over a saved profile so every field is filled.
const MODAL = 'newtab.html?birthday=1991-04-12&sex=male&country=USA&theme=paper';
const lastSection = "const t = document.querySelectorAll('.modal .section-title'); const sec = t[t.length - 1];";

// Landing page + store shot 3: the "Make it yours" half of the modal.
shot(['--url', file(MODAL + '&ambient=hourglass'), '--out', path.join(root, 'site/assets/customize.webp'),
  '--width', '1280', '--height', '1400', '--scale', '2',
  '--eval', "document.getElementById('gear').click();" + lastSection +
    "sec.style.borderTopColor = 'transparent'; document.querySelector('.modal .fineprint').style.visibility = 'hidden';",
  '--clip', '(() => {' + lastSection + "const m = document.querySelector('.modal').getBoundingClientRect();" +
    "const h = sec.getBoundingClientRect(); const s = document.getElementById('save').getBoundingClientRect();" +
    'const y = h.top + 15 - 28; return { x: m.left, y: y, width: m.width, height: s.bottom + 28 - y }; })()']);

// Store shot 5: the "About you" half, as a first-run card (no close button).
shot(['--url', file(MODAL + '&ambient=none'), '--out', path.join(__dirname, 'store/setup.webp'),
  '--width', '1280', '--height', '1400', '--scale', '2',
  '--eval', "document.getElementById('gear').click(); document.getElementById('modal-close').style.display = 'none';" +
    lastSection + "let n = sec; while (n && n.id !== 'save') { const next = n.nextElementSibling; n.style.display = 'none'; n = next; }" +
    "document.getElementById('save-hint').style.display = 'none';",
  '--clip', "(() => { const r = document.querySelector('.modal').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()"]);

const NAMES = ['01-countdown', '02-world-live', '03-customize', '04-shortcuts', '05-private-setup'];
NAMES.forEach((name, i) => {
  shot(['--url', file('tools/store/listing.html?n=' + (i + 1)), '--wait', '1500',
    '--eval', 'new Promise((r) => { const t = setInterval(() => { if (window.ready) { clearInterval(t); r(true); } }, 50); })',
    '--out', path.join(root, 'store/listing', name + '-1280x800.png')]);
});
