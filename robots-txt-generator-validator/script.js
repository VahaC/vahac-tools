// robots.txt Generator and Validator — script.js
// Prefix: rbt-
// Dependencies: none.
//
// Parsing and matching follow RFC 9309 (Robots Exclusion Protocol) and the
// behaviour of Google's open-source robots.txt parser: a group is a run of
// User-agent lines followed by Allow/Disallow rules (blank lines do not end a
// group), "*" and a trailing "$" are the only special characters, the longest
// matching rule wins, and Allow wins a tie.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Constants ───────────────────────────────────────────

  var MAX_BYTES = 500 * 1024;             // Google reads the first 500 KiB
  var MAX_FILE_BYTES = 5 * 1024 * 1024;
  var MAX_TEST_URLS = 50;
  var MAX_MESSAGES = 300;
  var BOM = String.fromCharCode(0xFEFF);
  var URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

  // Canonical directive names by lowercase key
  var DIRECTIVES = {
    'user-agent': 'User-agent',
    'allow': 'Allow',
    'disallow': 'Disallow',
    'sitemap': 'Sitemap',
    'crawl-delay': 'Crawl-delay',
    'host': 'Host',
    'clean-param': 'Clean-param',
    'noindex': 'Noindex',
    'nofollow': 'Nofollow',
    'noarchive': 'Noarchive',
    'request-rate': 'Request-rate',
    'visit-time': 'Visit-time'
  };

  // Misspellings that Google's parser accepts ("frequent typos" in google/robotstxt)
  var TYPOS = {
    'useragent': 'user-agent',
    'user agent': 'user-agent',
    'dissallow': 'disallow',
    'dissalow': 'disallow',
    'disalow': 'disallow',
    'diasllow': 'disallow',
    'disallaw': 'disallow',
    'site-map': 'sitemap'
  };

  var SUGGESTABLE = ['user-agent', 'allow', 'disallow', 'sitemap', 'crawl-delay'];

  // Crawlers for the URL tester. "tokens" is the lookup order: the first token
  // with a group wins, otherwise the "*" group applies.
  var CRAWLERS = [
    { id: 'googlebot', label: 'Googlebot', tokens: ['googlebot'] },
    { id: 'googlebot-image', label: 'Googlebot-Image', tokens: ['googlebot-image', 'googlebot'],
      note: 'Googlebot-Image uses its own group if the file has one, otherwise the Googlebot group, otherwise the * group.' },
    { id: 'bingbot', label: 'Bingbot', tokens: ['bingbot'] },
    { id: 'duckduckbot', label: 'DuckDuckBot', tokens: ['duckduckbot'] },
    { id: 'applebot', label: 'Applebot', tokens: ['applebot', 'googlebot'],
      note: 'Apple documents that Applebot follows the Googlebot group when a robots.txt has no Applebot group.' },
    { id: 'gptbot', label: 'GPTBot (OpenAI)', tokens: ['gptbot'] },
    { id: 'claudebot', label: 'ClaudeBot (Anthropic)', tokens: ['claudebot'] },
    { id: 'ccbot', label: 'CCBot (Common Crawl)', tokens: ['ccbot'] },
    { id: 'any', label: 'Any other crawler (* group)', tokens: [] },
    { id: 'custom', label: 'Custom token…', tokens: null }
  ];

  var AI_BOTS = [
    { token: 'GPTBot', owner: 'OpenAI', purpose: 'model training' },
    { token: 'OAI-SearchBot', owner: 'OpenAI', purpose: 'ChatGPT search results' },
    { token: 'ClaudeBot', owner: 'Anthropic', purpose: 'model training' },
    { token: 'Google-Extended', owner: 'Google', purpose: 'Gemini training — Search is unaffected' },
    { token: 'Applebot-Extended', owner: 'Apple', purpose: 'Apple AI training — search is unaffected' },
    { token: 'CCBot', owner: 'Common Crawl', purpose: 'open dataset used to train models' },
    { token: 'PerplexityBot', owner: 'Perplexity', purpose: 'AI answer engine index' },
    { token: 'Meta-ExternalAgent', owner: 'Meta', purpose: 'model training' },
    { token: 'Bytespider', owner: 'ByteDance', purpose: 'crawler for AI products' }
  ];

  var COMMON_AGENTS = ['*', 'Googlebot', 'Googlebot-Image', 'Googlebot-News', 'AdsBot-Google', 'Bingbot',
    'DuckDuckBot', 'YandexBot', 'Baiduspider', 'Applebot'].concat(AI_BOTS.map(function (b) { return b.token; }));

  var PRESETS = {
    allow: [{ agents: '*', rules: [], delay: '' }],
    block: [{ agents: '*', rules: [{ type: 'disallow', path: '/' }], delay: '' }],
    wordpress: [{ agents: '*', rules: [
      { type: 'disallow', path: '/wp-admin/' },
      { type: 'allow', path: '/wp-admin/admin-ajax.php' }
    ], delay: '' }],
    blank: [{ agents: '', rules: [{ type: 'disallow', path: '' }], delay: '' }]
  };

  var SAMPLE = [
    '# Sample robots.txt with a few common mistakes',
    'User-agent: *',
    'Disallow: /wp-admin/',
    'Allow: /wp-admin/admin-ajax.php',
    'Disalow: /tmp/',
    'Disallow: cgi-bin/',
    'Noindex: /drafts/',
    'Crawl-delay: 10',
    '',
    'User-agent: Googlebot-Image',
    '',
    'User-agent: Bingbot',
    'Disallow: /search',
    'Disallow: /*.pdf$',
    '',
    'User-agent: GPTBot',
    'Disallow: /',
    '',
    'Sitemap: /sitemap.xml',
    'Sitemap: https://example.com/sitemap.xml'
  ].join('\n') + '\n';

  var SAMPLE_URLS = ['/', '/wp-admin/', '/wp-admin/admin-ajax.php', '/tmp/cache.json',
    '/docs/manual.pdf', 'https://example.com/search?q=robots'].join('\n');

  var LEVEL_ORDER = { error: 0, warn: 1, fix: 2, info: 3 };
  var LEVEL_LABEL = { error: 'Error', warn: 'Warning', fix: 'Auto-fixed', info: 'Note' };

  // ── Small helpers ───────────────────────────────────────

  function msg(level, line, text) {
    return { level: level, line: line || 0, text: text };
  }

  function plural(n, word, pluralWord) {
    return n + ' ' + (n === 1 ? word : (pluralWord || word + 's'));
  }

  function fmt(n) {
    return Number(n).toLocaleString('en-US');
  }

  // Quote a value for a message; the UI renders `...` as inline code
  function q(v) {
    var s = String(v);
    if (s.length > 80) s = s.slice(0, 77) + '...';
    return '`' + s.replace(/`/g, '\'') + '`';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function richText(s) {
    return escapeHtml(s).replace(/`([^`]+)`/g, '<code class="rbt-code">$1</code>');
  }

  function truncate(s, max) {
    s = String(s == null ? '' : s);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
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

  function hasNonAscii(s) {
    for (var i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) > 126) return true;
    }
    return false;
  }

  function splitLines(text) {
    return String(text).split(/\r\n|\r|\n/);
  }

  function editDistance(a, b) {
    var prev = [];
    var i, j, cur;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // Closest known directive for an unknown key, or null
  function suggestDirective(key) {
    var lower = String(key).toLowerCase();
    if (lower.length < 4) return null;
    var best = null;
    var bestDistance = 3;
    SUGGESTABLE.forEach(function (name) {
      var d = editDistance(lower, name);
      if (d < bestDistance) {
        bestDistance = d;
        best = name;
      }
    });
    return best ? DIRECTIVES[best] : null;
  }

  // Path and query of an absolute URL ("/" when it has none)
  function pathOfUrl(url) {
    try {
      var u = new URL(url);
      return u.pathname + u.search;
    } catch (e) {
      var m = String(url).replace(URL_SCHEME_RE, '').match(/^[^\/?#]*([^#]*)/);
      return m && m[1] ? m[1] : '/';
    }
  }

  // ── Parsing ─────────────────────────────────────────────

  // Split one line into key and value the way Google's parser does: "#" starts
  // a comment, ":" separates key and value, and a line with exactly two words
  // and no colon is read as "key value".
  function parseLine(raw) {
    var hash = raw.indexOf('#');
    var content = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    var res = { kind: 'blank', key: '', value: '', noColon: false };
    if (!content) {
      res.kind = raw.trim() ? 'comment' : 'blank';
      return res;
    }
    var colon = content.indexOf(':');
    if (colon >= 0) {
      res.kind = 'pair';
      res.key = content.slice(0, colon).trim();
      res.value = content.slice(colon + 1).trim();
      return res;
    }
    var parts = content.split(/[ \t]+/);
    if (parts.length === 2) {
      res.kind = 'pair';
      res.key = parts[0];
      res.value = parts[1];
      res.noColon = true;
      return res;
    }
    res.kind = 'invalid';
    return res;
  }

  function resolveKey(key) {
    var lower = String(key).toLowerCase();
    if (DIRECTIVES[lower]) return { name: lower, typo: false };
    if (TYPOS[lower]) return { name: TYPOS[lower], typo: true };
    return { name: null, typo: false };
  }

  // Product token of a User-agent value: "*" or the leading run of letters,
  // "-" and "_" ("Googlebot/2.1" is read as "Googlebot")
  function productToken(value) {
    var v = String(value);
    if (v.charAt(0) === '*' && (v.length === 1 || /\s/.test(v.charAt(1)))) return '*';
    var m = v.match(/^[A-Za-z_-]+/);
    return m ? m[0] : '';
  }

  // Bring a path or rule into the form RFC 9309 compares: non-ASCII and
  // control characters percent-encoded as UTF-8, escapes of unreserved
  // characters decoded, other escapes upper-cased.
  function normalizeEncoding(s) {
    var out = '';
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var code = s.charCodeAt(i);
      if (ch === '%' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
        var hex = s.substr(i + 1, 2).toUpperCase();
        var decoded = String.fromCharCode(parseInt(hex, 16));
        out += /^[A-Za-z0-9._~-]$/.test(decoded) ? decoded : '%' + hex;
        i += 2;
      } else if (code <= 0x20 || code >= 0x7F) {
        var chunk = ch;
        if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) {
          var next = s.charCodeAt(i + 1);
          if (next >= 0xDC00 && next <= 0xDFFF) {
            chunk += s.charAt(i + 1);
            i++;
          }
        }
        try {
          out += encodeURIComponent(chunk);
        } catch (e) {
          out += '%EF%BF%BD';
        }
      } else {
        out += ch;
      }
    }
    return out;
  }

  // Google's matcher: "*" matches any run of characters, a final "$" anchors
  // the end, everything else is literal and the match is anchored at the start.
  function patternMatches(path, pattern) {
    var pathLen = path.length;
    var pos = [0];
    for (var i = 0; i < pattern.length; i++) {
      var c = pattern.charAt(i);
      if (c === '$' && i === pattern.length - 1) {
        return pos[pos.length - 1] === pathLen;
      }
      if (c === '*') {
        var from = pos[0];
        pos = [];
        for (var p = from; p <= pathLen; p++) pos.push(p);
      } else {
        var next = [];
        for (var k = 0; k < pos.length; k++) {
          if (pos[k] < pathLen && path.charAt(pos[k]) === c) next.push(pos[k] + 1);
        }
        if (!next.length) return false;
        pos = next;
      }
    }
    return true;
  }

  function agentNames(agents) {
    return agents.map(function (a) { return q(a.value || '(empty)'); }).join(', ');
  }

  function groupHasStar(group) {
    return group.agents.some(function (a) { return a.token === '*'; });
  }

  function checkRule(rule, group, seen, messages) {
    var v = rule.path;
    var n = rule.line;
    var name = rule.type === 'allow' ? 'Allow' : 'Disallow';

    if (v === '') {
      if (rule.type === 'disallow') {
        messages.push(msg('info', n, 'An empty `Disallow:` blocks nothing, so this group may crawl everything that no other rule blocks.'));
      } else {
        messages.push(msg('warn', n, 'An empty `Allow:` has no effect.'));
      }
      return;
    }

    if (URL_SCHEME_RE.test(v)) {
      messages.push(msg('error', n, 'Use a path, not a full URL. Rules are matched against the path only, so ' + q(v) +
        ' never matches. Write ' + q(name + ': ' + pathOfUrl(v)) + '.'));
    } else if (v.charAt(0) !== '/' && v.charAt(0) !== '*') {
      messages.push(msg('warn', n, 'Rules should start with `/` or `*`. URL paths always begin with `/`, so ' + q(v) +
        ' never matches. Write ' + q(name + ': /' + v) + '.'));
    }

    if (/\s/.test(v)) {
      messages.push(msg('warn', n, 'The path contains a space. Encode it as `%20`.'));
    }

    var dollar = v.indexOf('$');
    if (dollar >= 0 && dollar !== v.length - 1) {
      messages.push(msg('info', n, '`$` only anchors at the very end of a rule. Here it matches a literal `$` character.'));
    }

    if (/\*\*/.test(v)) {
      messages.push(msg('info', n, 'Repeated `*` works the same as a single `*`.'));
    } else if (v.length > 1 && v.charAt(v.length - 1) === '*') {
      messages.push(msg('info', n, 'The trailing `*` is redundant: rules already match every URL that starts with ' + q(v.slice(0, -1)) + '.'));
    }

    if (hasNonAscii(v)) {
      messages.push(msg('info', n, 'Non-ASCII characters are compared in their UTF-8 percent-encoded form: ' + q(rule.norm) + '.'));
    }

    if (rule.type === 'disallow') {
      if ((v === '/' || v === '/*') && groupHasStar(group)) {
        messages.push(msg('warn', n, 'This blocks the whole site for every crawler that has no group of its own. Right for a staging site, a costly accident on a live one.'));
      }
      if (/\.(css|js)(\$|\*)?$/i.test(v) || /^\/wp-(content|includes)\/?$/i.test(v)) {
        messages.push(msg('warn', n, 'Blocking CSS, JavaScript or theme files stops Google from rendering your pages the way visitors see them, which can hurt rankings.'));
      }
      if (/secret|private|confidential|backup|\.env|\.git|passw/i.test(v)) {
        messages.push(msg('info', n, 'robots.txt is public, so this line points anyone who reads it to ' + q(v) +
          '. Protect private areas with authentication; `Disallow` only asks crawlers to stay away.'));
      }
    }

    var sig = rule.type + ' ' + rule.norm;
    var opposite = (rule.type === 'allow' ? 'disallow' : 'allow') + ' ' + rule.norm;
    if (seen[sig]) {
      messages.push(msg('info', n, 'Same rule as line ' + seen[sig] + '.'));
    } else {
      seen[sig] = n;
      if (seen[opposite]) {
        messages.push(msg('info', n, 'Line ' + seen[opposite] + ' has the opposite rule for the same path. They tie, and a tie goes to `Allow`.'));
      }
    }
  }

  function parseRobots(input) {
    var text = input == null ? '' : String(input);
    if (text.charAt(0) === BOM) text = text.slice(1);

    var lines = splitLines(text);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    var messages = [];
    var groups = [];
    var sitemaps = [];
    var current = null;         // group being built
    var inAgents = false;       // still reading the group's User-agent lines
    var blankInAgents = false;
    var agentSeen = {};         // lowercase token -> { group, line }
    var ruleSeen = {};
    var sitemapSeen = {};
    var delayNoted = false;
    var ruleLines = 0;

    lines.forEach(function (raw, idx) {
      var n = idx + 1;
      var p = parseLine(raw);

      if (p.kind === 'blank' || p.kind === 'comment') {
        if (p.kind === 'blank' && inAgents) blankInAgents = true;
        return;
      }
      if (p.kind === 'invalid') {
        messages.push(msg('error', n, 'Can\'t read this line. Directives look like `Name: value`, so crawlers skip it.'));
        return;
      }

      var key = resolveKey(p.key);
      if (!key.name) {
        if (p.noColon) {
          messages.push(msg('error', n, 'Can\'t read this line. Directives look like `Name: value`, so crawlers skip it.'));
          return;
        }
        var guess = suggestDirective(p.key);
        messages.push(msg('warn', n, 'Unknown directive ' + q(p.key) + ', so crawlers ignore this line.' +
          (guess ? ' Did you mean ' + q(guess) + '?' : '')));
        return;
      }

      var name = DIRECTIVES[key.name];
      if (p.noColon) {
        messages.push(msg('error', n, 'Missing `:` after ' + q(p.key) + '. Google guesses the separator from the space, other crawlers skip the line. Write ' +
          q(name + ': ' + p.value) + '.'));
      }
      if (key.typo) {
        messages.push(msg('warn', n, q(p.key) + ' is a misspelling of ' + q(name) + '. Google\'s parser tolerates it, other crawlers skip the line.'));
      }

      switch (key.name) {
        case 'user-agent': {
          if (!current || !inAgents) {
            current = { index: groups.length, agents: [], rules: [], delay: null, startLine: n, endLine: n };
            groups.push(current);
            inAgents = true;
            ruleSeen = {};
          } else if (blankInAgents) {
            messages.push(msg('warn', n, 'A blank line does not end a group. ' + agentNames(current.agents) +
              ' above has no rules of its own, so crawlers merge it with ' + q(p.value || '(empty)') +
              ' and apply the rules below to both. Add `Allow: /` or its own `Disallow` lines under it if it needs different rules.'));
          }
          blankInAgents = false;
          current.endLine = n;

          var token = productToken(p.value);
          current.agents.push({ value: p.value, token: token, line: n });

          if (!p.value) {
            messages.push(msg('error', n, 'Empty `User-agent`. Name a crawler, or use `*` for all crawlers.'));
          } else if (!token) {
            messages.push(msg('error', n, q(p.value) + ' is not a valid user-agent token (letters, `-` and `_` only), so no crawler matches it.'));
          } else if (token !== '*' && token !== p.value) {
            messages.push(msg('warn', n, 'Only the product token counts: ' + q(p.value) + ' is read as ' + q(token) + '.'));
          }

          if (token) {
            var t = token.toLowerCase();
            var prev = agentSeen[t];
            if (!prev) {
              agentSeen[t] = { group: current.index, line: n };
            } else if (prev.group === current.index) {
              messages.push(msg('info', n, q(token) + ' is already listed in this group on line ' + prev.line + '.'));
            } else {
              messages.push(msg('info', n, q(token) + ' also has a group on line ' + prev.line + '. Crawlers combine the rules of both groups.'));
            }
          }
          break;
        }

        case 'allow':
        case 'disallow': {
          ruleLines++;
          if (!current) {
            messages.push(msg('error', n, q(name) + ' before any `User-agent` line is ignored. Add a `User-agent` line above it.'));
            return;
          }
          inAgents = false;
          blankInAgents = false;
          current.endLine = n;
          var rule = { type: key.name, path: p.value, norm: normalizeEncoding(p.value), line: n };
          current.rules.push(rule);
          checkRule(rule, current, ruleSeen, messages);
          break;
        }

        case 'sitemap': {
          if (!p.value) {
            messages.push(msg('error', n, 'Empty `Sitemap` line.'));
          } else if (/\s/.test(p.value)) {
            messages.push(msg('error', n, 'The sitemap URL contains a space. Encode it as `%20`.'));
          } else if (!/^https?:\/\/[^\/?#]+/i.test(p.value)) {
            messages.push(msg('error', n, 'Sitemap needs a full URL such as `https://example.com/sitemap.xml`. ' + q(p.value) + ' is not one.'));
          } else if (sitemapSeen[p.value]) {
            messages.push(msg('info', n, 'Same sitemap as line ' + sitemapSeen[p.value] + '.'));
          } else {
            sitemapSeen[p.value] = n;
          }
          sitemaps.push({ url: p.value, line: n });
          break;
        }

        case 'crawl-delay': {
          if (!delayNoted) {
            delayNoted = true;
            messages.push(msg('info', n, 'Googlebot ignores `Crawl-delay` and adapts to how fast your server responds. Bingbot and some other crawlers honour it.'));
          }
          if (!current) {
            messages.push(msg('warn', n, '`Crawl-delay` before any `User-agent` line is ignored.'));
          } else {
            current.endLine = n;
            if (!/^\d+(\.\d+)?$/.test(p.value)) {
              messages.push(msg('warn', n, '`Crawl-delay` should be a number of seconds, such as `Crawl-delay: 5`.'));
            } else {
              current.delay = { value: p.value, line: n };
              var secs = parseFloat(p.value);
              if (secs >= 10) {
                messages.push(msg('info', n, 'At one request every ' + p.value + ' seconds, a crawler fetches at most about ' +
                  fmt(Math.floor(86400 / secs)) + ' pages a day.'));
              }
            }
          }
          break;
        }

        case 'host':
          messages.push(msg('warn', n, '`Host` was a Yandex-only directive, and Yandex retired it in 2018 in favour of 301 redirects. Other crawlers never supported it.'));
          break;

        case 'clean-param':
          messages.push(msg('info', n, '`Clean-param` is Yandex-only. Other crawlers ignore it.'));
          break;

        case 'noindex':
          messages.push(msg('warn', n, '`Noindex` in robots.txt has not worked in Google since September 2019. Use a robots meta tag or an `X-Robots-Tag` header instead, and leave the page crawlable so crawlers can see it.'));
          break;

        case 'nofollow':
        case 'noarchive':
          messages.push(msg('warn', n, q(name) + ' is not a robots.txt directive, so crawlers ignore it. Use a robots meta tag or an `X-Robots-Tag` header instead.'));
          break;

        default:
          // request-rate, visit-time
          messages.push(msg('warn', n, q(name) + ' is a non-standard directive that most crawlers, including Googlebot, ignore.'));
      }
    });

    groups.forEach(function (g) {
      if (!g.rules.length) {
        messages.push(msg('info', g.startLine, agentNames(g.agents) + ' has no `Allow` or `Disallow` lines, so it may crawl everything.'));
      }
    });

    var bytes = utf8Length(text);
    if (!text.trim()) {
      messages.push(msg('info', 0, 'The file is empty. An empty robots.txt lets every crawler fetch everything, which is fine if that is what you want.'));
    } else {
      if (/<\s*(!doctype|html|head|body)\b/i.test(text)) {
        messages.push(msg('error', 0, 'This looks like an HTML page, not a robots.txt. If your server returns it at /robots.txt, crawlers find no rules and treat the whole site as crawlable.'));
      }
      if (!groups.length) {
        messages.push(msg(ruleLines ? 'warn' : 'info', 0, 'No `User-agent` group, so every crawler may crawl everything.'));
      } else if (!groups.some(groupHasStar)) {
        messages.push(msg('info', 0, 'No `User-agent: *` group. Crawlers that are not named in this file may crawl everything.'));
      }
      if (!sitemaps.length) {
        messages.push(msg('info', 0, 'No `Sitemap` line. It is optional, but it helps crawlers find all your pages.'));
      }
    }
    if (bytes > MAX_BYTES) {
      messages.push(msg('warn', 0, 'The file is ' + formatBytes(bytes) + '. Google reads only the first 500 KiB and ignores the rest.'));
    }

    // Global messages first, then by line and severity
    messages = messages.map(function (m, i) { m.order = i; return m; }).sort(function (a, b) {
      return (a.line - b.line) || (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || (a.order - b.order);
    });
    messages.forEach(function (m) { delete m.order; });

    var ruleCount = 0;
    groups.forEach(function (g) { ruleCount += g.rules.length; });
    var count = function (level) {
      return messages.filter(function (m) { return m.level === level; }).length;
    };

    return {
      lines: lines,
      groups: groups,
      sitemaps: sitemaps,
      messages: messages,
      stats: {
        lines: lines.length,
        bytes: bytes,
        groups: groups.length,
        rules: ruleCount,
        sitemaps: sitemaps.length,
        errors: count('error'),
        warnings: count('warn'),
        notes: count('info')
      }
    };
  }

  // ── Matching ────────────────────────────────────────────

  // Groups that apply to a crawler: the first token (in lookup order) that has
  // a group wins; all groups naming that token are combined. Otherwise "*".
  function selectGroups(parsed, tokens) {
    for (var i = 0; i < tokens.length; i++) {
      var t = String(tokens[i]).toLowerCase();
      if (!t || t === '*') continue;
      var hits = parsed.groups.filter(function (g) {
        return g.agents.some(function (a) { return a.token.toLowerCase() === t; });
      });
      if (hits.length) return { groups: hits, token: hits[0].agents.filter(function (a) { return a.token.toLowerCase() === t; })[0].token };
    }
    var star = parsed.groups.filter(groupHasStar);
    return { groups: star, token: star.length ? '*' : null };
  }

  // Path + query of a tester input: a full URL, a bare host with a path, or a path
  function toTestPath(input) {
    var s = String(input == null ? '' : input).trim();
    if (!s) return { error: 'Empty line.' };
    if (!URL_SCHEME_RE.test(s) && (/^www\./i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?[\/?#]/i.test(s))) {
      s = 'https://' + s;
    }
    if (URL_SCHEME_RE.test(s)) {
      try {
        var u = new URL(s);
        if (!/^https?:$/.test(u.protocol)) return { error: 'Only http and https URLs have a robots.txt.' };
        return { path: u.pathname + u.search, host: u.host };
      } catch (e) {
        return { error: 'Not a valid URL.' };
      }
    }
    var hash = s.indexOf('#');
    if (hash >= 0) s = s.slice(0, hash);
    if (s.charAt(0) !== '/') s = '/' + s;
    return { path: s, host: '' };
  }

  function testPath(parsed, input, tokens) {
    var t = toTestPath(input);
    if (t.error) return { input: input, error: t.error };

    var path = normalizeEncoding(t.path);
    var sel = selectGroups(parsed, tokens || []);
    var res = {
      input: input, path: path, host: t.host, token: sel.token, groups: sel.groups,
      allowed: true, rule: null, matches: [], reason: ''
    };

    if (path === '/robots.txt') {
      res.reason = 'robots';
      return res;
    }
    if (!sel.groups.length) {
      res.reason = 'nogroup';
      return res;
    }

    var best = null;
    sel.groups.forEach(function (g) {
      g.rules.forEach(function (r) {
        if (r.norm === '' || !patternMatches(path, r.norm)) return;
        res.matches.push(r);
        if (!best || r.norm.length > best.norm.length ||
            (r.norm.length === best.norm.length && r.type === 'allow' && best.type !== 'allow')) {
          best = r;
        }
      });
    });

    res.rule = best;
    res.allowed = !best || best.type === 'allow';
    res.reason = best ? 'rule' : 'nomatch';
    return res;
  }

  // ── Generator ───────────────────────────────────────────

  function splitAgents(s) {
    return String(s == null ? '' : s).split(/[\s,]+/).filter(Boolean);
  }

  // Tidy a rule path typed into the generator; returns { path, note }
  function cleanRulePath(value) {
    var v = String(value == null ? '' : value).trim();
    if (!v) return { path: '' };
    if (URL_SCHEME_RE.test(v)) {
      var p = pathOfUrl(v);
      return { path: p, note: 'Turned ' + q(v) + ' into the path ' + q(p) + '. Rules match paths, not full URLs.' };
    }
    if (v.charAt(0) !== '/' && v.charAt(0) !== '*') {
      return { path: '/' + v, note: 'Added a leading `/` to ' + q(v) + '.' };
    }
    return { path: v };
  }

  function buildRobots(cfg) {
    var notes = [];
    var blocks = [];

    (cfg.groups || []).forEach(function (g, gi) {
      var agents = splitAgents(g.agents);
      var rules = [];
      (g.rules || []).forEach(function (r) {
        var c = cleanRulePath(r.path);
        if (c.note) notes.push(c.note);
        if (c.path) rules.push((r.type === 'allow' ? 'Allow: ' : 'Disallow: ') + c.path);
      });
      var delay = String(g.delay == null ? '' : g.delay).trim();

      if (!agents.length) {
        if (rules.length || delay) notes.push('Group ' + (gi + 1) + ' has no user-agent, so it was left out.');
        return;
      }

      // A group without rules would merge with the next group, so write an empty Disallow
      if (!rules.length) rules.push('Disallow:');
      var lines = agents.map(function (a) { return 'User-agent: ' + a; }).concat(rules);
      if (delay) {
        if (/^\d+(\.\d+)?$/.test(delay)) {
          lines.push('Crawl-delay: ' + delay);
        } else {
          notes.push('Crawl-delay ' + q(delay) + ' is not a number of seconds, so it was left out.');
        }
      }
      blocks.push(lines.join('\n'));
    });

    var ai = (cfg.aiBots || []).filter(Boolean);
    if (ai.length) {
      blocks.push(ai.map(function (a) { return 'User-agent: ' + a; }).concat(['Disallow: /']).join('\n'));
    }

    var maps = splitLines(cfg.sitemaps || '').map(function (s) { return s.trim(); }).filter(Boolean);
    if (maps.length) {
      blocks.push(maps.map(function (u) { return 'Sitemap: ' + u; }).join('\n'));
    }

    return { text: blocks.length ? blocks.join('\n\n') + '\n' : '', notes: notes };
  }

  // Paths worth testing for a generated file: "/" plus each literal rule path
  function suggestTestPaths(parsed) {
    var out = ['/'];
    parsed.groups.forEach(function (g) {
      g.rules.forEach(function (r) {
        var p = r.path.replace(/\$$/, '');
        if (p && p.charAt(0) === '/' && p.indexOf('*') < 0 && out.indexOf(p) < 0) out.push(p);
      });
    });
    return out.slice(0, 12);
  }

  // ── UI state ────────────────────────────────────────────

  var state = {
    mode: 'generate',
    groups: [{ agents: '*', rules: [{ type: 'disallow', path: '' }], delay: '' }],
    ai: {},
    generated: '',
    parsed: null
  };
  var validateTimer = null;

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function showToast(text, isError) {
    var toast = $('rbt-toast');
    toast.textContent = text;
    toast.classList.toggle('rbt-toast--error', !!isError);
    toast.classList.add('rbt-show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.classList.remove('rbt-show'); }, 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast('Copied to clipboard'); }).catch(fallback);
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
      try {
        document.execCommand('copy');
        showToast('Copied to clipboard');
      } catch (e) {
        showToast('Copy failed — select the text and copy it manually', true);
      }
      document.body.removeChild(ta);
    }
  }

  function downloadText(text, filename) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ── Rendering: messages ─────────────────────────────────

  function renderMessages(list, messages, lines) {
    if (!messages.length) {
      list.innerHTML = '<li class="rbt-msg rbt-msg--ok"><div class="rbt-msg-text">&#10003; No problems found.</div></li>';
      return;
    }
    var shown = messages.slice(0, MAX_MESSAGES);
    var html = shown.map(function (m) {
      var where = '';
      if (m.line) {
        where = '<span class="rbt-msg-line">Line ' + m.line + '</span>' +
          '<code class="rbt-msg-src">' + escapeHtml(truncate(lines[m.line - 1], 140)) + '</code>';
      }
      return '<li class="rbt-msg rbt-msg--' + m.level + '">' +
        '<div class="rbt-msg-head"><span class="rbt-msg-level">' + LEVEL_LABEL[m.level] + '</span>' + where + '</div>' +
        '<div class="rbt-msg-text">' + richText(m.text) + '</div></li>';
    }).join('');
    if (messages.length > shown.length) {
      html += '<li class="rbt-msg rbt-msg--info"><div class="rbt-msg-text">…and ' +
        fmt(messages.length - shown.length) + ' more.</div></li>';
    }
    list.innerHTML = html;
  }

  function countText(stats) {
    return plural(stats.errors, 'error') + ' · ' + plural(stats.warnings, 'warning') + ' · ' + plural(stats.notes, 'note');
  }

  // ── Generator UI ────────────────────────────────────────

  function renderGroups() {
    var many = state.groups.length > 1;
    $('rbt-groups').innerHTML = state.groups.map(function (g, gi) {
      var rules = g.rules.map(function (r, ri) {
        var at = ' data-g="' + gi + '" data-r="' + ri + '"';
        return '<div class="rbt-rule">' +
          '<select class="rbt-select rbt-rule-type"' + at + ' data-field="type" aria-label="Rule type, group ' + (gi + 1) + ' rule ' + (ri + 1) + '">' +
            '<option value="disallow"' + (r.type === 'disallow' ? ' selected' : '') + '>Disallow</option>' +
            '<option value="allow"' + (r.type === 'allow' ? ' selected' : '') + '>Allow</option>' +
          '</select>' +
          '<input class="rbt-input rbt-input--mono rbt-rule-path" type="text"' + at + ' data-field="path" value="' + escapeHtml(r.path) +
            '" placeholder="/private/" maxlength="500" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Path, group ' + (gi + 1) + ' rule ' + (ri + 1) + '">' +
          '<button class="rbt-icon-btn" type="button"' + at + ' data-action="remove-rule" aria-label="Remove rule ' + (ri + 1) + '" title="Remove rule">&#10005;</button>' +
        '</div>';
      }).join('');

      return '<div class="rbt-group">' +
        '<div class="rbt-group-head">' +
          '<span class="rbt-group-num">Group ' + (gi + 1) + '</span>' +
          (many ? '<button class="rbt-link-btn rbt-link-btn--danger" type="button" data-g="' + gi + '" data-action="remove-group">Remove group</button>' : '') +
        '</div>' +
        '<div class="rbt-field">' +
          '<label class="rbt-label" for="rbt-agents-' + gi + '">User-agent — separate several with commas</label>' +
          '<input class="rbt-input rbt-input--mono" id="rbt-agents-' + gi + '" type="text" list="rbt-agent-list" data-g="' + gi + '" data-field="agents" value="' +
            escapeHtml(g.agents) + '" placeholder="* or Googlebot, Bingbot" maxlength="300" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">' +
        '</div>' +
        '<div class="rbt-rules">' + (rules ||
          '<p class="rbt-hint">No rules: this group may crawl everything. It is written as an empty <code class="rbt-code">Disallow:</code> so it stays a separate group.</p>') +
        '</div>' +
        '<div class="rbt-group-foot">' +
          '<div class="rbt-toolbar">' +
            '<button class="rbt-link-btn" type="button" data-g="' + gi + '" data-action="add-rule" data-type="disallow">+ Disallow</button>' +
            '<button class="rbt-link-btn" type="button" data-g="' + gi + '" data-action="add-rule" data-type="allow">+ Allow</button>' +
          '</div>' +
          '<label class="rbt-delay" for="rbt-delay-' + gi + '">' +
            '<span class="rbt-delay-label">Crawl-delay (s)</span>' +
            '<input class="rbt-input rbt-input--mono rbt-input--delay" id="rbt-delay-' + gi + '" type="text" inputmode="decimal" data-g="' + gi +
              '" data-field="delay" value="' + escapeHtml(g.delay) + '" placeholder="—" maxlength="6" autocomplete="off" title="Bingbot and some other crawlers honour it; Googlebot ignores it">' +
          '</label>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderAiGrid() {
    $('rbt-ai-grid').innerHTML = AI_BOTS.map(function (b, i) {
      return '<label class="rbt-check" for="rbt-ai-' + i + '">' +
        '<input class="rbt-checkbox" id="rbt-ai-' + i + '" type="checkbox" data-ai="' + escapeHtml(b.token) + '"' + (state.ai[b.token] ? ' checked' : '') + '>' +
        '<span class="rbt-check-text"><span class="rbt-check-name">' + escapeHtml(b.token) + '</span>' +
        '<span class="rbt-check-sub">' + escapeHtml(b.owner + ' — ' + b.purpose) + '</span></span></label>';
    }).join('');
  }

  function updateGenerator() {
    var built = buildRobots({
      groups: state.groups,
      aiBots: AI_BOTS.filter(function (b) { return state.ai[b.token]; }).map(function (b) { return b.token; }),
      sitemaps: $('rbt-sitemaps').value
    });
    state.generated = built.text;
    $('rbt-gen-output').value = built.text;

    var empty = !built.text;
    $('rbt-gen-copy').disabled = empty;
    $('rbt-gen-download').disabled = empty;

    var list = $('rbt-gen-messages');
    if (empty) {
      $('rbt-gen-size').textContent = '';
      $('rbt-gen-check-count').textContent = '';
      renderMessages(list, built.notes.map(function (n) { return msg('fix', 0, n); })
        .concat([msg('info', 0, 'Add a user-agent to a group, pick an AI crawler or enter a sitemap to start.')]), []);
      return;
    }

    var parsed = parseRobots(built.text);
    $('rbt-gen-size').textContent = plural(parsed.stats.lines, 'line') + ' · ' + formatBytes(parsed.stats.bytes);
    $('rbt-gen-check-count').textContent = countText(parsed.stats);
    renderMessages(list, built.notes.map(function (n) { return msg('fix', 0, n); }).concat(parsed.messages), parsed.lines);
  }

  function applyPreset(name) {
    if (!PRESETS[name]) return;
    state.groups = clone(PRESETS[name]);
    renderGroups();
    updateGenerator();
    showToast('Preset loaded');
  }

  function addGroup() {
    state.groups.push({ agents: '', rules: [{ type: 'disallow', path: '' }], delay: '' });
    renderGroups();
    updateGenerator();
    var input = $('rbt-agents-' + (state.groups.length - 1));
    if (input) input.focus();
  }

  function onGroupsInput(e) {
    var el = e.target;
    var field = el.getAttribute('data-field');
    if (!field) return;
    var g = state.groups[+el.getAttribute('data-g')];
    if (!g) return;
    if (field === 'agents' || field === 'delay') {
      g[field] = el.value;
    } else {
      var r = g.rules[+el.getAttribute('data-r')];
      if (!r) return;
      r[field] = el.value;
    }
    updateGenerator();
  }

  function onGroupsClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!btn) return;
    var gi = +btn.getAttribute('data-g');
    var g = state.groups[gi];
    if (!g) return;
    var action = btn.getAttribute('data-action');
    var focusSelector = null;

    if (action === 'add-rule') {
      g.rules.push({ type: btn.getAttribute('data-type') === 'allow' ? 'allow' : 'disallow', path: '' });
      focusSelector = '.rbt-rule-path[data-g="' + gi + '"][data-r="' + (g.rules.length - 1) + '"]';
    } else if (action === 'remove-rule') {
      g.rules.splice(+btn.getAttribute('data-r'), 1);
    } else if (action === 'remove-group') {
      state.groups.splice(gi, 1);
    }
    renderGroups();
    updateGenerator();
    if (focusSelector) {
      var el = $('rbt-groups').querySelector(focusSelector);
      if (el) el.focus();
    }
  }

  function setAllAi(on) {
    AI_BOTS.forEach(function (b) { state.ai[b.token] = !!on; });
    renderAiGrid();
    updateGenerator();
  }

  function sendToValidator() {
    if (!state.generated) {
      showToast('Nothing to test yet', true);
      return;
    }
    $('rbt-input').value = state.generated;
    $('rbt-file-name').textContent = '';
    var parsed = parseRobots(state.generated);
    if (!$('rbt-urls').value.trim()) $('rbt-urls').value = suggestTestPaths(parsed).join('\n');
    setMode('validate');
    updateValidator();
    var panel = $('rbt-panel-validate');
    if (panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Validator UI ────────────────────────────────────────

  function chip(cls, text) {
    return '<span class="rbt-chip' + (cls ? ' rbt-chip--' + cls : '') + '">' + escapeHtml(text) + '</span>';
  }

  function renderGroupList(parsed) {
    var list = $('rbt-group-list');
    $('rbt-group-empty').classList.toggle('rbt-hidden', parsed.groups.length > 0);
    list.innerHTML = parsed.groups.slice(0, 100).map(function (g) {
      var agents = g.agents.map(function (a) {
        return '<code class="rbt-code">' + escapeHtml(truncate(a.value || '(empty)', 60)) + '</code>';
      }).join(' ');
      var pills = g.rules.slice(0, 8).map(function (r) {
        var label = (r.type === 'allow' ? 'Allow ' : 'Disallow ') + (r.path || '(empty)');
        return '<span class="rbt-pill rbt-pill--' + r.type + '">' + escapeHtml(truncate(label, 60)) + '</span>';
      }).join('');
      if (g.rules.length > 8) pills += '<span class="rbt-pill rbt-pill--muted">+' + (g.rules.length - 8) + ' more</span>';
      if (!g.rules.length) pills = '<span class="rbt-pill rbt-pill--muted">no rules — may crawl everything</span>';
      if (g.delay) pills += '<span class="rbt-pill rbt-pill--delay">Crawl-delay ' + escapeHtml(g.delay.value) + '</span>';
      var lines = g.startLine === g.endLine ? 'line ' + g.startLine : 'lines ' + g.startLine + '–' + g.endLine;
      return '<li class="rbt-group-item">' +
        '<div class="rbt-group-item-head"><span class="rbt-group-agents">' + agents + '</span><span class="rbt-counter">' + lines + '</span></div>' +
        '<div class="rbt-group-rules">' + pills + '</div></li>';
    }).join('');
  }

  function updateValidator() {
    var text = $('rbt-input').value;
    var parsed = parseRobots(text);
    state.parsed = parsed;
    var s = parsed.stats;
    var hasText = text.trim() !== '';

    $('rbt-input-status').textContent = hasText ? plural(s.lines, 'line') + ' · ' + formatBytes(s.bytes) : '';
    $('rbt-val-empty').classList.toggle('rbt-hidden', hasText);

    if (!hasText) {
      $('rbt-summary').innerHTML = '';
      $('rbt-val-messages').innerHTML = '';
    } else {
      var chips = '';
      if (!s.errors && !s.warnings) chips += chip('ok', 'No errors or warnings');
      if (s.errors) chips += chip('error', plural(s.errors, 'error'));
      if (s.warnings) chips += chip('warn', plural(s.warnings, 'warning'));
      if (s.notes) chips += chip('info', plural(s.notes, 'note'));
      chips += chip('', plural(s.groups, 'group')) + chip('', plural(s.rules, 'rule')) + chip('', plural(s.sitemaps, 'sitemap'));
      $('rbt-summary').innerHTML = chips;
      renderMessages($('rbt-val-messages'), parsed.messages, parsed.lines);
    }

    renderGroupList(parsed);
    runTests();
  }

  function scheduleValidate() {
    clearTimeout(validateTimer);
    validateTimer = setTimeout(updateValidator, 150);
  }

  function findCrawler(id) {
    for (var i = 0; i < CRAWLERS.length; i++) {
      if (CRAWLERS[i].id === id) return CRAWLERS[i];
    }
    return CRAWLERS[0];
  }

  function currentCrawler() {
    var c = findCrawler($('rbt-crawler').value);
    if (c.tokens !== null) return { label: c.label, tokens: c.tokens, note: c.note || '' };
    var token = productToken($('rbt-custom-agent').value.trim());
    return {
      label: token || 'custom crawler',
      tokens: token && token !== '*' ? [token] : [],
      note: 'A custom token is matched case-insensitively against each User-agent line.'
    };
  }

  function lineList(groups) {
    return groups.map(function (g) { return g.startLine; }).join(', ');
  }

  function explainResult(r, crawler, parsed) {
    if (r.reason === 'robots') return '`/robots.txt` itself is always allowed.';
    if (r.reason === 'nogroup') {
      return parsed.groups.length
        ? 'No group names this crawler and there is no `User-agent: *` group, so everything is allowed.'
        : 'The file has no user-agent groups, so everything is allowed.';
    }

    var group = 'Group ' + q('User-agent: ' + r.token) + ' (line ' + lineList(r.groups) + ')';
    var first = crawler.tokens[0];
    if (r.token === '*' && crawler.tokens.length) {
      group += ' applies because no group names ' + q(crawler.label.split(' ')[0]);
    } else if (first && r.token.toLowerCase() !== String(first).toLowerCase()) {
      group += ' applies because there is no ' + q(first) + ' group';
    }

    if (r.reason === 'nomatch') return group + '. No rule matches this path, so it is allowed.';

    var name = r.rule.type === 'allow' ? 'Allow' : 'Disallow';
    var text = group + '. ' + q(name + ': ' + r.rule.path) + ' on line ' + r.rule.line + ' decides.';
    var others = r.matches.filter(function (m) { return m !== r.rule; });
    if (others.length) {
      var tie = others.some(function (m) { return m.norm.length === r.rule.norm.length && m.type !== r.rule.type; });
      if (tie) {
        text += ' It ties with a `Disallow` of the same length, and a tie goes to `Allow`.';
      } else {
        text += ' It is the longest of ' + (others.length + 1) + ' matching rules, beating ' + others.slice(0, 2).map(function (m) {
          return q((m.type === 'allow' ? 'Allow: ' : 'Disallow: ') + m.path) + ' (line ' + m.line + ')';
        }).join(' and ') + (others.length > 2 ? ' and ' + (others.length - 2) + ' more' : '') + '.';
      }
    }
    return text;
  }

  function runTests() {
    var parsed = state.parsed || parseRobots($('rbt-input').value);
    var isCustom = $('rbt-crawler').value === 'custom';
    $('rbt-custom-field').classList.toggle('rbt-hidden', !isCustom);

    var crawler = currentCrawler();
    $('rbt-crawler-note').textContent = (crawler.note ? crawler.note + ' ' : '') +
      'Only the path and query are compared; a robots.txt covers just the host, protocol and port it is served from.';

    var inputs = splitLines($('rbt-urls').value).map(function (s) { return s.trim(); }).filter(Boolean);
    var extra = inputs.length - MAX_TEST_URLS;
    inputs = inputs.slice(0, MAX_TEST_URLS);

    if (!inputs.length) {
      $('rbt-results').innerHTML = '';
      $('rbt-test-count').textContent = '';
      return;
    }

    var allowed = 0;
    var blocked = 0;
    var html = inputs.map(function (input) {
      var r = testPath(parsed, input, crawler.tokens);
      if (r.error) {
        return '<li class="rbt-result rbt-result--invalid"><span class="rbt-verdict">Invalid</span>' +
          '<div class="rbt-result-body"><code class="rbt-result-path">' + escapeHtml(truncate(input, 200)) + '</code>' +
          '<p class="rbt-result-why">' + escapeHtml(r.error) + '</p></div></li>';
      }
      if (r.allowed) allowed++; else blocked++;
      return '<li class="rbt-result rbt-result--' + (r.allowed ? 'allow' : 'block') + '">' +
        '<span class="rbt-verdict">' + (r.allowed ? 'Allowed' : 'Blocked') + '</span>' +
        '<div class="rbt-result-body"><code class="rbt-result-path">' + escapeHtml(truncate(r.path, 200)) + '</code>' +
        '<p class="rbt-result-why">' + richText(explainResult(r, crawler, parsed)) + '</p></div></li>';
    }).join('');
    if (extra > 0) {
      html += '<li class="rbt-result rbt-result--invalid"><div class="rbt-result-body"><p class="rbt-result-why">Only the first ' +
        MAX_TEST_URLS + ' lines are tested (' + extra + ' skipped).</p></div></li>';
    }
    $('rbt-results').innerHTML = html;
    $('rbt-test-count').textContent = allowed + ' allowed · ' + blocked + ' blocked';
  }

  function loadSample() {
    $('rbt-input').value = SAMPLE;
    $('rbt-urls').value = SAMPLE_URLS;
    $('rbt-crawler').value = 'googlebot';
    $('rbt-file-name').textContent = 'sample';
    updateValidator();
  }

  function clearInput() {
    $('rbt-input').value = '';
    $('rbt-file-name').textContent = '';
    updateValidator();
    $('rbt-input').focus();
  }

  function openFile() {
    $('rbt-file').click();
  }

  function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showToast('File is larger than ' + formatBytes(MAX_FILE_BYTES), true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      $('rbt-input').value = String(reader.result || '');
      $('rbt-file-name').textContent = truncate(file.name, 40);
      updateValidator();
    };
    reader.onerror = function () { showToast('Could not read the file', true); };
    reader.readAsText(file);
  }

  function hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    for (var i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }

  // ── Mode tabs ───────────────────────────────────────────

  function setMode(mode) {
    if (mode !== 'generate' && mode !== 'validate') return;
    state.mode = mode;
    ['generate', 'validate'].forEach(function (m) {
      var on = m === mode;
      var tab = $('rbt-mode-' + m);
      tab.classList.toggle('rbt-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      $('rbt-panel-' + m).classList.toggle('rbt-hidden', !on);
    });
    try {
      history.replaceState(null, '', mode === 'validate' ? '#validator' : location.pathname + location.search);
    } catch (e) { /* history can be unavailable in sandboxed frames */ }
  }

  // ── Init ────────────────────────────────────────────────

  function init() {
    $('rbt-agent-list').innerHTML = COMMON_AGENTS.map(function (a) {
      return '<option value="' + escapeHtml(a) + '"></option>';
    }).join('');
    $('rbt-crawler').innerHTML = CRAWLERS.map(function (c) {
      return '<option value="' + c.id + '">' + escapeHtml(c.label) + '</option>';
    }).join('');

    renderGroups();
    renderAiGrid();

    var groupsEl = $('rbt-groups');
    groupsEl.addEventListener('input', onGroupsInput);
    groupsEl.addEventListener('change', onGroupsInput);
    groupsEl.addEventListener('click', onGroupsClick);

    $('rbt-ai-grid').addEventListener('change', function (e) {
      var token = e.target.getAttribute && e.target.getAttribute('data-ai');
      if (!token) return;
      state.ai[token] = e.target.checked;
      updateGenerator();
    });
    $('rbt-sitemaps').addEventListener('input', updateGenerator);

    var input = $('rbt-input');
    input.addEventListener('input', function () {
      $('rbt-file-name').textContent = '';
      scheduleValidate();
    });
    $('rbt-urls').addEventListener('input', runTests);
    $('rbt-crawler').addEventListener('change', function () {
      runTests();
      if ($('rbt-crawler').value === 'custom') $('rbt-custom-agent').focus();
    });
    $('rbt-custom-agent').addEventListener('input', runTests);

    $('rbt-file').addEventListener('change', function (e) {
      loadFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (type) {
      input.addEventListener(type, function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        input.classList.add('rbt-dragover');
      });
    });
    input.addEventListener('dragleave', function () { input.classList.remove('rbt-dragover'); });
    input.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      input.classList.remove('rbt-dragover');
      if (!files || !files.length) return;
      e.preventDefault();
      loadFile(files[0]);
    });

    // Arrow keys move between the mode tabs
    $('rbt-modes').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var next = state.mode === 'generate' ? 'validate' : 'generate';
      setMode(next);
      $('rbt-mode-' + next).focus();
      e.preventDefault();
    });

    updateGenerator();
    updateValidator();
    if (location.hash === '#validator') setMode('validate');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Expose global handlers for onclick attributes
  window.rbtSetMode = setMode;
  window.rbtPreset = applyPreset;
  window.rbtAddGroup = addGroup;
  window.rbtAiAll = setAllAi;
  window.rbtCopyGenerated = function () { if (state.generated) copyText(state.generated); };
  window.rbtDownloadGenerated = function () { if (state.generated) downloadText(state.generated, 'robots.txt'); };
  window.rbtSendToValidator = sendToValidator;
  window.rbtLoadSample = loadSample;
  window.rbtOpenFile = openFile;
  window.rbtClearInput = clearInput;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseLine: parseLine,
      resolveKey: resolveKey,
      productToken: productToken,
      normalizeEncoding: normalizeEncoding,
      patternMatches: patternMatches,
      parseRobots: parseRobots,
      selectGroups: selectGroups,
      toTestPath: toTestPath,
      testPath: testPath,
      splitAgents: splitAgents,
      cleanRulePath: cleanRulePath,
      buildRobots: buildRobots,
      suggestTestPaths: suggestTestPaths,
      suggestDirective: suggestDirective,
      editDistance: editDistance,
      CRAWLERS: CRAWLERS,
      AI_BOTS: AI_BOTS,
      PRESETS: PRESETS,
      SAMPLE: SAMPLE
    };
  }

})();
