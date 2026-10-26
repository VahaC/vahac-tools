// Proxmox LXC idmap Generator — script.js
// Prefix: lxi-
// Dependencies: none.
//
// Behaviour this tool relies on, checked against primary sources on 2026-10-26:
// - Proxmox maps an unprivileged container as "u 0 100000 65536" and
//   "g 0 100000 65536". As soon as the config has one lxc.idmap line of its
//   own, Proxmox adds no default line at all, so a custom map must list both
//   users and groups (pve-container src/PVE/LXC.pm, update_lxc_config and
//   parse_id_maps).
// - Proxmox accepts "lxc.idmap: u <container> <host> <count>" (or "=") and
//   warns at container start when two entries overlap on the container side
//   or the host side (validate_id_maps). Config lines that start with "#"
//   become the container's description (PVE/LXC/Config.pm, parse_pct_config).
// - The lxc-pve package gives root 100000-165535 in /etc/subuid and
//   /etc/subgid (debian/lxc-pve.postinst) and depends on uidmap, so LXC writes
//   the map through newuidmap/newgidmap, which only accept host IDs that root
//   owns there (lxc src/lxc/idmap_utils.c, subuid(5), subgid(5)).
// - The kernel rejects maps whose ranges overlap and never maps 4294967295,
//   (uid_t) -1 (user_namespaces(7)).
// - Proxmox VE 9.2 added the mount point option idmap=type:container:disk:count
//   for unprivileged containers (pct.conf(5), resolve_mountpoint_idmap).
// - Mount paths may not contain "/./" or "/../" segments
//   (Config.pm, verify_lxc_mp_string), and options are comma separated.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Constants ───────────────────────────────────────────

  var DEFAULT_BASE = 100000;
  var DEFAULT_SIZE = 65536;
  var MAX_ID = 4294967294;          // 4294967295 is (uid_t) -1, never a real ID
  var CTID_MIN = 100;
  var CTID_MAX = 999999999;         // pct: <vmid> (100 - 999999999)
  var MP_MAX = 255;                 // mp0 ... mp255
  var MAX_PAIRS = 50;               // keeps every map far below the kernel's 340 lines
  var MAX_TEXT = 512;

  var SYSTEM_DIRS = ['/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64', '/proc', '/root', '/run', '/sbin', '/sys', '/usr', '/var'];

  // Wording per list; "both" is used when groups follow the user pairs.
  var NAMES = {
    u: { type: 'u', one: 'UID', many: 'UIDs', row: 'UID row', rows: 'UID rows' },
    g: { type: 'g', one: 'GID', many: 'GIDs', row: 'GID row', rows: 'GID rows' },
    both: { type: 'u', one: 'ID', many: 'IDs', row: 'Row', rows: 'Rows' }
  };

  // ── Small helpers ───────────────────────────────────────

  function str(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function clip(text) {
    var s = String(text).replace(/`/g, "'");
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  }

  function span(start, count) {
    return count === 1 ? String(start) : start + '–' + (start + count - 1);
  }

  function overlaps(aStart, aCount, bStart, bCount) {
    return aStart < bStart + bCount && bStart < aStart + aCount;
  }

  function word(names, count) {
    return count === 1 ? names.one : names.many;
  }

  function pairText(p) {
    return span(p.ct, p.count) + ' → ' + span(p.host, p.count);
  }

  function message(level, text, field) {
    return { level: level, text: text, field: field || '' };
  }

  function errorCount(msgs) {
    return msgs.filter(function (m) { return m.level === 'error'; }).length;
  }

  // POSIX single quotes when a word has anything beyond plain path characters
  function shellQuote(s) {
    if (/^[A-Za-z0-9_\/.,:=+@%-]+$/.test(s)) return s;
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Message text uses `backticks` for code
  function formatText(s) {
    return escapeHtml(s).replace(/`([^`]+)`/g, '<code class="lxi-code">$1</code>');
  }

  // ── State ───────────────────────────────────────────────

  function defaultState() {
    return {
      ctid: '100',
      base: String(DEFAULT_BASE),
      size: String(DEFAULT_SIZE),
      uids: [{ ct: '1000', host: '1000', count: '1' }],
      sameGids: true,
      gids: [],
      mp: '0',
      hostPath: '/mnt/bindmounts/shared',
      ctPath: '/shared'
    };
  }

  function cloneRows(rows) {
    return (rows || []).slice(0, MAX_PAIRS).map(function (r) {
      return { ct: str(r && r.ct), host: str(r && r.host), count: str(r && r.count) || '1' };
    });
  }

  function normalizeState(s) {
    var d = defaultState();
    s = s || {};
    return {
      ctid: s.ctid === undefined ? d.ctid : str(s.ctid),
      base: s.base === undefined ? d.base : str(s.base),
      size: s.size === undefined ? d.size : str(s.size),
      uids: cloneRows(s.uids === undefined ? d.uids : s.uids),
      sameGids: s.sameGids === undefined ? true : !!s.sameGids,
      gids: cloneRows(s.gids),
      mp: s.mp === undefined ? d.mp : str(s.mp),
      hostPath: s.hostPath === undefined ? d.hostPath : str(s.hostPath),
      ctPath: s.ctPath === undefined ? d.ctPath : str(s.ctPath)
    };
  }

  // Presets change the mapping; "wiki" reproduces the Proxmox wiki example.
  function presetState(name, current) {
    var s = normalizeState(current);
    var d = defaultState();
    if (name === 'reset') return d;
    if (name === 'wiki') {
      d.ctid = '1234';
      d.uids = [{ ct: '1005', host: '1005', count: '1' }];
      return d;
    }
    s.base = d.base;
    s.size = d.size;
    if (name === 'group') {
      s.uids = [];
      s.sameGids = false;
      s.gids = [{ ct: '1001', host: '1001', count: '1' }];
      return s;
    }
    s.uids = [{ ct: '1000', host: '1000', count: '1' }];
    s.sameGids = true;
    s.gids = [];
    return s;
  }

  // ── Number parsing ──────────────────────────────────────

  function parseUint(raw) {
    var s = str(raw);
    if (s === '') return { empty: true, text: s };
    if (!/^[0-9]+$/.test(s)) return { bad: true, text: s };
    return { value: s.length > 15 ? Infinity : Number(s), text: s };
  }

  function readNumber(raw, spec, msgs) {
    var r = parseUint(raw);
    if (r.empty) {
      msgs.push(message('error', spec.label + ' is empty. Enter a number from ' + spec.min + ' to ' + spec.max + '.', spec.field));
      return null;
    }
    if (r.bad) {
      msgs.push(message('error', spec.label + ' "' + clip(r.text) + '" is not a whole number. Use digits only, for example ' + spec.example + '.', spec.field));
      return null;
    }
    if (r.value < spec.min || r.value > spec.max) {
      msgs.push(message('error', spec.label + ' ' + clip(r.text) + ' is out of range: use ' + spec.min + '–' + spec.max + '.' + (spec.hint ? ' ' + spec.hint : ''), spec.field));
      return null;
    }
    return r.value;
  }

  // ── Mapping maths ───────────────────────────────────────

  // Validates one list of pairs and builds the full map for one ID type:
  // every container ID 0..size-1 appears exactly once, unlisted IDs keep the
  // shifted host ID (base + ID), and neighbouring lines that continue each
  // other on both sides are merged.
  function analyzeType(t, rows, ctx, msgs, names) {
    var base = ctx.base;
    var size = ctx.size;
    var start = errorCount(msgs);
    var pairs = [];
    var ctHint = size === DEFAULT_SIZE
      ? 'Proxmox gives a container 65536 IDs (0–65535). For higher IDs raise "IDs per container" under Advanced.'
      : 'The container range is 0–' + (size - 1) + ' ("IDs per container" under Advanced).';

    (rows || []).forEach(function (row, i) {
      var rawCt = str(row && row.ct);
      var rawHost = str(row && row.host);
      var rawCount = str(row && row.count);
      if (rawCt === '' && rawHost === '' && (rawCount === '' || rawCount === '1')) return;
      var label = names.row + ' ' + (i + 1);
      var field = function (k) { return t + ':' + i + ':' + k; };
      var ct = readNumber(rawCt, { label: label + ': container ' + names.one, min: 0, max: size - 1, example: '1000', field: field('ct'), hint: ctHint }, msgs);
      var host = readNumber(rawHost, { label: label + ': host ' + names.one, min: 0, max: MAX_ID, example: '1000', field: field('host'), hint: 'The kernel reserves 4294967295 as "no ID".' }, msgs);
      var count = rawCount === '' ? 1 : readNumber(rawCount, { label: label + ': count', min: 1, max: size, example: '1', field: field('count') }, msgs);
      if (ct === null || host === null || count === null) return;
      if (ct + count > size) {
        msgs.push(message('error', label + ': container ' + names.many + ' ' + span(ct, count) + ' run past ' + (size - 1) +
          ', the last ID of the container range. Lower the count to ' + (size - ct) + ' or less.', field('count')));
        return;
      }
      if (host + count - 1 > MAX_ID) {
        msgs.push(message('error', label + ': host ' + names.many + ' ' + span(host, count) + ' end above ' + MAX_ID +
          ', the highest valid ID. Lower the host ID or the count.', field('count')));
        return;
      }
      pairs.push({ ct: ct, host: host, count: count, row: i });
    });

    // Identical rows are harmless: keep the first one
    var kept = [];
    pairs.forEach(function (p) {
      var dup = kept.filter(function (k) { return k.ct === p.ct && k.host === p.host && k.count === p.count; })[0];
      if (dup) {
        msgs.push(message('warn', names.row + ' ' + (p.row + 1) + ' repeats row ' + (dup.row + 1) + ' (' + pairText(p) + '), so it is used once.', t + ':' + p.row + ':ct'));
        return;
      }
      kept.push(p);
    });

    // Overlaps between pairs, on the container side and on the host side
    for (var i = 0; i < kept.length; i++) {
      for (var j = i + 1; j < kept.length; j++) {
        var a = kept[i];
        var b = kept[j];
        var rowsLabel = names.rows + ' ' + (a.row + 1) + ' and ' + (b.row + 1);
        if (overlaps(a.ct, a.count, b.ct, b.count)) {
          msgs.push(message('error', rowsLabel + ' both map container ' + names.one + ' ' + Math.max(a.ct, b.ct) +
            ' (' + pairText(a) + ' and ' + pairText(b) + '). A container ' + names.one + ' can map to only one host ' + names.one +
            ': remove one row or change its container ' + names.one + '.', t + ':' + b.row + ':ct'));
        }
        if (overlaps(a.host, a.count, b.host, b.count)) {
          msgs.push(message('error', rowsLabel + ' both map to host ' + names.one + ' ' + Math.max(a.host, b.host) +
            ' (' + pairText(a) + ' and ' + pairText(b) + '). Two container IDs can\'t share one host ID, the kernel rejects overlapping ranges: change one host ' +
            names.one + '.', t + ':' + b.row + ':host'));
        }
      }
    }
    if (errorCount(msgs) > start) return { ok: false, pairs: kept, segments: [] };

    // Fill the gaps between the pairs with the shifted range
    var sorted = kept.slice().sort(function (x, y) { return x.ct - y.ct; });
    var segs = [];
    var cursor = 0;
    sorted.forEach(function (p) {
      if (p.ct > cursor) segs.push({ ct: cursor, host: base + cursor, count: p.ct - cursor, kind: 'shift' });
      segs.push({ ct: p.ct, host: p.host, count: p.count, kind: 'pair', row: p.row });
      cursor = p.ct + p.count;
    });
    if (cursor < size) segs.push({ ct: cursor, host: base + cursor, count: size - cursor, kind: 'shift' });

    // A host ID of a pair must not also be the shifted host ID of another container ID
    sorted.forEach(function (p) {
      segs.forEach(function (sg) {
        if (sg.kind !== 'shift' || !overlaps(p.host, p.count, sg.host, sg.count)) return;
        var hid = Math.max(p.host, sg.host);
        var other = sg.ct + (hid - sg.host);
        msgs.push(message('error', names.row + ' ' + (p.row + 1) + ': host ' + names.one + ' ' + hid +
          ' is already taken by the shifted range, because container ' + names.one + ' ' + other + ' maps there (' + base + ' + ' + other +
          '). Pick a host ' + names.one + ' outside ' + base + '–' + (base + size - 1) + '.', t + ':' + p.row + ':host'));
      });
    });
    if (errorCount(msgs) > start) return { ok: false, pairs: kept, segments: [] };

    sorted.forEach(function (p) {
      if (p.host === base + p.ct) {
        msgs.push(message('warn', names.row + ' ' + (p.row + 1) + ' (' + pairText(p) + ') is what the shifted range does anyway (' + base +
          ' + container ID), so it changes nothing. To reach the host user with ' + names.one + ' ' + p.ct + ', enter ' + p.ct + ' as the host ' + names.one + '.',
          t + ':' + p.row + ':host'));
      }
    });

    segs.forEach(function (sg) {
      if (sg.host === 0) {
        if (sg.kind === 'pair') {
          msgs.push(message('warn', names.row + ' ' + (sg.row + 1) + ': container ' + names.one + ' ' + sg.ct + ' maps to host ' + names.one + ' 0, ' +
            (names.one === 'GID' ? 'the root group. It gets root-group access to host files mounted into the container.'
              : 'which is root on the host. Files it writes on the bind mount belong to host root, and it can change host-root files mounted into the container.') +
            ' Map a dedicated host ' + (names.one === 'GID' ? 'group' : 'user') + ' instead unless you need exactly this.', t + ':' + sg.row + ':host'));
        } else {
          msgs.push(message('warn', 'Host base 0 maps container ' + names.one + ' ' + sg.ct + ' to host ' + names.one +
            ' 0 (root), which makes the container effectively privileged. Use the default base 100000.', 'base'));
        }
      }
      if (sg.kind === 'pair' && sg.ct === 0 && sg.host !== base) {
        msgs.push(message('warn', names.row + ' ' + (sg.row + 1) + ' remaps container root (' + names.one + ' 0) to host ' + names.one + ' ' + sg.host +
          ' instead of ' + base + '. Everything root owns in the container\'s own file system is stored as host ' + names.one + ' ' + base +
          ' and will show up as nobody, so the container usually stops working. Map a regular user unless you know you need this.', t + ':' + sg.row + ':ct'));
      }
    });

    var merged = [];
    segs.forEach(function (sg) {
      var last = merged[merged.length - 1];
      if (last && last.ct + last.count === sg.ct && last.host + last.count === sg.host) {
        last.count += sg.count;
        if (last.kind !== sg.kind) last.kind = 'shift';   // only a no-op pair continues a shifted run
        else if (sg.kind === 'pair') last.rows.push(sg.row);
        return;
      }
      merged.push({ ct: sg.ct, host: sg.host, count: sg.count, kind: sg.kind, rows: sg.kind === 'pair' ? [sg.row] : [] });
    });
    merged.forEach(function (m) { if (m.kind === 'shift') m.rows = []; });

    return { ok: true, pairs: kept, segments: merged };
  }

  // Host ranges root must own in /etc/subuid or /etc/subgid: the base range
  // when the map uses any of it, plus every host range outside of it.
  function subidRanges(segments, base, size) {
    var ranges = segments.map(function (sg) { return { start: sg.host, end: sg.host + sg.count }; })
      .sort(function (a, b) { return a.start - b.start; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else merged.push({ start: r.start, end: r.end });
    });
    var baseEnd = base + size;
    var out = [];
    if (merged.some(function (r) { return r.start < baseEnd && r.end > base; })) {
      out.push({ start: base, count: size, isBase: true, present: base === DEFAULT_BASE && size === DEFAULT_SIZE });
    }
    merged.forEach(function (r) {
      if (r.start < base) out.push({ start: r.start, count: Math.min(r.end, base) - r.start, isBase: false, present: false });
      if (r.end > baseEnd) {
        var from = Math.max(r.start, baseEnd);
        out.push({ start: from, count: r.end - from, isBase: false, present: false });
      }
    });
    out.forEach(function (o) { o.line = 'root:' + o.start + ':' + o.count; });
    return out;
  }

  function confLines(t, segments) {
    return segments.map(function (sg) {
      return 'lxc.idmap: ' + t + ' ' + sg.ct + ' ' + sg.host + ' ' + sg.count;
    });
  }

  function explainSegment(t, sg, base) {
    var names = NAMES[t];
    var w = word(names, sg.count);
    var head = 'Container ' + w + ' ' + span(sg.ct, sg.count) + ' → host ' + w + ' ' + span(sg.host, sg.count);
    if (sg.kind === 'shift') return head + ': the shifted range (' + base + ' + ID), unprivileged on the host.';
    return head + ': your pair. Host files owned by ' + span(sg.host, sg.count) + ' show up as ' + span(sg.ct, sg.count) +
      ' in the container, and files the container creates as ' + span(sg.ct, sg.count) + ' are stored as host ' + w + ' ' + span(sg.host, sg.count) + '.';
  }

  function pairSegments(res) {
    return res && res.ok ? res.segments.filter(function (sg) { return sg.kind === 'pair'; }) : [];
  }

  // ── Mount paths ─────────────────────────────────────────

  function checkPath(value, label, field, msgs) {
    if (value === '') {
      msgs.push(message('error', label + ' is empty. Enter an absolute path such as ' + (field === 'hostPath' ? '/mnt/bindmounts/shared' : '/shared') + '.', field));
      return false;
    }
    if (value.length > MAX_TEXT) {
      msgs.push(message('error', label + ' is longer than ' + MAX_TEXT + ' characters.', field));
      return false;
    }
    if (value.charAt(0) !== '/') {
      msgs.push(message('error', label + ' "' + clip(value) + '" must be an absolute path that starts with /.', field));
      return false;
    }
    if (/[\x00-\x1f\x7f]/.test(value)) {
      msgs.push(message('error', label + ' contains a control character. Retype the path.', field));
      return false;
    }
    if (value.indexOf(',') !== -1) {
      msgs.push(message('error', label + ' contains a comma. Proxmox separates mount point options with commas, so rename the folder or pick another path.', field));
      return false;
    }
    if (/\/\.\.?\//.test(value) || /\/\.\.?$/.test(value)) {
      msgs.push(message('error', label + ' contains a `/./` or `/../` segment, which Proxmox rejects. Enter the plain absolute path.', field));
      return false;
    }
    return true;
  }

  function checkMount(hostRaw, ctRaw, msgs) {
    var hostPath = str(hostRaw);
    var ctPath = str(ctRaw);
    if (hostPath === '') return null;
    var okHost = checkPath(hostPath, 'Host path', 'hostPath', msgs);
    var okCt = checkPath(ctPath, 'Path in container', 'ctPath', msgs);
    if (!okHost || !okCt) return false;
    var trimmed = hostPath.replace(/\/+$/, '') || '/';
    if (SYSTEM_DIRS.indexOf(trimmed) !== -1) {
      msgs.push(message('warn', 'Host path ' + trimmed + ' is a system directory. The Proxmox docs say never to bind mount directories like /, /var or /etc into a container: use a folder reserved for sharing, for example /mnt/bindmounts/shared.', 'hostPath'));
    }
    if ((ctPath.replace(/\/+$/, '') || '/') === '/') {
      msgs.push(message('warn', 'Mounting at / would hide the container\'s own file system. Pick a folder such as /shared.', 'ctPath'));
    }
    return { hostPath: hostPath, ctPath: ctPath };
  }

  // ── Everything together ─────────────────────────────────

  function generate(input) {
    var s = normalizeState(input);
    var msgs = [];
    var res = { ok: false, messages: msgs, texts: {} };

    var ctid = readNumber(s.ctid, { label: 'Container ID', min: CTID_MIN, max: CTID_MAX, example: '100', field: 'ctid' }, msgs);
    var base = readNumber(s.base, { label: 'Host base ID', min: 0, max: MAX_ID, example: '100000', field: 'base' }, msgs);
    var size = readNumber(s.size, { label: 'IDs per container', min: 1, max: MAX_ID + 1, example: '65536', field: 'size' }, msgs);
    if (base !== null && size !== null && base + size - 1 > MAX_ID) {
      msgs.push(message('error', 'Host base ' + base + ' plus ' + size + ' IDs ends above ' + MAX_ID + ', the highest valid ID. Lower the base or the number of IDs.', 'size'));
      size = null;
    }
    var mp = readNumber(s.mp, { label: 'Mount point number', min: 0, max: MP_MAX, example: '0', field: 'mp' }, msgs);
    var mount = checkMount(s.hostPath, s.ctPath, msgs);

    if (base === null || size === null) return finish(res);

    var ctx = { base: base, size: size };
    var same = s.sameGids;
    var u = analyzeType('u', s.uids, ctx, msgs, same ? NAMES.both : NAMES.u);
    var g = same ? u : analyzeType('g', s.gids, ctx, msgs, NAMES.g);
    res.u = u;
    res.g = g;
    if (errorCount(msgs) > 0 || ctid === null || mp === null || mount === false) return finish(res);

    var uPairs = pairSegments(u);
    var gPairs = pairSegments(g);
    var isDefault = base === DEFAULT_BASE && size === DEFAULT_SIZE;

    if (size < DEFAULT_SIZE) {
      msgs.push(message('warn', 'With ' + size + ' IDs per container, container IDs ' + size + '–65535 stay unmapped, nobody and nogroup (65534) included: users and files with those IDs can\'t be used in the container.', 'size'));
    }
    if (!uPairs.length && !gPairs.length) {
      msgs.push(message('info', isDefault
        ? 'No pairs, so these lines are exactly what Proxmox already uses for an unprivileged container. You don\'t need to add them.'
        : 'No pairs: these lines only move the container to the range ' + base + '–' + (base + size - 1) + '.'));
    } else if (!same && (!uPairs.length || !gPairs.length)) {
      var missing = uPairs.length ? 'g' : 'u';
      msgs.push(message('info', 'No ' + (missing === 'g' ? 'GID' : 'UID') + ' pairs, so the `' + missing + '` line keeps ' + (missing === 'g' ? 'groups' : 'users') +
        ' on the shifted range. Keep it anyway: once the config has one lxc.idmap line, Proxmox stops adding its default `u` and `g` lines.'));
    }
    var moved = uPairs.concat(gPairs).filter(function (sg) { return sg.ct !== 0 && sg.host !== base + sg.ct; })[0];
    if (moved) {
      var mt = uPairs.indexOf(moved) !== -1 ? 'UID' : 'GID';
      msgs.push(message('info', 'Existing files of a remapped ID keep their old host owner: container ' + mt + ' ' + moved.ct + ' is stored as host ' + mt + ' ' +
        (base + moved.ct) + ' today and will show up as nobody (65534). Map before you create the user, or re-own its files from the host (`pct mount ' + ctid + '`).'));
    }

    // 1. Container config
    var uLines = confLines('u', u.segments);
    var gLines = confLines('g', g.segments);
    res.conf = uLines.concat(gLines);
    res.explain = u.segments.map(function (sg, k) { return { line: uLines[k], text: explainSegment('u', sg, base) }; })
      .concat(g.segments.map(function (sg, k) { return { line: gLines[k], text: explainSegment('g', sg, base) }; }));
    res.coverage = 'Each container UID and GID from 0 to ' + (size - 1) + ' appears exactly once, and no two lines share a host ID.';
    res.confFile = '/etc/pve/lxc/' + ctid + '.conf';

    // 2. Subordinate IDs
    res.subuid = subidRanges(u.segments, base, size);
    res.subgid = subidRanges(g.segments, base, size);
    var cmds = [];
    [['subuid', res.subuid], ['subgid', res.subgid]].forEach(function (x) {
      x[1].forEach(function (r) {
        if (!r.present) cmds.push('grep -qxF \'' + r.line + '\' /etc/' + x[0] + ' || echo \'' + r.line + '\' >> /etc/' + x[0]);
      });
    });

    // 3. Bind mount and owner
    res.mount = null;
    if (mount) {
      var spec = mount.hostPath + ',mp=' + mount.ctPath;
      var firstU = u.pairs.length ? u.pairs[0] : null;
      var firstG = g.pairs.length ? g.pairs[0] : null;
      var owner;
      var note;
      if (firstU && firstG) {
        owner = firstU.host + ':' + firstG.host;
        note = same ? 'Owner and group are the host IDs of row 1.' : 'Owner is the host UID of UID row 1, group the host GID of GID row 1.';
      } else if (firstU) {
        owner = String(firstU.host);
        note = 'No GID pair, so only the owner changes.';
      } else if (firstG) {
        owner = ':' + firstG.host;
        note = 'No UID pair, so only the group changes. Make sure the group may write, for example `chmod -R g+rwX ' + shellQuote(mount.hostPath) + '`.';
      } else {
        owner = base + ':' + base;
        note = 'No pairs: container root (UID 0) works as host UID ' + base + ', so this hands the folder to container root.';
      }
      if (u.pairs.length > 1 || (!same && g.pairs.length > 1)) {
        note += ' A file has one owner: give the other mapped users their own subfolders, or share through the group.';
      }
      res.mount = {
        line: 'mp' + mp + ': ' + spec,
        pctSet: 'pct set ' + ctid + ' -mp' + mp + ' ' + shellQuote(spec),
        chown: 'chown -R ' + owner + ' ' + shellQuote(mount.hostPath),
        note: note
      };
    }

    // 4. Restart and check
    var apply = ['pct reboot ' + ctid];
    if (mount) apply.push('pct exec ' + ctid + ' -- ls -ln ' + shellQuote(mount.ctPath));
    res.apply = apply;
    res.applyNote = (mount ? 'Inside the container, `ls -ln` should now list the mapped IDs instead of 65534. ' : '') +
      'If the container is stopped, use `pct start ' + ctid + '`. If it fails to start, `pct start ' + ctid +
      ' --debug` shows the LXC error, for example a host range missing from /etc/subuid.';

    // Alternative: Proxmox VE 9.2+ mount point idmap
    var idmap = uPairs.map(function (sg) { return 'u:' + sg.ct + ':' + sg.host + ':' + sg.count; })
      .concat(gPairs.map(function (sg) { return 'g:' + sg.ct + ':' + sg.host + ':' + sg.count; })).join(';');
    res.mountIdmap = idmap;
    res.alt = null;
    if (mount && idmap) {
      var altSpec = mount.hostPath + ',mp=' + mount.ctPath + ',idmap=' + idmap;
      res.alt = { line: 'mp' + mp + ': ' + altSpec, pctSet: 'pct set ' + ctid + ' -mp' + mp + ' ' + shellQuote(altSpec) };
    }

    res.ok = true;
    res.texts = {
      conf: res.conf.join('\n'),
      subuid: res.subuid.map(function (r) { return r.line; }).join('\n'),
      subgid: res.subgid.map(function (r) { return r.line; }).join('\n'),
      subcmd: cmds.length ? cmds.join('\n') : '# Nothing to add: root:' + base + ':' + size + ' already covers every host ID in this map.',
      mpline: res.mount ? res.mount.line : '',
      pctset: res.mount ? res.mount.pctSet : '',
      chown: res.mount ? res.mount.chown : '',
      apply: apply.join('\n'),
      altline: res.alt ? res.alt.line : '',
      altset: res.alt ? res.alt.pctSet : ''
    };
    return finish(res);
  }

  function finish(res) {
    var order = { error: 0, warn: 1, info: 2 };
    res.messages.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return res;
  }

  // ── URL hash ────────────────────────────────────────────

  function encValue(v) {
    return encodeURIComponent(str(v).slice(0, MAX_TEXT)).replace(/-/g, '%2D').replace(/\./g, '%2E');
  }

  function encPath(v) {
    return encodeURIComponent(str(v).slice(0, MAX_TEXT)).replace(/%2F/gi, '/');
  }

  function decValue(v) {
    try { return decodeURIComponent(String(v)).slice(0, MAX_TEXT); } catch (e) { return ''; }
  }

  function encRows(rows) {
    return (rows || []).slice(0, MAX_PAIRS).map(function (r) {
      var parts = [encValue(r.ct), encValue(r.host)];
      var c = str(r.count);
      if (c !== '' && c !== '1') parts.push(encValue(c));
      return parts.join('-');
    }).join('.');
  }

  function decRows(text) {
    if (!text) return [];
    return String(text).split('.').slice(0, MAX_PAIRS).map(function (chunk) {
      var p = chunk.split('-');
      return { ct: decValue(p[0] || ''), host: decValue(p[1] || ''), count: p.length > 2 ? decValue(p[2]) : '1' };
    });
  }

  function encodeState(input) {
    var s = normalizeState(input);
    var out = ['ct=' + encValue(s.ctid)];
    if (s.base !== String(DEFAULT_BASE)) out.push('b=' + encValue(s.base));
    if (s.size !== String(DEFAULT_SIZE)) out.push('n=' + encValue(s.size));
    out.push('u=' + encRows(s.uids));
    if (!s.sameGids) out.push('g=' + encRows(s.gids));
    if (s.mp !== '0') out.push('mp=' + encValue(s.mp));
    out.push('hp=' + encPath(s.hostPath));
    out.push('cp=' + encPath(s.ctPath));
    return out.join('&');
  }

  function decodeState(hash) {
    var text = String(hash || '').replace(/^#/, '');
    if (!text) return null;
    var map = {};
    var has = function (k) { return Object.prototype.hasOwnProperty.call(map, k); };
    text.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) map[kv.slice(0, i)] = kv.slice(i + 1);
    });
    if (!has('ct') && !has('u') && !has('g')) return null;
    var s = defaultState();
    if (has('ct')) s.ctid = decValue(map.ct);
    if (has('b')) s.base = decValue(map.b);
    if (has('n')) s.size = decValue(map.n);
    if (has('u')) s.uids = decRows(map.u);
    if (has('g')) { s.sameGids = false; s.gids = decRows(map.g); }
    if (has('mp')) s.mp = decValue(map.mp);
    if (has('hp')) s.hostPath = decValue(map.hp);
    if (has('cp')) s.ctPath = decValue(map.cp);
    return normalizeState(s);
  }

  // ── UI ──────────────────────────────────────────────────

  var state = defaultState();
  var last = null;
  var touched = false;
  var toastTimer = null;

  var FIELD_IDS = {
    ctid: 'lxi-ctid',
    base: 'lxi-base',
    size: 'lxi-size',
    mp: 'lxi-mp',
    hostPath: 'lxi-host-path',
    ctPath: 'lxi-ct-path'
  };

  function listKey(kind) {
    return kind === 'g' ? 'gids' : 'uids';
  }

  function renderRows(kind) {
    var box = $('lxi-' + kind + '-rows');
    if (!box) return;
    var rows = state[listKey(kind)];
    var names = kind === 'u' && state.sameGids ? NAMES.both : NAMES[kind];
    if (!rows.length) {
      box.innerHTML = '<p class="lxi-empty">No ' + names.one + ' pairs: every container ' + names.one + ' keeps the shifted host ID.</p>';
    } else {
      box.innerHTML = rows.map(function (r, i) {
        var id = 'lxi-' + kind + '-' + i + '-';
        var label = names.row + ' ' + (i + 1);
        var input = function (key, value, placeholder, aria) {
          return '<input class="lxi-input lxi-input--mono" id="' + id + key + '" data-key="' + key + '" type="text" inputmode="numeric"' +
            ' value="' + escapeHtml(value) + '" placeholder="' + placeholder + '" aria-label="' + escapeHtml(label + ': ' + aria) + '" autocomplete="off" spellcheck="false">';
        };
        return '<div class="lxi-pair" data-kind="' + kind + '" data-row="' + i + '">' +
          input('ct', r.ct, '1000', 'container ' + names.one) +
          '<span class="lxi-pair-arrow" aria-hidden="true">→</span>' +
          input('host', r.host, '1000', 'host ' + names.one) +
          input('count', r.count, '1', 'count') +
          '<button class="lxi-icon-btn" type="button" data-action="remove" aria-label="Remove ' + escapeHtml(label) + '">×</button>' +
          '</div>';
      }).join('');
    }
    var add = $('lxi-' + kind + '-add');
    if (add) add.disabled = rows.length >= MAX_PAIRS;
  }

  function syncInputs() {
    $('lxi-ctid').value = state.ctid;
    $('lxi-base').value = state.base;
    $('lxi-size').value = state.size;
    $('lxi-mp').value = state.mp;
    $('lxi-host-path').value = state.hostPath;
    $('lxi-ct-path').value = state.ctPath;
    $('lxi-same').checked = state.sameGids;
    $('lxi-g-body').classList.toggle('lxi-hidden', state.sameGids);
    $('lxi-advanced').open = state.base !== String(DEFAULT_BASE) || state.size !== String(DEFAULT_SIZE) || $('lxi-advanced').open;
    renderRows('u');
    renderRows('g');
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function renderSubList(id, ranges) {
    $(id).innerHTML = ranges.length ? ranges.map(function (r) {
      var tag = r.present
        ? '<span class="lxi-tag lxi-tag--ok" title="Already in the file on a standard Proxmox VE install">default</span>'
        : '<span class="lxi-tag lxi-tag--add" title="Add this line">add</span>';
      return '<li class="lxi-sub-item"><code class="lxi-sub-line">' + escapeHtml(r.line) + '</code>' + tag + '</li>';
    }).join('') : '<li class="lxi-sub-item lxi-sub-item--none">Nothing needed</li>';
  }

  function render(res) {
    var box = $('lxi-messages');
    box.innerHTML = res.messages.map(function (m) {
      var icon = m.level === 'error' ? '✖' : (m.level === 'warn' ? '⚠' : 'ℹ');
      return '<div class="lxi-msg lxi-msg--' + m.level + '"><span class="lxi-msg-icon" aria-hidden="true">' + icon + '</span>' +
        '<span class="lxi-msg-text">' + formatText(m.text) + '</span></div>';
    }).join('');

    var wrapper = $('lxi-wrapper');
    Array.prototype.forEach.call(wrapper.querySelectorAll('.lxi-input--invalid'), function (el) {
      el.classList.remove('lxi-input--invalid');
      el.removeAttribute('aria-invalid');
    });
    res.messages.forEach(function (m) {
      if (m.level !== 'error' || !m.field) return;
      var id = FIELD_IDS[m.field];
      if (!id) {
        var p = m.field.split(':');
        id = 'lxi-' + p[0] + '-' + p[1] + '-' + p[2];
      }
      var el = $(id);
      if (el) {
        el.classList.add('lxi-input--invalid');
        el.setAttribute('aria-invalid', 'true');
      }
      if (m.field === 'base' || m.field === 'size') $('lxi-advanced').open = true;
    });

    ['u', 'g'].forEach(function (k) {
      var rows = state[listKey(k)].filter(function (r) { return str(r.ct) !== '' || str(r.host) !== ''; });
      setText('lxi-' + k + '-count', String(rows.length));
    });
    setText('lxi-g-count', state.sameGids ? 'same' : String(state.gids.filter(function (r) { return str(r.ct) !== '' || str(r.host) !== ''; }).length));

    $('lxi-blocked').classList.toggle('lxi-hidden', res.ok);
    $('lxi-output').classList.toggle('lxi-hidden', !res.ok);
    if (!res.ok) return;

    setText('lxi-conf-file', res.confFile);
    setText('lxi-conf-out', res.texts.conf);
    $('lxi-conf-explain').innerHTML = res.explain.map(function (e) {
      return '<li class="lxi-explain-item"><code class="lxi-explain-line">' + escapeHtml(e.line) + '</code>' +
        '<span class="lxi-explain-text">' + escapeHtml(e.text) + '</span></li>';
    }).join('') + '<li class="lxi-explain-item lxi-explain-item--sum"><span class="lxi-explain-text">' + escapeHtml(res.coverage) + '</span></li>';

    renderSubList('lxi-subuid-out', res.subuid);
    renderSubList('lxi-subgid-out', res.subgid);
    setText('lxi-subcmd-out', res.texts.subcmd);

    $('lxi-mount-body').classList.toggle('lxi-hidden', !res.mount);
    $('lxi-mount-empty').classList.toggle('lxi-hidden', !!res.mount);
    if (res.mount) {
      setText('lxi-mpline-out', res.mount.line);
      setText('lxi-pctset-out', res.mount.pctSet);
      setText('lxi-chown-out', res.mount.chown);
      $('lxi-chown-note').innerHTML = formatText(res.mount.note);
    }

    setText('lxi-apply-out', res.texts.apply);
    $('lxi-apply-note').innerHTML = formatText(res.applyNote);

    $('lxi-alt-body').classList.toggle('lxi-hidden', !res.alt);
    $('lxi-alt-empty').classList.toggle('lxi-hidden', !!res.alt);
    if (res.alt) {
      setText('lxi-altline-out', res.alt.line);
      setText('lxi-altset-out', res.alt.pctSet);
    }
  }

  function writeHash() {
    // Leave a foreign anchor (#comments, a heading link) alone until the user changes something
    if (!touched && location.hash && !decodeState(location.hash)) return;
    try {
      history.replaceState(null, '', '#' + encodeState(state));
    } catch (e) { /* file:// or sandboxed frame: sharing just won't work */ }
  }

  function update(byUser) {
    if (byUser) touched = true;
    last = generate(state);
    render(last);
    writeHash();
  }

  function showToast(text, isError) {
    var toast = $('lxi-toast');
    toast.textContent = text;
    toast.classList.toggle('lxi-toast--error', !!isError);
    toast.classList.add('lxi-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('lxi-show'); }, 2000);
  }

  function copyText(text, okMsg) {
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      showToast(ok ? okMsg : 'Copy failed — select the text and copy it by hand', !ok);
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () { showToast(okMsg); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function copy(key) {
    var text = last && last.ok ? last.texts[key] : '';
    if (text) copyText(text, 'Copied');
    else showToast('Nothing to copy yet', true);
  }

  function copyLink() {
    touched = true;
    writeHash();
    copyText(String(location.href), 'Link copied');
  }

  function addPair(kind) {
    var rows = state[listKey(kind)];
    if (rows.length >= MAX_PAIRS) {
      showToast('Up to ' + MAX_PAIRS + ' pairs per list', true);
      return;
    }
    rows.push({ ct: '', host: '', count: '1' });
    renderRows(kind);
    update(true);
    var el = $('lxi-' + kind + '-' + (rows.length - 1) + '-ct');
    if (el) el.focus();
  }

  function copyUidRows() {
    state.gids = cloneRows(state.uids);
    renderRows('g');
    update(true);
  }

  function applyPreset(name) {
    state = presetState(name, state);
    syncInputs();
    update(true);
  }

  function onInput(e) {
    var t = e.target;
    var row = t.closest ? t.closest('.lxi-pair') : null;
    if (row) {
      var list = state[listKey(row.getAttribute('data-kind'))];
      var item = list[Number(row.getAttribute('data-row'))];
      if (item) item[t.getAttribute('data-key')] = t.value;
      update(true);
      return;
    }
    var map = { 'lxi-ctid': 'ctid', 'lxi-base': 'base', 'lxi-size': 'size', 'lxi-mp': 'mp', 'lxi-host-path': 'hostPath', 'lxi-ct-path': 'ctPath' };
    if (map[t.id]) {
      state[map[t.id]] = t.value;
      update(true);
    }
  }

  function onChange(e) {
    if (e.target.id !== 'lxi-same') return;
    state.sameGids = e.target.checked;
    if (!state.sameGids && !state.gids.length) state.gids = cloneRows(state.uids);
    $('lxi-g-body').classList.toggle('lxi-hidden', state.sameGids);
    renderRows('u');
    renderRows('g');
    update(true);
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-action="remove"]') : null;
    if (!btn) return;
    var row = btn.closest('.lxi-pair');
    var kind = row.getAttribute('data-kind');
    state[listKey(kind)].splice(Number(row.getAttribute('data-row')), 1);
    renderRows(kind);
    update(true);
  }

  function loadFromHash() {
    var s = null;
    try { s = decodeState(location.hash); } catch (e) { s = null; }
    if (s) state = s;
    return !!s;
  }

  function init() {
    var wrapper = $('lxi-wrapper');
    if (!wrapper) return;
    loadFromHash();
    syncInputs();
    wrapper.addEventListener('input', onInput);
    wrapper.addEventListener('change', onChange);
    wrapper.addEventListener('click', onClick);
    wrapper.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        e.preventDefault();
        update();
      }
    });
    window.addEventListener('hashchange', function () {
      if (!loadFromHash()) return;
      syncInputs();
      update();
    });
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Expose global handlers for onclick attributes
  window.lxiAddPair = addPair;
  window.lxiCopyUidRows = copyUidRows;
  window.lxiPreset = applyPreset;
  window.lxiCopy = copy;
  window.lxiCopyLink = copyLink;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      DEFAULT_BASE: DEFAULT_BASE,
      DEFAULT_SIZE: DEFAULT_SIZE,
      MAX_ID: MAX_ID,
      MAX_PAIRS: MAX_PAIRS,
      NAMES: NAMES,
      defaultState: defaultState,
      normalizeState: normalizeState,
      presetState: presetState,
      parseUint: parseUint,
      analyzeType: analyzeType,
      subidRanges: subidRanges,
      confLines: confLines,
      explainSegment: explainSegment,
      checkMount: checkMount,
      shellQuote: shellQuote,
      formatText: formatText,
      generate: generate,
      encodeState: encodeState,
      decodeState: decodeState
    };
  }

})();
