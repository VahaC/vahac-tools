// tests/spf-dmarc-record-generator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const sdr = loadScript('spf-dmarc-record-generator/script.js');

const codes = (list) => list.map((i) => i.code);
const has = (list, c) => codes(list).includes(c);
const perm = (list) => list.filter((i) => i.perm).map((i) => i.code);
const text = (html) => String(html).replace(/<[^>]+>/g, '');
const spf = (v) => sdr.parseSpf(v);
const term = (raw) => sdr.parseTerm(raw);

function st(extra) {
  return Object.assign(sdr.blankState(), { d: 'example.com' }, extra || {});
}

// ─────────────────────────────────────────────────────────────────────────────
// SPF: record selection and the RFC 7208 grammar
// ─────────────────────────────────────────────────────────────────────────────

test('SPF version: only "v=spf1" followed by a space or the end selects a record (RFC 7208 §4.5)', () => {
  assert.equal(sdr.isSpfRecord('v=spf1'), true);
  assert.equal(sdr.isSpfRecord('v=spf1 -all'), true);
  assert.equal(sdr.isSpfRecord('V=SPF1 -all'), true);       // ABNF literals are case-insensitive
  assert.equal(sdr.isSpfRecord('v=spf10 -all'), false);
  assert.equal(sdr.isSpfRecord('v=spf1-all'), false);
  assert.equal(sdr.isSpfRecord(' v=spf1 -all'), false);
  assert.equal(sdr.isSpfRecord('spf2.0/pra -all'), false);
  assert.equal(sdr.isSpfRecord('v=DMARC1; p=none'), false);
});

test('SPF version: uppercase V=SPF1 parses but gets a note; not-SPF is a permerror', () => {
  const r = spf('V=SPF1 -all');
  assert.equal(r.isSpf, true);
  assert.ok(has(r.issues, 'spf-version-case'));
  assert.deepEqual(perm(r.issues), []);
  const n = spf('v=spf2 -all');
  assert.equal(n.isSpf, false);
  assert.deepEqual(perm(n.issues), ['spf-not-spf']);
});

test('SPF grammar: every mechanism of RFC 7208 §5 parses without errors', () => {
  const ok = [
    'all', 'include:_spf.example.com', 'a', 'a:mail.example.com', 'a/24', 'a//64', 'a/24//64',
    'a:mail.example.com/28//48', 'mx', 'mx:example.org', 'mx/30', 'mx:example.org/24//64',
    'ip4:192.0.2.1', 'ip4:192.0.2.0/24', 'ip4:0.0.0.0/1', 'ip6:2001:db8::1', 'ip6:2001:db8::/32',
    'ip6:::ffff:192.0.2.1', 'exists:%{i}.bl.example.com', 'exists:example.net'
  ];
  ok.forEach((raw) => {
    const t = term(raw);
    assert.equal(t.kind, 'mechanism', raw);
    assert.deepEqual(t.issues.filter((i) => i.level === 'error'), [], raw);
  });
  assert.equal(term('ptr').kind, 'mechanism');
  assert.equal(term('ptr:example.com').target, 'example.com');
});

test('SPF grammar: qualifiers + - ~ ? are read, and no qualifier means +', () => {
  [['+mx', '+'], ['-mx', '-'], ['~mx', '~'], ['?mx', '?'], ['mx', '']].forEach(([raw, q]) => {
    const t = term(raw);
    assert.equal(t.name, 'mx', raw);
    assert.equal(t.qualifier, q, raw);
  });
  assert.equal(spf('v=spf1 -all').allQualifier, '-');
  assert.equal(spf('v=spf1 ~all').allQualifier, '~');
  assert.equal(spf('v=spf1 ?all').allQualifier, '?');
  assert.equal(spf('v=spf1 all').allQualifier, '+');
});

test('SPF grammar: modifiers redirect=, exp= and unknown name=value (RFC 7208 §6)', () => {
  const r = spf('v=spf1 mx redirect=_spf.example.com exp=explain._spf.%{d}');
  const [mx, red, exp] = r.terms;
  assert.equal(mx.kind, 'mechanism');
  assert.equal(red.kind, 'modifier');
  assert.equal(red.name, 'redirect');
  assert.equal(red.target, '_spf.example.com');
  assert.equal(exp.kind, 'modifier');
  assert.equal(exp.name, 'exp');
  assert.equal(exp.target, null);                 // built from a macro
  assert.deepEqual(perm(r.issues), []);
  const u = term('moo.cow-far_out=man:dog/cat');
  assert.equal(u.kind, 'unknown-modifier');
  assert.equal(u.name, 'moo.cow-far_out');
  assert.ok(has(u.issues, 'spf-unknown-modifier'));
  assert.ok(u.issues.every((i) => !i.perm));
});

test('SPF grammar: names are case-insensitive and targets are lowercased', () => {
  const r = spf('v=spf1 INCLUDE:_SPF.Example.COM Mx IP4:192.0.2.1 -ALL');
  assert.deepEqual(r.terms.map((t) => t.name), ['include', 'mx', 'ip4', 'all']);
  assert.equal(r.terms[0].target, '_spf.example.com');
  assert.equal(r.allQualifier, '-');
  assert.deepEqual(perm(r.issues), []);
});

test('SPF grammar: terms are separated by one or more spaces only (1*SP)', () => {
  const r = spf('v=spf1  mx   ip4:192.0.2.1    -all   ');
  assert.equal(r.terms.length, 3);
  assert.deepEqual(perm(r.issues), []);
  const tab = spf('v=spf1 mx\t-all');
  assert.deepEqual(perm(tab.issues), ['spf-whitespace']);
  const nl = spf('v=spf1 mx\n-all');
  assert.ok(perm(nl.issues).includes('spf-whitespace'));
});

test('SPF CIDR: ip4 0–32 and ip6 0–128 without leading zeros (RFC 7208 §5.6)', () => {
  assert.equal(sdr.parseCidr('0', 32), 0);
  assert.equal(sdr.parseCidr('32', 32), 32);
  assert.equal(sdr.parseCidr('33', 32), null);
  assert.equal(sdr.parseCidr('08', 32), null);
  assert.equal(sdr.parseCidr('128', 128), 128);
  assert.equal(sdr.parseCidr('129', 128), null);
  assert.equal(sdr.parseCidr('', 32), null);
  assert.equal(sdr.parseCidr('2a', 32), null);
  assert.ok(has(term('ip4:192.0.2.0/33').issues, 'spf-cidr-bad'));
  assert.ok(has(term('ip4:192.0.2.0/024').issues, 'spf-cidr-bad'));
  assert.ok(has(term('ip6:2001:db8::/129').issues, 'spf-cidr-bad'));
  assert.ok(has(term('a/33').issues, 'spf-cidr-bad'));
  assert.ok(has(term('mx//129').issues, 'spf-cidr-bad'));
  const dual = term('a:mail.example.com/24//64');
  assert.equal(dual.cidr4, 24);
  assert.equal(dual.cidr6, 64);
  assert.equal(dual.target, 'mail.example.com');
  assert.ok(term('a/24/64').issues.some((i) => i.perm));   // IPv6 prefix needs //
});

test('SPF macros: valid forms from RFC 7208 §7.1 and §7.4', () => {
  ['%{s}', '%{o}', '%{d}', '%{d4}', '%{d2}', '%{dr}', '%{d2r}', '%{l}', '%{l-}', '%{lr-}', '%{l1r-}', '%{ir}.%{v}._spf.%{d2}', '%{I}', '%%', '%_', '%-', '%{h}'].forEach((m) => {
    const s = sdr.scanMacroString(m);
    assert.deepEqual(s.errors, [], m);
    assert.equal(s.hasMacro, true, m);
  });
  const upper = sdr.scanMacroString('%{IR}').macros[0];
  assert.equal(upper.letter, 'i');
  assert.equal(upper.upper, true);
  assert.equal(upper.reverse, true);
  const t = term('exists:%{ir}.%{v}._spf.%{d2}');
  assert.deepEqual(t.issues, []);
  assert.equal(t.target, null);
});

test('SPF macros: malformed macros are permerrors (RFC 7208 §7.3)', () => {
  const cases = [
    ['-exists:%(ir).sbl.example.org', 'spf-macro-percent'],   // the RFC's own bad example
    ['exists:%{x}.example.com', 'spf-macro-letter'],
    ['exists:%{d0}.example.com', 'spf-macro-zero'],
    ['exists:%{i.example.com', 'spf-macro-unclosed'],
    ['exists:%{i?}.example.com', 'spf-macro-bad'],
    ['include:%{c}.example.com', 'spf-macro-exp-only'],
    ['a:%{r}.example.com', 'spf-macro-exp-only'],
    ['exists:%{t}.example.com', 'spf-macro-exp-only']
  ];
  cases.forEach(([raw, c]) => {
    const t = term(raw);
    assert.ok(t.issues.some((i) => i.code === c && i.perm), raw + ' → ' + codes(t.issues).join(','));
  });
  const p = term('exists:%{p}.example.com');
  assert.ok(has(p.issues, 'spf-macro-p'));
  assert.ok(p.issues.every((i) => !i.perm));
});

test('SPF domain-spec: the target must end in a top-level label (domain-end)', () => {
  assert.ok(perm(term('include:localhost').issues).includes('spf-domain-end'));
  assert.ok(perm(term('include:example.123').issues).includes('spf-domain-end'));
  assert.ok(perm(term('a:192.0.2.1').issues).includes('spf-target-ip'));
  assert.deepEqual(term('include:_spf.xn--p1ai').issues, []);
  assert.deepEqual(term('include:spf.my-host.example').issues, []);
  assert.deepEqual(term('a:%{d}').issues, []);                      // may end with a macro
  const dot = term('include:_spf.example.com.');
  assert.ok(has(dot.issues, 'spf-trailing-dot'));
  assert.equal(dot.target, '_spf.example.com');
  const long = term('include:' + 'a'.repeat(64) + '.example.com');
  assert.ok(has(long.issues, 'spf-domain-malformed'));
  assert.ok(perm(term('include:').issues).includes('spf-missing-domain'));
  assert.ok(perm(term('exists').issues).includes('spf-missing-domain'));
  assert.ok(perm(term('a:').issues).includes('spf-missing-domain'));
  assert.ok(perm(term('all:example.com').issues).includes('spf-all-arg'));
});

// ─────────────────────────────────────────────────────────────────────────────
// SPF: ip4 / ip6
// ─────────────────────────────────────────────────────────────────────────────

test('IPv4: dotted quads exactly as qnum allows', () => {
  assert.deepEqual(sdr.parseIp4('192.0.2.1'), [192, 0, 2, 1]);
  assert.deepEqual(sdr.parseIp4('0.0.0.0'), [0, 0, 0, 0]);
  assert.deepEqual(sdr.parseIp4('255.255.255.255'), [255, 255, 255, 255]);
  ['256.0.0.1', '01.2.3.4', '1.2.3', '1.2.3.4.5', '1.2.3.-4', ' 1.2.3.4', '1.2.3.4 ', 'a.b.c.d', ''].forEach((s) => {
    assert.equal(sdr.parseIp4(s), null, s);
  });
});

test('IPv6: every RFC 4291 §2.2 text form, and the invalid ones', () => {
  assert.deepEqual(sdr.parseIp6('::'), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(sdr.parseIp6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(sdr.parseIp6('2001:DB8::'), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(sdr.parseIp6('1:2:3:4:5:6:7:8'), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(sdr.parseIp6('1:2:3:4:5:6:7::'), [1, 2, 3, 4, 5, 6, 7, 0]);
  assert.deepEqual(sdr.parseIp6('::ffff:192.0.2.1'), [0, 0, 0, 0, 0, 0xffff, 0xc000, 0x0201]);
  assert.deepEqual(sdr.parseIp6('::192.0.2.1'), [0, 0, 0, 0, 0, 0, 0xc000, 0x0201]);
  assert.deepEqual(sdr.parseIp6('1:2:3:4:5:6:192.0.2.1'), [1, 2, 3, 4, 5, 6, 0xc000, 0x0201]);
  ['1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7', ':::', '1::2::3', '12345::', ':1:2:3:4:5:6:7', '1:2:3:4:5:6:7:',
    'fe80::1%eth0', '1:2:3:4:5:6:7:192.0.2.1', '::300.1.1.1', 'g::1', ''].forEach((s) => {
    assert.equal(sdr.parseIp6(s), null, s);
  });
});

test('IPv6: RFC 5952 output form for network addresses', () => {
  assert.equal(sdr.formatIp6(sdr.parseIp6('2001:0db8:0:0:0:0:2:1')), '2001:db8::2:1');
  assert.equal(sdr.formatIp6(sdr.parseIp6('2001:db8:0:0:1:0:0:1')), '2001:db8::1:0:0:1');
  assert.equal(sdr.formatIp6(sdr.parseIp6('2001:db8:0:1:1:1:1:1')), '2001:db8:0:1:1:1:1:1');
  assert.equal(sdr.formatIp6(sdr.parseIp6('::')), '::');
  assert.equal(sdr.ip6Info(sdr.parseIp6('2001:db8:1234::5'), 32).network, '2001:db8::');
  assert.equal(sdr.ip6Info(sdr.parseIp6('2001:db8:1234::5'), 32).hostBits, true);
  assert.equal(sdr.ip6Info(sdr.parseIp6('2001:db8:1200::'), 39).network, '2001:db8:1200::');
});

test('ip4 ranges: size, first and last address, host bits', () => {
  const a = sdr.ip4Info([192, 0, 2, 0], 24);
  assert.deepEqual([a.count, a.first, a.last, a.hostBits], [256, '192.0.2.0', '192.0.2.255', false]);
  const b = sdr.ip4Info([192, 0, 2, 10], 24);
  assert.deepEqual([b.first, b.hostBits], ['192.0.2.0', true]);
  assert.equal(sdr.ip4Info([203, 0, 113, 7], 32).count, 1);
  assert.equal(sdr.ip4Info([10, 1, 2, 3], 0).count, 4294967296);
  assert.equal(sdr.ip4Info([10, 1, 2, 3], 0).last, '255.255.255.255');
  assert.equal(sdr.ip4Info([198, 51, 100, 17], 28).first, '198.51.100.16');
});

test('ip4/ip6 errors name the value and the fix', () => {
  const cases = [
    ['ip4:192.0.2.300', 'spf-ip4-range'],
    ['ip4:01.2.3.4', 'spf-ip4-range'],
    ['ip4:192.0.2', 'spf-ip4-short'],
    ['ip4:2001:db8::1', 'spf-ip4-is-ip6'],
    ['ip4:mail.example.com', 'spf-ip4-bad'],
    ['ip4:', 'spf-ip-missing'],
    ['ip6:192.0.2.1', 'spf-ip6-is-ip4'],
    ['ip6:1::2::3', 'spf-ip6-bad'],
    ['ip6:fe80::1%eth0', 'spf-ip6-bad']
  ];
  cases.forEach(([raw, c]) => {
    const t = term(raw);
    const hit = t.issues.find((i) => i.code === c);
    assert.ok(hit && hit.perm, raw + ' → ' + codes(t.issues).join(','));
    assert.ok(text(hit.msg).includes(raw), raw);
  });
  const host = term('ip4:192.0.2.10/24');
  assert.ok(has(host.issues, 'spf-ip-hostbits'));
  assert.ok(host.issues.every((i) => !i.perm));
  assert.ok(has(term('ip4:0.0.0.0/0').issues, 'spf-ip-everything'));
  assert.ok(has(term('ip6:::/0').issues, 'spf-ip-everything'));
  assert.ok(has(term('ip4:10.0.0.0/4').issues, 'spf-ip-wide'));
  assert.ok(!has(term('ip4:40.92.0.0/15').issues, 'spf-ip-wide'));
});

// ─────────────────────────────────────────────────────────────────────────────
// SPF: record-level errors and warnings
// ─────────────────────────────────────────────────────────────────────────────

test('Unknown terms are permerrors with a suggestion', () => {
  const r = spf('v=spf1 inlcude:_spf.example.com -all');
  const u = r.issues.find((i) => i.code === 'spf-unknown-mechanism');
  assert.ok(u && u.perm);
  assert.ok(text(u.fix).includes('include:_spf.example.com'));
  assert.ok(text(term('ip:192.0.2.1').issues[0].fix).includes('ip4:'));
  assert.ok(text(term('redirect:_spf.example.com').issues[0].fix).includes('redirect=_spf.example.com'));
  assert.ok(term('+redirect=_spf.example.com').issues.some((i) => i.perm));   // modifiers take no qualifier
  assert.ok(term('foo').issues.some((i) => i.perm));
});

test('+all and a bare all authorize everyone (error, valid syntax)', () => {
  ['v=spf1 mx +all', 'v=spf1 mx all'].forEach((v) => {
    const r = spf(v);
    const e = r.issues.find((i) => i.code === 'spf-plus-all');
    assert.ok(e, v);
    assert.equal(e.level, 'error');
    assert.equal(e.perm, false);
    assert.equal(r.permerror, false);
  });
});

test('?all with nothing else is the same as no policy; with mechanisms it is just neutral', () => {
  assert.ok(has(spf('v=spf1 ?all').issues, 'spf-neutral-only'));
  assert.ok(!has(spf('v=spf1 mx ?all').issues, 'spf-neutral-only'));
  assert.ok(has(spf('v=spf1').issues, 'spf-empty'));
  assert.ok(has(spf('v=spf1 mx').issues, 'spf-no-all'));
  assert.ok(!has(spf('v=spf1 mx redirect=_spf.example.com').issues, 'spf-no-all'));
});

test('ptr is flagged as SHOULD NOT (RFC 7208 §5.5) but is valid', () => {
  const r = spf('v=spf1 ptr -all');
  const w = r.issues.find((i) => i.code === 'spf-ptr');
  assert.equal(w.level, 'warning');
  assert.equal(r.permerror, false);
  assert.equal(r.ownLookups, 1);
});

test('redirect together with all: redirect is ignored and not counted (RFC 7208 §6.1)', () => {
  const r = spf('v=spf1 mx redirect=_spf.example.com -all');
  assert.ok(has(r.issues, 'spf-redirect-with-all'));
  assert.equal(r.redirect.ignored, true);
  assert.equal(r.redirect.counts, false);
  assert.equal(r.ownLookups, 1);
  const r2 = spf('v=spf1 mx redirect=_spf.example.com');
  assert.equal(r2.redirect.counts, true);
  assert.equal(r2.ownLookups, 2);
});

test('redirect and exp may appear once each; modifiers belong at the end', () => {
  assert.deepEqual(perm(spf('v=spf1 redirect=a.example redirect=b.example').issues), ['spf-redirect-twice']);
  assert.deepEqual(perm(spf('v=spf1 -all exp=a.example exp=b.example').issues), ['spf-exp-twice']);
  assert.ok(has(spf('v=spf1 redirect=a.example mx').issues, 'spf-modifier-order'));
  assert.ok(!has(spf('v=spf1 mx -all exp=e.example').issues, 'spf-modifier-order'));
});

test('Mechanisms after all are never evaluated and do not count', () => {
  const r = spf('v=spf1 -all include:_spf.example.com mx');
  assert.ok(has(r.issues, 'spf-after-all'));
  assert.equal(r.ownLookups, 0);
  assert.deepEqual(r.terms.map((t) => t.afterAll), [false, true, true]);
  const two = spf('v=spf1 ~all -all');
  assert.equal(two.allQualifier, '~');
  assert.ok(has(two.issues, 'spf-after-all'));
});

test('Typical mistakes: ip4=, merged records, duplicates, long records, non-ASCII', () => {
  assert.ok(has(spf('v=spf1 ip4=192.0.2.1 -all').issues, 'spf-modifier-typo'));
  assert.ok(has(spf('v=spf1 a -all v=spf1 mx -all').issues, 'spf-merged'));
  assert.ok(has(spf('v=spf1 mx mx -all').issues, 'spf-duplicate'));
  const long = 'v=spf1 ' + Array.from({ length: 30 }, (_, i) => 'ip4:198.51.100.' + i).join(' ') + ' -all';
  assert.ok(long.length > 450);
  assert.ok(has(spf(long).issues, 'spf-long'));
  assert.ok(perm(spf('v=spf1 include:_spf.exämple.com -all').issues).includes('spf-non-ascii'));
});

// ─────────────────────────────────────────────────────────────────────────────
// SPF: DNS-lookup counting (RFC 7208 §4.6.4)
// ─────────────────────────────────────────────────────────────────────────────

test('Lookup terms: include, a, mx, ptr, exists and redirect count; all, ip4, ip6 and exp do not', () => {
  assert.equal(spf('v=spf1 a mx ptr exists:%{i}.x.example include:a.example redirect=b.example').ownLookups, 6);
  assert.equal(spf('v=spf1 ip4:192.0.2.1 ip6:2001:db8::1 exp=e.example -all').ownLookups, 0);
  assert.equal(spf('v=spf1 a:x.example/24 mx:y.example -all').ownLookups, 2);
});

test('Nested includes: the total is exact when every included record is pasted', () => {
  const r = sdr.checkRecords([
    'example.com:',
    'v=spf1 mx include:x.example include:y.example ~all',
    'x.example:',
    'v=spf1 include:z.example a -all',
    'z.example:',
    'v=spf1 ip4:192.0.2.0/24 -all',
    'y.example:',
    'v=spf1 a:m1.y.example a:m2.y.example -all'
  ].join('\n'), 'example.com');
  const root = r.spf[0];
  assert.equal(root.domain, 'example.com');
  assert.equal(root.isRoot, true);
  assert.equal(root.lookups.total, 3 + 2 + 0 + 2);
  assert.equal(root.lookups.exact, true);
  assert.equal(r.spf.filter((g) => g.isRoot).length, 1);
  assert.equal(root.lookups.tree.children[0].domain, 'x.example');
  assert.equal(root.lookups.tree.children[0].total, 2);
});

test('Missing includes: "at least N" counts the include itself and lists what is missing', () => {
  const r = sdr.checkRecords('v=spf1 include:_spf.example.net include:spf.example.org mx ~all', 'example.com');
  const g = r.spf[0];
  assert.equal(g.lookups.total, 3);
  assert.equal(g.lookups.exact, false);
  assert.deepEqual(g.lookups.unresolved.map((u) => u.domain), ['_spf.example.net', 'spf.example.org']);
  assert.ok(has(g.issues, 'spf-unresolved'));
});

test('redirect is followed into the pasted record', () => {
  const r = sdr.checkRecords([
    'example.com: v=spf1 redirect=_spf.example.com',
    '_spf.example.com: v=spf1 include:a.example -all',
    'a.example: v=spf1 ip4:192.0.2.1 -all'
  ].join('\n'));
  const g = r.spf.find((x) => x.domain === 'example.com');
  assert.equal(g.isRoot, true);
  assert.equal(g.lookups.total, 2);
  assert.equal(g.lookups.exact, true);
});

test('More than 10 lookups is a permerror, exactly 10 is a note, 10 with unknown includes a warning', () => {
  const eleven = sdr.checkRecords('v=spf1 a mx ptr ' + [1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'include:s' + i + '.example.com').join(' ') + ' -all', 'example.com');
  assert.equal(eleven.spf[0].lookups.total, 11);
  assert.ok(eleven.spf[0].issues.some((i) => i.code === 'spf-too-many-lookups' && i.perm));
  const nested = sdr.checkRecords([
    'example.com: v=spf1 include:a.example include:b.example -all',
    'a.example: v=spf1 a mx ptr exists:%{i}.x.example ~all',
    'b.example: v=spf1 a:1.example a:2.example a:3.example a:4.example a:5.example ~all'
  ].join('\n'));
  assert.equal(nested.spf[0].lookups.total, 11);
  assert.equal(nested.spf[0].lookups.exact, true);
  assert.ok(has(nested.spf[0].issues, 'spf-too-many-lookups'));
  const ten = sdr.checkRecords('v=spf1 a mx ' + [1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'a:h' + i + '.example.com').join(' ') + ' -all', 'example.com');
  assert.equal(ten.spf[0].lookups.total, 10);
  assert.ok(has(ten.spf[0].issues, 'spf-at-limit'));
  assert.ok(!has(ten.spf[0].issues, 'spf-too-many-lookups'));
  const tenOpen = sdr.checkRecords('v=spf1 a mx ' + [1, 2, 3, 4, 5, 6, 7, 8].map((i) => 'include:s' + i + '.example.com').join(' ') + ' -all', 'example.com');
  assert.ok(has(tenOpen.spf[0].issues, 'spf-at-limit-unknown'));
});

test('Include loops, macro targets and broken nested records', () => {
  const loop = sdr.checkRecords('a.example: v=spf1 include:b.example -all\nb.example: v=spf1 include:a.example -all');
  assert.ok(loop.spf[0].issues.some((i) => i.code === 'spf-loop' && i.perm));
  assert.equal(loop.spf[0].lookups.exact, false);
  const dyn = sdr.checkRecords('v=spf1 include:%{d}.spf.example.net -all', 'example.com');
  assert.equal(dyn.spf[0].lookups.dynamic.length, 1);
  assert.ok(has(dyn.spf[0].issues, 'spf-dynamic'));
  const broken = sdr.checkRecords('example.com: v=spf1 include:bad.example -all\nbad.example: v=spf1 ip4:300.1.1.1 -all');
  assert.ok(has(broken.spf[0].issues, 'spf-nested-permerror'));
});

test('Several SPF records at one name are a permerror (RFC 7208 §3.2)', () => {
  const r = sdr.checkRecords('example.com. 300 IN TXT "v=spf1 mx -all"\nexample.com. 300 IN TXT "v=spf1 include:_spf.example.net -all"');
  assert.equal(r.spf.length, 1);
  assert.equal(r.spf[0].records.length, 2);
  assert.ok(r.spf[0].issues.some((i) => i.code === 'spf-multiple' && i.perm));
});

test('Roots: the domain field comes first; included records are not roots', () => {
  const r = sdr.checkRecords('other.example: v=spf1 -all\n_spf.example.com: v=spf1 ip4:192.0.2.1 -all\nexample.com: v=spf1 include:_spf.example.com -all', 'example.com');
  assert.deepEqual(r.spf.map((g) => [g.domain, !!g.isRoot]), [['example.com', true], ['other.example', true], ['_spf.example.com', false]]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pasted input: dig, nslookup, zone files, labels
// ─────────────────────────────────────────────────────────────────────────────

test('TXT rdata: quoted strings are joined without spaces (RFC 7208 §3.3)', () => {
  const p = sdr.parseTxtRdata('"v=spf1 .... first" "second string..."');
  assert.deepEqual(p.strings, ['v=spf1 .... first', 'second string...']);
  assert.equal(p.strings.join(''), 'v=spf1 .... firstsecond string...');
  assert.deepEqual(sdr.parseTxtRdata('"a\\"b\\\\c"').strings, ['a"b\\c']);
  assert.deepEqual(sdr.parseTxtRdata('"caf\\195\\169"').strings[0].length, 5);
  assert.deepEqual(sdr.parseTxtRdata('"v=spf1 -all" ; a comment').strings, ['v=spf1 -all']);
  assert.deepEqual(sdr.parseTxtRdata('"unclosed').issues.map((i) => i.code), ['txt-unclosed']);
  assert.deepEqual(sdr.parseTxtRdata('v=spf1 -all').strings, ['v=spf1 -all']);
});

test('Input: full dig output with comments and several records', () => {
  const dig = [
    '; <<>> DiG 9.18 <<>> TXT example.com',
    ';; ANSWER SECTION:',
    'example.com.\t\t300\tIN\tTXT\t"google-site-verification=abc123"',
    'example.com.\t\t300\tIN\tTXT\t"v=spf1 include:_spf.example.net " "ip4:192.0.2.1 ~all"',
    '',
    ';; Query time: 20 msec'
  ].join('\n');
  const p = sdr.parseRecordsInput(dig, null);
  assert.equal(p.entries.length, 2);
  assert.equal(p.entries[1].domain, 'example.com');
  assert.equal(p.entries[1].value, 'v=spf1 include:_spf.example.net ip4:192.0.2.1 ~all');
  assert.equal(p.ignored.length, 0);
  const r = sdr.checkRecords(dig, '');
  assert.equal(r.spf.length, 1);
  assert.equal(r.other.length, 1);
});

test('Input: Windows nslookup output with blank lines and multi-string records', () => {
  const ns = [
    'Server:  router.lan',
    'Address:  192.168.1.1',
    '',
    'Non-authoritative answer:',
    'example.com\ttext =',
    '',
    '\t"v=spf1 include:_spf.example.net "',
    '\t"-all"',
    'example.com\ttext =',
    '',
    '\t"other-token=1"'
  ].join('\n');
  const p = sdr.parseRecordsInput(ns, null);
  assert.deepEqual(p.entries.map((e) => [e.domain, e.value]), [
    ['example.com', 'v=spf1 include:_spf.example.net -all'],
    ['example.com', 'other-token=1']
  ]);
  assert.equal(p.ignored.length, 0);
  const linux = sdr.parseRecordsInput('example.com\ttext = "v=spf1 -all"', null);
  assert.equal(linux.entries[0].value, 'v=spf1 -all');
});

test('Input: zone files with parentheses, relative names, @ and TTL/class in any order', () => {
  const zone = [
    '$ORIGIN example.com.',
    '@ 3600 IN TXT ( "v=spf1 ip4:192.0.2.1 "',
    '               "-all" )',
    '_dmarc IN 3600 TXT "v=DMARC1; p=none"',
    'mail.example.org. TXT "v=spf1 a -all"'
  ].join('\n');
  const p = sdr.parseRecordsInput(zone, 'example.com');
  assert.deepEqual(p.entries.map((e) => [e.domain, e.value]), [
    ['example.com', 'v=spf1 ip4:192.0.2.1 -all'],
    ['_dmarc.example.com', 'v=DMARC1; p=none'],
    ['mail.example.org', 'v=spf1 a -all']
  ]);
});

test('Input: name labels with a colon, name-value lines, bare names and dig +short lines', () => {
  const txt = [
    'example.com:',
    'v=spf1 include:_spf.example.net -all',
    '_spf.example.net  "v=spf1 ip4:198.51.100.0/24 -all"',
    '_dmarc.example.com: v=DMARC1; p=reject',
    'Example.ORG',
    '"v=spf1 mx -all"',
    'ip4:192.0.2.1',
    'v=spf1 ip6:2001:db8::/32 -all'
  ].join('\n');
  const p = sdr.parseRecordsInput(txt, null);
  assert.deepEqual(p.entries.map((e) => e.domain), ['example.com', '_spf.example.net', '_dmarc.example.com', 'example.org', 'example.org']);
  assert.deepEqual(p.ignored, [{ line: 7, text: 'ip4:192.0.2.1' }]);
});

test('Classification: leading space, Sender ID, near-miss SPF and other TXT records', () => {
  assert.equal(sdr.classifyTxt(' v=spf1 -all'), 'leading-space');
  assert.equal(sdr.classifyTxt('spf2.0/mfrom,pra mx -all'), 'senderid');
  assert.equal(sdr.classifyTxt('v=spf1include:x.example -all'), 'spf-other');
  assert.equal(sdr.classifyTxt('google-site-verification=x'), 'other');
  assert.equal(sdr.classifyTxt('v=DMARC1', 'example.com._report._dmarc.rua.example.net'), 'dmarc-auth');
  assert.equal(sdr.classifyTxt('v=DMARC1; p=none', '_dmarc.example.com'), 'dmarc');
});

test('Zone input: unquoted values and over-long strings are flagged', () => {
  const r = sdr.checkRecords('example.com. IN TXT v=spf1 -all');
  assert.ok(has(r.spf[0].issues, 'txt-unquoted'));
  const longStr = '"v=spf1 ' + 'ip4:192.0.2.1 '.repeat(20) + '-all"';
  const r2 = sdr.checkRecords(longStr, 'example.com');
  assert.ok(has(r2.spf[0].issues, 'txt-string-long'));
});

// ─────────────────────────────────────────────────────────────────────────────
// DMARC parser (RFC 9989)
// ─────────────────────────────────────────────────────────────────────────────

test('DMARC: every RFC 9989 tag is read and nothing is flagged as an error', () => {
  const d = sdr.parseDmarc('v=DMARC1; p=quarantine; sp=reject; np=reject; adkim=s; aspf=s; rua=mailto:a@example.com; ruf=mailto:f@example.com; fo=1:d:s; t=y; psd=n');
  assert.equal(d.usable, true);
  assert.deepEqual(d.issues.filter((i) => i.level === 'error'), []);
  const e = d.effective;
  assert.deepEqual([e.p, e.sp, e.np, e.adkim, e.aspf, e.fo, e.t, e.psd], ['quarantine', 'reject', 'reject', 's', 's', '1:d:s', 'y', 'n']);
  assert.deepEqual(e.rua.map((u) => u.address), ['a@example.com']);
  assert.deepEqual(e.ruf.map((u) => u.address), ['f@example.com']);
});

test('DMARC defaults: adkim=r, aspf=r, fo=0, t=n, psd=u; sp falls back to p and np to sp', () => {
  const d = sdr.parseDmarc('v=DMARC1; p=none; rua=mailto:d@example.com');
  const e = d.effective;
  assert.deepEqual([e.adkim, e.aspf, e.fo, e.t, e.psd, e.spEff, e.npEff], ['r', 'r', '0', 'n', 'u', 'none', 'none']);
  const d2 = sdr.parseDmarc('v=DMARC1; p=reject; sp=quarantine').effective;
  assert.deepEqual([d2.spEff, d2.npEff], ['quarantine', 'quarantine']);
  const d3 = sdr.parseDmarc('v=DMARC1; p=quarantine; np=reject').effective;
  assert.deepEqual([d3.spEff, d3.npEff], ['quarantine', 'reject']);
});

test('DMARC whitespace and separators: WSP around = and ;, optional trailing ;', () => {
  const d = sdr.parseDmarc('v = DMARC1 ;  p = none ;\trua = mailto:a@example.com , mailto:b@example.com ;');
  assert.equal(d.usable, true);
  assert.equal(d.effective.p, 'none');
  assert.equal(d.effective.rua.length, 2);
  assert.ok(has(sdr.parseDmarc('v=DMARC1;; p=none').issues, 'dmarc-empty-segment'));
  assert.ok(!has(sdr.parseDmarc('v=DMARC1; p=none;').issues, 'dmarc-empty-segment'));
});

test('DMARC v tag: must come first and be exactly DMARC1 (case-sensitive)', () => {
  assert.ok(has(sdr.parseDmarc('p=none; v=DMARC1').issues, 'dmarc-v-first'));
  assert.equal(sdr.parseDmarc('p=none; v=DMARC1').usable, false);
  assert.ok(has(sdr.parseDmarc('v=dmarc1; p=none').issues, 'dmarc-v-case'));
  assert.ok(has(sdr.parseDmarc('v=DMARC2; p=none').issues, 'dmarc-v-value'));
  assert.ok(has(sdr.parseDmarc('v=DMARC1 p=none').issues, 'dmarc-no-semicolon'));
  assert.equal(sdr.parseDmarc('v=DMARC1 p=none').usable, false);
});

test('DMARC p: missing is treated as none (RFC 9989), misplaced is legal but warned (RFC 7489)', () => {
  const miss = sdr.parseDmarc('v=DMARC1; rua=mailto:a@example.com');
  assert.ok(has(miss.issues, 'dmarc-p-missing'));
  assert.equal(miss.effective.p, 'none');
  const late = sdr.parseDmarc('v=DMARC1; rua=mailto:a@example.com; p=reject');
  const w = late.issues.find((i) => i.code === 'dmarc-p-order');
  assert.equal(w.level, 'warning');
  assert.equal(w.ref.rfc, '7489');
  assert.equal(late.effective.p, 'reject');
  assert.ok(!has(sdr.parseDmarc('v=DMARC1; p=reject').issues, 'dmarc-p-order'));
});

test('DMARC invalid policy: with a valid rua receivers act as p=none, without it no DMARC at all', () => {
  const withRua = sdr.parseDmarc('v=DMARC1; p=block; rua=mailto:a@example.com');
  assert.ok(has(withRua.issues, 'dmarc-policy-invalid'));
  const eff = withRua.issues.find((i) => i.code === 'dmarc-policy-effect');
  assert.ok(text(eff.msg).includes('p=none'));
  assert.equal(withRua.effective.p, 'none');
  const noRua = sdr.parseDmarc('v=DMARC1; p=block');
  assert.ok(text(noRua.issues.find((i) => i.code === 'dmarc-policy-effect').msg).includes('no DMARC processing'));
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none; sp=strict').issues, 'dmarc-policy-invalid'));
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none; np=x').issues, 'dmarc-policy-invalid'));
  const sug = sdr.parseDmarc('v=DMARC1; p=rejcet').issues.find((i) => i.code === 'dmarc-policy-invalid');
  assert.ok(text(sug.fix).includes('p=reject'));
});

test('DMARC invalid values fall back to defaults', () => {
  const d = sdr.parseDmarc('v=DMARC1; p=none; adkim=x; aspf=1; t=yes; psd=maybe; fo=2');
  ['dmarc-align-invalid', 'dmarc-t-invalid', 'dmarc-psd-invalid', 'dmarc-fo-invalid'].forEach((c) => assert.ok(has(d.issues, c), c));
  assert.deepEqual([d.effective.adkim, d.effective.aspf, d.effective.t, d.effective.psd, d.effective.fo], ['r', 'r', 'n', 'u', '0']);
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none; psd=y').issues, 'dmarc-psd-y'));
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none; rua=').issues, 'dmarc-empty-value'));
});

test('DMARC fo grammar: 0 and 1 exclusive, d and s at most once, colons without spaces', () => {
  assert.deepEqual(sdr.parseFo('0').parts, ['0']);
  assert.deepEqual(sdr.parseFo('1:d:s').parts, ['1', 'd', 's']);
  assert.deepEqual(sdr.parseFo('d').parts, ['d']);
  assert.deepEqual(sdr.parseFo('d:s').parts, ['d', 's']);
  assert.deepEqual(sdr.parseFo('s:D:0').parts, ['s', 'd', '0']);
  assert.equal(sdr.parseFo('0:1').ok, false);
  assert.equal(sdr.parseFo('d:d').ok, false);
  assert.equal(sdr.parseFo('2').ok, false);
  assert.equal(sdr.parseFo('').ok, false);
  assert.equal(sdr.parseFo('0 : d').spaces, true);
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none; ruf=mailto:f@example.com; fo=0 : d').issues, 'dmarc-fo-spaces'));
});

test('DMARC tag names: duplicates invalidate the list, uppercase names are warned, typos suggested', () => {
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none; p=reject').issues, 'dmarc-duplicate'));
  const up = sdr.parseDmarc('v=DMARC1; P=reject');
  assert.ok(has(up.issues, 'dmarc-tag-case'));
  assert.equal(up.effective.p, 'reject');
  const typo = sdr.parseDmarc('v=DMARC1; p=none; rue=mailto:a@example.com').issues.find((i) => i.code === 'dmarc-unknown-tag');
  assert.ok(text(typo.fix).includes('rua='));
});

test('DMARC removed tags: pct, rf and ri (RFC 9989 Appendix C.5.2)', () => {
  const d = (v) => sdr.parseDmarc('v=DMARC1; p=quarantine; ' + v).issues;
  assert.equal(d('pct=100').find((i) => i.code === 'dmarc-pct-100').level, 'info');
  assert.ok(text(d('pct=0').find((i) => i.code === 'dmarc-pct-0').fix).includes('t=y'));
  assert.equal(d('pct=50').find((i) => i.code === 'dmarc-pct-partial').level, 'warning');
  assert.ok(has(d('pct=abc'), 'dmarc-pct-invalid'));
  assert.ok(has(d('pct=101'), 'dmarc-pct-invalid'));
  assert.ok(has(d('rf=afrf'), 'dmarc-rf'));
  assert.ok(has(d('ri=86400'), 'dmarc-ri'));
});

test('DMARC report URIs: mailto, size suffixes, web schemes and mistakes', () => {
  const u = sdr.parseDmarcUri('mailto:dmarc@example.com');
  assert.deepEqual([u.ok, u.scheme, u.address, u.host], [true, 'mailto', 'dmarc@example.com', 'example.com']);
  const size = sdr.parseDmarcUri('mailto:dmarc@example.com!10m');
  assert.deepEqual([size.ok, size.size, size.address], [true, '10m', 'dmarc@example.com']);
  assert.ok(has(size.issues, 'dmarc-uri-size'));
  assert.equal(sdr.parseDmarcUri('mailto:a@example.com!50').size, '50');
  assert.ok(has(sdr.parseDmarcUri('mailto:a!b@example.com').issues, 'dmarc-uri-bang'));
  const ns = sdr.parseDmarcUri('dmarc@example.com');
  assert.equal(ns.ok, false);
  assert.ok(text(ns.issues[0].fix).includes('mailto:dmarc@example.com'));
  const web = sdr.parseDmarcUri('https://reports.example.net/dmarc');
  assert.deepEqual([web.ok, web.host], [true, 'reports.example.net']);
  assert.ok(has(web.issues, 'dmarc-uri-web'));
  assert.ok(has(sdr.parseDmarcUri('http://reports.example.net/').issues, 'dmarc-uri-http'));
  assert.ok(has(sdr.parseDmarcUri('ftp://reports.example.net/').issues, 'dmarc-uri-scheme'));
  assert.ok(has(sdr.parseDmarcUri('mailto:nobody').issues, 'dmarc-mailto-bad'));
  assert.ok(has(sdr.parseDmarcUri('mailto:a@localhost').issues, 'dmarc-mailto-host'));
  assert.ok(has(sdr.parseDmarcUri('').issues, 'dmarc-uri-space'));
  assert.equal(sdr.parseDmarcUri('mailto:d%40x@example.com').address, 'd@x@example.com');
  const list = sdr.parseDmarc('v=DMARC1; p=none; rua=mailto:a@example.com,,mailto:b@example.com');
  assert.ok(has(list.issues, 'dmarc-uri-space'));
  assert.equal(list.effective.rua.length, 2);
});

test('DMARC notes: p=none without rua, reject, ruf privacy, fo without ruf, t=y with none', () => {
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none').issues, 'dmarc-none-no-rua'));
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=quarantine').issues, 'dmarc-no-rua'));
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=reject; rua=mailto:a@example.com').issues, 'dmarc-reject-notes'));
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none; sp=reject; rua=mailto:a@example.com').issues, 'dmarc-reject-notes'));
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none; rua=mailto:a@example.com; ruf=mailto:a@example.com').issues, 'dmarc-ruf-privacy'));
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none; rua=mailto:a@example.com; fo=1').issues, 'dmarc-fo-no-ruf'));
  assert.ok(has(sdr.parseDmarc('v=DMARC1; p=none; t=y; rua=mailto:a@example.com').issues, 'dmarc-t-none'));
  assert.ok(!has(sdr.parseDmarc('v=DMARC1; p=quarantine; t=y; rua=mailto:a@example.com').issues, 'dmarc-t-none'));
});

test('Organizational domain guess and external report destinations (RFC 9990 §4)', () => {
  assert.equal(sdr.orgDomainGuess('mail.example.com'), 'example.com');
  assert.equal(sdr.orgDomainGuess('a.b.example.co.uk'), 'example.co.uk');
  assert.equal(sdr.orgDomainGuess('example.com'), 'example.com');
  assert.equal(sdr.sameOrg('reports.example.com', 'example.com'), true);
  assert.equal(sdr.sameOrg('a.example.co.uk', 'b.example.co.uk'), true);
  assert.equal(sdr.sameOrg('example.co.uk', 'other.co.uk'), false);
  const d = sdr.parseDmarc('v=DMARC1; p=none; rua=mailto:dmarc@example.com,mailto:r@dmarc.example.net; ruf=mailto:f@reports.example.org');
  const ext = sdr.externalDestinations(d, 'example.com', {});
  assert.deepEqual(ext.map((e) => [e.tag, e.host, e.name, e.authorized]), [
    ['rua', 'dmarc.example.net', 'example.com._report._dmarc.dmarc.example.net', false],
    ['ruf', 'reports.example.org', 'example.com._report._dmarc.reports.example.org', false]
  ]);
  const longHost = ['x'.repeat(60), 'y'.repeat(60), 'z'.repeat(60), 'w'.repeat(40), 'example'].join('.');   // 231 characters
  const big = sdr.externalDestinations(sdr.parseDmarc('v=DMARC1; p=none; rua=mailto:r@' + longHost), 'example.com', {});
  assert.equal(big.length, 1);
  assert.equal(big[0].name.length, 258);
  assert.equal(big[0].tooLong, true);
});

test('Checker: pasted authorization records (exact or wildcard) confirm external reports', () => {
  const base = '_dmarc.example.com: v=DMARC1; p=none; rua=mailto:dmarc@example.com,mailto:r@dmarc.example.net';
  const none = sdr.checkRecords(base);
  assert.ok(has(none.dmarc[0].issues, 'dmarc-ext-auth'));
  const exact = sdr.checkRecords(base + '\nexample.com._report._dmarc.dmarc.example.net: v=DMARC1');
  assert.ok(has(exact.dmarc[0].issues, 'dmarc-ext-ok'));
  assert.equal(exact.auth.length, 1);
  const wild = sdr.checkRecords(base + '\n*._report._dmarc.dmarc.example.net: v=DMARC1;');
  assert.equal(wild.dmarc[0].external[0].authorized, true);
  const bad = sdr.checkRecords(base + '\nexample.com._report._dmarc.dmarc.example.net: v=DMARC2');
  assert.equal(bad.dmarc[0].external[0].authorized, false);
});

test('Checker: several DMARC records, misplaced records, labels without _dmarc, sp on a subdomain', () => {
  const multi = sdr.checkRecords('_dmarc.example.com: v=DMARC1; p=none\n_dmarc.example.com: v=DMARC1; p=reject');
  assert.ok(has(multi.dmarc[0].issues, 'dmarc-multiple'));
  const zone = sdr.checkRecords('example.com. 300 IN TXT "v=DMARC1; p=none"');
  assert.ok(has(zone.dmarc[0].issues, 'dmarc-misplaced'));
  const label = sdr.checkRecords('example.com:\nv=DMARC1; p=none; rua=mailto:a@example.com');
  assert.equal(label.dmarc[0].name, '_dmarc.example.com');
  assert.ok(has(label.dmarc[0].issues, 'dmarc-relabelled'));
  const plain = sdr.checkRecords('v=DMARC1; p=none; rua=mailto:a@example.com', 'example.com');
  assert.equal(plain.dmarc[0].name, '_dmarc.example.com');
  assert.equal(plain.dmarc[0].policyDomain, 'example.com');
  const sub = sdr.checkRecords('_dmarc.mail.example.com: v=DMARC1; p=none; sp=reject; rua=mailto:a@example.com');
  assert.ok(has(sub.dmarc[0].issues, 'dmarc-sp-on-sub'));
  const rel = sdr.checkRecords('_dmarc:\nv=DMARC1; p=none; rua=mailto:a@example.com', 'example.com');
  assert.equal(rel.dmarc[0].name, '_dmarc.example.com');
});

// ─────────────────────────────────────────────────────────────────────────────
// Generators
// ─────────────────────────────────────────────────────────────────────────────

test('Provider includes match each provider\'s documentation and are valid domain-specs', () => {
  const want = {
    google: '_spf.google.com', ms365: 'spf.protection.outlook.com', zoho: 'zohomail.com',
    fastmail: 'spf.messagingengine.com', proton: '_spf.protonmail.ch', icloud: 'icloud.com',
    mailgun: 'mailgun.org', ses: 'amazonses.com', sendgrid: 'sendgrid.net'
  };
  assert.deepEqual(Object.fromEntries(sdr.PROVIDERS.map((p) => [p.id, p.include])), want);
  sdr.PROVIDERS.forEach((p) => {
    assert.deepEqual(term('include:' + p.include).issues, [], p.id);
    assert.match(p.url, /^https:\/\//, p.id);
  });
  assert.deepEqual(sdr.PROVIDERS.filter((p) => p.scope === 'sub').map((p) => p.id), ['ses', 'sendgrid']);
});

test('SPF generator: default record, name and zone line', () => {
  const b = sdr.buildSpf(sdr.defaultState());
  assert.equal(b.ok, true);
  assert.equal(b.value, 'v=spf1 include:_spf.google.com ~all');
  assert.equal(b.name, 'example.com');
  assert.equal(b.host, '@');
  assert.equal(b.zone, 'example.com. 3600 IN TXT "v=spf1 include:_spf.google.com ~all"');
  assert.equal(b.lookups.total, 1);
  assert.deepEqual(b.issues, []);
});

test('SPF generator: cheap terms first, then includes, then all', () => {
  const b = sdr.buildSpf(st({
    svc: ['ms365', 'google'], ip4: '203.0.113.25, ip4:198.51.100.0/28', ip6: '2001:DB8::25 2001:db8:10::/48',
    a: true, mx: true, inc: 'spf.provider.example include:_spf.google.com', all: '-'
  }));
  assert.equal(b.value, 'v=spf1 ip4:203.0.113.25 ip4:198.51.100.0/28 ip6:2001:db8::25 ip6:2001:db8:10::/48 a mx include:_spf.google.com include:spf.protection.outlook.com include:spf.provider.example -all');
  assert.equal(b.lookups.total, 5);
  assert.deepEqual(b.includes, ['_spf.google.com', 'spf.protection.outlook.com', 'spf.provider.example']);
  assert.deepEqual(perm(b.parsed.issues), []);
});

test('SPF generator: no-mail domains, subdomains, provider placement and bad input', () => {
  assert.equal(sdr.buildSpf(st({ nomail: true, svc: ['google'], ip4: '192.0.2.1' })).value, 'v=spf1 -all');
  const sub = sdr.buildSpf(st({ sub: 'bounce', svc: ['ses'] }));
  assert.deepEqual([sub.name, sub.host, sub.value], ['bounce.example.com', 'bounce', 'v=spf1 include:amazonses.com ~all']);
  assert.ok(!has(sub.issues, 'gen-spf-scope'));
  assert.equal(sdr.buildSpf(st({ sub: 'bounce.example.com' })).name, 'bounce.example.com');
  assert.ok(has(sdr.buildSpf(st({ svc: ['ses'] })).issues, 'gen-spf-scope'));
  assert.ok(!has(sdr.buildSpf(st({ svc: ['mailgun'] })).issues, 'gen-spf-scope'));
  const bad = sdr.buildSpf(st({ ip4: '192.0.2.1 300.1.1.1 10.0.0.0/33', ip6: 'fe80::1%eth0', inc: 'localhost' }));
  assert.ok(bad.fieldErrors.ip4.includes('300.1.1.1'));
  assert.ok(bad.fieldErrors.ip4.includes('10.0.0.0/33'));
  assert.ok(bad.fieldErrors.ip6);
  assert.ok(bad.fieldErrors.inc);
  assert.equal(bad.value, 'v=spf1 ip4:192.0.2.1 ~all');
  assert.ok(has(sdr.buildSpf(st()).issues, 'gen-spf-nothing'));
  const nod = sdr.buildSpf(st({ d: 'not a domain' }));
  assert.equal(nod.ok, false);
  assert.ok(nod.fieldErrors.d);
  assert.ok(sdr.buildSpf(st({ sub: 'bad..label' })).fieldErrors.sub);
});

test('Domains: normalisation, IDN to A-label, and rejects', () => {
  assert.deepEqual(sdr.normalizeDomain(' Example.COM. '), { ok: true, domain: 'example.com', idn: false });
  assert.equal(sdr.normalizeDomain('https://www.example.com/path').domain, 'www.example.com');
  assert.equal(sdr.normalizeDomain('postmaster@example.com').domain, 'example.com');
  assert.equal(sdr.normalizeDomain('bücher.example').domain, 'xn--bcher-kva.example');
  assert.equal(sdr.buildSpf(st({ d: 'bücher.example' })).name, 'xn--bcher-kva.example');
  ['', 'localhost', '192.0.2.1', 'a..b.com', '-x.example.com', 'x'.repeat(64) + '.com'].forEach((d) => {
    assert.equal(sdr.normalizeDomain(d).ok, false, d);
  });
});

test('Generated SPF records always parse cleanly', () => {
  const ids = sdr.PROVIDERS.map((p) => p.id);
  for (let mask = 0; mask < 1 << ids.length; mask += 7) {
    const svc = ids.filter((_, i) => mask & (1 << i));
    const b = sdr.buildSpf(st({ svc, a: !!(mask & 1), mx: !!(mask & 2), ip4: '192.0.2.0/24', all: mask & 4 ? '-' : '~' }));
    const p = sdr.parseSpf(b.value);
    assert.equal(p.isSpf, true);
    assert.deepEqual(perm(p.issues), [], b.value);
    assert.ok(!has(p.issues, 'spf-plus-all'));
  }
});

test('DMARC generator: default record and tag order with p right after v', () => {
  const b = sdr.buildDmarc(sdr.defaultState());
  assert.equal(b.value, 'v=DMARC1; p=none; rua=mailto:dmarc@example.com');
  assert.equal(b.name, '_dmarc.example.com');
  assert.equal(b.zone, '_dmarc.example.com. 3600 IN TXT "v=DMARC1; p=none; rua=mailto:dmarc@example.com"');
  const full = sdr.buildDmarc(st({
    p: 'quarantine', sp: 'reject', np: 'reject', t: true, adkim: 's', aspf: 's',
    rua: 'dmarc@example.com mailto:copy@example.com', ruf: 'f@example.com', fo: '1', fod: true, fos: true
  }));
  assert.equal(full.value, 'v=DMARC1; p=quarantine; sp=reject; np=reject; t=y; adkim=s; aspf=s; rua=mailto:dmarc@example.com,mailto:copy@example.com; ruf=mailto:f@example.com; fo=1:d:s');
  const parsed = sdr.parseDmarc(full.value);
  assert.equal(parsed.usable, true);
  assert.deepEqual(parsed.issues.filter((i) => i.level !== 'info'), []);
});

test('DMARC generator: fo only with ruf, never pct, external authorization records', () => {
  assert.ok(!sdr.buildDmarc(st({ rua: 'a@example.com', fo: '1', fod: true })).value.includes('fo='));
  assert.ok(!sdr.buildDmarc(st({ rua: 'a@example.com', ruf: 'f@example.com' })).value.includes('fo='));
  for (const p of ['none', 'quarantine', 'reject']) {
    assert.ok(!sdr.buildDmarc(st({ p, t: true, rua: 'a@example.com' })).value.includes('pct'));
  }
  const ext = sdr.buildDmarc(st({ rua: 'dmarc@example.com, r@dmarc.example.net, r2@dmarc.example.net', ruf: 'f@dmarc.example.net' }));
  assert.deepEqual(ext.auth.map((a) => [a.name, a.value]), [['example.com._report._dmarc.dmarc.example.net', 'v=DMARC1']]);
  assert.equal(sdr.buildDmarc(st({ rua: 'dmarc@reports.example.com' })).auth.length, 0);
  const bad = sdr.buildDmarc(st({ rua: 'not-an-address, ok@example.com' }));
  assert.ok(bad.fieldErrors.rua.includes('not-an-address'));
  assert.equal(bad.value, 'v=DMARC1; p=none; rua=mailto:ok@example.com');
  assert.equal(sdr.buildDmarc(st({ rua: 'dmarc@bücher.example' })).value, 'v=DMARC1; p=none; rua=mailto:dmarc@xn--bcher-kva.example');
  assert.ok(sdr.buildDmarc(st({ rua: 'ü@example.com' })).fieldErrors.rua);
});

// ─────────────────────────────────────────────────────────────────────────────
// TXT strings and zone-file output
// ─────────────────────────────────────────────────────────────────────────────

test('255-octet split: short values stay one string; long ones split and rejoin exactly', () => {
  assert.deepEqual(sdr.splitTxt('v=spf1 -all'), ['v=spf1 -all']);
  assert.deepEqual(sdr.splitTxt(''), ['']);
  const exact = 'x'.repeat(255);
  assert.deepEqual(sdr.splitTxt(exact), [exact]);
  const one = 'x'.repeat(256);
  assert.deepEqual(sdr.splitTxt(one).map((s) => s.length), [255, 1]);
  const rec = 'v=spf1 ' + Array.from({ length: 40 }, (_, i) => 'ip4:198.51.' + i + '.0/24').join(' ') + ' -all';
  const parts = sdr.splitTxt(rec);
  assert.ok(parts.length >= 3);
  parts.forEach((p) => assert.ok(Buffer.byteLength(p) <= 255));
  assert.equal(parts.join(''), rec);
  parts.slice(0, -1).forEach((p) => assert.ok(p.endsWith(' '), 'split after a space: ' + p.slice(-10)));
});

test('255-octet split counts UTF-8 bytes and never cuts a character', () => {
  const s = 'é'.repeat(200);                                    // 400 bytes
  const parts = sdr.splitTxt(s);
  assert.deepEqual(parts.map((p) => Buffer.byteLength(p)), [254, 146]);
  assert.equal(parts.join(''), s);
});

test('Zone-file quoting escapes quotes, backslashes and non-printable octets (RFC 1035 §5.1)', () => {
  assert.equal(sdr.quoteTxtString('v=spf1 -all'), '"v=spf1 -all"');
  assert.equal(sdr.quoteTxtString('say "hi" \\ bye'), '"say \\"hi\\" \\\\ bye"');
  assert.equal(sdr.quoteTxtString('é'), '"\\195\\169"');
  assert.equal(sdr.quoteTxtString('a' + String.fromCharCode(9) + 'b'), '"a\\009b"');
  for (const s of ['plain', 'say "hi" \\ bye', 'a;b ( c )', 'é']) {
    assert.equal(Buffer.from(sdr.parseTxtRdata(sdr.quoteTxtString(s)).strings[0], 'latin1').toString('utf8'), s);
  }
});

test('Zone line: FQDN with trailing dot, TTL, class, and strings that parse back to the value', () => {
  const rec = 'v=spf1 ' + Array.from({ length: 30 }, (_, i) => 'ip4:203.0.113.' + i).join(' ') + ' include:_spf.example.net -all';
  const line = sdr.zoneLine('example.com', rec);
  assert.match(line, /^example\.com\. 3600 IN TXT "v=spf1 /);
  assert.ok(line.split('" "').length >= 2);
  const back = sdr.checkRecords(line);
  assert.equal(back.spf[0].domain, 'example.com');
  assert.equal(back.spf[0].records[0].value, rec);
  assert.ok(!has(back.spf[0].issues, 'txt-string-long'));
  const gen = sdr.buildSpf(st({ ip4: Array.from({ length: 25 }, (_, i) => '198.51.100.' + i).join(' '), svc: ['google', 'ms365'] }));
  assert.ok(gen.strings.length >= 2);
  assert.equal(sdr.checkRecords(gen.zone).spf[0].records[0].value, gen.value);
  assert.equal(sdr.zoneLine('_dmarc.example.com.', 'v=DMARC1; p=none', 300), '_dmarc.example.com. 300 IN TXT "v=DMARC1; p=none"');
});

// ─────────────────────────────────────────────────────────────────────────────
// URL hash, explanations, rendering safety
// ─────────────────────────────────────────────────────────────────────────────

test('URL hash round trip keeps every generator field, including awkward text', () => {
  const s = Object.assign(sdr.blankState(), {
    d: 'bücher.example', sub: 'bounce', nomail: true, svc: ['google', 'ses', 'sendgrid'],
    ip4: '192.0.2.1, 198.51.100.0/24 & #x=1', ip6: '2001:db8::/32', a: true, mx: true, inc: 'spf.a.example spf.b.example',
    all: '-', p: 'reject', sp: 'quarantine', np: 'reject', adkim: 's', aspf: 's', t: true,
    rua: 'dmarc+tag@example.com, mailto:x@example.net', ruf: 'f@example.com', fo: '1', fod: true, fos: true
  });
  const h = sdr.encodeHash(s);
  assert.equal(sdr.isStateHash(h), true);
  assert.deepEqual(sdr.decodeHash(h), s);
  assert.deepEqual(sdr.decodeHash(sdr.encodeHash(sdr.defaultState())), sdr.defaultState());
  assert.deepEqual(sdr.decodeHash(sdr.encodeHash(sdr.blankState())), sdr.blankState());
});

test('URL hash: only v=1 hashes are state, and garbage is sanitised', () => {
  assert.equal(sdr.isStateHash('#how-to-use-it'), false);
  assert.equal(sdr.isStateHash(''), false);
  assert.deepEqual(sdr.decodeHash('#how-to-use-it'), sdr.defaultState());
  const s = sdr.decodeHash('#v=1&d=%E0%A4%A&svc=google,evil,google,ms365&p=block&sp=x&ak=q&all=maybe&fo=7&rua=' + 'a'.repeat(5000) + '&junk&=5');
  assert.equal(s.d, '');
  assert.deepEqual(s.svc, ['google', 'ms365']);
  assert.deepEqual([s.p, s.sp, s.adkim, s.all, s.fo], ['none', '', 'r', '~', '0']);
  assert.equal(s.rua.length, 1000);
});

test('Explanations: ranges, results of all, lookups and macros in plain language', () => {
  const ex = (raw, d) => text(sdr.explainTerm(term(raw), d));
  assert.match(ex('ip4:192.0.2.0/24'), /256 IPv4 addresses, 192\.0\.2\.0 to 192\.0\.2\.255/);
  assert.match(ex('ip4:192.0.2.7'), /single IPv4 address 192\.0\.2\.7/);
  assert.match(ex('ip6:2001:db8::/32'), /2001:db8::\/32/);
  assert.match(ex('-all'), /fail/);
  assert.match(ex('~all'), /softfail/);
  assert.match(ex('?all'), /neutral/);
  assert.match(ex('+all'), /authorizes everyone/);
  assert.match(ex('include:_spf.example.com'), /1 lookup/);
  assert.match(ex('-mx'), /result is fail/);
  assert.match(ex('a', 'example.com'), /example\.com/);
  assert.match(ex('exists:%{ir}.list.example'), /%\{ir\} = the sending IP address/);
});

test('Rendering escapes pasted values, and RFC links point at the right anchors', () => {
  const html = sdr.renderCheckResults(sdr.checkRecords('<b>x</b>.example: v=spf1 x=<img> inc<u>de:y.example -all\n_dmarc.example.com: v=DMARC1; p=<i>', 'example.com'));
  assert.ok(!/<b>x|<img>|<u>|<i>/.test(html));
  assert.ok(html.includes('&lt;img&gt;'));
  assert.equal(sdr.refUrl({ rfc: '7208', sec: '4.6.4' }), 'https://www.rfc-editor.org/rfc/rfc7208#section-4.6.4');
  assert.equal(sdr.refUrl({ rfc: '9989', sec: 'A.6' }), 'https://www.rfc-editor.org/rfc/rfc9989#appendix-A.6');
  assert.equal(sdr.refLabel({ rfc: '9989', sec: 'A.6' }), 'RFC 9989 Appendix A.6');
  assert.equal(sdr.refLabel({ rfc: '7208', sec: '3.2' }), 'RFC 7208 §3.2');
});

test('Built-in examples produce the problems they are meant to show', () => {
  const n = sdr.checkRecords(sdr.EXAMPLES.nested.text, sdr.EXAMPLES.nested.domain);
  assert.equal(n.spf[0].lookups.total, 4);
  assert.ok(has(n.dmarc[0].issues, 'dmarc-ext-auth'));
  const b = sdr.checkRecords(sdr.EXAMPLES.broken.text, sdr.EXAMPLES.broken.domain);
  ['spf-multiple', 'spf-ip4-range', 'spf-unknown-mechanism', 'spf-plus-all', 'spf-ptr'].forEach((c) => {
    assert.ok(has(b.spf[0].issues.concat(b.spf[0].records[0].issues), c), c);
  });
  ['dmarc-uri-no-scheme', 'dmarc-pct-partial', 'dmarc-p-order'].forEach((c) => assert.ok(has(b.dmarc[0].records[0].issues, c), c));
  const l = sdr.checkRecords(sdr.EXAMPLES.lookups.text, sdr.EXAMPLES.lookups.domain);
  assert.equal(l.spf[0].lookups.total, 11);
  assert.equal(l.spf[0].entries[0].strings.length, 2);
  assert.ok(has(l.spf[0].issues, 'spf-too-many-lookups'));
});
