#!/usr/bin/env node
/* 허브 병합 — registry/*.json 을 허브 locales/index 카드/sitemap 에 반영하고
   전 도구 related.js 를 카테고리 카탈로그 + 회전 윈도우 방식으로 재생성한다.
   멱등: 이미 등재된 slug 는 건너뛴다. usage: node merge-registry.js [--dry] */
"use strict";
const fs = require("fs");
const path = require("path");

const REPO = "/Users/jaehyun/Library/Mobile Documents/com~apple~CloudDocs/toolhub";
const REGISTRY = path.join(path.dirname(__dirname), "registry");
const LANGS = ["en","zh","hi","es","ar","fr","bn","pt","ru","ur","id","de","ja","ko"];
const TODAY = "2026-07-22";
const DRY = process.argv.includes("--dry");

const regs = fs.readdirSync(REGISTRY).filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(fs.readFileSync(path.join(REGISTRY, f), "utf8")));
console.log("registry entries:", regs.length);

/* ---------- 1. 허브 js/locales.js ---------- */
const locPath = path.join(REPO, "js/locales.js");
let locSrc = fs.readFileSync(locPath, "utf8");
const locObj = new Function(locSrc.replace("window.I18N_LOCALES", "var L") + ";return L;")();
const needLoc = regs.filter(r => !(("tool." + r.slug + ".name") in locObj.en));
console.log("locales: adding", needLoc.length, "tools x14 langs");

const lines = locSrc.split("\n");
const out = [];
let curLang = null;
for (const line of lines) {
  out.push(line);
  const m = line.match(/^  ([a-z]{2}): \{$/);
  if (m) { curLang = m[1]; continue; }
  if (curLang && /^\s*"_label":/.test(line)) {
    for (const r of needLoc) {
      if (!r.names[curLang] || !r.descs[curLang]) throw new Error(r.slug + " missing lang " + curLang);
      out.push('    ' + JSON.stringify("tool." + r.slug + ".name") + ': ' + JSON.stringify(r.names[curLang]) + ',');
      out.push('    ' + JSON.stringify("tool." + r.slug + ".desc") + ': ' + JSON.stringify(r.descs[curLang]) + ',');
    }
    curLang = null; // 이 블록에서는 한 번만
  }
}
const newLocSrc = out.join("\n");
// 검증: 파싱 + 패리티
const locObj2 = new Function(newLocSrc.replace("window.I18N_LOCALES", "var L") + ";return L;")();
const ref = Object.keys(locObj2.en).sort().join("|");
for (const g of LANGS) {
  if (!locObj2[g]) throw new Error("lang missing " + g);
  // 허브 locales 는 언어별 키가 원래도 완전 동일해야 한다
  const k = Object.keys(locObj2[g]).sort().join("|");
  if (k !== ref) {
    const a = new Set(Object.keys(locObj2.en)), b = new Set(Object.keys(locObj2[g]));
    console.warn("WARN hub locales parity", g,
      "missing:", [...a].filter(x => !b.has(x)).slice(0, 5),
      "extra:", [...b].filter(x => !a.has(x)).slice(0, 5));
  }
}
if (!DRY) fs.writeFileSync(locPath, newLocSrc);
console.log("hub locales.js:", Object.keys(locObj2.en).length, "keys per lang");

/* ---------- 2. 허브 index.html 카드 ---------- */
const idxPath = path.join(REPO, "index.html");
let idx = fs.readFileSync(idxPath, "utf8");
const needCard = regs.filter(r => !idx.includes('href="https://tool-hub.me/' + r.slug + '/"'));
console.log("index cards: adding", needCard.length);
const byCat = {};
needCard.forEach(r => (byCat[r.cat] = byCat[r.cat] || []).push(r));
for (const cat of Object.keys(byCat)) {
  const re = new RegExp('(<section class="tool-group" data-group="' + cat + '">[\\s\\S]*?)(\\n\\s*</div>\\s*\\n\\s*</section>)');
  if (!re.test(idx)) throw new Error("index.html group not found: " + cat);
  const cards = byCat[cat].map(r =>
    '        <a class="tool-item" href="https://tool-hub.me/' + r.slug + '/" data-name="' + r.dataName.replace(/"/g, "&quot;") + '">\n' +
    '          <span class="tool-ico" aria-hidden="true">' + r.emoji + '</span>\n' +
    '          <span class="tool-name" data-i18n="tool.' + r.slug + '.name">' + r.names.en + '</span>\n' +
    '        </a>'
  ).join("\n");
  idx = idx.replace(re, (mm, body, close) => body + "\n" + cards + close);
}
if (!DRY) fs.writeFileSync(idxPath, idx);

/* ---------- 3. sitemap.xml ---------- */
const smPath = path.join(REPO, "sitemap.xml");
let sm = fs.readFileSync(smPath, "utf8");
// 완성 도구만: 허브 locales(병합본)에 이름이 등재된 slug만 사이트맵/카탈로그 대상 (부분 빌드 배제)
const allSlugs = fs.readdirSync(path.join(REPO, "services"))
  .filter(s => !s.startsWith("."))
  .filter(s => ("tool." + s + ".name") in locObj2.en);
const needSm = allSlugs.filter(s => !sm.includes("<loc>https://tool-hub.me/" + s + "/</loc>"));
console.log("sitemap: adding", needSm.length);
const entries = needSm.map(s =>
  "  <url>\n    <loc>https://tool-hub.me/" + s + "/</loc>\n    <lastmod>" + TODAY + "</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n");
sm = sm.replace("</urlset>", entries.join("") + "</urlset>");
if (!DRY) fs.writeFileSync(smPath, sm);

/* ---------- 4. related.js 전체 재생성 ---------- */
// 풀 카탈로그 구성: 허브 locales(신규 병합본) 의 tool.<slug>.name ×14 + index.html 카드의 emoji/그룹
const emojiBySlug = {}, catBySlug = {};
{
  const groups = [...idx.matchAll(/<section class="tool-group" data-group="([a-z]+)">([\s\S]*?)<\/section>/g)];
  for (const g of groups) {
    for (const card of g[2].matchAll(/tool-ico" aria-hidden="true">([^<]*)<\/span>\s*\n\s*<span class="tool-name" data-i18n="tool\.([a-z0-9-]+)\.name"/g)) {
      emojiBySlug[card[2]] = card[1];
      catBySlug[card[2]] = g[1];
    }
  }
}
const catalog = {};
for (const s of allSlugs) {
  const names = {};
  for (const g of LANGS) names[g] = (locObj2[g] && locObj2[g]["tool." + s + ".name"]) || null;
  if (!names.en || !catBySlug[s]) { console.warn("WARN catalog skip", s, "name:", !!names.en, "cat:", catBySlug[s]); continue; }
  catalog[s] = { cat: catBySlug[s], emoji: emojiBySlug[s] || "🔧", names };
}
console.log("catalog tools:", Object.keys(catalog).length);

// 템플릿: tip-calc related.js 의 CATALOG/선택 로직만 교체
const tpl = fs.readFileSync(path.join(REPO, "services/tip-calc/js/related.js"), "utf8");
const body = tpl
  .replace(/var CATALOG = \{[\s\S]*?\};/, "var CATALOG = __CATALOG__;")
  .replace(
    /var cat = CATALOG\[slug\]\.cat;\n\s*var sibs = Object\.keys\(CATALOG\)\.filter\(function\(s\)\{ return s !== slug && CATALOG\[s\]\.cat === cat; \}\)\.sort\(\)\.slice\(0, 4\);/,
    'var cat = CATALOG[slug].cat;\n  var ring = Object.keys(CATALOG).filter(function(s){ return CATALOG[s].cat === cat; }).sort();\n  var at = ring.indexOf(slug);\n  var sibs = [];\n  for (var i = 1; i <= ring.length - 1 && sibs.length < 4; i++) sibs.push(ring[(at + i) % ring.length]);');
if (body.includes("__CATALOG__") === false) throw new Error("CATALOG replace failed");
if (body.indexOf("var ring") === -1) throw new Error("sibling logic replace failed");

let regen = 0;
for (const s of allSlugs) {
  if (!catalog[s]) continue;
  const sub = {};
  for (const k of Object.keys(catalog)) if (catalog[k].cat === catalog[s].cat) sub[k] = catalog[k];
  const content = body.replace("__CATALOG__", JSON.stringify(sub));
  const p = path.join(REPO, "services", s, "js/related.js");
  if (!DRY) fs.writeFileSync(p, content);
  regen++;
}
console.log("related.js regenerated:", regen);

/* ---------- 5. 루트 sw.js 캐시 버전 범프 ---------- */
const swPath = path.join(REPO, "sw.js");
let sw = fs.readFileSync(swPath, "utf8");
sw = sw.replace(/var CACHE = "hub-v(\d+)";/, (m, v) => 'var CACHE = "hub-v' + (Number(v) + 1) + '";');
if (!DRY) fs.writeFileSync(swPath, sw);
console.log("done" + (DRY ? " (dry)" : ""));
