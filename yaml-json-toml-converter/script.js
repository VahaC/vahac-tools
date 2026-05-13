/**
 * YAML ↔ JSON ↔ TOML Converter — script.js
 * Namespace prefix: yjt
 *
 * Dependencies (loaded via <script> in index.html):
 *   js-yaml 4.1.0 (MIT) — https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js
 *
 * TOML: minimal inline parser/serializer (TomlMini) — no external library.
 * Supports: basic/literal strings, integers, floats, booleans, arrays of primitives,
 *           inline tables, [sections], [[array of tables]], dotted keys, comments.
 */

/* =========================================================================
   TomlMini — minimal TOML v1.0 parser + serializer
   ========================================================================= */

var TomlMini = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // PARSER
  // ---------------------------------------------------------------------------

  function parse(src) {
    var lines = src.split('\n');
    var root = {};
    var current = root;
    var i;

    for (i = 0; i < lines.length; i++) {
      var line = lines[i].trim();

      // Skip blank lines and full-line comments
      if (!line || line[0] === '#') continue;

      // [[array of tables]]
      if (line.slice(0, 2) === '[[') {
        var aotEnd = line.indexOf(']]');
        if (aotEnd === -1) throw new Error('Line ' + (i + 1) + ': Unclosed [[');
        var aotKey = line.slice(2, aotEnd).trim();
        var aotParts = splitKey(aotKey);
        var aotParent = navigatePath(root, aotParts.slice(0, -1));
        var aotLast = aotParts[aotParts.length - 1];
        if (!Array.isArray(aotParent[aotLast])) aotParent[aotLast] = [];
        var newEntry = {};
        aotParent[aotLast].push(newEntry);
        current = newEntry;
        continue;
      }

      // [table]
      if (line[0] === '[') {
        var tEnd = line.indexOf(']');
        if (tEnd === -1) throw new Error('Line ' + (i + 1) + ': Unclosed [');
        var tKey = line.slice(1, tEnd).trim();
        var tParts = splitKey(tKey);
        current = navigatePath(root, tParts);
        continue;
      }

      // key = value
      var eqPos = findEqOutsideQuotes(line);
      if (eqPos !== -1) {
        var rawKey = line.slice(0, eqPos).trim();
        var rawVal = removeInlineComment(line.slice(eqPos + 1).trim());
        var keyParts = splitKey(rawKey);
        var target = navigatePath(current, keyParts.slice(0, -1));
        var lastKey = keyParts[keyParts.length - 1];
        target[lastKey] = parseValue(rawVal, i + 1);
      }
    }

    return root;
  }

  // Navigate (and create if missing) a nested object path
  function navigatePath(obj, parts) {
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      var k = parts[i];
      if (Array.isArray(cur[k])) {
        cur = cur[k][cur[k].length - 1]; // last element of [[array of tables]]
      } else if (typeof cur[k] === 'object' && cur[k] !== null) {
        cur = cur[k];
      } else {
        cur[k] = {};
        cur = cur[k];
      }
    }
    return cur;
  }

  // Split a TOML key on dots, respecting quoted segments
  function splitKey(rawKey) {
    var parts = [];
    var s = rawKey.trim();
    var i = 0;
    while (i < s.length) {
      if (s[i] === '"') {
        var end = s.indexOf('"', i + 1);
        if (end === -1) end = s.length;
        parts.push(s.slice(i + 1, end));
        i = end + 1;
        if (s[i] === '.') i++;
      } else if (s[i] === "'") {
        var end2 = s.indexOf("'", i + 1);
        if (end2 === -1) end2 = s.length;
        parts.push(s.slice(i + 1, end2));
        i = end2 + 1;
        if (s[i] === '.') i++;
      } else {
        var dot = s.indexOf('.', i);
        if (dot === -1) {
          parts.push(s.slice(i).trim());
          break;
        } else {
          parts.push(s.slice(i, dot).trim());
          i = dot + 1;
        }
      }
    }
    return parts.filter(Boolean);
  }

  // Find '=' that is not inside quotes
  function findEqOutsideQuotes(line) {
    var inQ = false;
    var qc = '';
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === qc && line[i - 1] !== '\\') inQ = false;
      } else if (c === '"' || c === "'") {
        inQ = true; qc = c;
      } else if (c === '=') {
        return i;
      }
    }
    return -1;
  }

  // Strip trailing # comment (not inside strings or brackets)
  function removeInlineComment(s) {
    var inQ = false;
    var qc = '';
    var depth = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (inQ) {
        if (c === qc && s[i - 1] !== '\\') inQ = false;
      } else if (c === '"' || c === "'") {
        inQ = true; qc = c;
      } else if (c === '[' || c === '{') {
        depth++;
      } else if (c === ']' || c === '}') {
        depth--;
      } else if (c === '#' && depth === 0) {
        return s.slice(0, i).trim();
      }
    }
    return s;
  }

  // Parse a TOML value string → JS value
  function parseValue(s, lineNum) {
    s = s.trim();
    if (!s) throw new Error('Line ' + lineNum + ': Empty value');

    // Multi-line basic string """...""" (single-line form)
    if (s.slice(0, 3) === '"""') {
      var mend = s.indexOf('"""', 3);
      if (mend !== -1) return s.slice(3, mend);
      throw new Error('Line ' + lineNum + ': Multi-line strings spanning multiple lines are not supported here');
    }
    // Multi-line literal string '''...'''
    if (s.slice(0, 3) === "'''") {
      var mend2 = s.indexOf("'''", 3);
      if (mend2 !== -1) return s.slice(3, mend2);
      throw new Error('Line ' + lineNum + ': Multi-line literal strings spanning multiple lines are not supported here');
    }
    // Basic string "..."
    if (s[0] === '"') return parseBasicString(s, lineNum);
    // Literal string '...'
    if (s[0] === "'") {
      var lend = s.indexOf("'", 1);
      if (lend === -1) throw new Error('Line ' + lineNum + ': Unclosed literal string');
      return s.slice(1, lend);
    }
    // Array [...]
    if (s[0] === '[') return parseArray(s, lineNum);
    // Inline table {...}
    if (s[0] === '{') return parseInlineTable(s, lineNum);
    // Boolean
    if (s === 'true') return true;
    if (s === 'false') return false;
    // Datetime — pass through as string
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    // Number
    if (/^[+\-]?\d/.test(s)) {
      var n = s.replace(/_/g, '');
      if (n.slice(0, 2) === '0x') return parseInt(n, 16);
      if (n.slice(0, 2) === '0o') return parseInt(n.slice(2), 8);
      if (n.slice(0, 2) === '0b') return parseInt(n.slice(2), 2);
      var num = (n.indexOf('.') !== -1 || /[eE]/.test(n)) ? parseFloat(n) : parseInt(n, 10);
      if (!isNaN(num)) return num;
    }
    throw new Error('Line ' + lineNum + ': Cannot parse value: "' + s.slice(0, 50) + '"');
  }

  function parseBasicString(s, lineNum) {
    var result = '';
    var i = 1;
    while (i < s.length) {
      var c = s[i];
      if (c === '\\') {
        i++;
        switch (s[i]) {
          case 'n':  result += '\n'; break;
          case 't':  result += '\t'; break;
          case 'r':  result += '\r'; break;
          case '\\': result += '\\'; break;
          case '"':  result += '"'; break;
          case 'u':  result += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; break;
          default:   result += '\\' + s[i];
        }
      } else if (c === '"') {
        return result;
      } else {
        result += c;
      }
      i++;
    }
    throw new Error('Line ' + lineNum + ': Unclosed basic string');
  }

  // Find closing bracket index, skipping nested brackets and strings
  function findClose(s, start, open, close) {
    var depth = 0;
    var inQ = false;
    var qc = '';
    for (var i = start; i < s.length; i++) {
      var c = s[i];
      if (inQ) {
        if (c === qc && s[i - 1] !== '\\') inQ = false;
      } else if (c === '"' || c === "'") {
        inQ = true; qc = c;
      } else if (c === open)  { depth++; }
      else if (c === close) { depth--; if (depth === 0) return i; }
    }
    return s.length;
  }

  // Split comma-separated items respecting nested brackets and strings
  function splitCommaItems(s) {
    var items = [];
    var depth = 0;
    var inQ = false;
    var qc = '';
    var start = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (inQ) {
        if (c === qc && s[i - 1] !== '\\') inQ = false;
      } else if (c === '"' || c === "'") {
        inQ = true; qc = c;
      } else if (c === '[' || c === '{') { depth++; }
      else if (c === ']' || c === '}') { depth--; }
      else if (c === ',' && depth === 0) {
        var item = s.slice(start, i).trim();
        if (item) items.push(item);
        start = i + 1;
      }
    }
    var last = s.slice(start).trim();
    if (last) items.push(last);
    return items;
  }

  function parseArray(s, lineNum) {
    var ci = findClose(s, 0, '[', ']');
    var inner = s.slice(1, ci).trim();
    if (!inner) return [];
    return splitCommaItems(inner).map(function (item) { return parseValue(item.trim(), lineNum); });
  }

  function parseInlineTable(s, lineNum) {
    var ci = findClose(s, 0, '{', '}');
    var inner = s.slice(1, ci).trim();
    if (!inner) return {};
    var obj = {};
    splitCommaItems(inner).forEach(function (pair) {
      var eq = findEqOutsideQuotes(pair);
      if (eq === -1) return;
      obj[pair.slice(0, eq).trim()] = parseValue(pair.slice(eq + 1).trim(), lineNum);
    });
    return obj;
  }

  // ---------------------------------------------------------------------------
  // SERIALIZER
  // ---------------------------------------------------------------------------

  function stringify(obj) {
    if (!isPlainObj(obj)) throw new Error('TOML root must be a plain object');
    var lines = [];
    writeSection(obj, '', lines);
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n') + '\n';
  }

  function writeSection(obj, prefix, lines) {
    var simpleKeys = [];
    var tableKeys  = [];
    var aotKeys    = [];

    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (isAOT(v))       aotKeys.push(k);
      else if (isPlainObj(v)) tableKeys.push(k);
      else                simpleKeys.push(k);
    });

    // Simple k=v first
    simpleKeys.forEach(function (k) {
      lines.push(fmtKey(k) + ' = ' + fmtVal(obj[k]));
    });

    // Sub-tables
    tableKeys.forEach(function (k) {
      var fullKey = prefix ? prefix + '.' + k : k;
      var child = obj[k];
      // Only emit [section] header if there are simple/array values inside it,
      // or if it is a completely empty object. Otherwise the sub-headers below
      // are enough (e.g. [a.b.c] implicitly creates [a] and [a.b]).
      var childHasSimple = Object.keys(child).some(function (ck) {
        return !isPlainObj(child[ck]) && !isAOT(child[ck]);
      });
      if (childHasSimple || Object.keys(child).length === 0) {
        lines.push('');
        lines.push('[' + fullKey + ']');
      }
      writeSection(child, fullKey, lines);
    });

    // Array of tables
    aotKeys.forEach(function (k) {
      var fullKey = prefix ? prefix + '.' + k : k;
      obj[k].forEach(function (item) {
        lines.push('');
        lines.push('[[' + fullKey + ']]');
        writeSection(item, fullKey, lines);
      });
    });
  }

  function isPlainObj(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  function isAOT(v) {
    return Array.isArray(v) && v.length > 0 && v.every(isPlainObj);
  }

  function fmtKey(k) {
    return /^[A-Za-z0-9_\-]+$/.test(k) ? k : '"' + k.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function fmtVal(v) {
    if (v === null || v === undefined) throw new Error('TOML does not support null/undefined values');
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number')  return String(v);
    if (typeof v === 'string')  return fmtStr(v);
    if (Array.isArray(v))       return fmtArr(v);
    if (isPlainObj(v))          return fmtInlineTable(v);
    throw new Error('Unsupported value type: ' + typeof v);
  }

  function fmtStr(s) {
    return '"' + s
      .replace(/\\/g,  '\\\\')
      .replace(/"/g,   '\\"')
      .replace(/\n/g,  '\\n')
      .replace(/\r/g,  '\\r')
      .replace(/\t/g,  '\\t') + '"';
  }

  function fmtArr(arr) {
    if (arr.length === 0) return '[]';
    if (arr.every(isPlainObj)) throw new Error('Array of objects should be top-level [[key]]');
    var items = arr.map(fmtVal);
    var one = '[' + items.join(', ') + ']';
    return one.length <= 80 ? one : '[\n  ' + items.join(',\n  ') + '\n]';
  }

  function fmtInlineTable(obj) {
    var pairs = Object.keys(obj).map(function (k) { return fmtKey(k) + ' = ' + fmtVal(obj[k]); });
    return '{' + pairs.join(', ') + '}';
  }

  return { parse: parse, stringify: stringify };

}());

/* =========================================================================
   Main application
   ========================================================================= */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var FORMATS = ['yaml', 'json', 'toml'];
  var lastEdited = null; // tracks last user-edited format for the Convert button

  /* -----------------------------------------------------------------------
     SAMPLE DATA
  ----------------------------------------------------------------------- */

  var SAMPLES = {
    docker: {
      format: 'yaml',
      content: [
        'version: "3.8"',
        'services:',
        '  nginx:',
        '    image: nginx:1.27-alpine',
        '    container_name: nginx',
        '    restart: unless-stopped',
        '    ports:',
        '      - "80:80"',
        '      - "443:443"',
        '    volumes:',
        '      - ./html:/usr/share/nginx/html:ro',
        '      - ./certs:/etc/nginx/certs:ro',
        '    environment:',
        '      NGINX_HOST: example.com',
        '      NGINX_PORT: "80"',
        'networks:',
        '  proxy:',
        '    external: true'
      ].join('\n')
    },
    traefik: {
      format: 'toml',
      content: [
        '[global]',
        '  checkNewVersion = true',
        '  sendAnonymousUsage = false',
        '',
        '[log]',
        '  level = "INFO"',
        '',
        '[api]',
        '  dashboard = true',
        '  insecure = false',
        '',
        '[entryPoints.web]',
        '  address = ":80"',
        '',
        '[entryPoints.websecure]',
        '  address = ":443"',
        '',
        '[providers.docker]',
        '  exposedByDefault = false',
        '  network = "proxy"',
        '  watch = true'
      ].join('\n')
    },
    app: {
      format: 'json',
      content: JSON.stringify({
        app:      { name: 'homelab-monitor', version: '2.1.0', debug: false, port: 8080 },
        database: { host: '192.168.1.100', port: 5432, name: 'homelab', ssl: false },
        logging:  { level: 'info', format: 'json', outputs: ['stdout', 'file'] },
        features: { notifications: true, metrics: true, auth: false }
      }, null, 2)
    }
  };

  /* -----------------------------------------------------------------------
     PARSE / SERIALIZE
  ----------------------------------------------------------------------- */

  function parseFormat(format, str) {
    if (!str || !str.trim()) return null;
    if (format === 'yaml') return window.jsyaml.load(str, { schema: window.jsyaml.DEFAULT_SCHEMA });
    if (format === 'json') return JSON.parse(str);
    if (format === 'toml') return TomlMini.parse(str);
    throw new Error('Unknown format: ' + format);
  }

  function serializeFormat(format, obj) {
    if (format === 'yaml') return window.jsyaml.dump(obj, { indent: 2, lineWidth: -1, noRefs: true });
    if (format === 'json') return JSON.stringify(obj, null, 2);
    if (format === 'toml') return TomlMini.stringify(obj);
    throw new Error('Unknown format: ' + format);
  }

  /* -----------------------------------------------------------------------
     UI HELPERS
  ----------------------------------------------------------------------- */

  function updateStatus(format) {
    var el = $('yjt-input-' + format);
    var st = $('yjt-status-' + format);
    if (!el || !st) return;
    var v = el.value;
    st.textContent = v.trim() ? v.split('\n').length + 'L · ' + v.length + 'B' : '';
  }

  function showError(format, msg) {
    var e = $('yjt-error-' + format);
    var p = $('yjt-panel-' + format);
    if (!e || !p) return;
    e.textContent = '⚠ ' + (msg.length > 110 ? msg.slice(0, 107) + '…' : msg);
    e.classList.add('yjt-error-visible');
    p.classList.add('yjt-panel--error');
    p.classList.remove('yjt-panel--ok');
  }

  function clearError(format) {
    var e = $('yjt-error-' + format);
    var p = $('yjt-panel-' + format);
    if (!e || !p) return;
    e.textContent = '';
    e.classList.remove('yjt-error-visible');
    p.classList.remove('yjt-panel--error');
  }

  function setOk(format) {
    var p = $('yjt-panel-' + format);
    if (p) { p.classList.add('yjt-panel--ok'); p.classList.remove('yjt-panel--error'); }
  }

  function clearState(format) {
    clearError(format);
    var p = $('yjt-panel-' + format);
    if (p) p.classList.remove('yjt-panel--ok', 'yjt-panel--error');
    updateStatus(format);
  }

  var _toastTimer = null;
  function showToast(msg) {
    var t = $('yjt-toast');
    if (!t) return;
    t.textContent = msg || 'Copied!';
    t.classList.add('yjt-show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { t.classList.remove('yjt-show'); }, 2000);
  }

  function copyText(text, label) {
    var done = function () { showToast(label ? 'Copied ' + label + '!' : 'Copied!'); };
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (ex) {}
      document.body.removeChild(ta); done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else { fallback(); }
  }

  /* -----------------------------------------------------------------------
     CONVERSION
  ----------------------------------------------------------------------- */

  function convertFrom(sourceFormat) {
    var srcEl = $('yjt-input-' + sourceFormat);
    if (!srcEl) return;
    var srcStr = srcEl.value;

    if (!srcStr.trim()) {
      FORMATS.forEach(function (f) {
        if (f !== sourceFormat) { $('yjt-input-' + f).value = ''; clearState(f); }
      });
      clearError(sourceFormat);
      updateStatus(sourceFormat);
      return;
    }

    var obj;
    try {
      obj = parseFormat(sourceFormat, srcStr);
      clearError(sourceFormat);
      setOk(sourceFormat);
      updateStatus(sourceFormat);
    } catch (e) {
      showError(sourceFormat, e.message);
      updateStatus(sourceFormat);
      return; // Don't touch other panels on parse error
    }

    if (obj === null || obj === undefined) {
      FORMATS.forEach(function (f) {
        if (f !== sourceFormat) { $('yjt-input-' + f).value = ''; clearState(f); }
      });
      return;
    }

    FORMATS.forEach(function (f) {
      if (f === sourceFormat) return;
      try {
        $('yjt-input-' + f).value = serializeFormat(f, obj);
        clearError(f); setOk(f); updateStatus(f);
      } catch (e) {
        $('yjt-input-' + f).value = '';
        showError(f, e.message);
        updateStatus(f);
      }
    });
  }

  /* -----------------------------------------------------------------------
     DEBOUNCED INPUT + EXPLICIT CONVERT BUTTON
  ----------------------------------------------------------------------- */

  var _debounce = {};

  function yjtOnInput(format) {
    lastEdited = format;
    clearTimeout(_debounce[format]);
    _debounce[format] = setTimeout(function () {
      convertFrom(format);
      saveHash(format);
    }, 280);
  }

  function yjtConvertNow() {
    var src = lastEdited;
    if (!src) {
      for (var i = 0; i < FORMATS.length; i++) {
        var el = $('yjt-input-' + FORMATS[i]);
        if (el && el.value.trim()) { src = FORMATS[i]; break; }
      }
    }
    if (src) convertFrom(src);
  }

  /* -----------------------------------------------------------------------
     PRETTIFY
  ----------------------------------------------------------------------- */

  function yjtPrettify(format) {
    var el = $('yjt-input-' + format);
    if (!el || !el.value.trim()) return;
    try {
      var obj = parseFormat(format, el.value);
      if (obj === null || obj === undefined) return;
      el.value = serializeFormat(format, obj);
      clearError(format); setOk(format); updateStatus(format);
      showToast(format.toUpperCase() + ' formatted ✓');
    } catch (e) { showError(format, e.message); }
  }

  /* -----------------------------------------------------------------------
     COPY / LOAD SAMPLE / CLEAR
  ----------------------------------------------------------------------- */

  function yjtCopyPanel(format) {
    var el = $('yjt-input-' + format);
    if (!el || !el.value.trim()) { showToast('Nothing to copy'); return; }
    copyText(el.value, format.toUpperCase());
  }

  function yjtLoadSample(name) {
    var s = SAMPLES[name];
    if (!s) return;
    FORMATS.forEach(function (f) { $('yjt-input-' + f).value = ''; clearState(f); });
    var el = $('yjt-input-' + s.format);
    if (el) { el.value = s.content; lastEdited = s.format; convertFrom(s.format); }
  }

  function yjtClearAll() {
    FORMATS.forEach(function (f) { $('yjt-input-' + f).value = ''; clearState(f); });
    lastEdited = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }

  /* -----------------------------------------------------------------------
     URL HASH STATE
  ----------------------------------------------------------------------- */

  function saveHash(format) {
    try {
      var v = $('yjt-input-' + format).value;
      if (!v.trim() || v.length > 4000) {
        history.replaceState(null, '', location.pathname + location.search);
        return;
      }
      var encoded = btoa(unescape(encodeURIComponent(JSON.stringify({ f: format, v: v }))));
      history.replaceState(null, '', '#' + encoded);
    } catch (e) {}
  }

  function loadHash() {
    try {
      if (!location.hash || location.hash.length < 2) return;
      var state = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1)))));
      if (state && state.f && FORMATS.indexOf(state.f) !== -1 && state.v) {
        var el = $('yjt-input-' + state.f);
        if (el) { el.value = state.v; lastEdited = state.f; convertFrom(state.f); }
      }
    } catch (e) {}
  }

  /* -----------------------------------------------------------------------
     KEYBOARD SUPPORT
  ----------------------------------------------------------------------- */

  function initKeyboard() {
    FORMATS.forEach(function (format) {
      var el = $('yjt-input-' + format);
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        // Tab → insert 2 spaces (preserves YAML/TOML indentation)
        if (e.key === 'Tab') {
          e.preventDefault();
          var s = el.selectionStart;
          var end = el.selectionEnd;
          el.value = el.value.substring(0, s) + '  ' + el.value.substring(end);
          el.selectionStart = el.selectionEnd = s + 2;
          yjtOnInput(format);
        }
      });
    });
  }

  /* -----------------------------------------------------------------------
     EXPOSE GLOBALS (for onclick handlers in HTML)
  ----------------------------------------------------------------------- */

  window.yjtOnInput    = yjtOnInput;
  window.yjtConvertNow = yjtConvertNow;
  window.yjtPrettify   = yjtPrettify;
  window.yjtCopyPanel  = yjtCopyPanel;
  window.yjtLoadSample = yjtLoadSample;
  window.yjtClearAll   = yjtClearAll;

  /* -----------------------------------------------------------------------
     INIT
  ----------------------------------------------------------------------- */

  function init() {
    initKeyboard();
    loadHash();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      TomlMini: TomlMini
    };
  }

}());
