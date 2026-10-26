// tests/homelab-power-cost-calculator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript } = require('./_setup');

const hpc = loadScript('homelab-power-cost-calculator/script.js');

const L = 'en-US';
const NBSP = String.fromCharCode(160);
const EPS = 1e-9;

// Every expected value below was worked out by hand (shown in the comments).
function close(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < EPS * Math.max(1, Math.abs(expected)), (msg || '') + ' expected ' + expected + ', got ' + actual);
}

const dev = (patch) => Object.assign(hpc.emptyDevice(), patch || {});
const state = (patch) => Object.assign(hpc.defaultState(), { devices: [] }, patch || {});
const SINGLE = { type: 'single', price: 0.3, cheapMinutes: 0 };
// Day/night: 0.40 standard, 0.20 cheap from 23:00 to 07:00 (480 min).
const TOU = { type: 'tou', dayPrice: 0.4, nightPrice: 0.2, cheapStart: 23 * 60, cheapEnd: 7 * 60, cheapMinutes: 480 };
const touState = (devices, patch) => state(Object.assign({
  tariffType: 'tou', dayPrice: '0.40', nightPrice: '0.20', cheapStart: '23:00', cheapEnd: '07:00', devices: devices
}, patch || {}));
const v = (d) => {
  const res = hpc.validateDevice(dev(d));
  assert.equal(res.errors.length, 0, JSON.stringify(res.errors));
  return res.value;
};

// ─────────────────────────────────────────────────────────────────────────────
// Average watts
// ─────────────────────────────────────────────────────────────────────────────

test('average watts: idle + (load - idle) x share at load', () => {
  close(hpc.averageWatts(20, 60, 25), 30);    // 20 + 40 x 0.25
  close(hpc.averageWatts(20, 60, 0), 20);
  close(hpc.averageWatts(20, 60, 100), 60);
  close(hpc.averageWatts(10, 10, 50), 10);    // steady draw
  close(hpc.averageWatts(30, 10, 50), 20);    // swapped readings still average
  close(hpc.averageWatts(0, 0, 50), 0);
});

test('an empty load field means a steady draw equal to idle, an empty share means 0%', () => {
  const x = v({ idle: '12.5', load: '', pct: '' });
  assert.equal(x.load, 12.5);
  assert.equal(x.pct, 0);
  assert.equal(x.qty, 1);                     // empty quantity counts as 1
  close(hpc.deviceEnergy(x, SINGLE).avgW, 12.5);
});

// ─────────────────────────────────────────────────────────────────────────────
// kWh and cost per day, month, year
// ─────────────────────────────────────────────────────────────────────────────

test('kWh per day, month and year for an always-on device (365-day year, 365/12-day month)', () => {
  const e = hpc.deviceEnergy(v({ idle: '20', load: '60', pct: '25' }), SINGLE);
  close(e.avgW, 30);
  close(e.hoursOn, 24);
  close(e.kwhDay, 0.72);                      // 30 W x 24 h / 1000
  close(e.kwhMonth, 21.9);                    // 0.72 x 365 / 12
  close(e.kwhYear, 262.8);                    // 0.72 x 365
  close(hpc.DAYS_PER_MONTH, 365 / 12);
});

test('cost per day, month and year at a single rate', () => {
  const e = hpc.deviceEnergy(v({ idle: '20', load: '60', pct: '25' }), SINGLE);
  close(e.costDay, 0.216);                    // 0.72 kWh x 0.30
  close(e.costMonth, 6.57);                   // 21.9 x 0.30
  close(e.costYear, 78.84);                   // 262.8 x 0.30
});

test('hours per day: energy only for the hours the device runs', () => {
  const e = hpc.deviceEnergy(v({ idle: '50', mode: 'hours', hours: '8' }), SINGLE);
  close(e.hoursOn, 8);
  close(e.kwhDay, 0.4);                       // 50 W x 8 h
  close(e.kwhYear, 146);                      // 0.4 x 365
  close(e.costDay, 0.12);
  const half = hpc.deviceEnergy(v({ idle: '10', mode: 'hours', hours: '0.5' }), SINGLE);
  close(half.kwhDay, 0.005);                  // 10 W x 0.5 h
});

test('time window: hours on come from the window, including one that crosses midnight', () => {
  const day = hpc.deviceEnergy(v({ idle: '100', mode: 'window', start: '09:00', end: '17:30' }), SINGLE);
  close(day.hoursOn, 8.5);
  close(day.kwhDay, 0.85);
  const night = hpc.deviceEnergy(v({ idle: '100', mode: 'window', start: '22:00', end: '02:00' }), SINGLE);
  close(night.hoursOn, 4);                    // 22:00 to midnight + midnight to 02:00
  close(night.kwhDay, 0.4);
  const toMidnight = hpc.deviceEnergy(v({ idle: '100', mode: 'window', start: '18:00', end: '00:00' }), SINGLE);
  close(toMidnight.hoursOn, 6);
});

test('quantity multiplies energy and cost, not the per-unit average', () => {
  const one = hpc.deviceEnergy(v({ qty: '1', idle: '10' }), SINGLE);
  const three = hpc.deviceEnergy(v({ qty: '3', idle: '10' }), SINGLE);
  close(three.avgW, 10);
  close(three.avgWTotal, 30);
  close(three.kwhDay, 0.72);                  // 3 x 10 W x 24 h
  close(three.kwhDay, one.kwhDay * 3);
  close(three.costYear, one.costYear * 3);
});

test('totals add up the devices; average draw is the 24-hour average of all of them', () => {
  // A: 30 W always on = 0.72 kWh; B: 3 x 10 W always on = 0.72 kWh; C: 100 W for 6 h = 0.6 kWh.
  const r = hpc.compute(state({
    devices: [dev({ idle: '30' }), dev({ qty: '3', idle: '10' }), dev({ idle: '100', mode: 'hours', hours: '6' })]
  }));
  assert.equal(r.totals.rows, 3);
  assert.equal(r.totals.units, 5);
  close(r.totals.kwhDay, 2.04);
  close(r.totals.kwhMonth, 2.04 * 365 / 12);  // 62.05
  close(r.totals.kwhYear, 744.6);
  close(r.totals.avgW24, 85);                 // 2.04 kWh x 1000 / 24 h
  close(r.totals.costDay, 0.612);             // 2.04 x 0.30
  close(r.totals.costMonth, 18.615);          // 62.05 x 0.30
  close(r.totals.costYear, 223.38);
});

test('each device gets its share of the total cost, and the shares add up to 1', () => {
  const r = hpc.compute(state({ devices: [dev({ idle: '30' }), dev({ qty: '3', idle: '10' }), dev({ idle: '100', mode: 'hours', hours: '6' })] }));
  const ok = r.devices.filter((d) => d.status === 'ok');
  close(ok[0].shareCost, 0.72 / 2.04);
  close(ok[1].shareCost, 0.72 / 2.04);
  close(ok[2].shareCost, 0.6 / 2.04);
  close(ok.reduce((s, d) => s + d.shareCost, 0), 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Day/night tariff
// ─────────────────────────────────────────────────────────────────────────────

test('cheap window length and overlap on a 24-hour clock', () => {
  assert.equal(hpc.windowMinutes(23 * 60, 7 * 60), 480);
  assert.equal(hpc.windowMinutes(60, 180), 120);
  assert.equal(hpc.windowMinutes(18 * 60, 0), 360);
  assert.equal(hpc.windowMinutes(300, 300), 0);
  const cheap = [23 * 60, 7 * 60];
  assert.equal(hpc.overlapWindows(22 * 60, 2 * 60, cheap[0], cheap[1]), 180);   // 23:00-02:00
  assert.equal(hpc.overlapWindows(6 * 60, 9 * 60, cheap[0], cheap[1]), 60);     // 06:00-07:00
  assert.equal(hpc.overlapWindows(20 * 60, 8 * 60, cheap[0], cheap[1]), 480);   // contains the whole window
  assert.equal(hpc.overlapWindows(12 * 60, 14 * 60, cheap[0], cheap[1]), 0);
  assert.equal(hpc.overlapWindows(23 * 60 + 30, 30, cheap[0], cheap[1]), 60);   // both cross midnight
  assert.equal(hpc.overlapWindows(22 * 60, 3 * 60, 60, 6 * 60), 120);           // only the device crosses midnight
  assert.equal(hpc.overlapWindows(7 * 60, 23 * 60, cheap[0], cheap[1]), 0);     // exactly the other half of the day
});

test('a 24/7 device pays the cheap rate for the cheap window share of its energy', () => {
  const e = hpc.deviceEnergy(v({ idle: '30' }), TOU);
  close(e.kwhDay, 0.72);
  close(e.cheapKwhDay, 0.24);                 // 30 W x 8 h
  close(e.stdKwhDay, 0.48);                   // 30 W x 16 h
  close(e.costDay, 0.24);                     // 0.48 x 0.40 + 0.24 x 0.20
  close(e.costYear, 87.6);
});

test('an hours-per-day device is spread evenly: 8 of 24 hours at the cheap rate', () => {
  const e = hpc.deviceEnergy(v({ idle: '30', mode: 'hours', hours: '6' }), TOU);
  close(e.kwhDay, 0.18);                      // 30 W x 6 h
  close(e.cheapKwhDay, 0.06);                 // 0.18 x 8 / 24
  close(e.stdKwhDay, 0.12);
  close(e.costDay, 0.06);                     // 0.12 x 0.40 + 0.06 x 0.20
});

test('a time-window device pays by its real overlap with the cheap window', () => {
  const late = hpc.deviceEnergy(v({ idle: '100', mode: 'window', start: '22:00', end: '02:00' }), TOU);
  close(late.cheapKwhDay, 0.3);               // 3 h of 4 inside 23:00-07:00
  close(late.stdKwhDay, 0.1);
  close(late.costDay, 0.1);                   // 0.1 x 0.40 + 0.3 x 0.20
  const morning = hpc.deviceEnergy(v({ idle: '100', mode: 'window', start: '06:00', end: '09:00' }), TOU);
  close(morning.cheapKwhDay, 0.1);
  close(morning.costDay, 0.1);                // 0.2 x 0.40 + 0.1 x 0.20
  const noon = hpc.deviceEnergy(v({ idle: '100', mode: 'window', start: '12:00', end: '14:00' }), TOU);
  close(noon.cheapKwhDay, 0);
  close(noon.costDay, 0.08);
});

test('with a day/night tariff the cost share differs from the energy share', () => {
  // A: 30 W 24/7 = 0.72 kWh costing 0.24; B: 90 W from 23:00 to 07:00 = 0.72 kWh, all cheap, costing 0.144.
  const r = hpc.compute(touState([dev({ idle: '30' }), dev({ idle: '90', mode: 'window', start: '23:00', end: '07:00' })]));
  const [a, b] = r.devices;
  close(a.shareKwh, 0.5);
  close(b.shareKwh, 0.5);
  close(r.totals.costDay, 0.384);
  close(a.shareCost, 0.625);
  close(b.shareCost, 0.375);
  close(r.totals.cheapKwhDay, 0.96);          // 0.24 + 0.72
  close(r.totals.cheapShare, 0.96 / 1.44);
});

test('blended price for an all-day load: (0.40 x 16 h + 0.20 x 8 h) / 24 h', () => {
  close(hpc.blendedPrice(TOU), 1 / 3);
  close(hpc.blendedPrice(SINGLE), 0.3);
});

test('a cheap window that does not cross midnight works the same way', () => {
  const r = hpc.compute(touState([dev({ idle: '60' })], { cheapStart: '01:00', cheapEnd: '06:00' }));
  close(r.tariff.cheapMinutes, 300);
  const e = r.devices[0].energy;
  close(e.cheapKwhDay, 0.3);                  // 60 W x 5 h
  close(e.costDay, 1.14 * 0.4 + 0.3 * 0.2);   // 19 h x 60 W = 1.14 kWh standard
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixed charge
// ─────────────────────────────────────────────────────────────────────────────

test('fixed charge per month or per day, added to the totals only', () => {
  const m = hpc.fixedCharge({ fixed: '10', fixedPeriod: 'month' });
  close(m.perMonth, 10);
  close(m.perYear, 120);
  close(m.perDay, 120 / 365);
  const d = hpc.fixedCharge({ fixed: '0.50', fixedPeriod: 'day' });
  close(d.perDay, 0.5);
  close(d.perMonth, 0.5 * 365 / 12);          // 15.2083
  close(d.perYear, 182.5);
  const r = hpc.compute(state({ fixed: '10', devices: [dev({ idle: '30' }), dev({ idle: '30' })] }));
  close(r.totals.costMonth, 13.14);           // 2 x 21.9 kWh x 0.30
  close(r.totals.grandMonth, 23.14);
  close(r.totals.grandYear, 157.68 + 120);
  close(r.devices[0].shareCost, 0.5);         // the fixed charge does not change shares
  close(r.devices[0].energy.costMonth, 6.57);
});

test('an invalid fixed charge is reported and left out', () => {
  const f = hpc.fixedCharge({ fixed: '-3', fixedPeriod: 'month' });
  assert.match(f.error, /Fixed charge -3 is negative/);
  assert.equal(f.perMonth, 0);
  assert.equal(hpc.fixedCharge({ fixed: '', fixedPeriod: 'month' }).perYear, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Payback
// ─────────────────────────────────────────────────────────────────────────────

test('payback: saving a year and a month, months to break even, net after 1, 3 and 5 years', () => {
  const p = hpc.paybackMath(60, 15, 24, 300, 0, 0.3);
  close(p.savedW, 45);
  close(p.kwhYear, 394.2);                    // 45 W x 24 h x 365 / 1000
  close(p.savingYear, 118.26);                // 394.2 x 0.30
  close(p.savingMonth, 9.855);
  close(p.months, 300 / 9.855);               // 30.44 months
  assert.equal(p.reason, 'ok');
  close(p.net[1], -181.74);
  close(p.net[3], 54.78);
  close(p.net[5], 291.3);
});

test('payback: money back for the old machine shortens the break-even', () => {
  const p = hpc.paybackMath(60, 15, 24, 300, 50, 0.3);
  close(p.netCost, 250);
  close(p.months, 250 / 9.855);               // 25.37 months
  const part = hpc.paybackMath(60, 15, 8, 300, 0, 0.3);
  close(part.kwhYear, 131.4);                 // 45 W x 8 h x 365
  close(part.savingMonth, 3.285);
  close(part.months, 300 / 3.285);            // 91.3 months
});

test('payback: never when the new machine saves nothing or costs more to run', () => {
  const same = hpc.paybackMath(15, 15, 24, 300, 0, 0.3);
  assert.equal(same.months, null);
  assert.equal(same.reason, 'not-lower');
  const worse = hpc.paybackMath(10, 20, 24, 300, 0, 0.3);
  assert.equal(worse.months, null);
  assert.equal(worse.reason, 'not-lower');
  close(worse.savingYear, -26.28);            // -10 W x 24 h x 365 x 0.30
  assert.ok(worse.net[5] < worse.net[1]);
  assert.equal(hpc.paybackMath(60, 15, 0, 300, 0, 0.3).reason, 'no-hours');
  assert.equal(hpc.paybackMath(60, 15, 24, 300, 0, 0).reason, 'free-power');
  assert.equal(hpc.paybackMath(60, 15, 24, 300, 0, 0).months, null);
});

test('payback: right away when the money back covers the price or the machine is free', () => {
  const p = hpc.paybackMath(60, 15, 24, 100, 120, 0.3);
  assert.equal(p.reason, 'immediate');
  assert.equal(p.months, 0);
  assert.equal(hpc.paybackMath(60, 15, 24, 0, 0, 0.3).months, 0);
});

test('payback inputs: empty, invalid, missing tariff, default 24 hours, blended day/night price', () => {
  assert.equal(hpc.computePayback({ oldW: '', newW: '' }, SINGLE).status, 'empty');
  const bad = hpc.computePayback({ oldW: 'sixty', newW: '15', price: '300' }, SINGLE);
  assert.equal(bad.status, 'error');
  assert.match(bad.errors[0].text, /Old machine watts "sixty" is not a number/);
  const noPrice = hpc.computePayback({ oldW: '60', newW: '15', price: '' }, SINGLE);
  assert.match(noPrice.errors[0].text, /New machine price is empty/);
  assert.equal(hpc.computePayback({ oldW: '60', newW: '15', price: '300' }, null).status, 'no-tariff');
  const ok = hpc.computePayback({ oldW: '60', newW: '15', hours: '', price: '300', resale: '' }, SINGLE);
  assert.equal(ok.value.hours, 24);
  assert.equal(ok.value.resale, 0);
  const tou = hpc.computePayback({ oldW: '60', newW: '15', price: '300' }, TOU);
  close(tou.value.savingYear, 394.2 / 3);     // blended price 1/3 per kWh
  assert.match(hpc.computePayback({ oldW: '60', newW: '15', hours: '25', price: '1' }, SINGLE).errors[0].text, /Hours per day 25 h is above the limit of 24 h/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Zero and very large values
// ─────────────────────────────────────────────────────────────────────────────

test('zero watts, zero quantity and a zero price give zeros, not NaN', () => {
  const zero = hpc.compute(state({ devices: [dev({ idle: '0' })] }));
  assert.equal(zero.devices[0].status, 'ok');
  assert.equal(zero.totals.kwhDay, 0);
  assert.equal(zero.devices[0].shareCost, null);      // no total to share
  assert.equal(zero.devices[0].shareKwh, null);
  const noQty = hpc.validateDevice(dev({ qty: '0', idle: '40' }));
  assert.equal(noQty.value.qty, 0);
  assert.match(noQty.warnings[0].text, /Quantity is 0/);
  const free = hpc.compute(state({ price: '0', devices: [dev({ idle: '40' })] }));
  assert.equal(free.totals.costYear, 0);
  close(free.totals.kwhYear, 350.4);
  assert.equal(free.devices[0].shareCost, null);
  assert.equal(hpc.formatMoney(free.totals.costYear, 'EUR', L), '€0.00');
});

test('values at the limits stay finite and format with grouping', () => {
  const r = hpc.compute(state({ price: String(hpc.LIMITS.price), devices: [dev({ qty: String(hpc.LIMITS.qty), idle: String(hpc.LIMITS.watts) })] }));
  assert.equal(r.devices[0].status, 'ok');
  close(r.totals.kwhDay, 2400000);            // 1000 x 100 kW x 24 h
  close(r.totals.kwhYear, 876000000);
  close(r.totals.costYear, 87600000000000);   // 876 million kWh x 100,000
  assert.equal(hpc.formatKwh(r.totals.kwhYear, L), '876,000,000');
  assert.equal(hpc.formatMoney(r.totals.costYear, 'EUR', L), '€87,600,000,000,000.00');
  const csv = hpc.buildCsv(r, state({ price: '100000' }));
  assert.ok(csv.includes('87600000000000'));
  assert.doesNotMatch(csv, /e\+/);
});

test('values above the sanity limits are rejected with the limit in the message', () => {
  const big = hpc.validateDevice(dev({ idle: '250000' }));
  assert.match(big.errors[0].text, /Idle watts 250000 W is above the limit of 100,000 W/);
  assert.match(hpc.validateDevice(dev({ qty: '5000', idle: '5' })).errors[0].text, /Quantity 5000 is above the limit of 1,000/);
  assert.match(hpc.validateTariff({ tariffType: 'single', price: '200000' }).errors[0].text, /Price per kWh 200000 is above the limit/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Rounding and formatting
// ─────────────────────────────────────────────────────────────────────────────

test('kWh keep more decimals when small and fewer when large', () => {
  assert.equal(hpc.formatKwh(0, L), '0');
  assert.equal(hpc.formatKwh(0.72, L), '0.720');
  assert.equal(hpc.formatKwh(3.65, L), '3.65');
  assert.equal(hpc.formatKwh(21.9, L), '21.9');
  assert.equal(hpc.formatKwh(262.8, L), '263');
  assert.equal(hpc.formatKwh(1234.5, L), '1,235');
  assert.equal(hpc.formatKwh(NaN, L), '—');
  assert.equal(hpc.formatWatts(35, L), '35');
  assert.equal(hpc.formatWatts(27.5, L), '27.5');
  assert.equal(hpc.formatWatts(1234.56, L), '1,234.6');
  assert.equal(hpc.formatPct(0.7100591715976332, L), '71.0%');
  assert.equal(hpc.formatPct(null, L), '—');
  assert.equal(hpc.formatNumber(-0.00001, L, 2, 2), '0.00');      // no "-0.00"
});

test('ISO currency codes are formatted by Intl.NumberFormat, in any letter case', () => {
  assert.equal(hpc.formatMoney(1234.5, 'EUR', L), '€1,234.50');
  assert.equal(hpc.formatMoney(1234.5, 'eur', L), '€1,234.50');
  assert.equal(hpc.formatMoney(1234.5, 'USD', L), '$1,234.50');
  assert.equal(hpc.formatMoney(1234.5, 'JPY', L), '¥1,235');      // JPY has no minor unit
  assert.equal(hpc.formatMoney(1234.5, 'UAH', L), 'UAH' + NBSP + '1,234.50');
  assert.equal(hpc.formatMoney(1234.5, 'EUR', 'de-DE'), '1.234,50' + NBSP + '€');
  assert.equal(hpc.formatMoney(-5, 'GBP', L), '-£5.00');
  assert.deepEqual(hpc.currencyInfo(' usd ', L), { iso: true, code: 'USD', symbol: 'usd', digits: 2 });
});

test('anything else is a plain symbol: one character before the amount, longer ones after', () => {
  assert.equal(hpc.formatMoney(1234.5, '$', L), '$1,234.50');
  assert.equal(hpc.formatMoney(1234.5, '€', L), '€1,234.50');
  assert.equal(hpc.formatMoney(1234.5, 'zł', L), '1,234.50 zł');
  assert.equal(hpc.formatMoney(1234.5, 'грн', L), '1,234.50 грн');
  assert.equal(hpc.formatMoney(1234.5, 'EURO', L), '1,234.50 EURO');
  assert.equal(hpc.formatMoney(-5, '$', L), '-$5.00');
  assert.equal(hpc.formatMoney(1234.5, '', L), '1,234.50');
  assert.equal(hpc.currencyInfo('kr.', L).iso, false);
});

test('money rounds to the minor unit; tiny positive amounts show as "< 0.01", never as 0', () => {
  assert.equal(hpc.formatMoney(0.216, 'EUR', L), '€0.22');
  // Half-way cases round up as on paper, despite binary floats (2.675 is stored as 2.67499...).
  assert.equal(hpc.formatMoney(2.675, 'EUR', L), '€2.68');
  assert.equal(hpc.formatMoney(1.005, '$', L), '$1.01');
  assert.equal(hpc.formatMoney(118.26 * 1 / 12 - 1e-15, 'EUR', L), '€9.86');   // 9.854999999999999
  assert.equal(hpc.formatMoney(-2.675, 'EUR', L), '-€2.68');
  assert.equal(hpc.formatNumber(1.005, L, 2, 2), '1.01');
  assert.equal(hpc.formatMoney(0.005, 'EUR', L), '€0.01');
  assert.equal(hpc.formatMoney(0.004, 'EUR', L), '< €0.01');
  assert.equal(hpc.formatMoney(0.004, '$', L), '< $0.01');
  assert.equal(hpc.formatMoney(0.3, 'JPY', L), '< ¥1');
  assert.equal(hpc.formatMoney(0, 'EUR', L), '€0.00');
  assert.equal(hpc.formatMoney(-0.001, 'EUR', L), '€0.00');
  assert.equal(hpc.formatMoney(NaN, 'EUR', L), '—');
  assert.equal(hpc.formatMoney(null, 'EUR', L), '—');
  assert.equal(hpc.formatPrice(0.2834, 'EUR', L), '€0.2834');
  assert.equal(hpc.formatPrice(0.3, 'EUR', L), '€0.30');
  assert.equal(hpc.formatPrice(31.5, 'JPY', L), '¥31.5');
});

// ─────────────────────────────────────────────────────────────────────────────
// Invalid input
// ─────────────────────────────────────────────────────────────────────────────

test('number parsing: dot or one comma as decimal separator, nothing else', () => {
  assert.equal(hpc.parseNumber(''), null);
  assert.equal(hpc.parseNumber('   '), null);
  assert.equal(hpc.parseNumber(undefined), null);
  assert.equal(hpc.parseNumber(' 7 '), 7);
  assert.equal(hpc.parseNumber('12.5'), 12.5);
  assert.equal(hpc.parseNumber('12,5'), 12.5);
  assert.equal(hpc.parseNumber('.5'), 0.5);
  assert.equal(hpc.parseNumber('-5'), -5);
  for (const bad of ['abc', '1,000.5', '1,2,3', '1.2.3', '1e3', 'Infinity', '12 W', '0x10']) {
    assert.ok(Number.isNaN(hpc.parseNumber(bad)), bad);
  }
});

test('a comma that could be a thousands separator is refused with both readings', () => {
  for (const amb of ['1,444', '12,500', '-1,000']) assert.ok(Number.isNaN(hpc.parseNumber(amb)), amb);
  assert.equal(hpc.parseNumber('0,150'), 0.15);     // a leading zero cannot be a thousands group
  assert.equal(hpc.parseNumber('1,44'), 1.44);
  assert.equal(hpc.parseNumber('1444,5'), 1444.5);
  const res = hpc.validateTariff({ tariffType: 'single', price: '1,444' });
  assert.equal(res.errors[0].text, 'Price per kWh "1,444" could mean 1444 or 1.444. Type it without the comma, or with a dot for decimals.');
});

test('time parsing: 24-hour HH:MM only', () => {
  assert.equal(hpc.parseTime('07:00'), 420);
  assert.equal(hpc.parseTime('7:05'), 425);
  assert.equal(hpc.parseTime('23:59'), 1439);
  assert.equal(hpc.parseTime('00:00'), 0);
  for (const bad of ['24:00', '12:60', '7', '7pm', '', '07:00:00']) {
    assert.ok(Number.isNaN(hpc.parseTime(bad)), bad);
  }
  assert.equal(hpc.formatTime(425), '07:05');
});

test('device errors name the field, the value and the fix', () => {
  const msg = (d) => hpc.validateDevice(dev(d)).errors.map((e) => e.field + ': ' + e.text);
  assert.match(msg({ idle: '4O' })[0], /^idle: Idle watts "4O" is not a number\. Type digits, with a dot or a comma for decimals/);
  assert.match(msg({ idle: '-5' })[0], /^idle: Idle watts -5 W is negative\. Type 0 or more\./);
  assert.match(msg({ idle: '', load: '40' })[0], /^idle: Idle watts is empty\./);
  assert.match(msg({ idle: '5', qty: '2.5' })[0], /^qty: Quantity 2\.5 is not a whole number/);
  assert.match(msg({ idle: '5', pct: '120' })[0], /^pct: Time at load 120% is above the limit of 100%/);
  assert.match(msg({ idle: '5', mode: 'hours', hours: '' })[0], /^hours: Hours per day is empty/);
  assert.match(msg({ idle: '5', mode: 'hours', hours: '25' })[0], /^hours: Hours per day 25 h is above the limit of 24 h/);
  assert.match(msg({ idle: '5', mode: 'window', start: '', end: '07:00' })[0], /^start: Start time is empty/);
  assert.match(msg({ idle: '5', mode: 'window', start: '07:00', end: '07:00' })[0], /^end: Start and end are both 07:00, so the window has no length/);
});

test('swapped readings warn but still count; a row without watts is just empty', () => {
  const w = hpc.validateDevice(dev({ idle: '40', load: '10' }));
  assert.equal(w.errors.length, 0);
  assert.match(w.warnings[0].text, /Load watts \(10 W\) are lower than idle watts \(40 W\)/);
  const empty = hpc.validateDevice(dev({ name: 'New box' }));
  assert.equal(empty.empty, true);
  assert.equal(empty.errors.length, 0);
});

test('tariff errors and warnings', () => {
  assert.match(hpc.validateTariff({ tariffType: 'single', price: '' }).errors[0].text, /Price per kWh is empty\. Type the price per kWh from your bill/);
  assert.match(hpc.validateTariff({ tariffType: 'single', price: '0,3x' }).errors[0].text, /Price per kWh "0,3x" is not a number/);
  const swapped = hpc.validateTariff({ tariffType: 'tou', dayPrice: '0.20', nightPrice: '0.40', cheapStart: '23:00', cheapEnd: '07:00' });
  assert.equal(swapped.errors.length, 0);
  assert.match(swapped.warnings[0].text, /cheap-rate price \(0\.4\) is higher than the standard price \(0\.2\)/);
  const same = hpc.validateTariff({ tariffType: 'tou', dayPrice: '0.4', nightPrice: '0.2', cheapStart: '23:00', cheapEnd: '23:00' });
  assert.match(same.errors[0].text, /starts and ends at 23:00, so it has no length/);
  const badTime = hpc.validateTariff({ tariffType: 'tou', dayPrice: '0.4', nightPrice: '0.2', cheapStart: '25:00', cheapEnd: '07:00' });
  assert.match(badTime.errors[0].text, /Cheap window start "25:00" is not a time/);
  assert.equal(hpc.validateTariff({ tariffType: 'tou', dayPrice: '', nightPrice: '0.2', cheapStart: '23:00', cheapEnd: '07:00' }).errors[0].field, 'dayPrice');
});

test('devices with errors are left out of the totals and listed by name', () => {
  const r = hpc.compute(state({ devices: [dev({ idle: '30' }), dev({ name: 'NAS', idle: 'abc' }), dev({ name: 'Spare' })] }));
  assert.deepEqual(r.devices.map((d) => d.status), ['ok', 'error', 'empty']);
  assert.equal(r.excluded.map((d) => d.label).join(), 'Device 2 "NAS"');
  assert.equal(r.empty.map((d) => d.label).join(), 'Device 3 "Spare"');
  close(r.totals.kwhDay, 0.72);
  close(r.devices[0].shareCost, 1);
});

test('an invalid tariff still shows energy, with costs left empty', () => {
  const r = hpc.compute(state({ price: '', devices: [dev({ idle: '30' })] }));
  assert.equal(r.tariff, null);
  close(r.totals.kwhDay, 0.72);
  assert.equal(r.totals.costDay, null);
  assert.equal(r.devices[0].energy.costYear, null);
  assert.equal(r.devices[0].shareCost, null);
  assert.equal(r.payback.status, 'empty');
});

// ─────────────────────────────────────────────────────────────────────────────
// URL hash
// ─────────────────────────────────────────────────────────────────────────────

test('hash round trip keeps every field exactly as typed', () => {
  const s = hpc.defaultState();
  assert.deepEqual(hpc.decodeHash(hpc.encodeHash(s)), s);
  const rich = state({
    currency: 'zł',
    tariffType: 'tou', price: '0,61', dayPrice: '0.72', nightPrice: '0,41', cheapStart: '22:00', cheapEnd: '06:00',
    fixed: '12.50', fixedPeriod: 'day',
    devices: [
      dev({ name: 'NAS, "rack" & co #1 =x', qty: '2', idle: '18.5', load: '41', pct: '15', mode: 'hours', hours: '12' }),
      dev({ name: 'Сервер ⚡ 100%', idle: 'oops', mode: 'window', start: '23:30', end: '01:15' }),
      dev()
    ],
    pb: { oldW: '95', newW: '12', hours: '20', price: '349.99', resale: '40' }
  });
  const back = hpc.decodeHash(hpc.encodeHash(rich));
  assert.deepEqual(back, rich);
  const h = hpc.encodeHash(rich);
  assert.ok(h.startsWith('#v=1&'));
  assert.doesNotMatch(h, /[ "<>]/);
});

test('hash decoding: anchors are not state, junk is ignored, devices are capped and clipped', () => {
  assert.equal(hpc.isStateHash('#how-to-use-it'), false);
  assert.deepEqual(hpc.decodeHash('#how-to-use-it'), hpc.defaultState());
  assert.deepEqual(hpc.decodeHash(''), hpc.defaultState());
  const junk = hpc.decodeHash('#v=1&zz=1&p=%E0%A4%A&tt=maybe&d=x,1,5,,,q');
  assert.equal(junk.price, '');
  assert.equal(junk.tariffType, 'single');
  assert.equal(junk.devices[0].mode, 'always');
  assert.equal(junk.devices[0].name, 'x');
  const many = '#v=1' + '&d=a,1,5'.repeat(hpc.MAX_DEVICES + 10);
  assert.equal(hpc.decodeHash(many).devices.length, hpc.MAX_DEVICES);
  const long = hpc.decodeHash('#v=1&d=' + 'n'.repeat(200) + ',1,5');
  assert.equal(long.devices[0].name.length, 60);
});

// ─────────────────────────────────────────────────────────────────────────────
// CSV and summary
// ─────────────────────────────────────────────────────────────────────────────

test('CSV: one row per counted device, totals, fixed charge rows, currency in the header', () => {
  const s = state({ fixed: '10', devices: [dev({ name: 'Server', idle: '20', load: '60', pct: '25' }), dev({ name: 'Broken', idle: 'x' })] });
  const lines = hpc.buildCsv(hpc.compute(s), s).trim().split('\r\n');
  assert.equal(lines[0], 'device,quantity,idle_w,load_w,time_at_load_pct,runs,hours_on_per_day,avg_w_while_on,kwh_per_day,kwh_per_month,kwh_per_year,cheap_rate_kwh_per_day,cost_per_day (EUR),cost_per_month (EUR),cost_per_year (EUR),share_of_cost_pct');
  assert.equal(lines[1], 'Server,1,20,60,25,always on,24,30,0.72,21.9,262.8,,0.216,6.57,78.84,100');
  assert.equal(lines[2], 'Total,1,,,,,,,0.72,21.9,262.8,,0.216,6.57,78.84,100');
  assert.equal(lines[3], 'Fixed charge,,,,,,,,,,,,0.3288,10,120,');
  assert.equal(lines[4], 'Total with fixed charge,,,,,,,,,,,,0.5448,16.57,198.84,');
  assert.equal(lines.length, 5);
});

test('CSV: day/night column, ASCII window times, quoting and formula injection guard', () => {
  const s = touState([dev({ name: '=HYPERLINK("x")', idle: '100', mode: 'window', start: '22:00', end: '02:00' }), dev({ name: 'a, b', idle: '30' })]);
  const lines = hpc.buildCsv(hpc.compute(s), s).trim().split('\r\n');
  assert.equal(lines[1], '"\'=HYPERLINK(""x"")",1,100,100,0,22:00-02:00,4,100,0.4,12.1667,146,0.3,0.1,3.0417,36.5,29.41');
  assert.ok(lines[2].startsWith('"a, b",1,30,30,0,always on,24,30,0.72,'));
  assert.equal(hpc.csvText('-cmd'), "'-cmd");
  assert.equal(hpc.csvText('@x'), "'@x");
  assert.equal(hpc.csvText('plain'), 'plain');
});

test('summary: tariff, totals, devices, fixed charge, payback and assumptions in plain text', () => {
  const s = state({
    fixed: '10',
    devices: [dev({ name: 'Server', idle: '20', load: '60', pct: '25' }), dev({ name: 'Switch', qty: '2', idle: '6' })],
    pb: { oldW: '60', newW: '15', hours: '24', price: '300', resale: '' }
  });
  const text = hpc.buildSummary(hpc.compute(s), s, L, 'https://example.test/#v=1');
  assert.match(text, /Electricity: €0\.30 per kWh, single rate/);
  assert.match(text, /Devices: 2 rows, 3 units/);
  assert.match(text, /Average draw: 42 W \(24-hour average\)/);         // 30 W + 2 x 6 W
  assert.match(text, /Energy: 1\.01 kWh a day, 30\.7 kWh a month, 368 kWh a year/);
  assert.match(text, /Electricity cost: €0\.30 a day, €9\.20 a month, €110\.38 a year/);
  assert.match(text, /Fixed charge: €10\.00 a month, not split across devices/);
  assert.match(text, /- Server: 1 × 30 W, always on, 21\.9 kWh, €6\.57, 71\.4%/);
  assert.match(text, /- Switch: 2 × 6 W, always on, 8\.76 kWh, €2\.63, 28\.6%/);
  assert.match(text, /Payback: 60 W → 15 W, 24 h a day, saves 394 kWh and €118\.26 a year \(€9\.86 a month\); break-even after 30\.4 months/);
  assert.match(text, /Assumptions: 365-day year, average month of 30\.42 days/);
  assert.match(text, /Link: https:\/\/example\.test\/#v=1$/);
  assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/);
});

test('summary: a replacement that never pays back says why', () => {
  const s = state({ devices: [dev({ idle: '10' })], pb: { oldW: '10', newW: '12', hours: '24', price: '50', resale: '' } });
  const text = hpc.buildSummary(hpc.compute(s), s, L, '');
  assert.match(text, /never pays back on electricity savings \(the new machine \(12 W\) does not draw less than the old one \(10 W\)\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source hygiene: the files go inside a WordPress block comment
// ─────────────────────────────────────────────────────────────────────────────

test('tool sources contain no comment delimiters, closing script tags or unicode escapes', () => {
  const dir = path.join(__dirname, '..', 'homelab-power-cost-calculator');
  const bs = String.fromCharCode(92);
  for (const f of ['index.html', 'style.css', 'script.js']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!text.includes('<' + '!--'), `${f}: HTML comment opener`);
    assert.ok(!text.includes('--' + '>'), `${f}: comment closer`);
    assert.ok(!new RegExp(bs + bs + 'u[0-9a-fA-F]{4}').test(text), `${f}: unicode escape`);
    const closers = text.toLowerCase().split('<' + '/script').length - 1;
    assert.equal(closers, f === 'index.html' ? 1 : 0, `${f}: closing script tags`);
  }
});

test('the example rows are labelled as examples', () => {
  for (const d of hpc.defaultState().devices) assert.match(d.name, /\(example\)$/);
});
