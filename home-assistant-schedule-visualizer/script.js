/* Home Assistant Automation Schedule Visualizer — script.js
   Prefix: hav-
   Shows when Home Assistant's time, time_pattern and sun triggers fire and
   whether time, sun and trigger conditions let each run through. The rules
   are ported from the Home Assistant 2026.10.4 source:
     homeassistant/util/dt.py                   find_next_time_expression_time
     homeassistant/helpers/event.py             async_track_utc_time_change
     homeassistant/components/homeassistant/triggers/time.py and time_pattern.py
     homeassistant/components/sun/trigger.py and condition.py
     homeassistant/helpers/sun.py               get_observer_astral_event_next
     homeassistant/helpers/condition.py         the time condition
     homeassistant/helpers/config_validation.py cv.time, cv.time_period
   Sun times are a port of astral 2.2 (the version Home Assistant pins).
   YAML is read by a small parser that follows PyYAML's YAML 1.1 rules, the
   loader Home Assistant uses for files on disk. No dependencies and no
   network requests. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var HA_VERSION = '2026.10.4';
  var ASTRAL_VERSION = '2.2';
  var WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var GH = 'https://github.com/home-assistant/core/blob/' + HA_VERSION + '/homeassistant/';
  var SRC = {
    dt: GH + 'util/dt.py',
    event: GH + 'helpers/event.py',
    timeTrigger: GH + 'components/homeassistant/triggers/time.py',
    patternTrigger: GH + 'components/homeassistant/triggers/time_pattern.py',
    sunTrigger: GH + 'components/sun/trigger.py',
    sunCondition: GH + 'components/sun/condition.py',
    sunHelper: GH + 'helpers/sun.py',
    condition: GH + 'helpers/condition.py',
    cv: GH + 'helpers/config_validation.py',
    astral: 'https://github.com/sffjunkie/astral/blob/2.2/src/astral/sun.py',
    docsTime: 'https://www.home-assistant.io/triggers/time/',
    docsPattern: 'https://www.home-assistant.io/triggers/time_pattern/',
    docsSunrise: 'https://www.home-assistant.io/triggers/sun.sunrise/',
    docsTimeCond: 'https://www.home-assistant.io/conditions/time/',
    docsSunCond: 'https://www.home-assistant.io/conditions/sun/',
    docsTriggers: 'https://www.home-assistant.io/docs/automation/trigger/',
    docsBasic: 'https://www.home-assistant.io/docs/configuration/basic/',
    docsYaml: 'https://www.home-assistant.io/docs/configuration/yaml/'
  };

  // ── Small helpers ─────────────────────────────────────────

  function mod(a, b) { return ((a % b) + b) % b; }

  // Python's float/int modulo: the result takes the sign of the divisor
  function pyMod(a, b) {
    var r = a % b;
    if (r !== 0 && ((r < 0) !== (b < 0))) r += b;
    return r;
  }

  function has(o, k) { return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function repeat(s, n) { var out = ''; for (var i = 0; i < n; i++) out += s; return out; }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function code(s) { return '<span class="hav-code">' + escapeHtml(s) + '</span>'; }

  function link(url, text) { return '<a class="hav-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(text) + '</a>'; }

  // Python int(str): optional surrounding whitespace, sign, digits with single underscores
  function pyInt(s) {
    if (typeof s !== 'string') return NaN;
    var m = /^\s*([+-]?)(\d+(?:_\d+)*)\s*$/.exec(s);
    if (!m) return NaN;
    var v = parseInt(m[2].replace(/_/g, ''), 10);
    return m[1] === '-' ? -v : v;
  }

  // Python float(str) for finite decimal numbers (inf and nan are rejected on purpose)
  function pyFloat(s) {
    if (typeof s !== 'string') return NaN;
    var m = /^\s*([+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)\s*$/.exec(s);
    if (!m) return NaN;
    return parseFloat(s.trim().replace(/_/g, ''));
  }

  // ── Civil dates (proleptic Gregorian, days since 1970-01-01) ──

  function daysFromCivil(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400);
    var yoe = y - era * 400;
    var mp = (m + 9) % 12;
    var doy = Math.floor((153 * mp + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  function civilFromDays(z) {
    z += 719468;
    var era = Math.floor(z / 146097);
    var doe = z - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    var m = mp < 10 ? mp + 3 : mp - 9;
    return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m: m, d: d };
  }

  // Monday = 0, like Python's date.weekday(); 1970-01-01 was a Thursday
  function weekdayOfDays(days) { return mod(days + 3, 7); }

  // Wall-clock seconds (a naive datetime counted as if it were UTC) to its fields
  function wallParts(w) {
    var days = Math.floor(w / 86400);
    var sod = w - days * 86400;
    var c = civilFromDays(days);
    var si = Math.floor(sod);
    return { y: c.y, m: c.m, d: c.d, H: Math.floor(si / 3600), M: Math.floor(si / 60) % 60, S: si % 60, days: days, wd: weekdayOfDays(days), sod: sod };
  }

  // ── Time zones (IANA, through Intl) with Python zoneinfo semantics ──
  // A local time is a pair { w: wall seconds, f: fold }. Like zoneinfo,
  // fold 0 means "the offset in force before the transition" both inside a
  // repeated hour (first copy) and inside a skipped hour.

  var zoneCache = {};

  function getZone(name) {
    if (!name || typeof name !== 'string') return null;
    if (has(zoneCache, name)) return zoneCache[name];
    var fmt = null;
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: name, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
      });
    } catch (e) {
      zoneCache[name] = null;
      return null;
    }
    var z = { name: name, fmt: fmt, cache: new Map() };
    zoneCache[name] = z;
    return z;
  }

  // UTC offset in seconds at an instant (epoch seconds). Offsets change on
  // whole minutes in current tz data, so one lookup per minute is cached.
  function offsetAt(z, t) {
    var key = Math.floor(t / 60);
    var v = z.cache.get(key);
    if (v !== undefined) return v;
    if (z.cache.size > 400000) z.cache.clear();
    var base = key * 60;
    var parts = z.fmt.formatToParts(new Date(base * 1000));
    var f = {};
    for (var i = 0; i < parts.length; i++) f[parts[i].type] = parts[i].value;
    var wall = daysFromCivil(parseInt(f.year, 10), parseInt(f.month, 10), parseInt(f.day, 10)) * 86400 +
      (parseInt(f.hour, 10) % 24) * 3600 + parseInt(f.minute, 10) * 60 + parseInt(f.second, 10);
    v = wall - base;
    z.cache.set(key, v);
    return v;
  }

  // zoneinfo's utcoffset() for a wall time and fold
  function utcoffset(z, w, fold) {
    var oA = offsetAt(z, w - 86400);
    var oB = offsetAt(z, w + 86400);
    if (oA === oB) return oA;
    var vA = offsetAt(z, w - oA) === oA;
    var vB = offsetAt(z, w - oB) === oB;
    if (vA && vB) return fold ? oB : oA;   // repeated hour
    if (vA) return oA;
    if (vB) return oB;
    return fold ? oB : oA;                 // skipped hour
  }

  function toInstant(z, w, fold) { return w - utcoffset(z, w, fold); }

  // datetime.astimezone(tz) from a UTC instant (seconds, may be fractional)
  function fromInstant(z, t) {
    var w = t + offsetAt(z, t);
    var f = toInstant(z, w, 0) !== t ? 1 : 0;
    return { w: w, f: f };
  }

  // homeassistant/util/dt.py _datetime_exists and _datetime_ambiguous
  function dtExists(z, w, fold) { return fromInstant(z, toInstant(z, w, fold)).w === w; }

  function dtAmbiguous(z, w, fold) { return dtExists(z, w, fold) && utcoffset(z, w, fold) !== utcoffset(z, w, fold ? 0 : 1); }

  function offsetLabel(sec) {
    var s = sec < 0 ? '-' : '+';
    var a = Math.abs(sec);
    var h = Math.floor(a / 3600);
    var m = Math.floor((a % 3600) / 60);
    return 'UTC' + s + pad2(h) + ':' + pad2(m);
  }

  var abbrFmtCache = {};
  function zoneAbbr(zname, t) {
    try {
      var f = abbrFmtCache[zname];
      if (!f) {
        f = new Intl.DateTimeFormat('en-US', { timeZone: zname, timeZoneName: 'short', hour: 'numeric' });
        abbrFmtCache[zname] = f;
      }
      var parts = f.formatToParts(new Date(t * 1000));
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'timeZoneName') return parts[i].value;
    } catch (e) { /* ignore */ }
    return '';
  }

  // ── Port of homeassistant/util/dt.py time expression matching ──

  function parseTimeExpression(param, minV, maxV) {
    var res = [];
    var i;
    if (param === null || param === undefined || param === '*') {
      for (i = minV; i <= maxV; i++) res.push(i);
    } else if (typeof param === 'string') {
      if (param.charAt(0) === '/') {
        var step = pyInt(param.slice(1));
        if (isNaN(step)) throw new Error("invalid literal for int(): '" + param.slice(1) + "'");
        if (step === 0) throw new Error('range() arg 3 must not be zero');
        var start = minV + pyMod(-minV, step);
        if (step > 0) { for (i = start; i <= maxV; i += step) res.push(i); }
        else { for (i = start; i > maxV + 1; i += step) res.push(i); }
      } else {
        var v = pyInt(param);
        if (isNaN(v)) throw new Error("invalid literal for int(): '" + param + "'");
        res = [v];
      }
    } else if (Array.isArray(param)) {
      res = param.map(function (x) { return typeof x === 'string' ? pyInt(x) : Math.trunc(x); }).sort(function (a, b) { return a - b; });
    } else {
      res = [Math.trunc(param)];
    }
    for (i = 0; i < res.length; i++) {
      if (isNaN(res[i]) || res[i] < minV || res[i] > maxV) {
        throw new RangeError("Time expression '" + param + "': parameter " + res[i] + ' out of range (' + minV + ' to ' + maxV + ')');
      }
    }
    return res;
  }

  // First value in a sorted list that is >= cmp, or null
  function lowerBound(arr, cmp) {
    var lo = 0;
    var hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid] < cmp) lo = mid + 1; else hi = mid;
    }
    return lo === arr.length ? null : arr[lo];
  }

  function wSec(w) { return mod(w, 60); }
  function wMin(w) { return mod(Math.floor(w / 60), 60); }
  function wHour(w) { return mod(Math.floor(w / 3600), 24); }

  function dstOffsetDiff(z, w) { return utcoffset(z, w + 86400, 0) - utcoffset(z, w - 86400, 0); }

  // find_next_time_expression_time(now, seconds, minutes, hours).
  // `now` is { w, f }; returns { w, f }. Wall arithmetic mirrors Python's
  // naive datetime + timedelta, which also resets fold to 0.
  function findNextTimeExpression(z, now, seconds, minutes, hours) {
    if (!seconds.length || !minutes.length || !hours.length) {
      throw new Error('Cannot find a next time: Time expression never matches!');
    }
    var nowW = Math.floor(now.w);
    var nowF = now.f ? 1 : 0;
    for (;;) {
      var r = nowW;
      var ns = lowerBound(seconds, wSec(r));
      if (ns === null) { ns = seconds[0]; r += 60; }
      if (wSec(r) !== ns) r += ns - wSec(r);

      var nm = lowerBound(minutes, wMin(r));
      if (nm !== wMin(r)) r += seconds[0] - wSec(r);
      if (nm === null) { nm = minutes[0]; r += 3600; }
      if (wMin(r) !== nm) r += (nm - wMin(r)) * 60;

      var nh = lowerBound(hours, wHour(r));
      if (nh !== wHour(r)) r += (seconds[0] - wSec(r)) + (minutes[0] - wMin(r)) * 60;
      if (nh === null) { nh = hours[0]; r += 86400; }
      if (wHour(r) !== nh) r += (nh - wHour(r)) * 3600;

      if (!dtExists(z, r, 0)) {
        // Clocks went forward and this wall time does not exist. HA steps
        // `now` one second at a time until the match exists; every step up to
        // r gives the same r, so jumping straight to r + 1 s is equivalent.
        nowW = r + 1;
        nowF = 0;
        continue;
      }
      if (!dtAmbiguous(z, nowW, nowF)) return { w: r, f: 0 };
      if (dtAmbiguous(z, r, 0)) return { w: r, f: nowF };
      if (nowF === 0) {
        var check = findNextTimeExpression(z, { w: nowW + dstOffsetDiff(z, nowW), f: 0 }, seconds, minutes, hours);
        if (dtAmbiguous(z, check.w, check.f)) return { w: check.w, f: 1 };
      }
      return { w: r, f: 0 };
    }
  }

  // _TrackUTCTimeChange: the next fire instant (epoch seconds) at or after t
  function nextPatternInstant(z, lists, t) {
    var local = fromInstant(z, Math.floor(t));
    var r = findNextTimeExpression(z, local, lists.s, lists.m, lists.h);
    return toInstant(z, r.w, r.f);
  }

  // ── Port of astral 2.2 (astral/sun.py) ────────────────────
  // CPython's math.radians/degrees multiply by a precomputed constant.

  var DEG_TO_RAD = Math.PI / 180.0;
  var RAD_TO_DEG = 180.0 / Math.PI;
  function radians(x) { return x * DEG_TO_RAD; }
  function degrees(x) { return x * RAD_TO_DEG; }
  var sin = Math.sin;
  var cos = Math.cos;
  var tan = Math.tan;

  var SUN_APPARENT_RADIUS = 32.0 / (60.0 * 2.0);

  function julianday(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    var a = Math.floor(y / 100);
    var b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
  }

  function jdayToJcentury(jd) { return (jd - 2451545.0) / 36525.0; }
  function jcenturyToJday(jc) { return (jc * 36525.0) + 2451545.0; }

  function geomMeanLongSun(jc) {
    var l0 = 280.46646 + jc * (36000.76983 + 0.0003032 * jc);
    return pyMod(l0, 360.0);
  }

  function geomMeanAnomalySun(jc) { return 357.52911 + jc * (35999.05029 - 0.0001537 * jc); }

  function eccentricLocationEarthOrbit(jc) { return 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc); }

  function sunEqOfCenter(jc) {
    var m = geomMeanAnomalySun(jc);
    var mrad = radians(m);
    var sinm = sin(mrad);
    var sin2m = sin(mrad + mrad);
    var sin3m = sin(mrad + mrad + mrad);
    return sinm * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + sin2m * (0.019993 - 0.000101 * jc) + sin3m * 0.000289;
  }

  function sunTrueLong(jc) { return geomMeanLongSun(jc) + sunEqOfCenter(jc); }

  function sunApparentLong(jc) {
    var trueLong = sunTrueLong(jc);
    var omega = 125.04 - 1934.136 * jc;
    return trueLong - 0.00569 - 0.00478 * sin(radians(omega));
  }

  function meanObliquityOfEcliptic(jc) {
    var seconds = 21.448 - jc * (46.815 + jc * (0.00059 - jc * (0.001813)));
    return 23.0 + (26.0 + (seconds / 60.0)) / 60.0;
  }

  function obliquityCorrection(jc) {
    var e0 = meanObliquityOfEcliptic(jc);
    var omega = 125.04 - 1934.136 * jc;
    return e0 + 0.00256 * cos(radians(omega));
  }

  function sunDeclination(jc) {
    var e = obliquityCorrection(jc);
    var lambd = sunApparentLong(jc);
    var sint = sin(radians(e)) * sin(radians(lambd));
    return degrees(Math.asin(sint));
  }

  function varY(jc) {
    var epsilon = obliquityCorrection(jc);
    var y = tan(radians(epsilon) / 2.0);
    return y * y;
  }

  function eqOfTime(jc) {
    var l0 = geomMeanLongSun(jc);
    var e = eccentricLocationEarthOrbit(jc);
    var m = geomMeanAnomalySun(jc);
    var y = varY(jc);
    var sin2l0 = sin(2.0 * radians(l0));
    var sinm = sin(radians(m));
    var cos2l0 = cos(2.0 * radians(l0));
    var sin4l0 = sin(4.0 * radians(l0));
    var sin2m = sin(2.0 * radians(m));
    var Etime = y * sin2l0 - 2.0 * e * sinm + 4.0 * e * y * sinm * cos2l0 - 0.5 * y * y * sin4l0 - 1.25 * e * e * sin2m;
    return degrees(Etime) * 4.0;
  }

  // Returns the hour angle in radians, or NaN where Python raises
  // "math domain error" (the sun never reaches that zenith on the date)
  function hourAngle(latitude, declination, zenith, direction) {
    var latitudeRad = radians(latitude);
    var declinationRad = radians(declination);
    var zenithRad = radians(zenith);
    var h = (cos(zenithRad) - sin(latitudeRad) * sin(declinationRad)) / (cos(latitudeRad) * cos(declinationRad));
    if (h > 1 || h < -1 || isNaN(h)) return NaN;
    var HA = Math.acos(h);
    if (direction < 0) HA = -HA;
    return HA;
  }

  function adjustToHorizon(elevation) {
    if (elevation <= 0) return 0;
    var r = 6356900;
    return degrees(Math.acos(r / (r + elevation)));
  }

  function refractionAtZenith(zenith) {
    var elevation = 90 - zenith;
    if (elevation >= 85.0) return 0;
    var refractionCorrection = 0.0;
    var te = tan(radians(elevation));
    if (elevation > 5.0) {
      refractionCorrection = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / (te * te * te * te * te);
    } else if (elevation > -0.575) {
      var step1 = -12.79 + elevation * 0.711;
      var step2 = 103.4 + elevation * step1;
      var step3 = -518.2 + elevation * step2;
      refractionCorrection = 1735.0 + elevation * step3;
    } else {
      refractionCorrection = -20.774 / te;
    }
    return refractionCorrection / 3600.0;
  }

  // minutes_to_timedelta, in milliseconds (microsecond resolution, truncated like int())
  function minutesToMs(minutes) {
    var d = Math.trunc(minutes / 1440);
    minutes = minutes - (d * 1440);
    minutes = minutes * 60;
    var s = Math.trunc(minutes);
    var sfrac = minutes - s;
    var us = Math.trunc(sfrac * 1000000);
    return d * 86400000 + s * 1000 + us / 1000;
  }

  // time_of_transit(observer, date, zenith, direction) in epoch ms, NaN if never reached
  function timeOfTransit(obs, y, m, d, zenith, direction) {
    var latitude = obs.lat > 89.8 ? 89.8 : (obs.lat < -89.8 ? -89.8 : obs.lat);
    var adjustmentForElevation = obs.elev > 0.0 ? adjustToHorizon(obs.elev) : 0.0;
    var adjustmentForRefraction = refractionAtZenith(zenith + adjustmentForElevation);

    var jd = julianday(y, m, d);
    var t = jdayToJcentury(jd);
    var solarDec = sunDeclination(t);
    var hourangle = hourAngle(latitude, solarDec, zenith + adjustmentForElevation - adjustmentForRefraction, direction);
    if (isNaN(hourangle)) return NaN;
    var delta = -obs.lon - degrees(hourangle);
    var timeDiff = 4.0 * delta;
    var timeUTC = 720.0 + timeDiff - eqOfTime(t);

    t = jdayToJcentury(jcenturyToJday(t) + timeUTC / 1440.0);
    solarDec = sunDeclination(t);
    hourangle = hourAngle(latitude, solarDec, zenith + adjustmentForElevation + adjustmentForRefraction, direction);
    if (isNaN(hourangle)) return NaN;
    delta = -obs.lon - degrees(hourangle);
    timeDiff = 4.0 * delta;
    timeUTC = 720 + timeDiff - eqOfTime(t);

    return Date.UTC(y, m - 1, d) + minutesToMs(timeUTC);
  }

  // Which way a missing event fails: 'below' (the sun never climbs to that
  // elevation, polar night) or 'above' (it never sinks to it, midnight sun)
  function missingEventKind(obs, y, m, d, zenith) {
    var latitude = obs.lat > 89.8 ? 89.8 : (obs.lat < -89.8 ? -89.8 : obs.lat);
    var dec = sunDeclination(jdayToJcentury(julianday(y, m, d)));
    var h = (cos(radians(zenith)) - sin(radians(latitude)) * sin(radians(dec))) / (cos(radians(latitude)) * cos(radians(dec)));
    return h > 1 ? 'below' : 'above';
  }

  var SUN_KINDS = { sunrise: 1, sunset: 1, dawn: 1, dusk: 1 };

  function eventZenith(kind, depression) {
    return (kind === 'sunrise' || kind === 'sunset') ? 90.0 + SUN_APPARENT_RADIUS : 90.0 + depression;
  }

  function eventDirection(kind) { return (kind === 'sunrise' || kind === 'dawn') ? 1 : -1; }

  // astral.sun.sunrise/sunset/dawn/dusk(observer, date) in epoch ms (NaN = ValueError)
  function astralEvent(obs, kind, depression, y, m, d) {
    return timeOfTransit(obs, y, m, d, eventZenith(kind, depression), eventDirection(kind));
  }

  function astralEventCached(cache, obs, kind, depression, days) {
    var key = kind + ':' + depression + ':' + days;
    if (cache && cache.has(key)) return cache.get(key);
    var c = civilFromDays(days);
    var v = astralEvent(obs, kind, depression, c.y, c.m, c.d);
    if (cache) cache.set(key, v);
    return v;
  }

  // homeassistant/helpers/sun.py get_observer_astral_event_next: the first
  // event (+ offset) after utcMs, scanning local dates from yesterday on for
  // up to a year. Returns NaN when none is found. `missing` collects the local
  // day numbers that had no event.
  function sunEventNext(ctx, kind, depression, offsetMs, utcMs, missing) {
    var baseDays = wallParts(fromInstant(ctx.zone, utcMs / 1000).w).days;
    for (var k = -1; k < 367; k++) {
      var t = astralEventCached(ctx.sunCache, ctx.obs, kind, depression, baseDays + k);
      if (isNaN(t)) {
        if (missing) missing.push(baseDays + k);
        continue;
      }
      t += offsetMs;
      if (t > utcMs) return t;
    }
    return NaN;
  }

  // homeassistant/components/sun/condition.py sun()
  function sunConditionCheck(ctx, node, nowMs) {
    var today = wallParts(fromInstant(ctx.zone, nowMs / 1000).w).days;
    var before = node.before;
    var after = node.after;
    var beforeOffset = node.beforeOffset || 0;
    var afterOffset = node.afterOffset || 0;
    var sunrise = astralEventCached(ctx.sunCache, ctx.obs, 'sunrise', 0, today);
    var sunset = astralEventCached(ctx.sunCache, ctx.obs, 'sunset', 0, today);
    var hasSunrise = before === 'sunrise' || after === 'sunrise';
    var hasSunset = before === 'sunset' || after === 'sunset';
    var localDay = function (ms) { return wallParts(fromInstant(ctx.zone, ms / 1000).w).days; };

    if (!isNaN(sunrise) && today > localDay(sunrise) && hasSunrise) {
      sunrise = astralEventCached(ctx.sunCache, ctx.obs, 'sunrise', 0, today + 1);
    }
    if (!isNaN(sunset) && today > localDay(sunset) && hasSunset) {
      sunset = astralEventCached(ctx.sunCache, ctx.obs, 'sunset', 0, today + 1);
    }
    if (isNaN(sunrise) && hasSunrise) return { v: false, why: 'no sunrise today' };
    if (isNaN(sunset) && hasSunset) return { v: false, why: 'no sunset today' };

    var wb;
    var wa;
    if (before === 'sunrise' && after === 'sunset') {
      wb = sunrise + beforeOffset;
      wa = sunset + afterOffset;
      if (nowMs < wb || nowMs > wa) return { v: true, why: '' };
      return { v: false, why: 'between ' + fmtClock(ctx, wb) + ' and ' + fmtClock(ctx, wa) };
    }
    if (before === 'sunrise') {
      wb = sunrise + beforeOffset;
      if (nowMs > wb) return { v: false, why: 'after ' + fmtClock(ctx, wb) };
    }
    if (before === 'sunset') {
      wb = sunset + beforeOffset;
      if (nowMs > wb) return { v: false, why: 'after ' + fmtClock(ctx, wb) };
    }
    if (after === 'sunrise') {
      wa = sunrise + afterOffset;
      if (nowMs < wa) return { v: false, why: 'before ' + fmtClock(ctx, wa) };
    }
    if (after === 'sunset') {
      wa = sunset + afterOffset;
      if (nowMs < wa) return { v: false, why: 'before ' + fmtClock(ctx, wa) };
    }
    return { v: true, why: '' };
  }

  function fmtClock(ctx, ms) {
    var p = wallParts(fromInstant(ctx.zone, ms / 1000).w);
    return pad2(p.H) + ':' + pad2(p.M) + ':' + pad2(p.S);
  }

  // ── Home Assistant value validators ───────────────────────

  // cv.time / dt_util.parse_time: "HH:MM" or "HH:MM:SS" (extra parts ignored)
  function parseTimeHA(s) {
    if (typeof s !== 'string') return null;
    var parts = s.split(':');
    if (parts.length < 2) return null;
    var h = pyInt(parts[0]);
    var m = pyInt(parts[1]);
    var sec = parts.length > 2 ? pyInt(parts[2]) : 0;
    if (isNaN(h) || isNaN(m) || isNaN(sec)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 59) return null;
    return h * 3600 + m * 60 + sec;
  }

  function fmtSod(sec) {
    var s = Math.floor(sec);
    return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60);
  }

  // cv.time_period: "[-+]HH:MM[:SS.f]", a number of seconds, or a mapping
  // with days/hours/minutes/seconds/milliseconds. Returns { ms } or { error }.
  var PERIOD_KEYS = { days: 86400000, hours: 3600000, minutes: 60000, seconds: 1000, milliseconds: 1 };

  function timePeriod(v, kind) {
    if (kind === 'tag') return { notSim: true };
    if (typeof v === 'string') {
      var s = v;
      var neg = false;
      if (s.charAt(0) === '-') { neg = true; s = s.slice(1); } else if (s.charAt(0) === '+') { s = s.slice(1); }
      var parts = s.split(':');
      if (parts.length === 2 || parts.length === 3) {
        var h = pyInt(parts[0]);
        var mi = pyInt(parts[1]);
        var se = parts.length === 3 ? pyFloat(parts[2]) : 0;
        if (!isNaN(h) && !isNaN(mi) && !isNaN(se)) {
          var ms = Math.round(((h * 60 + mi) * 60 + se) * 1000000) / 1000;
          return { ms: neg ? -ms : ms, form: 'hms' };
        }
      }
      var f = pyFloat(v);
      if (!isNaN(f)) return { ms: Math.round(f * 1000000) / 1000, form: 'seconds' };
      return { error: 'offset format should be HH:MM, HH:MM:SS or HH:MM:SS.F' };
    }
    if (typeof v === 'number' && isFinite(v)) return { ms: Math.round(v * 1000000) / 1000, form: 'number' };
    if (typeof v === 'boolean') return { ms: v ? 1000 : 0, form: 'bool' };
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      var keys = Object.keys(v);
      if (!keys.length) return { error: 'must contain at least one of days, hours, minutes, seconds, milliseconds' };
      var total = 0;
      for (var i = 0; i < keys.length; i++) {
        if (!has(PERIOD_KEYS, keys[i])) return { error: "extra keys not allowed @ data['" + keys[i] + "']" };
        var x = v[keys[i]];
        var num = typeof x === 'number' ? x : (typeof x === 'string' ? pyFloat(x) : NaN);
        if (isNaN(num)) return { error: "expected float for '" + keys[i] + "'" };
        total += num * PERIOD_KEYS[keys[i]];
      }
      return { ms: Math.round(total * 1000) / 1000, form: 'map' };
    }
    return { error: 'offset format should be HH:MM, HH:MM:SS or HH:MM:SS.F' };
  }

  function fmtDuration(ms) {
    var neg = ms < 0;
    var a = Math.abs(ms);
    var totalSec = a / 1000;
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec - h * 3600 - m * 60;
    var sTxt = Math.abs(s - Math.round(s)) < 1e-9 ? pad2(Math.round(s)) : (s < 10 ? '0' : '') + s.toFixed(3).replace(/0+$/, '');
    return (neg ? '-' : '') + pad2(h) + ':' + pad2(m) + ':' + sTxt;
  }

  function humanDuration(ms) {
    var a = Math.abs(ms) / 1000;
    var parts = [];
    var d = Math.floor(a / 86400); a -= d * 86400;
    var h = Math.floor(a / 3600); a -= h * 3600;
    var m = Math.floor(a / 60); a -= m * 60;
    var s = Math.round(a * 1000) / 1000;
    if (d) parts.push(d + (d === 1 ? ' day' : ' days'));
    if (h) parts.push(h + (h === 1 ? ' hour' : ' hours'));
    if (m) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
    if (s) parts.push(s + (s === 1 ? ' second' : ' seconds'));
    return parts.length ? parts.join(' ') : '0 seconds';
  }

  // ── YAML: a strict subset parser with PyYAML (YAML 1.1) scalar rules ──
  // Home Assistant loads YAML files with PyYAML's SafeLoader (through
  // annotatedyaml), so plain scalars follow YAML 1.1: 19:45:00 is the
  // base-60 integer 71100, 010 is octal 8, and yes/no/on/off are booleans.
  // Supported: block mappings and sequences, flow [..] and {..}, plain,
  // single- and double-quoted and block (| >) scalars, comments and local
  // tags such as !secret or !input. Anchors, aliases, merge keys, complex
  // keys and multiple documents are refused with a message.

  var META = typeof Symbol === 'function' ? Symbol('havMeta') : '__havMeta';

  function Tagged(tag, value) { this.tag = tag; this.value = value; }

  function newMeta() { return { kind: {}, line: {}, raw: {}, note: {} }; }

  function setMeta(o, m) {
    try { Object.defineProperty(o, META, { value: m, enumerable: false, configurable: true }); } catch (e) { /* frozen */ }
  }

  function metaOf(o) { return (o && typeof o === 'object' && o[META]) || null; }

  var RE_NULL = /^(?:~|null|Null|NULL)$/;
  var RE_BOOL = /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
  var RE_INT = /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/;
  var RE_FLOAT = /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9_]+(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
  var RE_TS = /^(?:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]|[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?(?:[Tt]|[ \t]+)[0-9][0-9]?:[0-9][0-9]:[0-9][0-9](?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9][0-9]?(?::[0-9][0-9])?))?)$/;

  // PyYAML SafeConstructor.construct_yaml_int / construct_yaml_float
  function constructInt(raw) {
    var v = raw.replace(/_/g, '');
    var sign = 1;
    if (v.charAt(0) === '-') sign = -1;
    if (v.charAt(0) === '+' || v.charAt(0) === '-') v = v.slice(1);
    if (v === '0') return { v: 0, note: null };
    if (v.indexOf('0b') === 0) return { v: sign * parseInt(v.slice(2), 2), note: 'binary' };
    if (v.indexOf('0x') === 0) return { v: sign * parseInt(v.slice(2), 16), note: 'hex' };
    if (v.charAt(0) === '0') return { v: sign * parseInt(v, 8), note: 'octal' };
    if (v.indexOf(':') >= 0) {
      var digits = v.split(':').map(function (p) { return parseInt(p, 10); }).reverse();
      var base = 1;
      var total = 0;
      for (var i = 0; i < digits.length; i++) { total += digits[i] * base; base *= 60; }
      return { v: sign * total, note: 'sexagesimal' };
    }
    return { v: sign * parseInt(v, 10), note: null };
  }

  function constructFloat(raw) {
    var v = raw.replace(/_/g, '').toLowerCase();
    var sign = 1;
    if (v.charAt(0) === '-') sign = -1;
    if (v.charAt(0) === '+' || v.charAt(0) === '-') v = v.slice(1);
    if (v === '.inf') return { v: sign * Infinity, note: null };
    if (v === '.nan') return { v: NaN, note: null };
    if (v.indexOf(':') >= 0) {
      var digits = v.split(':').map(parseFloat).reverse();
      var base = 1;
      var total = 0;
      for (var i = 0; i < digits.length; i++) { total += digits[i] * base; base *= 60; }
      return { v: sign * total, note: 'sexagesimal' };
    }
    return { v: sign * parseFloat(v), note: null };
  }

  // Implicit resolution of a plain scalar (yaml.resolver.Resolver)
  function resolvePlain(raw) {
    if (raw === '' || RE_NULL.test(raw)) return { v: null, kind: 'null', raw: raw, note: null };
    if (RE_BOOL.test(raw)) {
      var low = raw.toLowerCase();
      var b = low === 'yes' || low === 'true' || low === 'on';
      return { v: b, kind: 'bool', raw: raw, note: (low === 'true' || low === 'false') ? null : 'yaml11bool' };
    }
    if (RE_INT.test(raw)) { var iv = constructInt(raw); return { v: iv.v, kind: 'int', raw: raw, note: iv.note }; }
    if (RE_FLOAT.test(raw)) { var fv = constructFloat(raw); return { v: fv.v, kind: 'float', raw: raw, note: fv.note }; }
    if (RE_TS.test(raw)) return { v: new Tagged('tag:yaml.org,2002:timestamp', raw), kind: 'tag', raw: raw, note: 'timestamp' };
    return { v: raw, kind: 'str', raw: raw, note: null };
  }

  var DQ_ESC = { '0': 0, 'a': 7, 'b': 8, 't': 9, 'n': 10, 'v': 11, 'f': 12, 'r': 13, 'e': 27, ' ': 32, '"': 34, '/': 47, 'N': 0x85, '_': 0xA0, 'L': 0x2028, 'P': 0x2029 };
  DQ_ESC[String.fromCharCode(92)] = 92;
  DQ_ESC[String.fromCharCode(9)] = 9;

  function YamlError(msg, line) {
    this.message = msg;
    this.line = line;
  }

  function unescapeDq(s, ln) {
    var BS = String.fromCharCode(92);
    if (s.indexOf(BS) < 0) return s;
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch !== BS) { out += ch; continue; }
      var e = s.charAt(i + 1);
      if (has(DQ_ESC, e)) { out += String.fromCharCode(DQ_ESC[e]); i++; continue; }
      var len = e === 'x' ? 2 : (e === 'u' ? 4 : (e === 'U' ? 8 : 0));
      if (len) {
        var hex = s.substr(i + 2, len);
        if (hex.length !== len || !/^[0-9a-fA-F]+$/.test(hex)) throw new YamlError('Invalid escape sequence in a double-quoted value', ln);
        out += String.fromCodePoint(parseInt(hex, 16));
        i += 1 + len;
        continue;
      }
      throw new YamlError('Unknown escape character "' + e + '" after a backslash in a double-quoted value', ln);
    }
    return out;
  }

  // Index of the closing quote of the quoted token starting at `start`, or -1
  function findQuoteEnd(s, start) {
    var q = s.charAt(start);
    var BS = String.fromCharCode(92);
    for (var i = start + 1; i < s.length; i++) {
      var ch = s.charAt(i);
      if (q === '"' && ch === BS) { i++; continue; }
      if (ch === q) {
        if (q === "'" && s.charAt(i + 1) === "'") { i++; continue; }
        return i;
      }
    }
    return -1;
  }

  // A complete quoted token (possibly spanning lines) to its value, with YAML line folding
  function decodeQuoted(tok, ln) {
    var q = tok.charAt(0);
    var body = tok.slice(1, -1);
    var BS = String.fromCharCode(92);
    var dec = function (seg) { return q === "'" ? seg.replace(/''/g, "'") : unescapeDq(seg, ln); };
    var segs = body.split('\n');
    if (segs.length === 1) return dec(body);
    var out = '';
    var breaks = 0;
    var glue = false;
    for (var k = 0; k < segs.length; k++) {
      var seg = segs[k];
      if (k > 0) seg = seg.replace(/^[ \t]+/, '');
      var escBreak = false;
      if (k < segs.length - 1) {
        var trail = /(\\*)$/.exec(seg.replace(/[ \t]+$/, ''));
        var nBs = trail ? trail[1].length : 0;
        if (q === '"' && nBs % 2 === 1 && seg.charAt(seg.length - 1) === BS) {
          escBreak = true;
          seg = seg.slice(0, -1);
        } else {
          seg = seg.replace(/[ \t]+$/, '');
        }
      }
      if (k > 0 && k < segs.length - 1 && seg === '' && !glue) { breaks++; continue; }
      if (k > 0) out += glue ? '' : (breaks ? repeat('\n', breaks) : ' ');
      breaks = 0;
      out += dec(seg);
      glue = escBreak;
    }
    return out;
  }

  function parseYaml(src) {
    var text = String(src === null || src === undefined ? '' : src).replace(/\r\n?/g, '\n');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var lines = text.split('\n');
    var n = lines.length;
    var pos = 0;
    var warnings = [];

    function fail(msg, ln) { throw new YamlError(msg, (ln === undefined ? pos : ln) + 1); }

    function indentOf(s) {
      var i = 0;
      while (i < s.length && s.charAt(i) === ' ') i++;
      if (s.charAt(i) === '\t' && s.slice(i).trim() !== '') fail('Tabs can not be used for indentation in YAML; use spaces');
      return i;
    }

    function isBlank(s) { var t = s.trim(); return t === '' || t.charAt(0) === '#'; }

    function isDocMarker(s) { return /^(?:---|\.\.\.)(?:[ \t]|$)/.test(s); }

    function isSeqEntry(content) { return content.charAt(0) === '-' && (content.length === 1 || content.charAt(1) === ' ' || content.charAt(1) === '\t'); }

    function skipBlank() { while (pos < n && isBlank(lines[pos]) && !isDocMarker(lines[pos])) pos++; }

    function spaces(k) { return repeat(' ', k); }

    // "key: rest" detection on one line; returns { key, rest } or null
    function splitKey(content) {
      var c0 = content.charAt(0);
      var i;
      if (c0 === '"' || c0 === "'") {
        var end = findQuoteEnd(content, 0);
        if (end < 0) return null;
        i = end + 1;
        while (content.charAt(i) === ' ') i++;
        if (content.charAt(i) !== ':') return null;
        var nx0 = content.charAt(i + 1);
        if (nx0 !== '' && nx0 !== ' ' && nx0 !== '\t') return null;
        return { key: decodeQuoted(content.slice(0, end + 1), pos), rest: content.slice(i + 1) };
      }
      if (c0 === '[' || c0 === '{' || c0 === '#' || isSeqEntry(content)) return null;
      for (i = 0; i < content.length; i++) {
        var ch = content.charAt(i);
        if (ch === '#' && i > 0 && (content.charAt(i - 1) === ' ' || content.charAt(i - 1) === '\t')) return null;
        if (ch === ':') {
          var nx = content.charAt(i + 1);
          if (nx === '' || nx === ' ' || nx === '\t') {
            var key = content.slice(0, i).replace(/[ \t]+$/, '');
            var k0 = key.charAt(0);
            if (k0 === '&' || k0 === '*') fail('YAML anchors and aliases (&name, *name) are not supported by this tool');
            if (k0 === '!') fail('Tags on keys are not supported by this tool');
            return { key: key, rest: content.slice(i + 1) };
          }
        }
      }
      return null;
    }

    function node(v, kind, raw, line, note) { return { v: v, kind: kind, raw: raw, line: line + 1, note: note || null }; }

    function parseNode(parentIndent) {
      skipBlank();
      if (pos >= n) return node(null, 'null', '', pos);
      var line = lines[pos];
      if (isDocMarker(line)) fail('Only one YAML document is supported: paste one automation, or a list of automations, without "---" separators');
      var ind = indentOf(line);
      var content = line.slice(ind);
      if (content.charAt(0) === '?' && (content.length === 1 || content.charAt(1) === ' ')) fail('Complex mapping keys ("? ") are not supported by this tool');
      if (isSeqEntry(content)) return parseSeq(ind);
      if (splitKey(content)) return parseMap(ind);
      return parseInline(content, parentIndent, false);
    }

    // The value on the lines below a "key:" or "-" with nothing after it
    function parseBelow(parentIndent, allowSameIndentSeq, ln) {
      skipBlank();
      if (pos >= n || isDocMarker(lines[pos])) return node(null, 'null', '', ln);
      var ind = indentOf(lines[pos]);
      if (ind > parentIndent) return parseNode(parentIndent);
      if (allowSameIndentSeq && ind === parentIndent && isSeqEntry(lines[pos].slice(ind))) return parseSeq(ind);
      return node(null, 'null', '', ln);
    }

    function parseMap(ind) {
      var obj = {};
      var meta = newMeta();
      var start = pos;
      for (;;) {
        skipBlank();
        if (pos >= n) break;
        var line = lines[pos];
        if (isDocMarker(line)) break;
        var li = indentOf(line);
        if (li < ind) break;
        var content = line.slice(li);
        if (li > ind) fail('Unexpected indentation: this line has ' + li + ' spaces, the keys around it have ' + ind);
        if (isSeqEntry(content)) fail('A list item ("- ") can not follow "key: value" lines at the same indentation; indent the list under its key');
        var k = splitKey(content);
        if (!k) {
          if (/^[^#]*:[^\s]/.test(content) && !/^["'[{]/.test(content)) fail('Expected "key: value" here; YAML needs a space after the colon');
          fail('Expected "key: value" here');
        }
        if (k.key === '<<') fail('YAML merge keys (<<) are not supported by this tool');
        if (has(obj, k.key)) warnings.push({ line: pos + 1, msg: 'Duplicate key "' + k.key + '": YAML keeps the last value, and Home Assistant logs a warning' });
        var keyLine = pos;
        var nd = parseInline(k.rest, ind, true);
        obj[k.key] = nd.v;
        meta.kind[k.key] = nd.kind;
        meta.line[k.key] = keyLine + 1;
        meta.raw[k.key] = nd.raw;
        meta.note[k.key] = nd.note;
      }
      setMeta(obj, meta);
      return node(obj, 'map', '', start);
    }

    function parseSeq(ind) {
      var arr = [];
      var meta = newMeta();
      var start = pos;
      for (;;) {
        skipBlank();
        if (pos >= n) break;
        var line = lines[pos];
        if (isDocMarker(line)) break;
        var li = indentOf(line);
        if (li < ind) break;
        var content = line.slice(li);
        if (li > ind) fail('Unexpected indentation: this line has ' + li + ' spaces, the list items around it have ' + ind);
        if (!isSeqEntry(content)) break;
        var after = content.slice(1);
        var sp = 0;
        while (after.charAt(sp) === ' ' || after.charAt(sp) === '\t') sp++;
        var rest = after.slice(sp);
        var itemLine = pos;
        var nd;
        if (rest === '' || rest.charAt(0) === '#') {
          pos++;
          skipBlank();
          if (pos < n && !isDocMarker(lines[pos]) && indentOf(lines[pos]) > li) nd = parseNode(li);
          else nd = node(null, 'null', '', itemLine);
        } else {
          lines[pos] = spaces(li + 1 + sp) + rest;
          nd = parseNode(li);
        }
        var idx = arr.length;
        meta.kind[idx] = nd.kind;
        meta.line[idx] = itemLine + 1;
        meta.raw[idx] = nd.raw;
        meta.note[idx] = nd.note;
        arr.push(nd.v);
      }
      setMeta(arr, meta);
      return node(arr, 'seq', '', start);
    }

    // A value that starts on the current line (the line is consumed)
    function parseInline(rest, parentIndent, allowSameIndentSeq) {
      var ln = pos;
      var s = rest.replace(/^[ \t]+/, '');
      if (s === '' || s.charAt(0) === '#') {
        pos++;
        return parseBelow(parentIndent, allowSameIndentSeq, ln);
      }
      var c0 = s.charAt(0);
      if (c0 === '&') fail('YAML anchors (&name) are not supported by this tool; paste the automation without anchors and aliases');
      if (c0 === '*' && s.charAt(1) === '/') fail('YAML reads a leading * as an alias, so ' + s.split(/\s/)[0] + ' must be quoted. Home Assistant\'s time pattern also uses "/5", not the cron-style "*/5": write "' + s.split(/\s/)[0].slice(1) + '"');
      if (c0 === '*') fail('YAML aliases (*name) are not supported by this tool. If you meant the text *, put it in quotes: "*"');
      var tag = null;
      if (c0 === '!') {
        var m = /^(!\S*)[ \t]*/.exec(s);
        tag = m[1];
        s = s.slice(m[0].length);
        if (s === '' || s.charAt(0) === '#') {
          pos++;
          var below = parseBelow(parentIndent, allowSameIndentSeq, ln);
          return node(new Tagged(tag, below.v), 'tag', tag, ln, 'tag');
        }
        c0 = s.charAt(0);
      }
      var r;
      if (c0 === '|' || c0 === '>') r = parseBlockScalar(s, parentIndent, ln);
      else if (c0 === '[' || c0 === '{') r = parseFlowAt(s, ln);
      else if (c0 === '"' || c0 === "'") r = parseQuotedAt(s, ln);
      else if (c0 === '%' || c0 === '@' || c0 === '`') fail('A plain value can not start with "' + c0 + '"; put the value in quotes');
      else if (c0 === '?' && (s.length === 1 || s.charAt(1) === ' ')) fail('Complex mapping keys ("? ") are not supported by this tool');
      else r = parsePlainAt(s, ln, parentIndent);
      if (tag) {
        if (tag === '!!str') return node(String(r.raw === undefined ? r.v : (r.kind === 'str' || r.kind === 'qstr' || r.kind === 'block' ? r.v : r.raw)), 'qstr', r.raw, ln);
        return node(new Tagged(tag, r.v), 'tag', tag + ' ' + (r.raw || ''), ln, 'tag');
      }
      return r;
    }

    function stripPlainComment(s) {
      for (var i = 1; i < s.length; i++) {
        if (s.charAt(i) === '#' && (s.charAt(i - 1) === ' ' || s.charAt(i - 1) === '\t')) return { text: s.slice(0, i), comment: true };
      }
      return { text: s, comment: false };
    }

    function parsePlainAt(s, ln, parentIndent) {
      var first = stripPlainComment(s);
      var text = first.text.replace(/[ \t]+$/, '');
      if (/:(?:[ \t]|$)/.test(text)) fail('A colon followed by a space is not allowed inside a plain value ("mapping values are not allowed here"); put the value in quotes');
      pos++;
      var pieces = [text];
      var stop = first.comment;
      while (!stop && pos < n) {
        var j = pos;
        while (j < n && lines[j].trim() === '') j++;
        if (j >= n || isDocMarker(lines[j])) break;
        var lj = lines[j];
        var li = indentOf(lj);
        var t = lj.trim();
        if (li <= parentIndent || t.charAt(0) === '#') break;
        var c = stripPlainComment(lj.slice(li));
        var piece = c.text.replace(/[ \t]+$/, '');
        if (/:(?:[ \t]|$)/.test(piece)) fail('A colon followed by a space is not allowed inside a plain value ("mapping values are not allowed here"); check the indentation or put the value in quotes', j);
        for (var e = pos; e < j; e++) pieces.push(null);
        pieces.push(piece);
        pos = j + 1;
        stop = c.comment;
      }
      if (pieces.length === 1) return Object.assign(resolvePlain(text), { line: ln + 1 });
      var out = pieces[0];
      var breaks = 0;
      for (var k = 1; k < pieces.length; k++) {
        if (pieces[k] === null) { breaks++; continue; }
        out += breaks ? repeat('\n', breaks) : ' ';
        out += pieces[k];
        breaks = 0;
      }
      return node(out, 'str', out, ln);
    }

    function parseQuotedAt(s, ln) {
      var buf = s;
      var end = findQuoteEnd(buf, 0);
      while (end < 0) {
        pos++;
        if (pos >= n) fail('This quoted value is never closed', ln);
        buf += '\n' + lines[pos];
        end = findQuoteEnd(buf, 0);
      }
      var tail = buf.slice(end + 1).trim();
      if (tail && tail.charAt(0) !== '#') fail('Unexpected text after the closing quote');
      pos++;
      var tok = buf.slice(0, end + 1);
      return node(decodeQuoted(tok, ln), 'qstr', tok, ln);
    }

    function parseBlockScalar(s, parentIndent, ln) {
      var m = /^([|>])([1-9]?)([+-]?)([1-9]?)[ \t]*(?:#.*)?$/.exec(s);
      if (!m || (m[2] && m[4])) fail('Unsupported block scalar header "' + s + '"');
      var style = m[1];
      var chomp = m[3];
      var explicit = m[2] || m[4];
      pos++;
      var contentIndent = explicit ? Math.max(parentIndent, 0) + parseInt(explicit, 10) : -1;
      var body = [];
      while (pos < n) {
        var line = lines[pos];
        if (line.trim() === '') { body.push(''); pos++; continue; }
        var li = 0;
        while (li < line.length && line.charAt(li) === ' ') li++;
        if (contentIndent < 0) {
          if (li <= parentIndent) break;
          contentIndent = li;
        }
        if (li < contentIndent) break;
        body.push(line.slice(contentIndent));
        pos++;
      }
      var trailing = 0;
      while (body.length && body[body.length - 1] === '') { body.pop(); trailing++; }
      var out;
      if (style === '|') {
        out = body.join('\n');
      } else {
        out = '';
        for (var i = 0; i < body.length; i++) {
          var L = body[i];
          if (i === 0) { out = L; continue; }
          var prev = body[i - 1];
          if (L === '') { out += '\n'; continue; }
          if (prev === '') { out += L; continue; }
          if (/^[ \t]/.test(L) || /^[ \t]/.test(prev)) out += '\n' + L; else out += ' ' + L;
        }
      }
      if (body.length) {
        if (chomp === '+') out += '\n' + repeat('\n', trailing);
        else if (chomp !== '-') out += '\n';
      } else if (chomp === '+') {
        out = repeat('\n', trailing);
      }
      return node(out, 'block', s, ln);
    }

    function parseFlowAt(s, ln) {
      var buf = '';
      var line = s;
      var depth = 0;
      var inQ = null;
      var prevSig = '[';
      for (;;) {
        for (var i = 0; i < line.length; i++) {
          var ch = line.charAt(i);
          if (inQ) {
            if (inQ === '"' && ch === String.fromCharCode(92)) { i++; continue; }
            if (ch === inQ) {
              if (inQ === "'" && line.charAt(i + 1) === "'") { i++; continue; }
              inQ = null;
              prevSig = 'q';
            }
            continue;
          }
          if ((ch === '"' || ch === "'") && '[{,:'.indexOf(prevSig) >= 0) { inQ = ch; continue; }
          if (ch === '#' && (i === 0 || line.charAt(i - 1) === ' ' || line.charAt(i - 1) === '\t')) { line = line.slice(0, i); break; }
          if (ch === ' ' || ch === '\t') continue;
          if (ch === '[' || ch === '{') depth++;
          else if (ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) {
              buf += line.slice(0, i + 1);
              var tail = line.slice(i + 1).trim();
              if (tail && tail.charAt(0) !== '#') fail('Unexpected text after the closing bracket');
              pos++;
              return parseFlowText(buf, ln);
            }
          }
          prevSig = ch;
        }
        buf += line + '\n';
        pos++;
        if (pos >= n) fail('This "' + s.charAt(0) + '" is never closed', ln);
        line = lines[pos];
        if (isDocMarker(line)) fail('This "' + s.charAt(0) + '" is never closed', ln);
      }
    }

    function parseFlowText(t, ln) {
      var i = 0;
      function ws() {
        while (i < t.length) {
          var c = t.charAt(i);
          if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
          if (c === '#' && (i === 0 || /\s/.test(t.charAt(i - 1)))) { while (i < t.length && t.charAt(i) !== '\n') i++; continue; }
          break;
        }
      }
      function plain(isKey) {
        var start = i;
        while (i < t.length) {
          var c = t.charAt(i);
          if (c === ',' || c === ']' || c === '}' || c === '[' || c === '{') break;
          if (c === ':' && (isKey || /[\s,\]}]/.test(t.charAt(i + 1) || ' '))) break;
          if (c === '#' && /\s/.test(t.charAt(i - 1))) break;
          i++;
        }
        return t.slice(start, i).replace(/\s+/g, ' ').trim();
      }
      function value(isKey) {
        ws();
        var c = t.charAt(i);
        var meta;
        var it;
        if (c === '[') {
          i++;
          var arr = [];
          meta = newMeta();
          ws();
          if (t.charAt(i) === ']') { i++; setMeta(arr, meta); return node(arr, 'seq', '', ln); }
          for (;;) {
            it = value(false);
            ws();
            if (t.charAt(i) === ':') fail('Mappings inside a flow list ([a: b]) are not supported by this tool', ln);
            meta.kind[arr.length] = it.kind;
            meta.line[arr.length] = ln + 1;
            meta.raw[arr.length] = it.raw;
            meta.note[arr.length] = it.note;
            arr.push(it.v);
            ws();
            c = t.charAt(i);
            if (c === ',') { i++; ws(); if (t.charAt(i) === ']') { i++; break; } continue; }
            if (c === ']') { i++; break; }
            fail('Expected "," or "]" in this flow list', ln);
          }
          setMeta(arr, meta);
          return node(arr, 'seq', '', ln);
        }
        if (c === '{') {
          i++;
          var obj = {};
          meta = newMeta();
          ws();
          if (t.charAt(i) === '}') { i++; setMeta(obj, meta); return node(obj, 'map', '', ln); }
          for (;;) {
            ws();
            var keyNode = value(true);
            var key = keyNode.kind === 'null' ? '' : String(keyNode.kind === 'str' || keyNode.kind === 'qstr' ? keyNode.v : keyNode.raw);
            ws();
            var vnode;
            if (t.charAt(i) === ':') { i++; vnode = value(false); } else { vnode = node(null, 'null', '', ln); }
            if (has(obj, key)) warnings.push({ line: ln + 1, msg: 'Duplicate key "' + key + '": YAML keeps the last value, and Home Assistant logs a warning' });
            obj[key] = vnode.v;
            meta.kind[key] = vnode.kind;
            meta.line[key] = ln + 1;
            meta.raw[key] = vnode.raw;
            meta.note[key] = vnode.note;
            ws();
            c = t.charAt(i);
            if (c === ',') { i++; ws(); if (t.charAt(i) === '}') { i++; break; } continue; }
            if (c === '}') { i++; break; }
            fail('Expected "," or "}" in this flow mapping', ln);
          }
          setMeta(obj, meta);
          return node(obj, 'map', '', ln);
        }
        if (c === '"' || c === "'") {
          var end = findQuoteEnd(t, i);
          if (end < 0) fail('This quoted value is never closed', ln);
          var tok = t.slice(i, end + 1);
          i = end + 1;
          return node(decodeQuoted(tok, ln), 'qstr', tok, ln);
        }
        if (c === '&' || c === '*') fail('YAML anchors and aliases (&name, *name) are not supported by this tool', ln);
        if (c === '!') {
          var m = /^!\S*/.exec(t.slice(i));
          var tag = m[0].replace(/[,\]}]+$/, '');
          i += tag.length;
          var inner = value(isKey);
          return node(new Tagged(tag, inner.v), 'tag', tag + ' ' + (inner.raw || ''), ln, 'tag');
        }
        var raw = plain(isKey);
        return Object.assign(resolvePlain(raw), { line: ln + 1 });
      }
      var r = value(false);
      ws();
      if (i < t.length) fail('Unexpected text after the flow value', ln);
      return r;
    }

    try {
      skipBlank();
      if (pos < n && /^---(?:[ \t]|$)/.test(lines[pos])) {
        var after = lines[pos].slice(3).trim();
        if (after && after.charAt(0) !== '#') lines[pos] = after; else pos++;
      }
      skipBlank();
      if (pos < n && /^%/.test(lines[pos])) fail('YAML directives (%YAML, %TAG) are not supported by this tool');
      if (pos >= n) return { root: node(null, 'null', '', 0), warnings: warnings, error: null };
      var root = parseNode(-1);
      skipBlank();
      if (pos < n && /^\.\.\.(?:[ \t]|$)/.test(lines[pos])) { pos++; skipBlank(); }
      if (pos < n) {
        if (isDocMarker(lines[pos])) fail('Only one YAML document is supported: paste one automation, or a list of automations, without "---" separators');
        fail('This line does not belong to the structure above; check its indentation');
      }
      return { root: root, warnings: warnings, error: null };
    } catch (e) {
      if (e instanceof YamlError) return { root: null, warnings: warnings, error: { message: e.message, line: e.line } };
      throw e;
    }
  }

  // ── Automation config, validated the way Home Assistant does ──

  var TRIGGER_BASE_KEYS = { alias: 1, platform: 1, id: 1, variables: 1, enabled: 1, note: 1 };
  var COND_BASE_KEYS = { alias: 1, note: 1, enabled: 1 };
  var NEW_SUN = { 'sun.sunrise': 'sunrise', 'sun.sunset': 'sunset', 'sun.dawn': 'dawn', 'sun.dusk': 'dusk' };
  var TWILIGHT = { civil: 6.0, nautical: 12.0, astronomical: 18.0 };
  var STATE_TRIGGERS = {
    state: 'fires when an entity changes state', numeric_state: 'fires when a number crosses a threshold',
    event: 'fires on an event', mqtt: 'fires on an MQTT message', template: 'fires when a template turns true',
    homeassistant: 'fires when Home Assistant starts or stops', webhook: 'fires on a webhook call', zone: 'fires on zone entry or exit',
    device: 'fires on a device event', tag: 'fires when a tag is scanned', calendar: 'fires on calendar events',
    conversation: 'fires on a voice sentence', geo_location: 'fires on geo-location events', persistent_notification: 'fires on notifications'
  };
  var STATE_CONDITIONS = {
    state: 'checks an entity state', numeric_state: 'checks a number', template: 'renders a template',
    zone: 'checks a person or device zone', device: 'checks a device'
  };

  function isMap(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Tagged); }

  function kindOfValue(v) {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return 'seq';
    if (v instanceof Tagged) return 'tag';
    if (typeof v === 'object') return 'map';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
    return 'str';
  }

  function fieldOf(obj, key) {
    var m = metaOf(obj);
    var v = obj[key];
    return {
      v: v,
      kind: (m && m.kind[key]) || kindOfValue(v),
      line: (m && m.line[key]) || 0,
      raw: m && m.raw[key] !== undefined ? m.raw[key] : '',
      note: (m && m.note[key]) || null
    };
  }

  // cv.ensure_list with the YAML metadata kept per item
  function itemsOf(f) {
    if (f.v === null || f.v === undefined) return [];
    if (!Array.isArray(f.v)) return [f];
    var out = [];
    for (var i = 0; i < f.v.length; i++) {
      var it = fieldOf(f.v, i);
      if (!it.line) it.line = f.line;
      out.push(it);
    }
    return out;
  }

  function isStrKind(k) { return k === 'str' || k === 'qstr' || k === 'block'; }

  function isTemplateText(s) { return typeof s === 'string' && /\{\{|\{%|\{#/.test(s); }

  // homeassistant.core.valid_entity_id
  function validEntityId(s) {
    // Same rule as HA's regex, written without look-behind for older Safari
    return typeof s === 'string' && !/__/.test(s) && /^[\da-z](?:[\da-z_]*[\da-z])?\.[\da-z](?:[\da-z_]*[\da-z])?$/.test(s);
  }

  // cv.boolean, or 'template' / 'invalid'
  function cvBoolean(f) {
    if (f.kind === 'tag') return 'template';
    if (typeof f.v === 'boolean') return f.v;
    if (typeof f.v === 'number') return f.v !== 0;
    if (typeof f.v === 'string') {
      var s = f.v.toLowerCase().trim();
      if (['1', 'true', 'yes', 'on', 'enable'].indexOf(s) >= 0) return true;
      if (['0', 'false', 'no', 'off', 'disable'].indexOf(s) >= 0) return false;
      if (isTemplateText(f.v)) return 'template';
    }
    return 'invalid';
  }

  function yamlNumberExplain(f) {
    if (f.note === 'sexagesimal') return 'Without quotes, YAML 1.1 (the rules Home Assistant uses for files on disk) reads ' + code(f.raw) + ' as the base-60 number ' + f.v + '.';
    if (f.note === 'octal') return 'Without quotes, YAML 1.1 reads ' + code(f.raw) + ' as the octal number ' + f.v + '.';
    return '';
  }

  // Locate the automations in a parsed document
  function findAutomations(root) {
    var v = root ? root.v : null;
    var out = { items: [], shape: '', error: '' };
    var looksLikeTrigger = function (o) {
      return isMap(o) && (typeof o.trigger === 'string' || typeof o.platform === 'string') &&
        !has(o, 'triggers') && !has(o, 'actions') && !has(o, 'action') && !has(o, 'conditions');
    };
    if (v === null || v === undefined) { out.error = 'empty'; return out; }
    if (isMap(v) && has(v, 'automation') && !has(v, 'triggers') && !has(v, 'trigger')) {
      var a = fieldOf(v, 'automation');
      if (a.kind === 'tag') {
        out.error = 'This is ' + code('automation: ' + a.raw) + ' from configuration.yaml. Paste the content of the included file (usually automations.yaml) instead.';
        return out;
      }
      v = a.v;
      out.shape = 'configuration';
    }
    if (Array.isArray(v)) {
      if (v.length && v.every(looksLikeTrigger)) {
        var wrap = { triggers: v };
        var wm = newMeta();
        wm.kind.triggers = 'seq';
        wm.line.triggers = (metaOf(v) && metaOf(v).line[0]) || 1;
        setMeta(wrap, wm);
        out.items.push({ obj: wrap, line: wm.line.triggers, label: 'Pasted triggers' });
        out.shape = 'triggers';
        return out;
      }
      var meta = metaOf(v);
      for (var i = 0; i < v.length; i++) {
        if (!isMap(v[i])) continue;
        var lab = typeof v[i].alias === 'string' && v[i].alias ? v[i].alias : (v[i].id !== undefined ? 'id ' + v[i].id : 'Automation ' + (i + 1));
        out.items.push({ obj: v[i], line: meta ? meta.line[i] : 0, label: lab });
      }
      if (!out.items.length) out.error = 'The list does not contain any automations (mappings with triggers).';
      out.shape = out.shape || 'list';
      return out;
    }
    if (isMap(v)) {
      if (looksLikeTrigger(v)) {
        var w2 = { triggers: [v] };
        var m2 = newMeta();
        m2.kind.triggers = 'seq';
        m2.line.triggers = 1;
        setMeta(w2, m2);
        var arr = w2.triggers;
        var am = newMeta();
        am.kind[0] = 'map';
        am.line[0] = 1;
        setMeta(arr, am);
        out.items.push({ obj: w2, line: 1, label: 'Pasted trigger' });
        out.shape = 'trigger';
        return out;
      }
      out.items.push({ obj: v, line: 1, label: typeof v.alias === 'string' && v.alias ? v.alias : 'Automation' });
      out.shape = out.shape || 'single';
      return out;
    }
    out.error = 'Paste an automation: a mapping with ' + code('triggers:') + ' (or the older ' + code('trigger:') + '), a list of automations, or a list of triggers.';
    return out;
  }

  function analyzeAutomation(obj) {
    var model = {
      alias: typeof obj.alias === 'string' ? obj.alias : '',
      triggers: [], conditions: [], errors: [], warnings: [], info: [], notSim: [],
      oldKeys: [], hasActions: false, triggerCount: 0
    };
    var err = function (msg, line) { model.errors.push({ msg: msg, line: line || 0 }); };
    var warn = function (msg, line) { model.warnings.push({ msg: msg, line: line || 0 }); };

    // automation/config.py _backward_compat_schema: cv.renamed(trigger -> triggers) etc.
    var pairs = [['trigger', 'triggers'], ['condition', 'conditions'], ['action', 'actions']];
    var keyOf = {};
    pairs.forEach(function (p) {
      if (has(obj, p[0]) && has(obj, p[1])) {
        err("Cannot specify both '" + p[0] + "' and '" + p[1] + "'. Please use '" + p[1] + "' only.", fieldOf(obj, p[0]).line);
        keyOf[p[1]] = p[1];
      } else if (has(obj, p[0])) {
        keyOf[p[1]] = p[0];
        model.oldKeys.push(p[0]);
      } else if (has(obj, p[1])) {
        keyOf[p[1]] = p[1];
      }
    });
    model.hasActions = !!keyOf.actions;
    if (!keyOf.triggers) {
      err("required key not provided @ data['triggers']: an automation needs at least the triggers key", 1);
      return model;
    }
    var tf = fieldOf(obj, keyOf.triggers);
    if (tf.kind === 'tag') {
      model.notSim.push({ what: 'Triggers', why: 'they come from ' + code(tf.raw) + ' (a blueprint input or an include), which only Home Assistant can resolve', line: tf.line });
      return model;
    }

    // cv.TRIGGER_SCHEMA: ensure_list, then flatten {triggers: [...]} items one level
    var flat = [];
    itemsOf(tf).forEach(function (it) {
      if (isMap(it.v) && has(it.v, 'triggers') && Object.keys(it.v).length === 1) {
        var inner = fieldOf(it.v, 'triggers');
        if (inner.kind === 'tag') {
          flat.push({ v: inner.v, kind: 'tag', line: inner.line, raw: inner.raw, note: 'tag' });
        } else {
          itemsOf(inner).forEach(function (x) { flat.push(x); });
        }
      } else {
        flat.push(it);
      }
    });
    model.triggerCount = flat.length;
    flat.forEach(function (it, idx) { analyzeTrigger(model, it, idx, err, warn); });

    if (keyOf.conditions) {
      var cf = fieldOf(obj, keyOf.conditions);
      var list = itemsOf(cf);
      if (cf.kind === 'tag') list = [cf];
      model.conditions = list.map(function (c, i) { return analyzeCondition(model, c, String(i + 1), err, warn); });
    }
    if (!model.hasActions) model.info.push({ msg: 'There is no ' + code('actions:') + ' key. Home Assistant requires one (it may be an empty list); the schedule below is simulated anyway.', line: 0 });
    return model;
  }

  function triggerLabel(t) {
    var n = '#' + (t.idx + 1);
    if (t.alias) return n + ' ' + t.alias;
    if (t.type === 'time') return n + ' time ' + t.times.map(function (x) { return fmtSod(x.sec); }).concat(t.timesNotSim.map(function (x) { return x; })).join(', ');
    if (t.type === 'pattern') return n + ' time_pattern ' + patternText(t);
    if (t.type === 'sun') return n + ' ' + sunText(t);
    return n + ' ' + (t.platform || 'trigger');
  }

  function patternText(t) {
    var parts = [];
    ['hours', 'minutes', 'seconds'].forEach(function (k) {
      if (t.given[k] !== undefined) parts.push(k + ' ' + t.given[k]);
    });
    return parts.join(', ');
  }

  function sunText(t) {
    var ev = t.event === 'dawn' || t.event === 'dusk' ? t.twilight + ' ' + t.event : t.event;
    if (!t.offsetMs) return ev;
    return ev + ' ' + (t.offsetMs < 0 ? '- ' : '+ ') + humanDuration(t.offsetMs);
  }

  function checkExtraKeys(o, allowed, err, line) {
    var bad = Object.keys(o).filter(function (k) { return !has(allowed, k); });
    bad.forEach(function (k) { err("extra keys not allowed @ data['" + k + "']", fieldOf(o, k).line || line); });
    return bad.length === 0;
  }

  function analyzeTrigger(model, it, idx, err, warn) {
    var line = it.line;
    var base = { idx: idx, id: String(idx), alias: '', line: line, sim: false, type: '', platform: '' };
    if (it.kind === 'tag') {
      model.notSim.push({ what: 'Trigger #' + (idx + 1), why: 'it comes from ' + code(it.raw) + ', which only Home Assistant can resolve', line: line });
      return;
    }
    if (!isMap(it.v)) { err('Trigger #' + (idx + 1) + ': expected a dictionary (a "key: value" block)', line); return; }
    var conf = it.v;
    // cv._trigger_pre_validator: `trigger` is renamed to `platform`
    var key = null;
    if (has(conf, 'trigger')) {
      if (has(conf, 'platform')) { err("Trigger #" + (idx + 1) + ": Cannot specify both 'platform' and 'trigger'. Please use 'trigger' only.", line); return; }
      key = 'trigger';
    } else if (has(conf, 'platform')) {
      key = 'platform';
      base.syntax = 'platform';
      model.platformKeys = (model.platformKeys || 0) + 1;
    } else {
      err("Trigger #" + (idx + 1) + ": required key not provided @ data['trigger']", line);
      return;
    }
    var pf = fieldOf(conf, key);
    if (!isStrKind(pf.kind)) {
      if (pf.kind === 'tag') { model.notSim.push({ what: 'Trigger #' + (idx + 1), why: 'its type comes from ' + code(pf.raw), line: line }); return; }
      err('Trigger #' + (idx + 1) + ': expected str for ' + key, pf.line);
      return;
    }
    var platform = pf.v;
    base.platform = platform;
    // Copy the config under the platform name, the way HA sees it
    var c = {};
    var cm = newMeta();
    var srcMeta = metaOf(conf) || newMeta();
    Object.keys(conf).forEach(function (k) {
      var nk = k === 'trigger' ? 'platform' : k;
      c[nk] = conf[k];
      cm.kind[nk] = srcMeta.kind[k]; cm.line[nk] = srcMeta.line[k]; cm.raw[nk] = srcMeta.raw[k]; cm.note[nk] = srcMeta.note[k];
    });
    setMeta(c, cm);

    if (has(c, 'id')) {
      var idf = fieldOf(c, 'id');
      if (!isStrKind(idf.kind)) {
        if (idf.kind === 'tag') model.info.push({ msg: 'Trigger #' + (idx + 1) + ' takes its id from ' + code(idf.raw) + '; trigger conditions that check it are not simulated.', line: idf.line });
        else err('Trigger #' + (idx + 1) + ": expected str for dictionary value @ data['id']" + (typeof idf.v === 'number' ? ' (put the id in quotes: id: "' + idf.raw + '")' : ''), idf.line);
      } else {
        base.id = idf.v;
      }
    }
    if (has(c, 'alias') && typeof c.alias === 'string') base.alias = c.alias;
    if (has(c, 'enabled')) {
      var en = cvBoolean(fieldOf(c, 'enabled'));
      if (en === 'invalid') { err('Trigger #' + (idx + 1) + ': invalid boolean value for enabled', fieldOf(c, 'enabled').line); return; }
      if (en === 'template') { model.notSim.push({ what: 'Trigger #' + (idx + 1) + ' (' + platform + ')', why: 'its ' + code('enabled') + ' value is a template or blueprint input, evaluated when Home Assistant sets the trigger up', line: line }); return; }
      if (en === false) { model.info.push({ msg: 'Trigger #' + (idx + 1) + ' (' + escapeHtml(platform) + ') has ' + code('enabled: false') + ', so Home Assistant does not set it up.', line: line }); return; }
    }

    // helpers/automation.py move_options_fields_to_top_level for old-style platforms
    if ((platform === 'time' || platform === 'time_pattern') && isMap(c.options)) {
      var others = Object.keys(c).filter(function (k) { return k !== 'options'; });
      if (others.every(function (k) { return has(TRIGGER_BASE_KEYS, k); })) {
        var opts = c.options;
        Object.keys(opts).forEach(function (k) {
          var f = fieldOf(opts, k);
          c[k] = opts[k];
          cm.kind[k] = f.kind; cm.line[k] = f.line; cm.raw[k] = f.raw; cm.note[k] = f.note;
        });
        delete c.options;
      }
    }

    var t = Object.assign(base, {});
    if (platform === 'time') {
      if (analyzeTimeTrigger(model, c, t, err, warn)) { t.sim = true; model.triggers.push(t); }
      return;
    }
    if (platform === 'time_pattern') {
      if (analyzePatternTrigger(model, c, t, err, warn)) { t.sim = true; model.triggers.push(t); }
      return;
    }
    if (platform === 'sun') {
      if (analyzeLegacySun(model, c, t, err, warn)) { t.sim = true; model.triggers.push(t); }
      return;
    }
    if (has(NEW_SUN, platform)) {
      if (analyzeNewSun(model, c, t, err, warn)) { t.sim = true; model.triggers.push(t); }
      return;
    }
    if (platform.indexOf('sun.') === 0) {
      model.notSim.push({ what: 'Trigger #' + (idx + 1) + ' (' + platform + ')', why: 'this tool simulates sun.sunrise, sun.sunset, sun.dawn, sun.dusk and the older sun trigger only', line: line });
      return;
    }
    var why = has(STATE_TRIGGERS, platform) ? 'it ' + STATE_TRIGGERS[platform] + ', not on a clock schedule' : 'it is not a time-based trigger this tool can simulate';
    model.notSim.push({ what: 'Trigger #' + (idx + 1) + ' (' + platform + ')', why: why, line: line });
  }

  function analyzeTimeTrigger(model, c, t, err, warn) {
    var allowed = Object.assign({ at: 1, weekday: 1 }, TRIGGER_BASE_KEYS);
    var name = 'Trigger #' + (t.idx + 1) + ' (time)';
    if (!checkExtraKeys(c, allowed, function (m, l) { err(name + ': ' + m, l); }, t.line)) return false;
    if (!has(c, 'at')) { err(name + ": required key not provided @ data['at']", t.line); return false; }
    t.type = 'time';
    t.times = [];
    t.timesNotSim = [];
    var ok = true;
    var af = fieldOf(c, 'at');
    var ats = af.kind === 'tag' ? [af] : itemsOf(af);
    if (!ats.length) model.info.push({ msg: name + ' has an empty ' + code('at') + ' list, so it never fires.', line: af.line });
    ats.forEach(function (a) {
      if (a.kind === 'tag') {
        t.timesNotSim.push(a.raw);
        model.notSim.push({ what: name + ' at ' + code(a.raw), why: 'the time comes from a blueprint input or secret that only Home Assistant can resolve', line: a.line });
        return;
      }
      if (isMap(a.v)) {
        if (has(a.v, 'entity_id')) {
          t.timesNotSim.push(String(a.v.entity_id));
          model.notSim.push({ what: name + ' at ' + code(String(a.v.entity_id)) + ' with an offset', why: 'the time comes from that entity\'s state', line: a.line });
        } else {
          err(name + ": expected an entity_id and an offset in the 'at' mapping", a.line);
          ok = false;
        }
        return;
      }
      if (isStrKind(a.kind)) {
        var sec = parseTimeHA(a.v);
        if (sec !== null) {
          t.times.push({ sec: sec, raw: a.v, line: a.line, noSeconds: a.v.split(':').length === 2 });
          return;
        }
        if (isTemplateText(a.v)) {
          t.timesNotSim.push(a.v);
          model.notSim.push({ what: name + ' at ' + code(a.v), why: 'it is a limited template that Home Assistant renders when it sets the trigger up', line: a.line });
          return;
        }
        if (validEntityId(a.v) && /^(input_datetime|sensor)\./.test(a.v)) {
          t.timesNotSim.push(a.v);
          model.notSim.push({ what: name + ' at ' + code(a.v), why: 'the time comes from that helper\'s or sensor\'s state', line: a.line });
          return;
        }
        var hint = '';
        if (/^\s*24:/.test(a.v)) hint = ' Hours run from 00 to 23; use "00:00:00" for midnight.';
        else if (/\./.test(a.v) && /:/.test(a.v)) hint = ' Seconds must be a whole number.';
        else if (validEntityId(a.v)) hint = ' Only input_datetime and sensor entities can be used here.';
        err(name + ': ' + code(a.v) + " is not valid for 'at'. Home Assistant expects HH:MM, HH:MM:SS, an Entity ID with domain 'input_datetime' or 'sensor', a combination of a timestamp sensor entity and an offset, or Limited Template." + hint, a.line);
        ok = false;
        return;
      }
      if (a.kind === 'int' || a.kind === 'float') {
        err(name + ': ' + (yamlNumberExplain(a) || code(a.raw) + ' is a number.') + ' Home Assistant then rejects it as a time. Put the time in quotes: at: "' + a.raw + '".', a.line);
        ok = false;
        return;
      }
      err(name + ': ' + code(String(a.raw || a.v)) + " is not a valid value for 'at'.", a.line);
      ok = false;
    });
    if (has(c, 'weekday')) {
      var wf = fieldOf(c, 'weekday');
      var wd = parseWeekdays(wf, function (m) { err(name + ': ' + m, wf.line); });
      if (wd === 'tag') {
        model.notSim.push({ what: name + ' weekday filter', why: 'it comes from ' + code(wf.raw), line: wf.line });
        ok = false;
      } else if (wd === null) {
        ok = false;
      } else {
        t.weekday = wd;
        if (!wd.length) model.info.push({ msg: name + ' has an empty ' + code('weekday') + ' list, so it never fires.', line: wf.line });
      }
    }
    return ok && (t.times.length > 0 || t.timesNotSim.length === 0);
  }

  // weekday: one of mon..sun or a list of them; returns indexes, null (error) or 'tag'
  function parseWeekdays(f, onErr) {
    if (f.kind === 'tag') return 'tag';
    var items = itemsOf(f);
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var k = typeof it.v === 'string' ? WEEKDAYS.indexOf(it.v) : -1;
      if (k < 0) {
        onErr('value must be one of mon, tue, wed, thu, fri, sat, sun, got ' + code(String(it.raw || it.v)) + (typeof it.v === 'string' && WEEKDAYS.indexOf(it.v.toLowerCase().slice(0, 3)) >= 0 ? ' (use the lower-case three-letter name)' : ''));
        return null;
      }
      if (out.indexOf(k) < 0) out.push(k);
    }
    return out;
  }

  // time_pattern.py TimePattern validator
  function timePatternValue(f, maximum) {
    var v = f.v;
    if (v === '*') return { v: '*' };
    if (typeof v === 'string' && v.charAt(0) === '/') {
      var num = pyInt(v.slice(1));
      if (isNaN(num)) return { error: 'invalid time_pattern value' };
      if (num === 0) return { error: 'must be a value between 1 and ' + maximum };
      if (!(num >= 0 && num <= maximum)) return { error: 'must be a value between 0 and ' + maximum };
      return { v: v };
    }
    var n;
    var note = '';
    if (typeof v === 'string') n = pyInt(v);
    else if (typeof v === 'number') { n = Math.trunc(v); if (n !== v) note = 'Home Assistant runs int() on ' + code(String(f.raw)) + ' and uses ' + n + '.'; }
    else if (typeof v === 'boolean') { n = v ? 1 : 0; note = 'YAML 1.1 reads ' + code(String(f.raw)) + ' as a boolean, which int() turns into ' + n + '.'; }
    else if (Array.isArray(v)) return { error: 'a list is not accepted: time_pattern takes one value per unit (a number, "*" or "/n")' };
    else return { error: 'invalid time_pattern value' };
    if (isNaN(n)) return { error: 'invalid time_pattern value' + (typeof v === 'string' && /^\s*\*\s*\/\s*\d+/.test(v) ? ' (Home Assistant uses "/5", not the cron-style "*/5")' : '') };
    if (!(n >= 0 && n <= maximum)) return { error: 'must be a value between 0 and ' + maximum };
    return { v: n, note: note };
  }

  function analyzePatternTrigger(model, c, t, err, warn) {
    var allowed = Object.assign({ hours: 1, minutes: 1, seconds: 1 }, TRIGGER_BASE_KEYS);
    var name = 'Trigger #' + (t.idx + 1) + ' (time_pattern)';
    if (!checkExtraKeys(c, allowed, function (m, l) { err(name + ': ' + m, l); }, t.line)) return false;
    if (!has(c, 'hours') && !has(c, 'minutes') && !has(c, 'seconds')) {
      err(name + ': must contain at least one of hours, minutes, seconds.', t.line);
      return false;
    }
    t.type = 'pattern';
    t.given = {};
    var vals = {};
    var ok = true;
    [['hours', 23], ['minutes', 59], ['seconds', 59]].forEach(function (u) {
      if (!has(c, u[0])) return;
      var f = fieldOf(c, u[0]);
      if (f.kind === 'tag') {
        model.notSim.push({ what: name + ' ' + u[0], why: 'it comes from ' + code(f.raw), line: f.line });
        ok = false;
        return;
      }
      var r = timePatternValue(f, u[1]);
      if (r.error) {
        err(name + ': ' + u[0] + ' ' + code(String(f.raw === '' ? f.v : f.raw)) + ': ' + r.error, f.line);
        ok = false;
        return;
      }
      if (r.note) model.warnings.push({ msg: name + ': ' + r.note, line: f.line });
      if (f.note === 'octal') model.warnings.push({ msg: name + ': ' + yamlNumberExplain(f) + ' Write ' + code(u[0] + ': "' + f.raw.replace(/^0+(?=\d)/, '') + '"') + ' if you meant decimal.', line: f.line });
      vals[u[0]] = r.v;
      t.given[u[0]] = typeof r.v === 'string' ? '"' + r.v + '"' : String(r.v);
    });
    if (!ok) return false;
    // "If larger units are specified, default the smaller units to zero"
    var h = vals.hours;
    var m = vals.minutes;
    var s = vals.seconds;
    t.defaulted = { minutes: false, seconds: false };
    if (m === undefined && h !== undefined) { m = 0; t.defaulted.minutes = true; }
    if (s === undefined && m !== undefined) { s = 0; t.defaulted.seconds = true; }
    t.eff = { hours: h, minutes: m, seconds: s };
    t.everySecond = [h, m, s].every(function (x) { return x === undefined || x === '*'; });
    try {
      t.lists = {
        h: parseTimeExpression(h === undefined ? null : h, 0, 23),
        m: parseTimeExpression(m === undefined ? null : m, 0, 59),
        s: parseTimeExpression(s === undefined ? null : s, 0, 59)
      };
    } catch (e) {
      err(name + ': ' + e.message, t.line);
      return false;
    }
    return true;
  }

  function offsetField(model, o, key, name, err) {
    if (!has(o, key)) return { ms: 0, given: false };
    var f = fieldOf(o, key);
    var r = timePeriod(f.v, f.kind);
    if (r.notSim) {
      model.notSim.push({ what: name + ' ' + key, why: 'it comes from ' + code(f.raw), line: f.line });
      return null;
    }
    if (r.error) { err(name + ': ' + key + ' ' + code(String(f.raw || '')) + ': ' + r.error, f.line); return null; }
    if (f.kind === 'int' && f.note === 'sexagesimal') {
      model.warnings.push({ msg: name + ': ' + yamlNumberExplain(f) + ' A number offset counts seconds, so this is ' + humanDuration(r.ms) + '.' +
        (f.raw.split(':').length === 2 ? ' In quotes, ' + code('"' + f.raw + '"') + ' would mean ' + humanDuration(timePeriod(f.raw, 'qstr').ms) + ' (HH:MM). Quote offsets to be sure.' : ' That happens to equal the same HH:MM:SS text in quotes, but quoting it is safer.'), line: f.line });
    }
    if (r.form === 'hms' && typeof f.v === 'string' && f.v.replace(/^[-+]/, '').split(':').length === 2) {
      model.info.push({ msg: name + ': ' + code(f.v) + ' is read as hours and minutes (HH:MM), so it is ' + humanDuration(r.ms) + '.', line: f.line });
    }
    return { ms: r.ms, given: true, line: f.line };
  }

  // sun/trigger.py LegacySunTrigger (trigger: sun, event, offset)
  function analyzeLegacySun(model, c, t, err, warn) {
    var name = 'Trigger #' + (t.idx + 1) + ' (sun)';
    var opts = c;
    var allowedTop = Object.assign({ options: 1, event: 1, offset: 1 }, TRIGGER_BASE_KEYS);
    if (has(c, 'options')) {
      allowedTop = Object.assign({ options: 1, target: 1 }, TRIGGER_BASE_KEYS);
      if (!isMap(c.options)) { err(name + ': options must be a dictionary', t.line); return false; }
      opts = c.options;
      if (!checkExtraKeys(opts, { event: 1, offset: 1 }, function (m, l) { err(name + ': options: ' + m, l); }, t.line)) return false;
    }
    if (!checkExtraKeys(c, allowedTop, function (m, l) { err(name + ': ' + m, l); }, t.line)) return false;
    if (!has(opts, 'event')) { err(name + ": required key not provided @ data['event']", t.line); return false; }
    var ef = fieldOf(opts, 'event');
    if (ef.kind === 'tag') { model.notSim.push({ what: name, why: 'its event comes from ' + code(ef.raw), line: ef.line }); return false; }
    var ev = String(ef.v).toLowerCase();
    if (ev !== 'sunrise' && ev !== 'sunset') { err(name + ': event must be sunrise or sunset, got ' + code(String(ef.raw || ef.v)), ef.line); return false; }
    var off = offsetField(model, opts, 'offset', name, err);
    if (!off) return false;
    t.type = 'sun';
    t.style = 'legacy';
    t.event = ev;
    t.depression = 0;
    t.twilight = '';
    t.offsetMs = off.ms;
    return true;
  }

  // sun/trigger.py SunEventTrigger subclasses (sun.sunrise etc. with options)
  function analyzeNewSun(model, c, t, err, warn) {
    var platform = c.platform;
    var event = NEW_SUN[platform];
    var name = 'Trigger #' + (t.idx + 1) + ' (' + platform + ')';
    if (!checkExtraKeys(c, Object.assign({ options: 1, target: 1 }, TRIGGER_BASE_KEYS), function (m, l) {
      err(name + ': ' + m + (/offset|type/.test(m) ? ' (put it under options:)' : ''), l);
    }, t.line)) return false;
    var opts = has(c, 'options') ? c.options : {};
    if (opts === null) opts = {};
    if (!isMap(opts)) { err(name + ': options must be a dictionary', t.line); return false; }
    var allowed = { offset: 1, offset_type: 1 };
    if (event === 'dawn' || event === 'dusk') allowed.type = 1;
    if (!checkExtraKeys(opts, allowed, function (m, l) { err(name + ': options: ' + m, l); }, t.line)) return false;
    var off = offsetField(model, opts, 'offset', name, err);
    if (!off) return false;
    var type = 'before';
    if (has(opts, 'offset_type')) {
      var of = fieldOf(opts, 'offset_type');
      if (of.v !== 'before' && of.v !== 'after') { err(name + ': offset_type must be before or after, got ' + code(String(of.raw || of.v)), of.line); return false; }
      type = of.v;
    }
    var tw = 'civil';
    if (has(opts, 'type')) {
      var tf = fieldOf(opts, 'type');
      if (!has(TWILIGHT, tf.v)) { err(name + ': type must be civil, nautical or astronomical, got ' + code(String(tf.raw || tf.v)), tf.line); return false; }
      tw = tf.v;
    }
    t.type = 'sun';
    t.style = 'new';
    t.event = event;
    t.twilight = (event === 'dawn' || event === 'dusk') ? tw : '';
    t.depression = (event === 'dawn' || event === 'dusk') ? TWILIGHT[tw] : 0;
    t.offsetType = type;
    t.offsetGiven = off.given;
    t.offsetTypeGiven = has(opts, 'offset_type');
    t.offsetRawMs = off.ms;
    t.offsetMs = type === 'before' ? 0 - off.ms : off.ms;
    if (off.given && off.ms !== 0 && !t.offsetTypeGiven) {
      model.info.push({ msg: name + ': ' + code('offset_type') + ' is not set, and it defaults to ' + code('before') + ', so this fires ' + humanDuration(off.ms) + ' before ' + event + '.', line: off.line });
    }
    if (off.ms < 0) {
      model.warnings.push({ msg: name + ': the offset is negative and ' + code('offset_type') + ' is ' + code(type) + '. Home Assistant negates the offset for ' + code('before') + ', so this fires ' + humanDuration(off.ms) + ' ' + (t.offsetMs > 0 ? 'after' : 'before') + ' ' + event + '.', line: off.line });
    }
    return true;
  }

  // ── Conditions ────────────────────────────────────────────

  function analyzeCondition(model, f, path, err, warn) {
    var label = '#' + path;
    var nd = { path: path, label: label, line: f.line, type: 'unknown', why: '' };
    if (f.kind === 'tag') {
      nd.why = 'it comes from ' + code(f.raw);
      model.notSim.push({ what: 'Condition ' + label, why: nd.why, line: f.line });
      return nd;
    }
    if (typeof f.v === 'string') {
      nd.why = 'it is a template condition';
      nd.short = 'template';
      if (!isTemplateText(f.v)) err('Condition ' + label + ': expected a condition, a list of conditions or a valid template', f.line);
      model.notSim.push({ what: 'Condition ' + label + ' (template)', why: 'templates read entity states that this tool can not know', line: f.line });
      return nd;
    }
    if (!isMap(f.v)) { err('Condition ' + label + ': expected a dictionary', f.line); nd.why = 'invalid'; return nd; }
    var c = f.v;
    if (has(c, 'enabled')) {
      var en = cvBoolean(fieldOf(c, 'enabled'));
      if (en === false) { nd.type = 'disabled'; nd.why = 'disabled'; model.info.push({ msg: 'Condition ' + label + ' has ' + code('enabled: false'), line: f.line }); return nd; }
      if (en === 'template') { nd.why = 'its enabled value is a template'; model.notSim.push({ what: 'Condition ' + label, why: nd.why, line: f.line }); return nd; }
      if (en === 'invalid') { err('Condition ' + label + ': invalid boolean value for enabled', f.line); nd.why = 'invalid'; return nd; }
    }
    // cv.expand_condition_shorthand
    var short = ['and', 'or', 'not'].filter(function (k) { return has(c, k); });
    if (!has(c, 'condition') && !has(c, 'conditions') && short.length === 1) {
      var sk = short[0];
      checkExtraKeys(c, Object.assign({}, COND_BASE_KEYS, (function () { var o = {}; o[sk] = 1; return o; })()), function (m, l) { err('Condition ' + label + ': ' + m, l); }, f.line);
      nd.type = sk;
      nd.items = itemsOf(fieldOf(c, sk)).map(function (x, i) { return analyzeCondition(model, x, path + '.' + (i + 1), err, warn); });
      return nd;
    }
    if (!has(c, 'condition')) { err('Condition ' + label + ": required key not provided @ data['condition']", f.line); nd.why = 'invalid'; return nd; }
    var cf = fieldOf(c, 'condition');
    if (Array.isArray(cf.v)) {
      nd.type = 'and';
      nd.items = itemsOf(cf).map(function (x, i) { return analyzeCondition(model, x, path + '.' + (i + 1), err, warn); });
      return nd;
    }
    var type = cf.v;
    if (type === 'and' || type === 'or' || type === 'not') {
      checkExtraKeys(c, Object.assign({ condition: 1, conditions: 1 }, COND_BASE_KEYS), function (m, l) { err('Condition ' + label + ': ' + m, l); }, f.line);
      nd.type = type;
      if (!has(c, 'conditions')) { err('Condition ' + label + ": required key not provided @ data['conditions']", f.line); nd.items = []; return nd; }
      nd.items = itemsOf(fieldOf(c, 'conditions')).map(function (x, i) { return analyzeCondition(model, x, path + '.' + (i + 1), err, warn); });
      return nd;
    }
    if (type === 'time') return analyzeTimeCondition(model, c, nd, err);
    if (type === 'sun') return analyzeSunCondition(model, c, nd, err);
    if (type === 'trigger') {
      checkExtraKeys(c, Object.assign({ condition: 1, id: 1 }, COND_BASE_KEYS), function (m, l) { err('Condition ' + label + ': ' + m, l); }, f.line);
      if (!has(c, 'id')) { err('Condition ' + label + ": required key not provided @ data['id']", f.line); nd.why = 'invalid'; return nd; }
      var idf = fieldOf(c, 'id');
      if (idf.kind === 'tag') { nd.why = 'its id comes from ' + code(idf.raw); model.notSim.push({ what: 'Condition ' + label + ' (trigger)', why: nd.why, line: f.line }); return nd; }
      nd.type = 'trigger';
      nd.ids = itemsOf(idf).map(function (x) {
        if (typeof x.v === 'boolean') return x.v ? 'True' : 'False';
        return x.v === null ? 'None' : String(x.v);
      });
      return nd;
    }
    var tname = typeof type === 'string' ? type : String(type);
    nd.short = tname;
    nd.why = has(STATE_CONDITIONS, tname) ? 'it ' + STATE_CONDITIONS[tname] : 'this tool does not simulate it';
    model.notSim.push({ what: 'Condition ' + label + ' (' + tname + ')', why: nd.why + ', so runs that reach it are marked "depends"', line: f.line });
    return nd;
  }

  function condTimeValue(model, c, key, label, err) {
    if (!has(c, key)) return { sec: null };
    var f = fieldOf(c, key);
    if (f.kind === 'tag') return { notSim: 'it comes from ' + code(f.raw) };
    if (isStrKind(f.kind)) {
      var s = parseTimeHA(f.v);
      if (s !== null) return { sec: s, raw: f.v };
      if (validEntityId(f.v) && /^(input_datetime|time|sensor)\./.test(f.v)) return { notSim: 'its ' + key + ' time comes from ' + code(f.v) };
      err('Condition ' + label + ' (time): ' + key + ' ' + code(f.v) + ' is not valid: use HH:MM, HH:MM:SS, or an input_datetime, time or sensor entity' + (/^\s*24:/.test(f.v) ? ' (hours run from 00 to 23; leave before out to run until midnight)' : ''), f.line);
      return { error: true };
    }
    if (f.kind === 'int' || f.kind === 'float') {
      err('Condition ' + label + ' (time): ' + key + ': ' + (yamlNumberExplain(f) || code(f.raw) + ' is a number.') + ' Home Assistant rejects it ("Invalid time specified"). Put it in quotes: ' + key + ': "' + f.raw + '".', f.line);
      return { error: true };
    }
    err('Condition ' + label + ' (time): ' + key + ' is not a valid time', f.line);
    return { error: true };
  }

  function analyzeTimeCondition(model, c, nd, err) {
    var label = nd.label;
    checkExtraKeys(c, Object.assign({ condition: 1, before: 1, after: 1, weekday: 1 }, COND_BASE_KEYS), function (m, l) { err('Condition ' + label + ' (time): ' + m, l); }, nd.line);
    if (!has(c, 'before') && !has(c, 'after') && !has(c, 'weekday')) {
      err('Condition ' + label + ' (time): must contain at least one of before, after, weekday.', nd.line);
      nd.why = 'invalid';
      return nd;
    }
    var a = condTimeValue(model, c, 'after', label, err);
    var b = condTimeValue(model, c, 'before', label, err);
    if (a.error || b.error) { nd.why = 'invalid'; return nd; }
    var wd = null;
    if (has(c, 'weekday')) {
      var wf = fieldOf(c, 'weekday');
      wd = parseWeekdays(wf, function (m) { err('Condition ' + label + ' (time): weekday ' + m, wf.line); });
      if (wd === null) { nd.why = 'invalid'; return nd; }
      if (wd === 'tag') { nd.why = 'its weekdays come from ' + code(wf.raw); model.notSim.push({ what: 'Condition ' + label + ' (time)', why: nd.why, line: nd.line }); return nd; }
    }
    if (a.notSim || b.notSim) {
      nd.why = a.notSim || b.notSim;
      nd.short = 'time';
      model.notSim.push({ what: 'Condition ' + label + ' (time)', why: nd.why + ', so runs that reach it are marked "depends"', line: nd.line });
      return nd;
    }
    nd.type = 'time';
    nd.after = a.sec;
    nd.before = b.sec;
    nd.weekday = wd;
    return nd;
  }

  // sun/condition.py SunCondition (legacy top-level fields are moved under options)
  function analyzeSunCondition(model, c, nd, err) {
    var label = nd.label;
    var name = 'Condition ' + label + ' (sun)';
    var o = c;
    if (has(c, 'options')) {
      checkExtraKeys(c, Object.assign({ condition: 1, options: 1, target: 1 }, COND_BASE_KEYS), function (m, l) { err(name + ': ' + m, l); }, nd.line);
      if (!isMap(c.options)) { err(name + ': options must be a dictionary', nd.line); nd.why = 'invalid'; return nd; }
      o = c.options;
      checkExtraKeys(o, { before: 1, after: 1, before_offset: 1, after_offset: 1 }, function (m, l) { err(name + ': options: ' + m, l); }, nd.line);
    } else {
      checkExtraKeys(c, Object.assign({ condition: 1, before: 1, after: 1, before_offset: 1, after_offset: 1 }, COND_BASE_KEYS), function (m, l) { err(name + ': ' + m, l); }, nd.line);
    }
    if (!has(o, 'before') && !has(o, 'after')) { err(name + ': must contain at least one of before, after.', nd.line); nd.why = 'invalid'; return nd; }
    var ev = {};
    var bad = false;
    ['before', 'after'].forEach(function (k) {
      if (!has(o, k)) return;
      var f = fieldOf(o, k);
      var v = String(f.v).toLowerCase();
      if (v !== 'sunrise' && v !== 'sunset') { err(name + ': ' + k + ' must be sunrise or sunset, got ' + code(String(f.raw || f.v)), f.line); bad = true; return; }
      ev[k] = v;
    });
    var bo = offsetField(model, o, 'before_offset', name, err);
    var ao = offsetField(model, o, 'after_offset', name, err);
    if (bad || !bo || !ao) { nd.why = 'invalid'; return nd; }
    nd.type = 'sun';
    nd.before = ev.before || null;
    nd.after = ev.after || null;
    nd.beforeOffset = bo.ms;
    nd.afterOffset = ao.ms;
    return nd;
  }

  // ── Condition evaluation (three-valued: true, false, null = depends) ──

  function condName(nd) {
    if (nd.type === 'time') return nd.label + ' (time)';
    if (nd.type === 'sun') return nd.label + ' (sun)';
    if (nd.type === 'trigger') return nd.label + ' (trigger)';
    if (nd.type === 'and' || nd.type === 'or' || nd.type === 'not') return nd.label + ' (' + nd.type + ')';
    return nd.label + (nd.short ? ' (' + nd.short + ')' : '');
  }

  // helpers/condition.py time(): the window [after, before) wraps past midnight when after >= before
  function timeConditionCheck(nd, sod, wd) {
    var after = nd.after === null || nd.after === undefined ? 0 : nd.after;
    var before = nd.before === null || nd.before === undefined ? 86399.999999 : nd.before;
    if (after < before) {
      if (!(after <= sod && sod < before)) return { v: false, why: 'outside ' + fmtSod(after) + (nd.before === null || nd.before === undefined ? ' to midnight' : '–' + fmtSod(before)) };
    } else if (before <= sod && sod < after) {
      return { v: false, why: 'between ' + fmtSod(before) + ' and ' + fmtSod(after) };
    }
    if (nd.weekday && nd.weekday.indexOf(wd) < 0) return { v: false, why: 'not on ' + DAY_LONG[wd] };
    return { v: true, why: '' };
  }

  function evalCondition(nd, ctx, run) {
    var r;
    var i;
    var unk = null;
    switch (nd.type) {
      case 'time':
        r = timeConditionCheck(nd, run.sod, run.wd);
        return { v: r.v, why: r.why, by: nd };
      case 'sun':
        if (!ctx.obs) return { v: null, why: 'needs your latitude and longitude', by: nd };
        r = sunConditionCheck(ctx, nd, run.evalMs);
        return { v: r.v, why: r.why, by: nd };
      case 'trigger':
        if (nd.ids.indexOf(run.triggerId) >= 0) return { v: true, why: '', by: nd };
        return { v: false, why: 'run came from trigger id "' + run.triggerId + '"', by: nd };
      case 'disabled':
        return { v: 'none', why: '', by: nd };
      case 'and':
        for (i = 0; i < nd.items.length; i++) {
          r = evalCondition(nd.items[i], ctx, run);
          if (r.v === false) return r;
          if (r.v === null && !unk) unk = r;
        }
        return unk ? unk : { v: true, why: '', by: nd };
      case 'or':
        for (i = 0; i < nd.items.length; i++) {
          r = evalCondition(nd.items[i], ctx, run);
          if (r.v === true) return { v: true, why: '', by: nd };
          if (r.v === null && !unk) unk = r;
        }
        return unk ? unk : { v: false, why: 'none of its conditions passed', by: nd };
      case 'not':
        for (i = 0; i < nd.items.length; i++) {
          r = evalCondition(nd.items[i], ctx, run);
          if (r.v === true) return { v: false, why: condName(nd.items[i]) + ' passed', by: nd };
          if (r.v === null && !unk) unk = r;
        }
        return unk ? unk : { v: true, why: '', by: nd };
      default:
        return { v: null, why: nd.why || 'not simulated', by: nd };
    }
  }

  // automation: all top-level conditions ANDed (ConditionsChecker)
  function evalConditions(list, ctx, run) {
    var unk = null;
    for (var i = 0; i < list.length; i++) {
      var r = evalCondition(list[i], ctx, run);
      if (r.v === false) return { status: 'blocked', why: r.why, by: r.by };
      if (r.v === null && !unk) unk = r;
    }
    if (unk) return { status: 'unknown', why: unk.why, by: unk.by };
    return { status: 'fired', why: '', by: null };
  }

  // ── Simulation ────────────────────────────────────────────

  var MAX_WINDOW_RUNS = 200000;
  var MAX_STEPS = 450000;
  var LIST_HORIZON_DAYS = 400;
  var CELL_KEEP = 40;

  function makeCtx(zoneName, obs) {
    return { zone: getZone(zoneName), zoneName: zoneName, obs: obs || null, sunCache: new Map() };
  }

  function patternGenerator(z, t, lists, startSec, at) {
    var g = { t: t, at: at, sec: nextPatternInstant(z, lists, startSec), kind: 'pattern' };
    g.ms = g.sec * 1000;
    g.advance = function () {
      g.sec = nextPatternInstant(z, lists, g.sec + 1);
      g.ms = g.sec * 1000;
    };
    return g;
  }

  function sunGenerator(ctx, t, startMs) {
    var g = { t: t, kind: 'sun', missing: [] };
    g.ms = sunEventNext(ctx, t.event, t.depression, t.offsetMs, startMs, null);
    g.advance = function () { g.ms = sunEventNext(ctx, t.event, t.depression, t.offsetMs, g.ms, null); };
    return g;
  }

  // Local DST transitions between two instants (seconds)
  function findTransitions(z, from, to) {
    var out = [];
    var prev = offsetAt(z, from);
    for (var t = from + 3600; t <= to + 3600; t += 3600) {
      var o = offsetAt(z, t);
      if (o !== prev) {
        var lo = Math.floor((t - 3600) / 60);
        var hi = Math.floor(t / 60);
        while (hi - lo > 1) {
          var mid = (lo + hi) >> 1;
          if (offsetAt(z, mid * 60) === prev) lo = mid; else hi = mid;
        }
        var at = hi * 60;
        if (at >= from && at < to) out.push({ at: at, from: prev, to: o });
        prev = o;
      }
    }
    return out;
  }

  function dayInfo(z, days) {
    var dw = days * 86400;
    var c = civilFromDays(days);
    var info = { days: days, y: c.y, m: c.m, d: c.d, wd: weekdayOfDays(days), hours: [] };
    var o1 = offsetAt(z, toInstant(z, dw, 0));
    var o2 = offsetAt(z, toInstant(z, dw + 86400, 0));
    var o0 = offsetAt(z, toInstant(z, dw, 0) - 86400);
    var changed = o1 !== o2 || o0 !== o1;
    for (var h = 0; h < 24; h++) {
      var st = { gap: 0, rep: 0 };
      if (changed) {
        for (var mm = 0; mm < 60; mm++) {
          var w = dw + h * 3600 + mm * 60;
          if (!dtExists(z, w, 0)) st.gap++;
          else if (dtAmbiguous(z, w, 0)) st.rep++;
        }
      }
      info.hours.push(st);
    }
    return info;
  }

  // opts: { zoneName, obs, startDays, days, listFromSec, listLimit, listFilter }
  function simulate(model, opts) {
    var ctx = makeCtx(opts.zoneName, opts.obs);
    var z = ctx.zone;
    var days = opts.days || 7;
    var res = {
      ctx: ctx, startDays: opts.startDays, days: [], cells: [], list: [], truncated: null, listStopped: false,
      needsLocation: [], stats: {}, transitions: [], totals: { fired: 0, blocked: 0, unknown: 0 }, sunDays: {}, sunMissing: {}
    };
    if (!z) return res;
    var winStart = toInstant(z, opts.startDays * 86400, 0);
    var winEnd = toInstant(z, (opts.startDays + days) * 86400, 0);
    var listFrom = opts.listFromSec === undefined ? winStart : Math.max(winStart, opts.listFromSec);
    var horizon = listFrom + LIST_HORIZON_DAYS * 86400;
    var listLimit = opts.listLimit || 20;
    var i;
    var d;
    for (d = 0; d < days; d++) {
      res.days.push(dayInfo(z, opts.startDays + d));
      var row = [];
      for (var h = 0; h < 24; h++) row.push({ f: 0, b: 0, u: 0, runs: [] });
      res.cells.push(row);
    }
    res.transitions = findTransitions(z, winStart, winEnd);

    var gens = [];
    model.triggers.forEach(function (t) {
      res.stats[t.idx] = { fired: 0, blocked: 0, unknown: 0, perDay: {} };
      if (t.type === 'time') {
        t.times.forEach(function (at) {
          var lists = { h: [Math.floor(at.sec / 3600)], m: [Math.floor(at.sec / 60) % 60], s: [at.sec % 60] };
          gens.push(patternGenerator(z, t, lists, winStart, at));
        });
      } else if (t.type === 'pattern') {
        gens.push(patternGenerator(z, t, t.lists, winStart, null));
      } else if (t.type === 'sun') {
        if (!ctx.obs) { res.needsLocation.push(t); return; }
        gens.push(sunGenerator(ctx, t, winStart * 1000 - 1));
        var miss = [];
        for (d = 0; d < days; d++) {
          if (isNaN(astralEventCached(ctx.sunCache, ctx.obs, t.event, t.depression, opts.startDays + d))) miss.push(opts.startDays + d);
        }
        res.sunMissing[t.idx] = miss;
      }
    });

    var windowRuns = 0;
    var steps = 0;
    for (;;) {
      var g = null;
      for (i = 0; i < gens.length; i++) {
        if (!isNaN(gens[i].ms) && (g === null || gens[i].ms < g.ms)) g = gens[i];
      }
      if (!g) break;
      var tMs = g.ms;
      var inWindow = tMs < winEnd * 1000;
      var listOpen = res.list.length < listLimit && tMs < horizon * 1000;
      if (inWindow && windowRuns >= MAX_WINDOW_RUNS) {
        if (res.truncated === null) res.truncated = tMs;
        inWindow = false;
      }
      if (!inWindow && !listOpen) break;
      if (++steps > MAX_STEPS) { res.listStopped = res.list.length < listLimit; if (inWindow && res.truncated === null) res.truncated = tMs; break; }
      g.advance();
      var t = g.t;
      var local = fromInstant(z, tMs / 1000);
      var p = wallParts(local.w);
      if (t.type === 'time' && t.weekday && t.weekday.indexOf(p.wd) < 0) continue;
      var evalMs = g.kind === 'pattern' ? tMs + 50 : tMs + 1;
      var evalLocal = fromInstant(z, evalMs / 1000);
      var ep = wallParts(evalLocal.w);
      var run = {
        ms: tMs, w: local.w, fold: local.f, offset: offsetAt(z, tMs / 1000), trig: t, triggerId: t.id, at: g.at,
        evalMs: evalMs, sod: ep.sod, wd: ep.wd, days: p.days, H: p.H
      };
      var ev = evalConditions(model.conditions, ctx, run);
      run.status = ev.status;
      run.why = ev.why;
      run.by = ev.by;
      if (inWindow) {
        windowRuns++;
        var di = p.days - opts.startDays;
        if (di >= 0 && di < days) {
          var cell = res.cells[di][p.H];
          if (run.status === 'fired') cell.f++; else if (run.status === 'blocked') cell.b++; else cell.u++;
          if (cell.runs.length < CELL_KEEP) cell.runs.push(run);
          res.totals[run.status]++;
          var st = res.stats[t.idx];
          st[run.status]++;
          st.perDay[p.days] = (st.perDay[p.days] || 0) + 1;
        }
      }
      if (listOpen && tMs >= listFrom * 1000 - 1) {
        if (!opts.listFilter || opts.listFilter === 'all' || run.status === 'fired') res.list.push(run);
      }
    }
    if (res.list.length < listLimit && !res.listStopped) res.listEnded = true;
    return res;
  }

  // ── Plain-language explanations ───────────────────────────

  function listText(vals, minV, maxV) {
    if (vals.length === maxV - minV + 1) return null;
    if (vals.length <= 8) return vals.join(', ');
    return vals.slice(0, 4).join(', ') + ', … ' + vals[vals.length - 1];
  }

  function dayList(idx) {
    if (!idx || !idx.length) return 'no day';
    var sorted = idx.slice().sort(function (a, b) { return a - b; });
    return sorted.map(function (i) { return DAY_LONG[i]; }).join(', ');
  }

  function joinAnd(parts) {
    if (parts.length <= 1) return parts.join('');
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  function stepOf(raw) {
    if (typeof raw !== 'string' || raw.charAt(0) !== '/') return 0;
    return pyInt(raw.slice(1));
  }

  function explainPattern(t) {
    var name = '<strong>Trigger #' + (t.idx + 1) + '</strong> (' + code('time_pattern') + ')';
    if (t.everySecond) {
      return name + ' fires every second. When no unit is narrowed down (only ' + code('*') + ' or nothing), Home Assistant uses a one-second interval timer instead of the pattern matcher (' + link(SRC.event, 'event.py') + '). That is 86,400 runs a day, each one checking the conditions.';
    }
    var L = t.lists;
    var parts = [];
    var h = listText(L.h, 0, 23);
    var m = listText(L.m, 0, 59);
    var s = listText(L.s, 0, 59);
    parts.push(h === null ? 'every hour' : 'hour ' + h);
    parts.push(m === null ? 'every minute' : 'minute ' + m);
    parts.push(s === null ? 'every second' : 'second ' + s);
    var perDay = L.h.length * L.m.length * L.s.length;
    var out = name + ' matches ' + parts.join(', ') + ': ' + perDay.toLocaleString('en-US') + (perDay === 1 ? ' run' : ' runs') + ' a day.';
    var extra = [];
    [['hours', 24, 'hour', ':00'], ['minutes', 60, 'minute', ''], ['seconds', 60, 'second', '']].forEach(function (u) {
      var raw = t.eff[u[0]];
      var st = stepOf(raw);
      if (!st) return;
      var vals = u[0] === 'hours' ? L.h : (u[0] === 'minutes' ? L.m : L.s);
      if (st === 1) { extra.push(code(u[0] + ': "' + raw + '"') + ' matches every ' + u[2] + ', the same as ' + code('"*"') + '.'); return; }
      var txt = code(u[0] + ': "' + raw + '"') + ' matches ' + u[0] + ' divisible by ' + st + ' (' + listText(vals, 0, u[1] - 1) + '), counted from ' +
        (u[0] === 'hours' ? 'midnight' : 'the top of the ' + (u[0] === 'minutes' ? 'hour' : 'minute')) + ', not from when Home Assistant started or the automation was saved.';
      if (u[1] % st !== 0) {
        var last = vals[vals.length - 1];
        txt += ' ' + u[1] + ' is not a multiple of ' + st + ', so the last gap is shorter: ' + last + ' is followed by 0 after ' + (u[1] - last) + ' ' + u[2] + (u[1] - last === 1 ? '' : 's') + '.';
      }
      extra.push(txt);
    });
    if (t.defaulted.minutes) extra.push('Only ' + code('hours') + ' is set, so Home Assistant fills in minute 0 and second 0 (' + link(SRC.patternTrigger, 'time_pattern.py') + '): one run at the start of each matching hour, not one every minute.');
    else if (t.defaulted.seconds) extra.push(code('minutes') + ' is set without ' + code('seconds') + ', so Home Assistant uses second 0: one run per matching minute, not one every second.');
    if (t.eff.hours === '*' && t.defaulted.minutes) extra.push(code('hours: "*"') + ' on its own therefore means hourly, at minute 0.');
    return out + (extra.length ? ' ' + extra.join(' ') : '');
  }

  function explainTime(t) {
    var name = '<strong>Trigger #' + (t.idx + 1) + '</strong> (' + code('time') + ')';
    var times = t.times.map(function (x) { return fmtSod(x.sec); });
    var out = name + (times.length ? ' fires at ' + joinAnd(times) : ' has no fixed time to simulate');
    out += t.weekday ? (t.weekday.length ? ' on ' + dayList(t.weekday) + ' only.' : ', but its weekday list is empty, so it never fires.') : ' every day.';
    var extra = [];
    if (t.weekday && t.weekday.length) extra.push('The ' + code('weekday') + ' option (Home Assistant 2025.8 and later) is checked against the local date at the moment the time is reached.');
    var noSec = t.times.filter(function (x) { return x.noSeconds; });
    if (noSec.length) extra.push(code(noSec[0].raw) + ' has no seconds, so Home Assistant uses ' + fmtSod(noSec[0].sec) + '.');
    var seen = {};
    t.times.forEach(function (x) {
      if (seen[x.sec]) extra.push(fmtSod(x.sec) + ' is listed twice; each entry gets its own timer, so it fires twice.');
      seen[x.sec] = true;
    });
    return out + (extra.length ? ' ' + extra.join(' ') : '');
  }

  function explainSun(t, sim, ctx) {
    var name = '<strong>Trigger #' + (t.idx + 1) + '</strong> (' + code(t.style === 'legacy' ? 'sun' : 'sun.' + t.event) + ')';
    var ev = t.twilight ? t.twilight + ' ' + t.event + ' (the sun ' + TWILIGHT[t.twilight] + '° below the horizon)' : t.event;
    var out = name + ' fires at ' + ev;
    if (t.offsetMs) out += ', ' + humanDuration(t.offsetMs) + (t.offsetMs < 0 ? ' earlier' : ' later');
    out += '.';
    var extra = [];
    if (t.style === 'legacy' && t.offsetMs) extra.push('In the older ' + code('trigger: sun') + ' form a negative offset means before the event and a positive one after it.');
    if (t.style === 'new' && t.offsetGiven && t.offsetRawMs) extra.push('The new triggers take a positive ' + code('offset') + ' and an ' + code('offset_type') + ' of ' + code('before') + ' (the default) or ' + code('after') + '.');
    if (ctx && ctx.obs) {
      extra.push('Times come from a port of astral ' + ASTRAL_VERSION + ' for ' + ctx.obs.lat + ', ' + ctx.obs.lon + (ctx.obs.elev > 0 ? ' at ' + ctx.obs.elev + ' m (the extra horizon dip moves sunrise earlier and sunset later)' : '') + '. Sun times are fixed instants, so a DST change moves them by an hour on the clock but never skips or repeats them.');
      var miss = sim && sim.sunMissing ? sim.sunMissing[t.idx] : null;
      if (miss && miss.length) {
        var c = civilFromDays(miss[0]);
        var why = missingEventKind(ctx.obs, c.y, c.m, c.d, eventZenith(t.event, t.depression)) === 'below' ? 'the sun stays below that elevation all day' : 'the sun stays above it all day';
        extra.push('There is no ' + t.event + ' on ' + miss.length + ' of the 7 days (' + why + '). Home Assistant scans up to a year ahead and fires on the next date that has one (' + link(SRC.sunHelper, 'helpers/sun.py') + ').');
      }
      var st = sim && sim.stats ? sim.stats[t.idx] : null;
      if (st) {
        var twice = Object.keys(st.perDay).filter(function (k) { return st.perDay[k] > 1; });
        if (twice.length) extra.push('On ' + twice.length + (twice.length === 1 ? ' day' : ' days') + ' it fires twice on the same local date, because the event drifts across midnight at this longitude and time zone; Home Assistant fires both.');
      }
    }
    return out + (extra.length ? ' ' + extra.join(' ') : '');
  }

  function describeTimeWindow(nd) {
    var a = nd.after;
    var b = nd.before;
    var txt;
    var crosses = false;
    if (a === null && b === null) txt = 'all day';
    else if (b === null) txt = 'from ' + fmtSod(a) + ' until midnight';
    else if (a === null) txt = b === 0 ? 'all day (with no ' + code('after') + ', ' + code('before: "00:00:00"') + ' leaves an empty blocked range)' : 'from midnight until just before ' + fmtSod(b);
    else if (a < b) txt = 'from ' + fmtSod(a) + ' until just before ' + fmtSod(b);
    else if (a === b) txt = 'all day, because ' + code('after') + ' and ' + code('before') + ' are equal: Home Assistant only blocks when before ≤ now < after, which is empty';
    else { txt = 'from ' + fmtSod(a) + ' until midnight and from midnight until just before ' + fmtSod(b) + ' (the window crosses midnight)'; crosses = true; }
    return { txt: txt, crosses: crosses };
  }

  function describeCondition(nd) {
    switch (nd.type) {
      case 'time': {
        var w = describeTimeWindow(nd);
        var out = 'passes ' + w.txt;
        if (nd.weekday) out += nd.weekday.length ? ', on ' + dayList(nd.weekday) : ', but the weekday list is empty, so it never passes';
        if (nd.weekday && nd.weekday.length && w.crosses) {
          out += '. Home Assistant checks the weekday of the moment it evaluates the condition, so the hours after midnight belong to the next day: at 01:00 on a Saturday this passes only if Saturday is selected (' + link(SRC.docsTimeCond, 'time condition docs') + ')';
        }
        return out + '.';
      }
      case 'sun': {
        var t = function (ev, off) { return ev + (off ? ' ' + (off < 0 ? '- ' : '+ ') + humanDuration(off) : ''); };
        var s;
        if (nd.before === 'sunrise' && nd.after === 'sunset') s = 'passes from midnight until ' + t('sunrise', nd.beforeOffset) + ' and from ' + t('sunset', nd.afterOffset) + ' until midnight (Home Assistant treats this pair as either-or)';
        else if (nd.before && nd.after) s = 'passes from ' + t(nd.after, nd.afterOffset) + ' until ' + t(nd.before, nd.beforeOffset);
        else if (nd.before) s = 'passes from midnight until ' + t(nd.before, nd.beforeOffset);
        else s = 'passes from ' + t(nd.after, nd.afterOffset) + ' until midnight';
        return s + ', using the sunrise and sunset of the current local day. On days without that event (polar regions) it does not pass.';
      }
      case 'trigger':
        return 'passes when the run came from trigger id ' + nd.ids.map(function (x) { return code(x); }).join(' or ') + '. A trigger without an ' + code('id') + ' gets its position as id: "0" for the first.';
      case 'and': return 'passes when all of its ' + nd.items.length + ' conditions pass.';
      case 'or': return 'passes when any of its ' + nd.items.length + ' conditions passes.';
      case 'not': return 'passes when none of its ' + nd.items.length + ' conditions passes.';
      case 'disabled': return 'is disabled, so Home Assistant skips it (it neither blocks nor passes).';
      default: return 'is not simulated: ' + (nd.why || 'unknown type') + '.';
    }
  }

  function flattenConds(list, out) {
    list.forEach(function (nd) {
      out.push(nd);
      if (nd.items) flattenConds(nd.items, out);
    });
    return out;
  }

  function fmtDateShort(days) {
    var c = civilFromDays(days);
    return DAY_NAMES[weekdayOfDays(days)] + ' ' + c.d + ' ' + MONTHS[c.m - 1] + ' ' + c.y;
  }

  function explainTransition(tr, model, sim, ctx) {
    var z = ctx.zone;
    var wBefore = tr.at + tr.from;
    var wAfter = tr.at + tr.to;
    var pb = wallParts(wBefore);
    var pa = wallParts(wAfter);
    var hm = function (p) { return pad2(p.H) + ':' + pad2(p.M); };
    var ab1 = zoneAbbr(ctx.zoneName, tr.at - 1);
    var ab2 = zoneAbbr(ctx.zoneName, tr.at);
    var lbl = function (a, o) { return a && !/^(GMT|UTC)/.test(a) ? a : offsetLabel(o); };
    var diff = Math.abs(tr.to - tr.from);
    var head = '<strong>' + fmtDateShort(pb.days) + '</strong>: at ' + hm(pb) + ' ' + lbl(ab1, tr.from) + ' the clocks go ' + (tr.to > tr.from ? 'forward' : 'back') + ' to ' + hm(pa) + ' ' + lbl(ab2, tr.to) + '. ';
    var affected = [];
    var dayW = pb.days * 86400;
    if (tr.to > tr.from) {
      head += 'Local times from ' + hm(pb) + ' to just before ' + hm(pa) + ' do not exist that day. A time or time pattern trigger that matches inside that gap does not run (Home Assistant moves on to the next match that exists; it does not fire late at ' + hm(pa) + ').';
      model.triggers.forEach(function (t) {
        if (t.type === 'time') t.times.forEach(function (x) { if (!dtExists(z, dayW + x.sec, 0)) affected.push('trigger #' + (t.idx + 1) + ' at ' + fmtSod(x.sec) + ' is skipped that day'); });
      });
    } else {
      head += 'Local times from ' + hm(pa) + ' to just before ' + hm(pb) + ' happen twice. Home Assistant\'s matcher (' + link(SRC.dt, 'find_next_time_expression_time') + ') fires a time or time pattern trigger in both copies.';
      model.triggers.forEach(function (t) {
        if (t.type === 'time') t.times.forEach(function (x) { if (dtAmbiguous(z, pa.days * 86400 + x.sec, 0)) affected.push('trigger #' + (t.idx + 1) + ' at ' + fmtSod(x.sec) + ' runs twice, ' + humanDuration(diff * 1000) + ' apart'); });
      });
      if (flattenConds(model.conditions, []).some(function (n) { return n.type === 'time'; })) head += ' A time condition only sees the wall clock, so both copies pass or fail alike.';
    }
    if (affected.length) head += ' Here: ' + affected.join('; ') + '.';
    return head;
  }

  function buildNotes(model, sim, ctx) {
    var notes = [];
    model.triggers.forEach(function (t) {
      if (t.type === 'time') notes.push({ cls: 'trig', html: explainTime(t) });
      else if (t.type === 'pattern') notes.push({ cls: 'trig', html: explainPattern(t) });
      else if (t.type === 'sun') notes.push({ cls: 'trig', html: explainSun(t, sim, ctx) });
    });
    flattenConds(model.conditions, []).forEach(function (nd) {
      notes.push({ cls: 'cond', html: '<strong>Condition ' + escapeHtml(nd.label) + '</strong>' + (nd.type === 'time' || nd.type === 'sun' || nd.type === 'trigger' ? ' (' + code(nd.type) + ')' : '') + ' ' + describeCondition(nd) });
    });
    if (model.conditions.length > 1) notes.push({ cls: 'cond', html: 'All top-level conditions must pass (they are combined with AND); a disabled one is skipped.' });
    if (sim && sim.transitions) sim.transitions.forEach(function (tr) { notes.push({ cls: 'dst', html: explainTransition(tr, model, sim, ctx) }); });
    return notes;
  }

  // ── Form model, YAML output and the URL hash ──────────────

  function blankWd() { return [false, false, false, false, false, false, false]; }

  function defaultForm() {
    return {
      alias: 'Morning lights and evening check',
      triggers: [
        { k: 'time', at: '07:00', wd: [true, true, true, true, true, false, false] },
        { k: 'pattern', h: '', m: '/30', s: '' },
        { k: 'sun', ev: 'sunset', tw: 'civil', off: '00:30', dir: 'before' }
      ],
      conds: [
        { k: 'time', after: '06:30', before: '23:00', wd: blankWd() }
      ]
    };
  }

  function yq(s) {
    var BS = String.fromCharCode(92);
    return '"' + String(s).split(BS).join(BS + BS).split('"').join(BS + '"') + '"';
  }

  function normTime(s) {
    var t = String(s).trim();
    var v = parseTimeHA(t);
    return v === null ? t : fmtSod(v);
  }

  function splitTimes(s) {
    return String(s || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function normOffset(s, sign) {
    var t = String(s || '').trim();
    if (!t) return '';
    var r = timePeriod(t, 'qstr');
    if (r.error || r.ms === undefined) return (sign < 0 ? '-' : '') + t;
    return fmtDuration(sign < 0 ? -Math.abs(r.ms) : r.ms);
  }

  function formToYaml(form, legacySun) {
    var L = [];
    L.push('alias: ' + yq(form.alias || 'Scheduled automation'));
    L.push('description: ""');
    if (!form.triggers.length) L.push('triggers: []');
    else L.push('triggers:');
    form.triggers.forEach(function (t) {
      if (t.k === 'time') {
        L.push('  - trigger: time');
        var times = splitTimes(t.at);
        if (times.length === 1) L.push('    at: ' + yq(normTime(times[0])));
        else if (!times.length) L.push('    at: []');
        else { L.push('    at:'); times.forEach(function (x) { L.push('      - ' + yq(normTime(x))); }); }
        var days = WEEKDAYS.filter(function (d, i) { return t.wd[i]; });
        if (days.length && days.length < 7) { L.push('    weekday:'); days.forEach(function (d) { L.push('      - ' + d); }); }
      } else if (t.k === 'pattern') {
        L.push('  - trigger: time_pattern');
        [['hours', t.h], ['minutes', t.m], ['seconds', t.s]].forEach(function (p) {
          var v = String(p[1] || '').trim();
          if (v !== '') L.push('    ' + p[0] + ': ' + yq(v));
        });
      } else if (t.k === 'sun') {
        var off = String(t.off || '').trim();
        var r = off ? timePeriod(off, 'qstr') : { ms: 0 };
        var isZero = !off || (r.ms === 0 && !r.error);
        var twilight = t.ev === 'dawn' || t.ev === 'dusk';
        if (legacySun && !twilight) {
          L.push('  - trigger: sun');
          L.push('    event: ' + t.ev);
          if (!isZero) L.push('    offset: ' + yq(normOffset(off, t.dir === 'before' ? -1 : 1)));
        } else {
          L.push('  - trigger: sun.' + t.ev);
          if (!isZero || twilight) {
            L.push('    options:');
            if (twilight) L.push('      type: ' + (t.tw || 'civil'));
            if (!isZero) {
              L.push('      offset: ' + yq(normOffset(off, 1)));
              L.push('      offset_type: ' + (t.dir === 'after' ? 'after' : 'before'));
            }
          }
        }
      }
    });
    if (!form.conds.length) L.push('conditions: []');
    else L.push('conditions:');
    form.conds.forEach(function (c) {
      if (c.k === 'time') {
        L.push('  - condition: time');
        if (String(c.after || '').trim()) L.push('    after: ' + yq(normTime(c.after)));
        if (String(c.before || '').trim()) L.push('    before: ' + yq(normTime(c.before)));
        var days = WEEKDAYS.filter(function (d, i) { return c.wd[i]; });
        if (days.length) { L.push('    weekday:'); days.forEach(function (d) { L.push('      - ' + d); }); }
      } else if (c.k === 'sun') {
        L.push('  - condition: sun');
        if (c.after) {
          L.push('    after: ' + c.after);
          if (String(c.aoff || '').trim()) L.push('    after_offset: ' + yq(normOffset(c.aoff, String(c.aoff).trim().charAt(0) === '-' ? -1 : 1)));
        }
        if (c.before) {
          L.push('    before: ' + c.before);
          if (String(c.boff || '').trim()) L.push('    before_offset: ' + yq(normOffset(c.boff, String(c.boff).trim().charAt(0) === '-' ? -1 : 1)));
        }
      }
    });
    L.push('actions: []');
    L.push('mode: single');
    return L.join('\n') + '\n';
  }

  // Analyzed model back into the form, when everything fits
  function modelToForm(model, alias) {
    if (model.notSim.length || model.errors.length) return null;
    var form = { alias: alias || model.alias || 'Scheduled automation', triggers: [], conds: [] };
    for (var i = 0; i < model.triggers.length; i++) {
      var t = model.triggers[i];
      if (t.type === 'time') {
        var wd = blankWd();
        if (t.weekday) { if (!t.weekday.length) return null; t.weekday.forEach(function (d) { wd[d] = true; }); }
        form.triggers.push({ k: 'time', at: t.times.map(function (x) { return fmtSod(x.sec); }).join(', '), wd: wd });
      } else if (t.type === 'pattern') {
        var g = function (k) { var v = t.given[k]; return v === undefined ? '' : String(v).replace(/^"|"$/g, ''); };
        form.triggers.push({ k: 'pattern', h: g('hours'), m: g('minutes'), s: g('seconds') });
      } else if (t.type === 'sun') {
        form.triggers.push({ k: 'sun', ev: t.event, tw: t.twilight || 'civil', off: t.offsetMs ? fmtDuration(Math.abs(t.offsetMs)) : '', dir: t.offsetMs < 0 ? 'before' : 'after' });
      } else {
        return null;
      }
    }
    if (model.triggerCount !== model.triggers.length) return null;
    for (var j = 0; j < model.conditions.length; j++) {
      var c = model.conditions[j];
      if (c.type === 'time') {
        var cw = blankWd();
        if (c.weekday) { if (!c.weekday.length) return null; c.weekday.forEach(function (d) { cw[d] = true; }); }
        form.conds.push({ k: 'time', after: c.after === null ? '' : fmtSod(c.after), before: c.before === null ? '' : fmtSod(c.before), wd: cw });
      } else if (c.type === 'sun') {
        form.conds.push({ k: 'sun', after: c.after || '', aoff: c.after && c.afterOffset ? fmtDuration(c.afterOffset) : '', before: c.before || '', boff: c.before && c.beforeOffset ? fmtDuration(c.beforeOffset) : '' });
      } else {
        return null;
      }
    }
    return form;
  }

  function b64urlEncode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(s) {
    var b = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function wdBits(wd) { return wd.map(function (x) { return x ? '1' : '0'; }).join(''); }
  function bitsWd(s) { var out = blankWd(); for (var i = 0; i < 7; i++) out[i] = String(s || '').charAt(i) === '1'; return out; }

  // settings: { tz, legacySun, listLimit, listFilter, start, keepLoc, lat, lon, elev }
  function encodeState(form, settings) {
    var o = { v: 1, tz: settings.tz, al: form.alias, t: [], c: [] };
    form.triggers.forEach(function (t) {
      if (t.k === 'time') o.t.push({ k: 't', a: t.at, w: wdBits(t.wd) });
      else if (t.k === 'pattern') o.t.push({ k: 'p', h: t.h, m: t.m, s: t.s });
      else if (t.k === 'sun') o.t.push({ k: 's', e: t.ev, y: t.tw, o: t.off, d: t.dir === 'after' ? 'a' : 'b' });
    });
    form.conds.forEach(function (c) {
      if (c.k === 'time') o.c.push({ k: 't', a: c.after, b: c.before, w: wdBits(c.wd) });
      else if (c.k === 'sun') o.c.push({ k: 's', a: c.after, ao: c.aoff, b: c.before, bo: c.boff });
    });
    if (settings.legacySun) o.ls = 1;
    if (settings.listLimit && settings.listLimit !== 20) o.n = settings.listLimit;
    if (settings.listFilter === 'fired') o.lf = 'f';
    if (settings.start) o.st = settings.start;
    if (settings.keepLoc && settings.lat !== '' && settings.lon !== '') {
      o.k = 1;
      o.loc = [settings.lat, settings.lon, settings.elev || '0'];
    }
    return '#s=' + b64urlEncode(JSON.stringify(o));
  }

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 200) : (typeof v === 'number' ? String(v) : ''); }

  function decodeState(hash) {
    if (!hash || hash.indexOf('#s=') !== 0) return null;
    var o;
    try { o = JSON.parse(b64urlDecode(hash.slice(3))); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    var form = { alias: str(o.al), triggers: [], conds: [] };
    (Array.isArray(o.t) ? o.t : []).slice(0, 20).forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      if (t.k === 't') form.triggers.push({ k: 'time', at: str(t.a), wd: bitsWd(t.w) });
      else if (t.k === 'p') form.triggers.push({ k: 'pattern', h: str(t.h, 20), m: str(t.m, 20), s: str(t.s, 20) });
      else if (t.k === 's') form.triggers.push({ k: 'sun', ev: has(SUN_KINDS, t.e) ? t.e : 'sunset', tw: has(TWILIGHT, t.y) ? t.y : 'civil', off: str(t.o, 20), dir: t.d === 'a' ? 'after' : 'before' });
    });
    (Array.isArray(o.c) ? o.c : []).slice(0, 20).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      if (c.k === 't') form.conds.push({ k: 'time', after: str(c.a, 20), before: str(c.b, 20), wd: bitsWd(c.w) });
      else if (c.k === 's') form.conds.push({ k: 'sun', after: c.a === 'sunrise' || c.a === 'sunset' ? c.a : '', aoff: str(c.ao, 20), before: c.b === 'sunrise' || c.b === 'sunset' ? c.b : '', boff: str(c.bo, 20) });
    });
    var settings = {
      tz: str(o.tz, 64), legacySun: o.ls === 1, listLimit: [20, 50, 100].indexOf(o.n) >= 0 ? o.n : 20,
      listFilter: o.lf === 'f' ? 'fired' : 'all', start: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(o.st || '') ? o.st : '',
      keepLoc: o.k === 1 && Array.isArray(o.loc), lat: '', lon: '', elev: ''
    };
    if (settings.keepLoc) { settings.lat = str(o.loc[0], 20); settings.lon = str(o.loc[1], 20); settings.elev = str(o.loc[2], 20); }
    return { form: form, settings: settings };
  }

  // ── Examples ──────────────────────────────────────────────

  var EXAMPLES = {
    night: { label: 'Every 5 minutes at night, Friday and Saturday', yaml: [
      'alias: Night check every 5 minutes',
      'triggers:',
      '  - trigger: time_pattern',
      '    minutes: "/5"',
      'conditions:',
      '  - condition: time',
      '    after: "22:00:00"',
      '    before: "06:00:00"',
      '    weekday:',
      '      - fri',
      '      - sat',
      'actions:',
      '  - action: script.night_check',
      'mode: single'
    ] },
    legacy: { label: 'Older syntax with unquoted times (YAML 1.1 traps)', yaml: [
      '- id: "1700000000000"',
      '  alias: Porch light',
      '  trigger:',
      '    - platform: sun',
      '      event: sunset',
      '      offset: -00:30:00',
      '    - platform: time',
      '      at: 19:45:00',
      '    - platform: time_pattern',
      '      hours: 010',
      '  condition:',
      '    - condition: time',
      '      before: "23:30:00"',
      '  action:',
      '    - service: light.turn_on',
      '      target:',
      '        entity_id: light.porch'
    ] },
    sun: { label: 'Sunrise and sunset with offsets and trigger ids', yaml: [
      'alias: Blinds',
      'triggers:',
      '  - trigger: sun.sunrise',
      '    id: morning',
      '    options:',
      '      offset: "00:15:00"',
      '      offset_type: after',
      '  - trigger: sun.sunset',
      '    id: evening',
      '    options:',
      '      offset:',
      '        minutes: 30',
      'conditions:',
      '  - or:',
      '      - condition: trigger',
      '        id: evening',
      '      - condition: time',
      '        weekday: [sat, sun]',
      'actions:',
      '  - action: cover.toggle',
      '    target:',
      '      entity_id: cover.living_room'
    ] },
    dst: { label: 'DST fall-back night in New York (sets zone and date)', tz: 'America/New_York', start: '2026-10-29T00:00', yaml: [
      'alias: Night backup',
      'triggers:',
      '  - trigger: time',
      '    at: "01:30:00"',
      '    id: backup',
      '  - trigger: time_pattern',
      '    hours: "/1"',
      '    id: hourly',
      'conditions:',
      '  - condition: time',
      '    after: "00:00:00"',
      '    before: "04:00:00"',
      'actions: []'
    ] }
  };

  var LOCATIONS = {
    london: { label: 'London', lat: '51.5072', lon: '-0.1276', tz: 'Europe/London' },
    kyiv: { label: 'Kyiv', lat: '50.4501', lon: '30.5234', tz: 'Europe/Kyiv' },
    newyork: { label: 'New York', lat: '40.7128', lon: '-74.006', tz: 'America/New_York' },
    sandiego: { label: 'San Diego (HA test location)', lat: '32.87336', lon: '-117.22743', tz: 'America/Los_Angeles' },
    sydney: { label: 'Sydney', lat: '-33.8688', lon: '151.2093', tz: 'Australia/Sydney' },
    tromso: { label: 'Tromsø (polar night and midnight sun)', lat: '69.6492', lon: '18.9553', tz: 'Europe/Oslo' }
  };

  // ── Page state ────────────────────────────────────────────

  var form = defaultForm();
  var settings = { tz: '', legacySun: false, listLimit: 20, listFilter: 'all', start: '', keepLoc: false, lat: '', lon: '', elev: '' };
  var mode = 'form';
  var hashActive = false;
  var timer = null;
  var yamlPick = 0;
  var last = null;
  var openCell = null;

  // Browsers often report the older IANA link names; prefer the current ones
  var ZONE_RENAMES = {
    'Europe/Kiev': 'Europe/Kyiv', 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Katmandu': 'Asia/Kathmandu',
    'Asia/Rangoon': 'Asia/Yangon', 'America/Godthab': 'America/Nuuk', 'Atlantic/Faeroe': 'Atlantic/Faroe',
    'America/Buenos_Aires': 'America/Argentina/Buenos_Aires', 'America/Indianapolis': 'America/Indiana/Indianapolis',
    'America/Louisville': 'America/Kentucky/Louisville', 'Pacific/Ponape': 'Pacific/Pohnpei', 'Pacific/Truk': 'Pacific/Chuuk',
    'Asia/Ulan_Bator': 'Asia/Ulaanbaatar', 'Pacific/Enderbury': 'Pacific/Kanton'
  };

  function modernZone(z) { return has(ZONE_RENAMES, z) && getZone(ZONE_RENAMES[z]) ? ZONE_RENAMES[z] : z; }

  function browserZone() {
    try { return modernZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); } catch (e) { return 'UTC'; }
  }

  function zoneList() {
    var list = [];
    try { if (Intl.supportedValuesOf) list = Intl.supportedValuesOf('timeZone').slice(); } catch (e) { list = []; }
    if (!list.length) {
      list = ['UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Kyiv', 'Europe/Warsaw', 'Europe/Oslo', 'America/New_York', 'America/Chicago',
        'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Kolkata', 'Asia/Shanghai', 'Australia/Sydney', 'Pacific/Auckland'];
    }
    list = list.map(modernZone);
    var add = function (z) { if (z && list.indexOf(z) < 0 && getZone(z)) list.push(z); };
    add('UTC');
    add(browserZone());
    add(settings.tz);
    return list.filter(function (z, i) { return list.indexOf(z) === i; }).sort();
  }

  function fillZones() {
    var sel = $('hav-tz');
    if (!sel) return;
    sel.innerHTML = zoneList().map(function (z) { return '<option value="' + escapeHtml(z) + '">' + escapeHtml(z) + '</option>'; }).join('');
    sel.value = settings.tz;
  }

  function fillStatic() {
    var ls = $('hav-loc-preset');
    if (ls) {
      ls.innerHTML = '<option value="">Your own (type it in)</option>' + Object.keys(LOCATIONS).map(function (k) {
        return '<option value="' + k + '">' + escapeHtml(LOCATIONS[k].label) + '</option>';
      }).join('');
    }
    var ex = $('hav-example');
    if (ex) {
      ex.innerHTML = '<option value="">Load an example…</option>' + Object.keys(EXAMPLES).map(function (k) {
        return '<option value="' + k + '">' + escapeHtml(EXAMPLES[k].label) + '</option>';
      }).join('');
    }
  }

  function writeSettings() {
    var set = function (id, v) { var el = $(id); if (el) el.value = v; };
    if ($('hav-tz')) { if (!Array.prototype.some.call($('hav-tz').options, function (o) { return o.value === settings.tz; })) fillZones(); $('hav-tz').value = settings.tz; }
    set('hav-lat', settings.lat);
    set('hav-lon', settings.lon);
    set('hav-elev', settings.elev);
    set('hav-start', settings.start);
    set('hav-list-limit', String(settings.listLimit));
    set('hav-list-filter', settings.listFilter);
    if ($('hav-keep-loc')) $('hav-keep-loc').checked = settings.keepLoc;
    if ($('hav-legacy-sun')) $('hav-legacy-sun').checked = settings.legacySun;
  }

  function writeHash() {
    if (!hashActive) return;
    try { history.replaceState(null, '', encodeState(form, settings)); } catch (e) { /* file:// or sandboxed frame */ }
  }

  function changed() {
    hashActive = true;
    writeHash();
    schedule();
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(recompute, 150);
  }

  // ── Form rendering ────────────────────────────────────────

  function attr(s) { return escapeHtml(s === undefined || s === null ? '' : s); }

  function inputHtml(id, f, label, value, ph, wide) {
    return '<div class="hav-field' + (wide ? ' hav-field--wide' : '') + '"><label class="hav-label" for="' + id + '">' + label + '</label>' +
      '<input class="hav-input" id="' + id + '" data-f="' + f + '" type="text" value="' + attr(value) + '" placeholder="' + attr(ph) + '" autocomplete="off" spellcheck="false"></div>';
  }

  function selectHtml(id, f, label, value, opts) {
    return '<div class="hav-field"><label class="hav-label" for="' + id + '">' + label + '</label><select class="hav-input hav-select" id="' + id + '" data-f="' + f + '">' +
      opts.map(function (o) { return '<option value="' + attr(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>'; }).join('') + '</select></div>';
  }

  function daysHtml(prefix, wd, legend) {
    return '<fieldset class="hav-fieldset"><legend class="hav-label">' + legend + '</legend><div class="hav-days">' +
      DAY_NAMES.map(function (d, i) {
        return '<label class="hav-chip"><input class="hav-chip-input" type="checkbox" id="' + prefix + '-wd' + i + '" data-f="wd" data-d="' + i + '"' + (wd[i] ? ' checked' : '') + '><span class="hav-chip-text">' + d + '</span></label>';
      }).join('') + '</div></fieldset>';
  }

  var TRIG_TITLES = { time: 'Time', pattern: 'Time pattern', sun: 'Sun' };

  function trigHtml(t, i) {
    var p = 'hav-t' + i;
    var body = '';
    if (t.k === 'time') {
      body = '<div class="hav-grid">' + inputHtml(p + '-at', 'at', 'At (HH:MM or HH:MM:SS, several with commas)', t.at, '07:00, 19:30', true) + '</div>' +
        daysHtml(p, t.wd, 'Days (none ticked = every day)');
    } else if (t.k === 'pattern') {
      body = '<div class="hav-grid hav-grid--3">' + inputHtml(p + '-h', 'h', 'Hours', t.h, '*, 7 or /2') + inputHtml(p + '-m', 'm', 'Minutes', t.m, '*, 15 or /5') + inputHtml(p + '-s', 's', 'Seconds', t.s, '*, 0 or /30') + '</div>' +
        '<p class="hav-hint">Leave a unit empty to let Home Assistant fill it in: when a larger unit is set, the smaller ones become 0.</p>';
    } else {
      var tw = t.ev === 'dawn' || t.ev === 'dusk';
      body = '<div class="hav-grid hav-grid--4">' +
        selectHtml(p + '-ev', 'ev', 'Event', t.ev, [['sunrise', 'Sunrise'], ['sunset', 'Sunset'], ['dawn', 'Dawn'], ['dusk', 'Dusk']]) +
        (tw ? selectHtml(p + '-tw', 'tw', 'Twilight', t.tw, [['civil', 'Civil (6°)'], ['nautical', 'Nautical (12°)'], ['astronomical', 'Astronomical (18°)']]) : '') +
        inputHtml(p + '-off', 'off', 'Offset (HH:MM[:SS])', t.off, '00:30') +
        selectHtml(p + '-dir', 'dir', 'Offset is', t.dir, [['before', 'Before the event'], ['after', 'After the event']]) + '</div>';
    }
    return '<div class="hav-item" data-list="t" data-i="' + i + '"><div class="hav-item-head"><span class="hav-item-title">Trigger #' + (i + 1) + ' · ' + TRIG_TITLES[t.k] + '</span>' +
      '<button type="button" class="hav-icon-btn" data-act="del" aria-label="Remove trigger #' + (i + 1) + '">&#10005;</button></div>' + body + '</div>';
  }

  function condHtml(c, i) {
    var p = 'hav-c' + i;
    var body;
    if (c.k === 'time') {
      body = '<div class="hav-grid">' + inputHtml(p + '-after', 'after', 'After (HH:MM[:SS])', c.after, '22:00') + inputHtml(p + '-before', 'before', 'Before (HH:MM[:SS])', c.before, '06:00') + '</div>' +
        daysHtml(p, c.wd, 'Weekdays (none ticked = every day)');
    } else {
      var evs = [['', '—'], ['sunrise', 'Sunrise'], ['sunset', 'Sunset']];
      body = '<div class="hav-grid hav-grid--4">' + selectHtml(p + '-after', 'after', 'After', c.after, evs) + inputHtml(p + '-aoff', 'aoff', 'After offset (±HH:MM)', c.aoff, '-01:00') +
        selectHtml(p + '-before', 'before', 'Before', c.before, evs) + inputHtml(p + '-boff', 'boff', 'Before offset (±HH:MM)', c.boff, '00:30') + '</div>' +
        '<p class="hav-hint">Offsets here are signed: a negative one moves the time earlier.</p>';
    }
    return '<div class="hav-item" data-list="c" data-i="' + i + '"><div class="hav-item-head"><span class="hav-item-title">Condition #' + (i + 1) + ' · ' + (c.k === 'time' ? 'Time window' : 'Sun') + '</span>' +
      '<button type="button" class="hav-icon-btn" data-act="del" aria-label="Remove condition #' + (i + 1) + '">&#10005;</button></div>' + body + '</div>';
  }

  function renderForm() {
    if (!$('hav-trig-list')) return;
    $('hav-alias').value = form.alias;
    $('hav-trig-list').innerHTML = form.triggers.length ? form.triggers.map(trigHtml).join('') : '<p class="hav-empty">No triggers yet. Add one below.</p>';
    $('hav-cond-list').innerHTML = form.conds.length ? form.conds.map(condHtml).join('') : '<p class="hav-empty">No conditions: every run goes through.</p>';
    validateForm();
  }

  function fieldValid(kind, f, v) {
    var s = String(v || '').trim();
    if (kind === 'time' && f === 'at') return splitTimes(s).length > 0 && splitTimes(s).every(function (x) { return parseTimeHA(x) !== null; });
    if (kind === 'pattern') {
      if (s === '') return true;
      var r = timePatternValue({ v: s, raw: s }, f === 'h' ? 23 : 59);
      return !r.error;
    }
    if (f === 'off') return s === '' || (!timePeriod(s, 'qstr').error && s.charAt(0) !== '-');
    if (f === 'after' || f === 'before') return s === '' || s === 'sunrise' || s === 'sunset' || parseTimeHA(s) !== null;
    if (f === 'aoff' || f === 'boff') return s === '' || !timePeriod(s, 'qstr').error;
    return true;
  }

  function validateForm() {
    var items = document.querySelectorAll('.hav-item');
    Array.prototype.forEach.call(items, function (item) {
      var list = item.getAttribute('data-list') === 't' ? form.triggers : form.conds;
      var o = list[+item.getAttribute('data-i')];
      if (!o) return;
      var inputs = item.querySelectorAll('input[data-f]:not([data-f="wd"])');
      Array.prototype.forEach.call(inputs, function (el) {
        el.classList.toggle('hav-invalid', !fieldValid(o.k, el.getAttribute('data-f'), el.value));
      });
      if (o.k === 'pattern') {
        var none = !String(o.h).trim() && !String(o.m).trim() && !String(o.s).trim();
        Array.prototype.forEach.call(inputs, function (el) { if (none) el.classList.add('hav-invalid'); });
      }
    });
  }

  function onFormInput(ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) return;
    if (el.id === 'hav-alias') { form.alias = el.value; changed(); return; }
    var item = el.closest ? el.closest('.hav-item') : null;
    var f = el.getAttribute('data-f');
    if (!item || !f) return;
    var list = item.getAttribute('data-list') === 't' ? form.triggers : form.conds;
    var o = list[+item.getAttribute('data-i')];
    if (!o) return;
    if (f === 'wd') o.wd[+el.getAttribute('data-d')] = el.checked;
    else o[f] = el.value;
    if (f === 'ev' && ev.type === 'change') {
      var i = +item.getAttribute('data-i');
      var tmp = document.createElement('div');
      tmp.innerHTML = trigHtml(o, i);
      item.parentNode.replaceChild(tmp.firstChild, item);
    }
    validateForm();
    changed();
  }

  function onFormClick(ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act="del"]') : null;
    if (!btn) return;
    var item = btn.closest('.hav-item');
    var list = item.getAttribute('data-list') === 't' ? form.triggers : form.conds;
    list.splice(+item.getAttribute('data-i'), 1);
    renderForm();
    changed();
  }

  function addTrigger(k) {
    if (form.triggers.length >= 20) return;
    if (k === 'time') form.triggers.push({ k: 'time', at: '08:00', wd: blankWd() });
    else if (k === 'pattern') form.triggers.push({ k: 'pattern', h: '', m: '/15', s: '' });
    else form.triggers.push({ k: 'sun', ev: 'sunrise', tw: 'civil', off: '', dir: 'before' });
    renderForm();
    changed();
  }

  function addCondition(k) {
    if (form.conds.length >= 20) return;
    if (k === 'time') form.conds.push({ k: 'time', after: '08:00', before: '20:00', wd: blankWd() });
    else form.conds.push({ k: 'sun', after: 'sunset', aoff: '-01:00', before: '', boff: '' });
    renderForm();
    changed();
  }

  // ── Results rendering ─────────────────────────────────────

  function readObs() {
    var lat = String(settings.lat).trim();
    var lon = String(settings.lon).trim();
    var elev = String(settings.elev).trim();
    if (lat === '' && lon === '') return { obs: null, error: '' };
    var la = pyFloat(lat);
    var lo = pyFloat(lon);
    var el = elev === '' ? 0 : pyFloat(elev);
    if (isNaN(la) || la < -90 || la > 90) return { obs: null, error: 'Latitude must be a number from -90 to 90 (it is ' + escapeHtml(lat || 'empty') + ').' };
    if (isNaN(lo) || lo < -180 || lo > 180) return { obs: null, error: 'Longitude must be a number from -180 to 180 (it is ' + escapeHtml(lon || 'empty') + ').' };
    if (isNaN(el)) return { obs: null, error: 'Elevation must be a number of metres (it is ' + escapeHtml(elev) + ').' };
    return { obs: { lat: la, lon: lo, elev: el }, error: '' };
  }

  function issueHtml(level, text, line) {
    var tag = level === 'error' ? 'Error' : (level === 'warn' ? 'Warning' : 'Note');
    var ln = line && mode === 'yaml' ? 'Line ' + line + ': ' : '';
    return '<li class="hav-issue hav-issue--' + level + '"><span class="hav-issue-tag">' + tag + '</span><span class="hav-issue-text">' + ln + text + '</span></li>';
  }

  function fmtWhen(ctx, run) {
    var p = wallParts(run.w);
    var abbr = zoneAbbr(ctx.zoneName, run.ms / 1000);
    var off = (abbr && !/^(GMT|UTC)/.test(abbr) ? abbr + ' · ' : '') + offsetLabel(run.offset);
    return { date: DAY_NAMES[p.wd] + ' ' + p.d + ' ' + MONTHS[p.m - 1], year: p.y, time: pad2(p.H) + ':' + pad2(p.M) + ':' + pad2(p.S), off: off, fold: run.fold || dtAmbiguous(ctx.zone, Math.floor(run.w), 0) };
  }

  function runReason(run) {
    if (run.status === 'fired') return '';
    var by = run.by ? condName(run.by) : '';
    if (run.status === 'blocked') return 'Blocked by condition ' + escapeHtml(by) + (run.why ? ': ' + escapeHtml(run.why) : '');
    return 'Depends on condition ' + escapeHtml(by) + (run.why ? ': ' + run.why : '');
  }

  var STATUS_TEXT = { fired: 'Runs', blocked: 'Blocked', unknown: 'Depends' };

  function runRowHtml(ctx, run, compact) {
    var w = fmtWhen(ctx, run);
    var trig = escapeHtml(triggerLabel(run.trig)) + (run.trig.id !== String(run.trig.idx) ? ' <span class="hav-muted">id ' + escapeHtml(run.trig.id) + '</span>' : '');
    var fold = w.fold ? ' <span class="hav-tag hav-tag--dst">' + (run.fold ? '2nd' : '1st') + ' ' + w.time.slice(0, 5) + '</span>' : '';
    return '<div class="hav-run hav-run--' + run.status + '">' +
      '<div class="hav-run-when"><span class="hav-run-date">' + w.date + (compact ? '' : ' ' + w.year) + '</span> <span class="hav-run-time">' + w.time + '</span> <span class="hav-run-off">' + escapeHtml(w.off) + '</span>' + fold + '</div>' +
      '<div class="hav-run-trig">' + trig + '</div>' +
      '<div class="hav-run-res"><span class="hav-badge hav-badge--' + run.status + '">' + STATUS_TEXT[run.status] + '</span>' + (run.status === 'fired' ? '' : '<span class="hav-run-why">' + runReason(run) + '</span>') + '</div></div>';
  }

  function cellClass(cell, hourInfo) {
    var cls = 'hav-cell';
    var total = cell.f + cell.b + cell.u;
    if (hourInfo.gap === 60) return cls + ' hav-cell--gap';
    if (!total) cls += ' hav-cell--none';
    else if (cell.f && !cell.b && !cell.u) cls += ' hav-cell--fired';
    else if (cell.b && !cell.f && !cell.u) cls += ' hav-cell--blocked';
    else if (cell.u && !cell.f && !cell.b) cls += ' hav-cell--unknown';
    else cls += ' hav-cell--mixed';
    if (hourInfo.rep) cls += ' hav-cell--rep';
    if (hourInfo.gap) cls += ' hav-cell--partial';
    return cls;
  }

  function renderTimeline(sim) {
    var el = $('hav-timeline');
    if (!el) return;
    var html = '<div class="hav-tl-corner" aria-hidden="true"></div>';
    for (var h = 0; h < 24; h++) html += '<div class="hav-tl-hour" aria-hidden="true">' + pad2(h) + '</div>';
    sim.days.forEach(function (di, d) {
      html += '<div class="hav-tl-day"><span class="hav-tl-dname">' + DAY_NAMES[di.wd] + '</span> <span class="hav-tl-ddate">' + di.d + ' ' + MONTHS[di.m - 1] + '</span></div>';
      for (var hh = 0; hh < 24; hh++) {
        var cell = sim.cells[d][hh];
        var hi = di.hours[hh];
        var total = cell.f + cell.b + cell.u;
        var label = DAY_LONG[di.wd] + ' ' + di.d + ' ' + MONTHS[di.m - 1] + ', ' + pad2(hh) + ':00 to ' + pad2((hh + 1) % 24) + ':00: ';
        if (hi.gap === 60) label += 'this hour does not exist (clocks go forward)';
        else {
          label += total ? [cell.f ? cell.f + (cell.f === 1 ? ' run goes through' : ' runs go through') : '', cell.b ? cell.b + ' blocked' : '', cell.u ? cell.u + (cell.u === 1 ? ' depends' : ' depend') + ' on a condition that is not simulated' : ''].filter(Boolean).join(', ') : 'no runs';
          if (hi.rep) label += ' (this hour happens twice, clocks go back)';
        }
        var txt = hi.gap === 60 ? '–' : (total ? (total > 99 ? '99+' : String(total)) : '');
        var sel = openCell && openCell.d === d && openCell.h === hh ? ' hav-cell--open' : '';
        html += '<button type="button" class="' + cellClass(cell, hi) + sel + '" data-d="' + d + '" data-h="' + hh + '" aria-label="' + attr(label) + '" title="' + attr(label) + '">' + txt + '</button>';
      }
    });
    el.innerHTML = html;
  }

  function renderCellDetail() {
    var el = $('hav-cell-detail');
    if (!el) return;
    if (!openCell || !last || !last.sim || !last.sim.cells[openCell.d]) { el.innerHTML = ''; el.classList.add('hav-hidden'); return; }
    var sim = last.sim;
    var di = sim.days[openCell.d];
    var cell = sim.cells[openCell.d][openCell.h];
    var hi = di.hours[openCell.h];
    var total = cell.f + cell.b + cell.u;
    var head = '<div class="hav-detail-head"><strong>' + DAY_LONG[di.wd] + ' ' + di.d + ' ' + MONTHS[di.m - 1] + ' ' + di.y + ', ' + pad2(openCell.h) + ':00–' + pad2((openCell.h + 1) % 24) + ':00</strong>' +
      '<button type="button" class="hav-icon-btn" onclick="havCloseCell()" aria-label="Close the hour details">&#10005;</button></div>';
    var body;
    if (hi.gap === 60) body = '<p class="hav-text">This hour does not exist on this day: the clocks go forward through it.</p>';
    else if (!total) body = '<p class="hav-text">No trigger fires in this hour.</p>';
    else {
      body = (hi.rep ? '<p class="hav-text">The clocks go back during this hour, so some of its minutes happen twice.</p>' : '') +
        '<div class="hav-runs">' + cell.runs.map(function (r) { return runRowHtml(last.ctx, r, true); }).join('') + '</div>' +
        (total > cell.runs.length ? '<p class="hav-hint">Showing the first ' + cell.runs.length + ' of ' + total.toLocaleString('en-US') + ' runs in this hour.</p>' : '');
    }
    el.innerHTML = head + body;
    el.classList.remove('hav-hidden');
  }

  function onTimelineClick(ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.hav-cell') : null;
    if (!b) return;
    var d = +b.getAttribute('data-d');
    var h = +b.getAttribute('data-h');
    openCell = openCell && openCell.d === d && openCell.h === h ? null : { d: d, h: h };
    if (last && last.sim) renderTimeline(last.sim);
    renderCellDetail();
  }

  function closeCell() {
    openCell = null;
    if (last && last.sim) renderTimeline(last.sim);
    renderCellDetail();
  }

  function nowWall(z) { return Math.floor(fromInstant(z, Date.now() / 1000).w / 60) * 60; }

  function wallToInput(w) {
    var p = wallParts(w);
    return p.y + '-' + pad2(p.m) + '-' + pad2(p.d) + 'T' + pad2(p.H) + ':' + pad2(p.M);
  }

  function inputToWall(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
    if (!m) return null;
    var y = +m[1];
    if (y < 1900 || y > 2200) return null;
    return daysFromCivil(y, +m[2], +m[3]) * 86400 + (+m[4]) * 3600 + (+m[5]) * 60;
  }

  function setHtml(id, html) { var el = $(id); if (el) el.innerHTML = html; }

  function renderEmpty(msg) {
    last = null;
    setHtml('hav-summary', '<p class="hav-empty">' + msg + '</p>');
    setHtml('hav-run-list', '');
    setHtml('hav-timeline', '');
    setHtml('hav-week-meta', '');
    setHtml('hav-notes', '');
    setHtml('hav-notsim', '');
    setHtml('hav-tl-note', '');
    var nsw = $('hav-notsim-wrap');
    if (nsw) nsw.classList.add('hav-hidden');
    openCell = null;
    renderCellDetail();
  }

  function recompute() {
    timer = null;
    var issues = [];
    var src = mode === 'form' ? formToYaml(form, settings.legacySun) : ($('hav-yaml') ? $('hav-yaml').value : '');
    if (mode === 'form' && $('hav-yaml-out')) $('hav-yaml-out').textContent = src;
    var z = getZone(settings.tz);
    var pick = $('hav-pick-wrap');
    if (!z) {
      setHtml('hav-issues', issueHtml('error', 'The time zone ' + code(settings.tz) + ' is not known to this browser. Pick one from the list.'));
      renderEmpty('Pick a time zone to see the schedule.');
      return;
    }
    if (mode === 'yaml' && !src.trim()) {
      setHtml('hav-issues', '');
      if (pick) pick.classList.add('hav-hidden');
      if ($('hav-to-form')) $('hav-to-form').disabled = true;
      renderEmpty('Paste an automation above, or load an example.');
      return;
    }
    var parsed = parseYaml(src);
    if (parsed.error) {
      setHtml('hav-issues', issueHtml('error', 'YAML: ' + escapeHtml(parsed.error.message), parsed.error.line));
      if (pick) pick.classList.add('hav-hidden');
      renderEmpty('Fix the YAML error above to see the schedule.');
      return;
    }
    parsed.warnings.forEach(function (w) { issues.push(issueHtml('warn', escapeHtml(w.msg), w.line)); });
    var found = findAutomations(parsed.root);
    if (found.error) {
      setHtml('hav-issues', issues.join('') + issueHtml('error', found.error === 'empty' ? 'There is nothing to simulate yet.' : found.error));
      if (pick) pick.classList.add('hav-hidden');
      renderEmpty('Paste an automation above, or load an example.');
      return;
    }
    if (pick) {
      if (found.items.length > 1) {
        if (yamlPick >= found.items.length) yamlPick = 0;
        $('hav-pick').innerHTML = found.items.map(function (it, i) { return '<option value="' + i + '"' + (i === yamlPick ? ' selected' : '') + '>' + escapeHtml((i + 1) + '. ' + it.label) + '</option>'; }).join('');
        pick.classList.remove('hav-hidden');
      } else {
        yamlPick = 0;
        pick.classList.add('hav-hidden');
      }
    }
    var item = found.items[Math.min(yamlPick, found.items.length - 1)];
    var model = analyzeAutomation(item.obj);
    if (model.errors.length) {
      issues.unshift(issueHtml('error', '<strong>Home Assistant would refuse to load this automation</strong> until the errors below are fixed. The runs shown skip the invalid parts.'));
    }
    model.errors.forEach(function (e) { issues.push(issueHtml('error', e.msg, e.line)); });
    model.warnings.forEach(function (e) { issues.push(issueHtml('warn', e.msg, e.line)); });
    if (mode === 'yaml' && model.oldKeys.length) {
      issues.push(issueHtml('info', 'Uses ' + model.oldKeys.map(function (k) { return code(k + ':'); }).join(', ') + ', the names from before Home Assistant 2024.10. They still work and are read as the plural ' + model.oldKeys.map(function (k) { return code(k + 's:'); }).join(', ') + '.'));
    }
    var platformCount = model.platformKeys || 0;
    if (mode === 'yaml' && platformCount) issues.push(issueHtml('info', platformCount + (platformCount === 1 ? ' trigger uses ' : ' triggers use ') + code('platform:') + ', the spelling from before 2024.10. Home Assistant still accepts it and renames it to ' + code('trigger:') + ' internally.'));
    model.info.forEach(function (e) { issues.push(issueHtml('info', e.msg, e.line)); });

    var lo = readObs();
    if (lo.error) issues.push(issueHtml('error', lo.error));
    var startWall = inputToWall(settings.start);
    if (startWall === null) startWall = nowWall(z);
    var startDays = Math.floor(startWall / 86400);
    var listFrom = toInstant(z, startWall, 0);
    var sim = simulate(model, { zoneName: settings.tz, obs: lo.obs, startDays: startDays, days: 7, listFromSec: listFrom, listLimit: settings.listLimit, listFilter: settings.listFilter });
    var ctx = sim.ctx;
    last = { model: model, sim: sim, ctx: ctx, alias: item.label };
    setHtml('hav-issues', issues.join(''));
    if ($('hav-to-form')) $('hav-to-form').disabled = mode !== 'yaml' || !modelToForm(model, model.alias);

    // Not simulated
    var ns = model.notSim.slice();
    sim.needsLocation.forEach(function (t) { ns.push({ what: 'Trigger #' + (t.idx + 1) + ' (' + t.platform + ')', why: 'enter your Home Assistant latitude and longitude above (or pick an example location) to simulate it' }); });
    if (!lo.obs && flattenConds(model.conditions, []).some(function (n) { return n.type === 'sun'; })) ns.push({ what: 'Sun conditions', why: 'they need your latitude and longitude; until then, runs that reach them are marked "depends"' });
    setHtml('hav-notsim', ns.map(function (x) { return '<li class="hav-note hav-note--ns"><strong>' + x.what + '</strong>: ' + x.why + '.</li>'; }).join(''));
    if ($('hav-notsim-wrap')) $('hav-notsim-wrap').classList.toggle('hav-hidden', !ns.length);

    // Notes
    var notes = buildNotes(model, sim, ctx);
    setHtml('hav-notes', notes.length ? notes.map(function (n) { return '<li class="hav-note hav-note--' + n.cls + '">' + n.html + '</li>'; }).join('') : '<li class="hav-note">Add a trigger to see how Home Assistant reads it.</li>');

    // Summary and list
    var fromP = wallParts(startWall);
    var fromTxt = DAY_NAMES[fromP.wd] + ' ' + fromP.d + ' ' + MONTHS[fromP.m - 1] + ' ' + fromP.y + ' ' + pad2(fromP.H) + ':' + pad2(fromP.M);
    var counts = { fired: 0, blocked: 0, unknown: 0 };
    sim.list.forEach(function (r) { counts[r.status]++; });
    var sum;
    if (!model.triggers.length) sum = 'No trigger in this automation can be simulated yet.';
    else if (!sim.list.length) sum = 'No ' + (settings.listFilter === 'fired' ? 'runs that go through' : 'runs') + ' found from ' + fromTxt + (sim.listStopped ? ' before the simulator stopped (it checked ' + MAX_STEPS.toLocaleString('en-US') + ' trigger times)' : ' within ' + LIST_HORIZON_DAYS + ' days') + '.';
    else {
      sum = (settings.listFilter === 'fired' ? 'Next ' + sim.list.length + ' runs that go through' : 'Next ' + sim.list.length + ' trigger runs') + ' from ' + fromTxt + ' (' + escapeHtml(settings.tz) + ')';
      var parts = [];
      if (counts.fired) parts.push(counts.fired + ' go through');
      if (counts.blocked) parts.push(counts.blocked + ' blocked by conditions');
      if (counts.unknown) parts.push(counts.unknown + ' depend on something not simulated');
      if (settings.listFilter !== 'fired') sum += ': ' + parts.join(', ');
      sum += '.';
      if (sim.list.length < settings.listLimit) sum += sim.listStopped ? ' The simulator stopped after checking ' + MAX_STEPS.toLocaleString('en-US') + ' trigger times.' : ' No more runs within ' + LIST_HORIZON_DAYS + ' days.';
    }
    setHtml('hav-summary', '<p class="hav-text">' + sum + '</p>');
    setHtml('hav-run-list', sim.list.map(function (r) { return runRowHtml(ctx, r, false); }).join(''));

    // Timeline
    var d0 = sim.days[0];
    var d6 = sim.days[sim.days.length - 1];
    var tot = sim.totals.fired + sim.totals.blocked + sim.totals.unknown;
    setHtml('hav-week-meta', escapeHtml(DAY_NAMES[d0.wd] + ' ' + d0.d + ' ' + MONTHS[d0.m - 1] + ' – ' + DAY_NAMES[d6.wd] + ' ' + d6.d + ' ' + MONTHS[d6.m - 1] + ' ' + d6.y) + ' · ' + tot.toLocaleString('en-US') + ' runs' +
      (tot ? ': ' + sim.totals.fired.toLocaleString('en-US') + ' go through, ' + sim.totals.blocked.toLocaleString('en-US') + ' blocked' + (sim.totals.unknown ? ', ' + sim.totals.unknown.toLocaleString('en-US') + ' depend' : '') : ''));
    var tlNote = '';
    if (sim.truncated !== null) {
      var tp = wallParts(fromInstant(z, sim.truncated / 1000).w);
      tlNote = '<p class="hav-hint hav-hint--warn">The timeline stops at ' + DAY_NAMES[tp.wd] + ' ' + tp.d + ' ' + MONTHS[tp.m - 1] + ' ' + pad2(tp.H) + ':' + pad2(tp.M) + ': this automation fires more than ' + MAX_WINDOW_RUNS.toLocaleString('en-US') + ' times in the week shown, and the simulator stops there to keep the page responsive.</p>';
    }
    setHtml('hav-tl-note', tlNote);
    if (openCell && !sim.cells[openCell.d]) openCell = null;
    renderTimeline(sim);
    renderCellDetail();
  }

  // ── Mode, settings and buttons ────────────────────────────

  function setMode(m) {
    mode = m === 'yaml' ? 'yaml' : 'form';
    var isY = mode === 'yaml';
    $('hav-panel-form').classList.toggle('hav-hidden', isY);
    $('hav-panel-yaml').classList.toggle('hav-hidden', !isY);
    $('hav-tab-form').classList.toggle('hav-active', !isY);
    $('hav-tab-yaml').classList.toggle('hav-active', isY);
    $('hav-tab-form').setAttribute('aria-selected', isY ? 'false' : 'true');
    $('hav-tab-yaml').setAttribute('aria-selected', isY ? 'true' : 'false');
    if ($('hav-out-card')) $('hav-out-card').classList.toggle('hav-hidden', isY);
    openCell = null;
    recompute();
  }

  function onSettingsInput(ev) {
    var el = ev.target;
    if (!el || !el.id) return;
    switch (el.id) {
      case 'hav-tz': settings.tz = el.value; break;
      case 'hav-lat': settings.lat = el.value; if ($('hav-loc-preset')) $('hav-loc-preset').value = ''; break;
      case 'hav-lon': settings.lon = el.value; if ($('hav-loc-preset')) $('hav-loc-preset').value = ''; break;
      case 'hav-elev': settings.elev = el.value; break;
      case 'hav-keep-loc': settings.keepLoc = el.checked; break;
      case 'hav-start': settings.start = el.value; break;
      case 'hav-list-limit': settings.listLimit = +el.value || 20; break;
      case 'hav-list-filter': settings.listFilter = el.value === 'fired' ? 'fired' : 'all'; break;
      case 'hav-legacy-sun': settings.legacySun = el.checked; break;
      case 'hav-loc-preset': {
        var L = LOCATIONS[el.value];
        if (!L) return;
        settings.lat = L.lat;
        settings.lon = L.lon;
        settings.elev = '0';
        if (getZone(L.tz)) settings.tz = L.tz;
        writeSettings();
        el.value = Object.keys(LOCATIONS).filter(function (k) { return LOCATIONS[k] === L; })[0];
        break;
      }
      default: return;
    }
    if (el.id === 'hav-lat' || el.id === 'hav-lon' || el.id === 'hav-elev' || el.id === 'hav-loc-preset') {
      var r = readObs();
      ['hav-lat', 'hav-lon', 'hav-elev'].forEach(function (id) { if ($(id)) $(id).classList.remove('hav-invalid'); });
      if (r.error) {
        var bad = /^Latitude/.test(r.error) ? 'hav-lat' : (/^Longitude/.test(r.error) ? 'hav-lon' : 'hav-elev');
        if ($(bad)) $(bad).classList.add('hav-invalid');
      }
    }
    changed();
  }

  function setStartNow() {
    settings.start = '';
    writeSettings();
    changed();
  }

  function loadExample() {
    var sel = $('hav-example');
    var ex = EXAMPLES[sel.value];
    if (!ex) return;
    $('hav-yaml').value = ex.yaml.join('\n') + '\n';
    yamlPick = 0;
    if (ex.tz && getZone(ex.tz)) { settings.tz = ex.tz; }
    if (ex.start) settings.start = ex.start;
    writeSettings();
    sel.value = '';
    openCell = null;
    changed();
  }

  function clearYaml() {
    $('hav-yaml').value = '';
    yamlPick = 0;
    schedule();
  }

  function yamlToForm() {
    if (!last || !last.model) return;
    var f = modelToForm(last.model, last.model.alias);
    if (!f) { showToast('This automation does not fit the form'); return; }
    form = f;
    renderForm();
    hashActive = true;
    writeHash();
    setMode('form');
  }

  function onPick(ev) {
    yamlPick = +ev.target.value || 0;
    openCell = null;
    schedule();
  }

  function resetAll() {
    form = defaultForm();
    settings = { tz: browserZone(), legacySun: false, listLimit: 20, listFilter: 'all', start: '', keepLoc: false, lat: '', lon: '', elev: '' };
    if (!getZone(settings.tz)) settings.tz = 'UTC';
    hashActive = false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    if ($('hav-loc-preset')) $('hav-loc-preset').value = '';
    writeSettings();
    renderForm();
    openCell = null;
    if (mode !== 'form') setMode('form'); else recompute();
  }

  // ── Clipboard and toast ───────────────────────────────────

  function showToast(msg) {
    var t = $('hav-toast');
    if (!t) return;
    t.textContent = msg || 'Copied';
    t.classList.add('hav-show');
    setTimeout(function () { t.classList.remove('hav-show'); }, 2000);
  }

  function copyText(text, msg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      showToast(msg);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast(msg); }, fallback);
    } else {
      fallback();
    }
  }

  function copyYaml() { copyText(formToYaml(form, settings.legacySun), 'YAML copied'); }

  function copyLink() {
    hashActive = true;
    writeHash();
    copyText(location.href.split('#')[0] + encodeState(form, settings), mode === 'yaml' ? 'Link copied (form and settings, not the pasted YAML)' : 'Link copied');
  }

  // ── Init ──────────────────────────────────────────────────

  function init() {
    var wrap = $('hav-wrapper');
    if (!wrap) return;
    var st = decodeState(location.hash);
    if (st) {
      form = st.form;
      settings = Object.assign(settings, st.settings);
      hashActive = true;
    }
    if (!settings.tz || !getZone(settings.tz)) settings.tz = browserZone();
    if (!getZone(settings.tz)) settings.tz = 'UTC';
    fillZones();
    fillStatic();
    writeSettings();
    renderForm();
    var fp = $('hav-panel-form');
    fp.addEventListener('input', onFormInput);
    fp.addEventListener('change', onFormInput);
    fp.addEventListener('click', onFormClick);
    var sp = $('hav-settings');
    sp.addEventListener('input', onSettingsInput);
    sp.addEventListener('change', onSettingsInput);
    ['hav-start', 'hav-list-limit', 'hav-list-filter', 'hav-legacy-sun'].forEach(function (id) {
      var el = $(id);
      if (el) { el.addEventListener('change', onSettingsInput); el.addEventListener('input', onSettingsInput); }
    });
    $('hav-yaml').addEventListener('input', function () { openCell = null; schedule(); });
    $('hav-pick').addEventListener('change', onPick);
    $('hav-example').addEventListener('change', loadExample);
    $('hav-timeline').addEventListener('click', onTimelineClick);
    window.addEventListener('hashchange', function () {
      var s2 = decodeState(location.hash);
      if (!s2) return;
      form = s2.form;
      settings = Object.assign(settings, s2.settings);
      if (!getZone(settings.tz)) settings.tz = browserZone();
      writeSettings();
      renderForm();
      recompute();
    });
    recompute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Global handlers for onclick attributes
  window.havSetMode = setMode;
  window.havAddTrigger = addTrigger;
  window.havAddCondition = addCondition;
  window.havCopyYaml = copyYaml;
  window.havCopyLink = copyLink;
  window.havReset = resetAll;
  window.havStartNow = setStartNow;
  window.havClearYaml = clearYaml;
  window.havYamlToForm = yamlToForm;
  window.havCloseCell = closeCell;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      HA_VERSION: HA_VERSION,
      ASTRAL_VERSION: ASTRAL_VERSION,
      WEEKDAYS: WEEKDAYS,
      pyInt: pyInt,
      pyFloat: pyFloat,
      daysFromCivil: daysFromCivil,
      civilFromDays: civilFromDays,
      weekdayOfDays: weekdayOfDays,
      wallParts: wallParts,
      getZone: getZone,
      offsetAt: offsetAt,
      utcoffset: utcoffset,
      toInstant: toInstant,
      fromInstant: fromInstant,
      dtExists: dtExists,
      dtAmbiguous: dtAmbiguous,
      dstOffsetDiff: dstOffsetDiff,
      lowerBound: lowerBound,
      parseTimeExpression: parseTimeExpression,
      findNextTimeExpression: findNextTimeExpression,
      nextPatternInstant: nextPatternInstant,
      julianday: julianday,
      astralEvent: astralEvent,
      timeOfTransit: timeOfTransit,
      missingEventKind: missingEventKind,
      sunEventNext: sunEventNext,
      sunConditionCheck: sunConditionCheck,
      parseTimeHA: parseTimeHA,
      timePeriod: timePeriod,
      fmtDuration: fmtDuration,
      humanDuration: humanDuration,
      parseYaml: parseYaml,
      resolvePlain: resolvePlain,
      Tagged: Tagged,
      metaOf: metaOf,
      findAutomations: findAutomations,
      analyzeAutomation: analyzeAutomation,
      timeConditionCheck: timeConditionCheck,
      evalConditions: evalConditions,
      makeCtx: makeCtx,
      simulate: simulate,
      findTransitions: findTransitions,
      triggerLabel: triggerLabel,
      buildNotes: buildNotes,
      describeCondition: describeCondition,
      explainPattern: explainPattern,
      defaultForm: defaultForm,
      formToYaml: formToYaml,
      modelToForm: modelToForm,
      encodeState: encodeState,
      decodeState: decodeState,
      EXAMPLES: EXAMPLES,
      LOCATIONS: LOCATIONS
    };
  }
})();
