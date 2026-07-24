# Toolhub 콘텐츠 심화 계약 (CONTENT-GUIDE)

AdSense가 "가치 없는 콘텐츠(thin/low-value) + 복제 콘텐츠"로 사이트를 거부했다.
원인은 계산기 위주 + 대량 유사 템플릿 + 페이지별 고유 읽을거리 부족.
**목표: 각 도구 페이지에 그 도구에서만 얻을 수 있는 고유하고 실질적인 설명 콘텐츠를 추가**해
"게시자 콘텐츠"의 밀도와 고유성을 끌어올린다. 도구 기능/로직은 건드리지 않는다.

## 핵심 원칙 (반드시)

1. **영어 단일 언어**로 작성한다. 심화 섹션에는 `data-i18n` 훅을 달지 않는다.
   (자동 다국어 복제가 AdSense 복제 시그널의 일부였다 — 크롤러가 보는 기본 언어 영어로 깊이를 준다.)
2. **도구별로 완전히 고유한 내용.** 다른 도구와 문장·구조를 재사용하지 마라. 그 도구의
   실제 도메인 지식(공식, 단위, 관례, 실전 맥락)을 담아라. 템플릿 반복 = 이 작업의 실패.
3. 기존 파일의 다른 부분(head, GTM, JSON-LD, TOOL 영역, FAQ, 스크립트)은 **수정 금지**.
   심화 섹션 하나만 삽입한다.
4. 마케팅 과장·키워드 스터핑 금지. 사람이 읽어 실제로 유용한 설명이어야 한다.
5. 작업 후 게이트 재통과 필수(구조 안 깨졌는지):
   `node "<스크래치패드>/factory/gate-check.js" <slug>` → PASS.

## 작업 A: 대표 도구 콘텐츠 심화

대상: `services/<slug>/index.html` (기존 배포 도구).

### 삽입 위치
`<!-- TOOL:END -->` 주석 바로 뒤, `<section class="ad-slot"` 앞에 아래 섹션을 삽입:

```html
  <!-- CONTENT:START — 영어 심화 설명(고유). data-i18n 없음. -->
  <section class="guide-content">
    <style>
      .guide-content{max-width:none;margin:32px 0 8px;line-height:1.7}
      .guide-content h2{font-size:22px;font-weight:700;margin:28px 0 10px;letter-spacing:-.01em}
      .guide-content h3{font-size:17px;font-weight:650;margin:20px 0 6px}
      .guide-content p{margin:0 0 12px;color:var(--ink)}
      .guide-content ul,.guide-content ol{margin:0 0 12px;padding-left:22px}
      .guide-content li{margin:4px 0}
      .guide-content .example{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0;background:color-mix(in srgb,var(--accent) 5%,var(--surface))}
      .guide-content table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px}
      .guide-content th,.guide-content td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}
      .guide-content th{color:var(--muted);font-weight:650}
    </style>
    ... 본문 ...
  </section>
  <!-- CONTENT:END -->
```

### 본문 구성 (영어, 약 500~800 단어, 도구별 고유)
아래 흐름을 그 도구에 맞게 실제 지식으로 채운다(소제목 문구는 도구에 맞게 자연스럽게):

1. **개요 / 왜 중요한가** (1~2문단): 이 도구가 푸는 실제 문제, 언제 쓰나.
2. **사용법** (단계별 ol 또는 설명): 입력 항목의 의미와 올바른 입력법.
3. **공식 / 원리** (`.example` 박스 또는 본문): 계산이 어떻게 이뤄지는지, 수식을 말로.
4. **워크드 예시 2~3개** (`.example` 박스, 구체적 숫자로 끝까지 계산): 서로 다른 시나리오.
5. **표 1개 이상**(선택이지만 권장): 참고값·구간·비교표 등 스캔 가능한 정보.
6. **흔한 실수 / 팁 / 오해**: 사용자가 자주 틀리는 지점, 실전 조언.
7. **관련 개념 / 한계**: 이 도구가 다루지 않는 것, 주의(건강·금융은 면책 톤 유지).

도구 특성에 맞게 항목을 가감하되, **구체적 숫자 예시와 표는 반드시 하나 이상** 넣는다.
이것이 "고유한 실질 콘텐츠"의 핵심이다.

## 작업 B: About 페이지 (신뢰 시그널)

`about.html`을 리포 루트에 신설. `privacy.html`을 뼈대로 복사(head의 GTM/Consent/스타일
로더 그대로 유지)하되 본문을 About 내용으로 교체. 영어. 약 400~600단어:
- Toolhub가 무엇인지, 어떤 문제를 푸는지
- 도구를 어떻게 만들고 검증하는지(브라우저 내 처리, 개인정보 미수집, 무료)
- 정확성·프라이버시에 대한 태도(계산은 로컬, 데이터 미전송)
- 피드백/문의 경로 (footer의 github/coffee 링크 활용, 필요시 언급)
- 광고에 대한 투명성 한 줄(무료 유지를 위해 광고 게재 예정 — 정직하게)
footer/header는 privacy.html과 동일 구조. `<link rel="canonical" href="https://tool-hub.me/about.html">`.
title/description/og 적절히. 푸터의 privacy 링크 옆에 About 링크가 이미 있으면 유지.

## 반환 형식
`<slug> CONTENT DONE — words:<추가단어수>, gate:PASS` 또는
`about.html DONE — words:<N>` 한 줄만. 파일 내용 반환 금지.
