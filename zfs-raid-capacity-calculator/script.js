/* ZFS and RAID Capacity Calculator — script.js
   Prefix: zrc-
   No dependencies. Needs BigInt, which every current browser has.

   The ZFS space model is a port of the OpenZFS 2.4.4 source (git tag zfs-2.4.4):
     lib/libzfs/os/linux/libzfs_pool_os.c  zpool_label_disk(): whole-disk GPT partition
     lib/libefi/rdwr_efi.c                 efi_alloc_and_init(): last usable LBA
     include/sys/vdev_disk.h               NEW_START_BLOCK, PARTITION_END_ALIGNMENT
     include/sys/efi_partition.h           EFI_MIN_RESV_SIZE
     include/sys/vdev_impl.h               VDEV_LABEL_START_SIZE, VDEV_LABEL_END_SIZE
     include/sys/fs/zfs.h                  SPA_MINDEVSIZE, SPA_MINBLOCKSHIFT, SPA_MAXBLOCKSHIFT
     module/zfs/vdev.c                     vdev_open(), vdev_metaslab_set_size(),
                                           vdev_metaslab_init() (embedded log metaslab),
                                           vdev_set_deflate_ratio(), vdev_deflated_space(),
                                           vdev_default_asize()
     module/zfs/vdev_mirror.c              vdev_mirror_open()
     module/zfs/vdev_raidz.c               vdev_raidz_open(), vdev_raidz_psize_to_asize()
     module/zfs/spa_misc.c                 spa_get_slop_space(), spa_update_dspace()
     module/zfs/dsl_pool.c                 dsl_pool_adjustedsize()
     cmd/zpool/zpool_vdev.c                device count limits, ZPOOL_FUZZ size check
   Classic RAID levels use the textbook definitions; the mdadm notes follow md(4) and
   mdadm(8) from mdadm 4.6. */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var HAS_BIGINT = typeof BigInt === 'function';

  // ── Limits and choices ────────────────────────────────────

  var MAX_GROUPS = 12;
  var MAX_DISKS = 1024;
  var MAX_RAIDZ_WIDTH = 255;        // zpool_vdev.c is_grouping(): maxdev for raidz
  var RAIDZ_ADVISED_MIN = 3;        // zpoolconcepts(7): "between 3 and 9"
  var RAIDZ_ADVISED_MAX = 9;
  var FREE_SPACE_ADVICE = 90;       // Workload Tuning: keep pool free space above 10%
  var MAX_VDEV_ROWS = 64;
  var QTY_LEN = 6;
  var SIZE_LEN = 24;
  var NUM_LEN = 6;
  var FILL_LEN = 8;

  var UNITS = {
    TB: { bytes: '1000000000000', label: 'TB' },
    TiB: { bytes: '1099511627776', label: 'TiB' },
    GB: { bytes: '1000000000', label: 'GB' },
    GiB: { bytes: '1073741824', label: 'GiB' },
    B: { bytes: '1', label: 'bytes' }
  };
  var UNIT_ORDER = ['TB', 'TiB', 'GB', 'GiB', 'B'];

  var LAYOUTS = {
    stripe: { id: 'stripe', kind: 'stripe', copies: 1, parity: 0, label: 'Stripe' },
    mirror2: { id: 'mirror2', kind: 'mirror', copies: 2, parity: 0, label: '2-way mirror' },
    mirror3: { id: 'mirror3', kind: 'mirror', copies: 3, parity: 0, label: '3-way mirror' },
    mirror4: { id: 'mirror4', kind: 'mirror', copies: 4, parity: 0, label: '4-way mirror' },
    raidz1: { id: 'raidz1', kind: 'raidz', copies: 1, parity: 1, label: 'RAIDZ1' },
    raidz2: { id: 'raidz2', kind: 'raidz', copies: 1, parity: 2, label: 'RAIDZ2' },
    raidz3: { id: 'raidz3', kind: 'raidz', copies: 1, parity: 3, label: 'RAIDZ3' }
  };
  var LAYOUT_ORDER = ['stripe', 'mirror2', 'mirror3', 'mirror4', 'raidz1', 'raidz2', 'raidz3'];

  var ASHIFTS = [9, 10, 11, 12, 13, 14, 15, 16];   // ASHIFT_MIN..ASHIFT_MAX, include/sys/spa.h
  var RECORDSIZES = [4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288,
    1048576, 2097152, 4194304, 8388608, 16777216];
  var DEFAULT_RECORDSIZE = 131072;

  // ── OpenZFS constants (BigInt) ────────────────────────────

  var Z = null;
  if (HAS_BIGINT) {
    Z = {
      ZERO: BigInt(0),
      ONE: BigInt(1),
      SECTOR: BigInt(512),                    // logical sector size assumed for the GPT
      NEW_START_BLOCK: BigInt(2048),          // vdev_disk.h: partition 1 starts at 1 MiB
      PARTITION_END_ALIGNMENT: BigInt(2048),  // vdev_disk.h: partition 1 size is a multiple of 1 MiB
      EFI_MIN_RESV_SIZE: BigInt(16384),       // efi_partition.h: partition 9, 8 MiB
      GPT_BACKUP: BigInt(33),                 // rdwr_efi.c: 16 KiB of entries + 1 header at the end
      LABEL: BigInt(262144),                  // sizeof (vdev_label_t)
      LABEL_START: BigInt(4194304),           // 2 labels + VDEV_BOOT_SIZE (3.5 MiB)
      LABEL_END: BigInt(524288),              // 2 labels
      MINDEVSIZE: BigInt(67108864),           // SPA_MINDEVSIZE, 64 MiB
      MINBLOCKSHIFT: BigInt(9),               // SPA_MINBLOCKSHIFT
      MAXBLOCKSHIFT: BigInt(24),              // SPA_MAXBLOCKSHIFT
      DEFAULT_MS_SHIFT: BigInt(29),           // zfs_vdev_default_ms_shift (512 MiB)
      MAX_MS_SHIFT: BigInt(34),               // zfs_vdev_max_ms_shift (16 GiB)
      MIN_MS_COUNT: BigInt(16),               // zfs_vdev_min_ms_count
      DEFAULT_MS_COUNT: BigInt(200),          // zfs_vdev_default_ms_count
      MS_COUNT_LIMIT: BigInt(131072),         // zfs_vdev_ms_count_limit
      EMBEDDED_SLOG_MIN_MS: BigInt(64),       // zfs_embedded_slog_min_ms
      SLOP_SHIFT: BigInt(5),                  // spa_slop_shift
      MIN_SLOP: BigInt(134217728),            // spa_min_slop, 128 MiB
      MAX_SLOP: BigInt(137438953472),         // spa_max_slop, 128 GiB
      DEFLATE_BLOCK: BigInt(131072),          // vdev_set_deflate_ratio(): 1 << 17
      FUZZ: BigInt(16777216),                 // ZPOOL_FUZZ, zpool_vdev.c
      MAX_DISK: BigInt('1000000000000000'),   // 1 PB per disk (limit of this calculator)
      BPS: BigInt(10000)
    };
  }

  // ── Small helpers ─────────────────────────────────────────

  function big(n) { return BigInt(n); }
  function minB(a, b) { return a < b ? a : b; }
  function maxB(a, b) { return a > b ? a : b; }
  function toNum(b) { return typeof b === 'bigint' ? Number(b) : b; }
  function p2align(x, align) { return (x / align) * align; }
  function p2roundup(x, align) { return ((x + align - Z.ONE) / align) * align; }

  // Position of the highest set bit, 1-based (highbit64() in the SPL); 0 for 0.
  function highbit64(x) {
    var n = 0;
    while (x > Z.ZERO) { x = x >> Z.ONE; n++; }
    return big(n);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  function trim(s) { return String(s == null ? '' : s).trim(); }

  // ── Number input parsing ──────────────────────────────────

  // An exact fraction from a typed decimal: "16", "3.84", "1,5", "16 000".
  function parseDecimal(text) {
    var t = trim(text).replace(/[\s_]/g, '');
    if (!t) return null;
    var commas = (t.match(/,/g) || []).length;
    if (commas) {
      if (commas > 1 || t.indexOf('.') >= 0) return null;
      t = t.replace(',', '.');
    }
    if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    var parts = t.split('.');
    var frac = (parts[1] || '').slice(0, 12);
    var digits = (parts[0] || '0') + frac;
    var den = '1';
    for (var i = 0; i < frac.length; i++) den += '0';
    return { num: big(digits), den: big(den) };
  }

  function sizeToBytes(text, unit) {
    var d = parseDecimal(text);
    var u = UNITS[unit];
    if (!d || !u) return null;
    return d.num * big(u.bytes) / d.den;
  }

  function parseCount(text) {
    var t = trim(text);
    if (!/^\d+$/.test(t)) return NaN;
    return parseInt(t, 10);
  }

  function parsePercent(text) {
    var t = trim(text).replace(',', '.');
    if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
    return parseFloat(t);
  }

  // ── OpenZFS space accounting ──────────────────────────────

  // Size of partition 1 that zpool create writes on a whole disk under Linux
  // (zpool_label_disk): starts at sector 2048, leaves 8 MiB for partition 9 and the
  // backup GPT at the end, rounded down to a multiple of 2048 sectors.
  function partitionBytes(diskBytes) {
    var sectors = diskBytes / Z.SECTOR;
    var lastUsable = sectors - Z.ONE - Z.GPT_BACKUP;              // efi_last_u_lba
    var slice = lastUsable + Z.ONE - Z.EFI_MIN_RESV_SIZE - Z.NEW_START_BLOCK;
    if (slice <= Z.ZERO) return Z.ZERO;
    return p2align(slice, Z.PARTITION_END_ALIGNMENT) * Z.SECTOR;
  }

  // Smallest disk zpool create accepts (the partition must reach SPA_MINDEVSIZE).
  function minDiskBytes() {
    return (Z.MINDEVSIZE / Z.SECTOR + Z.GPT_BACKUP + Z.EFI_MIN_RESV_SIZE + Z.NEW_START_BLOCK) * Z.SECTOR;
  }

  // Allocatable size of a leaf vdev (vdev_open): the partition aligned to the label
  // size, minus two labels and the boot area at the start and two labels at the end.
  function leafAsize(diskBytes) {
    var osize = p2align(partitionBytes(diskBytes), Z.LABEL);
    var asize = osize - Z.LABEL_START - Z.LABEL_END;
    return asize > Z.ZERO ? asize : Z.ZERO;
  }

  // vdev_raidz_psize_to_asize() for a vdev that was never expanded.
  function raidzPsizeToAsize(psize, ashift, nparity, cols) {
    var a = big(ashift);
    var p = big(nparity);
    var c = big(cols);
    var asize = ((psize - Z.ONE) >> a) + Z.ONE;
    asize += p * ((asize + c - p - Z.ONE) / (c - p));
    var r = p + Z.ONE;
    asize = ((asize + r - Z.ONE) / r) * r;            // roundup(asize, nparity + 1)
    return asize << a;
  }

  // vdev_default_asize(): mirrors and single disks round up to the sector size.
  function defaultPsizeToAsize(psize, ashift) {
    return p2roundup(psize, Z.ONE << big(ashift));
  }

  function psizeToAsize(layout, width, psize, ashift) {
    return layout.kind === 'raidz'
      ? raidzPsizeToAsize(psize, ashift, layout.parity, width)
      : defaultPsizeToAsize(psize, ashift);
  }

  // vdev_metaslab_set_size()
  function metaslabShift(asize) {
    var count = asize >> Z.DEFAULT_MS_SHIFT;
    var shift;
    if (count < Z.MIN_MS_COUNT) shift = highbit64(asize / Z.MIN_MS_COUNT);
    else if (count > Z.DEFAULT_MS_COUNT) shift = highbit64(asize / Z.DEFAULT_MS_COUNT);
    else shift = Z.DEFAULT_MS_SHIFT;
    if (shift < Z.MAXBLOCKSHIFT) {
      shift = Z.MAXBLOCKSHIFT;
    } else if (shift > Z.MAX_MS_SHIFT) {
      shift = Z.MAX_MS_SHIFT;
      if ((asize >> shift) > Z.MS_COUNT_LIMIT) shift = highbit64(asize / Z.MS_COUNT_LIMIT);
    }
    return shift;
  }

  // vdev_set_deflate_ratio(): fixed 128 KiB block, txg 0.
  function deflateRatio(layout, width, ashift) {
    return Z.DEFLATE_BLOCK / (psizeToAsize(layout, width, Z.DEFLATE_BLOCK, ashift) >> Z.MINBLOCKSHIFT);
  }

  // spa_get_slop_space(), with rdspace = normal class dspace and the embedded log space.
  function slopSpace(rdspace, embeddedLog) {
    var slop = minB(rdspace >> Z.SLOP_SHIFT, Z.MAX_SLOP);
    slop -= minB(embeddedLog, slop >> Z.ONE);
    return maxB(slop, minB(rdspace >> Z.ONE, Z.MIN_SLOP));
  }

  // One top-level vdev built from the given disks (bytes, in list order).
  function computeVdev(disks, layout, ashift, recordsize, index) {
    var w = disks.length;
    var minDisk = disks[0];
    var maxDisk = disks[0];
    var raw = Z.ZERO;
    for (var i = 0; i < w; i++) {
      minDisk = minB(minDisk, disks[i]);
      maxDisk = maxB(maxDisk, disks[i]);
      raw += disks[i];
    }
    var minLeaf = leafAsize(minDisk);                 // the smallest disk has the smallest leaf
    // vdev_raidz_open(): smallest child x children; vdev_mirror_open(): smallest child;
    // vdev_open() then aligns the result to the label size.
    var asize = p2align(layout.kind === 'raidz' ? minLeaf * big(w) : minLeaf, Z.LABEL);
    var msShift = metaslabShift(asize);
    var msSize = Z.ONE << msShift;
    var msCount = asize >> msShift;
    var space = msCount * msSize;                     // the tail after the last metaslab is unused
    var deflate = deflateRatio(layout, w, ashift);
    var dspace = (space >> Z.MINBLOCKSHIFT) * deflate;
    var embedded = msCount > Z.EMBEDDED_SLOG_MIN_MS ? (msSize >> Z.MINBLOCKSHIFT) * deflate : Z.ZERO;
    var dataDisks = layout.kind === 'raidz' ? w - layout.parity : 1;
    var ideal = minDisk * big(dataDisks);
    var afterReserves = layout.kind === 'raidz' ? space * big(dataDisks) / big(w) : space;
    var rs = big(recordsize);
    var recordAsize = psizeToAsize(layout, w, rs, ashift);
    var atRecord = space * rs / recordAsize;
    return {
      index: index,
      disks: disks,
      width: w,
      minDisk: minDisk,
      maxDisk: maxDisk,
      raw: raw,
      mixedWaste: raw - minDisk * big(w),
      redundancy: minDisk * big(w) - ideal,
      ideal: ideal,
      leafAsize: minLeaf,
      asize: asize,
      msShift: msShift,
      msSize: msSize,
      msCount: msCount,
      space: space,
      deflate: deflate,
      dspace: dspace,
      embedded: embedded,
      afterReserves: afterReserves,
      recordAsize: recordAsize,
      atRecord: atRecord,
      tolerance: perVdevTolerance(layout)
    };
  }

  function perVdevTolerance(layout) {
    if (layout.kind === 'mirror') return layout.copies - 1;
    if (layout.kind === 'raidz') return layout.parity;
    return 0;
  }

  function faultTolerance(layout, vdevCount) {
    var per = perVdevTolerance(layout);
    return { perVdev: per, guaranteed: per, best: per * vdevCount };
  }

  // The whole pool: active disks split into equal vdevs in list order.
  function computePool(active, layout, vdevCount, ashift, recordsize, fillBps) {
    var width = active.length / vdevCount;
    var vdevs = [];
    for (var j = 0; j < vdevCount; j++) {
      vdevs.push(computeVdev(active.slice(j * width, (j + 1) * width), layout, ashift, recordsize, j));
    }
    var sum = function (key) {
      var s = Z.ZERO;
      for (var k = 0; k < vdevs.length; k++) s += vdevs[k][key];
      return s;
    };
    var dspace = sum('dspace');
    var embedded = sum('embedded');
    var rdspace = dspace - embedded;                  // spa_update_dspace(): normal class only
    var slop = slopSpace(rdspace, embedded);
    var zfsTotal = rdspace > slop ? rdspace - slop : Z.ZERO;   // dsl_pool_adjustedsize()
    var atRecord = sum('atRecord');
    // zfs list charges (asize >> 9) x deflate for a record; convert back to stored data.
    var charge = (vdevs[0].recordAsize >> Z.MINBLOCKSHIFT) * vdevs[0].deflate;
    var afterSlop = minB(zfsTotal * big(recordsize) / charge, atRecord);
    var fillCap = atRecord * big(fillBps) / Z.BPS;
    return {
      layout: layout,
      vdevCount: vdevCount,
      width: width,
      ashift: ashift,
      recordsize: recordsize,
      fillBps: fillBps,
      vdevs: vdevs,
      raw: sum('raw'),
      mixedWaste: sum('mixedWaste'),
      redundancy: sum('redundancy'),
      ideal: sum('ideal'),
      afterReserves: sum('afterReserves'),
      atRecord: atRecord,
      zpoolSize: sum('space'),
      dspace: dspace,
      embedded: embedded,
      rdspace: rdspace,
      slop: slop,
      zfsTotal: zfsTotal,
      afterSlop: afterSlop,
      atFill: minB(fillCap, afterSlop),
      deflate: vdevs[0].deflate,
      recordAsize: vdevs[0].recordAsize,
      tolerance: faultTolerance(layout, vdevCount)
    };
  }

  // ── Layout rules ──────────────────────────────────────────

  function validVdevCounts(layoutId, n) {
    var layout = LAYOUTS[layoutId];
    var out = [];
    if (!layout || n < 1) return out;
    if (layout.kind === 'stripe') return [n];
    if (layout.kind === 'mirror') return n >= layout.copies && n % layout.copies === 0 ? [n / layout.copies] : [];
    for (var v = 1; v <= n; v++) {
      if (n % v) continue;
      var w = n / v;
      if (w >= layout.parity + 1 && w <= MAX_RAIDZ_WIDTH) out.push(v);
    }
    return out;
  }

  function describeCounts(layoutId, n) {
    return validVdevCounts(layoutId, n).map(function (v) { return v + ' (' + (n / v) + ' wide)'; }).join(', ');
  }

  // Turn the layout choice and the vdev field into a vdev count and width, or an error
  // that names the numbers and the fix.
  function resolveLayout(layoutId, n, vdevsText) {
    var layout = LAYOUTS[layoutId] || LAYOUTS.raidz2;
    var res = { layout: layout, vdevs: 0, width: 0, error: null, auto: true };
    if (n < 1) {
      res.error = 'Add at least one disk to build a pool.';
      return res;
    }
    if (layout.kind === 'stripe') {
      res.vdevs = n;
      res.width = 1;
      return res;
    }
    if (layout.kind === 'mirror') {
      var k = layout.copies;
      if (n < k) {
        res.error = 'A ' + layout.label + ' needs at least ' + k + ' disks; there ' + (n === 1 ? 'is 1' : 'are ' + n) + '. Add ' + plural(k - n, 'disk') + ' or pick another layout.';
        return res;
      }
      if (n % k) {
        var rest = n % k;
        res.error = plural(n, 'disk') + ' do not split into ' + layout.label + 's: ' + plural(Math.floor(n / k), 'mirror') + ' use ' + (Math.floor(n / k) * k) + ' disks and ' + rest + ' ' + (rest === 1 ? 'is' : 'are') + ' left over. Set ' + plural(rest, 'hot spare') + ', add ' + plural(k - rest, 'disk') + ', or pick another layout.';
        return res;
      }
      res.vdevs = n / k;
      res.width = k;
      return res;
    }
    var p = layout.parity;
    var t = trim(vdevsText);
    var v = 1;
    if (t !== '') {
      v = parseCount(t);
      res.auto = false;
      if (!(v >= 1)) {
        res.error = 'Number of vdevs must be a whole number of 1 or more; "' + t + '" is not. Leave it empty for 1 vdev.';
        return res;
      }
    }
    var counts = describeCounts(layout.id, n);
    if (n % v) {
      res.error = plural(n, 'disk') + ' do not split evenly into ' + plural(v, 'vdev') + '. ' +
        (counts ? 'Valid vdev counts for ' + layout.label + ' with ' + n + ' disks: ' + counts + '.' : 'Add or remove disks, or set hot spares, so the count divides evenly.');
      return res;
    }
    var w = n / v;
    if (w < p + 1) {
      var head = layout.label + ' needs at least ' + (p + 1) + ' disks per vdev (parity + 1); ' +
        (v === 1 ? plural(n, 'disk') + ' in one vdev ' + (n === 1 ? 'is' : 'are') + ' not enough.' : plural(v, 'vdev') + ' of ' + plural(w, 'disk') + ' are not enough.');
      var alts = [];
      if (p > 1 && n >= p) alts.push('RAIDZ' + (p - 1));
      if (n >= 2) alts.push('a mirror');
      if (n === 1) alts.push('a single-disk stripe');
      var fix = counts ? ' Use fewer vdevs: ' + counts + '.' :
        ' Add ' + plural(p + 1 - n, 'disk') + (alts.length ? ', or use ' + alts.join(' or ') : '') + '.';
      res.error = head + fix;
      return res;
    }
    if (w > MAX_RAIDZ_WIDTH) {
      res.error = 'A RAIDZ vdev holds at most ' + MAX_RAIDZ_WIDTH + ' disks (zpool create refuses more); ' + w + ' per vdev is too many. Valid vdev counts: ' + counts + '.';
      return res;
    }
    res.vdevs = v;
    res.width = w;
    return res;
  }

  function layoutName(layout, vdevs, width) {
    if (layout.kind === 'stripe') return 'Stripe of ' + plural(vdevs, 'disk');
    if (layout.kind === 'mirror') return vdevs + ' × ' + layout.label;
    return vdevs + ' × ' + layout.label + ', ' + width + ' wide';
  }

  function layoutOptions(n) {
    var opts = [];
    if (n < 1) return opts;
    LAYOUT_ORDER.forEach(function (id) {
      validVdevCounts(id, n).forEach(function (v) {
        opts.push({ id: id, vdevs: v, width: n / v });
      });
    });
    return opts;
  }

  // ── Disks ─────────────────────────────────────────────────

  function parseGroups(groups) {
    var out = { disks: [], rows: [], errors: [], count: 0 };
    (groups || []).forEach(function (g, i) {
      var row = { index: i, label: 'Disk row ' + (i + 1), qty: 0, bytes: null, errors: [], skipped: false };
      var qtyText = trim(g.qty);
      var sizeText = trim(g.size);
      out.rows.push(row);
      if (!qtyText && !sizeText) {
        row.skipped = true;
        return;
      }
      var qty = qtyText === '' ? 1 : parseCount(qtyText);
      if (!(qty >= 1 && qty <= MAX_DISKS)) {
        row.errors.push(row.label + ': the quantity "' + qtyText + '" must be a whole number from 1 to ' + MAX_DISKS + '.');
      }
      var unit = UNITS[g.unit] ? g.unit : 'TB';
      var bytes = sizeText ? sizeToBytes(sizeText, unit) : null;
      if (!sizeText) {
        row.errors.push(row.label + ': enter the disk size, for example 8 (TB).');
      } else if (bytes === null) {
        row.errors.push(row.label + ': "' + sizeText + '" is not a size. Type a number such as 4, 3.84 or 18.');
      } else if (bytes > Z.MAX_DISK) {
        row.errors.push(row.label + ': ' + sizeText + ' ' + UNITS[unit].label + ' is more than the 1 PB per disk this calculator accepts. Check the unit.');
      } else if (partitionBytes(bytes) < Z.MINDEVSIZE) {
        row.errors.push(row.label + ': ' + sizeText + ' ' + UNITS[unit].label + ' is too small. ZFS needs at least 64 MiB per device (SPA_MINDEVSIZE), so a whole disk must hold ' + formatBytes(minDiskBytes(), false, true) + ' or more. Check the unit.');
      }
      row.qty = qty;
      row.bytes = bytes;
      if (row.errors.length) {
        out.errors = out.errors.concat(row.errors);
        return;
      }
      out.count += qty;
      if (out.count <= MAX_DISKS) {
        for (var k = 0; k < qty; k++) out.disks.push(bytes);
      }
    });
    if (!out.errors.length && out.count > MAX_DISKS) {
      out.errors.push('That is ' + out.count + ' disks; this calculator handles up to ' + MAX_DISKS + '.');
    }
    if (!out.errors.length && !out.count) {
      out.errors.push('Add at least one disk: type how many disks and their size.');
    }
    return out;
  }

  // ── Classic RAID (textbook definitions) ───────────────────

  function classicRaid(active) {
    var n = active.length;
    if (!n) return [];
    var min = active[0];
    var raw = Z.ZERO;
    active.forEach(function (d) { min = minB(min, d); raw += d; });
    var N = big(n);
    var defs = [
      { id: 'raid0', label: 'RAID 0', what: 'striping, no redundancy', minDisks: 2, even: false, data: N, guaranteed: 0, best: 0 },
      { id: 'raid1', label: 'RAID 1', what: n + '-way mirror, every disk holds a full copy', minDisks: 2, even: false, data: Z.ONE, guaranteed: n - 1, best: n - 1 },
      { id: 'raid5', label: 'RAID 5', what: 'distributed single parity', minDisks: 3, even: false, data: N - Z.ONE, guaranteed: 1, best: 1 },
      { id: 'raid6', label: 'RAID 6', what: 'distributed double parity', minDisks: 4, even: false, data: N - big(2), guaranteed: 2, best: 2 },
      { id: 'raid10', label: 'RAID 10', what: 'stripe of 2-disk mirrors (RAID 1+0)', minDisks: 4, even: true, data: N / big(2), guaranteed: 1, best: Math.floor(n / 2) }
    ];
    return defs.map(function (d) {
      var row = { id: d.id, label: d.label, what: d.what, disks: n, minDisks: d.minDisks, valid: true, reason: '', usable: Z.ZERO, raw: raw, guaranteed: d.guaranteed, best: d.best, mixedWaste: raw - min * N };
      if (n < d.minDisks) {
        row.valid = false;
        row.reason = 'Needs at least ' + d.minDisks + ' disks; there ' + (n === 1 ? 'is 1' : 'are ' + n) + '.';
      } else if (d.even && n % 2) {
        row.valid = false;
        row.reason = 'Needs an even number of disks (mirrored pairs); ' + n + ' disks leave one over.';
      } else {
        row.usable = min * d.data;
      }
      return row;
    });
  }

  function classicNotes(active) {
    var notes = [];
    var n = active.length;
    if (!n) return notes;
    var min = active[0];
    var max = active[0];
    var raw = Z.ZERO;
    active.forEach(function (d) { min = minB(min, d); max = maxB(max, d); raw += d; });
    if (max > min) {
      notes.push('Your disks differ in size, so every level above counts each disk as ' + formatBytes(min, false) + '. mdadm does the same for RAID 1, 4, 5, 6 and 10 and warns when the sizes differ by more than 1% (mdadm(8), --size). mdadm RAID 0 is the exception: once the smallest member is full it keeps striping over the larger ones (md(4)), which gives ' + formatBytes(raw, false) + ' (' + formatBytes(raw, true) + ') with these disks.');
    }
    if (n >= 2 && (n % 2 || n < 4)) {
      var half = min * big(n) / big(2);
      notes.push('mdadm\'s own raid10 driver does not need mirrored pairs: with 2 copies it accepts any number of disks from 2 up and gives the space of n ÷ 2 disks (md(4): 5 disks give 2.5 disks of space). With these disks that is ' + formatBytes(half, false) + ' (' + formatBytes(half, true) + '), and any 1 disk may fail.');
    }
    notes.push('Not counted: the superblock and data offset mdadm keeps at the start of each member (mdadm computes them), any partition table, and the file system you put on the array.');
    notes.push('RAID 5 and 6 can be left with data and parity out of step after a power cut (the "write hole"); zpoolconcepts(7) points out that RAIDZ does not have this problem.');
    return notes;
  }

  // ── Compare every layout ──────────────────────────────────

  function compareLayouts(active, ashift, recordsize, fillBps) {
    return layoutOptions(active.length).map(function (o) {
      var layout = LAYOUTS[o.id];
      var pool = computePool(active, layout, o.vdevs, ashift, recordsize, fillBps);
      return { id: o.id, vdevs: o.vdevs, width: o.width, name: layoutName(layout, o.vdevs, o.width), pool: pool };
    });
  }

  // ── State ─────────────────────────────────────────────────

  function emptyGroup() { return { qty: '', size: '', unit: 'TB' }; }

  function defaultState() {
    return {
      disks: [{ qty: '6', size: '8', unit: 'TB' }],
      spares: '',
      layout: 'raidz2',
      vdevs: '',
      ashift: '12',
      recordsize: String(DEFAULT_RECORDSIZE),
      fill: '80'
    };
  }

  function compute(s) {
    var r = {
      issues: [],
      groups: null,
      disks: [],
      active: [],
      spareDisks: [],
      raw: null,
      spareBytes: null,
      layoutRes: null,
      pool: null,
      classic: [],
      classicNotes: [],
      compare: [],
      ashift: 12,
      recordsize: DEFAULT_RECORDSIZE,
      fill: NaN,
      fillBps: 0,
      sparesBad: false
    };
    var err = function (text) { r.issues.push({ level: 'error', text: text }); };
    var warn = function (text) { r.issues.push({ level: 'warn', text: text }); };
    var info = function (text) { r.issues.push({ level: 'info', text: text }); };

    var ashift = parseInt(s.ashift, 10);
    r.ashift = ASHIFTS.indexOf(ashift) >= 0 ? ashift : 12;
    var rs = parseInt(s.recordsize, 10);
    r.recordsize = RECORDSIZES.indexOf(rs) >= 0 ? rs : DEFAULT_RECORDSIZE;

    var fillText = trim(s.fill);
    var fill = fillText === '' ? 80 : parsePercent(fillText);
    var fillOk = fill >= 1 && fill <= 100;
    if (!fillOk) err('Target fill "' + fillText + '" must be a percentage from 1 to 100, for example 80.');
    r.fill = fillOk ? fill : NaN;
    r.fillBps = fillOk ? Math.round(fill * 100) : 0;

    var g = parseGroups(s.disks);
    r.groups = g;
    g.errors.forEach(err);
    var disksOk = !g.errors.length;
    if (disksOk) {
      r.disks = g.disks;
      r.raw = g.disks.reduce(function (a, b) { return a + b; }, Z.ZERO);
    }

    var spareText = trim(s.spares);
    var spares = 0;
    if (spareText !== '') {
      spares = parseCount(spareText);
      if (!(spares >= 0)) {
        err('Hot spares must be a whole number (0 or more); "' + spareText + '" is not.');
        spares = 0;
        disksOk = false;
        r.sparesBad = true;
      } else if (disksOk && spares >= r.disks.length) {
        err(plural(spares, 'hot spare') + ' leave' + (spares === 1 ? 's' : '') + ' no disks for the pool (' + plural(r.disks.length, 'disk') + ' in total). Use at most ' + (r.disks.length - 1) + '.');
        disksOk = false;
        r.sparesBad = true;
      }
    }
    if (disksOk) {
      r.active = r.disks.slice(0, r.disks.length - spares);
      r.spareDisks = r.disks.slice(r.disks.length - spares);
      r.spareBytes = r.spareDisks.reduce(function (a, b) { return a + b; }, Z.ZERO);
    }

    var layout = LAYOUTS[s.layout] || LAYOUTS.raidz2;
    if (disksOk) {
      r.layoutRes = resolveLayout(layout.id, r.active.length, s.vdevs);
      if (r.layoutRes.error) err(r.layoutRes.error);
      r.classic = classicRaid(r.active);
      r.classicNotes = classicNotes(r.active);
      if (fillOk) r.compare = compareLayouts(r.active, r.ashift, r.recordsize, r.fillBps);
    }

    if (disksOk && fillOk && r.layoutRes && !r.layoutRes.error) {
      r.pool = computePool(r.active, layout, r.layoutRes.vdevs, r.ashift, r.recordsize, r.fillBps);
      var pool = r.pool;
      if (layout.kind === 'stripe') {
        warn('A stripe has no redundancy: if any one disk fails, the whole pool and all its data are lost.');
      }
      var mixed = pool.vdevs.filter(function (v) { return v.maxDisk - v.minDisk > Z.FUZZ; });
      if (mixed.length) {
        var v0 = mixed[0];
        var kind = layout.kind === 'raidz' ? 'raidz' : 'mirror';
        warn((mixed.length === 1 ? 'Vdev ' + (v0.index + 1) + ' mixes disk sizes (' : plural(mixed.length, 'vdev') + ' mix disk sizes (vdev ' + (v0.index + 1) + ': ') +
          formatBytes(v0.minDisk, false) + ' to ' + formatBytes(v0.maxDisk, false) + '). ZFS uses every disk in a vdev only up to the smallest one, so ' +
          formatBytes(pool.mixedWaste, false) + ' stays unused, and zpool create stops with "' + kind + ' contains devices of different sizes" unless you add -f. Reorder the disk rows so equal disks share a vdev, or use the larger disks in their own vdev.');
      }
      if (layout.kind === 'raidz' && (pool.width < RAIDZ_ADVISED_MIN || pool.width > RAIDZ_ADVISED_MAX)) {
        info('Each ' + layout.label + ' vdev is ' + pool.width + ' disks wide. zpoolconcepts(7) recommends 3 to 9 disks per RAIDZ group for performance; wider groups give more space, narrower ones more IOPS.');
      }
      if (layout.kind === 'raidz' && pool.width === layout.parity + 1) {
        info('A ' + layout.label + ' vdev of ' + pool.width + ' disks stores one disk\'s worth of data, the same space as a ' + pool.width + '-way mirror.');
      }
      if (r.recordsize < Math.pow(2, r.ashift)) {
        info('Records of ' + formatRecord(r.recordsize) + ' are smaller than the ' + formatRecord(Math.pow(2, r.ashift)) + ' sector size (ashift ' + r.ashift + '), so each record still takes at least one whole sector.');
      }
      if (fill > FREE_SPACE_ADVICE) {
        warn('A ' + fmtNum(fill, 0, 1) + '% fill target leaves less than 10% free. The OpenZFS Workload Tuning guide advises keeping more than 10% of the pool free, because allocations get slow when metaslabs run out of free space.');
      }
      if (r.spareDisks.length) {
        var one = r.spareDisks.length === 1;
        info(plural(r.spareDisks.length, 'hot spare') + ' (' + formatBytes(r.spareBytes, false) + ') ' + (one ? 'counts' : 'count') + ' in the raw capacity but ' + (one ? 'adds' : 'add') + ' no usable space. A spare takes over automatically when a disk fails, but it does not raise how many disks may fail at the same time.');
      }
    }
    return r;
  }

  // ── Formatting ────────────────────────────────────────────

  var DEC_STEPS = [[1e12, 'TB'], [1e9, 'GB'], [1e6, 'MB'], [1e3, 'kB']];
  var BIN_STEPS = [[1099511627776, 'TiB'], [1073741824, 'GiB'], [1048576, 'MiB'], [1024, 'KiB']];

  function fmtNum(x, minDigits, maxDigits) {
    return Number(x).toLocaleString('en-US', { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits });
  }

  // TB/TiB (no PB, so every figure stays comparable); smaller values drop to GB, MB.
  function formatBytes(b, binary, loose) {
    var n = toNum(b);
    var steps = binary ? BIN_STEPS : DEC_STEPS;
    if (n === 0) return '0 ' + steps[0][1];
    for (var i = 0; i < steps.length; i++) {
      if (Math.abs(n) >= steps[i][0] || i === steps.length - 1) {
        return fmtNum(n / steps[i][0], loose ? 0 : 2, 2) + ' ' + steps[i][1];
      }
    }
    return String(n);
  }

  function formatPct(part, whole) {
    var w = toNum(whole);
    if (!w) return '–';
    return fmtNum(toNum(part) / w * 100, 1, 1) + '%';
  }

  function formatRecord(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576) + 'M';
    return (bytes / 1024) + 'K';
  }

  function formatShiftSize(shift) {
    var bytes = Math.pow(2, Number(shift));
    if (bytes >= 1073741824) return (bytes / 1073741824) + ' GiB';
    return (bytes / 1048576) + ' MiB';
  }

  function toleranceText(t, layout, vdevCount) {
    if (t.guaranteed === 0) return 'none';
    if (vdevCount === 1 || t.best === t.guaranteed) return 'any ' + t.guaranteed;
    return 'any ' + t.guaranteed + ', up to ' + t.best;
  }

  // ── Hash state ────────────────────────────────────────────

  function enc(s) { return encodeURIComponent(String(s)); }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return ''; }
  }

  function clip(s, n) { return String(s).slice(0, n); }

  function isStateHash(hash) { return /^#v=1(&|$)/.test(String(hash || '')); }

  function encodeHash(s) {
    var parts = ['v=1'];
    s.disks.forEach(function (g) { parts.push('d=' + enc(g.qty) + ',' + enc(g.size) + ',' + enc(g.unit)); });
    parts.push('l=' + enc(s.layout));
    if (s.vdevs !== '') parts.push('vd=' + enc(s.vdevs));
    if (s.spares !== '') parts.push('sp=' + enc(s.spares));
    parts.push('a=' + enc(s.ashift));
    parts.push('rs=' + enc(s.recordsize));
    parts.push('f=' + enc(s.fill));
    return '#' + parts.join('&');
  }

  function decodeHash(hash) {
    var s = defaultState();
    if (!isStateHash(hash)) return s;
    var disks = [];
    String(hash).slice(1).split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq < 0) return;
      var key = pair.slice(0, eq);
      var raw = pair.slice(eq + 1);
      var val = safeDecode(raw);
      if (key === 'd') {
        if (disks.length >= MAX_GROUPS) return;
        var f = raw.split(',');
        var unit = safeDecode(f[2] || '');
        disks.push({ qty: clip(safeDecode(f[0] || ''), QTY_LEN), size: clip(safeDecode(f[1] || ''), SIZE_LEN), unit: UNITS[unit] ? unit : 'TB' });
      } else if (key === 'l') {
        if (LAYOUTS[val]) s.layout = val;
      } else if (key === 'vd') {
        s.vdevs = clip(val, NUM_LEN);
      } else if (key === 'sp') {
        s.spares = clip(val, NUM_LEN);
      } else if (key === 'a') {
        if (ASHIFTS.indexOf(Number(val)) >= 0 && String(Number(val)) === val) s.ashift = val;
      } else if (key === 'rs') {
        if (RECORDSIZES.indexOf(Number(val)) >= 0 && String(Number(val)) === val) s.recordsize = val;
      } else if (key === 'f') {
        s.fill = clip(val, FILL_LEN);
      }
    });
    if (disks.length) s.disks = disks;
    return s;
  }

  // ── Plain-text summary ────────────────────────────────────

  function both(b) { return formatBytes(b, false) + ' (' + formatBytes(b, true) + ')'; }

  function buildSummary(r, s, link) {
    var lines = [];
    var pool = r.pool;
    if (!pool) {
      lines.push('ZFS capacity: not calculated.');
      r.issues.filter(function (i) { return i.level === 'error'; }).forEach(function (i) { lines.push('- ' + i.text); });
    } else {
      var L = pool.layout;
      var rec = formatRecord(pool.recordsize);
      lines.push('ZFS pool: ' + layoutName(L, pool.vdevCount, pool.width) + ', ashift ' + pool.ashift + ', ' + rec + ' records, no compression');
      lines.push('Disks: ' + diskListText(r) + (r.spareDisks.length ? ' (' + plural(r.spareDisks.length, 'hot spare') + ')' : ''));
      lines.push('Raw capacity: ' + both(r.raw));
      lines.push('After parity / mirroring: ' + both(pool.ideal));
      lines.push('After ZFS reserves and ' + (L.kind === 'raidz' ? 'RAIDZ padding' : 'allocation rounding') + ' at ' + rec + ': ' + both(pool.atRecord));
      lines.push('After slop space: ' + both(pool.afterSlop) + ', ' + formatPct(pool.afterSlop, r.raw) + ' of raw');
      lines.push('Usable at ' + fmtNum(r.fill, 0, 2) + '% fill: ' + both(pool.atFill));
      lines.push('Disks that may fail: ' + toleranceSentence(pool));
      lines.push('zpool list SIZE about ' + formatBytes(pool.zpoolSize, true) + '; zfs list USED + AVAIL on an empty pool about ' + formatBytes(pool.zfsTotal, true));
    }
    var classic = r.classic.filter(function (c) { return c.valid; });
    if (classic.length) {
      lines.push('Classic RAID with the same disks: ' + classic.map(function (c) { return c.label + ' ' + formatBytes(c.usable, false); }).join(', '));
    }
    lines.push('Model: OpenZFS 2.4.4 space accounting (whole-disk partitions, labels, metaslabs, RAIDZ padding, slop). Metadata, snapshots and compression are not modelled, so real free space is lower.');
    if (link) lines.push('Link: ' + link);
    return lines.join('\n');
  }

  function diskListText(r) {
    var parts = [];
    var groups = r.groups ? r.groups.rows : [];
    groups.forEach(function (row) {
      if (row.skipped || row.errors.length) return;
      parts.push(row.qty + ' × ' + formatBytes(row.bytes, false, true));
    });
    return plural(r.disks.length, 'disk') + ': ' + parts.join(' + ');
  }

  function toleranceSentence(pool) {
    var t = pool.tolerance;
    if (t.guaranteed === 0) return 'none (losing any disk loses the pool)';
    var s = 'any ' + t.guaranteed + ' (' + t.perVdev + ' per vdev)';
    if (t.best > t.guaranteed) s += ', best case ' + t.best + ' if no vdev loses more than ' + t.perVdev;
    return s;
  }

  function zpoolCommand(pool, spareCount) {
    var n = 0;
    var dev = function () { n++; return 'disk' + n; };
    var parts = ['zpool create -o ashift=' + pool.ashift + ' tank'];
    for (var j = 0; j < pool.vdevCount; j++) {
      if (pool.layout.kind === 'stripe') {
        parts.push(dev());
        continue;
      }
      parts.push(pool.layout.kind === 'mirror' ? 'mirror' : pool.layout.id);
      for (var k = 0; k < pool.width; k++) parts.push(dev());
    }
    if (spareCount) {
      parts.push('spare');
      for (var m = 0; m < spareCount; m++) parts.push(dev());
    }
    return parts.join(' ');
  }

  // ── Browser UI ────────────────────────────────────────────

  var state = defaultState();
  var lastResult = null;
  var lastHash = '';
  var hashActive = false;

  function unitOptions(selected) {
    return UNIT_ORDER.map(function (u) {
      return '<option value="' + u + '"' + (u === selected ? ' selected' : '') + '>' + UNITS[u].label + '</option>';
    }).join('');
  }

  function buildGroups() {
    var box = $('zrc-groups');
    box.innerHTML = state.disks.map(function (g, i) {
      return '<div class="zrc-group" data-i="' + i + '">' +
        '<div class="zrc-field zrc-field--qty"><label class="zrc-label" for="zrc-q-' + i + '">Disks</label>' +
        '<input class="zrc-input" id="zrc-q-' + i + '" data-k="qty" type="text" inputmode="numeric" maxlength="' + QTY_LEN + '" autocomplete="off" spellcheck="false" placeholder="1" value="' + esc(g.qty) + '"></div>' +
        '<span class="zrc-times" aria-hidden="true">×</span>' +
        '<div class="zrc-field zrc-field--size"><label class="zrc-label" for="zrc-s-' + i + '">Size</label>' +
        '<input class="zrc-input" id="zrc-s-' + i + '" data-k="size" type="text" inputmode="decimal" maxlength="' + SIZE_LEN + '" autocomplete="off" spellcheck="false" placeholder="8" value="' + esc(g.size) + '"></div>' +
        '<div class="zrc-field zrc-field--unit"><label class="zrc-label" for="zrc-u-' + i + '">Unit</label>' +
        '<select class="zrc-input zrc-select" id="zrc-u-' + i + '" data-k="unit">' + unitOptions(g.unit) + '</select></div>' +
        '<div class="zrc-group-del"><button type="button" class="zrc-icon-btn" data-act="del" aria-label="Remove disk row ' + (i + 1) + '" title="Remove row">×</button></div>' +
        '<p class="zrc-group-out" id="zrc-go-' + i + '"></p>' +
        '</div>';
    }).join('');
    var full = state.disks.length >= MAX_GROUPS;
    $('zrc-add').disabled = full;
    $('zrc-add-hint').classList.toggle('zrc-hidden', !full);
  }

  function writeForm() {
    buildGroups();
    var radios = document.querySelectorAll('input[name="zrc-layout"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === state.layout;
    $('zrc-vdevs').value = state.vdevs;
    $('zrc-spares').value = state.spares;
    $('zrc-ashift').value = state.ashift;
    $('zrc-recordsize').value = state.recordsize;
    $('zrc-fill').value = state.fill;
    $('zrc-vdevs').maxLength = NUM_LEN;
    $('zrc-spares').maxLength = NUM_LEN;
    $('zrc-fill').maxLength = FILL_LEN;
  }

  function renderGroups(r) {
    var rows = r.groups ? r.groups.rows : [];
    rows.forEach(function (row) {
      var out = $('zrc-go-' + row.index);
      var box = out ? out.parentNode : null;
      if (!out) return;
      var qtyIn = $('zrc-q-' + row.index);
      var sizeIn = $('zrc-s-' + row.index);
      var qtyBad = row.errors.some(function (e) { return e.indexOf('quantity') >= 0; });
      var sizeBad = row.errors.length > 0 && !qtyBad;
      qtyIn.classList.toggle('zrc-invalid', qtyBad);
      sizeIn.classList.toggle('zrc-invalid', sizeBad || (row.errors.length > 1));
      box.classList.toggle('zrc-group--error', row.errors.length > 0);
      if (row.skipped) {
        out.textContent = 'Empty row, not counted.';
        out.className = 'zrc-group-out zrc-group-out--muted';
      } else if (row.errors.length) {
        out.textContent = row.errors.join(' ');
        out.className = 'zrc-group-out zrc-group-out--error';
      } else {
        var total = row.bytes * big(row.qty);
        out.textContent = (row.qty > 1 ? row.qty + ' × ' + formatBytes(row.bytes, false) + ' = ' : '') + formatBytes(total, false) + ' (' + formatBytes(total, true) + ')';
        out.className = 'zrc-group-out';
      }
    });
    var meta = $('zrc-disk-meta');
    if (r.raw !== null) meta.textContent = plural(r.disks.length, 'disk') + ' · ' + formatBytes(r.raw, false) + ' raw (' + formatBytes(r.raw, true) + ')';
    else meta.textContent = '';
  }

  function renderLayoutHints(r) {
    var layout = LAYOUTS[state.layout] || LAYOUTS.raidz2;
    var vd = $('zrc-vdevs');
    var hint = $('zrc-vdevs-hint');
    var n = r.active.length;
    var lr = r.layoutRes;
    if (layout.kind === 'raidz') {
      if (vd.disabled) {
        vd.disabled = false;
        vd.value = state.vdevs;
      }
      vd.placeholder = 'auto (1)';
      var counts = n ? describeCounts(layout.id, n) : '';
      hint.textContent = n
        ? 'Leave empty for 1 vdev. ' + (counts ? 'Valid vdev counts for ' + plural(n, 'disk') + ' in ' + layout.label + ': ' + counts + '.' : layout.label + ' needs at least ' + (layout.parity + 1) + ' disks per vdev.')
        : '';
      vd.classList.toggle('zrc-invalid', !!(lr && lr.error && !lr.auto));
    } else {
      vd.disabled = true;
      vd.classList.remove('zrc-invalid');
      vd.value = lr && !lr.error && lr.vdevs ? String(lr.vdevs) : '';
      vd.placeholder = '–';
      if (layout.kind === 'stripe') hint.textContent = 'A stripe puts every disk in its own vdev' + (n ? ': ' + plural(n, 'vdev') + '.' : '.');
      else hint.textContent = layout.label + 's pair the disks in list order' + (lr && !lr.error ? ': ' + plural(lr.vdevs, 'vdev') + ' of ' + layout.copies + ' disks.' : '.');
    }
    var sp = $('zrc-spares');
    sp.classList.toggle('zrc-invalid', r.sparesBad);
    $('zrc-fill').classList.toggle('zrc-invalid', isNaN(r.fill));
  }

  function renderIssues(r) {
    var ul = $('zrc-issues');
    var list = r.issues.filter(function (i) {
      // Disk-row errors are shown under their rows.
      return !(i.level === 'error' && /^Disk row \d+:/.test(i.text));
    });
    var tags = { error: 'Error', warn: 'Warning', info: 'Note' };
    ul.innerHTML = list.map(function (i) {
      return '<li class="zrc-issue zrc-issue--' + i.level + '"><span class="zrc-issue-tag">' + tags[i.level] + '</span><span class="zrc-issue-text">' + esc(i.text) + '</span></li>';
    }).join('');
    ul.classList.toggle('zrc-hidden', !list.length);
  }

  function kpi(label, value, sub, mod) {
    return '<div class="zrc-kpi' + (mod ? ' zrc-kpi--' + mod : '') + '"><span class="zrc-kpi-label">' + label + '</span><span class="zrc-kpi-value">' + value + '</span><span class="zrc-kpi-sub">' + sub + '</span></div>';
  }

  function stepRows(r) {
    var p = r.pool;
    var L = p.layout;
    var rec = formatRecord(p.recordsize);
    var rows = [];
    var push = function (label, value, desc, mod) { rows.push({ label: label, value: value, desc: desc, mod: mod || '' }); };
    push('Raw capacity', r.raw, plural(r.disks.length, 'disk') + ' as entered.', 'raw');
    if (r.spareDisks.length) push('Without hot spares', r.raw - r.spareBytes, plural(r.spareDisks.length, 'spare') + ' kept out of the vdevs.');
    if (p.mixedWaste > Z.ZERO) push('Each disk up to the smallest in its vdev', r.raw - r.spareBytes - p.mixedWaste, 'Space on larger disks that the vdev cannot use.');
    var red = L.kind === 'raidz' ? 'Parity: ' + L.parity + ' of every ' + p.width + ' disks.' : L.kind === 'mirror' ? 'Mirror copies: 1 of every ' + L.copies + ' disks holds data.' : 'A stripe keeps no parity or copies.';
    push('After parity / mirroring', p.ideal, red);
    push('After ZFS reserves', p.afterReserves, 'Partition table, vdev labels and boot area, and the space after the last whole metaslab.');
    push(L.kind === 'raidz' ? 'After RAIDZ padding at ' + rec + ' records' : 'After sector rounding at ' + rec + ' records', p.atRecord,
      L.kind === 'raidz' ? 'Each ' + rec + ' record takes ' + formatBytes(big(p.recordAsize), true, true) + ' on disk: parity per row, rounded up to a multiple of ' + (L.parity + 1) + ' sectors.' : 'Each ' + rec + ' record takes ' + formatBytes(big(p.recordAsize), true, true) + ' per copy.');
    push('After slop space', p.afterSlop, 'ZFS keeps ' + formatBytes(p.slop + p.embedded, true) + ' (slop space and intent-log metaslabs) free for itself. The pool is full here.', 'key');
    push('Usable at ' + fmtNum(r.fill, 0, 2) + '% fill', p.atFill, 'What you can store while zpool list shows ' + fmtNum(r.fill, 0, 2) + '% CAP' + (p.atFill < p.atRecord * big(r.fillBps) / Z.BPS ? ' (capped by the slop space).' : '.'), 'key');
    return rows;
  }

  function renderResults(r) {
    var box = $('zrc-results');
    var p = r.pool;
    box.classList.toggle('zrc-hidden', !p);
    if (!p) return;
    var L = p.layout;
    var t = p.tolerance;

    $('zrc-kpis').innerHTML =
      kpi('Usable at ' + fmtNum(r.fill, 0, 2) + '% fill', formatBytes(p.atFill, false), formatBytes(p.atFill, true) + ' · space you plan to use', 'main') +
      kpi('Usable after slop', formatBytes(p.afterSlop, false), formatBytes(p.afterSlop, true) + ' · the pool is full here') +
      kpi('Disks that may fail', t.guaranteed === 0 ? 'none' : 'any ' + t.guaranteed, t.guaranteed === 0 ? 'losing any disk loses the pool' : (t.best > t.guaranteed ? 'best case ' + t.best + ', at most ' + t.perVdev + ' per vdev' : t.perVdev + ' in the only vdev'), t.guaranteed === 0 ? 'bad' : '') +
      kpi('Space efficiency', formatPct(p.afterSlop, r.raw), 'of raw capacity is usable after slop');

    // Stacked bar: where the raw capacity goes
    var segs = [
      { k: 'use', label: 'Usable at target fill', v: p.atFill },
      { k: 'head', label: 'Headroom above target fill', v: p.afterSlop - p.atFill },
      { k: 'slop', label: 'Slop space and intent-log metaslabs', v: p.atRecord - p.afterSlop },
      { k: 'pad', label: L.kind === 'raidz' ? 'RAIDZ padding' : 'Sector rounding', v: p.afterReserves - p.atRecord },
      { k: 'res', label: 'ZFS reserves (partitions, labels, metaslab tail)', v: p.ideal - p.afterReserves },
      { k: 'par', label: L.kind === 'mirror' ? 'Mirror copies' : 'Parity', v: p.redundancy },
      { k: 'mix', label: 'Unused on larger disks', v: p.mixedWaste },
      { k: 'spare', label: 'Hot spares', v: r.spareBytes }
    ];
    var raw = toNum(r.raw);
    var bar = segs.map(function (s) {
      var pct = raw ? toNum(s.v) / raw * 100 : 0;
      if (pct <= 0) return '';
      return '<span class="zrc-seg zrc-seg--' + s.k + '" style="width:' + pct.toFixed(4) + '%" title="' + esc(s.label + ': ' + formatBytes(s.v, false) + ' (' + fmtNum(pct, 1, 1) + '%)') + '"></span>';
    }).join('');
    var legend = segs.filter(function (s) { return s.v > Z.ZERO; }).map(function (s) {
      return '<li class="zrc-legend-item"><span class="zrc-dot zrc-seg--' + s.k + '" aria-hidden="true"></span><span class="zrc-legend-label">' + esc(s.label) + '</span><span class="zrc-legend-val">' + formatBytes(s.v, false) + ' · ' + formatPct(s.v, r.raw) + '</span></li>';
    }).join('');
    $('zrc-stack').innerHTML = '<div class="zrc-bar-stack" role="img" aria-label="Where the raw capacity goes">' + bar + '</div><ul class="zrc-legend">' + legend + '</ul>';

    // Step table
    var rows = stepRows(r);
    var prev = null;
    $('zrc-steps').innerHTML = '<thead><tr><th class="zrc-th zrc-th--name" scope="col">Step</th><th class="zrc-th" scope="col">TB</th><th class="zrc-th" scope="col">TiB</th><th class="zrc-th" scope="col">Of raw</th><th class="zrc-th" scope="col">Change</th></tr></thead><tbody>' +
      rows.map(function (row) {
        var change = prev === null ? '' : (row.value === prev ? '0' : '−' + formatBytes(prev - row.value, false));
        prev = row.value;
        return '<tr class="zrc-tr' + (row.mod ? ' zrc-tr--' + row.mod : '') + '">' +
          '<td class="zrc-td zrc-td--name"><span class="zrc-step-name">' + esc(row.label) + '</span><span class="zrc-step-desc">' + esc(row.desc) + '</span></td>' +
          '<td class="zrc-td" data-label="TB">' + formatBytes(row.value, false) + '</td>' +
          '<td class="zrc-td" data-label="TiB">' + formatBytes(row.value, true) + '</td>' +
          '<td class="zrc-td" data-label="Of raw">' + formatPct(row.value, r.raw) + '</td>' +
          '<td class="zrc-td' + (change ? '' : ' zrc-td--blank') + '" data-label="Change">' + change + '</td></tr>';
      }).join('') + '</tbody>';

    // Fault tolerance
    var f = [];
    if (t.guaranteed === 0) {
      f.push('<strong>No disk may fail.</strong> Every disk is a vdev of its own, and losing any vdev loses the pool.');
    } else {
      f.push('<strong>Per vdev:</strong> ' + plural(t.perVdev, 'disk') + ' (' + esc(L.label) + ').');
      f.push('<strong>Guaranteed:</strong> any ' + plural(t.guaranteed, 'disk') + ' may fail at the same time without data loss.');
      if (t.best > t.guaranteed) f.push('<strong>Best case:</strong> up to ' + plural(t.best, 'disk') + ', but only if no vdev loses more than ' + t.perVdev + '. One more failure in the same vdev takes the whole pool with it.');
    }
    if (r.spareDisks.length) f.push('<strong>Hot spares:</strong> ' + plural(r.spareDisks.length, 'disk') + ' standing by to replace a failed one automatically.');
    $('zrc-fail').innerHTML = '<h3 class="zrc-sub-title">How many disks may fail</h3><ul class="zrc-fail-list">' + f.map(function (x) { return '<li class="zrc-fail-item">' + x + '</li>'; }).join('') + '</ul>';

    // ZFS report
    var v0 = p.vdevs[0];
    var deflateLine = L.kind === 'raidz'
      ? v0.deflate + '/512 = ' + fmtNum(toNum(v0.deflate) / 512 * 100, 2, 2) + '% (a 128K block takes ' + formatBytes(psizeToAsize(L, p.width, Z.DEFLATE_BLOCK, p.ashift), true, true) + ')'
      : '512/512 (no parity to convert)';
    var report = [
      ['zpool list SIZE', formatBytes(p.zpoolSize, true) + ' (' + formatBytes(p.zpoolSize, false) + ')', L.kind === 'raidz' ? 'Raw space of all vdevs, parity included.' : L.kind === 'mirror' ? 'One side of each mirror.' : 'All disks.'],
      ['zfs list USED + AVAIL', formatBytes(p.zfsTotal, true) + ' (' + formatBytes(p.zfsTotal, false) + ')', 'On an empty pool, after slop space, in 128K-block units.'],
      ['Slop space', formatBytes(p.slop, true), p.embedded > Z.ZERO ? '1/32 of the pool, capped at 128 GiB, minus the intent-log metaslabs (' + formatBytes(p.embedded, true) + ').' : '1/32 of the pool, at least 128 MiB, at most 128 GiB.'],
      ['Metaslabs per vdev', fmtNum(toNum(v0.msCount), 0, 0) + ' × ' + formatShiftSize(v0.msShift), (p.embedded > Z.ZERO ? 'One per vdev holds the intent log. ' : '') + formatBytes(v0.asize - v0.space, true, true) + ' after the last metaslab stays unused' + (p.vdevs.length > 1 ? ' (vdev 1).' : '.')],
      ['Space ratio (deflate)', deflateLine, 'How zfs list converts raw space to data space on this vdev type.'],
      ['zpool create', '<code class="zrc-code zrc-code--cmd">' + esc(zpoolCommand(p, r.spareDisks.length)) + '</code>', 'disk1, disk2 … stand for your /dev/disk/by-id paths, in the same order as the disk list.']
    ];
    $('zrc-report').innerHTML = '<dl class="zrc-dl">' + report.map(function (x) {
      return '<div class="zrc-dl-row"><dt class="zrc-dt">' + x[0] + '</dt><dd class="zrc-dd"><span class="zrc-dd-val">' + x[1] + '</span><span class="zrc-dd-note">' + esc(x[2]) + '</span></dd></div>';
    }).join('') + '</dl>';

    // Vdev table
    var shown = p.vdevs.slice(0, MAX_VDEV_ROWS);
    $('zrc-vdev-table').innerHTML = '<thead><tr><th class="zrc-th zrc-th--name" scope="col">Vdev</th><th class="zrc-th" scope="col">Disks</th><th class="zrc-th" scope="col">Smallest</th><th class="zrc-th" scope="col">Data after parity</th><th class="zrc-th" scope="col">Unused</th><th class="zrc-th" scope="col">May fail</th></tr></thead><tbody>' +
      shown.map(function (v) {
        var kindName = L.kind === 'stripe' ? 'disk' : L.kind === 'mirror' ? 'mirror' : L.id;
        return '<tr class="zrc-tr"><td class="zrc-td zrc-td--name">' + kindName + '-' + v.index + '</td>' +
          '<td class="zrc-td" data-label="Disks">' + v.width + '</td>' +
          '<td class="zrc-td" data-label="Smallest">' + formatBytes(v.minDisk, false) + '</td>' +
          '<td class="zrc-td" data-label="Data after parity">' + formatBytes(v.ideal, false) + '</td>' +
          '<td class="zrc-td" data-label="Unused">' + (v.mixedWaste > Z.ZERO ? formatBytes(v.mixedWaste, false) : '0') + '</td>' +
          '<td class="zrc-td" data-label="May fail">' + v.tolerance + '</td></tr>';
      }).join('') +
      (p.vdevs.length > shown.length ? '<tr class="zrc-tr"><td class="zrc-td zrc-td--empty" colspan="6">… and ' + (p.vdevs.length - shown.length) + ' more vdevs.</td></tr>' : '') + '</tbody>';
  }

  function renderCompare(r) {
    var table = $('zrc-compare');
    var meta = $('zrc-compare-meta');
    if (!r.compare.length) {
      table.innerHTML = '<tbody><tr class="zrc-tr zrc-tr--empty"><td class="zrc-td zrc-td--empty">Fix the inputs above to compare layouts.</td></tr></tbody>';
      meta.textContent = '';
      return;
    }
    var cur = r.pool;
    var raw = toNum(r.raw);
    var best = r.compare.reduce(function (m, c) { return c.pool.afterSlop > m ? c.pool.afterSlop : m; }, Z.ZERO);
    meta.textContent = plural(r.active.length, 'disk') + ' · ' + plural(r.compare.length, 'layout');
    table.innerHTML = '<thead><tr><th class="zrc-th zrc-th--name" scope="col">Layout</th><th class="zrc-th" scope="col">After slop</th><th class="zrc-th" scope="col">At ' + fmtNum(r.fill, 0, 2) + '% fill</th><th class="zrc-th" scope="col">Of raw</th><th class="zrc-th" scope="col">May fail</th><th class="zrc-th" scope="col"><span class="zrc-sr">Action</span></th></tr></thead><tbody>' +
      r.compare.map(function (c, i) {
        var p = c.pool;
        var isCur = cur && cur.layout.id === c.id && cur.vdevCount === c.vdevs;
        var pct = raw ? toNum(p.afterSlop) / raw * 100 : 0;
        var rel = toNum(best) ? toNum(p.afterSlop) / toNum(best) * 100 : 0;
        return '<tr class="zrc-tr' + (isCur ? ' zrc-tr--current' : '') + '">' +
          '<td class="zrc-td zrc-td--name"><span class="zrc-step-name">' + esc(c.name) + '</span>' + (isCur ? '<span class="zrc-badge">current</span>' : '') + '</td>' +
          '<td class="zrc-td" data-label="After slop">' + formatBytes(p.afterSlop, false) + '<span class="zrc-td-sub">' + formatBytes(p.afterSlop, true) + '</span></td>' +
          '<td class="zrc-td" data-label="At ' + fmtNum(r.fill, 0, 2) + '% fill">' + formatBytes(p.atFill, false) + '<span class="zrc-td-sub">' + formatBytes(p.atFill, true) + '</span></td>' +
          '<td class="zrc-td zrc-td--share" data-label="Of raw"><span class="zrc-share"><span class="zrc-bar"><span class="zrc-bar-fill" style="width:' + rel.toFixed(2) + '%"></span></span><span class="zrc-share-val">' + fmtNum(pct, 1, 1) + '%</span></span></td>' +
          '<td class="zrc-td" data-label="May fail">' + toleranceText(p.tolerance, p.layout, c.vdevs) + '</td>' +
          '<td class="zrc-td zrc-td--act">' + (isCur ? '' : '<button type="button" class="zrc-btn zrc-btn--secondary zrc-btn--small" data-use="' + i + '">Use</button>') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function renderClassic(r) {
    var table = $('zrc-classic');
    var notes = $('zrc-classic-notes');
    if (!r.classic.length) {
      table.innerHTML = '<tbody><tr class="zrc-tr zrc-tr--empty"><td class="zrc-td zrc-td--empty">Fix the disk list above to see classic RAID levels.</td></tr></tbody>';
      notes.innerHTML = '';
      return;
    }
    table.innerHTML = '<thead><tr><th class="zrc-th zrc-th--name" scope="col">Level</th><th class="zrc-th" scope="col">Usable</th><th class="zrc-th" scope="col">Of raw</th><th class="zrc-th" scope="col">May fail</th></tr></thead><tbody>' +
      r.classic.map(function (c) {
        var fail = c.guaranteed === 0 ? 'none' : (c.best > c.guaranteed ? 'any ' + c.guaranteed + ', up to ' + c.best : 'any ' + c.guaranteed);
        if (!c.valid) {
          return '<tr class="zrc-tr zrc-tr--invalid"><td class="zrc-td zrc-td--name"><span class="zrc-step-name">' + c.label + '</span><span class="zrc-step-desc">' + esc(c.what) + '</span></td>' +
            '<td class="zrc-td zrc-td--reason" colspan="3" data-label="Not possible">' + esc(c.reason) + '</td></tr>';
        }
        return '<tr class="zrc-tr"><td class="zrc-td zrc-td--name"><span class="zrc-step-name">' + c.label + '</span><span class="zrc-step-desc">' + esc(c.what) + '</span></td>' +
          '<td class="zrc-td" data-label="Usable">' + formatBytes(c.usable, false) + '<span class="zrc-td-sub">' + formatBytes(c.usable, true) + '</span></td>' +
          '<td class="zrc-td" data-label="Of raw">' + formatPct(c.usable, c.raw) + '</td>' +
          '<td class="zrc-td" data-label="May fail">' + fail + '</td></tr>';
      }).join('') + '</tbody>';
    notes.innerHTML = r.classicNotes.map(function (n) { return '<li class="zrc-assume-item">' + esc(n) + '</li>'; }).join('');
  }

  function updateHash() {
    var h = encodeHash(state);
    if (!hashActive && h === encodeHash(defaultState())) return;
    if (h === location.hash) return;
    lastHash = h;
    hashActive = true;
    try {
      history.replaceState(null, '', location.pathname + location.search + h);
    } catch (e) { /* sandboxed frames may refuse; the tool still works */ }
  }

  function render() {
    var r = compute(state);
    lastResult = r;
    renderGroups(r);
    renderLayoutHints(r);
    renderIssues(r);
    renderResults(r);
    renderCompare(r);
    renderClassic(r);
    updateHash();
  }

  // ── Events ────────────────────────────────────────────────

  function onInput(e) {
    var t = e.target;
    if (!t || (!t.id && !t.name)) return;
    var group = t.closest ? t.closest('.zrc-group') : null;
    if (group && t.getAttribute('data-k')) {
      var i = parseInt(group.getAttribute('data-i'), 10);
      if (state.disks[i]) state.disks[i][t.getAttribute('data-k')] = t.value;
      render();
      return;
    }
    if (t.name === 'zrc-layout') {
      if (t.checked) state.layout = t.value;
    } else if (t.id === 'zrc-vdevs') {
      if (t.disabled) return;
      state.vdevs = t.value;
    } else if (t.id === 'zrc-spares') {
      state.spares = t.value;
    } else if (t.id === 'zrc-ashift') {
      state.ashift = t.value;
    } else if (t.id === 'zrc-recordsize') {
      state.recordsize = t.value;
    } else if (t.id === 'zrc-fill') {
      state.fill = t.value;
    } else {
      return;
    }
    render();
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var del = t.closest('[data-act="del"]');
    if (del) {
      var group = del.closest('.zrc-group');
      var i = parseInt(group.getAttribute('data-i'), 10);
      if (state.disks.length > 1) state.disks.splice(i, 1);
      else state.disks = [emptyGroup()];
      buildGroups();
      render();
      return;
    }
    var use = t.closest('[data-use]');
    if (use && lastResult) {
      var c = lastResult.compare[parseInt(use.getAttribute('data-use'), 10)];
      if (!c) return;
      state.layout = c.id;
      if (LAYOUTS[c.id].kind === 'raidz') state.vdevs = c.vdevs === 1 ? '' : String(c.vdevs);
      writeForm();
      render();
      var h = $('zrc-h-results');
      if (h && h.scrollIntoView) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('Loaded ' + c.name);
    }
  }

  function addGroup() {
    if (state.disks.length >= MAX_GROUPS) return;
    var last = state.disks[state.disks.length - 1];
    state.disks.push({ qty: '', size: '', unit: last ? last.unit : 'TB' });
    buildGroups();
    render();
    var input = $('zrc-q-' + (state.disks.length - 1));
    if (input) input.focus();
  }

  function showToast(msg, isError) {
    var toast = $('zrc-toast');
    toast.textContent = msg;
    toast.classList.toggle('zrc-toast--error', !!isError);
    toast.classList.add('zrc-show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.classList.remove('zrc-show'); }, 2000);
  }

  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) showToast(okMsg);
      else showToast('Copy failed — select the text and copy it by hand', true);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast(okMsg); }, fallback);
    } else {
      fallback();
    }
  }

  function currentLink() {
    return location.href.split('#')[0] + encodeHash(state);
  }

  function copySummary() {
    copyText(buildSummary(lastResult || compute(state), state, currentLink()), 'Summary copied');
  }

  function copyLink() {
    copyText(currentLink(), 'Link copied');
  }

  function init() {
    var wrapper = $('zrc-wrapper');
    if (!wrapper) return;
    if (!HAS_BIGINT) {
      $('zrc-issues').innerHTML = '<li class="zrc-issue zrc-issue--error"><span class="zrc-issue-tag">Error</span><span class="zrc-issue-text">This browser is too old for the calculator (it lacks BigInt). Please use a current browser.</span></li>';
      $('zrc-issues').classList.remove('zrc-hidden');
      return;
    }
    if (isStateHash(location.hash)) {
      state = decodeHash(location.hash);
      hashActive = true;
    }
    writeForm();
    wrapper.addEventListener('input', onInput);
    wrapper.addEventListener('change', onInput);
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

  // Global handlers for onclick attributes
  window.zrcAddGroup = addGroup;
  window.zrcCopySummary = copySummary;
  window.zrcCopyLink = copyLink;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      Z: Z,
      UNITS: UNITS,
      LAYOUTS: LAYOUTS,
      LAYOUT_ORDER: LAYOUT_ORDER,
      ASHIFTS: ASHIFTS,
      RECORDSIZES: RECORDSIZES,
      MAX_GROUPS: MAX_GROUPS,
      MAX_DISKS: MAX_DISKS,
      parseDecimal: parseDecimal,
      sizeToBytes: sizeToBytes,
      partitionBytes: partitionBytes,
      minDiskBytes: minDiskBytes,
      leafAsize: leafAsize,
      highbit64: highbit64,
      raidzPsizeToAsize: raidzPsizeToAsize,
      defaultPsizeToAsize: defaultPsizeToAsize,
      psizeToAsize: psizeToAsize,
      metaslabShift: metaslabShift,
      deflateRatio: deflateRatio,
      slopSpace: slopSpace,
      computeVdev: computeVdev,
      computePool: computePool,
      faultTolerance: faultTolerance,
      validVdevCounts: validVdevCounts,
      resolveLayout: resolveLayout,
      layoutName: layoutName,
      layoutOptions: layoutOptions,
      parseGroups: parseGroups,
      classicRaid: classicRaid,
      classicNotes: classicNotes,
      compareLayouts: compareLayouts,
      compute: compute,
      defaultState: defaultState,
      emptyGroup: emptyGroup,
      encodeHash: encodeHash,
      decodeHash: decodeHash,
      isStateHash: isStateHash,
      formatBytes: formatBytes,
      formatPct: formatPct,
      formatRecord: formatRecord,
      buildSummary: buildSummary,
      zpoolCommand: zpoolCommand
    };
  }
})();
