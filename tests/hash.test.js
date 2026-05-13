// tests/hash.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadScript } = require('./_setup');

const hsg = loadScript('hash-generator-for-files-and-text/script.js');

function nodeMd5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

function nodeMd5Buffer(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

test('hash: md5String empty string', () => {
  assert.equal(hsg.md5String(''), 'd41d8cd98f00b204e9800998ecf8427e');
});

test('hash: md5String "a"', () => {
  assert.equal(hsg.md5String('a'), '0cc175b9c0f1b6a831c399e269772661');
});

test('hash: md5String "abc"', () => {
  assert.equal(hsg.md5String('abc'), '900150983cd24fb0d6963f7d28e17f72');
});

test('hash: md5String "message digest"', () => {
  assert.equal(hsg.md5String('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
});

test('hash: md5String "abcdefghijklmnopqrstuvwxyz"', () => {
  assert.equal(hsg.md5String('abcdefghijklmnopqrstuvwxyz'), 'c3fcd3d76192e4007dfb496cca67e13b');
});

test('hash: md5String matches Node crypto for various strings', () => {
  const samples = [
    '',
    'hello world',
    'The quick brown fox jumps over the lazy dog',
    'multi\nline\ntext',
    'Тест на українській', // unicode
    'a'.repeat(64),
    'b'.repeat(63),
    'c'.repeat(65),
    'd'.repeat(120),
    'e'.repeat(1000)
  ];
  for (const s of samples) {
    assert.equal(hsg.md5String(s), nodeMd5(s), `mismatch for ${JSON.stringify(s.slice(0, 30))}`);
  }
});

test('hash: md5Buffer matches Node crypto for binary data', () => {
  const buf = Buffer.from([0, 1, 2, 3, 0x80, 0xFF, 0x00, 0xAA]);
  // pass underlying ArrayBuffer
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  assert.equal(hsg.md5Buffer(ab), nodeMd5Buffer(buf));
});

test('hash: md5Buffer matches Node crypto for large random data', () => {
  const data = crypto.randomBytes(10000);
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  assert.equal(hsg.md5Buffer(ab), nodeMd5Buffer(data));
});

test('hash: LENGTH_MAP maps hex length → algorithm', () => {
  assert.equal(hsg.LENGTH_MAP[32], 'md5');
  assert.equal(hsg.LENGTH_MAP[40], 'sha1');
  assert.equal(hsg.LENGTH_MAP[64], 'sha256');
  assert.equal(hsg.LENGTH_MAP[128], 'sha512');
});
