/*
 * Engine test for js/ambient.js — runs the real module in a VM against a
 * recording 2D-context stub with a controllable clock (deterministic day
 * progress, midnight flips) and a manually pumped rAF queue. No browser.
 * Covers: mode lifecycle (none/paused/invalid/reduced-motion), hourglass
 * pile tracking the day + midnight flip, tide level + midnight drain,
 * ember drift, pulse sweeps + flatline, dark vs paper palettes.
 * Run: node tests/ambient.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const W = 1280, H = 800; // stub viewport

// ---------- recording 2D context ----------

function makeCtx() {
  const calls = {
    lineTo: [], fillRect: [], arc: [], drawImage: [], clearRect: [],
    stroke: 0, fill: 0, styles: [],
  };
  const gradient = { addColorStop() {} };
  return {
    globalAlpha: 1,
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '',
    clearRect(...a) { calls.clearRect.push(a); },
    fillRect(...a) { calls.fillRect.push(a); },
    drawImage(...a) { calls.drawImage.push(a); },
    lineTo(...a) { calls.lineTo.push(a); },
    arc(...a) { calls.arc.push(a); },
    beginPath() {}, closePath() {}, moveTo() {},
    stroke() { calls.stroke++; },
    fill() { calls.fill++; calls.styles.push(this.fillStyle); },
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; },
    setTransform() {},
    _calls: calls,
  };
}

// ---------- controllable clock: dayProgress() becomes deterministic ----------

function makeClock() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const state = { ms: midnight + 12 * 3600e3 }; // default: noon
  function setFakeTime(msIntoDay, addDays) {
    state.ms = midnight + (addDays ? addDays * 86400e3 : 0) + msIntoDay;
  }
  function FakeDate(y, m, d) {
    const real = arguments.length ? new Date(y, m, d) : new Date(state.ms);
    this.getTime = () => real.getTime();
    this.getFullYear = () => real.getFullYear();
    this.getMonth = () => real.getMonth();
    this.getDate = () => real.getDate();
    this.getHours = () => real.getHours();
  }
  return { state, setFakeTime, FakeDate };
}

// ---------- manually pumped rAF ----------

function makeRaf() {
  const q = [];
  const byId = new Map();
  let nextId = 1;
  let t = 1000; // persistent clock — dt must flow across pump() calls
  return {
    q,
    raf: (cb) => { const id = nextId++; byId.set(id, cb); q.push(cb); return id; },
    cancel: (id) => {
      const cb = byId.get(id);
      if (cb) {
        const i = q.indexOf(cb);
        if (i >= 0) q.splice(i, 1);
        byId.delete(id);
      }
    },
    pump(n, dtMs) {
      for (let i = 0; i < n; i++) {
        t += dtMs || 16;
        const cb = q.shift();
        if (cb) cb(t);
      }
    },
  };
}

// ---------- env ----------

const THEMES = {
  dark: { '--bg': '#08080a', '--red': '#e5484d', '--bone': '#f2eee9' },
  paper: { '--bg': '#f4f1ea', '--red': '#c62828', '--bone': '#1d1a16' },
};

function loadAmbient(opts) {
  opts = opts || {};
  const ctx = makeCtx();
  const canvas = { width: 0, height: 0, getContext: (k) => (k === '2d' ? ctx : null) };
  const tokens = THEMES[opts.theme || 'dark'];
  const clock = makeClock();
  const raf = makeRaf();
  const document = {
    getElementById: (id) => (id === 'ambient' ? canvas : null),
    createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx() }),
    body: { dataset: {} },
    addEventListener() {},
  };
  const sandbox = {
    document,
    window: { innerWidth: W, innerHeight: H, devicePixelRatio: 1, addEventListener() {} },
    getComputedStyle: () => ({ getPropertyValue: (n) => tokens[n] || '' }),
    matchMedia: () => ({ matches: !!opts.reduce }),
    requestAnimationFrame: raf.raf,
    cancelAnimationFrame: raf.cancel,
    Date: clock.FakeDate,
    Math, JSON, console, isFinite, parseFloat, parseInt,
  };
  sandbox.self = sandbox;
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ambient.js'), 'utf8');
  vm.runInNewContext(src, sandbox, { filename: 'ambient.js' });
  return { api: sandbox.MementoAmbient, ctx, canvas, clock, raf };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name); console.error(e && e.stack || e); }
}

// Points of the drawn pile/tide silhouette near a target x — the recorded
// lineTo calls are the only observable geometry the modes expose.
function ysNear(calls, xCenter, span) {
  return calls.lineTo.filter((p) => Math.abs(p[0] - xCenter) <= span).map((p) => p[1]);
}

test('lifecycle: none / paused / invalid never schedule a frame', () => {
  const a = loadAmbient();
  a.api.set('hourglass');
  assert.strictEqual(a.raf.q.length, 1);
  a.api.set('none');
  assert.strictEqual(a.raf.q.length, 0, 'switching to none stops the loop');
  assert.strictEqual(a.ctx._calls.clearRect.length, 1, 'none: canvas cleared');

  const b = loadAmbient();
  b.api.set('hourglass');
  b.raf.pump(3);
  b.api.set('hourglass', { paused: true });
  const clearsAtPause = b.ctx._calls.clearRect.length;
  assert.ok(clearsAtPause >= 1, 'paused: canvas cleared');
  b.raf.pump(5);
  assert.strictEqual(b.raf.q.length, 0, 'paused: loop stopped');
  assert.strictEqual(b.ctx._calls.clearRect.length, clearsAtPause, 'no further frames');

  const c = loadAmbient();
  c.api.set('bogus'); // invalid → treated as none, no crash
  assert.strictEqual(c.raf.q.length, 0);
});

test('lifecycle: an active mode keeps exactly one frame queued', () => {
  const a = loadAmbient();
  a.api.set('hourglass');
  assert.strictEqual(a.canvas.width, W, 'canvas sized to the viewport');
  assert.strictEqual(a.raf.q.length, 1, 'one frame scheduled');
  a.api.set('hourglass'); // idempotent — same mode, same pause state
  assert.strictEqual(a.raf.q.length, 1, 'no duplicate loop');
  a.raf.pump(5);
  assert.strictEqual(a.raf.q.length, 1, 'self-rescheduling, never more than one');
});

test('reduced motion: one static frame, never a loop', () => {
  const a = loadAmbient({ reduce: true });
  a.api.set('hourglass');
  assert.strictEqual(a.raf.q.length, 0, 'no rAF under prefers-reduced-motion');
  assert.strictEqual(a.ctx._calls.clearRect.length, 1);
  assert.ok(a.ctx._calls.lineTo.length > 0, 'the static pile still renders');
  a.raf.pump(5);
  assert.strictEqual(a.ctx._calls.clearRect.length, 1, 'pumping changes nothing');
});

test('hourglass: the pile height is the day\u2019s progress', () => {
  const a = loadAmbient();
  a.clock.setFakeTime(12 * 3600e3); // noon → 0.5 of the day
  a.api.set('hourglass');
  a.raf.pump(60); // ~1s of frames — the seeded pile converges on the target
  const crest = ysNear(a.ctx._calls, W * 0.5, 12);
  assert.ok(crest.length > 0, 'silhouette points near the centre');
  // target = H·0.16·0.5 = 64px of sand → crest y ≈ 800 − 64
  assert.ok(crest.every((y) => y > 728 && y < 744),
    'crest y ≈ 736, got ' + crest.slice(0, 4).join(', '));
  const edge = ysNear(a.ctx._calls, 40, 30);
  assert.ok(edge.every((y) => y > 790), 'no pile at the edges: ' + edge.slice(0, 3).join(', '));
});

test('hourglass: midnight flips the glass — pile flattens, sand scatters', () => {
  const a = loadAmbient();
  a.clock.setFakeTime(23 * 3600e3 + 59 * 60e3); // 23:59 → pile ≈ full
  a.api.set('hourglass');
  a.raf.pump(10);
  const before = a.ctx._calls.fillRect.length;
  assert.ok(ysNear(a.ctx._calls, W * 0.5, 12).some((y) => y < 700), 'pile built up first');

  a.ctx._calls.lineTo.length = 0; // only the post-flip geometry from here on
  a.clock.setFakeTime(10e3, 1); // next day 00:00:10
  a.raf.pump(1);
  const after = a.ctx._calls.fillRect.length;
  assert.ok(ysNear(a.ctx._calls, W * 0.5, 12).every((y) => y > 786),
    'pile flattened at the flip');
  assert.ok(after - before >= 50, 'scatter grains drawn: ' + (after - before));

  a.ctx._calls.lineTo.length = 0;
  a.raf.pump(150); // ~2.4s — the flip settles; a fresh tiny day regrows slowly
  assert.ok(ysNear(a.ctx._calls, W * 0.5, 12).every((y) => y > 786), 'still flat right after');
});

test('tide: the level rises with the day', () => {
  const a = loadAmbient();
  a.clock.setFakeTime(18 * 3600e3); // 18:00 → 0.75
  a.api.set('tide');
  a.raf.pump(30);
  const surface = ysNear(a.ctx._calls, W * 0.5, 12);
  // target level = H·0.28·0.75 = 168 → surface y ≈ 800 − 168 ± waves
  assert.ok(surface.length > 0, 'surface traced');
  assert.ok(surface.every((y) => y > 618 && y < 646),
    'surface y ≈ 632, got ' + surface.slice(0, 4).join(', '));
  assert.ok(a.ctx._calls.fill > 0, 'liquid filled');
});

test('tide: midnight drains the level back down', () => {
  const a = loadAmbient();
  a.clock.setFakeTime(23 * 3600e3); // 23:00 → high tide
  a.api.set('tide');
  a.raf.pump(10);
  assert.ok(ysNear(a.ctx._calls, W * 0.5, 12).some((y) => y < 640), 'tide high first');

  a.ctx._calls.lineTo.length = 0; // judge only the post-midnight surface
  a.clock.setFakeTime(10e3, 1);
  a.raf.pump(220); // ~3.5s of visible drain
  const surface = ysNear(a.ctx._calls, W * 0.5, 12);
  assert.ok(surface.length > 0, 'surface kept drawing');
  const recent = surface.slice(-6); // the drain is gradual — judge where it ended
  assert.ok(recent.every((y) => y > 760), 'drained near the bottom: ' + recent.join(', '));
});

test('embers: particles drift — positions change between frames', () => {
  const a = loadAmbient();
  a.api.set('embers');
  a.raf.pump(2);
  const snap = a.ctx._calls.arc.map((p) => Math.round(p[0]) + ':' + Math.round(p[1]));
  a.raf.pump(60);
  const later = a.ctx._calls.arc.slice(-snap.length)
    .map((p) => Math.round(p[0]) + ':' + Math.round(p[1]));
  assert.ok(snap.length > 20, 'a full drift of embers: ' + snap.length);
  assert.notDeepStrictEqual(later, snap, 'everything moved');
});

test('pulse: sweeps run and a flatline eventually plays', () => {
  const a = loadAmbient();
  a.api.set('pulse');
  let sawStrokeNoPen = 0;
  let sawPen = false;
  for (let i = 0; i < 2600; i++) { // ~40s — at most 5 sweeps until the flat one
    a.ctx._calls.stroke = 0;
    a.ctx._calls.arc.length = 0;
    a.raf.pump(1);
    if (a.ctx._calls.stroke > 0 && a.ctx._calls.arc.length === 0) sawStrokeNoPen++;
    if (a.ctx._calls.arc.length > 0) sawPen = true;
  }
  assert.ok(sawPen, 'the glowing pen drew beats');
  assert.ok(sawStrokeNoPen > 10, 'a full flatline sweep (no pen dot): ' + sawStrokeNoPen);
  assert.strictEqual(a.raf.q.length, 1, 'loop still healthy');
});

test('palette: paper drops the glow, dark keeps it', () => {
  const dark = loadAmbient({ theme: 'dark' });
  dark.api.set('embers');
  dark.raf.pump(10);
  assert.ok(dark.ctx._calls.drawImage.length > 0, 'dark: additive glow sprites drawn');

  const paper = loadAmbient({ theme: 'paper' });
  paper.api.set('embers');
  paper.raf.pump(10);
  assert.strictEqual(paper.ctx._calls.drawImage.length, 0, 'paper: no glow');
  assert.ok(JSON.stringify(paper.ctx._calls.styles).indexOf('29,26,22') !== -1,
    'paper: ink color used');
});

console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
