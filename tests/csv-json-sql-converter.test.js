// tests/csv-json-sql-converter.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./_setup');

const cjs = loadScript('csv-json-sql-converter/script.js');

const OPTS = {
  format: 'auto', delimiter: 'auto', header: 'auto',
  trim: true, inferTypes: true, emptyAsNull: true, flatten: true
};

function build(text, overrides) {
  return cjs.buildTable(text, Object.assign({}, OPTS, overrides));
}

function levels(messages) {
  return messages.map((m) => m.level);
}

function texts(messages) {
  return messages.map((m) => m.text).join('\n');
}

// ── parseCsv ─────────────────────────────────────────────

test('csv: parseCsv splits simple rows', () => {
  const r = cjs.parseCsv('a,b,c\n1,2,3', ',');
  assert.deepEqual(r.rows, [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(r.lines, [1, 2]);
});

test('csv: parseCsv handles quoted delimiters, doubled quotes and embedded newlines', () => {
  const r = cjs.parseCsv('name,note\n"Doe, Jane","She said ""hi""\nthen left"\nBob,x', ',');
  assert.deepEqual(r.rows, [
    ['name', 'note'],
    ['Doe, Jane', 'She said "hi"\nthen left'],
    ['Bob', 'x']
  ]);
  assert.deepEqual(r.lines, [1, 2, 4]);
});

test('csv: parseCsv accepts CRLF, lone CR and a trailing newline', () => {
  assert.deepEqual(cjs.parseCsv('a,b\r\n1,2\r\n', ',').rows, [['a', 'b'], ['1', '2']]);
  assert.deepEqual(cjs.parseCsv('a,b\r1,2', ',').rows, [['a', 'b'], ['1', '2']]);
});

test('csv: parseCsv strips a UTF-8 BOM', () => {
  const r = cjs.parseCsv(String.fromCharCode(0xFEFF) + 'id,name\n1,x', ',');
  assert.equal(r.rows[0][0], 'id');
});

test('csv: parseCsv skips blank lines but keeps rows of empty fields', () => {
  const r = cjs.parseCsv('a,b\n\n   \n1,2\n,\n', ',');
  assert.deepEqual(r.rows, [['a', 'b'], ['1', '2'], ['', '']]);
  assert.deepEqual(r.lines, [1, 4, 5]);
});

test('csv: parseCsv keeps a trailing delimiter as an empty field', () => {
  assert.deepEqual(cjs.parseCsv('a,b,', ',').rows, [['a', 'b', '']]);
});

test('csv: parseCsv keeps a quoted empty single field', () => {
  assert.deepEqual(cjs.parseCsv('v\n""\nx', ',').rows, [['v'], [''], ['x']]);
});

test('csv: parseCsv tolerates spaces before an opening quote', () => {
  assert.deepEqual(cjs.parseCsv('a, "b, c"', ',').rows, [['a', 'b, c']]);
});

test('csv: parseCsv reports an unclosed quote with its starting line', () => {
  const r = cjs.parseCsv('a,b\n1,"open\n2,3', ',');
  assert.equal(r.unclosedLine, 2);
});

test('csv: parseCsv flags stray quotes and text after a closing quote', () => {
  const r = cjs.parseCsv('size,label\n5" screen,x\n"a"b,y', ',');
  assert.deepEqual(r.rows[1], ['5" screen', 'x']);
  assert.deepEqual(r.rows[2], ['ab', 'y']);
  assert.deepEqual(r.strayQuoteLines, [2]);
  assert.deepEqual(r.afterQuoteLines, [3]);
});

// ── detectDelimiter ──────────────────────────────────────

test('csv: detectDelimiter finds comma, semicolon, tab and pipe', () => {
  assert.equal(cjs.detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(cjs.detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(cjs.detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(cjs.detectDelimiter('a|b\n1|2'), '|');
});

test('csv: detectDelimiter prefers semicolon over decimal commas', () => {
  assert.equal(cjs.detectDelimiter('name;price\nTea;3,50\nCoffee;4,20'), ';');
});

test('csv: detectDelimiter ignores delimiters inside quotes', () => {
  assert.equal(cjs.detectDelimiter('name;city\n"Doe, Jane";Berlin\n"Roe, Rick";Paris'), ';');
});

test('csv: detectDelimiter returns null for single-column text', () => {
  assert.equal(cjs.detectDelimiter('value\none\ntwo'), null);
});

// ── detectHeader ─────────────────────────────────────────

test('csv: detectHeader spots a text header above numbers', () => {
  assert.equal(cjs.detectHeader([['id', 'score'], ['1', '9.5'], ['2', '7']]), true);
});

test('csv: detectHeader accepts year columns as header labels', () => {
  assert.equal(cjs.detectHeader([['region', '2024', '2025'], ['EU', '100', '200'], ['US', '150', '250']]), true);
});

test('csv: detectHeader rejects an all-numeric first row', () => {
  assert.equal(cjs.detectHeader([['1', '2', '3'], ['4', '5', '6']]), false);
  assert.equal(cjs.detectHeader([['Alice', '30'], ['Bob', '25'], ['Carl', '41']]), false);
});

test('csv: detectHeader rejects a first row that matches fixed-width codes', () => {
  assert.equal(cjs.detectHeader([['AB', 'CD'], ['EF', 'GH'], ['IJ', 'KL']]), false);
});

test('csv: detectHeader falls back to distinct text labels', () => {
  assert.equal(cjs.detectHeader([['name', 'city'], ['Alice', 'Paris'], ['Bob', 'Berlin']]), true);
  assert.equal(cjs.detectHeader([['only one row']]), false);
});

// ── type inference ───────────────────────────────────────

test('csv: parseNumber keeps leading zeros, big integers and long decimals as text', () => {
  assert.equal(cjs.parseNumber('42'), 42);
  assert.equal(cjs.parseNumber('-3.25'), -3.25);
  assert.equal(cjs.parseNumber('1e3'), 1000);
  assert.equal(cjs.parseNumber('007'), null);
  assert.equal(cjs.parseNumber('+5'), null);
  assert.equal(cjs.parseNumber('3,50'), null);
  assert.equal(cjs.parseNumber('1,000'), null);
  assert.equal(cjs.parseNumber('9007199254740991'), 9007199254740991);
  assert.equal(cjs.parseNumber('9007199254740993'), null);
  assert.equal(cjs.parseNumber('0.1234567890123456789'), null);
});

test('csv: parseBoolean is case-insensitive true/false only', () => {
  assert.equal(cjs.parseBoolean('TRUE'), true);
  assert.equal(cjs.parseBoolean('false'), false);
  assert.equal(cjs.parseBoolean('yes'), null);
});

test('csv: csvColumnType picks one type per column', () => {
  const rows = [['1', 'true', '10115', 'x'], ['2', 'FALSE', 'D02 X285', ''], ['', 'true', '01100', 'y']];
  assert.equal(cjs.csvColumnType(rows, 0), 'number');
  assert.equal(cjs.csvColumnType(rows, 1), 'boolean');
  assert.equal(cjs.csvColumnType(rows, 2), 'text');
  assert.equal(cjs.csvColumnType(rows, 3), 'text');
  assert.equal(cjs.csvColumnType([[''], ['']], 0), 'text');
});

// ── tableFromCsv via buildTable ──────────────────────────

test('csv: buildTable converts the CSV sample to typed rows', () => {
  const r = build(cjs.SAMPLES.csv);
  assert.equal(r.format, 'csv');
  assert.equal(r.meta.delimiter, ',');
  assert.equal(r.meta.header, true);
  assert.deepEqual(r.table.columns, ['id', 'name', 'email', 'city', 'zip', 'active', 'signup_date', 'notes']);
  assert.equal(r.table.rows.length, 5);
  assert.deepEqual(r.table.rows[0], [1, 'Alice Johnson', 'alice@example.com', 'Berlin', '10115', true, '2026-01-14', null]);
  assert.equal(r.table.rows[1][1], "O'Brien, Liam");
  assert.equal(r.table.rows[2][7], 'Two-line note:\ncall before noon');
  assert.equal(r.table.rows[4][4], '01100');
  assert.deepEqual(r.messages, []);
});

test('csv: buildTable honours explicit delimiter, header and type options', () => {
  const r = build('1;2\n3;4', { delimiter: ';', header: 'yes', inferTypes: false, emptyAsNull: false });
  assert.deepEqual(r.table.columns, ['1', '2']);
  assert.deepEqual(r.table.rows, [['3', '4']]);

  const n = build('a,b\n1,', { header: 'no', emptyAsNull: false });
  assert.deepEqual(n.table.columns, ['column_1', 'column_2']);
  assert.deepEqual(n.table.rows, [['a', 'b'], ['1', '']]);
});

test('csv: buildTable trims only when asked', () => {
  assert.deepEqual(build('a,b\n x , y ').table.rows, [['x', 'y']]);
  assert.deepEqual(build('a,b\n x , y ', { trim: false }).table.rows, [[' x ', ' y ']]);
});

test('csv: buildTable renames empty and duplicate headers with warnings', () => {
  const r = build('id,,name,name\n1,2,x,y');
  assert.deepEqual(r.table.columns, ['id', 'column_2', 'name', 'name_2']);
  assert.deepEqual(levels(r.messages), ['warn', 'warn']);
  assert.match(texts(r.messages), /column_2/);
  assert.match(texts(r.messages), /name → name_2/);
});

test('csv: buildTable pads short rows and keeps extra values in new columns', () => {
  const r = build('a,b,c\n1,2\n3,4,5,6\n7,8,9,');
  assert.deepEqual(r.table.columns, ['a', 'b', 'c', 'column_4']);
  assert.deepEqual(r.table.rows, [[1, 2, null, null], [3, 4, 5, 6], [7, 8, 9, null]]);
  const all = texts(r.messages);
  assert.match(all, /1 row has fewer fields than the header \(3\) — line 2/);
  assert.match(all, /2 rows have more fields than the header \(3\) — lines 3, 4/);
  assert.match(all, /new column: column_4/);
  assert.doesNotMatch(all, /Empty header/);
});

test('csv: buildTable ignores trailing empty fields quietly', () => {
  const r = build('a,b\n1,2,\n3,4,');
  assert.deepEqual(r.table.columns, ['a', 'b']);
  assert.deepEqual(levels(r.messages), ['info']);
});

test('csv: buildTable stops on an unclosed quote', () => {
  const r = build('a,b\n1,"oops\n2,3');
  assert.equal(r.table, null);
  assert.deepEqual(levels(r.messages), ['error']);
  assert.match(r.messages[0].text, /line 2/);
});

test('csv: buildTable lists many problem lines compactly', () => {
  const rows = ['a,b,c'];
  for (let i = 0; i < 9; i++) rows.push('1,2');
  const r = build(rows.join('\n'));
  assert.match(r.messages[0].text, /lines 2, 3, 4, 5, 6 and 4 more/);
});

test('csv: buildTable warns about replacement characters', () => {
  const r = build('name\nCaf' + String.fromCharCode(0xFFFD));
  assert.ok(r.messages.some((m) => m.level === 'warn' && /Windows-1252/.test(m.text)));
});

test('csv: header-only input gives columns and no rows', () => {
  const r = build('id,name', { header: 'yes' });
  assert.deepEqual(r.table.columns, ['id', 'name']);
  assert.equal(r.table.rows.length, 0);
});

// ── JSON input ───────────────────────────────────────────

test('json: detectFormat looks at the first non-space character', () => {
  assert.equal(cjs.detectFormat('  [1]'), 'json');
  assert.equal(cjs.detectFormat('\n{"a":1}'), 'json');
  assert.equal(cjs.detectFormat('a,b'), 'csv');
});

test('json: parseJsonText reads JSON Lines', () => {
  const r = cjs.parseJsonText('{"a":1}\n\n{"a":2}\n');
  assert.equal(r.jsonLines, true);
  assert.deepEqual(r.value, [{ a: 1 }, { a: 2 }]);
});

test('json: parseJsonText reports the failing JSON Lines line', () => {
  const r = cjs.parseJsonText('{"a":1}\n{"a":2}\n{"a":');
  assert.equal(r.error.line, 3);
});

test('json: jsonErrorInfo converts positions to line and column', () => {
  const info = cjs.jsonErrorInfo(new Error('Unexpected token } in JSON at position 12'), '{\n  "a": 1,\n}');
  assert.equal(info.line, 3);
  assert.equal(info.column, 1);
  assert.equal(info.message, 'Unexpected token }');

  const ff = cjs.jsonErrorInfo(new Error('JSON.parse: expected property name at line 3 column 1 of the JSON data'), '');
  assert.deepEqual([ff.line, ff.column, ff.message], [3, 1, 'expected property name']);
});

test('json: invalid JSON produces an error with a location', () => {
  const r = build('[\n  {"a": 1},\n  {"a": 2,}\n]');
  assert.equal(r.table, null);
  assert.equal(r.messages[0].level, 'error');
  assert.match(r.messages[0].text, /^Invalid JSON \(line 3/);
});

test('json: array of objects unions keys in first-seen order and fills gaps with null', () => {
  const r = build('[{"a":1,"b":2},{"b":3,"c":"x"}]');
  assert.deepEqual(r.table.columns, ['a', 'b', 'c']);
  assert.deepEqual(r.table.rows, [[1, 2, null], [null, 3, 'x']]);
  assert.match(texts(r.messages), /2 records of 2 are missing some keys/);
});

test('json: nested objects are flattened; arrays stay values', () => {
  const r = build(cjs.SAMPLES.json);
  assert.deepEqual(r.table.columns, ['sku', 'product', 'price', 'in_stock', 'tags', 'size.w', 'size.h', 'discontinued']);
  assert.deepEqual(r.table.rows[0].slice(4, 7), [['peripherals', 'usb-c'], 44, 3.5]);
});

test('json: flattening can be switched off', () => {
  const r = build('[{"a":{"b":1}}]', { flatten: false });
  assert.deepEqual(r.table.columns, ['a']);
  assert.deepEqual(r.table.rows, [[{ b: 1 }]]);
});

test('json: a null parent does not leave an extra column next to its children', () => {
  const r = build('[{"a":{"b":1}},{"a":null}]');
  assert.deepEqual(r.table.columns, ['a.b']);
  assert.deepEqual(r.table.rows, [[1], [null]]);
});

test('json: flattenObject keeps empty objects and arrays', () => {
  const f = cjs.flattenObject({ a: { b: { c: 1 } }, e: {}, l: [1] });
  assert.deepEqual(Object.assign({}, f.record), { 'a.b.c': 1, e: {}, l: [1] });
  assert.equal(f.nested, true);
});

test('json: an API wrapper object uses its first array of objects', () => {
  const r = build('{"meta":{"page":1},"data":[{"id":1},{"id":2}]}');
  assert.equal(r.meta.path, 'data');
  assert.deepEqual(r.table.rows, [[1], [2]]);
});

test('json: a single object becomes one row', () => {
  const r = build('{"id":7,"name":"x"}');
  assert.equal(r.meta.shape, 'object');
  assert.deepEqual(r.table.rows, [[7, 'x']]);
});

test('json: array of arrays detects the header row', () => {
  const r = build('[["id","name"],[1,"a"],[2,"b"]]');
  assert.equal(r.meta.header, true);
  assert.deepEqual(r.table.columns, ['id', 'name']);
  assert.deepEqual(r.table.rows, [[1, 'a'], [2, 'b']]);

  const n = build('[[1,2],[3,4]]');
  assert.equal(n.meta.header, false);
  assert.deepEqual(n.table.columns, ['column_1', 'column_2']);
});

test('json: array of plain values becomes a single "value" column', () => {
  const r = build('[1,"two",null]');
  assert.deepEqual(r.table.columns, ['value']);
  assert.deepEqual(r.table.rows, [[1], ['two'], [null]]);
});

test('json: mixed arrays and bare primitives are errors', () => {
  const mixed = build('[1, {"a":1}]');
  assert.equal(mixed.table, null);
  assert.match(mixed.messages[0].text, /element \[0\] is a plain value but element \[1\] is an object/);

  const prim = build('"just text"', { format: 'json' });
  assert.equal(prim.table, null);
  assert.match(prim.messages[0].text, /single string/);
});

test('json: null elements in an array of objects are skipped with a warning', () => {
  const r = build('[{"a":1},null,{"a":2}]');
  assert.equal(r.table.rows.length, 2);
  assert.ok(r.messages.some((m) => m.level === 'warn' && /index 1/.test(m.text)));
});

test('json: integers beyond 2^53 trigger a precision warning', () => {
  const r = build('[{"id":12345678901234567890}]');
  assert.ok(r.messages.some((m) => m.level === 'warn' && /id/.test(m.text)));
});

test('json: an empty array converts to an empty table', () => {
  const r = build('[]');
  assert.deepEqual(r.table, { columns: [], rows: [] });
});

// ── JSON output ──────────────────────────────────────────

const TABLE = { columns: ['id', 'name', 'ok'], rows: [[1, 'Ann', true], [2, null, false]] };

test('out: toJson writes array of objects with the chosen indent', () => {
  assert.equal(cjs.toJson(TABLE, { shape: 'objects', indent: '0' }),
    '[{"id":1,"name":"Ann","ok":true},{"id":2,"name":null,"ok":false}]');
  assert.match(cjs.toJson(TABLE, { shape: 'objects', indent: '2' }), /^\[\n {2}\{\n {4}"id": 1,/);
  assert.match(cjs.toJson(TABLE, { shape: 'objects', indent: 'tab' }), /^\[\n\t\{\n\t\t"id": 1,/);
});

test('out: toJson writes arrays one row per line and JSON Lines', () => {
  assert.equal(cjs.toJson(TABLE, { shape: 'arrays', indent: '2' }),
    '[\n  ["id","name","ok"],\n  [1,"Ann",true],\n  [2,null,false]\n]');
  assert.equal(cjs.toJson(TABLE, { shape: 'jsonl' }),
    '{"id":1,"name":"Ann","ok":true}\n{"id":2,"name":null,"ok":false}');
});

test('out: toJson keeps a "__proto__" column as a normal key', () => {
  const out = cjs.toJson({ columns: ['__proto__'], rows: [['x']] }, { indent: '0' });
  assert.equal(out, '[{"__proto__":"x"}]');
});

// ── CSV output ───────────────────────────────────────────

test('out: toCsv quotes only when needed', () => {
  const t = { columns: ['a', 'b'], rows: [['x,y', 'say "hi"'], ['line\nbreak', ' pad'], [null, { k: 1 }]] };
  assert.equal(cjs.toCsv(t, {}),
    'a,b\n"x,y","say ""hi"""\n"line\nbreak"," pad"\n,"{""k"":1}"');
});

test('out: toCsv supports delimiter, quote-all, CRLF and no header', () => {
  assert.equal(cjs.toCsv(TABLE, { delimiter: ';', eol: 'crlf' }), 'id;name;ok\r\n1;Ann;true\r\n2;;false');
  assert.equal(cjs.toCsv(TABLE, { quoteAll: true, header: false }), '"1","Ann","true"\n"2","","false"');
  assert.equal(cjs.toCsv(TABLE, { delimiter: '\t' }).split('\n')[1], '1\tAnn\ttrue');
});

test('out: toCsv keeps empty single-column rows from vanishing', () => {
  const csv = cjs.toCsv({ columns: ['v'], rows: [['a'], [null], ['b']] }, {});
  assert.equal(csv, 'v\na\n""\nb');
  assert.equal(cjs.parseCsv(csv, ',').rows.length, 4);
});

test('out: CSV → JSON → CSV round-trips the sample', () => {
  const first = build(cjs.SAMPLES.csv, { inferTypes: false, emptyAsNull: false });
  const csv = cjs.toCsv(first.table, {});
  const again = build(csv, { inferTypes: false, emptyAsNull: false });
  assert.deepEqual(again.table, first.table);
});

// ── SQL output ───────────────────────────────────────────

const D = cjs.SQL_DIALECTS;

test('sql: sqlLiteral handles NULL, booleans, numbers and quotes per dialect', () => {
  assert.equal(cjs.sqlLiteral(null, D.postgres), 'NULL');
  assert.equal(cjs.sqlLiteral(true, D.postgres), 'TRUE');
  assert.equal(cjs.sqlLiteral(false, D.mssql), '0');
  assert.equal(cjs.sqlLiteral(true, D.sqlite), '1');
  assert.equal(cjs.sqlLiteral(-1.5, D.mysql), '-1.5');
  assert.equal(cjs.sqlLiteral("O'Brien", D.postgres), "'O''Brien'");
  assert.equal(cjs.sqlLiteral({ a: "it's" }, D.sqlite), '\'{"a":"it\'\'s"}\'');
});

test('sql: sqlLiteral escapes backslashes only for MySQL', () => {
  assert.equal(cjs.sqlLiteral('C:\\temp', D.postgres), "'C:\\temp'");
  assert.equal(cjs.sqlLiteral('C:\\temp', D.mysql), "'C:\\\\temp'");
  assert.equal(cjs.sqlLiteral('a' + String.fromCharCode(0) + 'b', D.mysql), "'a\\0b'");
});

test('sql: sqlLiteral adds N to non-ASCII SQL Server strings', () => {
  assert.equal(cjs.sqlLiteral('Kyiv', D.mssql), "'Kyiv'");
  assert.equal(cjs.sqlLiteral('Київ', D.mssql), "N'Київ'");
  assert.equal(cjs.sqlLiteral('Київ', D.postgres), "'Київ'");
});

test('sql: quoteIdent quotes per dialect and escapes the closing quote', () => {
  assert.equal(cjs.quoteIdent('my "col"', D.postgres, 'always'), '"my ""col"""');
  assert.equal(cjs.quoteIdent('a`b', D.mysql, 'always'), '`a``b`');
  assert.equal(cjs.quoteIdent('a]b', D.mssql, 'always'), '[a]]b]');
});

test('sql: quoteIdent "needed" mode leaves plain names bare', () => {
  assert.equal(cjs.quoteIdent('user_id', D.mysql, 'needed'), 'user_id');
  assert.equal(cjs.quoteIdent('order', D.mysql, 'needed'), '`order`');
  assert.equal(cjs.quoteIdent('first name', D.mssql, 'needed'), '[first name]');
  assert.equal(cjs.quoteIdent('UserId', D.postgres, 'needed'), '"UserId"');
  assert.equal(cjs.quoteIdent('UserId', D.sqlite, 'needed'), 'UserId');
});

test('sql: toSql batches multi-row INSERT statements', () => {
  const t = { columns: ['id', 'name'], rows: [[1, 'a'], [2, 'b'], [3, "c'd"]] };
  const r = cjs.toSql(t, { dialect: 'postgres', table: 'users', batch: '2' });
  assert.equal(r.sql,
    'INSERT INTO "users" ("id", "name") VALUES\n  (1, \'a\'),\n  (2, \'b\');\n\n' +
    'INSERT INTO "users" ("id", "name") VALUES\n  (3, \'c\'\'d\');');
  assert.deepEqual(r.messages, []);
});

test('sql: toSql writes one line per row with batch size 1', () => {
  const t = { columns: ['id'], rows: [[1], [2]] };
  assert.equal(cjs.toSql(t, { dialect: 'sqlite', table: 't', batch: '1' }).sql,
    'INSERT INTO "t" ("id") VALUES (1);\nINSERT INTO "t" ("id") VALUES (2);');
});

test('sql: toSql adds CREATE TABLE and a transaction', () => {
  const t = { columns: ['id', 'ok', 'day'], rows: [[1, true, '2026-10-03']] };
  const r = cjs.toSql(t, { dialect: 'mysql', table: 'app.events', batch: '0', createTable: true, transaction: true });
  assert.equal(r.sql,
    'START TRANSACTION;\n\n' +
    'CREATE TABLE `app`.`events` (\n  `id` INT,\n  `ok` BOOLEAN,\n  `day` DATE\n);\n\n' +
    'INSERT INTO `app`.`events` (`id`, `ok`, `day`) VALUES (1, TRUE, \'2026-10-03\');\n\n' +
    'COMMIT;');
});

test('sql: toSql caps SQL Server batches at 1000 rows', () => {
  const rows = [];
  for (let i = 0; i < 1500; i++) rows.push([i]);
  const r = cjs.toSql({ columns: ['n'], rows }, { dialect: 'mssql', table: 't', batch: '0' });
  assert.equal((r.sql.match(/INSERT INTO/g) || []).length, 2);
  assert.equal(r.messages[0].level, 'info');

  const small = cjs.toSql({ columns: ['n'], rows: rows.slice(0, 10) }, { dialect: 'mssql', table: 't', batch: '0' });
  assert.equal((small.sql.match(/INSERT INTO/g) || []).length, 1);
  assert.deepEqual(small.messages, []);
});

test('sql: toSql validates the table name', () => {
  const t = { columns: ['id'], rows: [[1]] };
  assert.equal(cjs.toSql(t, { table: '  ' }).messages[0].level, 'error');
  assert.match(cjs.toSql(t, { table: 'a..b' }).messages[0].text, /empty part/);
});

test('sql: toSql warns about identifiers over the dialect limit', () => {
  const long = 'x'.repeat(70);
  const r = cjs.toSql({ columns: [long], rows: [[1]] }, { dialect: 'postgres', table: 't' });
  assert.equal(r.messages[0].level, 'warn');
  assert.match(r.messages[0].text, /63 bytes/);
  assert.deepEqual(cjs.toSql({ columns: [long], rows: [[1]] }, { dialect: 'sqlite', table: 't' }).messages, []);
});

test('sql: toSql with no rows returns only the CREATE TABLE when asked', () => {
  const t = { columns: ['id'], rows: [] };
  assert.equal(cjs.toSql(t, { table: 't' }).sql, '');
  assert.equal(cjs.toSql(t, { table: 't', createTable: true }).sql, 'CREATE TABLE "t" (\n  "id" TEXT\n);');
});

// ── Column types ─────────────────────────────────────────

test('sql: columnKind infers kinds and merges numeric widths', () => {
  const rows = [[1, 2.5, true, 'x', '2026-10-03', '2026-10-03 09:00:00', [1], null, 3000000000]];
  const kinds = rows[0].map((_, c) => cjs.columnKind(rows, c).kind);
  assert.deepEqual(kinds, ['integer', 'decimal', 'boolean', 'text', 'date', 'datetime', 'json', 'empty', 'bigint']);
  assert.equal(cjs.columnKind([[1], [2.5]], 0).kind, 'decimal');
  assert.equal(cjs.columnKind([[1], ['a']], 0).kind, 'text');
  assert.equal(cjs.columnKind([['2026-10-03'], ['2026-10-03T09:00']], 0).kind, 'datetime');
  assert.equal(cjs.columnKind([['2026-13-01']], 0).kind, 'text');
});

test('sql: sqlType maps kinds to dialect types', () => {
  assert.equal(cjs.sqlType({ kind: 'json', maxLen: 10 }, 'postgres'), 'JSONB');
  assert.equal(cjs.sqlType({ kind: 'datetime', maxLen: 19 }, 'postgres'), 'TIMESTAMP');
  assert.equal(cjs.sqlType({ kind: 'text', maxLen: 300 }, 'mysql'), 'TEXT');
  assert.equal(cjs.sqlType({ kind: 'text', maxLen: 20 }, 'mysql'), 'VARCHAR(255)');
  assert.equal(cjs.sqlType({ kind: 'boolean', maxLen: 5 }, 'mssql'), 'BIT');
  assert.equal(cjs.sqlType({ kind: 'text', maxLen: 5000 }, 'mssql'), 'NVARCHAR(MAX)');
  assert.equal(cjs.sqlType({ kind: 'date', maxLen: 10 }, 'sqlite'), 'TEXT');
  assert.equal(cjs.sqlType({ kind: 'empty', maxLen: 0 }, 'postgres'), 'TEXT');
});

// ── Misc ─────────────────────────────────────────────────

test('misc: tableNameFromFile makes a safe table name', () => {
  assert.equal(cjs.tableNameFromFile('Customers 2026.csv'), 'customers_2026');
  assert.equal(cjs.tableNameFromFile('2026-export.json'), 't_2026_export');
  assert.equal(cjs.tableNameFromFile('.csv'), 'my_table');
});

test('misc: buildTable reports empty input as empty', () => {
  assert.equal(build('   \n').empty, true);
});
