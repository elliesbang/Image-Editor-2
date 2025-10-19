const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" }

function normalizeName(input) {
  if (typeof input !== 'string') {
    return ''
  }
  return input.trim().replace(/\s+/g, ' ')
}

function normalizeEmail(input) {
  if (typeof input !== 'string') {
    return ''
  }
  return input.trim().toLowerCase()
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10)
}

function isWithinPeriod(startDate, endDate, today) {
  const start = typeof startDate === 'string' && startDate.trim() ? startDate.trim() : null
  const end = typeof endDate === 'string' && endDate.trim() ? endDate.trim() : null
  const target = today || getTodayDateString()
  if (start && start > target) {
    return false
  }
  if (end && end < target) {
    return false
  }
  return true
}

function resolveDatabase(env) {
  const candidates = [env.DB_MICHINA, env.elliesbang_main, env.DB_MAIN, env.D1_MAIN]
  for (const candidate of candidates) {
    if (candidate && typeof candidate.prepare === 'function') {
      return candidate
    }
  }
  return null
}

async function ensureMichinaMembersTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS michina_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        batch INTEGER,
        start_date TEXT,
        end_date TEXT
      )`,
    )
    .run()
  await db
    .prepare(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_michina_members_email_batch ON michina_members(lower(email), COALESCE(batch, -1))',
    )
    .run()
}

async function findMichinaMember(db, name, email) {
  await ensureMichinaMembersTable(db)
  const statement = db
    .prepare(
      `SELECT id, name, email, batch, start_date, end_date
         FROM michina_members
        WHERE lower(name) = ? AND lower(email) = ?
        LIMIT 1`,
    )
    .bind(name.toLowerCase(), email.toLowerCase())

  if (typeof statement.first === 'function') {
    const row = await statement.first()
    if (row) {
      return row
    }
  }
  const result = await statement.all()
  if (Array.isArray(result.results) && result.results.length > 0) {
    return result.results[0]
  }
  return null
}

function createSessionCookie(payload) {
  const encoded = encodeURIComponent(JSON.stringify(payload))
  const maxAge = 60 * 60 * 24 * 7
  return `michina_session=${encoded}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax; Secure`
}

export async function onRequestPost(context) {
  let body
  try {
    body = await context.request.json()
  } catch (error) {
    console.error('[michina] Failed to parse request body', error)
    return new Response(JSON.stringify({ success: false, message: '잘못된 요청입니다.' }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  const normalizedName = normalizeName(body?.name)
  const normalizedEmail = normalizeEmail(body?.email)

  if (!normalizedName || !normalizedEmail) {
    return new Response(JSON.stringify({ success: false, message: '이름과 이메일을 모두 입력해주세요.' }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  const db = resolveDatabase(context.env)
  if (!db) {
    console.error('[michina] D1 database binding for michina_members is missing')
    return new Response(JSON.stringify({ success: false, message: '서버 오류' }), {
      status: 500,
      headers: JSON_HEADERS,
    })
  }

  let member
  try {
    member = await findMichinaMember(db, normalizedName, normalizedEmail)
  } catch (error) {
    console.error('[michina] Failed to query michina_members table', error)
    return new Response(JSON.stringify({ success: false, message: '서버 오류' }), {
      status: 500,
      headers: JSON_HEADERS,
    })
  }

  if (!member) {
    return new Response(
      JSON.stringify({ success: false, message: '현재 기수 명단에 등록되지 않았습니다.', role: 'guest' }),
      {
        status: 200,
        headers: JSON_HEADERS,
      },
    )
  }

  const startDate = typeof member.start_date === 'string' ? member.start_date : null
  const endDate = typeof member.end_date === 'string' ? member.end_date : null
  const withinPeriod = isWithinPeriod(startDate, endDate, getTodayDateString())
  const role = withinPeriod ? 'michina' : 'free'
  const success = role === 'michina'

  const responseBody = {
    success,
    role,
    name: typeof member.name === 'string' && member.name.trim() ? member.name.trim() : normalizedName,
    email: normalizedEmail,
    batch: typeof member.batch === 'number' ? member.batch : null,
    startDate,
    endDate,
    message: success ? undefined : '현재 기수 명단에 등록되지 않았습니다.',
  }

  const headers = { ...JSON_HEADERS }
  if (success) {
    headers['set-cookie'] = createSessionCookie({
      name: responseBody.name,
      email: normalizedEmail,
      role,
      batch: responseBody.batch,
      issuedAt: Date.now(),
    })
    console.log(`✅ ${responseBody.name} → 미치나 로그인 성공`)
  } else {
    console.log(`ℹ️ ${responseBody.name} → 미치나 명단 기간 외 또는 만료`)
  }

  return new Response(JSON.stringify(responseBody), { status: 200, headers })
}
