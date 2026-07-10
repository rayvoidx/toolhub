/* 오프라인 캐시 — 캐시 이름의 버전을 올리면 이전 캐시는 자동 정리된다. */
var CACHE = "loan-calc-v1";
var ASSETS = [
  "./",
  "index.html",
  "css/style.css",
  "js/config.js",
  "js/locales.js",
  "js/i18n.js",
  "js/app.js",
  "icons/icon.svg",
  "manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  // 광고/분석 요청은 캐시하지 않는다
  var url = e.request.url;
  if (url.indexOf("googlesyndication") !== -1 || url.indexOf("googletagmanager") !== -1) return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        if (res.ok && url.indexOf(self.location.origin) === 0) {
          var clone = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, clone); });
        }
        return res;
      });
    }).catch(function () { return caches.match("index.html"); })
  );
});
