/*
 * Memento — new tab app: setup modal (calendar picker, life expectancy,
 * themes, ambient backgrounds, hero stat, stats scope, day bar, background
 * image), tickers, country picker, shortcut chips, one-liners.
 * Vanilla JS, no framework. stats.js owns the math, api.js owns the data,
 * ambient.js owns the animated background layer.
 */
(function () {
  'use strict';

  var S = window.MementoStats;
  var Api = window.MementoApi;
  var SETTINGS_KEY = 'memento.settings';
  var SHORTCUTS_KEY = 'memento.shortcuts';
  var SHORTCUTS_MAX = 12; // one row's worth — the strip must not eat the page

  var THEMES = ['midnight', 'dusk', 'ember', 'paper'];
  var HEROS = ['days-left', 'deaths-country', 'deaths-world'];
  var AMBIENTS = ['none', 'hourglass', 'tide', 'embers', 'pulse'];
  var LE_MIN = 20, LE_MAX = 120; // sanity bounds for a custom life expectancy
  var BG_MAX_EDGE = 1920; // downscale uploads so storage stays small

  // ---------- storage: chrome.storage.local in the extension; localStorage under file:// ----------

  // get(key) resolves to a chrome-style {key: value} object; set takes a bare value.
  var storage = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
    ? {
        get: function (key) {
          return new Promise(function (resolve) {
            chrome.storage.local.get(key, function (o) { resolve(o || {}); });
          });
        },
        set: function (key, value) {
          return new Promise(function (resolve) {
            var obj = {}; obj[key] = value;
            chrome.storage.local.set(obj, function () { resolve(); });
          });
        },
      }
    : {
        get: function (key) {
          var o = {};
          try { o[key] = JSON.parse(localStorage.getItem(key)); } catch (e) { /* corrupted → unset */ }
          return Promise.resolve(o);
        },
        set: function (key, value) {
          try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
          return Promise.resolve();
        },
      };

  // ---------- tiny DOM helpers ----------

  function $(id) { return document.getElementById(id); }
  function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function pad3(n) { return (n < 100 ? '0' : '') + (n < 10 ? '0' : '') + n; }

  var body = document.body;
  var page = $('page');
  var bgEl = $('bgimg');
  var daysEl = $('days-left');
  var daysLabel = $('days-label');
  var hmsEl = $('hms');
  var leNoteEl = $('le-note');
  var daybarEl = $('daybar');
  var daybarFillEl = $('daybar-fill');
  var daybarLabelEl = $('daybar-label');
  var onelinerEl = $('oneliner');
  var livedEl = $('lived');
  var altDaysEl = $('alt-days');
  var altDotEl = $('alt-dot');
  var daysLivedEl = $('days-lived');
  var secsLivedEl = $('secs-lived');
  var progressEl = $('progress-fill');
  var deathsSecEl = $('deaths-sec');
  var birthsTodayEl = $('births-today');
  var deathsTodayEl = $('deaths-today');
  var netTodayEl = $('net-today');
  var scopeBtn = $('scope-btn');
  var badgeEl = $('data-badge');
  var backdrop = $('modal-backdrop');
  var birthdayField = $('f-birthday');
  var calEl = $('cal');
  var calTitle = $('cal-title');
  var calDays = $('cal-days');
  var sexBox = $('f-sex');
  var leBox = $('f-le');
  var leInput = $('f-le-years');
  var leHintEl = $('le-auto-hint');
  var scopeBox = $('f-scope');
  var daybarBox = $('f-daybar');
  var themeBox = $('f-theme');
  var ambientBox = $('f-ambient');
  var heroBox = $('f-hero');
  var countryInput = $('f-country');
  var countryList = $('country-list');
  var bgUploadBtn = $('f-bg-upload');
  var bgRemoveBtn = $('f-bg-remove');
  var bgFileInput = $('f-bg-file');
  var saveBtn = $('save');
  var scNav = $('shortcuts');
  var scRow = $('sc-row');
  var scPop = $('sc-pop');
  var scName = $('sc-name');
  var scUrl = $('sc-url');
  var scErr = $('sc-err');
  var scSaveBtn = $('sc-save');
  var scCancelBtn = $('sc-cancel');

  var settings = null;
  var dataset = null;
  var chosenSex = null;
  var leMode = 'auto';       // modal state: 'auto' | 'custom'

  // Unsaved modal previews (reverted if the modal is dismissed without saving).
  var previewTheme = null;   // null → follow saved
  var previewHero = null;    // null → follow saved
  var previewScope = null;   // null → follow saved
  var previewDaybar = null;  // null → follow saved
  var previewAmbient = null; // null → follow saved
  var pendingBg;             // undefined → unchanged; null → removed; string → new data URL

  var shortcuts = [];        // { name, url } chips, persisted under SHORTCUTS_KEY
  var scEdit = -1;           // popover mode: -1 add, >= 0 editing shortcuts[scEdit]
  var scFromUrl = false;     // ?shortcuts= demo override — render but never persist

  // URL overrides exist for demos and headless tests (?theme=&hero=&le=&scope=).
  var urlOverrides = {};

  // ---------- settings ----------

  function parseSettings(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.birthday || ''))) return null;
    var t = new Date(raw.birthday + 'T00:00:00').getTime();
    if (!isFinite(t) || t > Date.now() || t < Date.now() - 130 * 365.25 * 86400000) return null;
    if (raw.sex !== 'male' && raw.sex !== 'female') return null;
    if (!raw.country || typeof raw.country !== 'string') return null;
    var le = raw.customLE == null ? null : Number(raw.customLE);
    if (!(le !== null && isFinite(le) && le >= LE_MIN && le <= LE_MAX)) le = null;
    return {
      birthday: raw.birthday,
      sex: raw.sex,
      country: raw.country,
      theme: THEMES.indexOf(raw.theme) >= 0 ? raw.theme : 'midnight',
      hero: HEROS.indexOf(raw.hero) >= 0 ? raw.hero : 'days-left',
      ambient: AMBIENTS.indexOf(raw.ambient) >= 0 ? raw.ambient : 'hourglass',
      bg: typeof raw.bg === 'string' && raw.bg.slice(0, 11) === 'data:image/' ? raw.bg : null,
      scope: raw.scope === 'world' ? 'world' : 'country',
      customLE: le,
      daybar: raw.daybar === false ? false : true,
    };
  }

  function validLe(v) {
    var n = Number(v);
    return v !== '' && isFinite(n) && n >= LE_MIN && n <= LE_MAX;
  }

  function leNum(v) { return String(Math.round(v * 10) / 10); }

  function effectiveTheme() {
    return previewTheme || urlOverrides.theme ||
      (settings && settings.theme) || 'midnight';
  }

  function effectiveHero() {
    return previewHero || urlOverrides.hero ||
      (settings && settings.hero) || 'days-left';
  }

  function effectiveScope() {
    return previewScope || urlOverrides.scope ||
      (settings && settings.scope) || 'country';
  }

  function effectiveDaybar() {
    if (previewDaybar !== null) return previewDaybar;
    if (urlOverrides.daybar !== undefined) return urlOverrides.daybar;
    return settings ? settings.daybar : true;
  }

  function applyTheme(theme) {
    if (body && body.dataset) body.dataset.theme = theme;
  }

  function effectiveAmbient() {
    return previewAmbient || urlOverrides.ambient ||
      (settings && settings.ambient) || 'hourglass';
  }

  function applyBg(dataUrl) {
    body.classList.toggle('hasbg', !!dataUrl);
    bgEl.style.backgroundImage = dataUrl ? 'url("' + dataUrl + '")' : '';
    applyAmbient(); // a covering photo pauses the animation
  }

  // ambient.js tracks the theme itself; it only needs the mode and whether
  // a background image is covering the page.
  function applyAmbient() {
    if (window.MementoAmbient) {
      window.MementoAmbient.set(effectiveAmbient(), {
        paused: body.classList.contains('hasbg'),
      });
    }
  }

  // ---------- one-liners (one per day, deterministic) ----------

  var ONE_LINERS = [
    '≈ {summers} summers left. Start now.',
    '{pct}% of your life is already spent. Invest the rest deliberately.',
    '{sundays} Sundays remain. Waste fewer of them.',
    '{moons} full moons left to walk under.',
    '{heartbeats} heartbeats remain — every one of them borrowed.',
    '{breaths} breaths left, by a generous estimate.',
    'The deadline is fixed. Today is not it. Begin something.',
    'Nobody\u2019s last words were "I should have scrolled more."',
    'You are the oldest you have ever been — and the youngest you will ever be again.',
    'Hours feel endless. Days are not. Days are the real currency.',
    '{summers} summers is the whole budget. Spend them on purpose.',
    'This tab opens a hundred times a day. It is counting. So should you.',
  ];

  function dayOfYear(now) {
    var d = new Date(now);
    var start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d.getTime() - start.getTime()) / 86400000);
  }

  function oneLinerFor(daysLeft, daysLived, expectancy) {
    var t = ONE_LINERS[dayOfYear(Date.now()) % ONE_LINERS.length];
    var days = Math.max(0, daysLeft);
    return t
      .replace('{summers}', fmt(S.summersLeft(days)))
      .replace('{sundays}', fmt(S.sundaysLeft(days)))
      .replace('{moons}', fmt(S.fullMoonsLeft(days)))
      .replace('{breaths}', fmt(S.breathsLeft(days)))
      .replace('{heartbeats}', fmt(S.heartbeatsLeft(days)))
      .replace('{pct}', S.percentLived(daysLived, expectancy).toFixed(1));
  }

  // ---------- render ----------

  function sourceLabel(ds) {
    if (ds.source === 'live') return 'live';
    if (ds.source === 'cache') return 'cached ' + (ds.cacheAgeDays || 0) + 'd ago';
    return 'offline baseline';
  }

  function setHeroNumber(text) {
    setText(daysEl, text);
    daysEl.classList.toggle('longnum', text.length > 6);
  }

  function update() {
    var now = Date.now();
    if (!dataset) return;

    var iso = settings ? settings.country : 'WLD';
    var r = Api.resolve(dataset, iso);
    var e = r.entry;

    // Real-time death-rate row — follows the chosen scope (country or world).
    var scopeIso = effectiveScope() === 'world' || !settings ? 'WLD' : settings.country;
    var sr = Api.resolve(dataset, scopeIso);
    var se = sr.entry;
    if (se && se.deathRate != null && se.population != null) {
      var deathRate = S.perSecond(se.deathRate, se.population);
      var birthRate = se.birthRate != null ? S.perSecond(se.birthRate, se.population) : 0;
      var secs = S.secondsSinceMidnight(now);
      setText(deathsSecEl, deathRate.toFixed(2));
      setText(birthsTodayEl, fmt(birthRate * secs));
      setText(deathsTodayEl, fmt(deathRate * secs));
      var net = (birthRate - deathRate) * secs;
      setText(netTodayEl, (net >= 0 ? '+' : '\u2212') + fmt(Math.abs(net)));
    }
    if (settings) {
      setText(scopeBtn, 'showing: ' +
        (scopeIso === 'WLD' ? 'World' : ((se && se.name) || scopeIso)) + ' \u21c4');
    }

    setText(badgeEl, e
      ? (e.name || iso) +
        (r.fallback && iso !== 'WLD' ? ' \u00b7 world avg' : '') +
        ' \u00b7 World Bank ' + (e.year || '') +
        ' \u00b7 ' + sourceLabel(dataset)
      : 'no data');

    if (!settings) return;
    livedEl.hidden = false;

    // Personal clock (always computed — feeds the one-liner and the secondary line).
    var lived = S.lifeSoFar(settings.birthday, now);
    var autoLE = S.expectancyYears(
      e ? { male: e.leMale, female: e.leFemale } : null, settings.sex);
    var customLE = urlOverrides.le != null ? urlOverrides.le : settings.customLE;
    var expectancy = customLE != null ? customLE : autoLE;
    var cd = S.countdown(settings.birthday, expectancy, now);
    setText(onelinerEl, oneLinerFor(cd.days, lived.days, expectancy));

    // Say plainly what the countdown is based on.
    if (customLE != null) {
      setText(leNoteEl, 'your estimate \u00b7 ' + leNum(customLE) + ' years');
    } else if (e) {
      var who = settings.sex === 'female' ? 'woman' : 'man';
      var place = (r.fallback || iso === 'WLD') ? 'worldwide' : 'in ' + (e.name || iso);
      setText(leNoteEl, 'average for a ' + who + ' ' + place + ': ' + leNum(autoLE) + ' years');
    } else {
      setText(leNoteEl, '');
    }

    // Urgency bar: the local day draining from midnight to midnight.
    var showDaybar = effectiveDaybar();
    daybarEl.hidden = !showDaybar;
    if (showDaybar) {
      var dayFrac = S.dayFraction(now);
      daybarFillEl.style.width = (dayFrac * 100).toFixed(3) + '%';
      setText(daybarLabelEl, 'today \u00b7 ' + (dayFrac * 100).toFixed(1) + '% spent');
    }

    // Secondary line under the hero.
    if (effectiveHero() === 'days-left') {
      setText(altDaysEl, '');
      setText(altDotEl, '');
    } else {
      setText(altDaysEl, fmt(cd.days));
      setText(altDotEl, '\u00b7');
    }
    setText(daysLivedEl, fmt(lived.days));
    setText(secsLivedEl, fmt(lived.totalSeconds));
    progressEl.style.width = Math.min(100, S.percentLived(lived.days, expectancy)) + '%';

    // Hero: chosen big number.
    var heroMode = effectiveHero();
    if (heroMode === 'days-left') {
      if (cd.exceeded) {
        setHeroNumber('0');
        setText(daysLabel, customLE != null
          ? 'days left \u2014 past your estimate; every day is a bonus'
          : 'days left \u2014 you\u2019re beating the average; every day is a bonus');
        hmsEl.classList.add('bonus');
        setText(hmsEl, fmt(cd.bonusDays) + ' bonus days and counting');
      } else {
        setText(daysLabel, 'days left');
        hmsEl.classList.remove('bonus');
        setHeroNumber(fmt(cd.days));
        setText(hmsEl, pad2(cd.hours) + ':' + pad2(cd.minutes) + ':' + pad2(cd.seconds) +
          '.' + pad3(cd.milliseconds));
      }
    } else {
      var scope = heroMode === 'deaths-world' ? 'WLD' : (settings.country || 'WLD');
      var rr = Api.resolve(dataset, scope);
      var ee = rr.entry;
      if (ee && ee.deathRate != null && ee.population != null) {
        var heroRate = S.perSecond(ee.deathRate, ee.population);
        var heroCount = Math.floor(heroRate * S.secondsSinceMidnight(now));
        setHeroNumber(fmt(heroCount));
        setText(daysLabel, 'deaths today \u00b7 ' + (rr.fallback && scope !== 'WLD'
          ? 'World (avg)' : (ee.name || scope)));
        hmsEl.classList.add('bonus');
        setText(hmsEl, '\u2248 ' + heroRate.toFixed(2) + ' every second \u00b7 counting');
      }
    }
  }

  // ---------- birthday calendar picker ----------

  var cal = { open: false, y: 0, m: 0 }; // month being viewed

  function isoOf(y, m, d) {
    return y + '-' + pad2(m + 1) + '-' + pad2(d);
  }

  function renderBirthdayField() {
    var v = birthdayField.value;
    var text = v
      ? new Date(v + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Select your birthday';
    setText(birthdayField, text);
    birthdayField.classList.toggle('placeholder', !v);
  }

  function openCal() {
    var base = birthdayField.value
      ? new Date(birthdayField.value + 'T00:00:00')
      : new Date();
    cal.y = base.getFullYear();
    cal.m = base.getMonth();
    cal.open = true;
    calEl.hidden = false;
    renderCal();
  }

  function closeCal() {
    cal.open = false;
    calEl.hidden = true;
  }

  function navCal(dy, dm) {
    var d = new Date(cal.y, cal.m + dm, 1);
    cal.y = d.getFullYear() + dy;
    cal.m = d.getMonth();
    renderCal();
  }

  function renderCal() {
    setText(calTitle, new Date(cal.y, cal.m, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
    calDays.innerHTML = '';
    var first = new Date(cal.y, cal.m, 1);
    var start = new Date(cal.y, cal.m, 1 - first.getDay());
    var todayIso = isoOf(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var iso = isoOf(d.getFullYear(), d.getMonth(), d.getDate());
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      setText(btn, String(d.getDate()));
      btn.setAttribute('data-d', iso);
      if (d.getMonth() !== cal.m) btn.classList.add('dim');
      if (iso === todayIso) btn.classList.add('today');
      if (iso === birthdayField.value) btn.classList.add('sel');
      if (iso > todayIso || d.getFullYear() < 1900) btn.disabled = true;
      btn.addEventListener('click', makePickDay(iso));
      calDays.appendChild(btn);
    }
  }

  function makePickDay(iso) {
    return function () {
      birthdayField.value = iso;
      renderBirthdayField();
      closeCal();
      updateSaveState();
    };
  }

  birthdayField.addEventListener('click', function () {
    if (cal.open) closeCal();
    else openCal();
  });
  $('cal-prev').addEventListener('click', function () { navCal(0, -1); });
  $('cal-next').addEventListener('click', function () { navCal(0, 1); });
  $('cal-prevy').addEventListener('click', function () { navCal(-1, 0); });
  $('cal-nexty').addEventListener('click', function () { navCal(1, 0); });

  // ---------- country picker ----------

  var picker = { iso3: null, active: -1, filtered: [] };

  function countryEntries() {
    var list = (dataset && dataset.list ? dataset.list : [])
      .filter(function (c) { return c.iso3 !== 'WLD'; });
    list.unshift({ iso3: 'WLD', name: 'World' });
    return list;
  }

  function guessCountry() {
    // navigator.language ("en-US") → iso2 → iso3, best effort; else World.
    try {
      var region = (navigator.language.split('-')[1] || '').toUpperCase();
      if (region) {
        var hit = countryEntries().find(function (c) {
          var entry = dataset.countries[c.iso3];
          return entry && entry.iso2 === region;
        });
        if (hit) return hit.iso3;
      }
    } catch (e) { /* fall through */ }
    return 'WLD';
  }

  function filterCountries(q) {
    var needle = q.trim().toLowerCase();
    var all = countryEntries();
    if (!needle) return all;
    return all.filter(function (c) {
      return c.name.toLowerCase().indexOf(needle) !== -1 ||
             c.iso3.toLowerCase() === needle;
    });
  }

  function renderCountryList() {
    countryList.innerHTML = '';
    picker.filtered = filterCountries(countryInput.value);
    picker.filtered.slice(0, 60).forEach(function (c, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      var name = document.createElement('span');
      name.textContent = c.name;
      var iso = document.createElement('span');
      iso.className = 'iso';
      iso.textContent = c.iso3;
      li.appendChild(name);
      li.appendChild(iso);
      if (c.iso3 === picker.iso3) li.classList.add('selected');
      if (i === picker.active) {
        li.classList.add('active');
        if (typeof li.scrollIntoView === 'function') li.scrollIntoView({ block: 'nearest' });
      }
      li.addEventListener('click', function () { pickCountry(c.iso3); });
      countryList.appendChild(li);
    });
  }

  function pickCountry(iso3) {
    picker.iso3 = iso3;
    picker.active = -1;
    var c = countryEntries().find(function (x) { return x.iso3 === iso3; });
    countryInput.value = c ? c.name : iso3;
    renderCountryList();
    updateSaveState();
    updateLeHint();
  }

  // Live hint next to "Life expectancy": what the World Bank average gives for
  // the currently picked sex + country, so Auto vs Custom is an informed choice.
  function updateLeHint() {
    var sex = chosenSex || (settings && settings.sex) || 'male';
    var iso = picker.iso3 || (settings && settings.country) || 'WLD';
    if (!dataset) { setText(leHintEl, ''); return; }
    var rr = Api.resolve(dataset, iso);
    var ee = rr.entry;
    if (!ee) { setText(leHintEl, ''); return; }
    var le = S.expectancyYears({ male: ee.leMale, female: ee.leFemale }, sex);
    var who = sex === 'female' ? 'woman' : 'man';
    var place = (rr.fallback || iso === 'WLD') ? 'worldwide' : 'in ' + (ee.name || iso);
    setText(leHintEl, '\u2014 avg ' + leNum(le) + 'y \u00b7 ' + who + ' ' + place);
  }

  // ---------- background image ----------

  function downscaleImage(file) {
    return new Promise(function (resolve, reject) {
      if (typeof Image === 'undefined' || typeof URL === 'undefined' ||
          typeof URL.createObjectURL !== 'function') {
        reject(new Error('image decoding unavailable'));
        return;
      }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var scale = Math.min(1, BG_MAX_EDGE / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
      img.src = url;
    });
  }

  function updateBgUi() {
    var current = pendingBg !== undefined ? pendingBg : (settings && settings.bg) || null;
    setText(bgUploadBtn, current ? 'Replace image…' : 'Upload from this device…');
    bgRemoveBtn.hidden = !current;
  }

  bgUploadBtn.addEventListener('click', function () { bgFileInput.click(); });

  bgFileInput.addEventListener('change', function (ev) {
    var file = ev.target && ev.target.files && ev.target.files[0];
    if (!file) return;
    downscaleImage(file).then(function (dataUrl) {
      pendingBg = dataUrl;
      applyBg(dataUrl);
      updateBgUi();
    }, function () { /* unreadable file — keep whatever background is set */ });
    ev.target.value = '';
  });

  bgRemoveBtn.addEventListener('click', function () {
    pendingBg = null;
    applyBg(null);
    updateBgUi();
  });

  // ---------- shortcut chips ----------

  // Only http(s) survives: bare domains get https://, anything that won't
  // parse (or parses to another scheme) is rejected outright.
  function normalizeShortcutUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;
    if (s.indexOf('://') < 0) s = 'https://' + s;
    try {
      var u = new URL(s);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
    } catch (e) { return null; }
  }

  function hostnameOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function faviconUrl(u) {
    try { return new URL(u).origin + '/favicon.ico'; } catch (e) { return ''; }
  }

  function parseShortcuts(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length && out.length < SHORTCUTS_MAX; i++) {
      var it = raw[i];
      if (!it || typeof it !== 'object') continue;
      var url = normalizeShortcutUrl(it.url);
      if (!url) continue;
      var name = String(it.name || '').trim().slice(0, 24) || hostnameOf(url);
      if (!name) continue;
      out.push({ name: name, url: url });
    }
    return out;
  }

  function persistShortcuts() {
    if (!scFromUrl) storage.set(SHORTCUTS_KEY, shortcuts);
  }

  function makeScEdit(i) {
    return function () { openScPop(i); };
  }

  function makeScRemove(i) {
    return function () {
      shortcuts.splice(i, 1);
      persistShortcuts();
      renderShortcuts();
    };
  }

  function renderShortcuts() {
    scRow.innerHTML = '';
    shortcuts.forEach(function (item, i) {
      var chip = document.createElement('div');
      chip.className = 'sc-chip';

      var link = document.createElement('a');
      link.className = 'sc-link';
      link.href = item.url;
      link.title = item.url;

      // Letter tile first, favicon once it actually loads.
      var letter = document.createElement('span');
      letter.className = 'sc-letter';
      letter.textContent = item.name.charAt(0);
      var ico = document.createElement('img');
      ico.className = 'sc-ico';
      ico.alt = '';
      ico.hidden = true;
      ico.onload = function () { ico.hidden = false; letter.hidden = true; };
      ico.src = faviconUrl(item.url);

      var name = document.createElement('span');
      name.className = 'sc-name';
      name.textContent = item.name;

      link.appendChild(letter);
      link.appendChild(ico);
      link.appendChild(name);

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'sc-edit';
      editBtn.title = 'Edit shortcut';
      editBtn.setAttribute('aria-label', 'Edit ' + item.name);
      editBtn.textContent = '\u270e';
      editBtn.addEventListener('click', makeScEdit(i));

      var rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'sc-x';
      rmBtn.title = 'Remove shortcut';
      rmBtn.setAttribute('aria-label', 'Remove ' + item.name);
      rmBtn.textContent = '\u2715';
      rmBtn.addEventListener('click', makeScRemove(i));

      chip.appendChild(link);
      chip.appendChild(editBtn);
      chip.appendChild(rmBtn);
      scRow.appendChild(chip);
    });

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'sc-add';
    addBtn.title = 'Add shortcut';
    addBtn.setAttribute('aria-label', 'Add shortcut');
    addBtn.textContent = '+';
    addBtn.hidden = shortcuts.length >= SHORTCUTS_MAX;
    addBtn.addEventListener('click', function () { openScPop(-1); });
    scRow.appendChild(addBtn);
  }

  function openScPop(idx) {
    scEdit = idx;
    var editing = idx >= 0 ? shortcuts[idx] : null;
    scName.value = editing ? editing.name : '';
    scUrl.value = editing ? editing.url : '';
    setText(scSaveBtn, editing ? 'Save' : 'Add');
    setText(scErr, '');
    scPop.hidden = false;
    scName.focus();
  }

  function closeScPop() {
    scEdit = -1;
    scPop.hidden = true;
  }

  function saveScPop() {
    var url = normalizeShortcutUrl(scUrl.value);
    if (!url) {
      setText(scErr, 'Enter a valid URL \u2014 e.g. github.com');
      return;
    }
    var name = scName.value.trim().slice(0, 24) || hostnameOf(url);
    if (scEdit >= 0 && shortcuts[scEdit]) shortcuts[scEdit] = { name: name, url: url };
    else shortcuts.push({ name: name, url: url });
    persistShortcuts();
    renderShortcuts();
    closeScPop();
  }

  function scFieldKeydown(ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      saveScPop();
    }
  }

  scSaveBtn.addEventListener('click', saveScPop);
  scCancelBtn.addEventListener('click', closeScPop);
  scName.addEventListener('keydown', scFieldKeydown);
  scUrl.addEventListener('keydown', scFieldKeydown);

  // Click outside the strip closes the popover (walk parentNode: works in
  // the browser and the Node test stub alike).
  document.addEventListener('click', function (ev) {
    if (scPop.hidden) return;
    var n = ev.target;
    while (n) {
      if (n === scNav) return;
      n = n.parentNode;
    }
    closeScPop();
  });

  // ---------- modal ----------

  function updateSaveState() {
    var ok = /^\d{4}-\d{2}-\d{2}$/.test(birthdayField.value) &&
             new Date(birthdayField.value + 'T00:00:00').getTime() < Date.now() &&
             chosenSex !== null &&
             picker.iso3 !== null &&
             (leMode !== 'custom' || validLe(leInput.value));
    saveBtn.disabled = !ok;
  }

  function markSegmented(box, attr, value) {
    Array.prototype.forEach.call(box.children, function (b) {
      b.classList.toggle('selected', b.getAttribute(attr) === value);
    });
  }

  function openModal() {
    previewTheme = null;
    previewHero = null;
    previewScope = null;
    previewDaybar = null;
    previewAmbient = null;
    pendingBg = undefined;
    applyTheme(effectiveTheme());
    applyAmbient();
    closeScPop();

    birthdayField.value = settings ? settings.birthday : '';
    renderBirthdayField();
    closeCal();
    chosenSex = settings ? settings.sex : null;
    markSegmented(sexBox, 'data-sex', chosenSex);
    leMode = settings && settings.customLE != null ? 'custom' : 'auto';
    leInput.value = leMode === 'custom' ? String(settings.customLE) : '';
    leInput.hidden = leMode !== 'custom';
    markSegmented(leBox, 'data-le', leMode);
    markSegmented(scopeBox, 'data-scope', effectiveScope());
    markSegmented(daybarBox, 'data-daybar', effectiveDaybar() ? 'on' : 'off');
    markSegmented(themeBox, 'data-theme-swatch', effectiveTheme());
    markSegmented(ambientBox, 'data-ambient', effectiveAmbient());
    markSegmented(heroBox, 'data-hero', effectiveHero());
    updateLeHint();

    if (settings) {
      pickCountry(dataset.countries[settings.country] ? settings.country : 'WLD');
    } else {
      pickCountry(guessCountry());
      countryInput.value = ''; // first run: show the full list, not the guess's name
      renderCountryList();
    }
    updateBgUi();
    updateSaveState();
    backdrop.hidden = false;
    setTimeout(function () { birthdayField.focus(); }, 50);
  }

  // Revert unsaved previews when the modal is dismissed without saving.
  function dismissModal() {
    previewTheme = null;
    previewHero = null;
    previewScope = null;
    previewDaybar = null;
    previewAmbient = null;
    pendingBg = undefined;
    applyTheme(effectiveTheme());
    applyBg((settings && settings.bg) || null);
    closeCal();
    backdrop.hidden = true;
    update();
  }

  saveBtn.addEventListener('click', function () {
    var candidate = {
      birthday: birthdayField.value,
      sex: chosenSex,
      country: picker.iso3 || 'WLD',
      theme: previewTheme || (settings && settings.theme) || 'midnight',
      hero: previewHero || (settings && settings.hero) || 'days-left',
      ambient: previewAmbient || (settings && settings.ambient) || 'hourglass',
      bg: pendingBg !== undefined ? pendingBg : (settings && settings.bg) || null,
      scope: previewScope || (settings && settings.scope) || 'country',
      customLE: leMode === 'custom' ? leInput.value : null,
      daybar: previewDaybar !== null ? previewDaybar : (settings && settings.daybar) !== false,
    };
    var parsed = parseSettings(candidate);
    if (!parsed) return;
    settings = parsed;
    previewTheme = null;
    previewHero = null;
    previewScope = null;
    previewDaybar = null;
    previewAmbient = null;
    pendingBg = undefined;
    page.classList.remove('nouser');
    applyTheme(settings.theme);
    applyBg(settings.bg);
    closeCal();
    storage.set(SETTINGS_KEY, parsed);
    backdrop.hidden = true;
    update();
  });

  sexBox.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-sex]');
    if (!btn) return;
    chosenSex = btn.getAttribute('data-sex');
    markSegmented(sexBox, 'data-sex', chosenSex);
    updateSaveState();
    updateLeHint();
  });

  leBox.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-le]');
    if (!btn) return;
    leMode = btn.getAttribute('data-le');
    markSegmented(leBox, 'data-le', leMode);
    leInput.hidden = leMode !== 'custom';
    updateSaveState();
  });

  leInput.addEventListener('input', updateSaveState);

  scopeBox.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-scope]');
    if (!btn) return;
    previewScope = btn.getAttribute('data-scope');
    markSegmented(scopeBox, 'data-scope', previewScope);
    update();
  });

  daybarBox.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-daybar]');
    if (!btn) return;
    previewDaybar = btn.getAttribute('data-daybar') === 'on';
    markSegmented(daybarBox, 'data-daybar', previewDaybar ? 'on' : 'off');
    update();
  });

  // One-click switch for the bottom numbers, without opening the modal.
  scopeBtn.addEventListener('click', function () {
    if (!settings) return;
    settings.scope = settings.scope === 'world' ? 'country' : 'world';
    storage.set(SETTINGS_KEY, settings);
    update();
  });

  themeBox.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-theme-swatch]');
    if (!btn) return;
    previewTheme = btn.getAttribute('data-theme-swatch');
    applyTheme(previewTheme);
    markSegmented(themeBox, 'data-theme-swatch', previewTheme);
  });

  ambientBox.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-ambient]');
    if (!btn) return;
    previewAmbient = btn.getAttribute('data-ambient');
    markSegmented(ambientBox, 'data-ambient', previewAmbient);
    applyAmbient();
  });

  heroBox.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-hero]');
    if (!btn) return;
    previewHero = btn.getAttribute('data-hero');
    markSegmented(heroBox, 'data-hero', previewHero);
    update();
  });

  countryInput.addEventListener('input', function () {
    picker.active = -1;
    picker.filtered = filterCountries(countryInput.value);
    picker.iso3 = null; // typing invalidates the current selection
    renderCountryList();
    updateSaveState();
    updateLeHint();
  });

  countryInput.addEventListener('keydown', function (ev) {
    var n = Math.min(picker.filtered.length, 60);
    if (ev.key === 'ArrowDown' && n) {
      ev.preventDefault();
      picker.active = Math.min(picker.active + 1, n - 1);
      renderCountryList();
    } else if (ev.key === 'ArrowUp' && n) {
      ev.preventDefault();
      picker.active = Math.max(picker.active - 1, 0);
      renderCountryList();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      var idx = picker.active >= 0 ? picker.active : 0;
      if (n) pickCountry(picker.filtered[idx].iso3);
    }
  });

  backdrop.addEventListener('click', function (ev) {
    if (ev.target === backdrop && settings) dismissModal(); // first run must complete the form
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (cal.open) closeCal();
      else if (!scPop.hidden) closeScPop();
      else if (settings) dismissModal();
    }
  });

  $('gear').addEventListener('click', openModal);

  // ---------- boot: instant paint, then background refresh ----------

  function init() {
    var qs = new URLSearchParams(location.search);
    var fromUrl = qs.get('birthday') && qs.get('sex')
      ? { birthday: qs.get('birthday'), sex: qs.get('sex'), country: qs.get('country') || 'WLD' }
      : null;
    if (THEMES.indexOf(qs.get('theme')) >= 0) urlOverrides.theme = qs.get('theme');
    if (HEROS.indexOf(qs.get('hero')) >= 0) urlOverrides.hero = qs.get('hero');
    if (AMBIENTS.indexOf(qs.get('ambient')) >= 0) urlOverrides.ambient = qs.get('ambient');
    if (qs.get('scope') === 'world' || qs.get('scope') === 'country') {
      urlOverrides.scope = qs.get('scope');
    }
    if (qs.get('daybar') === '0' || qs.get('daybar') === 'off') urlOverrides.daybar = false;
    if (qs.get('daybar') === '1' || qs.get('daybar') === 'on') urlOverrides.daybar = true;
    var leQ = parseFloat(qs.get('le'));
    if (isFinite(leQ) && leQ >= LE_MIN && leQ <= LE_MAX) {
      urlOverrides.le = Math.round(leQ * 10) / 10;
    }
    // ?shortcuts=Name|url,Name|url — demos and headless renders; never persisted.
    var scQ = qs.get('shortcuts');
    if (scQ) {
      scFromUrl = parseShortcuts(scQ.split(',').map(function (part) {
        var i = part.indexOf('|');
        return i < 0 ? { url: part } : { name: part.slice(0, i), url: part.slice(i + 1) };
      }));
      shortcuts = scFromUrl;
    }

    Promise.all([storage.get(SETTINGS_KEY), storage.get(SHORTCUTS_KEY)])
      .then(function (bags) {
        settings = parseSettings(fromUrl) || parseSettings(bags[0] && bags[0][SETTINGS_KEY]);
        if (!scFromUrl) shortcuts = parseShortcuts(bags[1] && bags[1][SHORTCUTS_KEY]);
        renderShortcuts();

        dataset = Api.getBaseline(); // instant; swapped for cache/live as they arrive
        applyTheme(effectiveTheme());
        applyBg(settings ? settings.bg : null);
        if (!settings) page.classList.add('nouser');
        update();
        if (!settings) openModal();

        Api.load({
          storage: storage,
          onUpdate: function (d) {
            dataset = d;
            update();
            if (!backdrop.hidden) { // picker follows fresher data
              renderCountryList();
              updateLeHint();
            }
          },
        });
      });

    // 1 Hz heartbeat (also the test hook), plus a display-rate loop in real
    // browsers so the millisecond fraction of the countdown drains smoothly.
    setInterval(update, 1000);
    if (typeof requestAnimationFrame === 'function') {
      var rafLoop = function () { update(); requestAnimationFrame(rafLoop); };
      requestAnimationFrame(rafLoop);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
