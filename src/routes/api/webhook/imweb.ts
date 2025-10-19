import type { Hono } from 'hono'

type D1Result<T = unknown> = {
  success: boolean
  error?: string
  results?: T[]
  meta?: {
    last_row_id?: number
    changes?: number
  }
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

type ImwebBindings = {
  D1_DATABASE?: D1Database
  D1_MAIN?: D1Database
  DB_MAIN?: D1Database
}

type ImwebItem = {
  product_name?: unknown
}

type ImwebOrder = {
  items?: unknown
  buyer_name?: unknown
  orderer_name?: unknown
  paid_at?: unknown
}

type ImwebPayload = {
  order?: unknown
}

const MEMBERSHIP_LEVEL = 'michina'
const TARGET_PRODUCT_NAME = '미치나 8기'
const CHALLENGE_DURATION_DAYS = 15

export function registerImwebWebhookRoute(app: Hono<{ Bindings: ImwebBindings }>) {
  app.post('/api/webhook/imweb', async (c) => {
    const db = resolveDatabase(c.env)
    if (!db) {
      console.error('[imweb] D1 database binding is not available')
      return c.json({ success: false, message: 'DATABASE_NOT_CONFIGURED' }, 500)
    }

    let payload: ImwebPayload | null = null
    try {
      const rawBody = await c.req.text()
      payload = rawBody ? (JSON.parse(rawBody) as ImwebPayload) : {}
    } catch (error) {
      console.error('[imweb] Failed to parse webhook payload', error)
      return c.json({ success: false, message: 'INVALID_JSON' }, 400)
    }

    const order = extractOrder(payload)
    const items = extractItems(order)

    if (items.length === 0) {
      return c.json({ success: true, message: 'NO_ITEMS' })
    }

    let processed = false

    for (const item of items) {
      const productName = normalizeProductName(item.product_name)
      if (productName !== TARGET_PRODUCT_NAME) {
        continue
      }

      const rawBuyerName = extractBuyerName(order)
      const normalizedBuyerName = normalizeBuyerName(rawBuyerName)
      if (!normalizedBuyerName) {
        console.warn('[imweb] Buyer name missing for michina order')
        continue
      }

      const startDate = resolveStartDate(order?.paid_at)
      const endDate = addDays(startDate, CHALLENGE_DURATION_DAYS)

      try {
        await upsertMichinaUser(db, normalizedBuyerName, startDate.toISOString(), endDate.toISOString())
        console.log(`미치나 8기 구매자 등록됨: ${rawBuyerName || normalizedBuyerName}`)
        processed = true
      } catch (error) {
        console.error('[imweb] Failed to upsert michina user', error)
        return c.json({ success: false, message: 'DATABASE_ERROR' }, 500)
      }
    }

    return c.json({ success: true, processed })
  })
}

function resolveDatabase(env: ImwebBindings): D1Database | null {
  const candidate = env.D1_DATABASE || env.D1_MAIN || env.DB_MAIN
  if (!candidate || typeof candidate.prepare !== 'function') {
    return null
  }
  return candidate
}

function extractOrder(payload: ImwebPayload | null): ImwebOrder | null {
  if (!payload || typeof payload !== 'object' || payload === null) {
    return null
  }
  const order = (payload as { order?: unknown }).order
  if (!order || typeof order !== 'object') {
    return null
  }
  return order as ImwebOrder
}

function extractItems(order: ImwebOrder | null): ImwebItem[] {
  if (!order || typeof order !== 'object') {
    return []
  }
  const { items } = order
  if (!Array.isArray(items)) {
    return []
  }
  return items as ImwebItem[]
}

function extractBuyerName(order: ImwebOrder | null): string {
  if (!order || typeof order !== 'object') {
    return ''
  }
  const buyerName = order.buyer_name
  if (typeof buyerName === 'string' && buyerName.trim()) {
    return buyerName.trim()
  }
  const ordererName = order.orderer_name
  if (typeof ordererName === 'string' && ordererName.trim()) {
    return ordererName.trim()
  }
  return ''
}

function normalizeBuyerName(input: string): string {
  if (!input) {
    return ''
  }
  return input.trim().toLowerCase().replace(/\s+/g, '')
}

function normalizeProductName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveStartDate(input: unknown): Date {
  if (typeof input === 'string') {
    const parsed = new Date(input)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  return new Date()
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

async function upsertMichinaUser(db: D1Database, buyerName: string, startDate: string, endDate: string) {
  const existing = await db
    .prepare('SELECT id FROM michina_users WHERE buyer_name = ? LIMIT 1')
    .bind(buyerName)
    .first<{ id: number }>()

  if (existing && typeof existing.id === 'number') {
    await db
      .prepare(
        `UPDATE michina_users
         SET start_date = ?, end_date = ?, membership_level = ?
         WHERE id = ?`,
      )
      .bind(startDate, endDate, MEMBERSHIP_LEVEL, existing.id)
      .run()
    return
  }

  await db
    .prepare(
      `INSERT INTO michina_users (buyer_name, start_date, end_date, membership_level)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(buyerName, startDate, endDate, MEMBERSHIP_LEVEL)
    .run()
}

