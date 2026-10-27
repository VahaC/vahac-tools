/* Zigbee and Wi-Fi Channel Planner — script.js
   Prefix: zwc-
   Takes the 2.4 GHz Wi-Fi channels in use (your own access points and strong
   neighbours, 20 MHz or 40 MHz with HT40+ / HT40-) and a region, draws them
   next to the sixteen IEEE 802.15.4 channels 11-26, grades every Zigbee
   channel clear / marginal / overlapped from the 802.11 transmit masks and
   recommends a Zigbee channel (and a runner-up, plus one for Thread).
   No dependencies and no network calls: the whole setup lives in the URL hash.

   Radio facts and where they come from (also listed on the page):
   - 802.15.4 channel k: 2405 + 5 * (k - 11) MHz, k = 11..26 (IEEE 802.15.4,
     quoted in TI SWRU191F); 2 MHz wide channels at 5 MHz spacing (Silicon Labs
     Wi-Fi Coexistence Fundamentals).
   - 802.11 channel n: 2407 + 5 * n MHz for n = 1..13, channel 14 at 2484 MHz
     (Linux net/wireless/util.c); channel 14 is 802.11b only, Japan only
     (wireless-regdb 2026.09.03).
   - Transmit masks: 802.11n (HT) 2.4 GHz clause 19.3.18.1 and 802.11b DSSS
     clauses 15.4.5.5 / 16.3.7.4, as quoted in IEEE 802.11 documents
     11-22/1437r2 and 11-22/2076r0.
   - HT40+ / HT40- primaries: 1-7 / 5-11 in the US, 1-9 / 5-13 elsewhere
     (hostapd 2.11 hostapd.conf, from IEEE 802.11 Annex J). */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Radio facts ────────────────────────────────────────────────────────

  var ZB_FIRST = 11;
  var ZB_LAST = 26;
  var ZB_HALF = 1;                  // 802.15.4 2.4 GHz channels are 2 MHz wide
  var ZLL_CHANNELS = [11, 15, 20, 25];   // Zigbee2MQTT: "use a ZLL channel: 11, 15, 20, or 25"
  var BAND_LOW = 2400;
  var BAND_HIGH = 2483.5;
  var MAX_APS = 12;
  var MAX_NAME = 40;

  var REGIONS = {
    us: { label: 'United States', short: 'US', max: 11, plusMax: 7, ch14: false },
    eu: { label: 'Europe and most other countries', short: 'EU', max: 13, plusMax: 9, ch14: false },
    jp: { label: 'Japan', short: 'JP', max: 13, plusMax: 9, ch14: true }
  };
  var REGION_KEYS = ['us', 'eu', 'jp'];

  var WIDTHS = {
    '20': { label: '20 MHz', short: '20 MHz' },
    '40p': { label: '40 MHz, HT40+ (secondary above)', short: '40 MHz HT40+' },
    '40m': { label: '40 MHz, HT40− (secondary below)', short: '40 MHz HT40−' }
  };

  // Transmit spectrum masks: [offset from the channel centre in MHz, dBr].
  // Between points the standard interpolates linearly in dB.
  var MASKS = {
    ht20: {
      width: 20,
      points: [[0, 0], [9, 0], [11, -20], [20, -28], [30, -45]],
      floor: -45,
      label: '802.11n, 20 MHz'
    },
    ht40: {
      width: 40,
      points: [[0, 0], [19, 0], [21, -20], [40, -28], [60, -45]],
      floor: -45,
      label: '802.11n, 40 MHz'
    },
    dsss: {
      width: 22,
      points: [[0, 0], [11, 0], [11, -30], [22, -30], [22, -50]],
      floor: -50,
      label: '802.11b DSSS, 22 MHz'
    }
  };

  var GRADES = ['clear', 'marginal', 'overlap'];
  var GRADE_RANK = { clear: 0, marginal: 1, overlap: 2 };
  var GRADE_TEXT = { clear: 'Clear', marginal: 'Marginal', overlap: 'Overlapped' };

  // ── Frequency math ─────────────────────────────────────────────────────

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  // Centre of 802.15.4 channel k (11-26) in MHz, or null.
  function zigbeeCenter(k) {
    if (!isInt(k) || k < ZB_FIRST || k > ZB_LAST) return null;
    return 2405 + 5 * (k - 11);
  }

  // Centre of 2.4 GHz Wi-Fi channel n (1-14) in MHz, or null.
  function wifiCenter(n) {
    if (!isInt(n) || n < 1 || n > 14) return null;
    return n === 14 ? 2484 : 2407 + 5 * n;
  }

  // Occupied span of an access point: primary channel plus width code.
  // Returns null when the combination does not exist in 2.4 GHz.
  function wifiSpan(ch, width) {
    var fp = wifiCenter(ch);
    if (fp === null) return null;
    if (ch === 14) {
      if (width !== '20') return null;
      return { kind: 'dsss', center: 2484, primary: 14, secondary: null, low: 2473, high: 2495 };
    }
    if (width === '20') {
      return { kind: 'ht20', center: fp, primary: ch, secondary: null, low: fp - 10, high: fp + 10 };
    }
    if (width === '40p') {
      if (ch + 4 > 13) return null;
      return { kind: 'ht40', center: fp + 10, primary: ch, secondary: ch + 4, low: fp - 10, high: fp + 30 };
    }
    if (width === '40m') {
      if (ch - 4 < 1) return null;
      return { kind: 'ht40', center: fp - 10, primary: ch, secondary: ch - 4, low: fp - 30, high: fp + 10 };
    }
    return null;
  }

  // Mask level in dBr at a given offset (MHz) from the Wi-Fi centre.
  function maskLevel(kind, offset) {
    var m = MASKS[kind];
    var x = Math.abs(offset);
    if (kind === 'dsss') {
      // The boundaries belong to the lower zone, matching the grade thresholds
      if (x < 11) return 0;
      if (x < 22) return -30;
      return -50;
    }
    var p = m.points;
    for (var i = 1; i < p.length; i++) {
      if (x <= p[i][0]) {
        var x0 = p[i - 1][0], y0 = p[i - 1][1], x1 = p[i][0], y1 = p[i][1];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    return m.floor;
  }

  // Grade one Zigbee channel against one Wi-Fi channel, given the distance
  // between their centres (MHz) and the Wi-Fi mask kind.
  //   overlapped: the 2 MHz Zigbee channel reaches into the Wi-Fi channel
  //   marginal:   outside it, but the near Zigbee edge is less than one Wi-Fi
  //               channel width from the Wi-Fi centre (the mask's first skirt)
  //   clear:      the near Zigbee edge is at least one channel width away
  function gradeOffset(delta, kind) {
    var m = MASKS[kind];
    var d = Math.abs(delta);
    var near = d - ZB_HALF;
    var gap = near - m.width / 2;
    var grade = gap < 0 ? 'overlap' : (near < m.width ? 'marginal' : 'clear');
    return { delta: d, near: near, gap: gap, grade: grade, maskDb: maskLevel(kind, Math.max(0, near)) };
  }

  function regionChannels(region) {
    var r = REGIONS[region] || REGIONS.eu;
    var out = [];
    for (var n = 1; n <= r.max; n++) out.push(n);
    if (r.ch14) out.push(14);
    return out;
  }

  // Primary channels a region allows for each 40 MHz mode.
  function ht40Primaries(region, mode) {
    var r = REGIONS[region] || REGIONS.eu;
    var out = [];
    var n;
    if (mode === '40p') { for (n = 1; n <= r.plusMax; n++) out.push(n); }
    else if (mode === '40m') { for (n = 5; n <= r.max; n++) out.push(n); }
    return out;
  }

  // ── Input validation ───────────────────────────────────────────────────

  function toInt(v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (!/^\d{1,3}$/.test(s)) return null;
    return parseInt(s, 10);
  }

  function chText(span) {
    if (!span) return '?';
    if (span.secondary) return span.primary + '+' + span.secondary;
    return String(span.primary);
  }

  function apLabel(raw, i) {
    var name = String(raw && raw.name || '').trim();
    if (name) return name;
    return (raw && raw.o === 'own' ? 'Your AP' : 'Neighbour') + ' #' + (i + 1);
  }

  function validateAp(raw, region, i) {
    var r = REGIONS[region] || REGIONS.eu;
    var rk = REGIONS[region] ? region : 'eu';
    var res = {
      index: i,
      label: apLabel(raw, i),
      own: raw && raw.o === 'own',
      ch: toInt(raw && raw.ch),
      width: String(raw && raw.w || ''),
      span: null,
      errors: [],
      warnings: []
    };
    var chRaw = String(raw && raw.ch !== undefined ? raw.ch : '').trim();
    if (res.ch === null || res.ch < 1 || res.ch > 14) {
      res.errors.push('Channel "' + chRaw + '" is not a 2.4 GHz Wi-Fi channel: use 1–13 (14 only in Japan).');
      return res;
    }
    if (!WIDTHS[res.width]) {
      res.errors.push('Width "' + res.width + '" is not supported here: use 20 MHz, or 40 MHz with HT40+ or HT40−.');
      return res;
    }
    if (res.ch === 14 && res.width !== '20') {
      res.errors.push('Channel 14 is 802.11b (DSSS) only and 22 MHz wide, so it has no 40 MHz mode: set the width to 20 MHz.');
      return res;
    }
    if (res.width === '40p' && res.ch > 9) {
      res.errors.push('HT40+ on channel ' + res.ch + ' would need channel ' + (res.ch + 4) + ' as its secondary, which does not exist for 40 MHz: use HT40− (secondary ' + (res.ch - 4) + ') or a primary channel 1–9.');
      return res;
    }
    if (res.width === '40m' && res.ch < 5) {
      res.errors.push('HT40− on channel ' + res.ch + ' would need a secondary channel below 1: use HT40+ (secondary ' + (res.ch + 4) + ') or a primary channel 5–13.');
      return res;
    }
    res.span = wifiSpan(res.ch, res.width);
    if (res.ch === 14 && !r.ch14) {
      res.warnings.push('Channel 14 (2484 MHz) is allowed only in Japan, and only for 802.11b. Keep it only if a scan really shows it.');
    } else if (res.ch <= 13 && res.ch > r.max) {
      res.warnings.push('Channel ' + res.ch + ' is outside the ' + r.short + ' channel set (1–' + r.max + '). Keep it only if a scan really shows it, for example from a device set to another country.');
    } else if (res.width === '40p' && res.ch + 4 > r.max) {
      res.warnings.push('HT40+ on channel ' + res.ch + ' uses channel ' + (res.ch + 4) + ' as its secondary, outside the ' + r.short + ' set (1–' + r.max + '): access points sold there offer HT40+ only on primaries ' + ht40Primaries(rk, '40p')[0] + '–' + r.plusMax + '.');
    }
    if (res.ch === 14) {
      res.warnings.push('Drawn as 802.11b DSSS, 22 MHz wide (2473–2495 MHz), with the DSSS transmit mask.');
    }
    return res;
  }

  function zbChannelValue(v) {
    var n = toInt(v);
    return n !== null && n >= ZB_FIRST && n <= ZB_LAST ? n : null;
  }

  // ── Evaluation ─────────────────────────────────────────────────────────

  function isZll(k) { return ZLL_CHANNELS.indexOf(k) >= 0; }

  function evaluate(s) {
    var region = REGIONS[s.region] ? s.region : 'eu';
    var issues = [];
    var rawAps = (s.aps || []);
    if (rawAps.length > MAX_APS) {
      issues.push({ level: 'warn', text: 'Only the first ' + MAX_APS + ' access points are used; ' + (rawAps.length - MAX_APS) + ' more were left out.' });
    }
    var aps = rawAps.slice(0, MAX_APS).map(function (raw, i) { return validateAp(raw, region, i); });
    var good = aps.filter(function (a) { return a.span !== null; });

    var cur = zbChannelValue(s.cur);
    var thread = zbChannelValue(s.thread);
    if (String(s.cur || '').trim() !== '' && cur === null) {
      issues.push({ level: 'warn', text: 'Current Zigbee channel "' + String(s.cur) + '" is not 11–26, so it was ignored.' });
    }
    if (String(s.thread || '').trim() !== '' && thread === null) {
      issues.push({ level: 'warn', text: 'Thread channel "' + String(s.thread) + '" is not 11–26, so it was ignored.' });
    }
    if (cur !== null && thread !== null && cur === thread) {
      issues.push({ level: 'warn', text: 'Zigbee and Thread are both on channel ' + cur + ': the two meshes then share one channel’s airtime. Move one of them (the recommendation below avoids the Thread channel).' });
    }

    var channels = [];
    for (var k = ZB_FIRST; k <= ZB_LAST; k++) {
      var fz = zigbeeCenter(k);
      var per = good.map(function (a) {
        var g = gradeOffset(fz - a.span.center, a.span.kind);
        g.ap = a;
        return g;
      });
      var worst = 'clear';
      var nearest = null;
      per.forEach(function (g) {
        if (GRADE_RANK[g.grade] > GRADE_RANK[worst]) worst = g.grade;
        if (!nearest || g.gap < nearest.gap || (g.gap === nearest.gap && g.maskDb > nearest.maskDb)) nearest = g;
      });
      var count = worst === 'clear' ? 0 : per.filter(function (g) { return g.grade === worst; }).length;
      channels.push({
        k: k,
        center: fz,
        low: fz - ZB_HALF,
        high: fz + ZB_HALF,
        per: per,
        worst: worst,
        count: count,
        nearest: nearest,
        gap: nearest ? nearest.gap : Infinity,
        zll: isZll(k),
        usPower: region === 'us' && k >= 25,
        isThread: thread === k,
        isCurrent: cur === k
      });
    }

    var r = {
      region: region,
      aps: aps,
      good: good,
      channels: channels,
      cur: cur,
      thread: thread,
      allow26: !!s.allow26,
      issues: issues,
      rec: null,
      runnerUp: null,
      threadPick: null
    };

    if (good.length > 0) {
      var ranked = rankZigbee(channels, r.allow26);
      r.rec = ranked[0] || null;
      r.runnerUp = ranked[1] || null;
      var avoid = [];
      if (r.rec) avoid.push(r.rec.k);
      if (cur !== null) avoid.push(cur);
      r.threadPick = rankThread(channels, avoid)[0] || null;
    }
    return r;
  }

  // Lower is better. Channel 26 counts as a preferred channel only when the
  // user confirmed every device supports it (otherwise it is not a candidate).
  function tierOf(c, allow26) {
    return c.zll || (c.k === 26 && allow26) ? 0 : 1;
  }

  function compareBase(a, b) {
    return GRADE_RANK[a.worst] - GRADE_RANK[b.worst] || a.count - b.count;
  }

  function compareTail(a, b) {
    var p = (a.usPower ? 1 : 0) - (b.usPower ? 1 : 0);
    if (p) return p;
    if (a.gap !== b.gap) return a.gap > b.gap ? -1 : 1;
    return a.k - b.k;
  }

  // Zigbee pick: best grade, fewest Wi-Fi networks at that grade, ZLL
  // channels first, US reduced-power channels later, widest gap, lowest number.
  function rankZigbee(channels, allow26) {
    return channels.filter(function (c) {
      return !c.isThread && (c.k !== 26 || allow26);
    }).sort(function (a, b) {
      return compareBase(a, b) || tierOf(a, allow26) - tierOf(b, allow26) || compareTail(a, b);
    });
  }

  // Thread pick: same rules without the ZLL preference, channel 26 allowed,
  // never the recommended or current Zigbee channel.
  function rankThread(channels, avoid) {
    return channels.filter(function (c) {
      return avoid.indexOf(c.k) < 0;
    }).sort(function (a, b) {
      return compareBase(a, b) || compareTail(a, b);
    });
  }

  // ── Text helpers ───────────────────────────────────────────────────────

  var MINUS = '−';

  function fmtNum(v, ascii) {
    var a = Math.abs(v);
    var t = Math.round(a * 10) / 10;
    var s = (t % 1 === 0) ? String(t) : t.toFixed(1);
    if (v < 0 && t !== 0) s = (ascii ? '-' : MINUS) + s;
    return s;
  }

  function fmtDb(v, ascii) {
    return fmtNum(v, ascii) + ' dBr';
  }

  function apRef(g) {
    return 'channel ' + chText(g.ap.span) + ' (' + g.ap.label + ')';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function reasonFor(c, r, ascii) {
    var n = r.good.length;
    var g = c.nearest;
    var text;
    if (!g) return '';
    if (c.worst === 'clear') {
      text = n === 1
        ? 'Clear of the Wi-Fi network you entered: its edge, ' + apRef(g) + ', is ' + fmtNum(g.gap, ascii) + ' MHz away.'
        : 'Clear of all ' + n + ' Wi-Fi networks: the nearest edge, ' + apRef(g) + ', is ' + fmtNum(g.gap, ascii) + ' MHz away.';
    } else if (c.worst === 'marginal') {
      text = 'No overlap, but on the transmit-mask skirt of ' + plural(c.count, 'Wi-Fi network', 'Wi-Fi networks') +
        ': ' + fmtNum(g.gap, ascii) + ' MHz from the edge of ' + apRef(g) + '.';
    } else {
      var deepest = null;
      c.per.forEach(function (x) { if (x.grade === 'overlap' && (!deepest || x.gap < deepest.gap)) deepest = x; });
      text = 'Overlaps ' + plural(c.count, 'Wi-Fi network', 'Wi-Fi networks') + ': ' +
        fmtNum(-deepest.gap, ascii) + ' MHz inside the edge of ' + apRef(deepest) + '. No channel here avoids every network.';
    }
    if (c.usPower) text += ' On US radios, channels 25 and 26 need reduced transmit power.';
    return text;
  }

  function threadReason(c, r, ascii) {
    if (!c) return '';
    return GRADE_TEXT[c.worst] + (c.nearest ? ', ' + fmtNum(c.nearest.gap, ascii) + ' MHz from the nearest Wi-Fi edge' : '') +
      (r.rec ? ', and not the Zigbee pick' : '') + '.';
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function z2mSnippet(k) {
    return 'advanced:\n    channel: ' + k + '\n';
  }

  function buildSummary(r, link) {
    var reg = REGIONS[r.region];
    var lines = [];
    lines.push('Zigbee and Wi-Fi channel plan (' + reg.label + ', Wi-Fi channels 1-' + reg.max + (reg.ch14 ? ', 14 for 802.11b' : '') + ')');
    lines.push('Wi-Fi: ' + (r.good.length ? r.good.map(function (a) {
      return a.label + ' ' + chText(a.span) + ' (' + (a.span.kind === 'dsss' ? '802.11b' : WIDTHS[a.width].short.replace(MINUS, '-')) + ')';
    }).join('; ') : 'none entered'));
    if (r.rec) {
      lines.push('Recommended Zigbee channel: ' + r.rec.k + ' (' + GRADE_TEXT[r.rec.worst].toLowerCase() + ') - ' + reasonFor(r.rec, r, true));
      if (r.runnerUp) lines.push('Runner-up: ' + r.runnerUp.k + ' (' + GRADE_TEXT[r.runnerUp.worst].toLowerCase() + ') - ' + reasonFor(r.runnerUp, r, true));
      if (r.threadPick) lines.push('For a Thread network: ' + r.threadPick.k + ' (' + GRADE_TEXT[r.threadPick.worst].toLowerCase() + ')');
    }
    if (r.cur !== null) {
      var c = r.channels[r.cur - ZB_FIRST];
      lines.push('Current Zigbee channel: ' + r.cur + ' (' + GRADE_TEXT[c.worst].toLowerCase() + ')');
    }
    lines.push('Zigbee 11-26: ' + r.channels.map(function (c) { return c.k + ' ' + GRADE_TEXT[c.worst].toLowerCase(); }).join(', '));
    lines.push('Grades: overlapped = inside a Wi-Fi channel; marginal = outside it but closer than one channel width to the Wi-Fi centre; clear = farther (802.11 transmit masks).');
    if (link) lines.push('Link: ' + link);
    return lines.join('\n');
  }

  // ── State and URL hash ─────────────────────────────────────────────────

  function emptyAp(own) {
    return { ch: '6', w: '20', o: own ? 'own' : 'nb', name: '' };
  }

  function defaultState() {
    return {
      region: 'eu',
      aps: [
        { ch: '6', w: '20', o: 'own', name: 'My router' },
        { ch: '1', w: '20', o: 'nb', name: '' },
        { ch: '11', w: '20', o: 'nb', name: '' }
      ],
      cur: '',
      thread: '',
      allow26: false
    };
  }

  var PRESETS = {
    '1-6-11': [['1', '20'], ['6', '20'], ['11', '20']],
    '1-5-9-13': [['1', '20'], ['5', '20'], ['9', '20'], ['13', '20']],
    'single-6': [['6', '20']],
    '40-1-5': [['1', '40p']]
  };

  function presetAps(key) {
    var p = PRESETS[key];
    if (!p) return null;
    return p.map(function (x, i) { return { ch: x[0], w: x[1], o: i === 0 ? 'own' : 'nb', name: '' }; });
  }

  function encodeHash(s) {
    var parts = ['v=1', 'r=' + encodeURIComponent(String(s.region || 'eu'))];
    (s.aps || []).forEach(function (a) {
      parts.push('a=' + [a.ch, a.w, a.o === 'own' ? 'o' : 'n', a.name || ''].map(function (v) {
        return encodeURIComponent(String(v === undefined || v === null ? '' : v));
      }).join(','));
    });
    if (String(s.cur || '') !== '') parts.push('z=' + encodeURIComponent(String(s.cur)));
    if (String(s.thread || '') !== '') parts.push('t=' + encodeURIComponent(String(s.thread)));
    if (s.allow26) parts.push('x=1');
    return '#' + parts.join('&');
  }

  function safeDecode(v) {
    try { return decodeURIComponent(v); } catch (e) { return ''; }
  }

  function clip(v, max) { return String(v).slice(0, max); }

  // Only hashes this tool wrote (they start with v=1) are state; an in-page
  // anchor such as #how-to-use-it must not wipe the form.
  function isStateHash(hash) {
    return /^#?v=\d/.test(String(hash || ''));
  }

  function decodeHash(hash) {
    if (!isStateHash(hash)) return defaultState();
    var s = { region: 'eu', aps: [], cur: '', thread: '', allow26: false };
    String(hash).replace(/^#/, '').split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq <= 0) return;
      var key = pair.slice(0, eq);
      var raw = pair.slice(eq + 1);
      if (key === 'a') {
        if (s.aps.length >= MAX_APS) return;
        var f = raw.split(',').map(safeDecode);
        s.aps.push({
          ch: clip(f[0] || '', 3),
          w: clip(f[1] || '', 3),
          o: f[2] === 'o' ? 'own' : 'nb',
          name: clip(f[3] || '', MAX_NAME)
        });
        return;
      }
      var v = safeDecode(raw);
      if (key === 'r') s.region = REGIONS[v] ? v : 'eu';
      else if (key === 'z') s.cur = clip(v, 3);
      else if (key === 't') s.thread = clip(v, 3);
      else if (key === 'x') s.allow26 = v === '1';
    });
    return s;
  }

  // ── DOM rendering ──────────────────────────────────────────────────────

  var state = defaultState();
  var lastResult = null;
  var lastHash = '';
  var hashActive = false;   // the hash is written after the first change or when the page was opened from one

  function showToast(msg, isError) {
    var t = $('zwc-toast');
    t.textContent = msg;
    t.classList.toggle('zwc-toast--error', !!isError);
    t.classList.add('zwc-show');
    setTimeout(function () { t.classList.remove('zwc-show'); }, 2000);
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
      showToast(ok ? okMsg : 'Copy failed: select the text and copy it by hand', !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast(okMsg); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function option(value, text, selected) {
    return '<option value="' + escapeHtml(value) + '"' + (selected ? ' selected' : '') + '>' + escapeHtml(text) + '</option>';
  }

  function apRowHtml(a, i) {
    var p = 'zwc-ap' + i + '-';
    var chOpts = '';
    var known = false;
    for (var n = 1; n <= 14; n++) {
      var sel = String(a.ch) === String(n);
      if (sel) known = true;
      chOpts += option(String(n), n + ' · ' + wifiCenter(n) + ' MHz' + (n === 14 ? ' (802.11b)' : ''), sel);
    }
    if (!known) chOpts = option(String(a.ch), '"' + a.ch + '" (invalid)', true) + chOpts;
    var wOpts = '';
    var wKnown = false;
    Object.keys(WIDTHS).forEach(function (w) {
      var sel = a.w === w;
      if (sel) wKnown = true;
      wOpts += option(w, WIDTHS[w].label, sel);
    });
    if (!wKnown) wOpts = option(a.w, '"' + a.w + '" (invalid)', true) + wOpts;
    return '<div class="zwc-ap" data-i="' + i + '">' +
      '<div class="zwc-ap-grid">' +
        '<div class="zwc-field zwc-field--name">' +
          '<label class="zwc-label" for="' + p + 'name">Name</label>' +
          '<input class="zwc-input" id="' + p + 'name" data-f="name" type="text" maxlength="' + MAX_NAME + '" autocomplete="off" spellcheck="false" placeholder="' + escapeHtml(apLabel(a, i)) + '" value="' + escapeHtml(a.name) + '">' +
        '</div>' +
        '<div class="zwc-field zwc-field--owner">' +
          '<label class="zwc-label" for="' + p + 'o">Whose</label>' +
          '<select class="zwc-input zwc-select" id="' + p + 'o" data-f="o">' +
            option('own', 'Mine', a.o === 'own') + option('nb', 'Neighbour', a.o !== 'own') +
          '</select>' +
        '</div>' +
        '<div class="zwc-field zwc-field--ch">' +
          '<label class="zwc-label" for="' + p + 'ch">Channel</label>' +
          '<select class="zwc-input zwc-select" id="' + p + 'ch" data-f="ch">' + chOpts + '</select>' +
        '</div>' +
        '<div class="zwc-field zwc-field--width">' +
          '<label class="zwc-label" for="' + p + 'w">Width</label>' +
          '<select class="zwc-input zwc-select" id="' + p + 'w" data-f="w">' + wOpts + '</select>' +
        '</div>' +
        '<button class="zwc-btn zwc-btn--icon zwc-ap-remove" type="button" data-act="remove" aria-label="Remove ' + escapeHtml(apLabel(a, i)) + '" title="Remove">&times;</button>' +
      '</div>' +
      '<div class="zwc-ap-msg" id="' + p + 'msg" aria-live="polite"></div>' +
    '</div>';
  }

  function renderApRows() {
    var list = $('zwc-aps');
    if (state.aps.length === 0) {
      list.innerHTML = '<p class="zwc-empty">No Wi-Fi networks yet. Add the 2.4 GHz channels your router uses and the strong neighbours a Wi-Fi scan shows, or start from a preset.</p>';
    } else {
      list.innerHTML = state.aps.map(apRowHtml).join('');
    }
    $('zwc-add').disabled = state.aps.length >= MAX_APS;
    $('zwc-ap-count').textContent = state.aps.length + ' / ' + MAX_APS;
  }

  function issueHtml(level, text) {
    return '<li class="zwc-issue zwc-issue--' + level + '">' + escapeHtml(text) + '</li>';
  }

  function renderApMessages(r) {
    r.aps.forEach(function (a, i) {
      var el = $('zwc-ap' + i + '-msg');
      if (!el) return;
      var items = a.errors.map(function (t) { return issueHtml('error', t); })
        .concat(a.warnings.map(function (t) { return issueHtml('warn', t); }));
      var info = a.span ? '<span class="zwc-ap-span">' + a.span.low + '–' + a.span.high + ' MHz, centre ' + a.span.center + ' MHz' + (a.span.secondary ? ', secondary channel ' + a.span.secondary : '') + '</span>' : '';
      el.innerHTML = info + (items.length ? '<ul class="zwc-issues">' + items.join('') + '</ul>' : '');
      var row = el.parentNode;
      if (row && row.classList) row.classList.toggle('zwc-ap--error', a.errors.length > 0);
    });
    var gi = $('zwc-issues');
    gi.innerHTML = r.issues.map(function (x) { return issueHtml(x.level, x.text); }).join('');
    gi.classList.toggle('zwc-hidden', r.issues.length === 0);
  }

  function badge(grade) {
    return '<span class="zwc-badge zwc-badge--' + grade + '">' + GRADE_TEXT[grade] + '</span>';
  }

  function renderRec(r) {
    var box = $('zwc-rec');
    if (!r.rec) {
      box.innerHTML = '<p class="zwc-rec-empty">' + (r.aps.length ? 'None of the Wi-Fi rows can be used yet: fix the errors above to get a recommendation.' : 'Add at least one Wi-Fi network to get a recommendation. Without Wi-Fi every Zigbee channel is clear.') + '</p>';
      return;
    }
    var html = '<div class="zwc-rec-main">' +
      '<div class="zwc-rec-num"><span class="zwc-rec-kicker">Zigbee channel</span><span class="zwc-rec-big">' + r.rec.k + '</span></div>' +
      '<div class="zwc-rec-body">' +
        '<p class="zwc-rec-line">' + badge(r.rec.worst) + ' <span class="zwc-rec-mhz">' + r.rec.center + ' MHz</span></p>' +
        '<p class="zwc-rec-reason">' + escapeHtml(reasonFor(r.rec, r)) + '</p>' +
      '</div>' +
    '</div>';
    var rows = [];
    if (r.runnerUp) {
      rows.push('<li class="zwc-rec-item"><span class="zwc-rec-tag">Runner-up</span> <strong>' + r.runnerUp.k + '</strong> ' + badge(r.runnerUp.worst) + ' <span class="zwc-rec-text">' + escapeHtml(reasonFor(r.runnerUp, r)) + '</span></li>');
    }
    if (r.cur !== null) {
      var c = r.channels[r.cur - ZB_FIRST];
      var verdict;
      if (r.cur === r.rec.k) verdict = 'This is already the best channel for the Wi-Fi you entered: keep it.';
      else if (GRADE_RANK[c.worst] <= GRADE_RANK[r.rec.worst]) verdict = 'It already has the best grade available here; ZHA’s docs advise not changing the channel without a real reason.';
      else verdict = 'Moving to ' + r.rec.k + ' improves it from ' + GRADE_TEXT[c.worst].toLowerCase() + ' to ' + GRADE_TEXT[r.rec.worst].toLowerCase() + '. See what a change costs below.';
      rows.push('<li class="zwc-rec-item"><span class="zwc-rec-tag">Your channel</span> <strong>' + r.cur + '</strong> ' + badge(c.worst) + ' <span class="zwc-rec-text">' + escapeHtml(verdict) + '</span></li>');
    }
    if (r.thread !== null) {
      var t = r.channels[r.thread - ZB_FIRST];
      var tText = 'Kept out of the Zigbee pick.';
      if (r.threadPick && GRADE_RANK[r.threadPick.worst] < GRADE_RANK[t.worst]) tText += ' Channel ' + r.threadPick.k + ' (' + GRADE_TEXT[r.threadPick.worst].toLowerCase() + ') would suit Thread better.';
      rows.push('<li class="zwc-rec-item"><span class="zwc-rec-tag">Thread</span> <strong>' + r.thread + '</strong> ' + badge(t.worst) + ' <span class="zwc-rec-text">' + escapeHtml(tText) + '</span></li>');
    } else if (r.threadPick) {
      rows.push('<li class="zwc-rec-item"><span class="zwc-rec-tag">For Thread</span> <strong>' + r.threadPick.k + '</strong> ' + badge(r.threadPick.worst) + ' <span class="zwc-rec-text">' + escapeHtml('If you also run Thread or Matter over Thread: ' + threadReason(r.threadPick, r)) + '</span></li>');
    }
    if (rows.length) html += '<ul class="zwc-rec-list">' + rows.join('') + '</ul>';
    var bad = r.aps.length - r.good.length;
    if (bad > 0) {
      html += '<p class="zwc-hint">' + escapeHtml(plural(bad, 'Wi-Fi row has', 'Wi-Fi rows have') + ' an error and ' + (bad === 1 ? 'is' : 'are') + ' left out until fixed.') + '</p>';
    }
    if (r.rec.worst === 'overlap') {
      html += '<p class="zwc-rec-hint">Every Zigbee channel overlaps a Wi-Fi channel you entered. If some of these access points are yours, moving one of them (or narrowing it to 20 MHz) is the only way to open a gap.</p>';
    }
    box.innerHTML = html;
  }

  // ── Spectrum view (SVG) ────────────────────────────────────────────────

  var SVG = {
    w: 1000, h: 300, left: 54, right: 14,
    top: 46, base: 176,        // 0 dBr and -40 dBr lines of the Wi-Fi area
    zTop: 192, zBot: 222, zNum: 240, zMark: 256, axis: 286
  };
  var DB_SPAN = 40;

  function svgPolyPoints(span, fx, yOf) {
    var m = MASKS[span.kind];
    var pts = m.points.slice();
    var out = [];
    var i;
    for (i = pts.length - 1; i >= 0; i--) out.push([span.center - pts[i][0], pts[i][1]]);
    for (i = 0; i < pts.length; i++) out.push([span.center + pts[i][0], pts[i][1]]);
    var outer = pts[pts.length - 1][0];
    out.unshift([span.center - outer, -DB_SPAN]);
    out.push([span.center + outer, -DB_SPAN]);
    return out.map(function (p) {
      return fx(p[0]).toFixed(1) + ',' + yOf(Math.max(-DB_SPAN, p[1])).toFixed(1);
    }).join(' ');
  }

  function renderSpectrum(r) {
    var has14 = r.good.some(function (a) { return a.span.kind === 'dsss'; });
    var fMin = 2396;
    var fMax = has14 ? 2498 : 2488;
    var plotW = SVG.w - SVG.left - SVG.right;
    var fx = function (f) { return SVG.left + (f - fMin) / (fMax - fMin) * plotW; };
    var yOf = function (db) { return SVG.top + (-db / DB_SPAN) * (SVG.base - SVG.top); };
    var parts = [];
    parts.push('<svg class="zwc-svg" viewBox="0 0 ' + SVG.w + ' ' + SVG.h + '" role="img" aria-labelledby="zwc-svg-title zwc-svg-desc" xmlns="http://www.w3.org/2000/svg">');
    var desc = r.good.length
      ? 'Wi-Fi: ' + r.good.map(function (a) { return a.label + ' on ' + chText(a.span); }).join(', ') + '. Zigbee: ' +
        GRADES.map(function (g) {
          var ks = r.channels.filter(function (c) { return c.worst === g; }).map(function (c) { return c.k; });
          return GRADE_TEXT[g].toLowerCase() + ' ' + (ks.length ? ks.join(', ') : 'none');
        }).join('; ') + '.'
      : 'No Wi-Fi networks entered; Zigbee channels 11 to 26 are drawn on their own.';
    parts.push('<title id="zwc-svg-title">2.4 GHz spectrum, ' + fMin + ' to ' + fMax + ' MHz</title>');
    parts.push('<desc id="zwc-svg-desc">' + escapeHtml(desc) + '</desc>');
    parts.push('<defs><clipPath id="zwc-clip"><rect x="' + SVG.left + '" y="0" width="' + plotW + '" height="' + SVG.h + '"/></clipPath></defs>');

    // ISM band and dB grid
    parts.push('<rect class="zwc-s-band" x="' + fx(BAND_LOW).toFixed(1) + '" y="' + (SVG.top - 6) + '" width="' + (fx(BAND_HIGH) - fx(BAND_LOW)).toFixed(1) + '" height="' + (SVG.zBot - SVG.top + 10) + '"/>');
    [0, -20, -28, -40].forEach(function (db) {
      var y = yOf(db).toFixed(1);
      parts.push('<line class="zwc-s-grid' + (db === -28 ? ' zwc-s-grid--key' : '') + '" x1="' + SVG.left + '" x2="' + (SVG.w - SVG.right) + '" y1="' + y + '" y2="' + y + '"/>');
      parts.push('<text class="zwc-s-db" x="' + (SVG.left - 6) + '" y="' + (yOf(db) + 4).toFixed(1) + '">' + (db === 0 ? '0' : MINUS + (-db)) + '</text>');
    });
    parts.push('<text class="zwc-s-db zwc-s-db--unit" x="' + (SVG.left - 6) + '" y="' + (SVG.top - 14) + '">dBr</text>');

    // Wi-Fi masks
    var labelSlots = [];
    parts.push('<g clip-path="url(#zwc-clip)">');
    r.good.forEach(function (a) {
      var cls = a.own ? 'zwc-s-wifi zwc-s-wifi--own' : 'zwc-s-wifi zwc-s-wifi--nb';
      parts.push('<polygon class="' + cls + '" points="' + svgPolyPoints(a.span, fx, yOf) + '"><title>' + escapeHtml(a.label + ': channel ' + chText(a.span) + ', ' + a.span.low + '–' + a.span.high + ' MHz (' + MASKS[a.span.kind].label + ' mask)') + '</title></polygon>');
      parts.push('<line class="' + (a.own ? 'zwc-s-edge zwc-s-edge--own' : 'zwc-s-edge zwc-s-edge--nb') + '" x1="' + fx(a.span.low).toFixed(1) + '" x2="' + fx(a.span.high).toFixed(1) + '" y1="' + SVG.top + '" y2="' + SVG.top + '"/>');
    });
    parts.push('</g>');
    r.good.slice().sort(function (a, b) { return a.span.center - b.span.center; }).forEach(function (a) {
      var x = fx(a.span.center);
      var row = 0;
      while (labelSlots[row] !== undefined && x - labelSlots[row] < 64) row++;
      labelSlots[row] = x;
      var y = SVG.top - 10 - row * 14;
      if (y < 10) y = 10;
      parts.push('<text class="zwc-s-label ' + (a.own ? 'zwc-s-label--own' : 'zwc-s-label--nb') + '" x="' + x.toFixed(1) + '" y="' + y + '">' + escapeHtml('ch ' + chText(a.span)) + '</text>');
    });

    // Zigbee channels
    r.channels.forEach(function (c) {
      var x0 = fx(c.low);
      var x1 = fx(c.high);
      var cx = fx(c.center);
      parts.push('<line class="zwc-s-guide" x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + SVG.top + '" y2="' + SVG.zTop + '"/>');
      var extra = '';
      if (r.rec && c.k === r.rec.k) extra = ' zwc-s-zb--rec';
      parts.push('<rect class="zwc-s-zb zwc-s-zb--' + c.worst + extra + '" x="' + x0.toFixed(1) + '" y="' + SVG.zTop + '" width="' + (x1 - x0).toFixed(1) + '" height="' + (SVG.zBot - SVG.zTop) + '" rx="2"><title>' + escapeHtml('Zigbee ' + c.k + ' (' + c.center + ' MHz): ' + GRADE_TEXT[c.worst].toLowerCase()) + '</title></rect>');
      parts.push('<text class="zwc-s-zbnum' + (r.rec && c.k === r.rec.k ? ' zwc-s-zbnum--rec' : '') + '" x="' + cx.toFixed(1) + '" y="' + SVG.zNum + '">' + c.k + '</text>');
      var mark = '';
      if (r.rec && c.k === r.rec.k) mark = 'pick';
      else if (r.runnerUp && c.k === r.runnerUp.k) mark = '2nd';
      else if (c.isThread) mark = 'Thread';
      else if (c.isCurrent) mark = 'now';
      if (mark) parts.push('<text class="zwc-s-mark zwc-s-mark--' + (mark === 'pick' ? 'rec' : 'other') + '" x="' + cx.toFixed(1) + '" y="' + SVG.zMark + '">' + mark + '</text>');
    });
    parts.push('<text class="zwc-s-lane" x="' + (SVG.left - 6) + '" y="' + (SVG.zTop + 20) + '">ZB</text>');

    // Frequency axis and band edges
    parts.push('<line class="zwc-s-axis" x1="' + SVG.left + '" x2="' + (SVG.w - SVG.right) + '" y1="' + (SVG.axis - 16) + '" y2="' + (SVG.axis - 16) + '"/>');
    for (var f = 2400; f <= fMax; f += 10) {
      var x = fx(f).toFixed(1);
      parts.push('<line class="zwc-s-tick" x1="' + x + '" x2="' + x + '" y1="' + (SVG.axis - 16) + '" y2="' + (SVG.axis - 11) + '"/>');
      parts.push('<text class="zwc-s-freq" x="' + x + '" y="' + SVG.axis + '">' + f + '</text>');
    }
    [BAND_LOW, BAND_HIGH].forEach(function (f) {
      var x = fx(f).toFixed(1);
      parts.push('<line class="zwc-s-bandedge" x1="' + x + '" x2="' + x + '" y1="' + (SVG.top - 6) + '" y2="' + (SVG.axis - 16) + '"/>');
    });
    parts.push('<text class="zwc-s-freq zwc-s-freq--edge" x="' + (fx(BAND_HIGH) + 4).toFixed(1) + '" y="' + (SVG.zBot - 4) + '">2483.5</text>');
    parts.push('<text class="zwc-s-unit" x="' + (SVG.w - SVG.right) + '" y="' + (SVG.axis - 22) + '">MHz</text>');
    parts.push('</svg>');
    $('zwc-spectrum').innerHTML = parts.join('');
  }

  // ── Channel table ──────────────────────────────────────────────────────

  function notesFor(c, r) {
    var out = [];
    if (r.rec && c.k === r.rec.k) out.push('<span class="zwc-tag zwc-tag--rec">Pick</span>');
    if (r.runnerUp && c.k === r.runnerUp.k) out.push('<span class="zwc-tag">Runner-up</span>');
    if (r.thread === null && r.threadPick && c.k === r.threadPick.k) out.push('<span class="zwc-tag zwc-tag--thread">For Thread</span>');
    if (c.isCurrent) out.push('<span class="zwc-tag">Current</span>');
    if (c.isThread) out.push('<span class="zwc-tag zwc-tag--thread">Thread</span>');
    if (c.zll) out.push('<span class="zwc-tag zwc-tag--soft" title="Zigbee2MQTT recommends the ZLL channels 11, 15, 20 and 25">ZLL</span>');
    if (c.k === 26) out.push('<span class="zwc-tag zwc-tag--warn" title="Some Zigbee radios cannot use channel 26">Not all devices</span>');
    if (c.usPower) out.push('<span class="zwc-tag zwc-tag--warn" title="Silicon Labs: channels 25 and 26 require reduced transmit power to meet FCC requirements">US: lower power</span>');
    return out.join(' ');
  }

  function renderTable(r) {
    var head = '<thead><tr><th scope="col">Zigbee</th><th scope="col">Centre</th><th scope="col">Grade</th><th scope="col">Gap to nearest Wi-Fi edge</th><th scope="col">Nearest Wi-Fi</th><th scope="col">Wi-Fi mask at Zigbee edge</th><th scope="col">Notes</th></tr></thead>';
    var body = r.channels.map(function (c) {
      var g = c.nearest;
      var gapText = g ? fmtNum(g.gap) + ' MHz' + (g.gap < 0 ? ' (inside)' : '') : '—';
      var near = g ? escapeHtml(chText(g.ap.span) + ' · ' + g.ap.label) : '—';
      var mask = g ? fmtDb(g.maskDb) : '—';
      var cls = 'zwc-row zwc-row--' + c.worst + (r.rec && c.k === r.rec.k ? ' zwc-row--rec' : '');
      return '<tr class="' + cls + '">' +
        '<th scope="row" class="zwc-td-ch" data-label="Zigbee">' + c.k + '</th>' +
        '<td data-label="Centre">' + c.center + ' MHz</td>' +
        '<td data-label="Grade">' + badge(c.worst) + (c.count > 1 ? ' <span class="zwc-count">×' + c.count + '</span>' : '') + '</td>' +
        '<td data-label="Gap to edge" class="zwc-td-num">' + gapText + '</td>' +
        '<td data-label="Nearest Wi-Fi">' + near + '</td>' +
        '<td data-label="Mask at edge" class="zwc-td-num">' + mask + '</td>' +
        '<td data-label="Notes" class="zwc-td-notes">' + (notesFor(c, r) || '<span class="zwc-muted">—</span>') + '</td>' +
      '</tr>';
    }).join('');
    $('zwc-table').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('zwc-table-meta').textContent = r.good.length
      ? GRADES.map(function (g) { return r.channels.filter(function (c) { return c.worst === g; }).length + ' ' + GRADE_TEXT[g].toLowerCase(); }).join(' · ')
      : 'no Wi-Fi entered';
  }

  // ── Change instructions and notes ─────────────────────────────────────

  function renderChange(r) {
    var k = r.rec ? r.rec.k : (r.cur !== null ? r.cur : 25);
    $('zwc-z2m').textContent = z2mSnippet(k);
    $('zwc-z2m-ch').textContent = String(k);
    $('zwc-zha-ch').textContent = String(k);
    var t = r.thread !== null ? r.thread : (r.threadPick ? r.threadPick.k : 26);
    $('zwc-thread-ch').textContent = String(t);
  }

  function renderNotes(r) {
    $('zwc-note-us').classList.toggle('zwc-hidden', r.region !== 'us');
    var own40 = r.good.filter(function (a) { return a.own && a.span.kind === 'ht40'; });
    var tip = $('zwc-note-40');
    if (own40.length) {
      tip.classList.remove('zwc-hidden');
      $('zwc-note-40-aps').textContent = own40.map(function (a) { return a.label + ' (channel ' + chText(a.span) + ')'; }).join(', ');
    } else {
      tip.classList.add('zwc-hidden');
    }
    var reg = REGIONS[r.region];
    $('zwc-region-note').textContent = r.region === 'us'
      ? 'Wi-Fi channels 1–11 (2412–2462 MHz). HT40+ on primaries 1–7, HT40− on 5–11.'
      : (r.region === 'jp'
        ? 'Wi-Fi channels 1–13, plus 14 (2484 MHz) for 802.11b only. HT40+ on primaries 1–9, HT40− on 5–13.'
        : 'Wi-Fi channels 1–13 (2412–2472 MHz). Channel 13 overlaps Zigbee 25 and 26. HT40+ on primaries 1–9, HT40− on 5–13.');
    $('zwc-region-note').setAttribute('data-region', reg.short);
  }

  function writeForm() {
    var radios = document.querySelectorAll('input[name="zwc-region"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === state.region;
    var cur = $('zwc-cur');
    var thr = $('zwc-thread');
    [cur, thr].forEach(function (sel, idx) {
      var v = String(idx === 0 ? state.cur : state.thread);
      var html = option('', idx === 0 ? 'Not set' : 'No Thread network', v === '');
      for (var k = ZB_FIRST; k <= ZB_LAST; k++) html += option(String(k), k + ' · ' + zigbeeCenter(k) + ' MHz', v === String(k));
      if (v !== '' && zbChannelValue(v) === null) html += option(v, '"' + v + '" (invalid)', true);
      sel.innerHTML = html;
    });
    $('zwc-allow26').checked = !!state.allow26;
    renderApRows();
  }

  function writeHash() {
    var h = encodeHash(state);
    if (h === lastHash) return;
    lastHash = h;
    try { history.replaceState(null, '', h); } catch (e) { /* file:// or sandboxed frames */ }
  }

  function render() {
    var r = evaluate(state);
    lastResult = r;
    renderApMessages(r);
    renderRec(r);
    renderSpectrum(r);
    renderTable(r);
    renderChange(r);
    renderNotes(r);
    if (hashActive) writeHash();
    return r;
  }

  function changed() {
    hashActive = true;
    render();
  }

  function onStaticInput(e) {
    var t = e.target;
    if (!t) return;
    if (t.name === 'zwc-region') {
      state.region = REGIONS[t.value] ? t.value : 'eu';
    } else if (t.id === 'zwc-cur') {
      state.cur = t.value;
    } else if (t.id === 'zwc-thread') {
      state.thread = t.value;
    } else if (t.id === 'zwc-allow26') {
      state.allow26 = !!t.checked;
    } else {
      return;
    }
    changed();
  }

  function onApInput(e) {
    var t = e.target;
    var f = t && t.getAttribute && t.getAttribute('data-f');
    if (!f) return;
    var row = t.closest ? t.closest('.zwc-ap') : null;
    if (!row) return;
    var i = Number(row.getAttribute('data-i'));
    if (!state.aps[i]) return;
    if (f === 'name') state.aps[i].name = clip(t.value, MAX_NAME);
    else if (f === 'o') state.aps[i].o = t.value === 'own' ? 'own' : 'nb';
    else if (f === 'ch') state.aps[i].ch = t.value;
    else if (f === 'w') state.aps[i].w = t.value;
    if (f === 'o') {
      var nameInput = $('zwc-ap' + i + '-name');
      if (nameInput) nameInput.placeholder = apLabel(state.aps[i], i);
    }
    if (f === 'ch' || f === 'w') {
      // Drop the "(invalid)" option once a real value was picked
      var stale = t.querySelector('option[value="' + t.value + '"]') ? null : t;
      if (!stale) {
        var opts = t.querySelectorAll('option');
        for (var j = 0; j < opts.length; j++) {
          if (/\(invalid\)$/.test(opts[j].textContent) && opts[j].value !== t.value) t.removeChild(opts[j]);
        }
      }
    }
    changed();
  }

  function onApClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act="remove"]') : null;
    if (!btn) return;
    var row = btn.closest('.zwc-ap');
    var i = Number(row.getAttribute('data-i'));
    state.aps.splice(i, 1);
    renderApRows();
    changed();
    var next = $('zwc-ap' + Math.min(i, state.aps.length - 1) + '-name');
    if (next) next.focus(); else $('zwc-add').focus();
  }

  function addAp() {
    if (state.aps.length >= MAX_APS) {
      showToast('Up to ' + MAX_APS + ' access points', true);
      return;
    }
    var used = {};
    state.aps.forEach(function (a) { used[a.ch] = true; });
    var ap = emptyAp(state.aps.length === 0);
    ['1', '6', '11', '13', '3', '9'].some(function (ch) {
      if (!used[ch]) { ap.ch = ch; return true; }
      return false;
    });
    state.aps.push(ap);
    renderApRows();
    changed();
    var input = $('zwc-ap' + (state.aps.length - 1) + '-ch');
    if (input) input.focus();
  }

  function applyPreset(key) {
    var aps = presetAps(key);
    if (!aps) return;
    state.aps = aps;
    renderApRows();
    changed();
  }

  function onPresetClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-preset]') : null;
    if (btn) applyPreset(btn.getAttribute('data-preset'));
  }

  function copyLink() {
    hashActive = true;
    writeHash();
    copyText(location.href.split('#')[0] + encodeHash(state), 'Link copied');
  }

  function copySummary() {
    var r = lastResult || evaluate(state);
    copyText(buildSummary(r, location.href.split('#')[0] + encodeHash(state)), 'Summary copied');
  }

  function copyZ2m() {
    copyText($('zwc-z2m').textContent, 'Zigbee2MQTT snippet copied');
  }

  function resetAll() {
    state = defaultState();
    hashActive = true;
    writeForm();
    render();
    showToast('Example restored');
  }

  function init() {
    if (isStateHash(location.hash)) {
      state = decodeHash(location.hash);
      hashActive = true;
    }
    writeForm();
    var wrapper = $('zwc-wrapper');
    wrapper.addEventListener('change', onStaticInput);
    var list = $('zwc-aps');
    list.addEventListener('input', onApInput);
    list.addEventListener('change', onApInput);
    list.addEventListener('click', onApClick);
    $('zwc-presets').addEventListener('click', onPresetClick);
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
  window.zwcAddAp = addAp;
  window.zwcCopyLink = copyLink;
  window.zwcCopySummary = copySummary;
  window.zwcCopyZ2m = copyZ2m;
  window.zwcReset = resetAll;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ZB_FIRST: ZB_FIRST,
      ZB_LAST: ZB_LAST,
      ZLL_CHANNELS: ZLL_CHANNELS,
      MAX_APS: MAX_APS,
      MAX_NAME: MAX_NAME,
      REGIONS: REGIONS,
      MASKS: MASKS,
      PRESETS: PRESETS,
      zigbeeCenter: zigbeeCenter,
      wifiCenter: wifiCenter,
      wifiSpan: wifiSpan,
      maskLevel: maskLevel,
      gradeOffset: gradeOffset,
      regionChannels: regionChannels,
      ht40Primaries: ht40Primaries,
      validateAp: validateAp,
      evaluate: evaluate,
      rankZigbee: rankZigbee,
      rankThread: rankThread,
      reasonFor: reasonFor,
      chText: chText,
      fmtNum: fmtNum,
      z2mSnippet: z2mSnippet,
      buildSummary: buildSummary,
      presetAps: presetAps,
      defaultState: defaultState,
      encodeHash: encodeHash,
      decodeHash: decodeHash,
      isStateHash: isStateHash,
      escapeHtml: escapeHtml
    };
  }
})();
