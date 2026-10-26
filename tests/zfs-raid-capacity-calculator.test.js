// tests/zfs-raid-capacity-calculator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript } = require('./_setup');

const zrc = loadScript('zfs-raid-capacity-calculator/script.js');

const B = BigInt;
const TB = B('1000000000000');
const TiB = B('1099511627776');
const GiB = B('1073741824');
const MiB = B('1048576');
const K128 = 131072;
const L = zrc.LAYOUTS;

const disks = (n, bytes) => Array.from({ length: n }, () => bytes);
const state = (patch) => Object.assign(zrc.defaultState(), patch || {});
const pool = (active, id, vdevs, ashift, rs, fillBps) =>
  zrc.computePool(active, L[id], vdevs, ashift || 12, rs || K128, fillBps || 8000);

// A direct, line-by-line port of vdev_raidz_psize_to_asize() from OpenZFS 2.4.4
// (module/zfs/vdev_raidz.c), kept separate from the tool's own implementation:
//   asize = ((psize - 1) >> ashift) + 1;
//   asize += nparity * ((asize + cols - nparity - 1) / (cols - nparity));
//   asize = roundup(asize, nparity + 1) << ashift;
function openzfsRaidzAsize(psize, ashift, nparity, cols) {
  const one = B(1);
  const a = B(ashift);
  const p = B(nparity);
  const c = B(cols);
  let asize = ((B(psize) - one) >> a) + one;
  asize += p * ((asize + c - p - one) / (c - p));
  const y = p + one;
  asize = ((asize + (y - one)) / y) * y;   // #define roundup(x, y) ((((x) + ((y) - 1)) / (y)) * (y))
  return asize << a;
}

// ─────────────────────────────────────────────────────────────────────────────
// Units: TB versus TiB, decimal input
// ─────────────────────────────────────────────────────────────────────────────

test('disk sizes convert exactly: TB and GB are decimal, TiB and GiB binary', () => {
  assert.equal(zrc.sizeToBytes('16', 'TB'), B('16000000000000'));
  assert.equal(zrc.sizeToBytes('1', 'TiB'), B('1099511627776'));
  assert.equal(zrc.sizeToBytes('3.84', 'TB'), B('3840000000000'));
  assert.equal(zrc.sizeToBytes('1,5', 'TiB'), B('1649267441664'));       // 1.5 x 2^40
  assert.equal(zrc.sizeToBytes('500', 'GB'), B('500000000000'));
  assert.equal(zrc.sizeToBytes('960', 'GiB'), B('1030792151040'));       // 960 x 2^30
  assert.equal(zrc.sizeToBytes('16 000 900 661 248', 'B'), B('16000900661248'));
  assert.equal(zrc.sizeToBytes('.5', 'TB'), B('500000000000'));
  // 4 TiB is 4.398046511104 TB: both spellings give the same byte count
  assert.equal(zrc.sizeToBytes('4', 'TiB'), zrc.sizeToBytes('4.398046511104', 'TB'));
  for (const bad of ['', 'abc', '1.2.3', '-1', '1,2.3', '1,,2', '4TB']) {
    assert.equal(zrc.sizeToBytes(bad, 'TB'), null, bad);
  }
  assert.equal(zrc.sizeToBytes('4', 'PB'), null);
});

test('results print in TB and TiB (16 TB = 14.55 TiB)', () => {
  assert.equal(zrc.formatBytes(16n * TB, false), '16.00 TB');
  assert.equal(zrc.formatBytes(16n * TB, true), '14.55 TiB');            // 16e12 / 2^40 = 14.5519
  assert.equal(zrc.formatBytes(TiB, true), '1.00 TiB');
  assert.equal(zrc.formatBytes(TiB, false), '1.10 TB');
  assert.equal(zrc.formatBytes(1234n * TB, false), '1,234.00 TB');       // no PB: figures stay comparable
  assert.equal(zrc.formatBytes(B('500000000000'), false), '500.00 GB');
  assert.equal(zrc.formatBytes(128n * GiB, true), '128.00 GiB');
  assert.equal(zrc.formatBytes(0n, true), '0 TiB');
  assert.equal(zrc.formatPct(1n, 4n), '25.0%');
});

// ─────────────────────────────────────────────────────────────────────────────
// Raw capacity and per-disk reserves
// ─────────────────────────────────────────────────────────────────────────────

test('raw capacity is the sum of every disk, spares included', () => {
  const r = zrc.compute(state({
    disks: [{ qty: '4', size: '8', unit: 'TB' }, { qty: '2', size: '4', unit: 'TiB' }],
    layout: 'raidz2', spares: '1'
  }));
  assert.equal(r.disks.length, 6);
  assert.equal(r.raw, 4n * 8n * TB + 2n * 4n * TiB);                    // 32 TB + 8 TiB
  assert.equal(r.active.length, 5);
  assert.equal(r.spareBytes, 4n * TiB);                                  // spares come from the end of the list
});

test('whole-disk partition and leaf vdev size follow zpool_label_disk() and vdev_open()', () => {
  // 16 TB = 31,250,000,000 sectors. Last usable LBA = N - 1 - 33.
  // Partition 1 = (N - 34 + 1) - 16384 (8 MiB partition 9) - 2048 (start) = 31,249,981,535 sectors,
  // rounded down to 2048 sectors = 31,249,981,440 sectors = 15,999,990,497,280 bytes.
  assert.equal(zrc.partitionBytes(16n * TB), B('15999990497280'));
  // Leaf asize = partition - 2 labels and 3.5 MiB boot area (4 MiB) - 2 labels at the end (512 KiB)
  assert.equal(zrc.leafAsize(16n * TB), B('15999990497280') - 4n * MiB - 512n * 1024n);
  // 4 TB: 7,812,500,000 - 18,465 = 7,812,481,535 -> 7,812,481,024 sectors
  assert.equal(zrc.partitionBytes(4n * TB), B('3999990284288'));
  assert.equal(zrc.leafAsize(4n * TB), B('3999985565696'));
  // Smallest whole disk: partition of 64 MiB = 131,072 sectors + 18,465 = 149,537 sectors
  assert.equal(zrc.minDiskBytes(), 149537n * 512n);
  assert.equal(zrc.partitionBytes(zrc.minDiskBytes()), 64n * MiB);
  assert.equal(zrc.partitionBytes(zrc.minDiskBytes() - 512n), 64n * MiB - 1024n * 1024n);
});

test('disks too small for SPA_MINDEVSIZE or above 1 PB are rejected with the row named', () => {
  const small = zrc.compute(state({ disks: [{ qty: '3', size: '50', unit: 'GB' }, { qty: '2', size: '70', unit: 'B' }] }));
  assert.equal(small.pool, null);
  assert.ok(small.issues.some((i) => /^Disk row 2: 70 bytes is too small/.test(i.text)));
  assert.ok(small.issues.some((i) => /76\.56 MB or more/.test(i.text)));
  const huge = zrc.compute(state({ disks: [{ qty: '1', size: '2000', unit: 'TB' }] }));
  assert.ok(huge.issues.some((i) => /Disk row 1: 2000 TB is more than the 1 PB/.test(i.text)));
  const bad = zrc.compute(state({ disks: [{ qty: 'two', size: '8', unit: 'TB' }, { qty: '1', size: 'x', unit: 'TB' }] }));
  assert.ok(bad.issues.some((i) => /Disk row 1: the quantity "two"/.test(i.text)));
  assert.ok(bad.issues.some((i) => /Disk row 2: "x" is not a size/.test(i.text)));
});

test('an empty quantity counts as 1 and a fully empty row is skipped', () => {
  const g = zrc.parseGroups([{ qty: '', size: '8', unit: 'TB' }, { qty: '', size: '', unit: 'TB' }, { qty: '2', size: '4', unit: 'TB' }]);
  assert.equal(g.errors.length, 0);
  assert.equal(g.disks.length, 3);
  assert.equal(g.rows[1].skipped, true);
  assert.equal(zrc.parseGroups([{ qty: '', size: '', unit: 'TB' }]).errors[0], 'Add at least one disk: type how many disks and their size.');
  assert.match(zrc.parseGroups([{ qty: '1000', size: '1', unit: 'TB' }, { qty: '30', size: '1', unit: 'TB' }]).errors[0], /1030 disks; this calculator handles up to 1024/);
});

// ─────────────────────────────────────────────────────────────────────────────
// RAIDZ allocation: parity, padding and the deflate ratio
// ─────────────────────────────────────────────────────────────────────────────

test('RAIDZ asize at 128K records, worked by hand for several widths and ashift 9/12/13', () => {
  const cases = [
    // [parity, width, ashift, expected bytes, working]
    [1, 3, 12, 196608],   // OpenZFS RAIDZ docs example: 32 data + 16 parity = 48 sectors = 192K (66%)
    [1, 4, 12, 180224],   // 32 + ceil(32/3)=11 -> 43 -> roundup to 2 -> 44 sectors
    [1, 5, 12, 163840],   // 32 + 8 = 40 sectors, already a multiple of 2
    [2, 6, 12, 196608],   // 32 + 2 x 8 = 48, multiple of 3
    [2, 12, 12, 172032],  // 32 + 2 x ceil(32/10)=8 -> 40 -> roundup to 3 -> 42 sectors
    [3, 8, 12, 229376],   // 32 + 3 x ceil(32/5)=21 -> 53 -> roundup to 4 -> 56 sectors
    [2, 12, 9, 158208],   // 256 + 2 x ceil(256/10)=52 -> 308 -> 309 sectors of 512 B
    [2, 12, 13, 172032],  // 16 + 2 x 2 = 20 -> 21 sectors of 8 KiB
    [1, 3, 13, 196608],   // 16 + 8 = 24 sectors of 8 KiB
    [1, 3, 9, 196608]     // 256 + 128 = 384 sectors of 512 B
  ];
  for (const [p, w, a, expected] of cases) {
    assert.equal(zrc.raidzPsizeToAsize(B(K128), a, p, w), B(expected), `raidz${p} ${w}-wide ashift ${a}`);
    assert.equal(openzfsRaidzAsize(K128, a, p, w), B(expected), `port: raidz${p} ${w}-wide ashift ${a}`);
  }
  // Small records: a 4K record on 3-wide RAIDZ1 ashift 12 costs one data and one parity sector (50%, like a mirror)
  assert.equal(zrc.raidzPsizeToAsize(4096n, 12, 1, 3), 8192n);
});

test('RAIDZ asize matches the OpenZFS formula for every width 2-24, parity 1-3, ashift 9/12/13', () => {
  for (const a of [9, 12, 13]) {
    for (let p = 1; p <= 3; p++) {
      for (let w = p + 1; w <= 24; w++) {
        for (const rs of [4096, 16384, K128, 1048576]) {
          assert.equal(zrc.raidzPsizeToAsize(B(rs), a, p, w), openzfsRaidzAsize(rs, a, p, w), `raidz${p} w${w} a${a} rs${rs}`);
        }
      }
    }
  }
});

test('deflate ratio uses the 128K block and integer division, like vdev_set_deflate_ratio()', () => {
  assert.equal(zrc.deflateRatio(L.raidz2, 12, 12), 390n);    // 131072 / (172032 >> 9 = 336) = 390.09
  assert.equal(zrc.deflateRatio(L.raidz1, 3, 12), 341n);     // 131072 / 384
  assert.equal(zrc.deflateRatio(L.raidz2, 6, 12), 341n);     // 131072 / 384
  assert.equal(zrc.deflateRatio(L.mirror2, 2, 12), 512n);    // no parity: 1:1
  assert.equal(zrc.deflateRatio(L.stripe, 1, 16), 512n);     // 128K is a multiple of 64 KiB
  assert.equal(zrc.defaultPsizeToAsize(4096n, 13), 8192n);  // mirrors round up to the sector size
});

test('padding at the chosen record size: 1M records waste less on a 12-wide RAIDZ2', () => {
  const p128 = pool(disks(12, 16n * TB), 'raidz2', 1, 12, K128);
  const p1m = pool(disks(12, 16n * TB), 'raidz2', 1, 12, 1048576);
  const space = p128.zpoolSize;
  // 128K: 128 KiB of data per 168 KiB allocated; 1M: 256 + 52 = 308 -> 309 sectors = 1,265,664 bytes
  assert.equal(p128.recordAsize, 172032n);
  assert.equal(p1m.recordAsize, 1265664n);
  assert.equal(p128.atRecord, space * 131072n / 172032n);
  assert.equal(p1m.atRecord, space * 1048576n / 1265664n);
  assert.ok(p1m.atRecord > p128.atRecord);
  // Parity alone would leave 10/12 of the space; padding takes the rest of the gap
  assert.equal(p128.afterReserves, space * 10n / 12n);
  assert.ok(p128.atRecord < p128.afterReserves);
});

test('mirrors and stripes lose nothing to padding unless records are smaller than a sector', () => {
  const m = pool(disks(2, 4n * TB), 'mirror2', 1, 12, K128);
  assert.equal(m.atRecord, m.afterReserves);
  const tiny = pool(disks(2, 4n * TB), 'mirror2', 1, 13, 4096);
  assert.equal(tiny.atRecord, tiny.afterReserves / 2n);      // 4K record in an 8K sector
});

// ─────────────────────────────────────────────────────────────────────────────
// Metaslabs and slop space
// ─────────────────────────────────────────────────────────────────────────────

test('metaslab size follows vdev_metaslab_set_size()', () => {
  assert.equal(zrc.metaslabShift(50n * GiB), 29n);                        // 100 metaslabs: default 512 MiB
  assert.equal(zrc.metaslabShift(4n * GiB), 29n);                         // 8 < 16: highbit(4 GiB / 16) = 29
  assert.equal(zrc.metaslabShift(GiB), 27n);                              // highbit(64 MiB) = 27
  assert.equal(zrc.metaslabShift(64n * MiB), 24n);                        // never below SPA_MAXBLOCKSHIFT
  assert.equal(zrc.metaslabShift(TB), 33n);                               // highbit(5e9) = 33 (8 GiB)
  assert.equal(zrc.metaslabShift(16n * TB), 34n);                         // capped at 16 GiB
  assert.equal(zrc.metaslabShift(B('3000000000000000')), 35n);            // 174,622 > 131,072: highbit(2.29e10)
  assert.equal(zrc.highbit64(1n), 1n);
  assert.equal(zrc.highbit64(0n), 0n);
});

test('slop space: 1/32 of the pool, at least 128 MiB (at most half the pool), at most 128 GiB', () => {
  assert.equal(zrc.slopSpace(TiB, 0n), 32n * GiB);                        // 1/32
  assert.equal(zrc.slopSpace(10n * TiB, 0n), 128n * GiB);                 // 320 GiB capped at 128 GiB
  assert.equal(zrc.slopSpace(GiB, 0n), 128n * MiB);                       // 32 MiB raised to 128 MiB
  assert.equal(zrc.slopSpace(4n * GiB, 0n), 128n * MiB);                  // exactly 1/32
  assert.equal(zrc.slopSpace(200n * MiB, 0n), 100n * MiB);                // the minimum is limited to half the pool
  // The embedded log metaslabs come off the slop, but never more than half of it
  assert.equal(zrc.slopSpace(10n * TiB, 16n * GiB), 112n * GiB);
  assert.equal(zrc.slopSpace(10n * TiB, 100n * GiB), 64n * GiB);
  assert.equal(zrc.slopSpace(TiB, 4n * GiB), 28n * GiB);
});

test('a 2-way mirror of 4 TB disks: every step by hand, 3.51 TiB in zfs list', () => {
  const p = pool(disks(2, 4n * TB), 'mirror2', 1);
  const v = p.vdevs[0];
  assert.equal(v.asize, B('3999985565696'));                              // the smaller leaf
  assert.equal(v.msShift, 34n);                                           // highbit(asize / 200) = 35 -> 34
  assert.equal(v.msCount, 232n);                                          // 3,999,985,565,696 / 16 GiB = 232.8
  assert.equal(p.zpoolSize, 232n * 16n * GiB);                            // 3,985,729,650,688 = 3.625 TiB
  assert.equal(p.embedded, 16n * GiB);                                    // 232 > 64 metaslabs: one for the ZIL
  assert.equal(p.rdspace, B('3968549781504'));
  assert.equal(p.slop, B('124017180672') - 16n * GiB);                    // rdspace / 32 - embedded log
  assert.equal(p.zfsTotal, B('3861712470016'));
  assert.equal(zrc.formatBytes(p.zfsTotal, true), '3.51 TiB');
  assert.equal(p.ideal, 4n * TB);
  assert.equal(p.redundancy, 4n * TB);
});

test('sanity check: 12-wide RAIDZ2 of 16 TB disks gives about 132.9 TiB (forum report: ~132 TiB)', () => {
  const p = pool(disks(12, 16n * TB), 'raidz2', 1);
  assert.equal(p.vdevs[0].msCount, 11175n);
  assert.equal(p.zpoolSize, 11175n * 16n * GiB);                          // zpool list SIZE 174.6 TiB
  assert.equal(p.dspace, (p.zpoolSize >> 9n) * 390n);
  assert.equal(p.embedded, (16n * GiB >> 9n) * 390n);
  assert.equal(p.slop, 128n * GiB - p.embedded);
  assert.equal(p.zfsTotal, p.dspace - 128n * GiB);                        // big pool: total - 128 GiB
  assert.equal(p.zfsTotal, B('146101164310528'));
  assert.equal(zrc.formatBytes(p.zfsTotal, true), '132.88 TiB');
  assert.equal(zrc.formatBytes(p.zpoolSize, true), '174.61 TiB');
  // Real data at 128K records is a hair above zfs list because 131072/336 is rounded down to 390
  assert.ok(p.afterSlop > p.zfsTotal);
  assert.equal(p.afterSlop, p.zfsTotal * 131072n / (336n * 390n));
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple vdevs and mixed disk sizes
// ─────────────────────────────────────────────────────────────────────────────

test('two RAIDZ1 vdevs of 3 x 4 TB: per-vdev metaslabs, pool-wide slop', () => {
  const p = pool(disks(6, 4n * TB), 'raidz1', 2);
  assert.equal(p.vdevs.length, 2);
  const v = p.vdevs[0];
  assert.equal(v.asize, 3n * B('3999985565696'));                          // 3 x the smallest leaf
  assert.equal(v.msCount, 698n);
  assert.equal(v.deflate, 341n);
  assert.equal(v.dspace, (698n * 16n * GiB >> 9n) * 341n);                 // 7,986,558,795,776
  assert.equal(p.dspace, 2n * B('7986558795776'));
  assert.equal(p.embedded, 2n * (16n * GiB >> 9n) * 341n);                 // one ZIL metaslab per vdev
  assert.equal(p.slop, 128n * GiB - p.embedded);
  assert.equal(p.zfsTotal, B('15835678638080'));
  assert.equal(p.ideal, 2n * 2n * 4n * TB);                                // 2 data disks per vdev
  assert.equal(p.redundancy, 2n * 4n * TB);
});

test('mixed disk sizes: each disk counts up to the smallest in its vdev, in list order', () => {
  const sorted = pool([4n * TB, 4n * TB, 8n * TB, 8n * TB], 'mirror2', 2);
  assert.equal(sorted.ideal, 12n * TB);
  assert.equal(sorted.mixedWaste, 0n);
  const interleaved = pool([4n * TB, 8n * TB, 4n * TB, 8n * TB], 'mirror2', 2);
  assert.equal(interleaved.ideal, 8n * TB);
  assert.equal(interleaved.mixedWaste, 8n * TB);
  const rz = pool([4n * TB, 4n * TB, 8n * TB], 'raidz1', 1);
  assert.equal(rz.ideal, 8n * TB);
  assert.equal(rz.mixedWaste, 4n * TB);
  assert.equal(rz.vdevs[0].asize, 3n * zrc.leafAsize(4n * TB));
  // The step totals still add up to the raw capacity
  assert.equal(rz.mixedWaste + rz.redundancy + rz.ideal, rz.raw);
});

test('a mixed-size vdev warns with the sizes, the unused space and the zpool create error', () => {
  const r = zrc.compute(state({ disks: [{ qty: '1', size: '4', unit: 'TB' }, { qty: '1', size: '8', unit: 'TB' }], layout: 'mirror2' }));
  const w = r.issues.find((i) => i.level === 'warn' && /mixes disk sizes/.test(i.text));
  assert.ok(w);
  assert.match(w.text, /4\.00 TB to 8\.00 TB/);
  assert.match(w.text, /so 4\.00 TB stays unused/);
  assert.match(w.text, /"mirror contains devices of different sizes" unless you add -f/);
  // Within the 16 MiB ZPOOL_FUZZ there is no warning
  const close = zrc.compute(state({ disks: [{ qty: '1', size: '4000000000000', unit: 'B' }, { qty: '1', size: '4000010000000', unit: 'B' }], layout: 'mirror2' }));
  assert.ok(!close.issues.some((i) => /mixes disk sizes/.test(i.text)));
});

// ─────────────────────────────────────────────────────────────────────────────
// Target fill level
// ─────────────────────────────────────────────────────────────────────────────

test('target fill applies to the allocatable space and is capped by the slop space', () => {
  const p80 = pool(disks(12, 16n * TB), 'raidz2', 1, 12, K128, 8000);
  assert.equal(p80.atFill, p80.atRecord * 8000n / 10000n);
  const small97 = pool(disks(2, 4n * TB), 'mirror2', 1, 12, K128, 9700);
  assert.equal(small97.atFill, small97.afterSlop);                        // 97% > 96.9% left after slop
  const big97 = pool(disks(12, 16n * TB), 'raidz2', 1, 12, K128, 9700);
  assert.equal(big97.atFill, big97.atRecord * 9700n / 10000n);            // slop is under 0.1% here
  const full = pool(disks(12, 16n * TB), 'raidz2', 1, 12, K128, 10000);
  assert.equal(full.atFill, full.afterSlop);
});

test('fill input: default 80, decimals allowed, outside 1-100 is an error; above 90 warns', () => {
  assert.equal(zrc.compute(state({ fill: '' })).fillBps, 8000);
  assert.equal(zrc.compute(state({ fill: '85,5' })).fillBps, 8550);
  for (const bad of ['0', '101', 'abc', '-5']) {
    const r = zrc.compute(state({ fill: bad }));
    assert.equal(r.pool, null, bad);
    assert.ok(r.issues.some((i) => i.level === 'error' && /must be a percentage from 1 to 100/.test(i.text)), bad);
  }
  const high = zrc.compute(state({ fill: '95' }));
  assert.ok(high.issues.some((i) => i.level === 'warn' && /less than 10% free/.test(i.text)));
});

// ─────────────────────────────────────────────────────────────────────────────
// Fault tolerance
// ─────────────────────────────────────────────────────────────────────────────

test('disks that may fail: guaranteed per pool versus best case across vdevs', () => {
  assert.deepEqual(zrc.faultTolerance(L.stripe, 6), { perVdev: 0, guaranteed: 0, best: 0 });
  assert.deepEqual(zrc.faultTolerance(L.mirror2, 6), { perVdev: 1, guaranteed: 1, best: 6 });   // one survivor per pair
  assert.deepEqual(zrc.faultTolerance(L.mirror3, 4), { perVdev: 2, guaranteed: 2, best: 8 });
  assert.deepEqual(zrc.faultTolerance(L.mirror4, 1), { perVdev: 3, guaranteed: 3, best: 3 });
  assert.deepEqual(zrc.faultTolerance(L.raidz1, 3), { perVdev: 1, guaranteed: 1, best: 3 });
  assert.deepEqual(zrc.faultTolerance(L.raidz2, 2), { perVdev: 2, guaranteed: 2, best: 4 });
  assert.deepEqual(zrc.faultTolerance(L.raidz3, 1), { perVdev: 3, guaranteed: 3, best: 3 });
  const r = zrc.compute(state({ disks: [{ qty: '12', size: '4', unit: 'TB' }], layout: 'mirror2' }));
  assert.equal(r.pool.vdevCount, 6);
  assert.deepEqual(r.pool.tolerance, { perVdev: 1, guaranteed: 1, best: 6 });
  assert.ok(r.issues.every((i) => !/no redundancy/.test(i.text)));
  const s = zrc.compute(state({ layout: 'stripe' }));
  assert.ok(s.issues.some((i) => i.level === 'warn' && /no redundancy/.test(i.text)));
});

// ─────────────────────────────────────────────────────────────────────────────
// Layout rules and invalid layouts
// ─────────────────────────────────────────────────────────────────────────────

test('valid vdev counts per layout', () => {
  assert.deepEqual(zrc.validVdevCounts('raidz2', 12), [1, 2, 3, 4]);       // widths 12, 6, 4, 3
  assert.deepEqual(zrc.validVdevCounts('raidz1', 6), [1, 2, 3]);
  assert.deepEqual(zrc.validVdevCounts('raidz3', 3), []);
  assert.deepEqual(zrc.validVdevCounts('mirror2', 8), [4]);
  assert.deepEqual(zrc.validVdevCounts('mirror3', 8), []);
  assert.deepEqual(zrc.validVdevCounts('stripe', 5), [5]);
  assert.deepEqual(zrc.validVdevCounts('raidz1', 510), [2, 3, 5, 6, 10, 15, 17, 30, 34, 51, 85, 102, 170, 255]);  // width 255 at most
});

test('invalid layouts explain the numbers and the fix', () => {
  const rz3 = zrc.resolveLayout('raidz3', 3, '');
  assert.equal(rz3.error, 'RAIDZ3 needs at least 4 disks per vdev (parity + 1); 3 disks in one vdev are not enough. Add 1 disk, or use RAIDZ2 or a mirror.');
  const split = zrc.resolveLayout('raidz2', 12, '5');
  assert.equal(split.error, '12 disks do not split evenly into 5 vdevs. Valid vdev counts for RAIDZ2 with 12 disks: 1 (12 wide), 2 (6 wide), 3 (4 wide), 4 (3 wide).');
  const narrow = zrc.resolveLayout('raidz1', 6, '6');
  assert.equal(narrow.error, 'RAIDZ1 needs at least 2 disks per vdev (parity + 1); 6 vdevs of 1 disk are not enough. Use fewer vdevs: 1 (6 wide), 2 (3 wide), 3 (2 wide).');
  const odd = zrc.resolveLayout('mirror2', 7, '');
  assert.equal(odd.error, '7 disks do not split into 2-way mirrors: 3 mirrors use 6 disks and 1 is left over. Set 1 hot spare, add 1 disk, or pick another layout.');
  assert.match(zrc.resolveLayout('mirror3', 2, '').error, /^A 3-way mirror needs at least 3 disks; there are 2/);
  assert.match(zrc.resolveLayout('raidz2', 6, 'two').error, /whole number of 1 or more; "two" is not/);
  assert.match(zrc.resolveLayout('raidz2', 6, '0').error, /whole number of 1 or more; "0" is not/);
  assert.match(zrc.resolveLayout('raidz1', 256, '').error, /at most 255 disks.*Valid vdev counts: 2 \(128 wide\)/);
  assert.match(zrc.resolveLayout('raidz1', 1, '').error, /RAIDZ1 needs at least 2 disks per vdev \(parity \+ 1\); 1 disk in one vdev is not enough\. Add 1 disk, or use a single-disk stripe\.$/);
  assert.match(zrc.resolveLayout('raidz3', 1, '').error, /Add 3 disks, or use a single-disk stripe\.$/);
  assert.match(zrc.resolveLayout('raidz2', 2, '').error, /Add 1 disk, or use RAIDZ1 or a mirror\.$/);
  // Valid ones
  assert.deepEqual(pick(zrc.resolveLayout('raidz2', 12, '')), { vdevs: 1, width: 12, error: null });
  assert.deepEqual(pick(zrc.resolveLayout('raidz2', 12, ' 2 ')), { vdevs: 2, width: 6, error: null });
  assert.deepEqual(pick(zrc.resolveLayout('mirror3', 9, '42')), { vdevs: 3, width: 3, error: null });   // vdev field ignored
  assert.deepEqual(pick(zrc.resolveLayout('stripe', 5, '')), { vdevs: 5, width: 1, error: null });
});

function pick(r) { return { vdevs: r.vdevs, width: r.width, error: r.error }; }

test('compute(): an invalid layout leaves the pool empty but still compares layouts and classic RAID', () => {
  const r = zrc.compute(state({ disks: [{ qty: '3', size: '8', unit: 'TB' }], layout: 'raidz3' }));
  assert.equal(r.pool, null);
  assert.ok(r.issues.some((i) => i.level === 'error' && /RAIDZ3 needs at least 4 disks/.test(i.text)));
  assert.ok(r.compare.length > 0);
  assert.equal(r.classic.length, 5);
});

test('hot spares: must leave at least one disk and must be a whole number', () => {
  const all = zrc.compute(state({ spares: '6' }));
  assert.ok(all.issues.some((i) => /6 hot spares leave no disks for the pool \(6 disks in total\). Use at most 5\./.test(i.text)));
  assert.equal(all.sparesBad, true);
  const word = zrc.compute(state({ spares: 'one' }));
  assert.ok(word.issues.some((i) => /Hot spares must be a whole number/.test(i.text)));
  const one = zrc.compute(state({ disks: [{ qty: '7', size: '4', unit: 'TB' }], layout: 'mirror2', spares: '1' }));
  assert.equal(one.pool.vdevCount, 3);
  assert.ok(one.issues.some((i) => /does not raise how many disks may fail/.test(i.text)));
});

test('notes for wide RAIDZ, parity + 1 widths and records below the sector size', () => {
  const wide = zrc.compute(state({ disks: [{ qty: '12', size: '8', unit: 'TB' }] }));
  assert.ok(wide.issues.some((i) => i.level === 'info' && /12 disks wide\. zpoolconcepts\(7\) recommends 3 to 9/.test(i.text)));
  const three = zrc.compute(state({ disks: [{ qty: '3', size: '8', unit: 'TB' }] }));
  assert.ok(three.issues.some((i) => /same space as a 3-way mirror/.test(i.text)));
  const rec = zrc.compute(state({ recordsize: '4096', ashift: '13' }));
  assert.ok(rec.issues.some((i) => /Records of 4K are smaller than the 8K sector size/.test(i.text)));
});

// ─────────────────────────────────────────────────────────────────────────────
// Every layout for the disk count
// ─────────────────────────────────────────────────────────────────────────────

test('layout comparison lists every layout the disk count allows', () => {
  const names = zrc.compareLayouts(disks(6, 4n * TB), 12, K128, 8000).map((c) => c.name);
  assert.deepEqual(names, [
    'Stripe of 6 disks',
    '3 × 2-way mirror',
    '2 × 3-way mirror',
    '1 × RAIDZ1, 6 wide',
    '2 × RAIDZ1, 3 wide',
    '3 × RAIDZ1, 2 wide',
    '1 × RAIDZ2, 6 wide',
    '2 × RAIDZ2, 3 wide',
    '1 × RAIDZ3, 6 wide'
  ]);
  const rows = zrc.compareLayouts(disks(6, 4n * TB), 12, K128, 8000);
  const stripe = rows[0].pool;
  for (const row of rows) assert.ok(row.pool.afterSlop <= stripe.afterSlop, row.name);
  assert.equal(zrc.layoutOptions(1).map((o) => o.id).join(), 'stripe');
});

// ─────────────────────────────────────────────────────────────────────────────
// Classic RAID
// ─────────────────────────────────────────────────────────────────────────────

test('classic RAID 0/1/5/6/10 with 6 x 4 TB', () => {
  const rows = zrc.classicRaid(disks(6, 4n * TB));
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.raid0.usable, 24n * TB);
  assert.equal(by.raid1.usable, 4n * TB);
  assert.equal(by.raid5.usable, 20n * TB);
  assert.equal(by.raid6.usable, 16n * TB);
  assert.equal(by.raid10.usable, 12n * TB);
  assert.deepEqual(rows.map((r) => [r.guaranteed, r.best]), [[0, 0], [5, 5], [1, 1], [2, 2], [1, 3]]);
  assert.ok(rows.every((r) => r.valid));
});

test('classic RAID: minimum disk counts, RAID 10 needs pairs, the smallest disk sets the size', () => {
  const five = Object.fromEntries(zrc.classicRaid(disks(5, 4n * TB)).map((r) => [r.id, r]));
  assert.equal(five.raid10.valid, false);
  assert.equal(five.raid10.reason, 'Needs an even number of disks (mirrored pairs); 5 disks leave one over.');
  const three = Object.fromEntries(zrc.classicRaid(disks(3, 4n * TB)).map((r) => [r.id, r]));
  assert.equal(three.raid6.valid, false);
  assert.equal(three.raid6.reason, 'Needs at least 4 disks; there are 3.');
  assert.equal(three.raid10.valid, false);
  assert.equal(three.raid5.usable, 8n * TB);
  const one = Object.fromEntries(zrc.classicRaid([4n * TB]).map((r) => [r.id, r]));
  assert.equal(one.raid0.reason, 'Needs at least 2 disks; there is 1.');
  const mixed = Object.fromEntries(zrc.classicRaid([4n * TB, 8n * TB, 8n * TB]).map((r) => [r.id, r]));
  assert.equal(mixed.raid5.usable, 8n * TB);                               // (3 - 1) x 4 TB
  assert.equal(mixed.raid0.usable, 12n * TB);                              // 3 x the smallest
  const notes = zrc.classicNotes([4n * TB, 8n * TB, 8n * TB]).join('\n');
  assert.match(notes, /mdadm RAID 0 is the exception.*gives 20\.00 TB/);
  assert.match(notes, /raid10 driver.*6\.00 TB/);                          // 3 x 4 TB / 2
});

// ─────────────────────────────────────────────────────────────────────────────
// Whole compute() and text output
// ─────────────────────────────────────────────────────────────────────────────

test('compute(): the default 6 x 8 TB RAIDZ2 has no issues and consistent steps', () => {
  const r = zrc.compute(zrc.defaultState());
  assert.equal(r.issues.length, 0);
  const p = r.pool;
  assert.equal(r.raw, 48n * TB);
  assert.equal(p.ideal, 32n * TB);
  assert.ok(p.afterReserves < p.ideal);
  assert.ok(p.atRecord <= p.afterReserves);
  assert.ok(p.afterSlop < p.atRecord);
  assert.ok(p.atFill < p.afterSlop);
  // 6-wide RAIDZ2 at ashift 12: 128K takes 192K, exactly the 4/6 parity ratio, so no padding loss
  assert.equal(p.atRecord, p.afterReserves);
});

test('summary text names the layout, every step and the model', () => {
  const s = state({ disks: [{ qty: '12', size: '16', unit: 'TB' }] });
  const text = zrc.buildSummary(zrc.compute(s), s, 'https://example.test/#v=1');
  assert.match(text, /^ZFS pool: 1 × RAIDZ2, 12 wide, ashift 12, 128K records, no compression/);
  assert.match(text, /Disks: 12 disks: 12 × 16 TB/);
  assert.match(text, /Raw capacity: 192\.00 TB \(174\.62 TiB\)/);
  assert.match(text, /After parity \/ mirroring: 160\.00 TB \(145\.52 TiB\)/);
  assert.match(text, /After slop space: 146\.14 TB \(132\.91 TiB\), 76\.1% of raw/);
  assert.match(text, /Disks that may fail: any 2 \(2 per vdev\)/);
  assert.match(text, /zfs list USED \+ AVAIL on an empty pool about 132\.88 TiB/);
  assert.match(text, /Classic RAID with the same disks: RAID 0 192\.00 TB, RAID 1 16\.00 TB, RAID 5 176\.00 TB, RAID 6 160\.00 TB, RAID 10 96\.00 TB/);
  assert.match(text, /Link: https:\/\/example\.test\/#v=1$/);
  assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/);
});

test('zpool create preview with placeholder device names and spares', () => {
  const p = pool(disks(12, 4n * TB), 'raidz2', 2);
  assert.equal(zrc.zpoolCommand(p, 1), 'zpool create -o ashift=12 tank raidz2 disk1 disk2 disk3 disk4 disk5 disk6 raidz2 disk7 disk8 disk9 disk10 disk11 disk12 spare disk13');
  assert.equal(zrc.zpoolCommand(pool(disks(4, 4n * TB), 'mirror2', 2), 0), 'zpool create -o ashift=12 tank mirror disk1 disk2 mirror disk3 disk4');
  assert.equal(zrc.zpoolCommand(pool(disks(2, 4n * TB), 'stripe', 2, 9), 0), 'zpool create -o ashift=9 tank disk1 disk2');
});

// ─────────────────────────────────────────────────────────────────────────────
// URL hash
// ─────────────────────────────────────────────────────────────────────────────

test('hash round trip keeps every field exactly as typed', () => {
  const s = zrc.defaultState();
  assert.deepEqual(zrc.decodeHash(zrc.encodeHash(s)), s);
  const rich = state({
    disks: [
      { qty: '2', size: '3,84', unit: 'TB' },
      { qty: 'x', size: '1 000 & co', unit: 'GiB' },
      { qty: '', size: '', unit: 'B' },
      { qty: '10', size: '18', unit: 'TiB' }
    ],
    spares: '1', layout: 'mirror3', vdevs: '7', ashift: '13', recordsize: '1048576', fill: '85.5'
  });
  const h = zrc.encodeHash(rich);
  assert.ok(h.startsWith('#v=1&'));
  assert.doesNotMatch(h, /[ "<>]/);
  assert.deepEqual(zrc.decodeHash(h), rich);
  const emptyFill = state({ fill: '' });
  assert.deepEqual(zrc.decodeHash(zrc.encodeHash(emptyFill)), emptyFill);
});

test('hash decoding: anchors are not state, junk falls back to defaults, rows are capped', () => {
  assert.equal(zrc.isStateHash('#how-to-use-it'), false);
  assert.deepEqual(zrc.decodeHash('#how-to-use-it'), zrc.defaultState());
  assert.deepEqual(zrc.decodeHash(''), zrc.defaultState());
  const junk = zrc.decodeHash('#v=1&l=raid7&a=99&rs=123&d=%E0%A4%A,8,PB&zz=1');
  assert.equal(junk.layout, 'raidz2');
  assert.equal(junk.ashift, '12');
  assert.equal(junk.recordsize, '131072');
  assert.deepEqual(junk.disks, [{ qty: '', size: '8', unit: 'TB' }]);
  const many = '#v=1' + '&d=1,4,TB'.repeat(zrc.MAX_GROUPS + 5);
  assert.equal(zrc.decodeHash(many).disks.length, zrc.MAX_GROUPS);
  assert.equal(zrc.decodeHash('#v=1&d=1,' + '9'.repeat(40) + ',B').disks[0].size.length, 24);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source hygiene: the files go inside a WordPress block comment
// ─────────────────────────────────────────────────────────────────────────────

test('tool sources contain no comment delimiters, closing script tags or unicode escapes', () => {
  const dir = path.join(__dirname, '..', 'zfs-raid-capacity-calculator');
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

test('script.js uses no BigInt literals, so any JS minifier on the site can parse it', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'zfs-raid-capacity-calculator', 'script.js'), 'utf8');
  assert.doesNotMatch(text, /\b\d+n\b/);
});
