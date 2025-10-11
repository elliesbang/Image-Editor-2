import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const googleOAuthProviderPath = fileURLToPath(new URL('./src/lib/oauth/google.ts', import.meta.url))

export default defineConfig({
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ],
  resolve: {
    alias: {
      '@hono/oauth-providers/google': googleOAuthProviderPath
    }
  }
})
