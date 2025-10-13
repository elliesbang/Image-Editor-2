import { Hono } from 'hono'
import type { Context } from 'hono'
import { serveStatic } from 'hono/cloudflare-pages'
import { renderer } from './renderer'
import { registerAuthRoutes } from '../routes/auth.js'
import AnalyzePanel from './features/keywords/AnalyzePanel'
import LoginPage from './Login'

interface D1Result<T = unknown> {
  results?: T[]
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  run<T = unknown>(): Promise<D1Result<T>>
  all<T = unknown>(): Promise<D1Result<T>>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
}

interface Bindings {
  DB?: D1Database
  DB_MAIN?: D1Database
  DB_MICHINA?: D1Database
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
  MICHINA_COMMUNITY_URL?: string
  JWT_SECRET?: string
  SMTP_HOST?: string
  SMTP_USER?: string
  SMTP_PASS?: string
  SMTP_PORT?: string
  SMTP_FROM?: string
}

interface ChallengePeriodRow {
  id: number
  start: string
  end: string
  saved_at: string
}

interface ChallengePeriodRecord {
  id: number
  startDate: string
  endDate: string
  savedAt: string
}

interface AppEnv {
  Bindings: Bindings
}

type AppContext = Context<AppEnv>

function jsonResponse(c: AppContext, body: unknown, status = 200) {
  return c.json(body, status)
}

function getDatabase(c: AppContext): D1Database | null {
  return c.env.DB ?? c.env.DB_MAIN ?? c.env.DB_MICHINA ?? null
}

async function ensureChallengePeriodTable(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS challenge_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start TEXT NOT NULL,
        end TEXT NOT NULL,
        saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now'))
      )`
    )
    .run()
}

function mapChallengePeriodRow(row: Record<string, unknown>): ChallengePeriodRecord | null {
  const id = Number(row.id ?? row.ID ?? row.period_id)
  const start =
    typeof row.start === 'string'
      ? row.start
      : typeof row.start_date === 'string'
      ? row.start_date
      : typeof row.startDate === 'string'
      ? row.startDate
      : ''
  const end =
    typeof row.end === 'string'
      ? row.end
      : typeof row.end_date === 'string'
      ? row.end_date
      : typeof row.endDate === 'string'
      ? row.endDate
      : ''
  const saved =
    typeof row.saved_at === 'string'
      ? row.saved_at
      : typeof row.savedAt === 'string'
      ? row.savedAt
      : typeof row.saved_at === 'number'
      ? String(row.saved_at)
      : ''

  if (!Number.isFinite(id) || !start || !end || !saved) {
    return null
  }

  return {
    id,
    startDate: start,
    endDate: end,
    savedAt: saved,
  }
}

async function listChallengePeriods(db: D1Database): Promise<ChallengePeriodRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, start, end, saved_at
         FROM challenge_periods
        ORDER BY datetime(saved_at) DESC, id DESC`
    )
    .all<ChallengePeriodRow>()

  const rows = result.results ?? []
  return rows
    .map((row) => mapChallengePeriodRow(row as unknown as Record<string, unknown>))
    .filter((value): value is ChallengePeriodRecord => value !== null)
}

function renderAdminManagementPage(adminEmail: string) {
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>관리자 대시보드 | 챌린지 관리</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet" />
    <script>
      window.tailwind = window.tailwind || {}
      window.tailwind.config = {
        theme: {
          extend: {
            colors: {
              primary: '#fef568',
              ivory: '#f5eee9',
            },
            fontFamily: {
              pretendard: ['Pretendard', 'sans-serif'],
            },
            boxShadow: {
              ellie: '0 25px 50px -12px rgba(250, 204, 21, 0.35)',
            },
          },
        },
      }
    </script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background-color: #f5eee9;
        color: #4f3b0f;
      }
      .admin-container {
        min-height: 100vh;
        padding: 56px 16px 80px;
        display: block;
      }
      .admin-header {
        width: 100%;
        max-width: 900px;
        background-color: #fff6dc;
        border: 1px solid #f0dba5;
        border-radius: 20px;
        padding: 32px 28px;
        text-align: center;
        box-shadow: 0 18px 48px rgba(116, 94, 38, 0.14);
        margin: 0 auto 32px;
      }
      .admin-header__actions {
        margin-top: 20px;
        text-align: center;
      }
      .admin-header__actions > * {
        display: inline-block;
        margin: 6px 8px;
      }
      .admin-dashboard {
        width: 100%;
        max-width: 900px;
        background-color: #f5eee9;
        padding: 40px;
        border-radius: 20px;
        display: block;
        box-shadow: 0 20px 60px rgba(116, 94, 38, 0.12);
        margin: 0 auto;
      }
      .admin-dashboard > section + section {
        margin-top: 32px;
      }
      .admin-footer {
        width: 100%;
        max-width: 900px;
        text-align: center;
        font-size: 0.75rem;
        color: #7a5a00;
        border-top: 1px solid #f0dba5;
        padding-top: 20px;
        margin: 32px auto 0;
      }
      .admin-section {
        background-color: #fffaf0;
        border: 1px solid #f0dba5;
        border-radius: 18px;
        padding: 28px;
        box-shadow: 0 15px 40px rgba(116, 94, 38, 0.1);
      }
      .admin-section h2 {
        font-size: 1.25rem;
        font-weight: 700;
        color: #3f2f00;
        margin-bottom: 16px;
      }
      .admin-section p {
        color: #6f5a26;
        font-size: 0.95rem;
        line-height: 1.6;
      }
      .challenge-period-section {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .challenge-form {
        display: grid;
        gap: 12px;
      }
      @media (min-width: 640px) {
        .challenge-form {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: end;
        }
        .challenge-form button {
          grid-column: span 2 / span 2;
          justify-self: center;
        }
      }
      .challenge-form input {
        width: 100%;
        border-radius: 16px;
        border: 1px solid #f0dba5;
        background-color: #fefdf4;
        padding: 12px 14px;
        font-size: 0.95rem;
        color: #3f2f00;
        box-shadow: inset 0 1px 3px rgba(240, 219, 165, 0.65);
      }
      .challenge-form input:focus-visible {
        outline: 3px solid rgba(254, 245, 104, 0.6);
        outline-offset: 2px;
      }
      .challenge-form button {
        background-color: #fef568;
        color: #333;
        border: none;
        border-radius: 12px;
        padding: 12px 18px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .challenge-form button:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 18px rgba(116, 94, 38, 0.18);
      }
      .challenge-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 12px;
      }
      .challenge-list__item {
        border-radius: 16px;
        border: 1px solid #f0dba5;
        background-color: rgba(254, 253, 244, 0.85);
        padding: 16px;
        display: flex;
        align-items: center;
        transition: background-color 0.2s ease;
      }
      .challenge-list__item input[type='radio'] {
        margin-right: 12px;
      }
      .challenge-list__info {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .challenge-list__range {
        font-size: 0.95rem;
        font-weight: 600;
        color: #3f2f00;
      }
      .challenge-list__saved {
        font-size: 0.8rem;
        color: #7a5a00;
      }
      .challenge-list__empty {
        padding: 18px;
        text-align: center;
        border-radius: 16px;
        border: 1px dashed rgba(240, 219, 165, 0.9);
        background-color: rgba(255, 250, 240, 0.6);
        color: #8c7a4f;
        font-size: 0.9rem;
      }
      .challenge-delete {
        align-self: flex-end;
        background-color: #fee2e2;
        color: #9f1239;
        border: none;
        border-radius: 12px;
        padding: 10px 18px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .challenge-delete:hover {
        transform: translateY(-1px);
        box-shadow: 0 8px 18px rgba(159, 18, 57, 0.18);
      }
      .admin-form-actions {
        margin-top: 20px;
        text-align: center;
      }
      .admin-form-note {
        margin-bottom: 12px;
        font-size: 0.85rem;
        color: #8c7a4f;
      }
      .admin-table {
        border-radius: 16px;
        border: 1px solid #f0dba5;
        background-color: rgba(254, 253, 244, 0.7);
        padding: 20px;
        margin-top: 24px;
      }
      .admin-card-title {
        text-align: center;
        font-size: 0.95rem;
        font-weight: 600;
        color: #4f3b0f;
        margin-bottom: 12px;
      }
      .admin-table table {
        width: 100%;
        border-collapse: collapse;
      }
      .admin-table th,
      .admin-table td {
        padding: 12px 16px;
        border-bottom: 1px solid rgba(240, 219, 165, 0.8);
        text-align: left;
        font-size: 0.95rem;
        color: #3f2f00;
      }
      .admin-table thead {
        background-color: rgba(254, 245, 104, 0.45);
        text-transform: uppercase;
        font-size: 0.8rem;
        letter-spacing: 0.04em;
        color: #4f3b0f;
      }
      .admin-count-pill {
        display: inline-block;
        text-align: center;
        padding: 6px 12px;
        border-radius: 999px;
        background-color: rgba(254, 245, 104, 0.8);
        font-size: 0.8rem;
        font-weight: 600;
        color: #3f2f00;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    </style>
  </head>
  <body data-admin-email="${adminEmail}" class="bg-[#f5eee9] text-[#4f3b0f]">
    <div class="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center px-4">
      <div
        data-role="dashboard-toast"
        class="hidden w-full max-w-sm rounded-2xl bg-[#333]/90 px-5 py-4 text-sm font-medium text-white shadow-2xl backdrop-blur"
        role="status"
        aria-live="assertive"
      ></div>
    </div>
    <div class="admin-container">
      <header class="admin-header">
        <h1 class="text-3xl font-bold text-[#5b4100] md:text-4xl">관리자 대시보드</h1>
        <p data-role="welcome" class="mt-3 text-sm text-[#6f5a26]">관리자 전용 대시보드 영역입니다.</p>
        <div class="admin-header__actions">
          <span data-role="session-info" class="admin-count-pill uppercase tracking-[0.16em]">세션 정보 확인 중</span>
          <button type="button" data-role="logout">로그아웃</button>
        </div>
      </header>
      <main class="admin-dashboard">
        <section data-role="dashboard-section" class="challenge-period-section admin-section">
          <h2>챌린지 기간 설정</h2>
          <form data-role="challenge-form" class="challenge-form">
            <input type="datetime-local" data-role="start" required aria-label="챌린지 시작" />
            <input type="datetime-local" data-role="end" required aria-label="챌린지 종료" />
            <button type="submit">저장</button>
          </form>
          <ul data-role="challenge-list" class="challenge-list"></ul>
          <button data-role="challenge-delete" type="button" class="challenge-delete">선택된 기간 삭제</button>
        </section>
        <section data-role="dashboard-section" class="participant-upload-section admin-section">
          <h2>📂 참가자 명단 업로드</h2>
          <p data-role="upload-hint">CSV 파일(name,email)을 업로드하면 참가자 명단이 저장됩니다.</p>
          <form data-role="participants-form" class="mt-6">
            <label class="admin-label">
              CSV 파일 선택
              <input
                type="file"
                accept=".csv,text/csv"
                data-role="participants-file"
                class="admin-file-input"
              />
            </label>
            <div class="admin-form-actions">
              <span data-role="participants-filename" class="admin-form-note">선택된 파일이 없습니다.</span>
              <button type="submit" data-role="participants-upload">명단 업로드</button>
            </div>
          </form>
          <p data-role="participants-status" class="admin-form-note">CSV 파일을 선택하면 상태가 표시됩니다.</p>
          <div class="admin-table">
            <h3 class="admin-card-title">업로드된 참가자</h3>
            <span data-role="participants-count" class="admin-count-pill">0명</span>
            <p data-role="participants-message" class="admin-form-note">등록된 참가자 정보가 없습니다.</p>
            <div class="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-[#f0dba5] bg-white">
              <table>
                <thead>
                  <tr>
                    <th scope="col">이름</th>
                    <th scope="col">이메일</th>
                    <th scope="col">최근 등록일</th>
                  </tr>
                </thead>
                <tbody data-role="participants-table">
                  <tr>
                    <td colspan="3" class="text-center text-sm text-[#7a5a00]">등록된 참가자 정보가 없습니다.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
      <footer class="admin-footer">
        &copy; ${new Date().getFullYear()} Ellie Image Editor. All rights reserved.
      </footer>
    </div>
    <script type="module" src="/static/dashboard.js"></script>
  </body>
</html>`
}

const app = new Hono<AppEnv>()

app.use('/static/*', serveStatic({ root: './public' }))
app.use('/admin-login/*', serveStatic({ root: './public' }))
app.use('*', renderer)

registerAuthRoutes(app)

app.get('/', (c) => c.render(<AnalyzePanel />))
app.get('/login', (c) => c.render(<LoginPage />))

app.get('/dashboard', async (c) => {
  const adminEmail = c.env.ADMIN_EMAIL ?? 'admin@example.com'
  const dashboardPage = renderAdminManagementPage(adminEmail)
  const response = c.html(dashboardPage)
  response.headers.set('Cache-Control', 'no-store')
  return response
})

app.get('/api/admin/challenge-periods', async (c) => {
  const db = getDatabase(c)
  if (!db) {
    return jsonResponse(c, { success: false, message: '데이터베이스 연결에 실패했습니다.' }, 500)
  }

  await ensureChallengePeriodTable(db)
  const periods = await listChallengePeriods(db)
  return jsonResponse(c, { success: true, periods })
})

app.post('/api/admin/challenge-periods', async (c) => {
  const db = getDatabase(c)
  if (!db) {
    return jsonResponse(c, { success: false, message: '데이터베이스 연결에 실패했습니다.' }, 500)
  }

  let body: { startDate?: string; endDate?: string }
  try {
    body = await c.req.json()
  } catch (error) {
    return jsonResponse(c, { success: false, message: '잘못된 요청 본문입니다.' }, 400)
  }

  const start = typeof body.startDate === 'string' ? body.startDate.trim() : ''
  const end = typeof body.endDate === 'string' ? body.endDate.trim() : ''

  if (!start || !end) {
    return jsonResponse(c, { success: false, message: '시작일과 종료일을 모두 입력해주세요.' }, 400)
  }

  if (start > end) {
    return jsonResponse(c, { success: false, message: '종료일은 시작일 이후여야 합니다.' }, 400)
  }

  await ensureChallengePeriodTable(db)
  await db.prepare('INSERT INTO challenge_periods (start, end) VALUES (?, ?)').bind(start, end).run()

  const periods = await listChallengePeriods(db)
  return jsonResponse(c, { success: true, periods }, 201)
})

app.delete('/api/admin/challenge-periods/:id', async (c) => {
  const db = getDatabase(c)
  if (!db) {
    return jsonResponse(c, { success: false, message: '데이터베이스 연결에 실패했습니다.' }, 500)
  }

  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id) || id <= 0) {
    return jsonResponse(c, { success: false, message: '잘못된 기간 ID 입니다.' }, 400)
  }

  await ensureChallengePeriodTable(db)
  await db.prepare('DELETE FROM challenge_periods WHERE id = ?').bind(id).run()

  const periods = await listChallengePeriods(db)
  return jsonResponse(c, { success: true, periods })
})

app.get('/admin-dashboard', (c) => c.redirect('/dashboard'))

app.get('/api/health', (c) => c.json({ status: 'ok' }))

export default app
