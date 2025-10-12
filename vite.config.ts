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
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ]
})
