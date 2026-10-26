// Traefik Docker Labels Generator — script.js
// Namespace prefix: tdl-
// No external dependencies. Everything runs in the browser; the htpasswd line
// never leaves the page and is never written to the URL hash.
//
// Facts used below come from primary sources read on 2026-10-26:
// - Traefik docs and source at v3.7.16 and v2.11.60 (Docker provider labels,
//   router rules, entrypoints, TLS, BasicAuth, IPAllowList/IPWhiteList,
//   Headers, RedirectScheme, StripPrefix, v2 to v3 migration notes).
// - Traefik's BasicAuth hash check: github.com/containous/go-http-auth
//   (the fork pinned in Traefik v3.7.16 go.mod): MD5-crypt ($apr1$, $1$),
//   {SHA} and bcrypt ($2a$, $2b$, $2x$, $2y$) only.
// - Compose Specification (interpolation, labels, networks), 2026-10-23.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // Code spans in messages are wrapped in two control characters so the
  // renderer can turn them into <code> without parsing backticks, which
  // Traefik rules contain themselves.
  var CS = String.fromCharCode(1);
  var CE = String.fromCharCode(2);
  function c(x) { return CS + x + CE; }
  function plain(text) { return String(text).split(CS).join('').split(CE).join(''); }

  var BT = '`';
  var MAX_LEN = 4000;

  // ── Versions ─────────────────────────────────────────────

  var VERSIONS = {
    '3': {
      name: 'Traefik v3', syntax: 'v3', allow: 'ipAllowList',
      hint: 'v3 rule syntax: each Host() takes one domain, so several are joined with ||. If your v3 runs with ' +
        c('core.defaultRuleSyntax: v2') + ', pick v2.11.'
    },
    '2.11': {
      name: 'Traefik v2.11', syntax: 'v2', allow: 'ipAllowList',
      hint: 'v2 rule syntax (Host() takes a list of domains) and ' + c('ipAllowList') + ', which v2.11 added and v3 kept.'
    },
    '2.10': {
      name: 'Traefik v2.10 or older', syntax: 'v2', allow: 'ipWhiteList',
      hint: 'v2 rule syntax and ' + c('ipWhiteList') + ': releases before v2.11 have no ' + c('ipAllowList') + '.'
    }
  };

  var DOC = 'https://doc.traefik.io/traefik/';
  var DOCS = {
    docker: DOC + 'reference/routing-configuration/other-providers/docker/',
    network: DOC + 'reference/routing-configuration/other-providers/docker/#opt-traefik-docker-network',
    enable: DOC + 'reference/routing-configuration/other-providers/docker/#opt-traefik-enable',
    provider: DOC + 'reference/install-configuration/providers/docker/',
    rules: DOC + 'reference/routing-configuration/http/routing/rules-and-priority/',
    hostRule: DOC + 'reference/routing-configuration/http/routing/rules-and-priority/#host-and-hostregexp',
    pathRule: DOC + 'reference/routing-configuration/http/routing/rules-and-priority/#path-pathprefix-and-pathregexp',
    v2rules: DOC + 'v2.11/routing/routers/#rule',
    tls: DOC + 'reference/routing-configuration/http/tls/overview/',
    entrypoints: DOC + 'reference/install-configuration/entrypoints/',
    acme: DOC + 'reference/install-configuration/tls/certificate-resolvers/acme/',
    wildcard: DOC + 'reference/install-configuration/tls/certificate-resolvers/acme/#wildcard-domains',
    service: DOC + 'reference/routing-configuration/http/load-balancing/service/',
    transport: DOC + 'reference/routing-configuration/http/load-balancing/serverstransport/',
    basicauth: DOC + 'reference/routing-configuration/http/middlewares/basicauth/',
    ipallowlist: DOC + 'reference/routing-configuration/http/middlewares/ipallowlist/',
    ipStrategy: DOC + 'reference/routing-configuration/http/middlewares/ipallowlist/#ipstrategy',
    ipwhitelist: DOC + 'v2.11/middlewares/http/ipwhitelist/',
    headers: DOC + 'reference/routing-configuration/http/middlewares/headers/',
    redirect: DOC + 'reference/routing-configuration/http/middlewares/redirectscheme/',
    strip: DOC + 'reference/routing-configuration/http/middlewares/stripprefix/',
    migrate: DOC + 'migrate/v2-to-v3-details/',
    file: DOC + 'reference/install-configuration/providers/others/file/',
    interpolation: 'https://docs.docker.com/reference/compose-file/interpolation/',
    networks: 'https://docs.docker.com/reference/compose-file/networks/'
  };

  // ── State ────────────────────────────────────────────────

  function defaultState() {
    return {
      v: '3',
      svc: 'whoami',
      img: 'traefik/whoami',
      router: '',
      domains: 'whoami.example.com',
      path: '',
      strip: false,
      eps: 'websecure',
      port: '80',
      scheme: 'http',
      tls: true,
      resolver: 'letsencrypt',
      redirect: 'router',
      httpEp: 'web',
      enable: true,
      net: 'proxy',
      ext: true,
      project: '',
      hdr: false,
      sts: '31536000',
      stsSub: false,
      frame: 'DENY',
      nosniff: true,
      referrer: 'strict-origin-when-cross-origin',
      ipOn: false,
      ips: '192.168.1.0/24',
      auth: false,
      users: ''
    };
  }

  var ENUMS = {
    v: ['3', '2.11', '2.10'],
    scheme: ['http', 'https'],
    redirect: ['router', 'entrypoint', 'none'],
    sts: ['0', '86400', '15552000', '31536000', '63072000'],
    frame: ['DENY', 'SAMEORIGIN', 'off'],
    referrer: ['strict-origin-when-cross-origin', 'same-origin', 'strict-origin', 'no-referrer', 'off']
  };
  var BOOLS = ['strip', 'tls', 'enable', 'ext', 'hdr', 'stsSub', 'nosniff', 'ipOn', 'auth'];

  // URL hash keys. "users" (the htpasswd line) is deliberately missing.
  var HASH_KEYS = {
    v: 'v', svc: 's', img: 'i', router: 'r', domains: 'd', path: 'p', strip: 'sp', eps: 'ep', port: 'pt',
    scheme: 'sc', tls: 't', resolver: 'cr', redirect: 'rd', httpEp: 'he', enable: 'en', net: 'n', ext: 'x',
    project: 'pj', hdr: 'h', sts: 'hs', stsSub: 'hi', frame: 'hf', nosniff: 'hn', referrer: 'hr',
    ipOn: 'ia', ips: 'ip', auth: 'ba'
  };

  function normalizeState(raw) {
    var d = defaultState();
    var s = {};
    raw = raw || {};
    Object.keys(d).forEach(function (k) {
      var val = raw[k];
      if (ENUMS[k]) {
        s[k] = ENUMS[k].indexOf(String(val)) >= 0 ? String(val) : d[k];
      } else if (BOOLS.indexOf(k) >= 0) {
        if (typeof val === 'boolean') s[k] = val;
        else if (val === '1' || val === '0') s[k] = val === '1';
        else s[k] = d[k];
      } else if (typeof val === 'string') {
        s[k] = val.slice(0, MAX_LEN);
      } else if (typeof val === 'number' && isFinite(val)) {
        s[k] = String(val);
      } else {
        s[k] = d[k];
      }
    });
    return s;
  }

  function encodeHash(state) {
    var s = normalizeState(state);
    var d = defaultState();
    var parts = [];
    Object.keys(HASH_KEYS).forEach(function (k) {
      if (s[k] === d[k]) return;
      var val = BOOLS.indexOf(k) >= 0 ? (s[k] ? '1' : '0') : s[k];
      parts.push(HASH_KEYS[k] + '=' + encodeURIComponent(val));
    });
    return parts.length ? '#' + parts.join('&') : '';
  }

  function decodeHash(hash) {
    var raw = {};
    var byShort = {};
    Object.keys(HASH_KEYS).forEach(function (k) { byShort[HASH_KEYS[k]] = k; });
    String(hash || '').replace(/^#/, '').split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 1) return;
      var key = byShort[pair.slice(0, i)];
      if (!key) return;
      var val;
      try { val = decodeURIComponent(pair.slice(i + 1)); } catch (e) { return; }
      raw[key] = val;
    });
    var s = normalizeState(raw);
    s.users = '';
    return s;
  }

  // ── Validation helpers ───────────────────────────────────

  var SERVICE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;      // Compose schema: ^[a-zA-Z0-9._-]+$
  var NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;                // router, service and middleware names
  var EP_RE = /^[A-Za-z0-9_-]+$/;                        // entrypoint and resolver names
  var NETWORK_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
  var PROJECT_RE = /^[a-z0-9][a-z0-9_-]*$/;
  var IMAGE_RE = /^[A-Za-z0-9._\/:@-]+$/;
  var PATH_RE = /^\/[A-Za-z0-9._~%@:+\/-]*$/;
  var HOST_LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  var PRIVATE_TLDS = ['local', 'lan', 'home', 'internal', 'localhost', 'test', 'invalid', 'example', 'arpa', 'localdomain', 'corp', 'intranet'];

  function splitList(text) {
    return String(text || '').split(/[\s,]+/).filter(function (x) { return x !== ''; });
  }

  function uniq(list) {
    var seen = {};
    return list.filter(function (x) {
      if (seen[x]) return false;
      seen[x] = true;
      return true;
    });
  }

  // Derive a router name from the Compose service name.
  function deriveName(svc) {
    return String(svc || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  }

  function validateName(name) {
    if (!name) return 'empty';
    if (name.indexOf('@') >= 0) return 'at';
    if (name.indexOf('.') >= 0) return 'dot';
    if (/[A-Z]/.test(name)) return 'upper';
    if (!NAME_RE.test(name)) return 'chars';
    return '';
  }

  function validatePort(text) {
    var t = String(text || '').trim();
    if (!/^[0-9]{1,5}$/.test(t)) return null;
    var n = parseInt(t, 10);
    if (n < 1 || n > 65535 || String(n) !== t) return null;
    return n;
  }

  function parseIPv4(text) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
    if (!m) return null;
    var out = [];
    for (var i = 1; i <= 4; i++) {
      // Go's net.ParseIP (used by Traefik) rejects leading zeros since Go 1.17.
      if (m[i].length > 1 && m[i].charAt(0) === '0') return null;
      var n = parseInt(m[i], 10);
      if (n > 255) return null;
      out.push(n);
    }
    return out;
  }

  // Returns 8 groups of 16 bits, or null.
  function parseIPv6(text) {
    if (!/^[0-9a-fA-F:.]+$/.test(text)) return null;
    var halves = text.split('::');
    if (halves.length > 2) return null;
    function groups(part) {
      if (part === '') return [];
      var bits = part.split(':');
      var out = [];
      for (var i = 0; i < bits.length; i++) {
        var b = bits[i];
        if (i === bits.length - 1 && b.indexOf('.') >= 0) {
          var v4 = parseIPv4(b);
          if (!v4) return null;
          out.push(v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]);
        } else {
          if (!/^[0-9a-fA-F]{1,4}$/.test(b)) return null;
          out.push(parseInt(b, 16));
        }
      }
      return out;
    }
    var head = groups(halves[0]);
    var tail = halves.length === 2 ? groups(halves[1]) : [];
    if (!head || !tail) return null;
    if (halves.length === 1) return head.length === 8 ? head : null;
    // An embedded IPv4 is only allowed at the very end.
    if (halves[0].indexOf('.') >= 0) return null;
    var fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    var res = head.slice();
    for (var i = 0; i < fill; i++) res.push(0);
    return res.concat(tail);
  }

  // True when any bit after the prefix is set (words are 8-bit or 16-bit units).
  function hostBitsSet(words, bitsPerWord, prefix) {
    for (var i = 0; i < words.length; i++) {
      var keep = Math.max(0, Math.min(bitsPerWord, prefix - i * bitsPerWord));
      if (words[i] % Math.pow(2, bitsPerWord - keep) !== 0) return true;
    }
    return false;
  }

  function networkAddress(words, bitsPerWord, prefix, v6) {
    var out = [];
    for (var i = 0; i < words.length; i++) {
      var keep = Math.max(0, Math.min(bitsPerWord, prefix - i * bitsPerWord));
      var unit = Math.pow(2, bitsPerWord - keep);
      out.push(Math.floor(words[i] / unit) * unit);
    }
    if (!v6) return out.join('.') + '/' + prefix;
    return compressV6(out) + '/' + prefix;
  }

  function compressV6(words) {
    var hex = words.map(function (w) { return w.toString(16); });
    var best = -1, bestLen = 0;
    for (var i = 0; i < 8; i++) {
      if (words[i] !== 0) continue;
      var j = i;
      while (j < 8 && words[j] === 0) j++;
      if (j - i > bestLen && j - i > 1) { best = i; bestLen = j - i; }
      i = j;
    }
    if (best < 0) return hex.join(':');
    return hex.slice(0, best).join(':') + '::' + hex.slice(best + bestLen).join(':');
  }

  // Validates one IP or CIDR the way Go's net.ParseIP / net.ParseCIDR read it.
  function validateCidr(text) {
    var t = String(text || '').trim();
    var res = { ok: false, value: t, v6: false, cidr: false, all: false, network: '', error: '' };
    if (!t) { res.error = 'empty'; return res; }
    if (t.indexOf('%') >= 0) { res.error = 'zone'; return res; }
    var slash = t.split('/');
    if (slash.length > 2) { res.error = 'format'; return res; }
    var addr = slash[0];
    var v4 = parseIPv4(addr);
    var v6 = v4 ? null : parseIPv6(addr);
    if (!v4 && !v6) { res.error = /^[0-9.]+$/.test(addr) ? 'ipv4' : 'format'; return res; }
    res.v6 = !!v6;
    if (slash.length === 2) {
      var p = slash[1];
      var max = v6 ? 128 : 32;
      if (!/^[0-9]{1,3}$/.test(p) || (p.length > 1 && p.charAt(0) === '0') || parseInt(p, 10) > max) {
        res.error = 'prefix';
        res.max = max;
        return res;
      }
      var prefix = parseInt(p, 10);
      res.cidr = true;
      res.all = prefix === 0;
      if (v4 ? hostBitsSet(v4, 8, prefix) : hostBitsSet(v6, 16, prefix)) {
        res.network = v4 ? networkAddress(v4, 8, prefix, false) : networkAddress(v6, 16, prefix, true);
      }
    }
    res.ok = true;
    return res;
  }

  function looksPrivateHost(host) {
    if (host.indexOf('.') < 0) return true;
    return PRIVATE_TLDS.indexOf(host.split('.').pop()) >= 0;
  }

  // Validates one host name for Host(). Returns { ok, host, wildcard, ip, error }.
  function validateHost(text, v) {
    var raw = String(text || '').trim();
    var res = { ok: false, input: raw, host: '', wildcard: false, ip: false, lowered: false, error: '' };
    var t = raw;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
      res.error = 'Enter the host name only: ' + c(t.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[\/:]/)[0] || 'example.com') +
        ', not ' + c(raw) + '.';
      return res;
    }
    if (t.indexOf('/') >= 0) {
      res.error = c(raw) + ' contains a path. Put the host in Domains and the path (e.g. ' + c('/' + t.split('/').slice(1).join('/')) +
        ') in Path prefix.';
      return res;
    }
    if (/:[0-9]*$/.test(t) && t.indexOf('[') < 0) {
      res.error = 'Leave the port out of ' + c(raw) + ': Host() matches the host name without the port, whatever port the entrypoint uses.';
      return res;
    }
    if (/[^\x20-\x7e]/.test(t)) {
      res.error = c(raw) + ' has non-ASCII characters. Traefik\'s Host() only takes ASCII: use the punycode form (' + c('xn--…') + ').';
      return res;
    }
    var lower = t.toLowerCase();
    if (lower !== t) res.lowered = true;
    t = lower;
    if (t === '*') {
      res.error = 'A bare ' + c('*') + ' is a catch-all, not a domain. Enter a host name such as ' + c('app.example.com') + '.';
      return res;
    }
    if (t.slice(-1) === '.') {
      res.error = 'Remove the trailing dot from ' + c(raw) + '.';
      return res;
    }
    var name = t;
    if (t.indexOf('*.') === 0) {
      res.wildcard = true;
      name = t.slice(2);
      if (v !== '3') {
        res.error = c(raw) + ': wildcards in Host() need Traefik v3.7 or newer. On v2 use HostRegexp, e.g. ' +
          c('HostRegexp(' + BT + '{sub:[a-z0-9-]+}.' + name + BT + ')') + ', and write that rule by hand.';
        return res;
      }
      if (name.indexOf('.') < 0) {
        res.error = c(raw) + ': put the wildcard in front of a domain with at least two labels, e.g. ' + c('*.example.com') + '.';
        return res;
      }
    }
    if (name.indexOf('*') >= 0) {
      res.error = c(raw) + ': only one leading ' + c('*.') + ' is supported, and it matches exactly one subdomain level.';
      return res;
    }
    if (name.length > 253) {
      res.error = c(raw.slice(0, 40) + '…') + ' is longer than 253 characters.';
      return res;
    }
    var labels = name.split('.');
    for (var i = 0; i < labels.length; i++) {
      var l = labels[i];
      if (l === '') { res.error = c(raw) + ' has an empty label (two dots in a row).'; return res; }
      if (l.length > 63) { res.error = 'The label ' + c(l.slice(0, 20) + '…') + ' in ' + c(raw) + ' is longer than 63 characters.'; return res; }
      if (l.indexOf('_') >= 0) { res.error = c(raw) + ' contains ' + c('_') + ', which is not allowed in host names.'; return res; }
      if (!HOST_LABEL_RE.test(l)) {
        res.error = c(raw) + ': each label may use a-z, 0-9 and ' + c('-') + ', and must not start or end with ' + c('-') + '.';
        return res;
      }
    }
    if (!res.wildcard && parseIPv4(name)) res.ip = true;
    else if (/^[0-9.]+$/.test(name)) { res.error = c(raw) + ' is neither a host name nor a valid IPv4 address.'; return res; }
    res.ok = true;
    res.host = t;
    return res;
  }

  function validatePath(text) {
    var p = String(text || '').trim();
    if (!p) return { ok: true, path: '' };
    if (p.charAt(0) !== '/') return { ok: false, error: 'Path prefix must start with ' + c('/') + ', e.g. ' + c('/' + p.replace(/^\/*/, '')) + '.' };
    if (p === '/') return { ok: false, error: c('PathPrefix(' + BT + '/' + BT + ')') + ' matches every path. Leave Path prefix empty instead.' };
    if (!PATH_RE.test(p)) {
      return {
        ok: false,
        error: 'Path prefix ' + c(p) + ' may only use letters, digits and ' + c('- . _ ~ / % @ : +') +
          '. Backticks, quotes, spaces, ' + c('$') + ' and ' + c('{ }') + ' would break the rule or the Compose file.'
      };
    }
    if (p.indexOf('//') >= 0) return { ok: false, error: 'Remove the double slash from ' + c(p) + '.' };
    return { ok: true, path: p };
  }

  // One htpasswd line → { ok, user, hash, kind, error }.
  function parseHtpasswdLine(line, n) {
    var t = String(line).replace(/\r$/, '').trim();
    var res = { ok: false, user: '', hash: '', kind: '', error: '', line: n };
    var where = 'Line ' + n;
    if (/\s/.test(t)) {
      res.error = where + ' contains a space or tab. Paste one ' + c('user:hash') + ' pair per line, nothing else.';
      return res;
    }
    var parts = t.split(':');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      res.error = where + ' is not ' + c('user:hash') + ' with exactly one colon. Traefik splits each entry on ' + c(':') +
        ' and rejects anything else; ' + c('htpasswd -nB admin') + ' prints the right format.';
      return res;
    }
    var user = parts[0];
    var hash = parts[1];
    res.user = user;
    where = where + ' (' + c(user) + ')';
    if (user.indexOf(',') >= 0 || hash.indexOf(',') >= 0) {
      res.error = where + ' contains a comma, which separates users in the label. Remove it.';
      return res;
    }
    if (hash.indexOf('$$') >= 0) {
      res.error = where + ' already has doubled ' + c('$$') + '. Paste the raw ' + c('htpasswd') +
        ' output: this tool doubles every ' + c('$') + ' for Compose itself, and the file-provider YAML needs single ' + c('$') + '.';
      return res;
    }
    if (/^\$2[abxy]\$/.test(hash)) {
      if (!/^\$2[abxy]\$[0-9]{2}\$[.\/A-Za-z0-9]{53}$/.test(hash)) {
        res.error = where + ': this bcrypt hash looks cut off (expected 60 characters). Copy the whole line again.';
        return res;
      }
      res.kind = 'bcrypt';
    } else if (/^\$(apr1|1)\$/.test(hash)) {
      if (!/^\$(apr1|1)\$[.\/0-9A-Za-z]{0,8}\$[.\/0-9A-Za-z]{22}$/.test(hash)) {
        res.error = where + ': this MD5 hash looks cut off. Copy the whole line again.';
        return res;
      }
      res.kind = 'md5';
    } else if (hash.indexOf('{SHA}') === 0) {
      if (!/^\{SHA\}[A-Za-z0-9+\/]{27}=$/.test(hash)) {
        res.error = where + ': this {SHA} hash looks cut off (expected 28 base64 characters). Copy the whole line again.';
        return res;
      }
      res.kind = 'sha1';
    } else if (/^\$(5|6|y|gy|7|argon2[a-z]*|sha1|md5|bcrypt-sha256|pbkdf2[a-z0-9-]*)\$/.test(hash)) {
      var scheme = hash.split('$')[1];
      var from = {
        '5': 'SHA-256-crypt, e.g. from ' + c('openssl passwd -5'),
        '6': 'SHA-512-crypt, e.g. from ' + c('openssl passwd -6') + ' or ' + c('mkpasswd'),
        'y': 'yescrypt, e.g. from ' + c('mkpasswd') + ' or a Linux shadow file',
        'gy': 'gost-yescrypt'
      }[scheme] || 'a scheme Traefik does not implement';
      res.error = where + ' uses ' + c('$' + scheme + '$') + ' (' + from + '). Traefik\'s BasicAuth only accepts MD5 (' + c('$apr1$') + '), SHA1 (' +
        c('{SHA}') + ') and bcrypt (' + c('$2y$') + '), so this password would never match. Create the line with ' +
        c('htpasswd -nB ' + user) + '.';
      return res;
    } else {
      res.error = where + ' has no hash Traefik recognises. Traefik never accepts a plain-text password: anything that is not ' +
        c('{SHA}') + ' or bcrypt is checked as MD5-crypt and fails. Create the line with ' + c('htpasswd -nB ' + user) + '.';
      return res;
    }
    res.hash = hash;
    res.ok = true;
    return res;
  }

  function parseHtpasswd(text) {
    var out = { entries: [], errors: [] };
    String(text || '').split('\n').forEach(function (line, i) {
      if (line.trim() === '') return;
      var r = parseHtpasswdLine(line, i + 1);
      if (r.ok) out.entries.push(r);
      else out.errors.push(r.error);
    });
    return out;
  }

  // ── Escaping ─────────────────────────────────────────────

  // Compose interpolates $VAR and ${VAR} in every value, labels included.
  // "$$" is the documented way to get a literal "$".
  function composeEscape(v) { return String(v).split('$').join('$$'); }

  // YAML double-quoted scalar. Inputs are validated printable ASCII, so only
  // the backslash and the double quote need escaping.
  function yq(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

  function bt(x) { return BT + x + BT; }

  // ── Rules ────────────────────────────────────────────────

  function buildRule(hosts, path, syntax) {
    var hostPart;
    if (syntax === 'v2') {
      hostPart = 'Host(' + hosts.map(bt).join(', ') + ')';
    } else {
      hostPart = hosts.map(function (h) { return 'Host(' + bt(h) + ')'; }).join(' || ');
      if (path && hosts.length > 1) hostPart = '(' + hostPart + ')';
    }
    return path ? hostPart + ' && PathPrefix(' + bt(path) + ')' : hostPart;
  }

  function looksHttps(ep) {
    var e = ep.toLowerCase();
    if (e === 'insecure' || e.indexOf('insecure') >= 0) return false;
    return /secure|https|tls|ssl|443/.test(e);
  }

  function looksPlain(ep) {
    var e = ep.toLowerCase();
    return e === 'web' || e === 'http' || e === 'insecure' || /(^|[^0-9])80$/.test(e);
  }

  // ── Generator ────────────────────────────────────────────

  function generate(input) {
    var s = normalizeState(input);
    var ver = VERSIONS[s.v];
    var issues = [];
    function add(level, field, text, doc) { issues.push({ level: level, field: field, text: text, doc: doc || '' }); }

    // Service and names
    var svc = s.svc.trim();
    if (!svc) add('error', 'svc', 'Enter the Compose service name, e.g. ' + c('whoami') + '.');
    else if (!SERVICE_RE.test(svc)) {
      add('error', 'svc', c(svc) + ' is not a valid Compose service name. Use letters, digits, ' + c('.') + ', ' + c('_') +
        ' and ' + c('-') + ', starting with a letter or digit.');
    }

    var routerRaw = s.router.trim();
    var base = routerRaw || deriveName(svc);
    var nameErr = routerRaw ? validateName(routerRaw) : '';
    if (nameErr) {
      var why = {
        at: c('@') + ' separates a name from its provider (' + c('name@docker') + ') and is not allowed in names',
        dot: 'a dot would split the label key, so Traefik would read a different name',
        upper: 'Traefik reads label keys case-insensitively, so mixed case invites references that do not match',
        chars: 'only lowercase letters, digits, ' + c('-') + ' and ' + c('_') + ' are used here, starting with a letter or digit'
      }[nameErr];
      add('error', 'router', 'Router name ' + c(routerRaw) + ': ' + why + '. Try ' + c(deriveName(routerRaw.split('@')[0]) || 'myapp') + '.',
        DOCS.docker);
    } else if (!routerRaw && svc && SERVICE_RE.test(svc) && !NAME_RE.test(base)) {
      add('error', 'router', 'Cannot derive a router name from ' + c(svc) + '. Enter one, e.g. ' + c('myapp') + '.');
    }

    var img = s.img.trim();
    if (img && !IMAGE_RE.test(img)) {
      add('error', 'img', 'Image ' + c(img) + ' contains characters an image reference cannot have (spaces, quotes or ' + c('$') + ').');
    }

    // Domains
    var hosts = [];
    var wildcard = false;
    var ipHost = '';
    var privateHost = '';
    var rawHosts = splitList(s.domains);
    if (!rawHosts.length) add('error', 'domains', 'Enter at least one domain, e.g. ' + c('app.example.com') + '.');
    var lowered = [];
    rawHosts.forEach(function (h) {
      var r = validateHost(h, s.v);
      if (!r.ok) { add('error', 'domains', r.error, r.wildcard ? DOCS.v2rules : DOCS.hostRule); return; }
      if (r.lowered) lowered.push(r.input);
      if (r.wildcard) wildcard = r.host;
      if (r.ip) ipHost = r.host;
      else if (!r.wildcard && looksPrivateHost(r.host)) privateHost = privateHost || r.host;
      hosts.push(r.host);
    });
    var dupes = hosts.length - uniq(hosts).length;
    hosts = uniq(hosts);
    if (lowered.length) add('info', 'domains', 'Host names were lowercased (' + lowered.map(c).join(', ') + '). Traefik lowercases them too.');
    if (dupes) add('info', 'domains', 'Removed ' + dupes + ' duplicate domain' + (dupes > 1 ? 's' : '') + '.');

    // Path
    var pathRes = validatePath(s.path);
    var path = '';
    if (!pathRes.ok) add('error', 'path', pathRes.error, DOCS.pathRule);
    else path = pathRes.path;

    // Entrypoints
    var eps = uniq(splitList(s.eps));
    if (!eps.length) add('error', 'eps', 'Enter at least one entrypoint name from your static config, e.g. ' + c('websecure') + '.', DOCS.entrypoints);
    eps.forEach(function (e) {
      if (!EP_RE.test(e)) add('error', 'eps', 'Entrypoint ' + c(e) + ': use letters, digits, ' + c('-') + ' and ' + c('_') + ', as in the static config.', DOCS.entrypoints);
    });

    // Port
    var port = validatePort(s.port);
    if (port === null) add('error', 'port', 'Container port ' + c(s.port.trim() || ' ') + ' must be a whole number from 1 to 65535, e.g. ' + c('8080') + '.');

    // TLS
    var tls = s.tls;
    var resolver = s.resolver.trim();
    if (tls && resolver && !EP_RE.test(resolver)) {
      add('error', 'resolver', 'Certificate resolver ' + c(resolver) + ': use letters, digits, ' + c('-') + ' and ' + c('_') +
        ', exactly as under ' + c('certificatesResolvers') + ' in the static config.', DOCS.acme);
    }
    var redirect = tls ? s.redirect : 'none';
    var httpEp = s.httpEp.trim() || 'web';
    // The plain-HTTP entrypoint serves the redirect and the ACME HTTP-01 challenge.
    if (tls && !EP_RE.test(httpEp)) {
      add('error', 'httpEp', 'Plain-HTTP entrypoint ' + c(httpEp) + ': use letters, digits, ' + c('-') + ' and ' + c('_') + '.', DOCS.entrypoints);
    }

    // Network
    var net = s.net.trim();
    var project = s.project.trim();
    var dockerNet = '';
    if (net) {
      if (!NETWORK_RE.test(net)) {
        add('error', 'net', 'Network ' + c(net) + ': use letters, digits, ' + c('_') + ', ' + c('.') + ' and ' + c('-') + ', starting with a letter or digit.', DOCS.networks);
      } else if (s.ext) {
        dockerNet = net;
      } else if (!project) {
        add('error', 'project', 'Enter the Compose project name. A network defined in this file is created as ' +
          c('<project>_' + net) + ', and ' + c('traefik.docker.network') + ' needs that full name.', DOCS.network);
      } else if (!PROJECT_RE.test(project)) {
        add('error', 'project', 'Project name ' + c(project) + ': Compose allows lowercase letters, digits, ' + c('-') + ' and ' + c('_') +
          ', starting with a letter or digit.');
      } else {
        dockerNet = project + '_' + net;
      }
    }

    // Middlewares: inputs
    var users = [];
    if (s.auth) {
      var ht = parseHtpasswd(s.users);
      ht.errors.forEach(function (e) { add('error', 'users', e, DOCS.basicauth); });
      if (!ht.entries.length && !ht.errors.length) {
        add('error', 'users', 'Paste at least one htpasswd line (' + c('user:hash') + '), or turn basic auth off.', DOCS.basicauth);
      }
      users = ht.entries;
    }
    var ranges = [];
    if (s.ipOn) {
      var rawRanges = uniq(splitList(s.ips));
      if (!rawRanges.length) add('error', 'ips', 'Enter at least one IP or CIDR range, e.g. ' + c('192.168.1.0/24') + ', or turn the allowlist off.', DOCS.ipallowlist);
      rawRanges.forEach(function (r) {
        var v = validateCidr(r);
        if (!v.ok) {
          var msg = {
            zone: c(r) + ': zone IDs (' + c('%eth0') + ') are not accepted in a source range.',
            prefix: c(r) + ': the prefix length must be 0 to ' + (v.max || 32) + ' without leading zeros.',
            ipv4: c(r) + ' is not a valid IPv4 address: four numbers from 0 to 255, without leading zeros.',
            format: c(r) + ' is not an IP address or CIDR range. Examples: ' + c('192.168.1.0/24') + ', ' + c('10.0.0.5') + ', ' + c('fd00::/8') + '.'
          }[v.error] || c(r) + ' is not valid.';
          add('error', 'ips', msg, DOCS.ipallowlist);
          return;
        }
        if (v.network) {
          add('info', 'ips', c(r) + ' has host bits set. Traefik (Go\'s net.ParseCIDR) reads it as ' + c(v.network) + '.');
        }
        if (v.all) add('warn', 'ips', c(r) + ' allows every ' + (v.v6 ? 'IPv6' : 'IPv4') + ' address, so the allowlist blocks nothing.');
        ranges.push(r);
      });
    }

    var hdr = null;
    if (s.hdr) {
      hdr = {};
      if (s.sts !== '0') {
        hdr.stsSeconds = parseInt(s.sts, 10);
        if (s.stsSub) hdr.stsIncludeSubdomains = true;
      }
      if (s.frame === 'DENY') hdr.frameDeny = true;
      else if (s.frame === 'SAMEORIGIN') hdr.customFrameOptionsValue = 'SAMEORIGIN';
      if (s.nosniff) hdr.contentTypeNosniff = true;
      if (s.referrer !== 'off') hdr.referrerPolicy = s.referrer;
      if (!Object.keys(hdr).length) {
        add('warn', 'hdr', 'Security headers is on but every header is off, so the middleware was left out.');
        hdr = null;
      }
    }

    var hasError = issues.some(function (i) { return i.level === 'error'; });
    var result = {
      ok: !hasError, state: s, issues: issues, labels: [], config: null, names: null,
      listYaml: '', mapYaml: '', snippet: '', fileYaml: '', staticYaml: ''
    };
    if (hasError) {
      result.issues = sortIssues(issues);
      return result;
    }

    // ── Names
    var names = {
      router: base,
      http: base + '-http',
      service: base,
      redirect: base + '-redirect-https',
      headers: base + '-headers',
      allow: base + '-ipallow',
      auth: base + '-auth',
      strip: base + '-strip'
    };
    result.names = names;

    // ── Dynamic configuration (file-provider shape); labels are derived from it
    var rule = buildRule(hosts, path, ver.syntax);
    var mwOrder = [];
    var middlewares = {};
    if (redirect === 'router') middlewares[names.redirect] = { redirectScheme: { scheme: 'https', permanent: true } };
    if (hdr) { middlewares[names.headers] = { headers: hdr }; mwOrder.push(names.headers); }
    if (ranges.length) {
      var allow = {};
      allow[ver.allow] = { sourceRange: ranges };
      middlewares[names.allow] = allow;
      mwOrder.push(names.allow);
    }
    if (users.length) {
      middlewares[names.auth] = { basicAuth: { users: users.map(function (u) { return u.user + ':' + u.hash; }) } };
      mwOrder.push(names.auth);
    }
    if (path && s.strip) {
      middlewares[names.strip] = { stripPrefix: { prefixes: [path] } };
      mwOrder.push(names.strip);
    }

    var routers = {};
    var main = { rule: rule, entryPoints: eps };
    if (mwOrder.length) main.middlewares = mwOrder;
    main.service = names.service;
    if (tls) main.tls = resolver ? { certResolver: resolver } : {};
    routers[names.router] = main;
    if (redirect === 'router') {
      routers[names.http] = { rule: rule, entryPoints: [httpEp], middlewares: [names.redirect], service: names.service };
    }

    var services = {};
    services[names.service] = { loadBalancer: { servers: [{ url: s.scheme + '://' + svc + ':' + port }] } };

    var cfg = { http: { routers: routers, services: services } };
    if (Object.keys(middlewares).length) cfg.http.middlewares = middlewares;
    result.config = cfg;

    var ctx = {
      s: s, ver: ver, svc: svc, img: img, port: port, hosts: hosts, path: path, rule: rule, eps: eps, tls: tls,
      resolver: resolver, redirect: redirect, httpEp: httpEp, net: net, dockerNet: dockerNet, names: names,
      users: users, ranges: ranges, hdr: hdr, wildcard: wildcard
    };
    result.labels = labelsFromConfig(cfg, ctx);
    result.listYaml = labelsList(result.labels, '');
    result.mapYaml = labelsMap(result.labels, '');
    result.snippet = composeSnippet(result.labels, ctx);
    result.fileYaml = fileYaml(cfg, ctx);
    result.staticYaml = staticConfig(ctx);

    // ── Warnings and notes on a valid configuration
    var httpsEps = eps.filter(looksHttps);
    var plainEps = eps.filter(looksPlain);
    if (!tls && httpsEps.length) {
      add('warn', 'tls', 'Router ' + c(names.router) + ' listens on ' + httpsEps.map(c).join(', ') + ' without TLS. A router without ' + c('tls') +
        ' only handles plain-HTTP requests, so HTTPS requests there get a 404 unless that entrypoint sets ' + c('http.tls') +
        ' in the static config. Turn on TLS.', DOCS.tls);
    }
    if (tls && eps.length && plainEps.length === eps.length) {
      add('warn', 'eps', 'Router ' + c(names.router) + ' has TLS but listens only on ' + eps.map(c).join(', ') +
        ', which looks like a plain-HTTP entrypoint. A TLS router ignores non-TLS requests. Use your HTTPS entrypoint, e.g. ' + c('websecure') + '.', DOCS.tls);
    }
    if (!tls && s.redirect !== 'none') {
      add('info', 'redirect', 'The HTTP → HTTPS redirect is skipped while TLS is off.');
    }
    if (redirect === 'router' && eps.indexOf(httpEp) >= 0) {
      add('warn', 'eps', c(httpEp) + ' is both the redirect entrypoint and one of the router\'s entrypoints. Remove it from Entrypoints: the redirect router ' +
        c(names.http) + ' handles plain HTTP there.');
    }
    if (redirect === 'entrypoint') {
      add('info', 'redirect', 'No redirect labels: the redirect lives in Traefik\'s static config (see the Static config tab) and applies to every router on ' +
        c(httpEp) + '.', DOCS.entrypoints);
    }
    if (tls && s.redirect === 'none') {
      add('info', 'redirect', 'No HTTP → HTTPS redirect: ' + c('http://') + ' requests to ' + c(hosts[0]) + ' get a 404 unless another router or the entrypoint redirects them.');
    }
    if (tls && !resolver) {
      add('info', 'resolver', 'No certificate resolver: Traefik serves a matching certificate from its TLS store, or its self-signed default certificate.', DOCS.tls);
    }
    if (tls && resolver && wildcard) {
      add('warn', 'resolver', c(wildcard) + ' needs a wildcard certificate, which ACME issues only through the DNS-01 challenge. Resolver ' +
        c(resolver) + ' must use ' + c('dnsChallenge') + '.', DOCS.wildcard);
    }
    if (wildcard) {
      add('info', 'domains', c('Host(' + bt(wildcard) + ')') + ' needs Traefik v3.7.0 or newer and matches exactly one subdomain level: not ' +
        c(wildcard.slice(2)) + ' itself and not ' + c('a.b.' + wildcard.slice(2)) + '.', DOCS.hostRule);
    }
    if (tls && resolver && (ipHost || privateHost)) {
      add('warn', 'domains', 'Public ACME CAs such as Let\'s Encrypt issue certificates for public domain names. ' + c(ipHost || privateHost) +
        ' will probably not get one; use a public domain, or a resolver your CA supports for it.', DOCS.acme);
    }
    if (path) {
      add('info', 'path', c('PathPrefix(' + bt(path) + ')') + ' also matches paths such as ' + c(path.replace(/\/$/, '') + '-old') +
        (s.strip ? '. The prefix is stripped, so the app sees ' + c('/') + ' instead of ' + c(path) + '.' :
          '. The path is forwarded as it is, so the app must serve under ' + c(path) + ', or turn on Strip the path prefix.'), DOCS.pathRule);
      if (path.length > 1 && path.slice(-1) === '/') {
        add('info', 'path', c(path) + ' ends with a slash, so ' + c(path.slice(0, -1)) + ' itself does not match.');
      }
    }
    if (!net) {
      add('warn', 'net', 'No network set. Traefik reaches the container only over a Docker network they share, and on a container with several networks it picks one at random. ' +
        'Create one (' + c('docker network create proxy') + '), attach Traefik and this service to it, and enter its name here.', DOCS.network);
    } else if (!s.ext) {
      add('info', 'net', 'Compose creates this file\'s network as ' + c(dockerNet) + ', so that is the name in ' + c('traefik.docker.network') +
        '. Traefik must be attached to it too, which in practice means Traefik runs in the same Compose project. When the name is wrong, Traefik logs ' +
        c('Maybe you\'re missing the project\'s prefix in the label?') + '.', DOCS.network);
    }
    if (!s.enable) {
      add('info', 'enable', 'Without ' + c('traefik.enable=true') + ' this works only with ' + c('exposedByDefault: true') +
        ' (Traefik\'s default), which also exposes every other container that has no ' + c('traefik.enable=false') + '.', DOCS.provider);
    }
    if (port === 443 || port === 8443) {
      if (s.scheme === 'http') {
        add('info', 'scheme', 'Port ' + c(String(port)) + ' often means the app serves HTTPS itself. If it does, set Backend speaks to HTTPS.');
      }
    }
    if (s.scheme === 'https') {
      add('info', 'scheme', 'Traefik connects to the container over HTTPS and verifies its certificate (' + c('insecureSkipVerify') +
        ' is false by default). For a self-signed backend certificate you need a ' + c('serversTransport') +
        ' with ' + c('insecureSkipVerify: true') + '; labels cannot define one, only reference one from the file provider, e.g. ' +
        c('loadbalancer.serverstransport=name@file') + '.', DOCS.transport);
    }
    if (users.length) {
      if (!tls) {
        add('warn', 'auth', 'Basic auth without TLS: browsers send the password base64-encoded, readable by anyone on the path. Turn on TLS.', DOCS.basicauth);
      }
      if (users.some(function (u) { return u.kind === 'sha1'; })) {
        add('warn', 'users', c('{SHA}') + ' is unsalted SHA1. Traefik accepts it, but bcrypt (' + c('htpasswd -nB') + ') is much harder to crack.');
      }
      var seenUsers = {};
      users.forEach(function (u) {
        if (seenUsers[u.user]) add('warn', 'users', 'User ' + c(u.user) + ' appears more than once; Traefik keeps the last line for it.');
        seenUsers[u.user] = true;
      });
      add('info', 'users', 'Every ' + c('$') + ' in the hash is written as ' + c('$$') + ' in the Compose labels, and Compose turns it back into ' + c('$') +
        '. In the file-provider YAML, or labels set without Compose (' + c('docker run --label') + '), use single ' + c('$') + '.', DOCS.interpolation);
      add('info', 'users', 'Anyone who can run ' + c('docker inspect') + ' can read labels, and Traefik\'s docs advise against secrets in them. ' +
        'On a shared host, mount a file and use ' + c('basicauth.usersfile') + ' instead.', DOCS.docker);
    }
    if (ranges.length) {
      add('info', 'ips', 'The allowlist checks the IP that connects to Traefik. Behind another proxy, CDN or tunnel that is the proxy\'s IP; see ' +
        c('ipStrategy') + ' in the docs.', DOCS.ipStrategy);
    }
    if (hdr && hdr.stsSeconds) {
      if (!tls) add('warn', 'sts', 'Strict-Transport-Security is only sent on HTTPS responses, so it does nothing while TLS is off.', DOCS.headers);
      else add('info', 'sts', 'Browsers remember HSTS for the whole max-age. Try 1 day first, then raise it once HTTPS works everywhere.');
    }
    if (s.v === '2.10' && ranges.length) {
      add('info', 'ips', c('ipWhiteList') + ' is used because releases before v2.11 do not know ' + c('ipAllowList') + '. After an upgrade, switch to ' +
        c('ipAllowList') + ': v2.11 deprecates the old name and v3 logs a warning for it.', DOCS.migrate);
    }

    result.issues = sortIssues(issues);
    return result;
  }

  function sortIssues(list) {
    var rank = { error: 0, warn: 1, info: 2 };
    return list.map(function (x, i) { return { x: x, i: i }; })
      .sort(function (a, b) { return (rank[a.x.level] - rank[b.x.level]) || (a.i - b.i); })
      .map(function (o) { return o.x; });
  }

  // ── Labels ───────────────────────────────────────────────

  var MW_WHY = {
    'redirectscheme.scheme': function () { return 'Redirects the request to ' + c('https://') + ' on the same host and path.'; },
    'redirectscheme.permanent': function () { return 'Makes the redirect permanent, so browsers remember it.'; },
    'headers.stsseconds': function (v) {
      return 'Sends ' + c('Strict-Transport-Security: max-age=' + v) + ' on HTTPS responses: browsers use only HTTPS for this host for that many seconds.';
    },
    'headers.stsincludesubdomains': function () { return 'Adds ' + c('includeSubDomains') + ' to HSTS: every subdomain of this host must work over HTTPS too.'; },
    'headers.framedeny': function () { return 'Sends ' + c('X-Frame-Options: DENY') + ': no site, this one included, can show these pages in a frame.'; },
    'headers.customframeoptionsvalue': function (v) { return 'Sends ' + c('X-Frame-Options: ' + v) + ': only pages from the same origin can frame these pages.'; },
    'headers.contenttypenosniff': function () { return 'Sends ' + c('X-Content-Type-Options: nosniff') + ': browsers keep the declared Content-Type instead of guessing.'; },
    'headers.referrerpolicy': function (v) { return 'Sends ' + c('Referrer-Policy: ' + v) + ', which limits what the Referer header reveals to other sites.'; },
    'ipallowlist.sourcerange': function (v, ctx) {
      return 'Only clients from ' + c(v) + ' get through; others are refused' + (ctx.s.v === '3' ? ' with 403 Forbidden (the default status)' : '') + '.';
    },
    'ipwhitelist.sourcerange': function (v) { return 'Only clients from ' + c(v) + ' get through; others are refused. Pre-v2.11 name of the IP allowlist.'; },
    'basicauth.users': function (v, ctx) {
      return 'Users allowed in, as ' + c('user:hash') + ' (' + ctx.users.map(function (u) { return u.user; }).join(', ') +
        '). Each ' + c('$') + ' is doubled to ' + c('$$') + ' because Compose would read ' + c('$apr1') + ' or ' + c('$abc') + ' as a variable.';
    },
    'stripprefix.prefixes': function (v) { return 'Removes ' + c(v) + ' from the path before forwarding, so the app sees ' + c('/') + ' instead of ' + c(v) + '.'; }
  };

  function flatten(obj, prefix, cb) {
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      var key = prefix + '.' + k.toLowerCase();
      if (Array.isArray(v)) cb(key, v.join(','));
      else if (v !== null && typeof v === 'object') flatten(v, key, cb);
      else cb(key, String(v));
    });
  }

  function describeRule(ctx) {
    var who = ctx.hosts.map(c).join(ctx.hosts.length > 2 ? ', ' : ' or ');
    var txt = 'Takes requests for ' + who + (ctx.path ? ' whose path starts with ' + c(ctx.path) : '') + '.';
    if (ctx.hosts.length > 1) {
      txt += ctx.ver.syntax === 'v3' ? ' In v3 syntax each Host() takes one domain, so they are joined with ' + c('||') + '.' :
        ' In v2 syntax Host() takes a list of domains.';
    }
    return txt;
  }

  function labelsFromConfig(cfg, ctx) {
    var out = [];
    function push(key, value, why) { out.push({ key: key, value: String(value), why: why }); }
    var names = ctx.names;

    if (ctx.s.enable) {
      push('traefik.enable', 'true', 'Tells the Docker provider to use this container. Needed when it runs with ' + c('exposedByDefault: false') +
        ', and overrides that setting for this container.');
    }
    if (ctx.dockerNet) {
      push('traefik.docker.network', ctx.dockerNet, 'Network Traefik uses to reach the container: the real Docker network name (' + c('docker network ls') +
        '). Needed when the container is on more than one network, where Traefik would otherwise pick one at random; harmless with one.');
    }

    Object.keys(cfg.http.routers).forEach(function (rname) {
      var r = cfg.http.routers[rname];
      var p = 'traefik.http.routers.' + rname + '.';
      var isRedirect = rname === names.http;
      push(p + 'rule', r.rule, isRedirect ? 'Same rule as ' + c(names.router) + ', for requests that arrive over plain HTTP.' : describeRule(ctx));
      push(p + 'entrypoints', r.entryPoints.join(','), isRedirect ?
        'Listens on the plain-HTTP entrypoint ' + c(r.entryPoints[0]) + '.' :
        'Entrypoints (ports from Traefik\'s static config) this router listens on.');
      if (r.middlewares) {
        push(p + 'middlewares', r.middlewares.join(','), isRedirect ? 'Sends every request to the HTTPS redirect.' :
          'Middlewares run in this order. Headers come first so that 401 and 403 responses carry them too; the IP allowlist comes before basic auth, so blocked clients never see a login prompt.');
      }
      push(p + 'service', r.service, isRedirect ? 'A router needs a service, but the redirect answers before the request gets there.' :
        'Sends matching requests to the service below. Named explicitly so the labels match the file-provider config.');
      if (r.tls) {
        push(p + 'tls', 'true', 'Makes this an HTTPS router: Traefik terminates TLS and the router ignores plain-HTTP requests.');
        if (r.tls.certResolver) {
          push(p + 'tls.certresolver', r.tls.certResolver, 'Gets and renews the certificate for the domains in the rule from resolver ' +
            c(r.tls.certResolver) + ', which must exist in the static config.');
        }
      }
    });

    var sp = 'traefik.http.services.' + names.service + '.loadbalancer.server.';
    push(sp + 'port', ctx.port, 'Port inside the container Traefik connects to. Without it Traefik uses the single exposed port, or the lowest of several, and fails when the image exposes none.');
    if (ctx.s.scheme === 'https') push(sp + 'scheme', 'https', 'Traefik talks HTTPS to the container instead of HTTP.');

    if (cfg.http.middlewares) {
      Object.keys(cfg.http.middlewares).forEach(function (mname) {
        flatten(cfg.http.middlewares[mname], 'traefik.http.middlewares.' + mname, function (key, value) {
          var tail = key.split('.').slice(-2).join('.');
          var fn = MW_WHY[tail];
          push(key, value, fn ? fn(value, ctx) : '');
        });
      });
    }
    return out;
  }

  function labelsList(labels, indent) {
    var lines = [indent + 'labels:'];
    labels.forEach(function (l) { lines.push(indent + '  - ' + yq(composeEscape(l.key + '=' + l.value))); });
    return lines.join('\n') + '\n';
  }

  function labelsMap(labels, indent) {
    var lines = [indent + 'labels:'];
    labels.forEach(function (l) { lines.push(indent + '  ' + l.key + ': ' + yq(composeEscape(l.value))); });
    return lines.join('\n') + '\n';
  }

  function composeSnippet(labels, ctx) {
    var lines = ['services:', '  ' + ctx.svc + ':'];
    if (ctx.img) lines.push('    image: ' + ctx.img);
    else lines.push('    # image: <your image>');
    lines.push('    # No published ports needed: Traefik reaches the container over the network.');
    if (ctx.net) lines.push('    networks:', '      - ' + ctx.net);
    else lines.push('    # networks: add a network shared with Traefik');
    lines.push(labelsList(labels, '    ').replace(/\n$/, ''));
    if (ctx.net) {
      lines.push('', 'networks:');
      if (ctx.s.ext) {
        lines.push('  ' + ctx.net + ':', '    external: true   # created once with: docker network create ' + ctx.net);
      } else {
        lines.push('  # Compose creates it as ' + ctx.dockerNet + '; Traefik must be attached to it too.', '  ' + ctx.net + ': {}');
      }
    }
    return lines.join('\n') + '\n';
  }

  // ── File-provider YAML ───────────────────────────────────

  function yamlScalar(v) {
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    return yq(v);
  }

  function toYaml(obj, indent, lines) {
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (Array.isArray(v)) {
        lines.push(indent + k + ':');
        v.forEach(function (item) {
          if (item !== null && typeof item === 'object') {
            var sub = [];
            toYaml(item, indent + '    ', sub);
            sub[0] = indent + '  - ' + sub[0].replace(/^\s+/, '');
            Array.prototype.push.apply(lines, sub);
          } else {
            lines.push(indent + '  - ' + yamlScalar(item));
          }
        });
      } else if (v !== null && typeof v === 'object') {
        if (!Object.keys(v).length) lines.push(indent + k + ': {}');
        else {
          lines.push(indent + k + ':');
          toYaml(v, indent + '  ', lines);
        }
      } else {
        lines.push(indent + k + ': ' + yamlScalar(v));
      }
    });
    return lines;
  }

  function fileYaml(cfg, ctx) {
    var head = [
      '# Dynamic configuration for the file provider, e.g. /etc/traefik/dynamic/' + ctx.names.router + '.yml',
      '# Same routers, middlewares and service as the labels. Traefik reaches the',
      '# container by its service name (' + ctx.svc + ') on a network they share.',
      '# traefik.enable and traefik.docker.network are Docker-provider options',
      '# and have no file equivalent.'
    ];
    return head.concat(toYaml(cfg, '', [])).join('\n') + '\n';
  }

  // ── Static (install) configuration ───────────────────────

  // Conventional addresses for the usual names; anything else gets a guess and a comment.
  function epAddress(ep, tls) {
    if (ep === 'websecure' || looksHttps(ep)) return { addr: ':443', sure: true };
    if (ep === 'web' || looksPlain(ep)) return { addr: ':80', sure: true };
    return { addr: tls ? ':443' : ':80', sure: false };
  }

  function staticConfig(ctx) {
    var eps = ctx.eps.slice();
    var needHttp = ctx.tls && (ctx.redirect !== 'none' || (ctx.resolver && !ctx.wildcard));
    if (needHttp && eps.indexOf(ctx.httpEp) < 0) eps.unshift(ctx.httpEp);
    var target = ctx.eps.filter(function (e) { return e !== ctx.httpEp; })[0] || ctx.eps[0];
    var y = ['# Traefik install (static) configuration these labels expect.', '# Merge it into traefik.yml; names must match the labels.', 'entryPoints:'];
    var f = [];
    eps.forEach(function (ep) {
      var a = epAddress(ep, ctx.tls && ep !== ctx.httpEp);
      y.push('  ' + ep + ':');
      y.push('    address: "' + a.addr + '"' + (a.sure ? '' : '   # set the port this entrypoint listens on'));
      f.push('--entryPoints.' + ep + '.address=' + a.addr);
      if (ctx.redirect === 'entrypoint' && ep === ctx.httpEp) {
        y.push('    http:', '      redirections:', '        entryPoint:', '          to: "' + target + '"', '          scheme: "https"', '          permanent: true');
        f.push('--entryPoints.' + ep + '.http.redirections.entryPoint.to=' + target,
          '--entryPoints.' + ep + '.http.redirections.entryPoint.scheme=https',
          '--entryPoints.' + ep + '.http.redirections.entryPoint.permanent=true');
      }
    });
    y.push('providers:', '  docker:', '    exposedByDefault: ' + (ctx.s.enable ? 'false' : 'true'));
    f.push('--providers.docker=true', '--providers.docker.exposedByDefault=' + (ctx.s.enable ? 'false' : 'true'));
    if (ctx.tls && ctx.resolver) {
      y.push('certificatesResolvers:', '  ' + ctx.resolver + ':', '    acme:', '      email: "you@example.com"', '      storage: "/letsencrypt/acme.json"');
      f.push('--certificatesresolvers.' + ctx.resolver + '.acme.email=you@example.com',
        '--certificatesresolvers.' + ctx.resolver + '.acme.storage=/letsencrypt/acme.json');
      if (ctx.wildcard) {
        y.push('      dnsChallenge:', '        provider: "your-dns-provider"   # wildcard certificates need DNS-01; see the ACME docs');
        f.push('--certificatesresolvers.' + ctx.resolver + '.acme.dnschallenge.provider=your-dns-provider');
      } else {
        y.push('      httpChallenge:', '        entryPoint: "' + ctx.httpEp + '"   # must be reachable on port 80');
        f.push('--certificatesresolvers.' + ctx.resolver + '.acme.httpchallenge.entrypoint=' + ctx.httpEp);
      }
    }
    y.push('', '# The same as command-line flags in Traefik\'s own Compose service:', '# command:');
    f.forEach(function (flag) { y.push('#   - "' + flag + '"'); });
    return y.join('\n') + '\n';
  }

  // ── UI ───────────────────────────────────────────────────

  var state = defaultState();
  var current = null;
  var activeTab = 'list';

  var FIELDS = {
    svc: 'tdl-svc', img: 'tdl-img', router: 'tdl-router', port: 'tdl-port', scheme: 'tdl-scheme', domains: 'tdl-domains',
    path: 'tdl-path', eps: 'tdl-eps', resolver: 'tdl-resolver', redirect: 'tdl-redirect', httpEp: 'tdl-httpep', net: 'tdl-net',
    project: 'tdl-project', sts: 'tdl-sts', frame: 'tdl-frame', referrer: 'tdl-referrer', ips: 'tdl-ips', users: 'tdl-users'
  };
  var CHECKS = {
    strip: 'tdl-strip', tls: 'tdl-tls', enable: 'tdl-enable', ext: 'tdl-ext', hdr: 'tdl-hdr', stsSub: 'tdl-stssub',
    nosniff: 'tdl-nosniff', ipOn: 'tdl-ipon', auth: 'tdl-auth'
  };
  var TAB_HINTS = {
    list: 'Paste under your service\'s ' + c('labels:') + ' key. Every ' + c('$') + ' is written as ' + c('$$') + ' for Compose.',
    map: 'The same labels as a map. Values are quoted so YAML keeps them as strings.',
    snippet: 'A minimal service showing where the network and the labels go.',
    file: 'The same routing as dynamic configuration for the file provider. Use either this or the labels for one router name, not both.',
    static: 'What Traefik\'s own static config needs for these labels to work. Merge it into traefik.yml, or use the flags.'
  };

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(text) {
    var out = '';
    var parts = String(text).split(CS);
    out += escapeHtml(parts[0]);
    for (var i = 1; i < parts.length; i++) {
      var j = parts[i].indexOf(CE);
      var code = j >= 0 ? parts[i].slice(0, j) : parts[i];
      var rest = j >= 0 ? parts[i].slice(j + 1) : '';
      out += '<code class="tdl-code">' + escapeHtml(code) + '</code>' + escapeHtml(rest);
    }
    return out;
  }

  function readForm() {
    var s = {};
    var checked = document.querySelector('input[name="tdl-v"]:checked');
    s.v = checked ? checked.value : '3';
    Object.keys(FIELDS).forEach(function (k) { s[k] = $(FIELDS[k]).value; });
    Object.keys(CHECKS).forEach(function (k) { s[k] = $(CHECKS[k]).checked; });
    return normalizeState(s);
  }

  function writeForm(s) {
    var radios = document.querySelectorAll('input[name="tdl-v"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === s.v;
    Object.keys(FIELDS).forEach(function (k) { $(FIELDS[k]).value = s[k]; });
    Object.keys(CHECKS).forEach(function (k) { $(CHECKS[k]).checked = s[k]; });
  }

  function toggle(id, show) {
    var el = $(id);
    if (el) el.classList.toggle('tdl-hidden', !show);
  }

  function renderIssues(res) {
    var ul = $('tdl-issues');
    var html = '';
    var labelOf = { error: 'Error', warn: 'Warning', info: 'Note' };
    res.issues.forEach(function (i) {
      html += '<li class="tdl-issue tdl-issue--' + i.level + '"><span class="tdl-issue-tag">' + labelOf[i.level] + '</span>' +
        '<span class="tdl-issue-text">' + fmt(i.text) +
        (i.doc ? ' <a class="tdl-link" href="' + escapeHtml(i.doc) + '" target="_blank" rel="noopener">Docs</a>' : '') + '</span></li>';
    });
    if (!res.issues.length) html = '<li class="tdl-issue tdl-issue--ok"><span class="tdl-issue-tag">OK</span><span class="tdl-issue-text">No problems found.</span></li>';
    ul.innerHTML = html;

    var bad = {};
    res.issues.forEach(function (i) { if (i.level === 'error') bad[i.field] = true; });
    Object.keys(FIELDS).forEach(function (k) {
      var el = $(FIELDS[k]);
      el.classList.toggle('tdl-invalid', !!bad[k]);
      el.setAttribute('aria-invalid', bad[k] ? 'true' : 'false');
    });
  }

  function outputText(res, tab) {
    if (!res.ok) return '';
    return { list: res.listYaml, map: res.mapYaml, snippet: res.snippet, file: res.fileYaml, static: res.staticYaml }[tab] || '';
  }

  function renderOutput() {
    var res = current;
    var tabs = document.querySelectorAll('.tdl-tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-tab') === activeTab;
      tabs[i].classList.toggle('tdl-active', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].setAttribute('tabindex', on ? '0' : '-1');
    }
    $('tdl-out-hint').innerHTML = fmt(TAB_HINTS[activeTab]);
    var pre = $('tdl-out');
    pre.setAttribute('aria-labelledby', 'tdl-tab-' + activeTab);
    if (res.ok) {
      pre.textContent = outputText(res, activeTab);
      pre.classList.remove('tdl-pre--empty');
    } else {
      pre.textContent = 'Fix the errors under Checks to see the output.';
      pre.classList.add('tdl-pre--empty');
    }
    $('tdl-copy').disabled = !res.ok;
  }

  function renderWhy(res) {
    var ul = $('tdl-why');
    if (!res.ok) { ul.innerHTML = '<li class="tdl-why-item tdl-why-item--empty">Fix the errors first.</li>'; return; }
    ul.innerHTML = res.labels.map(function (l) {
      return '<li class="tdl-why-item"><code class="tdl-why-key">' + escapeHtml(l.key) + '=' + escapeHtml(l.value) + '</code>' +
        '<span class="tdl-why-text">' + fmt(l.why) + '</span></li>';
    }).join('');
  }

  function render() {
    state = readForm();
    $('tdl-v-hint').innerHTML = fmt(VERSIONS[state.v].hint);
    $('tdl-router').placeholder = deriveName(state.svc) || 'myapp';
    toggle('tdl-strip-row', state.path.trim() !== '');
    toggle('tdl-tls-fields', state.tls);
    toggle('tdl-httpep-field', state.tls);
    toggle('tdl-project-field', state.net.trim() !== '' && !state.ext);
    toggle('tdl-ext-row', state.net.trim() !== '');
    toggle('tdl-hdr-body', state.hdr);
    toggle('tdl-ipon-body', state.ipOn);
    toggle('tdl-auth-body', state.auth);
    current = generate(state);
    renderIssues(current);
    renderOutput();
    renderWhy(current);
    var hash = encodeHash(state);
    try {
      history.replaceState(null, '', hash || location.pathname + location.search);
    } catch (e) { /* history may be unavailable in sandboxed frames */ }
  }

  function showToast(msg, isError) {
    var t = $('tdl-toast');
    t.textContent = msg;
    t.classList.toggle('tdl-toast--error', !!isError);
    t.classList.add('tdl-show');
    setTimeout(function () { t.classList.remove('tdl-show'); }, 2000);
  }

  function copyText(text, okMsg) {
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
      showToast(ok ? okMsg : 'Copy failed: select the text and copy it by hand', !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast(okMsg); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function copyOutput() {
    if (!current || !current.ok) { showToast('Fix the errors first', true); return; }
    copyText(outputText(current, activeTab), 'Copied');
  }

  function copyLink() {
    copyText(location.href, 'Link copied (without the htpasswd line)');
  }

  function onTabKey(e) {
    var order = ['list', 'map', 'snippet', 'file', 'static'];
    var i = order.indexOf(activeTab);
    if (e.key === 'ArrowRight') i = (i + 1) % order.length;
    else if (e.key === 'ArrowLeft') i = (i + order.length - 1) % order.length;
    else return;
    e.preventDefault();
    activeTab = order[i];
    renderOutput();
    $('tdl-tab-' + activeTab).focus();
  }

  function init() {
    var initial = location.hash && location.hash.length > 1 ? decodeHash(location.hash) : defaultState();
    writeForm(initial);
    var form = $('tdl-form');
    form.addEventListener('input', render);
    form.addEventListener('change', render);
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    var tabs = $('tdl-tabs');
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.tdl-tab') : null;
      if (!btn) return;
      activeTab = btn.getAttribute('data-tab');
      renderOutput();
    });
    tabs.addEventListener('keydown', onTabKey);
    window.addEventListener('hashchange', function () {
      if (location.hash === encodeHash(state)) return;
      var s = decodeHash(location.hash);
      s.users = $('tdl-users').value;
      writeForm(s);
      render();
    });
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Global handlers for onclick attributes
  window.tdlCopy = copyOutput;
  window.tdlCopyLink = copyLink;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      VERSIONS: VERSIONS,
      DOCS: DOCS,
      defaultState: defaultState,
      normalizeState: normalizeState,
      encodeHash: encodeHash,
      decodeHash: decodeHash,
      deriveName: deriveName,
      validateName: validateName,
      validatePort: validatePort,
      validateHost: validateHost,
      validatePath: validatePath,
      validateCidr: validateCidr,
      parseHtpasswd: parseHtpasswd,
      composeEscape: composeEscape,
      yq: yq,
      buildRule: buildRule,
      generate: generate,
      plain: plain
    };
  }
})();
