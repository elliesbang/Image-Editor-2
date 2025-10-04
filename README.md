# Easy Image Editor (Cloudflare Pages + Hono)

## 프로젝트 개요
- **이름**: Easy Image Editor
- **목표**: Cloudflare Pages + Hono 조합으로 동작하는 경량 이미지 편집 스튜디오에 **관리자용 무제한 테스트 흐름**과 **미치나 플랜 3주 챌린지 관리 시스템**을 결합
- **핵심 특징**: HTML5 Canvas 기반 이미지 파이프라인, Freemium 크레딧 게이트, 관리자 전용 인증/세션 유지, 참가자 진행률·수료증 UI, OpenAI 연동 키워드 분석

## 현재 구현 기능
- **이미지 편집 파이프라인**: 최대 50장 동시 업로드, 배경 제거·피사체 타이트 크롭·노이즈 제거·가로폭 리사이즈(Blob 우선 로딩 + `globalCompositeOperation: copy`로 투명 배경/크롭 결과 100% 유지, 결과 선택 시 원본 업로드 자동 제외), PNG → SVG 변환(JSZip + ImageTracer.js), 선택/전체 ZIP 다운로드
- **Freemium 크레딧 모델**: 로그인 시 30 크레딧 자동 충전, 작업별 차감, 잔여량에 따라 헤더/게이트 상태(`success → warning → danger`) 자동 전환
- **이메일 로그인 UX**: 6자리 인증 코드 기반 OTP 흐름, 인증 코드 만료/재시도 안내, Google 로그인은 비활성화되어 이메일 인증만 지원
- **관리자 인증 & 보안 강화**
  - SHA-256 해시 기반 자격 검증 + Hono JWT + HttpOnly 세션 쿠키, JWT에는 `iss/aud/ver/iat` 포함
  - 세션 버전(`ADMIN_SESSION_VERSION`)으로 기존 쿠키 무효화 가능
  - 고정 윈도우 + 추가 쿨다운 기반 레이트 리밋(`ADMIN_RATE_LIMIT_*`) 및 `Retry-After`/`X-RateLimit-*` 헤더 제공
  - 관리자 로그인/세션 복원 시 자동 페이지 전환 없이 상태 배너에서 ‘대시보드 이동’·‘새 탭에서 열기’ CTA를 즉시 제공하고, 내비게이션 버튼 하이라이트와 안내 패널(현재 페이지 이동/새 탭 열기)을 동시에 노출해 대시보드 위치를 즉시 안내(상태 배너 문안: “관리자 로그인 완료! 대시보드를 현재 페이지에서 열거나 새 탭으로 띄울 수 있습니다.”)
  - `/api/auth/admin/login/logout/session` REST API, 실패 시 지연 응답 및 429 처리
- **미치나 플랜 3주 챌린지 관리**
  - 관리자: CSV/수동 입력으로 참가자 명단 업로드, D+15 영업일 자동 만료일, 진행률 대시보드, 완주 판별 실행, 완주자 CSV 추출, 참가자 데이터 백업/스냅샷 API
  - 참가자: 제출 진행률 바, Day별 제출 카드, URL/이미지 제출(이미지 → base64 저장), 자동 완주 판정, 수료증 발급
  - 키-값 저장소(KV) 사용 시 전역 영속화, 로컬 개발 시 in-memory fallback + 백업 스토어 동기화
- **수료증 발급 (배경 #fef568)**: `/api/challenge/certificate` 응답을 기반으로 html2canvas로 PNG 다운로드 생성
- **보안 헤더 & 보호**: 전역 CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy 적용
- **법적 문서 & 쿠키 배너**: 개인정보 처리방침(`/privacy`), 이용약관(`/terms`), 쿠키 정책(`/cookies`) 및 선택형 쿠키 배너
- **헤더 커뮤니티 링크**: 로그인 버튼 옆 “미치나 커뮤니티” 버튼을 새 탭으로 열어 외부 커뮤니티 또는 내부 뷰(`/?view=community`)에 접근 가능

## 관리자 & 챌린지 운영 흐름
0. **이메일 로그인**: 로그인 모달에서 이메일 주소 입력 → 6자리 인증 코드 전송 → 코드 확인 후 로그인(샌드박스에서는 코드가 즉시 안내됨)
1. **관리자 로그인**: `/api/auth/admin/login`으로 이메일·비밀번호 제출 → SHA-256 해시 비교 후 JWT 서명, HttpOnly 세션 쿠키 발급(8시간). 로그인 성공 후에는 자동 이동 없이 상태 배너/안내 패널의 CTA(현재 창 이동 또는 새 탭 열기)를 통해 대시보드 진입 방식을 선택
2. **명단 등록**: CSV 업로드(이메일, 이름, 종료일) 또는 textarea 입력 → KV/in-memory에 참가자 레코드 저장, 미치나 플랜 권한 부여
3. **대시보드 모니터링**: 진행률/미제출 현황 표, 완료 상태 필터, 새로고침·완주 판별 버튼 제공
4. **완주 판별**: `/api/admin/challenge/run-completion-check` 호출 시 제출 횟수 15회 이상 참가자를 `completed=true`로 업데이트
5. **CSV 추출**: `/api/admin/challenge/completions?format=csv` 응답을 통해 완주자 명단 다운로드
6. **백업/스냅샷**: `/api/admin/challenge/backup`으로 기본/백업 KV 동기화, `/api/admin/challenge/backup/snapshot`으로 참가자 JSON 스냅샷 저장
7. **세션 종료**: `/api/auth/admin/logout` 호출 또는 401 응답 시 프론트에서 세션 제거 및 관리자 모달 재요청

## 참가자 UI 가이드
0. **커뮤니티 이동**: 헤더 로그인 버튼 옆 “미치나 커뮤니티” 새 탭 링크를 통해 커뮤니티 페이지 접근
1. **프로필 확인**: 로그인 후 이메일이 챌린지 참가자라면 `/api/challenge/profile` 로드 → 진행률·남은 제출 수 표시
2. **일일 제출**: Day 선택 → URL 입력 또는 이미지 업로드(이미지 선택 시 URL보다 우선) → 제출 시 `/api/challenge/submit`
3. **진행률 추적**: 진행률 바(퍼센트), 남은 횟수, 각 Day 카드(`예정/제출 대기/완주/기록 없음`) 확인
4. **수료증**: 15회 제출 완료 시 자동 완주 처리, `/api/challenge/certificate` fetch 후 html2canvas로 PNG 저장(배경 #fef568)

## 보안 강화 요소
- 관리자 자격 증명은 SHA-256(소문자 hex)으로 비교, 인증 실패 시 지연 응답으로 타이밍 공격 완화
- JWT 페이로드 → `{ sub, role, exp, iss, aud, ver, iat }`, HttpOnly + Secure + SameSite=Lax 쿠키, 세션 버전 변경 시 즉시 무효화
- 관리자 로그인 레이트 리밋: 고정 윈도우 + 쿨다운 + IP 기반 키(`ratelimit:admin-login:*`), 429 시 `Retry-After` 헤더 포함
- CSP `default-src 'self'`, script/style CDN 화이트리스트, 이미지 data/blob 허용, frame-ancestors 'none'
- Strict-Transport-Security(180일, preload), Referrer-Policy(`strict-origin-when-cross-origin`), Permissions-Policy(카메라/마이크/geolocation 차단)
- Cloudflare KV + 백업 KV를 우선 사용, 미바인딩 시 in-memory Map으로 기본/백업 저장소 분리 유지

## URL & 엔드포인트 요약
| Method | Path | 설명 | 인증 |
| --- | --- | --- | --- |
| GET | `/` | 멀티 이미지 편집 UI + 오퍼레이션 스테이지 | - |
| GET | `/privacy`, `/terms`, `/cookies` | 법적 고지 페이지 | - |
| GET | `/static/*` | 정적 자산(app.js, styles.css 등) | - |
| GET | `/api/health` | 상태 점검 JSON `{ "status": "ok" }` | - |
| POST | `/api/analyze` | OpenAI GPT-4o-mini 기반 키워드/제목 분석 (data URL 입력) | Server-side API key |
| POST | `/api/auth/google` | Google OAuth 코드 ↔ ID 토큰 교환 및 프로필 반환 | Google OAuth 코드 |
| GET | `/api/auth/session` | 관리자 세션 상태 확인 | 세션 쿠키 |
| POST | `/api/auth/admin/login` | 관리자 로그인 (body: `{ email, password }`) | 세션 쿠키 발급 |
| POST | `/api/auth/admin/logout` | 관리자 로그아웃 | 세션 쿠키 |
| POST | `/api/admin/challenge/import` | 참가자 명단 등록(CSV/JSON/textarea) | 관리자 세션 |
| GET | `/api/admin/challenge/participants` | 참가자 목록/진행률 조회 | 관리자 세션 |
| POST | `/api/admin/challenge/run-completion-check` | 완주 판별 실행 | 관리자 세션 |
| GET | `/api/admin/challenge/completions` | 완주자 목록(`?format=csv` 지원) | 관리자 세션 |
| POST | `/api/admin/challenge/backup` | 참가자 레코드 기본/백업 저장소 동기화 | 관리자 세션 |
| POST | `/api/admin/challenge/backup/snapshot` | 참가자 JSON 스냅샷 백업 | 관리자 세션 |
| GET | `/api/challenge/profile?email=...` | 참가자 진행률/제출 현황 조회 | 참가자 이메일 |
| POST | `/api/challenge/submit` | 참가자 제출 저장 (body: `{ email, day, type, value }`) | 참가자 이메일 |
| GET | `/api/challenge/certificate?email=...` | 수료증 메타데이터 반환 | 참가자 이메일 |

> 관리자 API는 세션 쿠키(HttpOnly) 기반으로만 접근 가능합니다. 프론트엔드 fetch 시 항상 `credentials: 'include'` 설정을 잊지 마세요. 429 응답 시 `Retry-After`를 읽어 재시도 시간을 안내하세요.

## 데이터 아키텍처
- **Cloudflare KV (선택)**: `CHALLENGE_KV` 바인딩 시 참가자 레코드/제출 로그를 글로벌 분산 키-값 저장소에 영속화
- **백업 KV (선택)**: `CHALLENGE_KV_BACKUP` 바인딩 시 기본 KV와 동기화, 스냅샷 백업 키(`backup:snapshot:*`) 저장
- **In-memory fallback**: 로컬 개발 또는 KV 미바인딩 시 Map 기반 임시 저장 (기본/백업 각각 유지), 재시작 시 데이터 초기화
- **OpenAI API**: `POST /api/analyze`에서 Responses API(gpt-4o-mini + JSON Schema `response_format`, 25초 타임아웃, `x-request-id` 전달) 호출, 이미지 data URL을 `input_image`로 전달해 25개 키워드/제목/요약을 구조화 수신, 서버 측 키워드 정규화·보강(문자열 응답/중복 제거, 25개 보장), 실패 시 상세 코드와 함께 로컬 캔버스 분석으로 자동 대체
- **수료증 생성**: 프론트엔드 html2canvas(1.4.1)로 DOM → PNG 렌더, 배경색 #fef568 강제 지정

## 환경 변수 & 시크릿
| 변수 | 용도 | 필수 여부 | 비고 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | `/api/analyze` OpenAI Responses API 키 | 선택 (미설정 시 오류 응답) | Cloudflare Pages Secret 권장 |
| `ADMIN_EMAIL` | 관리자 로그인 이메일(소문자) | 필수 | 예: `admin@example.com` |
| `ADMIN_PASSWORD_HASH` | 관리자 비밀번호 SHA-256 해시(소문자 hex) | 필수 | `echo -n 'password' | shasum -a 256` |
| `SESSION_SECRET` | 관리자 JWT 서명 시크릿 | 필수 | 최소 32자 이상 권장 |
| `ADMIN_SESSION_VERSION` | 관리자 세션 버전 문자열 | 선택 (기본 `1`) | 변경 시 기존 쿠키 무효화 |
| `ADMIN_RATE_LIMIT_MAX_ATTEMPTS` | 관리자 로그인 허용 시도 횟수 | 선택 (기본 `5`) | 1~20 범위 |
| `ADMIN_RATE_LIMIT_WINDOW_SECONDS` | 레이트 리밋 윈도우(초) | 선택 (기본 `60`) | 10~3600 범위 |
| `ADMIN_RATE_LIMIT_COOLDOWN_SECONDS` | 최대 시도 초과 시 추가 쿨다운 | 선택 (기본 `300`) | 윈도우 이상 7200 이하 |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 클라이언트 ID | 선택 | 현재 Google 로그인 비활성화(미입력 가능) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 클라이언트 Secret | 선택 | 현재 Google 로그인 비활성화(미입력 가능) |
| `GOOGLE_REDIRECT_URI` | Google OAuth 리디렉션 URI | 선택 | 현재 Google 로그인 비활성화(미입력 가능) |
| `MICHINA_COMMUNITY_URL` | 헤더 “미치나 커뮤니티” 링크 URL | 선택 | 미설정 시 `/?view=community` |
| `CHALLENGE_KV` | Cloudflare KV 바인딩 이름 | 선택 | 참가자 레코드 기본 저장소 |
| `CHALLENGE_KV_BACKUP` | Cloudflare KV 백업 바인딩 | 선택 | 미설정 시 in-memory 백업 Map 사용 |

> 로컬 개발: `.dev.vars` 파일에 위 변수를 정의하고 `.gitignore`에 포함되어 있습니다. Google OAuth 값(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`)도 동일하게 관리하세요.

## 개발 환경 & 실행 방법
```bash
# 1. 의존성 설치
npm install

# 2. 환경 변수 구성 (예시)
cat <<'EOF' > .dev.vars
OPENAI_API_KEY="sk-..."
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD_HASH="<SHA256_HEX>"
SESSION_SECRET="<랜덤 32자 이상>"
ADMIN_SESSION_VERSION="1"
ADMIN_RATE_LIMIT_MAX_ATTEMPTS="5"
ADMIN_RATE_LIMIT_WINDOW_SECONDS="60"
ADMIN_RATE_LIMIT_COOLDOWN_SECONDS="300"
# Google OAuth 변수 (현재 Google 로그인 비활성화 상태이므로 입력하지 않아도 됩니다)
# GOOGLE_CLIENT_ID="<YOUR_GOOGLE_CLIENT_ID>"
# GOOGLE_CLIENT_SECRET="<YOUR_GOOGLE_CLIENT_SECRET>"
# GOOGLE_REDIRECT_URI="http://localhost:3000/auth/google/callback"
MICHINA_COMMUNITY_URL="https://community.example.com"
# CHALLENGE_KV / CHALLENGE_KV_BACKUP 은 Cloudflare 바인딩 시 자동 주입
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
- 2025-10-04 `npm run build` (성공: Blob 우선 리사이즈 파이프라인 + copy 합성으로 투명도 유지, OpenAI Responses API 타임아웃/요청 ID/25개 보강, Google 로그인 비활성화 및 이메일 로그인 전용 UX, 커뮤니티 헤더 링크, 관리자 레이트 리밋, 상태 배너 CTA 템플릿)
- 2025-10-04 관리자 로그인 직후 상태 배너 CTA(“관리자 로그인 완료! ...”)·내비 하이라이트·안내 패널 연동 검증(세션 동기화 포함, 자동 이동 제거, 8초 지속·`status--interactive` 적용)
- `curl http://localhost:3000/api/health` → `{ "status": "ok" }`
- 관리자 로그인 플로우: 잘못된 해시 입력 시 401 + 지연 응답, 3회 초과 시 429 + `Retry-After`, 성공 시 세션 쿠키(`admin_session`) 발급·만료 8h
- Google OAuth 코드 플로우: 팝업 거절/네트워크 오류 시 자동 재시도 메시지 노출, 검증 실패 시 명확한 에러 코드(`GOOGLE_EMAIL_NOT_VERIFIED` 등) 반환
- `/api/admin/challenge/import` → CSV 업로드 후 참가자 수량/총 인원 응답 확인
- `/api/admin/challenge/backup` + `/api/admin/challenge/backup/snapshot` → 백업 KV 동기화 및 스냅샷 키 생성 확인
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
   git commit -m "feat: improve admin challenge workflow"
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
   - Secrets: `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `ADMIN_SESSION_VERSION`, `ADMIN_RATE_LIMIT_MAX_ATTEMPTS`, `ADMIN_RATE_LIMIT_WINDOW_SECONDS`, `ADMIN_RATE_LIMIT_COOLDOWN_SECONDS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY` 등을 `npx wrangler pages secret put <NAME> --project-name <project-name>` 명령으로 등록 (`GOOGLE_CLIENT_SECRET`은 반드시 서버 사이드 시크릿으로 유지)

## 사용자 가이드 요약
- **게스트**: 이미지 업로드 → 로그인 모달에서 이메일 주소 입력 및 6자리 인증 코드 확인 → 무료 크레딧 충전 후 편집 진행
- **관리자**: 헤더 내비게이션에서 관리자 모달을 열고 이메일·비밀번호로 로그인 → 로그인 직후 상단 상태 배너의 "대시보드 이동"/"새 탭에서 열기" 버튼 또는 안내 패널에서 동일한 옵션을 선택해 대시보드에 즉시 접근 → 대시보드에서 명단 업로드·완주 판별·CSV/백업 수행
- **참가자**: 로그인 후 헤더의 “미치나 커뮤니티” 버튼으로 참가자 안내 페이지 이동, 진행률 확인 및 Day 제출 → 완주 시 수료증 PNG 다운로드
- **보안 주의**: 관리자 자격 증명과 `GOOGLE_CLIENT_SECRET`은 Cloudflare Secret으로만 배포, 프론트엔드에 노출 금지

## URL & 배포 상태
- **Production**: https://project-9cf3a0d0.pages.dev
- **Latest Preview**: https://35f57e10.project-9cf3a0d0.pages.dev (2025-10-04 배포)
- **GitHub**: https://github.com/elliesbang/Easy-Image-Editer

## 라이선스 & 고지
- 원본 저장소 [`elliesbang/Easy-Image-Editer`](https://github.com/elliesbang/Easy-Image-Editer)의 라이선스 정책을 준수합니다.

_Last updated: 2025-10-04 (Google 로그인 비활성화 및 이메일 전용 인증 UX · 관리자 로그인 자동 이동 제거 + 배너 CTA 복수 선택 안내(대시보드 이동/새 탭) · 네비 하이라이트 · OpenAI Responses API 타임아웃/요청 ID 보강 · Blob 기반 리사이즈 알파 유지)_
