// tests/byte-storage-converter.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const bsc = loadScript('byte-storage-converter/script.js');

test('byte-storage: BYTES table values are correct', () => {
  assert.equal(bsc.BYTES.B, 1);
  assert.equal(bsc.BYTES.KB, 1e3);
  assert.equal(bsc.BYTES.MB, 1e6);
  assert.equal(bsc.BYTES.GB, 1e9);
  assert.equal(bsc.BYTES.TB, 1e12);
  assert.equal(bsc.BYTES.PB, 1e15);
  assert.equal(bsc.BYTES.KiB, 1024);
  assert.equal(bsc.BYTES.MiB, 1024 ** 2);
  assert.equal(bsc.BYTES.GiB, 1024 ** 3);
  assert.equal(bsc.BYTES.TiB, 1024 ** 4);
  assert.equal(bsc.BYTES.PiB, 1024 ** 5);
});

test('byte-storage: BPS table values are correct', () => {
  assert.equal(bsc.BPS.bps, 1);
  assert.equal(bsc.BPS.Kbps, 1e3);
  assert.equal(bsc.BPS.Mbps, 1e6);
  assert.equal(bsc.BPS.Gbps, 1e9);
});

test('byte-storage: ALL_UNITS contains both decimal and binary units', () => {
  assert.equal(bsc.ALL_UNITS.length, 11);
  for (const u of bsc.DECIMAL_UNITS) assert.ok(bsc.ALL_UNITS.includes(u));
  for (const u of bsc.BINARY_UNITS) assert.ok(bsc.ALL_UNITS.includes(u));
});

test('byte-storage: smartFormat handles zero', () => {
  assert.equal(bsc.smartFormat(0), '0');
});

test('byte-storage: smartFormat uses exponential for very small', () => {
  const result = bsc.smartFormat(1e-12);
  assert.match(result, /e/);
});

test('byte-storage: smartFormat removes trailing zeros for small values', () => {
  const result = bsc.smartFormat(0.0001);
  // 0.0001 with toPrecision(5) → "0.00010000" → "0.0001"
  assert.equal(result, '0.0001');
});

test('byte-storage: smartFormat uses locale string for large', () => {
  assert.equal(bsc.smartFormat(1234567), '1,234,567');
});

test('byte-storage: smartFormat handles negative numbers', () => {
  assert.equal(bsc.smartFormat(-1000), '-1,000');
});

test('byte-storage: formatStorage 1024 bytes → 1 KiB (numeric only)', () => {
  assert.equal(bsc.formatStorage(1024, 'KiB'), '1');
});

test('byte-storage: formatStorage 1000000 bytes → 1 MB', () => {
  assert.equal(bsc.formatStorage(1_000_000, 'MB'), '1');
});

test('byte-storage: formatStorage 1 GB → 1,000,000,000 B', () => {
  assert.equal(bsc.formatStorage(1e9, 'B'), '1,000,000,000');
});

test('byte-storage: formatStorage 1 TiB → 1,024 GiB', () => {
  assert.equal(bsc.formatStorage(1024 ** 4, 'GiB'), '1,024');
});

test('byte-storage: bitrate→size math (5 Mbps for 60s = 37.5 MB)', () => {
  const bytes = (5 * 1e6 * 60) / 8;
  assert.equal(bytes, 37_500_000);
  assert.equal(bsc.formatStorage(bytes, 'MB'), '37.5');
});

test('byte-storage: size→bitrate math (100 MB over 60s = 13.333... Mbps)', () => {
  const bytes = 100 * 1e6;
  const bps = (bytes * 8) / 60;
  const mbps = bps / 1e6;
  assert.ok(Math.abs(mbps - 13.333333333333334) < 1e-9);
});
