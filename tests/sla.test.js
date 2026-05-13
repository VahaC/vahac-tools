// tests/sla.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const sla = loadScript('sla-calculator/script.js');

test('sla: time constants are correct', () => {
  assert.equal(sla.DAY_SECS, 86400);
  assert.equal(sla.WEEK_SECS, 7 * 86400);
  assert.equal(sla.YEAR_SECS, 365.25 * 86400);
  assert.equal(sla.MONTH_SECS, (365.25 * 86400) / 12);
});

test('sla: countNines basic values', () => {
  assert.equal(sla.countNines(90), 1);
  assert.equal(sla.countNines(99), 2);
  assert.equal(sla.countNines(99.9), 3);
  assert.equal(sla.countNines(99.99), 4);
  assert.equal(sla.countNines(99.999), 5);
  assert.ok(Math.abs(sla.countNines(99.5) - 2.301029995663981) < 1e-12);
});

test('sla: countNines edge cases', () => {
  assert.equal(sla.countNines(100), 9);   // capped
  assert.equal(sla.countNines(0), 0);
});

test('sla: getColor thresholds', () => {
  assert.equal(sla.getColor(99.99), 'green');
  assert.equal(sla.getColor(99.999), 'green');
  assert.equal(sla.getColor(99.9), 'cyan');
  assert.equal(sla.getColor(99.95), 'cyan');
  assert.equal(sla.getColor(99), 'amber');
  assert.equal(sla.getColor(98), 'red');
  assert.equal(sla.getColor(50), 'red');
});

test('sla: ninesLabel basic ranges', () => {
  assert.equal(sla.ninesLabel(0), '< 1 Nine');
  assert.equal(sla.ninesLabel(1), 'One Nine');
  assert.equal(sla.ninesLabel(2), 'Two Nines');
  assert.equal(sla.ninesLabel(3), 'Three Nines');
  assert.equal(sla.ninesLabel(7), 'Seven+ Nines');
  assert.equal(sla.ninesLabel(15), 'Seven+ Nines'); // capped
});

test('sla: downtimesFor 99.9% per year ≈ 8.766 hours', () => {
  const d = sla.downtimesFor(99.9);
  const hoursPerYear = d.year / 3600;
  assert.ok(Math.abs(hoursPerYear - 8.7658) < 0.001);
});

test('sla: downtimesFor 99.999% per year ≈ 5.26 minutes', () => {
  const d = sla.downtimesFor(99.999);
  const minutesPerYear = d.year / 60;
  assert.ok(Math.abs(minutesPerYear - 5.2596) < 0.001);
});

test('sla: downtimesFor 100% means 0 downtime', () => {
  const d = sla.downtimesFor(100);
  assert.equal(d.year, 0);
  assert.equal(d.month, 0);
  assert.equal(d.week, 0);
  assert.equal(d.day, 0);
});

test('sla: formatSla strips trailing zeros', () => {
  assert.equal(sla.formatSla(99.9), '99.9%');
  assert.equal(sla.formatSla(99.999), '99.999%');
  assert.equal(sla.formatSla(99), '99%');
  assert.equal(sla.formatSla(99.5), '99.5%');
});

test('sla: formatSecs handles zero and sub-second', () => {
  assert.equal(sla.formatSecs(0), '0s');
  assert.equal(sla.formatSecs(-1), '0s');
  assert.match(sla.formatSecs(0.5), /ms$/);
});

test('sla: formatSecs days/hours/minutes/seconds composition', () => {
  assert.equal(sla.formatSecs(60), '1m');
  assert.equal(sla.formatSecs(3600), '1h');
  assert.equal(sla.formatSecs(86400), '1d');
  assert.equal(sla.formatSecs(90061), '1d 1h 1m 1s');
});

test('sla: formatSecs uses fractional seconds when needed', () => {
  const r = sla.formatSecs(1.5);
  assert.equal(r, '1.50s');
});

test('sla: buildDots returns 6 dots with correct full count', () => {
  // 3 full + 3 empty
  const html = sla.buildDots(3);
  const fullCount = (html.match(/sla-dot-full/g) || []).length;
  const emptyCount = (html.match(/sla-dot-empty/g) || []).length;
  assert.equal(fullCount, 3);
  assert.equal(emptyCount, 3);
});

test('sla: buildDots caps at 6 full', () => {
  const html = sla.buildDots(9);
  const fullCount = (html.match(/sla-dot-full/g) || []).length;
  assert.equal(fullCount, 6);
});

test('sla: REF_TIERS contains common SLA targets', () => {
  assert.ok(sla.REF_TIERS.includes(99));
  assert.ok(sla.REF_TIERS.includes(99.9));
  assert.ok(sla.REF_TIERS.includes(99.99));
});
