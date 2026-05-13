/**
 * Byte & Storage Converter — script.js
 * Namespace prefix: bsc-
 * No external dependencies — vanilla JS only.
 *
 * Features:
 *  - Storage converter: fan-out (input one unit → all units rendered simultaneously)
 *  - Decimal (SI): B, KB, MB, GB, TB, PB
 *  - Binary (IEC): KiB, MiB, GiB, TiB, PiB
 *  - Bitrate calculator, mode A: bitrate + duration → file size
 *  - Bitrate calculator, mode B: file size + duration → required bitrate
 *  - URL hash state persistence for storage converter (shareable link)
 *  - Clipboard copy (API + execCommand fallback)
 *  - Toast notifications
 *  - Enter-key support on all inputs
 */

(function () {
  'use strict';

  /* ─── Shortcuts ─────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };

  /* ─── Unit tables ────────────────────────────────────────── */

  // Maps each storage unit to its value in bytes
  var BYTES = {
    // Decimal (SI) — powers of 1000
    'B':   1,
    'KB':  1e3,
    'MB':  1e6,
    'GB':  1e9,
    'TB':  1e12,
    'PB':  1e15,
    // Binary (IEC) — powers of 1024
    'KiB': 1024,
    'MiB': 1048576,           // 1024^2
    'GiB': 1073741824,        // 1024^3
    'TiB': 1099511627776,     // 1024^4
    'PiB': 1125899906842624   // 1024^5
  };

  var DECIMAL_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  var BINARY_UNITS  = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  var ALL_UNITS     = DECIMAL_UNITS.concat(BINARY_UNITS);

  // Maps each bitrate unit to its value in bits-per-second
  var BPS = {
    'bps':  1,
    'Kbps': 1e3,
    'Mbps': 1e6,
    'Gbps': 1e9
  };

  /* ─── Toast ──────────────────────────────────────────────── */

  function showToast(msg) {
    var el = $('bsc-toast');
    el.textContent = msg || '✓ Copied!';
    el.classList.add('bsc-show');
    setTimeout(function () { el.classList.remove('bsc-show'); }, 2000);
  }

  /* ─── Clipboard ──────────────────────────────────────────── */

  function copyText(text) {
    if (!text || text === '—') return;

    function doFallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* silent */ }
      document.body.removeChild(ta);
      showToast();
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { showToast(); })
        .catch(doFallback);
    } else {
      doFallback();
    }
  }

  /* ─── Number formatting ──────────────────────────────────── */

  /**
   * Format a numeric value for display in a result cell.
   * Returns a string with thousands separators and no trailing zeros.
   * Falls back to scientific notation for extremely small values.
   *
   * @param {number} bytes  - value in bytes (base)
   * @param {string} unit   - target unit key from BYTES table
   * @returns {string}
   */
  function formatStorage(bytes, unit) {
    var v = bytes / BYTES[unit];
    return smartFormat(v);
  }

  /**
   * General-purpose number formatter.
   * - Values < 1e-9  → exponential notation (4 sig figs)
   * - Values < 0.01  → fixed precision (up to 8 decimals, no trailing zeros)
   * - Otherwise      → locale string with up to 8 decimal places
   */
  function smartFormat(v) {
    if (v === 0) return '0';
    var abs = Math.abs(v);
    if (abs < 1e-9)  return v.toExponential(4);
    if (abs < 0.001) return parseFloat(v.toPrecision(5)).toString();
    if (abs < 1)     return parseFloat(v.toPrecision(7)).toString();

    // Round to 8 decimal places to eliminate floating-point noise,
    // then format with locale thousands separator
    var rounded = Math.round(v * 1e8) / 1e8;
    return rounded.toLocaleString('en-US', { maximumFractionDigits: 8 });
  }

  /* ─── Storage converter — core ───────────────────────────── */

  function bscConvert() {
    var raw   = $('bsc-value-input').value.trim();
    var unit  = $('bsc-unit-select').value;
    var errEl = $('bsc-conv-error');

    // Clear all active-unit highlights
    clearActiveHighlights();

    if (raw === '') {
      clearResults();
      errEl.classList.remove('bsc-visible');
      // Remove hash when input is cleared
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return;
    }

    var val = parseFloat(raw);

    if (isNaN(val) || val < 0) {
      errEl.classList.add('bsc-visible');
      clearResults();
      return;
    }

    errEl.classList.remove('bsc-visible');

    // Convert input to bytes (base unit)
    var bytes = val * BYTES[unit];

    // Populate every result cell
    for (var i = 0; i < ALL_UNITS.length; i++) {
      var u  = ALL_UNITS[i];
      var el = $('bsc-val-' + u);
      if (!el) continue;
      el.textContent = formatStorage(bytes, u) + ' ' + u;
      el.classList.remove('bsc-placeholder');
    }

    // Highlight the row that matches the selected input unit
    var activeRow = $('bsc-row-' + unit);
    if (activeRow) activeRow.classList.add('bsc-active-unit');

    // Persist state in URL hash for easy sharing/bookmarking
    history.replaceState(
      null, '',
      '#' + encodeURIComponent(val) + ',' + encodeURIComponent(unit)
    );
  }

  function clearResults() {
    for (var i = 0; i < ALL_UNITS.length; i++) {
      var el = $('bsc-val-' + ALL_UNITS[i]);
      if (!el) continue;
      el.textContent = '—';
      el.classList.add('bsc-placeholder');
    }
  }

  function clearActiveHighlights() {
    var rows = document.querySelectorAll('.bsc-result-row');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.remove('bsc-active-unit');
    }
  }

  /* ─── Copy single result cell ─────────────────────────────── */

  function bscCopyValue(id) {
    var el = $(id);
    if (!el || el.textContent === '—') return;
    // Strip the unit suffix and thousands commas, copy the raw number
    var raw = el.textContent.trim().replace(/,/g, '');
    // Remove trailing unit label (e.g. " GB")
    raw = raw.replace(/\s+[A-Za-z]+$/, '');
    copyText(raw);
  }

  /* ─── Copy all results ────────────────────────────────────── */

  function bscCopyAll() {
    var lines = [];
    for (var i = 0; i < ALL_UNITS.length; i++) {
      var u  = ALL_UNITS[i];
      var el = $('bsc-val-' + u);
      if (el && el.textContent !== '—') {
        lines.push(el.textContent.trim());
      }
    }
    if (lines.length === 0) return;
    copyText(lines.join('\n'));
  }

  /* ─── Clear button ────────────────────────────────────────── */

  function bscClear() {
    $('bsc-value-input').value = '';
    $('bsc-conv-error').classList.remove('bsc-visible');
    clearResults();
    clearActiveHighlights();
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /* ─── Duration helper ─────────────────────────────────────── */

  /**
   * Read HH / MM / SS fields and return total duration in seconds.
   * Returns 0 if all fields are empty or zero.
   */
  function getDuration(hhId, mmId, ssId) {
    var hh = Math.max(0, parseInt($(hhId).value) || 0);
    var mm = Math.max(0, parseInt($(mmId).value) || 0);
    var ss = Math.max(0, parseInt($(ssId).value) || 0);
    return hh * 3600 + mm * 60 + ss;
  }

  /* ─── Tab switcher ────────────────────────────────────────── */

  function bscSwitchTab(tab) {
    // Deactivate both
    $('bsc-tab-br').classList.remove('bsc-tab--active');
    $('bsc-tab-fs').classList.remove('bsc-tab--active');
    $('bsc-panel-br').classList.add('bsc-hidden');
    $('bsc-panel-fs').classList.add('bsc-hidden');

    // Activate selected
    $('bsc-tab-' + tab).classList.add('bsc-tab--active');
    $('bsc-panel-' + tab).classList.remove('bsc-hidden');
  }

  /* ─── Bitrate → File Size ─────────────────────────────────── */

  function bscCalcBitrate() {
    var brVal  = parseFloat($('bsc-br-value').value);
    var brUnit = $('bsc-br-unit').value;
    var dur    = getDuration('bsc-br-hh', 'bsc-br-mm', 'bsc-br-ss');
    var errEl  = $('bsc-br-error');
    var resEl  = $('bsc-br-results');

    if (isNaN(brVal) || brVal <= 0 || dur <= 0) {
      errEl.classList.add('bsc-visible');
      resEl.innerHTML = '';
      return;
    }
    errEl.classList.remove('bsc-visible');

    // bps → bytes: bytes = (bps × seconds) / 8
    var bps   = brVal * BPS[brUnit];
    var bytes = bps * dur / 8;

    var items = [
      { label: 'MB',  raw: bytes / BYTES['MB']  },
      { label: 'GB',  raw: bytes / BYTES['GB']  },
      { label: 'TB',  raw: bytes / BYTES['TB']  },
      { label: 'MiB', raw: bytes / BYTES['MiB'] },
      { label: 'GiB', raw: bytes / BYTES['GiB'] },
      { label: 'TiB', raw: bytes / BYTES['TiB'] }
    ];

    renderBitrateItems(resEl, items, 'bsc-brr');
  }

  /* ─── File Size → Bitrate ─────────────────────────────────── */

  function bscCalcFileSize() {
    var fsVal  = parseFloat($('bsc-fs-value').value);
    var fsUnit = $('bsc-fs-unit').value;
    var dur    = getDuration('bsc-fs-hh', 'bsc-fs-mm', 'bsc-fs-ss');
    var errEl  = $('bsc-fs-error');
    var resEl  = $('bsc-fs-results');

    if (isNaN(fsVal) || fsVal <= 0 || dur <= 0) {
      errEl.classList.add('bsc-visible');
      resEl.innerHTML = '';
      return;
    }
    errEl.classList.remove('bsc-visible');

    // bytes → bps: bps = (bytes × 8) / seconds
    var bytes = fsVal * BYTES[fsUnit];
    var bps   = bytes * 8 / dur;

    var items = [
      { label: 'bps',  raw: bps                 },
      { label: 'Kbps', raw: bps / BPS['Kbps']   },
      { label: 'Mbps', raw: bps / BPS['Mbps']   },
      { label: 'Gbps', raw: bps / BPS['Gbps']   }
    ];

    renderBitrateItems(resEl, items, 'bsc-fsr');
  }

  /**
   * Build and inject result cards into a container element.
   *
   * @param {Element} container - target DOM element
   * @param {Array}   items     - [{label, raw}] value objects
   * @param {string}  prefix    - ID prefix for result value spans
   */
  function renderBitrateItems(container, items, prefix) {
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var item      = items[i];
      var formatted = smartFormat(item.raw);
      var safeId    = prefix + '-' + item.label;

      html +=
        '<div class="bsc-br-result-item">' +
          '<span class="bsc-br-result-label">' + item.label + '</span>' +
          '<span class="bsc-br-result-value" id="' + safeId + '">' + formatted + '</span>' +
          '<button class="bsc-br-copy-btn" onclick="bscCopyBrValue(\'' + safeId + '\')" title="Copy ' + item.label + '">📋</button>' +
        '</div>';
    }
    container.innerHTML = html;
  }

  /* ─── Copy individual bitrate result ─────────────────────── */

  function bscCopyBrValue(id) {
    var el = $(id);
    if (!el) return;
    copyText(el.textContent.trim().replace(/,/g, ''));
  }

  /* ─── URL hash restore ────────────────────────────────────── */

  /**
   * On page load, read the URL hash and pre-fill the converter inputs.
   * Hash format: #<value>,<unit>   e.g. #1.5,GB
   */
  function restoreFromHash() {
    var hash = window.location.hash.replace('#', '');
    if (!hash) return;
    try {
      var parts = decodeURIComponent(hash).split(',');
      if (parts.length !== 2) return;
      var val  = parseFloat(parts[0]);
      var unit = parts[1];
      if (!isNaN(val) && val >= 0 && BYTES[unit] !== undefined) {
        $('bsc-value-input').value  = val;
        $('bsc-unit-select').value  = unit;
        bscConvert();
      }
    } catch (e) {
      // Ignore malformed or unexpected hash values
    }
  }

  /* ─── Keyboard support ────────────────────────────────────── */

  function bindEnterKeys() {
    var converterInputs = ['bsc-value-input'];
    var bitrateInputs   = ['bsc-br-value', 'bsc-br-hh', 'bsc-br-mm', 'bsc-br-ss'];
    var filesizeInputs  = ['bsc-fs-value', 'bsc-fs-hh', 'bsc-fs-mm', 'bsc-fs-ss'];

    function bindGroup(ids, handler) {
      for (var i = 0; i < ids.length; i++) {
        (function (id) {
          var el = $(id);
          if (!el) return;
          el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') handler();
          });
        })(ids[i]);
      }
    }

    bindGroup(converterInputs, bscConvert);
    bindGroup(bitrateInputs,   bscCalcBitrate);
    bindGroup(filesizeInputs,  bscCalcFileSize);
  }

  /* ─── Init ────────────────────────────────────────────────── */

  function init() {
    clearResults();
    restoreFromHash();
    bindEnterKeys();
  }

  /* ─── Expose to global scope for HTML onclick handlers ──────
     Prefix: bsc to avoid any collision with page globals.     */
  window.bscConvert       = bscConvert;
  window.bscClear         = bscClear;
  window.bscCopyValue     = bscCopyValue;
  window.bscCopyAll       = bscCopyAll;
  window.bscSwitchTab     = bscSwitchTab;
  window.bscCalcBitrate   = bscCalcBitrate;
  window.bscCalcFileSize  = bscCalcFileSize;
  window.bscCopyBrValue   = bscCopyBrValue;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      BYTES: BYTES,
      BPS: BPS,
      DECIMAL_UNITS: DECIMAL_UNITS,
      BINARY_UNITS: BINARY_UNITS,
      ALL_UNITS: ALL_UNITS,
      smartFormat: smartFormat,
      formatStorage: formatStorage
    };
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();