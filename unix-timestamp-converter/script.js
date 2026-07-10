(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function pad(n, len) {
    var s = String(Math.abs(Math.trunc(n)));
    while (s.length < len) s = '0' + s;
    return (n < 0 ? '-' : '') + s;
  }

  function showError(id, msg) {
    var el = $(id);
    el.textContent = msg;
    el.classList.add('uts-visible');
  }

  function hideError(id) {
    $(id).classList.remove('uts-visible');
  }

  function showToast() {
    var toast = $('uts-toast');
    toast.classList.add('uts-show');
    setTimeout(function () { toast.classList.remove('uts-show'); }, 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showToast).catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast();
    }
  }

  function copyField(id) {
    var el = $(id);
    var text = ('value' in el && el.tagName !== 'DIV') ? el.value : el.textContent;
    if (!text) return;
    copyText(text);
  }

  // --- Core conversion logic (pure, unit-testable) ---

  // Timestamps whose absolute value has 12+ digits are treated as milliseconds
  // (current ms-epoch values are ~13 digits; current second-epoch values are ~10 digits).
  var MS_THRESHOLD = 1e11;

  function detectUnit(num) {
    return Math.abs(num) >= MS_THRESHOLD ? 'ms' : 's';
  }

  function parseTimestamp(raw, unitOverride) {
    var str = String(raw).trim();
    if (!str) throw new Error('Enter a timestamp.');
    if (!/^-?\d+(\.\d+)?$/.test(str)) throw new Error('Timestamp must be a plain number (seconds or milliseconds).');

    var num = parseFloat(str);
    var unit = (unitOverride && unitOverride !== 'auto') ? unitOverride : detectUnit(num);
    var ms = unit === 'ms' ? Math.round(num) : Math.round(num * 1000);

    return { ms: ms, unit: unit };
  }

  function formatISO(ms) {
    return new Date(ms).toISOString();
  }

  function formatUTC(ms) {
    return new Date(ms).toUTCString();
  }

  function timezoneOffsetString(date) {
    var offset = -date.getTimezoneOffset();
    var sign = offset >= 0 ? '+' : '-';
    var abs = Math.abs(offset);
    return sign + pad(Math.floor(abs / 60), 2) + ':' + pad(abs % 60, 2);
  }

  function formatLocal(ms) {
    var d = new Date(ms);
    return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2) +
      ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2) +
      ' (UTC' + timezoneOffsetString(d) + ')';
  }

  function msToUnixSeconds(ms) {
    return Math.floor(ms / 1000);
  }

  var RELATIVE_UNITS = [
    ['year', 365.25 * 24 * 3600],
    ['month', 30.44 * 24 * 3600],
    ['day', 24 * 3600],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1]
  ];

  function relativeTime(ms, nowMs) {
    var diffMs = ms - nowMs;
    var sec = Math.abs(diffMs) / 1000;

    if (sec < 5) return 'just now';

    for (var i = 0; i < RELATIVE_UNITS.length; i++) {
      var name = RELATIVE_UNITS[i][0];
      var secondsInUnit = RELATIVE_UNITS[i][1];
      if (sec >= secondsInUnit || name === 'second') {
        var value = Math.round(sec / secondsInUnit);
        var label = value + ' ' + name + (value === 1 ? '' : 's');
        return diffMs < 0 ? label + ' ago' : 'in ' + label;
      }
    }
    return 'just now';
  }

  function dateTimeLocalToEpoch(str, treatAsUtc) {
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(str).trim());
    if (!match) throw new Error('Pick a valid date and time.');

    var y = parseInt(match[1], 10);
    var mo = parseInt(match[2], 10);
    var d = parseInt(match[3], 10);
    var h = parseInt(match[4], 10);
    var mi = parseInt(match[5], 10);
    var s = match[6] ? parseInt(match[6], 10) : 0;

    return treatAsUtc ? Date.UTC(y, mo - 1, d, h, mi, s) : new Date(y, mo - 1, d, h, mi, s).getTime();
  }

  // --- UI wiring ---

  function convertTimestamp() {
    hideError('uts-ts-error');
    var raw = $('uts-ts-input').value;
    var unitOverride = $('uts-unit-select').value;

    if (!raw.trim()) {
      $('uts-ts-results').classList.remove('uts-visible-block');
      return;
    }

    var parsed;
    try {
      parsed = parseTimestamp(raw, unitOverride);
    } catch (e) {
      showError('uts-ts-error', e.message);
      $('uts-ts-results').classList.remove('uts-visible-block');
      return;
    }

    $('uts-ts-results').classList.add('uts-visible-block');
    $('uts-detected-unit').textContent = parsed.unit === 'ms' ? 'milliseconds' : 'seconds';
    $('uts-out-iso').textContent = formatISO(parsed.ms);
    $('uts-out-utc').textContent = formatUTC(parsed.ms);
    $('uts-out-local').textContent = formatLocal(parsed.ms);
    $('uts-out-relative').textContent = relativeTime(parsed.ms, Date.now());
  }

  function useCurrentTimestamp() {
    $('uts-ts-input').value = String(Date.now());
    $('uts-unit-select').value = 'ms';
    convertTimestamp();
  }

  function convertDate() {
    hideError('uts-date-error');
    var raw = $('uts-date-input').value;
    var treatAsUtc = $('uts-tz-toggle').checked;

    if (!raw) {
      $('uts-date-results').classList.remove('uts-visible-block');
      return;
    }

    var ms;
    try {
      ms = dateTimeLocalToEpoch(raw, treatAsUtc);
    } catch (e) {
      showError('uts-date-error', e.message);
      $('uts-date-results').classList.remove('uts-visible-block');
      return;
    }

    $('uts-date-results').classList.add('uts-visible-block');
    $('uts-out-epoch-s').textContent = String(msToUnixSeconds(ms));
    $('uts-out-epoch-ms').textContent = String(ms);
  }

  function useCurrentDate() {
    var d = new Date();
    $('uts-date-input').value = pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2) +
      'T' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
    $('uts-tz-toggle').checked = false;
    convertDate();
  }

  var clockTimer = null;

  function tickClock() {
    var now = Date.now();
    $('uts-now-seconds').textContent = String(msToUnixSeconds(now));
    $('uts-now-ms').textContent = String(now);
    $('uts-now-iso').textContent = formatISO(now);
  }

  function startClock() {
    tickClock();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 250);
  }

  // Expose to global scope for onclick/oninput handlers
  window.utsConvertTimestamp = convertTimestamp;
  window.utsUseCurrentTimestamp = useCurrentTimestamp;
  window.utsConvertDate = convertDate;
  window.utsUseCurrentDate = useCurrentDate;
  window.utsCopyField = copyField;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      pad: pad,
      detectUnit: detectUnit,
      parseTimestamp: parseTimestamp,
      formatISO: formatISO,
      formatUTC: formatUTC,
      formatLocal: formatLocal,
      msToUnixSeconds: msToUnixSeconds,
      relativeTime: relativeTime,
      dateTimeLocalToEpoch: dateTimeLocalToEpoch
    };
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startClock);
  } else {
    startClock();
  }
})();
