import { verify } from 'hono/jwt'

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {})
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { ...init, headers })
}

export function createAuthMiddleware() {
  return async (c, next) => {
    const { JWT_SECRET } = c.env

    if (!JWT_SECRET) {
      return jsonResponse({ success: false, message: '인증 토큰 구성이 완료되지 않았습니다.' }, { status: 500 })
    }

    const authorization = c.req.header('Authorization') || c.req.header('authorization') || ''
    if (!authorization.startsWith('Bearer ')) {
      return jsonResponse({ success: false, message: '인증이 필요합니다.' }, { status: 401 })
    }

    const token = authorization.slice(7).trim()
    if (!token) {
      return jsonResponse({ success: false, message: '인증이 필요합니다.' }, { status: 401 })
    }

    try {
      const payload = await verify(token, JWT_SECRET)
      c.set('user', payload)
      await next()
    } catch (error) {
      return jsonResponse({ success: false, message: '토큰이 유효하지 않습니다.' }, { status: 401 })
    }
  }
}
