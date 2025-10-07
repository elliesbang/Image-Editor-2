import { Hono } from 'hono'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { createHash } from 'node:crypto'
import { createConnection } from 'node:net'
import { connect as createTlsConnection } from 'node:tls'
import { renderer } from './renderer'

type KeyValueListKey = {
  name: string
}

type KeyValueListResult = {
  keys: KeyValueListKey[]
  list_complete: boolean
  cursor?: string
}

type KeyValueListOptions = {
  prefix: string
  cursor?: string
}

interface KeyValueStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(options: KeyValueListOptions): Promise<KeyValueListResult>
}

type Bindings = {
  OPENAI_API_KEY?: string
  OPEN_AI_API_KEY?: string
  ADMIN_EMAIL?: string
  ADMIN_MAIL?: string
  ADMIN_PASSWORD?: string
  ADMIN_PASSWORD_HASH?: string
  SESSION_SECRET?: string
  ADMIN_SESSION_VERSION?: string
  ADMIN_RATE_LIMIT_MAX_ATTEMPTS?: string
  ADMIN_RATE_LIMIT_WINDOW_SECONDS?: string
  ADMIN_RATE_LIMIT_COOLDOWN_SECONDS?: string
  CHALLENGE_KV?: KeyValueStore
  CHALLENGE_KV_BACKUP?: KeyValueStore
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_REDIRECT_URI?: string
  MICHINA_COMMUNITY_URL?: string
  RESEND_API_KEY?: string
  SENDGRID_API_KEY?: string
  EMAIL_FROM_ADDRESS?: string
  EMAIL_FROM_NAME?: string
  EMAIL_SMTP_HOST?: string
  EMAIL_SMTP_PORT?: string
  EMAIL_SMTP_SECURE?: string
  EMAIL_SMTP_USER?: string
  EMAIL_SMTP_PASSWORD?: string
  EMAIL_BRAND_NAME?: string
  EMAIL_OTP_EXPIRY_SECONDS?: string
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

type UserPlan = 'public' | 'free' | 'basic' | 'pro' | 'premium' | 'michina' | 'admin'

type UserAccount = {
  email: string
  name?: string
  plan: UserPlan
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
  subscriptionCredits?: number
  topUpCredits?: number
  planExpiresAt?: string
  lastOtpAt?: string
  metadata?: Record<string, unknown>
}

type EmailVerificationIntent = 'login' | 'register'

type EmailVerificationRecord = {
  email: string
  codeHash: string
  intent: EmailVerificationIntent
  issuedAt: number
  expiresAt: number
  attempts: number
  createdAt: string
  updatedAt: string
}

type EmailDispatchContext = {
  brand: string
  from: string
  expirySeconds: number
}

type EmailSendPayload = {
  to: string
  subject: string
  text: string
  html: string
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
const ADMIN_SESSION_ISSUER = 'elliesbang-image-editor'
const ADMIN_SESSION_AUDIENCE = 'elliesbang-image-editor/admin'
const ADMIN_RATE_LIMIT_KEY_PREFIX = 'ratelimit:admin-login:'
const DEFAULT_ADMIN_RATE_LIMIT_MAX_ATTEMPTS = 5
const DEFAULT_ADMIN_RATE_LIMIT_WINDOW_SECONDS = 60
const DEFAULT_ADMIN_RATE_LIMIT_COOLDOWN_SECONDS = 300
const MIN_ADMIN_PASSWORD_LENGTH = 12
const PARTICIPANT_KEY_PREFIX = 'participant:'
const USER_ACCOUNT_KEY_PREFIX = 'user:'
const EMAIL_VERIFICATION_KEY_PREFIX = 'email-verification:'
const EMAIL_VERIFICATION_COOLDOWN_MS = 30_000
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5
const EMAIL_VERIFICATION_CODE_LENGTH = 6
const REQUIRED_SUBMISSIONS = 15
const CHALLENGE_DURATION_BUSINESS_DAYS = 15
const DEFAULT_GOOGLE_REDIRECT_URI = 'https://elliesbang-image-editor.netlify.app/auth/google/callback'
const DEFAULT_EMAIL_OTP_EXPIRY_SECONDS = 300
const FREE_MONTHLY_CREDITS = 30
const SERVER_FUNCTION_PATH = '/.netlify/functions/server'
const API_BASE_PATH = SERVER_FUNCTION_PATH
const ALLOWED_CORS_ORIGINS = new Set([
  'https://elliesbang-image-editor.netlify.app',
  'https://www.elliesbang-image-editor.netlify.app',
  'https://elliesbang.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])
const DEFAULT_CORS_HEADERS = 'Content-Type,Authorization'
const RAW_PUBLIC_BASE_PATH = import.meta.env.BASE_URL ?? '/'
const PUBLIC_BASE_PATH = RAW_PUBLIC_BASE_PATH.endsWith('/') ? RAW_PUBLIC_BASE_PATH : `${RAW_PUBLIC_BASE_PATH}/`
const LEGAL_PAGE_SLUGS = new Set(['privacy', 'terms', 'cookies'])

function resolveAppHref(target?: string) {
  const trimmed = target?.replace(/^\/+/u, '') ?? ''

  if (!trimmed) {
    return PUBLIC_BASE_PATH === '/' ? './' : PUBLIC_BASE_PATH
  }

  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed
  }

  const normalizedSlug = trimmed.replace(/\.html$/u, '')
  const requiresHtmlExtension = LEGAL_PAGE_SLUGS.has(normalizedSlug)
  const normalizedTarget = requiresHtmlExtension ? `${normalizedSlug}.html` : trimmed
  const withoutLeadingSlash = normalizedTarget.startsWith('/')
    ? normalizedTarget.slice(1)
    : normalizedTarget

  return PUBLIC_BASE_PATH === '/' ? `./${withoutLeadingSlash}` : `${PUBLIC_BASE_PATH}${withoutLeadingSlash}`
}

function resolveCorsOrigin(origin: string | null | undefined) {
  if (!origin) return ''
  const trimmed = origin.trim()
  if (!trimmed) return ''
  if (ALLOWED_CORS_ORIGINS.has(trimmed)) {
    return trimmed
  }
  return ''
}

function applyCorsHeaders(c: Context<{ Bindings: Bindings }>, origin: string) {
  if (!origin) return
  c.res.headers.set('Access-Control-Allow-Origin', origin)
  c.res.headers.set('Access-Control-Allow-Credentials', 'true')
  const currentVary = c.res.headers.get('Vary')
  if (!currentVary) {
    c.res.headers.set('Vary', 'Origin')
  } else if (!currentVary.split(',').map((value) => value.trim()).includes('Origin')) {
    c.res.headers.set('Vary', `${currentVary}, Origin`)
  }
}

type RuntimeProcess = {
  env?: Record<string, string | undefined>
}

const runtimeProcess =
  typeof globalThis !== 'undefined' && 'process' in globalThis
    ? (globalThis as { process?: RuntimeProcess }).process
    : undefined

const inMemoryStore = new Map<string, string>()
const inMemoryBackupStore = new Map<string, string>()
const inMemoryExpiryStore = new Map<string, number>()
const inMemoryBackupExpiryStore = new Map<string, number>()
const rateLimitMemoryStore = new Map<string, RateLimitRecord>()

function encodeKey(email: string) {
  return `${PARTICIPANT_KEY_PREFIX}${email.toLowerCase()}`
}

function encodeUserKey(email: string) {
  return `${USER_ACCOUNT_KEY_PREFIX}${email.toLowerCase()}`
}

function buildVerificationKey(email: string) {
  return `${EMAIL_VERIFICATION_KEY_PREFIX}${email.toLowerCase()}`
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

function resolveAdminEmail(env: Bindings): string {
  const raw = (env.ADMIN_MAIL ?? env.ADMIN_EMAIL ?? '').trim().toLowerCase()
  return raw
}

function resolveOpenAIKey(env: Bindings): string | null {
  const candidates = [env.OPENAI_API_KEY, env.OPEN_AI_API_KEY]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }
  }
  return null
}

function validateAdminEnvironment(env: Bindings): AdminConfigValidationResult {
  const issues: string[] = []

  const emailRaw = resolveAdminEmail(env)
  if (!emailRaw) {
    issues.push('ADMIN_MAIL or ADMIN_EMAIL is not configured')
  } else if (!isValidEmail(emailRaw)) {
    issues.push('ADMIN_MAIL/ADMIN_EMAIL must be a valid email address')
  }

  const passwordHashRaw = env.ADMIN_PASSWORD_HASH?.trim().toLowerCase() ?? ''
  const passwordPlain = env.ADMIN_PASSWORD?.trim() ?? ''
  let passwordHash = ''
  if (passwordHashRaw) {
    if (!/^[0-9a-f]{64}$/i.test(passwordHashRaw)) {
      issues.push('ADMIN_PASSWORD_HASH must be a 64-character SHA-256 hex digest')
    } else {
      passwordHash = passwordHashRaw
    }
  } else if (passwordPlain) {
    if (passwordPlain.length < MIN_ADMIN_PASSWORD_LENGTH) {
      issues.push(`ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`)
    } else {
      passwordHash = createHash('sha256').update(passwordPlain, 'utf8').digest('hex')
    }
  } else {
    issues.push('ADMIN_PASSWORD or ADMIN_PASSWORD_HASH must be configured')
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
      passwordHash,
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
      const expiry = inMemoryExpiryStore.get(key)
      if (typeof expiry === 'number' && expiry > 0 && expiry <= Date.now()) {
        inMemoryStore.delete(key)
        inMemoryExpiryStore.delete(key)
      } else {
        return memoryValue
      }
    }
  }
  if (!backup) {
    const backupMemoryValue = inMemoryBackupStore.get(key)
    if (backupMemoryValue) {
      const expiry = inMemoryBackupExpiryStore.get(key)
      if (typeof expiry === 'number' && expiry > 0 && expiry <= Date.now()) {
        inMemoryBackupStore.delete(key)
        inMemoryBackupExpiryStore.delete(key)
      } else {
        return backupMemoryValue
      }
    }
  }
  return null
}

async function kvPut(env: Bindings, key: string, value: string) {
  if (env.CHALLENGE_KV) {
    await env.CHALLENGE_KV.put(key, value)
  } else {
    inMemoryStore.set(key, value)
    inMemoryExpiryStore.delete(key)
  }

  if (env.CHALLENGE_KV_BACKUP) {
    await env.CHALLENGE_KV_BACKUP.put(key, value)
  } else if (!env.CHALLENGE_KV) {
    inMemoryBackupStore.set(key, value)
    inMemoryBackupExpiryStore.delete(key)
  }
}

async function kvPutWithTTL(env: Bindings, key: string, value: string, ttlSeconds: number) {
  const normalizedTtl = Math.max(1, Math.ceil(ttlSeconds))
  const ttlMs = normalizedTtl * 1000

  if (env.CHALLENGE_KV) {
    await env.CHALLENGE_KV.put(key, value, { expirationTtl: normalizedTtl })
  } else {
    inMemoryStore.set(key, value)
    inMemoryExpiryStore.set(key, Date.now() + ttlMs)
  }

  if (env.CHALLENGE_KV_BACKUP) {
    await env.CHALLENGE_KV_BACKUP.put(key, value, { expirationTtl: normalizedTtl })
  } else if (!env.CHALLENGE_KV) {
    inMemoryBackupStore.set(key, value)
    inMemoryBackupExpiryStore.set(key, Date.now() + ttlMs)
  }
}

async function kvDelete(env: Bindings, key: string) {
  if (env.CHALLENGE_KV) {
    await env.CHALLENGE_KV.delete(key)
  } else {
    inMemoryStore.delete(key)
    inMemoryExpiryStore.delete(key)
  }

  if (env.CHALLENGE_KV_BACKUP) {
    await env.CHALLENGE_KV_BACKUP.delete(key)
  } else if (!env.CHALLENGE_KV) {
    inMemoryBackupStore.delete(key)
    inMemoryBackupExpiryStore.delete(key)
  }
}

async function getUserAccount(env: Bindings, email: string): Promise<UserAccount | null> {
  const key = encodeUserKey(email)
  const stored = await kvGet(env, key)
  if (!stored) return null
  try {
    const parsed = JSON.parse(stored) as UserAccount
    if (typeof parsed.email !== 'string' || !parsed.email) {
      return null
    }
    if (!parsed.plan) {
      parsed.plan = 'free'
    }
    return parsed
  } catch (error) {
    console.error('[auth/email] Failed to parse user account record', error)
    return null
  }
}

async function saveUserAccount(env: Bindings, account: UserAccount) {
  const normalizedEmail = account.email.trim().toLowerCase()
  const nowIso = new Date().toISOString()
  const record: UserAccount = {
    email: normalizedEmail,
    name: account.name,
    plan: account.plan || 'free',
    createdAt: account.createdAt || nowIso,
    updatedAt: nowIso,
    lastLoginAt: account.lastLoginAt,
    subscriptionCredits: account.subscriptionCredits,
    topUpCredits: account.topUpCredits,
    planExpiresAt: account.planExpiresAt,
    lastOtpAt: account.lastOtpAt,
    metadata: account.metadata,
  }
  await kvPut(env, encodeUserKey(normalizedEmail), JSON.stringify(record))
}

async function deleteUserAccount(env: Bindings, email: string) {
  await kvDelete(env, encodeUserKey(email))
}

async function getEmailVerificationRecord(env: Bindings, email: string): Promise<EmailVerificationRecord | null> {
  const key = buildVerificationKey(email)
  const stored = await kvGet(env, key)
  if (!stored) return null
  try {
    const parsed = JSON.parse(stored) as EmailVerificationRecord
    if (!parsed.email || !parsed.codeHash) {
      await kvDelete(env, key)
      return null
    }
    if (typeof parsed.attempts !== 'number' || !Number.isFinite(parsed.attempts)) {
      parsed.attempts = 0
    }
    if (typeof parsed.issuedAt !== 'number' || typeof parsed.expiresAt !== 'number') {
      await kvDelete(env, key)
      return null
    }
    if (parsed.expiresAt <= Date.now()) {
      await kvDelete(env, key)
      return null
    }
    return parsed
  } catch (error) {
    console.error('[auth/email] Failed to parse verification record', error)
    await kvDelete(env, key)
    return null
  }
}

async function saveEmailVerificationRecord(env: Bindings, record: EmailVerificationRecord) {
  const updated: EmailVerificationRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
  }
  if (!updated.createdAt) {
    updated.createdAt = updated.updatedAt
  }
  const ttlSeconds = Math.max(60, Math.ceil((updated.expiresAt - Date.now()) / 1000))
  await kvPutWithTTL(env, buildVerificationKey(updated.email), JSON.stringify(updated), ttlSeconds)
}

async function deleteEmailVerificationRecord(env: Bindings, email: string) {
  await kvDelete(env, buildVerificationKey(email))
}

async function computeVerificationHash(email: string, code: string) {
  return sha256(`${email.toLowerCase()}::${code}`)
}

function createMessageId(domain: string) {
  try {
    if (typeof crypto.randomUUID === 'function') {
      return `<${crypto.randomUUID()}@${domain}>`
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      const hex = Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      return `<${hex}@${domain}>`
    }
  } catch (error) {
    // ignore entropy errors
  }
  const fallback = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
  return `<${fallback}@${domain}>`
}

function generateNumericCode(length: number) {
  const digits = '0123456789'
  if (length <= 0) return ''
  try {
    const values = new Uint32Array(length)
    if (typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(values)
      return Array.from(values, (value) => digits[value % digits.length]).join('')
    }
  } catch (error) {
    // ignore entropy errors and fall back to Math.random
  }
  let code = ''
  for (let index = 0; index < length; index += 1) {
    code += digits.charAt(Math.floor(Math.random() * digits.length))
  }
  return code
}

function deriveDisplayName(email: string) {
  if (!email) {
    return '크리에이터'
  }
  const local = email.split('@')[0] || ''
  const cleaned = local.replace(/[._-]+/g, ' ').trim()
  if (!cleaned) {
    return '크리에이터'
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function getEmailBrand(env: Bindings) {
  return env.EMAIL_BRAND_NAME?.trim() || 'Elliesbang Image Editor'
}

function getEmailDispatchContext(env: Bindings): EmailDispatchContext & { fromName: string } {
  const brand = getEmailBrand(env)
  const fromAddress = env.EMAIL_FROM_ADDRESS?.trim() || env.EMAIL_SMTP_USER?.trim() || ''
  const fromName = env.EMAIL_FROM_NAME?.trim() || brand
  const expirySeconds = parsePositiveInteger(env.EMAIL_OTP_EXPIRY_SECONDS, DEFAULT_EMAIL_OTP_EXPIRY_SECONDS, 60, 1800)
  return { brand, from: fromAddress, fromName, expirySeconds }
}

async function openSmtpConnection(host: string, port: number, secure: boolean) {
  return await new Promise<ReturnType<typeof createConnection>>((resolve, reject) => {
    let settled = false
    const handleError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      socket.removeListener('error', handleError)
      socket.removeListener('close', handleError)
    }
    const handleConnect = () => {
      if (settled) {
        cleanup()
        return
      }
      settled = true
      cleanup()
      socket.setEncoding('utf8')
      resolve(socket)
    }

    const socket = secure
      ? createTlsConnection({ host, port, servername: host }, handleConnect)
      : createConnection({ host, port }, handleConnect)

    socket.once('error', handleError)
    socket.once('close', handleError)
  })
}

async function smtpSend(options: {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
  to: string
  data: string
}) {
  const { host, port, secure, user, pass, from, to, data } = options
  const socket = await openSmtpConnection(host, port, secure)
  let closed = false

  const close = () => {
    if (!closed) {
      closed = true
      try {
        socket.end()
      } catch (error) {
        socket.destroy()
      }
    }
  }

  const writeRaw = async (content: string) => {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        socket.removeListener('error', onError)
        reject(error)
      }
      socket.once('error', onError)
      socket.write(content, (error) => {
        socket.removeListener('error', onError)
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  const writeLine = async (line: string) => {
    await writeRaw(`${line}\r\n`)
  }

  const waitFor = async (expectedCodes: number[], timeoutMs = 15000) => {
    return await new Promise<void>((resolve, reject) => {
      let buffer = ''
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('SMTP_RESPONSE_TIMEOUT'))
      }, timeoutMs)

      const cleanup = () => {
        clearTimeout(timer)
        socket.removeListener('data', onData)
        socket.removeListener('error', onError)
        socket.removeListener('close', onClose)
      }

      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }

      const onClose = () => {
        cleanup()
        reject(new Error('SMTP_CONNECTION_CLOSED'))
      }

      const onData = (chunk: Buffer | string) => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        const lines = buffer.split('\r\n').filter((line) => line.length > 0)
        if (lines.length === 0) {
          return
        }
        const lastLine = lines[lines.length - 1]
        const match = /^(\d{3})([ \-])(.*)$/.exec(lastLine)
        if (!match) {
          return
        }
        const [, codeRaw, continuation] = match
        const code = Number.parseInt(codeRaw, 10)
        if (continuation === '-') {
          return
        }
        cleanup()
        if (!expectedCodes.includes(code)) {
          reject(new Error(`SMTP_UNEXPECTED_RESPONSE_${code}`))
          return
        }
        resolve()
      }

      socket.on('data', onData)
      socket.on('error', onError)
      socket.on('close', onClose)
    })
  }

  try {
    await waitFor([220])
    await writeLine(`EHLO ${host || 'elliesbang-image-editor.local'}`)
    await waitFor([250])
    await writeLine('AUTH LOGIN')
    await waitFor([334])
    await writeLine(Buffer.from(user, 'utf8').toString('base64'))
    await waitFor([334])
    await writeLine(Buffer.from(pass, 'utf8').toString('base64'))
    await waitFor([235])
    await writeLine(`MAIL FROM:<${from}>`)
    await waitFor([250])
    await writeLine(`RCPT TO:<${to}>`)
    await waitFor([250, 251])
    await writeLine('DATA')
    await waitFor([354])
    await writeRaw(data)
    await waitFor([250])
    await writeLine('QUIT')
    await waitFor([221])
  } finally {
    close()
  }
}

async function sendEmailViaSmtp(env: Bindings, context: EmailDispatchContext & { fromName: string }, payload: EmailSendPayload) {
  const host = env.EMAIL_SMTP_HOST?.trim()
  const user = env.EMAIL_SMTP_USER?.trim()
  const pass = env.EMAIL_SMTP_PASSWORD?.trim()
  if (!host || !user || !pass || !context.from) {
    throw new Error('SMTP_NOT_CONFIGURED')
  }
  const securePreference = env.EMAIL_SMTP_SECURE?.trim().toLowerCase()
  const defaultPort = securePreference === 'false' || securePreference === '0' ? 587 : 465
  const port = parsePositiveInteger(env.EMAIL_SMTP_PORT, defaultPort, 1, 65535)
  const secure = securePreference
    ? !(securePreference === 'false' || securePreference === '0')
    : port === 465

  const fromHeader = context.fromName ? `${context.fromName} <${context.from}>` : context.from
  const boundary = `----=_Elliesbang_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
  const normalizedText = payload.text.replace(/\r?\n/g, '\n')
  const normalizedHtml = payload.html.replace(/\r?\n/g, '\n')
  const messageLines = [
    `Message-ID: ${createMessageId(host)}`,
    `Date: ${new Date().toUTCString()}`,
    `From: ${fromHeader}`,
    `To: ${payload.to}`,
    `Subject: ${payload.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    normalizedText,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    normalizedHtml,
    '',
    `--${boundary}--`,
    '',
  ]

  const rawMessage = messageLines.join('\r\n')
  const preparedMessage = `${rawMessage.replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`

  await smtpSend({
    host,
    port,
    secure,
    user,
    pass,
    from: context.from,
    to: payload.to,
    data: preparedMessage,
  })
}

async function sendEmailViaResend(env: Bindings, context: EmailDispatchContext & { fromName: string }, payload: EmailSendPayload) {
  const apiKey = env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('RESEND_NOT_CONFIGURED')
  }
  const fromHeader = context.fromName ? `${context.fromName} <${context.from}>` : context.from
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromHeader,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`RESEND_REQUEST_FAILED_${response.status}_${detail}`)
  }
}

async function sendEmailViaSendGrid(env: Bindings, context: EmailDispatchContext & { fromName: string }, payload: EmailSendPayload) {
  const apiKey = env.SENDGRID_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('SENDGRID_NOT_CONFIGURED')
  }
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: payload.to }],
          subject: payload.subject,
        },
      ],
      from: { email: context.from, name: context.fromName },
      content: [
        { type: 'text/plain', value: payload.text },
        { type: 'text/html', value: payload.html },
      ],
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`SENDGRID_REQUEST_FAILED_${response.status}_${detail}`)
  }
}

async function dispatchEmail(
  env: Bindings,
  payload: EmailSendPayload,
  providedContext?: EmailDispatchContext & { fromName: string },
) {
  const context = providedContext ?? getEmailDispatchContext(env)
  if (!context.from) {
    throw new Error('EMAIL_FROM_NOT_CONFIGURED')
  }
  if (env.RESEND_API_KEY?.trim()) {
    try {
      await sendEmailViaResend(env, context, payload)
      return
    } catch (error) {
      console.error('[auth/email] Failed to send via Resend', error)
    }
  }
  if (env.SENDGRID_API_KEY?.trim()) {
    try {
      await sendEmailViaSendGrid(env, context, payload)
      return
    } catch (error) {
      console.error('[auth/email] Failed to send via SendGrid', error)
    }
  }
  await sendEmailViaSmtp(env, context, payload)
}

async function sendVerificationEmail(
  env: Bindings,
  email: string,
  code: string,
  intent: EmailVerificationIntent,
  context: EmailDispatchContext & { fromName: string },
) {
  const capitalizedIntent = intent === 'register' ? '회원가입' : '로그인'
  const brand = context.brand
  const subject = `[${brand}] ${capitalizedIntent} 인증 코드`
  const minutes = Math.max(1, Math.ceil(context.expirySeconds / 60))
  const text = [
    `${brand} ${capitalizedIntent} 인증 코드`,
    '',
    `인증 코드: ${code}`,
    `유효 시간: ${minutes}분`,
    '',
    '안전한 사용을 위해 타인과 인증 코드를 공유하지 마세요.',
  ].join('\n')

  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>${brand} 인증 코드</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; background-color: #f9fafb; padding: 24px;">
    <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);">
      <h1 style="margin: 0 0 16px; font-size: 20px;">${brand} ${capitalizedIntent}</h1>
      <p style="margin: 0 0 12px; font-size: 16px;">요청하신 인증 코드를 아래에 안내드립니다.</p>
      <p style="margin: 16px 0; font-size: 32px; font-weight: 700; letter-spacing: 8px; text-align: center; color: #1f2937;">${code}</p>
      <p style="margin: 16px 0; font-size: 14px; color: #6b7280;">해당 코드는 ${minutes}분 동안 유효하며, 한 번만 사용할 수 있습니다.</p>
      <p style="margin: 16px 0 0; font-size: 14px; color: #6b7280;">안전한 사용을 위해 타인과 인증 코드를 공유하지 마세요.</p>
    </div>
    <p style="margin: 24px auto 0; max-width: 480px; font-size: 12px; color: #9ca3af; text-align: center;">이메일을 요청하지 않았다면 본 메시지를 무시해 주세요.</p>
  </body>
</html>`

  await dispatchEmail(
    env,
    {
      to: email,
      subject,
      text,
      html,
    },
    context,
  )
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

const app = new Hono<{ Bindings: Bindings }>({ strict: false })

app.use('*', async (c, next) => {
  const requestOrigin = c.req.header('Origin')
  const allowedOrigin = resolveCorsOrigin(requestOrigin)

  if (c.req.method === 'OPTIONS') {
    if (allowedOrigin) {
      applyCorsHeaders(c, allowedOrigin)
    } else {
      const existingVary = c.res.headers.get('Vary')
      if (!existingVary) {
        c.res.headers.set('Vary', 'Origin')
      } else if (!existingVary.split(',').map((value) => value.trim()).includes('Origin')) {
        c.res.headers.set('Vary', `${existingVary}, Origin`)
      }
    }

    const requestedHeaders = c.req.header('Access-Control-Request-Headers')?.trim()
    c.res.headers.set('Access-Control-Allow-Headers', requestedHeaders && requestedHeaders.length > 0 ? requestedHeaders : DEFAULT_CORS_HEADERS)
    c.res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    c.res.headers.set('Access-Control-Max-Age', '86400')

    return c.body(null, 204)
  }

  await next()

  if (allowedOrigin) {
    applyCorsHeaders(c, allowedOrigin)
  }
})

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

app.use(renderer)

app.get('/api/auth/session', async (c) => {
  const adminEmail = await requireAdminSession(c)
  return c.json({ admin: Boolean(adminEmail), email: adminEmail ?? null })
})

app.get('/api/config', (c) => {
  const googleClientId = c.env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const googleRedirectUri = resolveGoogleRedirectUri(c)
  const communityUrl = c.env.MICHINA_COMMUNITY_URL?.trim() || './dashboard/community'

  return c.json({
    googleClientId,
    googleRedirectUri,
    communityUrl,
    apiBase: API_BASE_PATH,
  })
})

app.post('/api/auth/email/request', async (c) => {
  let payload: { email?: string; intent?: string } | undefined
  try {
    payload = await c.req.json()
  } catch (error) {
    const response = c.json({ error: 'INVALID_JSON_BODY' }, 400)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const rawIntent = typeof payload?.intent === 'string' ? payload.intent.toLowerCase() : 'login'
  const intent: EmailVerificationIntent = rawIntent === 'register' ? 'register' : 'login'

  const emailRaw = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : ''
  if (!isValidEmail(emailRaw)) {
    const response = c.json({ error: 'INVALID_EMAIL' }, 400)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const user = await getUserAccount(c.env, emailRaw)
  if (intent === 'register' && user) {
    const response = c.json({ error: 'EMAIL_ALREADY_REGISTERED' }, 409)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }
  if (intent === 'login' && !user) {
    const response = c.json({ error: 'ACCOUNT_NOT_FOUND' }, 404)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const dispatchContext = getEmailDispatchContext(c.env)
  if (!dispatchContext.from) {
    const response = c.json({ error: 'EMAIL_SENDER_NOT_CONFIGURED' }, 500)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const now = Date.now()
  const existingRecord = await getEmailVerificationRecord(c.env, emailRaw)
  if (existingRecord && now - existingRecord.issuedAt < EMAIL_VERIFICATION_COOLDOWN_MS) {
    const retryAfterMs = EMAIL_VERIFICATION_COOLDOWN_MS - (now - existingRecord.issuedAt)
    const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000))
    const response = c.json({ error: 'VERIFICATION_RATE_LIMITED', retryAfter }, 429)
    response.headers.set('Retry-After', String(retryAfter))
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const code = generateNumericCode(EMAIL_VERIFICATION_CODE_LENGTH)
  const codeHash = await computeVerificationHash(emailRaw, code)
  const issuedAt = now
  const expiresAt = issuedAt + dispatchContext.expirySeconds * 1000
  const record: EmailVerificationRecord = {
    email: emailRaw,
    codeHash,
    intent,
    issuedAt,
    expiresAt,
    attempts: 0,
    createdAt: existingRecord?.createdAt ?? new Date(issuedAt).toISOString(),
    updatedAt: new Date(issuedAt).toISOString(),
  }

  await saveEmailVerificationRecord(c.env, record)

  try {
    await sendVerificationEmail(c.env, emailRaw, code, intent, dispatchContext)
  } catch (error) {
    console.error('[auth/email] Failed to deliver verification email', error)
    await deleteEmailVerificationRecord(c.env, emailRaw)
    const response = c.json({ error: 'EMAIL_DELIVERY_FAILED' }, 502)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const response = c.json({ ok: true, intent, issuedAt, expiresAt })
  response.headers.set('Cache-Control', 'no-store')
  return response
})

app.post('/api/auth/email/verify', async (c) => {
  let payload: { email?: string; code?: string; intent?: string } | undefined
  try {
    payload = await c.req.json()
  } catch (error) {
    const response = c.json({ error: 'INVALID_JSON_BODY' }, 400)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const rawIntent = typeof payload?.intent === 'string' ? payload.intent.toLowerCase() : 'login'
  const intent: EmailVerificationIntent = rawIntent === 'register' ? 'register' : 'login'

  const emailRaw = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : ''
  if (!isValidEmail(emailRaw)) {
    const response = c.json({ error: 'INVALID_EMAIL' }, 400)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const code = typeof payload?.code === 'string' ? payload.code.trim() : ''
  if (!code || !new RegExp(`^\\d{${EMAIL_VERIFICATION_CODE_LENGTH}}$`).test(code)) {
    const response = c.json({ error: 'INVALID_CODE_FORMAT' }, 400)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const record = await getEmailVerificationRecord(c.env, emailRaw)
  if (!record) {
    const response = c.json({ error: 'VERIFICATION_NOT_FOUND' }, 404)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  if (record.intent !== intent) {
    const response = c.json({ error: 'INTENT_MISMATCH' }, 400)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  if (record.expiresAt <= Date.now()) {
    await deleteEmailVerificationRecord(c.env, emailRaw)
    const response = c.json({ error: 'CODE_EXPIRED' }, 410)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  const submittedHash = await computeVerificationHash(emailRaw, code)
  if (submittedHash !== record.codeHash) {
    const attempts = Math.min(EMAIL_VERIFICATION_MAX_ATTEMPTS, (record.attempts ?? 0) + 1)
    record.attempts = attempts
    if (attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
      await deleteEmailVerificationRecord(c.env, emailRaw)
      const response = c.json({ error: 'VERIFICATION_ATTEMPTS_EXCEEDED' }, 429)
      response.headers.set('Cache-Control', 'no-store')
      return response
    }
    await saveEmailVerificationRecord(c.env, record)
    const remaining = Math.max(0, EMAIL_VERIFICATION_MAX_ATTEMPTS - attempts)
    const response = c.json({ error: 'CODE_INVALID', remainingAttempts: remaining }, 401)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  await deleteEmailVerificationRecord(c.env, emailRaw)

  const now = new Date()
  const nowIso = now.toISOString()

  if (intent === 'register') {
    const existing = await getUserAccount(c.env, emailRaw)
    if (existing) {
      const response = c.json({ error: 'EMAIL_ALREADY_REGISTERED' }, 409)
      response.headers.set('Cache-Control', 'no-store')
      return response
    }
    const newAccount: UserAccount = {
      email: emailRaw,
      name: deriveDisplayName(emailRaw),
      plan: 'free',
      createdAt: nowIso,
      updatedAt: nowIso,
      lastLoginAt: nowIso,
      subscriptionCredits: 0,
      topUpCredits: 0,
      planExpiresAt: '',
    }
    await saveUserAccount(c.env, newAccount)
  }

  let account = await getUserAccount(c.env, emailRaw)
  if (!account) {
    const response = c.json({ error: 'ACCOUNT_NOT_FOUND' }, 404)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  account.name = account.name?.trim() || deriveDisplayName(emailRaw)
  account.plan = account.plan || 'free'
  account.lastLoginAt = nowIso
  account.lastOtpAt = new Date(record.issuedAt).toISOString()
  await saveUserAccount(c.env, account)

  account = (await getUserAccount(c.env, emailRaw)) ?? account

  const responseProfile = {
    email: account.email,
    name: account.name || deriveDisplayName(account.email),
    plan: account.plan || 'free',
    subscriptionCredits: account.subscriptionCredits ?? 0,
    topUpCredits: account.topUpCredits ?? 0,
    planExpiresAt: account.planExpiresAt ?? '',
    credits: FREE_MONTHLY_CREDITS,
  }

  const response = c.json({ ok: true, intent, profile: responseProfile })
  response.headers.set('Cache-Control', 'no-store')
  return response
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
  const openAIKey = resolveOpenAIKey(env)

  if (!openAIKey) {
    return c.json(
      {
        error: 'OPENAI_API_KEY_NOT_CONFIGURED',
        detail: 'Set OPENAI_API_KEY or OPEN_AI_API_KEY in the environment.',
      },
      500,
    )
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
- 키워드는 이미지와 직접적으로 연관된 단어만 포함하고, 일반적이거나 중복된 표현은 제거합니다.
- 25개의 키워드는 서로 다른 맥락을 다루도록 조합하며, 핵심 키워드를 활용해 제목에도 반영합니다.
- 제목은 한국어로 작성하고, '미리캔버스'를 활용하는 마케터가 검색할 법한 문구를 넣습니다.
- 제목은 60자 이내에서 2~3개의 핵심 키워드를 자연스럽게 결합해 작성합니다.
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

    const requestPayload = {
      model: 'gpt-4o-mini',
      temperature: 0.7,
      max_output_tokens: 500,
      response_format: responseFormat,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }],
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: userInstruction },
            { type: 'input_image', image_url: `data:image/png;base64,${base64Source}` },
          ],
        },
      ],
    }

    const openaiRequestInit: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${openAIKey}`,
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

    const openaiResponse = await fetch('https://api.openai.com/v1/responses', openaiRequestInit)
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

    const collectOutputItems = (payload: any): any[] => {
      const items: any[] = []
      if (Array.isArray(payload?.output)) {
        items.push(...payload.output)
      }
      if (Array.isArray(payload?.response?.output)) {
        items.push(...payload.response.output)
      }
      if (Array.isArray(payload?.messages)) {
        items.push(...payload.messages)
      }
      return items
    }

    let parsed:
      | {
          title?: unknown
          summary?: unknown
          keywords?: unknown
        }
      | null = null

    const outputItems = collectOutputItems(completion)
    for (const item of outputItems) {
      if (!item) continue

      if (Array.isArray(item?.content)) {
        for (const contentItem of item.content) {
          if (contentItem?.type === 'output_json' && contentItem?.json) {
            parsed = contentItem.json
            break
          }
          if (contentItem?.type === 'output_text') {
            const candidate = tryParseJsonText(contentItem.text)
            if (candidate) {
              parsed = candidate
              break
            }
          }
        }
      }

      if (parsed) {
        break
      }

      if (item?.type === 'output_json' && item?.json) {
        parsed = item.json
        break
      }

      if (item?.type === 'output_text') {
        const candidate = tryParseJsonText(item.text)
        if (candidate) {
          parsed = candidate
          break
        }
      }
    }

    if (!parsed) {
      parsed = tryParseJsonText(completion?.output_text)
    }

    if (!parsed && typeof completion?.result === 'string') {
      parsed = tryParseJsonText(completion.result)
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
  const currentYear = new Date().getFullYear()
  const googleClientId = c.env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const googleRedirectUri = resolveGoogleRedirectUri(c)
  const communityUrl = c.env.MICHINA_COMMUNITY_URL?.trim() || './dashboard/community'
  const appConfig = JSON.stringify(
    {
      googleClientId,
      googleRedirectUri,
      communityUrl,
      basePath: PUBLIC_BASE_PATH,
      apiBase: API_BASE_PATH,
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
          <a class="app-header__logo" href={resolveAppHref()} aria-label="Elliesbang Image Editor 홈">
            <span class="app-header__brand">Elliesbang Image Editor</span>
            <span class="app-header__tag">크레딧 프리미엄 베타</span>
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
          <button class="btn btn--primary btn--sm app-header__upgrade" type="button" data-role="upgrade-button">
            업그레이드
          </button>
          <nav class="app-header__nav" aria-label="대시보드 탐색">
            <a
              class="app-header__nav-item"
              href="./dashboard/community"
              data-role="community-link"
              data-view-target="community"
            >
              미치나 챌린지 대시보드
            </a>
            <button class="app-header__nav-item" type="button" data-role="admin-nav" data-view-target="admin" hidden>
              관리자 대시보드
            </button>
          </nav>
          <button class="btn btn--ghost btn--sm" type="button" data-role="admin-login">
            관리자 전용
          </button>
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

      <section
        class="pricing"
        data-view="home"
        id="pricing"
        data-role="pricing-section"
        aria-labelledby="pricing-heading"
      >
        <header class="pricing__header">
          <p class="pricing__eyebrow">요금제 안내</p>
          <h2 class="pricing__title" id="pricing-heading">업무 흐름에 맞춰 선택하는 크레딧 플랜</h2>
          <p class="pricing__subtitle">
            FREE, 구독, 충전 크레딧을 하나의 잔액으로 통합 표기하고, 충전 크레딧부터 차감되도록 설계했습니다.
          </p>
        </header>
        <div class="pricing__policy">
          <div class="pricing-policy__item">
            <span class="pricing-policy__label">FREE 크레딧</span>
            <span class="pricing-policy__copy">매월 1일 30 크레딧 자동 지급 · 이월 불가</span>
          </div>
          <div class="pricing-policy__item">
            <span class="pricing-policy__label">구독 크레딧</span>
            <span class="pricing-policy__copy">월/연간 플랜 모두 기간 종료 시 소멸 · 잔여량은 통합 잔액으로 표시</span>
          </div>
          <div class="pricing-policy__item">
            <span class="pricing-policy__label">충전 크레딧</span>
            <span class="pricing-policy__copy">별도 구매 가능 · 유효 기간 여유 있게 유지 · 구독 크레딧보다 먼저 차감</span>
          </div>
        </div>
        <div class="pricing__cards">
          <article class="pricing-card pricing-card--free">
            <header class="pricing-card__header">
              <span class="pricing-card__plan">FREE</span>
            </header>
            <div class="pricing-card__price">
              <span class="pricing-card__value">₩0</span>
              <span class="pricing-card__per">/월</span>
            </div>
            <p class="pricing-card__credits">매월 30 크레딧 자동 지급 · 잔액 통합 표시</p>
            <ul class="pricing-card__features">
              <li>기본 편집 도구와 표준 해상도 제공</li>
              <li>로그인만으로 즉시 시작</li>
              <li>충전 크레딧 우선 차감 정책 공유</li>
            </ul>
            <button class="btn btn--ghost pricing-card__cta" type="button" data-role="pricing-free-login">
              무료로 시작
            </button>
          </article>

          <article class="pricing-card">
            <header class="pricing-card__header">
              <span class="pricing-card__plan">BASIC</span>
            </header>
            <div class="pricing-card__price">
              <span class="pricing-card__value">₩9,900</span>
              <span class="pricing-card__per">/월</span>
            </div>
            <p class="pricing-card__credits">월 150 크레딧 · 고해상도 다운로드 포함</p>
            <ul class="pricing-card__features">
              <li>FREE 기능 + 고해상도 다운로드</li>
              <li>충전 크레딧부터 차감해 과금 리스크 축소</li>
              <li>플랜 만료 시 자동으로 FREE 전환</li>
            </ul>
            <button
              class="btn btn--outline pricing-card__cta"
              type="button"
              data-role="pricing-upgrade"
              data-plan="basic"
            >
              BASIC 업그레이드
            </button>
          </article>

          <article class="pricing-card pricing-card--highlight">
            <header class="pricing-card__header">
              <span class="pricing-card__plan">PRO</span>
              <span class="pricing-card__tag">추천</span>
            </header>
            <div class="pricing-card__price">
              <span class="pricing-card__value">₩19,900</span>
              <span class="pricing-card__per">/월</span>
            </div>
            <p class="pricing-card__credits">월 1,000 크레딧 · SVG 변환 우선 지원</p>
            <ul class="pricing-card__features">
              <li>BASIC 기능 + PNG → SVG 벡터 변환 무제한</li>
              <li>팀 브랜드 에셋 작업을 위한 우선 큐</li>
              <li>충전/구독 크레딧 통합 잔액 표시</li>
            </ul>
            <button
              class="btn btn--primary pricing-card__cta"
              type="button"
              data-role="pricing-upgrade"
              data-plan="pro"
            >
              PRO 업그레이드
            </button>
          </article>

          <article class="pricing-card pricing-card--premium">
            <header class="pricing-card__header">
              <span class="pricing-card__plan">PREMIUM</span>
            </header>
            <div class="pricing-card__price">
              <span class="pricing-card__value">₩39,900</span>
              <span class="pricing-card__per">/월</span>
            </div>
            <p class="pricing-card__credits">월 10,000 크레딧 · 키워드 분석 포함</p>
            <ul class="pricing-card__features">
              <li>PRO 기능 + 키워드 분석 자동화</li>
              <li>운영 효율을 위한 우선 지원 &amp; 보고서</li>
              <li>충전 크레딧 선차감 · 잔여량 통합 표시</li>
            </ul>
            <button
              class="btn btn--primary pricing-card__cta"
              type="button"
              data-role="pricing-upgrade"
              data-plan="premium"
            >
              PREMIUM 업그레이드
            </button>
          </article>
        </div>
        <aside class="pricing__note" aria-label="미치나 플랜 안내">
          <strong>미치나 플랜</strong>
          <p>
            챌린지 신청 시 월 10,000 크레딧과 PREMIUM 기능을 제공하며, 기간이 끝나면 자동으로 FREE 플랜으로 전환됩니다.
          </p>
        </aside>
      </section>


      <div class="login-modal" data-role="login-modal" aria-hidden="true">
        <div class="login-modal__backdrop" data-action="close-login" aria-hidden="true"></div>
        <div class="login-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="login-modal-title">
          <header class="login-modal__header">
            <h2 class="login-modal__title" id="login-modal-title">Elliesbang Image Editor 로그인</h2>
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

      <div class="plan-modal" data-role="plan-modal-basic" aria-hidden="true">
        <div class="plan-modal__backdrop" data-action="close-plan-modal" aria-hidden="true"></div>
        <div class="plan-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="plan-modal-basic-title">
          <header class="plan-modal__header">
            <span class="plan-modal__badge">BASIC 이상 필요</span>
            <h2 class="plan-modal__title" id="plan-modal-basic-title">고해상도 다운로드를 위해 업그레이드하세요</h2>
            <button class="plan-modal__close" type="button" data-action="close-plan-modal" aria-label="BASIC 안내 닫기">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </header>
          <p class="plan-modal__hint" data-role="plan-modal-hint">
            고해상도 다운로드는 BASIC 이상 플랜에서 제공됩니다.
          </p>
          <ul class="plan-modal__list">
            <li>월 150 크레딧 제공 · 잔여량은 통합 잔액으로 관리됩니다.</li>
            <li>충전 크레딧부터 차감되어 예산을 안전하게 운영할 수 있습니다.</li>
            <li>플랜 만료 시 자동으로 FREE 플랜으로 전환됩니다.</li>
          </ul>
          <div class="plan-modal__actions">
            <button class="btn btn--primary plan-modal__cta" type="button" data-action="plan-modal-view-pricing">
              BASIC 요금제 살펴보기
            </button>
            <button class="btn btn--ghost plan-modal__cta" type="button" data-action="close-plan-modal">나중에 결정</button>
          </div>
        </div>
      </div>

      <div class="plan-modal" data-role="plan-modal-pro" aria-hidden="true">
        <div class="plan-modal__backdrop" data-action="close-plan-modal" aria-hidden="true"></div>
        <div class="plan-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="plan-modal-pro-title">
          <header class="plan-modal__header">
            <span class="plan-modal__badge">PRO 이상 필요</span>
            <h2 class="plan-modal__title" id="plan-modal-pro-title">SVG 변환 기능을 바로 활용하세요</h2>
            <button class="plan-modal__close" type="button" data-action="close-plan-modal" aria-label="PRO 안내 닫기">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </header>
          <p class="plan-modal__hint" data-role="plan-modal-hint">
            PNG → SVG 벡터 변환은 PRO 이상 플랜에서 사용할 수 있습니다.
          </p>
          <ul class="plan-modal__list">
            <li>월 1,000 크레딧으로 대량의 디자인 변환을 지원합니다.</li>
            <li>충전 크레딧이 먼저 사용되어 구독 크레딧을 안전하게 보존합니다.</li>
            <li>SVG 변환, 고해상도 다운로드, ZIP 묶음 저장 모두 활성화됩니다.</li>
          </ul>
          <div class="plan-modal__actions">
            <button class="btn btn--primary plan-modal__cta" type="button" data-action="plan-modal-view-pricing">
              PRO 요금제 확인하기
            </button>
            <button class="btn btn--ghost plan-modal__cta" type="button" data-action="close-plan-modal">나중에 결정</button>
          </div>
        </div>
      </div>

      <div class="plan-modal" data-role="plan-modal-premium" aria-hidden="true">
        <div class="plan-modal__backdrop" data-action="close-plan-modal" aria-hidden="true"></div>
        <div class="plan-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="plan-modal-premium-title">
          <header class="plan-modal__header">
            <span class="plan-modal__badge">PREMIUM 이상 필요</span>
            <h2 class="plan-modal__title" id="plan-modal-premium-title">키워드 분석까지 한 번에 마무리하세요</h2>
            <button class="plan-modal__close" type="button" data-action="close-plan-modal" aria-label="PREMIUM 안내 닫기">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </header>
          <p class="plan-modal__hint" data-role="plan-modal-hint">
            키워드 분석 기능은 PREMIUM 이상 플랜에서 제공됩니다.
          </p>
          <ul class="plan-modal__list">
            <li>월 10,000 크레딧과 전 기능 무제한 사용</li>
            <li>운영 효율을 위한 우선 지원과 작업 보고서 제공</li>
            <li>충전/구독 크레딧을 합산한 통합 잔액으로 표시됩니다.</li>
          </ul>
          <div class="plan-modal__actions">
            <button class="btn btn--primary plan-modal__cta" type="button" data-action="plan-modal-view-pricing">
              PREMIUM 요금제 알아보기
            </button>
            <button class="btn btn--ghost plan-modal__cta" type="button" data-action="close-plan-modal">나중에 결정</button>
          </div>
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
                <button class="btn btn--ghost btn--sm" type="button" data-action="analyze-current">
                  분석 실행
                </button>
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

      <section class="admin-view" data-view="admin" aria-label="관리자 대시보드" hidden>
        <article class="admin-dashboard" data-role="admin-dashboard" data-state="locked">
          <header class="admin-dashboard__header">
            <div class="admin-dashboard__meta">
              <span class="admin-dashboard__badge" data-role="admin-category">운영진 전용</span>
              <h2 class="admin-dashboard__title">Elliesbang 운영 대시보드</h2>
              <p class="admin-dashboard__description">
                미치나 플랜 참가자 명단을 관리하고 진행 현황을 점검할 수 있는 관리자 전용 공간입니다.
              </p>
            </div>
            <div class="admin-dashboard__actions">
              <button class="btn btn--ghost btn--sm" type="button" data-role="admin-refresh">현황 새로고침</button>
              <button class="btn btn--ghost btn--sm" type="button" data-role="admin-run-completion">완주 체크 실행</button>
              <button class="btn btn--ghost btn--sm" type="button" data-role="admin-download-completion">완주자 CSV</button>
              <button class="btn btn--outline btn--sm" type="button" data-role="admin-logout">관리자 로그아웃</button>
            </div>
          </header>
          <div class="admin-dashboard__guard" data-role="admin-guard">
            <p>관리자 전용 페이지입니다. 보안 강화를 위해 로그인 후 이용해 주세요.</p>
            <button class="btn btn--primary" type="button" data-action="open-admin-modal">관리자 로그인 열기</button>
          </div>
          <div class="admin-dashboard__content" data-role="admin-content">
            <section class="admin-dashboard__section">
              <h3 class="admin-dashboard__section-title">미치나 챌린지 참가자 등록</h3>
              <form class="admin-import" data-role="admin-import-form" data-state="idle">
                <div class="admin-import__grid">
                  <label class="admin-import__label">
                    CSV 업로드
                    <input class="admin-import__input" type="file" accept=".csv" data-role="admin-import-file" />
                  </label>
                  <label class="admin-import__label">
                    이메일/이름 수동 입력 (줄바꿈으로 구분)
                    <textarea
                      class="admin-import__textarea"
                      rows={4}
                      placeholder="name@example.com,홍길동"
                      data-role="admin-import-manual"
                    ></textarea>
                  </label>
                  <label class="admin-import__label">
                    챌린지 종료일
                    <input class="admin-import__input" type="date" data-role="admin-import-enddate" />
                  </label>
                </div>
                <div class="admin-import__actions">
                  <button class="btn btn--primary" type="submit">명단 등록</button>
                </div>
              </form>
            </section>
            <section class="admin-dashboard__section">
              <h3 class="admin-dashboard__section-title">참가자 진행 현황</h3>
              <div class="challenge-table-wrapper">
                <table class="challenge-table">
                  <thead>
                    <tr>
                      <th scope="col">참가자</th>
                      <th scope="col">진행률</th>
                      <th scope="col">미제출</th>
                      <th scope="col">참여 기간</th>
                      <th scope="col">상태</th>
                    </tr>
                  </thead>
                  <tbody data-role="admin-participants-body">
                    <tr>
                      <td colSpan={5}>관리자 로그인 후 참가자 정보를 확인할 수 있습니다.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </article>
      </section>

      <section class="challenge-view" data-view="community" data-role="challenge-section" aria-label="미치나 챌린지 대시보드" hidden>
        <article class="challenge-card challenge-card--locked" data-role="challenge-locked">
          <header class="challenge-card__header">
            <h2>미치나 챌린지 대시보드</h2>
            <p>관리자가 등록한 미치나 챌린저 또는 운영진만 접근할 수 있습니다.</p>
          </header>
          <p class="challenge-card__description">등록되지 않은 계정으로 접근하면 안내 모달이 표시됩니다.</p>
          <div class="challenge-card__actions">
            <button class="btn btn--primary" type="button" data-action="open-login-modal">로그인</button>
          </div>
        </article>
        <article class="challenge-card challenge-card--participant" data-role="challenge-dashboard" hidden>
          <header class="challenge-card__header">
            <div>
              <h2>미치나 챌린지 대시보드</h2>
              <p data-role="challenge-summary">참가자 등록 후 일일 제출 현황이 표시됩니다.</p>
            </div>
          </header>
          <section class="challenge-card__section">
            <h3 class="challenge-card__section-title">진행 현황</h3>
            <div class="challenge-progress" data-role="challenge-progress"></div>
          </section>
          <section class="challenge-card__section">
            <h3 class="challenge-card__section-title">일일 제출 현황</h3>
            <ul class="challenge-days" data-role="challenge-days"></ul>
          </section>
          <section class="challenge-card__section">
            <h3 class="challenge-card__section-title">제출하기</h3>
            <form class="challenge-submit" data-role="challenge-submit-form" data-state="locked">
              <div class="challenge-submit__grid">
                <label class="challenge-submit__label" for="challengeDay">진행 일차</label>
                <select id="challengeDay" data-role="challenge-day">
                  <option value="">일차 선택</option>
                  {[...Array(15)].map((_, index) => {
                    const day = index + 1
                    return (
                      <option value={day} key={day}>
                        {`Day ${day}`}
                      </option>
                    )
                  })}
                </select>
                <label class="challenge-submit__label" for="challengeUrl">결과 URL</label>
                <input
                  id="challengeUrl"
                  class="challenge-submit__input"
                  type="url"
                  placeholder="https://example.com/work"
                  data-role="challenge-url"
                />
                <label class="challenge-submit__label" for="challengeFile">이미지 업로드</label>
                <input
                  id="challengeFile"
                  class="challenge-submit__input"
                  type="file"
                  accept="image/*"
                  data-role="challenge-file"
                />
              </div>
              <p class="challenge-submit__hint" data-role="challenge-submit-hint">참가자로 등록되면 제출 기능이 활성화됩니다.</p>
              <div class="challenge-submit__actions">
                <button class="btn btn--primary" type="submit">제출 저장</button>
              </div>
            </form>
          </section>
          <section class="challenge-card__section challenge-card__section--certificate" data-role="challenge-certificate" hidden>
            <h3 class="challenge-card__section-title">수료증</h3>
            <div class="certificate-preview" data-role="certificate-preview"></div>
            <button class="btn btn--outline" type="button" data-role="certificate-download">수료증 다운로드</button>
          </section>
        </article>
      </section>

      <div class="plan-modal plan-modal--access" data-role="access-modal" aria-hidden="true">
        <div class="plan-modal__backdrop" data-action="close-access-modal" aria-hidden="true"></div>
        <div class="plan-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="access-modal-title">
          <header class="plan-modal__header">
            <span class="plan-modal__badge">접근 제한</span>
            <h2 class="plan-modal__title" id="access-modal-title" data-role="access-modal-title">접근 권한이 없습니다.</h2>
            <button class="plan-modal__close" type="button" data-action="close-access-modal" aria-label="접근 제한 안내 닫기">
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </header>
          <p class="plan-modal__hint" data-role="access-modal-message"></p>
          <div class="plan-modal__actions">
            <button class="btn btn--primary plan-modal__cta" type="button" data-action="close-access-modal">확인</button>
          </div>
        </div>
      </div>

      <footer class="site-footer" aria-label="사이트 하단">
        <div class="site-footer__inner">
          <div class="site-footer__brand">
            <span class="site-footer__title">Elliesbang Image Editor</span>
            <span class="site-footer__contact">
              문의: <a href="mailto:ellie@elliesbang.kr">ellie@elliesbang.kr</a>
            </span>
          </div>
          <nav class="site-footer__links" aria-label="법적 고지">
            <a href="./#pricing">요금제 안내</a>
            <a href={resolveAppHref('privacy')}>개인정보 처리방침</a>
            <a href={resolveAppHref('terms')}>이용약관</a>
            <a href={resolveAppHref('cookies')}>쿠키 정책</a>
            <a href="./admin/dashboard" data-role="footer-admin-link">관리자 전용</a>
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
            <a class="cookie-banner__link" href={resolveAppHref('cookies')} target="_blank" rel="noopener">
              쿠키 정책 자세히 보기
            </a>
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
          Elliesbang Image Editor 개인정보 처리방침
        </h1>
        <p class="legal-page__meta">시행일: 2025년 10월 2일</p>
        <p class="legal-page__lead">
          Elliesbang Image Editor(이하 “서비스”)는 이용자의 개인정보를 소중하게 생각하며, 관련 법령을 준수합니다.
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
        <a class="legal-page__back" href={resolveAppHref()}>← 에디터로 돌아가기</a>
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
          Elliesbang Image Editor 이용약관
        </h1>
        <p class="legal-page__meta">시행일: 2025년 10월 2일</p>
        <p class="legal-page__lead">
          본 약관은 Elliesbang Image Editor가 제공하는 모든 서비스의 이용 조건과 절차, 이용자와 서비스의 권리·의무 및 책임사항을 규정합니다.
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
        <a class="legal-page__back" href={resolveAppHref()}>← 에디터로 돌아가기</a>
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
          Elliesbang Image Editor 쿠키 정책
        </h1>
        <p class="legal-page__meta">시행일: 2025년 10월 2일</p>
        <p class="legal-page__lead">
          본 쿠키 정책은 Elliesbang Image Editor(이하 “서비스”)가 이용자의 디바이스에 저장하는 쿠키의 종류와 사용 목적,
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
        <a class="legal-page__back" href={resolveAppHref()}>← 에디터로 돌아가기</a>
      </footer>
    </main>
  )
})

app.get('/api/health', (c) => c.json({ status: 'ok' }))

export default app
