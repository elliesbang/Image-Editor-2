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
  CHALLENGE_KV?: KVNamespace
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

type AdminSessionPayload = {
  sub: string
  role: 'admin'
  exp: number
}

const ADMIN_SESSION_COOKIE = 'admin_session'
const PARTICIPANT_KEY_PREFIX = 'participant:'
const REQUIRED_SUBMISSIONS = 15
const CHALLENGE_DURATION_BUSINESS_DAYS = 15
const DEFAULT_GOOGLE_REDIRECT_URI = 'https://project-9cf3a0d0.pages.dev/auth/google/callback'

const inMemoryStore = new Map<string, string>()

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
  if (env.CHALLENGE_KV) {
    return env.CHALLENGE_KV.get(key)
  }
  return inMemoryStore.get(key) ?? null
}

async function kvPut(env: Bindings, key: string, value: string) {
  if (env.CHALLENGE_KV) {
    await env.CHALLENGE_KV.put(key, value)
    return
  }
  inMemoryStore.set(key, value)
}

async function kvDelete(env: Bindings, key: string) {
  if (env.CHALLENGE_KV) {
    await env.CHALLENGE_KV.delete(key)
    return
  }
  inMemoryStore.delete(key)
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
  return Array.from(inMemoryStore.keys()).filter((key) => key.startsWith(PARTICIPANT_KEY_PREFIX))
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
  const env = c.env
  const secret = env.SESSION_SECRET
  if (!secret) {
    return null
  }
  const token = getCookie(c, ADMIN_SESSION_COOKIE)
  if (!token) {
    return null
  }
  try {
    const payload = (await verify(token, secret)) as AdminSessionPayload
    if (payload.role !== 'admin' || !payload.sub) {
      return null
    }
    return payload.sub
  } catch (error) {
    console.error('[auth] Failed to verify admin session', error)
    return null
  }
}

async function createAdminSession(c: Context<{ Bindings: Bindings }>, email: string) {
  const env = c.env
  const secret = env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET_NOT_CONFIGURED')
  }
  const normalizedEmail = email.trim().toLowerCase()
  const expiresInSeconds = 60 * 60 * 8
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  const token = await sign({ sub: normalizedEmail, role: 'admin', exp }, secret)
  setCookie(c, ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge: expiresInSeconds,
  })
  return exp
}

function clearAdminSession(c: Context<{ Bindings: Bindings }>) {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: '/' })
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
    return c.json({ error: 'INVALID_JSON_BODY' }, 400)
  }

  const env = c.env
  const configuredEmail = env.ADMIN_EMAIL?.trim().toLowerCase()
  const configuredHash = env.ADMIN_PASSWORD_HASH?.trim().toLowerCase()
  const secret = env.SESSION_SECRET

  if (!configuredEmail || !configuredHash || !secret) {
    return c.json({ error: 'ADMIN_AUTH_NOT_CONFIGURED' }, 500)
  }

  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const password = typeof payload?.password === 'string' ? payload.password : ''

  if (!isValidEmail(email) || !password) {
    return c.json({ error: 'INVALID_CREDENTIALS' }, 401)
  }

  if (email !== configuredEmail) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    return c.json({ error: 'INVALID_CREDENTIALS' }, 401)
  }

  const computedHash = await sha256(password)
  if (computedHash.toLowerCase() !== configuredHash) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    return c.json({ error: 'INVALID_CREDENTIALS' }, 401)
  }

  const exp = await createAdminSession(c, email)
  return c.json({ ok: true, expiresAt: exp })
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

app.post('/api/analyze', async (c) => {
  const env = c.env

  if (!env.OPENAI_API_KEY) {
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
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userInstruction },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Source}` } },
            ],
          },
        ],
      }),
    })

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text()
      return c.json({ error: 'OPENAI_REQUEST_FAILED', detail: errorText.slice(0, 4000) }, 502)
    }

    const completion = await openaiResponse.json()
    const messageContent = completion?.choices?.[0]?.message?.content

    if (!messageContent) {
      return c.json({ error: 'OPENAI_EMPTY_RESPONSE' }, 502)
    }

    const contentString = Array.isArray(messageContent)
      ? messageContent
          .map((part: any) => {
            if (typeof part === 'string') return part
            if (typeof part?.text === 'string') return part.text
            return ''
          })
          .join('')
          .trim()
      : typeof messageContent === 'string'
        ? messageContent.trim()
        : ''

    if (!contentString) {
      return c.json({ error: 'OPENAI_INVALID_CONTENT' }, 502)
    }

    let parsed: { title?: string; summary?: string; keywords?: string[] }
    try {
      parsed = JSON.parse(contentString)
    } catch (error) {
      return c.json({ error: 'OPENAI_PARSE_ERROR', detail: contentString.slice(0, 4000) }, 502)
    }

    if (!parsed || typeof parsed.title !== 'string' || typeof parsed.summary !== 'string' || !Array.isArray(parsed.keywords)) {
      return c.json({ error: 'OPENAI_INVALID_STRUCTURE', detail: contentString.slice(0, 4000) }, 502)
    }

    const keywords = parsed.keywords.filter((keyword) => typeof keyword === 'string').slice(0, 25)

    if (keywords.length !== 25) {
      return c.json({ error: 'OPENAI_KEYWORD_COUNT_MISMATCH', detail: contentString.slice(0, 4000) }, 502)
    }

    return c.json({
      title: parsed.title.trim(),
      summary: parsed.summary.trim(),
      keywords,
    })
  } catch (error) {
    console.error('[api/analyze] error', error)
    return c.json({ error: 'OPENAI_UNHANDLED_ERROR' }, 502)
  }
})

app.get('/', (c) => {
  const currentYear = new Date().getFullYear()
  const googleClientId = c.env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const googleRedirectUri = resolveGoogleRedirectUri(c)

  return c.render(
    <main class="page">
      <header class="app-header" data-role="app-header" aria-label="서비스 헤더">
        <div class="app-header__left">
          <a class="app-header__logo" href="/" aria-label="Easy Image Editor 홈">
            <span class="app-header__brand">Easy Image Editor</span>
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
          <button class="btn btn--outline btn--sm" type="button" data-role="admin-login">
            관리자
          </button>
          <button class="btn btn--ghost btn--sm" type="button" data-role="header-auth">
            로그인
          </button>
        </div>
      </header>

      <section class="hero" aria-labelledby="hero-heading">
        <p class="hero__badge">크레딧 기반 Freemium 베타</p>
        <h1 class="hero__heading" id="hero-heading">
          멀티 이미지 편집 스튜디오
        </h1>
        <p class="hero__subtitle">
          최대 50장의 이미지를 한 번에 업로드하고 배경 제거, 여백 크롭, 노이즈 제거, 리사이즈,
          PNG → SVG 벡터 변환까지 한 곳에서 처리하세요. 로그인하면 무료 30 크레딧으로 모든 기능을 바로 사용할 수 있어요.
        </p>
      </section>

      <section class="features" aria-label="주요 기능 안내">
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

      <section class="stage" aria-label="작업 단계 안내">
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

      <section class="plans" aria-labelledby="plans-heading">
        <div class="plans__head">
          <p class="plans__eyebrow">플랜 안내</p>
          <h2 class="plans__heading" id="plans-heading">크레딧 정책과 플랜 비교</h2>
          <p class="plans__description">
            Freemium 사용자는 로그인 시 30 크레딧을 받고 기능당 소량의 크레딧이 차감됩니다. Michina 플랜은 챌린지 참가자 전용으로 모든 편집 기능과 수료증 발급을 무제한으로 제공합니다.
          </p>
        </div>
        <div class="plans__cards" data-role="plan-cards">
          <article class="plan-card" data-plan-card="freemium">
            <header class="plan-card__header">
              <span class="plan-card__eyebrow">입문용</span>
              <h3 class="plan-card__title">Freemium</h3>
              <span class="plan-card__pill" data-plan-pill="freemium" hidden>현재 이용 중</span>
            </header>
            <p class="plan-card__summary"><strong>30</strong> 무료 크레딧 포함</p>
            <ul class="plan-card__list">
              <li><i class="ri-checkbox-circle-line" aria-hidden="true"></i> 배경 제거 · 피사체 크롭 · 리사이즈</li>
              <li><i class="ri-checkbox-circle-line" aria-hidden="true"></i> PNG → SVG 변환 (2 크레딧)</li>
              <li><i class="ri-checkbox-circle-line" aria-hidden="true"></i> 키워드 분석 (1 크레딧)</li>
              <li class="plan-card__item--locked"><i class="ri-lock-line" aria-hidden="true"></i> 미치나 챌린지 대시보드</li>
              <li class="plan-card__item--locked"><i class="ri-lock-line" aria-hidden="true"></i> 수료증 다운로드</li>
            </ul>
          </article>
          <article class="plan-card plan-card--highlight" data-plan-card="michina">
            <header class="plan-card__header">
              <span class="plan-card__eyebrow">챌린지 전용</span>
              <h3 class="plan-card__title">Michina</h3>
              <span class="plan-card__pill" data-plan-pill="michina" hidden>현재 이용 중</span>
            </header>
            <p class="plan-card__summary"><strong>무제한</strong> 크레딧 · 전 기능 개방</p>
            <ul class="plan-card__list">
              <li><i class="ri-infinity-line" aria-hidden="true"></i> 이미지 보정 · 변환 무제한</li>
              <li><i class="ri-infinity-line" aria-hidden="true"></i> PNG → SVG &amp; ZIP 다운로드 무제한</li>
              <li><i class="ri-checkbox-circle-line" aria-hidden="true"></i> 미치나 챌린지 진행 현황 &amp; 완주 판정</li>
              <li><i class="ri-award-line" aria-hidden="true"></i> 3주 챌린지 수료증 PNG 발급</li>
              <li><i class="ri-user-smile-line" aria-hidden="true"></i> 운영팀 검수 및 지원</li>
            </ul>
          </article>
        </div>
        <div class="plan-status" data-role="plan-status" hidden>
          <header class="plan-status__header">
            <span class="plan-status__badge" data-role="plan-status-badge">진행 중</span>
            <span class="plan-status__plan" data-role="plan-status-plan">미치나 챌린지</span>
          </header>
          <p class="plan-status__copy" data-role="plan-status-copy">
            챌린지 참가자 정보를 불러오는 중입니다. 관리자에게 문의해 주세요.
          </p>
          <dl class="plan-status__metrics">
            <div>
              <dt>남은 제출</dt>
              <dd data-role="plan-status-remaining">-</dd>
            </div>
            <div>
              <dt>종료일</dt>
              <dd data-role="plan-status-deadline">-</dd>
            </div>
            <div>
              <dt>진행률</dt>
              <dd data-role="plan-status-progress">-</dd>
            </div>
          </dl>
        </div>
        <div class="plan-credit" data-role="plan-credit-notice">
          <strong>Freemium 이용자:</strong> Google 로그인으로 즉시 30 크레딧을 받고, 기능 실행 시 1~2 크레딧이 차감됩니다.
        </div>
        <div class="plan-table-wrapper">
          <table class="plan-table" aria-describedby="plans-heading">
            <thead>
              <tr>
                <th scope="col">기능</th>
                <th scope="col" data-plan-column="freemium">Freemium</th>
                <th scope="col" data-plan-column="michina">Michina</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">이미지 보정 도구</th>
                <td data-plan-feature="freemium" data-plan-availability="limited">
                  <i class="plan-feature__icon ri-flashlight-line" aria-hidden="true"></i>
                  <span>사용 가능 · 이미지당 1 크레딧</span>
                </td>
                <td data-plan-feature="michina" data-plan-availability="unlimited">
                  <i class="plan-feature__icon ri-infinity-line" aria-hidden="true"></i>
                  <span>무제한</span>
                </td>
              </tr>
              <tr>
                <th scope="row">PNG → SVG 변환</th>
                <td data-plan-feature="freemium" data-plan-availability="limited">
                  <i class="plan-feature__icon ri-shape-line" aria-hidden="true"></i>
                  <span>2 크레딧/이미지</span>
                </td>
                <td data-plan-feature="michina" data-plan-availability="unlimited">
                  <i class="plan-feature__icon ri-shape-line" aria-hidden="true"></i>
                  <span>무제한</span>
                </td>
              </tr>
              <tr>
                <th scope="row">ZIP 일괄 다운로드</th>
                <td data-plan-feature="freemium" data-plan-availability="limited">
                  <i class="plan-feature__icon ri-download-cloud-2-line" aria-hidden="true"></i>
                  <span>가능 · 2 크레딧/다운로드</span>
                </td>
                <td data-plan-feature="michina" data-plan-availability="unlimited">
                  <i class="plan-feature__icon ri-download-cloud-2-line" aria-hidden="true"></i>
                  <span>무제한</span>
                </td>
              </tr>
              <tr>
                <th scope="row">키워드 분석 리포트</th>
                <td data-plan-feature="freemium" data-plan-availability="limited">
                  <i class="plan-feature__icon ri-lightbulb-flash-line" aria-hidden="true"></i>
                  <span>1 크레딧/분석</span>
                </td>
                <td data-plan-feature="michina" data-plan-availability="available">
                  <i class="plan-feature__icon ri-checkbox-circle-line" aria-hidden="true"></i>
                  <span>포함</span>
                </td>
              </tr>
              <tr>
                <th scope="row">미치나 챌린지 대시보드</th>
                <td data-plan-feature="freemium" data-plan-availability="locked">
                  <i class="plan-feature__icon ri-lock-line" aria-hidden="true"></i>
                  <span>잠금</span>
                </td>
                <td data-plan-feature="michina" data-plan-availability="available">
                  <i class="plan-feature__icon ri-checkbox-circle-line" aria-hidden="true"></i>
                  <span>포함</span>
                </td>
              </tr>
              <tr>
                <th scope="row">3주 챌린지 수료증</th>
                <td data-plan-feature="freemium" data-plan-availability="locked">
                  <i class="plan-feature__icon ri-lock-line" aria-hidden="true"></i>
                  <span>잠금</span>
                </td>
                <td data-plan-feature="michina" data-plan-availability="available">
                  <i class="plan-feature__icon ri-award-line" aria-hidden="true"></i>
                  <span>포함</span>
                </td>
              </tr>
            </tbody>
          </table>
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

      <section class="workspace" aria-label="이미지 작업 영역">
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

      <section class="challenge" aria-label="미치나 플랜 챌린지" data-role="challenge-section">
        <header class="challenge__header">
          <div>
            <span class="challenge__eyebrow">Michina Plan</span>
            <h2 class="challenge__title">미치나 플랜 챌린지 트래킹</h2>
          </div>
          <p class="challenge__description">
            총 3주 · 15회 제출 챌린지를 한눈에 관리하세요. 관리자는 참가자 명단을 업로드하고, 챌린저는 일일 과제를 제출하며 진행률을 확인할 수 있습니다.
          </p>
        </header>
        <div class="challenge__panels">
          <article class="challenge-card challenge-card--admin" data-role="admin-dashboard" hidden>
            <header class="challenge-card__header">
              <h3>관리자 대시보드</h3>
              <p>명단 업로드부터 완주자 추출까지 통합으로 관리하세요.</p>
              <span class="challenge-card__category" data-role="admin-category" hidden aria-live="polite">카테고리: 미치나</span>
            </header>
            <section class="challenge-card__section">
              <h4 class="challenge-card__section-title">참가자 명단 등록</h4>
              <form class="admin-import" data-role="admin-import-form">
                <div class="admin-import__grid">
                  <label class="admin-import__label" for="adminImportFile">CSV 업로드</label>
                  <input id="adminImportFile" type="file" accept=".csv,.txt" data-role="admin-import-file" />
                  <label class="admin-import__label" for="adminImportManual">수동 입력</label>
                  <textarea
                    id="adminImportManual"
                    class="admin-import__textarea"
                    placeholder="이메일,이름 형식으로 한 줄씩 입력하세요."
                    data-role="admin-import-manual"
                  ></textarea>
                  <label class="admin-import__label" for="adminImportEnd">챌린지 종료일(선택)</label>
                  <input id="adminImportEnd" type="date" data-role="admin-import-enddate" />
                </div>
                <p class="admin-import__hint">등록 즉시 미치나 플랜 권한이 부여되고 15영업일 만료일이 자동 설정됩니다.</p>
                <button class="btn btn--primary admin-import__submit" type="submit">명단 등록</button>
              </form>
            </section>
            <section class="challenge-card__section">
              <div class="admin-actions">
                <button class="btn btn--ghost btn--sm" type="button" data-role="admin-refresh">현황 새로고침</button>
                <button class="btn btn--outline btn--sm" type="button" data-role="admin-run-completion">완주 판별 실행</button>
                <button class="btn btn--ghost btn--sm" type="button" data-role="admin-download-completion">완주자 CSV 다운로드</button>
                <button class="btn btn--ghost btn--sm" type="button" data-role="admin-logout">관리자 세션 종료</button>
              </div>
              <div class="challenge-table-wrapper">
                <table class="challenge-table" data-role="admin-participants-table">
                  <thead>
                    <tr>
                      <th scope="col">참가자</th>
                      <th scope="col">진행률</th>
                      <th scope="col">미제출</th>
                      <th scope="col">기간</th>
                      <th scope="col">상태</th>
                    </tr>
                  </thead>
                  <tbody data-role="admin-participants-body"></tbody>
                </table>
              </div>
            </section>
          </article>

          <article class="challenge-card challenge-card--participant" data-role="challenge-dashboard" hidden>
            <header class="challenge-card__header">
              <h3>나의 챌린지 현황</h3>
              <p data-role="challenge-summary">미치나 플랜에 참여하면 일일 제출 현황을 여기에서 확인할 수 있습니다.</p>
            </header>
            <section class="challenge-card__section">
              <div class="challenge-progress" data-role="challenge-progress"></div>
              <form class="challenge-submit" data-role="challenge-submit-form">
                <div class="challenge-submit__grid">
                  <label class="challenge-submit__label" for="challengeDay">Day 선택</label>
                  <select id="challengeDay" data-role="challenge-day">
                    {Array.from({ length: 15 }).map((_, index) => (
                      <option value={index + 1}>Day {index + 1}</option>
                    ))}
                  </select>
                  <label class="challenge-submit__label" for="challengeUrl">제출 URL</label>
                  <input id="challengeUrl" type="url" placeholder="https://" data-role="challenge-url" />
                  <label class="challenge-submit__label" for="challengeFile">이미지 업로드</label>
                  <input id="challengeFile" type="file" accept="image/*" data-role="challenge-file" />
                </div>
                <p class="challenge-submit__hint" data-role="challenge-submit-hint">URL 또는 이미지를 첨부해 제출하세요. 파일을 선택하면 URL보다 우선합니다.</p>
                <button class="btn btn--primary challenge-submit__button" type="submit">제출 저장</button>
              </form>
            </section>
            <section class="challenge-card__section">
              <h4 class="challenge-card__section-title">일별 제출 현황</h4>
              <ul class="challenge-days" data-role="challenge-days"></ul>
            </section>
            <section class="challenge-card__section challenge-card__section--certificate" data-role="challenge-certificate" hidden>
              <div class="certificate__header">
                <h4>수료증이 도착했습니다!</h4>
                <p>완주를 축하드립니다. 아래 수료증을 확인하고 PNG로 다운로드하세요.</p>
              </div>
              <div class="certificate__preview" data-role="certificate-preview"></div>
              <button class="btn btn--outline certificate__download" type="button" data-role="certificate-download">수료증 다운로드 (PNG)</button>
            </section>
          </article>

          <article class="challenge-card challenge-card--locked" data-role="challenge-locked">
            <header class="challenge-card__header">
              <h3>미치나 플랜 참가 안내</h3>
            </header>
            <p>관리자에게 참가자 명단 등록을 요청하면 챌린지 기능이 열립니다. 등록 후에는 일일 제출과 진행률을 실시간으로 확인할 수 있어요.</p>
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
      <script type="application/json" data-role="app-config">
        {JSON.stringify({
          googleClientId,
          googleRedirectUri,
        })}
      </script>
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

app.get('/api/health', (c) => c.json({ status: 'ok' }))

export default app
