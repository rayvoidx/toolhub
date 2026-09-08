/* 자동 생성: node factory/gen-sw.js — 직접 수정하지 마라.
   전략: HTML=network-first(재방문자가 항상 최신 배포를 본다), 정적자산=stale-while-revalidate.
   2026-09-09 이전 세대(cache-first, 고정 v1)는 배포가 재방문자에게 닿지 않는 결함이었다. */
var CACHE = "week-number-check-v2";
var PRECACHE = [
  "./",
  "index.html",
  "css/style.css",
  "js/config.js",
  "js/locales.js",
  "js/i18n.js",
  "js/app.js",
  "js/ux.js",
  "icons/icon.svg",
  "manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 개별 실패가 설치 전체를 깨지 않게 한다 — 하나 없어도 나머지는 캐시된다.
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(u).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 교차 출처(광고·분석·폰트·환율 API)는 서비스워커가 개입하지 않는다.
  if (url.origin !== self.location.origin) return;

  // HTML 내비게이션 — network-first. 배포한 수정이 재방문자에게 즉시 닿는 유일한 방법.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") !== -1) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, clone); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("index.html");
        });
      })
    );
    return;
  }

  // 정적 자산 — stale-while-revalidate. 캐시를 즉시 주고 뒤에서 갱신한다.
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, clone); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
