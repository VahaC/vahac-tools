// Dependencies: qrcode-generator v2.0.4 (MIT, Kazuhiko Arase) — loaded on demand by ensureQrLib()
// CDN: https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.min.js
// Same library and version as the vCard QR Code Generator, so the browser cache is shared.
//
// Payload format: the de-facto ZXing "WIFI:" scheme, as formalised in the
// Wi-Fi Alliance WPA3 Specification (T, R, S, H and P fields, backslash-escaped values).

(function () {
  'use strict';

  var QR_LIB_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.min.js';

  var $ = function (id) { return document.getElementById(id); };

  // ── Security modes ──────────────────────────────────────

  var SECURITY = {
    wpa: {
      card: 'WPA/WPA2/WPA3',
      hint: 'Works for WPA2, WPA2/WPA3 transition mode and older WPA networks. Encoded as T:WPA, the value every major phone understands.'
    },
    wpa3: {
      card: 'WPA3',
      hint: 'For routers set to WPA3-only (SAE). Encoded as T:WPA;R:1 as defined in the Wi-Fi Alliance WPA3 specification. R:1 tells supporting devices not to fall back to WPA2.'
    },
    wep: {
      card: 'WEP',
      hint: 'Obsolete encryption that can be cracked in minutes. Only use this if the router cannot be switched to WPA2 or WPA3.'
    },
    nopass: {
      card: 'Open (no password)',
      hint: 'No password: anyone in range can join and traffic over the air is not encrypted.'
    }
  };

  // ── Pure helpers (exported for tests) ───────────────────

  // Escape a field value: backslash before \ ; , : and "
  function escapeValue(value) {
    return String(value == null ? '' : value).replace(/([\\;,:"])/g, '\\$1');
  }

  // UTF-8 encode a string into a "byte string" (one char per byte, 0–255)
  function toUtf8ByteString(str) {
    str = String(str == null ? '' : str);
    if (typeof TextEncoder !== 'undefined') {
      var bytes = new TextEncoder().encode(str);
      var out = '';
      for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
      return out;
    }
    return unescape(encodeURIComponent(str));
  }

  function utf8Length(str) {
    return toUtf8ByteString(str).length;
  }

  // Split into code points so emoji/surrogate pairs stay intact
  function splitChars(str) {
    return String(str).match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g) || [];
  }

  function normalizeSecurity(security) {
    return Object.prototype.hasOwnProperty.call(SECURITY, security) ? security : 'wpa';
  }

  // Value written after "T:"
  function securityType(security, saeStyle) {
    security = normalizeSecurity(security);
    if (security === 'nopass') return 'nopass';
    if (security === 'wep') return 'WEP';
    if (security === 'wpa3' && saeStyle) return 'SAE';
    return 'WPA';
  }

  // Build the WIFI: payload. Field order follows the WPA3 spec: T, R, S, H, P.
  function buildPayload(data) {
    var security = normalizeSecurity(data.security);
    var fields = ['T:' + securityType(security, data.saeStyle)];
    if (security === 'wpa3' && !data.saeStyle) fields.push('R:1');
    fields.push('S:' + escapeValue(data.ssid));
    if (data.hidden) fields.push('H:true');
    if (security !== 'nopass' && data.password) fields.push('P:' + escapeValue(data.password));
    return 'WIFI:' + fields.join(';') + ';;';
  }

  function isHex(str) {
    return /^[0-9a-fA-F]+$/.test(str);
  }

  function isPrintableAscii(str) {
    return /^[\x20-\x7e]*$/.test(str);
  }

  // Returns [{ level: 'error' | 'warn' | 'info', field, text }]
  function validate(data) {
    var msgs = [];
    var add = function (level, field, text) { msgs.push({ level: level, field: field, text: text }); };
    var security = normalizeSecurity(data.security);
    var ssid = String(data.ssid == null ? '' : data.ssid);
    var pw = String(data.password == null ? '' : data.password);

    if (!ssid) {
      add('error', 'ssid', 'Enter the network name (SSID).');
    } else {
      var ssidBytes = utf8Length(ssid);
      if (ssidBytes > 32) {
        add('warn', 'ssid', 'The network name is ' + ssidBytes + ' bytes long, but Wi-Fi SSIDs are limited to 32 bytes. Check it matches your router exactly.');
      }
      if (ssid !== ssid.trim()) {
        add('warn', 'ssid', 'The network name starts or ends with a space. That is allowed, but it must match the router exactly.');
      }
    }

    if (data.hidden) {
      add('info', 'hidden', 'Hidden network: the code includes H:true so phones search for the network even though it is not broadcast.');
    }

    if (security === 'nopass') {
      add('info', 'security', 'Open network: anyone in range can join, and traffic over the air is not encrypted.');
      return msgs;
    }

    if (security === 'wep') {
      add('warn', 'security', 'WEP can be cracked in minutes. Switch the router to WPA2 or WPA3 if it supports it.');
    }

    if (!pw) {
      add('error', 'password', 'Enter the Wi-Fi password.');
      return msgs;
    }

    var len = splitChars(pw).length;

    if (pw !== pw.trim()) {
      add('warn', 'password', 'The password starts or ends with a space. Check this is intentional.');
    }

    if (security === 'wpa') {
      if (len === 64 && isHex(pw)) {
        add('info', 'password', 'A 64-digit hex value is used as a raw pre-shared key rather than a passphrase.');
      } else if (!isPrintableAscii(pw)) {
        add('warn', 'password', 'The password contains non-ASCII characters. WPA2 passphrases are defined as printable ASCII, so some devices may fail to connect.');
      } else if (len < 8 || len > 63) {
        add('warn', 'password', 'WPA2 passphrases are 8–63 characters long; this one has ' + len + '.');
      }
    } else if (security === 'wpa3') {
      if (len < 8) {
        add('warn', 'password', 'Most routers require WPA3 passwords of at least 8 characters; this one has ' + len + '.');
      }
    } else if (security === 'wep') {
      var asciiOk = isPrintableAscii(pw) && (len === 5 || len === 13);
      var hexOk = isHex(pw) && (len === 10 || len === 26);
      if (!asciiOk && !hexOk) {
        add('warn', 'password', 'WEP keys are 5 or 13 characters, or 10 or 26 hex digits; this one has ' + len + ' characters.');
      }
    }

    return msgs;
  }

  function hasErrors(msgs) {
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].level === 'error') return true;
    }
    return false;
  }

  // Build an SVG from a module matrix ({ count, modules[row][col] }).
  // Horizontal runs of dark modules are merged into single path segments.
  function buildSvg(matrix, quiet, pixelSize) {
    var total = matrix.count + quiet * 2;
    var d = '';
    for (var r = 0; r < matrix.count; r++) {
      var c = 0;
      while (c < matrix.count) {
        if (!matrix.modules[r][c]) { c++; continue; }
        var start = c;
        while (c < matrix.count && matrix.modules[r][c]) c++;
        var run = c - start;
        d += 'M' + (start + quiet) + ' ' + (r + quiet) + 'h' + run + 'v1h-' + run + 'z';
      }
    }
    var px = pixelSize || total * 10;
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" ' +
      'width="' + px + '" height="' + px + '" shape-rendering="crispEdges">\n' +
      '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>\n' +
      '<path fill="#000000" d="' + d + '"/>\n' +
      '</svg>\n';
  }

  // ASCII-only file name fragment from the SSID
  function fileSlug(ssid) {
    return String(ssid == null ? '' : ssid)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '');
  }

  // Print grid for N cards on the smaller of A4 / Letter (minus 8 mm margins).
  // aspect = card height / width. Returns column count and card width in mm.
  function printLayout(copies, aspect) {
    var PAGE_W = 194;
    var PAGE_H = 263;
    var GAP = 6;
    var grids = { 1: [1, 1, 130], 2: [2, 1, 100], 4: [2, 2, 100], 6: [3, 2, 100] };
    var g = grids[copies] || grids[1];
    var cols = g[0];
    var rows = g[1];
    var byWidth = (PAGE_W - (cols - 1) * GAP) / cols;
    var byHeight = (PAGE_H - (rows - 1) * GAP) / rows / aspect;
    var width = Math.floor(Math.min(byWidth, byHeight, g[2]) * 10) / 10;
    return { cols: cols, rows: rows, gap: GAP, width: width, count: cols * rows };
  }

  // ── QR library loading ──────────────────────────────────

  function ensureQrLib(onReady) {
    if (typeof window.qrcode === 'function') { onReady(); return; }
    if (window.__wqrQrLoading) { window.__wqrQrLoading.push(onReady); return; }
    window.__wqrQrLoading = [onReady];
    var script = document.createElement('script');
    script.src = QR_LIB_URL;
    script.async = true;
    script.onload = function () {
      var queue = window.__wqrQrLoading || [];
      window.__wqrQrLoading = null;
      queue.forEach(function (cb) {
        try { cb(); } catch (err) { console.error(err); }
      });
    };
    script.onerror = function () {
      window.__wqrQrLoading = null;
      showFailure('Could not load the QR code library from the CDN. Check your connection and reload the page.');
    };
    (document.head || document.body).appendChild(script);
  }

  // Encode text as UTF-8 bytes. The library's default converter keeps one byte per
  // char, so feeding it a UTF-8 byte string gives correct output for any SSID.
  function makeMatrix(text, ecl) {
    var lib = window.qrcode;
    var saved = lib.stringToBytes;
    if (lib.stringToBytesFuncs && lib.stringToBytesFuncs['default']) {
      lib.stringToBytes = lib.stringToBytesFuncs['default'];
    }
    var qr;
    try {
      qr = lib(0, ecl);
      qr.addData(toUtf8ByteString(text), 'Byte');
      qr.make();
    } finally {
      lib.stringToBytes = saved;
    }
    var count = qr.getModuleCount();
    var modules = [];
    for (var r = 0; r < count; r++) {
      var row = [];
      for (var c = 0; c < count; c++) row.push(qr.isDark(r, c));
      modules.push(row);
    }
    return { count: count, modules: modules, version: (count - 17) / 4 };
  }

  // ── Canvas drawing ──────────────────────────────────────

  // Draw the matrix into a size×size square at (x, y). Module edges are rounded
  // to whole pixels so every module stays crisp at any output size.
  function drawQr(ctx, matrix, x, y, size, quiet) {
    var total = matrix.count + quiet * 2;
    var edge = function (i) { return Math.round(i * size / total); };
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < matrix.count; r++) {
      var y0 = edge(r + quiet);
      var y1 = edge(r + quiet + 1);
      var c = 0;
      while (c < matrix.count) {
        if (!matrix.modules[r][c]) { c++; continue; }
        var start = c;
        while (c < matrix.count && matrix.modules[r][c]) c++;
        var x0 = edge(start + quiet);
        var x1 = edge(c + quiet);
        ctx.fillRect(x + x0, y + y0, x1 - x0, y1 - y0);
      }
    }
  }

  function wrapChars(ctx, text, maxWidth) {
    var lines = [];
    var line = '';
    splitChars(text).forEach(function (ch) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function wrapWords(ctx, text, maxWidth) {
    var lines = [];
    var line = '';
    String(text).split(' ').forEach(function (word) {
      var candidate = line ? line + ' ' + word : word;
      if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; return; }
      if (line) lines.push(line);
      if (ctx.measureText(word).width <= maxWidth) { line = word; return; }
      var pieces = wrapChars(ctx, word, maxWidth);
      line = pieces.pop();
      lines = lines.concat(pieces);
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  var CARD_W = 1200;
  var CARD_PAD = 90;
  var CARD_QR = 740;
  var FONT_SANS = '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';
  var FONT_MONO = '"JetBrains Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, "Courier New", monospace';

  function drawWifiIcon(ctx, cx, cy) {
    ctx.strokeStyle = '#2563eb';
    ctx.fillStyle = '#2563eb';
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    [36, 74, 112].forEach(function (radius) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI * 1.25, Math.PI * 1.75);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Lay out the card as a list of draw operations, then size the canvas to fit.
  function drawCard(canvas, card) {
    var ctx = canvas.getContext('2d');
    var cw = CARD_W - CARD_PAD * 2;
    var ops = [];
    var y = CARD_PAD;

    var text = function (value, font, color, lineHeight, mode) {
      ctx.font = font;
      var lines = mode === 'chars' ? wrapChars(ctx, value, cw) : wrapWords(ctx, value, cw);
      lines.forEach(function (line) {
        ops.push({ type: 'text', text: line, font: font, color: color, y: y + lineHeight * 0.78 });
        y += lineHeight;
      });
    };

    // Icon + title + instruction
    ops.push({ type: 'icon', y: y + 128 });
    y += 180;
    text(card.title || 'Wi-Fi', '700 84px ' + FONT_SANS, '#0f172a', 100);
    y += 6;
    text('Scan with your phone camera to connect', '400 38px ' + FONT_SANS, '#475569', 50);

    // QR with a 4-module clear margin above and below (capped for small codes)
    var module = CARD_QR / card.matrix.count;
    var clear = Math.round(Math.min(Math.max(module * 4, 60), 110));
    y += clear;
    ops.push({ type: 'qr', x: Math.round((CARD_W - CARD_QR) / 2), y: Math.round(y) });
    y += CARD_QR + clear;

    ops.push({ type: 'rule', y: Math.round(y) });
    y += 50;

    // Details
    var label = function (value) {
      text(value, '600 30px ' + FONT_SANS, '#64748b', 42);
      y += 4;
    };

    label('NETWORK');
    text(card.ssid, '700 56px ' + FONT_SANS, '#0f172a', 68);

    if (card.security === 'nopass') {
      y += 28;
      label('PASSWORD');
      text('None needed', '600 48px ' + FONT_SANS, '#0f172a', 62);
    } else if (card.showPassword) {
      y += 28;
      label('PASSWORD');
      text(card.password, '600 52px ' + FONT_MONO, '#0f172a', 66, 'chars');
    }

    y += 28;
    var meta = 'Security: ' + SECURITY[card.security].card + (card.hidden ? ' · Hidden network' : '');
    text(meta, '400 32px ' + FONT_SANS, '#64748b', 44);

    if (card.note) {
      y += 30;
      text(card.note, 'italic 400 36px ' + FONT_SANS, '#475569', 48);
    }

    y += CARD_PAD;

    // Resizing resets the context, so paint after the layout pass
    canvas.width = CARD_W;
    canvas.height = Math.ceil(y);
    ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    roundRect(ctx, 6, 6, canvas.width - 12, canvas.height - 12, 48);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#cbd5e1';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ops.forEach(function (op) {
      if (op.type === 'text') {
        ctx.font = op.font;
        ctx.fillStyle = op.color;
        ctx.fillText(op.text, CARD_W / 2, op.y);
      } else if (op.type === 'icon') {
        drawWifiIcon(ctx, CARD_W / 2, op.y);
      } else if (op.type === 'qr') {
        drawQr(ctx, card.matrix, op.x, op.y, CARD_QR, 0);
      } else if (op.type === 'rule') {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(CARD_PAD, op.y, CARD_W - CARD_PAD * 2, 3);
      }
    });
  }

  // ── State & form ────────────────────────────────────────

  var state = { ready: false, data: null, payload: '', matrix: null };
  var updateTimer = null;

  function readForm() {
    return {
      ssid: $('wqr-ssid').value,
      security: normalizeSecurity($('wqr-security').value),
      password: $('wqr-password').value,
      hidden: $('wqr-hidden').checked,
      saeStyle: $('wqr-sae').checked,
      ecl: $('wqr-ecl').value,
      quiet: parseInt($('wqr-quiet').value, 10) || 0,
      pngSize: parseInt($('wqr-png-size').value, 10) || 1024,
      title: $('wqr-card-heading').value.trim(),
      note: $('wqr-card-note').value.trim(),
      showPassword: $('wqr-card-showpass').checked,
      copies: parseInt($('wqr-card-copies').value, 10) || 1
    };
  }

  function syncForm(data, msgs) {
    var isOpen = data.security === 'nopass';
    $('wqr-pass-field').classList.toggle('wqr-hidden', isOpen);
    $('wqr-sae-field').classList.toggle('wqr-hidden', data.security !== 'wpa3');
    $('wqr-security-hint').textContent = SECURITY[data.security].hint;

    var ssidBytes = utf8Length(data.ssid);
    var ssidCount = $('wqr-ssid-count');
    ssidCount.textContent = ssidBytes + ' / 32 bytes';
    ssidCount.classList.toggle('wqr-over', ssidBytes > 32);

    var passLen = splitChars(data.password).length;
    var passCount = $('wqr-pass-count');
    passCount.textContent = passLen + (passLen === 1 ? ' character' : ' characters');
    passCount.classList.toggle('wqr-over', msgs.some(function (m) {
      return m.field === 'password' && m.level === 'warn';
    }));
  }

  function renderMessages(msgs, data) {
    var list = $('wqr-messages');
    list.textContent = '';
    msgs.forEach(function (m) {
      // The empty-SSID state is already explained by the placeholder
      if (m.field === 'ssid' && m.level === 'error') return;
      // Don't nag about a missing password before a network name is entered
      if (m.field === 'password' && m.level === 'error' && !data.ssid) return;
      var li = document.createElement('li');
      li.className = 'wqr-msg' + (m.level === 'warn' ? ' wqr-msg--warn' : m.level === 'error' ? ' wqr-msg--error' : '');
      li.textContent = m.text;
      list.appendChild(li);
    });
  }

  function setReady(ready) {
    state.ready = ready;
    ['wqr-btn-png', 'wqr-btn-svg', 'wqr-btn-copy', 'wqr-btn-print', 'wqr-btn-card-png'].forEach(function (id) {
      $(id).disabled = !ready;
    });
    $('wqr-qr-canvas').classList.toggle('wqr-hidden', !ready);
    $('wqr-qr-placeholder').classList.toggle('wqr-hidden', ready);
    $('wqr-card-canvas').classList.toggle('wqr-hidden', !ready);
    $('wqr-card-placeholder').classList.toggle('wqr-hidden', ready);
  }

  function setStatus(text, ok) {
    var el = $('wqr-status');
    el.textContent = text;
    el.classList.toggle('wqr-status--ok', !!ok);
  }

  function showFailure(text) {
    setReady(false);
    setStatus('');
    var list = $('wqr-messages');
    var li = document.createElement('li');
    li.className = 'wqr-msg wqr-msg--error';
    li.textContent = text;
    list.appendChild(li);
  }

  function maskedPayload(data) {
    if (data.security === 'nopass' || !data.password || $('wqr-password').type !== 'password') {
      return buildPayload(data);
    }
    var copy = {};
    Object.keys(data).forEach(function (k) { copy[k] = data[k]; });
    copy.password = new Array(splitChars(data.password).length + 1).join('•');
    return buildPayload(copy);
  }

  function scheduleUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 120);
  }

  function update() {
    clearTimeout(updateTimer);
    var data = readForm();
    var msgs = validate(data);
    syncForm(data, msgs);
    renderMessages(msgs, data);

    if (hasErrors(msgs)) {
      state.data = null;
      state.matrix = null;
      state.payload = '';
      $('wqr-payload').value = '';
      $('wqr-qr-placeholder').textContent = data.ssid
        ? 'Enter the password to generate the QR code'
        : 'Enter a network name to generate the QR code';
      setStatus('');
      setReady(false);
      return;
    }

    var payload = buildPayload(data);
    ensureQrLib(function () { render(data, payload); });
  }

  function render(data, payload) {
    var matrix;
    try {
      matrix = makeMatrix(payload, data.ecl);
    } catch (err) {
      console.error(err);
      showFailure('The data does not fit in a QR code at this error-correction level. Try a lower level.');
      return;
    }

    state.data = data;
    state.payload = payload;
    state.matrix = matrix;

    // On-screen QR, drawn at device resolution
    var canvas = $('wqr-qr-canvas');
    var dpr = window.devicePixelRatio || 1;
    var px = Math.round(280 * Math.min(Math.max(dpr, 1), 3));
    canvas.width = px;
    canvas.height = px;
    drawQr(canvas.getContext('2d'), matrix, 0, 0, px, data.quiet);

    drawCard($('wqr-card-canvas'), {
      matrix: matrix,
      ssid: data.ssid,
      password: data.password,
      security: data.security,
      hidden: data.hidden,
      showPassword: data.showPassword,
      title: data.title,
      note: data.note
    });

    $('wqr-payload').value = maskedPayload(data);
    setStatus('Version ' + matrix.version + ' · ' + matrix.count + '×' + matrix.count +
      ' modules · ' + utf8Length(payload) + ' bytes · ECL ' + data.ecl, true);
    setReady(true);
  }

  // ── Toast & clipboard ───────────────────────────────────

  var toastTimer = null;

  function showToast(msg) {
    var toast = $('wqr-toast');
    toast.textContent = msg;
    toast.classList.add('wqr-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('wqr-show'); }, 2000);
  }

  function copyText(text, okMsg) {
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      showToast(ok ? okMsg : 'Copy failed — select the text and copy manually');
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () { showToast(okMsg); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function copyPayload() {
    if (!state.ready) return;
    copyText(state.payload, 'Wi-Fi payload copied');
  }

  // ── Downloads ───────────────────────────────────────────

  function baseName(prefix) {
    var slug = fileSlug(state.data ? state.data.ssid : '');
    return prefix + (slug ? '-' + slug : '');
  }

  function downloadHref(filename, href, revoke) {
    var a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revoke) setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
  }

  function downloadCanvas(canvas, filename) {
    if (canvas.toBlob) {
      canvas.toBlob(function (blob) {
        downloadHref(filename, URL.createObjectURL(blob), true);
      }, 'image/png');
    } else {
      downloadHref(filename, canvas.toDataURL('image/png'), false);
    }
  }

  function downloadPng() {
    if (!state.ready) return;
    var size = state.data.pngSize;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    drawQr(canvas.getContext('2d'), state.matrix, 0, 0, size, state.data.quiet);
    downloadCanvas(canvas, baseName('wifi-qr') + '.png');
    showToast('PNG downloaded (' + size + '×' + size + ')');
  }

  function downloadSvg() {
    if (!state.ready) return;
    var svg = buildSvg(state.matrix, state.data.quiet);
    var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    downloadHref(baseName('wifi-qr') + '.svg', URL.createObjectURL(blob), true);
    showToast('SVG downloaded');
  }

  function downloadCard() {
    if (!state.ready) return;
    downloadCanvas($('wqr-card-canvas'), baseName('wifi-card') + '.png');
    showToast('Card downloaded');
  }

  // ── Printing ────────────────────────────────────────────
  // The tool is embedded inline on WordPress pages, so page-wide print CSS is not an
  // option. The card canvas is copied into a separate document and printed from there.
  // Everything runs synchronously inside the click so browsers allow the print dialog.

  var printFrame = null;

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function writePrintDocument(win, source, layout) {
    var doc = win.document;
    var cards = '';
    for (var i = 0; i < layout.count; i++) cards += '<canvas class="wqr-print-card"></canvas>';
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Wi-Fi card</title><style>' +
      '@page { margin: 8mm; }' +
      'html, body { margin: 0; padding: 0; background: #fff; }' +
      '.wqr-print-sheet { display: grid; grid-template-columns: repeat(' + layout.cols + ', ' + layout.width + 'mm);' +
      ' gap: ' + layout.gap + 'mm; justify-content: center; }' +
      '.wqr-print-card { display: block; width: ' + layout.width + 'mm; height: auto;' +
      ' break-inside: avoid; page-break-inside: avoid; }' +
      '</style></head><body><div class="wqr-print-sheet">' + cards + '</div></body></html>');
    doc.close();
    var canvases = doc.getElementsByTagName('canvas');
    for (var j = 0; j < canvases.length; j++) {
      canvases[j].width = source.width;
      canvases[j].height = source.height;
      canvases[j].getContext('2d').drawImage(source, 0, 0);
    }
  }

  function printCard() {
    if (!state.ready) return;
    var source = $('wqr-card-canvas');
    var layout = printLayout(state.data.copies, source.height / source.width);

    // iOS Safari prints the parent page from an iframe, so use a new tab there
    if (isIOS()) {
      var popup = window.open('', '_blank');
      if (popup) {
        writePrintDocument(popup, source, layout);
        popup.focus();
        popup.print();
        return;
      }
    }

    if (!printFrame || !printFrame.parentNode) {
      printFrame = document.createElement('iframe');
      printFrame.setAttribute('aria-hidden', 'true');
      printFrame.setAttribute('tabindex', '-1');
      printFrame.setAttribute('title', 'Wi-Fi card print frame');
      printFrame.style.position = 'fixed';
      printFrame.style.right = '0';
      printFrame.style.bottom = '0';
      printFrame.style.width = '0';
      printFrame.style.height = '0';
      printFrame.style.border = '0';
      printFrame.style.visibility = 'hidden';
      document.body.appendChild(printFrame);
    }
    var win = printFrame.contentWindow;
    writePrintDocument(win, source, layout);
    win.focus();
    win.print();
  }

  // ── Password visibility ─────────────────────────────────

  function togglePassword() {
    var input = $('wqr-password');
    var btn = $('wqr-pass-toggle');
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    if (state.ready) $('wqr-payload').value = maskedPayload(state.data);
  }

  // ── Init ────────────────────────────────────────────────

  function init() {
    var wrapper = document.querySelector('.wqr-wrapper');
    if (!wrapper) return;

    wrapper.addEventListener('input', function (e) {
      if (e.target.id !== 'wqr-payload') scheduleUpdate();
    });
    wrapper.addEventListener('change', function (e) {
      if (e.target.id !== 'wqr-payload') update();
    });
    wrapper.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        update();
      }
    });

    update();
    // Warm up the library so the first QR appears without a delay
    ensureQrLib(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Expose global handlers for onclick attributes
  window.wqrTogglePassword = togglePassword;
  window.wqrDownloadPng    = downloadPng;
  window.wqrDownloadSvg    = downloadSvg;
  window.wqrCopyPayload    = copyPayload;
  window.wqrPrintCard      = printCard;
  window.wqrDownloadCard   = downloadCard;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      escapeValue: escapeValue,
      toUtf8ByteString: toUtf8ByteString,
      utf8Length: utf8Length,
      splitChars: splitChars,
      securityType: securityType,
      buildPayload: buildPayload,
      validate: validate,
      buildSvg: buildSvg,
      fileSlug: fileSlug,
      printLayout: printLayout
    };
  }

})();
