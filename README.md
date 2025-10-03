# Easy Image Editor (Cloudflare Pages + Hono)

## 프로젝트 개요
- **원본 저장소**: [`elliesbang/Easy-Image-Editer`](https://github.com/elliesbang/Easy-Image-Editer)
- **목표**: Cloudflare Pages 환경에서 동작하는 모던한 다중 이미지 편집 워크스페이스 복구 및 고도화
- **핵심 콘셉트**: HTML5 Canvas 기반의 경량 이미지 처리(배경 제거, 자동 크롭, 노이즈 제거, 리사이즈)와 결과 ZIP 다운로드를 한 번에 제공하는 올인원 툴 + Freemium 크레딧 게이팅 UX

## 현재 구현 기능 (완료)
- 최대 50장의 이미지 드래그 앤 드롭 / 파일 선택 업로드
- 업로드·결과 목록 분리 및 다중 선택, 일괄 삭제/다운로드 지원
- HTML5 Canvas 기반 **배경 제거**(에지 플러드 + 페더링 개선), **피사체 크롭**, **배경 제거 + 크롭**, **박스 블러 노이즈 제거**, **가로 기준 리사이즈**
- 업로드/처리 결과 어디서든 리사이즈 파이프라인 적용(가로 픽셀 입력 후 즉시 결과 생성)
- 선택한 이미지 라이브 미리보기 및 메타 정보(파일명, 해상도, 용량) 표시
- 캔버스 기반 색상·밝기 분석으로 25개 SEO 키워드 + 요약 + 제목 생성(결과 패널 하단 “분석 실행” 버튼)
- JSZip 기반 결과 ZIP 다운로드 (선택/전체)
- ImageTracer.js 기반 **PNG → SVG 벡터 변환**(색상 1~6 선택, viewBox 자동 삽입, 150KB 이하 용량 자동 조정, 업로드/처리 결과 모두 지원)
- 업로드/결과 카드 선택 상태에 따라 분석 패널이 갱신되는 선택 기반 워크플로우
- 다크 테마 UI, 리스폰시브 워크스페이스 레이아웃, 히어로 섹션
- 로그인 모달 데모: Google 버튼 + 6자리 이메일 인증 코드(5분 만료, 재전송 지원) 플로우를 제공하며 로그인/로그아웃 시 헤더·스테이지·게이트 상태와 크레딧 배지를 실시간 동기화
- Freemium 크레딧 모델: 로그인 시 무료 30 크레딧 자동 충전, 배경 제거/크롭/노이즈/리사이즈(이미지당 1크레딧), PNG→SVG 변환(이미지당 2크레딧), ZIP 다운로드(선택 1크레딧·전체 2크레딧), 키워드 분석(1크레딧) 차감 — 로그인이 되어 있어야 실행할 수 있으며 비로그인 시 게이트 CTA로 전환
- 헤더 크레딧 배지 + 3단계(Stage) 인디케이터 + Operations/Results 게이트 위젯으로 진행 상황과 접근 제약을 즉시 안내 (컨트롤은 로그인 전에도 노출)
- 쿠키 동의 배너 + 쿠키 정책 페이지(`/cookies`), 푸터에서 개인정보 처리방침(`/privacy`), 이용약관(`/terms`) 링크 제공
- 헬스 체크 API: `GET /api/health` → `{ "status": "ok" }`

## 미구현/예정 기능 (Pending)
- OpenAI GPT-4 API를 활용한 고급 키워드/제목 추천(심화 분석, 한글 출력)
- Google OAuth + 이메일 인증 로그인 **실제 연동(백엔드)**
- Freemium 크레딧 영속화 및 결제/충전 백엔드 연동(현재는 프런트엔드 데모 로직)
- 쿠키 동의 재설정 UI 및 고급 동의 관리 플로우
- Express API 사양 수신 시 Canvas 구현 대체(서버 사이드)

## URL & 엔드포인트 요약
| 경로 | 설명 |
| --- | --- |
| `/` | 멀티 이미지 편집 메인 UI |
| `/privacy` | 개인정보 처리방침 |
| `/terms` | 이용약관 |
| `/cookies` | 쿠키 정책 |
| `/api/health` | 상태 점검(JSON: `{ status: "ok" }`) |
| `POST /api/analyze` | OpenAI 기반 이미지 키워드·제목 생성(JSON) |

> Cloudflare Pages 배포 전이므로 프로덕션 URL은 미정입니다. 배포 후 실제 Pages 도메인을 업데이트하세요.

## 기술 스택
- **프레임워크**: Hono + Cloudflare Pages/Workers
- **번들러**: Vite
- **프론트엔드**: Vanilla JS, HTML5 Canvas, JSZip, ImageTracer.js(클라이언트 벡터 변환)
- **스타일**: Custom CSS (Inter + Pretendard 폰트), 다크 테마
- **런타임**: PM2 + `wrangler pages dev` (개발 핫 리로드)

## 데이터 아키텍처
- 모든 편집 처리는 브라우저(클라이언트) 메모리와 Canvas에서 수행
- 서버/데이터베이스를 사용하지 않으며 파일은 다운로드 시점에만 생성
- 추후 외부 API 연동 시 Cloudflare KV/D1/R2 또는 서드파티 REST API를 통해 확장 예정

## 크레딧 정책
- **기본 지급**: 로그인 완료 시 무료 30 크레딧 자동 충전 (비로그인 상태는 0 크레딧이며 실행 시 로그인 모달 CTA가 노출됩니다)
- **차감 기준**
  - 배경 제거/피사체 크롭/배경 제거+크롭/노이즈 제거/리사이즈: 선택한 이미지 1장당 1 크레딧
  - PNG → SVG 변환: 변환 대상 1장당 2 크레딧
  - 결과 다운로드: 선택 다운로드(선택 항목당 1 크레딧), 전체 다운로드(포함된 항목당 2 크레딧)
  - 키워드 분석: 실행 1회당 1 크레딧
- **게이트 상태 안내**
  - `locked`: 비로그인 또는 준비 단계 → 게이트 내 “로그인하고 무료 30 크레딧 받기” 버튼 표시
  - `warning`: 잔여 크레딧 1~2개 → 보충 권장 메시지
  - `danger`: 크레딧 소진 → 충전 안내
  - `unlocked`: 충분한 크레딧 → 게이트 UI 자동 숨김
- 모든 컨트롤은 로그인 전에도 노출되며, 실제 실행 시 `로그인 확인 → 크레딧 체크 → 처리` 순으로 진행됩니다.

## 환경 변수 & 시크릿
- **OPENAI_API_KEY**: OpenAI GPT-4/4o 계정의 API 키
  - 로컬/샌드박스 개발용: 프로젝트 루트에 `.dev.vars` 파일을 생성하고 `OPENAI_API_KEY="sk-..."` 형태로 추가 (gitignore 처리됨)
  - Cloudflare Pages 배포용: `npx wrangler pages secret put OPENAI_API_KEY --project-name <project-name>` 명령으로 시크릿 등록 (미설정 시 에디터가 자동으로 로컬 분석 모드로 전환하며 토스트로 안내합니다)
  - 프런트엔드에서는 키를 직접 노출하지 않고 `/api/analyze` 서버 엔드포인트를 통해 OpenAI에 요청합니다.

## 로컬/샌드박스 개발 방법
```bash
# 1. 의존성 설치
npm install

# 2. 번들 생성 (dist/)
npm run build

# 3. 샌드박스에서 PM2로 개발 서버 실행 (wrangler pages dev)
npm run build
pm2 delete webapp-dev 2>/dev/null || true
pm2 start ecosystem.config.cjs

# 4. 상태 확인
pm2 logs webapp-dev --nostream
curl http://localhost:3000/api/health
```
- `wrangler pages dev`는 `dist/`를 사용하므로 코드 수정 후 `npm run build`를 다시 실행하면 PM2 프로세스가 자동으로 최신 번들을 사용합니다.
- 로컬 머신에서 직접 개발하려면 `npm run dev`로 Vite 개발 서버를 구동할 수 있습니다.

## Cloudflare Pages 배포 절차
1. `npm run build`
2. Cloudflare API Token 설정 후 프로젝트 생성 (최초 1회)
   ```bash
   npx wrangler pages project create <project-name> --production-branch main --compatibility-date 2025-10-02
   ```
3. 배포 실행
   ```bash
   npx wrangler pages deploy dist --project-name <project-name>
   ```
4. 필요 시 시크릿/환경변수 등록
   ```bash
   npx wrangler pages secret put OPENAI_API_KEY --project-name <project-name>
   ```
5. README의 URL 섹션 업데이트

## 워크스페이스 사용 가이드
0. **로그인 준비(선택)**: 히어로 영역의 `로그인` 버튼을 누르면 Google 또는 이메일 인증 코드 선택 모달이 열립니다. 데모 플로우에서는 6자리 코드를 5분 동안 입력할 수 있으며, 로그인을 완료하면 무료 30 크레딧이 충전됩니다. 비로그인 상태에서도 UI는 노출되지만 실행 시 게이트 CTA를 통해 로그인 안내가 표시됩니다.
1. **이미지 업로드**: 히어로 영역 또는 좌측 업로드 패널에서 드래그 앤 드롭/클릭으로 최대 50장을 업로드합니다. 헤더의 단계(Stage) 인디케이터가 현재 진행 상태(업로드 → 보정 → 다운로드)를 안내합니다.
2. **선택 관리**: 업로드 카드의 체크박스를 통해 다중 선택, 전체 선택/해제/삭제 버튼 제공
3. **일괄 처리**: 좌측 패널의 기능 버튼(배경 제거, 크롭, 노이즈 제거, 리사이즈)으로 선택한 이미지에 Canvas 변환을 적용합니다 — 리사이즈는 업로드/결과 목록 어느 쪽을 선택해도 동작하며, 이미지 1장당 1 크레딧이 차감됩니다(게이트에서 잔여 크레딧 안내).
4. **선택 확인**: 업로드/결과 카드 클릭 시 선택 상태가 강조되고 분석 패널의 대상이 업데이트됩니다.
5. **키워드 분석**: 우측 결과 패널 하단의 "분석 실행" 버튼으로 색상·밝기 기반 25개의 SEO 키워드와 자동 생성 제목/요약을 확인합니다(1회당 1 크레딧).
6. **결과 관리**: 우측 결과 패널에서 처리 결과를 다운로드 또는 삭제합니다. 선택 다운로드는 선택 항목당 1 크레딧, 전체 다운로드는 항목당 2 크레딧이 차감되며, 게이트에서 상태를 확인할 수 있습니다.
7. **SVG 변환**: 우측 결과 툴바에서 색상 수를 선택한 뒤 "PNG → SVG 변환" 버튼을 눌러 선택한 업로드/결과 이미지를 벡터로 변환합니다(이미지 1장당 2 크레딧).
8. **쿠키 관리**: 최초 방문 시 노출되는 쿠키 배너에서 분석/마케팅 쿠키 선택 후 `동의하고 계속하기` 버튼으로 설정을 저장할 수 있습니다.

## 향후 권장 작업
- PNG → SVG 변환 품질 제어(고급 프리셋 저장, 다중 포맷 다운로드) 고도화
- OpenAI GPT-4 API를 활용한 이미지 메타데이터(제목/키워드) 생성 라우트 신설
- Google OAuth + 이메일 인증 로그인 플로우 구현
- Cloudflare D1/KV/R2 사용 여부 검토 및 크레딧/보안 토큰 관리 전략 수립
- 테스트 자동화 및 Lighthouse 성능/접근성 점검

## 라이선스 & 고지
- 원본 저장소의 라이선스 정책을 따릅니다.
_Last updated: 2025-10-03_
