// tests/vcard.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const vcg = loadScript('vcard-qr-code-generator/script.js');

test('vcard: vcardEscape handles backslash, semicolon, comma, newline', () => {
  assert.equal(vcg.vcardEscape('a;b'), 'a\\;b');
  assert.equal(vcg.vcardEscape('a,b'), 'a\\,b');
  assert.equal(vcg.vcardEscape('a\nb'), 'a\\nb');
  assert.equal(vcg.vcardEscape('a\\b'), 'a\\\\b');
});

test('vcard: vcardEscape handles null/undefined', () => {
  assert.equal(vcg.vcardEscape(null), '');
  assert.equal(vcg.vcardEscape(undefined), '');
});

test('vcard: vcardEscape trims whitespace', () => {
  assert.equal(vcg.vcardEscape('  hello  '), 'hello');
});

test('vcard: buildVCard produces all required sections', () => {
  const card = vcg.buildVCard({
    first: 'Ada',
    last: 'Lovelace',
    org: 'Analytical Engine',
    title: 'Mathematician',
    tel: '+44 1234',
    email: 'ada@example.com',
    url: 'https://example.com'
  });
  assert.match(card, /^BEGIN:VCARD/);
  assert.match(card, /END:VCARD$/);
  assert.match(card, /VERSION:3\.0/);
  assert.match(card, /N:Lovelace;Ada;;;/);
  assert.match(card, /FN:Ada Lovelace/);
  assert.match(card, /ORG:Analytical Engine/);
  assert.match(card, /TITLE:Mathematician/);
  assert.match(card, /TEL;TYPE=CELL:\+44 1234/);
  assert.match(card, /EMAIL:ada@example\.com/);
  assert.match(card, /URL:https:\/\/example\.com/);
});

test('vcard: buildVCard uses CRLF line separators (vCard 3.0 spec)', () => {
  const card = vcg.buildVCard({ first: 'A', last: 'B' });
  assert.ok(card.includes('\r\n'));
});

test('vcard: buildVCard omits empty optional fields', () => {
  const card = vcg.buildVCard({ first: 'Ada', last: 'Lovelace' });
  assert.match(card, /N:Lovelace;Ada;;;/);
  assert.ok(!card.includes('ORG:'));
  assert.ok(!card.includes('TITLE:'));
  assert.ok(!card.includes('TEL'));
  assert.ok(!card.includes('EMAIL:'));
  assert.ok(!card.includes('URL:'));
});

test('vcard: buildVCard handles only first name', () => {
  const card = vcg.buildVCard({ first: 'Alice' });
  assert.match(card, /N:;Alice;;;/);
  assert.match(card, /FN:Alice/);
});

test('vcard: buildVCard handles only last name', () => {
  const card = vcg.buildVCard({ last: 'Smith' });
  assert.match(card, /N:Smith;;;;/);
  assert.match(card, /FN:Smith/);
});

test('vcard: buildVCard escapes special chars in input', () => {
  const card = vcg.buildVCard({ first: 'A;B', last: 'C,D', org: 'O\nL' });
  assert.match(card, /A\\;B/);
  assert.match(card, /C\\,D/);
  assert.match(card, /O\\nL/);
});

// ── UTF-8 QR encoding ────────────────────────────────────

test('vcard: toUtf8ByteString encodes non-ASCII as UTF-8 bytes', () => {
  assert.equal(vcg.toUtf8ByteString('abc'), 'abc');
  assert.equal(vcg.toUtf8ByteString(null), '');
  const jose = vcg.toUtf8ByteString('José');
  assert.deepEqual([...jose].map((c) => c.charCodeAt(0)), [0x4a, 0x6f, 0x73, 0xc3, 0xa9]);
  assert.equal(vcg.toUtf8ByteString('📇').length, 4);
});

test('vcard: toUtf8ByteString bytes match Buffer UTF-8 encoding of a vCard', () => {
  const card = vcg.buildVCard({ first: 'Олена', last: 'Шевченко', org: 'Café 📇' });
  const expected = Buffer.from(card, 'utf8');
  const actual = vcg.toUtf8ByteString(card);
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(actual.charCodeAt(i), expected[i]);
  }
});

// Fake qrcode-generator: records the bytes its current stringToBytes produces.
// Starts with the UTF-8 converter active to prove makeQr swaps it out (no double encoding).
function stubQrLib() {
  const calls = [];
  const lib = function (typeNumber, ecl) {
    return {
      addData(data, mode) {
        calls.push({ typeNumber, ecl, mode, bytes: lib.stringToBytes(data) });
      },
      make() {}
    };
  };
  lib.stringToBytesFuncs = {
    default: (s) => [...s].map((c) => c.charCodeAt(0) & 0xff),
    'UTF-8': (s) => [...Buffer.from(s, 'utf8')]
  };
  lib.stringToBytes = lib.stringToBytesFuncs['UTF-8'];
  return { lib, calls };
}

test('vcard: makeQr feeds UTF-8 bytes in Byte mode and restores stringToBytes', (t) => {
  const { lib, calls } = stubQrLib();
  globalThis.window.qrcode = lib;
  t.after(() => { delete globalThis.window.qrcode; });

  vcg.makeQr('FN:Олена José', 'H');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].typeNumber, 0);
  assert.equal(calls[0].ecl, 'H');
  assert.equal(calls[0].mode, 'Byte');
  assert.deepEqual(calls[0].bytes, [...Buffer.from('FN:Олена José', 'utf8')]);
  assert.equal(lib.stringToBytes, lib.stringToBytesFuncs['UTF-8']);
});

test('vcard: makeQr restores stringToBytes when encoding throws', (t) => {
  const { lib } = stubQrLib();
  const original = lib.stringToBytes;
  const failing = function () {
    return { addData() { throw new Error('code length overflow'); }, make() {} };
  };
  failing.stringToBytesFuncs = lib.stringToBytesFuncs;
  failing.stringToBytes = original;
  globalThis.window.qrcode = failing;
  t.after(() => { delete globalThis.window.qrcode; });

  assert.throws(() => vcg.makeQr('x', 'M'), /overflow/);
  assert.equal(failing.stringToBytes, original);
});

test('vcard: makeQr throws when the library is not loaded', () => {
  delete globalThis.window.qrcode;
  assert.throws(() => vcg.makeQr('x', 'M'), /not loaded/);
});
