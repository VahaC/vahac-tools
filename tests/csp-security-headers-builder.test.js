// tests/csp-security-headers-builder.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const { loadScript } = require('./_setup');

const csh = loadScript('csp-security-headers-builder/script.js');

const levels = (msgs) => msgs.map((m) => m.level);
const texts = (msgs) => msgs.map((m) => m.text).join('\n');
const policy = (value, opts) => csh.analyzePolicyOnly(value, opts);
const headers = (text) => (csh.parseHeaderBlock(text).responses.slice(-1)[0] || { headers: [] }).headers;
const analyze = (text, opts) => csh.analyzeHeaders(headers(text), opts);
const sectionOf = (a, id) => a.sections.find((s) => s.id === id);

// ── parsePolicy / parseCspList ──────────────────────────

test('csp: parsePolicy lowercases names, splits on whitespace and keeps the first duplicate', () => {
  const p = csh.parsePolicy(" Script-Src  'self'\thttps://a.example ;script-src *; img-src 'none'; ;");
  assert.deepEqual(p.directives.map((d) => d.name), ['script-src', 'img-src']);
  assert.deepEqual(p.byName['script-src'].values, ["'self'", 'https://a.example']);
  assert.equal(p.duplicates.length, 1);
  assert.deepEqual(p.duplicates[0].values, ['*']);
});

test('csp: parsePolicy drops a directive with non-ASCII characters', () => {
  const curly = String.fromCharCode(0x2018) + 'self' + String.fromCharCode(0x2019);
  const p = csh.parsePolicy('default-src ' + curly + "; img-src 'self'");
  assert.deepEqual(p.directives.map((d) => d.name), ['img-src']);
  assert.equal(p.nonAscii.length, 1);
  assert.match(texts(policy('default-src ' + curly).messages), /Non-ASCII/);
});

test('csp: parseCspList splits policies on commas', () => {
  const list = csh.parseCspList("default-src 'self', script-src 'none'");
  assert.equal(list.length, 2);
  assert.equal(list[1].directives[0].name, 'script-src');
});

// ── classifySource ──────────────────────────────────────

test('csp: classifySource recognises keywords, schemes, wildcards and hosts', () => {
  assert.equal(csh.classifySource("'SELF'").kind, 'keyword');
  assert.equal(csh.classifySource('*').kind, 'wildcard');
  assert.deepEqual(csh.classifySource('https:').scheme, 'https');
  const h = csh.classifySource('https://*.example.com:8443/static/');
  assert.equal(h.kind, 'host');
  assert.equal(h.scheme, 'https');
  assert.equal(h.host, '*.example.com');
  assert.equal(h.port, '8443');
  assert.equal(h.path, '/static/');
  assert.equal(csh.classifySource('127.0.0.1:*').kind, 'host');
});

test('csp: classifySource flags keywords without quotes or with double quotes', () => {
  assert.deepEqual([csh.classifySource('self').reason, csh.classifySource('self').fix], ['unquoted', "'self'"]);
  assert.equal(csh.classifySource('nonce-abc').reason, 'unquoted');
  assert.deepEqual([csh.classifySource('"self"').reason, csh.classifySource('"self"').fix], ['double', "'self'"]);
  assert.equal(csh.classifySource("'self").reason, 'quote');
  assert.equal(csh.classifySource("'unsafe_inline'").suggestion, "'unsafe-inline'");
  assert.equal(csh.classifySource('example.*').kind, 'invalid');
  assert.equal(csh.classifySource('[::1]').kind, 'invalid');
});

test('csp: classifySource validates nonces', () => {
  const good = csh.classifySource("'nonce-4AEemGb0xJptoIGFP3Nd'");
  assert.equal(good.kind, 'nonce');
  assert.equal(good.valid, true);
  assert.equal(good.bits, 120);
  assert.equal(csh.classifySource("'nonce-a*b'").valid, false);
  const ph = csh.classifySource("'nonce-{RANDOM}'");
  assert.equal(ph.placeholder, true);
  assert.equal(ph.valid, false);
  assert.equal(csh.classifySource("'nonce-abc!'").valid, false);
});

test('csp: classifySource checks hash lengths', () => {
  const sha = nodeCrypto.createHash('sha256').update('x').digest('base64');
  assert.equal(csh.classifySource("'sha256-" + sha + "'").wrongLength, false);
  assert.equal(csh.classifySource("'sha384-" + sha + "'").wrongLength, true);
  assert.equal(csh.classifySource("'sha256-abc'").wrongLength, true);
  assert.equal(csh.classifySource("'sha256-a'").valid, false);
  const url = sha.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(csh.classifySource("'sha256-" + url + "'").wrongLength, false);
});

// ── Policy evaluation ───────────────────────────────────

test('csp: the web.dev strict policy is rated strict and its fallbacks are explained', () => {
  const r = policy("script-src 'nonce-4AEemGb0xJptoIGFP3NdR2' 'strict-dynamic' https: 'unsafe-inline'; object-src 'none'; base-uri 'none'");
  assert.equal(r.scripts, 'strict');
  assert.ok(!levels(r.messages).includes('bad'));
  assert.match(texts(r.messages), /ignore `'unsafe-inline'` and `https:`/);
});

test('csp: unsafe-inline without a nonce is unsafe, with a nonce it is ignored', () => {
  const bad = policy("script-src 'self' 'unsafe-inline'");
  assert.equal(bad.scripts, 'unsafe');
  assert.ok(bad.messages.some((m) => m.level === 'bad' && /unsafe-inline/.test(m.text)));
  const ok = policy("script-src 'nonce-4AEemGb0xJptoIGFP3NdR2' 'unsafe-inline'");
  assert.equal(ok.scripts, 'good');
  assert.match(texts(ok.messages), /is ignored because `script-src` also has a nonce or hash/);
});

test('csp: strict-dynamic without a nonce or hash blocks everything', () => {
  const r = policy("script-src 'strict-dynamic' 'self'");
  assert.equal(r.scripts, 'broken');
  assert.ok(r.messages.some((m) => m.level === 'error' && /strict-dynamic/.test(m.text)));
});

test('csp: no script-src and no default-src means no XSS protection', () => {
  const r = policy("img-src 'self'");
  assert.equal(r.scripts, 'open');
  assert.match(texts(r.messages), /No `script-src` or `default-src`/);
});

test('csp: wildcards, https: and data: in script-src are unsafe', () => {
  assert.equal(policy('script-src *').scripts, 'unsafe');
  assert.equal(policy('script-src https:').scripts, 'unsafe');
  assert.equal(policy("script-src 'self' data:").scripts, 'unsafe');
  assert.equal(policy("default-src 'self' blob:").scripts, 'allowlist');
});

test('csp: a missing semicolon is detected', () => {
  const r = policy("default-src 'self' script-src 'self'");
  assert.match(texts(r.messages), /`script-src` inside `default-src` is read as a host name/);
});

test('csp: commas between sources are reported as a policy split', () => {
  const r = policy("default-src 'self', 'unsafe-inline'; script-src 'self'");
  assert.match(texts(r.messages), /The comma before `'unsafe-inline'` starts a separate policy/);
  assert.ok(!/Unknown directive `'unsafe-inline'`/.test(texts(r.messages)));
});

test('csp: unknown and obsolete directives', () => {
  assert.match(texts(policy("scripts-src 'self'").messages), /Did you mean `script-src`/);
  assert.match(texts(policy("default_src 'self'").messages), /Did you mean `default-src`/);
  assert.match(texts(policy("default-src 'self'; block-all-mixed-content").messages), /obsolete/);
  assert.equal(csh.suggestDirective('frame-ancestor'), 'frame-ancestors');
});

test('csp: frame-ancestors rejects keywords other than self and none', () => {
  const r = policy("default-src 'self'; frame-ancestors 'unsafe-inline' 'self'");
  assert.match(texts(r.messages), /not allowed in `frame-ancestors`/);
});

test('csp: none next to other sources is flagged', () => {
  assert.match(texts(policy("default-src 'none' 'self'").messages), /`'none'` has no effect in `default-src`/);
});

test('csp: empty source lists and valueless directives', () => {
  assert.match(texts(policy("default-src 'self'; img-src").messages), /no sources, which blocks everything/);
  assert.match(texts(policy("default-src 'self'; upgrade-insecure-requests 1").messages), /takes no value/);
  assert.match(texts(policy("default-src 'self'; require-trusted-types-for script").messages), /only accepts `'script'`/);
  assert.match(texts(policy("default-src 'self'; sandbox allow-scripts allow-everything").messages), /`allow-everything` is not a sandbox flag/);
});

test('csp: nonces and hashes are checked', () => {
  assert.match(texts(policy("script-src 'nonce-abc123'").messages), /at most 36 bits/);
  assert.match(texts(policy("script-src 'sha256-abc'").messages), /decodes to 2 bytes/);
  assert.match(texts(policy("img-src 'nonce-4AEemGb0xJptoIGFP3NdR2'; default-src 'self'").messages), /has no effect in `img-src`/);
});

test('csp: placeholder nonces are fine in the builder but an error when deployed', () => {
  const value = "script-src 'nonce-{RANDOM}' 'strict-dynamic'; object-src 'none'; base-uri 'none'";
  const built = policy(value, { origin: 'builder' });
  assert.equal(built.scripts, 'strict');
  assert.ok(!levels(built.messages).includes('error'));
  const live = policy(value);
  assert.equal(live.scripts, 'broken');
  assert.match(texts(live.messages), /placeholder that was never replaced/);
});

test('csp: risky script hosts', () => {
  const r = policy("script-src 'self' https://cdn.jsdelivr.net");
  assert.ok(r.messages.some((m) => m.level === 'warn' && /cdn\.jsdelivr\.net/.test(m.text)));
  const scoped = policy("script-src 'self' https://cdn.jsdelivr.net/npm/lib@1.2.3/");
  assert.ok(!scoped.messages.some((m) => m.level === 'warn' && /jsdelivr/.test(m.text)));
  assert.equal(policy("script-src 'self' https://*.github.io").scripts, 'unsafe');
  assert.equal(policy("script-src 'self' https://*.example.com").scripts, 'allowlist');
});

test('csp: unsafe-eval, object-src, base-uri and form-action', () => {
  const r = policy("script-src 'self' 'unsafe-eval'");
  assert.match(texts(r.messages), /`'unsafe-eval'` in `script-src`/);
  assert.match(texts(r.messages), /No `object-src` or `default-src`/);
  assert.match(texts(r.messages), /No `base-uri`/);
  assert.match(texts(r.messages), /No `form-action`/);
  const nonce = policy("script-src 'nonce-4AEemGb0xJptoIGFP3NdR2'");
  assert.ok(nonce.messages.some((m) => m.level === 'warn' && /No `base-uri`/.test(m.text)));
});

test('csp: script-src-attr with unsafe-inline lets injected handlers run', () => {
  const r = policy("script-src 'nonce-4AEemGb0xJptoIGFP3NdR2'; script-src-attr 'unsafe-inline'");
  assert.equal(r.scripts, 'unsafe');
});

test('csp: several policies are merged — the strictest script rules win', () => {
  const r = csh.analyzeCsp(["script-src 'self' 'unsafe-inline'", "script-src 'nonce-4AEemGb0xJptoIGFP3NdR2' 'strict-dynamic'; object-src 'none'; base-uri 'none'"], { standalone: true });
  assert.equal(r.scripts, 'strict');
  assert.ok(!levels(r.messages).includes('bad'));
  assert.match(texts(r.messages), /stricter script rules of policy 2 win/);
  // base-uri is set in one policy, so it is not reported as missing
  assert.ok(!/No `base-uri`/.test(texts(r.messages)));
});

test('csp: meta delivery ignores frame-ancestors, report-uri and sandbox', () => {
  const r = policy("default-src 'self'; frame-ancestors 'none'; report-uri /csp", { delivery: 'meta' });
  assert.match(texts(r.messages), /`frame-ancestors` is ignored in a <meta> policy/);
  assert.match(texts(r.messages), /`report-uri` is ignored in a <meta> policy/);
});

test('csp: an invalid-only frame-ancestors list is not praised as none', () => {
  const a = analyze("content-security-policy: default-src 'self'; frame-ancestors self");
  const framing = sectionOf(a, 'framing');
  assert.equal(framing.status, 'invalid');
  assert.match(texts(framing.messages), /no valid source/);
});

// ── Structured fields ───────────────────────────────────

test('sf: dictionaries with inner lists, strings, booleans and parameters', () => {
  const r = csh.sfParse('a=?0, b, c;foo=bar, geolocation=(self "https://x.example"), n=-12.5', 'dictionary');
  assert.equal(r.ok, true);
  const e = Object.fromEntries(r.value.entries.map((x) => [x.key, x.value]));
  assert.equal(e.a.value, false);
  assert.equal(e.b.value, true);
  assert.equal(e.c.params[0].key, 'foo');
  assert.equal(e.c.params[0].value.value, 'bar');
  assert.equal(e.geolocation.type, 'inner');
  assert.deepEqual(e.geolocation.items.map((i) => i.value), ['self', 'https://x.example']);
  assert.equal(e.n.value, -12.5);
});

test('sf: invalid input fails', () => {
  assert.equal(csh.sfParse('Camera=()', 'dictionary').ok, false);
  assert.equal(csh.sfParse("camera 'none'", 'dictionary').ok, false);
  assert.equal(csh.sfParse('a=1,', 'dictionary').ok, false);
  assert.equal(csh.sfParse('a="open', 'dictionary').ok, false);
  assert.equal(csh.sfParse('a=1.2345', 'dictionary').ok, false);
  assert.equal(csh.sfParse('a=1234567890123456', 'dictionary').ok, false);
  assert.equal(csh.sfParse('same-origin; report-to="x"', 'item').ok, true);
});

test('sf: duplicate dictionary keys keep the last value', () => {
  const r = csh.sfParse('camera=(), camera=*', 'dictionary');
  assert.equal(r.value.entries.length, 1);
  assert.equal(r.value.entries[0].value.value, '*');
  assert.deepEqual(r.value.dupes, ['camera']);
});

// ── Header block parsing ────────────────────────────────

test('headers: plain lists and curl -IL redirect chains', () => {
  const p = csh.parseHeaderBlock('HTTP/1.1 301 Moved\nLocation: https://x/\n\nHTTP/2 200\nserver: nginx\ncontent-type: text/html\n');
  assert.deepEqual(p.responses.map((r) => r.status), [301, 200]);
  assert.equal(p.responses[1].headers[0].lname, 'server');
});

test('headers: curl -v keeps only response lines', () => {
  const text = ['* Connected to example.com', '> GET / HTTP/2', '> Host: example.com', '>', '< HTTP/2 200', '< x-frame-options: DENY', '<', '{ [5 bytes data]'].join('\n');
  const p = csh.parseHeaderBlock(text);
  assert.equal(p.format, 'curl -v');
  assert.equal(p.responses.length, 1);
  assert.deepEqual(p.responses[0].headers.map((h) => h.name), ['x-frame-options']);
});

test('headers: wget -S indentation, DevTools value-on-next-line, folding and bodies', () => {
  const wget = csh.parseHeaderBlock('  HTTP/1.1 200 OK\n  Server: Apache\n  X-Content-Type-Options: nosniff');
  assert.equal(wget.format, 'wget -S');
  assert.equal(wget.responses[0].headers.length, 2);
  const devtools = csh.parseHeaderBlock('content-security-policy:\ndefault-src \'self\'\nx-frame-options:\nDENY');
  assert.deepEqual(devtools.responses[0].headers.map((h) => h.value), ["default-src 'self'", 'DENY']);
  const folded = csh.parseHeaderBlock("Content-Security-Policy: default-src 'self';\n  img-src 'self'\n\n<html>\ncolor: red;");
  assert.equal(folded.responses[0].headers[0].value, "default-src 'self'; img-src 'self'");
  assert.equal(folded.bodyLines, 2);
  const pseudo = csh.parseHeaderBlock(':status: 404\ncontent-type: text/plain');
  assert.equal(pseudo.responses[0].status, 404);
});

test('headers: detectInput tells headers, policies and meta tags apart', () => {
  assert.equal(csh.detectInput('').kind, 'empty');
  assert.equal(csh.detectInput("default-src 'self'; img-src data:").kind, 'policy');
  assert.equal(csh.detectInput('Content-Security-Policy: default-src \'self\'').kind, 'headers');
  const colons = csh.detectInput("script-src: 'self'");
  assert.equal(colons.kind, 'policy');
  assert.equal(colons.colons, true);
  const meta = csh.detectInput('<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; img-src *">');
  assert.equal(meta.kind, 'meta');
  assert.equal(meta.metas[0].value, "default-src 'self'; img-src *");
  assert.equal(csh.detectInput('hello world').kind, 'unknown');
});

// ── HSTS ────────────────────────────────────────────────

test('hsts: parser follows RFC 6797', () => {
  assert.equal(csh.parseHsts('max-age="31536000"; includeSubDomains').maxAge, 31536000);
  assert.equal(csh.parseHsts('includeSubDomains').valid, false);
  assert.equal(csh.parseHsts('max-age=1; max-age=2').valid, false);
  assert.equal(csh.parseHsts('max-age=abc').valid, false);
  assert.equal(csh.parseHsts('max-age=10; includeSubDomains=yes').valid, false);
  assert.deepEqual(csh.parseHsts('max-age=10; foo').unknown, ['foo']);
});

test('hsts: points follow max-age, and only the first header counts', () => {
  const pts = (v) => sectionOf(analyze('strict-transport-security: ' + v), 'hsts').points;
  assert.equal(pts('max-age=63072000; includeSubDomains; preload'), 20);
  assert.equal(pts('max-age=15552000'), 15);
  assert.equal(pts('max-age=2592000'), 10);
  assert.equal(pts('max-age=300'), 5);
  assert.equal(pts('max-age=0'), 0);
  const two = sectionOf(analyze('strict-transport-security: max-age=1\nstrict-transport-security: max-age=31536000'), 'hsts');
  assert.equal(two.points, 5);
  assert.match(texts(two.messages), /only the first/);
  assert.match(texts(sectionOf(analyze('strict-transport-security: max-age=31536000; preload'), 'hsts').messages), /also requires `includeSubDomains`/);
});

// ── Framing, nosniff, referrer ──────────────────────────

test('framing: X-Frame-Options values', () => {
  const st = (v) => sectionOf(analyze('x-frame-options: ' + v), 'framing');
  assert.equal(st('DENY').points, 15);
  assert.equal(st('sameorigin').points, 15);
  assert.equal(st('ALLOW-FROM https://a.example').status, 'bad');
  assert.equal(st('SAMEORIGIN, DENY').status, 'weak');
  assert.equal(st('ALLOWALL').status, 'invalid');
  assert.equal(sectionOf(analyze(''), 'framing').status, 'missing');
});

test('framing: frame-ancestors wins over X-Frame-Options', () => {
  const s = sectionOf(analyze("content-security-policy: frame-ancestors https://partner.example\nx-frame-options: ALLOW-FROM https://partner.example"), 'framing');
  assert.equal(s.status, 'good');
  assert.match(texts(s.messages), /ignore X-Frame-Options/);
  assert.match(texts(s.messages), /ALLOW-FROM/);
  assert.equal(sectionOf(analyze('content-security-policy: frame-ancestors *'), 'framing').status, 'weak');
});

test('nosniff: only the first value counts', () => {
  assert.equal(sectionOf(analyze('x-content-type-options: NoSniff'), 'xcto').points, 10);
  assert.equal(sectionOf(analyze('x-content-type-options: nosniff; mode=block'), 'xcto').status, 'invalid');
});

test('referrer: the last valid value wins', () => {
  const s = sectionOf(analyze('referrer-policy: no-referrer, strict-origin-when-cross-origin, bogus'), 'referrer');
  assert.equal(s.points, 10);
  assert.match(texts(s.messages), /`bogus` is not a referrer policy/);
  assert.equal(sectionOf(analyze('referrer-policy: unsafe-url'), 'referrer').status, 'bad');
  assert.equal(sectionOf(analyze('referrer-policy: no-referrer-when-downgrade'), 'referrer').points, 3);
  assert.equal(sectionOf(analyze(''), 'referrer').points, 5);
});

// ── Permissions-Policy ──────────────────────────────────

test('permissions: allowlists, origins and mistakes', () => {
  const pp = csh.analyzePermissionsPolicy('camera=(), geolocation=(self "https://maps.example.com"), fullscreen=*, usb=self');
  assert.equal(pp.ok, true);
  assert.deepEqual(pp.features.map((f) => f.allow), ['none', 'list', 'all', 'list']);
  assert.deepEqual(pp.features[1].origins, ['https://maps.example.com']);
  assert.match(texts(csh.analyzePermissionsPolicy('geolocation=(self https://maps.example.com)').messages), /must be quoted strings/);
  assert.match(texts(csh.analyzePermissionsPolicy('geolocation=("self")').messages), /Write `self` without quotes/);
  assert.match(texts(csh.analyzePermissionsPolicy("camera 'none'; microphone 'none'").messages), /old Feature-Policy syntax/);
  assert.match(texts(csh.analyzePermissionsPolicy('camra=()').messages), /not a feature this tool knows/);
  assert.match(texts(csh.analyzePermissionsPolicy('interest-cohort=()').messages), /FLoC/);
  assert.equal(csh.analyzePermissionsPolicy('ch-ua-model=*').messages.length, 0);
});

test('permissions: section score and legacy Feature-Policy note', () => {
  const s = sectionOf(analyze('permissions-policy: camera=()\nfeature-policy: camera \'none\''), 'permissions');
  assert.equal(s.points, 5);
  assert.match(texts(s.messages), /Feature-Policy is the legacy name/);
  assert.equal(sectionOf(analyze("permissions-policy: camera 'none'"), 'permissions').status, 'invalid');
});

// ── Cross-origin, cookies, CORS, disclosure, legacy ─────

test('cross-origin headers', () => {
  assert.equal(sectionOf(analyze('cross-origin-opener-policy: same-origin; report-to="coop"'), 'coop').points, 5);
  assert.equal(sectionOf(analyze('cross-origin-opener-policy: sameorigin'), 'coop').status, 'invalid');
  assert.equal(sectionOf(analyze('cross-origin-resource-policy: Same-Origin'), 'corp').status, 'invalid');
  const coep = sectionOf(analyze('cross-origin-opener-policy: same-origin\ncross-origin-embedder-policy: require-corp'), 'coep');
  assert.match(texts(coep.messages), /cross-origin isolated/);
});

test('cookies: flags, prefixes and privacy', () => {
  const s = sectionOf(analyze([
    'set-cookie: PHPSESSID=secret123; path=/',
    'set-cookie: a=1; SameSite=None',
    'set-cookie: __Host-id=1; Secure; Path=/app',
    'set-cookie: ok=1; Secure; HttpOnly; SameSite=Lax'
  ].join('\n')), 'cookies');
  const t = texts(s.messages);
  assert.match(t, /`PHPSESSID` looks like a session cookie but has no `HttpOnly`/);
  assert.match(t, /`SameSite=None` without `Secure`/);
  assert.match(t, /__Host- prefix requires/);
  assert.ok(!/secret123/.test(t + s.values.join('\n')));
  assert.equal(s.points, -5);
  assert.deepEqual(csh.parseSetCookie('n=v; Secure; SameSite=Strict').attrs.samesite, 'Strict');
});

test('cors: wildcard with credentials, lists and null', () => {
  assert.equal(sectionOf(analyze('access-control-allow-origin: *\naccess-control-allow-credentials: true'), 'cors').status, 'invalid');
  assert.equal(sectionOf(analyze('access-control-allow-origin: https://a.example https://b.example'), 'cors').status, 'invalid');
  assert.equal(sectionOf(analyze('access-control-allow-origin: null'), 'cors').status, 'bad');
  assert.equal(sectionOf(analyze('access-control-allow-origin: https://a.example'), 'cors').status, 'good');
});

test('disclosure and legacy headers', () => {
  const a = analyze('server: nginx/1.24.0\nx-powered-by: Express\nx-xss-protection: 0\npublic-key-pins: pin-sha256="x"; max-age=1');
  const d = sectionOf(a, 'disclosure');
  assert.equal(d.points, -5);
  assert.deepEqual(levels(d.messages), ['warn', 'info']);
  const legacy = sectionOf(a, 'legacy');
  assert.ok(legacy.messages.some((m) => m.level === 'ok' && /X-XSS-Protection: 0/.test(m.text)));
  assert.match(texts(legacy.messages), /HPKP/);
});

test('stray directive "headers" are reported', () => {
  const a = analyze("content-type: text/html\nscript-src: 'self'");
  assert.match(texts(sectionOf(a, 'stray').messages), /look like CSP directives written as headers/);
});

// ── Score ───────────────────────────────────────────────

test('score: grades and the sample', () => {
  assert.equal(csh.gradeFor(100, true), 'A+');
  assert.equal(csh.gradeFor(96, false), 'A');
  assert.equal(csh.gradeFor(70, true), 'B');
  assert.equal(csh.gradeFor(39, true), 'F');
  const empty = csh.analyzeHeaders([]);
  assert.equal(empty.score, 5);
  assert.equal(empty.grade, 'F');
  const sample = analyze(csh.SAMPLE_HEADERS);
  assert.ok(sample.score < 55, 'sample should score poorly, got ' + sample.score);
  assert.ok(sample.counts.error >= 3);
});

test('score: the default builder output earns full marks without errors', () => {
  const built = csh.buildHeaders(csh.defaultState());
  const a = csh.analyzeHeaders(built.headers, { origin: 'builder' });
  assert.equal(a.score, 95);
  assert.equal(a.grade, 'A+');
  assert.equal(a.counts.error + a.counts.bad + a.counts.warn, 0);
});

// ── Builder ─────────────────────────────────────────────

test('builder: default headers', () => {
  const names = csh.buildHeaders(csh.defaultState()).headers.map((h) => h.name + ': ' + h.value);
  assert.deepEqual(names, [
    "Content-Security-Policy: default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
    'Strict-Transport-Security: max-age=31536000',
    'X-Frame-Options: SAMEORIGIN',
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=(), microphone=(), geolocation=()'
  ]);
});

test('builder: every preset builds without invalid or unsafe findings except the compatible one', () => {
  Object.keys(csh.PRESETS).forEach((name) => {
    const st = csh.defaultState();
    st.csp.directives = csh.presetDirectives(name);
    st.csp.upgrade = csh.PRESETS[name].upgrade;
    const built = csh.buildHeaders(st);
    if (name === 'blank') {
      assert.equal(built.headers[0].name, 'Strict-Transport-Security');
      return;
    }
    const a = csh.analyzeHeaders(built.headers, { origin: 'builder' });
    const found = levels(a.sections[0].messages);
    assert.ok(!found.includes('error'), name + ': ' + texts(a.sections[0].messages));
    assert.equal(found.includes('bad'), name === 'compat', name);
  });
});

test('builder: services seed from the fallback and never restrict open directives', () => {
  const st = csh.defaultState();
  st.csp.services = { youtube: true, gfonts: true };
  const v = csh.buildCspValue(st.csp, null);
  assert.match(v, /frame-src 'self' https:\/\/www\.youtube\.com https:\/\/www\.youtube-nocookie\.com/);
  assert.match(v, /style-src 'self' https:\/\/fonts\.googleapis\.com/);
  assert.match(v, /font-src 'self' https:\/\/fonts\.gstatic\.com/);

  const strict = csh.defaultState();
  strict.csp.directives = csh.presetDirectives('strict');
  strict.csp.upgrade = false;
  strict.csp.services = { ga4: true, youtube: true };
  assert.equal(csh.buildCspValue(strict.csp, null),
    "script-src 'nonce-{RANDOM}' 'strict-dynamic' https://www.googletagmanager.com; object-src 'none'; base-uri 'none'");
});

test('builder: service script hosts also reach script-src-elem when it is set', () => {
  const st = csh.defaultState();
  st.csp.directives['script-src-elem'] = "'self'";
  st.csp.services = { turnstile: true };
  const v = csh.buildCspValue(st.csp, null);
  assert.match(v, /script-src-elem 'self' https:\/\/challenges\.cloudflare\.com/);
});

test('builder: service sources are all valid and name real directives', () => {
  csh.SERVICES.forEach((svc) => {
    Object.keys(svc.sources).forEach((dir) => {
      assert.ok(csh.DIRECTIVES[dir], svc.id + ': ' + dir);
      svc.sources[dir].forEach((src) => {
        const c = csh.classifySource(src);
        assert.ok(c.kind === 'host' || c.kind === 'scheme' || c.kind === 'keyword', svc.id + ': ' + src);
      });
    });
  });
});

test('builder: separators typed into a field cannot inject directives', () => {
  const st = csh.defaultState();
  st.csp.directives['img-src'] = "'self'; script-src *, data:";
  const v = csh.buildCspValue(st.csp, null);
  assert.match(v, /img-src 'self' script-src \* data:/);
  assert.equal(csh.parsePolicy(v).byName['script-src'], undefined);
});

test('builder: report-only, reporting endpoints and X-Frame-Options auto mode', () => {
  const st = csh.defaultState();
  st.csp.reportOnly = true;
  st.reporting = { url: 'https://example.com/csp', name: 'csp-endpoint' };
  const built = csh.buildHeaders(st);
  assert.equal(built.headers[0].name, 'Content-Security-Policy-Report-Only');
  assert.match(built.headers[0].value, /report-uri https:\/\/example\.com\/csp; report-to csp-endpoint/);
  assert.deepEqual(built.headers[1], { name: 'Reporting-Endpoints', value: 'csp-endpoint="https://example.com/csp"' });

  st.reporting.name = 'Bad Name';
  assert.match(texts(csh.buildHeaders(st).notes), /not valid/);

  const x = csh.defaultState();
  x.csp.directives['frame-ancestors'] = "'none'";
  assert.ok(csh.buildHeaders(x).headers.some((h) => h.name === 'X-Frame-Options' && h.value === 'DENY'));
  x.csp.directives['frame-ancestors'] = "'self' https://partner.example";
  const b = csh.buildHeaders(x);
  assert.ok(!b.headers.some((h) => h.name === 'X-Frame-Options'));
  assert.match(texts(b.notes), /cannot express the host list/);
});

test('builder: Permissions-Policy values', () => {
  const r = csh.permissionsValue({
    camera: { mode: 'none' },
    fullscreen: { mode: 'self' },
    autoplay: { mode: 'all' },
    geolocation: { mode: 'origins', origins: 'https://maps.example.com/path, nope https://maps.example.com' }
  });
  assert.equal(r.value, 'camera=(), geolocation=(self "https://maps.example.com"), fullscreen=(self), autoplay=*');
  assert.deepEqual(r.dropped, ['nope']);
  assert.equal(csh.analyzePermissionsPolicy(r.value).ok, true);
});

// ── Formats ─────────────────────────────────────────────

function stateWith(value, extra) {
  const st = csh.defaultState();
  st.csp.directives = csh.presetDirectives('blank');
  st.csp.upgrade = false;
  st.csp.directives['default-src'] = value;
  st.hsts.enabled = false;
  st.xfo = '';
  st.xcto = false;
  st.referrer = '';
  st.permissions = {};
  return Object.assign(st, extra || {});
}

test('formats: escaping per server', () => {
  const st = stateWith("'self' https://a.example/p%20q");
  st.permissions = { geolocation: { mode: 'origins', origins: 'https://maps.example.com' } };
  const built = csh.buildHeaders(st);
  const f = (name) => csh.formatConfig(name, built, st).text;
  assert.match(f('apache'), /p%%20q/);
  assert.match(f('nginx'), /geolocation=\(self \\"https:\/\/maps\.example\.com\\"\)" always;/);
  assert.match(f('iis'), /geolocation=\(self &quot;https:\/\/maps\.example\.com&quot;\)/);
  assert.match(f('traefikfile'), /Permissions-Policy: "geolocation=\(self \\"https:\/\/maps\.example\.com\\"\)"/);
  assert.match(f('headersfile'), /^\/\*$/m);
  assert.match(f('http'), /^Content-Security-Policy: default-src 'self' https:\/\/a\.example\/p%20q$/m);
});

test('formats: dollar signs are escaped for Compose and PHP and flagged for nginx', () => {
  const st = stateWith("'self' https://a.example/$x");
  const built = csh.buildHeaders(st);
  assert.match(csh.formatConfig('traefik', built, st).text, /\/\$\$x/);
  assert.match(csh.formatConfig('wordpress', built, st).text, /\/\\\$x/);
  assert.match(texts(csh.formatConfig('nginx', built, st).notes), /`\$`/);
});

test('formats: hiding server details', () => {
  const st = stateWith("'self'", { hideServer: true });
  const built = csh.buildHeaders(st);
  assert.match(csh.formatConfig('nginx', built, st).text, /server_tokens off;/);
  assert.match(csh.formatConfig('apache', built, st).text, /Header always unset X-Powered-By/);
  assert.match(csh.formatConfig('caddy', built, st).text, /\t-Server\n/);
  assert.match(csh.formatConfig('traefik', built, st).text, /customresponseheaders\.X-Powered-By="/);
  assert.match(csh.formatConfig('wordpress', built, st).text, /header_remove\('X-Powered-By'\);/);
  assert.match(csh.formatConfig('iis', built, st).text, /removeServerHeader="true"/);
});

test('formats: meta drops header-only directives', () => {
  const st = stateWith("'self'");
  st.csp.directives['frame-ancestors'] = "'none'";
  st.reporting = { url: '/csp', name: '' };
  st.referrer = 'no-referrer';
  const built = csh.buildHeaders(st);
  const out = csh.formatConfig('meta', built, st);
  assert.match(out.text, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'">/);
  assert.match(out.text, /<meta name="referrer" content="no-referrer">/);
  assert.match(texts(out.notes), /`frame-ancestors` and `report-uri` do not work in <meta>/);
  st.csp.reportOnly = true;
  assert.match(texts(csh.formatConfig('meta', csh.buildHeaders(st), st).notes), /Report-only policies cannot be delivered in <meta>/);
});

test('formats: nonce policies warn that a static server config cannot generate them', () => {
  const st = csh.defaultState();
  st.csp.directives = csh.presetDirectives('strict');
  const built = csh.buildHeaders(st);
  ['nginx', 'apache', 'caddy', 'traefik', 'traefikfile', 'headersfile', 'iis'].forEach((f) => {
    assert.match(texts(csh.formatConfig(f, built, st).notes), /A nonce must be generated by the application/, f);
  });
  ['http', 'meta', 'wordpress'].forEach((f) => {
    assert.ok(!/A nonce must be generated/.test(texts(csh.formatConfig(f, built, st).notes)), f);
  });
  assert.match(texts(csh.formatConfig('caddy', built, st).notes), /placeholder/);
});

test('formats: every format has a label and a file name', () => {
  Object.keys(csh.FORMATS).forEach((f) => {
    assert.ok(csh.FORMATS[f].label && csh.FORMATS[f].file, f);
    assert.ok(csh.formatConfig(f, csh.buildHeaders(csh.defaultState()), csh.defaultState()).text.length > 0, f);
  });
});

// ── Import ──────────────────────────────────────────────

test('import: a built header set round-trips through the analyzer', () => {
  const st = csh.defaultState();
  st.csp.services = { youtube: true };
  st.reporting = { url: 'https://example.com/r', name: 'csp' };
  st.permissions.geolocation = { mode: 'origins', origins: 'https://maps.example.com' };
  st.coop = 'same-origin-allow-popups';
  st.corp = 'same-site';
  st.xxss = true;
  st.hsts.includeSub = true;
  const built = csh.buildHeaders(st);
  const imported = csh.importHeaders(built.headers);
  assert.deepEqual(csh.buildHeaders(imported.state).headers, built.headers);
  assert.deepEqual(imported.skipped, []);
});

test('import: report-only policies, unknown directives and features', () => {
  const r = csh.importHeaders(headers([
    "content-security-policy-report-only: default-src 'self'; sandbox allow-scripts; prefetch-src 'self'",
    'permissions-policy: camera=(), gamepad=()',
    'x-frame-options: deny'
  ].join('\n')));
  assert.equal(r.state.csp.reportOnly, true);
  assert.equal(r.state.csp.directives['default-src'], "'self'");
  assert.deepEqual(r.skipped, ['sandbox', 'prefetch-src', 'gamepad']);
  assert.equal(r.state.xfo, 'DENY');
  assert.equal(r.state.hsts.enabled, false);
});

// ── Hashes & nonces ─────────────────────────────────────

test('hash: matches node:crypto and normalises line endings', async () => {
  const expected = "'sha256-" + nodeCrypto.createHash('sha256').update('alert(1)').digest('base64') + "'";
  assert.equal(await csh.cspHash('alert(1)', 'sha256'), expected);
  assert.equal(await csh.cspHash('a\r\nb\rc', 'sha256'), await csh.cspHash('a\nb\nc', 'sha256'));
  const h384 = await csh.cspHash('x', 'sha384');
  assert.equal(csh.classifySource(h384).wrongLength, false);
  const h512 = await csh.cspHash('x', 'sha512');
  assert.ok(h512.startsWith("'sha512-"));
  assert.equal(csh.classifySource(h512).wrongLength, false);
  const utf8 = "'sha256-" + nodeCrypto.createHash('sha256').update('console.log("кава")').digest('base64') + "'";
  assert.equal(await csh.cspHash('console.log("кава")'), utf8);
});

test('hash: extractInline unwraps script and style elements', () => {
  assert.deepEqual(csh.extractInline('<script type="module">\n  go();\n</script>'), { tag: 'script', content: '\n  go();\n' });
  assert.deepEqual(csh.extractInline('<STYLE>a{}</STYLE>'), { tag: 'style', content: 'a{}' });
  assert.equal(csh.extractInline('go();'), null);
});

test('nonce: randomNonce is 144 bits of base64', () => {
  const a = csh.randomNonce();
  const b = csh.randomNonce();
  assert.match(a, /^[A-Za-z0-9+/]{24}$/);
  assert.notEqual(a, b);
  assert.equal(csh.classifySource("'nonce-" + a + "'").bits, 144);
});
