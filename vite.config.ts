import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const arcticEntry = fileURLToPath(new URL('./utils/arctic-google.js', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      arctic: arcticEntry,
    },
  },
  plugins: [
    build({
      entry: './src/index.tsx',
      entryContentDefaultExportHook: (appName) => `export default {
  async fetch(request, env, context) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return ${appName}.fetch(request, env, context)
    }

    const response = await ${appName}.fetch(request, env, context)
    if (response && response.status === 404) {
      return context.next()
    }

    return response
  }
}`,
    }),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ]
})
