/* ============================================================
   앱 셸 공통 로직 — 원칙적으로 수정하지 않는다.
   서비스 고유 로직은 아래 "TOOL MODULE" 영역에만 작성한다.
   ============================================================ */
(function shell() {
  "use strict";
  var cfg = window.APP_CONFIG || {};

  // 연도
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // 테마 토글: auto → light → dark → auto
  var themeBtn = document.getElementById("theme-toggle");
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(cfg.slug + ":theme"); } catch (e) { /* private mode */ }
  if (saved) root.setAttribute("data-theme", saved);
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var order = ["auto", "light", "dark"];
      var cur = root.getAttribute("data-theme") || "auto";
      var next = order[(order.indexOf(cur) + 1) % order.length];
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(cfg.slug + ":theme", next); } catch (e) { /* noop */ }
    });
  }

  // 공유
  var shareBtn = document.getElementById("share-btn");
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      var data = { title: document.title, url: location.href };
      if (navigator.share) {
        navigator.share(data).catch(function () { /* 사용자가 취소 */ });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(location.href).then(function () {
          shareBtn.textContent = "✓";
          setTimeout(function () { shareBtn.textContent = "↗"; }, 1200);
        });
      }
    });
  }

  // PWA 서비스워커
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* 오프라인 미지원 환경 */ });
  }

  // AdSense — 게이트 통과 전에는 enabled=false 라 아무것도 하지 않는다
  if (cfg.adsense && cfg.adsense.enabled && cfg.adsense.client && cfg.adsense.slot) {
    var slotEl = document.getElementById("ad-slot");
    if (slotEl) {
      slotEl.hidden = false;
      var ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.setAttribute("data-ad-client", cfg.adsense.client);
      ins.setAttribute("data-ad-slot", cfg.adsense.slot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      slotEl.appendChild(ins);
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
  }

  // GA4 — 설정 시에만 로드, 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙)
  if (cfg.analytics && cfg.analytics.ga4) {
    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + cfg.analytics.ga4;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", cfg.analytics.ga4);
    } catch (e) { /* 분석 실패는 조용히 무시 */ }
  }
})();

/* ============================================================
   TOOL MODULE — 빌더 에이전트가 이 영역을 서비스 로직으로 교체한다.
   규칙:
   - 상태는 localStorage(키 prefix: cfg.slug + ":") 또는 URL 파라미터에만 저장
   - 외부 API 호출 시 실패 UI(.result에 오류 문구) 필수
   - 빈 입력/공집합도 명시적으로 처리 (조용한 실패 금지)
   ============================================================ */
(function tool() {
  "use strict";
  // TOOLJS:START
  /* Image Compressor — drop/select up to 10 images (jpg/png/webp), re-encode via
     canvas.toBlob with a quality slider + optional max-dimension downscale, show
     before/after size and % saved per file, download each or all.
     100% client-side: files never leave the browser. State: only the last-used
     quality/max-dimension/format settings persist in localStorage. */

  var MAX_FILES = 10;
  var MAX_SOURCE_DIM = 8000; // hard cap regardless of the max-dimension setting, to bound memory/CPU on huge photos
  var ACCEPTED_TYPES = { "image/jpeg": 1, "image/png": 1, "image/webp": 1 };

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */
  function clamp(n, min, max) {
    n = Number(n);
    if (!isFinite(n)) return min;
    return n < min ? min : (n > max ? max : n);
  }
  // 바이트 -> {value, unit} (locale-agnostic 단위 선택, 표시 포맷은 Intl 이 담당)
  function humanSize(n) {
    n = Math.max(0, Number(n) || 0);
    var units = ["B", "KB", "MB", "GB"];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n = n / 1024; i++; }
    return { value: i === 0 ? Math.round(n) : Math.round(n * 10) / 10, unit: units[i] };
  }
  // 원본/압축 크기 -> 절감률 %(음수 허용 = 오히려 커진 경우)
  function savedPercent(origSize, compSize) {
    origSize = Number(origSize) || 0;
    compSize = Number(compSize) || 0;
    if (!(origSize > 0)) return 0;
    return ((origSize - compSize) / origSize) * 100;
  }
  // 긴 변 기준 다운스케일 목표 크기 (비율 유지). maxDim<=0 이면 리사이즈 안 함(단, 절대 상한은 적용).
  function computeTargetSize(w, h, maxDim) {
    w = Math.max(1, Math.round(Number(w) || 1));
    h = Math.max(1, Math.round(Number(h) || 1));
    var limit = maxDim > 0 ? Math.min(maxDim, MAX_SOURCE_DIM) : MAX_SOURCE_DIM;
    var longest = Math.max(w, h);
    if (longest <= limit) return { width: w, height: h };
    var scale = limit / longest;
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  }
  // 출력 포맷 결정: "same" 이면 원본이 캔버스가 인코딩 가능한 3종(jpeg/png/webp) 중 하나일 때 그대로,
  // 아니면(예: gif/bmp/svg 등 accept 밖의 타입이 흘러든 경우 대비) 무손실 PNG 로 폴백.
  function resolveOutputType(selected, originalType) {
    if (selected === "same") {
      if (ACCEPTED_TYPES[originalType]) return originalType;
      return "image/png";
    }
    return selected;
  }
  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      clamp: clamp, humanSize: humanSize, savedPercent: savedPercent,
      computeTargetSize: computeTargetSize, resolveOutputType: resolveOutputType,
      MAX_FILES: MAX_FILES, MAX_SOURCE_DIM: MAX_SOURCE_DIM
    };
    return;
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "image-compressor") + ":state";
  function tr(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmtNum(n) {
    try { return Number(n).toLocaleString(uiLang(), { maximumFractionDigits: 1 }); }
    catch (e) { return String(n); }
  }
  function fmtBytes(n) {
    var hs = humanSize(n);
    return fmtNum(hs.value) + " " + hs.unit;
  }
  function fmtPercent(n) {
    try { return Number(Math.abs(n)).toLocaleString(uiLang(), { maximumFractionDigits: 1 }); }
    catch (e) { return String(Math.round(Math.abs(n) * 10) / 10); }
  }
  function fmtSavedLabel(origSize, compSize) {
    var pct = savedPercent(origSize, compSize);
    if (pct >= 0) return tr("tool.saved", "{pct}% smaller").replace("{pct}", fmtPercent(pct));
    return tr("tool.savedNegative", "{pct}% larger — try a lower quality or a smaller max dimension").replace("{pct}", fmtPercent(pct));
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var qualityEl = $("quality"), qualityValueEl = $("quality-value");
  var maxDimEl = $("max-dim"), formatEl = $("out-format");
  var dropZone = $("drop-zone"), fileInput = $("file-input");
  var fileErrorEl = $("file-error"), summaryEl = $("batch-summary"), listEl = $("file-list");
  var batchActionsEl = $("batch-actions"), downloadAllBtn = $("download-all-btn"), clearAllBtn = $("clear-all-btn");
  if (!dropZone || !fileInput || !listEl || !qualityEl || !maxDimEl || !formatEl) return;

  /* ---- 설정 저장/복원 (파일 자체는 저장하지 않는다 — 오직 슬라이더/셀렉트 값만) ---- */
  function loadSettings() {
    try {
      var raw = localStorage.getItem(SKEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveSettings() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        quality: qualityEl.value, maxDim: maxDimEl.value, format: formatEl.value
      }));
    } catch (e) { /* private mode — 저장만 실패, 계산은 정상 */ }
  }
  (function restoreSettings() {
    var s = loadSettings();
    if (!s) return;
    if (s.quality && Number(s.quality) >= 10 && Number(s.quality) <= 100) qualityEl.value = s.quality;
    if (s.maxDim != null && $("max-dim").querySelector('option[value="' + s.maxDim + '"]')) maxDimEl.value = s.maxDim;
    if (s.format && formatEl.querySelector('option[value="' + s.format + '"]')) formatEl.value = s.format;
  })();
  qualityValueEl.textContent = qualityEl.value + "%";

  /* ---- 상태: 처리 중인 이미지 목록 ---- */
  var items = []; // { id, file, name, origSize, origType, status, previewUrl, compBlob, compUrl, compSize, compType, error }
  var nextId = 1;

  function outputFileName(name, mimeType) {
    var ext = mimeType === "image/jpeg" ? "jpg" : (mimeType === "image/webp" ? "webp" : (mimeType === "image/png" ? "png" : "img"));
    var base = String(name || "image").replace(/\.[^./\\]+$/, "");
    return base + "-compressed." + ext;
  }

  function revokeItem(it) {
    if (it.previewUrl) { try { URL.revokeObjectURL(it.previewUrl); } catch (e) {} }
    if (it.compUrl) { try { URL.revokeObjectURL(it.compUrl); } catch (e) {} }
  }

  function showErrors(list) {
    if (!list || !list.length) { fileErrorEl.hidden = true; fileErrorEl.textContent = ""; return; }
    fileErrorEl.textContent = list.join(" ");
    fileErrorEl.hidden = false;
  }

  function addFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    var errors = [];
    var room = MAX_FILES - items.length;
    if (arr.length > room) {
      errors.push(tr("tool.err.tooMany", "You can compress up to 10 images at a time — the rest were skipped."));
    }
    var toAdd = arr.slice(0, Math.max(0, room));
    for (var i = 0; i < toAdd.length; i++) {
      var f = toAdd[i];
      if (!ACCEPTED_TYPES[f.type]) {
        errors.push(tr("tool.err.badType", "{name}: unsupported file type. Use JPG, PNG, or WebP.").replace("{name}", f.name));
        continue;
      }
      addItem(f);
    }
    showErrors(errors);
  }

  function addItem(file) {
    var it = {
      id: nextId++, file: file, name: file.name, origSize: file.size, origType: file.type,
      status: "pending", previewUrl: null, compBlob: null, compUrl: null, compSize: 0, compType: "", error: null
    };
    try { it.previewUrl = URL.createObjectURL(file); } catch (e) { it.previewUrl = null; }
    items.push(it);
    renderList();
    processItem(it);
  }

  function removeItem(id) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        revokeItem(items[i]);
        items.splice(i, 1);
        break;
      }
    }
    renderList();
  }

  function clearAll() {
    for (var i = 0; i < items.length; i++) revokeItem(items[i]);
    items = [];
    fileInput.value = "";
    showErrors([]);
    renderList();
  }

  /* ---- 디코딩(createImageBitmap 우선, 폴백 <img>) → 캔버스 리사이즈/그리기 → toBlob 재인코딩 ---- */
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return window.createImageBitmap(file).catch(function () { return loadViaImage(file); });
    }
    return loadViaImage(file);
  }
  function loadViaImage(file) {
    return new Promise(function (resolve, reject) {
      var url;
      try { url = URL.createObjectURL(file); } catch (e) { reject(e); return; }
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  function processItem(it) {
    it.status = "processing";
    renderList();
    loadBitmap(it.file).then(function (bmp) {
      var w = bmp.width || bmp.naturalWidth || 1;
      var h = bmp.height || bmp.naturalHeight || 1;
      var maxDim = parseInt(maxDimEl.value, 10) || 0;
      var target = computeTargetSize(w, h, maxDim);
      var canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      var ctx = canvas.getContext("2d");
      if (!ctx || typeof canvas.toBlob !== "function") {
        it.status = "error";
        it.error = tr("tool.err.encode", "{name}: compression failed in this browser. Try a different output format.").replace("{name}", it.name);
        renderList();
        return;
      }
      var outType = resolveOutputType(formatEl.value, it.origType);
      if (outType === "image/jpeg") {
        // JPEG 은 투명을 지원하지 않는다 — 흰 배경을 먼저 깔아 검은 배경으로 렌더되는 것을 방지
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, target.width, target.height);
      }
      ctx.drawImage(bmp, 0, 0, target.width, target.height);
      if (typeof bmp.close === "function") bmp.close(); // ImageBitmap 메모리 즉시 반납
      var q = clamp(parseInt(qualityEl.value, 10) / 100, 0.1, 1);
      canvas.toBlob(function (blob) {
        if (!blob) {
          it.status = "error";
          it.error = tr("tool.err.encode", "{name}: compression failed in this browser. Try a different output format.").replace("{name}", it.name);
          renderList();
          return;
        }
        it.status = "done";
        it.compBlob = blob;
        it.compSize = blob.size;
        it.compType = outType;
        if (it.compUrl) { try { URL.revokeObjectURL(it.compUrl); } catch (e) {} }
        it.compUrl = URL.createObjectURL(blob);
        renderList();
      }, outType, q);
    }).catch(function () {
      it.status = "error";
      it.error = tr("tool.err.decode", "{name}: couldn't read this image. It may be corrupted or an unsupported format.").replace("{name}", it.name);
      renderList();
    });
  }

  /* ---- 렌더 ---- */
  function buildRow(it) {
    var row = document.createElement("div");
    row.className = "img-row";

    var thumb = document.createElement("img");
    thumb.className = "img-thumb";
    thumb.alt = "";
    if (it.previewUrl) thumb.src = it.previewUrl;
    row.appendChild(thumb);

    var info = document.createElement("div");
    info.className = "img-info";
    var nameEl = document.createElement("div");
    nameEl.className = "img-name";
    nameEl.textContent = it.name;
    info.appendChild(nameEl);

    var metaEl = document.createElement("div");
    metaEl.className = "img-meta";
    if (it.status === "error") {
      metaEl.className += " img-meta-error";
      metaEl.textContent = it.error || tr("tool.status.error", "Failed");
    } else if (it.status === "done") {
      metaEl.textContent = fmtBytes(it.origSize) + " → " + fmtBytes(it.compSize) + " · " + fmtSavedLabel(it.origSize, it.compSize);
    } else {
      metaEl.textContent = fmtBytes(it.origSize) + " · " + tr("tool.status." + it.status, it.status);
    }
    info.appendChild(metaEl);
    row.appendChild(info);

    var actions = document.createElement("div");
    actions.className = "img-actions";
    if (it.status === "done" && it.compUrl) {
      var dl = document.createElement("a");
      dl.className = "img-btn img-btn-primary";
      dl.textContent = tr("tool.download", "Download");
      dl.href = it.compUrl;
      dl.download = outputFileName(it.name, it.compType);
      actions.appendChild(dl);
    } else if (it.status === "processing" || it.status === "pending") {
      var spin = document.createElement("span");
      spin.className = "img-spinner";
      spin.setAttribute("aria-hidden", "true");
      actions.appendChild(spin);
    }
    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "img-btn";
    rm.textContent = tr("tool.remove", "Remove");
    rm.setAttribute("aria-label", tr("tool.remove", "Remove") + " — " + it.name);
    rm.addEventListener("click", (function (id) { return function () { removeItem(id); }; })(it.id));
    actions.appendChild(rm);
    row.appendChild(actions);

    return row;
  }

  function renderList() {
    listEl.textContent = "";
    if (!items.length) {
      listEl.hidden = true;
      batchActionsEl.hidden = true;
      summaryEl.hidden = true;
      return;
    }
    for (var i = 0; i < items.length; i++) listEl.appendChild(buildRow(items[i]));
    listEl.hidden = false;
    batchActionsEl.hidden = false;

    var doneCount = 0, totalOrig = 0, totalComp = 0;
    for (var j = 0; j < items.length; j++) {
      if (items[j].status === "done") {
        doneCount++;
        totalOrig += items[j].origSize;
        totalComp += items[j].compSize;
      }
    }
    downloadAllBtn.disabled = doneCount === 0;
    if (doneCount > 0) {
      var pct = savedPercent(totalOrig, totalComp);
      var word = pct >= 0 ? tr("tool.smaller", "smaller") : tr("tool.larger", "larger");
      summaryEl.textContent = tr("tool.summary", "{count} image(s) · {orig} → {comp} · {pct}% {word} overall")
        .replace("{count}", String(items.length))
        .replace("{orig}", fmtBytes(totalOrig))
        .replace("{comp}", fmtBytes(totalComp))
        .replace("{pct}", fmtPercent(pct))
        .replace("{word}", word);
      summaryEl.hidden = false;
    } else {
      summaryEl.hidden = true;
    }
  }

  /* ---- 전체 다운로드: 사용자 클릭 한 번으로 완료된 파일을 순차 트리거 ---- */
  function downloadAll() {
    var done = [];
    for (var i = 0; i < items.length; i++) if (items[i].status === "done") done.push(items[i]);
    done.forEach(function (it, idx) {
      setTimeout(function () {
        var a = document.createElement("a");
        a.href = it.compUrl;
        a.download = outputFileName(it.name, it.compType);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, idx * 300);
    });
  }

  /* ---- 이벤트 ---- */
  qualityEl.addEventListener("input", function () {
    qualityValueEl.textContent = qualityEl.value + "%";
    saveSettings();
  });
  maxDimEl.addEventListener("change", saveSettings);
  formatEl.addEventListener("change", saveSettings);

  dropZone.addEventListener("click", function () { fileInput.click(); });
  dropZone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      fileInput.click();
    }
  });
  ["dragenter", "dragover"].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });
  ["dragleave", "dragend", "drop"].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  });
  dropZone.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", function () {
    addFiles(fileInput.files);
    fileInput.value = ""; // 같은 파일을 다시 선택해도 change 가 재발화되도록
  });
  downloadAllBtn.addEventListener("click", downloadAll);
  clearAllBtn.addEventListener("click", clearAll);

  // 언어 전환 시 상태 라벨·버튼 문구 재적용
  document.addEventListener("i18n:change", renderList);

  renderList();
  // TOOLJS:END
})();
