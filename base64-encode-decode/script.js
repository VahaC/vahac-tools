// Base64 Encode / Decode — script.js
// Namespace prefix: b64-
// No external dependencies. Base64 is implemented natively (RFC 4648) instead of
// relying on btoa/atob, which only handle Latin-1 strings and choke on binary data.

(function () {
  'use strict';

  /* ── Shorthand ── */
  var $ = function (id) { return document.getElementById(id); };

  /* ── Alphabets (RFC 4648 §4 standard, §5 URL-safe) ── */
  var B64_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  // Reverse lookup: char code → 6-bit value (-1 = not a Base64 character).
  // Both alphabets share one table, so decoding accepts either variant.
  var B64_REV = (function () {
    var table = new Int16Array(128);
    for (var i = 0; i < 128; i++) table[i] = -1;
    for (var j = 0; j < 64; j++) {
      table[B64_STD.charCodeAt(j)] = j;
      table[B64_URL.charCodeAt(j)] = j;
    }
    return table;
  })();

  var MIME_LINE_WIDTH = 76;          // RFC 2045 §6.8
  var MAX_DISPLAY_CHARS = 400000;    // keep the textarea responsive on huge files
  var MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

  /* ── State ── */
  var direction    = 'encode';
  var currentTab   = 'text';
  var fileBase64   = '';   // full (untruncated) Base64 of the selected file
  var fileName     = '';
  var fileMime     = '';
  var fileInFlight = false;
  var decodedBytes = null;
  var decodedMime  = '';
  var previewUrl   = null;

  /* ══════════════════════════════════════════════════════════════
     CORE — Base64 primitives
  ══════════════════════════════════════════════════════════════ */

  /**
   * Encode bytes to Base64.
   * opts: { urlSafe: bool, pad: bool (default true), wrap: bool }
   */
  function bytesToBase64(bytes, opts) {
    opts = opts || {};
    var alpha = opts.urlSafe ? B64_URL : B64_STD;
    var pad   = opts.pad !== false;
    var parts = [];
    var chunk = '';
    var i = 0;

    for (; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      chunk += alpha[(n >>> 18) & 63] + alpha[(n >>> 12) & 63] +
               alpha[(n >>> 6) & 63]  + alpha[n & 63];
      // Flush periodically — string concat on multi-MB files is otherwise slow
      if (chunk.length >= 8192) { parts.push(chunk); chunk = ''; }
    }

    var rem = bytes.length - i;
    if (rem === 1) {
      var a = bytes[i] << 16;
      chunk += alpha[(a >>> 18) & 63] + alpha[(a >>> 12) & 63];
      if (pad) chunk += '==';
    } else if (rem === 2) {
      var b = (bytes[i] << 16) | (bytes[i + 1] << 8);
      chunk += alpha[(b >>> 18) & 63] + alpha[(b >>> 12) & 63] + alpha[(b >>> 6) & 63];
      if (pad) chunk += '=';
    }
    parts.push(chunk);

    var out = parts.join('');
    return opts.wrap ? wrapLines(out, MIME_LINE_WIDTH) : out;
  }

  /**
   * Decode a Base64 string to bytes.
   * Tolerant of: whitespace/line breaks, URL-safe alphabet, missing padding.
   * Throws an Error with a human-readable message on invalid input.
   */
  function base64ToBytes(str) {
    var clean = String(str).replace(/\s+/g, '');

    // Strip padding — it carries no information once the length is known
    var padStripped = clean.replace(/=+$/, '');
    if (padStripped.indexOf('=') !== -1) {
      throw new Error('Invalid Base64: "=" padding may only appear at the very end.');
    }

    for (var c = 0; c < padStripped.length; c++) {
      var code = padStripped.charCodeAt(c);
      if (code > 127 || B64_REV[code] === -1) {
        throw new Error('Invalid Base64 character "' + padStripped.charAt(c) +
                        '" at position ' + (c + 1) + '.');
      }
    }

    var len = padStripped.length;
    if (len % 4 === 1) {
      throw new Error('Invalid Base64 length (' + len + ' chars) — a Base64 group is never 1 character.');
    }

    var outLen = (len * 3) >> 2;         // floor(len * 3 / 4)
    var out = new Uint8Array(outLen);
    var o = 0;
    var i = 0;

    for (; i + 3 < len; i += 4) {
      var n = (B64_REV[padStripped.charCodeAt(i)]     << 18) |
              (B64_REV[padStripped.charCodeAt(i + 1)] << 12) |
              (B64_REV[padStripped.charCodeAt(i + 2)] << 6)  |
               B64_REV[padStripped.charCodeAt(i + 3)];
      out[o++] = (n >>> 16) & 255;
      out[o++] = (n >>> 8) & 255;
      out[o++] = n & 255;
    }

    var tail = len - i;
    if (tail === 2) {
      var t2 = (B64_REV[padStripped.charCodeAt(i)] << 18) |
               (B64_REV[padStripped.charCodeAt(i + 1)] << 12);
      out[o++] = (t2 >>> 16) & 255;
    } else if (tail === 3) {
      var t3 = (B64_REV[padStripped.charCodeAt(i)]     << 18) |
               (B64_REV[padStripped.charCodeAt(i + 1)] << 12) |
               (B64_REV[padStripped.charCodeAt(i + 2)] << 6);
      out[o++] = (t3 >>> 16) & 255;
      out[o++] = (t3 >>> 8) & 255;
    }

    return out;
  }

  /** Encode a JS string (UTF-8) to Base64. */
  function encodeText(str, opts) {
    return bytesToBase64(new TextEncoder().encode(str), opts);
  }

  /** Decode Base64 to a UTF-8 string. */
  function decodeText(str) {
    return new TextDecoder('utf-8').decode(base64ToBytes(str));
  }

  /** Split a string into fixed-width lines. */
  function wrapLines(str, width) {
    if (!str) return '';
    var lines = [];
    for (var i = 0; i < str.length; i += width) {
      lines.push(str.substr(i, width));
    }
    return lines.join('\n');
  }

  /**
   * Split a data URI into { mime, data }.
   * Non-data-URI input is returned unchanged with an empty mime.
   */
  function stripDataUri(str) {
    var m = /^\s*data:([^,]{0,255}),/i.exec(str);
    if (!m) return { mime: '', data: str };
    return { mime: m[1].split(';')[0] || '', data: str.slice(m[0].length) };
  }

  /** Detect a MIME type from leading magic bytes. Falls back to a generic type. */
  function detectMime(bytes) {
    function starts(sig, offset) {
      offset = offset || 0;
      if (bytes.length < offset + sig.length) return false;
      for (var i = 0; i < sig.length; i++) {
        if (bytes[offset + i] !== sig[i]) return false;
      }
      return true;
    }

    if (starts([0x89, 0x50, 0x4E, 0x47]))             return { mime: 'image/png',       ext: 'png' };
    if (starts([0xFF, 0xD8, 0xFF]))                   return { mime: 'image/jpeg',      ext: 'jpg' };
    if (starts([0x47, 0x49, 0x46, 0x38]))             return { mime: 'image/gif',       ext: 'gif' };
    if (starts([0x42, 0x4D]))                         return { mime: 'image/bmp',       ext: 'bmp' };
    if (starts([0x52, 0x49, 0x46, 0x46]) &&
        starts([0x57, 0x45, 0x42, 0x50], 8))          return { mime: 'image/webp',      ext: 'webp' };
    if (starts([0x25, 0x50, 0x44, 0x46]))             return { mime: 'application/pdf', ext: 'pdf' };
    if (starts([0x50, 0x4B, 0x03, 0x04]))             return { mime: 'application/zip', ext: 'zip' };
    if (starts([0x1F, 0x8B]))                         return { mime: 'application/gzip', ext: 'gz' };
    if (starts([0x37, 0x7A, 0xBC, 0xAF]))             return { mime: 'application/x-7z-compressed', ext: '7z' };
    if (starts([0x49, 0x44, 0x33]) ||
        starts([0xFF, 0xFB]))                         return { mime: 'audio/mpeg',      ext: 'mp3' };
    if (starts([0x4F, 0x67, 0x67, 0x53]))             return { mime: 'audio/ogg',       ext: 'ogg' };
    if (starts([0x00, 0x00, 0x00]) &&
        starts([0x66, 0x74, 0x79, 0x70], 4))          return { mime: 'video/mp4',       ext: 'mp4' };
    if (starts([0x7F, 0x45, 0x4C, 0x46]))             return { mime: 'application/x-elf', ext: 'bin' };
    if (starts([0x4D, 0x5A]))                         return { mime: 'application/x-msdownload', ext: 'exe' };
    if (starts([0x3C, 0x3F, 0x78, 0x6D, 0x6C]))       return { mime: 'application/xml', ext: 'xml' };
    if (starts([0x25, 0x21, 0x50, 0x53]))             return { mime: 'application/postscript', ext: 'ps' };

    return looksLikeText(bytes)
      ? { mime: 'text/plain', ext: 'txt' }
      : { mime: 'application/octet-stream', ext: 'bin' };
  }

  /** Heuristic: is this byte range plausible UTF-8 text? */
  function looksLikeText(bytes) {
    var sample = Math.min(bytes.length, 512);
    if (sample === 0) return false;
    for (var i = 0; i < sample; i++) {
      var b = bytes[i];
      if (b === 0) return false;
      if (b < 0x09) return false;
      if (b > 0x0D && b < 0x20) return false;
    }
    return true;
  }

  /* ══════════════════════════════════════════════
     OPTIONS
  ══════════════════════════════════════════════ */
  function currentOptions() {
    return {
      urlSafe: $('b64-opt-urlsafe').checked,
      pad:    !$('b64-opt-nopad').checked,
      wrap:    $('b64-opt-wrap').checked
    };
  }

  function optionChanged() {
    if (currentTab === 'text') convertText();
    else renderFileOutput();
  }

  /* ══════════════════════════════════════════════
     DIRECTION & TABS
  ══════════════════════════════════════════════ */
  function setDirection(dir) {
    direction = dir;
    ['encode', 'decode'].forEach(function (d) {
      var btn = $('b64-dir-' + d);
      if (d === dir) {
        btn.classList.add('b64-dir-btn--active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('b64-dir-btn--active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });
    applyDirectionUi();
  }

  function applyDirectionUi() {
    var encoding = direction === 'encode';

    // Encoding options only make sense when producing Base64
    toggleHidden($('b64-options-bar'), !encoding);
    toggleHidden($('b64-decode-hint'), encoding);
    toggleHidden($('b64-datauri-label'), !(encoding && currentTab === 'file'));

    // Text tab labels & placeholders
    $('b64-text-input-label').textContent  = encoding ? 'Plain text' : 'Base64 input';
    $('b64-text-output-label').textContent = encoding ? 'Base64 output' : 'Decoded text';
    $('b64-text-input').placeholder = encoding
      ? 'Type or paste your text here — output updates instantly…'
      : 'Paste Base64 here — line breaks, URL-safe characters and missing padding are fine…';

    // File tab: encode = file → Base64, decode = Base64 → file
    toggleHidden($('b64-file-encode-block'), !encoding);
    toggleHidden($('b64-file-decode-block'), encoding);

    if (currentTab === 'text') convertText();
    else if (encoding) renderFileOutput();
    else decodeToFile();
  }

  function switchTab(tab) {
    currentTab = tab;
    ['text', 'file'].forEach(function (t) {
      var section = $('b64-section-' + t);
      var tabBtn  = $('b64-tab-' + t);
      if (t === tab) {
        section.classList.remove('b64-hidden');
        tabBtn.classList.add('b64-tab--active');
        tabBtn.setAttribute('aria-selected', 'true');
      } else {
        section.classList.add('b64-hidden');
        tabBtn.classList.remove('b64-tab--active');
        tabBtn.setAttribute('aria-selected', 'false');
      }
    });
    applyDirectionUi();
  }

  /* ══════════════════════════════════════════════
     TEXT CONVERSION
  ══════════════════════════════════════════════ */
  function convertText() {
    var input  = $('b64-text-input').value;
    var output = $('b64-text-output');

    hideError();
    hideNote();
    updateInputStats(input);

    if (!input) {
      output.value = '';
      updateOutputStats('');
      $('b64-copy-text-btn').disabled = true;
      return;
    }

    var result;
    if (direction === 'encode') {
      result = encodeText(input, currentOptions());
    } else {
      var parsed = stripDataUri(input);
      try {
        var bytes = base64ToBytes(parsed.data);
        result = new TextDecoder('utf-8').decode(bytes);
        if (result.indexOf('�') !== -1) {
          showNote('⚠ The decoded bytes are not valid UTF-8 text — switch to the File tab to download them as a file.');
        }
      } catch (err) {
        output.value = '';
        updateOutputStats('');
        $('b64-copy-text-btn').disabled = true;
        showError('❌ ' + err.message);
        return;
      }
    }

    output.value = result;
    updateOutputStats(result);
    $('b64-copy-text-btn').disabled = !result;
  }

  function updateInputStats(text) {
    var chars = text.length;
    var bytes = text ? new TextEncoder().encode(text).length : 0;
    $('b64-input-stats').textContent =
      chars + (chars === 1 ? ' character · ' : ' characters · ') + formatBytes(bytes);
  }

  function updateOutputStats(text) {
    var chars = text.length;
    $('b64-output-stats').textContent = chars + (chars === 1 ? ' character' : ' characters');
  }

  function swap() {
    var out = $('b64-text-output').value;
    if (!out) return;
    $('b64-text-input').value = out;
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  function clearText() {
    $('b64-text-input').value = '';
    $('b64-text-output').value = '';
    updateInputStats('');
    updateOutputStats('');
    $('b64-copy-text-btn').disabled = true;
    hideError();
    hideNote();
  }

  function copyTextOutput() {
    var val = $('b64-text-output').value;
    if (val) copyToClipboard(val);
  }

  /* ══════════════════════════════════════════════
     FILE → BASE64
  ══════════════════════════════════════════════ */
  function triggerFile() {
    if (!fileInFlight) $('b64-file-input').click();
  }

  function dragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    $('b64-drop-zone').classList.add('b64-drop-zone--active');
  }

  function dragLeave(e) {
    e.stopPropagation();
    $('b64-drop-zone').classList.remove('b64-drop-zone--active');
  }

  function drop(e) {
    e.preventDefault();
    e.stopPropagation();
    $('b64-drop-zone').classList.remove('b64-drop-zone--active');
    var file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) fileChosen(file);
  }

  function fileChosen(file) {
    if (!file) return;
    fileInFlight = true;
    fileName = file.name;
    fileMime = file.type || 'application/octet-stream';

    $('b64-drop-zone').classList.add('b64-hidden');
    $('b64-file-info').classList.remove('b64-hidden');
    $('b64-file-name').textContent = file.name;
    $('b64-file-meta').textContent = formatBytes(file.size) +
      (file.type ? '  ·  ' + file.type : '');
    $('b64-file-thumb').textContent = fileEmoji(file.name);

    var progressWrap = $('b64-progress-wrap');
    progressWrap.classList.remove('b64-hidden');
    setProgress(0);

    var reader = new FileReader();
    reader.onprogress = function (e) {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 80));
    };
    reader.onload = function (e) {
      setProgress(90);
      // Encode without options — the display layer re-applies them cheaply
      fileBase64 = bytesToBase64(new Uint8Array(e.target.result), { urlSafe: false, pad: true });
      renderFileOutput();
      setProgress(100);
      setTimeout(function () { progressWrap.classList.add('b64-hidden'); }, 700);
      fileInFlight = false;
    };
    reader.onerror = function () {
      progressWrap.classList.add('b64-hidden');
      fileInFlight = false;
      showNote('❌ Could not read the file — it may have been moved or is not readable.', 'b64-file-note');
    };
    reader.readAsArrayBuffer(file);
  }

  /** Re-render the file Base64 with the current options (no re-read needed). */
  function renderFileOutput() {
    var out = $('b64-file-output');
    if (!fileBase64) {
      out.value = '';
      $('b64-file-output-stats').textContent = '0 characters';
      $('b64-copy-file-btn').disabled = true;
      $('b64-download-b64-btn').disabled = true;
      return;
    }

    var text = buildFileOutput();
    $('b64-file-output-stats').textContent = text.length + ' characters';
    $('b64-copy-file-btn').disabled = false;
    $('b64-download-b64-btn').disabled = false;

    if (text.length > MAX_DISPLAY_CHARS) {
      out.value = text.slice(0, MAX_DISPLAY_CHARS) + '\n… [truncated for display]';
      showNote('⚠ Output is ' + text.length.toLocaleString('en-US') +
               ' characters — only the first ' + MAX_DISPLAY_CHARS.toLocaleString('en-US') +
               ' are shown. Copy and download still use the full value.', 'b64-file-note');
    } else {
      out.value = text;
      hideNote('b64-file-note');
    }
  }

  /** Apply the current options to the cached standard-alphabet Base64. */
  function buildFileOutput() {
    var opts = currentOptions();
    var text = fileBase64;

    if (opts.urlSafe) text = text.replace(/\+/g, '-').replace(/\//g, '_');
    if (!opts.pad) text = text.replace(/=+$/, '');
    if ($('b64-opt-datauri').checked) {
      text = 'data:' + (fileMime || 'application/octet-stream') + ';base64,' + text;
    } else if (opts.wrap) {
      text = wrapLines(text, MIME_LINE_WIDTH);
    }
    return text;
  }

  function copyFileOutput() {
    if (fileBase64) copyToClipboard(buildFileOutput());
  }

  function downloadBase64() {
    if (!fileBase64) return;
    var blob = new Blob([buildFileOutput()], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, (fileName || 'file') + '.base64.txt');
  }

  function clearFile() {
    fileBase64 = '';
    fileName = '';
    fileMime = '';
    fileInFlight = false;
    $('b64-file-input').value = '';
    $('b64-file-info').classList.add('b64-hidden');
    $('b64-drop-zone').classList.remove('b64-hidden');
    $('b64-drop-zone').classList.remove('b64-drop-zone--active');
    $('b64-progress-wrap').classList.add('b64-hidden');
    hideNote('b64-file-note');
    renderFileOutput();
  }

  /* ══════════════════════════════════════════════
     BASE64 → FILE
  ══════════════════════════════════════════════ */
  function decodeToFile() {
    var raw = $('b64-decode-input').value;
    var errEl = $('b64-decode-error');
    var btn = $('b64-decode-download-btn');

    errEl.classList.remove('b64-visible');
    clearPreview();
    decodedBytes = null;
    btn.disabled = true;

    if (!raw.trim()) {
      $('b64-decode-stats').textContent = '0 bytes decoded';
      return;
    }

    var parsed = stripDataUri(raw);
    var bytes;
    try {
      bytes = base64ToBytes(parsed.data);
    } catch (err) {
      $('b64-decode-stats').textContent = '0 bytes decoded';
      errEl.textContent = '❌ ' + err.message;
      errEl.classList.add('b64-visible');
      return;
    }

    decodedBytes = bytes;
    var sniffed = detectMime(bytes);
    decodedMime = parsed.mime || sniffed.mime;

    $('b64-decode-stats').textContent =
      formatBytes(bytes.length) + ' decoded · ' + decodedMime;

    var nameField = $('b64-decode-filename');
    var suggested = 'decoded.' + extForMime(decodedMime, sniffed.ext);
    if (!nameField.value || /^decoded\./.test(nameField.value)) {
      nameField.value = suggested;
    }

    btn.disabled = bytes.length === 0;

    if (/^image\//.test(decodedMime) && bytes.length > 0 && bytes.length <= MAX_PREVIEW_BYTES) {
      showPreview(bytes, decodedMime);
    }
  }

  function extForMime(mime, fallback) {
    var map = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
      'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
      'application/pdf': 'pdf', 'application/zip': 'zip', 'application/json': 'json',
      'text/plain': 'txt', 'text/html': 'html', 'text/csv': 'csv',
      'application/xml': 'xml', 'text/xml': 'xml'
    };
    return map[mime] || fallback || 'bin';
  }

  function showPreview(bytes, mime) {
    clearPreview();
    previewUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    $('b64-preview-img').src = previewUrl;
    $('b64-preview-wrap').classList.remove('b64-hidden');
  }

  function clearPreview() {
    $('b64-preview-wrap').classList.add('b64-hidden');
    $('b64-preview-img').removeAttribute('src');
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }

  function downloadDecoded() {
    if (!decodedBytes) return;
    var name = $('b64-decode-filename').value.trim() || 'decoded.bin';
    triggerDownload(new Blob([decodedBytes], { type: decodedMime || 'application/octet-stream' }), name);
  }

  function clearDecode() {
    $('b64-decode-input').value = '';
    $('b64-decode-filename').value = 'decoded.bin';
    decodedBytes = null;
    decodeToFile();
  }

  /* ══════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════ */
  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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

  var toastTimer = null;
  function showToast() {
    var t = $('b64-toast');
    t.classList.add('b64-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('b64-show'); }, 2000);
  }

  function showError(msg) {
    var el = $('b64-error-msg');
    el.textContent = msg;
    el.classList.add('b64-visible');
  }

  function hideError() {
    $('b64-error-msg').classList.remove('b64-visible');
  }

  function showNote(msg, id) {
    var el = $(id || 'b64-text-note');
    el.textContent = msg;
    el.classList.add('b64-visible');
  }

  function hideNote(id) {
    $(id || 'b64-text-note').classList.remove('b64-visible');
  }

  function toggleHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.classList.add('b64-hidden');
    else el.classList.remove('b64-hidden');
  }

  function formatBytes(n) {
    if (n === 0)        return '0 bytes';
    if (n === 1)        return '1 byte';
    if (n < 1024)       return n + ' bytes';
    if (n < 1048576)    return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(2) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function fileEmoji(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    return ({
      pdf: '📕', doc: '📝', docx: '📝', txt: '📄', md: '📄',
      zip: '📦', tar: '📦', gz: '📦', '7z': '📦', rar: '📦', xz: '📦',
      iso: '💿', img: '💿', dmg: '💿',
      jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼', svg: '🖼',
      mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬',
      mp3: '🎵', flac: '🎵', wav: '🎵', ogg: '🎵',
      js: '🟨', ts: '🔷', py: '🐍', sh: '⬛', bash: '⬛',
      json: '📋', xml: '📋', csv: '📊', xlsx: '📊',
      exe: '⚙', bin: '⚙', deb: '⚙', rpm: '⚙',
      pem: '🔑', key: '🔑', crt: '🔑', p12: '🔑'
    })[ext] || '📄';
  }

  function setProgress(pct) {
    $('b64-progress-fill').style.width = pct + '%';
    $('b64-progress-pct').textContent = pct + '%';
  }

  /* ── Expose to global scope (onclick handlers in HTML) ── */
  window.b64SetDirection   = setDirection;
  window.b64SwitchTab      = switchTab;
  window.b64OptionChanged  = optionChanged;
  window.b64ConvertText    = convertText;
  window.b64Swap           = swap;
  window.b64ClearText      = clearText;
  window.b64CopyText       = copyTextOutput;
  window.b64TriggerFile    = triggerFile;
  window.b64DragOver       = dragOver;
  window.b64DragLeave      = dragLeave;
  window.b64Drop           = drop;
  window.b64FileChosen     = fileChosen;
  window.b64ClearFile      = clearFile;
  window.b64CopyFile       = copyFileOutput;
  window.b64DownloadBase64 = downloadBase64;
  window.b64DecodeToFile   = decodeToFile;
  window.b64ClearDecode    = clearDecode;
  window.b64DownloadDecoded= downloadDecoded;

  document.addEventListener('DOMContentLoaded', function () {
    applyDirectionUi();
  });

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      bytesToBase64: bytesToBase64,
      base64ToBytes: base64ToBytes,
      encodeText: encodeText,
      decodeText: decodeText,
      wrapLines: wrapLines,
      stripDataUri: stripDataUri,
      detectMime: detectMime,
      formatBytes: formatBytes,
      B64_STD: B64_STD,
      B64_URL: B64_URL
    };
  }

})();
