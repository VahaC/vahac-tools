// tests/traefik-docker-labels-generator.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript } = require('./_setup');

const tdl = loadScript('traefik-docker-labels-generator/script.js');

const DOLLAR = '$';
const state = (patch) => Object.assign(tdl.defaultState(), patch || {});
const gen = (patch) => tdl.generate(state(patch));
const labelMap = (r) => Object.fromEntries(r.labels.map((l) => [l.key, l.value]));
const texts = (r, level) => r.issues.filter((i) => !level || i.level === level).map((i) => tdl.plain(i.text));
const hasIssue = (r, level, re) => texts(r, level).some((t) => re.test(t));

// Real hashes in the formats Traefik accepts (the apr1 line is the example from the Traefik BasicAuth docs).
const APR1 = 'test:$apr1$H6uskkkW$IgXLP6ewTrSuBkTrqE8wj/';
const APR1B = 'test2:$apr1$d9hr9HBB$4HxwgUir3HP4EsggP/QNo0';
const BCRYPT = 'admin:$2y$05$abcdefghijklmnopqrstuuJ0dQ9XxXxXxXxXxXxXxXxXxXxXxXxXy';
const MD5CRYPT = 'old:$1$saltsalt$qjXMvbEw8oaL.CzflDugX/';
const SHA1 = 'legacy:{SHA}qUqP5cyxm6YcTAhz05Hph5gvu9M=';

// ─────────────────────────────────────────────────────────────────────────────
// A strict parser for the YAML subset the tool writes (block mappings, block
// sequences, quoted and plain scalars, comments, {}). It throws on anything
// else, so output that drifts outside the subset fails loudly. The repository
// has no YAML parser to require: the YAML/JSON/TOML converter loads js-yaml
// from a CDN in the browser and only exports its TOML parser.
// ─────────────────────────────────────────────────────────────────────────────

function stripComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"') {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') quote = '';
    } else if (quote === "'") {
      if (ch === "'") quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || line[i - 1] === ' ')) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  if (quote) throw new Error('unterminated quote: ' + line);
  return line.replace(/\s+$/, '');
}

function scalar(s, where) {
  if (s[0] === '"') {
    let out = '';
    let i = 1;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\') {
        const nx = s[++i];
        if (nx === '\\' || nx === '"') out += nx;
        else throw new Error('unsupported escape \\' + nx + ' at ' + where);
      } else if (ch === '"') {
        break;
      } else {
        out += ch;
      }
    }
    if (i !== s.length - 1) throw new Error('text after closing quote at ' + where + ': ' + s);
    return out;
  }
  if (s[0] === "'") {
    if (!/^'([^']|'')*'$/.test(s)) throw new Error('bad single-quoted scalar at ' + where);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s === '{}') return {};
  if (s === '[]') return [];
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === 'null' || s === '~') return null;
  if (/^-?[0-9]+$/.test(s)) return Number(s);
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) || / #|: /.test(s) || /:$/.test(s)) {
    throw new Error('plain scalar needs quoting at ' + where + ': ' + s);
  }
  return s;
}

function parseYaml(text) {
  const lines = [];
  text.split('\n').forEach((raw, i) => {
    if (raw.includes('\t')) throw new Error('tab on line ' + (i + 1));
    const stripped = stripComment(raw);
    if (stripped.trim() === '') return;
    lines.push({ indent: stripped.match(/^ */)[0].length, text: stripped.trim(), n: i + 1 });
  });
  let pos = 0;
  const isItem = (l) => l.text === '-' || l.text.startsWith('- ');

  function block(indent) {
    return isItem(lines[pos]) ? seq(indent) : map(indent);
  }
  function splitKey(l) {
    const m = /^([A-Za-z0-9_.\/\[\]-]+):(?: (.*))?$/.exec(l.text);
    if (!m) throw new Error('expected "key: value" on line ' + l.n + ': ' + l.text);
    return { key: m[1], rest: m[2] === undefined ? '' : m[2] };
  }
  function map(indent) {
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent && !isItem(lines[pos])) {
      const l = lines[pos];
      const { key, rest } = splitKey(l);
      if (Object.prototype.hasOwnProperty.call(obj, key)) throw new Error('duplicate key ' + key + ' on line ' + l.n);
      pos++;
      if (rest !== '') {
        obj[key] = scalar(rest, 'line ' + l.n);
      } else if (pos < lines.length && lines[pos].indent > indent) {
        obj[key] = block(lines[pos].indent);
      } else if (pos < lines.length && lines[pos].indent === indent && isItem(lines[pos])) {
        obj[key] = seq(indent);
      } else {
        obj[key] = null;
      }
    }
    if (pos < lines.length && lines[pos].indent > indent) throw new Error('bad indentation on line ' + lines[pos].n);
    return obj;
  }
  function seq(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && isItem(lines[pos])) {
      const l = lines[pos];
      const rest = l.text.slice(2);
      if (/^[A-Za-z0-9_.\/-]+:( |$)/.test(rest)) {
        lines[pos] = { indent: indent + 2, text: rest, n: l.n };
        arr.push(map(indent + 2));
      } else {
        arr.push(scalar(rest, 'line ' + l.n));
        pos++;
      }
    }
    return arr;
  }
  const doc = block(lines[0].indent);
  if (pos !== lines.length) throw new Error('unparsed content from line ' + lines[pos].n);
  return doc;
}

// Compose interpolation per the Compose Specification: "$$" is a literal "$",
// "$NAME" and "${...}" are variables (none may survive here), any other "$" stays.
function composeInterpolate(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== DOLLAR) { out += s[i]; continue; }
    const nx = s[i + 1] || '';
    if (nx === DOLLAR) { out += DOLLAR; i++; continue; }
    if (nx === '{' || /[_a-zA-Z]/.test(nx)) throw new Error('Compose would interpolate a variable at ' + i + ' in ' + s);
    out += DOLLAR;
  }
  return out;
}

// Labels → dynamic configuration, decoded independently of script.js.
// Label segment → file-provider key, matched by hand between the generated
// references docker-labels.yml and file.yaml (Traefik v3.7.16 and v2.11.60).
const FILE_KEY = {
  entrypoints: 'entryPoints', middlewares: 'middlewares', rule: 'rule', service: 'service', tls: 'tls', certresolver: 'certResolver',
  redirectscheme: 'redirectScheme', scheme: 'scheme', permanent: 'permanent',
  headers: 'headers', stsseconds: 'stsSeconds', stsincludesubdomains: 'stsIncludeSubdomains', framedeny: 'frameDeny',
  customframeoptionsvalue: 'customFrameOptionsValue', contenttypenosniff: 'contentTypeNosniff', referrerpolicy: 'referrerPolicy',
  ipallowlist: 'ipAllowList', ipwhitelist: 'ipWhiteList', sourcerange: 'sourceRange',
  basicauth: 'basicAuth', users: 'users', stripprefix: 'stripPrefix', prefixes: 'prefixes'
};
const LIST_FIELDS = new Set(['entryPoints', 'middlewares', 'sourceRange', 'users', 'prefixes']);
const BOOL_FIELDS = new Set(['permanent', 'stsIncludeSubdomains', 'frameDeny', 'contentTypeNosniff']);
const INT_FIELDS = new Set(['stsSeconds']);

function labelsToDynamic(labels) {
  const out = { routers: {}, middlewares: {}, services: {}, provider: {} };
  for (const [key, value] of Object.entries(labels)) {
    const parts = key.split('.');
    assert.equal(parts[0], 'traefik', key);
    if (parts[1] === 'enable') { out.provider.enable = value; continue; }
    if (parts[1] === 'docker') { out.provider[parts.slice(2).join('.')] = value; continue; }
    assert.equal(parts[1], 'http', key);
    const kind = parts[2];
    assert.ok(['routers', 'services', 'middlewares'].includes(kind), key);
    const name = parts[3];
    let node = out[kind][name] = out[kind][name] || {};
    if (kind === 'services') { node[parts.slice(4).join('.')] = value; continue; }
    const p = parts.slice(4).map((x) => {
      assert.ok(FILE_KEY[x], 'unknown label segment ' + x + ' in ' + key);
      return FILE_KEY[x];
    });
    if (kind === 'routers' && p.length === 1 && p[0] === 'tls') {
      assert.equal(value, 'true');
      node.tls = node.tls || {};
      continue;
    }
    for (let i = 0; i < p.length - 1; i++) node = node[p[i]] = node[p[i]] || {};
    const leaf = p[p.length - 1];
    node[leaf] = LIST_FIELDS.has(leaf) ? value.split(',') : BOOL_FIELDS.has(leaf) ? value === 'true' : INT_FIELDS.has(leaf) ? Number(value) : value;
  }
  return out;
}

function assertEquivalent(r) {
  const dyn = labelsToDynamic(labelMap(r));
  const file = parseYaml(r.fileYaml).http;
  assert.deepEqual(dyn.routers, file.routers, 'routers');
  assert.deepEqual(dyn.middlewares, file.middlewares || {}, 'middlewares');
  assert.deepEqual(Object.keys(dyn.services), Object.keys(file.services), 'service names');
  for (const name of Object.keys(dyn.services)) {
    const lb = dyn.services[name];
    const scheme = lb['loadbalancer.server.scheme'] || 'http';
    assert.deepEqual(file.services[name], {
      loadBalancer: { servers: [{ url: scheme + '://' + r.state.svc.trim() + ':' + lb['loadbalancer.server.port'] }] }
    });
  }
  return { dyn, file };
}

function parsedList(r) {
  const doc = parseYaml(r.listYaml);
  return Object.fromEntries(doc.labels.map((item) => {
    const s = composeInterpolate(item);
    const i = s.indexOf('=');
    return [s.slice(0, i), s.slice(i + 1)];
  }));
}

function parsedMap(r) {
  const doc = parseYaml(r.mapYaml);
  return Object.fromEntries(Object.entries(doc.labels).map(([k, v]) => {
    assert.equal(typeof v, 'string', k + ' must stay a string');
    return [k, composeInterpolate(v)];
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

test('default state produces the documented label set for an HTTPS router with a redirect router', () => {
  const r = gen();
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.labels.map((l) => l.key + '=' + l.value), [
    'traefik.enable=true',
    'traefik.docker.network=proxy',
    'traefik.http.routers.whoami.rule=Host(`whoami.example.com`)',
    'traefik.http.routers.whoami.entrypoints=websecure',
    'traefik.http.routers.whoami.service=whoami',
    'traefik.http.routers.whoami.tls=true',
    'traefik.http.routers.whoami.tls.certresolver=letsencrypt',
    'traefik.http.routers.whoami-http.rule=Host(`whoami.example.com`)',
    'traefik.http.routers.whoami-http.entrypoints=web',
    'traefik.http.routers.whoami-http.middlewares=whoami-redirect-https',
    'traefik.http.routers.whoami-http.service=whoami',
    'traefik.http.services.whoami.loadbalancer.server.port=80',
    'traefik.http.middlewares.whoami-redirect-https.redirectscheme.scheme=https',
    'traefik.http.middlewares.whoami-redirect-https.redirectscheme.permanent=true'
  ]);
  assert.ok(r.labels.every((l) => l.why && !/undefined|NaN/.test(tdl.plain(l.why))), 'every label is explained');
});

test('list syntax: one double-quoted "key=value" item per label', () => {
  const r = gen();
  const lines = r.listYaml.trim().split('\n');
  assert.equal(lines[0], 'labels:');
  assert.equal(lines.length, r.labels.length + 1);
  for (const line of lines.slice(1)) assert.match(line, /^ {2}- ".+"$/);
  assert.equal(lines[3], '  - "traefik.http.routers.whoami.rule=Host(`whoami.example.com`)"');
});

test('map syntax: plain keys and double-quoted values, so YAML keeps "true" and "80" as strings', () => {
  const r = gen();
  const lines = r.mapYaml.trim().split('\n');
  assert.equal(lines[0], 'labels:');
  for (const line of lines.slice(1)) assert.match(line, /^ {2}traefik\.[a-z0-9.\[\]_-]+: ".*"$/);
  assert.ok(lines.includes('  traefik.enable: "true"'));
  assert.ok(lines.includes('  traefik.http.services.whoami.loadbalancer.server.port: "80"'));
  const parsed = parseYaml(r.mapYaml).labels;
  assert.equal(parsed['traefik.enable'], 'true');
  assert.equal(parsed['traefik.http.services.whoami.loadbalancer.server.port'], '80');
});

// ─────────────────────────────────────────────────────────────────────────────
// Every option
// ─────────────────────────────────────────────────────────────────────────────

test('traefik.enable is emitted only when asked, with a note about exposedByDefault otherwise', () => {
  assert.equal(labelMap(gen())['traefik.enable'], 'true');
  const off = gen({ enable: false });
  assert.equal(labelMap(off)['traefik.enable'], undefined);
  assert.ok(hasIssue(off, 'info', /exposedByDefault: true/));
  assert.match(off.staticYaml, /exposedByDefault: true/);
  assert.match(gen().staticYaml, /exposedByDefault: false/);
});

test('traefik.docker.network: external name as is, project-prefixed name for a network from this file', () => {
  assert.equal(labelMap(gen({ net: 'traefik_proxy' }))['traefik.docker.network'], 'traefik_proxy');
  const local = gen({ ext: false, project: 'stack' });
  assert.equal(labelMap(local)['traefik.docker.network'], 'stack_proxy');
  assert.ok(hasIssue(local, 'info', /stack_proxy/));
  assert.ok(hasIssue(local, 'info', /missing the project's prefix/));
  const snip = parseYaml(local.snippet);
  assert.deepEqual(snip.networks, { proxy: {} });
  assert.deepEqual(parseYaml(gen().snippet).networks, { proxy: { external: true } });
  const noProject = gen({ ext: false, project: '' });
  assert.equal(noProject.ok, false);
  assert.ok(hasIssue(noProject, 'error', /<project>_proxy/));
});

test('no network: no network label, no networks in the snippet, and a warning with the fix', () => {
  const r = gen({ net: '' });
  assert.equal(r.ok, true);
  assert.equal(labelMap(r)['traefik.docker.network'], undefined);
  const snip = parseYaml(r.snippet);
  assert.equal(snip.networks, undefined);
  assert.equal(snip.services.whoami.networks, undefined);
  assert.ok(hasIssue(r, 'warn', /No network set.*docker network create proxy/));
});

test('TLS off: no tls labels, no redirect router, no resolver in the static config', () => {
  const r = gen({ tls: false, eps: 'web' });
  const m = labelMap(r);
  assert.equal(m['traefik.http.routers.whoami.tls'], undefined);
  assert.equal(m['traefik.http.routers.whoami.tls.certresolver'], undefined);
  assert.equal(m['traefik.http.routers.whoami-http.rule'], undefined);
  assert.equal(parseYaml(r.fileYaml).http.routers.whoami.tls, undefined);
  assert.doesNotMatch(r.staticYaml, /certificatesResolvers/);
  assert.ok(hasIssue(r, 'info', /redirect is skipped/));
});

test('TLS without a resolver: tls=true alone, and an empty tls section in the file provider', () => {
  const r = gen({ resolver: '' });
  const m = labelMap(r);
  assert.equal(m['traefik.http.routers.whoami.tls'], 'true');
  assert.equal(m['traefik.http.routers.whoami.tls.certresolver'], undefined);
  assert.match(r.fileYaml, /\n {6}tls: \{\}\n/);
  assert.deepEqual(parseYaml(r.fileYaml).http.routers.whoami.tls, {});
  assert.ok(hasIssue(r, 'info', /self-signed default certificate/));
  assertEquivalent(r);
});

test('redirect modes: router labels, entrypoint-wide static config, or none', () => {
  const router = gen({ redirect: 'router' });
  assert.equal(labelMap(router)['traefik.http.routers.whoami-http.entrypoints'], 'web');
  assert.equal(labelMap(router)['traefik.http.middlewares.whoami-redirect-https.redirectscheme.scheme'], 'https');

  const ep = gen({ redirect: 'entrypoint' });
  const epLabels = Object.keys(labelMap(ep));
  assert.ok(!epLabels.some((k) => /whoami-http|redirectscheme/.test(k)));
  const st = parseYaml(ep.staticYaml);
  assert.deepEqual(st.entryPoints.web.http.redirections.entryPoint, { to: 'websecure', scheme: 'https', permanent: true });
  assert.match(ep.staticYaml, /--entryPoints\.web\.http\.redirections\.entryPoint\.to=websecure/);
  assert.ok(hasIssue(ep, 'info', /static config/));

  const none = gen({ redirect: 'none' });
  assert.ok(!Object.keys(labelMap(none)).some((k) => /whoami-http|redirectscheme/.test(k)));
  assert.equal(parseYaml(none.staticYaml).entryPoints.web.http, undefined);
  assert.ok(hasIssue(none, 'info', /No HTTP → HTTPS redirect/));
});

test('custom entrypoint names are used everywhere they appear', () => {
  const r = gen({ eps: 'https, internal', httpEp: 'http' });
  const m = labelMap(r);
  assert.equal(m['traefik.http.routers.whoami.entrypoints'], 'https,internal');
  assert.equal(m['traefik.http.routers.whoami-http.entrypoints'], 'http');
  const st = parseYaml(r.staticYaml);
  assert.deepEqual(Object.keys(st.entryPoints), ['http', 'https', 'internal']);
  assert.equal(st.entryPoints.https.address, ':443');
  assert.equal(st.entryPoints.http.address, ':80');
  assert.match(r.staticYaml, /internal:\n {4}address: ":443" {3}# set the port/);
  assert.equal(st.certificatesResolvers.letsencrypt.acme.httpChallenge.entryPoint, 'http');
});

test('path prefix: PathPrefix in the rule, optional StripPrefix middleware, notes about matching', () => {
  const r = gen({ path: '/app' });
  assert.equal(labelMap(r)['traefik.http.routers.whoami.rule'], 'Host(`whoami.example.com`) && PathPrefix(`/app`)');
  assert.equal(labelMap(r)['traefik.http.routers.whoami.middlewares'], undefined);
  assert.ok(hasIssue(r, 'info', /must serve under \/app/));
  const s = gen({ path: '/app', strip: true });
  assert.equal(labelMap(s)['traefik.http.routers.whoami.middlewares'], 'whoami-strip');
  assert.equal(labelMap(s)['traefik.http.middlewares.whoami-strip.stripprefix.prefixes'], '/app');
  assert.deepEqual(parseYaml(s.fileYaml).http.middlewares['whoami-strip'], { stripPrefix: { prefixes: ['/app'] } });
  assert.ok(hasIssue(s, 'info', /app sees \/ instead of \/app/));
  // Strip without a path does nothing
  assert.equal(labelMap(gen({ strip: true }))['traefik.http.routers.whoami.middlewares'], undefined);
  assert.ok(hasIssue(gen({ path: '/app/' }), 'info', /\/app itself does not match/));
});

test('backend scheme https adds server.scheme and an https URL in the file provider', () => {
  const r = gen({ scheme: 'https', port: '8443' });
  const m = labelMap(r);
  assert.equal(m['traefik.http.services.whoami.loadbalancer.server.port'], '8443');
  assert.equal(m['traefik.http.services.whoami.loadbalancer.server.scheme'], 'https');
  assert.equal(parseYaml(r.fileYaml).http.services.whoami.loadBalancer.servers[0].url, 'https://whoami:8443');
  assert.ok(hasIssue(r, 'info', /serversTransport/));
  assert.ok(hasIssue(gen({ port: '443' }), 'info', /serves HTTPS itself/));
  assert.equal(labelMap(gen())['traefik.http.services.whoami.loadbalancer.server.scheme'], undefined);
});

test('security headers: each option maps to its Traefik field', () => {
  const all = gen({ hdr: true, sts: '63072000', stsSub: true, frame: 'DENY', nosniff: true, referrer: 'no-referrer' });
  const m = labelMap(all);
  const p = 'traefik.http.middlewares.whoami-headers.headers.';
  assert.equal(m[p + 'stsseconds'], '63072000');
  assert.equal(m[p + 'stsincludesubdomains'], 'true');
  assert.equal(m[p + 'framedeny'], 'true');
  assert.equal(m[p + 'customframeoptionsvalue'], undefined);
  assert.equal(m[p + 'contenttypenosniff'], 'true');
  assert.equal(m[p + 'referrerpolicy'], 'no-referrer');
  assert.equal(m['traefik.http.routers.whoami.middlewares'], 'whoami-headers');
  assert.deepEqual(parseYaml(all.fileYaml).http.middlewares['whoami-headers'], {
    headers: { stsSeconds: 63072000, stsIncludeSubdomains: true, frameDeny: true, contentTypeNosniff: true, referrerPolicy: 'no-referrer' }
  });

  const same = labelMap(gen({ hdr: true, frame: 'SAMEORIGIN', sts: '0', stsSub: true, nosniff: false, referrer: 'off' }));
  assert.equal(same[p + 'customframeoptionsvalue'], 'SAMEORIGIN');
  assert.equal(same[p + 'framedeny'], undefined);
  assert.equal(same[p + 'stsseconds'], undefined);
  assert.equal(same[p + 'stsincludesubdomains'], undefined, 'includeSubDomains needs a max-age');
  assert.equal(same[p + 'referrerpolicy'], undefined);
  assert.equal(same[p + 'contenttypenosniff'], undefined);

  const none = gen({ hdr: true, sts: '0', frame: 'off', nosniff: false, referrer: 'off' });
  assert.ok(!Object.keys(labelMap(none)).some((k) => k.includes('whoami-headers')));
  assert.ok(hasIssue(none, 'warn', /every header is off/));
  assert.equal(Object.keys(labelMap(gen({ hdr: false }))).filter((k) => k.includes('headers')).length, 0);
});

test('middleware order on the router: headers, IP allowlist, basic auth, strip prefix', () => {
  const r = gen({ hdr: true, ipOn: true, auth: true, users: BCRYPT, path: '/app', strip: true });
  assert.equal(labelMap(r)['traefik.http.routers.whoami.middlewares'], 'whoami-headers,whoami-ipallow,whoami-auth,whoami-strip');
  assert.deepEqual(parseYaml(r.fileYaml).http.routers.whoami.middlewares, ['whoami-headers', 'whoami-ipallow', 'whoami-auth', 'whoami-strip']);
  assert.deepEqual(parseYaml(r.fileYaml).http.routers['whoami-http'].middlewares, ['whoami-redirect-https']);
});

test('router name option renames the router, service and middlewares', () => {
  const r = gen({ router: 'blog', hdr: true });
  const keys = Object.keys(labelMap(r));
  assert.ok(keys.includes('traefik.http.routers.blog.rule'));
  assert.ok(keys.includes('traefik.http.routers.blog-http.rule'));
  assert.ok(keys.includes('traefik.http.services.blog.loadbalancer.server.port'));
  assert.ok(keys.includes('traefik.http.middlewares.blog-headers.headers.framedeny'));
  assert.equal(labelMap(r)['traefik.http.routers.blog.service'], 'blog');
  // The file-provider URL still uses the Compose service name as host
  assert.equal(parseYaml(r.fileYaml).http.services.blog.loadBalancer.servers[0].url, 'http://whoami:80');
  // Derived from the service name when empty
  assert.ok(Object.keys(labelMap(gen({ svc: 'My.App' }))).includes('traefik.http.routers.my-app.rule'));
});

// ─────────────────────────────────────────────────────────────────────────────
// $ escaping
// ─────────────────────────────────────────────────────────────────────────────

test('htpasswd hashes: every $ doubled in Compose list and map labels, single in the file provider', () => {
  const r = gen({ auth: true, users: APR1 + '\n' + APR1B });
  assert.equal(r.ok, true);
  const key = 'traefik.http.middlewares.whoami-auth.basicauth.users';
  const raw = APR1 + ',' + APR1B;
  assert.equal(labelMap(r)[key], raw);

  const listLine = r.listYaml.split('\n').find((l) => l.includes('basicauth.users'));
  assert.equal(listLine, '  - "' + key + '=' + raw.split(DOLLAR).join(DOLLAR + DOLLAR) + '"');
  const mapLine = r.mapYaml.split('\n').find((l) => l.includes('basicauth.users'));
  assert.equal(mapLine, '  ' + key + ': "' + raw.split(DOLLAR).join(DOLLAR + DOLLAR) + '"');
  // No single $ left that Compose could read as a variable
  assert.doesNotMatch(r.listYaml.replace(/\$\$/g, ''), /\$/);
  assert.doesNotMatch(r.mapYaml.replace(/\$\$/g, ''), /\$/);
  assert.doesNotMatch(r.snippet.replace(/\$\$/g, ''), /\$/);
  // After Compose interpolation both syntaxes give back the raw lines
  assert.equal(parsedList(r)[key], raw);
  assert.equal(parsedMap(r)[key], raw);

  assert.ok(!r.fileYaml.includes(DOLLAR + DOLLAR), 'file-provider YAML must not double $');
  assert.deepEqual(parseYaml(r.fileYaml).http.middlewares['whoami-auth'], { basicAuth: { users: [APR1, APR1B] } });
  assertEquivalent(r);
});

test('the unescaped label would be broken by Compose: $apr1 is read as a variable', () => {
  assert.throws(() => composeInterpolate(APR1), /interpolate a variable/);
  assert.equal(composeInterpolate(tdl.composeEscape(APR1)), APR1);
  assert.equal(tdl.composeEscape('a$b$$c'), 'a$$b$$$$c');
  assert.equal(tdl.composeEscape('no dollar'), 'no dollar');
});

test('accepted hash formats: bcrypt, MD5 apr1 and $1$, {SHA} (with a warning)', () => {
  for (const line of [BCRYPT, APR1, MD5CRYPT, SHA1]) {
    const r = gen({ auth: true, users: line });
    assert.equal(r.ok, true, line + ': ' + texts(r, 'error').join(' | '));
  }
  assert.ok(hasIssue(gen({ auth: true, users: SHA1 }), 'warn', /unsalted SHA1/));
  assert.ok(!hasIssue(gen({ auth: true, users: BCRYPT }), 'warn', /SHA1/));
  const kinds = tdl.parseHtpasswd([BCRYPT, APR1, MD5CRYPT, SHA1].join('\r\n') + '\n\n').entries.map((e) => e.kind);
  assert.deepEqual(kinds, ['bcrypt', 'md5', 'md5', 'sha1']);
});

test('rejected htpasswd input names the line and the fix', () => {
  const cases = [
    ['admin:$$2y$$05$$abcdefghijklmnopqrstuuJ0dQ9XxXxXxXxXxXxXxXxXxXxXxXxXy', /already has doubled \$\$/],
    ['admin:$6$saltsalt$abcdefghijklmnopqrstuvwxyz0123456789', /\$6\$.*only accepts MD5.*htpasswd -nB admin/],
    ['admin:$5$saltsalt$abcdefghijklmnopqrstuvwxyz0123456789', /\$5\$.*openssl passwd -5/],
    ['admin:$y$j9T$abcdefghijklmnop$qrstuvwxyz', /\$y\$ \(yescrypt/],
    ['admin:$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA', /comma|\$argon2id\$/],
    ['admin:hunter2', /plain-text password.*htpasswd -nB admin/],
    ['admin:abCDefGHij123', /no hash Traefik recognises/],
    ['admin', /exactly one colon/],
    ['admin:x:y', /exactly one colon/],
    ['ad min:$2y$05$abcdefghijklmnopqrstuuJ0dQ9XxXxXxXxXxXxXxXxXxXxXxXxXy', /space or tab/],
    ['admin:$2y$05$tooShort', /bcrypt hash looks cut off/],
    ['admin:$apr1$H6uskkkW$IgXL', /MD5 hash looks cut off/],
    ['admin:{SHA}abc', /\{SHA\} hash looks cut off/],
    ['a,b:$2y$05$abcdefghijklmnopqrstuuJ0dQ9XxXxXxXxXxXxXxXxXxXxXxXxXy', /comma/]
  ];
  for (const [line, re] of cases) {
    const r = gen({ auth: true, users: line });
    assert.equal(r.ok, false, line);
    assert.ok(hasIssue(r, 'error', re), line + ' → ' + texts(r, 'error').join(' | '));
    assert.ok(hasIssue(r, 'error', /^Line 1/), 'names the line: ' + line);
    assert.equal(r.listYaml, '');
  }
  const second = gen({ auth: true, users: BCRYPT + '\nbroken' });
  assert.ok(hasIssue(second, 'error', /^Line 2/));
  const empty = gen({ auth: true, users: '  \n ' });
  assert.ok(hasIssue(empty, 'error', /Paste at least one htpasswd line/));
});

test('basic auth warnings: no TLS, duplicate users, labels are readable via docker inspect', () => {
  const noTls = gen({ auth: true, users: BCRYPT, tls: false, eps: 'web' });
  assert.ok(hasIssue(noTls, 'warn', /without TLS/));
  const dup = gen({ auth: true, users: BCRYPT + '\n' + BCRYPT.replace('admin', 'admin') });
  assert.ok(hasIssue(dup, 'warn', /admin appears more than once/));
  assert.ok(hasIssue(gen({ auth: true, users: BCRYPT }), 'info', /docker inspect/));
});

// ─────────────────────────────────────────────────────────────────────────────
// v3 versus v2
// ─────────────────────────────────────────────────────────────────────────────

test('rule syntax: v3 joins hosts with ||, v2 passes a list to Host()', () => {
  const hosts = ['a.example.com', 'b.example.com'];
  assert.equal(tdl.buildRule(hosts, '', 'v3'), 'Host(`a.example.com`) || Host(`b.example.com`)');
  assert.equal(tdl.buildRule(hosts, '/app', 'v3'), '(Host(`a.example.com`) || Host(`b.example.com`)) && PathPrefix(`/app`)');
  assert.equal(tdl.buildRule(hosts, '', 'v2'), 'Host(`a.example.com`, `b.example.com`)');
  assert.equal(tdl.buildRule(hosts, '/app', 'v2'), 'Host(`a.example.com`, `b.example.com`) && PathPrefix(`/app`)');
  assert.equal(tdl.buildRule(['a.example.com'], '/x', 'v3'), 'Host(`a.example.com`) && PathPrefix(`/x`)');
  assert.equal(tdl.buildRule(['a.example.com'], '/x', 'v2'), 'Host(`a.example.com`) && PathPrefix(`/x`)');

  const v3 = gen({ domains: 'a.example.com\nb.example.com, c.example.com' });
  assert.equal(labelMap(v3)['traefik.http.routers.whoami.rule'], 'Host(`a.example.com`) || Host(`b.example.com`) || Host(`c.example.com`)');
  const v2 = gen({ v: '2.11', domains: 'a.example.com b.example.com' });
  assert.equal(labelMap(v2)['traefik.http.routers.whoami.rule'], 'Host(`a.example.com`, `b.example.com`)');
  assert.equal(labelMap(gen({ v: '2.10', domains: 'a.example.com b.example.com' }))['traefik.http.routers.whoami.rule'],
    'Host(`a.example.com`, `b.example.com`)');
});

test('IP allowlist: ipAllowList on v3 and v2.11, ipWhiteList before v2.11', () => {
  const ips = '192.168.1.0/24, 10.8.0.0/24 fd00::/8';
  const expect = '192.168.1.0/24,10.8.0.0/24,fd00::/8';
  for (const v of ['3', '2.11']) {
    const r = gen({ v, ipOn: true, ips });
    assert.equal(labelMap(r)['traefik.http.middlewares.whoami-ipallow.ipallowlist.sourcerange'], expect, v);
    assert.deepEqual(parseYaml(r.fileYaml).http.middlewares['whoami-ipallow'], { ipAllowList: { sourceRange: expect.split(',') } });
    assert.ok(!r.listYaml.includes('ipwhitelist'));
    assertEquivalent(r);
  }
  const old = gen({ v: '2.10', ipOn: true, ips });
  assert.equal(labelMap(old)['traefik.http.middlewares.whoami-ipallow.ipwhitelist.sourcerange'], expect);
  assert.deepEqual(parseYaml(old.fileYaml).http.middlewares['whoami-ipallow'], { ipWhiteList: { sourceRange: expect.split(',') } });
  assert.ok(!old.listYaml.includes('ipallowlist'));
  assert.ok(hasIssue(old, 'info', /ipWhiteList is used because releases before v2.11/));
  assertEquivalent(old);
});

test('wildcard hosts: accepted on v3 with the v3.7.0 and DNS-01 notes, refused on v2 with the HostRegexp hint', () => {
  const r = gen({ domains: '*.example.com' });
  assert.equal(r.ok, true);
  assert.equal(labelMap(r)['traefik.http.routers.whoami.rule'], 'Host(`*.example.com`)');
  assert.ok(hasIssue(r, 'info', /v3\.7\.0 or newer.*not example\.com itself/));
  assert.ok(hasIssue(r, 'warn', /DNS-01.*dnsChallenge/));
  const st = parseYaml(r.staticYaml);
  assert.ok(st.certificatesResolvers.letsencrypt.acme.dnsChallenge);
  assert.equal(st.certificatesResolvers.letsencrypt.acme.httpChallenge, undefined);
  for (const v of ['2.11', '2.10']) {
    const bad = gen({ v, domains: '*.example.com' });
    assert.equal(bad.ok, false);
    assert.ok(hasIssue(bad, 'error', /need Traefik v3\.7 or newer.*HostRegexp\(`\{sub:\[a-z0-9-\]\+\}\.example\.com`\)/));
  }
  assert.equal(gen({ domains: '*.*.example.com' }).ok, false);
  assert.equal(gen({ domains: 'a.*.example.com' }).ok, false);
  assert.equal(gen({ domains: '*.com' }).ok, false);
  assert.equal(gen({ domains: '*' }).ok, false);
});

test('version hint names the rule syntax and the allowlist middleware', () => {
  assert.match(tdl.plain(tdl.VERSIONS['3'].hint), /joined with \|\|.*core\.defaultRuleSyntax: v2/);
  assert.match(tdl.plain(tdl.VERSIONS['2.11'].hint), /ipAllowList/);
  assert.match(tdl.plain(tdl.VERSIONS['2.10'].hint), /ipWhiteList/);
});

// ─────────────────────────────────────────────────────────────────────────────
// YAML quoting and equivalence
// ─────────────────────────────────────────────────────────────────────────────

const RICH = [
  {},
  { domains: 'a.example.com b.example.com', path: '/app', strip: true },
  { v: '2.11', domains: 'a.example.com b.example.com', path: '/x' },
  { v: '2.10', ipOn: true, ips: '10.0.0.0/8' },
  { hdr: true, stsSub: true, frame: 'SAMEORIGIN', ipOn: true, ips: '192.168.1.0/24 fd00::/8', auth: true, users: [BCRYPT, APR1, SHA1].join('\n') },
  { tls: false, eps: 'web', redirect: 'router' },
  { resolver: '', redirect: 'none' },
  { scheme: 'https', port: '8443', router: 'nas-ui', svc: 'nas', ext: false, project: 'home' },
  { domains: '*.example.com', auth: true, users: MD5CRYPT },
  { net: '', enable: false, redirect: 'entrypoint' }
];

test('rules with backticks round-trip through YAML in list, map and file output', () => {
  for (const patch of RICH) {
    const r = gen(patch);
    assert.equal(r.ok, true, JSON.stringify(patch) + texts(r, 'error').join(' | '));
    const want = labelMap(r);
    assert.deepEqual(parsedList(r), want, 'list ' + JSON.stringify(patch));
    assert.deepEqual(parsedMap(r), want, 'map ' + JSON.stringify(patch));
    const fileRules = Object.values(parseYaml(r.fileYaml).http.routers).map((x) => x.rule);
    for (const rule of fileRules) assert.ok(rule.includes('`'), rule);
  }
});

test('the double-quote escaper handles quotes and backslashes the YAML way', () => {
  assert.equal(tdl.yq('Host(`a`)'), '"Host(`a`)"');
  assert.equal(tdl.yq('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(scalar(tdl.yq('a"b\\c # not a comment: x'), 't'), 'a"b\\c # not a comment: x');
});

test('file-provider YAML is equivalent to the labels for every sample configuration', () => {
  for (const patch of RICH) {
    const r = gen(patch);
    const { dyn } = assertEquivalent(r);
    assert.equal(dyn.provider.enable, r.state.enable ? 'true' : undefined);
  }
});

test('the Compose snippet is valid YAML with the labels under the service', () => {
  for (const patch of RICH) {
    const r = gen(patch);
    const doc = parseYaml(r.snippet);
    const svc = doc.services[r.state.svc];
    assert.ok(svc, 'service key');
    const items = Object.fromEntries(svc.labels.map((x) => {
      const s = composeInterpolate(x);
      return [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)];
    }));
    assert.deepEqual(items, labelMap(r));
    if (r.state.net) assert.deepEqual(svc.networks, [r.state.net]);
    assert.equal(svc.ports, undefined, 'no published ports');
  }
  assert.equal(parseYaml(gen().snippet).services.whoami.image, 'traefik/whoami');
  assert.equal(parseYaml(gen({ img: '' }).snippet).services.whoami.image, undefined);
});

test('static config parses and lists entrypoints, provider and resolver', () => {
  const st = parseYaml(gen().staticYaml);
  assert.deepEqual(st.entryPoints, { web: { address: ':80' }, websecure: { address: ':443' } });
  assert.deepEqual(st.providers, { docker: { exposedByDefault: false } });
  assert.deepEqual(st.certificatesResolvers.letsencrypt.acme.httpChallenge, { entryPoint: 'web' });
  const flags = gen().staticYaml.split('\n').filter((l) => l.startsWith('#   - "--'));
  assert.ok(flags.includes('#   - "--entryPoints.websecure.address=:443"'));
  assert.ok(flags.includes('#   - "--providers.docker.exposedByDefault=false"'));
  assert.ok(flags.includes('#   - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

test('router, service and middleware names: no dots, no @, lowercase', () => {
  assert.equal(tdl.validateName('my-app_2'), '');
  assert.equal(tdl.validateName('my.app'), 'dot');
  assert.equal(tdl.validateName('app@docker'), 'at');
  assert.equal(tdl.validateName('MyApp'), 'upper');
  assert.equal(tdl.validateName('-app'), 'chars');
  assert.equal(tdl.validateName('a b'), 'chars');
  assert.equal(tdl.validateName(''), 'empty');
  for (const [name, re] of [['my.app', /split the label key/], ['app@docker', /@ separates a name/], ['MyApp', /case-insensitively/], ['a$b', /lowercase letters/]]) {
    const r = gen({ router: name });
    assert.equal(r.ok, false, name);
    assert.ok(hasIssue(r, 'error', re), name);
  }
  assert.equal(tdl.deriveName('My.App_1'), 'my-app_1');
  assert.equal(tdl.deriveName('--x--'), 'x');
});

test('Compose service names follow the Compose schema', () => {
  assert.equal(gen({ svc: 'web.app_1-x' }).ok, true);
  for (const bad of ['', 'my app', '-x', 'a/b', 'a$b']) {
    const r = gen({ svc: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

test('domains: host names only, ASCII, valid labels, no ports or paths', () => {
  const ok = (h, v) => tdl.validateHost(h, v || '3').ok;
  const err = (h, v) => tdl.plain(tdl.validateHost(h, v || '3').error);
  assert.ok(ok('app.example.com'));
  assert.ok(ok('nas'));
  assert.ok(ok('xn--bcher-kva.de'));
  assert.ok(ok('192.168.1.10'));
  assert.equal(tdl.validateHost('App.Example.COM', '3').host, 'app.example.com');
  assert.match(err('https://app.example.com/'), /host name only: app\.example\.com/);
  assert.match(err('app.example.com/admin'), /Path prefix/);
  assert.match(err('app.example.com:8443'), /Leave the port out/);
  assert.match(err('bücher.de'), /punycode/);
  assert.match(err('my_app.example.com'), /_ ?, which is not allowed|contains _/);
  assert.match(err('-app.example.com'), /must not start or end/);
  assert.match(err('app..example.com'), /empty label/);
  assert.match(err('app.example.com.'), /trailing dot/);
  assert.match(err('a'.repeat(64) + '.com'), /longer than 63/);
  assert.match(err(('a'.repeat(60) + '.').repeat(5) + 'com'), /longer than 253/);
  assert.match(err('999.1.1.1'), /neither a host name nor a valid IPv4/);
  assert.match(err('app.exa mple.com'), /a-z, 0-9/);

  const multi = gen({ domains: 'A.example.com a.example.com, b.example.com' });
  assert.equal(labelMap(multi)['traefik.http.routers.whoami.rule'], 'Host(`a.example.com`) || Host(`b.example.com`)');
  assert.ok(hasIssue(multi, 'info', /lowercased/));
  assert.ok(hasIssue(multi, 'info', /Removed 1 duplicate/));
  assert.ok(hasIssue(gen({ domains: '' }), 'error', /at least one domain/));
});

test('ACME warning for IP addresses and private names, not for public names', () => {
  assert.ok(hasIssue(gen({ domains: 'nas.lan' }), 'warn', /nas\.lan will probably not get one/));
  assert.ok(hasIssue(gen({ domains: '192.168.1.10' }), 'warn', /192\.168\.1\.10 will probably not get one/));
  assert.ok(hasIssue(gen({ domains: 'nas' }), 'warn', /Let's Encrypt/));
  assert.ok(!hasIssue(gen({ domains: 'nas.lan', resolver: '' }), 'warn', /Let's Encrypt/));
  assert.ok(!hasIssue(gen({ domains: 'app.example.com' }), 'warn', /Let's Encrypt/));
});

test('path prefix validation', () => {
  assert.equal(tdl.validatePath('').ok, true);
  assert.equal(tdl.validatePath('/app/v1').path, '/app/v1');
  assert.equal(tdl.validatePath('/a-b_c.d~e%20@f:g+h').ok, true);
  assert.match(tdl.plain(tdl.validatePath('app').error), /must start with \/, e\.g\. \/app/);
  assert.match(tdl.plain(tdl.validatePath('/').error), /matches every path/);
  for (const bad of ['/a b', '/a`b', '/a"b', '/a$b', '/{id}', "/a'b"]) {
    assert.equal(tdl.validatePath(bad).ok, false, bad);
  }
  assert.match(tdl.plain(tdl.validatePath('/a//b').error), /double slash/);
});

test('container port validation', () => {
  assert.equal(tdl.validatePort('80'), 80);
  assert.equal(tdl.validatePort(' 65535 '), 65535);
  for (const bad of ['0', '65536', 'abc', '80.5', '-1', '', '080', '1e3']) assert.equal(tdl.validatePort(bad), null, bad);
  const r = gen({ port: '99999' });
  assert.equal(r.ok, false);
  assert.ok(hasIssue(r, 'error', /99999 must be a whole number from 1 to 65535/));
});

test('entrypoint, resolver, network and project names', () => {
  assert.ok(hasIssue(gen({ eps: '' }), 'error', /at least one entrypoint/));
  assert.ok(hasIssue(gen({ eps: 'web.secure' }), 'error', /Entrypoint web\.secure/));
  assert.ok(hasIssue(gen({ resolver: 'lets encrypt' }), 'error', /Certificate resolver lets encrypt/));
  assert.ok(hasIssue(gen({ httpEp: 'w@b' }), 'error', /Plain-HTTP entrypoint w@b/));
  assert.ok(hasIssue(gen({ net: 'my net' }), 'error', /Network my net/));
  assert.ok(hasIssue(gen({ net: '-proxy' }), 'error', /Network -proxy/));
  assert.equal(gen({ net: 'proxy.v2_net-1' }).ok, true);
  assert.ok(hasIssue(gen({ ext: false, project: 'My Stack' }), 'error', /Project name My Stack/));
  assert.ok(hasIssue(gen({ img: 'bad image' }), 'error', /Image bad image/));
});

test('CIDR validation follows Go net.ParseIP / net.ParseCIDR', () => {
  const ok = (x) => tdl.validateCidr(x).ok;
  for (const good of ['192.168.1.0/24', '10.0.0.5', '0.0.0.0/0', '::1', '::/0', 'fd00::/8', '2001:db8::/32', '::ffff:192.0.2.1', 'fe80::1:2:3:4', '1:2:3:4:5:6:7:8']) {
    assert.ok(ok(good), good);
  }
  for (const bad of ['10.0.0.0/33', '300.1.1.1', '010.1.1.1', '10.0.0/8', 'fe80::/129', 'fe80::1%eth0', '1:2:3:4:5:6:7:8:9', '1::2::3', 'abc', '10.0.0.0/08', '10.0.0.0/', '::1.2.3.4:5']) {
    assert.ok(!ok(bad), bad);
  }
  assert.equal(tdl.validateCidr('192.168.1.5/24').network, '192.168.1.0/24');
  assert.equal(tdl.validateCidr('192.168.1.0/24').network, '');
  assert.equal(tdl.validateCidr('fd00::1/8').network, 'fd00::/8');
  assert.equal(tdl.validateCidr('2001:db8::/32').network, '');
  assert.equal(tdl.validateCidr('10.0.0.0/8').cidr, true);
  assert.equal(tdl.validateCidr('10.0.0.1').cidr, false);

  assert.ok(hasIssue(gen({ ipOn: true, ips: '192.168.1.5/24' }), 'info', /reads it as 192\.168\.1\.0\/24/));
  assert.ok(hasIssue(gen({ ipOn: true, ips: '0.0.0.0/0' }), 'warn', /every IPv4 address/));
  assert.ok(hasIssue(gen({ ipOn: true, ips: '::/0' }), 'warn', /every IPv6 address/));
  assert.ok(hasIssue(gen({ ipOn: true, ips: '010.0.0.1' }), 'error', /without leading zeros/));
  assert.ok(hasIssue(gen({ ipOn: true, ips: '10.0.0.0/40' }), 'error', /prefix length must be 0 to 32/));
  assert.ok(hasIssue(gen({ ipOn: true, ips: '' }), 'error', /at least one IP/));
  assert.ok(hasIssue(gen({ ipOn: true, ips: '10.0.0.0/8' }), 'info', /ipStrategy/));
});

// ─────────────────────────────────────────────────────────────────────────────
// Warnings on valid configurations
// ─────────────────────────────────────────────────────────────────────────────

test('router without TLS on an HTTPS-looking entrypoint, and TLS router on plain HTTP only', () => {
  const noTls = gen({ tls: false });
  assert.ok(hasIssue(noTls, 'warn', /listens on websecure without TLS.*404.*http\.tls/));
  const plainOnly = gen({ eps: 'web', redirect: 'none' });
  assert.ok(hasIssue(plainOnly, 'warn', /has TLS but listens only on web/));
  const both = gen({ eps: 'web,websecure' });
  assert.ok(hasIssue(both, 'warn', /web is both the redirect entrypoint/));
  assert.ok(!hasIssue(gen(), 'warn', /./));
});

test('HSTS warnings: no effect without TLS, and a test-first note with TLS', () => {
  assert.ok(hasIssue(gen({ hdr: true, tls: false, eps: 'web' }), 'warn', /only sent on HTTPS/));
  assert.ok(hasIssue(gen({ hdr: true }), 'info', /Try 1 day first/));
  assert.ok(!hasIssue(gen({ hdr: true, sts: '0' }), 'info', /HSTS/));
});

// ─────────────────────────────────────────────────────────────────────────────
// Invalid input and URL hash
// ─────────────────────────────────────────────────────────────────────────────

test('errors block every output and are listed first', () => {
  const r = gen({ domains: 'https://x.example.com', port: '0', tls: false });
  assert.equal(r.ok, false);
  for (const k of ['listYaml', 'mapYaml', 'snippet', 'fileYaml', 'staticYaml']) assert.equal(r[k], '', k);
  assert.deepEqual(r.labels, []);
  // Warnings about a configuration are only computed once it is valid.
  assert.deepEqual(r.issues.map((i) => i.level + ':' + i.field), ['error:domains', 'error:port']);
  const mixed = gen({ domains: 'https://x.example.com', ipOn: true, ips: '192.168.1.5/24' });
  assert.equal(mixed.issues[0].level, 'error');
  assert.deepEqual(mixed.issues.map((i) => i.level), ['error', 'info'], 'errors sorted before notes');
});

test('normalizeState repairs unknown values and keeps the right types', () => {
  const s = tdl.normalizeState({ v: '4', scheme: 'ftp', tls: 'yes', strip: '1', port: 8080, sts: '5', svc: 123, frame: 'ALLOW' });
  const d = tdl.defaultState();
  assert.equal(s.v, d.v);
  assert.equal(s.scheme, d.scheme);
  assert.equal(s.tls, d.tls);
  assert.equal(s.strip, true);
  assert.equal(s.port, '8080');
  assert.equal(s.sts, d.sts);
  assert.equal(s.svc, '123');
  assert.equal(s.frame, d.frame);
  assert.equal(tdl.normalizeState({ svc: 'x'.repeat(10000) }).svc.length, 4000);
  assert.deepEqual(tdl.normalizeState(null), d);
});

test('URL hash round-trips every setting except the htpasswd line', () => {
  const s = state({
    v: '2.11', svc: 'nas', img: 'linuxserver/nextcloud:latest', router: 'cloud', domains: 'a.example.com, b.example.com', path: '/x',
    strip: true, eps: 'https', port: '8443', scheme: 'https', tls: true, resolver: 'le', redirect: 'entrypoint', httpEp: 'http',
    enable: false, net: 'edge', ext: false, project: 'home', hdr: true, sts: '86400', stsSub: true, frame: 'SAMEORIGIN', nosniff: false,
    referrer: 'no-referrer', ipOn: true, ips: '10.0.0.0/8 & more=1', auth: true, users: BCRYPT
  });
  const hash = tdl.encodeHash(s);
  assert.ok(hash.startsWith('#'));
  assert.ok(!hash.includes('2y'), 'no hash in the URL');
  assert.ok(!decodeURIComponent(hash).includes(BCRYPT.split(':')[1]));
  assert.ok(!/(^|[#&])users=/.test(hash));
  const back = tdl.decodeHash(hash);
  assert.deepEqual(back, Object.assign({}, s, { users: '' }));
  assert.equal(tdl.encodeHash(tdl.defaultState()), '');
  assert.deepEqual(tdl.decodeHash(''), tdl.defaultState());
  assert.deepEqual(tdl.decodeHash('#zz=1&v=9&t=maybe&s=%E0%A4%A'), tdl.defaultState());
});

// ─────────────────────────────────────────────────────────────────────────────
// Source hygiene: the files go inside a WordPress block comment
// ─────────────────────────────────────────────────────────────────────────────

test('tool sources contain no comment delimiters, closing script tags or unicode escapes', () => {
  const dir = path.join(__dirname, '..', 'traefik-docker-labels-generator');
  const bs = String.fromCharCode(92);
  for (const f of ['index.html', 'style.css', 'script.js']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!text.includes('<' + '!--'), `${f}: HTML comment opener`);
    assert.ok(!text.includes('--' + '>'), `${f}: comment closer`);
    assert.ok(!new RegExp(bs + bs + 'u[0-9a-fA-F]{4}').test(text), `${f}: unicode escape`);
    const closers = text.toLowerCase().split('<' + '/script').length - 1;
    assert.equal(closers, f === 'index.html' ? 1 : 0, `${f}: closing script tags`);
  }
});

test('generated text never contains undefined, NaN or a comment closer', () => {
  for (const patch of RICH) {
    const r = gen(patch);
    const all = [r.listYaml, r.mapYaml, r.snippet, r.fileYaml, r.staticYaml].concat(r.issues.map((i) => tdl.plain(i.text)), r.labels.map((l) => tdl.plain(l.why))).join('\n');
    assert.doesNotMatch(all, /undefined|NaN|\[object Object\]/);
    assert.ok(!all.includes('--' + '>'));
  }
});
