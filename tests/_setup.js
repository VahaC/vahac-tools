// tests/_setup.js
// Minimal DOM / browser-global stubs so tool script.js files can be require()'d
// in Node without throwing.  We only need enough surface area for the IIFEs to
// finish executing — none of the tests interact with the DOM directly.

'use strict';

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {};
}

function noop() {}

function stubElement() {
  var el = {
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    checked: false,
    style: {},
    dataset: {},
    children: [],
    childNodes: [],
    parentElement: null,
    classList: {
      add: noop,
      remove: noop,
      toggle: noop,
      contains: function () { return false; }
    },
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    setAttribute: noop,
    getAttribute: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    focus: noop,
    select: noop,
    click: noop,
    remove: noop,
    cloneNode: function () { return stubElement(); }
  };
  return el;
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    readyState: 'complete',
    body: stubElement(),
    addEventListener: noop,
    removeEventListener: noop,
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () { return stubElement(); },
    execCommand: function () { return true; }
  };
}

if (typeof globalThis.location === 'undefined') {
  globalThis.location = {
    hash: '',
    pathname: '/',
    search: '',
    href: 'http://localhost/'
  };
}

if (typeof globalThis.history === 'undefined') {
  globalThis.history = { replaceState: noop, pushState: noop };
}

if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = {
    clipboard: { writeText: function () { return Promise.resolve(); } }
  };
}

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('node:crypto').webcrypto;
}

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = require('node:util').TextEncoder;
}

if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = require('node:url').URL;
}

if (typeof globalThis.URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = require('node:url').URLSearchParams;
}

// Load any script.js file fresh (bust the require cache) and return its exports.
function loadScript(relativePath) {
  var path = require('node:path');
  var abs = path.resolve(__dirname, '..', relativePath);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

module.exports = { loadScript: loadScript, stubElement: stubElement };
