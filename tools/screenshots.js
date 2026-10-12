/*
 * Regenerate every product image from the real UI, so none can drift from it
 * (needs google-chrome or CHROME=…, Node 22+). Run: node tools/screenshots.js
 *   docs/screenshots/   README gallery — plain renders, this machine's fonts
 *   site/assets/        landing page — the site's fonts (tools/store/decorate.js)
 *   store/listing/      Chrome Web Store screenshots (tools/store/listing.html)
 * A name filter regenerates a subset: node tools/screenshots.js store
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const file = (p) => 'file://' + path.join(root, p);
const only = process.argv[2];
const shot = (out, args) => {
  if (only && out.indexOf(only) < 0) return;
  execFileSync('node', [path.join(__dirname, 'shot.js'), '--out', path.join(root, out)].concat(args), { stdio: 'inherit' });
};

// Sample profiles: README images follow a Bangladesh user, marketing a US one.
const BD = 'newtab.html?birthday=1990-06-15&sex=male&country=BGD';
const US = 'newtab.html?birthday=1991-04-12&sex=male&country=USA&theme=paper';
const FIVE = '&shortcuts=GitHub|github.com,Wikipedia|wikipedia.org,YouTube|youtube.com,Reddit|reddit.com,Figma|figma.com';

// Page-side script: inject decorate.js (favicons, optionally the site's
// fonts), then run `then` — all awaited before the shot.
const decorate = (fonts, then) => '(async () => {' +
  "await new Promise((r) => { const s = document.createElement('script');" +
  's.src = ' + JSON.stringify(file('tools/store/decorate.js')) + '; s.onload = r; document.head.appendChild(s); });' +
  'await window.MementoDecorate(document, { fonts: ' + fonts + ' });' + (then || '') + 'return true; })()';

const page = (out, q, opts) => shot(out, [
  '--url', file(q), '--width', String(opts.w || 1280), '--height', String(opts.h || 800),
  '--scale', String(opts.scale || 1), '--eval', decorate(!!opts.fonts, opts.then),
].concat(opts.clip ? ['--clip', opts.clip] : []));

// ---------- README gallery ----------

page('docs/screenshots/hero.png', BD + '&theme=midnight&ambient=nebula', {});
page('docs/screenshots/world-deaths.png', BD + '&theme=midnight&ambient=tide&hero=deaths-world', {});
page('docs/screenshots/paper.png', BD + '&theme=paper&ambient=hourglass' +
  '&shortcuts=GitHub|github.com,Wikipedia|wikipedia.org,YouTube|youtube.com,Gmail|mail.google.com', {});
page('docs/screenshots/ember.png', BD + '&theme=dawn&ambient=embers&hero=deaths-country', {});
page('docs/screenshots/first-run.png', 'newtab.html', {});
page('docs/screenshots/social-preview.png', BD + '&theme=midnight&ambient=hourglass&daybar=0', { h: 640 });

// ---------- landing page ----------

page('site/assets/newtab.webp', US + '&ambient=none' + FIVE, { fonts: true, scale: 1.5625 });
page('site/assets/world-live.webp', US + '&ambient=pulse&hero=deaths-world&scope=world', { fonts: true, scale: 1.25 });

// The settings modal, opened over the saved profile so every field is filled.
const lastSection = "const t = document.querySelectorAll('.modal .section-title'); const sec = t[t.length - 1];";

// Landing page + store shot 3: the "Make it yours" half of the modal.
page('site/assets/customize.webp', US + '&ambient=hourglass', {
  fonts: true, h: 1400, scale: 2,
  then: "document.getElementById('gear').click();" + lastSection +
    "sec.style.borderTopColor = 'transparent'; document.querySelector('.modal .fineprint').style.visibility = 'hidden';",
  clip: '(() => {' + lastSection + "const m = document.querySelector('.modal').getBoundingClientRect();" +
    "const h = sec.getBoundingClientRect(); const s = document.getElementById('save').getBoundingClientRect();" +
    'const y = h.top + 15 - 28; return { x: m.left, y: y, width: m.width, height: s.bottom + 28 - y }; })()',
});

// Store shot 5: the "About you" half, as a first-run card (no close button).
page('tools/store/setup.webp', US + '&ambient=none', {
  fonts: true, h: 1400, scale: 2,
  then: "document.getElementById('gear').click(); document.getElementById('modal-close').style.display = 'none';" +
    "Object.assign(document.querySelector('.modal').style, { borderRadius: '0', border: '0' });" + // the card rounds it
    lastSection + "let n = sec; while (n && n.id !== 'save') { const next = n.nextElementSibling; n.style.display = 'none'; n = next; }" +
    "document.getElementById('save-hint').style.display = 'none';",
  clip: "(() => { const r = document.querySelector('.modal').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()",
});

// ---------- store listing (+ the landing page's social card, = shot 1) ----------

const listing = (out, n) => shot(out, ['--url', file('tools/store/listing.html?n=' + n), '--wait', '1500',
  '--eval', 'new Promise((r) => { const t = setInterval(() => { if (window.ready) { clearInterval(t); r(true); } }, 50); })']);
['01-countdown', '02-world-live', '03-customize', '04-shortcuts', '05-private-setup'].forEach((name, i) => {
  listing('store/listing/' + name + '-1280x800.png', i + 1);
});
listing('site/assets/og.jpg', 1);
