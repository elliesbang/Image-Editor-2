# Easy Image Editor (Cloudflare Pages + Hono)

## 프로젝트 개요
- **이름**: Easy Image Editor
- **목표**: Cloudflare Pages + Hono 조합으로 동작하는 경량 멀티 이미지 편집 워크스페이스 구축 및 고도화
- **핵심 특징**: HTML5 Canvas 처리 파이프라인(배경 제거, 피사체 중심 타이트 크롭, 노이즈 제거, 리사이즈)과 PNG → SVG 변환, ZIP 다운로드, 키워드 분석까지 브라우저만으로 제공하는 프리미엄 편집 스튜디오

## 현재 구현 기능
- 최대 50장 이미지 드래그 앤 드롭/파일 선택 업로드, 썸네일 카드 그리드 자동 구성
- 업로드/결과 카드에 체크박스·hover X 버튼을 분리해 선택 토글, 삭제, 다중 선택 UX를 개선(카드 클릭 = 선택 토글, 체크박스 = 명시 선택, hover X = 삭제)
- 리사이즈 실행 시 **기존 결과 카드에도 덮어쓰기 적용**(새로운 Blob/ObjectURL 재등록, 선택 상태/분석 캐시 갱신)
- Canvas 기반 렌더 파이프라인
  - 배경 제거: 경계 flood-fill + 페더링/alpha 감쇠로 자연스러운 마스킹
  - 피사체 크롭: 배경 제거 후 알파 히트맵 + 컬러 바운딩 박스를 결합해 복잡한 배경에서도 타이트한 크롭 수행
  - 배경 제거 + 크롭 일괄 실행, 박스 블러 기반 노이즈 제거
  - 가로 기준 리사이즈(업로드·결과 모두 대상) → 결과 카드 덮어쓰기 또는 신규 추가
- PNG → SVG 변환: ImageTracer.js 동적 로딩(Promise 리셋 + error 핸들링)으로 로더 실패 시 자동 복구, 색상 1~6 선택, 150KB 용량 한도 내 자동 옵션 조정, viewBox 자동 삽입
- 결과 ZIP 다운로드(선택/전체) 및 JSZip 번들 포함 여부 감지
- **Freemium 크레딧 모델**: 로그인 시 무료 30 크레딧 충전, 작업별 차감(배경/크롭/노이즈/리사이즈 1, PNG→SVG 2, 선택 다운로드 1, 전체 다운로드 2, 분석 1)
- OTP 이메일 로그인(6자리 코드·5분 만료·재전송), Google 로그인 데모, 헤더/게이트/스테이지 인디케이터와 연동된 상태 UI
- 키워드 분석: `/api/analyze` → OpenAI Chat Completions API 호출, 키/요금 미설정 시 로컬 Canvas 분석 25키워드/요약/제목 fallback
- 쿠키 동의 배너, 개인정보 처리방침(`/privacy`), 이용약관(`/terms`), 쿠키 정책(`/cookies`), 헬스 체크(`/api/health`)

## 최근 개선 하이라이트
1. **결과 리사이즈 덮어쓰기**: `replaceResult`가 기존 Blob URL 해제 후 새 객체를 교체하고 스테이지/분석 상태를 재계산하도록 수정
2. **선택 UX 강화**: 카드 hover X 제거 버튼, 체크박스 토글 분리, 처리 중 버튼 disabled 상태 반영
3. **ImageTracer 로더 안정화**: script 오류 이벤트를 감지하고 Promise를 초기화하여 재시도 가능하도록 개선
4. **복잡 배경 타이트 크롭**: 알파 히트맵 + 컬러 바운드 결합 로직으로 여백을 최소화
5. **Hero/Features 배치 조정**: Hero 하단 설명 정리, Features 섹션을 Hero 바로 뒤로 이동하여 정보 위계 개선
6. **크레딧 안내 텍스트·게이트 UX**: 잔여 크레딧 수량과 경고 단계 표시를 강화

## 미구현/예정 기능
- OpenAI GPT-4 이상 모델 기반 고급 메타데이터 파이프라인 고도화(현재는 4o-mini 호출 + 로컬 fallback)
- Google OAuth & 이메일 OTP 백엔드 실구현, 크레딧/세션 영속화
- Cloudflare D1/KV/R2 또는 서드파티 API 기반 결제/충전/사용 내역 저장소 도입
- 고급 PNG → SVG 프리셋/배치 설정, 다운로드 포맷 확장
- 자동화 테스트, Lighthouse 접근성/성능 튜닝

## URL & 엔드포인트 요약
| 경로 | 설명 |
| --- | --- |
| `/` | 멀티 이미지 편집 메인 UI |
| `/privacy` | 개인정보 처리방침 |
| `/terms` | 이용약관 |
| `/cookies` | 쿠키 정책 |
| `/api/health` | 상태 점검(JSON `{ "status": "ok" }`) |
| `POST /api/analyze` | OpenAI 기반 이미지 키워드·제목 생성(JSON, 키 미설정 시 오류 응답)

> Cloudflare Pages 프로덕션/프리뷰 URL은 배포 완료 후 업데이트 예정입니다.

## 데이터 아키텍처
- 편집·분석은 모두 브라우저 Canvas 및 메모리에서 진행, 서버측 파일 시스템/DB 사용 없음
- OpenAI API 키 미설정 시 클라이언트에서 로컬 Canvas 분석으로 자동 대체
- 추후 확장 시 Cloudflare D1(관계형), KV(키값), R2(파일)를 고려

## 크레딧 정책(요약)
| 작업 | 차감 크레딧 |
| --- | --- |
| 배경 제거 / 피사체 크롭 / 배경 제거+크롭 / 노이즈 제거 / 리사이즈 | 이미지 1장당 1 |
| PNG → SVG 변환 | 이미지 1장당 2 |
| 결과 다운로드(선택) | 선택 항목당 1 |
| 결과 다운로드(전체) | 포함 항목당 2 |
| 키워드 분석 | 1회 실행당 1 |
- 로그인 시 무료 30 크레딧 자동 충전, 크레딧 잔여량에 따라 헤더 배지·게이트가 `success → warning → danger` 상태로 변환
- 비로그인 시 모든 실행 버튼 클릭 시 로그인 모달/게이트 CTA 노출

## 개발 환경 & 실행 방법
```bash
# 1. 의존성 설치
npm install

# 2. 번들 생성
npm run build

# 3. 포트 정리 및 개발 서버 실행(PM2 + wrangler pages dev)
fuser -k 3000/tcp 2>/dev/null || true
pm2 delete webapp-dev 2>/dev/null || true
pm2 start ecosystem.config.cjs

# 4. 헬스 체크
curl http://localhost:3000/api/health
```
- `ecosystem.config.cjs` 는 `wrangler pages dev dist --ip 0.0.0.0 --port 3000`를 포크 모드로 실행합니다.
- 종료 시 `pm2 delete webapp-dev` 로 정리하세요.

## 테스트/검증 로그
- `npm run build` (성공)
- `curl http://localhost:3000/api/health` → `{ "status": "ok" }`
- `curl -X POST /api/analyze` (OpenAI 키 미설정 시 `{"error":"OPENAI_API_KEY_NOT_CONFIGURED"}` 응답 확인)

## 환경 변수 & 시크릿
- `OPENAI_API_KEY`: OpenAI Chat Completions API 호출용 키
  - 로컬/샌드박스: `.dev.vars` 파일에 `OPENAI_API_KEY="sk-..."` 추가 (gitignore)
  - Cloudflare Pages: `npx wrangler pages secret put OPENAI_API_KEY --project-name <project-name>`
  - 키 미설정 시 프런트엔드가 로컬 분석 결과를 사용하고 토스트 메시지로 안내

## 배포 절차
1. **GitHub 연동**
   ```bash
   # GitHub 인증 설정 (최초 1회)
   # setup_github_environment 도구 호출 후 안내에 따라 인증

   git status
   git add .
   git commit -m "feat: enhance image pipeline and UX"
   git push origin main
   ```
   > 원격 저장소는 이미 연결되어 있는 기존 GitHub 저장소를 우선 사용합니다.

2. **Cloudflare Pages 배포**
   ```bash
   # Cloudflare API 토큰 설정 (최초 1회)
   # setup_cloudflare_api_key 도구 호출

   # 프로젝트명 확인/등록
   # meta_info(action="read", key="cloudflare_project_name")
   # 필요 시 meta_info(action="write", key="cloudflare_project_name", value="easy-image-editor")

   npm run build
   npx wrangler whoami
   npx wrangler pages project create <project-name> --production-branch main --compatibility-date 2025-10-03  # 최초 1회
   npx wrangler pages deploy dist --project-name <project-name>
   ```
   - 배포 성공 후 README의 URL 섹션과 `meta_info`에 최종 프로젝트명을 기록합니다.
   - 시크릿이 필요하면 `npx wrangler pages secret put OPENAI_API_KEY --project-name <project-name>` 실행.

## 향후 권장 작업
- Cloudflare D1/KV/R2 연동을 활용한 크레딧 영속화 및 결제 시나리오 설계
- PNG → SVG 프리셋 관리 UI + 배치 처리 성능 튜닝
- OpenAI API 응답 검증 고도화 및 로깅/모니터링 개선
- 자동 테스트(Lighthouse/Playwright) 도입, 접근성 라벨링 보강

## 라이선스 & 고지
- 원본 저장소 [`elliesbang/Easy-Image-Editer`](https://github.com/elliesbang/Easy-Image-Editer)의 라이선스 정책을 준수합니다.

_Last updated: 2025-10-03_
