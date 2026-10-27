/* Backup Retention (Prune) Simulator — script.js
   Prefix: brp-
   No dependencies.

   Each engine is a port of the tool's own source code, read for these releases:
     Proxmox Backup Server 4.2.8 (git tag v4.2.8, git.proxmox.com proxmox-backup.git)
       pbs-datastore/src/prune.rs        compute_prune_info(), mark_selections()
       pbs-datastore/src/backup_info.rs  sort_list(): newest snapshot first
       src/server/prune_job.rs,
       src/api2/admin/datastore.rs       no keep option set: keep every snapshot
       pbs-api-types 1.0.20              KeepOptions, PRUNE_SCHEMA_KEEP_* (minimum 1)
       docs/maintenance.rst, docs/backup-client.rst, docs/prune-simulator/
     BorgBackup 1.4.5 (git tag 1.4.5, github.com/borgbackup/borg)
       src/borg/archiver.py              do_prune(), prune options and help text
       src/borg/helpers/misc.py          prune_within(), prune_split(), PRUNING_PATTERNS
       src/borg/helpers/parseformat.py   interval(): H, d, w, m = 31 days, y = 365 days
       docs/misc/prune-example.txt
     restic 0.19.1 (git tag v0.19.1, github.com/restic/restic)
       internal/data/snapshot_policy.go  ApplyPolicy() and its bucket functions
       internal/data/duration.go         durations in y, m, d and h
       cmd/restic/cmd_forget.go          flags, "unlimited", refusal of an empty policy
       doc/060_forget.rst
   Left out on purpose: protected snapshots, unfinished backups and checkpoints,
   borg --keep-minutely/--keep-secondly/--keep-13weekly/--keep-3monthly, restic
   --keep-tag and --keep-within-hourly/daily/weekly/monthly/yearly. */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Limits and constants ──────────────────────────────────

  var DAY_MS = 86400000;
  var HOUR_MS = 3600000;
  var SLOT_MS = 6 * HOUR_MS;
  var MAX_SNAPSHOTS = 25000;
  var MAX_PASTE_LINES = 25000;
  var MAX_COUNT = 1000000;
  var MAX_WITHIN = 100000;
  var MAX_TIMES = 96;
  var MAX_SKIP = 366;
  var MAX_HASH_PASTE = 3000;
  var REPLAY_BUDGET = 3000000;     // snapshots looked at while replaying every PBS prune run
  var REPLAY_MAX_KEPT = 1500;      // snapshots kept at one time during that replay
  var TABLE_PAGE = 300;
  var MAX_MONTHS = 120;
  var PBS_UNLIMITED = 99999;       // PBS keep options have a minimum of 1 and no maximum
  var SPAN_MAX = { d: 7305, w: 1044, m: 240, y: 20 };
  var TEXT_MAX = { at: 600, every: 4, from: 8, span: 6, skip: 4000, end: 19, tz: 64, paste: 2000000,
    last: 12, hourly: 12, daily: 12, weekly: 12, monthly: 12, yearly: 12, within: 8,
    pbsGroup: 120, pbsStore: 64, pbsSchedule: 64, borgRepo: 200, resticRepo: 200 };

  var RULES = ['last', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'];
  var TOOLS = ['pbs', 'borg', 'restic'];
  var TOOL_NAMES = { pbs: 'Proxmox Backup Server', borg: 'borg prune', restic: 'restic forget' };
  var TOOL_SHORT = { pbs: 'PBS', borg: 'borg', restic: 'restic' };
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  var UNIT_WORDS = { h: ['hour', 'hours'], d: ['day', 'days'], w: ['week', 'weeks'], m: ['month', 'months'], y: ['year', 'years'] };

  // Bucket keys per tool. PBS keep-last compares the UTC time string (one per second);
  // borg's --keep-last is --keep-secondly in local time; restic counts every snapshot.
  var PBS_KEYS = { last: 'kUtcSec', hourly: 'kHour', daily: 'kDay', weekly: 'kWeek', monthly: 'kMonth', yearly: 'kYear' };
  var BORG_KEYS = { last: 'kSec', hourly: 'kHour', daily: 'kDay', weekly: 'kWeek', monthly: 'kMonth', yearly: 'kYear' };
  var RESTIC_KEYS = { hourly: 'kHour', daily: 'kDay', weekly: 'kWeek', monthly: 'kMonth', yearly: 'kYear' };
  var BORG_WITHIN_HOURS = { h: 1, d: 24, w: 168, m: 744, y: 8760 };   // parseformat.py interval()
  var BORG_WITHIN_SUFFIX = { h: 'H', d: 'd', w: 'w', m: 'm', y: 'y' };

  // ── Time zones ────────────────────────────────────────────

  var dtfCache = {};
  var offCache = {};
  var offCacheSize = 0;

  function browserZone() {
    try {
      var z = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return z || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  }

  function validZone(tz) {
    if (!tz || typeof tz !== 'string') return false;
    if (tz === 'UTC') return true;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
      return true;
    } catch (e) {
      return false;
    }
  }

  function zoneList() {
    var list = [];
    try {
      if (typeof Intl.supportedValuesOf === 'function') list = Intl.supportedValuesOf('timeZone').slice();
    } catch (e) {
      list = [];
    }
    if (!list.length) {
      list = ['Europe/London', 'Europe/Berlin', 'Europe/Kyiv', 'America/New_York', 'America/Chicago',
        'America/Denver', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney'];
    }
    return list.filter(function (z) { return z !== 'UTC'; });
  }

  function getDtf(tz) {
    var f = dtfCache[tz];
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', era: 'short', year: 'numeric', month: 'numeric',
        day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
      });
      dtfCache[tz] = f;
    }
    return f;
  }

  function floorSec(ms) {
    return ms - (((ms % 1000) + 1000) % 1000);
  }

  // Offset of tz at an instant, in ms (local wall clock minus UTC)
  function rawOffset(ms, tz) {
    if (tz === 'UTC') return 0;
    var parts = getDtf(tz).formatToParts(new Date(ms));
    var v = {};
    for (var i = 0; i < parts.length; i++) v[parts[i].type] = parts[i].value;
    var h = Number(v.hour);
    if (h === 24) h = 0;
    var y = Number(v.year);
    if (v.era && /^B/i.test(v.era)) y = 1 - y;
    var wall = Date.UTC(y, Number(v.month) - 1, Number(v.day), h, Number(v.minute), Number(v.second));
    return wall - floorSec(ms);
  }

  // Cached per 6-hour slot: if the offset is the same at both ends of the slot,
  // no daylight saving change happens inside it.
  function offsetAt(ms, tz) {
    if (tz === 'UTC') return 0;
    var cache = offCache[tz];
    if (!cache) cache = offCache[tz] = {};
    var slot = Math.floor(ms / SLOT_MS);
    var c = cache[slot];
    if (c === undefined) {
      if (offCacheSize > 200000) {
        offCache = {};
        offCacheSize = 0;
        cache = offCache[tz] = {};
      }
      var a = rawOffset(slot * SLOT_MS, tz);
      var b = rawOffset(slot * SLOT_MS + SLOT_MS - 1000, tz);
      c = a === b ? a : null;
      cache[slot] = c;
      offCacheSize++;
    }
    return c === null ? rawOffset(ms, tz) : c;
  }

  function wallOf(ms, tz) {
    var off = offsetAt(ms, tz);
    var d = new Date(ms + off);
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds(),
      dow: (d.getUTCDay() + 6) % 7, off: off
    };
  }

  // Wall-clock time in tz to an instant. Out-of-range fields roll over the way
  // Date.UTC (and Go's time.Date) does. A time that exists twice (clocks set back)
  // gives the earlier instant; a time that does not exist (clocks set forward)
  // moves forward by the size of the gap, as JavaScript dates do.
  function zonedToUtc(y, mo, d, h, mi, s, tz) {
    var guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
    if (tz === 'UTC') return guess;
    var offA = offsetAt(guess - DAY_MS, tz);
    var cands = [offA, offsetAt(guess + DAY_MS, tz), offsetAt(guess, tz)];
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var t = guess - cands[i];
      if (offsetAt(t, tz) === cands[i] && (best === null || t < best)) best = t;
    }
    return best === null ? guess - offA : best;
  }

  // ISO 8601 week: weeks start on Monday, and a week belongs to the year of its Thursday
  // (strftime %G/%V in PBS and borg, time.ISOWeek() in restic).
  function isoWeek(y, mo, d) {
    var t = Date.UTC(y, mo - 1, d);
    var dow = (new Date(t).getUTCDay() + 6) % 7;
    var thu = t + (3 - dow) * DAY_MS;
    var ty = new Date(thu).getUTCFullYear();
    var week = 1 + Math.floor((thu - Date.UTC(ty, 0, 1)) / (7 * DAY_MS));
    return { year: ty, week: week };
  }

  function makeSnap(ms, i, tz) {
    var w = wallOf(ms, tz);
    var iw = isoWeek(w.y, w.mo, w.d);
    var day = w.y * 10000 + w.mo * 100 + w.d;
    return {
      t: ms, i: i, w: w, isoYear: iw.year, isoWeek: iw.week,
      kUtcSec: Math.floor(ms / 1000),
      kSec: day * 1000000 + w.h * 10000 + w.mi * 100 + w.s,
      kHour: day * 100 + w.h,
      kDay: day,
      kWeek: iw.year * 100 + iw.week,
      kMonth: w.y * 100 + w.mo,
      kYear: w.y
    };
  }

  function sortNewest(list) {
    return list.slice().sort(function (a, b) { return b.t - a.t || a.i - b.i; });
  }

  // ── Engine: Proxmox Backup Server ─────────────────────────
  // mark_selections(): a period that already holds a snapshot kept by an earlier
  // option is skipped without counting; a snapshot that an earlier option marked
  // for removal is never looked at again. The list is newest first, so every
  // period is one run of neighbouring snapshots: "already included in this
  // option" is the same as "equal to the period this option included last".
  // Marks live in typed arrays by list position, because the replay of a prune
  // after every backup runs this thousands of times.

  var MARK_NONE = 0, MARK_KEEP = 1, MARK_REMOVE = 2;

  function pbsMarkSelections(list, type, ruleOf, nOf, keep, key, ruleIdx) {
    var already = new Set();
    var i, id;
    for (i = 0; i < list.length; i++) {
      if (type[i] === MARK_KEEP) already.add(list[i][key]);
    }
    var includeLen = 0;
    var lastIncluded = null;
    for (i = 0; i < list.length; i++) {
      id = list[i][key];
      if (type[i] !== MARK_NONE) continue;
      if (already.has(id)) continue;
      if (id !== lastIncluded) {
        if (includeLen >= keep) break;
        lastIncluded = id;
        includeLen++;
        type[i] = MARK_KEEP;
        ruleOf[i] = ruleIdx;
        nOf[i] = includeLen;
      } else {
        type[i] = MARK_REMOVE;
        ruleOf[i] = ruleIdx;
      }
    }
  }

  function pbsAnything(opts) {
    for (var r = 0; r < RULES.length; r++) if (opts[RULES[r]]) return true;
    return false;
  }

  // Marks by list position; the caller has checked that some option is set
  function pbsCore(list, opts) {
    var n = list.length;
    var type = new Uint8Array(n);
    var ruleOf = new Uint8Array(n);
    var nOf = new Uint32Array(n);
    for (var r = 0; r < RULES.length; r++) {
      var k = opts[RULES[r]];
      if (!k) continue;
      pbsMarkSelections(list, type, ruleOf, nOf, k < 0 ? Infinity : k, PBS_KEYS[RULES[r]], r);
    }
    return { type: type, ruleOf: ruleOf, nOf: nOf };
  }

  function pbsRun(list, opts) {
    var out = { marks: {}, keepAll: false, refused: false };
    var i;
    if (!pbsAnything(opts)) {
      out.keepAll = true;
      for (i = 0; i < list.length; i++) out.marks[list[i].i] = { keep: true, tags: [{ rule: 'all' }] };
      return out;
    }
    var c = pbsCore(list, opts);
    for (i = 0; i < list.length; i++) out.marks[list[i].i] = pbsMark(c, i);
    return out;
  }

  // "by" names the option that marked a removed snapshot (none: no option wanted it)
  function pbsMark(c, i) {
    if (c.type[i] === MARK_KEEP) return { keep: true, tags: [{ rule: RULES[c.ruleOf[i]], n: c.nOf[i] }] };
    return c.type[i] === MARK_REMOVE ? { keep: false, tags: [], by: RULES[c.ruleOf[i]] } : { keep: false, tags: [] };
  }

  function prunePbs(snaps, opts) {
    return pbsRun(sortNewest(snaps), opts);
  }

  // ── Engine: borg prune ────────────────────────────────────
  // keep-within first, then secondly (= keep-last), hourly, daily, weekly, monthly,
  // yearly. A period whose newest archive is already kept is used up without counting.
  // A rule that cannot reach its count keeps the oldest archive ("[oldest]").

  function borgAnything(opts) {
    return !!opts.within || pbsAnything(opts);
  }

  function borgPruneSplit(list, rule, n, kept) {
    var last = null;
    var keepLen = 0;
    var a = null;
    var key = BORG_KEYS[rule];
    if (n === 0) return;
    for (var i = 0; i < list.length; i++) {
      a = list[i];
      var period = a[key];
      if (period !== last) {
        last = period;
        if (!kept[a.i]) {
          keepLen++;
          kept[a.i] = { rule: rule, n: keepLen };
          if (keepLen === n) break;
        }
      }
    }
    if (a !== null && keepLen < n && !kept[a.i]) {
      keepLen++;
      kept[a.i] = { rule: rule, n: keepLen, oldest: true };
    }
  }

  function borgRun(list, opts, pruneMs) {
    var out = { marks: {}, keepAll: false, refused: false };
    var i;
    if (!borgAnything(opts)) {
      out.refused = true;
      for (i = 0; i < list.length; i++) out.marks[list[i].i] = { keep: true, tags: [{ rule: 'refused' }] };
      return out;
    }
    var kept = {};
    if (opts.within) {
      var target = pruneMs - opts.within.n * BORG_WITHIN_HOURS[opts.within.unit] * HOUR_MS;
      var counter = 0;
      out.withinFrom = target;
      for (i = 0; i < list.length; i++) {
        if (list[i].t > target) {
          counter++;
          kept[list[i].i] = { rule: 'within', n: counter };
        }
      }
    }
    for (var r = 0; r < RULES.length; r++) {
      var n = opts[RULES[r]];
      if (n) borgPruneSplit(list, RULES[r], n, kept);
    }
    for (i = 0; i < list.length; i++) {
      var k = kept[list[i].i];
      out.marks[list[i].i] = k ? { keep: true, tags: [k] } : { keep: false, tags: [] };
    }
    return out;
  }

  function pruneBorg(snaps, opts, pruneMs) {
    return borgRun(sortNewest(snaps), opts, pruneMs);
  }

  // ── Engine: restic forget ─────────────────────────────────
  // ApplyPolicy(): every rule looks at every snapshot on its own (results are ORed),
  // keep-within counts back from the newest snapshot that is not in the future, and a
  // rule with counts left (or unlimited) also keeps the oldest snapshot.

  // The form takes one unit; restic itself also accepts combined durations such
  // as 1y2m3d4h, which within.dur carries (used by the tests with restic's own data).
  function resticDuration(within) {
    var d = { y: 0, m: 0, d: 0, h: 0 };
    if (!within) return d;
    if (within.dur) return { y: within.dur.y || 0, m: within.dur.m || 0, d: within.dur.d || 0, h: within.dur.h || 0 };
    if (within.unit === 'h') d.h = within.n;
    else if (within.unit === 'd') d.d = within.n;
    else if (within.unit === 'w') d.d = within.n * 7;    // restic has no week unit
    else if (within.unit === 'm') d.m = within.n;
    else if (within.unit === 'y') d.y = within.n;
    return d;
  }

  function resticDurationString(d) {
    var s = '';
    if (d.y) s += d.y + 'y';
    if (d.m) s += d.m + 'm';
    if (d.d) s += d.d + 'd';
    if (d.h) s += d.h + 'h';
    return s;
  }

  // latest.AddDate(-years, -months, -days).Add(-hours)
  function resticWithinStart(latestMs, dur, tz) {
    var w = wallOf(latestMs, tz);
    var t = zonedToUtc(w.y - dur.y, w.mo - dur.m, w.d - dur.d, w.h, w.mi, w.s, tz) + w.ms;
    return t - dur.h * HOUR_MS;
  }

  function resticRun(list, opts, pruneMs, tz) {
    var out = { marks: {}, keepAll: false, refused: false };
    if (!borgAnything(opts)) {
      out.refused = true;
      for (var j = 0; j < list.length; j++) out.marks[list[j].i] = { keep: true, tags: [{ rule: 'refused' }] };
      return out;
    }
    if (!list.length) return out;
    var buckets = RULES.map(function (r) { return { rule: r, count: opts[r] || 0, last: -1, kept: 0 }; });
    var latest = null;
    for (var k = 0; k < list.length; k++) {
      if ((latest === null || list[k].t > latest) && list[k].t < pruneMs) latest = list[k].t;
    }
    var withinFrom = null;
    var withinLabel = '';
    if (opts.within) {
      var dur = resticDuration(opts.within);
      withinLabel = resticDurationString(dur);
      withinFrom = latest === null ? -Infinity : resticWithinStart(latest, dur, tz);
      out.withinFrom = withinFrom;
      out.latest = latest;
    }
    var lastNr = list.length - 1;
    for (var nr = 0; nr < list.length; nr++) {
      var cur = list[nr];
      var tags = [];
      if (withinFrom !== null && cur.t > withinFrom) tags.push({ rule: 'within', label: withinLabel });
      for (var b = 0; b < buckets.length; b++) {
        var bk = buckets[b];
        if (bk.count > 0 || bk.count === -1) {
          var val = bk.rule === 'last' ? nr : cur[RESTIC_KEYS[bk.rule]];
          if (val !== bk.last || nr === lastNr) {
            var tag = { rule: bk.rule, n: bk.kept + 1 };
            if (val === bk.last && nr === lastNr) tag.oldest = true;
            bk.last = val;
            if (bk.count > 0) bk.count--;
            bk.kept++;
            tags.push(tag);
          }
        }
      }
      out.marks[cur.i] = { keep: tags.length > 0, tags: tags };
    }
    return out;
  }

  function pruneRestic(snaps, opts, pruneMs, tz) {
    return resticRun(sortNewest(snaps), opts, pruneMs, tz);
  }

  // ── Running prune once or after every backup ──────────────

  function runOnce(tool, sorted, opts, pruneMs, tz) {
    if (tool === 'pbs') return pbsRun(sorted, opts);
    if (tool === 'borg') return borgRun(sorted, opts, pruneMs);
    return resticRun(sorted, opts, pruneMs, tz);
  }

  // snaps: ascending by time. Prune runs one second after the moment it is due:
  // right after each backup ("i") or right after the end of the period ("o").
  // Only PBS is replayed run by run. For borg and restic a prune after every backup
  // ends with the same snapshots as one prune right after the last backup: their
  // periods only move forward in time, and a snapshot removed early would also be
  // removed later. The tests check this on random schedules and rules; PBS breaks
  // it because a snapshot one option marked for removal is hidden from later options.
  function simulate(tool, snaps, opts, tz, endMs, runs) {
    var sortedAll = sortNewest(snaps);
    var single = function (atMs, mode) {
      var r = runOnce(tool, sortedAll, opts, atMs + 1000, tz);
      r.mode = mode;
      return r;
    };
    if (runs === 'i' && tool !== 'pbs' && snaps.length) return single(snaps[snaps.length - 1].t, 'i');
    if (runs !== 'i' || !pbsAnything(opts) || !snaps.length) {
      var once = single(endMs, 'o');
      if (runs === 'i' && snaps.length) once.mode = 'i';
      return once;
    }

    var alive = [];
    var removed = {};
    var work = 0;
    var lastAlive = [];
    var lastCore = null;
    for (var k = 0; k < snaps.length; k++) {
      // newest first; a snapshot with the same time as older ones goes after them
      var pos = 0;
      while (pos < alive.length && alive[pos].t === snaps[k].t) pos++;
      alive.splice(pos, 0, snaps[k]);
      var c = pbsCore(alive, opts);
      var next = [];
      for (var j = 0; j < alive.length; j++) {
        if (c.type[j] === MARK_KEEP) next.push(alive[j]);
        else {
          var gone = pbsMark(c, j);
          gone.removedAt = snaps[k].t;
          removed[alive[j].i] = gone;
        }
      }
      lastAlive = alive;
      lastCore = c;
      alive = next;
      work += alive.length + 1;
      if (work > REPLAY_BUDGET || alive.length > REPLAY_MAX_KEPT) {
        var fb = single(endMs, 'o');
        fb.replayTooBig = true;
        return fb;
      }
    }
    var out = { marks: removed, keepAll: false, refused: false, mode: 'i', runCount: snaps.length };
    for (var p = 0; p < lastAlive.length; p++) {
      if (lastCore.type[p] === MARK_KEEP) out.marks[lastAlive[p].i] = pbsMark(lastCore, p);
    }
    return out;
  }

  // ── Input parsing ─────────────────────────────────────────

  function pad(n, w) {
    var s = String(n);
    while (s.length < (w || 2)) s = '0' + s;
    return s;
  }

  // '' = rule off; whole number; -1, "unlimited" or "all" = no limit
  function parseCount(raw) {
    var s = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
    if (s === '') return { ok: true, value: null };
    if (s === '-1' || s === 'unlimited' || s === 'all') return { ok: true, value: -1 };
    if (!/^\d+$/.test(s)) return { ok: false, error: 'enter a whole number, or -1 (also "unlimited") for no limit' };
    var n = Number(s);
    if (n > MAX_COUNT) return { ok: false, error: 'enter at most ' + MAX_COUNT };
    if (n === 0) return { ok: true, value: null, zero: true };
    return { ok: true, value: n };
  }

  function parseWithin(raw, unit) {
    var s = String(raw === undefined || raw === null ? '' : raw).trim();
    if (s === '') return { ok: true, value: null };
    if (!/^\d+$/.test(s)) return { ok: false, error: 'enter a whole number of ' + UNIT_WORDS[unit][1] };
    var n = Number(s);
    if (n === 0) return { ok: true, value: null, zero: true };
    if (n > MAX_WITHIN) return { ok: false, error: 'enter at most ' + MAX_WITHIN };
    return { ok: true, value: { n: n, unit: unit } };
  }

  function parseClock(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
    if (!m) return null;
    var h = Number(m[1]);
    var mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return { h: h, mi: mi };
  }

  function parseTimes(raw) {
    var parts = String(raw || '').split(/[\s,;]+/).filter(function (p) { return p !== ''; });
    if (!parts.length) return { ok: false, error: 'enter at least one time such as 02:00' };
    var seen = {};
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var c = parseClock(parts[i]);
      if (!c) return { ok: false, error: '"' + parts[i] + '" is not a time; use HH:MM, for example 02:00 or 14:30' };
      var key = c.h * 60 + c.mi;
      if (!seen[key]) {
        seen[key] = true;
        out.push(c);
      }
    }
    if (out.length > MAX_TIMES) return { ok: false, error: 'enter at most ' + MAX_TIMES + ' times' };
    out.sort(function (a, b) { return a.h * 60 + a.mi - (b.h * 60 + b.mi); });
    return { ok: true, value: out };
  }

  function everyTimes(everyRaw, fromRaw) {
    var s = String(everyRaw || '').trim();
    if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > 24) {
      return { ok: false, field: 'every', error: 'enter a whole number of hours from 1 to 24' };
    }
    var from = parseClock(fromRaw);
    if (!from) return { ok: false, field: 'from', error: 'enter the first backup time as HH:MM, for example 00:00' };
    var n = Number(s);
    var out = [];
    for (var m = from.h * 60 + from.mi; m < 1440; m += n * 60) out.push({ h: Math.floor(m / 60), mi: m % 60 });
    return { ok: true, value: out };
  }

  function validDate(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }

  function parseSkip(raw) {
    var parts = String(raw || '').split(/[\s,;]+/).filter(function (p) { return p !== ''; });
    var out = {};
    var count = 0;
    for (var i = 0; i < parts.length; i++) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parts[i]);
      if (!m || !validDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
        return { ok: false, error: '"' + parts[i] + '" is not a date; use YYYY-MM-DD, for example 2026-10-14' };
      }
      var key = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
      if (!out[key]) {
        out[key] = true;
        count++;
      }
    }
    if (count > MAX_SKIP) return { ok: false, error: 'enter at most ' + MAX_SKIP + ' dates' };
    return { ok: true, value: out, count: count };
  }

  function parseLocalDateTime(raw) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(raw || '').trim());
    if (!m) return null;
    var p = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4]), mi: Number(m[5]), s: m[6] ? Number(m[6]) : 0 };
    if (!validDate(p.y, p.mo, p.d) || p.h > 23 || p.mi > 59 || p.s > 59 || p.y < 1971) return null;
    return p;
  }

  // The last date and time on a line: plain ISO 8601, PBS snapshot names
  // (vm/100/2026-10-27T02:00:00Z), borg list (Tue, 2026-10-27 02:00:03 [id]) and
  // restic snapshots (ID  2026-10-27 02:00:00  host ...).
  var TS_RE = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?:\s?(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?))?(?![\d:])/gi;

  function parseTimestampLine(line, tz) {
    TS_RE.lastIndex = 0;
    var m, last = null;
    while ((m = TS_RE.exec(line)) !== null) last = m;
    if (!last) return null;
    var y = Number(last[1]), mo = Number(last[2]), d = Number(last[3]);
    var h = Number(last[4]), mi = Number(last[5]), s = last[6] ? Number(last[6]) : 0;
    var ms = last[7] ? Number((last[7] + '00').slice(0, 3)) : 0;
    if (!validDate(y, mo, d) || h > 23 || mi > 59 || s > 59 || y < 1971) return null;
    var zone = last[8] ? last[8].toUpperCase() : '';
    if (zone === 'Z' || zone === 'UTC' || zone === 'GMT') return Date.UTC(y, mo - 1, d, h, mi, s) + ms;
    if (zone) {
      var om = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
      var oh = Number(om[2]), omi = om[3] ? Number(om[3]) : 0;
      if (oh > 14 || omi > 59) return null;
      var sign = om[1] === '-' ? -1 : 1;
      return Date.UTC(y, mo - 1, d, h, mi, s) + ms - sign * (oh * 60 + omi) * 60000;
    }
    return zonedToUtc(y, mo, d, h, mi, s, tz) + ms;
  }

  // Lines without anything that looks like a date (table borders, headers, totals)
  // are ignored; lines with a date that cannot be read are reported.
  function parsePaste(text, tz) {
    var lines = String(text || '').split(/\r?\n/);
    var times = [];
    var bad = [];
    var ignored = 0;
    var used = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line === '' || line.charAt(0) === '#') continue;
      used++;
      if (used > MAX_PASTE_LINES) return { ok: false, error: 'paste at most ' + MAX_PASTE_LINES + ' lines' };
      var t = parseTimestampLine(line, tz);
      if (t !== null) times.push(t);
      else if (/\d{4}-\d{1,2}-\d{1,2}/.test(line)) bad.push(i + 1);
      else ignored++;
    }
    return { ok: true, value: times, bad: bad, ignored: ignored };
  }

  function spanStart(endMs, n, unit, tz) {
    var w = wallOf(endMs, tz);
    var t;
    if (unit === 'd') t = zonedToUtc(w.y, w.mo, w.d - n, w.h, w.mi, w.s, tz);
    else if (unit === 'w') t = zonedToUtc(w.y, w.mo, w.d - 7 * n, w.h, w.mi, w.s, tz);
    else if (unit === 'm') t = zonedToUtc(w.y, w.mo - n, w.d, w.h, w.mi, w.s, tz);
    else t = zonedToUtc(w.y - n, w.mo, w.d, w.h, w.mi, w.s, tz);
    return t + w.ms;
  }

  // Backups in (startMs, endMs] on the chosen weekdays (Monday = 0) at the given local times
  function scheduleTimes(cfg, startMs, endMs, tz) {
    var sw = wallOf(startMs, tz);
    var ew = wallOf(endMs, tz);
    var day = Date.UTC(sw.y, sw.mo - 1, sw.d);
    var lastDay = Date.UTC(ew.y, ew.mo - 1, ew.d);
    var out = [];
    var moved = 0;
    var seen = {};
    for (; day <= lastDay; day += DAY_MS) {
      var dd = new Date(day);
      var y = dd.getUTCFullYear(), mo = dd.getUTCMonth() + 1, d = dd.getUTCDate();
      if (!cfg.days[(dd.getUTCDay() + 6) % 7]) continue;
      if (cfg.skip && cfg.skip[y * 10000 + mo * 100 + d]) continue;
      for (var k = 0; k < cfg.times.length; k++) {
        var tm = cfg.times[k];
        var t = zonedToUtc(y, mo, d, tm.h, tm.mi, 0, tz);
        if (t <= startMs || t > endMs || seen[t]) continue;
        var w = wallOf(t, tz);
        if (w.h !== tm.h || w.mi !== tm.mi) moved++;
        seen[t] = true;
        out.push(t);
        if (out.length > MAX_SNAPSHOTS) return { overflow: true, times: out, moved: moved };
      }
    }
    out.sort(function (a, b) { return a - b; });
    return { overflow: false, times: out, moved: moved };
  }

  function parseRules(state) {
    var opts = {};
    var errors = [];
    var zeros = [];
    RULES.forEach(function (r) {
      var p = parseCount(state[r]);
      if (!p.ok) errors.push({ field: r, text: 'keep-' + r + ': ' + p.error + '.' });
      else {
        opts[r] = p.value;
        if (p.zero) zeros.push('keep-' + r);
      }
    });
    var unit = UNIT_WORDS[state.withinUnit] ? state.withinUnit : 'd';
    var w = parseWithin(state.within, unit);
    if (!w.ok) errors.push({ field: 'within', text: 'keep-within: ' + w.error + '.' });
    else {
      opts.within = w.value;
      if (w.zero) zeros.push('keep-within');
    }
    return { opts: opts, errors: errors, zeros: zeros };
  }

  // ── Compute ───────────────────────────────────────────────

  function compute(state, nowMs) {
    var res = { errors: [], warnings: [], infos: [], fields: {}, ok: false };
    var err = function (field, text) {
      res.errors.push(text);
      if (field) res.fields[field] = true;
    };
    var tz = state.tz ? state.tz : browserZone();
    if (!validZone(tz)) {
      res.warnings.push('The time zone "' + state.tz + '" is not known to this browser, so ' + browserZone() + ' is used instead. Pick a zone from the list.');
      tz = browserZone();
    }
    res.tz = tz;

    var rules = parseRules(state);
    rules.errors.forEach(function (e) { err(e.field, e.text); });
    res.opts = rules.opts;
    res.zeros = rules.zeros;

    var endMs;
    if (state.end === 'now' || !state.end) {
      endMs = Math.floor(nowMs / 60000) * 60000;
      res.endIsNow = true;
    } else {
      var p = parseLocalDateTime(state.end);
      if (!p) err('end', 'Simulate until: enter a date and time from 1971 on.');
      else endMs = zonedToUtc(p.y, p.mo, p.d, p.h, p.mi, p.s, tz);
    }
    res.endMs = endMs;

    var times = [];
    if (state.mode === 'p') {
      var pp = parsePaste(state.paste, tz);
      if (!pp.ok) err('paste', 'Pasted timestamps: ' + pp.error + '.');
      else {
        if (pp.bad.length) {
          res.warnings.push(pp.bad.length + (pp.bad.length === 1 ? ' line has' : ' lines have') +
            ' no date and time the tool can read and ' + (pp.bad.length === 1 ? 'was' : 'were') + ' skipped (line ' +
            pp.bad.slice(0, 5).join(', ') + (pp.bad.length > 5 ? ', …' : '') +
            '). Each line needs a timestamp such as 2026-10-27 02:00 or 2026-10-27T02:00:00Z.');
        }
        times = pp.value;
        if (pp.ignored) {
          res.infos.push(plural(pp.ignored, 'line', 'lines') + ' without a date (headers, borders or totals) ' + (pp.ignored === 1 ? 'was' : 'were') + ' ignored.');
        }
        if (endMs !== undefined) {
          var later = times.filter(function (t) { return t > endMs; }).length;
          if (later) {
            res.warnings.push(later + (later === 1 ? ' timestamp is' : ' timestamps are') +
              ' later than "Simulate until" and ' + (later === 1 ? 'was' : 'were') +
              ' left out. Set "Simulate until" to Now or to a later date to include ' + (later === 1 ? 'it' : 'them') + '.');
            times = times.filter(function (t) { return t <= endMs; });
          }
        }
        if (!times.length) err('paste', 'Paste at least one snapshot timestamp, one per line, for example 2026-10-27 02:00.');
      }
      times = times.map(function (t, idx) { return { t: t, idx: idx }; })
        .sort(function (a, b) { return a.t - b.t || a.idx - b.idx; })
        .map(function (o) { return o.t; });
    } else {
      var days = String(state.days || '');
      if (!/^[01]{7}$/.test(days) || days.indexOf('1') < 0) err('days', 'Days: pick at least one weekday.');
      var tl = state.timeMode === 'e' ? everyTimes(state.every, state.from) : parseTimes(state.at);
      if (!tl.ok) err(tl.field || 'at', (state.timeMode === 'e' ? (tl.field === 'from' ? 'Starting at: ' : 'Every N hours: ') : 'Backup times: ') + tl.error + '.');
      var unit = SPAN_MAX[state.spanUnit] ? state.spanUnit : 'w';
      var span = String(state.span || '').trim();
      if (!/^\d+$/.test(span) || Number(span) < 1 || Number(span) > SPAN_MAX[unit]) {
        err('span', 'Simulated period: enter a whole number from 1 to ' + SPAN_MAX[unit] + ' ' + UNIT_WORDS[unit][1] + '.');
      }
      var sk = parseSkip(state.skip);
      if (!sk.ok) err('skip', 'Missed backup days: ' + sk.error + '.');
      if (!res.errors.length) {
        var startMs = spanStart(endMs, Number(span), unit, tz);
        res.startMs = startMs;
        var gen = scheduleTimes({ days: days.split('').map(function (c) { return c === '1'; }), times: tl.value, skip: sk.value },
          startMs, endMs, tz);
        if (gen.overflow) {
          err('span', 'This schedule makes more than ' + MAX_SNAPSHOTS.toLocaleString('en-US') +
            ' backups. Shorten the simulated period or make fewer backups per day.');
        } else {
          times = gen.times;
          if (gen.moved) {
            res.infos.push(gen.moved + ' scheduled ' + (gen.moved === 1 ? 'time falls' : 'times fall') +
              ' into the hour skipped when clocks go forward in ' + tz + ' and ' + (gen.moved === 1 ? 'was' : 'were') +
              ' moved forward by the size of the gap.');
          }
          if (!times.length) err('days', 'This schedule makes no backups in the simulated period. Add weekdays or lengthen the period.');
        }
      }
    }
    if (res.errors.length) return res;

    var snaps = times.map(function (t, i) { return makeSnap(t, i, tz); });
    res.snaps = snaps;
    res.runs = state.runs === 'o' ? 'o' : 'i';
    res.results = {};
    TOOLS.forEach(function (tool) {
      res.results[tool] = simulate(tool, snaps, rules.opts, tz, endMs, res.runs);
    });
    if (res.runs === 'i' && TOOLS.some(function (t) { return res.results[t].replayTooBig; })) {
      res.warnings.push('Proxmox Backup Server would keep too many snapshots at a time to replay a prune after every backup here (an unlimited rule, or many backups over a long period), so its column shows one prune run at the end of the period instead. Lower the unlimited rule or shorten the period to replay every run.');
    }
    res.analysis = analyse(res, state);
    res.commands = buildCommands(rules.opts, state);
    res.ok = true;
    return res;
  }

  // ── Analysis: what differs and why ────────────────────────

  function keptSet(result, snaps) {
    var out = [];
    for (var i = 0; i < snaps.length; i++) if (result.marks[snaps[i].i] && result.marks[snaps[i].i].keep) out.push(snaps[i].i);
    return out;
  }

  function fmtWall(w, withSec) {
    return DOW[w.dow] + ' ' + w.y + '-' + pad(w.mo) + '-' + pad(w.d) + ' ' + pad(w.h) + ':' + pad(w.mi) + (withSec ? ':' + pad(w.s) : '');
  }

  function fmtDate(w) {
    return w.y + '-' + pad(w.mo) + '-' + pad(w.d);
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function activeRules(opts) {
    return RULES.filter(function (r) { return !!opts[r]; });
  }

  // Snapshots that are the newest of their month (or year) among all backups, that
  // PBS removed, and that borg keeps for keep-monthly or keep-yearly. Newest first.
  function pbsMonthEndLosses(res) {
    var snaps = res.snaps;
    var R = res.results;
    if (!(res.opts.monthly || res.opts.yearly)) return [];
    var newestMonth = {}, newestYear = {};
    snaps.forEach(function (sn) {
      newestMonth[sn.kMonth] = sn;
      newestYear[sn.kYear] = sn;
    });
    var out = [];
    for (var k = snaps.length - 1; k >= 0; k--) {
      var sn = snaps[k];
      var m = R.pbs.marks[sn.i];
      var b = R.borg.marks[sn.i];
      if (m.keep || !b.keep) continue;
      if (newestMonth[sn.kMonth] !== sn && newestYear[sn.kYear] !== sn) continue;
      if (b.tags[0].rule !== 'monthly' && b.tags[0].rule !== 'yearly') continue;
      out.push(sn);
    }
    return out;
  }

  function analyse(res, state) {
    var snaps = res.snaps;
    var opts = res.opts;
    var tz = res.tz;
    var R = res.results;
    var withSec = snaps.some(function (s) { return s.w.s !== 0; });
    var out = { notes: [], kept: {}, withSec: withSec, diffRows: 0 };
    var byIdx = {};
    snaps.forEach(function (s) { byIdx[s.i] = s; });
    var label = function (i) { return fmtWall(byIdx[i].w, withSec); };
    TOOLS.forEach(function (t) { out.kept[t] = keptSet(R[t], snaps); });
    snaps.forEach(function (s) {
      var a = R.pbs.marks[s.i].keep, b = R.borg.marks[s.i].keep, c = R.restic.marks[s.i].keep;
      if (a !== b || b !== c) out.diffRows++;
    });
    var note = function (kind, title, html) { out.notes.push({ kind: kind, title: title, html: html }); };
    var counts = TOOLS.map(function (t) { return TOOL_SHORT[t] + ' ' + out.kept[t].length; }).join(', ');
    var rulesOn = activeRules(opts);

    if (!borgAnything(opts)) {
      note('diff', 'No rule set',
        'With no keep option, Proxmox Backup Server keeps every snapshot and logs ' +
        '<span class="brp-code">No prune selection - keeping all files.</span> borg prune stops with an error ' +
        '(<span class="brp-code">At least one of the "keep-within", "keep-last", … settings must be specified.</span>) and restic forget refuses as well ' +
        '(<span class="brp-code">no policy was specified, no snapshots will be removed</span>). In all three cases nothing is deleted.');
      return out;
    }

    if (out.diffRows === 0) {
      note('same', 'Same result',
        'All three tools keep the same ' + plural(out.kept.pbs.length, 'snapshot', 'snapshots') + ' for these rules and backups.');
    }

    // Rule overlap: restic ORs independent rules, PBS and borg skip covered periods
    var multi = 0;
    var newestMulti = null;
    snaps.forEach(function (s) {
      var m = R.restic.marks[s.i];
      if (!m.keep) return;
      var n = m.tags.filter(function (t) { return t.rule !== 'within'; }).length;
      if (n >= 2) {
        multi++;
        if (!newestMulti || s.t > newestMulti.t) newestMulti = s;
      }
    });
    if (multi > 0) {
      var rlist = R.restic.marks[newestMulti.i].tags.filter(function (t) { return t.rule !== 'within'; })
        .map(function (t) { return 'keep-' + t.rule; });
      note('diff', 'Rules that overlap',
        'restic checks every rule on its own, so one snapshot can count for several rules at once: ' +
        plural(multi, 'snapshot', 'snapshots') + ' here matched two or more (the newest, ' + esc(label(newestMulti.i)) +
        ', counts for ' + esc(rlist.join(', ')) + '). Proxmox Backup Server and borg apply the rules in order ' +
        '(keep-last, hourly, daily, weekly, monthly, yearly) and do not count a period an earlier rule already covered, so every rule reaches further back in time. ' +
        'PBS treats an hour, day, week, month or year as covered when an earlier rule kept any snapshot in it; borg when its newest backup is already kept. Kept: ' + esc(counts) + '.');
    }

    // borg: keep the oldest archive when a rule misses its target
    var borgOld = snaps.filter(function (s) {
      var m = R.borg.marks[s.i];
      return m.keep && m.tags[0] && m.tags[0].oldest;
    });
    if (borgOld.length) {
      var bt = R.borg.marks[borgOld[0].i].tags[0];
      var restKeeps = R.restic.marks[borgOld[0].i].keep;
      note('diff', 'borg keeps the oldest archive',
        'borg kept the oldest archive, ' + esc(label(borgOld[0].i)) + ', as <span class="brp-code">' + esc(bt.rule) + '[oldest]</span>: since borg 1.2.0, a rule that cannot reach its count with older periods keeps the oldest archive, ' +
        'so the first backup keeps ageing until a newer one meets the rule. Proxmox Backup Server has no such rule and ' +
        (R.pbs.marks[borgOld[0].i].keep ? 'keeps it only because another option covers it' : 'removes it') + '. restic ' +
        (restKeeps ? 'keeps it as well' : 'removes it here, because it already counted a newer snapshot for that rule') + '.');
    }

    // restic: the oldest snapshot is kept while a rule has counts left
    var resOld = snaps.filter(function (s) {
      var m = R.restic.marks[s.i];
      return m.keep && m.tags.some(function (t) { return t.oldest; });
    });
    if (resOld.length) {
      var ot = R.restic.marks[resOld[0].i].tags.filter(function (t) { return t.oldest; }).map(function (t) { return 'oldest ' + t.rule + ' snapshot'; });
      note('diff', 'restic keeps the oldest snapshot',
        'restic kept its oldest snapshot, ' + esc(label(resOld[0].i)) + ', as <span class="brp-code">' + esc(ot.join(', ')) + '</span>: when a rule still has counts left (or is unlimited) at the end of the list, restic keeps the oldest snapshot too. ' +
        'Proxmox Backup Server ' + (R.pbs.marks[resOld[0].i].keep ? 'keeps it for another reason' : 'removes it') + '.');
    }

    // PBS: a month counts as covered once any snapshot of it is kept by an earlier
    // option; borg skips a month only when its newest backup is already kept
    var lost = pbsMonthEndLosses(res);
    if (lost.length) {
      var ex = lost[0];
      var cover = null;
      snaps.forEach(function (sn) {
        var pm = R.pbs.marks[sn.i];
        if (pm.keep && sn.kMonth === ex.kMonth && pm.tags[0].rule !== 'monthly' && pm.tags[0].rule !== 'yearly' && (!cover || sn.t > cover.t)) cover = sn;
      });
      var exMark = R.pbs.marks[ex.i];
      var borgTag = R.borg.marks[ex.i].tags[0];
      note('diff', 'PBS loses month-end backups',
        'Proxmox Backup Server removed ' + plural(lost.length, 'backup', 'backups') + ' that ' + (lost.length === 1 ? 'was' : 'were') +
        ' the last of ' + (lost.length === 1 ? 'its' : 'their') + ' month and that borg keeps for keep-monthly or keep-yearly. Example: ' + esc(label(ex.i)) +
        ' (borg: <span class="brp-code">' + esc(tagText('borg', borgTag)) + '</span>' +
        (exMark.removedAt !== undefined ? '; PBS removed it in the prune after the backup of ' + esc(fmtWall(wallOf(exMark.removedAt, tz), withSec)) : '') + '). ' +
        'PBS counts a month as covered as soon as an earlier option keeps any snapshot from it' +
        (cover ? ' (here ' + esc(label(cover.i)) + ', kept by keep-' + esc(R.pbs.marks[cover.i].tags[0].rule) + ')' : '') +
        ', and it never looks again at a snapshot an earlier option marked for removal, such as the older backups of a week that keep-weekly kept. ' +
        'borg skips a month only when its newest backup is already kept. ' +
        (res.runs === 'i' ? 'With a prune after every backup this adds up: once no option wants a month-end backup in one run, it is gone, and PBS\'s keep-monthly ends up with an earlier backup of that month, often the Sunday that keep-weekly kept.' : ''));
    }

    // keep-within
    if (opts.within) {
      var wn = opts.within.n, wu = opts.within.unit;
      var words = plural(wn, UNIT_WORDS[wu][0], UNIT_WORDS[wu][1]);
      var bFrom = R.borg.withinFrom, rFrom = R.restic.withinFrom;
      var latest = R.restic.latest;
      var html = 'keep-within ' + esc(words) + ': Proxmox Backup Server has no keep-within option, so its column ignores it' +
        (pbsAnything(opts) ? '. ' : ' and, with no other rule set, keeps every snapshot. ');
      if (bFrom !== undefined) {
        html += 'borg keeps every archive newer than ' + esc(fmtWall(wallOf(bFrom, tz), withSec)) + ' (' + esc(words + (wu === 'h' ? '' : ' = ' + wn * BORG_WITHIN_HOURS[wu] + ' hours')) + ' before prune runs' +
          (wu === 'm' ? '; borg counts a month as 31 days' : wu === 'y' ? '; borg counts a year as 365 days' : '') + '). ';
      }
      if (rFrom !== undefined && latest !== null && latest !== undefined) {
        html += 'restic keeps every snapshot newer than ' + esc(fmtWall(wallOf(rFrom, tz), withSec)) + ' (' + esc(resticDurationString(resticDuration(opts.within))) +
          ' before its newest snapshot, ' + esc(fmtWall(wallOf(latest, tz), withSec)) + (wu === 'm' || wu === 'y' ? ', in calendar ' + UNIT_WORDS[wu][1] : '') + '). ';
      }
      if (rulesOn.length) {
        html += 'Archives kept by borg\'s keep-within do not count toward the other rules, and their periods are skipped; in restic they count for the other rules as well.';
      }
      note('diff', 'keep-within', html);
    }

    // Unlimited values
    var unl = RULES.filter(function (r) { return opts[r] === -1; });
    if (unl.length) {
      note('diff', 'No limit',
        esc(unl.map(function (r) { return 'keep-' + r; }).join(', ')) + ' without a limit: borg writes it as <span class="brp-code">-1</span> and restic as <span class="brp-code">unlimited</span>. ' +
        'Proxmox Backup Server has no unlimited value (its keep options take 1 or more), so its column treats it as no limit and its command uses ' + PBS_UNLIMITED + ' instead.');
    }

    // borg keep-last is keep-secondly
    if (opts.last) {
      var seenSec = {};
      var dupes = 0;
      snaps.forEach(function (s) {
        if (seenSec[s.kSec]) dupes++;
        seenSec[s.kSec] = true;
      });
      if (dupes) {
        note('diff', 'Backups in the same second',
          plural(dupes, 'snapshot shares', 'snapshots share') + ' its second with another one. borg\'s --keep-last is the same as --keep-secondly and keeps one archive per second; restic counts every snapshot; ' +
          'Proxmox Backup Server cannot store two snapshots of one backup group with the same time.');
      }
    }

    if (res.zeros.length) {
      note('info', 'Zero values',
        esc(res.zeros.join(', ')) + ' set to 0 turns the rule off in all three tools. The PBS API does not accept 0 (its minimum is 1), so the commands leave it out.');
    }

    // ISO weeks across New Year
    if (opts.weekly) {
      var cross = null;
      for (var k = snaps.length - 1; k >= 0; k--) {
        if (snaps[k].isoYear !== snaps[k].w.y) {
          cross = snaps[k];
          break;
        }
      }
      if (cross) {
        var cw = cross.w;
        var mStart = Date.UTC(cw.y, cw.mo - 1, cw.d) - cw.dow * DAY_MS;
        var a = new Date(mStart), z = new Date(mStart + 6 * DAY_MS);
        note('info', 'ISO weeks at New Year',
          'All three tools use ISO 8601 weeks (Monday to Sunday; a week belongs to the year that holds its Thursday). Week ' + cross.isoYear + '-W' + pad(cross.isoWeek) +
          ' runs from Mon ' + a.getUTCFullYear() + '-' + pad(a.getUTCMonth() + 1) + '-' + pad(a.getUTCDate()) + ' to Sun ' + z.getUTCFullYear() + '-' + pad(z.getUTCMonth() + 1) + '-' + pad(z.getUTCDate()) +
          ', so keep-weekly treats those days as one week, while keep-monthly and keep-yearly split them at 1 January.');
      }
    }

    // Daylight saving inside the range
    if (opts.hourly && snaps.length) {
      var offs = {};
      snaps.forEach(function (s) { offs[s.w.off] = true; });
      if (Object.keys(offs).length > 1) {
        note('info', 'Daylight saving time',
          'The simulated period crosses a daylight saving change in ' + esc(tz) + '. Hours and days follow the local clock in all three tools, so the hour that repeats in autumn is one hourly period.');
      }
    }
    return out;
  }

  // ── Commands ──────────────────────────────────────────────

  function shq(s) {
    s = String(s);
    if (s !== '' && /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(s)) return s;
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  function cleanName(s, fallback) {
    s = String(s === undefined || s === null ? '' : s).replace(/[\r\n\t]/g, ' ').trim();
    return s === '' ? fallback : s;
  }

  function buildCommands(opts, state) {
    var group = cleanName(state.pbsGroup, 'vm/100');
    var store = cleanName(state.pbsStore, 'store1');
    var sched = cleanName(state.pbsSchedule, 'daily');
    var borgRepo = cleanName(state.borgRepo, '/path/to/repo');
    var resticRepo = cleanName(state.resticRepo, '/srv/restic-repo');
    var rulesOn = activeRules(opts);
    var unl = rulesOn.filter(function (r) { return opts[r] === -1; });

    // PBS
    var pbs = [];
    var pbsFlags = rulesOn.map(function (r) { return '--keep-' + r + ' ' + (opts[r] === -1 ? PBS_UNLIMITED : opts[r]); }).join(' ');
    if (!rulesOn.length) {
      pbs.push('# No keep option is set: Proxmox Backup Server keeps every snapshot.');
    } else {
      if (opts.within) pbs.push('# keep-within does not exist in Proxmox Backup Server; it is left out.');
      if (unl.length) pbs.push('# PBS has no unlimited value; ' + PBS_UNLIMITED + ' stands in for ' + unl.map(function (r) { return 'keep-' + r; }).join(', ') + '.');
      pbs.push('# Dry run for one backup group (needs --repository or PBS_REPOSITORY,');
      pbs.push('# for example root@pam@<server>:' + store + '); "keep 1" = kept, "keep 0" = removed');
      pbs.push('proxmox-backup-client prune ' + shq(group) + ' --dry-run ' + pbsFlags);
      pbs.push('');
      pbs.push('# Prune that group');
      pbs.push('proxmox-backup-client prune ' + shq(group) + ' ' + pbsFlags);
      pbs.push('');
      pbs.push('# Or a prune job on the server for the whole datastore');
      pbs.push('proxmox-backup-manager prune-job create ' + shq(('prune-' + store).replace(/[^A-Za-z0-9_.-]/g, '-')) +
        ' --store ' + shq(store) + ' --schedule ' + shq(sched) + ' ' + pbsFlags);
      pbs.push('# Pruning frees no space until garbage collection runs on the datastore.');
    }

    // borg 1.4
    var borg = [];
    var borgFlags = [];
    if (opts.within) borgFlags.push('--keep-within=' + opts.within.n + BORG_WITHIN_SUFFIX[opts.within.unit]);
    rulesOn.forEach(function (r) { borgFlags.push('--keep-' + r + '=' + opts[r]); });
    if (!borgFlags.length) {
      borg.push('# No keep option is set: borg prune refuses to run without one.');
    } else {
      var bf = borgFlags.join(' ');
      borg.push('# Dry run: list which archives would be kept and which pruned');
      borg.push('borg prune -v --list --dry-run ' + bf + ' ' + shq(borgRepo));
      borg.push('');
      borg.push('# Prune for real, then free the space');
      borg.push('borg prune -v --list ' + bf + ' ' + shq(borgRepo));
      borg.push('borg compact ' + shq(borgRepo));
      borg.push('# Add --glob-archives \'{hostname}-*\' if several machines share one repository.');
    }

    // restic
    var restic = [];
    var rf = [];
    rulesOn.forEach(function (r) { rf.push('--keep-' + r + ' ' + (opts[r] === -1 ? 'unlimited' : opts[r])); });
    if (opts.within) rf.push('--keep-within ' + resticDurationString(resticDuration(opts.within)));
    if (!rf.length) {
      restic.push('# No keep option is set: restic forget refuses to run without one.');
    } else {
      var rflags = rf.join(' ');
      restic.push('# Dry run (snapshots are grouped by host and paths, as by default)');
      restic.push('restic -r ' + shq(resticRepo) + ' forget --dry-run ' + rflags);
      restic.push('');
      restic.push('# Forget for real and remove the data no snapshot uses any more');
      restic.push('restic -r ' + shq(resticRepo) + ' forget ' + rflags + ' --prune');
    }
    return { pbs: pbs.join('\n'), borg: borg.join('\n'), restic: restic.join('\n') };
  }

  // ── State and URL hash ────────────────────────────────────

  function defaultState() {
    return {
      mode: 's', days: '1111111', timeMode: 'a', at: '02:00', every: '6', from: '00:00',
      span: '1', spanUnit: 'y', skip: '', end: 'now', tz: '', runs: 'i', paste: '',
      last: '3', hourly: '', daily: '7', weekly: '4', monthly: '6', yearly: '1',
      within: '', withinUnit: 'd',
      pbsGroup: 'vm/100', pbsStore: 'store1', pbsSchedule: 'daily',
      borgRepo: '/path/to/repo', resticRepo: '/srv/restic-repo'
    };
  }

  var HASH_FIELDS = [
    ['m', 'mode'], ['wd', 'days'], ['tm', 'timeMode'], ['at', 'at'], ['ev', 'every'], ['fr', 'from'],
    ['sp', 'span'], ['su', 'spanUnit'], ['sk', 'skip'], ['en', 'end'], ['tz', 'tz'], ['rn', 'runs'],
    ['kl', 'last'], ['kh', 'hourly'], ['kd', 'daily'], ['kw', 'weekly'], ['km', 'monthly'], ['ky', 'yearly'],
    ['wn', 'within'], ['wu', 'withinUnit'],
    ['pg', 'pbsGroup'], ['pd', 'pbsStore'], ['pj', 'pbsSchedule'], ['br', 'borgRepo'], ['rr', 'resticRepo'],
    ['ps', 'paste']
  ];
  var ENUMS = {
    mode: ['s', 'p'], timeMode: ['a', 'e'], spanUnit: ['d', 'w', 'm', 'y'], runs: ['i', 'o'],
    withinUnit: ['h', 'd', 'w', 'm', 'y']
  };

  function isStateHash(h) {
    return /^#v=1(&|$)/.test(String(h || ''));
  }

  function encodeHash(state) {
    var out = '#v=1';
    HASH_FIELDS.forEach(function (f) {
      var v = state[f[1]];
      if (v === undefined || v === null) v = '';
      v = String(v);
      if (f[1] === 'paste' && (state.mode !== 'p' || v.length > MAX_HASH_PASTE)) v = '';
      out += '&' + f[0] + '=' + encodeURIComponent(v);
    });
    return out;
  }

  function decodeHash(h) {
    var state = defaultState();
    if (!isStateHash(h)) return state;
    var map = {};
    HASH_FIELDS.forEach(function (f) { map[f[0]] = f[1]; });
    String(h).slice(1).split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq < 0) return;
      var key = map[pair.slice(0, eq)];
      if (!key) return;
      var val;
      try {
        val = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, '%20'));
      } catch (e) {
        return;
      }
      if (ENUMS[key]) {
        if (ENUMS[key].indexOf(val) >= 0) state[key] = val;
        return;
      }
      if (key === 'days') {
        if (/^[01]{7}$/.test(val)) state.days = val;
        return;
      }
      if (key === 'end') {
        state.end = val === 'now' || parseLocalDateTime(val) ? val : 'now';
        return;
      }
      var max = TEXT_MAX[key] || 200;
      state[key] = val.length > max ? val.slice(0, max) : val;
    });
    return state;
  }

  // Documented examples that the presets reproduce
  var EXAMPLES = {
    pbs: {
      title: 'PBS docs: keep-last 3, daily 13, weekly 8, monthly 11, yearly 9 over 10 years of daily backups',
      patch: { mode: 's', days: '1111111', timeMode: 'a', at: '02:00', span: '10', spanUnit: 'y', skip: '', runs: 'i',
        last: '3', hourly: '', daily: '13', weekly: '8', monthly: '11', yearly: '9', within: '' }
    },
    borg: {
      title: 'borg docs (prune-example.txt): daily backups in 2015 except 2015-12-19, keep-daily 14, monthly 6, yearly 1',
      patch: { mode: 's', days: '1111111', timeMode: 'a', at: '12:00', span: '365', spanUnit: 'd', skip: '2015-12-19',
        end: '2016-01-01T00:00', runs: 'o', last: '', hourly: '', daily: '14', weekly: '', monthly: '6', yearly: '1', within: '' }
    },
    restic: {
      title: 'restic docs: weekday backups with a missed Wednesday, keep-daily 5',
      patch: { mode: 'p', end: '2025-05-03T00:00', runs: 'o', last: '', hourly: '', daily: '5', weekly: '', monthly: '', yearly: '', within: '',
        paste: ['2025-04-21 11:00:00', '2025-04-22 11:00:00', '2025-04-23 11:00:00', '2025-04-24 11:00:00', '2025-04-25 11:00:00',
          '2025-04-25 23:00:00', '2025-04-28 11:00:00', '2025-04-29 11:00:00', '2025-05-01 11:00:00', '2025-05-02 11:00:00',
          '2025-05-02 23:00:00'].join('\n') }
    }
  };

  function applyExample(state, id) {
    var ex = EXAMPLES[id];
    if (!ex) return state;
    var next = {};
    Object.keys(state).forEach(function (k) { next[k] = state[k]; });
    Object.keys(ex.patch).forEach(function (k) { next[k] = ex.patch[k]; });
    return next;
  }

  // ── Rendering helpers ─────────────────────────────────────

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function tagText(tool, tag) {
    if (tag.rule === 'all') return 'kept: no option set';
    if (tag.rule === 'refused') return 'refuses to run';
    if (tag.rule === 'within') return tool === 'restic' ? 'within ' + tag.label : 'within #' + tag.n;
    if (tool === 'borg') return tag.rule + (tag.oldest ? '[oldest]' : '') + ' #' + tag.n;
    if (tool === 'restic' && tag.oldest) return 'oldest ' + tag.rule;
    return tag.rule + ' #' + tag.n;
  }

  function tagClass(tag) {
    var rule = tag.rule === 'refused' ? 'all' : tag.rule;
    return 'brp-tag brp-r-' + rule + (tag.oldest ? ' brp-tag--oldest' : '');
  }

  function cellHtml(tool, mark, tz, withSec) {
    if (!mark.keep) {
      var t = mark.removedAt !== undefined ? ' title="Removed by the prune after the backup of ' + esc(fmtWall(wallOf(mark.removedAt, tz), withSec)) + '"' : '';
      return '<span class="brp-pruned"' + t + '>pruned</span>';
    }
    return mark.tags.map(function (tag) {
      return '<span class="' + tagClass(tag) + '">' + esc(tagText(tool, tag)) + '</span>';
    }).join('');
  }

  // ── DOM state ─────────────────────────────────────────────

  var state = defaultState();
  var lastResult = null;
  var lastHash = '';
  var hashActive = false;
  var calTool = 'pbs';
  var listFilter = 'k';
  var listLimit = TABLE_PAGE;
  var renderTimer = null;

  var FIELD_IDS = {
    at: 'brp-at', every: 'brp-every', from: 'brp-from', span: 'brp-span', spanUnit: 'brp-span-unit', skip: 'brp-skip',
    end: 'brp-end', tz: 'brp-tz', runs: 'brp-runs', paste: 'brp-paste', timeMode: 'brp-time-mode',
    last: 'brp-keep-last', hourly: 'brp-keep-hourly', daily: 'brp-keep-daily', weekly: 'brp-keep-weekly',
    monthly: 'brp-keep-monthly', yearly: 'brp-keep-yearly', within: 'brp-keep-within', withinUnit: 'brp-within-unit',
    pbsGroup: 'brp-pbs-group', pbsStore: 'brp-pbs-store', pbsSchedule: 'brp-pbs-schedule',
    borgRepo: 'brp-borg-repo', resticRepo: 'brp-restic-repo'
  };

  function nowLocalInput(tz) {
    var w = wallOf(Date.now(), tz || browserZone());
    return w.y + '-' + pad(w.mo) + '-' + pad(w.d) + 'T' + pad(w.h) + ':' + pad(w.mi);
  }

  function readForm() {
    var s = {};
    Object.keys(state).forEach(function (k) { s[k] = state[k]; });
    Object.keys(FIELD_IDS).forEach(function (k) {
      var el = $(FIELD_IDS[k]);
      if (el) s[k] = el.value;
    });
    var mode = document.querySelector('input[name="brp-mode"]:checked');
    s.mode = mode && mode.value === 'p' ? 'p' : 's';
    var days = '';
    for (var d = 0; d < 7; d++) {
      var cb = $('brp-day-' + d);
      days += cb && cb.checked ? '1' : '0';
    }
    s.days = days;
    var em = $('brp-end-mode');
    if (em && em.value === 'now') s.end = 'now';
    else if (em) s.end = $('brp-end').value || nowLocalInput(s.tz);
    return s;
  }

  function writeForm() {
    Object.keys(FIELD_IDS).forEach(function (k) {
      var el = $(FIELD_IDS[k]);
      if (!el) return;
      if (k === 'end') {
        el.value = state.end === 'now' ? '' : String(state.end).slice(0, 16);
        return;
      }
      if (k === 'tz' && state.tz && !Array.prototype.some.call(el.options, function (o) { return o.value === state.tz; })) {
        var opt = document.createElement('option');
        opt.value = state.tz;
        opt.textContent = state.tz;
        el.appendChild(opt);
      }
      el.value = state[k];
    });
    var modeEl = document.querySelector('input[name="brp-mode"][value="' + (state.mode === 'p' ? 'p' : 's') + '"]');
    if (modeEl) modeEl.checked = true;
    for (var d = 0; d < 7; d++) {
      var cb = $('brp-day-' + d);
      if (cb) cb.checked = state.days.charAt(d) === '1';
    }
    $('brp-end-mode').value = state.end === 'now' ? 'now' : 'at';
    syncVisibility();
  }

  function toggle(el, show) {
    if (el) el.classList.toggle('brp-hidden', !show);
  }

  function syncVisibility() {
    var paste = state.mode === 'p';
    toggle($('brp-panel-schedule'), !paste);
    toggle($('brp-panel-paste'), paste);
    var every = state.timeMode === 'e';
    toggle($('brp-f-at'), !every);
    toggle($('brp-f-every'), every);
    toggle($('brp-f-from'), every);
    toggle($('brp-f-end'), state.end !== 'now');
  }

  function populateZones() {
    var sel = $('brp-tz');
    if (!sel || sel.options.length) return;
    var html = '<option value="">Browser time zone (' + esc(browserZone()) + ')</option><option value="UTC">UTC</option>';
    zoneList().forEach(function (z) { html += '<option value="' + esc(z) + '">' + esc(z) + '</option>'; });
    sel.innerHTML = html;
  }

  function markInvalid(fields) {
    Object.keys(FIELD_IDS).forEach(function (k) {
      var el = $(FIELD_IDS[k]);
      if (el) el.classList.toggle('brp-invalid', !!fields[k]);
    });
    var days = $('brp-days');
    if (days) days.classList.toggle('brp-invalid', !!fields.days);
  }

  function renderIssues(r) {
    var list = $('brp-issues');
    var items = [];
    r.errors.forEach(function (t) { items.push(['error', 'Error', t]); });
    r.warnings.forEach(function (t) { items.push(['warn', 'Warning', t]); });
    (r.infos || []).forEach(function (t) { items.push(['info', 'Note', t]); });
    list.innerHTML = items.map(function (it) {
      return '<li class="brp-issue brp-issue--' + it[0] + '"><span class="brp-issue-tag">' + it[1] + '</span><span class="brp-issue-text">' + esc(it[2]) + '</span></li>';
    }).join('');
    toggle(list, items.length > 0);
  }

  function renderKpis(r) {
    var snaps = r.snaps;
    var withSec = r.analysis.withSec;
    var first = snaps[0], last = snaps[snaps.length - 1];
    var html = '<div class="brp-kpi brp-kpi--main"><span class="brp-kpi-label">Backups</span><span class="brp-kpi-value">' +
      snaps.length.toLocaleString('en-US') + '</span><span class="brp-kpi-sub">' +
      esc(fmtDate(first.w)) + ' to ' + esc(fmtDate(last.w)) + '<br>' +
      (r.runs === 'i' && TOOLS.some(function (t) { return r.results[t].mode === 'i'; }) ? 'prune after every backup' : 'one prune at the end') + '</span></div>';
    TOOLS.forEach(function (tool) {
      var res = r.results[tool];
      var kept = r.analysis.kept[tool];
      var status;
      if (res.keepAll) status = 'no option set: keeps all';
      else if (res.refused) status = 'refuses to run: no rule';
      else {
        var oldest = null;
        kept.forEach(function (i) { if (oldest === null || snaps[i].t < oldest.t) oldest = snaps[i]; });
        status = oldest ? 'oldest kept ' + fmtDate(oldest.w) + ' (' + Math.round((last.t - oldest.t) / DAY_MS) + ' days back)' : 'nothing kept';
      }
      html += '<div class="brp-kpi brp-kpi--' + tool + '"><span class="brp-kpi-label">' + esc(TOOL_NAMES[tool]) + '</span>' +
        '<span class="brp-kpi-value">' + kept.length.toLocaleString('en-US') + ' <small class="brp-kpi-unit">kept</small></span>' +
        '<span class="brp-kpi-sub">' + (snaps.length - kept.length).toLocaleString('en-US') + ' pruned<br>' + esc(status) + '</span></div>';
    });
    $('brp-kpis').innerHTML = html;
  }

  function renderNotes(r) {
    var notes = r.analysis.notes;
    $('brp-diffs').innerHTML = notes.map(function (n) {
      var tag = n.kind === 'diff' ? 'Differs' : n.kind === 'same' ? 'Same' : 'Note';
      return '<li class="brp-note brp-note--' + n.kind + '"><span class="brp-note-tag">' + tag + '</span><div class="brp-note-body"><strong class="brp-note-title">' +
        esc(n.title) + '</strong><span class="brp-note-text">' + n.html + '</span></div></li>';
    }).join('');
    $('brp-diff-meta').textContent = r.analysis.diffRows ? plural(r.analysis.diffRows, 'snapshot', 'snapshots') + ' with different results' : 'no snapshot differs';
  }

  var LEGEND = [['within', 'keep-within'], ['last', 'keep-last'], ['hourly', 'hourly'], ['daily', 'daily'], ['weekly', 'weekly'],
    ['monthly', 'monthly'], ['yearly', 'yearly'], ['all', 'no rule: kept']];

  function renderCalendar(r) {
    var tool = calTool;
    var res = r.results[tool];
    var snaps = r.snaps;
    var withSec = r.analysis.withSec;
    var days = {};
    snaps.forEach(function (s) {
      var d = days[s.kDay];
      if (!d) d = days[s.kDay] = { kept: [], pruned: 0, list: [] };
      var m = res.marks[s.i];
      d.list.push(s);
      if (m.keep) d.kept.push(s);
      else d.pruned++;
    });
    var first = snaps[0].w, last = snaps[snaps.length - 1].w;
    var months = [];
    for (var y = last.y, mo = last.mo; y > first.y || (y === first.y && mo >= first.mo);) {
      months.push({ y: y, mo: mo });
      mo--;
      if (mo === 0) {
        mo = 12;
        y--;
      }
    }
    var html = '';
    var quiet = null;
    var detailed = 0;
    var flushQuiet = function () {
      if (!quiet) return;
      var a = quiet.from, b = quiet.to;
      var name = function (m) { return MONTHS[m.mo - 1].slice(0, 3) + ' ' + m.y; };
      html += '<div class="brp-quiet">' + esc(a === b ? name(a) : name(b) + ' – ' + name(a)) + ': ' +
        (quiet.count ? plural(quiet.count, 'backup', 'backups') + ', none kept' : 'no backups') + '</div>';
      quiet = null;
    };
    months.forEach(function (m) {
      var dim = new Date(Date.UTC(m.y, m.mo, 0)).getUTCDate();
      var keptHere = 0, count = 0;
      for (var d = 1; d <= dim; d++) {
        var info = days[m.y * 10000 + m.mo * 100 + d];
        if (info) {
          keptHere += info.kept.length;
          count += info.list.length;
        }
      }
      if (!keptHere || detailed >= MAX_MONTHS) {
        if (!quiet) quiet = { from: m, to: m, count: 0 };
        quiet.to = m;
        quiet.count += count;
        return;
      }
      flushQuiet();
      detailed++;
      var lead = (new Date(Date.UTC(m.y, m.mo - 1, 1)).getUTCDay() + 6) % 7;
      var g = '<div class="brp-month"><div class="brp-month-head"><span class="brp-month-name">' + esc(MONTHS[m.mo - 1] + ' ' + m.y) +
        '</span><span class="brp-month-meta">' + keptHere + ' kept / ' + count + '</span></div><div class="brp-month-grid">';
      DOW.forEach(function (n) { g += '<span class="brp-dow">' + n.slice(0, 2) + '</span>'; });
      for (var b = 0; b < lead; b++) g += '<span class="brp-day brp-day--pad"></span>';
      for (var dd = 1; dd <= dim; dd++) {
        var di = days[m.y * 10000 + m.mo * 100 + dd];
        if (!di) {
          g += '<span class="brp-day brp-day--none"><span class="brp-day-num">' + dd + '</span></span>';
          continue;
        }
        var cls = 'brp-day brp-day--bk';
        var dots = '';
        var tip = m.y + '-' + pad(m.mo) + '-' + pad(dd) + ': ' + plural(di.list.length, 'backup', 'backups');
        if (di.kept.length) {
          var lead0 = res.marks[di.kept[0].i].tags[0];
          cls += ' brp-day--keep brp-r-' + (lead0.rule === 'refused' ? 'all' : lead0.rule);
          di.kept.slice(0, 4).forEach(function (s) {
            var tg = res.marks[s.i].tags[0];
            dots += '<span class="brp-dot brp-r-' + (tg.rule === 'refused' ? 'all' : tg.rule) + (tg.oldest ? ' brp-dot--oldest' : '') + '"></span>';
          });
          if (di.kept.length > 4) dots += '<span class="brp-dot-more">+' + (di.kept.length - 4) + '</span>';
          di.kept.slice(0, 12).forEach(function (s) {
            tip += '\n' + pad(s.w.h) + ':' + pad(s.w.mi) + (withSec ? ':' + pad(s.w.s) : '') + ' kept: ' +
              res.marks[s.i].tags.map(function (tg) { return tagText(tool, tg); }).join(', ');
          });
          if (di.kept.length > 12) tip += '\n…';
        }
        if (di.pruned) tip += '\n' + di.pruned + ' pruned';
        g += '<span class="' + cls + '" title="' + esc(tip) + '"><span class="brp-day-num">' + dd + '</span><span class="brp-dots">' + dots + '</span></span>';
      }
      g += '</div></div>';
      html += g;
    });
    flushQuiet();
    $('brp-months').innerHTML = html;
    $('brp-cal-meta').textContent = TOOL_NAMES[tool] + ': ' + r.analysis.kept[tool].length + ' kept';
  }

  function renderLegend() {
    $('brp-legend').innerHTML = LEGEND.map(function (l) {
      return '<span class="brp-legend-item"><span class="brp-dot brp-r-' + l[0] + '"></span>' + esc(l[1]) + '</span>';
    }).join('') + '<span class="brp-legend-item"><span class="brp-dot brp-r-yearly brp-dot--oldest"></span>oldest fallback</span>' +
      '<span class="brp-legend-item"><span class="brp-day-swatch"></span>backups, all pruned</span>';
  }

  function renderTable(r) {
    var snaps = r.snaps;
    var R = r.results;
    var withSec = r.analysis.withSec;
    var rows = [];
    for (var k = snaps.length - 1; k >= 0; k--) {
      var s = snaps[k];
      var a = R.pbs.marks[s.i].keep, b = R.borg.marks[s.i].keep, c = R.restic.marks[s.i].keep;
      var diff = a !== b || b !== c;
      if (listFilter === 'k' && !(a || b || c)) continue;
      if (listFilter === 'd' && !diff) continue;
      rows.push({ s: s, diff: diff });
    }
    var shown = rows.slice(0, listLimit);
    var html = shown.map(function (row) {
      var s = row.s;
      return '<tr class="brp-row' + (row.diff ? ' brp-row--diff' : '') + '"><td class="brp-td brp-td-time" data-label="Snapshot"><span class="brp-cell"><span class="brp-time">' +
        esc(fmtWall(s.w, withSec)) + '</span><span class="brp-week">W' + pad(s.isoWeek) + (s.isoYear !== s.w.y ? ' of ' + s.isoYear : '') + '</span></span></td>' +
        TOOLS.map(function (t) {
          return '<td class="brp-td" data-label="' + TOOL_SHORT[t] + '"><span class="brp-cell">' + cellHtml(t, R[t].marks[s.i], r.tz, withSec) + '</span></td>';
        }).join('') + '</tr>';
    }).join('');
    if (!rows.length) {
      html = '<tr class="brp-row"><td class="brp-td brp-td-empty" colspan="4">' +
        (listFilter === 'd' ? 'The three tools agree on every snapshot.' : 'No snapshot to show.') + '</td></tr>';
    }
    $('brp-tbody').innerHTML = html;
    var more = $('brp-more');
    toggle(more, rows.length > shown.length);
    more.textContent = 'Show ' + Math.min(TABLE_PAGE, rows.length - shown.length) + ' more of ' + (rows.length - shown.length);
    $('brp-list-meta').textContent = plural(rows.length, 'row', 'rows');
  }

  function renderCommands(r) {
    $('brp-cmd-pbs').textContent = r.commands.pbs;
    $('brp-cmd-borg').textContent = r.commands.borg;
    $('brp-cmd-restic').textContent = r.commands.restic;
  }

  function render() {
    renderTimer = null;
    state = readForm();
    syncVisibility();
    var r = compute(state, Date.now());
    lastResult = r;
    markInvalid(r.fields);
    renderIssues(r);
    toggle($('brp-results'), r.ok);
    var meta = $('brp-count-meta');
    if (r.ok) {
      meta.textContent = plural(r.snaps.length, 'backup', 'backups') + ', time zone ' + r.tz;
      renderKpis(r);
      renderNotes(r);
      renderCalendar(r);
      renderTable(r);
      renderCommands(r);
    } else {
      meta.textContent = '';
    }
    if (hashActive) updateHash();
  }

  function scheduleRender(delay) {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay === undefined ? 120 : delay);
  }

  function updateHash() {
    var h = encodeHash(state);
    lastHash = h;
    try {
      history.replaceState(null, '', h);
    } catch (e) {
      // ignore: some embeds forbid replaceState
    }
  }

  // ── Clipboard and toast ───────────────────────────────────

  function showToast(text) {
    var toast = $('brp-toast');
    toast.textContent = text;
    toast.classList.add('brp-show');
    setTimeout(function () { toast.classList.remove('brp-show'); }, 2000);
  }

  function copyText(text, msg) {
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast(msg);
      } catch (e) {
        showToast('Copy failed: select the text and copy it by hand');
      }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast(msg); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function copyCommand(tool) {
    if (!lastResult || !lastResult.ok) return;
    copyText(lastResult.commands[tool], TOOL_NAMES[tool] + ' commands copied');
  }

  function copyLink() {
    state = readForm();
    hashActive = true;
    updateHash();
    var note = state.mode === 'p' && String(state.paste).length > MAX_HASH_PASTE ? ' (pasted list too long for the link, left out)' : '';
    copyText(location.href.split('#')[0] + encodeHash(state), 'Link copied' + note);
  }

  // ── Events ────────────────────────────────────────────────

  function onInput(e) {
    var t = e.target;
    if (!t || !t.id && !t.name) return;
    if (t.id === 'brp-example') return;
    if (t.name === 'brp-cal') {
      calTool = t.value;
      if (lastResult && lastResult.ok) renderCalendar(lastResult);
      return;
    }
    if (t.id === 'brp-filter') {
      listFilter = t.value;
      listLimit = TABLE_PAGE;
      if (lastResult && lastResult.ok) renderTable(lastResult);
      return;
    }
    if (t.id === 'brp-end-mode' && t.value === 'at' && !$('brp-end').value) {
      $('brp-end').value = nowLocalInput($('brp-tz').value);
    }
    hashActive = true;
    listLimit = TABLE_PAGE;
    scheduleRender(t.id === 'brp-paste' ? 300 : 120);
  }

  function onChange(e) {
    var t = e.target;
    if (t && t.id === 'brp-example') {
      if (EXAMPLES[t.value]) {
        state = applyExample(readForm(), t.value);
        writeForm();
        hashActive = true;
        render();
      }
      t.value = '';
      return;
    }
    onInput(e);
  }

  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-brp-copy]') : null;
    if (btn) {
      copyCommand(btn.getAttribute('data-brp-copy'));
      return;
    }
    if (e.target && e.target.id === 'brp-more') {
      listLimit += TABLE_PAGE;
      if (lastResult && lastResult.ok) renderTable(lastResult);
    }
  }

  function init() {
    var wrapper = $('brp-wrapper');
    if (!wrapper) return;
    populateZones();
    if (isStateHash(location.hash)) {
      state = decodeHash(location.hash);
      hashActive = true;
    }
    writeForm();
    renderLegend();
    wrapper.addEventListener('input', onInput);
    wrapper.addEventListener('change', onChange);
    wrapper.addEventListener('click', onClick);
    window.addEventListener('hashchange', function () {
      if (location.hash === lastHash || !isStateHash(location.hash)) return;
      state = decodeHash(location.hash);
      hashActive = true;
      writeForm();
      render();
    });
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Global handler for the onclick attribute
  window.brpCopyLink = copyLink;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      RULES: RULES,
      TOOLS: TOOLS,
      EXAMPLES: EXAMPLES,
      MAX_SNAPSHOTS: MAX_SNAPSHOTS,
      MAX_HASH_PASTE: MAX_HASH_PASTE,
      PBS_UNLIMITED: PBS_UNLIMITED,
      wallOf: wallOf,
      zonedToUtc: zonedToUtc,
      isoWeek: isoWeek,
      makeSnap: makeSnap,
      prunePbs: prunePbs,
      pruneBorg: pruneBorg,
      pruneRestic: pruneRestic,
      simulate: simulate,
      resticDuration: resticDuration,
      resticDurationString: resticDurationString,
      resticWithinStart: resticWithinStart,
      parseCount: parseCount,
      parseWithin: parseWithin,
      parseTimes: parseTimes,
      everyTimes: everyTimes,
      parseSkip: parseSkip,
      parseTimestampLine: parseTimestampLine,
      parsePaste: parsePaste,
      spanStart: spanStart,
      scheduleTimes: scheduleTimes,
      parseRules: parseRules,
      compute: compute,
      analyse: analyse,
      buildCommands: buildCommands,
      shq: shq,
      defaultState: defaultState,
      applyExample: applyExample,
      encodeHash: encodeHash,
      decodeHash: decodeHash,
      isStateHash: isStateHash,
      tagText: tagText,
      fmtWall: fmtWall
    };
  }
})();
