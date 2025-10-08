# Elliesbang Image Editor (Cloudflare Pages Edition)

Elliesbang Image Editor는 Cloudflare Pages + Pages Functions 환경에 맞춰 구성된 풀스택 이미지 편집 워크플로입니다. 이메일 인증, 관리자 인증, 이미지 편집, PNG→SVG 변환, SEO 키워드 분석까지 모두 Cloudflare Functions로 연동되며, GitHub 저장소 연결만으로 자동 배포가 가능합니다.

## 시스템 구성
- **클라이언트**: `index.html`과 `static/` 내부의 순수 HTML/CSS/JavaScript 모듈
- **서버**: `functions/` 디렉터리의 Cloudflare Pages Functions (`api/auth/*`, `api/admin/*`, `api/images/*`)
- **배포**: Cloudflare Pages. 빌드 출력은 `dist/`, 빌드 명령은 `npm run build` 입니다.

## 필수 환경 변수
Cloudflare Pages 프로젝트의 **Settings → Environment Variables**에서 아래 값을 설정하세요.

| 변수 | 설명 |
| --- | --- |
| `ADMIN_EMAIL` | 관리자 로그인 이메일 |
| `ADMIN_PASSWORD` | 관리자 로그인 비밀번호 |
| `SESSION_SECRET` | 사용자/관리자 JWT 서명용 시크릿 키 |
| `OPENAI_API_KEY` | OpenAI Responses API 키 |

> ℹ️ Cloudflare Pages는 빌드시 `dev`, `preview`, `production` 단계별로 별도 변수를 설정할 수 있습니다. 민감한 값은 각 환경에 맞춰 안전하게 입력하세요.

## 주요 기능
- **이메일 로그인**: `/api/auth/send-code`가 6자리 코드를 즉시 생성해 반환하고, `/api/auth/verify-code`가 중복 로그인 차단과 JWT 발급을 처리합니다. 코드는 실제 메일로 전송되지 않으며 화면에서 복사할 수 있습니다.
- **관리자 인증**: `/api/admin/login`이 환경 변수와 비교하여 토큰을 발급하고, `/api/admin/validate`가 대시보드 접근 시 토큰을 검증합니다.
- **이미지 편집**: 업로드 후 배경제거, 자동/수동 크롭, 노이즈 제거, 리사이즈 적용, PNG 다운로드를 모두 클라이언트 Canvas에서 실행합니다.
- **PNG→SVG 변환**: `/api/images/convert-svg`가 OpenAI Responses API를 호출해 viewBox 포함 SVG와 팔레트를 생성합니다. 150KB를 초과하면 오류를 반환합니다.
- **SEO 키워드 분석**: `/api/images/analyze`가 편집 완료된 이미지를 기반으로 25개의 키워드와 추천 제목을 생성하며, 결과는 버튼 한 번으로 복사할 수 있습니다.
- **엘리의방 테마 UI**: #ffd331, #f5eee9, #404040 컬러 스킴과 둥근 모서리, 그림자, 토스트 알림을 일관되게 적용했습니다.

## 로컬 개발
```bash
npm install
npm run dev
```

Vite 개발 서버로 정적 에셋을 확인할 수 있으며, Cloudflare Pages Functions는 `wrangler pages dev` 명령으로 로컬에서 함께 테스트할 수 있습니다.

## 프로덕션 빌드
```bash
npm run build
```

생성된 `dist/` 폴더를 Cloudflare Pages가 자동으로 배포합니다. GitHub 저장소를 연결한 경우, 기본 빌드 설정은 다음과 같습니다.

- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Node version**: `18`
- **Root directory**: `/`

## 배포 절차 (Cloudflare Pages)
1. Cloudflare Dashboard에서 **Pages → Create a project**를 클릭합니다.
2. “Deploy from GitHub”를 선택하고 해당 저장소를 연결합니다.
3. 빌드 설정에 위의 command/output/node 값을 입력합니다.
4. Settings → Environment Variables에 필수 변수를 등록합니다.
5. 배포 후 Functions 로그는 Pages 프로젝트의 **Functions** 탭 혹은 Cloudflare Workers Logs에서 확인할 수 있습니다.

## 운영 팁
1. 이메일 코드는 5분간 유효하며, 성공적으로 인증하면 동일 이메일의 재로그인을 차단합니다.
2. 관리자 대시보드는 인증 후 새 탭으로 열리며, 토큰이 유효하지 않으면 자동으로 메인 페이지로 리다이렉션됩니다.
3. SVG 변환 색상 수는 1~6 사이에서 조정 가능하며, 미리보기에서 색상 피커로 즉시 팔레트를 수정할 수 있습니다.
4. 키워드 분석 결과는 “복사하기” 버튼으로 한 번에 공유용 텍스트를 생성할 수 있습니다.

## 라이선스
본 프로젝트는 Elliesbang Image Editor 팀을 위한 커스텀 Cloudflare Pages 배포 예시입니다.
