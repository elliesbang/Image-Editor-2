import buildNetlify from '@hono/vite-build/netlify-functions'
import devServer from '@hono/vite-dev-server'
import nodeAdapter from '@hono/vite-dev-server/node'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as runViteBuild, defineConfig } from 'vite'

const isEnoent = (error) =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')

const ensureTrailingSlash = (value) => (value.endsWith('/') ? value : `${value}/`)

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const HTML_INPUTS = {
  main: resolve(projectRoot, 'index.html'),
  privacy: resolve(projectRoot, 'privacy.html'),
  terms: resolve(projectRoot, 'terms.html'),
  cookies: resolve(projectRoot, 'cookies.html'),
}
const HTML_PAGES = ['index.html', 'privacy.html', 'terms.html', 'cookies.html']

const rewriteHtmlAssets = async (filePath, basePath) => {
  try {
    const html = await readFile(filePath, 'utf8')
    const normalizedBase = ensureTrailingSlash(basePath)
    const rewritten = html
      .replaceAll('href="/static/', `href="${normalizedBase}static/`)
      .replaceAll('href="./static/', `href="${normalizedBase}static/`)
      .replaceAll('href="static/', `href="${normalizedBase}static/`)
      .replaceAll('src="/static/', `src="${normalizedBase}static/`)
      .replaceAll('src="./static/', `src="${normalizedBase}static/`)
      .replaceAll('src="static/', `src="${normalizedBase}static/`)

    if (rewritten !== html) {
      await writeFile(filePath, rewritten, 'utf8')
    }
  } catch (error) {
    if (!isEnoent(error)) {
      throw error
    }
  }
}

const PUBLIC_BASE_PATH = '/Image-Editor-2/'

const serverBuildPlugin = () => {
  return {
    name: 'netlify-functions-post-build',
    apply: 'build',
    enforce: 'post',
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

const copyRedirectsPlugin = (basePath, htmlFiles) => {
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
        if (!isEnoent(error)) {
          throw error
        }
      }

      const targets = Array.isArray(htmlFiles) && htmlFiles.length > 0 ? htmlFiles : ['index.html']
      await Promise.all(
        targets.map(async (file) => {
          const filePath = resolve(distDir, file)
          await rewriteHtmlAssets(filePath, basePath)
        }),
      )

      try {
        await copyFile(indexPath, notFoundPath)
      } catch (error) {
        if (!isEnoent(error)) {
          throw error
        }
      }

      await rewriteHtmlAssets(notFoundPath, basePath)
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
    base: PUBLIC_BASE_PATH,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: HTML_INPUTS,
      },
    },
    plugins: [copyRedirectsPlugin(PUBLIC_BASE_PATH, HTML_PAGES), serverBuildPlugin()],
  }
})
