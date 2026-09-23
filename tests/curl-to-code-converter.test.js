// tests/curl-to-code-converter.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const crl = loadScript('curl-to-code-converter/script.js');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function req(cmd, dialect) {
  const parsed = crl.parseCommand(cmd, dialect || 'auto');
  return { parsed, request: parsed.request, notes: parsed.notes };
}

function code(cmd, target, dialect) {
  return crl.convert(cmd, target, dialect).code;
}

function notesOf(cmd, target, dialect) {
  return crl.convert(cmd, target || 'python', dialect).notes;
}

function hasNote(notes, level, pattern) {
  return notes.some((n) => n.level === level && pattern.test(n.flag + ' ' + n.text));
}

function args(src, dialect) {
  return crl.splitArgs(src, dialect).args;
}

// Compile generated JavaScript without running it (imports removed, top-level await allowed)
function compilesAsJs(source) {
  const body = source.split('\n').filter((l) => !/^import /.test(l)).join('\n');
  new AsyncFunction(body);
  return true;
}

// ── POSIX shell parsing ─────────────────────────────────

test('curl: POSIX quoting, escapes and line continuations', () => {
  assert.deepEqual(args(String.raw`curl 'a b' "c \"d\" \$e" f\ g \
  -H x`), ['curl', 'a b', 'c "d" $e', 'f g', '-H', 'x']);
  assert.deepEqual(args(`curl ''  ""`), ['curl', '', '']);
  assert.deepEqual(args(String.raw`curl "keep \n backslash"`), ['curl', String.raw`keep \n backslash`]);
});

test('curl: $\'...\' ANSI-C strings decode escapes to UTF-8', () => {
  assert.deepEqual(args(String.raw`curl $'it\'s\n\t\x41\101\\'`), ['curl', "it's\n\tAA\\"]);
  assert.deepEqual(args(String.raw`curl $'\xc3\xa9'`), ['curl', 'é']);
  assert.deepEqual(args(String.raw`curl $'\cA'`), ['curl', String.fromCharCode(1)]);
});

test('curl: comments, pipes and command separators', () => {
  const r = crl.splitArgs('curl https://x # a comment\n', 'posix');
  assert.deepEqual(r.args, ['curl', 'https://x']);
  const p = crl.splitArgs("curl -s https://x | jq '.items' && echo done", 'posix');
  assert.equal(p.commands.length, 3);
  assert.deepEqual(p.commands[1].args, ['jq', '.items']);
  assert.equal(p.commands[2].op, '&&');
});

test('curl: redirections, here-documents and here-strings', () => {
  const r = crl.splitArgs("curl -d @- https://x/a <<'EOF'\n{\"a\": 1}\nEOF\n", 'posix');
  assert.deepEqual(r.args, ['curl', '-d', '@-', 'https://x/a']);
  assert.equal(r.commands[0].stdin, '{"a": 1}\n');
  assert.equal(crl.splitArgs("curl --data-binary @- https://x <<< 'x=1'", 'posix').commands[0].stdin, 'x=1\n');
  const o = crl.splitArgs('curl https://x > out.json 2>/dev/null', 'posix');
  assert.deepEqual(o.args, ['curl', 'https://x']);
  assert.equal(o.commands[0].stdout, 'out.json');
});

test('curl: shell variables and command substitution are kept and reported', () => {
  const r = req('curl -H "Authorization: Bearer $TOKEN" https://x/$(date +%s)');
  assert.equal(r.request.headers[0].value, 'Bearer $TOKEN');
  assert.ok(hasNote(r.notes, 'warn', /\$TOKEN.*Shell variable/));
  assert.ok(hasNote(r.notes, 'warn', /Command substitution/));
});

test('curl: an unquoted & inside a URL is kept with a warning', () => {
  const r = req('curl https://x/?a=1&b=2');
  assert.equal(r.request.url, 'https://x/?a=1&b=2');
  assert.ok(hasNote(r.notes, 'warn', /unquoted &/));
});

test('curl: lines joined without a backslash are reported', () => {
  const r = req("curl https://x\n  -H 'X-A: 1'");
  assert.equal(r.request.headers[0].name, 'X-A');
  assert.ok(hasNote(r.notes, 'warn', /without a trailing backslash/));
});

// ── Windows cmd and PowerShell ──────────────────────────

test('curl: MS C runtime argument rules', () => {
  assert.deepEqual(crl.splitMsvcrt(String.raw`a "b c" d\"e f\\"g h" i\\j`), ['a', 'b c', 'd"e', 'f\\g h', 'i\\\\j']);
  assert.deepEqual(crl.splitMsvcrt('"a ""quoted"" word"'), ['a "quoted" word']);
});

test('curl: Chrome "Copy as cURL (cmd)" escaping', () => {
  const src = 'curl ^"https://x/s?q=a^%^20b^&n=5^" ^\n  -H ^"accept: */*^" ^\n  --data-raw ^"^{^\\^"k^\\^":^\\^"v w^\\^"^}^"';
  assert.equal(crl.detectDialect(src), 'cmd');
  assert.deepEqual(args(src, 'cmd'), ['curl', 'https://x/s?q=a%20b&n=5', '-H', 'accept: */*', '--data-raw', '{"k":"v w"}']);
});

test('curl: plain cmd commands with backslash-escaped quotes', () => {
  assert.deepEqual(args('curl -d "{\\"a\\":1}" "https://x"', 'cmd'), ['curl', '-d', '{"a":1}', 'https://x']);
  assert.ok(hasNote(req('curl -H "X: %TOKEN%" https://x', 'cmd').notes, 'warn', /%TOKEN%/));
});

test('curl: PowerShell quoting and backtick continuations', () => {
  const src = "curl.exe -H 'It''s' `\n  -H \"a `\"b`\" \"\"c\"\"\" https://x";
  assert.equal(crl.detectDialect(src), 'powershell');
  assert.deepEqual(args(src, 'powershell'), ['curl.exe', '-H', "It's", '-H', 'a "b" "c"', 'https://x']);
  const r = req("curl.exe -d '{\"a\":1}' https://x", 'powershell');
  assert.ok(hasNote(r.notes, 'warn', /PowerShell 7\.2 or older drop embedded double quotes/));
});

test('curl: dialect detection', () => {
  assert.equal(crl.detectDialect("curl 'https://x' \\\n -H a"), 'posix');
  assert.equal(crl.detectDialect('curl "https://x" ^\n -H a'), 'cmd');
  assert.equal(crl.detectDialect('curl https://x `\n -H a'), 'powershell');
});

// ── Finding curl ────────────────────────────────────────

test('curl: prompts, wrappers and non-curl input', () => {
  assert.equal(req('$ curl https://x').request.url, 'https://x');
  assert.equal(req('sudo curl https://x').request.url, 'https://x');
  assert.equal(req('https://x -H "A: b"').request.url, 'https://x');
  const w = req('wget https://x');
  assert.equal(w.request, null);
  assert.ok(hasNote(w.notes, 'error', /does not look like a curl command/));
  assert.ok(req('').parsed.empty);
});

// ── Option parsing ──────────────────────────────────────

test('curl: short option clusters and attached values', () => {
  const r = req('curl -sSLXPUT -HX-A:1 -d@body.json https://x');
  assert.equal(r.request.method, 'PUT');
  assert.equal(r.request.follow, true);
  assert.equal(r.request.headers[0].name, 'X-A');
  assert.deepEqual(r.request.body, { kind: 'file', file: 'body.json', strip: true });
});

test('curl: --opt=value, unknown options, "--" and typographic dashes', () => {
  const eq = req('curl --data=a=1 https://x');
  assert.equal(eq.request.body.text, 'a=1');
  assert.ok(hasNote(eq.notes, 'warn', /--option=value/));
  assert.ok(hasNote(req('curl --frobnicate https://x').notes, 'unsupported', /--frobnicate.*Unknown option/));
  assert.equal(req('curl -- -weird-host').request.url, 'http://-weird-host');
  const dash = req('curl ' + String.fromCharCode(0x2013) + 'X POST https://x');
  assert.equal(dash.request.method, 'POST');
  assert.ok(hasNote(dash.notes, 'warn', /typographic dash/));
  assert.equal(req('curl -L --no-location https://x').request.follow, false);
});

test('curl: missing option values and missing URL are errors', () => {
  assert.ok(hasNote(req('curl https://x -H').notes, 'error', /needs a value/));
  assert.ok(hasNote(req('curl -X POST').notes, 'error', /No URL found/));
  assert.ok(hasNote(req('curl ftp://x/file').notes, 'error', /Only http/));
});

test('curl: method inference follows curl', () => {
  assert.equal(req('curl https://x').request.method, 'GET');
  assert.equal(req('curl -d a=1 https://x').request.method, 'POST');
  assert.equal(req('curl -F a=1 https://x').request.method, 'POST');
  assert.equal(req('curl -I https://x').request.method, 'HEAD');
  assert.equal(req('curl -X patch https://x').request.method, 'PATCH');
  assert.equal(req('curl -X PROPFIND https://x').request.method, 'PROPFIND');
  const head = req('curl -X HEAD https://x');
  assert.ok(hasNote(head.notes, 'warn', /-X HEAD/));
});

test('curl: -G moves data into the query string', () => {
  const r = req("curl -G https://x/s?a=1 -d q=test --data-urlencode 'n=Zo Ann'");
  assert.equal(r.request.method, 'GET');
  assert.equal(r.request.body, null);
  assert.equal(r.request.url, 'https://x/s?a=1&q=test&n=Zo+Ann');
  assert.deepEqual(r.request.queryPairs.map((p) => p.rawName), ['a', 'q', 'n']);
});

test('curl: -T uploads with PUT and appends the file name to a trailing slash', () => {
  const r = req('curl -T "my file.txt" https://x/up/');
  assert.equal(r.request.method, 'PUT');
  assert.equal(r.request.url, 'https://x/up/my%20file.txt');
  assert.deepEqual(r.request.body, { kind: 'file', file: 'my file.txt', strip: false, upload: true });
  assert.equal(r.request.headers.length, 0);
});

// ── Headers ─────────────────────────────────────────────

test('curl: -A, -e, -b and -r become headers; -H wins over them', () => {
  const r = req("curl -A 'Agent/1' -e 'https://r/;auto' -b 'a=1' -b 'b=2' -r 0-99 https://x");
  assert.deepEqual(r.request.headers.map((h) => [h.name, h.value]), [
    ['User-Agent', 'Agent/1'], ['Referer', 'https://r/'], ['Cookie', 'a=1; b=2'], ['Range', 'bytes=0-99']
  ]);
  const w = req("curl -A one -H 'User-Agent: two' https://x");
  assert.deepEqual(w.request.headers.map((h) => h.value), ['two']);
  assert.ok(hasNote(req('curl -b cookies.txt https://x').notes, 'unsupported', /reads cookies from the file/));
});

test('curl: empty, removed, duplicate and Content-Length headers', () => {
  const r = req("curl -H 'X-Empty;' -H 'Accept:' -H 'X-M: a' -H 'X-M: b' -H 'Content-Length: 5' -H 'bogus' https://x");
  assert.deepEqual(r.request.headers.map((h) => [h.name, h.value]), [['X-Empty', ''], ['X-M', 'a, b']]);
  assert.ok(hasNote(r.notes, 'info', /Accept.*not to send/));
  assert.ok(hasNote(r.notes, 'warn', /more than once/));
  assert.ok(hasNote(r.notes, 'info', /Content-Length was left out/));
  assert.ok(hasNote(r.notes, 'warn', /has no colon/));
});

// ── Bodies ──────────────────────────────────────────────

test('curl: --data variants join with & and imply form Content-Type', () => {
  const r = req("curl -d a=1 --data-raw '@b' --data-urlencode 'c=x y&z' --data-urlencode '=v w' --data-urlencode 'p q' https://x");
  assert.equal(r.request.body.text, 'a=1&@b&c=x+y%26z&v+w&p+q');
  assert.deepEqual(r.request.headers, [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded', flag: null, implicit: true }]);
  assert.ok(hasNote(req('curl --data-urlencode n@file.txt https://x').notes, 'unsupported', /file "file\.txt"/));
});

test('curl: --json sets JSON headers and concatenates', () => {
  const r = req("curl --json '{\"a\":' --json '1}' https://x");
  assert.equal(r.request.body.text, '{"a":1}');
  assert.deepEqual(r.request.headers.map((h) => [h.name, h.value]), [['Content-Type', 'application/json'], ['Accept', 'application/json']]);
});

test('curl: -d @- reads a here-document and strips line breaks', () => {
  const r = req("curl -d @- https://x <<EOF\na=1\nb=2\nEOF");
  assert.equal(r.request.body.text, 'a=1b=2');
  assert.ok(hasNote(req('curl -d @- https://x').notes, 'unsupported', /standard input/));
});

test('curl: JSON-looking bodies without a Content-Type are flagged', () => {
  assert.ok(hasNote(req("curl -d '{\"a\":1}' https://x").notes, 'warn', /looks like JSON/));
  assert.ok(hasNote(req("curl -H 'Content-Type: application/json' -d '{bad' https://x").notes, 'warn', /not valid JSON/));
});

test('curl: -F parts, curl\'s type guessing and --form-string', () => {
  const r = req("curl -F 'n=v' -F 'f=@dir/photo.JPG' -F 'g=@t.bin;filename=a.txt' -F 'h=@x.dat;type=text/csv' -F 'c=<note.txt' --form-string 's=@literal' https://x");
  const parts = r.request.body.parts.map((p) => [p.name, p.kind, p.value, p.type, p.filename]);
  assert.deepEqual(parts, [
    ['n', 'text', 'v', null, null],
    ['f', 'file', 'dir/photo.JPG', 'image/jpeg', null],
    ['g', 'file', 't.bin', 'text/plain', 'a.txt'],
    ['h', 'file', 'x.dat', 'text/csv', null],
    ['c', 'filecontent', 'note.txt', null, null],
    ['s', 'text', '@literal', null, null]
  ]);
  const both = req('curl -F a=1 -d b=2 https://x');
  assert.ok(hasNote(both.notes, 'error', /refuses to combine/));
  const ct = req("curl -H 'Content-Type: multipart/form-data' -F a=1 https://x");
  assert.equal(ct.request.headers.length, 0);
});

// ── Auth, proxy, TLS, output ────────────────────────────

test('curl: authentication sources', () => {
  assert.deepEqual(req('curl -u al:pw https://x').request.auth, { type: 'basic', user: 'al', password: 'pw', flag: '-u' });
  const noPass = req('curl -u al https://x');
  assert.equal(noPass.request.auth.password, '');
  assert.ok(hasNote(noPass.notes, 'warn', /No password given/));
  const inUrl = req('curl https://us%40r:p%3Ass@x/y');
  assert.deepEqual([inUrl.request.auth.user, inUrl.request.auth.password, inUrl.request.url], ['us@r', 'p:ss', 'https://x/y']);
  assert.equal(req('curl --digest -u a:b https://x').request.auth.type, 'digest');
  const ntlm = req('curl --ntlm -u a:b https://x');
  assert.equal(ntlm.request.auth, null);
  assert.ok(hasNote(ntlm.notes, 'unsupported', /NTLM/));
  assert.equal(req("curl -u a:b -H 'Authorization: Token t' https://x").request.auth, null);
  assert.equal(req('curl --oauth2-bearer tk https://x').request.headers[0].value, 'Bearer tk');
});

test('curl: proxies get curl\'s default port', () => {
  const p = req('curl -x proxy.lan -U u:p https://x').request.proxy;
  assert.equal(p.url, 'http://u:p@proxy.lan:1080');
  assert.equal(req('curl --socks5-hostname 10.0.0.1:9050 https://x').request.proxy.url, 'socks5h://10.0.0.1:9050');
});

test('curl: output flags', () => {
  assert.equal(req('curl -o out.bin https://x').request.output, 'out.bin');
  assert.equal(req('curl -O https://x/files/report.pdf?v=2').request.output, 'report.pdf');
  assert.equal(req('curl https://x > page.html').request.output, 'page.html');
  const dn = req('curl -o /dev/null https://x').request;
  assert.deepEqual([dn.output, dn.discard], [null, true]);
});

test('curl: glob patterns and several URLs are reported', () => {
  assert.ok(hasNote(req("curl 'https://x/{a,b}'").notes, 'unsupported', /glob pattern/));
  assert.ok(!hasNote(req("curl -g 'https://x/{a,b}'").notes, 'unsupported', /glob pattern/));
  assert.ok(hasNote(req('curl https://x/1 https://x/2').notes, 'unsupported', /2 URLs/));
});

test('curl: output-only and unsupported flags are classified', () => {
  const notes = req('curl -s -v --retry 3 --http2 --resolve x:443:1.2.3.4 --tcp-nodelay https://x').notes;
  assert.ok(hasNote(notes, 'info', /^-s Only affects/));
  assert.ok(hasNote(notes, 'info', /^-v Only affects/));
  assert.ok(hasNote(notes, 'unsupported', /--retry Retries/));
  assert.ok(hasNote(notes, 'unsupported', /--http2 The HTTP version/));
  assert.ok(hasNote(notes, 'unsupported', /--resolve Pins/));
  assert.ok(hasNote(notes, 'unsupported', /--tcp-nodelay Connection tuning/));
});

// ── Python generator ────────────────────────────────────

test('curl → Python: params split only when requests re-encodes them identically', () => {
  const split = code("curl 'https://x/s?page=2&q=a+b&e='", 'python');
  assert.match(split, /params = \{\n    'page': '2',\n    'q': 'a b',\n    'e': '',\n\}/);
  assert.match(split, /requests\.get\('https:\/\/x\/s', params=params\)/);
  const kept = code("curl 'https://x/s?q=a%20b&flag'", 'python');
  assert.doesNotMatch(kept, /params/);
  assert.match(kept, /'https:\/\/x\/s\?q=a%20b&flag'/);
});

test('curl → Python: JSON, form dicts, raw strings and .encode()', () => {
  const json = code("curl -H 'Content-Type: application/json' -d '{\"a\":true,\"b\":null,\"n\":12345678901234567890}' https://x", 'python');
  assert.match(json, /json_data = \{\n    'a': True,\n    'b': None,\n    'n': 12345678901234567890,\n\}/);
  assert.match(json, /json=json_data/);
  const form = code('curl -d grant_type=client_credentials -d scope=read+write https://x', 'python');
  assert.match(form, /data = \{\n    'grant_type': 'client_credentials',\n    'scope': 'read write',\n\}/);
  assert.doesNotMatch(form, /Content-Type/);
  const raw = code("curl -d 'name=Zoë Ann' https://x", 'python');
  assert.match(raw, /data = 'name=Zoë Ann'\.encode\(\)/);
  assert.match(raw, /'Content-Type': 'application\/x-www-form-urlencoded'/);
});

test('curl → Python: numbers a double cannot hold keep the original string', () => {
  const src = "curl --json '{\"p\":0.1000000000000000055511151231257827}' https://x";
  assert.match(code(src, 'python'), /data = '\{"p":0\.1000000000000000055511151231257827\}'/);
});

test('curl → Python: cookies, files, auth, proxies, TLS, timeouts and output', () => {
  const py = code("curl -b 'sid=1; th=dark' -F 'f=@a.png' -F 'n=v' -u 'zoë:pw' -x p.lan:3128 -k --connect-timeout 5 -m 30 -f -o out.bin https://x", 'python');
  assert.match(py, /cookies = \{\n    'sid': '1',\n    'th': 'dark',\n\}/);
  assert.match(py, /'f': \('a\.png', open\('a\.png', 'rb'\), 'image\/png'\),\n    'n': \(None, 'v'\),/);
  assert.match(py, /auth=\('zoë'\.encode\(\), 'pw'\)/);
  assert.match(py, /'https': 'http:\/\/p\.lan:3128'/);
  assert.match(py, /verify=False/);
  assert.match(py, /timeout=\(5, 30\)/);
  assert.match(py, /response\.raise_for_status\(\)/);
  assert.match(py, /with open\('out\.bin', 'wb'\) as f:\n    f\.write\(response\.content\)/);
  assert.match(code('curl --digest -u a:b https://x', 'python'), /from requests\.auth import HTTPDigestAuth[\s\S]*auth=HTTPDigestAuth\('a', 'b'\)/);
  assert.match(code('curl -X PURGE https://x', 'python'), /requests\.request\('PURGE', 'https:\/\/x'\)/);
  assert.match(code('curl -I -L https://x', 'python'), /requests\.head\('https:\/\/x', allow_redirects=True\)/);
  assert.match(code('curl -d @data.txt https://x', 'python'), /with open\('data\.txt', 'rb'\) as f:\n    data = f\.read\(\)\.replace\(b'\\r', b''\)\.replace\(b'\\n', b''\)/);
});

// ── fetch (browser) ─────────────────────────────────────

test('curl → fetch: headers the browser controls are left out', () => {
  const src = "curl -H 'Origin: https://a' -H 'sec-fetch-mode: cors' -H 'X-Ok: 1' -b 's=1' -e 'https://r/' https://x";
  const js = code(src, 'fetch');
  assert.match(js, /\/\/ Left out, the browser controls them: Origin, sec-fetch-mode, Cookie/);
  assert.match(js, /'X-Ok': '1'/);
  assert.doesNotMatch(js, /'Origin'/);
  assert.match(js, /referrer: 'https:\/\/r\/'/);
  assert.match(js, /credentials: 'include'/);
  const notes = notesOf(src, 'fetch');
  assert.ok(hasNote(notes, 'warn', /Cookie/));
  assert.ok(hasNote(notes, 'info', /CORS/));
});

test('curl → fetch: auth, timeouts, bodies and browser limits', () => {
  const js = code("curl -u a:b -m 2.5 -H 'Content-Type: application/json' -d '{\"k\":[1,2]}' https://x", 'fetch');
  assert.match(js, /'Authorization': 'Basic ' \+ btoa\('a:b'\)/);
  assert.match(js, /body: JSON\.stringify\(\{\n    k: \[1, 2\],\n  \}\)/);
  assert.match(js, /signal: AbortSignal\.timeout\(2500\)/);
  assert.ok(code('curl -u zoë:pw https://x', 'fetch').includes("'Authorization': 'Basic " + Buffer.from('zoë:pw').toString('base64') + "'"));
  const get = notesOf('curl -X GET -d a=1 https://x', 'fetch');
  assert.ok(hasNote(get, 'warn', /cannot send a body with a GET/));
  assert.doesNotMatch(code('curl -X GET -d a=1 https://x', 'fetch'), /body:/);
  assert.ok(hasNote(notesOf('curl -k https://x', 'fetch'), 'unsupported', /never skip certificate checks/));
  assert.match(code("curl -F 'f=@a.txt' https://x", 'fetch'), /const file1 = fileInputs\[0\]\.files\[0\]; \/\/ a\.txt/);
});

test('curl → fetch: numbers JavaScript cannot hold stay as the original string', () => {
  assert.match(code("curl --json '{\"id\":9007199254740993}' https://x", 'fetch'), /body: '\{"id":9007199254740993\}'/);
  assert.match(code("curl --json '{\"__proto__\":1}' https://x", 'fetch'), /body: '\{"__proto__":1\}'/);
  assert.match(code("curl --json '{\"n\":9007199254740991}' https://x", 'fetch'), /n: 9007199254740991/);
});

// ── Node.js fetch and axios ─────────────────────────────

test('curl → Node fetch: Buffer auth, fs and undici for TLS and proxies', () => {
  const js = code('curl -u a:b -k -T up.bin -o res.bin https://x/put', 'node-fetch');
  assert.match(js, /import \{ fetch, Agent \} from 'undici';/);
  assert.match(js, /import \{ readFileSync, writeFileSync \} from 'node:fs';/);
  assert.match(js, /Buffer\.from\('a:b'\)\.toString\('base64'\)/);
  assert.match(js, /dispatcher: new Agent\(\{ connect: \{ rejectUnauthorized: false \} \}\)/);
  assert.match(js, /writeFileSync\('res\.bin', Buffer\.from\(await response\.arrayBuffer\(\)\)\);/);
  assert.match(code('curl -x http://p:8080 https://x', 'node-fetch'), /new ProxyAgent\(\{ uri: 'http:\/\/p:8080' \}\)/);
  assert.ok(hasNote(notesOf('curl --socks5 p:1080 https://x', 'node-fetch'), 'unsupported', /SOCKS/));
});

test('curl → axios: config object, auth, agents, proxy and Content-Type false', () => {
  const js = code("curl -X POST -u a:b -k -x http://u:p@proxy:3128 -m 10 --json '{\"a\":1}' https://x", 'node-axios');
  assert.match(js, /method: 'post'/);
  assert.match(js, /data: \{\n    a: 1,\n  \}/);
  assert.match(js, /auth: \{ username: 'a', password: 'b' \}/);
  assert.match(js, /timeout: 10000/);
  assert.match(js, /httpsAgent: new https\.Agent\(\{ rejectUnauthorized: false \}\)/);
  assert.match(js, /proxy: \{ protocol: 'http', host: 'proxy', port: 3128, auth: \{ username: 'u', password: 'p' \} \}/);
  assert.match(code('curl -T f.bin https://x/', 'node-axios'), /'Content-Type': false/);
  assert.match(code('curl -o f.bin https://x', 'node-axios'), /responseType: 'arraybuffer'[\s\S]*writeFileSync\('f\.bin', response\.data\);/);
});

test('curl → all targets: every sample converts and the JavaScript compiles', () => {
  Object.keys(crl.SAMPLES).forEach((key) => {
    ['python', 'fetch', 'node-fetch', 'node-axios'].forEach((target) => {
      const out = crl.convert(crl.SAMPLES[key], target);
      assert.ok(out.code.length > 0, key + ' → ' + target);
      assert.ok(!out.notes.some((n) => n.level === 'error'), key + ' → ' + target + ' has errors');
      if (target !== 'python') assert.ok(compilesAsJs(out.code), key + ' → ' + target);
    });
  });
});

test('curl → JavaScript targets compile for tricky inputs', () => {
  const tricky = [
    "curl -F 'a=<n.txt' -F 'b=@p.jpg;filename=x.png;type=image/png' https://x",
    "curl -d @- https://x <<< \"it's \\\\ fine\"",
    "curl --data-raw $'line1\\nline2\\u2028end' -H 'Content-Type: text/plain' https://x",
    "curl -H 'X-Q: \"quoted\" \\\\ back' https://x"
  ];
  tricky.forEach((src) => {
    ['fetch', 'node-fetch', 'node-axios'].forEach((t) => assert.ok(compilesAsJs(code(src, t)), src + ' → ' + t));
  });
});

// ── Helpers ─────────────────────────────────────────────

test('curl: encoders and decoders', () => {
  assert.equal(crl.curlEscape("a b~-._!*'()/é"), 'a%20b~-._%21%2A%27%28%29%2F%C3%A9');
  assert.equal(crl.formEscape("a b~-._!*'()/é"), 'a+b~-._%21%2A%27%28%29%2F%C3%A9');
  assert.equal(crl.percentDecode('a+b%20c%C3%A9%zz', true), 'a b cé%zz');
  assert.equal(crl.base64([1, 2, 3, 4]), Buffer.from([1, 2, 3, 4]).toString('base64'));
  assert.equal(crl.pairsRoundTrip('a=1&b=x+y'), true);
  assert.equal(crl.pairsRoundTrip('a=%2f'), false);
  assert.equal(crl.pairsRoundTrip('flag'), false);
});

test('curl: JSON parser keeps number text and reports errors', () => {
  const tree = crl.parseJsonTree('{"a":[1,-2.50e3,true,null,"s"],"a":0}');
  assert.equal(tree.duplicate, true);
  assert.deepEqual(tree.entries[0].value.items.map((i) => i.raw || i.value), ['1', '-2.50e3', true, undefined, 's']);
  assert.throws(() => crl.parseJsonTree('{"a":1,}'), /expected a property name/);
  assert.throws(() => crl.parseJsonTree('[1] x'), /unexpected text/);
  assert.equal(crl.treeSafe(crl.parseJsonTree('[0.1, 1e21, 9007199254740991]'), 'js'), true);
  assert.equal(crl.treeSafe(crl.parseJsonTree('[0.12345678901234567]'), 'js'), false);
});

test('curl: string literals are valid in Python and JavaScript', () => {
  assert.equal(crl.quoteStr("it's"), '"it\'s"');
  assert.equal(crl.quoteStr('a\'b"c\\\n\t' + String.fromCharCode(1)), "'a\\'b\"c\\\\\\n\\t\\x01'");
  assert.equal(eval(crl.quoteStr('x' + String.fromCharCode(0x2028) + 'y')), 'x' + String.fromCharCode(0x2028) + 'y');
});

test('curl: highlighting escapes HTML', () => {
  const html = crl.highlight("const a = '<b>'; // <i>", 'js');
  assert.match(html, /<span class="crl-tk-kw">const<\/span>/);
  assert.match(html, /<span class="crl-tk-str">'&lt;b&gt;'<\/span>/);
  assert.match(html, /<span class="crl-tk-com">\/\/ &lt;i&gt;<\/span>/);
});
