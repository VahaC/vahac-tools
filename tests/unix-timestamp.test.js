// tests/unix-timestamp.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const uts = loadScript('unix-timestamp-converter/script.js');

test('unix-timestamp: pad zero-fills to the requested width', () => {
  assert.equal(uts.pad(5, 2), '05');
  assert.equal(uts.pad(42, 4), '0042');
  assert.equal(uts.pad(2024, 4), '2024');
});

test('unix-timestamp: pad preserves the negative sign', () => {
  assert.equal(uts.pad(-5, 2), '-05');
});

test('unix-timestamp: detectUnit treats current-era numbers as seconds', () => {
  assert.equal(uts.detectUnit(1717000000), 's');
});

test('unix-timestamp: detectUnit treats 13-digit numbers as milliseconds', () => {
  assert.equal(uts.detectUnit(1717000000000), 'ms');
});

test('unix-timestamp: detectUnit handles negative (pre-1970) numbers by magnitude', () => {
  assert.equal(uts.detectUnit(-1000000), 's');
  assert.equal(uts.detectUnit(-1000000000000), 'ms');
});

test('unix-timestamp: parseTimestamp auto-detects seconds and converts to ms', () => {
  const result = uts.parseTimestamp('1717000000', 'auto');
  assert.equal(result.unit, 's');
  assert.equal(result.ms, 1717000000000);
});

test('unix-timestamp: parseTimestamp auto-detects milliseconds', () => {
  const result = uts.parseTimestamp('1717000000000', 'auto');
  assert.equal(result.unit, 'ms');
  assert.equal(result.ms, 1717000000000);
});

test('unix-timestamp: parseTimestamp respects an explicit unit override', () => {
  const result = uts.parseTimestamp('1717000000', 's');
  assert.equal(result.unit, 's');
  assert.equal(result.ms, 1717000000000);
});

test('unix-timestamp: parseTimestamp accepts fractional seconds', () => {
  const result = uts.parseTimestamp('1717000000.5', 's');
  assert.equal(result.ms, 1717000000500);
});

test('unix-timestamp: parseTimestamp accepts negative timestamps', () => {
  const result = uts.parseTimestamp('-3600', 's');
  assert.equal(result.ms, -3600000);
});

test('unix-timestamp: parseTimestamp throws on empty input', () => {
  assert.throws(() => uts.parseTimestamp('', 'auto'), /Enter a timestamp/);
});

test('unix-timestamp: parseTimestamp throws on non-numeric input', () => {
  assert.throws(() => uts.parseTimestamp('not-a-number', 'auto'), /must be a plain number/);
});

test('unix-timestamp: formatISO returns a correct ISO 8601 string', () => {
  assert.equal(uts.formatISO(0), '1970-01-01T00:00:00.000Z');
  assert.equal(uts.formatISO(1717000000000), '2024-05-29T16:26:40.000Z');
});

test('unix-timestamp: formatUTC returns a correct UTC string', () => {
  assert.equal(uts.formatUTC(0), 'Thu, 01 Jan 1970 00:00:00 GMT');
});

test('unix-timestamp: formatLocal includes the year, date, and a UTC offset suffix', () => {
  const str = uts.formatLocal(1717000000000);
  assert.match(str, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
});

test('unix-timestamp: msToUnixSeconds truncates toward negative infinity via floor', () => {
  assert.equal(uts.msToUnixSeconds(1717000000000), 1717000000);
  assert.equal(uts.msToUnixSeconds(1717000000999), 1717000000);
});

test('unix-timestamp: relativeTime reports "just now" for sub-5-second differences', () => {
  const now = 1717000000000;
  assert.equal(uts.relativeTime(now + 2000, now), 'just now');
  assert.equal(uts.relativeTime(now - 2000, now), 'just now');
});

test('unix-timestamp: relativeTime reports past differences with "ago"', () => {
  const now = 1717000000000;
  assert.equal(uts.relativeTime(now - 60000, now), '1 minute ago');
  assert.equal(uts.relativeTime(now - 7200000, now), '2 hours ago');
});

test('unix-timestamp: relativeTime reports future differences with "in"', () => {
  const now = 1717000000000;
  assert.equal(uts.relativeTime(now + 86400000, now), 'in 1 day');
  assert.equal(uts.relativeTime(now + 3 * 86400000, now), 'in 3 days');
});

test('unix-timestamp: dateTimeLocalToEpoch(treatAsUtc=true) matches Date.UTC', () => {
  const ms = uts.dateTimeLocalToEpoch('2024-05-29T16:26:40', true);
  assert.equal(ms, Date.UTC(2024, 4, 29, 16, 26, 40));
});

test('unix-timestamp: dateTimeLocalToEpoch(treatAsUtc=false) matches local Date construction', () => {
  const ms = uts.dateTimeLocalToEpoch('2024-05-29T16:26:40', false);
  assert.equal(ms, new Date(2024, 4, 29, 16, 26, 40).getTime());
});

test('unix-timestamp: dateTimeLocalToEpoch accepts input without seconds', () => {
  const ms = uts.dateTimeLocalToEpoch('2024-05-29T16:26', true);
  assert.equal(ms, Date.UTC(2024, 4, 29, 16, 26, 0));
});

test('unix-timestamp: dateTimeLocalToEpoch throws on malformed input', () => {
  assert.throws(() => uts.dateTimeLocalToEpoch('not-a-date', true), /valid date and time/);
});
