/* IPv6 Subnet Calculator — script.js
   Prefix: isc-
   Parses every RFC 4291 §2.2 text form (with zone IDs, RFC 4007 §11), prints
   the RFC 5952 canonical form, the prefix range and counts, the address type
   from the IANA IPv6 Address Space and IPv6 Special-Purpose Address Space
   registries, ip6.arpa names (RFC 3596 §2.5), subnet splits, a ULA /48
   generator (RFC 4193) and a modified EUI-64 interface ID from a MAC
   (RFC 4291 Appendix A).
   128-bit math uses BigInt through BigInt() calls rather than 123n literals,
   so a browser without BigInt shows a message instead of a syntax error.
   No dependencies and no network requests. The calculator input lives in the
   URL hash; MAC addresses and generated ULA prefixes never do. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── 128-bit arithmetic ────────────────────────────────────

  var HAS_BIGINT = typeof BigInt === 'function';
  var ZERO, ONE, EIGHT, SIXTEEN, M8, M16, M32, M64, ALL;
  if (HAS_BIGINT) {
    ZERO = BigInt(0);
    ONE = BigInt(1);
    EIGHT = BigInt(8);
    SIXTEEN = BigInt(16);
    M8 = BigInt(255);
    M16 = BigInt(65535);
    M32 = BigInt(4294967295);
    M64 = (ONE << BigInt(64)) - ONE;
    ALL = (ONE << BigInt(128)) - ONE;
  }

  function pow2(n) { return ONE << BigInt(n); }

  // Prefix mask: `len` one bits followed by zeros
  function maskFor(len) {
    if (len <= 0) return ZERO;
    var host = BigInt(128 - len);
    return (ALL >> host) << host;
  }

  function hostMask(len) { return ALL ^ maskFor(len); }

  function toGroups(v) {
    var g = [];
    for (var i = 0; i < 8; i++) g.push(Number((v >> BigInt(112 - 16 * i)) & M16));
    return g;
  }

  function fromGroups(g) {
    var v = ZERO;
    for (var i = 0; i < 8; i++) v = (v << SIXTEEN) | BigInt(g[i]);
    return v;
  }

  function hex32(v) {
    var s = v.toString(16);
    while (s.length < 32) s = '0' + s;
    return s;
  }

  function inPrefix(v, net, len) {
    return (v & maskFor(len)) === net;
  }

  // 1234567 → "1,234,567"
  function formatBig(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatIPv4(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  // ── Text forms ────────────────────────────────────────────

  // Preferred form with every leading zero: 2001:0db8:0000:...
  function formatFull(v) {
    var h = hex32(v);
    var out = [];
    for (var i = 0; i < 8; i++) out.push(h.slice(4 * i, 4 * i + 4));
    return out.join(':');
  }

  // RFC 5952 §4: lowercase, no leading zeros, "::" for the longest run of two
  // or more zero groups (the first one on a tie), never for a single group.
  function compressGroups(g) {
    var bestStart = -1;
    var bestLen = 0;
    var i = 0;
    while (i < g.length) {
      if (g[i] === 0) {
        var j = i;
        while (j < g.length && g[j] === 0) j++;
        if (j - i > bestLen) {
          bestStart = i;
          bestLen = j - i;
        }
        i = j;
      } else {
        i++;
      }
    }
    var hex = g.map(function (x) { return x.toString(16); });
    if (bestLen < 2) return hex.join(':');
    return hex.slice(0, bestStart).join(':') + '::' + hex.slice(bestStart + bestLen).join(':');
  }

  function formatCanonical(v) {
    return compressGroups(toGroups(v));
  }

  // Well-known prefixes whose last 32 bits are an IPv4 address. RFC 5952 §5
  // recommends mixed notation for them (RFC 4291 §2.5.5.2, RFC 2765, and the
  // RFC 6052 §2.4 well-known prefix). The deprecated IPv4-compatible form
  // (::/96) stays in hex.
  var MIXED = [];

  function mixedKind(v) {
    var hi = v & maskFor(96);
    for (var i = 0; i < MIXED.length; i++) if (MIXED[i].net === hi) return MIXED[i];
    return null;
  }

  function formatMixed(v) {
    var head = compressGroups(toGroups(v).slice(0, 6));
    var v4 = formatIPv4(Number(v & M32));
    return head.slice(-2) === '::' ? head + v4 : head + ':' + v4;
  }

  // The form RFC 5952 recommends: mixed notation where §5 applies, else §4
  function formatRecommended(v) {
    return mixedKind(v) ? formatMixed(v) : formatCanonical(v);
  }

  // 64-bit interface identifier as four groups: 21a:2bff:fe3c:4d5e
  function formatIid(iid) {
    return toGroups(iid & M64).slice(4).map(function (x) { return x.toString(16); }).join(':');
  }

  // ── Parsing ───────────────────────────────────────────────

  function fail(code, message) {
    return { ok: false, code: code, message: message };
  }

  function parseIPv4Part(s) {
    var parts = s.split('.');
    if (parts.length !== 4) {
      return fail('ipv4-bad', 'The IPv4 part "' + s + '" needs four numbers separated by dots, such as 192.0.2.1.');
    }
    var n = 0;
    for (var i = 0; i < 4; i++) {
      var p = parts[i];
      if (!/^\d{1,3}$/.test(p)) {
        return fail('ipv4-bad', 'The IPv4 part "' + s + '" has "' + p + '", which is not a number from 0 to 255.');
      }
      if (p.length > 1 && p.charAt(0) === '0') {
        return fail('ipv4-leading-zero', 'The IPv4 part "' + s + '" has a leading zero in "' + p + '". Write ' + Number(p) + ': some tools read leading zeros as octal.');
      }
      var x = Number(p);
      if (x > 255) {
        return fail('ipv4-range', 'The IPv4 part "' + s + '" has ' + x + ', which is above 255.');
      }
      n = n * 256 + x;
    }
    return { ok: true, value: n };
  }

  function zoneProblem(zone) {
    if (zone === '') {
      return fail('zone-empty', 'Nothing follows "%". A zone ID names the interface, such as fe80::1%eth0 or fe80::1%12 (RFC 4007 §11).');
    }
    if (/[\s\/%\[\]]/.test(zone)) {
      return fail('zone-bad', 'The zone ID "' + zone + '" contains a space, "/", "%" or a bracket. Use only the interface name or index, such as eth0 or 12.');
    }
    if (zone.length > 64) {
      return fail('zone-bad', 'The zone ID is ' + zone.length + ' characters long. Interface names and indexes are much shorter; check what was pasted.');
    }
    return null;
  }

  // One IPv6 address in any RFC 4291 §2.2 form, optionally with "%zone"
  // (RFC 4007 §11) and surrounding brackets as in URLs.
  function parseAddress(input) {
    var s = String(input == null ? '' : input).trim();
    if (!s) return fail('empty', 'Enter an IPv6 address, for example 2001:db8::1.');
    if (s.charAt(0) === '[' && s.charAt(s.length - 1) === ']') s = s.slice(1, -1).trim();
    var zone = null;
    var pct = s.indexOf('%');
    if (pct !== -1) {
      zone = s.slice(pct + 1);
      s = s.slice(0, pct);
      var zp = zoneProblem(zone);
      if (zp) return zp;
    }
    if (!s) return fail('empty', 'Enter the address before the "%", for example fe80::1%eth0.');
    var bad = s.match(/[^0-9a-fA-F:.]/);
    if (bad) {
      return fail('bad-char', 'Unexpected character "' + bad[0] + '" in "' + s + '". An IPv6 address uses hex digits 0-9 and a-f, colons, and dots only in an embedded IPv4 part.');
    }
    if (s.indexOf(':') === -1) {
      return fail('no-colon', '"' + s + '" has no colons. An IPv6 address has 8 groups separated by colons, such as 2001:db8::1.');
    }
    var dbl = s.indexOf('::');
    if (dbl !== -1 && s.indexOf('::', dbl + 1) !== -1) {
      return fail('double-compress', '"::" appears more than once in "' + s + '". It may appear only once (RFC 4291 §2.2), otherwise nobody can tell how many zero groups each one stands for.');
    }
    if (s.charAt(0) === ':' && s.charAt(1) !== ':') {
      return fail('leading-colon', '"' + s + '" starts with a single colon. Use "::" to compress leading zero groups, as in ::1.');
    }
    if (s.charAt(s.length - 1) === ':' && s.charAt(s.length - 2) !== ':') {
      return fail('trailing-colon', '"' + s + '" ends with a single colon. Use "::" to compress trailing zero groups, as in 2001:db8::.');
    }
    var head = dbl === -1 ? s : s.slice(0, dbl);
    var tail = dbl === -1 ? '' : s.slice(dbl + 2);
    var hp = head === '' ? [] : head.split(':');
    var tp = tail === '' ? [] : tail.split(':');
    var parts = hp.concat(tp);
    var v4 = null;
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part === '') {
        return fail('empty-group', '"' + s + '" has two colons with nothing between them in the wrong place. Write each group, or use "::" once for a run of zero groups.');
      }
      if (part.indexOf('.') !== -1) {
        var last = i === parts.length - 1 && (dbl === -1 || tp.length > 0);
        if (!last) {
          return fail('ipv4-position', 'The IPv4 part "' + part + '" must be the last 32 bits of the address, as in ::ffff:192.0.2.1 (RFC 4291 §2.2).');
        }
        var p4 = parseIPv4Part(part);
        if (!p4.ok) return p4;
        v4 = p4.value;
        continue;
      }
      if (part.length > 4) {
        return fail('group-too-long', 'The group "' + part + '" has ' + part.length + ' hex digits; each group has 1 to 4 (RFC 4291 §2.2).');
      }
    }
    var count = parts.length + (v4 !== null ? 1 : 0);
    if (dbl === -1) {
      if (count < 8) {
        return fail('too-few-groups', '"' + s + '" has ' + count + ' groups of 16 bits and no "::". An IPv6 address has 8: add the missing groups or use "::" for a run of zero groups.');
      }
      if (count > 8) {
        return fail('too-many-groups', '"' + s + '" has ' + count + ' groups; an IPv6 address has exactly 8 (RFC 4291 §2.2).');
      }
    } else if (count > 7) {
      return fail('too-many-groups', '"' + s + '" has ' + count + ' groups besides "::". "::" stands for at least one zero group, so at most 7 can be written around it (RFC 4291 §2.2).');
    }
    function toNums(list) {
      var out = [];
      list.forEach(function (x) {
        if (x.indexOf('.') !== -1) {
          out.push(Math.floor(v4 / 65536), v4 % 65536);
        } else {
          out.push(parseInt(x, 16));
        }
      });
      return out;
    }
    var hg = toNums(hp);
    var tg = toNums(tp);
    var groups = hg.slice();
    for (var z = 0; z < 8 - hg.length - tg.length; z++) groups.push(0);
    groups = groups.concat(tg);
    return {
      ok: true,
      value: fromGroups(groups),
      zone: zone,
      text: s,
      hasIPv4: v4 !== null,
      compressed: dbl !== -1
    };
  }

  function parsePrefixLength(str) {
    var s = String(str == null ? '' : str).trim();
    if (s === '') return fail('prefix-empty', 'Enter a prefix length from 0 to 128.');
    if (!/^\d+$/.test(s)) return fail('prefix-bad', 'The prefix length "' + s + '" is not a whole number from 0 to 128.');
    var n = Number(s);
    if (n > 128) return fail('prefix-range', 'The prefix length /' + s + ' is too long: an IPv6 address has 128 bits, so use 0 to 128.');
    return { ok: true, value: n };
  }

  // "address[%zone][/len]"; without "/len" the separate prefix field is used
  function parseInput(text, fieldPrefix) {
    var s = String(text == null ? '' : text).trim();
    var addrText = s;
    var prefixText = null;
    var slash = s.indexOf('/');
    if (slash !== -1) {
      if (s.indexOf('/', slash + 1) !== -1) {
        return fail('prefix-bad', 'There is more than one "/" in "' + s + '". Write one prefix length, as in 2001:db8::/48.');
      }
      addrText = s.slice(0, slash);
      prefixText = s.slice(slash + 1);
      if (prefixText.indexOf('%') !== -1) {
        return fail('zone-after-prefix', 'Put the zone ID before the prefix length, as in fe80::1%eth0/64 (RFC 4007 §11.7).');
      }
    }
    var a = parseAddress(addrText);
    if (!a.ok) return a;
    var lenText = prefixText !== null ? prefixText : (fieldPrefix == null || String(fieldPrefix).trim() === '' ? '64' : fieldPrefix);
    var p = parsePrefixLength(lenText);
    if (!p.ok) return p;
    return {
      ok: true,
      value: a.value,
      zone: a.zone,
      prefix: p.value,
      prefixInInput: prefixText !== null,
      addressText: addrText.trim()
    };
  }

  // ── IANA registries ───────────────────────────────────────

  var RFC_BASE = 'https://www.rfc-editor.org/rfc/rfc';

  // IANA "IPv6 Special-Purpose Address Space", last updated 2025-10-09
  // https://www.iana.org/assignments/iana-ipv6-special-registry/
  // Flags in registry order: Source, Destination, Forwardable, Globally
  // Reachable, Reserved-by-Protocol (T = True, F = False, N = N/A or none).
  var SPECIAL_SRC = [
    ['::1', 128, 'Loopback address', 'loopback', ['4291'], 'FFFFT', 'The host itself, like 127.0.0.1 in IPv4. Packets to it never leave the host.'],
    ['::', 128, 'Unspecified address', 'reserved', ['4291'], 'TFFFT', 'Means "no address". A host uses it as the source before it has an address of its own, for example during duplicate address detection.'],
    ['::ffff:0:0', 96, 'IPv4-mapped address', 'special', ['4291'], 'FFFFT', 'An IPv4 address written as IPv6, used by dual-stack socket APIs. It never appears on the wire as an IPv6 address.'],
    ['64:ff9b::', 96, 'NAT64 well-known prefix', 'special', ['6052'], 'TTTTF', 'IPv4 addresses translated for IPv6-only clients by NAT64 and DNS64. Only global IPv4 addresses may be embedded (RFC 6052 §3.1).'],
    ['64:ff9b:1::', 48, 'Local-use IPv4/IPv6 translation prefix', 'special', ['8215'], 'TTTFF', 'For IPv4/IPv6 translation inside one network, where the well-known prefix does not fit.'],
    ['100::', 64, 'Discard-only address block', 'special', ['6666'], 'TTTFF', 'Traffic sent here is dropped on purpose, for remotely triggered black-hole routing.'],
    ['100:0:0:1::', 64, 'Dummy IPv6 prefix', 'special', ['9780'], 'TFFFF', 'A source address for systems without an IPv6 address of their own, such as BFD over MPLS.'],
    ['2001::', 23, 'IETF protocol assignments', 'special', ['2928'], 'FFFFF', 'Set aside for IETF protocols. Its flags apply unless a more specific entry allows more.'],
    ['2001::', 32, 'Teredo', 'special', ['4380', '8190'], 'TTTNF', 'Teredo tunnels IPv6 over UDP through IPv4 NAT. The address carries the Teredo server and the client\'s public IPv4 address (RFC 4380 §4).'],
    ['2001:1::1', 128, 'Port Control Protocol anycast', 'special', ['7723'], 'TTTTF', ''],
    ['2001:1::2', 128, 'TURN anycast', 'special', ['8155'], 'TTTTF', 'Traversal Using Relays around NAT.'],
    ['2001:1::3', 128, 'DNS-SD Service Registration Protocol anycast', 'special', ['9665'], 'TTTTF', ''],
    ['2001:2::', 48, 'Benchmarking', 'special', ['5180'], 'TTTFF', 'For benchmarking network devices in a lab. Not globally reachable.'],
    ['2001:3::', 32, 'AMT', 'special', ['7450'], 'TTTTF', 'Automatic Multicast Tunneling.'],
    ['2001:4:112::', 48, 'AS112-v6', 'special', ['7535'], 'TTTTF', 'AS112 servers answer stray reverse DNS queries for private address space.'],
    ['2001:10::', 28, 'Deprecated (previously ORCHID)', 'reserved', ['4843'], 'NNNNN', 'The first ORCHID prefix, terminated in March 2014 and replaced by ORCHIDv2 (2001:20::/28).'],
    ['2001:20::', 28, 'ORCHIDv2', 'special', ['7343'], 'TTTTF', 'Overlay Routable Cryptographic Hash Identifiers, used by HIP.'],
    ['2001:30::', 28, 'Drone Remote ID Protocol Entity Tags (DETs)', 'special', ['9374'], 'TTTTF', ''],
    ['2001:db8::', 32, 'Documentation', 'doc', ['3849'], 'FFFFF', 'Reserved for examples in documentation and books. Never routed on the Internet.'],
    ['2002::', 16, '6to4', 'special', ['3056'], 'TTTNF', 'The old 6to4 transition mechanism: the next 32 bits are the site\'s IPv4 address. RFC 7526 deprecated its anycast relays.'],
    ['2620:4f:8000::', 48, 'Direct Delegation AS112 Service', 'special', ['7534'], 'TTTTF', ''],
    ['3fff::', 20, 'Documentation', 'doc', ['9637'], 'FFFFF', 'The larger documentation prefix from 2024, so examples can show realistic allocation sizes. Never routed on the Internet.'],
    ['5f00::', 16, 'Segment Routing (SRv6) SIDs', 'special', ['9602'], 'TTTFF', 'Segment identifiers for SRv6 inside one operator\'s network.'],
    ['fc00::', 7, 'Unique local address (ULA)', 'ula', ['4193', '8190'], 'TTTFF', 'Private addressing for a site, like RFC 1918 space in IPv4, but with a random /48 per site so that networks rarely collide when they merge or connect over VPN.'],
    ['fe80::', 10, 'Link-local unicast', 'link', ['4291'], 'TTFFT', 'Valid on one link only. Every IPv6 interface has one, and routers never forward it (RFC 4291 §2.5.6).']
  ];

  // IANA "Internet Protocol Version 6 Address Space", last updated 2025-10-23
  // https://www.iana.org/assignments/ipv6-address-space/
  var SPACE_SRC = [
    ['::', 8, 'Reserved by IETF', 'reserved', ['4291'], 'Partly assigned to special purposes. ::/96 was the IPv4-compatible prefix, deprecated by RFC 4291.'],
    ['100::', 8, 'Reserved by IETF', 'reserved', ['4291'], 'Partly assigned to special purposes.'],
    ['200::', 7, 'Reserved by IETF', 'reserved', ['4048'], 'Formerly the OSI NSAP-mapped prefix set, deprecated in December 2004.'],
    ['400::', 6, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['800::', 5, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['1000::', 4, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['2000::', 3, 'Global unicast', 'global', ['4291'], 'The space IANA hands out to the Regional Internet Registries, which pass it on to ISPs and organisations.'],
    ['4000::', 3, 'Reserved by IETF', 'reserved', ['4291'], 'Partly assigned to special purposes (5f00::/16).'],
    ['6000::', 3, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['8000::', 3, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['a000::', 3, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['c000::', 3, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['e000::', 4, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['f000::', 5, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['f800::', 6, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['fc00::', 7, 'Unique local unicast', 'ula', ['4193'], ''],
    ['fe00::', 9, 'Reserved by IETF', 'reserved', ['4291'], ''],
    ['fe80::', 10, 'Link-scoped unicast', 'link', ['4291'], ''],
    ['fec0::', 10, 'Reserved by IETF (formerly site-local)', 'reserved', ['3879'], 'Site-local addresses were deprecated in September 2004; use unique local addresses instead.'],
    ['ff00::', 8, 'Multicast', 'multicast', ['4291'], '']
  ];

  // IANA "IPv6 Global Unicast Address Assignments", last updated 2025-10-10
  // https://www.iana.org/assignments/ipv6-unicast-address-assignments/
  var RIR_SRC = [
    '2001::/23 IANA', '2001:200::/23 APNIC', '2001:400::/23 ARIN', '2001:600::/23 RIPE NCC',
    '2001:800::/22 RIPE NCC', '2001:c00::/23 APNIC', '2001:e00::/23 APNIC', '2001:1200::/23 LACNIC',
    '2001:1400::/22 RIPE NCC', '2001:1800::/23 ARIN', '2001:1a00::/23 RIPE NCC', '2001:1c00::/22 RIPE NCC',
    '2001:2000::/19 RIPE NCC', '2001:4000::/23 RIPE NCC', '2001:4200::/23 AFRINIC', '2001:4400::/23 APNIC',
    '2001:4600::/23 RIPE NCC', '2001:4800::/23 ARIN', '2001:4a00::/23 RIPE NCC', '2001:4c00::/23 RIPE NCC',
    '2001:5000::/20 RIPE NCC', '2001:8000::/19 APNIC', '2001:a000::/20 APNIC', '2001:b000::/20 APNIC',
    '2002::/16 6to4', '2003::/18 RIPE NCC', '2400::/12 APNIC', '2410::/12 APNIC', '2600::/12 ARIN',
    '2610::/23 ARIN', '2620::/23 ARIN', '2630::/12 ARIN', '2800::/12 LACNIC', '2a00::/12 RIPE NCC',
    '2a10::/12 RIPE NCC', '2c00::/12 AFRINIC', '2d00::/8 IANA-R', '2e00::/7 IANA-R', '3000::/5 IANA-R',
    '3800::/6 IANA-R', '3c00::/7 IANA-R', '3e00::/8 IANA-R', '3f00::/9 IANA-R', '3f80::/10 IANA-R',
    '3fc0::/11 IANA-R', '3fe0::/12 IANA-R', '3ff0::/13 IANA-R', '3ff8::/14 IANA-R', '3ffc::/15 IANA-R',
    '3ffe::/16 IANA-R', '3fff::/20 Documentation'
  ];

  var RIR_NAMES = {
    'AFRINIC': 'AFRINIC (Africa)',
    'APNIC': 'APNIC (Asia-Pacific)',
    'ARIN': 'ARIN (North America)',
    'LACNIC': 'LACNIC (Latin America and the Caribbean)',
    'RIPE NCC': 'RIPE NCC (Europe, the Middle East and Central Asia)',
    'IANA': 'IANA (special-purpose assignments)',
    'IANA-R': 'Reserved by IANA (not yet allocated)',
    '6to4': '6to4 (special purpose)',
    'Documentation': 'Documentation (special purpose)'
  };

  // IANA "IPv6 Multicast Address Scopes" (RFC 7346), registry updated 2026-04-07
  var MC_SCOPES = {
    0: 'Reserved', 1: 'Interface-Local', 2: 'Link-Local', 3: 'Realm-Local', 4: 'Admin-Local',
    5: 'Site-Local', 8: 'Organization-Local', 14: 'Global', 15: 'Reserved'
  };

  // A few well-known groups from the IANA IPv6 Multicast Address Space registry
  var MC_FIXED_SRC = [
    ['ff01::1', 'All nodes on this interface', '4291'],
    ['ff01::2', 'All routers on this interface', '4291'],
    ['ff02::1', 'All nodes on the link', '4291'],
    ['ff02::2', 'All routers on the link', '4291'],
    ['ff02::5', 'OSPF routers (OSPFIGP)', '2328'],
    ['ff02::6', 'OSPF designated routers', '2328'],
    ['ff02::9', 'RIP routers', '2080'],
    ['ff02::a', 'EIGRP routers', '7868'],
    ['ff02::c', 'SSDP (UPnP discovery)', ''],
    ['ff02::d', 'All PIM routers', ''],
    ['ff02::12', 'VRRP', '9568'],
    ['ff02::16', 'All MLDv2-capable routers', '9777'],
    ['ff02::1a', 'All RPL nodes', '6550'],
    ['ff02::6a', 'All snoopers', '4286'],
    ['ff02::1:2', 'All DHCPv6 relay agents and servers', '9915'],
    ['ff02::1:3', 'Link-local Multicast Name Resolution (LLMNR)', '4795'],
    ['ff05::2', 'All routers in the site', '4291'],
    ['ff05::1:3', 'All DHCPv6 servers in the site', '9915']
  ];

  // Variable-scope groups: the same group ID in every scope (ff0X::id)
  var MC_VARIABLE = [
    [0, 'Reserved multicast address', '4291'],
    [0xfb, 'mDNS (multicast DNS)', '6762'],
    [0x101, 'NTP', '5905']
  ];

  var T = null;

  function buildEntry(src, withFlags) {
    var p = parseAddress(src[0]);
    var e = { net: p.value, len: src[1], prefix: src[0] + '/' + src[1], label: src[2], kind: src[3], refs: src[4] };
    if (withFlags) {
      e.flags = src[5];
      e.desc = src[6];
    } else {
      e.desc = src[5];
    }
    return e;
  }

  function tables() {
    if (T) return T;
    var t = {};
    t.special = SPECIAL_SRC.map(function (s) { return buildEntry(s, true); });
    t.space = SPACE_SRC.map(function (s) { return buildEntry(s, false); });
    t.rir = RIR_SRC.map(function (s) {
      var sp = s.indexOf(' ');
      var cidr = s.slice(0, sp).split('/');
      return { net: parseAddress(cidr[0]).value, len: Number(cidr[1]), prefix: s.slice(0, sp), name: s.slice(sp + 1) };
    });
    t.mcFixed = MC_FIXED_SRC.map(function (s) { return { v: parseAddress(s[0]).value, text: s[0], name: s[1], ref: s[2] }; });
    t.solicited = parseAddress('ff02::1:ff00:0').value;
    t.mapped = parseAddress('::ffff:0:0').value;
    t.translated = parseAddress('::ffff:0:0:0').value;
    t.nat64 = parseAddress('64:ff9b::').value;
    t.teredo = parseAddress('2001::').value;
    t.sixToFour = parseAddress('2002::').value;
    t.linkLocal = parseAddress('fe80::').value;
    t.ulaL = parseAddress('fd00::').value;
    T = t;
    MIXED = [
      { net: t.mapped, name: 'IPv4-mapped', ref: '4291' },
      { net: t.translated, name: 'IPv4-translated (RFC 2765)', ref: '2765' },
      { net: t.nat64, name: 'NAT64 well-known prefix', ref: '6052' }
    ];
    return t;
  }

  // Most specific entry whose block holds the whole prefix (net/len)
  function findContaining(list, net, len) {
    var best = null;
    list.forEach(function (e) {
      if (e.len <= len && inPrefix(net, e.net, e.len) && (!best || e.len > best.len)) best = e;
    });
    return best;
  }

  // Special-purpose blocks strictly inside net/len, outermost ones only
  function specialsInside(net, len) {
    var inside = tables().special.filter(function (e) {
      return e.len > len && inPrefix(e.net, net, len);
    });
    return inside.filter(function (e) {
      return !inside.some(function (o) { return o !== e && o.len < e.len && inPrefix(e.net, o.net, o.len); });
    }).sort(function (a, b) { return a.net < b.net ? -1 : (a.net > b.net ? 1 : a.len - b.len); });
  }

  function multicastInfo(v, len) {
    var t = tables();
    if (len < 8 || !inPrefix(v, BigInt(255) << BigInt(120), 8)) return null;
    var info = { known: null };
    if (len >= 16) {
      var flags = Number((v >> BigInt(116)) & BigInt(15));
      var scope = Number((v >> BigInt(112)) & BigInt(15));
      info.flags = flags;
      info.scope = scope;
      info.scopeName = MC_SCOPES[scope] || 'Unassigned';
      info.transient = (flags & 1) === 1;
      info.prefixBased = (flags & 2) === 2;
      info.embeddedRp = (flags & 4) === 4;
      info.reservedFlag = (flags & 8) === 8;
    }
    if (len === 128) {
      t.mcFixed.forEach(function (m) { if (m.v === v) info.known = { name: m.name, ref: m.ref }; });
      if (!info.known && inPrefix(v, t.solicited, 104)) {
        var tail = Number(v & BigInt(16777215)).toString(16);
        while (tail.length < 6) tail = '0' + tail;
        info.known = { name: 'Solicited-node group for addresses whose low-order 24 bits are ' + tail.slice(0, 2) + ':' + tail.slice(2), ref: '4291', solicited: true };
        info.solicitedTail = tail;
      }
      if (!info.known && info.flags === 0) {
        var gid = v & hostMask(16);
        MC_VARIABLE.forEach(function (m) {
          if (gid === BigInt(m[0])) info.known = { name: m[1] + ' (' + info.scopeName.toLowerCase() + ' scope)', ref: m[2] };
        });
      }
    }
    return info;
  }

  var NON_GLOBAL_V4 = [
    [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
    [0xa9fe0000, 16], [0xac100000, 12], [0xc0a80000, 16]
  ];

  function ipv4NonGlobal(n) {
    return NON_GLOBAL_V4.some(function (r) {
      var mask = r[1] === 0 ? 0 : (0xffffffff << (32 - r[1])) >>> 0;
      return ((n & mask) >>> 0) === r[0];
    });
  }

  // IPv4 addresses carried inside the address (RFC 4291 §2.5.5, RFC 6052,
  // RFC 3056, RFC 4380 §4)
  function embeddedIPv4(v) {
    var t = tables();
    var out = [];
    var hi = v & maskFor(96);
    var low = Number(v & M32);
    if (hi === t.mapped) {
      out.push({ label: 'IPv4-mapped', ipv4: formatIPv4(low), ref: '4291', section: '2.5.5.2', raw: low, end: 128 });
    } else if (hi === t.translated) {
      out.push({ label: 'IPv4-translated (RFC 2765, obsoleted by RFC 6145)', ipv4: formatIPv4(low), ref: '2765', section: '', raw: low, end: 128 });
    } else if (hi === t.nat64) {
      out.push({ label: 'NAT64 well-known prefix', ipv4: formatIPv4(low), ref: '6052', section: '2.4', raw: low, nat64: true, end: 128 });
    } else if (hi === ZERO && v > ONE) {
      out.push({ label: 'IPv4-compatible (deprecated)', ipv4: formatIPv4(low), ref: '4291', section: '2.5.5.1', raw: low, end: 128 });
    }
    if ((v >> BigInt(112)) === BigInt(0x2002)) {
      out.push({ label: '6to4 site', ipv4: formatIPv4(Number((v >> BigInt(80)) & M32)), ref: '3056', section: '2', end: 48 });
    }
    if ((v >> BigInt(96)) === (t.teredo >> BigInt(96))) {
      var server = Number((v >> BigInt(64)) & M32);
      var port = (Number((v >> BigInt(32)) & M16) ^ 0xffff) & 0xffff;
      var client = (low ^ 0xffffffff) >>> 0;
      out.push({ label: 'Teredo', ipv4: 'server ' + formatIPv4(server) + ', client ' + formatIPv4(client) + ' port ' + port, ref: '4380', section: '4', end: 128 });
    }
    return out;
  }

  // Classify a prefix (an address is a /128)
  function classify(net, len) {
    var t = tables();
    var c = {
      special: findContaining(t.special, net, len),
      space: findContaining(t.space, net, len),
      rir: findContaining(t.rir, net, len),
      multicast: multicastInfo(net, len)
    };
    var top = c.special || c.space;
    c.kind = c.multicast ? 'multicast' : (top ? top.kind : 'mixed');
    if (c.multicast) {
      c.label = c.multicast.scopeName ? 'Multicast, ' + c.multicast.scopeName.toLowerCase() + ' scope' : 'Multicast';
    } else if (top) {
      c.label = top.label;
    } else {
      c.label = 'Several address types';
    }
    return c;
  }

  // ── Reverse DNS (RFC 3596 §2.5) ──────────────────────────

  function nibbleName(hex) {
    return hex ? hex.split('').reverse().join('.') + '.ip6.arpa.' : 'ip6.arpa.';
  }

  function reverseName(v) {
    return nibbleName(hex32(v));
  }

  // Zones that cover net/len. A prefix that does not end on a nibble needs
  // one zone per value of the partly covered hex digit.
  function reverseZones(net, len) {
    var nibbles = Math.ceil(len / 4);
    var extra = nibbles * 4 - len;
    var count = 1 << extra;
    var zones = [];
    for (var i = 0; i < count; i++) {
      var sub = net | (BigInt(i) << BigInt(128 - nibbles * 4));
      zones.push(nibbleName(hex32(sub).slice(0, nibbles)));
    }
    return { zoneLen: nibbles * 4, aligned: extra === 0, zones: zones };
  }

  // ── Subnet split ──────────────────────────────────────────

  var PAGE_SIZE = 16;
  var COPY_ALL_MAX = 4096;

  function splitSummary(len, newLen) {
    if (!(newLen > len && newLen <= 128)) return null;
    return {
      count: pow2(newLen - len),
      countBits: newLen - len,
      size: pow2(128 - newLen),
      sizeBits: 128 - newLen,
      pages: (pow2(newLen - len) + BigInt(PAGE_SIZE - 1)) / BigInt(PAGE_SIZE),
      copyAll: pow2(newLen - len) <= BigInt(COPY_ALL_MAX)
    };
  }

  function subnetAt(net, len, newLen, index) {
    return (net & maskFor(len)) | (BigInt(index) << BigInt(128 - newLen));
  }

  // Up to n subnets of /newLen starting at subnet number `start` (a BigInt)
  function listSubnets(net, len, newLen, start, n) {
    var count = pow2(newLen - len);
    var out = [];
    var idx = BigInt(start);
    for (var i = 0; i < n && idx < count; i++, idx = idx + ONE) {
      var s = subnetAt(net, len, newLen, idx);
      var last = s | hostMask(newLen);
      out.push({ index: idx, net: s, last: last, text: formatCanonical(s) + '/' + newLen, lastText: formatCanonical(last) });
    }
    return out;
  }

  function defaultSplit(len) {
    if (len >= 128) return null;
    if (len < 48) return 48;
    if (len < 64) return 64;
    return Math.min(128, len - (len % 4) + 4);
  }

  // How the subnet number lines up with hex digits (nibbles)
  function splitNibbleInfo(len, newLen) {
    var down = newLen - (newLen % 4);
    var up = down + 4;
    return {
      aligned: newLen % 4 === 0,
      parentAligned: len % 4 === 0,
      firstDigit: Math.floor(len / 4) + 1,
      lastDigit: Math.ceil(newLen / 4),
      step: 1 << ((4 - (newLen % 4)) % 4),
      zonesEach: 1 << ((4 - (newLen % 4)) % 4),
      lower: newLen % 4 !== 0 && down > len ? down : null,
      upper: newLen % 4 !== 0 && up <= 128 ? up : null
    };
  }

  // ── ULA generator (RFC 4193 §3.2) ────────────────────────

  function defaultRandom() {
    var c = typeof crypto !== 'undefined' ? crypto : (typeof window !== 'undefined' ? window.crypto : null);
    if (!c || typeof c.getRandomValues !== 'function') return null;
    return function (a) { return c.getRandomValues(a); };
  }

  // fd00::/8 (L = 1) plus a 40-bit Global ID from a CSPRNG. RFC 4193 §3.2.1
  // requires a pseudo-random Global ID; the SHA-1 recipe of §3.2.2 is a
  // sample, and crypto.getRandomValues meets the requirement directly.
  function generateUla(getRandomValues) {
    var rng = getRandomValues || defaultRandom();
    if (typeof rng !== 'function') {
      throw new Error('This browser has no secure random number generator (crypto.getRandomValues), so no Global ID can be generated.');
    }
    var b = new Uint8Array(5);
    rng(b);
    var gid = ZERO;
    for (var i = 0; i < 5; i++) gid = (gid << EIGHT) | BigInt(b[i]);
    var prefix = (BigInt(0xfd) << BigInt(120)) | (gid << BigInt(80));
    var gidHex = gid.toString(16);
    while (gidHex.length < 10) gidHex = '0' + gidHex;
    return {
      globalId: gidHex,
      prefix: prefix,
      text: formatCanonical(prefix) + '/48',
      firstLan: formatCanonical(prefix) + '/64',
      lastLan: formatCanonical(prefix | (BigInt(65535) << BigInt(64))) + '/64'
    };
  }

  // Global ID of a ULA under fd00::/8, as 10 hex digits
  function ulaGlobalId(v) {
    var s = ((v >> BigInt(80)) & ((ONE << BigInt(40)) - ONE)).toString(16);
    while (s.length < 10) s = '0' + s;
    return s;
  }

  // Hand-picked rather than random: all one digit, or seven or more zeros
  function ulaLooksHandPicked(gidHex) {
    if (/^(.)\1*$/.test(gidHex)) return true;
    return (gidHex.match(/0/g) || []).length >= 7;
  }

  // ── Modified EUI-64 (RFC 4291 Appendix A) ────────────────

  function parseMac(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return fail('mac-empty', 'Enter a MAC address such as 00:1a:2b:3c:4d:5e.');
    var hex = null;
    var m = s.match(/^([0-9a-f]{2})([:-])([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})$/i);
    if (m) {
      hex = m[1] + m[3] + m[4] + m[5] + m[6] + m[7];
    } else if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s)) {
      hex = s.replace(/\./g, '');
    } else if (/^[0-9a-f]{12}$/i.test(s)) {
      hex = s;
    }
    if (!hex) {
      return fail('mac-bad', '"' + s + '" is not a 48-bit MAC address. Use six pairs of hex digits, such as 00:1a:2b:3c:4d:5e, 00-1A-2B-3C-4D-5E or 001a.2b3c.4d5e.');
    }
    var bytes = [];
    for (var i = 0; i < 6; i++) bytes.push(parseInt(hex.slice(2 * i, 2 * i + 2), 16));
    return { ok: true, bytes: bytes };
  }

  function formatMac(bytes) {
    return bytes.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join(':');
  }

  // Insert ff:fe in the middle and invert the universal/local bit (0x02)
  function eui64(mac) {
    var b = [mac[0] ^ 0x02, mac[1], mac[2], 0xff, 0xfe, mac[3], mac[4], mac[5]];
    var iid = ZERO;
    for (var i = 0; i < 8; i++) iid = (iid << EIGHT) | BigInt(b[i]);
    return {
      bytes: b,
      iid: iid,
      text: formatIid(iid),
      eui48: formatMac(mac.slice(0, 3)) + ':ff:fe:' + formatMac(mac.slice(3)),
      groupBit: (mac[0] & 1) === 1,
      localMac: (mac[0] & 2) === 2
    };
  }

  // The MAC behind a modified EUI-64 interface ID, or null if bytes 4-5 are not ff:fe
  function macFromIid(iid) {
    var b = [];
    for (var i = 7; i >= 0; i--) b.push(Number((iid >> BigInt(8 * i)) & M8));
    if (b[3] !== 0xff || b[4] !== 0xfe) return null;
    return formatMac([b[0] ^ 0x02, b[1], b[2], b[5], b[6], b[7]]);
  }

  // ── Analysis ──────────────────────────────────────────────

  function analyze(value, len, zone) {
    var t = tables();
    var mask = maskFor(len);
    var net = value & mask;
    var last = net | (ALL ^ mask);
    var isNetwork = value === net;
    // A specific address is classified as a /128; a bare prefix as itself
    var addrClass = classify(value, 128);
    var prefixClass = classify(net, len);
    var target = isNetwork && len < 128 ? prefixClass : addrClass;
    var a = {
      value: value,
      prefix: len,
      zone: zone || null,
      isNetwork: isNetwork,
      address: formatRecommended(value),
      addressHex: formatCanonical(value),
      expanded: formatFull(value),
      network: net,
      last: last,
      networkText: formatCanonical(net) + '/' + len,
      maskText: formatCanonical(mask),
      firstText: formatRecommended(net),
      lastText: formatRecommended(last),
      count: pow2(128 - len),
      countBits: 128 - len,
      lans64: len <= 64 ? pow2(64 - len) : null,
      blocks56: len <= 56 ? pow2(56 - len) : null,
      sites48: len <= 48 ? pow2(48 - len) : null,
      parent64: len > 64 ? formatCanonical(value & maskFor(64)) + '/64' : null,
      type: target,
      addrType: addrClass,
      prefixType: prefixClass,
      inside: specialsInside(net, len),
      embedded: [],
      ptr: reverseName(value),
      reverse: reverseZones(net, len),
      iid: null,
      notes: []
    };

    // For a bare prefix, only IPv4 fields that the prefix fully covers
    a.embedded = embeddedIPv4(value).filter(function (e) { return !isNetwork || len >= e.end; });

    var unicast = !addrClass.multicast;
    // Space where hosts and LANs are numbered; the /64 advice does not apply
    // to NAT64, IPv4-mapped, Teredo and other special-purpose prefixes
    var lanSpace = ['global', 'ula', 'link', 'doc'].indexOf(target.kind) !== -1;
    if (unicast && (value >> BigInt(125)) !== ZERO && (value & M64) !== ZERO) {
      var iid = value & M64;
      a.iid = { value: iid, text: formatIid(iid), mac: macFromIid(iid) };
    }

    if (addrClass.kind === 'ula' && inPrefix(value, t.ulaL, 8) && (len >= 40 || !isNetwork)) {
      a.ula = { globalId: ulaGlobalId(value), subnetId: len >= 64 || !isNetwork ? toGroups(value)[3].toString(16) : null };
    }

    // Notes, most important first
    var n = a.notes;
    var llScoped = addrClass.kind === 'link' || (addrClass.multicast && addrClass.multicast.scope !== undefined && addrClass.multicast.scope < 14 && addrClass.multicast.scope > 0);
    if (zone && !llScoped) {
      n.push({ level: 'warn', html: 'A zone ID only means something for link-local and scoped multicast addresses (' + rfcLink('4007', '11.1') + '). It never leaves this host, so it changes nothing for <code class="isc-code">' + escapeHtml(a.address) + '</code>.' });
    }
    if (!zone && addrClass.kind === 'link' && len >= 64) {
      n.push({ level: 'info', html: 'On a host with more than one interface, a link-local address needs a zone ID, such as <code class="isc-code">' + escapeHtml(a.address) + '%eth0</code> on Linux or <code class="isc-code">' + escapeHtml(a.address) + '%12</code> on Windows (' + rfcLink('9844', '5') + ').' });
    }
    if (addrClass.kind === 'ula' && !inPrefix(value, t.ulaL, 8)) {
      n.push({ level: 'warn', html: 'This is in fc00::/8, where the L bit is 0. RFC 4193 leaves that half undefined; locally assigned prefixes start with fd (' + rfcLink('4193', '3.2') + ').' });
    }
    if (a.ula && ulaLooksHandPicked(a.ula.globalId)) {
      n.push({ level: 'warn', html: 'The Global ID <code class="isc-code">' + a.ula.globalId + '</code> looks hand-picked. It MUST be pseudo-random so that networks you later connect do not collide (' + rfcLink('4193', '3.2') + '). Generate one with the ULA generator below.' });
    }
    if (prefixClass.space && prefixClass.space.prefix === 'fec0::/10') {
      n.push({ level: 'warn', html: 'fec0::/10 was site-local address space, deprecated in 2004 (' + rfcLink('3879') + '). Use a unique local /48 instead.' });
    }
    a.embedded.forEach(function (e) {
      if (e.nat64 && ipv4NonGlobal(e.raw)) {
        n.push({ level: 'warn', html: '64:ff9b::/96 must not carry non-global IPv4 addresses such as ' + e.ipv4 + '; translators drop these packets (' + rfcLink('6052', '3.1') + '). Use a network-specific prefix for private IPv4.' });
      }
    });
    if (lanSpace && len > 64 && len < 127) {
      n.push({ level: 'warn', html: '/' + len + ' is longer than /64. SLAAC on Ethernet and Wi-Fi only works with a /64, because interface IDs are 64 bits (' + rfcLink('4862', '5.5.3') + ', ' + rfcLink('4291', '2.5.1') + '); ' + rfcLink('7421') + ' lists what else breaks. Use /64 for LANs.' });
    } else if (lanSpace && len === 127) {
      n.push({ level: 'info', html: 'A /127 numbers a point-to-point link between two routers. Both addresses are used and the routers disable Subnet-Router anycast (' + rfcLink('6164', '6') + ').' });
    } else if (lanSpace && len === 128) {
      n.push({ level: 'info', html: 'A /128 is a single address, as used for loopback interfaces and host routes.' });
    }
    return a;
  }

  // ── URL hash ──────────────────────────────────────────────

  function encodeValue(v) {
    return encodeURIComponent(v).replace(/%3A/gi, ':').replace(/%2F/gi, '/');
  }

  // #a=<address/len>&s=<split length>&pg=<page>
  function encodeHash(st) {
    var parts = ['a=' + encodeValue(st.input || '')];
    if (st.split != null) parts.push('s=' + st.split);
    if (st.page != null && String(st.page) !== '0') parts.push('pg=' + String(st.page));
    return '#' + parts.join('&');
  }

  function isStateHash(h) {
    var s = String(h || '');
    if (s.charAt(0) === '#') s = s.slice(1);
    if (/^a=/.test(s)) return true;
    // A bare address, as the IPv4 calculator uses (#2001:db8::/48)
    if (s.indexOf(':') === -1) return false;
    var plain;
    try { plain = decodeURIComponent(s); } catch (e) { return false; }
    return parseInput(plain, '64').ok;
  }

  function decodeHash(h) {
    var out = { input: '', split: null, page: '0' };
    var s = String(h || '');
    if (s.charAt(0) === '#') s = s.slice(1);
    if (!/^a=/.test(s)) {
      try { out.input = decodeURIComponent(s).slice(0, 200); } catch (e) { out.input = ''; }
      return out;
    }
    s.split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq < 1) return;
      var k = pair.slice(0, eq);
      var raw = pair.slice(eq + 1);
      var v;
      try { v = decodeURIComponent(raw); } catch (e) { return; }
      if (k === 'a') out.input = v.slice(0, 200);
      if (k === 's' && /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 128) out.split = Number(v);
      if (k === 'pg' && /^\d{1,40}$/.test(v)) out.page = v.replace(/^0+(?=\d)/, '');
    });
    return out;
  }

  // ── HTML helpers ──────────────────────────────────────────

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function rfcLink(num, section) {
    var href = RFC_BASE + num + (section ? '#' + (/^appendix/i.test(section) ? section : 'section-' + section) : '');
    var label = 'RFC ' + num + (section ? (/^appendix/i.test(section) ? ' ' + section.replace('appendix-', 'Appendix ') : ' §' + section) : '');
    return '<a class="isc-link" href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  }

  function refsHtml(refs) {
    return refs.map(function (r) { return rfcLink(r); }).join(', ');
  }

  function code(s) {
    return '<code class="isc-code">' + escapeHtml(s) + '</code>';
  }

  var FLAG_NAMES = ['Source', 'Destination', 'Forwardable', 'Globally reachable', 'Reserved by protocol'];

  function flagsHtml(flags) {
    if (!flags || flags === 'NNNNN') return '';
    var out = [];
    for (var i = 0; i < 5; i++) {
      var f = flags.charAt(i);
      var cls = f === 'T' ? 'isc-flag--yes' : (f === 'F' ? 'isc-flag--no' : 'isc-flag--na');
      var mark = f === 'T' ? 'yes' : (f === 'F' ? 'no' : 'n/a');
      out.push('<span class="isc-flag ' + cls + '">' + FLAG_NAMES[i] + ': ' + mark + '</span>');
    }
    return '<span class="isc-flags">' + out.join('') + '</span>';
  }

  // ── UI ────────────────────────────────────────────────────

  var DEFAULT_INPUT = '2001:db8:abcd::/48';
  var LEN_CHIPS = [32, 40, 44, 48, 52, 56, 60, 64, 96, 112, 127, 128];
  var SPLIT_CHIPS = [32, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96, 112, 120, 124, 126, 127, 128];
  var EXAMPLES = [
    ['2001:db8:abcd::/48', 'Site /48'],
    ['2001:db8:abcd:1200::/56', 'Home /56'],
    ['2001:db8:abcd:12:21a:2bff:fe3c:4d5e/64', 'Host in a /64'],
    ['fe80::1%eth0/64', 'Link-local + zone'],
    ['ff02::1:ff3c:4d5e/128', 'Multicast'],
    ['::ffff:192.0.2.1/128', 'IPv4-mapped'],
    ['64:ff9b::198.51.100.7/96', 'NAT64'],
    ['2001:db8:0:1::/127', 'Point-to-point /127']
  ];

  var current = null;
  var splitLen = null;
  var page = null;
  var hitIndex = null;
  var lastKey = '';
  var lastPrefix = -1;
  var ula = null;
  var copyStore = {};
  var copyAllText = '';
  var hashActive = false;
  var lastHash = '';
  var hashTimer = null;

  function showToast(msg) {
    var t = $('isc-toast');
    if (!t) return;
    t.textContent = msg || 'Copied';
    t.classList.add('isc-show');
    setTimeout(function () { t.classList.remove('isc-show'); }, 2000);
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

  function copyButton(key, text, label) {
    copyStore[key] = text;
    return '<button class="isc-copy" type="button" data-isc-copy="' + key + '" aria-label="Copy ' + escapeHtml(label) + '">Copy</button>';
  }

  function setError(msg) {
    var el = $('isc-error');
    el.textContent = msg || '';
    el.classList.toggle('isc-visible', !!msg);
    $('isc-addr').classList.toggle('isc-input--bad', !!msg);
  }

  function rowHtml(rows, key, label, valueHtml, copy, subHtml) {
    rows.push({ label: label, copy: copy });
    return '<div class="isc-row">' +
      '<div class="isc-row-label">' + escapeHtml(label) + '</div>' +
      '<div class="isc-row-value"><div class="isc-row-main">' + valueHtml + '</div>' +
      (subHtml ? '<div class="isc-row-sub">' + subHtml + '</div>' : '') + '</div>' +
      '<div class="isc-row-copy">' + (copy != null ? copyButton(key, copy, label) : '') + '</div>' +
      '</div>';
  }

  function mono(s) {
    return '<span class="isc-mono">' + escapeHtml(s) + '</span>';
  }

  function typeBlockHtml(c) {
    var e = c.special || c.space;
    if (!e) return '';
    var parts = [];
    parts.push(code(e.prefix) + ' · ' + refsHtml(e.refs));
    if (e.desc) parts.push(escapeHtml(e.desc));
    return parts.join(' ');
  }

  function renderResults() {
    var box = $('isc-results');
    var warn = $('isc-notes-out');
    copyStore = {};
    var a = current;
    if (!a) {
      box.innerHTML = '<p class="isc-empty">Enter a valid IPv6 address or prefix above to see the results.</p>';
      warn.innerHTML = '';
      $('isc-map').innerHTML = '';
      copyAllText = '';
      return;
    }
    var rows = [];
    var html = '';
    var addrSub = [];
    if (a.address !== a.addressHex) addrSub.push('Hex-only form: ' + code(a.addressHex) + '. Mixed notation is what ' + rfcLink('5952', '5') + ' recommends for this prefix.');
    else addrSub.push('Canonical text form (' + rfcLink('5952', '4') + '): lowercase, no leading zeros, :: for the longest run of zero groups.');
    html += rowHtml(rows, 'addr', 'Address', mono(a.address), a.address, addrSub.join(' '));
    html += rowHtml(rows, 'full', 'Expanded', mono(a.expanded), a.expanded, '');
    if (a.zone) {
      html += rowHtml(rows, 'zone', 'Zone ID', mono(a.zone), a.zone, 'The interface on this host (' + rfcLink('4007', '11') + '). It is not part of the address and is never sent on the wire. With the prefix: ' + code(a.address + '%' + a.zone + '/' + a.prefix));
    }
    var netSub = a.isNetwork ? '' : 'The address you entered has host bits set; the prefix it belongs to starts at ' + code(a.firstText) + '.';
    html += rowHtml(rows, 'net', 'Network prefix', mono(a.networkText), a.networkText, netSub);
    html += rowHtml(rows, 'mask', 'Prefix mask', mono(a.maskText), a.maskText, a.prefix + ' prefix bits, ' + a.countBits + ' bits for subnets and interfaces.');
    var firstSub = '';
    if (a.prefix >= 64 && a.prefix <= 126 && !a.addrType.multicast) firstSub = 'With all interface bits zero this is the Subnet-Router anycast address (' + rfcLink('4291', '2.6.1') + '), so hosts usually start at the next one. IPv6 has no broadcast address.';
    html += rowHtml(rows, 'first', 'First address', mono(a.firstText), a.firstText, firstSub);
    html += rowHtml(rows, 'last', 'Last address', mono(a.lastText), a.lastText, '');
    html += rowHtml(rows, 'count', 'Addresses', '<span class="isc-num">' + formatBig(a.count) + '</span> <span class="isc-pow">2<sup>' + a.countBits + '</sup></span>', formatBig(a.count) + ' (2^' + a.countBits + ')', '');
    if (a.lans64 !== null) {
      html += rowHtml(rows, 'lans', '/64 LANs', '<span class="isc-num">' + formatBig(a.lans64) + '</span> <span class="isc-pow">2<sup>' + (64 - a.prefix) + '</sup></span>', formatBig(a.lans64), 'Each LAN or VLAN gets one /64 (' + rfcLink('7421') + ').');
    } else {
      html += rowHtml(rows, 'lans', '/64 LANs', 'None: smaller than one /64', null, 'This prefix is 1/2<sup>' + (a.prefix - 64) + '</sup> of ' + code(a.parent64) + '.');
    }
    if (a.blocks56 !== null && a.prefix < 56) html += rowHtml(rows, 'b56', '/56 blocks', '<span class="isc-num">' + formatBig(a.blocks56) + '</span>', formatBig(a.blocks56), 'A typical home delegation (RIPE-690 §4.2).');
    if (a.sites48 !== null && a.prefix < 48) html += rowHtml(rows, 'b48', '/48 sites', '<span class="isc-num">' + formatBig(a.sites48) + '</span>', formatBig(a.sites48), 'A typical business or site delegation (RIPE-690 §4.2).');

    // Type
    var c = a.type;
    var typeSub = [];
    var block = typeBlockHtml(c);
    if (block) typeSub.push(block);
    if (c.special && c.special.flags) typeSub.push(flagsHtml(c.special.flags));
    if (a.ula) typeSub.push('Global ID ' + code(a.ula.globalId) + (a.ula.subnetId !== null ? ', subnet ID ' + code(a.ula.subnetId) : '') + ' (' + rfcLink('4193', '3.1') + ').');
    html += rowHtml(rows, 'type', 'Address type', '<span class="isc-badge isc-badge--' + c.kind + '">' + escapeHtml(c.label) + '</span>', c.label, typeSub.join('<br>'));
    if (c.special && c.space && c.space !== c.special) {
      html += rowHtml(rows, 'space', 'IANA block', escapeHtml(c.space.label) + ' ' + code(c.space.prefix), c.space.label + ' ' + c.space.prefix, c.space.desc ? escapeHtml(c.space.desc) : '');
    }
    if (c.rir && c.kind === 'global') {
      var rn = RIR_NAMES[c.rir.name] || c.rir.name;
      html += rowHtml(rows, 'rir', 'Allocated to', escapeHtml(rn) + ' ' + code(c.rir.prefix), rn + ' ' + c.rir.prefix, 'IANA IPv6 Global Unicast Address Assignments.');
    } else if (c.kind === 'global' && !c.rir && c.space) {
      html += rowHtml(rows, 'rir', 'Allocated to', 'Not allocated to a regional registry yet', null, 'IANA IPv6 Global Unicast Address Assignments.');
    }

    // Multicast
    var m = c.multicast;
    if (m && m.scope !== undefined) {
      var fl = [];
      fl.push(m.transient ? 'T=1 transient (dynamically assigned)' : 'T=0 permanent (assigned by IANA)');
      if (m.prefixBased) fl.push('P=1 unicast-prefix-based (' + rfcLink('3306') + ')');
      if (m.embeddedRp) fl.push('R=1 embedded rendezvous point (' + rfcLink('3956') + ')');
      if (m.reservedFlag) fl.push('high flag bit set, which must be 0');
      html += rowHtml(rows, 'mscope', 'Multicast scope', m.scope.toString(16) + ' · ' + escapeHtml(m.scopeName), m.scope.toString(16) + ' ' + m.scopeName, 'Flags ' + fl.join(', ') + ' (' + rfcLink('4291', '2.7') + ', ' + rfcLink('7346') + ').');
      if (m.known) html += rowHtml(rows, 'mgroup', 'Group', escapeHtml(m.known.name), m.known.name, m.known.ref ? rfcLink(m.known.ref) : 'IANA IPv6 Multicast Address Space');
    }

    // Embedded IPv4
    a.embedded.forEach(function (e, i) {
      html += rowHtml(rows, 'v4' + i, 'Embedded IPv4', mono(e.ipv4), e.ipv4, escapeHtml(e.label) + ' (' + rfcLink(e.ref, e.section) + ').');
    });

    // Interface ID
    if (a.iid) {
      var iidSub = 'The last 64 bits. ';
      if (a.iid.mac) iidSub += 'The ff:fe in the middle suggests a modified EUI-64 ID built from the MAC ' + code(a.iid.mac) + ' (' + rfcLink('4291', 'appendix-A') + '), unless it is a coincidence.';
      else iidSub += 'Not built from a MAC: probably random, stable-privacy (' + rfcLink('7217') + ') or set by hand.';
      html += rowHtml(rows, 'iid', 'Interface ID', mono(a.iid.text), a.iid.text, iidSub);
    }

    // Special blocks inside the prefix
    if (a.inside.length) {
      var shown = a.inside.slice(0, 8).map(function (e) { return code(e.prefix) + ' ' + escapeHtml(e.label); });
      var more = a.inside.length > 8 ? ' and ' + (a.inside.length - 8) + ' more' : '';
      html += rowHtml(rows, 'inside', 'Contains', shown.join('<br>') + more, a.inside.map(function (e) { return e.prefix + ' ' + e.label; }).join('; '), 'Special-purpose blocks inside this prefix (IANA registry).');
    }

    // Reverse DNS
    html += rowHtml(rows, 'ptr', 'Reverse DNS name', mono(a.ptr), a.ptr, 'The PTR record name for this address: 32 hex digits in reverse order (' + rfcLink('3596', '2.5') + ').');
    var rz = a.reverse;
    var zoneSub;
    if (rz.aligned) {
      zoneSub = '/' + a.prefix + ' ends on a hex digit (nibble), so one zone covers it.';
    } else {
      zoneSub = '/' + a.prefix + ' does not end on a hex digit, so reverse DNS needs ' + rz.zones.length + ' zones of /' + rz.zoneLen + '. Delegations normally use nibble boundaries (RIPE-690 §4.2).';
    }
    var zoneHtml = rz.zones.map(function (z) { return mono(z); }).join('<br>');
    html += rowHtml(rows, 'zones', rz.zones.length > 1 ? 'Reverse zones' : 'Reverse zone', zoneHtml, rz.zones.join('\n'), zoneSub);

    box.innerHTML = html;

    warn.innerHTML = a.notes.map(function (x) {
      return '<p class="isc-note isc-note--' + x.level + '">' + x.html + '</p>';
    }).join('');

    copyAllText = rows.filter(function (r) { return r.copy != null; }).map(function (r) {
      return r.label + ': ' + String(r.copy).replace(/\n/g, ', ');
    }).join('\n');

    renderMap();
  }

  // Prefix map: 32 hex digits, prefix part and interface part
  function renderMap() {
    var a = current;
    var el = $('isc-map');
    if (!a) { el.innerHTML = ''; return; }
    var h = hex32(a.value);
    var full = Math.floor(a.prefix / 4);
    var part = a.prefix % 4;
    var groups = '';
    for (var g = 0; g < 8; g++) {
      var digits = '';
      for (var i = g * 4; i < g * 4 + 4; i++) {
        var cls = i < full ? 'isc-nib--net' : (i === full && part ? 'isc-nib--split' : 'isc-nib--host');
        digits += '<span class="isc-nib ' + cls + '">' + h.charAt(i) + '</span>';
      }
      groups += '<span class="isc-map-group"><span class="isc-map-digits">' + digits + '</span><span class="isc-map-bits">/' + ((g + 1) * 16) + '</span></span>';
    }
    var digitsText = full + ' hex digit' + (full === 1 ? '' : 's') + (part ? ' and ' + part + ' bit' + (part > 1 ? 's' : '') + ' of the next' : '');
    var splitHtml = '';
    if (part) {
      var d = h.charAt(full);
      var bits = parseInt(d, 16).toString(2);
      while (bits.length < 4) bits = '0' + bits;
      splitHtml = '<p class="isc-map-split">Hex digit ' + (full + 1) + ' (<span class="isc-mono">' + d + '</span> = <span class="isc-mono"><span class="isc-bit--net">' + bits.slice(0, part) + '</span><span class="isc-bit--host">' + bits.slice(part) + '</span></span>) is shared: ' + part + ' bit' + (part > 1 ? 's' : '') + ' of prefix, ' + (4 - part) + ' of host part.</p>';
    }
    el.innerHTML = '<h3 class="isc-sub">Prefix map</h3>' +
      '<div class="isc-map-row">' + groups + '</div>' +
      '<p class="isc-map-legend"><span class="isc-legend-item"><span class="isc-key isc-key--net"></span>Prefix: ' + a.prefix + ' bits (' + digitsText + ')</span>' +
      '<span class="isc-legend-item"><span class="isc-key isc-key--host"></span>Subnet and interface bits: ' + (128 - a.prefix) + '</span></p>' + splitHtml;
  }

  function lenChips() {
    var box = $('isc-len-chips');
    var html = '<span class="isc-chips-label">Prefix</span>';
    LEN_CHIPS.forEach(function (n) {
      html += '<button class="isc-chip" type="button" data-isc-len="' + n + '">/' + n + '</button>';
    });
    box.innerHTML = html;
    var ex = '<span class="isc-chips-label">Examples</span>';
    EXAMPLES.forEach(function (e, i) {
      ex += '<button class="isc-chip isc-chip--ex" type="button" data-isc-example="' + i + '" title="' + escapeHtml(e[0]) + '">' + escapeHtml(e[1]) + '</button>';
    });
    $('isc-examples').innerHTML = ex;
  }

  function highlightChips() {
    var p = current ? current.prefix : -1;
    var list = document.querySelectorAll('#isc-len-chips .isc-chip');
    for (var i = 0; i < list.length; i++) {
      var on = Number(list[i].getAttribute('data-isc-len')) === p;
      list[i].classList.toggle('isc-active', on);
      list[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function renderSplit() {
    var a = current;
    var sum = $('isc-split-summary');
    var list = $('isc-split-list');
    var pager = $('isc-pager');
    var chips = $('isc-split-chips');
    var fieldMsg = $('isc-split-msg');
    fieldMsg.textContent = '';
    fieldMsg.classList.remove('isc-visible');
    if (!a) {
      sum.innerHTML = '';
      list.innerHTML = '';
      pager.classList.add('isc-hidden');
      chips.innerHTML = '';
      return;
    }
    if (a.prefix >= 128) {
      sum.innerHTML = '<p class="isc-empty">A /128 is a single address and cannot be split.</p>';
      list.innerHTML = '';
      pager.classList.add('isc-hidden');
      chips.innerHTML = '';
      $('isc-split-len').value = '';
      return;
    }
    var html = '<span class="isc-chips-label">New length</span>';
    SPLIT_CHIPS.filter(function (n) { return n > a.prefix; }).slice(0, 8).forEach(function (n) {
      html += '<button class="isc-chip' + (n === splitLen ? ' isc-active' : '') + '" type="button" data-isc-split="' + n + '" aria-pressed="' + (n === splitLen ? 'true' : 'false') + '">/' + n + '</button>';
    });
    chips.innerHTML = html;
    if (document.activeElement !== $('isc-split-len')) $('isc-split-len').value = String(splitLen);
    $('isc-split-len').min = String(a.prefix + 1);

    var s = splitSummary(a.prefix, splitLen);
    var ni = splitNibbleInfo(a.prefix, splitLen);
    var text = '<p class="isc-split-head">' + code(a.networkText) + ' splits into <strong>' + formatBig(s.count) + '</strong> subnets of /' + splitLen +
      ' (2<sup>' + s.countBits + '</sup>), each with ' + formatBig(s.size) + (s.sizeBits === 0 ? ' address' : ' addresses') + ' (2<sup>' + s.sizeBits + '</sup>).</p>';
    var notes = [];
    if (ni.aligned && ni.parentAligned) {
      notes.push('Both lengths end on hex digits (nibbles), so the subnet number is exactly hex digit' + (ni.lastDigit > ni.firstDigit ? 's ' + ni.firstDigit + '–' + ni.lastDigit : ' ' + ni.firstDigit) + ' of the address and each subnet gets one reverse DNS zone.');
    } else if (ni.aligned) {
      notes.push('/' + splitLen + ' ends on a hex digit, so each subnet gets one reverse DNS zone. /' + a.prefix + ' does not, so the first hex digit of the subnet number is shared with the prefix.');
    } else {
      var near = [];
      if (ni.lower) near.push('/' + ni.lower);
      if (ni.upper) near.push('/' + ni.upper);
      notes.push('/' + splitLen + ' does not end on a hex digit: hex digit ' + ni.lastDigit + ' steps by ' + ni.step + ' from one subnet to the next, and each subnet needs ' + ni.zonesEach + ' reverse DNS zones.' + (near.length ? ' Nibble-aligned lengths nearby: ' + near.join(' and ') + '.' : ''));
    }
    if (splitLen > 64 && splitLen < 127 && !a.addrType.multicast) {
      notes.push('Subnets longer than /64 cannot use SLAAC. Keep /64 for LANs, /127 for router-to-router links (' + rfcLink('6164') + ') and /128 for loopbacks.');
    }
    if (!s.copyAll) {
      notes.push('Too many to list in one go, so they are shown ' + PAGE_SIZE + ' per page. Jump to any subnet by its number.');
    }
    sum.innerHTML = text + notes.map(function (x) { return '<p class="isc-hint">' + x + '</p>'; }).join('');

    if (page === null || page >= s.pages) page = ZERO;
    var start = page * BigInt(PAGE_SIZE);
    var items = listSubnets(a.network, a.prefix, splitLen, start, PAGE_SIZE);
    var rowsHtml = '<div class="isc-sub-row isc-sub-row--head" aria-hidden="true"><span class="isc-sub-idx">#</span><span class="isc-sub-net">Subnet</span><span class="isc-sub-last">Last address</span><span class="isc-sub-copy"></span></div>';
    var pageText = [];
    items.forEach(function (it) {
      pageText.push(it.text);
      var hit = hitIndex !== null && it.index === hitIndex;
      rowsHtml += '<div class="isc-sub-row' + (hit ? ' isc-sub-row--hit' : '') + '">' +
        '<span class="isc-sub-idx">' + formatBig(it.index) + '</span>' +
        '<span class="isc-sub-net isc-mono">' + escapeHtml(it.text) + '</span>' +
        '<span class="isc-sub-last isc-mono"><span class="isc-sub-tag">last </span>' + escapeHtml(it.lastText) + '</span>' +
        '<span class="isc-sub-copy">' + copyButton('sub' + it.index, it.text, it.text) + '</span></div>';
    });
    list.innerHTML = rowsHtml;
    copyStore.splitPage = pageText.join('\n');

    pager.classList.remove('isc-hidden');
    $('isc-page-info').textContent = 'Page ' + formatBig(page + ONE) + ' of ' + formatBig(s.pages);
    $('isc-page-first').disabled = page === ZERO;
    $('isc-page-prev').disabled = page === ZERO;
    $('isc-page-next').disabled = page + ONE >= s.pages;
    $('isc-page-last').disabled = page + ONE >= s.pages;
    $('isc-goto').setAttribute('placeholder', '0 to ' + formatBig(s.count - ONE));
    $('isc-copy-all-subnets').disabled = !s.copyAll;
    $('isc-copy-all-subnets').title = s.copyAll ? 'Copy all ' + formatBig(s.count) + ' subnets' : 'Copy all is available up to ' + formatBig(COPY_ALL_MAX) + ' subnets';
  }

  function renderUla() {
    var out = $('isc-ula-out');
    if (!ula) {
      out.innerHTML = '<p class="isc-empty">Press Generate to create a random prefix.</p>';
      return;
    }
    out.innerHTML =
      '<div class="isc-kv"><span class="isc-k">Your ULA prefix</span><span class="isc-v isc-v--big isc-mono">' + escapeHtml(ula.text) + '</span>' + copyButton('ula', ula.text, 'ULA prefix') + '</div>' +
      '<div class="isc-kv"><span class="isc-k">Global ID (40 random bits)</span><span class="isc-v isc-mono">' + ula.globalId + '</span></div>' +
      '<div class="isc-kv"><span class="isc-k">/64 subnets</span><span class="isc-v">65,536: <span class="isc-mono">' + escapeHtml(ula.firstLan) + '</span> to <span class="isc-mono">' + escapeHtml(ula.lastLan) + '</span></span></div>';
  }

  function newUla() {
    try {
      ula = generateUla();
    } catch (e) {
      ula = null;
      $('isc-ula-out').innerHTML = '<p class="isc-note isc-note--warn">' + escapeHtml(e.message) + '</p>';
      return;
    }
    renderUla();
  }

  function useUla() {
    if (!ula) return;
    $('isc-addr').value = ula.text;
    $('isc-len').value = '48';
    hashActive = true;
    update();
    var card = $('isc-input-card');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderEui() {
    var out = $('isc-eui-out');
    var msg = $('isc-mac-msg');
    var raw = $('isc-mac').value;
    msg.textContent = '';
    msg.classList.remove('isc-visible');
    if (!raw.trim()) {
      out.innerHTML = '<p class="isc-empty">Enter a MAC address to see the interface ID it produces.</p>';
      return;
    }
    var m = parseMac(raw);
    if (!m.ok) {
      msg.textContent = m.message;
      msg.classList.add('isc-visible');
      out.innerHTML = '';
      return;
    }
    var e = eui64(m.bytes);
    var ll = formatCanonical(tables().linkLocal | e.iid);
    var html = '';
    html += '<div class="isc-kv"><span class="isc-k">Interface ID (modified EUI-64)</span><span class="isc-v isc-v--big isc-mono">' + e.text + '</span>' + copyButton('iidout', e.text, 'interface ID') + '</div>';
    html += '<div class="isc-kv"><span class="isc-k">Link-local address</span><span class="isc-v isc-mono">' + ll + '</span>' + copyButton('llout', ll, 'link-local address') + '</div>';
    if (current && current.prefix === 64 && !current.addrType.multicast) {
      var full = formatCanonical(current.network | e.iid);
      html += '<div class="isc-kv"><span class="isc-k">In ' + escapeHtml(current.networkText) + '</span><span class="isc-v isc-mono">' + full + '</span>' + copyButton('slaacout', full, 'address') + '</div>';
    } else {
      html += '<p class="isc-hint">Enter a /64 in the calculator above to see the full SLAAC address as well.</p>';
    }
    html += '<p class="isc-steps"><span class="isc-mono">' + formatMac(m.bytes) + '</span> → insert ff:fe → <span class="isc-mono">' + e.eui48 + '</span> → invert bit 0x02 of the first byte (' +
      (m.bytes[0] < 16 ? '0' : '') + m.bytes[0].toString(16) + ' → ' + (e.bytes[0] < 16 ? '0' : '') + e.bytes[0].toString(16) + ') → <span class="isc-mono">' + e.text + '</span></p>';
    if (e.groupBit) html += '<p class="isc-note isc-note--warn">The group bit (0x01) of the first byte is set, so this is a multicast MAC, not the address of an interface.</p>';
    if (e.localMac) html += '<p class="isc-note isc-note--info">This MAC is locally administered (bit 0x02 set), as with VMs, containers and randomised Wi-Fi MACs. Inverting the bit marks the interface ID as local scope (' + rfcLink('4291', '2.5.1') + ').</p>';
    out.innerHTML = html;
  }

  function update(fromUser) {
    if (!HAS_BIGINT) return;
    var addrEl = $('isc-addr');
    var lenEl = $('isc-len');
    var res = parseInput(addrEl.value, lenEl.value);
    if (res.ok && res.prefixInInput && document.activeElement !== lenEl) lenEl.value = String(res.prefix);
    if (!res.ok) {
      setError(res.message);
      current = null;
    } else {
      setError('');
      current = analyze(res.value, res.prefix, res.zone);
      var key = current.network.toString(16) + '/' + current.prefix;
      if (key !== lastKey) {
        page = ZERO;
        hitIndex = null;
        lastKey = key;
      }
      // A new prefix length gets a fresh default split; a new address keeps it
      if (current.prefix !== lastPrefix || splitLen === null || splitLen <= current.prefix) splitLen = defaultSplit(current.prefix);
      lastPrefix = current.prefix;
    }
    renderResults();
    highlightChips();
    renderSplit();
    renderEui();
    if (fromUser) hashActive = true;
    if (hashActive && res.ok) scheduleHash();
  }

  function hashState() {
    var addrText = $('isc-addr').value.trim();
    var input = addrText.indexOf('/') !== -1 ? addrText : addrText + '/' + $('isc-len').value.trim();
    return { input: input, split: splitLen, page: page === null ? '0' : page.toString() };
  }

  function writeHash() {
    var h = encodeHash(hashState());
    lastHash = h;
    try { history.replaceState(null, '', location.pathname + location.search + h); } catch (e) { /* ignore */ }
  }

  function scheduleHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(writeHash, 250);
  }

  function applyHash(h) {
    var st = decodeHash(h);
    if (!st.input) return false;
    $('isc-addr').value = st.input;
    var p = parseInput(st.input, '64');
    if (p.ok) $('isc-len').value = String(p.prefix);
    splitLen = st.split;
    lastKey = '';
    update(false);
    if (current && st.split && st.split > current.prefix) {
      splitLen = st.split;
      var s = splitSummary(current.prefix, splitLen);
      var pg = BigInt(st.page);
      page = s && pg < s.pages ? pg : ZERO;
      renderSplit();
    }
    return true;
  }

  function copyLink() {
    if (!current) {
      showToast('Fix the address first');
      return;
    }
    hashActive = true;
    writeHash();
    copyText(location.href.split('#')[0] + encodeHash(hashState()), 'Link copied');
  }

  function copyAll() {
    if (!copyAllText) {
      showToast('Nothing to copy yet');
      return;
    }
    copyText(copyAllText, 'Results copied');
  }

  function resetAll() {
    $('isc-addr').value = DEFAULT_INPUT;
    $('isc-len').value = '48';
    $('isc-mac').value = '';
    splitLen = null;
    page = ZERO;
    hitIndex = null;
    lastKey = '';
    hashActive = false;
    lastHash = '';
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    update(false);
  }

  function setSplit(n) {
    if (!current) return;
    splitLen = n;
    page = ZERO;
    hitIndex = null;
    renderSplit();
    hashActive = true;
    scheduleHash();
  }

  function onSplitInput() {
    if (!current) return;
    var el = $('isc-split-len');
    var msg = $('isc-split-msg');
    var v = el.value.trim();
    var n = Number(v);
    if (!/^\d{1,3}$/.test(v) || n <= current.prefix || n > 128) {
      msg.textContent = 'Use a length from /' + (current.prefix + 1) + ' to /128, longer than the prefix /' + current.prefix + '.';
      msg.classList.add('isc-visible');
      return;
    }
    msg.textContent = '';
    msg.classList.remove('isc-visible');
    setSplit(n);
  }

  function goPage(which) {
    if (!current || current.prefix >= 128) return;
    var s = splitSummary(current.prefix, splitLen);
    if (!s) return;
    if (which === 'first') page = ZERO;
    if (which === 'prev' && page > ZERO) page = page - ONE;
    if (which === 'next' && page + ONE < s.pages) page = page + ONE;
    if (which === 'last') page = s.pages - ONE;
    hitIndex = null;
    renderSplit();
    hashActive = true;
    scheduleHash();
  }

  function goTo() {
    if (!current || current.prefix >= 128) return;
    var s = splitSummary(current.prefix, splitLen);
    var raw = $('isc-goto').value.replace(/[\s,_]/g, '');
    var msg = $('isc-split-msg');
    if (!/^\d{1,40}$/.test(raw) || BigInt(raw) >= s.count) {
      msg.textContent = 'Enter a subnet number from 0 to ' + formatBig(s.count - ONE) + '.';
      msg.classList.add('isc-visible');
      return;
    }
    var idx = BigInt(raw);
    hitIndex = idx;
    page = idx / BigInt(PAGE_SIZE);
    renderSplit();
    hashActive = true;
    scheduleHash();
  }

  function copySubnets(all) {
    if (!current || current.prefix >= 128) return;
    if (!all) {
      copyText(copyStore.splitPage || '', 'Page copied');
      return;
    }
    var s = splitSummary(current.prefix, splitLen);
    if (!s.copyAll) return;
    var items = listSubnets(current.network, current.prefix, splitLen, ZERO, Number(s.count));
    copyText(items.map(function (it) { return it.text; }).join('\n'), formatBig(s.count) + ' subnets copied');
  }

  function onLenInput() {
    var addrEl = $('isc-addr');
    var v = addrEl.value;
    var slash = v.indexOf('/');
    if (slash !== -1) addrEl.value = v.slice(0, slash) + '/' + $('isc-len').value.trim();
    update(true);
  }

  function init() {
    var wrap = $('isc-wrapper');
    if (!wrap) return;
    if (!HAS_BIGINT) {
      setError('This browser does not support BigInt, which the 128-bit math needs. Use a current version of Firefox, Chrome, Edge or Safari.');
      return;
    }
    tables();
    lenChips();
    var fromHash = isStateHash(location.hash) && applyHash(location.hash);
    if (fromHash) {
      hashActive = true;
      lastHash = location.hash;
    } else {
      $('isc-addr').value = DEFAULT_INPUT;
      $('isc-len').value = '48';
      update(false);
    }
    newUla();
    $('isc-addr').addEventListener('input', function () { update(true); });
    $('isc-len').addEventListener('input', onLenInput);
    $('isc-split-len').addEventListener('input', onSplitInput);
    $('isc-mac').addEventListener('input', renderEui);
    $('isc-goto').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); goTo(); }
    });
    wrap.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var btn = t.closest('[data-isc-copy]');
      if (btn) {
        var key = btn.getAttribute('data-isc-copy');
        if (copyStore[key] != null) copyText(copyStore[key]);
        return;
      }
      var len = t.closest('[data-isc-len]');
      if (len) {
        $('isc-len').value = len.getAttribute('data-isc-len');
        onLenInput();
        return;
      }
      var ex = t.closest('[data-isc-example]');
      if (ex) {
        var e = EXAMPLES[Number(ex.getAttribute('data-isc-example'))];
        $('isc-addr').value = e[0];
        update(true);
        return;
      }
      var sp = t.closest('[data-isc-split]');
      if (sp) {
        setSplit(Number(sp.getAttribute('data-isc-split')));
        return;
      }
      var pg = t.closest('[data-isc-page]');
      if (pg) goPage(pg.getAttribute('data-isc-page'));
    });
    window.addEventListener('hashchange', function () {
      if (location.hash === lastHash || !isStateHash(location.hash)) return;
      lastHash = location.hash;
      hashActive = true;
      applyHash(location.hash);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Global handlers for onclick attributes
  window.iscCopyLink = copyLink;
  window.iscCopyAll = copyAll;
  window.iscReset = resetAll;
  window.iscNewUla = newUla;
  window.iscUseUla = useUla;
  window.iscGoTo = goTo;
  window.iscCopySubnets = copySubnets;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    tables();
    module.exports = {
      HAS_BIGINT: HAS_BIGINT,
      PAGE_SIZE: PAGE_SIZE,
      COPY_ALL_MAX: COPY_ALL_MAX,
      SPECIAL_SRC: SPECIAL_SRC,
      SPACE_SRC: SPACE_SRC,
      maskFor: maskFor,
      hostMask: hostMask,
      toGroups: toGroups,
      fromGroups: fromGroups,
      hex32: hex32,
      formatBig: formatBig,
      formatIPv4: formatIPv4,
      formatFull: formatFull,
      compressGroups: compressGroups,
      formatCanonical: formatCanonical,
      formatMixed: formatMixed,
      formatRecommended: formatRecommended,
      formatIid: formatIid,
      parseAddress: parseAddress,
      parsePrefixLength: parsePrefixLength,
      parseInput: parseInput,
      classify: classify,
      specialsInside: specialsInside,
      multicastInfo: multicastInfo,
      embeddedIPv4: embeddedIPv4,
      ipv4NonGlobal: ipv4NonGlobal,
      reverseName: reverseName,
      reverseZones: reverseZones,
      splitSummary: splitSummary,
      subnetAt: subnetAt,
      listSubnets: listSubnets,
      defaultSplit: defaultSplit,
      splitNibbleInfo: splitNibbleInfo,
      generateUla: generateUla,
      ulaGlobalId: ulaGlobalId,
      ulaLooksHandPicked: ulaLooksHandPicked,
      parseMac: parseMac,
      formatMac: formatMac,
      eui64: eui64,
      macFromIid: macFromIid,
      analyze: analyze,
      encodeHash: encodeHash,
      decodeHash: decodeHash,
      isStateHash: isStateHash,
      escapeHtml: escapeHtml,
      rfcLink: rfcLink
    };
  }
})();
