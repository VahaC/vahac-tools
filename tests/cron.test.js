// tests/cron.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const cron = loadScript('cron-expression-generator/script.js');

test('cron: parseField "*" returns full range', () => {
  const minutes = cron.parseField('*', cron.FIELD_CFG.min);
  assert.equal(minutes.length, 60);
  assert.equal(minutes[0], 0);
  assert.equal(minutes[59], 59);
});

test('cron: parseField "*/15" minute', () => {
  assert.deepEqual(cron.parseField('*/15', cron.FIELD_CFG.min), [0, 15, 30, 45]);
});

test('cron: parseField "0/15" minute', () => {
  assert.deepEqual(cron.parseField('0/15', cron.FIELD_CFG.min), [0, 15, 30, 45]);
});

test('cron: parseField range "1-5" dow', () => {
  assert.deepEqual(cron.parseField('1-5', cron.FIELD_CFG.dow), [1, 2, 3, 4, 5]);
});

test('cron: parseField range step "0-30/10"', () => {
  assert.deepEqual(cron.parseField('0-30/10', cron.FIELD_CFG.min), [0, 10, 20, 30]);
});

test('cron: parseField list "1,15,30"', () => {
  assert.deepEqual(cron.parseField('1,15,30', cron.FIELD_CFG.min), [1, 15, 30]);
});

test('cron: parseField list dedupes and sorts', () => {
  assert.deepEqual(cron.parseField('30,15,1,15', cron.FIELD_CFG.min), [1, 15, 30]);
});

test('cron: parseField named DOW "MON-FRI"', () => {
  assert.deepEqual(cron.parseField('MON-FRI', cron.FIELD_CFG.dow), [1, 2, 3, 4, 5]);
});

test('cron: parseField named month "JAN,DEC"', () => {
  assert.deepEqual(cron.parseField('JAN,DEC', cron.FIELD_CFG.mon), [1, 12]);
});

test('cron: parseField single value', () => {
  assert.deepEqual(cron.parseField('5', cron.FIELD_CFG.min), [5]);
});

test('cron: parseField out-of-range throws', () => {
  assert.throws(() => cron.parseField('60', cron.FIELD_CFG.min));
  assert.throws(() => cron.parseField('0', cron.FIELD_CFG.dom)); // dom starts at 1
  assert.throws(() => cron.parseField('32', cron.FIELD_CFG.dom));
  assert.throws(() => cron.parseField('7', cron.FIELD_CFG.dow)); // 0-6
  assert.throws(() => cron.parseField('13', cron.FIELD_CFG.mon));
});

test('cron: parseField invalid step', () => {
  assert.throws(() => cron.parseField('*/0', cron.FIELD_CFG.min));
  assert.throws(() => cron.parseField('*/abc', cron.FIELD_CFG.min));
});

test('cron: parseField range with from>to throws', () => {
  assert.throws(() => cron.parseField('5-2', cron.FIELD_CFG.min));
});

test('cron: parseCron 5-field expression', () => {
  const p = cron.parseCron('0 9 * * 1-5');
  assert.equal(p.raw.min, '0');
  assert.equal(p.raw.hour, '9');
  assert.equal(p.raw.dow, '1-5');
  assert.deepEqual(p.min, [0]);
  assert.deepEqual(p.hour, [9]);
  assert.deepEqual(p.dow, [1, 2, 3, 4, 5]);
});

test('cron: parseCron rejects wrong number of fields', () => {
  assert.throws(() => cron.parseCron('* * * *'));
  assert.throws(() => cron.parseCron('* * * * * *'));
  assert.throws(() => cron.parseCron(''));
});

test('cron: parseCron tolerates excess whitespace', () => {
  const p = cron.parseCron('  0    9   *   *   1-5  ');
  assert.deepEqual(p.dow, [1, 2, 3, 4, 5]);
});

test('cron: cronToHuman for "0 9 * * 1-5"', () => {
  const p = cron.parseCron('0 9 * * 1-5');
  const human = cron.cronToHuman(p);
  assert.match(human, /^At 09:00/);
});

test('cron: cronToHuman for "* * * * *"', () => {
  const p = cron.parseCron('* * * * *');
  assert.match(cron.cronToHuman(p), /every minute/i);
});

test('cron: cronToHuman for "0 0 1 1 *" (New Year)', () => {
  const p = cron.parseCron('0 0 1 1 *');
  const human = cron.cronToHuman(p);
  assert.match(human, /At 00:00/);
  assert.match(human, /January/);
});

test('cron: ordinal helper', () => {
  assert.equal(cron.ordinal(1), '1st');
  assert.equal(cron.ordinal(2), '2nd');
  assert.equal(cron.ordinal(3), '3rd');
  assert.equal(cron.ordinal(4), '4th');
  assert.equal(cron.ordinal(11), '11th');
  assert.equal(cron.ordinal(12), '12th');
  assert.equal(cron.ordinal(13), '13th');
  assert.equal(cron.ordinal(21), '21st');
  assert.equal(cron.ordinal(22), '22nd');
  assert.equal(cron.ordinal(101), '101st');
  assert.equal(cron.ordinal(111), '111th');
});

test('cron: isConsecutive', () => {
  assert.equal(cron.isConsecutive([1, 2, 3, 4]), true);
  assert.equal(cron.isConsecutive([1, 3, 5]), false);
  assert.equal(cron.isConsecutive([5]), true);
});

test('cron: findNext returns next-larger element or -1', () => {
  assert.equal(cron.findNext([1, 5, 10], 3), 5);
  assert.equal(cron.findNext([1, 5, 10], 10), -1);
  assert.equal(cron.findNext([1, 5, 10], 0), 1);
});

test('cron: pad2 helper', () => {
  assert.equal(cron.pad2(0), '00');
  assert.equal(cron.pad2(5), '05');
  assert.equal(cron.pad2(10), '10');
  assert.equal(cron.pad2(99), '99');
});

test('cron: getNextDates returns the requested count for "* * * * *"', () => {
  const p = cron.parseCron('* * * * *');
  const dates = cron.getNextDates(p, 5);
  assert.equal(dates.length, 5);
  // Successive dates differ by exactly 1 minute
  for (let i = 1; i < dates.length; i++) {
    assert.equal(dates[i] - dates[i - 1], 60_000);
  }
});

test('cron: getNextDates for "0 0 * * *" produces midnight times', () => {
  const p = cron.parseCron('0 0 * * *');
  const dates = cron.getNextDates(p, 3);
  for (const d of dates) {
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
  }
});

test('cron: getNextDates for "0 9 * * 1-5" produces weekday 9am', () => {
  const p = cron.parseCron('0 9 * * 1-5');
  const dates = cron.getNextDates(p, 5);
  for (const d of dates) {
    assert.equal(d.getHours(), 9);
    assert.equal(d.getMinutes(), 0);
    const dow = d.getDay();
    assert.ok(dow >= 1 && dow <= 5, `expected weekday, got ${dow}`);
  }
});

test('cron: getNextDates impossible expression returns [] within limit', () => {
  // Feb 30 never occurs
  const p = cron.parseCron('0 0 30 2 *');
  const dates = cron.getNextDates(p, 5);
  assert.equal(dates.length, 0);
});

test('cron: parseField step boundaries', () => {
  // "5/10" in minute means starting at 5, step 10, up to max 59
  assert.deepEqual(cron.parseField('5/10', cron.FIELD_CFG.min), [5, 15, 25, 35, 45, 55]);
});

test('cron: parseField "*/1" produces every value', () => {
  const all = cron.parseField('*/1', cron.FIELD_CFG.min);
  assert.equal(all.length, 60);
});
