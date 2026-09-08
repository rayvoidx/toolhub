(function(){
  "use strict";
  var CATALOG = {"name-picker":{"cat":"random","emoji":"🎡","names":{"en":"Random Name Picker","zh":"随机抽签器","hi":"रैंडम नेम पिकर","es":"Selector Aleatorio de Nombres","ar":"أداة اختيار الأسماء العشوائية","fr":"Tirage au Sort de Noms","bn":"র‍্যান্ডম নেম পিকার","pt":"Sorteador Aleatório de Nomes","ru":"Случайный Выбор Имён","ur":"رینڈم نیم پکر","id":"Pemilih Nama Acak","de":"Zufälliger Namensgenerator","ja":"ランダム名前選び","ko":"랜덤 이름 뽑기"}},"random-number-gen":{"cat":"random","emoji":"🎰","names":{"en":"Random Number Generator","zh":"随机数生成器","hi":"रैंडम नंबर जनरेटर","es":"Generador de números aleatorios","ar":"مولّد أرقام عشوائية","fr":"Générateur de nombres aléatoires","bn":"র‍্যান্ডম নম্বর জেনারেটর","pt":"Gerador de números aleatórios","ru":"Генератор случайных чисел","ur":"رینڈم نمبر جنریٹر","id":"Generator Angka Acak","de":"Zufallszahlengenerator","ja":"乱数ジェネレーター","ko":"랜덤 숫자 생성기"}},"random-team-gen":{"cat":"random","emoji":"👥","names":{"en":"Random Team Generator","zh":"随机分组生成器","hi":"रैंडम टीम जनरेटर","es":"Generador de Equipos Aleatorios","ar":"مولّد الفرق العشوائي","fr":"Générateur d'Équipes Aléatoires","bn":"র‍্যান্ডম টিম জেনারেটর","pt":"Gerador de Times Aleatórios","ru":"Генератор случайных команд","ur":"رینڈم ٹیم جنریٹر","id":"Generator Tim Acak","de":"Zufalls-Team-Generator","ja":"ランダムチーム分けツール","ko":"랜덤 팀 생성기"}},"secret-santa-generator":{"cat":"random","emoji":"🎁","names":{"en":"Secret Santa Generator","zh":"神秘圣诞老人抽签器","hi":"सीक्रेट सैंटा जेनरेटर","es":"Generador de Amigo Invisible","ar":"مولّد سانتا السري","fr":"Générateur de Secret Santa","bn":"সিক্রেট সান্তা জেনারেটর","pt":"Gerador de Amigo Secreto","ru":"Генератор Тайного Санты","ur":"سیکرٹ سانتا جنریٹر","id":"Generator Secret Santa","de":"Wichteln-Generator","ja":"シークレットサンタ抽選ツール","ko":"시크릿 산타 추첨기"}}};
  var SIBS = ["name-picker","random-number-gen","random-team-gen","secret-santa-generator"];
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
