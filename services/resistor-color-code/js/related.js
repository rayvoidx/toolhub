(function(){
  "use strict";
  var CATALOG = {"robots-txt-generator":{"cat":"dev","emoji":"🤖","names":{"en":"Robots.txt Generator","zh":"robots.txt 生成器","hi":"Robots.txt जनरेटर","es":"Generador de robots.txt","ar":"مولّد robots.txt","fr":"Générateur de robots.txt","bn":"Robots.txt জেনারেটর","pt":"Gerador de robots.txt","ru":"Генератор robots.txt","ur":"Robots.txt جنریٹر","id":"Generator Robots.txt","de":"Robots.txt-Generator","ja":"robots.txt 生成ツール","ko":"robots.txt 생성기"}},"slug-generator":{"cat":"dev","emoji":"🔗","names":{"en":"URL Slug Generator","zh":"URL Slug 生成器","hi":"URL स्लग जेनरेटर","es":"Generador de slugs URL","ar":"مولّد روابط URL","fr":"Générateur de slug URL","bn":"URL স্লাগ জেনারেটর","pt":"Gerador de slug de URL","ru":"Генератор URL-слагов","ur":"یو آر ایل سلگ جنریٹر","id":"Generator Slug URL","de":"URL-Slug-Generator","ja":"URLスラッグ生成ツール","ko":"URL 슬러그 생성기"}},"sql-formatter":{"cat":"dev","emoji":"🗄️","names":{"en":"SQL Formatter","zh":"SQL 格式化工具","hi":"SQL फ़ॉर्मेटर","es":"Formateador de SQL","ar":"منسّق SQL","fr":"Formateur SQL","bn":"SQL ফরম্যাটার","pt":"Formatador de SQL","ru":"Форматировщик SQL","ur":"SQL فارمیٹر","id":"SQL Formatter","de":"SQL-Formatierer","ja":"SQLフォーマッター","ko":"SQL 포맷터"}},"subnet-calc":{"cat":"dev","emoji":"🌐","names":{"en":"IP Subnet Calculator","zh":"IP 子网计算器","hi":"IP सबनेट कैलकुलेटर","es":"Calculadora de Subredes IP","ar":"حاسبة الشبكات الفرعية IP","fr":"Calculateur de Sous-réseau IP","bn":"IP সাবনেট ক্যালকুলেটর","pt":"Calculadora de Sub-rede IP","ru":"Калькулятор подсетей IP","ur":"IP سب نیٹ کیلکولیٹر","id":"Kalkulator Subnet IP","de":"IP-Subnetzrechner","ja":"IPサブネット計算機","ko":"IP 서브넷 계산기"}}};
  var SIBS = ["robots-txt-generator","slug-generator","sql-formatter","subnet-calc"];
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
