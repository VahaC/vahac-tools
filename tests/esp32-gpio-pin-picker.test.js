// tests/esp32-gpio-pin-picker.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript } = require('./_setup');

const egp = loadScript('esp32-gpio-pin-picker/script.js');
const { CHIPS, CHIP_IDS, NEEDS } = egp;

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const sorted = (xs) => [...xs].map(Number).sort((a, b) => a - b);
const keys = (obj) => sorted(Object.keys(obj));
const numMap = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [Number(k), v]));
const levelsOf = (chip, mod, need, opts) => Object.fromEntries(egp.rankPins(chip, mod, need, opts).map((a) => [a.gpio, a.level]));
const pinsWith = (chip, mod, need, level, opts) => sorted(egp.rankPins(chip, mod, need, opts).filter((a) => a.level === level).map((a) => a.gpio));
const mem = (chip, mod) => keys(egp.getModule(CHIPS[chip], mod).mem || {});
const notBonded = (chip, mod) => keys(egp.getModule(CHIPS[chip], mod).notBonded || {});

// ─────────────────────────────────────────────────────────────────────────────
// Expected tables, transcribed by hand from the primary sources (read 2026-10-26).
// They are kept separate from script.js on purpose: a typo in one place fails the test.
// ─────────────────────────────────────────────────────────────────────────────

// GPIO numbers that physically exist on the chip.
// ESP32: ESP32 Series Datasheet v5.3, Table 2-1; ESP-IDF GPIO page (esp32): "34 physical GPIO pins
//   (GPIO0 ~ GPIO19, GPIO21 ~ GPIO23, GPIO25 ~ GPIO27, and GPIO32 ~ GPIO39)".
// ESP32-S3: Datasheet v2.2, Table 2-4; ESP-IDF (esp32s3): "45 physical GPIO pins (GPIO0 ~ GPIO21 and GPIO26 ~ GPIO48)".
// ESP32-C3: Datasheet v2.4, Table 2-4; ESP-IDF (esp32c3): "22 physical GPIO pins (GPIO0 ~ GPIO21)".
// ESP32-C6: Datasheet v1.5, Tables 2-4 and 2-5; ESP-IDF (esp32c6): "31 physical GPIO pins (GPIO0 ~ GPIO30)".
const GPIOS = {
  esp32: { count: 34, max: 39, gaps: [20, 24, 28, 29, 30, 31] },
  esp32s3: { count: 45, max: 48, gaps: [22, 23, 24, 25] },
  esp32c3: { count: 22, max: 21, gaps: [] },
  esp32c6: { count: 31, max: 30, gaps: [] }
};

// Strapping pins. ESP32 v5.3 Table 3-1 (GPIO0, GPIO2, MTDI=GPIO12, MTDO=GPIO15, GPIO5);
// S3 v2.2 Table 3-1 (GPIO0, GPIO3, GPIO45, GPIO46); C3 v2.4 Table 3-1 (GPIO2, GPIO8, GPIO9);
// C6 v1.5 Table 3-1 (MTMS=GPIO4, MTDI=GPIO5, GPIO8, GPIO9, GPIO15).
const STRAPPING = {
  esp32: [0, 2, 5, 12, 15],
  esp32s3: [0, 3, 45, 46],
  esp32c3: [2, 8, 9],
  esp32c6: [4, 5, 8, 9, 15]
};

// Default strap level from the same tables ('1' weak pull-up, '0' weak pull-down, 'float').
const STRAP_DEFAULT = {
  esp32: { 0: '1', 2: '0', 5: '1', 12: '0', 15: '1' },
  esp32s3: { 0: '1', 3: 'float', 45: '0', 46: '0' },
  esp32c3: { 2: 'float', 8: 'float', 9: '1' },
  esp32c6: { 4: 'float', 5: 'float', 8: 'float', 9: '1', 15: 'float' }
};

// SPI0/1 flash pins. ESP32 v5.3 Table 2-6 (SD_CLK=GPIO6, SD_DATA_0=7, SD_DATA_1=8, SD_DATA_2=9,
// SD_DATA_3=10, SD_CMD=11); S3 v2.2 Table 2-14 (SPICS1=26, SPIHD=27, SPIWP=28, SPICS0=29, SPICLK=30,
// SPIQ=31, SPID=32); C3 v2.4 Table 2-4/2-12 (GPIO12-17); C6 v1.5 Table 2-4/2-16 (GPIO24-26, 28-30;
// GPIO27 is VDD_SPI).
const FLASH = {
  esp32: [6, 7, 8, 9, 10, 11],
  esp32s3: [26, 27, 28, 29, 30, 31, 32],
  esp32c3: [12, 13, 14, 15, 16, 17],
  esp32c6: [24, 25, 26, 28, 29, 30]
};
const VDD_SPI = { esp32: [], esp32s3: [], esp32c3: [11], esp32c6: [27] };
// S3 v2.2 Table 2-14, Octal SPI column: GPIO33-36 = DQ4-DQ7, GPIO37 = DQS/DM
const S3_OCTAL = [33, 34, 35, 36, 37];
// ESP32 v5.3 Table 2-5: in-package flash of ESP32-U4WDH (SD_DATA_1, GPIO17, SD_DATA_0, SD_CMD, SD_CLK, GPIO16)
const ESP32_U4WDH_FLASH = [6, 7, 8, 11, 16, 17];
// ESP32 v5.3 Table 2-5: in-package PSRAM of ESP32-D0WDRH2-V3 (SD_DATA_1, SD_DATA_0, SD_DATA_3, SD_DATA_2, SD_CLK, GPIO16)
const ESP32_INPKG_PSRAM = [6, 7, 8, 9, 10, 16];
// ESP32 v5.3 Table 2-6, off-package PSRAM: CE# on GPIO16, SCLK on GPIO17 (as on ESP32-WROVER-E)
const ESP32_EXT_PSRAM = { ce: 16, sclk: 17 };

// USB D-/D+ (USB Serial/JTAG). S3 v2.2 Table 2-8 (GPIO19 USB_D-, GPIO20 USB_D+);
// C3 v2.4 Table 2-6 (GPIO18, GPIO19); C6 v1.5 Table 2-9 (GPIO12, GPIO13). The ESP32 has none.
const USB = {
  esp32: {},
  esp32s3: { 19: 'D-', 20: 'D+' },
  esp32c3: { 18: 'D-', 19: 'D+' },
  esp32c6: { 12: 'D-', 13: 'D+' }
};

// Input-only: ESP32 v5.3 Table 6-1 note 2 ("GPIO pins 34-39 are input-only"); none on the others.
const INPUT_ONLY = { esp32: [34, 35, 36, 37, 38, 39], esp32s3: [], esp32c3: [], esp32c6: [] };

// ADC channels, GPIO -> channel.
// ESP32 v5.3 Table 4-6; ESP-IDF esp32 GPIO table.
// S3 v2.2 Table 2-8; C3 v2.4 Table 2-6; C6 v1.5 Table 2-9 (the C6 has no ADC2).
const ADC1 = {
  esp32: { 36: 0, 37: 1, 38: 2, 39: 3, 32: 4, 33: 5, 34: 6, 35: 7 },
  esp32s3: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9 },
  esp32c3: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 },
  esp32c6: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }
};
const ADC2 = {
  esp32: { 4: 0, 0: 1, 2: 2, 15: 3, 13: 4, 12: 5, 14: 6, 27: 7, 25: 8, 26: 9 },
  esp32s3: { 11: 0, 12: 1, 13: 2, 14: 3, 15: 4, 16: 5, 17: 6, 18: 7, 19: 8, 20: 9 },
  esp32c3: { 5: 0 },
  esp32c6: {}
};

// Touch channels. ESP32 v5.3 Table 4-5 (T0 GPIO4, T1 GPIO0, T2 GPIO2, T3 MTDO, T4 MTCK, T5 MTDI,
// T6 MTMS, T7 GPIO27, T8 32K_XN, T9 32K_XP); S3 v2.2 Table 2-8 (TOUCH1-14 on GPIO1-14). C3/C6: none.
const TOUCH = {
  esp32: { 4: 0, 0: 1, 2: 2, 15: 3, 13: 4, 12: 5, 14: 6, 27: 7, 33: 8, 32: 9 },
  esp32s3: Object.fromEntries(range(1, 14).map((n) => [n, n])),
  esp32c3: {},
  esp32c6: {}
};

// RTC / LP IO numbers (deep-sleep wake capable).
// ESP32 v5.3 Table 2-1 RTC_GPIO column; S3 v2.2 Table 2-6 (RTC_GPIO0-21); C3: ESP-IDF esp32c3 GPIO
// page "GPIO0 ~ GPIO5 can be used to wake up the chip from Deep-sleep mode"; C6 v1.5 Table 2-7 (LP_GPIO0-7).
const RTC = {
  esp32: { 36: 0, 37: 1, 38: 2, 39: 3, 34: 4, 35: 5, 25: 6, 26: 7, 33: 8, 32: 9, 4: 10, 0: 11, 2: 12, 15: 13, 13: 14, 12: 15, 14: 16, 27: 17 },
  esp32s3: Object.fromEntries(range(0, 21).map((n) => [n, n])),
  esp32c3: Object.fromEntries(range(0, 5).map((n) => [n, n])),
  esp32c6: Object.fromEntries(range(0, 7).map((n) => [n, n]))
};

// DAC: ESP32 v5.3 section 4.9.2 and Table 4-6 (DAC_1 GPIO25, DAC_2 GPIO26).
const DAC = { esp32: { 25: 1, 26: 2 }, esp32s3: {}, esp32c3: {}, esp32c6: {} };

// UART0 pins (U0TXD / U0RXD). ESP32 v5.3 Table 2-1 (U0TXD GPIO1, U0RXD GPIO3); S3 v2.2 Table 2-4
// (GPIO43, GPIO44); C3 v2.4 Table 2-4 (U0RXD GPIO20, U0TXD GPIO21); C6 v1.5 Table 2-4 (GPIO16, GPIO17).
const UART0 = {
  esp32: { 1: 'TX', 3: 'RX' },
  esp32s3: { 43: 'TX', 44: 'RX' },
  esp32c3: { 21: 'TX', 20: 'RX' },
  esp32c6: { 16: 'TX', 17: 'RX' }
};

// Pad JTAG. ESP32 v5.3 Table 4-6 (MTDI 12, MTCK 13, MTMS 14, MTDO 15); S3 v2.2 Table 2-4
// (MTCK 39, MTDO 40, MTDI 41, MTMS 42); C3 v2.4 and C6 v1.5 Table 2-4 (MTMS 4, MTDI 5, MTCK 6, MTDO 7).
const JTAG = {
  esp32: { 12: 'MTDI', 13: 'MTCK', 14: 'MTMS', 15: 'MTDO' },
  esp32s3: { 39: 'MTCK', 40: 'MTDO', 41: 'MTDI', 42: 'MTMS' },
  esp32c3: { 4: 'MTMS', 5: 'MTDI', 6: 'MTCK', 7: 'MTDO' },
  esp32c6: { 4: 'MTMS', 5: 'MTDI', 6: 'MTCK', 7: 'MTDO' }
};

// Peripheral pin assignment priority 2 ("can be freely used without restrictions").
// C3 v2.4 section 2.3.4 / Table 2-7: P2 = GPIO0, 1, 3, 10.
// C6 v1.5 Table 2-10 (QFN40): P2 = GPIO0-3, 10, 11, 18-23. Table 2-11 (QFN32): P2 = GPIO0-3, 14, 18-23.
// S3 v2.2 Table 2-9: P2 = GPIO1, 2, 4-18, 21, 38, 47, 48 (GPIO33-37 are P3 because of octal SPI).
const PRIORITY2 = {
  esp32c3: [0, 1, 3, 10],
  esp32c6_qfn40: [0, 1, 2, 3, 10, 11, 18, 19, 20, 21, 22, 23],
  esp32c6_qfn32: [0, 1, 2, 3, 14, 18, 19, 20, 21, 22, 23],
  esp32s3: [1, 2].concat(range(4, 18), [21, 38, 47, 48])
};
// ESP32 (no priority table): ESP-IDF esp32 GPIO table rows with an empty comment column, minus
// the strapping pins of Table 3-1, on a module without PSRAM (GPIO16/17 free).
const ESP32_FREE_NO_PSRAM = [4, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33];

// ─────────────────────────────────────────────────────────────────────────────
// ESPHome 2026.10.0 source, transcribed separately:
// esphome/components/esp32/gpio_esp32.py, gpio_esp32_s3.py, gpio_esp32_c3.py, gpio_esp32_c6.py
// ─────────────────────────────────────────────────────────────────────────────
const ESPHOME = {
  esp32: { maxPin: 39, strapping: [0, 2, 5, 12, 15], flashError: [6, 7, 8, 11], flashWarn: [9, 10], unusable: [24, 28, 29, 30, 31], usbJtag: [], inputOnly: range(34, 39) },
  esp32s3: { maxPin: 48, strapping: [0, 3, 45, 46], flashError: range(26, 32), flashWarn: [], unusable: [22, 23, 24, 25], usbJtag: [19, 20], inputOnly: [], octal: range(33, 37) },
  esp32c3: { maxPin: 21, strapping: [2, 8, 9], flashError: range(12, 17), flashWarn: [], unusable: [], usbJtag: [18, 19], inputOnly: [] },
  esp32c6: { maxPin: 30, strapping: [4, 5, 8, 9, 15], flashError: range(24, 30), flashWarn: [], unusable: [], usbJtag: [12, 13], inputOnly: [] }
};
// esphome/components/deep_sleep/__init__.py WAKEUP_PINS
const ESPHOME_WAKE = {
  esp32: [0, 2, 4, 12, 13, 14, 15, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 39],
  esp32s3: range(0, 21),
  esp32c3: [0, 1, 2, 3, 4, 5],
  esp32c6: [0, 1, 2, 3, 4, 5, 6, 7]
};
// esphome/components/esp32_touch/__init__.py TOUCH_PADS (GPIO -> channel)
const ESPHOME_TOUCH = {
  esp32: { 4: 0, 0: 1, 2: 2, 15: 3, 13: 4, 12: 5, 14: 6, 27: 7, 33: 8, 32: 9 },
  esp32s3: Object.fromEntries(range(1, 14).map((n) => [n, n]))
};
// esphome/components/esp32_dac/output.py DAC_PINS
const ESPHOME_DAC = { esp32: [25, 26] };
// esphome/components/adc/__init__.py ESP32_VARIANT_ADC1/ADC2_PIN_TO_CHANNEL
const ESPHOME_ADC1 = {
  esp32: { 36: 0, 37: 1, 38: 2, 39: 3, 32: 4, 33: 5, 34: 6, 35: 7 },
  esp32s3: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9 },
  esp32c3: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 },
  esp32c6: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }
};
const ESPHOME_ADC2 = {
  esp32: { 4: 0, 0: 1, 2: 2, 15: 3, 13: 4, 12: 5, 14: 6, 27: 7, 25: 8, 26: 9 },
  esp32s3: { 11: 0, 12: 1, 13: 2, 14: 3, 15: 4, 16: 5, 17: 6, 18: 7, 19: 8, 20: 9 },
  esp32c3: { 5: 0 },
  esp32c6: {}
};
// ESPHome docs, components/logger: default UART0 pins
const ESPHOME_UART0 = { esp32: { tx: 1, rx: 3 }, esp32s3: { tx: 43, rx: 44 }, esp32c3: { tx: 21, rx: 20 }, esp32c6: { tx: 16, rx: 17 } };

// ─────────────────────────────────────────────────────────────────────────────
// Pin data against the datasheets / ESP-IDF
// ─────────────────────────────────────────────────────────────────────────────

test('the four chips are present in a fixed order', () => {
  assert.deepEqual(CHIP_IDS, ['esp32', 'esp32s3', 'esp32c3', 'esp32c6']);
  for (const id of CHIP_IDS) assert.equal(CHIPS[id].id, id);
});

for (const id of Object.keys(GPIOS)) {
  test(`${id}: GPIO count and numbering gaps match the datasheet and ESP-IDF`, () => {
    const g = CHIPS[id].gpios;
    assert.equal(g.length, GPIOS[id].count);
    assert.deepEqual(g, sorted(g), 'GPIO list must be sorted');
    assert.equal(new Set(g).size, g.length, 'no duplicates');
    assert.equal(Math.max(...g), GPIOS[id].max);
    const gaps = range(0, GPIOS[id].max).filter((n) => !g.includes(n));
    assert.deepEqual(gaps, GPIOS[id].gaps);
  });

  test(`${id}: strapping pins and their default levels match the boot configuration table`, () => {
    const s = CHIPS[id].strapping;
    assert.deepEqual(keys(s), STRAPPING[id]);
    for (const [gpio, level] of Object.entries(STRAP_DEFAULT[id])) {
      const def = s[gpio].def;
      if (level === '1') assert.match(def, /pull-up \(1\)/, `GPIO${gpio}`);
      else if (level === '0') assert.match(def, /pull-down \(0\)/, `GPIO${gpio}`);
      else assert.match(def, /^floating/, `GPIO${gpio}`);
      assert.ok(s[gpio].what.length > 5 && s[gpio].level.length > 10, `GPIO${gpio} explains what it straps`);
    }
  });

  test(`${id}: flash and VDD_SPI pins match the datasheet flash pin mapping`, () => {
    const chip = CHIPS[id];
    // The strictest module option treats every flash pin as taken
    const unknownMem = mem(id, 'unknown');
    for (const n of FLASH[id]) assert.ok(unknownMem.includes(n), `GPIO${n} is a flash pin`);
    assert.deepEqual(keys(chip.vddSpi), VDD_SPI[id]);
    for (const n of FLASH[id].concat(VDD_SPI[id])) {
      assert.equal(egp.assess(id, 'unknown', n, 'io').level, 'avoid', `GPIO${n} must be avoid`);
    }
  });

  test(`${id}: USB, UART0, JTAG and input-only pins match the datasheet`, () => {
    const chip = CHIPS[id];
    assert.deepEqual(numMap(chip.usb), numMap(USB[id]));
    assert.deepEqual(numMap(chip.uart0), numMap(UART0[id]));
    assert.deepEqual(numMap(chip.jtag), numMap(JTAG[id]));
    assert.deepEqual(sorted(chip.inputOnly), INPUT_ONLY[id]);
  });

  test(`${id}: ADC1 and ADC2 channel numbers match the datasheet analog tables`, () => {
    assert.deepEqual(numMap(CHIPS[id].adc1), numMap(ADC1[id]));
    assert.deepEqual(numMap(CHIPS[id].adc2), numMap(ADC2[id]));
    for (const n of Object.keys(CHIPS[id].adc1)) assert.ok(!(n in CHIPS[id].adc2), 'a pin is on one ADC unit only');
  });

  test(`${id}: touch, RTC/LP wake and DAC pins match the datasheet`, () => {
    assert.deepEqual(numMap(CHIPS[id].touch), numMap(TOUCH[id]));
    assert.deepEqual(numMap(CHIPS[id].rtc), numMap(RTC[id]));
    assert.deepEqual(numMap(CHIPS[id].dac), numMap(DAC[id]));
  });

  test(`${id}: every flagged pin exists on the chip`, () => {
    const chip = CHIPS[id];
    const all = [chip.adc1, chip.adc2, chip.touch, chip.rtc, chip.dac, chip.usb, chip.uart0, chip.jtag, chip.strapping, chip.vddSpi, chip.pinNames]
      .flatMap((m) => Object.keys(m).map(Number)).concat(chip.inputOnly);
    for (const n of all) assert.ok(chip.gpios.includes(n), `GPIO${n} is not a pin of ${id}`);
    for (const m of chip.modules) {
      for (const n of Object.keys(m.mem || {}).concat(Object.keys(m.notBonded || {})).map(Number)) {
        assert.ok(chip.gpios.includes(n), `${m.id}: GPIO${n} is not a pin of ${id}`);
      }
    }
  });
}

test('ESP32 module options: PSRAM and in-package flash pins follow datasheet Tables 2-5 and 2-6', () => {
  assert.deepEqual(mem('esp32', 'flash'), FLASH.esp32);
  assert.deepEqual(mem('esp32', 'psram'), sorted(FLASH.esp32.concat([ESP32_EXT_PSRAM.ce, ESP32_EXT_PSRAM.sclk])));
  assert.match(CHIPS.esp32.modules.find((m) => m.id === 'psram').mem[16], /CE#/);
  assert.match(CHIPS.esp32.modules.find((m) => m.id === 'psram').mem[17], /SCLK/);
  assert.deepEqual(mem('esp32', 'pkgpsram'), sorted(new Set(FLASH.esp32.concat(ESP32_INPKG_PSRAM))));
  assert.deepEqual(mem('esp32', 'u4wdh'), ESP32_U4WDH_FLASH);
  assert.deepEqual(mem('esp32', 'unknown'), sorted(FLASH.esp32.concat([16, 17])));
  // GPIO16/17 are free without PSRAM, GPIO17 stays free with in-package PSRAM
  assert.equal(egp.assess('esp32', 'flash', 16, 'io').level, 'safe');
  assert.equal(egp.assess('esp32', 'flash', 17, 'io').level, 'safe');
  assert.equal(egp.assess('esp32', 'psram', 16, 'io').level, 'avoid');
  assert.equal(egp.assess('esp32', 'psram', 17, 'io').level, 'avoid');
  assert.equal(egp.assess('esp32', 'pkgpsram', 16, 'io').level, 'avoid');
  assert.equal(egp.assess('esp32', 'pkgpsram', 17, 'io').level, 'safe');
  assert.equal(egp.assess('esp32', 'unknown', 16, 'io').level, 'avoid');
});

test('ESP32-U4WDH: GPIO9/10 are not flash pins in the datasheet, but ESPHome warns, so the stricter "care" wins', () => {
  for (const n of [9, 10]) {
    const a = egp.assess('esp32', 'u4wdh', n, 'io');
    assert.equal(a.level, 'care');
    assert.match(a.summary, /ESPHome warns/);
    assert.equal(egp.esphomeCheck('esp32', 'u4wdh', n, 'io').level, 'warning');
  }
  // ESPHome does not check GPIO16/17, yet they carry the in-package flash: avoid
  for (const n of [16, 17]) {
    assert.equal(egp.assess('esp32', 'u4wdh', n, 'io').level, 'avoid');
    assert.equal(egp.esphomeCheck('esp32', 'u4wdh', n, 'io').level, 'ok');
  }
});

test('ESP32-S3 module options: octal PSRAM/flash takes GPIO33-37, 1.8 V chips flag GPIO47/48', () => {
  assert.deepEqual(mem('esp32s3', 'quad'), FLASH.esp32s3);
  assert.deepEqual(mem('esp32s3', 'octal'), FLASH.esp32s3.concat(S3_OCTAL));
  assert.deepEqual(mem('esp32s3', 'octal18'), FLASH.esp32s3.concat(S3_OCTAL));
  assert.deepEqual(mem('esp32s3', 'unknown'), FLASH.esp32s3.concat(S3_OCTAL));
  for (const n of S3_OCTAL) {
    assert.equal(egp.assess('esp32s3', 'quad', n, 'io').level, 'safe');
    assert.equal(egp.assess('esp32s3', 'octal', n, 'io').level, 'avoid');
  }
  for (const n of [47, 48]) {
    assert.equal(egp.assess('esp32s3', 'octal', n, 'io').level, 'safe');
    const a = egp.assess('esp32s3', 'octal18', n, 'io');
    assert.equal(a.level, 'care');
    assert.match(a.summary, /1\.8 V/);
  }
});

test('ESP32-C3 variants: GPIO12-17 are not bonded on the 16-GPIO chips (datasheet Table 1-1 note 6)', () => {
  assert.deepEqual(notBonded('esp32c3', 'p16'), FLASH.esp32c3);
  assert.deepEqual(notBonded('esp32c3', 'p22'), []);
  for (const n of FLASH.esp32c3) assert.equal(egp.assess('esp32c3', 'p16', n, 'io').level, 'na');
  // GPIO11 is VDD_SPI on every variant
  for (const mod of ['unknown', 'p22', 'p16']) assert.equal(egp.assess('esp32c3', mod, 11, 'io').level, 'avoid');
  // 22 - 6 = 16 usable GPIOs on the 16-GPIO variants
  const available = CHIPS.esp32c3.gpios.filter((n) => egp.assess('esp32c3', 'p16', n, 'in').level !== 'na');
  assert.equal(available.length, 16);
});

test('ESP32-C6 packages: QFN40 lacks GPIO14, QFN32 lacks GPIO10/11 and the flash pins (ESP-IDF, datasheet Tables 2-4/2-5)', () => {
  assert.deepEqual(notBonded('esp32c6', 'qfn40'), [14]);
  assert.deepEqual(notBonded('esp32c6', 'qfn32'), [10, 11].concat(range(24, 30)));
  // ESP-IDF: "only the remaining 22 GPIO pins are available" with SiP flash
  const qfn32 = CHIPS.esp32c6.gpios.filter((n) => egp.assess('esp32c6', 'qfn32', n, 'in').level !== 'na');
  assert.equal(qfn32.length, 22);
  // QFN40 leads out 30 GPIO pads (GPIO14 missing), of which 7 serve the flash
  const qfn40 = CHIPS.esp32c6.gpios.filter((n) => egp.assess('esp32c6', 'qfn40', n, 'in').level !== 'na');
  assert.equal(qfn40.length, 30);
  // Unknown package: the three package-dependent pins get a caution
  for (const n of [10, 11, 14]) assert.equal(egp.assess('esp32c6', 'unknown', n, 'io').level, 'care');
});

test('verdicts reproduce the datasheet pin priorities (P2 = safe) for digital I/O', () => {
  assert.deepEqual(pinsWith('esp32c3', 'p22', 'io', 'safe'), PRIORITY2.esp32c3);
  assert.deepEqual(pinsWith('esp32c6', 'qfn40', 'io', 'safe'), PRIORITY2.esp32c6_qfn40);
  assert.deepEqual(pinsWith('esp32c6', 'qfn32', 'io', 'safe'), PRIORITY2.esp32c6_qfn32);
  assert.deepEqual(pinsWith('esp32s3', 'octal', 'io', 'safe'), sorted(PRIORITY2.esp32s3));
  assert.deepEqual(pinsWith('esp32', 'flash', 'io', 'safe'), ESP32_FREE_NO_PSRAM);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pin data against ESPHome's own validation lists
// ─────────────────────────────────────────────────────────────────────────────

for (const id of CHIP_IDS) {
  test(`${id}: strapping and flash pin sets equal ESPHome 2026.10.0's validation lists`, () => {
    const chip = CHIPS[id];
    const eh = ESPHOME[id];
    // The tool's ESPHome model is a faithful copy of ESPHome's lists
    assert.equal(chip.esphome.maxPin, eh.maxPin);
    assert.deepEqual(sorted(chip.esphome.strapping), eh.strapping);
    assert.deepEqual(keys(chip.esphome.errorPins).filter((n) => chip.esphome.errorPins[n] === 'flash'), eh.flashError);
    assert.deepEqual(keys(chip.esphome.errorPins).filter((n) => chip.esphome.errorPins[n] === 'unusable'), eh.unusable);
    assert.deepEqual(keys(chip.esphome.warnPins), eh.flashWarn);
    assert.deepEqual(sorted(chip.esphome.usbJtag), eh.usbJtag);
    assert.deepEqual(sorted(chip.esphome.inputOnly), eh.inputOnly);
    // ... and the datasheet data agrees with ESPHome
    assert.deepEqual(keys(chip.strapping), eh.strapping, 'strapping pins: datasheet = ESPHome');
    // Flash + VDD_SPI pins. One known disagreement: ESPHome does not list the ESP32-C3 VDD_SPI pin
    // (GPIO11), the datasheet does (Table 2-1 note 8), and the tool keeps the stricter "avoid".
    const known = id === 'esp32c3' ? [11] : [];
    assert.deepEqual(sorted(FLASH[id].concat(VDD_SPI[id])).filter((n) => !known.includes(n)),
      sorted(eh.flashError.concat(eh.flashWarn)), 'flash pins: datasheet = ESPHome');
    assert.deepEqual(sorted(FLASH[id]), sorted(eh.flashError.concat(eh.flashWarn)).filter((n) => !VDD_SPI[id].includes(n)));
    assert.deepEqual(keys(chip.usb), eh.usbJtag, 'USB-JTAG pins: datasheet = ESPHome');
    assert.deepEqual(sorted(chip.inputOnly), eh.inputOnly, 'input-only pins: datasheet = ESPHome');
    // ESPHome's "unusable" pins are exactly the numbering gaps up to its max pin
    const gaps = range(0, eh.maxPin).filter((n) => !chip.gpios.includes(n));
    for (const n of eh.unusable) assert.ok(gaps.includes(n), `GPIO${n} is a gap`);
  });

  test(`${id}: ADC, touch, wake, DAC and UART0 pins equal ESPHome's component tables`, () => {
    const chip = CHIPS[id];
    assert.deepEqual(numMap(chip.adc1), numMap(ESPHOME_ADC1[id]));
    assert.deepEqual(numMap(chip.adc2), numMap(ESPHOME_ADC2[id]));
    assert.deepEqual(keys(chip.rtc), ESPHOME_WAKE[id]);
    assert.deepEqual(numMap(chip.touch), numMap(ESPHOME_TOUCH[id] || {}));
    assert.deepEqual(keys(chip.dac), ESPHOME_DAC[id] || []);
    const tx = Number(Object.keys(chip.uart0).find((k) => chip.uart0[k] === 'TX'));
    const rx = Number(Object.keys(chip.uart0).find((k) => chip.uart0[k] === 'RX'));
    assert.deepEqual({ tx, rx }, ESPHOME_UART0[id]);
  });
}

test('ESP32-S3: the octal PSRAM pins equal ESPHome\'s _ESP32S3R8_PSRAM_PINS', () => {
  assert.deepEqual(sorted(CHIPS.esp32s3.esphome.octalWarn), ESPHOME.esp32s3.octal);
  assert.deepEqual(S3_OCTAL, ESPHOME.esp32s3.octal);
});

test('ESPHome cross-check reports what ESPHome itself would do', () => {
  assert.equal(egp.esphomeCheck('esp32', 'unknown', 6, 'io').level, 'error');
  assert.match(egp.esphomeCheck('esp32', 'unknown', 6, 'io').messages.join(' '), /ignore_pin_validation_error/);
  assert.equal(egp.esphomeCheck('esp32', 'unknown', 9, 'io').level, 'warning');
  assert.equal(egp.esphomeCheck('esp32', 'unknown', 0, 'io').level, 'warning');
  assert.equal(egp.esphomeCheck('esp32', 'unknown', 4, 'io').level, 'ok');
  assert.equal(egp.esphomeCheck('esp32', 'unknown', 34, 'io').level, 'error');
  assert.equal(egp.esphomeCheck('esp32', 'unknown', 34, 'in').level, 'ok');
  assert.equal(egp.esphomeCheck('esp32', 'unknown', 40, 'io').level, 'error');
  // Touch pins take a plain number in ESPHome: no strapping warning there
  assert.equal(egp.esphomeCheck('esp32', 'unknown', 0, 'touch').level, 'ok');
  assert.equal(egp.esphomeCheck('esp32s3', 'unknown', 19, 'io').level, 'warning');
  assert.equal(egp.esphomeCheck('esp32s3', 'octal', 35, 'io').level, 'warning');
  assert.equal(egp.esphomeCheck('esp32s3', 'quad', 35, 'io').level, 'ok');
  assert.equal(egp.esphomeCheck('esp32c6', 'qfn40', 27, 'io').level, 'error');
  assert.equal(egp.esphomeCheck('esp32c3', 'p22', 11, 'io').level, 'ok', 'ESPHome does not check VDD_SPI on the C3');
  assert.equal(egp.assess('esp32c3', 'p22', 11, 'io').level, 'avoid', '... but the datasheet does, and the stricter verdict wins');
});

// ─────────────────────────────────────────────────────────────────────────────
// Filter logic and verdict ranking
// ─────────────────────────────────────────────────────────────────────────────

test('every need is defined once and every chip/module/need combination assesses every GPIO', () => {
  const ids = NEEDS.map((n) => n.id);
  assert.deepEqual(ids, ['io', 'in', 'i2c', 'spi', 'uart', 'pwm', 'adc', 'touch', 'wake', 'dac']);
  for (const id of CHIP_IDS) {
    for (const m of CHIPS[id].modules) {
      for (const need of ids) {
        for (const wifi of [true, false]) {
          const list = egp.rankPins(id, m.id, need, { wifi });
          assert.equal(list.length, CHIPS[id].gpios.length);
          for (const a of list) {
            assert.ok(egp.LEVELS.includes(a.level), `${id}/${m.id}/${need} GPIO${a.gpio}: ${a.level}`);
            assert.ok(a.summary && a.summary.length > 5);
          }
        }
      }
    }
  }
});

test('ranking puts safe before care before avoid before unusable, then by score, then by GPIO', () => {
  for (const id of CHIP_IDS) {
    for (const need of NEEDS.map((n) => n.id)) {
      const list = egp.rankPins(id, 'unknown', need, { wifi: true });
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1];
        const b = list[i];
        const la = egp.LEVELS.indexOf(a.level);
        const lb = egp.LEVELS.indexOf(b.level);
        assert.ok(la < lb || (la === lb && (a.score < b.score || (a.score === b.score && a.gpio < b.gpio))),
          `${id}/${need}: GPIO${a.gpio} (${a.level}/${a.score}) before GPIO${b.gpio} (${b.level}/${b.score})`);
      }
    }
  }
});

test('strapping pins are "use with care" for digital I/O, and "avoid" for I2C (ESPHome FAQ)', () => {
  for (const id of CHIP_IDS) {
    for (const n of STRAPPING[id]) {
      const io = egp.assess(id, 'unknown', n, 'io');
      assert.ok(io.level === 'care' || io.level === 'avoid', `${id} GPIO${n}`);
      assert.equal(egp.assess(id, 'unknown', n, 'i2c').level, 'avoid', `${id} GPIO${n} I2C`);
    }
  }
  // The flash-voltage straps rank last among the strapping pins
  const esp32 = egp.rankPins('esp32', 'flash', 'io').filter((a) => STRAPPING.esp32.includes(a.gpio)).map((a) => a.gpio);
  assert.equal(esp32[esp32.length - 1], 12);
  assert.match(egp.assess('esp32', 'flash', 12, 'io').summary, /1\.8 V/);
  const s3 = egp.rankPins('esp32s3', 'quad', 'io').filter((a) => STRAPPING.esp32s3.includes(a.gpio)).map((a) => a.gpio);
  assert.equal(s3[s3.length - 1], 45);
});

test('USB, UART0 and JTAG pins are "use with care"', () => {
  for (const id of CHIP_IDS) {
    for (const n of Object.keys(USB[id]).concat(Object.keys(UART0[id])).concat(Object.keys(JTAG[id])).map(Number)) {
      assert.equal(egp.assess(id, 'unknown', n, 'io').level, 'care', `${id} GPIO${n}`);
    }
  }
});

test('input-only pins: unusable for output needs, fine as inputs, MISO/RX only on buses', () => {
  for (const n of INPUT_ONLY.esp32) {
    for (const need of ['io', 'i2c', 'pwm']) assert.equal(egp.assess('esp32', 'flash', n, need).level, 'no', `GPIO${n} ${need}`);
    for (const need of ['spi', 'uart']) assert.equal(egp.assess('esp32', 'flash', n, need).level, 'care', `GPIO${n} ${need}`);
    assert.equal(egp.assess('esp32', 'flash', n, 'adc').level, 'safe', `GPIO${n} adc`);
    assert.equal(egp.assess('esp32', 'flash', n, 'wake').level, 'safe', `GPIO${n} wake`);
  }
  // ESP-IDF: don't use the interrupt of GPIO36/39 with ADC or Wi-Fi sleep (errata GPIO-3.11)
  assert.equal(egp.assess('esp32', 'flash', 36, 'in').level, 'care');
  assert.equal(egp.assess('esp32', 'flash', 39, 'in').level, 'care');
  assert.equal(egp.assess('esp32', 'flash', 34, 'in').level, 'safe');
});

test('ADC filter: only ADC pins qualify, ADC1 ranks first, and each chip\'s ADC2 rule applies', () => {
  for (const id of CHIP_IDS) {
    const capable = sorted(egp.rankPins(id, 'unknown', 'adc').filter((a) => a.level !== 'no' && a.level !== 'na').map((a) => a.gpio));
    assert.deepEqual(capable, sorted(Object.keys(ADC1[id]).concat(Object.keys(ADC2[id]))));
  }
  // ESP32: ADC2 cannot be used while Wi-Fi is on (ESP-IDF GPIO reference)
  for (const n of Object.keys(ADC2.esp32).map(Number)) {
    assert.equal(egp.assess('esp32', 'flash', n, 'adc', { wifi: true }).level, 'avoid', `GPIO${n}`);
  }
  assert.equal(egp.assess('esp32', 'flash', 4, 'adc', { wifi: false }).level, 'safe');
  assert.equal(egp.assess('esp32', 'flash', 25, 'adc', { wifi: false }).level, 'safe');
  // S3: ADC2 shared with Wi-Fi through the arbiter -> care while Wi-Fi is on
  assert.equal(egp.assess('esp32s3', 'quad', 11, 'adc', { wifi: true }).level, 'care');
  assert.equal(egp.assess('esp32s3', 'quad', 11, 'adc', { wifi: false }).level, 'safe');
  // C3: ADC2 one-shot no longer supported by ESP-IDF, Wi-Fi or not
  assert.equal(egp.assess('esp32c3', 'p22', 5, 'adc', { wifi: true }).level, 'avoid');
  assert.equal(egp.assess('esp32c3', 'p22', 5, 'adc', { wifi: false }).level, 'avoid');
  // ADC1 first: with Wi-Fi off on the ESP32, every safe ADC1 pin ranks before every safe ADC2 pin
  const safe = egp.rankPins('esp32', 'flash', 'adc', { wifi: false }).filter((a) => a.level === 'safe');
  const firstAdc2 = safe.findIndex((a) => a.facts.adc.unit === 2);
  assert.ok(firstAdc2 > 0);
  assert.ok(safe.slice(firstAdc2).every((a) => a.facts.adc.unit === 2));
  // C6 top ADC pick is GPIO0 (ADC1_CH0); GPIO7 has no ADC
  assert.equal(egp.rankPins('esp32c6', 'qfn32', 'adc')[0].gpio, 0);
  assert.equal(egp.assess('esp32c6', 'qfn32', 7, 'adc').level, 'no');
});

test('touch, wake and DAC filters only accept the pins the datasheet lists', () => {
  const capable = (id, need) => sorted(egp.rankPins(id, 'unknown', need).filter((a) => a.level !== 'no' && a.level !== 'na').map((a) => a.gpio));
  for (const id of CHIP_IDS) {
    assert.deepEqual(capable(id, 'touch'), keys(TOUCH[id]));
    assert.deepEqual(capable(id, 'wake'), keys(RTC[id]));
    assert.deepEqual(capable(id, 'dac'), keys(DAC[id]));
  }
  assert.match(egp.assess('esp32c3', 'p22', 4, 'touch').summary, /no capacitive touch/);
  assert.match(egp.assess('esp32c6', 'qfn40', 25, 'dac').summary, /no DAC/);
  assert.match(egp.assess('esp32', 'flash', 25, 'dac').summary, /DAC_1/);
  assert.match(egp.assess('esp32', 'flash', 4, 'touch').summary, /T0/);
});

test('pins that do not exist or are not bonded are "na"', () => {
  assert.equal(egp.assess('esp32', 'flash', 20, 'io').level, 'na');
  assert.equal(egp.assess('esp32s3', 'quad', 22, 'io').level, 'na');
  assert.equal(egp.assess('esp32c6', 'qfn40', 14, 'io').level, 'na');
  assert.equal(egp.assess('esp32c6', 'qfn32', 14, 'io').level, 'safe');
});

// ─────────────────────────────────────────────────────────────────────────────
// ESPHome snippet output
// ─────────────────────────────────────────────────────────────────────────────

test('snippets name the pin and only offer ignore_strapping_warning on ESPHome strapping pins', () => {
  for (const id of CHIP_IDS) {
    for (const n of CHIPS[id].gpios) {
      for (const need of NEEDS.map((x) => x.id)) {
        const y = egp.snippet(id, 'unknown', n, need);
        assert.ok(y.includes('GPIO' + n), `${id} GPIO${n} ${need}`);
        assert.ok(y.endsWith('\n'));
        assert.ok(!/\t/.test(y), 'no tabs in YAML');
        // ESPHome raises "GPIOn is not a strapping pin" if the option is set on any other pin
        const offered = y.includes('ignore_strapping_warning');
        const expected = ESPHOME[id].strapping.includes(n) && need !== 'touch';
        assert.equal(offered, expected, `${id} GPIO${n} ${need}`);
        // never active: always left commented out for the user to decide
        assert.ok(!/^\s*ignore_strapping_warning/m.test(y));
        // every indent is a multiple of two spaces
        for (const line of y.split('\n')) assert.equal((line.match(/^ */)[0].length) % 2, 0, line);
      }
    }
  }
});

test('snippet shapes follow the ESPHome component schemas', () => {
  assert.equal(egp.snippet('esp32', 'flash', 4, 'io'),
    'switch:\n  - platform: gpio\n    name: "GPIO4 output"\n    pin:\n      number: GPIO4\n');
  assert.equal(egp.snippet('esp32', 'flash', 4, 'in'),
    'binary_sensor:\n  - platform: gpio\n    name: "GPIO4 input"\n    pin:\n      number: GPIO4\n      mode:\n        input: true\n        pullup: true\n');
  // GPIO34-39: ESPHome rejects pullups, so none is set
  const in34 = egp.snippet('esp32', 'flash', 34, 'in');
  assert.ok(!in34.includes('pullup: true'));
  assert.match(in34, /external resistor/);
  // esp32_touch takes a plain pin number
  assert.match(egp.snippet('esp32', 'flash', 4, 'touch'), /\n    pin: GPIO4\n    threshold: /);
  assert.match(egp.snippet('esp32', 'flash', 4, 'touch'), /^esp32_touch:\n  setup_mode: true/);
  assert.match(egp.snippet('esp32', 'flash', 32, 'adc'), /platform: adc[\s\S]*number: GPIO32[\s\S]*attenuation: auto/);
  assert.match(egp.snippet('esp32', 'flash', 25, 'dac'), /platform: esp32_dac[\s\S]*number: GPIO25/);
  assert.match(egp.snippet('esp32', 'flash', 18, 'pwm'), /platform: ledc[\s\S]*number: GPIO18[\s\S]*frequency: 1000Hz/);
  assert.match(egp.snippet('esp32c6', 'qfn32', 2, 'wake'), /^deep_sleep:[\s\S]*wakeup_pin:\n    number: GPIO2\n/);
  assert.match(egp.snippet('esp32', 'flash', 21, 'i2c'), /^i2c:\n  sda:\n    number: GPIO21\n  scl: GPIOXX/);
  assert.match(egp.snippet('esp32', 'flash', 18, 'spi'), /^spi:\n  clk_pin:\n    number: GPIO18\n/);
  assert.match(egp.snippet('esp32', 'flash', 35, 'spi'), /miso_pin:\n    number: GPIO35\n/);
  assert.match(egp.snippet('esp32', 'flash', 17, 'uart'), /^uart:\n  tx_pin:\n    number: GPIO17\n[\s\S]*baud_rate: 9600/);
  assert.match(egp.snippet('esp32', 'flash', 39, 'uart'), /rx_pin:\n    number: GPIO39\n/);
  // Placeholders use the GPIOXX form ESPHome refuses to compile
  assert.ok(!/GPIO\?/.test(egp.snippet('esp32', 'flash', 21, 'i2c')));
});

test('strapping snippet carries the commented option inside the pin block', () => {
  const y = egp.snippet('esp32c3', 'p22', 9, 'in');
  assert.match(y, /      number: GPIO9\n      mode:\n        input: true\n        pullup: true\n      # Strapping pin\. [^\n]*\n      # ignore_strapping_warning: true\n$/);
});

// ─────────────────────────────────────────────────────────────────────────────
// URL hash state
// ─────────────────────────────────────────────────────────────────────────────

test('URL hash round-trips every chip, module, need, Wi-Fi setting and pin', () => {
  for (const chip of CHIP_IDS) {
    for (const m of CHIPS[chip].modules) {
      for (const need of NEEDS.map((n) => n.id)) {
        for (const wifi of [true, false]) {
          const pin = CHIPS[chip].gpios[(need.length * 7) % CHIPS[chip].gpios.length];
          const s = { chip, mod: m.id, need, wifi, pin };
          const h = egp.encodeHash(s);
          assert.ok(!/[^A-Za-z0-9=&]/.test(h), h);
          assert.deepEqual(egp.decodeHash('#' + h), s);
        }
      }
    }
  }
});

test('URL hash defaults and rejects invalid values', () => {
  assert.deepEqual(egp.decodeHash(''), egp.defaultState());
  assert.deepEqual(egp.decodeHash('#garbage'), egp.defaultState());
  assert.equal(egp.encodeHash(egp.defaultState()), 'chip=esp32&mod=unknown&need=io&wifi=1');
  // unknown chip / module / need fall back
  assert.deepEqual(egp.decodeHash('#chip=esp32h2&mod=x&need=fly&wifi=0'), { chip: 'esp32', mod: 'unknown', need: 'io', wifi: false, pin: null });
  // a module of another chip is not accepted
  assert.equal(egp.decodeHash('#chip=esp32c3&mod=octal').mod, 'unknown');
  // pins must exist on the chip
  assert.equal(egp.decodeHash('#chip=esp32&pin=20').pin, null);
  assert.equal(egp.decodeHash('#chip=esp32s3&pin=48').pin, 48);
  assert.equal(egp.decodeHash('#chip=esp32&pin=-1').pin, null);
  assert.equal(egp.decodeHash('#chip=esp32&pin=4x').pin, null);
  assert.equal(egp.decodeHash('#chip=esp32&pin=%E0%A4%A').pin, null, 'broken percent-encoding is ignored');
  assert.equal(egp.decodeHash('#pin=0').pin, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source hygiene: the files go inside a WordPress block comment
// ─────────────────────────────────────────────────────────────────────────────

test('tool sources contain no comment delimiters, closing script tags or unicode escapes', () => {
  const dir = path.join(__dirname, '..', 'esp32-gpio-pin-picker');
  const bs = String.fromCharCode(92);
  for (const f of ['index.html', 'style.css', 'script.js']) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!text.includes('<' + '!--'), `${f}: HTML comment opener`);
    assert.ok(!text.includes('--' + '>'), `${f}: comment closer`);
    assert.ok(!new RegExp(bs + bs + 'u[0-9a-fA-F]{4}').test(text), `${f}: unicode escape`);
    // index.html needs its one script tag (outside the wrapper, dropped by the embed builder)
    const closers = text.toLowerCase().split('<' + '/script').length - 1;
    assert.equal(closers, f === 'index.html' ? 1 : 0, `${f}: closing script tags`);
  }
});

test('every source cited by a verdict exists for that chip, with a version and an https link', () => {
  for (const id of CHIP_IDS) {
    const chip = CHIPS[id];
    const ids = new Set(chip.sources.map((s) => s.id));
    for (const s of chip.sources) {
      assert.match(s.url, /^https:\/\//);
      assert.ok(s.version && s.title && s.used);
    }
    for (const m of chip.modules) {
      for (const need of NEEDS.map((n) => n.id)) {
        for (const n of chip.gpios) {
          for (const r of egp.assess(id, m.id, n, need, { wifi: true }).reasons) {
            assert.ok(ids.has(r.src), `${id}/${m.id}/${need} GPIO${n}: unknown source "${r.src}"`);
          }
        }
      }
    }
    assert.match(chip.sources[0].version, /^v\d+\.\d+ \(2026-/, 'datasheet version and date');
  }
});
