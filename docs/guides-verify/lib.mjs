// Shared helpers for the /guides/ number checks. Each <guide>.mjs recomputes the figures quoted
// in guides/<guide>/index.html — calling the tool's own functions where they are pure — and fails
// if a quoted figure is missing from the page. Run all: node --test worker/guides.test.mjs
// docs/ is excluded from deployed assets (.assetsignore).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Pull named function declarations out of services/<slug>/js/app.js and evaluate them in a sandbox.
// Brace matching is naive (ponytail: breaks on unbalanced braces inside strings; throws rather than lies).
export function toolFns(slug, names, globals = {}) {
  const src = fs.readFileSync(path.join(ROOT, "services", slug, "js/app.js"), "utf8");
  const code = names.map((n) => extractFn(src, n, slug)).join("\n");
  const ctx = vm.createContext({ Math, Number, isFinite, isNaN, parseFloat, parseInt, ...globals });
  vm.runInContext(code + "\n;globalThis.__f = {" + names.join(",") + "};", ctx);
  return ctx.__f;
}
function extractFn(src, name, slug) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(`${slug}: function ${name} not found`);
  let depth = 0;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`${slug}: unbalanced braces in ${name}`);
}

// Visible text of a guide, entities decoded, whitespace collapsed.
export function guideText(guide) {
  const html = fs.readFileSync(path.join(ROOT, "guides", guide, "index.html"), "utf8");
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&minus;/g, "−").replace(/&times;/g, "×").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&rarr;/g, "→").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ");
}

export const usd = (n, d = 0) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const num = (n, d = 0) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// checker(guide) → { expect(label, string), close(label, a, b, tol), done() }
export function checker(guide) {
  const text = guideText(guide);
  const fails = [];
  let n = 0;
  return {
    expect(label, s) { n++; if (!text.includes(s)) fails.push(`missing "${s}" (${label})`); },
    close(label, a, b, tol = 1e-6) { n++; if (!(Math.abs(a - b) <= tol)) fails.push(`${label}: ${a} vs ${b}`); },
    done() {
      if (fails.length) { console.error(`${guide}: ${fails.length}/${n} checks failed\n  ` + fails.join("\n  ")); process.exit(1); }
      console.log(`${guide}: ${n} checks passed`);
    },
  };
}
