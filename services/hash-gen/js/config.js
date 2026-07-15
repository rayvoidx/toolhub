/* ============================================================
   서비스 설정 — 붕어빵마다 이 파일과 CSS :root 토큰만 달라진다.
   스탬핑 시 factory/stamp.py 가 플레이스홀더 토큰을 치환한다.
   ============================================================ */
window.APP_CONFIG = {
  slug: "hash-gen",
  name: "Hash Generator",
  version: "0.1.0",

  // 수익화: 런칭 게이트 통과 + 허브 승격 전까지 반드시 false
  adsense: {
    enabled: false,
    client: "ca-pub-6324953789479730",   // ca-pub-XXXX
    slot: ""                        // 광고 단위 ID
  },

  // 분석: GA4 측정 ID를 넣으면 활성화, 빈 문자열이면 완전 비활성
  analytics: {
    ga4: ""
  },

  // 허브(다른 도구 모음) 링크
  hub: {
    url: "https://tool-hub.me/",
    brand: "Toolhub"
  }
};
