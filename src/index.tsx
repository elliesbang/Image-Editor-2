import { Hono } from 'hono'
import type { Context } from 'hono'
import { serveStatic } from 'hono/cloudflare-pages'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { renderer } from './renderer'
import { registerAuthRoutes } from '../routes/auth.js'

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
  DB: D1Database
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
}

type ChallengePeriodRow = {
  id: number
  start_date: string
  end_date: string
  updated_at: string
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
const DEFAULT_GOOGLE_REDIRECT_URI = 'https://project-9cf3a0d0.pages.dev/api/auth/callback/google'
const ADMIN_OAUTH_STATE_COOKIE = 'admin_oauth_state'
const MICHINA_PERIOD_KEY = 'michina:period'
const MICHINA_CHALLENGERS_KEY = 'michina:challengers'
const MICHINA_USERS_KEY = 'michina:users'

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
      }
    </style>
  </head>
  <body class="min-h-screen bg-ivory text-gray-800 font-pretendard">
    <div class="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 md:px-10 md:py-12">
      <header class="mb-10 flex flex-col gap-5 rounded-3xl border border-yellow-100 bg-white/80 p-6 shadow-ellie backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-3xl font-bold text-[#5b4100] md:text-4xl">관리자 대시보드</h1>
          <p class="mt-2 text-sm text-[#6f5a26]">
            엘리의방 감성으로 미치나 챌린지를 관리하고, 전체 사용자 데이터를 한눈에 확인하세요.
          </p>
        </div>
        <button
          type="button"
          data-action="logout"
          class="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-gray-900 shadow-md transition hover:-translate-y-0.5 hover:bg-[#fbe743] hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          로그아웃
        </button>
      </header>
      <main class="flex-1">
        <div class="flex flex-col gap-6 lg:flex-row">
          <aside class="lg:w-64">
            <nav class="sticky top-10 space-y-6 rounded-3xl border border-yellow-100 bg-white/80 p-6 shadow-ellie backdrop-blur">
              <div>
                <h2 class="text-sm font-semibold uppercase tracking-[0.25em] text-[#6f5a26]">카테고리</h2>
                <ul class="mt-4 space-y-2 text-sm font-medium text-[#5b4100]">
                  <li>
                    <a href="#michina-section" class="flex items-center justify-between rounded-xl bg-primary/80 px-4 py-2 text-[#3f2f00] transition hover:bg-[#fbe743]">
                      <span>미치나</span>
                      <span class="text-xs">전용</span>
                    </a>
                  </li>
                  <li>
                    <a href="#database-section" class="flex items-center justify-between rounded-xl bg-white/70 px-4 py-2 text-[#6f5a26] transition hover:bg-primary/40">
                      <span>전체 디비</span>
                      <span class="text-xs">데이터</span>
                    </a>
                  </li>
                </ul>
              </div>
              <div class="rounded-2xl bg-ivory/70 p-4 text-xs text-[#6f5a26] shadow-inner">
                <p class="font-semibold text-[#4f3b0f]">Tip</p>
                <p class="mt-2 leading-relaxed">미치나 카테고리에는 챌린지 기간 · 참여 현황 · 명단 관리가 정리되어 있습니다.</p>
              </div>
            </nav>
          </aside>
          <div class="flex-1 space-y-6">
            <section id="michina-section" class="rounded-3xl border border-yellow-100 bg-white/90 p-6 shadow-ellie backdrop-blur">
              <div class="space-y-8">
                <div>
                  <h2 class="text-lg font-semibold text-gray-900">📊 미치나 챌린저 관리</h2>
                  <p class="mt-1 text-sm text-[#6f5a26]">챌린지 기간과 참여 현황, 명단을 한 곳에서 관리하세요.</p>
                </div>
                <div class="space-y-3 rounded-lg border border-[#f5eee9] bg-white/70 p-4 shadow-inner">
                  <h3 class="text-base font-medium text-gray-800">📅 챌린지 기간 설정</h3>
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      id="startDate"
                      type="date"
                      class="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/60"
                    />
                    <input
                      id="endDate"
                      type="date"
                      class="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/60"
                    />
                    <button
                      id="savePeriodBtn"
                      type="button"
                      class="whitespace-nowrap rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-[#fbe743] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      저장
                    </button>
                  </div>
                  <p id="periodStatus" class="text-sm text-gray-600"></p>
                </div>
                <div class="space-y-3 rounded-lg border border-[#f5eee9] bg-white/70 p-4 shadow-inner">
                  <h3 class="text-base font-medium text-gray-800">📈 참여 현황</h3>
                  <p id="statusPeriod" class="text-sm text-gray-600"></p>
                  <div id="michinaStats" class="flex flex-col justify-between gap-3 text-center sm:flex-row">
                    <div class="flex-1 rounded-lg bg-white/90 p-4 shadow-sm">
                      <p class="text-xs font-semibold uppercase tracking-wide text-[#8c731e]">총 인원</p>
                      <p id="totalCount" class="mt-2 text-2xl font-bold text-primary">0</p>
                    </div>
                    <div class="flex-1 rounded-lg bg-white/90 p-4 shadow-sm">
                      <p class="text-xs font-semibold uppercase tracking-wide text-[#3f6212]">활성 인원</p>
                      <p id="activeCount" class="mt-2 text-2xl font-bold text-green-500">0</p>
                    </div>
                    <div class="flex-1 rounded-lg bg-white/90 p-4 shadow-sm">
                      <p class="text-xs font-semibold uppercase tracking-wide text-[#9a3412]">종료 인원</p>
                      <p id="expiredCount" class="mt-2 text-2xl font-bold text-red-400">0</p>
                    </div>
                  </div>
                  <p id="statusMessage" class="text-sm text-gray-600"></p>
                </div>
                <div class="space-y-3 rounded-lg border border-[#f5eee9] bg-white/70 p-4 shadow-inner">
                  <h3 class="text-base font-medium text-gray-800">📂 미치나 명단 관리</h3>
                  <div class="flex flex-col gap-3">
                    <input
                      id="csvUpload"
                      type="file"
                      accept=".csv"
                      class="block w-full cursor-pointer rounded-lg border border-dashed border-yellow-200 bg-ivory/60 px-4 py-4 text-sm text-gray-600 transition file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:font-semibold file:text-gray-900 hover:border-primary hover:bg-white"
                    />
                    <p id="uploadFilename" class="text-sm text-gray-500">선택된 파일이 없습니다.</p>
                    <div class="flex flex-col gap-2 sm:flex-row">
                      <button
                        id="uploadBtn"
                        type="button"
                        class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-[#fbe743] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        명단 업로드
                      </button>
                      <button
                        id="deleteListBtn"
                        type="button"
                        class="rounded-lg bg-red-400 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                      >
                        명단 전체 삭제
                      </button>
                    </div>
                    <p id="uploadStatus" class="text-sm text-gray-600"></p>
                  </div>
                </div>
              </div>
            </section>
            <section id="database-section" class="space-y-6">
              <div class="rounded-3xl border border-yellow-100 bg-white/90 p-6 shadow-ellie backdrop-blur">
                <div class="mb-4 flex items-center justify-between gap-4">
                  <h2 class="flex items-center gap-2 text-lg font-semibold text-gray-900">
                    <span class="text-xl">👥</span>
                    전체 사용자 DB 조회
                  </h2>
                  <span class="rounded-full bg-primary/60 px-3 py-1 text-xs font-semibold text-[#5b4100]">
                    실시간 조회
                  </span>
                </div>
                <div class="overflow-hidden rounded-2xl border border-yellow-100 bg-white">
                  <div class="grid gap-3 border-b border-yellow-100 bg-ivory/70 p-4 text-sm text-gray-700" data-role="users-breakdown"></div>
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-sm text-gray-700">
                      <thead class="bg-ivory/80 text-gray-700">
                        <tr>
                          <th class="px-4 py-3 font-semibold">이름</th>
                          <th class="px-4 py-3 font-semibold">이메일</th>
                          <th class="px-4 py-3 font-semibold">등급</th>
                          <th class="px-4 py-3 font-semibold">최근 로그인</th>
                        </tr>
                      </thead>
                      <tbody id="userTableBody"></tbody>
                    </table>
                </div>
              </div>
              <p class="rounded-xl bg-ivory/70 px-3 py-2 text-sm font-medium text-gray-700 shadow-inner" data-role="users-status" hidden></p>
              <div class="rounded-3xl border border-yellow-100 bg-white/90 p-6 shadow-ellie backdrop-blur">
                <h2 class="mb-3 flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <span class="text-xl">🗂️</span>
                  데이터 관리 가이드
                </h2>
                <ul class="space-y-2 text-sm text-[#6f5a26]">
                  <li class="flex items-start gap-2">
                    <span class="mt-1 inline-flex h-2 w-2 flex-shrink-0 rounded-full bg-primary"></span>
                    기간 변경 후에는 명단을 다시 확인해 최신 상태를 유지하세요.
                  </li>
                  <li class="flex items-start gap-2">
                    <span class="mt-1 inline-flex h-2 w-2 flex-shrink-0 rounded-full bg-primary"></span>
                    CSV 업로드는 UTF-8 인코딩을 사용하고, 이메일 열이 반드시 포함되어야 합니다.
                  </li>
                  <li class="flex items-start gap-2">
                    <span class="mt-1 inline-flex h-2 w-2 flex-shrink-0 rounded-full bg-primary"></span>
                    사용자 DB는 실시간으로 갱신되므로 새로고침 없이도 최신 정보를 확인할 수 있습니다.
                  </li>
                </ul>
              </div>
            </section>
          </div>
        </div>
      </main>
      <div
        class="pointer-events-none fixed bottom-6 right-6 hidden rounded-2xl bg-gray-900/90 px-4 py-3 text-sm font-semibold text-white shadow-xl"
        data-role="admin-toast"
        hidden
      ></div>
    </div>
    <script type="module" src="/static/admin-lite.js"></script>
  </body>
</html>`
}



const inMemoryStore = new Map<string, string>()
const inMemoryBackupStore = new Map<string, string>()
const rateLimitMemoryStore = new Map<string, RateLimitRecord>()

function encodeKey(email: string) {
  return `${PARTICIPANT_KEY_PREFIX}${email.toLowerCase()}`
}

function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

function parsePositiveInteger(value: string | undefined, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const trimmed = (value ?? '').trim()
  const parsed = Number.parseInt(trimmed, 10)
  const boundedFallback = Math.min(Math.max(fallback, min), max)
  if (!Number.isFinite(parsed) || parsed < min) {
    return boundedFallback
  }
  return Math.min(Math.max(parsed, min), max)
}

function getFixedWindowBoundaries(now: number, windowSeconds: number) {
  const normalizedWindowSeconds = Math.max(1, Math.floor(windowSeconds))
  const windowMs = normalizedWindowSeconds * 1000
  const windowStart = Math.floor(now / windowMs) * windowMs
  return {
    windowStart,
    windowEnd: windowStart + windowMs,
  }
}

function validateAdminEnvironment(env: Bindings): AdminConfigValidationResult {
  const issues: string[] = []

  const emailRaw = env.ADMIN_EMAIL?.trim().toLowerCase() ?? ''
  if (!emailRaw) {
    issues.push('ADMIN_EMAIL is not configured')
  } else if (!isValidEmail(emailRaw)) {
    issues.push('ADMIN_EMAIL must be a valid email address')
  }

  const sessionSecretRaw = env.SESSION_SECRET?.trim() ?? ''
  if (!sessionSecretRaw) {
    issues.push('SESSION_SECRET is not configured')
  } else if (sessionSecretRaw.length < 32) {
    issues.push('SESSION_SECRET must be at least 32 characters')
  }

  const sessionVersionRaw = env.ADMIN_SESSION_VERSION?.trim() ?? '1'
  if (!sessionVersionRaw) {
    issues.push('ADMIN_SESSION_VERSION must not be empty')
  } else if (sessionVersionRaw.length > 32) {
    issues.push('ADMIN_SESSION_VERSION must be 32 characters or fewer')
  }

  if (issues.length > 0) {
    return { config: null, issues }
  }

  return {
    config: {
      email: emailRaw,
      sessionSecret: sessionSecretRaw,
      sessionVersion: sessionVersionRaw,
    },
    issues,
  }
}

function getAdminConfig(env: Bindings): AdminConfig | null {
  const validation = validateAdminEnvironment(env)
  return validation.config
}

function getAdminRateLimitConfig(env: Bindings): AdminRateLimitConfig {
  const windowSeconds = parsePositiveInteger(
    env.ADMIN_RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_ADMIN_RATE_LIMIT_WINDOW_SECONDS,
    10,
    3600,
  )
  const cooldownSeconds = parsePositiveInteger(
    env.ADMIN_RATE_LIMIT_COOLDOWN_SECONDS,
    DEFAULT_ADMIN_RATE_LIMIT_COOLDOWN_SECONDS,
    windowSeconds,
    7200,
  )
  const maxAttempts = parsePositiveInteger(
    env.ADMIN_RATE_LIMIT_MAX_ATTEMPTS,
    DEFAULT_ADMIN_RATE_LIMIT_MAX_ATTEMPTS,
    1,
    20,
  )
  return {
    maxAttempts,
    windowSeconds,
    cooldownSeconds,
  }
}

function buildRateLimitKey(identifier: string) {
  return `${ADMIN_RATE_LIMIT_KEY_PREFIX}${identifier}`
}

async function readRateLimitRecord(env: Bindings, key: string): Promise<RateLimitRecord | null> {
  const now = Date.now()

  const sanitize = (record: Partial<RateLimitRecord> | null): RateLimitRecord | null => {
    if (!record) {
      return null
    }
    if (
      typeof record.count !== 'number' ||
      typeof record.windowStart !== 'number' ||
      typeof record.windowEnd !== 'number'
    ) {
      return null
    }
    if (!Number.isFinite(record.windowStart) || !Number.isFinite(record.windowEnd)) {
      return null
    }
    if (record.windowEnd <= record.windowStart) {
      return null
    }
    const sanitized: RateLimitRecord = {
      count: Math.max(0, Math.floor(record.count)),
      windowStart: record.windowStart,
      windowEnd: record.windowEnd,
    }
    if (typeof record.blockedUntil === 'number' && Number.isFinite(record.blockedUntil) && record.blockedUntil > now) {
      sanitized.blockedUntil = record.blockedUntil
    }
    if (sanitized.windowEnd <= now && !sanitized.blockedUntil) {
      return null
    }
    return sanitized
  }

  const kvStores: Array<{ store: KVNamespace; isPrimary: boolean }> = []
  if (env.CHALLENGE_KV) {
    kvStores.push({ store: env.CHALLENGE_KV, isPrimary: true })
  }
  if (env.CHALLENGE_KV_BACKUP) {
    kvStores.push({ store: env.CHALLENGE_KV_BACKUP, isPrimary: false })
  }

  let kvRecord: RateLimitRecord | null = null
  let kvSource: 'primary' | 'backup' | null = null

  for (const { store, isPrimary } of kvStores) {
    const raw = await store.get(key)
    if (!raw) {
      continue
    }
    let parsed: RateLimitRecord | null = null
    try {
      parsed = sanitize(JSON.parse(raw) as Partial<RateLimitRecord>)
    } catch (error) {
      parsed = null
    }
    if (!parsed) {
      await store.delete(key).catch(() => {})
      continue
    }
    kvRecord = parsed
    kvSource = isPrimary ? 'primary' : 'backup'
    break
  }

  if (kvRecord) {
    if (kvSource === 'backup' && env.CHALLENGE_KV) {
      await writeRateLimitRecord(env, key, kvRecord)
    }
    return kvRecord
  }

  const memoryRecord = rateLimitMemoryStore.get(key)
  if (!memoryRecord) {
    return null
  }
  const sanitizedMemory = sanitize(memoryRecord)
  if (!sanitizedMemory) {
    rateLimitMemoryStore.delete(key)
    return null
  }
  rateLimitMemoryStore.set(key, sanitizedMemory)
  return sanitizedMemory
}

async function writeRateLimitRecord(env: Bindings, key: string, record: RateLimitRecord) {
  const now = Date.now()
  const payload: RateLimitRecord = {
    count: Math.max(0, Math.floor(record.count)),
    windowStart: record.windowStart,
    windowEnd: record.windowEnd,
  }

  if (typeof record.blockedUntil === 'number' && record.blockedUntil > now) {
    payload.blockedUntil = record.blockedUntil
  }

  const expiryTarget = Math.max(payload.blockedUntil ?? 0, payload.windowEnd)
  const ttlSeconds = Math.max(1, Math.ceil((expiryTarget - now) / 1000))
  const serialized = JSON.stringify(payload)
  const primary = env.CHALLENGE_KV
  const backup = env.CHALLENGE_KV_BACKUP

  if (primary) {
    await primary.put(key, serialized, { expirationTtl: ttlSeconds })
  }
  if (backup) {
    await backup.put(key, serialized, { expirationTtl: ttlSeconds })
  }

  if (!primary && !backup) {
    rateLimitMemoryStore.set(key, { ...payload })
  }
}

async function clearRateLimitRecord(env: Bindings, key: string) {
  if (env.CHALLENGE_KV) {
    await env.CHALLENGE_KV.delete(key)
  }
  if (env.CHALLENGE_KV_BACKUP) {
    await env.CHALLENGE_KV_BACKUP.delete(key)
  }
  rateLimitMemoryStore.delete(key)
}

async function getAdminRateLimitStatus(env: Bindings, identifier: string, config: AdminRateLimitConfig): Promise<RateLimitStatus> {
  const key = buildRateLimitKey(identifier)
  const now = Date.now()
  const record = await readRateLimitRecord(env, key)
  if (!record) {
    return {
      blocked: false,
      remaining: config.maxAttempts,
      resetAfterSeconds: config.windowSeconds,
    }
  }

  const blocked = typeof record.blockedUntil === 'number' && record.blockedUntil > now
  const resetTarget = blocked ? record.blockedUntil! : record.windowEnd

  if (!blocked && record.windowEnd <= now) {
    await clearRateLimitRecord(env, key)
    return {
      blocked: false,
      remaining: config.maxAttempts,
      resetAfterSeconds: config.windowSeconds,
    }
  }

  const remaining = blocked ? 0 : Math.max(0, config.maxAttempts - record.count)
  const resetAfterSeconds = Math.max(1, Math.ceil((resetTarget - now) / 1000))

  return {
    blocked,
    remaining,
    resetAfterSeconds,
    retryAfterSeconds: blocked ? resetAfterSeconds : undefined,
  }
}

async function recordAdminLoginFailure(env: Bindings, identifier: string, config: AdminRateLimitConfig): Promise<RateLimitStatus> {
  const key = buildRateLimitKey(identifier)
  const now = Date.now()
  const { windowStart, windowEnd } = getFixedWindowBoundaries(now, config.windowSeconds)

  let record = await readRateLimitRecord(env, key)
  if (!record || record.windowEnd <= now || record.windowStart !== windowStart) {
    record = {
      count: 0,
      windowStart,
      windowEnd,
    }
  }

  record.count = Math.min(config.maxAttempts, record.count + 1)

  if (record.count >= config.maxAttempts) {
    const cooldownUntil = now + config.cooldownSeconds * 1000
    record.blockedUntil = Math.max(record.blockedUntil ?? 0, windowEnd, cooldownUntil)
  }

  await writeRateLimitRecord(env, key, record)

  const blocked = typeof record.blockedUntil === 'number' && record.blockedUntil > now
  const resetTarget = blocked ? record.blockedUntil! : record.windowEnd
  const remaining = blocked ? 0 : Math.max(0, config.maxAttempts - record.count)
  const resetAfterSeconds = Math.max(1, Math.ceil((resetTarget - now) / 1000))

  return {
    blocked,
    remaining,
    resetAfterSeconds,
    retryAfterSeconds: blocked ? resetAfterSeconds : undefined,
  }
}

async function clearAdminRateLimit(env: Bindings, identifier: string) {
  const key = buildRateLimitKey(identifier)
  await clearRateLimitRecord(env, key)
}

function attachRateLimitHeaders(response: Response, config: AdminRateLimitConfig, status: RateLimitStatus) {
  response.headers.set('X-RateLimit-Limit', String(config.maxAttempts))
  response.headers.set('X-RateLimit-Remaining', String(Math.max(0, status.remaining)))
  response.headers.set('X-RateLimit-Reset', String(Math.max(0, Math.ceil(status.resetAfterSeconds))))
  response.headers.set('X-RateLimit-Window', String(config.windowSeconds))
  response.headers.set('X-RateLimit-Cooldown', String(config.cooldownSeconds))
  if (status.blocked && status.retryAfterSeconds) {
    response.headers.set('Retry-After', String(Math.max(1, Math.ceil(status.retryAfterSeconds))))
  }
}

function getClientIdentifier(c: Context<{ Bindings: Bindings }>) {
  const headerValue =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-real-ip') ||
    c.req.header('true-client-ip') ||
    c.req.header('x-forwarded-for')
  if (headerValue) {
    const ip = headerValue.split(',')[0]?.trim()
    if (ip) {
      return ip
    }
  }
  const rawRequest = c.req.raw as Request & { cf?: { connecting_ip?: string } }
  const cfIp = rawRequest?.cf?.connecting_ip
  if (cfIp) {
    return cfIp
  }
  return 'unknown'
}

function resolveGoogleRedirectUri(c: Context<{ Bindings: Bindings }>) {
  const configured = c.env.GOOGLE_REDIRECT_URI?.trim()
  if (configured) {
    return configured
  }
  try {
    const url = new URL(c.req.url)
    return `${url.origin}/api/auth/callback/google`
  } catch (error) {
    console.warn('[auth/google] Failed to derive redirect URI from request URL', error)
    return DEFAULT_GOOGLE_REDIRECT_URI
  }
}

type GoogleIdTokenPayload = {
  aud?: string
  email?: string
  email_verified?: boolean | string
  name?: string
  given_name?: string
  picture?: string
  exp?: number | string
  iss?: string
  sub?: string
}

function normalizeBase64UrlSegment(segment: string) {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return normalized + padding
}

function decodeGoogleIdToken(token: string): GoogleIdTokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }
  const payloadSegment = normalizeBase64UrlSegment(parts[1])
  try {
    const decoded = atob(payloadSegment)
    return JSON.parse(decoded) as GoogleIdTokenPayload
  } catch (error) {
    console.error('[auth/google] Failed to decode id_token payload', error)
    return null
  }
}

function isGoogleEmailVerified(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true'
  }
  return false
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderAdminOAuthPage({
  title,
  message,
  scriptContent,
}: {
  title: string
  message: string
  scriptContent: string
}) {
  const safeTitle = escapeHtml(title)
  const safeMessage = escapeHtml(message)
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0f172a;
        color: #f8fafc;
      }
      .card {
        padding: 24px 32px;
        border-radius: 18px;
        background: rgba(15, 23, 42, 0.86);
        border: 1px solid rgba(148, 163, 184, 0.24);
        text-align: center;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.4);
        max-width: 360px;
      }
      .card h1 {
        margin: 0 0 12px;
        font-size: 1.25rem;
      }
      .card p {
        margin: 0;
        font-size: 0.95rem;
        color: rgba(226, 232, 240, 0.82);
      }
    </style>
  </head>
  <body>
    <div class="card" role="alert" aria-live="polite">
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
    </div>
    <script>${scriptContent}</script>
  </body>
</html>`
}

function generateRandomState() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function addBusinessDays(start: Date, days: number) {
  const target = new Date(start)
  let added = 0
  while (added < days) {
    target.setDate(target.getDate() + 1)
    const day = target.getUTCDay()
    if (day !== 0 && day !== 6) {
      added += 1
    }
  }
  return target
}

async function kvGet(env: Bindings, key: string) {
  const primary = env.CHALLENGE_KV
  if (primary) {
    const value = await primary.get(key)
    if (value) {
      return value
    }
  }
  const backup = env.CHALLENGE_KV_BACKUP
  if (backup) {
    const backupValue = await backup.get(key)
    if (backupValue) {
      if (primary) {
        await primary.put(key, backupValue)
      } else {
        inMemoryStore.set(key, backupValue)
      }
      return backupValue
    }
  }
  if (!primary) {
    const memoryValue = inMemoryStore.get(key)
    if (memoryValue) {
      return memoryValue
    }
  }
  if (!backup) {
    const backupMemoryValue = inMemoryBackupStore.get(key)
    if (backupMemoryValue) {
      return backupMemoryValue
    }
  }
  return null
}

async function kvPut(env: Bindings, key: string, value: string) {
  if (env.CHALLENGE_KV) {
    await env.CHALLENGE_KV.put(key, value)
  } else {
    inMemoryStore.set(key, value)
  }

  if (env.CHALLENGE_KV_BACKUP) {
    await env.CHALLENGE_KV_BACKUP.put(key, value)
  } else if (!env.CHALLENGE_KV) {
    inMemoryBackupStore.set(key, value)
  }
}

async function kvDelete(env: Bindings, key: string) {
  if (env.CHALLENGE_KV) {
    await env.CHALLENGE_KV.delete(key)
  } else {
    inMemoryStore.delete(key)
  }

  if (env.CHALLENGE_KV_BACKUP) {
    await env.CHALLENGE_KV_BACKUP.delete(key)
  } else if (!env.CHALLENGE_KV) {
    inMemoryBackupStore.delete(key)
  }
}

function normalizeEmailValue(value: unknown) {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim().toLowerCase()
}

function isValidDateString(value: unknown) {
  if (typeof value !== 'string') {
    return false
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp)
}

function normalizeDateColumnValue(value: unknown) {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(trimmed)) {
    return trimmed.slice(0, 10)
  }
  const parsed = Date.parse(trimmed)
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10)
  }
  return ''
}

function formatChallengeDateTime(date: Date) {
  const adjusted = new Date(date.getTime() + CHALLENGE_TIMEZONE_OFFSET_MS)
  const year = adjusted.getUTCFullYear()
  const month = String(adjusted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(adjusted.getUTCDate()).padStart(2, '0')
  const hours = String(adjusted.getUTCHours()).padStart(2, '0')
  const minutes = String(adjusted.getUTCMinutes()).padStart(2, '0')
  const seconds = String(adjusted.getUTCSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${CHALLENGE_TIMEZONE_SUFFIX}`
}

function parseChallengeDate(value: string, options: { endOfDay?: boolean } = {}) {
  if (!isValidDateString(value)) {
    return null
  }
  const base = new Date(`${value}T00:00:00${CHALLENGE_TIMEZONE_SUFFIX}`)
  if (!Number.isFinite(base.valueOf())) {
    return null
  }
  if (options.endOfDay) {
    return new Date(base.getTime() + CHALLENGE_DAY_MS - 1)
  }
  return base
}

function buildChallengeTimeline(
  period: ChallengePeriodRecord,
  options: { now?: Date; requiredDays?: number } = {},
): ChallengeTimeline {
  const requiredDays = options.requiredDays ?? REQUIRED_SUBMISSIONS
  const now = options.now ?? new Date()
  const periodStart = parseChallengeDate(period.startDate)
  const periodEnd = parseChallengeDate(period.endDate, { endOfDay: true })
  if (!periodStart || !periodEnd) {
    throw new Error('INVALID_CHALLENGE_PERIOD')
  }

  const startMs = periodStart.getTime()
  const endMs = periodEnd.getTime()
  const nowMs = now.getTime()
  const days: ChallengeDayState[] = []

  for (let index = 0; index < requiredDays; index += 1) {
    const day = index + 1
    const dayStart = new Date(startMs + index * CHALLENGE_DAY_MS)
    const dayStartMs = dayStart.getTime()
    const theoreticalEnd = new Date(dayStartMs + CHALLENGE_DAY_MS - 1)
    const canOpen = dayStartMs <= endMs
    const clampedEndMs = canOpen ? Math.min(theoreticalEnd.getTime(), endMs) : theoreticalEnd.getTime()
    const effectiveEndMs = clampedEndMs < dayStartMs ? dayStartMs : clampedEndMs
    const isActiveDay = canOpen && nowMs >= dayStartMs && nowMs <= clampedEndMs
    const isUpcoming = canOpen && nowMs < dayStartMs
    const isClosed = !isActiveDay && (!canOpen || nowMs > clampedEndMs)

    days.push({
      day,
      start: formatChallengeDateTime(dayStart),
      end: formatChallengeDateTime(new Date(effectiveEndMs)),
      isActiveDay,
      isUpcoming,
      isClosed,
    })
  }

  const activeDayState = days.find((entry) => entry.isActiveDay)
  const upcoming = nowMs < startMs
  const expired = nowMs > endMs

  return {
    start: formatChallengeDateTime(periodStart),
    end: formatChallengeDateTime(periodEnd),
    now: formatChallengeDateTime(now),
    activeDay: activeDayState ? activeDayState.day : null,
    expired,
    upcoming,
    days,
  }
}

async function resolveChallengeTimeline(env: Bindings, options: { now?: Date } = {}) {
  const now = options.now ?? new Date()
  const dbBinding = env.DB
  if (!dbBinding || typeof dbBinding.prepare !== 'function') {
    return null
  }

  try {
    const period = await getChallengePeriodFromDb(dbBinding)
    if (!period) {
      return null
    }
    return buildChallengeTimeline(period, { now, requiredDays: REQUIRED_SUBMISSIONS })
  } catch (error) {
    console.error('[challenge] Failed to resolve challenge timeline', error)
    return null
  }
}

function getCurrentDateString() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeReferenceDate(value?: string) {
  if (value && isValidDateString(value)) {
    return value
  }
  return getCurrentDateString()
}

function determineParticipantStatus(startDate: string, endDate: string, referenceDate: string): ParticipantStatus {
  const ref = referenceDate
  const hasStart = Boolean(startDate)
  const hasEnd = Boolean(endDate)

  if (hasStart && startDate > ref) {
    return 'upcoming'
  }
  if (hasEnd && endDate < ref) {
    return 'expired'
  }
  if (hasStart || hasEnd) {
    return 'active'
  }
  return 'active'
}

function summarizeParticipantStatuses(participants: ParticipantRecord[]): ParticipantStatusSummary {
  const summary: ParticipantStatusSummary = { total: participants.length, active: 0, expired: 0, upcoming: 0 }
  for (const participant of participants) {
    if (participant.status === 'expired') {
      summary.expired += 1
    } else if (participant.status === 'upcoming') {
      summary.upcoming += 1
    } else {
      summary.active += 1
    }
  }
  return summary
}

function isParticipantWithinPeriod(participant: ParticipantRecord, period: ChallengePeriodSummary) {
  const periodStart = normalizeDateColumnValue(period.startDate)
  const periodEnd = normalizeDateColumnValue(period.endDate)
  if (!periodStart && !periodEnd) {
    return true
  }
  const participantStart = normalizeDateColumnValue(participant.startDate)
  const participantEnd = normalizeDateColumnValue(participant.endDate)

  const startsBeforePeriodEnd = periodEnd ? (!participantStart || participantStart <= periodEnd) : true
  const endsAfterPeriodStart = periodStart ? (!participantEnd || participantEnd >= periodStart) : true

  return startsBeforePeriodEnd && endsAfterPeriodStart
}

async function getChallengePeriodFromDb(db: D1Database): Promise<ChallengePeriodRecord | null> {
  try {
    const row = await db
      .prepare('SELECT id, start_date, end_date, updated_at FROM challenge_period WHERE id = 1')
      .first<ChallengePeriodRow>()
    if (!row) {
      return null
    }
    if (!row.start_date || !row.end_date) {
      return null
    }
    const updatedAt = typeof row.updated_at === 'string' && row.updated_at
      ? `${row.updated_at.replace(' ', 'T')}Z`
      : ''
    return {
      startDate: row.start_date,
      endDate: row.end_date,
      updatedAt,
    }
  } catch (error) {
    console.error('[d1] Failed to load challenge period', error)
    throw error
  }
}

async function saveChallengePeriodToDb(db: D1Database, startDate: string, endDate: string) {
  await db
    .prepare(
      "INSERT OR REPLACE INTO challenge_period (id, start_date, end_date, updated_at) VALUES (1, ?, ?, datetime('now'))",
    )
    .bind(startDate, endDate)
    .run()
  return getChallengePeriodFromDb(db)
}

async function listChallengePeriodsFromDb(db: D1Database): Promise<ChallengePeriodSummary[]> {
  try {
    const result = await db
      .prepare('SELECT id, start_date, end_date, updated_at FROM challenge_period ORDER BY start_date DESC, id DESC')
      .all<ChallengePeriodRow>()
    const rows = Array.isArray(result.results) ? result.results : []
    return rows
      .map((row) => {
        const startDate = normalizeDateColumnValue(row.start_date)
        const endDate = normalizeDateColumnValue(row.end_date)
        if (!startDate || !endDate) {
          return null
        }
        return {
          id: row.id,
          startDate,
          endDate,
          updatedAt: row.updated_at ? `${row.updated_at.replace(' ', 'T')}Z` : '',
        }
      })
      .filter((value): value is ChallengePeriodSummary => Boolean(value))
  } catch (error) {
    const message = String(error || '')
    if (/no such table: challenge_period/i.test(message)) {
      console.warn('[d1] challenge_period table is not available')
      return []
    }
    console.error('[d1] Failed to list challenge periods', error)
    throw error
  }
}

async function listParticipantsFromDb(db: D1Database, options: ParticipantListOptions = {}) {
  const { role, referenceDate } = options
  const whereClauses: string[] = []
  const params: unknown[] = []

  if (role) {
    whereClauses.push('role = ?')
    params.push(role)
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const query = `SELECT id, name, email, joined_at, role, start_date, end_date FROM participants ${where} ORDER BY joined_at DESC, id DESC`
  const fallbackQuery = `SELECT id, name, email, joined_at, role FROM participants ${where} ORDER BY joined_at DESC, id DESC`

  let rows: ParticipantRow[] = []

  try {
    const result = await db.prepare(query).bind(...params).all<ParticipantRow>()
    rows = Array.isArray(result.results) ? result.results : []
  } catch (error) {
    const message = String(error || '')
    if (/no such column: start_date/i.test(message) || /no such column: end_date/i.test(message)) {
      console.warn('[d1] Participant start/end date columns are not available; falling back to basic fields')
      const fallbackResult = await db.prepare(fallbackQuery).bind(...params).all<ParticipantRow>()
      rows = Array.isArray(fallbackResult.results) ? fallbackResult.results : []
    } else {
      console.error('[d1] Failed to query participants', error)
      throw error
    }
  }

  const normalizedReferenceDate = normalizeReferenceDate(referenceDate)

  return rows.map((row) => {
    const startDate = normalizeDateColumnValue(row.start_date)
    const endDate = normalizeDateColumnValue(row.end_date)
    const participant: ParticipantRecord = {
      id: row.id,
      name: (row.name ?? '').trim(),
      email: row.email,
      joinedAt: (row.joined_at ?? '').trim(),
      role: (row.role ?? '').trim() || 'free',
      status: determineParticipantStatus(startDate, endDate, normalizedReferenceDate),
    }
    if (startDate) {
      participant.startDate = startDate
    }
    if (endDate) {
      participant.endDate = endDate
    }
    return participant
  })
}

function getDatabase(env: Bindings) {
  const db = env.DB
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('D1 database binding `DB` is not configured')
  }
  return db
}

async function getMichinaPeriodRecord(env: Bindings): Promise<MichinaPeriod | null> {
  const raw = await kvGet(env, MICHINA_PERIOD_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MichinaPeriod>
    const start = typeof parsed.start === 'string' ? parsed.start : ''
    const end = typeof parsed.end === 'string' ? parsed.end : ''
    if (!start || !end) {
      return null
    }
    return {
      start,
      end,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : undefined,
    }
  } catch (error) {
    console.error('[michina] Failed to parse period record', error)
    return null
  }
}

async function saveMichinaPeriodRecord(
  env: Bindings,
  data: { start: string; end: string; updatedBy?: string },
): Promise<MichinaPeriod> {
  const record: MichinaPeriod = {
    start: data.start,
    end: data.end,
    updatedAt: new Date().toISOString(),
    updatedBy: data.updatedBy,
  }
  if (!record.updatedBy) {
    delete record.updatedBy
  }
  await kvPut(env, MICHINA_PERIOD_KEY, JSON.stringify(record))
  return record
}

async function getMichinaChallengerRecord(env: Bindings): Promise<MichinaChallengerRecord | null> {
  const raw = await kvGet(env, MICHINA_CHALLENGERS_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const normalized = parsed.map((value) => normalizeEmailValue(value)).filter(Boolean)
      return {
        challengers: Array.from(new Set(normalized)),
        updatedAt: new Date().toISOString(),
      }
    }
    if (parsed && typeof parsed === 'object') {
      const list = Array.isArray((parsed as MichinaChallengerRecord).challengers)
        ? (parsed as MichinaChallengerRecord).challengers
        : []
      const normalized = list.map((value) => normalizeEmailValue(value)).filter(Boolean)
      return {
        challengers: Array.from(new Set(normalized)),
        updatedAt:
          typeof (parsed as MichinaChallengerRecord).updatedAt === 'string'
            ? (parsed as MichinaChallengerRecord).updatedAt
            : '',
        updatedBy:
          typeof (parsed as MichinaChallengerRecord).updatedBy === 'string'
            ? (parsed as MichinaChallengerRecord).updatedBy
            : undefined,
      }
    }
  } catch (error) {
    console.error('[michina] Failed to parse challenger record', error)
  }
  return null
}

async function saveMichinaChallengerRecord(
  env: Bindings,
  emails: string[],
  options: { updatedBy?: string } = {},
): Promise<MichinaChallengerRecord> {
  const normalized = Array.from(new Set(emails.map((value) => normalizeEmailValue(value)).filter(Boolean)))
  const record: MichinaChallengerRecord = {
    challengers: normalized,
    updatedAt: new Date().toISOString(),
    updatedBy: options.updatedBy,
  }
  if (!record.updatedBy) {
    delete record.updatedBy
  }
  await kvPut(env, MICHINA_CHALLENGERS_KEY, JSON.stringify(record))
  return record
}

async function getMichinaChallengerEmails(env: Bindings) {
  const record = await getMichinaChallengerRecord(env)
  return record?.challengers ?? []
}

async function getMichinaUsers(env: Bindings): Promise<MichinaUserRecord[]> {
  const raw = await kvGet(env, MICHINA_USERS_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    const records: MichinaUserRecord[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue
      }
      const email = normalizeEmailValue((entry as MichinaUserRecord).email)
      if (!email) {
        continue
      }
      const name = typeof (entry as MichinaUserRecord).name === 'string' ? (entry as MichinaUserRecord).name : ''
      const joinedAt =
        typeof (entry as MichinaUserRecord).joinedAt === 'string'
          ? (entry as MichinaUserRecord).joinedAt
          : new Date().toISOString()
      const updatedAt =
        typeof (entry as MichinaUserRecord).updatedAt === 'string'
          ? (entry as MichinaUserRecord).updatedAt
          : joinedAt
      const role = typeof (entry as MichinaUserRecord).role === 'string' ? (entry as MichinaUserRecord).role : 'member'
      records.push({ name, email, joinedAt, updatedAt, role })
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch (error) {
    console.error('[michina/users] Failed to parse user records', error)
    return []
  }
}

async function saveMichinaUsers(env: Bindings, users: MichinaUserRecord[]) {
  const payload = users.map((user) => ({
    name: user.name,
    email: normalizeEmailValue(user.email),
    joinedAt: user.joinedAt,
    updatedAt: user.updatedAt,
    role: user.role,
  }))
  await kvPut(env, MICHINA_USERS_KEY, JSON.stringify(payload))
}

async function listParticipantKeys(env: Bindings) {
  if (env.CHALLENGE_KV) {
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const result = await env.CHALLENGE_KV.list({ prefix: PARTICIPANT_KEY_PREFIX, cursor })
      for (const entry of result.keys) {
        keys.push(entry.name)
      }
      cursor = result.list_complete ? undefined : result.cursor
    } while (cursor)
    return keys
  }

  if (env.CHALLENGE_KV_BACKUP) {
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const result = await env.CHALLENGE_KV_BACKUP.list({ prefix: PARTICIPANT_KEY_PREFIX, cursor })
      for (const entry of result.keys) {
        keys.push(entry.name)
      }
      cursor = result.list_complete ? undefined : result.cursor
    } while (cursor)
    return keys
  }

  const primaryKeys = Array.from(inMemoryStore.keys()).filter((key) => key.startsWith(PARTICIPANT_KEY_PREFIX))
  const backupKeys = Array.from(inMemoryBackupStore.keys()).filter((key) => key.startsWith(PARTICIPANT_KEY_PREFIX))
  return Array.from(new Set([...primaryKeys, ...backupKeys]))
}

async function getParticipant(env: Bindings, email: string) {
  const key = encodeKey(email)
  const stored = await kvGet(env, key)
  if (!stored) return null
  try {
    const parsed = JSON.parse(stored) as ChallengeParticipant
    if (!parsed.email) return null
    return parsed
  } catch (error) {
    console.error('[challenge] Failed to parse participant data', error)
    return null
  }
}

function buildChallengeParticipantPayload(
  participant: ChallengeParticipant,
  options: { timeline?: ChallengeTimeline } = {},
) {
  const totalSubmissions = Object.keys(participant.submissions ?? {}).length
  const missingDays = Math.max(0, REQUIRED_SUBMISSIONS - totalSubmissions)
  const timeline = options.timeline

  return {
    email: participant.email,
    name: participant.name,
    plan: participant.plan,
    startDate: participant.startDate,
    endDate: participant.endDate,
    submissions: participant.submissions,
    completed: participant.completed,
    completedAt: participant.completedAt ?? null,
    totalSubmissions,
    missingDays,
    required: REQUIRED_SUBMISSIONS,
    expired: timeline ? timeline.expired : true,
    upcoming: timeline ? timeline.upcoming : false,
    challengePeriod: timeline
      ? {
          start: timeline.start,
          end: timeline.end,
          activeDay: timeline.activeDay,
          expired: timeline.expired,
          upcoming: timeline.upcoming,
        }
      : null,
    days: timeline ? timeline.days : [],
  }
}

async function saveParticipant(env: Bindings, participant: ChallengeParticipant) {
  participant.updatedAt = new Date().toISOString()
  await kvPut(env, encodeKey(participant.email), JSON.stringify(participant))
}

async function listParticipants(env: Bindings) {
  const keys = await listParticipantKeys(env)
  const participants: ChallengeSummary[] = []
  for (const key of keys) {
    const stored = await kvGet(env, key)
    if (!stored) continue
    try {
      const participant = JSON.parse(stored) as ChallengeParticipant
      const totalSubmissions = Object.keys(participant.submissions ?? {}).length
      const missingDays = Math.max(0, REQUIRED_SUBMISSIONS - totalSubmissions)
      participants.push({
        ...participant,
        totalSubmissions,
        missingDays,
      })
    } catch (error) {
      console.error('[challenge] Failed to parse participant record', error)
    }
  }
  return participants
}

async function upsertParticipants(env: Bindings, entries: { email: string; name?: string; endDate?: string }[]) {
  const now = new Date()
  const startISO = now.toISOString()
  const defaultEnd = addBusinessDays(now, CHALLENGE_DURATION_BUSINESS_DAYS).toISOString()

  for (const entry of entries) {
    const email = entry.email.trim().toLowerCase()
    if (!isValidEmail(email)) {
      continue
    }

    const existing = await getParticipant(env, email)
    if (existing) {
      existing.name = entry.name?.trim() || existing.name
      existing.plan = 'michina'
      existing.endDate = entry.endDate || existing.endDate
      await saveParticipant(env, existing)
      continue
    }

    const participant: ChallengeParticipant = {
      email,
      name: entry.name?.trim() || undefined,
      plan: 'michina',
      startDate: startISO,
      endDate: entry.endDate || defaultEnd,
      createdAt: startISO,
      updatedAt: startISO,
      submissions: {},
      completed: false,
    }
    await saveParticipant(env, participant)
  }
}

async function recordSubmission(env: Bindings, email: string, submission: ChallengeSubmission) {
  const participant = await getParticipant(env, email)
  if (!participant) {
    return null
  }
  const key = String(submission.day)
  participant.submissions[key] = submission
  await saveParticipant(env, participant)
  return participant
}

async function evaluateCompletions(env: Bindings) {
  const keys = await listParticipantKeys(env)
  const updated: ChallengeParticipant[] = []
  for (const key of keys) {
    const stored = await kvGet(env, key)
    if (!stored) continue
    let participant: ChallengeParticipant | null = null
    try {
      participant = JSON.parse(stored) as ChallengeParticipant
    } catch (error) {
      console.error('[challenge] Failed to parse participant record for completion check', error)
      continue
    }
    if (!participant || participant.completed) {
      continue
    }
    if (Object.keys(participant.submissions ?? {}).length >= REQUIRED_SUBMISSIONS) {
      participant.completed = true
      participant.completedAt = new Date().toISOString()
      await saveParticipant(env, participant)
      updated.push(participant)
    }
  }
  return updated
}

async function requireAdminSession(c: Context<{ Bindings: Bindings }>) {
  const config = getAdminConfig(c.env)
  const fallbackEmail =
    config?.email ?? c.env.ADMIN_EMAIL?.trim().toLowerCase() ?? 'admin@local'
  const adminCookie = getCookie(c, 'admin')
  if (adminCookie === 'true') {
    return fallbackEmail
  }
  if (!config) {
    return null
  }
  const token = getCookie(c, ADMIN_SESSION_COOKIE)
  if (!token) {
    return null
  }
  try {
    const payload = (await verify(token, config.sessionSecret)) as AdminSessionPayload
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (payload.role !== 'admin' || !payload.sub) {
      return null
    }
    if (payload.iss !== ADMIN_SESSION_ISSUER || payload.aud !== ADMIN_SESSION_AUDIENCE) {
      return null
    }
    if (payload.ver !== config.sessionVersion) {
      return null
    }
    if (payload.sub !== config.email) {
      return null
    }
    if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + 60) {
      return null
    }
    if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
      return null
    }
    return payload.sub
  } catch (error) {
    console.error('[auth] Failed to verify admin session', error)
    clearAdminSession(c)
    return null
  }
}

async function createAdminSession(
  c: Context<{ Bindings: Bindings }>,
  email: string,
  config?: AdminConfig,
): Promise<{ exp: number; iat: number }> {
  const adminConfig = config ?? getAdminConfig(c.env)
  if (!adminConfig) {
    throw new Error('SESSION_SECRET_NOT_CONFIGURED')
  }
  const normalizedEmail = email.trim().toLowerCase()
  const expiresInSeconds = 60 * 60 * 8
  const issuedAt = Math.floor(Date.now() / 1000)
  const exp = issuedAt + expiresInSeconds
  const token = await sign(
    {
      sub: normalizedEmail,
      role: 'admin',
      exp,
      iat: issuedAt,
      iss: ADMIN_SESSION_ISSUER,
      aud: ADMIN_SESSION_AUDIENCE,
      ver: adminConfig.sessionVersion,
    },
    adminConfig.sessionSecret,
  )
  setCookie(c, ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: true,
    path: '/',
    maxAge: expiresInSeconds,
  })
  return { exp, iat: issuedAt }
}

function clearAdminSession(c: Context<{ Bindings: Bindings }>) {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: '/', secure: true, sameSite: 'Strict' })
  deleteCookie(c, 'admin', { path: '/', secure: true, sameSite: 'strict' })
}

const app = new Hono<{ Bindings: Bindings }>()

registerAuthRoutes(app)

app.use('*', async (c, next) => {
  await next()

  const csp = [
    "default-src 'self'",
    "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://accounts.google.com https://apis.google.com https://www.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "connect-src 'self' https://api.openai.com https://oauth2.googleapis.com https://accounts.google.com https://www.googleapis.com",
    "frame-src 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join('; ')

  c.res.headers.set('Content-Security-Policy', csp)
  c.res.headers.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains; preload')
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  c.res.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
})

app.use('/static/*', serveStatic({ root: './public' }))

app.get('/seo-vision', (c) => c.redirect('/static/seo-vision/index.html'))
app.get('/seo-vision/', (c) => c.redirect('/static/seo-vision/index.html'))

app.use(renderer)

app.get('/api/auth/session', async (c) => {
  const adminEmail = await requireAdminSession(c)
  return c.json({ admin: Boolean(adminEmail), email: adminEmail ?? null })
})

app.post('/api/admin/login', async (c) => {
  c.header('Cache-Control', 'no-store')
  const configuredKey = c.env.ADMIN_SECRET_KEY?.trim()
  if (!configuredKey) {
    return c.json({ success: false, message: '관리자 인증 키가 구성되지 않았습니다.' }, 500)
  }
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ success: false, message: '잘못된 요청입니다.' }, 400)
  }
  const secretKey =
    typeof (payload as { secretKey?: unknown }).secretKey === 'string'
      ? ((payload as { secretKey: string }).secretKey || '').trim()
      : ''
  if (!secretKey) {
    return c.json({ success: false, message: '시크릿 키를 입력해주세요.' }, 400)
  }
  if (secretKey !== configuredKey) {
    return c.json({ success: false, message: '잘못된 키입니다.' }, 401)
  }
  const adminConfig = getAdminConfig(c.env)
  const resolvedEmail = adminConfig?.email ?? c.env.ADMIN_EMAIL?.trim().toLowerCase() ?? 'admin@local'
  setCookie(c, 'admin', 'true', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 2,
  })
  return c.json({ success: true, message: '관리자 인증 완료', redirect: '/dashboard', email: resolvedEmail })
})

app.get('/api/admin/period', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  try {
    const db = getDatabase(c.env)
    const [period, periods] = await Promise.all([
      getChallengePeriodFromDb(db),
      listChallengePeriodsFromDb(db).catch((error) => {
        console.error('[admin] Failed to load period list', error)
        return [] as ChallengePeriodSummary[]
      }),
    ])
    return c.json({ period, periods })
  } catch (error) {
    console.error('[admin] Failed to load challenge period', error)
    return c.json({ error: 'DATABASE_ERROR' }, 500)
  }
})

app.post('/api/admin/period', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ error: 'INVALID_JSON' }, 400)
  }
  const startDate = isValidDateString((payload as { startDate?: string }).startDate)
    ? (payload as { startDate: string }).startDate
    : ''
  const endDate = isValidDateString((payload as { endDate?: string }).endDate)
    ? (payload as { endDate: string }).endDate
    : ''
  if (!startDate || !endDate) {
    return c.json({ error: 'INVALID_PERIOD' }, 400)
  }
  if (startDate > endDate) {
    return c.json({ error: 'INVALID_RANGE' }, 400)
  }
  try {
    const period = await saveChallengePeriodToDb(getDatabase(c.env), startDate, endDate)
    return c.json({ success: true, period })
  } catch (error) {
    console.error('[admin] Failed to save challenge period', error)
    return c.json({ error: 'DATABASE_ERROR' }, 500)
  }
})

app.get('/api/admin/participants', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  try {
    const db = getDatabase(c.env)
    const roleQuery = c.req.query('role')
    const statusQuery = c.req.query('status')
    const periodQuery = c.req.query('periodId')
    const referenceDateQuery = c.req.query('date') ?? c.req.query('referenceDate')

    const roleFilter = typeof roleQuery === 'string' && roleQuery.trim().length > 0 ? roleQuery.trim() : undefined
    const referenceDateRaw =
      typeof referenceDateQuery === 'string' && referenceDateQuery.trim().length > 0
        ? referenceDateQuery.trim()
        : undefined
    const normalizedReferenceDate = normalizeReferenceDate(referenceDateRaw)

    let periods: ChallengePeriodSummary[] = []
    try {
      periods = await listChallengePeriodsFromDb(db)
    } catch (error) {
      console.error('[admin] Failed to fetch challenge periods', error)
    }

    const parsedPeriodId =
      typeof periodQuery === 'string' && periodQuery.trim().length > 0
        ? Number.parseInt(periodQuery.trim(), 10)
        : Number.NaN
    const selectedPeriod = Number.isFinite(parsedPeriodId)
      ? periods.find((period) => period.id === parsedPeriodId)
      : undefined

    let participants = await listParticipantsFromDb(db, {
      role: roleFilter,
      referenceDate: normalizedReferenceDate,
    })

    if (selectedPeriod) {
      participants = participants.filter((participant) => isParticipantWithinPeriod(participant, selectedPeriod))
    }

    const summary = summarizeParticipantStatuses(participants)

    const statusFilter =
      statusQuery === 'active' || statusQuery === 'expired' || statusQuery === 'upcoming'
        ? statusQuery
        : undefined

    const filteredParticipants = statusFilter
      ? participants.filter((participant) => participant.status === statusFilter)
      : participants

    return c.json({
      participants: filteredParticipants,
      summary,
      filters: {
        role: roleFilter ?? null,
        status: statusFilter ?? null,
        periodId: selectedPeriod ? selectedPeriod.id : null,
        referenceDate: normalizedReferenceDate,
      },
      periods,
    })
  } catch (error) {
    console.error('[admin] Failed to load participants', error)
    return c.json({ error: 'DATABASE_ERROR' }, 500)
  }
})

app.post('/api/admin/participants', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ error: 'INVALID_JSON' }, 400)
  }
  const listSource: unknown = Array.isArray(payload)
    ? payload
    : (payload as { list?: unknown }).list ?? (payload as { participants?: unknown }).participants
  if (!Array.isArray(listSource)) {
    return c.json({ error: 'INVALID_PAYLOAD' }, 400)
  }
  const entries = listSource
    .map((item) => ({
      name: typeof item?.name === 'string' ? item.name.trim() : '',
      email: typeof item?.email === 'string' ? item.email.trim().toLowerCase() : '',
      joinedAt: typeof item?.joined_at === 'string' ? item.joined_at.trim() : '',
    }))
    .filter((item) => isValidEmail(item.email))

  if (entries.length === 0) {
    return c.json({ error: 'NO_PARTICIPANTS' }, 400)
  }

  const db = getDatabase(c.env)
  try {
    for (const entry of entries) {
      const joinedAt = entry.joinedAt || new Date().toISOString().split('T')[0]
      await db
        .prepare(
          "INSERT OR REPLACE INTO participants (name, email, joined_at, role) VALUES (?, ?, ?, '미치나')",
        )
        .bind(entry.name, entry.email, joinedAt)
        .run()
    }
    const participants = await listParticipantsFromDb(db)
    const summary = summarizeParticipantStatuses(participants)
    return c.json({ success: true, count: entries.length, participants, summary })
  } catch (error) {
    console.error('[admin] Failed to save participants', error)
    return c.json({ error: 'DATABASE_ERROR' }, 500)
  }
})

app.delete('/api/admin/participants/delete', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  const db = getDatabase(c.env)
  try {
    await db.prepare('DELETE FROM participants').run()
  } catch (error) {
    const message = String(error || '')
    if (/no such table: participants/i.test(message)) {
      console.warn('[admin] participants table missing while attempting delete; treating as empty state')
    } else {
      console.error('[admin] Failed to delete participants', error)
      return c.json({ error: 'DATABASE_ERROR' }, 500)
    }
  }
  return c.json({ success: true })
})

app.get('/api/admin/michina-status', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  const db = getDatabase(c.env)
  let period: ChallengePeriodRecord | null = null
  try {
    period = await getChallengePeriodFromDb(db)
  } catch (error) {
    const message = String(error || '')
    if (/no such table: challenge_period/i.test(message)) {
      console.warn('[admin] challenge_period table is not available')
    } else {
      console.error('[admin] Failed to load challenge period for status', error)
      return c.json({ error: 'DATABASE_ERROR' }, 500)
    }
  }

  let totalCount = 0
  try {
    const row = await db
      .prepare('SELECT COUNT(*) AS cnt FROM participants WHERE role = ?')
      .bind('미치나')
      .first<{ cnt: number | null }>()
    totalCount = Number(row?.cnt ?? 0)
  } catch (error) {
    const message = String(error || '')
    if (/no such table: participants/i.test(message)) {
      console.warn('[admin] participants table is not available; returning zero counts')
    } else {
      console.error('[admin] Failed to count michina participants', error)
      return c.json({ error: 'DATABASE_ERROR' }, 500)
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const active = period && period.endDate && today <= period.endDate ? totalCount : 0
  const expired = Math.max(0, totalCount - active)

  return c.json({ total: totalCount, active, expired, period })
})

app.get('/api/admin/users', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  const db = getDatabase(c.env)
  let rows: UserRow[] = []
  try {
    const result = await db
      .prepare('SELECT id, name, email, role, last_login FROM users ORDER BY datetime(last_login) DESC, id DESC')
      .all<UserRow>()
    rows = Array.isArray(result.results) ? result.results : []
  } catch (error) {
    const message = String(error || '')
    if (/no such table: users/i.test(message)) {
      console.warn('[admin] users table is not available')
      return c.json({ users: [] })
    }
    console.error('[admin] Failed to load users', error)
    return c.json({ error: 'DATABASE_ERROR' }, 500)
  }

  const users: UserRecord[] = rows.map((row) => {
    const name = (row.name ?? '').trim()
    const role = (row.role ?? '').trim()
    const lastLoginRaw = typeof row.last_login === 'string' ? row.last_login.trim() : ''
    return {
      id: row.id,
      name: name,
      email: row.email,
      role: role || 'guest',
      lastLogin: lastLoginRaw || null,
    }
  })

  return c.json({ users })
})

app.post('/api/auth/admin/logout', async (c) => {
  clearAdminSession(c)
  return c.json({ ok: true })
})

app.get('/api/michina/config', async (c) => {
  const [period, challengers] = await Promise.all([getMichinaPeriodRecord(c.env), getMichinaChallengerRecord(c.env)])
  return c.json({
    period,
    challengers: challengers?.challengers ?? [],
    updatedAt: period?.updatedAt ?? challengers?.updatedAt ?? null,
    challengersUpdatedAt: challengers?.updatedAt ?? null,
    challengersUpdatedBy: challengers?.updatedBy ?? null,
  })
})

app.post('/api/user/check-role', async (c) => {
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ error: 'INVALID_JSON' }, 400)
  }
  const email = normalizeEmailValue((payload as { email?: string }).email)
  if (!email) {
    return c.json({ role: 'free' })
  }
  try {
    const db = getDatabase(c.env)
    const period = await getChallengePeriodFromDb(db)
    const today = new Date().toISOString().split('T')[0]
    if (period && today > period.endDate) {
      await db.prepare("UPDATE participants SET role='free' WHERE role='미치나'").run()
    }
    const user = await db
      .prepare('SELECT role FROM participants WHERE email = ? LIMIT 1')
      .bind(email)
      .first<{ role: string | null }>()
    const role = (user?.role ?? '').trim() || 'free'
    return c.json({ role })
  } catch (error) {
    console.error('[user] Failed to check role', error)
    return c.json({ role: 'free' }, 500)
  }
})

app.get('/api/admin/michina/period', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  const period = await getMichinaPeriodRecord(c.env)
  return c.json({ period })
})

app.post('/api/admin/michina/period', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ error: 'INVALID_JSON' }, 400)
  }
  const start = isValidDateString((payload as { start?: string }).start) ? (payload as { start: string }).start : ''
  const end = isValidDateString((payload as { end?: string }).end) ? (payload as { end: string }).end : ''
  if (!start || !end) {
    return c.json({ error: 'INVALID_PERIOD' }, 400)
  }
  if (start > end) {
    return c.json({ error: 'INVALID_RANGE' }, 400)
  }
  const record = await saveMichinaPeriodRecord(c.env, { start, end, updatedBy: adminEmail })
  return c.json({ ok: true, period: record })
})

app.get('/api/admin/michina/challengers', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  const record = await getMichinaChallengerRecord(c.env)
  return c.json({
    challengers: record?.challengers ?? [],
    updatedAt: record?.updatedAt ?? null,
    updatedBy: record?.updatedBy ?? null,
  })
})

app.post('/api/admin/michina/challengers', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ error: 'INVALID_JSON' }, 400)
  }

  const source: unknown = (payload as { challengers?: unknown; emails?: unknown }).challengers ??
    (payload as { emails?: unknown }).emails ??
    null;

  let rawList: string[] = []
  if (Array.isArray(source)) {
    rawList = source as string[]
  } else if (typeof source === 'string') {
    rawList = source.split(/[\s,;\r\n]+/)
  }

  if (rawList.length === 0 && !(payload as { allowEmpty?: boolean }).allowEmpty) {
    if (!Array.isArray(source)) {
      return c.json({ error: 'NO_CHALLENGERS' }, 400)
    }
  }

  const record = await saveMichinaChallengerRecord(c.env, rawList, { updatedBy: adminEmail })
  return c.json({ ok: true, challengers: record.challengers, updatedAt: record.updatedAt, updatedBy: record.updatedBy ?? null })
})

app.post('/api/michina/role/sync', async (c) => {
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ error: 'INVALID_JSON' }, 400)
  }
  const email = normalizeEmailValue((payload as { email?: string }).email)
  if (!email) {
    return c.json({ error: 'INVALID_EMAIL' }, 400)
  }
  const name = typeof (payload as { name?: string }).name === 'string' ? (payload as { name: string }).name.trim() : ''
  const roleRaw = typeof (payload as { role?: string }).role === 'string' ? (payload as { role: string }).role.trim().toLowerCase() : ''
  const resolvedRole = roleRaw === 'michina' ? 'michina' : roleRaw === 'admin' ? 'admin' : roleRaw === 'guest' ? 'guest' : 'member'

  const users = await getMichinaUsers(c.env)
  const now = new Date().toISOString()
  const existing = users.find((user) => user.email === email)
  if (existing) {
    if (name) {
      existing.name = name
    }
    existing.role = resolvedRole
    existing.updatedAt = now
    if (!existing.joinedAt) {
      existing.joinedAt = now
    }
  } else {
    users.push({
      name,
      email,
      role: resolvedRole,
      joinedAt: now,
      updatedAt: now,
    })
  }
  await saveMichinaUsers(c.env, users)
  return c.json({ ok: true })
})

app.get('/api/users', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  const users = await getMichinaUsers(c.env)
  return c.json({ users })
})

app.get('/auth/google', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID?.trim()
  const redirectUri = c.env.GOOGLE_REDIRECT_URI?.trim()

  if (!clientId || !redirectUri) {
    return c.text('Google OAuth가 구성되지 않았습니다.', 500)
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  })

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302)
})

app.get('/api/auth/callback/google', async (c) => {
  const code = (c.req.query('code') || '').trim()

  if (!code) {
    return c.text('Authorization code is required.', 400)
  }

  const clientId = c.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET?.trim()
  const redirectUri = c.env.GOOGLE_REDIRECT_URI?.trim()

  if (!clientId || !clientSecret || !redirectUri) {
    return c.text('Google OAuth credentials are not configured.', 500)
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      console.error('Failed to exchange Google authorization code', await tokenResponse.text().catch(() => ''))
      return c.text('Failed to verify Google login.', 502)
    }

    const tokenJson = (await tokenResponse.json()) as { access_token?: string }
    const accessToken = typeof tokenJson.access_token === 'string' ? tokenJson.access_token : ''

    if (!accessToken) {
      return c.text('Failed to verify Google login.', 502)
    }

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!profileResponse.ok) {
      console.error('Failed to fetch Google user info', await profileResponse.text().catch(() => ''))
      return c.text('Failed to verify Google account.', 502)
    }

    const profile = (await profileResponse.json()) as { email?: string; name?: string; picture?: string }
    const email = typeof profile.email === 'string' ? profile.email.trim() : ''
    const name = typeof profile.name === 'string' ? profile.name.trim() : ''
    const picture = typeof profile.picture === 'string' ? profile.picture : undefined

    if (!email) {
      return c.text('Failed to verify Google account.', 502)
    }

    const session = JSON.stringify({ email, name, picture, time: Date.now() })

    setCookie(c, 'user', session, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

    return c.redirect('/', 302)
  } catch (error) {
    console.error('Google OAuth callback handling failed', error)
    return c.text('Failed to verify Google login.', 502)
  }
})

app.get('/api/auth/logout', (c) => {
  deleteCookie(c, 'user', { path: '/' })
  return c.redirect('/', 302)
})

app.post('/api/logout', (c) => {
  deleteCookie(c, 'user', { path: '/' })
  return c.json({ success: true })
})

app.post('/api/admin/challenge/import', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }

  let payload: {
    participants?: Array<string | { email?: string; name?: string; endDate?: string }>
    endDate?: string
  }
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ error: 'INVALID_JSON_BODY' }, 400)
  }

  const entries: { email: string; name?: string; endDate?: string }[] = []
  const overrideEndISO = typeof payload?.endDate === 'string' && !Number.isNaN(Date.parse(payload.endDate))
    ? new Date(payload.endDate).toISOString()
    : undefined

  for (const item of payload?.participants ?? []) {
    if (typeof item === 'string') {
      const email = item.trim().toLowerCase()
      if (isValidEmail(email)) {
        entries.push({ email, endDate: overrideEndISO })
      }
      continue
    }
    if (typeof item === 'object' && item) {
      const email = typeof item.email === 'string' ? item.email.trim().toLowerCase() : ''
      if (!isValidEmail(email)) continue
      const endDate = typeof item.endDate === 'string' && !Number.isNaN(Date.parse(item.endDate))
        ? new Date(item.endDate).toISOString()
        : overrideEndISO
      const name = typeof item.name === 'string' ? item.name.trim() : undefined
      entries.push({ email, name, endDate: endDate })
    }
  }

  if (entries.length === 0) {
    return c.json({ error: 'NO_VALID_PARTICIPANTS' }, 400)
  }

  await upsertParticipants(c.env, entries)
  const participants = await listParticipants(c.env)

  return c.json({
    ok: true,
    imported: entries.length,
    total: participants.length,
  })
})

app.get('/api/admin/challenge/participants', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  const participants = await listParticipants(c.env)
  return c.json({ participants })
})

app.post('/api/admin/challenge/run-completion-check', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  const updated = await evaluateCompletions(c.env)
  return c.json({ ok: true, newlyCompleted: updated.length })
})

app.get('/api/admin/challenge/completions', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  const participants = await listParticipants(c.env)
  const completed = participants.filter((participant) => participant.completed)
  const format = c.req.query('format')
  if (format === 'csv') {
    const headers = ['email', 'name', 'startDate', 'endDate', 'completedAt', 'totalSubmissions']
    const rows = completed.map((participant) => [
      participant.email,
      participant.name ?? '',
      participant.startDate,
      participant.endDate,
      participant.completedAt ?? '',
      String(Object.keys(participant.submissions ?? {}).length),
    ])
    const csv = [headers, ...rows]
      .map((columns) => columns.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n')
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }

  return c.json({ completed })
})

app.post('/api/admin/challenge/backup', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }

  const hasPrimaryKv = Boolean(c.env.CHALLENGE_KV)
  const hasBackupKv = Boolean(c.env.CHALLENGE_KV_BACKUP)

  if (hasPrimaryKv && !hasBackupKv) {
    return c.json({ error: 'BACKUP_NOT_CONFIGURED' }, 400)
  }

  const keys = await listParticipantKeys(c.env)
  let replicated = 0

  for (const key of keys) {
    const value = await kvGet(c.env, key)
    if (!value) {
      continue
    }
    if (hasBackupKv) {
      await c.env.CHALLENGE_KV_BACKUP!.put(key, value)
    } else {
      inMemoryBackupStore.set(key, value)
    }
    replicated += 1
  }

  return c.json({ ok: true, replicated, totalKeys: keys.length })
})

app.post('/api/admin/challenge/backup/snapshot', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }

  const hasBackupKv = Boolean(c.env.CHALLENGE_KV_BACKUP)
  const hasPrimaryKv = Boolean(c.env.CHALLENGE_KV)
  if (hasPrimaryKv && !hasBackupKv) {
    return c.json({ error: 'BACKUP_NOT_CONFIGURED' }, 400)
  }

  const keys = await listParticipantKeys(c.env)
  const participants: ChallengeParticipant[] = []

  for (const key of keys) {
    const value = await kvGet(c.env, key)
    if (!value) {
      continue
    }
    try {
      const parsed = JSON.parse(value) as ChallengeParticipant
      if (parsed?.email) {
        participants.push(parsed)
      }
    } catch (error) {
      console.error('[admin/backup] Failed to parse participant record for snapshot', error)
    }
  }

  const snapshot = {
    exportedAt: new Date().toISOString(),
    exportedBy: adminEmail,
    participantCount: participants.length,
    entries: participants,
  }
  const snapshotKey = `backup:snapshot:${new Date().toISOString().replace(/[:.]/g, '-')}`
  const snapshotValue = JSON.stringify(snapshot)

  if (hasBackupKv) {
    await c.env.CHALLENGE_KV_BACKUP!.put(snapshotKey, snapshotValue)
  } else {
    inMemoryBackupStore.set(snapshotKey, snapshotValue)
  }

  return c.json({ ok: true, key: snapshotKey, participantCount: participants.length })
})

app.get('/api/challenge/profile', async (c) => {
  const email = c.req.query('email')
  if (!isValidEmail(email)) {
    return c.json({ error: 'INVALID_EMAIL' }, 400)
  }
  const now = new Date()
  const [participant, timeline] = await Promise.all([
    getParticipant(c.env, email),
    resolveChallengeTimeline(c.env, { now }),
  ])
  if (!participant) {
    return c.json({ exists: false })
  }
  return c.json({
    exists: true,
    participant: buildChallengeParticipantPayload(participant, { timeline: timeline ?? undefined }),
  })
})

app.post('/api/challenge/submit', async (c) => {
  let payload: {
    email?: string
    day?: number
    type?: 'image' | 'url'
    value?: string
  }
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ error: 'INVALID_JSON_BODY' }, 400)
  }

  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const day = typeof payload?.day === 'number' ? Math.floor(payload.day) : NaN
  const submissionType = payload?.type === 'image' || payload?.type === 'url' ? payload.type : null
  const value = typeof payload?.value === 'string' ? payload.value.trim() : ''

  if (!isValidEmail(email) || Number.isNaN(day) || day < 1 || day > REQUIRED_SUBMISSIONS || !submissionType || !value) {
    return c.json({ error: 'INVALID_SUBMISSION' }, 400)
  }

  const participant = await getParticipant(c.env, email)
  if (!participant || participant.plan !== 'michina') {
    return c.json({ error: 'PARTICIPANT_NOT_FOUND' }, 404)
  }

  const now = new Date()
  const timeline = await resolveChallengeTimeline(c.env, { now })
  const dayState = timeline?.days.find((entry) => entry.day === day)
  if (!timeline || timeline.expired || !dayState || !dayState.isActiveDay) {
    return c.json({ error: 'DAY_CLOSED', message: '이 일차는 마감되었습니다' }, 400)
  }

  const submission: ChallengeSubmission = {
    day,
    type: submissionType,
    value,
    submittedAt: new Date().toISOString(),
  }

  const updated = await recordSubmission(c.env, email, submission)
  if (!updated) {
    return c.json({ error: 'PARTICIPANT_NOT_FOUND' }, 404)
  }

  if (!updated.completed && Object.keys(updated.submissions ?? {}).length >= REQUIRED_SUBMISSIONS) {
    updated.completed = true
    updated.completedAt = new Date().toISOString()
    await saveParticipant(c.env, updated)
  }

  return c.json({
    ok: true,
    participant: buildChallengeParticipantPayload(updated, { timeline }),
  })
})

app.get('/api/challenge/certificate', async (c) => {
  const email = c.req.query('email')
  if (!isValidEmail(email)) {
    return c.json({ error: 'INVALID_EMAIL' }, 400)
  }
  const participant = await getParticipant(c.env, email)
  if (!participant || !participant.completed) {
    return c.json({ error: 'CERTIFICATE_NOT_AVAILABLE' }, 404)
  }
  return c.json({
    email: participant.email,
    name: participant.name ?? participant.email.split('@')[0],
    startDate: participant.startDate,
    endDate: participant.endDate,
    completedAt: participant.completedAt ?? participant.updatedAt,
    plan: participant.plan,
    totalSubmissions: Object.keys(participant.submissions ?? {}).length,
    required: REQUIRED_SUBMISSIONS,
  })
})

const OPENAI_KEYWORD_FALLBACK_POOL: string[] = [
  '이미지',
  '사진',
  '디자인',
  '그래픽',
  '브랜딩',
  '콘텐츠',
  '마케팅',
  '소셜미디어',
  '프로모션',
  '브랜드',
  '광고',
  '썸네일',
  '배너',
  '포스터',
  '프레젠테이션',
  '템플릿',
  '고화질',
  '투명 배경',
  '크롭',
  '배경 제거',
  '비주얼',
  '크리에이티브',
  '트렌디',
  '감각적인',
  '현대적인',
  '컬러 팔레트',
  '하이라이트',
  '제품 촬영',
  '모델 컷',
  'SNS 콘텐츠',
  '웹디자인',
  'e커머스',
  '프리미엄',
  '상업용',
  '브랜드 아이덴티티',
  '컨셉 아트',
  '라이프스타일',
  '무드 보드',
  '스토리텔링',
]

const KEYWORD_TEXT_SPLIT_PATTERN = /[,\n，、·•|\/\\;:()\[\]{}<>!?！？]+/

const normalizeKeywordCandidate = (keyword: string): string => {
  return keyword
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[#"'`•·\-]+/, '')
    .replace(/[#"'`•·\-]+$/, '')
    .trim()
}

const collectKeywordsFromRaw = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item : String(item ?? '')))
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  }
  if (typeof raw === 'string') {
    return raw
      .split(KEYWORD_TEXT_SPLIT_PATTERN)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  }
  return []
}

const extractKeywordTokensFromText = (text?: string | null): string[] => {
  if (typeof text !== 'string') return []
  const trimmed = text.trim()
  if (!trimmed) return []
  const tokens = new Set<string>()

  const normalizedWhole = normalizeKeywordCandidate(trimmed)
  if (normalizedWhole.length >= 2) {
    tokens.add(normalizedWhole)
  }

  const segments = trimmed.split(KEYWORD_TEXT_SPLIT_PATTERN)
  for (const segment of segments) {
    const normalizedSegment = normalizeKeywordCandidate(segment)
    if (!normalizedSegment || normalizedSegment.length < 2) {
      continue
    }
    tokens.add(normalizedSegment)

    const words = normalizedSegment.split(/\s+/)
    if (words.length > 1 && words.length <= 4) {
      tokens.add(words.join(' '))
    }
    for (const word of words) {
      const normalizedWord = normalizeKeywordCandidate(word)
      if (normalizedWord.length >= 2) {
        tokens.add(normalizedWord)
      }
    }
  }

  return Array.from(tokens).filter((value) => value.length >= 2 && value.length <= 32)
}

const buildKeywordListFromOpenAI = (
  raw: unknown,
  context: { title?: string; summary?: string; name?: string },
): string[] => {
  const keywords: string[] = []
  const seen = new Set<string>()

  const pushKeyword = (value: string) => {
    const normalized = normalizeKeywordCandidate(value)
    if (!normalized) return
    if (normalized.length > 48) return
    if (seen.has(normalized)) return
    seen.add(normalized)
    keywords.push(normalized)
  }

  for (const candidate of collectKeywordsFromRaw(raw)) {
    pushKeyword(candidate)
  }

  if (keywords.length < 25) {
    const contextTokens = [
      ...extractKeywordTokensFromText(context.title),
      ...extractKeywordTokensFromText(context.summary),
      ...extractKeywordTokensFromText(context.name),
    ]
    for (const token of contextTokens) {
      pushKeyword(token)
      if (keywords.length >= 25) {
        break
      }
    }
  }

  if (keywords.length < 25) {
    for (const fallback of OPENAI_KEYWORD_FALLBACK_POOL) {
      pushKeyword(fallback)
      if (keywords.length >= 25) {
        break
      }
    }
  }

  let fillerIndex = 1
  while (keywords.length < 25) {
    pushKeyword(`키워드 ${fillerIndex}`)
    fillerIndex += 1
  }

  return keywords.slice(0, 25)
}

app.post('/api/analyze', async (c) => {
  const env = c.env
  const processEnv =
    typeof globalThis !== 'undefined' && (globalThis as any)?.process?.env
      ? ((globalThis as any).process.env as Record<string, string | undefined>)
      : undefined
  const processApiKey =
    typeof processEnv?.OPENAI_API_KEY === 'string' ? processEnv.OPENAI_API_KEY.trim() : ''
  const bindingApiKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : ''
  const openaiApiKey = processApiKey || bindingApiKey

  if (!openaiApiKey) {
    return c.json({ error: 'OPENAI_API_KEY_NOT_CONFIGURED' }, 500)
  }

  let payload: { image?: string; name?: string } | null = null
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ error: 'INVALID_JSON_BODY' }, 400)
  }

  if (!payload || typeof payload.image !== 'string' || !payload.image.startsWith('data:image')) {
    return c.json({ error: 'IMAGE_DATA_URL_REQUIRED' }, 400)
  }

  const requestedName = typeof payload.name === 'string' && payload.name.trim().length > 0 ? payload.name.trim() : '이미지'
  const dataUrl = payload.image
  const base64Source = dataUrl.replace(/^data:[^;]+;base64,/, '')

  const systemPrompt = `당신은 한국어 기반의 시각 콘텐츠 마케터입니다. 이미지를 분석하여 SEO에 최적화된 메타데이터를 작성하세요.
반드시 JSON 포맷으로만 응답하고, 형식은 다음과 같습니다:
{
  "title": "SEO 최적화 제목 (60자 이내)",
  "summary": "이미지 특징과 활용 맥락을 간결히 설명한 문장 (120자 이내)",
  "keywords": ["키워드1", "키워드2", ..., "키워드25"]
}
조건:
- keywords 배열은 정확히 25개의 한글 키워드로 구성합니다.
- 제목은 한국어로 작성하고, '미리캔버스'를 활용하는 마케터가 검색할 법한 문구를 넣습니다.
- 요약은 이미지의 메시지, 분위기, 활용처를 한 문장으로 설명합니다.
- 필요 시 색상, 분위기, 활용 매체 등을 키워드에 조합합니다.`

  const userInstruction = `다음 이미지를 분석하여 한국어 키워드 25개와 SEO 제목, 요약을 JSON 형식으로 작성해 주세요.
이미지 파일명: ${requestedName}`

  try {
    const responseFormat = {
      type: 'json_schema',
      json_schema: {
        name: 'SeoMetadata',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'summary', 'keywords'],
          properties: {
            title: {
              type: 'string',
              description: 'SEO 최적화 제목 (한국어, 60자 이내)',
              maxLength: 120,
            },
            summary: {
              type: 'string',
              description: '이미지 특징과 활용 맥락을 설명하는 문장 (120자 이내)',
              maxLength: 240,
            },
            keywords: {
              type: 'array',
              description: '정확히 25개의 한국어 키워드',
              minItems: 25,
              maxItems: 25,
              items: {
                type: 'string',
                minLength: 1,
                maxLength: 48,
              },
            },
          },
        },
      },
    }

    const imageUrl = dataUrl.startsWith('data:') ? dataUrl : `data:image/png;base64,${base64Source}`

    const requestPayload = {
      model: 'gpt-4o-mini',
      temperature: 0.6,
      top_p: 0.9,
      presence_penalty: 0,
      frequency_penalty: 0,
      max_tokens: 900,
      response_format: responseFormat,
      messages: [
        {
          role: 'system',
          content: [{ type: 'text', text: systemPrompt }],
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: userInstruction },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    }

    const openaiRequestInit: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(requestPayload),
    }

    const timeoutSignal =
      typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function'
        ? ((AbortSignal as any).timeout(25000) as AbortSignal)
        : null
    if (timeoutSignal) {
      openaiRequestInit.signal = timeoutSignal
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', openaiRequestInit)
    const requestId = openaiResponse.headers.get('x-request-id') ?? undefined

    if (!openaiResponse.ok) {
      let rawBody = ''
      try {
        rawBody = await openaiResponse.text()
      } catch (readError) {
        rawBody = readError instanceof Error ? readError.message : String(readError)
      }

      let detail = ''
      let code = ''
      if (rawBody) {
        try {
          const parsedBody = JSON.parse(rawBody)
          const errorInfo = typeof parsedBody?.error === 'object' && parsedBody.error ? parsedBody.error : parsedBody
          const message = typeof errorInfo?.message === 'string' ? errorInfo.message : ''
          detail = message || JSON.stringify(parsedBody).slice(0, 4000)
          code =
            typeof errorInfo?.code === 'string'
              ? errorInfo.code
              : typeof errorInfo?.type === 'string'
                ? errorInfo.type
                : ''
        } catch {
          detail = rawBody.slice(0, 4000)
        }
      }

      if (!detail) {
        detail = 'OpenAI API 요청이 실패했습니다.'
      }

      const statusCode = openaiResponse.status >= 400 && openaiResponse.status < 600 ? openaiResponse.status : 502

      return c.json(
        {
          error: 'OPENAI_REQUEST_FAILED',
          detail,
          code: code || `HTTP_${openaiResponse.status}`,
          requestId,
        },
        statusCode,
      )
    }

    const completion: any = await openaiResponse.json()

    const tryParseJsonText = (value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      if (!trimmed) return null
      try {
        return JSON.parse(trimmed)
      } catch {
        return null
      }
    }

    const tryParseMessageContent = (message: any) => {
      if (!message) return null

      const { content, function_call: functionCall, tool_calls: toolCalls } = message

      if (Array.isArray(content)) {
        for (const segment of content) {
          if (!segment) continue
          if (segment?.type === 'output_json' && segment?.json) {
            return segment.json
          }
          if (typeof segment?.text === 'string') {
            const candidate = tryParseJsonText(segment.text)
            if (candidate) {
              return candidate
            }
          }
          if (segment?.type === 'text' && typeof segment?.value === 'string') {
            const candidate = tryParseJsonText(segment.value)
            if (candidate) {
              return candidate
            }
          }
        }
      } else if (typeof content === 'string') {
        const candidate = tryParseJsonText(content)
        if (candidate) {
          return candidate
        }
      }

      if (functionCall && typeof functionCall?.arguments === 'string') {
        const candidate = tryParseJsonText(functionCall.arguments)
        if (candidate) {
          return candidate
        }
      }

      if (Array.isArray(toolCalls)) {
        for (const toolCall of toolCalls) {
          const args = toolCall?.function?.arguments
          if (typeof args === 'string') {
            const candidate = tryParseJsonText(args)
            if (candidate) {
              return candidate
            }
          }
        }
      }

      return null
    }

    let parsed:
      | {
          title?: unknown
          summary?: unknown
          keywords?: unknown
        }
      | null = null

    const choices = Array.isArray(completion?.choices) ? completion.choices : []
    for (const choice of choices) {
      parsed = tryParseMessageContent(choice?.message)
      if (parsed) {
        break
      }
      const delta = choice?.delta
      if (delta) {
        const candidate = tryParseMessageContent(delta)
        if (candidate) {
          parsed = candidate
          break
        }
      }
    }

    if (!parsed && typeof completion?.id === 'string') {
      const candidate = tryParseMessageContent((completion as any)?.message)
      if (candidate) {
        parsed = candidate
      }
    }

    if (!parsed) {
      let detail = ''
      try {
        detail = JSON.stringify(completion).slice(0, 4000)
      } catch {
        detail = '응답 파싱에 실패했습니다.'
      }
      return c.json({ error: 'OPENAI_INVALID_CONTENT', detail, requestId }, 502)
    }

    const {
      title: rawTitle,
      summary: rawSummary,
      keywords: rawKeywords,
    } = parsed as {
      title?: unknown
      summary?: unknown
      keywords?: unknown
    }

    if (typeof rawTitle !== 'string' || typeof rawSummary !== 'string') {
      let detail = ''
      try {
        detail = JSON.stringify(parsed).slice(0, 4000)
      } catch {
        detail = '구조화된 응답이 아닙니다.'
      }
      return c.json({ error: 'OPENAI_INVALID_STRUCTURE', detail, requestId }, 502)
    }

    const normalizedTitle = rawTitle.trim()
    const normalizedSummary = rawSummary.trim()

    const fallbackTitle = `${requestedName} 이미지 SEO 제목`
    const fallbackSummary = `${requestedName}의 특징을 설명하는 요약 콘텐츠입니다.`

    const safeTitle = (normalizedTitle || fallbackTitle).slice(0, 120)
    const safeSummary = (normalizedSummary || fallbackSummary).slice(0, 240)

    const keywords = buildKeywordListFromOpenAI(rawKeywords, {
      title: safeTitle,
      summary: safeSummary,
      name: requestedName,
    })

    return c.json({
      title: safeTitle,
      summary: safeSummary,
      keywords,
      provider: 'openai',
      model: 'gpt-4o-mini',
      requestId,
    })
  } catch (error) {
    console.error('[api/analyze] error', error)
    const detail = error instanceof Error ? error.message : String(error)
    return c.json({ error: 'OPENAI_UNHANDLED_ERROR', detail }, 502)
  }
})

app.get('/', async (c) => {
  const adminParam = (c.req.query('admin') || '').trim()
  if (adminParam === '1') {
    const response = c.html(renderAdminManagementPage())
    response.headers.set('Cache-Control', 'no-store, max-age=0')
    return response
  }

  const viewParam = (c.req.query('view') || '').trim().toLowerCase()
  if (viewParam === 'community') {
    const response = c.html(renderCommunityDashboardPage())
    response.headers.set('Cache-Control', 'no-store, max-age=0')
    return response
  }

  const currentYear = new Date().getFullYear()
  const googleClientId = c.env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const googleRedirectUri = resolveGoogleRedirectUri(c)
  const communityUrl = c.env.MICHINA_COMMUNITY_URL?.trim() || '/?view=community'

  let userSession: { email: string; name?: string; picture?: string } | null = null
  const rawUserCookie = getCookie(c, 'user')
  if (rawUserCookie) {
    try {
      const parsed = JSON.parse(rawUserCookie) as { email?: unknown; name?: unknown; picture?: unknown }
      const email = typeof parsed.email === 'string' ? parsed.email : ''
      const name = typeof parsed.name === 'string' ? parsed.name : ''
      const picture = typeof parsed.picture === 'string' ? parsed.picture : undefined
      if (email) {
        userSession = { email, name, picture }
      }
    } catch (error) {
      console.warn('Failed to parse user session cookie', error)
    }
  }

  const userGreeting = userSession?.name ? `${userSession.name}님 환영합니다` : ''

  const appConfig = JSON.stringify(
    {
      googleClientId,
      googleRedirectUri,
      communityUrl,
      user: userSession,
    },
    null,
    2,
  ).replace(/</g, '\\u003c')

  return c.render(
    <main class="page">
      <script type="application/json" data-role="app-config">
        {appConfig}
      </script>
      <header class="app-header" data-role="app-header" aria-label="서비스 헤더">
        <div class="app-header__left">
          <a class="app-header__logo" href="/" aria-label="Easy Image Editor 홈">
            <span class="app-header__brand">Easy Image Editor</span>
          </a>
        </div>
        <div class="app-header__right">
          {userGreeting ? (
            <span class="app-header__greeting" data-role="user-greeting">{userGreeting}</span>
          ) : null}
          <div class="app-header__credit" data-role="credit-display" data-state="locked">
            <span class="app-header__plan-badge" data-role="plan-badge">게스트 모드</span>
            <span class="app-header__credit-label" data-role="credit-label">로그인하고 무료 30 크레딧 받기</span>
            <span class="app-header__credit-value">
              <strong data-role="credit-count">0</strong> 크레딧
            </span>
          </div>
          <div class="app-header__profile" data-role="user-profile" hidden>
            <img class="app-header__avatar" data-role="user-avatar" alt="" hidden />
            <span class="app-header__user" data-role="user-summary"></span>
          </div>
          <a
            class="btn btn--ghost btn--sm"
            href={communityUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-role="community-link"
          >
            미치나
          </a>
          <button class="btn btn--ghost btn--sm" type="button" data-role="header-auth">
            로그인
          </button>
          <button class="btn btn--brand btn--sm" type="button" data-role="header-upgrade">
            업그레이드
          </button>
        </div>
      </header>

      <section class="hero" data-view="home" aria-labelledby="hero-heading">
        <p class="hero__badge">크레딧 기반 Freemium 베타</p>
        <h1 class="hero__heading" id="hero-heading">
          멀티 이미지 편집 스튜디오
        </h1>
        <p class="hero__subtitle">
          최대 50장의 이미지를 한 번에 업로드하고 배경 제거, 여백 크롭, 노이즈 제거, 리사이즈,
          PNG → SVG 벡터 변환까지 한 곳에서 처리하세요. 로그인하면 무료 30 크레딧으로 모든 기능을 바로 사용할 수 있어요.
        </p>
      </section>

      <section class="features" data-view="home" aria-label="주요 기능 안내">
        <h2 class="features__title">더 나은 편집 경험을 위한 핵심 기능</h2>
        <div class="features__grid">
          <article class="feature-card">
            <h3>배경 제거 &amp; 피사체 크롭</h3>
            <p>자동 컬러 감지로 피사체를 분리하고, 여백을 줄여 바로 사용할 수 있는 투명 PNG를 만듭니다.</p>
          </article>
          <article class="feature-card">
            <h3>노이즈 제거 · 고품질 리사이즈</h3>
            <p>미세한 블러 처리를 통해 노이즈를 줄이고, 가로 폭 기준으로 선명하게 리사이즈합니다.</p>
          </article>
          <article class="feature-card">
            <h3>PNG → SVG 벡터 변환</h3>
            <p>1~6색을 선택해 150KB 이하의 벡터 파일로 변환하고, 전체 결과를 ZIP으로 저장하세요.</p>
          </article>
        </div>
      </section>

      <section class="stage" data-view="home" aria-label="작업 단계 안내">
        <ol class="stage__list" data-role="stage-indicator">
          <li class="stage__item is-active" data-stage="1">
            <span class="stage__step">1</span>
            <div class="stage__meta">
              <span class="stage__title">업로드 &amp; 선택</span>
              <span class="stage__copy">이미지를 추가하고 비교하기</span>
            </div>
          </li>
          <li class="stage__item" data-stage="2">
            <span class="stage__step">2</span>
            <div class="stage__meta">
              <span class="stage__title">보정 &amp; 변환</span>
              <span class="stage__copy">배경 제거·크롭·SVG 변환</span>
            </div>
          </li>
          <li class="stage__item" data-stage="3">
            <span class="stage__step">3</span>
            <div class="stage__meta">
              <span class="stage__title">다운로드</span>
              <span class="stage__copy">결과 저장 및 키워드 분석</span>
            </div>
          </li>
        </ol>
        <div class="stage__status" data-role="stage-status">
          <div class="stage__status-text" data-role="stage-message">
            로그인하면 30개의 무료 크레딧이 자동으로 충전됩니다.
          </div>
        </div>
      </section>


      <div class="login-modal" data-role="login-modal" aria-hidden="true">
        <div class="login-modal__backdrop" data-action="close-login" aria-hidden="true"></div>
        <div class="login-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="login-modal-title">
          <header class="login-modal__header">
            <h2 class="login-modal__title" id="login-modal-title">Easy Image Editor 로그인</h2>
            <button class="login-modal__close" type="button" data-action="close-login" aria-label="로그인 창 닫기">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </header>
          <p class="login-modal__subtitle">원하는 로그인 방식을 선택해 계속 진행하세요.</p>
          <div class="login-modal__actions">
            <button
              class="login-modal__option login-modal__option--email"
              type="button"
              data-action="choose-email-login"
              aria-pressed="false"
            >
              <span class="login-modal__option-title">이메일로 로그인</span>
              <span class="login-modal__option-copy">6자리 인증 코드 받기</span>
            </button>
            <button
              class="login-modal__option login-modal__option--google"
              type="button"
              data-action="login-google"
              data-role="google-login-button"
              aria-describedby="google-login-helper"
            >
              <span class="login-modal__icon" aria-hidden="true">
                <i class="ri-google-fill"></i>
              </span>
              <span class="login-modal__option-title" data-role="google-login-text" aria-live="polite">Google로 로그인하기</span>
              <span class="login-modal__spinner" data-role="google-login-spinner" aria-hidden="true"></span>
            </button>
          </div>
          <p
            class="login-modal__helper login-modal__helper--google"
            data-role="google-login-helper"
            aria-live="polite"
            id="google-login-helper"
            hidden
          ></p>
          <section class="login-modal__email-panel" data-role="login-email-panel" hidden>
            <h3 class="login-modal__section-title">이메일 로그인</h3>
            <p class="login-modal__section-copy">가입하신 이메일로 6자리 인증 코드를 보내드립니다.</p>
            <form class="login-modal__form" data-role="login-email-form" data-state="idle">
              <label class="login-modal__label" for="loginEmail">이메일 주소</label>
              <div class="login-modal__field-group">
                <input
                  id="loginEmail"
                  name="email"
                  type="email"
                  placeholder="example@email.com"
                  required
                  autocomplete="email"
                  class="login-modal__input"
                  data-role="login-email-input"
                />
                <button class="login-modal__submit" type="submit" data-role="login-email-submit">
                  인증 코드 받기
                </button>
              </div>
              <div class="login-modal__code-group">
                <input
                  id="loginEmailCode"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="6자리 인증 코드"
                  class="login-modal__input login-modal__input--code"
                  data-role="login-email-code"
                  disabled
                />
                <button class="login-modal__resend" type="button" data-role="login-email-resend" hidden>
                  코드 다시 보내기
                </button>
              </div>
              <p class="login-modal__helper" data-role="login-email-helper">
                이메일 주소를 입력하면 인증 코드를 보내드립니다.
              </p>
            </form>
          </section>
        </div>
      </div>

      <div class="upgrade-modal" data-role="upgrade-modal" aria-hidden="true">
        <div
          class="upgrade-modal__backdrop"
          data-role="upgrade-modal-backdrop"
          data-action="close-upgrade"
          aria-hidden="true"
        ></div>
        <div
          class="upgrade-modal__dialog"
          data-role="upgrade-modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upgrade-modal-title"
          tabIndex={-1}
        >
          <button
            class="upgrade-modal__close"
            type="button"
            data-role="upgrade-modal-close"
            data-action="close-upgrade"
            aria-label="업그레이드 창 닫기"
          >
            <i class="ri-close-line" aria-hidden="true"></i>
          </button>
          <header class="upgrade-modal__header">
            <p class="upgrade-modal__eyebrow">플랜 선택</p>
            <h2 class="upgrade-modal__title modal-title" id="upgrade-modal-title">구독 플랜</h2>
          </header>
          <div class="upgrade-modal__content">
            <div class="upgrade-modal__plans" data-role="upgrade-plan-list"></div>
          </div>
          <p class="upgrade-modal__notice">
            미치나 플랜은 관리자 승인 전용이며 챌린지 종료 시 자동으로 Free 플랜으로 전환됩니다.
          </p>
        </div>
      </div>

      <div class="admin-modal" data-role="admin-modal" aria-hidden="true">
        <div class="admin-modal__backdrop" data-action="close-admin" aria-hidden="true"></div>
        <div class="admin-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
          <header class="admin-modal__header">
            <h2 class="admin-modal__title" id="admin-modal-title">관리자 로그인</h2>
            <button class="admin-modal__close" type="button" data-action="close-admin" aria-label="관리자 인증 창 닫기">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </header>
          <p class="admin-modal__subtitle" data-role="admin-modal-subtitle">
            관리자 시크릿 키를 입력해 관리자 대시보드에 접근하세요.
          </p>
          <form class="admin-modal__form" data-role="admin-login-form" data-state="idle">
            <label class="admin-modal__label" for="adminSecretKey">관리자 시크릿 키</label>
            <div class="admin-modal__input-group">
              <input
                id="adminSecretKey"
                name="secretKey"
                type="password"
                autocomplete="off"
                placeholder="시크릿 키를 입력하세요"
                class="admin-modal__input"
                data-role="admin-secret-input"
                required
                minlength={4}
              />
            </div>
            <button class="btn btn--primary admin-modal__submit" type="submit" data-role="admin-secret-submit">
              <i class="ri-key-2-line" aria-hidden="true"></i>
              확인
            </button>
            <p class="admin-modal__helper" data-role="admin-login-message" role="status" aria-live="polite"></p>
          </form>
          <div class="admin-modal__actions" data-role="admin-modal-actions" hidden>
            <p class="admin-modal__note">
              관리자 모드가 이미 활성화되어 있습니다. 아래 바로가기를 사용해 대시보드를 열거나 로그아웃할 수 있습니다.
            </p>
            <div class="admin-modal__buttons">
              <button
                id="openDashboardBtn"
                class="btn btn--outline admin-modal__action"
                type="button"
                data-role="admin-modal-dashboard"
              >
                대시보드 열기
              </button>
              <button
                id="adminLogoutBtn"
                class="btn btn--ghost admin-modal__action"
                type="button"
                data-role="admin-modal-logout"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
      </div>

      <section class="workspace" data-view="home" aria-label="이미지 작업 영역">
        <div class="workspace__actions">
          <button class="btn btn--primary" type="button" data-trigger="file">
            이미지 업로드
          </button>
        </div>
        <div class="workspace__row workspace__row--top">
          <article class="panel panel--upload" aria-label="원본 이미지 관리">
            <header class="panel__header panel__header--stack">
              <div>
                <span class="panel__eyebrow">Sources</span>
                <h2 class="panel__title">업로드된 이미지</h2>
              </div>
              <div class="panel__actions">
                <button class="btn btn--subtle" type="button" data-action="upload-select-all">전체 선택</button>
                <button class="btn btn--ghost" type="button" data-action="upload-clear">전체 해제</button>
                <button class="btn btn--outline" type="button" data-action="upload-delete-selected">선택 삭제</button>
              </div>
            </header>
            <div class="dropzone" data-role="dropzone">
              <input id="fileInput" type="file" accept="image/*" multiple />
              <div class="dropzone__content">
                <div class="dropzone__icon" aria-hidden="true">
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M24 6v24m0 0-8-8m8 8 8-8M10 34h28a4 4 0 0 1 0 8H10a4 4 0 0 1 0-8Z"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
                <p class="dropzone__text">
                  파일을 끌어다 놓거나 <span class="dropzone__accent">클릭</span>하여 업로드
                </p>
                <p class="dropzone__hint">최대 50개 · PNG, JPG, JPEG, WebP 지원 · 최대 12MB</p>
              </div>
            </div>
            <p class="panel__hint">업로드된 이미지는 아래 썸네일 리스트에서 한눈에 확인하고 선택할 수 있습니다.</p>
            <div class="asset-grid asset-grid--compact" id="uploadList" data-empty-text="아직 업로드한 이미지가 없습니다."></div>
          </article>

          <article class="panel panel--operations" aria-label="일괄 처리 도구">
            <header class="panel__header panel__header--stack">
              <div>
                <span class="panel__eyebrow">Batch tools</span>
                <h2 class="panel__title">선택한 이미지 처리</h2>
              </div>
              <p class="panel__caption">업로드 목록에서 이미지를 선택한 뒤 아래 기능을 실행하세요.</p>
            </header>
            <div class="gate gate--operations" data-role="operations-gate" data-state="locked">
              <i class="ri-shield-keyhole-line gate__icon" aria-hidden="true"></i>
              <div class="gate__body">
                <p class="gate__title">이미지 처리에는 크레딧이 필요합니다.</p>
                <p class="gate__copy">
                  실행 시 잔여 크레딧이 차감되며, 로그인하면 <strong>무료 30 크레딧</strong>이 자동으로 지급됩니다.
                </p>
                <div class="gate__actions">
                  <button class="btn btn--outline btn--sm" type="button" data-role="operations-gate-login">로그인하고 무료 크레딧 받기</button>
                </div>
              </div>
            </div>
            <div class="operations-grid">
              <button class="btn btn--primary" type="button" data-operation="remove-bg">
                <i class="ri-brush-3-line" aria-hidden="true"></i>
                배경 제거
              </button>
              <button class="btn btn--primary" type="button" data-operation="auto-crop">
                <i class="ri-crop-line" aria-hidden="true"></i>
                피사체 크롭
              </button>
              <button class="btn btn--primary" type="button" data-operation="remove-bg-crop">
                <i class="ri-magic-line" aria-hidden="true"></i>
                배경 제거 + 크롭
              </button>
              <button class="btn btn--primary" type="button" data-operation="denoise">
                <i class="ri-sparkling-2-line" aria-hidden="true"></i>
                노이즈 제거
              </button>
            </div>
            <div class="operations__resize">
              <label class="operations__label" for="resizeWidth">리사이즈 가로(px)</label>
              <div class="operations__resize-controls">
                <input id="resizeWidth" type="number" min="32" max="4096" placeholder="예: 1200" />
                <button class="btn btn--outline" type="button" data-operation="resize">리사이즈 적용</button>
              </div>
              <p class="operations__note">세로 길이는 원본 비율에 맞추어 자동 계산됩니다.</p>
            </div>
            <p class="status status--hidden" data-role="status" aria-live="polite"></p>
          </article>
        </div>

        <div class="workspace__row workspace__row--bottom">
          <article class="panel panel--results" aria-label="처리 결과 관리">
            <header class="panel__header panel__header--stack">
              <div>
                <span class="panel__eyebrow">Outputs</span>
                <h2 class="panel__title">처리 결과</h2>
              </div>
              <div class="panel__actions">
                <button class="btn btn--subtle" type="button" data-action="result-select-all">전체 선택</button>
                <button class="btn btn--ghost" type="button" data-action="result-clear">전체 해제</button>
                <button class="btn btn--outline" type="button" data-action="result-delete-selected">선택 삭제</button>
              </div>
            </header>
            <div class="results-toolbar">
              <div class="results-toolbar__group results-toolbar__group--controls">
                <div class="results-toolbar__control">
                  <label class="results-toolbar__label" for="svgColorCount">SVG 색상 수</label>
                  <select id="svgColorCount">
                    <option value="1">단색</option>
                    <option value="2">2색</option>
                    <option value="3">3색</option>
                    <option value="4">4색</option>
                    <option value="5">5색</option>
                    <option value="6" selected>6색</option>
                  </select>
                </div>
                <label class="toggle" for="smartCropToggle">
                  <input id="smartCropToggle" type="checkbox" checked />
                  <span class="toggle__control" aria-hidden="true"></span>
                  <span class="toggle__label">Smart Crop</span>
                </label>
              </div>
              <div class="results-toolbar__actions">
                <button class="btn btn--ghost" type="button" data-result-operation="svg">PNG → SVG 변환</button>
                <button class="btn btn--outline" type="button" data-result-download="selected">선택 다운로드</button>
                <button class="btn btn--primary" type="button" data-result-download="all">전체 다운로드</button>
              </div>
            </div>
            <div class="svg-progress" data-role="svg-progress" aria-hidden="true">
              <div class="svg-progress__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <div class="svg-progress__fill" data-role="svg-progress-fill"></div>
              </div>
              <div class="svg-progress__messages">
                <p class="svg-progress__message" data-role="svg-progress-message" aria-live="polite">Uploading image...</p>
                <p class="svg-progress__detail" data-role="svg-progress-detail"></p>
                <p class="svg-progress__hint" data-role="svg-progress-hint" aria-live="polite">Still working... please wait.</p>
              </div>
            </div>
            <p class="svg-progress__notice" data-role="svg-stroke-notice" hidden>
              Some strokes were adjusted or removed for compatibility.
            </p>
            <div class="gate results-gate" data-role="results-gate" data-state="locked">
              <i class="ri-lock-2-line results-gate__icon" aria-hidden="true"></i>
              <div class="results-gate__body">
                <p class="results-gate__title">로그인 후 결과 저장이 가능합니다.</p>
                <p class="results-gate__copy">
                  벡터 변환/다운로드 시 크레딧이 차감돼요. 남은 크레딧: <strong data-role="results-credit-count">0</strong>
                </p>
              </div>
              <div class="results-gate__actions">
                <button class="btn btn--outline btn--sm" type="button" data-role="results-gate-login">로그인하고 무료 30 크레딧 받기</button>
              </div>
            </div>
            <div class="asset-grid asset-grid--results asset-grid--compact" id="resultList" data-empty-text="처리된 이미지가 이곳에 표시됩니다."></div>
            <section class="analysis" data-role="analysis-panel">
              <div class="analysis__header">
                <span class="analysis__title">키워드 분석</span>
                <div class="analysis__actions">
                  <button
                    id="keyword-analyze-btn"
                    class="btn btn--brand btn--sm"
                    type="button"
                    data-action="analyze-current"
                  >
                    키워드 분석
                  </button>
                </div>
              </div>
              <p class="analysis__meta" data-role="analysis-meta" aria-live="polite"></p>
              <p class="analysis__hint" data-role="analysis-hint">
                분석할 이미지를 선택한 뒤 “키워드 분석” 버튼을 눌러보세요.
              </p>
              <p class="analysis__headline" data-role="analysis-title"></p>
              <ul class="analysis__keywords" data-role="analysis-keywords"></ul>
              <p class="analysis__summary" data-role="analysis-summary"></p>
              <div id="keyword-result" class="keyword-result" hidden>
                <h3 class="keyword-result__heading">🔍 키워드 (25개)</h3>
                <textarea id="keyword-list" class="keyword-result__textarea" readonly></textarea>
                <div class="keyword-result__actions">
                  <button
                    id="copy-keywords-btn"
                    class="btn btn--outline btn--sm"
                    type="button"
                    data-action="copy-analysis"
                  >
                    📋 키워드 복사
                  </button>
                </div>
                <h3 class="keyword-result__heading">✨ SEO 최적 제목</h3>
                <p id="seo-title" class="keyword-result__title"></p>
              </div>
            </section>
          </article>
        </div>
      </section>

      <footer class="site-footer" aria-label="사이트 하단">
        <div class="site-footer__inner">
          <div class="site-footer__brand">
            <span class="site-footer__title">Easy Image Editor</span>
            <span class="site-footer__contact">
              문의: <a href="mailto:ellie@elliesbang.kr">ellie@elliesbang.kr</a>
            </span>
          </div>
          <nav class="site-footer__links" aria-label="법적 고지">
            <a href="/privacy">개인정보 처리방침</a>
            <a href="/terms">이용약관</a>
            <a href="/cookies">쿠키 정책</a>
            <button type="button" data-role="footer-admin">관리자 전용</button>
          </nav>
        </div>
        <p class="site-footer__note">© {currentYear} elliesbang. 모든 권리 보유.</p>
      </footer>

      <div class="cookie-banner" data-role="cookie-banner" aria-hidden="true">
        <div class="cookie-banner__content" role="dialog" aria-modal="true" aria-labelledby="cookie-banner-title">
          <div class="cookie-banner__header">
            <h2 class="cookie-banner__title" id="cookie-banner-title">쿠키 사용에 대한 안내</h2>
            <p class="cookie-banner__description">
              더 나은 편집 경험을 제공하기 위해 필수 쿠키와 선택 쿠키를 사용합니다. 필수 쿠키는 서비스 기능에 반드시 필요하며,
              선택 쿠키는 분석 및 기능 개선에 활용됩니다.
            </p>
          </div>
          <div class="cookie-banner__options">
            <label class="cookie-banner__option">
              <input type="checkbox" checked disabled />
              <span>필수 쿠키 (기본 기능 제공을 위해 항상 활성화)</span>
            </label>
            <label class="cookie-banner__option">
              <input type="checkbox" data-role="cookie-analytics" />
              <span>분석 쿠키 (이용 통계 및 UX 개선용)</span>
            </label>
            <label class="cookie-banner__option">
              <input type="checkbox" data-role="cookie-marketing" />
              <span>마케팅 쿠키 (향후 캠페인 최적화용)</span>
            </label>
            <label class="cookie-banner__option cookie-banner__option--confirm">
              <input type="checkbox" data-role="cookie-confirm" />
              <span>쿠키 정책을 확인했으며 안내에 동의합니다.</span>
            </label>
          </div>
          <div class="cookie-banner__actions">
            <a class="cookie-banner__link" href="/cookies" target="_blank" rel="noopener">쿠키 정책 자세히 보기</a>
            <button class="cookie-banner__button" type="button" data-action="accept-cookies" disabled>동의하고 계속하기</button>
          </div>
        </div>
      </div>
    </main>
  )
})

app.get('/privacy', (c) => {
  const currentYear = new Date().getFullYear()

  return c.render(
    <main class="legal-page" aria-labelledby="privacy-heading">
      <header class="legal-page__header">
        <p class="legal-page__eyebrow">Privacy Policy</p>
        <h1 class="legal-page__title" id="privacy-heading">
          Easy Image Editor 개인정보 처리방침
        </h1>
        <p class="legal-page__meta">시행일: 2025년 10월 2일</p>
        <p class="legal-page__lead">
          Easy Image Editor(이하 “서비스”)는 이용자의 개인정보를 소중하게 생각하며, 관련 법령을 준수합니다.
          본 처리는 수집 항목, 이용 목적, 보관 기간 등을 투명하게 안내드리기 위한 문서입니다.
        </p>
      </header>

      <section class="legal-section" aria-labelledby="privacy-collection">
        <h2 id="privacy-collection">1. 수집하는 개인정보 항목</h2>
        <p>서비스는 다음과 같은 정보를 필요 최소한으로 수집합니다.</p>
        <ul>
          <li>회원 가입 시: 이메일 주소, Google 계정 프로필(이름, 프로필 이미지, 이메일)</li>
          <li>본인 확인 및 고객 지원: 성함, 연락처(선택), 문의 내용</li>
          <li>서비스 이용 과정: 접속 기록, 기기 정보, 브라우저 로그(익명 처리)</li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="privacy-purpose">
        <h2 id="privacy-purpose">2. 개인정보 이용 목적</h2>
        <ul>
          <li>회원 식별 및 로그인, 접근 제어</li>
          <li>고객 문의 대응 및 서비스 품질 개선</li>
          <li>서비스 부정 이용 방지 및 보안 강화</li>
          <li>법령상 의무 이행 및 분쟁 해결</li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="privacy-retention">
        <h2 id="privacy-retention">3. 보유 및 이용 기간</h2>
        <ul>
          <li>회원 정보: 회원 탈퇴 시까지 보관 후 7일 이내 지체 없이 파기</li>
          <li>로그 기록: 최대 12개월 보관 후 익명화 또는 파기</li>
          <li>법령에 따른 보관이 필요한 경우: 해당 법령에서 정한 기간 동안 보관</li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="privacy-rights">
        <h2 id="privacy-rights">4. 이용자의 권리</h2>
        <p>
          이용자는 언제든지 개인정보 열람, 정정, 삭제, 처리 정지를 요청할 수 있으며, 문의는
          <a href="mailto:ellie@elliesbang.kr"> ellie@elliesbang.kr</a> 로 접수하실 수 있습니다.
        </p>
      </section>

      <section class="legal-section" aria-labelledby="privacy-security">
        <h2 id="privacy-security">5. 개인정보 보호를 위한 노력</h2>
        <ul>
          <li>데이터 전송 구간 암호화 및 접근 권한 최소화</li>
          <li>정기적인 보안 점검 및 취약점 대응</li>
          <li>외부 위탁 시 계약을 통한 안전성 확보</li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="privacy-update">
        <h2 id="privacy-update">6. 정책 변경</h2>
        <p>
          본 정책은 법령이나 서비스 운영 정책에 따라 변경될 수 있으며, 중요한 변경 사항은 최소 7일 전에
          공지합니다. 최신 버전은 본 페이지에서 확인할 수 있습니다.
        </p>
      </section>

      <footer class="legal-page__footer">
        <p class="legal-page__contact">
          문의: <a href="mailto:ellie@elliesbang.kr">ellie@elliesbang.kr</a>
        </p>
        <p class="legal-page__copyright">© {currentYear} elliesbang. All rights reserved.</p>
        <a class="legal-page__back" href="/">← 에디터로 돌아가기</a>
      </footer>
    </main>
  )
})

app.get('/terms', (c) => {
  const currentYear = new Date().getFullYear()

  return c.render(
    <main class="legal-page" aria-labelledby="terms-heading">
      <header class="legal-page__header">
        <p class="legal-page__eyebrow">Terms of Service</p>
        <h1 class="legal-page__title" id="terms-heading">
          Easy Image Editor 이용약관
        </h1>
        <p class="legal-page__meta">시행일: 2025년 10월 2일</p>
        <p class="legal-page__lead">
          본 약관은 Easy Image Editor가 제공하는 모든 서비스의 이용 조건과 절차, 이용자와 서비스의 권리·의무 및 책임사항을 규정합니다.
        </p>
      </header>

      <section class="legal-section" aria-labelledby="terms-usage">
        <h2 id="terms-usage">1. 서비스 이용</h2>
        <ul>
          <li>서비스는 브라우저를 통해 이미지 편집 기능을 제공합니다.</li>
          <li>이용자는 비상업적·상업적 목적 등 합법적인 사용 범위 내에서 서비스를 이용할 수 있습니다.</li>
          <li>서비스 운영상 불가피하거나 기술적 필요가 있는 경우 기능이 변경되거나 중단될 수 있습니다.</li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="terms-account">
        <h2 id="terms-account">2. 계정 및 보안</h2>
        <ul>
          <li>회원은 이메일 또는 Google 계정으로 로그인할 수 있으며, 계정 정보는 정확하고 최신 상태로 유지해야 합니다.</li>
          <li>계정 보안은 이용자의 책임이며, 비밀번호·인증정보 유출 시 즉시 서비스에 알려야 합니다.</li>
          <li>서비스는 부정 사용이 확인될 경우 사전 통지 없이 이용을 제한할 수 있습니다.</li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="terms-content">
        <h2 id="terms-content">3. 콘텐츠 및 지식재산권</h2>
        <ul>
          <li>이용자가 업로드한 이미지의 권리는 이용자에게 있으며, 서비스는 작업을 처리하기 위한 용도로만 이미지를 다룹니다.</li>
          <li>서비스가 제공하는 UI, 로고, 소프트웨어 등 모든 지식재산권은 서비스 운영자에게 있습니다.</li>
          <li>허용되지 않은 복제, 배포, 역설계는 금지됩니다.</li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="terms-liability">
        <h2 id="terms-liability">4. 책임의 한계</h2>
        <ul>
          <li>서비스는 합리적인 수준에서 안정적인 제공을 위해 노력하지만, 천재지변, 통신 장애 등 불가항력으로 인한 손해에 대해서는 책임을 지지 않습니다.</li>
          <li>이용자가 약관을 위반하거나 법령을 위반하여 발생한 문제에 대해서는 이용자 본인에게 책임이 있습니다.</li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="terms-termination">
        <h2 id="terms-termination">5. 이용 계약의 해지</h2>
        <ul>
          <li>이용자는 언제든지 서비스 내 탈퇴 기능 또는 이메일 문의를 통해 계약 해지를 요청할 수 있습니다.</li>
          <li>서비스는 이용자가 약관을 위반하거나 타인의 권리를 침해한 경우 사전 통지 후 이용을 제한하거나 계약을 해지할 수 있습니다.</li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="terms-governing">
        <h2 id="terms-governing">6. 준거법 및 분쟁 해결</h2>
        <p>
          본 약관은 대한민국 법령을 준거법으로 하며, 서비스와 이용자 간 분쟁이 발생할 경우 상호 협의를 통해 해결합니다.
          합의가 이루어지지 않는 경우 민사소송법상의 관할 법원에 제소할 수 있습니다.
        </p>
      </section>

      <footer class="legal-page__footer">
        <p class="legal-page__contact">
          문의: <a href="mailto:ellie@elliesbang.kr">ellie@elliesbang.kr</a>
        </p>
        <p class="legal-page__copyright">© {currentYear} elliesbang. All rights reserved.</p>
        <a class="legal-page__back" href="/">← 에디터로 돌아가기</a>
      </footer>
    </main>
  )
})

app.get('/cookies', (c) => {
  const currentYear = new Date().getFullYear()

  return c.render(
    <main class="legal-page" aria-labelledby="cookies-heading">
      <header class="legal-page__header">
        <p class="legal-page__eyebrow">Cookie Policy</p>
        <h1 class="legal-page__title" id="cookies-heading">
          Easy Image Editor 쿠키 정책
        </h1>
        <p class="legal-page__meta">시행일: 2025년 10월 2일</p>
        <p class="legal-page__lead">
          본 쿠키 정책은 Easy Image Editor(이하 “서비스”)가 이용자의 디바이스에 저장하는 쿠키의 종류와 사용 목적,
          관리 방법을 안내하기 위해 마련되었습니다.
        </p>
      </header>

      <section class="legal-section" aria-labelledby="cookies-what">
        <h2 id="cookies-what">1. 쿠키란 무엇인가요?</h2>
        <p>
          쿠키는 웹사이트 방문 시 브라우저에 저장되는 소량의 텍스트 파일로, 서비스 기능 제공과 이용자 경험 개선을 위해
          사용됩니다. 쿠키는 이용자를 식별하거나 개인 정보를 저장하지 않습니다.
        </p>
      </section>

      <section class="legal-section" aria-labelledby="cookies-types">
        <h2 id="cookies-types">2. 사용 중인 쿠키의 종류</h2>
        <ul>
          <li>
            <strong>필수 쿠키</strong>: 로그인 유지, 작업 내역 저장 등 기본 기능을 제공하기 위해 항상 활성화됩니다.
          </li>
          <li>
            <strong>분석 쿠키</strong>: 기능 개선과 오류 파악을 위해 이용 패턴을 익명으로 수집합니다. 이용자가 직접 동의한 경우에만 사용합니다.
          </li>
          <li>
            <strong>마케팅 쿠키</strong>: 신규 기능 또는 프로모션을 안내하기 위한 정보 수집에 활용되며, 추후 캠페인 목적에 한해 사용됩니다.
          </li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="cookies-control">
        <h2 id="cookies-control">3. 쿠키 관리 방법</h2>
        <ul>
          <li>브라우저 설정에서 쿠키 저장을 차단하거나 삭제할 수 있습니다. 단, 필수 쿠키를 차단할 경우 일부 기능이 제한될 수 있습니다.</li>
          <li>서비스 내 쿠키 배너에서 분석/마케팅 쿠키 사용 여부를 언제든지 변경할 수 있습니다.</li>
          <li>이미 동의한 선택 쿠키는 브라우저 저장소 삭제 시 초기화됩니다.</li>
        </ul>
      </section>

      <section class="legal-section" aria-labelledby="cookies-retention">
        <h2 id="cookies-retention">4. 쿠키 보관 기간</h2>
        <p>
          필수 쿠키는 세션 종료 시까지 또는 서비스 이용을 위해 필요한 기간 동안 보관됩니다. 선택 쿠키는 최대 12개월 동안 유지하며,
          기간 만료 후 자동으로 삭제되거나 재동의를 요청합니다.
        </p>
      </section>

      <section class="legal-section" aria-labelledby="cookies-contact">
        <h2 id="cookies-contact">5. 문의</h2>
        <p>
          쿠키 정책에 관한 문의는 <a href="mailto:ellie@elliesbang.kr">ellie@elliesbang.kr</a> 로 연락 주시면 신속히 안내드리겠습니다.
        </p>
      </section>

      <footer class="legal-page__footer">
        <p class="legal-page__contact">
          문의: <a href="mailto:ellie@elliesbang.kr">ellie@elliesbang.kr</a>
        </p>
        <p class="legal-page__copyright">© {currentYear} elliesbang. All rights reserved.</p>
        <a class="legal-page__back" href="/">← 에디터로 돌아가기</a>
      </footer>
    </main>
  )
})

app.get('/dashboard', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.redirect('/')
  }
  const ADMIN_LOGIN_EMAIL = adminEmail
  const dashboardPage = `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>관리자 대시보드 | 미치나 챌린지 관리</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              elliePrimary: '#fef568',
              ellieBackground: '#f5eee9',
              ellieText: '#333333',
            },
            fontFamily: {
              pretendard: ['Pretendard', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
            },
          },
        },
      };
    </script>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background-color: #f5eee9;
        color: #333333;
      }
      .card-surface {
        box-shadow: 0 24px 50px -36px rgba(50, 32, 0, 0.4);
      }
      .pill-muted {
        background: rgba(254, 245, 104, 0.55);
      }
    </style>
  </head>
  <body data-admin-email="${ADMIN_LOGIN_EMAIL}" class="bg-ellieBackground text-ellieText">
    <div class="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
      <div
        data-role="dashboard-toast"
        class="hidden w-full max-w-sm rounded-2xl bg-[#333]/90 px-5 py-4 text-sm font-medium text-white shadow-2xl backdrop-blur"
        role="status"
        aria-live="assertive"
      ></div>
    </div>
    <div class="flex min-h-screen flex-col">
      <header class="bg-elliePrimary/90 shadow-sm backdrop-blur">
        <div class="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.28em] text-[#8a6c00]">Ellie's Bang</p>
            <h1 class="mt-2 text-3xl font-bold text-[#5b4100] md:text-4xl">관리자 대시보드</h1>
            <p data-role="welcome" class="mt-3 max-w-2xl text-sm text-[#7a5a00]">
              관리자 전용 대시보드 영역입니다.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <span
              data-role="session-info"
              class="pill-muted rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-widest text-[#7c5a00]"
            >
              세션 정보 확인 중
            </span>
            <button
              type="button"
              data-role="logout"
              class="rounded-full bg-[#333] px-6 py-2.5 text-sm font-semibold text-[#fef568] shadow-md transition hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f1cc2b]"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>
      <main class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-7 px-6 py-10">
        <section class="grid grid-cols-1 gap-7 lg:grid-cols-2">
          <article class="card-surface rounded-3xl bg-white/90 p-6 shadow-lg backdrop-blur" aria-labelledby="dashboard-period">
            <div class="flex items-start justify-between gap-4">
              <h2 id="dashboard-period" class="text-xl font-semibold text-[#2f2f2f]">챌린지 기간 설정</h2>
              <span
                data-role="period-status"
                class="rounded-full bg-[#fef568]/60 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[#6b4b00]"
              >
                기간 미설정
              </span>
            </div>
            <p data-role="period-summary" class="mt-3 text-sm leading-relaxed text-[#555]">
              시작일과 종료일을 선택한 뒤 저장하면 챌린지 기준 기간이 업데이트됩니다.
            </p>
            <form class="mt-6 grid gap-4 md:grid-cols-2" data-role="period-form">
              <label class="flex flex-col gap-2 text-sm font-medium text-[#3f3f3f]">
                시작일
                <input
                  type="date"
                  required
                  data-role="period-start"
                  class="rounded-2xl border border-[#f0dba5] bg-[#fefdf4] px-3 py-2 text-sm text-[#333] shadow-inner focus:border-[#f1cc2b] focus:outline-none focus:ring-2 focus:ring-[#fef568]"
                />
              </label>
              <label class="flex flex-col gap-2 text-sm font-medium text-[#3f3f3f]">
                종료일
                <input
                  type="date"
                  required
                  data-role="period-end"
                  class="rounded-2xl border border-[#f0dba5] bg-[#fefdf4] px-3 py-2 text-sm text-[#333] shadow-inner focus:border-[#f1cc2b] focus:outline-none focus:ring-2 focus:ring-[#fef568]"
                />
              </label>
              <div class="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
                <p data-role="period-updated" class="text-xs text-[#777]">최근 업데이트 정보가 여기에 표시됩니다.</p>
                <button
                  type="submit"
                  class="rounded-full bg-[#fef568] px-5 py-2 text-sm font-semibold text-[#333] transition hover:bg-[#fbe642] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f1cc2b]"
                  data-role="period-submit"
                >
                  저장
                </button>
              </div>
            </form>
          </article>
          <article class="card-surface rounded-3xl bg-white/90 p-6 shadow-lg backdrop-blur" aria-labelledby="dashboard-upload">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 id="dashboard-upload" class="text-xl font-semibold text-[#2f2f2f]">참가자 명단 업로드</h2>
                <p class="mt-2 text-sm text-[#555]">CSV 파일을 업로드하면 참가자 테이블이 자동으로 갱신됩니다.</p>
              </div>
            </div>
            <form class="mt-5 space-y-4" data-role="participants-form">
              <div>
                <label class="flex flex-col gap-2 text-sm font-medium text-[#3f3f3f]">
                  CSV 파일 선택
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    data-role="participants-file"
                    class="block w-full cursor-pointer rounded-2xl border border-dashed border-[#f0dba5] bg-[#fefdf4] px-3 py-3 text-sm text-[#333] transition hover:border-[#f1cc2b] focus:border-[#f1cc2b] focus:outline-none"
                  />
                </label>
              </div>
              <button
                type="submit"
                class="w-full rounded-full bg-[#333] px-4 py-2.5 text-sm font-semibold text-[#fef568] transition hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fef568]"
              >
                업로드
              </button>
            </form>
            <div class="mt-6">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-[#444]">업로드 결과</h3>
                <span data-role="participants-count" class="text-xs text-[#777]">0명</span>
              </div>
              <p data-role="participants-message" class="mt-1 text-xs text-[#777]">
                최근 업로드 내역이 여기에 표시됩니다.
              </p>
              <div class="mt-3 max-h-64 overflow-y-auto rounded-3xl border border-[#f0dba5] bg-[#fefdf4]/70">
                <table class="min-w-full divide-y divide-[#f0dba5] text-left text-sm text-[#333]">
                  <thead class="bg-[#fef568]/60 text-xs font-semibold uppercase tracking-widest text-[#6b4b00]">
                    <tr>
                      <th scope="col" class="px-4 py-3">이름</th>
                      <th scope="col" class="px-4 py-3">이메일</th>
                      <th scope="col" class="px-4 py-3">역할</th>
                      <th scope="col" class="px-4 py-3">등록일</th>
                    </tr>
                  </thead>
                  <tbody data-role="participants-table" class="divide-y divide-[#f0dba5]/80 bg-white">
                    <tr>
                      <td colspan="4" class="px-4 py-6 text-center text-sm text-[#777]">
                        등록된 참가자 정보가 없습니다.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </article>
          <article class="card-surface rounded-3xl bg-white/90 p-6 shadow-lg backdrop-blur" aria-labelledby="dashboard-status">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 id="dashboard-status" class="text-xl font-semibold text-[#2f2f2f]">미치나 챌린저 참여 현황</h2>
                <p class="mt-2 text-sm text-[#555]">현재 챌린지 기간과 비교한 참여자 상태를 확인하세요.</p>
              </div>
              <span
                data-role="status-period"
                class="rounded-full bg-[#fef568]/60 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[#6b4b00]"
              >
                데이터 준비 중
              </span>
            </div>
            <div class="mt-6 grid grid-cols-3 gap-3 text-center text-sm font-semibold text-[#333]">
              <div class="rounded-3xl bg-[#fef568]/60 px-4 py-5">
                <p class="text-xs uppercase tracking-wide text-[#6b4b00]">전체</p>
                <p data-role="status-total" class="mt-2 text-3xl font-bold text-[#2f2f2f]">0</p>
              </div>
              <div class="rounded-3xl bg-[#d6f8a1]/70 px-4 py-5">
                <p class="text-xs uppercase tracking-wide text-[#3f6212]">진행</p>
                <p data-role="status-active" class="mt-2 text-3xl font-bold text-[#245501]">0</p>
              </div>
              <div class="rounded-3xl bg-[#fcd1c5]/70 px-4 py-5">
                <p class="text-xs uppercase tracking-wide text-[#9a3412]">종료</p>
                <p data-role="status-expired" class="mt-2 text-3xl font-bold text-[#7c2d12]">0</p>
              </div>
            </div>
            <div class="mt-8 flex flex-col items-center gap-5 lg:flex-row">
              <div
                data-role="status-chart"
                class="relative h-36 w-36 rounded-full border-[12px] border-[#f5eee9] bg-[conic-gradient(#d6f8a1_0%,#fcd1c5_0%)]"
                aria-hidden="true"
              >
                <div class="absolute inset-6 rounded-full bg-white/90"></div>
                <span
                  data-role="status-chart-label"
                  class="absolute inset-0 flex items-center justify-center text-lg font-semibold text-[#333]"
                >
                  0%
                </span>
              </div>
              <ul class="flex-1 space-y-2 text-sm text-[#555]" data-role="status-description">
                <li>참여자 데이터가 수집되면 현황이 자동으로 업데이트됩니다.</li>
              </ul>
            </div>
          </article>
          <article class="card-surface rounded-3xl bg-white/90 p-6 shadow-lg backdrop-blur" aria-labelledby="dashboard-users">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 id="dashboard-users" class="text-xl font-semibold text-[#2f2f2f]">전체 사용자 DB 조회</h2>
                <p class="mt-2 text-sm text-[#555]">로그인한 모든 사용자를 최신 순으로 확인할 수 있습니다.</p>
              </div>
              <span
                data-role="users-count"
                class="rounded-full bg-[#fef568]/60 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[#6b4b00]"
              >
                0명
              </span>
            </div>
            <div class="mt-4 max-h-72 overflow-y-auto rounded-3xl border border-[#f0dba5] bg-[#fefdf4]/70">
              <table class="min-w-full divide-y divide-[#f0dba5] text-left text-sm text-[#333]">
                <thead class="bg-[#fef568]/60 text-xs font-semibold uppercase tracking-widest text-[#6b4b00]">
                  <tr>
                    <th scope="col" class="px-4 py-3">이름</th>
                    <th scope="col" class="px-4 py-3">이메일</th>
                    <th scope="col" class="px-4 py-3">역할</th>
                    <th scope="col" class="px-4 py-3">최근 로그인</th>
                  </tr>
                </thead>
                <tbody data-role="users-table" class="divide-y divide-[#f0dba5]/80 bg-white">
                  <tr>
                    <td colspan="4" class="px-4 py-6 text-center text-sm text-[#777]">불러온 사용자 정보가 없습니다.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </section>
      </main>
      <footer class="bg-transparent py-8">
        <div class="mx-auto w-full max-w-6xl px-6">
          <p class="text-center text-xs text-[#777]">
            &copy; ${new Date().getFullYear()} Ellie Image Editor. All rights reserved.
          </p>
        </div>
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
