// tests/jwt-decoder.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadScript } = require('./_setup');

const jwt = loadScript('jwt-decoder/script.js');

/* ── Helpers ── */
const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function makeToken(header, payload, signature) {
  return b64u(header) + '.' + b64u(payload) + '.' + (signature === undefined ? 'sig' : signature);
}

/* ── base64url decoding ── */
test('jwt: b64uDecode round-trips UTF-8 text', () => {
  const samples = ['', 'a', 'ab', 'abc', 'hello world', 'Привіт, світе!', '日本語', '🇺🇦 flag', '{"a":1}'];
  for (const s of samples) {
    const encoded = Buffer.from(s, 'utf8').toString('base64url');
    assert.equal(jwt.b64uDecode(encoded), s, `mismatch for ${JSON.stringify(s)}`);
  }
});

test('jwt: b64uDecode accepts unpadded segments of every length class', () => {
  // 1, 2 and 0 bytes of remainder exercise all padding branches
  assert.equal(jwt.b64uDecode('QQ'), 'A');      // needs '=='
  assert.equal(jwt.b64uDecode('QUI'), 'AB');    // needs '='
  assert.equal(jwt.b64uDecode('QUJD'), 'ABC');  // no padding needed
});

test('jwt: b64uToBytes rejects the standard-base64 alphabet and bad lengths', () => {
  assert.throws(() => jwt.b64uToBytes('ab+c'), /base64url alphabet/);
  assert.throws(() => jwt.b64uToBytes('ab/c'), /base64url alphabet/);
  assert.throws(() => jwt.b64uToBytes('a=b'), /base64url alphabet/);
  assert.throws(() => jwt.b64uToBytes('QUJDQ'), /valid base64url length/);
});

test('jwt: base64ToBytes accepts padded, unpadded and URL-safe base64', () => {
  const expected = [0xfb, 0xff, 0xbe];
  assert.deepEqual(Array.from(jwt.base64ToBytes('+/++')), expected);
  assert.deepEqual(Array.from(jwt.base64ToBytes('-_--')), expected);
  assert.deepEqual(Array.from(jwt.base64ToBytes('QUJD')), [65, 66, 67]);
  assert.deepEqual(Array.from(jwt.base64ToBytes('QUI=')), [65, 66]);
  assert.deepEqual(Array.from(jwt.base64ToBytes('QUI')), [65, 66]);
});

test('jwt: utf8ToBytes and bytesToUtf8 are inverse', () => {
  for (const s of ['', 'plain', 'Привіт', '𝄞 clef', 'tab\there']) {
    assert.equal(jwt.bytesToUtf8(jwt.utf8ToBytes(s)), s);
  }
});

/* ── parseJwt ── */
test('jwt: parseJwt decodes a well-formed token', () => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: '42', name: 'Vasyl', exp: 2051222400 };
  const res = jwt.parseJwt(makeToken(header, payload, 'abc123'));

  assert.equal(res.ok, true);
  assert.equal(res.error, '');
  assert.deepEqual(res.header, header);
  assert.deepEqual(res.payload, payload);
  assert.equal(res.payloadIsJson, true);
  assert.equal(res.signature, 'abc123');
  assert.equal(res.parts.length, 3);
  assert.equal(res.signingInput, res.parts[0] + '.' + res.parts[1]);
});

test('jwt: parseJwt strips Bearer prefixes and whitespace', () => {
  const token = makeToken({ alg: 'HS256' }, { sub: '1' });
  const messy = 'Authorization: Bearer ' + token.slice(0, 20) + '\n  ' + token.slice(20) + '\n';
  const res = jwt.parseJwt(messy);

  assert.equal(res.ok, true);
  assert.equal(res.token, token);
  assert.deepEqual(res.header, { alg: 'HS256' });
});

test('jwt: parseJwt reports an empty input', () => {
  for (const value of ['', '   ', null, undefined]) {
    const res = jwt.parseJwt(value);
    assert.equal(res.ok, false);
    assert.match(res.error, /Paste a token/);
  }
});

test('jwt: parseJwt reports the wrong number of segments', () => {
  assert.match(jwt.parseJwt('onlyonesegment').error, /3 dot-separated segments/);
  assert.match(jwt.parseJwt('a.b').error, /has 2\./);
  assert.match(jwt.parseJwt('a.b.c.d').error, /has 4\./);
});

test('jwt: parseJwt recognises a JWE', () => {
  const res = jwt.parseJwt('a.b.c.d.e');
  assert.equal(res.ok, false);
  assert.match(res.error, /JWE/);
});

test('jwt: parseJwt rejects empty header or payload segments', () => {
  assert.match(jwt.parseJwt('.eyJhIjoxfQ.sig').error, /empty/);
  assert.match(jwt.parseJwt('eyJhIjoxfQ..sig').error, /empty/);
});

test('jwt: parseJwt reports undecodable and non-JSON segments', () => {
  const goodHeader = b64u({ alg: 'HS256' });
  assert.match(jwt.parseJwt('!!!.' + b64u({ a: 1 }) + '.s').error, /header segment could not be decoded/);
  assert.match(jwt.parseJwt(goodHeader + '.!!!.s').error, /payload segment could not be decoded/);

  const notJson = Buffer.from('not json', 'utf8').toString('base64url');
  assert.match(jwt.parseJwt(notJson + '.' + b64u({ a: 1 }) + '.s').error, /header decodes, but it is not valid JSON/);

  const headerArray = Buffer.from('[1,2]', 'utf8').toString('base64url');
  assert.match(jwt.parseJwt(headerArray + '.' + b64u({ a: 1 }) + '.s').error, /header must be a JSON object/);
});

test('jwt: parseJwt keeps a non-JSON payload as text with a warning', () => {
  const payload = Buffer.from('plain text body', 'utf8').toString('base64url');
  const res = jwt.parseJwt(b64u({ alg: 'HS256' }) + '.' + payload + '.sig');

  assert.equal(res.ok, true);
  assert.equal(res.payloadIsJson, false);
  assert.equal(res.payload, null);
  assert.equal(res.payloadText, 'plain text body');
  assert.match(res.warning, /not JSON/);
});

test('jwt: parseJwt warns when a signed token has an empty signature', () => {
  const res = jwt.parseJwt(makeToken({ alg: 'HS256' }, { sub: '1' }, ''));
  assert.equal(res.ok, true);
  assert.equal(res.signature, '');
  assert.match(res.warning, /signature segment is empty/);
});

test('jwt: parseJwt accepts an unsecured alg:none token without a warning', () => {
  const res = jwt.parseJwt(makeToken({ alg: 'none' }, { sub: '1' }, ''));
  assert.equal(res.ok, true);
  assert.equal(res.warning, '');
});

/* ── The bundled sample token ── */
test('jwt: the sample token parses and its HS256 signature matches the sample secret', () => {
  const res = jwt.parseJwt(jwt.SAMPLE_TOKEN);
  assert.equal(res.ok, true);
  assert.equal(res.header.alg, 'HS256');
  assert.equal(res.payload.iss, 'https://vahac.com');

  const expected = crypto.createHmac('sha256', jwt.SAMPLE_SECRET)
    .update(res.signingInput)
    .digest('base64url');
  assert.equal(res.signature, expected);
});

/* ── Algorithm registry ── */
test('jwt: algInfo maps every standard JOSE algorithm', () => {
  assert.equal(jwt.algInfo('HS256').kind, 'hmac');
  assert.equal(jwt.algInfo('HS512').hash, 'SHA-512');
  assert.equal(jwt.algInfo('RS256').kind, 'rsa');
  assert.equal(jwt.algInfo('PS384').saltLength, 48);
  assert.equal(jwt.algInfo('ES512').curve, 'P-521');
  assert.equal(jwt.algInfo('EdDSA').kind, 'eddsa');
  assert.equal(jwt.algInfo('none').kind, 'none');
});

test('jwt: algInfo returns null for unknown or non-string algorithms', () => {
  assert.equal(jwt.algInfo('HS999'), null);
  assert.equal(jwt.algInfo(''), null);
  assert.equal(jwt.algInfo(undefined), null);
  assert.equal(jwt.algInfo(256), null);
  // must not leak Object.prototype members
  assert.equal(jwt.algInfo('toString'), null);
  assert.equal(jwt.algInfo('constructor'), null);
});

/* ── Timestamps ── */
test('jwt: epochSeconds accepts numbers and numeric strings', () => {
  assert.deepEqual(jwt.epochSeconds(1757667600), { seconds: 1757667600, unit: 's' });
  assert.deepEqual(jwt.epochSeconds('1757667600'), { seconds: 1757667600, unit: 's' });
  assert.deepEqual(jwt.epochSeconds(1757667600.9), { seconds: 1757667600, unit: 's' });
  assert.deepEqual(jwt.epochSeconds(0), { seconds: 0, unit: 's' });
});

test('jwt: epochSeconds normalises millisecond timestamps', () => {
  assert.deepEqual(jwt.epochSeconds(1757667600000), { seconds: 1757667600, unit: 'ms' });
});

test('jwt: epochSeconds returns null for non-numeric values', () => {
  for (const v of [null, undefined, '', 'soon', {}, [], true, NaN, Infinity]) {
    assert.equal(jwt.epochSeconds(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

test('jwt: formatUtc renders a readable UTC string', () => {
  assert.equal(jwt.formatUtc(1757667600), '2025-09-12 09:00:00 UTC');
  assert.equal(jwt.formatUtc(0), '1970-01-01 00:00:00 UTC');
  assert.equal(jwt.formatUtc(Number.NaN), '');
});

test('jwt: relativeTime phrases past and future deltas', () => {
  assert.equal(jwt.relativeTime(0), 'in a few seconds');
  assert.equal(jwt.relativeTime(-10), 'a few seconds ago');
  assert.equal(jwt.relativeTime(50), 'in 50 seconds');
  assert.equal(jwt.relativeTime(-120), '2 minutes ago');
  assert.equal(jwt.relativeTime(3600), 'in 1 hour');
  assert.equal(jwt.relativeTime(-86400 * 3), '3 days ago');
  assert.equal(jwt.relativeTime(2592000 * 2), 'in 2 months');
  assert.equal(jwt.relativeTime(-31536000 * 5), '5 years ago');
});

/* ── Token validity window ── */
test('jwt: tokenStatus flags an expired token', () => {
  const s = jwt.tokenStatus({ exp: 1000 }, 2000);
  assert.equal(s.state, 'expired');
  assert.equal(s.tone, 'bad');
  assert.equal(s.seconds, 1000);
  assert.match(s.detail, /ago/);
});

test('jwt: tokenStatus treats exp as exclusive at the exact second', () => {
  assert.equal(jwt.tokenStatus({ exp: 1000 }, 1000).state, 'expired');
  assert.equal(jwt.tokenStatus({ exp: 1000 }, 999).state, 'active');
});

test('jwt: tokenStatus flags a not-yet-valid token', () => {
  const s = jwt.tokenStatus({ nbf: 2000, exp: 3000 }, 1000);
  assert.equal(s.state, 'not-yet-valid');
  assert.equal(s.tone, 'warn');
  assert.equal(s.seconds, 1000);
});

test('jwt: expiry wins over nbf when both are out of range', () => {
  assert.equal(jwt.tokenStatus({ nbf: 5000, exp: 1000 }, 2000).state, 'expired');
});

test('jwt: tokenStatus reports a valid token and a missing exp claim', () => {
  const ok = jwt.tokenStatus({ nbf: 500, exp: 3000 }, 1000);
  assert.equal(ok.state, 'active');
  assert.equal(ok.tone, 'good');
  assert.equal(ok.seconds, 2000);

  const none = jwt.tokenStatus({ sub: '1' }, 1000);
  assert.equal(none.state, 'no-expiry');
  assert.equal(none.tone, 'warn');

  const empty = jwt.tokenStatus(null, 1000);
  assert.equal(empty.state, 'unknown');
});

test('jwt: tokenStatus understands millisecond exp values', () => {
  assert.equal(jwt.tokenStatus({ exp: 2051222400000 }, 1757667600).state, 'active');
  assert.equal(jwt.tokenStatus({ exp: 1757667600000 }, 2051222400).state, 'expired');
});

/* ── Rendering helpers ── */
test('jwt: escapeHtml neutralises markup', () => {
  assert.equal(jwt.escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror="alert(1)"&gt;');
  assert.equal(jwt.escapeHtml('a & b'), 'a &amp; b');
  assert.equal(jwt.escapeHtml(null), '');
});

test('jwt: highlightJson wraps keys, strings, numbers, booleans and null', () => {
  const html = jwt.highlightJson(JSON.stringify({ k: 'v', n: -1.5, b: true, z: null }, null, 2));
  assert.match(html, /<span class="jwt-json-key">"k"\s*:<\/span>/);
  assert.match(html, /<span class="jwt-json-str">"v"<\/span>/);
  assert.match(html, /<span class="jwt-json-num">-1\.5<\/span>/);
  assert.match(html, /<span class="jwt-json-bool">true<\/span>/);
  assert.match(html, /<span class="jwt-json-null">null<\/span>/);
});

test('jwt: highlightJson escapes markup inside string values', () => {
  const html = jwt.highlightJson(JSON.stringify({ x: '<script>' }));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('jwt: claimValueText serialises every claim shape', () => {
  assert.equal(jwt.claimValueText('text'), 'text');
  assert.equal(jwt.claimValueText(42), '42');
  assert.equal(jwt.claimValueText(true), 'true');
  assert.equal(jwt.claimValueText(null), 'null');
  assert.equal(jwt.claimValueText(['a', 'b']), '["a","b"]');
  assert.equal(jwt.claimValueText({ a: 1 }), '{"a":1}');
});

test('jwt: orderClaims puts registered claims first, then the rest alphabetically', () => {
  const order = jwt.orderClaims({ zeta: 1, sub: 2, alpha: 3, iss: 4, exp: 5, name: 6 });
  assert.deepEqual(order, ['iss', 'sub', 'exp', 'alpha', 'name', 'zeta']);
  assert.deepEqual(jwt.orderClaims(null), []);
  assert.deepEqual(jwt.orderClaims({}), []);
});

test('jwt: headerLegend describes only recognised header fields', () => {
  const legend = jwt.headerLegend({ alg: 'RS256', kid: 'k1', custom: 'x' });
  assert.match(legend, /<code>alg<\/code> — Signing algorithm/);
  assert.match(legend, /<code>kid<\/code> — Key ID/);
  assert.ok(!legend.includes('custom'));
  assert.equal(jwt.headerLegend(null), '');
});

/* ── Key material handling ── */
test('jwt: detectKeyFormat identifies the pasted material', () => {
  assert.equal(jwt.detectKeyFormat(''), 'empty');
  assert.equal(jwt.detectKeyFormat('   '), 'empty');
  assert.equal(jwt.detectKeyFormat('my-shared-secret'), 'raw');
  assert.equal(jwt.detectKeyFormat('{"kty":"RSA","n":"…"}'), 'jwk');
  assert.equal(jwt.detectKeyFormat('-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----'), 'spki');
  assert.equal(jwt.detectKeyFormat('-----BEGIN RSA PUBLIC KEY-----\nAAA\n-----END RSA PUBLIC KEY-----'), 'pkcs1');
  assert.equal(jwt.detectKeyFormat('-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----'), 'private');
  assert.equal(jwt.detectKeyFormat('-----BEGIN RSA PRIVATE KEY-----\nAAA\n-----END RSA PRIVATE KEY-----'), 'private');
  assert.equal(jwt.detectKeyFormat('-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----'), 'certificate');
});

test('jwt: pemToBytes returns the DER body of a real SPKI key', () => {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const der = publicKey.export({ type: 'spki', format: 'der' });

  assert.deepEqual(Buffer.from(jwt.pemToBytes(pem)), der);
});
