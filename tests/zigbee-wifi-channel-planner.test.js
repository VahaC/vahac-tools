// tests/zigbee-wifi-channel-planner.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const zwc = loadScript('zigbee-wifi-channel-planner/script.js');

const MINUS = String.fromCharCode(0x2212);
const ZB = [];
for (let k = 11; k <= 26; k++) ZB.push(k);

// Build a planner state: aps = [[channel, width], ...]; the first one is "mine".
function st(aps, extra) {
  return Object.assign({
    region: 'eu',
    aps: aps.map((a, i) => ({ ch: String(a[0]), w: a[1] || '20', o: i === 0 ? 'own' : 'nb', name: a[2] || '' })),
    cur: '',
    thread: '',
    allow26: false
  }, extra || {});
}

// Worst grade per Zigbee channel 11..26 as a 16-letter string: C, M or O.
function grades(r) {
  return r.channels.map((c) => ({ clear: 'C', marginal: 'M', overlap: 'O' })[c.worst]).join('');
}

function single(ch, width, region) {
  return grades(zwc.evaluate(st([[ch, width]], { region: region || 'eu' })));
}

// ─────────────────────────────────────────────────────────────────────────────
// Frequency math
// ─────────────────────────────────────────────────────────────────────────────

test('Zigbee channel centres: 2405 + 5 (k - 11) MHz for every channel 11-26', () => {
  assert.deepEqual(ZB.map(zwc.zigbeeCenter), [
    2405, 2410, 2415, 2420, 2425, 2430, 2435, 2440,
    2445, 2450, 2455, 2460, 2465, 2470, 2475, 2480
  ]);
});

test('Zigbee channel centres: anything outside 11-26 or not an integer is null', () => {
  [0, 10, 27, 11.5, -11, NaN, Infinity, '11', null, undefined].forEach((v) => {
    assert.equal(zwc.zigbeeCenter(v), null, String(v));
  });
});

test('Wi-Fi channel centres: 2407 + 5 n MHz for 1-13, 2484 MHz for channel 14', () => {
  const want = [2412, 2417, 2422, 2427, 2432, 2437, 2442, 2447, 2452, 2457, 2462, 2467, 2472, 2484];
  for (let n = 1; n <= 14; n++) assert.equal(zwc.wifiCenter(n), want[n - 1], 'channel ' + n);
  [0, 15, 36, 2.5, '6', null].forEach((v) => assert.equal(zwc.wifiCenter(v), null, String(v)));
});

test('Wi-Fi spans: 20 MHz channels are centre +/- 10 MHz', () => {
  for (let n = 1; n <= 13; n++) {
    const s = zwc.wifiSpan(n, '20');
    assert.equal(s.kind, 'ht20');
    assert.equal(s.low, zwc.wifiCenter(n) - 10);
    assert.equal(s.high, zwc.wifiCenter(n) + 10);
    assert.equal(s.secondary, null);
  }
  assert.deepEqual(zwc.wifiSpan(6, '20'), { kind: 'ht20', center: 2437, primary: 6, secondary: null, low: 2427, high: 2447 });
});

test('Wi-Fi spans: HT40+ puts the secondary 4 channels above, HT40- 4 channels below', () => {
  assert.deepEqual(zwc.wifiSpan(1, '40p'), { kind: 'ht40', center: 2422, primary: 1, secondary: 5, low: 2402, high: 2442 });
  assert.deepEqual(zwc.wifiSpan(5, '40m'), { kind: 'ht40', center: 2422, primary: 5, secondary: 1, low: 2402, high: 2442 });
  assert.deepEqual(zwc.wifiSpan(9, '40p'), { kind: 'ht40', center: 2462, primary: 9, secondary: 13, low: 2442, high: 2482 });
  assert.deepEqual(zwc.wifiSpan(13, '40m'), { kind: 'ht40', center: 2462, primary: 13, secondary: 9, low: 2442, high: 2482 });
  assert.deepEqual(zwc.wifiSpan(6, '40m'), { kind: 'ht40', center: 2427, primary: 6, secondary: 2, low: 2407, high: 2447 });
});

test('Wi-Fi spans: combinations that do not exist in 2.4 GHz are null', () => {
  assert.equal(zwc.wifiSpan(10, '40p'), null);   // secondary would be 14
  assert.equal(zwc.wifiSpan(13, '40p'), null);
  assert.equal(zwc.wifiSpan(4, '40m'), null);    // secondary would be 0
  assert.equal(zwc.wifiSpan(1, '40m'), null);
  assert.equal(zwc.wifiSpan(14, '40p'), null);   // 802.11b only
  assert.equal(zwc.wifiSpan(14, '40m'), null);
  assert.equal(zwc.wifiSpan(6, '80'), null);
  assert.equal(zwc.wifiSpan(15, '20'), null);
});

test('Wi-Fi spans: channel 14 is 802.11b DSSS, 22 MHz wide', () => {
  assert.deepEqual(zwc.wifiSpan(14, '20'), { kind: 'dsss', center: 2484, primary: 14, secondary: null, low: 2473, high: 2495 });
});

test('HT40+ on p and HT40- on p+4 cover the same 40 MHz and grade Zigbee the same', () => {
  for (let p = 1; p <= 9; p++) {
    const a = zwc.wifiSpan(p, '40p');
    const b = zwc.wifiSpan(p + 4, '40m');
    assert.equal(a.center, b.center, 'pair ' + p);
    assert.equal(a.low, b.low);
    assert.equal(a.high, b.high);
    assert.equal(single(p, '40p'), single(p + 4, '40m'), 'pair ' + p);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Transmit masks and grade thresholds
// ─────────────────────────────────────────────────────────────────────────────

test('802.11n 20 MHz mask: 0 dBr to 9 MHz, -20 at 11, -28 at 20, -45 at 30 and beyond', () => {
  const m = (x) => Math.round(zwc.maskLevel('ht20', x) * 1000) / 1000;
  assert.equal(m(0), 0);
  assert.equal(m(9), 0);
  assert.equal(m(10), -10);
  assert.equal(m(11), -20);
  assert.equal(m(15.5), -24);
  assert.equal(m(20), -28);
  assert.equal(m(25), -36.5);
  assert.equal(m(30), -45);
  assert.equal(m(55), -45);
  assert.equal(m(-11), -20);   // symmetric
});

test('802.11n 40 MHz mask: 0 dBr to 19 MHz, -20 at 21, -28 at 40, -45 at 60 and beyond', () => {
  const m = (x) => Math.round(zwc.maskLevel('ht40', x) * 1000) / 1000;
  assert.equal(m(19), 0);
  assert.equal(m(20), -10);
  assert.equal(m(21), -20);
  assert.equal(m(40), -28);
  assert.equal(m(50), -36.5);
  assert.equal(m(60), -45);
  assert.equal(m(80), -45);
});

test('802.11b DSSS mask: 0 dBr within 11 MHz, -30 dBr to 22 MHz, -50 dBr beyond', () => {
  assert.equal(zwc.maskLevel('dsss', 5), 0);
  assert.equal(zwc.maskLevel('dsss', 10.99), 0);
  assert.equal(zwc.maskLevel('dsss', 11), -30);   // boundaries go to the lower zone
  assert.equal(zwc.maskLevel('dsss', 21.99), -30);
  assert.equal(zwc.maskLevel('dsss', 22), -50);
  assert.equal(zwc.maskLevel('dsss', 40), -50);
});

test('Grade thresholds, 20 MHz: overlap below 11 MHz centre spacing, clear from 21 MHz', () => {
  const g = (d) => zwc.gradeOffset(d, 'ht20');
  assert.equal(g(0).grade, 'overlap');
  assert.equal(g(10.99).grade, 'overlap');
  assert.equal(g(11).grade, 'marginal');
  assert.equal(g(11).gap, 0);
  assert.equal(g(20.99).grade, 'marginal');
  assert.equal(g(21).grade, 'clear');
  assert.equal(g(21).near, 20);
  assert.equal(g(21).gap, 10);
  assert.equal(g(-21).grade, 'clear');
  assert.equal(g(-10.5).grade, 'overlap');
});

test('Grade thresholds, 40 MHz: overlap below 21 MHz centre spacing, clear from 41 MHz', () => {
  const g = (d) => zwc.gradeOffset(d, 'ht40');
  assert.equal(g(20.99).grade, 'overlap');
  assert.equal(g(21).grade, 'marginal');
  assert.equal(g(21).gap, 0);
  assert.equal(g(40.99).grade, 'marginal');
  assert.equal(g(41).grade, 'clear');
  assert.equal(g(41).gap, 20);
});

test('Grade thresholds, channel 14 DSSS: overlap below 12 MHz, clear from 23 MHz', () => {
  const g = (d) => zwc.gradeOffset(d, 'dsss');
  assert.equal(g(11.99).grade, 'overlap');
  assert.equal(g(12).grade, 'marginal');
  assert.equal(g(22.99).grade, 'marginal');
  assert.equal(g(23).grade, 'clear');
  assert.equal(g(23).maskDb, -50);
  assert.equal(g(14).maskDb, -30);
});

test('Gap and mask level at the near Zigbee edge, worked by hand for Wi-Fi 11 (2462 MHz)', () => {
  const r = zwc.evaluate(st([[11]]));
  const at = (k) => r.channels[k - 11].nearest;
  assert.equal(at(25).gap, 2);                      // 2474 - 2472
  assert.equal(Math.round(at(25).maskDb * 1000), -20889);   // -20 - 8 * 1/9
  assert.equal(at(26).gap, 7);                      // 2479 - 2472
  assert.equal(Math.round(at(26).maskDb * 1000), -25333);   // -20 - 8 * 6/9
  assert.equal(at(20).gap, 1);                      // 2452 - 2451
  assert.equal(at(20).maskDb, -20);
  assert.equal(at(22).gap, -9);                     // 2 MHz from the centre: deep inside
  assert.equal(at(22).maskDb, 0);
  assert.equal(at(18).gap, 11);                     // 2441 vs 2452: clear
});

// ─────────────────────────────────────────────────────────────────────────────
// Every Zigbee channel against single Wi-Fi channels (worked by hand)
// ─────────────────────────────────────────────────────────────────────────────

test('Wi-Fi 1 (20 MHz): Zigbee 11-14 overlapped, 15-16 marginal, 17-26 clear', () => {
  assert.equal(single(1), 'OOOOMMCCCCCCCCCC');
});

test('Wi-Fi 6 (20 MHz): 16-19 overlapped, 14-15 and 20-21 marginal, the rest clear', () => {
  assert.equal(single(6), 'CCCMMOOOOMMCCCCC');
});

test('Wi-Fi 11 (20 MHz): 21-24 overlapped, 19-20 and 25-26 marginal, 11-18 clear', () => {
  assert.equal(single(11), 'CCCCCCCCMMOOOOMM');
});

test('Wi-Fi 13 (20 MHz): 23-26 overlapped, 21-22 marginal, 11-20 clear', () => {
  assert.equal(single(13), 'CCCCCCCCCCMMOOOO');
});

test('Wi-Fi 1+5 at 40 MHz: 11-18 overlapped, 19-22 marginal, 23-26 clear', () => {
  assert.equal(single(1, '40p'), 'OOOOOOOOMMMMCCCC');
});

test('20 vs 40 MHz on the same primary: 40 MHz widens the overlapped and marginal zones', () => {
  assert.equal(single(1, '20'), 'OOOOMMCCCCCCCCCC');
  assert.equal(single(1, '40p'), 'OOOOOOOOMMMMCCCC');
  assert.equal(single(13, '20'), 'CCCCCCCCCCMMOOOO');
  assert.equal(single(13, '40m'), 'CCCCMMMMOOOOOOOO');
});

test('Wi-Fi 14 (802.11b, Japan): 25-26 overlapped, 23-24 marginal, 11-22 clear', () => {
  assert.equal(single(14, '20', 'jp'), 'CCCCCCCCCCCCMMOO');
});

test('Every Zigbee channel is overlapped by exactly the Wi-Fi channels within 10 MHz + 1 MHz', () => {
  for (let n = 1; n <= 13; n++) {
    const r = zwc.evaluate(st([[n]]));
    r.channels.forEach((c) => {
      const d = Math.abs(c.center - zwc.wifiCenter(n));
      assert.equal(c.worst === 'overlap', d < 11, 'Wi-Fi ' + n + ' Zigbee ' + c.k);
      assert.equal(c.worst === 'clear', d >= 21, 'Wi-Fi ' + n + ' Zigbee ' + c.k);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Several access points
// ─────────────────────────────────────────────────────────────────────────────

test('Several access points: the worst grade counts and the nearest edge is reported', () => {
  const r = zwc.evaluate(st([[1, '40p', 'Office'], [11, '20', 'Flat 2'], [13, '20', 'Flat 3']]));
  assert.equal(grades(r), 'OOOOOOOOMMOOOOOO');
  const c19 = r.channels[19 - 11];
  const c20 = r.channels[20 - 11];
  assert.equal(c19.count, 2);         // skirt of the 40 MHz AP and of channel 11
  assert.equal(c19.gap, 2);
  assert.equal(c19.nearest.ap.label, 'Office');
  assert.equal(c20.count, 2);
  assert.equal(c20.gap, 1);
  assert.equal(c20.nearest.ap.label, 'Flat 2');
  assert.equal(r.channels[23 - 11].count, 2);   // inside channel 11 and channel 13
  assert.equal(r.channels[25 - 11].count, 1);
  assert.equal(r.rec.k, 20);          // ZLL channel among the two equal marginal ones
  assert.equal(r.runnerUp.k, 19);
});

test('Own and neighbour access points count the same; labels default by owner and position', () => {
  const r = zwc.evaluate({ region: 'eu', aps: [{ ch: '6', w: '20', o: 'nb', name: '' }, { ch: '1', w: '20', o: 'own', name: '' }], cur: '', thread: '', allow26: false });
  assert.equal(r.aps[0].label, 'Neighbour #1');
  assert.equal(r.aps[1].label, 'Your AP #2');
  assert.equal(r.aps[1].own, true);
  const swapped = zwc.evaluate({ region: 'eu', aps: [{ ch: '6', w: '20', o: 'own', name: '' }, { ch: '1', w: '20', o: 'nb', name: '' }], cur: '', thread: '', allow26: false });
  assert.equal(grades(r), grades(swapped));
});

test('Rows with errors are left out of the grading but reported', () => {
  const r = zwc.evaluate(st([[6], [10, '40p']]));
  assert.equal(r.good.length, 1);
  assert.equal(r.aps[1].errors.length, 1);
  assert.equal(grades(r), single(6));
});

// ─────────────────────────────────────────────────────────────────────────────
// Recommendations for common layouts (worked by hand)
// ─────────────────────────────────────────────────────────────────────────────

test('1/6/11 (Europe): 25 sits next to one network only, runner-up 15, Thread gets 26', () => {
  const r = zwc.evaluate(st([[1], [6], [11]]));
  assert.equal(grades(r), 'OOOOMOOOOMOOOOMM');
  assert.equal(r.rec.k, 25);
  assert.equal(r.rec.worst, 'marginal');
  assert.equal(r.rec.count, 1);
  assert.equal(r.runnerUp.k, 15);     // 15 and 20 tie (two networks, 1 MHz): lower number
  assert.equal(r.threadPick.k, 26);
  assert.match(zwc.reasonFor(r.rec, r), /transmit-mask skirt of 1 Wi-Fi network: 2 MHz from the edge of channel 11/);
});

test('1/6/11 (US): still 25, with the reduced-power note in the reason', () => {
  const r = zwc.evaluate(st([[1], [6], [11]], { region: 'us' }));
  assert.equal(r.rec.k, 25);
  assert.equal(r.runnerUp.k, 15);
  assert.equal(r.rec.usPower, true);
  assert.match(zwc.reasonFor(r.rec, r), /On US radios, channels 25 and 26 need reduced transmit power/);
  assert.doesNotMatch(zwc.reasonFor(r.runnerUp, r), /US radios/);
});

test('1/6/11 with channel 26 allowed: 26 (7 MHz gap) beats 25 (2 MHz)', () => {
  const r = zwc.evaluate(st([[1], [6], [11]], { allow26: true }));
  assert.equal(r.rec.k, 26);
  assert.equal(r.runnerUp.k, 25);
  assert.equal(r.threadPick.k, 25);
});

test('1/5/9/13: every Zigbee channel overlaps; 11 overlaps one network least deeply among ZLL channels', () => {
  const r = zwc.evaluate(st([[1], [5], [9], [13]]));
  assert.equal(grades(r), 'OOOOOOOOOOOOOOOO');
  r.channels.forEach((c) => assert.equal(c.count, 1, 'Zigbee ' + c.k));
  assert.equal(r.rec.k, 11);          // gap -4, ZLL
  assert.equal(r.runnerUp.k, 15);     // gap -4, ZLL
  assert.equal(r.rec.worst, 'overlap');
  assert.match(zwc.reasonFor(r.rec, r), /4 MHz inside the edge of channel 1 .*No channel here avoids every network/);
});

test('A single access point on 6 (Europe): 25 (27 MHz away), runner-up 11 (21 MHz)', () => {
  const r = zwc.evaluate(st([[6]]));
  assert.equal(r.rec.k, 25);
  assert.equal(r.rec.gap, 27);
  assert.equal(r.runnerUp.k, 11);
  assert.equal(r.runnerUp.gap, 21);
  assert.match(zwc.reasonFor(r.rec, r), /Clear of the Wi-Fi network you entered: its edge, channel 6 .* is 27 MHz away/);
});

test('A single access point on 6 (US): 11 first, 25 after it because of the US power limit', () => {
  const r = zwc.evaluate(st([[6]], { region: 'us' }));
  assert.equal(r.rec.k, 11);
  assert.equal(r.runnerUp.k, 25);
  assert.equal(r.threadPick.k, 24);   // clear, no power limit, widest gap among the rest
});

test('A single access point on 6 with 26 allowed (Europe): 26 then 25', () => {
  const r = zwc.evaluate(st([[6]], { allow26: true }));
  assert.equal(r.rec.k, 26);
  assert.equal(r.runnerUp.k, 25);
});

test('40 MHz on 1+5: 25 is clear; runner-up 24, the widest clear gap outside the ZLL set', () => {
  ['eu', 'us'].forEach((region) => {
    const r = zwc.evaluate(st([[1, '40p']], { region: region }));
    assert.equal(r.rec.k, 25, region);
    assert.equal(r.rec.worst, 'clear');
    assert.equal(r.runnerUp.k, 24, region);
  });
  const same = zwc.evaluate(st([[5, '40m']]));
  assert.equal(same.rec.k, 25);
  assert.equal(same.runnerUp.k, 24);
});

test('The default example (6 mine, 1 and 11 neighbours) recommends 25', () => {
  const r = zwc.evaluate(zwc.defaultState());
  assert.equal(r.rec.k, 25);
  assert.equal(r.runnerUp.k, 15);
});

test('Presets build the layouts they are named after', () => {
  assert.deepEqual(zwc.presetAps('1-6-11').map((a) => a.ch + '/' + a.w + '/' + a.o), ['1/20/own', '6/20/nb', '11/20/nb']);
  assert.deepEqual(zwc.presetAps('1-5-9-13').map((a) => a.ch), ['1', '5', '9', '13']);
  assert.deepEqual(zwc.presetAps('single-6').map((a) => a.ch + '/' + a.w), ['6/20']);
  assert.deepEqual(zwc.presetAps('40-1-5').map((a) => a.ch + '/' + a.w), ['1/40p']);
  assert.equal(zwc.presetAps('nope'), null);
});

test('No Wi-Fi entered: every Zigbee channel is clear and nothing is recommended', () => {
  const r = zwc.evaluate(st([]));
  assert.equal(grades(r), 'CCCCCCCCCCCCCCCC');
  assert.equal(r.rec, null);
  assert.equal(r.runnerUp, null);
  assert.equal(r.threadPick, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Channel 25 / 26 caveats, Thread and the current channel
// ─────────────────────────────────────────────────────────────────────────────

test('Channel 26 is never picked unless allowed, even when it is the only clear channel', () => {
  const s = st([[1], [5], [10]]);
  const r = zwc.evaluate(s);
  const clear = r.channels.filter((c) => c.worst === 'clear').map((c) => c.k);
  assert.deepEqual(clear, [26]);
  assert.notEqual(r.rec.k, 26);
  assert.notEqual(r.runnerUp.k, 26);
  assert.equal(r.threadPick.k, 26);   // Thread may use 26
  const allowed = zwc.evaluate(Object.assign(s, { allow26: true }));
  assert.equal(allowed.rec.k, 26);
});

test('US region marks Zigbee 25 and 26 as reduced power; other regions do not', () => {
  const us = zwc.evaluate(st([[1]], { region: 'us' }));
  assert.deepEqual(us.channels.filter((c) => c.usPower).map((c) => c.k), [25, 26]);
  ['eu', 'jp'].forEach((region) => {
    const r = zwc.evaluate(st([[1]], { region: region }));
    assert.equal(r.channels.filter((c) => c.usPower).length, 0, region);
  });
});

test('The ZLL channels 11, 15, 20 and 25 are flagged', () => {
  const r = zwc.evaluate(st([[6]]));
  assert.deepEqual(r.channels.filter((c) => c.zll).map((c) => c.k), [11, 15, 20, 25]);
  assert.deepEqual(zwc.ZLL_CHANNELS, [11, 15, 20, 25]);
});

test('The Thread channel is kept out of the Zigbee pick', () => {
  const r = zwc.evaluate(st([[1], [6], [11]], { thread: '25' }));
  assert.equal(r.thread, 25);
  assert.equal(r.channels[25 - 11].isThread, true);
  assert.equal(r.rec.k, 15);
  assert.equal(r.runnerUp.k, 20);
});

test('The Thread suggestion avoids the Zigbee pick and the current Zigbee channel', () => {
  const r = zwc.evaluate(st([[6]], { cur: '26', allow26: true }));
  assert.equal(r.rec.k, 26);
  assert.notEqual(r.threadPick.k, 26);
  assert.equal(r.threadPick.k, 25);
  const r2 = zwc.evaluate(st([[6]], { cur: '25' }));
  assert.equal(r2.rec.k, 25);
  assert.equal(r2.threadPick.k, 26);
});

test('Zigbee and Thread on the same channel raise a warning', () => {
  const r = zwc.evaluate(st([[6]], { cur: '20', thread: '20' }));
  assert.ok(r.issues.some((x) => /both on channel 20/.test(x.text)));
  assert.equal(r.channels[20 - 11].isCurrent, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Regions and validation
// ─────────────────────────────────────────────────────────────────────────────

test('Region channel sets: US 1-11, Europe 1-13, Japan 1-13 plus 14', () => {
  assert.deepEqual(zwc.regionChannels('us'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(zwc.regionChannels('eu'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(zwc.regionChannels('jp'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.deepEqual(zwc.regionChannels('xx'), zwc.regionChannels('eu'));
});

test('HT40 primaries per region: HT40+ 1-7 in the US, 1-9 elsewhere; HT40- 5-11 / 5-13', () => {
  assert.deepEqual(zwc.ht40Primaries('us', '40p'), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(zwc.ht40Primaries('us', '40m'), [5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(zwc.ht40Primaries('eu', '40p'), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(zwc.ht40Primaries('eu', '40m'), [5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(zwc.ht40Primaries('jp', '40p'), zwc.ht40Primaries('eu', '40p'));
  assert.deepEqual(zwc.ht40Primaries('jp', '40m'), zwc.ht40Primaries('eu', '40m'));
});

test('Validation: channels outside the region warn but still count', () => {
  const us12 = zwc.validateAp({ ch: '12', w: '20', o: 'nb' }, 'us', 0);
  assert.equal(us12.errors.length, 0);
  assert.ok(us12.span);
  assert.match(us12.warnings[0], /outside the US channel set/);
  const eu14 = zwc.validateAp({ ch: '14', w: '20', o: 'nb' }, 'eu', 0);
  assert.match(eu14.warnings[0], /allowed only in Japan/);
  const jp14 = zwc.validateAp({ ch: '14', w: '20', o: 'nb' }, 'jp', 0);
  assert.equal(jp14.warnings.length, 1);
  assert.match(jp14.warnings[0], /802\.11b DSSS, 22 MHz wide/);
  const eu13 = zwc.validateAp({ ch: '13', w: '20', o: 'nb' }, 'eu', 0);
  assert.equal(eu13.warnings.length, 0);
});

test('Validation: HT40+ on 8 in the US warns about secondary channel 12', () => {
  const v = zwc.validateAp({ ch: '8', w: '40p', o: 'own' }, 'us', 0);
  assert.equal(v.errors.length, 0);
  assert.match(v.warnings[0], /uses channel 12 as its secondary, outside the US set/);
  assert.equal(zwc.validateAp({ ch: '8', w: '40p', o: 'own' }, 'eu', 0).warnings.length, 0);
});

test('Validation: impossible channel and width combinations are errors that name the fix', () => {
  const plus10 = zwc.validateAp({ ch: '10', w: '40p' }, 'eu', 0);
  assert.equal(plus10.span, null);
  assert.match(plus10.errors[0], /HT40\+ on channel 10 would need channel 14 .*\(secondary 6\)/);
  const minus3 = zwc.validateAp({ ch: '3', w: '40m' }, 'eu', 0);
  assert.match(minus3.errors[0], /secondary 7/);
  const ch14wide = zwc.validateAp({ ch: '14', w: '40m' }, 'jp', 0);
  assert.match(ch14wide.errors[0], /Channel 14 is 802\.11b \(DSSS\) only/);
});

test('Invalid input: bad channels and widths are errors, never graded', () => {
  ['0', '15', 'abc', '', '6.5', '-1', '1e1'].forEach((ch) => {
    const v = zwc.validateAp({ ch: ch, w: '20' }, 'eu', 0);
    assert.equal(v.span, null, ch);
    assert.match(v.errors[0], /is not a 2\.4 GHz Wi-Fi channel/, ch);
  });
  const w = zwc.validateAp({ ch: '6', w: '80' }, 'eu', 0);
  assert.match(w.errors[0], /Width "80" is not supported/);
  assert.equal(zwc.validateAp({ ch: undefined, w: undefined }, 'eu', 0).span, null);
  assert.equal(zwc.validateAp(null, 'eu', 0).span, null);
});

test('Invalid input: current and Thread channels outside 11-26 are ignored with a warning', () => {
  const r = zwc.evaluate(st([[6]], { cur: '27', thread: 'x' }));
  assert.equal(r.cur, null);
  assert.equal(r.thread, null);
  assert.equal(r.issues.length, 2);
  assert.match(r.issues[0].text, /Current Zigbee channel "27"/);
  assert.match(r.issues[1].text, /Thread channel "x"/);
});

test('Invalid input: more than 12 access points are cut with a warning', () => {
  const aps = [];
  for (let i = 0; i < 14; i++) aps.push([1 + (i % 13)]);
  const r = zwc.evaluate(st(aps));
  assert.equal(r.aps.length, zwc.MAX_APS);
  assert.ok(r.issues.some((x) => /first 12 access points/.test(x.text)));
});

test('Unknown region falls back to Europe', () => {
  const r = zwc.evaluate(st([[13]], { region: 'mars' }));
  assert.equal(r.region, 'eu');
  assert.equal(r.aps[0].warnings.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// URL hash, snippets and text output
// ─────────────────────────────────────────────────────────────────────────────

test('URL hash round trip keeps every field, including awkward names', () => {
  const s = {
    region: 'jp',
    aps: [
      { ch: '13', w: '40m', o: 'own', name: 'Attic & loft, #2 = "best" 100%' },
      { ch: '14', w: '20', o: 'nb', name: 'Café Wi-Fi' },
      { ch: '6', w: '20', o: 'nb', name: '' }
    ],
    cur: '15',
    thread: '25',
    allow26: true
  };
  const h = zwc.encodeHash(s);
  assert.match(h, /^#v=1&r=jp&a=13,40m,o,/);
  assert.ok(!/[ "#&]/.test(h.slice(1).split('&').map((p) => p.split('=').slice(1).join('=')).join('')), 'values are percent-encoded');
  assert.deepEqual(zwc.decodeHash(h), s);
});

test('URL hash: the default state round-trips and only v=1 hashes are state', () => {
  const d = zwc.defaultState();
  assert.deepEqual(zwc.decodeHash(zwc.encodeHash(d)), d);
  assert.equal(zwc.isStateHash('#v=1&r=us'), true);
  assert.equal(zwc.isStateHash('#how-to-use-it'), false);
  assert.equal(zwc.isStateHash(''), false);
  assert.deepEqual(zwc.decodeHash('#how-to-use-it'), d);
});

test('URL hash: garbage is sanitised instead of throwing', () => {
  const s = zwc.decodeHash('#v=1&r=xx&a=%E0%A4%A,20,o,&a=6,20,n,%ZZ&z=99&t=abc&x=yes&junk&=5');
  assert.equal(s.region, 'eu');
  assert.equal(s.aps.length, 2);
  assert.equal(s.aps[0].ch, '');           // undecodable value
  assert.equal(s.aps[1].name, '');
  assert.equal(s.cur, '99');
  assert.equal(s.allow26, false);
  const r = zwc.evaluate(s);
  assert.equal(r.aps[0].errors.length, 1);
  assert.equal(r.cur, null);
  const many = '#v=1' + '&a=6,20,n,'.repeat(20);
  assert.equal(zwc.decodeHash(many).aps.length, zwc.MAX_APS);
  const long = zwc.decodeHash('#v=1&a=6,20,n,' + 'x'.repeat(200));
  assert.equal(long.aps[0].name.length, zwc.MAX_NAME);
});

test('Zigbee2MQTT snippet uses the documented advanced.channel key', () => {
  assert.equal(zwc.z2mSnippet(25), 'advanced:\n    channel: 25\n');
});

test('Plain-text summary is ASCII-friendly and names the pick', () => {
  const r = zwc.evaluate(st([[1], [6], [11, '40m']], { cur: '11' }));
  const text = zwc.buildSummary(r, 'https://example.test/#v=1');
  assert.match(text, /Recommended Zigbee channel: \d+ \(/);
  assert.match(text, /Runner-up: \d+/);
  assert.match(text, /Current Zigbee channel: 11 \(overlapped\)/);
  assert.match(text, /40 MHz HT40-/);
  assert.match(text, /Link: https:\/\/example\.test\/#v=1/);
  assert.ok(!text.includes(MINUS), 'no Unicode minus in the summary');
});

test('fmtNum and chText format gaps and channel pairs', () => {
  assert.equal(zwc.fmtNum(2), '2');
  assert.equal(zwc.fmtNum(-4), MINUS + '4');
  assert.equal(zwc.fmtNum(-4, true), '-4');
  assert.equal(zwc.fmtNum(20.888), '20.9');
  assert.equal(zwc.fmtNum(-0.01), '0');
  assert.equal(zwc.chText(zwc.wifiSpan(1, '40p')), '1+5');
  assert.equal(zwc.chText(zwc.wifiSpan(5, '40m')), '5+1');
  assert.equal(zwc.chText(zwc.wifiSpan(6, '20')), '6');
});

test('escapeHtml neutralises markup in access point names', () => {
  assert.equal(zwc.escapeHtml('<b>"A" & \'B\'</b>'), '&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;');
});
