// URL Encoder / Decoder — script.js
// Namespace prefix: urc-
// No external dependencies. Percent-encoding is implemented natively (RFC 3986)
// rather than leaning on encodeURIComponent/decodeURIComponent, which offer no
// control over the safe-character set and throw opaque "URI malformed" errors.

(function () {
  'use strict';

  /* ── Shorthand ── */
  var $ = function (id) { return document.getElementById(id); };

  var ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  /* ── Safe-character sets per mode ──
     component — same set as encodeURIComponent (unreserved + legacy marks)
     uri       — same set as encodeURI (keeps reserved URL delimiters intact)
     form      — application/x-www-form-urlencoded, space becomes "+"
     strict    — RFC 3986 §2.3 unreserved only: A-Z a-z 0-9 - _ . ~          */
  var SAFE_CHARS = {
    component: ALNUM + "-_.!~*'()",
    uri:       ALNUM + "-_.!~*'();,/?:@&=+$#",
    form:      ALNUM + '-_.*',
    strict:    ALNUM + '-_.~'
  };

  var MODE_DESC = {
    component: 'Encodes everything except <code class="urc-code">A-Z a-z 0-9 - _ . ! ~ * \' ( )</code> — the right choice for a single query value or path segment. Matches <code class="urc-code">encodeURIComponent()</code>.',
    uri:       'Keeps <code class="urc-code">: / ? # &amp; = + $ , ;</code> intact so a whole URL stays usable — only unsafe characters and spaces are escaped. Matches <code class="urc-code">encodeURI()</code>.',
    form:      'HTML form encoding: spaces become <code class="urc-code">+</code>, everything outside <code class="urc-code">A-Z a-z 0-9 - _ . *</code> is escaped. Used by <code class="urc-code">application/x-www-form-urlencoded</code> bodies.',
    strict:    'Strictest form — only the RFC 3986 unreserved set <code class="urc-code">A-Z a-z 0-9 - _ . ~</code> survives. Safe for OAuth signatures, S3 keys and signed URLs.'
  };

  var HEX = '0123456789ABCDEF';
  var MAX_PARAMS = 500;

  /* ── State ── */
  var direction = 'encode';
  var currentTab = 'text';
  var mode = 'component';
  var params = [];        // [{ key: '', value: '' }] — decoded values
  var urlParts = null;    // last successfully parsed URL

  /* ══════════════════════════════════════════════════════════════
     CORE — percent-encoding primitives
  ══════════════════════════════════════════════════════════════ */

  /** Build a 128-entry lookup table of "safe" ASCII characters. */
  function safeTable(chars) {
    var t = new Uint8Array(128);
    for (var i = 0; i < chars.length; i++) t[chars.charCodeAt(i)] = 1;
    return t;
  }

  var SAFE_TABLES = {
    component: safeTable(SAFE_CHARS.component),
    uri:       safeTable(SAFE_CHARS.uri),
    form:      safeTable(SAFE_CHARS.form),
    strict:    safeTable(SAFE_CHARS.strict)
  };

  /**
   * Percent-encode a string using the given mode's safe set.
   * The input is first converted to UTF-8, so every non-ASCII character
   * becomes one %XX escape per byte (RFC 3986 §2.5).
   */
  function percentEncode(str, mode) {
    var table = SAFE_TABLES[mode] || SAFE_TABLES.component;
    var plusForSpace = mode === 'form';
    var bytes = new TextEncoder().encode(String(str));
    var parts = [];
    var chunk = '';

    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b < 128 && table[b]) {
        chunk += String.fromCharCode(b);
      } else if (plusForSpace && b === 0x20) {
        chunk += '+';
      } else {
        chunk += '%' + HEX.charAt(b >> 4) + HEX.charAt(b & 15);
      }
      // Flush periodically — string concat on very long input is otherwise slow
      if (chunk.length >= 8192) { parts.push(chunk); chunk = ''; }
    }

    parts.push(chunk);
    return parts.join('');
  }

  /**
   * Decode a percent-encoded string.
   * opts: { plusAsSpace: bool }
   * Throws a human-readable Error on malformed escape sequences.
   * Invalid UTF-8 byte sequences are replaced with U+FFFD rather than throwing —
   * the caller decides how loudly to complain.
   */
  function percentDecode(str, opts) {
    opts = opts || {};
    var plusAsSpace = opts.plusAsSpace !== false;
    var src = String(str);
    var bytes = [];
    var enc = new TextEncoder();

    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);

      if (ch === '%') {
        var hex = src.substr(i + 1, 2);
        if (hex.length < 2 || !/^[0-9a-fA-F]{2}$/.test(hex)) {
          throw new Error('Malformed escape sequence "' + src.substr(i, 3) +
                          '" at position ' + (i + 1) + ' — "%" must be followed by two hex digits (use %25 for a literal %).');
        }
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else if (ch === '+' && plusAsSpace) {
        bytes.push(0x20);
      } else {
        // Any other character passes through as its own UTF-8 bytes
        var raw = enc.encode(ch);
        for (var j = 0; j < raw.length; j++) bytes.push(raw[j]);
      }
    }

    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }

  /* ══════════════════════════════════════════════════════════════
     CORE — query strings
  ══════════════════════════════════════════════════════════════ */

  /**
   * Parse a query string into decoded { key, value } pairs.
   * Accepts a leading "?". Empty segments are skipped; a key with no "="
   * yields an empty-string value.
   */
  function parseQuery(qs) {
    var s = String(qs || '').replace(/^[?]/, '');
    if (!s) return [];

    var out = [];
    var pairs = s.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      if (!pair) continue;
      var eq = pair.indexOf('=');
      var rawKey = eq === -1 ? pair : pair.slice(0, eq);
      var rawVal = eq === -1 ? '' : pair.slice(eq + 1);
      out.push({
        key: percentDecode(rawKey, { plusAsSpace: true }),
        value: percentDecode(rawVal, { plusAsSpace: true })
      });
    }
    return out;
  }

  /**
   * Build a query string from decoded pairs.
   * Values are encoded with the strict RFC 3986 set, so spaces become %20
   * and nothing ambiguous survives.
   */
  function buildQuery(pairs) {
    var out = [];
    for (var i = 0; i < pairs.length; i++) {
      var k = percentEncode(pairs[i].key, 'strict');
      var v = percentEncode(pairs[i].value, 'strict');
      if (!k && !v) continue;
      out.push(v === '' ? k : k + '=' + v);
    }
    return out.join('&');
  }

  /* ══════════════════════════════════════════════════════════════
     CORE — URL parsing
  ══════════════════════════════════════════════════════════════ */

  var URL_RE = /^(?:([a-zA-Z][a-zA-Z0-9+.\-]*):)?(\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

  /**
   * Split a URL (absolute, protocol-relative, root-relative or a bare query
   * string) into its RFC 3986 components. Returns null if the input is empty.
   */
  function parseUrl(str) {
    var input = String(str || '').trim();
    if (!input) return null;

    // A bare "a=b&c=d" with no path or scheme is treated as a query string
    if (input.indexOf('?') === -1 && input.indexOf('/') === -1 &&
        input.indexOf(':') === -1 && /^[^=&\s]*=/.test(input)) {
      input = '?' + input;
    }

    var m = URL_RE.exec(input);
    if (!m) return null;

    var parts = {
      scheme: m[1] || '',
      hasAuthority: !!m[2],
      authority: m[3] || '',
      userinfo: '',
      host: '',
      port: '',
      path: m[4] || '',
      query: m[5] === undefined ? '' : m[5],
      hasQuery: m[5] !== undefined,
      fragment: m[6] === undefined ? '' : m[6],
      hasFragment: m[6] !== undefined
    };

    var auth = parts.authority;
    var at = auth.lastIndexOf('@');
    if (at !== -1) {
      parts.userinfo = auth.slice(0, at);
      auth = auth.slice(at + 1);
    }

    if (auth.charAt(0) === '[') {              // IPv6 literal, e.g. [::1]:8080
      var close = auth.indexOf(']');
      if (close !== -1) {
        parts.host = auth.slice(0, close + 1);
        var rest = auth.slice(close + 1);
        if (rest.charAt(0) === ':') parts.port = rest.slice(1);
      } else {
        parts.host = auth;
      }
    } else {
      var colon = auth.lastIndexOf(':');
      if (colon !== -1) {
        parts.host = auth.slice(0, colon);
        parts.port = auth.slice(colon + 1);
      } else {
        parts.host = auth;
      }
    }

    return parts;
  }

  /** Reassemble a URL from parsed components plus a fresh query string. */
  function buildUrl(parts, query) {
    var out = '';
    if (parts.scheme) out += parts.scheme + ':';
    if (parts.hasAuthority) {
      out += '//';
      if (parts.userinfo) out += parts.userinfo + '@';
      out += parts.host;
      if (parts.port) out += ':' + parts.port;
    }
    out += parts.path;
    if (query) out += '?' + query;
    if (parts.fragment) out += '#' + parts.fragment;
    return out;
  }

  /** Decoded, non-empty path segments — handy for spotting escaped slashes. */
  function pathSegments(path) {
    var raw = String(path || '').split('/');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      if (raw[i] !== '') out.push(raw[i]);
    }
    return out;
  }

  /** Try to decode; return the input untouched if it is not valid encoding. */
  function safeDecode(str, opts) {
    try {
      return percentDecode(str, opts || { plusAsSpace: false });
    } catch (_) {
      return str;
    }
  }

  /* ══════════════════════════════════════════════
     DIRECTION, TABS & MODE
  ══════════════════════════════════════════════ */
  function setDirection(dir) {
    direction = dir;
    ['encode', 'decode'].forEach(function (d) {
      var btn = $('urc-dir-' + d);
      if (d === dir) {
        btn.classList.add('urc-dir-btn--active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('urc-dir-btn--active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });
    applyDirectionUi();
  }

  function applyDirectionUi() {
    var encoding = direction === 'encode';

    toggleHidden($('urc-encode-options'), !encoding || currentTab !== 'text');
    toggleHidden($('urc-decode-options'), encoding || currentTab !== 'text');
    toggleHidden($('urc-mode-desc'), currentTab !== 'text');

    $('urc-text-input-label').textContent  = encoding ? 'Plain text' : 'Encoded input';
    $('urc-text-output-label').textContent = encoding ? 'Encoded output' : 'Decoded text';
    $('urc-text-input').placeholder = encoding
      ? 'Type or paste your text here — output updates instantly…'
      : 'Paste percent-encoded text here — %D0%9F%D1%80%D0%B8%D0%B2%D1%96%D1%82…';

    updateModeDesc();
    if (currentTab === 'text') convertText();
  }

  function updateModeDesc() {
    var el = $('urc-mode-desc');
    if (direction === 'encode') {
      el.innerHTML = MODE_DESC[mode];
    } else {
      el.innerHTML = 'Decoding accepts every mode automatically — <code class="urc-code">%XX</code> escapes are ' +
                     'resolved as UTF-8 and uppercase or lowercase hex both work.';
    }
  }

  function setMode(newMode) {
    mode = newMode;
    ['component', 'uri', 'form', 'strict'].forEach(function (m) {
      var btn = $('urc-mode-' + m);
      if (m === newMode) {
        btn.classList.add('urc-mode-btn--active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('urc-mode-btn--active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });
    updateModeDesc();
    convertText();
  }

  function optionChanged() {
    if (currentTab === 'text') convertText();
  }

  function switchTab(tab) {
    currentTab = tab;
    ['text', 'url'].forEach(function (t) {
      var section = $('urc-section-' + t);
      var tabBtn = $('urc-tab-' + t);
      if (t === tab) {
        section.classList.remove('urc-hidden');
        tabBtn.classList.add('urc-tab--active');
        tabBtn.setAttribute('aria-selected', 'true');
      } else {
        section.classList.add('urc-hidden');
        tabBtn.classList.remove('urc-tab--active');
        tabBtn.setAttribute('aria-selected', 'false');
      }
    });
    applyDirectionUi();
  }

  /* ══════════════════════════════════════════════
     TEXT CONVERSION
  ══════════════════════════════════════════════ */
  function convertText() {
    var input = $('urc-text-input').value;
    var output = $('urc-text-output');

    hideError();
    hideNote();
    updateInputStats(input);

    if (!input) {
      output.value = '';
      updateOutputStats('', '');
      $('urc-copy-text-btn').disabled = true;
      return;
    }

    var result;
    if (direction === 'encode') {
      result = percentEncode(input, mode);
    } else {
      try {
        result = percentDecode(input, { plusAsSpace: $('urc-opt-plus').checked });
      } catch (err) {
        output.value = '';
        updateOutputStats('', '');
        $('urc-copy-text-btn').disabled = true;
        showError('❌ ' + err.message);
        return;
      }
      if (result.indexOf('�') !== -1) {
        showNote('⚠ Some escape sequences are not valid UTF-8 — those bytes were replaced with the � character.');
      }
    }

    output.value = result;
    updateOutputStats(result, input);
    $('urc-copy-text-btn').disabled = !result;
  }

  function updateInputStats(text) {
    var chars = text.length;
    var bytes = text ? new TextEncoder().encode(text).length : 0;
    $('urc-input-stats').textContent =
      chars + (chars === 1 ? ' character · ' : ' characters · ') + formatBytes(bytes);
  }

  function updateOutputStats(text, input) {
    var chars = text.length;
    var label = chars + (chars === 1 ? ' character' : ' characters');
    if (input && chars) {
      var delta = Math.round((chars / input.length - 1) * 100);
      if (delta > 0) label += ' · +' + delta + '% size';
      else if (delta < 0) label += ' · ' + delta + '% size';
    }
    $('urc-output-stats').textContent = label;
  }

  function swap() {
    var out = $('urc-text-output').value;
    if (!out) return;
    $('urc-text-input').value = out;
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  function clearText() {
    $('urc-text-input').value = '';
    $('urc-text-output').value = '';
    updateInputStats('');
    updateOutputStats('', '');
    $('urc-copy-text-btn').disabled = true;
    hideError();
    hideNote();
  }

  function copyTextOutput() {
    var val = $('urc-text-output').value;
    if (val) copyToClipboard(val);
  }

  /* ══════════════════════════════════════════════
     URL INSPECTOR
  ══════════════════════════════════════════════ */
  function parseUrlInput() {
    var raw = $('urc-url-input').value;
    var errEl = $('urc-url-error');

    errEl.classList.remove('urc-visible');

    if (!raw.trim()) {
      urlParts = null;
      params = [];
      $('urc-url-stats').textContent = 'No URL parsed yet';
      toggleHidden($('urc-parts-block'), true);
      toggleHidden($('urc-params-block'), true);
      toggleHidden($('urc-url-output-group'), true);
      toggleHidden($('urc-url-actions-row'), true);
      return;
    }

    var parts = parseUrl(raw);
    if (!parts) {
      urlParts = null;
      errEl.textContent = '❌ Could not parse this as a URL or query string.';
      errEl.classList.add('urc-visible');
      return;
    }

    try {
      params = parseQuery(parts.query).slice(0, MAX_PARAMS);
    } catch (err) {
      params = [];
      errEl.textContent = '❌ ' + err.message;
      errEl.classList.add('urc-visible');
    }

    urlParts = parts;
    renderParts(parts);
    renderParams();
    renderRebuilt();

    var count = params.length;
    $('urc-url-stats').textContent =
      (parts.host || parts.path || 'query string') + ' · ' +
      count + (count === 1 ? ' parameter' : ' parameters');

    toggleHidden($('urc-parts-block'), false);
    toggleHidden($('urc-params-block'), false);
    toggleHidden($('urc-url-output-group'), false);
    toggleHidden($('urc-url-actions-row'), false);
  }

  function renderParts(parts) {
    var rows = [];

    function add(label, value, decoded) {
      if (value === '' || value === undefined || value === null) return;
      rows.push({ label: label, value: value, decoded: decoded });
    }

    add('Scheme', parts.scheme);
    add('User info', parts.userinfo, safeDecode(parts.userinfo));
    add('Host', parts.host);
    add('Port', parts.port);
    add('Path', parts.path, safeDecode(parts.path));
    add('Query', parts.query);
    add('Fragment', parts.fragment, safeDecode(parts.fragment));

    var segs = pathSegments(parts.path);
    if (segs.length > 1) {
      add('Path segments', segs.map(function (s) { return safeDecode(s); }).join('  ›  '));
    }

    var container = $('urc-parts');
    container.innerHTML = '';

    for (var i = 0; i < rows.length; i++) {
      var row = document.createElement('div');
      row.className = 'urc-part-row';

      var label = document.createElement('span');
      label.className = 'urc-part-label';
      label.textContent = rows[i].label;

      var value = document.createElement('span');
      value.className = 'urc-part-value';
      value.textContent = rows[i].value;

      if (rows[i].decoded && rows[i].decoded !== rows[i].value) {
        var dec = document.createElement('span');
        dec.className = 'urc-part-decoded';
        dec.textContent = '↳ ' + rows[i].decoded;
        value.appendChild(dec);
      }

      row.appendChild(label);
      row.appendChild(value);
      container.appendChild(row);
    }
  }

  function renderParams() {
    var list = $('urc-params-list');
    list.innerHTML = '';

    toggleHidden($('urc-params-empty'), params.length !== 0);

    for (var i = 0; i < params.length; i++) {
      list.appendChild(buildParamRow(i));
    }
  }

  function buildParamRow(index) {
    var row = document.createElement('div');
    row.className = 'urc-param-row';

    var keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'urc-input';
    keyInput.value = params[index].key;
    keyInput.placeholder = 'key';
    keyInput.spellcheck = false;
    keyInput.setAttribute('aria-label', 'Parameter name');
    keyInput.addEventListener('input', function () {
      params[index].key = keyInput.value;
      renderRebuilt();
    });

    var valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.className = 'urc-input';
    valInput.value = params[index].value;
    valInput.placeholder = 'value';
    valInput.spellcheck = false;
    valInput.setAttribute('aria-label', 'Parameter value');
    valInput.addEventListener('input', function () {
      params[index].value = valInput.value;
      renderRebuilt();
    });

    var del = document.createElement('button');
    del.className = 'urc-btn urc-btn--secondary urc-btn--small urc-param-del';
    del.textContent = '✕';
    del.title = 'Remove parameter';
    del.setAttribute('aria-label', 'Remove parameter');
    del.addEventListener('click', function () {
      params.splice(index, 1);
      renderParams();
      renderRebuilt();
    });

    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(del);
    return row;
  }

  function addParam() {
    if (!urlParts) return;
    if (params.length >= MAX_PARAMS) return;
    params.push({ key: '', value: '' });
    renderParams();
    renderRebuilt();
    var inputs = $('urc-params-list').querySelectorAll('.urc-input');
    if (inputs.length) inputs[inputs.length - 2].focus();
  }

  function renderRebuilt() {
    if (!urlParts) return;
    var url = buildUrl(urlParts, buildQuery(params));
    $('urc-url-output').value = url;
    $('urc-url-output-stats').textContent =
      url.length + (url.length === 1 ? ' character' : ' characters');
    $('urc-copy-url-btn').disabled = !url;
  }

  function useRebuilt() {
    var val = $('urc-url-output').value;
    if (!val) return;
    $('urc-url-input').value = val;
    parseUrlInput();
  }

  function copyUrl() {
    var val = $('urc-url-output').value;
    if (val) copyToClipboard(val);
  }

  function clearUrl() {
    $('urc-url-input').value = '';
    $('urc-url-output').value = '';
    params = [];
    urlParts = null;
    parseUrlInput();
  }

  /* ══════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════ */
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
    var t = $('urc-toast');
    t.classList.add('urc-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('urc-show'); }, 2000);
  }

  function showError(msg) {
    var el = $('urc-error-msg');
    el.textContent = msg;
    el.classList.add('urc-visible');
  }

  function hideError() {
    $('urc-error-msg').classList.remove('urc-visible');
  }

  function showNote(msg) {
    var el = $('urc-text-note');
    el.textContent = msg;
    el.classList.add('urc-visible');
  }

  function hideNote() {
    $('urc-text-note').classList.remove('urc-visible');
  }

  function toggleHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.classList.add('urc-hidden');
    else el.classList.remove('urc-hidden');
  }

  function formatBytes(n) {
    if (n === 0)     return '0 bytes';
    if (n === 1)     return '1 byte';
    if (n < 1024)    return n + ' bytes';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  /* ── Expose to global scope (onclick handlers in HTML) ── */
  window.urcSetDirection = setDirection;
  window.urcSwitchTab    = switchTab;
  window.urcSetMode      = setMode;
  window.urcOptionChanged = optionChanged;
  window.urcConvertText  = convertText;
  window.urcSwap         = swap;
  window.urcClearText    = clearText;
  window.urcCopyText     = copyTextOutput;
  window.urcParseUrl     = parseUrlInput;
  window.urcAddParam     = addParam;
  window.urcClearUrl     = clearUrl;
  window.urcCopyUrl      = copyUrl;
  window.urcUseRebuilt   = useRebuilt;

  document.addEventListener('DOMContentLoaded', function () {
    applyDirectionUi();
  });

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      percentEncode: percentEncode,
      percentDecode: percentDecode,
      parseQuery: parseQuery,
      buildQuery: buildQuery,
      parseUrl: parseUrl,
      buildUrl: buildUrl,
      pathSegments: pathSegments,
      safeDecode: safeDecode,
      formatBytes: formatBytes,
      SAFE_CHARS: SAFE_CHARS
    };
  }

})();
