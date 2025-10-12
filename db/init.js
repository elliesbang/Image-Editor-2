let initialized = false

async function runStatement(statement) {
  if (typeof statement.run === 'function') {
    return statement.run()
  }
  if (typeof statement.all === 'function') {
    return statement.all()
  }
  throw new Error('Invalid D1 statement interface')
}

export async function ensureAuthTables(db) {
  if (!db) {
    throw new Error('D1 database binding `DB` is not configured')
  }

  if (initialized) {
    return
  }

  await runStatement(
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
  )

  await runStatement(
    db.prepare(`
      CREATE TABLE IF NOT EXISTS login_codes (
        id TEXT PRIMARY KEY,
        email TEXT,
        code_hash TEXT,
        expires_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
  )

  initialized = true
}
