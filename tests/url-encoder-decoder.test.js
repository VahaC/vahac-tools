// tests/url-encoder-decoder.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const urc = loadScript('url-encoder-decoder/script.js');

/* ── Encoding: parity with the native functions ── */
test('url: component mode matches encodeURIComponent', () => {
  const samples = [
    '',
    'hello world',
    'a/b?c=d&e=f#g',
    "reserved: ; , / ? : @ & = + $ ! ~ * ' ( )",
    'Привіт, світе!',
    '日本語テキスト',
    '🇺🇦 flag',
    'line\nbreak\ttab',
    '100% sure',
    'a'.repeat(500)
  ];
  for (const s of samples) {
    assert.equal(urc.percentEncode(s, 'component'), encodeURIComponent(s),
      `mismatch for ${JSON.stringify(s.slice(0, 24))}`);
  }
});

test('url: uri mode matches encodeURI', () => {
  const samples = [
    'https://vahac.com/path with space/?q=a b&x=1#frag',
    'https://vahac.com/тест?q=привіт',
    'mailto:someone@example.com?subject=hi there',
    'a;b,c/d?e:f@g&h=i+j$k#l'
  ];
  for (const s of samples) {
    assert.equal(urc.percentEncode(s, 'uri'), encodeURI(s),
      `mismatch for ${JSON.stringify(s.slice(0, 24))}`);
  }
});

test('url: form mode turns spaces into + and escapes the rest', () => {
  assert.equal(urc.percentEncode('hello world', 'form'), 'hello+world');
  assert.equal(urc.percentEncode('a+b', 'form'), 'a%2Bb');
  assert.equal(urc.percentEncode("a!b'c(d)e~f", 'form'), 'a%21b%27c%28d%29e%7Ef');
  assert.equal(urc.percentEncode('key.name-1_2*3', 'form'), 'key.name-1_2*3');
});

test('url: strict mode keeps only the RFC 3986 unreserved set', () => {
  assert.equal(urc.percentEncode("Aa0-_.~", 'strict'), 'Aa0-_.~');
  assert.equal(urc.percentEncode("!*'()", 'strict'), '%21%2A%27%28%29');
  assert.equal(urc.percentEncode('hello world', 'strict'), 'hello%20world');
  // strict is a subset of component: it never produces fewer escapes
  const s = "mixed !*'() text";
  assert.ok(urc.percentEncode(s, 'strict').length >= urc.percentEncode(s, 'component').length);
});

test('url: unknown mode falls back to component', () => {
  assert.equal(urc.percentEncode('a b', 'nope'), encodeURIComponent('a b'));
});

test('url: non-ASCII is encoded as UTF-8 bytes with uppercase hex', () => {
  assert.equal(urc.percentEncode('é', 'component'), '%C3%A9');
  assert.equal(urc.percentEncode('€', 'component'), '%E2%82%AC');
  assert.equal(urc.percentEncode('привіт', 'strict'), '%D0%BF%D1%80%D0%B8%D0%B2%D1%96%D1%82');
  const escapes = urc.percentEncode('Привіт é €', 'component').match(/%[0-9a-fA-F]{2}/g);
  assert.ok(escapes.length > 0);
  for (const e of escapes) {
    assert.equal(e, e.toUpperCase(), `hex digits must be uppercase: ${e}`);
  }
});

/* ── Decoding ── */
test('url: percentDecode matches decodeURIComponent for valid input', () => {
  const samples = [
    'hello%20world',
    '%D0%9F%D1%80%D0%B8%D0%B2%D1%96%D1%82',
    'a%2Fb%3Fc%3Dd',
    '%F0%9F%8E%89',
    'plain-text.only~1'
  ];
  for (const s of samples) {
    assert.equal(urc.percentDecode(s, { plusAsSpace: false }), decodeURIComponent(s), s);
  }
});

test('url: percentDecode accepts lowercase hex', () => {
  assert.equal(urc.percentDecode('%d0%9f%d1%80%d0%b8%d0%b2%d1%96%d1%82'), 'Привіт');
  assert.equal(urc.percentDecode('a%2fb'), 'a/b');
});

test('url: plusAsSpace controls how + is treated', () => {
  assert.equal(urc.percentDecode('a+b', { plusAsSpace: true }), 'a b');
  assert.equal(urc.percentDecode('a+b', { plusAsSpace: false }), 'a+b');
  assert.equal(urc.percentDecode('a+b'), 'a b', 'defaults to treating + as space');
});

test('url: round-trip preserves text in every mode', () => {
  const samples = ['', 'a', 'hello world', 'Привіт, світе!', '🎉🎈🎁',
                   "!*'()~-_.", 'a/b?c=d&e=f#g', 'x'.repeat(400)];
  for (const mode of ['component', 'uri', 'form', 'strict']) {
    for (const s of samples) {
      const encoded = urc.percentEncode(s, mode);
      const decoded = urc.percentDecode(encoded, { plusAsSpace: mode === 'form' });
      assert.equal(decoded, s, `round-trip failed in ${mode} mode for ${JSON.stringify(s.slice(0, 24))}`);
    }
  }
});

test('url: percentDecode rejects malformed escape sequences', () => {
  assert.throws(() => urc.percentDecode('100% sure'), /Malformed escape sequence/);
  assert.throws(() => urc.percentDecode('abc%'), /Malformed escape sequence/);
  assert.throws(() => urc.percentDecode('abc%A'), /Malformed escape sequence/);
  assert.throws(() => urc.percentDecode('%ZZ'), /Malformed escape sequence/);
  assert.throws(() => urc.percentDecode('a%2'), /Malformed escape sequence/);
});

test('url: malformed escape error reports a 1-based position', () => {
  assert.throws(() => urc.percentDecode('ab%zz'), /at position 3/);
});

test('url: invalid UTF-8 byte sequences become U+FFFD instead of throwing', () => {
  assert.throws(() => decodeURIComponent('%C3%28'), /URI malformed/);
  const out = urc.percentDecode('%C3%28');
  assert.ok(out.indexOf('�') !== -1, 'expected a replacement character');
});

/* ── Query strings ── */
test('url: parseQuery decodes keys and values', () => {
  assert.deepEqual(urc.parseQuery('a=1&b=2'), [
    { key: 'a', value: '1' },
    { key: 'b', value: '2' }
  ]);
  assert.deepEqual(urc.parseQuery('?q=home+lab&tag=self%20hosted'), [
    { key: 'q', value: 'home lab' },
    { key: 'tag', value: 'self hosted' }
  ]);
});

test('url: parseQuery handles empty, valueless and repeated keys', () => {
  assert.deepEqual(urc.parseQuery(''), []);
  assert.deepEqual(urc.parseQuery('?'), []);
  assert.deepEqual(urc.parseQuery('flag'), [{ key: 'flag', value: '' }]);
  assert.deepEqual(urc.parseQuery('a=&b='), [
    { key: 'a', value: '' },
    { key: 'b', value: '' }
  ]);
  assert.deepEqual(urc.parseQuery('t=1&&t=2'), [
    { key: 't', value: '1' },
    { key: 't', value: '2' }
  ]);
});

test('url: parseQuery keeps = characters inside a value', () => {
  assert.deepEqual(urc.parseQuery('token=a=b=c'), [{ key: 'token', value: 'a=b=c' }]);
});

test('url: buildQuery escapes with the strict set', () => {
  assert.equal(urc.buildQuery([{ key: 'q', value: 'home lab' }]), 'q=home%20lab');
  assert.equal(urc.buildQuery([
    { key: 'a b', value: 'c&d' },
    { key: 'x', value: '' }
  ]), 'a%20b=c%26d&x');
  assert.equal(urc.buildQuery([]), '');
});

test('url: buildQuery drops completely empty rows', () => {
  assert.equal(urc.buildQuery([
    { key: '', value: '' },
    { key: 'a', value: '1' }
  ]), 'a=1');
});

test('url: query round-trip survives awkward values', () => {
  const pairs = [
    { key: 'q', value: 'a&b=c d' },
    { key: 'redirect', value: 'https://vahac.com/tools/?x=1#top' },
    { key: 'емоджі', value: '🎉' }
  ];
  assert.deepEqual(urc.parseQuery(urc.buildQuery(pairs)), pairs);
});

/* ── URL parsing ── */
test('url: parseUrl splits a full URL', () => {
  const p = urc.parseUrl('https://user:pw@vahac.com:8443/tools/url?q=1&r=2#top');
  assert.equal(p.scheme, 'https');
  assert.equal(p.userinfo, 'user:pw');
  assert.equal(p.host, 'vahac.com');
  assert.equal(p.port, '8443');
  assert.equal(p.path, '/tools/url');
  assert.equal(p.query, 'q=1&r=2');
  assert.equal(p.fragment, 'top');
});

test('url: parseUrl handles URLs without optional parts', () => {
  const p = urc.parseUrl('https://vahac.com');
  assert.equal(p.scheme, 'https');
  assert.equal(p.host, 'vahac.com');
  assert.equal(p.port, '');
  assert.equal(p.path, '');
  assert.equal(p.query, '');
  assert.equal(p.fragment, '');
});

test('url: parseUrl handles IPv6 literals', () => {
  const p = urc.parseUrl('http://[2001:db8::1]:8080/status');
  assert.equal(p.host, '[2001:db8::1]');
  assert.equal(p.port, '8080');
  assert.equal(p.path, '/status');

  const noPort = urc.parseUrl('http://[::1]/');
  assert.equal(noPort.host, '[::1]');
  assert.equal(noPort.port, '');
});

test('url: parseUrl handles relative and protocol-relative forms', () => {
  const rel = urc.parseUrl('/tools/url-encoder-decoder/?a=1');
  assert.equal(rel.scheme, '');
  assert.equal(rel.hasAuthority, false);
  assert.equal(rel.path, '/tools/url-encoder-decoder/');
  assert.equal(rel.query, 'a=1');

  const proto = urc.parseUrl('//cdn.vahac.com/lib.js');
  assert.equal(proto.scheme, '');
  assert.equal(proto.hasAuthority, true);
  assert.equal(proto.host, 'cdn.vahac.com');
  assert.equal(proto.path, '/lib.js');
});

test('url: parseUrl handles non-hierarchical schemes', () => {
  const p = urc.parseUrl('mailto:someone@example.com?subject=hi');
  assert.equal(p.scheme, 'mailto');
  assert.equal(p.hasAuthority, false);
  assert.equal(p.path, 'someone@example.com');
  assert.equal(p.query, 'subject=hi');
});

test('url: parseUrl treats a bare key=value string as a query string', () => {
  const p = urc.parseUrl('a=1&b=2');
  assert.equal(p.query, 'a=1&b=2');
  assert.equal(p.path, '');
  assert.deepEqual(urc.parseQuery(p.query), [
    { key: 'a', value: '1' },
    { key: 'b', value: '2' }
  ]);
});

test('url: parseUrl returns null for empty input', () => {
  assert.equal(urc.parseUrl(''), null);
  assert.equal(urc.parseUrl('   '), null);
  assert.equal(urc.parseUrl(null), null);
});

test('url: parseUrl keeps an empty query distinct from a missing one', () => {
  assert.equal(urc.parseUrl('https://vahac.com/?').hasQuery, true);
  assert.equal(urc.parseUrl('https://vahac.com/').hasQuery, false);
});

/* ── URL rebuilding ── */
test('url: buildUrl round-trips an unmodified URL', () => {
  const samples = [
    'https://vahac.com/tools/?q=1#top',
    'https://user@vahac.com:8443/a/b',
    'http://[::1]:3000/status',
    '//cdn.vahac.com/lib.js',
    '/relative/path'
  ];
  for (const s of samples) {
    const p = urc.parseUrl(s);
    assert.equal(urc.buildUrl(p, p.query), s, `round-trip failed for ${s}`);
  }
});

test('url: buildUrl re-encodes an edited query', () => {
  const p = urc.parseUrl('https://vahac.com/search?q=home+lab');
  const pairs = urc.parseQuery(p.query);
  pairs.push({ key: 'page', value: '2' });
  assert.equal(urc.buildUrl(p, urc.buildQuery(pairs)),
    'https://vahac.com/search?q=home%20lab&page=2');
});

test('url: buildUrl drops the ? when every parameter is removed', () => {
  const p = urc.parseUrl('https://vahac.com/search?q=1#top');
  assert.equal(urc.buildUrl(p, ''), 'https://vahac.com/search#top');
});

/* ── Helpers ── */
test('url: pathSegments splits and skips empty segments', () => {
  assert.deepEqual(urc.pathSegments('/tools/url-encoder/'), ['tools', 'url-encoder']);
  assert.deepEqual(urc.pathSegments('/'), []);
  assert.deepEqual(urc.pathSegments(''), []);
});

test('url: safeDecode returns the input unchanged when it cannot decode', () => {
  assert.equal(urc.safeDecode('100% sure'), '100% sure');
  assert.equal(urc.safeDecode('a%20b'), 'a b');
  assert.equal(urc.safeDecode('a+b'), 'a+b', 'plus is literal unless asked otherwise');
});

test('url: formatBytes renders human-readable sizes', () => {
  assert.equal(urc.formatBytes(0), '0 bytes');
  assert.equal(urc.formatBytes(1), '1 byte');
  assert.equal(urc.formatBytes(512), '512 bytes');
  assert.equal(urc.formatBytes(2048), '2.0 KB');
  assert.equal(urc.formatBytes(1048576), '1.00 MB');
});

test('url: safe sets are unique and unreserved-inclusive', () => {
  for (const [name, chars] of Object.entries(urc.SAFE_CHARS)) {
    assert.equal(new Set(chars).size, chars.length, `${name} has duplicate characters`);
    for (const c of 'ABCyz09-_.') {
      assert.ok(chars.indexOf(c) !== -1, `${name} must keep ${c} unescaped`);
    }
  }
});
