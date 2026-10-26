/* Homelab Power Cost Calculator — script.js
   Prefix: hpc-
   Turns a device list (idle and load watts, share of time at load, how long
   each device runs per day) and an electricity tariff (single rate or
   day/night) into kWh and cost per day, month and year, per device and in
   total, and works out the payback time of a lower-power replacement.
   No dependencies and no network calls: the whole setup lives in the URL hash. */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Assumptions (the page lists every one of them) ─────────────────────

  var DAYS_PER_YEAR = 365;                                // leap days are ignored
  var MONTHS_PER_YEAR = 12;
  var DAYS_PER_MONTH = DAYS_PER_YEAR / MONTHS_PER_YEAR;   // 30.4167, an average month
  var MINUTES_PER_DAY = 1440;
  var MAX_DEVICES = 50;
  var MAX_NAME = 60;
  var MAX_FIELD = 24;
  var PAYBACK_YEARS = [1, 3, 5];
  var MODES = ['always', 'hours', 'window'];
  var MODE_CODES = { always: 'a', hours: 'h', window: 'w' };

  // Sanity limits: anything above them is almost certainly a typo.
  var LIMITS = {
    watts: 100000,      // per unit
    qty: 1000,
    price: 100000,      // per kWh, high enough for currencies with small units
    money: 1000000000
  };

  // ── Parsing ────────────────────────────────────────────────────────────

  // "1,444" could be a thousands separator or a decimal comma, so it is refused.
  function isAmbiguousComma(s) {
    return /^[+-]?[1-9][0-9]{0,2},[0-9]{3}$/.test(s);
  }

  // A finite number, null for an empty field, or NaN when the text is not a
  // plain decimal number. A single comma is read as the decimal separator.
  function parseNumber(text) {
    if (text === null || text === undefined) return null;
    var s = String(text).trim();
    if (s === '') return null;
    if (isAmbiguousComma(s)) return NaN;
    if (s.indexOf(',') !== -1) {
      if (s.indexOf('.') !== -1 || s.split(',').length > 2) return NaN;
      s = s.replace(',', '.');
    }
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  // "HH:MM" (24-hour clock) to minutes after midnight, or NaN.
  function parseTime(text) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(text === null || text === undefined ? '' : text).trim());
    if (!m) return NaN;
    var h = Number(m[1]);
    var min = Number(m[2]);
    if (h > 23 || min > 59) return NaN;
    return h * 60 + min;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function formatTime(minutes) {
    var m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  // ── Clock windows ──────────────────────────────────────────────────────

  // Splits a clock window [start, end) into segments inside one day. An end
  // earlier than the start means the window runs past midnight; start === end
  // is an empty window.
  function windowSegments(start, end) {
    if (start === end) return [];
    if (end > start) return [[start, end]];
    var segs = [[start, MINUTES_PER_DAY]];
    if (end > 0) segs.push([0, end]);
    return segs;
  }

  function windowMinutes(start, end) {
    return windowSegments(start, end).reduce(function (sum, s) { return sum + s[1] - s[0]; }, 0);
  }

  // Minutes two daily clock windows have in common.
  function overlapWindows(aStart, aEnd, bStart, bEnd) {
    var a = windowSegments(aStart, aEnd);
    var b = windowSegments(bStart, bEnd);
    var total = 0;
    a.forEach(function (x) {
      b.forEach(function (y) {
        total += Math.max(0, Math.min(x[1], y[1]) - Math.max(x[0], y[0]));
      });
    });
    return total;
  }

  // ── Validation ─────────────────────────────────────────────────────────

  // Number as text for messages: no grouping, at most 6 decimals.
  function plainNum(n) {
    var x = Math.round(n * 1e6) / 1e6;
    return String(x === 0 ? 0 : x);
  }

  function limitText(n) {
    return new Intl.NumberFormat('en-US').format(n);
  }

  // Checks one numeric field. o: label, required, emptyHint, fallback, min,
  // max, unit, integer, example. Returns { value, error }.
  function checkNumber(text, o) {
    var n = parseNumber(text);
    var unit = o.unit || '';
    if (n === null) {
      if (o.required) return { value: NaN, error: o.label + ' is empty. ' + o.emptyHint };
      return { value: o.fallback, error: null };
    }
    if (isNaN(n) && isAmbiguousComma(String(text).trim())) {
      var t = String(text).trim();
      return { value: NaN, error: o.label + ' "' + t + '" could mean ' + t.replace(',', '') + ' or ' + t.replace(',', '.') + '. Type it without the comma, or with a dot for decimals.' };
    }
    if (isNaN(n)) {
      return { value: NaN, error: o.label + ' "' + String(text).trim() + '" is not a number. Type digits, with a dot or a comma for decimals, for example ' + o.example + '.' };
    }
    if (o.integer && Math.floor(n) !== n) {
      return { value: NaN, error: o.label + ' ' + plainNum(n) + ' is not a whole number. Type a count such as ' + o.example + '.' };
    }
    if (n < o.min) {
      return { value: NaN, error: o.label + ' ' + plainNum(n) + unit + ' is negative. Type 0 or more.' };
    }
    if (n > o.max) {
      return { value: NaN, error: o.label + ' ' + plainNum(n) + unit + ' is above the limit of ' + limitText(o.max) + unit + '. Check it for a typo.' };
    }
    return { value: n, error: null };
  }

  function checkTime(text, label, example) {
    var s = String(text === null || text === undefined ? '' : text).trim();
    if (s === '') return { value: NaN, error: label + ' is empty. Pick a time such as ' + (example || '23:00') + '.' };
    var t = parseTime(s);
    if (isNaN(t)) return { value: NaN, error: label + ' "' + s + '" is not a time. Use the 24-hour HH:MM format, for example 07:00.' };
    return { value: t, error: null };
  }

  function collector(out) {
    return function (field, res) {
      if (res.error) out.errors.push({ field: field, text: res.error });
      return res.value;
    };
  }

  // A device row with neither idle nor load watts is "empty": it is left out
  // of the totals without an error, so a freshly added row does not shout.
  function validateDevice(raw) {
    var out = { empty: false, errors: [], warnings: [], value: null };
    if (parseNumber(raw.idle) === null && parseNumber(raw.load) === null) {
      out.empty = true;
      return out;
    }
    var take = collector(out);
    var qty = take('qty', checkNumber(raw.qty, { label: 'Quantity', min: 0, max: LIMITS.qty, integer: true, fallback: 1, example: '2' }));
    var idle = take('idle', checkNumber(raw.idle, {
      label: 'Idle watts', required: true, min: 0, max: LIMITS.watts, unit: ' W', example: '12.5',
      emptyHint: 'Type the reading while the device is idle, or the same value as load watts if its draw is steady.'
    }));
    var load = take('load', checkNumber(raw.load, { label: 'Load watts', min: 0, max: LIMITS.watts, unit: ' W', fallback: idle, example: '45' }));
    var pct = take('pct', checkNumber(raw.pct, { label: 'Time at load', min: 0, max: 100, unit: '%', fallback: 0, example: '20' }));
    var mode = MODES.indexOf(raw.mode) === -1 ? 'always' : raw.mode;
    var hours = 24;
    var start = 0;
    var end = 0;
    if (mode === 'hours') {
      hours = take('hours', checkNumber(raw.hours, {
        label: 'Hours per day', required: true, min: 0, max: 24, unit: ' h', example: '8',
        emptyHint: 'Type how many hours a day it runs, for example 8.'
      }));
    } else if (mode === 'window') {
      start = take('start', checkTime(raw.start, 'Start time'));
      end = take('end', checkTime(raw.end, 'End time', '07:00'));
      if (!isNaN(start) && !isNaN(end) && start === end) {
        out.errors.push({ field: 'end', text: 'Start and end are both ' + formatTime(start) + ', so the window has no length. For a device that never switches off, choose Always on.' });
      }
    }
    if (out.errors.length) return out;
    if (load < idle) {
      out.warnings.push({ field: 'load', text: 'Load watts (' + plainNum(load) + ' W) are lower than idle watts (' + plainNum(idle) + ' W). Check that the two readings are not swapped.' });
    }
    if (qty === 0) {
      out.warnings.push({ field: 'qty', text: 'Quantity is 0, so this row adds nothing to the totals.' });
    }
    out.value = { qty: qty, idle: idle, load: load, pct: pct, mode: mode, hours: hours, start: start, end: end };
    return out;
  }

  function validateTariff(s) {
    var out = { errors: [], warnings: [], value: null };
    var take = collector(out);
    if (s.tariffType === 'tou') {
      var day = take('dayPrice', checkNumber(s.dayPrice, {
        label: 'Standard price', required: true, min: 0, max: LIMITS.price, example: '0.35',
        emptyHint: 'Type the price per kWh outside the cheap window, for example 0.35.'
      }));
      var night = take('nightPrice', checkNumber(s.nightPrice, {
        label: 'Cheap-rate price', required: true, min: 0, max: LIMITS.price, example: '0.15',
        emptyHint: 'Type the price per kWh inside the cheap window, for example 0.15.'
      }));
      var cs = take('cheapStart', checkTime(s.cheapStart, 'Cheap window start'));
      var ce = take('cheapEnd', checkTime(s.cheapEnd, 'Cheap window end', '07:00'));
      if (!isNaN(cs) && !isNaN(ce) && cs === ce) {
        out.errors.push({ field: 'cheapEnd', text: 'The cheap window starts and ends at ' + formatTime(cs) + ', so it has no length. Set the hours your supplier bills at the cheap rate, for example 23:00 to 07:00, or switch to a single rate.' });
      }
      if (out.errors.length) return out;
      if (night > day) {
        out.warnings.push({ field: 'nightPrice', text: 'The cheap-rate price (' + plainNum(night) + ') is higher than the standard price (' + plainNum(day) + '). Check that the two prices are not swapped.' });
      }
      out.value = { type: 'tou', dayPrice: day, nightPrice: night, cheapStart: cs, cheapEnd: ce, cheapMinutes: windowMinutes(cs, ce) };
      return out;
    }
    var price = take('price', checkNumber(s.price, {
      label: 'Price per kWh', required: true, min: 0, max: LIMITS.price, example: '0.30',
      emptyHint: 'Type the price per kWh from your bill, for example 0.30.'
    }));
    if (out.errors.length) return out;
    out.value = { type: 'single', price: price, cheapMinutes: 0 };
    return out;
  }

  // A fixed charge (standing charge, monthly fee) goes into the totals only,
  // never into a device's cost or share.
  function fixedCharge(s) {
    var res = checkNumber(s.fixed, { label: 'Fixed charge', min: 0, max: LIMITS.money, fallback: 0, example: '9.50' });
    if (res.error) return { error: res.error, amount: 0, perDay: 0, perMonth: 0, perYear: 0 };
    var a = res.value;
    if (s.fixedPeriod === 'day') {
      return { error: null, amount: a, perDay: a, perMonth: a * DAYS_PER_MONTH, perYear: a * DAYS_PER_YEAR };
    }
    return { error: null, amount: a, perDay: a * MONTHS_PER_YEAR / DAYS_PER_YEAR, perMonth: a, perYear: a * MONTHS_PER_YEAR };
  }

  // ── Energy and cost ────────────────────────────────────────────────────

  // Average draw while the device is on: the load share is spread evenly.
  function averageWatts(idle, load, pct) {
    return idle + (load - idle) * (pct / 100);
  }

  // Price per kWh of a load that draws the same power all day.
  function blendedPrice(tariff) {
    if (tariff.type !== 'tou') return tariff.price;
    var cheap = tariff.cheapMinutes;
    return (tariff.dayPrice * (MINUTES_PER_DAY - cheap) + tariff.nightPrice * cheap) / MINUTES_PER_DAY;
  }

  // d: validated device. tariff: validated tariff or null (costs are null then).
  function deviceEnergy(d, tariff) {
    var avgW = averageWatts(d.idle, d.load, d.pct);
    var tou = !!tariff && tariff.type === 'tou';
    var cheapDay = tou ? tariff.cheapMinutes : 0;
    var onMin;
    var cheapMin;
    if (d.mode === 'hours') {
      // Hours per day are assumed to be spread evenly over the day.
      onMin = d.hours * 60;
      cheapMin = onMin * cheapDay / MINUTES_PER_DAY;
    } else if (d.mode === 'window') {
      onMin = windowMinutes(d.start, d.end);
      cheapMin = tou ? overlapWindows(d.start, d.end, tariff.cheapStart, tariff.cheapEnd) : 0;
    } else {
      onMin = MINUTES_PER_DAY;
      cheapMin = cheapDay;
    }
    var kwhDay = avgW * d.qty * onMin / 60000;
    var cheapKwhDay = avgW * d.qty * cheapMin / 60000;
    var stdKwhDay = avgW * d.qty * (onMin - cheapMin) / 60000;
    var costDay = null;
    if (tariff) {
      costDay = tou ? stdKwhDay * tariff.dayPrice + cheapKwhDay * tariff.nightPrice : kwhDay * tariff.price;
    }
    return {
      avgW: avgW,
      avgWTotal: avgW * d.qty,
      hoursOn: onMin / 60,
      cheapHours: cheapMin / 60,
      kwhDay: kwhDay,
      kwhMonth: kwhDay * DAYS_PER_MONTH,
      kwhYear: kwhDay * DAYS_PER_YEAR,
      cheapKwhDay: cheapKwhDay,
      stdKwhDay: stdKwhDay,
      costDay: costDay,
      costMonth: costDay === null ? null : costDay * DAYS_PER_MONTH,
      costYear: costDay === null ? null : costDay * DAYS_PER_YEAR
    };
  }

  function displayName(raw, i) {
    var n = String(raw.name || '').trim();
    return n || 'Device ' + (i + 1);
  }

  function deviceLabel(raw, i) {
    var n = String(raw.name || '').trim();
    return 'Device ' + (i + 1) + (n ? ' "' + n + '"' : '');
  }

  function compute(s) {
    var t = validateTariff(s);
    var tariff = t.value;
    var fixed = fixedCharge(s);
    var totals = { rows: 0, units: 0, kwhDay: 0, cheapKwhDay: 0, costDay: tariff ? 0 : null };
    var devices = (s.devices || []).map(function (raw, i) {
      var v = validateDevice(raw);
      var item = {
        index: i,
        name: displayName(raw, i),
        label: deviceLabel(raw, i),
        status: v.empty ? 'empty' : (v.errors.length ? 'error' : 'ok'),
        errors: v.errors,
        warnings: v.warnings,
        input: v.value,
        energy: null,
        shareCost: null,
        shareKwh: null
      };
      if (item.status === 'ok') {
        var e = deviceEnergy(v.value, tariff);
        item.energy = e;
        totals.rows += 1;
        totals.units += v.value.qty;
        totals.kwhDay += e.kwhDay;
        totals.cheapKwhDay += e.cheapKwhDay;
        if (tariff) totals.costDay += e.costDay;
      }
      return item;
    });
    totals.kwhMonth = totals.kwhDay * DAYS_PER_MONTH;
    totals.kwhYear = totals.kwhDay * DAYS_PER_YEAR;
    totals.avgW24 = totals.kwhDay * 1000 / 24;
    totals.cheapShare = totals.kwhDay > 0 ? totals.cheapKwhDay / totals.kwhDay : null;
    totals.costMonth = tariff ? totals.costDay * DAYS_PER_MONTH : null;
    totals.costYear = tariff ? totals.costDay * DAYS_PER_YEAR : null;
    totals.grandDay = tariff ? totals.costDay + fixed.perDay : null;
    totals.grandMonth = tariff ? totals.costMonth + fixed.perMonth : null;
    totals.grandYear = tariff ? totals.costYear + fixed.perYear : null;
    devices.forEach(function (d) {
      if (d.status !== 'ok') return;
      d.shareKwh = totals.kwhDay > 0 ? d.energy.kwhDay / totals.kwhDay : null;
      d.shareCost = tariff && totals.costDay > 0 ? d.energy.costDay / totals.costDay : null;
    });
    return {
      tariff: tariff,
      tariffErrors: t.errors,
      tariffWarnings: t.warnings,
      blended: tariff ? blendedPrice(tariff) : null,
      fixed: fixed,
      devices: devices,
      totals: totals,
      excluded: devices.filter(function (d) { return d.status === 'error'; }),
      empty: devices.filter(function (d) { return d.status === 'empty'; }),
      payback: computePayback(s.pb || {}, tariff)
    };
  }

  // ── Payback of a replacement machine ───────────────────────────────────

  function paybackMath(oldW, newW, hours, price, resale, pricePerKwh) {
    var savedW = oldW - newW;
    var kwhYear = savedW * hours * DAYS_PER_YEAR / 1000;
    var savingYear = kwhYear * pricePerKwh;
    var savingMonth = savingYear / MONTHS_PER_YEAR;
    var netCost = price - resale;
    var r = {
      oldW: oldW, newW: newW, hours: hours, price: price, resale: resale, pricePerKwh: pricePerKwh,
      savedW: savedW, kwhYear: kwhYear, savingYear: savingYear, savingMonth: savingMonth,
      netCost: netCost, months: null, reason: 'ok', net: {}
    };
    PAYBACK_YEARS.forEach(function (y) { r.net[y] = savingYear * y - netCost; });
    if (savedW <= 0) r.reason = 'not-lower';
    else if (hours === 0) r.reason = 'no-hours';
    else if (pricePerKwh === 0) r.reason = 'free-power';
    else if (netCost <= 0) { r.reason = 'immediate'; r.months = 0; }
    else r.months = netCost / savingMonth;
    return r;
  }

  function computePayback(pb, tariff) {
    var out = { status: 'empty', errors: [], value: null };
    if (parseNumber(pb.oldW) === null && parseNumber(pb.newW) === null) return out;
    var take = collector(out);
    var oldW = take('oldW', checkNumber(pb.oldW, {
      label: 'Old machine watts', required: true, min: 0, max: LIMITS.watts, unit: ' W', example: '60',
      emptyHint: 'Type its average watts, for example 60.'
    }));
    var newW = take('newW', checkNumber(pb.newW, {
      label: 'New machine watts', required: true, min: 0, max: LIMITS.watts, unit: ' W', example: '15',
      emptyHint: 'Type its average watts, for example 15.'
    }));
    var hours = take('hours', checkNumber(pb.hours, { label: 'Hours per day', min: 0, max: 24, unit: ' h', fallback: 24, example: '24' }));
    var price = take('price', checkNumber(pb.price, {
      label: 'New machine price', required: true, min: 0, max: LIMITS.money, example: '300',
      emptyHint: 'Type what the replacement costs, for example 300.'
    }));
    var resale = take('resale', checkNumber(pb.resale, { label: 'Money back for the old machine', min: 0, max: LIMITS.money, fallback: 0, example: '50' }));
    if (out.errors.length) {
      out.status = 'error';
      return out;
    }
    if (!tariff) {
      out.status = 'no-tariff';
      return out;
    }
    out.status = 'ok';
    out.value = paybackMath(oldW, newW, hours, price, resale, blendedPrice(tariff));
    return out;
  }

  // ── Formatting ─────────────────────────────────────────────────────────

  // Rounds the way you would on paper: float noise is dropped first (15
  // significant digits), so 9.854999999999999 (118.26 / 12) gives 9.86.
  function decimalRound(v, d) {
    if (!isFinite(v)) return v;
    var x = Number(Number(v).toPrecision(15));
    var a = Math.abs(x);
    var r;
    if (a * Math.pow(10, d) >= 1e21 || (a !== 0 && a < 1e-6)) r = Math.round(a * Math.pow(10, d)) / Math.pow(10, d);
    else r = Number(Math.round(Number(a + 'e' + d)) + 'e-' + d);
    return r === 0 ? 0 : (x < 0 ? -r : r);
  }

  function formatNumber(v, locale, maxD, minD) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (Math.abs(v) < 0.5 * Math.pow(10, -maxD)) v = 0;   // no "-0"
    v = decimalRound(v, maxD);
    return new Intl.NumberFormat(locale, { minimumFractionDigits: minD || 0, maximumFractionDigits: maxD }).format(v);
  }

  // More decimals for small energy values, fewer for large ones.
  function kwhDigits(v) {
    var a = Math.abs(v);
    if (a === 0) return 0;
    if (a < 1) return 3;
    if (a < 10) return 2;
    if (a < 100) return 1;
    return 0;
  }

  function formatKwh(v, locale) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var d = kwhDigits(v);
    return formatNumber(v, locale, d, d);
  }

  function formatWatts(v, locale) { return formatNumber(v, locale, 1, 0); }

  function formatHours(v, locale) { return formatNumber(v, locale, 2, 0); }

  function formatPct(fraction, locale) {
    if (fraction === null || fraction === undefined || !isFinite(fraction)) return '—';
    return formatNumber(fraction * 100, locale, 1, 1) + '%';
  }

  function formatMonths(m, locale) { return formatNumber(m, locale, 1, 1); }

  // Three ASCII letters are an ISO 4217 code formatted by Intl.NumberFormat;
  // anything else is a plain symbol (one character before the amount, longer
  // ones after it).
  function currencyInfo(currency, locale) {
    var cur = String(currency === null || currency === undefined ? '' : currency).trim();
    if (/^[A-Za-z]{3}$/.test(cur)) {
      try {
        var code = cur.toUpperCase();
        var nf = new Intl.NumberFormat(locale, { style: 'currency', currency: code });
        return { iso: true, code: code, symbol: cur, digits: nf.resolvedOptions().maximumFractionDigits };
      } catch (e) {
        // not accepted by this browser: fall back to a plain symbol
      }
    }
    return { iso: false, code: '', symbol: cur, digits: 2 };
  }

  function formatMoney(amount, currency, locale, extraDigits) {
    if (amount === null || amount === undefined || !isFinite(amount)) return '—';
    var info = currencyInfo(currency, locale);
    var minD = info.digits;
    var maxD = extraDigits ? Math.max(info.digits, extraDigits) : info.digits;
    var smallest = Math.pow(10, -maxD);
    if (Math.abs(amount) < smallest / 2) {
      if (amount > 0) return '< ' + formatMoney(smallest, currency, locale, extraDigits);
      amount = 0;
    }
    amount = decimalRound(amount, maxD);
    if (info.iso) {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: info.code, minimumFractionDigits: minD, maximumFractionDigits: maxD }).format(amount);
    }
    var num = new Intl.NumberFormat(locale, { minimumFractionDigits: minD, maximumFractionDigits: maxD }).format(Math.abs(amount));
    var sign = amount < 0 ? '-' : '';
    if (!info.symbol) return sign + num;
    if (Array.from(info.symbol).length === 1) return sign + info.symbol + num;
    return sign + num + ' ' + info.symbol;
  }

  // Prices per kWh keep up to 4 decimals (0.2834 stays 0.2834).
  function formatPrice(v, currency, locale) { return formatMoney(v, currency, locale, 4); }

  function runsText(d, locale, ascii) {
    if (d.mode === 'hours') return formatHours(d.hours, locale) + ' h per day';
    if (d.mode === 'window') return formatTime(d.start) + (ascii ? '-' : '–') + formatTime(d.end);
    return 'always on';
  }

  function tariffText(r, cur, locale) {
    var t = r.tariff;
    if (!t) return 'not set';
    if (t.type === 'single') return formatPrice(t.price, cur, locale) + ' per kWh, single rate';
    return formatPrice(t.dayPrice, cur, locale) + ' per kWh standard, ' + formatPrice(t.nightPrice, cur, locale) +
      ' per kWh from ' + formatTime(t.cheapStart) + ' to ' + formatTime(t.cheapEnd) +
      ' (' + formatHours(t.cheapMinutes / 60, locale) + ' h a day at the cheap rate)';
  }

  // ── URL hash state ─────────────────────────────────────────────────────

  function emptyDevice() {
    return { name: '', qty: '1', idle: '', load: '', pct: '', mode: 'always', hours: '', start: '', end: '' };
  }

  // The example rows are placeholders with round numbers, not measurements;
  // their names say so and the page asks for real wall readings.
  function defaultState() {
    return {
      currency: 'EUR',
      tariffType: 'single',
      price: '0.30',
      dayPrice: '',
      nightPrice: '',
      cheapStart: '23:00',
      cheapEnd: '07:00',
      fixed: '',
      fixedPeriod: 'month',
      devices: [
        { name: 'Server (example)', qty: '1', idle: '30', load: '80', pct: '10', mode: 'always', hours: '', start: '', end: '' },
        { name: 'Network switch (example)', qty: '2', idle: '6', load: '', pct: '', mode: 'always', hours: '', start: '', end: '' },
        { name: 'Backup NAS (example)', qty: '1', idle: '20', load: '35', pct: '50', mode: 'window', hours: '', start: '01:00', end: '03:00' }
      ],
      pb: { oldW: '', newW: '', hours: '24', price: '', resale: '' }
    };
  }

  function blankState() {
    var s = defaultState();
    ['currency', 'price', 'cheapStart', 'cheapEnd'].forEach(function (k) { s[k] = ''; });
    s.devices = [];
    s.pb = { oldW: '', newW: '', hours: '', price: '', resale: '' };
    return s;
  }

  var DEVICE_FIELDS = ['name', 'qty', 'idle', 'load', 'pct', 'mode', 'hours', 'start', 'end'];
  var HASH_KEYS = {
    cur: 'currency', p: 'price', pd: 'dayPrice', pn: 'nightPrice', cs: 'cheapStart', ce: 'cheapEnd', fc: 'fixed'
  };
  var PB_KEYS = { bo: 'oldW', bn: 'newW', bh: 'hours', bp: 'price', br: 'resale' };

  function encodeHash(s) {
    var parts = ['v=1'];
    function add(k, v) {
      if (v !== undefined && v !== null && String(v) !== '') parts.push(k + '=' + encodeURIComponent(String(v)));
    }
    Object.keys(HASH_KEYS).forEach(function (k) { add(k, s[HASH_KEYS[k]]); });
    add('tt', s.tariffType === 'tou' ? 't' : 's');
    add('fp', s.fixedPeriod === 'day' ? 'd' : 'm');
    (s.devices || []).forEach(function (d) {
      parts.push('d=' + DEVICE_FIELDS.map(function (f) {
        var v = f === 'mode' ? (MODE_CODES[d.mode] || 'a') : String(d[f] === undefined || d[f] === null ? '' : d[f]);
        return encodeURIComponent(v);
      }).join(','));
    });
    var pb = s.pb || {};
    Object.keys(PB_KEYS).forEach(function (k) { add(k, pb[PB_KEYS[k]]); });
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
    var s = blankState();
    var text = String(hash).replace(/^#/, '');
    text.split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq <= 0) return;
      var key = pair.slice(0, eq);
      var raw = pair.slice(eq + 1);
      if (key === 'd') {
        if (s.devices.length >= MAX_DEVICES) return;
        var f = raw.split(',').map(safeDecode);
        var d = emptyDevice();
        DEVICE_FIELDS.forEach(function (name, idx) {
          var v = f[idx] === undefined ? '' : f[idx];
          if (name === 'mode') {
            d.mode = v === 'h' ? 'hours' : (v === 'w' ? 'window' : 'always');
          } else {
            d[name] = clip(v, name === 'name' ? MAX_NAME : MAX_FIELD);
          }
        });
        s.devices.push(d);
        return;
      }
      var v = safeDecode(raw);
      if (HASH_KEYS[key]) s[HASH_KEYS[key]] = clip(v, key === 'cur' ? 8 : MAX_FIELD);
      else if (PB_KEYS[key]) s.pb[PB_KEYS[key]] = clip(v, MAX_FIELD);
      else if (key === 'tt') s.tariffType = v === 't' ? 'tou' : 'single';
      else if (key === 'fp') s.fixedPeriod = v === 'd' ? 'day' : 'month';
    });
    return s;
  }

  // ── Plain-text summary and CSV ─────────────────────────────────────────

  function buildSummary(r, s, locale, link) {
    var cur = s.currency;
    var t = r.totals;
    var money = function (v) { return formatMoney(v, cur, locale); };
    var lines = ['Homelab power cost', 'Electricity: ' + tariffText(r, cur, locale)];
    lines.push('Devices: ' + t.rows + (t.rows === 1 ? ' row, ' : ' rows, ') + t.units + (t.units === 1 ? ' unit' : ' units'));
    lines.push('Average draw: ' + formatWatts(t.avgW24, locale) + ' W (24-hour average)');
    lines.push('Energy: ' + formatKwh(t.kwhDay, locale) + ' kWh a day, ' + formatKwh(t.kwhMonth, locale) + ' kWh a month, ' + formatKwh(t.kwhYear, locale) + ' kWh a year');
    if (r.tariff && r.tariff.type === 'tou' && t.cheapShare !== null) {
      lines.push('At the cheap rate: ' + formatPct(t.cheapShare, locale) + ' of the energy');
    }
    if (r.tariff) {
      lines.push('Electricity cost: ' + money(t.costDay) + ' a day, ' + money(t.costMonth) + ' a month, ' + money(t.costYear) + ' a year');
      if (r.fixed.amount > 0) {
        lines.push('Fixed charge: ' + money(r.fixed.amount) + (s.fixedPeriod === 'day' ? ' a day' : ' a month') + ', not split across devices');
        lines.push('Total with fixed charge: ' + money(t.grandDay) + ' a day, ' + money(t.grandMonth) + ' a month, ' + money(t.grandYear) + ' a year');
      }
    }
    var ok = r.devices.filter(function (d) { return d.status === 'ok'; });
    if (ok.length) {
      lines.push('');
      lines.push(r.tariff ? 'Per device (energy and cost a month, share of cost):' : 'Per device (energy a month):');
      ok.forEach(function (d) {
        var e = d.energy;
        var line = '- ' + d.name + ': ' + d.input.qty + ' × ' + formatWatts(e.avgW, locale) + ' W, ' + runsText(d.input, locale) +
          ', ' + formatKwh(e.kwhMonth, locale) + ' kWh';
        if (r.tariff) line += ', ' + money(e.costMonth) + ', ' + formatPct(d.shareCost, locale);
        lines.push(line);
      });
    }
    if (r.excluded.length) {
      lines.push('Left out because of errors: ' + r.excluded.map(function (d) { return d.label; }).join(', '));
    }
    var pb = r.payback;
    if (pb.status === 'ok') {
      var p = pb.value;
      lines.push('');
      var head = 'Payback: ' + formatWatts(p.oldW, locale) + ' W → ' + formatWatts(p.newW, locale) + ' W, ' + formatHours(p.hours, locale) + ' h a day, ';
      if (p.months === null) {
        lines.push(head + 'never pays back on electricity savings (' + paybackReasonText(p, cur, locale) + ')');
      } else {
        lines.push(head + 'saves ' + formatKwh(p.kwhYear, locale) + ' kWh and ' + money(p.savingYear) + ' a year (' + money(p.savingMonth) + ' a month); break-even after ' +
          (p.months === 0 ? '0 months' : formatMonths(p.months, locale) + ' months'));
      }
    }
    lines.push('');
    lines.push('Assumptions: 365-day year, average month of 30.42 days (365 / 12), the same tariff every day, watts measured at the wall, figures rounded for display only.');
    if (link) lines.push('Link: ' + link);
    return lines.join('\n');
  }

  function round(v, d) {
    return decimalRound(v, d);
  }

  function csvNum(v, d) {
    return v === null || v === undefined || !isFinite(v) ? '' : String(round(v, d));
  }

  // Text cells: quoted when needed; a leading = + - @ is defused so a
  // spreadsheet does not run a device name as a formula.
  function csvText(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv(r, s) {
    var cur = String(s.currency || '').trim();
    var unit = cur ? ' (' + (currencyInfo(cur).iso ? cur.toUpperCase() : cur) + ')' : '';
    var head = ['device', 'quantity', 'idle_w', 'load_w', 'time_at_load_pct', 'runs', 'hours_on_per_day', 'avg_w_while_on',
      'kwh_per_day', 'kwh_per_month', 'kwh_per_year', 'cheap_rate_kwh_per_day',
      'cost_per_day' + unit, 'cost_per_month' + unit, 'cost_per_year' + unit, 'share_of_cost_pct'];
    var tou = !!r.tariff && r.tariff.type === 'tou';
    var rows = [head.map(csvText).join(',')];
    r.devices.forEach(function (d) {
      if (d.status !== 'ok') return;
      var x = d.input;
      var e = d.energy;
      rows.push([
        csvText(d.name), csvNum(x.qty, 0), csvNum(x.idle, 2), csvNum(x.load, 2), csvNum(x.pct, 2), csvText(runsText(x, 'en-US', true)),
        csvNum(e.hoursOn, 4), csvNum(e.avgW, 2), csvNum(e.kwhDay, 4), csvNum(e.kwhMonth, 4), csvNum(e.kwhYear, 4),
        tou ? csvNum(e.cheapKwhDay, 4) : '', csvNum(e.costDay, 4), csvNum(e.costMonth, 4), csvNum(e.costYear, 4),
        d.shareCost === null ? '' : csvNum(d.shareCost * 100, 2)
      ].join(','));
    });
    var t = r.totals;
    rows.push(['Total', csvNum(t.units, 0), '', '', '', '', '', '', csvNum(t.kwhDay, 4), csvNum(t.kwhMonth, 4), csvNum(t.kwhYear, 4),
      tou ? csvNum(t.cheapKwhDay, 4) : '', csvNum(t.costDay, 4), csvNum(t.costMonth, 4), csvNum(t.costYear, 4), r.tariff && t.costDay > 0 ? '100' : ''].join(','));
    if (r.tariff && r.fixed.amount > 0) {
      rows.push(['Fixed charge', '', '', '', '', '', '', '', '', '', '', '', csvNum(r.fixed.perDay, 4), csvNum(r.fixed.perMonth, 4), csvNum(r.fixed.perYear, 4), ''].join(','));
      rows.push(['Total with fixed charge', '', '', '', '', '', '', '', '', '', '', '', csvNum(t.grandDay, 4), csvNum(t.grandMonth, 4), csvNum(t.grandYear, 4), ''].join(','));
    }
    return rows.join('\r\n') + '\r\n';
  }

  function paybackReasonText(p, cur, locale) {
    if (p.reason === 'not-lower') return 'the new machine (' + formatWatts(p.newW, locale) + ' W) does not draw less than the old one (' + formatWatts(p.oldW, locale) + ' W)';
    if (p.reason === 'no-hours') return 'hours per day is 0, so there is nothing to save';
    if (p.reason === 'free-power') return 'the electricity price is 0, so using less power saves no money';
    return '';
  }

  // ── DOM ────────────────────────────────────────────────────────────────

  var state = defaultState();
  var lastHash = '';
  var hashActive = false;   // the hash is written after the first change or when the page was opened from one
  var LOCALE;               // undefined: the browser's own locale

  function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function issueHtml(level, text) {
    var tag = level === 'error' ? 'Error' : (level === 'warn' ? 'Check' : 'Note');
    return '<li class="hpc-issue hpc-issue--' + level + '"><span class="hpc-issue-tag">' + tag + '</span><span class="hpc-issue-text">' + escapeHtml(text) + '</span></li>';
  }

  function setIssues(el, items) {
    el.innerHTML = items.join('');
    el.classList.toggle('hpc-hidden', items.length === 0);
  }

  function money(v) { return formatMoney(v, state.currency, LOCALE); }

  function showToast(msg, isError) {
    var t = $('hpc-toast');
    t.textContent = msg;
    t.classList.toggle('hpc-toast--error', !!isError);
    t.classList.add('hpc-show');
    setTimeout(function () { t.classList.remove('hpc-show'); }, 2000);
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

  // Device rows

  function deviceRowHtml(d, i) {
    var p = 'hpc-d' + i + '-';
    function field(f, label, attrs, extra) {
      return '<div class="hpc-field hpc-field--' + f + (extra || '') + '">' +
        '<label class="hpc-label" for="' + p + f + '">' + label + '</label>' +
        '<input class="hpc-input" id="' + p + f + '" data-f="' + f + '" value="' + escapeHtml(d[f]) + '" ' + attrs + '>' +
        '</div>';
    }
    function opt(v, text) {
      return '<option value="' + v + '"' + (d.mode === v ? ' selected' : '') + '>' + text + '</option>';
    }
    var num = 'type="text" inputmode="decimal" autocomplete="off" spellcheck="false"';
    return '<div class="hpc-dev" data-i="' + i + '">' +
      '<div class="hpc-dev-grid">' +
        field('name', 'Device', 'type="text" maxlength="' + MAX_NAME + '" autocomplete="off" placeholder="Device ' + (i + 1) + '"') +
        field('qty', 'Qty', 'type="text" inputmode="numeric" autocomplete="off" placeholder="1"') +
        field('idle', 'Idle W', num + ' placeholder="W"') +
        field('load', 'Load W', num + ' placeholder="= idle"') +
        field('pct', '% at load', num + ' placeholder="0"') +
        '<div class="hpc-field hpc-field--mode">' +
          '<label class="hpc-label" for="' + p + 'mode">Runs</label>' +
          '<select class="hpc-input hpc-select" id="' + p + 'mode" data-f="mode">' +
            opt('always', 'Always on') + opt('hours', 'Hours per day') + opt('window', 'Time window') +
          '</select>' +
        '</div>' +
        '<div class="hpc-sched">' +
          '<div class="hpc-sched-opt hpc-sched-opt--always' + (d.mode === 'always' ? '' : ' hpc-hidden') + '"><span class="hpc-static">24 h a day</span></div>' +
          '<div class="hpc-sched-opt hpc-sched-opt--hours' + (d.mode === 'hours' ? '' : ' hpc-hidden') + '">' +
            field('hours', 'Hours/day', num + ' placeholder="8"') +
          '</div>' +
          '<div class="hpc-sched-opt hpc-sched-opt--window' + (d.mode === 'window' ? '' : ' hpc-hidden') + '">' +
            field('start', 'From', 'type="time" step="60"') +
            field('end', 'To', 'type="time" step="60"') +
          '</div>' +
        '</div>' +
        '<div class="hpc-dev-del">' +
          '<button type="button" class="hpc-icon-btn" data-act="remove" aria-label="Remove device ' + (i + 1) + '" title="Remove this device">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="hpc-dev-out" id="' + p + 'out"></div>' +
    '</div>';
  }

  function renderDevices() {
    $('hpc-devices').innerHTML = state.devices.map(deviceRowHtml).join('');
    var full = state.devices.length >= MAX_DEVICES;
    $('hpc-add').disabled = full;
    $('hpc-add-hint').classList.toggle('hpc-hidden', !full);
  }

  function updateSched(row, mode) {
    ['always', 'hours', 'window'].forEach(function (m) {
      row.querySelector('.hpc-sched-opt--' + m).classList.toggle('hpc-hidden', m !== mode);
    });
  }

  function markInvalid(scope, attr, fields) {
    var nodes = scope.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < nodes.length; i++) {
      var f = nodes[i].getAttribute(attr);
      nodes[i].classList.toggle('hpc-invalid', fields.indexOf(f) !== -1);
      if (fields.indexOf(f) !== -1) nodes[i].setAttribute('aria-invalid', 'true');
      else nodes[i].removeAttribute('aria-invalid');
    }
  }

  function renderDeviceRows(r) {
    var rows = $('hpc-devices').querySelectorAll('.hpc-dev');
    var tou = !!r.tariff && r.tariff.type === 'tou';
    for (var i = 0; i < rows.length; i++) {
      var d = r.devices[i];
      if (!d) continue;
      var row = rows[i];
      var out = row.querySelector('.hpc-dev-out');
      row.classList.toggle('hpc-dev--error', d.status === 'error');
      markInvalid(row, 'data-f', d.errors.map(function (e) { return e.field; }));
      if (d.status === 'empty') {
        out.innerHTML = '<span class="hpc-dev-muted">Type its idle watts to include it in the totals.</span>';
        continue;
      }
      if (d.status === 'error') {
        out.innerHTML = '<ul class="hpc-issues">' + d.errors.map(function (e) { return issueHtml('error', e.text); }).join('') + '</ul>';
        continue;
      }
      var e = d.energy;
      var bits = ['Average ' + formatWatts(e.avgW, LOCALE) + ' W while on', formatHours(e.hoursOn, LOCALE) + ' h a day',
        formatKwh(e.kwhDay, LOCALE) + ' kWh a day'];
      if (r.tariff) bits.push(money(e.costDay) + ' a day');
      if (tou && e.kwhDay > 0) bits.push(formatPct(e.cheapKwhDay / e.kwhDay, LOCALE) + ' at the cheap rate');
      out.innerHTML = '<span class="hpc-dev-sum">' + escapeHtml(bits.join(' · ')) + '</span>' +
        (d.warnings.length ? '<ul class="hpc-issues">' + d.warnings.map(function (w) { return issueHtml('warn', w.text); }).join('') + '</ul>' : '');
    }
    var units = r.totals.units;
    $('hpc-dev-count').textContent = state.devices.length + (state.devices.length === 1 ? ' row' : ' rows') +
      (r.totals.rows ? ', ' + units + (units === 1 ? ' unit' : ' units') + ' counted' : '');
    var hasExample = state.devices.some(function (x) { return /\(example\)/i.test(x.name || ''); });
    $('hpc-example-note').classList.toggle('hpc-hidden', !hasExample);
  }

  // Tariff

  var STATIC_FIELDS = {
    'hpc-currency': 'currency', 'hpc-price': 'price', 'hpc-day-price': 'dayPrice', 'hpc-night-price': 'nightPrice',
    'hpc-cheap-start': 'cheapStart', 'hpc-cheap-end': 'cheapEnd', 'hpc-fixed': 'fixed', 'hpc-fixed-period': 'fixedPeriod'
  };
  var PB_FIELDS = { 'hpc-pb-old': 'oldW', 'hpc-pb-new': 'newW', 'hpc-pb-hours': 'hours', 'hpc-pb-price': 'price', 'hpc-pb-resale': 'resale' };

  function renderTariff(r) {
    var tou = state.tariffType === 'tou';
    $('hpc-single').classList.toggle('hpc-hidden', tou);
    $('hpc-tou').classList.toggle('hpc-hidden', !tou);
    var info = currencyInfo(state.currency, LOCALE);
    $('hpc-currency-hint').textContent = 'Shown as ' + formatMoney(1234.5, state.currency, LOCALE) + '. ' +
      (info.iso ? 'Formatted by your browser from the ISO code ' + info.code + '.' :
        (info.symbol ? 'Used as a plain symbol; type a three-letter ISO code such as EUR, USD, GBP or UAH for local formatting.' :
          'No currency: amounts are shown as plain numbers.'));
    var cs = parseTime(state.cheapStart);
    var ce = parseTime(state.cheapEnd);
    var hint = 'A window that ends earlier than it starts runs past midnight, for example 23:00 to 07:00.';
    if (!isNaN(cs) && !isNaN(ce) && cs !== ce) {
      var mins = windowMinutes(cs, ce);
      hint = 'Cheap window: ' + formatHours(mins / 60, LOCALE) + ' h a day (' + formatPct(mins / MINUTES_PER_DAY, LOCALE) + ' of the day). ' + hint;
      if (r.tariff) hint += ' A load that runs all day pays ' + formatPrice(r.blended, state.currency, LOCALE) + ' per kWh on average.';
    }
    $('hpc-cheap-hint').textContent = hint;
    var bad = r.tariffErrors.map(function (e) { return e.field; });
    if (r.fixed.error) bad.push('fixed');
    var map = { price: 'hpc-price', dayPrice: 'hpc-day-price', nightPrice: 'hpc-night-price', cheapStart: 'hpc-cheap-start', cheapEnd: 'hpc-cheap-end', fixed: 'hpc-fixed' };
    Object.keys(map).forEach(function (f) {
      var el = $(map[f]);
      el.classList.toggle('hpc-invalid', bad.indexOf(f) !== -1);
      if (bad.indexOf(f) !== -1) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    });
    var items = r.tariffErrors.map(function (e) { return issueHtml('error', e.text); })
      .concat(r.tariffWarnings.map(function (w) { return issueHtml('warn', w.text); }));
    if (r.fixed.error) items.push(issueHtml('error', r.fixed.error));
    setIssues($('hpc-tariff-issues'), items);
    $('hpc-fixed-hint').textContent = r.fixed.amount > 0 ?
      'Adds ' + money(r.fixed.perMonth) + ' a month (' + money(r.fixed.perYear) + ' a year) to the totals. It is not split across devices.' :
      'Optional: a standing charge or monthly fee you want in the totals. It is not split across devices.';
  }

  // Results

  function kpiHtml(label, value, sub) {
    return '<div class="hpc-kpi"><span class="hpc-kpi-label">' + escapeHtml(label) + '</span>' +
      '<span class="hpc-kpi-value">' + escapeHtml(value) + '</span>' +
      (sub ? '<span class="hpc-kpi-sub">' + escapeHtml(sub) + '</span>' : '') + '</div>';
  }

  function td(label, html, cls) {
    return '<td class="hpc-td' + (cls ? ' ' + cls : '') + '" data-label="' + escapeHtml(label) + '">' + html + '</td>';
  }

  function shareHtml(fraction) {
    if (fraction === null) return '<span class="hpc-share-val">—</span>';
    var w = Math.max(0, Math.min(100, fraction * 100));
    return '<span class="hpc-share"><span class="hpc-bar"><span class="hpc-bar-fill" style="width:' + w.toFixed(1) + '%"></span></span>' +
      '<span class="hpc-share-val">' + formatPct(fraction, LOCALE) + '</span></span>';
  }

  var COLS = ['kWh / day', 'kWh / month', 'kWh / year', 'Cost / day', 'Cost / month', 'Cost / year', 'Share of cost'];

  function renderResults(r) {
    var t = r.totals;
    var tou = !!r.tariff && r.tariff.type === 'tou';
    var fixedOn = !!r.tariff && r.fixed.amount > 0;
    var kpis = [
      kpiHtml('Average draw', formatWatts(t.avgW24, LOCALE) + ' W', 'all devices, averaged over 24 h'),
      kpiHtml('Energy', formatKwh(t.kwhMonth, LOCALE) + ' kWh a month', formatKwh(t.kwhYear, LOCALE) + ' kWh a year')
    ];
    if (r.tariff) {
      kpis.push(kpiHtml(fixedOn ? 'Cost a month, with fixed charge' : 'Cost a month', money(t.grandMonth),
        fixedOn ? 'devices ' + money(t.costMonth) + ' + fixed ' + money(r.fixed.perMonth) : money(t.costDay) + ' a day'));
      kpis.push(kpiHtml(fixedOn ? 'Cost a year, with fixed charge' : 'Cost a year', money(t.grandYear),
        tou && t.cheapShare !== null ? formatPct(t.cheapShare, LOCALE) + ' of the energy at the cheap rate' :
          (r.tariff.type === 'single' ? 'at ' + formatPrice(r.tariff.price, state.currency, LOCALE) + ' per kWh' : '')));
    } else {
      kpis.push(kpiHtml('Cost', '—', 'fix the electricity price above'));
    }
    $('hpc-kpis').innerHTML = kpis.join('');

    var ok = r.devices.filter(function (d) { return d.status === 'ok'; });
    var head = '<thead><tr><th class="hpc-th hpc-th--name" scope="col">Device</th>' +
      COLS.map(function (c) { return '<th class="hpc-th" scope="col">' + c + '</th>'; }).join('') + '</tr></thead>';
    var body;
    if (!ok.length) {
      body = '<tbody><tr class="hpc-tr hpc-tr--empty"><td class="hpc-td hpc-td--empty" colspan="8">No devices with readings yet. Add a device and type its watts.</td></tr></tbody>';
    } else {
      body = '<tbody>' + ok.map(function (d) {
        var e = d.energy;
        var meta = d.input.qty + ' × ' + formatWatts(e.avgW, LOCALE) + ' W · ' + runsText(d.input, LOCALE);
        if (tou && e.kwhDay > 0) meta += ' · ' + formatPct(e.cheapKwhDay / e.kwhDay, LOCALE) + ' cheap rate';
        return '<tr class="hpc-tr">' +
          td('Device', '<span class="hpc-dev-name">' + escapeHtml(d.name) + '</span><span class="hpc-dev-meta">' + escapeHtml(meta) + '</span>', 'hpc-td--name') +
          td(COLS[0], formatKwh(e.kwhDay, LOCALE)) + td(COLS[1], formatKwh(e.kwhMonth, LOCALE)) + td(COLS[2], formatKwh(e.kwhYear, LOCALE)) +
          td(COLS[3], escapeHtml(money(e.costDay))) + td(COLS[4], escapeHtml(money(e.costMonth))) + td(COLS[5], escapeHtml(money(e.costYear))) +
          td(COLS[6], shareHtml(d.shareCost), 'hpc-td--share') +
          '</tr>';
      }).join('') + '</tbody>';
    }
    var foot = '<tfoot><tr class="hpc-tr hpc-tr--total">' +
      td('Device', '<span class="hpc-dev-name">Total</span><span class="hpc-dev-meta">' + t.rows + (t.rows === 1 ? ' row, ' : ' rows, ') + t.units + (t.units === 1 ? ' unit' : ' units') + '</span>', 'hpc-td--name') +
      td(COLS[0], formatKwh(t.kwhDay, LOCALE)) + td(COLS[1], formatKwh(t.kwhMonth, LOCALE)) + td(COLS[2], formatKwh(t.kwhYear, LOCALE)) +
      td(COLS[3], escapeHtml(money(t.costDay))) + td(COLS[4], escapeHtml(money(t.costMonth))) + td(COLS[5], escapeHtml(money(t.costYear))) +
      td(COLS[6], r.tariff && t.costDay > 0 ? formatPct(1, LOCALE) : '—', 'hpc-td--share') + '</tr>';
    if (fixedOn) {
      foot += '<tr class="hpc-tr hpc-tr--fixed">' +
        td('Device', '<span class="hpc-dev-name">Fixed charge</span><span class="hpc-dev-meta">not split across devices</span>', 'hpc-td--name') +
        td(COLS[0], '', 'hpc-td--blank') + td(COLS[1], '', 'hpc-td--blank') + td(COLS[2], '', 'hpc-td--blank') +
        td(COLS[3], escapeHtml(money(r.fixed.perDay))) + td(COLS[4], escapeHtml(money(r.fixed.perMonth))) + td(COLS[5], escapeHtml(money(r.fixed.perYear))) +
        td(COLS[6], '', 'hpc-td--blank') + '</tr>' +
        '<tr class="hpc-tr hpc-tr--grand">' +
        td('Device', '<span class="hpc-dev-name">Total with fixed charge</span>', 'hpc-td--name') +
        td(COLS[0], '', 'hpc-td--blank') + td(COLS[1], '', 'hpc-td--blank') + td(COLS[2], '', 'hpc-td--blank') +
        td(COLS[3], escapeHtml(money(t.grandDay))) + td(COLS[4], escapeHtml(money(t.grandMonth))) + td(COLS[5], escapeHtml(money(t.grandYear))) +
        td(COLS[6], '', 'hpc-td--blank') + '</tr>';
    }
    foot += '</tfoot>';
    $('hpc-dev-table').innerHTML = head + body + foot;

    var notes = [];
    if (r.excluded.length) {
      notes.push(issueHtml('error', 'Left out of the totals because of errors: ' + r.excluded.map(function (d) { return d.label; }).join(', ') + '. Fix the fields marked in red in the device list.'));
    }
    if (r.empty.length) {
      notes.push(issueHtml('info', 'No watts yet, so not counted: ' + r.empty.map(function (d) { return d.label; }).join(', ') + '.'));
    }
    setIssues($('hpc-results-issues'), notes);
  }

  // Payback

  function renderPaybackSelect(r) {
    var sel = $('hpc-pb-from');
    var ok = r.devices.filter(function (d) { return d.status === 'ok'; });
    var html = '<option value="">Fill the old machine from a device…</option>' + ok.map(function (d) {
      return '<option value="' + d.index + '">' + escapeHtml(d.name + ' — ' + formatWatts(d.energy.avgW, LOCALE) + ' W, ' + formatHours(d.energy.hoursOn, LOCALE) + ' h a day') + '</option>';
    }).join('');
    if (sel.getAttribute('data-html') !== html) {
      sel.innerHTML = html;
      sel.setAttribute('data-html', html);
    }
    sel.disabled = ok.length === 0;
  }

  function renderPayback(r) {
    renderPaybackSelect(r);
    var pb = r.payback;
    var map = { oldW: 'hpc-pb-old', newW: 'hpc-pb-new', hours: 'hpc-pb-hours', price: 'hpc-pb-price', resale: 'hpc-pb-resale' };
    var bad = pb.errors.map(function (e) { return e.field; });
    Object.keys(map).forEach(function (f) {
      var el = $(map[f]);
      el.classList.toggle('hpc-invalid', bad.indexOf(f) !== -1);
      if (bad.indexOf(f) !== -1) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    });
    setIssues($('hpc-pb-issues'), pb.errors.map(function (e) { return issueHtml('error', e.text); }));
    var out = $('hpc-pb-out');
    if (pb.status === 'empty') {
      out.innerHTML = '<p class="hpc-hint">Type the average watts of the old machine and of its replacement, and the replacement\'s price.</p>';
      return;
    }
    if (pb.status === 'no-tariff') {
      out.innerHTML = '<p class="hpc-hint">Fix the electricity price above to see the payback.</p>';
      return;
    }
    if (pb.status !== 'ok') {
      out.innerHTML = '';
      return;
    }
    var p = pb.value;
    var tou = r.tariff.type === 'tou';
    var breakEven;
    var breakSub;
    if (p.months === null) {
      breakEven = 'Never';
      breakSub = 'on electricity savings alone';
    } else if (p.months === 0) {
      breakEven = 'Right away';
      breakSub = 'the money back covers the price';
    } else {
      breakEven = formatMonths(p.months, LOCALE) + ' months';
      breakSub = p.months >= 24 ? 'about ' + formatNumber(p.months / 12, LOCALE, 1, 1) + ' years' : 'from the day you switch';
    }
    var savingLabel = p.savingYear < 0 ? 'Extra cost a year' : 'Saving a year';
    var html = '<div class="hpc-kpis hpc-kpis--pb">' +
      kpiHtml(p.savedW < 0 ? 'Extra power' : 'Power saved', formatWatts(Math.abs(p.savedW), LOCALE) + ' W', formatKwh(Math.abs(p.kwhYear), LOCALE) + ' kWh a year') +
      kpiHtml(p.savingYear < 0 ? 'Extra cost a month' : 'Saving a month', money(Math.abs(p.savingMonth)), '') +
      kpiHtml(savingLabel, money(Math.abs(p.savingYear)), '') +
      kpiHtml('Break-even', breakEven, breakSub) +
      '</div>';
    var math = formatWatts(p.oldW, LOCALE) + ' W − ' + formatWatts(p.newW, LOCALE) + ' W = ' + formatWatts(p.savedW, LOCALE) + ' W × ' +
      formatHours(p.hours, LOCALE) + ' h × 365 days = ' + formatKwh(p.kwhYear, LOCALE) + ' kWh a year × ' +
      formatPrice(p.pricePerKwh, state.currency, LOCALE) + ' per kWh' + (tou ? ' (the day/night average for a machine that runs spread evenly over the day)' : '') + '.';
    html += '<p class="hpc-hint hpc-math">' + escapeHtml(math) + '</p>';
    if (p.months === null) {
      html += '<ul class="hpc-issues">' + issueHtml('warn', 'It never pays for itself: ' + paybackReasonText(p, state.currency, LOCALE) + '.') + '</ul>';
    } else {
      html += '<p class="hpc-hint">Break-even = ' + (p.resale > 0 ? '(' + escapeHtml(money(p.price)) + ' − ' + escapeHtml(money(p.resale)) + ' back for the old machine)' : escapeHtml(money(p.price))) +
        ' ÷ ' + escapeHtml(money(p.savingMonth)) + ' a month.</p>';
    }
    html += '<ul class="hpc-net">' + PAYBACK_YEARS.map(function (y) {
      var v = p.net[y];
      return '<li class="hpc-net-item"><span class="hpc-net-label">Net after ' + y + (y === 1 ? ' year' : ' years') + '</span>' +
        '<span class="hpc-net-value ' + (v >= 0 ? 'hpc-pos' : 'hpc-neg') + '">' + escapeHtml((v > 0 ? '+' : '') + money(v)) + '</span></li>';
    }).join('') + '</ul>';
    out.innerHTML = html;
  }

  // State ⇄ form

  function writeForm() {
    Object.keys(STATIC_FIELDS).forEach(function (id) { $(id).value = state[STATIC_FIELDS[id]]; });
    Object.keys(PB_FIELDS).forEach(function (id) { $(id).value = state.pb[PB_FIELDS[id]]; });
    var radios = document.querySelectorAll('input[name="hpc-tt"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === state.tariffType;
    renderDevices();
  }

  function writeHash() {
    var h = encodeHash(state);
    if (h === lastHash) return;
    lastHash = h;
    try { history.replaceState(null, '', h); } catch (e) { /* sandboxed frame: keep going */ }
  }

  function render() {
    var r = compute(state);
    renderTariff(r);
    renderDeviceRows(r);
    renderResults(r);
    renderPayback(r);
    if (hashActive) writeHash();
    return r;
  }

  function changed() {
    hashActive = true;
    render();
  }

  function onStaticInput(e) {
    var id = e.target && e.target.id;
    if (STATIC_FIELDS[id]) {
      state[STATIC_FIELDS[id]] = e.target.value;
    } else if (PB_FIELDS[id]) {
      state.pb[PB_FIELDS[id]] = e.target.value;
    } else if (e.target && e.target.name === 'hpc-tt') {
      state.tariffType = e.target.value === 'tou' ? 'tou' : 'single';
      if (state.tariffType === 'tou' && String(state.dayPrice).trim() === '' && String(state.price).trim() !== '') {
        state.dayPrice = state.price;
        $('hpc-day-price').value = state.dayPrice;
      }
    } else if (id === 'hpc-pb-from') {
      fillFromDevice(e.target.value);
      return;
    } else {
      return;
    }
    changed();
  }

  function fillFromDevice(value) {
    if (value === '') return;
    var r = compute(state);
    var d = r.devices[Number(value)];
    $('hpc-pb-from').value = '';
    if (!d || d.status !== 'ok') return;
    state.pb.oldW = String(round(d.energy.avgW, 2));
    state.pb.hours = String(round(d.energy.hoursOn, 2));
    $('hpc-pb-old').value = state.pb.oldW;
    $('hpc-pb-hours').value = state.pb.hours;
    changed();
    $('hpc-pb-new').focus();
  }

  function onDevicesInput(e) {
    var t = e.target;
    var f = t && t.getAttribute ? t.getAttribute('data-f') : null;
    if (!f) return;
    var row = t.closest('.hpc-dev');
    var i = Number(row.getAttribute('data-i'));
    if (!state.devices[i]) return;
    state.devices[i][f] = t.value;
    if (f === 'mode') updateSched(row, t.value);
    changed();
  }

  function onDevicesClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act="remove"]') : null;
    if (!btn) return;
    var i = Number(btn.closest('.hpc-dev').getAttribute('data-i'));
    state.devices.splice(i, 1);
    renderDevices();
    changed();
    var next = $('hpc-d' + Math.min(i, state.devices.length - 1) + '-name');
    (next || $('hpc-add')).focus();
  }

  function addDevice() {
    if (state.devices.length >= MAX_DEVICES) return;
    state.devices.push(emptyDevice());
    renderDevices();
    changed();
    var el = $('hpc-d' + (state.devices.length - 1) + '-name');
    if (el) el.focus();
  }

  function clearDevices() {
    var own = state.devices.filter(function (d) {
      return !/\(example\)/i.test(d.name || '') && (parseNumber(d.idle) !== null || parseNumber(d.load) !== null);
    }).length;
    if (own > 0 && !window.confirm('Remove all ' + state.devices.length + ' devices from the list?')) return;
    state.devices = [emptyDevice()];
    renderDevices();
    changed();
    $('hpc-d0-name').focus();
  }

  function shareLink() {
    var base = location.href.split('#')[0];
    return base + encodeHash(state);
  }

  function copySummary() {
    copyText(buildSummary(compute(state), state, LOCALE, shareLink()), 'Summary copied');
  }

  function copyLink() {
    hashActive = true;
    writeHash();
    copyText(shareLink(), 'Link copied');
  }

  function downloadCsv() {
    var csv = buildCsv(compute(state), state);
    var blob = new Blob([String.fromCharCode(0xFEFF) + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'homelab-power-cost.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('CSV downloaded');
  }

  function init() {
    if (isStateHash(location.hash)) {
      state = decodeHash(location.hash);
      hashActive = true;
    }
    writeForm();
    var wrapper = $('hpc-wrapper');
    wrapper.addEventListener('input', onStaticInput);
    wrapper.addEventListener('change', onStaticInput);
    var list = $('hpc-devices');
    list.addEventListener('input', onDevicesInput);
    list.addEventListener('change', onDevicesInput);
    list.addEventListener('click', onDevicesClick);
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
  window.hpcAddDevice = addDevice;
  window.hpcClearDevices = clearDevices;
  window.hpcCopySummary = copySummary;
  window.hpcCopyLink = copyLink;
  window.hpcDownloadCsv = downloadCsv;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      DAYS_PER_YEAR: DAYS_PER_YEAR,
      DAYS_PER_MONTH: DAYS_PER_MONTH,
      LIMITS: LIMITS,
      MAX_DEVICES: MAX_DEVICES,
      parseNumber: parseNumber,
      parseTime: parseTime,
      formatTime: formatTime,
      windowMinutes: windowMinutes,
      overlapWindows: overlapWindows,
      averageWatts: averageWatts,
      validateDevice: validateDevice,
      validateTariff: validateTariff,
      fixedCharge: fixedCharge,
      blendedPrice: blendedPrice,
      deviceEnergy: deviceEnergy,
      compute: compute,
      paybackMath: paybackMath,
      computePayback: computePayback,
      formatNumber: formatNumber,
      formatKwh: formatKwh,
      formatWatts: formatWatts,
      formatPct: formatPct,
      formatMoney: formatMoney,
      formatPrice: formatPrice,
      currencyInfo: currencyInfo,
      emptyDevice: emptyDevice,
      defaultState: defaultState,
      encodeHash: encodeHash,
      decodeHash: decodeHash,
      isStateHash: isStateHash,
      buildSummary: buildSummary,
      buildCsv: buildCsv,
      csvText: csvText
    };
  }
})();
