import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const distDir = path.resolve('dist')
const routesPath = path.join(distDir, '_routes.json')
const desiredRoutes = {
  version: 1,
  include: ['/*'],
  exclude: ['/_assets/*'],
}
const desiredContent = JSON.stringify(desiredRoutes, null, 2) + '\n'

async function ensureRoutesFile() {
  await mkdir(distDir, { recursive: true })

  let needsWrite = true
  try {
    const existingContent = await readFile(routesPath, 'utf8')
    if (existingContent === desiredContent) {
      needsWrite = false
    } else {
      try {
        const normalized = JSON.stringify(JSON.parse(existingContent), null, 2) + '\n'
        needsWrite = normalized !== desiredContent
      } catch {
        needsWrite = true
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  if (needsWrite) {
    await writeFile(routesPath, desiredContent)
  }
}

ensureRoutesFile().catch((error) => {
  console.error('Failed to ensure _routes.json in dist:', error)
  process.exitCode = 1
})
