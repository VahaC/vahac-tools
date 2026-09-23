// CSV ↔ JSON ↔ SQL Converter — script.js
// Prefix: cjs-
// Dependencies: none.
//
// CSV parsing follows RFC 4180 (quoted fields, "" inside quotes, CRLF/LF line
// breaks) and tolerates common spreadsheet quirks with a warning instead of
// failing. SQL output embeds literal values (no bind parameters), escaped for
// the selected dialect.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Constants ───────────────────────────────────────────

  var DELIMITERS = [',', ';', '\t', '|'];
  var DELIMITER_NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' };
  var PREVIEW_ROWS = 100;
  var LIST_LIMIT = 5;
  var MAX_FILE_BYTES = 10 * 1024 * 1024;
  var MAX_DISPLAY_CHARS = 1000000;
  var BOM = String.fromCharCode(0xFEFF);
  var REPLACEMENT_CHAR = String.fromCharCode(0xFFFD);
  var INT32_MIN = -2147483648;
  var INT32_MAX = 2147483647;
  var INT64_LIMIT = Math.pow(2, 63);

  // Strict number syntax for type detection: no leading zeros ("007" stays text),
  // no "+", no thousands separators, no decimal commas
  var NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
  // Looser patterns used only for header detection
  var LOOSE_NUMBER_RE = /^[-+]?(?:\d+(?:[.,]\d+)*|[.,]\d+)(?:[eE][-+]?\d+)?%?$/;
  var DATE_LIKE_RE = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/;

  var SQL_DIALECTS = {
    postgres: {
      label: 'PostgreSQL', open: '"', close: '"', t: 'TRUE', f: 'FALSE',
      begin: 'BEGIN;', commit: 'COMMIT;', maxIdent: 63, identBytes: true, maxRows: 0,
      caseFolds: true
    },
    mysql: {
      label: 'MySQL / MariaDB', open: '`', close: '`', t: 'TRUE', f: 'FALSE',
      begin: 'START TRANSACTION;', commit: 'COMMIT;', maxIdent: 64, maxRows: 0,
      backslash: true
    },
    sqlite: {
      label: 'SQLite', open: '"', close: '"', t: '1', f: '0',
      begin: 'BEGIN TRANSACTION;', commit: 'COMMIT;', maxIdent: 0, maxRows: 0
    },
    mssql: {
      label: 'SQL Server', open: '[', close: ']', t: '1', f: '0',
      begin: 'BEGIN TRANSACTION;', commit: 'COMMIT TRANSACTION;', maxIdent: 128, maxRows: 1000,
      unicodePrefix: true
    }
  };

  // Words that are reserved in at least one supported dialect
  var RESERVED = {};
  ('ADD ALL ALTER AND ANY AS ASC BETWEEN BY CASE CAST CHECK COLUMN CONSTRAINT CREATE CROSS ' +
   'CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER DATABASE DEFAULT DELETE DESC ' +
   'DISTINCT DROP ELSE END EXCEPT EXISTS FALSE FETCH FOR FOREIGN FROM FULL GRANT GROUP HAVING ' +
   'IF IN INDEX INNER INSERT INTERSECT INTERVAL INTO IS JOIN KEY LEFT LIKE LIMIT MATCH NATURAL ' +
   'NOT NULL OFFSET ON OR ORDER OUTER PRIMARY RANGE REFERENCES REPLACE RIGHT ROW ROWS SCHEMA ' +
   'SELECT SESSION_USER SET SOME TABLE THEN TO TRUE UNION UNIQUE UPDATE USER USING VALUES WHEN ' +
   'WHERE WINDOW WITH').split(' ').forEach(function (w) { RESERVED[w] = true; });

  // ISO 8601 dates and date-times without a time zone, e.g. 2026-10-03 or 2026-10-03 09:00:00
  var ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  var ISO_DATETIME_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[ T]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?$/;

  var KIND_LABELS = {
    empty: 'empty', boolean: 'bool', integer: 'int', bigint: 'bigint', decimal: 'decimal',
    date: 'date', datetime: 'datetime', json: 'json', text: 'text'
  };

  // ── Small helpers ───────────────────────────────────────

  function msg(level, text) {
    return { level: level, text: text };
  }

  function plural(n, word, pluralWord) {
    return n + ' ' + (n === 1 ? word : (pluralWord || word + 's'));
  }

  function fmt(n) {
    return Number(n).toLocaleString('en-US');
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function countLineBreaks(s) {
    var m = s.match(/\r\n|\r|\n/g);
    return m ? m.length : 0;
  }

  // "line 4", "lines 4, 9, 12 and 3 more" — expects ascending line numbers
  function describeLines(lines) {
    var uniq = [];
    for (var i = 0; i < lines.length; i++) {
      if (!uniq.length || uniq[uniq.length - 1] !== lines[i]) uniq.push(lines[i]);
    }
    var more = uniq.length - LIST_LIMIT;
    return (uniq.length === 1 ? 'line ' : 'lines ') + uniq.slice(0, LIST_LIMIT).join(', ') +
      (more > 0 ? ' and ' + more + ' more' : '');
  }

  function describeList(items) {
    var more = items.length - LIST_LIMIT;
    return items.slice(0, LIST_LIMIT).join(', ') + (more > 0 ? ' and ' + more + ' more' : '');
  }

  function utf8Length(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    return unescape(encodeURIComponent(str)).length;
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function typeOfValue(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  // Text form of a cell for CSV output and the preview
  function cellToText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  // ── CSV parsing ─────────────────────────────────────────

  // Parse CSV text with a known delimiter into string rows.
  // Blank lines are skipped; the line where each record starts is kept for messages.
  function parseCsv(text, delim) {
    var rows = [];
    var lines = [];
    var result = { rows: rows, lines: lines, unclosedLine: 0, afterQuoteLines: [], strayQuoteLines: [] };
    var n = text.length;
    var i = (n && text.charAt(0) === BOM) ? 1 : 0;
    var line = 1;
    var recordLine = 1;
    var row = [];
    var rowQuoted = false;

    function isBreak(c) {
      return c === '\n' || c === '\r';
    }

    function endRow() {
      if (!(row.length === 1 && !rowQuoted && row[0].trim() === '')) {
        rows.push(row);
        lines.push(recordLine);
      }
      row = [];
      rowQuoted = false;
    }

    while (i < n) {
      var value;
      // Spaces before an opening quote are tolerated:  a, "b, c"
      var s = i;
      while (s < n && text.charAt(s) === ' ') s++;

      if (s < n && text.charAt(s) === '"') {
        rowQuoted = true;
        var startLine = line;
        var buf = '';
        var j = s + 1;
        var closed = false;
        while (j < n) {
          var q = text.indexOf('"', j);
          if (q === -1) break;
          var chunk = text.slice(j, q);
          buf += chunk;
          line += countLineBreaks(chunk);
          if (text.charAt(q + 1) === '"') {
            buf += '"';           // "" inside quotes is a literal quote
            j = q + 2;
          } else {
            j = q + 1;
            closed = true;
            break;
          }
        }
        if (!closed) {
          var rest = text.slice(j);
          line += countLineBreaks(rest);
          row.push(buf + rest);
          result.unclosedLine = startLine;
          i = n;
          break;
        }
        // Anything between the closing quote and the next delimiter is kept (lenient)
        var k = j;
        while (k < n && text.charAt(k) !== delim && !isBreak(text.charAt(k))) k++;
        var tail = text.slice(j, k);
        if (tail.trim() !== '') {
          buf += tail;
          result.afterQuoteLines.push(line);
        }
        value = buf;
        i = k;
      } else {
        var e = i;
        while (e < n && text.charAt(e) !== delim && !isBreak(text.charAt(e))) e++;
        value = text.slice(i, e);
        if (value.indexOf('"') !== -1) result.strayQuoteLines.push(line);
        i = e;
      }

      row.push(value);
      if (i >= n) break;

      if (text.charAt(i) === delim) {
        i++;
        if (i === n) row.push('');   // trailing delimiter = one more empty field
        continue;
      }

      // Line break ends the record
      i += (text.charAt(i) === '\r' && text.charAt(i + 1) === '\n') ? 2 : 1;
      line++;
      endRow();
      recordLine = line;
    }
    if (row.length) endRow();
    return result;
  }

  // Pick the delimiter that splits the most records into the same number (>1) of fields
  function detectDelimiter(text) {
    var sample = text;
    if (text.length > 65536) {
      sample = text.slice(0, 65536);
      var cut = Math.max(sample.lastIndexOf('\n'), sample.lastIndexOf('\r'));
      if (cut > 0) sample = sample.slice(0, cut);
    }
    var best = null;
    DELIMITERS.forEach(function (d) {
      if (sample.indexOf(d) === -1) return;
      var rows = parseCsv(sample, d).rows.slice(0, 500);
      if (!rows.length) return;
      var freq = {};
      var mode = 0;
      rows.forEach(function (r) {
        var c = r.length;
        freq[c] = (freq[c] || 0) + 1;
        if (freq[c] > (freq[mode] || 0) || (freq[c] === freq[mode] && c > mode)) mode = c;
      });
      if (mode < 2) return;
      var score = freq[mode] / rows.length;
      if (!best || score > best.score || (score === best.score && mode > best.fields)) {
        best = { delimiter: d, score: score, fields: mode };
      }
    });
    return best ? best.delimiter : null;
  }

  function classifyCell(s) {
    if (s === '') return 'empty';
    if (DATE_LIKE_RE.test(s)) return 'date';
    if (LOOSE_NUMBER_RE.test(s)) return 'number';
    var low = s.toLowerCase();
    if (low === 'true' || low === 'false') return 'boolean';
    return 'string';
  }

  // Decide whether the first row is a header by comparing it with the rows below:
  // a text label above a numeric/boolean/date column, or a label whose length differs
  // from fixed-width codes below it, counts as evidence.
  function detectHeader(rows) {
    if (rows.length < 2) return false;
    var first = rows[0];
    var sample = rows.slice(1, 51);
    var votes = 0;

    for (var c = 0; c < first.length; c++) {
      var head = String(first[c]).trim();
      var kind = null;
      var mixed = false;
      var len = -1;
      var sameLen = true;
      var seen = 0;
      for (var r = 0; r < sample.length; r++) {
        if (c >= sample[r].length) continue;
        var v = String(sample[r][c]).trim();
        var k = classifyCell(v);
        if (k === 'empty') continue;
        seen++;
        if (kind === null) kind = k;
        else if (kind !== k) mixed = true;
        if (len === -1) len = v.length;
        else if (len !== v.length) sameLen = false;
      }
      if (!seen || mixed) continue;
      if (kind !== 'string') {
        if (classifyCell(head) !== kind) votes++;
      } else if (sameLen && seen > 1) {
        votes += head.length === len ? -1 : 1;
      }
    }
    if (votes !== 0) return votes > 0;

    // No signal either way: most exports start with a header, so accept a first row
    // of distinct, non-empty text labels
    var names = {};
    for (var i = 0; i < first.length; i++) {
      var name = String(first[i]).trim().toLowerCase();
      if (classifyCell(name) !== 'string' || names['$' + name]) return false;
      names['$' + name] = true;
    }
    return true;
  }

  // Number value of a CSV cell, or null when it must stay text
  function parseNumber(s) {
    if (!NUMBER_RE.test(s)) return null;
    var num = Number(s);
    if (/^-?\d+$/.test(s)) return Number.isSafeInteger(num) ? num : null;
    // Values with more significant digits than a double holds stay text
    var digits = s.replace(/^-/, '').replace(/[eE].*$/, '').replace('.', '').replace(/^0+/, '');
    return digits.length <= 15 && isFinite(num) ? num : null;
  }

  function parseBoolean(s) {
    var low = s.toLowerCase();
    return low === 'true' ? true : low === 'false' ? false : null;
  }

  // One type per column, so a column never mixes numbers and strings:
  // a zip column with "01100" or "D02 X285" in it stays text throughout
  function csvColumnType(rows, c) {
    var type = null;
    for (var r = 0; r < rows.length; r++) {
      var s = rows[r][c];
      if (s === '') continue;
      var t = parseNumber(s) !== null ? 'number' : parseBoolean(s) !== null ? 'boolean' : 'text';
      if (t === 'text' || (type !== null && type !== t)) return 'text';
      type = t;
    }
    return type || 'text';
  }

  function convertCell(s, type, opts) {
    if (s === '') return opts.emptyAsNull ? null : '';
    if (type === 'number') return parseNumber(s);
    if (type === 'boolean') return parseBoolean(s);
    return s;
  }

  // Trim names, name empty ones column_N and make duplicates unique (name_2, name_3…).
  // A null name marks a column with no header cell at all; it is named silently.
  function normalizeColumnNames(names, messages, fromHeader) {
    var used = Object.create(null);
    var emptyCols = [];
    var renamed = [];
    var base = names.map(function (raw, c) {
      var name = raw === null ? '' : String(raw === undefined ? '' : raw).trim();
      if (!name) {
        name = 'column_' + (c + 1);
        if (fromHeader && raw !== null) emptyCols.push(name);
      }
      return name;
    });
    var out = base.map(function (name) {
      if (!used[name]) {
        used[name] = true;
        return name;
      }
      var n = 2;
      while (used[name + '_' + n]) n++;
      var fresh = name + '_' + n;
      used[fresh] = true;
      renamed.push(name + ' → ' + fresh);
      return fresh;
    });
    if (emptyCols.length) {
      messages.push(msg('warn', 'Empty header ' + (emptyCols.length === 1 ? 'cell was' : 'cells were') +
        ' named ' + describeList(emptyCols) + '.'));
    }
    if (renamed.length) {
      messages.push(msg('warn', 'Duplicate column ' + (renamed.length === 1 ? 'name was' : 'names were') +
        ' renamed: ' + describeList(renamed) + '.'));
    }
    return out;
  }

  function tableFromCsv(text, opts) {
    var messages = [];
    var autoDelim = !opts.delimiter || opts.delimiter === 'auto';
    var detected = autoDelim ? detectDelimiter(text) : opts.delimiter;
    var delim = detected || ',';
    var parsed = parseCsv(text, delim);
    var headerAuto = !opts.header || opts.header === 'auto';
    var meta = {
      format: 'csv', delimiter: detected, delimiterAuto: autoDelim,
      header: false, headerAuto: headerAuto, rows: 0, columns: 0
    };

    if (parsed.unclosedLine) {
      messages.push(msg('error', 'Unclosed quote: the quoted field that starts on line ' + parsed.unclosedLine +
        ' never ends. Add the missing closing " — and write a quote inside a quoted field as "".'));
      return { format: 'csv', table: null, meta: meta, messages: messages };
    }

    var raw = parsed.rows;
    if (opts.trim) {
      raw = raw.map(function (r) { return r.map(function (v) { return v.trim(); }); });
    }

    var hasHeader = headerAuto ? detectHeader(raw) : opts.header === 'yes';
    meta.header = hasHeader;
    var body = hasHeader ? raw.slice(1) : raw;
    var bodyLines = hasHeader ? parsed.lines.slice(1) : parsed.lines;

    var width = 0;
    if (hasHeader) {
      width = raw[0].length;
    } else {
      body.forEach(function (r) { if (r.length > width) width = r.length; });
    }

    // Ragged rows: pad short ones, keep extra values that carry data
    var shortLines = [];
    var longLines = [];
    var fullWidth = width;
    body.forEach(function (r, idx) {
      if (r.length < width) {
        shortLines.push(bodyLines[idx]);
      } else if (r.length > width) {
        longLines.push(bodyLines[idx]);
        for (var c = r.length - 1; c >= width; c--) {
          if (r[c].trim() !== '') {
            if (c + 1 > fullWidth) fullWidth = c + 1;
            break;
          }
        }
      }
    });

    if (shortLines.length) {
      messages.push(msg('warn', plural(shortLines.length, 'row') + ' ' + (shortLines.length === 1 ? 'has' : 'have') +
        ' fewer fields than ' + (hasHeader ? 'the header' : 'the widest row') + ' (' + width + ') — ' +
        describeLines(shortLines) + '. Missing values were left empty.'));
    }
    if (longLines.length && fullWidth === width) {
      messages.push(msg('info', 'Trailing empty fields were ignored on ' + describeLines(longLines) + '.'));
    }
    if (parsed.afterQuoteLines.length) {
      messages.push(msg('warn', 'Text after a closing quote on ' + describeLines(parsed.afterQuoteLines) +
        ' was kept as part of the field. Quote the whole field and double any quotes inside it.'));
    }
    if (parsed.strayQuoteLines.length) {
      messages.push(msg('info', 'A " inside an unquoted field on ' + describeLines(parsed.strayQuoteLines) +
        ' was kept as a literal character.'));
    }

    var names = [];
    for (var c = 0; c < fullWidth; c++) {
      names.push(hasHeader && c < raw[0].length ? raw[0][c] : (hasHeader ? null : ''));
    }
    var columns = normalizeColumnNames(names, messages, hasHeader);
    if (fullWidth > width) {
      messages.push(msg('warn', plural(longLines.length, 'row') + ' ' + (longLines.length === 1 ? 'has' : 'have') +
        ' more fields than the header (' + width + ') — ' + describeLines(longLines) +
        '. The extra values were kept in ' + (fullWidth - width === 1 ? 'a new column: ' : 'new columns: ') +
        describeList(columns.slice(width)) + '.'));
    }

    var padded = body.map(function (r) {
      var out = new Array(fullWidth);
      for (var col = 0; col < fullWidth; col++) out[col] = col < r.length ? r[col] : '';
      return out;
    });
    var types = columns.map(function (name, col) {
      return opts.inferTypes ? csvColumnType(padded, col) : 'text';
    });
    var rows = padded.map(function (r) {
      return r.map(function (s, col) { return convertCell(s, types[col], opts); });
    });

    meta.rows = rows.length;
    meta.columns = columns.length;
    if (!rows.length && hasHeader) {
      messages.push(msg('info', 'Only a header row was found — there are no data rows to convert.'));
    }
    return { format: 'csv', table: { columns: columns, rows: rows }, meta: meta, messages: messages };
  }

  // ── JSON parsing ────────────────────────────────────────

  // Pull a readable message and line/column out of engine-specific JSON errors
  function jsonErrorInfo(err, text) {
    var message = String(err && err.message ? err.message : err);
    var line = 0;
    var column = 0;
    var m = message.match(/line (\d+) column (\d+)/i);
    if (m) {
      line = Number(m[1]);
      column = Number(m[2]);
    } else {
      m = message.match(/position (\d+)/i);
      if (m) {
        var pos = Number(m[1]);
        var before = text.slice(0, pos);
        line = countLineBreaks(before) + 1;
        column = pos - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
      } else if (/end of (JSON )?(input|data)/i.test(message)) {
        line = countLineBreaks(text) + 1;
      }
    }
    var clean = message
      .replace(/^JSON\.parse: /, '')
      .replace(/^JSON Parse error: /, '')
      .replace(/ of the JSON data$/, '')
      .replace(/ in JSON at position \d+.*$/, '')
      .replace(/ at line \d+ column \d+/, '');
    return { message: clean, line: line, column: column };
  }

  // Parse a JSON document, falling back to JSON Lines (one value per line)
  function parseJsonText(text) {
    var src = text.charAt(0) === BOM ? text.slice(1) : text;
    try {
      return { value: JSON.parse(src), jsonLines: false };
    } catch (err) {
      var info = jsonErrorInfo(err, src);
      var lines = src.split(/\r\n|\r|\n/);
      var values = [];
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (!l) continue;
        try {
          values.push(JSON.parse(l));
        } catch (lineErr) {
          if (!values.length) return { error: info };
          var li = jsonErrorInfo(lineErr, l);
          return { error: { message: li.message, line: i + 1, column: li.column } };
        }
      }
      if (values.length > 1) return { value: values, jsonLines: true };
      return { error: info };
    }
  }

  // {"a":{"b":1}} → {"a.b":1}; arrays and empty objects stay as values
  function flattenObject(obj) {
    var out = Object.create(null);
    var nested = false;
    (function walk(o, prefix) {
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        var path = prefix ? prefix + '.' + k : k;
        if (isPlainObject(v) && Object.keys(v).length) {
          nested = true;
          walk(v, path);
        } else {
          out[path] = v;
        }
      });
    })(obj, '');
    return { record: out, nested: nested };
  }

  function unsafeIntegerColumns(table) {
    var cols = [];
    for (var c = 0; c < table.columns.length; c++) {
      for (var r = 0; r < table.rows.length; r++) {
        var v = table.rows[r][c];
        if (typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v)) {
          cols.push(table.columns[c]);
          break;
        }
      }
    }
    return cols;
  }

  function tableFromJson(value, opts, jsonLines) {
    var messages = [];
    var meta = { format: 'json', jsonLines: !!jsonLines, shape: '', path: '', header: false, headerAuto: false, rows: 0, columns: 0 };
    var data = value;

    // An API-style wrapper such as {"data": [...], "meta": {...}}: use the first array of objects
    if (isPlainObject(data)) {
      var keys = Object.keys(data);
      var found = null;
      for (var i = 0; i < keys.length; i++) {
        var v = data[keys[i]];
        if (Array.isArray(v) && v.length && v.every(isPlainObject)) {
          found = keys[i];
          break;
        }
      }
      if (found !== null) {
        meta.path = found;
        data = data[found];
        messages.push(msg('info', 'Using the "' + found + '" array (' + plural(data.length, 'record') +
          ') from the top-level object.'));
      } else {
        data = [data];
        meta.shape = 'object';
      }
    }

    if (!Array.isArray(data)) {
      messages.push(msg('error', 'The JSON is a single ' + typeOfValue(data) +
        '. Expected an array of objects, an array of arrays, or an object.'));
      return { format: 'json', table: null, meta: meta, messages: messages };
    }

    if (!data.length) {
      meta.shape = meta.shape || 'objects';
      messages.push(msg('info', 'The JSON array is empty — there are no rows to convert.'));
      return { format: 'json', table: { columns: [], rows: [] }, meta: meta, messages: messages };
    }

    // Every element must be the same kind: objects, arrays, or plain values
    var firstOf = { object: -1, array: -1, value: -1 };
    var nullIdx = [];
    data.forEach(function (el, idx) {
      var k = el === null ? 'null' : Array.isArray(el) ? 'array' : isPlainObject(el) ? 'object' : 'value';
      if (k === 'null') nullIdx.push(idx);
      else if (firstOf[k] === -1) firstOf[k] = idx;
    });
    var kinds = ['object', 'array', 'value']
      .filter(function (k) { return firstOf[k] !== -1; })
      .sort(function (x, y) { return firstOf[x] - firstOf[y]; });
    if (kinds.length > 1) {
      var a = kinds[0];
      var b = kinds[1];
      messages.push(msg('error', 'Mixed array: element [' + firstOf[a] + '] is ' + (a === 'value' ? 'a plain value' : 'an ' + a) +
        ' but element [' + firstOf[b] + '] is ' + (b === 'value' ? 'a plain value' : 'an ' + b) +
        '. Use all objects, all arrays, or all plain values.'));
      return { format: 'json', table: null, meta: meta, messages: messages };
    }
    var kind = kinds[0] || 'value';

    var columns;
    var rows;

    if (kind === 'value') {
      meta.shape = 'values';
      columns = ['value'];
      rows = data.map(function (v) { return [v]; });
    } else {
      var items = data.filter(function (el) { return el !== null; });
      if (nullIdx.length) {
        messages.push(msg('warn', 'Skipped ' + plural(nullIdx.length, 'null element') + ' at index ' +
          describeList(nullIdx.map(String)) + '.'));
      }

      if (kind === 'object') {
        meta.shape = meta.shape || 'objects';
        var nestedFound = false;
        var records = items.map(function (rec) {
          if (!opts.flatten) return rec;
          var f = flattenObject(rec);
          if (f.nested) nestedFound = true;
          return f.record;
        });

        // Union of keys in first-seen order
        var index = Object.create(null);
        columns = [];
        records.forEach(function (rec) {
          Object.keys(rec).forEach(function (k) {
            if (!(k in index)) {
              index[k] = true;
              columns.push(k);
            }
          });
        });

        // Drop a null-only "a" column when "a.b" columns exist (a was null in some records)
        if (nestedFound) {
          columns = columns.filter(function (col) {
            var prefix = col + '.';
            var hasChildren = columns.some(function (o) {
              return o.length > prefix.length && o.slice(0, prefix.length) === prefix;
            });
            if (!hasChildren) return true;
            return records.some(function (rec) { return hasOwn(rec, col) && rec[col] !== null; });
          });
          messages.push(msg('info', 'Nested objects were flattened into dot-notation columns such as ' +
            describeList(columns.filter(function (col) { return col.indexOf('.') !== -1; }).slice(0, 2)) + '.'));
        }

        var incomplete = 0;
        rows = records.map(function (rec) {
          var missing = false;
          var row = columns.map(function (col) {
            if (hasOwn(rec, col)) return rec[col];
            missing = true;
            return null;
          });
          if (missing) incomplete++;
          return row;
        });
        if (incomplete) {
          messages.push(msg('info', plural(incomplete, 'record') + ' of ' + fmt(records.length) +
            (incomplete === 1 ? ' is' : ' are') + ' missing some keys — those cells were filled with null.'));
        }
        columns = normalizeColumnNames(columns, messages, true);
      } else {
        // Array of arrays: the first row may be a header
        meta.shape = 'arrays';
        var strRows = items.map(function (r) { return r.map(cellToText); });
        meta.headerAuto = !opts.header || opts.header === 'auto';
        var hasHeader = meta.headerAuto ? detectHeader(strRows) : opts.header === 'yes';
        meta.header = hasHeader;
        var body = hasHeader ? items.slice(1) : items;
        var width = hasHeader ? items[0].length : 0;
        var ragged = [];
        body.forEach(function (r) { if (r.length > width) width = r.length; });
        body.forEach(function (r, idx) {
          if (r.length !== width) ragged.push(idx + (hasHeader ? 1 : 0));
        });
        if (ragged.length) {
          messages.push(msg('warn', plural(ragged.length, 'row') + ' ' + (ragged.length === 1 ? 'has' : 'have') +
            ' fewer values than the widest row (' + width + ') — index ' + describeList(ragged.map(String)) +
            '. Missing values were set to null.'));
        }
        var names = [];
        for (var c = 0; c < width; c++) {
          names.push(hasHeader && c < items[0].length ? cellToText(items[0][c]) : (hasHeader ? null : ''));
        }
        columns = normalizeColumnNames(names, messages, hasHeader);
        rows = body.map(function (r) {
          var out = new Array(width);
          for (var col = 0; col < width; col++) out[col] = col < r.length ? r[col] : null;
          return out;
        });
      }
    }

    var table = { columns: columns, rows: rows };

    var complex = [];
    columns.forEach(function (col, c) {
      for (var r = 0; r < rows.length; r++) {
        if (rows[r][c] !== null && typeof rows[r][c] === 'object') {
          complex.push(col);
          break;
        }
      }
    });
    if (complex.length) {
      messages.push(msg('info', 'Arrays and nested objects in ' + describeList(complex) +
        ' are written as JSON text in CSV and SQL output.'));
    }

    var unsafe = unsafeIntegerColumns(table);
    if (unsafe.length) {
      messages.push(msg('warn', 'Integers larger than 9007199254740991 in ' + describeList(unsafe) +
        ' cannot be represented exactly in JavaScript, so their last digits may already be rounded. ' +
        'Store such IDs as strings in the source JSON.'));
    }

    meta.rows = rows.length;
    meta.columns = columns.length;
    return { format: 'json', table: table, meta: meta, messages: messages };
  }

  // ── Input → table ───────────────────────────────────────

  function detectFormat(text) {
    var m = text.match(/\S/);
    var c = m ? m[0] : '';
    return (c === '[' || c === '{') ? 'json' : 'csv';
  }

  function buildTable(text, opts) {
    opts = opts || {};
    if (!text || !text.trim()) {
      return { format: '', table: null, meta: {}, messages: [], empty: true };
    }
    var auto = !opts.format || opts.format === 'auto';
    var format = auto ? detectFormat(text) : opts.format;
    var result;

    if (format === 'json') {
      var parsed = parseJsonText(text);
      if (parsed.error) {
        var e = parsed.error;
        var where = e.line ? ' (line ' + e.line + (e.column ? ', column ' + e.column : '') + ')' : '';
        result = {
          format: 'json', table: null, meta: { format: 'json' },
          messages: [msg('error', 'Invalid JSON' + where + ': ' + e.message)]
        };
        if (auto) {
          result.messages.push(msg('info', 'The input was read as JSON because it starts with "' +
            detectFirstChar(text) + '". Set Input format to CSV if it is a CSV file.'));
        }
      } else {
        result = tableFromJson(parsed.value, opts, parsed.jsonLines);
      }
    } else {
      result = tableFromCsv(text, opts);
    }

    if (text.indexOf(REPLACEMENT_CHAR) !== -1) {
      result.messages.push(msg('warn', 'The input contains ' + REPLACEMENT_CHAR + ' replacement characters — usually a file ' +
        'saved in a legacy encoding such as Windows-1252 and read as UTF-8. Re-export it as "CSV UTF-8".'));
    }
    result.meta.formatAuto = auto;
    return result;
  }

  function detectFirstChar(text) {
    var m = text.match(/\S/);
    return m ? m[0] : '';
  }

  // ── Output: JSON ────────────────────────────────────────

  function toRecord(columns, row) {
    var obj = Object.create(null);   // a "__proto__" column stays an ordinary key
    for (var c = 0; c < columns.length; c++) {
      obj[columns[c]] = row[c] === undefined ? null : row[c];
    }
    return obj;
  }

  function toJson(table, o) {
    o = o || {};
    var indent = o.indent === 'tab' ? '\t' : (parseInt(o.indent, 10) || 0);
    var cols = table.columns;

    if (o.shape === 'jsonl') {
      return table.rows.map(function (r) { return JSON.stringify(toRecord(cols, r)); }).join('\n');
    }
    if (o.shape === 'arrays') {
      var all = [cols].concat(table.rows.map(function (r) {
        return r.map(function (v) { return v === undefined ? null : v; });
      }));
      if (!indent) return JSON.stringify(all);
      var pad = typeof indent === 'string' ? indent : new Array(indent + 1).join(' ');
      // One row per line reads better than one cell per line
      return '[\n' + all.map(function (r) { return pad + JSON.stringify(r); }).join(',\n') + '\n]';
    }
    return JSON.stringify(table.rows.map(function (r) { return toRecord(cols, r); }), null, indent);
  }

  // ── Output: CSV ─────────────────────────────────────────

  function toCsv(table, o) {
    o = o || {};
    var d = o.delimiter || ',';
    var eol = o.eol === 'crlf' ? '\r\n' : '\n';
    var single = table.columns.length === 1;

    function cell(v) {
      var s = cellToText(v);
      if (o.quoteAll || s.indexOf(d) !== -1 || /["\r\n]/.test(s) || /^\s|\s$/.test(s) || (single && s === '')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    var lines = [];
    if (o.header !== false) lines.push(table.columns.map(cell).join(d));
    table.rows.forEach(function (r) { lines.push(r.map(cell).join(d)); });
    return lines.join(eol);
  }

  // ── Output: SQL ─────────────────────────────────────────

  function quoteIdent(name, d, mode) {
    var bare = d.caseFolds ? /^[a-z_][a-z0-9_]*$/ : /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (mode === 'needed' && bare.test(name) && !RESERVED[name.toUpperCase()]) return name;
    return d.open + name.split(d.close).join(d.close + d.close) + d.close;
  }

  function sqlString(s, d) {
    var body = s;
    if (d.backslash) body = body.replace(/\\/g, '\\\\').replace(/\x00/g, '\\0');
    body = body.replace(/'/g, "''");
    var prefix = d.unicodePrefix && /[^\x00-\x7f]/.test(s) ? 'N' : '';
    return prefix + "'" + body + "'";
  }

  function sqlLiteral(v, d) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'boolean') return v ? d.t : d.f;
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'object') return sqlString(JSON.stringify(v), d);
    return sqlString(String(v), d);
  }

  function mergeKind(a, b) {
    if (a === 'empty' || a === b) return b;
    var rank = { integer: 1, bigint: 2, decimal: 3 };
    if (rank[a] && rank[b]) return rank[a] > rank[b] ? a : b;
    if ((a === 'date' || a === 'datetime') && (b === 'date' || b === 'datetime')) return 'datetime';
    return 'text';
  }

  // Infer a column's value kind and longest text length from all rows
  function columnKind(rows, c) {
    var kind = 'empty';
    var maxLen = 0;
    for (var r = 0; r < rows.length; r++) {
      var v = rows[r][c];
      if (v === null || v === undefined) continue;
      var k;
      var len;
      if (typeof v === 'boolean') {
        k = 'boolean';
        len = 5;
      } else if (typeof v === 'number') {
        if (Number.isInteger(v) && v >= INT32_MIN && v <= INT32_MAX) k = 'integer';
        else if (Number.isInteger(v) && Math.abs(v) < INT64_LIMIT) k = 'bigint';
        else k = 'decimal';
        len = String(v).length;
      } else if (typeof v === 'object') {
        k = 'json';
        len = JSON.stringify(v).length;
      } else {
        var str = String(v);
        k = ISO_DATE_RE.test(str) ? 'date' : ISO_DATETIME_RE.test(str) ? 'datetime' : 'text';
        len = str.length;
      }
      if (len > maxLen) maxLen = len;
      kind = mergeKind(kind, k);
    }
    return { kind: kind, maxLen: maxLen };
  }

  function sqlType(info, dialect) {
    var k = info.kind;
    var len = info.maxLen;
    switch (dialect) {
      case 'mysql':
        if (k === 'boolean') return 'BOOLEAN';
        if (k === 'integer') return 'INT';
        if (k === 'bigint') return 'BIGINT';
        if (k === 'decimal') return 'DOUBLE';
        if (k === 'date') return 'DATE';
        if (k === 'datetime') return 'DATETIME(6)';
        if (k === 'json') return 'JSON';
        return len <= 255 ? 'VARCHAR(255)' : len <= 16383 ? 'TEXT' : 'LONGTEXT';
      case 'sqlite':
        // SQLite has no date type; ISO 8601 text sorts and compares correctly
        if (k === 'boolean' || k === 'integer' || k === 'bigint') return 'INTEGER';
        if (k === 'decimal') return 'REAL';
        return 'TEXT';
      case 'mssql':
        if (k === 'boolean') return 'BIT';
        if (k === 'integer') return 'INT';
        if (k === 'bigint') return 'BIGINT';
        if (k === 'decimal') return 'FLOAT';
        if (k === 'date') return 'DATE';
        if (k === 'datetime') return 'DATETIME2';
        if (k === 'json') return 'NVARCHAR(MAX)';
        return len <= 255 ? 'NVARCHAR(255)' : len <= 4000 ? 'NVARCHAR(4000)' : 'NVARCHAR(MAX)';
      default:
        if (k === 'boolean') return 'BOOLEAN';
        if (k === 'integer') return 'INTEGER';
        if (k === 'bigint') return 'BIGINT';
        if (k === 'decimal') return 'NUMERIC';
        if (k === 'date') return 'DATE';
        if (k === 'datetime') return 'TIMESTAMP';
        if (k === 'json') return 'JSONB';
        return 'TEXT';
    }
  }

  function identLength(name, d) {
    return d.identBytes ? utf8Length(name) : name.length;
  }

  function toSql(table, o) {
    o = o || {};
    var dialect = SQL_DIALECTS[o.dialect] ? o.dialect : 'postgres';
    var d = SQL_DIALECTS[dialect];
    var mode = o.quoting === 'needed' ? 'needed' : 'always';
    var messages = [];

    var name = String(o.table == null ? '' : o.table).trim();
    if (!name) {
      return { sql: '', messages: [msg('error', 'Enter a table name for the INSERT statements.')] };
    }
    var parts = name.split('.').map(function (p) { return p.trim(); });
    if (parts.some(function (p) { return !p; })) {
      return { sql: '', messages: [msg('error', 'Table name "' + name + '" has an empty part. Use table or schema.table.')] };
    }
    if (!table.columns.length) return { sql: '', messages: messages };

    var tableSql = parts.map(function (p) { return quoteIdent(p, d, mode); }).join('.');
    var cols = table.columns.map(function (c) { return quoteIdent(c, d, mode); });

    if (d.maxIdent) {
      var tooLong = parts.concat(table.columns).filter(function (c) { return identLength(c, d) > d.maxIdent; });
      if (tooLong.length) {
        messages.push(msg('warn', d.label + ' limits identifiers to ' + d.maxIdent + (d.identBytes ? ' bytes' : ' characters') +
          '; ' + (dialect === 'postgres' ? 'it truncates ' : 'it rejects ') + describeList(tooLong) + '.'));
      }
    }

    var batch = parseInt(o.batch, 10) || 0;   // 0 = every row in one statement
    if (d.maxRows && table.rows.length > d.maxRows && (batch === 0 || batch > d.maxRows)) {
      batch = d.maxRows;
      messages.push(msg('info', d.label + ' accepts at most ' + fmt(d.maxRows) +
        ' rows per INSERT … VALUES, so the rows were split into batches of ' + fmt(d.maxRows) + '.'));
    }

    var blocks = [];
    if (o.transaction) blocks.push(d.begin);
    if (o.createTable) {
      var defs = table.columns.map(function (c, i) {
        return '  ' + cols[i] + ' ' + sqlType(columnKind(table.rows, i), dialect);
      });
      blocks.push('CREATE TABLE ' + tableSql + ' (\n' + defs.join(',\n') + '\n);');
    }

    if (table.rows.length) {
      var head = 'INSERT INTO ' + tableSql + ' (' + cols.join(', ') + ') VALUES';
      var size = batch > 0 ? batch : table.rows.length;
      var statements = [];
      for (var start = 0; start < table.rows.length; start += size) {
        var tuples = table.rows.slice(start, start + size).map(function (r) {
          var vals = [];
          for (var c = 0; c < table.columns.length; c++) vals.push(sqlLiteral(r[c], d));
          return '(' + vals.join(', ') + ')';
        });
        statements.push(size === 1 ? head + ' ' + tuples[0] + ';' : head + '\n  ' + tuples.join(',\n  ') + ';');
      }
      blocks.push(statements.join(size === 1 ? '\n' : '\n\n'));
    }

    if (o.transaction) blocks.push(d.commit);
    return { sql: blocks.join('\n\n'), messages: messages };
  }

  function tableNameFromFile(fileName) {
    var base = String(fileName || '').replace(/\.[^.]+$/, '').toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base) return 'my_table';
    if (/^[0-9]/.test(base)) base = 't_' + base;
    return base.slice(0, 63);
  }

  // ── Samples ─────────────────────────────────────────────

  var SAMPLES = {
    csv: [
      'id,name,email,city,zip,active,signup_date,notes',
      '1,Alice Johnson,alice@example.com,Berlin,10115,true,2026-01-14,',
      '2,"O\'Brien, Liam",liam@example.com,Dublin,D02 X285,false,2026-02-03,"Prefers ""email"" contact"',
      '3,Sofia Rossi,sofia@example.com,Milan,20121,true,2026-03-21,"Two-line note:',
      'call before noon"',
      '4,Kenji Tanaka,kenji@example.com,Osaka,530-0001,true,2026-04-09,',
      '5,Emma Novak,emma@example.com,Prague,01100,false,2026-05-30,VIP'
    ].join('\n'),
    json: JSON.stringify([
      { sku: 'KB-104', product: 'Mechanical keyboard', price: 89.9, in_stock: true, tags: ['peripherals', 'usb-c'], size: { w: 44, h: 3.5 } },
      { sku: 'MS-220', product: 'Wireless mouse', price: 34.5, in_stock: false, tags: [], size: { w: 6.4, h: 4 } },
      { sku: 'HB-7', product: 'USB-C hub "7-in-1"', price: 45, in_stock: true, tags: ['usb-c'], size: { w: 11, h: 1.6 }, discontinued: null }
    ], null, 2)
  };

  // ── UI state ────────────────────────────────────────────

  var state = {
    tab: 'json',
    result: null,
    output: '',
    fileName: '',
    tableNameTouched: false,
    lastText: null,
    lastOptsKey: ''
  };
  var timer = null;

  function inputOptions() {
    var delim = $('cjs-delimiter').value;
    return {
      format: $('cjs-format').value,
      delimiter: delim === 'tab' ? '\t' : delim,
      header: $('cjs-header-row').value,
      trim: $('cjs-trim').checked,
      inferTypes: $('cjs-infer').checked,
      emptyAsNull: $('cjs-empty-null').checked,
      flatten: $('cjs-flatten').checked
    };
  }

  function outputOptions() {
    var csvDelim = $('cjs-csv-delimiter').value;
    return {
      json: { shape: $('cjs-json-shape').value, indent: $('cjs-json-indent').value },
      csv: {
        delimiter: csvDelim === 'tab' ? '\t' : csvDelim,
        quoteAll: $('cjs-csv-quote').value === 'all',
        eol: $('cjs-csv-eol').value,
        header: $('cjs-csv-header').checked
      },
      sql: {
        dialect: $('cjs-sql-dialect').value,
        table: $('cjs-sql-table').value,
        batch: $('cjs-sql-batch').value,
        quoting: $('cjs-sql-quoting').value,
        createTable: $('cjs-sql-create').checked,
        transaction: $('cjs-sql-tx').checked
      }
    };
  }

  // ── Rendering ───────────────────────────────────────────

  function renderMessages(list, messages) {
    list.textContent = '';
    messages.forEach(function (m) {
      var li = document.createElement('li');
      li.className = 'cjs-msg' + (m.level === 'error' ? ' cjs-msg--error' : m.level === 'warn' ? ' cjs-msg--warn' : '');
      li.textContent = m.text;
      list.appendChild(li);
    });
  }

  function setAutoLabel(selectId, detected) {
    var opt = $(selectId).options[0];
    opt.textContent = detected ? 'Auto — ' + detected : 'Auto';
  }

  function summaryText(result) {
    if (!result || result.empty) return 'Paste CSV or JSON, drop a file here, or load a sample.';
    var meta = result.meta;
    var size = result.table ? ' · ' + plural(meta.rows, 'row') + ' × ' + plural(meta.columns, 'column') : '';
    if (!result.table) return (result.format === 'json' ? 'JSON' : 'CSV') + ' · not converted — see the error below';
    if (result.format === 'csv') {
      var d = meta.delimiter ? DELIMITER_NAMES[meta.delimiter] + '-separated' : 'single column';
      return 'CSV · ' + d + ' · ' + (meta.header ? 'header row' : 'no header row') + size;
    }
    var shapes = {
      objects: 'array of objects', arrays: 'array of arrays', values: 'array of values', object: 'single object'
    };
    return (meta.jsonLines ? 'JSON Lines' : 'JSON') + ' · ' + (shapes[meta.shape] || 'array') +
      (meta.path ? ' in "' + meta.path + '"' : '') +
      (meta.shape === 'arrays' ? (meta.header ? ' with header row' : ', no header row') : '') + size;
  }

  function renderInput(result) {
    var meta = result.meta || {};
    setAutoLabel('cjs-format', result.format ? result.format.toUpperCase() : '');
    setAutoLabel('cjs-delimiter', result.format === 'csv' && meta.delimiterAuto
      ? (meta.delimiter ? DELIMITER_NAMES[meta.delimiter] : 'none') : '');
    setAutoLabel('cjs-header-row', meta.headerAuto && result.table ? (meta.header ? 'yes' : 'no') : '');

    var summary = $('cjs-summary');
    summary.textContent = summaryText(result);
    summary.classList.toggle('cjs-status--ok', !!(result.table && result.table.columns.length));
    renderMessages($('cjs-messages'), result.messages || []);
  }

  function renderPreview(result) {
    var wrap = $('cjs-preview');
    var caption = $('cjs-preview-caption');
    var empty = $('cjs-preview-empty');
    var table = result && result.table;
    wrap.textContent = '';

    if (!table || !table.columns.length) {
      wrap.classList.add('cjs-hidden');
      empty.classList.remove('cjs-hidden');
      caption.textContent = '';
      return;
    }
    wrap.classList.remove('cjs-hidden');
    empty.classList.add('cjs-hidden');

    var el = document.createElement('table');
    el.className = 'cjs-table';
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    var corner = document.createElement('th');
    corner.className = 'cjs-th-index';
    corner.textContent = '#';
    hr.appendChild(corner);
    table.columns.forEach(function (col, c) {
      var th = document.createElement('th');
      th.scope = 'col';
      var nameEl = document.createElement('span');
      nameEl.className = 'cjs-col-name';
      nameEl.textContent = col;
      var typeEl = document.createElement('span');
      typeEl.className = 'cjs-col-type';
      typeEl.textContent = KIND_LABELS[columnKind(table.rows, c).kind];
      th.appendChild(nameEl);
      th.appendChild(typeEl);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    el.appendChild(thead);

    var tbody = document.createElement('tbody');
    var shown = Math.min(table.rows.length, PREVIEW_ROWS);
    for (var r = 0; r < shown; r++) {
      var tr = document.createElement('tr');
      var idx = document.createElement('td');
      idx.className = 'cjs-td-index';
      idx.textContent = String(r + 1);
      tr.appendChild(idx);
      for (var c = 0; c < table.columns.length; c++) {
        var v = table.rows[r][c];
        var td = document.createElement('td');
        var type = v === null || v === undefined ? 'null' : typeof v === 'object' ? 'json' : typeof v;
        td.className = 'cjs-cell cjs-cell--' + type;
        var text = type === 'null' ? 'null' : cellToText(v);
        td.textContent = text;
        if (text.length > 40) td.title = text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    el.appendChild(tbody);
    wrap.appendChild(el);

    caption.textContent = table.rows.length > shown
      ? 'First ' + fmt(shown) + ' of ' + fmt(table.rows.length) + ' rows'
      : plural(table.rows.length, 'row');
  }

  function outputExtension() {
    if (state.tab === 'json') return $('cjs-json-shape').value === 'jsonl' ? 'jsonl' : 'json';
    return state.tab;
  }

  function renderOutput() {
    var result = state.result;
    var o = outputOptions();
    var out = '';
    var messages = [];
    var table = result && result.table;

    if (table && table.columns.length) {
      if (state.tab === 'json') {
        out = toJson(table, o.json);
      } else if (state.tab === 'csv') {
        out = toCsv(table, o.csv);
      } else {
        var s = toSql(table, o.sql);
        out = s.sql;
        messages = s.messages;
      }
    } else if (table && state.tab === 'json') {
      out = '[]';
    }

    state.output = out;
    var area = $('cjs-output');
    var truncated = out.length > MAX_DISPLAY_CHARS;
    area.value = truncated ? out.slice(0, MAX_DISPLAY_CHARS) : out;

    var status = $('cjs-out-status');
    if (out) {
      status.textContent = plural(table.rows.length, 'row') + ' · ' + formatBytes(utf8Length(out)) +
        (truncated ? ' · preview cut at 1 MB, Copy and Download use the full output' : '');
    } else if (result && !result.empty && !table) {
      status.textContent = 'Fix the input error to see the output.';
    } else {
      status.textContent = '';
    }
    renderMessages($('cjs-out-messages'), messages);

    $('cjs-btn-copy').disabled = !out;
    $('cjs-btn-download').disabled = !out;
    $('cjs-btn-download').textContent = 'Download .' + outputExtension();
  }

  function update() {
    clearTimeout(timer);
    var text = $('cjs-input').value;
    var opts = inputOptions();
    var key = JSON.stringify(opts);
    if (text !== state.lastText || key !== state.lastOptsKey) {
      state.result = buildTable(text, opts);
      state.lastText = text;
      state.lastOptsKey = key;
      renderInput(state.result);
      renderPreview(state.result);
    }
    renderOutput();
  }

  function scheduleUpdate() {
    clearTimeout(timer);
    var len = $('cjs-input').value.length;
    timer = setTimeout(update, len > 500000 ? 600 : 200);
  }

  // ── Actions ─────────────────────────────────────────────

  function showToast(text, isError) {
    var toast = $('cjs-toast');
    toast.textContent = text;
    toast.classList.toggle('cjs-toast--error', !!isError);
    toast.classList.add('cjs-show');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(function () { toast.classList.remove('cjs-show'); }, 2200);
  }

  function copyText(text) {
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
      showToast(ok ? 'Copied!' : 'Copy failed — select the text and copy manually', !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast('Copied!'); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function copyOutput() {
    if (state.output) copyText(state.output);
  }

  function downloadOutput() {
    if (!state.output) return;
    var ext = outputExtension();
    var mime = { json: 'application/json', jsonl: 'application/x-ndjson', csv: 'text/csv', sql: 'application/sql' }[ext];
    var eol = state.tab === 'csv' && $('cjs-csv-eol').value === 'crlf' ? '\r\n' : '\n';
    var text = state.output + eol;
    if (state.tab === 'csv' && $('cjs-csv-bom').checked) text = BOM + text;

    var base = state.fileName ? state.fileName.replace(/\.[^.]+$/, '') : '';
    if (!base) base = state.tab === 'sql' ? tableNameFromFile($('cjs-sql-table').value) : 'data';

    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = base + '.' + ext;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function setTab(tab) {
    if (['json', 'csv', 'sql'].indexOf(tab) === -1) tab = 'json';
    state.tab = tab;
    ['json', 'csv', 'sql'].forEach(function (t) {
      var btn = $('cjs-tab-' + t);
      var on = t === tab;
      btn.classList.toggle('cjs-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      $('cjs-opts-' + t).classList.toggle('cjs-hidden', !on);
    });
    $('cjs-output-panel').setAttribute('aria-labelledby', 'cjs-tab-' + tab);
    renderOutput();
  }

  function setFileLabel(text) {
    $('cjs-file-name').textContent = text;
  }

  function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showToast('File is larger than ' + formatBytes(MAX_FILE_BYTES) + ' — split it first', true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      state.fileName = file.name;
      $('cjs-format').value = 'auto';
      $('cjs-input').value = String(reader.result);
      if (!state.tableNameTouched) $('cjs-sql-table').value = tableNameFromFile(file.name);
      setFileLabel(file.name + ' · ' + formatBytes(file.size));
      update();
    };
    reader.onerror = function () { showToast('Could not read the file', true); };
    reader.readAsText(file);
  }

  function openFile() {
    $('cjs-file').click();
  }

  function loadSample(kind) {
    var text = SAMPLES[kind];
    if (!text) return;
    $('cjs-input').value = text;
    $('cjs-format').value = 'auto';
    $('cjs-delimiter').value = 'auto';
    $('cjs-header-row').value = 'auto';
    state.fileName = '';
    setFileLabel('');
    if (!state.tableNameTouched) $('cjs-sql-table').value = kind === 'csv' ? 'customers' : 'products';
    update();
  }

  function clearInput() {
    $('cjs-input').value = '';
    state.fileName = '';
    setFileLabel('');
    update();
    $('cjs-input').focus();
  }

  // ── Init ────────────────────────────────────────────────

  function hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  function init() {
    var wrapper = document.querySelector('.cjs-wrapper');
    if (!wrapper) return;
    var input = $('cjs-input');

    wrapper.addEventListener('input', function (e) {
      if (e.target.id === 'cjs-input') {
        scheduleUpdate();
      } else if (e.target.id === 'cjs-sql-table') {
        state.tableNameTouched = true;
        renderOutput();
      }
    });
    wrapper.addEventListener('change', function (e) {
      var id = e.target.id;
      if (id === 'cjs-input' || id === 'cjs-output' || id === 'cjs-file' || id === 'cjs-sql-table') return;
      update();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        update();
      }
    });

    $('cjs-file').addEventListener('change', function (e) {
      loadFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      input.addEventListener(type, function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        input.classList.add('cjs-dragover');
      });
    });
    input.addEventListener('dragleave', function () { input.classList.remove('cjs-dragover'); });
    input.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      input.classList.remove('cjs-dragover');
      if (!files || !files.length) return;
      e.preventDefault();
      loadFile(files[0]);
    });

    // Arrow keys move between output tabs
    $('cjs-tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var order = ['json', 'csv', 'sql'];
      var next = order[(order.indexOf(state.tab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
      setTab(next);
      $('cjs-tab-' + next).focus();
      e.preventDefault();
    });

    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Expose global handlers for onclick attributes
  window.cjsSetTab = setTab;
  window.cjsLoadSample = loadSample;
  window.cjsOpenFile = openFile;
  window.cjsClear = clearInput;
  window.cjsCopy = copyOutput;
  window.cjsDownload = downloadOutput;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseCsv: parseCsv,
      detectDelimiter: detectDelimiter,
      detectHeader: detectHeader,
      parseNumber: parseNumber,
      parseBoolean: parseBoolean,
      csvColumnType: csvColumnType,
      normalizeColumnNames: normalizeColumnNames,
      tableFromCsv: tableFromCsv,
      jsonErrorInfo: jsonErrorInfo,
      parseJsonText: parseJsonText,
      flattenObject: flattenObject,
      tableFromJson: tableFromJson,
      detectFormat: detectFormat,
      buildTable: buildTable,
      cellToText: cellToText,
      toJson: toJson,
      toCsv: toCsv,
      quoteIdent: quoteIdent,
      sqlLiteral: sqlLiteral,
      columnKind: columnKind,
      sqlType: sqlType,
      toSql: toSql,
      tableNameFromFile: tableNameFromFile,
      SQL_DIALECTS: SQL_DIALECTS,
      SAMPLES: SAMPLES
    };
  }

})();
