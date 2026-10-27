/* Open Graph Meta Tag Generator and Checker — script.js
   Prefix: ogm-
   Generates the title, meta description, canonical link, Open Graph (ogp.me)
   and X card tags for a page, checks a share image against the sizes Meta, X
   and LinkedIn document, and analyzes a pasted head or page source for missing,
   duplicate and conflicting tags. No dependencies and no background requests:
   the only request this page can make is the image URL the user explicitly
   asks it to load. The generator fields live in the URL hash. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Sources (each rule below cites one of these) ──────────

  var XA = 'https://web.archive.org/web/20251101000000/https://developer.x.com/en/docs/x-for-websites/cards/';
  var GC = 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls';
  var WS = 'https://html.spec.whatwg.org/multipage/';

  var SRC = {
    ogpBasic: { url: 'https://ogp.me/#metadata', label: 'ogp.me: basic metadata' },
    ogpOptional: { url: 'https://ogp.me/#optional', label: 'ogp.me: optional metadata' },
    ogpStructured: { url: 'https://ogp.me/#structured', label: 'ogp.me: structured properties' },
    ogpArrays: { url: 'https://ogp.me/#array', label: 'ogp.me: arrays' },
    ogpTypes: { url: 'https://ogp.me/#types', label: 'ogp.me: object types' },
    ogpArticle: { url: 'https://ogp.me/#no_vertical', label: 'ogp.me: article, book, profile' },
    ogpDataTypes: { url: 'https://ogp.me/#data_types', label: 'ogp.me: data types' },
    metaGuide: { url: 'https://developers.facebook.com/docs/sharing/webmasters/', label: 'Meta: Sharing for Webmasters' },
    metaImages: { url: 'https://developers.facebook.com/docs/sharing/webmasters/images/', label: 'Meta: Images in Link Shares' },
    metaBest: { url: 'https://developers.facebook.com/docs/sharing/best-practices/', label: 'Meta: Sharing best practices' },
    metaCrawler: { url: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/', label: 'Meta: Web Crawlers' },
    xMarkup: { url: 'https://web.archive.org/web/20260116124848/https://developer.x.com/en/docs/x-for-websites/cards/overview/markup', label: 'X: Cards markup (archived)' },
    xStart: { url: XA + 'guides/getting-started', label: 'X: Getting started with Cards (archived)' },
    xSummary: { url: XA + 'overview/summary', label: 'X: Summary Card (archived)' },
    xLarge: { url: XA + 'overview/summary-card-with-large-image', label: 'X: Summary Card with Large Image (archived)' },
    xTrouble: { url: XA + 'guides/troubleshooting-cards', label: 'X: Cards troubleshooting (archived)' },
    xPolicy: { url: 'https://docs.x.com/developer-terms/policy#x-cards', label: 'X Developer Policy: X Cards' },
    xHandle: { url: 'https://help.x.com/en/managing-your-account/change-x-handle', label: 'X Help: usernames' },
    liShare: { url: 'https://www.linkedin.com/help/linkedin/answer/a521928', label: 'LinkedIn Help: shareable websites' },
    gTitle: { url: 'https://developers.google.com/search/docs/appearance/title-link#page-titles', label: 'Google: title links' },
    gSnippet: { url: 'https://developers.google.com/search/docs/appearance/snippet#meta-descriptions', label: 'Google: meta descriptions' },
    gCanonical: { url: GC + '#rel-canonical-link-method', label: 'Google: rel="canonical"' },
    gCanonicalBest: { url: GC + '#best-practices', label: 'Google: canonical best practices' },
    gHttps: { url: GC + '#prefer-https-over-http-for-canonical-urls', label: 'Google: prefer HTTPS' },
    htmlTitle: { url: WS + 'semantics.html#the-title-element', label: 'HTML: the title element' },
    htmlMeta: { url: WS + 'semantics.html#the-meta-element', label: 'HTML: the meta element' },
    htmlDescription: { url: WS + 'semantics.html#meta-description', label: 'HTML: meta description' },
    htmlAttrs: { url: WS + 'syntax.html#attributes-2', label: 'HTML: attributes' }
  };

  // ── Documented limits ─────────────────────────────────────

  var LIMITS = {
    xTitle: 70,              // X markup reference: twitter:title, max 70 characters
    xDesc: 200,              // twitter:description, maximum 200 characters
    xAlt: 420,               // twitter:image:alt, maximum 420 characters
    xBytes: 5000000,         // X: images must be less than 5MB
    metaBytes: 8000000,      // Meta: the image file must not exceed 8 MB
    liBytes: 5000000,        // LinkedIn: max file size 5 MB
    metaFirstBytes: 1000000, // Meta: Open Graph properties within the first 1 MB
    xPageBytes: 2000000      // X: crawler limit of 2 MB for page responses
  };
  var RATIO_TOL = 0.05;      // this tool's tolerance for "close to" a documented ratio
  var MAX_FIELD = 4000;

  var CARD_TYPES = ['summary', 'summary_large_image', 'app', 'player'];
  var OG_TYPES = ['website', 'article', 'book', 'profile', 'music.song', 'music.album', 'music.playlist',
    'music.radio_station', 'video.movie', 'video.episode', 'video.tv_show', 'video.other', 'payment.link'];
  var IMG_TYPES = ['auto', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'none'];
  var EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' };
  var META_TYPES = ['image/jpeg', 'image/gif', 'image/png'];
  var X_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  var DETERMINERS = ['a', 'an', 'the', '', 'auto'];
  var DECORATION = ['fbclid', 'gclid', 'msclkid', 'dclid', 'gbraid', 'wbraid', 'mc_cid', 'mc_eid', 'igshid',
    'sessionid', 'session_id', 'sid', 'phpsessid', 'jsessionid'];

  function toSet(list) {
    var o = Object.create(null);
    list.forEach(function (k) { o[k] = true; });
    return o;
  }

  var KNOWN = toSet([
    'og:title', 'og:type', 'og:image', 'og:url', 'og:audio', 'og:description', 'og:determiner', 'og:locale',
    'og:locale:alternate', 'og:site_name', 'og:video',
    'og:image:url', 'og:image:secure_url', 'og:image:type', 'og:image:width', 'og:image:height', 'og:image:alt',
    'og:video:url', 'og:video:secure_url', 'og:video:type', 'og:video:width', 'og:video:height', 'og:video:alt',
    'og:audio:url', 'og:audio:secure_url', 'og:audio:type',
    'article:published_time', 'article:modified_time', 'article:expiration_time', 'article:author',
    'article:section', 'article:tag',
    'book:author', 'book:isbn', 'book:release_date', 'book:tag',
    'profile:first_name', 'profile:last_name', 'profile:username', 'profile:gender',
    'music:duration', 'music:album', 'music:album:disc', 'music:album:track', 'music:musician', 'music:song',
    'music:song:disc', 'music:song:track', 'music:release_date', 'music:creator',
    'video:actor', 'video:actor:role', 'video:director', 'video:writer', 'video:duration', 'video:release_date',
    'video:tag', 'video:series',
    'payment:description', 'payment:currency', 'payment:amount', 'payment:expires_at', 'payment:status',
    'payment:id', 'payment:success_url',
    'fb:app_id',
    'twitter:card', 'twitter:site', 'twitter:site:id', 'twitter:creator', 'twitter:creator:id',
    'twitter:description', 'twitter:title', 'twitter:image', 'twitter:image:alt',
    'twitter:player', 'twitter:player:width', 'twitter:player:height', 'twitter:player:stream',
    'twitter:app:name:iphone', 'twitter:app:id:iphone', 'twitter:app:url:iphone',
    'twitter:app:name:ipad', 'twitter:app:id:ipad', 'twitter:app:url:ipad',
    'twitter:app:name:googleplay', 'twitter:app:id:googleplay', 'twitter:app:url:googleplay'
  ]);
  var KNOWN_LIST = Object.keys(KNOWN);
  var ARRAY_KEYS = toSet(['og:locale:alternate', 'article:author', 'article:tag', 'book:author', 'book:tag',
    'music:album', 'music:musician', 'music:song', 'video:actor', 'video:actor:role', 'video:director',
    'video:writer', 'video:tag']);
  var URL_KEYS = toSet(['og:video', 'og:video:url', 'og:video:secure_url', 'og:audio', 'og:audio:url',
    'og:audio:secure_url', 'twitter:player', 'twitter:player:stream', 'payment:success_url']);
  var DATE_KEYS = toSet(['article:published_time', 'article:modified_time', 'article:expiration_time',
    'book:release_date', 'music:release_date', 'video:release_date', 'payment:expires_at']);
  var INT_KEYS = toSet(['og:video:width', 'og:video:height', 'music:duration', 'video:duration',
    'music:album:disc', 'music:album:track', 'music:song:disc', 'music:song:track',
    'twitter:player:width', 'twitter:player:height']);
  var OG_FAMILY = { og: true, article: true, book: true, profile: true, music: true, video: true, payment: true, fb: true };
  var NS_TYPE = {
    article: { test: function (t) { return t === 'article'; }, want: 'article' },
    book: { test: function (t) { return t === 'book'; }, want: 'book' },
    profile: { test: function (t) { return t === 'profile'; }, want: 'profile' },
    music: { test: function (t) { return /^music\./.test(t); }, want: 'music.*' },
    video: { test: function (t) { return /^video\./.test(t); }, want: 'video.*' },
    payment: { test: function (t) { return t === 'payment.link'; }, want: 'payment.link' }
  };

  // ── Small helpers ─────────────────────────────────────────

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function code(s) {
    return '<code class="ogm-code">' + escapeHtml(s) + '</code>';
  }

  // Attribute value for a double-quoted attribute: & and " must be escaped,
  // < and > are escaped as well so the value can never close the tag.
  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escText(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function htmlComment(text) {
    return '<' + '!-- ' + text + ' --' + '>';
  }

  // Control characters become spaces; runs of ASCII whitespace collapse to one space.
  // Non-ASCII text (including no-break spaces) is kept exactly as typed.
  function cleanText(s) {
    var str = String(s == null ? '' : s);
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var n = str.charCodeAt(i);
      out += (n < 32 || n === 127) ? ' ' : str.charAt(i);
    }
    return out.replace(/[ \t\n\r\f]+/g, ' ').trim();
  }

  function charLen(s) {
    var str = String(s == null ? '' : s);
    return Array.from ? Array.from(str).length : str.length;
  }

  function fmtInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function fmtBytes(n) {
    if (n < 1000) return plural(n, 'byte');
    if (n < 1000000) return (n / 1000).toFixed(1) + ' kB';
    return (n / 1000000).toFixed(2) + ' MB (' + fmtInt(n) + ' bytes)';
  }

  function ratioText(w, h) {
    return (w / h).toFixed(2) + ':1';
  }

  function near(r, target) {
    return Math.abs(r / target - 1) <= RATIO_TOL;
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

  function closest(word, list, maxDist) {
    var best = '', bestD = maxDist + 1;
    list.forEach(function (w) {
      var d = editDistance(word, w);
      if (d < bestD) { bestD = d; best = w; }
    });
    return bestD <= maxDist ? best : '';
  }

  // Comma or newline separated list, trimmed, without duplicates.
  function splitList(s) {
    var seen = Object.create(null);
    return String(s == null ? '' : s).split(/[,\n]+/).map(cleanText).filter(function (v) {
      if (!v || seen[v]) return false;
      seen[v] = true;
      return true;
    });
  }

  function utf8Len(str, from, to) {
    var n = 0;
    for (var i = from; i < to; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < to) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  function listJoin(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  // ── URLs ──────────────────────────────────────────────────

  var FILE_EXT = ['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'html', 'htm', 'php',
    'asp', 'aspx', 'jsp', 'js', 'css', 'json', 'xml', 'txt', 'pdf', 'mp4', 'webm', 'mp3', 'zip'];

  // "example.com/page" (a host name without a scheme), but not "photo.jpg" (a relative file name).
  function looksLikeHost(v) {
    var hostPart = v.split(/[/?#]/)[0].replace(/:\d+$/, '');
    if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(hostPart)) return false;
    var tld = hostPart.slice(hostPart.lastIndexOf('.') + 1).toLowerCase();
    return /^[a-z]{2,}$/.test(tld) && FILE_EXT.indexOf(tld) < 0;
  }

  // Classifies a URL value. Open Graph URL values must be full http:// or https:// addresses.
  function checkUrl(raw, base) {
    var v = String(raw == null ? '' : raw).trim();
    var r = { raw: v, ok: false, kind: 'empty', href: '', resolved: '', scheme: '', host: '', hasHash: false };
    if (!v) return r;
    if (/^\/\//.test(v)) {
      r.kind = 'scheme-relative';
    } else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v) && !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+:\d/.test(v)) {
      r.scheme = v.slice(0, v.indexOf(':')).toLowerCase();
      if (r.scheme !== 'http' && r.scheme !== 'https') { r.kind = 'other-scheme'; return r; }
      try {
        var u = new URL(v);
        if (!u.hostname) { r.kind = 'invalid'; return r; }
        r.ok = true;
        r.kind = 'absolute';
        r.href = u.href;
        r.host = u.hostname;
        r.hasHash = v.indexOf('#') >= 0;
      } catch (e) {
        r.kind = 'invalid';
      }
      return r;
    } else if (looksLikeHost(v)) {
      r.kind = 'no-scheme';
    } else {
      r.kind = 'relative';
    }
    if (base) {
      try { r.resolved = new URL(r.kind === 'no-scheme' ? 'https://' + v : v, base).href; } catch (e) { /* ignore */ }
    } else if (r.kind === 'no-scheme') {
      try { r.resolved = new URL('https://' + v).href; } catch (e) { /* ignore */ }
    }
    return r;
  }

  function urlProblem(u, label) {
    var v = code(u.raw);
    switch (u.kind) {
      case 'relative':
        return label + ' ' + v + ' is a relative URL. ogp.me defines URL values as full addresses that use http:// or https://.';
      case 'scheme-relative':
        return label + ' ' + v + ' starts with // and has no scheme. LinkedIn\'s help shows examples like this, but ogp.me defines URL values as full addresses that use http:// or https://, so other consumers may not resolve it.';
      case 'no-scheme':
        return label + ' ' + v + ' has no http:// or https:// in front.';
      case 'other-scheme':
        return label + ' ' + v + ' uses ' + code(u.scheme + ':') + '; ogp.me URL values use http:// or https://.';
      default:
        return label + ' ' + v + ' is not a valid URL.';
    }
  }

  // A scheme-relative URL (//host/path) is a warning; anything else that is not a full URL an error.
  function urlLevel(u) {
    return u.kind === 'scheme-relative' ? 'warning' : 'error';
  }

  function urlFix(u) {
    if (u.kind === 'scheme-relative') return 'Write the full address: ' + code('https:' + u.raw) + '.';
    if (u.resolved) return 'Write the full address: ' + code(u.resolved) + '.';
    return 'Write the full address, starting with https://.';
  }

  // Tracking and session parameters Meta asks to leave out of og:url.
  function decoratedParams(href) {
    var found = [];
    try {
      var u = new URL(href);
      u.searchParams.forEach(function (v, k) {
        var key = k.toLowerCase();
        if ((/^utm_/.test(key) || DECORATION.indexOf(key) >= 0) && found.indexOf(k) < 0) found.push(k);
      });
      if (/;jsessionid=/i.test(u.pathname) && found.indexOf('jsessionid') < 0) found.push('jsessionid');
    } catch (e) { /* not a URL */ }
    return found;
  }

  // What differs between two absolute URLs, in words.
  function urlDiff(a, b) {
    var out = [];
    var x, y;
    try { x = new URL(a); y = new URL(b); } catch (e) { return ['the address']; }
    if (x.protocol !== y.protocol) out.push(x.protocol.replace(':', '') + ' versus ' + y.protocol.replace(':', ''));
    if (x.host !== y.host) out.push('host ' + x.host + ' versus ' + y.host);
    if (x.pathname !== y.pathname) {
      var px = x.pathname.replace(/\/$/, ''), py = y.pathname.replace(/\/$/, '');
      out.push(px === py ? 'trailing slash' : 'path');
    }
    if (x.search !== y.search) out.push('query string');
    if (x.hash !== y.hash) out.push('fragment');
    return out.length ? out : ['the address'];
  }

  // ── Values ────────────────────────────────────────────────

  // ISO 8601 date, or date and time with an optional zone, as ogp.me's DateTime.
  function parseDateTime(raw) {
    var v = String(raw == null ? '' : raw).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(v);
    if (!m) return { ok: false, value: v };
    var y = +m[1], mo = +m[2], d = +m[3];
    var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    var dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (mo < 1 || mo > 12 || d < 1 || d > dim[mo - 1]) return { ok: false, value: v };
    var hasTime = m[4] != null;
    if (hasTime && (+m[4] > 23 || +m[5] > 59 || (m[6] != null && +m[6] > 59))) return { ok: false, value: v };
    var zone = m[8] || '';
    if (zone && zone !== 'Z') {
      var digits = zone.replace(/[+:-]/g, '');
      if (+digits.slice(0, 2) > 14 || +digits.slice(2) > 59) return { ok: false, value: v };
      zone = zone.charAt(0) + digits.slice(0, 2) + ':' + digits.slice(2);
    }
    var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + (hasTime ? m[4] + ':' + m[5] + ':' + (m[6] || '00') + (m[7] || '') : '00:00:00') + (zone || 'Z');
    return { ok: true, value: v, hasTime: hasTime, hasZone: !!zone, time: Date.parse(iso) };
  }

  function nowIso(d) {
    d = d || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    off = Math.abs(off);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' +
      p(d.getMinutes()) + ':' + p(d.getSeconds()) + sign + p(Math.floor(off / 60)) + ':' + p(off % 60);
  }

  // og:locale uses language_TERRITORY (ogp.me), for example en_US.
  function checkLocale(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return { ok: true, value: '', empty: true };
    if (/^[a-z]{2,3}_[A-Z]{2}$/.test(v)) return { ok: true, value: v };
    var m = /^([A-Za-z]{2,3})[-_]([A-Za-z]{2})$/.exec(v);
    if (m) return { ok: false, value: v, suggest: m[1].toLowerCase() + '_' + m[2].toUpperCase() };
    return { ok: false, value: v, suggest: '' };
  }

  // X usernames: letters, numbers and underscores, up to 15 characters.
  function normalizeHandle(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return { ok: true, value: '', empty: true };
    var h = v.replace(/^https?:\/\/(www\.|mobile\.)?(twitter|x)\.com\//i, '').replace(/^@+/, '').replace(/[/?#].*$/, '');
    return { ok: /^[A-Za-z0-9_]{1,15}$/.test(h), value: '@' + h, hadAt: /^@/.test(v) };
  }

  function guessMime(url) {
    var m = /\.([A-Za-z0-9]{2,5})(?:[?#]|$)/.exec(String(url == null ? '' : url).trim());
    return m ? (EXT_MIME[m[1].toLowerCase()] || '') : '';
  }

  // ── Image recommendations ─────────────────────────────────

  function item(status, text) {
    return { status: status, text: text };
  }

  // Compares an image's pixel size, file size and type with what each platform documents.
  // info: { width, height, bytes?, mime? }, card: twitter card type chosen.
  function imageChecks(info, card) {
    var w = +info.width || 0, h = +info.height || 0;
    var dims = w > 0 && h > 0;
    var bytes = info.bytes == null || info.bytes === '' ? null : +info.bytes;
    var mime = String(info.mime || '').toLowerCase();
    var r = dims ? w / h : 0;
    var rt = dims ? ratioText(w, h) : '';
    var groups = [];

    var meta = [];
    if (dims) {
      if (w < 200 || h < 200) meta.push(item('bad', 'Below the minimum allowed size of 200 x 200 pixels.'));
      else if (w >= 1200 && h >= 630) meta.push(item('ok', 'At least 1200 x 630 pixels, the size recommended for high-resolution screens.'));
      else if (w >= 600 && h >= 315) meta.push(item('warn', 'Big enough for a large-image post (600 x 315 minimum), but under the recommended 1200 x 630.'));
      else meta.push(item('warn', 'Smaller than 600 x 315: still shown, but much smaller.'));
      meta.push(near(r, 1.91)
        ? item('ok', 'Aspect ratio ' + rt + ' is close to 1.91:1, which shows the full image without cropping.')
        : item('warn', 'Aspect ratio ' + rt + '; keep it as close to 1.91:1 as possible to show the full image without cropping.'));
    }
    if (bytes != null) {
      meta.push(bytes > LIMITS.metaBytes
        ? item('bad', 'File size ' + fmtBytes(bytes) + ' is over the 8 MB limit.')
        : item('ok', 'File size ' + fmtBytes(bytes) + ' is within 8 MB.'));
    }
    if (mime) {
      meta.push(META_TYPES.indexOf(mime) >= 0
        ? item('ok', 'Type ' + mime + ' is one Meta lists for og:image:type.')
        : item(mime === 'image/webp' ? 'info' : 'warn', 'Type ' + mime + ' is not in Meta\'s list for og:image:type (image/jpeg, image/gif, image/png).'));
    }
    groups.push({ id: 'meta', platform: 'Meta (Facebook)', srcs: [SRC.metaImages, SRC.metaGuide], items: meta });

    var small = card === 'summary' || card === 'none';
    var x = [];
    var minW = small ? 144 : 300, minH = small ? 144 : 157;
    if (dims) {
      if (w < minW || h < minH) x.push(item('bad', 'Below the minimum of ' + minW + ' x ' + minH + ' pixels for this card.'));
      else if (w > 4096 || h > 4096) x.push(item('bad', 'Above the maximum of 4096 x 4096 pixels.'));
      else x.push(item('ok', 'Within ' + minW + ' x ' + minH + ' to 4096 x 4096 pixels.'));
      if (small) {
        x.push(near(r, 1)
          ? item('ok', 'Square (' + rt + '), the 1:1 ratio this card uses.')
          : item('info', 'Aspect ratio ' + rt + ': X crops summary card images to a square on all platforms.'));
      } else {
        x.push(near(r, 2)
          ? item('ok', 'Aspect ratio ' + rt + ' is close to the 2:1 this card supports.')
          : item('warn', 'Aspect ratio ' + rt + '; X documents 2:1 for this card.'));
      }
    }
    if (bytes != null) {
      x.push(bytes >= LIMITS.xBytes
        ? item('bad', 'File size ' + fmtBytes(bytes) + ': images must be less than 5 MB.')
        : item('ok', 'File size ' + fmtBytes(bytes) + ' is under 5 MB.'));
    }
    if (mime) {
      if (mime === 'image/svg+xml') x.push(item('bad', 'SVG is not supported.'));
      else if (X_TYPES.indexOf(mime) < 0) x.push(item('warn', 'Type ' + mime + ' is not one of JPG, PNG, WEBP and GIF.'));
      else if (mime === 'image/gif') x.push(item('info', 'GIF is supported, but only the first frame of an animated GIF is used.'));
      else x.push(item('ok', 'Type ' + mime + ' is supported (JPG, PNG, WEBP and GIF are).'));
    }
    groups.push({
      id: 'x', platform: small ? 'X summary card' : 'X summary_large_image card',
      srcs: [small ? SRC.xSummary : SRC.xLarge], items: x
    });

    var li = [];
    if (dims) {
      li.push(w >= 1200 && h >= 627
        ? item('ok', 'At least 1200 x 627 pixels, LinkedIn\'s minimum for link previews.')
        : item('warn', 'Below LinkedIn\'s minimum image size of 1200 x 627 pixels.'));
      if (w < 401) li.push(item('warn', 'Under 401 pixels wide, so LinkedIn shows it as a thumbnail.'));
      li.push(near(r, 1.91)
        ? item('ok', 'Aspect ratio ' + rt + ' is close to the recommended 1.91:1.')
        : item('warn', 'Aspect ratio ' + rt + '; LinkedIn recommends 1.91:1.'));
    }
    if (bytes != null) {
      li.push(bytes > LIMITS.liBytes
        ? item('bad', 'File size ' + fmtBytes(bytes) + ' is over the 5 MB maximum.')
        : item('ok', 'File size ' + fmtBytes(bytes) + ' is within the 5 MB maximum.'));
    }
    groups.push({ id: 'linkedin', platform: 'LinkedIn', srcs: [SRC.liShare], items: li });
    return groups;
  }

  // ── Generator ─────────────────────────────────────────────

  function blankState() {
    return {
      title: '', ogTitle: '', desc: '', url: '', site: '', locale: '', altLocales: '', basics: true,
      type: 'website', pub: '', mod: '', author: '', section: '', tags: '',
      img: '', imgW: '', imgH: '', imgAlt: '', imgType: 'auto',
      card: 'summary_large_image', tsite: '', tcreator: '', trepeat: false, fbapp: ''
    };
  }

  function defaultState() {
    var s = blankState();
    s.title = 'Back Up a Home Server to a NAS — Example Blog';
    s.ogTitle = 'Back Up a Home Server to a NAS';
    s.desc = 'A step-by-step guide to nightly backups of a home server to a NAS, with retention rules, restore tests and an alert when a job fails.';
    s.url = 'https://example.com/blog/home-server-backup/';
    s.site = 'Example Blog';
    s.locale = 'en_US';
    s.type = 'article';
    s.pub = '2026-10-27T09:00:00+02:00';
    s.section = 'Homelab';
    s.tags = 'backup, NAS';
    s.img = 'https://example.com/images/home-server-backup-1200x630.jpg';
    s.imgW = '1200';
    s.imgH = '630';
    s.imgAlt = 'A small home server and a NAS on a shelf, connected by a network cable';
    return s;
  }

  var LEVEL_ORDER = { error: 0, warning: 1, info: 2 };

  function sortIssues(list) {
    return list.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) {
      return (LEVEL_ORDER[a.x.level] - LEVEL_ORDER[b.x.level]) || (a.i - b.i);
    }).map(function (o) { return o.x; });
  }

  function tagHtml(t) {
    if (t.type === 'title') return '<title>' + escText(t.value) + '</title>';
    if (t.type === 'link') return '<link rel="' + t.rel + '" href="' + escAttr(t.href) + '">';
    if (t.type === 'comment') return htmlComment(t.value);
    return '<meta ' + t.attr + '="' + t.key + '" content="' + escAttr(t.value) + '">';
  }

  // Builds the tags for a generator state. Output always reflects what was typed;
  // problems are reported as issues next to the fields.
  function buildOutput(s) {
    var issues = [];
    var tags = [];
    function issue(level, field, codeId, msg, fix, srcs) {
      issues.push({ level: level, field: field, code: codeId, msg: msg, fix: fix || '', srcs: srcs || [] });
    }
    function meta(attr, key, value) { tags.push({ type: 'meta', attr: attr, key: key, value: value }); }

    var title = cleanText(s.title);
    var ogTitle = cleanText(s.ogTitle) || title;
    var desc = cleanText(s.desc);
    var site = cleanText(s.site);
    var xOn = s.card !== 'none';

    // Canonical URL and og:url
    var canon = checkUrl(s.url);
    var urlOut = canon.ok ? canon.href : canon.raw;
    if (canon.kind === 'empty') {
      issue('warning', 'url', 'url-missing', 'No canonical URL, so og:url is left out; ogp.me lists og:url among the four required properties.',
        'Enter the full address of the page, starting with https://.', [SRC.ogpBasic]);
    } else if (!canon.ok) {
      issue(urlLevel(canon), 'url', 'url-not-absolute', urlProblem(canon, 'The canonical URL'), urlFix(canon), [SRC.ogpDataTypes, SRC.gCanonical]);
    } else {
      if (canon.hasHash) {
        issue('warning', 'url', 'url-fragment', 'The canonical URL contains a #fragment, and Google generally does not support fragments in canonical URLs.',
          'Remove the part from # on.', [SRC.gCanonicalBest]);
      }
      var dec = decoratedParams(canon.href);
      if (dec.length) {
        issue('warning', 'url', 'url-decorated', 'The URL carries ' + listJoin(dec.map(code)) + '. Meta asks for og:url to be the undecorated URL, without session variables, user identifying parameters or counters.',
          'Remove those parameters from the canonical URL.', [SRC.metaGuide]);
      }
      if (canon.scheme === 'http') {
        issue('info', 'url', 'url-http', 'The canonical URL uses http://. Google prefers the HTTPS version of a page as canonical when both exist.',
          'Use https:// if the site has it.', [SRC.gHttps]);
      }
    }

    // Titles and description
    if (!title && !ogTitle) {
      issue('warning', 'title', 'title-missing', 'No title. Google asks for a &lt;title&gt; element on every page, and ogp.me requires og:title.',
        'Enter the page title.', [SRC.gTitle, SRC.ogpBasic]);
    } else if (!title && s.basics) {
      issue('info', 'title', 'title-basic-missing', 'Only the share title is filled in, so no &lt;title&gt; element is written.',
        'Enter the page title as well, or switch off the title, description and canonical option.', [SRC.gTitle]);
    }
    if (xOn && charLen(ogTitle) > LIMITS.xTitle) {
      issue('info', cleanText(s.ogTitle) ? 'ogtitle' : 'title', 'x-title-long', 'The share title has ' + charLen(ogTitle) +
        ' characters. X documents a maximum of 70 for twitter:title, which falls back to og:title.',
        'Shorten it, or set a shorter share title.', [SRC.xMarkup]);
    }
    if (!desc) {
      issue('warning', 'desc', 'desc-missing', 'No description. LinkedIn lists og:description among the tags that must exist, and Google may use the meta description for its snippet.',
        'Write one or two sentences about the page.', [SRC.liShare, SRC.gSnippet]);
    } else if (xOn && charLen(desc) > LIMITS.xDesc) {
      issue('info', 'desc', 'x-desc-long', 'The description has ' + charLen(desc) +
        ' characters. X documents a maximum of 200 for twitter:description, which falls back to og:description.',
        'Shorten it if the X card matters to you; Google and Meta set no such limit.', [SRC.xMarkup]);
    }

    // Locales
    var loc = checkLocale(s.locale);
    if (!loc.ok) {
      issue('warning', 'locale', 'locale-format', 'Locale ' + code(loc.value) + ' is not in the language_TERRITORY form ogp.me uses' +
        (loc.suggest ? '; did you mean ' + code(loc.suggest) + '?' : '.'), 'Write it like en_US or de_DE.', [SRC.ogpOptional]);
    }
    var alts = String(s.altLocales || '').split(/[\s,]+/).filter(Boolean);
    var badAlts = alts.filter(function (a) { return !checkLocale(a).ok; });
    if (badAlts.length) {
      issue('warning', 'altlocales', 'locale-format', listJoin(badAlts.map(code)) + (badAlts.length === 1 ? ' is' : ' are') +
        ' not in the language_TERRITORY form ogp.me uses.', 'Write each like de_DE or fr_FR.', [SRC.ogpOptional]);
    }

    // Type and article properties
    var type = s.type === 'article' ? 'article' : 'website';
    var pub = null, mod = null, authors = [], section = '', artTags = [];
    if (type === 'article') {
      [['pub', 'article:published_time'], ['mod', 'article:modified_time']].forEach(function (p) {
        var raw = String(s[p[0]] || '').trim();
        if (!raw) return;
        var dt = parseDateTime(raw);
        if (p[0] === 'pub') pub = dt; else mod = dt;
        if (!dt.ok) {
          issue('error', p[0], 'datetime-invalid', p[1] + ' ' + code(raw) + ' is not an ISO 8601 date.',
            'Use a form like 2026-10-27 or 2026-10-27T09:00:00+02:00.', [SRC.ogpDataTypes]);
        } else if (dt.hasTime && !dt.hasZone) {
          issue('info', p[0], 'datetime-no-zone', p[1] + ' ' + code(raw) + ' has a time but no time zone, so anyone reading it has to guess the zone.',
            'Add Z for UTC or an offset such as +02:00.', [SRC.ogpDataTypes]);
        }
      });
      if (pub && mod && pub.ok && mod.ok && mod.time < pub.time) {
        issue('warning', 'mod', 'modified-before-published', 'The last-changed time is earlier than the published time.',
          'Check both dates.', [SRC.ogpArticle]);
      }
      authors = splitList(s.author);
      var plain = authors.filter(function (a) { return !checkUrl(a).ok; });
      if (plain.length) {
        issue('info', 'author', 'author-not-url', 'ogp.me types article:author as a profile array, that is links to author pages; ' +
          listJoin(plain.map(code)) + (plain.length === 1 ? ' is' : ' are') + ' not a full URL.',
          'Use the URL of the author\'s page, such as https://example.com/about/.', [SRC.ogpArticle]);
      }
      section = cleanText(s.section);
      artTags = splitList(s.tags);
    }

    // Image
    var img = checkUrl(s.img);
    var imgOut = img.ok ? img.href : img.raw;
    var w = String(s.imgW || '').trim(), h = String(s.imgH || '').trim();
    var dimsOk = /^\d+$/.test(w) && /^\d+$/.test(h) && +w > 0 && +h > 0;
    var alt = cleanText(s.imgAlt);
    var guessed = guessMime(img.raw);
    var mime = s.imgType === 'auto' ? guessed : (s.imgType === 'none' ? '' : s.imgType);
    var pageHttps = canon.ok && canon.scheme === 'https';
    if (img.kind === 'empty') {
      issue('warning', 'img', 'image-missing', 'No share image. og:image is one of the four properties ogp.me requires, and without it Meta guesses an image from the page.',
        'Add the full URL of an image, for example 1200 x 630 pixels, which meets Meta\'s and LinkedIn\'s sizes.', [SRC.ogpBasic, SRC.metaGuide]);
    } else {
      if (!img.ok) {
        issue(urlLevel(img), 'img', 'image-not-absolute', urlProblem(img, 'The image URL'), urlFix(img), [SRC.ogpDataTypes]);
      } else if (img.scheme === 'http') {
        issue('warning', 'img', 'image-http', 'The image URL uses http://. X\'s developer policy requires HTTPS for every asset in a card' +
          (pageHttps ? ', and on this https page it is mixed content.' : '.'), 'Serve the image from an https:// URL.', [SRC.xPolicy, SRC.ogpStructured]);
      }
      if (guessed === 'image/svg+xml' || mime === 'image/svg+xml') {
        issue('error', 'img', 'image-svg', 'The image is an SVG. X does not support SVG in cards, and Meta lists only JPEG, GIF and PNG for og:image:type.',
          'Export the image as PNG or JPEG.', [SRC.xLarge, SRC.metaGuide]);
      }
      if (!w || !h) {
        issue('warning', 'imgdim', 'image-no-size', 'og:image:width and og:image:height are missing. Meta asks for them so the image loads properly the first time the page is shared.',
          'Enter the size in pixels, or choose the file below and press "Use these values".', [SRC.metaImages]);
      } else if (!dimsOk) {
        issue('error', 'imgdim', 'image-dims-invalid', 'Width ' + code(w) + ' and height ' + code(h) + ' must be whole numbers of pixels.',
          'Enter digits only, such as 1200 and 630.', [SRC.ogpDataTypes]);
      } else {
        imageChecks({ width: +w, height: +h }, s.card).forEach(function (g) {
          g.items.forEach(function (it) {
            if (it.status === 'bad') {
              issue('warning', 'imgdim', 'image-check-bad', escapeHtml(g.platform + ': ' + it.text), 'Use a larger image, for example 1200 x 630 pixels.', g.srcs);
            }
          });
        });
      }
      if (!alt) {
        issue('warning', 'imgalt', 'image-no-alt', 'No image description. ogp.me says a page that specifies og:image should specify og:image:alt, and X uses it as alt text for people using screen readers.',
          'Describe what the image shows.', [SRC.ogpStructured, SRC.xMarkup]);
      } else if (xOn && charLen(alt) > LIMITS.xAlt) {
        issue('warning', 'imgalt', 'x-alt-long', 'The image description has ' + charLen(alt) + ' characters; X allows at most 420 for the image alt text.',
          'Shorten it.', [SRC.xMarkup]);
      }
      if (s.imgType !== 'auto' && s.imgType !== 'none' && guessed && guessed !== s.imgType) {
        issue('info', 'imgtype', 'image-type-mismatch', 'The URL looks like ' + code(guessed) + ' but the type is set to ' + code(s.imgType) + '.',
          'Pick the type that matches the file.', [SRC.ogpStructured]);
      }
      if (mime === 'image/webp') {
        issue('info', 'imgtype', 'image-webp', 'WebP works in X cards, but Meta\'s guide lists only image/jpeg, image/gif and image/png for og:image:type.',
          'Use JPEG or PNG for the widest support.', [SRC.metaGuide, SRC.xLarge]);
      }
    }

    // X handles
    var ts = normalizeHandle(s.tsite), tc = normalizeHandle(s.tcreator);
    if (xOn) {
      [['tsite', ts, s.tsite], ['tcreator', tc, s.tcreator]].forEach(function (p) {
        if (!p[1].ok) {
          issue('warning', p[0], 'handle-invalid', code(String(p[2]).trim()) + ' is not a valid X username: letters, numbers and underscores, up to 15 characters.',
            'Enter the account name as @name.', [SRC.xHandle]);
        }
      });
    }

    // Facebook app ID
    var fb = String(s.fbapp || '').trim();
    if (fb && !/^\d+$/.test(fb)) {
      issue('error', 'fbapp', 'fb-app-id-invalid', 'A Facebook app ID is a number; ' + code(fb) + ' is not.',
        'Copy the App ID from the App Dashboard.', [SRC.metaGuide]);
    }

    // Tags
    if (s.basics) {
      if (title) tags.push({ type: 'title', value: title });
      if (desc) meta('name', 'description', desc);
      if (canon.kind !== 'empty') tags.push({ type: 'link', rel: 'canonical', href: urlOut });
    }
    tags.push({ type: 'comment', value: 'Open Graph (ogp.me)' });
    meta('property', 'og:type', type);
    if (ogTitle) meta('property', 'og:title', ogTitle);
    if (desc) meta('property', 'og:description', desc);
    if (canon.kind !== 'empty') meta('property', 'og:url', urlOut);
    if (site) meta('property', 'og:site_name', site);
    if (loc.value) meta('property', 'og:locale', loc.value);
    alts.forEach(function (a) { meta('property', 'og:locale:alternate', a); });
    if (img.kind !== 'empty') {
      meta('property', 'og:image', imgOut);
      if (mime) meta('property', 'og:image:type', mime);
      if (w) meta('property', 'og:image:width', w);
      if (h) meta('property', 'og:image:height', h);
      if (alt) meta('property', 'og:image:alt', alt);
    }
    if (type === 'article') {
      if (pub) meta('property', 'article:published_time', pub.value);
      if (mod) meta('property', 'article:modified_time', mod.value);
      authors.forEach(function (a) { meta('property', 'article:author', checkUrl(a).ok ? checkUrl(a).href : a); });
      if (section) meta('property', 'article:section', section);
      artTags.forEach(function (t) { meta('property', 'article:tag', t); });
    }
    if (fb) meta('property', 'fb:app_id', fb);
    if (xOn) {
      tags.push({ type: 'comment', value: 'X (Twitter) card' });
      meta('name', 'twitter:card', s.card === 'summary' ? 'summary' : 'summary_large_image');
      if (ts.value) meta('name', 'twitter:site', ts.value);
      if (tc.value) meta('name', 'twitter:creator', tc.value);
      if (s.trepeat) {
        if (ogTitle) meta('name', 'twitter:title', ogTitle);
        if (desc) meta('name', 'twitter:description', desc);
        if (img.kind !== 'empty') meta('name', 'twitter:image', imgOut);
        if (alt) meta('name', 'twitter:image:alt', alt);
      }
    }

    return {
      tags: tags,
      text: tags.map(tagHtml).join('\n'),
      issues: sortIssues(issues),
      values: {
        title: title, ogTitle: ogTitle, desc: desc, url: canon.ok ? canon.href : '', site: site,
        image: img.ok ? img.href : '', alt: alt, width: dimsOk ? +w : 0, height: dimsOk ? +h : 0, mime: mime,
        card: s.card, domain: canon.ok ? canon.host : ''
      }
    };
  }

  // ── HTML scanning (for the checker) ───────────────────────

  var CMT_OPEN = '<' + '!--';
  var CMT_CLOSE = '--' + '>';
  // noscript is read as raw text, as browsers with scripting do, so a tracking pixel
  // inside a head noscript does not count as the start of the body.
  var RAW_TEXT = toSet(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'noscript']);
  var RCDATA = toSet(['title', 'textarea']);
  var HEAD_OK = toSet(['html', 'head', 'title', 'base', 'link', 'meta', 'style', 'script', 'noscript', 'template']);
  var RECORD = toSet(['title', 'meta', 'link', 'base', 'html']);

  // Named character references most often seen in titles and descriptions;
  // numeric references (&#233; &#xE9;) are decoded in full.
  var NAMED = {
    amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, nbsp: 160, copy: 169, reg: 174, trade: 8482, hellip: 8230,
    mdash: 8212, ndash: 8211, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222,
    laquo: 171, raquo: 187, bull: 8226, middot: 183, euro: 8364, pound: 163, yen: 165, cent: 162, sect: 167,
    deg: 176, times: 215, divide: 247, shy: 173, para: 182, iexcl: 161, iquest: 191, eacute: 233, egrave: 232,
    ecirc: 234, aacute: 225, agrave: 224, acirc: 226, iacute: 237, oacute: 243, uacute: 250, uuml: 252,
    ouml: 246, auml: 228, Uuml: 220, Ouml: 214, Auml: 196, szlig: 223, ccedil: 231, ntilde: 241, Eacute: 201,
    rarr: 8594, larr: 8592, hyphen: 8208, minus: 8722, zwj: 8205, zwnj: 8204
  };

  function decodeEntities(v) {
    return String(v).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, function (m, body) {
      if (body.charAt(0) === '#') {
        var hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
        var cp = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!(cp > 0) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return String.fromCharCode(0xfffd);
        return String.fromCodePoint(cp);
      }
      return Object.prototype.hasOwnProperty.call(NAMED, body) ? String.fromCharCode(NAMED[body]) : m;
    });
  }

  function isWs(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
  }

  // Attributes of a start tag following the HTML tokenizer: quoted, unquoted and
  // empty values, names lowercased, later duplicates dropped.
  function parseAttrs(s, p) {
    var n = s.length;
    var attrs = Object.create(null);
    var dups = [];
    while (p < n) {
      var ch = s.charAt(p);
      if (isWs(ch) || ch === '/') { p++; continue; }
      if (ch === '>') return { attrs: attrs, dups: dups, end: p + 1 };
      var start = p;
      p++;
      while (p < n) {
        ch = s.charAt(p);
        if (isWs(ch) || ch === '/' || ch === '>' || ch === '=') break;
        p++;
      }
      var name = s.slice(start, p).toLowerCase();
      var q = p;
      while (q < n && isWs(s.charAt(q))) q++;
      var value = '';
      if (s.charAt(q) === '=') {
        q++;
        while (q < n && isWs(s.charAt(q))) q++;
        var qc = s.charAt(q);
        if (qc === '"' || qc === '\'') {
          var e = s.indexOf(qc, q + 1);
          value = e < 0 ? s.slice(q + 1) : s.slice(q + 1, e);
          q = e < 0 ? n : e + 1;
        } else {
          var vs = q;
          while (q < n && !isWs(s.charAt(q)) && s.charAt(q) !== '>') q++;
          value = s.slice(vs, q);
        }
        value = decodeEntities(value);
      }
      p = q;
      if (Object.prototype.hasOwnProperty.call(attrs, name)) dups.push(name);
      else attrs[name] = value;
    }
    return { attrs: attrs, dups: dups, end: n };
  }

  // Finds title, meta, link, base and html elements in pasted HTML, skipping
  // comments and the contents of script and style, and notes where the body starts.
  function scanHtml(src) {
    var s = String(src == null ? '' : src);
    var n = s.length;
    var lower = null;
    var elements = [];
    var bodyAt = -1;
    var i = 0;
    function lc() { if (lower === null) lower = s.toLowerCase(); return lower; }
    function textUntil(to) {
      if (bodyAt < 0 && /\S/.test(s.slice(i, to).replace(/&nbsp;/g, ''))) {
        var m = /\S/.exec(s.slice(i, to));
        bodyAt = i + (m ? m.index : 0);
      }
    }
    while (i < n) {
      var lt = s.indexOf('<', i);
      if (lt < 0) { textUntil(n); break; }
      if (lt > i) textUntil(lt);
      if (s.substr(lt, 4) === CMT_OPEN) {
        var ce = s.indexOf(CMT_CLOSE, lt + 4);
        i = ce < 0 ? n : ce + 3;
        continue;
      }
      var c = s.charAt(lt + 1);
      if (c === '!' || c === '?') {
        var gt = s.indexOf('>', lt);
        i = gt < 0 ? n : gt + 1;
        continue;
      }
      if (c === '/') {
        var endName = /^[A-Za-z][^\s/>]*/.exec(s.slice(lt + 2, lt + 40));
        var ge = s.indexOf('>', lt);
        if (!endName) { i = lt + 2; continue; }
        i = ge < 0 ? n : ge + 1;
        continue;
      }
      var nm = /^[A-Za-z][^\s/>]*/.exec(s.slice(lt + 1, lt + 64));
      if (!nm) {
        if (bodyAt < 0) bodyAt = lt;
        i = lt + 1;
        continue;
      }
      var tag = nm[0].toLowerCase();
      var parsed = parseAttrs(s, lt + 1 + nm[0].length);
      if (tag === 'body' || !HEAD_OK[tag]) { if (bodyAt < 0) bodyAt = lt; }
      var el = null;
      if (RECORD[tag]) {
        el = { tag: tag, attrs: parsed.attrs, dups: parsed.dups, offset: lt, inBody: bodyAt >= 0 && tag !== 'html' };
        elements.push(el);
      }
      i = parsed.end;
      if (RAW_TEXT[tag] || RCDATA[tag]) {
        var close = lc().indexOf('<' + '/' + tag, i);
        var to = close < 0 ? n : close;
        if (el && tag === 'title') el.text = cleanText(decodeEntities(s.slice(i, to)));
        i = to;
        if (close >= 0) {
          var g2 = s.indexOf('>', close);
          i = g2 < 0 ? n : g2 + 1;
        }
      }
    }
    return { elements: elements, bodyAt: bodyAt, length: n, bytes: utf8Len(s, 0, n), text: s };
  }

  function lineFinder(s) {
    var starts = [0];
    for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) starts.push(i + 1);
    return function (offset) {
      var lo = 0, hi = starts.length - 1;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
      }
      return lo + 1;
    };
  }

  // ── Checker ───────────────────────────────────────────────

  function lines(list) {
    return list.map(function (m) { return m.line; }).join(', ');
  }

  // Analyzes pasted HTML: every relevant tag, then missing, duplicate and conflicting
  // tags and invalid values, each issue with the value, the fix and the source.
  function analyzeHead(text, pageUrlRaw) {
    var scan = scanHtml(text);
    var src = scan.text;
    var lineOf = lineFinder(src);
    var issues = [];
    function add(level, codeId, msg, fix, srcs) {
      issues.push({ level: level, code: codeId, msg: msg, fix: fix || '', srcs: srcs || [] });
    }

    var titles = [], descs = [], canons = [], metas = [], found = [];
    var baseHref = '', htmlLang = null, dupAttrTags = [];
    scan.elements.forEach(function (el) {
      var line = lineOf(el.offset);
      if (el.dups.length) dupAttrTags.push({ line: line, tag: el.tag, names: el.dups });
      if (el.tag === 'html') { if (htmlLang === null && el.attrs.lang != null) htmlLang = el.attrs.lang; return; }
      if (el.tag === 'title') {
        titles.push({ text: el.text || '', line: line, inBody: el.inBody });
        found.push({ group: 'html', key: 'title', value: el.text || '', attr: '', line: line });
        return;
      }
      if (el.tag === 'base') { if (!baseHref && el.attrs.href) baseHref = el.attrs.href.trim(); return; }
      if (el.tag === 'link') {
        var rels = String(el.attrs.rel || '').toLowerCase().split(/\s+/);
        if (rels.indexOf('canonical') >= 0) {
          var extra = ['hreflang', 'lang', 'media', 'type'].filter(function (a) { return el.attrs[a] != null; });
          var href = el.attrs.href == null ? null : el.attrs.href.trim();
          canons.push({ href: href, line: line, inBody: el.inBody, extra: extra });
          found.push({ group: 'html', key: 'link rel="canonical"', value: href == null ? '' : href, attr: '', line: line });
        }
        return;
      }
      // meta
      var prop = el.attrs.property, name = el.attrs.name;
      var entries = [];
      if (prop != null && prop.trim()) entries.push({ attr: 'property', keyRaw: prop.trim() });
      if (name != null && name.trim() && (!entries.length || name.trim().toLowerCase() !== entries[0].keyRaw.toLowerCase())) {
        entries.push({ attr: 'name', keyRaw: name.trim() });
      }
      entries.forEach(function (e) {
        var key = e.keyRaw.toLowerCase();
        var colon = key.indexOf(':');
        var ns = colon > 0 ? key.slice(0, colon) : '';
        var group = key === 'description' || key === 'robots' ? 'html' : OG_FAMILY[ns] ? (ns === 'fb' ? 'fb' : 'og') : ns === 'twitter' ? 'x' : '';
        if (!group) return;
        var m = {
          attr: e.attr, keyRaw: e.keyRaw, key: key, ns: ns, group: group,
          value: el.attrs.content == null ? null : el.attrs.content, line: line, inBody: el.inBody, offset: el.offset
        };
        metas.push(m);
        if (key === 'description') descs.push(m);
        found.push({ group: group, key: key, value: m.value == null ? '' : m.value, attr: e.attr, line: line, missingContent: m.value == null });
      });
    });

    var social = metas.filter(function (m) { return m.group === 'og' || m.group === 'fb' || m.group === 'x'; });
    function all(key) { return social.filter(function (m) { return m.key === key; }); }
    function val(m) { return m && m.value != null ? m.value.trim() : ''; }
    function firstVal(key) {
      var list = all(key);
      for (var i = 0; i < list.length; i++) if (val(list[i])) return val(list[i]);
      return '';
    }

    var result = {
      empty: !titles.length && !canons.length && !metas.length,
      bytes: scan.bytes,
      found: found,
      issues: [],
      counts: { error: 0, warning: 0, info: 0 },
      imageChecks: null,
      platforms: [],
      pageUrl: '',
      values: {}
    };
    if (result.empty) {
      add('warning', 'nothing-found', 'No title, meta or link tags were found in the pasted text.',
        'Paste the page\'s HTML source: View Source in the browser, then select all and copy.', [SRC.htmlMeta]);
      result.issues = issues;
      result.counts.warning = 1;
      return result;
    }

    // Page address: the field, else the canonical link, else og:url
    var pageInput = checkUrl(pageUrlRaw);
    var canonFirst = canons.length ? checkUrl(canons[0].href) : null;
    var ogUrlCheck = firstVal('og:url') ? checkUrl(firstVal('og:url')) : null;
    var pageUrl = pageInput.ok ? pageInput.href : (canonFirst && canonFirst.ok ? canonFirst.href : (ogUrlCheck && ogUrlCheck.ok ? ogUrlCheck.href : ''));
    var base = pageUrl;
    if (baseHref) {
      try { base = new URL(baseHref, pageUrl || undefined).href; } catch (e) { /* keep the page URL */ }
    }
    var pageScheme = pageUrl ? pageUrl.slice(0, pageUrl.indexOf(':')) : '';
    result.pageUrl = pageUrl;

    // Title
    if (!titles.length) {
      add('warning', 'title-missing', 'No &lt;title&gt; element. Google asks for one on every page, and HTML requires it in most documents.',
        'Add &lt;title&gt;…&lt;/title&gt; inside &lt;head&gt;.', [SRC.gTitle, SRC.htmlTitle]);
    } else {
      if (titles.length > 1) {
        add('error', 'title-multiple', 'There are ' + titles.length + ' &lt;title&gt; elements (lines ' + lines(titles) + '); HTML allows no more than one per document.',
          'Keep one. Two titles usually mean the theme and an SEO plugin both print one.', [SRC.htmlTitle]);
      }
      if (!titles[0].text) add('warning', 'title-empty', 'The &lt;title&gt; on line ' + titles[0].line + ' is empty.', 'Write a descriptive title.', [SRC.gTitle]);
    }

    // Meta description
    if (!descs.length) {
      add('info', 'desc-missing', 'No meta description. Google may use it for the snippet in search results; without it, Google uses text from the page.',
        'Add &lt;meta name="description" content="…"&gt; with a short summary.', [SRC.gSnippet]);
    } else {
      if (descs.length > 1) {
        add('error', 'desc-multiple', 'There are ' + descs.length + ' meta descriptions (lines ' + lines(descs) + '); HTML allows no more than one per document.',
          'Keep one; when an SEO plugin prints one, remove the theme\'s.', [SRC.htmlDescription]);
      }
      descs.forEach(function (d) {
        if (d.value != null && !d.value.trim()) add('warning', 'meta-empty', 'The meta description on line ' + d.line + ' is empty.', 'Write a short summary or remove the tag.', [SRC.gSnippet]);
      });
    }

    // Canonical links
    if (!canons.length) {
      add('info', 'canonical-missing', 'No &lt;link rel="canonical"&gt;. It is optional; without it Google picks the canonical URL itself.',
        'Add one pointing at the page\'s preferred URL.', [SRC.gCanonical]);
    } else {
      var distinct = [];
      canons.forEach(function (c) {
        var key = c.href || '';
        if (distinct.indexOf(key) < 0) distinct.push(key);
      });
      if (distinct.length > 1) {
        add('error', 'canonical-multiple', 'There are ' + canons.length + ' canonical links with different URLs (' + listJoin(distinct.map(code)) + '). Google asks for one consistent canonical URL per page.',
          'Keep one canonical link.', [SRC.gCanonicalBest]);
      } else if (canons.length > 1) {
        add('info', 'canonical-duplicate', 'The canonical link appears ' + canons.length + ' times with the same URL (lines ' + lines(canons) + ').',
          'Remove the extra copy.', [SRC.gCanonical]);
      }
      canons.forEach(function (c) {
        if (c.href == null || !c.href) {
          add('error', 'canonical-empty', 'The canonical link on line ' + c.line + ' has no href.', 'Add the full URL.', [SRC.gCanonical]);
          return;
        }
        var cu = checkUrl(c.href, base);
        if (!cu.ok) {
          add(cu.kind === 'relative' || cu.kind === 'scheme-relative' ? 'warning' : 'error', 'canonical-not-absolute',
            'The canonical URL ' + code(c.href) + ' on line ' + c.line + ' is not a full https:// address. Google supports relative paths here but recommends absolute ones.',
            urlFix(cu), [SRC.gCanonical]);
        } else if (cu.hasHash) {
          add('warning', 'canonical-fragment', 'The canonical URL ' + code(c.href) + ' contains a #fragment, which Google generally does not support.',
            'Remove the part from # on.', [SRC.gCanonicalBest]);
        }
        if (c.inBody) {
          add('warning', 'canonical-in-body', 'The canonical link on line ' + c.line + ' comes after the page body starts. Google only accepts rel="canonical" in the &lt;head&gt;.',
            'Move it into &lt;head&gt;, and check that nothing before it (such as a stray element or text) ends the head early.', [SRC.gCanonical]);
        }
        if (c.extra.length) {
          add('warning', 'canonical-alt-attrs', 'The canonical link on line ' + c.line + ' has ' + listJoin(c.extra.map(code)) +
            '. Google does not use rel="canonical" links with hreflang, lang, media or type for canonicalization.',
            'Remove those attributes, or use rel="alternate" for alternate versions.', [SRC.gCanonical]);
        }
      });
    }

    // Attribute style
    var nameAttr = social.filter(function (m) { return (m.group === 'og' || m.group === 'fb') && m.attr === 'name'; });
    if (nameAttr.length) {
      add('warning', 'og-name-attr', plural(nameAttr.length, 'Open Graph tag') + (nameAttr.length === 1 ? ' uses' : ' use') + ' name= instead of property= (' +
        listJoin(nameAttr.slice(0, 6).map(function (m) { return code(m.keyRaw) + ' on line ' + m.line; })) + (nameAttr.length > 6 ? ', …' : '') +
        '). The Open Graph protocol and Meta\'s examples use the property attribute.',
        'Change name="' + escapeHtml(nameAttr[0].keyRaw) + '" to property="' + escapeHtml(nameAttr[0].keyRaw) + '".', [SRC.ogpBasic, SRC.metaGuide]);
    }
    var propX = social.filter(function (m) { return m.group === 'x' && m.attr === 'property'; });
    if (propX.length) {
      add('info', 'x-property-attr', plural(propX.length, 'X tag') + (propX.length === 1 ? ' uses' : ' use') + ' property= (first on line ' + propX[0].line +
        '). X documents name= for its tags; its archived guide says the parser falls back to property, so these still work.',
        'Prefer name="twitter:…" for new markup.', [SRC.xStart]);
    }
    var upper = social.filter(function (m) { return m.keyRaw !== m.key; });
    if (upper.length) {
      add('info', 'key-case', listJoin(upper.slice(0, 4).map(function (m) { return code(m.keyRaw) + ' (line ' + m.line + ')'; })) +
        ' ' + (upper.length === 1 ? 'is' : 'are') + ' not written in lowercase like the property names ogp.me and X define.',
        'Write them in lowercase, such as ' + code(upper[0].key) + '.', [SRC.ogpBasic]);
    }
    metas.forEach(function (m) {
      if (m.value == null) {
        add('warning', 'meta-no-content', code(m.keyRaw) + ' on line ' + m.line + ' has no content attribute, so it carries no value. HTML requires content whenever name is given.',
          'Add content="…".', [SRC.htmlMeta]);
      } else if (!m.value.trim() && m.key !== 'description') {
        add('warning', 'meta-empty', code(m.keyRaw) + ' on line ' + m.line + ' has an empty value.', 'Fill it in or remove the tag.', [SRC.ogpBasic]);
      }
    });
    dupAttrTags.forEach(function (d) {
      add('info', 'dup-attr', 'The &lt;' + d.tag + '&gt; on line ' + d.line + ' repeats ' + listJoin(d.names.map(code)) +
        '. HTML forbids repeated attributes, and parsers keep only the first.', 'Remove the repeated attribute.', [SRC.htmlAttrs]);
    });

    // Placement
    var late = social.filter(function (m) { return m.inBody; });
    if (late.length) {
      add('warning', 'tags-in-body', plural(late.length, 'social tag') + (late.length === 1 ? ' comes' : ' come') + ' after the page body starts (first ' + code(late[0].keyRaw) + ' on line ' + late[0].line +
        '). ogp.me places these tags in the &lt;head&gt;, and X\'s guide adds card markup to the head section.',
        'Move them into &lt;head&gt;. If they are already there, look for an element or text before them that ends the head early.', [SRC.ogpBasic, SRC.xStart]);
    }
    if (scan.bytes > LIMITS.metaFirstBytes) {
      var ogTags = social.filter(function (m) { return m.group === 'og' || m.group === 'fb'; }).sort(function (a, b) { return a.offset - b.offset; });
      var pos = 0, bytes = 0, tooLate = [];
      ogTags.forEach(function (m) {
        bytes += utf8Len(src, pos, m.offset);
        pos = m.offset;
        if (bytes > LIMITS.metaFirstBytes) tooLate.push(m);
      });
      if (tooLate.length) {
        add('warning', 'og-after-1mb', plural(tooLate.length, 'Open Graph tag') + (tooLate.length === 1 ? ' starts' : ' start') + ' after the first 1 MB of the page (first ' + code(tooLate[0].keyRaw) + ' on line ' + tooLate[0].line +
          '). Meta says Open Graph properties must be within the first 1 MB, or they are cut off.',
          'Move the tags to the top of &lt;head&gt;, before large inline scripts and styles.', [SRC.metaCrawler]);
      }
    }
    if (scan.bytes > LIMITS.xPageBytes) {
      add('info', 'page-over-2mb', 'The pasted source is ' + fmtBytes(scan.bytes) + '. X\'s archived troubleshooting guide gives a 2 MB limit for page responses.',
        'Make the HTML smaller, for example by moving inline scripts and data into separate files.', [SRC.xTrouble]);
    }

    // Unknown or misspelt properties
    var reported = Object.create(null);
    social.forEach(function (m) {
      if (KNOWN[m.key] || reported[m.key]) return;
      reported[m.key] = true;
      var guess = m.key.length > 5 ? closest(m.key, KNOWN_LIST.filter(function (k) { return k.split(':')[0] === m.ns; }), 2) : '';
      if (guess) {
        add('warning', 'unknown-property', code(m.keyRaw) + ' on line ' + m.line + ' is not a property ogp.me, Meta or X define; did you mean ' + code(guess) + '?',
          'Rename it to ' + code(guess) + '.', m.ns === 'twitter' ? [SRC.xMarkup] : [SRC.ogpBasic]);
      } else {
        add('info', 'unknown-property', code(m.keyRaw) + ' on line ' + m.line + ' is not defined by ogp.me, Meta\'s sharing guide or X\'s markup reference, so this checker does not know how platforms treat it.',
          '', m.ns === 'twitter' ? [SRC.xMarkup] : [SRC.ogpBasic]);
      }
    });

    // Duplicates of single-valued properties
    var groups = Object.create(null);
    var order = [];
    social.forEach(function (m) {
      if (ARRAY_KEYS[m.key] || /^og:(image|video|audio)(:|$)/.test(m.key) || m.key === 'twitter:card') return;
      if (!groups[m.key]) { groups[m.key] = []; order.push(m.key); }
      groups[m.key].push(m);
    });
    order.forEach(function (key) {
      var list = groups[key];
      if (list.length < 2) return;
      var vals = [];
      list.forEach(function (m) { if (vals.indexOf(val(m)) < 0) vals.push(val(m)); });
      var isOg = list[0].group !== 'x';
      if (vals.length === 1) {
        add('info', 'dup-same', code(key) + ' appears ' + list.length + ' times with the same value (lines ' + lines(list) +
          '). Harmless, but usually a sign that two plugins, or a plugin and the theme, both print tags.', 'Remove the extra copies.', isOg ? [SRC.ogpArrays] : [SRC.xMarkup]);
      } else {
        add('warning', 'dup-conflict', code(key) + ' appears ' + list.length + ' times with different values: ' +
          list.map(function (m) { return 'line ' + m.line + ' ' + code(val(m)); }).join(', ') + '. ' +
          (isOg ? 'ogp.me gives the first value preference, so ' + code(firstVal(key)) + ' wins.' : 'X documents which one wins only for twitter:card, so keep one.'),
          'Remove the extra tags; when an SEO plugin and the theme both print them, turn one of them off.', isOg ? [SRC.ogpArrays] : [SRC.xMarkup]);
      }
    });

    // Required and recommended Open Graph properties
    var REQ = [
      ['og:title', 'warning', 'og:title is missing. ogp.me lists it among the four required properties, and LinkedIn among the tags that must exist.', [SRC.ogpBasic, SRC.liShare]],
      ['og:type', 'info', 'og:type is missing. ogp.me lists it as required; Meta treats a page without it as website.', [SRC.ogpBasic, SRC.metaGuide]],
      ['og:image', 'warning', 'og:image is missing. ogp.me requires it, LinkedIn lists it among the tags that must exist, and without it Meta guesses an image from the page.', [SRC.ogpBasic, SRC.liShare, SRC.metaGuide]],
      ['og:url', 'warning', 'og:url is missing. ogp.me requires it as the canonical URL of the page, and LinkedIn lists it among the tags that must exist.', [SRC.ogpBasic, SRC.liShare]],
      ['og:description', 'warning', 'og:description is missing. LinkedIn lists it among the tags that must exist, and Meta shows it below the title.', [SRC.liShare, SRC.metaGuide]]
    ];
    var hasImage = all('og:image').length > 0 || all('og:image:url').length > 0;
    REQ.forEach(function (r) {
      var present = r[0] === 'og:image' ? hasImage : all(r[0]).length > 0;
      if (!present) add(r[1], 'og-missing', r[2], 'Add &lt;meta property="' + r[0] + '" content="…"&gt;.', r[3]);
    });
    if (!all('og:site_name').length) {
      add('info', 'og-missing', 'og:site_name is missing. It is optional; ogp.me uses it for the name of the overall site.', 'Add &lt;meta property="og:site_name" content="…"&gt;.', [SRC.ogpOptional]);
    }

    // og:url
    var ogUrl = firstVal('og:url');
    if (ogUrl) {
      var ou = checkUrl(ogUrl, base);
      if (!ou.ok) {
        add(urlLevel(ou), 'og-url-not-absolute', urlProblem(ou, 'og:url'), urlFix(ou), [SRC.ogpDataTypes]);
      } else {
        var dec = decoratedParams(ou.href);
        if (dec.length) {
          add('warning', 'og-url-decorated', 'og:url carries ' + listJoin(dec.map(code)) + '. Meta asks for the undecorated URL, without session variables, user identifying parameters or counters.',
            'Remove those parameters.', [SRC.metaGuide]);
        }
        if (canonFirst && canonFirst.ok && canonFirst.href !== ou.href) {
          add('warning', 'og-url-canonical-mismatch', 'og:url ' + code(ogUrl) + ' differs from the canonical link ' + code(canons[0].href) + ' (' + urlDiff(ou.href, canonFirst.href).join(', ') +
            '). ogp.me and Meta describe og:url as the canonical URL of the page, and Meta aggregates likes and shares at it.',
            'Use the same URL in both, here probably ' + code(canonFirst.href) + '.', [SRC.ogpBasic, SRC.metaGuide]);
        }
      }
    }

    // og:type and namespaces
    var ogType = firstVal('og:type');
    if (ogType) {
      if (OG_TYPES.indexOf(ogType) < 0) {
        if (OG_TYPES.indexOf(ogType.toLowerCase()) >= 0) {
          add('warning', 'og-type-case', 'og:type ' + code(ogType) + ' should be written in lowercase: ' + code(ogType.toLowerCase()) + '.', 'Use ' + code(ogType.toLowerCase()) + '.', [SRC.ogpTypes]);
        } else if (ogType.indexOf(':') > 0) {
          add('info', 'og-type-custom', 'og:type ' + code(ogType) + ' is a custom namespaced type. ogp.me allows these, but platforms may treat the page as website.', '', [SRC.ogpTypes]);
        } else {
          var tg = closest(ogType.toLowerCase(), OG_TYPES, 3);
          add('warning', 'og-type-unknown', 'og:type ' + code(ogType) + ' is not one of the types ogp.me defines' + (tg ? '; did you mean ' + code(tg) + '?' : '.'),
            'Use website, article, book, profile or one of the music. and video. types.', [SRC.ogpTypes]);
        }
      }
    }
    var typeLower = ogType.toLowerCase() || 'website';
    Object.keys(NS_TYPE).forEach(function (ns) {
      var used = social.filter(function (m) { return m.ns === ns; });
      if (used.length && !NS_TYPE[ns].test(typeLower)) {
        add('warning', 'ns-type-mismatch', listJoin(used.slice(0, 3).map(function (m) { return code(m.key); })) + (used.length > 3 ? ' and others' : '') +
          ' belong to og:type ' + code(NS_TYPE[ns].want) + ', but og:type is ' + (ogType ? code(ogType) : 'missing (website)') + '.',
          'Set og:type to ' + code(NS_TYPE[ns].want) + ', or remove the ' + ns + ': properties.', [SRC.ogpArticle]);
      }
    });

    // Values: dates, integers, URLs, locales, determiner, app ID
    social.forEach(function (m) {
      var v = val(m);
      if (!v) return;
      if (DATE_KEYS[m.key]) {
        var dt = parseDateTime(v);
        if (!dt.ok) {
          add('warning', 'datetime-invalid', code(m.key) + ' ' + code(v) + ' on line ' + m.line + ' is not an ISO 8601 date, which ogp.me requires for DateTime values.',
            'Use a form like 2026-10-27 or 2026-10-27T09:00:00+02:00.', [SRC.ogpDataTypes]);
        } else if (dt.hasTime && !dt.hasZone) {
          add('info', 'datetime-no-zone', code(m.key) + ' ' + code(v) + ' has a time but no time zone.', 'Add Z for UTC or an offset such as +02:00.', [SRC.ogpDataTypes]);
        }
      } else if (INT_KEYS[m.key] && !/^\d+$/.test(v)) {
        add('warning', 'not-integer', code(m.key) + ' ' + code(v) + ' on line ' + m.line + ' is not a whole number.', 'Write digits only.', [SRC.ogpDataTypes]);
      } else if (URL_KEYS[m.key]) {
        var uu = checkUrl(v, base);
        if (!uu.ok) add(urlLevel(uu), 'url-not-absolute', urlProblem(uu, code(m.key)), urlFix(uu), [SRC.ogpDataTypes]);
      } else if (m.key === 'og:locale' || m.key === 'og:locale:alternate') {
        var lc = checkLocale(v);
        if (!lc.ok) {
          add('warning', 'locale-format', code(m.key) + ' ' + code(v) + ' is not in the language_TERRITORY form ogp.me uses' + (lc.suggest ? '; did you mean ' + code(lc.suggest) + '?' : '.'),
            'Write it like en_US.', [SRC.ogpOptional]);
        }
      } else if (m.key === 'fb:app_id' && !/^\d+$/.test(v)) {
        add('error', 'fb-app-id-invalid', 'fb:app_id ' + code(v) + ' is not a number.', 'Copy the App ID from the App Dashboard.', [SRC.metaGuide]);
      }
      if (m.key === 'og:determiner' && DETERMINERS.indexOf(v) < 0) {
        add('warning', 'determiner-invalid', 'og:determiner ' + code(v) + ' is not one of a, an, the, auto or empty.', 'Use one of those, or remove the tag.', [SRC.ogpOptional]);
      }
    });
    var pubT = firstVal('article:published_time'), modT = firstVal('article:modified_time');
    if (pubT && modT) {
      var p1 = parseDateTime(pubT), p2 = parseDateTime(modT);
      if (p1.ok && p2.ok && p2.time < p1.time) {
        add('warning', 'modified-before-published', 'article:modified_time ' + code(modT) + ' is earlier than article:published_time ' + code(pubT) + '.', 'Check both dates.', [SRC.ogpArticle]);
      }
    }

    // Images, grouped the way ogp.me describes structured properties
    var images = [], cur = null, orphans = [];
    social.forEach(function (m) {
      if (!/^og:image(:|$)/.test(m.key)) return;
      var sub = m.key.slice(9);
      var v = val(m);
      if (!sub) {
        cur = { url: v, line: m.line, props: {}, conflicts: [] };
        images.push(cur);
        return;
      }
      if (sub === 'url') {
        if (!cur || cur.props.url != null) {
          cur = { url: v, line: m.line, props: { url: v }, conflicts: [] };
          images.push(cur);
        } else {
          cur.props.url = v;
          if (cur.url && v && v !== cur.url) cur.conflicts.push('url');
          if (!cur.url) cur.url = v;
        }
        return;
      }
      if (!cur) { orphans.push(m); return; }
      if (cur.props[sub] != null) {
        if (cur.props[sub] !== v && cur.conflicts.indexOf(sub) < 0) cur.conflicts.push(sub);
        return;
      }
      cur.props[sub] = v;
    });
    if (orphans.length) {
      add('warning', 'image-orphan-prop', listJoin(orphans.map(function (m) { return code(m.key) + ' on line ' + m.line; })) + ' come' + (orphans.length === 1 ? 's' : '') +
        ' before any og:image, so ' + (orphans.length === 1 ? 'it belongs' : 'they belong') + ' to no image. ogp.me: put structured properties after the og:image they describe.',
        'Move ' + (orphans.length === 1 ? 'it' : 'them') + ' below the og:image tag.', [SRC.ogpArrays]);
    }
    if (images.length > 1) {
      add('info', 'image-multiple', 'The page lists ' + images.length + ' images (lines ' + lines(images) + '). ogp.me treats them as a list and gives the first, ' +
        code(images[0].url) + ', preference.', 'Put the image you want shown first.', [SRC.ogpArrays]);
    }
    var xImgAlt = firstVal('twitter:image:alt');
    images.forEach(function (im, idx) {
      var label = images.length > 1 ? 'og:image ' + (idx + 1) + ' (line ' + im.line + ')' : 'og:image';
      if (!im.url) {
        add('error', 'image-empty', label + ' has an empty value.', 'Put the full image URL in content.', [SRC.ogpBasic]);
      } else {
        var iu = checkUrl(im.url, base);
        if (!iu.ok) {
          add(urlLevel(iu), 'image-not-absolute', urlProblem(iu, label), urlFix(iu), [SRC.ogpDataTypes]);
        } else if (iu.scheme === 'http') {
          add('warning', 'image-http', label + ' ' + code(im.url) + ' uses http://. X\'s developer policy requires HTTPS for every asset in a card' +
            (pageScheme === 'https' ? ', and on an https page the image is mixed content.' : '.'), 'Serve the image over https://' +
            (im.props.secure_url ? '.' : '; ogp.me also offers og:image:secure_url for an HTTPS copy.'), [SRC.xPolicy, SRC.ogpStructured]);
        }
        if (guessMime(im.url) === 'image/svg+xml') {
          add('warning', 'image-svg', label + ' is an SVG. X does not support SVG in cards, and Meta lists only JPEG, GIF and PNG.', 'Use a PNG or JPEG.', [SRC.xLarge, SRC.metaGuide]);
        }
      }
      if (im.props.secure_url && !/^https:\/\//i.test(im.props.secure_url)) {
        add('warning', 'secure-url-not-https', 'og:image:secure_url ' + code(im.props.secure_url) + ' is not an https:// URL.', 'Use the https:// address of the image.', [SRC.ogpStructured]);
      }
      var t = String(im.props.type || '').toLowerCase();
      if (im.props.type != null && t) {
        if (!/^image\/[a-z0-9.+-]+$/.test(t)) {
          add('warning', 'image-type-invalid', 'og:image:type ' + code(im.props.type) + ' is not an image MIME type.', 'Use image/jpeg, image/png or image/gif.', [SRC.ogpStructured, SRC.metaGuide]);
        } else if (t === 'image/webp') {
          add('info', 'image-webp', 'og:image:type is image/webp. X supports WebP, but Meta\'s guide lists only image/jpeg, image/gif and image/png.', 'Use JPEG or PNG for the widest support.', [SRC.metaGuide, SRC.xLarge]);
        } else if (t === 'image/svg+xml') {
          add('warning', 'image-svg', 'og:image:type is image/svg+xml. X does not support SVG in cards, and Meta lists only JPEG, GIF and PNG.', 'Use a PNG or JPEG.', [SRC.xLarge, SRC.metaGuide]);
        }
      }
      var wv = im.props.width, hv = im.props.height;
      if (wv == null || hv == null || !wv || !hv) {
        add('warning', 'image-no-size', label + ' has no ' + (wv ? 'og:image:height' : hv ? 'og:image:width' : 'og:image:width and og:image:height') +
          '. Meta asks for both so the image loads properly the first time the page is shared.', 'Add the image size in pixels.', [SRC.metaImages]);
      } else if (!/^\d+$/.test(wv) || !/^\d+$/.test(hv)) {
        add('error', 'image-dims-invalid', label + ' size ' + code(wv) + ' x ' + code(hv) + ' is not two whole numbers.', 'Write the width and height in pixels, digits only.', [SRC.ogpDataTypes]);
      }
      if (!im.props.alt) {
        add('warning', 'image-no-alt', label + ' has no og:image:alt. ogp.me says a page that specifies og:image should specify og:image:alt' +
          (xImgAlt ? '; twitter:image:alt covers X only.' : '.'), 'Add &lt;meta property="og:image:alt" content="…"&gt; describing the image.', [SRC.ogpStructured]);
      }
      if (im.conflicts.length) {
        add('warning', 'image-prop-conflict', label + ' has conflicting ' + listJoin(im.conflicts.map(function (c) { return code('og:image:' + c); })) + ' values; the first one counts.',
          'Keep one value per property.', [SRC.ogpArrays]);
      }
    });

    // X card
    var cards = all('twitter:card');
    var cardVal = cards.length ? val(cards[cards.length - 1]) : '';
    var ogTitle = firstVal('og:title'), ogDesc = firstVal('og:description');
    var fallbackSummary = !cards.length && !!ogType && !!ogTitle && !!ogDesc;
    if (!cards.length) {
      if (fallbackSummary) {
        add('info', 'x-card-missing', 'No twitter:card. X\'s markup reference says a summary card may be rendered when og:type, og:title and og:description exist, so at best you get the small-image card.',
          'Add &lt;meta name="twitter:card" content="summary_large_image"&gt; for a large image.', [SRC.xMarkup]);
      } else {
        add('warning', 'x-card-missing', 'No twitter:card, and og:type, og:title and og:description are not all present, which is what X\'s markup reference needs for its summary-card fallback.',
          'Add &lt;meta name="twitter:card" content="summary_large_image"&gt;.', [SRC.xMarkup]);
      }
    } else {
      var cardVals = [];
      cards.forEach(function (m) { if (cardVals.indexOf(val(m)) < 0) cardVals.push(val(m)); });
      if (cardVals.length > 1) {
        add('warning', 'x-card-multiple', 'twitter:card appears ' + cards.length + ' times with different values (lines ' + lines(cards) + '). X uses the last one, ' + code(cardVal) + '.',
          'Keep one twitter:card.', [SRC.xStart]);
      } else if (cards.length > 1) {
        add('info', 'dup-same', 'twitter:card appears ' + cards.length + ' times with the same value (lines ' + lines(cards) + ').', 'Remove the extra copies.', [SRC.xStart]);
      }
      if (cardVal === 'photo' || cardVal === 'gallery') {
        add('warning', 'x-card-deprecated', 'twitter:card ' + code(cardVal) + ' is a retired card type; X maps it to summary_large_image.', 'Use summary_large_image.', [SRC.xLarge]);
      } else if (CARD_TYPES.indexOf(cardVal) < 0) {
        add('error', 'x-card-invalid', 'twitter:card ' + code(cardVal) + ' is not a card type. X documents summary, summary_large_image, app and player.',
          'Use summary_large_image or summary.', [SRC.xStart]);
      }
    }
    ['twitter:site', 'twitter:creator'].forEach(function (key) {
      var v = firstVal(key);
      if (!v) return;
      var hd = normalizeHandle(v);
      if (!hd.ok) {
        add('warning', 'x-handle-invalid', code(key) + ' ' + code(v) + ' is not a valid X username: letters, numbers and underscores, up to 15 characters.',
          'Write it as @name.', [SRC.xHandle]);
      } else if (!/^@/.test(v)) {
        add('info', 'x-handle-no-at', code(key) + ' ' + code(v) + ' has no @. X describes the value as the @username.', 'Write ' + code(hd.value) + '.', [SRC.xMarkup]);
      }
    });
    var tTitle = firstVal('twitter:title'), tDesc = firstVal('twitter:description'), tImg = firstVal('twitter:image');
    var firstImg = images[0] || null;
    var xTitle = tTitle || ogTitle, xDesc = tDesc || ogDesc, xImg = tImg || (firstImg ? firstImg.url : ''), xAlt = xImgAlt || (firstImg ? firstImg.props.alt || '' : '');
    if (cardVal !== 'app' && cardVal !== 'player' && (cards.length || fallbackSummary)) {
      if (charLen(xTitle) > LIMITS.xTitle) {
        add('info', 'x-title-long', (tTitle ? 'twitter:title' : 'og:title, which X uses as the title,') + ' has ' + charLen(xTitle) + ' characters; X documents a maximum of 70.',
          'Shorten it, or add a shorter twitter:title.', [SRC.xMarkup]);
      }
      if (charLen(xDesc) > LIMITS.xDesc) {
        add('info', 'x-desc-long', (tDesc ? 'twitter:description' : 'og:description, which X uses as the description,') + ' has ' + charLen(xDesc) + ' characters; X documents a maximum of 200.',
          'Shorten it, or add a shorter twitter:description.', [SRC.xMarkup]);
      }
      if (charLen(xAlt) > LIMITS.xAlt) {
        add('warning', 'x-alt-long', 'The image alt text X uses has ' + charLen(xAlt) + ' characters; X allows at most 420.', 'Shorten it.', [SRC.xMarkup]);
      }
    }
    if (tImg) {
      var tu = checkUrl(tImg, base);
      if (!tu.ok) add(urlLevel(tu), 'image-not-absolute', urlProblem(tu, 'twitter:image'), urlFix(tu), [SRC.xMarkup]);
      else if (tu.scheme === 'http') add('warning', 'image-http', 'twitter:image ' + code(tImg) + ' uses http://. X\'s developer policy requires HTTPS for every asset in a card.', 'Serve it over https://.', [SRC.xPolicy]);
    }
    if (cardVal === 'summary_large_image' && !xImg) {
      add('warning', 'x-large-no-image', 'twitter:card is summary_large_image, but there is no twitter:image or og:image.', 'Add og:image (X falls back to it).', [SRC.xMarkup]);
    }

    // Image size against the documented recommendations (first image)
    var cardForChecks = cardVal === 'summary' || (!cards.length && fallbackSummary) ? 'summary' : 'summary_large_image';
    if (firstImg && /^\d+$/.test(firstImg.props.width || '') && /^\d+$/.test(firstImg.props.height || '')) {
      result.imageChecks = imageChecks({ width: +firstImg.props.width, height: +firstImg.props.height, mime: firstImg.props.type || guessMime(firstImg.url) }, cardForChecks);
      result.imageChecks.forEach(function (g) {
        g.items.forEach(function (it) {
          if (it.status === 'bad') add('warning', 'image-check-bad', escapeHtml(g.platform + ': ' + it.text), 'Use a larger image, for example 1200 x 630 pixels.', g.srcs);
        });
      });
    }

    // What each platform would use
    var titleText = titles.length ? titles[0].text : '';
    var descText = descs.length ? val(descs[0]) : '';
    result.platforms = [
      { name: 'Google Search', note: 'Google writes title links and snippets itself; these are the tags it may use.', rows: [
        { label: 'Title link', value: titleText, from: '<title>' },
        { label: 'Snippet', value: descText, from: 'meta description' },
        { label: 'Canonical', value: canons.length ? canons[0].href || '' : '', from: 'link rel="canonical"' }
      ] },
      { name: 'Meta (Facebook)', note: 'Meta reads the og: tags; the first value of each counts.', rows: [
        { label: 'Title', value: ogTitle, from: 'og:title' },
        { label: 'Description', value: ogDesc, from: 'og:description' },
        { label: 'Image', value: firstImg ? firstImg.url : '', from: 'og:image' },
        { label: 'URL', value: ogUrl, from: 'og:url' },
        { label: 'Type', value: ogType || 'website (default)', from: 'og:type' }
      ] },
      { name: 'X', note: 'X uses its twitter: tags and falls back to og: tags.', rows: [
        { label: 'Card', value: cardVal || (fallbackSummary ? 'summary (may be rendered)' : ''), from: 'twitter:card' },
        { label: 'Title', value: xTitle, from: tTitle ? 'twitter:title' : 'og:title' },
        { label: 'Description', value: xDesc, from: tDesc ? 'twitter:description' : 'og:description' },
        { label: 'Image', value: xImg, from: tImg ? 'twitter:image' : 'og:image' },
        { label: 'Image alt', value: xAlt, from: xImgAlt ? 'twitter:image:alt' : 'og:image:alt' }
      ] },
      { name: 'LinkedIn', note: 'LinkedIn\'s help lists og:title, og:image, og:description and og:url as the tags that must exist.', rows: [
        { label: 'Title', value: ogTitle, from: 'og:title' },
        { label: 'Description', value: ogDesc, from: 'og:description' },
        { label: 'Image', value: firstImg ? firstImg.url : '', from: 'og:image' },
        { label: 'URL', value: ogUrl, from: 'og:url' }
      ] }
    ];

    // Values for "Open in generator"
    var authorsVals = all('article:author').map(val).filter(Boolean);
    var tagVals = all('article:tag').map(val).filter(Boolean);
    var altLocs = all('og:locale:alternate').map(val).filter(Boolean);
    result.values = {
      title: titleText, ogTitle: ogTitle, desc: descText || ogDesc, url: (canons.length && canons[0].href) || ogUrl,
      site: firstVal('og:site_name'), locale: firstVal('og:locale'), altLocales: altLocs.join(', '),
      type: typeLower === 'article' ? 'article' : 'website', pub: pubT, mod: modT, author: authorsVals.join(', '),
      section: firstVal('article:section'), tags: tagVals.join(', '),
      img: firstImg ? firstImg.url : tImg, imgW: firstImg ? firstImg.props.width || '' : '', imgH: firstImg ? firstImg.props.height || '' : '',
      imgAlt: xAlt, imgType: imgTypeFor(firstImg),
      card: cardVal === 'summary' ? 'summary' : 'summary_large_image',
      tsite: firstVal('twitter:site'), tcreator: firstVal('twitter:creator'), trepeat: !!(tTitle || tDesc || tImg), fbapp: firstVal('fb:app_id'),
      basics: true
    };
    result.htmlLang = htmlLang;
    result.issues = sortIssues(issues);
    result.issues.forEach(function (x) { result.counts[x.level]++; });
    return result;
  }

  // og:image:type as a generator choice: 'auto' when the file extension says the same.
  function imgTypeFor(im) {
    if (!im) return 'auto';
    var t = String(im.props.type || '').toLowerCase();
    if (!t || t === guessMime(im.url)) return 'auto';
    return IMG_TYPES.indexOf(t) > 0 ? t : 'auto';
  }

  function stateFromAnalysis(res) {
    var s = blankState();
    var v = res && res.values ? res.values : {};
    Object.keys(s).forEach(function (k) {
      if (v[k] != null) s[k] = typeof s[k] === 'boolean' ? !!v[k] : String(v[k]);
    });
    if (s.ogTitle === s.title) s.ogTitle = '';
    if (s.type !== 'article') s.type = 'website';
    if (IMG_TYPES.indexOf(s.imgType) < 0) s.imgType = 'auto';
    if (s.card !== 'summary' && s.card !== 'none') s.card = 'summary_large_image';
    return s;
  }

  // ── Rendering helpers (HTML strings) ──────────────────────

  function srcLinks(srcs, cls) {
    return (srcs || []).map(function (sx) {
      return '<a class="' + cls + '" href="' + escapeHtml(sx.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(sx.label) + '</a>';
    }).join('');
  }

  function issueHtml(x) {
    var label = { error: 'Error', warning: 'Warning', info: 'Note' }[x.level] || 'Note';
    var refs = srcLinks(x.srcs, 'ogm-issue-ref');
    return '<li class="ogm-issue ogm-issue--' + x.level + '"><span class="ogm-issue-level">' + label + '</span><div class="ogm-issue-body">' +
      '<p class="ogm-issue-msg">' + x.msg + '</p>' +
      (x.fix ? '<p class="ogm-issue-fix"><strong>Fix:</strong> ' + x.fix + '</p>' : '') +
      (refs ? '<p class="ogm-issue-refs">' + refs + '</p>' : '') + '</div></li>';
  }

  var STATUS_LABEL = { ok: 'OK', warn: 'Check', bad: 'Fails', info: 'Note' };

  function checkGroupsHtml(groups) {
    return '<div class="ogm-ic-groups">' + groups.map(function (g) {
      var items = g.items.length ? g.items.map(function (it) {
        return '<li class="ogm-ic ogm-ic--' + it.status + '"><span class="ogm-ic-status">' + STATUS_LABEL[it.status] + '</span><span class="ogm-ic-text">' + escapeHtml(it.text) + '</span></li>';
      }).join('') : '<li class="ogm-ic ogm-ic--info"><span class="ogm-ic-status">Note</span><span class="ogm-ic-text">Nothing to check without a size.</span></li>';
      return '<div class="ogm-ic-group"><p class="ogm-ic-title">' + escapeHtml(g.platform) + '</p><ul class="ogm-ic-list">' + items + '</ul>' +
        '<p class="ogm-ic-src">' + srcLinks(g.srcs, 'ogm-issue-ref') + '</p></div>';
    }).join('') + '</div>';
  }

  var GROUP_NAMES = { html: 'HTML basics', og: 'Open Graph', x: 'X (Twitter)', fb: 'Facebook' };

  function renderCheckResults(res) {
    var parts = [];
    var c = res.counts;
    var badge = c.error ? '<span class="ogm-badge ogm-badge--bad">' + plural(c.error, 'error') + '</span>' : '';
    badge += c.warning ? '<span class="ogm-badge ogm-badge--warn">' + plural(c.warning, 'warning') + '</span>' : '';
    badge += c.info ? '<span class="ogm-badge ogm-badge--info">' + plural(c.info, 'note') + '</span>' : '';
    if (!c.error && !c.warning) badge = '<span class="ogm-badge ogm-badge--ok">No problems found</span>' + badge;
    parts.push('<section class="ogm-result"><div class="ogm-result-head"><h2 class="ogm-result-title">Result</h2><div class="ogm-badges">' + badge + '</div></div>' +
      '<p class="ogm-summary">' + (res.empty ? 'Nothing recognisable was found.' : plural(res.found.length, 'relevant tag') + ' found in ' + fmtBytes(res.bytes) + ' of HTML.') + '</p>' +
      (res.issues.length ? '<ul class="ogm-issues">' + res.issues.map(issueHtml).join('') + '</ul>' : '') +
      (res.empty ? '' : '<div class="ogm-actions"><button class="ogm-btn ogm-btn--secondary ogm-btn--small" type="button" data-ogm-act="to-gen">Open these values in the generator</button></div>') +
      '</section>');
    if (res.empty) return parts.join('');

    parts.push('<section class="ogm-result"><h2 class="ogm-result-title">What each platform would use</h2><div class="ogm-platforms">' +
      res.platforms.map(function (p) {
        return '<div class="ogm-platform"><p class="ogm-platform-name">' + escapeHtml(p.name) + '</p><dl class="ogm-kv-list">' +
          p.rows.map(function (r) {
            return '<div class="ogm-kv"><dt class="ogm-k">' + escapeHtml(r.label) + ' <span class="ogm-k-from">' + escapeHtml(r.from) + '</span></dt>' +
              '<dd class="ogm-v' + (r.value ? '' : ' ogm-v--missing') + '">' + (r.value ? escapeHtml(r.value) : 'missing') + '</dd></div>';
          }).join('') + '</dl><p class="ogm-hint">' + escapeHtml(p.note) + '</p></div>';
      }).join('') + '</div></section>');

    if (res.imageChecks) {
      parts.push('<section class="ogm-result"><h2 class="ogm-result-title">Image size against the recommendations</h2>' +
        '<p class="ogm-hint">From og:image:width and og:image:height of the first image. The file size is not known without downloading the image; use the generator\'s file check for that.</p>' +
        checkGroupsHtml(res.imageChecks) + '</section>');
    }

    var byGroup = { html: [], og: [], x: [], fb: [] };
    res.found.forEach(function (f) { if (byGroup[f.group]) byGroup[f.group].push(f); });
    parts.push('<section class="ogm-result"><h2 class="ogm-result-title">Tags found</h2>' +
      Object.keys(byGroup).filter(function (g) { return byGroup[g].length; }).map(function (g) {
        return '<p class="ogm-sub">' + GROUP_NAMES[g] + ' (' + byGroup[g].length + ')</p><ul class="ogm-tags-list">' + byGroup[g].map(function (f) {
          return '<li class="ogm-tag-row"><span class="ogm-tag-key">' + escapeHtml(f.key) + (f.attr === 'name' && g !== 'html' && g !== 'x' ? ' <span class="ogm-tag-flag">name=</span>' : '') +
            (f.attr === 'property' && g === 'x' ? ' <span class="ogm-tag-flag">property=</span>' : '') + '</span>' +
            '<span class="ogm-tag-val' + (f.value ? '' : ' ogm-v--missing') + '">' + (f.missingContent ? 'no content attribute' : f.value ? escapeHtml(f.value) : 'empty') + '</span>' +
            '<span class="ogm-tag-line">line ' + f.line + '</span></li>';
        }).join('') + '</ul>';
      }).join('') + '</section>');
    return parts.join('');
  }

  // ── URL hash ──────────────────────────────────────────────

  var HASH_KEYS = [['t', 'title'], ['ot', 'ogTitle'], ['d', 'desc'], ['u', 'url'], ['sn', 'site'], ['l', 'locale'],
    ['la', 'altLocales'], ['ap', 'pub'], ['am', 'mod'], ['aa', 'author'], ['as', 'section'], ['at', 'tags'],
    ['i', 'img'], ['iw', 'imgW'], ['ih', 'imgH'], ['ia', 'imgAlt'], ['ts', 'tsite'], ['tc', 'tcreator'], ['fb', 'fbapp']];

  function isStateHash(hash) {
    return /^#?v=\d/.test(String(hash || ''));
  }

  function encodeHash(s) {
    var parts = ['v=1'];
    HASH_KEYS.forEach(function (p) {
      if (s[p[1]]) parts.push(p[0] + '=' + encodeURIComponent(s[p[1]]));
    });
    if (s.type === 'article') parts.push('ty=article');
    if (s.imgType && s.imgType !== 'auto') parts.push('it=' + encodeURIComponent(s.imgType));
    if (s.card === 'summary') parts.push('c=sm');
    else if (s.card === 'none') parts.push('c=no');
    if (s.trepeat) parts.push('tr=1');
    if (!s.basics) parts.push('hb=0');
    return '#' + parts.join('&');
  }

  function decodeHash(hash) {
    if (!isStateHash(hash)) return defaultState();
    var s = blankState();
    var map = Object.create(null);
    HASH_KEYS.forEach(function (p) { map[p[0]] = p[1]; });
    String(hash).replace(/^#/, '').split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i <= 0) return;
      var k = pair.slice(0, i);
      var v;
      try { v = decodeURIComponent(pair.slice(i + 1)); } catch (e) { return; }
      v = v.slice(0, MAX_FIELD);
      if (map[k]) { s[map[k]] = v; return; }
      switch (k) {
        case 'ty': s.type = v === 'article' ? 'article' : 'website'; break;
        case 'it': if (IMG_TYPES.indexOf(v) >= 0) s.imgType = v; break;
        case 'c': s.card = v === 'sm' ? 'summary' : v === 'no' ? 'none' : 'summary_large_image'; break;
        case 'tr': s.trepeat = v === '1'; break;
        case 'hb': s.basics = v !== '0'; break;
        default: break;
      }
    });
    return s;
  }

  // ── Examples for the Check tab ────────────────────────────

  function example(id) {
    if (id === 'bare') {
      return ['<!DOCTYPE html>', '<html lang="en">', '<head>', '<meta charset="utf-8">', '<title>Home</title>',
        '<meta name="description" content="Welcome to my website.">', '</head>', '<body>', '<h1>Welcome</h1>', '</body>', '</html>'].join('\n');
    }
    if (id === 'good') {
      return ['<!DOCTYPE html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">', buildOutput(defaultState()).text, '</head>', '<body>', '</body>', '</html>'].join('\n');
    }
    return [
      '<!DOCTYPE html>',
      '<html lang="en-US">',
      '<head>',
      '<meta charset="UTF-8">',
      '<title>Self-Hosted Photo Backup | Example Blog</title>',
      '<meta name="description" content="How I back up family photos at home.">',
      '<link rel="canonical" href="https://example.com/photo-backup/">',
      '<meta property="og:title" content="Self-Hosted Photo Backup">',
      '<meta property="og:type" content="article">',
      '<meta property="og:url" content="http://example.com/photo-backup?utm_source=newsletter">',
      '<meta property="og:image" content="/wp-content/uploads/photo-backup.jpg">',
      '<meta name="twitter:card" content="summary">',
      htmlComment('SEO plugin output starts here'),
      '<title>Self-Hosted Photo Backup Guide &amp; Checklist | Example Blog</title>',
      '<meta name="description" content="Back up your family photos to a NAS at home, step by step.">',
      '<meta property="og:title" content="Self-Hosted Photo Backup Guide &amp; Checklist">',
      '<meta property="og:description" content="Back up your family photos to a NAS at home, step by step.">',
      '<meta property="og:image" content="http://example.com/wp-content/uploads/photo-backup-1200x630.jpg">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta name="og:site_name" content="Example Blog">',
      '<meta property="og:locale" content="en-US">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:site" content="@example-blog">',
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Self-Hosted Photo Backup"}<' + '/script>',
      '</head>',
      '<body>',
      '<meta property="article:published_time" content="27/10/2026">',
      '<p>Article text…</p>',
      '</body>',
      '</html>'
    ].join('\n');
  }

  // ── DOM: state, form, rendering ───────────────────────────

  var state = defaultState();
  var hashActive = false;
  var lastHash = '';
  var fileImg = null;   // { url (object URL), name, bytes, mime, width, height }
  var urlImg = null;    // { url, width, height } after the user pressed "Load the image URL"
  var lastAnalysis = null;
  var checkTimer = null;
  var lastPreview = '';

  var FIELDS = [['title', 'ogm-title'], ['ogTitle', 'ogm-ogtitle'], ['desc', 'ogm-desc'], ['url', 'ogm-url'],
    ['site', 'ogm-site'], ['locale', 'ogm-locale'], ['altLocales', 'ogm-altlocales'], ['pub', 'ogm-pub'],
    ['mod', 'ogm-mod'], ['author', 'ogm-author'], ['section', 'ogm-section'], ['tags', 'ogm-tags'],
    ['img', 'ogm-img'], ['imgW', 'ogm-img-w'], ['imgH', 'ogm-img-h'], ['imgAlt', 'ogm-img-alt'],
    ['imgType', 'ogm-img-type'], ['tsite', 'ogm-tsite'], ['tcreator', 'ogm-tcreator'], ['fbapp', 'ogm-fbapp']];
  var CHECKS = [['basics', 'ogm-basics'], ['trepeat', 'ogm-trepeat']];
  var MSG_IDS = {
    title: 'ogm-title-msg', ogtitle: 'ogm-ogtitle-msg', desc: 'ogm-desc-msg', url: 'ogm-url-msg', locale: 'ogm-locale-msg',
    altlocales: 'ogm-altlocales-msg', pub: 'ogm-pub-msg', mod: 'ogm-mod-msg', author: 'ogm-author-msg', img: 'ogm-img-msg',
    imgdim: 'ogm-img-dim-msg', imgtype: 'ogm-img-type-msg', imgalt: 'ogm-img-alt-msg', tsite: 'ogm-tsite-msg',
    tcreator: 'ogm-tcreator-msg', fbapp: 'ogm-fbapp-msg'
  };

  function radioValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function setRadio(name, value) {
    var list = document.querySelectorAll('input[name="' + name + '"]');
    for (var i = 0; i < list.length; i++) list[i].checked = list[i].value === value;
  }

  function readForm() {
    FIELDS.forEach(function (f) { var el = $(f[1]); if (el) state[f[0]] = el.value; });
    CHECKS.forEach(function (f) { var el = $(f[1]); if (el) state[f[0]] = el.checked; });
    state.type = radioValue('ogm-type') === 'article' ? 'article' : 'website';
    var card = radioValue('ogm-card');
    state.card = card === 'summary' || card === 'none' ? card : 'summary_large_image';
  }

  function writeForm() {
    FIELDS.forEach(function (f) { var el = $(f[1]); if (el) el.value = state[f[0]] == null ? '' : state[f[0]]; });
    CHECKS.forEach(function (f) { var el = $(f[1]); if (el) el.checked = !!state[f[0]]; });
    setRadio('ogm-type', state.type);
    setRadio('ogm-card', state.card);
  }

  function setCount(id, text, max) {
    var el = $(id);
    if (!el) return;
    var n = charLen(cleanText(text));
    el.textContent = plural(n, 'character') + (max ? ' · X max ' + max : '');
    el.classList.toggle('ogm-count--over', !!max && n > max);
  }

  function cardNote(card) {
    if (card === 'summary') return '<strong>summary</strong>: title, description and a small square thumbnail. X crops the image to a square; it needs at least 144 x 144 pixels.';
    if (card === 'none') return '<strong>No X tags.</strong> X\'s markup reference says it may still render a summary card when og:type, og:title and og:description exist.';
    return '<strong>summary_large_image</strong>: a large image above the title. X documents a 2:1 image of at least 300 x 157 pixels, under 5 MB; 1200 x 630 works for X, Meta and LinkedIn alike.';
  }

  function renderGenerator() {
    var out = buildOutput(state);
    $('ogm-out').textContent = out.text;
    var xOn = state.card !== 'none';
    setCount('ogm-title-count', state.title, 0);
    setCount('ogm-ogtitle-count', state.ogTitle || state.title, xOn ? LIMITS.xTitle : 0);
    setCount('ogm-desc-count', state.desc, xOn ? LIMITS.xDesc : 0);
    setCount('ogm-img-alt-count', state.imgAlt, xOn ? LIMITS.xAlt : 0);
    $('ogm-article').classList.toggle('ogm-hidden', state.type !== 'article');
    $('ogm-x-fields').classList.toggle('ogm-disabled', !xOn);
    $('ogm-card-note').innerHTML = cardNote(state.card);
    Object.keys(MSG_IDS).forEach(function (k) {
      var el = $(MSG_IDS[k]);
      if (!el) return;
      el.innerHTML = '';
      el.className = 'ogm-field-msg';
    });
    out.issues.forEach(function (x) {
      var el = x.field ? $(MSG_IDS[x.field]) : null;
      if (!el || el.innerHTML) return;
      el.innerHTML = x.msg;
      el.className = 'ogm-field-msg ogm-visible ogm-field-msg--' + x.level;
    });
    $('ogm-out-issues').innerHTML = out.issues.length ? out.issues.map(issueHtml).join('')
      : '<li class="ogm-issue ogm-issue--ok"><span class="ogm-issue-level">OK</span><div class="ogm-issue-body"><p class="ogm-issue-msg">No problems found in these fields.</p></div></li>';
    renderImageCheck(out);
    renderPreview(out);
  }

  function previewSrc(imageHref) {
    if (fileImg) return fileImg.url;
    if (urlImg && urlImg.url === imageHref) return urlImg.url;
    return '';
  }

  function renderPreview(out) {
    var v = out.values;
    var src = previewSrc(v.image);
    var domain = v.domain || 'example.com';
    var title = v.ogTitle || 'Your share title';
    var desc = v.desc || 'Your description';
    var phNote = v.image ? 'Image not loaded' : 'No image';
    function media(ratio) {
      if (src) return '<img class="ogm-pv-img" src="' + escapeHtml(src) + '" alt="' + escapeHtml(v.alt) + '" referrerpolicy="no-referrer">';
      return '<span class="ogm-pv-ph"><span class="ogm-pv-ph-main">' + phNote + '</span><span class="ogm-pv-ph-sub">' + ratio + '</span></span>';
    }
    var body = '<div class="ogm-pv-body"><span class="ogm-pv-domain">' + escapeHtml(domain) + '</span>' +
      '<span class="ogm-pv-title">' + escapeHtml(title) + '</span><span class="ogm-pv-desc">' + escapeHtml(desc) + '</span></div>';
    var html = '<figure class="ogm-pv-wrap"><figcaption class="ogm-pv-label">Large image layout <span class="ogm-pv-sub">X summary_large_image, and Meta or LinkedIn with a large image; shown at 1.91:1</span></figcaption>' +
      '<div class="ogm-pv ogm-pv--large"><div class="ogm-pv-media">' + media('1.91 : 1 crop') + '</div>' + body + '</div></figure>' +
      '<figure class="ogm-pv-wrap"><figcaption class="ogm-pv-label">Small image layout <span class="ogm-pv-sub">X summary card (square crop), and Meta or LinkedIn with a small image</span></figcaption>' +
      '<div class="ogm-pv ogm-pv--small"><div class="ogm-pv-media">' + media('1 : 1') + '</div>' + body + '</div></figure>';
    if (html !== lastPreview) {
      $('ogm-preview').innerHTML = html;
      lastPreview = html;
    }
  }

  function renderImageCheck(out) {
    var el = $('ogm-imgcheck');
    if (!el) return;
    var v = out.values;
    var info = null, head = '';
    if (fileImg) {
      info = { width: fileImg.width, height: fileImg.height, bytes: fileImg.bytes, mime: fileImg.mime };
      head = '<div class="ogm-ic-head"><p class="ogm-text"><strong>' + escapeHtml(fileImg.name) + '</strong>: ' +
        (fileImg.width ? fileImg.width + ' x ' + fileImg.height + ' pixels (' + ratioText(fileImg.width, fileImg.height) + '), ' : 'no pixel size (an SVG without width and height), ') +
        fmtBytes(fileImg.bytes) + (fileImg.mime ? ', ' + escapeHtml(fileImg.mime) : '') + '.</p>' +
        '<div class="ogm-ic-actions">' + (fileImg.width ? '<button class="ogm-btn ogm-btn--small" type="button" onclick="ogmUseImageValues()">Use these values</button>' : '') +
        '<button class="ogm-btn ogm-btn--secondary ogm-btn--small" type="button" onclick="ogmClearFile()">Remove file</button></div></div>';
    } else if (urlImg && urlImg.url === v.image) {
      info = { width: urlImg.width, height: urlImg.height };
      head = '<div class="ogm-ic-head"><p class="ogm-text">Loaded from the URL: <strong>' + urlImg.width + ' x ' + urlImg.height + ' pixels</strong> (' +
        ratioText(urlImg.width, urlImg.height) + '). The file size and type are not known without downloading the file; choose the file to check them.</p>' +
        '<div class="ogm-ic-actions"><button class="ogm-btn ogm-btn--small" type="button" onclick="ogmUseImageValues()">Use these values</button></div></div>';
    } else if (v.width && v.height) {
      info = { width: v.width, height: v.height, mime: v.mime };
      head = '<p class="ogm-text">From the width and height entered above: ' + v.width + ' x ' + v.height + ' pixels (' + ratioText(v.width, v.height) + ').</p>';
    }
    if (!info) {
      el.innerHTML = '<p class="ogm-empty">Enter the width and height, choose the image file, or load the image URL to compare it with each platform\'s documented sizes.</p>';
      return;
    }
    el.innerHTML = head + checkGroupsHtml(imageChecks(info, state.card));
  }

  function writeHash() {
    if (!hashActive) return;
    var h = encodeHash(state);
    lastHash = h;
    try { history.replaceState(null, '', h); } catch (e) { /* file:// or sandboxed frames */ }
  }

  function onGenInput(ev) {
    if (ev && ev.target && ev.target.id === 'ogm-file') return;
    if (ev && ev.target && ev.target.id === 'ogm-img') setLoadMsg('');
    readForm();
    hashActive = true;
    writeHash();
    renderGenerator();
  }

  function setMode(mode) {
    var check = mode === 'check';
    $('ogm-panel-gen').classList.toggle('ogm-hidden', check);
    $('ogm-panel-check').classList.toggle('ogm-hidden', !check);
    $('ogm-tab-gen').classList.toggle('ogm-active', !check);
    $('ogm-tab-check').classList.toggle('ogm-active', check);
    $('ogm-tab-gen').setAttribute('aria-selected', check ? 'false' : 'true');
    $('ogm-tab-check').setAttribute('aria-selected', check ? 'true' : 'false');
    $('ogm-tab-gen').tabIndex = check ? -1 : 0;
    $('ogm-tab-check').tabIndex = check ? 0 : -1;
    if (check) renderCheck();
  }

  function renderCheck() {
    var text = $('ogm-check-input').value;
    var out = $('ogm-check-results');
    if (!text.trim()) {
      lastAnalysis = null;
      out.innerHTML = '<p class="ogm-empty">Paste a page\'s &lt;head&gt; or its whole HTML source above, or load an example.</p>';
      return;
    }
    lastAnalysis = analyzeHead(text, $('ogm-check-url').value);
    out.innerHTML = renderCheckResults(lastAnalysis);
  }

  function scheduleCheck() {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(renderCheck, 250);
  }

  function checkGenerated() {
    readForm();
    $('ogm-check-input').value = buildOutput(state).text;
    $('ogm-check-url').value = checkUrl(state.url).ok ? checkUrl(state.url).href : '';
    setMode('check');
    var panel = $('ogm-panel-check');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toGenerator() {
    if (!lastAnalysis) return;
    state = stateFromAnalysis(lastAnalysis);
    urlImg = null;
    writeForm();
    hashActive = true;
    writeHash();
    renderGenerator();
    setMode('gen');
    var panel = $('ogm-panel-gen');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function loadExample(id) {
    $('ogm-check-input').value = example(id);
    $('ogm-check-url').value = '';
    renderCheck();
  }

  function clearCheck() {
    $('ogm-check-input').value = '';
    $('ogm-check-url').value = '';
    renderCheck();
  }

  function resetAll() {
    state = defaultState();
    urlImg = null;
    setLoadMsg('');
    writeForm();
    hashActive = false;
    lastHash = '';
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    renderGenerator();
  }

  function fillNow(field) {
    var el = $(field === 'mod' ? 'ogm-mod' : 'ogm-pub');
    if (!el) return;
    el.value = nowIso();
    onGenInput();
  }

  // ── Image file and the opt-in URL load ────────────────────

  function setLoadMsg(text, level) {
    var el = $('ogm-load-msg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'ogm-field-msg' + (text ? ' ogm-visible ogm-field-msg--' + (level || 'info') : '');
  }

  function onFile(ev) {
    var input = ev.target;
    var f = input.files && input.files[0];
    if (!f) return;
    var isImg = /^image\//.test(f.type) || /\.(svg|jpe?g|png|gif|webp|avif|bmp)$/i.test(f.name);
    if (!isImg) {
      setLoadMsg('That file is not an image.', 'error');
      input.value = '';
      return;
    }
    var url = URL.createObjectURL(f);
    var im = new Image();
    im.onload = function () {
      if (fileImg) URL.revokeObjectURL(fileImg.url);
      fileImg = { url: url, name: f.name, bytes: f.size, mime: (f.type || guessMime(f.name)).toLowerCase(), width: im.naturalWidth, height: im.naturalHeight };
      urlImg = null;
      setLoadMsg('');
      lastPreview = '';
      renderGenerator();
    };
    im.onerror = function () {
      URL.revokeObjectURL(url);
      setLoadMsg('This browser could not read the image.', 'error');
    };
    im.src = url;
    input.value = '';
  }

  function clearFile() {
    if (fileImg) URL.revokeObjectURL(fileImg.url);
    fileImg = null;
    lastPreview = '';
    renderGenerator();
  }

  // Only runs when the user presses the button: the browser requests the image URL.
  function loadUrlImage() {
    readForm();
    var u = checkUrl(state.img);
    if (!u.ok) {
      setLoadMsg('Enter a full image URL starting with https:// first.', 'warning');
      return;
    }
    setLoadMsg('Loading the image…', 'info');
    var im = new Image();
    im.referrerPolicy = 'no-referrer';
    im.onload = function () {
      if (fileImg) URL.revokeObjectURL(fileImg.url);
      fileImg = null;
      urlImg = { url: u.href, width: im.naturalWidth, height: im.naturalHeight };
      setLoadMsg('');
      lastPreview = '';
      renderGenerator();
    };
    im.onerror = function () {
      urlImg = null;
      setLoadMsg('The image could not be loaded: the URL may be wrong, the server may refuse it, or it is not an image. Platform crawlers can still see it differently, so check with their debuggers as well.', 'warning');
    };
    im.src = u.href;
  }

  function useImageValues() {
    var src = fileImg || urlImg;
    if (!src || !src.width) return;
    state.imgW = String(src.width);
    state.imgH = String(src.height);
    if (fileImg && IMG_TYPES.indexOf(fileImg.mime) > 0) state.imgType = fileImg.mime === guessMime(state.img) ? 'auto' : fileImg.mime;
    writeForm();
    hashActive = true;
    writeHash();
    renderGenerator();
    showToast('Size filled in');
  }

  // ── Clipboard and toast ───────────────────────────────────

  function showToast(msg) {
    var t = $('ogm-toast');
    if (!t) return;
    t.textContent = msg || 'Copied';
    t.classList.add('ogm-show');
    setTimeout(function () { t.classList.remove('ogm-show'); }, 2000);
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

  function copyOutput() {
    readForm();
    copyText(buildOutput(state).text, 'Tags copied');
  }

  function copyLink() {
    readForm();
    hashActive = true;
    writeHash();
    copyText(location.href.split('#')[0] + encodeHash(state), 'Link copied');
  }

  function copyPageUrl() {
    var u = (lastAnalysis && lastAnalysis.pageUrl) || (checkUrl($('ogm-check-url').value).ok ? checkUrl($('ogm-check-url').value).href : '');
    if (!u) {
      showToast('No page URL yet');
      return;
    }
    copyText(u, 'URL copied');
  }

  // ── Init ──────────────────────────────────────────────────

  function init() {
    var wrap = $('ogm-wrapper');
    if (!wrap) return;
    if (isStateHash(location.hash)) {
      state = decodeHash(location.hash);
      hashActive = true;
      lastHash = location.hash;
    }
    writeForm();
    $('ogm-panel-gen').addEventListener('input', onGenInput);
    $('ogm-panel-gen').addEventListener('change', onGenInput);
    $('ogm-file').addEventListener('change', onFile);
    $('ogm-check-input').addEventListener('input', scheduleCheck);
    $('ogm-check-url').addEventListener('input', scheduleCheck);
    wrap.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var ex = t.closest('[data-ogm-example]');
      if (ex) { loadExample(ex.getAttribute('data-ogm-example')); return; }
      var act = t.closest('[data-ogm-act]');
      if (act && act.getAttribute('data-ogm-act') === 'to-gen') toGenerator();
    });
    $('ogm-tabs').addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      var toCheck = $('ogm-tab-gen').classList.contains('ogm-active');
      setMode(toCheck ? 'check' : 'gen');
      $(toCheck ? 'ogm-tab-check' : 'ogm-tab-gen').focus();
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
  window.ogmSetMode = setMode;
  window.ogmCopyOutput = copyOutput;
  window.ogmCopyLink = copyLink;
  window.ogmReset = resetAll;
  window.ogmCheckGenerated = checkGenerated;
  window.ogmClearCheck = clearCheck;
  window.ogmNow = fillNow;
  window.ogmLoadUrlImage = loadUrlImage;
  window.ogmUseImageValues = useImageValues;
  window.ogmClearFile = clearFile;
  window.ogmCopyPageUrl = copyPageUrl;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SRC: SRC,
      LIMITS: LIMITS,
      KNOWN: KNOWN,
      escapeHtml: escapeHtml,
      escAttr: escAttr,
      escText: escText,
      htmlComment: htmlComment,
      cleanText: cleanText,
      charLen: charLen,
      checkUrl: checkUrl,
      decoratedParams: decoratedParams,
      urlDiff: urlDiff,
      parseDateTime: parseDateTime,
      nowIso: nowIso,
      checkLocale: checkLocale,
      normalizeHandle: normalizeHandle,
      guessMime: guessMime,
      imageChecks: imageChecks,
      blankState: blankState,
      defaultState: defaultState,
      buildOutput: buildOutput,
      tagHtml: tagHtml,
      decodeEntities: decodeEntities,
      parseAttrs: parseAttrs,
      scanHtml: scanHtml,
      analyzeHead: analyzeHead,
      stateFromAnalysis: stateFromAnalysis,
      renderCheckResults: renderCheckResults,
      encodeHash: encodeHash,
      decodeHash: decodeHash,
      isStateHash: isStateHash,
      example: example
    };
  }
})();
