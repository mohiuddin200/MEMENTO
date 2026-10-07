/*
 * Interaction test for js/app.js — runs the real app code against a minimal
 * DOM stub in Node (no browser, no network: fetch is stubbed to reject, so
 * the app runs on the offline baseline, re-verifying that path end-to-end).
 * Covers: first-run modal, calendar picker, country search, save flow,
 * themes (preview + revert), hero stat modes, background image, persistence.
 * Run: node tests/app.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------- minimal DOM ----------

class El {
  constructor(tag, attrs) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.attributes = Object.assign({}, attrs);
    this.textContent = '';
    this.handlers = {};
    this.dataset = {};
    this.classList = {
      _set: new Set(),
      add(...c) { c.forEach((x) => this._set.add(x)); },
      remove(...c) { c.forEach((x) => this._set.delete(x)); },
      toggle(c, force) {
        const on = force === undefined ? !this._set.has(c) : force;
        on ? this._set.add(c) : this._set.delete(c);
        return on;
      },
      contains(c) { return this._set.has(c); },
    };
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.type = '';
  }
  set className(v) {
    this.classList._set.clear();
    String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList._set.add(c));
  }
  get className() { return Array.from(this.classList._set).join(' '); }
  set innerHTML(h) { if (h === '') this.children = []; }
  get innerHTML() { return ''; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  matches(sel) {
    const m = /^([a-z]+)\[([a-z-]+)\]$/.exec(sel);
    if (m) return this.tagName === m[1].toUpperCase() && m[2] in this.attributes;
    return false;
  }
  closest(sel) {
    let n = this;
    while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; }
    return null;
  }
  addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
  fire(type, ev) {
    const e = Object.assign({ target: this, preventDefault() {}, stopPropagation() { e._stop = true; } }, ev);
    let node = this;
    while (node) {
      (node.handlers[type] || []).forEach((fn) => fn(e));
      node = e._stop ? null : node.parentNode;
    }
  }
  click() { this.fire('click'); }
  focus() {}
  scrollIntoView() {}
}

const IDS = ['page', 'bgimg', 'days-left', 'days-label', 'hms', 'le-note', 'oneliner', 'lived',
  'alt-days', 'alt-dot', 'days-lived', 'secs-lived', 'progress-fill', 'deaths-sec',
  'births-today', 'deaths-today', 'net-today', 'data-badge', 'modal-backdrop',
  'f-birthday', 'cal', 'cal-title', 'cal-days', 'cal-prev', 'cal-next', 'cal-prevy', 'cal-nexty',
  'f-sex', 'f-theme', 'f-hero', 'f-country', 'country-list', 'f-bg-file', 'f-bg-upload',
  'f-bg-remove', 'f-le', 'le-auto-hint', 'f-scope', 'scope-btn', 'save', 'gear',
  'daybar', 'daybar-fill', 'daybar-label', 'f-daybar', 'f-ambient',
  'shortcuts', 'sc-row', 'sc-pop', 'sc-name', 'sc-url', 'sc-err', 'sc-save', 'sc-cancel'];

function buildDom() {
  const byId = {};
  IDS.forEach((id) => (byId[id] = new El('div', { id })));
  byId['modal-backdrop'].hidden = true; // matches the hidden attribute in newtab.html
  byId['cal'].hidden = true;
  byId['sc-pop'].hidden = true;
  byId['daybar'].hidden = true; // matches the hidden attribute in newtab.html
  byId['f-le-years'] = new El('input', { id: 'f-le-years' });
  byId['f-le-years'].hidden = true; // matches the hidden attribute in newtab.html
  const maleBtn = new El('button', { 'data-sex': 'male' });
  const femaleBtn = new El('button', { 'data-sex': 'female' });
  byId['f-sex'].appendChild(maleBtn);
  byId['f-sex'].appendChild(femaleBtn);
  ['auto', 'custom'].forEach((m) =>
    byId['f-le'].appendChild(new El('button', { 'data-le': m })));
  ['country', 'world'].forEach((s) =>
    byId['f-scope'].appendChild(new El('button', { 'data-scope': s })));
  ['on', 'off'].forEach((v) =>
    byId['f-daybar'].appendChild(new El('button', { 'data-daybar': v })));
  ['none', 'hourglass', 'tide', 'embers', 'pulse'].forEach((v) =>
    byId['f-ambient'].appendChild(new El('button', { 'data-ambient': v })));
  ['midnight', 'dusk', 'ember', 'paper'].forEach((t) =>
    byId['f-theme'].appendChild(new El('button', { 'data-theme-swatch': t })));
  ['days-left', 'deaths-country', 'deaths-world'].forEach((h) =>
    byId['f-hero'].appendChild(new El('button', { 'data-hero': h })));
  byId.buttons = { maleBtn, femaleBtn };
  return byId;
}

function makeEnv(byId, storageBacking, search) {
  const document = {
    readyState: 'complete',
    body: new El('body'),
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => new El(tag),
    addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
    handlers: {},
  };
  const localStorage = {
    _back: storageBacking,
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._back, k) ? this._back[k] : null; },
    setItem(k, v) { this._back[k] = String(v); },
  };
  let intervalCb = null;
  const ambientCalls = []; // app.js → MementoAmbient.set() recorder
  const sandboxGlobals = {
    document,
    localStorage,
    location: { search: search || '' },
    navigator: { language: 'en-US' },
    setInterval: (fn) => { intervalCb = fn; return 1; },
    setTimeout: (fn) => { fn(); return 1; },
    URLSearchParams,
    URL, // app.js parses shortcut URLs with new URL()
    Date,
    Math,
    JSON,
    Promise,
    console,
    window: {},
  };
  sandboxGlobals.window.MementoAmbient = {
    set: (m, opts) => ambientCalls.push({ mode: m, paused: !!(opts && opts.paused) }),
  };
  return { document, localStorage, interval: () => intervalCb(), ambientCalls, sandboxGlobals };
}

function loadApp(sandboxGlobals) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  // api.js reads the baseline from the ambient global in the Node realm.
  globalThis.MementoBaseline = require('../js/baseline.js').MementoBaseline;
  sandboxGlobals.window.MementoStats = require('../js/stats.js');
  sandboxGlobals.window.MementoApi = require('../js/api.js');
  vm.runInNewContext(src, sandboxGlobals, { filename: 'app.js' });
}

const flush = () => new Promise((r) => setTimeout(r, 5));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('FAIL  ' + name); console.error(e && e.stack || e); }
}

// Navigate the calendar to a target year/month using the year/month nav buttons.
function calGoTo(byId, year, month) {
  const now = new Date();
  let months = (now.getFullYear() - year) * 12 + (now.getMonth() - month);
  while (months <= -12) { byId['cal-nexty'].click(); months += 12; }
  while (months >= 12) { byId['cal-prevy'].click(); months -= 12; }
  while (months > 0) { byId['cal-prev'].click(); months--; }
  while (months < 0) { byId['cal-next'].click(); months++; }
}
const calDay = (byId, iso) =>
  byId['cal-days'].children.find((b) => b.getAttribute('data-d') === iso);

// Depth-first search for elements carrying a class, across the stub tree.
function findAll(root, cls, out = []) {
  (root.children || []).forEach((c) => {
    if (c.classList.contains(cls)) out.push(c);
    findAll(c, cls, out);
  });
  return out;
}

(async () => {
  // Global fetch rejects: the app must survive on baseline data.
  globalThis.fetch = () => Promise.reject(new Error('offline test'));
  const storageBacking = {};
  const byId = buildDom();
  const env = makeEnv(byId, storageBacking);

  loadApp(env.sandboxGlobals);
  await flush(); // let init()'s storage.read + Api.load settle

  await test('first run: modal open, page dimmed, world rates live, midnight default', () => {
    assert.strictEqual(byId['modal-backdrop'].hidden, false);
    assert.ok(byId.page.classList.contains('nouser'));
    assert.strictEqual(env.document.body.dataset.theme, 'midnight');
    assert.strictEqual(byId['country-list'].children.length, 60, 'list populated (capped 60)');
    assert.strictEqual(byId['country-list'].children[0].children[0].textContent, 'World', 'World pinned first');
    assert.ok(/^\d+\.\d{2}$/.test(byId['deaths-sec'].textContent), 'world deaths/sec: ' + byId['deaths-sec'].textContent);
    assert.ok(/offline baseline/.test(byId['data-badge'].textContent), byId['data-badge'].textContent);
    assert.strictEqual(byId.save.disabled, true, 'save disabled until complete');
  });

  await test('calendar: opens with 42 cells, future days disabled', () => {
    byId['f-birthday'].click();
    assert.strictEqual(byId['cal'].hidden, false, 'calendar opens');
    assert.strictEqual(byId['cal-days'].children.length, 42);
    const last = byId['cal-days'].children[41];
    assert.strictEqual(last.disabled, true, 'future days are disabled');
  });

  await test('calendar: navigate to June 1990 and pick the 15th', () => {
    calGoTo(byId, 1990, 5); // month 5 = June
    assert.ok(/June 1990/.test(byId['cal-title'].textContent), 'title: ' + byId['cal-title'].textContent);
    const day = calDay(byId, '1990-06-15');
    assert.ok(day, 'June 15 cell rendered');
    day.click();
    assert.strictEqual(byId['f-birthday'].value, '1990-06-15');
    assert.ok(/Jun 15, 1990/.test(byId['f-birthday'].textContent), 'field shows: ' + byId['f-birthday'].textContent);
    assert.strictEqual(byId['cal'].hidden, true, 'calendar closes on pick');
  });

  await test('sex + country: search narrows and completes the form', () => {
    byId.buttons.maleBtn.click();
    assert.strictEqual(byId.save.disabled, false, 'complete (country guessed as World)');

    byId['f-country'].value = 'bangla';
    byId['f-country'].fire('input');
    assert.strictEqual(byId.save.disabled, true, 'typing invalidates the country pick');
    const opts = byId['country-list'].children;
    assert.strictEqual(opts.length, 1, 'search narrows to 1');
    assert.strictEqual(opts[0].children[0].textContent, 'Bangladesh');
    opts[0].click();
    assert.strictEqual(byId['f-country'].value, 'Bangladesh');
    assert.strictEqual(byId.save.disabled, false, 'save enabled when complete');
  });

  await test('save: closes modal, persists full settings shape, hero renders', async () => {
    byId.save.click();
    assert.strictEqual(byId['modal-backdrop'].hidden, true);
    assert.ok(!byId.page.classList.contains('nouser'));
    const stored = JSON.parse(storageBacking['memento.settings']);
    assert.deepStrictEqual(stored, {
      birthday: '1990-06-15', sex: 'male', country: 'BGD',
      theme: 'midnight', hero: 'days-left', bg: null,
      scope: 'country', customLE: null, daybar: true, ambient: 'hourglass',
    });
    assert.ok(/^\d{1,2},\d{3}$/.test(byId['days-left'].textContent), 'days left: ' + byId['days-left'].textContent);
    assert.ok(/^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(byId.hms.textContent), 'hms with ms: ' + byId.hms.textContent);
    assert.strictEqual(byId['days-label'].textContent, 'days left');
    assert.strictEqual(byId['alt-days'].textContent, '', 'days-left mode: no inline days');
    assert.ok(byId.oneliner.textContent.length > 10, 'one-liner shown');
    assert.ok(/Bangladesh \u00b7 world avg/.test(byId['data-badge'].textContent), byId['data-badge'].textContent);
    assert.ok(parseFloat(byId['progress-fill'].style.width) > 0, 'progress bar width set');
  });

  await test('auto expectancy: hero states the average behind the countdown', () => {
    // BGD has no per-country numbers in the offline baseline → world average is used.
    assert.ok(/average for a man worldwide: 71\.1 years/.test(byId['le-note'].textContent),
      'le-note: ' + byId['le-note'].textContent);
  });

  await test('day bar: on by default, label matches the local day fraction', () => {
    assert.strictEqual(byId.daybar.hidden, false, 'visible once settings exist');
    const S = require('../js/stats.js');
    const pct = S.dayFraction(Date.now()) * 100;
    const shown = parseFloat(byId['daybar-label'].textContent.replace(/[^\d.]/g, ''));
    assert.ok(Math.abs(shown - pct) < 0.2, `label ${shown} vs fraction ${pct.toFixed(1)}`);
    assert.ok(/^today \u00b7 \d+(\.\d)?% spent$/.test(byId['daybar-label'].textContent),
      byId['daybar-label'].textContent);
    const width = parseFloat(byId['daybar-fill'].style.width);
    assert.ok(Math.abs(width - pct) < 0.2, `fill width ${width} vs ${pct.toFixed(3)}`);
  });

  await test('life expectancy: custom 80-year estimate overrides the average', () => {
    byId.gear.click();
    assert.ok(/avg 71\.1y \u00b7 man worldwide/.test(byId['le-auto-hint'].textContent),
      'hint shows the auto average: ' + byId['le-auto-hint'].textContent);
    byId['f-le'].children[1].click(); // My own estimate
    assert.strictEqual(byId['f-le-years'].hidden, false, 'number input appears');
    byId['f-le-years'].value = '80';
    byId['f-le-years'].fire('input');
    assert.strictEqual(byId.save.disabled, false, 'valid estimate keeps save enabled');
    byId.save.click();
    assert.strictEqual(JSON.parse(storageBacking['memento.settings']).customLE, 80);

    const S = require('../js/stats.js');
    const expected = S.countdown('1990-06-15', 80, Date.now()).days;
    const shown = parseInt(byId['days-left'].textContent.replace(/,/g, ''), 10);
    assert.ok(Math.abs(shown - expected) <= 1, `days at 80y: ${shown} vs ${expected}`);
    assert.ok(/your estimate \u00b7 80 years/.test(byId['le-note'].textContent),
      byId['le-note'].textContent);
  });

  await test('custom estimate: invalid value blocks save, dismissing keeps the saved one', () => {
    byId.gear.click();
    byId['f-le'].children[1].click();
    byId['f-le-years'].value = '999';
    byId['f-le-years'].fire('input');
    assert.strictEqual(byId.save.disabled, true, 'out-of-range estimate blocks save');
    byId['f-le'].children[0].click(); // back to World Bank average
    assert.strictEqual(byId.save.disabled, false);
    byId['modal-backdrop'].fire('click'); // dismiss → the saved 80y estimate stays
    assert.ok(/your estimate \u00b7 80 years/.test(byId['le-note'].textContent),
      'unsaved auto switch did not change the saved estimate');
  });

  await test('bottom numbers: pill toggles the rates row between country and world', () => {
    assert.ok(/^showing: Bangladesh/.test(byId['scope-btn'].textContent), byId['scope-btn'].textContent);
    byId['scope-btn'].click();
    assert.ok(/^showing: World/.test(byId['scope-btn'].textContent), byId['scope-btn'].textContent);
    assert.strictEqual(JSON.parse(storageBacking['memento.settings']).scope, 'world');
    const S = require('../js/stats.js');
    const world = globalThis.MementoBaseline.world;
    const expected = S.perSecond(world.deathRate, world.population);
    assert.ok(Math.abs(parseFloat(byId['deaths-sec'].textContent) - expected) < 0.005,
      'world deaths/sec: ' + byId['deaths-sec'].textContent);
    byId['scope-btn'].click();
    assert.ok(/^showing: Bangladesh/.test(byId['scope-btn'].textContent));
    assert.strictEqual(JSON.parse(storageBacking['memento.settings']).scope, 'country');
  });

  await test('bottom numbers: modal segmented previews live and reverts on dismiss', () => {
    byId.gear.click();
    byId['f-scope'].children[1].click(); // World
    assert.ok(/^showing: World/.test(byId['scope-btn'].textContent), 'live preview applied');
    byId['modal-backdrop'].fire('click');
    assert.ok(/^showing: Bangladesh/.test(byId['scope-btn'].textContent), 'reverted to saved');
  });

  await test('day bar: Hide preview removes it, dismiss reverts, save persists off', () => {
    byId.gear.click();
    byId['f-daybar'].children[1].click(); // Hide
    assert.strictEqual(byId.daybar.hidden, true, 'live preview hides the bar');
    byId['modal-backdrop'].fire('click');
    assert.strictEqual(byId.daybar.hidden, false, 'reverted to shown');
    assert.strictEqual(JSON.parse(storageBacking['memento.settings']).daybar, true,
      'dismiss persisted nothing');
    byId.gear.click();
    byId['f-daybar'].children[1].click(); // Hide again
    byId.save.click();
    assert.strictEqual(byId.daybar.hidden, true, 'stays hidden after save');
    assert.strictEqual(JSON.parse(storageBacking['memento.settings']).daybar, false);
    byId.gear.click();
    byId['f-daybar'].children[0].click(); // Show it again for later tests
    byId.save.click();
    assert.strictEqual(byId.daybar.hidden, false);
  });

  await test('ticker: one interval tick advances lived-seconds', async () => {
    const before = byId['secs-lived'].textContent;
    await new Promise((r) => setTimeout(r, 1100));
    env.interval();
    assert.notStrictEqual(byId['secs-lived'].textContent, before, 'lived seconds ticked');
  });

  await test('theme: preview applies instantly, save persists it', () => {
    byId.gear.click();
    assert.strictEqual(byId['modal-backdrop'].hidden, false);
    byId['f-theme'].children[1].click(); // dusk
    assert.strictEqual(env.document.body.dataset.theme, 'dusk', 'live preview applied');
    byId.save.click();
    assert.strictEqual(JSON.parse(storageBacking['memento.settings']).theme, 'dusk');
    assert.strictEqual(env.document.body.dataset.theme, 'dusk', 'stays dusk after save');
  });

  await test('theme: dismissing the modal reverts an unsaved preview', () => {
    byId.gear.click();
    byId['f-theme'].children[3].click(); // paper
    assert.strictEqual(env.document.body.dataset.theme, 'paper');
    byId['modal-backdrop'].fire('click'); // dismiss without saving
    assert.strictEqual(byId['modal-backdrop'].hidden, true);
    assert.strictEqual(env.document.body.dataset.theme, 'dusk', 'reverted to saved theme');
  });

  await test('ambient: defaults to hourglass, previews live, reverts on dismiss', () => {
    assert.deepStrictEqual(env.ambientCalls[0], { mode: 'hourglass', paused: false },
      'boot applies the default');
    byId.gear.click();
    byId['f-ambient'].children[2].click(); // tide
    assert.deepStrictEqual(env.ambientCalls[env.ambientCalls.length - 1],
      { mode: 'tide', paused: false }, 'live preview applied');
    assert.ok(byId['f-ambient'].children[2].classList.contains('selected'));
    byId['modal-backdrop'].fire('click');
    assert.deepStrictEqual(env.ambientCalls[env.ambientCalls.length - 1],
      { mode: 'hourglass', paused: false }, 'reverted to saved');
  });

  await test('ambient: save persists the pick, back to the default afterwards', () => {
    byId.gear.click();
    byId['f-ambient'].children[4].click(); // pulse
    byId.save.click();
    assert.strictEqual(JSON.parse(storageBacking['memento.settings']).ambient, 'pulse');
    assert.deepStrictEqual(env.ambientCalls[env.ambientCalls.length - 1],
      { mode: 'pulse', paused: false }, 'saved mode applied');
    byId.gear.click();
    byId['f-ambient'].children[1].click(); // hourglass again for the tests that follow
    byId.save.click();
    assert.strictEqual(JSON.parse(storageBacking['memento.settings']).ambient, 'hourglass');
  });

  await test('hero mode: world deaths today as the big number', () => {
    byId.gear.click();
    byId['f-hero'].children[2].click(); // deaths-world
    byId.save.click();
    const stored = JSON.parse(storageBacking['memento.settings']);
    assert.strictEqual(stored.hero, 'deaths-world');

    const S = require('../js/stats.js');
    const world = globalThis.MementoBaseline.world;
    const expected = S.perSecond(world.deathRate, world.population) * S.secondsSinceMidnight(Date.now());
    const shown = parseInt(byId['days-left'].textContent.replace(/,/g, ''), 10);
    assert.ok(Math.abs(shown - expected) <= 3, `big number ≈ world deaths today (${shown} vs ${Math.round(expected)})`);
    assert.ok(/deaths today \u00b7 World/.test(byId['days-label'].textContent), byId['days-label'].textContent);
    assert.ok(/every second/.test(byId.hms.textContent), 'sub-counter: ' + byId.hms.textContent);
    assert.ok(/^\d{1,2},\d{3}$/.test(byId['alt-days'].textContent), 'days-left moved inline: ' + byId['alt-days'].textContent);
  });

  await test('background image: applied from stored settings, removable, reverts on dismiss', async () => {
    // Fresh env with a saved background.
    const bgData = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const bgStore = { 'memento.settings': JSON.stringify({
      birthday: '1990-06-15', sex: 'male', country: 'BGD',
      theme: 'dusk', hero: 'days-left', bg: bgData,
    }) };
    const byId2 = buildDom();
    const env2 = makeEnv(byId2, bgStore);
    loadApp(env2.sandboxGlobals);
    await flush();
    assert.ok(env2.document.body.classList.contains('hasbg'), 'body flagged as having a background');
    assert.ok(byId2.bgimg.style.backgroundImage.indexOf(bgData) !== -1, 'image set on the layer');

    byId2.gear.click();
    assert.strictEqual(byId2['f-bg-remove'].hidden, false, 'remove button visible');
    byId2['f-bg-remove'].click();
    assert.strictEqual(env2.document.body.classList.contains('hasbg'), false, 'removed immediately');
    byId2['modal-backdrop'].fire('click'); // dismiss → revert
    assert.strictEqual(env2.document.body.classList.contains('hasbg'), true, 'reverts to saved background');

    const amb = env2.ambientCalls.map((c) => c.mode + (c.paused ? ':paused' : '')).join(' → ');
    assert.ok(amb.indexOf('hourglass:paused') !== -1,
      'a covering image pauses the animation: ' + amb);
    assert.ok(amb.indexOf('hourglass →') !== -1, 'removing it resumes: ' + amb);
  });

  await test('reload: settings persist, no modal, saved hero mode renders', async () => {
    const byId3 = buildDom();
    const env3 = makeEnv(byId3, storageBacking); // same localStorage as the main flow
    loadApp(env3.sandboxGlobals);
    await flush();
    assert.strictEqual(byId3['modal-backdrop'].hidden, true, 'no modal on return visit');
    assert.ok(!byId3.page.classList.contains('nouser'));
    assert.strictEqual(env3.document.body.dataset.theme, 'dusk', 'saved theme applied');
    assert.ok(/deaths today \u00b7 World/.test(byId3['days-label'].textContent), 'saved hero mode renders');
    assert.ok(/Bangladesh/.test(byId3['data-badge'].textContent));
  });

  await test('url overrides: ?le=75&scope=world beat the saved settings', async () => {
    const store4 = { 'memento.settings': JSON.stringify({
      birthday: '1990-06-15', sex: 'male', country: 'BGD',
      theme: 'midnight', hero: 'days-left', bg: null, scope: 'country', customLE: 80,
    }) };
    const byId4 = buildDom();
    const env4 = makeEnv(byId4, store4, '?le=75&scope=world');
    loadApp(env4.sandboxGlobals);
    await flush();
    const S = require('../js/stats.js');
    const expected = S.countdown('1990-06-15', 75, Date.now()).days;
    const shown = parseInt(byId4['days-left'].textContent.replace(/,/g, ''), 10);
    assert.ok(Math.abs(shown - expected) <= 1, `days at 75y: ${shown} vs ${expected}`);
    assert.ok(/your estimate \u00b7 75 years/.test(byId4['le-note'].textContent), byId4['le-note'].textContent);
    assert.ok(/^showing: World/.test(byId4['scope-btn'].textContent), byId4['scope-btn'].textContent);
  });

  await test('url override: ?daybar=0 hides the day bar despite saved settings', async () => {
    const store5 = { 'memento.settings': JSON.stringify({
      birthday: '1990-06-15', sex: 'male', country: 'BGD',
      theme: 'midnight', hero: 'days-left', bg: null, scope: 'country', daybar: true,
    }) };
    const byId5 = buildDom();
    const env5 = makeEnv(byId5, store5, '?daybar=0');
    loadApp(env5.sandboxGlobals);
    await flush();
    assert.strictEqual(byId5.daybar.hidden, true, 'URL override hides the bar');
    assert.strictEqual(
      JSON.parse(store5['memento.settings']).daybar, true, 'stored settings untouched');
  });

  await test('url override: ?ambient=embers beats the saved hourglass', async () => {
    const storeA = {
      'memento.settings': JSON.stringify({
        birthday: '1990-06-15', sex: 'male', country: 'BGD',
        theme: 'midnight', hero: 'days-left', bg: null, scope: 'country', customLE: null,
        ambient: 'hourglass',
      }),
    };
    const byIdA = buildDom();
    const envA = makeEnv(byIdA, storeA, '?ambient=embers');
    loadApp(envA.sandboxGlobals);
    await flush();
    assert.deepStrictEqual(envA.ambientCalls[0], { mode: 'embers', paused: false });
    assert.strictEqual(JSON.parse(storeA['memento.settings']).ambient, 'hourglass',
      'stored settings untouched');
  });

  await test('shortcuts: empty start renders only the + chip', () => {
    const row = byId['sc-row'].children;
    assert.strictEqual(row.length, 1, 'no chips, one add button');
    assert.ok(row[0].classList.contains('sc-add'));
    assert.strictEqual(row[0].hidden, false);
    assert.strictEqual(byId['sc-pop'].hidden, true, 'popover closed');
  });

  await test('shortcuts: add via popover normalizes the URL and persists immediately', () => {
    byId['sc-row'].children[0].click(); // +
    assert.strictEqual(byId['sc-pop'].hidden, false, 'popover opens');
    assert.strictEqual(byId['sc-save'].textContent, 'Add');
    byId['sc-name'].value = 'GitHub';
    byId['sc-url'].value = 'github.com';
    byId['sc-save'].click();
    assert.strictEqual(byId['sc-pop'].hidden, true, 'popover closes on save');
    assert.deepStrictEqual(JSON.parse(storageBacking['memento.shortcuts']),
      [{ name: 'GitHub', url: 'https://github.com/' }], 'stored, scheme added');
    const chips = findAll(byId['sc-row'], 'sc-chip');
    assert.strictEqual(chips.length, 1, 'one chip rendered');
    const link = findAll(chips[0], 'sc-link')[0];
    assert.strictEqual(link.href, 'https://github.com/');
    assert.strictEqual(findAll(chips[0], 'sc-name')[0].textContent, 'GitHub');
    assert.strictEqual(findAll(chips[0], 'sc-letter')[0].textContent, 'G', 'letter tile until favicon loads');
    assert.strictEqual(byId['sc-row'].children.length, 2, 'chip + add button');
  });

  await test('shortcuts: blank name derives from hostname; Enter submits', () => {
    byId['sc-row'].children[byId['sc-row'].children.length - 1].click(); // +
    byId['sc-name'].value = '';
    byId['sc-url'].value = 'https://www.wikipedia.org/';
    byId['sc-url'].fire('keydown', { key: 'Enter' });
    assert.strictEqual(byId['sc-pop'].hidden, true, 'Enter saved');
    assert.deepStrictEqual(JSON.parse(storageBacking['memento.shortcuts']), [
      { name: 'GitHub', url: 'https://github.com/' },
      { name: 'wikipedia.org', url: 'https://www.wikipedia.org/' }, // www. stripped
    ]);
  });

  await test('shortcuts: invalid URLs show an error and persist nothing', () => {
    const before = JSON.parse(storageBacking['memento.shortcuts']).length;
    byId['sc-row'].children[byId['sc-row'].children.length - 1].click(); // +
    byId['sc-url'].value = 'javascript:alert(1)';
    byId['sc-save'].click();
    assert.strictEqual(byId['sc-pop'].hidden, false, 'stays open on bad URL');
    assert.ok(byId['sc-err'].textContent.length > 0, 'error shown: ' + byId['sc-err'].textContent);
    byId['sc-url'].value = 'not a url';
    byId['sc-save'].click();
    assert.ok(byId['sc-err'].textContent.length > 0, 'spaces rejected too');
    byId['sc-cancel'].click();
    assert.strictEqual(byId['sc-pop'].hidden, true, 'cancel closes');
    assert.strictEqual(JSON.parse(storageBacking['memento.shortcuts']).length, before, 'nothing stored');
  });

  await test('shortcuts: edit rewrites in place, remove deletes', () => {
    let chips = findAll(byId['sc-row'], 'sc-chip');
    findAll(chips[0], 'sc-edit')[0].click();
    assert.strictEqual(byId['sc-pop'].hidden, false);
    assert.strictEqual(byId['sc-save'].textContent, 'Save', 'edit mode label');
    assert.strictEqual(byId['sc-name'].value, 'GitHub', 'name prefilled');
    assert.strictEqual(byId['sc-url'].value, 'https://github.com/', 'url prefilled');
    byId['sc-name'].value = 'GH';
    byId['sc-save'].click();
    const stored = JSON.parse(storageBacking['memento.shortcuts']);
    assert.deepStrictEqual(stored, [
      { name: 'GH', url: 'https://github.com/' },
      { name: 'wikipedia.org', url: 'https://www.wikipedia.org/' },
    ], 'edited entry keeps its position');

    chips = findAll(byId['sc-row'], 'sc-chip');
    findAll(chips[1], 'sc-x')[0].click();
    assert.deepStrictEqual(JSON.parse(storageBacking['memento.shortcuts']),
      [{ name: 'GH', url: 'https://github.com/' }], 'second chip removed');
    assert.strictEqual(findAll(byId['sc-row'], 'sc-chip').length, 1);
  });

  await test('shortcuts: stored list is capped at 12', async () => {
    const store5 = {
      'memento.settings': JSON.stringify({
        birthday: '1990-06-15', sex: 'male', country: 'BGD',
        theme: 'midnight', hero: 'days-left', bg: null, scope: 'country', customLE: null,
      }),
      'memento.shortcuts': JSON.stringify(
        Array.from({ length: 15 }, (_, i) => ({ name: 'S' + i, url: 'https://s' + i + '.example/' }))),
    };
    const byId5 = buildDom();
    const env5 = makeEnv(byId5, store5);
    loadApp(env5.sandboxGlobals);
    await flush();
    assert.strictEqual(findAll(byId5['sc-row'], 'sc-chip').length, 12, '15 stored → 12 rendered');
    assert.strictEqual(JSON.parse(store5['memento.shortcuts']).length, 15, 'stored copy untouched');
    const add = byId5['sc-row'].children[byId5['sc-row'].children.length - 1];
    assert.ok(add.classList.contains('sc-add'));
    assert.strictEqual(add.hidden, true, '+ hidden at the cap');
  });

  await test('shortcuts: ?shortcuts= override renders but never persists', async () => {
    const store6 = {
      'memento.settings': JSON.stringify({
        birthday: '1990-06-15', sex: 'male', country: 'BGD',
        theme: 'midnight', hero: 'days-left', bg: null, scope: 'country', customLE: null,
      }),
    };
    const byId6 = buildDom();
    const env6 = makeEnv(byId6, store6, '?shortcuts=GitHub|github.com,Wikipedia|wikipedia.org');
    loadApp(env6.sandboxGlobals);
    await flush();
    const chips = findAll(byId6['sc-row'], 'sc-chip');
    assert.strictEqual(chips.length, 2, 'override chips rendered');
    assert.strictEqual(findAll(chips[0], 'sc-name')[0].textContent, 'GitHub');
    findAll(chips[0], 'sc-x')[0].click(); // even edits stay ephemeral
    assert.strictEqual(findAll(byId6['sc-row'], 'sc-chip').length, 1);
    assert.ok(!('memento.shortcuts' in store6), 'nothing written to storage');
  });

  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
