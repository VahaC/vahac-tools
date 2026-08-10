// Text Diff Tool — script.js
// No external dependencies. LCS-based diff computed entirely client-side.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var MAX_TOKENS = 20000;      // hard cap per side to avoid pathological allocations
  var MAX_PRODUCT = 9000000;   // cap on n*m for the DP table (~36MB worst case)
  var COLLAPSE_THRESHOLD = 8;  // collapse unchanged runs longer than this (line mode)
  var COLLAPSE_CONTEXT = 3;    // lines of context kept visible around a collapsed run

  var SAMPLE_ORIGINAL = [
    "version: '3.8'",
    'services:',
    '  web:',
    '    image: nginx:1.25',
    '    ports:',
    '      - "80:80"',
    '    restart: unless-stopped',
    '    environment:',
    '      - ENV=production'
  ].join('\n');

  var SAMPLE_CHANGED = [
    "version: '3.9'",
    'services:',
    '  web:',
    '    image: nginx:1.27',
    '    ports:',
    '      - "80:80"',
    '      - "443:443"',
    '    restart: always',
    '    environment:',
    '      - ENV=production',
    '      - LOG_LEVEL=info'
  ].join('\n');

  var lastOps = null;
  var lastMode = 'line';
  var expandedGroups = {};
  var liveTimer = null;

  // ── Helpers ──────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      return '&#39;';
    });
  }

  function showError(msg) {
    var el = $('tdf-error-msg');
    el.textContent = msg;
    el.classList.add('tdf-visible');
  }

  function hideError() {
    $('tdf-error-msg').classList.remove('tdf-visible');
  }

  function showToast() {
    var toast = $('tdf-toast');
    toast.classList.add('tdf-show');
    setTimeout(function () { toast.classList.remove('tdf-show'); }, 2000);
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* no-op */ }
      document.body.removeChild(ta);
      showToast();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showToast).catch(fallback);
    } else {
      fallback();
    }
  }

  function updateMeta() {
    setMeta('tdf-meta-original', $('tdf-input-original').value);
    setMeta('tdf-meta-changed', $('tdf-input-changed').value);
  }

  function setMeta(id, text) {
    var lines = text === '' ? 0 : text.split(/\r\n|\r|\n/).length;
    $(id).textContent = lines + ' lines · ' + text.length + ' chars';
  }

  // ── Tokenizing & normalizing ────────────────────────────

  function tokenize(text, mode) {
    if (mode === 'line') return text.split(/\r\n|\r|\n/);
    if (mode === 'word') return text.match(/\S+|\s+/g) || [];
    return Array.from(text);
  }

  function normalizeToken(tok, mode, ignoreWS, ignoreCase) {
    var t = tok;
    if (mode === 'line' && ignoreWS) t = t.trim().replace(/\s+/g, ' ');
    if (mode !== 'line' && ignoreWS && /^\s+$/.test(t)) t = ' ';
    if (ignoreCase) t = t.toLowerCase();
    return t;
  }

  // ── Core LCS diff ────────────────────────────────────────
  // Returns an ops array [{type:'eq'|'add'|'del', a, b}] or null if the
  // input is too large to diff safely in the browser.

  function computeDiff(aRaw, bRaw, aNorm, bNorm) {
    var n = aRaw.length, m = bRaw.length;
    if (n > MAX_TOKENS || m > MAX_TOKENS || n * m > MAX_PRODUCT) return null;

    var dp = new Array(n + 1);
    for (var i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);

    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = (aNorm[i] === bNorm[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    var ops = [];
    i = 0;
    var j = 0;
    while (i < n && j < m) {
      if (aNorm[i] === bNorm[j]) {
        ops.push({ type: 'eq', a: aRaw[i], b: bRaw[j] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: 'del', a: aRaw[i] });
        i++;
      } else {
        ops.push({ type: 'add', b: bRaw[j] });
        j++;
      }
    }
    while (i < n) { ops.push({ type: 'del', a: aRaw[i] }); i++; }
    while (j < m) { ops.push({ type: 'add', b: bRaw[j] }); j++; }
    return ops;
  }

  // ── Compare orchestration ────────────────────────────────

  function compare() {
    hideError();
    var origText = $('tdf-input-original').value;
    var changedText = $('tdf-input-changed').value;
    var mode = $('tdf-mode-select').value;
    var ignoreWS = $('tdf-opt-ignorews').checked;
    var ignoreCase = $('tdf-opt-ignorecase').checked;

    var aRaw = tokenize(origText, mode);
    var bRaw = tokenize(changedText, mode);
    var aNorm = aRaw.map(function (t) { return normalizeToken(t, mode, ignoreWS, ignoreCase); });
    var bNorm = bRaw.map(function (t) { return normalizeToken(t, mode, ignoreWS, ignoreCase); });

    var ops = computeDiff(aRaw, bRaw, aNorm, bNorm);
    if (ops === null) {
      showError('Input is too large for ' + mode + '-level comparison in the browser. Try Line mode or shorten the text.');
      $('tdf-diff-output').innerHTML = '';
      $('tdf-diff-output').classList.remove('tdf-visible');
      $('tdf-stats').classList.remove('tdf-visible');
      $('tdf-empty-state').classList.add('tdf-visible');
      return;
    }

    lastOps = ops;
    lastMode = mode;
    expandedGroups = {};
    $('tdf-empty-state').classList.remove('tdf-visible');
    renderDiff();
    renderStats(ops, aRaw.length, bRaw.length);
  }

  // ── Rendering: line mode ─────────────────────────────────

  function buildLineRows(ops) {
    var oldNum = 1, newNum = 1;
    var rows = [];
    for (var k = 0; k < ops.length; k++) {
      var op = ops[k];
      if (op.type === 'eq') {
        rows.push({ type: 'eq', oldNum: oldNum, newNum: newNum, text: op.a });
        oldNum++; newNum++;
      } else if (op.type === 'del') {
        rows.push({ type: 'del', oldNum: oldNum, newNum: null, text: op.a });
        oldNum++;
      } else {
        rows.push({ type: 'add', oldNum: null, newNum: newNum, text: op.b });
        newNum++;
      }
    }
    return rows;
  }

  function renderRow(row) {
    var marker = row.type === 'add' ? '+' : (row.type === 'del' ? '-' : '');
    var text = row.text === '' ? '&nbsp;' : escapeHtml(row.text);
    return '<div class="tdf-line tdf-line--' + row.type + '">' +
      '<span class="tdf-line-num tdf-line-num--old">' + (row.oldNum !== null ? row.oldNum : '') + '</span>' +
      '<span class="tdf-line-num tdf-line-num--new">' + (row.newNum !== null ? row.newNum : '') + '</span>' +
      '<span class="tdf-line-marker">' + marker + '</span>' +
      '<span class="tdf-line-text">' + text + '</span>' +
      '</div>';
  }

  function renderLineDiff(ops) {
    var rows = buildLineRows(ops);
    var html = '';
    var i = 0, groupId = 0;
    while (i < rows.length) {
      if (rows[i].type === 'eq') {
        var start = i;
        while (i < rows.length && rows[i].type === 'eq') i++;
        var run = rows.slice(start, i);
        if (run.length > COLLAPSE_THRESHOLD) {
          if (expandedGroups[groupId]) {
            html += run.map(renderRow).join('');
            html += '<div class="tdf-collapse-row" onclick="tdfToggleGroup(' + groupId + ')">' +
              '<span class="tdf-collapse-icon">&#9650;</span> Collapse unchanged lines</div>';
          } else {
            var hidden = run.length - COLLAPSE_CONTEXT * 2;
            html += run.slice(0, COLLAPSE_CONTEXT).map(renderRow).join('');
            html += '<div class="tdf-collapse-row" onclick="tdfToggleGroup(' + groupId + ')">' +
              '<span class="tdf-collapse-icon">&#8942;</span> ' + hidden + ' unchanged lines — click to expand</div>';
            html += run.slice(run.length - COLLAPSE_CONTEXT).map(renderRow).join('');
          }
        } else {
          html += run.map(renderRow).join('');
        }
        groupId++;
      } else {
        html += renderRow(rows[i]);
        i++;
      }
    }
    return '<div class="tdf-line-diff">' + html + '</div>';
  }

  window.tdfToggleGroup = function (id) {
    expandedGroups[id] = !expandedGroups[id];
    renderDiff();
  };

  // ── Rendering: word / char mode ─────────────────────────

  function renderInlineDiff(ops) {
    var html = '';
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.type === 'eq') html += escapeHtml(op.a);
      else if (op.type === 'del') html += '<span class="tdf-tok tdf-tok--del">' + escapeHtml(op.a) + '</span>';
      else html += '<span class="tdf-tok tdf-tok--add">' + escapeHtml(op.b) + '</span>';
    }
    return '<div class="tdf-inline-diff">' + html + '</div>';
  }

  function renderDiff() {
    var container = $('tdf-diff-output');
    if (!lastOps) { container.innerHTML = ''; container.classList.remove('tdf-visible'); return; }
    container.innerHTML = (lastMode === 'line') ? renderLineDiff(lastOps) : renderInlineDiff(lastOps);
    container.classList.add('tdf-visible');
  }

  // ── Stats ────────────────────────────────────────────────

  function renderStats(ops, aLen, bLen) {
    var add = 0, del = 0, eq = 0;
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].type === 'add') add++;
      else if (ops[i].type === 'del') del++;
      else eq++;
    }
    var unit = lastMode === 'line' ? (add === 1 ? 'line' : 'lines') : (lastMode === 'word' ? 'words' : 'chars');
    var similarity = (aLen + bLen) === 0 ? 100 : Math.round((2 * eq / (aLen + bLen)) * 1000) / 10;

    $('tdf-stat-add').textContent = '+' + add + ' ' + unit;
    $('tdf-stat-del').textContent = '-' + del + ' ' + unit;
    $('tdf-stat-sim').textContent = similarity + '% similar';

    var statsEl = $('tdf-stats');
    statsEl.classList.add('tdf-visible');
    statsEl.classList.toggle('tdf-nodiff', add === 0 && del === 0);
  }

  // ── Actions ──────────────────────────────────────────────

  function copyDiff() {
    if (!lastOps) return;
    var text;
    if (lastMode === 'line') {
      text = lastOps.map(function (op) {
        if (op.type === 'eq') return '  ' + op.a;
        if (op.type === 'del') return '- ' + op.a;
        return '+ ' + op.b;
      }).join('\n');
    } else {
      text = lastOps.map(function (op) {
        if (op.type === 'eq') return op.a;
        if (op.type === 'del') return '[-' + op.a + '-]';
        return '{+' + op.b + '+}';
      }).join('');
    }
    copyText(text);
  }

  function swap() {
    var o = $('tdf-input-original'), c = $('tdf-input-changed');
    var tmp = o.value;
    o.value = c.value;
    c.value = tmp;
    updateMeta();
    compare();
  }

  function clearAll() {
    $('tdf-input-original').value = '';
    $('tdf-input-changed').value = '';
    updateMeta();
    lastOps = null;
    $('tdf-diff-output').innerHTML = '';
    $('tdf-diff-output').classList.remove('tdf-visible');
    $('tdf-stats').classList.remove('tdf-visible');
    $('tdf-empty-state').classList.add('tdf-visible');
    hideError();
  }

  function loadSample() {
    $('tdf-input-original').value = SAMPLE_ORIGINAL;
    $('tdf-input-changed').value = SAMPLE_CHANGED;
    updateMeta();
    compare();
  }

  function onOptionsChange() {
    if (lastOps !== null || $('tdf-input-original').value || $('tdf-input-changed').value) {
      compare();
    }
  }

  function onInputChange() {
    updateMeta();
    if ($('tdf-opt-live').checked) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(compare, 350);
    }
  }

  window.tdfCompare = compare;
  window.tdfSwap = swap;
  window.tdfClear = clearAll;
  window.tdfLoadSample = loadSample;
  window.tdfCopyDiff = copyDiff;
  window.tdfOnOptionsChange = onOptionsChange;

  // ── Init ─────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    $('tdf-input-original').addEventListener('input', onInputChange);
    $('tdf-input-changed').addEventListener('input', onInputChange);
    updateMeta();
  });

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      tokenize: tokenize,
      normalizeToken: normalizeToken,
      computeDiff: computeDiff,
      escapeHtml: escapeHtml
    };
  }

})();
