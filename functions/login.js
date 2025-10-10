const encoder = new TextEncoder()

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {})
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { ...init, headers })
}

function base64UrlEncode(bytes) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function createHmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
}

async function createJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)))
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const key = await createHmacKey(secret)
  const data = encoder.encode(`${encodedHeader}.${encodedPayload}`)
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, data)
  const signature = base64UrlEncode(new Uint8Array(signatureBuffer))
  return `${encodedHeader}.${encodedPayload}.${signature}`
}

function normalizeSecret(value, label) {
  if (typeof value !== 'string') {
    console.warn(`[login] ${label} is not a string. Received:`, value)
    return ''
  }

  const trimmed = value.trim()
  const unquoted = trimmed.replace(/^['"]|['"]$/g, '')
  let decoded = unquoted

  try {
    const uriDecoded = decodeURIComponent(unquoted)
    if (uriDecoded !== unquoted) {
      console.log(`[login] ${label} contained URL-encoded characters. Decoded value applied.`)
      decoded = uriDecoded
    }
  } catch (error) {
    console.warn(`[login] Failed to decode ${label} as URI component. Using unquoted value.`, error)
  }

  if (trimmed !== value) {
    console.log(`[login] ${label} had surrounding whitespace removed.`)
  }

  if (unquoted !== trimmed) {
    console.log(`[login] ${label} had wrapping quotes removed.`)
  }

  return decoded
}

export async function onRequestPost(context) {
  const { request, env } = context
  const { ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET } = env

  // Root-cause guard: dashboard inputs may introduce whitespace/quotes/encoding issues.
  const normalizedAdminEmail = normalizeSecret(ADMIN_EMAIL, 'ADMIN_EMAIL')
  const normalizedAdminPassword = normalizeSecret(ADMIN_PASSWORD, 'ADMIN_PASSWORD')
  const normalizedSessionSecret = normalizeSecret(SESSION_SECRET, 'SESSION_SECRET')

  if (!normalizedAdminEmail || !normalizedAdminPassword || !normalizedSessionSecret) {
    return jsonResponse(
      { error: 'CONFIGURATION_MISSING', message: '관리자 인증 구성이 완료되지 않았습니다.' },
      { status: 500 },
    )
  }

  let body
  try {
    body = await request.json()
  } catch (error) {
    return jsonResponse({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password.trim() : ''

  if (!email || !password) {
    return jsonResponse({ error: 'INVALID_CREDENTIALS' }, { status: 401 })
  }

  if (email !== normalizedAdminEmail || password !== normalizedAdminPassword) {
    console.warn('[login] Invalid credentials attempt detected.', {
      emailMatch: email === normalizedAdminEmail,
      passwordMatch: password === normalizedAdminPassword,
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    return jsonResponse(
      { error: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' },
      { status: 401 },
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const expiresIn = 60 * 60
  const payload = {
    sub: 'admin',
    role: 'admin',
    email,
    iat: now,
    exp: now + expiresIn,
    iss: 'admin-login',
    aud: 'admin-dashboard',
  }

  const token = await createJwt(payload, normalizedSessionSecret)

  return jsonResponse({ token, expiresIn })
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '86400',
    },
  })
}
