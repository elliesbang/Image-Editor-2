import { Hono } from 'hono'
import type { Context } from 'hono'
import { serveStatic } from 'hono/cloudflare-pages'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { Google } from 'arctic'
import { renderer } from './renderer'
import { registerAuthRoutes } from '../routes/auth.js'
import AnalyzePanel from './features/keywords/AnalyzePanel'

type D1Result<T = unknown> = {
  success: boolean
  error?: string
  results?: T[]
}

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement
  run<T = unknown>(): Promise<D1Result<T>>
  all<T = unknown>(): Promise<D1Result<T>>
  first<T = unknown>(): Promise<T | null>
}

type D1Database = {
  prepare(query: string): D1PreparedStatement
}

type Bindings = {
  DB_MAIN: D1Database
  DB_MICHINA: D1Database
  OPENAI_API_KEY?: string
  ADMIN_EMAIL?: string
  SESSION_SECRET?: string
  ADMIN_SESSION_VERSION?: string
  ADMIN_SECRET_KEY?: string
  ADMIN_RATE_LIMIT_MAX_ATTEMPTS?: string
  ADMIN_RATE_LIMIT_WINDOW_SECONDS?: string
  ADMIN_RATE_LIMIT_COOLDOWN_SECONDS?: string
  CHALLENGE_KV?: KVNamespace
  CHALLENGE_KV_BACKUP?: KVNamespace
  VITE_GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_REDIRECT_URI?: string
  MICHINA_COMMUNITY_URL?: string
}

type ChallengeSubmission = {
  day: number
  type: 'image' | 'url'
  value: string
  submittedAt: string
}

type ChallengeParticipant = {
  email: string
  name?: string
  plan: 'michina'
  startDate: string
  endDate: string
  createdAt: string
  updatedAt: string
  submissions: Record<string, ChallengeSubmission>
  completed: boolean
  completedAt?: string
}

type ChallengeSummary = ChallengeParticipant & {
  totalSubmissions: number
  missingDays: number
}

type ChallengePeriodRow = {
  id: number
  start_date: string
  end_date: string
  saved_at: string
}

type ChallengePeriodRecord = {
  id: number
  startDate: string
  endDate: string
  savedAt: string
}

type MichinaListRow = {
  id: number
  name: string | null
  email: string
  approved_at: string
}

type MichinaListEntry = {
  id: number
  name: string
  email: string
  approvedAt: string
}

type AdminSessionPayload = {
  sub: string
  role: 'admin'
  exp: number
  iss: string
  aud: string
  ver: string
  iat: number
}

type AdminConfig = {
  email: string
  sessionSecret: string
  sessionVersion: string
}

type AdminRateLimitConfig = {
  maxAttempts: number
  windowSeconds: number
  cooldownSeconds: number
}

type AdminConfigValidationResult = {
  config: AdminConfig | null
  issues: string[]
}

type RateLimitRecord = {
  count: number
  windowStart: number
  windowEnd: number
  blockedUntil?: number
}

type RateLimitStatus = {
  blocked: boolean
  remaining: number
  resetAfterSeconds: number
  retryAfterSeconds?: number
}

type MichinaPeriod = {
  start: string
  end: string
  updatedAt: string
  updatedBy?: string
}

type MichinaChallengerRecord = {
  challengers: string[]
  updatedAt: string
  updatedBy?: string
}

type MichinaPeriodHistoryItem = {
  start: string
  end: string
  updatedAt: string
  updatedBy?: string
}

type MichinaUserRecord = {
  name: string
  email: string
  joinedAt: string
  role: string
  updatedAt: string
}

type ChallengePeriodRecord = {
  startDate: string
  endDate: string
  updatedAt: string
  updatedBy?: string
}

type ChallengePeriodRow = {
  id: number
  start_date: string
  end_date: string
  updated_at: string
  updated_by?: string | null
}

type ChallengePeriodHistoryRow = {
  id: number
  start_date: string
  end_date: string
  saved_at: string
  saved_by: string | null
}

type ParticipantRow = {
  id: number
  name: string | null
  email: string
  joined_at: string | null
  role: string | null
  start_date?: string | null
  end_date?: string | null
}

type ParticipantStatus = 'active' | 'expired' | 'upcoming' | 'unknown'

type ParticipantRecord = {
  id: number
  name: string
  email: string
  joinedAt: string
  role: string
  startDate?: string
  endDate?: string
  status: ParticipantStatus
}

type UserRow = {
  id: number
  name: string | null
  email: string
  role: string | null
  last_login: string | null
}

type UserRecord = {
  id: number
  name: string
  email: string
  role: string
  lastLogin: string | null
}

type ParticipantListOptions = {
  role?: string
  referenceDate?: string
}

type ParticipantStatusSummary = {
  total: number
  active: number
  expired: number
  upcoming: number
}

type ChallengePeriodSummary = ChallengePeriodRecord & { id: number }

type ChallengeDayState = {
  day: number
  start: string
  end: string
  isActiveDay: boolean
  isUpcoming: boolean
  isClosed: boolean
}

type ChallengeTimeline = {
  start: string
  end: string
  now: string
  activeDay: number | null
  expired: boolean
  upcoming: boolean
  days: ChallengeDayState[]
}

type ChallengeDayDeadline = {
  day: number
  startAt: string
  endAt: string
  updatedAt?: string
}

type ChallengeDayDeadlineRow = {
  day: number
  start_time: string
  end_time: string
  updated_at: string
}

const ADMIN_SESSION_COOKIE = 'admin_session'
const ADMIN_SESSION_ISSUER = 'easy-image-editor'
const ADMIN_SESSION_AUDIENCE = 'easy-image-editor/admin'
const ADMIN_RATE_LIMIT_KEY_PREFIX = 'ratelimit:admin-login:'
const DEFAULT_ADMIN_RATE_LIMIT_MAX_ATTEMPTS = 5
const DEFAULT_ADMIN_RATE_LIMIT_WINDOW_SECONDS = 60
const DEFAULT_ADMIN_RATE_LIMIT_COOLDOWN_SECONDS = 300
const PARTICIPANT_KEY_PREFIX = 'participant:'
const REQUIRED_SUBMISSIONS = 15
const CHALLENGE_DAY_MS = 24 * 60 * 60 * 1000
const CHALLENGE_TIMEZONE_OFFSET_MINUTES = 9 * 60
const CHALLENGE_TIMEZONE_OFFSET_MS = CHALLENGE_TIMEZONE_OFFSET_MINUTES * 60 * 1000
const CHALLENGE_TIMEZONE_SUFFIX = (() => {
  const sign = CHALLENGE_TIMEZONE_OFFSET_MINUTES >= 0 ? '+' : '-'
  const absolute = Math.abs(CHALLENGE_TIMEZONE_OFFSET_MINUTES)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const minutes = String(absolute % 60).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
})()
const CHALLENGE_DURATION_BUSINESS_DAYS = 15
const GOOGLE_OAUTH_REDIRECT_URI = 'https://image-editor-3.pages.dev/api/auth/callback/google'
const DEFAULT_GOOGLE_REDIRECT_URI = GOOGLE_OAUTH_REDIRECT_URI
const ADMIN_OAUTH_STATE_COOKIE = 'admin_oauth_state'
const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state'
const SESSION_COOKIE_NAME = '__session'
const MICHINA_PERIOD_KEY = 'michina:period'
const MICHINA_PERIOD_HISTORY_KEY = 'michina:period:history'
const MICHINA_CHALLENGERS_KEY = 'michina:challengers'
const MICHINA_USERS_KEY = 'michina:users'
const MAX_PERIOD_HISTORY_ITEMS = 30

function renderCommunityDashboardPage() {
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#fef568" />
    <meta
      name="description"
      content="Elliesbang Image Editor와 함께하는 3주(15일) 미치나 챌린지를 공개 미리보기 모드에서 체험해보세요."
    />
    <title>미치나 커뮤니티 대시보드</title>
    <base href="/" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" />
    <link
      href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/static/community-dashboard.css" />
  </head>
  <body>
    <header class="dashboard-header">💡 미치나 커뮤니티</header>
    <main class="dashboard-container">
      <section class="dashboard-card">
        <h2>미치나 전체 챌린저 현황</h2>
        <p class="dashboard-card__meta">전체 챌린저의 주차별 제출률을 확인하세요.</p>
        <canvas id="overallProgressChart" aria-label="미치나 전체 챌린저 주차별 제출률" role="img"></canvas>
      </section>

      <section class="dashboard-card">
        <h2>인기 키워드</h2>
        <p class="dashboard-card__meta">#디자인 #AI #챌린지 #미리캔버스</p>
        <p class="dashboard-section-copy">커뮤니티에서 가장 많이 언급되는 키워드를 확인해보세요.</p>
      </section>

      <section class="dashboard-card">
        <h2>오늘의 미션 제출</h2>
        <p class="dashboard-card__meta">각 일차는 하루에 한 번만 제출할 수 있어요.</p>
        <form class="dashboard-form" data-role="submission-form">
          <div class="form-field">
            <label for="michina-day-select">도전 일차</label>
            <select id="michina-day-select" data-role="day-select" aria-label="미션 일차 선택"></select>
          </div>
          <div class="form-field">
            <label for="michina-file-input">이미지 업로드</label>
            <input id="michina-file-input" type="file" accept="image/*" data-role="file-input" />
          </div>
          <button type="submit">오늘 미션 제출</button>
        </form>
      </section>

      <section class="dashboard-card mission-status-card">
        <h2>미션 완주 현황</h2>
        <p id="missionStatus" class="mission-status">0 / 15일차 완료 · 0%</p>
        <div class="progress-bar" aria-hidden="true">
          <div class="progress-fill"></div>
        </div>
        <div class="status-details">
          <p><strong>제출한 일차:</strong> <span id="submittedDays">-</span></p>
          <p><strong>미제출 일차:</strong> <span id="unsubmittedDays">1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15</span></p>
        </div>
        <button type="button" class="certificate-button hidden" data-role="certificate-button">수료증 다시 보기</button>
      </section>

      <section class="dashboard-card">
        <h2>미션 진행 안내</h2>
        <ul class="dashboard-section-copy" role="list">
          <li>· 15일차까지 모두 제출하면 자동으로 수료증이 발급돼요.</li>
          <li>· 공개 미리보기 모드는 이 기기에서만 진행률이 저장돼요.</li>
          <li>· 필요할 때 언제든 “수료증 다시 보기” 버튼으로 PNG를 재다운로드할 수 있어요.</li>
        </ul>
      </section>
    </main>
    <footer class="footer">© 엘리의방 | elliesbang</footer>

    <div class="certificate-canvas-wrapper" data-role="certificate-canvas">
      <div class="certificate-template" data-role="certificate-template">
        <h3>🎉 Elliesbang Michina Challenge 수료증</h3>
        <p data-role="certificate-date">수료일: -</p>
        <p>Elliesbang Image Editor</p>
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js" integrity="sha384-PST0s43x0oMdHF2G28clmTa/sJ8KPxONQDX/PDQ3VwNa0nCE3awPJn9eo6HozXEI" crossorigin="anonymous"></script>
    <script type="module" src="/static/community-dashboard.js"></script>
  </body>
</html>`
}

function renderAdminManagementPage() {
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>관리자 대시보드 | 미치나 챌린지 관리</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet" />
    <script>
      window.tailwind = window.tailwind || {}
      window.tailwind.config = {
        theme: {
          extend: {
            colors: {
              primary: '#fef568',
              ivory: '#f5eee9',
            },
            fontFamily: {
              pretendard: ['Pretendard', 'sans-serif'],
            },
            boxShadow: {
              ellie: '0 25px 50px -12px rgba(250, 204, 21, 0.35)',
            },
          },
        },
      }
    </script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background-color: #f5eee9;
        color: #4f3b0f;
      }
      .admin-container {
        min-height: 100vh;
        padding: 56px 16px 80px;
        display: block;
      }
      .admin-header {
        width: 100%;
        max-width: 900px;
        background-color: #fff6dc;
        border: 1px solid #f0dba5;
        border-radius: 20px;
        padding: 32px 28px;
        text-align: center;
        box-shadow: 0 18px 48px rgba(116, 94, 38, 0.14);
        margin: 0 auto 32px;
      }
      .admin-header__actions {
        margin-top: 20px;
        text-align: center;
      }
      .admin-header__actions > * {
        display: inline-block;
        margin: 6px 8px;
      }
      .admin-dashboard {
        width: 100%;
        max-width: 900px;
        background-color: #f5eee9;
        padding: 40px;
        border-radius: 20px;
        display: block;
        box-shadow: 0 20px 60px rgba(116, 94, 38, 0.12);
        margin: 0 auto;
      }
      .admin-dashboard > section + section {
        margin-top: 32px;
      }
      .admin-footer {
        width: 100%;
        max-width: 900px;
        text-align: center;
        font-size: 0.75rem;
        color: #7a5a00;
        border-top: 1px solid #f0dba5;
        padding-top: 20px;
        margin: 32px auto 0;
      }
      .admin-section {
        background-color: #fffaf0;
        border: 1px solid #f0dba5;
        border-radius: 18px;
        padding: 28px;
        box-shadow: 0 15px 40px rgba(116, 94, 38, 0.1);
      }
      .admin-section h2 {
        font-size: 1.25rem;
        font-weight: 700;
        color: #3f2f00;
        margin-bottom: 10px;
      }
      .admin-section p {
        color: #6f5a26;
        font-size: 0.95rem;
        line-height: 1.6;
      }
      .admin-form-fields {
        display: block;
      }
      .admin-form-fields .admin-label + .admin-label {
        margin-top: 16px;
      }
      @media (min-width: 768px) {
        .admin-form-fields {
          column-count: 2;
          column-gap: 24px;
        }
        .admin-form-fields .admin-label {
          break-inside: avoid;
        }
      }
      .admin-label {
        display: block;
        font-size: 0.95rem;
        font-weight: 600;
        color: #4f3b0f;
      }
      .admin-label > .admin-input,
      .admin-label > .admin-file-input {
        margin-top: 8px;
      }
      .admin-input,
      .admin-file-input {
        border: 1px solid #f0dba5;
        background-color: #fefdf4;
        border-radius: 16px;
        padding: 12px 14px;
        font-size: 0.95rem;
        color: #3f2f00;
        box-shadow: inset 0 1px 3px rgba(240, 219, 165, 0.65);
      }
      .admin-file-input {
        cursor: pointer;
        border-style: dashed;
        transition: border-color 0.2s ease;
      }
      .admin-file-input:hover,
      .admin-file-input:focus {
        border-color: #fef568;
        outline: none;
      }
      .admin-form-actions {
        margin-top: 20px;
        text-align: center;
      }
      .admin-form-note {
        margin-bottom: 12px;
        font-size: 0.85rem;
        color: #8c7a4f;
      }
      button {
        background-color: #fef568;
        color: #333;
        border: none;
        border-radius: 12px;
        padding: 10px 18px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      button:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 18px rgba(116, 94, 38, 0.18);
      }
      button:focus-visible {
        outline: 3px solid rgba(254, 245, 104, 0.6);
        outline-offset: 2px;
      }
      .admin-stats-card,
      .admin-table {
        border-radius: 16px;
        border: 1px solid #f0dba5;
        background-color: rgba(254, 253, 244, 0.7);
        padding: 20px;
        margin-top: 24px;
      }
      .admin-card-title {
        text-align: center;
        font-size: 0.95rem;
        font-weight: 600;
        color: #4f3b0f;
        margin-bottom: 12px;
      }
      .admin-card-button {
        display: block;
        margin: 0 auto 16px;
        width: fit-content;
      }
      .admin-table table {
        width: 100%;
        border-collapse: collapse;
      }
      .admin-table th,
      .admin-table td {
        padding: 12px 16px;
        border-bottom: 1px solid rgba(240, 219, 165, 0.8);
        text-align: left;
        font-size: 0.95rem;
        color: #3f2f00;
      }
      .admin-table thead {
        background-color: rgba(254, 245, 104, 0.45);
        text-transform: uppercase;
        font-size: 0.8rem;
        letter-spacing: 0.04em;
        color: #4f3b0f;
      }
      .admin-table__empty,
      .admin-table__helper,
      .admin-period__helper {
        font-size: 0.8rem;
        color: #7a5a00;
        margin-top: 6px;
      }
      .admin-period__helper {
        color: #8c7a4f;
      }
      .admin-count-pill {
        display: inline-block;
        text-align: center;
        padding: 6px 12px;
        border-radius: 999px;
        background-color: rgba(254, 245, 104, 0.8);
        font-size: 0.8rem;
        font-weight: 600;
        color: #3f2f00;
      }
      .admin-count-pill--center {
        display: block;
        width: fit-content;
        margin: 0 auto 12px;
      }
    </style>
  </head>
  <body data-admin-email="${ADMIN_LOGIN_EMAIL}" class="bg-[#f5eee9] text-[#4f3b0f]">
    <div class="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
      <div
        data-role="dashboard-toast"
        class="hidden w-full max-w-sm rounded-2xl bg-[#333]/90 px-5 py-4 text-sm font-medium text-white shadow-2xl backdrop-blur"
        role="status"
        aria-live="assertive"
      ></div>
    </div>
    <div class="admin-container">
      <header class="admin-header">
        <h1 class="text-3xl font-bold text-[#5b4100] md:text-4xl">관리자 대시보드</h1>
        <p data-role="welcome" class="mt-3 text-sm text-[#6f5a26]">관리자 전용 대시보드 영역입니다.</p>
        <div class="admin-header__actions">
          <span data-role="session-info" class="admin-count-pill uppercase tracking-[0.16em]">세션 정보 확인 중</span>
          <button type="button" data-role="logout">로그아웃</button>
        </div>
      </header>
      <main class="admin-dashboard">
        <section id="michina-period" data-role="dashboard-section" class="challenge-period-section admin-section">
          <h2>📅 챌린지 기간 설정</h2>
          <p class="admin-period__helper">시작일과 종료일을 입력해 챌린지 운영 기간을 저장하세요.</p>
          <form data-role="period-form" class="mt-6">
            <div class="admin-form-fields">
              <label class="admin-label">
                시작일
                <input type="date" required data-role="period-start" class="admin-input" />
              </label>
              <label class="admin-label">
                종료일
                <input type="date" required data-role="period-end" class="admin-input" />
              </label>
            </div>
            <div class="admin-form-actions">
              <p data-role="period-message" class="admin-form-note admin-period__helper">챌린지 기간을 입력한 뒤 저장하기 버튼을 눌러주세요.</p>
              <button type="submit" data-role="period-submit">저장하기</button>
            </div>
          </form>
          <div class="admin-stats-card">
            <h3 class="admin-card-title">저장된 챌린지 기간 목록</h3>
            <button type="button" data-role="period-clear" class="admin-card-button">전체 초기화</button>
            <p data-role="period-list-empty" class="admin-table__helper">저장된 챌린지 기간이 없습니다.</p>
            <ul data-role="period-list" class="mt-3 space-y-2"></ul>
          </div>
        </section>
        <section id="michina-upload" data-role="dashboard-section" class="participant-upload-section admin-section">
          <h2>📂 참가자 명단 업로드</h2>
          <p data-role="upload-hint">CSV 파일(name,email)을 업로드하면 참가자 명단이 저장됩니다.</p>
          <form data-role="participants-form" class="mt-6">
            <label class="admin-label">
              CSV 파일 선택
              <input
                type="file"
                accept=".csv,text/csv"
                data-role="participants-file"
                class="admin-file-input"
              />
            </label>
            <div class="admin-form-actions">
              <span data-role="participants-filename" class="admin-form-note admin-table__helper">선택된 파일이 없습니다.</span>
              <button type="submit" data-role="participants-upload">명단 업로드</button>
            </div>
          </form>
          <p data-role="participants-status" class="admin-table__helper">CSV 파일을 선택하면 상태가 표시됩니다.</p>
          <div class="admin-table">
            <h3 class="admin-card-title">업로드된 참가자</h3>
            <span data-role="participants-count" class="admin-count-pill admin-count-pill--center">0명</span>
            <p data-role="participants-message" class="admin-table__helper">등록된 참가자 정보가 없습니다.</p>
            <div class="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-[#f0dba5] bg-white">
              <table>
                <thead>
                  <tr>
                    <th scope="col">이름</th>
                    <th scope="col">이메일</th>
                    <th scope="col">최근 등록일</th>
                  </tr>
                </thead>
                <tbody data-role="participants-table">
                  <tr>
                    <td colspan="3" class="text-center text-sm text-[#7a5a00]">등록된 참가자 정보가 없습니다.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
      <footer class="admin-footer">
        &copy; ${new Date().getFullYear()} Ellie Image Editor. All rights reserved.
      </footer>
    </div>
    <script type="module" src="/static/dashboard.js"></script>
  </body>
</html>`


  const response = c.html(dashboardPage)
  response.headers.set('Cache-Control', 'no-store')
  return response
})

app.get('/admin-dashboard', (c) => c.redirect('/dashboard'))

app.get('/api/health', (c) => c.json({ status: 'ok' }))

export default app
