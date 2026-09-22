/* ============================================================
   JWT Decoder — script.js
   Namespace prefix: jwt-
   Dependencies: none (Web Crypto API is used for optional
   signature verification, no external libraries).
   ============================================================ */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* Sample token — HS256, signed with the secret below. */
  var SAMPLE_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlZhc3lsIENoZXBpbCIsImFkbWluIjp0cnVlLCJpc3MiOiJodHRwczovL3ZhaGFjLmNvbSIsImF1ZCI6InZhaGFjLXRvb2xzIiwiaWF0IjoxNzU3NjY3NjAwLCJuYmYiOjE3NTc2Njc2MDAsImV4cCI6MjA1MTIyMjQwMCwianRpIjoiYTFiMmMzZDQifQ.3yf6EWGgDWKSNmoYDUKyLrsJSXX_SJvXctPdrrU5Q9w';
  var SAMPLE_SECRET = 'vahac-tools-demo-secret';

  /* ── Algorithm registry ── */
  var ALGORITHMS = {
    HS256: { label: 'HMAC with SHA-256',            kind: 'hmac',    hash: 'SHA-256' },
    HS384: { label: 'HMAC with SHA-384',            kind: 'hmac',    hash: 'SHA-384' },
    HS512: { label: 'HMAC with SHA-512',            kind: 'hmac',    hash: 'SHA-512' },
    RS256: { label: 'RSASSA-PKCS1-v1_5 + SHA-256',  kind: 'rsa',     hash: 'SHA-256' },
    RS384: { label: 'RSASSA-PKCS1-v1_5 + SHA-384',  kind: 'rsa',     hash: 'SHA-384' },
    RS512: { label: 'RSASSA-PKCS1-v1_5 + SHA-512',  kind: 'rsa',     hash: 'SHA-512' },
    PS256: { label: 'RSA-PSS + SHA-256',            kind: 'rsapss',  hash: 'SHA-256', saltLength: 32 },
    PS384: { label: 'RSA-PSS + SHA-384',            kind: 'rsapss',  hash: 'SHA-384', saltLength: 48 },
    PS512: { label: 'RSA-PSS + SHA-512',            kind: 'rsapss',  hash: 'SHA-512', saltLength: 64 },
    ES256: { label: 'ECDSA P-256 + SHA-256',        kind: 'ec',      hash: 'SHA-256', curve: 'P-256' },
    ES384: { label: 'ECDSA P-384 + SHA-384',        kind: 'ec',      hash: 'SHA-384', curve: 'P-384' },
    ES512: { label: 'ECDSA P-521 + SHA-512',        kind: 'ec',      hash: 'SHA-512', curve: 'P-521' },
    EdDSA: { label: 'EdDSA (Ed25519)',              kind: 'eddsa' },
    none:  { label: 'Unsecured — no signature',     kind: 'none' }
  };

  /* ── Claim dictionaries ── */
  var CLAIM_INFO = {
    iss: 'Issuer — who created the token',
    sub: 'Subject — who the token is about',
    aud: 'Audience — who the token is for',
    exp: 'Expiration time',
    nbf: 'Not valid before',
    iat: 'Issued at',
    jti: 'JWT ID — unique token identifier',
    azp: 'Authorized party',
    scope: 'Granted scopes',
    scp: 'Granted scopes',
    nonce: 'Replay-protection nonce',
    auth_time: 'Time of authentication',
    acr: 'Authentication context class',
    amr: 'Authentication methods used',
    at_hash: 'Access token hash',
    c_hash: 'Authorization code hash',
    sid: 'Session identifier',
    act: 'Actor — delegation chain',
    cnf: 'Confirmation key (proof of possession)',
    client_id: 'OAuth client identifier',
    token_use: 'Intended token use',
    ver: 'Token version',
    roles: 'Assigned roles',
    groups: 'Group membership',
    permissions: 'Granted permissions',
    email: 'Email address',
    email_verified: 'Email verification flag',
    name: 'Full name',
    preferred_username: 'Preferred username',
    given_name: 'Given name',
    family_name: 'Family name',
    picture: 'Profile picture URL',
    locale: 'Locale',
    updated_at: 'Profile last updated'
  };

  var HEADER_INFO = {
    alg: 'Signing algorithm',
    typ: 'Token type',
    kid: 'Key ID',
    cty: 'Content type',
    jku: 'JWK Set URL',
    jwk: 'Embedded public key',
    x5t: 'X.509 certificate thumbprint',
    x5u: 'X.509 certificate URL',
    x5c: 'X.509 certificate chain',
    crit: 'Critical extensions',
    enc: 'Content encryption algorithm',
    zip: 'Compression algorithm'
  };

  var TIME_CLAIMS = ['exp', 'nbf', 'iat', 'auth_time', 'updated_at'];
  var CLAIM_ORDER = ['iss', 'sub', 'aud', 'azp', 'exp', 'nbf', 'iat', 'auth_time', 'jti', 'scope', 'scp'];

  /* ============================================================
     Pure helpers
     ============================================================ */

  /* Decode a base64url segment into raw bytes. Throws on bad input. */
  function b64uToBytes(segment) {
    var seg = String(segment == null ? '' : segment);
    if (!/^[A-Za-z0-9_-]*$/.test(seg)) {
      throw new Error('it contains characters outside the base64url alphabet');
    }
    var b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    var rem = b64.length % 4;
    if (rem === 1) throw new Error('its length is not a valid base64url length');
    if (rem) b64 += new Array(5 - rem).join('=');
    return base64ToBytes(b64);
  }

  /* Decode standard base64 (padded or not, both alphabets) into bytes. */
  function base64ToBytes(b64) {
    var clean = String(b64 == null ? '' : b64).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    var rem = clean.length % 4;
    if (rem === 1) throw new Error('invalid base64 length');
    if (rem) clean += new Array(5 - rem).join('=');
    var binary;
    try {
      binary = atob(clean);
    } catch (e) {
      throw new Error('it is not valid base64');
    }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(out));
  }

  function utf8ToBytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(String(str));
    }
    var esc = unescape(encodeURIComponent(String(str)));
    var bytes = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) bytes[i] = esc.charCodeAt(i);
    return bytes;
  }

  /* Decode a base64url segment into a UTF-8 string. */
  function b64uDecode(segment) {
    return bytesToUtf8(b64uToBytes(segment));
  }

  /* Parse a token into its three segments and decoded JSON parts. */
  function parseJwt(token) {
    var res = {
      ok: false, error: '', warning: '',
      token: '', parts: [], signingInput: '', signature: '',
      header: null, payload: null,
      headerText: '', payloadText: '', payloadIsJson: false
    };

    var raw = String(token == null ? '' : token).trim();
    if (!raw) {
      res.error = 'Paste a token to get started.';
      return res;
    }

    // Tolerate an "Authorization: Bearer …" paste and stray whitespace/newlines.
    raw = raw.replace(/^authorization\s*:\s*/i, '').replace(/^bearer\s+/i, '').replace(/\s+/g, '');
    res.token = raw;

    var parts = raw.split('.');
    res.parts = parts;

    if (parts.length === 5) {
      res.error = 'This looks like a JWE (5 segments) — encrypted tokens cannot be decoded without the decryption key.';
      return res;
    }
    if (parts.length !== 3) {
      res.error = 'A JWT has 3 dot-separated segments (header.payload.signature) — this one has ' + parts.length + '.';
      return res;
    }
    if (!parts[0] || !parts[1]) {
      res.error = 'The header or payload segment is empty.';
      return res;
    }

    try {
      res.headerText = b64uDecode(parts[0]);
    } catch (e) {
      res.error = 'The header segment could not be decoded — ' + e.message + '.';
      return res;
    }
    try {
      res.header = JSON.parse(res.headerText);
    } catch (e) {
      res.error = 'The header decodes, but it is not valid JSON.';
      return res;
    }
    if (!res.header || typeof res.header !== 'object' || Array.isArray(res.header)) {
      res.error = 'The header must be a JSON object.';
      return res;
    }

    try {
      res.payloadText = b64uDecode(parts[1]);
    } catch (e) {
      res.error = 'The payload segment could not be decoded — ' + e.message + '.';
      return res;
    }
    try {
      var parsed = JSON.parse(res.payloadText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        res.payload = parsed;
        res.payloadIsJson = true;
      } else {
        res.warning = 'The payload is valid JSON but not an object — claims cannot be listed.';
      }
    } catch (e) {
      res.warning = 'The payload is not JSON — showing the decoded text as-is.';
    }

    res.signature = parts[2];
    res.signingInput = parts[0] + '.' + parts[1];

    if (!res.signature && res.header.alg !== 'none') {
      res.warning = 'The signature segment is empty, but the header declares alg "' + res.header.alg + '".';
    }

    res.ok = true;
    return res;
  }

  function algInfo(alg) {
    if (typeof alg !== 'string') return null;
    return Object.prototype.hasOwnProperty.call(ALGORITHMS, alg) ? ALGORITHMS[alg] : null;
  }

  /* Read a numeric date claim, normalising accidental milliseconds. */
  function epochSeconds(value) {
    var num = null;
    if (typeof value === 'number' && isFinite(value)) num = value;
    else if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) num = Number(value);
    if (num === null) return null;
    // Anything past year 5138 in seconds is almost certainly milliseconds.
    if (Math.abs(num) > 1e11) return { seconds: Math.floor(num / 1000), unit: 'ms' };
    return { seconds: Math.floor(num), unit: 's' };
  }

  function formatUtc(seconds) {
    var d = new Date(seconds * 1000);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  }

  var RELATIVE_UNITS = [
    { limit: 60,       div: 1,       name: 'second' },
    { limit: 3600,     div: 60,      name: 'minute' },
    { limit: 86400,    div: 3600,    name: 'hour' },
    { limit: 2592000,  div: 86400,   name: 'day' },
    { limit: 31536000, div: 2592000, name: 'month' },
    { limit: Infinity, div: 31536000, name: 'year' }
  ];

  /* Human phrase for a delta in seconds (positive = future). */
  function relativeTime(delta) {
    var d = Math.round(Number(delta) || 0);
    var abs = Math.abs(d);
    if (abs < 45) return d >= 0 ? 'in a few seconds' : 'a few seconds ago';
    for (var i = 0; i < RELATIVE_UNITS.length; i++) {
      var u = RELATIVE_UNITS[i];
      if (abs < u.limit) {
        var v = Math.round(abs / u.div);
        var text = v + ' ' + u.name + (v === 1 ? '' : 's');
        return d >= 0 ? 'in ' + text : text + ' ago';
      }
    }
    return '';
  }

  /* Validity of the token's time window at a given moment. */
  function tokenStatus(payload, nowSeconds) {
    var now = typeof nowSeconds === 'number' ? nowSeconds : Math.floor(Date.now() / 1000);
    if (!payload || typeof payload !== 'object') {
      return { state: 'unknown', label: 'Unknown', tone: 'warn', detail: 'No claims available' };
    }
    var exp = epochSeconds(payload.exp);
    var nbf = epochSeconds(payload.nbf);

    if (exp && now >= exp.seconds) {
      return {
        state: 'expired', label: 'Expired', tone: 'bad',
        seconds: now - exp.seconds,
        detail: 'Expired ' + relativeTime(exp.seconds - now)
      };
    }
    if (nbf && now < nbf.seconds) {
      return {
        state: 'not-yet-valid', label: 'Not valid yet', tone: 'warn',
        seconds: nbf.seconds - now,
        detail: 'Becomes valid ' + relativeTime(nbf.seconds - now)
      };
    }
    if (exp) {
      return {
        state: 'active', label: 'Valid', tone: 'good',
        seconds: exp.seconds - now,
        detail: 'Expires ' + relativeTime(exp.seconds - now)
      };
    }
    return { state: 'no-expiry', label: 'No expiry', tone: 'warn', detail: 'Token has no exp claim' };
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* Wrap JSON tokens in prefixed spans for syntax colouring. */
  function highlightJson(json) {
    var esc = escapeHtml(json);
    return esc.replace(
      /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      function (match) {
        var cls = 'jwt-json-num';
        if (match.charAt(0) === '"') {
          cls = /:\s*$/.test(match) ? 'jwt-json-key' : 'jwt-json-str';
        } else if (match === 'true' || match === 'false') {
          cls = 'jwt-json-bool';
        } else if (match === 'null') {
          cls = 'jwt-json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
  }

  /* Pretty-print a value for the claims list. */
  function claimValueText(value) {
    if (typeof value === 'string') return value;
    if (value === null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /* Order claims: well-known ones first, then everything else alphabetically. */
  function orderClaims(payload) {
    if (!payload || typeof payload !== 'object') return [];
    var keys = Object.keys(payload);
    var known = CLAIM_ORDER.filter(function (k) { return keys.indexOf(k) !== -1; });
    var rest = keys.filter(function (k) { return known.indexOf(k) === -1; }).sort();
    return known.concat(rest);
  }

  /* Guess what kind of key material was pasted into the key box. */
  function detectKeyFormat(text) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return 'empty';
    if (/-----BEGIN CERTIFICATE-----/.test(t)) return 'certificate';
    if (/-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(t)) return 'private';
    if (/-----BEGIN PUBLIC KEY-----/.test(t)) return 'spki';
    if (/-----BEGIN RSA PUBLIC KEY-----/.test(t)) return 'pkcs1';
    if (t.charAt(0) === '{') return 'jwk';
    return 'raw';
  }

  /* Strip the PEM armour and return the DER bytes. */
  function pemToBytes(pem) {
    var body = String(pem)
      .replace(/-----BEGIN [^-]+-----/, '')
      .replace(/-----END [^-]+-----/, '')
      .replace(/\s+/g, '');
    return base64ToBytes(body);
  }

  /* ============================================================
     DOM layer
     ============================================================ */

  var current = null; // last successful parse

  function showError(msg) {
    var el = $('jwt-error-msg');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('jwt-visible');
  }

  function hideError() {
    var el = $('jwt-error-msg');
    if (el) el.classList.remove('jwt-visible');
  }

  function showNote(msg) {
    var el = $('jwt-alg-note');
    if (!el) return;
    if (!msg) { el.classList.remove('jwt-visible'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.add('jwt-visible');
  }

  function showToast(text) {
    var toast = $('jwt-toast');
    if (!toast) return;
    if (text) toast.textContent = text;
    toast.classList.add('jwt-show');
    setTimeout(function () { toast.classList.remove('jwt-show'); }, 2000);
  }

  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast('✅ Copied!'); }).catch(fallback);
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
      showToast('✅ Copied!');
    }
  }

  function setHidden(id, hidden) {
    var el = $(id);
    if (!el) return;
    if (hidden) el.classList.add('jwt-hidden');
    else el.classList.remove('jwt-hidden');
  }

  function setBadge(id, tone) {
    var el = $(id);
    if (!el) return;
    el.classList.remove('jwt-badge--good', 'jwt-badge--warn', 'jwt-badge--bad');
    if (tone) el.classList.add('jwt-badge--' + tone);
  }

  function resetOutput() {
    ['jwt-map-block', 'jwt-header-block', 'jwt-payload-block',
      'jwt-claims-block', 'jwt-verify-block'].forEach(function (id) { setHidden(id, true); });
    setHidden('jwt-summary', true);
    showNote('');
    var vr = $('jwt-verify-result');
    if (vr) vr.classList.remove('jwt-visible');
    current = null;
  }

  function updateStats(raw, parts) {
    var el = $('jwt-token-stats');
    if (!el) return;
    var chars = raw.length;
    el.textContent = chars + ' character' + (chars === 1 ? '' : 's') + ' · ' +
      (chars ? parts + ' segment' + (parts === 1 ? '' : 's') : '0 segments');
  }

  function renderTokenMap(parts) {
    var el = $('jwt-token-map');
    if (!el) return;
    el.innerHTML =
      '<span class="jwt-part--header">' + escapeHtml(parts[0]) + '</span>' +
      '<span class="jwt-part--dot">.</span>' +
      '<span class="jwt-part--payload">' + escapeHtml(parts[1]) + '</span>' +
      '<span class="jwt-part--dot">.</span>' +
      '<span class="jwt-part--sig">' + escapeHtml(parts[2]) + '</span>';
  }

  function renderClaims(payload) {
    var box = $('jwt-claims');
    if (!box) return;
    var keys = orderClaims(payload);
    var now = Math.floor(Date.now() / 1000);
    var html = '';

    keys.forEach(function (key) {
      var value = payload[key];
      var desc = CLAIM_INFO[key] || '';
      var extra = '';

      if (TIME_CLAIMS.indexOf(key) !== -1) {
        var stamp = epochSeconds(value);
        if (stamp) {
          var tone = '';
          if (key === 'exp') tone = now >= stamp.seconds ? 'bad' : 'good';
          if (key === 'nbf' && now < stamp.seconds) tone = 'warn';
          extra = formatUtc(stamp.seconds) + ' · ' + relativeTime(stamp.seconds - now) +
            (stamp.unit === 'ms' ? ' · value looks like milliseconds, not seconds' : '');
          extra = '<span class="jwt-claim-extra' + (tone ? ' jwt-claim-extra--' + tone : '') + '">' +
            escapeHtml(extra) + '</span>';
        }
      }

      html += '<div class="jwt-claim-row">' +
        '<div><span class="jwt-claim-name">' + escapeHtml(key) + '</span>' +
        (desc ? '<span class="jwt-claim-desc">' + escapeHtml(desc) + '</span>' : '') + '</div>' +
        '<div class="jwt-claim-value">' + escapeHtml(claimValueText(value)) + extra + '</div>' +
        '</div>';
    });

    box.innerHTML = html;
  }

  /* One-line explanation of the recognised header fields. */
  function headerLegend(header) {
    if (!header || typeof header !== 'object') return '';
    var parts = Object.keys(header)
      .filter(function (k) { return HEADER_INFO[k]; })
      .map(function (k) {
        return '<code>' + escapeHtml(k) + '</code> — ' + escapeHtml(HEADER_INFO[k]);
      });
    return parts.join(' · ');
  }

  function updateKeyUi(alg) {
    var info = algInfo(alg);
    var label = $('jwt-key-label');
    var input = $('jwt-key-input');
    var hint = $('jwt-key-hint');
    var btn = $('jwt-verify-btn');
    var kind = info ? info.kind : null;

    setHidden('jwt-b64-toggle', kind !== 'hmac');
    if (btn) btn.disabled = (kind === 'none' || kind === null);

    if (!info) {
      if (label) label.textContent = 'Key';
      if (input) input.placeholder = '';
      if (hint) hint.textContent = 'Unknown algorithm — verification is not available.';
      return;
    }
    if (kind === 'none') {
      if (label) label.textContent = 'Key';
      if (input) input.placeholder = '';
      if (hint) hint.textContent = 'alg is "none": this token is unsigned, so there is nothing to verify.';
      return;
    }
    if (kind === 'hmac') {
      if (label) label.textContent = 'Shared secret';
      if (input) input.placeholder = 'your-256-bit-secret';
      if (hint) hint.textContent = 'HMAC uses one shared secret for signing and verifying. Tick the switch if yours is stored Base64-encoded.';
      return;
    }
    if (label) label.textContent = 'Public key';
    if (input) input.placeholder = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0…\n-----END PUBLIC KEY----- or a JWK { "kty": … }';
    if (hint) hint.textContent = 'Paste the issuer\'s public key as PEM (SPKI, "BEGIN PUBLIC KEY") or as a JWK JSON object.';
  }

  function decodeInput() {
    var raw = ($('jwt-token-input') ? $('jwt-token-input').value : '') || '';
    var trimmed = raw.trim();

    if (!trimmed) {
      hideError();
      resetOutput();
      updateStats('', 0);
      return;
    }

    var parsed = parseJwt(trimmed);
    updateStats(parsed.token || trimmed.replace(/\s+/g, ''), parsed.parts.length);

    if (!parsed.ok) {
      resetOutput();
      showError(parsed.error);
      return;
    }

    hideError();
    current = parsed;

    /* Token map */
    renderTokenMap(parsed.parts);
    setHidden('jwt-map-block', false);

    /* Badges */
    var alg = parsed.header.alg;
    var info = algInfo(alg);
    var algValue = $('jwt-badge-alg-value');
    if (algValue) algValue.textContent = (typeof alg === 'string' && alg) ? alg : 'missing';
    setBadge('jwt-badge-alg', alg === 'none' ? 'bad' : (info ? '' : 'warn'));

    var typeValue = $('jwt-badge-type-value');
    if (typeValue) typeValue.textContent = parsed.header.typ || '—';

    var status = tokenStatus(parsed.payload);
    var statusValue = $('jwt-badge-status-value');
    if (statusValue) statusValue.textContent = status.label;
    setBadge('jwt-badge-status', status.tone);
    var statusBadge = $('jwt-badge-status');
    if (statusBadge) statusBadge.title = status.detail || '';
    setHidden('jwt-summary', false);

    /* Notes */
    var note = '';
    if (alg === 'none') {
      note = '⚠ alg is "none" — this token is unsigned. Anyone can change its payload, so never trust it for authentication.';
    } else if (!info) {
      note = '⚠ Unrecognised algorithm "' + alg + '". The token still decodes, but the signature cannot be checked here.';
    } else if (status.state === 'expired') {
      note = '⏱ ' + status.detail + '. A server following the spec will reject this token.';
    } else if (parsed.warning) {
      note = '⚠ ' + parsed.warning;
    } else if (info) {
      note = 'ℹ ' + info.label + '. Decoding never checks the signature — use the verification box below for that.';
    }
    showNote(note);

    /* Header / payload JSON */
    var headerPretty = JSON.stringify(parsed.header, null, 2);
    var headerEl = $('jwt-header-json');
    if (headerEl) headerEl.innerHTML = highlightJson(headerPretty);
    var legendEl = $('jwt-header-legend');
    if (legendEl) legendEl.innerHTML = headerLegend(parsed.header);
    setHidden('jwt-header-block', false);

    var payloadPretty = parsed.payloadIsJson
      ? JSON.stringify(parsed.payload, null, 2)
      : parsed.payloadText;
    var payloadEl = $('jwt-payload-json');
    if (payloadEl) {
      payloadEl.innerHTML = parsed.payloadIsJson
        ? highlightJson(payloadPretty)
        : escapeHtml(payloadPretty);
    }
    setHidden('jwt-payload-block', false);

    /* Claims */
    if (parsed.payloadIsJson && Object.keys(parsed.payload).length) {
      renderClaims(parsed.payload);
      setHidden('jwt-claims-block', false);
    } else {
      setHidden('jwt-claims-block', true);
    }

    /* Verification panel */
    var sigEl = $('jwt-sig-raw');
    if (sigEl) sigEl.value = parsed.signature || '(empty)';
    updateKeyUi(alg);
    setHidden('jwt-verify-block', false);
    var vr = $('jwt-verify-result');
    if (vr) vr.classList.remove('jwt-visible');
  }

  function setVerifyResult(text, tone) {
    var el = $('jwt-verify-result');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('jwt-verify-result--good', 'jwt-verify-result--bad', 'jwt-verify-result--warn');
    if (tone) el.classList.add('jwt-verify-result--' + tone);
    el.classList.add('jwt-visible');
  }

  /* Import the pasted key material for the token's algorithm. */
  function importKey(info, keyText, secretIsB64) {
    var subtle = window.crypto && window.crypto.subtle;
    if (info.kind === 'hmac') {
      var bytes = secretIsB64 ? base64ToBytes(keyText.trim()) : utf8ToBytes(keyText);
      return subtle.importKey('raw', bytes, { name: 'HMAC', hash: { name: info.hash } }, false, ['verify']);
    }

    var algorithm;
    if (info.kind === 'rsa') algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: { name: info.hash } };
    else if (info.kind === 'rsapss') algorithm = { name: 'RSA-PSS', hash: { name: info.hash } };
    else if (info.kind === 'ec') algorithm = { name: 'ECDSA', namedCurve: info.curve };
    else if (info.kind === 'eddsa') algorithm = { name: 'Ed25519' };
    else return Promise.reject(new Error('Unsupported algorithm.'));

    var format = detectKeyFormat(keyText);
    if (format === 'jwk') {
      var jwk;
      try {
        jwk = JSON.parse(keyText);
      } catch (e) {
        return Promise.reject(new Error('The JWK is not valid JSON.'));
      }
      return subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
    }
    if (format === 'certificate') {
      return Promise.reject(new Error('That is an X.509 certificate. Extract the public key first: openssl x509 -pubkey -noout -in cert.pem'));
    }
    if (format === 'pkcs1') {
      return Promise.reject(new Error('That is a PKCS#1 key. Convert it to SPKI first: openssl rsa -RSAPublicKey_in -in key.pem -pubout'));
    }
    if (format === 'private') {
      return Promise.reject(new Error('That is a private key. Verification needs the matching public key.'));
    }
    if (format !== 'spki') {
      return Promise.reject(new Error('Paste a PEM public key ("BEGIN PUBLIC KEY") or a JWK JSON object.'));
    }
    return subtle.importKey('spki', pemToBytes(keyText), algorithm, false, ['verify']);
  }

  function verify() {
    if (!current || !current.ok) return;
    var info = algInfo(current.header.alg);
    if (!info || info.kind === 'none') {
      setVerifyResult('Nothing to verify — this token is unsigned.', 'warn');
      return;
    }
    if (!window.crypto || !window.crypto.subtle) {
      setVerifyResult('Web Crypto is unavailable in this context (it needs HTTPS or localhost).', 'warn');
      return;
    }

    var keyText = ($('jwt-key-input') ? $('jwt-key-input').value : '') || '';
    if (!keyText.trim()) {
      setVerifyResult(info.kind === 'hmac' ? 'Enter the shared secret first.' : 'Paste the public key first.', 'warn');
      return;
    }

    var secretIsB64 = !!($('jwt-opt-b64') && $('jwt-opt-b64').checked);
    var signature, data;
    try {
      signature = b64uToBytes(current.signature);
    } catch (e) {
      setVerifyResult('The signature segment could not be decoded — ' + e.message + '.', 'bad');
      return;
    }
    data = utf8ToBytes(current.signingInput);

    var verifyAlgorithm;
    if (info.kind === 'hmac') verifyAlgorithm = { name: 'HMAC' };
    else if (info.kind === 'rsa') verifyAlgorithm = { name: 'RSASSA-PKCS1-v1_5' };
    else if (info.kind === 'rsapss') verifyAlgorithm = { name: 'RSA-PSS', saltLength: info.saltLength };
    else if (info.kind === 'ec') verifyAlgorithm = { name: 'ECDSA', hash: { name: info.hash } };
    else verifyAlgorithm = { name: 'Ed25519' };

    var btn = $('jwt-verify-btn');
    if (btn) btn.disabled = true;
    setVerifyResult('Verifying…', 'warn');

    Promise.resolve()
      .then(function () { return importKey(info, keyText, secretIsB64); })
      .then(function (key) { return window.crypto.subtle.verify(verifyAlgorithm, key, signature, data); })
      .then(function (valid) {
        if (valid) {
          var status = tokenStatus(current.payload);
          setVerifyResult(
            status.state === 'expired'
              ? '✅ Signature is valid — but the token is expired (' + status.detail.toLowerCase() + ').'
              : '✅ Signature verified with this key.',
            status.state === 'expired' ? 'warn' : 'good'
          );
        } else {
          setVerifyResult('❌ Signature does not match — wrong key, or the token was modified.', 'bad');
        }
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : 'The key could not be used for this algorithm.';
        setVerifyResult('⚠ ' + msg, 'warn');
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  function keyChanged() {
    var el = $('jwt-verify-result');
    if (el) el.classList.remove('jwt-visible');
  }

  function loadSample() {
    var input = $('jwt-token-input');
    if (input) input.value = SAMPLE_TOKEN;
    decodeInput();
    var key = $('jwt-key-input');
    if (key) key.value = SAMPLE_SECRET;
    var b64 = $('jwt-opt-b64');
    if (b64) b64.checked = false;
    keyChanged();
  }

  function clearAll() {
    var input = $('jwt-token-input');
    if (input) { input.value = ''; input.focus(); }
    var key = $('jwt-key-input');
    if (key) key.value = '';
    hideError();
    resetOutput();
    updateStats('', 0);
  }

  function copyHeader() {
    if (current && current.header) copyText(JSON.stringify(current.header, null, 2));
  }

  function copyPayload() {
    if (!current) return;
    copyText(current.payloadIsJson ? JSON.stringify(current.payload, null, 2) : current.payloadText);
  }

  /* ── Expose to global scope (onclick handlers in HTML) ── */
  window.jwtDecodeInput = decodeInput;
  window.jwtLoadSample  = loadSample;
  window.jwtClear       = clearAll;
  window.jwtCopyHeader  = copyHeader;
  window.jwtCopyPayload = copyPayload;
  window.jwtVerify      = verify;
  window.jwtKeyChanged  = keyChanged;

  function init() {
    updateStats('', 0);
    var input = $('jwt-token-input');
    if (input && input.value.trim()) decodeInput();
  }

  /* The block markup can be inserted after DOMContentLoaded has already fired. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      b64uToBytes: b64uToBytes,
      b64uDecode: b64uDecode,
      base64ToBytes: base64ToBytes,
      bytesToUtf8: bytesToUtf8,
      utf8ToBytes: utf8ToBytes,
      parseJwt: parseJwt,
      algInfo: algInfo,
      epochSeconds: epochSeconds,
      formatUtc: formatUtc,
      relativeTime: relativeTime,
      tokenStatus: tokenStatus,
      escapeHtml: escapeHtml,
      highlightJson: highlightJson,
      claimValueText: claimValueText,
      orderClaims: orderClaims,
      headerLegend: headerLegend,
      detectKeyFormat: detectKeyFormat,
      pemToBytes: pemToBytes,
      ALGORITHMS: ALGORITHMS,
      CLAIM_INFO: CLAIM_INFO,
      HEADER_INFO: HEADER_INFO,
      SAMPLE_TOKEN: SAMPLE_TOKEN,
      SAMPLE_SECRET: SAMPLE_SECRET
    };
  }

})();
