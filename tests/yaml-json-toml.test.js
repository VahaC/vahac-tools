// tests/yaml-json-toml.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const yjt = loadScript('yaml-json-toml-converter/script.js');
const { TomlMini } = yjt;

test('toml: parse simple key/value', () => {
  const r = TomlMini.parse('name = "Vahac"\nport = 8080\n');
  assert.deepEqual(r, { name: 'Vahac', port: 8080 });
});

test('toml: parse booleans', () => {
  assert.deepEqual(TomlMini.parse('a = true\nb = false'), { a: true, b: false });
});

test('toml: parse integers and floats', () => {
  const r = TomlMini.parse('i = 42\nf = 3.14\nn = -5\n');
  assert.deepEqual(r, { i: 42, f: 3.14, n: -5 });
});

test('toml: parse hex/octal/binary', () => {
  const r = TomlMini.parse('h = 0x10\no = 0o17\nb = 0b1010');
  assert.equal(r.h, 16);
  assert.equal(r.o, 15);
  assert.equal(r.b, 10);
});

test('toml: parse numbers with underscores', () => {
  assert.deepEqual(TomlMini.parse('big = 1_000_000'), { big: 1_000_000 });
});

test('toml: parse string with escapes', () => {
  const r = TomlMini.parse('s = "line1\\nline2"');
  assert.equal(r.s, 'line1\nline2');
});

test('toml: parse literal string', () => {
  const r = TomlMini.parse("s = 'C:\\\\path'");
  assert.equal(r.s, 'C:\\\\path');
});

test('toml: parse array', () => {
  const r = TomlMini.parse('a = [1, 2, 3]');
  assert.deepEqual(r.a, [1, 2, 3]);
});

test('toml: parse nested arrays', () => {
  const r = TomlMini.parse('a = [[1, 2], [3, 4]]');
  assert.deepEqual(r.a, [[1, 2], [3, 4]]);
});

test('toml: parse inline table', () => {
  const r = TomlMini.parse('point = { x = 1, y = 2 }');
  assert.deepEqual(r.point, { x: 1, y: 2 });
});

test('toml: parse [section]', () => {
  const r = TomlMini.parse('[server]\nhost = "localhost"\nport = 80');
  assert.deepEqual(r, { server: { host: 'localhost', port: 80 } });
});

test('toml: parse dotted sections', () => {
  const r = TomlMini.parse('[a.b]\nc = 1');
  assert.deepEqual(r, { a: { b: { c: 1 } } });
});

test('toml: parse [[array of tables]]', () => {
  const r = TomlMini.parse('[[items]]\nname = "a"\n\n[[items]]\nname = "b"');
  assert.deepEqual(r, { items: [{ name: 'a' }, { name: 'b' }] });
});

test('toml: parse skips comments', () => {
  const r = TomlMini.parse('# top comment\nx = 1 # inline comment\n# another');
  assert.deepEqual(r, { x: 1 });
});

test('toml: parse skips blank lines', () => {
  const r = TomlMini.parse('\n\nx = 1\n\n\ny = 2\n\n');
  assert.deepEqual(r, { x: 1, y: 2 });
});

test('toml: parse comment after string', () => {
  const r = TomlMini.parse('s = "hello # not a comment" # actual comment');
  assert.equal(r.s, 'hello # not a comment');
});

test('toml: stringify simple object', () => {
  const out = TomlMini.stringify({ a: 1, b: 'hi', c: true });
  assert.match(out, /a = 1/);
  assert.match(out, /b = "hi"/);
  assert.match(out, /c = true/);
});

test('toml: stringify section', () => {
  const out = TomlMini.stringify({ server: { host: 'localhost', port: 80 } });
  assert.match(out, /\[server\]/);
  assert.match(out, /host = "localhost"/);
  assert.match(out, /port = 80/);
});

test('toml: stringify array of tables', () => {
  const out = TomlMini.stringify({ items: [{ name: 'a' }, { name: 'b' }] });
  assert.match(out, /\[\[items\]\]/);
});

test('toml: round-trip preserves data', () => {
  const original = {
    name: 'Vahac',
    server: { host: 'localhost', port: 8080, debug: true },
    tags: ['a', 'b', 'c']
  };
  const back = TomlMini.parse(TomlMini.stringify(original));
  assert.deepEqual(back, original);
});

test('toml: round-trip with array of tables', () => {
  const original = {
    items: [
      { name: 'a', value: 1 },
      { name: 'b', value: 2 }
    ]
  };
  const back = TomlMini.parse(TomlMini.stringify(original));
  assert.deepEqual(back, original);
});

test('toml: stringify rejects null/undefined', () => {
  assert.throws(() => TomlMini.stringify({ x: null }));
  assert.throws(() => TomlMini.stringify({ x: undefined }));
});

test('toml: stringify escapes special characters in strings', () => {
  const out = TomlMini.stringify({ s: 'line1\nline2\twith "quotes" and \\backslash' });
  // parsing back should yield the same string
  const back = TomlMini.parse(out);
  assert.equal(back.s, 'line1\nline2\twith "quotes" and \\backslash');
});

test('toml: parse empty input returns empty object', () => {
  assert.deepEqual(TomlMini.parse(''), {});
  assert.deepEqual(TomlMini.parse('   \n  \n'), {});
});

test('toml: parse dotted keys inline', () => {
  const r = TomlMini.parse('a.b.c = 1');
  assert.deepEqual(r, { a: { b: { c: 1 } } });
});
