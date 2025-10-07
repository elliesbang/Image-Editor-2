#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const run = (command, args, options = {}) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    })

    child.on('error', (error) => rejectRun(error))
    child.on('exit', (code) => {
      if (code === 0) {
        resolveRun()
      } else {
        rejectRun(new Error(`Command failed: ${command} ${args.join(' ')}`))
      }
    })
  })

const runCapture = async (command, args, options = {}) => {
  const { stdout } = await execFileAsync(command, args, options)
  return stdout.toString().trim()
}

const ensureFile = async (path) => {
  await stat(path)
}

const removeExistingFiles = async (directory) => {
  const entries = await readdir(directory)
  await Promise.all(
    entries.map((entry) => {
      if (entry === '.git') {
        return Promise.resolve()
      }

      return rm(join(directory, entry), { recursive: true, force: true })
    }),
  )
}

const copyDistContents = async (distDir, worktreeDir) => {
  const entries = await readdir(distDir)
  await Promise.all(
    entries.map((entry) =>
      cp(join(distDir, entry), join(worktreeDir, entry), {
        recursive: true,
        force: true,
      }),
    ),
  )
}

const shouldSkipDeploy = () => {
  const skipFlag = process.env.SKIP_GH_PUBLISH
  if (skipFlag && skipFlag !== '0' && skipFlag.toLowerCase?.() !== 'false') {
    return true
  }
  const truthy = new Set(['1', 'true', 'yes'])
  if (truthy.has(String(process.env.CI).toLowerCase())) {
    return true
  }
  if (truthy.has(String(process.env.NETLIFY).toLowerCase())) {
    return true
  }
  return false
}

const main = async () => {
  if (shouldSkipDeploy()) {
    console.log('Skipping GitHub Pages deployment (environment-configured skip).')
    return
  }

  const branch = process.env.GH_PAGES_BRANCH ?? 'gh-pages'
  const remote = process.env.GH_PAGES_REMOTE ?? 'origin'

  const repoRoot = await runCapture('git', ['rev-parse', '--show-toplevel'])
  const distDir = resolve(repoRoot, 'dist')

  if (!existsSync(distDir)) {
    throw new Error('dist directory not found. Run "npm run build" before deploying.')
  }

  await ensureFile(resolve(distDir, 'index.html'))
  await ensureFile(resolve(distDir, '404.html'))

  let remoteUrl = ''
  try {
    remoteUrl = await runCapture('git', ['remote', 'get-url', remote])
  } catch (error) {
    console.warn(`Remote "${remote}" not found. Skipping GitHub Pages deployment.`)
    return
  }

  if (!remoteUrl) {
    console.warn(`Remote "${remote}" has no URL. Skipping GitHub Pages deployment.`)
    return
  }

  const worktreeDir = await mkdtemp(join(tmpdir(), 'gh-pages-'))

  try {
    await run('git', ['fetch', remote])
    await run('git', ['worktree', 'add', '--force', '-B', branch, worktreeDir, 'HEAD'])

    await removeExistingFiles(worktreeDir)
    await copyDistContents(distDir, worktreeDir)

    await run('git', ['-C', worktreeDir, 'add', '--all'])

    const status = await runCapture('git', ['-C', worktreeDir, 'status', '--porcelain'])

    if (!status) {
      console.log('No changes to deploy. Skipping commit and push.')
      return
    }

    const commitMessage = `Deploy dist at ${new Date().toISOString()}`
    await run('git', ['-C', worktreeDir, 'commit', '-m', commitMessage])
    await run('git', ['-C', worktreeDir, 'push', remote, `${branch}:refs/heads/${branch}`, '--force'])
  } finally {
    await run('git', ['worktree', 'remove', worktreeDir, '--force'])
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
