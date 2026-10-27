// tests/open-graph-meta-generator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript } = require('./_setup');

const ogm = loadScript('open-graph-meta-generator/script.js');

const CMT_OPEN = '<' + '!--';
const CMT_CLOSE = '--' + '>';
const SCRIPT_END = '<' + '/script>';

const state = (over) => Object.assign(ogm.blankState(), over || {});
const build = (over) => ogm.buildOutput(state(over));
const lines = (over) => build(over).text.split('\n');
const codes = (issues) => issues.map((i) => i.code);
const text = (html) => String(html).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const find = (issues, code) => issues.find((i) => i.code === code);
const analyze = (html, page) => ogm.analyzeHead(html, page || '');
const head = (inner) => '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' + inner + '\n</head>\n<body>\n<p>x</p>\n</body>\n</html>';

const FULL = [
  '<title>Backups</title>',
  '<meta name="description" content="How to back up.">',
  '<link rel="canonical" href="https://example.com/backups/">',
  '<meta property="og:type" content="website">',
  '<meta property="og:title" content="Backups">',
  '<meta property="og:description" content="How to back up.">',
  '<meta property="og:url" content="https://example.com/backups/">',
  '<meta property="og:site_name" content="Example">',
  '<meta property="og:image" content="https://example.com/img/share.jpg">',
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta property="og:image:alt" content="A NAS on a shelf">',
  '<meta name="twitter:card" content="summary_large_image">'
];
const full = (extra, drop) => head(FULL.filter((l) => !(drop || []).some((d) => l.includes(d))).concat(extra || []).join('\n'));

// ─────────────────────────────────────────────────────────────────────────────
// Escaping
// ─────────────────────────────────────────────────────────────────────────────

test('escAttr escapes quotes, ampersands and angle brackets; escText leaves quotes alone', () => {
  assert.equal(ogm.escAttr('Tom & "Jerry" <b>'), 'Tom &amp; &quot;Jerry&quot; &lt;b&gt;');
  assert.equal(ogm.escAttr("it's"), "it's");
  assert.equal(ogm.escAttr('&amp;'), '&amp;amp;');
  assert.equal(ogm.escText('a < b & "c"'), 'a &lt; b &amp; "c"');
});

test('non-ASCII text is written as is, not as character references', () => {
  const out = build({ title: 'Café — Київ 東京 😀', desc: 'Grüße aus München', site: 'Ελληνικά' });
  assert.ok(out.text.includes('<title>Café — Київ 東京 😀</title>'));
  assert.ok(out.text.includes('<meta name="description" content="Grüße aus München">'));
  assert.ok(out.text.includes('<meta property="og:site_name" content="Ελληνικά">'));
  assert.equal(ogm.charLen('😀é'), 2, 'characters are counted by code point');
});

test('generated values with quotes, ampersands and angle brackets stay inside their attribute', () => {
  const out = build({ title: 'A "quoted" <title> & more', desc: '5 > 3 & "x"', imgAlt: 'He said "hi"', img: 'https://example.com/a.png?x=1&y=2' });
  assert.ok(out.text.includes('<title>A "quoted" &lt;title&gt; &amp; more</title>'));
  assert.ok(out.text.includes('<meta property="og:title" content="A &quot;quoted&quot; &lt;title&gt; &amp; more">'));
  assert.ok(out.text.includes('<meta name="description" content="5 &gt; 3 &amp; &quot;x&quot;">'));
  assert.ok(out.text.includes('<meta property="og:image" content="https://example.com/a.png?x=1&amp;y=2">'));
  assert.ok(out.text.includes('<meta property="og:image:alt" content="He said &quot;hi&quot;">'));
  // The analyzer reads the generated markup back to the original values
  const res = analyze(head(out.text), 'https://example.com/');
  const og = res.found.filter((f) => f.key === 'og:title')[0];
  assert.equal(og.value, 'A "quoted" <title> & more');
  assert.equal(res.found.find((f) => f.key === 'og:image').value, 'https://example.com/a.png?x=1&y=2');
});

test('control characters and line breaks collapse to single spaces; no-break spaces are kept', () => {
  const nb = String.fromCharCode(160);
  assert.equal(ogm.cleanText('  a\n\tb\r\n c' + String.fromCharCode(7) + 'd  '), 'a b c d');
  assert.equal(ogm.cleanText('Bonjour' + nb + '!'), 'Bonjour' + nb + '!');
  assert.ok(build({ desc: 'line one\nline two' }).text.includes('content="line one line two"'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Generator: every field and og:type
// ─────────────────────────────────────────────────────────────────────────────

test('default example: exact tag block, property= for Open Graph, name= for description and X', () => {
  const out = ogm.buildOutput(ogm.defaultState());
  assert.deepEqual(out.text.split('\n'), [
    '<title>Back Up a Home Server to a NAS — Example Blog</title>',
    '<meta name="description" content="A step-by-step guide to nightly backups of a home server to a NAS, with retention rules, restore tests and an alert when a job fails.">',
    '<link rel="canonical" href="https://example.com/blog/home-server-backup/">',
    ogm.htmlComment('Open Graph (ogp.me)'),
    '<meta property="og:type" content="article">',
    '<meta property="og:title" content="Back Up a Home Server to a NAS">',
    '<meta property="og:description" content="A step-by-step guide to nightly backups of a home server to a NAS, with retention rules, restore tests and an alert when a job fails.">',
    '<meta property="og:url" content="https://example.com/blog/home-server-backup/">',
    '<meta property="og:site_name" content="Example Blog">',
    '<meta property="og:locale" content="en_US">',
    '<meta property="og:image" content="https://example.com/images/home-server-backup-1200x630.jpg">',
    '<meta property="og:image:type" content="image/jpeg">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="A small home server and a NAS on a shelf, connected by a network cable">',
    '<meta property="article:published_time" content="2026-10-27T09:00:00+02:00">',
    '<meta property="article:section" content="Homelab">',
    '<meta property="article:tag" content="backup">',
    '<meta property="article:tag" content="NAS">',
    ogm.htmlComment('X (Twitter) card'),
    '<meta name="twitter:card" content="summary_large_image">'
  ]);
  assert.deepEqual(out.issues, []);
  out.tags.filter((t) => t.type === 'meta').forEach((t) => {
    assert.equal(t.attr, /^(twitter:|description$)/.test(t.key) ? 'name' : 'property', t.key);
  });
});

test('htmlComment builds the comment at runtime', () => {
  assert.equal(ogm.htmlComment('x'), CMT_OPEN + ' x ' + CMT_CLOSE);
});

test('og:type website writes no article properties even when they are filled in', () => {
  const l = lines({ title: 'T', type: 'website', pub: '2026-10-27', section: 'S', tags: 'a', author: 'https://example.com/me' });
  assert.ok(l.includes('<meta property="og:type" content="website">'));
  assert.ok(!l.some((x) => x.includes('article:')));
});

test('og:type article writes published, modified, authors, section and one tag per article:tag', () => {
  const l = lines({ title: 'T', type: 'article', pub: '2026-10-27', mod: '2026-10-28T10:00:00Z', author: 'https://example.com/a, https://example.com/b', section: 'Homelab', tags: 'zfs, backup\nnas, zfs' });
  assert.ok(l.includes('<meta property="og:type" content="article">'));
  assert.ok(l.includes('<meta property="article:published_time" content="2026-10-27">'));
  assert.ok(l.includes('<meta property="article:modified_time" content="2026-10-28T10:00:00Z">'));
  assert.deepEqual(l.filter((x) => x.includes('article:author')), [
    '<meta property="article:author" content="https://example.com/a">',
    '<meta property="article:author" content="https://example.com/b">'
  ]);
  assert.ok(l.includes('<meta property="article:section" content="Homelab">'));
  assert.deepEqual(l.filter((x) => x.includes('article:tag')).map((x) => x.match(/content="([^"]*)"/)[1]), ['zfs', 'backup', 'nas']);
});

test('share title falls back to the page title; a separate share title is used for og:title only', () => {
  let l = lines({ title: 'Page — Site' });
  assert.ok(l.includes('<meta property="og:title" content="Page — Site">'));
  l = lines({ title: 'Page — Site', ogTitle: 'Page' });
  assert.ok(l.includes('<title>Page — Site</title>'));
  assert.ok(l.includes('<meta property="og:title" content="Page">'));
});

test('canonical URL is written as link rel=canonical and og:url, normalized by the URL parser', () => {
  const l = lines({ url: 'https://Example.com/a b/' });
  assert.ok(l.includes('<link rel="canonical" href="https://example.com/a%20b/">'));
  assert.ok(l.includes('<meta property="og:url" content="https://example.com/a%20b/">'));
  assert.ok(lines({ url: 'https://example.com' }).includes('<meta property="og:url" content="https://example.com/">'));
});

test('switching off the basics leaves out title, description and canonical but keeps og: tags', () => {
  const l = lines({ basics: false, title: 'T', desc: 'D', url: 'https://example.com/' });
  assert.ok(!l.some((x) => x.startsWith('<title>') || x.includes('name="description"') || x.includes('rel="canonical"')));
  assert.ok(l.includes('<meta property="og:title" content="T">'));
  assert.ok(l.includes('<meta property="og:description" content="D">'));
  assert.ok(l.includes('<meta property="og:url" content="https://example.com/">'));
});

test('site name, locale and alternate locales', () => {
  const l = lines({ site: 'Example', locale: 'de_DE', altLocales: 'en_US, fr_FR' });
  assert.ok(l.includes('<meta property="og:site_name" content="Example">'));
  assert.ok(l.includes('<meta property="og:locale" content="de_DE">'));
  assert.deepEqual(l.filter((x) => x.includes('og:locale:alternate')), [
    '<meta property="og:locale:alternate" content="en_US">',
    '<meta property="og:locale:alternate" content="fr_FR">'
  ]);
  assert.ok(!lines({}).some((x) => x.includes('og:locale')), 'empty locale writes no tag');
});

test('image: URL, size, alt, and the type from the extension, chosen explicitly or left out', () => {
  const base = { img: 'https://example.com/i/share.PNG?v=2', imgW: '1200', imgH: '630', imgAlt: 'A NAS' };
  let l = lines(base);
  assert.ok(l.includes('<meta property="og:image" content="https://example.com/i/share.PNG?v=2">'));
  assert.ok(l.includes('<meta property="og:image:type" content="image/png">'));
  assert.ok(l.includes('<meta property="og:image:width" content="1200">'));
  assert.ok(l.includes('<meta property="og:image:height" content="630">'));
  assert.ok(l.includes('<meta property="og:image:alt" content="A NAS">'));
  l = lines(Object.assign({}, base, { imgType: 'image/webp' }));
  assert.ok(l.includes('<meta property="og:image:type" content="image/webp">'));
  l = lines(Object.assign({}, base, { imgType: 'none' }));
  assert.ok(!l.some((x) => x.includes('og:image:type')));
  l = lines({ img: 'https://example.com/share' });
  assert.ok(!l.some((x) => x.includes('og:image:type')), 'no extension, no guessed type');
  assert.equal(ogm.guessMime('https://x.test/a.jpeg#f'), 'image/jpeg');
  assert.equal(ogm.guessMime('https://x.test/a.svg'), 'image/svg+xml');
  assert.equal(ogm.guessMime('https://x.test/a'), '');
});

test('fb:app_id is written with property= only when filled in', () => {
  assert.ok(lines({ fbapp: '1234567890' }).includes('<meta property="fb:app_id" content="1234567890">'));
  assert.ok(!lines({}).some((x) => x.includes('fb:app_id')));
});

// ─────────────────────────────────────────────────────────────────────────────
// Generator: X card choice and OG fallback
// ─────────────────────────────────────────────────────────────────────────────

test('X card: large image by default, summary on request, nothing when switched off', () => {
  assert.ok(lines({}).includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(lines({ card: 'summary' }).includes('<meta name="twitter:card" content="summary">'));
  const none = lines({ card: 'none', tsite: '@site', trepeat: true, title: 'T' });
  assert.ok(!none.some((x) => x.includes('twitter:')));
});

test('X tags rely on the Open Graph fallback unless repeating them is switched on', () => {
  const base = { title: 'T', desc: 'D', img: 'https://example.com/i.jpg', imgAlt: 'Alt' };
  const plain = lines(base);
  assert.deepEqual(plain.filter((x) => x.includes('twitter:')), ['<meta name="twitter:card" content="summary_large_image">']);
  const rep = lines(Object.assign({ trepeat: true }, base));
  assert.deepEqual(rep.filter((x) => x.includes('twitter:')), [
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="T">',
    '<meta name="twitter:description" content="D">',
    '<meta name="twitter:image" content="https://example.com/i.jpg">',
    '<meta name="twitter:image:alt" content="Alt">'
  ]);
});

test('X handles are normalized to @name from a bare name, an @name or a profile URL', () => {
  const l = lines({ tsite: 'example_site', tcreator: 'https://x.com/Jane_Doe/' });
  assert.ok(l.includes('<meta name="twitter:site" content="@example_site">'));
  assert.ok(l.includes('<meta name="twitter:creator" content="@Jane_Doe">'));
  assert.equal(ogm.normalizeHandle('https://twitter.com/abc?lang=en').value, '@abc');
  assert.equal(ogm.normalizeHandle('@abc').ok, true);
  assert.equal(ogm.normalizeHandle('@abc-def').ok, false);
  assert.equal(ogm.normalizeHandle('@a234567890123456').ok, false, '16 characters');
  assert.equal(ogm.normalizeHandle('@a23456789012345').ok, true, '15 characters');
  const out = build({ tsite: '@bad-name' });
  assert.equal(find(out.issues, 'handle-invalid').field, 'tsite');
});

test('X length notes use the documented maximums (70, 200, 420) and only when X tags are on', () => {
  const long = (n) => 'x'.repeat(n);
  assert.ok(codes(build({ title: long(70) }).issues).indexOf('x-title-long') < 0);
  assert.equal(find(build({ title: long(71) }).issues, 'x-title-long').level, 'info');
  assert.equal(find(build({ title: 'short', ogTitle: long(71) }).issues, 'x-title-long').field, 'ogtitle');
  assert.ok(codes(build({ desc: long(200) }).issues).indexOf('x-desc-long') < 0);
  assert.ok(codes(build({ desc: long(201) }).issues).indexOf('x-desc-long') >= 0);
  const img = { img: 'https://example.com/i.jpg', imgW: '1200', imgH: '630' };
  assert.ok(codes(build(Object.assign({ imgAlt: long(420) }, img)).issues).indexOf('x-alt-long') < 0);
  assert.equal(find(build(Object.assign({ imgAlt: long(421) }, img)).issues, 'x-alt-long').level, 'warning');
  assert.ok(codes(build({ title: long(80), card: 'none' }).issues).indexOf('x-title-long') < 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Generator: validation
// ─────────────────────────────────────────────────────────────────────────────

test('URL kinds: absolute, relative, scheme-relative, missing scheme, other schemes', () => {
  assert.equal(ogm.checkUrl('https://example.com/a').kind, 'absolute');
  assert.equal(ogm.checkUrl('http://example.com').scheme, 'http');
  assert.equal(ogm.checkUrl('/img/a.jpg').kind, 'relative');
  assert.equal(ogm.checkUrl('img/a.jpg').kind, 'relative');
  assert.equal(ogm.checkUrl('//cdn.example.com/a.jpg').kind, 'scheme-relative');
  assert.equal(ogm.checkUrl('example.com/a.jpg').kind, 'no-scheme');
  assert.equal(ogm.checkUrl('example.com:8080/a').kind, 'no-scheme');
  assert.equal(ogm.checkUrl('ftp://example.com/a.jpg').kind, 'other-scheme');
  assert.equal(ogm.checkUrl('data:image/png;base64,AAAA').kind, 'other-scheme');
  assert.equal(ogm.checkUrl('').kind, 'empty');
  assert.equal(ogm.checkUrl('photo.jpg').kind, 'relative', 'a file name is not a host');
  assert.equal(ogm.checkUrl('index.html?x=1').kind, 'relative');
  assert.equal(ogm.checkUrl('www.example.co.uk').kind, 'no-scheme');
  assert.equal(ogm.checkUrl('/a.jpg', 'https://example.com/blog/post/').resolved, 'https://example.com/a.jpg');
  assert.equal(ogm.checkUrl('a.jpg', 'https://example.com/blog/post/').resolved, 'https://example.com/blog/post/a.jpg');
});

test('relative og:image and og:url are errors, with the full URL as the fix', () => {
  const img = build({ img: '/wp-content/uploads/a.jpg' });
  const e = find(img.issues, 'image-not-absolute');
  assert.equal(e.level, 'error');
  assert.equal(e.field, 'img');
  assert.match(text(e.msg), /relative URL/);
  const url = build({ url: 'blog/post/' });
  assert.equal(find(url.issues, 'url-not-absolute').level, 'error');
  const sr = build({ img: '//cdn.example.com/a.jpg' });
  assert.match(text(find(sr.issues, 'image-not-absolute').fix), /https:\/\/cdn\.example\.com\/a\.jpg/);
  assert.equal(find(sr.issues, 'image-not-absolute').level, 'warning', 'scheme-relative, as in LinkedIn help examples, is a warning');
  assert.equal(find(img.issues, 'image-not-absolute').level, 'error', 'a path is an error');
  const ns = build({ url: 'example.com/post' });
  assert.match(text(find(ns.issues, 'url-not-absolute').fix), /https:\/\/example\.com\/post/);
});

test('an http image is a warning (X requires HTTPS), and mentions mixed content on an https page', () => {
  const a = find(build({ img: 'http://example.com/a.jpg' }).issues, 'image-http');
  assert.equal(a.level, 'warning');
  assert.doesNotMatch(text(a.msg), /mixed content/);
  const b = find(build({ img: 'http://example.com/a.jpg', url: 'https://example.com/' }).issues, 'image-http');
  assert.match(text(b.msg), /mixed content/);
});

test('image size: missing, invalid, below a documented minimum; missing alt; SVG; WebP; type mismatch', () => {
  const img = 'https://example.com/a.jpg';
  assert.equal(find(build({ img }).issues, 'image-no-size').level, 'warning');
  assert.equal(find(build({ img, imgW: '12OO', imgH: '630' }).issues, 'image-dims-invalid').level, 'error');
  const small = build({ img, imgW: '150', imgH: '150', imgAlt: 'a' });
  const bad = small.issues.filter((i) => i.code === 'image-check-bad').map((i) => text(i.msg));
  assert.ok(bad.some((m) => /^Meta \(Facebook\): Below the minimum allowed size of 200 x 200/.test(m)));
  assert.ok(bad.some((m) => /^X summary_large_image card: Below the minimum of 300 x 157/.test(m)));
  assert.equal(find(build({ img, imgW: '1200', imgH: '630' }).issues, 'image-no-alt').level, 'warning');
  assert.equal(find(build({ img: 'https://example.com/a.svg' }).issues, 'image-svg').level, 'error');
  assert.equal(find(build({ img: 'https://example.com/a.webp' }).issues, 'image-webp').level, 'info');
  assert.equal(find(build({ img, imgType: 'image/png' }).issues, 'image-type-mismatch').level, 'info');
  assert.equal(find(build({}).issues, 'image-missing').level, 'warning');
});

test('canonical URL: missing, fragment, tracking parameters, http', () => {
  assert.equal(find(build({}).issues, 'url-missing').level, 'warning');
  assert.equal(find(build({ url: 'https://example.com/a#top' }).issues, 'url-fragment').level, 'warning');
  const dec = find(build({ url: 'https://example.com/a?utm_source=x&fbclid=1&page=2' }).issues, 'url-decorated');
  assert.match(text(dec.msg), /utm_source and fbclid/);
  assert.deepEqual(ogm.decoratedParams('https://example.com/?gclid=1&sid=2&q=a'), ['gclid', 'sid']);
  assert.equal(find(build({ url: 'http://example.com/' }).issues, 'url-http').level, 'info');
});

test('locales, dates, authors, app ID and missing title or description', () => {
  const loc = find(build({ locale: 'en-US' }).issues, 'locale-format');
  assert.match(text(loc.msg), /did you mean en_US/);
  assert.equal(find(build({ altLocales: 'de_DE de' }).issues, 'locale-format').field, 'altlocales');
  assert.equal(find(build({ type: 'article', pub: '27/10/2026' }).issues, 'datetime-invalid').level, 'error');
  assert.equal(find(build({ type: 'article', pub: '2026-10-27T09:00' }).issues, 'datetime-no-zone').level, 'info');
  assert.equal(find(build({ type: 'article', pub: '2026-10-27', mod: '2026-10-26' }).issues, 'modified-before-published').level, 'warning');
  assert.equal(find(build({ type: 'article', author: 'Jane Doe' }).issues, 'author-not-url').level, 'info');
  assert.equal(find(build({ fbapp: 'abc' }).issues, 'fb-app-id-invalid').level, 'error');
  assert.equal(find(build({}).issues, 'title-missing').level, 'warning');
  assert.equal(find(build({}).issues, 'desc-missing').level, 'warning');
  assert.equal(find(build({ ogTitle: 'Only share title' }).issues, 'title-basic-missing').level, 'info');
});

test('issues are sorted errors first, then warnings, then notes', () => {
  const out = build({ img: '/a.jpg', url: 'http://example.com/', fbapp: 'x' });
  const order = out.issues.map((i) => ({ error: 0, warning: 1, info: 2 })[i.level]);
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
});

// ─────────────────────────────────────────────────────────────────────────────
// Values
// ─────────────────────────────────────────────────────────────────────────────

test('ISO 8601 dates as ogp.me DateTime', () => {
  ['2026-10-27', '2026-10-27T09:00', '2026-10-27T09:00:00Z', '2026-10-27T09:00:00.123+02:00', '2026-10-27T09:00:00-0530', '2024-02-29'].forEach((v) => {
    assert.equal(ogm.parseDateTime(v).ok, true, v);
  });
  ['27/10/2026', '2026-13-01', '2026-02-29', '2026-10-27T24:00', '2026-10-27 09:00', '20261027', '2026-10-27T09:00+15:00', ''].forEach((v) => {
    assert.equal(ogm.parseDateTime(v).ok, false, v);
  });
  const a = ogm.parseDateTime('2026-10-27T09:00:00+02:00'), b = ogm.parseDateTime('2026-10-27T07:00:00Z');
  assert.equal(a.time, b.time);
  assert.equal(ogm.parseDateTime('2026-10-27').hasTime, false);
  assert.equal(ogm.parseDateTime('2026-10-27T09:00').hasZone, false);
  assert.match(ogm.nowIso(new Date(2026, 9, 27, 9, 5, 7)), /^2026-10-27T09:05:07[+-]\d{2}:\d{2}$/);
});

test('og:locale language_TERRITORY with suggestions', () => {
  assert.equal(ogm.checkLocale('en_US').ok, true);
  assert.equal(ogm.checkLocale('fil_PH').ok, true);
  assert.equal(ogm.checkLocale('en-us').suggest, 'en_US');
  assert.equal(ogm.checkLocale('EN_gb').suggest, 'en_GB');
  assert.equal(ogm.checkLocale('en').ok, false);
  assert.equal(ogm.checkLocale('').ok, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Image checks against the documented recommendations
// ─────────────────────────────────────────────────────────────────────────────

const ic = (info, card) => {
  const groups = ogm.imageChecks(info, card || 'summary_large_image');
  const by = {};
  groups.forEach((g) => { by[g.id] = g.items.map((i) => i.status); });
  return { groups, by };
};

test('1200 x 630 PNG under 5 MB passes Meta, X large image and LinkedIn', () => {
  const r = ic({ width: 1200, height: 630, bytes: 250000, mime: 'image/png' });
  assert.deepEqual(r.by.meta, ['ok', 'ok', 'ok', 'ok']);
  assert.deepEqual(r.by.x, ['ok', 'ok', 'ok', 'ok']);
  assert.deepEqual(r.by.linkedin, ['ok', 'ok', 'ok']);
  assert.equal(r.groups[1].platform, 'X summary_large_image card');
});

test('Meta size tiers: 200 x 200 minimum, 600 x 315 for large posts, 1200 x 630 recommended', () => {
  assert.equal(ic({ width: 199, height: 400 }).by.meta[0], 'bad');
  assert.equal(ic({ width: 600, height: 315 }).by.meta[0], 'warn');
  assert.equal(ic({ width: 599, height: 315 }).by.meta[0], 'warn');
  assert.match(ic({ width: 599, height: 315 }).groups[0].items[0].text, /much smaller/);
  assert.equal(ic({ width: 1200, height: 630 }).by.meta[0], 'ok');
  assert.equal(ic({ width: 1200, height: 629 }).by.meta[0], 'warn');
});

test('aspect ratios: 1.91:1 for Meta and LinkedIn, 2:1 for X large, square for X summary (5% tolerance)', () => {
  const wide = ic({ width: 1200, height: 600 });
  assert.equal(wide.by.meta[1], 'ok', '2:1 is within 5% of 1.91:1');
  assert.equal(wide.by.x[1], 'ok');
  const sq = ic({ width: 1000, height: 1000 });
  assert.equal(sq.by.meta[1], 'warn');
  assert.equal(sq.by.x[1], 'warn');
  assert.equal(sq.by.linkedin[1], 'warn');
  const sum = ic({ width: 1000, height: 1000 }, 'summary');
  assert.equal(sum.groups[1].platform, 'X summary card');
  assert.equal(sum.by.x[1], 'ok');
  assert.equal(ic({ width: 1200, height: 630 }, 'summary').by.x[1], 'info', 'cropped to a square');
});

test('X pixel limits: 300 x 157 or 144 x 144 minimum, 4096 x 4096 maximum', () => {
  assert.equal(ic({ width: 300, height: 157 }).by.x[0], 'ok');
  assert.equal(ic({ width: 299, height: 157 }).by.x[0], 'bad');
  assert.equal(ic({ width: 144, height: 144 }, 'summary').by.x[0], 'ok');
  assert.equal(ic({ width: 143, height: 144 }, 'summary').by.x[0], 'bad');
  assert.equal(ic({ width: 4096, height: 2048 }).by.x[0], 'ok');
  assert.equal(ic({ width: 4097, height: 2048 }).by.x[0], 'bad');
});

test('file sizes: Meta 8 MB, X less than 5 MB, LinkedIn 5 MB maximum (MB as millions of bytes)', () => {
  const at5 = ic({ width: 1200, height: 630, bytes: 5000000 });
  assert.equal(at5.by.x[2], 'bad', 'X needs less than 5 MB');
  assert.equal(at5.by.linkedin[2], 'ok', 'LinkedIn allows 5 MB');
  assert.equal(at5.by.meta[2], 'ok');
  const over = ic({ width: 1200, height: 630, bytes: 8000001 });
  assert.equal(over.by.meta[2], 'bad');
  assert.equal(over.by.linkedin[2], 'bad');
});

test('LinkedIn: 1200 x 627 minimum and thumbnails under 401 pixels wide', () => {
  assert.equal(ic({ width: 1200, height: 627 }).by.linkedin[0], 'ok');
  assert.equal(ic({ width: 1199, height: 627 }).by.linkedin[0], 'warn');
  const thumb = ic({ width: 400, height: 210 });
  assert.equal(thumb.by.linkedin[1], 'warn');
  assert.match(thumb.groups[2].items[1].text, /thumbnail/);
  assert.equal(ic({ width: 401, height: 210 }).by.linkedin.length, 2);
});

test('image types: SVG fails on X, WebP is a note for Meta, GIF uses the first frame', () => {
  assert.equal(ic({ mime: 'image/svg+xml' }).by.x[0], 'bad');
  assert.equal(ic({ mime: 'image/svg+xml' }).by.meta[0], 'warn');
  assert.deepEqual(ic({ mime: 'image/webp' }).by.meta, ['info']);
  assert.deepEqual(ic({ mime: 'image/webp' }).by.x, ['ok']);
  assert.deepEqual(ic({ mime: 'image/gif' }).by.x, ['info']);
  assert.deepEqual(ic({ mime: 'image/avif' }).by.x, ['warn']);
  assert.deepEqual(ic({}).by.meta, [], 'nothing to check without a size or type');
});

// ─────────────────────────────────────────────────────────────────────────────
// HTML scanning
// ─────────────────────────────────────────────────────────────────────────────

test('character references in attribute values and titles are decoded', () => {
  assert.equal(ogm.decodeEntities('Tom &amp; Jerry &quot;x&quot; &#39;y&#39; &#x27;z&#x27; caf&eacute; &hellip; &#128512;'),
    'Tom & Jerry "x" \'y\' \'z\' café … 😀');
  assert.equal(ogm.decodeEntities('&unknown; &amp'), '&unknown; &amp');
  assert.equal(ogm.decodeEntities('&#0;').charCodeAt(0), 0xfffd);
});

test('attribute syntax: double, single and unquoted values, empty attributes, case, duplicates', () => {
  const p = (s) => ogm.parseAttrs(s, 0);
  let r = p(' property="og:title" content=\'A "b"\' data-x=plain disabled CONTENT2=Z>');
  assert.equal(r.attrs.property, 'og:title');
  assert.equal(r.attrs.content, 'A "b"');
  assert.equal(r.attrs['data-x'], 'plain');
  assert.equal(r.attrs.disabled, '');
  assert.equal(r.attrs.content2, 'Z');
  r = p(' name="a" name="b" content = "c" />');
  assert.equal(r.attrs.name, 'a', 'the first of two equal attributes wins');
  assert.deepEqual(r.dups, ['name']);
  assert.equal(r.attrs.content, 'c');
  assert.equal(p(' content="a &amp; b">').attrs.content, 'a & b');
});

test('scanning skips comments, scripts and styles and reads the title text', () => {
  const html = '<head>' + CMT_OPEN + ' <meta property="og:title" content="in comment"> ' + CMT_CLOSE +
    '<script>var s = \'<meta property="og:title" content="in script">\';' + SCRIPT_END +
    '<style>.a::after { content: "<title>x</title>"; }</style>' +
    '<title>Fish &amp; Chips</title><meta property="og:title" content="real"></head>';
  const scan = ogm.scanHtml(html);
  const metas = scan.elements.filter((e) => e.tag === 'meta');
  assert.equal(metas.length, 1);
  assert.equal(metas[0].attrs.content, 'real');
  assert.equal(scan.elements.find((e) => e.tag === 'title').text, 'Fish & Chips');
  assert.equal(scan.bodyAt, -1);
});

test('the body starts at <body>, at a non-head element or at text; a pixel inside head noscript does not start it', () => {
  assert.ok(ogm.scanHtml('<head></head><body><meta name="a" content="b">').elements[0].inBody);
  assert.ok(ogm.scanHtml('<head><div></div><meta name="a" content="b">').elements[0].inBody);
  assert.ok(ogm.scanHtml('<head>hello<meta name="a" content="b">').elements[0].inBody);
  assert.equal(ogm.scanHtml('<head><noscript><img src="p.gif"></noscript><meta name="a" content="b"></head>').elements[0].inBody, false);
  assert.equal(ogm.scanHtml('<head>\n  <meta name="a" content="b">').elements[0].inBody, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Head analyzer
// ─────────────────────────────────────────────────────────────────────────────

test('a complete head and the generator example have no problems', () => {
  const r = analyze(full());
  assert.deepEqual(r.issues, []);
  assert.equal(r.found.length, 13);
  const g = analyze(ogm.example('good'));
  assert.deepEqual(g.issues, []);
  assert.equal(g.pageUrl, 'https://example.com/blog/home-server-backup/');
});

test('nothing recognisable pasted', () => {
  const r = analyze('just some text');
  assert.equal(r.empty, true);
  assert.deepEqual(codes(r.issues), ['nothing-found']);
});

test('missing tags: title, description, canonical, the four og: basics, og:description and twitter:card', () => {
  const r = analyze(head('<meta property="og:locale" content="en_US">'));
  const c = codes(r.issues);
  ['title-missing', 'desc-missing', 'canonical-missing', 'x-card-missing'].forEach((x) => assert.ok(c.indexOf(x) >= 0, x));
  const og = r.issues.filter((i) => i.code === 'og-missing').map((i) => text(i.msg).split(' ')[0]);
  assert.deepEqual(og, ['og:title', 'og:image', 'og:url', 'og:description', 'og:type', 'og:site_name']);
  assert.equal(find(r.issues, 'x-card-missing').level, 'warning');
  const bare = analyze(ogm.example('bare'));
  assert.equal(bare.counts.error, 0);
  assert.equal(bare.counts.warning, 5);
});

test('X falls back to Open Graph: no twitter:card with og:type, og:title and og:description may give a summary card', () => {
  const r = analyze(full([], ['twitter:card']));
  const i = find(r.issues, 'x-card-missing');
  assert.equal(i.level, 'info');
  const x = r.platforms.find((p) => p.name === 'X');
  assert.equal(x.rows[0].value, 'summary (may be rendered)');
  assert.equal(x.rows[1].value, 'Backups');
  assert.equal(x.rows[1].from, 'og:title');
  assert.equal(x.rows[3].value, 'https://example.com/img/share.jpg');
  assert.equal(x.rows[4].value, 'A NAS on a shelf');
  const own = analyze(full(['<meta name="twitter:title" content="X title">', '<meta name="twitter:image:alt" content="X alt">']));
  const ox = own.platforms.find((p) => p.name === 'X');
  assert.equal(ox.rows[1].value, 'X title');
  assert.equal(ox.rows[1].from, 'twitter:title');
  assert.equal(ox.rows[4].value, 'X alt');
});

test('duplicates: identical values are a note, different values a warning where the first og: value wins', () => {
  const same = analyze(full(['<meta property="og:title" content="Backups">']));
  assert.equal(find(same.issues, 'dup-same').level, 'info');
  const diff = analyze(full(['<meta property="og:title" content="Other title">']));
  const d = find(diff.issues, 'dup-conflict');
  assert.equal(d.level, 'warning');
  assert.match(text(d.msg), /first value preference, so Backups wins/);
  assert.equal(diff.platforms.find((p) => p.name === 'Meta (Facebook)').rows[0].value, 'Backups');
});

test('twitter:card twice with different values: X uses the last one', () => {
  const r = analyze(full(['<meta name="twitter:card" content="summary">']));
  const w = find(r.issues, 'x-card-multiple');
  assert.equal(w.level, 'warning');
  assert.match(text(w.msg), /X uses the last one, summary\./);
  assert.equal(r.platforms.find((p) => p.name === 'X').rows[0].value, 'summary');
});

test('multiple titles, descriptions and canonical links', () => {
  const r = analyze(full(['<title>Two</title>', '<meta name="description" content="Two">', '<link rel="canonical" href="https://example.com/other/">']));
  assert.equal(find(r.issues, 'title-multiple').level, 'error');
  assert.equal(find(r.issues, 'desc-multiple').level, 'error');
  assert.equal(find(r.issues, 'canonical-multiple').level, 'error');
  const same = analyze(full(['<link rel="canonical" href="https://example.com/backups/">']));
  assert.equal(find(same.issues, 'canonical-duplicate').level, 'info');
});

test('og:image without width, height or alt; structured properties grouped as ogp.me describes', () => {
  const r = analyze(full([], ['og:image:width', 'og:image:alt']));
  assert.match(text(find(r.issues, 'image-no-size').msg), /has no og:image:width\./);
  assert.equal(find(r.issues, 'image-no-alt').level, 'warning');
  // The ogp.me example: three images, the first 300x300, the last 1000 px tall
  const ex = analyze(head([
    '<meta property="og:image" content="https://example.com/rock.jpg">',
    '<meta property="og:image:width" content="300">',
    '<meta property="og:image:height" content="300">',
    '<meta property="og:image" content="https://example.com/rock2.jpg">',
    '<meta property="og:image" content="https://example.com/rock3.jpg">',
    '<meta property="og:image:height" content="1000">'
  ].join('\n')));
  const noSize = ex.issues.filter((i) => i.code === 'image-no-size').map((i) => text(i.msg));
  assert.equal(noSize.length, 2);
  assert.match(noSize[0], /^og:image 2 \(line 8\) has no og:image:width and og:image:height/);
  assert.match(noSize[1], /^og:image 3 \(line 9\) has no og:image:width\./);
  assert.match(text(find(ex.issues, 'image-multiple').msg), /3 images.*first, https:\/\/example\.com\/rock\.jpg, preference/);
  assert.equal(ex.values.imgW, '300');
});

test('a structured image property before any og:image belongs to no image', () => {
  const r = analyze(full().replace('<meta property="og:image" content', '<meta property="og:image:width" content="5">\n<meta property="og:image" content'));
  assert.equal(find(r.issues, 'image-orphan-prop').level, 'warning');
});

test('an http image on an https page is mixed content; secure_url must be https', () => {
  const r = analyze(full([], []).replace('https://example.com/img/share.jpg', 'http://example.com/img/share.jpg'));
  const i = find(r.issues, 'image-http');
  assert.equal(i.level, 'warning');
  assert.match(text(i.msg), /X's developer policy requires HTTPS.*on an https page the image is mixed content/);
  const http = analyze(full([], []).replace(/https:\/\/example\.com/g, 'http://example.com'));
  assert.doesNotMatch(text(find(http.issues, 'image-http').msg), /mixed content/);
  // A structured property belongs to the latest og:image, even with other tags in between
  const s = analyze(full(['<meta property="og:image:secure_url" content="http://example.com/a.jpg">']));
  assert.equal(find(s.issues, 'secure-url-not-https').level, 'warning');
  const ok = analyze(full(['<meta property="og:image:secure_url" content="https://example.com/a.jpg">']));
  assert.ok(codes(ok.issues).indexOf('secure-url-not-https') < 0);
});

test('canonical link and og:url that differ are reported with what differs', () => {
  const r = analyze(full([], []).replace('<meta property="og:url" content="https://example.com/backups/">', '<meta property="og:url" content="http://www.example.com/backups">'));
  const m = find(r.issues, 'og-url-canonical-mismatch');
  assert.equal(m.level, 'warning');
  assert.match(text(m.msg), /\(http versus https, host www\.example\.com versus example\.com, trailing slash\)/);
  assert.deepEqual(ogm.urlDiff('https://a.test/x?y=1', 'https://a.test/x'), ['query string']);
  assert.deepEqual(ogm.urlDiff('https://a.test/x', 'https://a.test/z'), ['path']);
});

test('relative og:url, og:image and canonical, resolved against the page address or <base>', () => {
  const html = head([
    '<base href="https://cdn.example.com/site/">',
    '<link rel="canonical" href="/backups/">',
    '<meta property="og:url" content="/backups/">',
    '<meta property="og:image" content="img/share.jpg">'
  ].join('\n'));
  const r = analyze(html, 'https://example.com/backups/');
  assert.equal(find(r.issues, 'og-url-not-absolute').level, 'error');
  assert.match(text(find(r.issues, 'og-url-not-absolute').fix), /https:\/\/cdn\.example\.com\/backups\//);
  const img = find(r.issues, 'image-not-absolute');
  assert.equal(img.level, 'error');
  assert.match(text(img.fix), /https:\/\/cdn\.example\.com\/site\/img\/share\.jpg/);
  assert.equal(find(r.issues, 'canonical-not-absolute').level, 'warning');
  assert.equal(r.pageUrl, 'https://example.com/backups/');
});

test('property versus name: og: with name= is a warning, twitter: with property= a note', () => {
  const r = analyze(full(['<meta name="og:site_name" content="Example">'], ['og:site_name']));
  const w = find(r.issues, 'og-name-attr');
  assert.equal(w.level, 'warning');
  assert.match(text(w.msg), /1 Open Graph tag uses name= instead of property= \(og:site_name on line \d+\)/);
  const x = analyze(full(['<meta property="twitter:site" content="@example">']));
  assert.equal(find(x.issues, 'x-property-attr').level, 'info');
  assert.ok(codes(x.issues).indexOf('og-name-attr') < 0);
  const f = analyze(full(['<meta name="fb:app_id" content="123">']));
  assert.ok(codes(f.issues).indexOf('og-name-attr') >= 0, 'fb:app_id uses property= too');
});

test('meta tags without content, empty values, uppercase names and repeated attributes', () => {
  const r = analyze(full(['<meta property="og:locale">', '<meta property="og:determiner" content="">', '<meta property="OG:Site_Name" content="Example">', '<meta property="article:tag" property="x" content="a">']));
  assert.equal(find(r.issues, 'meta-no-content').level, 'warning');
  assert.equal(find(r.issues, 'meta-empty').level, 'warning');
  assert.equal(find(r.issues, 'key-case').level, 'info');
  assert.equal(find(r.issues, 'dup-attr').level, 'info');
});

test('tags after the body starts, and a canonical link outside the head', () => {
  const r = analyze(full() + '\n<meta property="og:locale" content="en_US">\n<link rel="canonical" href="https://example.com/backups/">');
  assert.match(text(find(r.issues, 'tags-in-body').msg), /^1 social tag comes after the page body starts \(first og:locale on line \d+\)/);
  assert.equal(find(r.issues, 'canonical-in-body').level, 'warning');
});

test('misspelt and unknown properties', () => {
  const r = analyze(full(['<meta property="og:titel" content="x">', '<meta name="twitter:imgae" content="x">', '<meta property="og:updated_time" content="2026-10-27">']));
  const u = r.issues.filter((i) => i.code === 'unknown-property').map((i) => ({ level: i.level, msg: text(i.msg) }));
  assert.equal(u.length, 3);
  assert.equal(u[0].level, 'warning');
  assert.match(u[0].msg, /og:titel .*did you mean og:title\?/);
  assert.match(u[1].msg, /twitter:imgae .*did you mean twitter:image\?/);
  assert.equal(u[2].level, 'info');
});

test('og:type: unknown, wrong case, custom namespace, and article: properties on a website', () => {
  assert.match(text(find(analyze(full([], ['og:type']).replace('<meta property="og:title"', '<meta property="og:type" content="articel">\n<meta property="og:title"')).issues, 'og-type-unknown').msg), /did you mean article/);
  assert.equal(find(analyze(full([], ['og:type']).replace('<meta property="og:title"', '<meta property="og:type" content="Article">\n<meta property="og:title"')).issues, 'og-type-case').level, 'warning');
  assert.equal(find(analyze(full([], ['og:type']).replace('<meta property="og:title"', '<meta property="og:type" content="my_ns:thing">\n<meta property="og:title"')).issues, 'og-type-custom').level, 'info');
  const ns = analyze(full(['<meta property="article:published_time" content="2026-10-27">']));
  assert.match(text(find(ns.issues, 'ns-type-mismatch').msg), /article:published_time belong to og:type article, but og:type is website/);
});

test('value checks: dates, integers, locales, determiner, app ID, video URLs, modified before published', () => {
  const r = analyze(full([
    '<meta property="article:published_time" content="2026-10-27T10:00:00Z">',
    '<meta property="article:modified_time" content="2026-10-26">',
    '<meta property="article:expiration_time" content="soon">',
    '<meta property="og:locale" content="en-GB">',
    '<meta property="og:determiner" content="some">',
    '<meta property="fb:app_id" content="app-1">',
    '<meta property="og:video" content="/v.mp4">',
    '<meta property="og:video:width" content="wide">'
  ]).replace('content="website"', 'content="article"'));
  const c = codes(r.issues);
  ['datetime-invalid', 'locale-format', 'determiner-invalid', 'fb-app-id-invalid', 'url-not-absolute', 'not-integer', 'modified-before-published'].forEach((x) => assert.ok(c.indexOf(x) >= 0, x));
  assert.match(text(find(r.issues, 'locale-format').msg), /did you mean en_GB/);
});

test('og:url with tracking parameters, and a canonical with a fragment or alternate attributes', () => {
  const r = analyze(full([], ['og:url', 'rel="canonical"']).replace('<meta property="og:type"', [
    '<link rel="canonical" href="https://example.com/backups/#top" media="screen">',
    '<meta property="og:url" content="https://example.com/backups/?utm_campaign=x">',
    '<meta property="og:type"'].join('\n')));
  assert.equal(find(r.issues, 'og-url-decorated').level, 'warning');
  assert.equal(find(r.issues, 'canonical-fragment').level, 'warning');
  assert.match(text(find(r.issues, 'canonical-alt-attrs').msg), /has media\./);
});

test('X card values, handles and documented lengths', () => {
  const big = analyze(full(['<meta name="twitter:site" content="example">', '<meta name="twitter:creator" content="@bad-handle">'], ['twitter:card']).replace('<meta property="og:type"', '<meta name="twitter:card" content="photo">\n<meta property="og:type"'));
  assert.equal(find(big.issues, 'x-card-deprecated').level, 'warning');
  assert.equal(find(big.issues, 'x-handle-no-at').level, 'info');
  assert.equal(find(big.issues, 'x-handle-invalid').level, 'warning');
  const inv = analyze(full([], ['twitter:card']).replace('<meta property="og:type"', '<meta name="twitter:card" content="large">\n<meta property="og:type"'));
  assert.equal(find(inv.issues, 'x-card-invalid').level, 'error');
  const long = analyze(full([], ['og:title']).replace('<meta property="og:type"', '<meta property="og:title" content="' + 'x'.repeat(71) + '">\n<meta property="og:type"'));
  assert.match(text(find(long.issues, 'x-title-long').msg), /og:title, which X uses as the title, has 71 characters/);
  const noImg = analyze(full([], ['og:image']));
  assert.equal(find(noImg.issues, 'x-large-no-image').level, 'warning');
});

test('the image size from the tags is checked against the recommendations', () => {
  const r = analyze(full([], []).replace('content="1200"', 'content="150"').replace('content="630"', 'content="150"'));
  assert.ok(r.imageChecks);
  const bad = r.issues.filter((i) => i.code === 'image-check-bad').map((i) => text(i.msg));
  assert.ok(bad.some((m) => /^Meta \(Facebook\): Below the minimum allowed size of 200 x 200/.test(m)));
  assert.ok(bad.some((m) => /^X summary_large_image card: Below the minimum of 300 x 157/.test(m)));
});

test('Open Graph tags after the first 1 MB, and pages over 2 MB', () => {
  const filler = '<script>' + 'x'.repeat(1000100) + SCRIPT_END;
  const r = analyze('<head>' + filler + FULL.join('\n') + '</head>');
  assert.equal(find(r.issues, 'og-after-1mb').level, 'warning');
  assert.ok(codes(r.issues).indexOf('page-over-2mb') < 0);
  const multi = analyze('<head>' + FULL.join('\n') + '<script>' + 'é'.repeat(1100000) + SCRIPT_END + '</head>');
  assert.ok(codes(multi.issues).indexOf('og-after-1mb') < 0, 'bytes before the tags count, not after');
  assert.equal(find(multi.issues, 'page-over-2mb').level, 'info', '1.1 million two-byte characters');
});

test('the plugin example finds the duplicated and broken tags', () => {
  const r = analyze(ogm.example('plugin'));
  const c = codes(r.issues);
  ['title-multiple', 'desc-multiple', 'image-not-absolute', 'og-name-attr', 'tags-in-body', 'dup-conflict', 'og-url-decorated',
    'og-url-canonical-mismatch', 'locale-format', 'datetime-invalid', 'image-no-size', 'image-no-alt', 'image-http',
    'x-card-multiple', 'x-handle-invalid', 'image-multiple'].forEach((x) => assert.ok(c.indexOf(x) >= 0, x));
  assert.ok(c.indexOf('unknown-property') < 0, 'the JSON-LD script is not read as tags');
  assert.deepEqual(r.counts, { error: 3, warning: 13, info: 1 });
});

test('results escape pasted values', () => {
  const r = analyze(full(['<meta property="og:site_name" content="&lt;img src=x onerror=alert(1)&gt;">'], ['og:site_name']));
  const html = ogm.renderCheckResults(r);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
  const bad = analyze(full(['<meta property="og:titel" content="x">']).replace('og:titel', 'og:&lt;b&gt;'));
  assert.ok(!ogm.renderCheckResults(bad).includes('<b>'));
});

test('analysis values open in the generator and give the same tags back', () => {
  const s = ogm.defaultState();
  s.tsite = '@example';
  s.mod = '2026-10-28';
  s.author = 'https://example.com/about/';
  s.altLocales = 'de_DE';
  const out = ogm.buildOutput(s);
  const back = ogm.stateFromAnalysis(analyze(head(out.text)));
  assert.equal(ogm.buildOutput(back).text, out.text);
  const plain = ogm.stateFromAnalysis(analyze(full()));
  assert.equal(plain.ogTitle, '', 'og:title equal to the title is not repeated');
  assert.equal(plain.type, 'website');
  assert.equal(ogm.stateFromAnalysis(analyze(ogm.example('good'))).imgType, 'auto', 'image/jpeg matches the .jpg URL');
  const png = analyze(full(['<meta property="og:image:type" content="image/png">']));
  assert.equal(ogm.stateFromAnalysis(png).imgType, 'image/png');
});

// ─────────────────────────────────────────────────────────────────────────────
// URL hash
// ─────────────────────────────────────────────────────────────────────────────

test('URL hash round-trip keeps every generator field, including special characters', () => {
  const s = {
    title: 'Café & "Quotes" #1 = 100%', ogTitle: 'Share?', desc: 'line one\nline two & more', url: 'https://example.com/a?b=1&c=2#x',
    site: 'Ελληνικά', locale: 'el_GR', altLocales: 'en_US, de_DE', basics: false, type: 'article', pub: '2026-10-27T09:00:00+02:00',
    mod: '2026-10-28', author: 'https://example.com/a, Jane', section: 'Home & Lab', tags: 'a, b', img: 'https://example.com/i.webp',
    imgW: '1200', imgH: '630', imgAlt: 'Alt "text"', imgType: 'image/webp', card: 'summary', tsite: '@site', tcreator: '@me',
    trepeat: true, fbapp: '123'
  };
  const h = ogm.encodeHash(s);
  assert.ok(ogm.isStateHash(h));
  assert.ok(!/[\s"]/.test(h), 'the hash is percent-encoded');
  assert.deepEqual(ogm.decodeHash(h), s);
  const none = Object.assign(ogm.blankState(), { card: 'none' });
  assert.deepEqual(ogm.decodeHash(ogm.encodeHash(none)), none);
  assert.deepEqual(ogm.decodeHash(ogm.encodeHash(ogm.defaultState())), ogm.defaultState());
});

test('URL hash: defaults are short, unknown values ignored, non-state hashes give the example', () => {
  assert.equal(ogm.encodeHash(ogm.blankState()), '#v=1');
  assert.deepEqual(ogm.decodeHash('#v=1'), ogm.blankState());
  const d = ogm.decodeHash('#v=1&it=image/bmp&c=weird&ty=video&zz=1&t=%E0%A4%A');
  assert.equal(d.imgType, 'auto');
  assert.equal(d.card, 'summary_large_image');
  assert.equal(d.type, 'website');
  assert.equal(d.title, '', 'malformed percent-encoding is skipped');
  assert.deepEqual(ogm.decodeHash('#section-2'), ogm.defaultState());
  assert.equal(ogm.isStateHash('#v=1&t=x'), true);
  assert.equal(ogm.isStateHash('#top'), false);
  assert.equal(ogm.decodeHash('#v=1&d=' + 'x'.repeat(5000)).desc.length, 4000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source rules for the WordPress embed
// ─────────────────────────────────────────────────────────────────────────────

test('tool source has no HTML comment markers, no closing script tag and no backslash-u escapes', () => {
  const dir = path.join(__dirname, '..', 'open-graph-meta-generator');
  ['script.js', 'style.css', 'index.html'].forEach((f) => {
    let src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (f === 'index.html') src = src.replace('<script src="script.js">' + SCRIPT_END, '');
    assert.ok(!src.includes(CMT_OPEN), f + ': comment opener');
    assert.ok(!src.includes(CMT_CLOSE), f + ': comment closer');
    assert.ok(!src.toLowerCase().includes('<' + '/script'), f + ': closing script tag');
    assert.ok(!new RegExp('\\\\u[0-9a-fA-F]{4}').test(src), f + ': backslash-u escape');
  });
});
