/*
 * Unit tests for js/api.js — fake fetch + in-memory storage, no framework.
 * The final test is a live-network integration check (skipped with --offline).
 * Run: node tests/api.test.js
 */
'use strict';
const assert = require('assert');
global.MementoBaseline = require('../js/baseline.js').MementoBaseline;
const Api = require('../js/api.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    failed++;
    console.error('FAIL  ' + name);
    console.error(e && e.stack || e);
  }
}

function memStorage(initial) {
  const store = Object.assign({}, initial);
  return {
    get: (k) => Promise.resolve({ [k]: store[k] }), // chrome.storage.local semantics
    set: (k, v) => { store[k] = v; return Promise.resolve(); },
    _dump: () => store,
  };
}

const COUNTRY_URL = 'https://api.worldbank.org/v2/country?format=json&per_page=400';
function indicatorUrl(code) {
  return 'https://api.worldbank.org/v2/country/all/indicator/' + code +
    '?format=json&per_page=20000&mrnev=1';
}
const ok = (data) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });

// Minimal World-Bank-shaped fixtures: 1 real country, 1 aggregate, World rows.
function fixtureFetch(failIndicators) {
  const meta = [1, 1, 400, 3, null, 'x'];
  const countryRows = [
    { id: 'BGD', iso2Code: 'BD', name: 'Bangladesh', region: { value: 'South Asia' } },
    { id: 'AFE', iso2Code: 'ZH', name: 'Africa Eastern and Southern', region: { value: 'Aggregates' } },
  ];
  const ind = (code, rows) => [meta, rows.map((r) => ({
    indicator: { id: code }, country: { id: '', value: r.name }, countryiso3code: r.iso3,
    date: r.date || '2024', value: r.value,
  }))];
  const routes = {
    [COUNTRY_URL]: [meta, countryRows],
    [indicatorUrl('SP.DYN.LE00.MA.IN')]: ind('LE.M', [
      { iso3: 'BGD', name: 'Bangladesh', value: 76.6 },
      { iso3: 'WLD', name: 'World', value: 71.9 },
    ]),
    [indicatorUrl('SP.DYN.LE00.FE.IN')]: ind('LE.F', [
      { iso3: 'BGD', name: 'Bangladesh', value: 79.1 },
      { iso3: 'WLD', name: 'World', value: 76.2 },
    ]),
    [indicatorUrl('SP.DYN.CDRT.IN')]: ind('DR', [
      { iso3: 'BGD', name: 'Bangladesh', value: 5.1 },
      { iso3: 'WLD', name: 'World', value: 7.6 },
    ]),
    [indicatorUrl('SP.DYN.CBRT.IN')]: ind('BR', [
      { iso3: 'BGD', name: 'Bangladesh', value: 20.0 },
      { iso3: 'WLD', name: 'World', value: 16.3 },
    ]),
    [indicatorUrl('SP.POP.TOTL')]: ind('POP', [
      { iso3: 'BGD', name: 'Bangladesh', value: 175686899, date: '2025' },
      { iso3: 'WLD', name: 'World', value: 8300000000, date: '2025' },
    ]),
  };
  let calls = 0;
  const fetchImpl = (url) => {
    calls++;
    if (failIndicators && failIndicators.some((u) => url === indicatorUrl(u))) {
      return Promise.reject(new Error('simulated indicator outage: ' + url));
    }
    const data = routes[url];
    if (!data) return Promise.reject(new Error('unexpected url ' + url));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  };
  fetchImpl.callCount = () => calls;
  return fetchImpl;
}

const offlineFetch = () => Promise.reject(new Error('offline'));

(async () => {
  await test('live fetch: parses indicators, drops aggregates, keeps World', async () => {
    const ds = await Api.fetchLive(fixtureFetch());
    assert.strictEqual(ds.source, 'live');
    assert.ok(ds.countries.BGD, 'BGD present');
    assert.strictEqual(ds.countries.BGD.leMale, 76.6);
    assert.strictEqual(ds.countries.BGD.leFemale, 79.1);
    assert.strictEqual(ds.countries.BGD.deathRate, 5.1);
    assert.strictEqual(ds.countries.BGD.population, 175686899);
    assert.strictEqual(ds.countries.BGD.iso2, 'BD');
    assert.ok(!ds.countries.AFE, 'aggregate AFE filtered out');
    assert.ok(ds.countries.WLD, 'WLD present from live rows');
    assert.strictEqual(ds.countries.WLD.population, 8300000000);
    assert.deepStrictEqual(ds.list.map((c) => c.iso3).sort(), ['BGD', 'WLD']);
  });

  await test('live fetch with one indicator down: gaps filled from baseline World', async () => {
    const ds = await Api.fetchLive(fixtureFetch(['SP.DYN.CDRT.IN']));
    assert.ok(ds.countries.BGD.deathRate == null, 'BGD death rate missing');
    const r = Api.resolve(ds, 'BGD');
    assert.strictEqual(r.fallback, true);
    assert.strictEqual(r.entry.deathRate, global.MementoBaseline.world.deathRate);
    assert.strictEqual(r.entry.name, 'Bangladesh'); // own fields kept
    assert.strictEqual(r.entry.leMale, 76.6);
  });

  await test('resolve: complete country → own data, no fallback', async () => {
    const ds = await Api.fetchLive(fixtureFetch());
    const r = Api.resolve(ds, 'BGD');
    assert.strictEqual(r.fallback, false);
    assert.strictEqual(r.entry.population, 175686899);
  });

  await test('resolve: unknown country → World', async () => {
    const ds = await Api.fetchLive(fixtureFetch());
    const r = Api.resolve(ds, 'ZZZ');
    assert.strictEqual(r.fallback, true);
    assert.strictEqual(r.entry.name, 'World');
  });

  await test('load with no cache and working network: baseline → live, cache written', async () => {
    const store = memStorage();
    const seen = [];
    const fetchImpl = fixtureFetch();
    const ds = await Api.load({ storage: store, fetchImpl, onUpdate: (d) => seen.push(d.source) });
    assert.strictEqual(ds.source, 'live');
    assert.deepStrictEqual(seen, ['baseline', 'live']);
    const raw = store._dump()[Api.CACHE_KEY];
    assert.ok(raw && raw.version === 1, 'cache written');
    assert.ok(raw.fetchedAt <= Date.now());
    assert.strictEqual(raw.data.BGD.leMale, 76.6);
  });

  await test('fresh cache (under 7 days): served instantly, no network', async () => {
    const store = memStorage({
      [Api.CACHE_KEY]: {
        version: 1,
        fetchedAt: Date.now() - 6 * 86400000,
        data: { BGD: { name: 'Bangladesh', leMale: 70, deathRate: 5, population: 1e8 } },
      },
    });
    const fetchImpl = fixtureFetch();
    const seen = [];
    const ds = await Api.load({ storage: store, fetchImpl, onUpdate: (d) => seen.push(d.source) });
    assert.strictEqual(ds.source, 'cache');
    assert.deepStrictEqual(seen, ['cache']);
    assert.strictEqual(fetchImpl.callCount(), 0, 'no fetch for fresh cache');
    assert.strictEqual(ds.countries.BGD.leMale, 70);
    assert.ok(ds.countries.WLD, 'World entry added beside cached countries');
  });

  await test('stale cache (over 7 days): cache first, then background refresh to live', async () => {
    const store = memStorage({
      [Api.CACHE_KEY]: { version: 1, fetchedAt: Date.now() - 8 * 86400000, data: { BGD: { name: 'Bangladesh' } } },
    });
    const seen = [];
    const ds = await Api.load({ storage: store, fetchImpl: fixtureFetch(), onUpdate: (d) => seen.push(d.source) });
    assert.deepStrictEqual(seen, ['cache', 'live']);
    assert.strictEqual(ds.source, 'live');
  });

  await test('offline with stale cache: cache keeps the page alive, no crash', async () => {
    const store = memStorage({
      [Api.CACHE_KEY]: { version: 1, fetchedAt: Date.now() - 30 * 86400000, data: { BGD: { name: 'Bangladesh', leMale: 71 } } },
    });
    const seen = [];
    const ds = await Api.load({ storage: store, fetchImpl: offlineFetch, onUpdate: (d) => seen.push(d.source) });
    assert.deepStrictEqual(seen, ['cache']);
    assert.strictEqual(ds.source, 'cache');
    assert.strictEqual(ds.cacheAgeDays, 30);
  });

  await test('offline with no cache: hardcoded baseline (never empty)', async () => {
    const store = memStorage();
    const seen = [];
    const ds = await Api.load({ storage: store, fetchImpl: offlineFetch, onUpdate: (d) => seen.push(d.source) });
    assert.deepStrictEqual(seen, ['baseline']);
    assert.strictEqual(ds.source, 'baseline');
    assert.ok(ds.countries.WLD.population > 8e9, 'world population present');
    assert.strictEqual(ds.list.length, 218); // 217 countries + World
    const r = Api.resolve(ds, 'BGD');
    assert.strictEqual(r.fallback, true);
    assert.strictEqual(r.entry.name, 'Bangladesh');       // own name
    assert.strictEqual(r.entry.deathRate, global.MementoBaseline.world.deathRate); // world stats
  });

  await test('corrupted cache is ignored, not fatal', async () => {
    const store = memStorage({ [Api.CACHE_KEY]: { version: 99, data: null } });
    const ds = await Api.load({ storage: store, fetchImpl: offlineFetch, onUpdate: () => {} });
    assert.strictEqual(ds.source, 'baseline');
  });

  if (!process.argv.includes('--offline')) {
    await test('LIVE integration: real World Bank endpoints parse end-to-end', async () => {
      let ds;
      try {
        ds = await Api.fetchLive();
      } catch (e) {
        console.log('  skip (network unavailable): ' + e.message);
        return;
      }
      assert.strictEqual(ds.source, 'live');
      assert.ok(Object.keys(ds.countries).length >= 217, 'real countries present');
      const bd = ds.countries.BGD;
      assert.ok(bd && bd.leMale > 60 && bd.leMale < 90, 'BD male LE plausible: ' + (bd && bd.leMale));
      assert.ok(bd.deathRate > 2 && bd.deathRate < 20, 'BD crude death rate plausible');
      assert.ok(bd.population > 1e8, 'BD population plausible');
      assert.ok(ds.countries.WLD.population > 7e9, 'world population present');
      const names = ds.list.map((c) => c.name);
      assert.ok(names.includes('Bangladesh') && names.includes('World'));
    });
  }

  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
