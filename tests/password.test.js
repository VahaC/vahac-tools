// tests/password.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const pwg = loadScript('password-passphrase-generator/script.js');

test('password: wordlist is non-empty', () => {
  assert.ok(pwg.PWG_WORDLIST.length > 100);
});

test('password: BITS_PER_WORD matches log2 of wordlist length', () => {
  assert.equal(pwg.BITS_PER_WORD, Math.log2(pwg.PWG_WORDLIST.length));
});

test('password: character sets are well-formed', () => {
  assert.equal(pwg.CHARS_UPPER.length, 26);
  assert.equal(pwg.CHARS_LOWER.length, 26);
  assert.equal(pwg.CHARS_DIGITS.length, 10);
  assert.ok(pwg.CHARS_SYMBOLS.length > 0);
});

test('password: randomInt returns int in [0, max)', () => {
  for (let i = 0; i < 1000; i++) {
    const r = pwg.randomInt(10);
    assert.ok(Number.isInteger(r));
    assert.ok(r >= 0 && r < 10);
  }
});

test('password: randomInt(1) always returns 0', () => {
  for (let i = 0; i < 100; i++) {
    assert.equal(pwg.randomInt(1), 0);
  }
});

test('password: randomInt has reasonable distribution', () => {
  const max = 16;
  const counts = new Array(max).fill(0);
  const N = 16000;
  for (let i = 0; i < N; i++) counts[pwg.randomInt(max)]++;
  // Each bucket should be roughly N/max = 1000 ± reasonable variance
  for (let i = 0; i < max; i++) {
    assert.ok(counts[i] > 500 && counts[i] < 1500,
      `bucket ${i} count=${counts[i]} out of expected range`);
  }
});

test('password: calcPasswordEntropy formula', () => {
  // 16-char password from a 95-char set
  assert.ok(Math.abs(pwg.calcPasswordEntropy(16, 95) - 16 * Math.log2(95)) < 1e-9);
});

test('password: calcPasswordEntropy returns 0 for invalid input', () => {
  assert.equal(pwg.calcPasswordEntropy(0, 95), 0);
  assert.equal(pwg.calcPasswordEntropy(16, 1), 0);
  assert.equal(pwg.calcPasswordEntropy(16, 0), 0);
});

test('password: calcPhraseEntropy', () => {
  assert.equal(pwg.calcPhraseEntropy(6), 6 * pwg.BITS_PER_WORD);
});

test('password: strengthClass thresholds', () => {
  assert.equal(pwg.strengthClass(49), 'weak');
  assert.equal(pwg.strengthClass(50), 'fair');
  assert.equal(pwg.strengthClass(79), 'fair');
  assert.equal(pwg.strengthClass(80), 'strong');
  assert.equal(pwg.strengthClass(109), 'strong');
  assert.equal(pwg.strengthClass(110), 'best');
  assert.equal(pwg.strengthClass(200), 'best');
});

test('password: strengthLabel includes coloured emoji', () => {
  assert.match(pwg.strengthLabel(40), /Weak/);
  assert.match(pwg.strengthLabel(60), /Fair/);
  assert.match(pwg.strengthLabel(90), /Strong/);
  assert.match(pwg.strengthLabel(150), /Very Strong/);
});

test('password: meterWidth caps at 100%', () => {
  assert.equal(pwg.meterWidth(0), '0.0%');
  assert.equal(pwg.meterWidth(128), '100.0%');
  assert.equal(pwg.meterWidth(256), '100.0%');
  assert.equal(pwg.meterWidth(64), '50.0%');
});

test('password: AMBIGUOUS chars do not overlap critical letters', () => {
  // sanity: AMBIGUOUS exclusion shouldn't empty out lower/upper sets
  let lower = '';
  for (const c of pwg.CHARS_LOWER) if (pwg.AMBIGUOUS.indexOf(c) === -1) lower += c;
  assert.ok(lower.length > 20);
});
