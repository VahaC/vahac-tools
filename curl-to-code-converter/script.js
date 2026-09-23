// cURL to Code Converter — script.js
// Prefix: crl-
// Dependencies: none.
//
// A pasted command goes through three stages:
//   1. Shell parsing: split it into the exact argument list curl would receive,
//      following POSIX sh/bash/zsh rules (including the $'...' strings browser
//      DevTools produce), Windows cmd.exe plus the Microsoft C runtime, or
//      PowerShell.
//   2. curl option parsing: map the arguments onto a request model using curl's
//      own option table and defaults (method inference, implied headers,
//      --data joining, -G, -u, ...).
//   3. Code generation: emit fetch(), Python requests or Node.js (built-in
//      fetch or axios) code from that model.
// Anything that cannot be carried over is reported as a note instead of being
// dropped silently.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── Constants ───────────────────────────────────────────

  var MAX_INPUT = 256 * 1024;
  var CALL_WIDTH = 88;
  var NBSP = String.fromCharCode(0xA0);
  var SMART_SINGLE = String.fromCharCode(0x2018, 0x2019, 0x201A, 0x201B);
  var SMART_DOUBLE = String.fromCharCode(0x201C, 0x201D, 0x201E, 0x201F);
  var DASHES = String.fromCharCode(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212);
  var DASH_PREFIX_RE = new RegExp('^[' + DASHES + ']{1,2}');
  var SHOW_NEWLINE = String.fromCharCode(0x21B5);
  var SHOW_TAB = String.fromCharCode(0x2192);
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  var LEVEL_LABEL = { error: 'Error', unsupported: 'Not translated', warn: 'Check', info: 'Note' };
  var LEVEL_RANK = { error: 0, unsupported: 1, warn: 2, info: 3 };
  var COUNT_LABEL = {
    error: ['error', 'errors'], unsupported: ['not translated', 'not translated'],
    warn: ['check', 'checks'], info: ['note', 'notes']
  };
  var DIALECT_LABEL = { posix: 'bash / zsh', cmd: 'Windows cmd', powershell: 'PowerShell' };

  var TARGETS = {
    'fetch': { label: 'Fetch (browser)', file: 'request.js', lang: 'js' },
    'python': { label: 'Python requests', file: 'request.py', lang: 'py' },
    'node-fetch': { label: 'Node.js fetch', file: 'request.mjs', lang: 'js' },
    'node-axios': { label: 'Node.js axios', file: 'request.mjs', lang: 'js' }
  };

  var STANDARD_METHODS = toSet('GET POST PUT PATCH DELETE HEAD OPTIONS');

  // curl's single-letter options and the long names they stand for
  var SHORT = {
    '0': 'http1.0', '1': 'tlsv1', '2': 'sslv2', '3': 'sslv3', '4': 'ipv4', '6': 'ipv6',
    'a': 'append', 'A': 'user-agent', 'b': 'cookie', 'B': 'use-ascii', 'c': 'cookie-jar',
    'C': 'continue-at', 'd': 'data', 'D': 'dump-header', 'e': 'referer', 'E': 'cert',
    'f': 'fail', 'F': 'form', 'g': 'globoff', 'G': 'get', 'h': 'help', 'H': 'header',
    'i': 'include', 'I': 'head', 'j': 'junk-session-cookies', 'J': 'remote-header-name',
    'k': 'insecure', 'K': 'config', 'l': 'list-only', 'L': 'location', 'm': 'max-time',
    'M': 'manual', 'n': 'netrc', 'N': 'no-buffer', 'o': 'output', 'O': 'remote-name',
    'p': 'proxytunnel', 'P': 'ftp-port', 'q': 'disable', 'Q': 'quote', 'r': 'range',
    'R': 'remote-time', 's': 'silent', 'S': 'show-error', 't': 'telnet-option',
    'T': 'upload-file', 'u': 'user', 'U': 'proxy-user', 'v': 'verbose', 'V': 'version',
    'w': 'write-out', 'x': 'proxy', 'X': 'request', 'y': 'speed-time', 'Y': 'speed-limit',
    'z': 'time-cond', 'Z': 'parallel', '#': 'progress-bar', ':': 'next'
  };

  // Long options that take a value (curl 8.x). Everything in SWITCHES takes none.
  var ARG_OPTS = toSet(
    'abstract-unix-socket alt-svc aws-sigv4 cacert capath cert cert-type ciphers config ' +
    'connect-timeout connect-to continue-at cookie cookie-jar create-file-mode crlfile curves ' +
    'data data-ascii data-binary data-raw data-urlencode delegation dns-interface dns-ipv4-addr ' +
    'dns-ipv6-addr dns-servers doh-url dump-header ech egd-file engine etag-compare etag-save ' +
    'expect100-timeout form form-string ftp-account ftp-alternative-to-user ftp-method ftp-port ' +
    'ftp-ssl-ccc-mode happy-eyeballs-timeout-ms haproxy-clientip header hostpubmd5 hostpubsha256 ' +
    'hsts interface ip-tos ipfs-gateway json keepalive-cnt keepalive-time key key-type knownhosts ' +
    'krb libcurl limit-rate local-port login-options mail-auth mail-from mail-rcpt max-filesize ' +
    'max-redirs max-time netrc-file noproxy oauth2-bearer output output-dir parallel-max pass ' +
    'pinnedpubkey preproxy proto proto-default proto-redir proxy proxy-cacert proxy-capath ' +
    'proxy-cert proxy-cert-type proxy-ciphers proxy-crlfile proxy-header proxy-key proxy-key-type ' +
    'proxy-pass proxy-pinnedpubkey proxy-service-name proxy-tls13-ciphers proxy-tlsauthtype ' +
    'proxy-tlspassword proxy-tlsuser proxy-user proxy1.0 pubkey quote random-file range rate ' +
    'referer request request-target resolve retry retry-delay retry-max-time sasl-authzid ' +
    'service-name sigalgs socks4 socks4a socks5 socks5-gssapi-service socks5-hostname speed-limit ' +
    'speed-time ssl-sessions stderr telnet-option tftp-blksize time-cond tls-max tls13-ciphers ' +
    'tlsauthtype tlspassword tlsuser trace trace-ascii trace-config unix-socket upload-file url ' +
    'url-query user user-agent variable vlan-priority write-out'
  );

  var SWITCHES = toSet(
    'anyauth append basic ca-native cert-status compressed compressed-ssh create-dirs crlf digest ' +
    'disable disable-eprt disable-epsv disallow-username-in-url doh-cert-status doh-insecure fail ' +
    'fail-early fail-with-body false-start form-escape ftp-create-dirs ftp-pasv ftp-pret ' +
    'ftp-skip-pasv-ip ftp-ssl-ccc ftp-ssl-control get globoff haproxy-protocol head help http0.9 ' +
    'http1.0 http1.1 http2 http2-prior-knowledge http3 http3-only ignore-content-length include ' +
    'insecure ipv4 ipv6 junk-session-cookies list-only location location-trusted ' +
    'mail-rcpt-allowfails manual metalink mptcp negotiate netrc netrc-optional next no-alpn ' +
    'no-buffer no-clobber no-keepalive no-npn no-progress-meter no-sessionid ntlm ntlm-wb ' +
    'out-null parallel parallel-immediate path-as-is post301 post302 post303 progress-bar ' +
    'proxy-anyauth proxy-basic proxy-ca-native proxy-digest proxy-http2 proxy-insecure ' +
    'proxy-negotiate proxy-ntlm proxy-ssl-allow-beast proxy-ssl-auto-client-cert proxytunnel raw ' +
    'remote-header-name remote-name remote-name-all remote-time remove-on-error retry-all-errors ' +
    'retry-connrefused sasl-ir show-error show-headers silent skip-existing socks5-basic ' +
    'socks5-gssapi socks5-gssapi-nec ssl ssl-allow-beast ssl-auto-client-cert ssl-no-revoke ' +
    'ssl-reqd ssl-revoke-best-effort sslv2 sslv3 styled-output suppress-connect-headers ' +
    'tcp-fastopen tcp-nodelay tftp-no-options tlsv1 tlsv1.0 tlsv1.1 tlsv1.2 tlsv1.3 tr-encoding ' +
    'trace-time use-ascii verbose version xattr'
  );

  // Options that only change what curl prints or where it saves things
  var OUTPUT_ONLY = toSet(
    'silent show-error verbose progress-bar no-progress-meter stderr trace trace-ascii trace-time ' +
    'trace-config dump-header styled-output no-buffer libcurl manual help version create-dirs ' +
    'remote-time xattr remove-on-error no-clobber skip-existing output-dir create-file-mode ' +
    'suppress-connect-headers fail-early parallel-immediate disable out-null remote-header-name ' +
    'remote-name-all globoff'
  );

  var HTTP_VERSION = toSet('http0.9 http1.0 http1.1 http2 http2-prior-knowledge http3 http3-only no-alpn no-npn');

  var TLS_TUNING = toSet(
    'tlsv1 tlsv1.0 tlsv1.1 tlsv1.2 tlsv1.3 tls-max ciphers tls13-ciphers curves sigalgs false-start ' +
    'sslv2 sslv3 cert-status ssl-allow-beast ssl-no-revoke ssl-revoke-best-effort ' +
    'ssl-auto-client-cert ca-native ssl-sessions no-sessionid tlsuser tlspassword tlsauthtype ' +
    'engine egd-file random-file ech'
  );

  var TRANSPORT = toSet(
    'tcp-nodelay tcp-fastopen keepalive-time keepalive-cnt no-keepalive limit-rate speed-limit ' +
    'speed-time local-port ip-tos vlan-priority mptcp happy-eyeballs-timeout-ms expect100-timeout ' +
    'ipv4 ipv6 rate parallel-max tr-encoding raw ignore-content-length alt-svc hsts ' +
    'dns-interface dns-ipv4-addr dns-ipv6-addr dns-servers doh-url doh-cert-status doh-insecure'
  );

  var RETRY_WHY = 'Retries failed requests. Add a retry loop yourself (in Python, mount an HTTPAdapter with urllib3 Retry).';
  var KERBEROS_WHY = 'Kerberos, SASL and SOCKS authentication details are not carried over.';

  var UNSUPPORTED_WHY = {
    'config': 'Reads more options from a file, which the converter cannot see.',
    'next': 'Starts another request; only the first request is converted.',
    'parallel': 'Runs transfers in parallel; only one request is converted.',
    'variable': 'Defines curl variables; {{variables}} are not expanded.',
    'retry': RETRY_WHY,
    'retry-delay': RETRY_WHY,
    'retry-max-time': RETRY_WHY,
    'retry-all-errors': RETRY_WHY,
    'retry-connrefused': RETRY_WHY,
    'max-redirs': 'Limits the number of redirects. The generated clients use their own limit (requests 30, fetch 20, axios 21).',
    'aws-sigv4': 'Signs the request with AWS Signature Version 4. Use an AWS SDK or a signing package (requests-aws4auth, aws4) instead.',
    'resolve': 'Pins a host name to a fixed IP address.',
    'connect-to': 'Connects to a different host or port than the URL names.',
    'unix-socket': 'Sends the request over a Unix domain socket.',
    'abstract-unix-socket': 'Sends the request over an abstract Unix domain socket.',
    'interface': 'Binds the connection to a specific network interface.',
    'continue-at': 'Resumes a partial download. Send a Range header instead (-r in curl).',
    'time-cond': 'Adds an If-Modified-Since condition. Send that header yourself if you need it.',
    'cookie-jar': 'Saves the cookies the server sets into a file. In Python, a requests.Session keeps cookies between requests.',
    'junk-session-cookies': 'Only matters when curl loads cookies from a file.',
    'netrc': 'Reads credentials from ~/.netrc. Python requests also does this when no other authentication is given; fetch and axios do not.',
    'netrc-file': 'Reads credentials from a .netrc file, which the converter cannot see.',
    'netrc-optional': 'Reads credentials from ~/.netrc. Python requests also does this when no other authentication is given; fetch and axios do not.',
    'path-as-is': 'Sends /../ and /./ path segments unchanged; the generated clients normalise the path first.',
    'request-target': 'Sends a custom request target instead of the URL path.',
    'proxy-header': 'Sends extra headers to the proxy only.',
    'proxytunnel': 'Forces a CONNECT tunnel through the proxy.',
    'preproxy': 'Chains a SOCKS proxy in front of the proxy.',
    'noproxy': 'Lists hosts that skip the proxy. Python requests reads the NO_PROXY environment variable instead.',
    'haproxy-protocol': 'Sends a HAProxy PROXY protocol header.',
    'haproxy-clientip': 'Sends a HAProxy PROXY protocol header.',
    'pinnedpubkey': 'Pins the server public key.',
    'capath': 'Uses a directory of CA certificates. Point to a single CA bundle file (--cacert) instead.',
    'crlfile': 'Checks a certificate revocation list.',
    'cert-type': 'Uses a non-PEM certificate format; the generated code expects PEM files.',
    'key-type': 'Uses a non-PEM key format; the generated code expects PEM files.',
    'pass': 'The private key passphrase is not carried over.',
    'post301': 'Keeps POST after a 301 redirect; the generated clients switch to GET, as browsers do.',
    'post302': 'Keeps POST after a 302 redirect; the generated clients switch to GET, as browsers do.',
    'post303': 'Keeps POST after a 303 redirect; the generated clients switch to GET, as browsers do.',
    'max-filesize': 'Aborts downloads above a size limit.',
    'etag-compare': 'Compares the ETag with one saved in a file.',
    'etag-save': 'Saves the ETag to a file.',
    'form-escape': 'Changes how curl escapes multipart field names.',
    'proto': 'Restricts which protocols curl may use.',
    'proto-default': 'Sets the protocol for URLs without a scheme.',
    'proto-redir': 'Restricts which protocols redirects may use.',
    'disallow-username-in-url': 'Makes curl reject URLs that contain a user name.',
    'delegation': KERBEROS_WHY,
    'krb': KERBEROS_WHY,
    'sasl-authzid': KERBEROS_WHY,
    'sasl-ir': KERBEROS_WHY,
    'service-name': KERBEROS_WHY,
    'login-options': KERBEROS_WHY,
    'socks5-basic': KERBEROS_WHY,
    'socks5-gssapi': KERBEROS_WHY,
    'socks5-gssapi-nec': KERBEROS_WHY,
    'socks5-gssapi-service': KERBEROS_WHY,
    'ssl': 'Only applies to protocols that upgrade to TLS (FTP, IMAP, SMTP and so on).',
    'ssl-reqd': 'Only applies to protocols that upgrade to TLS (FTP, IMAP, SMTP and so on).',
    'metalink': 'Metalink support was removed from curl.',
    'ipfs-gateway': 'Only applies to ipfs:// URLs.',
    'proxy-basic': 'Basic is already the default proxy authentication.'
  };

  var SIMPLE_ESCAPES = { 'n': 10, 't': 9, 'r': 13, 'a': 7, 'b': 8, 'e': 27, 'E': 27, 'f': 12, 'v': 11, '\\': 92, "'": 39, '"': 34, '?': 63 };

  var PS_ESCAPES = {
    '0': String.fromCharCode(0), 'a': String.fromCharCode(7), 'b': String.fromCharCode(8),
    'e': String.fromCharCode(27), 'f': String.fromCharCode(12), 'n': '\n', 'r': '\r', 't': '\t',
    'v': String.fromCharCode(11)
  };

  var REDIRECT_OPS = ['<<<', '<<-', '&>>', '<<', '<>', '<&', '&>', '>>', '>&', '>|', '<', '>'];
  var SEPARATOR_OPS = ['||', '|&', '&&', ';;', '|', ';', '&'];

  // Request headers a page script may not set (Fetch Standard "forbidden request-header")
  var FORBIDDEN_HEADERS = toSet(
    'accept-charset accept-encoding access-control-request-headers access-control-request-method ' +
    'connection content-length cookie cookie2 date dnt expect host keep-alive origin referer ' +
    'set-cookie te trailer transfer-encoding upgrade via'
  );

  var PART_TYPES = {
    gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml',
    txt: 'text/plain', htm: 'text/html', html: 'text/html', pdf: 'application/pdf', xml: 'application/xml'
  };

  var GLOB_RE = /\{[^{}]*,[^{}]*\}|\[[0-9A-Za-z]+-[0-9A-Za-z]+(?::\d+)?\]/;
  var FORM_PARAM_RE = /;[ \t]*(type|filename|headers|encoder)=/gi;
  var COOKIE_NAME_RE = /^[!#$%&'*+\-.\^_`|~0-9A-Za-z]+$/;
  var COOKIE_VALUE_RE = /^[!#$%&'()*+\-.\/0-9:<=>?@A-Z\[\]\^_`a-z{|}~]*$/;

  var SAMPLES = {
    get: "curl 'https://api.example.com/v1/users?page=2&per_page=50&sort=-created_at' \\\n" +
      "  -H 'Accept: application/json' \\\n" +
      "  -H 'Authorization: Bearer YOUR_API_TOKEN'",
    json: "curl -X POST https://api.example.com/v1/orders \\\n" +
      "  -H 'Content-Type: application/json' \\\n" +
      "  -u 'alice:s3cr3t' \\\n" +
      "  -d '{\"customer\":\"alice\",\"items\":[{\"sku\":\"KB-102\",\"qty\":2}],\"express\":true,\"note\":null}' \\\n" +
      '  --max-time 30',
    form: "curl -F 'title=Holiday photo' \\\n" +
      "  -F 'file=@photo.jpg;type=image/jpeg' \\\n" +
      "  -H 'X-Request-Id: 7f3a9c' \\\n" +
      '  https://upload.example.com/api/files',
    chrome: "curl 'https://shop.example.com/api/cart' \\\n" +
      "  -H 'accept: application/json, text/plain, */*' \\\n" +
      "  -H 'accept-language: en-US,en;q=0.9' \\\n" +
      "  -H 'content-type: application/json' \\\n" +
      "  -b 'session=4f9d2c1a; theme=dark' \\\n" +
      "  -H 'origin: https://shop.example.com' \\\n" +
      "  -H 'referer: https://shop.example.com/products/kb-102' \\\n" +
      "  -H 'sec-fetch-mode: cors' \\\n" +
      "  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)' \\\n" +
      "  --data-raw $'{\"sku\":\"KB-102\",\"qty\":1,\"gift_note\":\"It\\'s for Sam\"}'",
    cmd: 'curl ^"https://api.example.com/v1/search?q=mechanical^%^20keyboard^&limit=5^" ^\n' +
      '  -H ^"accept: application/json^" ^\n' +
      '  -H ^"content-type: application/json^" ^\n' +
      '  -H ^"x-api-key: YOUR_KEY^" ^\n' +
      '  --data-raw ^"^{^\\^"filters^\\^":^{^\\^"in_stock^\\^":true^}^}^" ^\n' +
      '  --compressed',
    powershell: "curl.exe -X PUT 'https://api.example.com/v1/items/42' `\n" +
      "  -H 'Content-Type: application/json' `\n" +
      '  -H "Authorization: Bearer $env:API_TOKEN" `\n' +
      "  -d '{\"name\":\"Desk lamp\",\"price\":24.5}'",
    flags: "curl -sSL --retry 3 -k \\\n" +
      '  --connect-timeout 5 -m 60 \\\n' +
      '  -x http://proxy.internal:3128 \\\n' +
      "  -o report.csv -w '%{http_code}' \\\n" +
      "  'https://reports.example.com/export?format=csv&from=2026-01-01'"
  };

  // ── Small helpers ───────────────────────────────────────

  function toSet(str) {
    var set = {};
    str.split(/\s+/).forEach(function (k) { if (k) set[k] = true; });
    return set;
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function lower(s) {
    return String(s).toLowerCase();
  }

  function repeat(s, n) {
    var out = '';
    while (n-- > 0) out += s;
    return out;
  }

  function hex(n, width) {
    var h = n.toString(16);
    while (h.length < width) h = '0' + h;
    return h;
  }

  function truncate(s, max) {
    s = String(s);
    return s.length > max ? s.slice(0, max - 1) + String.fromCharCode(0x2026) : s;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function basename(path) {
    var parts = String(path).replace(/[\\\/]+$/, '').split(/[\\\/]/);
    return parts[parts.length - 1] || String(path);
  }

  function createNotes() {
    var list = [], seen = {};
    return {
      list: list,
      add: function (level, flag, text) {
        var key = level + '\n' + (flag || '') + '\n' + text;
        if (has(seen, key)) return;
        seen[key] = true;
        list.push({ level: level, flag: flag || null, text: text });
      }
    };
  }

  function newCommand(op) {
    return { args: [], op: op, stdin: null, stdinFile: null, stdout: null };
  }

  function matchOperator(src, i, ops) {
    for (var k = 0; k < ops.length; k++) {
      if (src.substr(i, ops[k].length) === ops[k]) return ops[k];
    }
    return src.charAt(i);
  }

  // ── UTF-8, percent-encoding, base64 ─────────────────────

  var encoder = null;

  function appendBytes(bytes, str) {
    if (!encoder) encoder = new TextEncoder();
    var b = encoder.encode(str);
    for (var k = 0; k < b.length; k++) bytes.push(b[k]);
  }

  function utf8Bytes(str) {
    var bytes = [];
    appendBytes(bytes, str);
    return bytes;
  }

  function utf8Decode(bytes) {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }

  function isUnreserved(b) {
    return (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) ||
      b === 45 || b === 46 || b === 95 || b === 126;
  }

  // curl_easy_escape(): everything except A-Z a-z 0-9 - . _ ~ becomes %XX
  function curlEscape(str) {
    var bytes = utf8Bytes(str), out = '';
    for (var k = 0; k < bytes.length; k++) {
      out += isUnreserved(bytes[k]) ? String.fromCharCode(bytes[k]) : '%' + hex(bytes[k], 2).toUpperCase();
    }
    return out;
  }

  // Form encoding: a space becomes "+", everything outside A-Z a-z 0-9 - . _ ~
  // becomes %XX. curl 8 uses it for --data-urlencode and --url-query, and it
  // matches Python's urllib.parse.quote_plus(), which requests uses for dicts.
  function formEscape(str) {
    var bytes = utf8Bytes(str), out = '';
    for (var k = 0; k < bytes.length; k++) {
      var b = bytes[k];
      if (b === 32) out += '+';
      else out += isUnreserved(b) ? String.fromCharCode(b) : '%' + hex(b, 2).toUpperCase();
    }
    return out;
  }

  function percentDecode(s, plusAsSpace) {
    if (s === null || s === undefined) return '';
    s = String(s);
    if (plusAsSpace) s = s.replace(/\+/g, ' ');
    if (s.indexOf('%') === -1) return s;
    var bytes = [], i = 0;
    while (i < s.length) {
      if (s.charAt(i) === '%' && /^[0-9a-fA-F]{2}$/.test(s.substr(i + 1, 2))) {
        bytes.push(parseInt(s.substr(i + 1, 2), 16));
        i += 3;
        continue;
      }
      var cp = s.codePointAt(i);
      appendBytes(bytes, String.fromCodePoint(cp));
      i += cp > 0xFFFF ? 2 : 1;
    }
    return utf8Decode(bytes);
  }

  function base64(bytes) {
    var out = '';
    for (var k = 0; k < bytes.length; k += 3) {
      var b0 = bytes[k], b1 = bytes[k + 1], b2 = bytes[k + 2];
      out += B64.charAt(b0 >> 2);
      out += B64.charAt(((b0 & 3) << 4) | ((b1 || 0) >> 4));
      out += k + 1 < bytes.length ? B64.charAt(((b1 & 15) << 2) | ((b2 || 0) >> 6)) : '=';
      out += k + 2 < bytes.length ? B64.charAt(b2 & 63) : '=';
    }
    return out;
  }

  // ── Shell: dialect detection ────────────────────────────

  function detectDialect(src) {
    if (/\^[ \t]*\n/.test(src) || /\^"/.test(src)) return 'cmd';
    if (/`[ \t]*\n/.test(src) || /^\s*&\s*curl/i.test(src)) return 'powershell';
    if (/^\s*curl\.exe\b/i.test(src)) return (/\\"/.test(src) || src.indexOf("'") === -1) ? 'cmd' : 'powershell';
    return 'posix';
  }

  function noteVariable(notes, name) {
    notes.add('warn', name, 'Shell variable: a real shell would insert its value, the converter keeps the text "' +
      name + '". Replace it with the real value, or read it from an environment variable in your code.');
  }

  function noteSubstitution(notes, text) {
    notes.add('warn', truncate(text, 40), 'Command substitution is not run; its text is used literally. Replace it with the value it would produce.');
  }

  // ── Shell: POSIX sh / bash / zsh ────────────────────────

  function tokenizePosix(src, notes) {
    var n = src.length, i = 0;
    var cur = '', inWord = false;
    var cmd = newCommand(null), commands = [cmd];
    var pending = null, heredocs = [];
    var afterBreak = false, joined = false, ampWarned = false;

    function flush() {
      if (!inWord) return;
      var word = cur;
      cur = '';
      inWord = false;
      if (pending) {
        redirect(pending, word);
        pending = null;
        return;
      }
      if (afterBreak) joined = true;
      cmd.args.push(word);
    }

    function redirect(r, word) {
      var op = r.op;
      if (op === '<<<') cmd.stdin = word + '\n';
      else if (op === '<<' || op === '<<-') heredocs.push({ delim: word, strip: op === '<<-' });
      else if (op === '<') cmd.stdinFile = word;
      else if ((op === '>' || op === '>>' || op === '>|') && r.fd !== '2') cmd.stdout = word;
      else if (op === '&>' || op === '&>>') cmd.stdout = word;
      // >&, <&, <> and 2> only move file descriptors around
    }

    function variableEnd(j) {
      var rest = src.slice(j + 1, j + 256), m, end;
      if (rest.charAt(0) === '(') {
        var depth = 0, k = j + 1;
        for (; k < n; k++) {
          var ch = src.charAt(k);
          if (ch === '(') depth++;
          else if (ch === ')' && --depth === 0) break;
        }
        end = Math.min(k + 1, n);
        noteSubstitution(notes, src.slice(j, end));
        return end;
      }
      if (rest.charAt(0) === '{') {
        var close = src.indexOf('}', j + 2);
        end = close === -1 ? n : close + 1;
      } else if ((m = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9#?@*$!-])/.exec(rest))) {
        end = j + 1 + m[0].length;
      } else {
        return j + 1;
      }
      noteVariable(notes, src.slice(j, end));
      return end;
    }

    function singleQuoted(j) {
      inWord = true;
      var end = src.indexOf("'", j);
      if (end === -1) {
        notes.add('error', "'", 'A single-quoted string is never closed, so the command is incomplete.');
        cur += src.slice(j);
        return n;
      }
      cur += src.slice(j, end);
      return end + 1;
    }

    function doubleQuoted(j) {
      inWord = true;
      while (j < n) {
        var d = src.charAt(j);
        if (d === '"') return j + 1;
        if (d === '\\') {
          var e = src.charAt(j + 1);
          if (e === '\n') { j += 2; continue; }
          if (e === '$' || e === '`' || e === '"' || e === '\\') { cur += e; j += 2; continue; }
          cur += d;
          j++;
          continue;
        }
        if (d === '$') {
          var v = variableEnd(j);
          cur += src.slice(j, v);
          j = v;
          continue;
        }
        if (d === '`') {
          var close = src.indexOf('`', j + 1);
          var end = close === -1 ? n : close + 1;
          noteSubstitution(notes, src.slice(j, end));
          cur += src.slice(j, end);
          j = end;
          continue;
        }
        cur += d;
        j++;
      }
      notes.add('error', '"', 'A double-quoted string is never closed, so the command is incomplete.');
      return n;
    }

    // $'...' (ANSI-C quoting): escapes produce bytes, decoded as UTF-8 at the end
    function ansiQuoted(j) {
      inWord = true;
      var bytes = [];
      while (j < n) {
        var d = src.charAt(j);
        if (d === "'") {
          cur += utf8Decode(bytes);
          return j + 1;
        }
        if (d !== '\\') {
          var cp = src.codePointAt(j);
          appendBytes(bytes, String.fromCodePoint(cp));
          j += cp > 0xFFFF ? 2 : 1;
          continue;
        }
        var e = src.charAt(j + 1), m;
        j += 2;
        if (has(SIMPLE_ESCAPES, e)) { bytes.push(SIMPLE_ESCAPES[e]); continue; }
        if (e === 'x' && (m = /^[0-9a-fA-F]{1,2}/.exec(src.substr(j, 2)))) {
          bytes.push(parseInt(m[0], 16));
          j += m[0].length;
          continue;
        }
        if ((e === 'u' || e === 'U') && (m = (e === 'u' ? /^[0-9a-fA-F]{1,4}/ : /^[0-9a-fA-F]{1,8}/).exec(src.substr(j, e === 'u' ? 4 : 8)))) {
          var code = parseInt(m[0], 16);
          j += m[0].length;
          // Join a high surrogate with a low surrogate written right after it
          if (code >= 0xD800 && code <= 0xDBFF && src.charAt(j) === '\\' && src.charAt(j + 1) === 'u') {
            var lo = /^[0-9a-fA-F]{4}/.exec(src.substr(j + 2, 4));
            var low = lo ? parseInt(lo[0], 16) : 0;
            if (low >= 0xDC00 && low <= 0xDFFF) {
              code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
              j += 6;
            }
          }
          if (code > 0x10FFFF) code = 0xFFFD;
          appendBytes(bytes, String.fromCodePoint(code));
          continue;
        }
        if (e === 'c' && j < n) {
          bytes.push(src.charCodeAt(j) & 31);
          j++;
          continue;
        }
        if (e >= '0' && e <= '7') {
          m = /^[0-7]{1,3}/.exec(src.substr(j - 1, 3));
          bytes.push(parseInt(m[0], 8) & 255);
          j += m[0].length - 1;
          continue;
        }
        if (e === '') { bytes.push(92); continue; }
        appendBytes(bytes, '\\' + e);
      }
      notes.add('error', "$'", "A $'...' string is never closed, so the command is incomplete.");
      cur += utf8Decode(bytes);
      return n;
    }

    function readHeredocs(pos) {
      while (heredocs.length) {
        var hd = heredocs.shift(), body = '', closed = false;
        while (pos < n) {
          var eol = src.indexOf('\n', pos);
          if (eol === -1) eol = n;
          var line = src.slice(pos, eol);
          pos = Math.min(eol + 1, n);
          if (hd.strip) line = line.replace(/^\t+/, '');
          if (line === hd.delim) { closed = true; break; }
          body += line + '\n';
        }
        if (!closed) notes.add('warn', '<<' + hd.delim, 'The here-document has no closing "' + hd.delim + '" line; everything after it was used as its text.');
        cmd.stdin = body;
      }
      return pos;
    }

    while (i < n) {
      var c = src.charAt(i);

      if (c === '\\') {
        if (src.charAt(i + 1) === '\n') { i += 2; continue; }
        if (i + 1 < n) { cur += src.charAt(i + 1); inWord = true; }
        i += 2;
        continue;
      }
      if (c === ' ' || c === '\t') { flush(); i++; continue; }
      if (c === '\n') {
        flush();
        i++;
        if (heredocs.length) i = readHeredocs(i);
        else if (cmd.args.length) afterBreak = true;
        continue;
      }
      if (c === '#' && !inWord) {
        while (i < n && src.charAt(i) !== '\n') i++;
        continue;
      }
      if (c === "'") { i = singleQuoted(i + 1); continue; }
      if (c === '$' && src.charAt(i + 1) === "'") { i = ansiQuoted(i + 2); continue; }
      if (c === '$' && src.charAt(i + 1) === '"') { i++; continue; }
      if (c === '"') { i = doubleQuoted(i + 1); continue; }
      if (c === '$') {
        var ve = variableEnd(i);
        cur += src.slice(i, ve);
        inWord = true;
        i = ve;
        continue;
      }
      if (c === '`') {
        var bq = src.indexOf('`', i + 1);
        var bqEnd = bq === -1 ? n : bq + 1;
        noteSubstitution(notes, src.slice(i, bqEnd));
        cur += src.slice(i, bqEnd);
        inWord = true;
        i = bqEnd;
        continue;
      }
      if (c === '&' && inWord && i + 1 < n && !/[\s&|;<>]/.test(src.charAt(i + 1))) {
        if (!ampWarned) {
          ampWarned = true;
          notes.add('warn', '&', 'An unquoted & inside an argument ends the command in a real shell (curl would run in the background with a cut-off URL). The converter kept it as part of the argument. Quote URLs that contain & in your scripts.');
        }
        cur += c;
        i++;
        continue;
      }
      if (c === '<' || c === '>' || (c === '&' && src.charAt(i + 1) === '>')) {
        var fd = null;
        if (inWord && /^\d+$/.test(cur)) {
          fd = cur;
          cur = '';
          inWord = false;
        } else {
          flush();
        }
        var rop = matchOperator(src, i, REDIRECT_OPS);
        i += rop.length;
        pending = { op: rop, fd: fd };
        continue;
      }
      if (c === '|' || c === ';' || c === '&') {
        flush();
        var sep = matchOperator(src, i, SEPARATOR_OPS);
        i += sep.length;
        cmd = newCommand(sep);
        commands.push(cmd);
        afterBreak = false;
        continue;
      }
      cur += c;
      inWord = true;
      i++;
    }
    flush();
    if (pending) notes.add('warn', pending.op, 'This redirection has no target and was ignored.');
    if (joined) notes.add('warn', null, 'The command continues on a new line without a trailing backslash (\\). A real shell would stop at the line break; the converter joined the lines.');
    return { commands: commands };
  }

  // ── Shell: Windows cmd.exe + Microsoft C runtime ────────

  // How the C runtime splits a command line into argv (backslashes only
  // escape when they come right before a double quote)
  function splitMsvcrt(s) {
    var args = [], cur = '', inWord = false, inQ = false, i = 0, n = s.length;
    while (i < n) {
      var c = s.charAt(i);
      if (c === '\\') {
        var j = i;
        while (j < n && s.charAt(j) === '\\') j++;
        var count = j - i;
        if (s.charAt(j) === '"') {
          cur += repeat('\\', count >> 1);
          if (count % 2) {
            cur += '"';
            j++;
          }
        } else {
          cur += repeat('\\', count);
        }
        i = j;
        inWord = true;
        continue;
      }
      if (c === '"') {
        if (inQ && s.charAt(i + 1) === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQ = !inQ;
        inWord = true;
        i++;
        continue;
      }
      if (!inQ && (c === ' ' || c === '\t')) {
        if (inWord) {
          args.push(cur);
          cur = '';
          inWord = false;
        }
        i++;
        continue;
      }
      cur += c;
      inWord = true;
      i++;
    }
    if (inWord) args.push(cur);
    return args;
  }

  function tokenizeCmd(src, notes) {
    var n = src.length, i = 0, line = '', inQ = false;
    var broke = false, joined = false, ampWarned = false;
    while (i < n) {
      var c = src.charAt(i);
      if (c === '"') {
        inQ = !inQ;
        line += c;
        i++;
        continue;
      }
      if (!inQ && c === '^') {
        if (src.charAt(i + 1) === '\n') {
          i += 2;
          // cmd.exe takes the first character of the continued line literally
          if (i < n) {
            line += src.charAt(i);
            i++;
          }
          continue;
        }
        if (i + 1 < n) line += src.charAt(i + 1);
        i += 2;
        continue;
      }
      if (c === '\n') {
        if (inQ) {
          line += c;
        } else {
          line += ' ';
          broke = true;
        }
        i++;
        continue;
      }
      if (!inQ && (c === '&' || c === '|' || c === '<' || c === '>')) {
        var prev = line.charAt(line.length - 1);
        if (line.trim() !== '' && prev !== ' ' && prev !== '\t') {
          if (!ampWarned) {
            ampWarned = true;
            notes.add('warn', c, 'An unescaped ' + c + ' inside an argument ends the command in cmd.exe. The converter kept it as part of the argument; escape it as ^' + c + ' or quote the argument when you run it.');
          }
          line += c;
          i++;
          continue;
        }
        notes.add('info', c, 'Everything from "' + c + '" on is not part of the curl command and was ignored.');
        break;
      }
      if (broke && c !== ' ' && c !== '\t') {
        joined = true;
        broke = false;
      }
      line += c;
      i++;
    }
    var env = src.match(/%[A-Za-z_][A-Za-z0-9_]*%/g) || [];
    env.forEach(function (name) { noteVariable(notes, name); });
    if (joined) notes.add('warn', null, 'The command continues on a new line without a trailing ^. cmd.exe would stop at the line break; the converter joined the lines.');
    var cmd = newCommand(null);
    cmd.args = splitMsvcrt(line);
    return { commands: [cmd] };
  }

  // ── Shell: PowerShell ───────────────────────────────────

  function tokenizePowershell(src, notes) {
    var n = src.length, i = 0, cur = '', inWord = false;
    var cmd = newCommand(null), commands = [cmd];
    var pending = null, broke = false, joined = false;

    function isSingle(ch) { return ch === "'" || (ch !== '' && SMART_SINGLE.indexOf(ch) !== -1); }
    function isDouble(ch) { return ch === '"' || (ch !== '' && SMART_DOUBLE.indexOf(ch) !== -1); }

    function flush() {
      if (!inWord) return;
      var word = cur;
      cur = '';
      inWord = false;
      if (pending) {
        if (pending.fd !== '2' && pending.op.indexOf('&') === -1) cmd.stdout = word;
        pending = null;
        return;
      }
      if (broke) joined = true;
      cmd.args.push(word);
    }

    function variable(j) {
      var rest = src.slice(j + 1, j + 256), m, end;
      if (rest.charAt(0) === '(') {
        var depth = 0, k = j + 1;
        for (; k < n; k++) {
          var ch = src.charAt(k);
          if (ch === '(') depth++;
          else if (ch === ')' && --depth === 0) break;
        }
        end = Math.min(k + 1, n);
        noteSubstitution(notes, src.slice(j, end));
      } else if (rest.charAt(0) === '{') {
        var close = src.indexOf('}', j + 2);
        end = close === -1 ? n : close + 1;
        noteVariable(notes, src.slice(j, end));
      } else if ((m = /^(?:[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?|[?\^$])/.exec(rest))) {
        end = j + 1 + m[0].length;
        noteVariable(notes, src.slice(j, end));
      } else {
        cur += '$';
        inWord = true;
        return j + 1;
      }
      cur += src.slice(j, end);
      inWord = true;
      return end;
    }

    function singleQuoted(j) {
      inWord = true;
      while (j < n) {
        var d = src.charAt(j);
        if (isSingle(d)) {
          if (isSingle(src.charAt(j + 1))) {
            cur += "'";
            j += 2;
            continue;
          }
          return j + 1;
        }
        cur += d;
        j++;
      }
      notes.add('error', "'", 'A single-quoted string is never closed, so the command is incomplete.');
      return n;
    }

    function doubleQuoted(j) {
      inWord = true;
      while (j < n) {
        var d = src.charAt(j);
        if (isDouble(d)) {
          if (isDouble(src.charAt(j + 1))) {
            cur += '"';
            j += 2;
            continue;
          }
          return j + 1;
        }
        if (d === '`') {
          var e = src.charAt(j + 1);
          j += 2;
          if (e === '\n') continue;
          if (has(PS_ESCAPES, e)) { cur += PS_ESCAPES[e]; continue; }
          if (e === 'u' && src.charAt(j) === '{') {
            var close = src.indexOf('}', j);
            var digits = close === -1 ? '' : src.slice(j + 1, close);
            if (/^[0-9a-fA-F]{1,6}$/.test(digits) && parseInt(digits, 16) <= 0x10FFFF) {
              cur += String.fromCodePoint(parseInt(digits, 16));
              j = close + 1;
              continue;
            }
          }
          cur += e;
          continue;
        }
        if (d === '$') {
          j = variable(j);
          continue;
        }
        cur += d;
        j++;
      }
      notes.add('error', '"', 'A double-quoted string is never closed, so the command is incomplete.');
      return n;
    }

    while (i < n) {
      var c = src.charAt(i);
      if (c === '`') {
        if (src.charAt(i + 1) === '\n') { i += 2; continue; }
        if (i + 1 < n) { cur += src.charAt(i + 1); inWord = true; }
        i += 2;
        continue;
      }
      if (c === ' ' || c === '\t') { flush(); i++; continue; }
      if (c === '\n') {
        flush();
        if (cmd.args.length) broke = true;
        i++;
        continue;
      }
      if (c === '#' && !inWord) {
        while (i < n && src.charAt(i) !== '\n') i++;
        continue;
      }
      if (isSingle(c)) { i = singleQuoted(i + 1); continue; }
      if (isDouble(c)) { i = doubleQuoted(i + 1); continue; }
      if (c === '$') { i = variable(i); continue; }
      if (c === '&' && !inWord && !cmd.args.length && src.charAt(i + 1) !== '&') { i++; continue; }
      if (c === '>' || ((c === '2' || c === '*') && !inWord && src.charAt(i + 1) === '>')) {
        var fd = c === '>' ? null : c;
        flush();
        if (fd) i++;
        var rop = matchOperator(src, i, ['>>', '>&', '>']);
        i += rop.length;
        if (rop === '>&') {
          while (i < n && /\d/.test(src.charAt(i))) i++;
          continue;
        }
        pending = { op: rop, fd: fd };
        continue;
      }
      if (c === '|' || c === ';' || (c === '&' && src.charAt(i + 1) === '&')) {
        flush();
        var sep = matchOperator(src, i, ['||', '&&', '|', ';']);
        i += sep.length;
        cmd = newCommand(sep);
        commands.push(cmd);
        broke = false;
        continue;
      }
      cur += c;
      inWord = true;
      i++;
    }
    flush();
    if (joined) notes.add('warn', null, 'The command continues on a new line without a trailing backtick (`). PowerShell would stop at the line break; the converter joined the lines.');
    return { commands: commands };
  }

  function tokenize(src, dialect, notes) {
    if (dialect === 'cmd') return tokenizeCmd(src, notes);
    if (dialect === 'powershell') return tokenizePowershell(src, notes);
    return tokenizePosix(src, notes);
  }

  // ── Finding the curl command ────────────────────────────

  function isCurlProgram(token) {
    return /^(?:.*[\/\\])?curl(?:\.exe)?$/i.test(token);
  }

  function locateCurl(commands, notes) {
    for (var c = 0; c < commands.length; c++) {
      var args = commands[c].args;
      for (var k = 0; k < Math.min(args.length, 6); k++) {
        if (!isCurlProgram(args[k])) continue;
        if (k > 0) notes.add('info', null, 'Ignored "' + truncate(args.slice(0, k).join(' '), 60) + '" in front of curl.');
        var others = commands.filter(function (x, idx) { return idx !== c && x.args.length; }).map(function (x) {
          return (x.op ? x.op + ' ' : '') + x.args.join(' ');
        });
        if (others.length) notes.add('info', null, 'Only the curl command is converted; the rest of the line (' + truncate(others.join(' '), 80) + ') was ignored.');
        return {
          program: args[k],
          args: args.slice(k + 1),
          stdin: commands[c].stdin,
          stdinFile: commands[c].stdinFile,
          stdout: commands[c].stdout
        };
      }
    }
    var first = commands[0].args;
    if (first.length && (first[0].charAt(0) === '-' || /^https?:\/\//i.test(first[0]))) {
      notes.add('info', null, 'The command does not start with "curl"; it was read as curl arguments.');
      return { program: 'curl', args: first, stdin: commands[0].stdin, stdinFile: commands[0].stdinFile, stdout: commands[0].stdout };
    }
    notes.add('error', null, first.length
      ? 'This does not look like a curl command. It should start with curl (it starts with "' + truncate(first[0], 30) + '").'
      : 'No command found.');
    return null;
  }

  // ── curl option parsing ─────────────────────────────────

  function newState() {
    return {
      urls: [], method: null, head: false, get: false,
      headerList: [], removed: [], data: [], form: [],
      user: null, authType: 'basic', bearer: null,
      location: false, insecure: false, compressed: false, fail: false, include: false,
      remoteName: false, globoff: false,
      maxTime: null, connectTimeout: null,
      proxy: null, proxyScheme: null, proxyUser: null,
      cert: null, key: null, cacert: null,
      output: null, upload: null, urlQuery: [],
      stdin: null, stdinFile: null, stdout: null,
      flags: {}
    };
  }

  function parseArgs(args, notes) {
    var st = newState();
    var i = 0, stillFlags = true;

    function longOption(a) {
      var name = a.slice(2), value = null, flag = a;
      if (!has(ARG_OPTS, name) && !has(SWITCHES, name)) {
        var eq = name.indexOf('=');
        var base = eq > 0 ? name.slice(0, eq) : null;
        if (base && (has(ARG_OPTS, base) || has(ARG_OPTS, base.replace(/^expand-/, '')))) {
          value = name.slice(eq + 1);
          name = base;
          flag = '--' + base;
          notes.add('warn', a, 'curl does not accept the --option=value form (it would report an unknown option). It was read as ' + flag + ' followed by its value.');
        }
      }
      var expand = false;
      if (name.indexOf('expand-') === 0 && has(ARG_OPTS, name.slice(7))) {
        expand = true;
        name = name.slice(7);
      }
      if (has(ARG_OPTS, name)) {
        if (value === null) {
          if (i >= args.length) {
            notes.add('error', flag, 'This option needs a value, but the command ends here.');
            return false;
          }
          value = args[i++];
        }
        if (expand) notes.add('unsupported', flag, 'curl would expand {{variables}} inside the value; it is used literally.');
        applyOption(st, name, value, flag, notes);
      } else if (has(SWITCHES, name)) {
        applySwitch(st, name, true, flag, notes);
      } else if (name.indexOf('no-') === 0 && has(SWITCHES, name.slice(3))) {
        applySwitch(st, name.slice(3), false, flag, notes);
      } else {
        notes.add('unsupported', flag, 'Unknown option: curl itself would stop with an error. It was skipped.');
      }
      return true;
    }

    function shortOptions(a) {
      for (var k = 1; k < a.length; k++) {
        var ch = a.charAt(k), flag = '-' + ch;
        if (!has(SHORT, ch)) {
          notes.add('unsupported', flag, 'Unknown option: curl itself would stop with an error. It was skipped.');
          continue;
        }
        var name = SHORT[ch];
        if (has(ARG_OPTS, name)) {
          var value = a.slice(k + 1);
          if (!value) {
            if (i >= args.length) {
              notes.add('error', flag, 'This option needs a value, but the command ends here.');
              return false;
            }
            value = args[i++];
          }
          applyOption(st, name, value, flag, notes);
          return true;
        }
        applySwitch(st, name, true, flag, notes);
      }
      return true;
    }

    while (i < args.length) {
      var a = args[i++];
      if (stillFlags && a.length > 1 && DASHES.indexOf(a.charAt(0)) !== -1) {
        var bare = a.replace(DASH_PREFIX_RE, '');
        var guess = (has(ARG_OPTS, bare) || has(SWITCHES, bare)) ? '--' + bare : '-' + bare;
        notes.add('warn', a, 'Starts with a typographic dash instead of a hyphen, so curl would treat it as a URL. It was read as ' + guess + '; retype the dash before you run the command.');
        a = guess;
      }
      if (stillFlags && a === '--') {
        stillFlags = false;
        continue;
      }
      if (stillFlags && a.length > 1 && a.charAt(0) === '-') {
        var ok = a.charAt(1) === '-' ? longOption(a) : shortOptions(a);
        if (!ok) break;
        continue;
      }
      if (st.urls.length && isCurlProgram(a)) {
        notes.add('info', a, 'A second curl command starts here; only the first one is converted.');
        break;
      }
      st.urls.push(a);
    }
    return st;
  }

  function parseSeconds(v, flag, notes) {
    var num = Number(v);
    if (String(v).trim() === '' || !isFinite(num) || num < 0) {
      notes.add('warn', flag, '"' + v + '" is not a number of seconds; the option was ignored.');
      return null;
    }
    return num;
  }

  function findOptionHeader(st, name) {
    var ln = lower(name);
    for (var k = 0; k < st.headerList.length; k++) {
      if (st.headerList[k].kind === 'option' && lower(st.headerList[k].name) === ln) return st.headerList[k];
    }
    return null;
  }

  function setOptionHeader(st, name, value, flag) {
    var existing = findOptionHeader(st, name);
    if (existing) {
      existing.value = value;
      existing.flag = flag;
      return;
    }
    st.headerList.push({ name: name, value: value, flag: flag, kind: 'option' });
  }

  function addHeaderArg(st, v, flag, notes) {
    if (v.charAt(0) === '@') {
      notes.add('unsupported', flag, 'Reads headers from the file "' + v.slice(1) + '", which the converter cannot see. Pass each header with its own -H.');
      return;
    }
    var colon = v.indexOf(':');
    if (colon === -1) {
      var semi = /^([^;\s]+)\s*;\s*$/.exec(v);
      if (semi) {
        st.headerList.push({ name: semi[1], value: '', flag: flag, kind: 'header' });
        return;
      }
      notes.add('warn', flag, 'The header "' + truncate(v, 60) + '" has no colon. curl ignores it, and so does the converter.');
      return;
    }
    var name = v.slice(0, colon).trim(), value = v.slice(colon + 1).trim();
    if (!name) {
      notes.add('warn', flag, 'A header without a name was ignored.');
      return;
    }
    if (value === '') {
      st.removed.push(name);
      notes.add('info', flag, '"' + name + ':" with no value tells curl not to send its own ' + name + ' header. The generated code cannot remove headers the HTTP client adds by itself; it just does not set one.');
      return;
    }
    st.headerList.push({ name: name, value: value, flag: flag, kind: 'header' });
  }

  // curl's built-in table for file parts without ;type= (the ;filename= is
  // checked first, then the local file name; anything else is octet-stream)
  function guessPartType(name) {
    var m = /\.([A-Za-z]+)$/.exec(name || '');
    return m && has(PART_TYPES, lower(m[1])) ? PART_TYPES[lower(m[1])] : null;
  }

  function unquoteFormValue(s) {
    var m = /^"((?:[^"\\]|\\.)*)"$/.exec(s.trim());
    return m ? m[1].replace(/\\(.)/g, '$1') : s;
  }

  function parseFormArg(v, literal, flag, notes) {
    var eq = v.indexOf('=');
    if (eq <= 0) {
      notes.add('error', flag, 'Expects name=value, but got "' + truncate(v, 60) + '".');
      return null;
    }
    var part = { name: v.slice(0, eq), kind: 'text', value: v.slice(eq + 1), type: null, filename: null, flag: flag };
    if (literal) return part;
    var rest = part.value, lead = rest.charAt(0);
    if (lead === '@' || lead === '<') {
      part.kind = lead === '@' ? 'file' : 'filecontent';
      rest = rest.slice(1);
    }
    var marks = [], m;
    FORM_PARAM_RE.lastIndex = 0;
    while ((m = FORM_PARAM_RE.exec(rest))) marks.push({ at: m.index, key: m[1].toLowerCase(), start: m.index + m[0].length });
    marks.forEach(function (mk, idx) {
      var val = unquoteFormValue(rest.slice(mk.start, idx + 1 < marks.length ? marks[idx + 1].at : rest.length));
      if (mk.key === 'type') part.type = val;
      else if (mk.key === 'filename') part.filename = val;
      else if (mk.key === 'headers') notes.add('unsupported', flag, 'Extra part headers (;headers=) are not carried over.');
      else notes.add('unsupported', flag, 'The ;encoder= setting is not carried over.');
    });
    part.value = unquoteFormValue(marks.length ? rest.slice(0, marks[0].at) : rest);
    if (part.kind !== 'text' && !part.value) {
      notes.add('error', flag, 'The field "' + part.name + '" names no file after "' + lead + '".');
      return null;
    }
    if (part.kind === 'file' && !part.type) {
      part.type = guessPartType(part.filename) || guessPartType(part.value) || 'application/octet-stream';
      part.typeGuessed = true;
    }
    if (part.kind !== 'text' && part.value === '-') {
      notes.add('unsupported', flag, 'Reads the field "' + part.name + '" from standard input, which the converter cannot see. The code reads a file named "-" instead; replace it.');
    }
    return part;
  }

  function applyOption(st, name, v, flag, notes) {
    st.flags[name] = flag;
    switch (name) {
      case 'url': st.urls.push(v); return;
      case 'request': st.method = v; return;
      case 'header': addHeaderArg(st, v, flag, notes); return;
      case 'user-agent': setOptionHeader(st, 'User-Agent', v, flag); return;
      case 'referer': {
        var auto = /;auto$/.test(v), ref = v.replace(/;auto$/, '');
        if (auto) notes.add('info', flag, '";auto" (update the Referer on redirects) has no equivalent; the fixed Referer is kept.');
        if (ref) setOptionHeader(st, 'Referer', ref, flag);
        return;
      }
      case 'cookie': {
        if (v.indexOf('=') === -1) {
          notes.add('unsupported', flag, 'Without "=", curl reads cookies from the file "' + v + '", which the converter cannot see. Put them in the command as "name=value; name2=value2".');
          return;
        }
        var prev = findOptionHeader(st, 'Cookie');
        setOptionHeader(st, 'Cookie', prev ? prev.value + '; ' + v : v, flag);
        return;
      }
      case 'range': setOptionHeader(st, 'Range', 'bytes=' + v, flag); return;
      case 'data':
      case 'data-ascii': st.data.push({ mode: 'data', value: v, flag: flag }); return;
      case 'data-binary': st.data.push({ mode: 'binary', value: v, flag: flag }); return;
      case 'data-raw': st.data.push({ mode: 'raw', value: v, flag: flag }); return;
      case 'data-urlencode': st.data.push({ mode: 'urlencode', value: v, flag: flag }); return;
      case 'json': st.data.push({ mode: 'json', value: v, flag: flag }); return;
      case 'form':
      case 'form-string': {
        var part = parseFormArg(v, name === 'form-string', flag, notes);
        if (part) st.form.push(part);
        return;
      }
      case 'user': st.user = v; return;
      case 'oauth2-bearer': st.bearer = v; return;
      case 'max-time': st.maxTime = parseSeconds(v, flag, notes); return;
      case 'connect-timeout': st.connectTimeout = parseSeconds(v, flag, notes); return;
      case 'proxy': st.proxy = v; st.proxyScheme = null; st.flags.proxy = flag; return;
      case 'proxy1.0':
        st.proxy = v;
        st.proxyScheme = 'http';
        st.flags.proxy = flag;
        notes.add('info', flag, 'Converted as a normal HTTP proxy; the generated clients talk HTTP/1.1 to it.');
        return;
      case 'socks4':
      case 'socks4a':
      case 'socks5':
      case 'socks5-hostname':
        st.proxy = v;
        st.proxyScheme = name === 'socks5-hostname' ? 'socks5h' : name;
        st.flags.proxy = flag;
        return;
      case 'proxy-user': st.proxyUser = v; return;
      case 'cert': {
        var pw = /^((?:[A-Za-z]:[\\\/])?[^:]*):(.+)$/.exec(v);
        if (pw) notes.add('unsupported', flag, 'The certificate password after ":" is not carried over.');
        st.cert = pw ? pw[1] : v;
        return;
      }
      case 'key': st.key = v; return;
      case 'cacert': st.cacert = v; return;
      case 'output': st.output = v; return;
      case 'upload-file': st.upload = v; return;
      case 'url-query': st.urlQuery.push({ value: v, flag: flag }); return;
      case 'write-out':
        notes.add('info', flag, 'Only changes what curl prints. In code, read the value from the response object instead (for example response.status or response.status_code).');
        return;
      default:
        classifyUnhandled(name, flag, notes);
    }
  }

  function applySwitch(st, name, on, flag, notes) {
    st.flags[name] = flag;
    switch (name) {
      case 'get': st.get = on; return;
      case 'head': st.head = on; return;
      case 'location': st.location = on; return;
      case 'location-trusted':
        st.location = on;
        if (on) notes.add('info', flag, 'Also resends the credentials to other hosts after a redirect. The generated clients follow redirects but drop the Authorization header when the host changes.');
        return;
      case 'insecure': st.insecure = on; return;
      case 'compressed': st.compressed = on; return;
      case 'fail':
      case 'fail-with-body': st.fail = on; return;
      case 'include':
      case 'show-headers': st.include = on; return;
      case 'remote-name': st.remoteName = on; return;
      case 'globoff': st.globoff = on; return;
      case 'basic': if (on) st.authType = 'basic'; return;
      case 'digest': st.authType = on ? 'digest' : 'basic'; return;
      case 'anyauth':
        if (on) {
          st.authType = 'basic';
          notes.add('unsupported', flag, 'Lets curl negotiate the authentication scheme with the server; the code uses Basic authentication.');
        }
        return;
      case 'ntlm':
      case 'ntlm-wb':
      case 'negotiate':
        if (on) {
          st.authType = name;
          st.flags.auth = flag;
        }
        return;
      default:
        classifyUnhandled(name, flag, notes);
    }
  }

  function classifyUnhandled(name, flag, notes) {
    if (has(OUTPUT_ONLY, name)) {
      notes.add('info', flag, "Only affects curl's own output or local files; there is nothing to translate.");
    } else if (has(HTTP_VERSION, name)) {
      notes.add('unsupported', flag, 'The HTTP version is not carried over: requests always uses HTTP/1.1, while browsers, Node.js fetch and axios pick the version themselves.');
    } else if (has(TLS_TUNING, name)) {
      notes.add('unsupported', flag, 'TLS version and cipher settings are not carried over; the generated code uses the client defaults.');
    } else if (has(TRANSPORT, name)) {
      notes.add('unsupported', flag, 'Connection tuning is not carried over; the generated code uses the client defaults.');
    } else {
      notes.add('unsupported', flag, has(UNSUPPORTED_WHY, name) ? UNSUPPORTED_WHY[name] : (prefixReason(name) || 'Not translated: the generated code does not reproduce this option.'));
    }
  }

  function prefixReason(name) {
    if (/^(ftp|tftp|mail|telnet|ssh)-/.test(name) ||
      /^(quote|list-only|append|use-ascii|crlf|knownhosts|hostpubmd5|hostpubsha256|pubkey|compressed-ssh)$/.test(name)) {
      return 'Only applies to non-HTTP protocols (FTP, SMTP, SSH, TFTP, TELNET and so on).';
    }
    if (/^proxy-/.test(name)) return 'Proxy TLS and authentication details are not carried over.';
    return null;
  }

  // ── Request model ───────────────────────────────────────

  function findHeader(headers, ln) {
    for (var k = 0; k < headers.length; k++) {
      if (lower(headers[k].name) === ln) return headers[k];
    }
    return null;
  }

  function headerValue(headers, ln) {
    var h = findHeader(headers, ln);
    return h ? h.value : null;
  }

  function urlencodeArg(v, flag, notes) {
    var p = v.search(/[=@]/);
    if (p === -1) return formEscape(v);
    if (v.charAt(p) === '=') return (p > 0 ? v.slice(0, p) + '=' : '') + formEscape(v.slice(p + 1));
    var name = v.slice(0, p), file = v.slice(p + 1);
    notes.add('unsupported', flag, 'URL-encodes the contents of the file "' + file + '", which the converter cannot read. A placeholder marks the spot.');
    return (name ? name + '=' : '') + '<contents of ' + file + '>';
  }

  function dataSegment(d, st, notes) {
    var v = d.value;
    if (d.mode === 'raw') return { text: v, mode: d.mode };
    if (d.mode === 'urlencode') return { text: urlencodeArg(v, d.flag, notes), mode: d.mode };
    if (v.charAt(0) !== '@') return { text: v, mode: d.mode };
    var file = v.slice(1), strip = d.mode === 'data';
    if (file === '-') {
      if (st.stdin !== null) return { text: strip ? st.stdin.replace(/[\r\n]/g, '') : st.stdin, mode: d.mode };
      if (st.stdinFile !== null) return { file: st.stdinFile, strip: strip, mode: d.mode, flag: d.flag };
      notes.add('unsupported', d.flag, '"@-" reads the body from standard input, which the converter cannot see. Put the data in the command, or read it from a file with @filename.');
      return { text: '', mode: d.mode };
    }
    return { file: file, strip: strip, mode: d.mode, flag: d.flag };
  }

  function splitUserInfo(info) {
    var c = info.indexOf(':');
    return { user: c === -1 ? info : info.slice(0, c), password: c === -1 ? null : info.slice(c + 1) };
  }

  function resolveProxy(st, notes) {
    if (st.proxy === null || st.proxy === '') return null;
    var flag = st.flags.proxy || '-x';
    var pm = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(st.proxy);
    var scheme = st.proxyScheme || (pm ? pm[1].toLowerCase() : 'http');
    var rest = pm ? st.proxy.slice(pm[0].length) : st.proxy;
    var user = null, password = null;
    var at = rest.lastIndexOf('@');
    if (at !== -1) {
      var info = splitUserInfo(rest.slice(0, at));
      user = percentDecode(info.user, false);
      password = info.password === null ? '' : percentDecode(info.password, false);
      rest = rest.slice(at + 1);
    }
    if (st.proxyUser !== null) {
      var pu = splitUserInfo(st.proxyUser);
      user = pu.user;
      password = pu.password === null ? '' : pu.password;
    }
    rest = rest.replace(/\/.*$/, '');
    var hp = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(rest);
    var host = hp ? hp[1] : rest, port = hp && hp[2] ? hp[2] : null;
    if (['http', 'https', 'socks4', 'socks4a', 'socks5', 'socks5h'].indexOf(scheme) === -1) {
      notes.add('unsupported', flag, 'The proxy scheme ' + scheme + ':// is not supported by the generated clients.');
      return null;
    }
    if (!host) {
      notes.add('warn', flag, 'The proxy has no host name and was ignored.');
      return null;
    }
    if (!port) {
      port = scheme === 'https' ? '443' : '1080';
      notes.add('info', flag, 'No proxy port was given, so curl uses ' + port + '. The code spells the port out because the clients would pick a different default.');
    }
    var cred = user !== null ? encodeURIComponent(user) + ':' + encodeURIComponent(password) + '@' : '';
    return { scheme: scheme, host: host, port: port, user: user, password: password, flag: flag, url: scheme + '://' + cred + host + ':' + port };
  }

  function buildRequest(st, notes) {
    var flags = st.flags;
    if (!st.urls.length) {
      notes.add('error', null, 'No URL found. Add the address to call, for example https://api.example.com/items.');
      return null;
    }
    if (st.urls.length > 1) notes.add('unsupported', null, 'curl would request ' + st.urls.length + ' URLs one after another; only the first one (' + truncate(st.urls[0], 60) + ') is converted.');

    // URL
    var rawUrl = st.urls[0].trim();
    if (!st.globoff && GLOB_RE.test(rawUrl)) notes.add('unsupported', null, 'The URL contains a curl glob pattern ({a,b} or [1-9]) that curl would expand into several requests. It is used literally; add -g if the braces or brackets are meant literally.');
    if (/\s/.test(rawUrl)) notes.add('warn', null, 'The URL contains whitespace, which curl rejects. Encode spaces as %20.');
    var hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(rawUrl);
    if (!hasScheme) notes.add('info', null, 'The URL has no scheme, so curl assumes http://.');
    var m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^\/?#]*)([^?#]*)(?:\?([^#]*))?(#[\s\S]*)?$/.exec(hasScheme ? rawUrl : 'http://' + rawUrl);
    if (!m) {
      notes.add('error', null, 'The URL could not be read.');
      return null;
    }
    var scheme = m[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      notes.add('error', null, 'Only http:// and https:// URLs can be converted (this one uses ' + scheme + '://).');
      return null;
    }
    var authority = m[2], path = m[3], query = m[4] === undefined ? null : m[4], fragment = m[5] || '';
    var urlCreds = null;
    var at = authority.lastIndexOf('@');
    if (at !== -1) {
      var info = splitUserInfo(authority.slice(0, at));
      urlCreds = { user: percentDecode(info.user, false), password: info.password === null ? '' : percentDecode(info.password, false) };
      authority = authority.slice(at + 1);
    }
    if (!authority) {
      notes.add('error', null, 'The URL has no host name.');
      return null;
    }
    if (fragment) notes.add('info', null, 'The #fragment part of the URL is never sent to the server, not by curl and not by the generated code.');

    var hasData = st.data.length > 0, hasForm = st.form.length > 0;

    // -T upload
    var upload = st.upload, uploadFlag = flags['upload-file'] || '-T', uploadBody = null;
    if (upload !== null && (hasData || hasForm)) {
      notes.add('warn', uploadFlag, 'curl refuses to combine -T with -d or -F ("You can only select one HTTP request method"). The upload was left out.');
      upload = null;
    }
    if (upload !== null) {
      if (upload === '-' || upload === '.') {
        if (st.stdin !== null) uploadBody = { kind: 'text', text: st.stdin, upload: true };
        else if (st.stdinFile !== null) uploadBody = { kind: 'file', file: st.stdinFile, strip: false, upload: true };
        else notes.add('unsupported', uploadFlag, 'Uploads standard input, which the converter cannot see.');
      } else {
        uploadBody = { kind: 'file', file: upload, strip: false, upload: true };
        if (path === '' || path.charAt(path.length - 1) === '/') {
          path = (path || '/') + curlEscape(basename(upload));
          notes.add('info', uploadFlag, 'curl adds the file name to a URL that ends with "/", so the code uploads to ' + path + '.');
        }
      }
    }

    // --url-query
    st.urlQuery.forEach(function (q) {
      var piece = q.value.charAt(0) === '+' ? q.value.slice(1) : urlencodeArg(q.value, q.flag, notes);
      if (piece !== '') query = query === null ? piece : query + '&' + piece;
    });

    // --data*, --json
    var body = null;
    if (hasData) {
      var segs = st.data.map(function (d) { return dataSegment(d, st, notes); });
      var single = segs.length === 1 && segs[0].file ? segs[0] : null;
      var text = '', files = [];
      if (!single) {
        segs.forEach(function (s, idx) {
          if (idx) text += s.mode === 'json' ? '' : '&';
          if (s.file) {
            files.push(s.file);
            text += '<contents of ' + s.file + '>';
          } else {
            text += s.text;
          }
        });
        if (files.length) notes.add('unsupported', null, 'Combining file data (' + files.join(', ') + ') with other --data values is not converted; placeholders mark where the file contents would go.');
      }
      if (st.get) {
        var getQuery = text;
        if (single) {
          notes.add('unsupported', single.flag, 'With -G curl would put the contents of "' + single.file + '" into the query string; the converter cannot read files.');
          getQuery = '<contents of ' + single.file + '>';
        }
        if (getQuery !== '') query = query === null ? getQuery : query + '&' + getQuery;
      } else if (!hasForm) {
        body = single ? { kind: 'file', file: single.file, strip: single.strip } : { kind: 'text', text: text };
      }
    }
    if (hasForm) {
      body = { kind: 'multipart', parts: st.form };
      if (hasData) notes.add('error', null, 'curl refuses to combine -d/--data with -F/--form ("You can only select one HTTP request method"). Only the -F parts were converted.');
      if (st.get) notes.add('warn', flags.get || '-G', '-G cannot move -F form data into the URL; curl would reject this combination. The form is sent as a POST body.');
    }
    if (!body && uploadBody) body = uploadBody;

    // Method
    var method = 'GET';
    if (st.head) method = 'HEAD';
    else if (hasForm || (hasData && !st.get)) method = 'POST';
    else if (uploadBody) method = 'PUT';
    if (st.method !== null) {
      var up = st.method.toUpperCase();
      var custom = has(STANDARD_METHODS, up) ? up : st.method;
      if (custom !== st.method) notes.add('info', flags.request, 'curl sends the method exactly as typed ("' + st.method + '"); the code uses ' + custom + ', which is what servers expect.');
      if (custom === 'HEAD' && !st.head) notes.add('warn', flags.request, '-X HEAD makes curl wait for a response body that never arrives; use -I (--head) instead. The code sends a normal HEAD request.');
      if (st.location && custom !== 'GET' && custom !== 'HEAD') notes.add('info', flags.request, 'With -X and -L, curl keeps sending ' + custom + ' after a redirect. The generated clients switch to GET after a 301, 302 or 303, as browsers do.');
      method = custom;
    }

    // Headers: -H, -A, -e, -b, -r
    var removed = {};
    st.removed.forEach(function (r) { removed[lower(r)] = true; });
    var explicit = {};
    st.headerList.forEach(function (h) { if (h.kind === 'header') explicit[lower(h.name)] = true; });
    var headers = [];
    st.headerList.forEach(function (h) {
      var ln = lower(h.name);
      if (h.kind === 'option') {
        if (has(explicit, ln)) {
          notes.add('info', h.flag, 'The -H "' + h.name + ': ..." header replaces the value from ' + h.flag + ', as in curl.');
          return;
        }
        if (has(removed, ln)) return;
        headers.push({ name: h.name, value: h.value, flag: h.flag, source: 'option' });
        return;
      }
      var existing = findHeader(headers, ln);
      if (existing) {
        var sep = ln === 'cookie' ? '; ' : ', ';
        existing.value += sep + h.value;
        notes.add('warn', h.flag, 'The ' + h.name + ' header is given more than once. curl sends separate header lines; the code joins the values with "' + sep.trim() + '", which servers normally read the same way.');
        return;
      }
      headers.push({ name: h.name, value: h.value, flag: h.flag, source: 'header' });
    });
    headers = headers.filter(function (h) {
      if (lower(h.name) !== 'content-length') return true;
      notes.add('info', h.flag, 'Content-Length was left out: the HTTP client calculates it from the actual body.');
      return false;
    });
    if (body && body.kind === 'multipart') {
      headers = headers.filter(function (h) {
        if (lower(h.name) !== 'content-type') return true;
        if (/^multipart\/form-data/i.test(h.value)) notes.add('info', h.flag, 'The multipart Content-Type header was left out: the client adds it together with the boundary it generates.');
        else notes.add('warn', h.flag, 'A custom Content-Type on a -F request was left out; the generated clients always send multipart/form-data with their own boundary.');
        return false;
      });
    }
    var jsonMode = st.data.some(function (d) { return d.mode === 'json'; });
    if (body && (body.kind === 'text' || body.kind === 'file') && !body.upload && !findHeader(headers, 'content-type') && !has(removed, 'content-type')) {
      headers.push({ name: 'Content-Type', value: jsonMode ? 'application/json' : 'application/x-www-form-urlencoded', flag: jsonMode ? (flags.json || '--json') : null, implicit: true });
    }
    if (jsonMode && !findHeader(headers, 'accept') && !has(removed, 'accept')) {
      headers.push({ name: 'Accept', value: 'application/json', flag: flags.json || '--json', implicit: true });
    }
    if (st.bearer !== null) {
      if (findHeader(headers, 'authorization')) notes.add('info', flags['oauth2-bearer'], 'An explicit Authorization header replaces the --oauth2-bearer token, as in curl.');
      else headers.push({ name: 'Authorization', value: 'Bearer ' + st.bearer, flag: flags['oauth2-bearer'], source: 'option' });
    }

    // Authentication
    var auth = null, creds = null;
    if (st.user !== null) {
      var u = splitUserInfo(st.user);
      creds = { user: u.user, password: u.password, flag: flags.user || '-u' };
      if (u.password === null) {
        notes.add('warn', creds.flag, 'No password given: curl would ask for it interactively. The code uses an empty password; fill in the real one.');
        creds.password = '';
      }
      if (urlCreds) notes.add('info', creds.flag, 'Credentials in the URL are replaced by ' + creds.flag + ', as in curl.');
    } else if (urlCreds) {
      creds = { user: urlCreds.user, password: urlCreds.password, flag: 'URL' };
      notes.add('info', null, 'The user name and password in the URL were moved to Basic authentication (fetch() rejects URLs that contain credentials).');
    }
    if (creds) {
      if (findHeader(headers, 'authorization')) {
        notes.add('info', creds.flag, 'The Authorization header wins over the credentials from ' + creds.flag + ', as in curl.');
      } else if (st.authType === 'ntlm' || st.authType === 'ntlm-wb' || st.authType === 'negotiate') {
        var kerberos = st.authType === 'negotiate';
        notes.add('unsupported', flags.auth, (kerberos ? 'Negotiate (Kerberos/SPNEGO)' : 'NTLM') + ' authentication is not converted, so the credentials were left out. For Python, look at the ' + (kerberos ? 'requests-kerberos' : 'requests-ntlm') + ' package.');
      } else {
        auth = { type: st.authType === 'digest' ? 'digest' : 'basic', user: creds.user, password: creds.password, flag: creds.flag };
      }
    }

    // Body details: JSON and form analysis
    if (body && body.kind === 'text') {
      var ct = headerValue(headers, 'content-type') || '';
      if (/json/i.test(ct)) {
        try {
          body.json = parseJsonTree(body.text);
        } catch (err) {
          notes.add('warn', null, 'The Content-Type says JSON, but the body is not valid JSON (' + err.message + '). It is sent as a plain string.');
        }
      } else if (/^application\/x-www-form-urlencoded/i.test(ct) && /^\s*[\[{]/.test(body.text) && isJson(body.text) && findHeader(headers, 'content-type').implicit) {
        notes.add('warn', null, 'The body looks like JSON, but curl sends it as application/x-www-form-urlencoded because no Content-Type header was given. If the API expects JSON, add -H "Content-Type: application/json" or use --json.');
      }
      if (/^application\/x-www-form-urlencoded/i.test(ct)) body.form = true;
    }

    // Output
    var output = st.output, discard = false;
    if (output === null && st.remoteName) {
      var seg = path.split('/').pop();
      if (seg) output = seg;
      else notes.add('warn', flags['remote-name'] || '-O', 'The URL has no file name, which -O needs; the code prints the response instead.');
    }
    if (output === null && st.stdout !== null) {
      output = st.stdout;
      notes.add('info', '>', 'The shell redirect to "' + st.stdout + '" is treated like -o.');
    }
    if (output === '-') output = null;
    else if (output !== null && /^(\/dev\/null|nul)$/i.test(output)) {
      output = null;
      discard = true;
    }

    if (st.compressed) notes.add('info', flags.compressed, 'All generated clients decompress responses automatically, so no extra code is needed.');
    if (st.insecure && st.cacert) notes.add('info', flags.cacert, '-k turns certificate checks off, so --cacert has no effect (the same happens in curl).');

    var base = scheme + '://' + authority + path;
    var queryPairs = query ? query.split('&').filter(Boolean).map(function (p) {
      var e = p.indexOf('=');
      return { rawName: e === -1 ? p : p.slice(0, e), rawValue: e === -1 ? null : p.slice(e + 1) };
    }) : [];

    return {
      method: method,
      url: base + (query !== null ? '?' + query : '') + fragment,
      base: base,
      query: query,
      queryPairs: queryPairs,
      fragment: fragment,
      headers: headers,
      auth: auth,
      body: body,
      follow: st.location,
      insecure: st.insecure,
      fail: st.fail,
      include: st.include,
      maxTime: st.maxTime,
      connectTimeout: st.connectTimeout,
      proxy: resolveProxy(st, notes),
      cert: st.cert,
      key: st.key,
      cacert: st.insecure ? null : st.cacert,
      output: output,
      discard: discard,
      flags: flags
    };
  }

  // ── JSON with exact numbers ─────────────────────────────

  // JSON.parse turns 12345678901234567890 into 12345678901234567000; this
  // parser keeps each number's original text so no digits get lost.
  function parseJsonTree(text) {
    var i = 0, n = text.length;

    function fail(msg) { throw new Error(msg + ' at position ' + i); }

    function ws() {
      while (i < n && ' \t\n\r'.indexOf(text.charAt(i)) !== -1) i++;
    }

    function string() {
      var j = i + 1;
      while (j < n) {
        var ch = text.charAt(j);
        if (ch === '\\') { j += 2; continue; }
        if (ch === '"') break;
        if (text.charCodeAt(j) < 0x20) {
          i = j;
          fail('control character inside a string');
        }
        j++;
      }
      if (j >= n) fail('unterminated string');
      var s;
      try {
        s = JSON.parse(text.slice(i, j + 1));
      } catch (e) {
        fail('invalid escape in a string');
      }
      i = j + 1;
      return s;
    }

    function value(depth) {
      if (depth > 400) fail('nesting too deep');
      ws();
      var c = text.charAt(i), m;
      if (c === '{') return object(depth);
      if (c === '[') return array(depth);
      if (c === '"') return { type: 'string', value: string() };
      if (text.substr(i, 4) === 'true') { i += 4; return { type: 'bool', value: true }; }
      if (text.substr(i, 5) === 'false') { i += 5; return { type: 'bool', value: false }; }
      if (text.substr(i, 4) === 'null') { i += 4; return { type: 'null' }; }
      if ((m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 400)))) {
        i += m[0].length;
        return { type: 'number', raw: m[0] };
      }
      fail(i >= n ? 'unexpected end of data' : 'unexpected character "' + c + '"');
    }

    function object(depth) {
      i++;
      var node = { type: 'object', entries: [], duplicate: false }, seen = {};
      ws();
      if (text.charAt(i) === '}') { i++; return node; }
      for (;;) {
        ws();
        if (text.charAt(i) !== '"') fail('expected a property name');
        var key = string();
        ws();
        if (text.charAt(i) !== ':') fail('expected ":"');
        i++;
        var val = value(depth + 1);
        if (has(seen, '$' + key)) node.duplicate = true;
        seen['$' + key] = true;
        node.entries.push({ key: key, value: val });
        ws();
        var c = text.charAt(i);
        if (c === ',') { i++; continue; }
        if (c === '}') { i++; return node; }
        fail('expected "," or "}"');
      }
    }

    function array(depth) {
      i++;
      var node = { type: 'array', items: [] };
      ws();
      if (text.charAt(i) === ']') { i++; return node; }
      for (;;) {
        node.items.push(value(depth + 1));
        ws();
        var c = text.charAt(i);
        if (c === ',') { i++; continue; }
        if (c === ']') { i++; return node; }
        fail('expected "," or "]"');
      }
    }

    var root = value(0);
    ws();
    if (i < n) fail('unexpected text after the JSON value');
    return root;
  }

  function isJson(text) {
    try {
      parseJsonTree(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  // A number as "digits e exponent" with no leading/trailing zeros, so that
  // 1.50, 15e-1 and 1.5 compare equal
  function normDecimal(s) {
    var m = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m) return null;
    var all = m[1] + (m[2] || ''), lead = all.length - all.replace(/^0+/, '').length;
    var digits = all.slice(lead).replace(/0+$/, '');
    if (!digits) return '0';
    return (s.charAt(0) === '-' ? '-' : '') + digits + 'e' + ((parseInt(m[3] || '0', 10) + m[1].length - lead));
  }

  // Does the number survive a trip through a double (JavaScript numbers,
  // Python floats) without changing its digits?
  function numberSafe(raw, lang) {
    if (lang === 'py' && !/[.eE]/.test(raw)) return true;   // Python ints are exact
    var num = Number(raw);
    return isFinite(num) && normDecimal(raw) === normDecimal(String(num));
  }

  // Can the parsed JSON be written as a Python/JS literal without changing the data?
  function treeSafe(node, lang) {
    if (node.type === 'number') return numberSafe(node.raw, lang);
    if (node.type === 'array') return node.items.every(function (x) { return treeSafe(x, lang); });
    if (node.type === 'object') {
      if (node.duplicate) return false;
      return node.entries.every(function (e) {
        return (lang !== 'js' || e.key !== '__proto__') && treeSafe(e.value, lang);
      });
    }
    return true;
  }

  // ── Code emit helpers ───────────────────────────────────

  // A string literal valid in both Python and JavaScript
  function quoteStr(s) {
    s = String(s);
    var q = s.indexOf("'") !== -1 && s.indexOf('"') === -1 ? '"' : "'";
    var out = q;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), code = s.charCodeAt(i);
      if (c === '\\') out += '\\\\';
      else if (c === q) out += '\\' + q;
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (code < 0x20 || code === 0x7F || (code >= 0x80 && code <= 0x9F)) out += '\\x' + hex(code, 2);
      else if (code === 0x2028 || code === 0x2029) out += '\\u' + hex(code, 4);
      else if (code >= 0xD800 && code <= 0xDBFF) {
        var next = s.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          out += c + s.charAt(i + 1);
          i++;
        } else {
          out += '\\u' + hex(code, 4);
        }
      } else if (code >= 0xDC00 && code <= 0xDFFF) out += '\\u' + hex(code, 4);
      else out += c;
    }
    return out + q;
  }

  function emitValue(node, lang, depth) {
    var unit = lang === 'py' ? '    ' : '  ';
    var pad = repeat(unit, depth), padIn = repeat(unit, depth + 1);
    switch (node.type) {
      case 'string': return quoteStr(node.value);
      case 'number': return node.raw;
      case 'bool': return lang === 'py' ? (node.value ? 'True' : 'False') : String(node.value);
      case 'null': return lang === 'py' ? 'None' : 'null';
      case 'array': {
        if (!node.items.length) return '[]';
        var items = node.items.map(function (it) { return emitValue(it, lang, depth + 1); });
        var oneLine = '[' + items.join(', ') + ']';
        if (oneLine.length <= 60 && oneLine.indexOf('\n') === -1) return oneLine;
        return '[\n' + items.map(function (x) { return padIn + x + ','; }).join('\n') + '\n' + pad + ']';
      }
      default: {
        if (!node.entries.length) return '{}';
        return '{\n' + node.entries.map(function (e) {
          var key = lang === 'js' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(e.key) ? e.key : quoteStr(e.key);
          return padIn + key + ': ' + emitValue(e.value, lang, depth + 1) + ',';
        }).join('\n') + '\n' + pad + '}';
      }
    }
  }

  function jsObject(pairs, depth) {
    var pad = repeat('  ', depth), padIn = repeat('  ', depth + 1);
    return '{\n' + pairs.map(function (p) { return padIn + p[0] + ': ' + p[1] + ','; }).join('\n') + '\n' + pad + '}';
  }

  function pyCollection(name, pairs) {
    var keys = {}, dup = false;
    pairs.forEach(function (p) {
      if (has(keys, p[0])) dup = true;
      keys[p[0]] = true;
    });
    if (dup) return name + ' = [\n' + pairs.map(function (p) { return '    (' + p[0] + ', ' + p[1] + '),'; }).join('\n') + '\n]';
    return name + ' = {\n' + pairs.map(function (p) { return '    ' + p[0] + ': ' + p[1] + ','; }).join('\n') + '\n}';
  }

  // True when requests would re-encode a&b=c pairs to exactly the same text
  function pairsRoundTrip(text) {
    if (!text) return false;
    var parts = text.split('&');
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k], e = p.indexOf('=');
      if (e === -1) return false;
      var name = p.slice(0, e), val = p.slice(e + 1);
      if (formEscape(percentDecode(name, true)) !== name || formEscape(percentDecode(val, true)) !== val) return false;
    }
    return true;
  }

  function decodedPairs(text) {
    return text.split('&').map(function (p) {
      var e = p.indexOf('=');
      return [quoteStr(percentDecode(p.slice(0, e), true)), quoteStr(percentDecode(p.slice(e + 1), true))];
    });
  }

  function cookiePairs(value) {
    var parts = value.split(/;\s*/).filter(Boolean), out = [], seen = {};
    for (var k = 0; k < parts.length; k++) {
      var e = parts[k].indexOf('=');
      if (e <= 0) return null;
      var name = parts[k].slice(0, e), val = parts[k].slice(e + 1);
      if (!COOKIE_NAME_RE.test(name) || !COOKIE_VALUE_RE.test(val) || has(seen, name)) return null;
      seen[name] = true;
      out.push([quoteStr(name), quoteStr(val)]);
    }
    return out.length ? out : null;
  }

  function isAscii(s) {
    return /^[\x00-\x7f]*$/.test(s);
  }

  function msFromSeconds(s) {
    return String(Math.round(s * 1000));
  }

  function commentSafe(s) {
    return String(s).replace(/[\r\n]+/g, ' ');
  }

  function isForbiddenHeader(ln) {
    return has(FORBIDDEN_HEADERS, ln) || ln.indexOf('proxy-') === 0 || ln.indexOf('sec-') === 0;
  }

  function nonAsciiHeaderNote(notes, headers) {
    headers.forEach(function (h) {
      if (!isAscii(h.value)) notes.add('warn', h.name, 'This header value has non-ASCII characters. curl sends them as UTF-8 bytes, while fetch() and axios send Latin-1 or throw an error for other characters. Keep header values ASCII, for example percent-encoded.');
    });
  }

  function jsonRebuiltNote(notes, where) {
    notes.add('info', null, 'The JSON body is rebuilt from the parsed data (' + where + '), so spacing can differ from the original text while the data stays the same. Send the original string instead if a signature depends on the exact bytes.');
  }

  // ── Generator: Python requests ──────────────────────────

  function pyPart(p) {
    var type = p.type ? ', ' + quoteStr(p.type) : '';
    if (p.kind === 'text') return '(None, ' + quoteStr(p.value) + type + ')';
    if (p.kind === 'filecontent') return '(None, open(' + quoteStr(p.value) + ", 'rb').read()" + type + ')';
    var fname = p.filename !== null ? p.filename : basename(p.value);
    return '(' + quoteStr(fname) + ', open(' + quoteStr(p.value) + ", 'rb')" + type + ')';
  }

  function pyCred(s) {
    return quoteStr(s) + (isAscii(s) ? '' : '.encode()');
  }

  function genPython(req) {
    var notes = createNotes();
    var flags = req.flags;
    var imports = ['import requests'];
    var blocks = { params: null, cookies: null, headers: null, body: null, proxies: null };
    var kwargs = [];
    var url = req.url;
    var headers = req.headers.slice();
    var b = req.body;
    var bodyKw = null;

    if (req.queryPairs.length && !req.fragment && pairsRoundTrip(req.query)) {
      blocks.params = pyCollection('params', decodedPairs(req.query));
      url = req.base;
    }

    var cookie = findHeader(headers, 'cookie');
    if (cookie && cookie.source === 'option') {
      var jar = cookiePairs(cookie.value);
      if (jar) {
        blocks.cookies = pyCollection('cookies', jar);
        headers.splice(headers.indexOf(cookie), 1);
      }
    }

    if (b && b.kind === 'text') {
      var dropType = null;
      if (b.json && treeSafe(b.json, 'py')) {
        blocks.body = 'json_data = ' + emitValue(b.json, 'py', 0);
        bodyKw = 'json=json_data';
        dropType = 'application/json';
        jsonRebuiltNote(notes, 'json=json_data');
      } else if (b.form && pairsRoundTrip(b.text)) {
        blocks.body = pyCollection('data', decodedPairs(b.text));
        bodyKw = 'data=data';
        dropType = 'application/x-www-form-urlencoded';
      } else {
        blocks.body = 'data = ' + quoteStr(b.text) + (isAscii(b.text) ? '' : '.encode()');
        bodyKw = 'data=data';
      }
      if (dropType) {
        headers = headers.filter(function (h) { return !(h.implicit && lower(h.name) === 'content-type' && h.value === dropType); });
      }
    } else if (b && b.kind === 'file') {
      blocks.body = 'with open(' + quoteStr(b.file) + ", 'rb') as f:\n    data = f.read()" +
        (b.strip ? ".replace(b'\\r', b'').replace(b'\\n', b'')" : '');
      bodyKw = 'data=data';
    } else if (b && b.kind === 'multipart') {
      blocks.body = pyCollection('files', b.parts.map(function (p) { return [quoteStr(p.name), pyPart(p)]; }));
      bodyKw = 'files=files';
    }

    // requests sends str header values as Latin-1; bytes keep curl's UTF-8
    if (headers.length) blocks.headers = pyCollection('headers', headers.map(function (h) { return [quoteStr(h.name), pyCred(h.value)]; }));

    if (blocks.params) kwargs.push('params=params');
    if (blocks.cookies) kwargs.push('cookies=cookies');
    if (blocks.headers) kwargs.push('headers=headers');
    if (bodyKw) kwargs.push(bodyKw);

    if (req.auth) {
      var creds = pyCred(req.auth.user) + ', ' + pyCred(req.auth.password);
      if (req.auth.type === 'digest') {
        imports.push('from requests.auth import HTTPDigestAuth');
        kwargs.push('auth=HTTPDigestAuth(' + creds + ')');
      } else {
        kwargs.push('auth=(' + creds + ')');
      }
    }
    if (req.proxy) {
      blocks.proxies = pyCollection('proxies', [["'http'", quoteStr(req.proxy.url)], ["'https'", quoteStr(req.proxy.url)]]);
      kwargs.push('proxies=proxies');
      if (/^socks/.test(req.proxy.scheme)) notes.add('info', req.proxy.flag, 'SOCKS proxies need the PySocks extra: pip install "requests[socks]".');
    }
    if (req.cert) kwargs.push('cert=' + (req.key ? '(' + quoteStr(req.cert) + ', ' + quoteStr(req.key) + ')' : quoteStr(req.cert)));
    if (req.insecure) {
      kwargs.push('verify=False');
      notes.add('warn', flags.insecure, 'verify=False turns off certificate checks, as -k does. requests prints an InsecureRequestWarning for every request.');
    } else if (req.cacert) {
      kwargs.push('verify=' + quoteStr(req.cacert));
    }
    if (req.connectTimeout !== null && req.maxTime !== null) kwargs.push('timeout=(' + req.connectTimeout + ', ' + req.maxTime + ')');
    else if (req.maxTime !== null) kwargs.push('timeout=' + req.maxTime);
    else if (req.connectTimeout !== null) kwargs.push('timeout=(' + req.connectTimeout + ', None)');
    if (req.maxTime !== null) notes.add('info', flags['max-time'], 'requests has no limit for the whole transfer: timeout= applies to connecting and to each read separately.');
    if (req.method === 'HEAD' && req.follow) kwargs.push('allow_redirects=True');
    else if (!req.follow && req.method !== 'HEAD') notes.add('info', null, 'curl follows redirects only with -L, requests follows them by default. Add allow_redirects=False to stop at a redirect like curl does.');

    if (/%(?:[0-9A-F][a-f]|[a-f][0-9a-fA-F])/.test(url) || /%(?:[46][1-9A-Fa-f]|[57][0-9Aa]|3[0-9]|2[DEde]|5[Ff]|7[Ee])/.test(url)) {
      notes.add('info', null, 'requests tidies percent-escapes in the URL (%2f becomes %2F, %41 becomes A). Servers treat both spellings as the same URL.');
    }
    var enc = headerValue(req.headers, 'accept-encoding');
    if (enc && /\b(br|zstd)\b/i.test(enc)) notes.add('info', 'Accept-Encoding', 'requests only decodes br and zstd responses when the brotli or zstandard package is installed.');

    var fn = has(STANDARD_METHODS, req.method) ? 'requests.' + req.method.toLowerCase() : 'requests.request';
    var callArgs = (fn === 'requests.request' ? [quoteStr(req.method)] : []).concat([quoteStr(url)], kwargs);
    var call = 'response = ' + fn + '(' + callArgs.join(', ') + ')';
    if (call.length > CALL_WIDTH) call = 'response = ' + fn + '(\n' + callArgs.map(function (a) { return '    ' + a + ','; }).join('\n') + '\n)';

    var tail = [];
    if (req.fail) tail.push('response.raise_for_status()');
    if (req.include || req.method === 'HEAD') {
      tail.push('print(response.status_code, response.reason)', 'for name, value in response.headers.items():', "    print(f'{name}: {value}')");
    }
    if (req.output) tail.push('with open(' + quoteStr(req.output) + ", 'wb') as f:", '    f.write(response.content)');
    else if (!req.discard && req.method !== 'HEAD') tail.push('print(response.text)');

    var sections = [imports.join('\n')];
    ['params', 'cookies', 'headers', 'body', 'proxies'].forEach(function (k) { if (blocks[k]) sections.push(blocks[k]); });
    sections.push(call);
    if (tail.length) sections.push(tail.join('\n'));
    return { code: sections.join('\n\n') + '\n', notes: notes.list };
  }

  // ── Generator: fetch (browser and Node.js) ──────────────

  function genFetch(req, node) {
    var notes = createNotes();
    var flags = req.flags;
    var imports = [], fsNames = [], pre = [], init = [], hdrs = [], omitted = [];
    var method = req.method, b = req.body;
    var fileVars = {}, fileCount = 0;
    var referrer = null, cookie = false, userAgent = false;

    function useFs(fn) {
      if (fsNames.indexOf(fn) === -1) fsNames.push(fn);
    }

    function browserFile(path) {
      if (has(fileVars, path)) return fileVars[path];
      if (!fileCount) {
        pre.push("// Browsers can't open files by path: take them from <input type=\"file\"> elements.");
        pre.push("const fileInputs = document.querySelectorAll('input[type=\"file\"]');");
      }
      var v = 'file' + (fileCount + 1);
      pre.push('const ' + v + ' = fileInputs[' + fileCount + '].files[0]; // ' + commentSafe(path));
      fileCount++;
      fileVars[path] = v;
      notes.add('warn', null, 'A web page cannot read "' + path + '" from disk. The code takes the file from an <input type="file"> element on the page instead.');
      return v;
    }

    req.headers.forEach(function (h) {
      var ln = lower(h.name);
      if (!node) {
        if (ln === 'referer') { referrer = h.value; return; }
        if (ln === 'cookie') { cookie = true; omitted.push(h.name); return; }
        if (isForbiddenHeader(ln)) { omitted.push(h.name); return; }
        if (ln === 'user-agent') userAgent = true;
      }
      hdrs.push([quoteStr(h.name), quoteStr(h.value)]);
    });

    if (req.auth) {
      if (req.auth.type === 'digest') {
        notes.add('unsupported', flags.digest, 'fetch() has no Digest authentication, so the credentials were left out. Use a Digest auth library, or Python requests (HTTPDigestAuth).');
      } else {
        var cred = req.auth.user + ':' + req.auth.password, expr;
        if (node) expr = "'Basic ' + Buffer.from(" + quoteStr(cred) + ").toString('base64')";
        else if (/^[\x20-\x7e]*$/.test(cred)) expr = "'Basic ' + btoa(" + quoteStr(cred) + ')';
        else {
          expr = quoteStr('Basic ' + base64(utf8Bytes(cred)));
          notes.add('info', req.auth.flag, 'The Basic credentials are pre-encoded because btoa() cannot handle characters outside Latin-1.');
        }
        hdrs.push(["'Authorization'", expr]);
      }
    }

    var bodyCode = null;
    if (b && (method === 'GET' || method === 'HEAD')) {
      notes.add('warn', null, 'fetch() cannot send a body with a ' + method + ' request (curl can). The body was left out; use -G to move form data into the URL, or another method.');
      b = null;
    }
    if (b && b.kind === 'text' && !findHeader(req.headers, 'content-type')) {
      notes.add('info', null, 'fetch() labels a string body text/plain;charset=UTF-8 when no Content-Type is set; curl sends no Content-Type here.');
    }
    if (b && b.kind === 'text') {
      if (b.json && treeSafe(b.json, 'js')) {
        bodyCode = 'JSON.stringify(' + emitValue(b.json, 'js', 1) + ')';
        jsonRebuiltNote(notes, 'JSON.stringify');
      } else {
        bodyCode = quoteStr(b.text);
        if (b.json) notes.add('info', null, 'The JSON body is sent as the original string because it has numbers JavaScript cannot hold exactly, or duplicate keys.');
      }
    } else if (b && b.kind === 'file') {
      if (node) {
        useFs('readFileSync');
        bodyCode = b.strip
          ? 'readFileSync(' + quoteStr(b.file) + ", 'utf8').replace(/[\\r\\n]/g, '')"
          : 'readFileSync(' + quoteStr(b.file) + ')';
      } else {
        var fv = browserFile(b.file);
        bodyCode = b.strip ? '(await ' + fv + ".text()).replace(/[\\r\\n]/g, '')" : fv;
      }
    } else if (b && b.kind === 'multipart') {
      var formLines = ['const form = new FormData();'];
      b.parts.forEach(function (p) {
        var field = quoteStr(p.name);
        if (p.kind === 'text') {
          formLines.push('form.append(' + field + ', ' + quoteStr(p.value) + ');');
          if (p.type) notes.add('info', p.flag, 'The ;type= of the text field "' + p.name + '" is not reproduced.');
        } else if (p.kind === 'filecontent') {
          if (node) {
            useFs('readFileSync');
            formLines.push('form.append(' + field + ', readFileSync(' + quoteStr(p.value) + ", 'utf8'));");
          } else {
            formLines.push('form.append(' + field + ', await ' + browserFile(p.value) + '.text());');
          }
        } else {
          var fname = quoteStr(p.filename !== null ? p.filename : basename(p.value));
          var typeOpt = p.type ? ', { type: ' + quoteStr(p.type) + ' }' : '';
          if (node) {
            useFs('readFileSync');
            formLines.push('form.append(' + field + ', new Blob([readFileSync(' + quoteStr(p.value) + ')]' + typeOpt + '), ' + fname + ');');
          } else {
            var file = browserFile(p.value);
            formLines.push('form.append(' + field + ', ' + (p.type ? 'new Blob([' + file + ']' + typeOpt + ')' : file) + ', ' + fname + ');');
          }
        }
      });
      pre = pre.concat(formLines);
      bodyCode = 'form';
    }

    if (method !== 'GET') init.push(['method', quoteStr(method)]);
    if (hdrs.length) init.push(['headers', jsObject(hdrs, 1)]);
    if (bodyCode) init.push(['body', bodyCode]);
    if (referrer !== null) {
      init.push(['referrer', quoteStr(referrer)]);
      notes.add('warn', 'Referer', "Scripts can't set the Referer header in a browser. The code passes it as the referrer option, which the browser only honours for URLs from the page's own origin.");
    }
    if (cookie) {
      init.push(['credentials', "'include'"]);
      notes.add('warn', 'Cookie', "Scripts can't set the Cookie header in a browser. credentials: 'include' makes the browser send its own cookies for that site instead; the cookie values from the command are not used.");
    }
    if (req.maxTime !== null) init.push(['signal', 'AbortSignal.timeout(' + msFromSeconds(req.maxTime) + ')']);
    if (req.connectTimeout !== null) {
      notes.add('unsupported', flags['connect-timeout'], 'fetch() has no separate connect timeout' + (req.maxTime === null ? '. Add AbortSignal.timeout() for an overall limit.' : '; the overall -m limit is kept.'));
    }

    if (node) {
      var tls = [];
      if (req.insecure) tls.push('rejectUnauthorized: false');
      if (req.cacert) { useFs('readFileSync'); tls.push('ca: readFileSync(' + quoteStr(req.cacert) + ')'); }
      if (req.cert) { useFs('readFileSync'); tls.push('cert: readFileSync(' + quoteStr(req.cert) + ')'); }
      if (req.key) { useFs('readFileSync'); tls.push('key: readFileSync(' + quoteStr(req.key) + ')'); }
      var proxy = req.proxy;
      if (proxy && /^socks/.test(proxy.scheme)) {
        notes.add('unsupported', proxy.flag, "undici's ProxyAgent supports HTTP and HTTPS proxies only. For SOCKS, use a package such as socks-proxy-agent with node:https.");
        proxy = null;
      }
      if (proxy) {
        imports.push("import { fetch, ProxyAgent } from 'undici'; // npm install undici");
        init.push(['dispatcher', 'new ProxyAgent({ uri: ' + quoteStr(proxy.url) + (tls.length ? ', requestTls: { ' + tls.join(', ') + ' }' : '') + ' })']);
      } else if (tls.length) {
        imports.push("import { fetch, Agent } from 'undici'; // npm install undici");
        init.push(['dispatcher', 'new Agent({ connect: { ' + tls.join(', ') + ' } })']);
      }
      if (imports.length) notes.add('info', null, "Node's built-in fetch has no options for proxies or TLS, so the code uses fetch from the undici package (npm install undici).");
      if (req.insecure) notes.add('warn', flags.insecure, 'rejectUnauthorized: false turns off certificate checks for this request, as -k does.');
    } else {
      if (req.insecure) notes.add('unsupported', flags.insecure, 'Browsers never skip certificate checks; a page cannot turn them off.');
      if (req.proxy) notes.add('unsupported', req.proxy.flag, 'A web page cannot choose a proxy; the browser uses the system proxy settings.');
      if (req.cert || req.key || req.cacert) notes.add('unsupported', flags.cert || flags.key || flags.cacert, 'Client certificates and CA files are managed by the browser and the operating system, not by page scripts.');
    }

    var tail = [];
    if (req.fail) tail.push('if (response.status >= 400) {', '  throw new Error(`HTTP ${response.status} ${response.statusText}`);', '}');
    if (req.include || method === 'HEAD') {
      tail.push('console.log(response.status, response.statusText);', 'for (const [name, value] of response.headers) {', '  console.log(`${name}: ${value}`);', '}');
    }
    if (req.output && node) {
      useFs('writeFileSync');
      tail.push('writeFileSync(' + quoteStr(req.output) + ', Buffer.from(await response.arrayBuffer()));');
    } else if (req.output) {
      notes.add('unsupported', flags.output || flags['remote-name'] || '-o', 'A web page cannot write "' + req.output + '" to disk, so the code prints the response instead. A download link built from response.blob() is the browser alternative.');
      tail.push('console.log(await response.text());');
    } else if (!req.discard && method !== 'HEAD') {
      tail.push('console.log(await response.text());');
    }

    nonAsciiHeaderNote(notes, req.headers);
    if (omitted.length) notes.add('warn', null, 'The browser controls these headers and ignores them in fetch(), so they were left out: ' + omitted.join(', ') + '.');
    if (userAgent) notes.add('warn', 'User-Agent', 'Chromium-based browsers ignore a custom User-Agent in fetch(); Firefox sends it.');
    if (!node) notes.add('info', null, 'From a web page, a request to another origin only works if the server allows it with CORS headers. curl has no such limit.');
    if (!req.follow) {
      notes.add('info', null, "fetch() follows redirects by default, curl only with -L. Set redirect: 'manual' to stop at a redirect" +
        (node ? '.' : ' (the browser then returns an opaque response without the Location header).'));
    }

    var head = [];
    if (node) head.push('// Node.js 18+. Save as .mjs (or set "type": "module") so top-level await works.');
    head = head.concat(imports);
    if (fsNames.length) head.push('import { ' + fsNames.join(', ') + " } from 'node:fs';");

    var call = 'const response = await fetch(' + quoteStr(req.url) + (init.length ? ', ' + jsObject(init, 0) : '') + ');';
    if (omitted.length) call = '// Left out, the browser controls them: ' + omitted.join(', ') + '\n' + call;

    var sections = [];
    if (head.length) sections.push(head.join('\n'));
    if (pre.length) sections.push(pre.join('\n'));
    sections.push(call);
    if (tail.length) sections.push(tail.join('\n'));
    return { code: sections.join('\n\n') + '\n', notes: notes.list };
  }

  // ── Generator: Node.js axios ────────────────────────────

  function genAxios(req) {
    var notes = createNotes();
    var flags = req.flags;
    var imports = ["import axios from 'axios'; // npm install axios"], fsNames = [], pre = [], cfg = [];
    var method = req.method, b = req.body;

    function useFs(fn) {
      if (fsNames.indexOf(fn) === -1) fsNames.push(fn);
    }

    if (method !== 'GET') cfg.push(['method', quoteStr(has(STANDARD_METHODS, method) ? method.toLowerCase() : method)]);
    cfg.push(['url', quoteStr(req.url)]);
    var hdrs = req.headers.map(function (h) { return [quoteStr(h.name), quoteStr(h.value)]; });
    if (b && b.kind !== 'multipart' && !findHeader(req.headers, 'content-type')) {
      // axios would label the body application/x-www-form-urlencoded; curl sends no type
      hdrs.push(["'Content-Type'", 'false']);
      notes.add('info', null, "'Content-Type': false stops axios from adding its default Content-Type; curl sends none for this request.");
    }
    if (hdrs.length) cfg.push(['headers', jsObject(hdrs, 1)]);

    if (b && b.kind === 'text') {
      if (b.json && treeSafe(b.json, 'js')) {
        cfg.push(['data', emitValue(b.json, 'js', 1)]);
        jsonRebuiltNote(notes, 'axios serialises the object');
      } else {
        cfg.push(['data', quoteStr(b.text)]);
        if (b.json) notes.add('info', null, 'The JSON body is sent as the original string because it has numbers JavaScript cannot hold exactly, or duplicate keys.');
      }
    } else if (b && b.kind === 'file') {
      useFs('readFileSync');
      cfg.push(['data', b.strip
        ? 'readFileSync(' + quoteStr(b.file) + ", 'utf8').replace(/[\\r\\n]/g, '')"
        : 'readFileSync(' + quoteStr(b.file) + ')']);
    } else if (b && b.kind === 'multipart') {
      pre.push('const form = new FormData();');
      b.parts.forEach(function (p) {
        var field = quoteStr(p.name);
        if (p.kind === 'text') {
          pre.push('form.append(' + field + ', ' + quoteStr(p.value) + ');');
          if (p.type) notes.add('info', p.flag, 'The ;type= of the text field "' + p.name + '" is not reproduced.');
        } else if (p.kind === 'filecontent') {
          useFs('readFileSync');
          pre.push('form.append(' + field + ', readFileSync(' + quoteStr(p.value) + ", 'utf8'));");
        } else {
          useFs('readFileSync');
          var fname = quoteStr(p.filename !== null ? p.filename : basename(p.value));
          pre.push('form.append(' + field + ', new Blob([readFileSync(' + quoteStr(p.value) + ')]' + (p.type ? ', { type: ' + quoteStr(p.type) + ' }' : '') + '), ' + fname + ');');
        }
      });
      cfg.push(['data', 'form']);
    }

    if (req.auth) {
      if (req.auth.type === 'digest') notes.add('unsupported', flags.digest, 'axios has no Digest authentication, so the credentials were left out. Use a Digest auth library, or Python requests (HTTPDigestAuth).');
      else cfg.push(['auth', '{ username: ' + quoteStr(req.auth.user) + ', password: ' + quoteStr(req.auth.password) + ' }']);
    }
    if (req.maxTime !== null) cfg.push(['timeout', msFromSeconds(req.maxTime)]);
    if (req.connectTimeout !== null) notes.add('unsupported', flags['connect-timeout'], 'axios has no separate connect timeout' + (req.maxTime === null ? '. Set timeout for an overall limit.' : '; the -m limit is kept as timeout.'));

    var tls = [];
    if (req.insecure) tls.push('rejectUnauthorized: false');
    if (req.cacert) { useFs('readFileSync'); tls.push('ca: readFileSync(' + quoteStr(req.cacert) + ')'); }
    if (req.cert) { useFs('readFileSync'); tls.push('cert: readFileSync(' + quoteStr(req.cert) + ')'); }
    if (req.key) { useFs('readFileSync'); tls.push('key: readFileSync(' + quoteStr(req.key) + ')'); }
    if (tls.length) {
      imports.push("import https from 'node:https';");
      cfg.push(['httpsAgent', 'new https.Agent({ ' + tls.join(', ') + ' })']);
    }
    if (req.insecure) notes.add('warn', flags.insecure, 'rejectUnauthorized: false turns off certificate checks for this request, as -k does.');

    if (req.proxy) {
      var p = req.proxy;
      if (/^socks/.test(p.scheme)) {
        notes.add('unsupported', p.flag, "axios's proxy option supports HTTP and HTTPS proxies only. For SOCKS, pass an agent from the socks-proxy-agent package as httpAgent and httpsAgent.");
      } else {
        var parts = ['protocol: ' + quoteStr(p.scheme), 'host: ' + quoteStr(p.host.replace(/^\[|\]$/g, '')), 'port: ' + p.port];
        if (p.user !== null) parts.push('auth: { username: ' + quoteStr(p.user) + ', password: ' + quoteStr(p.password) + ' }');
        cfg.push(['proxy', '{ ' + parts.join(', ') + ' }']);
      }
    }
    if (req.output) cfg.push(['responseType', "'arraybuffer'"]);

    var tail = [];
    if (req.include || method === 'HEAD') tail.push('console.log(response.status, response.statusText);', 'console.log(response.headers);');
    if (req.output) {
      useFs('writeFileSync');
      tail.push('writeFileSync(' + quoteStr(req.output) + ', response.data);');
    } else if (!req.discard && method !== 'HEAD') {
      tail.push('console.log(response.data);');
    }

    nonAsciiHeaderNote(notes, req.headers);
    if (!req.fail) notes.add('info', null, 'axios rejects the promise for any status outside 200-299, while curl only fails with -f. Add validateStatus: () => true to always get the response.');
    if (!req.follow) notes.add('info', null, 'axios follows redirects by default, curl only with -L. Add maxRedirects: 0 to stop at a redirect.');

    var head = ['// Node.js 18+. Save as .mjs (or set "type": "module") so top-level await works.'].concat(imports);
    if (fsNames.length) head.push('import { ' + fsNames.join(', ') + " } from 'node:fs';");
    var sections = [head.join('\n')];
    if (pre.length) sections.push(pre.join('\n'));
    sections.push('const response = await axios(' + jsObject(cfg, 0) + ');');
    if (tail.length) sections.push(tail.join('\n'));
    return { code: sections.join('\n\n') + '\n', notes: notes.list };
  }

  // ── Pipeline ────────────────────────────────────────────

  function parseCommand(text, dialectChoice) {
    var notes = createNotes();
    var result = { dialect: null, program: null, args: [], request: null, notes: notes.list, empty: false };
    var src = String(text === null || text === undefined ? '' : text).replace(/\r\n?/g, '\n');
    if (!src.trim()) {
      result.empty = true;
      return result;
    }
    if (src.length > MAX_INPUT) {
      notes.add('error', null, 'The command is longer than 256 KB; paste a shorter one.');
      return result;
    }
    if (src.indexOf(NBSP) !== -1) {
      src = src.split(NBSP).join(' ');
      notes.add('info', null, 'Non-breaking spaces (often added by web pages and chat apps) were read as normal spaces.');
    }
    var prompt = /^\s*(?:(?:PS [^>\n]*>|[A-Za-z]:\\[^>\n]*>)[ \t]*|[$%>][ \t]+)(?=\S)/.exec(src);
    if (prompt) {
      src = src.slice(prompt[0].length);
      notes.add('info', null, 'The shell prompt at the start was removed.');
    }
    var dialect = dialectChoice && dialectChoice !== 'auto' ? dialectChoice : detectDialect(src);
    result.dialect = dialect;
    if (dialect !== 'powershell' && new RegExp('[' + SMART_SINGLE + SMART_DOUBLE + ']').test(src)) {
      notes.add('warn', null, 'Typographic quotes (curly quotes) are not quotes to this shell; they become part of the arguments. Retype them as straight quotes if the command was copied from a web page.');
    }

    var tok = tokenize(src, dialect, notes);
    var found = locateCurl(tok.commands, notes);
    if (!found) return result;
    result.program = found.program;
    result.args = found.args;
    if (dialect === 'powershell') {
      if (!/\.exe$/i.test(found.program)) notes.add('info', found.program, 'In Windows PowerShell 5.1, "curl" is an alias for Invoke-WebRequest, which does not take curl options. Call curl.exe to run the real curl. The command was converted as curl.');
      if (found.args.some(function (a) { return a.indexOf('"') !== -1; })) {
        notes.add('warn', null, 'Windows PowerShell 5.1 and PowerShell 7.2 or older drop embedded double quotes when they pass arguments to curl.exe, so the request curl actually sends may differ from what is shown here. PowerShell 7.3 and newer pass them correctly.');
      }
    }

    var st = parseArgs(found.args, notes);
    st.stdin = found.stdin;
    st.stdinFile = found.stdinFile;
    st.stdout = found.stdout;
    result.request = buildRequest(st, notes);
    return result;
  }

  function generate(req, target) {
    if (target === 'python') return genPython(req);
    if (target === 'node-axios') return genAxios(req);
    return genFetch(req, target === 'node-fetch');
  }

  function sortNotes(list) {
    return list.map(function (n, idx) { return { n: n, idx: idx }; }).sort(function (a, b) {
      return (LEVEL_RANK[a.n.level] - LEVEL_RANK[b.n.level]) || (a.idx - b.idx);
    }).map(function (x) { return x.n; });
  }

  function convert(text, target, dialect) {
    var parsed = parseCommand(text, dialect || 'auto');
    var gen = parsed.request ? generate(parsed.request, target || 'python') : null;
    return {
      parsed: parsed,
      code: gen ? gen.code : '',
      notes: sortNotes(parsed.notes.concat(gen ? gen.notes : []))
    };
  }

  // ── Syntax highlighting ─────────────────────────────────

  var HIGHLIGHT = {
    js: /(\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\[\s\S])*`)|\b(const|let|await|new|import|from|if|throw|for|of|true|false|null)\b|\b(\d+(?:\.\d+)?)\b/g,
    py: /(#[^\n]*)|([bf]?'(?:[^'\\\n]|\\.)*'|[bf]?"(?:[^"\\\n]|\\.)*")|\b(import|from|with|as|for|in|if|True|False|None)\b|\b(\d+(?:\.\d+)?)\b/g
  };

  function highlight(code, lang) {
    var re = HIGHLIGHT[lang] || HIGHLIGHT.js, out = '', last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(code))) {
      out += escapeHtml(code.slice(last, m.index));
      var cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'kw' : 'num';
      out += '<span class="crl-tk-' + cls + '">' + escapeHtml(m[0]) + '</span>';
      last = re.lastIndex;
    }
    return out + escapeHtml(code.slice(last));
  }

  // ── UI state ────────────────────────────────────────────

  var state = { target: 'fetch', nodeFlavor: 'fetch', dialect: 'auto', parsed: null, code: '', timer: null };

  function targetKey() {
    return state.target === 'node' ? 'node-' + state.nodeFlavor : state.target;
  }

  function storageGet(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable (private mode, blocked cookies) */ }
  }

  // ── Clipboard, download, toast ──────────────────────────

  function showToast(text, isError) {
    var toast = $('crl-toast');
    toast.textContent = text;
    toast.classList.toggle('crl-toast--error', !!isError);
    toast.classList.add('crl-show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.classList.remove('crl-show'); }, 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast('Copied to clipboard'); }).catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast('Copied to clipboard');
      } catch (e) {
        showToast('Copy failed. Select the code and copy it manually.', true);
      }
      document.body.removeChild(ta);
    }
  }

  function downloadText(text, filename) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ── Rendering ───────────────────────────────────────────

  function showArg(a) {
    if (a === '') return '(empty)';
    return a.replace(/\n/g, SHOW_NEWLINE).replace(/\t/g, SHOW_TAB);
  }

  function code(s) {
    return '<code class="crl-code">' + escapeHtml(s) + '</code>';
  }

  function row(label, html) {
    return '<div class="crl-kv-row"><dt class="crl-kv-key">' + label + '</dt><dd class="crl-kv-val">' + html + '</dd></div>';
  }

  function list(items) {
    return '<ul class="crl-kv-list">' + items.map(function (x) { return '<li class="crl-kv-item">' + x + '</li>'; }).join('') + '</ul>';
  }

  function describeBody(b) {
    if (b.kind === 'multipart') {
      return '<span class="crl-tag">multipart/form-data</span>' + list(b.parts.map(function (p) {
        if (p.kind === 'text') return code(p.name) + ' = ' + code(truncate(p.value, 120));
        var what = p.kind === 'file' ? 'file ' : 'contents of ';
        var extra = (p.filename !== null ? ' as ' + code(p.filename) : '') + (p.type ? ' ' + code(p.type) : '');
        return code(p.name) + ' = ' + what + code(p.value) + extra;
      }));
    }
    if (b.kind === 'file') {
      return (b.upload ? 'Upload of ' : 'Contents of ') + code(b.file) + (b.strip ? ' <span class="crl-tag">line breaks removed, as -d does</span>' : '');
    }
    var label = b.json ? 'JSON' : b.form ? 'form fields' : b.upload ? 'upload from stdin' : 'text';
    var bytes = utf8Bytes(b.text).length;
    return '<span class="crl-tag">' + label + '</span> <span class="crl-muted">' + bytes + ' bytes</span>' +
      '<pre class="crl-body-pre">' + escapeHtml(truncate(b.text, 800)) + '</pre>';
  }

  function renderSummary(res) {
    var el = $('crl-summary');
    var req = res && res.request;
    if (!req) {
      el.innerHTML = '<p class="crl-empty">' + (res && res.empty ? 'Paste a curl command to see how it is read.' : 'The command could not be converted; see the notes.') + '</p>';
      return;
    }
    var rows = [];
    rows.push(row('Method', '<span class="crl-method">' + escapeHtml(req.method) + '</span>'));
    rows.push(row('URL', code(req.url)));
    if (req.queryPairs.length) {
      rows.push(row('Query', list(req.queryPairs.map(function (p) {
        return code(percentDecode(p.rawName, true)) + (p.rawValue === null ? '' : ' = ' + code(percentDecode(p.rawValue, true)));
      }))));
    }
    if (req.headers.length) {
      rows.push(row('Headers', list(req.headers.map(function (h) {
        var tag = h.implicit ? ' <span class="crl-tag">added by curl</span>' : h.source === 'option' && h.flag ? ' <span class="crl-tag">' + escapeHtml(h.flag) + '</span>' : '';
        return code(h.name + ': ' + h.value) + tag;
      }))));
    }
    if (req.auth) {
      rows.push(row('Auth', (req.auth.type === 'digest' ? 'Digest' : 'Basic') + ', user ' + code(req.auth.user) + ', password ' +
        (req.auth.password ? code(repeat(String.fromCharCode(0x2022), Math.min(req.auth.password.length, 10))) : '(empty)')));
    }
    if (req.body) rows.push(row('Body', describeBody(req.body)));
    var opts = [];
    if (req.follow) opts.push('follow redirects');
    if (req.insecure) opts.push('no TLS verification');
    if (req.maxTime !== null) opts.push('timeout ' + req.maxTime + ' s');
    if (req.connectTimeout !== null) opts.push('connect timeout ' + req.connectTimeout + ' s');
    if (req.proxy) opts.push('proxy ' + req.proxy.scheme + '://' + req.proxy.host + ':' + req.proxy.port);
    if (req.cert) opts.push('client cert ' + req.cert);
    if (req.cacert) opts.push('CA ' + req.cacert);
    if (req.fail) opts.push('fail on HTTP errors');
    if (req.include) opts.push('print headers');
    if (req.output) opts.push('save to ' + req.output);
    if (req.discard) opts.push('discard output');
    if (opts.length) {
      rows.push(row('Options', '<div class="crl-chips">' + opts.map(function (o) { return '<span class="crl-chip">' + escapeHtml(o) + '</span>'; }).join('') + '</div>'));
    }
    el.innerHTML = '<dl class="crl-kv">' + rows.join('') + '</dl>';
  }

  function renderArgs(res) {
    var args = res && res.program ? [res.program].concat(res.args) : [];
    $('crl-args-count').textContent = args.length ? '(' + args.length + ')' : '';
    $('crl-args').innerHTML = args.map(function (a) {
      return '<li class="crl-arg"><code class="crl-code">' + escapeHtml(showArg(a)) + '</code></li>';
    }).join('');
    $('crl-args-box').classList.toggle('crl-hidden', !args.length);
  }

  function renderStatus(res) {
    var el = $('crl-status');
    if (!res || res.empty) {
      el.textContent = 'Waiting for a command.';
      return;
    }
    var parts = [];
    if (res.dialect) parts.push('Read as ' + DIALECT_LABEL[res.dialect] + (state.dialect === 'auto' ? ' (detected)' : ''));
    if (res.program) parts.push(res.args.length + ' argument' + (res.args.length === 1 ? '' : 's') + ' after curl');
    el.textContent = parts.join(' · ') || 'Could not read the command.';
  }

  function renderNotes(notes) {
    var counts = { error: 0, unsupported: 0, warn: 0, info: 0 };
    notes.forEach(function (n) { counts[n.level]++; });
    $('crl-note-counts').innerHTML = ['error', 'unsupported', 'warn', 'info'].filter(function (l) { return counts[l]; }).map(function (l) {
      return '<span class="crl-chip crl-chip--' + l + '">' + counts[l] + ' ' + COUNT_LABEL[l][counts[l] === 1 ? 0 : 1] + '</span>';
    }).join('');
    var listEl = $('crl-notes');
    if (!notes.length) {
      listEl.innerHTML = state.parsed && !state.parsed.empty
        ? '<li class="crl-msg crl-msg--ok"><div class="crl-msg-text">&#10003; Everything in the command was translated.</div></li>'
        : '';
      return;
    }
    listEl.innerHTML = notes.map(function (n) {
      return '<li class="crl-msg crl-msg--' + n.level + '">' +
        '<div class="crl-msg-head"><span class="crl-msg-level">' + LEVEL_LABEL[n.level] + '</span>' +
        (n.flag ? '<code class="crl-msg-flag">' + escapeHtml(n.flag) + '</code>' : '') + '</div>' +
        '<div class="crl-msg-text">' + escapeHtml(n.text) + '</div></li>';
    }).join('');
  }

  function renderOutput() {
    var res = state.parsed, key = targetKey();
    var gen = res && res.request ? generate(res.request, key) : null;
    state.code = gen ? gen.code : '';
    $('crl-output').innerHTML = gen
      ? highlight(gen.code, TARGETS[key].lang)
      : '<span class="crl-tk-com">' + (res && !res.empty ? '// Nothing to generate yet. See the notes below.' : '// Paste a curl command on the left.') + '</span>';
    $('crl-output-label').textContent = TARGETS[key].label;
    $('crl-copy').disabled = !gen;
    $('crl-download').disabled = !gen;
    $('crl-download').textContent = 'Download ' + TARGETS[key].file;
    renderNotes(sortNotes((res ? res.notes : []).concat(gen ? gen.notes : [])));
  }

  function renderTabs() {
    ['fetch', 'python', 'node'].forEach(function (t) {
      var btn = $('crl-tab-' + t), active = state.target === t;
      btn.classList.toggle('crl-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    $('crl-node-flavor').classList.toggle('crl-hidden', state.target !== 'node');
    ['fetch', 'axios'].forEach(function (f) {
      var btn = $('crl-flavor-' + f), active = state.nodeFlavor === f;
      btn.classList.toggle('crl-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function update() {
    state.parsed = parseCommand($('crl-input').value, state.dialect);
    renderStatus(state.parsed);
    renderSummary(state.parsed);
    renderArgs(state.parsed);
    renderOutput();
  }

  function scheduleUpdate() {
    clearTimeout(state.timer);
    state.timer = setTimeout(update, 150);
  }

  // ── Actions ─────────────────────────────────────────────

  function setTarget(t) {
    if (t !== 'fetch' && t !== 'python' && t !== 'node') return;
    state.target = t;
    storageSet('crl-target', t);
    renderTabs();
    renderOutput();
  }

  function setNodeFlavor(f) {
    if (f !== 'fetch' && f !== 'axios') return;
    state.nodeFlavor = f;
    storageSet('crl-node', f);
    renderTabs();
    renderOutput();
  }

  function loadSample(key) {
    if (!has(SAMPLES, key)) return;
    $('crl-input').value = SAMPLES[key];
    update();
  }

  function clearInput() {
    $('crl-input').value = '';
    update();
    $('crl-input').focus();
  }

  function init() {
    var hash = (location.hash || '').replace(/^#/, '');
    var savedTarget = storageGet('crl-target'), savedNode = storageGet('crl-node');
    if (hash === 'python' || hash === 'fetch') state.target = hash;
    else if (hash === 'node-fetch' || hash === 'node-axios') {
      state.target = 'node';
      state.nodeFlavor = hash.slice(5);
    } else if (savedTarget === 'fetch' || savedTarget === 'python' || savedTarget === 'node') {
      state.target = savedTarget;
    }
    if (hash.indexOf('node-') !== 0 && (savedNode === 'fetch' || savedNode === 'axios')) state.nodeFlavor = savedNode;

    $('crl-input').addEventListener('input', scheduleUpdate);
    $('crl-dialect').addEventListener('change', function () {
      state.dialect = $('crl-dialect').value;
      update();
    });

    // Arrow keys move between the target tabs
    $('crl-tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var order = ['fetch', 'python', 'node'];
      var idx = order.indexOf(state.target) + (e.key === 'ArrowRight' ? 1 : -1);
      var next = order[(idx + order.length) % order.length];
      setTarget(next);
      $('crl-tab-' + next).focus();
      e.preventDefault();
    });

    renderTabs();
    if (!$('crl-input').value.trim()) $('crl-input').value = SAMPLES.json;
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Expose global handlers for onclick attributes
  window.crlSetTarget = setTarget;
  window.crlSetNode = setNodeFlavor;
  window.crlSample = loadSample;
  window.crlClear = clearInput;
  window.crlCopy = function () { if (state.code) copyText(state.code); };
  window.crlDownload = function () { if (state.code) downloadText(state.code, TARGETS[targetKey()].file); };

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseCommand: parseCommand,
      convert: convert,
      generate: generate,
      detectDialect: detectDialect,
      splitMsvcrt: splitMsvcrt,
      splitArgs: function (src, dialect) {
        var notes = createNotes();
        var tok = tokenize(String(src).replace(/\r\n?/g, '\n'), dialect || 'posix', notes);
        return { commands: tok.commands, args: tok.commands[0].args, notes: notes.list };
      },
      curlEscape: curlEscape,
      formEscape: formEscape,
      percentDecode: percentDecode,
      base64: base64,
      parseJsonTree: parseJsonTree,
      treeSafe: treeSafe,
      emitValue: emitValue,
      quoteStr: quoteStr,
      pairsRoundTrip: pairsRoundTrip,
      highlight: highlight,
      SAMPLES: SAMPLES
    };
  }

})();
