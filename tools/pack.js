/*
 * Build the Chrome Web Store upload: memento-<version>.zip at the repo root,
 * holding only what the extension runs on — no tests, store art, site or
 * tools. Fails if the manifest or newtab.html references a file that is not
 * in the package. Deterministic (fixed timestamps), no dependencies.
 * Run: node tools/pack.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p));
const list = (dir, re) => fs.readdirSync(path.join(root, dir))
  .filter((f) => re.test(f)).sort().map((f) => dir + '/' + f);

const FILES = ['manifest.json', 'newtab.html', 'css/newtab.css']
  .concat(list('js', /\.js$/), list('icons', /\.png$/));

// ---------- every reference must resolve inside the package ----------

const manifest = JSON.parse(read('manifest.json'));
const refs = new Set();
Object.values(manifest.icons || {}).forEach((p) => refs.add(p));
Object.values(manifest.chrome_url_overrides || {}).forEach((p) => refs.add(p));
const html = read('newtab.html').toString();
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (!/^(https?:|data:|#)/.test(m[1])) refs.add(m[1]);
}
const missing = Array.from(refs).filter((r) => FILES.indexOf(r) < 0 || !fs.existsSync(path.join(root, r)));
if (missing.length) {
  console.error('referenced but not packaged: ' + missing.join(', '));
  process.exit(1);
}

// ---------- minimal ZIP writer (deflate, fixed 1980-01-01 timestamps) ----------

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const locals = [];
const centrals = [];
let offset = 0;

FILES.forEach((name) => {
  const data = read(name);
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const crc = zlib.crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);           // version needed
  local.writeUInt16LE(0x0800, 6);       // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  locals.push(local, nameBuf, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);         // version made by
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + body.length;
});

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(FILES.length, 8);
end.writeUInt16LE(FILES.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const out = path.join(root, 'memento-' + manifest.version + '.zip');
fs.writeFileSync(out, Buffer.concat(locals.concat(centrals, [end])));
console.log(`wrote ${path.basename(out)}: ${FILES.length} files, ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
FILES.forEach((f) => console.log('  ' + f));
