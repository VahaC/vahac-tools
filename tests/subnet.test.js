// tests/subnet.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const snc = loadScript('subnet-calculator/script.js');

test('subnet: ipToLong known values', () => {
  assert.equal(snc.ipToLong('0.0.0.0'), 0);
  assert.equal(snc.ipToLong('255.255.255.255'), 0xFFFFFFFF);
  assert.equal(snc.ipToLong('192.168.1.1'), (192 << 24 | 168 << 16 | 1 << 8 | 1) >>> 0);
  assert.equal(snc.ipToLong('10.0.0.1'), 167772161);
});

test('subnet: longToIp round-trip', () => {
  const ips = ['0.0.0.0', '255.255.255.255', '192.168.1.1', '10.0.0.1', '8.8.8.8', '172.16.31.254'];
  for (const ip of ips) {
    assert.equal(snc.longToIp(snc.ipToLong(ip)), ip);
  }
});

test('subnet: longToBinary formats 8-bit groups with dots', () => {
  assert.equal(snc.longToBinary(0), '00000000.00000000.00000000.00000000');
  assert.equal(snc.longToBinary(0xFFFFFFFF), '11111111.11111111.11111111.11111111');
  assert.equal(snc.longToBinary(snc.ipToLong('192.168.1.1')),
    '11000000.10101000.00000001.00000001');
});

test('subnet: getIpClass returns A-E', () => {
  assert.equal(snc.getIpClass(0), 'A');
  assert.equal(snc.getIpClass(127), 'A');
  assert.equal(snc.getIpClass(128), 'B');
  assert.equal(snc.getIpClass(191), 'B');
  assert.equal(snc.getIpClass(192), 'C');
  assert.equal(snc.getIpClass(223), 'C');
  assert.equal(snc.getIpClass(224), 'D (Multicast)');
  assert.equal(snc.getIpClass(239), 'D (Multicast)');
  assert.equal(snc.getIpClass(240), 'E (Reserved)');
  assert.equal(snc.getIpClass(255), 'E (Reserved)');
});

test('subnet: getIpType detects loopback', () => {
  const r = snc.getIpType(snc.ipToLong('127.0.0.1'));
  assert.equal(r.type, 'Loopback');
});

test('subnet: getIpType detects link-local 169.254.x.x', () => {
  const r = snc.getIpType(snc.ipToLong('169.254.1.1'));
  assert.equal(r.type, 'Link-Local');
});

test('subnet: getIpType detects RFC1918 ranges', () => {
  assert.equal(snc.getIpType(snc.ipToLong('10.5.5.5')).type, 'Private (RFC 1918)');
  assert.equal(snc.getIpType(snc.ipToLong('192.168.1.1')).type, 'Private (RFC 1918)');
  assert.equal(snc.getIpType(snc.ipToLong('172.16.0.1')).type, 'Private (RFC 1918)');
  assert.equal(snc.getIpType(snc.ipToLong('172.31.255.255')).type, 'Private (RFC 1918)');
});

test('subnet: getIpType detects 172.32.x.x as Public (boundary)', () => {
  assert.equal(snc.getIpType(snc.ipToLong('172.32.0.0')).type, 'Public');
  assert.equal(snc.getIpType(snc.ipToLong('172.15.0.0')).type, 'Public');
});

test('subnet: getIpType detects public IPs', () => {
  assert.equal(snc.getIpType(snc.ipToLong('8.8.8.8')).type, 'Public');
  assert.equal(snc.getIpType(snc.ipToLong('1.1.1.1')).type, 'Public');
});

test('subnet: validateIp accepts good IPs', () => {
  assert.equal(snc.validateIp('0.0.0.0'), true);
  assert.equal(snc.validateIp('255.255.255.255'), true);
  assert.equal(snc.validateIp('192.168.1.1'), true);
});

test('subnet: validateIp rejects bad IPs', () => {
  assert.equal(snc.validateIp('256.0.0.0'), false);
  assert.equal(snc.validateIp('1.2.3'), false);
  assert.equal(snc.validateIp('1.2.3.4.5'), false);
  assert.equal(snc.validateIp('1.2.3.a'), false);
  assert.equal(snc.validateIp(''), false);
  assert.equal(snc.validateIp('192.168.01.1'), false); // leading zero
  assert.equal(snc.validateIp('192.168.1.-1'), false);
  assert.equal(snc.validateIp('192.168.1. 1'), false);
});

test('subnet: mask math for /24 produces 255.255.255.0', () => {
  const cidr = 24;
  const mask = (~0 << (32 - cidr)) >>> 0;
  assert.equal(snc.longToIp(mask), '255.255.255.0');
});

test('subnet: mask math for /32 is all-ones', () => {
  const cidr = 32;
  const mask = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
  assert.equal(mask, 0xFFFFFFFF);
});

test('subnet: mask math for /0 is zero', () => {
  const cidr = 0;
  const mask = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
  assert.equal(mask, 0);
});

test('subnet: network/broadcast for 192.168.1.50/24', () => {
  const ipLong = snc.ipToLong('192.168.1.50');
  const mask = (~0 << 8) >>> 0;
  const network = (ipLong & mask) >>> 0;
  const wildcard = (~mask) >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  assert.equal(snc.longToIp(network), '192.168.1.0');
  assert.equal(snc.longToIp(broadcast), '192.168.1.255');
  assert.equal(snc.longToIp(wildcard), '0.0.0.255');
});
