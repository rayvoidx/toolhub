(function(){
  "use strict";
  var CATALOG = {"coin-flipper":{"cat":"random","emoji":"☯️","names":{"en":"Coin Flip","zh":"抛硬币","hi":"सिक्का उछालें","es":"Lanzar moneda","ar":"رمي العملة","fr":"Pile ou face","bn":"কয়েন ফ্লিপ","pt":"Cara ou coroa","ru":"Подбросить монету","ur":"سکہ اچھالیں","id":"Lempar Koin","de":"Münzwurf","ja":"コイントス","ko":"동전 던지기"}},"dice-roller":{"cat":"random","emoji":"🎲","names":{"en":"Dice Roller","zh":"骰子模拟器","hi":"डाइस रोलर","es":"Lanzador de dados","ar":"رامي النرد","fr":"Lanceur de dés","bn":"ডাইস রোলার","pt":"Rolador de dados","ru":"Бросок кубиков","ur":"ڈائس رولر","id":"Pelempar dadu","de":"Würfel-Roller","ja":"ダイスローラー","ko":"주사위 굴리기"}},"random-number-gen":{"cat":"random","emoji":"🎰","names":{"en":"Random Number Generator","zh":"随机数生成器","hi":"रैंडम नंबर जनरेटर","es":"Generador de números aleatorios","ar":"مولّد أرقام عشوائية","fr":"Générateur de nombres aléatoires","bn":"র‍্যান্ডম নম্বর জেনারেটর","pt":"Gerador de números aleatórios","ru":"Генератор случайных чисел","ur":"رینڈم نمبر جنریٹر","id":"Generator Angka Acak","de":"Zufallszahlengenerator","ja":"乱数ジェネレーター","ko":"랜덤 숫자 생성기"}}};
  var HEADING = {"en":"Related tools","ko":"관련 도구","ja":"関連ツール","zh":"相关工具","es":"Herramientas relacionadas","fr":"Outils similaires","de":"Ähnliche Tools","pt":"Ferramentas relacionadas","ru":"Похожие инструменты","ar":"أدوات ذات صلة","hi":"संबंधित टूल","bn":"সম্পর্কিত টুল","id":"Alat terkait","ur":"متعلقہ ٹولز"};
  var cfg = window.APP_CONFIG || {};
  var slug = cfg.slug, host = document.getElementById("related-tools");
  if (!host || !slug || !CATALOG[slug]) { if(host) host.hidden = true; return; }
  var cat = CATALOG[slug].cat;
  var ring = Object.keys(CATALOG).filter(function(s){ return CATALOG[s].cat === cat; }).sort();
  var at = ring.indexOf(slug);
  var sibs = [];
  for (var i = 1; i <= ring.length - 1 && sibs.length < 4; i++) sibs.push(ring[(at + i) % ring.length]);
  if (!sibs.length) { host.hidden = true; return; }
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