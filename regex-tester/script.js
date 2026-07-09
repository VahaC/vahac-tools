(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function showError(msg) {
    var el = $('rgx-error-msg');
    el.textContent = msg;
    el.classList.add('rgx-visible');
  }

  function hideError() {
    $('rgx-error-msg').classList.remove('rgx-visible');
  }

  function showToast() {
    var toast = $('rgx-toast');
    toast.classList.add('rgx-show');
    setTimeout(function () { toast.classList.remove('rgx-show'); }, 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showToast).catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast();
    }
  }

  function setStatus(state, text) {
    var dot = $('rgx-valid-dot');
    dot.className = 'rgx-valid-dot rgx-valid-dot--' + state;
    $('rgx-status-text').textContent = text;
  }

  function toggleFlag(checkbox) {
    var flagsInput = $('rgx-flags');
    var flags = flagsInput.value.split('').filter(function (f) { return f !== checkbox.getAttribute('data-flag'); });
    if (checkbox.checked) flags.push(checkbox.getAttribute('data-flag'));
    flagsInput.value = flags.join('');
    run();
  }

  function syncFlagChips() {
    var flags = $('rgx-flags').value;
    var chips = document.querySelectorAll('#rgx-flags-toggles input[data-flag]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].checked = flags.indexOf(chips[i].getAttribute('data-flag')) !== -1;
    }
  }

  function buildRegex(patternStr, flagsStr) {
    var cleanFlags = flagsStr.replace(/[^gimsuy]/g, '');
    if (cleanFlags.indexOf('g') === -1) cleanFlags += 'g'; // internal always-global for match scanning
    return new RegExp(patternStr, cleanFlags);
  }

  function findMatches(patternStr, flagsStr, testStr) {
    var regex = buildRegex(patternStr, flagsStr);
    var matches = [];
    var m;
    var guard = 0;
    while ((m = regex.exec(testStr)) !== null && guard < 5000) {
      matches.push(m);
      if (m.index === regex.lastIndex) regex.lastIndex++;
      guard++;
    }
    return matches;
  }

  function buildHighlightHtml(testStr, matches) {
    var html = '';
    var cursor = 0;
    for (var i = 0; i < matches.length; i++) {
      var mm = matches[i];
      html += escapeHtml(testStr.slice(cursor, mm.index));
      var cls = (i % 2 === 0) ? 'rgx-mark' : 'rgx-mark rgx-mark--alt';
      html += '<mark class="' + cls + '" title="Match ' + (i + 1) + '">' + escapeHtml(mm[0]) + '</mark>';
      cursor = mm.index + mm[0].length;
    }
    html += escapeHtml(testStr.slice(cursor));
    return html;
  }

  function run() {
    var patternStr = $('rgx-pattern').value;
    var flagsStr = $('rgx-flags').value;
    var testStr = $('rgx-test-string').value;
    var replaceStr = $('rgx-replace-input').value;

    syncFlagChips();
    hideError();

    var outputEl = $('rgx-highlight-output');
    var matchListEl = $('rgx-match-list');
    var countEl = $('rgx-match-count');
    var replaceOutputEl = $('rgx-replace-output');

    if (!patternStr) {
      setStatus('neutral', 'Waiting for a pattern…');
      outputEl.innerHTML = '<span class="rgx-placeholder">Matches will be highlighted here…</span>';
      matchListEl.innerHTML = '<p class="rgx-empty-note">No matches yet.</p>';
      countEl.textContent = '0 matches';
      replaceOutputEl.value = '';
      return;
    }

    var regex;
    try {
      regex = buildRegex(patternStr, flagsStr);
    } catch (e) {
      setStatus('invalid', 'Invalid pattern');
      showError(e.message);
      outputEl.innerHTML = '<span class="rgx-placeholder">Fix the pattern to see matches…</span>';
      matchListEl.innerHTML = '<p class="rgx-empty-note">No matches yet.</p>';
      countEl.textContent = '0 matches';
      replaceOutputEl.value = '';
      return;
    }

    setStatus('valid', 'Pattern is valid');

    if (!testStr) {
      outputEl.innerHTML = '<span class="rgx-placeholder">Paste text above to test the pattern…</span>';
      matchListEl.innerHTML = '<p class="rgx-empty-note">No matches yet.</p>';
      countEl.textContent = '0 matches';
      replaceOutputEl.value = '';
      return;
    }

    var matches = findMatches(patternStr, flagsStr, testStr);

    // Build highlighted HTML
    var html = buildHighlightHtml(testStr, matches);
    outputEl.innerHTML = html || '<span class="rgx-placeholder">No matches found.</span>';

    countEl.textContent = matches.length + (matches.length === 1 ? ' match' : ' matches');

    // Build match detail list
    if (matches.length === 0) {
      matchListEl.innerHTML = '<p class="rgx-empty-note">No matches found.</p>';
    } else {
      var listHtml = '';
      for (var j = 0; j < matches.length; j++) {
        var match = matches[j];
        listHtml += '<div class="rgx-match-card">';
        listHtml += '<div class="rgx-match-card-head"><span>Match ' + (j + 1) + '</span><span>index ' + match.index + '</span></div>';
        listHtml += '<div class="rgx-match-card-value">' + escapeHtml(match[0]) + '</div>';
        if (match.length > 1) {
          var groupsHtml = '<div class="rgx-match-groups">';
          for (var g = 1; g < match.length; g++) {
            groupsHtml += '<span>Group ' + g + ': ' + (match[g] !== undefined ? escapeHtml(match[g]) : '<em>undefined</em>') + '</span>';
          }
          if (match.groups) {
            for (var name in match.groups) {
              if (Object.prototype.hasOwnProperty.call(match.groups, name)) {
                groupsHtml += '<span>Group &lt;' + escapeHtml(name) + '&gt;: ' + escapeHtml(String(match.groups[name])) + '</span>';
              }
            }
          }
          groupsHtml += '</div>';
          listHtml += groupsHtml;
        }
        listHtml += '</div>';
      }
      matchListEl.innerHTML = listHtml;
    }

    // Replace preview
    if (replaceStr !== '') {
      try {
        var replaceRegex = buildRegex(patternStr, flagsStr);
        replaceOutputEl.value = testStr.replace(replaceRegex, replaceStr);
      } catch (e) {
        replaceOutputEl.value = '';
      }
    } else {
      replaceOutputEl.value = testStr;
    }
  }

  function loadSample() {
    $('rgx-pattern').value = '\\b[\\w.-]+@[\\w.-]+\\.\\w+\\b';
    $('rgx-flags').value = 'g';
    $('rgx-test-string').value = 'Contact us at support@vahac.com or sales@example.org for more info.\nInvalid: not-an-email';
    run();
  }

  function clearAll() {
    $('rgx-pattern').value = '';
    $('rgx-flags').value = 'g';
    $('rgx-test-string').value = '';
    $('rgx-replace-input').value = '';
    run();
  }

  function usePattern(pattern) {
    $('rgx-pattern').value = pattern;
    run();
    $('rgx-pattern').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function toggleCheatsheet() {
    var panel = $('rgx-cheatsheet');
    var chevron = $('rgx-chevron');
    panel.classList.toggle('rgx-open');
    chevron.classList.toggle('rgx-rotated');
  }

  function copyMatches() {
    var cards = document.querySelectorAll('#rgx-match-list .rgx-match-card-value');
    var lines = [];
    for (var i = 0; i < cards.length; i++) lines.push(cards[i].textContent);
    if (lines.length === 0) return;
    copyText(lines.join('\n'));
  }

  function copyReplaced() {
    var val = $('rgx-replace-output').value;
    if (!val) return;
    copyText(val);
  }

  // Expose to global scope for onclick handlers
  window.rgxRun = run;
  window.rgxToggleFlag = toggleFlag;
  window.rgxLoadSample = loadSample;
  window.rgxClearAll = clearAll;
  window.rgxUsePattern = usePattern;
  window.rgxToggleCheatsheet = toggleCheatsheet;
  window.rgxCopyMatches = copyMatches;
  window.rgxCopyReplaced = copyReplaced;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      escapeHtml: escapeHtml,
      buildRegex: buildRegex,
      findMatches: findMatches,
      buildHighlightHtml: buildHighlightHtml
    };
  }
})();
