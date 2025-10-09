const IMAGETRACER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/imagetracerjs/1.2.6/imagetracer_v1.2.6.min.js'
const IMAGE_TRACER_SOURCES = [
  IMAGETRACER_SRC,
  'https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.min.js',
  'https://unpkg.com/imagetracerjs@1.2.6/imagetracer_v1.2.6.min.js',
]
const IMAGE_TRACER_MAX_RETRIES = 3
const IMAGE_TRACER_RETRY_DELAY = 900
const IMAGE_TRACER_RETRY_JITTER = 500
const IMAGE_TRACER_READY_TIMEOUT = 12000
const IMAGE_TRACER_CHECK_INTERVAL = 80

let imageTracerPromise = null

function wait(ms, jitter = 0) {
  const delay = Math.max(0, ms + (jitter ? Math.floor(Math.random() * jitter) : 0))
  return new Promise((resolve) => {
    setTimeout(resolve, delay)
  })
}

function waitForCondition(condition, timeout = IMAGE_TRACER_READY_TIMEOUT, interval = IMAGE_TRACER_CHECK_INTERVAL) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      try {
        const result = condition()
        if (result) {
          resolve(result)
          return
        }
      } catch (error) {
        reject(error)
        return
      }

      if (Date.now() - start >= timeout) {
        reject(new Error('Engine readiness timeout'))
        return
      }

      setTimeout(check, interval)
    }
    check()
  })
}

function ensureScriptElement(src, dataLib) {
  let script = document.querySelector(`script[data-lib="${dataLib}"]`)
  if (!script) {
    script = document.createElement('script')
    script.src = src
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.dataset.lib = dataLib
    document.head.appendChild(script)
  }
  return script
}

function removeScriptElement(dataLib) {
  const script = document.querySelector(`script[data-lib="${dataLib}"]`)
  if (script?.parentElement) {
    script.parentElement.removeChild(script)
  }
}

async function loadImageTracerWithRetry(attempt = 1) {
  const sourceIndex = Math.min(attempt - 1, IMAGE_TRACER_SOURCES.length - 1)
  const scriptSrc = IMAGE_TRACER_SOURCES[sourceIndex] || IMAGETRACER_SRC

  try {
    delete window.ImageTracer
  } catch (error) {
    console.warn('ImageTracer 초기화에 실패했습니다.', error)
  }

  removeScriptElement('imagetracer')
  const script = ensureScriptElement(scriptSrc, 'imagetracer')
  if (!script) {
    throw new Error('SVG 변환 스크립트를 불러오지 못했습니다.')
  }

  return new Promise((resolve, reject) => {
    const onScriptError = (event) => {
      script.removeEventListener('error', onScriptError)
      reject(new Error(`SVG 변환 스크립트 로딩 오류 (${event?.type || 'error'})`))
    }

    script.addEventListener('error', onScriptError, { once: true })

    waitForCondition(() => window.ImageTracer && typeof window.ImageTracer.imagedataToSVG === 'function')
      .then(() => {
        script.removeEventListener('error', onScriptError)
        resolve(window.ImageTracer)
      })
      .catch((error) => {
        script.removeEventListener('error', onScriptError)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
  })
}

export async function bootstrapEngine() {
  if (window.ImageTracer && typeof window.ImageTracer.imagedataToSVG === 'function') {
    return window.ImageTracer
  }

  if (!imageTracerPromise) {
    imageTracerPromise = (async () => {
      for (let attempt = 1; attempt <= IMAGE_TRACER_MAX_RETRIES; attempt += 1) {
        try {
          const engine = await loadImageTracerWithRetry(attempt)
          if (engine && typeof engine.imagedataToSVG === 'function') {
            return engine
          }
        } catch (error) {
          if (attempt >= IMAGE_TRACER_MAX_RETRIES) {
            throw error instanceof Error ? error : new Error(String(error))
          }
          await wait(IMAGE_TRACER_RETRY_DELAY * attempt, IMAGE_TRACER_RETRY_JITTER)
        }
      }
      throw new Error('SVG 변환 엔진을 초기화하지 못했습니다.')
    })().finally(() => {
      imageTracerPromise = null
    })
  }

  return imageTracerPromise
}

export function getEngine() {
  if (window.ImageTracer && typeof window.ImageTracer.imagedataToSVG === 'function') {
    return window.ImageTracer
  }
  return null
}

export default async function initializeEngine() {
  return bootstrapEngine()
}
