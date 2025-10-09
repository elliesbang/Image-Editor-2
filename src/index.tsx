import { Hono } from 'hono'
import type { Context } from 'hono'
import { serveStatic } from 'hono/cloudflare-pages'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { renderer } from './renderer'

type Bindings = {
  OPENAI_API_KEY?: string
  ADMIN_EMAIL?: string
  ADMIN_PASSWORD_HASH?: string
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
  passwordHash: string
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

const ADMIN_SESSION_COOKIE = 'admin_session'
const ADMIN_SESSION_ISSUER = 'easy-image-editor'
const ADMIN_SESSION_AUDIENCE = 'easy-image-editor/admin'
const ADMIN_RATE_LIMIT_KEY_PREFIX = 'ratelimit:admin-login:'
const DEFAULT_ADMIN_RATE_LIMIT_MAX_ATTEMPTS = 5
const DEFAULT_ADMIN_RATE_LIMIT_WINDOW_SECONDS = 60
const DEFAULT_ADMIN_RATE_LIMIT_COOLDOWN_SECONDS = 300
const PARTICIPANT_KEY_PREFIX = 'participant:'
const REQUIRED_SUBMISSIONS = 15
const CHALLENGE_DURATION_BUSINESS_DAYS = 15
const DEFAULT_GOOGLE_REDIRECT_URI = 'https://project-9cf3a0d0.pages.dev/auth/google/callback'
const ADMIN_LOGIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL ?? ''

function renderCommunityDashboardPage() {
  const appConfig = JSON.stringify(
    {
      initialView: 'community',
      communityUrl: '/?view=community',
    },
    null,
    2,
  ).replace(/</g, '\\u003c')

  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0f172a" />
    <meta
      name="description"
      content="3주(15일) 동안 진행되는 미치나 커뮤니티 미션을 관리하고 완주하면 Ellie Image Editor의 모든 편집 기능을 해금하세요."
    />
    <title>미치나 커뮤니티 대시보드</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/remixicon@4.3.0/fonts/remixicon.css" />
    <script>
      window.tailwind = window.tailwind || {}
      window.tailwind.config = {
        theme: {
          extend: {
            colors: {
              michina: '#34d399',
            },
            fontFamily: {
              sans: ['Inter', 'system-ui', 'sans-serif'],
            },
          },
        },
        darkMode: 'class',
      }
    </script>
    <script src="https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio"></script>
    <style>
      body {
        font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background-color: #020617;
      }
    </style>
  </head>
  <body class="bg-slate-950 text-slate-100">
    <div id="community-dashboard-root" class="min-h-screen">
      <noscript class="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-center text-lg font-semibold text-white/80">
        미치나 커뮤니티 대시보드를 이용하려면 자바스크립트를 활성화해주세요.
      </noscript>
    </div>
    <script type="application/json" data-role="app-config">${appConfig}</script>
    <script type="module" src="/static/app.js"></script>
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

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256(input: string) {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(digest)
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

  const passwordHashRaw = env.ADMIN_PASSWORD_HASH?.trim().toLowerCase() ?? ''
  if (!passwordHashRaw) {
    issues.push('ADMIN_PASSWORD_HASH is not configured')
  } else if (!/^[0-9a-f]{64}$/i.test(passwordHashRaw)) {
    issues.push('ADMIN_PASSWORD_HASH must be a 64-character SHA-256 hex digest')
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
      passwordHash: passwordHashRaw,
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
    return `${url.origin}/auth/google/callback`
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

async function requireAdminSession(c: Context<{ Bindings: Bindings }>) {
  const config = getAdminConfig(c.env)
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
app.use(renderer)

app.get('/api/auth/session', async (c) => {
  const adminEmail = await requireAdminSession(c)
  return c.json({ admin: Boolean(adminEmail), email: adminEmail ?? null })
})

app.post('/api/auth/admin/login', async (c) => {
  let payload: { email?: string; password?: string } | undefined
  try {
    payload = await c.req.json()
  } catch (error) {
    const response = c.json({ error: 'INVALID_JSON_BODY' }, 400)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const env = c.env
  const validation = validateAdminEnvironment(env)
  const adminConfig = validation.config
  if (!adminConfig) {
    const response = c.json(
      {
        error: 'ADMIN_AUTH_NOT_CONFIGURED',
        issues: validation.issues,
      },
      500,
    )
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const rateLimitConfig = getAdminRateLimitConfig(env)
  const identifier = getClientIdentifier(c)
  const currentStatus = await getAdminRateLimitStatus(env, identifier, rateLimitConfig)
  if (currentStatus.blocked) {
    const retryAfter = currentStatus.retryAfterSeconds ?? rateLimitConfig.cooldownSeconds
    const response = c.json({ error: 'RATE_LIMIT_EXCEEDED', retryAfter }, 429)
    attachRateLimitHeaders(response, rateLimitConfig, currentStatus)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const password = typeof payload?.password === 'string' ? payload.password : ''

  if (!isValidEmail(email) || !password) {
    const failureStatus = await recordAdminLoginFailure(env, identifier, rateLimitConfig)
    const responseBody: Record<string, unknown> = { error: 'INVALID_CREDENTIALS' }
    if (failureStatus.blocked && failureStatus.retryAfterSeconds) {
      responseBody.retryAfter = failureStatus.retryAfterSeconds
    }
    const response = c.json(responseBody, 401)
    attachRateLimitHeaders(response, rateLimitConfig, failureStatus)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  if (email !== adminConfig.email) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    const failureStatus = await recordAdminLoginFailure(env, identifier, rateLimitConfig)
    const responseBody: Record<string, unknown> = { error: 'INVALID_CREDENTIALS' }
    if (failureStatus.blocked && failureStatus.retryAfterSeconds) {
      responseBody.retryAfter = failureStatus.retryAfterSeconds
    }
    const response = c.json(responseBody, 401)
    attachRateLimitHeaders(response, rateLimitConfig, failureStatus)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const computedHash = await sha256(password)
  if (computedHash.toLowerCase() !== adminConfig.passwordHash) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    const failureStatus = await recordAdminLoginFailure(env, identifier, rateLimitConfig)
    const responseBody: Record<string, unknown> = { error: 'INVALID_CREDENTIALS' }
    if (failureStatus.blocked && failureStatus.retryAfterSeconds) {
      responseBody.retryAfter = failureStatus.retryAfterSeconds
    }
    const response = c.json(responseBody, 401)
    attachRateLimitHeaders(response, rateLimitConfig, failureStatus)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const sessionMeta = await createAdminSession(c, email, adminConfig)
  await clearAdminRateLimit(env, identifier)
  const successStatus: RateLimitStatus = {
    blocked: false,
    remaining: rateLimitConfig.maxAttempts,
    resetAfterSeconds: rateLimitConfig.windowSeconds,
  }
  const response = c.json({
    ok: true,
    expiresAt: sessionMeta.exp,
    issuedAt: sessionMeta.iat,
    sessionVersion: adminConfig.sessionVersion,
  })
  attachRateLimitHeaders(response, rateLimitConfig, successStatus)
  response.headers.set('Cache-Control', 'no-store')
  return response
})

app.post('/api/auth/admin/logout', async (c) => {
  clearAdminSession(c)
  return c.json({ ok: true })
})

app.post('/api/auth/google', async (c) => {
  let payload: { code?: string } | undefined
  try {
    payload = await c.req.json()
  } catch (error) {
    return c.json({ error: 'INVALID_JSON_BODY' }, 400)
  }

  const code = typeof payload?.code === 'string' ? payload.code.trim() : ''
  if (!code) {
    return c.json({ error: 'AUTH_CODE_REQUIRED' }, 400)
  }

  const clientId = c.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET?.trim()
  const redirectUri = resolveGoogleRedirectUri(c)

  if (!clientId || !clientSecret) {
    return c.json({ error: 'GOOGLE_AUTH_NOT_CONFIGURED' }, 500)
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
      return c.json(
        { error: 'GOOGLE_TOKEN_EXCHANGE_FAILED', detail: detail.slice(0, 4000) },
        502,
      )
    }

    const tokenJson = (await tokenResponse.json()) as {
      id_token?: string
      expires_in?: number
      scope?: string
      token_type?: string
      refresh_token?: string
    }

    const idToken = typeof tokenJson.id_token === 'string' ? tokenJson.id_token : ''
    if (!idToken) {
      return c.json({ error: 'GOOGLE_ID_TOKEN_MISSING' }, 502)
    }

    const idPayload = decodeGoogleIdToken(idToken)
    if (!idPayload) {
      return c.json({ error: 'GOOGLE_ID_TOKEN_INVALID' }, 502)
    }

    if (idPayload.aud !== clientId) {
      return c.json({ error: 'GOOGLE_ID_TOKEN_AUDIENCE_MISMATCH' }, 401)
    }

    if (
      idPayload.iss &&
      idPayload.iss !== 'https://accounts.google.com' &&
      idPayload.iss !== 'accounts.google.com'
    ) {
      return c.json({ error: 'GOOGLE_ID_TOKEN_ISSUER_INVALID' }, 401)
    }

    const email = typeof idPayload.email === 'string' ? idPayload.email.trim().toLowerCase() : ''
    if (!isValidEmail(email)) {
      return c.json({ error: 'GOOGLE_EMAIL_INVALID' }, 400)
    }

    if (!isGoogleEmailVerified(idPayload.email_verified)) {
      return c.json({ error: 'GOOGLE_EMAIL_NOT_VERIFIED' }, 403)
    }

    const expiresAt =
      typeof idPayload.exp === 'number'
        ? idPayload.exp
        : typeof idPayload.exp === 'string'
          ? Number(idPayload.exp)
          : undefined

    return c.json({
      ok: true,
      profile: {
        email,
        name: idPayload.name ?? idPayload.given_name ?? '',
        picture: idPayload.picture ?? '',
        expiresAt: expiresAt && Number.isFinite(expiresAt) ? expiresAt : null,
      },
    })
  } catch (error) {
    console.error('[auth/google] Unexpected error', error)
    return c.json({ error: 'GOOGLE_AUTH_UNEXPECTED_ERROR' }, 502)
  }
})

app.get('/auth/google/callback', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Google 인증 완료</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: grid;
        place-items: center;
        min-height: 100vh;
        margin: 0;
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
      <h1>Google 인증이 완료되었습니다.</h1>
      <p>이 창은 잠시 후 자동으로 닫힙니다.</p>
    </div>
    <script>
      setTimeout(() => {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'google-auth-callback' }, '*')
        }
        window.close()
      }, 600)
    </script>
  </body>
</html>`)
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

app.get('/', (c) => {
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
            <span class="app-header__tag">크레딧 프리미엄 베타</span>
          </a>
        </div>
        <nav class="app-header__nav" aria-label="주요 내비게이션">
          <button
            class="app-header__nav-item is-active"
            type="button"
            data-view-target="home"
            aria-current="page"
          >
            홈
          </button>
        </nav>
        <div class="app-header__right">
          <div class="app-header__credit" data-role="credit-display" data-state="locked">
            <span class="app-header__plan-badge" data-role="plan-badge">게스트 모드</span>
            <span class="app-header__credit-label" data-role="credit-label">로그인하고 무료 30 크레딧 받기</span>
            <span class="app-header__credit-value">
              <strong data-role="credit-count">0</strong> 크레딧
            </span>
          </div>
          <a
            class="btn btn--ghost btn--sm"
            href={communityUrl}
            target="_blank"
            rel="noopener"
            data-role="community-link"
          >
            미치나 커뮤니티
          </a>
          <button class="btn btn--ghost btn--sm" type="button" data-role="header-auth">
            로그인
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
          <div class="login-modal__providers">
            <button
              class="login-modal__provider login-modal__provider--google"
              type="button"
              data-action="login-google"
              data-role="google-login-button"
              aria-describedby="google-login-helper"
            >
              <span class="login-modal__icon" aria-hidden="true">
                <i class="ri-google-fill"></i>
              </span>
              <span data-role="google-login-text" aria-live="polite">Google 계정으로 계속하기</span>
              <span class="login-modal__spinner" data-role="google-login-spinner" aria-hidden="true"></span>
            </button>
            <p
              class="login-modal__helper login-modal__helper--google"
              data-role="google-login-helper"
              aria-live="polite"
              id="google-login-helper"
              hidden
            ></p>
          </div>
          <div class="login-modal__divider" role="presentation">
            <span>또는</span>
          </div>
          <form class="login-modal__form" data-role="login-email-form" data-state="idle">
            <label class="login-modal__label" for="loginEmail">이메일 로그인</label>
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
        </div>
      </div>

      <div class="admin-modal" data-role="admin-modal" aria-hidden="true">
        <div class="admin-modal__backdrop" data-action="close-admin" aria-hidden="true"></div>
        <div class="admin-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
          <header class="admin-modal__header">
            <h2 class="admin-modal__title" id="admin-modal-title">관리자 보안 로그인</h2>
            <button class="admin-modal__close" type="button" data-action="close-admin" aria-label="관리자 로그인 창 닫기">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </header>
          <p class="admin-modal__subtitle" data-role="admin-modal-subtitle">
            등록된 관리자만 접근할 수 있습니다. 자격 증명을 안전하게 입력하세요.
          </p>
          <form class="admin-modal__form" data-role="admin-login-form" data-state="idle">
            <label class="admin-modal__label" for="adminEmail">관리자 이메일</label>
            <input
              id="adminEmail"
              name="adminEmail"
              type="email"
              required
              autocomplete="email"
              class="admin-modal__input"
              data-role="admin-email"
              placeholder="admin@example.com"
            />
            <label class="admin-modal__label" for="adminPassword">관리자 비밀번호</label>
            <input
              id="adminPassword"
              name="adminPassword"
              type="password"
              required
              autocomplete="current-password"
              class="admin-modal__input"
              data-role="admin-password"
              placeholder="비밀번호"
            />
            <p class="admin-modal__helper" data-role="admin-login-message" role="status" aria-live="polite"></p>
            <button class="btn btn--primary admin-modal__submit" type="submit">로그인</button>
          </form>
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
              <div class="results-toolbar__group">
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
              <div class="results-toolbar__actions">
                <button class="btn btn--ghost" type="button" data-result-operation="svg">PNG → SVG 변환</button>
                <button class="btn btn--outline" type="button" data-result-download="selected">선택 다운로드</button>
                <button class="btn btn--primary" type="button" data-result-download="all">전체 다운로드</button>
              </div>
            </div>
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
                  <button class="btn btn--ghost btn--sm" type="button" data-action="analyze-current">
                    분석 실행
                  </button>
                  <button class="btn btn--subtle btn--sm" type="button" data-action="copy-analysis">
                    키워드 복사
                  </button>
                </div>
              </div>
              <p class="analysis__meta" data-role="analysis-meta" aria-live="polite"></p>
              <p class="analysis__hint" data-role="analysis-hint">분석할 결과 이미지를 선택하고 “분석 실행” 버튼을 눌러보세요.</p>
              <p class="analysis__headline" data-role="analysis-title"></p>
              <ul class="analysis__keywords" data-role="analysis-keywords"></ul>
              <p class="analysis__summary" data-role="analysis-summary"></p>
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
            <a href="/?admin=1" target="_blank" rel="noopener">관리자 전용</a>
          </nav>
        </div>
        <p class="site-footer__note">© {currentYear} Ellie’s Bang. 모든 권리 보유.</p>
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
        <p class="legal-page__copyright">© {currentYear} Ellie’s Bang. All rights reserved.</p>
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
        <p class="legal-page__copyright">© {currentYear} Ellie’s Bang. All rights reserved.</p>
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
        <p class="legal-page__copyright">© {currentYear} Ellie’s Bang. All rights reserved.</p>
        <a class="legal-page__back" href="/">← 에디터로 돌아가기</a>
      </footer>
    </main>
  )
})

app.get('/login.html', (c) => {
  const loginPage = `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ellie Image Editor 관리자 로그인</title>
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
        background: linear-gradient(180deg, #f5f3ff 0%, #ffffff 55%, #f9fafb 100%);
        color: #111827;
      }

      header,
      footer {
        padding: 2.5rem 3rem;
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(12px);
      }

      header {
        border-bottom: 1px solid rgba(99, 102, 241, 0.12);
      }

      footer {
        border-top: 1px solid rgba(99, 102, 241, 0.12);
        font-size: 0.85rem;
        color: #6b7280;
        text-align: center;
      }

      main {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 3rem 1.5rem 4rem;
      }

      .login-card {
        width: min(480px, 100%);
        background: rgba(255, 255, 255, 0.95);
        border-radius: 1.75rem;
        padding: 2.5rem 2.25rem;
        box-shadow: 0 35px 80px -45px rgba(79, 70, 229, 0.35);
        border: 1px solid rgba(99, 102, 241, 0.16);
        display: flex;
        flex-direction: column;
        gap: 1.75rem;
      }

      .login-card__title {
        margin: 0;
        font-size: 1.6rem;
        color: #312e81;
        letter-spacing: -0.01em;
      }

      .login-card__description {
        margin: 0.25rem 0 0;
        color: #4b5563;
        font-size: 0.96rem;
        line-height: 1.6;
      }

      .login-card__form {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      .login-card__field {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .login-card__label {
        font-size: 0.9rem;
        font-weight: 600;
        color: #4338ca;
      }

      .login-card__input {
        width: 100%;
        border-radius: 0.9rem;
        border: 1px solid rgba(99, 102, 241, 0.28);
        padding: 0.95rem 1.1rem;
        font-size: 0.98rem;
        transition: border 0.2s ease, box-shadow 0.2s ease;
        outline: none;
        background: rgba(255, 255, 255, 0.92);
      }

      .login-card__input:focus {
        border-color: rgba(79, 70, 229, 0.6);
        box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.14);
      }

      .login-card__submit {
        border: none;
        border-radius: 999px;
        padding: 0.95rem 1.25rem;
        font-size: 1rem;
        font-weight: 600;
        color: #fff;
        background: linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #4f46e5 100%);
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .login-card__submit:hover,
      .login-card__submit:focus-visible {
        transform: translateY(-1px);
        box-shadow: 0 18px 30px -20px rgba(79, 70, 229, 0.6);
      }

      .login-card__status {
        min-height: 1.5rem;
        margin: 0;
        font-size: 0.9rem;
        line-height: 1.4;
        color: #4b5563;
      }

      .login-card__status[data-tone='info'] {
        color: #4338ca;
      }

      .login-card__status[data-tone='success'] {
        color: #047857;
      }

      .login-card__status[data-tone='warning'] {
        color: #b45309;
      }

      .login-card__status[data-tone='danger'] {
        color: #dc2626;
      }

      .login-meta {
        font-size: 0.88rem;
        color: #6b7280;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }

      .login-meta strong {
        color: #4338ca;
      }

      .login-card__preview {
        margin: 1.75rem 0 0;
        padding: 1.2rem 1.15rem 1.35rem;
        border-radius: 1.6rem;
        border: 1px solid rgba(79, 70, 229, 0.18);
        background: rgba(238, 242, 255, 0.65);
        box-shadow: 0 24px 48px -32px rgba(79, 70, 229, 0.45);
        display: grid;
        gap: 0.85rem;
      }

      .login-card__preview[hidden] {
        display: none;
      }

      .login-card__preview-image {
        width: 100%;
        display: block;
        border-radius: 1rem;
        background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(59, 130, 246, 0.15));
        box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.1);
      }

      .login-card__preview-caption {
        margin: 0;
        font-size: 0.82rem;
        color: #4b5563;
        text-align: center;
      }

      @media (max-width: 640px) {
        header,
        footer {
          padding: 1.75rem 1.5rem;
        }

        .login-card {
          padding: 2.15rem 1.75rem;
          border-radius: 1.5rem;
        }
      }
    </style>
  </head>
  <body class="admin-login-page">
    <header>
      <h1 style="margin:0;font-size:1.3rem;font-weight:600;color:#312e81;">Ellie Image Editor 관리자 센터</h1>
    </header>
    <div class="pointer-events-none fixed inset-x-0 top-5 flex justify-center px-4">
      <div
        data-role="admin-toast"
        class="hidden w-full max-w-sm -translate-y-2 transform rounded-2xl bg-slate-900/90 px-5 py-4 text-sm font-medium text-white opacity-0 shadow-2xl ring-1 ring-black/10 backdrop-blur-lg transition"
        role="status"
        aria-live="assertive"
      ></div>
    </div>
    <main>
      <section class="login-card" aria-labelledby="admin-login-title">
        <div>
          <h2 class="login-card__title" id="admin-login-title">관리자 로그인</h2>
          <p class="login-card__description">등록된 관리자 이메일과 비밀번호를 입력해 대시보드를 열어주세요.</p>
        </div>
        <form class="login-card__form" data-role="admin-login-form" data-state="idle">
          <div class="login-card__field">
            <label class="login-card__label" for="adminLoginEmail">이메일</label>
            <input
              id="adminLoginEmail"
              class="login-card__input"
              type="email"
              name="email"
              placeholder="ellie@elliesbang.kr"
              autocomplete="email"
              required
              data-role="admin-login-email"
            />
          </div>
          <div class="login-card__field">
            <label class="login-card__label" for="adminLoginPassword">비밀번호</label>
            <input
              id="adminLoginPassword"
              class="login-card__input"
              type="password"
              name="password"
              placeholder="비밀번호를 입력하세요"
              autocomplete="current-password"
              required
              data-role="admin-login-password"
            />
          </div>
          <button class="login-card__submit" type="submit">대시보드 열기</button>
        </form>
        <p class="login-card__status" data-role="admin-login-status" aria-live="polite"></p>
        <figure class="login-card__preview" data-role="admin-preview" aria-hidden="true" hidden>
          <img
            class="login-card__preview-image"
            src="/static/admin-preview.svg"
            alt="Ellie Image Editor 관리자 대시보드 미리보기"
            loading="lazy"
            decoding="async"
          />
          <figcaption class="login-card__preview-caption">
            관리자 전용 대시보드 기능을 한눈에 살펴볼 수 있는 미리보기 화면입니다.
          </figcaption>
        </figure>
        <div class="login-meta">
          <span><strong>보안 안내:</strong> 관리자 인증 정보는 Cloudflare Pages 환경변수로 관리됩니다.</span>
          <span>오류가 반복되면 서비스 운영자에게 문의해주세요.</span>
        </div>
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
        const DASHBOARD_URL = new URL('/admin-dashboard', window.location.origin).toString();

        const elements = {
          form: document.querySelector('[data-role="admin-login-form"]'),
          email: document.querySelector('[data-role="admin-login-email"]'),
          password: document.querySelector('[data-role="admin-login-password"]'),
          status: document.querySelector('[data-role="admin-login-status"]'),
          preview: document.querySelector('[data-role="admin-preview"]'),
          toast: document.querySelector('[data-role="admin-toast"]'),
        };

        if (elements.email instanceof HTMLInputElement && ADMIN_EMAIL) {
          elements.email.placeholder = ADMIN_EMAIL;
        }

        let toastTimer = null;
        let broadcast = null;
        let currentSessionId = '';

        const TOAST_TONES = {
          info: 'bg-indigo-600 text-white',
          success: 'bg-emerald-600 text-white',
          warning: 'bg-amber-400 text-slate-900',
          danger: 'bg-rose-600 text-white',
        };

        function generateSessionId() {
          return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : 'sess-' + Date.now() + '-' + Math.random().toString(16).slice(2);
        }

        function getTabSessionId() {
          try {
            return window.sessionStorage?.getItem(SESSION_ID_KEY) || '';
          } catch (error) {
            console.warn('[admin-login] failed to read tab session id', error);
            return '';
          }
        }

        function setTabSessionId(value) {
          try {
            const storage = window.sessionStorage;
            if (!storage) return;
            if (!value) {
              storage.removeItem(SESSION_ID_KEY);
            } else {
              storage.setItem(SESSION_ID_KEY, value);
            }
          } catch (error) {
            console.warn('[admin-login] failed to store tab session id', error);
          }
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
            console.warn('[admin-login] failed to parse stored session', error);
            return null;
          }
        }

        function isOwnedSession(session) {
          if (!session || !session.sessionId) return false;
          return session.sessionId === getTabSessionId();
        }

        function writeSession(email) {
          const loginTime = Date.now();
          const sessionId = generateSessionId();
          try {
            window.localStorage?.setItem(
              STORAGE_KEY,
              JSON.stringify({ loggedIn: true, email, loginTime, sessionId }),
            );
          } catch (error) {
            console.warn('[admin-login] failed to persist session', error);
          }
          setTabSessionId(sessionId);
          currentSessionId = sessionId;
          return { loggedIn: true, email, loginTime, sessionId };
        }

        function setStatus(message, tone = 'info') {
          if (!(elements.status instanceof HTMLElement)) {
            return;
          }
          elements.status.textContent = message;
          elements.status.dataset.tone = message ? tone : '';
        }

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

        function setFormLocked(locked) {
          if (!(elements.form instanceof HTMLFormElement)) {
            return;
          }
          elements.form.dataset.locked = locked ? 'true' : 'false';
          if (locked) {
            elements.form.dataset.state = 'locked';
          } else if (elements.form.dataset.state === 'locked') {
            elements.form.dataset.state = 'idle';
          }
          const controls = elements.form.querySelectorAll('input, button');
          controls.forEach((control) => {
            if (control instanceof HTMLInputElement || control instanceof HTMLButtonElement) {
              control.disabled = locked;
              if (locked) {
                control.setAttribute('aria-disabled', 'true');
              } else {
                control.removeAttribute('aria-disabled');
              }
            }
          });
          if (!locked) {
            if (elements.email instanceof HTMLInputElement) {
              window.requestAnimationFrame(() => elements.email.focus());
            }
          }
        }

        function setPreviewVisibility(visible) {
          if (!(elements.preview instanceof HTMLElement)) {
            return;
          }
          elements.preview.hidden = !visible;
          elements.preview.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }

        function initializePreviewVisibility() {
          let shouldShowPreview = false;
          try {
            const storage = window.sessionStorage;
            if (storage) {
              const flag = storage.getItem('adminPreviewRequested');
              shouldShowPreview = flag === '1';
              storage.removeItem('adminPreviewRequested');
            }
          } catch (error) {
            console.warn('[admin-login] preview flag read failed', error);
          }
          setPreviewVisibility(shouldShowPreview);
        }

        function focusEmail() {
          if (elements.email instanceof HTMLInputElement && elements.form?.dataset.locked !== 'true') {
            elements.email.focus();
          }
        }

        function openDashboard(target = 'new') {
          if (target === 'self') {
            window.location.replace(DASHBOARD_URL);
            return;
          }
          const popup = window.open(DASHBOARD_URL, '_blank', 'noopener');
          if (!popup || popup.closed) {
            window.location.href = DASHBOARD_URL;
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
            console.warn('[admin-login] failed to initialize channel', error);
            broadcast = null;
          }
        }

        function announceLogin(session) {
          ensureBroadcastChannel();
          if (!session) return;
          try {
            broadcast?.postMessage({ type: 'login', session });
          } catch (error) {
            console.warn('[admin-login] failed to broadcast login', error);
          }
        }

        function forceLogout(message) {
          currentSessionId = '';
          setTabSessionId('');
          setFormLocked(true);
          setStatus(message, 'warning');
          showToast(message, 'warning');
        }

        function handleSessionCleared(message) {
          currentSessionId = '';
          setTabSessionId('');
          setFormLocked(false);
          setStatus(message, 'info');
          showToast(message, 'info');
        }

        function handleBroadcastMessage(event) {
          const data = event?.data;
          if (!data || typeof data !== 'object') return;
          if (data.type === 'login' && data.session && !isOwnedSession(data.session)) {
            forceLogout('다른 위치에서 로그인되었습니다.');
          } else if (data.type === 'logout') {
            handleSessionCleared('다른 위치에서 로그아웃되었습니다.');
          }
        }

        function handleStorageEvent(event) {
          if (!event || event.storageArea !== window.localStorage) return;
          if (event.key === null) {
            handleSessionCleared('다른 위치에서 로그아웃되었습니다.');
            return;
          }
          if (event.key !== STORAGE_KEY) {
            return;
          }
          if (!event.newValue) {
            handleSessionCleared('다른 위치에서 로그아웃되었습니다.');
            return;
          }
          try {
            const session = JSON.parse(event.newValue);
            if (!isOwnedSession(session)) {
              forceLogout('다른 위치에서 로그인되었습니다.');
            }
          } catch (error) {
            console.warn('[admin-login] failed to parse sync payload', error);
          }
        }

        function restoreSessionIfOwned() {
          const stored = readStoredSession();
          if (!stored || stored.email !== ADMIN_EMAIL) {
            return false;
          }
          if (isOwnedSession(stored)) {
            currentSessionId = stored.sessionId || '';
            setStatus('이전에 로그인한 세션을 복원했습니다. 대시보드를 여는 중입니다.', 'info');
            showToast('이전에 로그인한 세션을 복원했습니다.', 'info');
            openDashboard('self');
            return true;
          }
          return false;
        }

        function checkExistingLock() {
          const stored = readStoredSession();
          if (stored && stored.email === ADMIN_EMAIL && !isOwnedSession(stored)) {
            setFormLocked(true);
            setStatus('이미 다른 위치에서 로그인되어 있습니다. 로그아웃 후 다시 시도해주세요.', 'warning');
            showToast('이미 로그인 중인 계정입니다. 로그아웃 후 다시 시도해주세요.', 'warning');
          }
        }

        currentSessionId = getTabSessionId();
        ensureBroadcastChannel();
        window.addEventListener('storage', handleStorageEvent);
        initializePreviewVisibility();

        if (restoreSessionIfOwned()) {
          return;
        }

        checkExistingLock();

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', focusEmail, { once: true });
        } else {
          focusEmail();
        }

        if (
          elements.form instanceof HTMLFormElement &&
          elements.email instanceof HTMLInputElement &&
          elements.password instanceof HTMLInputElement
        ) {
          elements.form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (elements.form.dataset.state === 'loading' || elements.form.dataset.locked === 'true') {
              return;
            }

            const email = elements.email.value.trim().toLowerCase();
            const password = elements.password.value;

            if (!email || !password) {
              setStatus('이메일과 비밀번호를 모두 입력해 주세요.', 'warning');
              showToast('이메일과 비밀번호를 모두 입력해 주세요.', 'warning');
              return;
            }

            const existing = readStoredSession();
            if (existing && existing.email === email) {
              if (isOwnedSession(existing)) {
                setStatus('이미 로그인된 세션이 활성화되어 있습니다.', 'warning');
                showToast('이미 로그인된 세션이 활성화되어 있습니다.', 'warning');
              } else {
                setStatus('이미 로그인 중인 계정입니다. 로그아웃 후 다시 시도해주세요.', 'warning');
                showToast('이미 로그인 중인 계정입니다. 로그아웃 후 다시 시도해주세요.', 'warning');
              }
              setFormLocked(true);
              return;
            }

            const submitButton = elements.form.querySelector('button[type="submit"]');
            if (submitButton instanceof HTMLButtonElement) {
              submitButton.disabled = true;
            }
            elements.form.dataset.state = 'loading';
            setStatus('관리자 자격을 확인하는 중입니다…', 'info');

            fetch('/api/auth/admin/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ email, password }),
            })
              .then(async (response) => {
                if (response.ok) {
                  const session = writeSession(email);
                  announceLogin(session);
                  setStatus('인증이 완료되었습니다. 잠시 후 대시보드가 열립니다.', 'success');
                  showToast('인증이 완료되었습니다. 대시보드를 준비하고 있습니다.', 'success');
                  const popup = window.open(DASHBOARD_URL, '_blank', 'noopener');
                  if (!popup || popup.closed) {
                    openDashboard('self');
                  }
                  elements.form.reset();
                  window.setTimeout(() => setStatus('', ''), 3000);
                  return;
                }

                if (response.status === 401) {
                  setStatus('이메일 또는 비밀번호가 올바르지 않습니다.', 'danger');
                  showToast('관리자 자격이 올바르지 않습니다.', 'danger');
                  elements.password.value = '';
                  elements.password.focus();
                  return;
                }

                if (response.status === 429) {
                  const detail = await response.json().catch(() => ({}));
                  const retryAfter = Number(detail?.retryAfter ?? 0);
                  const seconds = Number.isFinite(retryAfter) ? Math.max(1, Math.ceil(retryAfter)) : 0;
                  const message =
                    seconds > 0
                      ? '로그인 시도가 많아 잠시 후 다시 시도해주세요. (약 ' + seconds + '초 후 가능)'
                      : '로그인 시도가 많아 잠시 후 다시 시도해주세요.';
                  setStatus(message, 'warning');
                  showToast(message, 'warning');
                  return;
                }

                if (response.status === 500) {
                  setStatus('관리자 인증 구성이 완료되지 않았습니다. 운영자에게 문의해주세요.', 'danger');
                  showToast('관리자 인증 구성이 완료되지 않았습니다.', 'danger');
                  return;
                }

                setStatus('로그인 중 오류(' + response.status + ')가 발생했습니다. 잠시 후 다시 시도해주세요.', 'danger');
                showToast('로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'danger');
              })
              .catch((error) => {
                console.error('[admin-login] Unexpected error', error);
                setStatus('로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'danger');
                showToast('로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'danger');
              })
              .finally(() => {
                if (submitButton instanceof HTMLButtonElement) {
                  submitButton.disabled = false;
                }
                if (elements.form.dataset.state === 'loading') {
                  elements.form.dataset.state = elements.form.dataset.locked === 'true' ? 'locked' : 'idle';
                }
              });
          });
        }
      })();
    </script>
  </body>
</html>`

  const response = c.html(loginPage)
  response.headers.set('Cache-Control', 'no-store')
  return response
})

app.get('/dashboard.html', (c) => c.redirect('/admin-dashboard', 301))

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
