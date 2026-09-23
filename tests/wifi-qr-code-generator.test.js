// tests/wifi-qr-code-generator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const wqr = loadScript('wifi-qr-code-generator/script.js');

// Minimal WIFI: parser used to prove escaping round-trips (splits on unescaped ';')
function parsePayload(payload) {
  assert.ok(payload.startsWith('WIFI:'), 'payload starts with WIFI:');
  assert.ok(payload.endsWith(';;'), 'payload ends with ;;');
  const body = payload.slice(5);
  const fields = {};
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && i + 1 < body.length) {
      current += body[i + 1];
      i++;
    } else if (ch === ';') {
      if (current) {
        const idx = current.indexOf(':');
        fields[current.slice(0, idx)] = current.slice(idx + 1);
      }
      current = '';
    } else {
      current += ch;
    }
  }
  return fields;
}

function levels(msgs, field) {
  return msgs.filter((m) => !field || m.field === field).map((m) => m.level);
}

// ── escapeValue ──────────────────────────────────────────

test('wifi: escapeValue escapes backslash, semicolon, comma, colon and quote', () => {
  assert.equal(wqr.escapeValue('a\\b'), 'a\\\\b');
  assert.equal(wqr.escapeValue('a;b'), 'a\\;b');
  assert.equal(wqr.escapeValue('a,b'), 'a\\,b');
  assert.equal(wqr.escapeValue('a:b'), 'a\\:b');
  assert.equal(wqr.escapeValue('a"b'), 'a\\"b');
});

test('wifi: escapeValue leaves ordinary text and spaces untouched', () => {
  assert.equal(wqr.escapeValue('My Home Net 5G'), 'My Home Net 5G');
  assert.equal(wqr.escapeValue('Кава & чай'), 'Кава & чай');
});

test('wifi: escapeValue handles null/undefined', () => {
  assert.equal(wqr.escapeValue(null), '');
  assert.equal(wqr.escapeValue(undefined), '');
});

// ── securityType ─────────────────────────────────────────

test('wifi: securityType maps modes to T: values', () => {
  assert.equal(wqr.securityType('wpa'), 'WPA');
  assert.equal(wqr.securityType('wpa3'), 'WPA');
  assert.equal(wqr.securityType('wpa3', true), 'SAE');
  assert.equal(wqr.securityType('wpa', true), 'WPA');
  assert.equal(wqr.securityType('wep'), 'WEP');
  assert.equal(wqr.securityType('nopass'), 'nopass');
  assert.equal(wqr.securityType('bogus'), 'WPA');
});

// ── buildPayload ─────────────────────────────────────────

test('wifi: buildPayload builds a WPA payload', () => {
  assert.equal(
    wqr.buildPayload({ ssid: 'HomeNet', security: 'wpa', password: 'correcthorse' }),
    'WIFI:T:WPA;S:HomeNet;P:correcthorse;;'
  );
});

test('wifi: buildPayload adds R:1 for WPA3-only networks', () => {
  assert.equal(
    wqr.buildPayload({ ssid: 'HomeNet', security: 'wpa3', password: 'correcthorse' }),
    'WIFI:T:WPA;R:1;S:HomeNet;P:correcthorse;;'
  );
});

test('wifi: buildPayload uses T:SAE without R: in Android-style mode', () => {
  assert.equal(
    wqr.buildPayload({ ssid: 'HomeNet', security: 'wpa3', password: 'correcthorse', saeStyle: true }),
    'WIFI:T:SAE;S:HomeNet;P:correcthorse;;'
  );
});

test('wifi: buildPayload ignores the Android-style flag outside WPA3', () => {
  assert.equal(
    wqr.buildPayload({ ssid: 'HomeNet', security: 'wpa', password: 'correcthorse', saeStyle: true }),
    'WIFI:T:WPA;S:HomeNet;P:correcthorse;;'
  );
});

test('wifi: buildPayload builds a WEP payload', () => {
  assert.equal(
    wqr.buildPayload({ ssid: 'Old', security: 'wep', password: 'abcde' }),
    'WIFI:T:WEP;S:Old;P:abcde;;'
  );
});

test('wifi: buildPayload omits the password for open networks', () => {
  assert.equal(
    wqr.buildPayload({ ssid: 'Cafe Guest', security: 'nopass', password: 'leftover' }),
    'WIFI:T:nopass;S:Cafe Guest;;'
  );
});

test('wifi: buildPayload places H:true after the SSID', () => {
  assert.equal(
    wqr.buildPayload({ ssid: 'Stealth', security: 'wpa3', password: 'correcthorse', hidden: true }),
    'WIFI:T:WPA;R:1;S:Stealth;H:true;P:correcthorse;;'
  );
  assert.equal(
    wqr.buildPayload({ ssid: 'Stealth', security: 'nopass', hidden: true }),
    'WIFI:T:nopass;S:Stealth;H:true;;'
  );
});

test('wifi: buildPayload omits an empty password', () => {
  assert.equal(wqr.buildPayload({ ssid: 'X', security: 'wpa', password: '' }), 'WIFI:T:WPA;S:X;;');
});

test('wifi: buildPayload escapes special characters in SSID and password', () => {
  assert.equal(
    wqr.buildPayload({ ssid: 'A;B,C', security: 'wpa', password: 'p:w"d\\x' }),
    'WIFI:T:WPA;S:A\\;B\\,C;P:p\\:w\\"d\\\\x;;'
  );
});

test('wifi: buildPayload output round-trips through a WIFI: parser', () => {
  const ssid = 'Tricky;Net,"5G":\\ Кава ☕';
  const password = 'pa;ss,wo:rd"\\ end';
  const fields = parsePayload(wqr.buildPayload({ ssid, security: 'wpa', password, hidden: true }));
  assert.equal(fields.T, 'WPA');
  assert.equal(fields.S, ssid);
  assert.equal(fields.P, password);
  assert.equal(fields.H, 'true');
});

// ── UTF-8 helpers ────────────────────────────────────────

test('wifi: toUtf8ByteString encodes non-ASCII as UTF-8 bytes', () => {
  assert.equal(wqr.toUtf8ByteString('abc'), 'abc');
  const cafe = wqr.toUtf8ByteString('Café');
  assert.equal(cafe.length, 5);
  assert.deepEqual([...cafe].map((c) => c.charCodeAt(0)), [0x43, 0x61, 0x66, 0xc3, 0xa9]);
  assert.equal(wqr.toUtf8ByteString('☕').length, 3);
  assert.equal(wqr.toUtf8ByteString('📶').length, 4);
});

test('wifi: toUtf8ByteString bytes match Buffer UTF-8 encoding', () => {
  const s = 'Мій Wi-Fi 📶';
  const expected = Buffer.from(s, 'utf8');
  const actual = wqr.toUtf8ByteString(s);
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(actual.charCodeAt(i), expected[i]);
  }
});

test('wifi: utf8Length counts bytes, splitChars counts code points', () => {
  assert.equal(wqr.utf8Length('Кава'), 8);
  assert.equal(wqr.utf8Length(''), 0);
  assert.equal(wqr.splitChars('a📶b').length, 3);
});

// ── validate ─────────────────────────────────────────────

test('wifi: validate requires an SSID', () => {
  assert.deepEqual(levels(wqr.validate({ ssid: '', security: 'nopass' }), 'ssid'), ['error']);
});

test('wifi: validate warns when the SSID exceeds 32 bytes', () => {
  // 16 Cyrillic letters = 32 bytes (ok); 17 = 34 bytes (warn)
  assert.deepEqual(levels(wqr.validate({ ssid: 'К'.repeat(16), security: 'nopass' }), 'ssid'), []);
  const msgs = wqr.validate({ ssid: 'К'.repeat(17), security: 'nopass' });
  assert.deepEqual(levels(msgs, 'ssid'), ['warn']);
  assert.match(msgs[0].text, /34 bytes/);
});

test('wifi: validate warns about leading/trailing spaces', () => {
  const msgs = wqr.validate({ ssid: ' Home ', security: 'wpa', password: ' secret12 ' });
  assert.deepEqual(levels(msgs, 'ssid'), ['warn']);
  assert.ok(levels(msgs, 'password').includes('warn'));
});

test('wifi: validate requires a password for secured networks', () => {
  for (const security of ['wpa', 'wpa3', 'wep']) {
    const msgs = wqr.validate({ ssid: 'Home', security, password: '' });
    assert.deepEqual(levels(msgs, 'password'), ['error'], security);
  }
});

test('wifi: validate accepts an open network without a password', () => {
  const msgs = wqr.validate({ ssid: 'Guest', security: 'nopass', password: '' });
  assert.ok(!msgs.some((m) => m.level === 'error'));
  assert.deepEqual(levels(msgs, 'security'), ['info']);
});

test('wifi: validate checks WPA2 passphrase length 8–63', () => {
  assert.deepEqual(levels(wqr.validate({ ssid: 'H', security: 'wpa', password: '1234567' }), 'password'), ['warn']);
  assert.deepEqual(levels(wqr.validate({ ssid: 'H', security: 'wpa', password: '12345678' }), 'password'), []);
  assert.deepEqual(levels(wqr.validate({ ssid: 'H', security: 'wpa', password: 'x'.repeat(63) }), 'password'), []);
  assert.deepEqual(levels(wqr.validate({ ssid: 'H', security: 'wpa', password: 'x'.repeat(64) }), 'password'), ['warn']);
});

test('wifi: validate treats 64 hex digits as a raw WPA key', () => {
  const msgs = wqr.validate({ ssid: 'H', security: 'wpa', password: 'a1'.repeat(32) });
  assert.deepEqual(levels(msgs, 'password'), ['info']);
});

test('wifi: validate warns about non-ASCII WPA2 passphrases but not WPA3', () => {
  assert.deepEqual(levels(wqr.validate({ ssid: 'H', security: 'wpa', password: 'пароль1234' }), 'password'), ['warn']);
  assert.deepEqual(levels(wqr.validate({ ssid: 'H', security: 'wpa3', password: 'пароль1234' }), 'password'), []);
});

test('wifi: validate warns about short WPA3 passwords', () => {
  assert.deepEqual(levels(wqr.validate({ ssid: 'H', security: 'wpa3', password: 'short' }), 'password'), ['warn']);
  assert.deepEqual(levels(wqr.validate({ ssid: 'H', security: 'wpa3', password: 'x'.repeat(80) }), 'password'), []);
});

test('wifi: validate checks WEP key lengths and always flags WEP', () => {
  for (const key of ['abcde', 'abcdefghijklm', '0123456789', 'ab'.repeat(13)]) {
    const msgs = wqr.validate({ ssid: 'H', security: 'wep', password: key });
    assert.deepEqual(levels(msgs, 'password'), [], key);
    assert.deepEqual(levels(msgs, 'security'), ['warn'], key);
  }
  assert.deepEqual(levels(wqr.validate({ ssid: 'H', security: 'wep', password: 'abcdef' }), 'password'), ['warn']);
});

test('wifi: validate notes hidden networks', () => {
  const msgs = wqr.validate({ ssid: 'H', security: 'wpa', password: '12345678', hidden: true });
  assert.deepEqual(levels(msgs, 'hidden'), ['info']);
});

// ── buildSvg ─────────────────────────────────────────────

test('wifi: buildSvg merges dark runs and applies the quiet zone', () => {
  const matrix = {
    count: 3,
    modules: [
      [true, true, false],
      [false, true, false],
      [true, false, true]
    ]
  };
  const svg = wqr.buildSvg(matrix, 4);
  assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(svg, /viewBox="0 0 11 11"/);
  assert.match(svg, /width="110" height="110"/);
  assert.match(svg, /d="M4 4h2v1h-2zM5 5h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1z"/);
  assert.match(svg, /<rect width="11" height="11" fill="#ffffff"\/>/);
});

test('wifi: buildSvg supports a zero quiet zone and custom pixel size', () => {
  const matrix = { count: 2, modules: [[true, true], [true, true]] };
  const svg = wqr.buildSvg(matrix, 0, 512);
  assert.match(svg, /viewBox="0 0 2 2"/);
  assert.match(svg, /width="512" height="512"/);
  assert.match(svg, /d="M0 0h2v1h-2zM0 1h2v1h-2z"/);
});

// ── fileSlug ─────────────────────────────────────────────

test('wifi: fileSlug produces safe ASCII file names', () => {
  assert.equal(wqr.fileSlug('My Home Wi-Fi!'), 'my-home-wi-fi');
  assert.equal(wqr.fileSlug('  __Office 5G__ '), 'office-5g');
  assert.equal(wqr.fileSlug('Кава'), '');
  assert.equal(wqr.fileSlug(null), '');
  assert.ok(wqr.fileSlug('a'.repeat(100)).length <= 40);
  assert.ok(!wqr.fileSlug('abcdefghij-'.repeat(5)).endsWith('-'));
});

// ── printLayout ──────────────────────────────────────────

test('wifi: printLayout fits every grid on A4 and Letter', () => {
  for (const aspect of [1.3, 1.46, 1.7]) {
    for (const copies of [1, 2, 4, 6]) {
      const l = wqr.printLayout(copies, aspect);
      assert.equal(l.count, copies);
      assert.ok(l.cols * l.width + (l.cols - 1) * l.gap <= 194, `width ${copies}@${aspect}`);
      assert.ok(l.rows * l.width * aspect + (l.rows - 1) * l.gap <= 263, `height ${copies}@${aspect}`);
      assert.ok(l.width > 40, `readable ${copies}@${aspect}`);
    }
  }
});

test('wifi: printLayout caps a single card and falls back to 1 copy', () => {
  assert.equal(wqr.printLayout(1, 1.46).width, 130);
  assert.equal(wqr.printLayout(3, 1.46).count, 1);
  assert.equal(wqr.printLayout(6, 1.46).cols, 3);
});
