(function(){
  "use strict";
  var CATALOG = {"csv-diff":{"cat":"text","emoji":"📑","names":{"en":"Csv Diff","zh":"Csv Diff","hi":"Csv Diff","es":"Csv Diff","ar":"Csv Diff","fr":"Csv Diff","bn":"Csv Diff","pt":"Csv Diff","ru":"Csv Diff","ur":"Csv Diff","id":"Csv Diff","de":"Csv Diff","ja":"Csv Diff","ko":"Csv Diff"}},"find-replace-text":{"cat":"text","emoji":"🔎","names":{"en":"Find and Replace Text","zh":"查找替换工具","hi":"फाइंड एंड रिप्लेस टूल","es":"Buscar y Reemplazar Texto","ar":"أداة البحث والاستبدال","fr":"Rechercher et Remplacer","bn":"ফাইন্ড অ্যান্ড রিপ্লেস","pt":"Localizar e Substituir","ru":"Найти и заменить","ur":"فائنڈ اینڈ ری پلیس","id":"Cari dan Ganti Teks","de":"Suchen und Ersetzen","ja":"検索・置換ツール","ko":"찾아 바꾸기"}},"list-compare":{"cat":"text","emoji":"🔀","names":{"en":"Compare Two Lists","zh":"对比两个列表","hi":"दो सूचियाँ तुलना करें","es":"Comparar dos listas","ar":"قارن قائمتين","fr":"Comparer deux listes","bn":"দুটি তালিকা তুলনা করুন","pt":"Comparar duas listas","ru":"Сравнить два списка","ur":"دو فہرستوں کا موازنہ","id":"Bandingkan dua daftar","de":"Zwei Listen vergleichen","ja":"2つのリストを比較","ko":"두 목록 비교"}},"lorem-ipsum-gen":{"cat":"text","emoji":"📄","names":{"en":"Lorem Ipsum Generator","zh":"Lorem Ipsum 生成器","hi":"Lorem Ipsum जनरेटर","es":"Generador de Lorem Ipsum","ar":"مولّد Lorem Ipsum","fr":"Générateur de Lorem Ipsum","bn":"Lorem Ipsum জেনারেটর","pt":"Gerador de Lorem Ipsum","ru":"Генератор Lorem Ipsum","ur":"Lorem Ipsum جنریٹر","id":"Generator Lorem Ipsum","de":"Lorem-Ipsum-Generator","ja":"Lorem Ipsum ジェネレーター","ko":"로렘 입숨 생성기"}}};
  var SIBS = ["csv-diff","find-replace-text","list-compare","lorem-ipsum-gen"];
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
