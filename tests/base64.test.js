// tests/base64.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadScript } = require('./_setup');

const b64 = loadScript('base64-encode-decode/script.js');

function bytes(...values) {
  return Uint8Array.from(values);
}

/* ── RFC 4648 §10 test vectors ── */
test('base64: RFC 4648 encode vectors', () => {
  const vectors = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy']
  ];
  for (const [plain, encoded] of vectors) {
    assert.equal(b64.encodeText(plain), encoded, `encode ${JSON.stringify(plain)}`);
  }
});

test('base64: RFC 4648 decode vectors', () => {
  const vectors = [
    ['', ''],
    ['Zg==', 'f'],
    ['Zm8=', 'fo'],
    ['Zm9v', 'foo'],
    ['Zm9vYg==', 'foob'],
    ['Zm9vYmE=', 'fooba'],
    ['Zm9vYmFy', 'foobar']
  ];
  for (const [encoded, plain] of vectors) {
    assert.equal(b64.decodeText(encoded), plain, `decode ${encoded}`);
  }
});

test('base64: encodeText matches Node for unicode and multiline text', () => {
  const samples = [
    'hello world',
    'The quick brown fox jumps over the lazy dog',
    'multi\nline\ntext\r\n',
    'Тест на українській 🇺🇦',
    '日本語テキスト',
    'a'.repeat(1000),
    '<?xml version="1.0"?><root/>',
    '{"key": "value", "n": 42}'
  ];
  for (const s of samples) {
    assert.equal(b64.encodeText(s), Buffer.from(s, 'utf8').toString('base64'),
      `mismatch for ${JSON.stringify(s.slice(0, 24))}`);
  }
});

test('base64: round-trip preserves unicode text', () => {
  const samples = ['', 'a', 'ab', 'abc', 'Привіт, світе!', '🎉🎈🎁', 'x'.repeat(777)];
  for (const s of samples) {
    assert.equal(b64.decodeText(b64.encodeText(s)), s);
  }
});

test('base64: bytesToBase64 matches Node for random binary data', () => {
  for (const size of [0, 1, 2, 3, 4, 5, 63, 64, 65, 1000, 8193, 20000]) {
    const buf = crypto.randomBytes(size);
    assert.equal(b64.bytesToBase64(new Uint8Array(buf)), buf.toString('base64'),
      `mismatch at size ${size}`);
  }
});

test('base64: base64ToBytes matches Node for random binary data', () => {
  for (const size of [0, 1, 2, 3, 5, 64, 999, 5000]) {
    const buf = crypto.randomBytes(size);
    const decoded = b64.base64ToBytes(buf.toString('base64'));
    assert.deepEqual(Buffer.from(decoded), buf, `mismatch at size ${size}`);
  }
});

test('base64: encodes all byte values 0-255', () => {
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i++) all[i] = i;
  assert.equal(b64.bytesToBase64(all), Buffer.from(all).toString('base64'));
  assert.deepEqual(Buffer.from(b64.base64ToBytes(b64.bytesToBase64(all))), Buffer.from(all));
});

/* ── URL-safe alphabet (RFC 4648 §5) ── */
test('base64: url-safe alphabet swaps + and / for - and _', () => {
  const data = bytes(0xFB, 0xFF, 0xBF); // encodes to +/+/ territory
  const std = b64.bytesToBase64(data);
  const url = b64.bytesToBase64(data, { urlSafe: true });
  assert.ok(/[+/]/.test(std), 'standard output should contain + or /');
  assert.ok(!/[+/]/.test(url), 'url-safe output must not contain + or /');
  assert.equal(url, std.replace(/\+/g, '-').replace(/\//g, '_'));
});

test('base64: url-safe encoding matches Node base64url', () => {
  for (const size of [1, 2, 3, 10, 300]) {
    const buf = crypto.randomBytes(size);
    const url = b64.bytesToBase64(new Uint8Array(buf), { urlSafe: true, pad: false });
    assert.equal(url, buf.toString('base64url'), `mismatch at size ${size}`);
  }
});

test('base64: decoder accepts url-safe input', () => {
  const buf = crypto.randomBytes(120);
  const url = buf.toString('base64url');
  assert.deepEqual(Buffer.from(b64.base64ToBytes(url)), buf);
});

/* ── Padding ── */
test('base64: pad:false strips trailing =', () => {
  assert.equal(b64.encodeText('f', { pad: false }), 'Zg');
  assert.equal(b64.encodeText('fo', { pad: false }), 'Zm8');
  assert.equal(b64.encodeText('foo', { pad: false }), 'Zm9v');
});

test('base64: decoder tolerates missing padding', () => {
  assert.equal(b64.decodeText('Zg'), 'f');
  assert.equal(b64.decodeText('Zm8'), 'fo');
  assert.equal(b64.decodeText('Zm9vYg'), 'foob');
});

/* ── Whitespace and line wrapping ── */
test('base64: wrapLines splits at the requested width', () => {
  assert.equal(b64.wrapLines('abcdefgh', 4), 'abcd\nefgh');
  assert.equal(b64.wrapLines('abcde', 4), 'abcd\ne');
  assert.equal(b64.wrapLines('', 4), '');
});

test('base64: wrap option produces 76-char MIME lines', () => {
  const out = b64.encodeText('x'.repeat(300), { wrap: true });
  const lines = out.split('\n');
  assert.ok(lines.length > 1, 'expected multiple lines');
  for (const line of lines.slice(0, -1)) {
    assert.equal(line.length, 76);
  }
  assert.equal(b64.decodeText(out), 'x'.repeat(300));
});

test('base64: decoder ignores whitespace, newlines and tabs', () => {
  assert.equal(b64.decodeText('Zm9v YmFy'), 'foobar');
  assert.equal(b64.decodeText('Zm9v\nYmFy'), 'foobar');
  assert.equal(b64.decodeText('  Zm9v\r\n\tYmFy  '), 'foobar');
});

/* ── Error handling ── */
test('base64: rejects invalid characters', () => {
  assert.throws(() => b64.base64ToBytes('Zm9v!!!'), /Invalid Base64 character/);
  assert.throws(() => b64.base64ToBytes('abc$'), /Invalid Base64 character/);
  assert.throws(() => b64.base64ToBytes('Zm9vYmFyЖ'), /Invalid Base64 character/);
});

test('base64: rejects misplaced padding', () => {
  assert.throws(() => b64.base64ToBytes('Zm=9v'), /padding/);
});

test('base64: rejects impossible length', () => {
  assert.throws(() => b64.base64ToBytes('Zm9vY'), /Invalid Base64 length/);
});

/* ── Data URIs ── */
test('base64: stripDataUri splits mime and payload', () => {
  assert.deepEqual(b64.stripDataUri('data:image/png;base64,iVBORw0K'),
    { mime: 'image/png', data: 'iVBORw0K' });
  assert.deepEqual(b64.stripDataUri('data:;base64,Zm9v'),
    { mime: '', data: 'Zm9v' });
  assert.deepEqual(b64.stripDataUri('data:text/plain;charset=utf-8;base64,Zm9v'),
    { mime: 'text/plain', data: 'Zm9v' });
});

test('base64: stripDataUri leaves plain base64 untouched', () => {
  assert.deepEqual(b64.stripDataUri('Zm9vYmFy'), { mime: '', data: 'Zm9vYmFy' });
});

/* ── MIME sniffing ── */
test('base64: detectMime recognises common signatures', () => {
  const cases = [
    [bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A), 'image/png', 'png'],
    [bytes(0xFF, 0xD8, 0xFF, 0xE0), 'image/jpeg', 'jpg'],
    [bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), 'image/gif', 'gif'],
    [bytes(0x25, 0x50, 0x44, 0x46, 0x2D), 'application/pdf', 'pdf'],
    [bytes(0x50, 0x4B, 0x03, 0x04, 0x14), 'application/zip', 'zip'],
    [bytes(0x1F, 0x8B, 0x08), 'application/gzip', 'gz']
  ];
  for (const [data, mime, ext] of cases) {
    const got = b64.detectMime(data);
    assert.equal(got.mime, mime);
    assert.equal(got.ext, ext);
  }
});

test('base64: detectMime falls back to text or octet-stream', () => {
  assert.equal(b64.detectMime(new TextEncoder().encode('hello world')).mime, 'text/plain');
  assert.equal(b64.detectMime(bytes(0x00, 0x01, 0x02, 0x7F)).mime, 'application/octet-stream');
  assert.equal(b64.detectMime(new Uint8Array(0)).mime, 'application/octet-stream');
});

test('base64: detectMime recognises WEBP only with the RIFF container', () => {
  const webp = new Uint8Array(12);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50], 8);
  assert.equal(b64.detectMime(webp).mime, 'image/webp');
});

/* ── Helpers ── */
test('base64: formatBytes renders human-readable sizes', () => {
  assert.equal(b64.formatBytes(0), '0 bytes');
  assert.equal(b64.formatBytes(1), '1 byte');
  assert.equal(b64.formatBytes(512), '512 bytes');
  assert.equal(b64.formatBytes(2048), '2.0 KB');
  assert.equal(b64.formatBytes(1048576), '1.00 MB');
});

test('base64: alphabets are 64 unique characters', () => {
  for (const alpha of [b64.B64_STD, b64.B64_URL]) {
    assert.equal(alpha.length, 64);
    assert.equal(new Set(alpha).size, 64);
  }
});
