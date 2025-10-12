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
        role TEXT DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
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
