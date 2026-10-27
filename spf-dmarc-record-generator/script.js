/* SPF and DMARC Record Generator and Checker — script.js
   Prefix: sdr-
   Builds SPF (RFC 7208) and DMARC (RFC 9989, May 2026, which obsoletes
   RFC 7489) TXT records and checks pasted ones: syntax, the 10-lookup limit,
   report destinations and the zone-file form with 255-octet strings.
   No dependencies and no network requests, not even DNS lookups: you paste
   the records yourself (dig, nslookup or your DNS panel), and the generator
   settings live in the URL hash. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Constants ─────────────────────────────────────────────

  var RFC_BASE = 'https://www.rfc-editor.org/rfc/rfc';
  var SPF_LIMIT = 10;
  var TXT_MAX = 255;
  var MAX_FIELD = 1000;

  // SPF includes, each copied from the provider's own documentation (checked 2026-10-27).
  // scope 'apex': the include goes into the SPF record of the domain you send from.
  // scope 'domain': it goes on the domain you verified with the service.
  // scope 'sub': it goes on a subdomain the service uses as envelope sender (MAIL FROM).
  var PROVIDERS = [
    {
      id: 'google', group: 'mailbox', name: 'Google Workspace', include: '_spf.google.com', scope: 'apex',
      url: 'https://support.google.com/a/answer/10685031',
      note: 'Google\'s own example ends in ~all.'
    },
    {
      id: 'ms365', group: 'mailbox', name: 'Microsoft 365', include: 'spf.protection.outlook.com', scope: 'apex',
      url: 'https://learn.microsoft.com/en-us/defender-office-365/email-authentication-spf-configure',
      note: 'Worldwide tenants. GCC High and DoD use spf.protection.office365.us, Office 365 operated by 21Vianet uses spf.protection.partner.outlook.cn.'
    },
    {
      id: 'zoho', group: 'mailbox', name: 'Zoho Mail', include: 'zohomail.com', scope: 'apex',
      url: 'https://www.zoho.com/mail/help/adminconsole/spf-configuration.html',
      note: 'Zoho suggests include:one.zoho.com instead when you send through several Zoho services.'
    },
    {
      id: 'fastmail', group: 'mailbox', name: 'Fastmail', include: 'spf.messagingengine.com', scope: 'apex',
      url: 'https://www.fastmail.help/hc/en-us/articles/360060591153-Manual-DNS-configuration',
      note: 'Fastmail\'s own example ends in ?all.'
    },
    {
      id: 'proton', group: 'mailbox', name: 'Proton Mail', include: '_spf.protonmail.ch', scope: 'apex',
      url: 'https://proton.me/support/anti-spoofing-custom-domain',
      note: ''
    },
    {
      id: 'icloud', group: 'mailbox', name: 'iCloud+ Custom Email Domain', include: 'icloud.com', scope: 'apex',
      url: 'https://support.apple.com/en-us/102374',
      note: ''
    },
    {
      id: 'mailgun', group: 'sending', name: 'Mailgun', include: 'mailgun.org', scope: 'domain',
      url: 'https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify',
      note: 'Goes on the domain you added in Mailgun. If that is a subdomain such as mg.example.com, build this record for that subdomain.'
    },
    {
      id: 'ses', group: 'sending', name: 'Amazon SES', include: 'amazonses.com', scope: 'sub',
      url: 'https://docs.aws.amazon.com/ses/latest/dg/mail-from.html',
      note: 'Only on a custom MAIL FROM subdomain (with its MX record). With the default MAIL FROM, SES passes SPF on its own amazonses.com subdomain and needs nothing in your record.'
    },
    {
      id: 'sendgrid', group: 'sending', name: 'SendGrid', include: 'sendgrid.net', scope: 'sub',
      url: 'https://www.twilio.com/docs/sendgrid/ui/account-and-settings/how-to-set-up-domain-authentication',
      note: 'Only with automated security turned off, on the em####.example.com subdomain SendGrid shows you. With automated security on, SendGrid\'s CNAME records cover SPF.'
    }
  ];

  var SPF_MECHANISMS = ['all', 'include', 'a', 'mx', 'ptr', 'ip4', 'ip6', 'exists'];
  var SPF_LOOKUP = { include: true, a: true, mx: true, ptr: true, exists: true };
  var QUAL_RESULT = { '+': 'pass', '-': 'fail', '~': 'softfail', '?': 'neutral' };

  var MACRO_LETTERS = {
    s: 'the envelope sender address (local-part@domain)',
    l: 'the local part of the sender address',
    o: 'the domain of the sender address',
    d: 'the domain whose record is being evaluated',
    i: 'the sending IP address (dotted form, also for IPv6)',
    p: 'the validated reverse-DNS name of the sending IP (do not use)',
    v: '"in-addr" for IPv4 or "ip6" for IPv6',
    h: 'the HELO/EHLO name of the sending server',
    c: 'the SMTP client IP (only allowed in explanation text)',
    r: 'the name of the receiving host (only allowed in explanation text)',
    t: 'the current time in seconds (only allowed in explanation text)'
  };

  var DMARC_KNOWN = ['v', 'p', 'sp', 'np', 'adkim', 'aspf', 'rua', 'ruf', 'fo', 't', 'psd'];
  var DMARC_REMOVED = ['pct', 'rf', 'ri'];
  var POLICIES = ['none', 'quarantine', 'reject'];

  // Second-level labels that usually sit under a two-letter country code (example.co.uk).
  var SLD_SUFFIX = ['ac', 'co', 'com', 'edu', 'gov', 'net', 'org', 'mil', 'ne', 'or', 'go', 'gob', 'nic', 'ltd', 'plc', 'sch', 'nom', 'gen', 'biz', 'info'];

  // ── Small helpers ─────────────────────────────────────────

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function code(s) {
    return '<code class="sdr-code">' + escapeHtml(s) + '</code>';
  }

  function isAscii(s) {
    return /^[\x00-\x7f]*$/.test(String(s));
  }

  function fmtInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function trimWsp(s) {
    return String(s).replace(/^[ \t]+|[ \t]+$/g, '');
  }

  function editDistance(a, b) {
    var m = a.length, n = b.length, prev = [], cur, i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // Closest known word for a typo, or null.
  function suggest(word, list) {
    var w = String(word).toLowerCase();
    var max = w.length <= 3 ? 1 : 2;
    var best = null, bestD = max + 1;
    list.forEach(function (cand) {
      var d = editDistance(w, cand);
      if (d > 0 && d < bestD) { bestD = d; best = cand; }
    });
    return best;
  }

  function ref(rfc, sec) {
    return { rfc: String(rfc), sec: String(sec) };
  }

  function isAppendix(sec) {
    return /^[A-Z]/.test(sec);
  }

  function refUrl(r) {
    return RFC_BASE + r.rfc + '#' + (isAppendix(r.sec) ? 'appendix-' : 'section-') + r.sec;
  }

  function refLabel(r) {
    return 'RFC ' + r.rfc + (isAppendix(r.sec) ? ' Appendix ' : ' §') + r.sec;
  }

  function issue(level, codeId, msg, fix, r, perm) {
    return { level: level, code: codeId, msg: msg, fix: fix || '', ref: r || null, perm: !!perm };
  }

  // ── Domains ───────────────────────────────────────────────

  var LABEL_RE = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/;

  // A-label form of a domain (lowercase); null when it cannot be converted.
  function toAsciiDomain(s) {
    s = String(s == null ? '' : s);
    if (isAscii(s)) return s.toLowerCase();
    try {
      return new URL('http://' + s + '/').hostname;
    } catch (e) {
      return null;
    }
  }

  // Why a lowercase host name is not valid, or null when it is.
  function hostnameProblem(h) {
    if (!h) return 'it is empty';
    if (h.length > 253) return 'it is longer than 253 characters';
    var labels = h.split('.');
    for (var i = 0; i < labels.length; i++) {
      var l = labels[i];
      if (l === '') return 'it has an empty label (two dots in a row, or a leading dot)';
      if (l.length > 63) return 'the label "' + l.slice(0, 20) + '…" is longer than 63 characters';
      if (!LABEL_RE.test(l)) return 'the label "' + l + '" may only use letters, digits, hyphens and underscores and cannot start or end with a hyphen';
    }
    return null;
  }

  function normalizeDomain(input) {
    var s = String(input == null ? '' : input).trim();
    if (!s) return { ok: false, empty: true, error: 'Enter a domain such as example.com.' };
    s = s.replace(/^[a-z][a-z0-9+.\-]*:\/\//i, '').replace(/[\/?#].*$/, '');
    if (s.indexOf('@') >= 0) s = s.slice(s.lastIndexOf('@') + 1);
    s = s.replace(/\.$/, '');
    var a = toAsciiDomain(s);
    if (a == null) return { ok: false, error: code(s) + ' is not a valid domain name.' };
    var p = hostnameProblem(a);
    if (p) return { ok: false, error: code(s) + ' is not a valid domain: ' + escapeHtml(p) + '.' };
    if (a.indexOf('.') < 0) return { ok: false, error: code(s) + ' needs at least two labels, such as example.com.' };
    if (/^[0-9]+$/.test(a.slice(a.lastIndexOf('.') + 1))) return { ok: false, error: code(s) + ' looks like an IP address. Enter a domain name.' };
    return { ok: true, domain: a, idn: a !== s.toLowerCase() };
  }

  // Organizational domain, guessed without the Public Suffix List or DNS:
  // the last two labels, or three under a country code like example.co.uk.
  function orgDomainGuess(host) {
    var labels = String(host || '').toLowerCase().replace(/\.$/, '').split('.');
    if (labels.length <= 2) return labels.join('.');
    var tld = labels[labels.length - 1];
    var sld = labels[labels.length - 2];
    if (tld.length === 2 && SLD_SUFFIX.indexOf(sld) >= 0) return labels.slice(-3).join('.');
    return labels.slice(-2).join('.');
  }

  function sameOrg(a, b) {
    return orgDomainGuess(a) === orgDomainGuess(b);
  }

  // ── IP addresses ──────────────────────────────────────────

  // Dotted quad exactly as RFC 7208's qnum allows: 0-255, no leading zeros.
  function parseIp4(s) {
    var m = /^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/.exec(String(s));
    if (!m) return null;
    var o = [+m[1], +m[2], +m[3], +m[4]];
    for (var i = 0; i < 4; i++) if (o[i] > 255) return null;
    return o;
  }

  function hexGroups(x) {
    if (x === '') return [];
    var g = x.split(':');
    var out = [];
    for (var i = 0; i < g.length; i++) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(g[i])) return null;
      out.push(parseInt(g[i], 16));
    }
    return out;
  }

  // RFC 4291 section 2.2 text forms; returns eight 16-bit groups or null.
  function parseIp6(str) {
    var s = String(str);
    if (!s || !/^[0-9A-Fa-f:.]+$/.test(s)) return null;
    var tail = [];
    if (s.indexOf('.') >= 0) {
      var lc = s.lastIndexOf(':');
      if (lc < 0) return null;
      var v4 = parseIp4(s.slice(lc + 1));
      if (!v4) return null;
      tail = [v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]];
      s = s.slice(0, lc + 1);
      if (s.slice(-2) !== '::') s = s.slice(0, -1);
    }
    var parts = s.split('::');
    if (parts.length > 2) return null;
    var head = hexGroups(parts[0]);
    if (head === null) return null;
    if (parts.length === 2) {
      var back = hexGroups(parts[1]);
      if (back === null) return null;
      var n = head.length + back.length + tail.length;
      if (n > 7) return null;
      var zeros = [];
      for (var z = 0; z < 8 - n; z++) zeros.push(0);
      return head.concat(zeros, back, tail);
    }
    if (head.length + tail.length !== 8) return null;
    return head.concat(tail);
  }

  // RFC 5952 text form: lowercase, longest run of two or more zero groups compressed.
  function formatIp6(g) {
    var bestStart = -1, bestLen = 0, i = 0;
    while (i < 8) {
      if (g[i] === 0) {
        var j = i;
        while (j < 8 && g[j] === 0) j++;
        if (j - i > bestLen && j - i >= 2) { bestStart = i; bestLen = j - i; }
        i = j;
      } else {
        i++;
      }
    }
    var hex = g.map(function (x) { return x.toString(16); });
    if (bestStart < 0) return hex.join(':');
    return hex.slice(0, bestStart).join(':') + '::' + hex.slice(bestStart + bestLen).join(':');
  }

  // CIDR length per RFC 7208's ip4-cidr-length / ip6-cidr-length: no leading zeros.
  function parseCidr(s, max) {
    if (!/^(0|[1-9][0-9]*)$/.test(String(s))) return null;
    var n = +s;
    return n <= max ? n : null;
  }

  function ip4ToStr(n) {
    return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
  }

  function ip4Info(o, prefix) {
    var n = o[0] * 16777216 + o[1] * 65536 + o[2] * 256 + o[3];
    var size = Math.pow(2, 32 - prefix);
    var first = Math.floor(n / size) * size;
    return { first: ip4ToStr(first), last: ip4ToStr(first + size - 1), count: size, hostBits: n !== first, network: ip4ToStr(first) };
  }

  function ip6Info(g, prefix) {
    var net = [];
    for (var i = 0; i < 8; i++) {
      var bits = prefix - 16 * i;
      if (bits >= 16) net.push(g[i]);
      else if (bits <= 0) net.push(0);
      else net.push(g[i] & ((0xffff << (16 - bits)) & 0xffff));
    }
    var changed = net.some(function (x, k) { return x !== g[k]; });
    return { network: formatIp6(net), hostBits: changed, exp: 128 - prefix };
  }

  // ── SPF macros and domain-spec (RFC 7208 section 7) ──────

  function scanMacroString(spec) {
    var out = { errors: [], macros: [], hasMacro: false, endsWithMacro: false, tailStart: 0 };
    var i = 0;
    while (i < spec.length) {
      var ch = spec.charAt(i);
      if (ch === '%') {
        var nx = spec.charAt(i + 1);
        if (nx === '%' || nx === '_' || nx === '-') {
          out.macros.push({ text: '%' + nx, special: nx });
          out.hasMacro = true;
          i += 2;
          out.endsWithMacro = true;
          out.tailStart = i;
          continue;
        }
        if (nx === '{') {
          var close = spec.indexOf('}', i + 2);
          if (close < 0) {
            out.errors.push({ code: 'spf-macro-unclosed', text: spec.slice(i) });
            out.endsWithMacro = false;
            break;
          }
          var text = spec.slice(i, close + 1);
          var mm = /^([A-Za-z])([0-9]*)([rR]?)([.\-+,\/_=]*)$/.exec(spec.slice(i + 2, close));
          if (!mm) {
            out.errors.push({ code: 'spf-macro-bad', text: text });
          } else {
            var letter = mm[1].toLowerCase();
            if (!MACRO_LETTERS[letter]) out.errors.push({ code: 'spf-macro-letter', text: text });
            else if (mm[2] !== '' && +mm[2] === 0) out.errors.push({ code: 'spf-macro-zero', text: text });
            else {
              out.macros.push({
                text: text, letter: letter, upper: mm[1] !== letter,
                digits: mm[2] ? +mm[2] : 0, reverse: !!mm[3], delims: mm[4]
              });
            }
          }
          out.hasMacro = true;
          i = close + 1;
          out.endsWithMacro = true;
          out.tailStart = i;
          continue;
        }
        out.errors.push({ code: 'spf-macro-percent', text: spec.slice(i, i + 2) });
        out.endsWithMacro = false;
        i += 1;
        continue;
      }
      var cc = ch.charCodeAt(0);
      if (cc < 0x21 || cc > 0x7e) out.errors.push({ code: 'spf-char', text: ch });
      out.endsWithMacro = false;
      i += 1;
    }
    return out;
  }

  function isTopLabel(s) {
    return /^[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/.test(s) || /^[A-Za-z0-9]+-[A-Za-z0-9-]*[A-Za-z0-9]$/.test(s);
  }

  function macroErrorIssue(e, t) {
    var where = code(t.raw) + ': ';
    var r = ref('7208', '7.1');
    switch (e.code) {
      case 'spf-macro-unclosed':
        return issue('error', e.code, where + 'the macro ' + code(e.text) + ' is never closed with }.', 'Close it, for example ' + code('%{d}') + '.', r, true);
      case 'spf-macro-letter':
        return issue('error', e.code, where + code(e.text) + ' uses an unknown macro letter.', 'Use one of s, l, o, d, i, p, h, v (and c, r, t only in explanation text).', ref('7208', '7.2'), true);
      case 'spf-macro-zero':
        return issue('error', e.code, where + 'the digit in ' + code(e.text) + ' must be 1 or more.', 'Drop the 0 or use a count such as ' + code('%{d2}') + '.', ref('7208', '7.3'), true);
      case 'spf-macro-percent':
        return issue('error', e.code, where + code(e.text) + ': a % must be followed by {, %, _ or -.', 'Write a literal percent sign as ' + code('%%') + '.', ref('7208', '7.3'), true);
      case 'spf-char':
        return issue('error', e.code, where + 'the character ' + code(e.text) + ' is not allowed here.', 'Use visible US-ASCII characters only.', r, true);
      default:
        return issue('error', e.code, where + 'the macro ' + code(e.text) + ' is malformed.', 'A macro looks like %{letter}, with optional digits, r and delimiters, for example ' + code('%{ir}') + '.', r, true);
    }
  }

  // Validate a domain-spec (include, exists, a, mx, ptr, redirect, exp).
  function checkDomainSpec(t, spec) {
    t.spec = spec;
    var sc = scanMacroString(spec);
    sc.errors.forEach(function (e) { t.issues.push(macroErrorIssue(e, t)); });
    sc.macros.forEach(function (m) {
      t.macros.push(m);
      if (m.letter && 'crt'.indexOf(m.letter) >= 0) {
        t.issues.push(issue('error', 'spf-macro-exp-only', code(t.raw) + ': ' + code(m.text) + ' may only appear in the explanation text that exp= points to, not in a term.', 'Use %{i} for the sending IP, or move the text to the explanation record.', ref('7208', '7.2'), true));
      }
      if (m.letter === 'p') {
        t.issues.push(issue('warning', 'spf-macro-p', code(t.raw) + ': ' + code(m.text) + ' needs reverse-DNS lookups; RFC 7208 says it SHOULD NOT be published.', 'Use ip4/ip6 ranges or a, or %{i}-based exists lookups instead.', ref('7208', '7.3')));
      }
    });
    var endOk = true;
    if (!sc.endsWithMacro && !sc.errors.length) {
      var tail = spec.slice(sc.tailStart).replace(/\.$/, '');
      var dot = tail.lastIndexOf('.');
      var top = dot >= 0 ? tail.slice(dot + 1) : null;
      if (top === null || !isTopLabel(top)) {
        endOk = false;
        if (!sc.hasMacro && parseIp4(spec)) {
          t.issues.push(issue('error', 'spf-target-ip', code(t.raw) + ': ' + code(spec) + ' is an IP address, but this term expects a domain name.', 'Authorize the address with ' + code('ip4:' + spec) + ' instead.', ref('7208', '5.6'), true));
        } else if (top === null) {
          t.issues.push(issue('error', 'spf-domain-end', code(t.raw) + ': ' + code(spec) + ' is not a full domain name (it has no dot).', 'Write the whole name, such as ' + code('_spf.example.com') + '.', ref('7208', '7.1'), true));
        } else {
          t.issues.push(issue('error', 'spf-domain-end', code(t.raw) + ': the last label ' + code(top) + ' is not a valid top-level label (letters and digits with at least one letter, or an IDN xn-- label).', 'Check the domain for typos.', ref('7208', '7.1'), true));
        }
      }
    }
    if (!sc.hasMacro) {
      var lit = spec.replace(/\.$/, '').toLowerCase();
      t.target = lit;
      if (endOk && !sc.errors.length) {
        var p = hostnameProblem(lit);
        if (p) {
          t.issues.push(issue('warning', 'spf-domain-malformed', code(t.raw) + ': ' + code(spec) + ' is not a usable host name: ' + escapeHtml(p) + '. Receivers return none for it, which an include turns into permerror.', 'Fix the name.', ref('7208', '4.3')));
        }
      }
    }
    if (/\.$/.test(spec) && spec.length > 1) {
      t.issues.push(issue('info', 'spf-trailing-dot', code(t.raw) + ': the trailing dot is valid, but RFC 7208 says trailing dots SHOULD NOT be published because some older checkers reject them.', 'Remove the final dot.', ref('7208', '7.3')));
    }
  }

  // ── SPF terms ─────────────────────────────────────────────

  function checkCidr(t, s, max, fam) {
    var n = parseCidr(s, max);
    if (n == null) {
      t.issues.push(issue('error', 'spf-cidr-bad', code(t.raw) + ': ' + code('/' + s) + ' is not a valid ' + fam + ' prefix length (0–' + max + ', no leading zeros).', 'Use a prefix such as /' + (max === 32 ? '24' : '64') + '.', ref('7208', '5.6'), true));
    }
    return n;
  }

  function parseTerm(raw) {
    var t = {
      raw: raw, kind: 'mechanism', qualifier: '', name: '', spec: null, target: null,
      cidr4: null, cidr6: null, net: null, issues: [], macros: [], counts: false, afterAll: false, ignored: false
    };
    var mm = /^([A-Za-z][A-Za-z0-9_.\-]*)=([\s\S]*)$/.exec(raw);
    if (mm) {
      t.kind = 'modifier';
      t.name = mm[1].toLowerCase();
      if (t.name === 'redirect' || t.name === 'exp') {
        if (mm[2] === '') {
          t.issues.push(issue('error', 'spf-missing-domain', code(raw) + ': ' + t.name + '= needs a domain name.', 'Write ' + code(t.name + '=_spf.example.com') + ' or remove the term.', ref('7208', t.name === 'redirect' ? '6.1' : '6.2'), true));
        } else {
          checkDomainSpec(t, mm[2]);
        }
        return t;
      }
      t.kind = 'unknown-modifier';
      t.spec = mm[2];
      var sc = scanMacroString(mm[2]);
      sc.errors.forEach(function (e) { t.issues.push(macroErrorIssue(e, t)); });
      t.macros = sc.macros;
      if (t.name === 'v' && /^spf1$/i.test(mm[2])) {
        t.issues.push(issue('warning', 'spf-merged', code(raw) + ' appears inside the record: two SPF records were probably merged into one TXT string. Receivers read the second v=spf1 as an unknown modifier and ignore it, but the terms after it still count.', 'Rebuild one record with each mechanism listed once and a single all at the end.', ref('7208', '3.2')));
      } else if (SPF_MECHANISMS.indexOf(t.name) >= 0) {
        t.issues.push(issue('warning', 'spf-modifier-typo', code(raw) + ' is read as an unknown modifier (name=value) and ignored, so it authorizes nothing.', 'Mechanisms take a colon: ' + code(t.name + ':' + mm[2]) + '.', ref('7208', '4.6.1')));
      } else {
        var sg = suggest(t.name, ['redirect', 'exp']);
        t.issues.push(issue(sg ? 'warning' : 'info', 'spf-unknown-modifier', code(raw) + ' is not a modifier RFC 7208 defines; receivers ignore unknown modifiers.', sg ? 'Did you mean ' + code(sg + '=' + mm[2]) + '?' : 'Remove it unless another specification you rely on defines it.', ref('7208', '6')));
      }
      return t;
    }
    var body = raw;
    if (/^[+\-~?]/.test(body)) {
      t.qualifier = body.charAt(0);
      body = body.slice(1);
    }
    var nm = /^([A-Za-z0-9]*)([\s\S]*)$/.exec(body);
    t.name = nm[1].toLowerCase();
    var rest = nm[2];
    if (SPF_MECHANISMS.indexOf(t.name) < 0) {
      t.kind = 'unknown';
      var hint;
      if (t.name === 'redirect' || t.name === 'exp') {
        hint = code(t.name) + ' is a modifier and takes an equals sign without a qualifier: ' + code(t.name + '=' + rest.replace(/^:/, '')) + '.';
      } else if (t.name === 'ip') {
        hint = 'Use ' + code('ip4:') + ' or ' + code('ip6:') + '.';
      } else {
        var sm = t.name ? suggest(t.name, SPF_MECHANISMS) : null;
        hint = sm ? 'Did you mean ' + code((t.qualifier || '') + sm + rest) + '?' : 'Valid mechanisms are all, include, a, mx, ptr, ip4, ip6 and exists.';
      }
      t.issues.push(issue('error', 'spf-unknown-mechanism', code(raw) + ' is not an SPF mechanism or modifier. A record with an unknown mechanism is a syntax error, so receivers return permerror for every message.', hint, ref('7208', '4.6.1'), true));
      return t;
    }
    switch (t.name) {
      case 'all':
        if (rest !== '') {
          t.issues.push(issue('error', 'spf-all-arg', code(raw) + ': all takes no domain or prefix.', 'Write just ' + code((t.qualifier || '~') + 'all') + '.', ref('7208', '5.1'), true));
        }
        break;
      case 'include':
      case 'exists':
        if (rest.charAt(0) !== ':' || rest.length < 2) {
          t.issues.push(issue('error', 'spf-missing-domain', code(raw) + ': ' + t.name + ' needs a domain after a colon.', 'Write it as ' + code(t.name + ':_spf.example.com') + '.', ref('7208', t.name === 'include' ? '5.2' : '5.7'), true));
        } else {
          checkDomainSpec(t, rest.slice(1));
        }
        break;
      case 'a':
      case 'mx': {
        var cm = /^([\s\S]*?)(?:\/([0-9]+))?(?:\/\/([0-9]+))?$/.exec(rest);
        var head = cm[1];
        if (cm[2] != null) t.cidr4 = checkCidr(t, cm[2], 32, 'IPv4');
        if (cm[3] != null) t.cidr6 = checkCidr(t, cm[3], 128, 'IPv6');
        if (head === '') {
          // the domain being evaluated
        } else if (head.charAt(0) === ':') {
          if (head.length === 1) {
            t.issues.push(issue('error', 'spf-missing-domain', code(raw) + ': the colon must be followed by a domain.', 'Write ' + code(t.name) + ' alone for this domain, or ' + code(t.name + ':mail.example.com') + '.', ref('7208', t.name === 'a' ? '5.3' : '5.4'), true));
          } else {
            checkDomainSpec(t, head.slice(1));
          }
        } else {
          t.issues.push(issue('error', 'spf-bad-syntax', code(raw) + ' is malformed: after ' + t.name + ' comes :domain, /prefix for IPv4 or //prefix for IPv6.', 'For example ' + code(t.name + '/24') + ' or ' + code(t.name + ':mail.example.com/24//64') + '.', ref('7208', '5.6'), true));
        }
        break;
      }
      case 'ptr':
        if (rest !== '') {
          if (rest.charAt(0) === ':' && rest.length > 1) checkDomainSpec(t, rest.slice(1));
          else t.issues.push(issue('error', 'spf-bad-syntax', code(raw) + ' is malformed: ptr takes an optional :domain and no prefix.', 'Better: remove ptr and list the addresses with ip4/ip6.', ref('7208', '5.5'), true));
        }
        t.issues.push(issue('warning', 'spf-ptr', code(raw) + ': RFC 7208 says ptr SHOULD NOT be published. It is slow, fails on DNS errors, burdens the reverse-DNS servers, and some receivers skip it.', 'List the servers with ip4/ip6 (or a) instead.', ref('7208', '5.5')));
        break;
      case 'ip4':
      case 'ip6':
        checkIpTerm(t, rest);
        break;
    }
    return t;
  }

  function checkIpTerm(t, rest) {
    var v4 = t.name === 'ip4';
    var im = /^:([^\/]*)(?:\/([\s\S]*))?$/.exec(rest);
    var r56 = ref('7208', '5.6');
    if (!im || im[1] === '') {
      t.issues.push(issue('error', 'spf-ip-missing', code(t.raw) + ': ' + t.name + ' needs an address after a colon.', 'For example ' + code(v4 ? 'ip4:192.0.2.10' : 'ip6:2001:db8::10') + '.', r56, true));
      return;
    }
    var addr = im[1];
    var max = v4 ? 32 : 128;
    var prefix = max;
    if (im[2] != null) {
      prefix = checkCidr(t, im[2], max, v4 ? 'IPv4' : 'IPv6');
      if (prefix == null) return;
    }
    if (v4) {
      var o = parseIp4(addr);
      if (!o) {
        if (parseIp6(addr)) {
          t.issues.push(issue('error', 'spf-ip4-is-ip6', code(t.raw) + ': ' + code(addr) + ' is an IPv6 address.', 'Use ' + code('ip6:' + addr + (im[2] != null ? '/' + im[2] : '')) + '.', r56, true));
        } else if (/^[0-9]+(\.[0-9]+){0,2}\.?$/.test(addr)) {
          t.issues.push(issue('error', 'spf-ip4-short', code(t.raw) + ': all four parts of the address are required; leaving parts out is not allowed.', 'Write a range with a prefix instead, for example ' + code('ip4:192.0.2.0/24') + ' rather than ' + code('ip4:192.0.2') + '.', r56, true));
        } else if (/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(addr)) {
          t.issues.push(issue('error', 'spf-ip4-range', code(t.raw) + ': each part of an IPv4 address must be 0–255, written without leading zeros.', 'Check ' + code(addr) + ' for typos.', r56, true));
        } else {
          t.issues.push(issue('error', 'spf-ip4-bad', code(t.raw) + ': ' + code(addr) + ' is not an IPv4 address.', 'ip4 takes a dotted address such as 192.0.2.10 or a range such as 192.0.2.0/24; use a: for host names.', r56, true));
        }
        return;
      }
      var info = ip4Info(o, prefix);
      t.net = { family: 4, addr: addr, prefix: prefix, first: info.first, last: info.last, count: info.count, network: info.network };
      if (info.hostBits && prefix < 32) {
        t.issues.push(issue('info', 'spf-ip-hostbits', code(t.raw) + ' is valid, but only the first ' + prefix + ' bits are compared, so it covers the whole network ' + code(info.network + '/' + prefix) + '.', 'Write ' + code('ip4:' + info.network + '/' + prefix) + ' to make that obvious, or ' + code('ip4:' + addr) + ' for the single address.', r56));
      }
    } else {
      var g = parseIp6(addr);
      if (!g) {
        if (parseIp4(addr)) {
          t.issues.push(issue('error', 'spf-ip6-is-ip4', code(t.raw) + ': ' + code(addr) + ' is an IPv4 address.', 'Use ' + code('ip4:' + addr + (im[2] != null ? '/' + im[2] : '')) + '.', r56, true));
        } else {
          t.issues.push(issue('error', 'spf-ip6-bad', code(t.raw) + ': ' + code(addr) + ' is not a valid IPv6 address (RFC 4291 text form, at most one ::, no zone such as %eth0).', 'For example ' + code('ip6:2001:db8::/32') + '.', r56, true));
        }
        return;
      }
      var i6 = ip6Info(g, prefix);
      t.net = { family: 6, addr: addr, prefix: prefix, network: i6.network, exp: i6.exp };
      if (i6.hostBits) {
        t.issues.push(issue('info', 'spf-ip-hostbits', code(t.raw) + ' is valid, but only the first ' + prefix + ' bits are compared, so it covers the whole network ' + code(i6.network + '/' + prefix) + '.', 'Write ' + code('ip6:' + i6.network + '/' + prefix) + ' to make that obvious.', r56));
      }
    }
    if (prefix === 0) {
      t.issues.push(issue('error', 'spf-ip-everything', code(t.raw) + ' authorizes every ' + (v4 ? 'IPv4' : 'IPv6') + ' address on the Internet, which is as open as +all.', 'List only your own servers and ranges.', r56));
    } else if ((v4 && prefix < 8) || (!v4 && prefix < 24)) {
      t.issues.push(issue('warning', 'spf-ip-wide', code(t.raw) + ' authorizes a very large range. RFC 9989 asks domain owners to review broad SPF ranges before relying on DMARC.', 'Narrow it to the networks your mail really leaves from.', ref('9989', '7.1')));
    }
  }

  function isSpfRecord(value) {
    return /^v=spf1(?: |$)/i.test(String(value));
  }

  function parseSpf(value) {
    var v = String(value == null ? '' : value);
    var res = {
      value: v, isSpf: isSpfRecord(v), terms: [], issues: [], allIndex: -1, allQualifier: null,
      redirect: null, exp: null, ownLookups: 0, permerror: false, length: v.length
    };
    var add = function (lvl, id, msg, fix, r, perm) { res.issues.push(issue(lvl, id, msg, fix, r, perm)); };
    if (!res.isSpf) {
      add('error', 'spf-not-spf', 'This is not an SPF record: it must start with exactly ' + code('v=spf1') + ' followed by a space or the end of the record.', 'Start the record with ' + code('v=spf1 ') + '.', ref('7208', '4.5'), true);
      res.permerror = true;
      return res;
    }
    if (v.slice(0, 6) !== 'v=spf1') {
      add('info', 'spf-version-case', code(v.slice(0, 6)) + ' matches because SPF names are case-insensitive, but lowercase ' + code('v=spf1') + ' is what every checker expects.', 'Write ' + code('v=spf1') + '.', ref('7208', '12'));
    }
    var body = v.slice(6);
    if (!isAscii(body)) {
      add('error', 'spf-non-ascii', 'The record contains characters outside US-ASCII. SPF records are US-ASCII only.', 'Use A-labels (xn--…) for international domain names.', ref('7208', '3.1'), true);
    }
    if (/[\t\r\n\f\v]/.test(body)) {
      add('error', 'spf-whitespace', 'Terms are separated by something other than plain spaces (a tab or line break). Only spaces separate SPF terms.', 'Put one space between terms, on a single line.', ref('7208', '4.6.1'), true);
    }
    var tokens = body.split(/[ \t\r\n\f\v]+/).filter(Boolean);
    var seenAll = false;
    var seenRaw = {};
    tokens.forEach(function (raw, i) {
      var t = parseTerm(raw);
      t.index = i;
      if (t.kind === 'mechanism') {
        if (seenAll) {
          t.afterAll = true;
          t.ignored = true;
        } else {
          if (SPF_LOOKUP[t.name]) t.counts = true;
          if (t.name === 'all') {
            seenAll = true;
            res.allIndex = i;
            res.allQualifier = t.qualifier || '+';
          }
        }
      }
      var key = raw.toLowerCase();
      if (seenRaw[key] && t.kind === 'mechanism' && !t.afterAll) {
        add('warning', 'spf-duplicate', code(raw) + ' is listed more than once.' + (SPF_LOOKUP[t.name] ? ' Each copy costs another DNS lookup.' : ''), 'Remove the duplicate.', ref('7208', '10.1.1'));
      }
      seenRaw[key] = true;
      res.terms.push(t);
      t.issues.forEach(function (x) { res.issues.push(x); });
    });
    var redirects = res.terms.filter(function (t) { return t.kind === 'modifier' && t.name === 'redirect'; });
    var exps = res.terms.filter(function (t) { return t.kind === 'modifier' && t.name === 'exp'; });
    if (redirects.length > 1) add('error', 'spf-redirect-twice', 'redirect= appears ' + redirects.length + ' times; it may appear at most once.', 'Keep one redirect.', ref('7208', '6'), true);
    if (exps.length > 1) add('error', 'spf-exp-twice', 'exp= appears ' + exps.length + ' times; it may appear at most once.', 'Keep one exp.', ref('7208', '6'), true);
    res.redirect = redirects[0] || null;
    res.exp = exps[0] || null;
    if (res.redirect) {
      if (res.allIndex >= 0) {
        res.redirect.ignored = true;
        add('warning', 'spf-redirect-with-all', code(res.redirect.raw) + ' is ignored because the record also has ' + code(res.terms[res.allIndex].raw) + ': with an all mechanism anywhere in the record, redirect never runs.', 'Remove one of them: keep redirect to hand the decision to ' + code(res.redirect.spec || '') + ', or keep all and drop redirect.', ref('7208', '6.1'));
      } else {
        res.redirect.counts = true;
      }
    }
    redirects.slice(1).forEach(function (t) { t.ignored = true; });
    var after = res.terms.filter(function (t) { return t.afterAll; });
    if (after.length) {
      add('warning', 'spf-after-all', plural(after.length, 'mechanism') + ' after ' + code(res.terms[res.allIndex].raw) + ' will never be evaluated: ' + after.map(function (t) { return code(t.raw); }).join(' ') + '.', 'Move them before all, or remove them.', ref('7208', '5.1'));
    }
    var mechs = res.terms.filter(function (t) { return t.kind === 'mechanism'; });
    if (!tokens.length) {
      add('warning', 'spf-empty', code('v=spf1') + ' with no terms gives every sender a neutral result, the same as having no SPF policy.', 'List your senders and end with ' + code('~all') + ' or ' + code('-all') + '; for a domain that sends no mail use ' + code('v=spf1 -all') + '.', ref('7208', '4.7'));
    } else if (res.allIndex < 0 && !res.redirect) {
      add('warning', 'spf-no-all', 'The record has no all mechanism and no redirect, so a sender that matches nothing gets neutral, as if it ended in ' + code('?all') + '.', 'End the record with ' + code('~all') + ' or ' + code('-all') + '.', ref('7208', '4.7'));
    }
    if (res.allQualifier === '+') {
      add('error', 'spf-plus-all', code(res.terms[res.allIndex].raw) + ' gives pass to every server on the Internet. The syntax is valid, but anyone can send mail that passes SPF for this domain.', 'Use ' + code('~all') + ' or ' + code('-all') + '.', ref('7208', '5.1'));
    } else if (res.allQualifier === '?' && mechs.length === 1 && !res.redirect) {
      add('warning', 'spf-neutral-only', code('?all') + ' with no other mechanisms says nothing about any server: every sender gets neutral, the same as no SPF policy.', 'List your senders before all and use ' + code('~all') + ' or ' + code('-all') + '.', ref('7208', '8.2'));
    }
    var lastMech = -1;
    res.terms.forEach(function (t, i) { if (t.kind === 'mechanism' || t.kind === 'unknown') lastMech = i; });
    var early = res.terms.filter(function (t, i) { return (t.name === 'redirect' || t.name === 'exp') && t.kind === 'modifier' && i < lastMech; });
    if (early.length) {
      add('info', 'spf-modifier-order', early.map(function (t) { return code(t.raw); }).join(' ') + ' should come after all mechanisms. It still works, but redirect and exp are expected at the end.', 'Move ' + (early.length > 1 ? 'them' : 'it') + ' to the end of the record.', ref('7208', '6'));
    }
    if (v.length > 450) {
      add('warning', 'spf-long', 'The record is ' + v.length + ' characters long. RFC 7208 advises keeping the DNS name plus all TXT records at that name under 450 octets so answers fit into one UDP packet.', 'Shorten it: move services to includes they maintain, or drop unused entries.', ref('7208', '3.4'));
    }
    res.terms.forEach(function (t) { if (t.counts) res.ownLookups += 1; });
    res.permerror = res.issues.some(function (x) { return x.perm; });
    return res;
  }

  function macroListHtml(macros) {
    var seen = {};
    var parts = [];
    macros.forEach(function (m) {
      if (m.special) {
        var sp = { '%': 'a literal %', '_': 'a space', '-': 'a URL-encoded space (%20)' }[m.special];
        if (!seen[m.text]) parts.push(code(m.text) + ' = ' + sp);
      } else if (!seen[m.text]) {
        var extra = [];
        if (m.reverse) extra.push('reversed');
        if (m.digits) extra.push('rightmost ' + m.digits + ' part' + (m.digits > 1 ? 's' : ''));
        if (m.delims) extra.push('split on ' + escapeHtml(m.delims));
        if (m.upper) extra.push('URL-escaped');
        parts.push(code(m.text) + ' = ' + escapeHtml(MACRO_LETTERS[m.letter]) + (extra.length ? ' (' + extra.join(', ') + ')' : ''));
      }
      seen[m.text] = true;
    });
    return parts.length ? ' Macros: ' + parts.join('; ') + '. The name is built per message, so it cannot be checked or counted ahead.' : '';
  }

  // Plain-language explanation of one SPF term (HTML).
  function explainTerm(t, dom) {
    var here = dom ? code(dom) : 'the domain this record belongs to';
    var res = QUAL_RESULT[t.qualifier || '+'];
    var onMatch = ' If it matches, the result is <strong>' + res + '</strong>' + (t.qualifier ? '' : ' (no qualifier means +)') + '.';
    var target = t.spec != null ? code(t.spec) : here;
    var macros = macroListHtml(t.macros);
    if (t.afterAll) return 'Never evaluated: it comes after all.';
    switch (t.kind) {
      case 'unknown':
        return 'Not a valid SPF term: the whole record fails with permerror.';
      case 'unknown-modifier':
        if (t.name === 'v') return 'A second version tag: SPF reads it as an unknown modifier and ignores it.';
        return 'Unknown modifier: receivers ignore it.' + macros;
      case 'modifier':
        if (t.name === 'redirect') {
          if (t.ignored) return 'Ignored: the record has an all mechanism, or this is a second redirect.';
          return 'If no mechanism matched, receivers evaluate the SPF record of ' + target + ' instead and use its result. If that name has no SPF record, the result is permerror. Counts as 1 DNS lookup.' + macros;
        }
        return 'If the result is fail, receivers may fetch the TXT record at ' + target + ' and quote it in the rejection. Not counted toward the 10 lookups.' + macros;
      default:
        break;
    }
    switch (t.name) {
      case 'all':
        if (res === 'fail') return 'Every other sender gets <strong>fail</strong>: not authorized. Receivers may reject the message right away, before DMARC runs.';
        if (res === 'softfail') return 'Every other sender gets <strong>softfail</strong>: probably not authorized. Receivers SHOULD NOT reject on this alone but may treat the message as suspicious; with DMARC, the DMARC result decides.';
        if (res === 'neutral') return 'Every other sender gets <strong>neutral</strong>: no statement either way, treated like having no SPF policy.';
        return 'Every sender on the Internet gets <strong>pass</strong>: this authorizes everyone.';
      case 'include':
        return 'Asks the SPF record of ' + target + ' about the sender. Only a pass there makes this term match; a fail, softfail or neutral there just means "no match" and checking moves on. If ' + target + ' has no SPF record, the result is permerror. Costs 1 lookup plus the lookups inside that record.' + onMatch + macros;
      case 'a': {
        var ca = cidrText(t);
        return 'Matches if the sender\'s IP is one of the A/AAAA addresses of ' + target + ca + '. Costs 1 DNS lookup.' + onMatch + macros;
      }
      case 'mx': {
        var cx = cidrText(t);
        return 'Matches if the sender is one of the mail servers in the MX records of ' + target + ' (their A/AAAA addresses' + cx + '). Costs 1 lookup; resolving more than 10 MX hosts gives permerror. Mail servers that receive mail do not always send it.' + onMatch + macros;
      }
      case 'ptr':
        return 'Matches if the reverse-DNS name of the sending IP (confirmed by a forward lookup) is ' + target + ' or ends with it. Costs 1 lookup. Do not use: slow and unreliable.' + onMatch + macros;
      case 'exists':
        return 'Builds the name ' + target + ' for each message and matches if it has an A record. Used for per-IP or per-sender allow lists. Costs 1 lookup.' + onMatch + macros;
      case 'ip4':
      case 'ip6':
        return ipText(t) + ' No DNS lookup.' + onMatch;
      default:
        return '';
    }
  }

  function cidrText(t) {
    var parts = [];
    if (t.cidr4 != null) parts.push('or any IPv4 address in the same /' + t.cidr4);
    if (t.cidr6 != null) parts.push('any IPv6 address in the same /' + t.cidr6);
    return parts.length ? ', ' + parts.join(', ') : '';
  }

  function ipText(t) {
    var n = t.net;
    if (!n) return 'Invalid address.';
    if (n.family === 4) {
      if (n.count === 1) return 'Matches the single IPv4 address ' + code(n.first) + '.';
      return 'Matches ' + fmtInt(n.count) + ' IPv4 addresses, ' + code(n.first) + ' to ' + code(n.last) + '.';
    }
    if (n.prefix === 128) return 'Matches the single IPv6 address ' + code(n.network) + '.';
    return 'Matches the IPv6 network ' + code(n.network + '/' + n.prefix) + ' (2<sup>' + n.exp + '</sup> addresses).';
  }

  // ── SPF lookup counting across pasted records ─────────────

  // recMap: domain -> { records: [parsedSpf, ...] }
  function analyzeSpfTree(root, recMap) {
    var unresolved = [], dynamic = [], loops = [], broken = [];
    function walk(domain, stack, via) {
      var group = recMap[domain];
      var node = { domain: domain, via: via || null, own: 0, total: 0, children: [], missing: !group, loop: false };
      if (!group) return node;
      var rec = group.records[0];
      if (stack.length > 1 && (rec.permerror || group.records.length > 1)) broken.push({ domain: domain, via: via });
      rec.terms.forEach(function (t) {
        if (!t.counts) return;
        node.own += 1;
        if (t.name !== 'include' && t.name !== 'redirect') return;
        if (!t.target) {
          if (t.spec) dynamic.push({ from: domain, term: t.raw });
          return;
        }
        if (stack.indexOf(t.target) >= 0) {
          loops.push(stack.concat([t.target]));
          node.children.push({ domain: t.target, via: t.raw, own: 0, total: 0, children: [], missing: false, loop: true });
          return;
        }
        var ch = walk(t.target, stack.concat([t.target]), t.raw);
        if (ch.missing) unresolved.push({ from: domain, term: t.raw, domain: t.target });
        node.children.push(ch);
      });
      node.total = node.own + node.children.reduce(function (s, c) { return s + c.total; }, 0);
      return node;
    }
    var tree = walk(root, [root], null);
    return {
      tree: tree, total: tree.total,
      exact: !unresolved.length && !dynamic.length && !loops.length,
      unresolved: unresolved, dynamic: dynamic, loops: loops, broken: broken
    };
  }

  function lookupIssues(lk) {
    var out = [];
    var r = ref('7208', '4.6.4');
    var n = lk.total;
    var fix = 'Remove includes for services you no longer use, move bulk or marketing mail to its own subdomain with its own SPF record, and replace a and mx with ip4/ip6 where the addresses rarely change.';
    if (n > SPF_LIMIT) {
      out.push(issue('error', 'spf-too-many-lookups', (lk.exact ? 'Evaluating this record takes ' : 'Evaluating this record takes at least ') + n + ' DNS lookups (include, a, mx, ptr, exists and redirect, nested includes too). Receivers stop at 10 and return permerror, so SPF fails for every message that reaches the limit.', fix, r, true));
    } else if (n === SPF_LIMIT) {
      if (lk.exact) out.push(issue('info', 'spf-at-limit', 'Exactly 10 DNS lookups: valid, but there is no room left. One more include, or a provider adding one to its own record, breaks SPF.', fix, r));
      else out.push(issue('warning', 'spf-at-limit-unknown', 'Already 10 DNS lookups before counting what the includes below need, so any lookup inside them pushes it over the limit.', 'Paste the included records to get the exact count. ' + fix, r));
    }
    if (lk.loops.length) {
      out.push(issue('error', 'spf-loop', 'The includes or redirects form a loop: ' + lk.loops.map(function (l) { return l.map(code).join(' → '); }).join('; ') + '. Evaluation never ends on its own, so receivers hit the lookup limit and return permerror.', 'Remove the include or redirect that points back.', r, true));
    }
    lk.broken.forEach(function (b) {
      out.push(issue('error', 'spf-nested-permerror', code(b.via) + ' points to ' + code(b.domain) + ', whose record has errors (see below). An include of a broken record returns permerror for every message that reaches it.', 'Fix that record, or ask its owner to.', ref('7208', '5.2')));
    });
    if (lk.unresolved.length) {
      var uniq = [];
      lk.unresolved.forEach(function (u) { if (uniq.indexOf(u.domain) < 0) uniq.push(u.domain); });
      out.push(issue('info', 'spf-unresolved', 'Not pasted, so not counted yet: ' + uniq.map(code).join(', ') + '. Each of them already counts as 1 lookup here; whatever their own records include comes on top.', 'Look them up with ' + code('dig +short TXT ' + uniq[0]) + ' (Windows: ' + code('nslookup -type=TXT ' + uniq[0]) + ') and paste each result under its name.', r));
    }
    if (lk.dynamic.length) {
      out.push(issue('info', 'spf-dynamic', 'Targets built from macros cannot be counted ahead: ' + lk.dynamic.map(function (d) { return code(d.term); }).join(', ') + '.', '', ref('7208', '7')));
    }
    return out;
  }

  // ── TXT input parsing ─────────────────────────────────────

  // Parse TXT RDATA: one or more "quoted" strings (joined without spaces, RFC 7208 §3.3)
  // or a bare value.
  function parseTxtRdata(rdata) {
    var s = String(rdata == null ? '' : rdata).trim();
    var res = { strings: [], quoted: false, issues: [] };
    if (s.charAt(0) !== '"') {
      res.strings = [s];
      return res;
    }
    res.quoted = true;
    var i = 0;
    while (i < s.length) {
      while (i < s.length && /[ \t]/.test(s.charAt(i))) i++;
      if (i >= s.length) break;
      var c0 = s.charAt(i);
      if (c0 === ';') break;
      if (c0 !== '"') {
        res.issues.push({ code: 'txt-trailing', text: s.slice(i) });
        break;
      }
      i++;
      var buf = '';
      var closed = false;
      while (i < s.length) {
        var ch = s.charAt(i);
        if (ch === '\\') {
          var d = /^[0-9]{3}/.exec(s.slice(i + 1, i + 4));
          if (d) {
            buf += String.fromCharCode(+d[0]);
            i += 4;
            continue;
          }
          if (i + 1 < s.length) {
            buf += s.charAt(i + 1);
            i += 2;
            continue;
          }
          i++;
          continue;
        }
        if (ch === '"') {
          closed = true;
          i++;
          break;
        }
        buf += ch;
        i++;
      }
      res.strings.push(buf);
      if (!closed) {
        res.issues.push({ code: 'txt-unclosed' });
        break;
      }
    }
    return res;
  }

  // Change in parenthesis depth outside quotes (zone-file multi-line records).
  function parenDelta(line) {
    var d = 0, q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '\\') { i++; continue; }
      if (c === '"') q = !q;
      else if (!q && c === ';') break;
      else if (!q && c === '(') d++;
      else if (!q && c === ')') d--;
    }
    return d;
  }

  function stripParens(line) {
    var out = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '\\' && q) { out += c + line.charAt(i + 1); i++; continue; }
      if (c === '"') q = !q;
      if (!q && (c === '(' || c === ')')) { out += ' '; continue; }
      out += c;
    }
    return out;
  }

  function looksLikeDomain(x) {
    if (x === '@') return true;
    if (/^_[A-Za-z0-9_\-]+$/.test(x)) return true;   // relative names such as _dmarc
    if (!/^[A-Za-z0-9_*][A-Za-z0-9_.*\-]*\.?$/.test(x)) return false;
    return x.replace(/\.$/, '').indexOf('.') > 0;
  }

  function normName(name, def) {
    if (name == null) return null;
    var s = String(name).trim();
    if (s === '@') return def || null;
    var abs = /\.$/.test(s);
    s = toAsciiDomain(s.replace(/\.$/, '')) || s.toLowerCase();
    if (!abs && def && s.indexOf('.') < 0) s = s + '.' + def;
    return s;
  }

  var NOISE_RE = /^(server|address|addresses|aliases|name|non-authoritative answer|authoritative answers can be found from)\s*:?/i;
  var ZONE_NONAME_RE = /^(?:(?:[0-9]+[smhdwSMHDW]?|IN)\s+){0,2}TXT\s+([\s\S]*)$/i;
  var ZONE_RE = /^(\S+)\s+(?:(?:[0-9]+[smhdwSMHDW]?|IN|CH|HS)\s+){0,2}TXT\s+([\s\S]*)$/i;
  var NSLOOKUP_RE = /^(\S+)\s+text\s*=\s*([\s\S]*)$/i;

  function parseRecordsInput(text, def) {
    var raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var logical = [];
    var buf = null, depth = 0;
    raw.forEach(function (ln, idx) {
      if (buf) {
        buf.text += ' ' + ln;
        depth += parenDelta(ln);
        if (depth <= 0) { logical.push(buf); buf = null; depth = 0; }
        return;
      }
      var d = parenDelta(ln);
      if (d > 0) { buf = { text: ln, line: idx + 1 }; depth = d; return; }
      logical.push({ text: ln, line: idx + 1 });
    });
    if (buf) logical.push(buf);

    var entries = [], ignored = [];
    var label = null;
    var pending = null;

    function add(domain, rdata, line, source) {
      var p = parseTxtRdata(rdata);
      entries.push({
        domain: domain, value: p.strings.join(''), strings: p.strings, quoted: p.quoted,
        rdataIssues: p.issues, line: line, source: source
      });
    }
    function flush() {
      if (pending) {
        if (pending.strings.length) {
          entries.push({ domain: pending.domain, value: pending.strings.join(''), strings: pending.strings, quoted: true, rdataIssues: pending.issues, line: pending.line, source: 'nslookup' });
        }
        pending = null;
      }
    }

    logical.forEach(function (l) {
      var s = stripParens(l.text).trim();
      var m;
      if (!s) return;
      if (s.charAt(0) === ';' || s.charAt(0) === '#' || s.charAt(0) === '$') { flush(); return; }
      if (s.charAt(0) === '"') {
        if (pending) {
          var pr = parseTxtRdata(s);
          pending.strings = pending.strings.concat(pr.strings);
          pending.issues = pending.issues.concat(pr.issues);
          return;
        }
        add(label, s, l.line, 'quoted');
        return;
      }
      flush();
      if ((m = ZONE_NONAME_RE.exec(s))) { add(label, m[1], l.line, 'zone'); return; }
      if ((m = ZONE_RE.exec(s))) {
        label = normName(m[1], def);
        add(label, m[2], l.line, 'zone');
        return;
      }
      if ((m = NSLOOKUP_RE.exec(s))) {
        label = normName(m[1], def);
        pending = { domain: label, strings: [], issues: [], line: l.line };
        if (m[2].trim()) {
          var p2 = parseTxtRdata(m[2]);
          pending.strings = p2.strings;
          pending.issues = p2.issues;
        }
        return;
      }
      if (NOISE_RE.test(s)) return;
      if ((m = /^(\S+?)\s*:\s*([\s\S]*)$/.exec(s)) && looksLikeDomain(m[1])) {
        label = normName(m[1], def);
        if (m[2].trim()) add(label, m[2], l.line, 'labelled');
        return;
      }
      if ((m = /^(\S+)\s+((?:v\s*=|")[\s\S]*)$/i.exec(s)) && looksLikeDomain(m[1])) {
        label = normName(m[1], def);
        add(label, m[2], l.line, 'labelled');
        return;
      }
      if (looksLikeDomain(s)) { label = normName(s, def); return; }
      if (/^v\s*=/i.test(s)) { add(label, s, l.line, 'raw'); return; }
      ignored.push({ line: l.line, text: s });
    });
    flush();
    return { entries: entries, ignored: ignored };
  }

  function isDmarcLike(v) {
    return /^v[ \t]*=[ \t]*dmarc/i.test(String(v));
  }

  var AUTH_RE = /^(.+)\._report\._dmarc\.(.+)$/;

  function classifyTxt(value, name) {
    var v = String(value == null ? '' : value);
    if (name && AUTH_RE.test(name) && isDmarcLike(v.trim())) return 'dmarc-auth';
    if (isSpfRecord(v)) return 'spf';
    if (isDmarcLike(v)) return 'dmarc';
    if (/^[ \t]+(v=spf1|v[ \t]*=[ \t]*dmarc)/i.test(v)) return 'leading-space';
    if (/^spf2\.0\//i.test(v)) return 'senderid';
    if (/^v=spf/i.test(v)) return 'spf-other';
    return 'other';
  }

  // ── DMARC (RFC 9989) ──────────────────────────────────────

  function parseFo(value) {
    var res = { ok: true, parts: [], error: '', spaces: false };
    var seen = {};
    var bits = String(value).split(':');
    for (var i = 0; i < bits.length; i++) {
      var b = trimWsp(bits[i]);
      if (b !== bits[i]) res.spaces = true;
      var lb = b.toLowerCase();
      if (['0', '1', 'd', 's'].indexOf(lb) < 0) {
        res.ok = false;
        res.error = (b === '' ? 'an empty value' : code(b)) + ' is not a failure-reporting option (0, 1, d or s, separated by colons).';
        return res;
      }
      if (seen[lb]) {
        res.ok = false;
        res.error = code(b) + ' is listed twice.';
        return res;
      }
      seen[lb] = true;
      res.parts.push(lb);
    }
    if (seen['0'] && seen['1']) {
      res.ok = false;
      res.error = '0 and 1 are mutually exclusive: 0 reports when all mechanisms fail, 1 when any fails.';
    }
    return res;
  }

  function parseDmarcUri(raw) {
    var u = { raw: raw, ok: false, scheme: null, address: null, host: null, size: null, issues: [] };
    var r = ref('9989', '4.8');
    var s = raw;
    var sm = /^([\s\S]*?)!([0-9]+)([kmgtKMGT]?)$/.exec(s);
    if (sm) {
      u.size = sm[2] + sm[3].toLowerCase();
      s = sm[1];
      u.issues.push(issue('info', 'dmarc-uri-size', code(raw) + ': the size limit ' + code('!' + u.size) + ' is obsolete. RFC 9989 removed it and its receivers ignore it; RFC 7489 receivers skip reports larger than that.', 'You can drop ' + code('!' + u.size) + '.', ref('9989', 'C.4')));
    }
    if (s.indexOf('!') >= 0) {
      u.issues.push(issue('error', 'dmarc-uri-bang', code(raw) + ': an exclamation mark inside a report address must be written as %21.', 'Encode it, or remove it.', r));
      return u;
    }
    if (/[ \t]/.test(s) || s === '') {
      u.issues.push(issue('error', 'dmarc-uri-space', code(raw) + ' is not a valid report address' + (s === '' ? ' (it is empty)' : ' (it contains a space)') + '.', 'Separate addresses with commas only: ' + code('mailto:a@example.com,mailto:b@example.com') + '.', r));
      return u;
    }
    var sch = /^([A-Za-z][A-Za-z0-9+.\-]*):([\s\S]*)$/.exec(s);
    if (!sch) {
      if (/^[^@\s:]+@[^@\s]+$/.test(s)) {
        u.issues.push(issue('error', 'dmarc-uri-no-scheme', code(raw) + ' has no mailto: in front, so it is not a URI and receivers ignore it.', 'Write ' + code('mailto:' + s) + '.', ref('9989', '4.6')));
      } else {
        u.issues.push(issue('error', 'dmarc-uri-bad', code(raw) + ' is not a report URI.', 'Use ' + code('mailto:dmarc@example.com') + '.', ref('9989', '4.6')));
      }
      return u;
    }
    u.scheme = sch[1].toLowerCase();
    if (u.scheme === 'mailto') {
      var addr = sch[2].split('?')[0];
      var dec;
      try { dec = decodeURIComponent(addr); } catch (e) { dec = addr; }
      var at = dec.lastIndexOf('@');
      if (at <= 0 || at === dec.length - 1 || dec.indexOf(',') >= 0) {
        u.issues.push(issue('error', 'dmarc-mailto-bad', code(raw) + ' does not contain a valid email address.', 'Write it as ' + code('mailto:dmarc@example.com') + '.', ref('9989', '4.6')));
        return u;
      }
      var host = toAsciiDomain(dec.slice(at + 1).replace(/\.$/, ''));
      var prob = host ? hostnameProblem(host) : 'it cannot be converted';
      if (prob || host.indexOf('.') < 0) {
        u.issues.push(issue('error', 'dmarc-mailto-host', code(raw) + ': the domain after @ is not valid' + (prob ? ' (' + escapeHtml(prob) + ')' : '') + '.', 'Check the address for typos.', ref('9989', '4.6')));
        return u;
      }
      u.address = dec;
      u.host = host;
      u.ok = true;
      return u;
    }
    if (u.scheme === 'https' || u.scheme === 'http') {
      try {
        u.host = new URL(s).hostname;
        u.ok = true;
      } catch (e2) {
        u.issues.push(issue('error', 'dmarc-uri-bad', code(raw) + ' is not a valid URL.', '', ref('9989', '4.6')));
        return u;
      }
      u.issues.push(issue('info', 'dmarc-uri-web', code(raw) + ': receivers must support mailto: and may ignore other schemes, so many will not send reports here.', 'Add a mailto: address as well.', ref('9989', '4.7')));
      if (u.scheme === 'http') {
        u.issues.push(issue('warning', 'dmarc-uri-http', code(raw) + ' is unencrypted http. RFC 9989 says unencrypted transport SHOULD be avoided for reports.', 'Use https: or mailto:.', ref('9989', '11.7')));
      }
      return u;
    }
    u.issues.push(issue('warning', 'dmarc-uri-scheme', code(raw) + ' uses the ' + code(u.scheme + ':') + ' scheme; receivers ignore schemes they do not support.', 'Use mailto:.', ref('9989', '4.7')));
    return u;
  }

  function parseUriList(value) {
    return String(value).split(',').map(function (x) { return parseDmarcUri(trimWsp(x)); });
  }

  var POLICY_TEXT = {
    none: 'Monitoring mode: no action is requested for mail that fails DMARC; receivers deliver it as usual and send reports.',
    quarantine: 'Mail that fails DMARC should be treated as suspicious, which usually means the spam folder.',
    reject: 'Mail that fails DMARC should be refused during the SMTP session.'
  };

  function parseDmarc(value) {
    var v = String(value == null ? '' : value);
    var res = { value: v, usable: true, tags: [], map: {}, issues: [], effective: null, length: v.length };
    var add = function (lvl, id, msg, fix, r) { res.issues.push(issue(lvl, id, msg, fix, r)); };
    if (!isAscii(v)) {
      add('error', 'dmarc-non-ascii', 'The record contains characters outside US-ASCII.', 'Use A-labels (xn--…) and percent-encode report addresses.', ref('9989', '4.8'));
    }
    var segs = v.split(';');
    for (var i = 0; i < segs.length; i++) {
      var s = trimWsp(segs[i]);
      if (s === '') {
        if (i === segs.length - 1 && i > 0) continue;
        add('warning', 'dmarc-empty-segment', 'There is an empty tag (two semicolons in a row, or a semicolon at the start).', 'Remove the extra semicolon.', ref('9989', '4.8'));
        continue;
      }
      var m = /^([^=]*?)[ \t]*=[ \t]*([\s\S]*)$/.exec(s);
      if (!m || !/^[A-Za-z]+$/.test(m[1])) {
        add('warning', 'dmarc-bad-tag', code(s) + ' is not a tag=value pair, so receivers skip it.', 'Write tags as ' + code('name=value') + ' separated by semicolons.', ref('9989', '4.8'));
        continue;
      }
      res.tags.push({ name: m[1], lname: m[1].toLowerCase(), value: m[2], raw: s, pos: res.tags.length });
    }
    var first = res.tags[0];
    if (!first || first.lname !== 'v') {
      res.usable = false;
      add('error', 'dmarc-v-first', 'The record does not start with ' + code('v=DMARC1') + '. The v tag must be the first tag; without it receivers ignore the whole record.', 'Start the record with ' + code('v=DMARC1;') + '.', ref('9989', '4.7'));
    } else if (first.value !== 'DMARC1') {
      res.usable = false;
      if (/^DMARC1[ \t]/i.test(first.value)) {
        add('error', 'dmarc-no-semicolon', code(first.raw) + ': tags must be separated by semicolons, so this reads as one v tag with the value ' + code(first.value) + '. Receivers ignore the record.', 'Write ' + code('v=DMARC1; ' + trimWsp(first.value.slice(6))) + ', with a semicolon after every tag.', ref('9989', '4.8'));
      } else if (first.value.toUpperCase() === 'DMARC1') {
        add('error', 'dmarc-v-case', code(first.raw) + ': the version is case-sensitive and must be exactly ' + code('DMARC1') + '. Receivers ignore this record.', 'Write ' + code('v=DMARC1') + '.', ref('9989', '4.7'));
      } else {
        add('error', 'dmarc-v-value', code(first.raw) + ': the only valid version is ' + code('DMARC1') + '. Receivers ignore this record.', 'Write ' + code('v=DMARC1') + '.', ref('9989', '4.7'));
      }
    }
    var seen = {};
    res.tags.forEach(function (tag, idx) {
      if (idx === 0 && tag.lname === 'v') {
        if (tag.name !== 'v') add('warning', 'dmarc-tag-case', code(tag.raw) + ': write tag names in lowercase. DMARC uses DKIM\'s tag=value syntax, where tag names are case-sensitive, so some receivers will not recognise it.', 'Write ' + code('v=DMARC1') + '.', ref('6376', '3.2'));
        seen.v = tag;
        return;
      }
      if (tag.name !== tag.lname) {
        add('warning', 'dmarc-tag-case', code(tag.raw) + ': write tag names in lowercase. DMARC uses DKIM\'s tag=value syntax, where tag names are case-sensitive, so some receivers will not recognise ' + code(tag.name) + '.', 'Write ' + code(tag.lname + '=' + tag.value) + '.', ref('6376', '3.2'));
      }
      if (seen[tag.lname]) {
        tag.duplicate = true;
        add('error', 'dmarc-duplicate', code(tag.lname) + ' appears more than once. In the tag=value syntax DMARC uses, a repeated tag makes the whole tag list invalid; receivers differ in which copy, if any, they use.', 'Keep one ' + code(tag.lname) + ' tag.', ref('6376', '3.2'));
        return;
      }
      seen[tag.lname] = tag;
      if (tag.value === '') {
        tag.invalid = true;
        add('error', 'dmarc-empty-value', code(tag.raw) + ' has no value.', 'Give it a value or remove the tag.', ref('9989', '4.8'));
        return;
      }
      if (/[^\x20-\x3a\x3c-\x7e]/.test(tag.value)) {
        add('warning', 'dmarc-value-chars', code(tag.raw) + ' contains characters that are not allowed in a DMARC value (tabs, control or non-ASCII characters).', 'Retype the value.', ref('9989', '4.8'));
      }
      var lv = tag.value.toLowerCase();
      switch (tag.lname) {
        case 'p':
        case 'sp':
        case 'np':
          if (POLICIES.indexOf(lv) >= 0) {
            tag.norm = lv;
          } else {
            tag.invalid = true;
            var sgp = suggest(lv, POLICIES);
            add('error', 'dmarc-policy-invalid', code(tag.raw) + ' is not a valid policy (none, quarantine or reject).', (sgp ? 'Did you mean ' + code(tag.lname + '=' + sgp) + '? ' : '') + 'See below for what receivers do with an invalid policy.', ref('9989', '4.10.1'));
          }
          break;
        case 'adkim':
        case 'aspf':
          if (lv === 'r' || lv === 's') tag.norm = lv;
          else {
            tag.invalid = true;
            add('warning', 'dmarc-align-invalid', code(tag.raw) + ' is not valid (r or s). Receivers ignore it and use the default, relaxed.', 'Write ' + code(tag.lname + '=r') + ' or ' + code(tag.lname + '=s') + '.', ref('9989', '4.7'));
          }
          break;
        case 't':
          if (lv === 'y' || lv === 'n') tag.norm = lv;
          else {
            tag.invalid = true;
            add('warning', 'dmarc-t-invalid', code(tag.raw) + ' is not valid (y or n). Receivers ignore it and apply the policy as written.', 'Write ' + code('t=y') + ' for test mode or remove the tag.', ref('9989', '4.7'));
          }
          break;
        case 'psd':
          if (lv === 'y' || lv === 'n' || lv === 'u') {
            tag.norm = lv;
            if (lv === 'y') add('warning', 'dmarc-psd-y', code(tag.raw) + ' declares this domain a public suffix (a registry level such as a top-level domain). Only public suffix operators should publish it; on an ordinary domain it changes how receivers find the organizational domain.', 'Remove it, or use ' + code('psd=n') + ' if you want to mark this domain as the organizational domain.', ref('9989', '4.7'));
          } else {
            tag.invalid = true;
            add('warning', 'dmarc-psd-invalid', code(tag.raw) + ' is not valid (y, n or u). Receivers use the default, u.', 'Remove it.', ref('9989', '4.7'));
          }
          break;
        case 'fo': {
          var fo = parseFo(tag.value);
          if (!fo.ok) {
            tag.invalid = true;
            add('warning', 'dmarc-fo-invalid', code(tag.raw) + ': ' + fo.error + ' Receivers ignore it and use the default, fo=0.', 'For example ' + code('fo=1') + ' or ' + code('fo=0:d:s') + '.', ref('9989', '4.8'));
          } else {
            tag.norm = fo.parts.join(':');
            if (fo.spaces) add('info', 'dmarc-fo-spaces', code(tag.raw) + ': RFC 9989 allows no spaces around the colons.', 'Write ' + code('fo=' + tag.norm) + '.', ref('9989', '4.8'));
          }
          break;
        }
        case 'rua':
        case 'ruf':
          tag.uris = parseUriList(tag.value);
          tag.uris.forEach(function (u) { u.issues.forEach(function (x) { res.issues.push(x); }); });
          if (!tag.uris.some(function (u) { return u.ok; })) tag.invalid = true;
          break;
        case 'pct': {
          var pm = /^[0-9]{1,3}$/.test(tag.value) ? +tag.value : -1;
          if (pm === 100) {
            add('info', 'dmarc-pct-100', code(tag.raw) + ' was the default in RFC 7489. RFC 9989 removed pct, so the tag is now just ignored.', 'Remove ' + code(tag.raw) + '.', ref('9989', 'A.6'));
          } else if (pm === 0) {
            add('warning', 'dmarc-pct-0', code(tag.raw) + ': RFC 9989 removed pct, and its receivers apply the full policy. The new ' + code('t=y') + ' tag replaces pct=0 (apply one level below the policy).', 'Use ' + code('t=y') + '. Keeping pct=0 as well still helps receivers that follow RFC 7489.', ref('9989', 'A.6'));
          } else if (pm > 0 && pm < 100) {
            add('warning', 'dmarc-pct-partial', code(tag.raw) + ': RFC 9989 removed pct because receivers applied values other than 0 and 100 inconsistently. Receivers that follow RFC 9989 ignore it and apply the policy to all failing mail.', 'Decide on the policy for all mail, or use ' + code('t=y') + ' to test one level below it.', ref('9989', 'A.6'));
          } else {
            add('warning', 'dmarc-pct-invalid', code(tag.raw) + ' is not a number from 0 to 100, and RFC 9989 removed pct anyway.', 'Remove it.', ref('9989', 'C.5.2'));
          }
          break;
        }
        case 'rf':
          add('info', 'dmarc-rf', code(tag.raw) + ': the failure-report format tag was removed in RFC 9989 (afrf was its only value). Receivers ignore it.', 'Remove it.', ref('9989', 'C.5.2'));
          break;
        case 'ri':
          add('info', 'dmarc-ri', code(tag.raw) + ': the report-interval tag was removed in RFC 9989; RFC 7489 receivers only had to support daily reports anyway.', 'Remove it.', ref('9989', 'C.5.2'));
          break;
        default: {
          var sgt = suggest(tag.lname, DMARC_KNOWN.concat(DMARC_REMOVED));
          add('warning', 'dmarc-unknown-tag', code(tag.raw) + ': ' + code(tag.lname) + ' is not a DMARC tag, so receivers ignore it.', sgt ? 'Did you mean ' + code(sgt + '=' + tag.value) + '?' : 'Remove it.', ref('9989', '4.7'));
        }
      }
    });
    res.map = seen;
    var p = seen.p;
    var ruaOk = !!(seen.rua && seen.rua.uris && seen.rua.uris.some(function (u) { return u.ok; }));
    if (!p) {
      if (res.usable) add('warning', 'dmarc-p-missing', 'There is no ' + code('p') + ' tag. RFC 9989 treats an otherwise valid record without p as ' + code('p=none') + ', but RFC 7489 required p, so older receivers may ignore the record.', 'Add ' + code('p=none') + ' (or your policy) right after ' + code('v=DMARC1;') + '.', ref('9989', '4.7'));
    } else if (res.tags[1] !== p) {
      add('warning', 'dmarc-p-order', code('p') + ' is not the second tag. RFC 9989 allows any order after v, but RFC 7489 required ' + code('v') + ' and ' + code('p') + ' first and in that order, and receivers that still follow it may reject the record.', 'Move ' + code(p.raw) + ' directly after ' + code('v=DMARC1;') + '.', ref('7489', '6.3'));
    }
    ['p', 'sp', 'np'].forEach(function (k) {
      if (seen[k] && seen[k].invalid && res.usable) {
        add('error', 'dmarc-policy-effect', code(seen[k].raw) + ' is invalid, so ' + (ruaOk ? 'receivers act as if the record said ' + code('p=none') + ' (they still send reports to rua).' : 'and with no valid rua address, receivers apply no DMARC processing at all.'), 'Use none, quarantine or reject.', ref('9989', '4.10.1'));
      }
    });
    var anyPolicyInvalid = ['p', 'sp', 'np'].some(function (k) { return seen[k] && seen[k].invalid; });
    var eff = {
      p: anyPolicyInvalid ? 'none' : (p && p.norm) || 'none',
      sp: anyPolicyInvalid ? null : (seen.sp && seen.sp.norm) || null,
      np: anyPolicyInvalid ? null : (seen.np && seen.np.norm) || null,
      adkim: (seen.adkim && seen.adkim.norm) || 'r',
      aspf: (seen.aspf && seen.aspf.norm) || 'r',
      fo: (seen.fo && seen.fo.norm) || '0',
      t: (seen.t && seen.t.norm) || 'n',
      psd: (seen.psd && seen.psd.norm) || 'u',
      rua: seen.rua && seen.rua.uris ? seen.rua.uris.filter(function (u) { return u.ok; }) : [],
      ruf: seen.ruf && seen.ruf.uris ? seen.ruf.uris.filter(function (u) { return u.ok; }) : []
    };
    eff.spEff = eff.sp || eff.p;
    eff.npEff = eff.np || eff.spEff;
    res.effective = eff;
    if (res.usable) {
      if (eff.p === 'none' && !ruaOk) {
        add('warning', 'dmarc-none-no-rua', code('p=none') + ' without a valid ' + code('rua') + ' address: monitoring mode that sends you no reports gives you no data to act on.', 'Add ' + code('rua=mailto:dmarc@your-domain') + ' and a mailbox or service that reads the XML reports.', ref('9989', '5.1.4'));
      } else if (!ruaOk) {
        add('info', 'dmarc-no-rua', 'No valid ' + code('rua') + ' address: receivers will not send aggregate reports, so you will not see mail that fails.', 'Add ' + code('rua=mailto:…') + '.', ref('9989', '4.7'));
      }
      if (eff.p === 'reject' || eff.spEff === 'reject') {
        add('info', 'dmarc-reject-notes', code('reject') + ' means: sign all your mail with DKIM (forwarding breaks SPF, and a reject domain MUST NOT rely on SPF alone), and keep in mind that domains whose users post to mailing lists SHOULD NOT publish reject. RFC 9989 suggests p=none for at least a month, then quarantine for as long, before reject.', '', ref('9989', '7.4'));
      }
      if (seen.ruf) {
        add('info', 'dmarc-ruf-privacy', code('ruf') + ' failure reports can contain message headers and content, so the destination receives personal data; many large mailbox providers do not send them at all.', 'Only send them to a mailbox you control and protect.', ref('9991', '7'));
      }
      if (seen.fo && !seen.ruf) {
        add('info', 'dmarc-fo-no-ruf', code(seen.fo.raw) + ' has no effect without a ' + code('ruf') + ' tag.', 'Remove fo, or add ruf.', ref('9989', '4.7'));
      }
      if (eff.t === 'y' && eff.p === 'none' && eff.spEff === 'none' && eff.npEff === 'none') {
        add('info', 'dmarc-t-none', code('t=y') + ' has no effect while every policy is none.', 'Use it when you move to quarantine or reject.', ref('9989', '4.7'));
      }
    }
    return res;
  }

  function policyWord(p) {
    return p === 'none' ? 'none (monitoring)' : p;
  }

  function explainDmarcTag(tag, eff, dom) {
    var d = dom ? code(dom) : 'this domain';
    if (tag.invalid) return 'Invalid value: receivers ignore it (see the messages above).';
    if (tag.duplicate) return 'Repeated tag.';
    switch (tag.lname) {
      case 'v': return 'Marks this TXT record as a DMARC policy record. It must be the first tag and exactly DMARC1.';
      case 'p': return POLICY_TEXT[tag.norm] + ' Applies to ' + d + ' and, unless sp or np says otherwise, to its subdomains.';
      case 'sp': return 'Policy for existing subdomains of ' + d + ' (such as mail.' + escapeHtml(dom || 'example.com') + '): ' + POLICY_TEXT[tag.norm].charAt(0).toLowerCase() + POLICY_TEXT[tag.norm].slice(1) + ' Only read from the organizational domain\'s record.';
      case 'np': return 'Policy for subdomains that do not exist in DNS, a favourite spoofing trick: ' + policyWord(tag.norm) + '. New in RFC 9989; older receivers ignore it and use sp or p.';
      case 'adkim': return tag.norm === 's' ? 'Strict DKIM alignment: the DKIM signature\'s d= domain must equal the From domain exactly.' : 'Relaxed DKIM alignment (the default): the DKIM d= domain only has to share the organizational domain with the From domain.';
      case 'aspf': return tag.norm === 's' ? 'Strict SPF alignment: the envelope sender (Return-Path) domain must equal the From domain exactly.' : 'Relaxed SPF alignment (the default): the envelope sender (Return-Path) domain only has to share the organizational domain with the From domain.';
      case 'rua': return 'Receivers send daily aggregate reports (XML, usually gzipped) to ' + tag.uris.filter(function (u) { return u.ok; }).map(function (u) { return code(u.address || u.raw); }).join(', ') + '.';
      case 'ruf': return 'Receivers may send per-message failure reports to ' + tag.uris.filter(function (u) { return u.ok; }).map(function (u) { return code(u.address || u.raw); }).join(', ') + '.';
      case 'fo': {
        var map = { '0': 'when all mechanisms fail to give an aligned pass', '1': 'when any mechanism fails to give an aligned pass', d: 'a DKIM report for each failed signature', s: 'an SPF report for each SPF failure' };
        return 'Failure-report options: ' + tag.norm.split(':').map(function (x) { return map[x]; }).join('; ') + '.';
      }
      case 't': return tag.norm === 'y' ? 'Test mode: receivers apply one level below the policy (reject is handled as quarantine, quarantine as none). The RFC 9989 replacement for pct=0.' : 'Apply the policy as written (the default).';
      case 'psd': return { y: 'Declares the domain a public suffix (registry level).', n: 'Declares this domain the organizational domain for itself and its subdomains, which ends the DNS tree walk here.', u: 'The default: the DNS tree walk decides the organizational domain.' }[tag.norm];
      case 'pct': return 'Removed in RFC 9989. RFC 7489 receivers applied the policy to only this percentage of failing mail.';
      case 'rf': return 'Removed in RFC 9989 (failure-report format).';
      case 'ri': return 'Removed in RFC 9989 (requested seconds between aggregate reports).';
      default: return 'Unknown tag: receivers ignore it.';
    }
  }

  // External report destinations (RFC 9990 section 4, RFC 9991 section 5).
  function externalDestinations(parsed, policyDomain, authNames) {
    var out = [];
    if (!policyDomain || !parsed.usable) return out;
    ['rua', 'ruf'].forEach(function (tagName) {
      var tag = parsed.map[tagName];
      if (!tag || !tag.uris) return;
      tag.uris.forEach(function (u) {
        if (!u.ok || !u.host || sameOrg(u.host, policyDomain)) return;
        var name = policyDomain + '._report._dmarc.' + u.host;
        var wildcard = '*._report._dmarc.' + u.host;
        out.push({
          tag: tagName, uri: u.raw, host: u.host, name: name, value: 'v=DMARC1',
          tooLong: name.length > 253,
          authorized: !!(authNames && (authNames[name] || authNames[wildcard])),
          authorizedBy: authNames && authNames[name] ? name : (authNames && authNames[wildcard] ? wildcard : null)
        });
      });
    });
    return out;
  }

  function externalIssues(ext, policyDomain) {
    return ext.map(function (e) {
      var r = ref(e.tag === 'ruf' ? '9991' : '9990', e.tag === 'ruf' ? '5' : '4');
      if (e.tooLong) {
        return issue('error', 'dmarc-ext-too-long', 'Reports to ' + code(e.host) + ' cannot be authorized: the name ' + code(e.name) + ' is longer than DNS allows, so receivers drop this address.', 'Use a report address under ' + code(policyDomain) + ' that forwards to the service.', r);
      }
      if (e.authorized) {
        return issue('info', 'dmarc-ext-ok', code(e.uri) + ' is on another domain, and the pasted record ' + code(e.authorizedBy) + ' authorizes it.', '', r);
      }
      return issue('warning', 'dmarc-ext-auth', code(e.uri) + ' is outside ' + code(orgDomainGuess(policyDomain)) + '. Receivers only send ' + (e.tag === 'ruf' ? 'failure' : 'aggregate') + ' reports there if ' + code(e.host) + ' publishes a TXT record at ' + code(e.name) + ' that starts with ' + code('v=DMARC1') + '.', 'The owner of ' + code(e.host) + ' publishes it (report services usually have a wildcard ' + code('*._report._dmarc.' + e.host) + '). Paste it here to confirm, or use an address under your own domain that forwards to the service.', r);
    });
  }

  // ── Check orchestration ───────────────────────────────────

  function rdataIssues(e) {
    var out = [];
    e.strings.forEach(function (s, i) {
      if (s.length > TXT_MAX) {
        out.push(issue('warning', 'txt-string-long', 'String ' + (i + 1) + ' is ' + s.length + ' characters. One TXT string holds at most 255 octets, so DNS cannot carry it as one string. Your DNS panel probably splits it; make sure the published record shows several quoted strings.', 'Split it into strings of up to 255 characters; receivers join them without spaces.', ref('1035', '3.3')));
      }
    });
    e.rdataIssues.forEach(function (x) {
      if (x.code === 'txt-unclosed') out.push(issue('warning', 'txt-unclosed', 'A quoted string is not closed with a double quote.', 'Check the end of the line.', ref('1035', '5.1')));
      if (x.code === 'txt-trailing') out.push(issue('warning', 'txt-trailing', 'Text after the quoted strings is ignored: ' + code(x.text) + '.', 'Put the whole record inside quotes.', ref('1035', '5.1')));
    });
    if (e.source === 'zone' && !e.quoted && /\s/.test(e.value)) {
      out.push(issue('warning', 'txt-unquoted', 'In a zone file, unquoted text is split at every space into separate strings, and receivers join those strings without spaces, turning ' + code(e.value.slice(0, 30)) + ' into a broken record.', 'Put the value in double quotes.', ref('7208', '3.3')));
    }
    return out;
  }

  function checkRecords(text, defaultDomain) {
    var nd = defaultDomain && String(defaultDomain).trim() ? normalizeDomain(defaultDomain) : null;
    var def = nd && nd.ok ? nd.domain : null;
    var input = parseRecordsInput(text, def);
    var out = {
      defaultDomain: def, domainError: nd && !nd.ok ? nd.error : null,
      spf: [], dmarc: [], auth: [], other: [], ignored: input.ignored, entryCount: input.entries.length
    };
    var spfGroups = {}, spfKeys = [], dmGroups = {}, dmKeys = [], authNames = {};
    input.entries.forEach(function (e) {
      var kind = classifyTxt(e.value, e.domain);
      var extra = rdataIssues(e);
      if (kind === 'dmarc-auth') {
        var ap = parseDmarc(e.value.trim());
        out.auth.push({ name: e.domain, value: e.value, ok: ap.usable, issues: extra.concat(ap.usable ? [] : ap.issues.filter(function (x) { return x.level === 'error'; })) });
        if (ap.usable) authNames[e.domain] = true;
        return;
      }
      if (kind === 'spf') {
        var key = e.domain || def || '';
        if (!spfGroups[key]) { spfGroups[key] = { domain: key, records: [], entries: [], issues: [] }; spfKeys.push(key); }
        var ps = parseSpf(e.value);
        spfGroups[key].records.push(ps);
        spfGroups[key].entries.push(e);
        extra.forEach(function (x) { spfGroups[key].issues.push(x); });
        if (/^_dmarc\./.test(key)) spfGroups[key].issues.push(issue('warning', 'spf-at-dmarc', 'An SPF record at ' + code(key) + ' is never used: SPF is looked up at the domain itself.', 'Publish it at ' + code(key.slice(7)) + '.', ref('7208', '3')));
        return;
      }
      if (kind === 'dmarc') {
        var dkey = e.domain || (def ? '_dmarc.' + def : '');
        var fromDns = e.source === 'zone' || e.source === 'nslookup';
        var relabelled = false;
        if (dkey === '_dmarc') dkey = def ? '_dmarc.' + def : '_dmarc';
        else if (dkey && !/^_dmarc\./.test(dkey) && !fromDns) { dkey = '_dmarc.' + dkey; relabelled = true; }
        if (!dmGroups[dkey]) {
          var pol = /^_dmarc\./.test(dkey) ? dkey.slice(7) : (dkey && dkey !== '_dmarc' ? dkey : null);
          dmGroups[dkey] = { name: dkey, policyDomain: pol, records: [], entries: [], issues: [] };
          dmKeys.push(dkey);
          if (dkey && dkey !== '_dmarc' && !/^_dmarc\./.test(dkey)) {
            dmGroups[dkey].issues.push(issue('warning', 'dmarc-misplaced', 'This DMARC record is published at ' + code(dkey) + '. Receivers only look for DMARC at ' + code('_dmarc.' + dkey) + ', so a record at the domain itself is never found.', 'Publish it with the name ' + code('_dmarc') + ' (' + code('_dmarc.' + dkey) + ').', ref('9989', '4.5')));
          } else if (relabelled) {
            dmGroups[dkey].issues.push(issue('info', 'dmarc-relabelled', 'Labelled ' + code(dkey.slice(7)) + ' and checked as ' + code(dkey) + ', the name receivers query. In DNS it must be published there.', '', ref('9989', '4.5')));
          }
        }
        dmGroups[dkey].records.push(parseDmarc(e.value));
        dmGroups[dkey].entries.push(e);
        extra.forEach(function (x) { dmGroups[dkey].issues.push(x); });
        return;
      }
      out.other.push({ domain: e.domain, value: e.value, kind: kind });
    });

    spfKeys.forEach(function (k) {
      var g = spfGroups[k];
      if (g.records.length > 1) {
        g.issues.unshift(issue('error', 'spf-multiple', (k ? code(k) : 'This domain') + ' has ' + g.records.length + ' SPF records. A domain may have only one TXT record starting with v=spf1; with more, receivers return permerror for every message.', 'Merge them into one record: list every mechanism once and end with a single all.', ref('7208', '3.2'), true));
      }
    });
    var referenced = {};
    spfKeys.forEach(function (k) {
      spfGroups[k].records[0].terms.forEach(function (t) {
        if (t.counts && (t.name === 'include' || t.name === 'redirect') && t.target && t.target !== k) referenced[t.target] = true;
      });
    });
    var roots = spfKeys.filter(function (k) { return !referenced[k]; });
    if (!roots.length && spfKeys.length) roots = [spfKeys[0]];
    if (def && roots.indexOf(def) > 0) {
      roots.splice(roots.indexOf(def), 1);
      roots.unshift(def);
    }
    roots.forEach(function (k) {
      var g = spfGroups[k];
      g.isRoot = true;
      g.lookups = analyzeSpfTree(k, spfGroups);
      lookupIssues(g.lookups).forEach(function (x) { g.issues.push(x); });
    });
    spfKeys.forEach(function (k) {
      var g = spfGroups[k];
      if (!g.isRoot) g.lookups = analyzeSpfTree(k, spfGroups);
    });
    out.spf = roots.map(function (k) { return spfGroups[k]; }).concat(spfKeys.filter(function (k) { return roots.indexOf(k) < 0; }).map(function (k) { return spfGroups[k]; }));

    dmKeys.forEach(function (k) {
      var g = dmGroups[k];
      if (g.records.length > 1) {
        g.issues.unshift(issue('error', 'dmarc-multiple', (k ? code(k) : 'This name') + ' has ' + g.records.length + ' DMARC records. When several are returned, receivers discard all of them, so the domain has no DMARC policy.', 'Keep exactly one TXT record starting with v=DMARC1 at this name.', ref('9989', '4.10')));
      }
      g.external = externalDestinations(g.records[0], g.policyDomain, authNames);
      externalIssues(g.external, g.policyDomain).forEach(function (x) { g.issues.push(x); });
      var rec = g.records[0];
      var hasRemote = rec.usable && ['rua', 'ruf'].some(function (t) { return rec.map[t] && rec.map[t].uris && rec.map[t].uris.some(function (u) { return u.ok; }); });
      if (!g.policyDomain && hasRemote) {
        g.issues.push(issue('info', 'dmarc-ext-unknown', 'Enter the domain (or label the record with ' + code('_dmarc.your-domain') + ') to check whether the report addresses need an authorization record.', '', ref('9990', '4')));
      }
      if (rec.map.sp && g.policyDomain && orgDomainGuess(g.policyDomain) !== g.policyDomain) {
        g.issues.push(issue('info', 'dmarc-sp-on-sub', code(rec.map.sp.raw) + ' sits on the record of a subdomain. Receivers only read sp from the organizational domain\'s record, so here it is ignored.', 'Set the policy for this subdomain with p, and put sp on ' + code('_dmarc.' + orgDomainGuess(g.policyDomain)) + '.', ref('9989', '4.7')));
      }
    });
    out.dmarc = dmKeys.map(function (k) { return dmGroups[k]; });
    return out;
  }

  // ── TXT output ────────────────────────────────────────────

  function utf8Len(ch) {
    var c = ch.codePointAt(0);
    return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }

  // Split a TXT value into strings of at most `max` octets (RFC 1035 §3.3). Receivers
  // join them without spaces (RFC 7208 §3.3, RFC 9989 §4.5), so a split right after
  // a space is preferred when one is near, purely for readability.
  function splitTxt(value, max) {
    max = max || TXT_MAX;
    var chars = Array.from(String(value == null ? '' : value));
    var out = [];
    var pos = 0;
    while (pos < chars.length) {
      var bytes = 0, end = pos;
      while (end < chars.length && bytes + utf8Len(chars[end]) <= max) {
        bytes += utf8Len(chars[end]);
        end++;
      }
      if (end < chars.length) {
        for (var k = end - 1; k > pos && k >= end - 64; k--) {
          if (chars[k] === ' ') { end = k + 1; break; }
        }
      }
      out.push(chars.slice(pos, end).join(''));
      pos = end;
    }
    if (!out.length) out.push('');
    return out;
  }

  // One zone-file character-string: quotes and backslashes escaped, anything
  // outside printable ASCII as \DDD (RFC 1035 §5.1).
  function quoteTxtString(s) {
    var out = '"';
    var enc = new TextEncoder();
    Array.from(String(s)).forEach(function (ch) {
      var c = ch.codePointAt(0);
      if (ch === '"' || ch === '\\') out += '\\' + ch;
      else if (c >= 0x20 && c < 0x7f) out += ch;
      else {
        enc.encode(ch).forEach(function (b) {
          out += '\\' + ('00' + b).slice(-3);
        });
      }
    });
    return out + '"';
  }

  function zoneLine(name, value, ttl) {
    return name.replace(/\.$/, '') + '. ' + (ttl || 3600) + ' IN TXT ' + splitTxt(value).map(quoteTxtString).join(' ');
  }

  // ── Generators ────────────────────────────────────────────

  function splitList(s) {
    return String(s || '').split(/[\s,;]+/).filter(Boolean);
  }

  function spfName(st, out) {
    var nd = normalizeDomain(st.d);
    if (!nd.ok) {
      out.fieldErrors.d = nd.error;
      return null;
    }
    var domain = nd.domain;
    var sub = String(st.sub || '').trim().toLowerCase().replace(/\.$/, '').replace(/^\./, '');
    if (sub === '@') sub = '';
    if (sub && (sub === domain || sub.slice(-(domain.length + 1)) === '.' + domain)) {
      sub = sub === domain ? '' : sub.slice(0, sub.length - domain.length - 1);
    }
    var name = domain;
    if (sub) {
      var full = toAsciiDomain(sub + '.' + domain);
      var prob = full ? hostnameProblem(full) : 'it cannot be converted';
      if (prob) {
        out.fieldErrors.sub = code(sub) + ' is not a valid subdomain: ' + escapeHtml(prob) + '.';
        return null;
      }
      name = full;
    }
    return { domain: domain, name: name, host: sub ? name.slice(0, name.length - domain.length - 1) : '@' };
  }

  function buildSpf(st) {
    var out = { ok: false, fieldErrors: {}, issues: [], name: '', host: '@', domain: '', value: '', terms: [], parsed: null, lookups: null, includes: [], strings: [], zone: '' };
    var nm = spfName(st, out);
    var terms = [];
    if (!st.nomail) {
      var bad4 = [], bad6 = [], badInc = [];
      splitList(st.ip4).forEach(function (tok) {
        var raw = tok.replace(/^ip4:/i, '');
        var m = /^([^\/]+)(?:\/(.*))?$/.exec(raw);
        if (!m || !parseIp4(m[1]) || (m[2] != null && parseCidr(m[2], 32) == null)) bad4.push(tok);
        else terms.push('ip4:' + raw);
      });
      splitList(st.ip6).forEach(function (tok) {
        var raw = tok.replace(/^ip6:/i, '');
        var m = /^([^\/]+)(?:\/(.*))?$/.exec(raw);
        if (!m || !parseIp6(m[1]) || (m[2] != null && parseCidr(m[2], 128) == null)) bad6.push(tok);
        else terms.push('ip6:' + raw.toLowerCase());
      });
      if (bad4.length) out.fieldErrors.ip4 = bad4.map(code).join(', ') + (bad4.length > 1 ? ' are' : ' is') + ' not an IPv4 address or range. Write 192.0.2.10 or 192.0.2.0/24, separated by spaces or commas.';
      if (bad6.length) out.fieldErrors.ip6 = bad6.map(code).join(', ') + (bad6.length > 1 ? ' are' : ' is') + ' not an IPv6 address or range. Write 2001:db8::10 or 2001:db8::/48.';
      if (st.a) terms.push('a');
      if (st.mx) terms.push('mx');
      var incs = [];
      PROVIDERS.forEach(function (p) {
        if (st.svc.indexOf(p.id) >= 0 && incs.indexOf(p.include) < 0) incs.push(p.include);
      });
      splitList(st.inc).forEach(function (tok) {
        var d = tok.replace(/^include:/i, '').replace(/\.$/, '');
        var a = toAsciiDomain(d);
        if (!a || hostnameProblem(a) || a.indexOf('.') < 0 || !isTopLabel(a.slice(a.lastIndexOf('.') + 1))) badInc.push(tok);
        else if (incs.indexOf(a) < 0) incs.push(a);
      });
      if (badInc.length) out.fieldErrors.inc = badInc.map(code).join(', ') + (badInc.length > 1 ? ' are' : ' is') + ' not a domain name to include. Write the name your provider gives, such as spf.example.net.';
      incs.forEach(function (d) { terms.push('include:' + d); });
      out.includes = incs;
      terms.push((st.all === '-' ? '-' : '~') + 'all');
    } else {
      terms.push('-all');
    }
    out.terms = terms;
    out.value = 'v=spf1 ' + terms.join(' ');
    if (!nm) return out;
    out.ok = true;
    out.name = nm.name;
    out.host = nm.host;
    out.domain = nm.domain;
    var parsed = parseSpf(out.value);
    var map = {};
    map[nm.name] = { domain: nm.name, records: [parsed] };
    out.parsed = parsed;
    out.lookups = analyzeSpfTree(nm.name, map);
    out.strings = splitTxt(out.value);
    out.zone = zoneLine(nm.name, out.value);
    parsed.issues.forEach(function (x) { if (x.code !== 'spf-unresolved') out.issues.push(x); });
    lookupIssues(out.lookups).forEach(function (x) { if (x.code !== 'spf-unresolved') out.issues.push(x); });
    if (!st.nomail && terms.length === 1) {
      out.issues.push(issue('warning', 'gen-spf-nothing', 'No sender is selected, so this record authorizes nobody.', 'Pick your mail provider or add your server\'s address. If the domain really sends no mail, tick "sends no email" to publish ' + code('v=spf1 -all') + '.', ref('7208', '10.1.2')));
    }
    if (!st.nomail && nm.host === '@') {
      PROVIDERS.forEach(function (p) {
        if (p.scope === 'sub' && st.svc.indexOf(p.id) >= 0) {
          out.issues.push(issue('warning', 'gen-spf-scope', p.name + ' checks SPF on a subdomain, not on ' + code(nm.domain) + ': ' + escapeHtml(p.note), 'Set "Record for" to that subdomain and build a separate record for it, or remove ' + p.name + ' here.', ref('7208', '2.4')));
        }
      });
    }
    return out;
  }

  function buildUris(text, out, key) {
    var list = [], bad = [];
    splitList(text).forEach(function (tok) {
      var u = /^[A-Za-z][A-Za-z0-9+.\-]*:/.test(tok) ? tok : 'mailto:' + tok;
      var p = parseDmarcUri(u);
      if (!p.ok) { bad.push(tok); return; }
      if (p.scheme === 'mailto') {
        var local = p.address.slice(0, p.address.lastIndexOf('@'));
        if (!isAscii(local)) { bad.push(tok); return; }
        u = 'mailto:' + local + '@' + p.host;
      }
      if (list.indexOf(u) < 0) list.push(u);
    });
    if (bad.length) out.fieldErrors[key] = bad.map(code).join(', ') + (bad.length > 1 ? ' are' : ' is') + ' not a usable report address. Write an email address such as dmarc@example.com (ASCII local part), or a full mailto: URI.';
    return list;
  }

  function buildDmarc(st) {
    var out = { ok: false, fieldErrors: {}, issues: [], name: '', domain: '', value: '', auth: [], parsed: null, strings: [], zone: '' };
    var nd = normalizeDomain(st.d);
    var tags = ['v=DMARC1', 'p=' + (POLICIES.indexOf(st.p) >= 0 ? st.p : 'none')];
    if (POLICIES.indexOf(st.sp) >= 0) tags.push('sp=' + st.sp);
    if (POLICIES.indexOf(st.np) >= 0) tags.push('np=' + st.np);
    if (st.t) tags.push('t=y');
    if (st.adkim === 's') tags.push('adkim=s');
    if (st.aspf === 's') tags.push('aspf=s');
    var rua = buildUris(st.rua, out, 'rua');
    var ruf = buildUris(st.ruf, out, 'ruf');
    if (rua.length) tags.push('rua=' + rua.join(','));
    if (ruf.length) {
      tags.push('ruf=' + ruf.join(','));
      var fo = [st.fo === '1' ? '1' : '0'];
      if (st.fod) fo.push('d');
      if (st.fos) fo.push('s');
      if (fo.join(':') !== '0') tags.push('fo=' + fo.join(':'));
    }
    out.value = tags.join('; ');
    if (!nd.ok) {
      out.fieldErrors.d = nd.error;
      return out;
    }
    out.ok = true;
    out.domain = nd.domain;
    out.name = '_dmarc.' + nd.domain;
    out.parsed = parseDmarc(out.value);
    out.parsed.issues.forEach(function (x) { out.issues.push(x); });
    var seenHost = {};
    externalDestinations(out.parsed, nd.domain, {}).forEach(function (e) {
      if (seenHost[e.host]) return;
      seenHost[e.host] = true;
      out.auth.push(e);
      if (e.tooLong) out.issues.push(externalIssues([e], nd.domain)[0]);
    });
    out.strings = splitTxt(out.value);
    out.zone = zoneLine(out.name, out.value);
    return out;
  }

  // ── State and URL hash ────────────────────────────────────

  function blankState() {
    return {
      d: '', sub: '', nomail: false, svc: [], ip4: '', ip6: '', a: false, mx: false, inc: '', all: '~',
      p: 'none', sp: '', np: '', adkim: 'r', aspf: 'r', t: false, rua: '', ruf: '', fo: '0', fod: false, fos: false
    };
  }

  function defaultState() {
    var s = blankState();
    s.d = 'example.com';
    s.svc = ['google'];
    s.rua = 'dmarc@example.com';
    return s;
  }

  function isStateHash(hash) {
    return /^#?v=\d/.test(String(hash || ''));
  }

  function encodeHash(s) {
    var e = encodeURIComponent;
    var parts = ['v=1', 'd=' + e(s.d)];
    if (s.sub) parts.push('sub=' + e(s.sub));
    if (s.nomail) parts.push('nm=1');
    if (s.svc.length) parts.push('svc=' + s.svc.join(','));
    if (s.ip4) parts.push('ip4=' + e(s.ip4));
    if (s.ip6) parts.push('ip6=' + e(s.ip6));
    if (s.a) parts.push('a=1');
    if (s.mx) parts.push('mx=1');
    if (s.inc) parts.push('inc=' + e(s.inc));
    parts.push('all=' + (s.all === '-' ? 'fail' : 'soft'));
    parts.push('p=' + s.p);
    if (s.sp) parts.push('sp=' + s.sp);
    if (s.np) parts.push('np=' + s.np);
    if (s.adkim === 's') parts.push('ak=s');
    if (s.aspf === 's') parts.push('as=s');
    if (s.t) parts.push('t=1');
    if (s.rua) parts.push('rua=' + e(s.rua));
    if (s.ruf) parts.push('ruf=' + e(s.ruf));
    if (s.fo === '1') parts.push('fo=1');
    if (s.fod) parts.push('fd=1');
    if (s.fos) parts.push('fs=1');
    return '#' + parts.join('&');
  }

  function decodeHash(hash) {
    if (!isStateHash(hash)) return defaultState();
    var s = blankState();
    var ids = PROVIDERS.map(function (p) { return p.id; });
    var txt = function (v, max) { return String(v).replace(/[\r\n]+/g, ' ').slice(0, max || MAX_FIELD); };
    String(hash).replace(/^#/, '').split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i <= 0) return;
      var k = pair.slice(0, i);
      var v;
      try { v = decodeURIComponent(pair.slice(i + 1)); } catch (e) { return; }
      switch (k) {
        case 'd': s.d = txt(v, 253); break;
        case 'sub': s.sub = txt(v, 200); break;
        case 'nm': s.nomail = v === '1'; break;
        case 'svc':
          s.svc = [];
          v.split(',').forEach(function (id) { if (ids.indexOf(id) >= 0 && s.svc.indexOf(id) < 0) s.svc.push(id); });
          s.svc.sort(function (x, y) { return ids.indexOf(x) - ids.indexOf(y); });
          break;
        case 'ip4': s.ip4 = txt(v); break;
        case 'ip6': s.ip6 = txt(v); break;
        case 'a': s.a = v === '1'; break;
        case 'mx': s.mx = v === '1'; break;
        case 'inc': s.inc = txt(v); break;
        case 'all': s.all = v === 'fail' ? '-' : '~'; break;
        case 'p': if (POLICIES.indexOf(v) >= 0) s.p = v; break;
        case 'sp': if (POLICIES.indexOf(v) >= 0) s.sp = v; break;
        case 'np': if (POLICIES.indexOf(v) >= 0) s.np = v; break;
        case 'ak': s.adkim = v === 's' ? 's' : 'r'; break;
        case 'as': s.aspf = v === 's' ? 's' : 'r'; break;
        case 't': s.t = v === '1'; break;
        case 'rua': s.rua = txt(v); break;
        case 'ruf': s.ruf = txt(v); break;
        case 'fo': s.fo = v === '1' ? '1' : '0'; break;
        case 'fd': s.fod = v === '1'; break;
        case 'fs': s.fos = v === '1'; break;
        default: break;
      }
    });
    return s;
  }

  // ── Examples for the Check tab ────────────────────────────

  var EXAMPLES = {
    nested: {
      domain: 'example.com',
      text: [
        'example.com:',
        'v=spf1 ip4:192.0.2.25 mx include:_spf.mail.example.net include:spf.sender.example.org ~all',
        '',
        '_spf.mail.example.net:',
        'v=spf1 ip4:198.51.100.0/24 include:_netblocks.mail.example.net ~all',
        '',
        '_netblocks.mail.example.net:',
        'v=spf1 ip6:2001:db8:1000::/36 ip4:203.0.113.0/25 -all',
        '',
        '_dmarc.example.com:',
        'v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com,mailto:reports@dmarc.example.net; adkim=s'
      ].join('\n')
    },
    broken: {
      domain: 'example.org',
      text: [
        'example.org.  300  IN  TXT  "v=spf1 a mx ip4:192.0.2.300 inlcude:spf.example.net ptr +all"',
        'example.org.  300  IN  TXT  "v=spf1 include:mail.example.net -all"',
        '_dmarc.example.org.  300  IN  TXT  "v=DMARC1; rua=dmarc@example.org; pct=50; p=reject"'
      ].join('\n')
    },
    lookups: {
      domain: 'example.net',
      text: [
        'example.net.  300  IN  TXT  "v=spf1 a mx include:spf1.mailer.example.com include:spf2.mailer.example.com include:spf3.mailer.example.com include:spf4.mailer.example.com include:spf5.mailer.example.com include:spf6.mailer.example.com " "include:spf7.mailer.example.com exists:%{i}.allow.example.net redirect=_spf.example.net"',
        '_dmarc.example.net.  300  IN  TXT  "v=DMARC1; p=none"'
      ].join('\n')
    }
  };

  // ── Rendering helpers ─────────────────────────────────────

  var LEVEL_ORDER = { error: 0, warning: 1, info: 2 };
  var LEVEL_LABEL = { error: 'Error', warning: 'Warning', info: 'Note' };

  function sortIssues(list) {
    return list.slice().sort(function (a, b) { return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]; });
  }

  function issuesHtml(list) {
    if (!list || !list.length) return '';
    return '<ul class="sdr-issues">' + sortIssues(list).map(function (it) {
      return '<li class="sdr-issue sdr-issue--' + it.level + '">'
        + '<span class="sdr-issue-level">' + (it.perm ? 'permerror' : LEVEL_LABEL[it.level]) + '</span>'
        + '<div class="sdr-issue-body"><p class="sdr-issue-msg">' + it.msg + '</p>'
        + (it.fix ? '<p class="sdr-issue-fix"><strong>Fix:</strong> ' + it.fix + '</p>' : '')
        + (it.ref ? '<a class="sdr-issue-ref" href="' + refUrl(it.ref) + '" target="_blank" rel="noopener noreferrer">' + refLabel(it.ref) + '</a>' : '')
        + '</div></li>';
    }).join('') + '</ul>';
  }

  var copyStore = {};

  function snippetHtml(key, label, text) {
    copyStore[key] = text;
    return '<div class="sdr-snippet"><div class="sdr-snippet-head"><span class="sdr-snippet-label">' + escapeHtml(label) + '</span>'
      + '<button class="sdr-btn sdr-btn--secondary sdr-btn--small" type="button" data-sdr-copy="' + escapeHtml(key) + '">Copy</button></div>'
      + '<pre class="sdr-pre">' + escapeHtml(text) + '</pre></div>';
  }

  function kvHtml(k, v) {
    return '<div class="sdr-kv"><span class="sdr-k">' + escapeHtml(k) + '</span><span class="sdr-v">' + v + '</span></div>';
  }

  function badgeHtml(cls, text) {
    return '<span class="sdr-badge sdr-badge--' + cls + '">' + escapeHtml(text) + '</span>';
  }

  function meterHtml(lk) {
    var n = lk.total;
    var pct = Math.min(100, n / SPF_LIMIT * 100);
    var cls = n > SPF_LIMIT ? ' sdr-meter--over' : (n === SPF_LIMIT ? ' sdr-meter--full' : '');
    var label = (lk.exact ? '' : 'At least ') + n + ' of 10 DNS lookups';
    var sub = lk.exact ? 'Exact: every include and redirect target is pasted.' : '';
    if (!lk.exact && lk.unresolved.length) {
      var u = [];
      lk.unresolved.forEach(function (x) { if (u.indexOf(x.domain) < 0) u.push(x.domain); });
      sub = 'Plus whatever these need: ' + u.map(code).join(', ') + '.';
    } else if (!lk.exact && lk.dynamic.length) {
      sub = 'Plus whatever the macro-built targets need.';
    } else if (!lk.exact && lk.loops.length) {
      sub = 'The includes loop.';
    }
    return '<div class="sdr-meter' + cls + '"><div class="sdr-meter-head"><strong class="sdr-meter-label">' + label + '</strong><span class="sdr-meter-sub">' + sub + '</span></div>'
      + '<div class="sdr-meter-bar" role="img" aria-label="' + escapeHtml(label) + '"><span class="sdr-meter-fill" style="width:' + pct.toFixed(0) + '%"></span></div></div>';
  }

  function termsHtml(rec, dom) {
    if (!rec.terms.length) return '';
    var rows = rec.terms.map(function (t) {
      var kind;
      if (t.kind === 'modifier') kind = 'modifier';
      else if (t.kind === 'unknown-modifier') kind = 'unknown modifier';
      else if (t.kind === 'unknown') kind = 'invalid';
      else kind = 'mechanism' + (t.name !== 'all' ? ' · ' + QUAL_RESULT[t.qualifier || '+'] + ' on match' : '');
      var cost = t.counts ? '1 lookup' : (t.afterAll || t.ignored ? 'not evaluated' : 'no lookup');
      var bad = t.issues.some(function (x) { return x.level === 'error'; });
      return '<li class="sdr-term' + (t.afterAll || t.ignored ? ' sdr-term--ignored' : '') + (bad ? ' sdr-term--bad' : '') + '">'
        + '<div class="sdr-term-head"><code class="sdr-term-raw">' + escapeHtml(t.raw) + '</code>'
        + '<span class="sdr-term-kind">' + escapeHtml(kind) + '</span>'
        + '<span class="sdr-term-cost' + (t.counts ? ' sdr-term-cost--on' : '') + '">' + cost + '</span></div>'
        + '<p class="sdr-term-text">' + explainTerm(t, dom) + '</p></li>';
    }).join('');
    return '<ul class="sdr-terms"><li class="sdr-term"><div class="sdr-term-head"><code class="sdr-term-raw">v=spf1</code><span class="sdr-term-kind">version</span><span class="sdr-term-cost">no lookup</span></div><p class="sdr-term-text">Marks this TXT record as SPF version 1.</p></li>' + rows + '</ul>';
  }

  function finalLine(rec) {
    if (rec.allIndex >= 0) {
      var q = rec.allQualifier;
      return '<p class="sdr-final">Servers that match nothing get <strong>' + QUAL_RESULT[q] + '</strong> (' + code((q === '+' ? '+' : q) + 'all') + ').</p>';
    }
    if (rec.redirect) return '<p class="sdr-final">Servers that match nothing get the result of ' + code(rec.redirect.spec || '') + '\'s record (redirect).</p>';
    return '<p class="sdr-final">Servers that match nothing get <strong>neutral</strong> (no all term).</p>';
  }

  function treeHtml(node, depth) {
    var label;
    if (node.loop) label = code(node.via) + ' → loops back to ' + code(node.domain);
    else if (node.missing) label = code(node.via) + ' → not pasted (counted as the 1 lookup of the include itself)';
    else label = (node.via ? code(node.via) + ' → ' : '') + '<strong>' + escapeHtml(node.domain || 'this record') + '</strong>: ' + plural(node.own, 'lookup') + ' in this record' + (node.children.length ? ', ' + node.total + ' including the records below' : '');
    var kids = node.children.length ? '<ul class="sdr-tree">' + node.children.map(function (c) { return treeHtml(c, depth + 1); }).join('') + '</ul>' : '';
    return '<li class="sdr-tree-item">' + label + kids + '</li>';
  }

  function spfVerdict(g) {
    var all = g.issues.concat(g.records[0].issues);
    if (all.some(function (x) { return x.perm; })) return badgeHtml('bad', 'permerror');
    if (all.some(function (x) { return x.level === 'error'; })) return badgeHtml('bad', 'Unsafe');
    if (all.some(function (x) { return x.level === 'warning'; })) return badgeHtml('warn', 'Valid, with warnings');
    return badgeHtml('ok', 'Valid');
  }

  function spfCardHtml(g) {
    var rec = g.records[0];
    var title = g.domain || 'Record without a domain';
    var html = '<section class="sdr-result"><div class="sdr-result-head"><h3 class="sdr-result-title"><span class="sdr-result-kind">SPF</span> ' + escapeHtml(title) + (g.isRoot ? '' : ' <span class="sdr-muted">(included)</span>') + '</h3>' + spfVerdict(g) + '</div>';
    html += '<pre class="sdr-pre sdr-pre--record">' + escapeHtml(rec.value) + '</pre>';
    if (g.records.length > 1) {
      html += '<p class="sdr-text">Other SPF records at this name:</p>' + g.records.slice(1).map(function (r) { return '<pre class="sdr-pre sdr-pre--record">' + escapeHtml(r.value) + '</pre>'; }).join('');
    }
    if (g.isRoot) html += meterHtml(g.lookups);
    else html += '<p class="sdr-text">' + plural(g.lookups.total, 'DNS lookup') + ' in this record and the pasted records below it' + (g.lookups.exact ? '' : ', plus whatever its unpasted includes need') + '.</p>';
    html += finalLine(rec);
    html += issuesHtml(g.issues.concat(rec.issues));
    if (g.isRoot && g.lookups.tree.children.length) {
      html += '<details class="sdr-details" open><summary class="sdr-details-sum">Lookup tree</summary><ul class="sdr-tree sdr-tree--root">' + treeHtml(g.lookups.tree, 0) + '</ul></details>';
    }
    html += '<details class="sdr-details"' + (g.isRoot ? ' open' : '') + '><summary class="sdr-details-sum">Every term explained</summary>' + termsHtml(rec, g.domain || null) + '</details>';
    return html + '</section>';
  }

  function dmarcVerdict(g) {
    var rec = g.records[0];
    var all = g.issues.concat(rec.issues);
    if (!rec.usable || g.records.length > 1) return badgeHtml('bad', 'Ignored by receivers');
    if (all.some(function (x) { return x.level === 'error'; })) return badgeHtml('bad', 'Errors');
    if (all.some(function (x) { return x.level === 'warning'; })) return badgeHtml('warn', 'Valid, with warnings');
    return badgeHtml('ok', 'Valid');
  }

  function dmarcSummaryHtml(rec, dom) {
    if (!rec.usable) return '';
    var e = rec.effective;
    var tNote = e.t === 'y' ? ' <span class="sdr-muted">(test mode: one level lower)</span>' : '';
    var rows = kvHtml('Mail from ' + (dom || 'the domain'), '<strong>' + policyWord(e.p) + '</strong>' + tNote)
      + kvHtml('Existing subdomains', policyWord(e.spEff) + (e.sp ? '' : ' <span class="sdr-muted">(from p)</span>'))
      + kvHtml('Non-existent subdomains', policyWord(e.npEff) + (e.np ? '' : ' <span class="sdr-muted">(from ' + (e.sp ? 'sp' : 'p') + ')</span>'))
      + kvHtml('Alignment', 'DKIM ' + (e.adkim === 's' ? 'strict' : 'relaxed') + ', SPF ' + (e.aspf === 's' ? 'strict' : 'relaxed'))
      + kvHtml('Aggregate reports', e.rua.length ? e.rua.map(function (u) { return code(u.address || u.raw); }).join(' ') : '<span class="sdr-muted">none</span>')
      + kvHtml('Failure reports', e.ruf.length ? e.ruf.map(function (u) { return code(u.address || u.raw); }).join(' ') : '<span class="sdr-muted">none</span>');
    return '<div class="sdr-kv-grid">' + rows + '</div>';
  }

  function dmarcTagsHtml(rec, dom) {
    var e = rec.effective;
    var rows = rec.tags.map(function (tag) {
      var known = DMARC_KNOWN.indexOf(tag.lname) >= 0;
      var removed = DMARC_REMOVED.indexOf(tag.lname) >= 0;
      var kind = known ? 'tag' : (removed ? 'removed in RFC 9989' : 'unknown');
      return '<li class="sdr-term' + (tag.invalid || tag.duplicate || !known ? ' sdr-term--bad' : '') + '"><div class="sdr-term-head"><code class="sdr-term-raw">' + escapeHtml(tag.raw) + '</code><span class="sdr-term-kind">' + kind + '</span></div>'
        + '<p class="sdr-term-text">' + (e ? explainDmarcTag(tag, e, dom) : '') + '</p></li>';
    });
    if (rec.usable) {
      var defaults = [
        ['adkim', 'adkim=r', 'Relaxed DKIM alignment.'],
        ['aspf', 'aspf=r', 'Relaxed SPF alignment.'],
        ['t', 't=n', 'The policy applies as written.'],
        ['psd', 'psd=u', 'The DNS tree walk decides the organizational domain.']
      ];
      if (rec.map.ruf) defaults.push(['fo', 'fo=0', 'Failure reports only when all mechanisms fail.']);
      defaults.forEach(function (d) {
        if (rec.map[d[0]]) return;
        rows.push('<li class="sdr-term sdr-term--default"><div class="sdr-term-head"><code class="sdr-term-raw">' + d[1] + '</code><span class="sdr-term-kind">default (not in the record)</span></div><p class="sdr-term-text">' + d[2] + '</p></li>');
      });
    }
    return '<ul class="sdr-terms">' + rows.join('') + '</ul>';
  }

  function authListHtml(list, keyPrefix) {
    if (!list.length) return '';
    return '<div class="sdr-auth"><h4 class="sdr-sub">Authorization records for external report addresses</h4>'
      + '<p class="sdr-hint">Published by the owner of the receiving domain, not by you. Report services usually have this already (often as a wildcard); for your own second domain, add it there.</p>'
      + list.map(function (e, i) {
        return '<div class="sdr-auth-item"><p class="sdr-text">' + code(e.uri) + (e.authorized ? ' ' + badgeHtml('ok', 'authorized') : '') + '</p>'
          + '<div class="sdr-kv-grid">' + kvHtml('Name', code(e.name)) + kvHtml('Value', code(e.value)) + '</div>'
          + snippetHtml(keyPrefix + '-auth-' + i, 'BIND zone file', zoneLine(e.name, e.value)) + '</div>';
      }).join('') + '</div>';
  }

  function dmarcCardHtml(g, idx) {
    var rec = g.records[0];
    var dom = g.policyDomain;
    var html = '<section class="sdr-result"><div class="sdr-result-head"><h3 class="sdr-result-title"><span class="sdr-result-kind">DMARC</span> ' + escapeHtml(g.name || '_dmarc (no domain given)') + '</h3>' + dmarcVerdict(g) + '</div>';
    html += '<pre class="sdr-pre sdr-pre--record">' + escapeHtml(rec.value) + '</pre>';
    html += dmarcSummaryHtml(rec, dom);
    html += issuesHtml(g.issues.concat(rec.issues));
    html += authListHtml(g.external || [], 'chk-' + idx);
    html += '<details class="sdr-details" open><summary class="sdr-details-sum">Every tag explained</summary>' + dmarcTagsHtml(rec, dom) + '</details>';
    return html + '</section>';
  }

  var KIND_TEXT = {
    'leading-space': 'starts with a space, so receivers do not recognise it as SPF or DMARC',
    senderid: 'a Sender ID record (spf2.0), which no receiver uses for SPF; it can be removed',
    'spf-other': 'starts like SPF but not with "v=spf1 " exactly (for example v=spf1 glued to the next term), so receivers ignore it',
    other: 'not SPF or DMARC (for example a site-verification token)'
  };

  function renderCheckResults(r) {
    var html = '';
    if (r.domainError) html += '<p class="sdr-field-msg sdr-visible">' + r.domainError + '</p>';
    var counts = [];
    if (r.spf.length) counts.push(plural(r.spf.reduce(function (s, g) { return s + g.records.length; }, 0), 'SPF record'));
    if (r.dmarc.length) counts.push(plural(r.dmarc.reduce(function (s, g) { return s + g.records.length; }, 0), 'DMARC record'));
    if (r.auth.length) counts.push(plural(r.auth.length, 'report authorization record'));
    if (r.other.length) counts.push(plural(r.other.length, 'other TXT record'));
    html += '<p class="sdr-summary">' + (counts.length ? 'Found ' + counts.join(', ') + '.' : 'No SPF or DMARC record found. Each record must start with v=spf1 or v=DMARC1; you can put its name on the line before it.') + '</p>';
    r.spf.forEach(function (g) { html += spfCardHtml(g); });
    r.dmarc.forEach(function (g, i) { html += dmarcCardHtml(g, i); });
    if (r.auth.length) {
      html += '<section class="sdr-result"><div class="sdr-result-head"><h3 class="sdr-result-title"><span class="sdr-result-kind">DMARC</span> Report authorization</h3></div><ul class="sdr-terms">' + r.auth.map(function (a) {
        return '<li class="sdr-term' + (a.ok ? '' : ' sdr-term--bad') + '"><div class="sdr-term-head"><code class="sdr-term-raw">' + escapeHtml(a.name) + '</code>' + badgeHtml(a.ok ? 'ok' : 'bad', a.ok ? 'valid' : 'invalid') + '</div><p class="sdr-term-text">' + (a.ok ? 'Allows DMARC reports for ' + code(AUTH_RE.exec(a.name)[1]) + ' to be sent to ' + code(AUTH_RE.exec(a.name)[2]) + '.' : 'Must start with v=DMARC1.') + '</p>' + issuesHtml(a.issues) + '</li>';
      }).join('') + '</ul></section>';
    }
    if (r.other.length) {
      var notable = r.other.some(function (o) { return o.kind !== 'other'; });
      html += '<details class="sdr-details sdr-details--plain"' + (notable ? ' open' : '') + '><summary class="sdr-details-sum">Other TXT records (' + r.other.length + ')</summary><ul class="sdr-plain-list">' + r.other.map(function (o) {
        return '<li class="sdr-plain-item">' + (o.domain ? '<strong>' + escapeHtml(o.domain) + '</strong>: ' : '') + code(o.value.length > 80 ? o.value.slice(0, 80) + '…' : o.value) + ' — ' + escapeHtml(KIND_TEXT[o.kind] || KIND_TEXT.other) + '.</li>';
      }).join('') + '</ul></details>';
    }
    if (r.ignored.length) {
      html += '<details class="sdr-details sdr-details--plain"><summary class="sdr-details-sum">Lines that were not understood (' + r.ignored.length + ')</summary><ul class="sdr-plain-list">' + r.ignored.map(function (x) {
        return '<li class="sdr-plain-item">Line ' + x.line + ': ' + code(x.text.length > 90 ? x.text.slice(0, 90) + '…' : x.text) + '</li>';
      }).join('') + '</ul><p class="sdr-hint">Put each record on its own line starting with v=spf1 or v=DMARC1 (quotes are fine), with its name on the line before it followed by a colon.</p></details>';
    }
    return html;
  }

  // ── DOM: state, form and output ───────────────────────────

  var state = defaultState();
  var hashActive = false;
  var lastHash = '';
  var checkTimer = null;

  function setMsg(id, html) {
    var el = $(id);
    if (!el) return;
    el.innerHTML = html || '';
    el.classList.toggle('sdr-visible', !!html);
  }

  function radioValue(name) {
    var els = document.querySelectorAll('input[name="' + name + '"]');
    for (var i = 0; i < els.length; i++) if (els[i].checked) return els[i].value;
    return null;
  }

  function setRadio(name, value) {
    var els = document.querySelectorAll('input[name="' + name + '"]');
    for (var i = 0; i < els.length; i++) els[i].checked = els[i].value === value;
  }

  function renderServices() {
    ['mailbox', 'sending'].forEach(function (group) {
      var box = $('sdr-svc-' + group);
      if (!box) return;
      box.innerHTML = PROVIDERS.filter(function (p) { return p.group === group; }).map(function (p) {
        return '<label class="sdr-service" for="sdr-svc-' + p.id + '">'
          + '<input class="sdr-check-input" type="checkbox" id="sdr-svc-' + p.id + '" data-sdr-svc="' + p.id + '">'
          + '<span class="sdr-service-text"><span class="sdr-service-name">' + escapeHtml(p.name) + '</span>'
          + '<code class="sdr-service-inc">include:' + escapeHtml(p.include) + '</code>'
          + (p.note ? '<span class="sdr-service-note">' + escapeHtml(p.note) + '</span>' : '')
          + '<a class="sdr-service-link" href="' + p.url + '" target="_blank" rel="noopener noreferrer">Provider docs</a></span></label>';
      }).join('');
    });
  }

  function readForm() {
    state.d = $('sdr-domain').value.slice(0, 253);
    state.sub = $('sdr-sub').value.slice(0, 200);
    state.nomail = $('sdr-nomail').checked;
    state.svc = PROVIDERS.filter(function (p) { var el = $('sdr-svc-' + p.id); return el && el.checked; }).map(function (p) { return p.id; });
    state.ip4 = $('sdr-ip4').value.slice(0, MAX_FIELD);
    state.ip6 = $('sdr-ip6').value.slice(0, MAX_FIELD);
    state.a = $('sdr-a').checked;
    state.mx = $('sdr-mx').checked;
    state.inc = $('sdr-inc').value.slice(0, MAX_FIELD);
    state.all = radioValue('sdr-all') === '-' ? '-' : '~';
    state.p = radioValue('sdr-p') || 'none';
    state.sp = $('sdr-sp').value;
    state.np = $('sdr-np').value;
    state.adkim = $('sdr-adkim').value === 's' ? 's' : 'r';
    state.aspf = $('sdr-aspf').value === 's' ? 's' : 'r';
    state.t = $('sdr-t').checked;
    state.rua = $('sdr-rua').value.slice(0, MAX_FIELD);
    state.ruf = $('sdr-ruf').value.slice(0, MAX_FIELD);
    state.fo = radioValue('sdr-fo') === '1' ? '1' : '0';
    state.fod = $('sdr-fo-d').checked;
    state.fos = $('sdr-fo-s').checked;
  }

  function writeForm() {
    $('sdr-domain').value = state.d;
    $('sdr-sub').value = state.sub;
    $('sdr-nomail').checked = state.nomail;
    PROVIDERS.forEach(function (p) { var el = $('sdr-svc-' + p.id); if (el) el.checked = state.svc.indexOf(p.id) >= 0; });
    $('sdr-ip4').value = state.ip4;
    $('sdr-ip6').value = state.ip6;
    $('sdr-a').checked = state.a;
    $('sdr-mx').checked = state.mx;
    $('sdr-inc').value = state.inc;
    setRadio('sdr-all', state.all);
    setRadio('sdr-p', state.p);
    $('sdr-sp').value = state.sp;
    $('sdr-np').value = state.np;
    $('sdr-adkim').value = state.adkim;
    $('sdr-aspf').value = state.aspf;
    $('sdr-t').checked = state.t;
    $('sdr-rua').value = state.rua;
    $('sdr-ruf').value = state.ruf;
    setRadio('sdr-fo', state.fo);
    $('sdr-fo-d').checked = state.fod;
    $('sdr-fo-s').checked = state.fos;
  }

  var ALL_NOTE = {
    '~': '<strong>~all (softfail)</strong> marks mail from servers you did not list as suspicious without asking receivers to refuse it; they SHOULD NOT reject on softfail alone (RFC 7208 §8.5). With DMARC in place this is the usual choice: DMARC decides what happens, and a DKIM-signed message that was forwarded can still pass.',
    '-': '<strong>-all (fail)</strong> says servers you did not list are not authorized, and receivers may reject right away (RFC 7208 §8.4). Some do so early in the SMTP session, before DMARC runs: a message that would pass DMARC through DKIM is then lost, and the rejection never shows up in your DMARC reports (RFC 9989 §7.1). Use it when you are sure every sender is listed.'
  };

  var NOMAIL_NOTE = '<strong>v=spf1 -all</strong>: no server may send mail for this domain, so every sender gets fail (RFC 7208 §10.1.2). Pair it with a DMARC policy of reject below: with no legitimate mail, there is nothing for reject to break.';

  var P_NOTE = {
    none: 'Monitoring mode: nothing happens to failing mail, you only get reports. Start here, read the aggregate reports and fix every legitimate sender they show (RFC 9989 §5.1.4–5.1.6). Gmail, Yahoo and Outlook.com accept p=none from bulk senders.',
    quarantine: 'Failing mail goes to spam. Move here once the reports show your own mail passing. RFC 9989 §7.4 suggests at least a month on none, then as long on quarantine, comparing the results before going further. Test mode (t=y below) applies none instead, if you want a softer first step.',
    reject: 'Failing mail is refused. Only when all your mail is DKIM-signed: a domain with p=reject MUST NOT rely on SPF alone, because forwarding breaks SPF. Domains whose users post to mailing lists SHOULD NOT use reject (RFC 9989 §7.4). Test mode (t=y below) applies quarantine instead.'
  };

  function genOutHtml(kind, b) {
    if (!b.ok) return '<p class="sdr-empty">Enter a valid domain above to see the record.</p>';
    var html = '<div class="sdr-kv-grid">'
      + kvHtml('Type', 'TXT')
      + kvHtml('Name / host', kind === 'spf' ? code(b.host) + (b.host === '@' ? ' <span class="sdr-muted">(' + escapeHtml(b.name) + ')</span>' : ' <span class="sdr-muted">(' + escapeHtml(b.name) + ')</span>') : code(b.name.slice(0, b.name.length - b.domain.length - 1)) + ' <span class="sdr-muted">(' + escapeHtml(b.name) + ')</span>')
      + kvHtml('Length', b.value.length + ' characters' + (b.strings.length > 1 ? ', ' + b.strings.length + ' strings in the zone file' : ''))
      + '</div>';
    html += snippetHtml(kind + '-value', 'Value for your DNS panel', b.value);
    html += snippetHtml(kind + '-zone', 'BIND zone file line', b.zone);
    return html;
  }

  function renderGenerator() {
    var spf = buildSpf(state);
    var dm = buildDmarc(state);
    setMsg('sdr-domain-msg', spf.fieldErrors.d || '');
    setMsg('sdr-sub-msg', spf.fieldErrors.sub || '');
    setMsg('sdr-ip4-msg', spf.fieldErrors.ip4 || '');
    setMsg('sdr-ip6-msg', spf.fieldErrors.ip6 || '');
    setMsg('sdr-inc-msg', spf.fieldErrors.inc || '');
    setMsg('sdr-rua-msg', dm.fieldErrors.rua || '');
    setMsg('sdr-ruf-msg', dm.fieldErrors.ruf || '');

    var spfHtml = genOutHtml('spf', spf);
    if (spf.ok) {
      var lk = spf.lookups;
      var incNote = spf.includes.length ? ' Each include also costs whatever lookups are inside that provider\'s record: use <strong>Check these records</strong> and paste the providers\' records for the exact total.' : '';
      spfHtml += '<p class="sdr-text"><strong>' + plural(lk.total, 'DNS lookup') + '</strong> of the 10 allowed in this record.' + incNote + '</p>';
      spfHtml += issuesHtml(spf.issues);
      spfHtml += '<details class="sdr-details"><summary class="sdr-details-sum">Every term explained</summary>' + termsHtml(spf.parsed, spf.name) + '</details>';
    }
    $('sdr-spf-out').innerHTML = spfHtml;

    var dmHtml = genOutHtml('dmarc', dm);
    if (dm.ok) {
      dmHtml += issuesHtml(dm.issues);
      dmHtml += authListHtml(dm.auth, 'gen');
      dmHtml += '<details class="sdr-details"><summary class="sdr-details-sum">Every tag explained</summary>' + dmarcTagsHtml(dm.parsed, dm.domain) + '</details>';
    }
    $('sdr-dmarc-out').innerHTML = dmHtml;

    $('sdr-all-note').innerHTML = state.nomail ? NOMAIL_NOTE : ALL_NOTE[state.all];
    var allSeg = $('sdr-all-seg');
    if (allSeg) allSeg.classList.toggle('sdr-disabled', state.nomail);
    $('sdr-p-note').innerHTML = P_NOTE[state.p];
    var steps = document.querySelectorAll('.sdr-step');
    for (var i = 0; i < steps.length; i++) {
      var sp = steps[i].getAttribute('data-step');
      steps[i].classList.toggle('sdr-step--on', sp === state.p);
      steps[i].classList.toggle('sdr-step--done', POLICIES.indexOf(sp) < POLICIES.indexOf(state.p));
    }
    var senders = $('sdr-senders');
    if (senders) senders.classList.toggle('sdr-disabled', state.nomail);
    var fo = $('sdr-fo-wrap');
    if (fo) fo.classList.toggle('sdr-disabled', !String(state.ruf).trim());
  }

  function writeHash() {
    var h = encodeHash(state);
    lastHash = h;
    try { history.replaceState(null, '', h); } catch (e) { /* file:// or sandboxed frames */ }
  }

  function onGenInput() {
    readForm();
    hashActive = true;
    writeHash();
    renderGenerator();
  }

  function setMode(mode) {
    var check = mode === 'check';
    $('sdr-panel-gen').classList.toggle('sdr-hidden', check);
    $('sdr-panel-check').classList.toggle('sdr-hidden', !check);
    $('sdr-tab-gen').classList.toggle('sdr-active', !check);
    $('sdr-tab-check').classList.toggle('sdr-active', check);
    $('sdr-tab-gen').setAttribute('aria-selected', check ? 'false' : 'true');
    $('sdr-tab-check').setAttribute('aria-selected', check ? 'true' : 'false');
    $('sdr-tab-gen').tabIndex = check ? -1 : 0;
    $('sdr-tab-check').tabIndex = check ? 0 : -1;
    if (check) renderCheck();
  }

  function renderCheck() {
    var text = $('sdr-check-input').value;
    var out = $('sdr-check-results');
    if (!text.trim()) {
      out.innerHTML = '<p class="sdr-empty">Paste one or more records above, or load an example.</p>';
      return;
    }
    out.innerHTML = renderCheckResults(checkRecords(text, $('sdr-check-domain').value));
  }

  function scheduleCheck() {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(renderCheck, 200);
  }

  function checkGenerated() {
    var spf = buildSpf(state);
    var dm = buildDmarc(state);
    if (!spf.ok || !dm.ok) {
      showToast('Enter a valid domain first');
      return;
    }
    var lines = [spf.name + ':', spf.value, ''];
    spf.includes.forEach(function (d) {
      lines.push('# paste the record of ' + d + ' below its name, e.g. from: dig +short TXT ' + d);
      lines.push(d + ':');
      lines.push('');
    });
    lines.push(dm.name + ':', dm.value);
    $('sdr-check-domain').value = spf.domain;
    $('sdr-check-input').value = lines.join('\n');
    setMode('check');
    var panel = $('sdr-panel-check');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function loadExample(id) {
    var ex = EXAMPLES[id];
    if (!ex) return;
    $('sdr-check-domain').value = ex.domain;
    $('sdr-check-input').value = ex.text;
    renderCheck();
  }

  function clearCheck() {
    $('sdr-check-input').value = '';
    $('sdr-check-domain').value = '';
    renderCheck();
  }

  function resetAll() {
    state = defaultState();
    writeForm();
    hashActive = false;
    lastHash = '';
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    renderGenerator();
  }

  // ── Clipboard and toast ───────────────────────────────────

  function showToast(msg) {
    var t = $('sdr-toast');
    if (!t) return;
    t.textContent = msg || 'Copied';
    t.classList.add('sdr-show');
    setTimeout(function () { t.classList.remove('sdr-show'); }, 2000);
  }

  function copyText(text, msg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      showToast(msg);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast(msg); }, fallback);
    } else {
      fallback();
    }
  }

  function copyLink() {
    readForm();
    hashActive = true;
    writeHash();
    copyText(location.href.split('#')[0] + encodeHash(state), 'Link copied');
  }

  // ── Init ──────────────────────────────────────────────────

  function init() {
    var wrap = $('sdr-wrapper');
    if (!wrap) return;
    renderServices();
    if (isStateHash(location.hash)) {
      state = decodeHash(location.hash);
      hashActive = true;
      lastHash = location.hash;
    }
    writeForm();
    $('sdr-panel-gen').addEventListener('input', onGenInput);
    $('sdr-panel-gen').addEventListener('change', onGenInput);
    $('sdr-check-input').addEventListener('input', scheduleCheck);
    $('sdr-check-domain').addEventListener('input', scheduleCheck);
    wrap.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-sdr-copy]') : null;
      if (btn) {
        var key = btn.getAttribute('data-sdr-copy');
        if (copyStore[key] != null) copyText(copyStore[key]);
        return;
      }
      var ex = ev.target.closest ? ev.target.closest('[data-sdr-example]') : null;
      if (ex) loadExample(ex.getAttribute('data-sdr-example'));
    });
    $('sdr-tabs').addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      var toCheck = $('sdr-tab-gen').classList.contains('sdr-active');
      setMode(toCheck ? 'check' : 'gen');
      $(toCheck ? 'sdr-tab-check' : 'sdr-tab-gen').focus();
      ev.preventDefault();
    });
    window.addEventListener('hashchange', function () {
      if (location.hash === lastHash || !isStateHash(location.hash)) return;
      state = decodeHash(location.hash);
      lastHash = location.hash;
      hashActive = true;
      writeForm();
      renderGenerator();
    });
    renderGenerator();
    renderCheck();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Global handlers for onclick attributes
  window.sdrSetMode = setMode;
  window.sdrCopyLink = copyLink;
  window.sdrReset = resetAll;
  window.sdrCheckGenerated = checkGenerated;
  window.sdrClearCheck = clearCheck;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      PROVIDERS: PROVIDERS,
      SPF_LIMIT: SPF_LIMIT,
      EXAMPLES: EXAMPLES,
      escapeHtml: escapeHtml,
      suggest: suggest,
      refUrl: refUrl,
      refLabel: refLabel,
      toAsciiDomain: toAsciiDomain,
      hostnameProblem: hostnameProblem,
      normalizeDomain: normalizeDomain,
      orgDomainGuess: orgDomainGuess,
      sameOrg: sameOrg,
      parseIp4: parseIp4,
      parseIp6: parseIp6,
      formatIp6: formatIp6,
      parseCidr: parseCidr,
      ip4Info: ip4Info,
      ip6Info: ip6Info,
      scanMacroString: scanMacroString,
      parseTerm: parseTerm,
      parseSpf: parseSpf,
      isSpfRecord: isSpfRecord,
      explainTerm: explainTerm,
      analyzeSpfTree: analyzeSpfTree,
      lookupIssues: lookupIssues,
      parseTxtRdata: parseTxtRdata,
      parseRecordsInput: parseRecordsInput,
      classifyTxt: classifyTxt,
      parseFo: parseFo,
      parseDmarcUri: parseDmarcUri,
      parseDmarc: parseDmarc,
      explainDmarcTag: explainDmarcTag,
      externalDestinations: externalDestinations,
      checkRecords: checkRecords,
      splitTxt: splitTxt,
      quoteTxtString: quoteTxtString,
      zoneLine: zoneLine,
      buildSpf: buildSpf,
      buildDmarc: buildDmarc,
      blankState: blankState,
      defaultState: defaultState,
      encodeHash: encodeHash,
      decodeHash: decodeHash,
      isStateHash: isStateHash,
      renderCheckResults: renderCheckResults
    };
  }
})();
