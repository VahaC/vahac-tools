// ESP32 GPIO Pin Picker — script.js
// Prefix: egp-
// Dependencies: none.
//
// Pin data was transcribed by hand from primary sources and cross-checked on 2026-10-26:
// - Espressif chip datasheets: ESP32 Series v5.3 (2026-07), ESP32-S3 Series v2.2 (2026-03-05),
//   ESP32-C3 Series v2.4 (2026-05-06), ESP32-C6 Series v1.5 (2026-03-31). Pin overview,
//   IO MUX, RTC / LP IO MUX and analog function tables, GPIO restrictions, peripheral pin
//   assignment priorities, flash/PSRAM pin mapping and boot configuration (strapping) tables.
// - ESP-IDF Programming Guide, "GPIO & RTC GPIO" page per target (latest/master, read
//   2026-10-26): GPIO list, SPI0/1, USB-JTAG, JTAG, input-only and ADC2 notes. "ADC Oneshot
//   Mode Driver" page per target: ADC2 hardware limitations. "Sleep Modes" page: wake sources.
// - ESPHome 2026.10.0 source: esphome/components/esp32/gpio_esp32*.py (pin validation),
//   esphome/pins.py (check_strapping_pin), adc/__init__.py (ADC channel maps),
//   esp32_touch/__init__.py (touch pads), deep_sleep/__init__.py (wake pins),
//   esp32_dac/output.py (DAC pins). ESPHome docs: pin schema, FAQ on strapping pins, logger.
// - Espressif module datasheets (which pins a module leads out): ESP32-WROOM-32E v2.1,
//   ESP32-WROVER-E v2.4, ESP32-S3-WROOM-1 v1.8, ESP32-C3-MINI-1 v2.2, ESP32-C6-WROOM-1 v1.4,
//   ESP32-C6-MINI-1 v1.5.
// Where sources disagree the stricter verdict wins, and the pin's note says why.
//
// This is chip-level data. A dev board may wire any pin to a boot button, an LED, a USB-UART
// bridge or a sensor, so the board schematic always has the last word.

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function range(a, b) {
    var r = [];
    for (var i = a; i <= b; i++) r.push(i);
    return r;
  }

  function toMap(list, value) {
    var m = {};
    list.forEach(function (n) { m[n] = value; });
    return m;
  }

  // ── Verdict levels ──────────────────────────────────────

  var LEVELS = ['safe', 'care', 'avoid', 'no', 'na'];
  var LEVEL_LABEL = {
    safe: 'Safe',
    care: 'Use with care',
    avoid: 'Avoid',
    no: 'Can\'t do this',
    na: 'Not available'
  };
  var SEV_RANK = { info: -1, ok: -1, safe: 0, care: 1, avoid: 2, no: 3, na: 4 };

  // ── Needs (filters) ─────────────────────────────────────

  var NEEDS = [
    { id: 'io', label: 'Digital I/O', hint: 'Relay, LED, button: input and output' },
    { id: 'in', label: 'Digital input', hint: 'Button, reed switch, PIR, pulse counter' },
    { id: 'i2c', label: 'I2C', hint: 'SDA / SCL through the GPIO matrix' },
    { id: 'spi', label: 'SPI', hint: 'CLK / MOSI / MISO / CS through the GPIO matrix' },
    { id: 'uart', label: 'UART', hint: 'TX / RX through the GPIO matrix' },
    { id: 'pwm', label: 'PWM', hint: 'LEDC output: dimmer, fan, servo' },
    { id: 'adc', label: 'ADC', hint: 'Analog voltage input' },
    { id: 'touch', label: 'Touch', hint: 'Capacitive touch pad' },
    { id: 'wake', label: 'Deep-sleep wake', hint: 'Wake the chip from deep sleep' },
    { id: 'dac', label: 'DAC', hint: 'Analog voltage output' }
  ];
  var NEED_IDS = NEEDS.map(function (n) { return n.id; });

  // ── Sources ─────────────────────────────────────────────

  var IDF_BASE = 'https://docs.espressif.com/projects/esp-idf/en/latest/';
  var EH_BASE = 'https://github.com/esphome/esphome/blob/2026.10.0/esphome/components/';
  var DOC_BASE = 'https://www.espressif.com/sites/default/files/documentation/';

  function idfSources(target, label) {
    return [
      { id: 'idf', title: 'ESP-IDF: GPIO & RTC GPIO (' + label + ')', version: 'latest (master), read 2026-10-26',
        url: IDF_BASE + target + '/api-reference/peripherals/gpio.html',
        used: 'GPIO list, SPI0/1 flash pins, USB-JTAG, JTAG, input-only and ADC2 notes' },
      { id: 'idfadc', title: 'ESP-IDF: ADC Oneshot Mode Driver (' + label + ')', version: 'latest (master), read 2026-10-26',
        url: IDF_BASE + target + '/api-reference/peripherals/adc/adc_oneshot.html',
        used: 'ADC2 hardware limitations' },
      { id: 'idfsleep', title: 'ESP-IDF: Sleep Modes (' + label + ')', version: 'latest (master), read 2026-10-26',
        url: IDF_BASE + target + '/api-reference/system/sleep_modes.html',
        used: 'Which pins can wake the chip from deep sleep' }
    ];
  }

  function ehSources(file) {
    return [
      { id: 'eh', title: 'ESPHome pin validation: ' + file, version: 'ESPHome 2026.10.0',
        url: EH_BASE + 'esp32/' + file,
        used: 'Strapping, flash/PSRAM, USB-JTAG and input-only pins ESPHome checks' },
      { id: 'ehx', title: 'ESPHome adc, esp32_touch, deep_sleep and esp32_dac components', version: 'ESPHome 2026.10.0',
        url: EH_BASE + 'adc/__init__.py',
        used: 'ADC channel maps, touch pads, deep-sleep wake pins and DAC pins ESPHome accepts' },
      { id: 'ehdoc', title: 'ESPHome docs: pin schema and FAQ on strapping pins', version: 'esphome.io, read 2026-10-26',
        url: 'https://esphome.io/guides/configuration-types/#pin-schema',
        used: 'ignore_strapping_warning, ignore_pin_validation_error, I2C on strapping pins' }
    ];
  }

  // ── Chip data ───────────────────────────────────────────
  // Each map is keyed by GPIO number. Every value comes from the datasheet table named in the
  // comment above it; tests/esp32-gpio-pin-picker.test.js holds an independent transcription.

  var CHIPS = {};

  CHIPS.esp32 = {
    id: 'esp32',
    label: 'ESP32',
    // Datasheet v5.3 Table 2-1; ESP-IDF: "34 physical GPIO pins (GPIO0 ~ GPIO19, GPIO21 ~ GPIO23,
    // GPIO25 ~ GPIO27, and GPIO32 ~ GPIO39)"
    gpios: range(0, 19).concat([21, 22, 23, 25, 26, 27]).concat(range(32, 39)),
    pinNames: {
      1: 'U0TXD', 3: 'U0RXD', 6: 'SD_CLK', 7: 'SD_DATA_0', 8: 'SD_DATA_1', 9: 'SD_DATA_2', 10: 'SD_DATA_3',
      11: 'SD_CMD', 12: 'MTDI', 13: 'MTCK', 14: 'MTMS', 15: 'MTDO', 32: '32K_XP', 33: '32K_XN',
      34: 'VDET_1', 35: 'VDET_2', 36: 'SENSOR_VP', 37: 'SENSOR_CAPP', 38: 'SENSOR_CAPN', 39: 'SENSOR_VN'
    },
    // Datasheet Table 4-6 (Peripheral Pin Configurations) and Table 2-1
    adc1: { 36: 0, 37: 1, 38: 2, 39: 3, 32: 4, 33: 5, 34: 6, 35: 7 },
    adc2: { 4: 0, 0: 1, 2: 2, 15: 3, 13: 4, 12: 5, 14: 6, 27: 7, 25: 8, 26: 9 },
    // Datasheet Table 4-5 (Capacitive-Sensing GPIOs)
    touch: { 4: 0, 0: 1, 2: 2, 15: 3, 13: 4, 12: 5, 14: 6, 27: 7, 33: 8, 32: 9 },
    touchLabel: 'T',
    // Datasheet Table 2-1 RTC_GPIO numbers; Table 6-1 note 5: RTC GPIOs can wake the chip from Deep-sleep
    rtc: { 36: 0, 37: 1, 38: 2, 39: 3, 34: 4, 35: 5, 25: 6, 26: 7, 33: 8, 32: 9, 4: 10, 0: 11, 2: 12, 15: 13, 13: 14, 12: 15, 14: 16, 27: 17 },
    rtcLabel: 'RTC_GPIO',
    // Datasheet section 4.9.2 and Table 4-6: DAC_1 on GPIO25, DAC_2 on GPIO26
    dac: { 25: 1, 26: 2 },
    // Datasheet Table 6-1 note 2: GPIO34-39 are input-only, no output driver, no pull-up/pull-down
    inputOnly: range(34, 39),
    usb: {},
    uart0: { 1: 'TX', 3: 'RX' },
    jtag: { 12: 'MTDI', 13: 'MTCK', 14: 'MTMS', 15: 'MTDO' },
    xtal32k: { 32: 'P', 33: 'N' },
    vddSpi: {},
    strapHoldMs: 1,
    // Datasheet section 3, Tables 3-1 to 3-5
    strapping: {
      0: { what: 'Boot mode (with GPIO2)', def: 'internal pull-up (1)', w: 4,
        level: 'Must be high at reset for a normal boot. Held low at reset (with GPIO2 low) it starts the serial download mode.' },
      2: { what: 'Boot mode (with GPIO0)', def: 'internal pull-down (0)', w: 3,
        level: 'Ignored for a normal boot, but it must be low or floating when you flash over serial: download mode needs GPIO0 and GPIO2 low.' },
      5: { what: 'SDIO slave timing (with GPIO15)', def: 'internal pull-up (1)', w: 2,
        level: 'Only matters if you use the SDIO slave interface.' },
      12: { what: 'Flash supply voltage (VDD_SDIO)', def: 'internal pull-down (0)', w: 6,
        level: 'Must be low at reset: high switches VDD_SDIO, the flash supply, to 1.8 V, which a 3.3 V flash cannot run on (unless the EFUSE_SDIO_FORCE eFuse is burned).' },
      15: { what: 'ROM boot log on U0TXD, SDIO slave timing (with GPIO5)', def: 'internal pull-up (1)', w: 2,
        level: 'High at reset prints the ROM boot log, low silences it. Either level boots.' }
    },
    // ESP-IDF GPIO page notes and ESP32 Series SoC Errata GPIO-3.11
    pinNotes: {
      25: [{ sev: 'info', src: 'ds', text: 'DAC_1 in the datasheet is DAC channel 0 in ESP-IDF (DAC0).' }],
      26: [{ sev: 'info', src: 'ds', text: 'DAC_2 in the datasheet is DAC channel 1 in ESP-IDF (DAC1).' }],
      37: [{ sev: 'info', src: 'mod', text: 'Not led out on ESP32-WROOM-32E or ESP32-WROVER-E modules (their pin tables list only SENSOR_VP and SENSOR_VN).' }],
      38: [{ sev: 'info', src: 'mod', text: 'Not led out on ESP32-WROOM-32E or ESP32-WROVER-E modules (their pin tables list only SENSOR_VP and SENSOR_VN).' }]
    },
    // ESP-IDF: "Please do not use the interrupt of GPIO36 and GPIO39 when using ADC or Wi-Fi and
    // Bluetooth with sleep mode enabled" (Errata GPIO-3.11)
    interruptIssue: [36, 39],
    safeText: 'Free GPIO: no boot, flash, UART0 or debug role on the ESP32.',
    modules: [
      { id: 'unknown', label: 'Not sure (assume the strictest)',
        hint: 'Treats GPIO16 and GPIO17 as taken, as on modules with PSRAM. Pick your module to free them.',
        mem: { 6: 'flash SPICLK', 7: 'flash SPIQ', 8: 'flash SPID', 9: 'flash SPIHD', 10: 'flash SPIWP', 11: 'flash SPICS0',
          16: 'PSRAM CE# on modules with PSRAM (in-package flash CS# on ESP32-U4WDH)', 17: 'PSRAM SCLK on ESP32-WROVER-E type modules (in-package flash on ESP32-U4WDH)' },
        src: 'idf' },
      { id: 'flash', label: 'External flash, no PSRAM (ESP32-D0WD-V3, e.g. ESP32-WROOM-32E-N4/N8/N16)',
        hint: 'GPIO6 to GPIO11 go to the SPI flash; on WROOM-32E modules they are not led out at all.',
        mem: { 6: 'flash SPICLK', 7: 'flash SPIQ', 8: 'flash SPID', 9: 'flash SPIHD', 10: 'flash SPIWP', 11: 'flash SPICS0' },
        freeNotes: {
          16: 'Free without PSRAM. ESP-IDF lists GPIO16/17 as SPI0/1 pins because modules with PSRAM use them (datasheet Table 2-6).',
          17: 'Free without PSRAM. ESP-IDF lists GPIO16/17 as SPI0/1 pins because modules with PSRAM use them (datasheet Table 2-6).'
        },
        src: 'ds' },
      { id: 'psram', label: 'External flash and PSRAM (e.g. ESP32-WROVER-E / WROVER-IE)',
        hint: 'The PSRAM uses GPIO16 (CE#) and GPIO17 (SCLK); WROVER-E does not lead these two pins out.',
        mem: { 6: 'flash SPICLK', 7: 'flash SPIQ', 8: 'flash SPID', 9: 'flash SPIHD', 10: 'flash SPIWP', 11: 'flash SPICS0',
          16: 'PSRAM CE#', 17: 'PSRAM SCLK' },
        src: 'ds' },
      { id: 'pkgpsram', label: 'In-package PSRAM (ESP32-D0WDR2-V3 / D0WDRH2-V3, e.g. ESP32-WROOM-32E-N4R2)',
        hint: 'The in-package PSRAM uses GPIO16 as CE# and takes its clock from SD_CLK, so GPIO17 stays free.',
        mem: { 6: 'flash SPICLK, PSRAM SCLK', 7: 'flash SPIQ, PSRAM SIO1', 8: 'flash SPID, PSRAM SIO0', 9: 'flash SPIHD, PSRAM SIO3',
          10: 'flash SPIWP, PSRAM SIO2', 11: 'flash SPICS0', 16: 'PSRAM CE#' },
        freeNotes: { 17: 'Free here: the in-package PSRAM takes its clock from SD_CLK, not GPIO17 (datasheet Table 2-5).' },
        src: 'ds' },
      { id: 'u4wdh', label: 'In-package flash (ESP32-U4WDH)',
        hint: 'The in-package flash uses GPIO6, 7, 8, 11, 16 and 17 (datasheet Table 2-5); GPIO9 and GPIO10 are not part of it.',
        mem: { 6: 'in-package flash CLK', 7: 'in-package flash IO2/WP#', 8: 'in-package flash IO0/DI', 11: 'in-package flash IO3/HOLD#',
          16: 'in-package flash CS#', 17: 'in-package flash IO1/DO' },
        // ESPHome warns on 9-10 for every ESP32 ("might already be used by the flash interface in QUAD IO flash mode")
        careNotes: { 9: 'Not used by the in-package flash of the ESP32-U4WDH (datasheet Table 2-5), but ESPHome warns on GPIO9 and GPIO10 for every ESP32 because most modules wire them to a quad flash. Stricter verdict shown.',
          10: 'Not used by the in-package flash of the ESP32-U4WDH (datasheet Table 2-5), but ESPHome warns on GPIO9 and GPIO10 for every ESP32 because most modules wire them to a quad flash. Stricter verdict shown.' },
        src: 'ds' }
    ],
    sources: [
      { id: 'ds', title: 'ESP32 Series Datasheet', version: 'v5.3 (2026-07)', url: DOC_BASE + 'esp32_datasheet_en.pdf',
        used: 'Pin overview (Table 2-1), restrictions (2.3.1), flash/PSRAM pin mapping (Tables 2-5, 2-6), strapping pins (Tables 3-1 to 3-5), ADC, DAC and touch pins (Tables 4-5, 4-6), pin-list notes (Table 6-1)' }
    ].concat(idfSources('esp32', 'ESP32')).concat(ehSources('gpio_esp32.py')).concat([
      { id: 'mod', title: 'ESP32-WROOM-32E & WROOM-32UE / ESP32-WROVER-E & WROVER-IE datasheets', version: 'v2.1 / v2.4',
        url: DOC_BASE + 'esp32-wroom-32e_esp32-wroom-32ue_datasheet_en.pdf',
        used: 'Which pins the modules lead out; PSRAM on GPIO16/GPIO17' }
    ]),
    // ESPHome 2026.10.0 esphome/components/esp32/gpio_esp32.py
    esphome: {
      maxPin: 39,
      strapping: [0, 2, 5, 12, 15],
      errorPins: { 6: 'flash', 7: 'flash', 8: 'flash', 11: 'flash', 24: 'unusable', 28: 'unusable', 29: 'unusable', 30: 'unusable', 31: 'unusable' },
      warnPins: { 9: 'flash-qio', 10: 'flash-qio' },
      usbJtag: [],
      inputOnly: range(34, 39),
      octalWarn: [],
      file: 'gpio_esp32.py'
    }
  };

  CHIPS.esp32s3 = {
    id: 'esp32s3',
    label: 'ESP32-S3',
    // Datasheet v2.2 Table 2-4; ESP-IDF: "45 physical GPIO pins (GPIO0 ~ GPIO21 and GPIO26 ~ GPIO48)"
    gpios: range(0, 21).concat(range(26, 48)),
    pinNames: {
      15: 'XTAL_32K_P', 16: 'XTAL_32K_N', 26: 'SPICS1', 27: 'SPIHD', 28: 'SPIWP', 29: 'SPICS0', 30: 'SPICLK',
      31: 'SPIQ', 32: 'SPID', 39: 'MTCK', 40: 'MTDO', 41: 'MTDI', 42: 'MTMS', 43: 'U0TXD', 44: 'U0RXD',
      47: 'SPICLK_P', 48: 'SPICLK_N'
    },
    // Datasheet Table 2-8 (Analog Functions)
    adc1: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9 },
    adc2: { 11: 0, 12: 1, 13: 2, 14: 3, 15: 4, 16: 5, 17: 6, 18: 7, 19: 8, 20: 9 },
    touch: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 14 },
    touchLabel: 'TOUCH',
    // Datasheet Table 2-6 (RTC Functions): RTC_GPIO0-21 on GPIO0-21
    rtc: (function () { var m = {}; range(0, 21).forEach(function (n) { m[n] = n; }); return m; })(),
    rtcLabel: 'RTC_GPIO',
    dac: {},
    inputOnly: [],
    // Datasheet Table 2-8: USB_D- on GPIO19, USB_D+ on GPIO20 (USB OTG and USB Serial/JTAG)
    usb: { 19: 'D-', 20: 'D+' },
    uart0: { 43: 'TX', 44: 'RX' },
    jtag: { 39: 'MTCK', 40: 'MTDO', 41: 'MTDI', 42: 'MTMS' },
    xtal32k: { 15: 'P', 16: 'N' },
    vddSpi: {},
    strapHoldMs: 3,
    // Datasheet section 3, Tables 3-1, 3-3, 3-4, 3-5
    strapping: {
      0: { what: 'Boot mode (with GPIO46)', def: 'internal pull-up (1)', w: 4,
        level: 'Must be high at reset for a normal boot. Held low at reset (with GPIO46 low) it starts download mode over USB or UART.' },
      3: { what: 'JTAG signal source', def: 'floating, no internal pull resistor', w: 2,
        level: 'Ignored unless the EFUSE_STRAP_JTAG_SEL eFuse is burned (not burned by default).' },
      45: { what: 'Flash/PSRAM supply voltage (VDD_SPI)', def: 'internal pull-down (0)', w: 5,
        level: 'Keep it low at reset on chips with 3.3 V flash or PSRAM: high selects a 1.8 V VDD_SPI, unless the EFUSE_VDD_SPI_FORCE eFuse is burned.' },
      46: { what: 'Boot mode (with GPIO0), ROM message printing', def: 'internal pull-down (0)', w: 3,
        level: 'Ignored for a normal boot; it must be low for download mode.' }
    },
    pinNotes: (function () {
      // Datasheet Table 2-2 (Power-Up Glitches on Pins)
      var notes = {};
      range(1, 17).forEach(function (n) {
        notes[n] = [{ sev: 'info', src: 'ds', text: 'Driven low for about 60 µs at power-up (datasheet Table 2-2). Harmless for most loads, but keep it in mind for anything that reacts to short pulses.' }];
      });
      notes[18] = [{ sev: 'info', src: 'ds', text: 'Has a low-level and a high-level glitch of about 60 µs each at power-up (datasheet Table 2-2).' }];
      notes[19] = [{ sev: 'info', src: 'ds', text: 'Shows two high-level glitches of about 60 µs at power-up, spread over about 3.2 ms (datasheet Table 2-2).' }];
      notes[20] = [{ sev: 'info', src: 'ds', text: 'Shows a pull-down glitch and two high-level glitches at power-up, spread over about 2 ms (datasheet Table 2-2).' }];
      return notes;
    })(),
    interruptIssue: [],
    safeText: 'Free GPIO: no boot, flash, USB, UART0 or debug role on the ESP32-S3.',
    modules: [
      { id: 'unknown', label: 'Not sure (assume the strictest)',
        hint: 'Treats GPIO33 to GPIO37 as taken, as on chips with octal PSRAM or flash, and warns that GPIO47/48 run at 1.8 V on 1.8 V chips.',
        mem: { 26: 'SPI0/1 bus as SPICS1 (the PSRAM chip select)', 27: 'flash/PSRAM SPIHD', 28: 'flash/PSRAM SPIWP', 29: 'flash CS# (SPICS0)', 30: 'flash/PSRAM SPICLK', 31: 'flash/PSRAM SPIQ', 32: 'flash/PSRAM SPID',
          33: 'SPIIO4 on octal PSRAM/flash chips', 34: 'SPIIO5 on octal PSRAM/flash chips', 35: 'SPIIO6 on octal PSRAM/flash chips', 36: 'SPIIO7 on octal PSRAM/flash chips', 37: 'SPIDQS on octal PSRAM/flash chips' },
        v18: { 47: true, 48: true },
        src: 'idf' },
      { id: 'quad', label: 'Quad SPI flash/PSRAM only (e.g. ESP32-S3FN8, S3FH4R2, S3RH2; WROOM-1 N4, N8, N16, N…R2)',
        hint: 'GPIO26 to GPIO32 carry the quad SPI flash/PSRAM; GPIO33 to GPIO37 stay free.',
        mem: { 26: 'SPI0/1 bus as SPICS1 (the PSRAM chip select)', 27: 'flash/PSRAM SPIHD', 28: 'flash/PSRAM SPIWP', 29: 'flash CS# (SPICS0)', 30: 'flash/PSRAM SPICLK', 31: 'flash/PSRAM SPIQ', 32: 'flash/PSRAM SPID' },
        freeNotes: (function () {
          var n = {};
          range(33, 37).forEach(function (g) { n[g] = 'Free here because the flash/PSRAM is quad SPI. On chips with octal PSRAM or octal flash this pin carries SPIIO4–7/SPIDQS (datasheet Table 2-14).'; });
          return n;
        })(),
        src: 'ds' },
      { id: 'octal', label: 'Octal PSRAM or flash at 3.3 V (ESP32-S3R8; e.g. WROOM-1 N4R8, N8R8, N16R8)',
        hint: 'Octal mode also takes GPIO33 to GPIO37 (SPIIO4–SPIIO7, SPIDQS).',
        mem: { 26: 'SPI0/1 bus as SPICS1 (the PSRAM chip select)', 27: 'flash/PSRAM SPIHD', 28: 'flash/PSRAM SPIWP', 29: 'flash CS# (SPICS0)', 30: 'flash/PSRAM SPICLK', 31: 'flash/PSRAM SPIQ', 32: 'flash/PSRAM SPID',
          33: 'octal SPIIO4', 34: 'octal SPIIO5', 35: 'octal SPIIO6', 36: 'octal SPIIO7', 37: 'octal SPIDQS' },
        src: 'ds' },
      { id: 'octal18', label: 'Octal PSRAM, 1.8 V VDD_SPI (ESP32-S3R16V, S3R8V; e.g. WROOM-1 N16R16VA)',
        hint: 'Like octal at 3.3 V, and GPIO47/GPIO48 also run at 1.8 V on these chips.',
        mem: { 26: 'SPI0/1 bus as SPICS1 (the PSRAM chip select)', 27: 'flash/PSRAM SPIHD', 28: 'flash/PSRAM SPIWP', 29: 'flash CS# (SPICS0)', 30: 'flash/PSRAM SPICLK', 31: 'flash/PSRAM SPIQ', 32: 'flash/PSRAM SPID',
          33: 'octal SPIIO4', 34: 'octal SPIIO5', 35: 'octal SPIIO6', 36: 'octal SPIIO7', 37: 'octal SPIDQS' },
        v18: { 47: true, 48: true },
        src: 'ds' }
    ],
    sources: [
      { id: 'ds', title: 'ESP32-S3 Series Datasheet', version: 'v2.2 (2026-03-05)', url: DOC_BASE + 'esp32-s3_datasheet_en.pdf',
        used: 'Pin overview (Table 2-1), power-up glitches (Table 2-2), IO MUX, RTC and analog functions (Tables 2-4, 2-6, 2-8), restrictions and pin priorities (2.3.4, 2.3.5), flash/PSRAM pin mapping (Table 2-14), strapping pins (Tables 3-1 to 3-5)' }
    ].concat(idfSources('esp32s3', 'ESP32-S3')).concat(ehSources('gpio_esp32_s3.py')).concat([
      { id: 'mod', title: 'ESP32-S3-WROOM-1 & WROOM-1U datasheet', version: 'v1.8', url: DOC_BASE + 'esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf',
        used: 'Which module variants carry quad or octal PSRAM, and 1.8 V on GPIO47/48' }
    ]),
    // ESPHome 2026.10.0 esphome/components/esp32/gpio_esp32_s3.py
    esphome: {
      maxPin: 48,
      strapping: [0, 3, 45, 46],
      errorPins: { 26: 'flash', 27: 'flash', 28: 'flash', 29: 'flash', 30: 'flash', 31: 'flash', 32: 'flash', 22: 'unusable', 23: 'unusable', 24: 'unusable', 25: 'unusable' },
      warnPins: {},
      usbJtag: [19, 20],
      inputOnly: [],
      octalWarn: [33, 34, 35, 36, 37],
      file: 'gpio_esp32_s3.py'
    }
  };

  CHIPS.esp32c3 = {
    id: 'esp32c3',
    label: 'ESP32-C3',
    // Datasheet v2.4 Table 2-4; ESP-IDF: "22 physical GPIO pins (GPIO0 ~ GPIO21)"
    gpios: range(0, 21),
    pinNames: {
      0: 'XTAL_32K_P', 1: 'XTAL_32K_N', 4: 'MTMS', 5: 'MTDI', 6: 'MTCK', 7: 'MTDO', 11: 'VDD_SPI', 12: 'SPIHD',
      13: 'SPIWP', 14: 'SPICS0', 15: 'SPICLK', 16: 'SPID', 17: 'SPIQ', 20: 'U0RXD', 21: 'U0TXD'
    },
    // Datasheet Table 2-6 (Analog Functions)
    adc1: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 },
    adc2: { 5: 0 },
    touch: {},
    touchLabel: 'TOUCH',
    // ESP-IDF GPIO page: "GPIO0 ~ GPIO5 can be used to wake up the chip from Deep-sleep mode"
    // (the VDD3P3_RTC domain pins in datasheet Table 2-1)
    rtc: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 },
    rtcLabel: 'RTC',
    dac: {},
    inputOnly: [],
    usb: { 18: 'D-', 19: 'D+' },
    uart0: { 21: 'TX', 20: 'RX' },
    jtag: { 4: 'MTMS', 5: 'MTDI', 6: 'MTCK', 7: 'MTDO' },
    xtal32k: { 0: 'P', 1: 'N' },
    // Datasheet Table 2-1 note 8 and section 2.3.4: GPIO11 is the VDD_SPI pin
    vddSpi: { 11: 'The VDD_SPI pin: it powers the in-package or off-package flash by default and can only become a GPIO if the chip has an off-package flash with its own power supply (datasheet Table 2-1 note 8).' },
    strapHoldMs: 3,
    // Datasheet section 3, Tables 3-1, 3-3, 3-4
    strapping: {
      2: { what: 'Boot mode (with GPIO8 and GPIO9)', def: 'floating', w: 2,
        level: 'The datasheet says it does not actually decide the boot mode, but recommends pulling it up because of glitches.' },
      8: { what: 'Boot mode (with GPIO9), ROM log on UART0', def: 'floating', w: 3,
        level: 'Any level for a normal boot; it must be high for download mode.' },
      9: { what: 'Boot mode', def: 'internal pull-up (1)', w: 4,
        level: 'Must be high at reset for a normal boot. Held low at reset it starts download mode.' }
    },
    // Datasheet Table 2-2 (Power-Up Glitches on Pins)
    pinNotes: {
      6: [{ sev: 'info', src: 'ds', text: 'Driven low for about 5 ns at power-up (datasheet Table 2-2).' }],
      7: [{ sev: 'info', src: 'ds', text: 'Driven low for about 5 ns at power-up (datasheet Table 2-2).' }],
      10: [{ sev: 'info', src: 'ds', text: 'Driven low for about 5 ns at power-up (datasheet Table 2-2).' }],
      18: [{ sev: 'info', src: 'ds', text: 'Driven high for about 50 µs at power-up (datasheet Table 2-2): mind this for relays or MOSFET gates.' }],
      20: [{ sev: 'info', src: 'ds', text: 'Driven low for about 5 ns at power-up (datasheet Table 2-2).' }]
    },
    interruptIssue: [],
    safeText: 'Free GPIO: no boot, flash, USB, UART0 or debug role on the ESP32-C3.',
    modules: [
      { id: 'unknown', label: 'Not sure (assume the strictest)',
        hint: 'Same verdicts as the 22-GPIO variants: GPIO12 to GPIO17 belong to the flash.',
        mem: { 12: 'flash SPIHD', 13: 'flash SPIWP', 14: 'flash SPICS0', 15: 'flash SPICLK', 16: 'flash SPID', 17: 'flash SPIQ' },
        vddSpi: true,
        src: 'ds' },
      { id: 'p22', label: '22 GPIOs: ESP32-C3 (external flash), C3FH4, C3FN4 or C3FH8X',
        hint: 'GPIO12 to GPIO17 are bonded out but connected to the in-package or off-package flash. ESP32-C3-MINI-1 modules ship with either kind of chip: check the chip marking.',
        mem: { 12: 'flash SPIHD', 13: 'flash SPIWP', 14: 'flash SPICS0', 15: 'flash SPICLK', 16: 'flash SPID', 17: 'flash SPIQ' },
        vddSpi: true,
        src: 'ds' },
      { id: 'p16', label: '16 GPIOs: ESP32-C3FH4X or C3FH4AZ',
        hint: 'The SPI flash pins (GPIO12 to GPIO17) are not bonded on these chips. ESP32-C3-MINI-1 modules ship with either kind of chip: check the chip marking.',
        notBonded: { 12: true, 13: true, 14: true, 15: true, 16: true, 17: true },
        vddSpi: true,
        src: 'ds' }
    ],
    sources: [
      { id: 'ds', title: 'ESP32-C3 Series Datasheet', version: 'v2.4 (2026-05-06)', url: DOC_BASE + 'esp32-c3_datasheet_en.pdf',
        used: 'Variants and GPIO counts (Table 1-1), pin overview (Table 2-1), power-up glitches (Table 2-2), IO MUX and analog functions (Tables 2-4, 2-6), restrictions and pin priorities (2.3.3, 2.3.4), flash pin mapping (Table 2-12), strapping pins (Tables 3-1, 3-3, 3-4)' }
    ].concat(idfSources('esp32c3', 'ESP32-C3')).concat(ehSources('gpio_esp32_c3.py')).concat([
      { id: 'mod', title: 'ESP32-C3-MINI-1 & MINI-1U datasheet', version: 'v2.2', url: DOC_BASE + 'esp32-c3-mini-1_datasheet_en.pdf',
        used: 'Which C3 chip variants the module uses' }
    ]),
    // ESPHome 2026.10.0 esphome/components/esp32/gpio_esp32_c3.py
    esphome: {
      maxPin: 21,
      strapping: [2, 8, 9],
      errorPins: { 12: 'flash', 13: 'flash', 14: 'flash', 15: 'flash', 16: 'flash', 17: 'flash' },
      warnPins: {},
      usbJtag: [18, 19],
      inputOnly: [],
      octalWarn: [],
      file: 'gpio_esp32_c3.py'
    }
  };

  CHIPS.esp32c6 = {
    id: 'esp32c6',
    label: 'ESP32-C6',
    // Datasheet v1.5 Tables 2-4 and 2-5; ESP-IDF: "31 physical GPIO pins (GPIO0 ~ GPIO30)"
    gpios: range(0, 30),
    pinNames: {
      0: 'XTAL_32K_P', 1: 'XTAL_32K_N', 4: 'MTMS', 5: 'MTDI', 6: 'MTCK', 7: 'MTDO', 16: 'U0TXD', 17: 'U0RXD',
      18: 'SDIO_CMD', 19: 'SDIO_CLK', 20: 'SDIO_DATA0', 21: 'SDIO_DATA1', 22: 'SDIO_DATA2', 23: 'SDIO_DATA3',
      24: 'SPICS0', 25: 'SPIQ', 26: 'SPIWP', 27: 'VDD_SPI', 28: 'SPIHD', 29: 'SPICLK', 30: 'SPID'
    },
    // Datasheet Table 2-9 (Analog Functions); the C6 has no ADC2
    adc1: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 },
    adc2: {},
    touch: {},
    touchLabel: 'TOUCH',
    // Datasheet Table 2-7 (LP IO MUX Functions): LP_GPIO0-7 on GPIO0-7
    rtc: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 },
    rtcLabel: 'LP_GPIO',
    dac: {},
    inputOnly: [],
    usb: { 12: 'D-', 13: 'D+' },
    uart0: { 16: 'TX', 17: 'RX' },
    jtag: { 4: 'MTMS', 5: 'MTDI', 6: 'MTCK', 7: 'MTDO' },
    xtal32k: { 0: 'P', 1: 'N' },
    // Datasheet section 2.3.4 and Table 2-10: GPIO27 is the VDD_SPI pin of the QFN40 package
    vddSpi: { 27: 'The VDD_SPI pin of the QFN40 package: it powers the off-package flash by default and can only become a GPIO if the flash has its own power supply (datasheet section 2.3.4).' },
    strapHoldMs: 3,
    // Datasheet section 3, Tables 3-1, 3-3, 3-4, 3-5, 3-7
    strapping: {
      4: { what: 'SDIO slave sampling/driving edge (with GPIO5)', def: 'floating', w: 2,
        level: 'Only matters if you use the SDIO slave interface.' },
      5: { what: 'SDIO slave sampling/driving edge (with GPIO4)', def: 'floating', w: 2,
        level: 'Only matters if you use the SDIO slave interface.' },
      8: { what: 'Boot mode (with GPIO9), ROM log on UART0', def: 'floating', w: 3,
        level: 'Any level for a normal boot; it must be high for download mode.' },
      9: { what: 'Boot mode', def: 'internal pull-up (1)', w: 4,
        level: 'Must be high at reset for a normal boot. Held low at reset it starts download mode.' },
      15: { what: 'JTAG signal source', def: 'floating, no internal pull resistor', w: 2,
        level: 'Ignored unless the EFUSE_JTAG_SEL_ENABLE eFuse is burned (not burned by default).' }
    },
    pinNotes: {
      6: [{ sev: 'info', src: 'ds', text: 'Also LP_I2C_SDA: the low-power I2C controller is fixed to GPIO6 (SDA) and GPIO7 (SCL), as ESPHome also enforces for it.' }],
      7: [{ sev: 'info', src: 'ds', text: 'Also LP_I2C_SCL: the low-power I2C controller is fixed to GPIO6 (SDA) and GPIO7 (SCL), as ESPHome also enforces for it.' }]
    },
    interruptIssue: [],
    safeText: 'Free GPIO: no boot, flash, USB, UART0 or debug role on the ESP32-C6.',
    modules: [
      { id: 'unknown', label: 'Not sure (assume the strictest)',
        hint: 'GPIO24 to GPIO30 are treated as flash pins, and GPIO10, GPIO11 and GPIO14 may be missing depending on the package.',
        mem: { 24: 'flash SPICS0', 25: 'flash SPIQ', 26: 'flash SPIWP', 28: 'flash SPIHD', 29: 'flash SPICLK', 30: 'flash SPID' },
        vddSpi: true,
        maybeNotBonded: {
          10: 'Not bonded out on QFN32 chips with in-package flash (ESP32-C6FH4/FH8, e.g. ESP32-C6-MINI-1). Pick your package above.',
          11: 'Not bonded out on QFN32 chips with in-package flash (ESP32-C6FH4/FH8, e.g. ESP32-C6-MINI-1). Pick your package above.',
          14: 'Not bonded out on QFN40 chips without in-package flash (ESP32-C6, e.g. ESP32-C6-WROOM-1). Pick your package above.'
        },
        src: 'idf' },
      { id: 'qfn40', label: 'QFN40, external flash (ESP32-C6; e.g. ESP32-C6-WROOM-1)',
        hint: 'GPIO24 to GPIO30 go to the external flash (GPIO27 is its VDD_SPI supply). GPIO14 is not bonded out.',
        mem: { 24: 'flash SPICS0', 25: 'flash SPIQ', 26: 'flash SPIWP', 28: 'flash SPIHD', 29: 'flash SPICLK', 30: 'flash SPID' },
        vddSpi: true,
        notBonded: { 14: true },
        src: 'ds' },
      { id: 'qfn32', label: 'QFN32, in-package flash (ESP32-C6FH4 / FH8; e.g. ESP32-C6-MINI-1)',
        hint: 'The flash pins and GPIO10/GPIO11 are not bonded out; 22 GPIOs remain, GPIO14 included.',
        notBonded: { 10: true, 11: true, 24: true, 25: true, 26: true, 27: true, 28: true, 29: true, 30: true },
        src: 'ds' }
    ],
    sources: [
      { id: 'ds', title: 'ESP32-C6 Series Datasheet', version: 'v1.5 (2026-03-31)', url: DOC_BASE + 'esp32-c6_datasheet_en.pdf',
        used: 'Packages (Table 1-1), pin overview (Tables 2-1, 2-2), IO MUX for QFN40 and QFN32 (Tables 2-4, 2-5), LP IO MUX and analog functions (Tables 2-7, 2-9), restrictions and pin priorities (2.3.4, 2.3.5), flash pin mapping (Table 2-16), strapping pins (Tables 3-1, 3-3 to 3-7)' }
    ].concat(idfSources('esp32c6', 'ESP32-C6')).concat(ehSources('gpio_esp32_c6.py')).concat([
      { id: 'mod', title: 'ESP32-C6-WROOM-1 / ESP32-C6-MINI-1 datasheets', version: 'v1.4 / v1.5', url: DOC_BASE + 'esp32-c6-wroom-1_wroom-1u_datasheet_en.pdf',
        used: 'Which package each module uses and which pins it leads out' }
    ]),
    // ESPHome 2026.10.0 esphome/components/esp32/gpio_esp32_c6.py
    esphome: {
      maxPin: 30,
      strapping: [4, 5, 8, 9, 15],
      errorPins: { 24: 'flash', 25: 'flash', 26: 'flash', 27: 'flash', 28: 'flash', 29: 'flash', 30: 'flash' },
      warnPins: {},
      usbJtag: [12, 13],
      inputOnly: [],
      octalWarn: [],
      file: 'gpio_esp32_c6.py'
    }
  };

  var CHIP_IDS = ['esp32', 'esp32s3', 'esp32c3', 'esp32c6'];

  // ADC2 rules, quoted from the ESP-IDF pages named in each text
  var ADC2_RULES = {
    esp32: {
      wifiOn: { sev: 'avoid', w: 8, src: 'idf',
        text: 'ADC2 cannot be used while Wi-Fi is on (ESP-IDF GPIO reference). Use an ADC1 pin (GPIO32 to GPIO39) or keep Wi-Fi off.' },
      wifiOff: { sev: 'info', w: 1, src: 'idf', text: 'ADC2 works here because Wi-Fi is off.' },
      summary: 'ESP32: ADC2 pins cannot be read while Wi-Fi is on (ESP-IDF GPIO reference). ESPHome nearly always runs Wi-Fi, so use ADC1 (GPIO32 to GPIO39).'
    },
    esp32s3: {
      wifiOn: { sev: 'care', w: 3, src: 'idfadc',
        text: 'ADC2 is shared with Wi-Fi: ESP-IDF arbitrates between the two, and a read can fail with a timeout while Wi-Fi holds ADC2 (ADC Oneshot reference). Prefer ADC1 (GPIO1 to GPIO10).' },
      wifiOff: { sev: 'info', w: 1, src: 'idfadc', text: 'ADC2 has no Wi-Fi contention because Wi-Fi is off.' },
      summary: 'ESP32-S3: ADC2 is shared with Wi-Fi. ESP-IDF arbitrates access, so ADC2 reads can time out while Wi-Fi is busy (ADC Oneshot reference). ADC1 (GPIO1 to GPIO10) has no such limit.'
    },
    esp32c3: {
      wifiOn: { sev: 'avoid', w: 8, src: 'idfadc',
        text: 'ESP-IDF no longer supports ADC2 one-shot reads on the ESP32-C3 because the results are not stable (ADC Oneshot reference, SoC errata). Use ADC1 on GPIO0 to GPIO4.' },
      wifiOff: { sev: 'avoid', w: 8, src: 'idfadc',
        text: 'ESP-IDF no longer supports ADC2 one-shot reads on the ESP32-C3 because the results are not stable (ADC Oneshot reference, SoC errata). Use ADC1 on GPIO0 to GPIO4.' },
      summary: 'ESP32-C3: ESP-IDF no longer supports ADC2 one-shot reads (unstable results), with or without Wi-Fi. Only ADC1 on GPIO0 to GPIO4 is usable.'
    },
    esp32c6: {
      summary: 'ESP32-C6: there is only ADC1 (GPIO0 to GPIO6), and it works with Wi-Fi on.'
    }
  };

  // ── Lookups ─────────────────────────────────────────────

  function getChip(chipId) {
    return CHIPS[chipId] || CHIPS.esp32;
  }

  function getModule(chip, modId) {
    for (var i = 0; i < chip.modules.length; i++) {
      if (chip.modules[i].id === modId) return chip.modules[i];
    }
    return chip.modules[0];
  }

  function has(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key);
  }

  function sourceById(chip, id) {
    for (var i = 0; i < chip.sources.length; i++) {
      if (chip.sources[i].id === id) return chip.sources[i];
    }
    return null;
  }

  // Everything known about one GPIO of one chip/module, independent of the need
  function facts(chipId, modId, gpio) {
    var chip = getChip(chipId);
    var mod = getModule(chip, modId);
    var n = Number(gpio);
    var exists = chip.gpios.indexOf(n) !== -1;
    var f = {
      gpio: n,
      exists: exists,
      name: chip.pinNames[n] || '',
      adc: has(chip.adc1, n) ? { unit: 1, ch: chip.adc1[n] } : (has(chip.adc2, n) ? { unit: 2, ch: chip.adc2[n] } : null),
      touch: has(chip.touch, n) ? chip.touch[n] : null,
      rtc: has(chip.rtc, n) ? chip.rtc[n] : null,
      dac: has(chip.dac, n) ? chip.dac[n] : null,
      inputOnly: chip.inputOnly.indexOf(n) !== -1,
      usb: chip.usb[n] || null,
      uart0: chip.uart0[n] || null,
      jtag: chip.jtag[n] || null,
      xtal32k: chip.xtal32k[n] || null,
      strap: chip.strapping[n] || null,
      vddSpi: (has(chip.vddSpi, n) && mod.vddSpi) ? chip.vddSpi[n] : null,
      mem: (mod.mem && mod.mem[n]) || null,
      notBonded: !!(mod.notBonded && mod.notBonded[n]),
      maybeNotBonded: (mod.maybeNotBonded && mod.maybeNotBonded[n]) || null,
      v18: !!(mod.v18 && mod.v18[n]),
      moduleCare: (mod.careNotes && mod.careNotes[n]) || null,
      moduleFree: (mod.freeNotes && mod.freeNotes[n]) || null,
      notes: chip.pinNotes[n] || [],
      interruptIssue: chip.interruptIssue.indexOf(n) !== -1
    };
    return f;
  }

  // ── Verdict ─────────────────────────────────────────────

  function adcLabel(f) {
    return 'ADC' + f.adc.unit + '_CH' + f.adc.ch;
  }

  function touchLabel(chip, f) {
    return chip.touchLabel === 'T' ? 'T' + f.touch + ' (TOUCH' + f.touch + ')' : 'TOUCH' + f.touch;
  }

  function rtcName(chip, f) {
    return chip.rtcLabel === 'RTC' ? 'RTC IO' : chip.rtcLabel + f.rtc;
  }

  // Assess one pin for one need. Returns { level, score, summary, reasons[] }.
  // level: safe | care | avoid | no (pin can't do the need) | na (pin not available).
  function assess(chipId, modId, gpio, need, opts) {
    var chip = getChip(chipId);
    var f = facts(chip.id, modId, gpio);
    var wifi = !opts || opts.wifi !== false;
    if (NEED_IDS.indexOf(need) === -1) need = 'io';
    var reasons = [];
    function add(sev, w, text, src) { reasons.push({ sev: sev, w: w, text: text, src: src }); }

    if (!f.exists) {
      add('na', 0, 'GPIO' + f.gpio + ' does not exist on the ' + chip.label + '.', 'ds');
      return finish(chip, f, need, reasons);
    }
    if (f.notBonded) {
      add('na', 0, 'Not bonded out on the selected chip variant or package, so there is no physical pin.', 'ds');
      return finish(chip, f, need, reasons);
    }

    // What the pin can do for this need
    var capable = true;
    if (need === 'io' || need === 'i2c' || need === 'pwm') {
      if (f.inputOnly) {
        capable = false;
        add('no', 0, 'Input only: GPIO34 to GPIO39 have no output driver and no internal pull-up or pull-down (datasheet Table 6-1).', 'ds');
      }
    } else if (need === 'adc') {
      if (!f.adc) { capable = false; add('no', 0, 'No ADC channel on this pin.', 'ds'); }
    } else if (need === 'touch') {
      if (f.touch === null) {
        capable = false;
        add('no', 0, Object.keys(chip.touch).length ? 'No touch channel on this pin.' : 'The ' + chip.label + ' has no capacitive touch sensor.', 'ds');
      }
    } else if (need === 'wake') {
      if (f.rtc === null) {
        capable = false;
        add('no', 0, chip.id === 'esp32c3' ? 'Only GPIO0 to GPIO5 can wake the ESP32-C3 from deep sleep (ESP-IDF GPIO reference).'
          : 'Not an ' + (chip.rtcLabel === 'LP_GPIO' ? 'LP' : 'RTC') + ' IO, so it cannot wake the chip from deep sleep.', 'idfsleep');
      }
    } else if (need === 'dac') {
      if (f.dac === null) {
        capable = false;
        add('no', 0, Object.keys(chip.dac).length ? 'No DAC on this pin: only GPIO25 and GPIO26.' : 'The ' + chip.label + ' has no DAC.', 'ds');
      }
    }

    // Pins taken by memory or power
    var mod = getModule(chip, modId);
    if (f.mem) {
      add('avoid', 10, (mod.id === 'unknown' ? 'Assumed taken: ' + f.mem + '. Pick your module above if yours leaves this pin free.'
        : 'Connected to the ' + f.mem + '.') + ' The datasheet says not to use flash/PSRAM pins for anything else.', mod.src);
    }
    if (f.vddSpi) add('avoid', 9, f.vddSpi, 'ds');
    if (f.maybeNotBonded) add('care', 3, f.maybeNotBonded, 'idf');
    if (f.moduleCare) add('care', 3, f.moduleCare, 'eh');

    // Boot strapping
    if (f.strap) {
      add('care', f.strap.w, 'Strapping pin: ' + f.strap.what + '. ' + f.strap.level, 'ds');
      if (need === 'i2c') {
        add('avoid', 6, 'I2C needs pull-up resistors, and ESPHome\'s FAQ says I2C lines are not safe on strapping pins: a pull-up can change how the chip boots.', 'ehdoc');
      }
    }

    // USB, UART0, JTAG
    if (f.usb) {
      add('care', 4, 'USB ' + f.usb + ' of the USB Serial/JTAG controller: on boards with native USB it is the flashing and log port, and ESPHome logs there by default on this chip. Used as a GPIO, it disables USB-Serial-JTAG (ESP-IDF GPIO reference); ESPHome warns about it.', 'idf');
    }
    if (f.uart0) {
      add('care', chip.id === 'esp32' ? 4 : 3, 'UART0 ' + f.uart0 + ': serial flashing and the ROM boot log' +
        (f.uart0 === 'TX' ? ', so it toggles at every boot before your firmware runs' : '') +
        (chip.id === 'esp32' ? '. ESPHome\'s logger uses UART0 on the ESP32 by default.' : '. ESPHome logs over USB Serial/JTAG on this chip by default, but boards with a USB-UART chip use these pins.'), 'ds');
    }
    if (f.jtag) {
      add('care', 1, 'Pad JTAG (' + f.jtag + '): free unless you debug over JTAG on these pins; the datasheet lists JTAG pins among the GPIOs with usage restrictions.', 'ds');
    }

    // Input-only pins for needs that work with inputs
    if (f.inputOnly && capable) {
      if (need === 'spi' || need === 'uart') {
        add('care', 2, 'Input only: usable as ' + (need === 'spi' ? 'MISO' : 'RX') + ' only (no output driver).', 'ds');
      } else {
        add('info', 0, 'No internal pull-up or pull-down: add an external resistor if the signal can float. ESPHome rejects pullup/pulldown on GPIO34 to GPIO39.', 'eh');
      }
    }
    if (f.interruptIssue && need === 'in') {
      add('care', 2, 'Don\'t rely on edge interrupts here while the ADC or Wi-Fi/Bluetooth with sleep is active: the input is briefly pulled down (ESP-IDF GPIO reference, SoC errata GPIO-3.11).', 'idf');
    }

    // Need-specific
    if (need === 'adc' && f.adc && f.adc.unit === 2) {
      var rule = ADC2_RULES[chip.id];
      var r = wifi ? rule.wifiOn : rule.wifiOff;
      if (r) add(r.sev, r.w, r.text, r.src);
    }
    if (f.v18) {
      add('care', 3, 'Runs at 1.8 V on chips with a 1.8 V VDD_SPI (ESP32-S3R8V, S3R16V): don\'t connect 3.3 V signals (datasheet Table 2-1 note 4).', 'ds');
    }

    // Context notes that do not change the verdict
    if (f.moduleFree) add('info', 0, f.moduleFree, 'ds');
    if (f.xtal32k) add('info', 0, 'Also the 32 kHz crystal pin (XTAL_32K_' + f.xtal32k + '): free unless your board fits a 32 kHz crystal.', 'ds');
    f.notes.forEach(function (n) { add(n.sev, 0, n.text, n.src); });

    return finish(chip, f, need, reasons);
  }

  function positiveText(chip, f, need) {
    if (need === 'adc' && f.adc) return adcLabel(f) + (f.adc.unit === 1 ? ': works while Wi-Fi is on.' : '.');
    if (need === 'touch' && f.touch !== null) return 'Touch channel ' + touchLabel(chip, f) + '.';
    if (need === 'wake' && f.rtc !== null) return rtcName(chip, f) + ': can wake the chip from deep sleep.';
    if (need === 'dac' && f.dac !== null) return 'DAC_' + f.dac + ' (8-bit analog output).';
    if ((need === 'in') && f.inputOnly) return 'Input-only pin: fine as an input.';
    return chip.safeText;
  }

  function finish(chip, f, need, reasons) {
    var level = 'safe';
    var score = 0;
    reasons.forEach(function (r) {
      if (SEV_RANK[r.sev] > SEV_RANK[level]) level = r.sev;
      if (r.sev === 'care' || r.sev === 'avoid') score += r.w;
    });
    // Within one verdict, ADC1 sorts before ADC2
    if (need === 'adc' && f.adc && f.adc.unit === 2) score += 1;
    var top = null;
    reasons.forEach(function (r) {
      if (r.sev === 'info') return;
      if (!top || SEV_RANK[r.sev] > SEV_RANK[top.sev] || (r.sev === top.sev && r.w > top.w)) top = r;
    });
    var summary = (level === 'safe' || !top) ? positiveText(chip, f, need) : top.text;
    return { gpio: f.gpio, level: level, score: score, summary: summary, reasons: reasons, facts: f };
  }

  // All pins of a chip for one need, best first
  function rankPins(chipId, modId, need, opts) {
    var chip = getChip(chipId);
    var list = chip.gpios.map(function (g) { return assess(chip.id, modId, g, need, opts); });
    list.sort(function (a, b) {
      var la = LEVELS.indexOf(a.level);
      var lb = LEVELS.indexOf(b.level);
      if (la !== lb) return la - lb;
      if (a.score !== b.score) return a.score - b.score;
      return a.gpio - b.gpio;
    });
    return list;
  }

  // ── ESPHome cross-check ─────────────────────────────────
  // What ESPHome 2026.10.0 itself says about the pin, using its own lists (gpio_esp32*.py)

  function esphomeCheck(chipId, modId, gpio, need) {
    var chip = getChip(chipId);
    var eh = chip.esphome;
    var n = Number(gpio);
    var out = { level: 'ok', messages: [] };
    function msg(level, text) {
      out.messages.push(text);
      if (level === 'error' || (level === 'warning' && out.level === 'ok')) out.level = level;
    }
    if (n < 0 || n > eh.maxPin) {
      msg('error', 'Invalid pin number (must be 0-' + eh.maxPin + ').');
      return out;
    }
    if (has(eh.errorPins, n)) {
      msg('error', eh.errorPins[n] === 'flash'
        ? 'Rejected: "already used by the ' + (chip.id === 'esp32' ? 'flash interface' : 'SPI/PSRAM interface') + '". ignore_pin_validation_error: true bypasses this, only for boards wired differently.'
        : 'Rejected: "not usable" on this chip.');
    }
    if (has(eh.warnPins, n)) msg('warning', 'Warns: "might already be used by the flash interface in QUAD IO flash mode".');
    if (eh.usbJtag.indexOf(n) !== -1) msg('warning', 'Warns: "used by the USB-Serial-JTAG interface".');
    if (eh.octalWarn.indexOf(n) !== -1 && /^octal/.test(getModule(chip, modId).id)) {
      msg('warning', 'Warns when psram mode is octal: "used by the PSRAM interface in octal mode and should be avoided".');
    }
    if (eh.inputOnly.indexOf(n) !== -1 && (need === 'io' || need === 'i2c' || need === 'pwm' || need === 'dac')) {
      msg('error', 'Rejected: GPIO34-39 "does not support output pin mode".');
    }
    if (eh.strapping.indexOf(n) !== -1 && need !== 'touch') {
      msg('warning', 'Warns: "is a strapping pin and should only be used for I/O with care" (silenced by ignore_strapping_warning: true).');
    }
    if (!out.messages.length) out.messages.push('Passes ESPHome\'s pin validation without warnings.');
    return out;
  }

  // ── ESPHome snippet ─────────────────────────────────────

  function pinBlock(indent, key, gpio, mode, strap) {
    var pad = new Array(indent + 1).join(' ');
    var lines = [pad + key + ':', pad + '  number: GPIO' + gpio];
    if (mode) {
      lines.push(pad + '  mode:');
      Object.keys(mode).forEach(function (k) { lines.push(pad + '    ' + k + ': ' + mode[k]); });
    }
    if (strap) {
      lines.push(pad + '  # Strapping pin. Uncomment only after checking its boot level:');
      lines.push(pad + '  # ignore_strapping_warning: true');
    }
    return lines;
  }

  function snippet(chipId, modId, gpio, need) {
    var chip = getChip(chipId);
    var f = facts(chip.id, modId, gpio);
    var g = f.gpio;
    // ESPHome raises "GPIOn is not a strapping pin" if the option is set on any other pin,
    // so it is only offered for pins in ESPHome's own strapping list
    var strap = chip.esphome.strapping.indexOf(g) !== -1;
    var lines = [];
    switch (need) {
      case 'in':
        lines.push('binary_sensor:', '  - platform: gpio', '    name: "GPIO' + g + ' input"');
        if (f.inputOnly) {
          lines = lines.concat(pinBlock(4, 'pin', g, { input: 'true' }, strap));
          lines.push('    # GPIO34-39 have no internal pull-up: fit an external resistor');
        } else {
          lines = lines.concat(pinBlock(4, 'pin', g, { input: 'true', pullup: 'true' }, strap));
        }
        break;
      case 'i2c':
        lines.push('i2c:');
        lines = lines.concat(pinBlock(2, 'sda', g, null, strap));
        lines.push('  scl: GPIOXX  # pick a second pin; swap sda/scl if needed');
        break;
      case 'spi':
        lines.push('spi:');
        if (f.inputOnly) {
          lines.push('  clk_pin: GPIOXX');
          lines.push('  mosi_pin: GPIOXX');
          lines = lines.concat(pinBlock(2, 'miso_pin', g, null, strap));
        } else {
          lines = lines.concat(pinBlock(2, 'clk_pin', g, null, strap));
          lines.push('  mosi_pin: GPIOXX  # or use this pin as mosi_pin / miso_pin');
          lines.push('  miso_pin: GPIOXX');
        }
        break;
      case 'uart':
        lines.push('uart:');
        if (f.inputOnly) {
          lines.push('  tx_pin: GPIOXX');
          lines = lines.concat(pinBlock(2, 'rx_pin', g, null, strap));
        } else {
          lines = lines.concat(pinBlock(2, 'tx_pin', g, null, strap));
          lines.push('  rx_pin: GPIOXX  # or use this pin as rx_pin');
        }
        lines.push('  baud_rate: 9600');
        break;
      case 'pwm':
        lines.push('output:', '  - platform: ledc', '    id: pwm_gpio' + g);
        lines = lines.concat(pinBlock(4, 'pin', g, null, strap));
        lines.push('    frequency: 1000Hz');
        break;
      case 'adc':
        lines.push('sensor:', '  - platform: adc', '    name: "GPIO' + g + ' voltage"');
        lines = lines.concat(pinBlock(4, 'pin', g, null, strap));
        lines.push('    attenuation: auto', '    update_interval: 60s');
        break;
      case 'touch':
        // esp32_touch takes a plain pin number (no pin schema, so no strapping option)
        lines.push('esp32_touch:', '  setup_mode: true  # logs raw values; set threshold, then remove', '',
          'binary_sensor:', '  - platform: esp32_touch', '    name: "GPIO' + g + ' touch"', '    pin: GPIO' + g,
          '    threshold: 1000  # replace with a value from the setup_mode logs');
        break;
      case 'wake':
        lines.push('deep_sleep:', '  run_duration: 30s', '  sleep_duration: 10min');
        lines = lines.concat(pinBlock(2, 'wakeup_pin', g, null, strap));
        break;
      case 'dac':
        lines.push('output:', '  - platform: esp32_dac', '    id: dac_gpio' + g);
        lines = lines.concat(pinBlock(4, 'pin', g, null, strap));
        break;
      default:
        lines.push('switch:', '  - platform: gpio', '    name: "GPIO' + g + ' output"');
        lines = lines.concat(pinBlock(4, 'pin', g, null, strap));
    }
    return lines.join('\n') + '\n';
  }

  // ── URL hash state ──────────────────────────────────────

  function defaultState() {
    return { chip: 'esp32', mod: 'unknown', need: 'io', wifi: true, pin: null };
  }

  function normalizeState(s) {
    var d = defaultState();
    s = s || {};
    var chip = CHIP_IDS.indexOf(s.chip) !== -1 ? s.chip : d.chip;
    var c = CHIPS[chip];
    var mod = c.modules.some(function (m) { return m.id === s.mod; }) ? s.mod : 'unknown';
    var need = NEED_IDS.indexOf(s.need) !== -1 ? s.need : d.need;
    var pin = null;
    if (s.pin !== null && s.pin !== undefined && s.pin !== '' && /^\d{1,2}$/.test(String(s.pin))) {
      var p = Number(s.pin);
      if (c.gpios.indexOf(p) !== -1) pin = p;
    }
    return { chip: chip, mod: mod, need: need, wifi: s.wifi !== false, pin: pin };
  }

  function encodeHash(s) {
    s = normalizeState(s);
    var parts = ['chip=' + s.chip, 'mod=' + s.mod, 'need=' + s.need, 'wifi=' + (s.wifi ? '1' : '0')];
    if (s.pin !== null) parts.push('pin=' + s.pin);
    return parts.join('&');
  }

  function decodeHash(hash) {
    var s = {};
    String(hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 1) return;
      var k = kv.slice(0, i);
      var v = kv.slice(i + 1);
      try { v = decodeURIComponent(v); } catch (e) { return; }
      if (k === 'chip' || k === 'mod' || k === 'need') s[k] = v;
      else if (k === 'wifi') s.wifi = v !== '0';
      else if (k === 'pin') s.pin = v;
    });
    return normalizeState(s);
  }

  // ── UI ──────────────────────────────────────────────────

  var state = defaultState();

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function flagList(chip, f) {
    var flags = [];
    if (f.mem) {
      var psram = /PSRAM/.test(f.mem);
      var flash = /flash/.test(f.mem);
      flags.push({ cls: 'mem', text: psram && !flash ? 'PSRAM' : (flash && !psram ? 'FLASH' : 'FLASH/PSRAM') });
    }
    if (f.vddSpi) flags.push({ cls: 'mem', text: 'VDD_SPI' });
    if (f.strap) flags.push({ cls: 'warn', text: 'STRAP' });
    if (f.inputOnly) flags.push({ cls: 'warn', text: 'INPUT ONLY' });
    if (f.usb) flags.push({ cls: 'warn', text: 'USB ' + f.usb });
    if (f.uart0) flags.push({ cls: 'warn', text: 'UART0 ' + f.uart0 });
    if (f.v18) flags.push({ cls: 'warn', text: '1.8 V' });
    if (f.maybeNotBonded) flags.push({ cls: 'muted', text: 'MAYBE NC' });
    if (f.adc) flags.push({ cls: 'ana', text: adcLabel(f) });
    if (f.touch !== null) flags.push({ cls: 'ana', text: chip.touchLabel === 'T' ? 'T' + f.touch : 'TOUCH' + f.touch });
    if (f.dac !== null) flags.push({ cls: 'ana', text: 'DAC_' + f.dac });
    if (f.rtc !== null) flags.push({ cls: 'ok', text: chip.rtcLabel === 'RTC' ? 'RTC' : chip.rtcLabel + f.rtc });
    if (f.jtag) flags.push({ cls: 'muted', text: 'JTAG ' + f.jtag });
    if (f.xtal32k) flags.push({ cls: 'muted', text: '32K XTAL' });
    return flags;
  }

  function renderFlags(chip, f) {
    var box = el('span', 'egp-flags');
    flagList(chip, f).forEach(function (fl) { box.appendChild(el('span', 'egp-flag egp-flag--' + fl.cls, fl.text)); });
    return box;
  }

  function pinButton(chip, a, selected) {
    var li = el('li', 'egp-item');
    var b = el('button', 'egp-pin egp-pin--' + a.level + (selected ? ' egp-selected' : ''));
    b.type = 'button';
    b.setAttribute('data-gpio', String(a.gpio));
    b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    var head = el('span', 'egp-pin-head');
    var num = el('span', 'egp-pin-num', 'GPIO' + a.gpio);
    head.appendChild(num);
    if (a.facts.name) head.appendChild(el('span', 'egp-pin-name', a.facts.name));
    head.appendChild(el('span', 'egp-badge egp-badge--' + a.level, LEVEL_LABEL[a.level]));
    b.appendChild(head);
    b.appendChild(el('span', 'egp-pin-reason', a.summary));
    b.appendChild(renderFlags(chip, a.facts));
    li.appendChild(b);
    return li;
  }

  function renderControls() {
    var chip = getChip(state.chip);
    var radios = document.querySelectorAll('input[name="egp-chip"]');
    Array.prototype.forEach.call(radios, function (r) { r.checked = r.value === state.chip; });

    var sel = $('egp-module');
    if (sel.getAttribute('data-chip') !== chip.id) {
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      chip.modules.forEach(function (m) {
        var o = el('option', null, m.label);
        o.value = m.id;
        sel.appendChild(o);
      });
      sel.setAttribute('data-chip', chip.id);
    }
    sel.value = state.mod;
    $('egp-module-hint').textContent = getModule(chip, state.mod).hint;

    $('egp-wifi').checked = state.wifi;
    var adc2 = Object.keys(chip.adc2).length > 0;
    $('egp-wifi-hint').textContent = adc2 ? 'Changes the ADC2 verdict on the ' + chip.label + '.' : 'The ' + chip.label + ' has no ADC2, so this changes nothing here.';

    var needs = document.querySelectorAll('input[name="egp-need"]');
    Array.prototype.forEach.call(needs, function (r) { r.checked = r.value === state.need; });
  }

  function chipNote(chip) {
    var need = state.need;
    if (need === 'adc') return ADC2_RULES[chip.id].summary;
    if (need === 'touch') {
      if (!Object.keys(chip.touch).length) return 'The ' + chip.label + ' has no capacitive touch sensor.';
      if (chip.id === 'esp32') return 'ESP32 touch: 10 channels. The datasheet notes the touch sensor has not passed the Conducted Susceptibility (CS) test, so it has limited application scenarios. Touch pins take a plain number in ESPHome, so the strapping warning does not apply there.';
      return 'ESP32-S3 touch: TOUCH1 to TOUCH14 on GPIO1 to GPIO14.';
    }
    if (need === 'dac' && !Object.keys(chip.dac).length) return 'The ' + chip.label + ' has no DAC. Use PWM with an RC filter, or an external DAC.';
    if (need === 'wake') {
      if (chip.id === 'esp32c3') return 'ESP32-C3: only GPIO0 to GPIO5 can wake the chip from deep sleep (ESP-IDF GPIO reference); other GPIOs wake it from light sleep only.';
      if (chip.id === 'esp32c6') return 'ESP32-C6: the LP IOs GPIO0 to GPIO7 can wake the chip from deep sleep (ext1 or deep-sleep GPIO wakeup).';
      return chip.label + ': RTC GPIOs can wake the chip from deep sleep (ext0 / ext1). ESPHome accepts the same pins for wakeup_pin.';
    }
    if (need === 'i2c' || need === 'spi' || need === 'uart' || need === 'pwm') {
      return 'Through the GPIO matrix any output-capable GPIO can carry ' + (need === 'pwm' ? 'an LEDC PWM signal' : 'these signals') + ', so the ranking is about side effects, not capability.';
    }
    return '';
  }

  function render() {
    renderControls();
    var chip = getChip(state.chip);
    var opts = { wifi: state.wifi };
    var ranked = rankPins(chip.id, state.mod, state.need, opts);
    var fit = ranked.filter(function (a) { return a.level === 'safe' || a.level === 'care' || a.level === 'avoid'; });
    var unfit = ranked.filter(function (a) { return a.level === 'no' || a.level === 'na'; });

    var counts = { safe: 0, care: 0, avoid: 0 };
    fit.forEach(function (a) { counts[a.level]++; });
    var needLabel = NEEDS[NEED_IDS.indexOf(state.need)].label;
    $('egp-summary').textContent = chip.label + ' · ' + needLabel + ': ' + counts.safe + ' safe, ' + counts.care + ' use with care, ' + counts.avoid + ' avoid';

    var note = chipNote(chip);
    var noteEl = $('egp-chipnote');
    noteEl.textContent = note;
    noteEl.classList.toggle('egp-hidden', !note);

    var selected = state.pin;
    var selectable = fit.concat(unfit).map(function (a) { return a.gpio; });
    if (selected === null || selectable.indexOf(selected) === -1) selected = fit.length ? fit[0].gpio : null;

    var list = $('egp-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    fit.forEach(function (a) { list.appendChild(pinButton(chip, a, a.gpio === selected)); });
    if (!fit.length) list.appendChild(el('li', 'egp-empty', 'No pin on the ' + chip.label + ' can do this.'));

    var ulist = $('egp-unfit-list');
    while (ulist.firstChild) ulist.removeChild(ulist.firstChild);
    unfit.forEach(function (a) { ulist.appendChild(pinButton(chip, a, a.gpio === selected)); });
    $('egp-unfit-count').textContent = String(unfit.length);
    $('egp-unfit').classList.toggle('egp-hidden', !unfit.length);

    renderDetail(chip, selected, opts, fit.length > 0);
    renderSources(chip);
  }

  function sourceTag(chip, id) {
    var s = sourceById(chip, id);
    if (!s) return null;
    var a = el('a', 'egp-src', s.id === 'ds' ? 'datasheet ' + s.version.split(' ')[0] : s.title.split(':')[0]);
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  function renderDetail(chip, gpio, opts, anyFit) {
    var box = $('egp-detail-body');
    while (box.firstChild) box.removeChild(box.firstChild);
    $('egp-detail').scrollTop = 0;
    if (gpio === null) {
      box.appendChild(el('p', 'egp-detail-summary', anyFit ? 'Pick a pin from the list.'
        : 'No pin on the ' + chip.label + ' can do this. ' + chipNote(chip)));
      $('egp-snippet').textContent = anyFit ? '' : '# Nothing to configure: the ' + chip.label + ' has no pin for this.\n';
      return;
    }
    var a = assess(chip.id, state.mod, gpio, state.need, opts);
    var f = a.facts;

    var head = el('div', 'egp-detail-head');
    var h = el('h2', 'egp-detail-title', 'GPIO' + gpio);
    if (f.name) h.appendChild(el('span', 'egp-detail-name', f.name));
    head.appendChild(h);
    head.appendChild(el('span', 'egp-badge egp-badge--' + a.level, LEVEL_LABEL[a.level]));
    box.appendChild(head);
    box.appendChild(el('p', 'egp-detail-summary', a.summary));
    box.appendChild(renderFlags(chip, f));

    var shown = a.reasons.filter(function (r) { return r.sev !== 'na' || a.level === 'na'; });
    if (shown.length) {
      box.appendChild(el('h3', 'egp-sub', 'Why'));
      var ul = el('ul', 'egp-reasons');
      shown.forEach(function (r) {
        var li = el('li', 'egp-reason egp-reason--' + r.sev);
        li.appendChild(el('span', 'egp-reason-text', r.text));
        var tag = sourceTag(chip, r.src);
        if (tag) { li.appendChild(document.createTextNode(' ')); li.appendChild(tag); }
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    if (f.strap) {
      box.appendChild(el('h3', 'egp-sub', 'Boot strapping'));
      var dl = el('dl', 'egp-kv');
      [['Straps', f.strap.what], ['Default', f.strap.def],
        ['Latched', 'About ' + chip.strapHoldMs + ' ms after CHIP_PU goes high; after that it is a normal GPIO (datasheet section 3).']]
        .forEach(function (kv) {
          dl.appendChild(el('dt', 'egp-kv-key', kv[0]));
          dl.appendChild(el('dd', 'egp-kv-val', kv[1]));
        });
      box.appendChild(dl);
    }

    var eh = esphomeCheck(chip.id, state.mod, gpio, state.need);
    box.appendChild(el('h3', 'egp-sub', 'ESPHome 2026.10.0 check'));
    var ehBox = el('div', 'egp-eh egp-eh--' + eh.level);
    eh.messages.forEach(function (m) { ehBox.appendChild(el('p', 'egp-eh-line', m)); });
    box.appendChild(ehBox);

    $('egp-snippet').textContent = (a.level === 'no' || a.level === 'na') ? '# GPIO' + gpio + ' cannot do this on the selected chip.\n' : snippet(chip.id, state.mod, gpio, state.need);
  }

  function renderSources(chip) {
    var ul = $('egp-sources');
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    chip.sources.forEach(function (s) {
      var li = el('li', 'egp-source');
      var a = el('a', 'egp-source-link', s.title);
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener';
      li.appendChild(a);
      li.appendChild(el('span', 'egp-source-ver', s.version));
      li.appendChild(el('span', 'egp-source-used', s.used));
      ul.appendChild(li);
    });
  }

  function saveHash() {
    var h = '#' + encodeHash(state);
    if (location.hash !== h) {
      try { history.replaceState(null, '', h); } catch (e) { location.hash = h; }
    }
  }

  function update(patch) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    state = normalizeState(state);
    saveHash();
    render();
  }

  function showToast(text, isError) {
    var t = $('egp-toast');
    t.textContent = text || 'Copied';
    t.classList.toggle('egp-toast--error', !!isError);
    t.classList.add('egp-show');
    setTimeout(function () { t.classList.remove('egp-show'); }, 2000);
  }

  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      showToast(ok ? okMsg : 'Copy failed: select the text and copy it by hand', !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast(okMsg); }, fallback);
    } else {
      fallback();
    }
  }

  function copySnippet() {
    var text = $('egp-snippet').textContent;
    if (text) copyText(text, 'ESPHome snippet copied');
  }

  function copyLink() {
    saveHash();
    copyText(location.href, 'Link copied');
  }

  function buildNeeds() {
    var box = $('egp-needs');
    NEEDS.forEach(function (n) {
      var label = el('label', 'egp-need-opt');
      var input = el('input', 'egp-seg-input');
      input.type = 'radio';
      input.name = 'egp-need';
      input.value = n.id;
      var text = el('span', 'egp-need-text');
      text.appendChild(el('span', 'egp-need-label', n.label));
      text.appendChild(el('span', 'egp-need-hint', n.hint));
      label.appendChild(input);
      label.appendChild(text);
      box.appendChild(label);
    });
  }

  function onListClick(e) {
    var t = e.target;
    while (t && t !== e.currentTarget && !(t.getAttribute && t.getAttribute('data-gpio') !== null)) t = t.parentNode;
    if (!t || t === e.currentTarget) return;
    update({ pin: Number(t.getAttribute('data-gpio')) });
    if (window.matchMedia && window.matchMedia('(max-width: 960px)').matches) {
      var d = $('egp-detail');
      if (d && d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function init() {
    if (!$('egp-wrapper')) return;
    buildNeeds();
    state = decodeHash(location.hash);

    Array.prototype.forEach.call(document.querySelectorAll('input[name="egp-chip"]'), function (r) {
      r.addEventListener('change', function () { if (r.checked) update({ chip: r.value, mod: 'unknown', pin: null }); });
    });
    $('egp-module').addEventListener('change', function (e) { update({ mod: e.target.value }); });
    $('egp-wifi').addEventListener('change', function (e) { update({ wifi: e.target.checked }); });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="egp-need"]'), function (r) {
      r.addEventListener('change', function () { if (r.checked) update({ need: r.value }); });
    });
    $('egp-list').addEventListener('click', onListClick);
    $('egp-unfit-list').addEventListener('click', onListClick);
    window.addEventListener('hashchange', function () {
      var s = decodeHash(location.hash);
      if (encodeHash(s) !== encodeHash(state)) { state = s; render(); }
    });
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Global handlers for onclick attributes
  window.egpCopySnippet = copySnippet;
  window.egpCopyLink = copyLink;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      CHIPS: CHIPS,
      CHIP_IDS: CHIP_IDS,
      NEEDS: NEEDS,
      LEVELS: LEVELS,
      ADC2_RULES: ADC2_RULES,
      getModule: getModule,
      facts: facts,
      assess: assess,
      rankPins: rankPins,
      esphomeCheck: esphomeCheck,
      snippet: snippet,
      defaultState: defaultState,
      normalizeState: normalizeState,
      encodeHash: encodeHash,
      decodeHash: decodeHash
    };
  }
})();
