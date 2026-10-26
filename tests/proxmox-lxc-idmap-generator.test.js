// tests/proxmox-lxc-idmap-generator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const lxi = loadScript('proxmox-lxc-idmap-generator/script.js');

const state = (patch) => Object.assign(lxi.defaultState(), patch || {});
const gen = (patch) => lxi.generate(state(patch));
const row = (ct, host, count) => ({ ct: String(ct), host: String(host), count: count === undefined ? '1' : String(count) });
const levels = (r) => r.messages.map((m) => m.level);
const texts = (r, level) => r.messages.filter((m) => !level || m.level === level).map((m) => m.text).join('\n');
const linesOf = (r, t) => r.conf.filter((l) => l.startsWith('lxc.idmap: ' + t + ' '));

// Independent re-implementation of the rules Proxmox and the kernel apply to a
// finished map, used to check the generator instead of trusting it.
function parseConf(lines) {
  // pve-container parse_pct_config + parse_id_maps
  return lines.map((line) => {
    const m = line.match(/^(lxc\.[a-z0-9_\-.]+)(:|\s*=)\s*(.*?)\s*$/);
    assert.ok(m, 'config line not parsable: ' + line);
    assert.equal(m[1], 'lxc.idmap');
    const v = m[3].match(/^([ug])\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
    assert.ok(v, 'idmap value not parsable: ' + m[3]);
    return { type: v[1], ct: Number(v[2]), host: Number(v[3]), count: Number(v[4]) };
  });
}

function assertValidMap(r, base, size) {
  base = base === undefined ? 100000 : base;
  size = size === undefined ? 65536 : size;
  const entries = parseConf(r.conf);
  for (const type of ['u', 'g']) {
    const list = entries.filter((e) => e.type === type);
    assert.ok(list.length > 0, 'no ' + type + ' lines: Proxmox adds no defaults once lxc.idmap exists');
    for (const side of ['ct', 'host']) {
      // validate_id_maps: sort by start, no entry may reach into the next one
      const sorted = list.slice().sort((a, b) => a[side] - b[side]);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i - 1][side] + sorted[i - 1].count <= sorted[i][side], type + ' ' + side + ' overlap');
      }
    }
    // container side covers 0..size-1 exactly
    const sorted = list.slice().sort((a, b) => a.ct - b.ct);
    let cursor = 0;
    for (const e of sorted) {
      assert.equal(e.ct, cursor, type + ' gap or overlap at container ID ' + cursor);
      assert.ok(e.count > 0);
      assert.ok(e.host + e.count - 1 <= 4294967294, 'host ID above the 32-bit limit');
      cursor += e.count;
    }
    assert.equal(cursor, size, type + ' map does not end at ' + (size - 1));
    // root may hand out every host ID: subuid/subgid lines must cover them
    const sub = (type === 'u' ? r.subuid : r.subgid).map((s) => ({ start: s.start, end: s.start + s.count }));
    for (const e of list) {
      let id = e.host;
      const end = e.host + e.count;
      while (id < end) {
        const range = sub.find((s) => s.start <= id && id < s.end);
        assert.ok(range, type + ' host ID ' + id + ' not covered by /etc/sub' + type + 'id');
        id = range.end;
      }
    }
    // neighbouring lines that continue each other must have been merged
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      assert.ok(!(a.ct + a.count === b.ct && a.host + a.count === b.host), 'unmerged lines at ' + b.ct);
    }
  }
  return entries;
}

// map_ct_id_to_host from pve-container
function hostOf(entries, type, id) {
  for (const e of entries) {
    if (e.type === type && id >= e.ct && id < e.ct + e.count) return e.host - e.ct + id;
  }
  return null;
}

// ── Single ID ────────────────────────────────────────────

test('idmap: one UID/GID pair keeps 0-999 and 1001-65535 on the shifted range', () => {
  const r = gen();
  assert.equal(r.ok, true);
  assert.deepEqual(r.conf, [
    'lxc.idmap: u 0 100000 1000',
    'lxc.idmap: u 1000 1000 1',
    'lxc.idmap: u 1001 101001 64535',
    'lxc.idmap: g 0 100000 1000',
    'lxc.idmap: g 1000 1000 1',
    'lxc.idmap: g 1001 101001 64535'
  ]);
  assert.equal(r.confFile, '/etc/pve/lxc/100.conf');
  const entries = assertValidMap(r);
  assert.equal(hostOf(entries, 'u', 999), 100999);
  assert.equal(hostOf(entries, 'u', 1000), 1000);
  assert.equal(hostOf(entries, 'g', 1001), 101001);
  assert.equal(hostOf(entries, 'u', 65535), 165535);
  assert.equal(hostOf(entries, 'u', 65536), null);
});

test('idmap: one pair needs root:1000:1 next to the default subordinate range', () => {
  const r = gen();
  assert.deepEqual(r.subuid.map((s) => [s.line, s.present]), [['root:100000:65536', true], ['root:1000:1', false]]);
  assert.deepEqual(r.subgid.map((s) => [s.line, s.present]), [['root:100000:65536', true], ['root:1000:1', false]]);
  assert.equal(r.texts.subcmd, [
    "grep -qxF 'root:1000:1' /etc/subuid || echo 'root:1000:1' >> /etc/subuid",
    "grep -qxF 'root:1000:1' /etc/subgid || echo 'root:1000:1' >> /etc/subgid"
  ].join('\n'));
});

test('idmap: one pair produces the mp line, pct set, chown and restart commands', () => {
  const r = gen();
  assert.equal(r.mount.line, 'mp0: /mnt/bindmounts/shared,mp=/shared');
  assert.equal(r.mount.pctSet, 'pct set 100 -mp0 /mnt/bindmounts/shared,mp=/shared');
  assert.equal(r.mount.chown, 'chown -R 1000:1000 /mnt/bindmounts/shared');
  assert.deepEqual(r.apply, ['pct reboot 100', 'pct exec 100 -- ls -ln /shared']);
  assert.equal(r.mountIdmap, 'u:1000:1000:1;g:1000:1000:1');
  assert.equal(r.alt.line, 'mp0: /mnt/bindmounts/shared,mp=/shared,idmap=u:1000:1000:1;g:1000:1000:1');
  assert.equal(r.alt.pctSet, "pct set 100 -mp0 '/mnt/bindmounts/shared,mp=/shared,idmap=u:1000:1000:1;g:1000:1000:1'");
});

test('idmap: the Proxmox wiki example (uid 1005) comes out line for line', () => {
  const r = lxi.generate(lxi.presetState('wiki'));
  // pve.proxmox.com/wiki/Unprivileged_LXC_containers, written with "=" there
  const wiki = [
    'lxc.idmap = u 0 100000 1005',
    'lxc.idmap = g 0 100000 1005',
    'lxc.idmap = u 1005 1005 1',
    'lxc.idmap = g 1005 1005 1',
    'lxc.idmap = u 1006 101006 64530',
    'lxc.idmap = g 1006 101006 64530'
  ].map((l) => l.replace(' = ', ': '));
  assert.deepEqual(r.conf.slice().sort(), wiki.slice().sort());
  assert.equal(r.confFile, '/etc/pve/lxc/1234.conf');
  assert.ok(r.subuid.some((s) => s.line === 'root:1005:1'));
  assert.ok(r.subgid.some((s) => s.line === 'root:1005:1'));
  assert.equal(r.mount.chown, 'chown -R 1005:1005 /mnt/bindmounts/shared');
  assert.equal(r.mount.line, 'mp0: /mnt/bindmounts/shared,mp=/shared');
  assertValidMap(r);
});

test('idmap: every generated line matches the Proxmox parser and the mp idmap pattern', () => {
  const r = gen({ uids: [row(33, 33), row(1000, 2000, 5)] });
  parseConf(r.conf);
  // pct.conf idmap format from PVE/LXC/Config.pm
  assert.match(r.mountIdmap, /^(?:passthrough|[ug]:[0-9]+:[0-9]+:[1-9][0-9]*(?:;[ug]:[0-9]+:[0-9]+:[1-9][0-9]*)*)$/);
  for (const s of r.subuid.concat(r.subgid)) assert.match(s.line, /^root:\d+:[1-9]\d*$/);
});

// ── Several IDs ──────────────────────────────────────────

test('idmap: several pairs are sorted by container ID with shifted gaps between them', () => {
  const r = gen({ uids: [row(1005, 2005), row(33, 33), row(1000, 1000)] });
  assert.deepEqual(linesOf(r, 'u'), [
    'lxc.idmap: u 0 100000 33',
    'lxc.idmap: u 33 33 1',
    'lxc.idmap: u 34 100034 966',
    'lxc.idmap: u 1000 1000 1',
    'lxc.idmap: u 1001 101001 4',
    'lxc.idmap: u 1005 2005 1',
    'lxc.idmap: u 1006 101006 64530'
  ]);
  const entries = assertValidMap(r);
  assert.equal(hostOf(entries, 'u', 1005), 2005);
  assert.equal(hostOf(entries, 'u', 1002), 101002);
  assert.deepEqual(r.subuid.map((s) => s.line), ['root:100000:65536', 'root:33:1', 'root:1000:1', 'root:2005:1']);
});

test('idmap: a range pair maps consecutive IDs and needs one subuid line', () => {
  const r = gen({ uids: [row(1000, 2000, 10)] });
  assert.deepEqual(linesOf(r, 'u'), [
    'lxc.idmap: u 0 100000 1000',
    'lxc.idmap: u 1000 2000 10',
    'lxc.idmap: u 1010 101010 64526'
  ]);
  const entries = assertValidMap(r);
  assert.equal(hostOf(entries, 'u', 1009), 2009);
  assert.equal(hostOf(entries, 'u', 1010), 101010);
  assert.deepEqual(r.subuid.map((s) => s.line), ['root:100000:65536', 'root:2000:10']);
  assert.equal(r.mountIdmap, 'u:1000:2000:10;g:1000:2000:10');
});

test('idmap: the chown command uses the first row and warns about the other users', () => {
  const r = gen({ uids: [row(1001, 1001), row(1000, 1000)] });
  assert.equal(r.mount.chown, 'chown -R 1001:1001 /mnt/bindmounts/shared');
  assert.match(r.mount.note, /one owner/);
});

// ── Adjacent and overlapping IDs ─────────────────────────

test('idmap: adjacent pairs that continue each other on both sides merge into one line', () => {
  const r = gen({ uids: [row(1000, 1000), row(1001, 1001), row(1002, 1002)] });
  assert.deepEqual(linesOf(r, 'u'), [
    'lxc.idmap: u 0 100000 1000',
    'lxc.idmap: u 1000 1000 3',
    'lxc.idmap: u 1003 101003 64533'
  ]);
  assert.deepEqual(r.subuid.map((s) => s.line), ['root:100000:65536', 'root:1000:3']);
  assert.equal(r.mountIdmap, 'u:1000:1000:3;g:1000:1000:3');
  assertValidMap(r);
});

test('idmap: adjacent container IDs with unrelated host IDs stay separate lines', () => {
  const r = gen({ uids: [row(1000, 1000), row(1001, 3000)] });
  assert.deepEqual(linesOf(r, 'u'), [
    'lxc.idmap: u 0 100000 1000',
    'lxc.idmap: u 1000 1000 1',
    'lxc.idmap: u 1001 3000 1',
    'lxc.idmap: u 1002 101002 64534'
  ]);
  assertValidMap(r);
});

test('idmap: host IDs that touch but come from separate container IDs merge only in subuid', () => {
  const r = gen({ uids: [row(1000, 5001), row(2000, 5000)] });
  assert.equal(linesOf(r, 'u').length, 5);
  assert.deepEqual(r.subuid.map((s) => s.line), ['root:100000:65536', 'root:5000:2']);
  assertValidMap(r);
});

test('idmap: the same container UID in two rows is rejected', () => {
  const r = gen({ uids: [row(1000, 1000), row(1000, 2000)] });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /Rows 1 and 2 both map container ID 1000 \(1000 → 1000 and 1000 → 2000\)/);
  assert.equal(r.messages[0].field, 'u:1:ct');
});

test('idmap: overlapping container ranges are rejected with the first shared ID', () => {
  const r = gen({ sameGids: false, uids: [row(1000, 1000, 5), row(1003, 3000, 2)], gids: [] });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /UID rows 1 and 2 both map container UID 1003 \(1000–1004 → 1000–1004 and 1003–1004 → 3000–3001\)/);
});

test('idmap: overlaps are found between rows that are not neighbours', () => {
  const r = gen({ uids: [row(0, 5000, 100), row(200, 200), row(50, 50)] });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /Rows 1 and 3 both map container ID 50/);
});

test('idmap: two container IDs on one host ID are rejected', () => {
  const r = gen({ uids: [row(1000, 5000), row(1001, 5000)] });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /both map to host ID 5000.*kernel rejects overlapping ranges/);
  assert.equal(r.messages[0].field, 'u:1:host');
});

test('idmap: a host ID inside the shifted range of another container ID is rejected', () => {
  const r = gen({ uids: [row(1000, 100500)] });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /host ID 100500 is already taken by the shifted range, because container ID 500 maps there \(100000 \+ 500\)\. Pick a host ID outside 100000–165535/);
});

test('idmap: a range that runs into the shifted range is rejected at its first clash', () => {
  const r = gen({ uids: [row(1000, 101001, 5)] });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /host ID 101005 is already taken.*container ID 1005/);
});

test('idmap: swapping two IDs inside the shifted range is allowed', () => {
  const r = gen({ uids: [row(1000, 101001), row(1001, 101000)] });
  assert.equal(r.ok, true);
  const entries = assertValidMap(r);
  assert.equal(hostOf(entries, 'u', 1000), 101001);
  assert.equal(hostOf(entries, 'u', 1001), 101000);
  assert.deepEqual(r.subuid.map((s) => s.line), ['root:100000:65536']);
  assert.match(r.texts.subcmd, /^# Nothing to add/);
});

test('idmap: an identical repeated row is used once with a warning', () => {
  const r = gen({ uids: [row(1000, 1000), row(1000, 1000)] });
  assert.equal(r.ok, true);
  assert.match(texts(r, 'warn'), /Row 2 repeats row 1 \(1000 → 1000\)/);
  assert.equal(linesOf(r, 'u').length, 3);
});

test('idmap: a pair equal to the shifted ID changes nothing and says so', () => {
  const r = gen({ uids: [row(1000, 101000)] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.conf, ['lxc.idmap: u 0 100000 65536', 'lxc.idmap: g 0 100000 65536']);
  assert.match(texts(r, 'warn'), /changes nothing.*enter 1000 as the host ID/);
});

// ── ID 0 ─────────────────────────────────────────────────

test('idmap: container root mapped to a host user starts the map at 0 and warns', () => {
  const r = gen({ uids: [row(0, 1000)] });
  assert.equal(r.ok, true);
  assert.deepEqual(linesOf(r, 'u'), ['lxc.idmap: u 0 1000 1', 'lxc.idmap: u 1 100001 65535']);
  assert.match(texts(r, 'warn'), /remaps container root \(ID 0\) to host ID 1000 instead of 100000/);
  assertValidMap(r);
});

test('idmap: mapping a container UID to host root warns about host root', () => {
  const r = gen({ sameGids: false, uids: [row(1000, 0)], gids: [row(1000, 0)] });
  assert.equal(r.ok, true);
  const warn = texts(r, 'warn');
  assert.match(warn, /UID row 1: container UID 1000 maps to host UID 0, which is root on the host/);
  assert.match(warn, /GID row 1: container GID 1000 maps to host GID 0, the root group/);
  assert.deepEqual(r.subuid.map((s) => s.line), ['root:100000:65536', 'root:0:1']);
  assertValidMap(r);
});

test('idmap: container root to host root warns twice and still builds a valid map', () => {
  const r = gen({ uids: [row(0, 0)] });
  assert.equal(r.ok, true);
  assert.equal(r.messages.filter((m) => m.level === 'warn').length, 2);
  assert.deepEqual(linesOf(r, 'u'), ['lxc.idmap: u 0 0 1', 'lxc.idmap: u 1 100001 65535']);
});

test('idmap: host base 0 warns that the container would be privileged', () => {
  const r = gen({ base: '0', uids: [] });
  assert.match(texts(r, 'warn'), /Host base 0 maps container ID 0 to host ID 0 \(root\)/);
});

// ── ID 65535 ─────────────────────────────────────────────

test('idmap: container ID 65535 is the last ID and leaves no trailing range', () => {
  const r = gen({ uids: [row(65535, 65535)] });
  assert.equal(r.ok, true);
  assert.deepEqual(linesOf(r, 'u'), ['lxc.idmap: u 0 100000 65535', 'lxc.idmap: u 65535 65535 1']);
  assertValidMap(r);
});

test('idmap: a range ending exactly at 65535 is accepted, one more is not', () => {
  assert.equal(gen({ uids: [row(65530, 1000, 6)] }).ok, true);
  const r = gen({ uids: [row(65530, 1000, 7)] });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /container IDs 65530–65536 run past 65535.*Lower the count to 6 or less/);
});

test('idmap: container ID 0 with a count covers the start of the range', () => {
  const r = gen({ uids: [row(0, 200000, 10)] });
  assert.deepEqual(linesOf(r, 'u'), ['lxc.idmap: u 0 200000 10', 'lxc.idmap: u 10 100010 65526']);
  assertValidMap(r);
});

// ── IDs above 65535 ──────────────────────────────────────

test('idmap: container IDs above 65535 are rejected with a pointer to the range size', () => {
  const r = gen({ uids: [row(65536, 65536)] });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /container ID 65536 is out of range: use 0–65535\. Proxmox gives a container 65536 IDs/);
  assert.equal(r.messages[0].field, 'u:0:ct');
});

test('idmap: a larger range per container allows higher IDs and needs a new subuid line', () => {
  const r = gen({ size: '131072', uids: [row(70000, 70000)] });
  assert.equal(r.ok, true);
  assert.deepEqual(linesOf(r, 'u'), [
    'lxc.idmap: u 0 100000 70000',
    'lxc.idmap: u 70000 70000 1',
    'lxc.idmap: u 70001 170001 61071'
  ]);
  assertValidMap(r, 100000, 131072);
  assert.deepEqual(r.subuid.map((s) => [s.line, s.present]), [['root:100000:131072', false], ['root:70000:1', false]]);
  assert.match(r.texts.subcmd, /root:100000:131072/);
});

test('idmap: host IDs above 65535 are fine outside the shifted range', () => {
  const r = gen({ uids: [row(1000, 200000)] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.subuid.map((s) => s.line), ['root:100000:65536', 'root:200000:1']);
  assertValidMap(r);
});

test('idmap: the highest host ID is 4294967294, (uid_t) -1 is rejected', () => {
  assert.equal(gen({ uids: [row(1000, 4294967294)] }).ok, true);
  const r = gen({ uids: [row(1000, 4294967295)] });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /host ID 4294967295 is out of range: use 0–4294967294.*no ID/);
  const ranged = gen({ uids: [row(1000, 4294967290, 10)] });
  assert.match(texts(ranged, 'error'), /host IDs 4294967290–4294967299 end above 4294967294/);
});

test('idmap: a custom host base moves every shifted line', () => {
  const r = gen({ base: '200000', uids: [row(1000, 1000)] });
  assert.deepEqual(linesOf(r, 'u'), [
    'lxc.idmap: u 0 200000 1000',
    'lxc.idmap: u 1000 1000 1',
    'lxc.idmap: u 1001 201001 64535'
  ]);
  assert.deepEqual(r.subuid.map((s) => [s.line, s.present]), [['root:200000:65536', false], ['root:1000:1', false]]);
  assertValidMap(r, 200000);
});

test('idmap: base plus range size beyond the 32-bit limit is rejected', () => {
  const r = gen({ base: '4294967000', size: '65536' });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /Host base 4294967000 plus 65536 IDs ends above 4294967294/);
});

test('idmap: fewer IDs per container warns that nobody (65534) is unmapped', () => {
  const r = gen({ size: '10000', uids: [row(1000, 1000)] });
  assert.equal(r.ok, true);
  assert.match(texts(r, 'warn'), /container IDs 10000–65535 stay unmapped, nobody and nogroup \(65534\) included/);
  assertValidMap(r, 100000, 10000);
});

// ── UID ≠ GID ────────────────────────────────────────────

test('idmap: separate UID and GID pairs give different u and g lines', () => {
  const r = gen({ sameGids: false, uids: [row(1000, 1000)], gids: [row(1001, 1001), row(44, 44)] });
  assert.equal(r.ok, true);
  assert.deepEqual(linesOf(r, 'u'), [
    'lxc.idmap: u 0 100000 1000',
    'lxc.idmap: u 1000 1000 1',
    'lxc.idmap: u 1001 101001 64535'
  ]);
  assert.deepEqual(linesOf(r, 'g'), [
    'lxc.idmap: g 0 100000 44',
    'lxc.idmap: g 44 44 1',
    'lxc.idmap: g 45 100045 956',
    'lxc.idmap: g 1001 1001 1',
    'lxc.idmap: g 1002 101002 64534'
  ]);
  assert.deepEqual(r.subuid.map((s) => s.line), ['root:100000:65536', 'root:1000:1']);
  assert.deepEqual(r.subgid.map((s) => s.line), ['root:100000:65536', 'root:44:1', 'root:1001:1']);
  assert.equal(r.mount.chown, 'chown -R 1000:1001 /mnt/bindmounts/shared');
  assert.match(r.mount.note, /UID row 1, group the host GID of GID row 1/);
  assert.equal(r.mountIdmap, 'u:1000:1000:1;g:44:44:1;g:1001:1001:1');
  const entries = assertValidMap(r);
  assert.equal(hostOf(entries, 'u', 1001), 101001);
  assert.equal(hostOf(entries, 'g', 1001), 1001);
});

test('idmap: the same ID can map differently for users and groups', () => {
  const r = gen({ sameGids: false, uids: [row(1000, 3000)], gids: [row(1000, 4000)] });
  const entries = assertValidMap(r);
  assert.equal(hostOf(entries, 'u', 1000), 3000);
  assert.equal(hostOf(entries, 'g', 1000), 4000);
});

test('idmap: errors in the GID list name GID rows', () => {
  const r = gen({ sameGids: false, uids: [row(1000, 1000)], gids: [row(1000, 'x')] });
  assert.equal(r.ok, false);
  assert.match(texts(r, 'error'), /GID row 1: host GID "x" is not a whole number/);
  assert.equal(r.messages[0].field, 'g:0:host');
});

test('idmap: group-only mapping keeps the default u line and changes only the group', () => {
  const r = lxi.generate(lxi.presetState('group', lxi.defaultState()));
  assert.equal(r.ok, true);
  assert.deepEqual(linesOf(r, 'u'), ['lxc.idmap: u 0 100000 65536']);
  assert.deepEqual(linesOf(r, 'g'), [
    'lxc.idmap: g 0 100000 1001',
    'lxc.idmap: g 1001 1001 1',
    'lxc.idmap: g 1002 101002 64534'
  ]);
  assert.match(texts(r, 'info'), /No UID pairs, so the `u` line keeps users on the shifted range\. Keep it anyway/);
  assert.equal(r.mount.chown, 'chown -R :1001 /mnt/bindmounts/shared');
  assert.match(r.mount.note, /chmod -R g\+rwX \/mnt\/bindmounts\/shared/);
  assert.deepEqual(r.subuid.map((s) => s.line), ['root:100000:65536']);
  assert.equal(r.texts.subcmd, "grep -qxF 'root:1001:1' /etc/subgid || echo 'root:1001:1' >> /etc/subgid");
  assert.equal(r.mountIdmap, 'g:1001:1001:1');
  assertValidMap(r);
});

test('idmap: UID pairs with an empty GID list keep the g line', () => {
  const r = gen({ sameGids: false, uids: [row(1000, 1000)], gids: [] });
  assert.deepEqual(linesOf(r, 'g'), ['lxc.idmap: g 0 100000 65536']);
  assert.match(texts(r, 'info'), /No GID pairs, so the `g` line keeps groups/);
  assert.equal(r.mount.chown, 'chown -R 1000 /mnt/bindmounts/shared');
});

test('idmap: no pairs at all gives the Proxmox defaults and hands the folder to container root', () => {
  const r = gen({ uids: [] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.conf, ['lxc.idmap: u 0 100000 65536', 'lxc.idmap: g 0 100000 65536']);
  assert.match(texts(r, 'info'), /exactly what Proxmox already uses/);
  assert.equal(r.mount.chown, 'chown -R 100000:100000 /mnt/bindmounts/shared');
  assert.equal(r.alt, null);
  assert.equal(r.mountIdmap, '');
});

// ── Invalid input ────────────────────────────────────────

test('idmap: non-numbers, signs, decimals and blanks are rejected per field', () => {
  const cases = [
    [row('abc', 1000), /container ID "abc" is not a whole number/],
    [row(-5, 1000), /container ID "-5" is not a whole number/],
    [row(1000, '1.5'), /host ID "1\.5" is not a whole number/],
    [row(1000, ''), /host ID is empty/],
    [row('', 1000), /container ID is empty/],
    [row(1000, 1000, 0), /count 0 is out of range: use 1–65536/],
    [row(1000, '1e3'), /not a whole number/]
  ];
  for (const [r, re] of cases) {
    const res = gen({ uids: [r] });
    assert.equal(res.ok, false, JSON.stringify(r));
    assert.match(texts(res, 'error'), re, JSON.stringify(r));
  }
});

test('idmap: blank rows are ignored and an empty count means 1', () => {
  const r = gen({ uids: [{ ct: '', host: '', count: '1' }, { ct: '1000', host: '1000', count: '' }, { ct: ' ', host: '', count: '' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(linesOf(r, 'u')[1], 'lxc.idmap: u 1000 1000 1');
});

test('idmap: container ID, mount point number and range size are range-checked', () => {
  assert.match(texts(gen({ ctid: '99' }), 'error'), /Container ID 99 is out of range: use 100–999999999/);
  assert.match(texts(gen({ ctid: '1000000000' }), 'error'), /out of range/);
  assert.match(texts(gen({ ctid: 'ct100' }), 'error'), /Container ID "ct100" is not a whole number/);
  assert.match(texts(gen({ ctid: '' }), 'error'), /Container ID is empty/);
  assert.equal(gen({ ctid: '999999999' }).ok, true);
  assert.match(texts(gen({ mp: '256' }), 'error'), /Mount point number 256 is out of range: use 0–255/);
  assert.equal(gen({ mp: '255' }).mount.line, 'mp255: /mnt/bindmounts/shared,mp=/shared');
  assert.match(texts(gen({ size: '0' }), 'error'), /IDs per container 0 is out of range/);
});

test('idmap: errors come before warnings and info messages', () => {
  const r = gen({ ctid: 'x', uids: [row(1000, 1000), row(1000, 1000)] });
  assert.deepEqual(levels(r), ['error', 'warn']);
  assert.equal(r.ok, false);
});

// ── Mount paths ──────────────────────────────────────────

test('idmap: mount paths must be absolute and free of commas and dot segments', () => {
  assert.match(texts(gen({ hostPath: 'mnt/data' }), 'error'), /Host path "mnt\/data" must be an absolute path/);
  assert.match(texts(gen({ ctPath: 'data' }), 'error'), /Path in container "data" must be an absolute path/);
  assert.match(texts(gen({ hostPath: '/mnt/a,b' }), 'error'), /contains a comma/);
  assert.match(texts(gen({ hostPath: '/mnt/../etc' }), 'error'), /`\/\.\/` or `\/\.\.\/` segment/);
  assert.match(texts(gen({ ctPath: '/data/.' }), 'error'), /segment/);
  assert.match(texts(gen({ ctPath: '' }), 'error'), /Path in container is empty/);
  assert.equal(gen({ hostPath: '/mnt/..data' }).ok, true);
});

test('idmap: system directories and mounting at / are warned about', () => {
  assert.match(texts(gen({ hostPath: '/etc/' }), 'warn'), /Host path \/etc is a system directory/);
  assert.match(texts(gen({ hostPath: '/' }), 'warn'), /Host path \/ is a system directory/);
  assert.match(texts(gen({ ctPath: '/' }), 'warn'), /Mounting at \/ would hide/);
  assert.equal(gen({ hostPath: '/etcetera' }).messages.filter((m) => m.level === 'warn').length, 0);
});

test('idmap: an empty host path skips the mount, chown and mount point idmap', () => {
  const r = gen({ hostPath: '', ctPath: '' });
  assert.equal(r.ok, true);
  assert.equal(r.mount, null);
  assert.equal(r.alt, null);
  assert.deepEqual(r.apply, ['pct reboot 100']);
  assert.equal(r.texts.chown, '');
});

test('idmap: paths with spaces or quotes are shell-quoted in commands only', () => {
  const r = gen({ hostPath: "/mnt/Bob's media", ctPath: '/media files' });
  assert.equal(r.mount.line, "mp0: /mnt/Bob's media,mp=/media files");
  assert.equal(r.mount.pctSet, "pct set 100 -mp0 '/mnt/Bob'\\''s media,mp=/media files'");
  assert.equal(r.mount.chown, "chown -R 1000:1000 '/mnt/Bob'\\''s media'");
  assert.equal(r.apply[1], "pct exec 100 -- ls -ln '/media files'");
});

test('idmap: shellQuote leaves plain paths alone and quotes everything else', () => {
  assert.equal(lxi.shellQuote('/mnt/data-1/x_y.z'), '/mnt/data-1/x_y.z');
  assert.equal(lxi.shellQuote('/a,mp=/b'), '/a,mp=/b');
  assert.equal(lxi.shellQuote('/a;b'), "'/a;b'");
  assert.equal(lxi.shellQuote('/a$HOME'), "'/a$HOME'");
  assert.equal(lxi.shellQuote("it's"), "'it'\\''s'");
});

// ── subidRanges ──────────────────────────────────────────

test('idmap: subidRanges splits host ranges around the base range', () => {
  const out = lxi.subidRanges([{ host: 99990, count: 20 }, { host: 165530, count: 10 }], 100000, 65536);
  assert.deepEqual(out.map((o) => [o.line, o.isBase, o.present]), [
    ['root:100000:65536', true, true],
    ['root:99990:10', false, false],
    ['root:165536:4', false, false]
  ]);
  assert.deepEqual(lxi.subidRanges([{ host: 1000, count: 1 }], 100000, 65536).map((o) => o.line), ['root:1000:1']);
});

// ── URL hash ─────────────────────────────────────────────

test('idmap: encodeState is compact for the default mapping', () => {
  assert.equal(lxi.encodeState(lxi.defaultState()), 'ct=100&u=1000-1000&hp=/mnt/bindmounts/shared&cp=/shared');
});

test('idmap: decodeState(encodeState(x)) round-trips every field', () => {
  const s = state({
    ctid: '1234', base: '200000', size: '131072', mp: '7',
    uids: [row(1000, 2000, 5), row(33, 33)],
    sameGids: false, gids: [row(44, 44), row('1-2', '3.4')],
    hostPath: '/mnt/my data/x.y-z', ctPath: '/srv/a&b=c#d'
  });
  const back = lxi.decodeState('#' + lxi.encodeState(s));
  assert.deepEqual(back, lxi.normalizeState(s));
});

test('idmap: decodeState ignores unrelated hashes and caps the row count', () => {
  assert.equal(lxi.decodeState(''), null);
  assert.equal(lxi.decodeState('#section-2'), null);
  const many = Array.from({ length: 80 }, (_, i) => (1000 + i) + '-' + (1000 + i)).join('.');
  const s = lxi.decodeState('#ct=100&u=' + many);
  assert.equal(s.uids.length, lxi.MAX_PAIRS);
  assert.equal(s.sameGids, true);
  assert.equal(lxi.decodeState('#ct=%E0%A4%A').ctid, '');
});

// ── Presets and helpers ──────────────────────────────────

test('idmap: presets set the mapping and keep the container and paths', () => {
  const current = state({ ctid: '205', hostPath: '/tank/media', ctPath: '/media' });
  const group = lxi.presetState('group', current);
  assert.equal(group.ctid, '205');
  assert.equal(group.hostPath, '/tank/media');
  assert.equal(group.sameGids, false);
  assert.deepEqual(group.uids, []);
  const user = lxi.presetState('user', group);
  assert.deepEqual(user.uids, [row(1000, 1000)]);
  assert.equal(user.sameGids, true);
  assert.deepEqual(lxi.presetState('reset', current), lxi.defaultState());
  assert.equal(lxi.presetState('wiki', current).ctid, '1234');
});

test('idmap: formatText escapes HTML before turning backticks into code', () => {
  assert.equal(lxi.formatText('Run `pct mount <id>` & wait'), 'Run <code class="lxi-code">pct mount &lt;id&gt;</code> &amp; wait');
});

test('idmap: explanations tell shifted ranges from pairs', () => {
  const r = gen();
  assert.equal(r.explain[0].text, 'Container UIDs 0–999 → host UIDs 100000–100999: the shifted range (100000 + ID), unprivileged on the host.');
  assert.match(r.explain[1].text, /^Container UID 1000 → host UID 1000: your pair\./);
  assert.match(r.explain[4].text, /^Container GID 1000 → host GID 1000/);
  assert.match(r.coverage, /from 0 to 65535 appears exactly once/);
});

test('idmap: existing files of a remapped ID are flagged with their current host owner', () => {
  const r = gen({ ctid: '101' });
  assert.match(texts(r, 'info'), /container UID 1000 is stored as host UID 101000 today/);
  assert.match(texts(r, 'info'), /`pct mount 101`/);
});

// ── Property check ───────────────────────────────────────

test('idmap: random valid inputs always give a complete, overlap-free map', () => {
  let seed = 42;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  let built = 0;
  for (let round = 0; round < 300; round++) {
    const uids = [];
    const n = 1 + rand(6);
    for (let i = 0; i < n; i++) {
      const ct = rand(65536);
      const count = 1 + rand(4);
      const host = rand(3) === 0 ? 200000 + rand(100000) : rand(99000);
      uids.push(row(ct, host, count));
    }
    const r = gen({ uids });
    if (!r.ok) {
      assert.ok(r.messages.some((m) => m.level === 'error'), 'not ok without an error');
      continue;
    }
    built++;
    const entries = assertValidMap(r);
    // every valid pair really maps where the user asked
    for (const u of uids) {
      for (let k = 0; k < Number(u.count); k++) {
        assert.equal(hostOf(entries, 'u', Number(u.ct) + k), Number(u.host) + k);
      }
    }
  }
  assert.ok(built > 100, 'too few valid random cases: ' + built);
});
