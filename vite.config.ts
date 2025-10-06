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
    name: 'copy-static-artifacts',
    apply: 'build',
    async writeBundle() {
      const cwd = process.cwd()
      const distDir = resolve(cwd, 'dist')
      const redirectsSource = resolve(cwd, '_redirects')
      const redirectsDestination = resolve(distDir, '_redirects')
      const indexPath = resolve(distDir, 'index.html')
      const notFoundPath = resolve(distDir, '404.html')
      try {
        await copyFile(redirectsSource, redirectsDestination)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }

      try {
        await copyFile(indexPath, notFoundPath)
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
    base: '/Image-Editor-2/',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    plugins: [copyRedirectsPlugin(), serverBuildPlugin()],
  }
})
