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
    throw new Error('D1 database binding `DB_MAIN` is not configured')
  }

  if (initialized) {
    return
  }

  await runStatement(
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password_hash TEXT,
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `)
  )

  const { results: passwordColumnResults } =
    (await db
      .prepare("SELECT name FROM pragma_table_info('users') WHERE name = 'password_hash'")
      .all()) ?? {}

  if (!Array.isArray(passwordColumnResults) || passwordColumnResults.length === 0) {
    await runStatement(db.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT'))
  }

  await runStatement(
    db.prepare(`
      CREATE TABLE IF NOT EXISTS user_credentials (
        user_id INTEGER PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `)
  )

  await runStatement(
    db.prepare(`
      CREATE TABLE IF NOT EXISTS credits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        credits INTEGER DEFAULT 30,
        last_reset DATE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `)
  )

  await runStatement(
    db.prepare(`
      CREATE TABLE IF NOT EXISTS processed_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        image_url TEXT,
        process_type TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
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
