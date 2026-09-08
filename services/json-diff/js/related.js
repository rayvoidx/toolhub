(function(){
  "use strict";
  var CATALOG = {"json-formatter":{"cat":"dev","emoji":"⚙️","names":{"en":"JSON Formatter","zh":"JSON 格式化工具","hi":"JSON फ़ॉर्मैटर","es":"Formateador JSON","ar":"منسّق JSON","fr":"Formateur JSON","bn":"JSON ফরম্যাটার","pt":"Formatador JSON","ru":"Форматтер JSON","ur":"JSON فارمیٹر","id":"Pemformat JSON","de":"JSON-Formatter","ja":"JSONフォーマッター","ko":"JSON 포매터"}},"json-to-csv":{"cat":"dev","emoji":"📊","names":{"en":"JSON to CSV Converter","zh":"JSON 转 CSV 转换器","hi":"JSON से CSV कनवर्टर","es":"Conversor de JSON a CSV","ar":"محوّل JSON إلى CSV","fr":"Convertisseur JSON vers CSV","bn":"JSON থেকে CSV কনভার্টার","pt":"Conversor de JSON para CSV","ru":"Конвертер JSON в CSV","ur":"JSON سے CSV کنورٹر","id":"Konverter JSON ke CSV","de":"JSON-zu-CSV-Konverter","ja":"JSON to CSV変換ツール","ko":"JSON to CSV 변환기"}},"json-to-yaml":{"cat":"dev","emoji":"📜","names":{"en":"JSON to YAML Converter","zh":"JSON 转 YAML 在线转换器","hi":"JSON to YAML कन्वर्टर","es":"Conversor de JSON a YAML","ar":"محوّل JSON إلى YAML","fr":"Convertisseur JSON en YAML","bn":"JSON to YAML কনভার্টার","pt":"Conversor de JSON para YAML","ru":"Конвертер JSON в YAML","ur":"JSON سے YAML کنورٹر","id":"Konverter JSON ke YAML","de":"JSON-zu-YAML-Konverter","ja":"JSON to YAML 変換ツール","ko":"JSON to YAML 변환기"}},"jwt-decoder":{"cat":"dev","emoji":"🔑","names":{"en":"JWT Decoder","zh":"JWT 解码器","hi":"JWT डिकोडर","es":"Decodificador JWT","ar":"مفكّك JWT","fr":"Décodeur JWT","bn":"JWT ডিকোডার","pt":"Decodificador JWT","ru":"Декодер JWT","ur":"JWT ڈیکوڈر","id":"Decoder JWT","de":"JWT-Decoder","ja":"JWTデコーダー","ko":"JWT 디코더"}}};
  var SIBS = ["json-formatter","json-to-csv","json-to-yaml","jwt-decoder"];
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
