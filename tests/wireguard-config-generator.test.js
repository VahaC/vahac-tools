// tests/wireguard-config-generator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { loadScript } = require('./_setup');

const wgc = loadScript('wireguard-config-generator/script.js');

const subtle = globalThis.crypto.subtle;
const getRandomValues = (a) => globalThis.crypto.getRandomValues(a);
const hex = (h) => Buffer.from(h, 'hex');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

// Independent reference: Node's own X25519 (OpenSSL), fed with the raw private key
const PKCS8_PREFIX = hex('302e020100300506032b656e04220420');
function nodePublicKey(privateBytes) {
  const key = nodeCrypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(privateBytes)]), format: 'der', type: 'pkcs8' });
  return nodeCrypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
}
function nodeShared(privateBytes, publicBytes) {
  const privateKey = nodeCrypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(privateBytes)]), format: 'der', type: 'pkcs8' });
  const publicKey = nodeCrypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(publicBytes).toString('base64url') }, format: 'jwk' });
  return nodeCrypto.diffieHellman({ privateKey, publicKey });
}
const pubOf = (privB64) => nodePublicKey(Buffer.from(privB64, 'base64')).toString('base64');

// wireguard-tools src/encoding.c key_from_base64(), ported literally
function referenceKeyFromBase64(s) {
  const val = (c) => {
    const ch = c.charCodeAt(0);
    if (ch >= 65 && ch <= 90) return ch - 65;
    if (ch >= 97 && ch <= 122) return ch - 71;
    if (ch >= 48 && ch <= 57) return ch + 4;
    if (c === '+') return 62;
    if (c === '/') return 63;
    return -1;
  };
  if (s.length !== 44 || s[43] !== '=') return false;
  for (let i = 0; i < 43; i++) if (val(s[i]) < 0) return false;
  const last = (val(s[40]) << 18) | (val(s[41]) << 12) | (val(s[42]) << 6);
  return (last & 0xff) === 0;
}

const webcrypto = () => wgc.webCryptoEngine(subtle);

// Fallback engine wired to Node's X25519, standing in for TweetNaCl's API shape
function fakeNacl() {
  const scalarMult = (n, p) => {
    assert.ok(n instanceof Uint8Array && n.length === 32);
    return new Uint8Array(nodeShared(n, p));
  };
  scalarMult.base = (n) => new Uint8Array(nodePublicKey(n));
  return { scalarMult };
}

async function makeKeys(state, engine) {
  engine = engine || webcrypto();
  const keys = { server: await wgc.generateKeyPair(engine), peers: {} };
  for (const p of state.peers) {
    keys.peers[p.id] = Object.assign(await wgc.generateKeyPair(engine), { psk: wgc.generatePresharedKey(getRandomValues) });
  }
  return keys;
}

async function buildWith(patch, keys) {
  const state = wgc.normalizeState(Object.assign(wgc.defaultState(), { endpoint: 'vpn.home.example.net' }, patch || {}));
  keys = keys || await makeKeys(state);
  return { state, keys, m: wgc.build(state, keys) };
}

const errors = (m) => m.messages.filter((x) => x.level === 'error').map((x) => x.text).join('\n');
const texts = (m, level) => m.messages.filter((x) => !level || x.level === level).map((x) => x.text).join('\n');
const peers = (...names) => names.map((n) => ({ name: n }));

// Parse a wg-quick style file into sections of [key, value] pairs (comments stripped like wg(8))
function parseConf(text) {
  const sections = [];
  for (const raw of text.split('\n')) {
    const lineText = raw.split('#')[0].trim();
    if (!lineText) continue;
    if (/^\[(Interface|Peer)\]$/.test(lineText)) { sections.push({ name: lineText.slice(1, -1), pairs: [] }); continue; }
    const i = lineText.indexOf('=');
    assert.ok(i > 0 && sections.length, 'unparsable line: ' + raw);
    sections[sections.length - 1].pairs.push([lineText.slice(0, i).trim(), lineText.slice(i + 1).trim()]);
  }
  return sections;
}
const get = (section, key) => (section.pairs.find((p) => p[0] === key) || [])[1];
const all = (section, key) => section.pairs.filter((p) => p[0] === key).map((p) => p[1]);

// Keys the official Android and iOS apps accept (wireguard-android Interface/Peer.java,
// wireguard-apple TunnelConfiguration+WgQuickConfig.swift)
const APP_INTERFACE_KEYS = ['privatekey', 'listenport', 'address', 'dns', 'mtu'];
const APP_PEER_KEYS = ['publickey', 'presharedkey', 'allowedips', 'endpoint', 'persistentkeepalive'];
const APP_MULTI = ['address', 'allowedips', 'dns'];
function assertAppCompatible(text) {
  const sections = parseConf(text);
  assert.equal(sections.filter((s) => s.name === 'Interface').length, 1);
  for (const s of sections) {
    const allowed = s.name === 'Interface' ? APP_INTERFACE_KEYS : APP_PEER_KEYS;
    const seen = new Set();
    for (const [k] of s.pairs) {
      const key = k.toLowerCase();
      assert.ok(allowed.includes(key), 'the mobile apps reject "' + k + '" in [' + s.name + ']');
      assert.ok(!seen.has(key) || APP_MULTI.includes(key), 'the iOS app rejects a repeated "' + k + '"');
      seen.add(key);
    }
  }
}

// ── RFC 7748 and X25519 ──────────────────────────────────

test('wireguard: RFC 7748 section 6.1 vector through the WebCrypto engine', async () => {
  const v = wgc.RFC7748;
  const eng = webcrypto();
  assert.equal(wgc.bytesToHex(await eng.scalarMultBase(hex(v.alicePriv))), v.alicePub);
  assert.equal(wgc.bytesToHex(await eng.scalarMultBase(hex(v.bobPriv))), v.bobPub);
  assert.equal(wgc.bytesToHex(await eng.scalarMult(hex(v.alicePriv), hex(v.bobPub))), v.shared);
  assert.equal(wgc.bytesToHex(await eng.scalarMult(hex(v.bobPriv), hex(v.alicePub))), v.shared);
  assert.equal(await wgc.selfTest(eng), true);
});

test('wireguard: the embedded RFC 7748 vector matches the RFC text and Node', () => {
  const v = wgc.RFC7748;
  assert.deepEqual(v, {
    alicePriv: '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a',
    alicePub: '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
    bobPriv: '5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb',
    bobPub: 'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
    shared: '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742'
  });
  assert.equal(nodePublicKey(hex(v.alicePriv)).toString('hex'), v.alicePub);
  assert.equal(nodeShared(hex(v.alicePriv), hex(v.bobPub)).toString('hex'), v.shared);
});

test('wireguard: RFC 7748 section 5.2 vectors (unclamped scalars, high bit set in u)', async () => {
  const eng = webcrypto();
  const out1 = await eng.scalarMult(hex('a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4'),
    hex('e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c'));
  assert.equal(wgc.bytesToHex(out1), 'c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552');
  const out2 = await eng.scalarMult(hex('4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d'),
    hex('e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493'));
  assert.equal(wgc.bytesToHex(out2), '95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957');
});

test('wireguard: WebCrypto key pairs match Node X25519 and look like wg genkey output', async () => {
  const eng = webcrypto();
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    const kp = await wgc.generateKeyPair(eng);
    for (const k of [kp.priv, kp.pub]) {
      assert.match(k, /^[A-Za-z0-9+/]{43}=$/);
      assert.equal(k.length, 44);
      assert.equal(Buffer.from(k, 'base64').length, 32);
      assert.equal(wgc.parseKey(k).ok, true);
      assert.equal(referenceKeyFromBase64(k), true);
    }
    const priv = Buffer.from(kp.priv, 'base64');
    assert.equal(priv[0] & 7, 0, 'low three bits cleared');
    assert.equal(priv[31] & 128, 0, 'bit 255 cleared');
    assert.equal(priv[31] & 64, 64, 'bit 254 set');
    assert.equal(pubOf(kp.priv), kp.pub, 'public key derived by Node from the same private key');
    assert.ok(!seen.has(kp.priv));
    seen.add(kp.priv);
  }
});

test('wireguard: clamping works like curve25519_clamp_secret and never changes the public key', () => {
  const ones = wgc.clampPrivateKey(new Uint8Array(32).fill(0xff));
  assert.equal(ones[0], 0xf8);
  assert.equal(ones[31], 0x7f);
  assert.deepEqual([...ones.subarray(1, 31)], new Array(30).fill(0xff));
  const zeros = wgc.clampPrivateKey(new Uint8Array(32));
  assert.equal(zeros[0], 0);
  assert.equal(zeros[31], 0x40);
  assert.equal(wgc.isClamped(ones), true);
  const input = new Uint8Array(32).fill(0xff);
  wgc.clampPrivateKey(input);
  assert.equal(input[0], 0xff, 'the input array is not modified');
  for (let i = 0; i < 20; i++) {
    const raw = nodeCrypto.randomBytes(32);
    raw[0] |= 7;
    raw[31] |= 0x80;
    raw[31] &= ~0x40;
    const clamped = wgc.clampPrivateKey(raw);
    assert.equal(wgc.isClamped(clamped), true);
    // X25519 clamps internally (RFC 7748 decodeScalar25519), so `wg pubkey` gives the same answer
    assert.deepEqual(nodePublicKey(clamped), nodePublicKey(raw));
  }
});

test('wireguard: fallback engine uses getRandomValues, clamps, and passes the self-test', async () => {
  let calls = 0;
  const rng = (a) => { calls++; return getRandomValues(a); };
  const eng = wgc.naclEngine(fakeNacl(), rng);
  assert.equal(await wgc.selfTest(eng), true);
  const kp = await wgc.generateKeyPair(eng);
  assert.equal(calls, 1);
  assert.equal(wgc.isClamped(Buffer.from(kp.priv, 'base64')), true);
  assert.equal(pubOf(kp.priv), kp.pub);
});

test('wireguard: pickEngine prefers WebCrypto and falls back only when X25519 is missing', async () => {
  let loads = 0;
  const loadNacl = () => { loads++; return Promise.resolve(fakeNacl()); };
  const eng = await wgc.pickEngine({ subtle, getRandomValues, loadNacl });
  assert.equal(eng.id, 'webcrypto');
  assert.equal(loads, 0, 'TweetNaCl is not loaded when WebCrypto works');

  const noX25519 = {
    generateKey: () => Promise.reject(Object.assign(new Error('Unrecognized name'), { name: 'NotSupportedError' }))
  };
  const fb = await wgc.pickEngine({ subtle: noX25519, getRandomValues, loadNacl });
  assert.equal(fb.id, 'nacl');
  assert.match(fb.reason, /NotSupportedError/);
  const noSubtle = await wgc.pickEngine({ subtle: null, getRandomValues, loadNacl });
  assert.equal(noSubtle.id, 'nacl');
  assert.equal(loads, 2);
});

test('wireguard: pickEngine refuses broken engines and missing randomness', async () => {
  const broken = { scalarMult: () => new Uint8Array(32) };
  broken.scalarMult.base = () => new Uint8Array(32);
  await assert.rejects(wgc.pickEngine({ subtle: null, getRandomValues, loadNacl: () => Promise.resolve(broken) }), /self-test/);
  await assert.rejects(wgc.pickEngine({ subtle: null, getRandomValues, loadNacl: () => Promise.reject(new Error('offline')) }), /could not be loaded/);
  await assert.rejects(wgc.pickEngine({ subtle, getRandomValues: null }), /getRandomValues/);
});

test('wireguard: preshared keys are 32 random bytes, unclamped, like wg genpsk', () => {
  const allOnes = wgc.generatePresharedKey((a) => a.fill(0xff));
  assert.equal(allOnes, Buffer.alloc(32, 0xff).toString('base64'));
  assert.equal(allOnes.length, 44);
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const k = wgc.generatePresharedKey(getRandomValues);
    assert.equal(wgc.parseKey(k).ok, true);
    assert.equal(Buffer.from(k, 'base64').length, 32);
    seen.add(k);
  }
  assert.equal(seen.size, 50);
});

// ── Key format ───────────────────────────────────────────

test('wireguard: parseKey accepts exactly what wg(8) accepts', () => {
  const alicePub = b64(hex(wgc.RFC7748.alicePub));
  assert.equal(alicePub, 'hSDwCYkwp1R0i33ctD73Wg2/Og0mOBr066SpjqqbTmo=');
  assert.equal(wgc.parseKey('  ' + alicePub + '\n').ok, true);
  assert.equal(wgc.parseKey('').empty, true);
  assert.match(wgc.parseKey(alicePub.slice(0, 43)).error, /44 characters/);
  assert.match(wgc.parseKey(alicePub.slice(0, 41) + '-o=').error, /may only contain/);
  assert.match(wgc.parseKey(alicePub.slice(0, 42) + 'o==').error, /44 characters/);
  assert.match(wgc.parseKey(alicePub.replace('/', '_')).error, /may only contain/);
  // 43rd character with non-zero padding bits: wg rejects it although base64 decoders accept it
  const nonCanonical = alicePub.slice(0, 42) + 'p=';
  assert.match(wgc.parseKey(nonCanonical).error, /43rd character/);
  assert.equal(referenceKeyFromBase64(nonCanonical), false);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (const c of alphabet) {
    const k = alicePub.slice(0, 42) + c + '=';
    assert.equal(wgc.parseKey(k).ok, referenceKeyFromBase64(k), 'character ' + c);
  }
  for (let i = 0; i < 300; i++) {
    const s = Array.from(nodeCrypto.randomBytes(43), (x) => alphabet[x & 63]).join('') + (i % 7 ? '=' : 'A');
    assert.equal(wgc.parseKey(s).ok, referenceKeyFromBase64(s));
  }
});

test('wireguard: base64 helpers round-trip and read JWK base64url', () => {
  for (let n = 0; n < 40; n++) {
    const bytes = nodeCrypto.randomBytes(n);
    assert.equal(wgc.bytesToBase64(bytes), bytes.toString('base64'));
    assert.deepEqual(Buffer.from(wgc.base64ToBytes(bytes.toString('base64'))), bytes);
    assert.deepEqual(Buffer.from(wgc.base64ToBytes(bytes.toString('base64url'))), bytes);
  }
  assert.equal(wgc.base64ToBytes('a!b='), null);
});

// ── Addresses ────────────────────────────────────────────

test('wireguard: IPv4 and CIDR parsing', () => {
  assert.equal(wgc.parseIPv4('10.8.0.1'), 168296449);
  assert.equal(wgc.formatIPv4(4294967295), '255.255.255.255');
  for (const bad of ['10.8.0', '10.8.0.256', '010.8.0.1', '10.8.0.1.5', ' ', 'a.b.c.d']) assert.equal(wgc.parseIPv4(bad), null, bad);
  const c = wgc.parseCidr4('10.8.0.77/24');
  assert.equal(c.text, '10.8.0.0/24');
  assert.equal(c.hostBits, true);
  assert.equal(wgc.formatIPv4(c.last), '10.8.0.255');
  assert.equal(wgc.parseCidr4('10.8.0.0/33'), null);
  assert.equal(wgc.parseCidr4('10.8.0.0/024'), null);
  assert.equal(wgc.parseCidr4('0.0.0.0/0').text, '0.0.0.0/0');
});

test('wireguard: IPv6 parsing and RFC 5952 formatting', () => {
  const f = (s) => wgc.formatIPv6(wgc.parseIPv6(s));
  assert.equal(f('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(f('2001:db8:0:0:1:0:0:1'), '2001:db8::1:0:0:1');
  assert.equal(f('2001:db8:0:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1');
  assert.equal(f('::'), '::');
  assert.equal(f('::1'), '::1');
  assert.equal(f('fd00::'), 'fd00::');
  assert.equal(f('FD12:3456:789A::1'), 'fd12:3456:789a::1');
  assert.equal(f('::ffff:192.0.2.1'), '::ffff:c000:201');
  for (const bad of ['1::2::3', ':1::', '12345::', 'g::1', '1:2:3:4:5:6:7:8:9', '1.2.3.4', 'fe80::1%eth0', '']) {
    assert.equal(wgc.parseIPv6(bad), null, bad);
  }
  const c = wgc.parseCidr6('fd12:3456:789a::99/64');
  assert.equal(c.text, 'fd12:3456:789a::/64');
  assert.equal(c.hostBits, true);
  assert.equal(wgc.formatIPv6(wgc.addIPv6(c.network, 65537)), 'fd12:3456:789a::1:1');
  assert.equal(wgc.addIPv6([65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535], 1), null);
});

test('wireguard: random ULA prefixes follow RFC 4193 (fd00::/8, 40 random bits, /64)', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    const p = wgc.randomUla(getRandomValues);
    const c = wgc.parseCidr6(p);
    assert.ok(c, p);
    assert.equal(c.prefix, 64);
    assert.equal(c.network[0] >> 8, 0xfd);
    assert.deepEqual(c.network.slice(3), [0, 0, 0, 0, 0]);
    seen.add(p);
  }
  assert.ok(seen.size > 25);
  assert.equal(wgc.randomUla((a) => a.fill(0)), 'fd00::/64');
});

// ── Configs ──────────────────────────────────────────────

test('wireguard: default server config has Address, ListenPort, PrivateKey and a /32 per peer', async () => {
  const { state, keys, m } = await buildWith();
  assert.equal(m.ok, true, errors(m));
  assert.equal(m.pending, false);
  const s = parseConf(m.server.text);
  assert.deepEqual(s.map((x) => x.name), ['Interface', 'Peer', 'Peer']);
  assert.equal(get(s[0], 'Address'), '10.8.0.1/24');
  assert.equal(get(s[0], 'ListenPort'), '51820');
  assert.equal(get(s[0], 'PrivateKey'), keys.server.priv);
  assert.equal(get(s[0], 'MTU'), undefined);
  assert.equal(get(s[1], 'PublicKey'), keys.peers[state.peers[0].id].pub);
  assert.equal(get(s[1], 'AllowedIPs'), '10.8.0.2/32');
  assert.equal(get(s[2], 'AllowedIPs'), '10.8.0.3/32');
  assert.equal(get(s[1], 'Endpoint'), undefined, 'the server learns client endpoints by itself');
  assert.equal(get(s[1], 'PersistentKeepalive'), undefined);
  assert.match(m.server.text, /^\[Peer\]\n# phone\n/m);
  assert.equal(m.server.file, 'wg0.conf');
  assert.equal(m.server.path, '/etc/wireguard/wg0.conf');
  assert.equal(m.server.peersText, m.server.text.slice(m.server.text.indexOf('[Peer]')));
});

test('wireguard: client config is a full tunnel with endpoint, server key and its own key', async () => {
  const { state, keys, m } = await buildWith();
  const e = m.peers[0];
  const c = parseConf(e.text);
  assert.deepEqual(c.map((x) => x.name), ['Interface', 'Peer']);
  assert.equal(get(c[0], 'PrivateKey'), keys.peers[state.peers[0].id].priv);
  assert.equal(get(c[0], 'Address'), '10.8.0.2/32');
  assert.equal(get(c[0], 'DNS'), undefined);
  assert.equal(get(c[1], 'PublicKey'), keys.server.pub);
  assert.equal(get(c[1], 'AllowedIPs'), '0.0.0.0/0, ::/0');
  assert.equal(get(c[1], 'Endpoint'), 'vpn.home.example.net:51820');
  assert.equal(get(c[1], 'PersistentKeepalive'), undefined);
  assert.equal(e.file, 'phone.conf');
  assert.equal(e.address4, '10.8.0.2');
  assertAppCompatible(e.text);
  assertAppCompatible(m.peers[1].text);
});

test('wireguard: every key pairs up across server and client configs', async () => {
  const { m } = await buildWith({ peers: peers('a', 'b', 'c', 'd') });
  const s = parseConf(m.server.text);
  const serverPriv = get(s[0], 'PrivateKey');
  m.peers.forEach((e, i) => {
    const c = parseConf(e.text);
    const block = s[i + 1];
    assert.equal(get(c[1], 'PublicKey'), pubOf(serverPriv), 'client trusts the server key');
    assert.equal(get(block, 'PublicKey'), pubOf(get(c[0], 'PrivateKey')), 'server trusts the client key');
    assert.equal(get(c[1], 'PresharedKey'), get(block, 'PresharedKey'), 'same preshared key on both sides');
    assert.equal(wgc.parseKey(get(block, 'PresharedKey')).ok, true);
    // Both sides end up with the same Diffie-Hellman secret
    const k1 = nodeShared(Buffer.from(serverPriv, 'base64'), Buffer.from(get(block, 'PublicKey'), 'base64'));
    const k2 = nodeShared(Buffer.from(get(c[0], 'PrivateKey'), 'base64'), Buffer.from(get(c[1], 'PublicKey'), 'base64'));
    assert.deepEqual(k1, k2);
  });
  const psks = m.peers.map((e) => get(parseConf(e.text)[1], 'PresharedKey'));
  assert.equal(new Set(psks).size, psks.length, 'one preshared key per pair');
});

test('wireguard: preshared keys can be switched off on both sides', async () => {
  const { m } = await buildWith({ psk: false });
  assert.doesNotMatch(m.server.text, /PresharedKey/);
  m.peers.forEach((e) => assert.doesNotMatch(e.text, /PresharedKey/));
});

test('wireguard: IPv6 adds a /128 per peer with the IPv4 host number', async () => {
  const { m } = await buildWith({ v6: true, pool6: 'fd12:3456:789a::/64', firstPeer4: '10.8.0.10', peers: peers('a', 'b') });
  assert.equal(m.ok, true, errors(m));
  const s = parseConf(m.server.text);
  assert.equal(get(s[0], 'Address'), '10.8.0.1/24, fd12:3456:789a::1/64');
  assert.equal(get(s[1], 'AllowedIPs'), '10.8.0.10/32, fd12:3456:789a::a/128');
  assert.equal(get(s[2], 'AllowedIPs'), '10.8.0.11/32, fd12:3456:789a::b/128');
  const c = parseConf(m.peers[0].text);
  assert.equal(get(c[0], 'Address'), '10.8.0.10/32, fd12:3456:789a::a/128');
  assert.equal(get(c[1], 'AllowedIPs'), '0.0.0.0/0, ::/0');
});

test('wireguard: IPv6 off keeps IPv6 out of every address, with ::/0 only as leak protection', async () => {
  const on = await buildWith({ v6: false, pool6: 'fd00::/64' });
  assert.doesNotMatch(on.m.server.text, /fd00/);
  assert.equal(get(parseConf(on.m.peers[0].text)[1], 'AllowedIPs'), '0.0.0.0/0, ::/0');
  const off = await buildWith({ v6: false, blockV6: false });
  assert.equal(get(parseConf(off.m.peers[0].text)[1], 'AllowedIPs'), '0.0.0.0/0');
});

test('wireguard: split tunnel routes the tunnel network plus the listed networks', async () => {
  const { m } = await buildWith({ mode: 'split', splitNets: '192.168.1.1/24, 10.10.0.0/16 192.168.1.0/24; 172.16.5.4' });
  assert.equal(m.ok, true, errors(m));
  assert.equal(get(parseConf(m.peers[0].text)[1], 'AllowedIPs'), '10.8.0.0/24, 192.168.1.0/24, 10.10.0.0/16, 172.16.5.4/32');
  assert.match(texts(m, 'info'), /Using 192\.168\.1\.0\/24 for 192\.168\.1\.1\/24/);
  const v6 = await buildWith({ mode: 'split', splitNets: '', v6: true, pool6: 'fd01::/64' });
  assert.equal(get(parseConf(v6.m.peers[0].text)[1], 'AllowedIPs'), '10.8.0.0/24, fd01::/64');
  assert.match(texts(v6.m, 'info'), /reach only the server and each other/);
});

test('wireguard: split tunnel warnings for 0.0.0.0/0, IPv6 without tunnel IPv6, and overlaps', async () => {
  const { m } = await buildWith({ mode: 'split', splitNets: '0.0.0.0/0, fd99::/64, 10.0.0.0/8' });
  assert.equal(m.ok, true);
  const w = texts(m, 'warn');
  assert.match(w, /0\.0\.0\.0\/0 sends all IPv4 traffic/);
  assert.match(w, /fd99::\/64 is IPv6, but the tunnel has no IPv6 addresses/);
  assert.match(w, /10\.0\.0\.0\/8 overlaps the tunnel network 10\.8\.0\.0\/24/);
  const bad = await buildWith({ mode: 'split', splitNets: '192.168.1.0/24, lan' });
  assert.match(errors(bad.m), /Network "lan" is not an IPv4 or IPv6 network/);
});

test('wireguard: DNS servers, search domains and DNS checks', async () => {
  const { m } = await buildWith({ dns: '10.8.0.1, 2606:4700:4700:0:0:0:0:1111, home.lan' });
  assert.equal(get(parseConf(m.peers[0].text)[0], 'DNS'), '10.8.0.1, 2606:4700:4700::1111, home.lan');
  assert.match(texts(m, 'info'), /make sure a resolver on the server answers/);
  assert.match(texts(m, 'warn'), /DNS server 2606:4700:4700::1111 is IPv6/);
  const none = await buildWith({ dns: '' });
  assert.match(texts(none.m, 'info'), /No DNS servers set/);
  const split = await buildWith({ mode: 'split', splitNets: '10.10.0.0/16', dns: '192.168.1.1' });
  assert.match(texts(split.m, 'warn'), /192\.168\.1\.1 is not inside the tunnel's AllowedIPs/);
  const bad = await buildWith({ dns: '1.1.1, -bad-' });
  assert.match(errors(bad.m), /DNS entry "1\.1\.1"/);
  assert.match(errors(bad.m), /DNS entry "-bad-"/);
  const parsed = wgc.parseDns('1.1.1.1 9.9.9.9;corp.example');
  assert.deepEqual(parsed.servers.map((d) => d.text), ['1.1.1.1', '9.9.9.9']);
  assert.deepEqual(parsed.domains, ['corp.example']);
});

test('wireguard: PersistentKeepalive and MTU appear only when set', async () => {
  const ka = await buildWith({ keepalive: '25', mtu: '1380' });
  const c = parseConf(ka.m.peers[0].text);
  assert.equal(get(c[1], 'PersistentKeepalive'), '25');
  assert.equal(get(c[0], 'MTU'), '1380');
  assert.equal(get(parseConf(ka.m.server.text)[0], 'MTU'), '1380');
  assert.doesNotMatch(ka.m.server.text, /PersistentKeepalive/);
  const custom = await buildWith({ keepalive: 'custom', keepaliveCustom: '15' });
  assert.equal(get(parseConf(custom.m.peers[0].text)[1], 'PersistentKeepalive'), '15');
  for (const bad of ['0', '65536', 'off', '2.5', '']) {
    const r = await buildWith({ keepalive: 'custom', keepaliveCustom: bad });
    assert.match(errors(r.m), /Keepalive must be a whole number of seconds from 1 to 65535/, bad);
  }
  for (const bad of ['67', '65536', 'auto', '-1']) {
    const r = await buildWith({ mtu: bad });
    assert.match(errors(r.m), /MTU must be a whole number from 68 to 65535/, bad);
  }
  assert.match(texts((await buildWith({ mtu: '1200', v6: true, pool6: 'fd00::/64' })).m, 'warn'), /RFC 8200/);
  assert.match(texts((await buildWith({ mtu: '1500' })).m, 'info'), /above 1420/);
});

// ── Address pool allocation ──────────────────────────────

test('wireguard: pool too small is an error with a suggested size', async () => {
  const two = peers('a', 'b');
  const r30 = await buildWith({ pool4: '10.8.0.0/30', peers: two });
  assert.match(errors(r30.m), /10\.8\.0\.0\/30 has room for 1 peer from 10\.8\.0\.1 .* but there are 2\. Use a \/29 or larger/);
  const ok30 = await buildWith({ pool4: '10.8.0.0/30', peers: peers('a') });
  assert.equal(ok30.m.ok, true, errors(ok30.m));
  assert.equal(get(parseConf(ok30.m.peers[0].text)[0], 'Address'), '10.8.0.2/32');
  const five = await buildWith({ pool4: '10.8.0.0/29', peers: peers('a', 'b', 'c', 'd', 'e') });
  assert.equal(five.m.ok, true, errors(five.m));
  assert.deepEqual(five.m.peers.map((e) => e.address4), ['10.8.0.2', '10.8.0.3', '10.8.0.4', '10.8.0.5', '10.8.0.6']);
  const six = await buildWith({ pool4: '10.8.0.0/29', peers: peers('a', 'b', 'c', 'd', 'e', 'f') });
  assert.match(errors(six.m), /has room for 5 peers .* Use a \/28 or larger/);
  for (const p of ['10.8.0.0/31', '10.8.0.0/32']) {
    assert.match(errors((await buildWith({ pool4: p })).m), /has no room for a server and peers/);
  }
});

test('wireguard: network and broadcast addresses are never handed out', async () => {
  const net = await buildWith({ serverIp4: '10.8.0.0' });
  assert.match(errors(net.m), /Server address 10\.8\.0\.0 is the network address of 10\.8\.0\.0\/24/);
  const bc = await buildWith({ firstPeer4: '10.8.0.255' });
  assert.match(errors(bc.m), /First peer address 10\.8\.0\.255 is the broadcast address/);
  const outside = await buildWith({ serverIp4: '10.9.0.1' });
  assert.match(errors(outside.m), /outside 10\.8\.0\.0\/24/);
  const last = await buildWith({ serverIp4: '10.8.0.254', peers: peers('a', 'b') });
  assert.equal(last.m.ok, true, errors(last.m));
  assert.equal(last.m.server.address4, '10.8.0.254');
  assert.deepEqual(last.m.peers.map((e) => e.address4), ['10.8.0.1', '10.8.0.2']);
  const top = await buildWith({ firstPeer4: '10.8.0.253', peers: peers('a', 'b') });
  assert.deepEqual(top.m.peers.map((e) => e.address4), ['10.8.0.253', '10.8.0.254']);
  const over = await buildWith({ firstPeer4: '10.8.0.254', peers: peers('a', 'b') });
  assert.match(errors(over.m), /has room for 1 peer from 10\.8\.0\.254/);
});

test('wireguard: peers skip the server address and start where asked', async () => {
  const r = await buildWith({ serverIp4: '10.8.0.3', firstPeer4: '10.8.0.2', peers: peers('a', 'b', 'c') });
  assert.deepEqual(r.m.peers.map((e) => e.address4), ['10.8.0.2', '10.8.0.4', '10.8.0.5']);
  const host = await buildWith({ pool4: '10.8.0.1/24' });
  assert.equal(host.m.ok, true);
  assert.match(texts(host.m, 'info'), /Using 10\.8\.0\.0\/24, the network that 10\.8\.0\.1\/24 belongs to/);
  const big = await buildWith({ pool4: '10.8.0.0/16', firstPeer4: '10.8.1.0', peers: peers('a') });
  assert.equal(big.m.peers[0].address4, '10.8.1.0', 'x.x.x.0 is a normal host inside a /16');
});

test('wireguard: IPv6 pool edge cases', async () => {
  // A /124 holds host numbers 1-15 (0 is the subnet-router anycast address)
  const small = await buildWith({ v6: true, pool6: 'fd00::/124', firstPeer4: '10.8.0.15', peers: peers('a', 'b') });
  assert.match(errors(small.m), /fd00::\/124 is too small: each peer gets the same host number as in IPv4, up to 16/);
  const fits = await buildWith({ v6: true, pool6: 'fd00::/124', firstPeer4: '10.8.0.14', peers: peers('a', 'b') });
  assert.equal(fits.m.ok, true, errors(fits.m));
  assert.deepEqual(fits.m.peers.map((e) => e.address6), ['fd00::e', 'fd00::f']);
  assert.equal(fits.m.server.address6, 'fd00::1');
  assert.match(errors((await buildWith({ v6: true, pool6: '' })).m), /Enter the tunnel's IPv6 network/);
  assert.match(errors((await buildWith({ v6: true, pool6: 'fd00::/129' })).m), /is not valid/);
  assert.match(errors((await buildWith({ v6: true, pool6: 'fd00::/125' })).m), /between \/8 and \/124/);
  assert.match(texts((await buildWith({ v6: true, pool6: 'fd00::5/64' })).m, 'info'), /Using fd00::\/64/);
});

test('wireguard: pool range warnings', async () => {
  assert.match(texts((await buildWith({ pool4: '8.8.8.0/24' })).m, 'warn'), /not a private range \(RFC 1918/);
  assert.match(texts((await buildWith({ pool4: '100.64.10.0/24' })).m, 'warn'), /RFC 6598/);
  assert.doesNotMatch(texts((await buildWith({ pool4: '172.31.0.0/24' })).m, 'warn'), /RFC 1918/);
  assert.match(errors((await buildWith({ pool4: '' })).m), /Enter the tunnel's IPv4 network/);
  assert.match(errors((await buildWith({ pool4: '10.8.0/24' })).m), /is not valid/);
});

// ── Endpoint and server settings ─────────────────────────

test('wireguard: endpoint parsing (names, IPv4, bracketed IPv6, ports)', () => {
  const e = (s) => wgc.parseEndpoint(s, 51820);
  assert.equal(e('VPN.Example.org').text, 'vpn.example.org:51820');
  assert.equal(e('203.0.113.10:443').text, '203.0.113.10:443');
  assert.equal(e('203.0.113.10:443').portGiven, true);
  assert.equal(e('[2001:DB8:0::1]:51821').text, '[2001:db8::1]:51821');
  assert.equal(e('2001:db8::1').text, '[2001:db8::1]:51820');
  assert.equal(e('[2001:db8::1]').text, '[2001:db8::1]:51820');
  assert.match(e('https://vpn.example.org').error, /without "https:\/\/"/);
  assert.match(e('vpn.example.org:0').error, /from 1 to 65535/);
  assert.match(e('vpn.example.org:70000').error, /from 1 to 65535/);
  assert.match(e('vpn.example.org:').error, /no port number/);
  assert.match(e('300.1.1.1').error, /not a valid IPv4 address/);
  assert.match(e('bad_host!').error, /not a valid host name/);
  assert.match(e('[fe80::1%eth0]:1').error, /bracketed IPv6/);
  assert.match(e('').error, /Enter the public endpoint/);
});

test('wireguard: endpoint warnings and a different public port', async () => {
  const ex = await buildWith({ endpoint: 'vpn.example.com' });
  assert.match(texts(ex.m, 'warn'), /Replace the example endpoint/);
  const lan = await buildWith({ endpoint: '192.168.1.10' });
  assert.match(texts(lan.m, 'warn'), /private address/);
  const cg = await buildWith({ endpoint: '100.72.1.1' });
  assert.match(texts(cg.m, 'warn'), /carrier-grade NAT/);
  const port = await buildWith({ endpoint: 'vpn.home.example.net:443', listenPort: '51820' });
  assert.equal(get(parseConf(port.m.peers[0].text)[1], 'Endpoint'), 'vpn.home.example.net:443');
  assert.equal(get(parseConf(port.m.server.text)[0], 'ListenPort'), '51820');
  assert.match(texts(port.m, 'info'), /Forward it on your router to port 51820/);
  const step = port.m.steps.find((s) => s.title === 'Open the port');
  assert.match(step.text, /Forward UDP port 443 .* port 51820/);
});

test('wireguard: invalid server settings are errors', async () => {
  assert.match(errors((await buildWith({ iface: 'wireguard-tunnel0' })).m), /Interface name "wireguard-tunnel0"/);
  assert.match(errors((await buildWith({ iface: 'wg 0' })).m), /Interface name/);
  assert.match(errors((await buildWith({ listenPort: '0' })).m), /Listen port must be/);
  assert.match(errors((await buildWith({ listenPort: '65536' })).m), /Listen port must be/);
  const empty = await buildWith({ iface: '', listenPort: '' });
  assert.equal(empty.m.ok, true, 'empty fields fall back to wg0 and 51820');
  assert.equal(empty.m.server.file, 'wg0.conf');
  assert.match(empty.m.server.text, /ListenPort = 51820/);
  assert.match(errors((await buildWith({ nat: true, natIface: 'eth0; rm -rf /' })).m), /Outgoing interface/);
});

// ── Pasted public keys ───────────────────────────────────

test('wireguard: pasted server public key leaves a placeholder instead of a private key', async () => {
  const serverPriv = wgc.clampPrivateKey(nodeCrypto.randomBytes(32));
  const serverPub = nodePublicKey(serverPriv).toString('base64');
  const state = wgc.normalizeState(Object.assign(wgc.defaultState(), { endpoint: 'vpn.home.example.net', serverKeyMode: 'paste', serverPub: ' ' + serverPub + ' ' }));
  const keys = await makeKeys(state);
  const m = wgc.build(state, keys);
  assert.equal(m.ok, true, errors(m));
  assert.equal(m.server.placeholder, true);
  assert.equal(get(parseConf(m.server.text)[0], 'PrivateKey'), wgc.SERVER_KEY_PLACEHOLDER);
  assert.ok(!m.server.text.includes(keys.server.priv), 'a generated server key is not used in paste mode');
  assert.equal(m.server.pub, serverPub);
  m.peers.forEach((e) => assert.equal(get(parseConf(e.text)[1], 'PublicKey'), serverPub));
  assert.match(m.steps[1].text, /replace the private key placeholder/);
  assert.match(errors(wgc.build(Object.assign({}, state, { serverPub: 'abc' }), keys)), /Server public key must be 44 characters/);
  assert.match(errors(wgc.build(Object.assign({}, state, { serverPub: '' }), keys)), /Server public key is empty/);
});

test('wireguard: a peer with its own key gets no private key, no QR and the right server block', async () => {
  const devicePriv = wgc.clampPrivateKey(nodeCrypto.randomBytes(32));
  const devicePub = nodePublicKey(devicePriv).toString('base64');
  const state = wgc.normalizeState(Object.assign(wgc.defaultState(), {
    endpoint: 'vpn.home.example.net',
    peers: [{ name: 'phone' }, { name: 'laptop', keyMode: 'paste', pub: devicePub }]
  }));
  const keys = await makeKeys(state);
  const m = wgc.build(state, keys);
  assert.equal(m.ok, true, errors(m));
  const e = m.peers[1];
  assert.equal(e.paste, true);
  assert.equal(e.qr, null);
  assert.equal(get(parseConf(e.text)[0], 'PrivateKey'), undefined);
  assert.match(e.text, /^# PrivateKey = /m);
  assert.equal(get(parseConf(m.server.text)[2], 'PublicKey'), devicePub);
  assert.equal(get(parseConf(m.server.text)[2], 'PresharedKey'), get(parseConf(e.text)[1], 'PresharedKey'));
  assert.ok(m.peers[0].qr && m.peers[0].qr.ecl);
});

test('wireguard: invalid and duplicate pasted keys are errors', async () => {
  const kp = await wgc.generateKeyPair(webcrypto());
  const dup = await buildWith({ peers: [{ name: 'a', keyMode: 'paste', pub: kp.pub }, { name: 'b', keyMode: 'paste', pub: kp.pub }] });
  assert.match(errors(dup.m), /Peer "b" has the same public key as peer "a"/);
  const asServer = await buildWith({ serverKeyMode: 'paste', serverPub: kp.pub, peers: [{ name: 'a', keyMode: 'paste', pub: kp.pub }] });
  assert.match(errors(asServer.m), /Peer "a" has the same public key as the server/);
  const bad = await buildWith({ peers: [{ name: 'tab', keyMode: 'paste', pub: kp.pub.slice(0, 42) + 'p=' }] });
  assert.match(errors(bad.m), /Peer "tab": public key is not a valid key: its 43rd character/);
});

test('wireguard: missing keys mark the model as pending instead of printing empty keys', async () => {
  const state = wgc.normalizeState(wgc.defaultState());
  const m = wgc.build(state, { server: null, peers: {} });
  assert.equal(m.pending, true);
  assert.equal(m.server, null);
});

// ── NAT example and setup steps ──────────────────────────

test('wireguard: NAT example adds matching PostUp and PostDown rules', async () => {
  const { m } = await buildWith({ nat: true, natIface: 'ens18' });
  const s = parseConf(m.server.text)[0];
  const up = all(s, 'PostUp');
  const down = all(s, 'PostDown');
  assert.deepEqual(up, [
    'iptables -A FORWARD -i %i -j ACCEPT',
    'iptables -A FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT',
    'iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o ens18 -j MASQUERADE'
  ]);
  assert.deepEqual(down, up.map((c) => c.replace(' -A ', ' -D ')));
  assert.match(m.server.text, /# Example NAT rules \(iptables\): check that ens18/);
  assert.doesNotMatch(m.server.text, /ip6tables/);
  m.peers.forEach((e) => assert.doesNotMatch(e.text, /PostUp|PostDown/));
  const v6 = await buildWith({ nat: true, v6: true, pool6: 'fd12::/64' });
  assert.ok(all(parseConf(v6.m.server.text)[0], 'PostUp').includes('ip6tables -t nat -A POSTROUTING -s fd12::/64 -o eth0 -j MASQUERADE'));
  const gua = await buildWith({ nat: true, v6: true, pool6: '2001:db8:1::/64' });
  const guaUp = all(parseConf(gua.m.server.text)[0], 'PostUp');
  assert.ok(guaUp.includes('ip6tables -A FORWARD -i %i -j ACCEPT'));
  assert.ok(!guaUp.some((c) => c.includes('MASQUERADE') && c.startsWith('ip6tables')));
  assert.match(texts(gua.m, 'info'), /not a ULA prefix/);
  const off = await buildWith({ nat: false });
  assert.doesNotMatch(off.m.server.text, /PostUp/);
  assert.match(texts(off.m, 'info'), /Full tunnel: the server has to forward and masquerade/);
});

test('wireguard: setup steps use the interface name and mention IPv6 forwarding only with IPv6', async () => {
  const { m } = await buildWith({ iface: 'wgvpn0' });
  const cmds = m.steps.map((s) => s.cmd).join('\n');
  assert.match(cmds, /sudo systemctl enable --now wg-quick@wgvpn0/);
  assert.match(cmds, /sudo systemctl reload wg-quick@wgvpn0/);
  assert.match(cmds, /chmod 600 \/etc\/wireguard\/wgvpn0\.conf/);
  assert.match(cmds, /net\.ipv4\.ip_forward = 1/);
  assert.doesNotMatch(cmds, /ipv6/);
  const v6 = await buildWith({ v6: true, pool6: 'fd00::/64', nat: true, natIface: 'eth1' });
  const fwd = v6.m.steps.find((s) => s.title === 'Turn on IP forwarding');
  assert.match(fwd.cmd, /net\.ipv6\.conf\.all\.forwarding = 1/);
  assert.match(fwd.text, /net\.ipv6\.conf\.eth1\.accept_ra = 2/);
});

// ── Masking, files, QR, ZIP ──────────────────────────────

test('wireguard: masked display hides private and preshared keys only', async () => {
  const { keys, m } = await buildWith();
  assert.ok(!m.server.display.includes(keys.server.priv));
  for (const e of m.peers) {
    assert.ok(!e.display.includes(e.priv));
    assert.ok(!e.display.includes(e.psk));
    assert.ok(e.display.includes(keys.server.pub), 'public keys stay visible');
    assert.match(e.display, /^PrivateKey = •{44}$/m);
  }
  assert.equal(wgc.maskSecrets('PrivateKey = ' + wgc.SERVER_KEY_PLACEHOLDER), 'PrivateKey = ' + wgc.SERVER_KEY_PLACEHOLDER);
});

test('wireguard: config file names are valid interface names and unique', () => {
  const re = /^[a-zA-Z0-9_=+.-]{1,15}\.conf$/;
  const names = wgc.uniqueConfNames(['Anna’s iPhone 15 Pro Max', 'laptop', 'Laptop', 'laptop', 'Телефон', '', '..', 'wg0', 'a/b\\c']);
  names.forEach((n) => assert.match(n, re, n));
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
  assert.deepEqual(names.slice(0, 5), ['Anna-s-iPhone-1.conf', 'laptop.conf', 'Laptop-2.conf', 'laptop-3.conf', 'peer5.conf']);
  assert.equal(names[5], 'peer6.conf');
  assert.equal(names[6], 'peer7.conf');
  assert.equal(names[8], 'a-b-c.conf');
  assert.equal(wgc.confBaseName('phone', 0), 'phone');
});

test('wireguard: peer names are cleaned before they reach a config comment', async () => {
  const { m } = await buildWith({ peers: [{ name: 'evil\n[Interface]\nPostUp = rm -rf /' }, { name: '' }] });
  assert.equal(m.ok, true);
  assert.match(m.server.text, /^# evil\[Interface\]PostUp = rm -rf \/$/m);
  assert.equal(parseConf(m.server.text).filter((s) => s.name === 'Interface').length, 1);
  assert.doesNotMatch(m.server.text, /^PostUp/m);
  assert.equal(m.peers[1].name, 'peer2');
});

test('wireguard: QR capacity check uses the version 40 byte limits', async () => {
  assert.deepEqual(wgc.QR_MAX_BYTES, { L: 2953, M: 2331, Q: 1663, H: 1273 });
  assert.deepEqual(wgc.qrPlan('a'.repeat(2331)), { ecl: 'M', bytes: 2331 });
  assert.deepEqual(wgc.qrPlan('a'.repeat(2332)), { ecl: 'L', bytes: 2332 });
  assert.deepEqual(wgc.qrPlan('a'.repeat(2953)), { ecl: 'L', bytes: 2953 });
  assert.deepEqual(wgc.qrPlan('a'.repeat(2954)), { ecl: null, bytes: 2954 });
  assert.equal(wgc.qrPlan('ä').bytes, 2, 'counted in UTF-8 bytes');
  const { m } = await buildWith({ v6: true, pool6: 'fd12:3456:789a::/64', dns: '10.8.0.1, home.lan', keepalive: '25', mtu: '1380' });
  for (const e of m.peers) {
    assert.equal(e.qr.ecl, 'M');
    assert.ok(e.qr.bytes < 500, 'typical config is small: ' + e.qr.bytes);
    assert.equal(e.qr.bytes, Buffer.byteLength(e.text));
  }
  const nets = Array.from({ length: 220 },(_, i) => '10.' + (100 + (i >> 4)) + '.' + (i & 15) + '.0/24').join(', ');
  const long = await buildWith({ mode: 'split', splitNets: nets });
  assert.equal(long.m.ok, true, errors(long.m));
  assert.equal(long.m.peers[0].qr.ecl, null);
});

test('wireguard: QR SVG draws one path from a module matrix', () => {
  const svg = wgc.qrSvg({ count: 2, modules: [[true, true], [false, true]] }, 4);
  assert.match(svg, /viewBox="0 0 10 10"/);
  assert.match(svg, /d="M4 4h2v1h-2zM5 5h1v1h-1z"/);
});

test('wireguard: ZIP holds every config with correct CRC-32 and mode 0600', async () => {
  const { m } = await buildWith();
  const date = new Date(2026, 9, 26, 18, 30, 10);
  const zip = Buffer.from(wgc.makeZip(m.files, date));
  assert.equal(wgc.crc32(Buffer.from('123456789')), 0xcbf43926);
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  assert.equal(count, 3);
  let cd = zip.readUInt32LE(eocd + 16);
  assert.equal(cd + zip.readUInt32LE(eocd + 12), eocd);
  const seen = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(cd), 0x02014b50);
    assert.equal(zip.readUInt16LE(cd + 4) >> 8, 3, 'made by Unix');
    assert.equal((zip.readUInt32LE(cd + 38) >>> 16) & 0o777, 0o600);
    const crc = zip.readUInt32LE(cd + 16);
    const size = zip.readUInt32LE(cd + 24);
    const nameLen = zip.readUInt16LE(cd + 28);
    const name = zip.subarray(cd + 46, cd + 46 + nameLen).toString('utf8');
    const off = zip.readUInt32LE(cd + 42);
    assert.equal(zip.readUInt32LE(off), 0x04034b50);
    assert.equal(zip.readUInt16LE(off + 8), 0, 'stored');
    const dataStart = off + 30 + zip.readUInt16LE(off + 26);
    const data = zip.subarray(dataStart, dataStart + size);
    if (typeof zlib.crc32 === 'function') assert.equal(zlib.crc32(data), crc);
    assert.equal(wgc.crc32(data), crc);
    seen.push([name, data.toString('utf8')]);
    cd += 46 + nameLen;
  }
  assert.deepEqual(seen, m.files.map((f) => [f.name, f.text]));
  assert.deepEqual(seen.map((s) => s[0]), ['server/wg0.conf', 'clients/phone.conf', 'clients/laptop.conf']);
  const dosDate = zip.readUInt16LE(12);
  assert.equal(dosDate, ((2026 - 1980) << 9) | (10 << 5) | 26);
});

// ── URL hash state ───────────────────────────────────────

test('wireguard: the URL hash never carries a private or preshared key', async () => {
  const devicePub = (await wgc.generateKeyPair(webcrypto())).pub;
  const { state, keys, m } = await buildWith({
    v6: true, pool6: 'fd12::/64', dns: '10.8.0.1', nat: true,
    peers: [{ name: 'phone' }, { name: 'nas', keyMode: 'paste', pub: devicePub }]
  });
  const hash = wgc.encodeState(state);
  const decoded = decodeURIComponent(hash);
  const secrets = [keys.server.priv].concat(Object.values(keys.peers).flatMap((k) => [k.priv, k.psk]));
  for (const s of secrets) assert.ok(!decoded.includes(s) && !hash.includes(encodeURIComponent(s)), 'secret leaked into the hash');
  assert.ok(decoded.includes(devicePub), 'pasted public keys are kept');
  assert.ok(!decoded.includes(keys.server.pub), 'generated public keys are not stored either');
  assert.ok(m.ok);
});

test('wireguard: URL hash round-trips the settings', () => {
  const kp = wgc.bytesToBase64(nodePublicKey(wgc.clampPrivateKey(nodeCrypto.randomBytes(32))));
  const s = wgc.normalizeState(Object.assign(wgc.defaultState(), {
    iface: 'wg1', endpoint: '[2001:db8::1]:443', listenPort: '51821', serverKeyMode: 'paste', serverPub: kp,
    pool4: '10.66.0.0/24', serverIp4: '10.66.0.254', firstPeer4: '10.66.0.20', v6: true, pool6: 'fd66::/64',
    mode: 'split', splitNets: '192.168.50.0/24', blockV6: false, dns: '10.66.0.254, lan', keepalive: 'custom',
    keepaliveCustom: '30', mtu: '1380', psk: false, nat: true, natIface: 'vmbr0',
    peers: [{ name: 'phone & tablet' }, { name: 'nas', keyMode: 'paste', pub: kp }]
  }));
  const back = wgc.decodeState(wgc.encodeState(s));
  const strip = (x) => Object.assign({}, x, { peers: x.peers.map((p) => ({ name: p.name, keyMode: p.keyMode, pub: p.pub })) });
  assert.deepEqual(strip(back), strip(s));
  const gen = wgc.decodeState(wgc.encodeState(Object.assign({}, s, { serverKeyMode: 'generate' })));
  assert.equal(gen.serverPub, '', 'a pasted server key is dropped when the server key is generated');
});

test('wireguard: broken or foreign hashes fall back safely', () => {
  assert.equal(wgc.decodeState(''), null);
  assert.equal(wgc.decodeState('#'), null);
  assert.equal(wgc.decodeState('#section-2'), null);
  const s = wgc.decodeState('#m=weird&sk=evil&ka=99&peers=%5B%5B%22a%22%5D%2C42%2Cnull%5D&ep=%E0%A4%A');
  assert.equal(s.mode, 'full');
  assert.equal(s.serverKeyMode, 'generate');
  assert.equal(s.keepalive, 'off');
  assert.deepEqual(s.peers.map((p) => p.name), ['a', '42', '']);
  const notJson = wgc.decodeState('#ep=x.example&peers=%5Bnope');
  assert.equal(notJson.endpoint, 'x.example');
  assert.equal(notJson.peers.length, 2, 'default peers when the list cannot be read');
  const many = wgc.decodeState('#peers=' + encodeURIComponent(JSON.stringify(Array.from({ length: 300 }, (_, i) => ['p' + i]))));
  assert.equal(many.peers.length, wgc.MAX_PEERS);
});

// ── Source hygiene ───────────────────────────────────────

test('wireguard: sources are safe to embed in the WordPress block', () => {
  const dir = path.join(__dirname, '..', 'wireguard-config-generator');
  const open = '<' + '!--';
  const close = '--' + '>';
  const endScript = '<' + '/script';
  const uEscape = new RegExp(String.fromCharCode(92, 92) + 'u[0-9a-fA-F]{4}');
  for (const f of ['index.html', 'style.css', 'script.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!src.includes(open), f + ' contains an HTML comment opener');
    assert.ok(!src.includes(close), f + ' contains an HTML comment closer');
    if (f !== 'index.html') assert.ok(!src.toLowerCase().includes(endScript), f + ' contains a closing script tag');
    assert.ok(!uEscape.test(src), f + ' contains a unicode escape');
  }
  const js = fs.readFileSync(path.join(dir, 'script.js'), 'utf8');
  const code = js.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/Math\.random/.test(code), 'Math.random is never used');
  assert.ok(!/localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(code), 'no storage or network APIs');
  assert.match(js, /createElement\('script'\)/, 'CDN libraries come through the dynamic loader');
  assert.match(js, /integrity = integrity/);
});
