# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Extension: Manifest V3, vanilla HTML/CSS/JS, no build step. Landing page (`site/`): static HTML/CSS, deployed to Vercel (project `memento-deathclock`, personal hobby scope).

## Users

Chrome users who want a daily nudge to spend their time on purpose. They meet Memento every time they open a new tab, for a second or two, between other tasks.

## Product Purpose

Memento replaces Chrome's new tab page with a memento mori: a personal countdown of the days the user likely has left (birthday + UN life-table expectancy for their current age, or their own estimate) and real-time birth/death rate estimates for their country or the world. Success is the user glancing at it and choosing to spend today better.

## Positioning

A death clock that is honest about its numbers: UN life tables (age-adjusted) and World Bank crude rates, approximate by design ("a warning sign, not a diagnosis"), with everything kept on the user's device.

## Capabilities and Constraints

- Days-left countdown with a live hh:mm:ss.mmm sub-counter; bonus-days mode once the expectancy is passed.
- Day bar (today draining), life-so-far line and progress bar, daily one-liner.
- Real-time deaths/second, births today, deaths today, net change today for one country (217 + World) or the world.
- Shortcut chips (max 12), five themes (Snow — the default, Paper, Dawn, Linen, Midnight) plus a System option that follows the device's light/dark mode, seven ambient modes (Nebula — the default, Hourglass, Stars, Rising, Embers, Pulse, None), hero choice (days left / country deaths / world deaths), own background image.
- Permissions: `storage`, `unlimitedStorage`, `favicon`, host `https://api.worldbank.org/*`. No analytics, no accounts, no remote code.
- Chrome Web Store item ID: `khkpihpkonaehkepjhdcpjnnjghflecj`. Listing may still be in review.

## Brand Commitments

- Name: Memento (wordmark "MEMENTO MORI" inside the extension).
- Store and landing visuals use the light Paper theme: ivory ground, ink text, red accent, Georgia-style serif numerals.
- Icon: an hourglass mid-drain on an ivory rounded square (`icons/`).

## Evidence on Hand

- Real product screenshots and store images: `store/listing/`.
- No users, reviews, ratings, press or install counts exist yet; do not invent them.

## Product Principles

- Truthful numbers: every figure traces to UN or World Bank data and is labelled approximate.
- Private by default: nothing leaves the device except requests for public World Bank data; shortcut icons come from Chrome's local favicon cache.
- Quiet, not morbid: urgency through restraint, never shock.
