// tests/home-assistant-schedule-visualizer.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript } = require('./_setup');

const hav = loadScript('home-assistant-schedule-visualizer/script.js');

const CMT_OPEN = '<' + '!--';
const CMT_CLOSE = '--' + '>';
const SCRIPT_END = '<' + '/script>';
const BS = String.fromCharCode(92);

// Wall-clock seconds for a local date and time (a naive datetime)
const W = (y, mo, d, H, M, S) => hav.daysFromCivil(y, mo, d) * 86400 + (H || 0) * 3600 + (M || 0) * 60 + (S || 0);
const utc = (y, mo, d, H, M, S) => Date.UTC(y, mo - 1, d, H || 0, M || 0, S || 0) / 1000;
const zone = (name) => hav.getZone(name);
const inst = (zn, w, f) => hav.toInstant(zone(zn), w, f || 0);
const lists = (h, m, s) => ({ h: hav.parseTimeExpression(h, 0, 23), m: hav.parseTimeExpression(m, 0, 59), s: hav.parseTimeExpression(s, 0, 59) });

// find_next_time_expression_time(now, ...) returned as a UTC instant, like HA's tests do with as_utc()
function find(zn, now, hour, minute, second) {
  const L = lists(hour, minute, second);
  const r = hav.findNextTimeExpression(zone(zn), now, L.s, L.m, L.h);
  return hav.toInstant(zone(zn), r.w, r.f);
}

// Successive fire instants the way helpers/event.py drives the matcher
function fires(zn, L, fromSec, toSec) {
  const out = [];
  let t = hav.nextPatternInstant(zone(zn), L, fromSec);
  while (t < toSec) {
    out.push(t);
    t = hav.nextPatternInstant(zone(zn), L, t + 1);
  }
  return out;
}

const localStr = (zn, t) => {
  const l = hav.fromInstant(zone(zn), t);
  const p = hav.wallParts(l.w);
  return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0') + ' ' +
    String(p.H).padStart(2, '0') + ':' + String(p.M).padStart(2, '0') + ':' + String(p.S).padStart(2, '0') + (l.f ? ' (2nd)' : '');
};

function load(yaml) {
  const p = hav.parseYaml(yaml);
  assert.equal(p.error, null, p.error && p.error.message);
  const found = hav.findAutomations(p.root);
  assert.equal(found.error, '', found.error);
  return { parsed: p, found, model: hav.analyzeAutomation(found.items[0].obj) };
}

const plain = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const msgs = (list) => list.map((e) => plain(e.msg));

function sim(model, zn, y, m, d, extra) {
  return hav.simulate(model, Object.assign({ zoneName: zn, obs: null, startDays: hav.daysFromCivil(y, m, d), days: 7, listLimit: 20 }, extra || {}));
}

function runTimes(res, zn) {
  const out = [];
  res.cells.forEach((row) => row.forEach((c) => c.runs.forEach((r) => out.push(r))));
  out.sort((a, b) => a.ms - b.ms);
  return out.map((r) => localStr(zn, r.ms / 1000) + ' ' + r.status);
}

// ─────────────────────────────────────────────────────────────────────────────
// parse_time_expression and find_next_time_expression_time (homeassistant/util/dt.py)
// ─────────────────────────────────────────────────────────────────────────────

test('parse_time_expression matches the cases in Home Assistant tests/util/test_dt.py', () => {
  const range = (a, b, s) => { const o = []; for (let i = a; i <= b; i += (s || 1)) o.push(i); return o; };
  assert.deepEqual(hav.parseTimeExpression('*', 0, 59), range(0, 59));
  assert.deepEqual(hav.parseTimeExpression(null, 0, 59), range(0, 59));
  assert.deepEqual(hav.parseTimeExpression('/5', 0, 59), range(0, 55, 5));
  assert.deepEqual(hav.parseTimeExpression('/4', 5, 20), [8, 12, 16, 20]);
  assert.deepEqual(hav.parseTimeExpression('/10', 10, 30), [10, 20, 30]);
  assert.deepEqual(hav.parseTimeExpression('/3', 4, 29), [6, 9, 12, 15, 18, 21, 24, 27]);
  assert.deepEqual(hav.parseTimeExpression([2, 1, 3], 0, 59), [1, 2, 3]);
  assert.deepEqual(hav.parseTimeExpression('*', 0, 23), range(0, 23));
  assert.deepEqual(hav.parseTimeExpression(42, 0, 59), [42]);
  assert.deepEqual(hav.parseTimeExpression('42', 0, 59), [42]);
  assert.throws(() => hav.parseTimeExpression(61, 0, 60), /out of range/);
});

test('/n matches values divisible by n from the top of the unit, not every n from now', () => {
  assert.deepEqual(hav.parseTimeExpression('/7', 0, 59), [0, 7, 14, 21, 28, 35, 42, 49, 56]);
  assert.deepEqual(hav.parseTimeExpression('/5', 0, 23), [0, 5, 10, 15, 20]);
  assert.deepEqual(hav.parseTimeExpression('/45', 0, 59), [0, 45]);
  // minutes "/7": :56 is followed by :00 of the next hour, four minutes later
  const L = lists('*', '/7', 0);
  const t = fires('UTC', L, utc(2026, 1, 5, 10, 50, 0), utc(2026, 1, 5, 11, 15, 0)).map((x) => localStr('UTC', x));
  assert.deepEqual(t, ['2026-01-05 10:56:00', '2026-01-05 11:00:00', '2026-01-05 11:07:00', '2026-01-05 11:14:00']);
  // hours "/5": 20:00 is followed by 00:00, four hours later
  const H = fires('UTC', lists('/5', 0, 0), utc(2026, 1, 5, 19, 0, 0), utc(2026, 1, 6, 6, 0, 0)).map((x) => localStr('UTC', x));
  assert.deepEqual(H, ['2026-01-05 20:00:00', '2026-01-06 00:00:00', '2026-01-06 05:00:00']);
  // minutes "/5" from 10:02:30 fires at 10:05:00, not at 10:07:30
  assert.equal(find('UTC', { w: W(2026, 1, 5, 10, 2, 30), f: 0 }, '*', '/5', 0), utc(2026, 1, 5, 10, 5, 0));
});

test('find_next_time_expression_time: basic cases from test_dt.py', () => {
  assert.equal(find('UTC', { w: W(2018, 10, 7, 10, 20, 0), f: 0 }, '*', '/30', 0), W(2018, 10, 7, 10, 30, 0));
  assert.equal(find('UTC', { w: W(2018, 10, 7, 10, 30, 0), f: 0 }, '*', '/30', 0), W(2018, 10, 7, 10, 30, 0));
  assert.equal(find('UTC', { w: W(2018, 10, 7, 10, 30, 0), f: 0 }, '/3', '/30', [30, 45]), W(2018, 10, 7, 12, 0, 30));
  assert.equal(find('UTC', { w: W(2018, 10, 7, 10, 30, 0), f: 0 }, 5, 0, 0), W(2018, 10, 8, 5, 0, 0));
  assert.equal(find('UTC', { w: W(2018, 10, 7, 10, 30, 0) + 0.999999, f: 0 }, '*', '/30', 0), W(2018, 10, 7, 10, 30, 0));
  // test_find_next_time_expression_microseconds
  const L = lists(null, '5', '10');
  const first = hav.findNextTimeExpression(zone('UTC'), { w: W(2022, 5, 13, 0, 5, 9), f: 0 }, L.s, L.m, L.h);
  assert.equal(first.w, W(2022, 5, 13, 0, 5, 10));
  const after = hav.findNextTimeExpression(zone('UTC'), { w: first.w + 1.999999, f: 0 }, L.s, L.m, L.h);
  assert.equal(after.w, W(2022, 5, 13, 1, 5, 10));
});

test('find_next_time_expression_time: Europe/Vienna DST cases from test_dt.py', () => {
  const V = 'Europe/Vienna';
  // Entering DST (2018-03-25 02:00 -> 03:00): 02:30 does not exist, next is 26 March
  assert.equal(find(V, { w: W(2018, 3, 25, 1, 50, 0), f: 0 }, 2, 30, 0), inst(V, W(2018, 3, 26, 2, 30, 0)));
  assert.equal(find(V, { w: W(2018, 3, 25, 3, 50, 0), f: 0 }, 2, 30, 0), inst(V, W(2018, 3, 26, 2, 30, 0)));
  assert.equal(find(V, { w: W(2018, 3, 26, 1, 50, 0), f: 0 }, 2, 30, 0), inst(V, W(2018, 3, 26, 2, 30, 0)));
  // Leaving DST (2018-10-28 03:00 -> 02:00)
  assert.equal(find(V, { w: W(2018, 10, 28, 2, 5, 0), f: 0 }, 2, 30, 0), inst(V, W(2018, 10, 28, 2, 30, 0), 0));
  assert.equal(find(V, { w: W(2018, 10, 28, 2, 55, 0), f: 0 }, 2, 30, 0), inst(V, W(2018, 10, 28, 2, 30, 0), 1));
  assert.equal(find(V, { w: W(2018, 10, 28, 2, 55, 0), f: 1 }, 4, 30, 0), inst(V, W(2018, 10, 28, 4, 30, 0), 0));
  assert.equal(find(V, { w: W(2018, 10, 28, 2, 5, 0), f: 1 }, 2, 30, 0), inst(V, W(2018, 10, 28, 2, 30, 0), 1));
  // test_find_next_time_expression_entering_dst
  assert.equal(find(V, { w: W(2021, 3, 28, 0, 0, 0), f: 0 }, 2, 30, 0), inst(V, W(2021, 3, 29, 2, 30, 0)));
  // test_find_next_time_expression_exiting_dst (2021-10-31)
  const cases = [
    [[2, 0, 0, 0], [31, 2, 30, 0]], [[0, 0, 0, 0], [31, 2, 30, 0]], [[2, 15, 0, 0], [31, 2, 30, 0]], [[2, 30, 0, 0], [31, 2, 30, 0]],
    [[2, 30, 1, 0], [31, 2, 30, 1]], [[2, 45, 0, 0], [31, 2, 30, 1]], [[2, 0, 0, 1], [31, 2, 30, 1]], [[2, 15, 0, 1], [31, 2, 30, 1]],
    [[2, 30, 0, 1], [31, 2, 30, 1]], [[2, 30, 1, 1], [32, 2, 30, 0]], [[2, 45, 0, 1], [32, 2, 30, 0]], [[8, 0, 1, 0], [32, 2, 30, 0]]
  ];
  cases.forEach(([n, e]) => {
    const expect = e[0] === 32 ? inst(V, W(2021, 11, 1, 2, 30, 0)) : inst(V, W(2021, 10, 31, e[1], e[2], 0), e[3]);
    assert.equal(find(V, { w: W(2021, 10, 31, n[0], n[1], n[2]), f: n[3] }, 2, 30, 0), expect, 'from ' + n.join(':'));
  });
});

test('find_next_time_expression_time: America/Chicago DST cases from test_dt.py', () => {
  const C = 'America/Chicago';
  assert.equal(find(C, { w: W(2021, 3, 14, 1, 50, 0), f: 0 }, 2, 30, 0), inst(C, W(2021, 3, 15, 2, 30, 0)));
  assert.equal(find(C, { w: W(2021, 3, 14, 3, 50, 0), f: 0 }, 2, 30, 0), inst(C, W(2021, 3, 15, 2, 30, 0)));
  assert.equal(find(C, { w: W(2021, 3, 14, 1, 50, 0), f: 0 }, 3, 30, 0), inst(C, W(2021, 3, 14, 3, 30, 0)));
  assert.equal(find(C, { w: W(2021, 11, 7, 2, 5, 0), f: 0 }, 2, 30, 0), inst(C, W(2021, 11, 7, 2, 30, 0)));
  assert.equal(find(C, { w: W(2021, 11, 7, 2, 55, 0), f: 0 }, 2, 30, 0), inst(C, W(2021, 11, 8, 2, 30, 0)));
  assert.equal(find(C, { w: W(2021, 11, 7, 2, 55, 0), f: 1 }, 4, 30, 0), inst(C, W(2021, 11, 7, 4, 30, 0)));
  assert.equal(find(C, { w: W(2021, 10, 7, 12, 30, 1), f: 0 }, 12, 30, 1), utc(2021, 10, 7, 17, 30, 1));
  assert.equal(find(C, { w: W(2021, 11, 7, 1, 30, 1), f: 0 }, 1, 30, 31), utc(2021, 11, 7, 6, 30, 31));
  assert.equal(find(C, { w: W(2021, 11, 7, 0, 30, 1), f: 0 }, 0, 30, 1), utc(2021, 11, 7, 5, 30, 1));
  assert.equal(find(C, { w: W(2021, 11, 7, 1, 30, 1), f: 0 }, 1, 30, 1), utc(2021, 11, 7, 6, 30, 1));
  assert.equal(find(C, { w: W(2021, 11, 7, 1, 30, 1), f: 0 }, 1, 20, 1), utc(2021, 11, 7, 7, 20, 1));
  assert.equal(find(C, { w: W(2021, 11, 7, 1, 30, 1), f: 1 }, 1, 40, 1), utc(2021, 11, 7, 7, 40, 1));
  assert.equal(find(C, { w: W(2021, 11, 7, 1, 30, 1), f: 0 }, 2, 20, 1), utc(2021, 11, 7, 8, 20, 1));
  // test_find_next_time_expression_tenth_second_no_drift_entering_dst
  const L = lists(null, null, '10');
  let prev = hav.nextPatternInstant(zone(C), L, inst(C, W(2021, 3, 15, 2, 30, 0)));
  for (let i = 0; i < 1000; i++) {
    const next = hav.nextPatternInstant(zone(C), L, prev + 1);
    assert.equal(next - prev, 60);
    prev = next;
  }
});

// Literal port of the gap loop (now += 1 second until the match exists), to
// check that jumping straight past a missing match gives the same answers.
function findLiteral(z, now, seconds, minutes, hours) {
  let nowW = Math.floor(now.w);
  let nowF = now.f;
  const sec = (w) => ((w % 60) + 60) % 60;
  const min = (w) => ((Math.floor(w / 60) % 60) + 60) % 60;
  const hr = (w) => ((Math.floor(w / 3600) % 24) + 24) % 24;
  for (;;) {
    let r = nowW;
    let ns = hav.lowerBound(seconds, sec(r));
    if (ns === null) { ns = seconds[0]; r += 60; }
    if (sec(r) !== ns) r += ns - sec(r);
    let nm = hav.lowerBound(minutes, min(r));
    if (nm !== min(r)) r += seconds[0] - sec(r);
    if (nm === null) { nm = minutes[0]; r += 3600; }
    if (min(r) !== nm) r += (nm - min(r)) * 60;
    let nh = hav.lowerBound(hours, hr(r));
    if (nh !== hr(r)) r += (seconds[0] - sec(r)) + (minutes[0] - min(r)) * 60;
    if (nh === null) { nh = hours[0]; r += 86400; }
    if (hr(r) !== nh) r += (nh - hr(r)) * 3600;
    if (!hav.dtExists(z, r, 0)) { nowW += 1; nowF = 0; continue; }
    if (!hav.dtAmbiguous(z, nowW, nowF)) return { w: r, f: 0 };
    if (hav.dtAmbiguous(z, r, 0)) return { w: r, f: nowF };
    if (nowF === 0) {
      const check = findLiteral(z, { w: nowW + hav.dstOffsetDiff(z, nowW), f: 0 }, seconds, minutes, hours);
      if (hav.dtAmbiguous(z, check.w, check.f)) return { w: check.w, f: 1 };
    }
    return { w: r, f: 0 };
  }
}

test('skipping straight past a missing local time gives the same result as stepping second by second', () => {
  const pats = [[2, 30, 0], [3, 30, 0], ['*', '/30', 0], ['*', '/7', 0], ['/2', 0, 0], ['*', '*', '/20']];
  [['Europe/Kyiv', W(2025, 3, 30, 1, 0, 0)], ['America/New_York', W(2025, 3, 9, 0, 30, 0)]].forEach(([zn, w0]) => {
    const z = zone(zn);
    pats.forEach((p) => {
      const L = lists(p[0], p[1], p[2]);
      for (let k = 0; k < 4 * 3600; k += 97) {
        const now = { w: w0 + k, f: 0 };
        const a = hav.findNextTimeExpression(z, now, L.s, L.m, L.h);
        const b = findLiteral(z, now, L.s, L.m, L.h);
        assert.deepEqual(a, b, zn + ' ' + p.join(' ') + ' from +' + k);
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// time_pattern trigger: validation and the smaller-unit defaults
// ─────────────────────────────────────────────────────────────────────────────

const pattern = (body) => load('triggers:\n  - trigger: time_pattern\n' + body);

test('time_pattern fills smaller units with 0 when a larger unit is set (time_pattern.py)', () => {
  let t = pattern('    hours: "/2"\n').model.triggers[0];
  assert.deepEqual(t.lists.m, [0]);
  assert.deepEqual(t.lists.s, [0]);
  assert.deepEqual(t.defaulted, { minutes: true, seconds: true });
  t = pattern('    minutes: 15\n').model.triggers[0];
  assert.equal(t.lists.h.length, 24);
  assert.deepEqual(t.lists.m, [15]);
  assert.deepEqual(t.lists.s, [0]);
  t = pattern('    seconds: "/30"\n').model.triggers[0];
  assert.equal(t.lists.h.length, 24);
  assert.equal(t.lists.m.length, 60);
  assert.deepEqual(t.lists.s, [0, 30]);
  // hours "*" alone means hourly at minute 0, second 0
  t = pattern('    hours: "*"\n').model.triggers[0];
  assert.deepEqual([t.lists.h.length, t.lists.m, t.lists.s, t.everySecond], [24, [0], [0], false]);
  // nothing narrowed down: every second
  t = pattern('    seconds: "*"\n').model.triggers[0];
  assert.equal(t.everySecond, true);
  t = pattern('    hours: 1\n    minutes: 2\n    seconds: 3\n').model.triggers[0];
  assert.deepEqual([t.lists.h, t.lists.m, t.lists.s], [[1], [2], [3]]);
  // hours "/2", seconds 30 and no minutes: minute 0 is filled in, seconds stay 30
  t = pattern('    hours: "/2"\n    seconds: 30\n').model.triggers[0];
  assert.deepEqual([t.lists.m, t.lists.s], [[0], [30]]);
  const runs = fires('UTC', t.lists, utc(2026, 2, 2, 0, 0, 0), utc(2026, 2, 2, 5, 0, 0)).map((x) => localStr('UTC', x));
  assert.deepEqual(runs, ['2026-02-02 00:00:30', '2026-02-02 02:00:30', '2026-02-02 04:00:30']);
});

test('time_pattern rejects what Home Assistant rejects (test_invalid_schemas and range checks)', () => {
  const errOf = (body) => msgs(pattern(body).model.errors).join(' | ');
  assert.match(errOf('    minutes: "/"\n'), /invalid time_pattern value/);
  assert.match(errOf('    minutes: "*/5"\n'), /invalid time_pattern value.*"\/5", not the cron-style/);
  assert.match(errOf('    minutes: "/90"\n'), /between 0 and 59/);
  assert.match(errOf('    hours: "/0"\n    minutes: 10\n'), /between 1 and 23/);
  assert.match(errOf('    hours: 12\n    minutes: 0\n    seconds: 100\n'), /between 0 and 59/);
  assert.match(errOf('    hours: 24\n'), /between 0 and 23/);
  assert.match(errOf('    hours: "/24"\n'), /between 0 and 23/);
  assert.match(errOf('    minutes: [0, 30]\n'), /list is not accepted/);
  assert.match(errOf('    alias: x\n'), /at least one of hours, minutes, seconds/);
  assert.match(errOf('    minutes: 5\n    at: "07:00"\n'), /extra keys not allowed @ data\['at'\]/);
  assert.equal(pattern('    minutes: "05"\n').model.triggers[0].lists.m[0], 5);
  // unquoted */5 is a YAML alias, refused before Home Assistant sees it
  const p = hav.parseYaml('triggers:\n  - trigger: time_pattern\n    minutes: */5\n');
  assert.match(p.error.message, /must be quoted.*not the cron-style/);
  assert.equal(p.error.line, 3);
});

test('YAML 1.1 reads an unquoted 010 as octal 8 and the tool warns about it', () => {
  const { model } = pattern('    minutes: 010\n');
  assert.deepEqual(model.triggers[0].lists.m, [8]);
  assert.match(msgs(model.warnings).join(' '), /octal number 8.*minutes: "10"/);
  // 08 and 09 are not valid octal, so YAML keeps them as text and int() reads 8 and 9
  assert.deepEqual(pattern('    minutes: 08\n').model.triggers[0].lists.m, [8]);
  assert.equal(pattern('    minutes: 08\n').model.warnings.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// time trigger
// ─────────────────────────────────────────────────────────────────────────────

test('time trigger with one or several at times; HH:MM gets second 0', () => {
  let t = load('triggers:\n  - trigger: time\n    at: "07:00"\n').model.triggers[0];
  assert.deepEqual(t.times.map((x) => x.sec), [7 * 3600]);
  assert.equal(t.times[0].noSeconds, true);
  t = load('triggers:\n  - trigger: time\n    at:\n      - "07:00:00"\n      - "19:30:15"\n').model.triggers[0];
  assert.deepEqual(t.times.map((x) => x.sec), [25200, 70215]);
  t = load('triggers:\n  - trigger: time\n    at: ["06:00", "21:45"]\n').model.triggers[0];
  assert.deepEqual(t.times.map((x) => x.sec), [21600, 78300]);
  // extra parts after the seconds are ignored by dt_util.parse_time
  t = load('triggers:\n  - trigger: time\n    at: "07:00:00:99"\n').model.triggers[0];
  assert.deepEqual(t.times.map((x) => x.sec), [25200]);
  const res = sim(load('triggers:\n  - trigger: time\n    at: ["07:00", "19:30:15"]\n').model, 'UTC', 2026, 6, 1);
  assert.equal(res.totals.fired, 14);
  assert.deepEqual(runTimes(res, 'UTC').slice(0, 3), ['2026-06-01 07:00:00 fired', '2026-06-01 19:30:15 fired', '2026-06-02 07:00:00 fired']);
});

test('time trigger weekday option (HA 2025.8+) filters by the local date when the time is reached', () => {
  const { model } = load('triggers:\n  - trigger: time\n    at: "07:00:00"\n    weekday:\n      - mon\n      - fri\n');
  assert.deepEqual(model.triggers[0].weekday, [0, 4]);
  const res = sim(model, 'Europe/Kyiv', 2026, 6, 1, { listLimit: 4 });
  assert.deepEqual(runTimes(res, 'Europe/Kyiv'), ['2026-06-01 07:00:00 fired', '2026-06-05 07:00:00 fired']);
  assert.deepEqual(res.list.map((r) => localStr('Europe/Kyiv', r.ms / 1000)), ['2026-06-01 07:00:00', '2026-06-05 07:00:00', '2026-06-08 07:00:00', '2026-06-12 07:00:00']);
  // a single string is accepted too
  assert.deepEqual(load('triggers:\n  - trigger: time\n    at: "07:00"\n    weekday: sun\n').model.triggers[0].weekday, [6]);
  // an empty list never fires
  const empty = load('triggers:\n  - trigger: time\n    at: "07:00"\n    weekday: []\n').model;
  assert.equal(sim(empty, 'UTC', 2026, 6, 1).totals.fired, 0);
  assert.match(msgs(empty.info).join(' '), /never fires/);
  assert.match(msgs(load('triggers:\n  - trigger: time\n    at: "07:00"\n    weekday: [Mon]\n').model.errors).join(' '), /lower-case/);
});

test('time trigger: invalid and non-simulated at values', () => {
  const errs = (at) => msgs(load('triggers:\n  - trigger: time\n    at: ' + at + '\n').model.errors).join(' | ');
  assert.match(errs('"24:00"'), /is not valid for 'at'.*Hours run from 00 to 23/);
  assert.match(errs('"07:00:30.5"'), /Seconds must be a whole number/);
  // YAML 1.1: 19:45:00 without quotes is the base-60 integer 71100
  assert.match(errs('19:45:00'), /base-60 number 71100.*at: "19:45:00"/);
  assert.match(errs('7:30'), /base-60 number 450/);
  // 07:30 starts with 0, so it is not base-60 and stays text
  assert.equal(load('triggers:\n  - trigger: time\n    at: 07:30\n').model.errors.length, 0);
  assert.match(errs('light.kitchen'), /Only input_datetime and sensor entities/);
  const ns = (at) => load('triggers:\n  - trigger: time\n    at: ' + at + '\n').model;
  assert.match(plain(ns('input_datetime.wake_up').notSim[0].why), /helper's or sensor's state/);
  assert.match(plain(ns('"{{ states(\'input_text.t\') }}"').notSim[0].why), /limited template/);
  assert.match(plain(ns('\n      entity_id: sensor.phone_next_alarm\n      offset: "-00:10:00"').notSim[0].what), /sensor\.phone_next_alarm/);
  assert.match(msgs(load('triggers:\n  - trigger: time\n    at: "07:00"\n    offset: 5\n').model.errors).join(' '), /extra keys not allowed @ data\['offset'\]/);
  // options form is moved to the top level for old-style platforms
  const o = load('triggers:\n  - trigger: time\n    options:\n      at: "08:15"\n').model;
  assert.deepEqual(o.triggers[0].times.map((x) => x.sec), [29700]);
});

// ─────────────────────────────────────────────────────────────────────────────
// time condition (helpers/condition.py time())
// ─────────────────────────────────────────────────────────────────────────────

const tc = (after, before, weekday) => ({ type: 'time', after: after, before: before, weekday: weekday || null });
const T = (h, m, s) => h * 3600 + (m || 0) * 60 + (s || 0);

test('time condition: plain window, after inclusive and before exclusive', () => {
  const c = tc(T(8), T(20));
  assert.equal(hav.timeConditionCheck(c, T(8), 0).v, true);
  assert.equal(hav.timeConditionCheck(c, T(7, 59, 59), 0).v, false);
  assert.equal(hav.timeConditionCheck(c, T(19, 59, 59), 0).v, true);
  assert.equal(hav.timeConditionCheck(c, T(20), 0).v, false);
  // only after: until midnight; only before: from midnight
  assert.equal(hav.timeConditionCheck(tc(T(22), null), T(23, 59, 59) + 0.5, 0).v, true);
  assert.equal(hav.timeConditionCheck(tc(T(22), null), T(0), 0).v, false);
  assert.equal(hav.timeConditionCheck(tc(null, T(6)), T(0), 0).v, true);
  assert.equal(hav.timeConditionCheck(tc(null, T(6)), T(6), 0).v, false);
});

test('time condition crossing midnight, equal bounds, and before 00:00:00 alone', () => {
  const night = tc(T(22), T(6));
  [[T(22), true], [T(23, 30), true], [T(0), true], [T(5, 59, 59), true], [T(6), false], [T(12), false], [T(21, 59, 59), false]].forEach(([s, v]) => {
    assert.equal(hav.timeConditionCheck(night, s, 3).v, v, 'at ' + s);
  });
  // after == before: HA only blocks when before <= now < after, which is empty
  assert.equal(hav.timeConditionCheck(tc(T(10), T(10)), T(3), 0).v, true);
  assert.equal(hav.timeConditionCheck(tc(T(10), T(10)), T(10), 0).v, true);
  // before "00:00:00" with no after: after defaults to 00:00:00, the same case
  assert.equal(hav.timeConditionCheck(tc(null, 0), T(15), 0).v, true);
});

test('time condition weekday checks the current day, so hours after midnight belong to the next day', () => {
  const c = tc(T(22), T(6), [4, 5]); // fri, sat
  assert.equal(hav.timeConditionCheck(c, T(23), 4).v, true);   // Friday 23:00
  assert.equal(hav.timeConditionCheck(c, T(1), 5).v, true);    // Saturday 01:00
  assert.equal(hav.timeConditionCheck(c, T(1), 6).v, false);   // Sunday 01:00, the tail of Saturday night
  assert.match(hav.timeConditionCheck(c, T(1), 6).why, /not on Sunday/);
  assert.equal(hav.timeConditionCheck(c, T(1), 4).v, true);    // Friday 01:00, the tail of Thursday night
  // weekday only
  assert.equal(hav.timeConditionCheck(tc(null, null, [5, 6]), T(12), 6).v, true);
  assert.equal(hav.timeConditionCheck(tc(null, null, [5, 6]), T(12), 0).v, false);
});

test('time condition in a full simulation: every 5 minutes at night on Friday and Saturday', () => {
  const ex = hav.EXAMPLES.night.yaml.join('\n');
  const { model } = load(ex);
  // 2026-06-01 is a Monday
  const res = sim(model, 'Europe/Kyiv', 2026, 6, 1);
  const fired = res.cells.map((row) => row.reduce((n, c) => n + c.f, 0));
  // Fri 00:00-05:55 (72) + Fri 22:00-23:55 (24), Sat the same: 96 each; nothing else
  assert.deepEqual(fired, [0, 0, 0, 0, 96, 96, 0]);
  assert.equal(res.totals.fired + res.totals.blocked, 7 * 288);
});

test('time condition values are validated like cv.time', () => {
  const errs = (body) => msgs(load('triggers:\n  - trigger: time\n    at: "07:00"\nconditions:\n  - condition: time\n' + body).model.errors).join(' | ');
  assert.match(errs('    after: 21:00:00\n'), /base-60 number 75600.*Invalid time specified/);
  assert.match(errs('    before: "24:00"\n'), /hours run from 00 to 23/);
  assert.match(errs('    alias: x\n'), /at least one of before, after, weekday/);
  const m = load('triggers:\n  - trigger: time\n    at: "07:00"\nconditions:\n  - condition: time\n    after: input_datetime.wake\n').model;
  assert.match(plain(m.notSim[0].why), /input_datetime\.wake/);
  assert.equal(sim(m, 'UTC', 2026, 6, 1).totals.unknown, 7);
});

// ─────────────────────────────────────────────────────────────────────────────
// Sun: astral 2.2 port, the trigger scheduler and the sun condition
// ─────────────────────────────────────────────────────────────────────────────

const SD = { lat: 32.87336, lon: -117.22743, elev: 0 };   // Home Assistant's test location
const KO = { lat: 66.8983, lon: -162.5966, elev: 0 };     // Kotzebue, Alaska
const SV = { lat: 78.22, lon: 15.65, elev: 0 };           // Longyearbyen, Svalbard
const iso = (s) => Date.parse(s.slice(0, 23) + 'Z') + Number('0.' + s.slice(23, 26));

test('astral 2.2 port matches the microsecond reference times in Home Assistant\'s sun tests', () => {
  const refs = [
    [SD, 'sunrise', 0, 2015, 9, 16, '2015-09-16T13:33:18.342542'],
    [SD, 'sunset', 0, 2015, 9, 16, '2015-09-17T01:53:44.723614'],
    [SD, 'sunset', 0, 2015, 9, 15, '2015-09-16T01:55:06.099767'],
    [SD, 'sunrise', 0, 2015, 9, 17, '2015-09-17T13:33:57.053037'],
    [SD, 'dawn', 6, 2015, 9, 15, '2015-09-15T13:07:26.084892'],
    [SD, 'dawn', 12, 2015, 9, 15, '2015-09-15T12:38:34.055317'],
    [SD, 'dawn', 18, 2015, 9, 15, '2015-09-15T12:09:09.742065'],
    [SD, 'dusk', 6, 2015, 9, 14, '2015-09-15T02:21:39.056429'],
    [SD, 'dusk', 12, 2015, 9, 14, '2015-09-15T02:50:29.596023'],
    [SD, 'dusk', 18, 2015, 9, 14, '2015-09-15T03:19:52.663966'],
    [KO, 'sunrise', 0, 2015, 7, 24, '2015-07-24T12:48:24.249497'],
    [KO, 'sunrise', 0, 2015, 7, 23, '2015-07-23T12:43:32.413351'],
    [KO, 'sunset', 0, 2015, 8, 7, '2015-08-08T07:59:25.982224'],
    [KO, 'sunset', 0, 2015, 8, 8, '2015-08-09T07:55:10.646523']
  ];
  refs.forEach(([o, kind, dep, y, m, d, expect]) => {
    const ms = hav.astralEvent(o, kind, dep, y, m, d);
    assert.ok(Math.abs(ms - iso(expect)) < 0.002, kind + ' ' + y + '-' + m + '-' + d + ': ' + (ms - iso(expect)) + ' ms');
  });
});

test('astral port: elevation adds the horizon dip; London values stay within astral\'s one-minute test tolerance', () => {
  const sea = hav.astralEvent(SD, 'sunrise', 0, 2015, 9, 16);
  const high = hav.astralEvent({ lat: SD.lat, lon: SD.lon, elev: 1000 }, 'sunrise', 0, 2015, 9, 16);
  assert.ok(sea - high > 60000 && sea - high < 300000, 'sunrise is earlier from 1000 m');
  // astral's own test_sun_utc.py (timeanddate.com values, 60 s tolerance)
  const LON = { lat: 51.50853, lon: -0.12574, elev: 0 };
  [[2015, 12, 1, 7, 43], [2015, 12, 25, 8, 5]].forEach(([y, m, d, H, M]) => {
    assert.ok(Math.abs(hav.astralEvent(LON, 'sunrise', 0, y, m, d) - Date.UTC(y, m - 1, d, H, M)) <= 60000);
  });
  [[2015, 12, 1, 15, 55], [2015, 12, 25, 15, 55]].forEach(([y, m, d, H, M]) => {
    assert.ok(Math.abs(hav.astralEvent(LON, 'sunset', 0, y, m, d) - Date.UTC(y, m - 1, d, H, M)) <= 60000);
  });
});

test('sun trigger scheduler with positive and negative offsets (get_observer_astral_event_next)', () => {
  const ctx = hav.makeCtx('America/Los_Angeles', SD);
  const now = Date.UTC(2015, 8, 15, 23, 0, 0);
  // test_sunset_trigger_with_offset: offset "0:30:00" after 2015-09-15 23:00 UTC
  const next = hav.sunEventNext(ctx, 'sunset', 0, 30 * 60000, now, null);
  assert.ok(Math.abs(next - (iso('2015-09-16T01:55:06.099767') + 30 * 60000)) < 0.002);
  // offset "-0:30:00" before sunrise
  const rise = hav.sunEventNext(ctx, 'sunrise', 0, -30 * 60000, Date.UTC(2015, 8, 16, 0, 0, 0), null);
  assert.ok(Math.abs(rise - (iso('2015-09-16T13:33:18.342542') - 30 * 60000)) < 0.002);
  // a large negative offset still finds the first event + offset after now
  const big = hav.sunEventNext(ctx, 'sunset', 0, -12 * 3600000, Date.UTC(2015, 8, 16, 13, 0, 0), null);
  assert.ok(Math.abs(big - (iso('2015-09-17T01:53:44.723614') - 12 * 3600000)) < 0.002);
  // from 14:00 UTC that one has passed, so the next is the following day's sunset - 12 h
  const big2 = hav.sunEventNext(ctx, 'sunset', 0, -12 * 3600000, Date.UTC(2015, 8, 16, 14, 0, 0), null);
  assert.ok(Math.abs(big2 - (hav.astralEvent(SD, 'sunset', 0, 2015, 9, 17) - 12 * 3600000)) < 0.002);
  // new-style triggers: offset_type before (the default) negates the offset
  const { model } = load('triggers:\n  - trigger: sun.sunset\n    options:\n      offset: "00:30:00"\n  - trigger: sun.sunrise\n    options:\n      offset:\n        minutes: 15\n      offset_type: after\n  - trigger: sun.dawn\n    options:\n      type: nautical\n');
  assert.deepEqual(model.triggers.map((t) => [t.event, t.offsetMs, t.depression]), [['sunset', -1800000, 0], ['sunrise', 900000, 0], ['dawn', 0, 12]]);
  assert.match(msgs(model.info).join(' '), /defaults to before/);
  // legacy: a negative offset string means before
  const leg = load('triggers:\n  - platform: sun\n    event: Sunset\n    offset: "-00:45:00"\n').model.triggers[0];
  assert.deepEqual([leg.event, leg.offsetMs, leg.style], ['sunset', -2700000, 'legacy']);
  // a negative offset with offset_type before fires after the event
  const dbl = load('triggers:\n  - trigger: sun.sunset\n    options:\n      offset: "-00:10:00"\n      offset_type: before\n').model;
  assert.equal(dbl.triggers[0].offsetMs, 600000);
  assert.match(msgs(dbl.warnings).join(' '), /fires 10 minutes after sunset/);
});

test('cv.time_period offsets: HH:MM, seconds, mappings, and an unquoted H:MM read as base-60 seconds', () => {
  assert.equal(hav.timePeriod('-00:30:00', 'qstr').ms, -1800000);
  assert.equal(hav.timePeriod('1:30', 'qstr').ms, 5400000);
  assert.equal(hav.timePeriod('90', 'qstr').ms, 90000);
  assert.equal(hav.timePeriod(-1800, 'int').ms, -1800000);
  assert.equal(hav.timePeriod({ hours: 1, minutes: -15 }, 'map').ms, 2700000);
  assert.match(hav.timePeriod({ hour: 1 }, 'map').error, /extra keys/);
  assert.match(hav.timePeriod('soon', 'qstr').error, /HH:MM/);
  const m = load('triggers:\n  - platform: sun\n    event: sunset\n    offset: 1:30\n').model;
  assert.equal(m.triggers[0].offsetMs, 90000);
  assert.match(msgs(m.warnings).join(' '), /base-60 number 90.*1 minute 30 seconds.*1 hour 30 minutes/);
});

test('polar regions: no sunrise in the Svalbard polar night, no sunset in the Kotzebue midnight sun', () => {
  const sv = hav.makeCtx('Europe/Oslo', SV);
  const now = Date.UTC(2015, 11, 15, 12, 0, 0);
  const missing = [];
  const next = hav.sunEventNext(sv, 'sunrise', 0, 0, now, missing);
  assert.ok(next > now + 86400000 * 30, 'next sunrise is weeks away');
  assert.ok(missing.length > 30);
  assert.equal(hav.missingEventKind(SV, 2015, 12, 15, 90 + 32 / 120), 'below');
  assert.ok(Number.isNaN(hav.astralEvent(SV, 'dawn', 6, 2015, 12, 15)));
  const ko = hav.makeCtx('America/Anchorage', KO);
  const n2 = Date.UTC(2015, 5, 15, 12, 0, 0);
  assert.ok(hav.sunEventNext(ko, 'sunset', 0, 0, n2, null) > n2 + 86400000);
  assert.equal(hav.missingEventKind(KO, 2015, 6, 15, 90 + 32 / 120), 'above');
  // the sun condition does not pass on a day without the event
  assert.deepEqual(hav.sunConditionCheck(ko, { after: 'sunset' }, n2), { v: false, why: 'no sunset today' });
  assert.deepEqual(hav.sunConditionCheck(sv, { after: 'sunrise' }, now), { v: false, why: 'no sunrise today' });
});

test('two sunsets on one local date at Kotzebue and two sunrises at HA\'s synthetic location, as in sun/test_trigger.py', () => {
  const ko = hav.makeCtx('America/Anchorage', KO);
  const first = hav.sunEventNext(ko, 'sunset', 0, 0, Date.UTC(2015, 7, 7, 7, 0, 0), null);
  const second = hav.sunEventNext(ko, 'sunset', 0, 0, first, null);
  assert.equal(Math.floor(first / 1000), utc(2015, 8, 7, 8, 3, 42));
  assert.equal(Math.floor(second / 1000), utc(2015, 8, 8, 7, 59, 25));
  assert.equal(localStr('America/Anchorage', first / 1000).slice(0, 10), localStr('America/Anchorage', second / 1000).slice(0, 10));
  const syn = hav.makeCtx('America/Anchorage', { lat: 66.5, lon: -32.5, elev: 0 });
  const r1 = hav.sunEventNext(syn, 'sunrise', 0, 0, Date.UTC(2015, 2, 7, 9, 0, 0), null);
  const r2 = hav.sunEventNext(syn, 'sunrise', 0, 0, r1, null);
  assert.equal(Math.floor(r1 / 1000), utc(2015, 3, 7, 9, 2, 36));
  assert.equal(Math.floor(r2 / 1000), utc(2015, 3, 8, 8, 58, 43));
});

test('sun condition matches the cases in Home Assistant\'s sun/test_condition.py', () => {
  const ctx = hav.makeCtx('America/Los_Angeles', SD);
  const H = 3600000;
  const cases = [
    [{ before: 'sunrise' }, [2015, 9, 16, 13, 33, 19], false], [{ before: 'sunrise' }, [2015, 9, 16, 13, 33, 18], true],
    [{ before: 'sunrise' }, [2015, 9, 16, 7, 0, 0], true], [{ before: 'sunrise' }, [2015, 9, 17, 6, 59, 59], false],
    [{ after: 'sunrise' }, [2015, 9, 16, 13, 33, 17], false], [{ after: 'sunrise' }, [2015, 9, 16, 13, 33, 19], true],
    [{ after: 'sunrise' }, [2015, 9, 16, 7, 0, 0], false], [{ after: 'sunrise' }, [2015, 9, 17, 6, 59, 59], true],
    [{ before: 'sunrise', beforeOffset: H }, [2015, 9, 16, 14, 33, 19], false], [{ before: 'sunrise', beforeOffset: H }, [2015, 9, 16, 14, 33, 18], true],
    [{ before: 'sunrise', beforeOffset: H }, [2015, 9, 17, 1, 53, 45], false],
    [{ before: 'sunset', beforeOffset: H }, [2015, 9, 17, 2, 53, 46], false], [{ before: 'sunset', beforeOffset: H }, [2015, 9, 17, 2, 53, 44], true],
    [{ after: 'sunrise', afterOffset: H }, [2015, 9, 16, 14, 33, 17], false], [{ after: 'sunrise', afterOffset: H }, [2015, 9, 16, 19, 1, 0], true],
    [{ after: 'sunrise', afterOffset: H }, [2015, 9, 17, 7, 0, 0], false],
    [{ after: 'sunset', afterOffset: H }, [2015, 9, 17, 2, 53, 44], false], [{ after: 'sunset', afterOffset: H }, [2015, 9, 17, 2, 53, 45], true],
    [{ after: 'sunset', afterOffset: H }, [2015, 9, 16, 6, 59, 59], true], [{ after: 'sunset', afterOffset: H }, [2015, 9, 16, 7, 0, 0], false],
    [{ after: 'sunrise', before: 'sunset' }, [2015, 9, 16, 13, 33, 17], false], [{ after: 'sunrise', before: 'sunset' }, [2015, 9, 17, 1, 53, 46], false],
    [{ after: 'sunrise', before: 'sunset' }, [2015, 9, 16, 13, 33, 19], true], [{ after: 'sunrise', before: 'sunset' }, [2015, 9, 16, 16, 0, 0], true],
    [{ before: 'sunrise', after: 'sunset' }, [2015, 9, 16, 13, 33, 17], true], [{ before: 'sunrise', after: 'sunset' }, [2015, 9, 17, 1, 53, 46], true],
    [{ before: 'sunrise', after: 'sunset' }, [2015, 9, 16, 16, 0, 0], false]
  ];
  cases.forEach(([nd, t, expect]) => {
    const node = Object.assign({ before: null, after: null, beforeOffset: 0, afterOffset: 0 }, nd);
    assert.equal(hav.sunConditionCheck(ctx, node, Date.UTC(t[0], t[1] - 1, t[2], t[3], t[4], t[5])).v, expect, JSON.stringify(nd) + ' at ' + t.join('-'));
  });
  const ko = hav.makeCtx('America/Anchorage', KO);
  assert.equal(hav.sunConditionCheck(ko, { before: 'sunrise' }, Date.UTC(2015, 6, 24, 12, 48, 25)).v, false);
  assert.equal(hav.sunConditionCheck(ko, { before: 'sunrise' }, Date.UTC(2015, 6, 24, 11, 48, 24)).v, true);
  assert.equal(hav.sunConditionCheck(ko, { before: 'sunset' }, Date.UTC(2015, 7, 8, 7, 59, 26)).v, false);
  assert.equal(hav.sunConditionCheck(ko, { after: 'sunset' }, Date.UTC(2015, 7, 8, 7, 59, 26)).v, true);
});

test('sun condition YAML: top-level fields and the options form', () => {
  const a = load('triggers:\n  - trigger: time\n    at: "20:00"\nconditions:\n  - condition: sun\n    after: sunset\n    after_offset: "-01:00:00"\n').model.conditions[0];
  const b = load('triggers:\n  - trigger: time\n    at: "20:00"\nconditions:\n  - condition: sun\n    options:\n      after: sunset\n      after_offset: "-01:00:00"\n').model.conditions[0];
  assert.deepEqual([a.type, a.after, a.afterOffset], ['sun', 'sunset', -3600000]);
  assert.deepEqual([b.type, b.after, b.afterOffset], ['sun', 'sunset', -3600000]);
  const e = load('triggers:\n  - trigger: time\n    at: "20:00"\nconditions:\n  - condition: sun\n    after: noon\n').model;
  assert.match(msgs(e.errors).join(' '), /must be sunrise or sunset/);
});

// ─────────────────────────────────────────────────────────────────────────────
// DST days in Europe/Kyiv and America/New_York
// ─────────────────────────────────────────────────────────────────────────────

test('Europe/Kyiv spring forward (2025-03-30 03:00 -> 04:00): 03:30 is skipped, /30 jumps from 02:30 to 04:00', () => {
  const zn = 'Europe/Kyiv';
  const tr = hav.findTransitions(zone(zn), utc(2025, 3, 29), utc(2025, 3, 31));
  assert.deepEqual(tr, [{ at: utc(2025, 3, 30, 1, 0, 0), from: 7200, to: 10800 }]);
  const { model } = load('triggers:\n  - trigger: time\n    at: "03:30:00"\n');
  const res = sim(model, zn, 2025, 3, 28, { days: 4 });
  assert.deepEqual(runTimes(res, zn), ['2025-03-28 03:30:00 fired', '2025-03-29 03:30:00 fired', '2025-03-31 03:30:00 fired']);
  assert.equal(res.days[2].hours[3].gap, 60);
  const p = fires(zn, lists('*', '/30', 0), inst(zn, W(2025, 3, 30, 2, 0, 0)), inst(zn, W(2025, 3, 30, 5, 0, 0))).map((t) => localStr(zn, t));
  assert.deepEqual(p, ['2025-03-30 02:00:00', '2025-03-30 02:30:00', '2025-03-30 04:00:00', '2025-03-30 04:30:00']);
  const notes = hav.buildNotes(model, res, res.ctx).map((n) => plain(n.html)).join(' ');
  assert.match(notes, /clocks go forward/);
  assert.match(notes, /trigger #1 at 03:30:00 is skipped that day/);
});

test('Europe/Kyiv fall back (2025-10-26 04:00 -> 03:00): 03:30 and the hourly pattern run twice', () => {
  const zn = 'Europe/Kyiv';
  const { model } = load('triggers:\n  - trigger: time\n    at: "03:30:00"\n  - trigger: time_pattern\n    hours: "/1"\n');
  const res = sim(model, zn, 2025, 10, 26, { days: 1 });
  const night = runTimes(res, zn).filter((s) => /^2025-10-26 0[2-4]/.test(s));
  assert.deepEqual(night, [
    '2025-10-26 02:00:00 fired', '2025-10-26 03:00:00 fired', '2025-10-26 03:30:00 fired',
    '2025-10-26 03:00:00 (2nd) fired', '2025-10-26 03:30:00 (2nd) fired', '2025-10-26 04:00:00 fired'
  ]);
  assert.ok(res.days[0].hours[3].rep > 0);
  const notes = hav.buildNotes(model, res, res.ctx).map((n) => plain(n.html)).join(' ');
  assert.match(notes, /happen twice/);
  assert.match(notes, /trigger #1 at 03:30:00 runs twice, 1 hour apart/);
});

test('America/New_York 2025: 02:30 skipped on 9 March, 01:30 twice on 2 November, sunset once a day', () => {
  const zn = 'America/New_York';
  const spring = hav.findTransitions(zone(zn), utc(2025, 3, 8), utc(2025, 3, 10));
  assert.deepEqual(spring, [{ at: utc(2025, 3, 9, 7, 0, 0), from: -18000, to: -14400 }]);
  const fall = hav.findTransitions(zone(zn), utc(2025, 11, 1), utc(2025, 11, 3));
  assert.deepEqual(fall, [{ at: utc(2025, 11, 2, 6, 0, 0), from: -14400, to: -18000 }]);
  const s = sim(load('triggers:\n  - trigger: time\n    at: "02:30"\n').model, zn, 2025, 3, 8, { days: 3 });
  assert.deepEqual(runTimes(s, zn), ['2025-03-08 02:30:00 fired', '2025-03-10 02:30:00 fired']);
  const f = sim(load('triggers:\n  - trigger: time\n    at: "01:30"\n').model, zn, 2025, 11, 1, { days: 3 });
  assert.deepEqual(runTimes(f, zn), ['2025-11-01 01:30:00 fired', '2025-11-02 01:30:00 fired', '2025-11-02 01:30:00 (2nd) fired', '2025-11-03 01:30:00 fired']);
  // the fold carries the right offsets: 05:30 and 06:30 UTC
  assert.deepEqual(f.cells[1][1].runs.map((r) => r.ms / 1000), [utc(2025, 11, 2, 5, 30, 0), utc(2025, 11, 2, 6, 30, 0)]);
  const sun = sim(load('triggers:\n  - trigger: sun.sunset\n').model, zn, 2025, 11, 1, { days: 3, obs: { lat: 40.7128, lon: -74.006, elev: 0 } });
  assert.deepEqual(sun.cells.map((row) => row.reduce((n, c) => n + c.f, 0)), [1, 1, 1]);
});

// ─────────────────────────────────────────────────────────────────────────────
// YAML parsing and the platform/trigger syntaxes
// ─────────────────────────────────────────────────────────────────────────────

test('both trigger syntaxes and both key spellings are accepted; mixing them is an error', () => {
  const old = load('trigger:\n  - platform: time\n    at: "07:00"\ncondition:\n  - condition: time\n    after: "06:00"\naction: []\n').model;
  assert.equal(old.errors.length, 0);
  assert.deepEqual(old.oldKeys, ['trigger', 'condition', 'action']);
  assert.equal(old.triggers[0].syntax, 'platform');
  assert.equal(old.conditions[0].type, 'time');
  const cur = load('triggers:\n  - trigger: time\n    at: "07:00"\nconditions:\n  - condition: time\n    after: "06:00"\nactions: []\n').model;
  assert.equal(cur.errors.length, 0);
  assert.deepEqual(cur.oldKeys, []);
  assert.match(msgs(load('trigger: []\ntriggers: []\nactions: []\n').model.errors).join(' '), /Cannot specify both 'trigger' and 'triggers'/);
  assert.match(msgs(load('triggers: []\ncondition: []\nconditions: []\nactions: []\n').model.errors).join(' '), /Cannot specify both 'condition' and 'conditions'/);
  assert.match(msgs(load('triggers:\n  - trigger: time\n    platform: time\n    at: "07:00"\n').model.errors).join(' '), /Cannot specify both 'platform' and 'trigger'/);
  assert.match(msgs(load('triggers:\n  - at: "07:00"\n').model.errors).join(' '), /required key not provided @ data\['trigger'\]/);
  // a single trigger mapping (not a list) is accepted, as ensure_list does
  assert.equal(load('trigger:\n  platform: time_pattern\n  minutes: 5\n').model.triggers[0].type, 'pattern');
});

test('nested triggers lists are flattened one level; unsupported triggers are listed as not simulated', () => {
  const m = load('triggers:\n  - triggers:\n      - trigger: time\n        at: "07:00"\n      - trigger: state\n        entity_id: light.a\n  - trigger: sun.solar_noon\n  - trigger: time\n    at: "08:00"\n    enabled: false\n').model;
  assert.equal(m.triggerCount, 4);
  assert.equal(m.triggers.length, 1);
  assert.deepEqual(m.notSim.map((x) => plain(x.what)), ['Trigger #2 (state)', 'Trigger #3 (sun.solar_noon)']);
  assert.match(msgs(m.info).join(' '), /Trigger #4 \(time\) has enabled: false/);
});

test('documents: a list of automations, a list of triggers, automation: wrappers and includes', () => {
  const list = hav.findAutomations(hav.parseYaml('- alias: One\n  triggers: []\n- id: "2"\n  triggers: []\n').root);
  assert.deepEqual([list.shape, list.items.map((i) => i.label)], ['list', ['One', 'id 2']]);
  const trig = hav.findAutomations(hav.parseYaml('- trigger: time\n  at: "07:00"\n- platform: time_pattern\n  minutes: 5\n').root);
  assert.equal(trig.shape, 'triggers');
  assert.equal(hav.analyzeAutomation(trig.items[0].obj).triggers.length, 2);
  const conf = hav.findAutomations(hav.parseYaml('automation:\n  - alias: A\n    triggers: []\n').root);
  assert.deepEqual([conf.shape, conf.items.length], ['configuration', 1]);
  const inc = hav.findAutomations(hav.parseYaml('automation: !include automations.yaml\n').root);
  assert.match(plain(inc.error), /Paste the content of the included file/);
  const bp = load('triggers:\n  - trigger: time\n    at: !input wake_time\n').model;
  assert.match(plain(bp.notSim[0].what), /!input wake_time/);
});

test('conditions: and/or/not with shorthands, trigger ids, disabled and unknown types', () => {
  const y = [
    'triggers:',
    '  - trigger: time',
    '    at: "07:00"',
    '  - trigger: time',
    '    at: "08:00"',
    '    id: late',
    'conditions:',
    '  - or:',
    '      - condition: trigger',
    '        id: "0"',
    '      - condition: state',
    '        entity_id: input_boolean.away',
    '        state: "on"',
    '  - condition:',
    '      - condition: time',
    '        before: "23:00"',
    '  - not:',
    '      - condition: time',
    '        weekday: sun',
    '  - condition: time',
    '    after: "12:00"',
    '    enabled: false'
  ].join('\n');
  const { model } = load(y);
  assert.deepEqual(model.conditions.map((c) => c.type), ['or', 'and', 'not', 'disabled']);
  const res = sim(model, 'UTC', 2026, 6, 1); // Monday to Sunday
  const by = {};
  runTimes(res, 'UTC').forEach((s) => { const k = s.slice(11, 16) + ' ' + s.split(' ').pop(); by[k] = (by[k] || 0) + 1; });
  // 07:00 is trigger id "0", so the or passes; 08:00 (id late) depends on the state condition;
  // on Sunday the not-condition blocks both
  assert.deepEqual(by, { '07:00 fired': 6, '07:00 blocked': 1, '08:00 unknown': 6, '08:00 blocked': 1 });
  assert.equal(res.list.find((r) => r.status === 'unknown').by.label, '#1.2');
});

test('YAML subset: flow collections, quoted escapes, block scalars, comments and YAML 1.1 scalars', () => {
  const p = hav.parseYaml([
    '# comment',
    'a: [1, "two", three]  # trailing',
    'b: {x: 1, y: [a, b]}',
    'c: "tab' + BS + 'tq' + BS + '"uote"',
    "d: 'it''s'",
    'e: |',
    '  line one',
    '  line two',
    'f: >-',
    '  folded',
    '  text',
    'g: yes',
    'h: off',
    'i: ~',
    'j: 0x1F',
    'k: 1.5',
    'l: 2026-01-01',
    'm: "multi',
    '  line"',
    'n:',
    '- x',
    '- y',
    'o: plain text',
    '  continued'
  ].join('\n'));
  assert.equal(p.error, null);
  const v = p.root.v;
  assert.deepEqual(v.a, [1, 'two', 'three']);
  assert.deepEqual(JSON.parse(JSON.stringify(v.b)), { x: 1, y: ['a', 'b'] });
  assert.equal(v.c, 'tab' + String.fromCharCode(9) + 'q"uote');
  assert.equal(v.d, "it's");
  assert.equal(v.e, 'line one\nline two\n');
  assert.equal(v.f, 'folded text');
  assert.equal(v.g, true);
  assert.equal(v.h, false);
  assert.equal(v.i, null);
  assert.equal(v.j, 31);
  assert.equal(v.k, 1.5);
  assert.ok(v.l instanceof hav.Tagged);
  assert.equal(v.m, 'multi line');
  assert.deepEqual(v.n, ['x', 'y']);
  assert.equal(v.o, 'plain text continued');
  assert.equal(hav.metaOf(v).note.g, 'yaml11bool');
  assert.equal(hav.resolvePlain('19:45:00').v, 71100);
  assert.equal(hav.resolvePlain('07:45').kind, 'str');
});

test('YAML subset refuses what it does not support, with a line number', () => {
  const err = (s) => hav.parseYaml(s).error;
  assert.match(err('a: &x 1\nb: *x\n').message, /anchors/);
  assert.match(err('a: 1\n---\nb: 2\n').message, /Only one YAML document/);
  assert.match(err('a:\n\t- 1\n').message, /Tabs/);
  assert.match(err('a: b: c\n').message, /colon followed by a space/);
  assert.match(err('alias: x\nat:07:00\n').message, /space after the colon/);
  const e = err('triggers:\n  - trigger: time\n     at: "07:00"\n');
  assert.equal(e.line, 3);
  assert.match(err('a: "open\n').message, /never closed/);
  const dup = hav.parseYaml('a: 1\na: 2\n');
  assert.equal(dup.root.v.a, 2);
  assert.match(dup.warnings[0].msg, /Duplicate key "a"/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Form-built YAML, the URL hash and the source rules
// ─────────────────────────────────────────────────────────────────────────────

test('generated YAML for the default form uses the current syntax', () => {
  const y = hav.formToYaml(hav.defaultForm(), false);
  assert.equal(y, [
    'alias: "Morning lights and evening check"',
    'description: ""',
    'triggers:',
    '  - trigger: time',
    '    at: "07:00:00"',
    '    weekday:',
    '      - mon',
    '      - tue',
    '      - wed',
    '      - thu',
    '      - fri',
    '  - trigger: time_pattern',
    '    minutes: "/30"',
    '  - trigger: sun.sunset',
    '    options:',
    '      offset: "00:30:00"',
    '      offset_type: before',
    'conditions:',
    '  - condition: time',
    '    after: "06:30:00"',
    '    before: "23:00:00"',
    'actions: []',
    'mode: single',
    ''
  ].join('\n'));
  const legacy = hav.formToYaml(hav.defaultForm(), true);
  assert.match(legacy, /- trigger: sun\n {4}event: sunset\n {4}offset: "-00:30:00"\n/);
});

test('generated YAML for other form entries parses back to the same schedule', () => {
  const form = {
    alias: 'Say "hi"',
    triggers: [
      { k: 'time', at: '7:5, 19:30:15', wd: [false, false, false, false, false, true, true] },
      { k: 'pattern', h: '/2', m: '', s: '' },
      { k: 'sun', ev: 'dusk', tw: 'nautical', off: '0:15', dir: 'after' },
      { k: 'sun', ev: 'sunrise', tw: 'civil', off: '', dir: 'before' }
    ],
    conds: [
      { k: 'time', after: '22:00', before: '6:00', wd: [false, false, false, false, true, true, false] },
      { k: 'sun', after: 'sunset', aoff: '-1:00', before: '', boff: '' }
    ]
  };
  const y = hav.formToYaml(form, false);
  assert.match(y, /alias: "Say \\"hi\\""/);
  assert.match(y, /at:\n {6}- "07:05:00"\n {6}- "19:30:15"\n {4}weekday:\n {6}- sat\n {6}- sun/);
  assert.match(y, /- trigger: sun.dusk\n {4}options:\n {6}type: nautical\n {6}offset: "00:15:00"\n {6}offset_type: after/);
  assert.match(y, /- trigger: sun.sunrise\n {2}- condition|- trigger: sun.sunrise\nconditions/);
  assert.match(y, /after_offset: "-01:00:00"/);
  const { model, found } = load(y);
  assert.equal(found.items[0].obj.alias, 'Say "hi"');
  assert.equal(model.errors.length, 0);
  assert.deepEqual(model.triggers.map((t) => t.type), ['time', 'pattern', 'sun', 'sun']);
  assert.deepEqual(model.triggers[2].offsetMs, 900000);
  const back = hav.modelToForm(model, model.alias);
  assert.equal(hav.formToYaml(back, false), y);
});

test('URL hash round-trip; coordinates only with the explicit option', () => {
  const form = hav.defaultForm();
  const base = { tz: 'Europe/Kyiv', legacySun: false, listLimit: 50, listFilter: 'fired', start: '2026-10-25T03:00', keepLoc: false, lat: '50.45', lon: '30.52', elev: '120' };
  const h1 = hav.encodeState(form, base);
  const d1 = hav.decodeState(h1);
  assert.deepEqual(d1.form, form);
  assert.deepEqual([d1.settings.tz, d1.settings.listLimit, d1.settings.listFilter, d1.settings.start], ['Europe/Kyiv', 50, 'fired', '2026-10-25T03:00']);
  assert.deepEqual([d1.settings.keepLoc, d1.settings.lat, d1.settings.lon], [false, '', '']);
  assert.ok(!Buffer.from(h1.slice(3), 'base64url').toString().includes('50.45'));
  const d2 = hav.decodeState(hav.encodeState(form, Object.assign({}, base, { keepLoc: true })));
  assert.deepEqual([d2.settings.keepLoc, d2.settings.lat, d2.settings.lon, d2.settings.elev], [true, '50.45', '30.52', '120']);
  // non-ASCII alias survives
  const f3 = Object.assign(hav.defaultForm(), { alias: 'Світло — ранок' });
  assert.equal(hav.decodeState(hav.encodeState(f3, base)).form.alias, 'Світло — ранок');
  assert.equal(hav.decodeState('#s=not-base64!'), null);
  assert.equal(hav.decodeState('#other'), null);
});

test('examples load without YAML errors and the explanation notes cover the tricky parts', () => {
  Object.keys(hav.EXAMPLES).forEach((k) => {
    const p = hav.parseYaml(hav.EXAMPLES[k].yaml.join('\n'));
    assert.equal(p.error, null, k);
  });
  const t = load('triggers:\n  - trigger: time_pattern\n    minutes: "/7"\n').model.triggers[0];
  const txt = plain(hav.explainPattern(t));
  assert.match(txt, /divisible by 7 \(0, 7, 14, 21, … 56\)/);
  assert.match(txt, /60 is not a multiple of 7.*56 is followed by 0 after 4 minutes/);
  assert.match(txt, /uses second 0/);
  const h = load('triggers:\n  - trigger: time_pattern\n    hours: "*"\n').model.triggers[0];
  assert.match(plain(hav.explainPattern(h)), /fills in minute 0 and second 0.*hourly/);
  const night = load(hav.EXAMPLES.night.yaml.join('\n')).model;
  assert.match(plain(hav.describeCondition(night.conditions[0])), /crosses midnight.*at 01:00 on a Saturday this passes only if Saturday is selected/);
});

test('tool source follows the WordPress embed rules', () => {
  const dir = path.join(__dirname, '..', 'home-assistant-schedule-visualizer');
  ['index.html', 'style.css', 'script.js'].forEach((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (f !== 'index.html') {
      assert.ok(!src.includes(CMT_OPEN), f + ' contains a comment opener');
      assert.ok(!src.includes(CMT_CLOSE), f + ' contains a comment closer');
    }
    assert.ok(!src.includes(SCRIPT_END) || f === 'index.html', f + ' contains a script end tag');
  });
  const js = fs.readFileSync(path.join(dir, 'script.js'), 'utf8');
  assert.ok(!new RegExp(BS + BS + 'u[0-9a-fA-F{]').test(js), 'script.js contains a literal unicode escape');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.ok(!html.includes('<style'));
  assert.ok(!html.includes(CMT_OPEN));
});
