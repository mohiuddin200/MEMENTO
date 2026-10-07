/*
 * Memento — ambient animated backgrounds, one canvas behind the vignette
 * and grain: hourglass (the day draining as falling red sand), tide (a dark
 * level rising through the day), embers (a slow funeral drift), pulse (a
 * heartbeat trace that occasionally flatlines).
 * Theme-aware — blood-red with additive glow on dark themes, plain ink on
 * Paper. Still under prefers-reduced-motion, blank while a custom background
 * image is set (paused), zero work when hidden or set to 'none'.
 * app.js drives it via MementoAmbient.set(mode, { paused }).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MementoAmbient = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MODES = ['none', 'hourglass', 'tide', 'embers', 'pulse'];

  // "Barely there" tuning — one block so loudness is a one-line change later.
  var INTENSITY = {
    master: 0.6,           // global opacity multiplier on dark themes
    masterLight: 0.45,     // …on the light paper theme
    hourglass: {
      streamRate: 22,      // grains falling per second
      maxGrains: 220,
      moundVH: 0.16,       // tallest the day's pile gets (× viewport height)
      sigma: 0.085,        // pile spread (× viewport width)
      landHeal: 0.8,       // 1/s — how fast the surface tracks the day's target
      flipScatter: 90,     // grains flung upward at midnight
    },
    tide: {
      maxVH: 0.28,         // highest the tide reaches by 23:59 (× viewport height)
      riseLerp: 10,        // 1/s while rising with the clock
      drainLerp: 1.3,      // 1/s — the visible midnight drain
      bubbles: 6,
    },
    embers: {
      count: 80,
      ash: 0.3,            // share of falling ash flecks
    },
    pulse: {
      sweepMs: 7000,       // one left→right pass of the pen
      beatMs: 1100,        // heartbeat interval
      bandVH: 0.22,        // vertical band the trace lives in (lower screen)
      tailFade: 8.5,       // keep points long enough to span a whole sweep
      tailBright: 0.7,     // seconds of bright tail behind the pen
      fadeOut: 0.8,        // seconds a finished trace lingers before clearing
    },
  };

  // ---------- tiny utils ----------

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // '#e5484d' | '#fff' | 'rgb(..)' | 'rgba(..)' → [r, g, b]; else null.
  function parseColor(s) {
    s = String(s || '').trim();
    var m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
      return [
        parseInt(m[1].charAt(0) + m[1].charAt(0), 16),
        parseInt(m[1].charAt(1) + m[1].charAt(1), 16),
        parseInt(m[1].charAt(2) + m[1].charAt(2), 16),
      ];
    }
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
      return [
        parseInt(m[1].slice(0, 2), 16),
        parseInt(m[1].slice(2, 4), 16),
        parseInt(m[1].slice(4, 6), 16),
      ];
    }
    m = /^rgba?\(([^)]+)\)/i.exec(s);
    if (m) {
      var parts = m[1].split(',');
      if (parts.length >= 3) {
        var rgb = [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
        if (rgb.every(function (v) { return isFinite(v); })) return rgb;
      }
    }
    return null;
  }

  function rgba(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
  }

  // Fraction of the local day elapsed, ms-smooth; wraps at local midnight
  // just like stats.secondsSinceMidnight (today's counters reset at 00:00).
  function dayProgress() {
    var d = new Date();
    var midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return clamp((d.getTime() - midnight) / 86400000, 0, 1);
  }

  // ---------- engine state ----------

  var canvasEl = null, ctx = null;
  var width = 1280, height = 800, dpr = 1;
  var mode = 'none', paused = false;
  var active = null;           // mode object currently running
  var rafId = 0, lastT = 0;
  var reducedMotion = false;
  var prevProgress = 0;
  var hooked = false;

  var pal = {
    light: false,
    master: INTENSITY.master,
    red: [229, 72, 77],
    bone: [242, 238, 233],
    glow: null,                // pre-rendered radial sprite; null on paper
  };

  // The particle color: theme red on dark themes, the (dark) text ink on Paper.
  function ink() { return pal.light ? pal.bone : pal.red; }

  // Every drawn alpha passes through op() — that's the "barely there" dial.
  function op(a) { return clamp(a * pal.master, 0, 1); }

  function refreshPalette() {
    var style = null;
    try {
      if (typeof getComputedStyle === 'function' && document.body) {
        style = getComputedStyle(document.body);
      }
    } catch (e) { style = null; }
    function prop(name, fallback) {
      if (style && style.getPropertyValue) {
        var c = parseColor(style.getPropertyValue(name));
        if (c) return c;
      }
      return fallback;
    }
    var bg = prop('--bg', [8, 8, 10]);
    var lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
    pal.light = lum > 0.5;
    pal.master = pal.light ? INTENSITY.masterLight : INTENSITY.master;
    pal.red = prop('--red', [229, 72, 77]);
    pal.bone = prop('--bone', [242, 238, 233]);
    pal.glow = pal.light ? null : makeGlowSprite(pal.red);
  }

  // Pre-rendered radial glow — never shadowBlur in the per-frame loop.
  function makeGlowSprite(rgb) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    var c = document.createElement('canvas');
    if (!c.getContext) return null;
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(rgb, 0.85));
    grad.addColorStop(0.4, rgba(rgb, 0.22));
    grad.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  function drawGlow(x, y, r, alpha) {
    if (!pal.glow || !ctx.drawImage) return;
    var prev = ctx.globalCompositeOperation;
    if (!pal.light && prev !== undefined) ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(pal.glow, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
    if (prev !== undefined) ctx.globalCompositeOperation = prev || 'source-over';
  }

  function measure() {
    var w = 0, h = 0;
    if (typeof window !== 'undefined') { w = window.innerWidth; h = window.innerHeight; }
    if ((!w || !h) && typeof document !== 'undefined' && document.documentElement) {
      w = document.documentElement.clientWidth;
      h = document.documentElement.clientHeight;
    }
    width = w || 1280;
    height = h || 800;
    dpr = Math.min(1.5, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    canvasEl.width = Math.round(width * dpr);
    canvasEl.height = Math.round(height * dpr);
    if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function onResize() {
    measure();
    if (active) active.init(width, height);
    if (reducedMotion) renderStill();
  }

  function onThemeAttr() {
    if (mode === 'none' || paused || !active) return;
    refreshPalette();
    if (reducedMotion) renderStill();
  }

  function hookWatchers() {
    if (hooked) return;
    hooked = true;
    try {
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('resize', onResize);
      }
      if (typeof matchMedia === 'function') {
        var mq = matchMedia('(prefers-reduced-motion: reduce)');
        if (mq && mq.matches) reducedMotion = true;
      }
      if (typeof MutationObserver !== 'undefined' &&
          typeof document !== 'undefined' && document.body) {
        new MutationObserver(onThemeAttr).observe(document.body, {
          attributes: true, attributeFilter: ['data-theme'],
        });
      }
    } catch (e) { /* observers are best-effort */ }
  }

  function ensureCanvas() {
    if (ctx) return true;
    if (typeof document === 'undefined' || !document.getElementById) return false;
    var el = document.getElementById('ambient');
    if (!el || typeof el.getContext !== 'function') return false;
    var c = el.getContext('2d');
    if (!c) return false;
    ctx = c;
    canvasEl = el;
    measure();
    hookWatchers();
    return true;
  }

  function raf(cb) {
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(cb);
      return true;
    }
    return false;
  }

  function cancelLoop() {
    if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function frame(t) {
    rafId = 0;
    if (!active || mode === 'none' || paused) return;
    var dt = lastT ? clamp((t - lastT) / 1000, 0.001, 0.1) : 0.016;
    lastT = t;
    var p = dayProgress();
    var midnight = prevProgress > 0.9 && p < 0.1;
    prevProgress = p;
    ctx.clearRect(0, 0, width, height);
    active.step(dt, t / 1000, p, midnight);
    raf(frame);
  }

  function renderStill() {
    if (!ctx || !active) return;
    ctx.clearRect(0, 0, width, height);
    active.still(dayProgress());
  }

  function apply() {
    cancelLoop();
    active = null;
    if (mode === 'none' || paused) {
      if (ctx && ctx.clearRect) ctx.clearRect(0, 0, width, height);
      return;
    }
    if (!ctx && !ensureCanvas()) return;
    refreshPalette();
    var obj = REGISTRY[mode];
    if (!obj) return;
    active = obj;
    prevProgress = dayProgress();
    obj.init(width, height);
    if (reducedMotion) { renderStill(); return; }
    lastT = 0;
    if (!raf(frame)) renderStill(); // no rAF anywhere: degrade to a still frame
  }

  function set(m, opts) {
    if (MODES.indexOf(m) < 0) m = 'none';
    var wantPause = !!(opts && opts.paused);
    if (m === mode && wantPause === paused) return; // app.js calls on every bg change
    mode = m;
    paused = wantPause;
    apply();
  }

  // ---------- hourglass: the day draining as falling sand ----------

  var Hourglass = (function () {
    var C = INTENSITY.hourglass;
    var COLS = 150;
    var heights = [];   // pile height per column, px
    var grains = [];    // falling stream grains
    var landed = [];    // grains resting on the surface (dressing)
    var scatter = [];   // midnight flip particles
    var spawnAcc = 0;

    function targetH(x, progress) {
      var sigma = Math.max(40, width * C.sigma);
      var d = (x - width * 0.5) / sigma;
      return height * C.moundVH * progress * Math.exp(-0.5 * d * d);
    }

    function surfaceY(x) {
      var i = clamp(Math.floor((x / width) * COLS), 0, COLS - 1);
      return height - heights[i];
    }

    function init() {
      heights = []; grains = []; landed = []; scatter = []; spawnAcc = 0;
      for (var i = 0; i < COLS; i++) {
        heights.push(targetH(((i + 0.5) / COLS) * width, dayProgress()));
      }
      // Reloading mid-afternoon still shows an afternoon-sized pile dressed
      // with resting grains.
      for (var j = 0; j < 46; j++) {
        var gx = width * 0.5 + (Math.random() * 2 - 1) * width * C.sigma * 1.4 * Math.sqrt(Math.random());
        landed.push({ x: gx, j: rand(0.5, 3), s: rand(0.8, 1.6) });
      }
    }

    function step(dt, t, progress, midnight) {
      var cx = width * 0.5;

      // The pile is the day itself: it tracks % of day elapsed, so reloads
      // and missed frames never lose the story.
      for (var i = 0; i < COLS; i++) {
        var x = ((i + 0.5) / COLS) * width;
        heights[i] += (targetH(x, progress) - heights[i]) * Math.min(1, dt * C.landHeal);
      }

      // Falling stream, breathing gently.
      spawnAcc += dt * C.streamRate * (0.75 + 0.45 * Math.sin(t * 0.31));
      spawnAcc = Math.min(spawnAcc, 4);
      var wob = Math.sin(t * 1.9) * 3;
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        if (grains.length < C.maxGrains) {
          grains.push({
            x: cx + wob + rand(-1.6, 1.6), y: -3,
            vy: rand(40, 80) * (height / 800),
          });
        }
      }

      var grav = height * 0.6;
      for (var gi = grains.length - 1; gi >= 0; gi--) {
        var g = grains[gi];
        g.vy = Math.min(g.vy + grav * dt, height * 0.5);
        g.y += g.vy * dt;
        g.x += Math.sin(t * 2.6 + g.y * 0.03) * 9 * dt; // air wobble on the way down
        if (g.y >= surfaceY(g.x) - 0.5) {
          grains.splice(gi, 1);
          if (landed.length < 110) landed.push({ x: g.x, j: rand(0.5, 3), s: rand(0.8, 1.5) });
        }
      }

      // Midnight: the glass flips — the pile scatters upward and fades.
      if (midnight) {
        for (var s = 0; s < C.flipScatter; s++) {
          var sx = cx + (Math.random() * 2 - 1) * width * C.sigma * 2.4 * Math.sqrt(Math.random());
          scatter.push({
            x: sx, y: surfaceY(sx) - rand(0, 5),
            vx: rand(-26, 26), vy: rand(-height * 0.45, -height * 0.12),
            life: rand(1, 1.9),
          });
        }
        for (var k = 0; k < COLS; k++) heights[k] = 0;
        landed = []; grains = [];
      }
      for (var si = scatter.length - 1; si >= 0; si--) {
        var p = scatter[si];
        p.life -= dt;
        if (p.life <= 0) { scatter.splice(si, 1); continue; }
        p.vy += grav * 0.3 * dt; // floaty — sand defying gravity for a moment
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      draw(t);
    }

    function draw(t) {
      var cx = width * 0.5;
      var col = ink();
      var i;

      // Pile silhouette.
      ctx.beginPath();
      ctx.moveTo(0, surfaceY(0));
      for (i = 1; i < COLS; i++) ctx.lineTo(((i + 0.5) / COLS) * width, height - heights[i]);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, height * (1 - C.moundVH), 0, height);
      grad.addColorStop(0, rgba(col, op(pal.light ? 0.05 : 0.10)));
      grad.addColorStop(1, rgba(col, op(pal.light ? 0.10 : 0.20)));
      ctx.fillStyle = grad;
      ctx.fill();

      // Crest line.
      ctx.beginPath();
      ctx.moveTo(0, surfaceY(0));
      for (i = 1; i < COLS; i++) ctx.lineTo(((i + 0.5) / COLS) * width, height - heights[i]);
      ctx.strokeStyle = rgba(col, op(0.32));
      ctx.lineWidth = 1;
      ctx.stroke();

      // Resting grains ride the surface as it grows.
      ctx.fillStyle = rgba(col, op(0.5));
      for (i = 0; i < landed.length; i++) {
        var L = landed[i];
        ctx.fillRect(L.x - 0.6, surfaceY(L.x) - L.j, L.s, L.s);
      }

      // Falling stream — grains drawn as short streaks so the stream reads
      // even in a still frame.
      ctx.fillStyle = rgba(col, op(0.85));
      for (i = 0; i < grains.length; i++) {
        ctx.fillRect(grains[i].x - 0.7, grains[i].y, 1.4, 2.6);
      }

      // Midnight scatter.
      for (i = 0; i < scatter.length; i++) {
        var p = scatter[i];
        ctx.fillStyle = rgba(col, op(Math.min(1, p.life) * 0.6));
        ctx.fillRect(p.x - 0.6, p.y, 1.2, 1.2);
      }

      // Radiance: faint glow at the stream's mouth and on the pile crest.
      drawGlow(cx + Math.sin(t * 1.9) * 3, 6, 30, op(0.12));
      drawGlow(cx, surfaceY(cx) - 4, 46, op(0.10));
    }

    function still(progress) {
      for (var i = 0; i < COLS; i++) {
        heights[i] = targetH(((i + 0.5) / COLS) * width, progress);
      }
      draw(0);
    }

    return { init: init, step: step, still: still };
  })();

  // ---------- tide: a dark level rising through the day ----------

  var Tide = (function () {
    var C = INTENSITY.tide;
    var level = 0;       // displayed level, px
    var t0 = 0;          // local clock for the waves
    var bubbles = [];

    function waveAmp() { return clamp(height / 800, 0.6, 1.4); }

    function surfaceY(x, t) {
      var a = waveAmp();
      return height - level
        - (Math.sin(x * 0.011 + t * 0.62) * 2.4
          + Math.sin(x * 0.023 - t * 0.41) * 1.5
          + Math.sin(x * 0.0046 + t * 0.85 + 2.1) * 3.0) * a;
    }

    function trace(t) {
      ctx.beginPath();
      ctx.moveTo(-4, surfaceY(0, t));
      for (var x = 8; x < width; x += 8) ctx.lineTo(x, surfaceY(x, t));
      ctx.lineTo(width + 4, surfaceY(width, t));
    }

    function init() {
      level = height * C.maxVH * dayProgress();
      bubbles = [];
    }

    function step(dt, t, progress) {
      t0 += dt;
      var target = height * C.maxVH * progress;
      // Rising follows the clock; the midnight drain is slower and visible.
      var rate = target < level ? C.drainLerp : C.riseLerp;
      level += (target - level) * Math.min(1, dt * rate);
      if (Math.abs(target - level) < 0.4) level = target;

      while (bubbles.length < C.bubbles && Math.random() < 0.05) {
        bubbles.push({
          x: rand(0.12, 0.88) * width, y: height - rand(6, 50),
          r: rand(0.8, 2.2), v: rand(10, 24),
        });
      }
      for (var i = bubbles.length - 1; i >= 0; i--) {
        var b = bubbles[i];
        b.y -= b.v * dt;
        b.x += Math.sin(t0 * 1.6 + b.r * 9) * 5 * dt;
        if (b.y <= surfaceY(b.x, t0) + 2) bubbles.splice(i, 1);
      }

      draw(t0);
    }

    function draw(t) {
      var col = ink();

      // Liquid fill.
      trace(t);
      ctx.lineTo(width + 4, height + 4);
      ctx.lineTo(-4, height + 4);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, height - level - 24, 0, height);
      grad.addColorStop(0, rgba(col, op(pal.light ? 0.05 : 0.10)));
      grad.addColorStop(1, rgba(col, op(pal.light ? 0.09 : 0.19)));
      ctx.fillStyle = grad;
      ctx.fill();

      // Glowing meniscus: halo stroke under the crisp line (dark themes),
      // stretched-glow radiance along it, then the line itself.
      if (!pal.light) {
        trace(t);
        ctx.strokeStyle = rgba(col, op(0.10));
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      trace(t);
      ctx.strokeStyle = rgba(col, op(0.5));
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (pal.glow && ctx.drawImage) {
        var prev = ctx.globalCompositeOperation;
        if (prev !== undefined) ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = op(0.07);
        ctx.drawImage(pal.glow, 0, height - level - 60, width, 120);
        ctx.globalAlpha = 1;
        if (prev !== undefined) ctx.globalCompositeOperation = prev || 'source-over';
      }

      // Bubbles rising inside.
      ctx.strokeStyle = rgba(col, op(0.30));
      ctx.lineWidth = 1;
      for (var i = 0; i < bubbles.length; i++) {
        ctx.beginPath();
        ctx.arc(bubbles[i].x, bubbles[i].y, bubbles[i].r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function still(progress) {
      level = height * C.maxVH * progress;
      draw(1.25);
    }

    return { init: init, step: step, still: still };
  })();

  // ---------- embers: a slow funeral drift ----------

  var Embers = (function () {
    var C = INTENSITY.embers;
    var ps = [];

    function spawn(anywhere) {
      var ash = Math.random() < C.ash;
      var scale = height / 800;
      return {
        ash: ash,
        x: rand(0, 1) * width,
        y: anywhere ? rand(0, 1) * height : (ash ? -rand(4, 40) : height + rand(4, 40)),
        vy: (ash ? rand(9, 22) : -rand(7, 22)) * scale,
        sway: rand(8, 22),
        phase: rand(0, Math.PI * 2),
        freq: rand(0.35, 1.0),
        size: ash ? rand(0.8, 1.5) : rand(1.1, 2.6),
        flick: rand(1.8, 4.5),
      };
    }

    function init() {
      ps = [];
      for (var i = 0; i < C.count; i++) ps.push(spawn(true));
    }

    function step(dt, t) {
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        p.y += p.vy * dt;
        p.x += Math.sin(t * p.freq + p.phase) * p.sway * dt;
        if (p.ash ? p.y > height + 6 : p.y < -6) ps[i] = spawn(false);
      }
      draw(t);
    }

    function draw(t) {
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        // Soft edge fade so particles appear and vanish gently.
        var edge = clamp(Math.min(p.y, height - p.y) / 80, 0, 1);
        if (p.ash) {
          ctx.fillStyle = rgba(ink(), op(0.28 * edge));
          ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
        } else {
          var flick = 0.55 + 0.45 * Math.sin(t * p.flick + p.phase);
          if (!pal.light) drawGlow(p.x, p.y, p.size * 5.5, op(0.16 * flick * edge));
          ctx.fillStyle = rgba(pal.light ? ink() : pal.red, op(0.8 * flick * edge));
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function still() { draw(1.0); }

    return { init: init, step: step, still: still };
  })();

  // ---------- pulse: a heartbeat trace that occasionally flatlines ----------

  var Pulse = (function () {
    var C = INTENSITY.pulse;
    var pts = [];        // {x, y, t} trace behind the pen
    var dying = null;    // finished sweep, fading out
    var dyingT = 0;
    var sweepMs = 0;
    var sinceBeat = 0;
    var beatEnv = 0;     // breathing-glow envelope, 1 at each beat
    var sweeps = 0;
    var flatline = false;
    var nextFlat = 3;

    function baseY() { return height * (1 - C.bandVH * 0.5); }
    function amp() { return height * 0.0016; }

    // One heartbeat, seconds since it started: p bump — QRS spike — t wave.
    function beatY(bt) {
      if (bt < 0.09) return Math.sin((bt / 0.09) * Math.PI) * 3;
      if (bt < 0.15) return 0;
      if (bt < 0.20) return -((bt - 0.15) / 0.05) * 4;
      if (bt < 0.26) return -4 + ((bt - 0.20) / 0.06) * 40;
      if (bt < 0.32) return 36 - ((bt - 0.26) / 0.06) * 52;
      if (bt < 0.38) return -16 + ((bt - 0.32) / 0.06) * 16;
      if (bt < 0.50) return 0;
      if (bt < 0.72) return Math.sin(((bt - 0.50) / 0.22) * Math.PI) * 5;
      return 0;
    }

    function yAt(bt) { return baseY() - beatY(bt) * amp(); }

    function resetSweep(t) {
      dying = pts;
      dyingT = t;
      pts = [];
      sweepMs = 0;
      sweeps++;
      if (flatline) {
        // The flat sweep has played out — back to beating.
        flatline = false;
        sweeps = 0;
        nextFlat = 3 + Math.floor(Math.random() * 3);
        sinceBeat = rand(0, 0.3);
      } else if (sweeps >= nextFlat) {
        flatline = true;
        sinceBeat = 9; // dead value: past every wave of the beat shape
      }
    }

    function init() {
      pts = []; dying = null; dyingT = 0; sweepMs = 0; sinceBeat = 0;
      beatEnv = 0; sweeps = 0; flatline = false;
      nextFlat = 3 + Math.floor(Math.random() * 3);
    }

    function step(dt, t) {
      sweepMs += dt * 1000;
      var penX = (sweepMs / C.sweepMs) * (width + 60) - 30;
      if (!flatline) {
        sinceBeat += dt;
        var beat = C.beatMs / 1000;
        if (sinceBeat >= beat) { sinceBeat -= beat; beatEnv = 1; }
      }
      beatEnv = Math.max(0, beatEnv - dt * 2.4);
      var penY = flatline ? baseY() : yAt(sinceBeat);
      pts.push({ x: penX, y: penY, t: t });
      while (pts.length && t - pts[0].t > C.tailFade) pts.shift();
      if (penX > width + 30) resetSweep(t);
      draw(t, penX, penY);
    }

    function strokePts(arr, from, to, style, lw) {
      if (to - from < 2) return;
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(arr[from].x, arr[from].y);
      for (var i = from + 1; i < to; i++) ctx.lineTo(arr[i].x, arr[i].y);
      ctx.stroke();
    }

    function draw(t, penX, penY) {
      var col = ink();
      var dim = flatline ? 1 - 0.55 * clamp(penX / width, 0, 1) : 1;

      if (dying) {
        var age = (t - dyingT) / C.fadeOut;
        if (age >= 1) dying = null;
        else strokePts(dying, 0, dying.length, rgba(col, op(0.16 * (1 - age))), 1.2);
      }

      // Whole sweep faint, then a bright tail right behind the pen.
      strokePts(pts, 0, pts.length, rgba(col, op(0.16 * dim)), 1.2);
      var from = pts.length - 1;
      while (from > 0 && t - pts[from].t < C.tailBright) from--;
      strokePts(pts, from, pts.length, rgba(col, op(0.55 * dim)), 1.4);

      if (!flatline) {
        drawGlow(penX, penY, 20, op(0.20));
        ctx.fillStyle = rgba(col, op(0.9));
        ctx.beginPath();
        ctx.arc(penX, penY, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // The room breathes with each beat (dark themes only).
      if (!pal.light && pal.glow && ctx.drawImage) {
        var prev = ctx.globalCompositeOperation;
        if (prev !== undefined) ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = op(0.05 + 0.10 * beatEnv);
        ctx.drawImage(pal.glow, -width * 0.05, baseY() - height * 0.30, width * 1.1, height * 0.60);
        ctx.globalAlpha = 1;
        if (prev !== undefined) ctx.globalCompositeOperation = prev || 'source-over';
      }
    }

    function still() {
      // One printed strip: beats every beatMs across the full width.
      pts = [];
      var sweepSec = C.sweepMs / 1000;
      var n = 300;
      var bt = 0;
      for (var i = 0; i <= n; i++) {
        pts.push({ x: (i / n) * width, y: yAt(bt), t: 0 });
        bt += sweepSec / n;
        if (bt >= C.beatMs / 1000) bt -= C.beatMs / 1000;
      }
      flatline = false;
      draw(0, width + 40, baseY());
    }

    return { init: init, step: step, still: still };
  })();

  // ---------- registry ----------

  var REGISTRY = {
    hourglass: Hourglass,
    tide: Tide,
    embers: Embers,
    pulse: Pulse,
  };

  return { set: set, MODES: MODES.slice() };
});
