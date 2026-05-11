// chmod Permission Calculator — script.js
// Namespace prefix: chm-
// Dependencies: none (vanilla JS)
// Author: VahaC (vahac.com)

(function () {
  'use strict';

  /* -------------------------------------------------------
     Helpers
  ------------------------------------------------------- */
  var $ = function (id) { return document.getElementById(id); };

  function showToast(msg) {
    var t = $('chm-toast');
    t.textContent = msg || '✅ Copied!';
    t.classList.add('chm-show');
    setTimeout(function () { t.classList.remove('chm-show'); }, 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast('✅ Copied!');
      }).catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      showToast('✅ Copied!');
    }
  }

  /* -------------------------------------------------------
     Preset descriptions (shown in description card)
  ------------------------------------------------------- */
  var PRESET_HINTS = {
    '000': 'No permissions for anyone.',
    '400': 'Owner can read only. Common for sensitive config files.',
    '444': 'Everyone can read, no one can write or execute.',
    '600': 'Owner can read and write. Required for SSH private keys (~/.ssh/id_rsa).',
    '644': 'Owner can read and write; everyone else can read. Typical for web files (HTML, CSS, images).',
    '664': 'Owner and group can read/write; others can read. Good for shared team files.',
    '700': 'Owner can do everything; group and others have no access. Good for private scripts and home dirs.',
    '750': 'Owner: full. Group: read + execute. Others: nothing. Good for server executables.',
    '755': 'Owner: full. Group and others: read + execute. Standard for scripts, binaries, and directories.',
    '775': 'Owner and group: full. Others: read + execute. Common in group development environments.',
    '777': '⚠️ Everyone has full permissions. Never use in production — serious security risk.',
    '4755': 'Setuid bit: the binary runs as the owner regardless of who launches it (e.g. sudo, ping).',
    '2755': 'Setgid bit: the binary runs with the group\'s privileges.',
    '1777': 'Sticky bit: users can only delete their own files. Standard for /tmp.'
  };

  /* -------------------------------------------------------
     State read / write
  ------------------------------------------------------- */
  function getState() {
    return {
      owner_r: $('chm-owner-r').checked,
      owner_w: $('chm-owner-w').checked,
      owner_x: $('chm-owner-x').checked,
      group_r: $('chm-group-r').checked,
      group_w: $('chm-group-w').checked,
      group_x: $('chm-group-x').checked,
      other_r: $('chm-other-r').checked,
      other_w: $('chm-other-w').checked,
      other_x: $('chm-other-x').checked,
      setuid:  $('chm-setuid').checked,
      setgid:  $('chm-setgid').checked,
      sticky:  $('chm-sticky').checked
    };
  }

  function setState(s) {
    $('chm-owner-r').checked = !!s.owner_r;
    $('chm-owner-w').checked = !!s.owner_w;
    $('chm-owner-x').checked = !!s.owner_x;
    $('chm-group-r').checked = !!s.group_r;
    $('chm-group-w').checked = !!s.group_w;
    $('chm-group-x').checked = !!s.group_x;
    $('chm-other-r').checked = !!s.other_r;
    $('chm-other-w').checked = !!s.other_w;
    $('chm-other-x').checked = !!s.other_x;
    $('chm-setuid').checked  = !!s.setuid;
    $('chm-setgid').checked  = !!s.setgid;
    $('chm-sticky').checked  = !!s.sticky;
  }

  /* -------------------------------------------------------
     Conversion: state ↔ numeric / symbolic
  ------------------------------------------------------- */
  function triplet(r, w, x) {
    return (r ? 4 : 0) + (w ? 2 : 0) + (x ? 1 : 0);
  }

  function stateToNumeric(s) {
    var special = (s.setuid ? 4 : 0) + (s.setgid ? 2 : 0) + (s.sticky ? 1 : 0);
    var o = triplet(s.owner_r, s.owner_w, s.owner_x);
    var g = triplet(s.group_r, s.group_w, s.group_x);
    var t = triplet(s.other_r, s.other_w, s.other_x);
    return (special > 0 ? '' + special : '') + o + g + t;
  }

  function stateToSymbolic(s) {
    return [
      s.owner_r ? 'r' : '-',
      s.owner_w ? 'w' : '-',
      s.owner_x ? (s.setuid ? 's' : 'x') : (s.setuid ? 'S' : '-'),
      s.group_r ? 'r' : '-',
      s.group_w ? 'w' : '-',
      s.group_x ? (s.setgid ? 's' : 'x') : (s.setgid ? 'S' : '-'),
      s.other_r ? 'r' : '-',
      s.other_w ? 'w' : '-',
      s.other_x ? (s.sticky ? 't' : 'x') : (s.sticky ? 'T' : '-')
    ].join('');
  }

  function numericToState(val) {
    val = val.replace(/\s/g, '');
    if (!/^[0-7]{3,4}$/.test(val)) return null;
    var special = 0, owner, group, other;
    if (val.length === 4) {
      special = parseInt(val[0], 8);
      owner   = parseInt(val[1], 8);
      group   = parseInt(val[2], 8);
      other   = parseInt(val[3], 8);
    } else {
      owner = parseInt(val[0], 8);
      group = parseInt(val[1], 8);
      other = parseInt(val[2], 8);
    }
    return {
      owner_r: !!(owner & 4),
      owner_w: !!(owner & 2),
      owner_x: !!(owner & 1),
      group_r: !!(group & 4),
      group_w: !!(group & 2),
      group_x: !!(group & 1),
      other_r: !!(other & 4),
      other_w: !!(other & 2),
      other_x: !!(other & 1),
      setuid:  !!(special & 4),
      setgid:  !!(special & 2),
      sticky:  !!(special & 1)
    };
  }

  function symbolicToState(val) {
    val = val.trim();
    // Strip leading file-type character if present (e.g. -rwxr-xr-x)
    if (val.length === 10) val = val.slice(1);
    if (val.length !== 9) return null;
    // Validate character set per position
    var valid = [
      'r-', 'w-', 'xsS-',
      'r-', 'w-', 'xsS-',
      'r-', 'w-', 'xtT-'
    ];
    for (var i = 0; i < 9; i++) {
      if (valid[i].indexOf(val[i]) === -1) return null;
    }
    return {
      owner_r: val[0] === 'r',
      owner_w: val[1] === 'w',
      owner_x: val[2] === 'x' || val[2] === 's',
      group_r: val[3] === 'r',
      group_w: val[4] === 'w',
      group_x: val[5] === 'x' || val[5] === 's',
      other_r: val[6] === 'r',
      other_w: val[7] === 'w',
      other_x: val[8] === 'x' || val[8] === 't',
      setuid:  val[2] === 's' || val[2] === 'S',
      setgid:  val[5] === 's' || val[5] === 'S',
      sticky:  val[8] === 't' || val[8] === 'T'
    };
  }

  /* -------------------------------------------------------
     Human-readable description
  ------------------------------------------------------- */
  function permSpan(r, w, x) {
    var parts = [];
    if (r) parts.push('<span class="chm-perm-read">read</span>');
    if (w) parts.push('<span class="chm-perm-write">write</span>');
    if (x) parts.push('<span class="chm-perm-exec">execute</span>');
    if (parts.length === 0) return '<span class="chm-perm-none">no permissions</span>';
    return parts.join(', ');
  }

  function buildDescription(s, numeric) {
    var lines = [];

    lines.push(
      '<span class="chm-desc-entity">👤 Owner (u):</span> ' +
      permSpan(s.owner_r, s.owner_w, s.owner_x) +
      ' <span class="chm-desc-digit">(' + triplet(s.owner_r, s.owner_w, s.owner_x) + ')</span>'
    );
    lines.push(
      '<span class="chm-desc-entity">👥 Group (g):</span> ' +
      permSpan(s.group_r, s.group_w, s.group_x) +
      ' <span class="chm-desc-digit">(' + triplet(s.group_r, s.group_w, s.group_x) + ')</span>'
    );
    lines.push(
      '<span class="chm-desc-entity">🌍 Other (o):</span> ' +
      permSpan(s.other_r, s.other_w, s.other_x) +
      ' <span class="chm-desc-digit">(' + triplet(s.other_r, s.other_w, s.other_x) + ')</span>'
    );

    if (s.setuid || s.setgid || s.sticky) {
      var specials = [];
      if (s.setuid) specials.push('<span class="chm-perm-special">setuid</span>');
      if (s.setgid) specials.push('<span class="chm-perm-special">setgid</span>');
      if (s.sticky) specials.push('<span class="chm-perm-special">sticky bit</span>');
      lines.push(
        '<span class="chm-desc-entity">⚡ Special:</span> ' + specials.join(', ')
      );
    }

    var hint = PRESET_HINTS[numeric];
    if (hint) {
      lines.push('<span class="chm-desc-use">💡 ' + hint + '</span>');
    }

    return lines.join('<br>');
  }

  /* -------------------------------------------------------
     Active preset highlighting
  ------------------------------------------------------- */
  function updateActivePreset(numeric) {
    var btns = document.querySelectorAll('.chm-preset-btn');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-preset') === numeric) {
        btns[i].classList.add('chm-preset-active');
      } else {
        btns[i].classList.remove('chm-preset-active');
      }
    }
  }

  /* -------------------------------------------------------
     Main UI update
  ------------------------------------------------------- */
  function updateUI(skipNumeric, skipSymbolic) {
    var s = getState();
    var numeric  = stateToNumeric(s);
    var symbolic = stateToSymbolic(s);

    if (!skipNumeric)  $('chm-numeric').value  = numeric;
    if (!skipSymbolic) $('chm-symbolic').value = symbolic;

    // Digit badges
    $('chm-val-owner').textContent   = triplet(s.owner_r, s.owner_w, s.owner_x);
    $('chm-val-group').textContent   = triplet(s.group_r, s.group_w, s.group_x);
    $('chm-val-other').textContent   = triplet(s.other_r, s.other_w, s.other_x);
    $('chm-val-special').textContent = (s.setuid ? 4 : 0) + (s.setgid ? 2 : 0) + (s.sticky ? 1 : 0);

    // Command preview
    $('chm-cmd-preview').textContent = 'chmod ' + numeric + ' <filename>';

    // Description
    $('chm-desc-text').innerHTML = buildDescription(s, numeric);

    // Preset highlight
    updateActivePreset(numeric);

    // URL hash (for sharing / bookmarking)
    if (history.replaceState) {
      history.replaceState(null, '', '#' + numeric);
    }
  }

  /* -------------------------------------------------------
     Public handlers (called via onchange / oninput)
  ------------------------------------------------------- */
  window.chmFromCheckboxes = function () {
    updateUI(false, false);
  };

  window.chmFromNumeric = function () {
    var val = $('chm-numeric').value;
    var s = numericToState(val);
    if (s) {
      setState(s);
      updateUI(true, false);   // keep numeric as typed, refresh symbolic
    } else {
      // Invalid: just clear preset highlight
      updateActivePreset('__invalid__');
    }
  };

  window.chmFromSymbolic = function () {
    var val = $('chm-symbolic').value;
    var s = symbolicToState(val);
    if (s) {
      setState(s);
      updateUI(false, true);   // refresh numeric, keep symbolic as typed
    } else {
      updateActivePreset('__invalid__');
    }
  };

  window.chmSetPreset = function (val) {
    var s = numericToState(val);
    if (s) {
      setState(s);
      updateUI(false, false);
    }
  };

  /* -------------------------------------------------------
     Copy actions
  ------------------------------------------------------- */
  window.chmCopyNumeric = function () {
    copyText($('chm-numeric').value);
  };

  window.chmCopySymbolic = function () {
    copyText($('chm-symbolic').value);
  };

  window.chmCopyCmd = function () {
    var numeric = $('chm-numeric').value;
    copyText('chmod ' + numeric + ' <filename>');
  };

  /* -------------------------------------------------------
     Keyboard shortcuts (Enter on inputs)
  ------------------------------------------------------- */
  function bindKeys() {
    $('chm-numeric').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') window.chmFromNumeric();
    });
    $('chm-symbolic').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') window.chmFromSymbolic();
    });
  }

  /* -------------------------------------------------------
     Init: load from URL hash or default to 755
  ------------------------------------------------------- */
  function init() {
    bindKeys();

    var hash = location.hash.replace('#', '').replace(/\s/g, '');
    if (hash && /^[0-7]{3,4}$/.test(hash)) {
      var s = numericToState(hash);
      if (s) {
        setState(s);
        updateUI(false, false);
        return;
      }
    }

    // Default: 755
    window.chmSetPreset('755');
  }

  init();

})();
