// tests/backup-retention-prune-simulator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript } = require('./_setup');

const brp = loadScript('backup-retention-prune-simulator/script.js');

const HOUR = 3600000;
const DAY = 86400000;

// 'YYYY-MM-DD HH:MM[:SS[.f]]' read as UTC
const utc = (s) => Date.parse(s.replace(' ', 'T') + 'Z');
const iso = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const snapsOf = (times, tz) => times.map((t, i) => brp.makeSnap(t, i, tz || 'UTC'));
const newestFirst = (snaps) => snaps.slice().sort((a, b) => b.t - a.t || a.i - b.i);

// Kept snapshots, newest first, as 'YYYY-MM-DD HH:MM' (UTC) plus the tags
function keptList(res, snaps) {
  return newestFirst(snaps).filter((s) => res.marks[s.i].keep).map((s) => iso(s.t));
}
function keptTags(res, snaps, tool) {
  return newestFirst(snaps).filter((s) => res.marks[s.i].keep)
    .map((s) => iso(s.t) + ' ' + res.marks[s.i].tags.map((t) => brp.tagText(tool, t)).join(','));
}

// One backup a day at hh:00 UTC from `from` to `to` (inclusive), minus `skip` dates
function daily(from, to, hh, skip) {
  const out = [];
  for (let t = utc(from + ' ' + String(hh).padStart(2, '0') + ':00'); t <= utc(to + ' 23:59'); t += DAY) {
    if (!(skip || []).includes(new Date(t).toISOString().slice(0, 10))) out.push(t);
  }
  return out;
}

const run = {
  pbs: (snaps, opts) => brp.prunePbs(snaps, opts),
  borg: (snaps, opts, now) => brp.pruneBorg(snaps, opts, now),
  restic: (snaps, opts, now, tz) => brp.pruneRestic(snaps, opts, now, tz || 'UTC')
};
const state = (patch) => Object.assign(brp.defaultState(), patch || {});

// ─────────────────────────────────────────────────────────────────────────────
// Proxmox Backup Server 4.2.8: docs examples
// ─────────────────────────────────────────────────────────────────────────────

test('PBS: proxmox-backup-client prune --dry-run --keep-daily 1 --keep-weekly 3 (docs table)', () => {
  // docs/backup-client.rst, host/elsa: keep 1, 0, 1, 0, 1
  const snaps = snapsOf(['2019-12-04T13:20:37Z', '2019-12-03T09:35:01Z', '2019-11-22T11:54:47Z',
    '2019-11-21T12:36:25Z', '2019-11-10T10:42:20Z'].map(Date.parse));
  const r = run.pbs(snaps, { daily: 1, weekly: 3 });
  assert.deepEqual(snaps.map((s) => (r.marks[s.i].keep ? 1 : 0)), [1, 0, 1, 0, 1]);
  assert.deepEqual(keptTags(r, snaps, 'pbs'), ['2019-12-04 13:20 daily #1', '2019-11-22 11:54 weekly #1', '2019-11-10 10:42 weekly #2']);
});

test('PBS: retention example (last 3, daily 13, weekly 8, monthly 11, yearly 9) covers 10 years', () => {
  // docs/maintenance.rst "Retention Settings Example": daily backups, at least 10 years
  const snaps = snapsOf(daily('2016-11-01', '2026-10-27', 2));
  const r = run.pbs(snaps, { last: 3, daily: 13, weekly: 8, monthly: 11, yearly: 9 });
  const kept = keptList(r, snaps);
  assert.equal(kept.length, 3 + 13 + 8 + 11 + 9);
  // "at least 10 years": keep-monthly 11 already reaches into 2025, so keep-yearly starts at 2024
  assert.equal(kept[kept.length - 1].slice(0, 4), '2016');
  const byRule = {};
  newestFirst(snaps).forEach((s) => { const m = r.marks[s.i]; if (m.keep) byRule[m.tags[0].rule] = (byRule[m.tags[0].rule] || 0) + 1; });
  assert.deepEqual(byRule, { last: 3, daily: 13, weekly: 8, monthly: 11, yearly: 9 });
});

test('PBS: keep-monthly skips the rest of a week keep-weekly kept (prune simulator docs)', () => {
  // "in a week covered by keep-weekly, one backup is kept while all others are removed;
  // keep-monthly then does not consider backups from that week anymore, even if part of
  // the week is part of an earlier month." Week 2026-W40 is Mon 09-28 to Sun 10-04.
  const snaps = snapsOf(daily('2026-08-20', '2026-10-04', 12));
  const opts = { weekly: 1, monthly: 2 };
  assert.deepEqual(keptTags(run.pbs(snaps, opts), snaps, 'pbs'),
    ['2026-10-04 12:00 weekly #1', '2026-09-27 12:00 monthly #1', '2026-08-31 12:00 monthly #2']);
  // borg and restic keep the last backup of September
  assert.deepEqual(keptTags(run.borg(snaps, opts, utc('2026-10-05 00:00')), snaps, 'borg'),
    ['2026-10-04 12:00 weekly #1', '2026-09-30 12:00 monthly #1', '2026-08-31 12:00 monthly #2']);
  assert.deepEqual(keptTags(run.restic(snaps, opts, utc('2026-10-05 00:00')), snaps, 'restic'),
    ['2026-10-04 12:00 weekly #1,monthly #1', '2026-09-30 12:00 monthly #2']);
});

test('PBS: no keep option keeps every snapshot; borg and restic refuse to run', () => {
  const snaps = snapsOf(daily('2026-10-01', '2026-10-10', 2));
  const p = run.pbs(snaps, {});
  assert.equal(p.keepAll, true);
  assert.ok(snaps.every((s) => p.marks[s.i].keep && p.marks[s.i].tags[0].rule === 'all'));
  for (const tool of ['borg', 'restic']) {
    const r = run[tool](snaps, {}, utc('2026-10-11 00:00'));
    assert.equal(r.refused, true, tool);
    assert.ok(snaps.every((s) => r.marks[s.i].keep), tool);
  }
  const res = brp.compute(state({ last: '', daily: '', weekly: '', monthly: '', yearly: '', end: '2026-10-11T00:00', tz: 'UTC' }), 0);
  assert.equal(res.ok, true);
  assert.equal(res.analysis.notes[0].title, 'No rule set');
  assert.match(res.commands.pbs, /keeps every snapshot/);
  assert.match(res.commands.borg, /refuses/);
  assert.match(res.commands.restic, /refuses/);
});

// ─────────────────────────────────────────────────────────────────────────────
// BorgBackup 1.4.5: docs example and the project's own unit tests
// ─────────────────────────────────────────────────────────────────────────────

test('borg: docs/misc/prune-example.txt (daily 14, monthly 6, yearly 1 over 2015)', () => {
  const snaps = snapsOf(daily('2015-01-01', '2015-12-31', 12, ['2015-12-19']));
  const r = run.borg(snaps, { daily: 14, monthly: 6, yearly: 1 }, utc('2016-01-01 00:00'));
  const kept = keptTags(r, snaps, 'borg').map((x) => x.slice(0, 10) + ' ' + x.slice(17));
  assert.deepEqual(kept, [
    '2015-12-31 daily #1', '2015-12-30 daily #2', '2015-12-29 daily #3', '2015-12-28 daily #4', '2015-12-27 daily #5',
    '2015-12-26 daily #6', '2015-12-25 daily #7', '2015-12-24 daily #8', '2015-12-23 daily #9', '2015-12-22 daily #10',
    '2015-12-21 daily #11', '2015-12-20 daily #12', '2015-12-18 daily #13', '2015-12-17 daily #14',
    '2015-11-30 monthly #1', '2015-10-31 monthly #2', '2015-09-30 monthly #3', '2015-08-31 monthly #4',
    '2015-07-31 monthly #5', '2015-06-30 monthly #6', '2015-01-01 yearly[oldest] #1'
  ]);
});

test('borg: test_prune_repository_example keeps test01..test21 and prunes test22..test24', () => {
  // src/borg/testsuite/archiver.py; archives at midnight
  const days = ['2015-01-01', '2015-06-30', '2015-07-31', '2015-08-31', '2015-09-30', '2015-10-31', '2015-11-30',
    '2015-12-17', '2015-12-18', '2015-12-20', '2015-12-21', '2015-12-22', '2015-12-23', '2015-12-24', '2015-12-25',
    '2015-12-26', '2015-12-27', '2015-12-28', '2015-12-29', '2015-12-30', '2015-12-31',
    '2015-01-02', '2015-05-31', '2015-12-16'];
  const snaps = snapsOf(days.map((d) => utc(d + ' 00:00')));
  const r = run.borg(snaps, { daily: 14, monthly: 6, yearly: 1 }, utc('2016-01-01 12:00'));
  snaps.forEach((s, k) => assert.equal(r.marks[s.i].keep, k < 21, 'test' + String(k + 1).padStart(2, '0')));
  assert.deepEqual(r.marks[0].tags[0], { rule: 'yearly', n: 1, oldest: true });
  for (let i = 1; i <= 6; i++) assert.deepEqual(r.marks[7 - i].tags[0], { rule: 'monthly', n: i });
  for (let i = 1; i <= 14; i++) assert.deepEqual(r.marks[21 - i].tags[0], { rule: 'daily', n: i });
});

test('borg: test_prune_split cases (one rule at a time)', () => {
  const at = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h, mi, s);
  const times = [at(2015, 1, 1, 10, 0, 0), at(2016, 1, 1, 10, 0, 0), at(2017, 1, 1, 10, 0, 0),
    at(2017, 2, 1, 10, 0, 0), at(2017, 3, 1, 10, 0, 0),
    at(2017, 3, 2, 10, 0, 0), at(2017, 3, 3, 10, 0, 0), at(2017, 3, 4, 10, 0, 0),
    at(2017, 10, 1, 9, 45, 0), at(2017, 10, 1, 9, 55, 0),
    at(2017, 10, 1, 10, 0, 1), at(2017, 10, 1, 10, 0, 3), at(2017, 10, 1, 10, 0, 5)];
  const snaps = snapsOf(times);
  const cases = [['yearly', 3, [13, 2, 1]], ['monthly', 3, [13, 8, 4]], ['weekly', 2, [13, 8]],
    ['daily', 3, [13, 8, 7]], ['hourly', 3, [13, 10, 8]], ['last', 4, [13, 12, 11, 10]]];
  const now = at(2018, 1, 1, 0, 0, 0);
  for (const [rule, n, ids] of cases) {
    const r = run.borg(snaps, { [rule]: n }, now);
    const got = snaps.filter((s) => r.marks[s.i].keep).map((s) => s.i + 1).sort((a, b) => b - a);
    assert.deepEqual(got, ids, rule + ' ' + n);
    assert.ok(snaps.every((s) => !r.marks[s.i].keep || r.marks[s.i].tags[0].rule === rule));
  }
  // ("daily", 0, []): a count of 0 is no rule at all, and borg prune refuses to run without one
  assert.equal(run.borg(snaps, { daily: 0 }, now).refused, true);
});

test('borg: test_prune_split_keep_oldest and the empty list', () => {
  const snaps = snapsOf([utc('2018-01-01 10:00'), utc('2018-12-30 10:00'), utc('2018-12-31 10:00'), utc('2019-12-31 10:00')]);
  const now = utc('2020-01-01 00:00');
  const r3 = run.borg(snaps, { yearly: 3 }, now);
  assert.deepEqual(snaps.map((s) => r3.marks[s.i].keep), [true, false, true, true]);
  assert.equal(brp.tagText('borg', r3.marks[0].tags[0]), 'yearly[oldest] #3');
  const r2 = run.borg(snaps, { yearly: 2 }, now);
  assert.deepEqual(snaps.map((s) => r2.marks[s.i].keep), [false, false, true, true]);
  assert.deepEqual(run.borg([], { yearly: 3 }, now).marks, {});
  assert.deepEqual(run.pbs([], { yearly: 3 }).marks, {});
  assert.deepEqual(run.restic([], { yearly: 3 }, now).marks, {});
});

test('borg: test_prune_within offsets (1 min to 49 h) for H, d, w, m and y', () => {
  const now = utc('2026-06-15 12:00');
  const offsets = [60e3, 90 * 60e3, 150 * 60e3, 210 * 60e3, 25 * HOUR, 49 * HOUR];
  const snaps = snapsOf(offsets.map((o) => now - o));
  const cases = [[1, 'h', [0]], [2, 'h', [0, 1]], [3, 'h', [0, 1, 2]], [24, 'h', [0, 1, 2, 3]], [26, 'h', [0, 1, 2, 3, 4]],
    [2, 'd', [0, 1, 2, 3, 4]], [50, 'h', [0, 1, 2, 3, 4, 5]], [3, 'd', [0, 1, 2, 3, 4, 5]], [1, 'w', [0, 1, 2, 3, 4, 5]],
    [1, 'm', [0, 1, 2, 3, 4, 5]], [1, 'y', [0, 1, 2, 3, 4, 5]]];
  for (const [n, unit, ids] of cases) {
    const r = run.borg(snaps, { within: { n, unit } }, now);
    assert.deepEqual(snaps.filter((s) => r.marks[s.i].keep).map((s) => s.i), ids, n + unit);
    assert.ok(snaps.every((s) => !r.marks[s.i].keep || r.marks[s.i].tags[0].rule === 'within'));
  }
});

test('borg: test_prune_retain_and_expire_oldest, pruning after every backup', () => {
  // src/borg/testsuite/archiver.py: an archive at 11:15 on 09-01, then one at 12:00 every day
  const times = [utc('2020-09-01 11:15')].concat(daily('2020-09-01', '2020-10-06', 12));
  const opts = { daily: 7, monthly: 1 };
  const replay = (list) => {
    let alive = [];
    list.forEach((t, i) => {
      alive.push(brp.makeSnap(t, i, 'UTC'));
      const r = run.borg(alive, opts, t + 1000);
      alive = alive.filter((s) => r.marks[s.i].keep);
    });
    return alive;
  };
  let alive = replay(times);
  let r = run.borg(alive, opts, utc('2020-10-07 00:00'));
  assert.deepEqual(r.marks[0].tags[0], { rule: 'monthly', n: 1, oldest: true });   // original_archive
  alive = replay(times.concat([utc('2020-10-07 12:00')]));
  r = run.borg(alive, opts, utc('2020-10-08 00:00'));
  const monthly = alive.filter((s) => r.marks[s.i].keep && r.marks[s.i].tags[0].rule === 'monthly');
  assert.deepEqual(monthly.map((s) => iso(s.t)), ['2020-09-30 12:00']);
  assert.ok(!alive.some((s) => s.i === 0), 'oldest archive expired');
});

// ─────────────────────────────────────────────────────────────────────────────
// restic 0.19.1: docs examples and the project's golden files
// ─────────────────────────────────────────────────────────────────────────────

const RESTIC_DOC = ['2025-04-21 11:00:00', '2025-04-22 11:00:00', '2025-04-23 11:00:00', '2025-04-24 11:00:00',
  '2025-04-25 11:00:00', '2025-04-25 23:00:00', '2025-04-28 11:00:00', '2025-04-29 11:00:00',
  '2025-05-01 11:00:00', '2025-05-02 11:00:00', '2025-05-02 23:00:00'];

test('restic: doc/060_forget.rst forget --keep-daily 5 with a missed Wednesday', () => {
  const snaps = snapsOf(RESTIC_DOC.map(utc));
  const r = run.restic(snaps, { daily: 5 }, utc('2025-05-03 00:00'));
  assert.deepEqual(keptList(r, snaps), ['2025-05-02 23:00', '2025-05-01 11:00', '2025-04-29 11:00', '2025-04-28 11:00', '2025-04-25 23:00']);
  // keep-within counts back from the newest snapshot and needs a strictly newer time:
  // 7 days before 05-02 23:00 is 04-25 23:00, which is not kept
  const w = run.restic(snaps, { within: { n: 7, unit: 'd' } }, utc('2025-05-10 00:00'));
  assert.deepEqual(keptList(w, snaps), ['2025-05-02 23:00', '2025-05-02 11:00', '2025-05-01 11:00', '2025-04-29 11:00', '2025-04-28 11:00']);
  assert.equal(w.withinFrom, utc('2025-04-25 23:00'));
});

test('restic: 100 years of daily backups with daily 7, weekly 5, monthly 12, yearly 75 (docs)', () => {
  // "7 daily and 4 last-day-of-the-week ones (since the 7 dailies already include 1 weekly)
  // ... 12 or 11 last-day-of-the-month ... 75 or 74 last-day-of-the-year snapshots".
  // Those counts hold when the newest backup is a Sunday in December: the 7 dailies then hold
  // one week's last day and the 12 monthlies stay in the current year. On other dates the
  // rules overlap more (in October, keep-monthly 12 also takes 2025-12-31 from keep-yearly).
  const times = [];
  for (let t = utc('1926-12-28 01:00'); t <= utc('2026-12-27 01:00'); t += DAY) times.push(t);
  const snaps = snapsOf(times);
  const r = run.restic(snaps, { daily: 7, weekly: 5, monthly: 12, yearly: 75 }, utc('2026-12-27 12:00'));
  const kept = newestFirst(snaps).filter((s) => r.marks[s.i].keep);
  const only = (rule) => kept.filter((s) => r.marks[s.i].tags.some((t) => t.rule === rule));
  const without = (list, rules) => list.filter((s) => !r.marks[s.i].tags.some((t) => rules.includes(t.rule)));
  assert.equal(only('daily').length, 7);
  assert.equal(without(only('weekly'), ['daily']).length, 4);
  assert.ok([11, 12].includes(without(only('monthly'), ['daily', 'weekly']).length));
  assert.ok([74, 75].includes(without(only('yearly'), ['daily', 'weekly', 'monthly']).length));
  assert.ok(!kept.some((s) => r.marks[s.i].tags.some((t) => t.oldest)), 'enough history: no oldest fallback');
});

// From restic v0.19.1 internal/data/snapshot_policy_test.go (testExpireSnapshots, UTC) and the
// golden files internal/data/testdata/policy_keep_snapshots_N: kept snapshots and reasons.
const RESTIC_TIMES = [
  '2014-09-01 10:20:30', '2014-09-02 10:20:30', '2014-09-05 10:20:30', '2014-09-06 10:20:30',
  '2014-09-08 10:20:30', '2014-09-09 10:20:30', '2014-09-10 10:20:30', '2014-09-11 10:20:30',
  '2014-09-20 10:20:30', '2014-09-22 10:20:30', '2014-08-08 10:20:30', '2014-08-10 10:20:30',
  '2014-08-12 10:20:30', '2014-08-13 10:20:30', '2014-08-13 10:20:30.1', '2014-08-15 10:20:30',
  '2014-08-18 10:20:30', '2014-08-20 10:20:30', '2014-08-21 10:20:30', '2014-08-22 10:20:30',
  '2014-10-01 10:20:30', '2014-10-02 10:20:30', '2014-10-05 10:20:30', '2014-10-06 10:20:30',
  '2014-10-08 10:20:30', '2014-10-09 10:20:30', '2014-10-10 10:20:30', '2014-10-11 10:20:30',
  '2014-10-20 10:20:30', '2014-10-22 10:20:30', '2014-11-08 10:20:30', '2014-11-10 10:20:30',
  '2014-11-12 10:20:30', '2014-11-13 10:20:30', '2014-11-13 10:20:30.1', '2014-11-15 10:20:30',
  '2014-11-18 10:20:30', '2014-11-20 10:20:30', '2014-11-21 10:20:30', '2014-11-22 10:20:30',
  '2015-09-01 10:20:30', '2015-09-02 10:20:30', '2015-09-05 10:20:30', '2015-09-06 10:20:30',
  '2015-09-08 10:20:30', '2015-09-09 10:20:30', '2015-09-10 10:20:30', '2015-09-11 10:20:30',
  '2015-09-20 10:20:30', '2015-09-22 10:20:30', '2015-08-08 10:20:30', '2015-08-10 10:20:30',
  '2015-08-12 10:20:30', '2015-08-13 10:20:30', '2015-08-13 10:20:30.1', '2015-08-15 10:20:30',
  '2015-08-18 10:20:30', '2015-08-20 10:20:30', '2015-08-21 10:20:30', '2015-08-22 10:20:30',
  '2015-10-01 10:20:30', '2015-10-02 10:20:30', '2015-10-05 10:20:30', '2015-10-06 10:20:30',
  '2015-10-08 10:20:30', '2015-10-09 10:20:30', '2015-10-10 10:20:30', '2015-10-11 10:20:30',
  '2015-10-20 10:20:30', '2015-10-22 10:20:30', '2015-10-22 10:20:30', '2015-10-22 10:20:30',
  '2015-10-22 10:20:30', '2015-10-22 10:20:30', '2015-11-08 10:20:30', '2015-11-10 10:20:30',
  '2015-11-12 10:20:30', '2015-11-13 10:20:30', '2015-11-13 10:20:30.1', '2015-11-15 10:20:30',
  '2015-11-18 10:20:30', '2015-11-20 10:20:30', '2015-11-21 10:20:30', '2015-11-22 10:20:30',
  '2016-01-01 01:02:03', '2016-01-01 01:03:03', '2016-01-01 07:08:03', '2016-01-03 07:02:03',
  '2016-01-04 10:23:03', '2016-01-04 11:23:03', '2016-01-04 12:23:03', '2016-01-04 12:24:03',
  '2016-01-04 12:28:03', '2016-01-04 12:30:03', '2016-01-04 16:23:03', '2016-01-05 09:02:03',
  '2016-01-06 08:02:03', '2016-01-07 10:02:03', '2016-01-08 20:02:03', '2016-01-09 21:02:03',
  '2016-01-12 21:02:03', '2016-01-12 21:08:03', '2016-01-18 12:02:03',
];
const RESTIC_GOLDEN = [
  [{ last: 10 }, [
    '2016-01-18 12:02:03|last', '2016-01-12 21:08:03|last', '2016-01-12 21:02:03|last',
    '2016-01-09 21:02:03|last', '2016-01-08 20:02:03|last', '2016-01-07 10:02:03|last',
    '2016-01-06 08:02:03|last', '2016-01-05 09:02:03|last', '2016-01-04 16:23:03|last',
    '2016-01-04 12:30:03|last']],
  [{ daily: 3 }, ['2016-01-18 12:02:03|daily', '2016-01-12 21:08:03|daily', '2016-01-09 21:02:03|daily']],
  [{ last: 5, daily: 5 }, [
    '2016-01-18 12:02:03|last,daily', '2016-01-12 21:08:03|last,daily', '2016-01-12 21:02:03|last',
    '2016-01-09 21:02:03|last,daily', '2016-01-08 20:02:03|last,daily', '2016-01-07 10:02:03|daily']],
  [{ weekly: 4 }, [
    '2016-01-18 12:02:03|weekly', '2016-01-12 21:08:03|weekly', '2016-01-09 21:02:03|weekly',
    '2016-01-03 07:02:03|weekly']],
  [{ daily: 3, weekly: 4 }, [
    '2016-01-18 12:02:03|daily,weekly', '2016-01-12 21:08:03|daily,weekly', '2016-01-09 21:02:03|daily,weekly',
    '2016-01-03 07:02:03|weekly']],
  [{ monthly: 6 }, [
    '2016-01-18 12:02:03|monthly', '2015-11-22 10:20:30|monthly', '2015-10-22 10:20:30|monthly',
    '2015-09-22 10:20:30|monthly', '2015-08-22 10:20:30|monthly', '2014-11-22 10:20:30|monthly']],
  [{ daily: 2, weekly: 2, monthly: 6 }, [
    '2016-01-18 12:02:03|daily,weekly,monthly', '2016-01-12 21:08:03|daily,weekly', '2015-11-22 10:20:30|monthly',
    '2015-10-22 10:20:30|monthly', '2015-09-22 10:20:30|monthly', '2015-08-22 10:20:30|monthly',
    '2014-11-22 10:20:30|monthly']],
  [{ yearly: 10 }, [
    '2016-01-18 12:02:03|yearly', '2015-11-22 10:20:30|yearly', '2014-11-22 10:20:30|yearly',
    '2014-08-08 10:20:30|oldest yearly']],
  [{ daily: 7, weekly: 2, monthly: 3, yearly: 10 }, [
    '2016-01-18 12:02:03|daily,weekly,monthly,yearly', '2016-01-12 21:08:03|daily,weekly', '2016-01-09 21:02:03|daily',
    '2016-01-08 20:02:03|daily', '2016-01-07 10:02:03|daily', '2016-01-06 08:02:03|daily',
    '2016-01-05 09:02:03|daily', '2015-11-22 10:20:30|monthly,yearly', '2015-10-22 10:20:30|monthly',
    '2014-11-22 10:20:30|yearly', '2014-08-08 10:20:30|oldest yearly']],
  [{ within: { dur: { m: 1, d: 14 } } }, [
    '2016-01-18 12:02:03|within 1m14d', '2016-01-12 21:08:03|within 1m14d', '2016-01-12 21:02:03|within 1m14d',
    '2016-01-09 21:02:03|within 1m14d', '2016-01-08 20:02:03|within 1m14d', '2016-01-07 10:02:03|within 1m14d',
    '2016-01-06 08:02:03|within 1m14d', '2016-01-05 09:02:03|within 1m14d', '2016-01-04 16:23:03|within 1m14d',
    '2016-01-04 12:30:03|within 1m14d', '2016-01-04 12:28:03|within 1m14d', '2016-01-04 12:24:03|within 1m14d',
    '2016-01-04 12:23:03|within 1m14d', '2016-01-04 11:23:03|within 1m14d', '2016-01-04 10:23:03|within 1m14d',
    '2016-01-03 07:02:03|within 1m14d', '2016-01-01 07:08:03|within 1m14d', '2016-01-01 01:03:03|within 1m14d',
    '2016-01-01 01:02:03|within 1m14d']],
  [{ within: { dur: { d: 13, h: 23 } } }, [
    '2016-01-18 12:02:03|within 13d23h', '2016-01-12 21:08:03|within 13d23h', '2016-01-12 21:02:03|within 13d23h',
    '2016-01-09 21:02:03|within 13d23h', '2016-01-08 20:02:03|within 13d23h', '2016-01-07 10:02:03|within 13d23h',
    '2016-01-06 08:02:03|within 13d23h', '2016-01-05 09:02:03|within 13d23h', '2016-01-04 16:23:03|within 13d23h']],
  [{ daily: 3, weekly: 2, monthly: -1, yearly: -1 }, [
    '2016-01-18 12:02:03|daily,weekly,monthly,yearly', '2016-01-12 21:08:03|daily,weekly', '2016-01-09 21:02:03|daily',
    '2015-11-22 10:20:30|monthly,yearly', '2015-10-22 10:20:30|monthly', '2015-09-22 10:20:30|monthly',
    '2015-08-22 10:20:30|monthly', '2014-11-22 10:20:30|monthly,yearly', '2014-10-22 10:20:30|monthly',
    '2014-09-22 10:20:30|monthly', '2014-08-22 10:20:30|monthly', '2014-08-08 10:20:30|oldest monthly,oldest yearly']]
];

test('restic: ApplyPolicy matches restic\'s own golden files (kept snapshots and reasons)', () => {
  const snaps = snapsOf(RESTIC_TIMES.map(utc));
  const fmt = (t) => new Date(t).toISOString().replace('T', ' ').replace('Z', '').replace(/\.000$/, '').replace(/(\.\d)00$/, '$1');
  const reason = (tag) => (tag.rule === 'within' ? 'within ' + tag.label : (tag.oldest ? 'oldest ' : '') + tag.rule);
  for (const [opts, want] of RESTIC_GOLDEN) {
    const r = run.restic(snaps, opts, utc('2026-01-01 00:00'));
    const got = newestFirst(snaps).filter((s) => r.marks[s.i].keep).map((s) => fmt(s.t) + '|' + r.marks[s.i].tags.map(reason).join(','));
    assert.deepEqual(got, want, JSON.stringify(opts));
  }
  // keep-last unlimited keeps all 103; keep-hourly unlimited keeps one per hour plus the oldest
  assert.equal(keptList(run.restic(snaps, { last: -1 }, utc('2026-01-01 00:00')), snaps).length, RESTIC_TIMES.length);
});

// ─────────────────────────────────────────────────────────────────────────────
// Where the engines differ
// ─────────────────────────────────────────────────────────────────────────────

test('rule order: PBS and borg add periods, restic counts one snapshot for several rules', () => {
  const snaps = snapsOf(daily('2026-09-01', '2026-10-27', 2));
  const opts = { last: 3, daily: 7 };
  const now = utc('2026-10-27 12:00');
  assert.equal(keptList(run.pbs(snaps, opts), snaps).length, 10);
  assert.equal(keptList(run.borg(snaps, opts, now), snaps).length, 10);
  const r = run.restic(snaps, opts, now);
  assert.equal(keptList(r, snaps).length, 7);
  assert.deepEqual(r.marks[snaps[snaps.length - 1].i].tags, [{ rule: 'last', n: 1 }, { rule: 'daily', n: 1 }]);
});

test('PBS counts a month as covered by any kept snapshot, borg only by its newest', () => {
  // keep-daily 3 keeps 10-27..10-25; keep-weekly 6 keeps the Sundays 10-18 back to 09-13.
  // PBS: September already holds kept Sundays, so keep-monthly skips it and keeps 08-31.
  // borg: September's newest backup (Wed 09-30) is not kept yet, so keep-monthly keeps it.
  const snaps = snapsOf(daily('2026-08-01', '2026-10-27', 2));
  const now = utc('2026-10-27 12:00');
  const opts = { daily: 3, weekly: 6, monthly: 1 };
  const pbs = keptTags(run.pbs(snaps, opts), snaps, 'pbs');
  const borg = keptTags(run.borg(snaps, opts, now), snaps, 'borg');
  assert.ok(pbs.includes('2026-09-27 02:00 weekly #4'));
  assert.ok(pbs.includes('2026-08-31 02:00 monthly #1'), 'PBS: September covered, monthly goes to August');
  assert.ok(borg.includes('2026-09-30 02:00 monthly #1'), 'borg: September newest not kept, so monthly keeps it');
});

test('ISO weeks: week 1 can start in December and week 53 can end in January, the same in all three', () => {
  assert.deepEqual(brp.isoWeek(2024, 12, 30), { year: 2025, week: 1 });
  assert.deepEqual(brp.isoWeek(2025, 1, 5), { year: 2025, week: 1 });
  assert.deepEqual(brp.isoWeek(2026, 12, 31), { year: 2026, week: 53 });
  assert.deepEqual(brp.isoWeek(2027, 1, 3), { year: 2026, week: 53 });
  assert.deepEqual(brp.isoWeek(2027, 1, 4), { year: 2027, week: 1 });
  assert.deepEqual(brp.isoWeek(2021, 1, 3), { year: 2020, week: 53 });
  assert.deepEqual(brp.isoWeek(2026, 10, 26), { year: 2026, week: 44 });
  // Daily backups 2024-12-26..2025-01-08, keep-weekly 3: Sun 01-05 holds all of 2025-W01
  const snaps = snapsOf(daily('2024-12-26', '2025-01-08', 3));
  const now = utc('2025-01-09 00:00');
  for (const tool of ['pbs', 'borg', 'restic']) {
    assert.deepEqual(keptList(run[tool](snaps, { weekly: 3 }, now), snaps), ['2025-01-08 03:00', '2025-01-05 03:00', '2024-12-29 03:00'], tool);
  }
});

test('year boundary: PBS keep-yearly cannot use the last days of a year inside a kept ISO week', () => {
  // 2026-W53 runs Mon 2026-12-28 to Sun 2027-01-03; the newest backup is Sat 2027-01-02
  const snaps = snapsOf(daily('2026-12-10', '2027-01-02', 9));
  const now = utc('2027-01-03 00:00');
  const opts = { weekly: 1, yearly: 2 };
  assert.deepEqual(keptTags(run.pbs(snaps, opts), snaps, 'pbs'), ['2027-01-02 09:00 weekly #1', '2026-12-27 09:00 yearly #1']);
  // borg also keeps its oldest archive, because keep-yearly 2 finds only one more year
  assert.deepEqual(keptTags(run.borg(snaps, opts, now), snaps, 'borg'),
    ['2027-01-02 09:00 weekly #1', '2026-12-31 09:00 yearly #1', '2026-12-10 09:00 yearly[oldest] #2']);
  assert.deepEqual(keptTags(run.restic(snaps, opts, now), snaps, 'restic'), ['2027-01-02 09:00 weekly #1,yearly #1', '2026-12-31 09:00 yearly #2']);
});

test('oldest fallback: borg and restic keep the oldest snapshot when a rule runs short, PBS does not', () => {
  // three backups a day on two days, keep-daily 5
  const snaps = snapsOf(['2026-10-01 06:00', '2026-10-01 12:00', '2026-10-01 18:00', '2026-10-02 06:00', '2026-10-02 12:00', '2026-10-02 18:00'].map(utc));
  const now = utc('2026-10-03 00:00');
  assert.deepEqual(keptTags(run.pbs(snaps, { daily: 5 }), snaps, 'pbs'), ['2026-10-02 18:00 daily #1', '2026-10-01 18:00 daily #2']);
  assert.deepEqual(keptTags(run.borg(snaps, { daily: 5 }, now), snaps, 'borg'),
    ['2026-10-02 18:00 daily #1', '2026-10-01 18:00 daily #2', '2026-10-01 06:00 daily[oldest] #3']);
  assert.deepEqual(keptTags(run.restic(snaps, { daily: 5 }, now), snaps, 'restic'),
    ['2026-10-02 18:00 daily #1', '2026-10-01 18:00 daily #2', '2026-10-01 06:00 oldest daily']);
  // unlimited: restic still keeps the oldest; borg's -1 never runs short
  assert.equal(keptList(run.restic(snaps, { daily: -1 }, now), snaps).length, 3);
  assert.equal(keptList(run.borg(snaps, { daily: -1 }, now), snaps).length, 2);
  assert.equal(keptList(run.pbs(snaps, { daily: -1 }), snaps).length, 2);
});

test('keep-within: borg counts back from prune time (1m = 31 days), restic from its newest snapshot in calendar months', () => {
  const snaps = snapsOf(daily('2026-02-01', '2026-03-31', 2));
  const prune = utc('2026-04-10 12:00');
  const opts = { within: { n: 1, unit: 'm' } };
  const b = run.borg(snaps, opts, prune);
  assert.equal(b.withinFrom, prune - 744 * HOUR);                       // 2026-03-10 12:00
  assert.deepEqual([keptList(b, snaps).length, keptList(b, snaps).pop()], [21, '2026-03-11 02:00']);
  const r = run.restic(snaps, opts, prune);
  assert.equal(r.latest, utc('2026-03-31 02:00'));
  assert.equal(r.withinFrom, utc('2026-03-03 02:00'));                  // 03-31 minus one month rolls over Feb 31
  assert.deepEqual([keptList(r, snaps).length, keptList(r, snaps).pop()], [28, '2026-03-04 02:00']);
  assert.equal(run.pbs(snaps, opts).keepAll, true);                    // PBS has no keep-within
  // borg: archives kept by keep-within do not count toward keep-daily; restic: they do
  const both = { within: { n: 2, unit: 'd' }, daily: 3 };
  assert.equal(keptList(run.borg(snaps, both, utc('2026-03-31 12:00')), snaps).length, 5);
  assert.equal(keptList(run.restic(snaps, both, utc('2026-03-31 12:00')), snaps).length, 3);
});

test('keep-last: borg counts one archive per second, restic every snapshot, PBS one per UTC second', () => {
  const snaps = snapsOf([utc('2026-10-27 09:00'), utc('2026-10-27 10:00:00'), utc('2026-10-27 10:00:00.5')]);
  const now = utc('2026-10-27 12:00');
  assert.deepEqual(keptList(run.restic(snaps, { last: 2 }, now), snaps), ['2026-10-27 10:00', '2026-10-27 10:00']);
  assert.deepEqual(keptList(run.borg(snaps, { last: 2 }, now), snaps), ['2026-10-27 10:00', '2026-10-27 09:00']);
  assert.deepEqual(keptList(run.pbs(snaps, { last: 2 }), snaps), ['2026-10-27 10:00', '2026-10-27 09:00']);
  const res = brp.compute(state({ mode: 'p', paste: '2026-10-27 09:00\n2026-10-27 10:00:00\n2026-10-27 10:00:00', end: '2026-10-28T00:00', tz: 'UTC',
    last: '2', daily: '', weekly: '', monthly: '', yearly: '' }), 0);
  assert.ok(res.analysis.notes.some((n) => n.title === 'Backups in the same second'));
});

test('several backups on one day: each tool keeps the newest of the day', () => {
  const times = [];
  for (const d of ['2026-10-25', '2026-10-26', '2026-10-27']) for (const h of ['00', '06', '12', '18']) times.push(utc(d + ' ' + h + ':00'));
  const snaps = snapsOf(times);
  const now = utc('2026-10-28 00:00');
  for (const tool of ['pbs', 'borg', 'restic']) {
    assert.deepEqual(keptList(run[tool](snaps, { daily: 2 }, now), snaps), ['2026-10-27 18:00', '2026-10-26 18:00'], tool);
    assert.equal(keptList(run[tool](snaps, { hourly: 5 }, now), snaps).length, 5, tool);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Prune after every backup versus once
// ─────────────────────────────────────────────────────────────────────────────

test('PBS loses month-end backups when prune runs after every backup', () => {
  const base = { tz: 'Europe/Kyiv', end: '2026-10-27T10:00' };
  const once = brp.compute(state(Object.assign({ runs: 'o' }, base)), 0);
  const each = brp.compute(state(Object.assign({ runs: 'i' }, base)), 0);
  const keptDays = (res, tool) => res.snaps.filter((s) => res.results[tool].marks[s.i].keep).map((s) => s.kDay);
  assert.ok(keptDays(once, 'pbs').includes(20260831));
  assert.ok(!keptDays(each, 'pbs').includes(20260831));
  assert.ok(keptDays(each, 'pbs').includes(20260830));                 // Sunday kept by keep-weekly earlier
  for (const res of [once, each]) assert.ok(keptDays(res, 'borg').includes(20260831));
  assert.deepEqual(keptDays(once, 'borg'), keptDays(each, 'borg'));
  assert.deepEqual(keptDays(once, 'restic'), keptDays(each, 'restic'));
  const note = each.analysis.notes.find((n) => n.title === 'PBS loses month-end backups');
  assert.match(note.html, /removed 6 backups/);
  assert.match(note.html, /Wed 2026-09-30 02:00/);
  const sep30 = each.snaps.find((s) => s.kDay === 20260930);
  assert.equal(each.results.pbs.marks[sep30.i].removedAt, Date.UTC(2026, 9, 9, 23, 0));   // Sat 10-10 02:00 in Kyiv
});

test('borg and restic: a prune after every backup equals one prune after the last backup', () => {
  // The simulator relies on this and replays only PBS; check it on random schedules and rules
  let seed = 20261027;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const zones = ['UTC', 'Europe/Berlin', 'America/New_York', 'Australia/Sydney'];
  for (let it = 0; it < 60; it++) {
    const tz = zones[it % zones.length];
    const opts = {};
    for (const r of brp.RULES) opts[r] = rnd() < 0.45 ? (rnd() < 0.1 ? -1 : 1 + Math.floor(rnd() * 10)) : null;
    if (opts.last === -1) opts.last = 2;
    opts.within = rnd() < 0.3 ? { n: 1 + Math.floor(rnd() * 15), unit: ['h', 'd', 'w', 'm'][Math.floor(rnd() * 4)] } : null;
    if (!brp.RULES.some((r) => opts[r]) && !opts.within) opts.daily = 3;
    const step = [HOUR, 6 * HOUR, DAY, 3 * DAY][it % 4];
    const times = [];
    for (let t = Date.UTC(2025, 0, 1) + Math.floor(rnd() * DAY); times.length < 250; t += Math.floor(step * (0.3 + rnd() * 1.4))) {
      if (rnd() > 0.1) times.push(t);
    }
    for (const tool of ['borg', 'restic']) {
      let alive = [];
      times.forEach((t, i) => {
        alive.push(brp.makeSnap(t, i, tz));
        const r = run[tool](alive, opts, t + 1000, tz);
        alive = alive.filter((s) => r.marks[s.i].keep);
      });
      const snaps = snapsOf(times, tz);
      const once = run[tool](snaps, opts, times[times.length - 1] + 1000, tz);
      assert.deepEqual(alive.map((s) => s.i), snaps.filter((s) => once.marks[s.i].keep).map((s) => s.i), tool + ' ' + it + ' ' + JSON.stringify(opts));
    }
  }
});

test('the PBS replay matches pruning step by step with prunePbs', () => {
  const tz = 'Europe/Berlin';
  const times = [];
  for (let t = Date.UTC(2025, 10, 3, 1); t < Date.UTC(2026, 9, 27); t += 5 * HOUR) times.push(t);
  const snaps = snapsOf(times, tz);
  const opts = { last: 4, hourly: 6, daily: 5, weekly: 4, monthly: 6, yearly: 1 };
  const sim = brp.simulate('pbs', snaps, opts, tz, times[times.length - 1], 'i');
  let alive = [];
  times.forEach((t, i) => {
    alive.push(snaps[i]);
    const r = brp.prunePbs(alive, opts);
    alive = alive.filter((s) => r.marks[s.i].keep);
  });
  assert.deepEqual(snaps.filter((s) => sim.marks[s.i].keep).map((s) => s.i), alive.map((s) => s.i));
});

// ─────────────────────────────────────────────────────────────────────────────
// Time zones and daylight saving time
// ─────────────────────────────────────────────────────────────────────────────

test('time zones: the same instants fall on different days', () => {
  // In Kyiv (UTC+2 after 10-25) 10-25 22:30Z is 10-26 00:30, 10-26 21:30Z is 10-26 23:30
  // and 10-26 22:30Z is 10-27 00:30, so keep-daily 2 keeps different snapshots
  const times = [Date.UTC(2026, 9, 25, 22, 30), Date.UTC(2026, 9, 26, 21, 30), Date.UTC(2026, 9, 26, 22, 30)];
  const now = Date.UTC(2026, 9, 27, 6, 0);
  for (const tool of ['pbs', 'borg', 'restic']) {
    const u = snapsOf(times, 'UTC');
    const k = snapsOf(times, 'Europe/Kyiv');
    assert.deepEqual(keptList(run[tool](u, { daily: 2 }, now, 'UTC'), u), ['2026-10-26 22:30', '2026-10-25 22:30'], tool);
    assert.deepEqual(keptList(run[tool](k, { daily: 2 }, now, 'Europe/Kyiv'), k), ['2026-10-26 22:30', '2026-10-26 21:30'], tool);
  }
  assert.deepEqual([brp.wallOf(times[2], 'Europe/Kyiv').d, brp.wallOf(times[2], 'Europe/Kyiv').h], [27, 0]);
});

test('daylight saving: repeated and skipped hours', () => {
  const tz = 'Europe/Berlin';
  // 2026-10-25: 02:30 happens twice (00:30Z CEST, 01:30Z CET); the earlier one is used
  assert.equal(brp.zonedToUtc(2026, 10, 25, 2, 30, 0, tz), Date.UTC(2026, 9, 25, 0, 30));
  // 2026-03-29: 02:30 does not exist; it moves forward to 03:30 CEST (01:30Z)
  assert.equal(brp.zonedToUtc(2026, 3, 29, 2, 30, 0, tz), Date.UTC(2026, 2, 29, 1, 30));
  assert.equal(brp.zonedToUtc(2026, 7, 1, 12, 0, 0, tz), Date.UTC(2026, 6, 1, 10, 0));
  // Both 02:30 backups on 10-25 share one local hour, so keep-hourly 1 keeps the later one
  const snaps = snapsOf([Date.UTC(2026, 9, 25, 0, 30), Date.UTC(2026, 9, 25, 1, 30)], tz);
  assert.equal(snaps[0].kHour, snaps[1].kHour);
  const now = Date.UTC(2026, 9, 25, 3);
  for (const tool of ['pbs', 'borg', 'restic']) {
    assert.deepEqual(keptList(run[tool](snaps, { hourly: 1 }, now, tz), snaps), ['2026-10-25 01:30'], tool);
  }
  // A daily 02:30 schedule across both changes
  const sch = brp.scheduleTimes({ days: [true, true, true, true, true, true, true], times: [{ h: 2, mi: 30 }] },
    Date.UTC(2026, 2, 27), Date.UTC(2026, 9, 27), tz);
  assert.equal(sch.moved, 1);
  assert.ok(sch.times.includes(Date.UTC(2026, 2, 29, 1, 30)));
  assert.equal(sch.times.filter((t) => brp.wallOf(t, tz).mo === 10 && brp.wallOf(t, tz).d === 25).length, 1);
  // restic keep-within steps back on the wall clock: 2 days before 03-30 10:00 CEST is 03-28 10:00 CET
  assert.equal(brp.resticWithinStart(Date.UTC(2026, 2, 30, 8), { y: 0, m: 0, d: 2, h: 0 }, tz), Date.UTC(2026, 2, 28, 9));
});

// ─────────────────────────────────────────────────────────────────────────────
// Input parsing and validation
// ─────────────────────────────────────────────────────────────────────────────

test('rule values: empty or 0 is off, -1 / unlimited / all is no limit, anything else is an error', () => {
  assert.deepEqual(brp.parseCount(''), { ok: true, value: null });
  assert.deepEqual(brp.parseCount(' 7 '), { ok: true, value: 7 });
  assert.deepEqual(brp.parseCount('0'), { ok: true, value: null, zero: true });
  for (const u of ['-1', 'unlimited', 'ALL', 'Unlimited']) assert.equal(brp.parseCount(u).value, -1, u);
  for (const bad of ['abc', '-2', '1.5', '7d', '1e3', '1000001']) assert.equal(brp.parseCount(bad).ok, false, bad);
  assert.deepEqual(brp.parseWithin('10', 'd'), { ok: true, value: { n: 10, unit: 'd' } });
  assert.equal(brp.parseWithin('0', 'd').value, null);
  for (const bad of ['-1', '1.5', '2d', 'x']) assert.equal(brp.parseWithin(bad, 'd').ok, false, bad);
  const rules = brp.parseRules(state({ last: 'x', daily: '0', within: '3', withinUnit: 'w' }));
  assert.deepEqual(rules.errors.map((e) => e.field), ['last']);
  assert.deepEqual(rules.zeros, ['keep-daily']);
  assert.deepEqual(rules.opts.within, { n: 3, unit: 'w' });
});

test('schedule input: times, every N hours, missed days, period and errors', () => {
  assert.deepEqual(brp.parseTimes('14:00, 2:05 02:05;23:59').value, [{ h: 2, mi: 5 }, { h: 14, mi: 0 }, { h: 23, mi: 59 }]);
  for (const bad of ['', '24:00', '7', '12:60', 'noon']) assert.equal(brp.parseTimes(bad).ok, false, bad);
  assert.deepEqual(brp.everyTimes('6', '01:30').value.map((t) => t.h + ':' + t.mi), ['1:30', '7:30', '13:30', '19:30']);
  assert.equal(brp.everyTimes('5', '00:00').value.length, 5);           // 00, 05, 10, 15, 20 like cron */5
  assert.equal(brp.everyTimes('0', '00:00').ok, false);
  assert.equal(brp.everyTimes('25', '00:00').ok, false);
  assert.equal(brp.everyTimes('4', '9am').field, 'from');
  assert.equal(brp.parseSkip('2026-10-14, 2026-10-15').count, 2);
  assert.equal(brp.parseSkip('2026-02-30').ok, false);
  const e = (patch) => brp.compute(state(Object.assign({ tz: 'UTC', end: '2026-10-27T00:00' }, patch)), 0);
  assert.ok(e({ days: '0000000' }).fields.days);
  assert.ok(e({ span: '21', spanUnit: 'y' }).fields.span);
  assert.ok(e({ span: '0' }).fields.span);
  assert.ok(e({ end: '2026-13-01T00:00' }).fields.end);
  assert.ok(e({ timeMode: 'e', every: '1', span: '3', spanUnit: 'y' }).errors[0].includes('more than 25,000'));
  const skip = e({ span: '1', spanUnit: 'w', skip: '2026-10-22' });
  assert.equal(skip.snaps.length, 6);
  const wk = e({ days: '1111100', span: '2', spanUnit: 'w' });
  assert.equal(wk.snaps.length, 10);
  assert.ok(wk.snaps.every((s) => s.w.dow < 5));
});

test('empty input: no timestamps is an error, not a crash', () => {
  const r = brp.compute(state({ mode: 'p', paste: '', tz: 'UTC' }), Date.UTC(2026, 9, 27));
  assert.equal(r.ok, false);
  assert.ok(r.fields.paste);
  const headers = brp.compute(state({ mode: 'p', paste: 'ID  Time  Host\n------\n0 snapshots', tz: 'UTC' }), Date.UTC(2026, 9, 27));
  assert.equal(headers.ok, false);
});

test('pasted snapshot lists from PBS, borg and restic', () => {
  const tz = 'Europe/Berlin';
  const line = (s) => brp.parseTimestampLine(s, tz);
  assert.equal(line('│ vm/100/2019-12-04T13:20:37Z │ 1 │'), Date.UTC(2019, 11, 4, 13, 20, 37));
  assert.equal(line('host-2025-04-21T11:00:00  Mon, 2025-04-21 11:00:03 [7f3e9a]'), Date.UTC(2025, 3, 21, 9, 0, 3));
  assert.equal(line('60e5c031  2025-04-21 11:00:00  mopped              /home/user/work'), Date.UTC(2025, 3, 21, 9, 0, 0));
  assert.equal(line('2026-10-27T02:00:00+02:00'), Date.UTC(2026, 9, 27, 0, 0));
  assert.equal(line('2026-10-27 02:00:00 -0500'), Date.UTC(2026, 9, 27, 7, 0));
  assert.equal(line('2026-10-27T02:00:00.250Z'), Date.UTC(2026, 9, 27, 2, 0, 0, 250));
  assert.equal(line('2026-10-27 02:00 UTC'), Date.UTC(2026, 9, 27, 2, 0));
  assert.equal(line('no date here'), null);
  assert.equal(line('2026-02-30 10:00'), null);
  const p = brp.parsePaste('repository f00c6e2a opened successfully\nID  Time  Host\n---\n60e5c031  2025-04-21 11:00:00  h\n2025-13-01 10:00\n# comment\n\n1 snapshots', tz);
  assert.deepEqual([p.value.length, p.bad, p.ignored], [1, [5], 4]);
  const r = brp.compute(state({ mode: 'p', paste: '2026-10-25 02:00\n2026-10-26 02:00\n2026-10-30 02:00', end: '2026-10-27T00:00', tz: 'UTC', runs: 'o' }), 0);
  assert.equal(r.snaps.length, 2);
  assert.ok(r.warnings.some((w) => w.startsWith('1 timestamp is later')));
});

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

test('commands for PBS, borg and restic, with dry runs', () => {
  const c = brp.buildCommands({ last: 3, hourly: null, daily: 7, weekly: 4, monthly: 6, yearly: 1, within: null }, brp.defaultState());
  assert.ok(c.pbs.includes('proxmox-backup-client prune vm/100 --dry-run --keep-last 3 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --keep-yearly 1'));
  assert.ok(c.pbs.includes('proxmox-backup-manager prune-job create prune-store1 --store store1 --schedule daily --keep-last 3 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --keep-yearly 1'));
  assert.ok(c.borg.includes('borg prune -v --list --dry-run --keep-last=3 --keep-daily=7 --keep-weekly=4 --keep-monthly=6 --keep-yearly=1 /path/to/repo'));
  assert.ok(c.borg.includes('borg compact /path/to/repo'));
  assert.ok(c.restic.includes('restic -r /srv/restic-repo forget --dry-run --keep-last 3 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --keep-yearly 1'));
  assert.ok(c.restic.includes('forget --keep-last 3 --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --keep-yearly 1 --prune'));

  const names = state({ pbsGroup: 'ct/101', pbsStore: 'backup ssd', pbsSchedule: 'sat 03:00', borgRepo: "/mnt/my repo", resticRepo: "sftp:u@h:/it's" });
  const x = brp.buildCommands({ last: null, hourly: null, daily: -1, weekly: null, monthly: 12, yearly: null, within: { n: 2, unit: 'w' } }, names);
  assert.ok(x.pbs.includes('# keep-within does not exist in Proxmox Backup Server'));
  assert.ok(x.pbs.includes('--keep-daily 99999 --keep-monthly 12'));
  assert.ok(x.pbs.includes("prune-job create prune-backup-ssd --store 'backup ssd' --schedule 'sat 03:00'"));
  assert.ok(x.pbs.includes('proxmox-backup-client prune ct/101 --dry-run'));
  assert.ok(x.borg.includes("--keep-within=2w --keep-daily=-1 --keep-monthly=12 '/mnt/my repo'"));
  assert.ok(x.restic.includes("restic -r 'sftp:u@h:/it'\\''s' forget --dry-run --keep-daily unlimited --keep-monthly 12 --keep-within 14d"));
  const hrs = brp.buildCommands({ within: { n: 36, unit: 'h' } }, brp.defaultState());
  assert.ok(hrs.borg.includes('--keep-within=36H'));
  assert.ok(hrs.restic.includes('--keep-within 36h'));
  assert.match(hrs.pbs, /keeps every snapshot/);
  const months = brp.buildCommands({ within: { n: 1, unit: 'y' } }, brp.defaultState());
  assert.ok(months.borg.includes('--keep-within=1y') && months.restic.includes('--keep-within 1y'));
  assert.equal(brp.shq('/srv/backup'), '/srv/backup');
  assert.equal(brp.shq(''), "''");
});

// ─────────────────────────────────────────────────────────────────────────────
// Whole tool, examples and URL hash
// ─────────────────────────────────────────────────────────────────────────────

test('documented examples load and give the documented results', () => {
  const at = Date.UTC(2026, 9, 27, 8);
  const borg = brp.compute(brp.applyExample(state({ tz: 'UTC' }), 'borg'), at);
  assert.deepEqual([borg.snaps.length, borg.analysis.kept.pbs.length, borg.analysis.kept.borg.length, borg.analysis.kept.restic.length], [364, 20, 21, 19]);
  assert.ok(borg.analysis.notes.some((n) => n.title === 'borg keeps the oldest archive'));
  const restic = brp.compute(brp.applyExample(state({ tz: 'UTC' }), 'restic'), at);
  assert.deepEqual(brp.TOOLS.map((t) => restic.analysis.kept[t].length), [5, 5, 5]);
  assert.equal(restic.analysis.notes[0].title, 'Same result');
  const pbs = brp.compute(brp.applyExample(state({ tz: 'UTC', end: '2026-10-27T03:00' }), 'pbs'), at);
  assert.deepEqual(brp.TOOLS.map((t) => pbs.analysis.kept[t].length), [44, 44, 35]);
});

test('compute: default setup, warnings and notes', () => {
  const r = brp.compute(state({ tz: 'Europe/Kyiv', end: '2026-10-27T10:00' }), 0);
  assert.equal(r.ok, true);
  assert.equal(r.snaps.length, 365);
  assert.deepEqual(brp.TOOLS.map((t) => r.analysis.kept[t].length), [21, 21, 14]);
  assert.ok(r.analysis.notes.some((n) => n.title === 'Rules that overlap'));
  assert.ok(r.analysis.notes.some((n) => n.title === 'ISO weeks at New Year'));
  const bad = brp.compute(state({ tz: 'Mars/Olympus' }), Date.UTC(2026, 9, 27));
  assert.ok(bad.warnings[0].includes('Mars/Olympus'));
  const within = brp.compute(state({ tz: 'UTC', end: '2026-10-27T10:00', within: '1', withinUnit: 'm', last: '', daily: '', weekly: '', monthly: '', yearly: '' }), 0);
  const note = within.analysis.notes.find((n) => n.title === 'keep-within');
  assert.match(note.html, /1 month = 744 hours/);
  assert.match(note.html, /keeps every snapshot/);
  const unl = brp.compute(state({ tz: 'UTC', end: '2026-10-27T10:00', monthly: 'unlimited' }), 0);
  assert.ok(unl.analysis.notes.some((n) => n.title === 'No limit'));
});

test('URL hash round trip keeps every field as typed', () => {
  const s = brp.defaultState();
  assert.deepEqual(brp.decodeHash(brp.encodeHash(s)), s);
  const rich = state({
    mode: 'p', days: '1010100', timeMode: 'e', at: '01:00, 13:00', every: '4', from: '00:15', span: '18', spanUnit: 'm',
    skip: '2026-01-01', end: '2026-10-27T03:45', tz: 'America/New_York', runs: 'o', last: 'unlimited', hourly: '24',
    daily: '0', weekly: 'x & y', monthly: '-1', yearly: '', within: '3', withinUnit: 'y',
    pbsGroup: 'ct/101', pbsStore: 'fast ssd', pbsSchedule: 'sat 03:00', borgRepo: 'ssh://u@h/./r', resticRepo: 's3:host/bucket',
    paste: '2026-10-27 02:00 "quoted" <tag>\n2026-10-26T02:00:00+02:00'
  });
  const h = brp.encodeHash(rich);
  assert.ok(h.startsWith('#v=1&'));
  assert.doesNotMatch(h, /[ "<>\n]/);
  assert.deepEqual(brp.decodeHash(h), rich);
  // the pasted list is left out in schedule mode and when it is too long for a link
  assert.equal(brp.decodeHash(brp.encodeHash(state({ paste: 'x' }))).paste, '');
  assert.equal(brp.decodeHash(brp.encodeHash(state({ mode: 'p', paste: 'x'.repeat(brp.MAX_HASH_PASTE + 1) }))).paste, '');
});

test('hash decoding: anchors are not state, junk falls back to defaults', () => {
  assert.equal(brp.isStateHash('#how-to-use-it'), false);
  assert.deepEqual(brp.decodeHash('#how-to-use-it'), brp.defaultState());
  assert.deepEqual(brp.decodeHash(''), brp.defaultState());
  const junk = brp.decodeHash('#v=1&m=q&wd=12&tm=z&su=x&rn=q&wu=s&en=yesterday&kd=%E0%A4%A&zz=1&kl=' + '9'.repeat(40));
  const d = brp.defaultState();
  assert.deepEqual([junk.mode, junk.days, junk.timeMode, junk.spanUnit, junk.runs, junk.withinUnit, junk.end, junk.daily],
    [d.mode, d.days, d.timeMode, d.spanUnit, d.runs, d.withinUnit, 'now', d.daily]);
  assert.equal(junk.last.length, 12);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source hygiene: the files go inside a WordPress block comment
// ─────────────────────────────────────────────────────────────────────────────

test('tool sources contain no comment delimiters, closing script tags or unicode escapes', () => {
  const dir = path.join(__dirname, '..', 'backup-retention-prune-simulator');
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
