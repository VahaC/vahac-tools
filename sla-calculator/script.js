// Uptime / SLA Calculator — vahac.com/tools/sla-calculator/
// Dependencies: none (vanilla JS)
// Prefix: sla-

(function () {
  'use strict';

  // ── Period constants (seconds) ─────────────────────────────
  var YEAR_SECS  = 365.25 * 24 * 3600;  // 31,557,600 s  (Julian year)
  var MONTH_SECS = YEAR_SECS / 12;       //  2,629,800 s  (average month)
  var WEEK_SECS  = 7   * 24 * 3600;      //    604,800 s
  var DAY_SECS   = 1   * 24 * 3600;      //     86,400 s

  // ── SLA tier reference table ───────────────────────────────
  var REF_TIERS = [90, 95, 99, 99.5, 99.9, 99.95, 99.99, 99.999, 99.9999];

  // ── Nines labels (index = floor(nines), capped at 7) ───────
  var NINES_NAMES = ['< 1 Nine', 'One Nine', 'Two Nines', 'Three Nines',
                     'Four Nines', 'Five Nines', 'Six Nines', 'Seven+ Nines'];

  // ── State ──────────────────────────────────────────────────
  var currentMode = 'sla';  // 'sla' | 'dt'
  var lastResult  = null;   // stored for copy

  // ── Helpers ────────────────────────────────────────────────

  var $ = function (id) { return document.getElementById(id); };

  /**
   * Format a duration in seconds to a human-readable string.
   * e.g. 3723.5 → "1h 2m 3.5s"
   */
  function formatSecs(secs) {
    if (secs <= 0)       return '0s';
    if (secs < 0.0001)   return '< 0.0001s';
    if (secs < 1) {
      var ms = secs * 1000;
      return (ms < 1 ? '< 1' : ms.toFixed(0)) + 'ms';
    }

    var d = Math.floor(secs / 86400);
    var rem = secs - d * 86400;
    var h = Math.floor(rem / 3600);
    rem -= h * 3600;
    var m = Math.floor(rem / 60);
    var s = rem - m * 60;

    var parts = [];
    if (d > 0) parts.push(d + 'd');
    if (h > 0) parts.push(h + 'h');
    if (m > 0) parts.push(m + 'm');

    // Only show seconds if there's a meaningful remainder, or nothing else
    if (s >= 0.005 || parts.length === 0) {
      if (s === Math.floor(s)) {
        parts.push(Math.floor(s) + 's');
      } else {
        parts.push(s.toFixed(2) + 's');
      }
    }

    return parts.join(' ');
  }

  /**
   * Format SLA percentage — strip trailing zeros, keep precision.
   */
  function formatSla(sla) {
    // toFixed(6) then strip trailing zeros after decimal
    var str = sla.toFixed(6).replace(/\.?0+$/, '');
    return str + '%';
  }

  /**
   * Count "nines": -log10(1 - sla/100)
   * e.g. 99.9 → 3.0, 99.99 → 4.0, 99.5 → 2.30
   */
  function countNines(sla) {
    var frac = 1 - sla / 100;
    if (frac <= 0) return 9;
    if (frac >= 1) return 0;
    return -Math.log10(frac);
  }

  /** Map SLA to a color key */
  function getColor(sla) {
    if (sla >= 99.99)  return 'green';
    if (sla >= 99.9)   return 'cyan';
    if (sla >= 99)     return 'amber';
    return 'red';
  }

  /** Build the ●●●○○○ dot string (6 dots max) */
  function buildDots(nines) {
    var full    = Math.min(Math.floor(nines), 6);
    var hasHalf = (nines - full) >= 0.4 && full < 6;
    var empty   = 6 - full - (hasHalf ? 1 : 0);
    var html = '';
    for (var i = 0; i < full;  i++) html += '<span class="sla-dot-full">●</span>';
    if (hasHalf)                     html += '<span class="sla-dot-half">◐</span>';
    for (var j = 0; j < empty; j++) html += '<span class="sla-dot-empty">○</span>';
    return html;
  }

  /** Nines label from count */
  function ninesLabel(nines) {
    var idx = Math.min(Math.floor(nines), NINES_NAMES.length - 1);
    return NINES_NAMES[Math.max(0, idx)];
  }

  /** Compute downtime seconds per period for a given SLA */
  function downtimesFor(sla) {
    var frac = (100 - sla) / 100;
    return {
      year:  YEAR_SECS  * frac,
      month: MONTH_SECS * frac,
      week:  WEEK_SECS  * frac,
      day:   DAY_SECS   * frac
    };
  }

  // ── Error / Toast ──────────────────────────────────────────

  function showError(msg) {
    var el = $('sla-error-msg');
    el.textContent = msg;
    el.classList.add('sla-visible');
  }

  function hideError() {
    $('sla-error-msg').classList.remove('sla-visible');
  }

  function showToast(msg) {
    var t = $('sla-toast');
    t.textContent = msg || 'Done!';
    t.classList.add('sla-show');
    setTimeout(function () { t.classList.remove('sla-show'); }, 2400);
  }

  // ── Result rendering ───────────────────────────────────────

  function renderResult(sla, dt, subtitle) {
    var card    = $('sla-result-card');
    var badge   = $('sla-result-badge');
    var dotsEl  = $('sla-nines-dots');
    var labelEl = $('sla-nines-label');
    var subEl   = $('sla-result-subtitle');
    var grid    = $('sla-result-grid');

    var nines = countNines(sla);
    var color = getColor(sla);

    // Apply color classes
    ['green','cyan','amber','red'].forEach(function (c) {
      card.classList.remove('sla-color-' + c);
      badge.classList.remove('sla-color-' + c);
    });
    card.classList.add('sla-color-' + color);
    badge.classList.add('sla-color-' + color);

    badge.textContent     = formatSla(sla);
    dotsEl.innerHTML      = buildDots(nines);
    labelEl.textContent   = ninesLabel(nines);
    subEl.textContent     = subtitle || '';

    grid.innerHTML =
      makeRow('Per Year',  formatSecs(dt.year))  +
      makeRow('Per Month', formatSecs(dt.month)) +
      makeRow('Per Week',  formatSecs(dt.week))  +
      makeRow('Per Day',   formatSecs(dt.day));

    card.classList.remove('sla-hidden');

    lastResult = { sla: sla, dt: dt, nines: nines };

    highlightRef(sla);
    pushHash(sla);

    // Scroll result into view on mobile
    if (window.innerWidth <= 640) {
      setTimeout(function () { card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 50);
    }
  }

  function makeRow(period, value) {
    return '<div class="sla-result-row">' +
      '<div class="sla-result-period">' + period + '</div>' +
      '<div class="sla-result-value">'  + value  + '</div>' +
      '</div>';
  }

  /** Highlight matching row in reference table */
  function highlightRef(sla) {
    var rows = document.querySelectorAll('#sla-ref-tbody tr');
    for (var i = 0; i < rows.length; i++) {
      var row    = rows[i];
      var rowSla = parseFloat(row.getAttribute('data-sla'));
      if (!isNaN(rowSla) && Math.abs(rowSla - sla) < 0.00001) {
        row.classList.add('sla-row-highlight');
      } else {
        row.classList.remove('sla-row-highlight');
      }
    }
  }

  // ── Calculations ───────────────────────────────────────────

  /** Mode 1: SLA → Downtime */
  function slaCalcFromSla() {
    hideError();
    var raw = $('sla-sla-input').value.trim();
    var val = parseFloat(raw);
    if (raw === '' || isNaN(val)) {
      showError('Please enter a valid SLA percentage (e.g. 99.9).');
      return;
    }
    if (val < 0 || val > 100) {
      showError('SLA must be between 0 and 100.');
      return;
    }
    renderResult(val, downtimesFor(val), null);
  }

  /** Mode 2: Downtime → SLA */
  function slaCalcFromDowntime() {
    hideError();
    var amountRaw = $('sla-dt-amount').value.trim();
    var amount    = parseFloat(amountRaw);
    if (amountRaw === '' || isNaN(amount) || amount < 0) {
      showError('Downtime amount must be a non-negative number.');
      return;
    }

    var unit   = $('sla-dt-unit').value;
    var period = $('sla-dt-period').value;

    var unitFactor  = { s: 1, m: 60, h: 3600, d: 86400 };
    var periodSecs  = { day: DAY_SECS, week: WEEK_SECS, month: MONTH_SECS, year: YEAR_SECS };

    var downtimeSecs = amount * (unitFactor[unit] || 1);
    var pSecs        = periodSecs[period] || YEAR_SECS;

    if (downtimeSecs > pSecs) {
      showError('Downtime (' + formatSecs(downtimeSecs) + ') exceeds the chosen period (' + formatSecs(pSecs) + '). That means 0% uptime.');
      return;
    }

    var sla = (1 - downtimeSecs / pSecs) * 100;
    sla = Math.max(0, Math.min(100, sla));

    // Build subtitle: input summary
    var unitNames   = { s: 's', m: 'min', h: 'h', d: 'd' };
    var periodNames = { day: 'day', week: 'week', month: 'month', year: 'year' };
    var subtitle    = amount + ' ' + unitNames[unit] + ' / ' + periodNames[period] +
                      '  →  ' + formatSecs(downtimeSecs * YEAR_SECS / pSecs) + ' / year';

    renderResult(sla, downtimesFor(sla), subtitle);
  }

  // ── Mode switch ────────────────────────────────────────────

  function slaSwitchMode(mode) {
    currentMode = mode;
    var isSla = mode === 'sla';

    $('sla-panel-sla').classList.toggle('sla-hidden', !isSla);
    $('sla-panel-dt').classList.toggle('sla-hidden',   isSla);
    $('sla-tab-sla').classList.toggle('sla-active',    isSla);
    $('sla-tab-dt').classList.toggle('sla-active',    !isSla);

    $('sla-result-card').classList.add('sla-hidden');
    hideError();

    // Remove hash highlight on mode switch
    highlightRef(-1);
  }

  // ── Preset buttons ─────────────────────────────────────────

  function slaSetPreset(val) {
    $('sla-sla-input').value = val;
    slaCalcFromSla();
  }

  // ── Copy result ────────────────────────────────────────────

  function slaCopyResult() {
    if (!lastResult) return;
    var r = lastResult;
    var text =
      'SLA: ' + formatSla(r.sla) + '  (' + ninesLabel(r.nines) + ', ' + r.nines.toFixed(2) + 'N)\n\n' +
      'Allowed downtime:\n' +
      '  Per year:  ' + formatSecs(r.dt.year)  + '\n' +
      '  Per month: ' + formatSecs(r.dt.month) + '\n' +
      '  Per week:  ' + formatSecs(r.dt.week)  + '\n' +
      '  Per day:   ' + formatSecs(r.dt.day)   + '\n\n' +
      'Calculated at vahac.com/tools/sla-calculator/';

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function ()   { showToast('Copied to clipboard!'); })
        .catch(function ()  { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); showToast('Copied!'); }
    catch (e) { showToast('Copy failed — select text manually.'); }
    document.body.removeChild(ta);
  }

  // ── Build reference table ──────────────────────────────────

  function buildRefTable() {
    var tbody = $('sla-ref-tbody');
    var html  = '';
    for (var i = 0; i < REF_TIERS.length; i++) {
      var sla   = REF_TIERS[i];
      var dt    = downtimesFor(sla);
      var nines = countNines(sla);
      var color = getColor(sla);
      html += '<tr data-sla="' + sla + '" class="sla-row-' + color + '">' +
        '<td>' + formatSla(sla)           + '</td>' +
        '<td>' + ninesLabel(nines)         + '</td>' +
        '<td>' + formatSecs(dt.year)       + '</td>' +
        '<td>' + formatSecs(dt.month)      + '</td>' +
        '<td>' + formatSecs(dt.week)       + '</td>' +
        '<td>' + formatSecs(dt.day)        + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
  }

  // ── URL hash state ─────────────────────────────────────────

  function pushHash(sla) {
    try { history.replaceState(null, '', '#sla=' + sla); }
    catch (e) { /* silent */ }
  }

  function loadHash() {
    var hash  = (location.hash || '').replace('#', '');
    var match = hash.match(/^sla=([\d.]+)$/);
    if (!match) return false;
    var val = parseFloat(match[1]);
    if (isNaN(val) || val < 0 || val > 100) return false;
    $('sla-sla-input').value = val;
    slaSwitchMode('sla');
    slaCalcFromSla();
    return true;
  }

  // ── Keyboard support ───────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
    if (tag === 'BUTTON') return; // let button handle its own click
    if (currentMode === 'sla') slaCalcFromSla();
    else slaCalcFromDowntime();
  });

  // ── Init ───────────────────────────────────────────────────

  function init() {
    buildRefTable();
    if (!loadHash()) {
      // Auto-calculate default value (99.9%)
      slaCalcFromSla();
    }
  }

  // ── Public API (onclick handlers) ──────────────────────────
  window.slaCalcFromSla      = slaCalcFromSla;
  window.slaCalcFromDowntime = slaCalcFromDowntime;
  window.slaSetPreset        = slaSetPreset;
  window.slaSwitchMode       = slaSwitchMode;
  window.slaCopyResult       = slaCopyResult;

  init();

})();
