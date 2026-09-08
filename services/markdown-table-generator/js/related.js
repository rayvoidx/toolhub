(function(){
  "use strict";
  var CATALOG = {"meta-tag-generator":{"cat":"dev","emoji":"🏷️","names":{"en":"Meta Tag Generator","zh":"元标签生成器","hi":"मेटा टैग जनरेटर","es":"Generador de Meta Tags","ar":"مولّد الوسوم الوصفية","fr":"Générateur de balises Meta","bn":"মেটা ট্যাগ জেনারেটর","pt":"Gerador de Meta Tags","ru":"Генератор мета-тегов","ur":"میٹا ٹیگ جنریٹر","id":"Generator Meta Tag","de":"Meta-Tag-Generator","ja":"メタタグジェネレーター","ko":"메타태그 생성기"}},"number-base-conv":{"cat":"dev","emoji":"🔢","names":{"en":"Number Base Converter","zh":"进制转换器","hi":"संख्या आधार कन्वर्टर","es":"Conversor de bases numéricas","ar":"محوّل الأنظمة العددية","fr":"Convertisseur de bases","bn":"সংখ্যা ভিত্তি কনভার্টার","pt":"Conversor de bases numéricas","ru":"Конвертер систем счисления","ur":"نمبر بیس کنورٹر","id":"Konverter Basis Bilangan","de":"Zahlensystem-Umrechner","ja":"基数変換ツール","ko":"진법 변환기"}},"password-strength-checker":{"cat":"dev","emoji":"🔒","names":{"en":"Password Strength Checker","zh":"密码强度检测器","hi":"पासवर्ड स्ट्रेंथ चेकर","es":"Comprobador de contraseñas","ar":"فاحص قوة كلمة المرور","fr":"Testeur de mot de passe","bn":"পাসওয়ার্ড শক্তি পরীক্ষক","pt":"Verificador de senha","ru":"Проверка надёжности пароля","ur":"پاس ورڈ اسٹرینتھ چیکر","id":"Pemeriksa Kekuatan Kata Sandi","de":"Passwort-Stärke prüfen","ja":"パスワード強度チェッカー","ko":"비밀번호 강도 검사기"}},"ppi-calc":{"cat":"dev","emoji":"🖥️","names":{"en":"PPI Calculator","zh":"PPI 计算器","hi":"PPI कैलकुलेटर","es":"Calculadora de PPI","ar":"حاسبة PPI","fr":"Calculateur PPI","bn":"PPI ক্যালকুলেটর","pt":"Calculadora de PPI","ru":"Калькулятор PPI","ur":"PPI کیلکولیٹر","id":"Kalkulator PPI","de":"PPI-Rechner","ja":"PPI計算ツール","ko":"PPI 계산기"}}};
  var SIBS = ["meta-tag-generator","number-base-conv","password-strength-checker","ppi-calc"];
  var HEADING = {"en":"Related tools","ko":"관련 도구","ja":"関連ツール","zh":"相关工具","es":"Herramientas relacionadas","fr":"Outils similaires","de":"Ähnliche Tools","pt":"Ferramentas relacionadas","ru":"Похожие инструменты","ar":"أدوات ذات صلة","hi":"संबंधित टूल","bn":"সম্পর্কিত টুল","id":"Alat terkait","ur":"متعلقہ ٹولز"};
  var host = document.getElementById("related-tools");
  // 형제는 빌드 시 확정(회전 선택 — 알파벳 앞 도구에만 인바운드가 몰리지 않게 균등 배분).
  var sibs = SIBS;
  if (!host || !sibs.length) { if(host) host.hidden = true; return; }
  if (!document.getElementById("related-tools-style")) {
    var st = document.createElement("style"); st.id = "related-tools-style";
    st.textContent = ".related{margin:36px 0 8px}.related h2{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:0 0 14px;color:var(--ink)}.related-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}.related-item{display:flex;align-items:center;gap:11px;padding:12px 13px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);text-decoration:none;transition:border-color .15s,transform .15s}.related-item:hover{border-color:var(--accent);transform:translateY(-2px)}.related-ico{flex-shrink:0;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:18px;border-radius:8px;background:color-mix(in srgb,var(--accent) 12%,var(--surface))}.related-name{font-size:14px;font-weight:600;line-height:1.3}";
    document.head.appendChild(st);
  }
  function curLang(){ var l = document.documentElement.getAttribute("lang") || cfg.lang || "en"; return HEADING[l] ? l : "en"; }
  function render(){
    var lg = curLang();
    host.className = "related"; host.textContent = "";
    var h2 = document.createElement("h2"); h2.textContent = HEADING[lg]; host.appendChild(h2);
    var grid = document.createElement("div"); grid.className = "related-grid";
    sibs.forEach(function(s){
      var t = CATALOG[s];
      var a = document.createElement("a"); a.className = "related-item"; a.href = "https://tool-hub.me/" + s + "/";
      var ico = document.createElement("span"); ico.className = "related-ico"; ico.setAttribute("aria-hidden","true"); ico.textContent = t.emoji;
      var nm = document.createElement("span"); nm.className = "related-name"; nm.textContent = t.names[lg] || t.names.en || s;
      a.appendChild(ico); a.appendChild(nm); grid.appendChild(a);
    });
    host.appendChild(grid); host.hidden = false;
  }
  render();
  document.addEventListener("i18n:change", render);
})();
