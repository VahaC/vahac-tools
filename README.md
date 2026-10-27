# vahac-tools

A collection of standalone browser tools by Vahac. Each utility is implemented with plain HTML, CSS, and JavaScript, so it can run locally without a backend.

Main tools page:
- [vahac.com/tools](https://vahac.com/tools?utm_source=github)

Documentation status:
- Last updated: 2026-10-27 (Open Graph Meta Tag Generator and Checker added)
- Scope synchronized with current repository structure

## Repository Structure

- `backup-retention-prune-simulator/` - Proxmox Backup Server, `borg prune` and `restic forget` retention side by side: a backup schedule or a pasted snapshot list, keep-last/hourly/daily/weekly/monthly/yearly and keep-within rules, which snapshots each tool keeps and why (ported from PBS 4.2.8, BorgBackup 1.4.5 and restic 0.19.1), a calendar and a table of kept and pruned snapshots, every difference explained, and the matching commands with dry runs.
- `base64-encode-decode/` - Base64 encoding and decoding for text and files, with URL-safe and data URI output.
- `byte-storage-converter/` - SI/IEC storage unit conversion and bitrate/file size calculations.
- `chmod-file-permission-calculator/` - symbolic/octal permission conversion for Unix-like file modes.
- `cron-expression-generator/` - assisted cron expression builder for common scheduling patterns.
- `csp-security-headers-builder/` - guided Content-Security-Policy builder (presets, third-party services, inline-script hashes) with HSTS, framing, Permissions-Policy and cross-origin headers, output for 10 server formats, and an analyzer that grades pasted response headers.
- `csv-json-sql-converter/` - CSV ↔ JSON conversion with delimiter/header detection, plus SQL `INSERT` generation for PostgreSQL, MySQL, SQLite, and SQL Server.
- `curl-to-code-converter/` - converts curl commands (bash, Windows cmd, PowerShell, browser "Copy as cURL") into fetch, Python requests, and Node.js fetch/axios code, with notes for options that do not carry over.
- `docker-compose-validator-formatter/` - validation, formatting, and docker run to Compose conversion for Compose YAML.
- `docker-run-compose-converter/` - converts `docker run` commands to `docker-compose.yml` and back.
- `esp32-gpio-pin-picker/` - ESP32, ESP32-S3, ESP32-C3 and ESP32-C6 GPIO pins ranked from safe to avoid for a chosen use (digital I/O, I2C, SPI, UART, PWM, ADC, touch, deep-sleep wake, DAC), with strapping, flash/PSRAM, USB, UART0, input-only, ADC1/ADC2, touch and RTC flags from Espressif datasheets, module and package options, an ESPHome cross-check and a `pin:` snippet.
- `favicon-generator/` - favicon pack generation (ICO and platform icons) from uploaded images.
- `hash-generator-for-files-and-text/` - hash generation for text and uploaded files.
- `homelab-power-cost-calculator/` - energy and electricity cost per day, month and year for a list of homelab devices (idle and load watts, share of time at load, always on, hours per day or a time window, quantity), with a single or day/night tariff, an optional fixed charge, each device's share of the cost, a payback calculator for a lower-power replacement, a plain-text summary and CSV export.
- `image-compressor-resizer/` - client-side image compression and resizing.
- `ipv6-subnet-calculator/` - IPv6 address and prefix calculator: RFC 5952 and expanded forms, network range, exact address count and /64 LANs, the address type from the IANA registries, ip6.arpa reverse zones, a nibble-aware subnet split with paging, a ULA /48 generator (RFC 4193) and a modified EUI-64 interface ID from a MAC.
- `json-formatter/` - JSON formatting and validation.
- `jwt-decoder/` - JSON Web Token decoding, claim explanations, expiry checks, and signature verification.
- `merge-text-tool/` - two-pane text merge tool with inline editing and per-block merge arrows.
- `open-graph-meta-generator/` - Open Graph and X card meta tags: a generator for the `<title>`, meta description, canonical link, `og:` tags (website or article with `article:*`), the image with its size, type and alt text, `twitter:card` and handles, with an image check against the sizes Meta, X and LinkedIn document and approximate preview cards; plus a checker for a pasted `<head>` or page source that lists every tag, what each platform would use, and the missing, duplicate and conflicting tags with the fix and the source.
- `password-passphrase-generator/` - secure password and passphrase generation.
- `proxmox-lxc-idmap-generator/` - Proxmox LXC UID/GID mapping: `lxc.idmap` lines that cover the whole container range around the mapped IDs, matching `/etc/subuid` and `/etc/subgid` entries, the bind mount line, a `chown` command, and the Proxmox VE 9.2+ per-mount-point `idmap` alternative.
- `regex-tester/` - live regex match highlighting, capture groups, and replace preview.
- `robots-txt-generator-validator/` - guided robots.txt builder (groups, AI crawler block, sitemaps), line-by-line validator with explanations, and a per-crawler URL tester.
- `sla-calculator/` - uptime and downtime budget calculations for SLA targets.
- `spf-dmarc-record-generator/` - SPF and DMARC TXT records: an SPF builder with the includes Google Workspace, Microsoft 365, Zoho Mail, Fastmail, Proton Mail, iCloud+, Mailgun, Amazon SES and SendGrid document plus your own ip4/ip6/a/mx, and a DMARC builder following RFC 9989 (p, sp, np, t, alignment, rua/ruf, fo), each with the DNS name, the value, a BIND zone-file line split into 255-octet strings and the authorization record for report addresses on another domain; plus a checker for pasted records (dig, nslookup, zone files) that explains every term, counts SPF DNS lookups across pasted includes and names each problem with the fix and the RFC section.
- `subnet-calculator/` - IPv4 subnet calculation and network planning.
- `text-diff-tool/` - line/word/character text comparison with diff highlighting.
- `traefik-docker-labels-generator/` - Traefik v3 and v2 labels for a Compose service (host and path rules, entrypoints, TLS and certificate resolver, HTTP to HTTPS redirect, Docker network, `traefik.enable`, basic auth from an htpasswd line, IP allowlist, security headers) in list and map syntax, plus a service snippet, the equivalent file-provider YAML and the static config they expect.
- `unix-timestamp-converter/` - Unix epoch to ISO/UTC/local date conversion and back.
- `url-encoder-decoder/` - percent-encoding and decoding for URLs, query strings, and form data.
- `utm-campaign-url-builder/` - UTM-tagged campaign links with presets, a GA4 default-channel check, saved presets, a CSV link list, and QR export.
- `vcard-qr-code-generator/` - vCard data generation and QR export.
- `wifi-qr-code-generator/` - Wi-Fi network QR codes (WPA/WPA2/WPA3, WEP, open, hidden) with PNG/SVG export and a printable card.
- `wireguard-config-generator/` - WireGuard server and client configs: X25519 key pairs and preshared keys made in the browser, an IPv4 (and optional IPv6) address plan, full or split tunnel, the server `wg0.conf` with a `[Peer]` block per client, and a `.conf` download and QR code per client.
- `yaml-json-toml-converter/` - format conversion between YAML, JSON, and TOML.
- `zfs-raid-capacity-calculator/` - usable ZFS pool capacity in TB and TiB for stripe, 2/3/4-way mirror and RAIDZ1/2/3 layouts with any number of vdevs, mixed disk sizes and hot spares: raw, after parity or mirroring, after ZFS reserves and RAIDZ padding at a chosen record size and ashift, after slop space and at a target fill level, using OpenZFS 2.4.4 space accounting; disks that may fail (guaranteed and best case), every layout the disks allow side by side, and classic RAID 0/1/5/6/10.
- `zigbee-wifi-channel-planner/` - Zigbee channel planning next to 2.4 GHz Wi-Fi: your own and neighbouring access points (20 MHz, or 40 MHz with HT40+/HT40-) for the US, Europe or Japan drawn to scale with Zigbee channels 11–26 on the 802.11 transmit masks, every Zigbee channel graded clear, marginal or overlapped with the gap to the nearest Wi-Fi edge, a recommended channel and runner-up, a Thread channel, channel 25/26 caveats, and the Zigbee2MQTT, ZHA and Thread steps to change channel.
- `css-template.md` - shared CSS/style guidance for tool pages.

## Tool Overview

### 1) Backup Retention (Prune) Simulator

Path:
- `backup-retention-prune-simulator/index.html`

Features:
- A backup schedule (chosen weekdays, fixed times or every N hours, a simulated period ending now or at a chosen date, missed days) or a pasted list of snapshot times from `proxmox-backup-client snapshot list`, `borg list` or `restic snapshots`; a time zone; keep-last, hourly, daily, weekly, monthly, yearly and keep-within rules, with -1 or `unlimited` for no limit.
- The same rules run through ports of Proxmox Backup Server 4.2.8 (`pbs-datastore/src/prune.rs`), BorgBackup 1.4.5 (`prune_split()`, `prune_within()`) and restic 0.19.1 (`ApplyPolicy()`): kept and pruned counts, a calendar per tool coloured by the rule that kept each snapshot, and a table with each tool's own reason (`daily #3`, `yearly[oldest]`, restic's list of matched rules).
- Explains each difference it finds: restic counting one snapshot for several rules, PBS treating a period as covered as soon as any snapshot in it is kept, the oldest-snapshot fallbacks in borg and restic, keep-within (none in PBS; borg counts back from prune time with 1m = 31 days, restic from its newest snapshot in calendar months), unlimited values and ISO weeks at New Year. Prune runs after every backup (PBS replayed run by run, because it can lose month-end backups that way) or once; outputs `proxmox-backup-client prune` and `proxmox-backup-manager prune-job` commands, `borg prune` and `restic forget` with dry-run variants, and keeps the setup in the URL hash.

### 2) Base64 Encode / Decode

Path:
- `base64-encode-decode/index.html`

Features:
- Encodes and decodes Base64 for text or any file.
- Supports the standard and URL-safe alphabets, plus MIME line wrapping.
- Produces data URI output for quick embedding.

### 3) Byte and Storage Converter

Path:
- `byte-storage-converter/index.html`

Features:
- Converts between Decimal (SI) and Binary (IEC) units.
- Includes Bitrate -> File Size and File Size -> Bitrate modes.
- Provides fast copy actions for outputs.

### 4) Chmod File Permission Calculator

Path:
- `chmod-file-permission-calculator/index.html`

Features:
- Converts permissions between symbolic and octal formats.
- Helps verify read/write/execute combinations for owner/group/others.
- Useful for server, DevOps, and terminal workflows.

### 5) Cron Expression Generator

Path:
- `cron-expression-generator/index.html`

Features:
- Builds cron expressions from guided input fields.
- Supports frequent scheduling patterns for automation tasks.
- Reduces manual errors when composing cron syntax.

### 6) CSP and HTTP Security Headers Builder

Path:
- `csp-security-headers-builder/index.html`

Features:
- Builds a Content-Security-Policy from presets (starter, Google's nonce-based strict CSP, compatible, API) and per-directive fields with quick-add keywords; one-click sources for 13 third-party services taken from vendor CSP docs; SHA-256/384/512 hashes of inline scripts and styles.
- Adds HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP/COEP/CORP and reporting endpoints, and writes them as raw headers, Nginx, Apache, Caddy, Traefik (labels or file), Netlify/Cloudflare `_headers`, HTML `<meta>`, WordPress/PHP or IIS config with correct escaping.
- Analyzes pasted headers (curl -I / -v / -IL, wget -S, DevTools), a bare policy or `<meta>` tags: CSP3 parsing (commas, duplicates, missing semicolons, unquoted keywords, nonces, hashes, `strict-dynamic`), RFC 9651 structured fields, cookie flags, CORS and version leaks, with a 100-point score. It does not fetch URLs, because CORS hides most cross-origin response headers from web pages.

### 7) CSV ↔ JSON ↔ SQL Converter

Path:
- `csv-json-sql-converter/index.html`

Features:
- Detects the delimiter (comma, semicolon, tab, pipe) and header row, with manual overrides; parses quoted fields, embedded line breaks, and JSON Lines.
- Converts CSV to JSON (objects, arrays, or JSON Lines) and JSON back to CSV, flattening nested objects into dot-notation columns.
- Generates literal-value SQL `INSERT` statements for PostgreSQL, MySQL/MariaDB, SQLite, and SQL Server, with batching, an optional `CREATE TABLE` with inferred types, and validation messages for ragged rows, bad quotes, and invalid JSON.

### 8) cURL to Code Converter

Path:
- `curl-to-code-converter/index.html`

Features:
- Splits the command exactly as the shell would: POSIX sh/bash/zsh (including `$'...'` strings, here-documents and redirects), Windows cmd with the C runtime argument rules, and PowerShell.
- Reads curl options with curl's own defaults: method inference, `-d`/`--data-*`/`--json`/`-F`/`-T` bodies, `-G`, `-u` and URL credentials, cookies, proxies, TLS files, timeouts and output flags.
- Generates fetch (browser), Python requests, Node.js fetch and axios code, and lists every option that is not translated, plus behaviour differences such as redirects, browser-forbidden headers and number precision.

### 9) Docker Compose Validator and Formatter

Path:
- `docker-compose-validator-formatter/index.html`

Features:
- Validates Compose YAML structure and syntax directly in the browser.
- Formats Compose files for readability and consistency.
- Converts common `docker run` command patterns into Compose blocks.

### 10) Docker Run to Compose Converter

Path:
- `docker-run-compose-converter/index.html`

Features:
- Converts `docker run` commands into `docker-compose.yml`, and back again.
- Flags unsupported or ambiguous flags with warnings instead of silently dropping them.
- Runs entirely client-side, no signup or data upload.

### 11) ESP32 GPIO Pin Picker

Path:
- `esp32-gpio-pin-picker/index.html`

Features:
- Ranks every GPIO of the ESP32, ESP32-S3, ESP32-C3 or ESP32-C6 as safe, use with care or avoid for the use you pick (digital I/O, input, I2C, SPI, UART, PWM, ADC, touch, deep-sleep wake, DAC), with a one-line reason and the source behind each verdict.
- Pin data transcribed from the Espressif datasheets (ESP32 v5.3, S3 v2.2, C3 v2.4, C6 v1.5) and the ESP-IDF GPIO, ADC and sleep references: strapping pins with what they strap and the level needed at reset, flash/PSRAM and VDD_SPI pins, USB D-/D+, UART0, pad JTAG, input-only pins, ADC1/ADC2 channels with each chip's ADC2 and Wi-Fi rule, touch channels, RTC/LP wake pins and the ESP32 DAC.
- Module and package options that change the answer (PSRAM on GPIO16/17, ESP32-U4WDH in-package flash, ESP32-S3 octal PSRAM on GPIO33-37 and 1.8 V GPIO47/48, 16-GPIO ESP32-C3 variants, ESP32-C6 QFN40/QFN32), an ESPHome 2026.10.0 validation cross-check, a copyable ESPHome snippet, and URL-hash state for sharing.

### 12) Favicon Generator

Path:
- `favicon-generator/index.html`

Features:
- Generates favicon assets from uploaded source images.
- Exports common icon sizes and formats for modern platforms.
- Helps produce a ready-to-use favicon package and markup.

### 13) Hash Generator for Files and Text

Path:
- `hash-generator-for-files-and-text/index.html`

Features:
- Generates hashes from plain text input and files.
- Useful for integrity checks and comparison workflows.
- Runs directly in the browser without server-side processing.

### 14) Homelab Power Cost Calculator

Path:
- `homelab-power-cost-calculator/index.html`

Features:
- Device list with name, quantity, idle and load watts, share of time at load, and always on, hours per day or a clock time window (past midnight included); average draw = idle + (load - idle) x share at load.
- kWh and cost per day, month (365 / 12 days) and year (365 days) for every device and in total, each device's share of the cost with a bar, a single rate or a day/night tariff with the cheap window's exact overlap per device, and an optional fixed charge kept out of per-device costs.
- Payback for replacing an old machine (old and new watts, hours a day, price, money back for the old one): saving a month and a year, months to break even or "never", net after 1, 3 and 5 years. ISO currency codes via `Intl.NumberFormat` or a plain symbol, every assumption listed on the page, warnings that name the value and the fix, plain-text summary, CSV export and the whole setup in the URL hash.

### 15) Image Compressor and Resizer

Path:
- `image-compressor-resizer/index.html`

Features:
- Compresses images client-side.
- Resizes images with quality control options.
- Keeps image processing local in the browser.

### 16) IPv6 Subnet Calculator

Path:
- `ipv6-subnet-calculator/index.html`

Features:
- Accepts every RFC 4291 text form (full, `::` compression, leading zeros, an embedded IPv4 tail, mixed case, URL brackets and RFC 4007 zone IDs such as `fe80::1%eth0`) as `address/length` or with a separate prefix field, and says exactly what is wrong with an invalid one.
- Shows the RFC 5952 canonical form (mixed notation only for the well-known IPv4-embedding prefixes) and the expanded form, network prefix and mask, first and last address, the exact address count and 2^n, the /64 LANs, /56 blocks and /48 sites it holds, the interface ID (with the MAC behind an EUI-64 one), embedded IPv4 (mapped, NAT64, 6to4, Teredo), the address type and its flags from the IANA IPv6 Address Space, Special-Purpose and Global Unicast Assignments registries, multicast scope, flags and well-known groups, the ip6.arpa PTR name, the reverse zones at nibble boundaries and a prefix map of the 32 hex digits.
- Splits the prefix into longer ones with nibble-alignment notes, 16 subnets per page, a jump to any subnet number and copy of a page or the whole list (up to 4,096); generates a ULA /48 per RFC 4193 from `crypto.getRandomValues`; builds a modified EUI-64 interface ID and link-local address from a MAC. 128-bit math uses BigInt; the calculator input lives in the URL hash, MAC addresses and generated prefixes never do.

### 17) JSON Formatter and Validator

Path:
- `json-formatter/index.html`

Features:
- Formats JSON for readability.
- Validates JSON syntax.
- Helps debug API payloads and config blocks.

### 18) JWT Decoder

Path:
- `jwt-decoder/index.html`

Features:
- Decodes the header and payload of any JSON Web Token, with syntax-highlighted JSON.
- Explains registered claims and converts `exp`, `nbf`, and `iat` into readable dates with a validity badge.
- Optionally verifies HS/RS/ES/PS signatures with a shared secret, PEM public key, or JWK — all via the Web Crypto API in the browser.

### 19) Merge Text Tool

Path:
- `merge-text-tool/index.html`

Features:
- Two-pane, line-by-line comparison of two texts, like a lightweight Araxis Merge / Beyond Compare.
- Push a differing block left or right with inline gutter arrows, or edit lines directly in place.
- Options to ignore whitespace or case differences; copy either side's result when done.

### 20) Open Graph Meta Tag Generator and Checker

Path:
- `open-graph-meta-generator/index.html`

Features:
- Generates the `<title>`, meta description, `<link rel="canonical">`, Open Graph tags following ogp.me (`og:type` website or article with `article:published_time`, `modified_time`, `author`, `section` and `tag`, `og:locale` and alternates, `og:image` with `type`, `width`, `height` and `alt`, `fb:app_id`) and X card tags (`summary_large_image` or `summary`, `twitter:site`/`twitter:creator`, optional `twitter:` copies of title, description, image and alt that X otherwise takes from Open Graph). Values are escaped for double-quoted attributes and non-ASCII text is kept as is; a note warns that WordPress SEO plugins such as Rank Math and Yoast already print these tags.
- Validates every field with the documented rule and its source: full http/https URLs for `og:url` and `og:image` (relative, `//` and scheme-less values flagged), HTTPS images (X developer policy), tracking parameters in `og:url` (Meta), `language_TERRITORY` locales, ISO 8601 dates, X usernames and the 70/200/420-character maximums from X's Cards markup reference. A local image file (or, only on an explicit button press, the image URL) is checked against Meta's 200 x 200 minimum, 600 x 315 and 1200 x 630 sizes, 1.91:1 and 8 MB, X's 2:1 or 1:1 cards with their pixel and 5 MB limits and formats, and LinkedIn's 1200 x 627 minimum, 1.91:1 and 5 MB, next to large-image and small-image preview cards labelled as approximations.
- Checks a pasted `<head>` or page source with a tokenizer that follows the HTML attribute syntax and skips comments, scripts and styles: lists every tag with its line, what Google, Meta, X and LinkedIn would use (including X's fallback to Open Graph and the last `twitter:card` winning), and reports missing and duplicate tags, conflicting values (the first wins per ogp.me), `og:image` without size or alt, http images on an https page, a canonical link that differs from `og:url`, `name=` versus `property=`, tags after the body starts or beyond Meta's first 1 MB, misspelt properties and invalid values, each with the fix and a link to the source, plus links to the Meta Sharing Debugger and LinkedIn Post Inspector. The checker makes no requests; the generator settings live in the URL hash.

### 21) Password and Passphrase Generator

Path:
- `password-passphrase-generator/index.html`

Features:
- Generates strong passwords and passphrases.
- Allows control over complexity and length.
- Focused on practical account security improvements.

### 22) Proxmox LXC idmap Generator

Path:
- `proxmox-lxc-idmap-generator/index.html`

Features:
- Maps container UIDs and GIDs (set separately, single IDs or ranges) to host IDs and fills every other container ID 0–65535 with the shifted range Proxmox uses (`100000 + ID`), merging lines that continue each other, in `lxc.idmap: u|g <container> <host> <count>` form for `/etc/pve/lxc/<ID>.conf`.
- Rejects overlaps the way Proxmox and the kernel do (two rows on one container ID, two container IDs on one host ID, a host ID inside the shifted range) and warns when an ID maps to host root, when container root is remapped, or when a row changes nothing.
- Lists the `root:<start>:<count>` lines `/etc/subuid` and `/etc/subgid` need (marking the default `root:100000:65536`), idempotent commands to add them, the `mpN:` line and `pct set` command, a `chown` for the host folder, restart/check commands, and the per-mount-point `idmap=` option of Proxmox VE 9.2+; inputs live in the URL hash.

### 23) Regex Tester

Path:
- `regex-tester/index.html`

Features:
- Live match highlighting with capture group inspection.
- Replace preview for testing substitution patterns.
- Includes a common patterns cheat sheet.

### 24) robots.txt Generator and Validator

Path:
- `robots-txt-generator-validator/index.html`

Features:
- Builds a robots.txt from presets (allow all, block all, WordPress default) and editable user-agent groups with Allow/Disallow rules, optional Crawl-delay, a shared block for AI crawlers, and Sitemap lines.
- Validates pasted or uploaded files line by line following RFC 9309 and Google's parser: typos, missing colons, rules outside groups, paths that never match, relative sitemaps, unsupported directives (Noindex, Host), groups merged by blank lines, and the 500 KiB limit.
- Tests URLs per crawler (Googlebot, Bingbot, GPTBot, custom tokens, with documented Googlebot fallbacks) and explains which group and rule decide: the longest match wins and Allow wins ties.

### 25) Uptime / SLA Calculator

Path:
- `sla-calculator/index.html`

Features:
- Converts SLA percentages into allowed downtime windows.
- Supports yearly, monthly, weekly, and daily breakdowns.
- Includes reverse calculations from known downtime budgets.

### 26) SPF and DMARC Record Generator and Checker

Path:
- `spf-dmarc-record-generator/index.html`

Features:
- SPF builder: mailbox providers and sending services with the include each one documents (Google Workspace, Microsoft 365, Zoho Mail, Fastmail, Proton Mail, iCloud+, Mailgun, Amazon SES, SendGrid, each linked to its setup page), ip4/ip6 addresses and ranges, `a` and `mx`, other includes, a subdomain for custom MAIL FROM domains, `~all` or `-all` with the trade-off from RFC 7208 §8.4/§8.5 and RFC 9989 §7.1, the `v=spf1 -all` record for domains that send no mail, and a warning when a service checks SPF on a subdomain instead.
- DMARC builder following RFC 9989 (May 2026, obsoletes RFC 7489): `p` with the none → quarantine → reject rollout of §5.1 and §7.4, `sp`, `np`, `t=y` test mode in place of the removed `pct`, `adkim`/`aspf`, `rua`/`ruf` with `mailto:` added, and `fo`. Each record comes with its DNS name, the value, a BIND zone-file line split into 255-octet strings, and the `<domain>._report._dmarc.<host>` authorization record for report addresses on another domain.
- Checker for pasted records (raw values, quoted strings, `dig` and `nslookup` output, zone files with parentheses, included records labelled with their names): the RFC 7208 grammar including macros and CIDR suffixes, a plain-language explanation of every term and tag, the DNS-lookup count across nested includes and redirects (exact when every include is pasted, otherwise "at least N"), loops, multiple records, `+all`, `ptr`, redirect with all, removed DMARC tags and external report destinations, each problem with the exact value, the fix and an RFC link. It makes no DNS queries; the generator settings live in the URL hash.

### 27) IP Subnet Calculator

Path:
- `subnet-calculator/index.html`

Features:
- Calculates network address, broadcast address, host range, subnet mask, and CIDR.
- Helps validate subnet segmentation and addressing plans.
- Useful for admin, DevOps, and networking study tasks.

### 28) Text Diff Tool

Path:
- `text-diff-tool/index.html`

Features:
- Compares two texts at line, word, or character granularity.
- Options to ignore whitespace or case differences.
- Collapses long unchanged runs and copies the diff as plain text.

### 29) Traefik Docker Labels Generator

Path:
- `traefik-docker-labels-generator/index.html`

Features:
- Builds Traefik labels for a Compose service: Host rules for one or more domains with an optional path prefix (and StripPrefix), entrypoints, container port and backend scheme, TLS with a certificate resolver, an HTTP to HTTPS redirect router or the entrypoint-wide static config, `traefik.docker.network` (with the Compose project prefix for a network defined in the same file) and `traefik.enable`.
- Middlewares: basic auth from pasted htpasswd lines (MD5, SHA1 and bcrypt, the hashes Traefik's BasicAuth accepts; every `$` doubled to `$$` for Compose only), an IP allowlist (`ipAllowList`, or `ipWhiteList` before v2.11) and a small security-headers set, linking to the CSP builder for the rest.
- Outputs the labels in list and map syntax, a service snippet, the equivalent file-provider YAML and the static config it expects; explains every label and warns with the concrete value and the fix (unsupported hash, router without TLS on an HTTPS entrypoint, missing network, wildcard certificates needing DNS-01). Targets Traefik v3 with v2.11 and pre-v2.11 switches; settings live in the URL hash, never the htpasswd line.

### 30) Unix Timestamp Converter

Path:
- `unix-timestamp-converter/index.html`

Features:
- Converts Unix epoch seconds or milliseconds to ISO 8601, UTC, and local time.
- Converts a date back into a Unix timestamp.
- Includes a live-ticking current timestamp panel.

### 31) URL Encoder / Decoder

Path:
- `url-encoder-decoder/index.html`

Features:
- Percent-encodes and decodes URLs, query strings, and form data.
- Supports component, full URL, form, and strict RFC 3986 modes.
- Includes a URL inspector for breaking down a URL's parts.

### 32) UTM Campaign URL Builder

Path:
- `utm-campaign-url-builder/index.html`

Features:
- Builds campaign links with utm_source, utm_medium, utm_campaign, utm_content, utm_term and the GA4 extras (utm_id, utm_source_platform, utm_creative_format, utm_marketing_tactic); lowercases values, replaces spaces, percent-encodes the rest, and keeps ad-platform placeholders such as `{{campaign.name}}` unencoded.
- Keeps the landing page's own parameters and `#fragment`, replaces or imports existing UTM tags, and drops copied click IDs (gclid, fbclid, msclkid…).
- Predicts the GA4 default channel group from Google's published rules and source list, with fixes for common mistakes (unrecognised mediums, `x` instead of `twitter`, "shop" in campaign names); 24 built-in presets plus saved presets, a CSV link list, and PNG/SVG QR export.

### 33) vCard QR Code Generator

Path:
- `vcard-qr-code-generator/index.html`

Features:
- Builds vCard 3.0 payloads from contact fields.
- Generates QR codes from vCard data.
- Supports export to VCF, PNG, SVG, and clipboard copy.

### 34) Wi-Fi QR Code Generator

Path:
- `wifi-qr-code-generator/index.html`

Features:
- Builds `WIFI:` payloads for WPA/WPA2/WPA3, WPA3-only (`T:WPA;R:1` per the WPA3 spec, or Android-style `T:SAE`), WEP, and open networks, with a hidden-network flag.
- Escapes special characters and encodes non-ASCII SSIDs as UTF-8; validates SSID byte length and passphrase rules.
- Exports PNG (512–2048 px) and SVG, and prints a Wi-Fi card (1, 2, 4, or 6 per page) or downloads it as PNG.

### 35) WireGuard Config Generator

Path:
- `wireguard-config-generator/index.html`

Features:
- Generates X25519 key pairs with WebCrypto (TweetNaCl.js fallback, loaded only when the browser lacks X25519), clamped like `wg genkey`, after an RFC 7748 self-test; preshared keys come from `crypto.getRandomValues`. Public keys can be pasted instead, so the server or a device keeps its own private key.
- Builds the server `wg0.conf` (Address, ListenPort, a `[Peer]` block with a /32 and optional /128 per client) and one client config per peer with DNS, MTU, full-tunnel or split-tunnel `AllowedIPs`, Endpoint and PersistentKeepalive, using only the keys the Android and iOS apps accept.
- Per-client `.conf` download and QR code (SRI-pinned qrcode-generator, capacity checked), a ZIP of all configs, an optional iptables NAT example and setup steps; private and preshared keys never reach the URL, storage or the network.

### 36) YAML JSON TOML Converter

Path:
- `yaml-json-toml-converter/index.html`

Features:
- Converts data between YAML, JSON, and TOML formats.
- Useful for infra, app config, and serialization workflows.
- Runs fully client-side without backend processing.

### 37) ZFS and RAID Capacity Calculator

Path:
- `zfs-raid-capacity-calculator/index.html`

Features:
- Disk rows (quantity, size in TB, TiB, GB, GiB or bytes), hot spares, vdev type (stripe, 2/3/4-way mirror, RAIDZ1/2/3), number of vdevs, ashift 9–16, record size 4K–16M and a target fill level (80% by default); disks fill vdevs in list order and each counts up to the smallest disk in its vdev.
- Space model ported from the OpenZFS 2.4.4 source: the whole-disk GPT partition, vdev labels and boot area, metaslab sizing, the RAIDZ allocation size per record (parity and padding), the 128K deflate ratio `zfs list` uses, and slop space with its 128 MiB / 128 GiB limits and the embedded intent-log metaslab. Shows raw, after parity/mirroring, after reserves, after padding, after slop and at the fill target in TB and TiB, plus the expected `zpool list` SIZE and `zfs list` USED + AVAIL.
- Disks that may fail per vdev and for the pool (guaranteed versus best case), every valid layout for the disk count side by side, classic RAID 0/1/5/6/10 with mdadm notes, warnings that name the values and the fix (uneven splits, RAIDZ minimum widths, mixed sizes), a plain-text summary and the setup in the URL hash.

### 38) Zigbee and Wi-Fi Channel Planner

Path:
- `zigbee-wifi-channel-planner/index.html`

Features:
- Up to 12 access points, yours or a neighbour's, on channels 1–14 at 20 MHz or 40 MHz (HT40+ or HT40-); regions US (1–11), Europe and most countries (1–13) and Japan (plus 14 for 802.11b only), with warnings for channels and HT40 secondaries outside the region and errors for combinations that do not exist (HT40+ above 9, HT40- below 5, 40 MHz on 14).
- An SVG spectrum of 2400–2483.5 MHz with each network drawn as its 802.11n (or 802.11b DSSS) transmit mask and Zigbee channels 11–26 as 2 MHz bars, plus a table with each Zigbee channel's grade, gap to the nearest Wi-Fi edge, the network it comes from and the mask level at the Zigbee edge. Overlapped means inside a Wi-Fi channel, marginal closer than one channel width to its centre (the mask's -20 to -28 dBr skirt), clear farther away.
- A recommended Zigbee channel and runner-up (best grade, fewest networks, ZLL channels 11/15/20/25 first, the US reduced-power channels 25 and 26 later, widest gap), channel 26 only on request, a Thread suggestion that avoids the Zigbee channel, the Zigbee2MQTT `advanced.channel` snippet, the ZHA and Thread change steps and what they cost, the sources, a plain-text summary and the setup in the URL hash.

## Local Usage

These are static tools, so you can run them in either of these ways:

1. Open any target `index.html` directly in your browser.
2. Start a local static server from the repository root (recommended):

```powershell
python -m http.server 8080
```

Then open:
- `http://localhost:8080/backup-retention-prune-simulator/`
- `http://localhost:8080/base64-encode-decode/`
- `http://localhost:8080/byte-storage-converter/`
- `http://localhost:8080/chmod-file-permission-calculator/`
- `http://localhost:8080/cron-expression-generator/`
- `http://localhost:8080/csp-security-headers-builder/`
- `http://localhost:8080/csv-json-sql-converter/`
- `http://localhost:8080/curl-to-code-converter/`
- `http://localhost:8080/docker-compose-validator-formatter/`
- `http://localhost:8080/docker-run-compose-converter/`
- `http://localhost:8080/esp32-gpio-pin-picker/`
- `http://localhost:8080/favicon-generator/`
- `http://localhost:8080/hash-generator-for-files-and-text/`
- `http://localhost:8080/homelab-power-cost-calculator/`
- `http://localhost:8080/image-compressor-resizer/`
- `http://localhost:8080/ipv6-subnet-calculator/`
- `http://localhost:8080/json-formatter/`
- `http://localhost:8080/jwt-decoder/`
- `http://localhost:8080/merge-text-tool/`
- `http://localhost:8080/open-graph-meta-generator/`
- `http://localhost:8080/password-passphrase-generator/`
- `http://localhost:8080/proxmox-lxc-idmap-generator/`
- `http://localhost:8080/regex-tester/`
- `http://localhost:8080/robots-txt-generator-validator/`
- `http://localhost:8080/sla-calculator/`
- `http://localhost:8080/spf-dmarc-record-generator/`
- `http://localhost:8080/subnet-calculator/`
- `http://localhost:8080/text-diff-tool/`
- `http://localhost:8080/traefik-docker-labels-generator/`
- `http://localhost:8080/unix-timestamp-converter/`
- `http://localhost:8080/url-encoder-decoder/`
- `http://localhost:8080/utm-campaign-url-builder/`
- `http://localhost:8080/vcard-qr-code-generator/`
- `http://localhost:8080/wifi-qr-code-generator/`
- `http://localhost:8080/wireguard-config-generator/`
- `http://localhost:8080/yaml-json-toml-converter/`
- `http://localhost:8080/zfs-raid-capacity-calculator/`
- `http://localhost:8080/zigbee-wifi-channel-planner/`

## Tests

The repository ships with a unit-test suite covering the core logic of every
tool (1276 tests across 36 modules), powered by the built-in Node.js test runner
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
password/passphrase entropy, Proxmox LXC idmap maths (complete 0–65535
coverage, overlap rules mirroring Proxmox and the kernel, subuid/subgid ranges,
the Proxmox wiki example line for line), vCard generation, CSP parsing and security
evaluation (CSP3 policy lists, sources, nonces and hashes against `node:crypto`),
security header checks (HSTS, X-Frame-Options, RFC 9651 Permissions-Policy),
per-server config escaping, curl command parsing (POSIX, cmd and
PowerShell quoting) and code generation, CSV parsing with delimiter/header
detection, per-dialect SQL literal escaping, Wi-Fi QR payload escaping and
validation, ESP32 GPIO pin data (GPIO lists, strapping, flash/PSRAM, USB,
ADC, touch and wake pins checked against tables transcribed from the Espressif
datasheets and against ESPHome's own pin validation lists, verdict ranking,
ESPHome snippets), homelab power costs (average watts, kWh and cost per day,
month and year, quantities, day/night splits for 24/7, hours-per-day and
past-midnight time windows, fixed charges, payback and "never" cases, limits,
paper-style rounding, ISO and symbol currency formatting, CSV and the URL
hash), ZFS and RAID capacity (RAIDZ allocation sizes checked against a
direct port of the OpenZFS formula for widths 2–24, parity 1–3 and ashift
9/12/13, hand-worked partition, label, metaslab, deflate and slop values
including the 128 MiB and 128 GiB clamps, TB/TiB input, fill targets,
multiple vdevs, mixed disk sizes, fault tolerance, classic RAID levels,
invalid layouts and the URL hash), backup retention (each engine against the
worked examples in its own docs and its project's unit tests, restic's golden
files for `ApplyPolicy`, ISO weeks across New Year, rule order and overlap,
keep-within, unlimited values, the oldest-snapshot fallbacks, several backups
per day and per second, time zones and daylight saving, prune after every
backup versus once, command generation and the URL hash), Zigbee and Wi-Fi
channel planning (802.15.4 and 802.11 centre frequencies for every channel,
the 802.11n and 802.11b transmit masks, grade thresholds at their exact
edges, 20 versus 40 MHz and HT40+ versus HT40-, several access points,
hand-worked picks for 1/6/11, 1/5/9/13, one AP on 6 and 40 MHz on 1+5,
region channel sets, the channel 25/26 rules, Thread, invalid input and
the URL hash), SPF and DMARC records (the RFC 7208 grammar for every
mechanism, modifier, qualifier, CIDR suffix and macro, including the RFC's
own examples, IPv4 and IPv6 text forms, DNS-lookup counting across nested
includes and redirects with loops and the limit of 10, multiple records,
`+all`, `ptr`, redirect with all, every RFC 9989 tag with its default and
invalid values, the removed `pct`/`rf`/`ri`, report URIs with size
suffixes, external report authorization, dig/nslookup/zone-file input, both
generators, 255-octet splitting, zone-file quoting and the URL hash), IPv6
subnetting (every RFC 4291 text form including embedded IPv4, mixed case and
RFC 4007 zone IDs, the invalid forms, RFC 5952 output with the RFC's own
examples and its mixed-notation cases, ranges and counts for /0, /1, /48,
/56, /64, /127 and /128, subnet splits including a 2^128 split that is paged
rather than listed, nibble alignment, ip6.arpa names and zones, every IANA
special-purpose entry and its flags, address-space blocks and regional
registries, multicast scopes and groups, embedded IPv4, ULA generation from
`crypto.getRandomValues`, modified EUI-64 and the URL hash), Open Graph and
X card tags (tag output for every field and `og:type`, attribute escaping of
quotes, ampersands, angle brackets and non-ASCII text, `property` versus
`name`, relative, scheme-relative and scheme-less URLs, image sizes, file
sizes and types against the Meta, X and LinkedIn figures at their exact
edges, the X card choice and its Open Graph fallback, a head analyzer for
missing, duplicate and conflicting tags, structured `og:image` properties as
ogp.me groups them, http images on https pages, canonical versus `og:url`,
tags after the body or past 1 MB, round-trips from the analyzer back into the
generator and the URL hash), Traefik Docker labels (label output for every option, `$`
doubled for Compose and checked against Compose's interpolation rules, list
and map syntax, v3 versus v2 rule syntax and `ipAllowList`/`ipWhiteList`,
file-provider YAML decoded and compared with the labels, the htpasswd formats
Traefik accepts, name, domain, port, network and CIDR validation), WireGuard config generation (RFC 7748 X25519 vectors, generated
key pairs checked against `node:crypto`, `wg genkey` clamping and key format,
server/client key pairing, address allocation, configs the mobile apps
accept, no secrets in the URL), UTM link building (URL parsing, encoding
round-trips through the WHATWG URL parser, GA4 default-channel rules for every preset), TOML
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