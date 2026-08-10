// Merge Text Tool — script.js
// No external dependencies. Two freely-editable <textarea> panes (real
// editing: Enter/Backspace, multi-line select, copy-paste all work
// natively) with a line-based LCS diff overlaid as synced-scroll line
// number gutters and a merge-arrow gutter that pushes a differing block
// from one side to the other. Entirely client-side.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var MAX_TOKENS = 20000;
  var MAX_PRODUCT = 9000000;
  var LINE_HEIGHT = 21; // px — must match --mtx-line-height in style.css

  // This file deliberately contains no backslash characters. It ships inside a
  // JSON attribute of the site's tool-embed block, and every backslash there
  // needs a second one to survive; a single dropped level silently turns an
  // escape like a newline literal into a real line break and breaks the script.
  // Building these few values from char codes keeps the embedded copy safe.
  var LF = String.fromCharCode(10);
  var CR = String.fromCharCode(13);
  var WS_RE = new RegExp('[' + String.fromCharCode(9, 10, 11, 12, 13, 32) + ']+', 'g');

  var SAMPLE_LEFT = [
    "version: '3.8'",
    'services:',
    '  web:',
    '    image: nginx:1.25',
    '    ports:',
    '      - "80:80"',
    '    restart: unless-stopped',
    '    environment:',
    '      - ENV=production'
  ].join(LF);

  var SAMPLE_RIGHT = [
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
  ].join(LF);

  var lastBlocks = null;
  var liveTimer = null;
  var syncing = false;

  // ── Pure helpers (also unit-tested) ──────────────────────

  function tokenizeLines(text) {
    return text.split(CR + LF).join(LF).split(CR).join(LF).split(LF);
  }

  function normalizeLine(line, ignoreWS, ignoreCase) {
    var t = line;
    if (ignoreWS) t = t.trim().replace(WS_RE, ' ');
    if (ignoreCase) t = t.toLowerCase();
    return t;
  }

  // Returns ops array [{type:'eq'|'add'|'del', a, b}] or null if too large.
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

  // Groups ops into alternating eq/diff blocks, tracking the 0-based line
  // index (in each side's own line array) where every block starts — the
  // splice points used by applyMerge, and the pixel anchor for the arrows.
  function buildBlocks(ops) {
    var blocks = [];
    var i = 0;
    var leftIdx = 0, rightIdx = 0;
    while (i < ops.length) {
      if (ops[i].type === 'eq') {
        var count = 0;
        var lStart = leftIdx, rStart = rightIdx;
        while (i < ops.length && ops[i].type === 'eq') {
          count++; leftIdx++; rightIdx++; i++;
        }
        blocks.push({ type: 'eq', count: count, leftStart: lStart, rightStart: rStart });
      } else {
        var leftLines = [], rightLines = [];
        var lStart2 = leftIdx, rStart2 = rightIdx;
        while (i < ops.length && ops[i].type !== 'eq') {
          if (ops[i].type === 'del') { leftLines.push(ops[i].a); leftIdx++; }
          else { rightLines.push(ops[i].b); rightIdx++; }
          i++;
        }
        blocks.push({
          type: 'diff',
          leftLines: leftLines,
          rightLines: rightLines,
          leftStart: lStart2,
          rightStart: rStart2
        });
      }
    }
    return blocks;
  }

  // Applies a diff block copy in the given direction and returns new full
  // line arrays. direction: 'l2r' makes the right side match the left
  // side's lines for this block; 'r2l' does the reverse.
  function applyMerge(leftFullLines, rightFullLines, block, direction) {
    var newLeft = leftFullLines.slice();
    var newRight = rightFullLines.slice();
    if (direction === 'l2r') {
      var argsR = [block.rightStart, block.rightLines.length].concat(block.leftLines);
      Array.prototype.splice.apply(newRight, argsR);
    } else if (direction === 'r2l') {
      var argsL = [block.leftStart, block.leftLines.length].concat(block.rightLines);
      Array.prototype.splice.apply(newLeft, argsL);
    }
    return { left: newLeft, right: newRight };
  }

  // ── Rendering helpers ─────────────────────────────────────

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
    var el = $('mtx-error-msg');
    el.textContent = msg;
    el.classList.add('mtx-visible');
  }

  function hideError() {
    $('mtx-error-msg').classList.remove('mtx-visible');
  }

  function showToast() {
    var toast = $('mtx-toast');
    toast.classList.add('mtx-show');
    setTimeout(function () { toast.classList.remove('mtx-show'); }, 2000);
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

  function lineCountLabel(n) {
    return n + (n === 1 ? ' line' : ' lines');
  }

  // ── Gutter rendering ──────────────────────────────────────

  // Builds the set of diff-marked line indices (0-based) for one side.
  function diffLineSet(blocks, side) {
    var set = {};
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      if (block.type !== 'diff') continue;
      var start = side === 'left' ? block.leftStart : block.rightStart;
      var count = side === 'left' ? block.leftLines.length : block.rightLines.length;
      for (var k = 0; k < count; k++) set[start + k] = true;
    }
    return set;
  }

  function renderGutter(containerId, lineCount, diffSet) {
    var html = '';
    for (var i = 0; i < lineCount; i++) {
      var cls = 'mtx-gutter-line' + (diffSet[i] ? ' mtx-gutter-line--diff' : '');
      html += '<div class="' + cls + '">' + (i + 1) + '</div>';
    }
    $(containerId).innerHTML = html;
  }

  function renderArrows(blocks) {
    var html = '';
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      if (block.type !== 'diff') continue;
      // Once an edit shifts one side but not the other (lines pasted into
      // only one pane), the same block sits at different row indices on
      // each side, so there is no single row the arrows can align to.
      // Anchor to the rows that actually hold content: a block that exists
      // on one side only (pure addition/deletion) follows that side alone —
      // giving it a phantom row on the empty side used to drag the arrows
      // far away from the lines they control. Blocks present on both sides
      // span the union of the two ranges.
      var leftCount = block.leftLines.length;
      var rightCount = block.rightLines.length;
      var leftTop = block.leftStart * LINE_HEIGHT;
      var leftBottom = leftTop + Math.max(leftCount, 1) * LINE_HEIGHT;
      var rightTop = block.rightStart * LINE_HEIGHT;
      var rightBottom = rightTop + Math.max(rightCount, 1) * LINE_HEIGHT;

      var top, height;
      if (leftCount === 0) {
        top = rightTop;
        height = rightBottom - rightTop;
      } else if (rightCount === 0) {
        top = leftTop;
        height = leftBottom - leftTop;
      } else {
        top = Math.min(leftTop, rightTop);
        height = Math.max(leftBottom, rightBottom) - top;
      }
      html += '<div class="mtx-arrow-group" style="top:' + top + 'px;height:' + height + 'px;">' +
        '<button type="button" class="mtx-gutter-btn" title="Use left version" onclick="mtxApplyMerge(' + b + ', &#39;l2r&#39;)">&#8594;</button>' +
        '<button type="button" class="mtx-gutter-btn" title="Use right version" onclick="mtxApplyMerge(' + b + ', &#39;r2l&#39;)">&#8592;</button>' +
        '</div>';
    }
    $('mtx-arrow-inner').innerHTML = html;
  }

  function applyGutterOffset(scrollTop) {
    var offset = -scrollTop;
    $('mtx-gutter-left-inner').style.transform = 'translateY(' + offset + 'px)';
    $('mtx-gutter-right-inner').style.transform = 'translateY(' + offset + 'px)';
    $('mtx-arrow-inner').style.transform = 'translateY(' + offset + 'px)';
  }

  // ── Compare orchestration ────────────────────────────────

  function compare() {
    hideError();
    var leftText = $('mtx-input-left').value;
    var rightText = $('mtx-input-right').value;
    var ignoreWS = $('mtx-opt-ignorews').checked;
    var ignoreCase = $('mtx-opt-ignorecase').checked;

    var aRaw = tokenizeLines(leftText);
    var bRaw = tokenizeLines(rightText);
    var aNorm = aRaw.map(function (t) { return normalizeLine(t, ignoreWS, ignoreCase); });
    var bNorm = bRaw.map(function (t) { return normalizeLine(t, ignoreWS, ignoreCase); });

    var ops = computeDiff(aRaw, bRaw, aNorm, bNorm);
    if (ops === null) {
      showError('Input is too large to compare in the browser. Try shortening the text.');
      lastBlocks = null;
      $('mtx-gutter-left-inner').innerHTML = '';
      $('mtx-gutter-right-inner').innerHTML = '';
      $('mtx-arrow-inner').innerHTML = '';
      $('mtx-stats').classList.remove('mtx-visible');
      return;
    }

    var blocks = buildBlocks(ops);
    lastBlocks = blocks;

    renderGutter('mtx-gutter-left-inner', aRaw.length, diffLineSet(blocks, 'left'));
    renderGutter('mtx-gutter-right-inner', bRaw.length, diffLineSet(blocks, 'right'));
    renderArrows(blocks);
    applyGutterOffset($('mtx-input-left').scrollTop);

    $('mtx-meta-left').textContent = lineCountLabel(aRaw.length);
    $('mtx-meta-right').textContent = lineCountLabel(bRaw.length);

    renderStats(ops, aRaw.length, bRaw.length, blocks);
  }

  function renderStats(ops, aLen, bLen, blocks) {
    var eq = 0;
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].type === 'eq') eq++;
    }
    var diffCount = blocks.filter(function (b) { return b.type === 'diff'; }).length;
    var similarity = (aLen + bLen) === 0 ? 100 : Math.round((2 * eq / (aLen + bLen)) * 1000) / 10;

    $('mtx-stat-diff').textContent = diffCount + (diffCount === 1 ? ' differing block' : ' differing blocks');
    $('mtx-stat-sim').textContent = similarity + '% similar';

    var statsEl = $('mtx-stats');
    statsEl.classList.add('mtx-visible');
    statsEl.classList.toggle('mtx-nodiff', diffCount === 0);
  }

  // ── Actions ──────────────────────────────────────────────

  function applyMergeAction(blockIndex, direction) {
    if (!lastBlocks) return;
    var block = lastBlocks[blockIndex];
    if (!block || block.type !== 'diff') return;

    var leftLines = tokenizeLines($('mtx-input-left').value);
    var rightLines = tokenizeLines($('mtx-input-right').value);
    var result = applyMerge(leftLines, rightLines, block, direction);

    $('mtx-input-left').value = result.left.join(LF);
    $('mtx-input-right').value = result.right.join(LF);
    compare();
  }

  function swap() {
    var l = $('mtx-input-left'), r = $('mtx-input-right');
    var tmp = l.value;
    l.value = r.value;
    r.value = tmp;
    compare();
  }

  function clearAll() {
    $('mtx-input-left').value = '';
    $('mtx-input-right').value = '';
    lastBlocks = null;
    compare();
    $('mtx-stats').classList.remove('mtx-visible');
    hideError();
  }

  function loadSample() {
    $('mtx-input-left').value = SAMPLE_LEFT;
    $('mtx-input-right').value = SAMPLE_RIGHT;
    compare();
  }

  function copySide(side) {
    var text = $(side === 'left' ? 'mtx-input-left' : 'mtx-input-right').value;
    if (!text) return;
    copyText(text);
  }

  function onInputChange() {
    if ($('mtx-opt-live').checked) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(compare, 300);
    }
  }

  function onScroll(e) {
    if (syncing) return;
    syncing = true;
    var scrollTop = e.target.scrollTop;
    var other = e.target.id === 'mtx-input-left' ? $('mtx-input-right') : $('mtx-input-left');
    other.scrollTop = scrollTop;
    applyGutterOffset(scrollTop);
    syncing = false;
  }

  window.mtxCompare = compare;
  window.mtxSwap = swap;
  window.mtxClear = clearAll;
  window.mtxLoadSample = loadSample;
  window.mtxCopySide = copySide;
  window.mtxOnOptionsChange = compare;
  window.mtxApplyMerge = applyMergeAction;

  // ── Init ─────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    $('mtx-input-left').addEventListener('input', onInputChange);
    $('mtx-input-right').addEventListener('input', onInputChange);
    $('mtx-input-left').addEventListener('scroll', onScroll);
    $('mtx-input-right').addEventListener('scroll', onScroll);
    compare();
  });

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      tokenizeLines: tokenizeLines,
      normalizeLine: normalizeLine,
      computeDiff: computeDiff,
      buildBlocks: buildBlocks,
      applyMerge: applyMerge,
      escapeHtml: escapeHtml
    };
  }

})();
