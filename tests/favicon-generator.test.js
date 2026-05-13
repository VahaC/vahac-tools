// tests/favicon-generator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const fvg = loadScript('favicon-generator/script.js');

test('favicon: SIZES list is well-formed', () => {
  assert.ok(Array.isArray(fvg.SIZES));
  assert.ok(fvg.SIZES.length >= 5);
  for (const s of fvg.SIZES) {
    assert.equal(typeof s.name, 'string');
    assert.ok(s.w > 0 && s.h > 0);
    assert.equal(typeof s.ico, 'boolean');
  }
});

test('favicon: exactly two sizes marked for .ico (16, 32)', () => {
  const ico = fvg.SIZES.filter(s => s.ico);
  assert.equal(ico.length, 2);
  const widths = ico.map(s => s.w).sort((a, b) => a - b);
  assert.deepEqual(widths, [16, 32]);
});

test('favicon: SIZES include Apple Touch + Android PWA assets', () => {
  const names = fvg.SIZES.map(s => s.name);
  assert.ok(names.some(n => n.includes('apple-touch-icon')));
  assert.ok(names.some(n => n.includes('android-chrome-192')));
  assert.ok(names.some(n => n.includes('android-chrome-512')));
});

// --- buildIco binary layout ---------------------------------------------

function makeFakePng(width, height, payloadLen) {
  // We only need a Uint8Array of arbitrary bytes — buildIco does not
  // validate that the data is actually a PNG.
  const data = new Uint8Array(payloadLen);
  for (let i = 0; i < payloadLen; i++) data[i] = (i * 31 + 7) & 0xff;
  return { width, height, data };
}

test('favicon: buildIco header is correct (reserved=0, type=1, count=N)', () => {
  const images = [makeFakePng(16, 16, 100), makeFakePng(32, 32, 200)];
  const out = fvg.buildIco(images);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  assert.equal(dv.getUint16(0, true), 0);  // reserved
  assert.equal(dv.getUint16(2, true), 1);  // type = ICO
  assert.equal(dv.getUint16(4, true), 2);  // count
});

test('favicon: buildIco directory entries describe each image', () => {
  const images = [makeFakePng(16, 16, 100), makeFakePng(32, 32, 200)];
  const out = fvg.buildIco(images);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const HEADER = 6, DIR = 16;
  for (let i = 0; i < images.length; i++) {
    const base = HEADER + i * DIR;
    assert.equal(out[base + 0], images[i].width);
    assert.equal(out[base + 1], images[i].height);
    assert.equal(out[base + 2], 0); // palette count
    assert.equal(out[base + 3], 0); // reserved
    assert.equal(dv.getUint16(base + 4, true), 1);     // planes
    assert.equal(dv.getUint16(base + 6, true), 32);    // bpp
    assert.equal(dv.getUint32(base + 8, true), images[i].data.length);
  }
});

test('favicon: buildIco width/height 256 stored as byte 0', () => {
  const out = fvg.buildIco([makeFakePng(256, 256, 50)]);
  assert.equal(out[6 + 0], 0);
  assert.equal(out[6 + 1], 0);
});

test('favicon: buildIco image data offsets and content correct', () => {
  const a = makeFakePng(16, 16, 64);
  const b = makeFakePng(32, 32, 128);
  const out = fvg.buildIco([a, b]);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);

  const HEADER = 6, DIR = 16, dataStart = HEADER + 2 * DIR;
  const offA = dv.getUint32(HEADER + 12, true);
  const offB = dv.getUint32(HEADER + DIR + 12, true);

  assert.equal(offA, dataStart);
  assert.equal(offB, dataStart + a.data.length);

  // Byte-exact comparison of the embedded PNG payloads
  for (let i = 0; i < a.data.length; i++) assert.equal(out[offA + i], a.data[i]);
  for (let i = 0; i < b.data.length; i++) assert.equal(out[offB + i], b.data[i]);
});

test('favicon: buildIco total size = header + dir + payloads', () => {
  const a = makeFakePng(16, 16, 64);
  const b = makeFakePng(32, 32, 128);
  const out = fvg.buildIco([a, b]);
  assert.equal(out.byteLength, 6 + 2 * 16 + 64 + 128);
});

test('favicon: buildIco single image works', () => {
  const out = fvg.buildIco([makeFakePng(16, 16, 10)]);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  assert.equal(dv.getUint16(4, true), 1);
  assert.equal(out.byteLength, 6 + 16 + 10);
});

// --- roundedRectPath -----------------------------------------------------

test('favicon: roundedRectPath calls ctx primitives without throwing', () => {
  const calls = [];
  const ctx = {
    beginPath: () => calls.push(['beginPath']),
    moveTo:    (x, y) => calls.push(['moveTo', x, y]),
    lineTo:    (x, y) => calls.push(['lineTo', x, y]),
    arcTo:     (x1, y1, x2, y2, r) => calls.push(['arcTo', x1, y1, x2, y2, r]),
    closePath: () => calls.push(['closePath'])
  };
  fvg.roundedRectPath(ctx, 0, 0, 100, 50, 10);
  assert.equal(calls[0][0], 'beginPath');
  assert.equal(calls[calls.length - 1][0], 'closePath');
  assert.equal(calls.filter(c => c[0] === 'arcTo').length, 4);
});

test('favicon: roundedRectPath clamps radius to half of smaller side', () => {
  // For a 20x10 rect, max effective radius is 5
  const arcs = [];
  const ctx = {
    beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {},
    arcTo(x1, y1, x2, y2, r) { arcs.push(r); }
  };
  fvg.roundedRectPath(ctx, 0, 0, 20, 10, 999);
  for (const r of arcs) assert.equal(r, 5);
});
