const encoder = new TextEncoder()
const decoder = new TextDecoder()

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {})
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { ...init, headers })
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4)
  const padded = normalized + '='.repeat(padding)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function createHmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
}

async function verifyJwt(token, secret) {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('INVALID_TOKEN_FORMAT')
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const headerBytes = base64UrlDecode(encodedHeader)
  const payloadBytes = base64UrlDecode(encodedPayload)
  const signatureBytes = base64UrlDecode(encodedSignature)

  const header = JSON.parse(decoder.decode(headerBytes))
  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new Error('UNSUPPORTED_ALG')
  }

  const key = await createHmacKey(secret)
  const data = encoder.encode(`${encodedHeader}.${encodedPayload}`)
  const expectedSignatureBuffer = await crypto.subtle.sign('HMAC', key, data)
  const expectedSignature = new Uint8Array(expectedSignatureBuffer)

  if (expectedSignature.length !== signatureBytes.length) {
    throw new Error('SIGNATURE_MISMATCH')
  }

  let mismatch = 0
  for (let i = 0; i < expectedSignature.length; i += 1) {
    mismatch |= expectedSignature[i] ^ signatureBytes[i]
  }

  if (mismatch !== 0) {
    throw new Error('SIGNATURE_MISMATCH')
  }

  const payload = JSON.parse(decoder.decode(payloadBytes))
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new Error('TOKEN_EXPIRED')
  }

  return payload
}

export async function onRequestGet(context) {
  const { request, env } = context
  const { SESSION_SECRET } = env

  if (!SESSION_SECRET) {
    return jsonResponse(
      { valid: false, error: 'CONFIGURATION_MISSING', message: '세션 시크릿이 설정되지 않았습니다.' },
      { status: 500 },
    )
  }

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : new URL(request.url).searchParams.get('token') || ''

  if (!token) {
    return jsonResponse({ valid: false, error: 'TOKEN_MISSING' }, { status: 401 })
  }

  try {
    const payload = await verifyJwt(token, SESSION_SECRET)
    return jsonResponse({ valid: true, email: payload.email, exp: payload.exp })
  } catch (error) {
    return jsonResponse({ valid: false, error: error.message }, { status: 401 })
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'authorization',
      'access-control-max-age': '86400',
    },
  })
}
