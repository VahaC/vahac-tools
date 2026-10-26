// WireGuard Config Generator — script.js
// Prefix: wgc-
//
// Dependencies. Both are loaded on demand by a dynamic script-tag loader (loadScript),
// pinned with Subresource Integrity, and neither is needed to build the configs:
// - qrcode-generator v2.0.4 (MIT, Kazuhiko Arase), loaded by ensureQrLib() the first time
//   you press "Show QR code". Same library and version as the Wi-Fi and vCard QR tools,
//   but the package's own dist/qrcode.js instead of jsDelivr's generated qrcode.min.js:
//   only a file that ships in the npm package has a fixed hash for SRI, and this library
//   sees the config text, private key included.
//   https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js
// - TweetNaCl.js v1.0.3 (public domain, audited by Cure53), loaded by ensureNacl() only
//   when the browser's WebCrypto has no X25519. Only nacl.scalarMult and
//   nacl.scalarMult.base are used.
//   https://cdnjs.cloudflare.com/ajax/libs/tweetnacl/1.0.3/nacl.min.js
//
// Keys:
// - Preferred engine: WebCrypto X25519. crypto.subtle.generateKey({ name: 'X25519' }, true,
//   ['deriveBits']); the private key is exported as JWK "d", the public key as raw bytes.
//   The private key is then clamped exactly like `wg genkey` (curve25519_clamp_secret in
//   wireguard-tools src/curve25519.h), and the public key is derived again from the clamped
//   key (deriveBits against the base point u = 9) and compared. X25519 clamps the scalar
//   itself (RFC 7748 decodeScalar25519), so clamping never changes the public key.
// - Fallback engine: 32 bytes from crypto.getRandomValues, clamped, public key from
//   nacl.scalarMult.base().
// - Preshared keys: 32 bytes from crypto.getRandomValues, not clamped (like `wg genpsk`).
// - An engine is only used after it reproduces the RFC 7748 section 6.1 test vector.
// - Math.random is never used. Private and preshared keys live in memory only: never in the
//   URL, localStorage, cookies or any request.
//
// WireGuard behaviour this tool relies on, checked against primary sources on 2026-10-26:
// - wg(8): [Interface] PrivateKey, ListenPort; [Peer] PublicKey, PresharedKey, AllowedIPs,
//   Endpoint, PersistentKeepalive (1-65535 seconds, off by default, 25 suggested behind NAT).
//   Keys are 32 bytes in base64: 44 characters ending in "=", and the 43rd character must
//   carry two zero padding bits (wireguard-tools src/encoding.c, key_from_base64).
// - wg-quick(8): Address, DNS (IP addresses, or names that become search domains), MTU,
//   PostUp/PostDown run by bash with %i expanded, each key allowed several times. Without
//   MTU it uses the outgoing link's MTU minus 80 (src/wg-quick/linux.bash, set_mtu_up), and
//   the file name without ".conf" must match [a-zA-Z0-9_=+.-]{1,15}. A failing PostUp
//   command makes wg-quick remove the interface again (set -e plus its EXIT trap).
// - wg syncconf / setconf clear a private key that the file does not contain, so the
//   server's PrivateKey has to stay in wg0.conf (wireguard-tools src/config.c,
//   config_read_init sets WGDEVICE_HAS_PRIVATE_KEY).
// - The wg-quick@.service unit reloads with `wg syncconf %i <(wg-quick strip %i)`.
// - Official apps: the QR code holds the wg-quick text (both apps say "Tip: generate with
//   qrencode -t ansiutf8 < tunnel.conf"). Their parsers reject unknown keys, so client
//   configs only use PrivateKey, Address, DNS, MTU and the five [Peer] keys
//   (wireguard-android config/Interface.java and Peer.java; wireguard-apple
//   TunnelConfiguration+WgQuickConfig.swift). Android tunnel names follow the same
//   15-character rule (backend/Tunnel.java). Both apps use MTU 1280 when none is set.
// - Cryptokey routing (wireguard.com): the server drops a packet from a peer whose source
//   address is outside that peer's AllowedIPs, and routes by them when sending, so every
//   client gets its own /32 (and /128) on the server and the server lists no Endpoint.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Constants ───────────────────────────────────────────

  var QR_LIB_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.js';
  var QR_LIB_SRI = 'sha256-eeyG+ChWAFsciHkFz8z8++w4Icphx/1alS+qX3ePeRw=';
  var NACL_URL = 'https://cdnjs.cloudflare.com/ajax/libs/tweetnacl/1.0.3/nacl.min.js';
  var NACL_SRI = 'sha512-Y3uH6LJI2RBp6Ebvyom1/v+MQitXJBNSshRcTxKHn0sL0DSf+G+8KK1VZsXtzlX9xd17gGNi61MdYdcY+56oNw==';

  var MAX_PEERS = 100;
  var MAX_NAME = 40;
  var DEFAULT_PORT = 51820;
  var DEFAULT_IFACE = 'wg0';
  var EXAMPLE_ENDPOINT = 'vpn.example.com';
  var SERVER_KEY_PLACEHOLDER = 'PASTE_SERVER_PRIVATE_KEY_HERE';
  var MASK = '••••••••••••••••••••••••••••••••••••••••••••';
  var GENKEY_CMD = "sudo sh -c 'umask 077; mkdir -p /etc/wireguard; wg genkey | tee /etc/wireguard/server.key | wg pubkey'";

  var IFACE_RE = /^[a-zA-Z0-9_=+.-]{1,15}$/;
  var KEY_CHARS_RE = /^[A-Za-z0-9+/]{43}=$/;
  var KEY_RE = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
  var LABEL_RE = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i;
  var NIC_RE = /^[A-Za-z0-9_.-]{1,15}$/;
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  // Byte-mode capacity of QR version 40 per error correction level (ISO/IEC 18004, table 7)
  var QR_MAX_BYTES = { L: 2953, M: 2331, Q: 1663, H: 1273 };

  // RFC 7748 section 6.1: X25519 Diffie-Hellman test vector
  var RFC7748 = {
    alicePriv: '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
    alicePub: '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
    bobPriv: '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb',
    bobPub: 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
    shared: '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742'
  };

  // PKCS #8 wrapper for a raw 32-byte X25519 private key (RFC 8410)
  var PKCS8_X25519 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20];

  // ── Small helpers ───────────────────────────────────────

  function str(v) { return v == null ? '' : String(v); }
  function trim(v) { return str(v).replace(/^\s+|\s+$/g, ''); }

  function escapeHtml(s) {
    return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Escape, then turn `code` spans into <code> elements
  function richText(s) {
    return escapeHtml(s).replace(/`([^`]+)`/g, '<code class="wgc-code">$1</code>');
  }

  // Drop control characters (newlines would break a config comment line)
  function stripControl(s) {
    var out = '';
    s = str(s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 32 && c !== 127) out += s.charAt(i);
    }
    return out;
  }

  function splitList(text) {
    return trim(text).split(/[\s,;]+/).filter(function (t) { return t !== ''; });
  }

  // ── Bytes and base64 ────────────────────────────────────

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  function bytesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  function wipe(bytes) {
    if (bytes && typeof bytes.fill === 'function') bytes.fill(0);
  }

  function bytesToBase64(bytes) {
    var out = '';
    var i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
    }
    var rest = bytes.length - i;
    if (rest === 1) {
      var a = bytes[i] << 16;
      out += B64.charAt((a >> 18) & 63) + B64.charAt((a >> 12) & 63) + '==';
    } else if (rest === 2) {
      var b = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64.charAt((b >> 18) & 63) + B64.charAt((b >> 12) & 63) + B64.charAt((b >> 6) & 63) + '=';
    }
    return out;
  }

  // Standard or URL-safe base64, padding optional. Returns null on bad input.
  function base64ToBytes(text) {
    var s = str(text).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    if (/[^A-Za-z0-9+/]/.test(s) || s.length % 4 === 1) return null;
    var out = [];
    var buf = 0;
    var bits = 0;
    for (var i = 0; i < s.length; i++) {
      buf = ((buf << 6) | B64.indexOf(s.charAt(i))) & 0xffffff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buf >> bits) & 255);
      }
    }
    return new Uint8Array(out);
  }

  function utf8Bytes(text) {
    text = str(text);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    var s = unescape(encodeURIComponent(text));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // One char per UTF-8 byte, for the QR library's byte mode
  function utf8ByteString(text) {
    var bytes = utf8Bytes(text);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  // ── WireGuard keys ──────────────────────────────────────

  // Same acceptance rule as wireguard-tools key_from_base64()
  function parseKey(text) {
    var s = trim(text);
    if (!s) return { ok: false, empty: true, error: 'is empty' };
    if (s.length !== 44) {
      return { ok: false, error: 'must be 44 characters (32 bytes in base64, ending in "="), this one has ' + s.length };
    }
    if (!KEY_CHARS_RE.test(s)) {
      return { ok: false, error: 'may only contain A–Z, a–z, 0–9, + and /, followed by one "="' };
    }
    if (!KEY_RE.test(s)) {
      return { ok: false, error: 'is not a valid key: its 43rd character must be one of A E I M Q U Y c g k o s w 0 4 8, so a character was probably mistyped' };
    }
    return { ok: true, key: s, bytes: base64ToBytes(s) };
  }

  // curve25519_clamp_secret() from wireguard-tools, as `wg genkey` applies it
  function clampPrivateKey(bytes) {
    var k = new Uint8Array(bytes);
    k[0] &= 248;
    k[31] = (k[31] & 127) | 64;
    return k;
  }

  function isClamped(bytes) {
    return bytes.length === 32 && (bytes[0] & 7) === 0 && (bytes[31] & 128) === 0 && (bytes[31] & 64) === 64;
  }

  function randomBytes(getRandomValues, n) {
    var b = new Uint8Array(n);
    getRandomValues(b);
    return b;
  }

  // `wg genpsk`: 32 random bytes, no clamping
  function generatePresharedKey(getRandomValues) {
    var b = randomBytes(getRandomValues, 32);
    var key = bytesToBase64(b);
    wipe(b);
    return key;
  }

  function webCryptoEngine(subtle) {
    var ALG = { name: 'X25519' };
    var basePoint = new Uint8Array(32);
    basePoint[0] = 9;

    function importPrivate(bytes) {
      var der = new Uint8Array(48);
      der.set(PKCS8_X25519, 0);
      der.set(bytes, 16);
      return subtle.importKey('pkcs8', der, ALG, false, ['deriveBits']).then(function (key) {
        wipe(der);
        return key;
      });
    }

    function scalarMult(privBytes, pubBytes) {
      return Promise.all([
        importPrivate(privBytes),
        subtle.importKey('raw', new Uint8Array(pubBytes), ALG, true, [])
      ]).then(function (k) {
        return subtle.deriveBits({ name: 'X25519', public: k[1] }, k[0], 256);
      }).then(function (bits) {
        return new Uint8Array(bits);
      });
    }

    function scalarMultBase(privBytes) {
      return scalarMult(privBytes, basePoint);
    }

    function generateKeyPair() {
      return subtle.generateKey(ALG, true, ['deriveBits']).then(function (pair) {
        return Promise.all([subtle.exportKey('jwk', pair.privateKey), subtle.exportKey('raw', pair.publicKey)]);
      }).then(function (res) {
        var d = base64ToBytes(res[0] && res[0].d);
        var pub = new Uint8Array(res[1]);
        if (!d || d.length !== 32 || pub.length !== 32) throw new Error('unexpected X25519 key export');
        var priv = clampPrivateKey(d);
        wipe(d);
        return scalarMultBase(priv).then(function (check) {
          if (!bytesEqual(check, pub)) throw new Error('X25519 public key check failed');
          return { privateKey: priv, publicKey: pub };
        });
      });
    }

    return {
      id: 'webcrypto',
      label: 'WebCrypto X25519 built into your browser',
      scalarMult: scalarMult,
      scalarMultBase: scalarMultBase,
      generateKeyPair: generateKeyPair
    };
  }

  function naclEngine(nacl, getRandomValues) {
    function scalarMult(privBytes, pubBytes) {
      return Promise.resolve(new Uint8Array(nacl.scalarMult(new Uint8Array(privBytes), new Uint8Array(pubBytes))));
    }
    function scalarMultBase(privBytes) {
      return Promise.resolve(new Uint8Array(nacl.scalarMult.base(new Uint8Array(privBytes))));
    }
    function generateKeyPair() {
      var raw = randomBytes(getRandomValues, 32);
      var priv = clampPrivateKey(raw);
      wipe(raw);
      return scalarMultBase(priv).then(function (pub) {
        return { privateKey: priv, publicKey: pub };
      });
    }
    return {
      id: 'nacl',
      label: 'TweetNaCl.js 1.0.3 (this browser\'s WebCrypto has no X25519)',
      scalarMult: scalarMult,
      scalarMultBase: scalarMultBase,
      generateKeyPair: generateKeyPair
    };
  }

  // RFC 7748 section 6.1 in both directions
  function selfTest(engine) {
    var v = RFC7748;
    return Promise.all([
      engine.scalarMultBase(hexToBytes(v.alicePriv)),
      engine.scalarMultBase(hexToBytes(v.bobPriv)),
      engine.scalarMult(hexToBytes(v.alicePriv), hexToBytes(v.bobPub)),
      engine.scalarMult(hexToBytes(v.bobPriv), hexToBytes(v.alicePub))
    ]).then(function (r) {
      return bytesToHex(r[0]) === v.alicePub && bytesToHex(r[1]) === v.bobPub &&
        bytesToHex(r[2]) === v.shared && bytesToHex(r[3]) === v.shared;
    });
  }

  // env: { subtle, getRandomValues, loadNacl } — WebCrypto first, TweetNaCl as fallback
  function pickEngine(env) {
    env = env || {};
    if (typeof env.getRandomValues !== 'function') {
      return Promise.reject(new Error('this browser has no crypto.getRandomValues, so it cannot create keys safely'));
    }

    function fallback(reason) {
      if (typeof env.loadNacl !== 'function') return Promise.reject(new Error(reason));
      return env.loadNacl().then(function (nacl) {
        var eng = naclEngine(nacl, env.getRandomValues);
        return selfTest(eng).then(function (ok) {
          if (!ok) throw new Error('the TweetNaCl fallback failed the RFC 7748 self-test');
          eng.reason = reason;
          return eng;
        });
      }, function () {
        throw new Error(reason + ', and the TweetNaCl fallback could not be loaded from cdnjs.cloudflare.com');
      });
    }

    if (!env.subtle) return fallback('WebCrypto is not available on this page');
    var eng = webCryptoEngine(env.subtle);
    return eng.generateKeyPair().then(function () {
      return selfTest(eng);
    }).then(function (ok) {
      if (!ok) return fallback('WebCrypto X25519 failed the RFC 7748 self-test');
      return eng;
    }, function (err) {
      return fallback('WebCrypto has no X25519 support' + (err && err.name ? ' (' + err.name + ')' : ''));
    });
  }

  // Key pair as base64 strings
  function generateKeyPair(engine) {
    return engine.generateKeyPair().then(function (kp) {
      var out = { priv: bytesToBase64(kp.privateKey), pub: bytesToBase64(kp.publicKey) };
      wipe(kp.privateKey);
      return out;
    });
  }

  // ── IPv4 ────────────────────────────────────────────────

  function parseIPv4(text) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(trim(text));
    if (!m) return null;
    var n = 0;
    for (var i = 1; i <= 4; i++) {
      if (m[i].length > 1 && m[i].charAt(0) === '0') return null;
      var octet = Number(m[i]);
      if (octet > 255) return null;
      n = n * 256 + octet;
    }
    return n;
  }

  function formatIPv4(n) {
    return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
  }

  function parsePrefix(text, max) {
    if (!/^\d{1,3}$/.test(text) || (text.length > 1 && text.charAt(0) === '0')) return null;
    var p = Number(text);
    return p <= max ? p : null;
  }

  function parseCidr4(text) {
    var m = /^([^/\s]+)\/(\d{1,3})$/.exec(trim(text));
    if (!m) return null;
    var ip = parseIPv4(m[1]);
    var prefix = parsePrefix(m[2], 32);
    if (ip === null || prefix === null) return null;
    var size = Math.pow(2, 32 - prefix);
    var network = ip - (ip % size);
    return {
      v: 4, ip: ip, prefix: prefix, network: network, size: size,
      last: network + size - 1, hostBits: ip !== network,
      text: formatIPv4(network) + '/' + prefix
    };
  }

  function contains4(net, ip) {
    return ip >= net.network && ip <= net.last;
  }

  function overlaps4(a, b) {
    return a.network <= b.last && b.network <= a.last;
  }

  var PRIVATE_V4 = [
    { network: 167772160, last: 184549375 },   // 10.0.0.0/8
    { network: 2886729728, last: 2887778303 }, // 172.16.0.0/12
    { network: 3232235520, last: 3232301055 }  // 192.168.0.0/16
  ];
  var CGNAT_V4 = { network: 1681915904, last: 1686110207 }; // 100.64.0.0/10 (RFC 6598)

  function isPrivate4(net) {
    for (var i = 0; i < PRIVATE_V4.length; i++) {
      if (net.network >= PRIVATE_V4[i].network && net.last <= PRIVATE_V4[i].last) return true;
    }
    return false;
  }

  function isCgnat4(net) {
    return net.network >= CGNAT_V4.network && net.last <= CGNAT_V4.last;
  }

  // ── IPv6 (eight 16-bit words) ───────────────────────────

  function parseIPv6(text) {
    var s = trim(text).toLowerCase();
    if (!s || /[^0-9a-f:.]/.test(s) || s.indexOf(':') === -1) return null;
    if (s.indexOf('.') !== -1) {
      var cut = s.lastIndexOf(':');
      var v4 = parseIPv4(s.slice(cut + 1));
      if (v4 === null) return null;
      s = s.slice(0, cut + 1) + Math.floor(v4 / 65536).toString(16) + ':' + (v4 % 65536).toString(16);
    }
    var dbl = s.indexOf('::');
    if (dbl !== s.lastIndexOf('::')) return null;
    var head;
    var tail = [];
    if (dbl === -1) {
      head = s.split(':');
      if (head.length !== 8) return null;
    } else {
      head = dbl > 0 ? s.slice(0, dbl).split(':') : [];
      tail = dbl + 2 < s.length ? s.slice(dbl + 2).split(':') : [];
      if (head.length + tail.length > 7) return null;
    }
    var words = [];
    var bad = false;
    var push = function (h) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) { bad = true; return; }
      words.push(parseInt(h, 16));
    };
    head.forEach(push);
    if (dbl !== -1) {
      for (var z = 8 - head.length - tail.length; z > 0; z--) words.push(0);
    }
    tail.forEach(push);
    return !bad && words.length === 8 ? words : null;
  }

  // RFC 5952 text form: lowercase, no leading zeros, longest zero run (2+ words) as "::"
  function formatIPv6(words) {
    var bestStart = -1;
    var bestLen = 0;
    var curStart = -1;
    var curLen = 0;
    for (var i = 0; i < 8; i++) {
      if (words[i] === 0) {
        if (curStart < 0) { curStart = i; curLen = 0; }
        curLen++;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else {
        curStart = -1;
      }
    }
    var hex = words.map(function (w) { return w.toString(16); });
    if (bestLen < 2) return hex.join(':');
    return hex.slice(0, bestStart).join(':') + '::' + hex.slice(bestStart + bestLen).join(':');
  }

  function maskIPv6(words, prefix) {
    var out = [];
    for (var i = 0; i < 8; i++) {
      var bits = Math.max(0, Math.min(16, prefix - i * 16));
      var m = bits === 0 ? 0 : (0xffff << (16 - bits)) & 0xffff;
      out.push(words[i] & m);
    }
    return out;
  }

  function addIPv6(words, n) {
    var out = words.slice();
    var carry = n;
    for (var i = 7; i >= 0 && carry > 0; i--) {
      var sum = out[i] + carry;
      out[i] = sum % 65536;
      carry = Math.floor(sum / 65536);
    }
    return carry > 0 ? null : out;
  }

  function wordsEqual(a, b) {
    for (var i = 0; i < 8; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function parseCidr6(text) {
    var m = /^([^/\s]+)\/(\d{1,3})$/.exec(trim(text));
    if (!m) return null;
    var words = parseIPv6(m[1]);
    var prefix = parsePrefix(m[2], 128);
    if (!words || prefix === null) return null;
    var net = maskIPv6(words, prefix);
    return {
      v: 6, words: words, prefix: prefix, network: net, hostBits: !wordsEqual(words, net),
      text: formatIPv6(net) + '/' + prefix
    };
  }

  function contains6(net, words) {
    return wordsEqual(maskIPv6(words, net.prefix), net.network);
  }

  function overlaps6(a, b) {
    var p = Math.min(a.prefix, b.prefix);
    return wordsEqual(maskIPv6(a.network, p), maskIPv6(b.network, p));
  }

  // Highest usable host index in an IPv6 network (index 0 is the subnet-router anycast address)
  function capacity6(prefix) {
    var bits = 128 - prefix;
    return bits >= 40 ? Infinity : Math.pow(2, bits) - 1;
  }

  function isUla(net) {
    return (net.network[0] & 0xfe00) === 0xfc00 && net.prefix >= 7;
  }

  // RFC 4193: fd00::/8 + 40-bit random global ID, subnet 0
  function randomUla(getRandomValues) {
    var b = randomBytes(getRandomValues, 5);
    var words = [0xfd00 | b[0], (b[1] << 8) | b[2], (b[3] << 8) | b[4], 0, 0, 0, 0, 0];
    return formatIPv6(words) + '/64';
  }

  function parseCidrAny(text) {
    return parseCidr4(text) || parseCidr6(text);
  }

  // Bare address or CIDR, IPv4 or IPv6
  function parseNetwork(text) {
    var t = trim(text);
    if (t.indexOf('/') === -1) {
      if (parseIPv4(t) !== null) return parseCidr4(t + '/32');
      if (parseIPv6(t)) return parseCidr6(t + '/128');
      return null;
    }
    return parseCidrAny(t);
  }

  function netOverlaps(a, b) {
    if (a.v !== b.v) return false;
    return a.v === 4 ? overlaps4(a, b) : overlaps6(a, b);
  }

  function netContainsIp(net, ip) {
    if (ip.v !== net.v) return false;
    return net.v === 4 ? contains4(net, ip.value) : contains6(net, ip.value);
  }

  // ── Input parsers ───────────────────────────────────────

  function parsePort(text) {
    var t = trim(text);
    if (!/^\d{1,5}$/.test(t)) return null;
    var n = Number(t);
    return n >= 1 && n <= 65535 ? n : null;
  }

  function isHostname(name) {
    var n = name.replace(/\.$/, '');
    if (!n || n.length > 253) return false;
    var labels = n.split('.');
    for (var i = 0; i < labels.length; i++) {
      if (!LABEL_RE.test(labels[i])) return false;
    }
    return !/^\d+$/.test(labels[labels.length - 1]);
  }

  function parseEndpoint(text, defaultPort) {
    var s = trim(text);
    if (!s) return { error: 'Enter the public endpoint: the IP address or DNS name clients connect to.' };
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      return { error: 'Enter just the host name or IP address of the endpoint, without "' + s.split('//')[0] + '//".' };
    }
    var host;
    var kind;
    var portText = '';
    var m;
    var bracketed = false;
    if (s.charAt(0) === '[') {
      m = /^\[([^\]]+)\](?::(\d*))?$/.exec(s);
      if (!m || !parseIPv6(m[1])) return { error: 'Endpoint "' + s + '" is not a valid bracketed IPv6 address such as [2001:db8::1]:51820.' };
      host = formatIPv6(parseIPv6(m[1]));
      kind = 'ipv6';
      portText = m[2] === undefined ? '' : m[2];
      bracketed = true;
      if (m[2] === '') return { error: 'Endpoint "' + s + '" ends with ":" but has no port number.' };
    } else if ((s.match(/:/g) || []).length > 1) {
      if (!parseIPv6(s)) return { error: 'Endpoint "' + s + '" is not a valid IPv6 address. With a port, write it as [2001:db8::1]:51820.' };
      host = formatIPv6(parseIPv6(s));
      kind = 'ipv6';
    } else {
      m = /^([^:]+)(?::(\d*))?$/.exec(s);
      if (!m) return { error: 'Endpoint "' + s + '" is not a host name or IP address.' };
      host = m[1];
      if (m[2] === '') return { error: 'Endpoint "' + s + '" ends with ":" but has no port number.' };
      portText = m[2] || '';
      if (parseIPv4(host) !== null) {
        kind = 'ipv4';
      } else if (/^[\d.]+$/.test(host)) {
        return { error: 'Endpoint "' + host + '" is not a valid IPv4 address.' };
      } else if (isHostname(host)) {
        kind = 'name';
        host = host.toLowerCase();
      } else {
        return { error: 'Endpoint "' + host + '" is not a valid host name. Use letters, digits, hyphens and dots (internationalised names in their xn-- form).' };
      }
    }
    var port = defaultPort;
    if (portText) {
      port = parsePort(portText);
      if (port === null) return { error: 'Endpoint port "' + portText + '" must be a number from 1 to 65535.' };
    }
    return {
      host: host,
      kind: kind,
      port: port,
      portGiven: !!portText,
      bracketed: bracketed,
      text: (kind === 'ipv6' ? '[' + host + ']' : host) + ':' + port
    };
  }

  function parseDns(text) {
    var out = { servers: [], domains: [], errors: [] };
    splitList(text).forEach(function (t) {
      var v4 = parseIPv4(t);
      if (v4 !== null) { out.servers.push({ v: 4, text: t, value: v4 }); return; }
      var v6 = parseIPv6(t);
      if (v6) { out.servers.push({ v: 6, text: formatIPv6(v6), value: v6 }); return; }
      if (/^[\d.]+$/.test(t) || !isHostname(t)) { out.errors.push(t); return; }
      out.domains.push(t.toLowerCase());
    });
    return out;
  }

  // Peer label used in comments, file names and messages
  function cleanName(name) {
    return trim(stripControl(name)).slice(0, MAX_NAME);
  }

  // File name the Android app and wg-quick accept as a tunnel/interface name
  function confBaseName(name, index) {
    var base = str(name).replace(/[^a-zA-Z0-9_=+.-]+/g, '-').replace(/-{2,}/g, '-')
      .replace(/^[-.]+/, '').slice(0, 15).replace(/[-.]+$/, '');
    return base || 'peer' + (index + 1);
  }

  function uniqueConfNames(names) {
    var used = {};
    return names.map(function (n, i) {
      var base = confBaseName(n, i);
      var cand = base;
      var k = 2;
      while (used[cand.toLowerCase()]) {
        var suffix = '-' + k++;
        cand = base.slice(0, 15 - suffix.length) + suffix;
      }
      used[cand.toLowerCase()] = true;
      return cand + '.conf';
    });
  }

  // ── State ───────────────────────────────────────────────

  var nextPeerId = 1;

  function newPeer(name, keyMode, pub) {
    return { id: nextPeerId++, name: str(name), keyMode: keyMode === 'paste' ? 'paste' : 'generate', pub: str(pub) };
  }

  function defaultState() {
    var s = defaultSettings();
    s.peers = [newPeer('phone'), newPeer('laptop')];
    return s;
  }

  function defaultSettings() {
    return {
      iface: DEFAULT_IFACE,
      endpoint: EXAMPLE_ENDPOINT,
      listenPort: String(DEFAULT_PORT),
      serverKeyMode: 'generate',
      serverPub: '',
      pool4: '10.8.0.0/24',
      serverIp4: '',
      firstPeer4: '',
      v6: false,
      pool6: '',
      mode: 'full',
      splitNets: '192.168.1.0/24',
      blockV6: true,
      dns: '',
      keepalive: 'off',
      keepaliveCustom: '',
      mtu: '',
      psk: true,
      nat: false,
      natIface: 'eth0'
    };
  }

  function normalizeState(raw) {
    var d = defaultSettings();
    raw = raw || {};
    var s = {};
    Object.keys(d).forEach(function (k) {
      if (typeof d[k] === 'boolean') s[k] = raw[k] === undefined ? d[k] : !!raw[k];
      else s[k] = raw[k] === undefined || raw[k] === null ? d[k] : str(raw[k]);
    });
    if (s.serverKeyMode !== 'paste') s.serverKeyMode = 'generate';
    if (s.mode !== 'split') s.mode = 'full';
    if (['off', '25', 'custom'].indexOf(s.keepalive) === -1) s.keepalive = 'off';
    var peers = Array.isArray(raw.peers) ? raw.peers : [newPeer('phone'), newPeer('laptop')];
    s.peers = peers.slice(0, MAX_PEERS).map(function (p) {
      p = p || {};
      return {
        id: typeof p.id === 'number' ? p.id : nextPeerId++,
        name: str(p.name),
        keyMode: p.keyMode === 'paste' ? 'paste' : 'generate',
        pub: str(p.pub)
      };
    });
    return s;
  }

  // Short URL hash keys. Only non-secret values: no private or preshared key ever goes here.
  var HASH_KEYS = {
    iface: 'if', endpoint: 'ep', listenPort: 'lp', serverKeyMode: 'sk', serverPub: 'spub',
    pool4: 'p4', serverIp4: 's4', firstPeer4: 'f4', v6: 'v6', pool6: 'p6', mode: 'm',
    splitNets: 'nets', blockV6: 'b6', dns: 'dns', keepalive: 'ka', keepaliveCustom: 'kac',
    mtu: 'mtu', psk: 'psk', nat: 'nat', natIface: 'ni'
  };

  function encodeState(state) {
    var s = normalizeState(state);
    var parts = [];
    Object.keys(HASH_KEYS).forEach(function (k) {
      if (k === 'serverPub' && s.serverKeyMode !== 'paste') return;
      var v = s[k];
      if (typeof v === 'boolean') v = v ? '1' : '0';
      parts.push(HASH_KEYS[k] + '=' + encodeURIComponent(trim(v)));
    });
    var peers = s.peers.map(function (p) {
      return p.keyMode === 'paste' ? [p.name, trim(p.pub)] : [p.name];
    });
    parts.push('peers=' + encodeURIComponent(JSON.stringify(peers)));
    return '#' + parts.join('&');
  }

  function decodeState(hash) {
    var h = str(hash).replace(/^#/, '');
    if (!h) return null;
    var map = {};
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i <= 0) return;
      try { map[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) { /* ignore broken pairs */ }
    });
    var raw = {};
    var found = false;
    var d = defaultSettings();
    Object.keys(HASH_KEYS).forEach(function (k) {
      var hk = HASH_KEYS[k];
      if (!Object.prototype.hasOwnProperty.call(map, hk)) return;
      found = true;
      var v = map[hk].slice(0, 2000);
      raw[k] = typeof d[k] === 'boolean' ? v === '1' : v;
    });
    if (Object.prototype.hasOwnProperty.call(map, 'peers')) {
      try {
        var arr = JSON.parse(map.peers);
        if (Array.isArray(arr)) {
          found = true;
          raw.peers = arr.slice(0, MAX_PEERS).map(function (p) {
            p = Array.isArray(p) ? p : [p];
            var pub = trim(p[1]);
            return { name: str(p[0]).slice(0, MAX_NAME), keyMode: pub ? 'paste' : 'generate', pub: pub.slice(0, 60) };
          });
        }
      } catch (e) { /* keep default peers */ }
    }
    return found ? normalizeState(raw) : null;
  }

  // ── Model: validate and build every config ──────────────

  function line(key, value) {
    return key + ' = ' + value;
  }

  function maskSecrets(text) {
    return str(text).replace(/^(PrivateKey|PresharedKey) = (.+)$/gm, function (all, key, value) {
      return value === SERVER_KEY_PLACEHOLDER ? all : key + ' = ' + MASK;
    });
  }

  function natLines(o) {
    var up = [];
    var down = [];
    var add = function (cmd) {
      up.push(line('PostUp', cmd.replace(' -X ', ' -A ')));
      down.push(line('PostDown', cmd.replace(' -X ', ' -D ')));
    };
    add('iptables -X FORWARD -i %i -j ACCEPT');
    add('iptables -X FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT');
    add('iptables -t nat -X POSTROUTING -s ' + o.pool4 + ' -o ' + o.nic + ' -j MASQUERADE');
    if (o.pool6) {
      add('ip6tables -X FORWARD -i %i -j ACCEPT');
      add('ip6tables -X FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT');
      if (o.ula) add('ip6tables -t nat -X POSTROUTING -s ' + o.pool6 + ' -o ' + o.nic + ' -j MASQUERADE');
    }
    return ['# Example NAT rules (iptables): check that ' + o.nic + ' is the outgoing interface'].concat(up, down);
  }

  function setupSteps(o) {
    var steps = [];
    steps.push({
      title: 'Install WireGuard',
      text: 'Debian and Ubuntu (other systems: wireguard.com/install, e.g. `sudo dnf install wireguard-tools` on Fedora):',
      cmd: 'sudo apt install wireguard'
    });
    steps.push({
      title: 'Save the server config',
      text: 'Paste the server config into this file' + (o.placeholder ? ' and replace the private key placeholder' : '') +
        ', then make it readable by root only (wg-quick warns when other users can read it):',
      cmd: 'sudo nano /etc/wireguard/' + o.iface + '.conf\nsudo chmod 600 /etc/wireguard/' + o.iface + '.conf'
    });
    var fwd = ["echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-wireguard.conf"];
    if (o.v6) fwd.push("echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-wireguard.conf");
    fwd.push('sudo sysctl --system');
    steps.push({
      title: 'Turn on IP forwarding',
      text: 'Needed for anything beyond the server itself: ' + (o.full ? 'internet access through the tunnel, ' : '') +
        'your LAN, or clients reaching each other.' + (o.nat ? '' : ' Traffic from clients to other networks also needs NAT on the server (the Server extras example) or a route back to the tunnel network on your router.') +
        (o.v6 ? ' With IPv6 forwarding on, Linux stops accepting router advertisements; if the server gets its own IPv6 address that way, also set `net.ipv6.conf.' + o.nic + '.accept_ra = 2` (kernel ip-sysctl docs).' : ''),
      cmd: fwd.join('\n')
    });
    steps.push({
      title: 'Start it now and at every boot',
      text: 'The second command lists each peer; a "latest handshake" line appears once that client has connected.',
      cmd: 'sudo systemctl enable --now wg-quick@' + o.iface + '\nsudo wg show ' + o.iface
    });
    var router = 'Forward UDP port ' + o.publicPort + ' on your router to this server\'s LAN address' +
      (o.publicPort !== o.listenPort ? ', port ' + o.listenPort : '') + '.';
    if (o.endpointKind === 'name') router += ' Point ' + o.endpointHost + ' at your public IP address, with dynamic DNS if that address changes.';
    steps.push({ title: 'Open the port', text: router, cmd: '' });
    steps.push({
      title: 'Add or change peers later',
      text: 'Edit the file, then apply it without disconnecting the other clients (the unit runs `wg syncconf` with `wg-quick strip`):',
      cmd: 'sudo systemctl reload wg-quick@' + o.iface
    });
    return steps;
  }

  // state: inputs (non-secret); keys: { server: {priv, pub}, peers: { <id>: {priv, pub, psk} } }
  function build(state, keys) {
    var s = normalizeState(state);
    keys = keys || {};
    var keyPeers = keys.peers || {};
    var msgs = [];
    var add = function (level, text, field) { msgs.push({ level: level, text: text, field: field || '' }); };
    var model = { messages: msgs, ok: false, pending: false, server: null, peers: [], steps: [], files: [] };

    // Interface name and port
    var iface = trim(s.iface) || DEFAULT_IFACE;
    if (!IFACE_RE.test(iface)) {
      add('error', 'Interface name "' + iface + '" must be 1–15 characters from A–Z, a–z, 0–9 and _ = + . - (wg-quick turns the file name into the interface name).', 'iface');
    }
    var listenPort = trim(s.listenPort) ? parsePort(s.listenPort) : DEFAULT_PORT;
    if (listenPort === null) add('error', 'Listen port must be a whole number from 1 to 65535.', 'port');

    // Endpoint
    var ep = parseEndpoint(s.endpoint, listenPort || DEFAULT_PORT);
    if (ep.error) {
      add('error', ep.error, 'endpoint');
    } else {
      if (ep.host === EXAMPLE_ENDPOINT) {
        add('warn', 'Replace the example endpoint `' + EXAMPLE_ENDPOINT + '` with your server\'s public IP address or DNS name.', 'endpoint');
      }
      if (ep.kind === 'ipv4') {
        var epNet = parseCidr4(ep.host + '/32');
        if (isPrivate4(epNet)) {
          add('warn', 'Endpoint ' + ep.host + ' is a private address, so only clients inside that network can reach it. Roaming clients need the public IP address or a DNS name.', 'endpoint');
        } else if (isCgnat4(epNet)) {
          add('warn', 'Endpoint ' + ep.host + ' is in 100.64.0.0/10, the carrier-grade NAT range (RFC 6598). It is not reachable from the internet; check your public IP address.', 'endpoint');
        }
      }
      if (listenPort && ep.port !== listenPort) {
        add('info', 'Clients connect to UDP port ' + ep.port + '. Forward it on your router to port ' + listenPort + ' on the server.', 'endpoint');
      }
    }

    // Server key
    var serverPub = null;
    var serverPriv = null;
    if (s.serverKeyMode === 'paste') {
      var spk = parseKey(s.serverPub);
      if (!spk.ok) add('error', 'Server public key ' + spk.error + '.', 'server-pub');
      else serverPub = spk.key;
    } else if (keys.server && keys.server.priv && keys.server.pub) {
      serverPriv = keys.server.priv;
      serverPub = keys.server.pub;
    } else {
      model.pending = true;
    }

    // IPv4 tunnel network
    var peerCount = s.peers.length;
    var pool4 = null;
    var server4 = null;
    var peer4 = [];
    if (!trim(s.pool4)) {
      add('error', 'Enter the tunnel\'s IPv4 network, for example 10.8.0.0/24.', 'pool4');
    } else {
      pool4 = parseCidr4(s.pool4);
      if (!pool4) {
        add('error', 'IPv4 network "' + trim(s.pool4) + '" is not valid. Write it as an address and prefix length, for example 10.8.0.0/24.', 'pool4');
      } else if (pool4.prefix > 30) {
        add('error', 'A /' + pool4.prefix + ' has no room for a server and peers. Use a /30 (server and one peer) or larger, for example /24.', 'pool4');
        pool4 = null;
      }
    }
    if (pool4) {
      if (pool4.hostBits) add('info', 'Using ' + pool4.text + ', the network that ' + trim(s.pool4) + ' belongs to.', 'pool4');
      if (isCgnat4(pool4)) {
        add('warn', pool4.text + ' is in 100.64.0.0/10, reserved for carrier-grade NAT (RFC 6598). It can clash with the addresses a mobile carrier gives your clients.', 'pool4');
      } else if (!isPrivate4(pool4)) {
        add('warn', pool4.text + ' is not a private range (RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). Clients route it into the tunnel, so the real hosts with these addresses become unreachable for them.', 'pool4');
      }
      var first = pool4.network + 1;
      var last = pool4.last - 1;
      var checkHost = function (text, what, field) {
        var ip = parseIPv4(text);
        if (ip === null) { add('error', what + ' "' + trim(text) + '" is not a valid IPv4 address.', field); return null; }
        if (!contains4(pool4, ip)) { add('error', what + ' ' + formatIPv4(ip) + ' is outside ' + pool4.text + '.', field); return null; }
        if (ip === pool4.network) { add('error', what + ' ' + formatIPv4(ip) + ' is the network address of ' + pool4.text + '; use ' + formatIPv4(first) + ' to ' + formatIPv4(last) + '.', field); return null; }
        if (ip === pool4.last) { add('error', what + ' ' + formatIPv4(ip) + ' is the broadcast address of ' + pool4.text + '; use ' + formatIPv4(first) + ' to ' + formatIPv4(last) + '.', field); return null; }
        return ip;
      };
      server4 = trim(s.serverIp4) ? checkHost(s.serverIp4, 'Server address', 'server-ip4') : first;
      var start = trim(s.firstPeer4) ? checkHost(s.firstPeer4, 'First peer address', 'first-peer4') : first;
      if (server4 !== null && start !== null) {
        for (var a = start; peer4.length < peerCount && a <= last; a++) {
          if (a !== server4) peer4.push(a);
        }
        if (peer4.length < peerCount) {
          var free = last - start + 1 - (server4 >= start && server4 <= last ? 1 : 0);
          var need = peerCount + 1;
          var p = 30;
          while (p > 0 && Math.pow(2, 32 - p) - 2 < need) p--;
          add('error', pool4.text + ' has room for ' + Math.max(free, 0) + ' peer' + (free === 1 ? '' : 's') + ' from ' + formatIPv4(start) +
            ' (the server keeps ' + formatIPv4(server4) + ', network and broadcast addresses are skipped), but there are ' + peerCount +
            '. Use a /' + p + ' or larger, or an earlier first peer address.', 'pool4');
          peer4 = [];
          server4 = null;
        }
      }
    }

    // IPv6 tunnel network (optional)
    var pool6 = null;
    if (s.v6) {
      pool6 = parseCidr6(s.pool6);
      if (!trim(s.pool6)) {
        add('error', 'Enter the tunnel\'s IPv6 network, for example a random ULA prefix such as fd12:3456:789a::/64, or turn IPv6 off.', 'pool6');
      } else if (!pool6) {
        add('error', 'IPv6 network "' + trim(s.pool6) + '" is not valid. Write it as an address and prefix length, for example fd12:3456:789a::/64.', 'pool6');
      } else if (pool6.prefix > 124 || pool6.prefix < 8) {
        add('error', 'Use an IPv6 network between /8 and /124; /64 is the usual size.', 'pool6');
        pool6 = null;
      } else {
        if (pool6.hostBits) add('info', 'Using ' + pool6.text + ', the network that ' + trim(s.pool6) + ' belongs to.', 'pool6');
        if (pool4 && server4 !== null) {
          var maxIndex = server4 - pool4.network;
          peer4.forEach(function (ip) { maxIndex = Math.max(maxIndex, ip - pool4.network); });
          if (maxIndex > capacity6(pool6.prefix)) {
            add('error', pool6.text + ' is too small: each peer gets the same host number as in IPv4, up to ' + maxIndex + ' here. Use a /64.', 'pool6');
            pool6 = null;
          }
        }
      }
    }
    var addr6 = function (ip4) {
      return formatIPv6(addIPv6(pool6.network, ip4 - pool4.network));
    };

    // Routing (AllowedIPs on the clients)
    var clientAllowed = [];
    var routed = [];
    if (s.mode === 'full') {
      clientAllowed.push('0.0.0.0/0');
      routed.push(parseCidr4('0.0.0.0/0'));
      if (s.v6 || s.blockV6) {
        clientAllowed.push('::/0');
        routed.push(parseCidr6('::/0'));
      }
    } else {
      if (pool4) { clientAllowed.push(pool4.text); routed.push(pool4); }
      if (pool6) { clientAllowed.push(pool6.text); routed.push(pool6); }
      splitList(s.splitNets).forEach(function (t) {
        var net = parseNetwork(t);
        if (!net) {
          add('error', 'Network "' + t + '" is not an IPv4 or IPv6 network such as 192.168.1.0/24.', 'nets');
          return;
        }
        if (net.hostBits) add('info', 'Using ' + net.text + ' for ' + t + '.', 'nets');
        if (net.prefix === 0) {
          add('warn', net.text + ' sends all ' + (net.v === 4 ? 'IPv4' : 'IPv6') + ' traffic into the tunnel: choose "Everything (full tunnel)" instead.', 'nets');
        }
        if (net.v === 6 && !s.v6) {
          add('warn', net.text + ' is IPv6, but the tunnel has no IPv6 addresses, so the server drops that traffic. Turn on "Add IPv6 addresses".', 'nets');
        }
        var poolOfSameFamily = net.v === 4 ? pool4 : pool6;
        if (poolOfSameFamily && net.text !== poolOfSameFamily.text && netOverlaps(net, poolOfSameFamily)) {
          add('warn', net.text + ' overlaps the tunnel network ' + poolOfSameFamily.text + '. Pick a tunnel range that doesn\'t clash with the networks behind the server.', 'nets');
        }
        if (clientAllowed.indexOf(net.text) === -1) {
          clientAllowed.push(net.text);
          routed.push(net);
        }
      });
      if (clientAllowed.length <= (pool6 ? 2 : 1)) {
        add('info', 'Split tunnel without extra networks: clients reach only the server and each other through the tunnel.', 'nets');
      }
    }

    // DNS
    var dns = parseDns(s.dns);
    dns.errors.forEach(function (t) {
      add('error', 'DNS entry "' + t + '" is neither an IP address nor a valid domain name.', 'dns');
    });
    var dnsValues = dns.servers.map(function (d) { return d.text; }).concat(dns.domains);
    if (!dns.errors.length) {
      if (s.mode === 'full' && !dns.servers.length) {
        add('info', 'No DNS servers set, so each client keeps using the DNS server of the network it joins. For a full tunnel you usually want one here, so lookups go to a resolver you choose.', 'dns');
      }
      dns.servers.forEach(function (d) {
        var inTunnel = routed.some(function (net) { return netContainsIp(net, d); });
        if (d.v === 6 && !s.v6 && inTunnel) {
          add('warn', 'DNS server ' + d.text + ' is IPv6, but IPv6 goes into a tunnel that has no IPv6 addresses, so clients can\'t reach it. Turn on IPv6 or use an IPv4 resolver.', 'dns');
        }
        if (d.v === 4 && server4 !== null && d.value === server4) {
          add('info', 'Clients ask ' + d.text + ' (the server\'s tunnel address) for DNS: make sure a resolver on the server answers on that address.', 'dns');
        } else if (s.mode === 'split' && d.v === 4 && isPrivate4(parseCidr4(d.text + '/32')) && !inTunnel) {
          add('warn', 'DNS server ' + d.text + ' is not inside the tunnel\'s AllowedIPs, so clients look for it on their local network instead. Add its network to "Networks behind the server".', 'dns');
        }
      });
    }

    // Keepalive and MTU
    var keepalive = null;
    if (s.keepalive === '25') keepalive = 25;
    else if (s.keepalive === 'custom') {
      var ka = trim(s.keepaliveCustom);
      keepalive = /^\d{1,5}$/.test(ka) ? Number(ka) : null;
      if (keepalive === null || keepalive < 1 || keepalive > 65535) {
        add('error', 'Keepalive must be a whole number of seconds from 1 to 65535 (wg(8)), or choose Off.', 'keepalive');
        keepalive = null;
      }
    }
    var mtu = null;
    if (trim(s.mtu)) {
      var mt = trim(s.mtu);
      mtu = /^\d{1,5}$/.test(mt) ? Number(mt) : null;
      if (mtu === null || mtu < 68 || mtu > 65535) {
        add('error', 'MTU must be a whole number from 68 to 65535, or empty for automatic.', 'mtu');
        mtu = null;
      } else if (s.v6 && mtu < 1280) {
        add('warn', 'IPv6 needs an MTU of at least 1280 (RFC 8200); below that, IPv6 on the tunnel stops working.', 'mtu');
      } else if (mtu > 1420) {
        add('info', 'MTU ' + mtu + ' is above 1420, the value wg-quick picks on a normal 1500-byte link (1500 minus 80 bytes of WireGuard overhead). Packets may get fragmented or dropped.', 'mtu');
      }
    }

    // NAT example
    var nic = trim(s.natIface) || 'eth0';
    if (s.nat && !NIC_RE.test(nic)) {
      add('error', 'Outgoing interface "' + nic + '" must be 1–15 characters from A–Z, a–z, 0–9, dot, _ and -.', 'nat-iface');
    }
    if (s.mode === 'full' && !s.nat) {
      add('info', 'Full tunnel: the server has to forward and masquerade client traffic. Turn on the NAT example under Server extras or set it up in your firewall, and enable IP forwarding (Server setup steps).', 'nat');
    }

    // Peers
    if (!peerCount) add('warn', 'Add at least one peer: the server config has no [Peer] block yet.', 'peers');
    var names = s.peers.map(function (p, i) { return cleanName(p.name) || 'peer' + (i + 1); });
    var files = uniqueConfNames(names);
    var seen = {};
    if (serverPub) seen[serverPub] = 'the server';
    s.peers.forEach(function (p, i) {
      var entry = {
        id: p.id, index: i, name: names[i], file: files[i], paste: p.keyMode === 'paste',
        pub: null, priv: null, psk: null
      };
      var k = keyPeers[p.id] || {};
      if (entry.paste) {
        var pk = parseKey(p.pub);
        if (!pk.ok) add('error', 'Peer "' + entry.name + '": public key ' + pk.error + '.', 'peer-' + p.id);
        else entry.pub = pk.key;
      } else if (k.priv && k.pub) {
        entry.priv = k.priv;
        entry.pub = k.pub;
      } else {
        model.pending = true;
      }
      if (s.psk) {
        if (k.psk) entry.psk = k.psk;
        else model.pending = true;
      }
      if (entry.pub) {
        if (seen[entry.pub]) add('error', 'Peer "' + entry.name + '" has the same public key as ' + seen[entry.pub] + '. Every peer needs its own key pair.', 'peer-' + p.id);
        else seen[entry.pub] = 'peer "' + entry.name + '"';
      }
      model.peers.push(entry);
    });

    model.ok = !msgs.some(function (m) { return m.level === 'error'; });
    if (!model.ok || model.pending) return model;

    // ── Texts ──
    var serverAddrs = [formatIPv4(server4) + '/' + pool4.prefix];
    if (pool6) serverAddrs.push(addr6(server4) + '/' + pool6.prefix);

    var peerBlocks = [];
    model.peers.forEach(function (entry, i) {
      entry.address4 = formatIPv4(peer4[i]);
      entry.address6 = pool6 ? addr6(peer4[i]) : '';
      entry.addresses = [entry.address4 + '/32'].concat(pool6 ? [entry.address6 + '/128'] : []);
      entry.serverAllowed = entry.addresses.slice();

      var block = ['[Peer]', '# ' + entry.name, line('PublicKey', entry.pub)];
      if (entry.psk) block.push(line('PresharedKey', entry.psk));
      block.push(line('AllowedIPs', entry.serverAllowed.join(', ')));
      peerBlocks.push(block.join('\n'));

      var c = ['[Interface]'];
      c.push(entry.priv ? line('PrivateKey', entry.priv) : '# PrivateKey = (this device keeps its own private key: add it here)');
      c.push(line('Address', entry.addresses.join(', ')));
      if (dnsValues.length) c.push(line('DNS', dnsValues.join(', ')));
      if (mtu) c.push(line('MTU', mtu));
      c.push('', '[Peer]', line('PublicKey', serverPub));
      if (entry.psk) c.push(line('PresharedKey', entry.psk));
      c.push(line('AllowedIPs', clientAllowed.join(', ')));
      c.push(line('Endpoint', ep.text));
      if (keepalive) c.push(line('PersistentKeepalive', keepalive));
      entry.text = c.join('\n') + '\n';
      entry.display = maskSecrets(entry.text);
      entry.qr = entry.priv ? qrPlan(entry.text) : null;
    });

    var srv = ['[Interface]', line('Address', serverAddrs.join(', ')), line('ListenPort', listenPort),
      line('PrivateKey', serverPriv || SERVER_KEY_PLACEHOLDER)];
    if (mtu) srv.push(line('MTU', mtu));
    if (s.nat) {
      srv = srv.concat(natLines({ pool4: pool4.text, pool6: pool6 ? pool6.text : '', ula: pool6 ? isUla(pool6) : false, nic: nic }));
    }
    var serverText = srv.join('\n') + '\n' + (peerBlocks.length ? '\n' + peerBlocks.join('\n\n') + '\n' : '');
    var fileName = iface + '.conf';
    model.server = {
      iface: iface,
      file: fileName,
      path: '/etc/wireguard/' + fileName,
      pub: serverPub,
      placeholder: !serverPriv,
      address4: formatIPv4(server4),
      address6: pool6 ? addr6(server4) : '',
      addresses: serverAddrs,
      text: serverText,
      display: maskSecrets(serverText),
      peersText: peerBlocks.length ? peerBlocks.join('\n\n') + '\n' : '',
      peersDisplay: maskSecrets(peerBlocks.join('\n\n'))
    };
    if (pool6 && s.nat && !isUla(pool6)) {
      add('info', pool6.text + ' is not a ULA prefix, so the NAT example skips IPv6 masquerading. Route that prefix to the server instead.', 'nat');
    }
    model.clientAllowed = clientAllowed;
    model.endpoint = ep;
    model.steps = setupSteps({
      iface: iface, placeholder: !serverPriv, v6: !!pool6, full: s.mode === 'full', nat: s.nat, nic: nic,
      publicPort: ep.port, listenPort: listenPort, endpointKind: ep.kind, endpointHost: ep.host
    });
    model.files = [{ name: 'server/' + fileName, text: serverText }].concat(model.peers.map(function (e) {
      return { name: 'clients/' + e.file, text: e.text };
    }));
    return model;
  }

  // ── QR code ─────────────────────────────────────────────

  function qrPlan(text) {
    var bytes = utf8Bytes(text).length;
    if (bytes <= QR_MAX_BYTES.M) return { ecl: 'M', bytes: bytes };
    if (bytes <= QR_MAX_BYTES.L) return { ecl: 'L', bytes: bytes };
    return { ecl: null, bytes: bytes };
  }

  function makeMatrix(lib, text, ecl) {
    var saved = lib.stringToBytes;
    if (lib.stringToBytesFuncs && lib.stringToBytesFuncs['default']) {
      lib.stringToBytes = lib.stringToBytesFuncs['default'];
    }
    var qr;
    try {
      qr = lib(0, ecl);
      qr.addData(utf8ByteString(text), 'Byte');
      qr.make();
    } finally {
      lib.stringToBytes = saved;
    }
    var count = qr.getModuleCount();
    var modules = [];
    for (var r = 0; r < count; r++) {
      var row = [];
      for (var c = 0; c < count; c++) row.push(qr.isDark(r, c));
      modules.push(row);
    }
    return { count: count, modules: modules, version: (count - 17) / 4 };
  }

  function qrSvg(matrix, quiet) {
    var size = matrix.count + quiet * 2;
    var d = '';
    for (var r = 0; r < matrix.count; r++) {
      var c = 0;
      while (c < matrix.count) {
        if (!matrix.modules[r][c]) { c++; continue; }
        var start = c;
        while (c < matrix.count && matrix.modules[r][c]) c++;
        d += 'M' + (start + quiet) + ' ' + (r + quiet) + 'h' + (c - start) + 'v1h' + (start - c) + 'z';
      }
    }
    return '<svg class="wgc-qr-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code with the WireGuard config">' +
      '<rect width="' + size + '" height="' + size + '" fill="#ffffff"/><path d="' + d + '" fill="#000000"/></svg>';
  }

  // ── ZIP (stored, no compression) ────────────────────────

  var crcTable = null;

  function crc32(bytes) {
    if (!crcTable) {
      crcTable = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable.push(c >>> 0);
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // files: [{ name, text }]. Entries are marked as Unix files with mode 0600.
  function makeZip(files, date) {
    date = date || new Date();
    var year = Math.max(1980, date.getFullYear());
    var dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    var dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    var parts = [];
    var central = [];
    var offset = 0;
    files.forEach(function (f) {
      var name = utf8Bytes(f.name);
      var data = utf8Bytes(f.text);
      var crc = crc32(data);
      var local = new Uint8Array(30 + name.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);          // UTF-8 names
      lv.setUint16(8, 0, true);               // stored
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);
      var cen = new Uint8Array(46 + name.length);
      var cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 0x0314, true);          // made by Unix, spec 2.0
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0x81800000, true);     // regular file, mode 0600
      cv.setUint32(42, offset, true);
      cen.set(name, 46);
      parts.push(local, data);
      central.push(cen);
      offset += local.length + data.length;
    });
    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    var all = parts.concat(central, [end]);
    var total = 0;
    all.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  // ── Script loading (CDN, SRI-pinned) ────────────────────

  var scriptPromises = {};

  function loadScript(url, integrity, isReady) {
    if (isReady()) return Promise.resolve();
    if (scriptPromises[url]) return scriptPromises[url];
    scriptPromises[url] = new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = url;
      el.async = true;
      el.integrity = integrity;
      el.crossOrigin = 'anonymous';
      el.referrerPolicy = 'no-referrer';
      el.onload = function () {
        if (isReady()) { resolve(); return; }
        delete scriptPromises[url];
        reject(new Error('loaded but unusable'));
      };
      el.onerror = function () {
        delete scriptPromises[url];
        reject(new Error('could not be loaded'));
      };
      (document.head || document.body).appendChild(el);
    });
    return scriptPromises[url];
  }

  function ensureQrLib() {
    return loadScript(QR_LIB_URL, QR_LIB_SRI, function () {
      return typeof window.qrcode === 'function';
    }).then(function () { return window.qrcode; });
  }

  function ensureNacl() {
    return loadScript(NACL_URL, NACL_SRI, function () {
      return !!(window.nacl && typeof window.nacl.scalarMult === 'function' && typeof window.nacl.scalarMult.base === 'function');
    }).then(function () { return window.nacl; });
  }

  function browserEnv() {
    var c = (typeof window !== 'undefined' && window.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    return {
      subtle: c && c.subtle ? c.subtle : null,
      getRandomValues: c && typeof c.getRandomValues === 'function' ? function (a) { return c.getRandomValues(a); } : null,
      loadNacl: ensureNacl
    };
  }

  // ── UI state ────────────────────────────────────────────

  var state = null;
  var keys = { server: null, peers: {} };
  var model = null;
  var engine = null;
  var engineError = null;
  var env = null;
  var keyQueue = Promise.resolve();
  var qrOpen = {};
  var renderTimer = null;
  var loadedFromLink = false;

  // Fill in every key the current state needs (serialised, so two runs never race)
  function ensureKeys() {
    keyQueue = keyQueue.then(function () {
      if (!env || !env.getRandomValues) return null;
      var jobs = [];
      state.peers.forEach(function (p) {
        var k = keys.peers[p.id];
        if (!k) { k = keys.peers[p.id] = {}; }
        if (!k.psk) k.psk = generatePresharedKey(env.getRandomValues);
      });
      if (!engine) return null;
      if (state.serverKeyMode === 'generate' && !keys.server) {
        jobs.push(generateKeyPair(engine).then(function (kp) { keys.server = kp; }));
      }
      state.peers.forEach(function (p) {
        var k = keys.peers[p.id];
        if (p.keyMode === 'generate' && !k.priv) {
          jobs.push(generateKeyPair(engine).then(function (kp) { k.priv = kp.priv; k.pub = kp.pub; }));
        }
      });
      return Promise.all(jobs);
    }).then(null, function (err) {
      engineError = 'Key generation failed: ' + (err && err.message ? err.message : String(err));
      setEngineStatus('error', engineError);
    });
    return keyQueue;
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { renderTimer = null; render(); }, 120);
  }

  function refresh() {
    ensureKeys().then(render);
    render();
  }

  // ── Inputs ──────────────────────────────────────────────

  var FIELD_IDS = {
    iface: 'wgc-iface', listenPort: 'wgc-port', endpoint: 'wgc-endpoint', serverPub: 'wgc-server-pub',
    pool4: 'wgc-pool4', serverIp4: 'wgc-server-ip4', firstPeer4: 'wgc-first-peer4', pool6: 'wgc-pool6',
    splitNets: 'wgc-nets', dns: 'wgc-dns', keepaliveCustom: 'wgc-keepalive-custom', mtu: 'wgc-mtu',
    natIface: 'wgc-nat-iface', keepalive: 'wgc-keepalive'
  };
  var CHECK_IDS = { v6: 'wgc-v6', blockV6: 'wgc-block6', psk: 'wgc-psk', nat: 'wgc-nat' };

  // Which input to mark when a message names a field
  var FIELD_INPUT = {
    iface: 'wgc-iface', port: 'wgc-port', endpoint: 'wgc-endpoint', 'server-pub': 'wgc-server-pub',
    pool4: 'wgc-pool4', 'server-ip4': 'wgc-server-ip4', 'first-peer4': 'wgc-first-peer4', pool6: 'wgc-pool6',
    nets: 'wgc-nets', dns: 'wgc-dns', keepalive: 'wgc-keepalive-custom', mtu: 'wgc-mtu', 'nat-iface': 'wgc-nat-iface'
  };

  function writeInputs() {
    Object.keys(FIELD_IDS).forEach(function (k) { var el = $(FIELD_IDS[k]); if (el) el.value = state[k]; });
    Object.keys(CHECK_IDS).forEach(function (k) { var el = $(CHECK_IDS[k]); if (el) el.checked = !!state[k]; });
    $('wgc-server-key-gen').checked = state.serverKeyMode !== 'paste';
    $('wgc-server-key-paste').checked = state.serverKeyMode === 'paste';
    $('wgc-mode-full').checked = state.mode !== 'split';
    $('wgc-mode-split').checked = state.mode === 'split';
    if (trim(state.serverIp4) || trim(state.firstPeer4)) $('wgc-addr-more').open = true;
    syncVisibility();
  }

  function readInputs() {
    Object.keys(FIELD_IDS).forEach(function (k) { var el = $(FIELD_IDS[k]); if (el) state[k] = el.value; });
    Object.keys(CHECK_IDS).forEach(function (k) { var el = $(CHECK_IDS[k]); if (el) state[k] = el.checked; });
    state.serverKeyMode = $('wgc-server-key-paste').checked ? 'paste' : 'generate';
    state.mode = $('wgc-mode-split').checked ? 'split' : 'full';
  }

  function toggle(id, show) {
    var el = $(id);
    if (el) el.classList.toggle('wgc-hidden', !show);
  }

  function syncVisibility() {
    toggle('wgc-server-paste', state.serverKeyMode === 'paste');
    toggle('wgc-v6-box', state.v6);
    toggle('wgc-full-box', state.mode !== 'split');
    toggle('wgc-split-box', state.mode === 'split');
    toggle('wgc-keepalive-custom', state.keepalive === 'custom');
    toggle('wgc-nat-box', state.nat);
    var b6 = $('wgc-block6');
    b6.disabled = state.v6;
    if (state.v6) b6.checked = true;
    $('wgc-block6-sub').textContent = state.v6
      ? 'Included because the tunnel has IPv6 addresses.'
      : 'Recommended. The tunnel has no IPv6 addresses, so IPv6 traffic is dropped by the server instead of leaving the device outside the VPN.';
    $('wgc-server-key-hint').innerHTML = state.serverKeyMode === 'paste'
      ? richText('wg0.conf gets a placeholder instead of the private key: put the key from `/etc/wireguard/server.key` in its place, or keep your existing config and add only the [Peer] blocks. The server\'s private key never touches this browser.')
      : richText('Generated in this browser. Safer: create it on the server and paste only the public key, so the server\'s private key never passes through a browser, clipboard or Downloads folder.');
    var count = state.peers.length;
    $('wgc-peer-count').textContent = String(count);
    $('wgc-add-peer').disabled = count >= MAX_PEERS;
  }

  function renderPeerRows() {
    var box = $('wgc-peer-rows');
    if (!state.peers.length) {
      box.innerHTML = '<p class="wgc-empty">No peers yet. Add one for each phone, laptop or router.</p>';
      return;
    }
    box.innerHTML = state.peers.map(function (p, i) {
      var n = i + 1;
      var paste = p.keyMode === 'paste';
      return '<div class="wgc-peer-row" data-id="' + p.id + '">' +
        '<span class="wgc-peer-num" aria-hidden="true">' + n + '</span>' +
        '<input class="wgc-input wgc-peer-name" type="text" data-field="name" value="' + escapeHtml(p.name) +
          '" placeholder="peer' + n + '" maxlength="' + MAX_NAME + '" autocomplete="off" spellcheck="false" aria-label="Peer ' + n + ' name">' +
        '<select class="wgc-input wgc-select wgc-peer-mode" data-field="keyMode" aria-label="Peer ' + n + ' key">' +
          '<option value="generate"' + (paste ? '' : ' selected') + '>Generate key</option>' +
          '<option value="paste"' + (paste ? ' selected' : '') + '>Paste public key</option>' +
        '</select>' +
        '<button class="wgc-icon-btn" type="button" data-action="remove" aria-label="Remove peer ' + n + '" title="Remove peer">×</button>' +
        (paste
          ? '<input class="wgc-input wgc-input--mono wgc-peer-pub" type="text" data-field="pub" value="' + escapeHtml(p.pub) +
            '" placeholder="Public key from the device (44 characters)" maxlength="60" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Peer ' + n + ' public key">'
          : '') +
        '</div>';
    }).join('');
  }

  function peerById(id) {
    for (var i = 0; i < state.peers.length; i++) if (state.peers[i].id === id) return state.peers[i];
    return null;
  }

  function addPeer() {
    if (state.peers.length >= MAX_PEERS) return;
    var p = newPeer('');
    state.peers.push(p);
    renderPeerRows();
    syncVisibility();
    refresh();
    var row = document.querySelector('.wgc-peer-row[data-id="' + p.id + '"] .wgc-peer-name');
    if (row) row.focus();
  }

  function removePeer(id) {
    state.peers = state.peers.filter(function (p) { return p.id !== id; });
    delete keys.peers[id];
    delete qrOpen[id];
    renderPeerRows();
    syncVisibility();
    render();
  }

  // ── Output ──────────────────────────────────────────────

  function setEngineStatus(level, text) {
    var box = $('wgc-engine');
    box.className = 'wgc-engine wgc-engine--' + level;
    $('wgc-engine-text').textContent = text;
  }

  var ICONS = { error: '✕', warn: '!', info: 'i' };

  function renderMessages(list) {
    var box = $('wgc-messages');
    box.innerHTML = list.map(function (m) {
      return '<div class="wgc-msg wgc-msg--' + m.level + '"><span class="wgc-msg-icon" aria-hidden="true">' + ICONS[m.level] +
        '</span><span class="wgc-msg-text">' + richText(m.text) + '</span></div>';
    }).join('');
    var bad = {};
    list.forEach(function (m) {
      if (m.level === 'error' && FIELD_INPUT[m.field]) bad[FIELD_INPUT[m.field]] = true;
      if (m.level === 'error' && m.field.indexOf('peer-') === 0) bad[m.field] = true;
    });
    Object.keys(FIELD_INPUT).forEach(function (f) {
      var el = $(FIELD_INPUT[f]);
      if (el) el.classList.toggle('wgc-input--invalid', !!bad[FIELD_INPUT[f]]);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.wgc-peer-row'), function (row) {
      var pub = row.querySelector('.wgc-peer-pub');
      if (pub) pub.classList.toggle('wgc-input--invalid', !!bad['peer-' + row.getAttribute('data-id')]);
    });
  }

  function peerCardHtml(e, reveal) {
    var chip = escapeHtml(e.address4) + (e.address6 ? ' · ' + escapeHtml(e.address6) : '');
    var html = '<section class="wgc-card wgc-peer-out" data-id="' + e.id + '" aria-label="Peer ' + escapeHtml(e.name) + '">' +
      '<div class="wgc-card-head"><h3 class="wgc-card-title"><span class="wgc-step">' + (e.index + 1) + '</span> ' + escapeHtml(e.name) + '</h3>' +
      '<span class="wgc-chip">' + chip + '</span></div>' +
      '<p class="wgc-file">' + escapeHtml(e.file) + '</p>' +
      '<div class="wgc-keyline"><span class="wgc-keyline-label">Public key</span><code class="wgc-keyline-value">' + escapeHtml(e.pub) +
      '</code><button class="wgc-link-btn" type="button" data-action="copy-pub">Copy</button></div>';
    if (e.paste) {
      html += '<p class="wgc-note">' + richText('This device keeps its own private key, so there is no QR code. In the WireGuard app, open the tunnel you made with Create from scratch and enter the address, DNS servers and one peer with the values below. On Linux, add the `PrivateKey` line to the file.') + '</p>';
    }
    html += '<pre class="wgc-pre">' + escapeHtml(reveal ? e.text : e.display) + '</pre>' +
      '<div class="wgc-actions">' +
      '<button class="wgc-btn wgc-btn--secondary wgc-btn--compact" type="button" data-action="copy">Copy</button>' +
      '<button class="wgc-btn wgc-btn--secondary wgc-btn--compact" type="button" data-action="download">Download .conf</button>';
    if (!e.paste) {
      var open = !!qrOpen[e.id];
      html += '<button class="wgc-btn wgc-btn--compact" type="button" data-action="qr" aria-expanded="' + open + '">' + (open ? 'Hide QR code' : 'Show QR code') + '</button>' +
        '<button class="wgc-link-btn" type="button" data-action="rekey">New keys</button>';
    }
    html += '</div>';
    if (!e.paste) {
      html += '<div class="wgc-qr-box' + (qrOpen[e.id] ? '' : ' wgc-hidden') + '" data-qr-box>' +
        '<div class="wgc-qr" data-qr-img><span class="wgc-qr-wait">Loading the QR library…</span></div>' +
        '<div class="wgc-qr-side">' +
        '<p class="wgc-hint">In the WireGuard app tap <strong>+</strong>, then <strong>Scan from QR code</strong> (Android) or <strong>Create from QR code</strong> (iPhone and iPad). Hide the code once the tunnel is imported: it contains this device\'s private key.</p>' +
        '<p class="wgc-qr-meta" data-qr-meta></p>' +
        '</div></div>';
    }
    return html + '</section>';
  }

  function drawQr(id) {
    var card = document.querySelector('.wgc-peer-out[data-id="' + id + '"]');
    if (!card || !model || !model.ok) return;
    var entry = null;
    model.peers.forEach(function (e) { if (e.id === id) entry = e; });
    if (!entry || !entry.qr) return;
    var img = card.querySelector('[data-qr-img]');
    var meta = card.querySelector('[data-qr-meta]');
    if (!entry.qr.ecl) {
      img.innerHTML = '<span class="wgc-qr-wait">Too long for a QR code</span>';
      meta.textContent = 'This config is ' + entry.qr.bytes + ' bytes; a QR code holds at most ' + QR_MAX_BYTES.L +
        ' (version 40, error correction L). Shorten the AllowedIPs or DNS list, or import the .conf file instead.';
      return;
    }
    var text = entry.text;
    ensureQrLib().then(function (lib) {
      if (!qrOpen[id] || !document.body.contains(img)) return;
      var matrix = makeMatrix(lib, text, entry.qr.ecl);
      img.innerHTML = qrSvg(matrix, 4);
      meta.textContent = entry.qr.bytes + ' bytes · QR version ' + matrix.version + ' · error correction ' + entry.qr.ecl +
        (matrix.version > 25 ? ' · a dense code: show it large and hold the phone steady, or use the .conf file' : '');
    }).then(null, function () {
      img.innerHTML = '<span class="wgc-qr-wait">QR library unavailable</span>';
      meta.textContent = 'The QR library could not be loaded from cdn.jsdelivr.net (offline, blocked, or its checksum did not match). Download the .conf file and import it in the app instead.';
    });
  }

  function render() {
    if (!state) return;
    model = build(state, keys);
    var msgs = model.messages.slice();
    if (loadedFromLink) {
      msgs.unshift({ level: 'info', text: 'Settings came from a link. Check the endpoint and any pasted public keys before you use these configs: a wrong server key or endpoint sends clients somewhere else.', field: '' });
    }
    renderMessages(msgs);

    var blocked = $('wgc-blocked');
    var out = $('wgc-output');
    if (!model.ok || model.pending) {
      out.classList.add('wgc-hidden');
      blocked.classList.remove('wgc-hidden');
      if (!model.ok) blocked.textContent = 'Fix the errors above to see the configs.';
      else if (engineError) blocked.textContent = 'Keys can\'t be generated here. Switch the server and every peer to "Paste public key", or open this page in a current browser.';
      else blocked.textContent = 'Generating keys…';
      return;
    }
    blocked.classList.add('wgc-hidden');
    out.classList.remove('wgc-hidden');

    var reveal = $('wgc-reveal').checked;
    var srv = model.server;
    $('wgc-srv-file').textContent = srv.path;
    $('wgc-srv-chip').textContent = srv.address4 + (srv.address6 ? ' · ' + srv.address6 : '');
    $('wgc-srv-pub').textContent = srv.pub;
    $('wgc-srv-conf').textContent = reveal ? srv.text : srv.display;
    $('wgc-srv-peers').textContent = srv.peersText ? (reveal ? srv.peersText : srv.peersDisplay) : '(no peers yet)';
    $('wgc-srv-placeholder').classList.toggle('wgc-hidden', !srv.placeholder);
    $('wgc-reload-cmd').textContent = 'sudo systemctl reload wg-quick@' + srv.iface;

    $('wgc-setup-steps').innerHTML = model.steps.map(function (st, i) {
      return '<li class="wgc-step-item"><p class="wgc-step-title">' + escapeHtml(st.title) + '</p>' +
        '<p class="wgc-hint">' + richText(st.text) + '</p>' +
        (st.cmd ? '<div class="wgc-cmd"><pre class="wgc-pre wgc-pre--cmd">' + escapeHtml(st.cmd) + '</pre>' +
          '<button class="wgc-link-btn" type="button" data-step="' + i + '">Copy</button></div>' : '') +
        '</li>';
    }).join('');

    $('wgc-peer-outs').innerHTML = model.peers.map(function (e) { return peerCardHtml(e, reveal); }).join('');
    Object.keys(qrOpen).forEach(function (id) { if (qrOpen[id]) drawQr(Number(id)); });
  }

  // ── Copy, download, toast ───────────────────────────────

  function showToast(text, isError) {
    var toast = $('wgc-toast');
    toast.textContent = text;
    toast.classList.toggle('wgc-toast--error', !!isError);
    toast.classList.add('wgc-show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.classList.remove('wgc-show'); }, 2000);
  }

  function copyText(text, okMsg) {
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      showToast(ok ? okMsg : 'Copy failed — select the text and copy it by hand', !ok);
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () { showToast(okMsg); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function downloadBytes(name, data, type) {
    var blob = new Blob([data], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 1500);
  }

  function ready() {
    if (model && model.ok && !model.pending) return true;
    showToast('Nothing to copy yet — fix the errors first', true);
    return false;
  }

  function copy(kind) {
    if (kind === 'genkey') { copyText(GENKEY_CMD, 'Command copied'); return; }
    if (!ready()) return;
    if (kind === 'server') copyText(model.server.text, 'Server config copied');
    else if (kind === 'server-peers') copyText(model.server.peersText, '[Peer] blocks copied');
    else if (kind === 'server-pub') copyText(model.server.pub, 'Server public key copied');
  }

  function download(kind) {
    if (!ready()) return;
    if (kind === 'server') downloadBytes(model.server.file, model.server.text, 'application/octet-stream');
  }

  function downloadZip() {
    if (!ready()) return;
    downloadBytes('wireguard-' + model.server.iface + '.zip', makeZip(model.files), 'application/zip');
    showToast('ZIP with ' + model.files.length + ' configs downloaded');
  }

  function copyLink() {
    readInputs();
    var url = location.href.split('#')[0] + encodeState(state);
    copyText(url, 'Link copied (no keys inside)');
  }

  function regenerateAll() {
    var ok = typeof window.confirm !== 'function' ||
      window.confirm('Create new keys for the server and every peer? Configs you already downloaded or scanned will stop matching.');
    if (!ok) return;
    keys = { server: null, peers: {} };
    refresh();
    showToast('New keys created');
  }

  function rekeyPeer(id) {
    delete keys.peers[id];
    refresh();
    var p = peerById(id);
    showToast('New keys for ' + (p && cleanName(p.name) ? cleanName(p.name) : 'this peer'));
  }

  function randomUlaClick() {
    if (!env || !env.getRandomValues) return;
    $('wgc-pool6').value = randomUla(env.getRandomValues);
    readInputs();
    render();
  }

  function onPeerOutClick(ev) {
    var btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    var card = btn.closest('.wgc-peer-out');
    var id = Number(card.getAttribute('data-id'));
    var entry = null;
    if (model && model.ok) model.peers.forEach(function (e) { if (e.id === id) entry = e; });
    if (!entry) return;
    var action = btn.getAttribute('data-action');
    if (action === 'copy') copyText(entry.text, entry.file + ' copied');
    else if (action === 'copy-pub') copyText(entry.pub, 'Public key copied');
    else if (action === 'download') downloadBytes(entry.file, entry.text, 'application/octet-stream');
    else if (action === 'rekey') rekeyPeer(id);
    else if (action === 'qr') {
      qrOpen[id] = !qrOpen[id];
      var box = card.querySelector('[data-qr-box]');
      box.classList.toggle('wgc-hidden', !qrOpen[id]);
      btn.textContent = qrOpen[id] ? 'Hide QR code' : 'Show QR code';
      btn.setAttribute('aria-expanded', String(qrOpen[id]));
      if (qrOpen[id]) drawQr(id);
      else card.querySelector('[data-qr-img]').innerHTML = '';
    }
  }

  // ── Init ────────────────────────────────────────────────

  function init() {
    var wrapper = $('wgc-wrapper');
    if (!wrapper) return;

    var fromHash = decodeState(location.hash);
    loadedFromLink = !!fromHash;
    state = fromHash || defaultState();
    env = browserEnv();
    $('wgc-genkey-cmd').textContent = GENKEY_CMD;
    writeInputs();
    renderPeerRows();

    var leftCol = wrapper.querySelector('.wgc-col');
    leftCol.addEventListener('input', function (e) {
      if (e.target.closest('#wgc-peer-rows')) return;
      readInputs();
      scheduleRender();
    });
    leftCol.addEventListener('change', function (e) {
      if (e.target.closest('#wgc-peer-rows')) return;
      readInputs();
      if (e.target.id === 'wgc-v6' && state.v6 && !trim(state.pool6) && env.getRandomValues) {
        state.pool6 = randomUla(env.getRandomValues);
        $('wgc-pool6').value = state.pool6;
      }
      syncVisibility();
      refresh();
    });
    leftCol.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        readInputs();
        render();
      }
    });

    var rows = $('wgc-peer-rows');
    rows.addEventListener('input', function (e) {
      var row = e.target.closest('.wgc-peer-row');
      var field = e.target.getAttribute('data-field');
      if (!row || !field || field === 'keyMode') return;
      var p = peerById(Number(row.getAttribute('data-id')));
      if (p) p[field] = e.target.value;
      scheduleRender();
    });
    rows.addEventListener('change', function (e) {
      var row = e.target.closest('.wgc-peer-row');
      if (!row || e.target.getAttribute('data-field') !== 'keyMode') return;
      var p = peerById(Number(row.getAttribute('data-id')));
      if (!p) return;
      p.keyMode = e.target.value === 'paste' ? 'paste' : 'generate';
      renderPeerRows();
      var focus = document.querySelector('.wgc-peer-row[data-id="' + p.id + '"] ' + (p.keyMode === 'paste' ? '.wgc-peer-pub' : '.wgc-peer-mode'));
      if (focus) focus.focus();
      refresh();
    });
    rows.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action="remove"]');
      if (!btn) return;
      removePeer(Number(btn.closest('.wgc-peer-row').getAttribute('data-id')));
    });

    $('wgc-reveal').addEventListener('change', render);
    $('wgc-peer-outs').addEventListener('click', onPeerOutClick);
    $('wgc-setup-steps').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-step]');
      if (!btn || !model || !model.steps) return;
      var st = model.steps[Number(btn.getAttribute('data-step'))];
      if (st) copyText(st.cmd, 'Command copied');
    });

    render();
    if (!env.getRandomValues) {
      engineError = 'This browser has no crypto.getRandomValues, so it cannot create keys safely.';
      setEngineStatus('error', engineError);
      render();
      return;
    }
    ensureKeys().then(render);
    pickEngine(env).then(function (eng) {
      engine = eng;
      setEngineStatus('ok', 'Keys: ' + eng.label + ' · RFC 7748 self-test passed');
      return ensureKeys();
    }, function (err) {
      engineError = 'X25519 keys can\'t be generated in this browser: ' + (err && err.message ? err.message : String(err)) +
        '. You can still paste public keys for the server and every peer.';
      setEngineStatus('error', engineError);
    }).then(render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Global handlers for onclick attributes
  window.wgcAddPeer = addPeer;
  window.wgcCopy = copy;
  window.wgcDownload = download;
  window.wgcDownloadZip = downloadZip;
  window.wgcCopyLink = copyLink;
  window.wgcRegenerateAll = regenerateAll;
  window.wgcRandomUla = randomUlaClick;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      RFC7748: RFC7748,
      QR_MAX_BYTES: QR_MAX_BYTES,
      SERVER_KEY_PLACEHOLDER: SERVER_KEY_PLACEHOLDER,
      MAX_PEERS: MAX_PEERS,
      bytesToBase64: bytesToBase64,
      base64ToBytes: base64ToBytes,
      hexToBytes: hexToBytes,
      bytesToHex: bytesToHex,
      parseKey: parseKey,
      clampPrivateKey: clampPrivateKey,
      isClamped: isClamped,
      generatePresharedKey: generatePresharedKey,
      webCryptoEngine: webCryptoEngine,
      naclEngine: naclEngine,
      selfTest: selfTest,
      pickEngine: pickEngine,
      generateKeyPair: generateKeyPair,
      parseIPv4: parseIPv4,
      formatIPv4: formatIPv4,
      parseCidr4: parseCidr4,
      parseIPv6: parseIPv6,
      formatIPv6: formatIPv6,
      parseCidr6: parseCidr6,
      addIPv6: addIPv6,
      randomUla: randomUla,
      parseNetwork: parseNetwork,
      parseEndpoint: parseEndpoint,
      parseDns: parseDns,
      confBaseName: confBaseName,
      uniqueConfNames: uniqueConfNames,
      defaultState: defaultState,
      normalizeState: normalizeState,
      encodeState: encodeState,
      decodeState: decodeState,
      maskSecrets: maskSecrets,
      build: build,
      qrPlan: qrPlan,
      qrSvg: qrSvg,
      crc32: crc32,
      makeZip: makeZip
    };
  }

})();
