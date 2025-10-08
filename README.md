# Elliesbang Image Editor

## 소개
Elliesbang Image Editor는 HTML5 Canvas 기반의 멀티 이미지 편집 스튜디오입니다. GitHub Pages에서 동작할 수 있도록 완전한 정적 자산으로 구성되었으며, 루트 경로(`/index.html`)에서 항상 이미지 편집 UI를 우선적으로 제공합니다. 로그인 및 관리자 대시보드는 별도의 문서(`/login.html`, `/dashboard.html`)로 분리되어 있어 자동 리디렉션 없이 사용자가 직접 이동할 수 있습니다.

## 주요 기능
- **멀티 이미지 편집 파이프라인**: 최대 50장을 업로드해 배경 제거, 타이트 크롭, 노이즈 제거, 가로폭 리사이즈, PNG→SVG 변환(ImageTracer.js 사용)을 한 번에 적용할 수 있습니다.
- **ZIP 내보내기**: 선택한 이미지 또는 전체 결과를 JSZip 호환 빌더로 묶어 다운로드합니다. SVG 변환이 활성화된 경우 벡터 파일도 함께 포함됩니다.
- **Freemium 크레딧 UX**: 로그인 시 30크레딧이 충전되며, 작업 수행 시 잔여 크레딧 배지가 `success → warning → danger` 단계로 변합니다. GitHub Pages에서는 로컬 스토리지에만 저장됩니다.
- **이메일 OTP 로그인(데모)**: `/login.html`에서 이메일 주소와 6자리 코드를 입력하는 흐름을 시뮬레이션합니다. 실 서비스 연동 전까지는 setTimeout 기반으로 데모 토스트를 출력합니다.
- **관리자 대시보드(데모)**: `/dashboard.html`에서 참가자 진행률 표, CSV 가져오기/내보내기, 완주 판별 버튼을 제공합니다. API가 없으면 자동으로 데모 데이터가 로드됩니다.
- **법적 문서**: `/privacy.html`, `/terms.html`, `/cookies.html` 페이지에서 개인정보·이용약관·쿠키 정책을 확인할 수 있습니다.
- **보안·법적 안내**: 헤더에 미치나 커뮤니티 링크, 푸터에 법적 문서 링크, 상태 배너에서 관리자 세션 안내 CTA를 제공합니다.

## 문서 구조
```
/
├── index.html        # 이미지 편집 UI (루트 기본)
├── login.html        # 이메일 로그인 & OTP 데모
├── dashboard.html    # 관리자 대시보드 데모
├── privacy.html      # 개인정보 처리방침
├── terms.html        # 이용약관
├── cookies.html      # 쿠키 정책
└── static/
    ├── styles.css    # 공통 스타일
    ├── app.js        # 공통 유틸, 토스트, 세션/크레딧 관리
    ├── editor.js     # 업로드·캔버스 파이프라인·ZIP 생성
    ├── auth.js       # 로그인 페이지 전용 스크립트
    ├── dashboard.js  # 관리자 페이지 전용 스크립트
    └── vendor/
        ├── imagetracer.min.js # PNG → SVG 변환용 경량 버전
        └── jszip.min.js       # JSZip 호환 경량 빌더(무압축 스토어)
```

## GitHub Pages에서 사용하기
1. 저장소를 GitHub에 푸시하고, Pages 소스를 `main` 브랜치 루트로 지정합니다.
2. `https://<username>.github.io/<repo>/index.html` 로 접속하면 바로 편집 UI가 표시됩니다.
3. 로그인/대시보드/법적 문서는 각각 `login.html`, `dashboard.html`, `privacy.html` 등으로 직접 이동해야 합니다.
4. API 서버가 없으면 모든 fetch 호출은 자동으로 try/catch 처리되어 “데모 모드” 토스트만 띄우고 UI는 정상 동작합니다.

## Netlify + Hono 배포 시 API 연동 방법
- **OTP 메일 발송**: `/login.html`의 `static/auth.js`에서 `simulateRequest` / `simulateVerify` 부분을 실제 API 호출(fetch)로 교체하고, 성공/실패 시 토스트 처리 로직만 유지합니다.
- **관리자 세션**: `static/app.js`의 `safeFetch`를 사용해 `/api/auth/admin/*` 엔드포인트와 통신하세요. 세션 쿠키는 `credentials: 'include'`로 자동 첨부됩니다.
- **챌린지 데이터**: `static/dashboard.js`의 `loadParticipants`와 `runCompletionCheck`에서 `ElliesApp.safeFetch` 호출부를 실제 API 경로로 교체하면 됩니다. 실패 시에는 기존 데모 데이터가 유지되도록 구성되어 있습니다.
- **환경 변수**: Hono 서버에서 `MICHINA_COMMUNITY_URL`, `ADMIN_SESSION_VERSION` 등 필요한 값을 JSON으로 주입하거나, 빌드시 인라인 스크립트를 통해 `window.MICHINA_COMMUNITY_URL`을 정의하면 헤더 커뮤니티 버튼이 외부 링크로 열립니다.

## 로컬에서 확인하기
빌드 과정이 필요 없으므로 정적 파일만으로 동작합니다.
```bash
# 1. 저장소 클론
git clone <repo>
cd <repo>

# 2. 로컬 HTTP 서버 실행 (예: Python)
python3 -m http.server 3000

# 3. 브라우저에서 열기
open http://localhost:3000/index.html
```

## 주의 사항
- **자동 리디렉션 금지**: 세션이 있어도 `/index.html`은 항상 편집 UI를 먼저 렌더링하며, 상태 배너에서만 대시보드 이동 버튼을 제공합니다.
- **로컬 스토리지 초기화**: 테스트 중 세션/크레딧을 초기화하려면 브라우저 개발자 도구에서 `localStorage.clear()`를 실행하세요.
- **JSZip 빌더**: `static/vendor/jszip.min.js`는 저장-only 형식의 경량 구현입니다. 필요 시 공식 JSZip으로 교체해도 API 호환이 유지되도록 작성했습니다.

## 라이선스
프로젝트는 저장소의 라이선스 정책을 따릅니다. (별도 라이선스가 지정되지 않았다면 사내 용도로만 사용해 주세요.)
