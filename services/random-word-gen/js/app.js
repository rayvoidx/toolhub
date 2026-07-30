/* ============================================================
   앱 셸 공통 로직 — 원칙적으로 수정하지 않는다.
   서비스 고유 로직은 아래 "TOOL MODULE" 영역에만 작성한다.
   ============================================================ */
(function shell() {
  "use strict";
  var cfg = window.APP_CONFIG || {};

  // 연도
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // 테마 토글: auto → light → dark → auto
  var themeBtn = document.getElementById("theme-toggle");
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(cfg.slug + ":theme"); } catch (e) { /* private mode */ }
  if (saved) root.setAttribute("data-theme", saved);
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var order = ["auto", "light", "dark"];
      var cur = root.getAttribute("data-theme") || "auto";
      var next = order[(order.indexOf(cur) + 1) % order.length];
      root.setAttribute("data-theme", next);
      try { localStorage.setItem(cfg.slug + ":theme", next); } catch (e) { /* noop */ }
    });
  }

  // 공유
  var shareBtn = document.getElementById("share-btn");
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      var data = { title: document.title, url: location.href };
      if (navigator.share) {
        navigator.share(data).catch(function () { /* 사용자가 취소 */ });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(location.href).then(function () {
          shareBtn.textContent = "✓";
          setTimeout(function () { shareBtn.textContent = "↗"; }, 1200);
        });
      }
    });
  }

  // PWA 서비스워커
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* 오프라인 미지원 환경 */ });
  }

  // AdSense — 게이트 통과 전에는 enabled=false 라 아무것도 하지 않는다
  if (cfg.adsense && cfg.adsense.enabled && cfg.adsense.client && cfg.adsense.slot) {
    var slotEl = document.getElementById("ad-slot");
    if (slotEl) {
      slotEl.hidden = false;
      var ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.setAttribute("data-ad-client", cfg.adsense.client);
      ins.setAttribute("data-ad-slot", cfg.adsense.slot);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      slotEl.appendChild(ins);
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
  }

  // GA4 — 설정 시에만 로드, 실패해도 본 기능에 영향 없게 격리 (safeTrack 원칙)
  if (cfg.analytics && cfg.analytics.ga4) {
    try {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + cfg.analytics.ga4;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", cfg.analytics.ga4);
    } catch (e) { /* 분석 실패는 조용히 무시 */ }
  }
})();

/* ============================================================
   TOOL MODULE — 빌더 에이전트가 이 영역을 서비스 로직으로 교체한다.
   규칙:
   - 상태는 localStorage(키 prefix: cfg.slug + ":") 또는 URL 파라미터에만 저장
   - 외부 API 호출 시 실패 UI(.result에 오류 문구) 필수
   - 빈 입력/공집합도 명시적으로 처리 (조용한 실패 금지)
   ============================================================ */
(function tool() {
  "use strict";
  // TOOLJS:START
  /* Random Word Generator — baked ~1,240-word English vocabulary split into
     noun/verb/adjective pools, filtered by category/starting letter/length,
     then sampled WITHOUT replacement using crypto.getRandomValues (rejection
     sampling for an unbiased draw). No external API, no network, no eval(). */

  /* ---- baked word bank (lowercase, single-token, no proper nouns) ---- */
  var NOUN = ["person", "man", "woman", "child", "baby", "boy", "girl", "friend", "neighbor",
    "stranger", "teacher", "student", "doctor", "nurse", "lawyer", "engineer", "scientist",
    "artist", "writer", "musician", "actor", "dancer", "chef", "farmer", "driver", "pilot",
    "sailor", "soldier", "police", "firefighter", "waiter", "cashier", "manager", "worker",
    "employee", "employer", "customer", "client", "guest", "visitor", "mother", "father",
    "parent", "sister", "brother", "daughter", "son", "husband", "wife", "grandmother",
    "grandfather", "aunt", "uncle", "cousin", "family", "head", "face", "eye", "ear", "nose",
    "mouth", "tooth", "tongue", "neck", "shoulder", "arm", "elbow", "hand", "finger", "chest",
    "back", "leg", "knee", "foot", "toe", "sun", "moon", "star", "sky", "cloud", "rain", "snow",
    "wind", "storm", "thunder", "lightning", "rainbow", "ocean", "sea", "river", "lake",
    "mountain", "hill", "valley", "forest", "jungle", "desert", "island", "beach", "shore",
    "cave", "cliff", "volcano", "earthquake", "flood", "drought", "season", "weather",
    "climate", "planet", "dog", "cat", "bird", "fish", "horse", "cow", "pig", "sheep", "goat",
    "chicken", "duck", "rabbit", "mouse", "rat", "lion", "tiger", "bear", "wolf", "fox", "deer",
    "elephant", "monkey", "snake", "frog", "turtle", "butterfly", "bee", "ant", "spider", "fly",
    "whale", "dolphin", "shark", "eagle", "owl", "tree", "flower", "leaf", "branch", "root",
    "seed", "fruit", "vegetable", "grass", "bush", "garden", "plant", "stem", "petal", "bread",
    "cheese", "butter", "milk", "egg", "sugar", "salt", "pepper", "rice", "wheat", "corn",
    "potato", "tomato", "onion", "garlic", "meat", "beef", "pork", "soup", "salad", "sandwich",
    "pizza", "cake", "cookie", "candy", "chocolate", "coffee", "tea", "juice", "wine", "beer",
    "apple", "banana", "orange", "grape", "lemon", "cherry", "peach", "house", "home", "room",
    "kitchen", "bedroom", "bathroom", "door", "window", "wall", "floor", "ceiling", "roof",
    "stair", "table", "chair", "sofa", "bed", "lamp", "mirror", "curtain", "carpet", "shelf",
    "drawer", "cabinet", "closet", "blanket", "pillow", "towel", "key", "hammer", "nail",
    "screw", "wrench", "saw", "knife", "fork", "spoon", "plate", "bowl", "cup", "glass",
    "bottle", "jar", "box", "bag", "basket", "bucket", "rope", "ladder", "brush", "comb",
    "soap", "clock", "watch", "phone", "computer", "keyboard", "screen", "camera", "car",
    "truck", "bus", "train", "plane", "boat", "ship", "bicycle", "motorcycle", "taxi", "subway",
    "ferry", "helicopter", "wagon", "sled", "school", "hospital", "church", "market", "store",
    "shop", "bank", "library", "museum", "park", "airport", "station", "factory", "office",
    "hotel", "restaurant", "cafe", "theater", "stadium", "university", "college", "prison",
    "farm", "village", "town", "time", "year", "day", "week", "month", "hour", "minute",
    "second", "life", "world", "idea", "thought", "dream", "hope", "fear", "love", "hate",
    "joy", "sadness", "anger", "peace", "war", "freedom", "justice", "truth", "lie", "secret",
    "mystery", "story", "history", "culture", "language", "music", "art", "science", "math",
    "knowledge", "wisdom", "power", "energy", "force", "pressure", "speed", "distance",
    "weight", "size", "shape", "color", "sound", "smell", "taste", "touch", "sense", "memory",
    "imagination", "reason", "logic", "faith", "belief", "opinion", "job", "work", "business",
    "company", "industry", "price", "cost", "value", "profit", "loss", "tax", "budget",
    "income", "salary", "wage", "contract", "deal", "project", "plan", "goal", "task",
    "meeting", "report", "document", "letter", "email", "message", "note", "game", "sport",
    "ball", "team", "player", "coach", "race", "match", "score", "victory", "defeat",
    "championship", "tournament", "puzzle", "chess", "cards", "dice", "toy", "kite", "balloon",
    "drum", "guitar", "piano", "violin", "nation", "government", "president", "election",
    "vote", "senator", "congress", "law", "court", "judge", "jury", "trial", "crime",
    "criminal", "victim", "witness", "evidence", "sentence", "punishment", "rights", "citizen",
    "immigrant", "refugee", "border", "passport", "visa", "currency", "coin", "wallet", "purse",
    "jewelry", "ring", "necklace", "bracelet", "earring", "crown", "throne", "castle", "palace",
    "kingdom", "empire", "army", "navy", "weapon", "sword", "shield", "armor", "battlefield",
    "zoo", "zebra", "quilt", "queen", "quarry", "xylophone"];
  var VERB = ["be", "have", "do", "say", "go", "get", "make", "know", "think", "take", "see",
    "come", "want", "use", "find", "give", "tell", "work", "call", "try", "ask", "need", "feel",
    "become", "leave", "put", "mean", "keep", "let", "begin", "seem", "help", "talk", "turn",
    "start", "show", "hear", "play", "run", "move", "like", "live", "believe", "bring",
    "happen", "write", "provide", "sit", "stand", "lose", "pay", "meet", "include", "continue",
    "set", "learn", "change", "lead", "understand", "watch", "follow", "stop", "create",
    "speak", "read", "allow", "add", "spend", "grow", "open", "walk", "win", "offer",
    "remember", "love", "consider", "appear", "buy", "wait", "serve", "die", "send", "expect",
    "build", "stay", "fall", "cut", "reach", "kill", "remain", "suggest", "raise", "pass",
    "sell", "require", "report", "decide", "pull", "break", "explain", "hope", "develop",
    "carry", "receive", "agree", "support", "hit", "produce", "eat", "cover", "catch", "draw",
    "choose", "cause", "point", "listen", "realize", "place", "close", "jump", "throw", "kick",
    "push", "lift", "drop", "hold", "grab", "touch", "hug", "kiss", "smile", "laugh", "cry",
    "scream", "whisper", "shout", "sing", "dance", "clap", "wave", "nod", "shake", "bend",
    "stretch", "crawl", "climb", "swim", "fly", "dive", "float", "sink", "roll", "slide",
    "spin", "twist", "bounce", "forget", "imagine", "dream", "wonder", "guess", "doubt", "plan",
    "judge", "study", "teach", "discover", "invent", "solve", "analyze", "answer", "describe",
    "discuss", "argue", "disagree", "promise", "admit", "deny", "complain", "apologize",
    "thank", "greet", "announce", "recommend", "warn", "design", "improve", "transform",
    "repair", "fix", "damage", "construct", "form", "shape", "mold", "craft", "paint",
    "compose", "travel", "arrive", "depart", "enter", "exit", "rise", "wander", "explore",
    "chase", "escape", "return", "approach", "retreat", "march", "sneak", "rush", "cook",
    "bake", "clean", "wash", "sweep", "mop", "dust", "iron", "fold", "sew", "knit", "garden",
    "water", "plant", "harvest", "feed", "milk", "shear", "brew", "boil", "fry", "roast",
    "grill", "chop", "mix", "manage", "organize", "schedule", "negotiate", "trade", "invest",
    "save", "borrow", "lend", "hire", "fire", "promote", "train", "supervise", "delegate",
    "review", "evaluate", "approve", "reject", "dislike", "worry", "trust", "respect", "admire",
    "envy", "forgive", "blame", "praise", "criticize", "comfort", "encourage", "discourage",
    "betray", "bloom", "wither", "migrate", "hunt", "hibernate", "nest", "graze", "bark",
    "meow", "roar", "howl", "chirp", "buzz", "swarm", "flock", "breed", "hatch", "molt",
    "compute", "calculate", "program", "code", "install", "download", "upload", "delete",
    "copy", "paste", "print", "scan", "connect", "disconnect", "finish", "pause", "resume",
    "repeat", "skip", "cancel", "vote", "elect", "govern", "rule", "conquer", "invade",
    "defend", "attack", "surrender", "sign", "seal", "publish", "edit", "translate",
    "interpret", "narrate", "illustrate", "sketch", "carve", "sculpt", "weld", "assemble",
    "disassemble", "unlock", "tie", "untie", "wrap", "unwrap", "pack", "unpack", "load",
    "unload", "store", "deliver", "ship", "transport", "import", "export", "exchange", "donate",
    "inherit", "distribute", "allocate", "ration", "zoom", "zip", "query", "quit"];
  var ADJ = ["big", "small", "large", "tiny", "huge", "enormous", "massive", "little", "giant",
    "miniature", "wide", "narrow", "thick", "thin", "tall", "short", "long", "deep", "shallow",
    "broad", "round", "square", "flat", "curved", "straight", "sharp", "pointed", "smooth",
    "rough", "bumpy", "red", "blue", "green", "yellow", "orange", "purple", "pink", "black",
    "white", "gray", "brown", "gold", "silver", "bright", "dark", "good", "bad", "great",
    "terrible", "excellent", "poor", "wonderful", "awful", "amazing", "horrible", "fantastic",
    "perfect", "imperfect", "superior", "inferior", "valuable", "worthless", "useful",
    "useless", "important", "unimportant", "essential", "necessary", "unnecessary",
    "significant", "trivial", "remarkable", "ordinary", "extraordinary", "special", "happy",
    "sad", "angry", "calm", "excited", "nervous", "anxious", "worried", "relaxed", "stressed",
    "cheerful", "gloomy", "joyful", "miserable", "proud", "ashamed", "confident", "shy",
    "brave", "afraid", "scared", "fearless", "hopeful", "hopeless", "content", "frustrated",
    "annoyed", "pleased", "satisfied", "disappointed", "kind", "cruel", "honest", "dishonest",
    "friendly", "unfriendly", "polite", "rude", "generous", "selfish", "patient", "impatient",
    "humble", "arrogant", "loyal", "disloyal", "wise", "foolish", "clever", "stupid", "curious",
    "careless", "careful", "thoughtful", "reckless", "beautiful", "ugly", "pretty", "handsome",
    "attractive", "plain", "elegant", "graceful", "clumsy", "strong", "weak", "fit", "healthy",
    "sick", "tired", "energetic", "exhausted", "fresh", "stale", "clean", "dirty", "tidy",
    "messy", "neat", "sloppy", "fast", "slow", "quick", "rapid", "swift", "sluggish", "speedy",
    "gradual", "sudden", "instant", "hasty", "leisurely", "brisk", "steady", "unsteady", "hot",
    "cold", "warm", "cool", "freezing", "boiling", "mild", "chilly", "humid", "dry", "soft",
    "hard", "silky", "fuzzy", "sticky", "slippery", "crisp", "tender", "easy", "difficult",
    "simple", "complex", "complicated", "tricky", "straightforward", "challenging",
    "effortless", "new", "old", "young", "ancient", "modern", "recent", "current", "past",
    "future", "early", "late", "punctual", "timely", "outdated", "contemporary", "many", "few",
    "several", "numerous", "countless", "abundant", "scarce", "plentiful", "limited",
    "unlimited", "full", "empty", "complete", "incomplete", "partial", "sweet", "sour",
    "bitter", "salty", "spicy", "bland", "delicious", "tasty", "disgusting", "savory", "loud",
    "quiet", "silent", "noisy", "harsh", "melodic", "deafening", "faint", "booming", "sunny",
    "cloudy", "rainy", "snowy", "windy", "stormy", "foggy", "clear", "tropical", "arctic",
    "dim", "shiny", "dull", "glowing", "sparkling", "radiant", "faded", "strange", "normal",
    "weird", "unusual", "common", "rare", "familiar", "unfamiliar", "obvious", "hidden",
    "visible", "invisible", "public", "private", "open", "closed", "free", "expensive", "cheap",
    "affordable", "safe", "dangerous", "risky", "secure", "fragile", "sturdy", "flexible",
    "rigid", "solid", "liquid", "classic", "traditional", "vintage", "futuristic", "rustic",
    "casual", "formal", "luxurious", "fancy", "ornate", "minimal", "elaborate", "basic",
    "sophisticated", "refined", "crude", "polished", "unrefined", "stylish", "intense",
    "extreme", "moderate", "severe", "gentle", "powerful", "forceful", "vivid", "subtle",
    "dramatic", "subdued", "striking", "understated", "overwhelming", "mellow", "fierce",
    "tame", "transparent", "opaque", "hollow", "dense", "sparse", "heavy", "sheer", "pure",
    "mixed", "uniform", "varied", "consistent", "inconsistent", "stable", "unstable",
    "balanced", "unbalanced", "symmetrical", "asymmetrical", "regular", "lonely", "popular",
    "famous", "unknown", "wealthy", "rich", "broke", "busy", "idle", "active", "passive",
    "alert", "sleepy", "awake", "drowsy", "focused", "distracted", "motivated", "lazy",
    "ambitious", "restless", "peaceful", "chaotic", "royal", "noble", "heroic", "cowardly",
    "tragic", "comic", "poetic", "musical", "artistic", "scientific", "mathematical",
    "historical", "political", "economic", "social", "cultural", "religious", "spiritual",
    "moral", "ethical", "legal", "illegal", "innocent", "guilty", "fair", "unfair", "equal",
    "unequal", "biased", "neutral", "objective", "subjective", "logical", "illogical",
    "rational", "irrational", "practical", "impractical", "theoretical", "technical",
    "mechanical", "electrical", "digital", "analog", "virtual", "physical", "mental", "zesty",
    "zealous", "quaint", "quirky"];

  var COUNT_MIN = 1, COUNT_MAX = 50, COUNT_DEF = 10;
  var LEN_MIN = 1, LEN_MAX = 20;

  /* ---- 순수 계산 (node 단위 검증 대상) ---- */

  // 카테고리 → 단어 풀. "any" 는 세 목록을 그대로 이어붙인다(가중치는 목록 크기를 그대로 반영).
  function buildPool(category) {
    if (category === "noun") return NOUN.slice();
    if (category === "verb") return VERB.slice();
    if (category === "adjective") return ADJ.slice();
    return NOUN.concat(VERB, ADJ);
  }

  // 정수 클램프: 빈값/NaN/범위밖 → 기본값 또는 경계값 + "조정됨" 플래그.
  function clampInt(raw, min, max, def) {
    var str = String(raw == null ? "" : raw).trim();
    if (str === "") return { value: def, clamped: false };
    var n = parseInt(str, 10);
    if (!isFinite(n) || isNaN(n)) return { value: def, clamped: true };
    if (n < min) return { value: min, clamped: true };
    if (n > max) return { value: max, clamped: true };
    return { value: n, clamped: false };
  }

  // 선택적 길이 경계: 빈 값은 제약 없음(null). 숫자면 [LEN_MIN, LEN_MAX] 로 클램프.
  function parseOptionalLen(raw) {
    var str = String(raw == null ? "" : raw).trim();
    if (str === "") return null;
    var n = parseInt(str, 10);
    if (!isFinite(n) || isNaN(n)) return null;
    if (n < LEN_MIN) return LEN_MIN;
    if (n > LEN_MAX) return LEN_MAX;
    return n;
  }

  // 시작 글자: 첫 알파벳 한 글자만 취해 소문자화. 알파벳이 아니면 필터 없음("").
  function parseLetter(raw) {
    var str = String(raw == null ? "" : raw).trim().toLowerCase();
    for (var i = 0; i < str.length; i++) {
      if (str.charAt(i) >= "a" && str.charAt(i) <= "z") return str.charAt(i);
    }
    return "";
  }

  // 풀 필터링: 시작 글자 + 길이 범위(둘 다 선택적, AND 결합).
  function filterPool(pool, letter, minLen, maxLen) {
    return pool.filter(function (w) {
      if (letter && w.charAt(0) !== letter) return false;
      if (minLen != null && w.length < minLen) return false;
      if (maxLen != null && w.length > maxLen) return false;
      return true;
    });
  }

  // 비복원 추출(부분 Fisher–Yates): randInt(n) 은 [0, n) 정수를 돌려주는 주입 함수.
  // count 가 풀보다 크면 풀 전체를 반환(호출부가 "부족" 여부를 판단).
  function sampleWithoutReplacement(pool, count, randInt) {
    var arr = pool.slice();
    var n = arr.length;
    var k = count < n ? count : n;
    for (var i = 0; i < k; i++) {
      var j = i + randInt(n - i);
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr.slice(0, k);
  }

  // 최소 길이 > 최대 길이 → 명시적 오류(자동 보정하지 않음, 사용자가 의도를 다시 확인하게 함).
  function rangeIsInvalid(minLen, maxLen) {
    return minLen != null && maxLen != null && minLen > maxLen;
  }

  // 전체 파이프라인: 옵션 → 필터링 → 추출. randInt 는 브라우저에서는 crypto 기반,
  // node 검증에서는 결정적 함수를 주입할 수 있다.
  function generateWords(opts, randInt) {
    var letter = parseLetter(opts.letter);
    var minLen = parseOptionalLen(opts.minLen);
    var maxLen = parseOptionalLen(opts.maxLen);
    var countClamp = clampInt(opts.count, COUNT_MIN, COUNT_MAX, COUNT_DEF);

    if (rangeIsInvalid(minLen, maxLen)) {
      return { error: "rangeInvalid", requestedCount: countClamp.value, countClamped: countClamp.clamped };
    }

    var pool = buildPool(opts.category);
    var filtered = filterPool(pool, letter, minLen, maxLen);
    if (filtered.length === 0) {
      return { error: "noMatch", requestedCount: countClamp.value, countClamped: countClamp.clamped, poolSize: 0 };
    }

    var picked = sampleWithoutReplacement(filtered, countClamp.value, randInt);
    return {
      error: null,
      words: picked,
      poolSize: filtered.length,
      requestedCount: countClamp.value,
      countClamped: countClamp.clamped,
      shortOfPool: picked.length < countClamp.value
    };
  }

  // node 검증용 노출 — 브라우저에는 module 이 없어 건너뛴다
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      buildPool: buildPool, clampInt: clampInt, parseOptionalLen: parseOptionalLen,
      parseLetter: parseLetter, filterPool: filterPool, sampleWithoutReplacement: sampleWithoutReplacement,
      rangeIsInvalid: rangeIsInvalid, generateWords: generateWords,
      NOUN: NOUN, VERB: VERB, ADJ: ADJ
    };
    return;
  }

  /* ---- crypto 기반 균등 난수 (거부 표본추출로 모듈로 편향 제거) ---- */
  function secureRandomInt(n) {
    if (!(n > 0)) return 0;
    if (window.crypto && window.crypto.getRandomValues) {
      var limit = Math.floor(4294967296 / n) * n; // 4294967296 = 2^32
      var buf = new Uint32Array(1);
      var x;
      do {
        window.crypto.getRandomValues(buf);
        x = buf[0];
      } while (x >= limit);
      return x % n;
    }
    return Math.floor(Math.random() * n); // 구형 브라우저 폴백
  }

  /* ---- i18n 헬퍼 ---- */
  var CFG = window.APP_CONFIG || {};
  var SKEY = (CFG.slug || "random-word-gen") + ":state";
  function t(key, fallback) {
    var v = (window.I18N && window.I18N.t) ? window.I18N.t(key) : null;
    return v == null ? (fallback == null ? key : fallback) : v;
  }
  function uiLang() {
    return (window.I18N && window.I18N.lang && window.I18N.lang()) ||
      document.documentElement.getAttribute("lang") || "en";
  }
  function fmt(n) {
    try { return Number(n).toLocaleString(uiLang()); }
    catch (e) { return String(n); }
  }

  /* ---- DOM ---- */
  function $(id) { return document.getElementById(id); }
  var categoryEl = $("rwg-category"), letterEl = $("rwg-letter");
  var minEl = $("rwg-min"), maxEl = $("rwg-max");
  var countEl = $("rwg-count"), countHintEl = $("rwg-count-hint");
  var genBtn = $("rwg-generate"), copyBtn = $("rwg-copy");
  var errorEl = $("rwg-error"), metaEl = $("rwg-meta"), wordsEl = $("rwg-words");
  var copyHintEl = $("rwg-copy-hint");
  if (!categoryEl || !countEl || !genBtn || !wordsEl) return;

  var lastWords = [];

  function currentOpts() {
    return {
      category: categoryEl.value,
      letter: letterEl.value,
      minLen: minEl.value,
      maxLen: maxEl.value,
      count: countEl.value
    };
  }

  function saveState(opts) {
    try { localStorage.setItem(SKEY, JSON.stringify(opts)); } catch (e) { /* private mode — noop */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(SKEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function renderChips(words) {
    wordsEl.textContent = "";
    for (var i = 0; i < words.length; i++) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "rwg-chip";
      chip.textContent = words[i];
      chip.setAttribute("data-word", words[i]);
      chip.title = t("tool.chipHint", "Tap to copy");
      chip.addEventListener("click", function () { copyOne(this); });
      wordsEl.appendChild(chip);
    }
  }

  function render() {
    var opts = currentOpts();
    var result = generateWords(opts, secureRandomInt);

    if (countHintEl) {
      countHintEl.hidden = !result.countClamped;
      if (result.countClamped) {
        countHintEl.textContent = t("tool.count.hint", "Adjusted to the allowed range ({min}–{max}).")
          .replace("{min}", fmt(COUNT_MIN)).replace("{max}", fmt(COUNT_MAX));
      }
    }

    if (result.error) {
      wordsEl.hidden = true;
      metaEl.hidden = true;
      copyBtn.hidden = true;
      copyHintEl.hidden = true;
      lastWords = [];
      errorEl.hidden = false;
      errorEl.textContent = t("tool.err." + result.error,
        result.error === "rangeInvalid"
          ? "Minimum length can't be greater than maximum length."
          : "No words match these filters — try loosening them.");
      return;
    }

    errorEl.hidden = true;
    lastWords = result.words;
    renderChips(result.words);
    wordsEl.hidden = false;
    copyBtn.hidden = false;
    copyBtn.disabled = false;
    copyHintEl.hidden = false;

    metaEl.hidden = false;
    var metaKey = result.shortOfPool ? "tool.meta.short" : "tool.meta.ok";
    metaEl.textContent = t(metaKey, "{n} of {pool} matching words")
      .replace("{n}", fmt(result.words.length)).replace("{pool}", fmt(result.poolSize));

    saveState(opts);
  }

  /* ---- 복사: 칩 1개 / 전체 ---- */
  var chipCopyTimer = null;
  function legacyCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) { /* 복사 미지원 — 칩 값은 그대로 화면에 남는다 */ }
  }
  function copyOne(chip) {
    var word = chip.getAttribute("data-word");
    if (!word) return;
    var done = function () {
      var original = word;
      chip.textContent = t("tool.copied", "Copied");
      if (chipCopyTimer) clearTimeout(chipCopyTimer);
      chipCopyTimer = setTimeout(function () { chip.textContent = original; }, 900);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(word).then(done, function () { legacyCopy(word, done); });
    } else {
      legacyCopy(word, done);
    }
  }
  var copyAllResetTimer = null;
  function flashCopyAll(ok) {
    copyBtn.textContent = t(ok ? "tool.copyAll.done" : "tool.copyAll.error",
      ok ? "Copied!" : "Couldn't copy");
    if (copyAllResetTimer) clearTimeout(copyAllResetTimer);
    copyAllResetTimer = setTimeout(function () {
      copyBtn.textContent = t("tool.copyAll", "Copy all");
    }, 1400);
  }
  function copyAll() {
    if (!lastWords.length) return;
    var text = lastWords.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flashCopyAll(true); }, function () { legacyCopy(text, function () { flashCopyAll(true); }); });
    } else {
      legacyCopy(text, function () { flashCopyAll(true); });
    }
  }

  /* ---- 이벤트 ---- */
  categoryEl.addEventListener("change", render);
  letterEl.addEventListener("input", function () {
    // 한 글자만 허용 — 두 번째 글자부터는 잘라낸다(모바일 키보드에서도 즉시 피드백)
    if (letterEl.value.length > 1) letterEl.value = letterEl.value.slice(0, 1);
    render();
  });
  minEl.addEventListener("input", render);
  maxEl.addEventListener("input", render);
  countEl.addEventListener("input", render);
  countEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); render(); } });
  genBtn.addEventListener("click", render);
  copyBtn.addEventListener("click", copyAll);

  // 언어 전환 시 동적 문구(메타/힌트/오류/칩 복사 라벨) 재적용
  document.addEventListener("i18n:change", function () {
    if (!errorEl.hidden) render();
    else if (!metaEl.hidden && lastWords.length) {
      var opts = currentOpts();
      var pool = filterPool(buildPool(opts.category), parseLetter(opts.letter),
        parseOptionalLen(opts.minLen), parseOptionalLen(opts.maxLen));
      var shortOfPool = lastWords.length < clampInt(opts.count, COUNT_MIN, COUNT_MAX, COUNT_DEF).value;
      var metaKey = shortOfPool ? "tool.meta.short" : "tool.meta.ok";
      metaEl.textContent = t(metaKey, "{n} of {pool} matching words")
        .replace("{n}", fmt(lastWords.length)).replace("{pool}", fmt(pool.length));
      copyBtn.textContent = t("tool.copyAll", "Copy all");
      copyHintEl.textContent = t("tool.copyHint", "Tap a word to copy it, or copy the whole list");
    }
  });

  /* ---- 초기화: 저장된 설정 복원 후 자동 생성 ---- */
  (function init() {
    var stored = loadState();
    if (stored) {
      if (stored.category) categoryEl.value = stored.category;
      if (stored.letter) letterEl.value = stored.letter;
      if (stored.minLen) minEl.value = stored.minLen;
      if (stored.maxLen) maxEl.value = stored.maxLen;
      if (stored.count) countEl.value = stored.count;
    }
    render();
  })();
  // TOOLJS:END
})();
