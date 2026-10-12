# Chrome Web Store listing — Memento 1.3.0

Copy-paste values for the developer dashboard, tab by tab. The images are in
this folder. The package is `memento-1.3.0.zip` in the repo root, and it
matches the current source.

---

## Package

- Upload `memento-1.3.0.zip` from the repo root (only if the dashboard asks
  for a new package — version 1.3.0).

---

## Store listing tab

### Description

```
Memento turns every new tab into a quiet memento mori: a live countdown of the days you likely have left, plus the real-time birth and death rate for your country or the whole world.

It isn't meant to be morbid. It's a nudge, every time you open a tab, to spend today on what matters.

ON EVERY NEW TAB
• Days left: your personal countdown, ticking live to the millisecond, based on your birthday and life expectancy
• Today, draining: a thin bar showing how much of today is already spent
• Your life so far: days and seconds lived, with a progress bar for the share of your expected life already behind you
• Real-time death rate: deaths per second, births today, deaths today and net population change, for your country or the world (switch with one click)
• A daily one-liner, like "≈ 37 summers left. Start now."
• Your shortcuts: pin up to 12 favorite sites right under the countdown
• Bonus mode: outlived the average? It counts your bonus days instead

MAKE IT YOURS
• Four themes: Paper (light), Midnight, Dusk and Ember
• Ambient backgrounds: falling hourglass sand, a rising tide, drifting embers, a heartbeat that sometimes flatlines, or none at all
• Choose the big number: your days left, deaths today in your country, or deaths today worldwide
• Life expectancy your way: the average for someone of your age, sex and country, or your own estimate
• Your own background photo, resized and stored on your device
• Every option previews live; dismiss and it reverts

SET UP IN SECONDS
Answer three questions (birthday, sex and country; 217 countries plus World) and every tab starts counting. Change anything later with the gear icon.

PRIVATE BY DESIGN
• Everything you enter stays on your device, in Chrome's local storage
• No account, no sign-up, no analytics, no tracking
• The extension only contacts the free World Bank Open Data API for life-expectancy and population figures (cached for 7 days, with a built-in offline fallback); shortcut icons come from Chrome's own favicon cache, so the sites you add are never contacted
• Animations go still if your system asks to reduce motion

ABOUT THE NUMBERS
Life expectancy comes from the UN World Population Prospects life tables and is adjusted for your current age (an adult's expectancy is higher than the at-birth figure). Crude birth and death rates and population come from the World Bank. The live counters are extrapolated from those yearly rates, the same method Worldometer-style counters use, and reset at your local midnight. Memento is approximate by design: a warning sign, not a diagnosis.

Website and privacy policy: https://memento-deathclock.vercel.app
```

### Category and language

- **Category:** Lifestyle → Well-being
- **Language:** English

### Graphic assets (all files in `store/listing/`)

| Field | File |
|---|---|
| Store icon (128×128) | `icons/icon128.png` (repo root) |
| Screenshot 1 | `01-countdown-1280x800.png` |
| Screenshot 2 | `02-world-live-1280x800.png` |
| Screenshot 3 | `03-customize-1280x800.png` |
| Screenshot 4 | `04-shortcuts-1280x800.png` |
| Screenshot 5 | `05-private-setup-1280x800.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `promo-marquee-1400x560.png` |
| Global promo video | leave empty |

### Additional fields

- **Official URL:** none (leave empty unless you have a verified site)
- **Homepage URL:** `https://memento-deathclock.vercel.app`
- **Support URL:** `https://github.com/mohiuddin200/MEMENTO/issues`
- **Mature content:** No

---

## Privacy practices tab

### Single purpose description

```
Replaces Chrome's new tab page with a memento mori dashboard: a personal life countdown based on the user's birthday and life expectancy, alongside real-time birth and death rate estimates for the user's country or the world.
```

### Permission justifications

**storage**

```
Saves the user's settings (birthday, sex, country, theme and display options), their shortcut list, and a 7-day cache of World Bank figures in chrome.storage.local, so the new tab renders instantly and works offline. Nothing is synced or sent anywhere.
```

**unlimitedStorage**

```
Users can set their own background image. It is downscaled (max 1920px, JPEG) and stored locally as a data URL; together with the cached World Bank dataset this can exceed the default chrome.storage.local quota. The data never leaves the device.
```

**favicon**

```
Shows the icon of each shortcut the user adds to the new tab, read from Chrome's own local favicon cache, so the shortcut's website is never contacted.
```

**Host permission (https://api.worldbank.org/\*)**

```
Fetches public life-expectancy, crude birth/death rate and population indicators from the World Bank Open Data API (no API key, no user data sent). Results are cached locally for 7 days, with a bundled offline fallback.
```

### Remote code

- **No, I am not using remote code.** All JavaScript ships inside the package.

### Data usage

- **What user data do you collect:** tick **Personally identifiable
  information** (birthday/age, sex) and **Location** (country). Leave the
  rest unchecked. The Chrome Web Store requires disclosing data an extension
  handles "even when data is processed or stored locally on a user's device"
  ([user data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)),
  even though Memento never sends it anywhere.
- **Certifications:** these are your own statements to Google; tick the
  three boxes if you agree with them (no selling of data, no unrelated use,
  no creditworthiness/lending use).
- **Privacy policy URL:** `https://memento-deathclock.vercel.app/#privacy`

---

## Distribution tab

- **Payments:** Free
- **Visibility:** Public
- **Regions:** All regions
