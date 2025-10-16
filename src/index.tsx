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
  D1_MAIN?: D1Database
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
  saved_at?: string | null
  saved_by?: string | null
  updated_at?: string | null
  updated_by?: string | null
}

type ChallengePeriodRecord = {
  startDate: string
  endDate: string
  updatedAt: string
  updatedBy?: string
  savedAt?: string
  savedBy?: string
}

type ChallengePeriodSummary = ChallengePeriodRecord & { id: number }

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

type MichinaDashboardPeriodRow = {
  id: number
  start_date: string
  end_date: string
  status: string | null
  created_at: string | null
}

type MichinaDashboardPeriod = {
  id: number
  startDate: string
  endDate: string
  startDateTime: string
  endDateTime: string
  status: string
  createdAt: string
}

type MichinaDemotionLogRow = {
  id: number
  executed_at: string
  updated_count: number | null
  status: string | null
  message?: string | null
}

type MichinaDemotionLogEntry = {
  id: number
  executedAt: string
  updatedCount: number
  status: 'success' | 'failure'
  message?: string
}

type MichinaDashboardUser = {
  name: string
  email: string
  startDate?: string
  endDate?: string
  startDateTime?: string
  endDateTime?: string
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
    url.pathname = '/api/auth/callback/google'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch (error) {
    console.warn('Failed to infer Google redirect URI from request URL', error)
  }

  return DEFAULT_GOOGLE_REDIRECT_URI
}

function createGoogleClient(env: Bindings, redirectUri?: string) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    return null
  }
  const resolvedRedirectUri = (redirectUri ?? env.GOOGLE_REDIRECT_URI ?? DEFAULT_GOOGLE_REDIRECT_URI).trim()
  return new Google(clientId, clientSecret, resolvedRedirectUri)
}

function applyCorsHeaders(response: Response) {
  response.headers.set('Access-Control-Allow-Origin', '*')
  return response
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

function renderAdminDashboardPage(config: { adminEmail: string }) {
  const safeEmail = escapeHtml(config.adminEmail)
  const configJson = JSON.stringify({ adminEmail: config.adminEmail }).replace(/</g, '\\u003c')
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>관리자 대시보드 | Elliesbang</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
    />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/remixicon@4.3.0/fonts/remixicon.css" />
    <link rel="stylesheet" href="/static/admin-dashboard.css" />
  </head>
  <body>
    <div class="dashboard" data-role="dashboard-root">
      <aside class="dashboard__sidebar" aria-label="관리자 내비게이션">
        <div class="sidebar__brand">
          <span class="sidebar__logo" aria-hidden="true">🏠</span>
          <span class="sidebar__title">Elliesbang</span>
        </div>
        <nav class="sidebar__nav">
          <button type="button" class="sidebar__link is-active" data-section="period">
            <i class="ri-calendar-event-line" aria-hidden="true"></i>
            <span>기간 설정</span>
          </button>
          <button type="button" class="sidebar__link" data-section="users">
            <i class="ri-team-line" aria-hidden="true"></i>
            <span>사용자 현황</span>
          </button>
          <button type="button" class="sidebar__link" data-section="logs">
            <i class="ri-time-line" aria-hidden="true"></i>
            <span>자동 하향 로그</span>
          </button>
        </nav>
      </aside>
      <main class="dashboard__main">
        <header class="dashboard__header">
          <div class="dashboard__heading">
            <p class="dashboard__eyebrow">관리자 대시보드</p>
            <h1 class="dashboard__title">관리자 대시보드 | Elliesbang</h1>
          </div>
          <div class="dashboard__account" aria-live="polite">
            <span class="dashboard__account-label">로그인 계정</span>
            <span class="dashboard__account-value" data-role="admin-email">${safeEmail}</span>
          </div>
        </header>

        <section class="panel is-active" data-panel="period" aria-labelledby="panel-period-heading">
          <header class="panel__header">
            <h2 class="panel__title" id="panel-period-heading">📅 미치나 챌린지 기간 설정</h2>
            <p class="panel__description">시작일과 종료일을 지정해 챌린지 운영 기간을 관리하세요.</p>
          </header>
          <form class="card card--form" data-role="period-form">
            <div class="form-grid">
              <label class="form-field">
                <span class="form-field__label">시작일</span>
                <div class="form-field__control">
                  <input type="date" name="startDate" required data-role="period-start" />
                </div>
              </label>
              <label class="form-field">
                <span class="form-field__label">종료일</span>
                <div class="form-field__control">
                  <input type="date" name="endDate" required data-role="period-end" />
                </div>
              </label>
            </div>
            <p class="form-hint">선택한 종료일의 23:59:59까지 참여자가 유지됩니다.</p>
            <div class="form-actions">
              <button type="submit" class="btn btn--primary" data-role="period-submit">
                <i class="ri-save-3-line" aria-hidden="true"></i>
                <span>저장하기</span>
              </button>
            </div>
            <p class="form-status" data-role="period-status" aria-live="polite"></p>
          </form>
          <div class="card" data-role="period-history-card">
            <div class="card__toolbar">
              <div class="card__heading">
                <h3 class="card__title" id="panel-period-history-heading">최근 저장 내역</h3>
                <p class="card__caption">최대 30개의 저장 이력이 보관됩니다.</p>
              </div>
              <button type="button" class="btn btn--ghost" data-action="refresh-period-history">
                <i class="ri-refresh-line" aria-hidden="true"></i>
                <span>새로고침</span>
              </button>
            </div>
            <div class="table-wrapper">
              <table class="data-table" aria-describedby="panel-period-history-heading">
                <thead>
                  <tr>
                    <th scope="col">저장일시</th>
                    <th scope="col">시작일</th>
                    <th scope="col">종료일</th>
                    <th scope="col">저장자</th>
                    <th scope="col">관리</th>
                  </tr>
                </thead>
                <tbody data-role="period-history-tbody"></tbody>
              </table>
              <p class="empty" data-role="period-history-empty" hidden>저장 내역이 없습니다.</p>
            </div>
          </div>
        </section>

        <section class="panel" data-panel="users" aria-labelledby="panel-users-heading">
          <header class="panel__header">
            <h2 class="panel__title" id="panel-users-heading">👥 미치나 등급 사용자 현황</h2>
            <p class="panel__description">grade가 "michina"인 계정만 조회됩니다.</p>
          </header>
          <div class="card">
            <div class="card__toolbar">
              <label class="search" aria-label="이메일 검색">
                <i class="ri-search-line" aria-hidden="true"></i>
                <input type="search" placeholder="이메일 검색" data-role="user-search" />
              </label>
              <button type="button" class="btn btn--ghost" data-action="refresh-users">
                <i class="ri-refresh-line" aria-hidden="true"></i>
                <span>새로고침</span>
              </button>
            </div>
            <div class="table-wrapper">
              <table class="data-table" aria-describedby="panel-users-heading">
                <thead>
                  <tr>
                    <th scope="col">이름</th>
                    <th scope="col">이메일</th>
                    <th scope="col">시작일</th>
                    <th scope="col">종료일</th>
                    <th scope="col">남은일수</th>
                  </tr>
                </thead>
                <tbody data-role="user-tbody"></tbody>
              </table>
              <p class="empty" data-role="user-empty" hidden>표시할 사용자가 없습니다.</p>
            </div>
          </div>
        </section>

        <section class="panel" data-panel="logs" aria-labelledby="panel-logs-heading">
          <header class="panel__header">
            <h2 class="panel__title" id="panel-logs-heading">🕓 자동 하향 실행 로그</h2>
            <p class="panel__description">매일 0시에 실행된 자동 등급 변경 이력을 확인하세요.</p>
          </header>
          <div class="card">
            <div class="card__toolbar">
              <span class="card__caption">최신 순으로 정렬됩니다.</span>
              <button type="button" class="btn btn--ghost" data-action="refresh-logs">
                <i class="ri-refresh-line" aria-hidden="true"></i>
                <span>새로고침</span>
              </button>
            </div>
            <div class="table-wrapper">
              <table class="data-table" aria-describedby="panel-logs-heading">
                <thead>
                  <tr>
                    <th scope="col">실행일시</th>
                    <th scope="col">변경된 사용자 수</th>
                    <th scope="col">상태</th>
                    <th scope="col">메모</th>
                  </tr>
                </thead>
                <tbody data-role="log-tbody"></tbody>
              </table>
              <p class="empty" data-role="log-empty" hidden>최근 실행 로그가 없습니다.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
    <div class="toast" data-role="toast" hidden aria-live="assertive"></div>
    <script type="application/json" data-role="dashboard-config">${configJson}</script>
    <script type="module" src="/static/admin-dashboard.js"></script>
  </body>
</html>`
}

function renderAdminDashboardUnauthorizedPage(loginPath: string) {
  const safePath = escapeHtml(loginPath)
  const redirectScript = JSON.stringify(loginPath)
  const alertMessage = JSON.stringify('접근 권한이 없습니다')
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>접근 권한이 없습니다</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
    />
    <meta http-equiv="refresh" content="2;url=${safePath}" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f5eee9;
        color: #2b2522;
        font-family: 'Pretendard', 'Noto Sans KR', system-ui, sans-serif;
      }
      .notice {
        background: rgba(255, 255, 255, 0.88);
        border-radius: 20px;
        padding: 32px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.08);
        max-width: 360px;
        text-align: center;
      }
      .notice h1 {
        margin: 0 0 12px;
        font-size: 1.4rem;
      }
      .notice p {
        margin: 0 0 16px;
        line-height: 1.6;
        color: rgba(43, 37, 34, 0.7);
      }
      .notice a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 10px 18px;
        background: #fef568;
        color: inherit;
        border-radius: 999px;
        font-weight: 600;
        text-decoration: none;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }
      .notice a:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 24px rgba(254, 245, 104, 0.35);
      }
    </style>
  </head>
  <body>
    <div class="notice">
      <h1>접근 권한이 없습니다</h1>
      <p>관리자 로그인이 필요합니다. 잠시 후 로그인 페이지로 이동합니다.</p>
      <a href="${safePath}">
        <span>로그인 페이지로 이동</span>
        <i class="ri-external-link-line" aria-hidden="true"></i>
      </a>
    </div>
    <script>
      window.alert(${alertMessage});
      window.setTimeout(() => {
        window.location.replace(${redirectScript});
      }, 200);
    </script>
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

function toIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return ''
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  if (/\dT\d/.test(trimmed)) {
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
      return trimmed
    }
    return `${trimmed}Z`
  }
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed.replace(' ', 'T')}Z`
  }
  const parsed = Date.parse(trimmed)
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString()
  }
  return trimmed
}

function buildStartOfDayTimestamp(date: string) {
  return `${date}T00:00:00`
}

function buildEndOfDayTimestamp(date: string) {
  return `${date}T23:59:59`
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

function normalizeDeadlineDateTime(value: unknown) {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  let candidate = trimmed.replace(' ', 'T')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(candidate)) {
    candidate += ':00'
  }
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(candidate)) {
    candidate += CHALLENGE_TIMEZONE_SUFFIX
  }

  const parsed = Date.parse(candidate)
  if (!Number.isFinite(parsed)) {
    return ''
  }

  return new Date(parsed).toISOString()
}

function parseDeadlineDate(value: string | undefined | null) {
  if (!value) {
    return null
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return null
  }
  return new Date(timestamp)
}

function buildChallengeTimeline(
  period: ChallengePeriodRecord,
  options: { now?: Date; requiredDays?: number; dayDeadlines?: ChallengeDayDeadline[] } = {},
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
  const deadlines = Array.isArray(options.dayDeadlines) ? options.dayDeadlines : []
  const deadlineMap = new Map<number, ChallengeDayDeadline>()
  for (const deadline of deadlines) {
    if (Number.isFinite(deadline?.day)) {
      deadlineMap.set(Number(deadline.day), deadline)
    }
  }

  let timelineStartMs = startMs
  let timelineEndMs = endMs

  for (let index = 0; index < requiredDays; index += 1) {
    const day = index + 1
    const fallbackStartMs = startMs + index * CHALLENGE_DAY_MS
    const fallbackEndMs = Math.min(fallbackStartMs + CHALLENGE_DAY_MS - 1, endMs)
    const customDeadline = deadlineMap.get(day)
    const customStart = parseDeadlineDate(customDeadline?.startAt)
    const customEnd = parseDeadlineDate(customDeadline?.endAt)

    let dayStartMs = fallbackStartMs
    if (customStart) {
      const value = customStart.getTime()
      if (Number.isFinite(value)) {
        dayStartMs = value
      }
    }

    let dayEndMs = fallbackEndMs
    if (customEnd) {
      const value = customEnd.getTime()
      if (Number.isFinite(value)) {
        dayEndMs = Math.max(value, dayStartMs)
        dayEndMs += 59 * 1000
      }
    } else if (customStart && !customEnd) {
      dayEndMs = Math.max(dayStartMs, dayStartMs + CHALLENGE_DAY_MS - 1)
      dayEndMs = Math.min(dayEndMs, endMs)
    }

    if (!customEnd) {
      dayEndMs = Math.min(dayEndMs, fallbackEndMs)
    }

    if (dayEndMs < dayStartMs) {
      dayEndMs = dayStartMs
    }

    if (dayStartMs < timelineStartMs) {
      timelineStartMs = dayStartMs
    }
    if (dayEndMs > timelineEndMs) {
      timelineEndMs = dayEndMs
    }

    const isActiveDay = nowMs >= dayStartMs && nowMs <= dayEndMs
    const isUpcoming = nowMs < dayStartMs
    const isClosed = nowMs > dayEndMs

    days.push({
      day,
      start: formatChallengeDateTime(new Date(dayStartMs)),
      end: formatChallengeDateTime(new Date(dayEndMs)),
      isActiveDay,
      isUpcoming,
      isClosed,
    })
  }

  const activeDayState = days.find((entry) => entry.isActiveDay)
  const upcoming = nowMs < timelineStartMs
  const expired = nowMs > timelineEndMs

  return {
    start: formatChallengeDateTime(new Date(timelineStartMs)),
    end: formatChallengeDateTime(new Date(timelineEndMs)),
    now: formatChallengeDateTime(now),
    activeDay: activeDayState ? activeDayState.day : null,
    expired,
    upcoming,
    days,
  }
}

async function resolveChallengeTimeline(env: Bindings, options: { now?: Date } = {}) {
  const now = options.now ?? new Date()
  let period: ChallengePeriodRecord | null = null
  let deadlines: ChallengeDayDeadline[] = []

  const dbBinding = env.DB_MICHINA
  if (dbBinding && typeof dbBinding.prepare === 'function') {
    try {
      const [dbPeriod, dbDeadlines] = await Promise.all([
        getChallengePeriodFromDb(dbBinding),
        listChallengeDayDeadlinesFromDb(dbBinding).catch((error) => {
          console.warn('[challenge] Failed to load challenge day deadlines; continuing without overrides', error)
          return [] as ChallengeDayDeadline[]
        }),
      ])
      if (dbPeriod) {
        period = dbPeriod
      }
      if (Array.isArray(dbDeadlines) && dbDeadlines.length > 0) {
        deadlines = dbDeadlines
      }
    } catch (error) {
      console.error('[challenge] Failed to resolve challenge timeline via D1', error)
    }
  } else {
    console.warn('[challenge] D1 binding `DB_MICHINA` is not available; falling back to KV period record')
  }

  if (!period) {
    const fallback = await getMichinaPeriodRecord(env)
    if (fallback) {
      period = {
        startDate: fallback.start,
        endDate: fallback.end,
        updatedAt: fallback.updatedAt,
        updatedBy: fallback.updatedBy,
      }
    }
  }

  if (!period) {
    return null
  }

  try {
    return buildChallengeTimeline(period, {
      now,
      requiredDays: REQUIRED_SUBMISSIONS,
      dayDeadlines: deadlines,
    })
  } catch (error) {
    console.error('[challenge] Failed to resolve challenge timeline', error)
    return null
  }
}

async function listChallengeDayDeadlinesFromDb(db: D1Database): Promise<ChallengeDayDeadline[]> {
  try {
    await ensureMichinaDeadlineTable(db)
    const result = await db
      .prepare('SELECT day, start_time, end_time, updated_at FROM michina_deadline ORDER BY day ASC')
      .all<ChallengeDayDeadlineRow>()

    const rows = Array.isArray(result.results) ? result.results : []
    return rows
      .map((row) => {
        const day = Number(row.day)
        if (!Number.isFinite(day)) {
          return null
        }
        const startAt = normalizeDeadlineDateTime(row.start_time)
        const endAt = normalizeDeadlineDateTime(row.end_time)
        if (!startAt || !endAt) {
          return null
        }
        const updatedAt = typeof row.updated_at === 'string' && row.updated_at
          ? `${row.updated_at.replace(' ', 'T')}Z`
          : ''
        return { day, startAt, endAt, updatedAt }
      })
      .filter((value): value is ChallengeDayDeadline => Boolean(value))
  } catch (error) {
    const message = String(error || '')
    if (/no such table: michina_deadline/i.test(message)) {
      console.warn('[d1] michina_deadline table is not available; returning empty state')
      return []
    }
    console.error('[d1] Failed to list challenge day deadlines', error)
    throw error
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
    await ensureChallengePeriodTable(db)
    const row = await db
      .prepare('SELECT id, start_date, end_date, saved_at, saved_by FROM challenge_periods ORDER BY saved_at DESC, id DESC LIMIT 1')
      .first<ChallengePeriodRow>()
    if (!row) {
      return null
    }
    if (!row.start_date || !row.end_date) {
      return null
    }
    const updatedAt = typeof row.saved_at === 'string' && row.saved_at
      ? `${row.saved_at.replace(' ', 'T')}Z`
      : ''
    const updatedBy = typeof row.saved_by === 'string' && row.saved_by.trim() ? row.saved_by.trim() : undefined
    const period: ChallengePeriodRecord = {
      startDate: row.start_date,
      endDate: row.end_date,
      updatedAt,
    }
    if (updatedBy) {
      period.updatedBy = updatedBy
    }
    return period
  } catch (error) {
    const message = String(error || '')
    if (/no such table: challenge_periods/i.test(message)) {
      console.warn('[d1] challenge_periods table is not available; returning empty state')
      return null
    }
    console.error('[d1] Failed to load challenge period', error)
    throw error
  }
}

async function ensureDashboardChallengePeriodTable(db: D1Database) {
  await ensureChallengePeriodTable(db)
}

async function ensureChallengePeriodHistoryTable(db: D1Database) {
  await ensureChallengePeriodTable(db)
}

async function ensureMichinaDeadlineTable(db: D1Database) {
  try {
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS michina_deadline (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER, start_time TEXT, end_time TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
      )
      .run()
    try {
      await db.prepare('ALTER TABLE michina_deadline ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP').run()
    } catch (error) {
      const message = String(error || '')
      if (!/duplicate column name: updated_at/i.test(message)) {
        throw error
      }
    }
    try {
      await db.prepare('ALTER TABLE michina_deadline ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP').run()
    } catch (error) {
      const message = String(error || '')
      if (!/duplicate column name: created_at/i.test(message)) {
        throw error
      }
    }
    await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_michina_deadline_day ON michina_deadline(day)').run()
  } catch (error) {
    console.error('[d1] Failed to ensure michina_deadline table', error)
    throw error
  }
}

async function ensureParticipantsTable(db: D1Database) {
  try {
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS michina_participants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT NOT NULL, round TEXT, joined_at TEXT, role TEXT, start_date TEXT, end_date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
      )
      .run()
    try {
      await db.prepare('ALTER TABLE michina_participants ADD COLUMN round TEXT').run()
    } catch (error) {
      const message = String(error || '')
      if (!/duplicate column name: round/i.test(message)) {
        throw error
      }
    }
    try {
      await db.prepare('ALTER TABLE michina_participants ADD COLUMN start_date TEXT').run()
    } catch (error) {
      const message = String(error || '')
      if (!/duplicate column name: start_date/i.test(message)) {
        throw error
      }
    }
    try {
      await db.prepare('ALTER TABLE michina_participants ADD COLUMN end_date TEXT').run()
    } catch (error) {
      const message = String(error || '')
      if (!/duplicate column name: end_date/i.test(message)) {
        throw error
      }
    }
    try {
      await db.prepare('ALTER TABLE michina_participants ADD COLUMN role TEXT').run()
    } catch (error) {
      const message = String(error || '')
      if (!/duplicate column name: role/i.test(message)) {
        throw error
      }
    }
    try {
      await db.prepare('ALTER TABLE michina_participants ADD COLUMN joined_at TEXT').run()
    } catch (error) {
      const message = String(error || '')
      if (!/duplicate column name: joined_at/i.test(message)) {
        throw error
      }
    }
    try {
      await db.prepare('ALTER TABLE michina_participants ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP').run()
    } catch (error) {
      const message = String(error || '')
      if (!/duplicate column name: created_at/i.test(message)) {
        throw error
      }
    }
    await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_michina_participants_email ON michina_participants(email)').run()
  } catch (error) {
    console.error('[d1] Failed to ensure michina_participants table', error)
    throw error
  }
}

async function saveChallengePeriodToDb(
  db: D1Database,
  startDate: string,
  endDate: string,
  options: { updatedBy?: string } = {},
) {
  await ensureChallengePeriodTable(db)
  await db
    .prepare(
      "INSERT INTO challenge_periods (start_date, end_date, saved_at, saved_by) VALUES (?, ?, datetime('now'), ?)",
    )
    .bind(startDate, endDate, options.updatedBy ?? null)
    .run()
  return getChallengePeriodFromDb(db)
}

async function listChallengePeriodsFromDb(db: D1Database): Promise<ChallengePeriodSummary[]> {
  try {
    await ensureChallengePeriodTable(db)
    const result = await db
      .prepare('SELECT id, start_date, end_date, saved_at, saved_by FROM challenge_periods ORDER BY saved_at DESC, id DESC')
      .all<ChallengePeriodRow>()
    const rows = Array.isArray(result.results) ? result.results : []
    return rows
      .map((row) => {
        const startDate = normalizeDateColumnValue(row.start_date)
        const endDate = normalizeDateColumnValue(row.end_date)
        if (!startDate || !endDate) {
          return null
        }
        const savedAt = row.saved_at ?? ''
        const updatedAt = savedAt ? `${savedAt.replace(' ', 'T')}Z` : ''
        const updatedBy = typeof row.saved_by === 'string' && row.saved_by.trim() ? row.saved_by.trim() : undefined
        const summary: ChallengePeriodSummary = {
          id: row.id,
          startDate,
          endDate,
          updatedAt,
        }
        if (savedAt) {
          summary.savedAt = savedAt
        }
        if (updatedBy) {
          summary.updatedBy = updatedBy
          summary.savedBy = updatedBy
        }
        return summary
      })
      .filter((value): value is ChallengePeriodSummary => Boolean(value))
  } catch (error) {
    const message = String(error || '')
    if (/no such table: challenge_periods/i.test(message)) {
      console.warn('[d1] challenge_periods table is not available')
      return []
    }
    console.error('[d1] Failed to list challenge periods', error)
    throw error
  }
}

async function listParticipantsFromDb(db: D1Database, options: ParticipantListOptions = {}) {
  const { role, referenceDate } = options
  await ensureParticipantsTable(db)
  const whereClauses: string[] = []
  const params: unknown[] = []

  if (role) {
    whereClauses.push('role = ?')
    params.push(role)
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const query = `SELECT id, name, email, joined_at, role, start_date, end_date FROM michina_participants ${where} ORDER BY joined_at DESC, id DESC`
  const fallbackQuery = `SELECT id, name, email, joined_at, role FROM michina_participants ${where} ORDER BY joined_at DESC, id DESC`

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

function getMainDatabase(env: Bindings) {
  const db = env.D1_MAIN ?? env.DB_MAIN
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('D1 database binding `D1_MAIN` is not configured')
  }
  return db
}

async function ensureChallengePeriodTable(db: D1Database) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS challenge_periods (id INTEGER PRIMARY KEY AUTOINCREMENT, start_date TEXT NOT NULL, end_date TEXT NOT NULL)',
    )
    .run()
  try {
    await db.prepare("ALTER TABLE challenge_periods ADD COLUMN saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP").run()
  } catch (error) {
    const message = String(error || '')
    if (!/duplicate column name/i.test(message)) {
      throw error
    }
  }
  try {
    await db.prepare('ALTER TABLE challenge_periods ADD COLUMN saved_by TEXT').run()
  } catch (error) {
    const message = String(error || '')
    if (!/duplicate column name/i.test(message)) {
      throw error
    }
  }
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_challenge_periods_saved_at ON challenge_periods(saved_at DESC, id DESC)')
    .run()
}

async function ensureMichinaPeriodsTable(db: D1Database) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS michina_periods (id INTEGER PRIMARY KEY AUTOINCREMENT, start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    )
    .run()
  try {
    await db.prepare("ALTER TABLE michina_periods ADD COLUMN status TEXT NOT NULL DEFAULT 'active'").run()
  } catch (error) {
    const message = String(error || '')
    if (!/duplicate column name: status/i.test(message)) {
      throw error
    }
  }
  try {
    await db.prepare("ALTER TABLE michina_periods ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP").run()
  } catch (error) {
    const message = String(error || '')
    if (!/duplicate column name: created_at/i.test(message)) {
      throw error
    }
  }
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_michina_periods_created_at ON michina_periods(created_at DESC, id DESC)')
    .run()
}

async function saveMichinaPeriodRow(
  db: D1Database,
  record: { startDateTime: string; endDateTime: string; status?: string },
) {
  await ensureMichinaPeriodsTable(db)
  const status = record.status && record.status.trim() ? record.status.trim() : 'active'
  await db
    .prepare('INSERT INTO michina_periods (start_date, end_date, status) VALUES (?, ?, ?)')
    .bind(record.startDateTime, record.endDateTime, status)
    .run()
}

function mapMichinaPeriodToDashboardPeriod(record: { start: string; end: string; updatedAt?: string | null }) {
  const start = record.start.trim()
  const end = record.end.trim()
  const updatedAt = record.updatedAt && record.updatedAt.trim() ? record.updatedAt.trim() : new Date().toISOString()
  const period: MichinaDashboardPeriod = {
    id: 0,
    startDate: start,
    endDate: end,
    startDateTime: buildStartOfDayTimestamp(start),
    endDateTime: buildEndOfDayTimestamp(end),
    status: 'active',
    createdAt: updatedAt,
  }
  return period
}

async function getLatestMichinaPeriod(db: D1Database): Promise<MichinaDashboardPeriod | null> {
  await ensureMichinaPeriodsTable(db)
  const row = await db
    .prepare(
      'SELECT id, start_date, end_date, status, created_at FROM michina_periods ORDER BY datetime(created_at) DESC, id DESC LIMIT 1',
    )
    .first<MichinaDashboardPeriodRow>()
  if (!row) {
    return null
  }
  const startDateTime = row.start_date ?? ''
  const endDateTime = row.end_date ?? ''
  const startDate = normalizeDateColumnValue(startDateTime)
  const endDate = normalizeDateColumnValue(endDateTime)
  const createdAt = toIsoTimestamp(row.created_at)
  const status = (row.status ?? 'active').trim() || 'active'
  return {
    id: row.id,
    startDate,
    endDate,
    startDateTime,
    endDateTime,
    status,
    createdAt,
  }
}

async function ensureMichinaDemotionLogTable(db: D1Database) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS michina_demotion_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_count INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'success', message TEXT)",
    )
    .run()
  try {
    await db.prepare("ALTER TABLE michina_demotion_logs ADD COLUMN status TEXT NOT NULL DEFAULT 'success'").run()
  } catch (error) {
    const message = String(error || '')
    if (!/duplicate column name: status/i.test(message)) {
      throw error
    }
  }
  try {
    await db.prepare('ALTER TABLE michina_demotion_logs ADD COLUMN message TEXT').run()
  } catch (error) {
    const message = String(error || '')
    if (!/duplicate column name: message/i.test(message)) {
      throw error
    }
  }
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_michina_demotion_logs_executed_at ON michina_demotion_logs(executed_at DESC, id DESC)')
    .run()
}

async function listMichinaDemotionLogs(db: D1Database, limit = 60): Promise<MichinaDemotionLogEntry[]> {
  await ensureMichinaDemotionLogTable(db)
  const cappedLimit = Math.max(1, Math.min(limit, 200))
  const query = `SELECT id, executed_at, updated_count, status, message FROM michina_demotion_logs ORDER BY datetime(executed_at) DESC, id DESC LIMIT ${cappedLimit}`
  const result = await db.prepare(query).all<MichinaDemotionLogRow>()
  const rows = Array.isArray(result.results) ? result.results : []
  return rows.map((row) => {
    const status = (row.status ?? 'success').toLowerCase() === 'failure' ? 'failure' : 'success'
    const updatedCount = Number.isFinite(Number(row.updated_count)) ? Number(row.updated_count) : 0
    const executedAt = toIsoTimestamp(row.executed_at)
    const message = typeof row.message === 'string' && row.message.trim() ? row.message.trim() : undefined
    return {
      id: row.id,
      executedAt,
      updatedCount,
      status,
      message,
    }
  })
}

async function listDashboardChallengePeriods(db: D1Database): Promise<ChallengePeriodSummary[]> {
  try {
    await ensureDashboardChallengePeriodTable(db)
  } catch (error) {
    console.error('[d1] failed to ensure challenge_period table', error)
    return []
  }
  try {
    const { results } = await db
      .prepare('SELECT id, start_date, end_date, saved_at, saved_by FROM challenge_periods ORDER BY saved_at DESC, id DESC')
      .all<ChallengePeriodRow>()
    if (!results) {
      return []
    }
    return results
      .map((row) => {
        const savedAt = typeof row.saved_at === 'string' && row.saved_at ? row.saved_at : ''
        const savedBy = typeof row.saved_by === 'string' && row.saved_by.trim() ? row.saved_by.trim() : undefined
        const record: ChallengePeriodSummary = {
          id: Number(row.id),
          startDate: row.start_date,
          endDate: row.end_date,
          updatedAt: savedAt ? `${savedAt.replace(' ', 'T')}Z` : '',
        }
        if (savedAt) {
          record.savedAt = savedAt
        }
        if (savedBy) {
          record.savedBy = savedBy
          record.updatedBy = savedBy
        }
        return record
      })
      .filter((record) => Boolean(record.startDate && record.endDate))
  } catch (error) {
    console.error('[d1] failed to query challenge_period table', error)
    return []
  }
}

async function insertDashboardChallengePeriod(db: D1Database, startDate: string, endDate: string, savedBy?: string) {
  await ensureDashboardChallengePeriodTable(db)
  await db
    .prepare("INSERT INTO challenge_periods (start_date, end_date, saved_at, saved_by) VALUES (?, ?, datetime('now'), ?)")
    .bind(startDate, endDate, savedBy ?? null)
    .run()
}

async function deleteDashboardChallengePeriod(db: D1Database, id: number) {
  await ensureDashboardChallengePeriodTable(db)
  await db.prepare('DELETE FROM challenge_periods WHERE id = ?').bind(id).run()
}

async function clearDashboardChallengePeriods(db: D1Database) {
  await ensureDashboardChallengePeriodTable(db)
  await db.prepare('DELETE FROM challenge_periods').run()
}

async function hasAnyDashboardChallengePeriod(db: D1Database) {
  try {
    await ensureDashboardChallengePeriodTable(db)
    const row = await db.prepare('SELECT 1 FROM challenge_periods LIMIT 1').first<ChallengePeriodRow | null>()
    return Boolean(row)
  } catch (error) {
    console.error('[d1] failed to check challenge_period records', error)
    return false
  }
}

async function ensureMichinaListTable(db: D1Database) {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS michina_list (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT NOT NULL UNIQUE, approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  ).run()
  await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_michina_list_email ON michina_list(email)').run()
}

async function listMichinaList(db: D1Database): Promise<MichinaListEntry[]> {
  try {
    await ensureMichinaListTable(db)
  } catch (error) {
    console.error('[d1] failed to ensure michina_list table', error)
    return []
  }
  try {
    const { results } = await db
      .prepare('SELECT id, name, email, approved_at FROM michina_list ORDER BY approved_at DESC, id DESC')
      .all<MichinaListRow>()
    if (!results) {
      return []
    }
    return results.map((row) => ({
      id: Number(row.id),
      name: (row.name ?? '').trim(),
      email: row.email,
      approvedAt: row.approved_at,
    }))
  } catch (error) {
    console.error('[d1] failed to query michina_list table', error)
    return []
  }
}

async function upsertMichinaListEntries(db: D1Database, entries: { name: string; email: string }[]) {
  if (!entries.length) {
    return
  }
  await ensureMichinaListTable(db)
  for (const entry of entries) {
    const trimmedName = entry.name?.trim() ?? ''
    const normalizedEmail = entry.email.trim().toLowerCase()
    if (!normalizedEmail) {
      continue
    }
    await db
      .prepare(
        "INSERT INTO michina_list (name, email, approved_at) VALUES (?, ?, datetime('now')) ON CONFLICT(email) DO UPDATE SET name=excluded.name, approved_at=datetime('now')",
      )
      .bind(trimmedName, normalizedEmail)
      .run()
  }
}

async function promoteUsersToMichina(db: D1Database, emails: string[]) {
  if (!emails.length) return
  for (const email of emails) {
    await db
      .prepare("UPDATE users SET role = 'michina' WHERE lower(email) = ?")
      .bind(email.toLowerCase())
      .run()
  }
}

function getMichinaDatabase(env: Bindings) {
  const db = env.DB_MICHINA
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('D1 database binding `DB_MICHINA` is not configured')
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

async function listMichinaPeriodHistory(env: Bindings): Promise<MichinaPeriodHistoryItem[]> {
  const raw = await kvGet(env, MICHINA_PERIOD_HISTORY_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }
        const start = typeof (entry as MichinaPeriodHistoryItem).start === 'string' ? (entry as MichinaPeriodHistoryItem).start : ''
        const end = typeof (entry as MichinaPeriodHistoryItem).end === 'string' ? (entry as MichinaPeriodHistoryItem).end : ''
        const updatedAt =
          typeof (entry as MichinaPeriodHistoryItem).updatedAt === 'string'
            ? (entry as MichinaPeriodHistoryItem).updatedAt
            : ''
        const updatedBy =
          typeof (entry as MichinaPeriodHistoryItem).updatedBy === 'string'
            ? (entry as MichinaPeriodHistoryItem).updatedBy
            : undefined
        if (!start || !end || !updatedAt) {
          return null
        }
        const record: MichinaPeriodHistoryItem = { start, end, updatedAt }
        if (updatedBy) {
          record.updatedBy = updatedBy
        }
        return record
      })
      .filter((value): value is MichinaPeriodHistoryItem => Boolean(value))
  } catch (error) {
    console.error('[michina] Failed to parse period history', error)
    return []
  }
}

async function appendMichinaPeriodHistory(env: Bindings, record: MichinaPeriodHistoryItem) {
  if (!record.start || !record.end || !record.updatedAt) {
    return
  }
  const history = await listMichinaPeriodHistory(env)
  const sanitized = history.filter(
    (item) => item.updatedAt !== record.updatedAt || item.start !== record.start || item.end !== record.end,
  )
  sanitized.unshift(record)
  const trimmed = sanitized.slice(0, MAX_PERIOD_HISTORY_ITEMS)
  await kvPut(env, MICHINA_PERIOD_HISTORY_KEY, JSON.stringify(trimmed))
}

function mapPeriodHistoryToSummaries(history: MichinaPeriodHistoryItem[]): ChallengePeriodSummary[] {
  return history.map((item, index) => {
    const summary: ChallengePeriodSummary = {
      id: index + 1,
      startDate: item.start,
      endDate: item.end,
      updatedAt: item.updatedAt,
    }
    if (item.updatedBy) {
      summary.updatedBy = item.updatedBy
    }
    return summary
  })
}

async function fetchDashboardPeriodHistory(
  env: Bindings,
  options: { db?: D1Database | null } = {},
): Promise<ChallengePeriodSummary[]> {
  let history: ChallengePeriodSummary[] = []
  let db: D1Database | null = options.db ?? null
  if (!db) {
    try {
      db = getMichinaDatabase(env)
    } catch (error) {
      console.warn('[admin] Michina database binding is not configured; falling back to KV period history', error)
    }
  }

  if (db) {
    try {
      history = await listChallengePeriodsFromDb(db)
    } catch (error) {
      console.error('[admin] Failed to load challenge period history from D1', error)
      history = []
    }
  }

  if (history.length === 0) {
    const fallback = await listMichinaPeriodHistory(env)
    history = mapPeriodHistoryToSummaries(fallback)
  }

  return history
}

async function deleteDashboardPeriodHistoryEntry(env: Bindings, updatedAt: string) {
  let removed = false
  let db: D1Database | null = null
  try {
    db = getMichinaDatabase(env)
  } catch (error) {
    console.warn('[admin] Michina database binding is not configured; removing history from KV only', error)
  }

  if (db) {
    try {
      const entries = await listChallengePeriodsFromDb(db)
      const target = entries.find((entry) => entry.updatedAt === updatedAt)
      if (target && Number.isFinite(Number(target.id))) {
        await deleteDashboardChallengePeriod(db, Number(target.id))
        removed = true
      }
    } catch (error) {
      console.error('[admin] Failed to remove challenge period history from D1', error)
    }
  }

  const history = await listMichinaPeriodHistory(env)
  const filtered = history.filter((item) => item.updatedAt !== updatedAt)
  if (filtered.length !== history.length) {
    removed = true
    if (filtered.length > 0) {
      await kvPut(env, MICHINA_PERIOD_HISTORY_KEY, JSON.stringify(filtered))
    } else {
      await kvDelete(env, MICHINA_PERIOD_HISTORY_KEY)
    }
  }

  const nextHistory = await fetchDashboardPeriodHistory(env, { db: db ?? undefined })
  return { removed, history: nextHistory }
}

async function saveMichinaPeriodRecord(
  env: Bindings,
  data: { start: string; end: string; updatedBy?: string; updatedAt?: string },
): Promise<MichinaPeriod> {
  const timestamp = typeof data.updatedAt === 'string' && data.updatedAt ? data.updatedAt : new Date().toISOString()
  const record: MichinaPeriod = {
    start: data.start,
    end: data.end,
    updatedAt: timestamp,
    updatedBy: data.updatedBy,
  }
  if (!record.updatedBy) {
    delete record.updatedBy
  }
  await kvPut(env, MICHINA_PERIOD_KEY, JSON.stringify(record))
  await appendMichinaPeriodHistory(env, { start: record.start, end: record.end, updatedAt: record.updatedAt, updatedBy: record.updatedBy })
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
  return c.json({ success: true, message: '관리자 인증 완료', redirect: '/admin-dashboard', email: resolvedEmail })
})

app.get('/api/admin/dashboard/periods', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED', period: null }, 401)
  }
  let period: MichinaDashboardPeriod | null = null
  let db: D1Database | null = null
  try {
    db = getMichinaDatabase(c.env)
  } catch (error) {
    console.warn('[admin] Michina database binding is not configured; falling back to KV period record', error)
  }
  if (db) {
    try {
      period = await getLatestMichinaPeriod(db)
    } catch (error) {
      console.error('[admin] Failed to load michina dashboard period', error)
    }
  }
  if (!period) {
    const fallback = await getMichinaPeriodRecord(c.env)
    if (fallback) {
      period = mapMichinaPeriodToDashboardPeriod({
        start: fallback.start,
        end: fallback.end,
        updatedAt: fallback.updatedAt,
      })
    }
  }
  const history = await fetchDashboardPeriodHistory(c.env, { db: db ?? undefined })
  return c.json({ period, history })
})

app.post('/api/admin/dashboard/periods', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ success: false, error: 'UNAUTHORIZED' }, 401)
  }
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ success: false, error: 'INVALID_JSON' }, 400)
  }
  const startInput =
    (payload as { startDate?: string; start_date?: string }).startDate ??
    (payload as { start_date?: string }).start_date ??
    ''
  const endInput =
    (payload as { endDate?: string; end_date?: string }).endDate ??
    (payload as { end_date?: string }).end_date ??
    ''
  const startDate = isValidDateString(startInput) ? startInput : ''
  const endDate = isValidDateString(endInput) ? endInput : ''
  if (!startDate || !endDate) {
    return c.json({ success: false, error: 'INVALID_DATE' }, 400)
  }
  if (endDate < startDate) {
    return c.json({ success: false, error: 'END_BEFORE_START' }, 400)
  }
  let period: MichinaDashboardPeriod | null = null
  let db: D1Database | null = null
  try {
    db = getMichinaDatabase(c.env)
  } catch (error) {
    console.warn('[admin] Michina database binding is not configured; saving period via KV fallback', error)
  }
  if (db) {
    try {
      await saveMichinaPeriodRow(db, {
        startDateTime: buildStartOfDayTimestamp(startDate),
        endDateTime: buildEndOfDayTimestamp(endDate),
        status: 'active',
      })
      period = await getLatestMichinaPeriod(db)
    } catch (error) {
      console.error('[admin] Failed to save michina dashboard period via D1; attempting KV fallback', error)
      period = null
    }
  }
  if (!period) {
    const record = await saveMichinaPeriodRecord(c.env, {
      start: startDate,
      end: endDate,
      updatedBy: adminEmail,
    })
    period = mapMichinaPeriodToDashboardPeriod({
      start: record.start,
      end: record.end,
      updatedAt: record.updatedAt,
    })
  }
  const history = await fetchDashboardPeriodHistory(c.env, { db: db ?? undefined })
  return c.json({ success: true, period, history })
})

app.get('/api/admin/dashboard/period-history', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED', history: [] }, 401)
  }
  const history = await fetchDashboardPeriodHistory(c.env)
  return c.json({ history })
})

app.delete('/api/admin/dashboard/period-history', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ success: false, error: 'UNAUTHORIZED' }, 401)
  }

  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ success: false, error: 'INVALID_JSON' }, 400)
  }

  const updatedAt = typeof (payload as { updatedAt?: unknown }).updatedAt === 'string'
    ? ((payload as { updatedAt: string }).updatedAt || '').trim()
    : ''

  if (!updatedAt) {
    return c.json({ success: false, error: 'INVALID_UPDATED_AT' }, 400)
  }

  const { removed, history } = await deleteDashboardPeriodHistoryEntry(c.env, updatedAt)
  if (!removed) {
    return c.json({ success: false, error: 'NOT_FOUND', history }, 404)
  }

  return c.json({ success: true, history })
})

app.get('/api/admin/dashboard/users', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED', users: [] }, 401)
  }
  let mainDb: D1Database
  try {
    mainDb = getMainDatabase(c.env)
  } catch (error) {
    console.error('[admin] Main database binding is not configured', error)
    return c.json({ error: 'DATABASE_NOT_CONFIGURED', users: [] }, 500)
  }

  let userRows: UserRow[] = []
  try {
    const result = await mainDb
      .prepare("SELECT id, name, email, role, last_login FROM users WHERE lower(role) = 'michina' ORDER BY lower(email) ASC")
      .all<UserRow>()
    userRows = Array.isArray(result.results) ? result.results : []
  } catch (error) {
    console.error('[admin] Failed to load michina grade users', error)
    return c.json({ error: 'DATABASE_ERROR', users: [] }, 500)
  }

  const participantLookup = new Map<string, { name?: string; startDate?: string; endDate?: string; startDateTime?: string; endDateTime?: string }>()
  let michinaDb: D1Database | null = null
  try {
    michinaDb = getMichinaDatabase(c.env)
  } catch (error) {
    console.warn('[admin] Michina database binding is not configured; continuing without participant metadata')
  }

  if (michinaDb) {
    try {
      await ensureParticipantsTable(michinaDb)
      const result = await michinaDb
        .prepare('SELECT name, email, start_date, end_date, role FROM michina_participants WHERE role IN (\'미치나\', \'michina\')')
        .all<ParticipantRow>()
      const rows = Array.isArray(result.results) ? result.results : []
      for (const row of rows) {
        const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : ''
        if (!email) {
          continue
        }
        const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : undefined
        const startDate = normalizeDateColumnValue(row.start_date)
        const endDate = normalizeDateColumnValue(row.end_date)
        const rawStart = typeof row.start_date === 'string' ? row.start_date.trim() : ''
        const rawEnd = typeof row.end_date === 'string' ? row.end_date.trim() : ''
        participantLookup.set(email, {
          name,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          startDateTime: rawStart || (startDate ? buildStartOfDayTimestamp(startDate) : undefined),
          endDateTime: rawEnd || (endDate ? buildEndOfDayTimestamp(endDate) : undefined),
        })
      }
    } catch (error) {
      const message = String(error || '')
      if (/no such table: michina_participants/i.test(message)) {
        console.warn('[admin] michina_participants table is not available; skipping participant metadata')
      } else {
        console.error('[admin] Failed to load michina participant metadata', error)
      }
    }
  }

  const users: MichinaDashboardUser[] = userRows.map((row) => {
    const normalizedEmail = row.email.trim().toLowerCase()
    const participant = participantLookup.get(normalizedEmail)
    const preferredName = participant?.name || (row.name ?? '').trim()
    return {
      name: preferredName || '이름 미등록',
      email: row.email,
      startDate: participant?.startDate,
      endDate: participant?.endDate,
      startDateTime: participant?.startDateTime,
      endDateTime: participant?.endDateTime,
    }
  })

  return c.json({ users })
})

app.get('/api/admin/dashboard/demotion-logs', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED', logs: [] }, 401)
  }
  let db: D1Database
  try {
    db = getMichinaDatabase(c.env)
  } catch (error) {
    console.warn('[admin] Michina database binding is not configured; returning empty log set')
    return c.json({ logs: [] })
  }
  try {
    const logs = await listMichinaDemotionLogs(db)
    return c.json({ logs })
  } catch (error) {
    console.error('[admin] Failed to load michina demotion logs', error)
    return c.json({ error: 'DATABASE_ERROR', logs: [] }, 500)
  }
})

app.get('/api/admin/challenge-periods', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED', periods: [] }, 401)
  }
  try {
    const db = getMainDatabase(c.env)
    const periods = await listDashboardChallengePeriods(db)
    return c.json({ periods })
  } catch (error) {
    console.error('[admin] Failed to load challenge periods', error)
    return c.json({ error: 'DATABASE_ERROR', periods: [] }, 500)
  }
})

app.post('/api/admin/challenge-periods', async (c) => {
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
    const db = getMainDatabase(c.env)
    await insertDashboardChallengePeriod(db, startDate, endDate, adminEmail)
    const periods = await listDashboardChallengePeriods(db)
    return c.json({ success: true, periods })
  } catch (error) {
    console.error('[admin] Failed to save challenge period', error)
    return c.json({ error: 'DATABASE_ERROR' }, 500)
  }
})

app.delete('/api/admin/challenge-periods/:id', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  const idRaw = c.req.param('id')
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: 'INVALID_ID' }, 400)
  }
  try {
    const db = getMainDatabase(c.env)
    await deleteDashboardChallengePeriod(db, id)
    const periods = await listDashboardChallengePeriods(db)
    return c.json({ success: true, periods })
  } catch (error) {
    console.error('[admin] Failed to delete challenge period', error)
    return c.json({ error: 'DATABASE_ERROR' }, 500)
  }
})

app.delete('/api/admin/challenge-periods', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  try {
    const db = getMainDatabase(c.env)
    await clearDashboardChallengePeriods(db)
    return c.json({ success: true, periods: [] })
  } catch (error) {
    console.error('[admin] Failed to clear challenge periods', error)
    return c.json({ error: 'DATABASE_ERROR' }, 500)
  }
})

app.post('/api/admin/save-period', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ success: false, message: '관리자 권한이 필요합니다.' }, 401)
  }
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ success: false, message: '잘못된 요청입니다.' }, 400)
  }
  const startDate = isValidDateString((payload as { start_date?: string; startDate?: string }).start_date ?? (payload as { startDate?: string }).startDate)
    ? ((payload as { start_date?: string; startDate?: string }).start_date ?? (payload as { startDate: string }).startDate)
    : ''
  const endDate = isValidDateString((payload as { end_date?: string; endDate?: string }).end_date ?? (payload as { endDate?: string }).endDate)
    ? ((payload as { end_date?: string; endDate?: string }).end_date ?? (payload as { endDate: string }).endDate)
    : ''
  if (!startDate || !endDate) {
    return c.json({ success: false, message: '시작일과 종료일이 필요합니다.' }, 400)
  }
  try {
    const db = getMainDatabase(c.env)
    await ensureChallengePeriodTable(db)
    await db
      .prepare("INSERT INTO challenge_periods (start_date, end_date, saved_at, saved_by) VALUES (?, ?, datetime('now'), ?)")
      .bind(startDate, endDate, adminEmail)
      .run()
    const periods = await listDashboardChallengePeriods(db)
    return c.json({ success: true, message: '기간이 성공적으로 저장되었습니다.', data: periods })
  } catch (error) {
    console.error('❌ 기간 저장 오류:', error)
    return c.json({ success: false, message: '기간을 저장하지 못했습니다.' }, 500)
  }
})

app.get('/api/admin/periods', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ success: false, message: '관리자 권한이 필요합니다.' }, 401)
  }
  try {
    const db = getMainDatabase(c.env)
    const periods = await listDashboardChallengePeriods(db)
    return c.json({ success: true, data: periods })
  } catch (error) {
    console.error('❌ 기간 조회 오류:', error)
    return c.json({ success: false, message: '데이터를 불러오지 못했습니다.' }, 500)
  }
})

app.delete('/api/admin/delete-period/:id', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ success: false, message: '관리자 권한이 필요합니다.' }, 401)
  }
  const rawId = c.req.param('id')
  const id = Number(rawId)
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ success: false, message: '유효한 ID가 아닙니다.' }, 400)
  }
  try {
    const db = getMainDatabase(c.env)
    await db.prepare('DELETE FROM challenge_periods WHERE id = ?').bind(id).run()
    const periods = await listDashboardChallengePeriods(db)
    return c.json({ success: true, message: '기간이 삭제되었습니다.', data: periods })
  } catch (error) {
    console.error('❌ 기간 삭제 오류:', error)
    return c.json({ success: false, message: '삭제 실패' }, 500)
  }
})

app.get('/api/admin/michina-list', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED', entries: [] }, 401)
  }
  try {
    const db = getMainDatabase(c.env)
    const entries = await listMichinaList(db)
    return c.json({ entries })
  } catch (error) {
    console.error('[admin] Failed to load michina list', error)
    return c.json({ error: 'DATABASE_ERROR', entries: [] }, 500)
  }
})

app.post('/api/admin/michina-list', async (c) => {
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
  const rawEntries: unknown[] = Array.isArray((payload as { entries?: unknown }).entries)
    ? ((payload as { entries: unknown[] }).entries || [])
    : []
  const normalizedMap = new Map<string, { name: string; email: string }>()
  for (const entry of rawEntries) {
    if (typeof entry === 'string') {
      const email = normalizeEmailValue(entry)
      if (email) {
        normalizedMap.set(email, { name: '', email })
      }
      continue
    }
    if (entry && typeof entry === 'object') {
      const email = normalizeEmailValue((entry as { email?: unknown }).email)
      if (!email) continue
      const name = typeof (entry as { name?: unknown }).name === 'string' ? ((entry as { name: string }).name || '').trim() : ''
      normalizedMap.set(email, { name, email })
    }
  }
  const entries = Array.from(normalizedMap.values())
  if (entries.length === 0) {
    return c.json({ error: 'EMPTY_ENTRIES' }, 400)
  }
  try {
    const db = getMainDatabase(c.env)
    const periodExists = await hasAnyDashboardChallengePeriod(db)
    if (!periodExists) {
      return c.json({ error: 'PERIOD_REQUIRED', message: '챌린지 기간이 설정되어 있지 않습니다.' }, 400)
    }
    await upsertMichinaListEntries(db, entries)
    await promoteUsersToMichina(db, entries.map((entry) => entry.email))
    const savedEntries = await listMichinaList(db)
    return c.json({ success: true, count: entries.length, entries: savedEntries })
  } catch (error) {
    console.error('[admin] Failed to save michina list', error)
    return c.json({ error: 'DATABASE_ERROR' }, 500)
  }
})

app.get('/api/admin/period', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  let period: ChallengePeriodRecord | null = null
  let periods: ChallengePeriodSummary[] = []
  let db: D1Database | null = null

  try {
    db = getMichinaDatabase(c.env)
  } catch (error) {
    console.warn('[admin] D1 database is not available for period fetch; using fallback storage', error)
  }

  if (db) {
    try {
      const [current, history] = await Promise.all([
        getChallengePeriodFromDb(db),
        listChallengePeriodsFromDb(db),
      ])
      period = current
      periods = history
    } catch (error) {
      console.error('[admin] Failed to load challenge period from D1', error)
    }
  }

  if (!period) {
    const fallback = await getMichinaPeriodRecord(c.env)
    if (fallback) {
      period = {
        startDate: fallback.start,
        endDate: fallback.end,
        updatedAt: fallback.updatedAt,
        updatedBy: fallback.updatedBy,
      }
    }
  }

  if (periods.length === 0) {
    const history = await listMichinaPeriodHistory(c.env)
    periods = mapPeriodHistoryToSummaries(history)
  }

  return c.json({ period, periods })
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
  let period: ChallengePeriodRecord | null = null
  let periods: ChallengePeriodSummary[] = []
  let db: D1Database | null = null

  try {
    db = getMichinaDatabase(c.env)
  } catch (error) {
    console.warn('[admin] D1 database is not available for period save; using fallback storage', error)
  }

  if (db) {
    try {
      period = await saveChallengePeriodToDb(db, startDate, endDate, { updatedBy: adminEmail })
      periods = await listChallengePeriodsFromDb(db)
    } catch (error) {
      console.error('[admin] Failed to persist challenge period to D1', error)
      period = null
      periods = []
    }
  }

  if (period) {
    await saveMichinaPeriodRecord(c.env, {
      start: period.startDate,
      end: period.endDate,
      updatedBy: adminEmail,
      updatedAt: period.updatedAt,
    })
  } else {
    const record = await saveMichinaPeriodRecord(c.env, {
      start: startDate,
      end: endDate,
      updatedBy: adminEmail,
    })
    period = {
      startDate: record.start,
      endDate: record.end,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
    }
    const history = await listMichinaPeriodHistory(c.env)
    periods = mapPeriodHistoryToSummaries(history)
  }

  return c.json({ success: true, period, periods })
})

app.delete('/api/admin/period', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }

  let db: D1Database | null = null
  try {
    db = getMichinaDatabase(c.env)
  } catch (error) {
    console.warn('[admin] D1 database is not available for period delete; using fallback storage', error)
  }

  if (db) {
    try {
      await db.prepare('DELETE FROM challenge_periods').run()
    } catch (error) {
      const message = String(error || '')
      if (/no such table: challenge_periods/i.test(message)) {
        console.warn('[admin] challenge_periods table missing during delete; skipping')
      } else {
        console.error('[admin] Failed to delete challenge period from D1', error)
        return c.json({ error: 'DATABASE_ERROR' }, 500)
      }
    }
  }

  await kvDelete(c.env, MICHINA_PERIOD_KEY)

  let periods: ChallengePeriodSummary[] = []

  if (db) {
    try {
      periods = await listChallengePeriodsFromDb(db)
    } catch (error) {
      console.error('[admin] Failed to fetch challenge period history after delete', error)
    }
  }

  if (periods.length === 0) {
    const history = await listMichinaPeriodHistory(c.env)
    periods = mapPeriodHistoryToSummaries(history)
  }

  return c.json({ success: true, period: null, periods })
})

app.get('/api/admin/participants', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.json({ error: 'UNAUTHORIZED' }, 401)
  }
  try {
    const db = getMichinaDatabase(c.env)
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

  const db = getMichinaDatabase(c.env)
  try {
    await ensureParticipantsTable(db)
    try {
      await db.prepare('DELETE FROM michina_participants WHERE role = ?').bind('미치나').run()
    } catch (error) {
      const message = String(error || '')
      if (/no such table: michina_participants/i.test(message)) {
        console.warn('[admin] participants table is not available while replacing list; creating entries from scratch')
      } else {
        throw error
      }
    }

    for (const entry of entries) {
      const joinedAt = entry.joinedAt || new Date().toISOString().split('T')[0]
      await db
        .prepare(
          "INSERT OR REPLACE INTO michina_participants (name, email, joined_at, role) VALUES (?, ?, ?, '미치나')",
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
  const db = getMichinaDatabase(c.env)
  try {
    await ensureParticipantsTable(db)
    await db.prepare('DELETE FROM michina_participants WHERE role = ?').bind('미치나').run()
  } catch (error) {
    const message = String(error || '')
    if (/no such table: michina_participants/i.test(message)) {
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
  const db = getMichinaDatabase(c.env)
  let period: ChallengePeriodRecord | null = null
  try {
    period = await getChallengePeriodFromDb(db)
  } catch (error) {
    const message = String(error || '')
    if (/no such table: challenge_periods/i.test(message)) {
      console.warn('[admin] challenge_periods table is not available')
    } else {
      console.error('[admin] Failed to load challenge period for status', error)
      return c.json({ error: 'DATABASE_ERROR' }, 500)
    }
  }

  let totalCount = 0
  try {
    const row = await db
      .prepare('SELECT COUNT(*) AS cnt FROM michina_participants WHERE role = ?')
      .bind('미치나')
      .first<{ cnt: number | null }>()
    totalCount = Number(row?.cnt ?? 0)
  } catch (error) {
    const message = String(error || '')
    if (/no such table: michina_participants/i.test(message)) {
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
  const db = getMainDatabase(c.env)
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
    const db = getMichinaDatabase(c.env)
    const period = await getChallengePeriodFromDb(db)
    const today = new Date().toISOString().split('T')[0]
    if (period && today > period.endDate) {
      await db.prepare("UPDATE michina_participants SET role='free' WHERE role='미치나'").run()
    }
    const user = await db
      .prepare('SELECT role FROM michina_participants WHERE email = ? LIMIT 1')
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

app.get('/api/auth/login/google', (c) => {
  const redirectUri = resolveGoogleRedirectUri(c)
  const googleClient = createGoogleClient(c.env, redirectUri)
  if (!googleClient) {
    return applyCorsHeaders(c.text('Google OAuth credentials are not configured.', 500))
  }

  const state = generateRandomState()
  setCookie(c, GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  })

  const authorizationUrl = googleClient.createAuthorizationURL(state, {
    scopes: ['openid', 'email', 'profile'],
    prompt: 'consent',
    accessType: 'offline',
    includeGrantedScopes: 'true',
  })

  const response = c.redirect(authorizationUrl.toString(), 302)
  return applyCorsHeaders(response)
})

app.get('/api/auth/callback/google', async (c) => {
  const redirectUri = resolveGoogleRedirectUri(c)
  const googleClient = createGoogleClient(c.env, redirectUri)
  if (!googleClient) {
    return applyCorsHeaders(c.text('Google OAuth credentials are not configured.', 500))
  }

  const code = (c.req.query('code') || '').trim()
  if (!code) {
    return applyCorsHeaders(c.text('Authorization code is required.', 400))
  }

  const stateParam = (c.req.query('state') || '').trim()
  const storedState = getCookie(c, GOOGLE_OAUTH_STATE_COOKIE) || ''
  if (!stateParam || !storedState || stateParam !== storedState) {
    deleteCookie(c, GOOGLE_OAUTH_STATE_COOKIE, { path: '/' })
    return applyCorsHeaders(c.text('Invalid login state.', 400))
  }

  deleteCookie(c, GOOGLE_OAUTH_STATE_COOKIE, { path: '/' })

  try {
    const tokenSet = await googleClient.validateAuthorizationCode(code)
    const accessToken = tokenSet.accessToken

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!profileResponse.ok) {
      console.error('Failed to fetch Google user info', await profileResponse.text().catch(() => ''))
      return applyCorsHeaders(c.text('Failed to verify Google account.', 502))
    }

    const profile = (await profileResponse.json()) as {
      email?: string
      name?: string
      picture?: string
      verified_email?: boolean
      email_verified?: boolean
    }
    const email = typeof profile.email === 'string' ? profile.email.trim() : ''
    const name = typeof profile.name === 'string' ? profile.name.trim() : ''
    const picture = typeof profile.picture === 'string' ? profile.picture.trim() : undefined
    const emailVerified =
      typeof profile.verified_email === 'boolean'
        ? profile.verified_email
        : typeof profile.email_verified === 'boolean'
          ? profile.email_verified
          : true

    if (!email || !emailVerified) {
      return applyCorsHeaders(c.text('Failed to verify Google account.', 502))
    }

    const session = JSON.stringify({
      email,
      name,
      picture,
      provider: 'google',
      issuedAt: Date.now(),
    })

    setCookie(c, SESSION_COOKIE_NAME, session, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

    const response = c.redirect('/dashboard', 302)
    return applyCorsHeaders(response)
  } catch (error) {
    console.error('Google OAuth callback handling failed', error)
    return applyCorsHeaders(c.text('Failed to verify Google login.', 502))
  }
})

app.get('/api/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
  return c.redirect('/', 302)
})

app.post('/api/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
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
    return c.json(
      {
        error: 'DAY_CLOSED',
        message: '해당 일차는 00:00~23:59 사이에만 인증할 수 있습니다.',
      },
      400,
    )
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
  '감각적인 비주얼',
  '감성적인 분위기',
  '밝은 조명감',
  '따뜻한 색감',
  '차분한 색조',
  '모던 무드',
  '세련된 연출',
  '트렌디한 감성',
  '풍부한 디테일',
  '부드러운 질감',
  '강조된 피사체',
  '중앙 집중 구도',
  '여백을 살린 구성',
  '다채로운 팔레트',
  '포근한 무드',
  '산뜻한 색조',
  '프리미엄 연출',
  '브랜드 무드보드',
  '스토리텔링 비주얼',
  '라이프스타일 감성',
  '콘텐츠 제작 인사이트',
  '마케팅 활용 아이디어',
  'SNS 비주얼 제안',
  '캠페인 메인 이미지',
  '온라인 홍보 소재',
]

const KEYWORD_DISALLOWED_PATTERNS: RegExp[] = [
  /\b\d+\s*[:x×]\s*\d+\b/i,
  /\b\d+\s*(?:px|픽셀|dpi)\b/i,
  /\b(?:4k|8k|16k|1080p|720p|480p)\b/i,
]

const KEYWORD_DISALLOWED_TERMS: string[] = ['비율', '해상도', '사이즈', '크기']

const isKeywordDisallowed = (keyword: string): boolean => {
  if (!keyword) return true
  if (KEYWORD_DISALLOWED_PATTERNS.some((pattern) => pattern.test(keyword))) {
    return true
  }
  const lower = keyword.toLowerCase()
  return KEYWORD_DISALLOWED_TERMS.some((term) => lower.includes(term))
}

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
    if (isKeywordDisallowed(normalized)) return
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
- 모든 키워드는 이미지에서 식별되는 피사체, 배경, 분위기, 활용처를 구체적으로 표현합니다.
- 키워드는 이미지에서 확인되는 색상, 조명, 스타일, 질감, 분위기를 세밀하게 반영합니다.
- 숫자로 표기된 비율, 해상도, 픽셀 수치, 용량 등 기술적 정보는 키워드에 포함하지 않습니다.
- 여러 장의 이미지가 주어지면 공통 요소와 각 이미지의 특징을 통합해 중복 없는 25개의 키워드를 제시합니다.
- 제목은 핵심 키워드를 자연스럽게 이어 붙인 한 문장으로 작성하고, '미리캔버스'를 활용하는 마케터가 검색할 법한 문구를 넣습니다.
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
      model: 'gpt-4o',
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
      model: 'gpt-4o',
      requestId,
    })
  } catch (error) {
    console.error('[api/analyze] error', error)
    const detail = error instanceof Error ? error.message : String(error)
    return c.json({ error: 'OPENAI_UNHANDLED_ERROR', detail }, 502)
  }
})

app.get('/admin-dashboard', async (c) => {
  const adminEmail = await requireAdminSession(c)
  if (!adminEmail) {
    return c.html(renderAdminDashboardUnauthorizedPage('/admin-login/'), 401)
  }
  return c.html(renderAdminDashboardPage({ adminEmail }))
})

app.get('/', async (c) => {
  const currentYear = new Date().getFullYear()
  const googleClientId = (c.env.VITE_GOOGLE_CLIENT_ID ?? c.env.GOOGLE_CLIENT_ID)?.trim() ?? ''
  const googleRedirectUri = resolveGoogleRedirectUri(c)

  let userSession: { email: string; name?: string; picture?: string } | null = null
  const rawUserCookie = getCookie(c, SESSION_COOKIE_NAME)
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
          <button class="btn btn--ghost btn--sm" type="button" data-role="header-auth">
            로그인
          </button>
          <button class="btn btn--brand btn--sm" type="button" data-role="header-upgrade">
            업그레이드
          </button>
        </div>
      </header>

      <section class="hero" data-view="home">
        <p class="hero__badge">크레딧 기반 Freemium 베타</p>
      </section>

      <section class="features" data-view="home" aria-label="주요 기능 안내">
        <h2 class="features__title">핵심 기능</h2>
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

      <div class="login-modal" data-role="login-modal" aria-hidden="true">
        <div class="login-modal__backdrop" data-action="close-login" aria-hidden="true"></div>
        <div class="login-modal__dialog" role="dialog" aria-modal="true">
          <button class="login-modal__close" type="button" data-action="close-login" aria-label="로그인 창 닫기">
            <i class="ri-close-line" aria-hidden="true"></i>
          </button>
          <header class="login-modal__hero"></header>
          <section class="login-modal__email-panel" data-role="login-email-panel">
            <form class="login-modal__form" data-role="login-email-form" data-state="idle">
              <div class="login-modal__field">
                <label class="login-modal__label" for="loginEmail">이메일</label>
                <input
                  id="loginEmail"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                  autocomplete="email"
                  class="login-modal__input"
                  data-role="login-email-input"
                />
              </div>
              <div class="login-modal__field">
                <label class="login-modal__label" for="loginEmailPassword">비밀번호</label>
                <input
                  id="loginEmailPassword"
                  name="password"
                  type="password"
                  placeholder="비밀번호를 입력하세요"
                  class="login-modal__input"
                  data-role="login-email-code"
                  disabled
                />
              </div>
              <div class="login-modal__actions">
                <button class="login-modal__submit" type="submit" data-role="login-email-submit">
                  로그인
                </button>
                <button class="login-modal__resend" type="button" data-role="login-email-resend" hidden>
                  코드 다시 보내기
                </button>
              </div>
            </form>
            <p class="login-modal__helper" data-role="login-email-helper"></p>
            <a class="login-modal__signup" href="/signup" data-role="login-signup-link">
              아직 회원이 아니신가요? 회원가입
            </a>
          </section>
          <div class="login-modal__divider" role="presentation">
            <span>또는</span>
          </div>
          <div class="login-modal__cta-group">
            <button class="login-modal__button login-modal__button--michina" type="button" data-role="michina-login">
              미치나로 로그인
            </button>
            <button
              class="login-modal__button login-modal__button--google"
              type="button"
              data-action="login-google"
              data-role="google-login-button"
              aria-describedby="google-login-helper"
            >
              <span class="login-modal__icon" aria-hidden="true">
                <i class="ri-google-fill"></i>
              </span>
              <span class="login-modal__button-text" data-role="google-login-text" aria-live="polite">
                Google 계정으로 로그인
              </span>
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
            <p class="admin-modal__note">관리자 모드가 이미 활성화되어 있습니다. 필요하다면 아래에서 로그아웃할 수 있습니다.</p>
            <div class="admin-modal__buttons">
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
            <AnalyzePanel />
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



app.get('/api/health', (c) => c.json({ status: 'ok' }))

export default app
