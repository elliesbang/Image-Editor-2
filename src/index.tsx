import { Hono } from 'hono'
import type { Context } from 'hono'
import { serveStatic } from 'hono/cloudflare-pages'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { renderer } from './renderer'

type Bindings = {
  OPENAI_API_KEY?: string
  ADMIN_EMAIL?: string
  SESSION_SECRET?: string
  ADMIN_SESSION_VERSION?: string
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

const ADMIN_SESSION_COOKIE = 'admin_session'
const ADMIN_RATE_LIMIT_KEY_PREFIX = 'ratelimit:admin-login:'
const DEFAULT_ADMIN_RATE_LIMIT_MAX_ATTEMPTS = 5
const DEFAULT_ADMIN_RATE_LIMIT_WINDOW_SECONDS = 60
const DEFAULT_ADMIN_RATE_LIMIT_COOLDOWN_SECONDS = 300
const PARTICIPANT_KEY_PREFIX = 'participant:'
const REQUIRED_SUBMISSIONS = 15
const CHALLENGE_DURATION_BUSINESS_DAYS = 15
const DEFAULT_GOOGLE_REDIRECT_URI = 'https://project-9cf3a0d0.pages.dev/api/auth/callback/google'
const ADMIN_OAUTH_STATE_COOKIE = 'admin_oauth_state'
const MICHINA_PERIOD_KEY = 'michina:period'
const MICHINA_CHALLENGERS_KEY = 'michina:challengers'
const MICHINA_USERS_KEY = 'michina:users'

const sessionEncoder = new TextEncoder()
const sessionDecoder = new TextDecoder()

function base64UrlEncode(data: Uint8Array) {
  let binary = ''
  for (const byte of data) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4)
  const padded = normalized + '='.repeat(padding)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const sessionKeyCache = new Map<string, CryptoKey>()

async function getSessionCryptoKey(secret: string) {
  const cached = sessionKeyCache.get(secret)
  if (cached) {
    return cached
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', sessionEncoder.encode(secret))
  const key = await crypto.subtle.importKey('raw', hashBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  sessionKeyCache.set(secret, key)
  return key
}

async function encryptSessionValue(value: string, secret: string) {
  const key = await getSessionCryptoKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, sessionEncoder.encode(value))
  const encryptedBytes = new Uint8Array(encryptedBuffer)
  const combined = new Uint8Array(iv.length + encryptedBytes.length)
  combined.set(iv, 0)
  combined.set(encryptedBytes, iv.length)
  return base64UrlEncode(combined)
}

async function decryptSessionValue(token: string, secret: string) {
  try {
    const key = await getSessionCryptoKey(secret)
    const combined = base64UrlDecode(token)
    if (combined.length <= 12) {
      return null
    }
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    return sessionDecoder.decode(new Uint8Array(decryptedBuffer))
  } catch (error) {
    console.warn('[auth] Failed to decrypt admin session', error)
    return null
  }
}

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
    <link
      href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        color-scheme: light;
        font-family: 'Pretendard','Noto Sans KR',sans-serif;
        background-color: #f5eee9;
        color: #333333;
      }
      *, *::before, *::after {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: #f5eee9;
        color: #333333;
      }
      a {
        color: inherit;
        text-decoration: none;
      }
      button {
        font-family: inherit;
      }
      .admin-header {
        background: #fef568;
        padding: 20px 24px;
        font-weight: 600;
        font-size: 1.2rem;
        text-align: center;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
      }
      .admin-layout {
        display: flex;
        min-height: calc(100vh - 72px);
      }
      .admin-sidebar {
        width: 240px;
        background: #ffffff;
        border-right: 2px solid #fef568;
        padding: 20px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .admin-sidebar button {
        border: none;
        background: #ffffff;
        padding: 12px 14px;
        text-align: left;
        border-radius: 10px;
        font-weight: 600;
        color: #333333;
        cursor: pointer;
        transition: background 0.2s ease, box-shadow 0.2s ease;
      }
      .admin-sidebar button:hover {
        background: #fef568;
        box-shadow: 0 4px 12px -8px rgba(0, 0, 0, 0.2);
      }
      .admin-sidebar button.is-active {
        background: #fef568;
        box-shadow: 0 10px 18px -12px rgba(0, 0, 0, 0.35);
      }
      .admin-content {
        flex: 1;
        padding: 28px 36px 80px;
        display: block;
      }
      .card {
        background: #ffffff;
        border: 1px solid #fef568;
        border-radius: 14px;
        padding: 24px;
        margin-bottom: 28px;
        box-shadow: 0 18px 32px -24px rgba(0, 0, 0, 0.35);
      }
      .card h2 {
        margin: 0 0 12px;
        font-size: 1.2rem;
        font-weight: 700;
      }
      .admin-description {
        margin: 0 0 18px;
        color: #555555;
        font-size: 0.95rem;
        line-height: 1.55;
      }
      .form-grid {
        display: grid;
        gap: 16px;
        max-width: 360px;
      }
      .form-grid label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-weight: 600;
        color: #333333;
      }
      .form-grid input[type="date"] {
        border: 1px solid rgba(254, 245, 104, 0.8);
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 1rem;
        background: #ffffff;
        color: #333333;
      }
      .admin-action {
        margin-top: 4px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: none;
        border-radius: 10px;
        background: #fef568;
        color: #333333;
        padding: 10px 16px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .admin-action:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 18px -14px rgba(0, 0, 0, 0.35);
      }
      .admin-action--ghost {
        background: transparent;
        border: 1px solid rgba(0, 0, 0, 0.12);
      }
      .admin-summary {
        margin: 18px 0 6px;
        font-weight: 600;
        color: #333333;
      }
      .admin-hint {
        margin: 8px 0 0;
        font-size: 0.9rem;
        color: #666666;
      }
      .admin-hint[hidden] {
        display: none;
      }
      .admin-hint[data-tone="success"] {
        color: #1b6b2c;
      }
      .admin-hint[data-tone="danger"] {
        color: #c02629;
      }
      .admin-hint[data-tone="warning"] {
        color: #a16207;
      }
      .admin-hint[data-tone="info"] {
        color: #555555;
      }
      .admin-tag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 18px;
      }
      .admin-tag {
        padding: 6px 10px;
        border-radius: 999px;
        background: #fff1b3;
        border: 1px solid #fef568;
        font-size: 0.85rem;
        color: #333333;
      }
      .admin-empty {
        color: #777777;
        font-size: 0.95rem;
        margin-top: 12px;
      }
      .admin-table-wrapper {
        overflow-x: auto;
        margin-top: 18px;
        border-radius: 12px;
        border: 1px solid rgba(254, 245, 104, 0.4);
      }
      .admin-table {
        width: 100%;
        border-collapse: collapse;
        min-width: 420px;
      }
      .admin-table th,
      .admin-table td {
        padding: 12px 14px;
        text-align: left;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      }
      .admin-table th {
        background: rgba(254, 245, 104, 0.3);
        font-weight: 600;
      }
      .admin-table tbody tr:nth-child(even) {
        background: rgba(245, 238, 233, 0.6);
      }
      .admin-toast {
        position: fixed;
        right: 24px;
        bottom: 24px;
        background: #333333;
        color: #ffffff;
        padding: 14px 18px;
        border-radius: 12px;
        box-shadow: 0 22px 34px -22px rgba(0, 0, 0, 0.45);
        font-size: 0.95rem;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 1200;
      }
      .admin-toast[hidden] {
        display: none;
      }
      .admin-toast[data-tone="success"] {
        background: #1b6b2c;
      }
      .admin-toast[data-tone="danger"] {
        background: #c02629;
      }
      .admin-toast[data-tone="warning"] {
        background: #a16207;
      }
      .admin-view {
        display: none;
      }
      .admin-view.is-active {
        display: block;
      }
      .card--center {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 220px;
        gap: 12px;
      }
      .admin-upload {
        display: inline-flex;
        flex-direction: column;
        gap: 8px;
        font-weight: 600;
        color: #333333;
      }
      .admin-upload input[type="file"] {
        border: 1px dashed rgba(254, 245, 104, 0.6);
        border-radius: 12px;
        padding: 18px;
        background: rgba(254, 245, 104, 0.1);
        cursor: pointer;
      }
      @media (max-width: 960px) {
        .admin-layout {
          flex-direction: column;
        }
        .admin-sidebar {
          width: auto;
          flex-direction: row;
          flex-wrap: wrap;
          gap: 8px;
          border-right: none;
          border-bottom: 2px solid #fef568;
        }
        .admin-sidebar button {
          flex: 1 1 160px;
        }
        .admin-content {
          padding: 24px 16px 72px;
        }
        .admin-table {
          min-width: 320px;
        }
      }
    </style>
  </head>
  <body>
    <header class="admin-header">관리자 대시보드 | 미치나 챌린지 관리</header>
    <div class="admin-layout">
      <aside class="admin-sidebar" aria-label="관리자 메뉴">
        <button type="button" data-view="period" class="is-active">📅 미치나 기간 설정</button>
        <button type="button" data-view="upload">📂 챌린저 명단 업로드</button>
        <button type="button" data-view="status">👥 챌린저 현황 보기</button>
        <button type="button" data-view="users">🔐 로그인 DB 보기</button>
        <button type="button" data-view="plans">💳 구독 플랜 보기 (준비 중)</button>
      </aside>
      <main class="admin-content">
        <div class="admin-toast" data-role="admin-toast" hidden></div>
        <section class="admin-view is-active" data-admin-view="period">
          <div class="card">
            <h2>📅 미치나 챌린지 기간 설정</h2>
            <p class="admin-description">시작일과 종료일을 지정하면 미치나 챌린저 등급 부여가 해당 기간에 자동으로 적용됩니다.</p>
            <form class="form-grid" data-role="period-form">
              <label>시작일
                <input type="date" data-role="period-start" required />
              </label>
              <label>종료일
                <input type="date" data-role="period-end" required />
              </label>
              <button class="admin-action" type="submit">기간 저장</button>
            </form>
            <p class="admin-summary" data-role="period-summary">저장된 기간이 없습니다.</p>
            <p class="admin-hint" data-role="period-meta" hidden></p>
            <p class="admin-hint" data-role="period-status" hidden></p>
            <button class="admin-action admin-action--ghost" type="button" data-action="refresh-view" data-target="period">기간 새로고침</button>
          </div>
        </section>
        <section class="admin-view" data-admin-view="upload">
          <div class="card">
            <h2>📂 챌린저 명단 업로드</h2>
            <p class="admin-description">CSV 또는 XLSX 파일에서 이메일 주소를 추출해 챌린저 명단을 업데이트합니다. 기존 명단은 새 데이터로 교체됩니다.</p>
            <label class="admin-upload">챌린저 명단 파일 선택
              <input type="file" accept=".csv,.xlsx" data-role="challenger-upload" />
            </label>
            <p class="admin-hint" data-role="upload-status" hidden></p>
            <p class="admin-hint" data-role="challenger-meta" hidden></p>
            <div class="admin-tag-list" data-role="challenger-list" aria-live="polite"></div>
            <button class="admin-action admin-action--ghost" type="button" data-action="refresh-view" data-target="challengers">명단 새로고침</button>
          </div>
        </section>
        <section class="admin-view" data-admin-view="status">
          <div class="card">
            <h2>👥 챌린저 현황 보기</h2>
            <p class="admin-description">업로드된 명단은 챌린저 자동 등급 부여에 사용됩니다.</p>
            <p class="admin-summary">등록된 챌린저: <strong data-role="status-count">0</strong>명</p>
            <div class="admin-table-wrapper">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th scope="col">No.</th>
                    <th scope="col">이메일</th>
                  </tr>
                </thead>
                <tbody data-role="status-table">
                  <tr><td colspan="2" class="admin-empty">아직 등록된 명단이 없습니다.</td></tr>
                </tbody>
              </table>
            </div>
            <button class="admin-action admin-action--ghost" type="button" data-action="refresh-view" data-target="challengers">현황 새로고침</button>
          </div>
        </section>
        <section class="admin-view" data-admin-view="users">
          <div class="card">
            <h2>🔐 로그인 DB 보기</h2>
            <p class="admin-description">/api/users 엔드포인트에서 최신 로그인 정보를 조회합니다.</p>
            <div class="admin-table-wrapper">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th scope="col">이름</th>
                    <th scope="col">이메일</th>
                    <th scope="col">가입일</th>
                    <th scope="col">등급</th>
                  </tr>
                </thead>
                <tbody data-role="users-table">
                  <tr><td colspan="4" class="admin-empty">데이터를 불러오는 중입니다…</td></tr>
                </tbody>
              </table>
            </div>
            <button class="admin-action admin-action--ghost" type="button" data-action="refresh-view" data-target="users">DB 새로고침</button>
          </div>
        </section>
        <section class="admin-view" data-admin-view="plans">
          <div class="card card--center">
            <h2>💳 구독 플랜 보기</h2>
            <p class="admin-description" data-role="plans-message">현재 등록된 구독 목록 보기 기능은 준비 중입니다.</p>
            <p class="admin-hint admin-empty">추후 /api/plans 연동 시 자동으로 업데이트됩니다.</p>
          </div>
        </section>
      </main>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" defer></script>
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

async function requireAdminSession(
  c: Context<{ Bindings: Bindings }>,
  config?: AdminConfig,
): Promise<string | null> {
  const token = getCookie(c, ADMIN_SESSION_COOKIE)
  if (!token) {
    return null
  }
  const adminConfig = config ?? getAdminConfig(c.env)
  if (!adminConfig) {
    clearAdminSession(c)
    return null
  }
  try {
    const decrypted = await decryptSessionValue(token, adminConfig.sessionSecret)
    if (!decrypted) {
      clearAdminSession(c)
      return null
    }
    const payload = JSON.parse(decrypted) as { email?: string; role?: string }
    const normalizedEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
    if (!normalizedEmail || normalizedEmail !== adminConfig.email) {
      clearAdminSession(c)
      return null
    }
    if (payload.role !== 'admin') {
      clearAdminSession(c)
      return null
    }
    return normalizedEmail
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
  const expiresInSeconds = 60 * 60 * 24 * 7
  const issuedAt = Math.floor(Date.now() / 1000)
  const exp = issuedAt + expiresInSeconds
  const sessionPayload = JSON.stringify({ email: normalizedEmail, role: 'admin' })
  const encryptedSession = await encryptSessionValue(sessionPayload, adminConfig.sessionSecret)
  setCookie(c, ADMIN_SESSION_COOKIE, encryptedSession, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    path: '/',
    maxAge: expiresInSeconds,
  })
  return { exp, iat: issuedAt }
}

function clearAdminSession(c: Context<{ Bindings: Bindings }>) {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: '/', secure: true, sameSite: 'None' })
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', async (c, next) => {
  await next()

  const csp = [
    "default-src 'self'",
    "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://accounts.google.com https://apis.google.com https://www.gstatic.com",
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

app.get('/auth/google', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID?.trim()
  const redirectUri = resolveGoogleRedirectUri(c)

  if (!clientId) {
    const response = c.html(
      renderAdminOAuthPage({
        title: 'Google 로그인 구성 오류',
        message: 'Google OAuth 클라이언트가 구성되지 않았습니다. 관리자에게 문의해 주세요.',
        scriptContent:
          "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'google_client_missing' }, window.location.origin); } catch (error) { console.warn('failed to notify opener about missing google client', error); } } window.location.replace('/'); }, 1800);",
      }),
      500,
    )
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const state = generateRandomState()
  setCookie(c, ADMIN_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge: 600,
  })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  })

  const authorizeUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  return c.redirect(authorizeUrl, 302)
})

app.get('/api/auth/callback/google', async (c) => {
  const storedState = getCookie(c, ADMIN_OAUTH_STATE_COOKIE) ?? ''
  deleteCookie(c, ADMIN_OAUTH_STATE_COOKIE, { path: '/', sameSite: 'Lax', secure: true })

  const stateParam = (c.req.query('state') || '').trim()
  if (!stateParam || !storedState || stateParam !== storedState) {
    const response = c.html(
      renderAdminOAuthPage({
        title: '로그인 세션이 만료되었습니다',
        message: '인증 요청이 만료되었습니다. 다시 로그인해주세요.',
        scriptContent:
          "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'state_mismatch' }, window.location.origin); } catch (error) { console.warn('failed to notify opener about state mismatch', error); } } window.location.replace('/'); }, 1400);",
      }),
      400,
    )
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const code = (c.req.query('code') || '').trim()
  if (!code) {
    const response = c.html(
      renderAdminOAuthPage({
        title: '인증 코드가 전달되지 않았습니다',
        message: 'Google 로그인에서 인증 코드를 확인하지 못했습니다.',
        scriptContent:
          "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'code_missing' }, window.location.origin); } catch (error) { console.warn('failed to notify opener about missing code', error); } } window.location.replace('/'); }, 1600);",
      }),
      400,
    )
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const clientId = c.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET?.trim()
  const redirectUri = resolveGoogleRedirectUri(c)

  if (!clientId || !clientSecret) {
    const response = c.html(
      renderAdminOAuthPage({
        title: 'Google 로그인 구성 오류',
        message: 'Google OAuth 자격 증명이 올바르게 구성되지 않았습니다.',
        scriptContent:
          "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'google_config_missing' }, window.location.origin); } catch (error) { console.warn('failed to notify opener about config error', error); } } window.location.replace('/'); }, 1600);",
      }),
      500,
    )
    response.headers.set('Cache-Control', 'no-store')
    return response
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
      const detail = await tokenResponse.text().catch(() => '')
      const response = c.html(
        renderAdminOAuthPage({
          title: 'Google 인증에 실패했습니다',
          message: 'Google 인증 서버 응답이 원활하지 않습니다. 잠시 후 다시 시도해주세요.',
          scriptContent: `window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'token_exchange_failed', detail: ${JSON.stringify('Token exchange failed')} }, window.location.origin); } catch (error) { console.warn('failed to notify opener about token failure', error); } } window.location.replace('/'); }, 1600);`,
        }),
        502,
      )
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    const tokenJson = (await tokenResponse.json()) as { id_token?: string }
    const idToken = typeof tokenJson.id_token === 'string' ? tokenJson.id_token : ''
    if (!idToken) {
      const response = c.html(
        renderAdminOAuthPage({
          title: 'ID 토큰을 확인하지 못했습니다',
          message: 'Google에서 유효한 로그인 정보를 전달하지 않았습니다.',
          scriptContent:
            "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'id_token_missing' }, window.location.origin); } catch (error) { console.warn('failed to notify opener about missing id token', error); } } window.location.replace('/'); }, 1600);",
        }),
        502,
      )
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    const idPayload = decodeGoogleIdToken(idToken)
    if (!idPayload || idPayload.aud !== clientId) {
      const response = c.html(
        renderAdminOAuthPage({
          title: '인증 정보를 확인할 수 없습니다',
          message: 'Google 인증 정보가 올바르지 않습니다.',
          scriptContent:
            "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'id_token_invalid' }, window.location.origin); } catch (error) { console.warn('failed to notify opener about invalid token', error); } } window.location.replace('/'); }, 1600);",
        }),
        401,
      )
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    if (
      idPayload.iss &&
      idPayload.iss !== 'https://accounts.google.com' &&
      idPayload.iss !== 'accounts.google.com'
    ) {
      const response = c.html(
        renderAdminOAuthPage({
          title: '인증 제공자를 확인하지 못했습니다',
          message: 'Google 인증 정보의 발급자가 올바르지 않습니다.',
          scriptContent:
            "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'issuer_invalid' }, window.location.origin); } catch (error) { console.warn('failed to notify opener about issuer', error); } } window.location.replace('/'); }, 1600);",
        }),
        401,
      )
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    const email = typeof idPayload.email === 'string' ? idPayload.email.trim().toLowerCase() : ''
    if (!isValidEmail(email) || !isGoogleEmailVerified(idPayload.email_verified)) {
      const response = c.html(
        renderAdminOAuthPage({
          title: 'Google 계정 정보를 확인하지 못했습니다',
          message: '본인 확인이 완료된 Google 계정만 관리자 인증에 사용할 수 있습니다.',
          scriptContent:
            "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'email_not_verified' }, window.location.origin); } catch (error) { console.warn('failed to notify opener about verification', error); } } window.location.replace('/'); }, 1600);",
        }),
        403,
      )
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    const adminEmail = c.env.ADMIN_EMAIL?.trim().toLowerCase() ?? ''
    if (!adminEmail) {
      const response = c.html(
        renderAdminOAuthPage({
          title: '관리자 이메일이 구성되지 않았습니다',
          message: '환경변수 ADMIN_EMAIL을 설정한 후 다시 시도해주세요.',
          scriptContent:
            "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'admin_email_missing' }, window.location.origin); } catch (error) { console.warn('failed to notify opener about admin email', error); } } window.location.replace('/'); }, 1600);",
        }),
        500,
      )
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    if (email !== adminEmail) {
      clearAdminSession(c)
      const scriptContent = `(() => {
  const message = ${JSON.stringify('관리자 전용 접근 권한이 없습니다.')};
  const origin = window.location.origin;
  try {
    const storage = window.localStorage;
    if (storage) {
      storage.removeItem('admin');
      storage.removeItem('adminSessionState');
      storage.removeItem('role');
    }
  } catch (error) {
    console.warn('failed to clear admin storage', error);
  }
  try {
    window.sessionStorage?.removeItem('adminSessionId');
  } catch (error) {
    console.warn('failed to clear admin session id', error);
  }
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage({ type: 'admin-oauth-denied', message }, origin);
    } catch (error) {
      console.warn('failed to notify opener about denied access', error);
    }
    try {
      window.opener.alert(message);
    } catch (error) {
      console.warn('failed to show alert on opener', error);
    }
    window.setTimeout(() => {
      try {
        window.opener.location.href = '/';
      } catch (error) {
        window.opener.location.replace('/');
      }
      window.close();
    }, 600);
  } else {
    window.alert(message);
    window.location.replace('/');
  }
})();`
      const response = c.html(
        renderAdminOAuthPage({
          title: '관리자 권한이 필요합니다',
          message: '해당 Google 계정은 관리자 전용 영역에 접근할 수 없습니다.',
          scriptContent,
        }),
        403,
      )
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    const adminConfig = getAdminConfig(c.env)
    if (!adminConfig) {
      const response = c.html(
        renderAdminOAuthPage({
          title: '관리자 세션을 생성하지 못했습니다',
          message: '세션 구성이 누락되었습니다. 관리자에게 문의해주세요.',
          scriptContent:
            "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'session_config_missing' }, window.location.origin); } catch (error) { console.warn('failed to notify opener about session config', error); } } window.location.replace('/'); }, 1600);",
        }),
        500,
      )
      response.headers.set('Cache-Control', 'no-store')
      return response
    }

    await createAdminSession(c, email, adminConfig)

    const response = c.redirect('/', 302)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Pragma', 'no-cache')
    return response
  } catch (error) {
    console.error('[auth/google] Unexpected error', error)
    const response = c.html(
      renderAdminOAuthPage({
        title: 'Google 인증 중 오류가 발생했습니다',
        message: '잠시 후 다시 시도해주세요.',
        scriptContent:
          "window.setTimeout(() => { if (window.opener && !window.opener.closed) { try { window.opener.postMessage({ type: 'admin-oauth-error', message: 'unexpected_error' }, window.location.origin); } catch (notifyError) { console.warn('failed to notify opener about unexpected error', notifyError); } } window.location.replace('/'); }, 1600);",
      }),
      502,
    )
    response.headers.set('Cache-Control', 'no-store')
    return response
  }
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
  const participant = await getParticipant(c.env, email)
  if (!participant) {
    return c.json({ exists: false })
  }
  const totalSubmissions = Object.keys(participant.submissions ?? {}).length
  const missingDays = Math.max(0, REQUIRED_SUBMISSIONS - totalSubmissions)
  return c.json({
    exists: true,
    participant: {
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
    },
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

  const totalSubmissions = Object.keys(updated.submissions ?? {}).length
  const missingDays = Math.max(0, REQUIRED_SUBMISSIONS - totalSubmissions)

  return c.json({
    ok: true,
    participant: {
      email: updated.email,
      name: updated.name,
      plan: updated.plan,
      startDate: updated.startDate,
      endDate: updated.endDate,
      submissions: updated.submissions,
      completed: updated.completed,
      completedAt: updated.completedAt ?? null,
      totalSubmissions,
      missingDays,
      required: REQUIRED_SUBMISSIONS,
    },
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
  const appConfig = JSON.stringify(
    {
      googleClientId,
      googleRedirectUri,
      communityUrl,
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
              <span class="login-modal__option-title" data-role="google-login-text" aria-live="polite">Google로 로그인</span>
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
            관리자 전용 Google 계정으로 로그인해 관리자 대시보드에 접근하세요.
          </p>
          <div class="admin-modal__form" data-role="admin-login-form" data-state="idle">
            <button class="btn btn--primary admin-modal__submit" type="button" data-role="admin-google-login">
              <i class="ri-google-fill" aria-hidden="true"></i>
              Google 계정으로 로그인
            </button>
            <p class="admin-modal__helper" data-role="admin-login-message" role="status" aria-live="polite"></p>
          </div>
          <div class="admin-modal__actions" data-role="admin-modal-actions" hidden>
            <p class="admin-modal__note">
              관리자 모드가 이미 활성화되어 있습니다. 아래 바로가기를 사용해 대시보드를 열거나 로그아웃할 수 있습니다.
            </p>
            <div class="admin-modal__buttons">
              <button class="btn btn--outline admin-modal__action" type="button" data-role="admin-modal-dashboard">
                대시보드 열기
              </button>
              <button class="btn btn--ghost admin-modal__action" type="button" data-role="admin-modal-logout">
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

app.get('/admin-dashboard', (c) => {
  const dashboardPage = `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ellie Image Editor Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <script src="https://cdn.tailwindcss.com?plugins=forms,typography"></script>
    <style>
      :root {
        color-scheme: light;
        font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: linear-gradient(180deg, #eef2ff 0%, #ffffff 45%, #f5f3ff 100%);
        color: #111827;
      }

      header,
      footer {
        padding: 2rem 3rem;
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(12px);
      }

      header {
        border-bottom: 1px solid rgba(79, 70, 229, 0.12);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.5rem;
      }

      .dashboard-header__titles {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }

      .dashboard-actions {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .dashboard-session {
        font-size: 0.9rem;
        color: #4b5563;
        background: rgba(99, 102, 241, 0.1);
        border-radius: 999px;
        padding: 0.4rem 0.9rem;
      }

      .dashboard-logout {
        border: none;
        border-radius: 999px;
        padding: 0.75rem 1.25rem;
        font-size: 0.95rem;
        font-weight: 600;
        color: #fff;
        background: linear-gradient(135deg, #ef4444 0%, #f97316 100%);
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .dashboard-logout:hover,
      .dashboard-logout:focus-visible {
        transform: translateY(-1px);
        box-shadow: 0 18px 36px -20px rgba(239, 68, 68, 0.5);
      }

      footer {
        border-top: 1px solid rgba(79, 70, 229, 0.12);
        text-align: center;
        font-size: 0.85rem;
        color: #6b7280;
      }

      main {
        flex: 1;
        padding: 3rem clamp(1.5rem, 4vw, 4rem);
        display: grid;
        gap: 2.5rem;
      }

      .dashboard-title {
        margin: 0;
        font-size: clamp(1.8rem, 2.3vw, 2.4rem);
        color: #312e81;
        letter-spacing: -0.01em;
      }

      .dashboard-subtitle {
        margin: 0;
        font-size: clamp(1rem, 1.3vw, 1.1rem);
        color: #4b5563;
      }

      .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 1.5rem;
      }

      .dashboard-card {
        border-radius: 1.25rem;
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(79, 70, 229, 0.14);
        box-shadow: 0 24px 40px -30px rgba(79, 70, 229, 0.45);
        padding: 1.75rem 1.6rem;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }

      .dashboard-card__title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
        color: #4338ca;
      }

      .dashboard-card__body {
        margin: 0;
        color: #4b5563;
        line-height: 1.6;
        font-size: 0.95rem;
      }

      .dashboard-card__cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        padding: 0.65rem 1.1rem;
        border-radius: 999px;
        font-size: 0.92rem;
        font-weight: 600;
        color: #fff;
        background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
        text-decoration: none;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .dashboard-card__cta:hover,
      .dashboard-card__cta:focus-visible {
        transform: translateY(-1px);
        box-shadow: 0 16px 28px -18px rgba(79, 70, 229, 0.55);
      }

      @media (max-width: 720px) {
        header,
        footer {
          padding: 1.75rem 1.5rem;
        }

        header {
          flex-direction: column;
          align-items: flex-start;
          gap: 1rem;
        }

        .dashboard-actions {
          width: 100%;
          justify-content: space-between;
        }

        main {
          padding: 2.25rem 1.5rem 3rem;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="dashboard-header__titles">
        <h1 class="dashboard-title">Ellie Image Editor Dashboard</h1>
        <p class="dashboard-subtitle" data-role="welcome">관리자 전용 대시보드 영역입니다.</p>
      </div>
      <div class="dashboard-actions">
        <span class="dashboard-session" data-role="session-info" aria-live="polite"></span>
        <button class="dashboard-logout" type="button" data-role="logout">로그아웃</button>
      </div>
    </header>
    <div class="pointer-events-none fixed inset-x-0 top-5 flex justify-center px-4">
      <div
        data-role="dashboard-toast"
        class="hidden w-full max-w-sm -translate-y-2 transform rounded-2xl bg-slate-900/90 px-5 py-4 text-sm font-medium text-white opacity-0 shadow-2xl ring-1 ring-black/10 backdrop-blur-lg transition"
        role="status"
        aria-live="assertive"
      ></div>
    </div>
    <main>
      <section class="card-grid" aria-label="관리자 기능">
        <article class="dashboard-card">
          <h2 class="dashboard-card__title">미치나 명단 업로드</h2>
          <p class="dashboard-card__body">최신 참가자 CSV 파일을 업로드해 챌린지 데이터를 업데이트하세요.</p>
        </article>
        <article class="dashboard-card">
          <h2 class="dashboard-card__title">미션 완료 현황</h2>
          <p class="dashboard-card__body">참여자별 미션 완료 상태를 확인하고 리포트를 다운로드할 수 있습니다.</p>
        </article>
        <article class="dashboard-card">
          <h2 class="dashboard-card__title">기간 설정</h2>
          <p class="dashboard-card__body">챌린지 시작일과 종료일을 선택해 진행 상황을 추적하세요.</p>
        </article>
        <article class="dashboard-card">
          <h2 class="dashboard-card__title">커뮤니티 바로가기</h2>
          <p class="dashboard-card__body">미치나 커뮤니티를 열어 참여자와 소통하세요.</p>
          <a class="dashboard-card__cta" href="/?view=community" target="_blank" rel="noopener">커뮤니티 열기</a>
        </article>
      </section>
    </main>
    <footer>
      <small>&copy; ${new Date().getFullYear()} Ellie Image Editor. All rights reserved.</small>
    </footer>
    <script type="module">
      (() => {
        const STORAGE_KEY = 'adminSessionState';
        const SESSION_ID_KEY = 'adminSessionId';
        const CHANNEL_NAME = 'admin-auth-channel';
        const ADMIN_EMAIL = ${JSON.stringify(ADMIN_LOGIN_EMAIL)};
        const LOGIN_URL = new URL('/login.html', window.location.origin).toString();

        const elements = {
          logout: document.querySelector('[data-role="logout"]'),
          toast: document.querySelector('[data-role="dashboard-toast"]'),
          welcome: document.querySelector('[data-role="welcome"]'),
          sessionInfo: document.querySelector('[data-role="session-info"]'),
        };

        let broadcast = null;
        let toastTimer = null;

        const TOAST_TONES = {
          info: 'bg-indigo-600 text-white',
          success: 'bg-emerald-600 text-white',
          warning: 'bg-amber-400 text-slate-900',
          danger: 'bg-rose-600 text-white',
        };

        function hideToast() {
          if (!(elements.toast instanceof HTMLElement)) {
            return;
          }
          window.clearTimeout(toastTimer);
          elements.toast.classList.remove('opacity-100', 'translate-y-0');
          elements.toast.classList.add('opacity-0', '-translate-y-2');
          toastTimer = window.setTimeout(() => {
            if (elements.toast) {
              elements.toast.classList.add('hidden');
            }
          }, 220);
        }

        function showToast(message, tone = 'info', duration = 4200) {
          if (!(elements.toast instanceof HTMLElement)) {
            return;
          }
          window.clearTimeout(toastTimer);
          const toneClass = TOAST_TONES[tone] || TOAST_TONES.info;
          const baseClasses = [
            'pointer-events-auto',
            'w-full',
            'max-w-sm',
            'rounded-2xl',
            'px-5',
            'py-4',
            'text-sm',
            'font-semibold',
            'shadow-2xl',
            'ring-1',
            'ring-black/10',
            'backdrop-blur-lg',
            'transition',
            'transform',
            'opacity-0',
            '-translate-y-2',
          ].join(' ');
          elements.toast.className = baseClasses + ' ' + toneClass;
          elements.toast.textContent = message;
          elements.toast.classList.remove('hidden');
          window.requestAnimationFrame(() => {
            elements.toast.classList.remove('opacity-0', '-translate-y-2');
            elements.toast.classList.add('opacity-100', 'translate-y-0');
          });
          toastTimer = window.setTimeout(() => {
            hideToast();
          }, duration);
        }

        function readStoredSession() {
          try {
            const storage = window.localStorage;
            if (!storage) return null;
            const raw = storage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            if (!parsed.loggedIn) return null;
            const email = typeof parsed.email === 'string' ? parsed.email : '';
            if (!email) return null;
            const loginTime = Number(parsed.loginTime);
            const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : '';
            return {
              loggedIn: true,
              email,
              loginTime: Number.isFinite(loginTime) ? loginTime : Date.now(),
              sessionId,
            };
          } catch (error) {
            console.warn('[admin-dashboard] failed to parse stored session', error);
            return null;
          }
        }

        function getTabSessionId() {
          try {
            return window.sessionStorage?.getItem(SESSION_ID_KEY) || '';
          } catch (error) {
            console.warn('[admin-dashboard] failed to read tab session id', error);
            return '';
          }
        }

        function ensureBroadcastChannel() {
          if (broadcast || typeof BroadcastChannel === 'undefined') {
            return;
          }
          try {
            broadcast = new BroadcastChannel(CHANNEL_NAME);
            broadcast.addEventListener('message', handleBroadcastMessage);
          } catch (error) {
            console.warn('[admin-dashboard] failed to initialize channel', error);
            broadcast = null;
          }
        }

        function updateSessionDetails(session) {
          if (elements.welcome instanceof HTMLElement) {
            elements.welcome.textContent = session.email + '님, Ellie Image Editor Dashboard에 오신 것을 환영합니다.';
          }
          if (elements.sessionInfo instanceof HTMLElement) {
            const formatted = new Intl.DateTimeFormat('ko', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            }).format(session.loginTime);
            elements.sessionInfo.textContent = '로그인 시각: ' + formatted;
          }
        }

        function redirectToLogin(message, tone = 'warning', delay = 1400) {
          showToast(message, tone, Math.max(delay, 900));
          if (elements.logout instanceof HTMLButtonElement) {
            elements.logout.disabled = true;
          }
          window.setTimeout(() => {
            window.location.replace(LOGIN_URL);
          }, Math.max(delay, 900));
        }

        function handleBroadcastMessage(event) {
          const data = event?.data;
          if (!data || typeof data !== 'object') return;
          if (data.type === 'login') {
            redirectToLogin('다른 위치에서 로그인되었습니다.', 'warning');
          } else if (data.type === 'logout') {
            redirectToLogin('다른 위치에서 로그아웃되었습니다.', 'info');
          }
        }

        function handleStorageEvent(event) {
          if (!event || event.storageArea !== window.localStorage) return;
          if (event.key === null) {
            redirectToLogin('로그인 세션이 종료되었습니다.', 'info');
            return;
          }
          if (event.key !== STORAGE_KEY) {
            return;
          }
          if (!event.newValue) {
            redirectToLogin('로그인 세션이 종료되었습니다.', 'info');
            return;
          }
          try {
            const session = JSON.parse(event.newValue);
            if (!session || session.sessionId !== getTabSessionId()) {
              redirectToLogin('다른 위치에서 로그인되었습니다.', 'warning');
            }
          } catch (error) {
            console.warn('[admin-dashboard] failed to parse sync payload', error);
          }
        }

        const activeSession = readStoredSession();
        if (!activeSession || activeSession.email !== ADMIN_EMAIL) {
          redirectToLogin('관리자 세션을 확인할 수 없습니다. 다시 로그인해주세요.', 'warning', 1200);
          return;
        }

        if (!activeSession.sessionId || activeSession.sessionId !== getTabSessionId()) {
          redirectToLogin('다른 위치에서 로그인되었습니다.', 'warning', 1200);
          return;
        }

        updateSessionDetails(activeSession);
        ensureBroadcastChannel();
        window.addEventListener('storage', handleStorageEvent);

        if (elements.logout instanceof HTMLButtonElement) {
          elements.logout.addEventListener('click', async () => {
            if (elements.logout instanceof HTMLButtonElement) {
              elements.logout.disabled = true;
              elements.logout.textContent = '로그아웃 중…';
            }
            showToast('로그아웃을 진행하고 있습니다…', 'info');
            try {
              await fetch('/api/auth/admin/logout', { method: 'POST', credentials: 'include' });
            } catch (error) {
              console.warn('[admin-dashboard] logout request failed', error);
            }
            try {
              window.localStorage?.clear();
            } catch (error) {
              console.warn('[admin-dashboard] failed to clear storage', error);
            }
            try {
              window.sessionStorage?.removeItem(SESSION_ID_KEY);
            } catch (error) {
              console.warn('[admin-dashboard] failed to clear session id', error);
            }
            ensureBroadcastChannel();
            try {
              broadcast?.postMessage({ type: 'logout' });
            } catch (error) {
              console.warn('[admin-dashboard] failed to broadcast logout', error);
            }
            showToast('로그아웃되었습니다. 로그인 페이지로 이동합니다.', 'success', 1100);
            window.setTimeout(() => {
              window.location.replace(LOGIN_URL);
            }, 1100);
          });
        }
      })();
    </script>
  </body>
</html>`

  const response = c.html(dashboardPage)
  response.headers.set('Cache-Control', 'no-store')
  return response
})

app.get('/api/health', (c) => c.json({ status: 'ok' }))

export default app
