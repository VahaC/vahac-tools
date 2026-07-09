// tests/regex-tester.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const rgx = loadScript('regex-tester/script.js');

test('regex: buildRegex always includes the global flag', () => {
  const re = rgx.buildRegex('a+', '');
  assert.equal(re.global, true);
  assert.equal(re.flags, 'g');
});

test('regex: buildRegex preserves and dedupes requested flags', () => {
  const re = rgx.buildRegex('a+', 'gi');
  assert.equal(re.ignoreCase, true);
  assert.equal(re.global, true);
});

test('regex: buildRegex strips unsupported flag characters', () => {
  const re = rgx.buildRegex('a+', 'gz9');
  assert.equal(re.flags, 'g');
});

test('regex: buildRegex throws on invalid patterns', () => {
  assert.throws(() => rgx.buildRegex('(unterminated', 'g'));
});

test('regex: findMatches returns every non-overlapping match', () => {
  const matches = rgx.findMatches('\\d+', 'g', 'a1 b22 c333');
  assert.equal(matches.length, 3);
  assert.deepEqual(matches.map((m) => m[0]), ['1', '22', '333']);
});

test('regex: findMatches returns an empty array when nothing matches', () => {
  const matches = rgx.findMatches('xyz', 'g', 'no match here');
  assert.equal(matches.length, 0);
});

test('regex: findMatches captures numbered groups', () => {
  const matches = rgx.findMatches('(\\w+)@(\\w+)\\.(\\w+)', 'g', 'a@b.com');
  assert.equal(matches.length, 1);
  assert.equal(matches[0][1], 'a');
  assert.equal(matches[0][2], 'b');
  assert.equal(matches[0][3], 'com');
});

test('regex: findMatches captures named groups', () => {
  const matches = rgx.findMatches('(?<user>\\w+)@(?<domain>\\w+\\.\\w+)', 'g', 'a@b.com');
  assert.equal(matches[0].groups.user, 'a');
  assert.equal(matches[0].groups.domain, 'b.com');
});

test('regex: findMatches does not infinite-loop on zero-width matches', () => {
  const matches = rgx.findMatches('\\b', 'g', 'ab cd');
  assert.ok(matches.length > 0);
  assert.ok(matches.length < 5000);
});

test('regex: escapeHtml escapes angle brackets and ampersands', () => {
  assert.equal(rgx.escapeHtml('<a> & <b>'), '&lt;a&gt; &amp; &lt;b&gt;');
});

test('regex: buildHighlightHtml wraps matches in mark tags and preserves surrounding text', () => {
  const matches = rgx.findMatches('\\d+', 'g', 'x1y22z');
  const html = rgx.buildHighlightHtml('x1y22z', matches);
  assert.match(html, /^x<mark class="rgx-mark" title="Match 1">1<\/mark>y<mark class="rgx-mark rgx-mark--alt" title="Match 2">22<\/mark>z$/);
});

test('regex: buildHighlightHtml escapes HTML in the surrounding text', () => {
  const matches = rgx.findMatches('\\d+', 'g', '<b>1</b>');
  const html = rgx.buildHighlightHtml('<b>1</b>', matches);
  assert.match(html, /^&lt;b&gt;<mark/);
  assert.match(html, /<\/mark>&lt;\/b&gt;$/);
});

test('regex: buildHighlightHtml returns escaped text unchanged when there are no matches', () => {
  const html = rgx.buildHighlightHtml('plain <text>', []);
  assert.equal(html, 'plain &lt;text&gt;');
});
