// tests/robots-txt-generator-validator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const rbt = loadScript('robots-txt-generator-validator/script.js');

function parse(lines) {
  return rbt.parseRobots(Array.isArray(lines) ? lines.join('\n') : lines);
}

function at(parsed, line) {
  return parsed.messages.filter((m) => m.line === line);
}

function levelsAt(parsed, line) {
  return at(parsed, line).map((m) => m.level);
}

function textAt(parsed, line) {
  return at(parsed, line).map((m) => m.text).join('\n');
}

function verdict(robots, path, tokens) {
  return rbt.testPath(typeof robots === 'string' ? rbt.parseRobots(robots) : parse(robots), path, tokens);
}

// ── parseLine / resolveKey / productToken ───────────────

test('robots: parseLine splits key and value on the first colon and drops comments', () => {
  assert.deepEqual(rbt.parseLine('Sitemap: https://example.com/s.xml # main'),
    { kind: 'pair', key: 'Sitemap', value: 'https://example.com/s.xml', noColon: false });
  assert.equal(rbt.parseLine('   ').kind, 'blank');
  assert.equal(rbt.parseLine('# only a comment').kind, 'comment');
});

test('robots: parseLine accepts a missing colon only for two-word lines', () => {
  const p = rbt.parseLine('Disallow /tmp');
  assert.equal(p.kind, 'pair');
  assert.equal(p.noColon, true);
  assert.equal(p.value, '/tmp');
  assert.equal(rbt.parseLine('this is not a directive').kind, 'invalid');
});

test('robots: resolveKey is case-insensitive and knows Google typos', () => {
  assert.deepEqual(rbt.resolveKey('USER-AGENT'), { name: 'user-agent', typo: false });
  assert.deepEqual(rbt.resolveKey('Disalow'), { name: 'disallow', typo: true });
  assert.deepEqual(rbt.resolveKey('useragent'), { name: 'user-agent', typo: true });
  assert.deepEqual(rbt.resolveKey('Foo'), { name: null, typo: false });
});

test('robots: productToken keeps only letters, "-" and "_"', () => {
  assert.equal(rbt.productToken('Googlebot/2.1'), 'Googlebot');
  assert.equal(rbt.productToken('Googlebot-Image'), 'Googlebot-Image');
  assert.equal(rbt.productToken('*'), '*');
  assert.equal(rbt.productToken('123bot'), '');
});

// ── Encoding & pattern matching ─────────────────────────

test('robots: normalizeEncoding encodes non-ASCII and decodes unreserved escapes', () => {
  assert.equal(rbt.normalizeEncoding('/café'), '/caf%C3%A9');
  assert.equal(rbt.normalizeEncoding('/%7euser/%2f'), '/~user/%2F');
  assert.equal(rbt.normalizeEncoding('/a b'), '/a%20b');
  assert.equal(rbt.normalizeEncoding('/*.pdf$'), '/*.pdf$');
});

test('robots: patternMatches is a prefix match with * and a final $', () => {
  assert.equal(rbt.patternMatches('/private/x', '/private'), true);
  assert.equal(rbt.patternMatches('/Private/x', '/private'), false);
  assert.equal(rbt.patternMatches('/docs/a.pdf', '/*.pdf$'), true);
  assert.equal(rbt.patternMatches('/docs/a.pdf?x=1', '/*.pdf$'), false);
  assert.equal(rbt.patternMatches('/a/b/c', '/a/*/c'), true);
  assert.equal(rbt.patternMatches('/fish$', '/fish$x'), false);
  assert.equal(rbt.patternMatches('/fish$x', '/fish$x'), true);
  assert.equal(rbt.patternMatches('/', '/$'), true);
  assert.equal(rbt.patternMatches('/page', '/$'), false);
});

// ── Grouping ────────────────────────────────────────────

test('robots: consecutive user-agent lines form one group', () => {
  const p = parse(['User-agent: a', 'User-agent: b', 'Disallow: /x', 'User-agent: c', 'Allow: /']);
  assert.equal(p.groups.length, 2);
  assert.deepEqual(p.groups[0].agents.map((a) => a.token), ['a', 'b']);
  assert.equal(p.groups[0].rules.length, 1);
  assert.equal(p.groups[1].startLine, 4);
});

test('robots: a blank line between user-agent lines does not end the group and is flagged', () => {
  const p = parse(['User-agent: Googlebot', '', 'User-agent: *', 'Disallow: /']);
  assert.equal(p.groups.length, 1);
  assert.deepEqual(p.groups[0].agents.map((a) => a.token), ['Googlebot', '*']);
  assert.ok(levelsAt(p, 3).includes('warn'));
  assert.match(textAt(p, 3), /blank line does not end a group/);
  // ...and the merged rule really applies to Googlebot
  assert.equal(rbt.testPath(p, '/page', ['googlebot']).allowed, false);
});

test('robots: rules after a blank line still belong to the current group', () => {
  const p = parse(['User-agent: *', 'Disallow: /a', '', 'Disallow: /b']);
  assert.equal(p.groups.length, 1);
  assert.equal(p.groups[0].rules.length, 2);
});

test('robots: a rule before any user-agent is an error', () => {
  const p = parse(['Disallow: /x', 'User-agent: *', 'Allow: /']);
  assert.deepEqual(levelsAt(p, 1), ['error']);
  assert.equal(p.groups[0].rules.length, 1);
});

// ── Validation messages ─────────────────────────────────

test('robots: typos, missing colons and unknown directives are reported', () => {
  const p = parse(['User-agent: *', 'Disalow: /tmp/', 'Disallow /x', 'Dissalow: /y', 'Alow: /z', 'Foo: bar']);
  assert.match(textAt(p, 2), /misspelling of `Disallow`/);
  assert.ok(levelsAt(p, 3).includes('error'));
  assert.match(textAt(p, 3), /Missing `:`/);
  assert.ok(levelsAt(p, 4).includes('warn'));
  assert.match(textAt(p, 5), /Did you mean `Allow`\?/);
  assert.match(textAt(p, 6), /Unknown directive `Foo`/);
  // Google-tolerated typos still count as rules
  assert.equal(p.groups[0].rules.length, 3);
});

test('robots: rule paths that cannot match are flagged', () => {
  const p = parse(['User-agent: *', 'Disallow: private/', 'Disallow: https://example.com/admin/', 'Allow:']);
  assert.match(textAt(p, 2), /Write `Disallow: \/private\/`/);
  assert.deepEqual(levelsAt(p, 3), ['error']);
  assert.match(textAt(p, 3), /`Disallow: \/admin\/`/);
  assert.match(textAt(p, 4), /empty `Allow:` has no effect/);
});

test('robots: whole-site block for * is a warning, for a named bot it is not', () => {
  const p = parse(['User-agent: GPTBot', 'Disallow: /', '', 'User-agent: *', 'Disallow: /']);
  assert.deepEqual(levelsAt(p, 2), []);
  assert.match(textAt(p, 5), /blocks the whole site/);
});

test('robots: blocking CSS/JS and "private" paths gets explained', () => {
  const p = parse(['User-agent: *', 'Disallow: /*.css$', 'Disallow: /wp-includes/', 'Disallow: /backup/']);
  assert.match(textAt(p, 2), /rendering/);
  assert.match(textAt(p, 3), /rendering/);
  assert.match(textAt(p, 4), /robots\.txt is public/);
});

test('robots: $ in the middle, redundant * and duplicates produce notes', () => {
  const p = parse(['User-agent: *', 'Disallow: /a$b', 'Disallow: /tmp*', 'Disallow: /x', 'Disallow: /x', 'Allow: /x']);
  assert.match(textAt(p, 2), /literal `\$`/);
  assert.match(textAt(p, 3), /trailing `\*` is redundant/);
  assert.match(textAt(p, 5), /Same rule as line 4/);
  assert.match(textAt(p, 6), /tie goes to `Allow`/);
});

test('robots: sitemap must be an absolute URL; duplicates noted', () => {
  const p = parse(['Sitemap: /sitemap.xml', 'Sitemap: https://example.com/s.xml', 'Sitemap: https://example.com/s.xml', 'Sitemap:']);
  assert.deepEqual(levelsAt(p, 1), ['error']);
  assert.deepEqual(levelsAt(p, 2), []);
  assert.deepEqual(levelsAt(p, 3), ['info']);
  assert.deepEqual(levelsAt(p, 4), ['error']);
  assert.equal(p.sitemaps.length, 4);
});

test('robots: crawl-delay, host and noindex are explained', () => {
  const p = parse(['User-agent: bingbot', 'Crawl-delay: 10', 'Crawl-delay: fast', 'Disallow:', 'Host: example.com', 'Noindex: /x']);
  assert.match(textAt(p, 2), /Googlebot ignores `Crawl-delay`/);
  assert.match(textAt(p, 2), /8,640 pages a day/);
  assert.ok(levelsAt(p, 3).includes('warn'));
  assert.equal(p.groups[0].delay.value, '10');
  assert.match(textAt(p, 5), /Yandex/);
  assert.match(textAt(p, 6), /September 2019/);
});

test('robots: user-agent values beyond the product token are warned about', () => {
  const p = parse(['User-agent: Googlebot/2.1', 'Disallow: /x', 'User-agent: 42', 'Disallow: /y']);
  assert.match(textAt(p, 1), /read as `Googlebot`/);
  assert.deepEqual(levelsAt(p, 3), ['error']);
});

test('robots: file-level checks (empty, HTML, no groups, no star, no sitemap, size)', () => {
  assert.match(parse('').messages[0].text, /empty/);
  const html = parse('<!DOCTYPE html><html><body>Not found</body></html>');
  assert.ok(html.messages.some((m) => m.line === 0 && m.level === 'error' && /HTML page/.test(m.text)));
  const noStar = parse(['User-agent: Googlebot', 'Disallow: /x']);
  assert.ok(noStar.messages.some((m) => /No `User-agent: \*` group/.test(m.text)));
  assert.ok(noStar.messages.some((m) => /No `Sitemap` line/.test(m.text)));
  const big = parse('User-agent: *\n' + '# padding\n'.repeat(60000) + 'Disallow: /x\n');
  assert.ok(big.messages.some((m) => /500 KiB/.test(m.text)));
  // global messages come first
  assert.equal(noStar.messages[0].line, 0);
});

test('robots: BOM and CRLF line endings are handled', () => {
  const p = rbt.parseRobots(String.fromCharCode(0xFEFF) + 'User-agent: *\r\nDisallow: /x\r\n');
  assert.equal(p.stats.lines, 2);
  assert.equal(p.groups[0].agents[0].token, '*');
  assert.equal(p.groups[0].rules[0].path, '/x');
});

test('robots: stats count groups, rules, sitemaps and message levels', () => {
  const p = rbt.parseRobots(rbt.SAMPLE);
  assert.equal(p.stats.groups, 3);
  assert.equal(p.stats.sitemaps, 2);
  assert.ok(p.stats.errors >= 1);
  assert.ok(p.stats.warnings >= 3);
});

// ── URL testing ─────────────────────────────────────────

test('robots: the longest matching rule wins; Allow wins a tie', () => {
  const robots = ['User-agent: *', 'Disallow: /wp-admin/', 'Allow: /wp-admin/admin-ajax.php', 'Disallow: /page', 'Allow: /page'];
  assert.equal(verdict(robots, '/wp-admin/options.php', []).allowed, false);
  const ajax = verdict(robots, '/wp-admin/admin-ajax.php', []);
  assert.equal(ajax.allowed, true);
  assert.equal(ajax.rule.line, 3);
  assert.equal(ajax.matches.length, 2);
  const tie = verdict(robots, '/page', []);
  assert.equal(tie.allowed, true);
  assert.equal(tie.rule.type, 'allow');
  assert.equal(verdict(robots, '/', []).reason, 'nomatch');
});

test('robots: a crawler uses its own group instead of *', () => {
  const robots = ['User-agent: *', 'Disallow: /', '', 'User-agent: Googlebot', 'Disallow: /private/'];
  assert.equal(verdict(robots, '/blog/', ['googlebot']).allowed, true);
  assert.equal(verdict(robots, '/blog/', ['bingbot']).allowed, false);
  assert.equal(verdict(robots, '/blog/', ['bingbot']).token, '*');
});

test('robots: groups for the same agent are combined', () => {
  const robots = ['User-agent: Googlebot', 'Disallow: /a', '', 'User-agent: *', 'Disallow: /', '', 'User-agent: googlebot', 'Disallow: /b'];
  const p = parse(robots);
  assert.ok(p.messages.some((m) => m.line === 7 && /also has a group on line 1/.test(m.text)));
  assert.equal(rbt.testPath(p, '/b/x', ['googlebot']).allowed, false);
  assert.equal(rbt.testPath(p, '/c', ['googlebot']).allowed, true);
  assert.equal(rbt.testPath(p, '/c', ['googlebot']).groups.length, 2);
});

test('robots: fallback tokens (Applebot -> Googlebot) are honoured', () => {
  const robots = ['User-agent: Googlebot', 'Disallow: /g/', '', 'User-agent: *', 'Disallow: /'];
  const r = verdict(robots, '/page', ['applebot', 'googlebot']);
  assert.equal(r.allowed, true);
  assert.equal(r.token, 'Googlebot');
});

test('robots: no groups or no matching group means allowed; /robots.txt is always allowed', () => {
  assert.equal(verdict('', '/x', ['googlebot']).reason, 'nogroup');
  assert.equal(verdict(['User-agent: Bingbot', 'Disallow: /'], '/x', ['googlebot']).allowed, true);
  const self = verdict(['User-agent: *', 'Disallow: /'], '/robots.txt', []);
  assert.equal(self.allowed, true);
  assert.equal(self.reason, 'robots');
});

test('robots: toTestPath accepts full URLs, bare hosts and paths', () => {
  assert.deepEqual(rbt.toTestPath('https://example.com/a/b?c=1#frag'), { path: '/a/b?c=1', host: 'example.com' });
  assert.deepEqual(rbt.toTestPath('example.com/shop'), { path: '/shop', host: 'example.com' });
  assert.deepEqual(rbt.toTestPath('blog/post#x'), { path: '/blog/post', host: '' });
  assert.deepEqual(rbt.toTestPath('index.html'), { path: '/index.html', host: '' });
  assert.ok(rbt.toTestPath('ftp://example.com/x').error);
  assert.ok(rbt.toTestPath('   ').error);
});

test('robots: percent-encoding differences do not change the verdict', () => {
  const robots = ['User-agent: *', 'Disallow: /caf%C3%A9/', 'Disallow: /~user/'];
  assert.equal(verdict(robots, '/café/menu', []).allowed, false);
  assert.equal(verdict(robots, '/%7Euser/files', []).allowed, false);
});

test('robots: query strings are part of the matched path', () => {
  const robots = ['User-agent: *', 'Disallow: /*?s=', 'Disallow: /search$'];
  assert.equal(verdict(robots, '/?s=robots', []).allowed, false);
  assert.equal(verdict(robots, '/search', []).allowed, false);
  assert.equal(verdict(robots, '/search?q=1', []).allowed, true);
});

// ── Generator ───────────────────────────────────────────

test('robots: buildRobots writes groups, AI block and sitemaps', () => {
  const out = rbt.buildRobots({
    groups: [
      { agents: '*', rules: [{ type: 'disallow', path: '/wp-admin/' }, { type: 'allow', path: '/wp-admin/admin-ajax.php' }], delay: '' },
      { agents: 'Bingbot', rules: [{ type: 'disallow', path: '/search' }], delay: '5' }
    ],
    aiBots: ['GPTBot', 'ClaudeBot'],
    sitemaps: 'https://example.com/sitemap.xml\n\n  https://example.com/news.xml  '
  });
  assert.equal(out.text, [
    'User-agent: *',
    'Disallow: /wp-admin/',
    'Allow: /wp-admin/admin-ajax.php',
    '',
    'User-agent: Bingbot',
    'Disallow: /search',
    'Crawl-delay: 5',
    '',
    'User-agent: GPTBot',
    'User-agent: ClaudeBot',
    'Disallow: /',
    '',
    'Sitemap: https://example.com/sitemap.xml',
    'Sitemap: https://example.com/news.xml',
    ''
  ].join('\n'));
  assert.deepEqual(out.notes, []);
});

test('robots: a group without rules gets an empty Disallow so it stays separate', () => {
  const out = rbt.buildRobots({
    groups: [{ agents: 'Googlebot', rules: [], delay: '' }, { agents: '*', rules: [{ type: 'disallow', path: '/' }], delay: '' }]
  });
  assert.equal(out.text, 'User-agent: Googlebot\nDisallow:\n\nUser-agent: *\nDisallow: /\n');
  const p = rbt.parseRobots(out.text);
  assert.equal(p.groups.length, 2);
  assert.equal(rbt.testPath(p, '/x', ['googlebot']).allowed, true);
});

test('robots: buildRobots fixes paths and reports skipped input', () => {
  const out = rbt.buildRobots({
    groups: [
      { agents: 'Googlebot, Bingbot', rules: [{ type: 'disallow', path: 'tmp/' }, { type: 'disallow', path: 'https://example.com/admin?x=1' }, { type: 'allow', path: '  ' }], delay: 'soon' },
      { agents: '  ', rules: [{ type: 'disallow', path: '/x' }], delay: '' }
    ]
  });
  assert.equal(out.text, 'User-agent: Googlebot\nUser-agent: Bingbot\nDisallow: /tmp/\nDisallow: /admin?x=1\n');
  assert.equal(out.notes.length, 4);
  assert.match(out.notes.join('\n'), /leading `\/`/);
  assert.match(out.notes.join('\n'), /not a number of seconds/);
  assert.match(out.notes.join('\n'), /Group 2 has no user-agent/);
});

test('robots: empty generator config produces empty output', () => {
  assert.deepEqual(rbt.buildRobots({ groups: [{ agents: '', rules: [], delay: '' }] }), { text: '', notes: [] });
});

test('robots: every preset produces a file without errors or warnings', () => {
  Object.keys(rbt.PRESETS).forEach((name) => {
    const out = rbt.buildRobots({ groups: rbt.PRESETS[name], sitemaps: 'https://example.com/sitemap.xml' });
    if (name === 'blank') {
      assert.equal(out.text, 'Sitemap: https://example.com/sitemap.xml\n');
      return;
    }
    const p = rbt.parseRobots(out.text);
    assert.equal(p.stats.errors, 0, name);
    // "block" intentionally warns about blocking the whole site
    assert.equal(p.stats.warnings, name === 'block' ? 1 : 0, name);
  });
});

test('robots: generated AI block really blocks those crawlers only', () => {
  const tokens = rbt.AI_BOTS.map((b) => b.token);
  const out = rbt.buildRobots({ groups: [{ agents: '*', rules: [], delay: '' }], aiBots: tokens });
  const p = rbt.parseRobots(out.text);
  tokens.forEach((t) => assert.equal(rbt.testPath(p, '/blog/', [t]).allowed, false, t));
  assert.equal(rbt.testPath(p, '/blog/', ['googlebot']).allowed, true);
});

test('robots: suggestTestPaths lists "/" and literal rule paths', () => {
  const p = parse(['User-agent: *', 'Disallow: /wp-admin/', 'Allow: /wp-admin/admin-ajax.php', 'Disallow: /*.pdf$', 'Disallow: /end$']);
  assert.deepEqual(rbt.suggestTestPaths(p), ['/', '/wp-admin/', '/wp-admin/admin-ajax.php', '/end']);
});

test('robots: suggestDirective finds close spellings only', () => {
  assert.equal(rbt.suggestDirective('Sitemaps'), 'Sitemap');
  assert.equal(rbt.suggestDirective('crawl_delay'), 'Crawl-delay');
  assert.equal(rbt.suggestDirective('Author'), null);
  assert.equal(rbt.editDistance('kitten', 'sitting'), 3);
});
