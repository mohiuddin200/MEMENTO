/*
 * Memento — pure math for the death clock and the death-rate counters.
 * No DOM, no storage, no fetch: everything here is unit-testable in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MementoStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MS_PER_YEAR = 31557600000; // 365.25-day Julian year (31,557,600 s)
  var MS_PER_DAY = 86400000;

  // Accepts Date, ISO string ("1990-06-15" parsed as local midnight) or epoch ms.
  function toMs(dateLike) {
    if (dateLike instanceof Date) return dateLike.getTime();
    if (typeof dateLike === 'string') {
      var isoDay = /^\d{4}-\d{2}-\d{2}$/.test(dateLike);
      return new Date(isoDay ? dateLike + 'T00:00:00' : dateLike).getTime();
    }
    return dateLike;
  }

  function expectedLastDayMs(birthday, lifeExpectancyYears) {
    return toMs(birthday) + lifeExpectancyYears * MS_PER_YEAR;
  }

  // ms (positive or zero) → whole days plus an hh:mm:ss.mmm remainder.
  function breakdown(ms) {
    var abs = Math.max(0, ms);
    var totalSeconds = Math.floor(abs / 1000);
    var days = Math.floor(totalSeconds / 86400);
    var rem = totalSeconds - days * 86400;
    return {
      totalSeconds: totalSeconds,
      days: days,
      hours: Math.floor(rem / 3600),
      minutes: Math.floor(rem / 60) % 60,
      seconds: rem % 60,
      milliseconds: Math.floor(abs % 1000),
    };
  }

  // The hero number: whole days (and hh:mm:ss) between now and
  // birthday + life expectancy. If that moment has passed, `exceeded`
  // is true and days is pinned to 0 — the UI shows the bonus-days line.
  function countdown(birthday, lifeExpectancyYears, now) {
    var nowMs = now == null ? Date.now() : toMs(now);
    var msLeft = expectedLastDayMs(birthday, lifeExpectancyYears) - nowMs;
    if (msLeft <= 0) {
      return {
        exceeded: true, msLeft: 0, totalSeconds: 0,
        days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0,
        bonusDays: Math.max(0, Math.floor(-msLeft / MS_PER_DAY)),
      };
    }
    var b = breakdown(msLeft);
    b.exceeded = false;
    b.bonusDays = 0;
    return b;
  }

  // Ticks up: full days and full seconds since birth.
  function lifeSoFar(birthday, now) {
    var nowMs = now == null ? Date.now() : toMs(now);
    return breakdown(nowMs - toMs(birthday));
  }

  // Pick the sex-specific life expectancy out of {male, female},
  // falling back to the other side or the pair's mean.
  function expectancyYears(le, sex) {
    var m = le && le.male;
    var f = le && le.female;
    if (sex === 'male') return m != null ? m : (f != null ? f : 73);
    if (sex === 'female') return f != null ? f : (m != null ? m : 73);
    if (m != null && f != null) return (m + f) / 2;
    return m != null ? m : (f != null ? f : 73);
  }

  // Crude rate per 1,000 people per year → events per second
  // (Worldometer-style extrapolation from annual figures).
  function perSecond(ratePer1000, population) {
    return (ratePer1000 / 1000) * population / 31557600;
  }

  // Whole seconds elapsed since local midnight (today-counters reset at 00:00).
  function secondsSinceMidnight(now) {
    var d = now == null ? new Date() : new Date(toMs(now));
    var midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    var secs = Math.floor((d.getTime() - midnight.getTime()) / 1000);
    return Math.max(0, secs);
  }

  // Fraction [0, 1) of the local day already elapsed — the "today is
  // draining" urgency bar. Sub-second smooth so it animates every frame.
  function dayFraction(now) {
    var d = now == null ? new Date() : new Date(toMs(now));
    var midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    var f = (d.getTime() - midnight.getTime()) / MS_PER_DAY;
    return Math.max(0, Math.min(1, f));
  }

  function todayCount(ratePer1000, population, now) {
    var rate = perSecond(ratePer1000, population);
    var secs = secondsSinceMidnight(now);
    return { ratePerSecond: rate, seconds: secs, count: rate * secs };
  }

  // One-liner ingredients.
  function summersLeft(days) { return Math.round(days / 365.25); }
  function sundaysLeft(days) { return Math.round(days / 7); }
  function fullMoonsLeft(days) { return Math.round(days / 29.53059); }
  function breathsLeft(days) { return Math.round(days * 86400 * (16 / 60)); } // ~16 breaths/min
  function heartbeatsLeft(days) { return Math.round(days * 86400 * (80 / 60)); } // ~80 bpm
  function percentLived(daysLived, expectancyYears) {
    var totalDays = expectancyYears * 365.25;
    if (totalDays <= 0) return 100;
    return Math.max(0, Math.min(100, (daysLived / totalDays) * 100));
  }

  return {
    MS_PER_YEAR: MS_PER_YEAR,
    MS_PER_DAY: MS_PER_DAY,
    toMs: toMs,
    expectedLastDayMs: expectedLastDayMs,
    breakdown: breakdown,
    countdown: countdown,
    lifeSoFar: lifeSoFar,
    expectancyYears: expectancyYears,
    perSecond: perSecond,
    secondsSinceMidnight: secondsSinceMidnight,
    dayFraction: dayFraction,
    todayCount: todayCount,
    summersLeft: summersLeft,
    sundaysLeft: sundaysLeft,
    fullMoonsLeft: fullMoonsLeft,
    breathsLeft: breathsLeft,
    heartbeatsLeft: heartbeatsLeft,
    percentLived: percentLived,
  };
});
