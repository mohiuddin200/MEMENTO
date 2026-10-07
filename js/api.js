/*
 * Memento — World Bank Open Data client.
 *
 * One bulk request per indicator returns every country's most-recent-year
 * value (mrnev=1); /v2/country supplies names and lets us drop aggregates.
 * Flow: render instantly from the 7-day cache (or the hardcoded baseline),
 * then refresh in the background when the cache is stale. The page never
 * renders empty: live → cache → baseline, in that order.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MementoApi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 'https://api.worldbank.org/v2';
  var IND = {
    leMale: 'SP.DYN.LE00.MA.IN',
    leFemale: 'SP.DYN.LE00.FE.IN',
    deathRate: 'SP.DYN.CDRT.IN',
    birthRate: 'SP.DYN.CBRT.IN',
    population: 'SP.POP.TOTL',
  };
  var CACHE_KEY = 'memento.wb_cache';
  var CACHE_TTL_MS = 7 * 86400000; // 7 days
  var FETCH_TIMEOUT_MS = 15000;

  var baseline = function () {
    return (typeof MementoBaseline !== 'undefined' && MementoBaseline) ||
      (typeof root !== 'undefined' && root.MementoBaseline);
  };

  function fetchJSON(url, fetchImpl) {
    var f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return Promise.reject(new Error('no fetch available'));
    var done = false;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error('timeout: ' + url)); }
      }, FETCH_TIMEOUT_MS);
      f(url).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
        return res.json();
      }).then(function (j) {
        if (!done) { done = true; clearTimeout(timer); resolve(j); }
      }, function (e) {
        if (!done) { done = true; clearTimeout(timer); reject(e); }
      });
    });
  }

  // [meta, rows] — the API answers [null, {message}] on bad requests.
  function rowsOf(response) {
    if (!Array.isArray(response) || !Array.isArray(response[1])) return [];
    return response[1];
  }

  async function fetchLive(fetchImpl, nowMs) {
    var jobs = [fetchJSON(BASE + '/country?format=json&per_page=400', fetchImpl)];
    Object.keys(IND).forEach(function (k) {
      jobs.push(fetchJSON(
        BASE + '/country/all/indicator/' + IND[k] + '?format=json&per_page=20000&mrnev=1',
        fetchImpl));
    });
    var settled = await Promise.all(jobs.map(function (p) {
      return p.then(function (v) { return { ok: true, v: v }; },
                     function (e) { return { ok: false, e: e }; });
    }));
    if (!settled[0].ok) throw settled[0].e; // country metadata is essential

    var byIso3 = {};
    rowsOf(settled[0].v).forEach(function (c) {
      if (!c.region || c.region.value === 'Aggregates' || !c.id) return;
      byIso3[c.id] = { name: c.name, iso2: c.iso2Code };
    });
    if (!Object.keys(byIso3).length) throw new Error('country metadata empty');

    var fieldFor = [null, 'leMale', 'leFemale', 'deathRate', 'birthRate', 'population'];
    settled.slice(1).forEach(function (r, i) {
      var field = fieldFor[i + 1];
      if (!r.ok) return; // a missing indicator degrades to baseline at read time
      rowsOf(r.v).forEach(function (row) {
        var iso3 = row.countryiso3code;
        var entry = byIso3[iso3];
        if (!entry) {
          if (iso3 !== 'WLD') return; // the one aggregate we keep, as "World"
          entry = byIso3.WLD = { name: 'World', iso2: '1W' };
        }
        if (row.value != null) {
          entry[field] = row.value;
          if (field === 'leMale' && row.date) entry.year = row.date;
        }
      });
    });

    var b = baseline();
    if (b && byIso3.WLD) {
      ['leMale', 'leFemale', 'deathRate', 'birthRate', 'population', 'year'].forEach(function (k) {
        if (byIso3.WLD[k] == null) byIso3.WLD[k] = b.world[k];
      });
    }

    return buildDataset(byIso3, nowMs || Date.now(), 'live');
  }

  function buildDataset(byIso3, fetchedAt, source) {
    var list = Object.keys(byIso3)
      .map(function (iso3) { return { iso3: iso3, name: byIso3[iso3].name }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { countries: byIso3, list: list, fetchedAt: fetchedAt, source: source };
  }

  // The synthetic "World" entry (WLD aggregate) lives alongside real countries
  // so the picker can offer it and resolve() can fall back to it. Live data
  // supplies its own WLD row; the baseline fills in only what's missing.
  function withWorld(byIso3) {
    var b = baseline();
    if (!b) return byIso3;
    var copy = Object.assign({}, byIso3);
    if (!copy.WLD) {
      copy.WLD = {
        name: 'World',
        leMale: b.world.leMale,
        leFemale: b.world.leFemale,
        deathRate: b.world.deathRate,
        birthRate: b.world.birthRate,
        population: b.world.population,
        year: b.world.year,
      };
    }
    return copy;
  }

  function getBaseline(nowMs) {
    var b = baseline();
    if (!b) return null;
    var byIso3 = {};
    b.list.forEach(function (pair) { byIso3[pair[0]] = { name: pair[1] }; });
    byIso3 = withWorld(byIso3);
    return buildDataset(byIso3, nowMs || Date.now(), 'baseline');
  }

  // chrome.storage.local in the extension; a localStorage-backed shim under file://.
  function storageGet(storage, key) {
    return Promise.resolve(storage.get(key)).then(function (o) { return (o || {})[key]; });
  }
  function storageSet(storage, key, value) {
    return Promise.resolve(storage.set(key, value));
  }

  async function readCache(storage) {
    if (!storage) return null;
    try {
      var raw = await storageGet(storage, CACHE_KEY);
      if (!raw || raw.version !== 1 || !raw.data) return null;
      return raw;
    } catch (e) { return null; }
  }

  function cacheToDataset(cache) {
    var byIso3 = withWorld(cache.data);
    var ds = buildDataset(byIso3, cache.fetchedAt, 'cache');
    ds.cacheAgeDays = Math.floor((Date.now() - cache.fetchedAt) / 86400000);
    return ds;
  }

  // Orchestrator behind the new tab: hand back something renderable
  // immediately (fresh-ish cache, else baseline), then refresh in the
  // background when stale and hand the refreshed dataset to onUpdate.
  async function load(opts) {
    var storage = opts && opts.storage;
    var fetchImpl = opts && opts.fetchImpl;
    var onUpdate = opts && opts.onUpdate;
    var initial = null;

    var cache = await readCache(storage);
    if (cache) {
      initial = cacheToDataset(cache);
      if (Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        if (onUpdate) onUpdate(initial); // fresh enough — no network needed
        return initial;
      }
    }
    if (!initial) initial = getBaseline();
    if (onUpdate) onUpdate(initial);

    try {
      var live = await fetchLive(fetchImpl);
      if (storage) {
        try {
          await storageSet(storage, CACHE_KEY, { version: 1, fetchedAt: live.fetchedAt, data: live.countries });
        } catch (e) { /* cache write failure is non-fatal */ }
      }
      if (onUpdate) onUpdate(live);
      return live;
    } catch (e) {
      return initial; // offline and (maybe) stale cache still on screen
    }
  }

  // Effective numbers for a country: its own if complete, World otherwise.
  function resolve(dataset, iso3) {
    var c = dataset && dataset.countries && dataset.countries[iso3];
    var w = dataset && dataset.countries && dataset.countries.WLD;
    if (!c) return { entry: w || null, fallback: true };
    var complete = c.leMale != null && c.deathRate != null && c.population != null;
    if (complete) return { entry: c, fallback: false };
    return { entry: Object.assign({}, w, c), fallback: true };
  }

  return {
    CACHE_KEY: CACHE_KEY,
    CACHE_TTL_MS: CACHE_TTL_MS,
    load: load,
    fetchLive: fetchLive,
    readCache: readCache,
    getBaseline: getBaseline,
    resolve: resolve,
  };
});
