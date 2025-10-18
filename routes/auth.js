import { randomUUID } from 'node:crypto'
import { sign } from 'hono/jwt'
import { hashCode, verifyCode } from '../utils/hash.js'
import { sendLoginCodeEmail } from '../utils/mail.js'
import { ensureAuthTables } from '../db/init.js'

const CODE_TTL_MS = 5 * 60 * 1000

function normalizeEmail(input) {
  if (typeof input !== 'string') return ''
  return input.trim().toLowerCase()
}

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {})
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { ...init, headers })
}

async function deleteExistingCodes(db, email) {
  await db.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run()
}

async function saveLoginCode(db, email, codeHash, expiresAt) {
  const id = randomUUID()
  await db
    .prepare(
      `INSERT INTO login_codes (id, email, code_hash, expires_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(id, email, codeHash, expiresAt)
    .run()
}

async function findLoginCode(db, email) {
  const statement = db
    .prepare(
      `SELECT id, email, code_hash, expires_at
         FROM login_codes
        WHERE email = ?`
    )
    .bind(email)

  const result = await statement.first?.()
  if (result) {
    return result
  }

  const { results } = await statement.all()
  return Array.isArray(results) && results.length > 0 ? results[0] : null
}

async function ensureUserExists(db, email) {
  await db
    .prepare(
      `INSERT INTO users (email)
       VALUES (?)
       ON CONFLICT(email) DO NOTHING`
    )
    .bind(email)
    .run()
}

export function registerAuthRoutes(app) {
  app.post('/auth/request-code', async (c) => {
    const db = c.env.DB_MAIN ?? c.env.D1_MAIN
    const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT, SMTP_FROM } = c.env

    if (!db) {
      return jsonResponse(
        { success: false, message: '데이터베이스가 구성되지 않았습니다.' },
        { status: 500 }
      )
    }

    await ensureAuthTables(db)

    let body
    try {
      body = await c.req.json()
    } catch (error) {
      return jsonResponse({ success: false, message: '잘못된 요청 본문입니다.' }, { status: 400 })
    }

    const email = normalizeEmail(body?.email)
    if (!email) {
      return jsonResponse({ success: false, message: '이메일 주소를 입력해주세요.' }, { status: 400 })
    }

    const code = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0')

    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()
    const codeHash = await hashCode(code)

    await deleteExistingCodes(db, email)
    await saveLoginCode(db, email, codeHash, expiresAt)

    await sendLoginCodeEmail({
      env: {
        SMTP_HOST,
        SMTP_PORT,
        SMTP_USER,
        SMTP_PASS,
        SMTP_FROM,
      },
      to: email,
      code,
      expiresInMinutes: 5,
    })

    return jsonResponse({ success: true, message: '인증코드가 이메일로 전송되었습니다.' })
  })

  app.post('/auth/verify-code', async (c) => {
    const db = c.env.DB_MAIN ?? c.env.D1_MAIN
    const { JWT_SECRET } = c.env

    if (!db || !JWT_SECRET) {
      return jsonResponse(
        { success: false, message: '인증 구성이 완료되지 않았습니다.' },
        { status: 500 }
      )
    }

    await ensureAuthTables(db)

    let body
    try {
      body = await c.req.json()
    } catch (error) {
      return jsonResponse({ success: false, message: '잘못된 요청 본문입니다.' }, { status: 400 })
    }

    const email = normalizeEmail(body?.email)
    const code = typeof body?.code === 'string' ? body.code.trim() : ''

    if (!email || !code) {
      return jsonResponse({ success: false, message: '이메일과 인증코드를 입력해주세요.' }, { status: 400 })
    }

    const record = await findLoginCode(db, email)
    if (!record) {
      return jsonResponse(
        { success: false, message: '인증코드가 올바르지 않거나 만료되었습니다.' },
        { status: 400 }
      )
    }

    const expiresAt = new Date(record.expires_at)
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      await deleteExistingCodes(db, email)
      return jsonResponse(
        { success: false, message: '인증코드가 올바르지 않거나 만료되었습니다.' },
        { status: 400 }
      )
    }

    const valid = await verifyCode(code, record.code_hash)
    if (!valid) {
      return jsonResponse(
        { success: false, message: '인증코드가 올바르지 않거나 만료되었습니다.' },
        { status: 400 }
      )
    }

    await ensureUserExists(db, email)
    await deleteExistingCodes(db, email)

    const now = Math.floor(Date.now() / 1000)
    const exp = now + 7 * 24 * 60 * 60

    const token = await sign(
      {
        sub: email,
        email,
        iat: now,
        exp,
        iss: 'easy-image-editor',
        aud: 'easy-image-editor/client',
      },
      JWT_SECRET
    )

    return jsonResponse({ success: true, token, message: '로그인 성공' })
  })
}
