import buildNetlify from '@hono/vite-build/netlify-functions'
import devServer from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build as runViteBuild, defineConfig } from 'vite'

const serverBuildPlugin = () => {
  return {
    name: 'netlify-functions-post-build',
    apply: 'build',
    enforce: 'post' as const,
    async closeBundle() {
      await runViteBuild({
        configFile: false,
        plugins: [
          buildNetlify({
            entry: 'src/index.tsx',
            outputDir: './netlify/functions',
            output: 'server.js',
            emptyOutDir: true,
          }),
        ],
      })
    },
  }
}

const copyRedirectsPlugin = () => {
  return {
    name: 'copy-netlify-redirects',
    apply: 'build',
    async writeBundle() {
      const source = resolve(process.cwd(), '_redirects')
      const destination = resolve(process.cwd(), 'dist/_redirects')
      try {
        await copyFile(source, destination)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
    },
  }
}

export default defineConfig(({ command }) => {
  if (command === 'serve') {
    return {
      plugins: [
        devServer({
          adapter: nodeAdapter,
          entry: 'src/index.tsx',
        }),
      ],
    }
  }

  return {
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    plugins: [copyRedirectsPlugin(), serverBuildPlugin()],
  }
})
