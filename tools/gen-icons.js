/*
 * One-shot generator for icons/icon{16,32,48,128}.png — no image libraries,
 * just a minimal PNG encoder (zlib is built into Node) and a procedurally
 * drawn hourglass mid-drain on a light ivory rounded square (the Paper
 * theme): sand funneling through the top bulb, a falling stream at the
 * waist, a growing pile below — memento mori, the countdown story.
 * Run: node tools/gen-icons.js
 */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---------- minimal PNG encoder (8-bit RGBA) ----------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- raster: 384px canvas, 2x2 subsamples per pixel for AA ----------

const SS = 384;
const SUB = 2;

function lerp(a, b, t) { return a + (b - a) * t; }
function hex(s) { return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]; }

const BG_TOP = hex('#f9f5ec'), BG_BOT = hex('#eae1d0');   // ivory, Paper theme
const FRAME  = hex('#6f6656');                             // warm taupe caps/outline
const GLASS  = hex('#dde2e6');                             // frosted glass tint
const SAND_TOP = hex('#d3646a'), SAND_BOT = hex('#c25056'); // soft rose, app accent

function sdRoundRect(px, py, hw, hh, r) {
  const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// Hourglass in centered coords, y down, half-extent 1. Bands by |y|:
// bars [0.27,0.40] (the caps), cones [0.075,0.27] wide at the bar and
// pinched at the waist, waist column [0,0.075].
const BAR_Y = 0.27, BAR_Y2 = 0.40, BAR_X = 0.26;
const W_Y = 0.075, W_X = 0.045, TOP_X = 0.24;

function inBars(x, y) {
  const ay = Math.abs(y);
  return ay >= BAR_Y && ay <= BAR_Y2 && Math.abs(x) <= BAR_X;
}

function inGlass(x, y) {
  const ay = Math.abs(y);
  if (ay >= BAR_Y) return false;
  if (ay >= W_Y) {
    const t = (ay - W_Y) / (BAR_Y - W_Y); // 0 at the waist, 1 at the bar
    return Math.abs(x) <= lerp(W_X, TOP_X, t);
  }
  return Math.abs(x) <= W_X;
}

// Sand mid-drain: funnel surface dipping toward the neck in the top bulb,
// a thin stream falling through the waist, dome pile in the bottom bulb.
function sandTopSurface(a) { return -0.155 + 0.06 * Math.max(0, 1 - a / 0.20); }
function sandPileSurface(a) { return 0.27 - 0.15 * Math.sqrt(Math.max(0, 1 - (a / 0.21) * (a / 0.21))); }

function inSand(x, y) {
  const a = Math.abs(x);
  if (a <= 0.016 && y >= -0.115 && y <= 0.13) return true; // stream through the neck
  if (y < -W_Y) return y >= sandTopSurface(a);             // top bulb only
  return y > 0 && y >= sandPileSurface(a);                 // bottom pile
}

function onGlassEdge(x, y) {
  const o = 0.02;
  return !(inGlass(x + o, y) && inGlass(x - o, y) && inGlass(x, y + o) && inGlass(x, y - o));
}

function raster() {
  const buf = new Uint8Array(SS * SS * 4);
  const px = 1 / SS;
  for (let y = 0; y < SS; y++) {
    for (let x = 0; x < SS; x++) {
      let r = 0, g = 0, b = 0, cov = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const nx = (x + (sx + 0.5) / SUB) / SS;
          const ny = (y + (sy + 0.5) / SUB) / SS;
          if (sdRoundRect(nx - 0.5, ny - 0.5, 0.5, 0.5, 0.19) > -px * 0.5) continue;
          cov++;
          const gx = (nx - 0.5) * 2, gy = (ny - 0.5) * 2, vy = ny;
          let c;
          if (inBars(gx, gy)) {
            c = [lerp(FRAME[0], FRAME[0] * 0.9, vy), lerp(FRAME[1], FRAME[1] * 0.9, vy), lerp(FRAME[2], FRAME[2] * 0.9, vy)];
          } else if (inGlass(gx, gy)) {
            const bg = [lerp(BG_TOP[0], BG_BOT[0], vy), lerp(BG_TOP[1], BG_BOT[1], vy), lerp(BG_TOP[2], BG_BOT[2], vy)];
            c = [lerp(bg[0], GLASS[0], 0.5), lerp(bg[1], GLASS[1], 0.5), lerp(bg[2], GLASS[2], 0.5)];
            if (inSand(gx, gy)) {
              c = [lerp(SAND_TOP[0], SAND_BOT[0], vy), lerp(SAND_TOP[1], SAND_BOT[1], vy), lerp(SAND_TOP[2], SAND_BOT[2], vy)];
            } else if (onGlassEdge(gx, gy)) {
              c = [lerp(c[0], FRAME[0], 0.55), lerp(c[1], FRAME[1], 0.55), lerp(c[2], FRAME[2], 0.55)];
            }
          } else {
            c = [lerp(BG_TOP[0], BG_BOT[0], vy), lerp(BG_TOP[1], BG_BOT[1], vy), lerp(BG_TOP[2], BG_BOT[2], vy)];
          }
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const i = (y * SS + x) * 4;
      if (!cov) continue;
      buf[i]     = Math.round(r / cov);
      buf[i + 1] = Math.round(g / cov);
      buf[i + 2] = Math.round(b / cov);
      buf[i + 3] = Math.round((cov / (SUB * SUB)) * 255);
    }
  }
  return buf;
}

// ---------- box downsample (384 → target with integer factor) ----------

function downsample(src, size) {
  const f = SS / size;
  if (!Number.isInteger(f)) throw new Error('non-integer factor for ' + size);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * SS + (x * f + dx)) * 4;
          const al = src[i + 3] / 255;
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += src[i + 3];
        }
      }
      const n = f * f;
      const aAvg = a / n / 255;
      const i = (y * size + x) * 4;
      out[i]     = Math.round(aAvg ? r / n / aAvg : 0);
      out[i + 1] = Math.round(aAvg ? g / n / aAvg : 0);
      out[i + 2] = Math.round(aAvg ? b / n / aAvg : 0);
      out[i + 3] = Math.round(a / n);
    }
  }
  return out;
}

const src = raster();
const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync('/tmp/memento-logo-preview.png', encodePNG(SS, SS, src)); // large preview
for (const size of [16, 32, 48, 128]) {
  const png = encodePNG(size, size, downsample(src, size));
  fs.writeFileSync(path.join(dir, `icon${size}.png`), png);
  console.log(`icon${size}.png  ${png.length} bytes`);
}
