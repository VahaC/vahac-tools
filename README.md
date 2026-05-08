# vahac-tools

A collection of web tools by Vahac. This repository contains standalone HTML/CSS/JavaScript utilities that can be run locally or used as a base for customization.

Main tools page:
- [vahac.com/tools](https://vahac.com/tools?utm_source=github)

## Project Structure

- `byte-storage-converter` - convert between SI/IEC storage units and calculate bitrate or file size.
- `image-compressor-resizer` - compress and resize images directly in the browser.
- `json-formatter` - format, validate, and clean JSON input.
- `password-passphrase-generator` - generate strong passwords and passphrases.
- `subnet-calculator` - calculate IP subnet details for planning and validation.
- `vcard-qr-code-generator` - build vCards and generate QR codes for contact sharing.

## Tool Overview

### 1) Byte and Storage Converter

Description:
- Converts values between Decimal (SI) and Binary (IEC) byte units.
- Includes Bitrate -> File Size and File Size -> Bitrate calculator modes.
- Supports quick copy for individual values and full result sets.

Path:
- `byte-storage-converter/index.html`

### 2) Image Compressor and Resizer

Description:
- Compresses image files on the client side.
- Resizes images while preserving quality controls.
- Keeps processing local in the browser.

Path:
- `image-compressor-resizer/index.html`

### 3) JSON Formatter and Validator

Description:
- Formats JSON for readability.
- Validates JSON syntax and helps detect input errors.
- Useful for debugging API payloads and config blocks.

Path:
- `json-formatter/index.html`

### 4) Password and Passphrase Generator

Description:
- Generates strong passwords and memorable passphrases.
- Allows control over complexity and length settings.
- Focused on practical account security improvement.

Path:
- `password-passphrase-generator/index.html`

### 5) IP Subnet Calculator

Description:
- Calculates network details: network address, broadcast address, host range, subnet mask, and CIDR.
- Helps quickly verify network segmentation and addressing plans.
- Useful for administration, DevOps workflows, and learning scenarios.

Path:
- `subnet-calculator/index.html`

### 6) vCard QR Code Generator

Description:
- Builds a vCard 3.0 payload from contact fields (name, company, title, phone, email, URL).
- Generates a QR code based on the vCard payload.
- Supports export to `VCF`, `PNG`, `SVG`, and clipboard copy.

Path:
- `vcard-qr-code-generator/index.html`

## Local Run

Since these are static tools, you can run them by opening the relevant `index.html` file in a browser.

Examples:
- `byte-storage-converter/index.html`
- `image-compressor-resizer/index.html`
- `json-formatter/index.html`
- `vcard-qr-code-generator/index.html`
- `subnet-calculator/index.html`
- `password-passphrase-generator/index.html`

## Styling Template

- `css-template.md` contains shared styling guidance and can be reused when adding or redesigning tools.