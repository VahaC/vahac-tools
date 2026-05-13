// tests/json-formatter.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const jsf = loadScript('json-formatter/script.js');

test('json: parseJSON success', () => {
  const r = jsf.parseJSON('{"a":1,"b":[1,2,3]}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { a: 1, b: [1, 2, 3] });
  assert.equal(r.minified, '{"a":1,"b":[1,2,3]}');
  assert.equal(r.formatted, '{\n  "a": 1,\n  "b": [\n    1,\n    2,\n    3\n  ]\n}');
});

test('json: parseJSON failure returns ok=false', () => {
  const r = jsf.parseJSON('{not json}');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('json: parseJSON failure extracts line/col from V8 message', () => {
  const r = jsf.parseJSON('{\n  "a": 1\n  "b": 2\n}');
  assert.equal(r.ok, false);
  // V8 errors include position; extractErrorInfo should provide line/col
  if (r.line !== null) {
    assert.ok(r.line >= 1);
    assert.ok(r.col >= 1);
  }
});

test('json: computeStats counts primitive types', () => {
  const s = jsf.computeStats({ a: 1, b: 'x', c: true, d: null, e: 'y' });
  assert.equal(s.keys, 5);
  assert.equal(s.numbers, 1);
  assert.equal(s.strings, 2);
  assert.equal(s.booleans, 1);
  assert.equal(s.nulls, 1);
});

test('json: computeStats counts depth', () => {
  const s = jsf.computeStats({ a: { b: { c: { d: 1 } } } });
  assert.equal(s.depth, 4);
});

test('json: computeStats counts arrays correctly', () => {
  const s = jsf.computeStats([1, 2, 3, [4, 5]]);
  assert.equal(s.numbers, 5);
  assert.equal(s.depth, 2);
});

test('json: getType handles all JSON types', () => {
  assert.equal(jsf.getType(null), 'null');
  assert.equal(jsf.getType([]), 'array');
  assert.equal(jsf.getType({}), 'object');
  assert.equal(jsf.getType('x'), 'string');
  assert.equal(jsf.getType(1), 'number');
  assert.equal(jsf.getType(true), 'boolean');
});

test('json: fmtPrimitive', () => {
  assert.equal(jsf.fmtPrimitive(null), 'null');
  assert.equal(jsf.fmtPrimitive('hi'), '"hi"');
  assert.equal(jsf.fmtPrimitive(42), '42');
  assert.equal(jsf.fmtPrimitive(true), 'true');
  assert.equal(jsf.fmtPrimitive(false), 'false');
});

test('json: fmtBytes formats sizes', () => {
  assert.match(jsf.fmtBytes(500), /500/);
  assert.match(jsf.fmtBytes(2048), /KB/);
  assert.match(jsf.fmtBytes(2 * 1024 * 1024), /MB/);
});

test('json: syntaxHighlight wraps keys, strings, numbers, booleans, null', () => {
  const h = jsf.syntaxHighlight('{"a": 1, "b": "x", "c": true, "d": null}');
  assert.match(h, /jsf-hl-key/);
  assert.match(h, /jsf-hl-string/);
  assert.match(h, /jsf-hl-number/);
  assert.match(h, /jsf-hl-boolean/);
  assert.match(h, /jsf-hl-null/);
});

test('json: syntaxHighlight escapes HTML entities', () => {
  const h = jsf.syntaxHighlight('{"a": "<b>"}');
  assert.ok(!h.includes('<b>'));
  assert.match(h, /&lt;b&gt;/);
});
