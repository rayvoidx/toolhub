/* ============================================================
   서비스 설정 — 붕어빵마다 이 파일과 CSS :root 토큰만 달라진다.
   스탬핑 시 factory/stamp.py 가 플레이스홀더 토큰을 치환한다.
   ============================================================ */
window.APP_CONFIG = {
  slug: "csv-dedupe",
  name: "CSV Duplicate Remover",
  version: "0.1.0",

  // 수익화: 런칭 게이트 통과 + 허브 승격 전까지 반드시 false
  adsense: {
    enabled: false,
    client: "ca-pub-0000000000000000",   // ca-pub-XXXX
    slot: ""                        // 광고 단위 ID
  },

  // 분석: Cloudflare Web Analytics (쿠키리스·페이지뷰만 — privacy.html §3 과 일치해야 한다).
  // 토큰이 있으면 활성화, 빈 문자열이면 완전 비활성(요청 0건).
  // tool-hub.me 사이트 토큰 하나가 그 아래 전 도구 경로를 커버하므로 서비스마다 다르지 않다.
  // GA4 를 쓰지 않는 이유: 쿠키를 사용해 privacy.html 의 쿠키리스 약속과 어긋난다.
  analytics: {
    cfBeaconToken: ""
  },

  // 허브(다른 도구 모음) 링크
  hub: {
    url: "https://tool-hub.me/",
    brand: "Toolhub"
  }
};
