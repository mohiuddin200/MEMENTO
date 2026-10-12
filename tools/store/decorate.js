/*
 * Injected into a rendered newtab.html for product shots (by
 * tools/screenshots.js and tools/store/listing.html):
 * - favicons: headless Chrome has no favicon cache, so shortcut chips get
 *   the icons in tools/store/icons/ (letter tile when there is none);
 * - fonts: the landing page's typefaces in place of the render machine's
 *   system fonts — Gelasio (Georgia's metrics) for numerals and Inter for
 *   text, so marketing images look like the app on a Mac or Windows PC.
 */
(function () {
var SELF = document.currentScript ? document.currentScript.src : location.href;

window.MementoDecorate = function (doc, opts) {
  var here = function (p) { return new URL(p, SELF).href; };

  if (opts && opts.fonts) {
    var style = doc.createElement('style');
    style.textContent =
      "@font-face { font-family: Georgia; src: url('" + here('../../site/fonts/gelasio.woff2') + "') format('woff2'); font-weight: 400 700; }\n" +
      "@font-face { font-family: 'Memento Inter'; src: url('" + here('../../site/fonts/inter.woff2') + "') format('woff2'); font-weight: 100 900; }\n" +
      "body { font-family: 'Memento Inter', sans-serif; }";
    doc.head.appendChild(style);
  }

  var known = ['github', 'wikipedia', 'youtube', 'reddit', 'figma'];
  doc.querySelectorAll('.sc-chip').forEach(function (chip) {
    var name = chip.querySelector('.sc-name').textContent.toLowerCase();
    if (known.indexOf(name) >= 0) chip.querySelector('.sc-ico').src = here('icons/' + name + '.png');
  });

  // Declared faces load lazily; ask for them so the shot waits on real glyphs.
  if (!(opts && opts.fonts) || !doc.fonts) return true;
  return Promise.all([
    doc.fonts.load('400 40px Georgia'), doc.fonts.load('italic 400 20px Georgia'),
    doc.fonts.load("400 16px 'Memento Inter'"), doc.fonts.load("700 16px 'Memento Inter'"),
  ]).then(function () { return doc.fonts.ready; }).then(function () { return true; });
};
})();
