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
})();
