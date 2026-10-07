# Memento — Death Clock & Real-Time Death Rate

A Manifest V3 Chrome extension that replaces your new tab with a cinematic
**memento mori** page: your personal death countdown ticking backward, your life
so far ticking up, and the real-time birth/death rate for your country —
themeable, with your own background image.

**Approximate by design — a warning sign, not a diagnosis.**

## What you get

- **Hero countdown (ticks backward):** `13,510 days left` — computed from your
  birthday plus your life expectancy (see below) — with a live `hh:mm:ss.mmm`
  sub-counter (the milliseconds drain at display refresh) and a daily one-liner
  ("≈ 37 summers left. Start now.").
- **Day bar (urgency):** a thin red bar under the countdown showing today
  draining — `today · 61.4% spent`, refilling to 0% at every midnight.
  Toggleable in settings.
- **Life expectancy, your way:** by default it uses the World Bank average for
  your sex + country and says so right under the countdown ("average for a man
  in Bangladesh: 74.2 years"); or set your own estimate ("I'll live to 80") and
  the countdown switches to it.
- **Your life so far (ticks up):** `13,263 days lived · 1,145,971,852 seconds`,
  with a thin progress bar for the share of your expected life already spent.
- **Real-time death-rate row:** deaths/second, births today, deaths today, and
  net population change today — for **your country or the whole world** (your
  choice, switchable with one click) — extrapolated from World Bank crude rates
  (Worldometer-style methodology — no API publishes literal live counts).
- **Bonus mode:** if you've already outlived your expectancy, it shows
  `0 days — you're beating the average; every day is a bonus` and counts your
  bonus days up.
- **Shortcut chips:** get your most-used sites back on the new tab — click **+**
  under the wordmark to add a shortcut (favicon shown automatically, letter tile
  as fallback), hover a chip to edit or remove it. Stored locally, capped at 12,
  no new permissions.
- **Ambient backgrounds:** a quiet animated layer behind everything — an
  hourglass of red sand that piles up as the day drains (and flips at midnight),
  a dark tide that rises through the day, drifting embers and ash, or a
  heartbeat trace that occasionally flatlines. Blood-red with a soft glow on the
  dark themes, plain ink on Paper; tuned to stay in the background. Pauses
  automatically while a background image is set and goes still under
  `prefers-reduced-motion`.

### Customization (⚙ gear)

- **Life expectancy:** **World Bank average** (the modal shows what that
  average is for the picked sex + country, e.g. "avg 74.2y · man in
  Bangladesh") or **your own estimate** (20–120 years). The hero always labels
  which one it's using.
- **Themes:** Midnight (near-black), Dusk (deep blue), Ember (warm brown), and
  Paper (light ivory) — previewed instantly, reverted if you dismiss without
  saving.
- **Big number:** choose what the hero counts — your **days left**, **deaths
  today in your country**, or **deaths today worldwide**. The other numbers
  move to the row below, so nothing is lost.
- **Bottom numbers:** the rates row follows **your country** or the **world** —
  also switchable anytime with the small pill above the row ("showing:
  Bangladesh ⇄"), no modal needed.
- **Day bar:** Show or Hide the "today draining" urgency bar under the
  countdown (on by default).
- **Ambient:** the animated background mood — **None**, **Hourglass** (the
  day draining as falling sand, the default), **Rising** (a dark tide rising
  through the day), **Embers**, or **Pulse** (a heartbeat trace that sometimes
  flatlines). Previewed live in the modal, reverted if you dismiss without
  saving. The Hourglass pile and the Rising tide track the real fraction of the
  day elapsed, so reloading mid-afternoon shows an afternoon-sized pile.
- **Background image:** upload any picture from your device. It's downscaled
  locally (max 1920px, JPEG) before being stored — nothing is uploaded to any
  server — and shown behind a readability scrim. Removable anytime.
- **Birthday calendar:** a proper month-grid calendar picker (year and month
  navigation, future dates disabled) instead of the browser's native date field.

First run asks for **birthday, sex, and country** (searchable, 217 countries +
World). A ghosted ⚙ gear (bottom-right) reopens the setup anytime. Everything
stays on your device in `chrome.storage.local`.

## Install (unpacked)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select this `real-death-rate/` folder
5. Open a new tab

## Data

All figures come from the free, key-less [World Bank Open Data API](https://api.worldbank.org)
(one bulk request per indicator, most recent year):

| Indicator | Meaning |
|---|---|
| `SP.DYN.LE00.MA.IN` / `SP.DYN.LE00.FE.IN` | Life expectancy at birth, male/female |
| `SP.DYN.CDRT.IN` / `SP.DYN.CBRT.IN` | Crude death/birth rate per 1,000 |
| `SP.POP.TOTL` | Population |
| `/v2/country` | Country metadata (drops aggregates like "South Asia") |

Math: `expectedLastDay = birthday + lifeExpectancy × 365.25d`; deaths/second =
`rate/1000 × population ÷ 31,557,600`; today-counters = per-second rate ×
seconds since local midnight, resetting at 00:00.

**Resilience — the page never renders empty:** fresh 7-day cache renders
instantly with no network; a stale cache renders first and refreshes in the
background; if the API is unreachable and nothing is cached, a hardcoded world
baseline (`js/baseline.js`) takes over and the badge says "offline baseline".

## Project layout

```
real-death-rate/
├── manifest.json        # MV3, chrome_url_overrides.newtab, storage + worldbank host
├── newtab.html
├── css/newtab.css       # near-black, vignette + film grain, red accent
├── js/stats.js          # pure math: countdowns, rates (unit-testable)
├── js/api.js            # World Bank client, 7-day cache, baseline fallback
├── js/baseline.js       # generated offline fallback (world figures + country list)
├── js/app.js            # setup modal, tickers, country picker, one-liners
├── icons/icon{16,32,48,128}.png
├── tests/               # node test suites + render-test screenshots
└── tools/               # one-shot generators for baseline.js and the icons
```

No framework, no build step, no CDN — vanilla HTML/CSS/JS only.

## Verify

```sh
node tests/stats.test.js   # countdown/lived math: leap years, day boundaries, exceeded case
node tests/api.test.js     # cache lifecycle, fallbacks, aggregate filtering (+ live API check)
node tests/app.test.js     # interaction: modal, calendar, life expectancy, scope, themes, hero modes, background, shortcuts, persistence
node tests/api.test.js --offline   # skip the live-network integration test
```

Headless render checks (no Chrome profile needed — the page runs from `file://`
via a localStorage shim, and URL params stand in for saved settings):

```sh
google-chrome --headless=new --disable-gpu --screenshot=/tmp/shot.png \
  "file://$PWD/newtab.html?birthday=1990-06-15&sex=male&country=BGD&theme=dusk&hero=deaths-world"
```

URL params: `birthday`, `sex`, `country`, `theme` (midnight|dusk|ember|paper),
`hero` (days-left|deaths-country|deaths-world), `le` (custom life expectancy in
years, e.g. `80`), `scope` (country|world — which region the bottom row counts),
`daybar` (0|1 — hide/show the urgency bar), `shortcuts` (demo chips, e.g.
`GitHub|github.com,Wikipedia|wikipedia.org` — rendered but never persisted).
Omit them all to see the first-run setup modal.

## Regenerating generated files

```sh
node tools/gen-baseline.js   # refresh js/baseline.js from the live API
node tools/gen-icons.js      # redraw icons/icon*.png
```
