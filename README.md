# vahac-tools

A collection of standalone browser tools by Vahac. Each utility is implemented with plain HTML, CSS, and JavaScript, so it can run locally without a backend.

Main tools page:
- [vahac.com/tools](https://vahac.com/tools?utm_source=github)

Documentation status:
- Last updated: 2026-05-13
- Scope synchronized with current repository structure

## Repository Structure

- `byte-storage-converter/` - SI/IEC storage unit conversion and bitrate/file size calculations.
- `chmod-file-permission-calculator/` - symbolic/octal permission conversion for Unix-like file modes.
- `cron-expression-generator/` - assisted cron expression builder for common scheduling patterns.
- `docker-compose-validator-formatter/` - validation, formatting, and docker run to Compose conversion for Compose YAML.
- `favicon-generator/` - favicon pack generation (ICO and platform icons) from uploaded images.
- `hash-generator-for-files-and-text/` - hash generation for text and uploaded files.
- `image-compressor-resizer/` - client-side image compression and resizing.
- `json-formatter/` - JSON formatting and validation.
- `password-passphrase-generator/` - secure password and passphrase generation.
- `sla-calculator/` - uptime and downtime budget calculations for SLA targets.
- `subnet-calculator/` - IPv4 subnet calculation and network planning.
- `vcard-qr-code-generator/` - vCard data generation and QR export.
- `yaml-json-toml-converter/` - format conversion between YAML, JSON, and TOML.
- `css-template.md` - shared CSS/style guidance for tool pages.

## Tool Overview

### 1) Byte and Storage Converter

Path:
- `byte-storage-converter/index.html`

Features:
- Converts between Decimal (SI) and Binary (IEC) units.
- Includes Bitrate -> File Size and File Size -> Bitrate modes.
- Provides fast copy actions for outputs.

### 2) Chmod File Permission Calculator

Path:
- `chmod-file-permission-calculator/index.html`

Features:
- Converts permissions between symbolic and octal formats.
- Helps verify read/write/execute combinations for owner/group/others.
- Useful for server, DevOps, and terminal workflows.

### 3) Cron Expression Generator

Path:
- `cron-expression-generator/index.html`

Features:
- Builds cron expressions from guided input fields.
- Supports frequent scheduling patterns for automation tasks.
- Reduces manual errors when composing cron syntax.

### 4) Hash Generator for Files and Text

Path:
- `hash-generator-for-files-and-text/index.html`

Features:
- Generates hashes from plain text input and files.
- Useful for integrity checks and comparison workflows.
- Runs directly in the browser without server-side processing.

### 5) Docker Compose Validator and Formatter

Path:
- `docker-compose-validator-formatter/index.html`

Features:
- Validates Compose YAML structure and syntax directly in the browser.
- Formats Compose files for readability and consistency.
- Converts common `docker run` command patterns into Compose blocks.

### 6) Favicon Generator

Path:
- `favicon-generator/index.html`

Features:
- Generates favicon assets from uploaded source images.
- Exports common icon sizes and formats for modern platforms.
- Helps produce a ready-to-use favicon package and markup.

### 7) Image Compressor and Resizer

Path:
- `image-compressor-resizer/index.html`

Features:
- Compresses images client-side.
- Resizes images with quality control options.
- Keeps image processing local in the browser.

### 8) JSON Formatter and Validator

Path:
- `json-formatter/index.html`

Features:
- Formats JSON for readability.
- Validates JSON syntax.
- Helps debug API payloads and config blocks.

### 9) Password and Passphrase Generator

Path:
- `password-passphrase-generator/index.html`

Features:
- Generates strong passwords and passphrases.
- Allows control over complexity and length.
- Focused on practical account security improvements.

### 10) Uptime / SLA Calculator

Path:
- `sla-calculator/index.html`

Features:
- Converts SLA percentages into allowed downtime windows.
- Supports yearly, monthly, weekly, and daily breakdowns.
- Includes reverse calculations from known downtime budgets.

### 11) IP Subnet Calculator

Path:
- `subnet-calculator/index.html`

Features:
- Calculates network address, broadcast address, host range, subnet mask, and CIDR.
- Helps validate subnet segmentation and addressing plans.
- Useful for admin, DevOps, and networking study tasks.

### 12) vCard QR Code Generator

Path:
- `vcard-qr-code-generator/index.html`

Features:
- Builds vCard 3.0 payloads from contact fields.
- Generates QR codes from vCard data.
- Supports export to VCF, PNG, SVG, and clipboard copy.

### 13) YAML JSON TOML Converter

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
- `http://localhost:8080/byte-storage-converter/`
- `http://localhost:8080/chmod-file-permission-calculator/`
- `http://localhost:8080/cron-expression-generator/`
- `http://localhost:8080/docker-compose-validator-formatter/`
- `http://localhost:8080/favicon-generator/`
- `http://localhost:8080/hash-generator-for-files-and-text/`
- `http://localhost:8080/image-compressor-resizer/`
- `http://localhost:8080/json-formatter/`
- `http://localhost:8080/password-passphrase-generator/`
- `http://localhost:8080/sla-calculator/`
- `http://localhost:8080/subnet-calculator/`
- `http://localhost:8080/vcard-qr-code-generator/`
- `http://localhost:8080/yaml-json-toml-converter/`

## Tests

The repository ships with a unit-test suite covering the core logic of every
tool (163 tests across 10 modules), powered by the built-in Node.js test runner
— no external dependencies required.

Requirements: Node.js 20 or newer.

```powershell
npm test
```

The suite covers byte/storage conversion, chmod permissions, cron parsing and
scheduling, SLA downtime maths, IPv4 subnetting, JSON formatting and stats,
password/passphrase entropy, vCard generation, TOML round-tripping, and MD5
hashing (verified against `node:crypto`).

Tests run on demand via GitHub Actions
(`.github/workflows/test.yml`) — the workflow uses `workflow_dispatch` only, so
nothing executes automatically on push or pull request. Trigger it manually
from the **Actions** tab in GitHub ("Run workflow"); inputs let you pick a
specific Node version (20 / 22) or runner OS (Ubuntu / Windows / macOS), or
leave both blank to run the full matrix.

## Notes

- All tools are frontend-only and designed for straightforward local execution.
- Use `css-template.md` as the baseline style guide when creating or redesigning a tool.