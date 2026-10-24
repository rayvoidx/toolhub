# ToolHub Pocket 0.1

한국어 생활 계산 워크스페이스. 기존 325개 도구 카탈로그는 유지하고 단가·할인·모임 정산·여행 예산 4종에 프로젝트 기록과 체크리스트를 추가했습니다. 웹 프리뷰: https://tool-hub.me/workspace/

## 실제 구현

- 같은 원본 UI/순수 계산 엔진을 Vite로 `/workspace/`와 네이티브 `www/`에 각각 빌드합니다. 원격 website iframe 또는 `server.url`을 쓰지 않습니다.
- 단가 비교는 배송비·쿠폰·kg/g·L/mL·묶음 수를 반영합니다. 무게와 부피를 혼합하면 거부합니다.
- 연속 할인은 순서대로 곱하고 정액 쿠폰 후 원 단위 반올림합니다. 모임 정산은 나머지 1원을 분배하여 총액을 보존합니다.
- 여행 총 주행거리·연비·유가·통행료·주차비를 입력해 연료비와 분담금을 계산합니다.
- 프로젝트 30개, 프로젝트당 기록 30개·할 일 30개. 계산 조건 재열기/수정, 이름/메모, 복제, 즐겨찾기, 최근 기록한 도구.
- 백업 JSON 검증/병합, 삭제 확인, 저장 실패 안내, 손상된 저장소 덮어쓰기 방지/원본 복구 내보내기.
- Android/iOS는 Preferences(UserDefaults / SharedPreferences), 웹은 localStorage. 백업에는 메모와 계산 조건이 포함됩니다. 기기 변경 시 수동 백업이 필요합니다.
- 네이티브 Share 및 Filesystem Cache로 요약/백업 내보내기. 카메라·위치·연락처 권한 없음. 광고/분석 SDK 없음.
- 웹 서비스워커는 `/workspace/`만 담당하고 `pocket-` 캐시만 정리합니다. 최초 온라인 설치 완료 후 오프라인 사용. 네이티브는 모든 코드/아이콘을 번들해 첫 실행부터 오프라인 계산 가능.

## 기술 스택과 재현

Node 22, JavaScript ES modules, Vite 7, Capacitor 8, Android Gradle / Java 21, iOS Swift Package Manager / Xcode 26. lockfile을 사용하세요.

```sh
cd mobile/toolhub
npm ci
npm test
npm run web       # ../../workspace/ 산출물 (Cloudflare Static Assets)
npm run sync      # www 빌드 + Android/iOS에 cap sync
npm run dev       # http://127.0.0.1:4180
```

```sh
# Android SDK 36 / Java 21 환경
bash android/gradlew -p android assembleDebug --no-daemon
# macOS / Xcode 26 환경: 시뮬레이터용, 서명 불필요
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug -derivedDataPath build-ios CODE_SIGNING_ALLOWED=NO build
```

저장소 루트 `.github/workflows/native-preview.yml`은 수동 실행하며 Android debug APK와 iOS simulator App을 14일간 artifact로 보관합니다. 소스·node_modules·native 산출물·개발 문서는 `.assetsignore`로 공개 웹에서 제외합니다. Capacitor CLI의 xcode 의존성에서만 사용하는 uuid를 11.1.1로 고정하여 알려진 이전 버전 문제를 피합니다.

## 검증 및 출시 범위

`tests/core.test.mjs`: 계산 기준, 600가지 정산 합계 보존 사례, 잘못된 단위/소수 인원/쿠폰, 저장 후 수정, 백업 roundtrip, 중복 ID·과대 파일·한도 검증. `tests/package.test.mjs`: 325개 도구 보존, 로컬 native bundle 설정, 권한, 추적기 배제, iOS privacy resource 포함.

앱스토어 출시본은 아닙니다. 실제 Android/iPhone에서 Preferences 재실행 복원, 파일 선택/공유 취소, 비행기 모드 첫 실행, 키보드/화면 크기/스크린리더 확인이 필요합니다. iOS artifact는 **시뮬레이터용**으로 iPhone에 직접 설치할 수 없습니다. 배포 서명, 스토어 등록, 스크린샷, 최종 개인정보 설문, 릴리스 아이콘은 별도 출시 단계입니다. 앱 심사/AdSense 승인을 보장하지 않습니다. 기본 프리뷰 아이콘은 Capacitor 생성 템플릿, 웹 아이콘은 기존 ToolHub 자산을 사용합니다.

현재 금액은 KRW 정수 원만 지원합니다. 외환·세금·실시간 유가·전기차 비용은 없습니다. 저장 데이터는 암호화된 비밀금고가 아니며 운영체제 백업 설정을 따릅니다. 민감한 금융정보 저장용으로 설계하지 않았습니다.

## 공식 참고

- [Capacitor 환경 요구사항](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Preferences와 iOS CA92.1 사유](https://capacitorjs.com/docs/apis/preferences)
- [Filesystem과 C617.1 사유](https://capacitorjs.com/docs/apis/filesystem)
- [Share 파일 공유와 Android Cache 경로](https://capacitorjs.com/docs/apis/share)

프로젝트 기술/진행 HTML 보고서: `../../docs/toolhub-pocket-report.html`.
