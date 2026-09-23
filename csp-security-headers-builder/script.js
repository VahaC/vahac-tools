// CSP and HTTP Security Headers Builder — script.js
// Prefix: csh-
// Dependencies: none. Script and style hashes use the browser's Web Crypto API.
//
// Content-Security-Policy is parsed the way CSP Level 3 describes it: a comma
// starts a new policy, a semicolon ends a directive, the first copy of a
// directive wins, and sources are separated by ASCII whitespace.
// Permissions-Policy, Reporting-Endpoints and the Cross-Origin-* headers are
// read as RFC 9651 structured fields. Nothing is fetched: browsers hide most
// cross-origin response headers from page scripts (CORS), so the analyzer
// works on headers pasted from curl, DevTools or wget.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Constants ───────────────────────────────────────────

  var MAX_INPUT_CHARS = 512 * 1024;
  var MAX_MESSAGES = 300;
  var NONCE_SOURCE = "'nonce-{RANDOM}'";
  var ONE_DAY = 86400;
  var HALF_YEAR = 15552000;          // 180 days
  var ONE_YEAR = 31536000;           // hstspreload.org minimum
  var BOM = String.fromCharCode(0xFEFF);

  // CSP directives. "fallback" is the order browsers consult when a directive
  // is missing (CSP3 "get the effective directive"); "standalone" directives
  // never inherit from default-src.
  var DIRECTIVES = {
    'default-src': { about: 'Fallback for every fetch directive you leave out.' },
    'script-src': { fallback: ['default-src'], kind: 'script', about: 'Scripts: files, inline <script> blocks, event handlers and eval().' },
    'script-src-elem': { fallback: ['script-src', 'default-src'], kind: 'script', about: '<script> elements only; overrides script-src for them.' },
    'script-src-attr': { fallback: ['script-src', 'default-src'], kind: 'script', about: 'Inline event handlers such as onclick; overrides script-src for them.' },
    'style-src': { fallback: ['default-src'], kind: 'style', about: 'Stylesheets, <style> blocks and style attributes.' },
    'style-src-elem': { fallback: ['style-src', 'default-src'], kind: 'style', about: '<style> and <link rel="stylesheet"> only.' },
    'style-src-attr': { fallback: ['style-src', 'default-src'], kind: 'style', about: 'style="…" attributes only.' },
    'img-src': { fallback: ['default-src'], about: 'Images and favicons.' },
    'font-src': { fallback: ['default-src'], about: 'Web fonts loaded by @font-face.' },
    'connect-src': { fallback: ['default-src'], about: 'fetch, XHR, WebSocket, EventSource and sendBeacon.' },
    'media-src': { fallback: ['default-src'], about: 'Audio, video and subtitle tracks.' },
    'object-src': { fallback: ['default-src'], about: '<object> and <embed>.' },
    'frame-src': { fallback: ['child-src', 'default-src'], about: 'Pages you embed in iframes.' },
    'child-src': { fallback: ['default-src'], about: 'Frames and workers when frame-src or worker-src is missing.' },
    'worker-src': { fallback: ['child-src', 'script-src', 'default-src'], about: 'Web, shared and service workers.' },
    'manifest-src': { fallback: ['default-src'], about: 'The web app manifest.' },
    'fenced-frame-src': { fallback: ['frame-src', 'child-src', 'default-src'], experimental: true, about: 'Fenced frames (experimental).' },
    'base-uri': { standalone: true, about: 'URLs allowed in <base href>.' },
    'form-action': { standalone: true, about: 'Where forms may submit.' },
    'frame-ancestors': { standalone: true, notInMeta: true, about: 'Sites that may show this page in a frame.' },
    'sandbox': { standalone: true, value: 'sandbox', notInMeta: true, about: 'Sandbox restrictions for the page itself.' },
    'upgrade-insecure-requests': { standalone: true, value: 'empty', about: 'Loads http:// subresources over https:// instead.' },
    'report-uri': { standalone: true, value: 'uri', notInMeta: true, about: 'Where browsers POST violation reports (older mechanism).' },
    'report-to': { standalone: true, value: 'endpoint', about: 'Reporting-Endpoints name that receives violation reports.' },
    'require-trusted-types-for': { standalone: true, value: 'rttf', about: 'Requires Trusted Types for DOM XSS sinks such as innerHTML.' },
    'trusted-types': { standalone: true, value: 'tt', about: 'Trusted Types policy names the page may create.' },
    'webrtc': { standalone: true, value: 'webrtc', experimental: true, about: 'Allows or blocks WebRTC connections (experimental).' }
  };

  var DIRECTIVE_ORDER = Object.keys(DIRECTIVES);

  var OBSOLETE_DIRECTIVES = {
    'block-all-mixed-content': 'obsolete — browsers already block or upgrade mixed content, so it has no effect. Use `upgrade-insecure-requests` if old pages still load http:// URLs.',
    'plugin-types': 'removed from CSP along with browser plugins. Use `object-src \'none\'`.',
    'prefetch-src': 'removed from the specification; browsers ignore it.',
    'navigate-to': 'removed from the specification before any browser shipped it.',
    'referrer': 'removed from CSP. Use the Referrer-Policy header.',
    'reflected-xss': 'removed from CSP together with the browsers\' XSS filters.',
    'require-sri-for': 'not supported by current browsers.',
    'disown-opener': 'never supported by browsers. Use Cross-Origin-Opener-Policy.'
  };

  // Keyword sources and the directives they affect.
  var KEYWORDS = {
    "'self'": 'any',
    "'none'": 'any',
    "'unsafe-inline'": 'script-style',
    "'unsafe-hashes'": 'script-style',
    "'report-sample'": 'script-style',
    "'unsafe-eval'": 'script',
    "'wasm-unsafe-eval'": 'script',
    "'strict-dynamic'": 'script',
    "'inline-speculation-rules'": 'script',
    "'trusted-types-eval'": 'script',
    "'report-sha256'": 'script',
    "'report-sha384'": 'script',
    "'report-sha512'": 'script',
    "'unsafe-allow-redirects'": 'any'
  };

  var NEWER_KEYWORDS = {
    "'inline-speculation-rules'": true,
    "'trusted-types-eval'": true,
    "'report-sha256'": true,
    "'report-sha384'": true,
    "'report-sha512'": true,
    "'unsafe-allow-redirects'": true
  };

  var BARE_KEYWORDS = ['self', 'none', 'unsafe-inline', 'unsafe-eval', 'wasm-unsafe-eval', 'strict-dynamic',
    'unsafe-hashes', 'report-sample'];

  var SANDBOX_TOKENS = ['allow-downloads', 'allow-forms', 'allow-modals', 'allow-orientation-lock',
    'allow-pointer-lock', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-presentation',
    'allow-same-origin', 'allow-scripts', 'allow-storage-access-by-user-activation', 'allow-top-navigation',
    'allow-top-navigation-by-user-activation', 'allow-top-navigation-to-custom-protocols'];

  var HASH_BYTES = { sha256: 32, sha384: 48, sha512: 64 };

  // Script hosts that serve files anyone can publish, or that have JSONP
  // endpoints. Allowlisting one of them lets an attacker who can inject HTML
  // load a script of their choosing from it.
  var RISKY_SCRIPT_HOSTS = {
    'cdnjs.cloudflare.com': 'a public CDN that also hosts old AngularJS builds, a known CSP bypass',
    'cdn.jsdelivr.net': 'a public CDN that serves any npm package or GitHub file',
    'unpkg.com': 'a public CDN that serves any npm package',
    'ajax.googleapis.com': 'a public CDN that hosts AngularJS builds, a known CSP bypass',
    'www.google.com': 'it has JSONP endpoints that call whatever function the URL names',
    '*.google.com': 'Google subdomains include JSONP endpoints that call whatever function the URL names',
    'storage.googleapis.com': 'anyone can publish files in a Cloud Storage bucket there',
    's3.amazonaws.com': 'anyone can publish files in an S3 bucket there'
  };

  // Domains where anyone can get a subdomain. "*.<domain>" trusts all of them.
  var SHARED_HOSTING = ['github.io', 'gitlab.io', 'herokuapp.com', 'appspot.com', 'firebaseapp.com', 'web.app',
    'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'cloudfront.net', 'amazonaws.com',
    'azurewebsites.net', 'azureedge.net', 'blob.core.windows.net', 'onrender.com', 'fly.dev', 'glitch.me',
    'surge.sh'];

  // Permissions-Policy features that browsers recognise (client hints "ch-*"
  // are accepted separately). Unknown names are skipped by browsers.
  var PP_FEATURES = ['accelerometer', 'all-screens-capture', 'ambient-light-sensor', 'aria-notify',
    'attribution-reporting', 'autofill', 'autoplay', 'bluetooth', 'camera',
    'captured-surface-control', 'clipboard-read', 'clipboard-write', 'compute-pressure', 'controlled-frame',
    'cross-origin-isolated', 'deferred-fetch', 'deferred-fetch-minimal', 'digital-credentials-create',
    'digital-credentials-get', 'direct-sockets', 'direct-sockets-private', 'display-capture', 'document-domain',
    'encrypted-media', 'execution-while-not-rendered', 'execution-while-out-of-viewport',
    'fenced-unpartitioned-storage-read', 'focus-without-user-activation', 'fullscreen', 'gamepad', 'geolocation',
    'gyroscope', 'hid', 'identity-credentials-get', 'idle-detection', 'join-ad-interest-group', 'keyboard-map',
    'language-detector', 'language-model', 'local-fonts', 'local-network-access', 'magnetometer', 'manual-text',
    'media-playback-while-not-visible', 'microphone', 'midi', 'navigation-override',
    'on-device-speech-recognition', 'otp-credentials', 'payment', 'picture-in-picture', 'popins',
    'private-aggregation', 'private-state-token-issuance', 'private-state-token-redemption',
    'publickey-credentials-create', 'publickey-credentials-get', 'rewriter', 'run-ad-auction', 'screen-wake-lock',
    'serial', 'shared-autofill', 'shared-storage', 'shared-storage-select-url', 'smart-card', 'speaker-selection',
    'storage-access', 'summarizer', 'sync-xhr', 'translator', 'unload', 'usb', 'usb-unrestricted',
    'vertical-scroll', 'web-printing', 'web-share', 'window-management', 'writer', 'xr-spatial-tracking'];

  var PP_OBSOLETE = {
    'interest-cohort': 'belonged to FLoC, which Google dropped in 2022, and Chrome is removing the name. It does nothing useful — remove it.',
    'browsing-topics': 'controls the Topics API, which Google deprecated in 2025 and is removing from Chrome. Blocking it is harmless but no longer needed.',
    'speaker': 'was renamed `speaker-selection`.',
    'vr': 'was replaced by `xr-spatial-tracking`.',
    'wake-lock': 'was renamed `screen-wake-lock`.'
  };

  // Features offered in the builder, with a short explanation.
  var PP_BUILDER = [
    { id: 'camera', about: 'Camera' },
    { id: 'microphone', about: 'Microphone' },
    { id: 'geolocation', about: 'Location' },
    { id: 'display-capture', about: 'Screen capture' },
    { id: 'payment', about: 'Payment Request API' },
    { id: 'usb', about: 'WebUSB devices' },
    { id: 'serial', about: 'Serial ports' },
    { id: 'hid', about: 'HID devices (WebHID)' },
    { id: 'midi', about: 'MIDI devices' },
    { id: 'accelerometer', about: 'Motion sensor' },
    { id: 'gyroscope', about: 'Rotation sensor' },
    { id: 'magnetometer', about: 'Compass sensor' },
    { id: 'screen-wake-lock', about: 'Keep the screen on' },
    { id: 'idle-detection', about: 'Detect idle users' },
    { id: 'xr-spatial-tracking', about: 'VR / AR (WebXR)' },
    { id: 'publickey-credentials-get', about: 'Passkey sign-in — keep allowed if you use passkeys' },
    { id: 'fullscreen', about: 'Fullscreen — video embeds need it' },
    { id: 'autoplay', about: 'Autoplaying media' },
    { id: 'picture-in-picture', about: 'Picture-in-picture video' },
    { id: 'encrypted-media', about: 'DRM video playback' },
    { id: 'clipboard-write', about: 'Write to the clipboard' },
    { id: 'web-share', about: 'Native share sheet' }
  ];

  var PP_BLOCK_SET = ['camera', 'microphone', 'geolocation', 'display-capture', 'payment', 'usb', 'serial', 'hid',
    'midi', 'accelerometer', 'gyroscope', 'magnetometer', 'screen-wake-lock', 'idle-detection',
    'xr-spatial-tracking'];

  var REFERRER_POLICIES = {
    'no-referrer': { rank: 'strict', about: 'never sends a Referer header' },
    'same-origin': { rank: 'strict', about: 'sends the full URL to your own origin and nothing to other sites' },
    'strict-origin': { rank: 'strict', about: 'sends only the origin, and nothing from HTTPS to HTTP' },
    'strict-origin-when-cross-origin': { rank: 'strict', about: 'sends the full URL within your origin, only the origin to other sites, and nothing from HTTPS to HTTP' },
    'origin': { rank: 'ok', about: 'sends only the origin, even from HTTPS to HTTP' },
    'origin-when-cross-origin': { rank: 'ok', about: 'sends the full URL within your origin and the origin elsewhere, even from HTTPS to HTTP' },
    'no-referrer-when-downgrade': { rank: 'weak', about: 'sends the full URL, including path and query, to every HTTPS site' },
    'unsafe-url': { rank: 'unsafe', about: 'sends the full URL, including path and query, to every site, even over plain HTTP' }
  };

  var COOP_VALUES = {
    'same-origin': 'isolates this page from windows of other origins',
    'same-origin-allow-popups': 'isolates this page but keeps its link to popups it opens',
    'noopener-allow-popups': 'always cuts the link to the page that opened it, but keeps its own popups',
    'unsafe-none': 'the default: no isolation'
  };

  var COEP_VALUES = {
    'require-corp': 'cross-origin resources load only if they opt in with CORP or CORS',
    'credentialless': 'cross-origin no-cors requests are sent without cookies',
    'unsafe-none': 'the default: no restriction'
  };

  var CORP_VALUES = {
    'same-origin': 'only your own origin may load this resource',
    'same-site': 'only your site (including subdomains) may load this resource',
    'cross-origin': 'any site may load this resource'
  };

  var DISCLOSURE_HEADERS = {
    'server': ['Server', 'the web server software'],
    'x-powered-by': ['X-Powered-By', 'the application framework'],
    'x-aspnet-version': ['X-AspNet-Version', 'the ASP.NET version'],
    'x-aspnetmvc-version': ['X-AspNetMvc-Version', 'the ASP.NET MVC version'],
    'x-generator': ['X-Generator', 'the CMS or site generator']
  };

  var LEGACY_HEADERS = {
    'expect-ct': ['info', 'Expect-CT is obsolete: browsers dropped it after Certificate Transparency became mandatory for all certificates. Remove it.'],
    'public-key-pins': ['warn', 'Public-Key-Pins (HPKP) was removed from browsers because a mistake could lock visitors out for months. Remove it.'],
    'public-key-pins-report-only': ['info', 'Public-Key-Pins-Report-Only is obsolete; browsers ignore it. Remove it.'],
    'x-content-security-policy': ['warn', 'X-Content-Security-Policy is an obsolete prefixed CSP header that current browsers ignore. Use Content-Security-Policy.'],
    'x-webkit-csp': ['warn', 'X-WebKit-CSP is an obsolete prefixed CSP header that current browsers ignore. Use Content-Security-Policy.'],
    'p3p': ['info', 'P3P is obsolete and ignored by current browsers.'],
    'x-download-options': ['info', 'X-Download-Options only affected old Internet Explorer; harmless but unnecessary.'],
    'x-permitted-cross-domain-policies': ['info', 'X-Permitted-Cross-Domain-Policies controls old Adobe Flash and Acrobat cross-domain files; harmless legacy.'],
    'x-dns-prefetch-control': ['info', 'X-DNS-Prefetch-Control switches DNS prefetching on or off; it is not a security control on its own.']
  };

  var LEVEL_ORDER = { error: 0, bad: 1, warn: 2, info: 3, ok: 4 };
  var LEVEL_LABEL = { error: 'Invalid', bad: 'Unsafe', warn: 'Warning', info: 'Note', ok: 'Good' };

  // One-click third-party services: sources added per directive, taken from
  // each vendor's CSP guide or, where none exists, its documented embed and
  // asset URLs (checked September 2026).
  var SERVICES = [
    {
      id: 'ga4', label: 'Google Analytics 4',
      sources: {
        'script-src': ['https://www.googletagmanager.com'],
        'img-src': ['https://www.googletagmanager.com', 'https://*.google-analytics.com'],
        'connect-src': ['https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.google.com']
      },
      note: 'Google\'s list for GA4 without Ads features. The gtag.js snippet has an inline part: give it your nonce or add its hash. Ads features and Google Signals need more hosts, including every regional google.<TLD> domain.'
    },
    {
      id: 'gtm', label: 'Google Tag Manager',
      sources: {
        'script-src': ['https://www.googletagmanager.com'],
        'img-src': ['https://www.googletagmanager.com'],
        'connect-src': ['https://www.googletagmanager.com', 'https://www.google.com']
      },
      note: 'The container snippet is inline; Google recommends putting your nonce on it. Every tag you add inside GTM can bring its own hosts.'
    },
    {
      id: 'gfonts', label: 'Google Fonts',
      sources: { 'style-src': ['https://fonts.googleapis.com'], 'font-src': ['https://fonts.gstatic.com'] }
    },
    {
      id: 'youtube', label: 'YouTube embeds',
      sources: { 'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com'] },
      note: 'Using the IFrame Player API? Also allow https://www.youtube.com in script-src.'
    },
    {
      id: 'vimeo', label: 'Vimeo embeds',
      sources: { 'frame-src': ['https://player.vimeo.com'] },
      note: 'Using the player.js SDK? Also allow https://player.vimeo.com in script-src.'
    },
    {
      id: 'gmaps', label: 'Google Maps embed',
      sources: { 'frame-src': ['https://www.google.com'] }
    },
    {
      id: 'recaptcha', label: 'Google reCAPTCHA',
      sources: {
        'script-src': ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
        'frame-src': ['https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'],
        'connect-src': ['https://www.google.com/recaptcha/']
      },
      note: 'Google recommends a nonce on the api.js tag instead; it works with \'strict-dynamic\'.'
    },
    {
      id: 'turnstile', label: 'Cloudflare Turnstile',
      sources: { 'script-src': ['https://challenges.cloudflare.com'], 'frame-src': ['https://challenges.cloudflare.com'] }
    },
    {
      id: 'hcaptcha', label: 'hCaptcha',
      sources: {
        'script-src': ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
        'frame-src': ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
        'style-src': ['https://hcaptcha.com', 'https://*.hcaptcha.com'],
        'connect-src': ['https://hcaptcha.com', 'https://*.hcaptcha.com']
      }
    },
    {
      id: 'stripe', label: 'Stripe.js / Elements',
      sources: {
        'script-src': ['https://js.stripe.com', 'https://*.js.stripe.com', 'https://maps.googleapis.com'],
        'frame-src': ['https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com'],
        'connect-src': ['https://api.stripe.com', 'https://maps.googleapis.com']
      },
      note: 'maps.googleapis.com is only needed for the Address Element\'s autocomplete. Embedded Checkout also needs https://checkout.stripe.com.'
    },
    {
      id: 'cfanalytics', label: 'Cloudflare Web Analytics',
      sources: { 'script-src': ['https://static.cloudflareinsights.com'], 'connect-src': ['https://cloudflareinsights.com'] },
      note: 'With automatic setup the beacon reports to /cdn-cgi/rum on your own host, which connect-src \'self\' covers.'
    },
    {
      id: 'plausible', label: 'Plausible Analytics',
      sources: { 'script-src': ['https://plausible.io'], 'connect-src': ['https://plausible.io'] },
      note: 'The current Plausible snippet includes a small inline script: give it your nonce or add its hash.'
    },
    {
      id: 'gravatar', label: 'Gravatar avatars',
      sources: { 'img-src': ['https://secure.gravatar.com'] },
      note: 'WordPress 6.7+ always loads avatars from secure.gravatar.com.'
    }
  ];

  // CSP presets: a preset replaces the directive fields, nothing else.
  var PRESETS = {
    starter: {
      directives: { 'default-src': "'self'", 'img-src': "'self' data:", 'object-src': "'none'",
        'base-uri': "'self'", 'form-action': "'self'", 'frame-ancestors': "'self'" },
      upgrade: true
    },
    strict: {
      directives: { 'script-src': NONCE_SOURCE + " 'strict-dynamic'", 'object-src': "'none'", 'base-uri': "'none'" },
      upgrade: false
    },
    compat: {
      directives: { 'default-src': "'self'", 'script-src': "'self' 'unsafe-inline'", 'style-src': "'self' 'unsafe-inline'",
        'img-src': "'self' data:", 'font-src': "'self' data:", 'object-src': "'none'", 'base-uri': "'self'",
        'form-action': "'self'", 'frame-ancestors': "'self'" },
      upgrade: true
    },
    api: {
      directives: { 'default-src': "'none'", 'frame-ancestors': "'none'" },
      upgrade: false
    },
    blank: { directives: {}, upgrade: false }
  };

  var SAMPLE_HEADERS = [
    'HTTP/1.1 301 Moved Permanently',
    'Server: nginx/1.24.0',
    'Location: https://www.example.com/',
    '',
    'HTTP/2 200',
    'server: nginx/1.24.0',
    'content-type: text/html; charset=UTF-8',
    'x-powered-by: PHP/8.2.12',
    'content-security-policy: default-src \'self\'; script-src \'self\' \'unsafe-inline\' https://cdn.jsdelivr.net https://www.googletagmanager.com; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; img-src * data:; frame-ancestors self',
    'strict-transport-security: max-age=2592000',
    'x-frame-options: ALLOW-FROM https://partner.example.com',
    'x-content-type-options: nosniff',
    'referrer-policy: no-referrer-when-downgrade',
    'permissions-policy: camera \'none\'; microphone \'none\'',
    'x-xss-protection: 1; mode=block',
    'set-cookie: PHPSESSID=5f1c0d6e1a; path=/',
    'set-cookie: theme=dark; Path=/; SameSite=None'
  ].join('\n');

  // ── Small helpers ───────────────────────────────────────

  function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function msg(level, text, topic) {
    return { level: level, text: text, topic: topic || '' };
  }

  // Quote a value for a message; the UI renders `...` as inline code
  function q(v) {
    var s = String(v);
    if (s.length > 90) s = s.slice(0, 87) + '...';
    return '`' + s.replace(/`/g, '\'') + '`';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function richText(s) {
    return escapeHtml(s).replace(/`([^`]+)`/g, '<code class="csh-code">$1</code>');
  }

  function truncate(s, max) {
    s = String(s == null ? '' : s);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function plural(n, word, pluralWord) {
    return n + ' ' + (n === 1 ? word : (pluralWord || word + 's'));
  }

  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function hasNonAscii(s) {
    for (var i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) > 127) return true;
    }
    return false;
  }

  function splitLines(text) {
    return String(text).split(/\r\n|\r|\n/);
  }

  function isAsciiWs(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
  }

  function trimAsciiWs(s) {
    var a = 0;
    var b = s.length;
    while (a < b && isAsciiWs(s.charAt(a))) a++;
    while (b > a && isAsciiWs(s.charAt(b - 1))) b--;
    return s.slice(a, b);
  }

  function splitAsciiWs(s) {
    return String(s).split(/[ \t\n\r\f]+/).filter(function (x) { return x !== ''; });
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

  function closest(word, candidates, maxDistance) {
    var best = null;
    var bestD = maxDistance + 1;
    candidates.forEach(function (c) {
      var d = editDistance(word, c);
      if (d < bestD) { best = c; bestD = d; }
    });
    return best;
  }

  function suggestDirective(name) {
    var n = String(name).toLowerCase().replace(/_/g, '-');
    if (n !== name && (own(DIRECTIVES, n) || own(OBSOLETE_DIRECTIVES, n))) return n;
    if (n.length < 5) return null;
    return closest(n, DIRECTIVE_ORDER, 2);
  }

  function suggestKeyword(token) {
    var t = String(token).toLowerCase().replace(/_/g, '-');
    if (own(KEYWORDS, t)) return t;
    return closest(t, Object.keys(KEYWORDS), 3);
  }

  function formatDuration(sec) {
    if (sec >= ONE_YEAR && sec % ONE_YEAR === 0) return plural(sec / ONE_YEAR, 'year');
    if (sec >= ONE_DAY) return plural(Math.round(sec / ONE_DAY), 'day');
    if (sec >= 3600) return plural(Math.round(sec / 3600), 'hour');
    if (sec >= 60) return plural(Math.round(sec / 60), 'minute');
    return plural(sec, 'second');
  }

  function base64FromBytes(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ByteLength(value) {
    var s = String(value).replace(/=+$/, '');
    if (!/^[A-Za-z0-9+/_-]*$/.test(s) || s.length % 4 === 1) return -1;
    return Math.floor(s.length * 3 / 4);
  }

  function toOrigin(value) {
    try {
      var u = new URL(String(value));
      if (!u.host || u.origin === 'null') return null;
      return u.origin;
    } catch (e) {
      return null;
    }
  }

  function decodeEntities(s) {
    return String(s)
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, '\'')
      .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); })
      .replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCharCode(parseInt(n, 16)); })
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&');
  }

  // ── CSP parsing ─────────────────────────────────────────

  // One serialized policy -> directives (first copy wins, like browsers)
  function parsePolicy(serialized) {
    var policy = { raw: String(serialized), directives: [], byName: Object.create(null), duplicates: [], nonAscii: [] };
    policy.raw.split(';').forEach(function (part) {
      var token = trimAsciiWs(part);
      if (!token) return;
      if (hasNonAscii(token)) {
        policy.nonAscii.push(token);
        return;
      }
      var words = splitAsciiWs(token);
      var name = words[0].toLowerCase();
      if (policy.byName[name]) {
        policy.duplicates.push({ name: name, values: words.slice(1) });
        return;
      }
      var d = { name: name, rawName: words[0], values: words.slice(1) };
      policy.directives.push(d);
      policy.byName[name] = d;
    });
    return policy;
  }

  // A header value can hold several policies separated by commas
  function parseCspList(value) {
    return String(value == null ? '' : value).split(',').map(parsePolicy);
  }

  var SCHEME_RE = /^[a-z][a-z0-9+.-]*:$/i;
  var HOST_RE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?)(?::(\d+|\*))?(\/[^?#]*)?([?#][\s\S]*)?$/i;
  var B64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

  function nonceSource(token, value) {
    var s = { kind: 'nonce', token: token, value: value, valid: B64_RE.test(value), placeholder: false, bits: 0 };
    if (/[{}<>$%[\]]/.test(value) || /^(random|nonce|placeholder|your-?nonce)/i.test(value)) s.placeholder = true;
    s.bits = value.replace(/=+$/, '').length * 6;
    return s;
  }

  function hashSource(token, alg, value) {
    var s = { kind: 'hash', token: token, alg: alg, value: value, valid: B64_RE.test(value), bytes: base64ByteLength(value), wrongLength: false };
    if (s.bytes < 0) s.valid = false;
    if (s.valid && s.bytes !== HASH_BYTES[alg]) s.wrongLength = true;
    return s;
  }

  // Classify one source expression
  function classifySource(token) {
    var t = String(token);
    var lower = t.toLowerCase();
    var first = t.charAt(0);
    var last = t.charAt(t.length - 1);
    var m;
    if (t === '*') return { kind: 'wildcard', token: t };
    if (first === '\'' || last === '\'') {
      if (t.length < 3 || first !== '\'' || last !== '\'') return { kind: 'invalid', token: t, reason: 'quote' };
      if (own(KEYWORDS, lower)) return { kind: 'keyword', token: t, keyword: lower };
      m = /^'nonce-([\s\S]*)'$/i.exec(t);
      if (m) return nonceSource(t, m[1]);
      m = /^'(sha256|sha384|sha512)-([\s\S]*)'$/i.exec(t);
      if (m) return hashSource(t, m[1].toLowerCase(), m[2]);
      return { kind: 'invalid', token: t, reason: 'keyword', suggestion: suggestKeyword(lower) };
    }
    if (first === '"' || last === '"') {
      return { kind: 'invalid', token: t, reason: 'double', fix: '\'' + t.replace(/"/g, '') + '\'' };
    }
    if (BARE_KEYWORDS.indexOf(lower) !== -1 || /^(nonce|sha256|sha384|sha512)-./i.test(t)) {
      return { kind: 'invalid', token: t, reason: 'unquoted', fix: '\'' + t + '\'' };
    }
    if (SCHEME_RE.test(t)) return { kind: 'scheme', token: t, scheme: lower.slice(0, -1) };
    m = HOST_RE.exec(t);
    if (m) {
      return {
        kind: 'host', token: t, scheme: (m[1] || '').toLowerCase(), host: m[2].toLowerCase(),
        port: m[3] || '', path: m[4] || '', rest: m[5] || ''
      };
    }
    return { kind: 'invalid', token: t, reason: 'syntax' };
  }

  // Everything that matters about one source list, for security checks
  function summarize(values, builder) {
    var s = {
      none: false, self: false, unsafeInline: false, unsafeEval: false, wasmEval: false, strictDynamic: false,
      unsafeHashes: false, wildcard: false, nonces: [], hashes: [], schemes: [], hosts: [],
      goodNonce: false, goodHash: false, effective: 0
    };
    values.forEach(function (v) {
      var c = classifySource(v);
      if (c.kind === 'keyword') {
        if (c.keyword === '\'none\'') { s.none = true; return; }
        s.effective++;
        if (c.keyword === '\'self\'') s.self = true;
        else if (c.keyword === '\'unsafe-inline\'') s.unsafeInline = true;
        else if (c.keyword === '\'unsafe-eval\'') s.unsafeEval = true;
        else if (c.keyword === '\'wasm-unsafe-eval\'') s.wasmEval = true;
        else if (c.keyword === '\'strict-dynamic\'') s.strictDynamic = true;
        else if (c.keyword === '\'unsafe-hashes\'') s.unsafeHashes = true;
      } else if (c.kind === 'nonce') {
        s.nonces.push(c);
        if (c.valid || (builder && c.placeholder)) { s.goodNonce = true; s.effective++; }
      } else if (c.kind === 'hash') {
        s.hashes.push(c);
        if (c.valid && !c.wrongLength) { s.goodHash = true; s.effective++; }
      } else if (c.kind === 'wildcard') {
        s.wildcard = true;
        s.effective++;
      } else if (c.kind === 'scheme') {
        s.schemes.push(c.scheme);
        s.effective++;
      } else if (c.kind === 'host') {
        s.hosts.push(c);
        s.effective++;
      }
    });
    s.trusted = s.goodNonce || s.goodHash;
    s.blocksAll = s.effective === 0;
    // Blocks everything only because every source is invalid (e.g. self without quotes)
    s.onlyInvalid = s.blocksAll && !s.none && values.length > 0;
    s.wide = s.wildcard || s.schemes.indexOf('https') !== -1 || s.schemes.indexOf('http') !== -1;
    return s;
  }

  function effectiveDirective(policy, name) {
    var chain = [name].concat((DIRECTIVES[name] && DIRECTIVES[name].fallback) || []);
    for (var i = 0; i < chain.length; i++) {
      var d = policy.byName[chain[i]];
      if (d) return { name: chain[i], values: d.values, own: i === 0 };
    }
    return null;
  }

  // ── CSP syntax checks ───────────────────────────────────

  function invalidSourceMsg(s, name) {
    var v = q(truncate(s.token, 60));
    switch (s.reason) {
      case 'unquoted':
        return msg('error', v + ' needs single quotes — without them it is read as a host name. Write ' + q(s.fix) + '.', name);
      case 'double':
        return msg('error', v + ': CSP keywords use single quotes. Write ' + q(s.fix) + '.', name);
      case 'quote':
        return msg('error', v + ' has an unbalanced quote, so browsers ignore it.', name);
      case 'keyword':
        return msg('error', v + ' is not a CSP keyword, so browsers ignore it.' + (s.suggestion ? ' Did you mean ' + q(s.suggestion) + '?' : ''), name);
      default:
        return msg('error', v + ' is not a valid source expression, so browsers ignore it.', name);
    }
  }

  function checkNonce(s, name, ctx, out) {
    if (s.placeholder) {
      if (ctx.origin === 'builder') {
        out.push(msg('info', 'Replace ' + q(s.token) + ' with a fresh random value on every response and put the same value in each <script nonce="…"> tag.', name));
      } else {
        out.push(msg('error', q(truncate(s.token, 50)) + ' looks like a placeholder that was never replaced. ' +
          (s.valid ? 'Browsers accept it as a fixed nonce that anyone can copy into an injected script.' : 'Browsers reject it, so scripts that rely on it are blocked.'), name));
      }
      return;
    }
    if (!s.valid) {
      out.push(msg('error', q(truncate(s.token, 50)) + ' is not a valid nonce: only base64 characters (A–Z, a–z, 0–9, +, /, -, _ and trailing =) are allowed. Browsers ignore it.', name));
      return;
    }
    if (s.bits < 128) {
      out.push(msg('warn', 'Nonce ' + q(truncate(s.token, 40)) + ' carries at most ' + s.bits + ' bits. Use at least 128 bits (16 random bytes, 22+ base64 characters).', name));
    }
  }

  function checkHash(s, name, out) {
    var label = s.alg.replace('sha', 'SHA-');
    if (!s.valid) {
      out.push(msg('error', q(truncate(s.token, 50)) + ' is not valid base64, so it can never match. Browsers ignore it.', name));
    } else if (s.wrongLength) {
      out.push(msg('error', q(truncate(s.token, 50)) + ' decodes to ' + s.bytes + ' bytes, but a ' + label + ' hash has ' +
        HASH_BYTES[s.alg] + '. It can never match — recompute it.', name));
    }
  }

  function checkSources(d, def, ctx, out) {
    var name = d.name;
    if (!d.values.length) {
      out.push(msg('info', q(name) + ' has no sources, which blocks everything — the same as `\'none\'`. Writing `\'none\'` makes that explicit.', name));
      return;
    }
    var scriptish = def.kind === 'script' || name === 'default-src';
    var styleish = def.kind === 'style' || name === 'default-src';
    var hasNone = false;
    var others = 0;
    d.values.forEach(function (v) {
      var s = classifySource(v);
      var lower = v.toLowerCase();
      if (s.kind === 'keyword' && s.keyword === '\'none\'') {
        hasNone = true;
        return;
      }
      others++;
      if (s.kind === 'invalid') {
        out.push(invalidSourceMsg(s, name));
        return;
      }
      if (s.kind === 'host' && !s.scheme && !s.port && !s.path && (own(DIRECTIVES, lower) || own(OBSOLETE_DIRECTIVES, lower))) {
        out.push(msg('error', q(v) + ' inside ' + q(name) + ' is read as a host name. Is a `;` missing before it?', name));
        return;
      }
      if (name === 'frame-ancestors' && (s.kind === 'nonce' || s.kind === 'hash' || (s.kind === 'keyword' && s.keyword !== '\'self\''))) {
        out.push(msg('error', q(truncate(v, 40)) + ' is not allowed in `frame-ancestors` (only `\'self\'`, `\'none\'`, hosts and schemes), so browsers ignore it.', name));
        return;
      }
      if (s.kind === 'keyword') {
        var scope = KEYWORDS[s.keyword];
        if ((scope === 'script' && !scriptish) || (scope === 'script-style' && !scriptish && !styleish)) {
          out.push(msg('info', q(v) + ' has no effect in ' + q(name) + '.', name));
        } else if (own(NEWER_KEYWORDS, s.keyword)) {
          out.push(msg('info', q(v) + ' is a newer keyword that only some browsers understand; others ignore it.', name));
        }
        return;
      }
      if (s.kind === 'nonce' || s.kind === 'hash') {
        if (!scriptish && !styleish) {
          out.push(msg('info', q(truncate(v, 40)) + ' has no effect in ' + q(name) + ': nonces and hashes only apply to scripts and styles.', name));
          return;
        }
        if (s.kind === 'nonce') checkNonce(s, name, ctx, out);
        else checkHash(s, name, out);
        return;
      }
      if (s.kind === 'host') {
        if (s.rest) {
          out.push(msg('warn', q(v) + ': browsers ignore the ' + (s.rest.charAt(0) === '?' ? 'query string' : 'fragment') +
            ' in a source, so this matches ' + q(v.slice(0, v.length - s.rest.length)) + '.', name));
        }
        if (s.scheme === 'http' || s.scheme === 'ws') {
          out.push(msg('info', q(v) + ' uses an insecure scheme. Browsers also let it match the ' + (s.scheme === 'http' ? 'https' : 'wss') +
            ':// version; write that instead so nothing loads over plain ' + s.scheme + '.', name));
        }
      }
    });
    if (hasNone && others) {
      out.push(msg('warn', '`\'none\'` has no effect in ' + q(name) + ' because other sources are listed with it.', name));
    }
  }

  function checkDirective(d, ctx, out) {
    var name = d.name;
    if (!own(DIRECTIVES, name)) {
      if (own(OBSOLETE_DIRECTIVES, name)) {
        out.push(msg('warn', q(name) + ': ' + OBSOLETE_DIRECTIVES[name], name));
        return;
      }
      var hint = suggestDirective(name);
      out.push(msg('error', 'Unknown directive ' + q(d.rawName) + ', so browsers ignore it.' + (hint ? ' Did you mean ' + q(hint) + '?' : ''), name));
      return;
    }
    var def = DIRECTIVES[name];
    if (def.experimental) out.push(msg('info', q(name) + ' is experimental; check browser support before relying on it.', name));
    if (ctx.delivery === 'meta' && def.notInMeta) {
      out.push(msg('error', q(name) + ' is ignored in a <meta> policy — send it as an HTTP header.', name));
      return;
    }
    var values = d.values;
    var lowerValues = values.map(function (v) { return v.toLowerCase(); });
    switch (def.value) {
      case 'empty':
        if (values.length) out.push(msg('warn', q(name) + ' takes no value; ' + q(values.join(' ')) + ' is ignored.', name));
        return;
      case 'uri':
        if (!values.length) out.push(msg('error', q(name) + ' needs a URL.', name));
        values.forEach(function (v) {
          if (/[<>"{}|\\^`]/.test(v)) out.push(msg('error', q(v) + ' is not a valid report URL.', name));
        });
        return;
      case 'endpoint':
        if (values.length !== 1) {
          out.push(msg(values.length ? 'warn' : 'error', q(name) + ' takes exactly one endpoint name' + (values.length ? '; browsers use ' + q(values[0]) + '.' : '.'), name));
        }
        return;
      case 'sandbox':
        lowerValues.forEach(function (v, i) {
          if (SANDBOX_TOKENS.indexOf(v) === -1) out.push(msg('error', q(values[i]) + ' is not a sandbox flag, so browsers ignore it.', name));
        });
        return;
      case 'rttf':
        if (values.length !== 1 || lowerValues[0] !== '\'script\'') out.push(msg('error', q(name) + ' only accepts `\'script\'`.', name));
        return;
      case 'tt':
        values.forEach(function (v, i) {
          var lv = lowerValues[i];
          if (v === '*' || lv === '\'none\'' || lv === '\'allow-duplicates\'') return;
          if (!/^[A-Za-z0-9\-#=_/@.%]+$/.test(v)) out.push(msg('error', q(v) + ' is not a valid Trusted Types policy name.', name));
        });
        if (lowerValues.indexOf('\'none\'') !== -1 && values.length > 1) {
          out.push(msg('warn', '`\'none\'` has no effect in `trusted-types` when policy names are listed.', name));
        }
        return;
      case 'webrtc':
        if (values.length !== 1 || (lowerValues[0] !== '\'allow\'' && lowerValues[0] !== '\'block\'')) {
          out.push(msg('error', q(name) + ' takes `\'allow\'` or `\'block\'`.', name));
        }
        return;
      default:
        checkSources(d, def, ctx, out);
    }
  }

  function checkPolicySyntax(policy, ctx) {
    var out = [];
    policy.nonAscii.forEach(function (t) {
      out.push(msg('error', 'Non-ASCII characters in ' + q(truncate(t, 60)) + ', so browsers drop the whole directive. Curly quotes (‘ ’) pasted from a word processor are the usual cause.', 'syntax'));
    });
    policy.duplicates.forEach(function (d) {
      out.push(msg('error', 'Duplicate ' + q(d.name) + ': browsers keep the first one and ignore this copy' +
        (d.values.length ? ' (' + q(truncate(d.values.join(' '), 60)) + ')' : '') + '. Merge the sources into one directive.', d.name));
    });
    policy.directives.forEach(function (d) { checkDirective(d, ctx, out); });
    return out;
  }

  // ── CSP security evaluation ─────────────────────────────

  var SCRIPT_RANK = { open: 0, unsafe: 1, allowlist: 2, good: 3, strict: 4, broken: 4 };

  function hostRisks(hosts, where, out) {
    hosts.forEach(function (h) {
      var bare = !h.path || h.path === '/';
      var why = own(RISKY_SCRIPT_HOSTS, h.host) ? RISKY_SCRIPT_HOSTS[h.host] : null;
      if (why && bare) {
        out.push(msg('warn', q(h.token) + ' in ' + q(where) + ' is risky: ' + why + '. An injected <script src> pointing there passes the policy. Pin exact files with a path, or use nonces.', 'scripts'));
        return;
      }
      if (why) {
        out.push(msg('info', q(h.token) + ' is limited to a path, which helps. Browsers stop checking paths after a redirect, so an open redirect on an allowed host can still get around it.', 'scripts'));
        return;
      }
      if (h.host.indexOf('*.') === 0) {
        var base = h.host.slice(2);
        var shared = SHARED_HOSTING.filter(function (d) { return base === d || base.slice(-(d.length + 1)) === '.' + d; })[0];
        if (shared) {
          out.push(msg('bad', q(h.token) + ' in ' + q(where) + ' trusts every ' + shared + ' site, and anyone can create one. Name the exact host instead.', 'scripts'));
        }
      }
      if (h.scheme === 'http') {
        out.push(msg('warn', q(h.token) + ' allows scripts over plain HTTP, where they can be modified in transit.', 'scripts'));
      }
    });
  }

  // Security checks for one policy. Messages carry a topic; "missing" ones
  // are merged across policies when a header holds several.
  function evaluatePolicy(policy, ctx) {
    var out = [];
    var builder = ctx.origin === 'builder';
    var res = { scripts: 'open', trusted: false, nonces: false };
    var missing = function (level, text, topic) {
      var m = msg(level, text, topic);
      m.missing = true;
      out.push(m);
    };

    // Scripts (<script> elements)
    var el = effectiveDirective(policy, 'script-src-elem');
    if (!el) {
      missing('bad', 'No `script-src` or `default-src`: scripts load from anywhere, and inline scripts and `eval()` run freely. The policy gives no XSS protection.', 'scripts');
    } else {
      var s = summarize(el.values, builder);
      var where = q(el.name);
      res.trusted = s.trusted;
      res.nonces = s.nonces.length > 0;
      if (s.onlyInvalid) {
        out.push(msg('error', where + ' has no valid source, so every script is blocked. Fix the invalid entries listed above.', 'scripts'));
        res.scripts = 'broken';
      } else if (s.blocksAll) {
        out.push(msg('ok', where + ' blocks all scripts.', 'scripts'));
        res.scripts = 'strict';
      } else if (s.strictDynamic) {
        if (!s.trusted) {
          out.push(msg('error', where + ' has `\'strict-dynamic\'` but no valid nonce or hash, so nothing is trusted and every script is blocked.', 'scripts'));
          res.scripts = 'broken';
        } else {
          out.push(msg('ok', 'Strict CSP: ' + where + ' trusts scripts by ' + (s.goodNonce ? 'nonce' : 'hash') +
            ', and `\'strict-dynamic\'` passes that trust to the scripts they load.', 'scripts'));
          var ignored = [];
          if (s.self) ignored.push('`\'self\'`');
          if (s.unsafeInline) ignored.push('`\'unsafe-inline\'`');
          if (s.wildcard) ignored.push('`*`');
          s.schemes.forEach(function (x) { ignored.push(q(x + ':')); });
          if (s.hosts.length) ignored.push(s.hosts.length === 1 ? q(s.hosts[0].token) : plural(s.hosts.length, 'host source'));
          if (ignored.length) {
            out.push(msg('info', 'Browsers that support `\'strict-dynamic\'` ignore ' + joinList(ignored) + ' in ' + where +
              '; they only act as a fallback for older browsers.', 'scripts'));
          }
          res.scripts = 'strict';
        }
      } else {
        var unsafe = false;
        if (s.unsafeInline) {
          if (s.trusted) {
            out.push(msg('info', '`\'unsafe-inline\'` is ignored because ' + where + ' also has a nonce or hash; it only matters to browsers older than CSP Level 2.', 'scripts'));
          } else {
            out.push(msg('bad', where + ' allows `\'unsafe-inline\'`: any injected inline script or event handler runs, which cancels most of the XSS protection.', 'scripts'));
            unsafe = true;
          }
        }
        if (s.wildcard) {
          out.push(msg('bad', '`*` in ' + where + ' lets scripts load from any host.', 'scripts'));
          unsafe = true;
        }
        s.schemes.forEach(function (sc) {
          if (sc === 'https' || sc === 'http') {
            out.push(msg('bad', q(sc + ':') + ' in ' + where + ' lets scripts load from any ' + (sc === 'https' ? 'HTTPS ' : '') + 'site.', 'scripts'));
            unsafe = true;
          } else if (sc === 'data') {
            out.push(msg('bad', '`data:` in ' + where + ' lets an attacker put a whole script inside a URL.', 'scripts'));
            unsafe = true;
          } else if (sc === 'blob') {
            out.push(msg('info', '`blob:` in ' + where + ' allows scripts built from Blob objects by code already on the page.', 'scripts'));
          } else {
            out.push(msg('info', q(sc + ':') + ' in ' + where + ' allows scripts from any ' + sc + ': URL.', 'scripts'));
          }
        });
        var before = out.length;
        hostRisks(s.hosts, el.name, out);
        for (var i = before; i < out.length; i++) {
          if (out[i].level === 'bad') unsafe = true;
        }
        if (unsafe) {
          res.scripts = 'unsafe';
        } else if (s.trusted) {
          out.push(msg('ok', where + ' trusts scripts by ' + (s.goodNonce ? 'nonce' : 'hash') + '.', 'scripts'));
          res.scripts = 'good';
        } else {
          out.push(msg('info', where + ' is an allowlist. Allowlists can often be bypassed through JSONP endpoints or old libraries on allowed hosts; nonces or hashes with `\'strict-dynamic\'` (a "strict CSP") hold up better.', 'scripts'));
          res.scripts = 'allowlist';
        }
      }
      if (s.nonces.length && !builder) {
        out.push(msg('info', 'A nonce only protects you if it changes on every response — reload the page and check that the value differs.', 'scripts'));
      }
    }

    // Inline event handlers, when script-src-attr is set on its own
    if (policy.byName['script-src-attr']) {
      var sa = summarize(policy.byName['script-src-attr'].values, builder);
      if (sa.unsafeInline && !sa.trusted) {
        out.push(msg('bad', '`script-src-attr` allows `\'unsafe-inline\'`, so injected event handlers such as onerror="…" run.', 'scripts'));
        if (SCRIPT_RANK[res.scripts] > SCRIPT_RANK.unsafe) res.scripts = 'unsafe';
      }
    }

    // eval() follows script-src, then default-src
    var ev = effectiveDirective(policy, 'script-src');
    if (ev) {
      var se = summarize(ev.values, builder);
      if (se.unsafeEval) {
        out.push(msg('warn', '`\'unsafe-eval\'` in ' + q(ev.name) + ' lets strings run as code (eval, new Function, string timers), so injected text can execute. Drop it if your libraries allow.', 'eval'));
      } else if (se.wasmEval) {
        out.push(msg('info', '`\'wasm-unsafe-eval\'` allows WebAssembly compilation only — far narrower than `\'unsafe-eval\'`.', 'eval'));
      }
      if (se.unsafeHashes) {
        out.push(msg('info', '`\'unsafe-hashes\'` lets inline event handlers run when their hash is listed — safer than `\'unsafe-inline\'`, weaker than moving handlers into scripts.', 'eval'));
      }
    }

    // object-src
    var ob = effectiveDirective(policy, 'object-src');
    if (!ob) {
      missing('warn', 'No `object-src` or `default-src`: <object> and <embed> can load content from anywhere. Add `object-src \'none\'`.', 'object');
    } else {
      var so = summarize(ob.values, builder);
      if (!so.blocksAll) {
        out.push(msg(so.wide ? 'warn' : 'info', '`object-src`' + (ob.own ? '' : ' (inherited from ' + q(ob.name) + ')') +
          ' allows plugin content. Unless you embed files with <object> or <embed>, set `object-src \'none\'`.', 'object'));
      }
    }

    // base-uri never falls back to default-src
    if (!policy.byName['base-uri']) {
      missing(res.trusted ? 'warn' : 'info', 'No `base-uri` (it does not fall back to default-src): an injected <base href> can make relative script URLs load from another server' +
        (res.trusted ? ', and nonced scripts would still run' : '') + '. Add `base-uri \'none\'` or `base-uri \'self\'`.', 'base');
    }

    // form-action never falls back either
    if (!policy.byName['form-action']) {
      missing('info', 'No `form-action` (it does not fall back to default-src): injected forms can send data to any site. Add `form-action \'self\'`.', 'form');
    }

    // default-src
    var dflt = policy.byName['default-src'];
    if (!dflt) {
      var open = ['img-src', 'font-src', 'connect-src', 'media-src', 'frame-src', 'style-src', 'worker-src', 'manifest-src']
        .filter(function (n) { return !effectiveDirective(policy, n); });
      if (open.length) {
        missing('info', 'No `default-src`, so ' + joinList(open.map(q)) + (open.length === 1 ? ' is' : ' are') +
          ' unrestricted. `default-src \'self\'` (or `\'none\'`) closes everything you do not list.', 'default');
      }
    } else if (summarize(dflt.values, builder).wide) {
      out.push(msg('warn', '`default-src` allows any host, so every directive that falls back to it is wide open.', 'default'));
    }

    // Styles
    var st = effectiveDirective(policy, 'style-src-elem');
    if (st) {
      var ss = summarize(st.values, builder);
      if (ss.unsafeInline && !ss.trusted) {
        out.push(msg('info', '`\'unsafe-inline\'` in ' + q(st.name) + ' allows injected <style> blocks. That is common and far less dangerous than inline scripts; nonces or hashes are stricter.', 'styles'));
      }
    }

    // frame-ancestors (header analysis covers it together with X-Frame-Options)
    if (ctx.standalone && !policy.byName['frame-ancestors']) {
      missing('info', 'No `frame-ancestors`: any site can show this page in a frame (clickjacking). Add `frame-ancestors \'self\'` or `\'none\'`.', 'frame');
    }

    // Reporting
    var hasUri = !!policy.byName['report-uri'];
    var hasTo = !!policy.byName['report-to'];
    if (ctx.disposition === 'report' && !hasUri && !hasTo) {
      out.push(msg('info', 'Report-only policy without `report-to` or `report-uri`: violations show up only in the browser console.', 'report'));
    }
    if (hasTo && ctx.endpoints) {
      var ep = policy.byName['report-to'].values[0];
      if (ep && !own(ctx.endpoints, ep)) {
        out.push(msg('warn', q('report-to ' + ep) + ' names an endpoint that no Reporting-Endpoints header defines, so reports cannot be sent.', 'report'));
      }
    }
    if (hasTo && !hasUri) {
      out.push(msg('info', 'Only `report-to` is set. Firefox supports it only since version 149 (March 2026), so also list `report-uri` for older browsers; browsers that understand `report-to` then ignore `report-uri`.', 'report'));
    } else if (hasUri && !hasTo) {
      out.push(msg('info', '`report-uri` is deprecated. Add `report-to` with a Reporting-Endpoints header and keep `report-uri` as the fallback for older browsers.', 'report'));
    }

    res.messages = out;
    return res;
  }

  // Merge the evaluations of several policies that all apply at once
  function mergeEvaluations(evals) {
    var out = [];
    var best = evals[0];
    evals.forEach(function (e) {
      if (SCRIPT_RANK[e.result.scripts] > SCRIPT_RANK[best.result.scripts]) best = e;
    });
    var missingTopics = {};
    evals.forEach(function (e) {
      e.result.messages.forEach(function (m) {
        if (!m.missing) return;
        missingTopics[m.topic] = (missingTopics[m.topic] || 0) + 1;
      });
    });
    var emitted = {};
    evals.forEach(function (e) {
      e.result.messages.forEach(function (m) {
        if (m.missing) {
          // Missing only matters when no policy sets it
          if (missingTopics[m.topic] === evals.length && !emitted[m.topic]) {
            emitted[m.topic] = true;
            out.push(msg(m.level, m.text, m.topic));
          }
          return;
        }
        if (m.topic === 'scripts' && e !== best && SCRIPT_RANK[best.result.scripts] >= SCRIPT_RANK.good &&
            (m.level === 'bad' || m.level === 'warn')) {
          return;
        }
        out.push(msg(m.level, 'Policy ' + e.number + ': ' + m.text, m.topic));
      });
    });
    evals.forEach(function (e) {
      if (e !== best && SCRIPT_RANK[best.result.scripts] >= SCRIPT_RANK.good && SCRIPT_RANK[e.result.scripts] < SCRIPT_RANK.good) {
        out.push(msg('info', 'Policy ' + e.number + ' allows more scripts than policy ' + best.number +
          ', but every policy applies, so the stricter script rules of policy ' + best.number + ' win.', 'scripts'));
      }
    });
    return { scripts: best.result.scripts, trusted: best.result.trusted, nonces: evals.some(function (e) { return e.result.nonces; }), messages: out };
  }

  // Analyze every value of one CSP header name (enforced or report-only)
  function analyzeCsp(values, ctx) {
    ctx = ctx || {};
    var out = [];
    var policies = [];
    values.forEach(function (value) {
      String(value).split(',').forEach(function (part, pi) {
        var p = parsePolicy(part);
        var empty = !p.directives.length && !p.nonAscii.length && !p.duplicates.length;
        if (pi > 0) {
          if (empty) {
            out.push(msg('warn', 'Empty policy after a comma. A trailing comma is harmless, but commas never separate sources.', 'syntax'));
          } else if (p.directives.length && !own(DIRECTIVES, p.directives[0].name) && !own(OBSOLETE_DIRECTIVES, p.directives[0].name)) {
            out.push(msg('error', 'The comma before ' + q(p.directives[0].rawName) + ' starts a separate policy, so ' +
              q(p.directives[0].rawName) + ' is read as a directive name. Separate sources with spaces, not commas.', 'syntax'));
            p.fragment = p.directives[0].name;
          }
        }
        if (!empty) policies.push(p);
      });
    });

    var multi = policies.length > 1;
    policies.forEach(function (p, i) {
      checkPolicySyntax(p, ctx).forEach(function (m) {
        // The comma message already explains a fragment's bogus first "directive"
        if (p.fragment && m.topic === p.fragment) return;
        out.push(multi ? msg(m.level, 'Policy ' + (i + 1) + ': ' + m.text, m.topic) : m);
      });
    });

    var real = [];
    policies.forEach(function (p, i) {
      var recognised = p.directives.some(function (d) { return own(DIRECTIVES, d.name); });
      if (recognised) real.push({ policy: p, number: i + 1 });
    });

    var result;
    if (!real.length) {
      out.push(msg('bad', 'No recognised directives, so this restricts nothing.', 'scripts'));
      result = { scripts: 'open', trusted: false, nonces: false, messages: [] };
    } else if (real.length === 1) {
      result = evaluatePolicy(real[0].policy, ctx);
    } else {
      out.push(msg('info', real.length + ' policies apply together: a resource must be allowed by every one of them, so extra policies can only tighten things.', 'syntax'));
      result = mergeEvaluations(real.map(function (r) {
        return { number: r.number, result: evaluatePolicy(r.policy, ctx) };
      }));
    }

    return {
      policies: policies,
      primary: real.length ? real[0].policy : (policies[0] || null),
      scripts: result.scripts,
      trusted: result.trusted,
      nonces: result.nonces,
      messages: sortMessages(out.concat(result.messages))
    };
  }

  function sortMessages(list) {
    return list.map(function (m, i) { m.order = i; return m; }).sort(function (a, b) {
      return (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || (a.order - b.order);
    }).map(function (m) { delete m.order; return m; });
  }

  // ── RFC 9651 structured fields ──────────────────────────

  function sfFail(s, what) {
    throw new Error(what + ' at position ' + (s.pos + 1));
  }

  function isDigit(c) { return c >= '0' && c <= '9'; }
  function isAlpha(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
  function isLcAlpha(c) { return c >= 'a' && c <= 'z'; }

  var TCHAR_EXTRA = '!#$%&\'*+-.^_`|~';

  function sfSkipSP(s) {
    while (s.str.charAt(s.pos) === ' ') s.pos++;
  }

  function sfSkipOWS(s) {
    var c;
    while ((c = s.str.charAt(s.pos)) === ' ' || c === '\t') s.pos++;
  }

  function sfKey(s) {
    var c = s.str.charAt(s.pos);
    if (!isLcAlpha(c) && c !== '*') {
      sfFail(s, c ? 'A key must start with a lowercase letter or "*", found `' + c + '`' : 'Missing key');
    }
    var start = s.pos;
    while (s.pos < s.str.length) {
      c = s.str.charAt(s.pos);
      if (!(isLcAlpha(c) || isDigit(c) || c === '_' || c === '-' || c === '.' || c === '*')) break;
      s.pos++;
    }
    return s.str.slice(start, s.pos);
  }

  function sfNumber(s) {
    var type = 'integer';
    var sign = 1;
    var num = '';
    if (s.str.charAt(s.pos) === '-') { sign = -1; s.pos++; }
    if (!isDigit(s.str.charAt(s.pos))) sfFail(s, 'Expected a digit');
    while (s.pos < s.str.length) {
      var c = s.str.charAt(s.pos);
      if (isDigit(c)) {
        num += c;
      } else if (type === 'integer' && c === '.') {
        if (num.length > 12) sfFail(s, 'Number too long');
        num += c;
        type = 'decimal';
      } else {
        break;
      }
      s.pos++;
      if (type === 'integer' && num.length > 15) sfFail(s, 'Integer too long');
      if (type === 'decimal' && num.length > 16) sfFail(s, 'Decimal too long');
    }
    if (type === 'decimal') {
      if (num.charAt(num.length - 1) === '.') sfFail(s, 'Decimal ends with "."');
      if (num.split('.')[1].length > 3) sfFail(s, 'Too many decimal places');
    }
    return { type: type, value: sign * parseFloat(num) };
  }

  function sfString(s) {
    var out = '';
    s.pos++;
    while (s.pos < s.str.length) {
      var c = s.str.charAt(s.pos++);
      if (c === '\\') {
        if (s.pos >= s.str.length) sfFail(s, 'Unterminated string');
        var n = s.str.charAt(s.pos++);
        if (n !== '"' && n !== '\\') sfFail(s, 'Invalid escape in string');
        out += n;
      } else if (c === '"') {
        return { type: 'string', value: out };
      } else {
        var code = c.charCodeAt(0);
        if (code < 0x20 || code > 0x7e) sfFail(s, 'Invalid character in string');
        out += c;
      }
    }
    sfFail(s, 'Unterminated string');
  }

  function sfToken(s) {
    var start = s.pos;
    s.pos++;
    while (s.pos < s.str.length) {
      var c = s.str.charAt(s.pos);
      if (!(isAlpha(c) || isDigit(c) || TCHAR_EXTRA.indexOf(c) !== -1 || c === ':' || c === '/')) break;
      s.pos++;
    }
    return { type: 'token', value: s.str.slice(start, s.pos) };
  }

  function sfBytes(s) {
    s.pos++;
    var end = s.str.indexOf(':', s.pos);
    if (end === -1) sfFail(s, 'Unterminated byte sequence');
    var b = s.str.slice(s.pos, end);
    if (!/^[A-Za-z0-9+/=]*$/.test(b)) sfFail(s, 'Invalid byte sequence');
    s.pos = end + 1;
    return { type: 'bytes', value: b };
  }

  function sfBoolean(s) {
    s.pos++;
    var c = s.str.charAt(s.pos);
    if (c !== '0' && c !== '1') sfFail(s, 'Invalid boolean');
    s.pos++;
    return { type: 'boolean', value: c === '1' };
  }

  function sfDisplay(s) {
    s.pos++;
    if (s.str.charAt(s.pos) !== '"') sfFail(s, 'Invalid display string');
    s.pos++;
    var encoded = '';
    while (s.pos < s.str.length) {
      var c = s.str.charAt(s.pos++);
      var code = c.charCodeAt(0);
      if (code < 0x20 || code > 0x7e) sfFail(s, 'Invalid character in display string');
      if (c === '%') {
        var hex = s.str.substr(s.pos, 2);
        if (!/^[0-9a-f]{2}$/.test(hex)) sfFail(s, 'Invalid escape in display string');
        encoded += '%' + hex;
        s.pos += 2;
      } else if (c === '"') {
        try {
          return { type: 'display', value: decodeURIComponent(encoded) };
        } catch (e) {
          sfFail(s, 'Invalid UTF-8 in display string');
        }
      } else {
        encoded += encodeURIComponent(c);
      }
    }
    sfFail(s, 'Unterminated display string');
  }

  function sfBare(s) {
    var c = s.str.charAt(s.pos);
    if (c === '-' || isDigit(c)) return sfNumber(s);
    if (c === '"') return sfString(s);
    if (isAlpha(c) || c === '*') return sfToken(s);
    if (c === ':') return sfBytes(s);
    if (c === '?') return sfBoolean(s);
    if (c === '@') {
      s.pos++;
      var n = sfNumber(s);
      if (n.type !== 'integer') sfFail(s, 'Invalid date');
      return { type: 'date', value: n.value };
    }
    if (c === '%') return sfDisplay(s);
    sfFail(s, c ? 'Unexpected `' + c + '`' : 'Unexpected end of value');
  }

  function sfParams(s) {
    var params = [];
    while (s.str.charAt(s.pos) === ';') {
      s.pos++;
      sfSkipSP(s);
      var key = sfKey(s);
      var value = { type: 'boolean', value: true };
      if (s.str.charAt(s.pos) === '=') {
        s.pos++;
        value = sfBare(s);
      }
      var found = false;
      for (var i = 0; i < params.length; i++) {
        if (params[i].key === key) { params[i].value = value; found = true; }
      }
      if (!found) params.push({ key: key, value: value });
    }
    return params;
  }

  function sfItem(s) {
    var item = sfBare(s);
    item.params = sfParams(s);
    return item;
  }

  function sfInner(s) {
    var items = [];
    s.pos++;
    while (s.pos < s.str.length) {
      sfSkipSP(s);
      if (s.str.charAt(s.pos) === ')') {
        s.pos++;
        return { type: 'inner', items: items, params: sfParams(s) };
      }
      items.push(sfItem(s));
      var c = s.str.charAt(s.pos);
      if (c !== ' ' && c !== ')') sfFail(s, c ? 'Expected a space or ")", found `' + c + '`' : 'Missing ")"');
    }
    sfFail(s, 'Missing ")"');
  }

  function sfItemOrInner(s) {
    return s.str.charAt(s.pos) === '(' ? sfInner(s) : sfItem(s);
  }

  function sfList(s) {
    var members = [];
    while (s.pos < s.str.length) {
      members.push(sfItemOrInner(s));
      sfSkipOWS(s);
      if (s.pos >= s.str.length) return members;
      if (s.str.charAt(s.pos) !== ',') sfFail(s, 'Expected a comma, found `' + s.str.charAt(s.pos) + '`');
      s.pos++;
      sfSkipOWS(s);
      if (s.pos >= s.str.length) sfFail(s, 'Trailing comma');
    }
    return members;
  }

  function sfDictionary(s) {
    var entries = [];
    var index = Object.create(null);
    var dupes = [];
    while (s.pos < s.str.length) {
      var key = sfKey(s);
      var member;
      if (s.str.charAt(s.pos) === '=') {
        s.pos++;
        member = sfItemOrInner(s);
      } else {
        member = { type: 'boolean', value: true, params: sfParams(s) };
      }
      if (index[key] !== undefined) {
        entries[index[key]].value = member;
        dupes.push(key);
      } else {
        index[key] = entries.length;
        entries.push({ key: key, value: member });
      }
      sfSkipOWS(s);
      if (s.pos >= s.str.length) break;
      if (s.str.charAt(s.pos) !== ',') sfFail(s, 'Expected a comma, found `' + s.str.charAt(s.pos) + '`');
      s.pos++;
      sfSkipOWS(s);
      if (s.pos >= s.str.length) sfFail(s, 'Trailing comma');
    }
    return { entries: entries, dupes: dupes };
  }

  // Parse a structured field: type is "dictionary", "list" or "item"
  function sfParse(input, type) {
    var s = { str: String(input == null ? '' : input), pos: 0 };
    try {
      for (var i = 0; i < s.str.length; i++) {
        var code = s.str.charCodeAt(i);
        if (code > 0x7e || (code < 0x20 && code !== 0x09)) {
          s.pos = i;
          sfFail(s, 'Non-ASCII character');
        }
      }
      sfSkipSP(s);
      var value = type === 'dictionary' ? sfDictionary(s) : type === 'list' ? sfList(s) : sfItem(s);
      sfSkipSP(s);
      if (s.pos < s.str.length) sfFail(s, 'Unexpected `' + s.str.charAt(s.pos) + '`');
      return { ok: true, value: value };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Header block parsing ────────────────────────────────

  var HEADER_RE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)[ \t]*:[ \t]*(.*)$/;
  var STATUS_RE = /^HTTP\/(\d(?:\.\d)?)[ \t]+(\d{3})(?:[ \t]+(.*))?$/i;
  var PSEUDO_STATUS_RE = /^:status[ \t]*:[ \t]*(\d{3})$/i;
  var VERBOSE_LINE_RE = /^< (HTTP\/|[!#$%&'*+.^_`|~0-9A-Za-z-]+[ \t]*:)/;

  // Split pasted text into responses (status line + headers). Understands
  // plain header lists, curl -i / -I / -IL, curl -v ("< " lines), wget -S
  // (indented) and DevTools copies where the value sits on the next line.
  function parseHeaderBlock(text) {
    var result = { responses: [], skipped: [], bodyLines: 0, format: 'headers' };
    var lines = splitLines(String(text).replace(BOM, ''));
    var nonEmpty = lines.filter(function (l) { return l.trim() !== ''; });
    var verbose = nonEmpty.some(function (l) { return VERBOSE_LINE_RE.test(l); });
    var indented = !verbose && nonEmpty.length > 0 && nonEmpty.every(function (l) { return /^[ \t]/.test(l); });
    if (verbose) result.format = 'curl -v';
    else if (indented) result.format = 'wget -S';

    function prep(line) {
      if (line === undefined) return null;
      if (verbose) {
        if (line === '<' || line === '< ') return '';
        return /^< /.test(line) ? line.slice(2) : null;
      }
      return indented ? line.replace(/^[ \t]+/, '') : line;
    }

    var current = null;
    var last = null;
    var afterBlank = false;
    for (var i = 0; i < lines.length; i++) {
      var line = prep(lines[i]);
      if (line === null) continue;
      if (line.trim() === '') {
        if (current && current.headers.length) afterBlank = true;
        last = null;
        continue;
      }
      var trimmed = line.trim();
      var st = STATUS_RE.exec(trimmed) || PSEUDO_STATUS_RE.exec(trimmed);
      if (st) {
        var pseudo = trimmed.charAt(0) === ':';
        current = {
          status: parseInt(pseudo ? st[1] : st[2], 10),
          protocol: pseudo ? 'HTTP/2' : 'HTTP/' + st[1],
          reason: pseudo ? '' : (st[3] || '').trim(),
          headers: [],
          line: i + 1
        };
        result.responses.push(current);
        last = null;
        afterBlank = false;
        continue;
      }
      if (afterBlank) {
        result.bodyLines++;
        continue;
      }
      if (/^[ \t]/.test(line) && last) {
        last.value = (last.value + ' ' + trimmed).trim();
        continue;
      }
      var hm = HEADER_RE.exec(trimmed);
      if (hm && trimmed.charAt(0) !== ':') {
        if (!current) {
          current = { status: null, protocol: '', reason: '', headers: [], line: i + 1 };
          result.responses.push(current);
        }
        var value = hm[2].trim();
        if (value === '' && !verbose) {
          var next = prep(lines[i + 1]);
          if (next && next.trim() && !HEADER_RE.test(next.trim()) && !STATUS_RE.test(next.trim())) {
            value = next.trim();
            i++;
          }
        }
        last = { name: hm[1], lname: hm[1].toLowerCase(), value: value, line: i + 1 };
        current.headers.push(last);
        continue;
      }
      result.skipped.push(i + 1);
    }
    return result;
  }

  function extractMetaPolicies(text) {
    var out = [];
    var re = /<meta\b[^>]*>/gi;
    var m;
    function attr(tag, name) {
      var a = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
      if (!a) return null;
      return a[1] !== undefined ? a[1] : (a[2] !== undefined ? a[2] : a[3]);
    }
    while ((m = re.exec(text))) {
      var equiv = (attr(m[0], 'http-equiv') || '').toLowerCase();
      if (equiv !== 'content-security-policy' && equiv !== 'content-security-policy-report-only') continue;
      out.push({ reportOnly: equiv !== 'content-security-policy', value: decodeEntities(attr(m[0], 'content') || '') });
    }
    return out;
  }

  function looksLikePolicy(text) {
    var first = String(text).trim().split(/[\s;]/)[0].toLowerCase();
    return own(DIRECTIVES, first) || own(OBSOLETE_DIRECTIVES, first) || /^[a-z-]+-src$/.test(first);
  }

  // Decide what the analyzer input is: headers, a bare policy or <meta> tags
  function detectInput(text) {
    var raw = String(text == null ? '' : text);
    var truncated = raw.length > MAX_INPUT_CHARS;
    if (truncated) raw = raw.slice(0, MAX_INPUT_CHARS);
    var trimmed = raw.trim();
    if (!trimmed) return { kind: 'empty' };
    var metas = extractMetaPolicies(trimmed);
    if (metas.length) return { kind: 'meta', metas: metas, truncated: truncated };
    var parsed = parseHeaderBlock(raw);
    var count = parsed.responses.reduce(function (n, r) { return n + r.headers.length; }, 0);
    if (count && !(parsed.responses.length === 1 && parsed.responses[0].headers.every(function (h) { return own(DIRECTIVES, h.lname); }))) {
      return { kind: 'headers', parsed: parsed, truncated: truncated };
    }
    if (looksLikePolicy(trimmed) || count) {
      return { kind: 'policy', value: splitLines(trimmed).map(function (l) { return l.trim(); }).join(' '), colons: count > 0, truncated: truncated };
    }
    return { kind: 'unknown', truncated: truncated };
  }

  // ── Header checks ───────────────────────────────────────

  function groupHeaders(headers) {
    var map = Object.create(null);
    headers.forEach(function (h) {
      var key = h.lname || String(h.name).toLowerCase();
      if (!map[key]) map[key] = [];
      map[key].push(h);
    });
    return map;
  }

  function valuesOf(map, name) {
    return (map[name] || []).map(function (h) { return h.value; });
  }

  // Fetch "get, decode, and split": comma-separated, trimmed
  function splitHeaderList(values) {
    var out = [];
    values.forEach(function (v) {
      String(v).split(',').forEach(function (t) {
        out.push(t.replace(/^[ \t]+|[ \t]+$/g, ''));
      });
    });
    return out;
  }

  function section(id, title, fields) {
    var s = { id: id, title: title, status: 'info', values: [], messages: [], points: 0, max: 0, fix: '' };
    Object.keys(fields || {}).forEach(function (k) { s[k] = fields[k]; });
    return s;
  }

  function parseHsts(value) {
    var r = { maxAge: null, includeSub: false, preload: false, dupes: [], errors: [], unknown: [] };
    var seen = Object.create(null);
    String(value).split(';').forEach(function (part) {
      var p = part.trim();
      if (!p) return;
      var eq = p.indexOf('=');
      var name = (eq === -1 ? p : p.slice(0, eq)).trim().toLowerCase();
      var val = eq === -1 ? null : p.slice(eq + 1).trim();
      if (val !== null && val.length >= 2 && val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') val = val.slice(1, -1);
      if (seen[name]) {
        r.dupes.push(name);
        return;
      }
      seen[name] = true;
      if (name === 'max-age') {
        if (val === null || !/^\d+$/.test(val)) r.errors.push('max-age needs a whole number of seconds');
        else r.maxAge = parseInt(val, 10);
      } else if (name === 'includesubdomains') {
        r.includeSub = true;
        if (val !== null) r.errors.push('`includeSubDomains` takes no value');
      } else if (name === 'preload') {
        r.preload = true;
      } else {
        r.unknown.push(name);
      }
    });
    if (r.maxAge === null && !r.errors.length) r.errors.push('`max-age` is missing');
    r.valid = !r.errors.length && !r.dupes.length;
    return r;
  }

  function hstsSection(map) {
    var values = valuesOf(map, 'strict-transport-security');
    var s = section('hsts', 'Strict-Transport-Security', { max: 20, values: values });
    if (!values.length) {
      s.status = 'missing';
      s.fix = 'Strict-Transport-Security: max-age=' + ONE_YEAR;
      s.messages.push(msg('warn', 'No HSTS: a visitor\'s first plain-HTTP request can be intercepted and downgraded (SSL stripping). Send it once the whole site works over HTTPS.'));
      return s;
    }
    if (values.length > 1) {
      s.messages.push(msg('warn', 'Sent ' + values.length + ' times. Browsers use only the first Strict-Transport-Security header' +
        (values.some(function (v) { return v !== values[0]; }) ? ', and these differ' : '') + '.'));
    }
    var h = parseHsts(values[0]);
    if (!h.valid) {
      s.status = 'invalid';
      h.errors.forEach(function (e) { s.messages.push(msg('error', e.charAt(0).toUpperCase() + e.slice(1) + ', so browsers ignore the whole header.')); });
      h.dupes.forEach(function (d) { s.messages.push(msg('error', q(d) + ' appears twice, so browsers ignore the whole header.')); });
      return s;
    }
    var age = h.maxAge;
    if (age === 0) {
      s.status = 'weak';
      s.messages.push(msg('warn', '`max-age=0` tells browsers to forget HSTS for this host. That is only useful while turning HSTS off.'));
    } else if (age < ONE_DAY) {
      s.status = 'weak';
      s.points = 5;
      s.messages.push(msg('warn', 'max-age is ' + formatDuration(age) + ' — a testing value. Raise it to a year once HTTPS works everywhere.'));
    } else if (age < HALF_YEAR) {
      s.status = 'weak';
      s.points = 10;
      s.messages.push(msg('warn', 'max-age is ' + formatDuration(age) + '. Six months is a common minimum and one year (31536000) is the usual choice.'));
    } else if (age < ONE_YEAR) {
      s.status = 'good';
      s.points = 15;
      s.messages.push(msg('info', 'max-age is ' + formatDuration(age) + '. One year (31536000) or more is the usual recommendation.'));
    } else {
      s.status = 'good';
      s.points = 20;
      s.messages.push(msg('ok', 'max-age is ' + formatDuration(age) + '.'));
    }
    if (h.includeSub) {
      s.messages.push(msg('info', '`includeSubDomains` forces HTTPS on every subdomain — check that all of them, including internal ones, have valid certificates.'));
    }
    if (h.preload) {
      var gaps = [];
      if (age < ONE_YEAR) gaps.push('max-age of at least 31536000');
      if (!h.includeSub) gaps.push('`includeSubDomains`');
      if (gaps.length) {
        s.messages.push(msg('warn', '`preload` is set, but the preload list also requires ' + joinList(gaps) + '. hstspreload.org would reject this domain.'));
      } else {
        s.messages.push(msg('info', 'Meets the preload list\'s header rules. Submitting also needs an HTTP→HTTPS redirect on the same host, and removal from the list takes months.'));
      }
    }
    h.unknown.forEach(function (u) {
      s.messages.push(msg('info', 'Unknown directive ' + q(u) + ' is ignored.'));
    });
    return s;
  }

  // X-Frame-Options as the HTML standard reads it: comma-split, lowercased,
  // de-duplicated; several different values block framing when one of them
  // is DENY, SAMEORIGIN or ALLOWALL.
  function evaluateXfo(values) {
    var tokens = [];
    splitHeaderList(values).forEach(function (t) {
      var lower = t.toLowerCase();
      if (lower && tokens.indexOf(lower) === -1) tokens.push(lower);
    });
    var r = { status: 'invalid', points: 0, messages: [] };
    if (values.length > 1) {
      r.messages.push(msg('info', 'X-Frame-Options is sent ' + values.length + ' times — usually the app and the proxy both add it.'));
    }
    if (tokens.length > 1) {
      var strict = tokens.some(function (t) { return t === 'deny' || t === 'sameorigin' || t === 'allowall'; });
      r.status = strict ? 'weak' : 'bad';
      r.points = strict ? 10 : 0;
      r.messages.push(msg('warn', 'Conflicting X-Frame-Options values (' + tokens.map(q).join(', ') + '). ' +
        (strict ? 'Browsers then refuse all framing, even by your own pages.' : 'Browsers then ignore the header.')));
      return r;
    }
    var v = tokens[0] || '';
    if (v === 'deny') {
      r.status = 'good';
      r.points = 15;
      r.messages.push(msg('ok', '`X-Frame-Options: DENY`: no site can frame this page.'));
    } else if (v === 'sameorigin') {
      r.status = 'good';
      r.points = 15;
      r.messages.push(msg('ok', '`X-Frame-Options: SAMEORIGIN`: only your own pages can frame this page.'));
    } else if (v.indexOf('allow-from') === 0) {
      r.status = 'bad';
      r.messages.push(msg('bad', '`ALLOW-FROM` is obsolete: current browsers ignore it, so this header does not stop framing. Use CSP `frame-ancestors` with the allowed origins.'));
    } else {
      r.messages.push(msg('error', q(v || '(empty)') + ' is not a valid X-Frame-Options value (use `DENY` or `SAMEORIGIN`), so browsers ignore the header.'));
    }
    return r;
  }

  function framingSection(map, csp) {
    var values = valuesOf(map, 'x-frame-options');
    var s = section('framing', 'Clickjacking protection', { max: 15, values: values.map(function (v) { return 'X-Frame-Options: ' + v; }) });
    var fa = null;
    if (csp) {
      csp.policies.forEach(function (p) {
        if (!fa && p.byName['frame-ancestors']) fa = p.byName['frame-ancestors'];
      });
    }
    var xfo = values.length ? evaluateXfo(values) : null;
    if (fa) {
      s.values.unshift('frame-ancestors ' + fa.values.join(' '));
      var sum = summarize(fa.values, false);
      if (sum.onlyInvalid) {
        s.status = 'invalid';
        s.points = 10;
        s.messages.push(msg('error', '`frame-ancestors` has no valid source, so framing is blocked everywhere — even by your own pages. See the CSP errors above.'));
      } else if (sum.blocksAll) {
        s.status = 'good';
        s.points = 15;
        s.messages.push(msg('ok', '`frame-ancestors \'none\'`: no site can show this page in a frame.'));
      } else if (sum.wide) {
        s.status = 'weak';
        s.points = 5;
        s.messages.push(msg('warn', '`frame-ancestors` allows any site to frame this page.'));
      } else {
        s.status = 'good';
        s.points = 15;
        s.messages.push(msg('ok', '`frame-ancestors` limits framing to ' + (sum.self && !sum.hosts.length && !sum.schemes.length ? 'your own origin' : 'the listed sources') + '.'));
      }
      if (xfo) {
        s.messages.push(msg('info', 'Browsers that support frame-ancestors ignore X-Frame-Options; it only matters to very old browsers.'));
        xfo.messages.forEach(function (m) {
          if (m.level !== 'ok') s.messages.push(msg(m.level === 'bad' ? 'warn' : m.level, m.text));
        });
      }
      return s;
    }
    if (!xfo) {
      s.status = 'missing';
      s.fix = 'Content-Security-Policy: frame-ancestors \'self\'  (and X-Frame-Options: SAMEORIGIN)';
      s.messages.push(msg('warn', 'Nothing stops other sites from showing this page in a frame (clickjacking). Add `frame-ancestors \'self\'` to the CSP, plus `X-Frame-Options: SAMEORIGIN` for old browsers.'));
      return s;
    }
    s.status = xfo.status;
    s.points = xfo.points;
    s.messages = xfo.messages;
    s.messages.push(msg('info', 'CSP `frame-ancestors` is the modern replacement and overrides X-Frame-Options where supported.'));
    return s;
  }

  function xctoSection(map) {
    var values = valuesOf(map, 'x-content-type-options');
    var s = section('xcto', 'X-Content-Type-Options', { max: 10, values: values });
    if (!values.length) {
      s.status = 'missing';
      s.fix = 'X-Content-Type-Options: nosniff';
      s.messages.push(msg('warn', 'Missing: browsers may guess ("sniff") a file\'s type and run an uploaded text file as a script or stylesheet. Send `nosniff`.'));
      return s;
    }
    var first = splitHeaderList(values)[0].toLowerCase();
    if (first === 'nosniff') {
      s.status = 'good';
      s.points = 10;
      s.messages.push(msg('ok', '`nosniff`: scripts and stylesheets must be served with the right Content-Type.'));
      if (values.length > 1) s.messages.push(msg('info', 'Sent ' + values.length + ' times; harmless, but usually a duplicated config line.'));
    } else {
      s.status = 'invalid';
      s.messages.push(msg('error', 'Only `nosniff` is valid' + (first ? ', and browsers read ' + q(first) + ' as no value' : '') + '.'));
    }
    return s;
  }

  function referrerSection(map) {
    var values = valuesOf(map, 'referrer-policy');
    var s = section('referrer', 'Referrer-Policy', { max: 10, values: values });
    if (!values.length) {
      s.status = 'missing';
      s.points = 5;
      s.fix = 'Referrer-Policy: strict-origin-when-cross-origin';
      s.messages.push(msg('info', 'Not set. Current browsers default to `strict-origin-when-cross-origin`, which is reasonable; setting it makes the choice explicit and covers older browsers.'));
      return s;
    }
    var policy = '';
    var unknown = [];
    var valid = [];
    splitHeaderList(values).forEach(function (t) {
      var lower = t.toLowerCase();
      if (!lower) return;
      if (own(REFERRER_POLICIES, lower)) { policy = lower; valid.push(lower); } else unknown.push(t);
    });
    unknown.forEach(function (u) { s.messages.push(msg('error', q(u) + ' is not a referrer policy, so browsers skip it.')); });
    if (!policy) {
      s.status = 'invalid';
      s.points = 5;
      s.messages.push(msg('info', 'No valid value, so browsers fall back to their default (`strict-origin-when-cross-origin`).'));
      return s;
    }
    if (valid.length > 1) s.messages.push(msg('info', 'Several values: browsers use the last one they support, ' + q(policy) + '.'));
    var info = REFERRER_POLICIES[policy];
    var text = q(policy) + ' ' + info.about + '.';
    if (info.rank === 'strict') {
      s.status = 'good';
      s.points = 10;
      s.messages.push(msg('ok', text));
    } else if (info.rank === 'ok') {
      s.status = 'weak';
      s.points = 7;
      s.messages.push(msg('info', text + ' `strict-origin-when-cross-origin` avoids the downgrade leak.'));
    } else if (info.rank === 'weak') {
      s.status = 'weak';
      s.points = 3;
      s.messages.push(msg('warn', text + ' Paths and query strings (search terms, IDs, reset tokens) leak to other sites.'));
    } else {
      s.status = 'bad';
      s.messages.push(msg('bad', text + ' Use `strict-origin-when-cross-origin` or stricter.'));
    }
    return s;
  }

  function isKnownFeature(name) {
    return PP_FEATURES.indexOf(name) !== -1 || /^ch-[a-z0-9-]+$/.test(name);
  }

  // Permissions-Policy: RFC 9651 dictionary of feature -> allowlist
  function analyzePermissionsPolicy(value) {
    var res = { ok: false, features: [], messages: [] };
    var r = sfParse(value, 'dictionary');
    if (!r.ok) {
      var legacy = /'/.test(value) || /^\s*[a-z-]+\s+(\*|'?(none|self)'?|https?:)/i.test(value);
      res.messages.push(msg('error', 'Not a valid structured header (' + r.error + '), so browsers ignore the whole Permissions-Policy.' +
        (legacy ? ' It looks like the old Feature-Policy syntax (`camera \'none\'`); Permissions-Policy uses `camera=()`.' : '')));
      return res;
    }
    res.ok = true;
    r.value.dupes.forEach(function (k) {
      res.messages.push(msg('warn', q(k) + ' appears more than once; the last value wins.'));
    });
    r.value.entries.forEach(function (e) {
      var f = { name: e.key, allow: 'none', self: false, origins: [] };
      if (own(PP_OBSOLETE, e.key)) {
        res.messages.push(msg('info', q(e.key) + ' ' + PP_OBSOLETE[e.key]));
      } else if (!isKnownFeature(e.key)) {
        res.messages.push(msg('warn', q(e.key) + ' is not a feature this tool knows — check the spelling. Browsers skip unknown features.'));
      }
      var v = e.value;
      if (v.type === 'token' && v.value === '*') {
        f.allow = 'all';
      } else if (v.type === 'token' && v.value === 'self') {
        f.allow = 'list';
        f.self = true;
      } else if (v.type === 'inner') {
        var star = false;
        v.items.forEach(function (it) {
          if (it.type === 'token' && it.value === '*') {
            star = true;
          } else if (it.type === 'token' && it.value === 'self') {
            f.self = true;
          } else if (it.type === 'token' && it.value === 'src') {
            res.messages.push(msg('info', '`src` in ' + q(e.key) + ' only means something in an iframe allow attribute; the header ignores it.'));
          } else if (it.type === 'string') {
            var o = toOrigin(it.value);
            if (o) f.origins.push(o);
            else res.messages.push(msg('warn', q('"' + it.value + '"') + ' in ' + q(e.key) + ' is not a valid origin and is ignored.' +
              (/^self$/i.test(it.value) ? ' Write `self` without quotes.' : '')));
          } else if (it.type === 'token') {
            res.messages.push(msg('warn', q(it.value) + ' in ' + q(e.key) + ' is ignored: origins must be quoted strings such as `"https://example.com"`.' +
              (it.value.toLowerCase() === 'none' ? ' To switch a feature off, use ' + q(e.key + '=()') + '.' : '')));
          } else {
            res.messages.push(msg('warn', 'Unsupported value in ' + q(e.key) + '; it is ignored.'));
          }
        });
        f.allow = star ? 'all' : (f.self || f.origins.length ? 'list' : 'none');
      } else {
        f.allow = 'invalid';
        res.messages.push(msg('warn', q(e.key) + ' has an unsupported value. Use `()`, `self`, `*` or a list such as `(self "https://example.com")`.'));
      }
      res.features.push(f);
    });
    return res;
  }

  function describeAllow(f) {
    if (f.allow === 'all') return 'allowed for all origins';
    if (f.allow === 'none') return 'blocked';
    if (f.allow === 'invalid') return 'invalid value';
    var parts = [];
    if (f.self) parts.push('self');
    return 'allowed for ' + parts.concat(f.origins).join(', ');
  }

  function permissionsSection(map) {
    var values = valuesOf(map, 'permissions-policy');
    var legacy = valuesOf(map, 'feature-policy');
    var s = section('permissions', 'Permissions-Policy', { max: 5, values: values });
    if (legacy.length) {
      s.messages.push(msg('info', 'Feature-Policy is the legacy name with a different syntax. Permissions-Policy replaced it; keep Feature-Policy only for old browsers.'));
    }
    if (!values.length) {
      s.status = 'missing';
      s.fix = 'Permissions-Policy: camera=(), microphone=(), geolocation=()';
      s.messages.push(msg('info', 'Not set. Switching off features you never use (camera, microphone, geolocation…) limits what injected or embedded code can ask for.'));
      return s;
    }
    var pp = analyzePermissionsPolicy(values.join(', '));
    s.features = pp.features;
    pp.messages.forEach(function (m) { s.messages.push(m); });
    if (!pp.ok) {
      s.status = 'invalid';
      return s;
    }
    var blocked = pp.features.filter(function (f) { return f.allow === 'none'; }).length;
    s.status = 'good';
    s.points = pp.features.length ? 5 : 0;
    s.messages.unshift(msg('ok', plural(pp.features.length, 'feature') + ' set, ' + blocked + ' switched off.'));
    s.messages.push(msg('info', 'Chromium-based browsers (Chrome, Edge, Opera) apply Permissions-Policy; Firefox and Safari do not support the header yet.'));
    return s;
  }

  function parseSfToken(value, allowed) {
    var r = sfParse(value, 'item');
    if (!r.ok) return { ok: false, error: r.error };
    if (r.value.type !== 'token') return { ok: false, error: 'expected a token' };
    var token = r.value.value;
    var reportTo = null;
    r.value.params.forEach(function (p) {
      if (p.key === 'report-to' && p.value.type === 'string') reportTo = p.value.value;
    });
    return { ok: own(allowed, token), token: token, reportTo: reportTo, error: own(allowed, token) ? '' : 'unknown value' };
  }

  function coopSection(map) {
    var values = valuesOf(map, 'cross-origin-opener-policy');
    var s = section('coop', 'Cross-Origin-Opener-Policy', { max: 5, values: values });
    if (!values.length) {
      s.status = 'missing';
      s.fix = 'Cross-Origin-Opener-Policy: same-origin-allow-popups';
      s.messages.push(msg('info', 'Not set. COOP separates your page from windows of other sites (cross-window attacks, tab-nabbing, Spectre-style leaks). `same-origin-allow-popups` is a gentle start.'));
      return s;
    }
    var r = parseSfToken(values.join(', '), COOP_VALUES);
    if (!r.ok) {
      s.status = 'invalid';
      s.messages.push(msg('error', 'Not a valid value' + (r.token ? ' (' + q(r.token) + ')' : '') + ', so browsers treat it as `unsafe-none`.'));
      return s;
    }
    if (r.token === 'unsafe-none') {
      s.status = 'weak';
      s.messages.push(msg('info', '`unsafe-none` ' + COOP_VALUES['unsafe-none'] + '.'));
    } else {
      s.status = 'good';
      s.points = 5;
      s.messages.push(msg('ok', q(r.token) + ' ' + COOP_VALUES[r.token] + '.'));
      if (r.token === 'same-origin') {
        s.messages.push(msg('info', 'Popups to other sites (OAuth, payments) lose their link back to this page; use `same-origin-allow-popups` if a login popup breaks.'));
      }
      if (r.token === 'noopener-allow-popups') {
        s.messages.push(msg('info', '`noopener-allow-popups` is newer (Chrome and Edge 131+, Safari 18.4+). Firefox does not know it and falls back to `unsafe-none`.'));
      }
    }
    return s;
  }

  function coepSection(map, coop) {
    var values = valuesOf(map, 'cross-origin-embedder-policy');
    if (!values.length) return null;
    var s = section('coep', 'Cross-Origin-Embedder-Policy', { values: values });
    var r = parseSfToken(values.join(', '), COEP_VALUES);
    if (!r.ok) {
      s.status = 'invalid';
      s.messages.push(msg('error', 'Not a valid value, so browsers treat it as `unsafe-none`.'));
      return s;
    }
    s.status = r.token === 'unsafe-none' ? 'info' : 'good';
    s.messages.push(msg(r.token === 'unsafe-none' ? 'info' : 'ok', q(r.token) + ': ' + COEP_VALUES[r.token] + '.'));
    if (r.token !== 'unsafe-none') {
      var isolated = coop && coop.status === 'good' && /same-origin$/.test(coop.values[0] || '') && !/allow-popups/.test(coop.values[0] || '');
      s.messages.push(msg('info', isolated ? 'Together with COOP `same-origin` the page is cross-origin isolated (SharedArrayBuffer and precise timers work).' :
        'Cross-origin isolation also needs `Cross-Origin-Opener-Policy: same-origin`.'));
    }
    if (r.token === 'require-corp') {
      s.messages.push(msg('info', 'Third-party images, scripts and iframes without CORS or a Cross-Origin-Resource-Policy header stop loading. `credentialless` breaks fewer embeds.'));
    }
    if (r.token === 'credentialless') {
      s.messages.push(msg('info', 'Safari does not support `credentialless` and applies no restriction there.'));
    }
    return s;
  }

  function corpSection(map) {
    var values = valuesOf(map, 'cross-origin-resource-policy');
    if (!values.length) return null;
    var s = section('corp', 'Cross-Origin-Resource-Policy', { values: values });
    var v = String(values[0]).trim();
    if (own(CORP_VALUES, v)) {
      s.status = 'good';
      s.messages.push(msg('ok', q(v) + ': ' + CORP_VALUES[v] + '.'));
    } else {
      s.status = 'invalid';
      s.messages.push(msg('error', q(v) + ' is not a valid value' + (own(CORP_VALUES, v.toLowerCase()) ? ' — values are case-sensitive, write ' + q(v.toLowerCase()) : '') +
        ', so browsers ignore it.'));
    }
    if (values.length > 1) s.messages.push(msg('warn', 'Sent ' + values.length + ' times; send it once.'));
    return s;
  }

  function reportingEndpoints(map) {
    var names = Object.create(null);
    var messages = [];
    var re = valuesOf(map, 'reporting-endpoints');
    if (re.length) {
      var r = sfParse(re.join(', '), 'dictionary');
      if (!r.ok) {
        messages.push(msg('error', 'Reporting-Endpoints is not a valid structured header (' + r.error + '), so browsers ignore it.'));
      } else {
        r.value.entries.forEach(function (e) {
          if (e.value.type !== 'string') {
            messages.push(msg('error', 'Endpoint ' + q(e.key) + ' must be a quoted URL string.'));
            return;
          }
          var url = e.value.value;
          var ok = /^https:\/\//i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(url);
          names[e.key] = url;
          messages.push(msg(ok ? 'ok' : 'warn', 'Endpoint ' + q(e.key) + ' → ' + q(url) + (ok ? '' : ': browsers only send reports to secure (HTTPS) endpoints.')));
        });
      }
    }
    var legacy = valuesOf(map, 'report-to');
    if (legacy.length) {
      try {
        JSON.parse('[' + legacy.join(',') + ']').forEach(function (g) {
          var group = (g && typeof g.group === 'string') ? g.group : 'default';
          names[group] = names[group] || ((g && g.endpoints && g.endpoints[0] && g.endpoints[0].url) || '');
        });
        messages.push(msg('info', 'Report-To (JSON) is the older Reporting API header; `Reporting-Endpoints` replaced it for CSP reports.'));
      } catch (e) {
        messages.push(msg('error', 'Report-To is not valid JSON, so browsers ignore it.'));
      }
    }
    return { names: names, messages: messages, present: re.length > 0 || legacy.length > 0 };
  }

  function parseSetCookie(value) {
    var parts = String(value).split(';');
    var nv = parts[0];
    var eq = nv.indexOf('=');
    var attrs = Object.create(null);
    parts.slice(1).forEach(function (p) {
      var i = p.indexOf('=');
      var k = (i === -1 ? p : p.slice(0, i)).trim().toLowerCase();
      if (k) attrs[k] = i === -1 ? '' : p.slice(i + 1).trim();
    });
    return { name: eq === -1 ? '' : nv.slice(0, eq).trim(), attrs: attrs };
  }

  var SESSION_COOKIE_RE = /sess|sid|auth|token|jwt|logged_?in|remember|login/i;

  function cookiesSection(map) {
    var values = valuesOf(map, 'set-cookie');
    if (!values.length) return null;
    var s = section('cookies', 'Set-Cookie', { values: [], status: 'good' });
    var penalty = false;
    values.forEach(function (v) {
      var c = parseSetCookie(v);
      var name = c.name || '(no name)';
      var flags = [];
      var secure = 'secure' in c.attrs;
      var httpOnly = 'httponly' in c.attrs;
      var sameSite = 'samesite' in c.attrs ? c.attrs.samesite.toLowerCase() : '';
      if (secure) flags.push('Secure');
      if (httpOnly) flags.push('HttpOnly');
      if (sameSite) flags.push('SameSite=' + c.attrs.samesite);
      s.values.push(name + (flags.length ? ' — ' + flags.join(', ') : ' — no flags'));
      var label = 'Cookie ' + q(truncate(name, 40));
      if (/^__host-/i.test(name) && (!secure || c.attrs.path !== '/' || 'domain' in c.attrs)) {
        s.messages.push(msg('error', label + ': the __Host- prefix requires Secure, Path=/ and no Domain, so browsers reject this cookie.'));
        penalty = true;
      } else if (/^__secure-/i.test(name) && !secure) {
        s.messages.push(msg('error', label + ': the __Secure- prefix requires Secure, so browsers reject this cookie.'));
        penalty = true;
      }
      if (sameSite === 'none' && !secure) {
        s.messages.push(msg('error', label + ': `SameSite=None` without `Secure` is rejected by current browsers.'));
        penalty = true;
      } else if (sameSite && sameSite !== 'lax' && sameSite !== 'strict' && sameSite !== 'none') {
        s.messages.push(msg('warn', label + ': ' + q('SameSite=' + c.attrs.samesite) + ' is not a valid value.'));
      }
      if (!secure) {
        s.messages.push(msg('warn', label + ' has no `Secure` flag, so it is also sent over plain HTTP.'));
        penalty = true;
      }
      if (!httpOnly && SESSION_COOKIE_RE.test(name)) {
        s.messages.push(msg('warn', label + ' looks like a session cookie but has no `HttpOnly`, so an XSS can read it.'));
        penalty = true;
      }
      if (!sameSite) {
        s.messages.push(msg('info', label + ' has no `SameSite`. Chrome and Edge treat that as `Lax`; other browsers may not, so set it explicitly.'));
      }
    });
    if (penalty) {
      s.status = 'weak';
      s.points = -5;
    }
    s.messages.push(msg('info', 'Cookie values are not shown in this report.'));
    return s;
  }

  function corsSection(map) {
    var acao = valuesOf(map, 'access-control-allow-origin');
    if (!acao.length) return null;
    var acac = valuesOf(map, 'access-control-allow-credentials');
    var s = section('cors', 'CORS', { values: acao.map(function (v) { return 'Access-Control-Allow-Origin: ' + v; }).concat(acac.map(function (v) { return 'Access-Control-Allow-Credentials: ' + v; })) });
    var creds = acac.length && String(acac[0]).trim().toLowerCase() === 'true';
    var v = String(acao[0]).trim();
    if (acao.length > 1 || /[,\s]/.test(v)) {
      s.status = 'invalid';
      s.messages.push(msg('error', 'Access-Control-Allow-Origin must be a single origin or `*`; browsers reject lists and repeated headers. Echo the one allowed origin per request instead.'));
    } else if (v === '*') {
      if (creds) {
        s.status = 'invalid';
        s.messages.push(msg('error', '`*` together with `Access-Control-Allow-Credentials: true` is refused by browsers for credentialed requests.'));
      } else {
        s.status = 'info';
        s.messages.push(msg('info', '`*`: any site can read these responses — fine for public data, wrong for anything behind a login.'));
      }
    } else if (v.toLowerCase() === 'null') {
      s.status = 'bad';
      s.messages.push(msg('warn', '`null` origin is allowed. Sandboxed iframes and data: URLs send `Origin: null`, so any site can obtain it.'));
    } else {
      s.status = 'good';
      s.messages.push(msg('ok', 'Only ' + q(v) + ' may read responses' + (creds ? ', with cookies' : '') + '.'));
    }
    if (acac.length && !creds) s.messages.push(msg('info', 'Only `true` is meaningful for Access-Control-Allow-Credentials.'));
    return s;
  }

  function disclosureSection(map) {
    var s = section('disclosure', 'Server details', { values: [], status: 'info' });
    var leak = false;
    Object.keys(DISCLOSURE_HEADERS).forEach(function (name) {
      var label = DISCLOSURE_HEADERS[name][0];
      (map[name] || []).forEach(function (h) {
        s.values.push(label + ': ' + h.value);
        var version = /\d+\.\d+/.test(h.value) || name === 'x-aspnet-version' || name === 'x-aspnetmvc-version';
        if (version) leak = true;
        s.messages.push(msg(version ? 'warn' : 'info', label + ' reveals ' + DISCLOSURE_HEADERS[name][1] + (version ? ' and its version' : '') +
          ' (' + q(truncate(h.value, 60)) + '). ' + (version ? 'Attackers match versions against known vulnerabilities — hide them.' : 'Consider removing it.')));
      });
    });
    if (!s.values.length) return null;
    if (leak) {
      s.status = 'weak';
      s.points = -5;
    }
    return s;
  }

  function legacySection(map) {
    var s = section('legacy', 'Legacy headers', { values: [], status: 'info' });
    var xss = valuesOf(map, 'x-xss-protection');
    xss.forEach(function (v) {
      s.values.push('X-XSS-Protection: ' + v);
      if (String(v).trim() === '0') {
        s.messages.push(msg('ok', '`X-XSS-Protection: 0` switches off the old XSS filter — the recommended value if you send the header at all.'));
      } else {
        s.messages.push(msg('info', 'X-XSS-Protection enables the old XSS Auditor, which current browsers have removed and which could itself be abused. Send `0` or drop the header, and rely on CSP.'));
      }
    });
    Object.keys(LEGACY_HEADERS).forEach(function (name) {
      (map[name] || []).forEach(function (h) {
        s.values.push(h.name + ': ' + truncate(h.value, 80));
        s.messages.push(msg(LEGACY_HEADERS[name][0], LEGACY_HEADERS[name][1]));
      });
    });
    if (!s.values.length) return null;
    if (s.messages.some(function (m) { return m.level === 'warn'; })) s.status = 'weak';
    return s;
  }

  function cspSection(csp, ro) {
    var s = section('csp', 'Content-Security-Policy', { max: 35 });
    if (!csp) {
      if (ro) {
        s.status = 'weak';
        s.points = 5;
        s.messages.push(msg('warn', 'Only a report-only policy: violations are reported, but nothing is blocked yet. Switch to `Content-Security-Policy` once the reports are clean.'));
      } else {
        s.status = 'missing';
        s.fix = 'Content-Security-Policy: default-src \'self\'; object-src \'none\'; base-uri \'self\'; frame-ancestors \'self\'';
        s.messages.push(msg('bad', 'No Content-Security-Policy. CSP is the main browser-side defence against XSS; build one below, and start with Report-Only if you are unsure what it will block.'));
      }
      return s;
    }
    s.values = csp.values;
    s.analysis = csp;
    s.messages = csp.messages;
    var warns = csp.messages.filter(function (m) { return m.level === 'warn'; }).length;
    var errors = csp.messages.filter(function (m) { return m.level === 'error'; }).length;
    switch (csp.scripts) {
      case 'open':
        s.status = 'bad';
        s.points = 5;
        break;
      case 'unsafe':
        s.status = 'bad';
        s.points = 15;
        break;
      case 'broken':
        s.status = 'invalid';
        s.points = 20;
        break;
      default:
        s.points = 35 - Math.min(10, warns * 5) - (errors ? 5 : 0);
        s.status = errors ? 'invalid' : (warns ? 'weak' : 'good');
    }
    return s;
  }

  function gradeFor(score, cspFull) {
    if (score >= 95 && cspFull) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  // Analyze one response's headers. opts.origin = "builder" | "analyzer"
  function analyzeHeaders(headers, opts) {
    opts = opts || {};
    var map = groupHeaders(headers || []);
    var reporting = reportingEndpoints(map);
    var baseCtx = { origin: opts.origin || 'analyzer', delivery: 'header', endpoints: reporting.present ? reporting.names : null };
    var cspValues = valuesOf(map, 'content-security-policy');
    var roValues = valuesOf(map, 'content-security-policy-report-only');
    var csp = null;
    var ro = null;
    if (cspValues.length) {
      csp = analyzeCsp(cspValues, extend(baseCtx, { disposition: 'enforce' }));
      csp.values = cspValues;
    }
    if (roValues.length) {
      ro = analyzeCsp(roValues, extend(baseCtx, { disposition: 'report' }));
      ro.values = roValues;
    }

    var sections = [cspSection(csp, ro)];
    if (ro) {
      var rs = section('csp-ro', 'Content-Security-Policy-Report-Only', { values: roValues, analysis: ro, messages: ro.messages, status: 'info' });
      rs.messages = [msg('info', 'Report-only: browsers report what this policy would block, but block nothing.')].concat(ro.messages);
      sections.push(rs);
    }
    sections.push(hstsSection(map));
    sections.push(framingSection(map, csp));
    sections.push(xctoSection(map));
    sections.push(referrerSection(map));
    sections.push(permissionsSection(map));
    var coop = coopSection(map);
    sections.push(coop);
    [coepSection(map, coop), corpSection(map)].forEach(function (x) { if (x) sections.push(x); });
    if (reporting.present) {
      sections.push(section('reporting', 'Reporting endpoints', {
        values: valuesOf(map, 'reporting-endpoints').concat(valuesOf(map, 'report-to')),
        messages: reporting.messages,
        status: reporting.messages.some(function (m) { return m.level === 'error'; }) ? 'invalid' : 'good'
      }));
    }
    [cookiesSection(map), corsSection(map), disclosureSection(map), legacySection(map)].forEach(function (x) { if (x) sections.push(x); });

    // Directive-looking "headers" (script-src: 'self') are a common paste mistake
    var stray = headers.filter(function (h) { return own(DIRECTIVES, h.lname); });
    if (stray.length) {
      sections.push(section('stray', 'Not headers', {
        status: 'invalid',
        values: stray.map(function (h) { return h.name + ': ' + h.value; }),
        messages: [msg('error', joinList(stray.map(function (h) { return q(h.name + ':'); })) +
          ' look like CSP directives written as headers. Directives go inside one Content-Security-Policy value, separated by `;`, without a colon.')]
      }));
    }

    var total = 0;
    sections.forEach(function (x) { total += x.points; });
    var score = Math.max(0, Math.min(100, total));
    var cspFull = sections[0].points === 35;
    var counts = { error: 0, bad: 0, warn: 0, info: 0, ok: 0 };
    sections.forEach(function (x) {
      x.messages.forEach(function (m) { counts[m.level]++; });
    });
    return {
      sections: sections,
      score: score,
      grade: gradeFor(score, cspFull),
      counts: counts,
      csp: csp,
      reportOnly: ro,
      headerCount: headers.length
    };
  }

  function extend(base, extra) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  // Policy-only analysis (a pasted CSP value or <meta> tags)
  function analyzePolicyOnly(value, opts) {
    opts = opts || {};
    return analyzeCsp([value], {
      origin: opts.origin || 'analyzer',
      delivery: opts.delivery || 'header',
      disposition: opts.reportOnly ? 'report' : 'enforce',
      standalone: true,
      endpoints: null
    });
  }

  // ── Builder ─────────────────────────────────────────────

  var BUILDER_DIRECTIVES = ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src',
    'media-src', 'object-src', 'worker-src', 'manifest-src', 'base-uri', 'form-action', 'frame-ancestors',
    'script-src-elem', 'script-src-attr', 'style-src-elem', 'style-src-attr', 'child-src',
    'require-trusted-types-for', 'trusted-types'];

  var SCRIPT_STYLE_ONLY = ['\'unsafe-inline\'', '\'unsafe-eval\'', '\'wasm-unsafe-eval\'', '\'strict-dynamic\'',
    '\'unsafe-hashes\'', '\'report-sample\'', '\'inline-speculation-rules\''];

  function defaultPermissions() {
    var p = {};
    ['camera', 'microphone', 'geolocation'].forEach(function (f) { p[f] = { mode: 'none', origins: '' }; });
    return p;
  }

  function presetDirectives(name) {
    var preset = PRESETS[name] || PRESETS.blank;
    var d = {};
    BUILDER_DIRECTIVES.forEach(function (n) { d[n] = preset.directives[n] || ''; });
    return d;
  }

  function defaultState() {
    return {
      csp: { enabled: true, reportOnly: false, directives: presetDirectives('starter'), upgrade: true, services: {} },
      reporting: { url: '', name: 'csp-endpoint' },
      hsts: { enabled: true, maxAge: ONE_YEAR, includeSub: false, preload: false },
      xfo: 'auto',
      xcto: true,
      referrer: 'strict-origin-when-cross-origin',
      permissions: defaultPermissions(),
      coop: '',
      coep: '',
      corp: '',
      xxss: false,
      hideServer: false
    };
  }

  // Split a directive field into sources; ";" and "," would break the header
  function splitSources(text) {
    return splitAsciiWs(String(text || '').replace(/[;,]/g, ' '));
  }

  function sameSource(a, b) {
    return a.toLowerCase() === b.toLowerCase();
  }

  function mergeSources(list, extra) {
    var out = list.slice();
    extra.forEach(function (src) {
      if (!out.some(function (x) { return sameSource(x, src); })) out.push(src);
    });
    if (extra.length) {
      out = out.filter(function (x) { return x.toLowerCase() !== '\'none\''; });
    }
    return out;
  }

  // When a service needs a directive the user left empty, start from what the
  // directive inherits so adding YouTube to frame-src keeps 'self' working.
  // Returns null when nothing in the chain is set: the directive is then
  // unrestricted and the service is already allowed.
  function seedFromFallback(map, name) {
    var chain = (DIRECTIVES[name] && DIRECTIVES[name].fallback) || [];
    for (var i = 0; i < chain.length; i++) {
      if (map[chain[i]]) {
        var scriptLike = DIRECTIVES[name].kind === 'script';
        var styleLike = DIRECTIVES[name].kind === 'style';
        return map[chain[i]].filter(function (src) {
          var c = classifySource(src);
          if (scriptLike) return true;
          if (c.kind === 'nonce' || c.kind === 'hash') return styleLike;
          if (c.kind === 'keyword' && SCRIPT_STYLE_ONLY.indexOf(c.keyword) !== -1) {
            return styleLike && (c.keyword === '\'unsafe-inline\'' || c.keyword === '\'unsafe-hashes\'' || c.keyword === '\'report-sample\'');
          }
          return true;
        });
      }
    }
    return null;
  }

  function serviceById(id) {
    for (var i = 0; i < SERVICES.length; i++) {
      if (SERVICES[i].id === id) return SERVICES[i];
    }
    return null;
  }

  // Sources each directive gets from checked services: { directive: [sources] }
  function serviceSources(services) {
    var out = {};
    SERVICES.forEach(function (svc) {
      if (!services || !services[svc.id]) return;
      Object.keys(svc.sources).forEach(function (dir) {
        out[dir] = mergeSources(out[dir] || [], svc.sources[dir]);
      });
    });
    return out;
  }

  function buildCspValue(csp, reporting) {
    var map = {};
    BUILDER_DIRECTIVES.forEach(function (name) {
      var list = splitSources(csp.directives[name]);
      if (list.length) map[name] = list;
    });
    var extra = serviceSources(csp.services);
    // Script and style hosts also go into -elem directives the user set,
    // because those override script-src / style-src for elements
    ['script', 'style'].forEach(function (kind) {
      if (extra[kind + '-src'] && map[kind + '-src-elem']) {
        extra[kind + '-src-elem'] = mergeSources(extra[kind + '-src-elem'] || [], extra[kind + '-src']);
      }
    });
    // Directives that fall back to others come later in DIRECTIVE_ORDER, so
    // seed in that order to inherit already-merged service sources
    DIRECTIVE_ORDER.forEach(function (name) {
      if (!extra[name]) return;
      var base = map[name] || seedFromFallback(map, name);
      if (base) map[name] = mergeSources(base, extra[name]);
    });
    if (reporting && reporting.url) {
      map['report-uri'] = [reporting.url];
      if (reporting.name) map['report-to'] = [reporting.name];
    }
    var parts = [];
    DIRECTIVE_ORDER.forEach(function (name) {
      if (name === 'upgrade-insecure-requests') return;
      if (map[name]) parts.push(name + (map[name].length ? ' ' + map[name].join(' ') : ''));
    });
    if (csp.upgrade) parts.push('upgrade-insecure-requests');
    return parts.join('; ');
  }

  function validEndpointName(name) {
    return /^[a-z*][a-z0-9_.*-]*$/.test(String(name || ''));
  }

  function permissionsValue(perms) {
    var parts = [];
    var dropped = [];
    PP_BUILDER.forEach(function (f) {
      var p = perms && perms[f.id];
      if (!p || !p.mode) return;
      if (p.mode === 'none') parts.push(f.id + '=()');
      else if (p.mode === 'self') parts.push(f.id + '=(self)');
      else if (p.mode === 'all') parts.push(f.id + '=*');
      else if (p.mode === 'origins') {
        var list = [];
        splitAsciiWs(String(p.origins || '').replace(/,/g, ' ')).forEach(function (o) {
          var origin = toOrigin(o);
          if (origin && list.indexOf(origin) === -1) list.push(origin);
          else if (!origin) dropped.push(o);
        });
        parts.push(f.id + '=(self' + list.map(function (o) { return ' "' + o + '"'; }).join('') + ')');
      }
    });
    return { value: parts.join(', '), dropped: dropped };
  }

  function resolveXfo(state) {
    if (state.xfo !== 'auto') return state.xfo;
    if (!state.csp.enabled || state.csp.reportOnly) return 'SAMEORIGIN';
    var fa = splitSources(state.csp.directives['frame-ancestors']).map(function (x) { return x.toLowerCase(); });
    if (!fa.length) return 'SAMEORIGIN';
    if (fa.length === 1 && fa[0] === '\'none\'') return 'DENY';
    if (fa.length === 1 && fa[0] === '\'self\'') return 'SAMEORIGIN';
    return '';
  }

  // Builder state -> ordered header list plus notes about what was dropped
  function buildHeaders(state) {
    var headers = [];
    var notes = [];
    var reporting = null;
    if (state.reporting && state.reporting.url) {
      reporting = { url: state.reporting.url.trim(), name: validEndpointName(state.reporting.name) ? state.reporting.name : '' };
      if (state.reporting.name && !reporting.name) {
        notes.push(msg('warn', 'Endpoint name ' + q(state.reporting.name) + ' is not valid (lowercase letters, digits, "-", "_", "." only), so only `report-uri` is used.'));
      }
    }
    if (state.csp.enabled) {
      var value = buildCspValue(state.csp, reporting);
      if (value) headers.push({ name: state.csp.reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', value: value });
      else notes.push(msg('info', 'The CSP is empty, so no Content-Security-Policy header is generated.'));
    }
    if (reporting && reporting.name && state.csp.enabled) {
      headers.push({ name: 'Reporting-Endpoints', value: reporting.name + '="' + reporting.url.replace(/["\\]/g, '') + '"' });
    }
    if (state.hsts.enabled) {
      headers.push({
        name: 'Strict-Transport-Security',
        value: 'max-age=' + state.hsts.maxAge + (state.hsts.includeSub ? '; includeSubDomains' : '') + (state.hsts.preload ? '; preload' : '')
      });
    }
    var xfo = resolveXfo(state);
    if (xfo) headers.push({ name: 'X-Frame-Options', value: xfo });
    else if (state.xfo === 'auto') notes.push(msg('info', 'X-Frame-Options is left out because it cannot express the host list in frame-ancestors.'));
    if (state.xcto) headers.push({ name: 'X-Content-Type-Options', value: 'nosniff' });
    if (state.referrer) headers.push({ name: 'Referrer-Policy', value: state.referrer });
    var pp = permissionsValue(state.permissions);
    if (pp.value) headers.push({ name: 'Permissions-Policy', value: pp.value });
    pp.dropped.forEach(function (o) {
      notes.push(msg('warn', q(o) + ' is not a valid origin (use https://host), so it was left out of Permissions-Policy.'));
    });
    if (state.coop) headers.push({ name: 'Cross-Origin-Opener-Policy', value: state.coop });
    if (state.coep) headers.push({ name: 'Cross-Origin-Embedder-Policy', value: state.coep });
    if (state.corp) headers.push({ name: 'Cross-Origin-Resource-Policy', value: state.corp });
    if (state.xxss) headers.push({ name: 'X-XSS-Protection', value: '0' });
    return { headers: headers, notes: notes };
  }

  // ── Config formats ──────────────────────────────────────

  var FORMATS = {
    http: { label: 'HTTP headers', file: 'security-headers.txt' },
    nginx: { label: 'Nginx', file: 'security-headers.conf' },
    apache: { label: 'Apache (.htaccess / vhost)', file: 'security-headers.conf' },
    caddy: { label: 'Caddy', file: 'security-headers.caddy' },
    traefik: { label: 'Traefik (Docker labels)', file: 'traefik-labels.yml' },
    traefikfile: { label: 'Traefik (file provider)', file: 'security-headers.yml' },
    headersfile: { label: 'Netlify / Cloudflare Pages _headers', file: '_headers' },
    meta: { label: 'HTML <meta> tag', file: 'csp-meta.html' },
    wordpress: { label: 'WordPress / PHP', file: 'security-headers.php' },
    iis: { label: 'IIS web.config', file: 'web.config' }
  };

  function dq(value, extra) {
    var v = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    if (extra) v = extra(v);
    return '"' + v + '"';
  }

  // Built from pieces: the tool is embedded inside an HTML comment on WordPress,
  // so its source must never contain the comment delimiters literally
  function htmlComment(text) {
    return '<' + '!-- ' + text + ' --' + '>';
  }

  function xmlAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Drop directives that a <meta> policy cannot carry
  function metaPolicy(value) {
    var dropped = [];
    var kept = [];
    parsePolicy(value).directives.forEach(function (d) {
      if (DIRECTIVES[d.name] && DIRECTIVES[d.name].notInMeta) dropped.push(d.name);
      else kept.push(d.name + (d.values.length ? ' ' + d.values.join(' ') : ''));
    });
    return { value: kept.join('; '), dropped: dropped };
  }

  // Render the header list for one server. Returns { text, notes }.
  function formatConfig(format, built, state) {
    var headers = built.headers;
    var hide = !!(state && state.hideServer);
    var notes = [];
    var lines = [];
    var hasNonce = headers.some(function (h) { return /^content-security-policy/i.test(h.name) && /'nonce-/i.test(h.value); });
    var dollar = headers.some(function (h) { return h.value.indexOf('$') !== -1; });

    switch (format) {
      case 'nginx':
        lines.push('# Security headers: put these in the server { } block.');
        lines.push('# A location { } with its own add_header drops the inherited ones:');
        lines.push('# repeat these lines there (nginx 1.29.3+: add_header_inherit merge;).');
        headers.forEach(function (h) { lines.push('add_header ' + h.name + ' ' + dq(h.value) + ' always;'); });
        if (hide) {
          lines.push('', '# Hide version details', 'server_tokens off;',
            'proxy_hide_header X-Powered-By;    # when proxying to an app',
            'fastcgi_hide_header X-Powered-By;  # when running PHP-FPM');
        }
        if (dollar) notes.push(msg('warn', 'Nginx treats `$` as the start of a variable; replace it or the value changes.'));
        break;
      case 'apache':
        lines.push('# Security headers: vhost config, or .htaccess with AllowOverride FileInfo.');
        lines.push('<IfModule mod_headers.c>');
        headers.forEach(function (h) {
          lines.push('    Header always set ' + h.name + ' ' + dq(h.value, function (v) { return v.replace(/%/g, '%%'); }));
        });
        if (hide) lines.push('    Header always unset X-Powered-By', '    Header unset X-Powered-By');
        lines.push('</IfModule>');
        if (hide) {
          lines.push('', '# Hide the version in the Server header (main server config, not .htaccess):',
            '# ServerTokens Prod', '# ServerSignature Off');
        }
        break;
      case 'caddy':
        lines.push('# Security headers: inside your site block, e.g. example.com { ... }');
        lines.push('header {');
        headers.forEach(function (h) { lines.push('\t' + h.name + ' ' + '"' + h.value.replace(/"/g, '\\"') + '"'); });
        if (hide) lines.push('\t-Server', '\t-X-Powered-By');
        lines.push('}');
        if (headers.some(function (h) { return /[{}]/.test(h.value); })) {
          notes.push(msg('warn', 'Caddy reads `{…}` as a placeholder. Replace `{RANDOM}` with a real per-response nonce before using this.'));
        }
        break;
      case 'traefik':
        lines.push('# Traefik v2/v3: labels on the service in docker-compose.yml');
        lines.push('labels:');
        headers.forEach(function (h) {
          lines.push('  - ' + dq('traefik.http.middlewares.security-headers.headers.customresponseheaders.' + h.name + '=' + h.value,
            function (v) { return v.replace(/\$/g, '$$$$'); }));
        });
        if (hide) {
          ['Server', 'X-Powered-By'].forEach(function (n) {
            lines.push('  - "traefik.http.middlewares.security-headers.headers.customresponseheaders.' + n + '="');
          });
        }
        lines.push('  # Attach the middleware to your router (rename "myapp"):');
        lines.push('  - "traefik.http.routers.myapp.middlewares=security-headers"');
        break;
      case 'traefikfile':
        lines.push('# Traefik v2/v3 dynamic configuration (file provider)');
        lines.push('http:', '  middlewares:', '    security-headers:', '      headers:', '        customResponseHeaders:');
        headers.forEach(function (h) { lines.push('          ' + h.name + ': ' + dq(h.value)); });
        if (hide) lines.push('          Server: ""', '          X-Powered-By: ""');
        lines.push('# Attach it to a router: middlewares: ["security-headers@file"]');
        break;
      case 'headersfile':
        lines.push('# Netlify or Cloudflare Pages: save as _headers in the publish folder');
        lines.push('/*');
        headers.forEach(function (h) { lines.push('  ' + h.name + ': ' + h.value); });
        notes.push(msg('info', 'These rules cover static files; responses from serverless functions set their own headers.'));
        break;
      case 'meta':
        var cspHeader = headers.filter(function (h) { return h.name === 'Content-Security-Policy'; })[0];
        var ro = headers.filter(function (h) { return h.name === 'Content-Security-Policy-Report-Only'; })[0];
        var ref = headers.filter(function (h) { return h.name === 'Referrer-Policy'; })[0];
        lines.push(htmlComment('Put these at the top of <head>, before any script or stylesheet'));
        if (cspHeader) {
          var mp = metaPolicy(cspHeader.value);
          if (mp.value) lines.push('<meta http-equiv="Content-Security-Policy" content="' + xmlAttr(mp.value) + '">');
          if (mp.dropped.length) {
            notes.push(msg('warn', joinList(mp.dropped.map(q)) + (mp.dropped.length === 1 ? ' does' : ' do') + ' not work in <meta>, so ' +
              (mp.dropped.length === 1 ? 'it was' : 'they were') + ' left out. Send them as an HTTP header.'));
          }
        }
        if (ro) notes.push(msg('warn', 'Report-only policies cannot be delivered in <meta>. Use the HTTP header, or switch the CSP to enforce.'));
        if (ref) lines.push('<meta name="referrer" content="' + xmlAttr(ref.value) + '">');
        var rest = headers.filter(function (h) { return h !== cspHeader && h !== ref && h !== ro; });
        if (rest.length) {
          notes.push(msg('info', joinList(rest.map(function (h) { return q(h.name); })) + ' need' + (rest.length === 1 ? 's' : '') +
            ' a real HTTP header; <meta> cannot set ' + (rest.length === 1 ? 'it' : 'them') + '.'));
        }
        break;
      case 'wordpress':
        lines.push('// Security headers for WordPress: paste into your child theme\'s functions.php');
        lines.push('// or a code-snippets plugin (without an extra opening PHP tag).');
        lines.push('add_action(\'send_headers\', function () {');
        headers.forEach(function (h) {
          lines.push('    header(' + dq(h.name + ': ' + h.value, function (v) { return v.replace(/\$/g, '\\$'); }) + ');');
        });
        if (hide) lines.push('    header_remove(\'X-Powered-By\');');
        lines.push('});');
        notes.push(msg('info', '`send_headers` runs for front-end pages only; wp-admin and wp-login.php are not covered. Full-page caches that serve HTML without running PHP skip these headers too, so prefer the web-server config when you can.'));
        break;
      case 'iis':
        lines.push(htmlComment('web.config: merge into your existing <system.webServer>'));
        lines.push('<configuration>', '  <system.webServer>', '    <httpProtocol>', '      <customHeaders>');
        headers.forEach(function (h) { lines.push('        <add name="' + xmlAttr(h.name) + '" value="' + xmlAttr(h.value) + '" />'); });
        if (hide) lines.push('        <remove name="X-Powered-By" />');
        lines.push('      </customHeaders>', '    </httpProtocol>');
        if (hide) lines.push('    <security>', '      ' + htmlComment('IIS 10+'), '      <requestFiltering removeServerHeader="true" />', '    </security>');
        lines.push('  </system.webServer>', '</configuration>');
        notes.push(msg('info', 'If IIS reports a duplicate collection entry, a parent config already sets that header: add <remove name="…" /> before the <add>.'));
        break;
      default:
        headers.forEach(function (h) { lines.push(h.name + ': ' + h.value); });
        if (hide) notes.push(msg('info', 'Hiding Server and X-Powered-By needs server configuration; pick your server above to see how.'));
    }

    if (hasNonce && format !== 'http' && format !== 'meta' && format !== 'wordpress') {
      notes.push(msg('warn', 'A nonce must be generated by the application that renders the HTML: the header and every <script nonce> need the same fresh value on each response. A static server config cannot do that on its own.'));
    }
    if (hide && format === 'headersfile') {
      notes.push(msg('info', 'Cloudflare Pages can remove a header with a `! X-Powered-By` line under the path; Netlify cannot.'));
    }
    return { text: lines.join('\n') + (lines.length ? '\n' : ''), notes: notes };
  }

  // ── Analyzer -> builder import ──────────────────────────

  function importHeaders(headers, base) {
    var state = base ? JSON.parse(JSON.stringify(base)) : defaultState();
    var map = groupHeaders(headers);
    var skipped = [];
    var cspValues = valuesOf(map, 'content-security-policy');
    var roValues = valuesOf(map, 'content-security-policy-report-only');
    var source = cspValues.length ? cspValues : roValues;
    state.csp.services = {};
    if (source.length) {
      var policy = parseCspList(source[0]).filter(function (p) { return p.directives.length; })[0] || parsePolicy('');
      state.csp.enabled = true;
      state.csp.reportOnly = !cspValues.length;
      state.csp.directives = presetDirectives('blank');
      state.csp.upgrade = false;
      state.reporting = { url: '', name: '' };
      policy.directives.forEach(function (d) {
        if (BUILDER_DIRECTIVES.indexOf(d.name) !== -1) {
          state.csp.directives[d.name] = d.values.join(' ');
        } else if (d.name === 'upgrade-insecure-requests') {
          state.csp.upgrade = true;
        } else if (d.name === 'report-uri' && d.values.length) {
          state.reporting.url = d.values[0];
        } else if (d.name === 'report-to' && d.values.length) {
          state.reporting.name = d.values[0];
        } else {
          skipped.push(d.name);
        }
      });
      var ends = reportingEndpoints(map).names;
      if (state.reporting.name && ends[state.reporting.name] && !state.reporting.url) state.reporting.url = ends[state.reporting.name];
      // The builder writes report-to only together with a report URL
      if (state.reporting.name && !state.reporting.url) skipped.push('report-to');
    } else {
      state.csp.enabled = false;
    }
    var hsts = valuesOf(map, 'strict-transport-security');
    if (hsts.length) {
      var h = parseHsts(hsts[0]);
      state.hsts = { enabled: h.valid, maxAge: h.maxAge === null ? ONE_YEAR : h.maxAge, includeSub: h.includeSub, preload: h.preload };
    } else {
      state.hsts.enabled = false;
    }
    var xfo = splitHeaderList(valuesOf(map, 'x-frame-options'))[0];
    xfo = xfo ? xfo.toUpperCase() : '';
    state.xfo = (xfo === 'DENY' || xfo === 'SAMEORIGIN') ? xfo : '';
    if (xfo && !state.xfo) skipped.push('X-Frame-Options ' + xfo.split(' ')[0]);
    var xcto = splitHeaderList(valuesOf(map, 'x-content-type-options'))[0];
    state.xcto = !!xcto && xcto.toLowerCase() === 'nosniff';
    var ref = '';
    splitHeaderList(valuesOf(map, 'referrer-policy')).forEach(function (t) {
      if (own(REFERRER_POLICIES, t.toLowerCase())) ref = t.toLowerCase();
    });
    state.referrer = ref;
    state.permissions = {};
    var pp = valuesOf(map, 'permissions-policy');
    if (pp.length) {
      var parsedPp = analyzePermissionsPolicy(pp.join(', '));
      if (!parsedPp.ok) skipped.push('Permissions-Policy (invalid)');
      parsedPp.features.forEach(function (f) {
        var known = PP_BUILDER.some(function (b) { return b.id === f.name; });
        if (!known || f.allow === 'invalid') {
          skipped.push(f.name);
          return;
        }
        if (f.allow === 'none') state.permissions[f.name] = { mode: 'none', origins: '' };
        else if (f.allow === 'all') state.permissions[f.name] = { mode: 'all', origins: '' };
        else if (f.origins.length) state.permissions[f.name] = { mode: 'origins', origins: f.origins.join(' ') };
        else state.permissions[f.name] = { mode: 'self', origins: '' };
      });
    }
    var coop = parseSfToken(valuesOf(map, 'cross-origin-opener-policy').join(', '), COOP_VALUES);
    state.coop = coop.ok ? coop.token : '';
    var coep = parseSfToken(valuesOf(map, 'cross-origin-embedder-policy').join(', '), COEP_VALUES);
    state.coep = coep.ok ? coep.token : '';
    var corp = String(valuesOf(map, 'cross-origin-resource-policy')[0] || '').trim();
    state.corp = own(CORP_VALUES, corp) ? corp : '';
    state.xxss = String(valuesOf(map, 'x-xss-protection')[0] || '').trim() === '0';
    return { state: state, skipped: skipped };
  }

  // ── Hashes & nonces ─────────────────────────────────────

  // The HTML parser turns CRLF and CR into LF before scripts reach the DOM
  function normalizeNewlines(text) {
    return String(text).replace(/\r\n?/g, '\n');
  }

  // Accept a whole script or style element, tags included
  function extractInline(text) {
    var m = /^\s*<(script|style)\b[^>]*>([\s\S]*)<\/\1\s*>\s*$/i.exec(String(text));
    return m ? { tag: m[1].toLowerCase(), content: m[2] } : null;
  }

  function cspHash(text, alg) {
    var algo = own(HASH_BYTES, alg) ? alg : 'sha256';
    var name = algo.replace('sha', 'SHA-');
    var data = new TextEncoder().encode(normalizeNewlines(text));
    return crypto.subtle.digest(name, data).then(function (buf) {
      return '\'' + algo + '-' + base64FromBytes(new Uint8Array(buf)) + '\'';
    });
  }

  function randomNonce() {
    var bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return base64FromBytes(bytes);
  }

  // ── UI: state & helpers ─────────────────────────────────

  var MAIN_DIRS = ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src',
    'media-src', 'object-src', 'worker-src', 'manifest-src', 'base-uri', 'form-action', 'frame-ancestors'];
  var MORE_DIRS = ['script-src-elem', 'script-src-attr', 'style-src-elem', 'style-src-attr', 'child-src',
    'require-trusted-types-for', 'trusted-types'];

  // Quick-add buttons per directive ("nonce" inserts the placeholder nonce)
  var DIR_CHIPS = {
    'default-src': ['\'self\'', '\'none\'', 'https:', 'data:'],
    'script-src': ['\'self\'', '\'none\'', 'nonce', '\'strict-dynamic\'', '\'unsafe-inline\'', '\'unsafe-eval\'', '\'wasm-unsafe-eval\''],
    'style-src': ['\'self\'', '\'none\'', 'nonce', '\'unsafe-inline\'', 'https:', 'data:'],
    'img-src': ['\'self\'', '\'none\'', 'data:', 'blob:', 'https:'],
    'font-src': ['\'self\'', '\'none\'', 'data:', 'https:'],
    'connect-src': ['\'self\'', '\'none\'', 'https:', 'wss:'],
    'frame-src': ['\'self\'', '\'none\'', 'https:'],
    'media-src': ['\'self\'', '\'none\'', 'blob:', 'data:', 'https:'],
    'object-src': ['\'none\'', '\'self\''],
    'worker-src': ['\'self\'', '\'none\'', 'blob:'],
    'manifest-src': ['\'self\'', '\'none\''],
    'base-uri': ['\'self\'', '\'none\''],
    'form-action': ['\'self\'', '\'none\''],
    'frame-ancestors': ['\'self\'', '\'none\''],
    'script-src-elem': ['\'self\'', '\'none\'', 'nonce', '\'strict-dynamic\'', '\'unsafe-inline\''],
    'script-src-attr': ['\'none\'', '\'unsafe-hashes\'', '\'unsafe-inline\''],
    'style-src-elem': ['\'self\'', '\'none\'', 'nonce', '\'unsafe-inline\''],
    'style-src-attr': ['\'none\'', '\'unsafe-hashes\'', '\'unsafe-inline\''],
    'child-src': ['\'self\'', '\'none\'', 'blob:'],
    'require-trusted-types-for': ['\'script\''],
    'trusted-types': ['\'none\'', '\'allow-duplicates\'']
  };

  var RISKY_CHIPS = ['\'unsafe-inline\'', '\'unsafe-eval\'', 'https:', 'data:'];

  var PERM_OPTIONS = [
    ['', 'Not set'],
    ['none', 'Block — ()'],
    ['self', 'Your site only — (self)'],
    ['origins', 'Your site + origins…'],
    ['all', 'Everyone — *']
  ];

  var REFERRER_OPTIONS = [
    ['strict-origin-when-cross-origin', 'strict-origin-when-cross-origin — recommended'],
    ['no-referrer', 'no-referrer'],
    ['same-origin', 'same-origin'],
    ['strict-origin', 'strict-origin'],
    ['origin-when-cross-origin', 'origin-when-cross-origin'],
    ['origin', 'origin'],
    ['no-referrer-when-downgrade', 'no-referrer-when-downgrade — leaks full URLs'],
    ['unsafe-url', 'unsafe-url — leaks full URLs everywhere'],
    ['', 'Don\'t send']
  ];

  var PRESET_LABELS = { starter: 'Starter', strict: 'Strict CSP (nonce)', compat: 'Compatible', api: 'API / JSON', blank: 'Blank' };
  var STATUS_LABEL = { good: 'Good', weak: 'Improve', bad: 'Unsafe', missing: 'Missing', invalid: 'Invalid', info: 'Info' };

  var state = defaultState();
  var ui = { mode: 'build', format: 'http', output: '', built: null, hash: '', analysis: null, responseIndex: -1 };
  var analyzeTimer = null;
  var hashSeq = 0;

  function showToast(text, isError) {
    var toast = $('csh-toast');
    toast.textContent = text;
    toast.classList.toggle('csh-toast--error', !!isError);
    toast.classList.add('csh-show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.classList.remove('csh-show'); }, 2200);
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

  function msgItemsHtml(list, withWhere) {
    var shown = list.slice(0, MAX_MESSAGES);
    var html = shown.map(function (m) {
      return '<li class="csh-msg csh-msg--' + m.level + '"><span class="csh-msg-head"><span class="csh-msg-level">' + LEVEL_LABEL[m.level] + '</span>' +
        (withWhere && m.where ? '<span class="csh-msg-where">' + escapeHtml(m.where) + '</span>' : '') + '</span>' +
        '<span class="csh-msg-text">' + richText(m.text) + '</span></li>';
    }).join('');
    if (list.length > shown.length) {
      html += '<li class="csh-msg csh-msg--info"><span class="csh-msg-text">' + (list.length - shown.length) + ' more messages not shown.</span></li>';
    }
    return html;
  }

  function gradeClass(grade) {
    return 'csh-grade--' + String(grade).charAt(0).toLowerCase();
  }

  function setSelect(sel, value, customLabel) {
    var found = Array.prototype.some.call(sel.options, function (o) { return o.value === value; });
    if (!found && customLabel) {
      var o = document.createElement('option');
      o.value = value;
      o.textContent = customLabel;
      sel.appendChild(o);
      found = true;
    }
    sel.value = found ? value : sel.options[0].value;
  }

  // The directives the user typed, as source lists (for fallback seeding)
  function userMap() {
    var map = {};
    BUILDER_DIRECTIVES.forEach(function (n) {
      var list = splitSources(state.csp.directives[n]);
      if (list.length) map[n] = list;
    });
    return map;
  }

  // ── UI: builder ─────────────────────────────────────────

  function dirRowHtml(name) {
    var def = DIRECTIVES[name];
    var fb = name === 'default-src' ? 'fallback for the others' : (def.fallback ? 'falls back to ' + def.fallback[0] : 'no fallback');
    var scriptish = def.kind === 'script' || name === 'default-src';
    var chips = (DIR_CHIPS[name] || []).map(function (tok) {
      var value = tok === 'nonce' ? NONCE_SOURCE : tok;
      var risky = scriptish && RISKY_CHIPS.indexOf(tok) !== -1;
      return '<button class="csh-tok' + (risky ? ' csh-tok--risky' : '') + '" type="button" data-dir="' + name + '" data-tok="' + escapeHtml(value) + '" aria-pressed="false"' +
        (tok === 'nonce' ? ' title="Adds ' + escapeHtml(NONCE_SOURCE) + ' — your server replaces {RANDOM} on every response"' : '') + '>' + escapeHtml(tok) + '</button>';
    }).join('');
    return '<div class="csh-dir" data-dir="' + name + '" id="csh-row-' + name + '">' +
      '<div class="csh-dir-head"><label class="csh-dir-name" for="csh-d-' + name + '">' + name + '</label>' +
      '<span class="csh-dir-fb">' + escapeHtml(fb) + '</span></div>' +
      '<p class="csh-dir-about">' + escapeHtml(def.about) + '</p>' +
      '<input class="csh-input csh-input--mono" id="csh-d-' + name + '" data-dir="' + name + '" type="text" placeholder="' +
      escapeHtml(def.fallback ? 'not set — uses ' + def.fallback[0] : 'not set') + '" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">' +
      (chips ? '<div class="csh-toks">' + chips + '</div>' : '') +
      '<p class="csh-dir-svc csh-hidden" id="csh-svc-' + name + '"></p>' +
      '</div>';
  }

  function renderServices() {
    $('csh-services').innerHTML = SERVICES.map(function (s) {
      return '<label class="csh-svc"><input class="csh-checkbox" type="checkbox" data-svc="' + s.id + '"' +
        (state.csp.services[s.id] ? ' checked' : '') + '><span>' + escapeHtml(s.label) + '</span></label>';
    }).join('');
  }

  function renderPerms() {
    $('csh-perms').innerHTML = PP_BUILDER.map(function (f) {
      var p = state.permissions[f.id] || {};
      var mode = p.mode || '';
      return '<div class="csh-perm' + (mode ? ' csh-set' : '') + '" id="csh-prow-' + f.id + '">' +
        '<label class="csh-perm-label" for="csh-p-' + f.id + '"><span class="csh-perm-name">' + f.id + '</span>' +
        '<span class="csh-perm-about">' + escapeHtml(f.about) + '</span></label>' +
        '<select class="csh-select csh-select--sm" id="csh-p-' + f.id + '" data-perm="' + f.id + '">' +
        PERM_OPTIONS.map(function (o) {
          return '<option value="' + o[0] + '"' + (o[0] === mode ? ' selected' : '') + '>' + escapeHtml(o[1]) + '</option>';
        }).join('') + '</select>' +
        '<input class="csh-input csh-input--mono csh-input--sm' + (mode === 'origins' ? '' : ' csh-hidden') + '" id="csh-po-' + f.id +
        '" data-perm-origins="' + f.id + '" type="text" placeholder="https://maps.example.com" aria-label="Allowed origins for ' + f.id +
        '" value="' + escapeHtml(p.origins || '') + '" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">' +
        '</div>';
    }).join('');
  }

  function showMore(open) {
    $('csh-dirs-more').classList.toggle('csh-hidden', !open);
    $('csh-more-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
    $('csh-more-btn').textContent = open ? '− Fewer directives' : '+ More directives';
  }

  function toggleMore() {
    showMore($('csh-dirs-more').classList.contains('csh-hidden'));
  }

  // Push the state into every control (after a preset or an import)
  function syncInputs() {
    BUILDER_DIRECTIVES.forEach(function (n) {
      var el = $('csh-d-' + n);
      if (el) el.value = state.csp.directives[n] || '';
    });
    $('csh-csp-on').checked = state.csp.enabled;
    Array.prototype.forEach.call(document.querySelectorAll('input[name="csh-csp-mode"]'), function (r) {
      r.checked = (r.value === 'report') === !!state.csp.reportOnly;
    });
    $('csh-upgrade').checked = !!state.csp.upgrade;
    $('csh-report-url').value = state.reporting.url || '';
    $('csh-report-name').value = state.reporting.name || '';
    $('csh-hsts-on').checked = state.hsts.enabled;
    setSelect($('csh-hsts-age'), String(state.hsts.maxAge), formatDuration(state.hsts.maxAge) + ' (imported)');
    $('csh-hsts-sub').checked = state.hsts.includeSub;
    $('csh-hsts-preload').checked = state.hsts.preload;
    setSelect($('csh-xfo'), state.xfo);
    setSelect($('csh-referrer'), state.referrer);
    $('csh-xcto').checked = state.xcto;
    setSelect($('csh-coop'), state.coop);
    setSelect($('csh-coep'), state.coep);
    setSelect($('csh-corp'), state.corp);
    $('csh-xxss').checked = state.xxss;
    $('csh-hide').checked = state.hideServer;
    renderServices();
    renderPerms();
    if (MORE_DIRS.some(function (n) { return state.csp.directives[n]; })) showMore(true);
  }

  function updateDirStates(built) {
    var extra = serviceSources(state.csp.services);
    var cspHeader = built.headers.filter(function (h) { return /^Content-Security-Policy/.test(h.name); })[0];
    var finalPolicy = parsePolicy(cspHeader ? cspHeader.value : '');
    BUILDER_DIRECTIVES.forEach(function (name) {
      var row = $('csh-row-' + name);
      if (!row) return;
      var list = splitSources(state.csp.directives[name]);
      row.classList.toggle('csh-set', list.length > 0);
      Array.prototype.forEach.call(row.querySelectorAll('.csh-tok'), function (b) {
        var tok = b.getAttribute('data-tok');
        b.setAttribute('aria-pressed', list.some(function (x) { return sameSource(x, tok); }) ? 'true' : 'false');
      });
      var added = extra[name] || [];
      if (name === 'script-src-elem' && list.length && extra['script-src']) added = mergeSources(added, extra['script-src']);
      if (name === 'style-src-elem' && list.length && extra['style-src']) added = mergeSources(added, extra['style-src']);
      var svc = $('csh-svc-' + name);
      if (!added.length || !state.csp.enabled) {
        svc.classList.add('csh-hidden');
        return;
      }
      svc.classList.remove('csh-hidden');
      svc.textContent = finalPolicy.byName[name] ? '+ from services: ' + added.join(' ') :
        'Services need ' + added.join(' ') + ' here, but nothing restricts ' + name + ', so they are already allowed.';
    });
  }

  function updateServiceNotes() {
    $('csh-service-notes').innerHTML = SERVICES.filter(function (s) { return state.csp.services[s.id] && s.note; }).map(function (s) {
      return '<li class="csh-service-note"><strong>' + escapeHtml(s.label) + ':</strong> ' + escapeHtml(s.note) + '</li>';
    }).join('');
  }

  function updateBuilder() {
    var built = buildHeaders(state);
    var fmt = formatConfig(ui.format, built, state);
    ui.built = built;
    ui.output = built.headers.length || state.hideServer ? fmt.text : '';
    $('csh-output').value = ui.output;
    $('csh-out-count').textContent = plural(built.headers.length, 'header');
    $('csh-format-notes').innerHTML = msgItemsHtml(built.notes.concat(fmt.notes), false);

    var a = analyzeHeaders(built.headers, { origin: 'builder' });
    var score = $('csh-build-score');
    score.textContent = a.score + '/100 · ' + a.grade;
    score.className = 'csh-score ' + gradeClass(a.grade);
    var list = [];
    a.sections.forEach(function (s) {
      s.messages.forEach(function (m) { list.push({ level: m.level, text: m.text, where: s.title }); });
    });
    $('csh-build-checks').innerHTML = msgItemsHtml(sortMessages(list), true);

    ['csh-hsts-age', 'csh-hsts-sub', 'csh-hsts-preload'].forEach(function (id) { $(id).disabled = !state.hsts.enabled; });
    updateDirStates(built);
    updateServiceNotes();
  }

  function toggleToken(dir, tok) {
    var list = splitSources(state.csp.directives[dir]);
    var idx = -1;
    list.forEach(function (x, i) { if (sameSource(x, tok)) idx = i; });
    if (idx !== -1) {
      list.splice(idx, 1);
    } else if (tok.toLowerCase() === '\'none\'') {
      list = [tok];
    } else {
      // Adding to an empty directive starts from what it inherited
      if (!list.length) list = seedFromFallback(userMap(), dir) || [];
      list = list.filter(function (x) { return x.toLowerCase() !== '\'none\''; });
      list.push(tok);
    }
    state.csp.directives[dir] = list.join(' ');
    $('csh-d-' + dir).value = state.csp.directives[dir];
    updateBuilder();
  }

  function applyPreset(name) {
    if (!own(PRESETS, name)) return;
    state.csp.directives = presetDirectives(name);
    state.csp.upgrade = PRESETS[name].upgrade;
    state.csp.enabled = true;
    syncInputs();
    updateBuilder();
    showToast('Preset applied: ' + PRESET_LABELS[name]);
  }

  function permBlock() {
    PP_BLOCK_SET.forEach(function (id) { state.permissions[id] = { mode: 'none', origins: '' }; });
    renderPerms();
    updateBuilder();
  }

  function permClear() {
    state.permissions = {};
    renderPerms();
    updateBuilder();
  }

  // ── UI: hash helper ─────────────────────────────────────

  function updateHash() {
    var raw = $('csh-hash-input').value;
    var inline = extractInline(raw);
    var note = $('csh-hash-note');
    var out = $('csh-hash-value');
    ui.hash = '';
    hashSeq++;
    if (!raw) {
      out.textContent = '—';
      note.textContent = '';
      return;
    }
    if (inline && $('csh-hash-target').value !== 'attr') $('csh-hash-target').value = inline.tag;
    note.textContent = inline ? 'Hashing the text inside <' + inline.tag + '>, without the tags.' : '';
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      out.textContent = 'Hashing needs the Web Crypto API, which browsers only offer on HTTPS pages and localhost.';
      return;
    }
    var seq = hashSeq;
    cspHash(inline ? inline.content : raw, $('csh-hash-alg').value).then(function (h) {
      if (seq !== hashSeq) return;
      ui.hash = h;
      out.textContent = h;
    }).catch(function () {
      if (seq === hashSeq) out.textContent = 'This browser could not compute the hash.';
    });
  }

  function addHash() {
    if (!ui.hash) {
      showToast('Paste a script or style first', true);
      return;
    }
    var target = $('csh-hash-target').value;
    var dir = target === 'style' ? 'style-src' : 'script-src';
    var list = splitSources(state.csp.directives[dir]);
    if (!list.length) list = seedFromFallback(userMap(), dir) || [];
    list = list.filter(function (x) { return x.toLowerCase() !== '\'none\''; });
    if (!list.some(function (x) { return sameSource(x, ui.hash); })) list.push(ui.hash);
    if (target === 'attr' && !list.some(function (x) { return sameSource(x, '\'unsafe-hashes\''); })) list.push('\'unsafe-hashes\'');
    state.csp.directives[dir] = list.join(' ');
    $('csh-d-' + dir).value = state.csp.directives[dir];
    updateBuilder();
    showToast('Hash added to ' + dir);
  }

  // ── UI: analyzer ────────────────────────────────────────

  function srcClass(v, dirName) {
    var def = DIRECTIVES[dirName];
    if (!def || def.value) return 'plain';
    var scriptish = def.kind === 'script' || dirName === 'default-src';
    var c = classifySource(v);
    if (c.kind === 'invalid') return 'invalid';
    if (c.kind === 'nonce' || c.kind === 'hash') return (c.valid && !c.wrongLength) || c.placeholder ? 'trust' : 'invalid';
    if (c.kind === 'wildcard') return scriptish ? 'risky' : 'scheme';
    if (c.kind === 'keyword') return /unsafe/.test(c.keyword) && scriptish ? 'risky' : 'keyword';
    if (c.kind === 'scheme') return scriptish && (c.scheme === 'https' || c.scheme === 'http' || c.scheme === 'data') ? 'risky' : 'scheme';
    return 'host';
  }

  function policyHtml(an) {
    var multi = an.policies.length > 1;
    return an.policies.slice(0, 10).map(function (p, i) {
      var rows = p.directives.map(function (d) {
        var known = own(DIRECTIVES, d.name);
        var cls = known ? '' : (own(OBSOLETE_DIRECTIVES, d.name) ? ' csh-pdir--old' : ' csh-pdir--bad');
        var srcs = d.values.slice(0, 60).map(function (v) {
          return '<span class="csh-src csh-src--' + srcClass(v, d.name) + '">' + escapeHtml(truncate(v, 90)) + '</span>';
        }).join('');
        return '<div class="csh-prow"><code class="csh-pdir' + cls + '"' + (known ? ' title="' + escapeHtml(DIRECTIVES[d.name].about) + '"' : '') + '>' +
          escapeHtml(truncate(d.rawName, 40)) + '</code><div class="csh-psrcs">' +
          (srcs || '<span class="csh-src csh-src--empty">(no value)</span>') + '</div></div>';
      }).join('');
      return '<div class="csh-policy">' + (multi ? '<div class="csh-policy-num">Policy ' + (i + 1) + '</div>' : '') + rows + '</div>';
    }).join('');
  }

  function sectionHtml(s, showPoints) {
    var body = '';
    if (s.analysis) {
      body = policyHtml(s.analysis);
    } else if (s.values.length) {
      body = '<div class="csh-sec-values">' + s.values.slice(0, 30).map(function (v) {
        return '<code class="csh-sec-value">' + escapeHtml(truncate(v, 800)) + '</code>';
      }).join('') + '</div>';
    }
    var points = '';
    if (showPoints && s.max) points = '<span class="csh-sec-points">' + s.points + '/' + s.max + '</span>';
    else if (showPoints && s.points < 0) points = '<span class="csh-sec-points">' + s.points + '</span>';
    return '<li class="csh-sec csh-sec--' + s.status + '">' +
      '<div class="csh-sec-head"><span class="csh-sec-status">' + STATUS_LABEL[s.status] + '</span>' +
      '<h3 class="csh-sec-title">' + escapeHtml(s.title) + '</h3>' + points + '</div>' +
      body +
      (s.messages.length ? '<ul class="csh-messages">' + msgItemsHtml(s.messages, false) + '</ul>' : '') +
      (s.fix ? '<p class="csh-sec-fix">Suggested: <code class="csh-code">' + escapeHtml(s.fix) + '</code></p>' : '') +
      '</li>';
  }

  function chip(cls, text) {
    return '<span class="csh-chip csh-chip--' + cls + '">' + escapeHtml(text) + '</span>';
  }

  function summaryChips(c) {
    var out = [];
    if (c.error) out.push(chip('error', c.error + ' invalid'));
    if (c.bad) out.push(chip('error', c.bad + ' unsafe'));
    if (c.warn) out.push(chip('warn', plural(c.warn, 'warning')));
    if (c.info) out.push(chip('info', plural(c.info, 'note')));
    if (c.ok) out.push(chip('ok', c.ok + ' good'));
    return out.join('');
  }

  var META_RO_MSG = 'Content-Security-Policy-Report-Only is ignored in a <meta> tag; send it as an HTTP header.';

  // Sections to show: a full header report, or one CSP section for a bare policy
  function reportSections(r) {
    if (!r.policyOnly) return r.sections;
    var title = r.delivery === 'meta' ? 'Content-Security-Policy (<meta>)' : 'Content-Security-Policy';
    if (!r.csp) return [section('csp', title, { status: 'invalid', messages: [msg('error', META_RO_MSG)] })];
    var s = cspSection(r.csp, null);
    s.title = title;
    if (r.metaReportOnly) s.messages = [msg('error', META_RO_MSG)].concat(s.messages);
    return [s];
  }

  function renderReport(r) {
    var gradeRow = $('csh-grade-row');
    $('csh-to-builder').disabled = !r;
    $('csh-copy-report').disabled = !r;
    $('csh-report-empty').classList.toggle('csh-hidden', !!r);
    $('csh-score-note').classList.toggle('csh-hidden', !r || !!r.policyOnly);
    if (!r) {
      gradeRow.classList.add('csh-hidden');
      $('csh-sections').innerHTML = '';
      return;
    }
    if (r.policyOnly) {
      gradeRow.classList.add('csh-hidden');
    } else {
      gradeRow.classList.remove('csh-hidden');
      var g = $('csh-grade');
      g.textContent = r.grade;
      g.className = 'csh-grade ' + gradeClass(r.grade);
      $('csh-grade-score').textContent = 'Score ' + r.score + ' / 100 · ' + plural(r.headerCount, 'header') + ' read';
      $('csh-summary').innerHTML = summaryChips(r.counts);
    }
    $('csh-sections').innerHTML = reportSections(r).map(function (s) { return sectionHtml(s, !r.policyOnly); }).join('');
  }

  function updateAnalyzer() {
    var d = detectInput($('csh-input').value);
    var status = '';
    var result = null;
    $('csh-response-field').classList.add('csh-hidden');
    if (d.kind === 'headers') {
      var responses = d.parsed.responses.filter(function (r) { return r.headers.length; });
      var idx = ui.responseIndex >= 0 && ui.responseIndex < responses.length ? ui.responseIndex : responses.length - 1;
      var resp = responses[idx];
      result = analyzeHeaders(resp.headers, { origin: 'analyzer' });
      result.headers = resp.headers;
      var parts = ['Read ' + plural(resp.headers.length, 'header') + (d.parsed.format !== 'headers' ? ' from ' + d.parsed.format + ' output' : '')];
      if (resp.status) parts.push('HTTP ' + resp.status);
      if (responses.length > 1) {
        parts.push('response ' + (idx + 1) + ' of ' + responses.length);
        $('csh-response').innerHTML = responses.map(function (r, i) {
          return '<option value="' + i + '"' + (i === idx ? ' selected' : '') + '>' + (i + 1) + ' · ' +
            (r.status ? 'HTTP ' + r.status + (r.reason ? ' ' + escapeHtml(truncate(r.reason, 30)) : '') : 'headers') +
            ' · ' + plural(r.headers.length, 'header') + '</option>';
        }).join('');
        $('csh-response-field').classList.remove('csh-hidden');
      }
      status = parts.join(' · ') + '.';
      if (resp.status >= 300 && resp.status < 400) status += ' This is a redirect; the final page usually sends more headers.';
      if (d.parsed.skipped.length) {
        status += ' Skipped line' + (d.parsed.skipped.length > 1 ? 's ' : ' ') + d.parsed.skipped.slice(0, 6).join(', ') +
          (d.parsed.skipped.length > 6 ? '…' : '') + ' (not headers).';
      }
      if (d.parsed.bodyLines) status += ' Ignored ' + plural(d.parsed.bodyLines, 'line') + ' of response body.';
    } else if (d.kind === 'policy') {
      var pa = analyzePolicyOnly(d.value);
      pa.values = [d.value];
      result = { policyOnly: true, csp: pa, value: d.value, delivery: 'header' };
      status = 'Read a bare Content-Security-Policy value' + (d.colons ? ' — directives never take a colon, see the errors' : '') + '.';
    } else if (d.kind === 'meta') {
      var enforced = d.metas.filter(function (m) { return !m.reportOnly; }).map(function (m) { return m.value; });
      var ma = null;
      if (enforced.length) {
        ma = analyzeCsp(enforced, { origin: 'analyzer', delivery: 'meta', disposition: 'enforce', standalone: true, endpoints: null });
        ma.values = enforced;
      }
      result = { policyOnly: true, csp: ma, value: enforced.join(', '), delivery: 'meta', metaReportOnly: d.metas.length - enforced.length };
      status = 'Read ' + plural(d.metas.length, '<meta> policy', '<meta> policies') + '.';
    } else if (d.kind === 'unknown') {
      status = 'No headers or CSP found. Paste lines such as "Name: value", a policy such as default-src \'self\', or a <meta http-equiv> tag.';
    }
    if (d.truncated) status += ' Only the first 512 KB were read.';
    $('csh-input-status').textContent = status;
    ui.analysis = result;
    renderReport(result);
  }

  function scheduleAnalyze() {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(updateAnalyzer, 150);
  }

  function reportText() {
    var r = ui.analysis;
    if (!r) return '';
    var lines = [r.policyOnly ? 'CSP check' : 'Security headers report — score ' + r.score + '/100 (' + r.grade + ')'];
    reportSections(r).forEach(function (s) {
      lines.push('', '[' + STATUS_LABEL[s.status] + '] ' + s.title + (s.max && !r.policyOnly ? ' (' + s.points + '/' + s.max + ')' : ''));
      if (s.analysis) {
        s.analysis.policies.forEach(function (p) { lines.push('  ' + p.raw.trim()); });
      } else {
        s.values.forEach(function (v) { lines.push('  ' + v); });
      }
      s.messages.forEach(function (m) { lines.push('  - ' + LEVEL_LABEL[m.level] + ': ' + m.text); });
      if (s.fix) lines.push('  Suggested: ' + s.fix);
    });
    lines.push('', 'Checked with the CSP and HTTP Security Headers Builder — https://vahac.com/tools/');
    return lines.join('\n') + '\n';
  }

  function editInBuilder() {
    var r = ui.analysis;
    if (!r) return;
    var skipped;
    if (r.policyOnly) {
      if (!r.csp) {
        showToast('Nothing to import', true);
        return;
      }
      var imp = importHeaders([{ name: 'Content-Security-Policy', lname: 'content-security-policy', value: r.value }], state);
      state.csp = imp.state.csp;
      state.reporting = imp.state.reporting;
      skipped = imp.skipped;
    } else {
      var full = importHeaders(r.headers, state);
      state = full.state;
      skipped = full.skipped;
    }
    syncInputs();
    setMode('build');
    updateBuilder();
    showToast(skipped.length ? 'Imported. Left out: ' + truncate(skipped.join(', '), 70) : 'Imported into the builder');
  }

  function loadSample() {
    $('csh-input').value = SAMPLE_HEADERS;
    ui.responseIndex = -1;
    updateAnalyzer();
  }

  function clearInput() {
    $('csh-input').value = '';
    ui.responseIndex = -1;
    updateAnalyzer();
    $('csh-input').focus();
  }

  function sendToAnalyzer() {
    var built = ui.built || buildHeaders(state);
    if (!built.headers.length) {
      showToast('Nothing to analyze yet', true);
      return;
    }
    $('csh-input').value = built.headers.map(function (h) { return h.name + ': ' + h.value; }).join('\n');
    ui.responseIndex = -1;
    setMode('analyze');
    updateAnalyzer();
  }

  // ── Mode tabs ───────────────────────────────────────────

  function setMode(mode) {
    if (mode !== 'build' && mode !== 'analyze') return;
    ui.mode = mode;
    ['build', 'analyze'].forEach(function (m) {
      var on = m === mode;
      var tab = $('csh-mode-' + m);
      tab.classList.toggle('csh-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      $('csh-panel-' + m).classList.toggle('csh-hidden', !on);
    });
    try {
      history.replaceState(null, '', mode === 'analyze' ? '#analyzer' : location.pathname + location.search);
    } catch (e) { /* history can be unavailable in sandboxed frames */ }
  }

  // ── Init ────────────────────────────────────────────────

  function onChange(id, fn) {
    $(id).addEventListener('change', function (e) {
      fn(e.target);
      updateBuilder();
    });
  }

  function init() {
    $('csh-dirs').innerHTML = MAIN_DIRS.map(dirRowHtml).join('');
    $('csh-dirs-more').innerHTML = MORE_DIRS.map(dirRowHtml).join('');
    $('csh-format').innerHTML = Object.keys(FORMATS).map(function (f) {
      return '<option value="' + f + '">' + escapeHtml(FORMATS[f].label) + '</option>';
    }).join('');
    $('csh-referrer').innerHTML = REFERRER_OPTIONS.map(function (o) {
      return '<option value="' + o[0] + '">' + escapeHtml(o[1]) + '</option>';
    }).join('');
    $('csh-output').placeholder = 'Nothing to send yet — switch on at least one header.';

    ['csh-dirs', 'csh-dirs-more'].forEach(function (id) {
      var box = $(id);
      box.addEventListener('input', function (e) {
        var dir = e.target.getAttribute && e.target.getAttribute('data-dir');
        if (!dir || e.target.tagName !== 'INPUT') return;
        state.csp.directives[dir] = e.target.value;
        updateBuilder();
      });
      box.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.csh-tok') : null;
        if (btn) toggleToken(btn.getAttribute('data-dir'), btn.getAttribute('data-tok'));
      });
    });

    $('csh-services').addEventListener('change', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-svc');
      if (!id) return;
      if (e.target.checked) state.csp.services[id] = true;
      else delete state.csp.services[id];
      updateBuilder();
    });

    onChange('csh-csp-on', function (el) { state.csp.enabled = el.checked; });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="csh-csp-mode"]'), function (radio) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        state.csp.reportOnly = radio.value === 'report';
        updateBuilder();
      });
    });
    onChange('csh-upgrade', function (el) { state.csp.upgrade = el.checked; });
    $('csh-report-url').addEventListener('input', function (e) {
      state.reporting.url = e.target.value.trim();
      updateBuilder();
    });
    $('csh-report-name').addEventListener('input', function (e) {
      state.reporting.name = e.target.value.trim();
      updateBuilder();
    });

    onChange('csh-hsts-on', function (el) { state.hsts.enabled = el.checked; });
    onChange('csh-hsts-age', function (el) { state.hsts.maxAge = parseInt(el.value, 10); });
    onChange('csh-hsts-sub', function (el) { state.hsts.includeSub = el.checked; });
    onChange('csh-hsts-preload', function (el) { state.hsts.preload = el.checked; });
    onChange('csh-xfo', function (el) { state.xfo = el.value; });
    onChange('csh-referrer', function (el) { state.referrer = el.value; });
    onChange('csh-xcto', function (el) { state.xcto = el.checked; });
    onChange('csh-coop', function (el) { state.coop = el.value; });
    onChange('csh-coep', function (el) { state.coep = el.value; });
    onChange('csh-corp', function (el) { state.corp = el.value; });
    onChange('csh-xxss', function (el) { state.xxss = el.checked; });
    onChange('csh-hide', function (el) { state.hideServer = el.checked; });
    onChange('csh-format', function (el) { ui.format = el.value; });

    var perms = $('csh-perms');
    perms.addEventListener('change', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-perm');
      if (!id) return;
      var p = state.permissions[id] || { mode: '', origins: '' };
      p.mode = e.target.value;
      if (p.mode) state.permissions[id] = p;
      else delete state.permissions[id];
      $('csh-po-' + id).classList.toggle('csh-hidden', p.mode !== 'origins');
      $('csh-prow-' + id).classList.toggle('csh-set', !!p.mode);
      if (p.mode === 'origins') $('csh-po-' + id).focus();
      updateBuilder();
    });
    perms.addEventListener('input', function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-perm-origins');
      if (!id) return;
      var p = state.permissions[id] || { mode: 'origins', origins: '' };
      p.origins = e.target.value;
      state.permissions[id] = p;
      updateBuilder();
    });

    $('csh-hash-input').addEventListener('input', updateHash);
    $('csh-hash-alg').addEventListener('change', updateHash);

    $('csh-input').addEventListener('input', function () {
      ui.responseIndex = -1;
      scheduleAnalyze();
    });
    $('csh-response').addEventListener('change', function (e) {
      ui.responseIndex = parseInt(e.target.value, 10);
      updateAnalyzer();
    });

    // Arrow keys move between the mode tabs
    $('csh-modes').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var next = ui.mode === 'build' ? 'analyze' : 'build';
      setMode(next);
      $('csh-mode-' + next).focus();
      e.preventDefault();
    });

    try {
      $('csh-nonce-sample').textContent = randomNonce();
    } catch (e) {
      $('csh-nonce-sample').textContent = 'r4nd0mBase64Value22+ch';
    }

    syncInputs();
    updateBuilder();
    updateAnalyzer();
    if (location.hash === '#analyzer') setMode('analyze');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Expose global handlers for onclick attributes
  window.cshSetMode = setMode;
  window.cshPreset = applyPreset;
  window.cshToggleMore = toggleMore;
  window.cshAddHash = addHash;
  window.cshCopyHash = function () {
    if (ui.hash) copyText(ui.hash);
    else showToast('Paste a script or style first', true);
  };
  window.cshPermBlock = permBlock;
  window.cshPermClear = permClear;
  window.cshCopyOutput = function () {
    if (ui.output) copyText(ui.output);
    else showToast('Nothing to copy yet', true);
  };
  window.cshDownloadOutput = function () {
    if (ui.output) downloadText(ui.output, FORMATS[ui.format].file);
    else showToast('Nothing to download yet', true);
  };
  window.cshSendToAnalyzer = sendToAnalyzer;
  window.cshLoadSample = loadSample;
  window.cshClearInput = clearInput;
  window.cshEditInBuilder = editInBuilder;
  window.cshCopyReport = function () {
    var text = reportText();
    if (text) copyText(text);
  };

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parsePolicy: parsePolicy,
      parseCspList: parseCspList,
      classifySource: classifySource,
      summarize: summarize,
      analyzeCsp: analyzeCsp,
      analyzePolicyOnly: analyzePolicyOnly,
      sfParse: sfParse,
      parseHeaderBlock: parseHeaderBlock,
      extractMetaPolicies: extractMetaPolicies,
      detectInput: detectInput,
      parseHsts: parseHsts,
      analyzePermissionsPolicy: analyzePermissionsPolicy,
      parseSetCookie: parseSetCookie,
      analyzeHeaders: analyzeHeaders,
      defaultState: defaultState,
      presetDirectives: presetDirectives,
      buildCspValue: buildCspValue,
      buildHeaders: buildHeaders,
      permissionsValue: permissionsValue,
      formatConfig: formatConfig,
      importHeaders: importHeaders,
      normalizeNewlines: normalizeNewlines,
      extractInline: extractInline,
      cspHash: cspHash,
      randomNonce: randomNonce,
      suggestDirective: suggestDirective,
      gradeFor: gradeFor,
      DIRECTIVES: DIRECTIVES,
      SAMPLE_HEADERS: SAMPLE_HEADERS,
      SERVICES: SERVICES,
      PRESETS: PRESETS,
      FORMATS: FORMATS,
      PP_BUILDER: PP_BUILDER,
      BUILDER_DIRECTIVES: BUILDER_DIRECTIVES
    };
  }

})();
