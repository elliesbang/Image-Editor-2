import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const routesConfig = {
  version: 1,
  include: ['/*'],
  exclude: [],
}

const routesPath = resolve('dist/_routes.json')
await mkdir(dirname(routesPath), { recursive: true })
await writeFile(routesPath, `${JSON.stringify(routesConfig, null, 2)}\n`)
