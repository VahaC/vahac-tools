// Dependencies: none — pure vanilla JS, zero external libraries
// Namespace prefix: jsf-

(function () {
  'use strict';

  // ── Shorthand helper ───────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };

  // ── Module state ───────────────────────────────────────────────────────────
  var currentParsed    = null;   // last successfully parsed JS value
  var currentFormatted = '';     // pretty-printed string
  var currentMinified  = '';     // minified string
  var currentView      = 'code'; // 'code' | 'tree'
  var validateTimer    = null;   // debounce handle for live validation

  // ==========================================================================
  //  JSON PARSING & STATS
  // ==========================================================================

  function parseJSON(input) {
    try {
      var data      = JSON.parse(input);
      var formatted = JSON.stringify(data, null, 2);
      var minified  = JSON.stringify(data);
      var stats     = computeStats(data);
      return { ok: true, data: data, formatted: formatted, minified: minified, stats: stats };
    } catch (e) {
      var info = extractErrorInfo(e.message, input);
      return { ok: false, error: e.message, line: info.line, col: info.col };
    }
  }

  // Extract line/column from browser error messages (varies by engine)
  function extractErrorInfo(msg, input) {
    var line = null, col = null;

    // Chrome/V8 ≥ 66: "... at position N"
    var posMatch = msg.match(/position\s+(\d+)/i);
    if (posMatch) {
      var pos    = parseInt(posMatch[1], 10);
      var before = input.substring(0, pos);
      var lines  = before.split('\n');
      line = lines.length;
      col  = lines[lines.length - 1].length + 1;
    }

    // Firefox / SpiderMonkey: "line N column N"
    var lineMatch = msg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (lineMatch) {
      line = parseInt(lineMatch[1], 10);
      col  = parseInt(lineMatch[2], 10);
    }

    return { line: line, col: col };
  }

  function computeStats(data) {
    var s = { keys: 0, depth: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0 };

    function walk(node, d) {
      if (d > s.depth) s.depth = d;
      if (node === null)             { s.nulls++;    return; }
      if (typeof node === 'string')  { s.strings++;  return; }
      if (typeof node === 'number')  { s.numbers++;  return; }
      if (typeof node === 'boolean') { s.booleans++; return; }
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) walk(node[i], d + 1);
      } else if (typeof node === 'object') {
        var ks = Object.keys(node);
        s.keys += ks.length;
        for (var k = 0; k < ks.length; k++) walk(node[ks[k]], d + 1);
      }
    }

    walk(data, 0);
    return s;
  }

  // ==========================================================================
  //  SYNTAX HIGHLIGHTING
  // ==========================================================================

  function syntaxHighlight(json) {
    // Escape HTML entities first to prevent XSS in the highlighted output
    json = json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Regex matches: keys, strings, numbers, true/false/null
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function (match) {
        var cls = 'jsf-hl-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'jsf-hl-key' : 'jsf-hl-string';
        } else if (/true|false/.test(match)) {
          cls = 'jsf-hl-boolean';
        } else if (/null/.test(match)) {
          cls = 'jsf-hl-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
  }

  // ==========================================================================
  //  TREE VIEW
  // ==========================================================================

  function getType(val) {
    if (val === null)        return 'null';
    if (Array.isArray(val)) return 'array';
    return typeof val;  // string | number | boolean | object
  }

  function fmtPrimitive(val) {
    if (val === null)            return 'null';
    if (typeof val === 'string') return '"' + val + '"';
    return String(val);
  }

  // Entry point: builds the full tree inside `container`
  function renderTree(data, container) {
    container.innerHTML = '';

    // Root label banner
    var rootLabel = document.createElement('div');
    rootLabel.className = 'jsf-tree-root-label';
    var isArr = Array.isArray(data);
    var isObj = !isArr && data !== null && typeof data === 'object';
    if (isArr)       rootLabel.textContent = 'Array — ' + data.length + ' items';
    else if (isObj)  rootLabel.textContent = 'Object — ' + Object.keys(data).length + ' keys';
    else             rootLabel.textContent = getType(data);
    container.appendChild(rootLabel);

    if (isArr || isObj) {
      buildChildren(data, container, 0);
    } else {
      // Edge case: root is a bare primitive (e.g. JSON is just `42`)
      var wrap = document.createElement('div');
      wrap.className = 'jsf-tree-node';
      var span = document.createElement('span');
      span.className = 'jsf-tree-value jsf-tree-value--' + getType(data);
      span.textContent = fmtPrimitive(data);
      wrap.appendChild(span);
      container.appendChild(wrap);
    }
  }

  // Iterate object keys or array indices and create child nodes
  function buildChildren(data, container, depth) {
    if (Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        buildNode(String(i), data[i], container, depth, true);
      }
    } else {
      var keys = Object.keys(data);
      for (var k = 0; k < keys.length; k++) {
        buildNode(keys[k], data[keys[k]], container, depth, false);
      }
    }
  }

  // Build a single tree node (row + optional children container)
  function buildNode(key, value, container, depth, isIdx) {
    var isNull    = value === null;
    var isArr     = !isNull && Array.isArray(value);
    var isObj     = !isNull && !isArr && typeof value === 'object';
    var isComplex = isArr || isObj;
    var childCnt  = isComplex ? (isArr ? value.length : Object.keys(value).length) : 0;
    var hasKids   = isComplex && childCnt > 0;

    // preview is declared here so the click-handler closure can reference it
    var preview = null;

    var node = document.createElement('div');
    node.className = 'jsf-tree-node';

    // ── Row ────────────────────────────────────────────────────────────────
    var row = document.createElement('div');
    row.className = 'jsf-tree-row';
    if (hasKids) row.style.cursor = 'pointer';

    // Toggle arrow (▶) — invisible spacer when no children
    var toggle = document.createElement('span');
    toggle.className = 'jsf-tree-toggle' + (hasKids ? ' jsf-tree-toggle--has' : '');
    if (hasKids) toggle.innerHTML = '&#9654;';
    row.appendChild(toggle);

    // Key / index label
    var keyEl = document.createElement('span');
    keyEl.className = 'jsf-tree-key' + (isIdx ? ' jsf-tree-key--idx' : '');
    keyEl.textContent = isIdx ? ('[' + key + ']') : key;
    row.appendChild(keyEl);

    // Colon separator
    var colon = document.createElement('span');
    colon.className = 'jsf-tree-colon';
    colon.textContent = ':';
    row.appendChild(colon);

    if (isComplex) {
      // Open bracket {  or [
      var openBkt = document.createElement('span');
      openBkt.className = 'jsf-tree-bracket';
      openBkt.textContent = isArr ? ' [' : ' {';
      row.appendChild(openBkt);

      if (!hasKids) {
        // Empty: {} or []
        var emptyClose = document.createElement('span');
        emptyClose.className = 'jsf-tree-bracket';
        emptyClose.textContent = isArr ? ']' : '}';
        row.appendChild(emptyClose);
      } else {
        // Preview shown when node is collapsed
        preview = document.createElement('span');
        preview.className = 'jsf-tree-preview';
        preview.textContent = isArr
          ? childCnt + ' items' + ' ]'
          : childCnt + ' keys' + ' }';
        row.appendChild(preview);
      }
    } else {
      // Primitive value with type-coloured span
      var valEl = document.createElement('span');
      valEl.className = 'jsf-tree-value jsf-tree-value--' + getType(value);
      valEl.textContent = fmtPrimitive(value);
      row.appendChild(valEl);
    }

    node.appendChild(row);

    // ── Children container (objects / arrays with children) ────────────────
    if (hasKids) {
      var kids = document.createElement('div');
      kids.className = 'jsf-tree-children';

      buildChildren(value, kids, depth + 1);

      // Closing bracket at the end of children
      var closeBkt = document.createElement('div');
      closeBkt.className = 'jsf-tree-close';
      closeBkt.textContent = isArr ? ']' : '}';
      kids.appendChild(closeBkt);

      // Collapse nodes at depth >= 2 by default to keep large JSON manageable
      if (depth >= 2) {
        kids.style.display = 'none';
        // preview stays visible (default display)
      } else {
        toggle.classList.add('jsf-tree-toggle--open');
        if (preview) preview.style.display = 'none';
      }

      node.appendChild(kids);

      // Click: toggle expand / collapse
      row.addEventListener('click', function () {
        var isOpen = kids.style.display !== 'none';
        kids.style.display = isOpen ? 'none' : 'block';
        toggle.classList.toggle('jsf-tree-toggle--open', !isOpen);
        if (preview) preview.style.display = isOpen ? '' : 'none';
      });
    }

    container.appendChild(node);
  }

  // ── Expand / Collapse All ──────────────────────────────────────────────────

  function expandAll() {
    var c = $('jsf-output-tree');
    c.querySelectorAll('.jsf-tree-children').forEach(function (el) {
      el.style.display = 'block';
    });
    c.querySelectorAll('.jsf-tree-toggle--has').forEach(function (el) {
      el.classList.add('jsf-tree-toggle--open');
    });
    c.querySelectorAll('.jsf-tree-preview').forEach(function (el) {
      el.style.display = 'none';
    });
  }

  function collapseAll() {
    var c = $('jsf-output-tree');
    c.querySelectorAll('.jsf-tree-children').forEach(function (el) {
      el.style.display = 'none';
    });
    c.querySelectorAll('.jsf-tree-toggle--has').forEach(function (el) {
      el.classList.remove('jsf-tree-toggle--open');
    });
    c.querySelectorAll('.jsf-tree-preview').forEach(function (el) {
      el.style.display = '';
    });
  }

  // ==========================================================================
  //  TREE SEARCH
  // ==========================================================================

  // Highlight matching rows, dim non-matching, expand ancestors of matches
  function doSearch(query) {
    var c       = $('jsf-output-tree');
    var allRows = c.querySelectorAll('.jsf-tree-row');

    // Reset state on every call
    allRows.forEach(function (r) {
      r.classList.remove('jsf-tree-match', 'jsf-tree-dim');
    });

    if (!query) {
      // Rebuild tree to restore default collapse state
      if (currentParsed !== null) renderTree(currentParsed, c);
      return 0;
    }

    var q         = query.toLowerCase();
    var matchRows = [];

    allRows.forEach(function (r) {
      var keyEl = r.querySelector('.jsf-tree-key');
      var valEl = r.querySelector('.jsf-tree-value');
      var kt    = keyEl ? keyEl.textContent.toLowerCase() : '';
      var vt    = valEl ? valEl.textContent.toLowerCase() : '';

      if (kt.includes(q) || vt.includes(q)) {
        r.classList.add('jsf-tree-match');
        matchRows.push(r);
      } else {
        r.classList.add('jsf-tree-dim');
      }
    });

    // Expand ancestors so matching nodes are visible
    matchRows.forEach(function (r) { expandAncestors(r); });

    return matchRows.length;
  }

  // Walk up the DOM, expanding jsf-tree-children containers and un-dimming
  // the parent rows so the path to each match is always visible
  function expandAncestors(el) {
    var cur = el.parentElement;
    while (cur && cur.id !== 'jsf-output-tree') {
      if (cur.classList && cur.classList.contains('jsf-tree-children')) {
        cur.style.display = 'block';

        // Find the sibling row (direct child of the parent node div)
        var parentNode = cur.parentElement;
        if (parentNode && parentNode.classList.contains('jsf-tree-node')) {
          var childNodes = parentNode.childNodes;
          for (var i = 0; i < childNodes.length; i++) {
            var child = childNodes[i];
            if (child.nodeType === 1 && child.classList.contains('jsf-tree-row')) {
              child.classList.remove('jsf-tree-dim');
              var t  = child.querySelector('.jsf-tree-toggle');
              var pv = child.querySelector('.jsf-tree-preview');
              if (t)  t.classList.add('jsf-tree-toggle--open');
              if (pv) pv.style.display = 'none';
              break;
            }
          }
        }
      }
      cur = cur.parentElement;
    }
  }

  // ==========================================================================
  //  UI STATE HELPERS
  // ==========================================================================

  // Switch between Code and Tree views
  function setView(view) {
    currentView = view;
    $('jsf-output-code').style.display  = view === 'code' ? 'block' : 'none';
    $('jsf-output-tree').style.display  = view === 'tree' ? 'block' : 'none';
    $('jsf-tree-controls').style.display= view === 'tree' ? 'flex'  : 'none';
    $('jsf-tab-code').classList.toggle('jsf-tab--active', view === 'code');
    $('jsf-tab-tree').classList.toggle('jsf-tab--active', view === 'tree');
  }

  // Live-validation indicator (coloured dot + label)
  function setIndicator(state) {
    var dot   = $('jsf-valid-dot');
    var label = $('jsf-valid-label');
    dot.className = 'jsf-valid-dot';
    if (state === true) {
      dot.classList.add('jsf-valid-dot--ok');
      label.textContent = 'Valid JSON';
      label.style.color = 'var(--jsf-accent-green)';
    } else if (state === false) {
      dot.classList.add('jsf-valid-dot--error');
      label.textContent = 'Invalid JSON';
      label.style.color = 'var(--jsf-accent-red)';
    } else {
      dot.classList.add('jsf-valid-dot--neutral');
      label.textContent = 'Waiting\u2026';
      label.style.color = 'var(--jsf-text-muted)';
    }
  }

  function updateStats(stats, byteLen) {
    $('jsf-stat-keys').textContent    = stats.keys.toLocaleString();
    $('jsf-stat-depth').textContent   = stats.depth;
    $('jsf-stat-size').textContent    = fmtBytes(byteLen);
    $('jsf-stat-strings').textContent = stats.strings.toLocaleString();
    $('jsf-stat-numbers').textContent = stats.numbers.toLocaleString();
  }

  function fmtBytes(n) {
    if (n < 1024)       return n + '\u00a0B';
    if (n < 1048576)    return (n / 1024).toFixed(1) + '\u00a0KB';
    return (n / 1048576).toFixed(2) + '\u00a0MB';
  }

  // ==========================================================================
  //  TOAST & ERROR DISPLAY
  // ==========================================================================

  function showToast(msg) {
    var t = $('jsf-toast');
    t.textContent = msg || 'Copied!';
    t.classList.add('jsf-show');
    setTimeout(function () { t.classList.remove('jsf-show'); }, 2200);
  }

  function showError(msg) {
    var el = $('jsf-error-msg');
    el.textContent = '\u26a0  ' + msg;
    el.classList.add('jsf-visible');
  }

  function hideError() {
    $('jsf-error-msg').classList.remove('jsf-visible');
  }

  // ==========================================================================
  //  CLIPBOARD
  // ==========================================================================

  function copyText(text, msg) {
    function fallback() {
      var ta        = document.createElement('textarea');
      ta.value      = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(msg);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { showToast(msg); })
        .catch(fallback);
    } else {
      fallback();
    }
  }

  // ==========================================================================
  //  PUBLIC ACTIONS  (exposed to window for onclick handlers)
  // ==========================================================================

  function jsfFormat() {
    var raw = $('jsf-input').value.trim();
    if (!raw) { showError('Please paste some JSON first.'); return; }

    var res = parseJSON(raw);

    if (res.ok) {
      hideError();
      currentParsed    = res.data;
      currentFormatted = res.formatted;
      currentMinified  = res.minified;

      // Render code view
      $('jsf-output-code').innerHTML = syntaxHighlight(res.formatted);

      // Render tree view (resets search state)
      $('jsf-tree-search').value         = '';
      $('jsf-search-count').style.display = 'none';
      renderTree(res.data, $('jsf-output-tree'));

      updateStats(res.stats, res.formatted.length);
      setIndicator(true);

      // Show output panel and switch to code view
      $('jsf-output-section').style.display = 'block';
      setView('code');
    } else {
      var errMsg = res.error;
      if (res.line) errMsg += '\n\u2192 Line ' + res.line + ', Column ' + res.col;
      showError(errMsg);
      setIndicator(false);
    }
  }

  function jsfMinify() {
    var raw = $('jsf-input').value.trim();
    if (!raw) return;

    var res = parseJSON(raw);
    if (res.ok) {
      $('jsf-input').value            = res.minified;
      $('jsf-char-count').textContent = res.minified.length.toLocaleString() + ' chars';
      hideError();
      setIndicator(true);
    } else {
      showError(res.error);
      setIndicator(false);
    }
  }

  function jsfLoadSample() {
    var sample = {
      name:    'VahaC Homelab',
      version: '2.0',
      active:  true,
      nodes: [
        { id: 'proxmox-01', role: 'hypervisor',  services: ['Proxmox VE', 'LXC', 'ZFS'],         storage_tb: 16    },
        { id: 'ha-01',      role: 'smart-home',  services: ['Home Assistant', 'Zigbee2MQTT'],     storage_tb: 0.256 },
        { id: 'nas-01',     role: 'storage',     services: ['OpenMediaVault', 'OneDrive sync'],   storage_tb: 4     }
      ],
      network: {
        vpn:        'WireGuard',
        proxy:      'Nginx Proxy Manager',
        dns:        'AdGuard Home',
        firewall:   'CrowdSec',
        monitoring: null
      },
      tags:    ['homelab', 'self-hosted', 'open-source', 'proxmox']
    };
    $('jsf-input').value = JSON.stringify(sample, null, 2);
    jsfValidateLive();
  }

  function jsfClearAll() {
    $('jsf-input').value               = '';
    $('jsf-output-section').style.display = 'none';
    $('jsf-char-count').textContent    = '0 chars';
    currentParsed    = null;
    currentFormatted = '';
    currentMinified  = '';
    hideError();
    setIndicator(null);
  }

  function jsfCopyFormatted() {
    if (!currentFormatted) { showToast('Format your JSON first!'); return; }
    copyText(currentFormatted, 'Formatted JSON copied!');
  }

  function jsfCopyMinified() {
    if (!currentMinified) { showToast('Format your JSON first!'); return; }
    copyText(currentMinified, 'Minified JSON copied!');
  }

  function jsfDownloadJSON() {
    if (!currentFormatted) { showToast('Format your JSON first!'); return; }
    var blob = new Blob([currentFormatted], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'formatted.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Downloaded!');
  }

  // Debounced live validation while the user is typing
  function jsfValidateLive() {
    var val = $('jsf-input').value;
    $('jsf-char-count').textContent = val.length.toLocaleString() + ' chars';
    clearTimeout(validateTimer);
    if (!val.trim()) { setIndicator(null); return; }
    validateTimer = setTimeout(function () {
      try   { JSON.parse(val); setIndicator(true);  }
      catch (e)              { setIndicator(false); }
    }, 400);
  }

  function jsfTreeSearch() {
    var q   = $('jsf-tree-search').value.trim();
    var cnt = doSearch(q);
    var el  = $('jsf-search-count');
    if (q) {
      el.textContent   = cnt + ' match' + (cnt !== 1 ? 'es' : '');
      el.style.display = 'inline';
    } else {
      el.style.display = 'none';
    }
  }

  // Thin wrappers so HTML onclick attributes stay clean
  function jsfExpandAll()      { expandAll();   }
  function jsfCollapseAll()    { collapseAll(); }
  function jsfSetView(v)       { setView(v);    }

  // Toggle fullscreen mode for the output panel
  function jsfToggleFullscreen() {
    var panel  = $('jsf-output-section');
    var btn    = $('jsf-expand-btn');
    var isOpen = panel.classList.contains('jsf-panel--fullscreen');

    if (isOpen) {
      // Exit fullscreen
      panel.classList.remove('jsf-panel--fullscreen');
      document.body.classList.remove('jsf-body-noscroll');
      btn.textContent = '\u26f6';           // ⛶  expand icon
      btn.title       = 'Expand to fullscreen (Esc to exit)';
    } else {
      // Enter fullscreen
      panel.classList.add('jsf-panel--fullscreen');
      document.body.classList.add('jsf-body-noscroll');
      btn.textContent = '\u2715';           // ✕  close icon
      btn.title       = 'Exit fullscreen (Esc)';
      // Scroll to top of the panel so the toolbar is visible
      panel.scrollTop = 0;
    }
  }

  // ==========================================================================
  //  KEYBOARD SHORTCUTS
  // ==========================================================================

  document.addEventListener('keydown', function (e) {
    // Ctrl+Enter (or Cmd+Enter on Mac) → Format & Validate
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      jsfFormat();
    }
    // Escape → exit fullscreen if active
    if (e.key === 'Escape') {
      var panel = $('jsf-output-section');
      if (panel && panel.classList.contains('jsf-panel--fullscreen')) {
        jsfToggleFullscreen();
      }
    }
  });

  // ==========================================================================
  //  INITIALISE
  // ==========================================================================

  (function init() {
    $('jsf-output-section').style.display = 'none';
    $('jsf-tree-controls').style.display  = 'none';
    $('jsf-output-code').style.display    = 'block';
    $('jsf-output-tree').style.display    = 'none';
    setIndicator(null);
  }());

  // ==========================================================================
  //  EXPOSE TO GLOBAL SCOPE  (required for onclick= attributes in HTML)
  // ==========================================================================

  window.jsfFormat        = jsfFormat;
  window.jsfMinify        = jsfMinify;
  window.jsfLoadSample    = jsfLoadSample;
  window.jsfClearAll      = jsfClearAll;
  window.jsfCopyFormatted = jsfCopyFormatted;
  window.jsfCopyMinified  = jsfCopyMinified;
  window.jsfDownloadJSON  = jsfDownloadJSON;
  window.jsfValidateLive  = jsfValidateLive;
  window.jsfTreeSearch    = jsfTreeSearch;
  window.jsfExpandAll     = jsfExpandAll;
  window.jsfCollapseAll   = jsfCollapseAll;
  window.jsfSetView       = jsfSetView;
  window.jsfToggleFullscreen = jsfToggleFullscreen;

}());
