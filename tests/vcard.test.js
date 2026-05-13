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
