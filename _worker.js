let cachedWorker

async function loadWorker() {
  if (cachedWorker) {
    return cachedWorker
  }
  let mod
  try {
    mod = await import('./dist/_worker.js')
  } catch (error) {
    mod = await import('./src/index.tsx')
  }
  cachedWorker = mod?.default ?? mod
  return cachedWorker
}

export default {
  async fetch(request, env, ctx) {
    if (!env.D1_MAIN && env.DB_MAIN) {
      env.D1_MAIN = env.DB_MAIN
    }
    const worker = await loadWorker()
    if (typeof worker?.fetch === 'function') {
      return worker.fetch(request, env, ctx)
    }
    if (typeof worker === 'function') {
      return worker(request, env, ctx)
    }
    throw new Error('Worker entry is not callable')
  },
}
