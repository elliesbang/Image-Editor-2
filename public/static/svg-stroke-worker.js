const LIBRARY_SOURCES = [
  'https://cdn.jsdelivr.net/npm/svg-outline-stroke@1.3.1/dist/svg-outline-stroke.min.js',
  'https://cdn.jsdelivr.net/npm/svg-outline-stroke@1.3.1/dist/svg-outline-stroke.js',
  'https://cdn.jsdelivr.net/npm/oslllo-svg-fixer@2.0.4/dist/oslllo-svg-fixer.min.js',
]

let conversionRunner = null

function postProgress(id, value, stage) {
  self.postMessage({
    type: 'progress',
    id,
    value: Math.max(0, Math.min(100, Number.isFinite(value) ? value : Number.parseFloat(value))),
    stage,
  })
}

function tryExtractSvg(result, original) {
  if (typeof result === 'string') {
    return result
  }
  if (result && typeof result === 'object') {
    if (typeof result.svg === 'string') {
      return result.svg
    }
    if (typeof result.contents === 'string') {
      return result.contents
    }
    if (typeof result.output === 'string') {
      return result.output
    }
    if (typeof result.data === 'string') {
      return result.data
    }
  }
  return original
}

function ensureConversionRunner() {
  if (conversionRunner) {
    return conversionRunner
  }

  for (const source of LIBRARY_SOURCES) {
    try {
      importScripts(source)
    } catch (error) {
      continue
    }

    if (self.SVGOutlineStroke && typeof self.SVGOutlineStroke.svg2path === 'function') {
      conversionRunner = async (svg) => {
        const result = await self.SVGOutlineStroke.svg2path(svg, { keepStroke: false })
        return tryExtractSvg(result, svg)
      }
      conversionRunner.library = 'svg-outline-stroke'
      return conversionRunner
    }

    if (typeof self.svgOutlineStroke === 'function') {
      conversionRunner = async (svg) => {
        const result = await self.svgOutlineStroke(svg, { keepStroke: false })
        return tryExtractSvg(result, svg)
      }
      conversionRunner.library = 'svg-outline-stroke'
      return conversionRunner
    }

    if (self.osllloSvgFixer && typeof self.osllloSvgFixer.fix === 'function') {
      conversionRunner = async (svg) => {
        const result = await self.osllloSvgFixer.fix(svg, { keepStroke: false, convertStrokeToFill: true })
        return tryExtractSvg(result, svg)
      }
      conversionRunner.library = 'oslllo-svg-fixer'
      return conversionRunner
    }

    if (typeof self.osllloSvgFixer === 'function') {
      conversionRunner = async (svg) => {
        const result = await self.osllloSvgFixer(svg, { keepStroke: false, convertStrokeToFill: true })
        return tryExtractSvg(result, svg)
      }
      conversionRunner.library = 'oslllo-svg-fixer'
      return conversionRunner
    }
  }

  return null
}

self.postMessage({ type: 'ready' })

self.onmessage = async (event) => {
  const data = event?.data
  if (!data || data.type !== 'convert') {
    return
  }

  const { id, svg } = data
  if (!id || typeof svg !== 'string') {
    self.postMessage({ type: 'error', id, message: 'Invalid SVG payload' })
    return
  }

  try {
    postProgress(id, 0, 'start')
    const runner = ensureConversionRunner()
    if (!runner) {
      throw new Error('Stroke conversion library unavailable')
    }
    postProgress(id, 35, 'library-ready')
    const output = await runner(svg)
    postProgress(id, 100, 'done')
    self.postMessage({
      type: 'result',
      id,
      svg: typeof output === 'string' && output.length > 0 ? output : svg,
      converted: typeof output === 'string' ? output !== svg : false,
      library: runner.library || 'unknown',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ type: 'error', id, message })
  }
}
