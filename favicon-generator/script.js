// Favicon Generator — script.js
// Dependencies: JSZip 3.10.1 (MIT) — loaded via <script> in index.html
//   https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js

(function () {
  'use strict';

  // === DOM helper ===
  var $ = function (id) { return document.getElementById(id); };

  // === State ===
  var state = {
    sourceImg: null,
    fileName: 'favicon',
    previewBg: 'checker'
  };

  // === Size definitions ===
  // ico: true = included in favicon.ico binary
  var SIZES = [
    { name: 'favicon-16x16.png',           w: 16,  h: 16,  label: 'favicon.ico', sub: '16×16',   disp: 80,  ico: true  },
    { name: 'favicon-32x32.png',           w: 32,  h: 32,  label: 'favicon.ico', sub: '32×32',   disp: 80,  ico: true  },
    { name: 'apple-touch-icon.png',        w: 180, h: 180, label: 'Apple Touch', sub: '180×180', disp: 90,  ico: false },
    { name: 'android-chrome-192x192.png',  w: 192, h: 192, label: 'Android PWA', sub: '192×192', disp: 96,  ico: false },
    { name: 'android-chrome-512x512.png',  w: 512, h: 512, label: 'Android PWA', sub: '512×512', disp: 128, ico: false }
  ];

  // ============================================================
  // Utility
  // ============================================================

  function showToast(msg) {
    var t = $('fvg-toast');
    t.textContent = msg || '✅ Done!';
    t.classList.add('fvg-show');
    setTimeout(function () { t.classList.remove('fvg-show'); }, 2200);
  }

  function showError(msg) {
    var el = $('fvg-error-msg');
    el.textContent = msg;
    el.classList.add('fvg-visible');
  }

  function hideError() {
    var el = $('fvg-error-msg');
    el.textContent = '';
    el.classList.remove('fvg-visible');
  }

  function setHidden(id, hidden) {
    var el = $(id);
    if (!el) return;
    if (hidden) el.classList.add('fvg-hidden');
    else el.classList.remove('fvg-hidden');
  }

  // ============================================================
  // Current option values
  // ============================================================

  function getBgColor() {
    var val = $('fvg-bg-select').value;
    if (val === 'transparent') return null;
    if (val === 'custom') return $('fvg-color-input').value;
    return val;
  }

  function getPaddingPct() {
    return parseInt($('fvg-padding-select').value, 10);
  }

  function getShapeRadiusPct() {
    return parseInt($('fvg-shape-select').value, 10);
  }

  function getThemeColor() {
    return getBgColor() || '#ffffff';
  }

  // ============================================================
  // Canvas drawing
  // ============================================================

  // Draws a rounded rectangle path onto ctx.
  // radiusPx is clamped to half of min(w,h) to prevent overdraw.
  function roundedRectPath(ctx, x, y, w, h, radiusPx) {
    var r = Math.min(radiusPx, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h, x,     y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x,     y,     x + r, y,         r);
    ctx.closePath();
  }

  // Renders the source image onto a given canvas using current option values.
  function drawToCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    var size = canvas.width; // always square
    var bgColor = getBgColor();
    var paddingPct = getPaddingPct();
    var shapePct = getShapeRadiusPct();

    ctx.clearRect(0, 0, size, size);

    // Apply shape clipping BEFORE filling background
    var clipped = shapePct > 0;
    if (clipped) {
      ctx.save();
      var r = size * shapePct / 100;
      roundedRectPath(ctx, 0, 0, size, size, r);
      ctx.clip();
    }

    // Background fill (null = transparent, already cleared)
    if (bgColor) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);
    }

    // Calculate draw area with padding
    var pad = size * paddingPct / 100;
    var area = size - pad * 2;

    // Aspect-fit source image within draw area
    var srcW = state.sourceImg.naturalWidth;
    var srcH = state.sourceImg.naturalHeight;
    var ratio = Math.min(area / srcW, area / srcH);
    var dw = srcW * ratio;
    var dh = srcH * ratio;
    var dx = (size - dw) / 2;
    var dy = (size - dh) / 2;

    ctx.drawImage(state.sourceImg, dx, dy, dw, dh);

    if (clipped) {
      ctx.restore();
    }
  }

  // ============================================================
  // Preview grid
  // ============================================================

  function buildPreviewGrid() {
    var grid = $('fvg-preview-grid');
    grid.innerHTML = '';

    SIZES.forEach(function (sz, idx) {
      var item = document.createElement('div');
      item.className = 'fvg-preview-item';

      // Canvas wrapper (background pattern applied here)
      var wrap = document.createElement('div');
      wrap.className = 'fvg-preview-canvas-wrap fvg-checker';
      wrap.style.width  = sz.disp + 'px';
      wrap.style.height = sz.disp + 'px';
      wrap.style.borderRadius = '6px';

      // Canvas at real pixel dimensions, displayed at disp size
      var cv = document.createElement('canvas');
      cv.id = 'fvg-prev-' + idx;
      cv.width  = sz.w;
      cv.height = sz.h;
      cv.className = 'fvg-preview-canvas';
      cv.style.width  = sz.disp + 'px';
      cv.style.height = sz.disp + 'px';

      // Pixelated upscaling for small sizes (16×16, 32×32)
      if (sz.w <= 32) {
        cv.style.imageRendering = 'pixelated';
        cv.style.imageRendering = 'crisp-edges'; // Firefox fallback
        cv.style.imageRendering = 'pixelated';   // Re-apply (Chrome wins)
      }

      wrap.appendChild(cv);

      // Labels
      var labelEl = document.createElement('div');
      labelEl.className = 'fvg-preview-label';
      labelEl.textContent = sz.label;

      var subEl = document.createElement('div');
      subEl.className = 'fvg-preview-size';
      subEl.textContent = sz.sub;

      item.appendChild(wrap);
      item.appendChild(labelEl);
      item.appendChild(subEl);
      grid.appendChild(item);
    });

    // Apply current background mode
    fvgSetPreviewBg(state.previewBg);
  }

  function updatePreviews() {
    if (!state.sourceImg) return;
    SIZES.forEach(function (sz, idx) {
      var cv = $('fvg-prev-' + idx);
      if (cv) drawToCanvas(cv);
    });
    updateSnippet();
  }

  window.fvgUpdatePreviews = updatePreviews;

  // ============================================================
  // Preview background toggle
  // ============================================================

  window.fvgSetPreviewBg = function (mode) {
    state.previewBg = mode;

    // Update canvas wrapper backgrounds
    var wraps = document.querySelectorAll('.fvg-preview-canvas-wrap');
    wraps.forEach(function (el) {
      el.classList.remove('fvg-checker', 'fvg-bg-light', 'fvg-bg-dark');
      if (mode === 'checker') el.classList.add('fvg-checker');
      else if (mode === 'light') el.classList.add('fvg-bg-light');
      else el.classList.add('fvg-bg-dark');
    });

    // Update active state on toggle buttons
    ['checker', 'light', 'dark'].forEach(function (m) {
      var btn = $('fvg-toggle-' + m);
      if (!btn) return;
      if (m === mode) btn.classList.add('fvg-active');
      else btn.classList.remove('fvg-active');
    });
  };

  // ============================================================
  // Background select change handler
  // ============================================================

  window.fvgOnBgChange = function () {
    var val = $('fvg-bg-select').value;
    setHidden('fvg-color-wrap', val !== 'custom');
    updatePreviews();
  };

  // ============================================================
  // HTML snippet
  // ============================================================

  function updateSnippet() {
    var tc = getThemeColor();
    var lines = [
      '<link rel="icon" type="image/x-icon" href="/favicon.ico">',
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
      '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
      '<link rel="manifest" href="/site.webmanifest">',
      '<meta name="theme-color" content="' + tc + '">'
    ];
    $('fvg-snippet-code').textContent = lines.join('\n');
  }

  window.fvgCopySnippet = function () {
    var text = $('fvg-snippet-code').textContent;
    copyText(text, '✅ Snippet copied!');
  };

  function copyText(text, toastMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { showToast(toastMsg); })
        .catch(function () { execCommandCopy(text, toastMsg); });
    } else {
      execCommandCopy(text, toastMsg);
    }
  }

  function execCommandCopy(text, toastMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast(toastMsg || '✅ Copied!'); } catch (e) {}
    document.body.removeChild(ta);
  }

  // ============================================================
  // ICO encoder
  // Builds a modern ICO binary with embedded PNG data (RFC-compliant,
  // supported in all browsers since IE9+).
  // Ref: https://en.wikipedia.org/wiki/ICO_(file_format)
  // ============================================================

  function buildIco(pngImages) {
    // pngImages: array of {width, height, data: Uint8Array (PNG bytes)}
    var count = pngImages.length;
    var HEADER_BYTES = 6;
    var DIR_ENTRY_BYTES = 16;

    var dataStart = HEADER_BYTES + count * DIR_ENTRY_BYTES;
    var totalBytes = dataStart;
    for (var i = 0; i < count; i++) totalBytes += pngImages[i].data.length;

    var buf = new ArrayBuffer(totalBytes);
    var dv  = new DataView(buf);
    var u8  = new Uint8Array(buf);

    // ICO header
    dv.setUint16(0, 0, true);     // reserved = 0
    dv.setUint16(2, 1, true);     // type = 1 (ICO)
    dv.setUint16(4, count, true); // number of images

    // Directory entries
    var imgOffset = dataStart;
    for (var i = 0; i < count; i++) {
      var img  = pngImages[i];
      var base = HEADER_BYTES + i * DIR_ENTRY_BYTES;
      u8[base + 0] = img.width  >= 256 ? 0 : img.width;   // 0 means 256
      u8[base + 1] = img.height >= 256 ? 0 : img.height;
      u8[base + 2] = 0;   // color count (0 = more than 256 / TrueColor)
      u8[base + 3] = 0;   // reserved
      dv.setUint16(base + 4, 1,               true); // planes
      dv.setUint16(base + 6, 32,              true); // bits per pixel
      dv.setUint32(base + 8, img.data.length, true); // size of image data
      dv.setUint32(base + 12, imgOffset,      true); // offset of image data
      imgOffset += img.data.length;
    }

    // Image data
    imgOffset = dataStart;
    for (var i = 0; i < count; i++) {
      u8.set(pngImages[i].data, imgOffset);
      imgOffset += pngImages[i].data.length;
    }

    return u8;
  }

  // ============================================================
  // Generate all canvases → PNG Uint8Arrays → callback
  // ============================================================

  function generateAllPngs(callback) {
    var results = new Array(SIZES.length);
    var pending = SIZES.length;

    SIZES.forEach(function (sz, idx) {
      var cv = document.createElement('canvas');
      cv.width  = sz.w;
      cv.height = sz.h;
      drawToCanvas(cv);

      cv.toBlob(function (blob) {
        var fr = new FileReader();
        fr.onload = function (e) {
          results[idx] = {
            name:   sz.name,
            width:  sz.w,
            height: sz.h,
            ico:    sz.ico,
            data:   new Uint8Array(e.target.result)
          };
          pending--;
          if (pending === 0) callback(results);
        };
        fr.readAsArrayBuffer(blob);
      }, 'image/png');
    });
  }

  // ============================================================
  // Download ZIP
  // ============================================================

  window.fvgDownload = function () {
    if (!state.sourceImg) return;

    if (typeof JSZip === 'undefined') {
      showError('JSZip library not loaded. Check your internet connection and reload the page.');
      return;
    }

    var btn   = $('fvg-download-btn');
    var label = $('fvg-download-label');
    btn.disabled = true;
    label.textContent = '⏳ Generating…';

    generateAllPngs(function (results) {
      try {
        var zip = new JSZip();
        var folder = zip.folder('favicon-pack');

        // Individual PNGs
        results.forEach(function (r) {
          folder.file(r.name, r.data);
        });

        // favicon.ico — embed 16×16 and 32×32 PNGs
        var icoImages = results.filter(function (r) { return r.ico; });
        if (icoImages.length > 0) {
          folder.file('favicon.ico', buildIco(icoImages));
        }

        // site.webmanifest
        var tc = getThemeColor();
        var manifest = {
          name: '',
          short_name: '',
          icons: [
            { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }
          ],
          theme_color: tc,
          background_color: tc,
          display: 'standalone'
        };
        folder.file('site.webmanifest', JSON.stringify(manifest, null, 2));

        // README
        var snippet = $('fvg-snippet-code').textContent;
        var readme = [
          'Favicon Pack — generated by VahaC Favicon Generator',
          'https://vahac.com/tools/favicon-generator/',
          '',
          'FILES',
          '-----',
          '  favicon.ico                — Multi-size ICO (16×16 + 32×32) — place in site root',
          '  favicon-16x16.png          — 16×16 PNG',
          '  favicon-32x32.png          — 32×32 PNG',
          '  apple-touch-icon.png       — 180×180 for iOS home screen',
          '  android-chrome-192x192.png — 192×192 for Android / PWA',
          '  android-chrome-512x512.png — 512×512 for Android splash screens',
          '  site.webmanifest           — Web App Manifest (update "name" and "short_name"!)',
          '',
          'DEPLOY',
          '------',
          '  1. Place all PNG files and favicon.ico in your website root (/)',
          '     OR update the paths in the HTML snippet and site.webmanifest.',
          '  2. Add the following to your HTML <head>:',
          '',
          snippet,
          '',
          '  3. Edit site.webmanifest: fill in "name" and "short_name" for your site.',
          '',
          'TIPS',
          '----',
          '  - favicon.ico is picked up automatically from / without a <link> tag in most browsers.',
          '  - The <link rel="icon"> tags above take priority and serve the PNG version to modern browsers.',
          '  - theme-color controls the browser chrome color on mobile Chrome.',
          '  - For dark mode support, consider two theme-color meta tags (media="(prefers-color-scheme: dark)").',
        ].join('\n');
        folder.file('README.txt', readme);

        // Generate and trigger download
        zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
          .then(function (content) {
            var url = URL.createObjectURL(content);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'favicon-pack.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 15000);

            btn.disabled = false;
            label.textContent = '⬇️ Download favicon-pack.zip';
            showToast('✅ favicon-pack.zip downloaded!');
          })
          .catch(function (err) {
            btn.disabled = false;
            label.textContent = '⬇️ Download favicon-pack.zip';
            showError('ZIP generation failed: ' + err.message);
          });

      } catch (err) {
        btn.disabled = false;
        label.textContent = '⬇️ Download favicon-pack.zip';
        showError('Error: ' + err.message);
      }
    });
  };

  // ============================================================
  // File handling
  // ============================================================

  function handleFile(file) {
    if (!file) return;
    if (!file.type.match('image.*')) {
      showError('Please select a valid image file (SVG, PNG, JPG, WEBP).');
      return;
    }
    hideError();

    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        state.sourceImg = img;
        state.fileName = file.name.replace(/\.[^.]+$/, '');

        // Populate source info
        $('fvg-source-thumb').src = e.target.result;
        $('fvg-source-name').textContent = file.name;
        $('fvg-source-dims').textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';

        // Warn on tiny source
        if (img.naturalWidth < 64 || img.naturalHeight < 64) {
          showError('⚠️ Source image is very small (' + img.naturalWidth + '×' + img.naturalHeight + ' px). Results may appear blurry. Recommended: min 512×512 px.');
        }

        // Switch UI state
        setHidden('fvg-dropzone', true);
        setHidden('fvg-panel', false);
        setHidden('fvg-preview-section', false);

        buildPreviewGrid();
        updatePreviews();
      };
      img.onerror = function () {
        showError('Could not decode image. Make sure the file is a valid image.');
      };
      img.src = e.target.result;
    };
    reader.onerror = function () {
      showError('Could not read the file.');
    };
    reader.readAsDataURL(file);
  }

  // ============================================================
  // Reset
  // ============================================================

  window.fvgReset = function () {
    state.sourceImg = null;
    var fi = $('fvg-file-input');
    if (fi) fi.value = '';
    setHidden('fvg-panel', true);
    setHidden('fvg-preview-section', true);
    setHidden('fvg-dropzone', false);
    setHidden('fvg-color-wrap', true);
    hideError();
    $('fvg-preview-grid').innerHTML = '';
    $('fvg-snippet-code').textContent = '';
    $('fvg-bg-select').value = 'transparent';
    $('fvg-padding-select').value = '10';
    $('fvg-shape-select').value = '0';
  };

  // ============================================================
  // Init — event listeners
  // ============================================================

  function init() {
    var dropzone  = $('fvg-dropzone');
    var fileInput = $('fvg-file-input');

    // Click on dropzone → open file dialog
    dropzone.addEventListener('click', function (e) {
      if (e.target !== fileInput) fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      if (this.files && this.files[0]) handleFile(this.files[0]);
    });

    // Drag & drop on dropzone
    dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('fvg-dropzone--dragover');
    });

    dropzone.addEventListener('dragleave', function (e) {
      e.stopPropagation();
      dropzone.classList.remove('fvg-dropzone--dragover');
    });

    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('fvg-dropzone--dragover');
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    // Global drag & drop: allow dropping anywhere on the page (e.g. after upload zone is hidden)
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && file.type.match('image.*')) handleFile(file);
    });

    // Paste (Ctrl+V) support
    document.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.match('image.*')) {
          var file = items[i].getAsFile();
          if (file) {
            handleFile(file);
            break;
          }
        }
      }
    });
  }

  init();

})();
