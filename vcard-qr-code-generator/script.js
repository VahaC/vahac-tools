// Dependencies: qrcode-generator v2.0.4 (MIT) — loaded via <script> in index.html
// CDN: https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.min.js

(function () {
  'use strict';

  // Prefixed DOM helper
  var $ = function (id) { return document.getElementById(id); };

  // ── vCard building ──────────────────────────────────────

  function vcardEscape(value) {
    // vCard 3.0 escaping: backslash, semicolon, comma, newlines
    if (value == null) return '';
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .trim();
  }

  function buildVCard(data) {
    var first = vcardEscape(data.first);
    var last  = vcardEscape(data.last);
    var org   = vcardEscape(data.org);
    var title = vcardEscape(data.title);
    var tel   = vcardEscape(data.tel);
    var email = vcardEscape(data.email);
    var url   = vcardEscape(data.url);

    var fn = [data.first, data.last].filter(Boolean).join(' ').trim();
    var fnEsc = vcardEscape(fn);

    var lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:' + last + ';' + first + ';;;',
      'FN:' + (fnEsc || [first, last].filter(Boolean).join(' ')),
      org   ? 'ORG:' + org     : '',
      title ? 'TITLE:' + title : '',
      tel   ? 'TEL;TYPE=CELL:' + tel   : '',
      email ? 'EMAIL:' + email : '',
      url   ? 'URL:' + url    : '',
      'END:VCARD'
    ].filter(Boolean);

    return lines.join('\r\n');
  }

  function getFormData() {
    return {
      first: $('vcg-first').value,
      last:  $('vcg-last').value,
      org:   $('vcg-org').value,
      title: $('vcg-title').value,
      tel:   $('vcg-tel').value,
      email: $('vcg-email').value,
      url:   $('vcg-url').value
    };
  }

  function getQrOpts() {
    return {
      ecl:    $('vcg-ecl').value,
      margin: parseInt($('vcg-margin').value || '4', 10),
      scale:  parseInt($('vcg-scale').value  || '8', 10)
    };
  }

  // ── Toast notification ──────────────────────────────────

  var toastTimer = null;

  function showToast(msg) {
    var toast = $('vcg-toast');
    toast.textContent = msg;
    toast.classList.add('vcg-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('vcg-show');
    }, 2000);
  }

  // ── QR rendering ────────────────────────────────────────

  function renderQr(text, opts) {
    var canvas = $('vcg-qr-canvas');
    var status = $('vcg-status');

    try {
      if (typeof window.qrcode !== 'function') {
        throw new Error('qrcode-generator library not loaded.');
      }

      // qrcode-generator API: typeNumber 0 = auto, ecl = L/M/Q/H
      var qr = window.qrcode(0, opts.ecl);
      qr.addData(text);
      qr.make();

      // Create PNG data URL (cellSize, margin)
      var dataUrl = qr.createDataURL(opts.scale, opts.margin);
      var ctx = canvas.getContext('2d');
      var img = new Image();

      img.onload = function () {
        canvas.width  = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        status.textContent = 'QR generated. Payload: ' + text.length + ' chars.';
      };

      img.onerror = function () {
        status.textContent = 'Failed to render QR image.';
      };

      img.src = dataUrl;
    } catch (err) {
      console.error(err);
      status.textContent = 'QR generation failed. See console.';
    }
  }

  // ── Generate ────────────────────────────────────────────

  function generate() {
    var data  = getFormData();
    var vcard = buildVCard(data);
    $('vcg-output').value = vcard;
    renderQr(vcard, getQrOpts());
    saveToHash(data);
  }

  // ── File downloads ──────────────────────────────────────

  function downloadBlob(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  function downloadVcf() {
    var vcard = $('vcg-output').value || buildVCard(getFormData());
    downloadBlob('contact.vcf', vcard, 'text/vcard;charset=utf-8');
    showToast('VCF downloaded');
  }

  function downloadPng() {
    var canvas = $('vcg-qr-canvas');
    if (!canvas.width || !canvas.height) {
      showToast('Generate QR first');
      return;
    }
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'vcard-qr.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('PNG downloaded');
  }

  function generateSvgString(text, opts) {
    if (typeof window.qrcode !== 'function') {
      throw new Error('qrcode-generator library not loaded.');
    }
    var qr = window.qrcode(0, opts.ecl);
    qr.addData(text);
    qr.make();

    // qrcode-generator may expose createSvgTag or createSVGTag
    var makeSvg = qr.createSvgTag || qr.createSVGTag;
    if (!makeSvg) {
      throw new Error('SVG export not supported by this qrcode-generator build.');
    }

    var raw = makeSvg.call(qr, opts.scale, opts.margin);
    return raw.trim().startsWith('<?xml')
      ? raw.trim()
      : '<?xml version="1.0" encoding="UTF-8"?>\n' + raw.trim();
  }

  function downloadSvg() {
    try {
      var vcard = $('vcg-output').value || buildVCard(getFormData());
      var svg   = generateSvgString(vcard, getQrOpts());
      downloadBlob('vcard-qr.svg', svg, 'image/svg+xml;charset=utf-8');
      showToast('SVG downloaded');
    } catch (err) {
      console.error(err);
      $('vcg-status').textContent = 'SVG export failed. See console.';
    }
  }

  // ── Clipboard (Clipboard API with execCommand fallback) ─

  function copyVcard() {
    var vcard = $('vcg-output').value || buildVCard(getFormData());
    $('vcg-output').value = vcard;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(vcard).then(function () {
        showToast('vCard copied to clipboard');
      }).catch(function () {
        fallbackCopy(vcard);
      });
    } else {
      fallbackCopy(vcard);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    ta.remove();
    showToast(ok ? 'vCard copied to clipboard' : 'Copy failed — try manually');
  }

  // ── URL hash state (share / bookmark inputs) ────────────

  function saveToHash(data) {
    var params = new URLSearchParams();
    var keys = ['first', 'last', 'org', 'title', 'tel', 'email', 'url'];
    keys.forEach(function (k) {
      if (data[k]) params.set(k, data[k]);
    });
    var hash = params.toString();
    if (hash) {
      history.replaceState(null, '', '#' + hash);
    }
  }

  function loadFromHash() {
    var hash = location.hash.slice(1);
    if (!hash) return false;

    try {
      var params = new URLSearchParams(hash);
      var fields = {
        first: 'vcg-first',
        last:  'vcg-last',
        org:   'vcg-org',
        title: 'vcg-title',
        tel:   'vcg-tel',
        email: 'vcg-email',
        url:   'vcg-url'
      };
      var filled = false;
      Object.keys(fields).forEach(function (key) {
        var val = params.get(key);
        if (val) {
          $(fields[key]).value = val;
          filled = true;
        }
      });
      return filled;
    } catch (e) {
      return false;
    }
  }

  // ── Keyboard support (Enter triggers generate) ──────────

  function setupKeyboard() {
    var wrapper = document.querySelector('.vcg-wrapper');
    if (!wrapper) return;

    wrapper.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var tag = e.target.tagName;
      // Only trigger on inputs and selects, not textarea or buttons
      if (tag === 'INPUT' || tag === 'SELECT') {
        e.preventDefault();
        generate();
      }
    });
  }

  // ── Init ────────────────────────────────────────────────

  function init() {
    setupKeyboard();
    if (loadFromHash()) {
      generate();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose global handlers for onclick attributes
  window.vcgGenerate    = generate;
  window.vcgDownloadVcf = downloadVcf;
  window.vcgDownloadPng = downloadPng;
  window.vcgDownloadSvg = downloadSvg;
  window.vcgCopyVcard   = copyVcard;

})();
