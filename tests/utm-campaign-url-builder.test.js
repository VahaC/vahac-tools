// tests/utm-campaign-url-builder.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const ucb = loadScript('utm-campaign-url-builder/script.js');

const ch = (s, m, c) => ucb.predictChannel(s, m, c).name;
const levels = (msgs) => msgs.map((m) => m.level);
const texts = (msgs) => msgs.map((m) => m.text).join('\n');

// ── strictEncode ─────────────────────────────────────────

test('utm: strictEncode percent-encodes spaces and URL delimiters', () => {
  assert.equal(ucb.strictEncode('spring sale'), 'spring%20sale');
  assert.equal(ucb.strictEncode('a&b=c?d#e/f+g%'), 'a%26b%3Dc%3Fd%23e%2Ff%2Bg%25');
});

test('utm: strictEncode also escapes ! \' ( ) * (RFC 3986)', () => {
  assert.equal(ucb.strictEncode("it's (new)!*"), 'it%27s%20%28new%29%21%2A');
});

test('utm: strictEncode leaves unreserved characters alone', () => {
  assert.equal(ucb.strictEncode('A-Z_a.z~09'), 'A-Z_a.z~09');
});

test('utm: strictEncode encodes non-ASCII as UTF-8', () => {
  assert.equal(ucb.strictEncode('кава'), '%D0%BA%D0%B0%D0%B2%D0%B0');
  assert.equal(ucb.strictEncode('☕'), '%E2%98%95');
  assert.equal(ucb.strictEncode('📶'), '%F0%9F%93%B6');
});

test('utm: strictEncode survives lone surrogates', () => {
  assert.equal(ucb.strictEncode(String.fromCharCode(0xD800) + 'a'), '%EF%BF%BDa');
  assert.equal(ucb.strictEncode('a' + String.fromCharCode(0xDC00)), 'a%EF%BF%BD');
});

// ── normalizeValue / encodeValue ─────────────────────────

test('utm: normalizeValue lowercases and replaces spaces with _ by default', () => {
  assert.equal(ucb.normalizeValue('  Spring Sale 2026 ').value, 'spring_sale_2026');
  assert.equal(ucb.normalizeValue('Spring\tSale\nNow').value, 'spring_sale_now');
});

test('utm: normalizeValue supports hyphens and keeping spaces', () => {
  assert.equal(ucb.normalizeValue('Spring   Sale', { spaces: 'hyphen' }).value, 'spring-sale');
  assert.equal(ucb.normalizeValue('Spring Sale', { spaces: 'keep', lowercase: false }).value, 'Spring Sale');
  assert.equal(ucb.normalizeValue('Spring Sale', { spaces: 'bogus' }).value, 'spring_sale');
});

test('utm: normalizeValue drops a pasted utm_x= prefix', () => {
  const n = ucb.normalizeValue('utm_source=Facebook');
  assert.equal(n.value, 'facebook');
  assert.equal(n.stripped, 'utm_source');
  assert.equal(ucb.normalizeValue('UTM_MEDIUM = email').value, 'email');
  assert.equal(ucb.normalizeValue('newsletter').stripped, '');
});

test('utm: normalizeValue keeps ad-platform placeholders verbatim', () => {
  const meta = ucb.normalizeValue('{{campaign.name}} Promo');
  assert.equal(meta.value, '{{campaign.name}}_promo');
  assert.deepEqual(meta.macros, ['{{campaign.name}}']);
  assert.equal(ucb.normalizeValue('__CAMPAIGN_NAME__').value, '__CAMPAIGN_NAME__');
  assert.equal(ucb.normalizeValue('{Campaign} {AdGroup}').value, '{Campaign}_{AdGroup}');
});

test('utm: normalizeValue treats placeholders as text when the option is off', () => {
  const n = ucb.normalizeValue('{{Campaign.Name}}', { macros: false });
  assert.equal(n.value, '{{campaign.name}}');
  assert.deepEqual(n.macros, []);
});

test('utm: normalizeValue does not treat lowercase __words__ or spaced braces as placeholders', () => {
  assert.deepEqual(ucb.normalizeValue('__not_a_macro__').macros, []);
  assert.deepEqual(ucb.normalizeValue('{two words}').macros, []);
});

test('utm: encodeValue keeps placeholders and encodes the rest', () => {
  assert.equal(ucb.encodeValue('{{campaign.name}}_promo', true), '{{campaign.name}}_promo');
  assert.equal(ucb.encodeValue('a {keyword} b', true), 'a%20{keyword}%20b');
  assert.equal(ucb.encodeValue('{{campaign.name}}', false), '%7B%7Bcampaign.name%7D%7D');
});

// ── encodeUnsafe ─────────────────────────────────────────

test('utm: encodeUnsafe encodes spaces, non-ASCII and quote-like characters', () => {
  assert.equal(ucb.encodeUnsafe('/меню'), '/%D0%BC%D0%B5%D0%BD%D1%8E');
  assert.equal(ucb.encodeUnsafe('/a b'), '/a%20b');
  assert.equal(ucb.encodeUnsafe('/"<>`'), '/%22%3C%3E%60');
});

test('utm: encodeUnsafe keeps existing escapes and placeholders but fixes a bare %', () => {
  assert.equal(ucb.encodeUnsafe('/already%20encoded%2F'), '/already%20encoded%2F');
  assert.equal(ucb.encodeUnsafe('/50%off'), '/50%25off');
  assert.equal(ucb.encodeUnsafe('/end%'), '/end%25');
  assert.equal(ucb.encodeUnsafe('/{lpurl}?a[]=1'), '/{lpurl}?a[]=1');
});

// ── parseBaseUrl ─────────────────────────────────────────

test('utm: parseBaseUrl reports an empty value', () => {
  const p = ucb.parseBaseUrl('   ');
  assert.equal(p.empty, true);
  assert.equal(p.ok, false);
  assert.equal(p.error, '');
});

test('utm: parseBaseUrl adds https:// when the scheme is missing', () => {
  const p = ucb.parseBaseUrl('example.com/page');
  assert.equal(p.ok, true);
  assert.equal(p.origin, 'https://example.com');
  assert.equal(p.path, '/page');
  assert.match(texts(p.messages), /Added https:\/\//);
  assert.equal(ucb.parseBaseUrl('//example.com/x').origin, 'https://example.com');
  assert.equal(ucb.parseBaseUrl('localhost:3000/landing').origin, 'https://localhost:3000');
});

test('utm: parseBaseUrl normalises the scheme and adds a root path', () => {
  const p = ucb.parseBaseUrl('HTTPS://Example.com');
  assert.equal(p.origin, 'https://Example.com');
  assert.equal(p.path, '/');
  assert.equal(ucb.parseBaseUrl('https:/example.com/x').origin, 'https://example.com');
  assert.equal(ucb.parseBaseUrl('http://example.com').origin, 'http://example.com');
});

test('utm: parseBaseUrl rejects non-web schemes and incomplete addresses', () => {
  for (const bad of ['mailto:hi@example.com', 'javascript:alert(1)', 'ftp://example.com/file', 'tel:+123456']) {
    const p = ucb.parseBaseUrl(bad);
    assert.equal(p.ok, false, bad);
    assert.match(p.error, /Only web addresses/, bad);
  }
  for (const bad of ['https://', 'https://exa mple.com/']) {
    const p = ucb.parseBaseUrl(bad);
    assert.equal(p.ok, false, bad);
    assert.match(p.error, /complete web address/, bad);
  }
});

test('utm: parseBaseUrl keeps other parameters byte for byte and takes UTM tags out', () => {
  const p = ucb.parseBaseUrl('https://example.com/p?ref=home&utm_source=old&UTM_x=1&q=a+b%20c&&#top');
  assert.deepEqual(p.kept, ['ref=home', 'UTM_x=1', 'q=a+b%20c']);
  assert.deepEqual(p.found, { utm_source: 'old' });
  assert.equal(p.foundCount, 1);
  assert.equal(p.fragment, '#top');
  const importMsg = p.messages.find((m) => m.action && m.action.id === 'import');
  assert.ok(importMsg, 'offers to load the tags into the fields');
});

test('utm: parseBaseUrl decodes found tags and keeps the first duplicate', () => {
  const p = ucb.parseBaseUrl('https://example.com/?utm_campaign=spring+sale&utm_campaign=other&utm_content=a%26b');
  assert.deepEqual(p.found, { utm_campaign: 'spring sale', utm_content: 'a&b' });
  assert.equal(p.foundCount, 2);
  assert.deepEqual(p.kept, []);
});

test('utm: parseBaseUrl drops click IDs copied from an earlier visit', () => {
  const p = ucb.parseBaseUrl('https://example.com/?gclid=abc&keep=1&fbclid=xyz&_gl=1*abc&MSCLKID=9');
  assert.deepEqual(p.kept, ['keep=1']);
  assert.deepEqual(p.removed, ['gclid', 'fbclid', '_gl', 'MSCLKID']);
  assert.match(texts(p.messages), /Removed gclid, fbclid, _gl, MSCLKID/);
});

test('utm: parseBaseUrl converts an internationalised domain to punycode', () => {
  const p = ucb.parseBaseUrl('https://кава.укр/меню');
  assert.equal(p.ok, true);
  assert.equal(p.origin, 'https://' + new URL('https://кава.укр/').host);
  assert.ok(p.origin.includes('xn--'));
  assert.equal(p.path, '/%D0%BC%D0%B5%D0%BD%D1%8E');
});

test('utm: parseBaseUrl warns about spaces, credentials and missing domain endings', () => {
  assert.match(texts(ucb.parseBaseUrl('https://example.com/a page').messages), /contains spaces/);
  assert.equal(ucb.parseBaseUrl('https://example.com/a page').path, '/a%20page');
  assert.match(texts(ucb.parseBaseUrl('https://user:pw@example.com/').messages), /user name or password/);
  assert.match(texts(ucb.parseBaseUrl('https://intranet/page').messages), /no domain ending/);
  assert.equal(ucb.parseBaseUrl('http://localhost/x').messages.length, 0);
});

test('utm: parseBaseUrl explains hash-route fragments', () => {
  const p = ucb.parseBaseUrl('https://example.com/#/pricing?plan=pro');
  assert.equal(p.fragment, '#/pricing?plan=pro');
  assert.match(texts(p.messages), /part after #/);
});

test('utm: cleanUrl rebuilds the landing page without tags', () => {
  const p = ucb.parseBaseUrl('https://example.com/p?ref=home&utm_source=old&gclid=1#top');
  assert.equal(ucb.cleanUrl(p), 'https://example.com/p?ref=home#top');
  assert.equal(ucb.cleanUrl(ucb.parseBaseUrl('example.com')), 'https://example.com/');
  assert.equal(ucb.cleanUrl(ucb.parseBaseUrl('mailto:x')), '');
});

// ── buildLink ────────────────────────────────────────────

test('utm: buildLink builds a tidy tagged URL', () => {
  const r = ucb.buildLink({
    url: 'https://example.com/spring-sale',
    source: 'Newsletter', medium: 'Email', campaign: 'Spring Sale 2026', content: 'header button'
  });
  assert.equal(r.ready, true);
  assert.equal(r.url, 'https://example.com/spring-sale?utm_source=newsletter&utm_medium=email&utm_campaign=spring_sale_2026&utm_content=header_button');
  assert.equal(r.query, 'utm_source=newsletter&utm_medium=email&utm_campaign=spring_sale_2026&utm_content=header_button');
  assert.equal(r.channel.name, 'Email');
  assert.deepEqual(levels(r.messages), []);
});

test('utm: buildLink appends every parameter in a fixed order', () => {
  const r = ucb.buildLink({
    url: 'example.com', tactic: 't', format: 'f', platform: 'p', content: 'c', term: 'k',
    id: 'i', campaign: 'n', medium: 'm', source: 's'
  });
  assert.equal(r.url, 'https://example.com/?utm_source=s&utm_medium=m&utm_campaign=n&utm_id=i&utm_term=k' +
    '&utm_content=c&utm_source_platform=p&utm_creative_format=f&utm_marketing_tactic=t');
});

test('utm: buildLink keeps existing parameters first and the fragment last', () => {
  const r = ucb.buildLink({ url: 'https://example.com/p?ref=home#top', source: 'x', medium: 'social', campaign: 'c' });
  assert.equal(r.url, 'https://example.com/p?ref=home&utm_source=x&utm_medium=social&utm_campaign=c#top');
});

test('utm: buildLink replaces UTM tags that were already in the URL', () => {
  const r = ucb.buildLink({ url: 'https://example.com/?utm_source=old&utm_term=stale', source: 'new', medium: 'email', campaign: 'c' });
  assert.equal(r.url, 'https://example.com/?utm_source=new&utm_medium=email&utm_campaign=c');
});

test('utm: buildLink values round-trip through the WHATWG URL parser', () => {
  const values = {
    source: 'Q&A = fun? #1 / 50% + more',
    medium: 'e-mail',
    campaign: 'Зимовий розпродаж ☕',
    content: "it's (new)!",
    term: 'a+b'
  };
  for (const spaces of ['underscore', 'hyphen', 'keep']) {
    const r = ucb.buildLink(Object.assign({ url: 'https://example.com/landing?x=1' }, values), { spaces, lowercase: false });
    const u = new URL(r.url);
    for (const p of r.params) {
      assert.equal(u.searchParams.get(p.key), p.value, spaces + ' ' + p.key);
    }
    assert.equal(u.searchParams.get('x'), '1');
  }
});

test('utm: buildLink needs a source for the full link but still builds parameters', () => {
  const r = ucb.buildLink({ url: 'https://example.com/', medium: 'email' });
  assert.equal(r.ready, false);
  assert.equal(r.url, '');
  assert.equal(r.query, 'utm_medium=email');
  assert.match(texts(r.messages), /Add a campaign source/);
  assert.equal(r.messages[0].level, 'error');
});

test('utm: buildLink without a website URL offers the parameters for ad platforms', () => {
  const r = ucb.buildLink({ source: 'facebook', medium: 'paid_social', campaign: '{{campaign.name}}' });
  assert.equal(r.ready, false);
  assert.equal(r.query, 'utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}');
  assert.match(texts(r.messages), /Final URL suffix/);
});

test('utm: buildLink with an empty form has no messages', () => {
  const r = ucb.buildLink({});
  assert.equal(r.ready, false);
  assert.equal(r.query, '');
  assert.equal(r.channel, null);
  assert.deepEqual(r.messages, []);
});

test('utm: buildLink warns about a missing medium and campaign', () => {
  const r = ucb.buildLink({ url: 'https://example.com/', source: 'newsletter' });
  assert.equal(r.ready, true);
  assert.match(texts(r.messages), /Add a campaign medium/);
  assert.match(texts(r.messages), /Add a campaign name/);
});

test('utm: buildLink reports an invalid URL as an error', () => {
  const r = ucb.buildLink({ url: 'mailto:someone@example.com', source: 'x' });
  assert.equal(r.ready, false);
  assert.equal(r.messages[0].level, 'error');
  assert.match(r.messages[0].text, /Only web addresses/);
});

test('utm: buildLink keeps ad-platform placeholders unencoded', () => {
  const r = ucb.buildLink({
    url: 'https://example.com/', source: 'facebook', medium: 'paid_social',
    campaign: '{{campaign.name}}', content: '{{ad.name}}'
  });
  assert.equal(r.url, 'https://example.com/?utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}');
  assert.equal(r.macros, true);
  assert.equal(r.channel.name, 'Paid Social');
  assert.match(texts(r.messages), /Kept \{\{campaign\.name\}\}, \{\{ad\.name\}\} as they are/);
});

test('utm: buildLink cannot predict the channel when the source is a placeholder', () => {
  const r = ucb.buildLink({ url: 'https://example.com/', source: '{{site_source_name}}', medium: 'paid_social', campaign: 'c' });
  assert.equal(r.channel.kind, 'depends');
  assert.match(r.channel.reason, /\{\{site_source_name\}\}/);
});

test('utm: buildLink notes formatting details', () => {
  const upper = ucb.buildLink({ url: 'https://example.com/', source: 'Facebook', medium: 'social', campaign: 'c' }, { lowercase: false });
  assert.match(texts(upper.messages), /case-sensitive/);
  const spaced = ucb.buildLink({ url: 'https://example.com/', source: 'my site', medium: 'referral', campaign: 'c' }, { spaces: 'keep' });
  assert.match(texts(spaced.messages), /sent as %20/);
  assert.match(spaced.url, /utm_source=my%20site/);
  const special = ucb.buildLink({ url: 'https://example.com/', source: 'newsletter', medium: 'email', campaign: 'Q&A' });
  assert.match(texts(special.messages), /percent-encoded so they can’t break/);
  const cyr = ucb.buildLink({ url: 'https://example.com/', source: 'newsletter', medium: 'email', campaign: 'Зима' });
  assert.match(texts(cyr.messages), /Non-Latin characters/);
  const fmt = ucb.buildLink({ url: 'https://example.com/', source: 'newsletter', medium: 'email', campaign: 'c', format: 'video' });
  assert.match(texts(fmt.messages), /doesn’t currently report/);
});

test('utm: buildLink reports a stripped utm_ prefix', () => {
  const r = ucb.buildLink({ url: 'https://example.com/', source: 'utm_source=newsletter', medium: 'email', campaign: 'c' });
  assert.equal(r.values.source, 'newsletter');
  assert.match(texts(r.messages), /Removed “utm_source=” from Source/);
});

test('utm: buildLink warns about very long links', () => {
  const r = ucb.buildLink({ url: 'https://example.com/' + 'a'.repeat(2000), source: 'newsletter', medium: 'email', campaign: 'c' });
  assert.match(texts(r.messages), /characters long/);
});

test('utm: buildLink sorts errors before warnings before notes', () => {
  const r = ucb.buildLink({ url: 'example.com', medium: 'newsletter', campaign: 'Q&A' });
  const order = levels(r.messages).map((l) => ({ error: 0, warn: 1, info: 2 })[l]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

// ── GA4 source list ──────────────────────────────────────

test('utm: GA4 source list has the published category sizes', () => {
  const counts = {};
  for (const cat of Object.values(Object.assign({}, ucb.SOURCE_CATEGORY))) counts[cat] = (counts[cat] || 0) + 1;
  assert.deepEqual(counts, { search: 129, social: 592, video: 46, shopping: 52 });
});

test('utm: sourceCategory matches case-insensitively and safely', () => {
  assert.equal(ucb.sourceCategory('Facebook'), 'social');
  assert.equal(ucb.sourceCategory(' google '), 'search');
  assert.equal(ucb.sourceCategory('youtube'), 'video');
  assert.equal(ucb.sourceCategory('amazon'), 'shopping');
  assert.equal(ucb.sourceCategory('Google Shopping'), 'shopping');
  assert.equal(ucb.sourceCategory('IGShopping'), 'shopping');
  assert.equal(ucb.sourceCategory('t.co'), 'social');
  assert.equal(ucb.sourceCategory('x'), '');
  assert.equal(ucb.sourceCategory('newsletter'), '');
  assert.equal(ucb.sourceCategory('constructor'), '');
  assert.equal(ucb.sourceCategory('__proto__'), '');
  assert.equal(ucb.sourceCategory(''), '');
});

// ── predictChannel ───────────────────────────────────────

test('utm: predictChannel — email by medium or source', () => {
  assert.equal(ch('newsletter', 'email'), 'Email');
  assert.equal(ch('newsletter', 'E-Mail'), 'Email');
  assert.equal(ch('newsletter', 'e_mail'), 'Email');
  assert.equal(ch('newsletter', 'e mail'), 'Email');
  assert.equal(ch('email', 'newsletter'), 'Email');
  assert.equal(ch('email', ''), 'Email');
});

test('utm: predictChannel — organic social by source list or medium', () => {
  assert.equal(ch('facebook', 'social'), 'Organic Social');
  assert.equal(ch('facebook', ''), 'Organic Social');
  assert.equal(ch('whatsapp', 'social'), 'Organic Social');
  for (const m of ['social', 'social-network', 'social-media', 'sm', 'social network', 'social media']) {
    assert.equal(ch('newsletter', m), 'Organic Social', m);
  }
  assert.equal(ch('newsletter', 'social_media'), 'Unassigned');
});

test('utm: predictChannel — paid channels need a listed source and a paid medium', () => {
  assert.equal(ch('facebook', 'paid_social'), 'Paid Social');
  assert.equal(ch('Facebook', 'CPC'), 'Paid Social');
  assert.equal(ch('twitter', 'paid_social'), 'Paid Social');
  assert.equal(ch('t.co', 'cpc'), 'Paid Social');
  assert.equal(ch('google', 'cpc'), 'Paid Search');
  assert.equal(ch('bing', 'ppc'), 'Paid Search');
  assert.equal(ch('google', 'retargeting'), 'Paid Search');
  assert.equal(ch('youtube', 'cpv'), 'Paid Video');
  assert.equal(ch('amazon', 'cpc'), 'Paid Shopping');
  assert.equal(ch('meta', 'paid_social'), 'Paid Other');
  assert.equal(ch('x', 'paid_social'), 'Paid Other');
  assert.equal(ch('newsletter', 'cpc'), 'Paid Other');
});

test('utm: predictChannel — display comes after the listed paid channels', () => {
  assert.equal(ch('partner_site', 'display'), 'Display');
  assert.equal(ch('partner_site', 'banner'), 'Display');
  assert.equal(ch('partner_site', 'cpm'), 'Display');
  assert.equal(ch('facebook', 'cpm'), 'Paid Social');
});

test('utm: predictChannel — campaign names containing shop mean shopping', () => {
  assert.equal(ch('newsletter', 'email', 'coffee_shop_opening'), 'Organic Shopping');
  assert.equal(ch('newsletter', 'email', 'shopify_launch'), 'Organic Shopping');
  assert.equal(ch('newsletter', 'email', 'eshop_launch'), 'Organic Shopping');
  assert.equal(ch('newsletter', 'email', 'Christmas Shopping'), 'Organic Shopping');
  assert.equal(ch('newsletter', 'email', 'workshop_2026'), 'Email');
  assert.equal(ch('newsletter', 'email', 'bishop_visit'), 'Email');
  assert.equal(ch('facebook', 'cpc', 'summer_shop'), 'Paid Shopping');
  assert.equal(ch('amazon', 'referral'), 'Organic Shopping');
});

test('utm: predictChannel — cross-network campaigns win over everything else', () => {
  assert.equal(ch('newsletter', 'email', 'cross-network-test'), 'Cross-network');
  assert.equal(ch('google', 'cpc', 'Cross-Network'), 'Cross-network');
});

test('utm: predictChannel — video, search, referral and the rest', () => {
  assert.equal(ch('youtube', 'video'), 'Organic Video');
  assert.equal(ch('newsletter', 'video'), 'Organic Video');
  assert.equal(ch('vimeo', 'referral'), 'Organic Video');
  assert.equal(ch('google_business_profile', 'organic'), 'Organic Search');
  assert.equal(ch('duckduckgo', 'referral'), 'Organic Search');
  assert.equal(ch('chatgpt', 'ai-assistant'), 'AI Assistant');
  for (const m of ['referral', 'app', 'link']) assert.equal(ch('partner', m), 'Referral', m);
  assert.equal(ch('partner', 'affiliate'), 'Affiliates');
  assert.equal(ch('my_podcast', 'audio'), 'Audio');
  assert.equal(ch('sms', 'sms'), 'SMS');
  assert.equal(ch('twilio', 'sms'), 'SMS');
  assert.equal(ch('sms', 'text'), 'SMS');
});

test('utm: predictChannel — mobile push notifications', () => {
  assert.equal(ch('app', 'push'), 'Mobile Push Notifications');
  assert.equal(ch('app', 'web-push'), 'Mobile Push Notifications');
  assert.equal(ch('app', 'mobile_banner'), 'Mobile Push Notifications');
  assert.equal(ch('app', 'notification'), 'Mobile Push Notifications');
  assert.equal(ch('firebase', 'anything'), 'Mobile Push Notifications');
});

test('utm: predictChannel — direct and unassigned', () => {
  assert.equal(ch('(direct)', '(none)'), 'Direct');
  assert.equal(ch('(direct)', ''), 'Direct');
  assert.equal(ch('flyer', 'print'), 'Unassigned');
  assert.equal(ch('newsletter', ''), 'Unassigned');
  assert.equal(ch('newsletter', 'newsletter'), 'Unassigned');
  assert.equal(ucb.predictChannel('flyer', 'print').kind, 'unassigned');
  assert.equal(ucb.predictChannel('newsletter', 'email').kind, 'ok');
});

test('utm: predictChannel explains the matching rule', () => {
  assert.match(ucb.predictChannel('facebook', 'paid_social').reason, /“facebook” is on Google’s list of social sites and the medium “paid_social” matches GA4’s paid pattern/);
  assert.match(ucb.predictChannel('newsletter', 'email').reason, /^The medium “email” is one of GA4’s email values\.$/);
  assert.match(ucb.predictChannel('newsletter', '').reason, /source “newsletter” with medium “\(not set\)”/);
});

// ── isKnownMedium & advice ───────────────────────────────

test('utm: isKnownMedium recognises GA4 and offline mediums', () => {
  for (const m of ['email', 'cpc', 'paid_social', 'social', 'display', 'referral', 'organic', 'video', 'audio', 'sms', 'push', 'print', 'Affiliate']) {
    assert.equal(ucb.isKnownMedium(m), true, m);
  }
  for (const m of ['newsletter', 'facebook', 'social_media', '']) {
    assert.equal(ucb.isKnownMedium(m), false, m);
  }
});

function advice(source, medium, campaign) {
  return ucb.adviceMessages({ source, medium, campaign: campaign || '' });
}

test('utm: advice suggests a GA4 medium for unrecognised ones', () => {
  const a = advice('newsletter', 'newsletter');
  assert.equal(a[0].level, 'warn');
  assert.deepEqual(a[0].action, { id: 'set', field: 'medium', value: 'email', label: 'Use “email”' });
  assert.match(a[0].text, /Use “email” so they count as Email\./);
  assert.equal(advice('partner', 'display_ad')[0].action.value, 'display');
  assert.equal(advice('newsletter', 'social_media')[0].action.value, 'social');
});

test('utm: advice flags a platform name used as the medium', () => {
  const withSource = advice('newsletter', 'facebook');
  assert.match(withSource[0].text, /“facebook” is a source, not a medium/);
  assert.equal(withSource[0].action.value, 'social');
  assert.equal(withSource[0].action.move, false);
  const noSource = advice('', 'facebook');
  assert.equal(noSource[0].action.move, true);
  assert.equal(advice('newsletter', 'google')[0].action, undefined);
});

test('utm: advice catches paid mediums that miss the paid pattern', () => {
  const a = advice('facebook', 'sponsored');
  assert.match(a[0].text, /would count as Organic Social\. Use “paid_social” so they count as Paid Social\./);
  assert.equal(a[0].action.value, 'paid_social');
  assert.equal(advice('facebook', 'social_paid')[0].action.value, 'paid_social');
  assert.equal(advice('youtube', 'video_ads')[0].action.value, 'paid_video');
  assert.equal(advice('newsletter', 'ads')[0].action.value, 'cpc');
  assert.deepEqual(advice('facebook', 'paid_social'), []);
});

test('utm: advice suggests the listed spelling of a platform when the channel changes', () => {
  const x = advice('x', 'paid_social');
  assert.match(x[0].text, /knows “twitter” but not “x”/);
  assert.equal(x[0].action.value, 'twitter');
  assert.equal(advice('meta', 'paid_social')[0].action.value, 'facebook');
  assert.equal(advice('facebook_ads', 'cpc')[0].action.value, 'facebook');
  assert.equal(advice('www.facebook.com', 'cpc')[0].action.value, 'facebook');
  assert.deepEqual(advice('x', 'social'), []);
  assert.deepEqual(advice('facebookads', 'cpc').filter((m) => m.action && m.action.field === 'source'), []);
  assert.deepEqual(advice('google_business_profile', 'organic'), []);
});

test('utm: advice warns about campaign names that change the channel', () => {
  assert.match(texts(advice('newsletter', 'email', 'coffee_shop_opening')), /Organic Shopping instead of Email/);
  assert.match(texts(advice('newsletter', 'email', 'cross-network_q3')), /Cross-network/);
  assert.deepEqual(advice('amazon', 'cpc', 'shop_week'), []);
});

test('utm: advice spots swapped source and medium', () => {
  const a = advice('email', 'newsletter');
  assert.equal(a.length, 1);
  assert.equal(a[0].action.id, 'swap');
  assert.deepEqual(advice('sms', 'sms'), []);
});

test('utm: advice explains offline and unknown mediums', () => {
  const print = advice('flyer', 'print');
  assert.equal(print[0].level, 'info');
  assert.match(print[0].text, /custom channel group/);
  const unknown = advice('newsletter', 'blah');
  assert.equal(unknown[0].level, 'warn');
  assert.match(unknown[0].text, /would be Unassigned/);
});

// ── Presets ──────────────────────────────────────────────

const EXPECTED_PRESET_CHANNELS = {
  newsletter: 'Email', 'email-signature': 'Email', sms: 'SMS', whatsapp: 'Organic Social',
  facebook: 'Organic Social', instagram: 'Organic Social', linkedin: 'Organic Social', twitter: 'Organic Social',
  tiktok: 'Organic Social', pinterest: 'Organic Social', reddit: 'Organic Social', youtube: 'Organic Video',
  'facebook-ads': 'Paid Social', 'instagram-ads': 'Paid Social', 'linkedin-ads': 'Paid Social', 'tiktok-ads': 'Paid Social',
  'google-ads': 'Paid Search', 'microsoft-ads': 'Paid Search', display: 'Display',
  affiliate: 'Affiliates', referral: 'Referral', podcast: 'Audio', gbp: 'Organic Search', print: 'Unassigned'
};

test('utm: presets are complete and uniquely named', () => {
  const ids = ucb.PRESETS.flatMap((g) => g.items.map((p) => p.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), Object.keys(EXPECTED_PRESET_CHANNELS).sort());
  for (const g of ucb.PRESETS) {
    assert.ok(g.group);
    for (const p of g.items) {
      assert.ok(p.label && p.medium, p.id);
      assert.equal(typeof p.source, 'string', p.id);
      if (!p.source) assert.ok(p.note, p.id + ' tells the user what to enter as the source');
    }
  }
});

test('utm: every preset lands in the intended GA4 channel without warnings', () => {
  for (const g of ucb.PRESETS) {
    for (const p of g.items) {
      const source = p.source || 'partner_name';
      assert.equal(ch(source, p.medium, 'spring_sale'), EXPECTED_PRESET_CHANNELS[p.id], p.id);
      const warnings = advice(source, p.medium, 'spring_sale').filter((m) => m.level !== 'info');
      assert.deepEqual(warnings, [], p.id);
    }
  }
});

// ── CSV, file names, SVG, bytes ──────────────────────────

test('utm: csvCell quotes and neutralises formulas', () => {
  assert.equal(ucb.csvCell('plain'), 'plain');
  assert.equal(ucb.csvCell('a,b'), '"a,b"');
  assert.equal(ucb.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(ucb.csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(ucb.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(ucb.csvCell('-5'), "'-5");
  assert.equal(ucb.csvCell('@x'), "'@x");
  assert.equal(ucb.csvCell(' lead'), '" lead"');
  assert.equal(ucb.csvCell(null), '');
});

test('utm: buildCsv writes a header and one CRLF row per link', () => {
  const csv = ucb.buildCsv([{
    url: 'https://example.com/?utm_source=a&utm_medium=email', landing: 'https://example.com/',
    source: 'a', medium: 'email', campaign: 'x,y', id: '', term: '', content: '', platform: '',
    format: '', tactic: '', channel: 'Email', added: '2026-10-24T09:00:00.000Z'
  }]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'url,landing_page,utm_source,utm_medium,utm_campaign,utm_id,utm_term,utm_content,utm_source_platform,utm_creative_format,utm_marketing_tactic,ga4_channel,added');
  assert.equal(lines[1], 'https://example.com/?utm_source=a&utm_medium=email,https://example.com/,a,email,"x,y",,,,,,,Email,2026-10-24T09:00:00.000Z');
  assert.equal(lines[2], '');
  assert.equal(ucb.buildCsv([]), lines[0] + '\r\n');
});

test('utm: fileSlug produces safe ASCII file names', () => {
  assert.equal(ucb.fileSlug('Spring Sale 2026!'), 'spring-sale-2026');
  assert.equal(ucb.fileSlug('Зима'), '');
  assert.equal(ucb.fileSlug(undefined), '');
  assert.ok(ucb.fileSlug('a'.repeat(100)).length <= 40);
});

test('utm: buildSvg merges dark runs and applies the quiet zone', () => {
  const svg = ucb.buildSvg({ count: 2, modules: [[true, true], [false, true]] }, 4);
  assert.match(svg, /viewBox="0 0 10 10"/);
  assert.match(svg, /width="100" height="100"/);
  assert.match(svg, /d="M4 4h2v1h-2zM5 5h1v1h-1z"/);
});

test('utm: toUtf8ByteString matches Buffer UTF-8 bytes', () => {
  const s = 'https://кава.example/?q=☕';
  const expected = Buffer.from(s, 'utf8');
  const actual = ucb.toUtf8ByteString(s);
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.equal(actual.charCodeAt(i), expected[i]);
});
