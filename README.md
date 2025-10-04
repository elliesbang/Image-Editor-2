# Easy Image Editor (Cloudflare Pages + Hono)

## 프로젝트 개요
- **이름**: Easy Image Editor
- **목표**: Cloudflare Pages + Hono 조합으로 동작하는 경량 이미지 편집 스튜디오에 **관리자용 무제한 테스트 흐름**과 **미치나 플랜 3주 챌린지 관리 시스템**을 결합
- **핵심 특징**: HTML5 Canvas 기반 이미지 파이프라인, Freemium 크레딧 게이트, 관리자 전용 인증/세션 유지, 참가자 진행률·수료증 UI, OpenAI 연동 키워드 분석

## 현재 구현 기능
- **이미지 편집 파이프라인**: 최대 50장 동시 업로드, 배경 제거·피사체 타이트 크롭·노이즈 제거·가로폭 리사이즈, PNG → SVG 변환(JSZip + ImageTracer.js), 선택/전체 ZIP 다운로드
- **Freemium 크레딧 모델**: 로그인 시 30 크레딧 자동 충전, 작업별 차감, 잔여량에 따라 헤더/게이트 상태(`success → warning → danger`) 자동 전환
- **Google 계정 로그인**: Google Identity Services 코드 플로우로 계정 선택 팝업을 제공하고, 발급된 OAuth 코드를 Cloudflare Worker에서 Google 토큰 엔드포인트로 교환하여 ID 토큰을 검증한 뒤 프론트 세션 및 챌린지 프로필을 동기화
- **관리자 인증 & 무제한 테스트**
  - SHA-256 해시 기반 자격 검증 + Hono JWT + HttpOnly 세션 쿠키
  - 관리자로 로그인하면 크레딧 체크가 해제돼 모든 기능을 비용 없이 테스트 가능
  - `/api/auth/admin/login/logout/session` REST API, 세션 만료 처리 포함
- **미치나 플랜 3주 챌린지 관리**
  - 관리자: CSV/수동 입력으로 참가자 명단 업로드, D+15 영업일 자동 만료일, 진행률 대시보드, 완주판별 실행, 완주자 CSV 추출
  - 참가자: 제출 진행률 바, Day별 제출 카드, URL/이미지 제출(이미지 → base64 저장), 자동 완주 판정, 수료증 발급
  - 키-값 저장소(KV) 사용 시 전역 영속화, 로컬 개발 시 in-memory fallback
- **수료증 발급 (배경 #fef568)**
  - `/api/challenge/certificate`에서 메타데이터 수집 후 html2canvas로 PNG 다운로드 생성
  - 인증된 참가자는 #fef568 배경과 어두운 텍스트(`--certificate-text`) 기반 카드 미리보기 제공
- **보안 헤더 & 보호**: 전역 CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy 적용
- **법적 문서 & 쿠키 배너**: 개인정보 처리방침(`/privacy`), 이용약관(`/terms`), 쿠키 정책(`/cookies`) 및 선택형 쿠키 배너
- **역할 기반 내비게이션**: 헤더 상단 탭을 통해 홈/커뮤니티/관리자 뷰를 전환하며, 미치나 플랜 또는 관리자 세션 여부에 따라 버튼 노출이 자동 제어됩니다.

## 관리자 & 챌린지 운영 흐름
0. **Google 로그인**: 로그인 모달에서 “Google 계정으로 계속하기” 선택 → Google 계정 선택 팝업 → OAuth 코드가 발급되면 `/api/auth/google`이 Google 토큰 엔드포인트와 통신해 ID 토큰을 검증하고 프론트 세션을 초기화합니다.
1. **관리자 로그인**: `/api/auth/admin/login`으로 이메일·비밀번호 제출 → SHA-256 해시 비교 후 JWT 서명, HttpOnly 세션 쿠키 발급(8시간)
2. **명단 등록**: CSV 업로드(이메일, 이름, 종료일) 또는 textarea 입력 → KV/in-memory에 참가자 레코드 저장, 미치나 플랜 권한 부여
3. **대시보드 모니터링**: 진행률/미제출 현황 표, 완료 상태 필터, 새로고침·완주 판별 버튼 제공
4. **완주 판별**: `/api/admin/challenge/run-completion-check` 호출 시 제출 횟수 15회 이상 참가자를 `completed=true`로 업데이트
5. **CSV 추출**: `/api/admin/challenge/completions?format=csv` 응답을 통해 완주자 명단 다운로드
6. **세션 종료**: `/api/auth/admin/logout` 호출 또는 401 응답 시 프론트에서 세션 제거 및 관리자 모달 재요청

## 참가자 UI 가이드
0. **커뮤니티 뷰 이동**: 헤더 내비게이션에서 “커뮤니티” 탭을 선택하면 미치나 플랜 참가자용 페이지로 이동하며, 자격이 없으면 버튼이 표시되지 않습니다.
1. **프로필 확인**: 로그인 후 이메일이 챌린지 참가자라면 `/api/challenge/profile` 로드 → 진행률·남은 제출 수 표시
2. **일일 제출**: Day 선택 → URL 입력 또는 이미지 업로드(이미지 선택 시 URL보다 우선) → 제출 시 `/api/challenge/submit`
3. **진행률 추적**: 진행률 바(퍼센트), 남은 횟수, 각 Day 카드(`예정/제출 대기/완주/기록 없음`) 확인
4. **수료증**: 15회 제출 완료 시 자동 완주 처리, `/api/challenge/certificate` fetch 후 html2canvas로 PNG 저장(배경 #fef568)

## 보안 강화 요소
- 관리자 자격 증명은 SHA-256(소문자 hex)으로 비교, 인증 실패 시 지연 응답으로 타이밍 공격 완화
- JWT 페이로드 → `{ sub: email, role: 'admin', exp }`, HttpOnly + Secure + SameSite=Lax 쿠키, 로그아웃 시 즉시 삭제
- CSP `default-src 'self'`, script/style CDN 화이트리스트, 이미지 data/blob 허용, frame-ancestors 'none'
- Strict-Transport-Security(180일, preload), Referrer-Policy(`strict-origin-when-cross-origin`), Permissions-Policy(카메라/마이크/geolocation 차단)
- Cloudflare KV 사용 시 서버리스 저장소에만 접근, 로컬 개발은 in-memory Map fallback (프로덕션 진입 전 KV 바인딩 필수)

## URL & 엔드포인트 요약
| Method | Path | 설명 | 인증 |
| --- | --- | --- | --- |
| GET | `/` | 멀티 이미지 편집 UI + 챌린지 섹션 | - |
| GET | `/privacy`, `/terms`, `/cookies` | 법적 고지 페이지 | - |
| GET | `/static/*` | 정적 자산(app.js, style.css) | - |
| GET | `/api/health` | 상태 점검 JSON `{ "status": "ok" }` | - |
| POST | `/api/analyze` | OpenAI GPT-4o-mini 기반 키워드/제목 분석 (data URL 입력) | Server-side API key |
| POST | `/api/auth/google` | Google OAuth 코드 ↔ ID 토큰 교환 및 프로필 반환 | Google OAuth 코드 |
| POST | `/api/auth/admin/login` | 관리자 로그인 (body: `{ email, password }`) | Basic auth 없음, 비밀번호 해시 매칭 |
| POST | `/api/auth/admin/logout` | 관리자 로그아웃 | 세션 쿠키 |
| GET | `/api/auth/session` | 관리자 세션 상태 확인 | 세션 쿠키 |
| POST | `/api/admin/challenge/import` | 참가자 명단 등록(CSV/JSON/textarea) | 관리자 세션 |
| GET | `/api/admin/challenge/participants` | 참가자 목록/진행률 조회 | 관리자 세션 |
| POST | `/api/admin/challenge/run-completion-check` | 완주 판별 실행 | 관리자 세션 |
| GET | `/api/admin/challenge/completions` | 완주자 목록(`?format=csv` 지원) | 관리자 세션 |
| GET | `/api/challenge/profile?email=...` | 참가자 진행률/제출 현황 조회 | 참가자 이메일 |
| POST | `/api/challenge/submit` | 참가자 제출 저장 (body: `{ email, day, type, value }`) | 참가자 이메일 |
| GET | `/api/challenge/certificate?email=...` | 수료증 메타데이터 반환 | 참가자 이메일 |

> 관리자 API는 세션 쿠키(HttpOnly) 기반으로만 접근 가능합니다. 프론트엔드 fetch 시 항상 `credentials: 'include'` 설정을 잊지 마세요.

## 데이터 아키텍처
- **Cloudflare KV (선택)**: `CHALLENGE_KV` 바인딩 시 참가자 레코드/제출 로그를 글로벌 분산 키-값 저장소에 영속화
- **In-memory fallback**: 로컬 개발 또는 KV 미바인딩 시 Map 기반 임시 저장, 재시작 시 데이터 초기화
- **OpenAI API**: `POST /api/analyze`에서 GPT-4o-mini 호출(이미지 data URL) → 25개 키워드/제목/요약 JSON 응답, 키 미설정 시 오류 처리
- **수료증 생성**: 프론트엔드 html2canvas(1.4.1)로 DOM → PNG 렌더, 배경색 #fef568 강제 지정

## 환경 변수 & 시크릿
| 변수 | 용도 | 필수 여부 | 비고 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | `/api/analyze` OpenAI Chat Completions 키 | 선택 (미설정 시 오류 응답) | Cloudflare Pages에서 `wrangler pages secret put` 권장 |
| `ADMIN_EMAIL` | 관리자 로그인용 이메일(소문자) | 필수 | 예: `admin@example.com` |
| `ADMIN_PASSWORD_HASH` | 관리자 비밀번호 SHA-256 해시(소문자 hex) | 필수 | `echo -n 'password' | shasum -a 256` 으로 생성 |
| `SESSION_SECRET` | 관리자 JWT 서명 시크릿 | 필수 | 최소 32자 이상 권장 |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 클라이언트 ID | 필수 | Google Cloud Console에서 발급, 프론트에 노출되어도 무방 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 클라이언트 Secret | 필수 | Cloudflare Pages Secret으로만 저장 (프론트 노출 금지) |
| `GOOGLE_REDIRECT_URI` | Google OAuth 리디렉션 URI | 선택 | 기본값 `https://project-9cf3a0d0.pages.dev/auth/google/callback` |
| `CHALLENGE_KV` | Cloudflare KV 바인딩 이름 | 선택 | 미설정 시 in-memory fallback |

> 로컬 개발: `.dev.vars` 파일에 위 변수를 정의하고 `.gitignore`에 포함되어 있습니다. Google OAuth 값(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`)도 동일하게 관리하세요.

## 개발 환경 & 실행 방법
```bash
# 1. 의존성 설치
yarn install # 또는 npm install

# 2. 환경 변수 구성 (예시)
cat <<'EOF' > .dev.vars
OPENAI_API_KEY="sk-..."
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD_HASH="<SHA256_HEX>"
SESSION_SECRET="<랜덤 32자 이상>"
GOOGLE_CLIENT_ID="<YOUR_GOOGLE_CLIENT_ID>"
GOOGLE_CLIENT_SECRET="<YOUR_GOOGLE_CLIENT_SECRET>"
GOOGLE_REDIRECT_URI="https://project-9cf3a0d0.pages.dev/auth/google/callback"
# CHALLENGE_KV는 Cloudflare 바인딩 시 자동 주입
EOF

# 3. 번들 생성
npm run build

# 4. 포트 정리 및 개발 서버 실행 (PM2 + wrangler pages dev)
fuser -k 3000/tcp 2>/dev/null || true
pm2 delete webapp 2>/dev/null || true
pm2 start ecosystem.config.cjs

# 5. 헬스 체크
curl http://localhost:3000/api/health
```
- `ecosystem.config.cjs`: `wrangler pages dev dist --ip 0.0.0.0 --port 3000`
- KV 개발용: `wrangler pages dev dist --d1=<name> --local` 형태로 수정 가능
- 비밀번호 해시 생성 예시: `echo -n 'test1234!' | shasum -a 256 | awk '{print tolower($1)}'`

## 테스트/검증 로그
- 2025-10-03 `npm run build` (성공: 최신 챌린지 스타일, CSP, Google Sign-In 번들 포함)
- `curl http://localhost:3000/api/health` → `{ "status": "ok" }`
- 관리자 로그인 플로우: 잘못된 해시 입력 시 401 + 지연 응답 확인, 성공 시 세션 쿠키(`admin_session`) 발급·만료 8h
- Google OAuth 코드 플로우: Google 계정 선택 팝업 → `/api/auth/google`이 OAuth 코드를 교환하고 ID 토큰을 검증, 검증 실패 시 명확한 에러 코드(`GOOGLE_EMAIL_NOT_VERIFIED` 등) 반환
- `/api/admin/challenge/import` → CSV 업로드 후 참가자 수량/총 인원 응답 확인
- `/api/challenge/submit` → URL 제출 성공, 15회 이후 자동 완주 → `/api/challenge/certificate` 200 응답 확인

## 미구현/예정 기능
- Cloudflare D1 연동 후 제출 로그·완주 로그 SQL 관리
- 실서비스용 이메일/OTP 인증 백엔드 구현 및 크레딧 영속화
- 관리자 다계정 지원 및 감사 로그 페이지
- 챌린지 통계 시각화(그래프, 주차별 히트맵 등)
- Lighthouse 자동화/접근성 테스트 스위트

## 향후 권장 작업
1. **KV 바인딩 적용**: `wrangler kv:namespace create <name>` → `wrangler.jsonc` 바인딩 후 Pages 프로젝트에 연결
2. **OpenAI API 키 보호**: Cloudflare Pages Secret에 등록 후 로컬 `.dev.vars` 분리
3. **UI 개선**: 모바일에서 챌린지 카드 및 수료증 슬라이더 도입, 관리자 표 정렬/필터 추가
4. **빌드 파이프라인**: GitHub Actions + Wrangler Deploy 자동화 구성, main 브랜치 → 프로덕션 자동 배포
5. **로컬 OAuth 리디렉션 추가**: Google Cloud Console에 `http://localhost:3000/auth/google/callback`을 리디렉션 URI로 등록해 개발 테스트 편의 확보

## 배포 절차
1. **GitHub 연동**
   ```bash
   # GitHub 인증 설정 (최초 1회)
   # setup_github_environment 도구 호출 후 안내에 따라 인증

   git status
   git add .
   git commit -m "feat: add admin challenge workflow"
   git push origin main
   ```
   > 원격 저장소는 사용자 지정 GitHub 리포지토리를 우선 사용합니다.

2. **Cloudflare Pages 배포**
   ```bash
   # Cloudflare API 토큰 설정 (최초 1회)
   # setup_cloudflare_api_key 도구 호출

   # 프로젝트명 확인/등록
   meta_info(action="read", key="cloudflare_project_name")
   # 없을 경우 meta_info(action="write", key="cloudflare_project_name", value="easy-image-editor")

   npm run build
   npx wrangler whoami
   npx wrangler pages project create <project-name> --production-branch main --compatibility-date 2025-10-03
   npx wrangler pages deploy dist --project-name <project-name>
   ```
   - 배포 성공 후 README `URL` 섹션과 `meta_info`에 최종 프로젝트명 기록
   - Secrets: `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY` 등을 `npx wrangler pages secret put <NAME> --project-name <project-name>` 명령으로 등록 (`GOOGLE_CLIENT_SECRET`은 반드시 서버 사이드 시크릿으로 유지)

## 사용자 가이드 요약
- **게스트**: 이미지 업로드 → 로그인 모달에서 Google 계정 선택 또는 이메일 OTP 인증 → 무료 크레딧 충전 후 편집 진행
- **관리자**: 헤더 내비게이션에서 “관리자” 탭을 열고 이메일·비밀번호로 로그인하면 대시보드에서 명단 업로드·완주 판별·CSV 다운로드 수행
- **참가자**: 로그인 후 헤더의 “커뮤니티” 탭으로 이동해 진행률을 확인하고 Day 제출 폼(URL/이미지) 등록 → 완주 시 수료증 PNG 다운로드
- **보안 주의**: 관리자 자격 증명과 `GOOGLE_CLIENT_SECRET`은 Cloudflare Secret으로만 배포, 프론트엔드에 노출 금지

## URL & 배포 상태
- **Production**: https://image-editor.pages.dev (예시, 실제 배포 시 업데이트 필요)
- **GitHub**: https://github.com/username/webapp (사용자 저장소로 교체)

## 라이선스 & 고지
- 원본 저장소 [`elliesbang/Easy-Image-Editer`](https://github.com/elliesbang/Easy-Image-Editer)의 라이선스 정책을 준수합니다.

_Last updated: 2025-10-04 (커뮤니티/관리자 전용 내비게이션 분리)_
