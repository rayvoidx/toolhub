#!/usr/bin/env node
/* 게이트 검증 — usage: node gate-check.js <slug> [<slug>...]  (slug 없이 실행하면 registry/*.json 전체) */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const REPO = "/Users/jaehyun/Library/Mobile Documents/com~apple~CloudDocs/toolhub";
const SCRATCH = path.dirname(__dirname);
const REGISTRY = path.join(SCRATCH, "registry");
const LANGS = ["en","zh","hi","es","ar","fr","bn","pt","ru","ur","id","de","ja","ko"];
const CATS = ["finance","date","health","units","text","dev","random","life","utility"];

let slugs = process.argv.slice(2);
if (!slugs.length) slugs = fs.readdirSync(REGISTRY).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));

let failTotal = 0;
for (const slug of slugs) {
  const dir = path.join(REPO, "services", slug);
  const errs = [];
  const ok = (cond, msg) => { if (!cond) errs.push(msg); };

  // 1. 필수 파일
  const required = ["index.html","404.html","privacy.html","sw.js","manifest.webmanifest",
    "css/style.css","icons/icon.svg","js/app.js","js/config.js","js/i18n.js","js/locales.js","js/related.js"];
  for (const f of required) ok(fs.existsSync(path.join(dir, f)), "missing file: " + f);

  if (!errs.length) {
    // 2. JS 문법
    for (const f of ["js/app.js","js/config.js","js/i18n.js","js/locales.js","js/related.js","sw.js"]) {
      const r = cp.spawnSync("node", ["--check", path.join(dir, f)], { encoding: "utf8" });
      ok(r.status === 0, "syntax error: " + f + " :: " + (r.stderr || "").split("\n")[0]);
    }

    // 3. locales 패리티
    try {
      const src = fs.readFileSync(path.join(dir, "js/locales.js"), "utf8");
      const L = new Function(src.replace("window.I18N_LOCALES", "var L") + ";return L;")();
      const langs = Object.keys(L);
      ok(langs.length === 14 && LANGS.every(l => langs.includes(l)), "locales langs != 14: " + langs.join(","));
      const ref = Object.keys(L.en).sort().join("|");
      for (const g of langs) {
        const k = Object.keys(L[g]).sort().join("|");
        if (k !== ref) {
          const a = new Set(Object.keys(L.en)), b = new Set(Object.keys(L[g]));
          const miss = [...a].filter(x => !b.has(x)), extra = [...b].filter(x => !a.has(x));
          errs.push("locales parity FAIL [" + g + "] missing:" + miss.slice(0,5) + " extra:" + extra.slice(0,5));
        }
      }
      ok(Object.keys(L.en).length >= 20, "locales too thin: " + Object.keys(L.en).length + " keys");
      for (let i = 1; i <= 3; i++) ok(("faq.q"+i) in L.en && ("faq.a"+i) in L.en, "missing faq.q/a" + i);
      ok("meta.title" in L.en && "meta.description" in L.en && "hero.lede" in L.en, "missing meta/hero keys");
    } catch (e) { errs.push("locales eval fail: " + e.message); }

    // 4. index.html
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    ok((html.match(/GTM-TFBT774X/g) || []).length === 2, "GTM count != 2");
    ok(html.includes("gtag('consent', 'default'"), "consent mode block missing");
    ok(html.includes('rel="canonical" href="https://tool-hub.me/' + slug + '/"'), "canonical wrong");
    const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    ok(lds.length >= 3, "ld+json blocks: " + lds.length);
    let faqLd = null;
    for (const m of lds) {
      try { const j = JSON.parse(m[1]); if (j["@type"] === "FAQPage") faqLd = j; }
      catch (e) { errs.push("ld+json parse fail: " + e.message); }
    }
    ok(faqLd, "FAQPage ld+json missing");
    const visFaq = (html.match(/data-i18n="faq\.q\d+"/g) || []).length;
    if (faqLd) ok(faqLd.mainEntity.length === visFaq, "FAQ ld(" + (faqLd ? faqLd.mainEntity.length : 0) + ") != visible(" + visFaq + ")");
    ok(visFaq >= 3, "visible FAQ < 3");
    ok(html.includes('data-i18n="hero.lede"'), "hero.lede hook missing");

    // 4b. 콘텐츠 진위: index.html의 모든 data-i18n 키가 locales.en에 실재 + placeholder 복사본 방지
    try {
      const src2 = fs.readFileSync(path.join(dir, "js/locales.js"), "utf8");
      const L2 = new Function(src2.replace("window.I18N_LOCALES", "var L") + ";return L;")();
      const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, "");
      const hooks = [...htmlNoComments.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g)].map(m => m[1]);
      const missing = [...new Set(hooks)].filter(k => !(k in L2.en));
      ok(missing.length === 0, "data-i18n keys not in locales.en: " + missing.slice(0, 6));
      ok(!/Tip Calculator/i.test(L2.en["meta.title"] || "") || slug === "tip-calc", "locales.js looks like tip-calc placeholder copy");
      const decEnt = s => String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
      ok(decEnt(L2.en["meta.title"] || "") === decEnt(title), "locales en meta.title != <title>");
    } catch (e) { errs.push("authenticity check fail: " + e.message); }
    ok(!/https?:\/\/(?!tool-hub\.me|www\.googletagmanager\.com|pagead2\.googlesyndication\.com|github\.com|ctee\.kr|fonts|schema\.org|www\.w3\.org)/.test(html.replace(/<!--[\s\S]*?-->/g, "")), "unexpected external URL in index.html");

    // 5. config
    const cfgSrc = fs.readFileSync(path.join(dir, "js/config.js"), "utf8");
    ok(cfgSrc.includes('slug: "' + slug + '"'), "config slug mismatch");
    ok(cfgSrc.includes('enabled: false'), "adsense must stay disabled");

    // 6. sw 캐시 이름
    ok(fs.readFileSync(path.join(dir, "sw.js"), "utf8").includes('"' + slug + '-v'), "sw.js cache name not slug-based");

    // 7. 404/privacy GTM
    for (const f of ["404.html","privacy.html"]) {
      const c = fs.readFileSync(path.join(dir, f), "utf8");
      ok((c.match(/GTM-TFBT774X/g) || []).length === 2, f + " GTM count != 2");
    }

    // 8. 레지스트리 JSON (심화 검증 등 병합이 불필요한 경우 GATE_NO_REGISTRY=1 로 스킵)
    if (!process.env.GATE_NO_REGISTRY) {
      const regPath = path.join(REGISTRY, slug + ".json");
      if (!fs.existsSync(regPath)) errs.push("registry json missing");
      else {
        try {
          const r = JSON.parse(fs.readFileSync(regPath, "utf8"));
          ok(r.slug === slug, "registry slug mismatch");
          ok(CATS.includes(r.cat), "registry cat invalid: " + r.cat);
          ok(r.emoji && r.color && /^#[0-9a-f]{6}$/i.test(r.color), "registry emoji/color invalid");
          ok(typeof r.dataName === "string" && r.dataName.length > 10, "registry dataName thin");
          for (const l of LANGS) {
            ok(r.names && typeof r.names[l] === "string" && r.names[l].length > 0, "registry names." + l + " missing");
            ok(r.descs && typeof r.descs[l] === "string" && r.descs[l].length > 0, "registry descs." + l + " missing");
          }
        } catch (e) { errs.push("registry parse fail: " + e.message); }
      }
    }
  }

  if (errs.length) { failTotal++; console.log("FAIL " + slug); errs.forEach(e => console.log("   - " + e)); }
  else console.log("PASS " + slug);
}
console.log("----\n" + (slugs.length - failTotal) + "/" + slugs.length + " PASS");
process.exit(failTotal ? 1 : 0);
