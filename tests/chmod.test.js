// tests/chmod.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const chm = loadScript('chmod-file-permission-calculator/script.js');

function state(o) {
  return Object.assign({
    owner_r: false, owner_w: false, owner_x: false,
    group_r: false, group_w: false, group_x: false,
    other_r: false, other_w: false, other_x: false,
    setuid: false, setgid: false, sticky: false
  }, o);
}

test('chmod: triplet rwx → 7', () => {
  assert.equal(chm.triplet(true, true, true), 7);
  assert.equal(chm.triplet(true, true, false), 6);
  assert.equal(chm.triplet(true, false, false), 4);
  assert.equal(chm.triplet(false, false, false), 0);
  assert.equal(chm.triplet(false, true, true), 3);
});

test('chmod: stateToNumeric 755', () => {
  const s = state({
    owner_r: true, owner_w: true, owner_x: true,
    group_r: true, group_x: true,
    other_r: true, other_x: true
  });
  assert.equal(chm.stateToNumeric(s), '755');
});

test('chmod: stateToNumeric 644', () => {
  const s = state({
    owner_r: true, owner_w: true,
    group_r: true,
    other_r: true
  });
  assert.equal(chm.stateToNumeric(s), '644');
});

test('chmod: stateToNumeric with special bits prefixes with 4 digits', () => {
  const s = state({
    owner_r: true, owner_w: true, owner_x: true,
    group_r: true, group_x: true,
    other_r: true, other_x: true,
    setuid: true
  });
  assert.equal(chm.stateToNumeric(s), '4755');
});

test('chmod: stateToNumeric sticky bit only → 1000', () => {
  const s = state({ sticky: true });
  assert.equal(chm.stateToNumeric(s), '1000');
});

test('chmod: numericToState 755 round-trip', () => {
  const s = chm.numericToState('755');
  assert.equal(chm.stateToNumeric(s), '755');
});

test('chmod: numericToState 4755 includes setuid', () => {
  const s = chm.numericToState('4755');
  assert.equal(s.setuid, true);
  assert.equal(s.owner_x, true);
});

test('chmod: numericToState 1777 includes sticky', () => {
  const s = chm.numericToState('1777');
  assert.equal(s.sticky, true);
  assert.equal(s.other_x, true);
});

test('chmod: numericToState invalid input returns null', () => {
  assert.equal(chm.numericToState('888'), null);
  assert.equal(chm.numericToState('7'), null);
  assert.equal(chm.numericToState('abc'), null);
  assert.equal(chm.numericToState(''), null);
  assert.equal(chm.numericToState('77777'), null);
});

test('chmod: stateToSymbolic 755 → rwxr-xr-x', () => {
  const s = chm.numericToState('755');
  assert.equal(chm.stateToSymbolic(s), 'rwxr-xr-x');
});

test('chmod: stateToSymbolic 644 → rw-r--r--', () => {
  const s = chm.numericToState('644');
  assert.equal(chm.stateToSymbolic(s), 'rw-r--r--');
});

test('chmod: stateToSymbolic 4755 (setuid + exec) → rwsr-xr-x', () => {
  const s = chm.numericToState('4755');
  assert.equal(chm.stateToSymbolic(s), 'rwsr-xr-x');
});

test('chmod: stateToSymbolic 4644 (setuid, no exec) → rwSr--r--', () => {
  const s = chm.numericToState('4644');
  assert.equal(chm.stateToSymbolic(s), 'rwSr--r--');
});

test('chmod: stateToSymbolic 1777 (sticky + exec for other) → rwxrwxrwt', () => {
  const s = chm.numericToState('1777');
  assert.equal(chm.stateToSymbolic(s), 'rwxrwxrwt');
});

test('chmod: stateToSymbolic 1666 (sticky, no exec for other) → rw-rw-rwT', () => {
  const s = chm.numericToState('1666');
  assert.equal(chm.stateToSymbolic(s), 'rw-rw-rwT');
});

test('chmod: stateToSymbolic 2755 (setgid + exec) → rwxr-sr-x', () => {
  const s = chm.numericToState('2755');
  assert.equal(chm.stateToSymbolic(s), 'rwxr-sr-x');
});

test('chmod: symbolicToState rwxr-xr-x → 755', () => {
  const s = chm.symbolicToState('rwxr-xr-x');
  assert.equal(chm.stateToNumeric(s), '755');
});

test('chmod: symbolicToState handles 10-char form with file type prefix', () => {
  const s = chm.symbolicToState('-rwxr-xr-x');
  assert.equal(chm.stateToNumeric(s), '755');
  const sd = chm.symbolicToState('drwxr-xr-x');
  assert.equal(chm.stateToNumeric(sd), '755');
});

test('chmod: symbolicToState rwsr-xr-x → 4755', () => {
  const s = chm.symbolicToState('rwsr-xr-x');
  assert.equal(chm.stateToNumeric(s), '4755');
});

test('chmod: symbolicToState rwSr--r-- → 4644', () => {
  const s = chm.symbolicToState('rwSr--r--');
  assert.equal(chm.stateToNumeric(s), '4644');
});

test('chmod: symbolicToState rwxrwxrwt → 1777', () => {
  const s = chm.symbolicToState('rwxrwxrwt');
  assert.equal(chm.stateToNumeric(s), '1777');
});

test('chmod: symbolicToState invalid input returns null', () => {
  assert.equal(chm.symbolicToState('abc'), null);
  assert.equal(chm.symbolicToState(''), null);
  assert.equal(chm.symbolicToState('rwxrwxrwx_'), null);
  assert.equal(chm.symbolicToState('rwxQwxrwx'), null); // invalid char at pos 3
});

test('chmod: round-trip all common presets', () => {
  for (const n of ['000', '400', '444', '600', '644', '664', '700', '750', '755', '775', '777', '4755', '2755', '1777']) {
    const s = chm.numericToState(n);
    assert.ok(s, `numericToState(${n}) should not be null`);
    const sym = chm.stateToSymbolic(s);
    const back = chm.symbolicToState(sym);
    assert.deepEqual(back, s, `round-trip failed for ${n}: ${sym}`);
    assert.equal(chm.stateToNumeric(back), n);
  }
});
