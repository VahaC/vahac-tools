// Hash Generator — script.js
// Namespace prefix: hsg-
// No external dependencies — MD5 is implemented natively (RFC 1321).
// SHA-1/256/512 use the browser's built-in Web Crypto API (SubtleCrypto).
// Web Crypto requires a secure context (HTTPS or localhost).

(function () {
  'use strict';

  /* ── Shorthand ── */
  var $ = function (id) { return document.getElementById(id); };

  /* ── State ── */
  var currentTab   = 'text';
  var isUpperCase  = false;
  var fileInFlight = false;
  var hashes = { md5: '', sha1: '', sha256: '', sha512: '' };

  // Map hash hex length → algorithm key
  var LENGTH_MAP = { 32: 'md5', 40: 'sha1', 64: 'sha256', 128: 'sha512' };

  /* ══════════════════════════════════════════════════════════════
     MD5 — RFC 1321 native implementation
     No external library required.
     Supports: strings (UTF-8) and ArrayBuffers.
  ══════════════════════════════════════════════════════════════ */

  // Per-round shift amounts  (RFC 1321 §3.4)
  var MD5_S = [
     7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
     5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
     4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
     6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21
  ];

  // T[i] = floor(abs(sin(i+1)) * 2^32)  (RFC 1321 §3.4)
  var MD5_T = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];

  /**
   * Process a pre-padded Uint8Array (length must be a multiple of 64).
   * Returns a 32-char lowercase hex string.
   */
  function md5Blocks(data) {
    var h0 = 0x67452301, h1 = 0xEFCDAB89,
        h2 = 0x98BADCFE, h3 = 0x10325476;

    var M = new Int32Array(16);

    for (var blk = 0, nBlks = (data.length / 64) | 0; blk < nBlks; blk++) {
      var off = blk * 64;

      for (var j = 0; j < 16; j++) {
        var p = off + j * 4;
        M[j] = data[p] | (data[p+1] << 8) | (data[p+2] << 16) | (data[p+3] << 24);
      }

      var A = h0, B = h1, C = h2, D = h3;

      for (var i = 0; i < 64; i++) {
        var F, g;
        if      (i < 16) { F = (B & C) | (~B & D);  g = i; }
        else if (i < 32) { F = (D & B) | (~D & C);  g = (5*i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D;            g = (3*i + 5) % 16; }
        else             { F = C ^ (B | ~D);          g = (7*i) % 16; }

        F = (F + A + M[g] + MD5_T[i]) | 0;
        A  = D;
        D  = C;
        C  = B;
        var s = MD5_S[i];
        B  = (B + ((F << s) | (F >>> (32 - s)))) | 0;
      }

      h0 = (h0 + A) | 0;
      h1 = (h1 + B) | 0;
      h2 = (h2 + C) | 0;
      h3 = (h3 + D) | 0;
    }

    // Output: little-endian hex (LSB byte first per word)
    var hex = '';
    var state = [h0, h1, h2, h3];
    for (var si = 0; si < 4; si++) {
      for (var bi = 0; bi < 4; bi++) {
        var bv = (state[si] >>> (bi * 8)) & 0xFF;
        hex += (bv < 16 ? '0' : '') + bv.toString(16);
      }
    }
    return hex;
  }

  /**
   * Append MD5 padding to a Uint8Array view of the message.
   * Uses BigInt for the 64-bit length field — handles any file size correctly.
   */
  function md5Pad(src, len) {
    var padLen = len + 1;
    while (padLen % 64 !== 56) padLen++;
    padLen += 8;

    var out = new Uint8Array(padLen);
    out.set(src.subarray(0, len));
    out[len] = 0x80;
    // Zeros already initialised by Uint8Array

    var lenBits = BigInt(len) * 8n;
    for (var k = 0; k < 8; k++) {
      out[padLen - 8 + k] = Number((lenBits >> BigInt(k * 8)) & 0xFFn);
    }
    return out;
  }

  /** MD5 of a JS string (UTF-8 encoded). */
  function md5String(str) {
    var utf8 = new TextEncoder().encode(str);
    return md5Blocks(md5Pad(utf8, utf8.length));
  }

  /** MD5 of an ArrayBuffer. */
  function md5Buffer(buffer) {
    var arr = new Uint8Array(buffer);
    return md5Blocks(md5Pad(arr, arr.length));
  }

  /* ══════════════════════════════════════════════
     TAB SWITCHING
  ══════════════════════════════════════════════ */
  function switchTab(tab) {
    currentTab = tab;
    ['text', 'file'].forEach(function (t) {
      var section = $('hsg-section-' + t);
      var tabBtn  = $('hsg-tab-' + t);
      if (t === tab) {
        section.classList.remove('hsg-hidden');
        tabBtn.classList.add('hsg-tab--active');
        tabBtn.setAttribute('aria-selected', 'true');
      } else {
        section.classList.add('hsg-hidden');
        tabBtn.classList.remove('hsg-tab--active');
        tabBtn.setAttribute('aria-selected', 'false');
      }
    });
    clearResults();
    runVerify();
    if (tab === 'text') hashText();
  }

  /* ══════════════════════════════════════════════
     TEXT HASHING
  ══════════════════════════════════════════════ */
  function hashText() {
    var text = $('hsg-text-input').value;
    var len  = text.length;
    $('hsg-char-count').textContent = len + (len === 1 ? ' character' : ' characters');

    if (len === 0) {
      clearResults();
      return;
    }

    // MD5 — synchronous, native, no CDN needed
    hashes.md5 = md5String(text);
    renderOne('md5', hashes.md5);
    setCopyButtons(true);

    // SHA-1/256/512 — Web Crypto (async)
    var data = new TextEncoder().encode(text);
    Promise.all([
      crypto.subtle.digest('SHA-1',   data),
      crypto.subtle.digest('SHA-256', data),
      crypto.subtle.digest('SHA-512', data)
    ]).then(function (bufs) {
      hashes.sha1   = bufToHex(bufs[0]);
      hashes.sha256 = bufToHex(bufs[1]);
      hashes.sha512 = bufToHex(bufs[2]);
      renderOne('sha1',   hashes.sha1);
      renderOne('sha256', hashes.sha256);
      renderOne('sha512', hashes.sha512);
      setCopyButtons(true);
      runVerify();
    }).catch(function (err) {
      console.error('[hsg] Web Crypto error:', err);
    });
  }

  function textKey() { /* textarea handles Enter natively */ }

  function clearText() {
    $('hsg-text-input').value = '';
    $('hsg-char-count').textContent = '0 characters';
    clearResults();
    clearVerify();
  }

  /* ══════════════════════════════════════════════
     FILE HANDLING
  ══════════════════════════════════════════════ */
  function triggerFile() {
    if (!fileInFlight) $('hsg-file-input').click();
  }

  function dragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    $('hsg-drop-zone').classList.add('hsg-drop-zone--active');
  }

  function dragLeave(e) {
    e.stopPropagation();
    $('hsg-drop-zone').classList.remove('hsg-drop-zone--active');
  }

  function drop(e) {
    e.preventDefault();
    e.stopPropagation();
    $('hsg-drop-zone').classList.remove('hsg-drop-zone--active');
    var file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) fileChosen(file);
  }

  function fileChosen(file) {
    if (!file) return;
    clearResults();
    fileInFlight = true;

    $('hsg-drop-zone').classList.add('hsg-hidden');
    $('hsg-file-info').classList.remove('hsg-hidden');
    $('hsg-file-name').textContent = file.name;
    $('hsg-file-meta').textContent = formatBytes(file.size) +
      (file.type ? '  ·  ' + file.type : '');
    $('hsg-file-thumb').textContent = fileEmoji(file.name);

    var progressWrap = $('hsg-progress-wrap');
    progressWrap.classList.remove('hsg-hidden');
    setProgress(0);

    var reader = new FileReader();
    reader.onprogress = function (e) {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 90));
    };
    reader.onload = function (e) {
      setProgress(95);
      computeFileHashes(e.target.result, function () {
        setProgress(100);
        setTimeout(function () { progressWrap.classList.add('hsg-hidden'); }, 700);
        fileInFlight = false;
        runVerify();
      });
    };
    reader.onerror = function () {
      progressWrap.classList.add('hsg-hidden');
      fileInFlight = false;
      console.error('[hsg] FileReader error');
    };
    reader.readAsArrayBuffer(file);
  }

  function computeFileHashes(buffer, done) {
    hashes.md5 = md5Buffer(buffer);
    renderOne('md5', hashes.md5);

    Promise.all([
      crypto.subtle.digest('SHA-1',   buffer),
      crypto.subtle.digest('SHA-256', buffer),
      crypto.subtle.digest('SHA-512', buffer)
    ]).then(function (bufs) {
      hashes.sha1   = bufToHex(bufs[0]);
      hashes.sha256 = bufToHex(bufs[1]);
      hashes.sha512 = bufToHex(bufs[2]);
      renderOne('sha1',   hashes.sha1);
      renderOne('sha256', hashes.sha256);
      renderOne('sha512', hashes.sha512);
      setCopyButtons(true);
      done();
    }).catch(function (err) {
      console.error('[hsg] Web Crypto file error:', err);
      done();
    });
  }

  function clearFile() {
    $('hsg-file-input').value = '';
    $('hsg-file-info').classList.add('hsg-hidden');
    $('hsg-drop-zone').classList.remove('hsg-hidden');
    $('hsg-drop-zone').classList.remove('hsg-drop-zone--active');
    $('hsg-progress-wrap').classList.add('hsg-hidden');
    clearResults();
    clearVerify();
    fileInFlight = false;
  }

  /* ══════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════ */
  function renderOne(algo, raw) {
    var el = $('hsg-hash-' + algo);
    if (!el) return;
    el.textContent = raw ? (isUpperCase ? raw.toUpperCase() : raw) : '—';
  }

  function renderAll() {
    ['md5', 'sha1', 'sha256', 'sha512'].forEach(function (a) { renderOne(a, hashes[a]); });
  }

  function clearResults() {
    hashes = { md5: '', sha1: '', sha256: '', sha512: '' };
    ['md5', 'sha1', 'sha256', 'sha512'].forEach(function (algo) {
      $('hsg-hash-' + algo).textContent = '—';
      var badge = $('hsg-verify-badge-' + algo);
      badge.textContent = '';
      badge.className   = 'hsg-verify-badge hsg-hidden';
      $('hsg-card-' + algo).classList.remove('hsg-card--match', 'hsg-card--nomatch');
    });
    setCopyButtons(false);
  }

  function setCopyButtons(enabled) {
    ['md5', 'sha1', 'sha256', 'sha512'].forEach(function (algo) {
      var btn = $('hsg-copy-' + algo);
      if (btn) btn.disabled = !(enabled && hashes[algo]);
    });
    $('hsg-copy-all-btn').disabled = !(hashes.md5 || hashes.sha1 || hashes.sha256 || hashes.sha512);
  }

  /* ══════════════════════════════════════════════
     UPPERCASE TOGGLE
  ══════════════════════════════════════════════ */
  function toggleCase() {
    isUpperCase = $('hsg-uppercase').checked;
    renderAll();
    runVerify();
  }

  /* ══════════════════════════════════════════════
     COPY
  ══════════════════════════════════════════════ */
  function copy(algo) {
    var val = hashes[algo];
    if (!val) return;
    copyToClipboard(isUpperCase ? val.toUpperCase() : val);
  }

  function copyAll() {
    copyToClipboard([
      'MD5:     ' + fmt('md5'),
      'SHA-1:   ' + fmt('sha1'),
      'SHA-256: ' + fmt('sha256'),
      'SHA-512: ' + fmt('sha512')
    ].join('\n'));
  }

  function fmt(algo) {
    var v = hashes[algo];
    return v ? (isUpperCase ? v.toUpperCase() : v) : '—';
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showToast).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    showToast();
  }

  /* ══════════════════════════════════════════════
     VERIFY
  ══════════════════════════════════════════════ */
  function runVerify() {
    var input = $('hsg-verify-input').value.trim();
    var hint  = $('hsg-verify-hint');

    ['md5', 'sha1', 'sha256', 'sha512'].forEach(function (algo) {
      var badge = $('hsg-verify-badge-' + algo);
      badge.textContent = '';
      badge.className   = 'hsg-verify-badge hsg-hidden';
      $('hsg-card-' + algo).classList.remove('hsg-card--match', 'hsg-card--nomatch');
    });
    hint.textContent = '';

    if (!input) return;
    if (!/^[0-9a-fA-F]+$/.test(input)) { hint.textContent = '⚠ Not a valid hex string.'; return; }

    var algo = LENGTH_MAP[input.length];
    if (!algo) { hint.textContent = '⚠ Unrecognised length (' + input.length + '). Expected 32/40/64/128.'; return; }
    if (!hashes[algo]) { hint.textContent = 'ℹ No computed hash to compare — enter text or drop a file first.'; return; }

    var isMatch = hashes[algo].toLowerCase() === input.toLowerCase();
    var badge   = $('hsg-verify-badge-' + algo);
    badge.className   = 'hsg-verify-badge hsg-verify-badge--' + (isMatch ? 'match' : 'nomatch');
    badge.textContent = isMatch ? '✅ Match!' : '❌ No match';
    $('hsg-card-' + algo).classList.add(isMatch ? 'hsg-card--match' : 'hsg-card--nomatch');
    hint.textContent  = isMatch
      ? '✅ Hash matches the ' + algo.toUpperCase() + ' digest.'
      : '❌ Hash does NOT match the ' + algo.toUpperCase() + ' digest.';
  }

  function clearVerify() {
    $('hsg-verify-input').value = '';
    runVerify();
  }

  /* ══════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════ */
  function bufToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); })
      .join('');
  }

  function formatBytes(n) {
    if (n === 0)        return '0 B';
    if (n < 1024)       return n + ' B';
    if (n < 1048576)    return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(2) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function fileEmoji(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    return ({
      pdf:'📕', doc:'📝', docx:'📝', txt:'📄', md:'📄',
      zip:'📦', tar:'📦', gz:'📦', '7z':'📦', rar:'📦', xz:'📦',
      iso:'💿', img:'💿', dmg:'💿',
      jpg:'🖼', jpeg:'🖼', png:'🖼', gif:'🖼', webp:'🖼', svg:'🖼',
      mp4:'🎬', mkv:'🎬', avi:'🎬', mov:'🎬',
      mp3:'🎵', flac:'🎵', wav:'🎵', ogg:'🎵',
      js:'🟨', ts:'🔷', py:'🐍', sh:'⬛', bash:'⬛',
      json:'📋', xml:'📋', csv:'📊', xlsx:'📊',
      exe:'⚙', bin:'⚙', deb:'⚙', rpm:'⚙'
    })[ext] || '📄';
  }

  function setProgress(pct) {
    $('hsg-progress-fill').style.width = pct + '%';
    $('hsg-progress-pct').textContent  = pct + '%';
  }

  var toastTimer = null;
  function showToast() {
    var t = $('hsg-toast');
    t.classList.add('hsg-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('hsg-show'); }, 2000);
  }

  /* ── Expose to global scope (onclick handlers in HTML) ── */
  window.hsgSwitchTab   = switchTab;
  window.hsgHashText    = hashText;
  window.hsgTextKey     = textKey;
  window.hsgClearText   = clearText;
  window.hsgTriggerFile = triggerFile;
  window.hsgDragOver    = dragOver;
  window.hsgDragLeave   = dragLeave;
  window.hsgDrop        = drop;
  window.hsgFileChosen  = fileChosen;
  window.hsgClearFile   = clearFile;
  window.hsgToggleCase  = toggleCase;
  window.hsgCopy        = copy;
  window.hsgCopyAll     = copyAll;
  window.hsgRunVerify   = runVerify;
  window.hsgClearVerify = clearVerify;

  document.addEventListener('DOMContentLoaded', function () {
    $('hsg-char-count').textContent = '0 characters';
  });

})();
