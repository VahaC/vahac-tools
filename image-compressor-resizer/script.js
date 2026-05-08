/**
 * Image Compressor & Resizer — script.js
 * Namespace prefix: icr
 *
 * Dependencies:
 *   JSZip 3.10.1 (MIT) — loaded via <script> in index.html
 *   EXIF orientation: inline parser, no external lib needed
 *
 * Features:
 *   - Drag & drop / click-to-browse, multiple files
 *   - Format conversion: Original / JPEG / PNG / WebP
 *   - Quality slider (JPEG & WebP only)
 *   - Resize with aspect-ratio lock
 *   - EXIF orientation auto-correction
 *   - Before / after thumbnails per card
 *   - Batch ZIP download via JSZip
 *   - URL hash state for format + quality
 */

(function () {
  'use strict';

  /* ── DOM helper ─────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };

  /* ── State ──────────────────────────────────────────── */
  var icr_files     = [];        // array of entry objects
  var icr_uid       = 0;         // auto-increment for unique IDs
  var icr_fmt       = 'original';// 'original' | MIME string
  var icr_locked    = true;      // aspect ratio lock
  var icr_busy      = false;     // processing mutex
  var icr_toast_t;               // toast auto-hide timer
  var icr_modal_fit   = true;    // modal: true = fit-to-screen, false = actual-size
  var icr_modal_entry = null;    // entry open in modal in Result mode
  var icr_modal_qual_t;          // modal quality re-compress debounce
  var ICR_DEFAULT_QUAL = 0.82;   // default quality for new entries

  /* ── Array helpers (IE-safe, though Canvas requires modern) ─ */
  function arrFind(arr, fn) {
    for (var i = 0; i < arr.length; i++) { if (fn(arr[i])) return arr[i]; }
    return null;
  }
  function arrFindIdx(arr, fn) {
    for (var i = 0; i < arr.length; i++) { if (fn(arr[i])) return i; }
    return -1;
  }
  function arrSome(arr, fn) {
    for (var i = 0; i < arr.length; i++) { if (fn(arr[i])) return true; }
    return false;
  }

  /* ── Init ────────────────────────────────────────────── */
  function init() {
    setupDropzone();
    setupResizeInputs();
    setupModalQualitySlider();
    restoreFromHash();
  }

  /* ── Dropzone ────────────────────────────────────────── */
  function setupDropzone() {
    var dz = $('icr-dropzone');
    var fi = $('icr-file-input');
    var bl = $('icr-browse-link');

    // Browse link click: open file picker without triggering the outer dz click
    bl.addEventListener('click', function (e) {
      e.stopPropagation();
      fi.click();
    });

    fi.addEventListener('change', function () {
      addFiles(fi.files);
      fi.value = '';
    });

    // Clicking the dropzone area (not the browse link) opens file picker
    dz.addEventListener('click', function (e) {
      if (e.target !== bl) fi.click();
    });

    // Keyboard accessibility
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fi.click();
      }
    });

    // Drag events
    dz.addEventListener('dragenter', function (e) { e.preventDefault(); });

    dz.addEventListener('dragover', function (e) {
      e.preventDefault();
      dz.classList.add('icr-drag-over');
    });

    dz.addEventListener('dragleave', function (e) {
      // Only remove class when truly leaving the dropzone
      if (!dz.contains(e.relatedTarget)) {
        dz.classList.remove('icr-drag-over');
      }
    });

    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('icr-drag-over');
      addFiles(e.dataTransfer.files);
    });
  }

  /* ── Resize Inputs ───────────────────────────────────── */
  function setupResizeInputs() {
    $('icr-w-input').addEventListener('input', function () {
      if (!icr_locked) return;
      var w = parseInt(this.value);
      if (!w) { $('icr-h-input').value = ''; return; }
      // Use first loaded image to preview the proportional height
      var first = arrFind(icr_files, function (e) { return e.img; });
      if (first && first.originalW) {
        $('icr-h-input').value = Math.round(first.originalH * (w / first.originalW));
      }
    });

    $('icr-h-input').addEventListener('input', function () {
      if (!icr_locked) return;
      var h = parseInt(this.value);
      if (!h) { $('icr-w-input').value = ''; return; }
      var first = arrFind(icr_files, function (e) { return e.img; });
      if (first && first.originalH) {
        $('icr-w-input').value = Math.round(first.originalW * (h / first.originalH));
      }
    });
  }

  /* ── Add Files ───────────────────────────────────────── */
  function addFiles(fileList) {
    var arr = [];
    for (var i = 0; i < fileList.length; i++) {
      if (fileList[i].type.indexOf('image/') === 0) arr.push(fileList[i]);
    }
    if (!arr.length) {
      showToast('⚠️ No valid image files found', 'warning');
      return;
    }
    for (var j = 0; j < arr.length; j++) {
      var entry = {
        id:           'f' + (++icr_uid),
        file:         arr[j],
        img:          null,
        orientation:  1,
        originalW:    0,
        originalH:    0,
        objectUrl:    null,
        afterUrl:     null,
        blob:         null,
        qual:         ICR_DEFAULT_QUAL,  // per-entry quality (0.01–1.0)
        outputMime:   '',
        outputW:      0,
        outputH:      0,
        outputExt:    '',
        outputQual:   ICR_DEFAULT_QUAL,
        status:       'pending'
      };
      icr_files.push(entry);
      loadEntry(entry);
    }
    showPanel();
  }

  /* ── Load a single entry ─────────────────────────────── */
  function loadEntry(entry) {
    var reader = new FileReader();
    reader.onload = function (e) {
      // Parse EXIF orientation from raw ArrayBuffer
      entry.orientation = parseExifOrientation(e.target.result);

      var url = URL.createObjectURL(entry.file);
      entry.objectUrl = url;

      var img = new Image();
      img.onload = function () {
        entry.img = img;
        // Store VISUAL (corrected) dimensions: for rotated images, W and H are swapped
        var o = entry.orientation;
        if (o >= 5 && o <= 8) {
          entry.originalW = img.naturalHeight;
          entry.originalH = img.naturalWidth;
        } else {
          entry.originalW = img.naturalWidth;
          entry.originalH = img.naturalHeight;
        }
        renderCard(entry);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        entry.status = 'error';
        renderCardError(entry);
      };
      img.src = url;
    };
    reader.onerror = function () {
      entry.status = 'error';
      renderCardError(entry);
    };
    reader.readAsArrayBuffer(entry.file);
  }

  /* ── EXIF Orientation Parser ─────────────────────────── */
  /**
   * Reads the EXIF Orientation tag (0x0112) from a JPEG ArrayBuffer.
   * Returns 1 (no rotation) for any non-JPEG or missing EXIF.
   */
  function parseExifOrientation(buffer) {
    var view = new DataView(buffer);
    // JPEG must start with SOI marker 0xFFD8
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xFFD8) return 1;

    var offset = 2;
    var len    = view.byteLength;

    while (offset < len - 4) {
      var marker = view.getUint16(offset, false);
      offset += 2;

      if (marker === 0xFFE1) {
        // APP1 marker found; check for 'Exif\0\0' header (hex 45786966 0000)
        if (offset + 6 > len) return 1;
        if (view.getUint32(offset + 2, false) !== 0x45786966) return 1;

        // Byte order mark: 0x4949 = little-endian (Intel), 0x4D4D = big-endian (Motorola)
        var little   = view.getUint16(offset + 8, false) === 0x4949;
        var ifdBase  = offset + 8; // base of TIFF header
        var ifdOff   = view.getUint32(ifdBase + 4, little);
        var tagCount = view.getUint16(ifdBase + ifdOff, little);

        for (var i = 0; i < tagCount; i++) {
          var tagOff = ifdBase + ifdOff + 2 + (i * 12);
          if (tagOff + 12 > len) break;
          // Tag 0x0112 = Orientation
          if (view.getUint16(tagOff, little) === 0x0112) {
            return view.getUint16(tagOff + 8, little);
          }
        }
        return 1;
      } else if ((marker & 0xFF00) !== 0xFF00) {
        // Not a JPEG segment marker; stop
        break;
      } else {
        // Skip this segment
        if (offset + 1 >= len) break;
        offset += view.getUint16(offset, false);
      }
    }
    return 1;
  }

  /* ── Render Card (before processing) ────────────────── */
  function renderCard(entry) {
    var queue   = $('icr-queue');
    var sizeStr = formatSize(entry.file.size);
    var dimsStr = entry.originalW + '&times;' + entry.originalH;
    var name    = truncateName(entry.file.name, 46);

    var card = document.createElement('div');
    card.className  = 'icr-card';
    card.id         = 'icr-card-' + entry.id;
    card.setAttribute('role', 'listitem');

    var initQ = Math.round(entry.qual * 100);

    card.innerHTML =
      '<div class="icr-card-previews" id="icr-previews-' + entry.id + '">' +
        '<div class="icr-thumb-wrap icr-thumb-clickable"' +
            ' title="Click to preview" onclick="icrOpenModal(\'' + entry.objectUrl + '\',\'Original\',' + entry.originalW + ',' + entry.originalH + ')">' +
          '<img class="icr-thumb-img" src="' + entry.objectUrl + '" alt="' + escHtml(entry.file.name) + '">' +
          '<div class="icr-thumb-label">Original</div>' +
        '</div>' +
        '<div class="icr-card-qual-mid" id="icr-qual-mid-' + entry.id + '">' +
          '<div class="icr-card-qual-row">' +
            '<span class="icr-card-qual-label">Q&nbsp;<span id="icr-qual-num-' + entry.id + '">' + initQ + '</span>%</span>' +
            '<input type="range" id="icr-qual-' + entry.id + '" class="icr-slider" min="1" max="100" value="' + initQ + '"' +
                ' oninput="icrCardQualInput(\'' + entry.id + '\', this.value)">' +
          '</div>' +
          '<div class="icr-card-size-text" id="icr-size-text-' + entry.id + '"></div>' +
        '</div>' +
      '</div>' +
      '<div class="icr-card-body">' +
        '<div class="icr-card-name" title="' + escHtml(entry.file.name) + '">' + escHtml(name) + '</div>' +
        '<div class="icr-card-orig">' + dimsStr + ' &nbsp;&middot;&nbsp; ' + sizeStr + '</div>' +
        '<div class="icr-card-result-info" id="icr-result-' + entry.id + '"></div>' +
        '<div class="icr-card-status" id="icr-status-' + entry.id + '">' +
          '<span class="icr-status-dot"></span>&ensp;Ready' +
        '</div>' +
      '</div>' +
      '<div class="icr-card-actions">' +
        '<button class="icr-btn icr-btn--dl" id="icr-dl-' + entry.id + '"' +
          ' onclick="icrDownloadOne(\'' + entry.id + '\')" disabled>&#8595; Download</button>' +
        '<button class="icr-btn icr-btn--rm"' +
          ' onclick="icrRemoveOne(\'' + entry.id + '\')" title="Remove" aria-label="Remove">&#10005;</button>' +
      '</div>';

    queue.appendChild(card);
  }

  function renderCardError(entry) {
    var queue = $('icr-queue');
    var card  = document.createElement('div');
    card.className = 'icr-card icr-card-error';
    card.id = 'icr-card-' + entry.id;
    card.setAttribute('role', 'listitem');
    card.innerHTML =
      '<div class="icr-card-body">' +
        '<div class="icr-card-name">&#10060; ' + escHtml(entry.file.name) + '</div>' +
        '<div class="icr-card-orig">Could not load this image</div>' +
      '</div>' +
      '<div class="icr-card-actions">' +
        '<button class="icr-btn icr-btn--rm" onclick="icrRemoveOne(\'' + entry.id + '\')" title="Remove">&#10005;</button>' +
      '</div>';
    queue.appendChild(card);
  }

  /* ── Process All ─────────────────────────────────────── */
  function processAll() {
    if (icr_busy) return;

    var queue = [];
    for (var i = 0; i < icr_files.length; i++) {
      var e = icr_files[i];
      if (e.img && e.status !== 'error') queue.push(e);
    }

    if (!queue.length) {
      showToast('⚠️ No images ready to process', 'warning');
      return;
    }

    icr_busy = true;
    $('icr-process-btn').disabled = true;

    var targetW = parseInt($('icr-w-input').value)  || 0;
    var targetH = parseInt($('icr-h-input').value) || 0;
    var total   = queue.length;
    var done    = 0;

    showProgress(0, total);

    function next() {
      if (done >= total) {
        icr_busy = false;
        $('icr-process-btn').disabled = false;
        hideProgress();
        updateZipBtn();
        var n = countDone();
        showToast('&#10003; ' + n + ' image' + (n === 1 ? '' : 's') + ' processed!');
        return;
      }
      var entry = queue[done];
      setCardStatus(entry.id, 'processing');
      processEntry(entry, targetW, targetH, function () {
        done++;
        showProgress(done, total);
        // Yield to the browser event loop between images to keep UI responsive
        setTimeout(next, 0);
      });
    }

    next();
  }

  /* ── Process Single Entry ────────────────────────────── */
  function processEntry(entry, targetW, targetH, cb) {
    var origW = entry.originalW; // visual width
    var origH = entry.originalH; // visual height

    /* ── Compute output visual dimensions ── */
    var outW, outH;

    if (targetW === 0 && targetH === 0) {
      outW = origW;
      outH = origH;
    } else if (targetW > 0 && targetH === 0) {
      outW = targetW;
      outH = icr_locked ? Math.round(origH * (targetW / origW)) : origH;
    } else if (targetW === 0 && targetH > 0) {
      outH = targetH;
      outW = icr_locked ? Math.round(origW * (targetH / origH)) : origW;
    } else {
      // Both dimensions provided
      if (icr_locked) {
        // Fit-within-box: scale so both dimensions fit without cropping
        var scaleW = targetW / origW;
        var scaleH = targetH / origH;
        var scale  = Math.min(scaleW, scaleH);
        outW = Math.round(origW * scale);
        outH = Math.round(origH * scale);
      } else {
        outW = targetW;
        outH = targetH;
      }
    }

    outW = Math.max(1, outW);
    outH = Math.max(1, outH);

    /* ── Determine output MIME type ── */
    var mime;
    if (icr_fmt === 'original') {
      mime = entry.file.type;
      // Canvas cannot export all formats; fall back to PNG for unsupported types
      if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
        mime = 'image/png';
      }
    } else {
      mime = icr_fmt;
    }

    /* ── Draw to canvas with EXIF orientation correction ── */
    var canvas = document.createElement('canvas');
    canvas.width  = outW;
    canvas.height = outH;
    var ctx = canvas.getContext('2d');

    // Apply orientation transform, then draw image at natural size scaled to output
    drawCorrected(ctx, entry.img, entry.orientation, outW, outH);

    /* ── Export blob ── */
    var quality = (mime === 'image/png') ? undefined : entry.qual;

    canvas.toBlob(function (blob) {
      if (!blob) {
        entry.status = 'error';
        setCardStatus(entry.id, 'error');
        cb();
        return;
      }

      entry.blob       = blob;
      entry.outputMime = mime;
      entry.outputW    = outW;
      entry.outputH    = outH;
      entry.outputExt  = mimeToExt(mime);
      entry.outputQual = entry.qual; // remember quality used for modal init
      entry.status     = 'done';

      updateCardAfterProcessing(entry);
      setCardStatus(entry.id, 'done');
      enableDownload(entry.id);

      cb();
    }, mime, quality);
  }

  /* ── Canvas Draw with EXIF Correction ───────────────── */
  /**
   * Applies an EXIF orientation transform to ctx and draws the image
   * at the given VISUAL output dimensions (outW × outH).
   *
   * All transforms are derived from the EXIF orientation spec:
   *   https://www.cipa.jp/std/documents/download_e.html?DC-X008-Translation-2019-E
   *
   * For orientations 5-8 (90°/270° rotated), the image's natural dimensions
   * are transposed. The ctx transform maps natural image pixels to the visual
   * output canvas (outW × outH).
   */
  function drawCorrected(ctx, img, orientation, outW, outH) {
    var nW = img.naturalWidth;
    var nH = img.naturalHeight;

    ctx.save();

    switch (orientation) {
      case 1:
        // Normal: no transform needed
        ctx.drawImage(img, 0, 0, outW, outH);
        break;

      case 2:
        // Flip horizontal
        // (px,py) → (outW - px*outW/nW, py*outH/nH)
        ctx.transform(-1, 0, 0, 1, outW, 0);
        ctx.drawImage(img, 0, 0, outW, outH);
        break;

      case 3:
        // Rotate 180°
        ctx.transform(-1, 0, 0, -1, outW, outH);
        ctx.drawImage(img, 0, 0, outW, outH);
        break;

      case 4:
        // Flip vertical
        ctx.transform(1, 0, 0, -1, 0, outH);
        ctx.drawImage(img, 0, 0, outW, outH);
        break;

      case 5:
        // Transpose (swap x/y)
        // Visual outW = nH-scaled, outH = nW-scaled
        // (px,py) → (py*outW/nH, px*outH/nW)
        ctx.transform(0, outH / nW, outW / nH, 0, 0, 0);
        ctx.drawImage(img, 0, 0, nW, nH);
        break;

      case 6:
        // Rotate 90° CW
        // (px,py) → (outW - py*outW/nH, px*outH/nW)
        ctx.transform(0, outH / nW, -outW / nH, 0, outW, 0);
        ctx.drawImage(img, 0, 0, nW, nH);
        break;

      case 7:
        // Transverse (rotate 90° CW + flip horizontal)
        // (px,py) → (outW - py*outW/nH, outH - px*outH/nW)
        ctx.transform(0, -outH / nW, -outW / nH, 0, outW, outH);
        ctx.drawImage(img, 0, 0, nW, nH);
        break;

      case 8:
        // Rotate 90° CCW
        // (px,py) → (py*outW/nH, outH - px*outH/nW)
        ctx.transform(0, -outH / nW, outW / nH, 0, 0, outH);
        ctx.drawImage(img, 0, 0, nW, nH);
        break;

      default:
        ctx.drawImage(img, 0, 0, outW, outH);
    }

    ctx.restore();
  }

  /* ── Update Card After Processing ───────────────────── */
  function updateCardAfterProcessing(entry) {
    /* ── Previews: before thumb | slider+size | arrow | after thumb ── */
    var previewsEl = $('icr-previews-' + entry.id);
    if (previewsEl) {
      var afterUrl = URL.createObjectURL(entry.blob);
      entry.afterUrl = afterUrl;

      var initQ    = Math.round(entry.qual * 100);
      var sizeText = computeSizeText(entry);

      previewsEl.innerHTML =
        '<div class="icr-thumb-wrap icr-thumb-clickable"' +
            ' title="Click to preview original" onclick="icrOpenModal(\'' + entry.objectUrl + '\',\'Original\',' + entry.originalW + ',' + entry.originalH + ')">' +
          '<img class="icr-thumb-img" src="' + entry.objectUrl + '" alt="Before">' +
          '<div class="icr-thumb-label">Before</div>' +
        '</div>' +
        '<div class="icr-card-qual-mid" id="icr-qual-mid-' + entry.id + '">' +
          '<div class="icr-card-qual-row">' +
            '<span class="icr-card-qual-label">Q&nbsp;<span id="icr-qual-num-' + entry.id + '">' + initQ + '</span>%</span>' +
            '<input type="range" id="icr-qual-' + entry.id + '" class="icr-slider" min="1" max="100" value="' + initQ + '"' +
                ' oninput="icrCardQualInput(\'' + entry.id + '\', this.value)">' +
          '</div>' +
          '<div class="icr-card-size-text" id="icr-size-text-' + entry.id + '">' + sizeText + '</div>' +
        '</div>' +
        '<div class="icr-thumb-wrap icr-thumb-clickable"' +
            ' title="Click to preview result" onclick="icrOpenModal(\'' + afterUrl + '\',\'Result\',' + entry.outputW + ',' + entry.outputH + ',\'' + entry.id + '\')">' +
          '<img class="icr-thumb-img" src="' + afterUrl + '" alt="After">' +
          '<div class="icr-thumb-label">After</div>' +
        '</div>';
    }

    /* ── Result badges ── */
    var resultEl = $('icr-result-' + entry.id);
    if (resultEl) {
      var origSize = entry.file.size;
      var outSize  = entry.blob.size;
      var diff     = origSize - outSize;
      var pct      = Math.round(Math.abs(diff) / origSize * 100);
      var outW     = entry.outputW;
      var outH     = entry.outputH;

      // Output dimensions badge (only if changed)
      var dimsBadge = '';
      if (outW !== entry.originalW || outH !== entry.originalH) {
        dimsBadge = '<span class="icr-result-badge">' + outW + '&times;' + outH + '</span>';
      }

      // Output size badge
      var sizeBadge = '<span class="icr-result-badge">' + formatSize(outSize) + '</span>';

      // Savings or increase badge
      var saveClass = diff > 0 ? 'icr-badge-save' : (diff < 0 ? 'icr-badge-bigger' : 'icr-badge-neutral');
      var saveSign  = diff > 0 ? '-' : (diff < 0 ? '+' : '');
      var saveBadge = '<span class="icr-result-badge ' + saveClass + '">' +
        saveSign + pct + '% (' + formatSize(Math.abs(diff)) + ')</span>';

      resultEl.innerHTML = dimsBadge + sizeBadge + saveBadge;
    }
  }

  /* ── Card Status ─────────────────────────────────────── */
  function setCardStatus(id, status) {
    var statusEl = $('icr-status-' + id);
    var cardEl   = $('icr-card-' + id);
    if (!statusEl) return;

    if (cardEl) {
      cardEl.classList.remove('icr-card-processing', 'icr-card-done', 'icr-card-error');
    }

    var dotClass = '';
    var text     = 'Ready';

    switch (status) {
      case 'processing':
        dotClass = 'icr-dot-processing';
        text = 'Processing&hellip;';
        if (cardEl) cardEl.classList.add('icr-card-processing');
        break;
      case 'done':
        dotClass = 'icr-dot-done';
        text = 'Done';
        if (cardEl) cardEl.classList.add('icr-card-done');
        break;
      case 'error':
        dotClass = 'icr-dot-error';
        text = 'Error';
        if (cardEl) cardEl.classList.add('icr-card-error');
        break;
    }

    statusEl.innerHTML = '<span class="icr-status-dot ' + dotClass + '"></span>&ensp;' + text;
  }

  function enableDownload(id) {
    var btn = $('icr-dl-' + id);
    if (btn) btn.disabled = false;
  }

  /* ── Download One ─────────────────────────────────────── */
  function downloadOne(id) {
    var entry = arrFind(icr_files, function (e) { return e.id === id; });
    if (!entry || !entry.blob) {
      showToast('⚠️ Process this image first', 'warning');
      return;
    }
    triggerDownload(entry.blob, outputFilename(entry));
  }

  function outputFilename(entry) {
    // Strip original extension and replace with output extension
    var base = entry.file.name.replace(/\.[^.]+$/, '');
    return base + '.' + entry.outputExt;
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay so the download has time to start
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  /* ── Download ZIP ─────────────────────────────────────── */
  function downloadZip() {
    var done = [];
    for (var i = 0; i < icr_files.length; i++) {
      if (icr_files[i].status === 'done' && icr_files[i].blob) done.push(icr_files[i]);
    }

    if (!done.length) {
      showToast('⚠️ Process images first!', 'warning');
      return;
    }

    if (typeof JSZip === 'undefined') {
      showToast('&#10060; JSZip not loaded — check your connection', 'error');
      return;
    }

    var zip       = new JSZip();
    var usedNames = {};

    for (var j = 0; j < done.length; j++) {
      var entry   = done[j];
      var name    = outputFilename(entry);
      // Handle duplicate filenames by appending a counter
      if (usedNames[name]) {
        usedNames[name]++;
        var ext = '.' + entry.outputExt;
        name = name.replace(ext, '_' + usedNames[name] + ext);
      } else {
        usedNames[name] = 1;
      }
      zip.file(name, entry.blob);
    }

    zip.generateAsync({ type: 'blob', compression: 'STORE' }).then(function (zipBlob) {
      triggerDownload(zipBlob, 'images-vahac.zip');
      showToast('&#128230; ZIP downloaded!');
    });
  }

  /* ── Remove One ──────────────────────────────────────── */
  function removeOne(id) {
    var idx = arrFindIdx(icr_files, function (e) { return e.id === id; });
    if (idx === -1) return;

    var entry = icr_files[idx];
    // Release object URLs to free browser memory
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    if (entry.afterUrl)  URL.revokeObjectURL(entry.afterUrl);

    icr_files.splice(idx, 1);

    var card = $('icr-card-' + id);
    if (card) card.remove();

    if (!icr_files.length) hidePanel();
    updateZipBtn();
  }

  /* ── Clear All ───────────────────────────────────────── */
  function clearAll() {
    for (var i = 0; i < icr_files.length; i++) {
      var e = icr_files[i];
      if (e.objectUrl) URL.revokeObjectURL(e.objectUrl);
      if (e.afterUrl)  URL.revokeObjectURL(e.afterUrl);
    }
    icr_files = [];
    $('icr-queue').innerHTML = '';
    hidePanel();
    updateZipBtn();
  }

  /* ── Format Selection ────────────────────────────────── */
  function setFormat(btn) {
    var tabs = document.querySelectorAll('.icr-fmt-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.remove('icr-fmt-active');
    }
    btn.classList.add('icr-fmt-active');
    icr_fmt = btn.getAttribute('data-fmt');
    saveToHash();
  }

  /* ── Aspect Lock ─────────────────────────────────────── */
  function toggleLock() {
    icr_locked = !icr_locked;
    var btn  = $('icr-lock-btn');
    var icon = $('icr-lock-icon');
    btn.classList.toggle('icr-lock-on', icr_locked);
    if (icon) icon.textContent = icr_locked ? '🔒' : '🔓';
    btn.title = icr_locked ? 'Aspect ratio locked' : 'Aspect ratio unlocked';
  }

  /* ── Panel Visibility ────────────────────────────────── */
  function showPanel() {
    var p = $('icr-panel');
    p.classList.add('icr-panel-visible');
    p.setAttribute('aria-hidden', 'false');
  }

  function hidePanel() {
    var p = $('icr-panel');
    p.classList.remove('icr-panel-visible');
    p.setAttribute('aria-hidden', 'true');
  }

  /* ── Progress ────────────────────────────────────────── */
  function showProgress(done, total) {
    var wrap = $('icr-progress-wrap');
    var bar  = $('icr-progress-bar');
    var txt  = $('icr-progress-text');
    wrap.classList.add('icr-progress-visible');
    bar.style.width = (total > 0 ? Math.round(done / total * 100) : 0) + '%';
    txt.textContent = done + ' / ' + total;
  }

  function hideProgress() {
    $('icr-progress-wrap').classList.remove('icr-progress-visible');
  }

  /* ── ZIP Button State ────────────────────────────────── */
  function updateZipBtn() {
    var hasDone = arrSome(icr_files, function (e) { return e.status === 'done'; });
    $('icr-zip-btn').disabled = !hasDone;
  }

  function countDone() {
    var n = 0;
    for (var i = 0; i < icr_files.length; i++) {
      if (icr_files[i].status === 'done') n++;
    }
    return n;
  }

  /* ── Toast ───────────────────────────────────────────── */
  function showToast(msg, type) {
    var t = $('icr-toast');
    t.innerHTML = msg;
    t.className = 'icr-toast icr-toast-show';

    if (type === 'warning') {
      t.style.background = 'var(--icr-accent-amber)';
    } else if (type === 'error') {
      t.style.background = 'var(--icr-accent-red)';
    } else {
      t.style.background = 'var(--icr-accent-green)';
    }

    clearTimeout(icr_toast_t);
    icr_toast_t = setTimeout(function () {
      t.classList.remove('icr-toast-show');
    }, 2800);
  }

  /* ── URL Hash State ──────────────────────────────────── */
  function saveToHash() {
    history.replaceState(null, '', '#fmt=' + encodeURIComponent(icr_fmt));
  }

  function restoreFromHash() {
    var raw = location.hash.slice(1);
    if (!raw) return;
    var params = {};
    raw.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    if (params.fmt) {
      var tab = document.querySelector('[data-fmt="' + params.fmt + '"]');
      if (tab) setFormat(tab);
    }
  }

  /* ── Image Preview Modal ─────────────────────────────── */
  /**
   * Opens the lightbox modal.
   * @param {string} src      - blob:/data: URL of the image to display
   * @param {string} label    - 'Original' | 'Result'
   * @param {number} naturalW - pixel width shown in footer
   * @param {number} naturalH - pixel height shown in footer
   * @param {string} [entryId]- when provided (Result mode) enables quality re-compress
   */
  function openModal(src, label, naturalW, naturalH, entryId) {
    var overlay  = $('icr-modal-overlay');
    var img      = $('icr-modal-img');
    var info     = $('icr-modal-info');
    var wrap     = $('icr-modal-img-wrap');
    var box      = $('icr-modal-box');
    var btn      = $('icr-modal-size-btn');
    var qualWrap = $('icr-modal-qual-wrap');

    img.src = src;
    img.alt = label;
    info.textContent = label + ' \u2014 ' + naturalW + '\u00d7' + naturalH + ' px';

    // Always open in fit mode
    icr_modal_fit = true;
    wrap.classList.remove('icr-modal-actual');
    box.classList.remove('icr-modal-box--full');
    btn.textContent = 'View actual size';

    // Quality controls — only for Result previews with a known entry
    icr_modal_entry = entryId
      ? arrFind(icr_files, function (e) { return e.id === entryId; })
      : null;

    if (icr_modal_entry && icr_modal_entry.blob) {
      var isPng = (icr_modal_entry.outputMime === 'image/png');
      qualWrap.classList.add('icr-qual-visible');

      var qs = $('icr-modal-qual-slider');
      qs.disabled = isPng;
      // Initialise slider from the entry's current quality setting
      var initQ = Math.round(icr_modal_entry.qual * 100);
      qs.value = initQ;
      $('icr-modal-qual-num').textContent = initQ;

      updateModalSizeText();
      if (isPng) $('icr-modal-size-text').textContent = 'PNG is lossless — quality has no effect.';
    } else {
      qualWrap.classList.remove('icr-qual-visible');
      icr_modal_entry = null;
    }

    overlay.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleModalKey);
  }

  /** Closes the modal. */
  function closeModal() {
    $('icr-modal-overlay').setAttribute('hidden', '');
    $('icr-modal-img').src = '';
    icr_modal_entry = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', handleModalKey);
  }

  /**
   * Toggles fit-to-screen ↔ actual-size (scrollable) mode.
   */
  function toggleModalFit() {
    var wrap = $('icr-modal-img-wrap');
    var box  = $('icr-modal-box');
    var btn  = $('icr-modal-size-btn');
    icr_modal_fit = !icr_modal_fit;
    if (icr_modal_fit) {
      wrap.classList.remove('icr-modal-actual');
      box.classList.remove('icr-modal-box--full');
      btn.textContent = 'View actual size';
    } else {
      wrap.classList.add('icr-modal-actual');
      box.classList.add('icr-modal-box--full');
      btn.textContent = 'Fit to screen';
    }
  }

  /** Sets up the modal quality slider — called once in init(). */
  function setupModalQualitySlider() {
    var slider = $('icr-modal-qual-slider');
    slider.addEventListener('input', function () {
      var val = parseInt(this.value);
      $('icr-modal-qual-num').textContent = val;

      // Keep the card slider in sync
      if (icr_modal_entry) {
        icr_modal_entry.qual = val / 100;
        var cardNum    = $('icr-qual-num-' + icr_modal_entry.id);
        var cardSlider = $('icr-qual-' + icr_modal_entry.id);
        if (cardNum)    cardNum.textContent = val;
        if (cardSlider) cardSlider.value    = val;
      }

      clearTimeout(icr_modal_qual_t);
      icr_modal_qual_t = setTimeout(function () {
        recompressEntry(icr_modal_entry, val / 100);
      }, 350);
    });
  }

  /**
   * Re-compresses an entry at the given quality and updates everything:
   * modal image (if open), card after-thumbnail, card badges.
   * Called from both the modal slider and the per-card slider.
   */
  function recompressEntry(entry, quality) {
    if (!entry || !entry.img) return;

    var mime = entry.outputMime;
    if (!mime || mime === 'image/png') { updateModalSizeText(); return; }

    var outW = entry.outputW;
    var outH = entry.outputH;
    if (outW < 1 || outH < 1) return;

    var canvas = document.createElement('canvas');
    canvas.width  = outW;
    canvas.height = outH;
    drawCorrected(canvas.getContext('2d'), entry.img, entry.orientation, outW, outH);

    canvas.toBlob(function (blob) {
      if (!blob) return;

      if (entry.afterUrl) URL.revokeObjectURL(entry.afterUrl);

      var newUrl       = URL.createObjectURL(blob);
      entry.afterUrl   = newUrl;
      entry.blob       = blob;
      entry.outputQual = quality;
      entry.qual       = quality; // keep qual in sync

      // Update modal image if it is showing this entry
      var overlay = $('icr-modal-overlay');
      if (!overlay.hasAttribute('hidden') && icr_modal_entry === entry) {
        $('icr-modal-img').src = newUrl;
        updateModalSizeText();
      }

      refreshCardAfterThumb(entry);
      refreshCardResultBadges(entry);

    }, mime, quality);
  }

  // Keep old name as alias so any remaining references don't break
  function regenerateModalImage(quality) { recompressEntry(icr_modal_entry, quality); }

  /** Updates the file-size line inside the modal quality wrap. */
  function updateModalSizeText() {
    var el    = $('icr-modal-size-text');
    var entry = icr_modal_entry;
    if (!el || !entry || !entry.blob) return;

    var origSize = entry.file.size;
    var outSize  = entry.blob.size;
    var diff     = origSize - outSize;
    var pct      = Math.round(Math.abs(diff) / origSize * 100);
    var sign     = diff >= 0 ? '\u2212' : '+'; // minus sign or plus

    el.textContent = formatSize(outSize) + ' (' + sign + pct + '% vs original)';
  }

  /** Refreshes the "After" thumbnail src and onclick in the card, plus size text. */
  function refreshCardAfterThumb(entry) {
    var previewsEl = $('icr-previews-' + entry.id);
    if (!previewsEl) return;

    var wraps = previewsEl.querySelectorAll('.icr-thumb-wrap');
    if (wraps.length < 2) return;

    var afterWrap = wraps[1];
    var afterImg  = afterWrap.querySelector('.icr-thumb-img');
    if (afterImg) afterImg.src = entry.afterUrl;

    // Rebuild onclick with the updated URL
    afterWrap.setAttribute('onclick',
      "icrOpenModal('" + entry.afterUrl + "','Result'," +
      entry.outputW + ',' + entry.outputH + ",'" + entry.id + "')");

    // Update the size text below the slider
    var sizeEl = $('icr-size-text-' + entry.id);
    if (sizeEl) sizeEl.textContent = computeSizeText(entry);
  }

  /** Refreshes the size/savings badges in the card after quality re-compress. */
  function refreshCardResultBadges(entry) {
    var resultEl = $('icr-result-' + entry.id);
    if (!resultEl || !entry.blob) return;

    var origSize = entry.file.size;
    var outSize  = entry.blob.size;
    var diff     = origSize - outSize;
    var pct      = Math.round(Math.abs(diff) / origSize * 100);

    var dimsBadge = '';
    if (entry.outputW !== entry.originalW || entry.outputH !== entry.originalH) {
      dimsBadge = '<span class="icr-result-badge">' + entry.outputW + '&times;' + entry.outputH + '</span>';
    }

    var sizeBadge = '<span class="icr-result-badge">' + formatSize(outSize) + '</span>';
    var saveClass = diff > 0 ? 'icr-badge-save' : (diff < 0 ? 'icr-badge-bigger' : 'icr-badge-neutral');
    var saveSign  = diff > 0 ? '-' : (diff < 0 ? '+' : '');
    var saveBadge = '<span class="icr-result-badge ' + saveClass + '">' +
      saveSign + pct + '% (' + formatSize(Math.abs(diff)) + ')</span>';

    resultEl.innerHTML = dimsBadge + sizeBadge + saveBadge;
  }

  /** Escape key listener — attached only while the modal is open. */
  function handleModalKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  /* ── Helpers ─────────────────────────────────────────── */
  /** Formats "62.8 KB (−96% vs original)" for the card size-text. */
  function computeSizeText(entry) {
    if (!entry.blob) return '';
    var origSize = entry.file.size;
    var outSize  = entry.blob.size;
    var diff     = origSize - outSize;
    var pct      = Math.round(Math.abs(diff) / origSize * 100);
    var sign     = diff >= 0 ? '\u2212' : '+';
    return formatSize(outSize) + ' (' + sign + pct + '% vs original)';
  }

  function formatSize(bytes) {
    if (bytes < 1024)    return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  function mimeToExt(mime) {
    var map = {
      'image/jpeg': 'jpg',
      'image/png':  'png',
      'image/webp': 'webp',
      'image/gif':  'gif',
      'image/bmp':  'bmp',
      'image/tiff': 'tiff'
    };
    return map[mime] || 'png';
  }

  function truncateName(str, max) {
    if (str.length <= max) return str;
    var dot = str.lastIndexOf('.');
    if (dot > 0) {
      var ext  = str.substring(dot);
      var base = str.substring(0, dot);
      return base.substring(0, max - ext.length - 1) + '\u2026' + ext;
    }
    return str.substring(0, max - 1) + '\u2026';
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
  }

  /* ── Global Exposure (for onclick= handlers) ─────────── */
  window.icrProcessAll     = processAll;
  window.icrDownloadOne    = downloadOne;
  window.icrDownloadZip    = downloadZip;
  window.icrRemoveOne      = removeOne;
  window.icrClearAll       = clearAll;
  window.icrSetFormat      = setFormat;
  window.icrToggleLock     = toggleLock;
  window.icrOpenModal      = openModal;
  window.icrCloseModal     = closeModal;
  window.icrToggleModalFit = toggleModalFit;

  /**
   * Called by oninput on each card's quality slider.
   * Updates the displayed %, keeps entry.qual in sync,
   * syncs the modal slider if it's open for this entry,
   * and debounces a re-compress if already processed.
   */
  window.icrCardQualInput = function (id, rawValue) {
    var val   = parseInt(rawValue);
    var entry = arrFind(icr_files, function (e) { return e.id === id; });
    if (!entry) return;

    entry.qual = val / 100;

    // Update displayed % in the card
    var numEl = $('icr-qual-num-' + id);
    if (numEl) numEl.textContent = val;

    // Sync modal slider if it's open for this entry
    if (icr_modal_entry && icr_modal_entry.id === id) {
      var ms = $('icr-modal-qual-slider');
      var mn = $('icr-modal-qual-num');
      if (ms) ms.value       = val;
      if (mn) mn.textContent = val;
    }

    // Debounce re-compress (only if already processed)
    clearTimeout(entry._qualTimer);
    entry._qualTimer = setTimeout(function () {
      if (entry.status === 'done') recompressEntry(entry, entry.qual);
    }, 350);
  };

  /* ── Bootstrap ───────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
