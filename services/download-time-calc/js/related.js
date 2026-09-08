(function(){
  "use strict";
  var CATALOG = {"gradient-generator":{"cat":"dev","emoji":"🌈","names":{"en":"CSS Gradient Generator","zh":"CSS 渐变生成器","hi":"CSS ग्रेडिएंट जनरेटर","es":"Generador de Degradados CSS","ar":"مولّد تدرّجات CSS","fr":"Générateur de Dégradés CSS","bn":"CSS গ্রেডিয়েন্ট জেনারেটর","pt":"Gerador de Gradiente CSS","ru":"Генератор градиентов CSS","ur":"CSS گریڈینٹ جنریٹر","id":"Generator Gradien CSS","de":"CSS-Gradient-Generator","ja":"CSSグラデーションジェネレーター","ko":"CSS 그라디언트 생성기"}},"hash-gen":{"cat":"dev","emoji":"#️⃣","names":{"en":"Hash Generator","zh":"哈希生成器","hi":"हैश जनरेटर","es":"Generador de hash","ar":"مولّد التجزئة","fr":"Générateur de hachage","bn":"হ্যাশ জেনারেটর","pt":"Gerador de hash","ru":"Генератор хешей","ur":"ہیش جنریٹر","id":"Generator Hash","de":"Hash-Generator","ja":"ハッシュ生成ツール","ko":"해시 생성기"}},"html-entity-conv":{"cat":"dev","emoji":"🔣","names":{"en":"HTML Entity Encoder / Decoder","zh":"HTML 实体编码器/解码器","hi":"HTML एंटिटी एन्कोडर/डिकोडर","es":"Codificador/Decodificador de Entidades HTML","ar":"مُرمِّز/مُفكِّك كيانات HTML","fr":"Encodeur/Décodeur d'entités HTML","bn":"HTML এনটিটি এনকোডার/ডিকোডার","pt":"Codificador/Decodificador de Entidades HTML","ru":"Кодировщик/декодировщик HTML-сущностей","ur":"HTML اینٹیٹی انکوڈر/ڈی کوڈر","id":"Enkoder/Dekoder Entitas HTML","de":"HTML-Entity-Encoder/-Decoder","ja":"HTMLエンティティ エンコーダー/デコーダー","ko":"HTML 엔티티 인코더/디코더"}},"http-status-lookup":{"cat":"dev","emoji":"🚦","names":{"en":"HTTP Status Code Lookup","zh":"HTTP 状态码查询","hi":"HTTP स्टेटस कोड लुकअप","es":"Códigos de estado HTTP","ar":"البحث في رموز حالة HTTP","fr":"Codes de statut HTTP","bn":"HTTP স্ট্যাটাস কোড লুকআপ","pt":"Códigos de status HTTP","ru":"Коды состояния HTTP","ur":"HTTP اسٹیٹس کوڈ تلاش","id":"Pencarian Kode Status HTTP","de":"HTTP-Statuscodes nachschlagen","ja":"HTTPステータスコード検索","ko":"HTTP 상태 코드 조회"}}};
  var SIBS = ["gradient-generator","hash-gen","html-entity-conv","http-status-lookup"];
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
