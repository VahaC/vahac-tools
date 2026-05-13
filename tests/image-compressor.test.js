// tests/image-compressor.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const icr = loadScript('image-compressor-resizer/script.js');

// --- Array helpers (IE-safe variants of Array.prototype methods) ---------

test('image: arrFind returns first match', () => {
  assert.equal(icr.arrFind([1, 2, 3, 4], x => x > 2), 3);
});

test('image: arrFind returns null when no match', () => {
  assert.equal(icr.arrFind([1, 2, 3], x => x > 10), null);
});

test('image: arrFindIdx returns index of first match', () => {
  assert.equal(icr.arrFindIdx([10, 20, 30], x => x === 20), 1);
  assert.equal(icr.arrFindIdx([10, 20, 30], x => x === 999), -1);
});

test('image: arrSome short-circuits on true', () => {
  let visited = 0;
  const r = icr.arrSome([1, 2, 3, 4], x => { visited++; return x === 2; });
  assert.equal(r, true);
  assert.equal(visited, 2);
});

test('image: arrSome returns false when none match', () => {
  assert.equal(icr.arrSome([1, 2, 3], x => x > 99), false);
});

// --- formatSize ----------------------------------------------------------

test('image: formatSize bytes range', () => {
  assert.equal(icr.formatSize(0), '0 B');
  assert.equal(icr.formatSize(500), '500 B');
  assert.equal(icr.formatSize(1023), '1023 B');
});

test('image: formatSize KB range', () => {
  assert.equal(icr.formatSize(1024), '1.0 KB');
  assert.equal(icr.formatSize(2048), '2.0 KB');
  assert.equal(icr.formatSize(1048575), '1024.0 KB');
});

test('image: formatSize MB range', () => {
  assert.equal(icr.formatSize(1048576), '1.00 MB');
  assert.equal(icr.formatSize(5 * 1048576), '5.00 MB');
});

// --- mimeToExt -----------------------------------------------------------

test('image: mimeToExt for common image MIME types', () => {
  assert.equal(icr.mimeToExt('image/jpeg'), 'jpg');
  assert.equal(icr.mimeToExt('image/png'),  'png');
  assert.equal(icr.mimeToExt('image/webp'), 'webp');
  assert.equal(icr.mimeToExt('image/gif'),  'gif');
  assert.equal(icr.mimeToExt('image/bmp'),  'bmp');
  assert.equal(icr.mimeToExt('image/tiff'), 'tiff');
});

test('image: mimeToExt unknown falls back to png', () => {
  assert.equal(icr.mimeToExt('application/octet-stream'), 'png');
  assert.equal(icr.mimeToExt(''), 'png');
});

// --- truncateName --------------------------------------------------------

test('image: truncateName leaves short names alone', () => {
  assert.equal(icr.truncateName('hello.png', 20), 'hello.png');
});

test('image: truncateName preserves extension on long names', () => {
  const out = icr.truncateName('a-very-long-filename-that-overflows.jpg', 20);
  assert.ok(out.endsWith('.jpg'));
  assert.ok(out.length <= 20);
  assert.ok(out.includes('\u2026'));
});

test('image: truncateName handles no-extension names', () => {
  const out = icr.truncateName('no-extension-name-here-too-long', 10);
  assert.equal(out.length, 10);
  assert.ok(out.endsWith('\u2026'));
});

// --- escHtml -------------------------------------------------------------

test('image: escHtml escapes &, <, >, "', () => {
  assert.equal(icr.escHtml('<b>"x"&y</b>'), '&lt;b&gt;&quot;x&quot;&amp;y&lt;/b&gt;');
});

test('image: escHtml on plain text is identity', () => {
  assert.equal(icr.escHtml('hello world'), 'hello world');
});

// --- outputFilename ------------------------------------------------------

test('image: outputFilename swaps the extension', () => {
  assert.equal(
    icr.outputFilename({ file: { name: 'photo.jpg' }, outputExt: 'webp' }),
    'photo.webp'
  );
});

test('image: outputFilename handles dotted base names', () => {
  assert.equal(
    icr.outputFilename({ file: { name: 'my.photo.v2.jpeg' }, outputExt: 'png' }),
    'my.photo.v2.png'
  );
});

test('image: outputFilename handles names without extension', () => {
  assert.equal(
    icr.outputFilename({ file: { name: 'NOEXT' }, outputExt: 'png' }),
    'NOEXT.png'
  );
});

// --- parseExifOrientation ------------------------------------------------

/**
 * Build a minimal JPEG (SOI + APP1/Exif) buffer containing only an
 * Orientation tag. Returns an ArrayBuffer.
 */
function buildExifJpeg(orientation, little = true) {
  const entries = 1;
  const ifdSize = 2 + entries * 12 + 4; // count + entry + next-IFD offset
  const tiffSize = 8 + ifdSize;          // TIFF header + IFD0
  const app1PayloadSize = 6 + tiffSize;  // "Exif\0\0" + TIFF block
  const app1Length = 2 + app1PayloadSize;
  const total = 2 + 2 + app1Length;       // SOI + APP1 marker + (length+payload)

  const buf = new ArrayBuffer(total);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);
  let p = 0;

  dv.setUint16(p, 0xFFD8, false); p += 2;          // SOI
  dv.setUint16(p, 0xFFE1, false); p += 2;          // APP1
  dv.setUint16(p, app1Length, false); p += 2;      // segment length (BE per JPEG)

  // "Exif\0\0"
  u8[p++] = 0x45; u8[p++] = 0x78; u8[p++] = 0x69; u8[p++] = 0x66;
  u8[p++] = 0x00; u8[p++] = 0x00;

  // TIFF header
  if (little) {
    u8[p++] = 0x49; u8[p++] = 0x49;                // 'II'
  } else {
    u8[p++] = 0x4D; u8[p++] = 0x4D;                // 'MM'
  }
  dv.setUint16(p, 0x002A, little); p += 2;          // magic
  dv.setUint32(p, 8, little);     p += 4;          // IFD0 offset (8)

  // IFD0: tag count
  dv.setUint16(p, entries, little); p += 2;
  // Orientation tag entry (12 bytes)
  dv.setUint16(p, 0x0112, little); p += 2;          // tag id
  dv.setUint16(p, 3,      little); p += 2;          // type SHORT
  dv.setUint32(p, 1,      little); p += 4;          // count
  dv.setUint16(p, orientation, little); p += 2;     // value (low 2 bytes)
  dv.setUint16(p, 0,      little); p += 2;          // pad
  // Next-IFD offset
  dv.setUint32(p, 0, little); p += 4;

  return buf;
}

test('image: parseExifOrientation returns 1 for non-JPEG buffer', () => {
  const buf = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer;
  assert.equal(icr.parseExifOrientation(buf), 1);
});

test('image: parseExifOrientation returns 1 for tiny buffer', () => {
  assert.equal(icr.parseExifOrientation(new ArrayBuffer(2)), 1);
});

test('image: parseExifOrientation reads orientation 1..8 (little-endian)', () => {
  for (let o = 1; o <= 8; o++) {
    assert.equal(icr.parseExifOrientation(buildExifJpeg(o, true)), o,
      `orientation=${o} (LE) mismatch`);
  }
});

test('image: parseExifOrientation reads orientation 1..8 (big-endian)', () => {
  for (let o = 1; o <= 8; o++) {
    assert.equal(icr.parseExifOrientation(buildExifJpeg(o, false)), o,
      `orientation=${o} (BE) mismatch`);
  }
});

test('image: parseExifOrientation returns 1 when no Orientation tag present', () => {
  // JPEG with SOI then a different APP marker (APP0/JFIF, no EXIF)
  const buf = new ArrayBuffer(20);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);
  dv.setUint16(0, 0xFFD8, false);   // SOI
  dv.setUint16(2, 0xFFE0, false);   // APP0 (JFIF)
  dv.setUint16(4, 16, false);       // segment length
  for (let i = 6; i < 20; i++) u8[i] = 0;
  assert.equal(icr.parseExifOrientation(buf), 1);
});
