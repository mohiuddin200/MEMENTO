/*
 * Unit tests for js/stats.js — plain node:assert, no framework.
 * Run: node tests/stats.test.js   (exit 0 = pass)
 */
'use strict';
const assert = require('assert');
const S = require('../js/stats.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('FAIL  ' + name);
    console.error(e && e.stack || e);
    process.exitCode = 1;
  }
}

// ---- expectedLastDay / countdown basics ----

test('expectedLastDay = birthday + expectancy (Julian years)', () => {
  const b = new Date(1990, 5, 15).getTime(); // 1990-06-15 local
  assert.strictEqual(S.expectedLastDayMs(b, 80), b + 80 * S.MS_PER_YEAR);
});

test('countdown days for a known span (100.0 years from 2000-01-01)', () => {
  // exactly 36525 days → last day 2099-12-26T00:00 local-ish; test at birthday+1day
  const b = '2000-01-01';
  const now = new Date(2000, 0, 2, 12, 0, 0); // 1.5 days in
  const cd = S.countdown(b, 100, now);
  assert.strictEqual(cd.exceeded, false);
  assert.strictEqual(cd.days, 36525 - 2); // 1.5 days elapsed → 2 boundaries? floor(36525d - 1.5d)
  // days = floor((36525d - 1.5d)/1d) = 36523
  assert.strictEqual(cd.days, 36523);
  assert.strictEqual(cd.hours, 12);
  assert.strictEqual(cd.minutes, 0);
  assert.strictEqual(cd.seconds, 0);
});

test('countdown counts down by exactly 1s per second', () => {
  const now = new Date(2026, 9, 7, 10, 30, 0).getTime();
  const a = S.countdown('1990-06-15', 80, now);
  const b = S.countdown('1990-06-15', 80, now + 1000);
  assert.strictEqual(a.totalSeconds - b.totalSeconds, 1);
});

test('countdown components match totalSeconds', () => {
  const now = new Date(2026, 9, 7, 10, 30, 0).getTime();
  const cd = S.countdown('1990-06-15', 80, now);
  assert.strictEqual(cd.days * 86400 + cd.hours * 3600 + cd.minutes * 60 + cd.seconds,
                     cd.totalSeconds);
  assert.ok(cd.hours < 24 && cd.minutes < 60 && cd.seconds < 60);
});

test('countdown milliseconds: sub-second remainder, drains toward the next tick', () => {
  const end = S.expectedLastDayMs('2000-01-01', 100);
  const t = Date.UTC(2010, 5, 1, 12, 30, 0, 200);
  const a = S.countdown('2000-01-01', 100, t);
  const b = S.countdown('2000-01-01', 100, t + 400);
  assert.ok(a.milliseconds >= 0 && a.milliseconds <= 999, 'in [0, 999]');
  assert.strictEqual(a.milliseconds, (end - t) % 1000, 'exact sub-second remainder');
  assert.strictEqual(b.milliseconds, (a.milliseconds + 600) % 1000, 'drains as time passes');
});

// ---- leap years ----

test('days lived across a leap year (2000-01-01 → 2001-01-01 = 366 days)', () => {
  const lived = S.lifeSoFar('2000-01-01', new Date(2001, 0, 1).getTime());
  assert.strictEqual(lived.days, 366);
  assert.strictEqual(lived.totalSeconds, 366 * 86400);
});

test('non-leap year gives 365 days (2001-01-01 → 2002-01-01)', () => {
  const lived = S.lifeSoFar('2001-01-01', new Date(2002, 0, 1).getTime());
  assert.strictEqual(lived.days, 365);
});

test('leap-day birthday (2000-02-29) lived through 2026', () => {
  const lived = S.lifeSoFar('2000-02-29', new Date(2026, 1, 29).getTime());
  // 26 years, 7 of them leap (2000,2004,...,2024) → 26*365 + 7 = 9497 days
  assert.strictEqual(lived.days, 9497);
});

test('countdown spans multiple leap years consistently', () => {
  const b = '2000-02-29';
  const end = S.expectedLastDayMs(b, 76);
  // 1s before the end: 0 days, 00:00:01 left
  const cd = S.countdown(b, 76, end - 1000);
  assert.strictEqual(cd.days, 0);
  assert.strictEqual(cd.hours, 0);
  assert.strictEqual(cd.minutes, 0);
  assert.strictEqual(cd.seconds, 1);
  // a day and a second before the end: 1 day, 00:00:01
  const cd2 = S.countdown(b, 76, end - 86400000 - 1000);
  assert.strictEqual(cd2.days, 1);
  assert.strictEqual(cd2.seconds, 1);
});

// ---- midnight / day-boundary rollover ----

test('midnight rollover: 1ms before end → 0d 00:00:00; at end → exceeded', () => {
  const b = '1990-06-15';
  const end = S.expectedLastDayMs(b, 80);
  const before = S.countdown(b, 80, end - 1);
  assert.strictEqual(before.exceeded, false);
  assert.strictEqual(before.days, 0);
  assert.strictEqual(before.totalSeconds, 0);
  assert.strictEqual(before.hours, 0);
  assert.strictEqual(before.minutes, 0);
  assert.strictEqual(before.seconds, 0);

  const after = S.countdown(b, 80, end + 1);
  assert.strictEqual(after.exceeded, true);
  assert.strictEqual(after.days, 0);
  assert.strictEqual(after.bonusDays, 0);
});

test('day boundary: remaining time crossing a 24h multiple flips days by one', () => {
  const b = '1990-06-15';
  const end = S.expectedLastDayMs(b, 80);
  const at3d = S.countdown(b, 80, end - 3 * 86400000);
  const justPrior = S.countdown(b, 80, end - 3 * 86400000 + 1000); // 1s later: 2d 23:59:59 left
  assert.strictEqual(at3d.days, 3);
  assert.strictEqual(at3d.hours, 0);
  assert.strictEqual(justPrior.days, 2);       // 2 days 23:59:59
  assert.strictEqual(justPrior.hours, 23);
  assert.strictEqual(justPrior.minutes, 59);
  assert.strictEqual(justPrior.seconds, 59);
});

// ---- expectancy exceeded ----

test('exceeded: birthday long past, tiny expectancy', () => {
  const cd = S.countdown('1930-01-01', 60, new Date(2026, 9, 7).getTime());
  assert.strictEqual(cd.exceeded, true);
  assert.strictEqual(cd.days, 0);
  assert.strictEqual(cd.hours, 0);
  assert.ok(cd.bonusDays > 3650); // >10 years past the average
});

test('exceeded exactly at boundary ms → exceeded, zero bonus', () => {
  const b = '1950-01-01';
  const end = S.expectedLastDayMs(b, 70);
  const cd = S.countdown(b, 70, end);
  assert.strictEqual(cd.exceeded, true);
  assert.strictEqual(cd.bonusDays, 0);
});

// ---- expectancyYears selection ----

test('expectancyYears picks sex-specific value with fallbacks', () => {
  const le = { male: 70, female: 76 };
  assert.strictEqual(S.expectancyYears(le, 'male'), 70);
  assert.strictEqual(S.expectancyYears(le, 'female'), 76);
  assert.strictEqual(S.expectancyYears({ female: 76 }, 'male'), 76);
  assert.strictEqual(S.expectancyYears({}, 'male'), 73);
});

// ---- death-rate math ----

test('perSecond: World baseline ≈ 1.96 deaths/s', () => {
  // 7.5507/1000 × 8,215,424,893 ÷ 31,557,600
  const r = S.perSecond(7.55065418868632, 8215424893);
  assert.ok(Math.abs(r - 1.966) < 0.01, 'got ' + r);
});

test('perSecond sanity: rate 1000/1000 × 31557600 people = 1/s', () => {
  assert.ok(Math.abs(S.perSecond(1000, 31557600) - 1) < 1e-9);
});

test('todayCount: zero at local midnight, grows linearly', () => {
  const rate = 10, pop = 1000; // 10/1000*1000/31557600 s^-1
  const midnight = new Date(2026, 9, 7, 0, 0, 0);
  const t0 = S.todayCount(rate, pop, midnight.getTime());
  assert.strictEqual(t0.count, 0);
  assert.strictEqual(t0.seconds, 0);
  const noon = S.todayCount(rate, pop, new Date(2026, 9, 7, 12, 0, 0).getTime());
  assert.strictEqual(noon.seconds, 43200);
  assert.ok(Math.abs(noon.count - noon.ratePerSecond * 43200) < 1e-9);
});

test('secondsSinceMidnight resets across midnight', () => {
  const late = new Date(2026, 9, 7, 23, 59, 59);
  const next = new Date(2026, 9, 8, 0, 0, 1);
  assert.strictEqual(S.secondsSinceMidnight(late.getTime()), 86399);
  assert.strictEqual(S.secondsSinceMidnight(next.getTime()), 1);
});

// ---- one-liner ingredients ----

test('summers/sundays/moons rounding', () => {
  assert.strictEqual(S.summersLeft(18263), 50); // 50.0002 → 50
  assert.strictEqual(S.sundaysLeft(18263), 2609);
  assert.strictEqual(S.fullMoonsLeft(18263), 618);
});

test('dayFraction: 0 at midnight, 0.5 at noon, 1 just before next midnight', () => {
  const noon = new Date(2026, 9, 7, 12, 0, 0).getTime();
  assert.strictEqual(S.dayFraction(new Date(2026, 9, 7, 0, 0, 0, 0)), 0);
  assert.strictEqual(S.dayFraction(noon), 0.5);
  assert.ok(S.dayFraction(new Date(2026, 9, 7, 23, 59, 59, 999)) > 0.9999);
  assert.ok(S.dayFraction(noon) >= 0 && S.dayFraction(noon) <= 1, 'clamped to [0,1]');
});

test('percentLived clamps to [0,100]', () => {
  assert.ok(Math.abs(S.percentLived(9497, 76) - 34.24) < 0.05);
  assert.strictEqual(S.percentLived(999999, 76), 100);
  assert.strictEqual(S.percentLived(-5, 76), 0);
});

console.log(passed + ' passed, ' + (process.exitCode ? 'FAILURES' : '0 failed'));
