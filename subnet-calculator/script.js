/**
 * IP Subnet Calculator — script.js
 * Namespace: snc- (subnet calculator)
 * All DOM selectors use snc- prefixed IDs and classes.
 * No global pollution — wrapped in IIFE.
 */
(function () {
  'use strict';

  // ========== IP MATH UTILITIES ==========

  /**
   * Convert dotted-quad IP string to 32-bit unsigned integer.
   * @param {string} ip - e.g. "192.168.1.0"
   * @returns {number} unsigned 32-bit integer
   */
  function ipToLong(ip) {
    var parts = ip.split('.');
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  }

  /**
   * Convert 32-bit unsigned integer back to dotted-quad string.
   * @param {number} n - unsigned 32-bit integer
   * @returns {string} dotted-quad IP
   */
  function longToIp(n) {
    return [
      (n >>> 24) & 0xFF,
      (n >>> 16) & 0xFF,
      (n >>> 8) & 0xFF,
      n & 0xFF
    ].join('.');
  }

  /**
   * Convert 32-bit unsigned integer to binary string with dots between octets.
   * @param {number} n
   * @returns {string} e.g. "11000000.10101000.00000001.00000000"
   */
  function longToBinary(n) {
    return [
      ((n >>> 24) & 0xFF).toString(2).padStart(8, '0'),
      ((n >>> 16) & 0xFF).toString(2).padStart(8, '0'),
      ((n >>> 8) & 0xFF).toString(2).padStart(8, '0'),
      (n & 0xFF).toString(2).padStart(8, '0')
    ].join('.');
  }

  /**
   * Determine the IP class (A-E) based on the first octet.
   */
  function getIpClass(firstOctet) {
    if (firstOctet < 128) return 'A';
    if (firstOctet < 192) return 'B';
    if (firstOctet < 224) return 'C';
    if (firstOctet < 240) return 'D (Multicast)';
    return 'E (Reserved)';
  }

  /**
   * Determine whether the IP address is private, public, loopback, etc.
   * Returns an object with type label and CSS class for the tag.
   */
  function getIpType(ipLong) {
    var a = (ipLong >>> 24) & 0xFF;
    var b = (ipLong >>> 16) & 0xFF;

    if (a === 127) return { type: 'Loopback', cssClass: 'snc-tag--loopback' };
    if (a === 169 && b === 254) return { type: 'Link-Local', cssClass: 'snc-tag--linklocal' };
    if (a === 10) return { type: 'Private (RFC 1918)', cssClass: 'snc-tag--private' };
    if (a === 172 && b >= 16 && b <= 31) return { type: 'Private (RFC 1918)', cssClass: 'snc-tag--private' };
    if (a === 192 && b === 168) return { type: 'Private (RFC 1918)', cssClass: 'snc-tag--private' };

    return { type: 'Public', cssClass: 'snc-tag--public' };
  }

  /**
   * Validate dotted-quad IP address string.
   * @param {string} ip
   * @returns {boolean}
   */
  function validateIp(ip) {
    var parts = ip.trim().split('.');
    if (parts.length !== 4) return false;
    return parts.every(function (p) {
      var n = Number(p);
      return Number.isInteger(n) && n >= 0 && n <= 255 && p === String(n);
    });
  }

  // ========== DOM HELPERS ==========

  var $ = function (id) { return document.getElementById(id); };

  function showError(msg) {
    var el = $('snc-error-msg');
    el.textContent = msg;
    el.classList.add('snc-visible');
  }

  function hideError() {
    $('snc-error-msg').classList.remove('snc-visible');
  }

  function showToast() {
    var toast = $('snc-toast');
    toast.classList.add('snc-show');
    setTimeout(function () { toast.classList.remove('snc-show'); }, 2000);
  }

  // ========== CORE CALCULATION ==========

  function calculate() {
    var ipRaw = $('snc-ip-input').value.trim();
    var cidrRaw = $('snc-cidr-input').value.trim();
    var resultsEl = $('snc-results-section');

    // Handle combined notation like 192.168.1.0/24 pasted into IP field
    var ip = ipRaw;
    var cidr = parseInt(cidrRaw, 10);

    if (ipRaw.includes('/')) {
      var parts = ipRaw.split('/');
      ip = parts[0];
      cidr = parseInt(parts[1], 10);
      $('snc-cidr-input').value = cidr;
    }

    // Validate IP
    if (!validateIp(ip)) {
      showError('Invalid IP address. Use dotted-quad format, e.g. 192.168.1.0');
      resultsEl.classList.remove('snc-visible');
      return;
    }

    // Validate CIDR
    if (isNaN(cidr) || cidr < 0 || cidr > 32) {
      showError('CIDR prefix must be between 0 and 32.');
      resultsEl.classList.remove('snc-visible');
      return;
    }

    hideError();

    // Core math
    var ipLong = ipToLong(ip);
    var mask = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
    var wildcard = (~mask) >>> 0;
    var network = (ipLong & mask) >>> 0;
    var broadcast = (network | wildcard) >>> 0;
    var totalIps = Math.pow(2, 32 - cidr);

    var firstHost, lastHost, usableHosts;
    if (cidr === 32) {
      firstHost = network;
      lastHost = network;
      usableHosts = 1;
    } else if (cidr === 31) {
      // Point-to-point link (RFC 3021) — no broadcast wasted
      firstHost = network;
      lastHost = broadcast;
      usableHosts = 2;
    } else {
      firstHost = (network + 1) >>> 0;
      lastHost = (broadcast - 1) >>> 0;
      usableHosts = totalIps - 2;
    }

    var firstOctet = (ipLong >>> 24) & 0xFF;
    var ipClass = getIpClass(firstOctet);
    var ipType = getIpType(ipLong);

    // Build result rows
    var rows = [
      { label: 'IP Address',       value: ip,                       binary: longToBinary(ipLong) },
      { label: 'Network Address',   value: longToIp(network),        binary: longToBinary(network) },
      { label: 'Broadcast',         value: longToIp(broadcast),      binary: longToBinary(broadcast) },
      { label: 'Subnet Mask',       value: longToIp(mask),           binary: longToBinary(mask) },
      { label: 'Wildcard Mask',     value: longToIp(wildcard),       binary: longToBinary(wildcard) },
      { label: 'First Usable Host', value: longToIp(firstHost) },
      { label: 'Last Usable Host',  value: longToIp(lastHost) },
      { label: 'Total IPs',         value: totalIps.toLocaleString() },
      { label: 'Usable Hosts',      value: usableHosts.toLocaleString() },
      { label: 'CIDR Notation',     value: longToIp(network) + '/' + cidr },
      { label: 'IP Class',          value: ipClass, tag: 'snc-tag--class' },
      { label: 'IP Type',           value: ipType.type, tag: ipType.cssClass }
    ];

    renderResults(rows);
    renderBinaryBreakdown(ipLong, mask, cidr);
    highlightQuickMask(cidr);

    resultsEl.classList.add('snc-visible');

    // Update URL hash for bookmarking / sharing
    history.replaceState(null, '', '#' + ip + '/' + cidr);
  }

  // ========== RENDERING ==========

  function renderResults(rows) {
    var grid = $('snc-results-grid');
    grid.innerHTML = rows.map(function (r) {
      var valueHtml = '<span>' + r.value + '</span>';
      if (r.binary) {
        valueHtml += ' <span class="snc-binary">' + r.binary + '</span>';
      }
      if (r.tag) {
        valueHtml = '<span class="snc-tag ' + r.tag + '">' + r.value + '</span>';
      }
      return '<div class="snc-result-row">' +
               '<div class="snc-result-label">' + r.label + '</div>' +
               '<div class="snc-result-value">' + valueHtml + '</div>' +
             '</div>';
    }).join('');
  }

  /**
   * Render the binary visual breakdown — network bits vs host bits.
   */
  function renderBinaryBreakdown(ipLong, mask, cidr) {
    var container = $('snc-binary-breakdown');
    var ipBits = (ipLong >>> 0).toString(2).padStart(32, '0');
    var maskBits = (mask >>> 0).toString(2).padStart(32, '0');

    function colorize(bits, mBits) {
      var html = '';
      for (var i = 0; i < 32; i++) {
        if (i > 0 && i % 8 === 0) {
          html += '<span style="color:var(--snc-text-muted)">.</span>';
        }
        var cls = mBits[i] === '1' ? 'snc-bit--network' : 'snc-bit--host';
        html += '<span class="' + cls + '">' + bits[i] + '</span>';
      }
      return html;
    }

    container.innerHTML =
      '<h3>Binary Breakdown</h3>' +
      '<div class="snc-binary-row">' +
        '<span class="snc-binary-label">IP Address</span>' +
        '<span class="snc-bits">' + colorize(ipBits, maskBits) + '</span>' +
      '</div>' +
      '<div class="snc-binary-row">' +
        '<span class="snc-binary-label">Subnet Mask</span>' +
        '<span class="snc-bits">' + colorize(maskBits, maskBits) + '</span>' +
      '</div>' +
      '<div class="snc-binary-legend">' +
        '<span><span class="snc-dot--network">&#9632;</span> Network bits (' + cidr + ')</span>' +
        '<span><span class="snc-dot--host">&#9632;</span> Host bits (' + (32 - cidr) + ')</span>' +
      '</div>';
  }

  // ========== QUICK MASKS ==========

  var COMMON_CIDRS = [8, 16, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

  function buildQuickMasks() {
    var container = $('snc-quick-masks');
    COMMON_CIDRS.forEach(function (c) {
      var btn = document.createElement('button');
      btn.textContent = '/' + c;
      btn.dataset.cidr = c;
      btn.addEventListener('click', function () {
        $('snc-cidr-input').value = c;
        calculate();
      });
      container.appendChild(btn);
    });
  }

  function highlightQuickMask(cidr) {
    var buttons = document.querySelectorAll('.snc-quick-masks button');
    buttons.forEach(function (btn) {
      btn.classList.toggle('snc-active', parseInt(btn.dataset.cidr, 10) === cidr);
    });
  }

  // ========== CHEAT SHEET ==========

  function buildCheatsheet() {
    var tbody = $('snc-cheat-table-body');
    var html = '';

    for (var c = 32; c >= 8; c--) {
      var total = Math.pow(2, 32 - c);
      var usable = c >= 31 ? (c === 32 ? 1 : 2) : total - 2;
      var m = c === 0 ? 0 : (~0 << (32 - c)) >>> 0;
      var highlight = (c === 8 || c === 16 || c === 24) ? ' class="snc-highlight"' : '';

      html += '<tr' + highlight + '>' +
        '<td>/' + c + '</td>' +
        '<td>' + longToIp(m) + '</td>' +
        '<td>' + usable.toLocaleString() + '</td>' +
        '<td>' + total.toLocaleString() + '</td>' +
      '</tr>';
    }

    tbody.innerHTML = html;
  }

  function toggleCheatsheet() {
    $('snc-cheat-body').classList.toggle('snc-open');
    $('snc-cheat-arrow').classList.toggle('snc-open');
  }

  // ========== COPY ALL ==========

  function copyAll() {
    var rows = document.querySelectorAll('#snc-results-grid .snc-result-row');
    var text = '';

    rows.forEach(function (row) {
      var label = row.querySelector('.snc-result-label').textContent.trim();
      var valueEl = row.querySelector('.snc-result-value');
      var spans = valueEl.querySelectorAll('span');
      var value = spans[0] ? spans[0].textContent.trim() : '';
      text += label + ': ' + value + '\n';
    });

    var trimmed = text.trim();

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(trimmed).then(showToast).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }

    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = trimmed;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast();
    }
  }

  // ========== KEYBOARD SUPPORT ==========

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var id = document.activeElement && document.activeElement.id;
      if (id === 'snc-ip-input' || id === 'snc-cidr-input') {
        calculate();
      }
    }
  });

  // ========== PUBLIC API (attach to buttons via onclick or event listeners) ==========
  // Expose needed functions to global scope for inline onclick handlers in HTML.

  window.sncCalculate = calculate;
  window.sncCopyAll = copyAll;
  window.sncToggleCheatsheet = toggleCheatsheet;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ipToLong: ipToLong,
      longToIp: longToIp,
      longToBinary: longToBinary,
      getIpClass: getIpClass,
      getIpType: getIpType,
      validateIp: validateIp
    };
    return;
  }

  // ========== INIT ==========

  buildQuickMasks();
  buildCheatsheet();

  // Auto-calculate from URL hash (e.g. #192.168.1.0/24)
  if (location.hash) {
    var hash = location.hash.slice(1);
    if (hash.includes('/')) {
      var hashParts = hash.split('/');
      $('snc-ip-input').value = hashParts[0];
      $('snc-cidr-input').value = hashParts[1];
      calculate();
    }
  }
})();
