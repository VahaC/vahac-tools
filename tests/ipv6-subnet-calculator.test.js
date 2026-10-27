// tests/ipv6-subnet-calculator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const isc = loadScript('ipv6-subnet-calculator/script.js');

const B = (n) => BigInt(n);
const v = (s) => {
  const p = isc.parseAddress(s);
  assert.ok(p.ok, s + ' → ' + (p.message || ''));
  return p.value;
};
const code = (s) => isc.parseAddress(s).code;
const canon = (s) => isc.formatCanonical(v(s));
const rec = (s) => isc.formatRecommended(v(s));
const analyze = (s, field) => {
  const p = isc.parseInput(s, field == null ? '64' : field);
  assert.ok(p.ok, s + ' → ' + (p.message || ''));
  return isc.analyze(p.value, p.prefix, p.zone);
};
const text = (html) => String(html).replace(/<[^>]+>/g, '');

// ─────────────────────────────────────────────────────────────────────────────
// Parsing: every RFC 4291 §2.2 text form
// ─────────────────────────────────────────────────────────────────────────────

test('parse: preferred form x:x:x:x:x:x:x:x, with and without leading zeros (RFC 4291 §2.2 form 1)', () => {
  assert.equal(isc.hex32(v('ABCD:EF01:2345:6789:ABCD:EF01:2345:6789')), 'abcdef0123456789abcdef0123456789');
  assert.equal(isc.hex32(v('2001:DB8:0:0:8:800:200C:417A')), '20010db80000000000080800200c417a');
  assert.equal(v('2001:0db8:0000:0000:0008:0800:200c:417a'), v('2001:DB8:0:0:8:800:200C:417A'));
  assert.deepEqual(isc.toGroups(v('2001:db8:0:0:8:800:200c:417a')), [0x2001, 0xdb8, 0, 0, 8, 0x800, 0x200c, 0x417a]);
});

test('parse: "::" compression at the start, middle and end (RFC 4291 §2.2 form 2 examples)', () => {
  assert.equal(v('2001:DB8::8:800:200C:417A'), v('2001:DB8:0:0:8:800:200C:417A'));
  assert.equal(v('FF01::101'), v('FF01:0:0:0:0:0:0:101'));
  assert.equal(v('::1'), B(1));
  assert.equal(v('::'), B(0));
  assert.equal(v('0:0:0:0:0:0:0:1'), B(1));
  assert.equal(v('0:0:0:0:0:0:0:0'), B(0));
  assert.equal(v('2001:db8::'), B(0x20010db8) << B(96));
  assert.equal(v('1::'), B(1) << B(112));
  assert.equal(v('1::8'), (B(1) << B(112)) | B(8));
  // "::" may stand for a single zero group
  assert.deepEqual(isc.toGroups(v('1:2:3::5:6:7:8')), [1, 2, 3, 0, 5, 6, 7, 8]);
  assert.deepEqual(isc.toGroups(v('::2:3:4:5:6:7:8')), [0, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(isc.toGroups(v('1:2:3:4:5:6:7::')), [1, 2, 3, 4, 5, 6, 7, 0]);
});

test('parse: the variants RFC 5952 §2 lists are all the same address', () => {
  const one = v('2001:db8:aaaa:bbbb:cccc:dddd:eeee:1');
  ['2001:db8:aaaa:bbbb:cccc:dddd:eeee:0001', '2001:db8:aaaa:bbbb:cccc:dddd:eeee:001', '2001:db8:aaaa:bbbb:cccc:dddd:eeee:01'].forEach((s) => assert.equal(v(s), one, s));
  assert.equal(v('2001:db8:aaaa:bbbb:cccc:dddd::1'), v('2001:db8:aaaa:bbbb:cccc:dddd:0:1'));
  ['2001:db8:0:0:0::1', '2001:db8:0:0::1', '2001:db8:0::1'].forEach((s) => assert.equal(v(s), v('2001:db8::1'), s));
  assert.equal(v('2001:db8::aaaa:0:0:1'), v('2001:db8:0:0:aaaa::1'));
  const lower = v('2001:db8:aaaa:bbbb:cccc:dddd:eeee:aaaa');
  assert.equal(v('2001:db8:aaaa:bbbb:cccc:dddd:eeee:AAAA'), lower);
  assert.equal(v('2001:db8:aaaa:bbbb:cccc:dddd:eeee:AaAa'), lower);
});

test('parse: embedded IPv4 in the last 32 bits (RFC 4291 §2.2 form 3 examples)', () => {
  assert.equal(v('0:0:0:0:0:0:13.1.68.3'), B(0x0d014403));
  assert.equal(v('::13.1.68.3'), B(0x0d014403));
  assert.equal(v('0:0:0:0:0:FFFF:129.144.52.38'), (B(0xffff) << B(32)) | B(0x81903426));
  assert.equal(v('::FFFF:129.144.52.38'), v('::ffff:8190:3426'));
  assert.equal(v('64:ff9b::192.0.2.33'), v('64:ff9b::c000:221'));
  assert.equal(v('2001:db8:122:344::192.0.2.33'), v('2001:db8:122:344::c000:221'));
  assert.equal(v('1:2:3:4:5:6:1.2.3.4'), v('1:2:3:4:5:6:102:304'));
  assert.equal(v('::0.0.0.0'), B(0));
  assert.equal(v('::255.255.255.255'), B(0xffffffff));
  assert.equal(isc.parseAddress('::ffff:1.2.3.4').hasIPv4, true);
});

test('parse: zone IDs after "%" (RFC 4007 §11) and URL brackets', () => {
  const a = isc.parseAddress('fe80::1234%eth0');
  assert.equal(a.ok, true);
  assert.equal(a.zone, 'eth0');
  assert.equal(a.value, v('fe80::1234'));
  assert.equal(isc.parseAddress('fe80::4321%7').zone, '7');
  assert.equal(isc.parseAddress('ff02::5678%pvc1.3').zone, 'pvc1.3');
  assert.equal(isc.parseAddress('fe80::8d0f:7f26:f5c8:780b%enx525400d5e0fb').zone, 'enx525400d5e0fb');
  assert.equal(isc.parseAddress('fe80::1').zone, null);
  assert.equal(isc.parseAddress('[2001:db8::1]').value, v('2001:db8::1'));
  assert.equal(isc.parseAddress('  2001:DB8::1  ').value, v('2001:db8::1'));
  // zone before the prefix length (RFC 4007 §11.7)
  const p = isc.parseInput('fe80::%2/64', '');
  assert.equal(p.ok, true);
  assert.equal(p.zone, '2');
  assert.equal(p.prefix, 64);
});

test('parse: rejects two "::", too many or too few groups, bad hex and stray colons', () => {
  assert.equal(code('2001:db8::1::2'), 'double-compress');
  assert.equal(code('::1::'), 'double-compress');
  assert.equal(code(':::'), 'double-compress');
  assert.equal(code('1:2:3:4:5:6:7:8:9'), 'too-many-groups');
  assert.equal(code('1:2:3:4::5:6:7:8'), 'too-many-groups');      // "::" must stand for at least one group
  assert.equal(code('1:2:3:4:5:6:7:8::'), 'too-many-groups');
  assert.equal(code('1:2:3:4:5:6:7'), 'too-few-groups');
  assert.equal(code('2001:0DB8:0:CD3'), 'too-few-groups');        // RFC 4291 §2.3 illegal example
  assert.equal(code('2001:db8::12345'), 'group-too-long');
  assert.equal(code('2001:db8::g1'), 'bad-char');
  assert.equal(code('2001:db8::1 2'), 'bad-char');
  assert.equal(code('2001-db8::1'), 'bad-char');
  assert.equal(code(':1:2:3:4:5:6:7'), 'leading-colon');
  assert.equal(code('1:2:3:4:5:6:7:'), 'trailing-colon');
  assert.equal(code('12345'), 'no-colon');
  assert.equal(code(''), 'empty');
  assert.equal(code('   '), 'empty');
  assert.equal(code('%eth0'), 'empty');
});

test('parse: rejects broken IPv4 parts and zone IDs', () => {
  assert.equal(code('::ffff:256.1.1.1'), 'ipv4-range');
  assert.equal(code('::ffff:1.2.3.300'), 'ipv4-range');
  assert.equal(code('::ffff:1.2.3'), 'ipv4-bad');
  assert.equal(code('::ffff:1.2.3.4.5'), 'ipv4-bad');
  assert.equal(code('::ffff:1..3.4'), 'ipv4-bad');
  assert.equal(code('::ffff:01.2.3.4'), 'ipv4-leading-zero');
  assert.equal(code('1.2.3.4::'), 'ipv4-position');
  assert.equal(code('::1.2.3.4:5'), 'ipv4-position');
  assert.equal(code('1:2:3:4:5:6:7:1.2.3.4'), 'too-many-groups');
  assert.equal(code('1:2:3:4:5:1.2.3.4'), 'too-few-groups');
  assert.equal(code('fe80::1%'), 'zone-empty');
  assert.equal(code('fe80::1%eth 0'), 'zone-bad');
  assert.equal(code('fe80::1%eth0%1'), 'zone-bad');
  assert.ok(/255/.test(isc.parseAddress('::ffff:256.1.1.1').message));
});

test('parse: prefix lengths 0 to 128, from the input or the separate field (RFC 4291 §2.3)', () => {
  assert.equal(isc.parseInput('2001:db8::/0').prefix, 0);
  assert.equal(isc.parseInput('2001:db8::/128').prefix, 128);
  assert.equal(isc.parseInput('2001:db8::/129').code, 'prefix-range');
  assert.equal(isc.parseInput('2001:db8::/200').code, 'prefix-range');
  assert.equal(isc.parseInput('2001:db8::/-1').code, 'prefix-bad');
  assert.equal(isc.parseInput('2001:db8::/4a').code, 'prefix-bad');
  assert.equal(isc.parseInput('2001:db8::/').code, 'prefix-empty');
  assert.equal(isc.parseInput('2001:db8::/48/64').code, 'prefix-bad');
  assert.equal(isc.parseInput('fe80::1/64%eth0').code, 'zone-after-prefix');
  assert.equal(isc.parsePrefixLength('129').code, 'prefix-range');
  assert.equal(isc.parsePrefixLength('064').value, 64);
  const f = isc.parseInput('2001:db8::1', '56');
  assert.equal(f.prefix, 56);
  assert.equal(f.prefixInInput, false);
  assert.equal(isc.parseInput('2001:db8::1', '').prefix, 64);
  assert.equal(isc.parseInput('2001:db8::1', '130').code, 'prefix-range');
  assert.equal(isc.parseInput('2001:db8::/48', '64').prefix, 48);       // the input wins
});

test('parse: RFC 4291 §2.3 prefix examples, legal and the address-to-the-left traps', () => {
  const want = '2001:db8:0:cd30::/60';
  ['2001:0DB8:0000:CD30:0000:0000:0000:0000/60', '2001:0DB8::CD30:0:0:0:0/60', '2001:0DB8:0:CD30::/60', '2001:0DB8:0:CD30:123:4567:89AB:CDEF/60'].forEach((s) => {
    assert.equal(analyze(s).networkText, want, s);
  });
  // Syntactically valid, but the address expands differently, so the prefix is not the 60-bit one
  assert.equal(analyze('2001:0DB8::CD30/60').networkText, '2001:db8::/60');
  assert.equal(analyze('2001:0DB8::CD3/60').networkText, '2001:db8::/60');
});

// ─────────────────────────────────────────────────────────────────────────────
// RFC 5952 output
// ─────────────────────────────────────────────────────────────────────────────

test('RFC 5952 §4.1: leading zeros suppressed, a single 0000 field written as 0', () => {
  assert.equal(canon('2001:0db8::0001'), '2001:db8::1');
  assert.equal(canon('2001:db8:aaaa:bbbb:cccc:dddd:eeee:0001'), '2001:db8:aaaa:bbbb:cccc:dddd:eeee:1');
  assert.equal(canon('2001:db8:0000:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1');
});

test('RFC 5952 §4.2.1: "::" used to its maximum', () => {
  assert.equal(canon('2001:db8:0:0:0:0:2:1'), '2001:db8::2:1');
  assert.equal(canon('2001:db8::0:1'), '2001:db8::1');
  assert.equal(canon('2001:db8:0:0:0::1'), '2001:db8::1');
  assert.equal(canon('0:0:0:0:0:0:0:0'), '::');
  assert.equal(canon('0:0:0:0:0:0:0:1'), '::1');
  assert.equal(canon('1:0:0:0:0:0:0:0'), '1::');
  assert.equal(canon('FF01:0:0:0:0:0:0:101'), 'ff01::101');
});

test('RFC 5952 §4.2.2: never "::" for one 16-bit zero field', () => {
  assert.equal(canon('2001:db8:0:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1');
  assert.equal(canon('2001:db8::1:1:1:1:1'), '2001:db8:0:1:1:1:1:1');
  assert.equal(canon('1:2:3:4:5:6:7::'), '1:2:3:4:5:6:7:0');
  assert.equal(canon('::2:3:4:5:6:7:8'), '0:2:3:4:5:6:7:8');
});

test('RFC 5952 §4.2.3: longest run wins, the first one on a tie', () => {
  assert.equal(canon('2001:0:0:1:0:0:0:1'), '2001:0:0:1::1');
  assert.equal(canon('2001:db8:0:0:1:0:0:1'), '2001:db8::1:0:0:1');
  assert.equal(canon('2001:db8::1:0:0:1'), '2001:db8::1:0:0:1');
  assert.equal(canon('0:0:1:0:0:1:0:0'), '::1:0:0:1:0:0');
  assert.equal(canon('1:0:0:2:0:0:0:3'), '1:0:0:2::3');
});

test('RFC 5952 §4.3: lowercase hex', () => {
  assert.equal(canon('2001:DB8:AAAA:BBBB:CCCC:DDDD:EEEE:AAAA'), '2001:db8:aaaa:bbbb:cccc:dddd:eeee:aaaa');
  assert.equal(canon('ABCD:EF01:2345:6789:ABCD:EF01:2345:6789'), 'abcd:ef01:2345:6789:abcd:ef01:2345:6789');
  assert.equal(canon('2001:DB8::8:800:200C:417A'), '2001:db8::8:800:200c:417a');
});

test('RFC 5952 §5: mixed notation for IPv4-mapped and the RFC 2765 / RFC 6052 well-known prefixes', () => {
  assert.equal(rec('0:0:0:0:0:ffff:192.0.2.1'), '::ffff:192.0.2.1');
  assert.equal(rec('::ffff:c000:201'), '::ffff:192.0.2.1');
  assert.equal(rec('::FFFF:129.144.52.38'), '::ffff:129.144.52.38');
  assert.equal(rec('::ffff:0:0'), '::ffff:0.0.0.0');
  assert.equal(rec('::ffff:0:c000:201'), '::ffff:0:192.0.2.1');            // RFC 2765 IPv4-translated
  assert.equal(rec('64:ff9b::c000:221'), '64:ff9b::192.0.2.33');           // RFC 6052 Table 2
  // The hex-only RFC 5952 §4 form stays available
  assert.equal(canon('::ffff:192.0.2.1'), '::ffff:c000:201');
  // Not a well-known prefix: hex, including the deprecated IPv4-compatible form
  assert.equal(rec('::13.1.68.3'), '::d01:4403');
  assert.equal(rec('2001:db8:122:344::192.0.2.33'), '2001:db8:122:344::c000:221');
  assert.equal(rec('64:ff9b:1::c000:221'), '64:ff9b:1::c000:221');
  assert.equal(rec('::1'), '::1');
});

test('expanded form: eight groups of four lowercase hex digits', () => {
  assert.equal(isc.formatFull(v('2001:db8::1')), '2001:0db8:0000:0000:0000:0000:0000:0001');
  assert.equal(isc.formatFull(v('::')), '0000:0000:0000:0000:0000:0000:0000:0000');
  assert.equal(isc.formatFull(v('FE80::ABCD')), 'fe80:0000:0000:0000:0000:0000:0000:abcd');
});

test('text forms round-trip: canonical → parse → canonical for many values', () => {
  const samples = ['::', '::1', '1::', '2001:db8::', 'fe80::1:2', '2001:db8:0:1::1', 'ff02::1:ff00:1', '1:0:1:0:1:0:1:0',
    'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db8:85a3::8a2e:370:7334', '0:1:0:0:1:0:0:0'];
  samples.forEach((s) => {
    const c = canon(s);
    assert.equal(canon(c), c, s);
    assert.equal(v(c), v(s), s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ranges and counts
// ─────────────────────────────────────────────────────────────────────────────

test('range: /0 covers the whole space', () => {
  const a = analyze('2001:db8::1/0');
  assert.equal(a.networkText, '::/0');
  assert.equal(a.firstText, '::');
  assert.equal(a.lastText, 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
  assert.equal(a.count, B(2) ** B(128));
  assert.equal(isc.formatBig(a.count), '340,282,366,920,938,463,463,374,607,431,768,211,456');
  assert.equal(a.lans64, B(2) ** B(64));
  assert.equal(a.maskText, '::');
});

test('range: /1 halves the space', () => {
  const lo = analyze('7fff::/1');
  assert.equal(lo.networkText, '::/1');
  assert.equal(lo.lastText, '7fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
  const hi = analyze('8000::1/1');
  assert.equal(hi.networkText, '8000::/1');
  assert.equal(hi.lastText, 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
  assert.equal(hi.count, B(2) ** B(127));
  assert.equal(hi.maskText, '8000::');
});

test('range: /48 site', () => {
  const a = analyze('2001:db8:abcd:12::1/48');
  assert.equal(a.networkText, '2001:db8:abcd::/48');
  assert.equal(a.firstText, '2001:db8:abcd::');
  assert.equal(a.lastText, '2001:db8:abcd:ffff:ffff:ffff:ffff:ffff');
  assert.equal(a.count, B(2) ** B(80));
  assert.equal(a.countBits, 80);
  assert.equal(a.lans64, B(65536));
  assert.equal(a.blocks56, B(256));
  assert.equal(a.sites48, B(1));
  assert.equal(a.maskText, 'ffff:ffff:ffff::');
  assert.equal(a.isNetwork, false);
});

test('range: /56 home delegation', () => {
  const a = analyze('2001:db8:abcd:1200::/56');
  assert.equal(a.networkText, '2001:db8:abcd:1200::/56');
  assert.equal(a.lastText, '2001:db8:abcd:12ff:ffff:ffff:ffff:ffff');
  assert.equal(a.lans64, B(256));
  assert.equal(a.blocks56, B(1));
  assert.equal(a.sites48, null);
  assert.equal(a.maskText, 'ffff:ffff:ffff:ff00::');
});

test('range: /64 LAN', () => {
  const a = analyze('2001:db8:abcd:12:21a:2bff:fe3c:4d5e/64');
  assert.equal(a.networkText, '2001:db8:abcd:12::/64');
  assert.equal(a.firstText, '2001:db8:abcd:12::');
  assert.equal(a.lastText, '2001:db8:abcd:12:ffff:ffff:ffff:ffff');
  assert.equal(isc.formatBig(a.count), '18,446,744,073,709,551,616');
  assert.equal(a.lans64, B(1));
  assert.equal(a.maskText, 'ffff:ffff:ffff:ffff::');
  assert.equal(a.iid.text, '21a:2bff:fe3c:4d5e');
  assert.equal(a.iid.mac, '00:1a:2b:3c:4d:5e');
});

test('range: /127 point-to-point link (RFC 6164) has exactly two addresses', () => {
  const a = analyze('2001:db8:0:1::1/127');
  assert.equal(a.networkText, '2001:db8:0:1::/127');
  assert.equal(a.firstText, '2001:db8:0:1::');
  assert.equal(a.lastText, '2001:db8:0:1::1');
  assert.equal(a.count, B(2));
  assert.equal(a.lans64, null);
  assert.equal(a.parent64, '2001:db8:0:1::/64');
  assert.ok(a.notes.some((n) => /6164/.test(n.html) && n.level === 'info'));
  assert.ok(!a.notes.some((n) => /SLAAC/.test(n.html)));
});

test('range: /128 is one address', () => {
  const a = analyze('2001:db8::1/128');
  assert.equal(a.networkText, '2001:db8::1/128');
  assert.equal(a.firstText, a.lastText);
  assert.equal(a.count, B(1));
  assert.equal(a.maskText, 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
});

test('range: prefixes longer than /64 on unicast get the SLAAC warning', () => {
  const a = analyze('2001:db8::/80');
  assert.ok(a.notes.some((n) => n.level === 'warn' && /SLAAC/.test(n.html) && /4862/.test(n.html)));
  assert.ok(!analyze('2001:db8::/64').notes.some((n) => /SLAAC/.test(n.html)));
  assert.ok(analyze('fd12:3456:789a:1::/96').notes.some((n) => /SLAAC/.test(n.html)));
  // Translation and mapping prefixes are not LANs
  assert.ok(!analyze('64:ff9b::198.51.100.7/96').notes.some((n) => /SLAAC/.test(n.html)));
  assert.deepEqual(analyze('::ffff:192.0.2.1/128').notes, []);
  assert.ok(!analyze('ff02::1/80').notes.some((n) => /SLAAC/.test(n.html)));
});

test('masks: maskFor and hostMask at the edges', () => {
  assert.equal(isc.maskFor(0), B(0));
  assert.equal(isc.maskFor(128), (B(1) << B(128)) - B(1));
  assert.equal(isc.maskFor(1), B(1) << B(127));
  assert.equal(isc.hostMask(64), (B(1) << B(64)) - B(1));
  assert.equal(isc.hostMask(128), B(0));
});

test('formatBig: thousands separators on exact counts', () => {
  assert.equal(isc.formatBig(B(0)), '0');
  assert.equal(isc.formatBig(B(999)), '999');
  assert.equal(isc.formatBig(B(1000)), '1,000');
  assert.equal(isc.formatBig(B(2) ** B(32)), '4,294,967,296');
  assert.equal(isc.formatBig(B(2) ** B(80)), '1,208,925,819,614,629,174,706,176');
});

// ─────────────────────────────────────────────────────────────────────────────
// Subnet split
// ─────────────────────────────────────────────────────────────────────────────

test('split: /48 into /64 gives 65,536 subnets, listed from the start', () => {
  const net = v('2001:db8:abcd::');
  const s = isc.splitSummary(48, 64);
  assert.equal(s.count, B(65536));
  assert.equal(s.size, B(2) ** B(64));
  assert.equal(s.pages, B(65536 / isc.PAGE_SIZE));
  assert.equal(s.copyAll, false);
  const list = isc.listSubnets(net, 48, 64, B(0), 4);
  assert.deepEqual(list.map((x) => x.text), ['2001:db8:abcd::/64', '2001:db8:abcd:1::/64', '2001:db8:abcd:2::/64', '2001:db8:abcd:3::/64']);
  assert.equal(list[1].lastText, '2001:db8:abcd:1:ffff:ffff:ffff:ffff');
  const end = isc.listSubnets(net, 48, 64, B(65534), 16);
  assert.deepEqual(end.map((x) => x.text), ['2001:db8:abcd:fffe::/64', '2001:db8:abcd:ffff::/64']);
  assert.equal(end[1].index, B(65535));
});

test('split: /56 into /64 and /48 into /56 (RIPE-690 sizes)', () => {
  const s = isc.splitSummary(56, 64);
  assert.equal(s.count, B(256));
  assert.equal(s.copyAll, true);
  const list = isc.listSubnets(v('2001:db8:abcd:1200::'), 56, 64, B(0), 300);
  assert.equal(list.length, 256);
  assert.equal(list[255].text, '2001:db8:abcd:12ff::/64');
  const s2 = isc.listSubnets(v('2001:db8:abcd::'), 48, 56, B(1), 2);
  assert.deepEqual(s2.map((x) => x.text), ['2001:db8:abcd:100::/56', '2001:db8:abcd:200::/56']);
});

test('split: not on a nibble boundary (/62) steps by 4 in the last hex digit', () => {
  const list = isc.listSubnets(v('2001:db8::'), 48, 62, B(0), 3);
  assert.deepEqual(list.map((x) => x.text), ['2001:db8::/62', '2001:db8:0:4::/62', '2001:db8:0:8::/62']);
  const ni = isc.splitNibbleInfo(48, 62);
  assert.equal(ni.aligned, false);
  assert.equal(ni.step, 4);
  assert.equal(ni.zonesEach, 4);
  assert.equal(ni.lastDigit, 16);
  assert.equal(ni.lower, 60);
  assert.equal(ni.upper, 64);
  const al = isc.splitNibbleInfo(48, 64);
  assert.equal(al.aligned, true);
  assert.equal(al.parentAligned, true);
  assert.equal(al.firstDigit, 13);
  assert.equal(al.lastDigit, 16);
  assert.equal(isc.splitNibbleInfo(48, 49).lower, null);
});

test('split: a huge split is summarised and paged, never materialised', () => {
  const s = isc.splitSummary(0, 128);
  assert.equal(s.count, B(2) ** B(128));
  assert.equal(s.size, B(1));
  assert.equal(s.copyAll, false);
  assert.equal(s.pages, (B(2) ** B(128)) / B(isc.PAGE_SIZE));
  const lastPage = isc.listSubnets(B(0), 0, 128, s.count - B(2), isc.PAGE_SIZE);
  assert.deepEqual(lastPage.map((x) => x.text), ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe/128', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128']);
  const big = isc.splitSummary(32, 64);
  assert.equal(big.count, B(2) ** B(32));
  const mid = isc.listSubnets(v('2001:db8::'), 32, 64, B(4294967295), 5);
  assert.equal(mid.length, 1);
  assert.equal(mid[0].text, '2001:db8:ffff:ffff::/64');
});

test('split: invalid lengths and the defaults', () => {
  assert.equal(isc.splitSummary(64, 64), null);
  assert.equal(isc.splitSummary(64, 48), null);
  assert.equal(isc.splitSummary(64, 129), null);
  assert.equal(isc.splitSummary(127, 128).count, B(2));
  assert.equal(isc.defaultSplit(32), 48);
  assert.equal(isc.defaultSplit(48), 64);
  assert.equal(isc.defaultSplit(56), 64);
  assert.equal(isc.defaultSplit(64), 68);
  assert.equal(isc.defaultSplit(126), 128);
  assert.equal(isc.defaultSplit(127), 128);
  assert.equal(isc.defaultSplit(128), null);
  assert.equal(isc.subnetAt(v('2001:db8:abcd::'), 48, 64, B(18)), v('2001:db8:abcd:12::'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Reverse DNS (RFC 3596 §2.5)
// ─────────────────────────────────────────────────────────────────────────────

test('ip6.arpa: the RFC 3596 §2.5 example, lowercase', () => {
  assert.equal(isc.reverseName(v('4321:0:1:2:3:4:567:89ab')), 'b.a.9.8.7.6.5.0.4.0.0.0.3.0.0.0.2.0.0.0.1.0.0.0.0.0.0.0.1.2.3.4.ip6.arpa.');
  assert.equal(isc.reverseName(v('::1')), '1.' + '0.'.repeat(31) + 'ip6.arpa.');
});

test('ip6.arpa: reverse zones at nibble boundaries, several zones otherwise', () => {
  assert.deepEqual(isc.reverseZones(v('2001:db8::'), 32).zones, ['8.b.d.0.1.0.0.2.ip6.arpa.']);
  assert.deepEqual(isc.reverseZones(v('2001:db8:abcd::'), 48).zones, ['d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa.']);
  assert.deepEqual(isc.reverseZones(v('2001:db8:abcd:1200::'), 56).zones, ['2.1.d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa.']);
  assert.equal(isc.reverseZones(v('2001:db8:abcd:12::'), 64).zones[0], '2.1.0.0.d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa.');
  const z50 = isc.reverseZones(v('2001:db8:abcd:4000::'), 50);
  assert.equal(z50.aligned, false);
  assert.equal(z50.zoneLen, 52);
  assert.deepEqual(z50.zones, ['4.d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa.', '5.d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa.', '6.d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa.', '7.d.c.b.a.8.b.d.0.1.0.0.2.ip6.arpa.']);
  assert.equal(isc.reverseZones(v('2001:db8::'), 31).zones.length, 2);
  assert.equal(isc.reverseZones(v('2001:db8::'), 29).zones.length, 8);
  assert.deepEqual(isc.reverseZones(v('::'), 0).zones, ['ip6.arpa.']);
  assert.deepEqual(isc.reverseZones(v('2000::'), 3).zones, ['2.ip6.arpa.', '3.ip6.arpa.']);
  assert.equal(isc.reverseZones(v('2001:db8::1'), 128).zones[0], isc.reverseName(v('2001:db8::1')));
});

// ─────────────────────────────────────────────────────────────────────────────
// Classification against the IANA registries
// ─────────────────────────────────────────────────────────────────────────────

const typeOf = (s) => isc.classify(v(s), 128);

test('IANA special-purpose registry: every entry classifies as itself', () => {
  isc.SPECIAL_SRC.forEach((e) => {
    const c = isc.classify(v(e[0]), e[1]);
    assert.ok(c.special, e[0]);
    assert.equal(c.special.prefix, e[0] + '/' + e[1], e[0]);
    assert.equal(c.special.label, e[2]);
  });
});

test('IANA special-purpose registry: addresses inside each block, most specific match', () => {
  assert.equal(typeOf('::1').special.label, 'Loopback address');
  assert.equal(typeOf('::').special.label, 'Unspecified address');
  assert.equal(typeOf('::ffff:192.0.2.1').special.label, 'IPv4-mapped address');
  assert.equal(typeOf('64:ff9b::192.0.2.33').special.label, 'NAT64 well-known prefix');
  assert.equal(typeOf('64:ff9b:1::1').special.label, 'Local-use IPv4/IPv6 translation prefix');
  assert.equal(typeOf('100::1').special.label, 'Discard-only address block');
  assert.equal(typeOf('100:0:0:1::1').special.label, 'Dummy IPv6 prefix');
  assert.equal(typeOf('2001:0:4136:e378:8000:63bf:3fff:fdd2').special.label, 'Teredo');
  assert.equal(typeOf('2001:1::1').special.label, 'Port Control Protocol anycast');
  assert.equal(typeOf('2001:1::2').special.label, 'TURN anycast');
  assert.equal(typeOf('2001:1::4').special.label, 'IETF protocol assignments');
  assert.equal(typeOf('2001:2::1').special.label, 'Benchmarking');
  assert.equal(typeOf('2001:3::1').special.label, 'AMT');
  assert.equal(typeOf('2001:4:112::1').special.label, 'AS112-v6');
  assert.equal(typeOf('2001:10::1').special.label, 'Deprecated (previously ORCHID)');
  assert.equal(typeOf('2001:20::1').special.label, 'ORCHIDv2');
  assert.equal(typeOf('2001:30::1').special.label, 'Drone Remote ID Protocol Entity Tags (DETs)');
  assert.equal(typeOf('2001:db8:1::1').special.label, 'Documentation');
  assert.equal(typeOf('3fff:fff:ffff::1').special.label, 'Documentation');
  assert.equal(typeOf('3fff:1000::').special, null);            // just past 3fff::/20
  assert.equal(typeOf('2002:c000:204::1').special.label, '6to4');
  assert.equal(typeOf('2620:4f:8000::1').special.label, 'Direct Delegation AS112 Service');
  assert.equal(typeOf('5f00::1').special.label, 'Segment Routing (SRv6) SIDs');
  assert.equal(typeOf('fd12:3456:789a::1').special.label, 'Unique local address (ULA)');
  assert.equal(typeOf('fc00::1').special.label, 'Unique local address (ULA)');
  assert.equal(typeOf('fe80::1').special.label, 'Link-local unicast');
  assert.equal(typeOf('febf:ffff::1').special.label, 'Link-local unicast');
  assert.equal(typeOf('fec0::1').special, null);
});

test('IANA flags: source, destination, forwardable, globally reachable, reserved-by-protocol', () => {
  assert.equal(typeOf('::1').special.flags, 'FFFFT');
  assert.equal(typeOf('2001:db8::1').special.flags, 'FFFFF');
  assert.equal(typeOf('fe80::1').special.flags, 'TTFFT');
  assert.equal(typeOf('fd00::1').special.flags, 'TTTFF');
  assert.equal(typeOf('64:ff9b::1').special.flags, 'TTTTF');
  assert.equal(typeOf('2001::1').special.flags, 'TTTNF');       // Teredo: globally reachable N/A
});

test('IANA address space: global unicast, ULA, link-local, multicast, reserved and site-local', () => {
  const g = typeOf('2a00:1450:4001:82a::200e');
  assert.equal(g.kind, 'global');
  assert.equal(g.label, 'Global unicast');
  assert.equal(g.space.prefix, '2000::/3');
  assert.equal(g.rir.name, 'RIPE NCC');
  assert.equal(g.rir.prefix, '2a00::/12');
  assert.equal(typeOf('2600::1').rir.name, 'ARIN');
  assert.equal(typeOf('2400:cb00::1').rir.name, 'APNIC');
  assert.equal(typeOf('2800::1').rir.name, 'LACNIC');
  assert.equal(typeOf('2c0f::1').rir.name, 'AFRINIC');
  assert.equal(typeOf('2001:67c::1').rir.name, 'RIPE NCC');
  assert.equal(typeOf('2000::1').rir, null);                      // in 2000::/3 but not allocated
  assert.equal(typeOf('fd00::1').space.label, 'Unique local unicast');
  assert.equal(typeOf('fe80::1').space.label, 'Link-scoped unicast');
  assert.equal(typeOf('ff02::1').space.label, 'Multicast');
  assert.equal(typeOf('4000::1').space.label, 'Reserved by IETF');
  assert.equal(typeOf('4000::1').kind, 'reserved');
  assert.equal(typeOf('fec0::1').space.label, 'Reserved by IETF (formerly site-local)');
  assert.equal(typeOf('::2').space.prefix, '::/8');
  // A prefix shorter than every block spans several types
  const all = isc.classify(v('::'), 0);
  assert.equal(all.kind, 'mixed');
  assert.equal(all.label, 'Several address types');
});

test('multicast: scope from the 4-bit scop field (RFC 4291 §2.7, RFC 7346), flags T, P, R', () => {
  const scopes = { 'ff01::1': 'Interface-Local', 'ff02::1': 'Link-Local', 'ff03::1': 'Realm-Local', 'ff04::1': 'Admin-Local',
    'ff05::1': 'Site-Local', 'ff08::1': 'Organization-Local', 'ff0e::1': 'Global', 'ff00::1': 'Reserved', 'ff0f::1': 'Reserved',
    'ff06::1': 'Unassigned', 'ff09::1': 'Unassigned' };
  Object.keys(scopes).forEach((a) => {
    const m = typeOf(a).multicast;
    assert.equal(m.scopeName, scopes[a], a);
  });
  const c = typeOf('ff02::1');
  assert.equal(c.kind, 'multicast');
  assert.equal(c.label, 'Multicast, link-local scope');
  assert.equal(c.multicast.transient, false);
  const t = typeOf('ff15::101').multicast;
  assert.equal(t.transient, true);
  assert.equal(t.scopeName, 'Site-Local');
  const p = typeOf('ff3e:30:2001:db8::1').multicast;
  assert.equal(p.prefixBased, true);
  assert.equal(p.transient, true);
  assert.equal(p.scope, 14);
  assert.equal(typeOf('ff7e:240:2001:db8::1').multicast.embeddedRp, true);
});

test('multicast: well-known groups, variable-scope groups and solicited-node addresses', () => {
  assert.equal(typeOf('ff02::1').multicast.known.name, 'All nodes on the link');
  assert.equal(typeOf('ff02::2').multicast.known.name, 'All routers on the link');
  assert.equal(typeOf('ff02::1:2').multicast.known.name, 'All DHCPv6 relay agents and servers');
  assert.match(typeOf('ff02::fb').multicast.known.name, /mDNS.*link-local scope/);
  assert.match(typeOf('ff05::101').multicast.known.name, /NTP.*site-local scope/);
  assert.match(typeOf('ff0e::101').multicast.known.name, /NTP.*global scope/);
  assert.equal(typeOf('ff12::101').multicast.known, null);    // transient: not the permanent NTP group
  const sn = typeOf('ff02::1:ff3c:4d5e').multicast;
  assert.equal(sn.known.solicited, true);
  assert.equal(sn.solicitedTail, '3c4d5e');
  assert.equal(typeOf('ff02::3').multicast.known, null);
});

test('embedded IPv4: mapped, NAT64, 6to4, Teredo and the deprecated compatible form', () => {
  const emb = (s) => isc.embeddedIPv4(v(s));
  assert.deepEqual(emb('::ffff:192.0.2.1').map((e) => [e.label, e.ipv4]), [['IPv4-mapped', '192.0.2.1']]);
  assert.equal(emb('64:ff9b::192.0.2.33')[0].ipv4, '192.0.2.33');
  assert.equal(emb('2002:c000:204::1')[0].ipv4, '192.0.2.4');
  assert.equal(emb('::1.2.3.4')[0].label, 'IPv4-compatible (deprecated)');
  assert.deepEqual(emb('::1'), []);
  assert.deepEqual(emb('::'), []);
  // Teredo example: server 65.54.227.120, client 192.0.2.45 port 40000 (RFC 4380 §4 obfuscation)
  assert.equal(emb('2001:0:4136:e378:8000:63bf:3fff:fdd2')[0].ipv4, 'server 65.54.227.120, client 192.0.2.45 port 40000');
  assert.deepEqual(emb('2001:db8::1'), []);
});

test('NAT64: non-global IPv4 inside 64:ff9b::/96 is flagged (RFC 6052 §3.1)', () => {
  assert.equal(isc.ipv4NonGlobal(0x0a010203), true);     // 10.1.2.3
  assert.equal(isc.ipv4NonGlobal(0xc0a80101), true);     // 192.168.1.1
  assert.equal(isc.ipv4NonGlobal(0xac1f0001), true);     // 172.31.0.1
  assert.equal(isc.ipv4NonGlobal(0xac200001), false);    // 172.32.0.1
  assert.equal(isc.ipv4NonGlobal(0x08080808), false);    // 8.8.8.8
  assert.ok(analyze('64:ff9b::10.1.2.3/128').notes.some((n) => n.level === 'warn' && /6052/.test(n.html)));
  assert.ok(!analyze('64:ff9b::198.51.100.7/96').notes.some((n) => /6052/.test(n.html)));
});

test('analysis: a bare prefix is classified as a prefix, an address with host bits as an address', () => {
  assert.equal(analyze('2001:db8:abcd::/48').type.label, 'Documentation');
  assert.equal(analyze('::/0').type.kind, 'mixed');
  assert.equal(analyze('::1/64').type.label, 'Loopback address');
  const g = analyze('2000::/3');
  assert.equal(g.type.label, 'Global unicast');
  assert.ok(g.inside.some((e) => e.prefix === '2001:db8::/32'));
  assert.ok(g.inside.some((e) => e.prefix === '2001::/23'));
  assert.ok(!g.inside.some((e) => e.prefix === '2001::/32'));   // inside 2001::/23, so not outermost
  assert.deepEqual(analyze('2001:db8::/32').inside, []);
  const s = isc.specialsInside(v('2001::'), 23).map((e) => e.prefix);
  assert.ok(s.includes('2001::/32') && s.includes('2001:1::1/128') && s.includes('2001:30::/28'));
});

test('analysis: zone IDs are kept, and flagged where they mean nothing (RFC 4007 §11.1)', () => {
  const ll = analyze('fe80::1%eth0/64');
  assert.equal(ll.zone, 'eth0');
  assert.equal(ll.type.label, 'Link-local unicast');
  assert.ok(!ll.notes.some((n) => /zone ID only/.test(n.html)));
  const g = analyze('2001:db8::1%eth0/64');
  assert.ok(g.notes.some((n) => n.level === 'warn' && /4007/.test(n.html)));
  assert.ok(!analyze('ff02::1%eth0/128').notes.some((n) => /zone ID only/.test(n.html)));
  assert.ok(analyze('ff0e::1%eth0/128').notes.some((n) => /zone ID only/.test(n.html)));
  assert.ok(analyze('fe80::1/64').notes.some((n) => n.level === 'info' && /9844/.test(n.html)));
});

test('analysis: ULA global ID, subnet ID and the hand-picked check (RFC 4193 §3.1, §3.2)', () => {
  const a = analyze('fd12:3456:789a:1::1/64');
  assert.equal(a.ula.globalId, '123456789a');
  assert.equal(a.ula.subnetId, '1');
  assert.ok(!a.notes.some((n) => /hand-picked/.test(n.html)));
  assert.ok(analyze('fd00::/48').notes.some((n) => /hand-picked/.test(n.html)));
  assert.ok(analyze('fd00:0:1::/48').notes.some((n) => /hand-picked/.test(n.html)));
  assert.ok(analyze('fdff:ffff:ffff::/48').notes.some((n) => /hand-picked/.test(n.html)));
  assert.ok(analyze('fc00::1/64').notes.some((n) => /L bit is 0/.test(n.html)));
  assert.equal(isc.ulaLooksHandPicked('4d807974a7'), false);
  assert.equal(isc.ulaLooksHandPicked('0000000001'), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// ULA generator (RFC 4193)
// ─────────────────────────────────────────────────────────────────────────────

test('ULA generator: fd00::/8, a 40-bit Global ID, /48, in RFC 5952 form', () => {
  const fixed = isc.generateUla((a) => { a.set([0x12, 0x34, 0x56, 0x78, 0x9a]); return a; });
  assert.equal(fixed.text, 'fd12:3456:789a::/48');
  assert.equal(fixed.globalId, '123456789a');
  assert.equal(fixed.firstLan, 'fd12:3456:789a::/64');
  assert.equal(fixed.lastLan, 'fd12:3456:789a:ffff::/64');
  assert.equal(isc.generateUla((a) => a.fill(0)).text, 'fd00::/48');
  assert.equal(isc.generateUla((a) => a.fill(255)).text, 'fdff:ffff:ffff::/48');
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const u = isc.generateUla((a) => globalThis.crypto.getRandomValues(a));
    assert.match(u.text, /^fd[0-9a-f]{2}:[0-9a-f]{1,4}:[0-9a-f]{1,4}::\/48$|^fd[0-9a-f]{2}:[0-9a-f:]*\/48$/);
    assert.equal(u.globalId.length, 10);
    assert.equal(u.prefix >> B(120), B(0xfd));
    assert.equal(u.prefix & ((B(1) << B(80)) - B(1)), B(0));
    assert.equal(isc.analyze(u.prefix, 48, null).type.label, 'Unique local address (ULA)');
    seen.add(u.globalId);
  }
  assert.ok(seen.size > 45);
});

test('ULA generator: randomness comes from crypto.getRandomValues, with no Math.random fallback', (t) => {
  let calls = 0;
  let size = 0;
  const original = globalThis.crypto.getRandomValues;
  t.mock.method(globalThis.crypto, 'getRandomValues', function (a) {
    calls++;
    size = a.length;
    return original.call(globalThis.crypto, a);
  });
  const u = isc.generateUla();
  assert.equal(calls, 1);
  assert.equal(size, 5);
  assert.match(u.globalId, /^[0-9a-f]{10}$/);
  assert.throws(() => isc.generateUla('not a function'), /getRandomValues/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Modified EUI-64 (RFC 4291 Appendix A)
// ─────────────────────────────────────────────────────────────────────────────

test('EUI-64: insert ff:fe and invert the universal/local bit', () => {
  const e = isc.eui64(isc.parseMac('00:1a:2b:3c:4d:5e').bytes);
  assert.equal(e.text, '21a:2bff:fe3c:4d5e');
  assert.deepEqual(e.bytes, [0x02, 0x1a, 0x2b, 0xff, 0xfe, 0x3c, 0x4d, 0x5e]);
  assert.equal(e.eui48, '00:1a:2b:ff:fe:3c:4d:5e');
  assert.equal(e.groupBit, false);
  assert.equal(e.localMac, false);
  assert.equal(isc.formatCanonical(v('fe80::') | e.iid), 'fe80::21a:2bff:fe3c:4d5e');
  // a locally administered MAC loses the bit: the ID is marked local scope
  const l = isc.eui64(isc.parseMac('02:00:5e:10:00:01').bytes);
  assert.equal(l.text, '0:5eff:fe10:1');
  assert.equal(l.localMac, true);
  assert.equal(isc.eui64(isc.parseMac('01:00:5e:00:00:fb').bytes).groupBit, true);
  assert.equal(isc.eui64(isc.parseMac('ff:ff:ff:ff:ff:ff').bytes).text, 'fdff:ffff:feff:ffff');
});

test('EUI-64: MAC formats accepted and rejected, and the reverse lookup', () => {
  const want = [0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e];
  ['00:1a:2b:3c:4d:5e', '00-1A-2B-3C-4D-5E', '001a.2b3c.4d5e', '001A2B3C4D5E', '  00:1a:2b:3c:4d:5e '].forEach((s) => {
    assert.deepEqual(isc.parseMac(s).bytes, want, s);
  });
  ['00:1a:2b:3c:4d', '00:1a:2b:3c:4d:5e:6f', '00:1a-2b:3c:4d:5e', '0:1a:2b:3c:4d:5e', 'zz:1a:2b:3c:4d:5e', '001a2b3c4d5'].forEach((s) => {
    assert.equal(isc.parseMac(s).code, 'mac-bad', s);
  });
  assert.equal(isc.parseMac('').code, 'mac-empty');
  assert.equal(isc.macFromIid(v('::21a:2bff:fe3c:4d5e')), '00:1a:2b:3c:4d:5e');
  assert.equal(isc.macFromIid(v('::1')), null);
  assert.equal(analyze('2001:db8::8d0f:7f26:f5c8:780b/64').iid.mac, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// URL hash, HTML safety
// ─────────────────────────────────────────────────────────────────────────────

test('URL hash: round trip keeps the address, zone, prefix, split and page', () => {
  const cases = [
    { input: '2001:db8:abcd::/48', split: 64, page: '0' },
    { input: 'fe80::1%eth0/64', split: 80, page: '3' },
    { input: '::ffff:192.0.2.1/128', split: null, page: '0' },
    { input: '2001:db8::/32', split: 128, page: '21267647932558653966460912964485513215' }
  ];
  cases.forEach((c) => {
    const h = isc.encodeHash(c);
    assert.equal(isc.isStateHash(h), true, h);
    assert.deepEqual(isc.decodeHash(h), c, h);
  });
  assert.equal(isc.encodeHash(cases[0]), '#a=2001:db8:abcd::/48&s=64');
  assert.equal(isc.encodeHash(cases[1]), '#a=fe80::1%25eth0/64&s=80&pg=3');
});

test('URL hash: bare addresses like the IPv4 calculator, page anchors and garbage', () => {
  assert.equal(isc.isStateHash('#2001:db8::/48'), true);
  assert.deepEqual(isc.decodeHash('#2001:db8::/48'), { input: '2001:db8::/48', split: null, page: '0' });
  assert.equal(isc.isStateHash('#how-to-use-it'), false);
  assert.equal(isc.isStateHash('#what-this-ipv6-subnet-calculator-does'), false);
  assert.equal(isc.isStateHash(''), false);
  assert.equal(isc.isStateHash('#zz:zz'), false);
  const g = isc.decodeHash('#a=' + 'f'.repeat(500) + '&s=999&pg=-1&junk&=5&a2=x');
  assert.equal(g.input.length, 200);
  assert.equal(g.split, null);
  assert.equal(g.page, '0');
  assert.deepEqual(isc.decodeHash('#a=%E0%A4%A&s=64'), { input: '', split: 64, page: '0' });
  assert.equal(isc.decodeHash('#a=x&pg=0007').page, '7');
});

test('HTML safety: user text is escaped and RFC links point at rfc-editor.org', () => {
  assert.equal(isc.escapeHtml('<b a="1">&</b>'), '&lt;b a=&quot;1&quot;&gt;&amp;&lt;/b&gt;');
  assert.match(isc.rfcLink('4291', '2.2'), /href="https:\/\/www\.rfc-editor\.org\/rfc\/rfc4291#section-2\.2"/);
  assert.match(isc.rfcLink('4291', 'appendix-A'), /#appendix-A".*RFC 4291 Appendix A/);
  assert.equal(text(isc.rfcLink('6164')), 'RFC 6164');
  const a = analyze('2001:db8::1%eth0/64');
  a.notes.forEach((n) => assert.ok(!/<script/i.test(n.html)));
});

test('source: no HTML comment markers or script end tags (the WordPress block lives in an HTML comment)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  ['script.js', 'style.css', 'index.html'].forEach((f) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ipv6-subnet-calculator', f), 'utf8');
    assert.ok(!src.includes('<' + '!--'), f + ' has an HTML comment opener');
    assert.ok(!src.includes('--' + '>'), f + ' has an HTML comment closer');
    if (f !== 'index.html') assert.ok(!/<\/script/i.test(src), f + ' has a script end tag');
  });
});
