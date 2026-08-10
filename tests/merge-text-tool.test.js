// tests/merge-text-tool.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const mtx = loadScript('merge-text-tool/script.js');

/* ── tokenizeLines ── */

test('tokenizeLines: splits on \\n, \\r\\n, and \\r', () => {
  assert.deepEqual(mtx.tokenizeLines('a\nb\r\nc\rd'), ['a', 'b', 'c', 'd']);
});

test('tokenizeLines: empty string returns a single empty line', () => {
  assert.deepEqual(mtx.tokenizeLines(''), ['']);
});

/* ── normalizeLine ── */

test('normalizeLine: ignoreWS trims and collapses internal whitespace', () => {
  assert.equal(mtx.normalizeLine('  foo   bar  ', true, false), 'foo bar');
});

test('normalizeLine: without ignoreWS leaves whitespace untouched', () => {
  assert.equal(mtx.normalizeLine('  foo   bar  ', false, false), '  foo   bar  ');
});

test('normalizeLine: ignoreCase lowercases', () => {
  assert.equal(mtx.normalizeLine('FooBar', false, true), 'foobar');
});

test('normalizeLine: both options combine', () => {
  assert.equal(mtx.normalizeLine('  FOO  BAR  ', true, true), 'foo bar');
});

/* ── computeDiff ── */

function opsToUnified(ops) {
  return ops.map((op) => {
    if (op.type === 'eq') return '  ' + op.a;
    if (op.type === 'del') return '- ' + op.a;
    return '+ ' + op.b;
  });
}

test('computeDiff: identical inputs produce only eq ops', () => {
  const a = ['x', 'y', 'z'];
  const ops = mtx.computeDiff(a, a, a, a);
  assert.ok(ops.every((op) => op.type === 'eq'));
  assert.equal(ops.length, 3);
});

test('computeDiff: a single-line change surfaces as a del+add pair', () => {
  const a = ['version: 1', 'name: foo'];
  const b = ['version: 2', 'name: foo'];
  const ops = mtx.computeDiff(a, b, a, b);
  assert.deepEqual(opsToUnified(ops), ['- version: 1', '+ version: 2', '  name: foo']);
});

test('computeDiff: both empty inputs produce no ops', () => {
  assert.deepEqual(mtx.computeDiff([], [], [], []), []);
});

test('computeDiff: returns null when n*m exceeds the size guard', () => {
  const big = new Array(3001).fill('x').map((v, i) => v + i);
  const ops = mtx.computeDiff(big, big, big, big);
  assert.equal(ops, null);
});

/* ── buildBlocks ── */

test('buildBlocks: groups a pure eq sequence into a single eq block', () => {
  const ops = [
    { type: 'eq', a: 'x', b: 'x' },
    { type: 'eq', a: 'y', b: 'y' }
  ];
  const blocks = mtx.buildBlocks(ops);
  assert.deepEqual(blocks, [
    { type: 'eq', count: 2, leftStart: 0, rightStart: 0 }
  ]);
});

test('buildBlocks: groups a del+add run into one diff block with correct start indices', () => {
  const ops = [
    { type: 'eq', a: 'a', b: 'a' },
    { type: 'del', a: 'old1' },
    { type: 'del', a: 'old2' },
    { type: 'add', b: 'new1' },
    { type: 'eq', a: 'z', b: 'z' }
  ];
  const blocks = mtx.buildBlocks(ops);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].type, 'eq');
  assert.deepEqual(blocks[1], {
    type: 'diff',
    leftLines: ['old1', 'old2'],
    rightLines: ['new1'],
    leftStart: 1,
    rightStart: 1
  });
  assert.equal(blocks[2].leftStart, 3);
  assert.equal(blocks[2].rightStart, 2);
});

test('buildBlocks: a pure addition produces a diff block with empty leftLines', () => {
  const ops = [{ type: 'eq', a: 'a', b: 'a' }, { type: 'add', b: 'new' }];
  const blocks = mtx.buildBlocks(ops);
  assert.deepEqual(blocks[1], { type: 'diff', leftLines: [], rightLines: ['new'], leftStart: 1, rightStart: 1 });
});

/* ── applyMerge ── */

test('applyMerge: l2r replaces the right block with the left block\'s lines', () => {
  const left = ['a', 'old1', 'old2', 'z'];
  const right = ['a', 'new1', 'z'];
  const block = { type: 'diff', leftLines: ['old1', 'old2'], rightLines: ['new1'], leftStart: 1, rightStart: 1 };
  const result = mtx.applyMerge(left, right, block, 'l2r');
  assert.deepEqual(result.left, ['a', 'old1', 'old2', 'z']);
  assert.deepEqual(result.right, ['a', 'old1', 'old2', 'z']);
});

test('applyMerge: r2l replaces the left block with the right block\'s lines', () => {
  const left = ['a', 'old1', 'old2', 'z'];
  const right = ['a', 'new1', 'z'];
  const block = { type: 'diff', leftLines: ['old1', 'old2'], rightLines: ['new1'], leftStart: 1, rightStart: 1 };
  const result = mtx.applyMerge(left, right, block, 'r2l');
  assert.deepEqual(result.left, ['a', 'new1', 'z']);
  assert.deepEqual(result.right, ['a', 'new1', 'z']);
});

test('applyMerge: l2r on a pure-deletion block inserts the left-only lines into the right', () => {
  const left = ['a', 'onlyLeft', 'z'];
  const right = ['a', 'z'];
  const block = { type: 'diff', leftLines: ['onlyLeft'], rightLines: [], leftStart: 1, rightStart: 1 };
  const result = mtx.applyMerge(left, right, block, 'l2r');
  assert.deepEqual(result.right, ['a', 'onlyLeft', 'z']);
  assert.deepEqual(result.left, left);
});

test('applyMerge: r2l on a pure-deletion block removes the left-only lines', () => {
  const left = ['a', 'onlyLeft', 'z'];
  const right = ['a', 'z'];
  const block = { type: 'diff', leftLines: ['onlyLeft'], rightLines: [], leftStart: 1, rightStart: 1 };
  const result = mtx.applyMerge(left, right, block, 'r2l');
  assert.deepEqual(result.left, ['a', 'z']);
});

test('applyMerge: does not mutate the input arrays', () => {
  const left = ['a', 'old', 'z'];
  const right = ['a', 'new', 'z'];
  const block = { type: 'diff', leftLines: ['old'], rightLines: ['new'], leftStart: 1, rightStart: 1 };
  mtx.applyMerge(left, right, block, 'l2r');
  assert.deepEqual(left, ['a', 'old', 'z']);
  assert.deepEqual(right, ['a', 'new', 'z']);
});

/* ── escapeHtml ── */

test('escapeHtml: escapes the five reserved HTML characters', () => {
  assert.equal(mtx.escapeHtml('<div class="a">&\'b\'</div>'),
    '&lt;div class=&quot;a&quot;&gt;&amp;&#39;b&#39;&lt;/div&gt;');
});

test('escapeHtml: leaves plain text untouched', () => {
  assert.equal(mtx.escapeHtml('hello world 123'), 'hello world 123');
});
