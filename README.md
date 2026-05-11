# vahac-tools

A collection of standalone browser tools by Vahac. Each utility is implemented with plain HTML, CSS, and JavaScript, so it can run locally without a backend.

Main tools page:
- [vahac.com/tools](https://vahac.com/tools?utm_source=github)

Documentation status:
- Last updated: 2026-05-11
- Scope synchronized with current repository structure

## Repository Structure

- `byte-storage-converter/` - SI/IEC storage unit conversion and bitrate/file size calculations.
- `chmod-file-permission-calculator/` - symbolic/octal permission conversion for Unix-like file modes.
- `cron-expression-generator/` - assisted cron expression builder for common scheduling patterns.
- `hash-generator-for-files-and-text/` - hash generation for text and uploaded files.
- `image-compressor-resizer/` - client-side image compression and resizing.
- `json-formatter/` - JSON formatting and validation.
- `password-passphrase-generator/` - secure password and passphrase generation.
- `subnet-calculator/` - IPv4 subnet calculation and network planning.
- `vcard-qr-code-generator/` - vCard data generation and QR export.
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

### 5) Image Compressor and Resizer

Path:
- `image-compressor-resizer/index.html`

Features:
- Compresses images client-side.
- Resizes images with quality control options.
- Keeps image processing local in the browser.

### 6) JSON Formatter and Validator

Path:
- `json-formatter/index.html`

Features:
- Formats JSON for readability.
- Validates JSON syntax.
- Helps debug API payloads and config blocks.

### 7) Password and Passphrase Generator

Path:
- `password-passphrase-generator/index.html`

Features:
- Generates strong passwords and passphrases.
- Allows control over complexity and length.
- Focused on practical account security improvements.

### 8) IP Subnet Calculator

Path:
- `subnet-calculator/index.html`

Features:
- Calculates network address, broadcast address, host range, subnet mask, and CIDR.
- Helps validate subnet segmentation and addressing plans.
- Useful for admin, DevOps, and networking study tasks.

### 9) vCard QR Code Generator

Path:
- `vcard-qr-code-generator/index.html`

Features:
- Builds vCard 3.0 payloads from contact fields.
- Generates QR codes from vCard data.
- Supports export to VCF, PNG, SVG, and clipboard copy.

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
- `http://localhost:8080/hash-generator-for-files-and-text/`
- `http://localhost:8080/image-compressor-resizer/`
- `http://localhost:8080/json-formatter/`
- `http://localhost:8080/password-passphrase-generator/`
- `http://localhost:8080/subnet-calculator/`
- `http://localhost:8080/vcard-qr-code-generator/`

## Notes

- All tools are frontend-only and designed for straightforward local execution.
- Use `css-template.md` as the baseline style guide when creating or redesigning a tool.