# vahac-tools

A collection of standalone browser tools by Vahac. Each utility is implemented with plain HTML, CSS, and JavaScript, so it can run locally without a backend.

Main tools page:
- [vahac.com/tools](https://vahac.com/tools?utm_source=github)

Documentation status:
- Last updated: 2026-09-23 (UTM Campaign URL Builder added)
- Scope synchronized with current repository structure

## Repository Structure

- `base64-encode-decode/` - Base64 encoding and decoding for text and files, with URL-safe and data URI output.
- `byte-storage-converter/` - SI/IEC storage unit conversion and bitrate/file size calculations.
- `chmod-file-permission-calculator/` - symbolic/octal permission conversion for Unix-like file modes.
- `cron-expression-generator/` - assisted cron expression builder for common scheduling patterns.
- `csv-json-sql-converter/` - CSV ↔ JSON conversion with delimiter/header detection, plus SQL `INSERT` generation for PostgreSQL, MySQL, SQLite, and SQL Server.
- `curl-to-code-converter/` - converts curl commands (bash, Windows cmd, PowerShell, browser "Copy as cURL") into fetch, Python requests, and Node.js fetch/axios code, with notes for options that do not carry over.
- `docker-compose-validator-formatter/` - validation, formatting, and docker run to Compose conversion for Compose YAML.
- `docker-run-compose-converter/` - converts `docker run` commands to `docker-compose.yml` and back.
- `favicon-generator/` - favicon pack generation (ICO and platform icons) from uploaded images.
- `hash-generator-for-files-and-text/` - hash generation for text and uploaded files.
- `image-compressor-resizer/` - client-side image compression and resizing.
- `json-formatter/` - JSON formatting and validation.
- `jwt-decoder/` - JSON Web Token decoding, claim explanations, expiry checks, and signature verification.
- `merge-text-tool/` - two-pane text merge tool with inline editing and per-block merge arrows.
- `password-passphrase-generator/` - secure password and passphrase generation.
- `regex-tester/` - live regex match highlighting, capture groups, and replace preview.
- `robots-txt-generator-validator/` - guided robots.txt builder (groups, AI crawler block, sitemaps), line-by-line validator with explanations, and a per-crawler URL tester.
- `sla-calculator/` - uptime and downtime budget calculations for SLA targets.
- `subnet-calculator/` - IPv4 subnet calculation and network planning.
- `text-diff-tool/` - line/word/character text comparison with diff highlighting.
- `unix-timestamp-converter/` - Unix epoch to ISO/UTC/local date conversion and back.
- `url-encoder-decoder/` - percent-encoding and decoding for URLs, query strings, and form data.
- `utm-campaign-url-builder/` - UTM-tagged campaign links with presets, a GA4 default-channel check, saved presets, a CSV link list, and QR export.
- `vcard-qr-code-generator/` - vCard data generation and QR export.
- `wifi-qr-code-generator/` - Wi-Fi network QR codes (WPA/WPA2/WPA3, WEP, open, hidden) with PNG/SVG export and a printable card.
- `yaml-json-toml-converter/` - format conversion between YAML, JSON, and TOML.
- `css-template.md` - shared CSS/style guidance for tool pages.

## Tool Overview

### 1) Base64 Encode / Decode

Path:
- `base64-encode-decode/index.html`

Features:
- Encodes and decodes Base64 for text or any file.
- Supports the standard and URL-safe alphabets, plus MIME line wrapping.
- Produces data URI output for quick embedding.

### 2) Byte and Storage Converter

Path:
- `byte-storage-converter/index.html`

Features:
- Converts between Decimal (SI) and Binary (IEC) units.
- Includes Bitrate -> File Size and File Size -> Bitrate modes.
- Provides fast copy actions for outputs.

### 3) Chmod File Permission Calculator

Path:
- `chmod-file-permission-calculator/index.html`

Features:
- Converts permissions between symbolic and octal formats.
- Helps verify read/write/execute combinations for owner/group/others.
- Useful for server, DevOps, and terminal workflows.

### 4) Cron Expression Generator

Path:
- `cron-expression-generator/index.html`

Features:
- Builds cron expressions from guided input fields.
- Supports frequent scheduling patterns for automation tasks.
- Reduces manual errors when composing cron syntax.

### 5) CSV ↔ JSON ↔ SQL Converter

Path:
- `csv-json-sql-converter/index.html`

Features:
- Detects the delimiter (comma, semicolon, tab, pipe) and header row, with manual overrides; parses quoted fields, embedded line breaks, and JSON Lines.
- Converts CSV to JSON (objects, arrays, or JSON Lines) and JSON back to CSV, flattening nested objects into dot-notation columns.
- Generates literal-value SQL `INSERT` statements for PostgreSQL, MySQL/MariaDB, SQLite, and SQL Server, with batching, an optional `CREATE TABLE` with inferred types, and validation messages for ragged rows, bad quotes, and invalid JSON.

### 6) cURL to Code Converter

Path:
- `curl-to-code-converter/index.html`

Features:
- Splits the command exactly as the shell would: POSIX sh/bash/zsh (including `$'...'` strings, here-documents and redirects), Windows cmd with the C runtime argument rules, and PowerShell.
- Reads curl options with curl's own defaults: method inference, `-d`/`--data-*`/`--json`/`-F`/`-T` bodies, `-G`, `-u` and URL credentials, cookies, proxies, TLS files, timeouts and output flags.
- Generates fetch (browser), Python requests, Node.js fetch and axios code, and lists every option that is not translated, plus behaviour differences such as redirects, browser-forbidden headers and number precision.

### 7) Docker Compose Validator and Formatter

Path:
- `docker-compose-validator-formatter/index.html`

Features:
- Validates Compose YAML structure and syntax directly in the browser.
- Formats Compose files for readability and consistency.
- Converts common `docker run` command patterns into Compose blocks.

### 8) Docker Run to Compose Converter

Path:
- `docker-run-compose-converter/index.html`

Features:
- Converts `docker run` commands into `docker-compose.yml`, and back again.
- Flags unsupported or ambiguous flags with warnings instead of silently dropping them.
- Runs entirely client-side, no signup or data upload.

### 9) Favicon Generator

Path:
- `favicon-generator/index.html`

Features:
- Generates favicon assets from uploaded source images.
- Exports common icon sizes and formats for modern platforms.
- Helps produce a ready-to-use favicon package and markup.

### 10) Hash Generator for Files and Text

Path:
- `hash-generator-for-files-and-text/index.html`

Features:
- Generates hashes from plain text input and files.
- Useful for integrity checks and comparison workflows.
- Runs directly in the browser without server-side processing.

### 11) Image Compressor and Resizer

Path:
- `image-compressor-resizer/index.html`

Features:
- Compresses images client-side.
- Resizes images with quality control options.
- Keeps image processing local in the browser.

### 12) JSON Formatter and Validator

Path:
- `json-formatter/index.html`

Features:
- Formats JSON for readability.
- Validates JSON syntax.
- Helps debug API payloads and config blocks.

### 13) JWT Decoder

Path:
- `jwt-decoder/index.html`

Features:
- Decodes the header and payload of any JSON Web Token, with syntax-highlighted JSON.
- Explains registered claims and converts `exp`, `nbf`, and `iat` into readable dates with a validity badge.
- Optionally verifies HS/RS/ES/PS signatures with a shared secret, PEM public key, or JWK — all via the Web Crypto API in the browser.

### 14) Merge Text Tool

Path:
- `merge-text-tool/index.html`

Features:
- Two-pane, line-by-line comparison of two texts, like a lightweight Araxis Merge / Beyond Compare.
- Push a differing block left or right with inline gutter arrows, or edit lines directly in place.
- Options to ignore whitespace or case differences; copy either side's result when done.

### 15) Password and Passphrase Generator

Path:
- `password-passphrase-generator/index.html`

Features:
- Generates strong passwords and passphrases.
- Allows control over complexity and length.
- Focused on practical account security improvements.

### 16) Regex Tester

Path:
- `regex-tester/index.html`

Features:
- Live match highlighting with capture group inspection.
- Replace preview for testing substitution patterns.
- Includes a common patterns cheat sheet.

### 17) robots.txt Generator and Validator

Path:
- `robots-txt-generator-validator/index.html`

Features:
- Builds a robots.txt from presets (allow all, block all, WordPress default) and editable user-agent groups with Allow/Disallow rules, optional Crawl-delay, a shared block for AI crawlers, and Sitemap lines.
- Validates pasted or uploaded files line by line following RFC 9309 and Google's parser: typos, missing colons, rules outside groups, paths that never match, relative sitemaps, unsupported directives (Noindex, Host), groups merged by blank lines, and the 500 KiB limit.
- Tests URLs per crawler (Googlebot, Bingbot, GPTBot, custom tokens, with documented Googlebot fallbacks) and explains which group and rule decide: the longest match wins and Allow wins ties.

### 18) Uptime / SLA Calculator

Path:
- `sla-calculator/index.html`

Features:
- Converts SLA percentages into allowed downtime windows.
- Supports yearly, monthly, weekly, and daily breakdowns.
- Includes reverse calculations from known downtime budgets.

### 19) IP Subnet Calculator

Path:
- `subnet-calculator/index.html`

Features:
- Calculates network address, broadcast address, host range, subnet mask, and CIDR.
- Helps validate subnet segmentation and addressing plans.
- Useful for admin, DevOps, and networking study tasks.

### 20) Text Diff Tool

Path:
- `text-diff-tool/index.html`

Features:
- Compares two texts at line, word, or character granularity.
- Options to ignore whitespace or case differences.
- Collapses long unchanged runs and copies the diff as plain text.

### 21) Unix Timestamp Converter

Path:
- `unix-timestamp-converter/index.html`

Features:
- Converts Unix epoch seconds or milliseconds to ISO 8601, UTC, and local time.
- Converts a date back into a Unix timestamp.
- Includes a live-ticking current timestamp panel.

### 22) URL Encoder / Decoder

Path:
- `url-encoder-decoder/index.html`

Features:
- Percent-encodes and decodes URLs, query strings, and form data.
- Supports component, full URL, form, and strict RFC 3986 modes.
- Includes a URL inspector for breaking down a URL's parts.

### 23) UTM Campaign URL Builder

Path:
- `utm-campaign-url-builder/index.html`

Features:
- Builds campaign links with utm_source, utm_medium, utm_campaign, utm_content, utm_term and the GA4 extras (utm_id, utm_source_platform, utm_creative_format, utm_marketing_tactic); lowercases values, replaces spaces, percent-encodes the rest, and keeps ad-platform placeholders such as `{{campaign.name}}` unencoded.
- Keeps the landing page's own parameters and `#fragment`, replaces or imports existing UTM tags, and drops copied click IDs (gclid, fbclid, msclkid…).
- Predicts the GA4 default channel group from Google's published rules and source list, with fixes for common mistakes (unrecognised mediums, `x` instead of `twitter`, "shop" in campaign names); 24 built-in presets plus saved presets, a CSV link list, and PNG/SVG QR export.

### 24) vCard QR Code Generator

Path:
- `vcard-qr-code-generator/index.html`

Features:
- Builds vCard 3.0 payloads from contact fields.
- Generates QR codes from vCard data.
- Supports export to VCF, PNG, SVG, and clipboard copy.

### 25) Wi-Fi QR Code Generator

Path:
- `wifi-qr-code-generator/index.html`

Features:
- Builds `WIFI:` payloads for WPA/WPA2/WPA3, WPA3-only (`T:WPA;R:1` per the WPA3 spec, or Android-style `T:SAE`), WEP, and open networks, with a hidden-network flag.
- Escapes special characters and encodes non-ASCII SSIDs as UTF-8; validates SSID byte length and passphrase rules.
- Exports PNG (512–2048 px) and SVG, and prints a Wi-Fi card (1, 2, 4, or 6 per page) or downloads it as PNG.

### 26) YAML JSON TOML Converter

Path:
- `yaml-json-toml-converter/index.html`

Features:
- Converts data between YAML, JSON, and TOML formats.
- Useful for infra, app config, and serialization workflows.
- Runs fully client-side without backend processing.

## Local Usage

These are static tools, so you can run them in either of these ways:

1. Open any target `index.html` directly in your browser.
2. Start a local static server from the repository root (recommended):

```powershell
python -m http.server 8080
```

Then open:
- `http://localhost:8080/base64-encode-decode/`
- `http://localhost:8080/byte-storage-converter/`
- `http://localhost:8080/chmod-file-permission-calculator/`
- `http://localhost:8080/cron-expression-generator/`
- `http://localhost:8080/csv-json-sql-converter/`
- `http://localhost:8080/curl-to-code-converter/`
- `http://localhost:8080/docker-compose-validator-formatter/`
- `http://localhost:8080/docker-run-compose-converter/`
- `http://localhost:8080/favicon-generator/`
- `http://localhost:8080/hash-generator-for-files-and-text/`
- `http://localhost:8080/image-compressor-resizer/`
- `http://localhost:8080/json-formatter/`
- `http://localhost:8080/jwt-decoder/`
- `http://localhost:8080/merge-text-tool/`
- `http://localhost:8080/password-passphrase-generator/`
- `http://localhost:8080/regex-tester/`
- `http://localhost:8080/robots-txt-generator-validator/`
- `http://localhost:8080/sla-calculator/`
- `http://localhost:8080/subnet-calculator/`
- `http://localhost:8080/text-diff-tool/`
- `http://localhost:8080/unix-timestamp-converter/`
- `http://localhost:8080/url-encoder-decoder/`
- `http://localhost:8080/utm-campaign-url-builder/`
- `http://localhost:8080/vcard-qr-code-generator/`
- `http://localhost:8080/wifi-qr-code-generator/`
- `http://localhost:8080/yaml-json-toml-converter/`

## Tests

The repository ships with a unit-test suite covering the core logic of every
tool (632 tests across 24 modules), powered by the built-in Node.js test runner
— no external dependencies required.

Requirements: Node.js 20 or newer.

```powershell
npm test
```

`npm test` runs `tests/run.js`, which collects `tests/*.test.js` and runs them
through `node:test`'s `run()` API with the spec reporter. This works the same
on Node 20, 22 and 24 under both cmd.exe and POSIX shells — unlike
`node --test tests/` (a directory argument breaks on Node 21+) or a glob
(unsupported by `--test` on Node 20, and never expanded by cmd.exe). To run a
single module, pass its path directly:

```powershell
node --test tests/jwt-decoder.test.js
```

The suite covers byte/storage conversion, chmod permissions, cron parsing and
scheduling, SLA downtime maths, IPv4 subnetting, JSON formatting and stats,
password/passphrase entropy, vCard generation, curl command parsing (POSIX, cmd and
PowerShell quoting) and code generation, CSV parsing with delimiter/header
detection, per-dialect SQL literal escaping, Wi-Fi QR payload escaping and
validation, UTM link building (URL parsing, encoding round-trips through the
WHATWG URL parser, GA4 default-channel rules for every preset), TOML
round-tripping, JWT parsing and claim handling, and MD5 hashing (verified against
`node:crypto`).

Tests run on demand via GitHub Actions
(`.github/workflows/test.yml`) — the workflow uses `workflow_dispatch` only, so
nothing executes automatically on push or pull request. Trigger it manually
from the **Actions** tab in GitHub ("Run workflow"); inputs let you pick a
specific Node version (20 / 22) or runner OS (Ubuntu / Windows / macOS), or
leave both blank to run the full matrix.

## Notes

- All tools are frontend-only and designed for straightforward local execution.
- Use `css-template.md` as the baseline style guide when creating or redesigning a tool.