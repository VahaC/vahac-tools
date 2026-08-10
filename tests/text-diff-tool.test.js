// tests/text-diff-tool.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const tdf = loadScript('text-diff-tool/script.js');

function opsToUnified(ops) {
  return ops.map((op) => {
    if (op.type === 'eq') return '  ' + op.a;
    if (op.type === 'del') return '- ' + op.a;
    return '+ ' + op.b;
  });
}

/* ── tokenize ── */

test('tokenize: line mode splits on \\n, \\r\\n, and \\r', () => {
  assert.deepEqual(tdf.tokenize('a\nb\r\nc\rd', 'line'), ['a', 'b', 'c', 'd']);
});

test('tokenize: line mode on empty string returns a single empty line', () => {
  assert.deepEqual(tdf.tokenize('', 'line'), ['']);
});

test('tokenize: word mode keeps whitespace runs as separate tokens', () => {
  assert.deepEqual(tdf.tokenize('foo  bar\tbaz', 'word'), ['foo', '  ', 'bar', '\t', 'baz']);
});

test('tokenize: word mode on empty string returns an empty array', () => {
  assert.deepEqual(tdf.tokenize('', 'word'), []);
});

test('tokenize: char mode splits by Unicode code point, not UTF-16 code unit', () => {
  assert.deepEqual(tdf.tokenize('a🇺🇦b', 'char'), ['a', '🇺', '🇦', 'b']);
});

/* ── normalizeToken ── */

test('normalizeToken: line mode with ignoreWS trims and collapses internal whitespace', () => {
  assert.equal(tdf.normalizeToken('  foo   bar  ', 'line', true, false), 'foo bar');
});

test('normalizeToken: line mode without ignoreWS leaves whitespace untouched', () => {
  assert.equal(tdf.normalizeToken('  foo   bar  ', 'line', false, false), '  foo   bar  ');
});

test('normalizeToken: ignoreCase lowercases regardless of mode', () => {
  assert.equal(tdf.normalizeToken('FooBar', 'line', false, true), 'foobar');
  assert.equal(tdf.normalizeToken('FooBar', 'word', false, true), 'foobar');
});

test('normalizeToken: word/char mode with ignoreWS collapses a whitespace-only token to a single space', () => {
  assert.equal(tdf.normalizeToken('   ', 'word', true, false), ' ');
  assert.equal(tdf.normalizeToken('foo', 'word', true, false), 'foo');
});

/* ── computeDiff (line mode) ── */

test('computeDiff: identical inputs produce only eq ops', () => {
  const a = ['x', 'y', 'z'];
  const ops = tdf.computeDiff(a, a, a, a);
  assert.ok(ops.every((op) => op.type === 'eq'));
  assert.equal(ops.length, 3);
});

test('computeDiff: pure addition produces one add op and rest eq', () => {
  const a = ['x', 'y'];
  const b = ['x', 'y', 'z'];
  const ops = tdf.computeDiff(a, b, a, b);
  assert.deepEqual(opsToUnified(ops), ['  x', '  y', '+ z']);
});

test('computeDiff: pure deletion produces one del op and rest eq', () => {
  const a = ['x', 'y', 'z'];
  const b = ['x', 'z'];
  const ops = tdf.computeDiff(a, b, a, b);
  assert.deepEqual(opsToUnified(ops), ['  x', '- y', '  z']);
});

test('computeDiff: a single-line change surfaces as a del+add pair, not a rewrite of the whole diff', () => {
  const a = ['version: 1', 'name: foo', 'env: prod'];
  const b = ['version: 2', 'name: foo', 'env: prod'];
  const ops = tdf.computeDiff(a, b, a, b);
  assert.deepEqual(opsToUnified(ops), ['- version: 1', '+ version: 2', '  name: foo', '  env: prod']);
});

test('computeDiff: both empty inputs produce no ops', () => {
  assert.deepEqual(tdf.computeDiff([], [], [], []), []);
});

test('computeDiff: empty original vs non-empty changed is all additions', () => {
  const b = ['a', 'b'];
  const ops = tdf.computeDiff([], b, [], b);
  assert.deepEqual(opsToUnified(ops), ['+ a', '+ b']);
});

test('computeDiff: non-empty original vs empty changed is all deletions', () => {
  const a = ['a', 'b'];
  const ops = tdf.computeDiff(a, [], a, []);
  assert.deepEqual(opsToUnified(ops), ['- a', '- b']);
});

test('computeDiff: uses the normalized arrays for equality but the raw arrays for output text', () => {
  const aRaw = ['  Foo  '];
  const bRaw = ['foo'];
  const aNorm = ['foo'];
  const bNorm = ['foo'];
  const ops = tdf.computeDiff(aRaw, bRaw, aNorm, bNorm);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'eq');
  assert.equal(ops[0].a, '  Foo  ');
  assert.equal(ops[0].b, 'foo');
});

test('computeDiff: returns null when n*m exceeds the size guard', () => {
  const big = new Array(3001).fill('x').map((v, i) => v + i);
  const ops = tdf.computeDiff(big, big, big, big);
  assert.equal(ops, null);
});

test('computeDiff: returns null when either side exceeds the token count guard', () => {
  const huge = new Array(20001).fill('x');
  const small = ['x'];
  const ops = tdf.computeDiff(huge, small, huge, small);
  assert.equal(ops, null);
});

/* ── escapeHtml ── */

test('escapeHtml: escapes the five reserved HTML characters', () => {
  assert.equal(tdf.escapeHtml('<div class="a">&\'b\'</div>'),
    '&lt;div class=&quot;a&quot;&gt;&amp;&#39;b&#39;&lt;/div&gt;');
});

test('escapeHtml: leaves plain text untouched', () => {
  assert.equal(tdf.escapeHtml('hello world 123'), 'hello world 123');
});
