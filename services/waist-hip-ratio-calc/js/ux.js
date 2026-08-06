/* ux.js — 셸 공통 사용성 보강. 도구 로직은 건드리지 않고 바깥에서만 붙인다.
 *
 * 왜 (2026-07-27): 도구마다 엔터 제출·결과 스크롤·복사 지원이 제각각이었다. 도구별로 고치면
 * 109종을 109번 고치게 되므로, 도구가 이미 제공하는 동작은 감지해서 건너뛰고 없을 때만 보강한다.
 *
 * 보강 항목
 *  1. 도구 영역 어디서나 Enter → 기본 계산 버튼 실행 (textarea 는 제외 — 줄바꿈이 우선)
 *  2. 계산 후 결과가 화면 밖이면 부드럽게 스크롤 (모바일에서 결과를 놓치는 문제)
 *  3. 결과 값 탭/클릭 복사 (.rc-val, .result-value) — 이미 복사 버튼이 있으면 붙이지 않는다
 *  4. 오류 문구에 role="alert" 부여 — 스크린리더가 즉시 읽는다
 *  5. 첫 입력칸 자동 포커스 (터치 기기 제외 — 키보드가 화면을 덮는다)
 *  6. Escape → 입력 비우고 첫 칸으로 (되돌리기 쉬운 탈출구)
 */
(function ux() {
  "use strict";
  var tool = document.getElementById("tool");
  if (!tool) return;

  var t = function (k, fb) {
    var v = window.I18N && window.I18N.t ? window.I18N.t(k) : null;
    return v && v !== k ? v : fb;
  };
  var primary = tool.querySelector("#calc-btn, button.primary, button[type=submit]");
  var result = document.getElementById("result") || tool.querySelector(".result, .result-cards");
  var errBox = document.getElementById("err") || tool.querySelector(".err, .error");

  /* 1. Enter 제출 */
  if (primary) {
    tool.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      var el = e.target;
      if (!el || el.tagName === "TEXTAREA" || el.tagName === "BUTTON" || el.tagName === "A") return;
      if (el.tagName !== "INPUT" && el.tagName !== "SELECT") return;
      e.preventDefault();
      primary.click();
    });
  }

  /* 2. 결과 스크롤 */
  if (primary && result) {
    primary.addEventListener("click", function () {
      setTimeout(function () {
        if (result.hidden || result.offsetParent === null) return;
        var r = result.getBoundingClientRect();
        if (r.top >= 0 && r.bottom <= (window.innerHeight || 0)) return;
        try { result.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
        catch (e) { result.scrollIntoView(); }
      }, 60);
    });
  }

  /* 3. 결과 값 탭 복사 */
  if (result && !result.querySelector(".copy-btn")) {
    var COPY_HINT = t("ux.copyHint", "Tap to copy");
    var COPIED = t("ux.copied", "Copied");
    var mark = function () {
      Array.prototype.forEach.call(result.querySelectorAll(".rc-val, .result-value"), function (c) {
        c.style.cursor = "copy";
        if (!c.title) c.title = COPY_HINT;
      });
    };
    result.addEventListener("click", function (e) {
      var cell = e.target.closest ? e.target.closest(".rc-val, .result-value") : null;
      if (!cell || cell.getAttribute("data-flash")) return;
      var text = cell.textContent.trim();
      if (!text || text === "—") return;
      var flash = function () {
        cell.setAttribute("data-flash", "1");
        var badge = document.createElement("span");
        badge.textContent = " " + COPIED;
        badge.style.cssText = "font-size:12px;font-weight:600;opacity:.7";
        cell.appendChild(badge);
        setTimeout(function () { badge.remove(); cell.removeAttribute("data-flash"); }, 1100);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(flash, function () { /* 권한 거부 */ });
      else flash();
    });
    mark();
    if (window.MutationObserver) new MutationObserver(mark).observe(result, { childList: true, subtree: true });
  }

  /* 4. 오류 문구 알림 역할 */
  if (errBox && !errBox.getAttribute("role")) errBox.setAttribute("role", "alert");

  /* 5. 첫 입력칸 포커스 */
  if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
    var first = tool.querySelector("input:not([type=hidden]):not([readonly]), textarea, select");
    if (first && first.offsetParent !== null) {
      try { first.focus({ preventScroll: true }); } catch (e) { /* 구형 브라우저 */ }
    }
  }

  /* 6. Escape 로 입력 비우기 */
  tool.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var fields = tool.querySelectorAll("input:not([type=hidden]):not([readonly]):not([type=radio]):not([type=checkbox]), textarea");
    var any = false;
    Array.prototype.forEach.call(fields, function (f) {
      if (f.value) { f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); any = true; }
    });
    if (any && fields[0]) fields[0].focus();
  });

  /* ── v2 (2026-08-02) — 대중성 디테일: 공유·예시·입력 기억·방문 로그 ── */

  /* 7. 공유 버튼 — 모바일 네이티브 공유, 데스크톱 링크 복사 */
  var actions = document.querySelector(".header-actions");
  if (actions && !document.getElementById("ux-share") && !document.getElementById("share-btn")) {
    var sb = document.createElement("button");
    sb.id = "ux-share"; sb.type = "button"; sb.textContent = "↗";
    var shareLabel = t("ux.share", "Share this tool");
    sb.setAttribute("aria-label", shareLabel); sb.title = shareLabel;
    sb.addEventListener("click", function () {
      if (navigator.share) { navigator.share({ title: document.title, url: location.href }).catch(function () {}); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () {
        sb.textContent = "✓";
        setTimeout(function () { sb.textContent = "↗"; }, 1100);
      }, function () {});
    });
    actions.insertBefore(sb, actions.firstChild);
  }

  /* 9. 입력 기억 — 마지막 사용값 복원(빈 칸만), 입력 시 저장, Escape 로 삭제.
     복원을 예시 버튼 판정보다 먼저 해, 재방문자에게는 예시 버튼이 뜨지 않게 한다. */
  var memKey = "uxmem:" + location.pathname;
  try {
    var saved = JSON.parse(localStorage.getItem(memKey) || "{}");
    Object.keys(saved).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || !tool.contains(el)) return;
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked !== saved[id]) { el.checked = !!saved[id]; el.dispatchEvent(new Event("change", { bubbles: true })); }
      } else if (el.tagName === "SELECT") {
        var has = Array.prototype.some.call(el.options, function (o) { return o.value === saved[id]; });
        if (has && el.value !== saved[id]) { el.value = saved[id]; el.dispatchEvent(new Event("change", { bubbles: true })); }
      } else if (!el.value && saved[id]) {
        el.value = saved[id]; el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  } catch (e) { /* 손상된 저장값은 무시 */ }
  var memTimer;
  tool.addEventListener("input", function () {
    clearTimeout(memTimer);
    memTimer = setTimeout(function () {
      var out = {};
      Array.prototype.forEach.call(tool.querySelectorAll("input[id], select[id], textarea[id]"), function (el) {
        if (["file", "password", "button", "submit", "hidden"].indexOf(el.type) !== -1) return;
        if (el.type === "checkbox" || el.type === "radio") out[el.id] = el.checked;
        else if (el.value) out[el.id] = el.value;
      });
      try { localStorage.setItem(memKey, JSON.stringify(out)); } catch (e) {}
    }, 500);
  });
  tool.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { try { localStorage.removeItem(memKey); } catch (err) {} }
  });

  /* 8. 예시 채우기 — 첫 방문(전부 빈 칸)일 때만, 플레이스홀더를 그대로 넣고 계산 */
  if (primary && !tool.querySelector("#ux-example")) {
    var exFields = Array.prototype.filter.call(tool.querySelectorAll("input[placeholder], textarea[placeholder]"), function (i) {
      if (i.tagName === "INPUT" && ["text", "number", "search", "tel"].indexOf(i.type) === -1) return false;
      return i.offsetParent !== null && i.placeholder.trim();
    });
    var allEmpty = exFields.length && Array.prototype.every.call(exFields, function (i) { return !i.value; });
    if (allEmpty) {
      var ex = document.createElement("button");
      ex.type = "button"; ex.id = "ux-example"; ex.className = "chip";
      ex.textContent = t("ux.example", "Try an example");
      ex.style.cssText = "margin-left:8px;background:none;border:1px dashed var(--line);color:var(--muted);border-radius:8px;padding:10px 14px;cursor:pointer;font-size:14px";
      primary.parentNode.insertBefore(ex, primary.nextSibling);
      ex.addEventListener("click", function () {
        exFields.forEach(function (i) {
          if (i.value) return;
          i.value = i.placeholder.replace(/^e\.g\.\s*/i, "");
          i.dispatchEvent(new Event("input", { bubbles: true }));
          i.dispatchEvent(new Event("change", { bubbles: true }));
        });
        primary.click();
        ex.remove();
      });
    }
  }

  /* 10. 방문 로그 — 허브 홈 "최근 사용" 줄의 데이터 (링크는 허브가 렌더) */
  try {
    var slug = location.pathname.replace(/\//g, "");
    if (slug) {
      var rec = JSON.parse(localStorage.getItem("ux:recent") || "[]");
      var name = (document.title.split(/—|\||-/)[0] || slug).trim();
      rec = [{ s: slug, n: name }].concat(rec.filter(function (r) { return r && r.s !== slug; })).slice(0, 8);
      localStorage.setItem("ux:recent", JSON.stringify(rec));
    }
  } catch (e) {}

  /* v2.1: 언어 전환 시 ux 부가 문구 재렌더 (2026-08-06) */
  document.addEventListener("i18n:change", function () {
    var ex = document.getElementById("ux-example");
    if (ex) ex.textContent = t("ux.example", "Try an example");
    var sb = document.getElementById("ux-share");
    if (sb) { var sl = t("ux.share", "Share this tool"); sb.setAttribute("aria-label", sl); sb.title = sl; }
  });
})();
