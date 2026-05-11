(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────────

  var MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MON_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var DOW_LONG  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  var EXAMPLES = [
    { expr: '* * * * *',     label: 'Every minute' },
    { expr: '*/5 * * * *',   label: 'Every 5 minutes' },
    { expr: '0 * * * *',     label: 'Every hour (on :00)' },
    { expr: '0 0 * * *',     label: 'Daily at midnight' },
    { expr: '0 9 * * 1-5',   label: 'Weekdays at 9:00' },
    { expr: '0 0 * * 0',     label: 'Every Sunday midnight' },
    { expr: '0 0 1 * *',     label: '1st of every month' },
    { expr: '0 0 1 1 *',     label: 'New Year midnight' },
    { expr: '30 6 * * 1-5',  label: 'Weekdays 6:30 AM' },
    { expr: '0 2 * * 0',     label: 'Sunday 2 AM backup' },
  ];

  // Field definitions: name, allowed range, optional named values
  var FIELD_CFG = {
    min:  { name: 'Minute',       min: 0,  max: 59, names: null,      nameOffset: 0 },
    hour: { name: 'Hour',         min: 0,  max: 23, names: null,      nameOffset: 0 },
    dom:  { name: 'Day of Month', min: 1,  max: 31, names: null,      nameOffset: 0 },
    mon:  { name: 'Month',        min: 1,  max: 12, names: MON_SHORT, nameOffset: 1 },
    dow:  { name: 'Day of Week',  min: 0,  max: 6,  names: DOW_SHORT, nameOffset: 0 }
  };

  var FIELD_ORDER = ['min', 'hour', 'dom', 'mon', 'dow'];

  // ─── Build-mode state (one entry per field) ───────────────────────────────────

  var buildState = {};
  FIELD_ORDER.forEach(function (f) {
    var cfg = FIELD_CFG[f];
    buildState[f] = {
      type:      'every',   // 'every' | 'step' | 'pick' | 'range'
      step:      1,
      stepFrom:  cfg.min,
      picks:     [],
      rangeFrom: cfg.min,
      rangeTo:   cfg.max
    };
  });

  // ─── DOM helper ───────────────────────────────────────────────────────────────

  var $ = function (id) { return document.getElementById(id); };

  // ─── Core parser ──────────────────────────────────────────────────────────────

  function allValues(cfg) {
    var a = [];
    for (var i = cfg.min; i <= cfg.max; i++) a.push(i);
    return a;
  }

  // Parse a single cron field string; returns sorted array of matching integers
  function parseField(str, cfg) {
    str = str.trim();

    // Substitute named values (month/dow) with their numeric equivalents
    if (cfg.names) {
      for (var ni = 0; ni < cfg.names.length; ni++) {
        var re = new RegExp('\\b' + cfg.names[ni] + '\\b', 'gi');
        str = str.replace(re, String(cfg.min + ni));
      }
    }

    if (str === '*') return allValues(cfg);

    // Comma-separated list: recurse on each token
    if (str.indexOf(',') !== -1) {
      var seen = {};
      var merged = [];
      str.split(',').forEach(function (part) {
        parseField(part.trim(), cfg).forEach(function (v) {
          if (!seen[v]) { seen[v] = true; merged.push(v); }
        });
      });
      return merged.sort(function (a, b) { return a - b; });
    }

    // Step: */N  or  M/N  or  M-N/S
    if (str.indexOf('/') !== -1) {
      var slashIdx = str.lastIndexOf('/');
      var stepStr  = str.slice(slashIdx + 1);
      var fromStr  = str.slice(0, slashIdx);
      var step     = parseInt(stepStr, 10);
      if (isNaN(step) || step < 1) throw new Error('Invalid step value "' + stepStr + '"');

      var start = cfg.min, end = cfg.max;
      if (fromStr !== '*') {
        if (fromStr.indexOf('-') !== -1) {
          var rp = fromStr.split('-');
          start = parseInt(rp[0], 10);
          end   = parseInt(rp[1], 10);
        } else {
          start = parseInt(fromStr, 10);
          end   = cfg.max;
        }
        if (isNaN(start) || isNaN(end) || start < cfg.min || end > cfg.max || start > end) {
          throw new Error('Step range "' + fromStr + '" out of bounds (' + cfg.min + '–' + cfg.max + ')');
        }
      }

      var stepResult = [];
      for (var sv = start; sv <= end; sv += step) stepResult.push(sv);
      return stepResult;
    }

    // Range: M-N
    if (str.indexOf('-') !== -1) {
      var dp   = str.split('-');
      var from = parseInt(dp[0], 10);
      var to   = parseInt(dp[1], 10);
      if (isNaN(from) || isNaN(to)) throw new Error('Invalid range "' + str + '"');
      if (from > to)                throw new Error('Range start must be ≤ end in "' + str + '"');
      if (from < cfg.min || to > cfg.max) {
        throw new Error('Range ' + from + '–' + to + ' out of bounds (' + cfg.min + '–' + cfg.max + ')');
      }
      var rangeResult = [];
      for (var rv = from; rv <= to; rv++) rangeResult.push(rv);
      return rangeResult;
    }

    // Single numeric value
    var num = parseInt(str, 10);
    if (isNaN(num)) throw new Error('Cannot parse "' + str + '"');
    if (num < cfg.min || num > cfg.max) {
      throw new Error('Value ' + num + ' is out of range (' + cfg.min + '–' + cfg.max + ')');
    }
    return [num];
  }

  // Parse a full 5-field cron expression; returns object with raw strings + value arrays
  function parseCron(expr) {
    expr = expr.trim().replace(/\s+/g, ' ');
    if (!expr) throw new Error('Empty expression');
    var parts = expr.split(' ');
    if (parts.length !== 5) {
      throw new Error('Expected 5 fields separated by spaces, got ' + parts.length);
    }
    return {
      raw:  { min: parts[0], hour: parts[1], dom: parts[2], mon: parts[3], dow: parts[4] },
      min:  parseField(parts[0], FIELD_CFG.min),
      hour: parseField(parts[1], FIELD_CFG.hour),
      dom:  parseField(parts[2], FIELD_CFG.dom),
      mon:  parseField(parts[3], FIELD_CFG.mon),
      dow:  parseField(parts[4], FIELD_CFG.dow)
    };
  }

  // ─── Human-readable description ───────────────────────────────────────────────

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function ordinal(n) {
    var mod100 = n % 100;
    var mod10  = n % 10;
    if (mod100 >= 11 && mod100 <= 13) return n + 'th';
    if (mod10 === 1) return n + 'st';
    if (mod10 === 2) return n + 'nd';
    if (mod10 === 3) return n + 'rd';
    return n + 'th';
  }

  // Returns true if arr contains consecutive integers
  function isConsecutive(arr) {
    for (var i = 1; i < arr.length; i++) {
      if (arr[i] !== arr[i - 1] + 1) return false;
    }
    return true;
  }

  // Format array of values as a natural list ("1, 2, and 3")
  // names: optional label array; offset: index into names array (names[v - offset])
  function fmtList(arr, names, offset) {
    var off = offset || 0;
    var strs = arr.map(function (v) {
      return names ? (names[v - off] || String(v)) : String(v);
    });
    if (strs.length === 1) return strs[0];
    if (strs.length === 2) return strs[0] + ' and ' + strs[1];
    return strs.slice(0, -1).join(', ') + ', and ' + strs[strs.length - 1];
  }

  // Describe the minute field in a natural phrase
  function describeMin(raw, parsed) {
    if (raw === '*') return 'every minute';
    if (/^\*\/\d+$/.test(raw)) {
      var step = parseInt(raw.split('/')[1], 10);
      return step === 1 ? 'every minute' : 'every ' + ordinal(step) + ' minute';
    }
    if (parsed.length === 1) return 'at minute ' + parsed[0];
    if (isConsecutive(parsed) && parsed.length > 1) {
      return 'every minute from ' + parsed[0] + ' through ' + parsed[parsed.length - 1];
    }
    return 'at minute ' + fmtList(parsed, null, 0);
  }

  // Describe the hour field as a "past" clause
  function describeHour(raw, parsed) {
    if (raw === '*') return 'past every hour';
    if (/^\*\/\d+$/.test(raw)) {
      var step = parseInt(raw.split('/')[1], 10);
      return step === 1 ? 'past every hour' : 'past every ' + ordinal(step) + ' hour';
    }
    if (parsed.length === 1) return 'past hour ' + parsed[0];
    if (isConsecutive(parsed) && parsed.length > 1) {
      return 'past every hour from ' + parsed[0] + ' through ' + parsed[parsed.length - 1];
    }
    return 'past hour ' + fmtList(parsed, null, 0);
  }

  // Describe the DOM field
  function describeDom(raw, parsed) {
    if (raw === '*') return '';
    if (parsed.length === 1) return 'on day-of-month ' + parsed[0];
    if (isConsecutive(parsed) && parsed.length > 1) {
      return 'on every day-of-month from ' + parsed[0] + ' through ' + parsed[parsed.length - 1];
    }
    return 'on day-of-month ' + fmtList(parsed, null, 0);
  }

  // Describe the DOW field
  function describeDow(raw, parsed) {
    if (raw === '*') return '';
    if (parsed.length === 1) return 'on ' + DOW_LONG[parsed[0]];
    if (isConsecutive(parsed) && parsed.length > 1) {
      return 'on every day from ' + DOW_LONG[parsed[0]] + ' through ' + DOW_LONG[parsed[parsed.length - 1]];
    }
    return 'on ' + fmtList(parsed, DOW_SHORT, 0);
  }

  // Describe the month field
  function describeMon(raw, parsed) {
    if (raw === '*') return '';
    if (parsed.length === 1) return 'in ' + MON_LONG[parsed[0] - 1];
    if (isConsecutive(parsed) && parsed.length > 1) {
      return 'from ' + MON_LONG[parsed[0] - 1] + ' through ' + MON_LONG[parsed[parsed.length - 1] - 1];
    }
    return 'in ' + fmtList(parsed, MON_SHORT, 1);
  }

  // Assemble the full human-readable sentence
  function cronToHuman(parsed) {
    var r = parsed.raw;

    // ── Time clause ──────────────────────────────────────────────────────────────
    var timeStr;
    var minRaw  = r.min;
    var hourRaw = r.hour;
    var isSingleMin  = /^\d+$/.test(minRaw);
    var isSingleHour = /^\d+$/.test(hourRaw);

    if (isSingleMin && isSingleHour) {
      // Exact wall-clock time: "At HH:MM"
      timeStr = 'At ' + pad2(parsed.hour[0]) + ':' + pad2(parsed.min[0]);
    } else if (minRaw === '0' && hourRaw === '*') {
      timeStr = 'At the start of every hour';
    } else if (minRaw === '*' && hourRaw === '*') {
      timeStr = 'At every minute';
    } else {
      // General case: combine minute + hour descriptions
      timeStr = 'At ' + describeMin(minRaw, parsed.min);
      if (hourRaw !== '*') {
        timeStr += ' ' + describeHour(hourRaw, parsed.hour);
      }
    }

    // ── Day clause (Vixie OR semantics when both DOM and DOW are restricted) ─────
    var domRaw = r.dom;
    var dowRaw = r.dow;
    var dayStr = '';

    if (domRaw !== '*' && dowRaw !== '*') {
      // Both restricted → OR logic (standard Vixie cron behaviour)
      var domPart = describeDom(domRaw, parsed.dom);
      var dowPart = describeDow(dowRaw, parsed.dow);
      dayStr = domPart + ' or ' + dowPart;
    } else {
      dayStr = describeDom(domRaw, parsed.dom) || describeDow(dowRaw, parsed.dow);
    }

    // ── Month clause ─────────────────────────────────────────────────────────────
    var monStr = describeMon(r.mon, parsed.mon);

    // ── Assemble ─────────────────────────────────────────────────────────────────
    var parts = [timeStr];
    if (dayStr) parts.push(dayStr);
    if (monStr) parts.push(monStr);
    return parts.join(', ');
  }

  // ─── Next N scheduled dates ───────────────────────────────────────────────────

  // Given a sorted array and a current value, return the next larger value or -1
  function findNext(arr, current) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] > current) return arr[i];
    }
    return -1;
  }

  function getNextDates(parsed, count) {
    var results = [];
    // Start scanning from the next minute relative to now
    var now = new Date();
    var d   = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                       now.getHours(), now.getMinutes() + 1, 0, 0);

    // Safety cap: never iterate more than 2 years worth of minutes
    var limit      = 2 * 366 * 24 * 60;
    var iterations = 0;

    // Vixie OR: if BOTH dom and dow are specified, either match satisfies
    var domRestricted = (parsed.raw.dom !== '*');
    var dowRestricted = (parsed.raw.dow !== '*');

    while (results.length < count && iterations < limit) {
      iterations++;

      // ── Month check ────────────────────────────────────────────────────────────
      var m = d.getMonth() + 1; // 1-12
      if (parsed.mon.indexOf(m) === -1) {
        var nextMon = findNext(parsed.mon, m);
        if (nextMon === -1) {
          // Wrap to next year, first valid month
          d = new Date(d.getFullYear() + 1, parsed.mon[0] - 1, 1, 0, 0, 0);
        } else {
          d = new Date(d.getFullYear(), nextMon - 1, 1, 0, 0, 0);
        }
        continue;
      }

      // ── Day check ─────────────────────────────────────────────────────────────
      var dom    = d.getDate();
      var dow    = d.getDay(); // 0=Sun
      var domOk  = !domRestricted || (parsed.dom.indexOf(dom) !== -1);
      var dowOk  = !dowRestricted || (parsed.dow.indexOf(dow) !== -1);
      var dayOk  = (domRestricted && dowRestricted) ? (domOk || dowOk) : (domOk && dowOk);

      if (!dayOk) {
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0);
        continue;
      }

      // ── Hour check ────────────────────────────────────────────────────────────
      var h = d.getHours();
      if (parsed.hour.indexOf(h) === -1) {
        var nextH = findNext(parsed.hour, h);
        if (nextH === -1) {
          d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0);
        } else {
          d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), nextH, 0, 0);
        }
        continue;
      }

      // ── Minute check ─────────────────────────────────────────────────────────
      var min = d.getMinutes();
      if (parsed.min.indexOf(min) === -1) {
        var nextMin = findNext(parsed.min, min);
        if (nextMin === -1) {
          d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1, 0, 0);
        } else {
          d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), nextMin, 0);
        }
        continue;
      }

      // ── All fields match — record this date ───────────────────────────────────
      results.push(new Date(d));
      // Advance by exactly 1 minute before next iteration
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes() + 1, 0);
    }

    return results;
  }

  // Format a Date as "Www YYYY-MM-DD HH:MM"
  function formatDate(d) {
    return DOW_SHORT[d.getDay()] + ' ' +
           d.getFullYear() + '-' +
           pad2(d.getMonth() + 1) + '-' +
           pad2(d.getDate()) + '  ' +
           pad2(d.getHours()) + ':' +
           pad2(d.getMinutes());
  }

  // ─── Build mode helpers ───────────────────────────────────────────────────────

  // Convert one field's state object to a cron token string
  function stateToExpr(field) {
    var s   = buildState[field];
    var cfg = FIELD_CFG[field];
    switch (s.type) {
      case 'every':
        return '*';
      case 'step':
        // Use */N when starting from the field's minimum value (most common convention)
        var prefix = (s.stepFrom === cfg.min) ? '*' : String(s.stepFrom);
        return prefix + '/' + s.step;
      case 'pick':
        if (s.picks.length === 0) return '*';
        return s.picks.slice().sort(function (a, b) { return a - b; }).join(',');
      case 'range':
        return s.rangeFrom + '-' + s.rangeTo;
      default:
        return '*';
    }
  }

  // Assemble the full 5-field expression from current build state
  function buildExpr() {
    return FIELD_ORDER.map(stateToExpr).join(' ');
  }

  // ─── Build mode: render a field card body (inner HTML only) ──────────────────

  function renderCardBody(field) {
    var s   = buildState[field];
    var cfg = FIELD_CFG[field];
    var html = '';

    if (s.type === 'every') {
      html = '<p class="crn-type-hint">Matches every valid ' + cfg.name.toLowerCase() + ' — no restriction.</p>';

    } else if (s.type === 'step') {
      html  = '<div class="crn-step-row">';
      html += '<div class="crn-step-group">';
      html += '<label class="crn-step-label">From</label>';
      html += '<input type="number" id="crn-sf-' + field + '" class="crn-step-input"';
      html += ' min="' + cfg.min + '" max="' + cfg.max + '" value="' + s.stepFrom + '"';
      html += ' oninput="crnStepFromChange(\'' + field + '\')">';
      html += '</div>';
      html += '<div class="crn-step-group">';
      html += '<label class="crn-step-label">Every N</label>';
      html += '<input type="number" id="crn-sv-' + field + '" class="crn-step-input"';
      html += ' min="1" max="' + cfg.max + '" value="' + s.step + '"';
      html += ' oninput="crnStepChange(\'' + field + '\')">';
      html += '</div>';
      html += '</div>';

    } else if (s.type === 'pick') {
      // Column count per field for visual comfort
      var cols = { min: 10, hour: 6, dom: 7, mon: 3, dow: 7 };
      html = '<div class="crn-pick-grid crn-pick-grid--' + cols[field] + 'col">';
      for (var v = cfg.min; v <= cfg.max; v++) {
        var lbl    = cfg.names ? cfg.names[v - cfg.nameOffset] : String(v);
        var isOn   = s.picks.indexOf(v) !== -1;
        html += '<button class="crn-pick-btn' + (isOn ? ' crn-pick-btn--on' : '') + '"';
        html += ' onclick="crnPickToggle(\'' + field + '\',' + v + ')">' + lbl + '</button>';
      }
      html += '</div>';

    } else if (s.type === 'range') {
      html  = '<div class="crn-step-row">';
      html += '<div class="crn-step-group">';
      html += '<label class="crn-step-label">From</label>';
      html += '<input type="number" id="crn-rf-' + field + '" class="crn-step-input"';
      html += ' min="' + cfg.min + '" max="' + cfg.max + '" value="' + s.rangeFrom + '"';
      html += ' oninput="crnRangeChange(\'' + field + '\')">';
      html += '</div>';
      html += '<div class="crn-step-group">';
      html += '<label class="crn-step-label">To</label>';
      html += '<input type="number" id="crn-rt-' + field + '" class="crn-step-input"';
      html += ' min="' + cfg.min + '" max="' + cfg.max + '" value="' + s.rangeTo + '"';
      html += ' oninput="crnRangeChange(\'' + field + '\')">';
      html += '</div>';
      html += '</div>';
    }

    return html;
  }

  // Re-render one complete field card (tabs + body + expression preview)
  function refreshFieldCard(field) {
    var s    = buildState[field];
    var cfg  = FIELD_CFG[field];
    var types = ['every', 'step', 'pick', 'range'];

    // Update type-tab active states
    var tabsContainer = document.querySelector('.crn-field-card--' + field + ' .crn-type-tabs');
    if (tabsContainer) {
      var tabs = tabsContainer.querySelectorAll('.crn-type-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('crn-type-tab--active', types[i] === s.type);
      }
    }

    // Re-render body
    var body = $('crn-body-' + field);
    if (body) body.innerHTML = renderCardBody(field);

    // Update expression preview
    var exprEl = $('crn-fexpr-' + field);
    if (exprEl) exprEl.textContent = stateToExpr(field);
  }

  // ─── Build mode: init the fields grid ─────────────────────────────────────────

  function initFieldsGrid() {
    var grid = $('crn-fields-grid');
    if (!grid) return;
    var types = ['every', 'step', 'pick', 'range'];
    var html  = '';

    FIELD_ORDER.forEach(function (field) {
      var cfg = FIELD_CFG[field];
      var s   = buildState[field];
      html += '<div class="crn-field-card crn-field-card--' + field + '">';
      html += '<div class="crn-field-title crn-fp crn-fp--' + field + '">' + cfg.name + '</div>';

      // Type selector tabs
      html += '<div class="crn-type-tabs">';
      types.forEach(function (t) {
        html += '<button class="crn-type-tab' + (s.type === t ? ' crn-type-tab--active' : '') + '"';
        html += ' onclick="crnSetType(\'' + field + '\',\'' + t + '\')">' + cap(t) + '</button>';
      });
      html += '</div>';

      // Card body (dynamic based on type)
      html += '<div class="crn-card-body" id="crn-body-' + field + '">';
      html += renderCardBody(field);
      html += '</div>';

      // Token preview
      html += '<div class="crn-field-expr" id="crn-fexpr-' + field + '">' + stateToExpr(field) + '</div>';
      html += '</div>';
    });

    grid.innerHTML = html;
  }

  // ─── Shared output updater ────────────────────────────────────────────────────

  function updateBuildOutput() {
    var expr   = buildExpr();
    var exprEl = $('crn-output-expr');
    if (exprEl) exprEl.textContent = expr;

    // Sync per-field token previews
    FIELD_ORDER.forEach(function (f) {
      var el = $('crn-fexpr-' + f);
      if (el) el.textContent = stateToExpr(f);
    });

    try {
      var parsed  = parseCron(expr);
      var descEl  = $('crn-build-desc');
      if (descEl) descEl.textContent = cronToHuman(parsed);
      renderDates(parsed, $('crn-build-dates-list'));
    } catch (e) {
      // Build mode should always produce valid expressions; log if not
      console.warn('[crn] build state produced invalid expr:', expr, e.message);
    }
  }

  // ─── Parse-mode renderers ─────────────────────────────────────────────────────

  // Render the next N dates into the given container element
  function renderDates(parsed, container) {
    if (!container) return;
    var dates = getNextDates(parsed, 5);
    if (dates.length === 0) {
      container.innerHTML = '<div class="crn-date-item crn-date-item--none">No occurrences found within 2 years</div>';
      return;
    }
    var html = '';
    dates.forEach(function (d, i) {
      html += '<div class="crn-date-item">';
      html += '<span class="crn-date-num">' + (i + 1) + '</span>';
      html += '<span class="crn-date-str">' + formatDate(d) + '</span>';
      html += '</div>';
    });
    container.innerHTML = html;
  }

  // Render per-field breakdown pills below the description
  function renderFieldBreakdown(parsed) {
    var container = $('crn-field-breakdown');
    if (!container) return;
    var fields = [
      { key: 'min',  label: 'min',   cls: 'crn-fp--min'  },
      { key: 'hour', label: 'hour',  cls: 'crn-fp--hour' },
      { key: 'dom',  label: 'DOM',   cls: 'crn-fp--dom'  },
      { key: 'mon',  label: 'month', cls: 'crn-fp--mon'  },
      { key: 'dow',  label: 'DOW',   cls: 'crn-fp--dow'  }
    ];
    var html = '';
    fields.forEach(function (f) {
      html += '<span class="crn-fp ' + f.cls + '">';
      html += '<small>' + f.label + '</small> ' + escHtml(parsed.raw[f.key]);
      html += '</span>';
    });
    container.innerHTML = html;
  }

  // Run parse on the given expression string and update the parse panel UI
  function doParse(expr) {
    var errorEl   = $('crn-parse-error');
    var resultsEl = $('crn-parse-results');

    errorEl.textContent = '';
    errorEl.classList.remove('crn-visible');

    if (!expr || !expr.trim()) {
      resultsEl.classList.add('crn-hidden');
      return;
    }

    try {
      var parsed = parseCron(expr);
      $('crn-description').textContent = cronToHuman(parsed);
      renderFieldBreakdown(parsed);
      renderDates(parsed, $('crn-dates-list'));
      resultsEl.classList.remove('crn-hidden');
    } catch (e) {
      errorEl.textContent = '⚠ ' + e.message;
      errorEl.classList.add('crn-visible');
      resultsEl.classList.add('crn-hidden');
    }
  }

  // ─── Toast ────────────────────────────────────────────────────────────────────

  var toastTimer = null;
  function showToast(msg) {
    var toast = $('crn-toast');
    if (!toast) return;
    toast.textContent = msg || '✓ Copied!';
    toast.classList.add('crn-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('crn-show'); }, 2000);
  }

  function copyText(text, msg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showToast(msg); }
      catch (e) { showToast('Copy failed'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { showToast(msg); })
        .catch(fallback);
    } else {
      fallback();
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────────────────

  function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ─── Examples grid ────────────────────────────────────────────────────────────

  function initExamples() {
    var grid = $('crn-examples-grid');
    if (!grid) return;
    var html = '';
    EXAMPLES.forEach(function (ex) {
      html += '<button class="crn-example-btn" onclick="crnLoadExample(\'' + ex.expr + '\')">';
      html += '<span class="crn-example-expr">' + escHtml(ex.expr) + '</span>';
      html += '<span class="crn-example-label">' + escHtml(ex.label) + '</span>';
      html += '</button>';
    });
    grid.innerHTML = html;
  }

  // ─── URL hash (shareable parse links) ────────────────────────────────────────

  function updateHash(expr) {
    if (history.replaceState) {
      var hash = expr ? '#parse=' + encodeURIComponent(expr) : location.pathname + location.search;
      history.replaceState(null, '', hash);
    }
  }

  function initFromHash() {
    var m = location.hash.match(/^#parse=(.+)$/);
    if (!m) return;
    var expr  = decodeURIComponent(m[1]);
    var input = $('crn-expr-input');
    if (input) {
      input.value = expr;
      doParse(expr);
    }
  }

  // ─── Keyboard input listener ─────────────────────────────────────────────────

  function initKeyboard() {
    var input = $('crn-expr-input');
    if (!input) return;

    input.addEventListener('input', function () {
      var expr = this.value.trim();
      updateHash(expr);
      doParse(expr);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        this.value = '';
        updateHash('');
        doParse('');
      }
    });
  }

  // ─── Public API exposed for inline onclick handlers ───────────────────────────

  // Switch between the Parse and Build tabs
  window.crnSwitchTab = function (tab) {
    document.querySelectorAll('.crn-tab').forEach(function (btn) {
      var active = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('crn-tab--active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    var pp = $('crn-parse-panel');
    var bp = $('crn-build-panel');
    if (pp) pp.classList.toggle('crn-panel--active', tab === 'parse');
    if (bp) bp.classList.toggle('crn-panel--active', tab === 'build');
  };

  // Clear the parse input and results
  window.crnClearParse = function () {
    var input = $('crn-expr-input');
    if (input) { input.value = ''; input.focus(); }
    updateHash('');
    doParse('');
  };

  // Copy the current expression from the parse input
  window.crnCopyExpr = function () {
    var input = $('crn-expr-input');
    if (input && input.value.trim()) {
      copyText(input.value.trim(), '✓ Expression copied!');
    }
  };

  // Load an example expression into the parse panel and parse it
  window.crnLoadExample = function (expr) {
    var input = $('crn-expr-input');
    if (input) input.value = expr;
    window.crnSwitchTab('parse');
    updateHash(expr);
    doParse(expr);
  };

  // Copy the built expression to clipboard
  window.crnCopyBuilt = function () {
    copyText(buildExpr(), '✓ Expression copied!');
  };

  // Send the built expression to the parse tab for inspection
  window.crnSendToParse = function () {
    var expr  = buildExpr();
    var input = $('crn-expr-input');
    if (input) input.value = expr;
    window.crnSwitchTab('parse');
    updateHash(expr);
    doParse(expr);
  };

  // Reset all build fields to "every" (wildcard)
  window.crnResetBuild = function () {
    FIELD_ORDER.forEach(function (f) {
      var cfg = FIELD_CFG[f];
      buildState[f] = {
        type:      'every',
        step:      1,
        stepFrom:  cfg.min,
        picks:     [],
        rangeFrom: cfg.min,
        rangeTo:   cfg.max
      };
    });
    initFieldsGrid();
    updateBuildOutput();
  };

  // Change the type (every/step/pick/range) for a given field
  window.crnSetType = function (field, type) {
    buildState[field].type = type;
    refreshFieldCard(field);
    updateBuildOutput();
  };

  // Called when the step "Every N" input changes
  window.crnStepChange = function (field) {
    var el = $('crn-sv-' + field);
    if (!el) return;
    var v = parseInt(el.value, 10);
    if (!isNaN(v) && v >= 1) buildState[field].step = v;
    var exprEl = $('crn-fexpr-' + field);
    if (exprEl) exprEl.textContent = stateToExpr(field);
    updateBuildOutput();
  };

  // Called when the step "From" input changes
  window.crnStepFromChange = function (field) {
    var el  = $('crn-sf-' + field);
    var cfg = FIELD_CFG[field];
    if (!el) return;
    var v = parseInt(el.value, 10);
    if (!isNaN(v) && v >= cfg.min && v <= cfg.max) buildState[field].stepFrom = v;
    var exprEl = $('crn-fexpr-' + field);
    if (exprEl) exprEl.textContent = stateToExpr(field);
    updateBuildOutput();
  };

  // Toggle a specific value on/off in pick mode (optimised: no full re-render)
  window.crnPickToggle = function (field, val) {
    var s   = buildState[field];
    var idx = s.picks.indexOf(val);
    var adding = (idx === -1);
    if (adding) {
      s.picks.push(val);
    } else {
      s.picks.splice(idx, 1);
    }

    // Update the toggled button in-place to avoid re-rendering the whole grid
    var body = $('crn-body-' + field);
    if (body) {
      var btns = body.querySelectorAll('.crn-pick-btn');
      for (var i = 0; i < btns.length; i++) {
        var attr = btns[i].getAttribute('onclick') || '';
        var m    = attr.match(/,\s*(\d+)\s*\)/);
        if (m && parseInt(m[1], 10) === val) {
          btns[i].classList.toggle('crn-pick-btn--on', adding);
          break;
        }
      }
    }

    var exprEl = $('crn-fexpr-' + field);
    if (exprEl) exprEl.textContent = stateToExpr(field);
    updateBuildOutput();
  };

  // Called when either the range "From" or "To" input changes
  window.crnRangeChange = function (field) {
    var cfg   = FIELD_CFG[field];
    var fromEl = $('crn-rf-' + field);
    var toEl   = $('crn-rt-' + field);
    if (!fromEl || !toEl) return;

    var from = parseInt(fromEl.value, 10);
    var to   = parseInt(toEl.value, 10);
    if (!isNaN(from) && from >= cfg.min && from <= cfg.max) buildState[field].rangeFrom = from;
    if (!isNaN(to)   && to   >= cfg.min && to   <= cfg.max) buildState[field].rangeTo   = to;

    // Enforce from ≤ to
    if (buildState[field].rangeFrom > buildState[field].rangeTo) {
      buildState[field].rangeTo = buildState[field].rangeFrom;
      toEl.value = buildState[field].rangeTo;
    }

    var exprEl = $('crn-fexpr-' + field);
    if (exprEl) exprEl.textContent = stateToExpr(field);
    updateBuildOutput();
  };

  // ─── Initialise on DOM ready ──────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    initExamples();
    initFieldsGrid();
    updateBuildOutput();
    initKeyboard();
    initFromHash();
  });

})();
