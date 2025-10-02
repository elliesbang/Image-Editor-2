const MAX_FILES = 50
const SAMPLE_IMAGE_URL =
  'https://images.unsplash.com/photo-1618005198919-d3d4b5a92eee?auto=format&fit=crop&w=1600&q=80'

const state = {
  uploads: [],
  results: [],
  selectedUploads: new Set(),
  selectedResults: new Set(),
  preview: null,
  processing: false,
  analysis: new Map(),
}

const elements = {
  fileInput: document.querySelector('#fileInput'),
  dropZone: document.querySelector('[data-role="dropzone"]'),
  uploadList: document.querySelector('#uploadList'),
  resultList: document.querySelector('#resultList'),
  status: document.querySelector('[data-role="status"]'),
  heroTriggers: document.querySelectorAll('[data-trigger="file"]'),
  sampleButton: document.querySelector('[data-action="load-sample"]'),
  operationButtons: document.querySelectorAll('[data-operation]'),
  resizeInput: document.querySelector('#resizeWidth'),
  resultDownloadButtons: document.querySelectorAll('[data-result-download]'),
  svgButton: document.querySelector('[data-result-operation="svg"]'),
  uploadSelectAll: document.querySelector('[data-action="upload-select-all"]'),
  uploadClear: document.querySelector('[data-action="upload-clear"]'),
  uploadDeleteSelected: document.querySelector('[data-action="upload-delete-selected"]'),
  resultSelectAll: document.querySelector('[data-action="result-select-all"]'),
  resultClear: document.querySelector('[data-action="result-clear"]'),
  resultDeleteSelected: document.querySelector('[data-action="result-delete-selected"]'),
  previewCanvas: document.querySelector('#previewCanvas'),
  previewEmpty: document.querySelector('[data-role="preview-empty"]'),
  previewHint: document.querySelector('[data-role="preview-hint"]'),
  previewMeta: document.querySelector('[data-role="preview-meta"]'),
  analysisPanel: document.querySelector('[data-role="analysis-panel"]'),
  analysisHint: document.querySelector('[data-role="analysis-hint"]'),
  analysisHeadline: document.querySelector('[data-role="analysis-title"]'),
  analysisKeywords: document.querySelector('[data-role="analysis-keywords"]'),
  analysisSummary: document.querySelector('[data-role="analysis-summary"]'),
  analysisButton: document.querySelector('[data-action="analyze-current"]'),
  loginModal: document.querySelector('[data-role="login-modal"]'),
  loginEmailForm: document.querySelector('[data-role="login-email-form"]'),
  cookieBanner: document.querySelector('[data-role="cookie-banner"]'),
  cookieAnalytics: document.querySelector('[data-role="cookie-analytics"]'),
  cookieMarketing: document.querySelector('[data-role="cookie-marketing"]'),
  cookieConfirm: document.querySelector('[data-role="cookie-confirm"]'),
  cookieAcceptButton: document.querySelector('[data-action="accept-cookies"]'),
}

elements.previewCtx = elements.previewCanvas?.getContext('2d') ?? null

let statusTimer = null

function uuid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${sizes[i]}`
}

function baseName(filename) {
  return filename.replace(/\.[^/.]+$/, '')
}

function setStatus(message, tone = 'info', duration = 3200) {
  if (!elements.status) return

  window.clearTimeout(statusTimer)
  elements.status.textContent = message
  elements.status.dataset.tone = tone
  elements.status.classList.remove('status--hidden')

  if (duration > 0) {
    statusTimer = window.setTimeout(() => {
      elements.status?.classList.add('status--hidden')
    }, duration)
  }
}

function toggleProcessing(isProcessing) {
  state.processing = isProcessing
  elements.operationButtons?.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return
    button.disabled = isProcessing || (button.dataset.operation !== 'svg' && state.selectedUploads.size === 0)
  })
  const resizeButton = document.querySelector('[data-operation="resize"]')
  if (resizeButton instanceof HTMLButtonElement) {
    const hasResizeSelection = state.selectedUploads.size > 0 || state.selectedResults.size > 0
    const hasResizeValue =
      elements.resizeInput instanceof HTMLInputElement && elements.resizeInput.value.trim()
    resizeButton.disabled = isProcessing || !hasResizeSelection || !hasResizeValue
  }

  if (elements.analysisButton instanceof HTMLButtonElement) {
    elements.analysisButton.disabled = isProcessing
  }
}

function updateOperationAvailability() {
  if (state.processing) return
  const hasUploadSelection = state.selectedUploads.size > 0
  const hasResultSelection = state.selectedResults.size > 0
  const hasResizeSelection = hasUploadSelection || hasResultSelection
  const resizeValue =
    elements.resizeInput instanceof HTMLInputElement ? elements.resizeInput.value.trim() : ''

  elements.operationButtons?.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return
    const operation = button.dataset.operation
    if (operation === 'svg') return
    if (operation === 'resize') {
      button.disabled = !hasResizeSelection || !resizeValue
    } else {
      button.disabled = !hasUploadSelection
    }
  })
}

function updateResultActionAvailability() {
  const selectedCount = state.selectedResults.size
  const hasResults = state.results.length > 0
  elements.resultDownloadButtons?.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return
    const mode = button.dataset.resultDownload
    if (mode === 'all') {
      button.disabled = !hasResults
    } else {
      button.disabled = selectedCount === 0
    }
  })
  if (elements.resultDeleteSelected instanceof HTMLButtonElement) {
    elements.resultDeleteSelected.disabled = selectedCount === 0
  }
}

function openLoginModal() {
  if (!elements.loginModal) return
  elements.loginModal.classList.add('is-active')
  elements.loginModal.setAttribute('aria-hidden', 'false')
  document.body.classList.add('is-modal-open')
  const emailInput = elements.loginEmailForm?.querySelector('input[name="email"]')
  if (emailInput instanceof HTMLInputElement) {
    window.requestAnimationFrame(() => emailInput.focus())
  }
}

function closeLoginModal() {
  if (!elements.loginModal) return
  elements.loginModal.classList.remove('is-active')
  elements.loginModal.setAttribute('aria-hidden', 'true')
  document.body.classList.remove('is-modal-open')
}

function handleGoogleLogin() {
  closeLoginModal()
  setStatus('Google 로그인 연동은 준비 중입니다. 곧 지원될 예정이에요!', 'info')
}

function handleEmailLogin(event) {
  event.preventDefault()
  if (!(elements.loginEmailForm instanceof HTMLFormElement)) return
  const formData = new FormData(elements.loginEmailForm)
  const email = String(formData.get('email') || '').trim()
  if (!email) {
    setStatus('이메일을 입력해주세요.', 'danger')
    return
  }
  elements.loginEmailForm.reset()
  closeLoginModal()
  setStatus(`${email} 주소로 1회용 로그인 코드를 발송할 준비가 완료되었습니다.`, 'success')
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && elements.loginModal?.classList.contains('is-active')) {
    closeLoginModal()
  }
}

function showCookieBanner() {
  if (!elements.cookieBanner) return
  elements.cookieBanner.classList.add('is-visible')
  elements.cookieBanner.setAttribute('aria-hidden', 'false')
}

function hideCookieBanner() {
  if (!elements.cookieBanner) return
  elements.cookieBanner.classList.remove('is-visible')
  elements.cookieBanner.setAttribute('aria-hidden', 'true')
}

function readCookieConsent() {
  try {
    const value = window.localStorage.getItem('cookieConsent')
    if (!value) return null
    return JSON.parse(value)
  } catch (error) {
    console.warn('쿠키 동의 정보를 불러오지 못했습니다.', error)
    return null
  }
}

function writeCookieConsent(consent) {
  try {
    window.localStorage.setItem('cookieConsent', JSON.stringify(consent))
  } catch (error) {
    console.warn('쿠키 동의 정보를 저장하지 못했습니다.', error)
  }
}

function updateCookieAcceptState() {
  const confirmChecked = elements.cookieConfirm instanceof HTMLInputElement && elements.cookieConfirm.checked
  if (elements.cookieAcceptButton instanceof HTMLButtonElement) {
    elements.cookieAcceptButton.disabled = !confirmChecked
  }
}

function initCookieBanner() {
  if (!elements.cookieBanner) return
  const savedConsent = readCookieConsent()

  if (elements.cookieAnalytics instanceof HTMLInputElement && savedConsent) {
    elements.cookieAnalytics.checked = Boolean(savedConsent.analytics)
  }

  if (elements.cookieMarketing instanceof HTMLInputElement && savedConsent) {
    elements.cookieMarketing.checked = Boolean(savedConsent.marketing)
  }

  if (elements.cookieConfirm instanceof HTMLInputElement) {
    elements.cookieConfirm.checked = Boolean(savedConsent)
  }

  if (!savedConsent) {
    showCookieBanner()
  } else {
    hideCookieBanner()
  }

  updateCookieAcceptState()

  if (elements.cookieConfirm instanceof HTMLInputElement) {
    elements.cookieConfirm.addEventListener('change', updateCookieAcceptState)
  }

  if (elements.cookieAcceptButton instanceof HTMLButtonElement) {
    elements.cookieAcceptButton.addEventListener('click', () => {
      if (!(elements.cookieConfirm instanceof HTMLInputElement) || !elements.cookieConfirm.checked) {
        setStatus('쿠키 정책에 동의해야 계속 이용할 수 있습니다.', 'danger')
        return
      }
      const consent = {
        essential: true,
        analytics: elements.cookieAnalytics instanceof HTMLInputElement ? elements.cookieAnalytics.checked : false,
        marketing: elements.cookieMarketing instanceof HTMLInputElement ? elements.cookieMarketing.checked : false,
        timestamp: new Date().toISOString(),
      }
      writeCookieConsent(consent)
      hideCookieBanner()
      setStatus('쿠키 설정이 저장되었습니다.', 'success')
    })
  }
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = (event) => reject(event)
    reader.readAsDataURL(file)
  })
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = (event) => reject(event)
    reader.readAsDataURL(blob)
  })
}

async function ensureDataUrl(src) {
  if (typeof src === 'string' && src.startsWith('data:')) {
    return src
  }
  const response = await fetch(src)
  if (!response.ok) throw new Error('이미지를 불러오지 못했습니다.')
  const blob = await response.blob()
  const dataUrl = await blobToDataUrl(blob)
  if (typeof dataUrl !== 'string') throw new Error('이미지를 변환하는 중 문제가 발생했습니다.')
  return dataUrl
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = (error) => reject(error)
    image.src = src
  })
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  return canvas
}

async function canvasFromDataUrl(dataUrl) {
  const image = await loadImage(dataUrl)
  const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('캔버스를 초기화할 수 없습니다.')
  ctx.drawImage(image, 0, 0)
  return { canvas, ctx }
}

function sampleBackgroundColor(imageData, width, height) {
  const { data } = imageData
  const sampleSize = Math.max(1, Math.floor(Math.max(width, height) * 0.05))
  let totalR = 0
  let totalG = 0
  let totalB = 0
  let count = 0

  function addSample(x, y) {
    const idx = (y * width + x) * 4
    totalR += data[idx]
    totalG += data[idx + 1]
    totalB += data[idx + 2]
    count += 1
  }

  for (let y = 0; y < sampleSize; y += 1) {
    for (let x = 0; x < sampleSize; x += 1) addSample(x, y)
    for (let x = width - sampleSize; x < width; x += 1) addSample(x, y)
  }

  for (let y = height - sampleSize; y < height; y += 1) {
    for (let x = 0; x < sampleSize; x += 1) addSample(x, y)
    for (let x = width - sampleSize; x < width; x += 1) addSample(x, y)
  }

  if (count === 0) return { r: 255, g: 255, b: 255 }
  return {
    r: Math.round(totalR / count),
    g: Math.round(totalG / count),
    b: Math.round(totalB / count),
  }
}

function colorDistance(r, g, b, ref) {
  return Math.abs(r - ref.r) + Math.abs(g - ref.g) + Math.abs(b - ref.b)
}

function colorDistanceSq(r, g, b, ref) {
  const dr = r - ref.r
  const dg = g - ref.g
  const db = b - ref.b
  return dr * dr + dg * dg + db * db
}

function analyzeBackground(imageData, width, height) {
  const { data } = imageData
  const step = Math.max(1, Math.floor(Math.min(width, height) / 48))
  const samples = []

  const addSample = (x, y) => {
    const idx = (y * width + x) * 4
    const alpha = data[idx + 3]
    if (alpha <= 255) {
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2], alpha })
    }
  }

  for (let x = 0; x < width; x += step) {
    addSample(x, 0)
    addSample(x, height - 1)
  }

  for (let y = 0; y < height; y += step) {
    addSample(0, y)
    addSample(width - 1, y)
  }

  if (samples.length === 0) {
    return {
      meanColor: { r: 255, g: 255, b: 255 },
      tolerance: 60,
      toleranceSq: 3600,
      relaxedTolerance: 95,
      relaxedToleranceSq: 9025,
    }
  }

  let totalR = 0
  let totalG = 0
  let totalB = 0
  for (const sample of samples) {
    totalR += sample.r
    totalG += sample.g
    totalB += sample.b
  }

  const meanColor = {
    r: totalR / samples.length,
    g: totalG / samples.length,
    b: totalB / samples.length,
  }

  let sumDistance = 0
  for (const sample of samples) {
    sumDistance += Math.sqrt(colorDistanceSq(sample.r, sample.g, sample.b, meanColor))
  }
  const meanDistance = sumDistance / samples.length

  let variance = 0
  for (const sample of samples) {
    const distance = Math.sqrt(colorDistanceSq(sample.r, sample.g, sample.b, meanColor))
    variance += (distance - meanDistance) ** 2
  }
  const stdDev = Math.sqrt(variance / Math.max(1, samples.length - 1))

  const tolerance = Math.min(185, Math.max(38, meanDistance + stdDev * 2.4 + 12))
  const relaxedTolerance = tolerance + 35

  return {
    meanColor,
    tolerance,
    toleranceSq: tolerance * tolerance,
    relaxedTolerance,
    relaxedToleranceSq: relaxedTolerance * relaxedTolerance,
  }
}

function applyBackgroundRemoval(imageData, width, height) {
  const { data } = imageData
  const stats = analyzeBackground(imageData, width, height)
  const pixelCount = width * height
  const visited = new Uint8Array(pixelCount)
  const backgroundMask = new Uint8Array(pixelCount)
  const queue = []

  const shouldBeBackground = (index) => {
    const offset = index * 4
    const alpha = data[offset + 3]
    if (alpha <= 18) return true
    const distanceSq = colorDistanceSq(data[offset], data[offset + 1], data[offset + 2], stats.meanColor)
    if (distanceSq <= stats.toleranceSq) return true
    return distanceSq <= stats.relaxedToleranceSq && alpha <= 235
  }

  const trySeed = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const index = y * width + x
    if (visited[index]) return
    visited[index] = 1
    if (shouldBeBackground(index)) {
      backgroundMask[index] = 1
      queue.push(index)
    }
  }

  for (let x = 0; x < width; x += 1) {
    trySeed(x, 0)
    trySeed(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    trySeed(0, y)
    trySeed(width - 1, y)
  }

  let head = 0
  while (head < queue.length) {
    const index = queue[head]
    head += 1
    const x = index % width
    const y = Math.floor(index / width)

    trySeed(x - 1, y)
    trySeed(x + 1, y)
    trySeed(x, y - 1)
    trySeed(x, y + 1)
  }

  for (let i = 0; i < pixelCount; i += 1) {
    if (backgroundMask[i]) {
      data[i * 4 + 3] = 0
    }
  }

  const neighborOffsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (backgroundMask[index]) continue
      let backgroundNeighbors = 0
      for (const [dx, dy] of neighborOffsets) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        if (backgroundMask[ny * width + nx]) backgroundNeighbors += 1
      }
      if (backgroundNeighbors > 0) {
        const alphaIndex = index * 4 + 3
        const reduction = Math.min(0.65, backgroundNeighbors * 0.12)
        data[alphaIndex] = Math.max(0, Math.round(data[alphaIndex] * (1 - reduction)))
      }
    }
  }

  for (let i = 0; i < pixelCount; i += 1) {
    const alphaIndex = i * 4 + 3
    if (data[alphaIndex] <= 12) {
      data[alphaIndex] = 0
    }
  }

  return imageData
}

function findBoundingBox(imageData, width, height, alphaThreshold = 12, tolerance = 75) {
  const { data } = imageData
  const background = sampleBackgroundColor(imageData, width, height)
  let top = height
  let left = width
  let right = 0
  let bottom = 0
  let hasContent = false

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4
      const alpha = data[idx + 3]
      const distance = colorDistance(data[idx], data[idx + 1], data[idx + 2], background)
      if (alpha > alphaThreshold || distance > tolerance) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
        hasContent = true
      }
    }
  }

  if (!hasContent) {
    return { top: 0, left: 0, right: width - 1, bottom: height - 1 }
  }

  return { top, left, right, bottom }
}

function cropCanvas(canvas, ctx, bounds) {
  const cropWidth = bounds.right - bounds.left + 1
  const cropHeight = bounds.bottom - bounds.top + 1
  const cropped = createCanvas(cropWidth, cropHeight)
  const croppedCtx = cropped.getContext('2d')
  if (!croppedCtx) throw new Error('크롭 캔버스를 초기화할 수 없습니다.')
  const imageData = ctx.getImageData(bounds.left, bounds.top, cropWidth, cropHeight)
  croppedCtx.putImageData(imageData, 0, 0)
  return { canvas: cropped, ctx: croppedCtx }
}

function applyBoxBlur(imageData, width, height) {
  const { data } = imageData
  const output = new Uint8ClampedArray(data.length)
  const kernelSize = 3
  const half = Math.floor(kernelSize / 2)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let totalR = 0
      let totalG = 0
      let totalB = 0
      let totalA = 0
      let count = 0

      for (let ky = -half; ky <= half; ky += 1) {
        for (let kx = -half; kx <= half; kx += 1) {
          const nx = Math.min(width - 1, Math.max(0, x + kx))
          const ny = Math.min(height - 1, Math.max(0, y + ky))
          const idx = (ny * width + nx) * 4
          totalR += data[idx]
          totalG += data[idx + 1]
          totalB += data[idx + 2]
          totalA += data[idx + 3]
          count += 1
        }
      }

      const destIdx = (y * width + x) * 4
      output[destIdx] = Math.round(totalR / count)
      output[destIdx + 1] = Math.round(totalG / count)
      output[destIdx + 2] = Math.round(totalB / count)
      output[destIdx + 3] = Math.round(totalA / count)
    }
  }

  data.set(output)
  return imageData
}

function resizeCanvas(canvas, width) {
  const ratio = width / canvas.width
  const height = Math.round(canvas.height * ratio)
  const resized = createCanvas(width, height)
  const ctx = resized.getContext('2d')
  if (!ctx) throw new Error('리사이즈 캔버스를 초기화할 수 없습니다.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height)
  return { canvas: resized, ctx }
}

function canvasToBlob(canvas, type = 'image/png', quality = 0.95) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('이미지를 내보내는 중 오류가 발생했습니다.'))
        return
      }
      resolve(blob)
    }, type, quality)
  })
}

function ensureGridState(listElement, length) {
  if (!listElement) return
  listElement.classList.toggle('is-empty', length === 0)
}

function resolveCheckbox(event, selector) {
  const target = event.target
  if (target instanceof HTMLInputElement && target.matches(selector)) {
    return target
  }
  if (target instanceof HTMLElement) {
    const label = target.closest('label')
    if (label) {
      const input = label.querySelector(selector)
      if (input instanceof HTMLInputElement) {
        return input
      }
    }
  }
  return null
}

function getAnalysisKey(target) {
  if (!target) return null
  return `${target.type}:${target.id}`
}

function removeAnalysisFor(type, id) {
  state.analysis.delete(`${type}:${id}`)
}

function displayAnalysisFor(target) {
  if (
    !elements.analysisPanel ||
    !elements.analysisHint ||
    !elements.analysisKeywords ||
    !elements.analysisSummary ||
    !elements.analysisHeadline
  )
    return

  const button = elements.analysisButton instanceof HTMLButtonElement ? elements.analysisButton : null
  if (button) {
    button.disabled = state.processing
  }

  const resetView = (hintText) => {
    elements.analysisPanel.classList.remove('analysis--has-data')
    elements.analysisHint.textContent = hintText
    elements.analysisHeadline.textContent = ''
    elements.analysisKeywords.innerHTML = ''
    elements.analysisSummary.textContent = ''
  }

  if (!target) {
    resetView('이미지를 업로드하고 “분석 실행” 버튼으로 25개의 SEO 키워드를 받아보세요.')
    return
  }

  const data = state.analysis.get(getAnalysisKey(target))

  if (!data) {
    resetView('“분석 실행” 버튼을 눌러 25개의 키워드와 제목을 생성해 보세요.')
    return
  }

  elements.analysisPanel.classList.add('analysis--has-data')
  elements.analysisHint.textContent = ''
  elements.analysisHeadline.textContent = data.title || ''
  elements.analysisKeywords.innerHTML = data.keywords.map((keyword) => `<li>${keyword}</li>`).join('')
  elements.analysisSummary.textContent = data.summary
}

function rgbToHsl(r, g, b) {
  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255
  const max = Math.max(rNorm, gNorm, bNorm)
  const min = Math.min(rNorm, gNorm, bNorm)
  const delta = max - min

  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)

    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0)
        break
      case gNorm:
        h = (bNorm - rNorm) / delta + 2
        break
      default:
        h = (rNorm - gNorm) / delta + 4
        break
    }

    h *= 60
  }

  return { h, s, l }
}

function getColorKeyword(h, s, l) {
  if (Number.isNaN(h) || Number.isNaN(s) || Number.isNaN(l)) return '무채색'

  if (s <= 0.18) {
    if (l >= 0.82) return '밝은 회색'
    if (l <= 0.2) return '어두운 회색'
    return '중간 회색'
  }

  if (h < 15 || h >= 345) return '레드 계열'
  if (h < 45) return '오렌지 계열'
  if (h < 65) return '옐로우 계열'
  if (h < 95) return '라임 계열'
  if (h < 150) return '그린 계열'
  if (h < 180) return '민트 계열'
  if (h < 210) return '터키석 계열'
  if (h < 255) return '블루 계열'
  if (h < 285) return '인디고 계열'
  if (h < 320) return '퍼플 계열'
  return '마젠타 계열'
}

function describeBrightness(value) {
  const normalized = value * 100
  if (normalized >= 80) return '매우 밝음'
  if (normalized >= 60) return '밝음'
  if (normalized <= 18) return '매우 어두움'
  if (normalized <= 35) return '어두움'
  return '중간 밝기'
}

function describeSaturation(value) {
  if (value >= 0.65) return '고채도'
  if (value >= 0.45) return '중간 채도'
  if (value >= 0.2) return '저채도'
  return '무채색'
}

function greatestCommonDivisor(a, b) {
  const x = Math.abs(Math.round(a))
  const y = Math.abs(Math.round(b))
  if (y === 0) return x || 1
  return greatestCommonDivisor(y, x % y)
}

function formatAspectRatio(width, height) {
  if (!width || !height) return '1:1'
  const ratio = width / height
  const presets = [
    { label: '1:1', value: 1 },
    { label: '5:4', value: 5 / 4 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:2', value: 3 / 2 },
    { label: '16:10', value: 16 / 10 },
    { label: '16:9', value: 16 / 9 },
    { label: '21:9', value: 21 / 9 },
    { label: '2:1', value: 2 },
    { label: '9:16', value: 9 / 16 },
    { label: '4:5', value: 4 / 5 },
    { label: '3:4', value: 3 / 4 },
  ]

  let best = presets[0]
  let bestDiff = Math.abs(ratio - presets[0].value)

  for (const preset of presets) {
    const diff = Math.abs(ratio - preset.value)
    if (diff < bestDiff) {
      best = preset
      bestDiff = diff
    }
  }

  if (bestDiff <= 0.08) {
    return best.label
  }

  const divisor = greatestCommonDivisor(width, height) || 1
  let simplifiedW = Math.round(width / divisor)
  let simplifiedH = Math.round(height / divisor)

  while ((simplifiedW > 20 || simplifiedH > 20) && simplifiedW > 0 && simplifiedH > 0) {
    simplifiedW = Math.round(simplifiedW / 2)
    simplifiedH = Math.round(simplifiedH / 2)
  }

  simplifiedW = Math.max(1, simplifiedW)
  simplifiedH = Math.max(1, simplifiedH)

  return `${simplifiedW}:${simplifiedH}`
}

function prepareAnalysisSurface(sourceCanvas, sourceCtx) {
  const largestSide = Math.max(sourceCanvas.width, sourceCanvas.height)
  if (largestSide <= 512) {
    const context = sourceCtx ?? sourceCanvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('분석용 캔버스를 초기화할 수 없습니다.')
    return {
      canvas: sourceCanvas,
      ctx: context,
    }
  }

  const scale = 512 / largestSide
  const width = Math.max(1, Math.round(sourceCanvas.width * scale))
  const height = Math.max(1, Math.round(sourceCanvas.height * scale))
  const scaledCanvas = createCanvas(width, height)
  const scaledCtx = scaledCanvas.getContext('2d', { willReadFrequently: true })
  if (!scaledCtx) throw new Error('분석용 캔버스를 초기화할 수 없습니다.')
  scaledCtx.imageSmoothingEnabled = true
  scaledCtx.imageSmoothingQuality = 'high'
  scaledCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, width, height)
  return { canvas: scaledCanvas, ctx: scaledCtx }
}

function analyzeCanvasForKeywords(canvas, ctx) {
  const width = canvas.width
  const height = canvas.height
  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData
  const sampleStep = Math.max(1, Math.floor(Math.sqrt((width * height) / 7500)))

  let sampled = 0
  let opaqueCount = 0
  let transparentCount = 0
  let brightnessSum = 0
  let saturationSum = 0
  let minBrightness = 1
  let maxBrightness = 0
  const colorCounts = new Map()

  let massX = 0
  let massY = 0
  let warmCount = 0
  let coolCount = 0
  let neutralHueCount = 0
  let highlightCount = 0
  let shadowCount = 0
  let alphaSum = 0
  let edgeBrightnessSum = 0
  let edgeSamples = 0
  let centerBrightnessSum = 0
  let centerSamples = 0
  let textureScore = 0
  let textureSamples = 0

  const leftEdge = width * 0.1
  const rightEdge = width * 0.9
  const topEdge = height * 0.1
  const bottomEdge = height * 0.9
  const centerLeft = width * 0.3
  const centerRight = width * 0.7
  const centerTop = height * 0.3
  const centerBottom = height * 0.7

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const idx = (y * width + x) * 4
      const alpha = data[idx + 3] / 255
      sampled += 1

      if (alpha <= 0.05) {
        transparentCount += 1
        continue
      }

      opaqueCount += 1

      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const { h, s, l } = rgbToHsl(r, g, b)

      brightnessSum += l
      saturationSum += s
      if (l < minBrightness) minBrightness = l
      if (l > maxBrightness) maxBrightness = l

      massX += x
      massY += y
      alphaSum += alpha

      if (s > 0.18) {
        if (h < 60 || h >= 300) warmCount += 1
        else if (h >= 60 && h < 210) coolCount += 1
        else neutralHueCount += 1
      } else {
        neutralHueCount += 1
      }

      if (l >= 0.85) highlightCount += 1
      if (l <= 0.2) shadowCount += 1

      const isEdge = x <= leftEdge || x >= rightEdge || y <= topEdge || y >= bottomEdge
      if (isEdge) {
        edgeBrightnessSum += l
        edgeSamples += 1
      } else if (x >= centerLeft && x <= centerRight && y >= centerTop && y <= centerBottom) {
        centerBrightnessSum += l
        centerSamples += 1
      }

      const colorName = getColorKeyword(h, s, l)
      colorCounts.set(colorName, (colorCounts.get(colorName) || 0) + 1)

      if (x + sampleStep < width) {
        const nx = Math.min(width - 1, x + sampleStep)
        const neighborIdx = (y * width + nx) * 4
        const neighborAlpha = data[neighborIdx + 3] / 255
        if (neighborAlpha > 0.05) {
          const { l: neighborL } = rgbToHsl(data[neighborIdx], data[neighborIdx + 1], data[neighborIdx + 2])
          textureScore += Math.abs(l - neighborL)
          textureSamples += 1
        }
      }

      if (y + sampleStep < height) {
        const ny = Math.min(height - 1, y + sampleStep)
        const neighborIdx = (ny * width + x) * 4
        const neighborAlpha = data[neighborIdx + 3] / 255
        if (neighborAlpha > 0.05) {
          const { l: neighborL } = rgbToHsl(data[neighborIdx], data[neighborIdx + 1], data[neighborIdx + 2])
          textureScore += Math.abs(l - neighborL)
          textureSamples += 1
        }
      }
    }
  }

  if (opaqueCount === 0) {
    const baseKeywords = ['투명 이미지', '레이어 합성용', 'PNG 투명 배경', '클리핑 마스크 추천', '미리캔버스 투명 자산']
    const extraKeywords = [
      '디지털 디자인 자산',
      '고해상도 그래픽',
      '브랜드 키비주얼',
      '마케팅 배너 제안',
      'SNS 썸네일 소재',
      '프레젠테이션 표지',
      '이커머스 상품 배경',
      '블로그 썸네일 디자인',
      '캠페인 메인 비주얼',
      '온라인 광고 소재',
      '시각적 포커스 강조',
      '크리에이티브 무드보드',
      '브랜드 스토리텔링',
      '콘텐츠 제작 추천',
      '트렌디 비주얼 스타일',
      '제품 소개 비주얼',
      '캠페인 키메시지',
      '크리에이티브 아트워크',
      '웹페이지 히어로 이미지',
      'SNS 프로모션 비주얼'
    ]
    const combined = [...baseKeywords, ...extraKeywords]
    while (combined.length < 25) {
      combined.push(`크리에이티브 키워드 ${combined.length + 1}`)
    }
    return {
      keywords: combined.slice(0, 25),
      summary: '이미지 대부분이 투명 픽셀로 구성되어 있어 레이어 합성이나 오버레이 용도로 적합합니다.',
      title: '투명 배경 레이어 자산',
    }
  }

  const avgBrightness = brightnessSum / opaqueCount
  const avgSaturation = saturationSum / opaqueCount
  const transparencyRatio = transparentCount / sampled
  const avgAlpha = alphaSum / opaqueCount

  const orientation = width > height * 1.2 ? '가로형' : height > width * 1.2 ? '세로형' : '균형형'
  const brightnessLabel = describeBrightness(avgBrightness)
  const saturationLabel = describeSaturation(avgSaturation)
  const ratioLabel = formatAspectRatio(width, height)
  const contrastRange = maxBrightness - minBrightness

  const temperatureLabel =
    warmCount > coolCount * 1.2
      ? '따뜻한 톤'
      : coolCount > warmCount * 1.2
        ? '차가운 톤'
        : '중성 톤'

  const textureValue = textureSamples > 0 ? textureScore / textureSamples : 0
  const textureLabel =
    textureValue > 0.12
      ? '디테일 질감 강조'
      : textureValue < 0.06
        ? '부드러운 그라데이션'
        : '균형 잡힌 질감'

  const sortedColors = Array.from(colorCounts.entries()).sort((a, b) => b[1] - a[1])
  const topColors = sortedColors.slice(0, 5).map(([name]) => name)
  const paletteVariety = colorCounts.size
  const dominantShare = sortedColors.length > 0 ? sortedColors[0][1] / opaqueCount : 0
  const paletteLabel =
    paletteVariety >= 6
      ? '다채로운 컬러 믹스'
      : dominantShare >= 0.65
        ? '단색 중심 팔레트'
        : '균형 잡힌 팔레트'

  const centroidX = massX / opaqueCount || width / 2
  const centroidY = massY / opaqueCount || height / 2
  const normalizedX = centroidX / width
  const normalizedY = centroidY / height

  const edgeContrast =
    edgeSamples > 0 && centerSamples > 0
      ? Math.abs(edgeBrightnessSum / edgeSamples - centerBrightnessSum / centerSamples)
      : 0
  const highlightRatio = highlightCount / opaqueCount
  const shadowRatio = shadowCount / opaqueCount

  const keywords = []
  const used = new Set()
  const addKeyword = (value) => {
    const cleaned = typeof value === 'string' ? value.trim() : ''
    if (!cleaned || used.has(cleaned) || keywords.length >= 40) return
    used.add(cleaned)
    keywords.push(cleaned)
  }

  const orientationKeywordMap = {
    가로형: '가로형 구도',
    세로형: '세로형 구도',
    균형형: '정방형 구도',
  }
  addKeyword(orientationKeywordMap[orientation] || `${orientation} 구도`)
  addKeyword(`비율 ${ratioLabel}`)

  const brightnessKeywordMap = {
    '매우 밝음': '강한 하이라이트 조명',
    밝음: '밝은 조명감',
    '중간 밝기': '균형 잡힌 조명',
    어두움: '차분한 어둠',
    '매우 어두움': '딥한 무드',
  }
  addKeyword(brightnessKeywordMap[brightnessLabel] || `${brightnessLabel} 조명`)

  const saturationKeywordMap = {
    고채도: '선명한 고채도 팔레트',
    '중간 채도': '중간 채도 팔레트',
    저채도: '저채도 미니멀',
    무채색: '모노톤 팔레트',
  }
  addKeyword(saturationKeywordMap[saturationLabel] || `${saturationLabel} 팔레트`)

  const contrastKeyword =
    contrastRange > 0.55 ? '강한 대비 연출' : contrastRange < 0.2 ? '부드러운 대비' : '균형 대비'
  addKeyword(contrastKeyword)

  addKeyword(`${temperatureLabel} 감성`)
  addKeyword(textureLabel)
  addKeyword(paletteLabel)

  if (transparencyRatio >= 0.2) addKeyword('투명 배경 디자인')
  else addKeyword('풀 배경 구성')

  if (avgAlpha < 0.75 && transparencyRatio > 0.05) addKeyword('반투명 레이어 효과')

  if (edgeContrast > 0.12) addKeyword('배경-피사체 대비 선명')
  else addKeyword('부드러운 배경 전환')

  if (highlightRatio > 0.25) addKeyword('밝은 하이라이트 영역')
  if (shadowRatio > 0.2) addKeyword('깊은 그림자 디테일')

  if (highlightRatio > 0.45) addKeyword('글로시 하이라이트 느낌')
  if (shadowRatio > 0.35) addKeyword('딥한 섀도우 무드')

  if (normalizedX < 0.35) addKeyword('좌측 포커스 구성')
  else if (normalizedX > 0.65) addKeyword('우측 포커스 구성')
  else addKeyword('중앙 정렬 피사체')

  if (normalizedY < 0.4) addKeyword('상단 집중형 레이아웃')
  else if (normalizedY > 0.6) addKeyword('하단 집중형 레이아웃')
  else addKeyword('중앙 수직 균형')

  if (Math.abs(warmCount - coolCount) / Math.max(1, opaqueCount) < 0.1) {
    addKeyword('중성 컬러 밸런스')
  } else if (warmCount > coolCount) {
    addKeyword('따뜻한 팔레트')
  } else {
    addKeyword('차가운 팔레트')
  }

  topColors.slice(0, 3).forEach((color, index) => {
    const base = color.includes('계열') ? color.replace(' 계열', ' 톤') : `${color} 톤`
    if (index === 0) {
      addKeyword(`${base} 메인 톤`)
      addKeyword(`${base} 포인트 컬러`)
      addKeyword(`${base} 하이라이트`)
    } else if (index === 1) {
      addKeyword(`보조 색상 ${base}`)
      addKeyword(`컬러 조합 ${topColors[0]} + ${color}`)
    } else {
      addKeyword(`악센트 컬러 ${base}`)
    }
  })

  if (topColors.length >= 2) {
    addKeyword(`팔레트 조합 ${topColors[0]} & ${topColors[1]}`)
  }

  const marketingKeywords = [
    '브랜드 키비주얼',
    '마케팅 배너 제안',
    'SNS 썸네일 소재',
    '프레젠테이션 표지',
    '이커머스 상품 배경',
    '블로그 썸네일 디자인',
    '캠페인 메인 비주얼',
    '미리캔버스 템플릿 추천',
    '온라인 광고 소재',
    '시각적 포커스 강조',
    '크리에이티브 무드보드',
    '브랜드 스토리텔링',
  ]
  marketingKeywords.forEach(addKeyword)

  const fallbackKeywords = [
    '디지털 디자인 자산',
    '고해상도 그래픽',
    '트렌디 비주얼 스타일',
    '콘텐츠 제작 추천',
    '제품 소개 비주얼',
    '캠페인 키메시지',
    '크리에이티브 아트워크',
    '광고 캠페인 소재',
    '웹페이지 히어로 이미지',
    '프리미엄 브랜딩 이미지',
    'SNS 프로모션 비주얼',
    '온라인 쇼핑몰 배너',
    '행사 초대장 디자인',
    '비주얼 스토리텔링',
    '스마트 스토어 상세컷',
  ]
  for (const keyword of fallbackKeywords) {
    if (keywords.length >= 25) break
    addKeyword(keyword)
  }

  while (keywords.length < 25) {
    addKeyword(`크리에이티브 키워드 ${keywords.length + 1}`)
  }

  const finalKeywords = keywords.slice(0, 25)

  const mainColorTitle = topColors[0]
    ? topColors[0].replace(' 계열', ' 톤')
    : paletteVariety > 1
      ? '다채로운 팔레트'
      : '무채색 톤'
  const brightnessTitleMap = {
    '매우 밝음': '강한 하이라이트',
    밝음: '밝은 조명',
    '중간 밝기': '균형 조명',
    어두움: '어두운 분위기',
    '매우 어두움': '딥한 무드',
  }
  const brightnessTitle = brightnessTitleMap[brightnessLabel] || brightnessLabel
  const orientationTitleMap = {
    가로형: '가로형',
    세로형: '세로형',
    균형형: '정방형',
  }
  const transparencyTitle = transparencyRatio >= 0.2 ? '투명 배경' : '풀 배경'

  const titleParts = []
  const pushTitlePart = (part) => {
    if (part && !titleParts.includes(part)) {
      titleParts.push(part)
    }
  }
  pushTitlePart(mainColorTitle)
  pushTitlePart(brightnessTitle)
  pushTitlePart(temperatureLabel)
  pushTitlePart(orientationTitleMap[orientation] || orientation)
  pushTitlePart(transparencyTitle)
  pushTitlePart('키비주얼')

  const title = titleParts.join(' ')

  const orientationSummary = orientationKeywordMap[orientation] || `${orientation} 구도`
  const paletteSentence =
    paletteLabel === '다채로운 컬러 믹스'
      ? '여러 색상이 어우러져 생동감 있는 이미지를 연출합니다.'
      : paletteLabel === '단색 중심 팔레트'
        ? '단일 톤 중심으로 정돈된 분위기를 전달합니다.'
        : '색상이 균형 있게 분포되어 안정감 있는 분위기를 만듭니다.'
  const transparencySentence =
    transparencyRatio >= 0.2
      ? '투명 배경으로 다양한 디자인 위에 쉽게 얹을 수 있습니다.'
      : '배경 전체를 가득 채워 안정적인 구도를 제공합니다.'
  const textureSentence =
    textureLabel === '디테일 질감 강조'
      ? '세밀한 질감이 살아 있어 디테일 강조에 적합합니다.'
      : textureLabel === '부드러운 그라데이션'
        ? '부드러운 그라데이션이 자연스럽고 우아한 인상을 줍니다.'
        : '질감이 균형 잡혀 다양한 용도에 활용하기 좋습니다.'

  const summary = `${orientationSummary} (${ratioLabel}) 구성에 ${mainColorTitle}을 활용한 ${
    brightnessKeywordMap[brightnessLabel] || brightnessLabel
  } 이미지입니다. ${temperatureLabel} 분위기와 ${paletteSentence} ${transparencySentence} ${textureSentence} 주요 키워드: ${finalKeywords
    .slice(0, 6)
    .join(', ')}.`

  return {
    keywords: finalKeywords,
    summary,
    title,
  }
}

async function analyzeCurrentImage() {
  if (!state.preview) {
    setStatus('먼저 분석할 이미지를 선택해주세요.', 'danger')
    return
  }

  const { type, id } = state.preview
  const sourceCollection = type === 'upload' ? state.uploads : state.results
  const item = sourceCollection.find((entry) => entry.id === id)

  if (!item) {
    setStatus('선택한 이미지를 찾을 수 없습니다.', 'danger')
    displayAnalysisFor(null)
    return
  }

  setStatus('이미지를 분석하는 중입니다…', 'info', 0)

  try {
    const source = type === 'upload' ? item.dataUrl : item.objectUrl
    const dataUrl = await ensureDataUrl(source)
    const { canvas, ctx } = await canvasFromDataUrl(dataUrl)
    const surface = prepareAnalysisSurface(canvas, ctx)
    if (!surface.ctx) throw new Error('분석용 캔버스를 준비하지 못했습니다.')
    const scaledDataUrl = surface.canvas.toDataURL('image/png', 0.92)

    let analysis
    let usedFallback = false

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: scaledDataUrl, name: item.name }),
      })

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail?.error || `OpenAI API 오류(${response.status})`)
      }

      const payload = await response.json()
      if (!payload || typeof payload.title !== 'string' || typeof payload.summary !== 'string' || !Array.isArray(payload.keywords)) {
        throw new Error('API 응답 구조가 올바르지 않습니다.')
      }
      if (payload.keywords.length !== 25) {
        throw new Error('키워드 개수가 25개가 아닙니다.')
      }
      analysis = {
        title: payload.title.trim(),
        summary: payload.summary.trim(),
        keywords: payload.keywords.map((keyword) => (typeof keyword === 'string' ? keyword.trim() : '')).filter(Boolean).slice(0, 25),
      }
    } catch (apiError) {
      console.warn('OpenAI 분석 실패, 로컬 분석으로 대체합니다.', apiError)
      analysis = analyzeCanvasForKeywords(surface.canvas, surface.ctx)
      usedFallback = true
    }

    const key = getAnalysisKey(state.preview)
    if (key) {
      state.analysis.set(key, analysis)
    }
    displayAnalysisFor(state.preview)

    const statusHeadline = analysis.title || analysis.keywords.slice(0, 3).join(', ')
    if (usedFallback) {
      setStatus(
        statusHeadline ? `로컬 분석으로 키워드 생성: ${statusHeadline}` : '로컬 분석으로 키워드를 생성했습니다.',
        'danger',
      )
    } else {
      setStatus(
        statusHeadline ? `키워드 분석 완료: ${statusHeadline}` : '키워드 분석이 완료되었습니다.',
        statusHeadline ? 'success' : 'info',
      )
    }
  } catch (error) {
    console.error(error)
    setStatus('이미지 분석 중 오류가 발생했습니다.', 'danger')
  }
}

function renderUploads() {
  if (!elements.uploadList) return

  const cards = state.uploads
    .map((upload) => {
      const selected = state.selectedUploads.has(upload.id)
      return `
        <div class="asset-card ${selected ? 'is-selected' : ''}" data-type="upload" data-id="${upload.id}">
          <div class="asset-card__selection-indicator" aria-hidden="true">
            <span class="asset-card__selection-icon">✔</span>
            <span class="asset-card__selection-label">선택됨</span>
          </div>
          <label class="asset-card__checkbox">
            <input type="checkbox" aria-label="이미지 선택" data-role="upload-checkbox" ${selected ? 'checked' : ''} />
          </label>
          <div class="asset-card__thumb" data-action="preview-upload">
            <img src="${upload.dataUrl}" alt="${upload.name}" loading="lazy" />
          </div>
          <div class="asset-card__meta">
            <span class="asset-card__name" title="${upload.name}">${upload.name}</span>
            <span class="asset-card__info">${upload.width}×${upload.height}px · ${formatBytes(upload.size)}</span>
          </div>
          <div class="asset-card__actions">
            <button class="asset-card__button" type="button" data-action="preview-upload">미리보기</button>
            <button class="asset-card__button asset-card__delete" type="button" data-action="delete-upload">삭제</button>
          </div>
        </div>
      `
    })
    .join('')

  elements.uploadList.innerHTML = cards || ''
  ensureGridState(elements.uploadList, state.uploads.length)
  updateOperationAvailability()
}

function renderResults() {
  if (!elements.resultList) return

  const cards = state.results
    .map((result) => {
      const selected = state.selectedResults.has(result.id)
      return `
        <div class="asset-card ${selected ? 'is-selected' : ''}" data-type="result" data-id="${result.id}">
          <div class="asset-card__selection-indicator" aria-hidden="true">
            <span class="asset-card__selection-icon">✔</span>
            <span class="asset-card__selection-label">선택됨</span>
          </div>
          <label class="asset-card__checkbox">
            <input type="checkbox" aria-label="결과 선택" data-role="result-checkbox" ${selected ? 'checked' : ''} />
          </label>
          <div class="asset-card__thumb" data-action="preview-result">
            <img src="${result.objectUrl}" alt="${result.name}" loading="lazy" />
          </div>
          <div class="asset-card__meta">
            <span class="asset-card__name" title="${result.name}">${result.name}</span>
            <span class="asset-card__info">${result.width}×${result.height}px · ${formatBytes(result.size)}</span>
            <span class="asset-card__info">${result.operations.join(' · ')}</span>
          </div>
          <div class="asset-card__actions">
            <button class="asset-card__button" type="button" data-action="preview-result">미리보기</button>
            <button class="asset-card__button" type="button" data-action="download-result">다운로드</button>
            <button class="asset-card__button asset-card__delete" type="button" data-action="delete-result">삭제</button>
          </div>
        </div>
      `
    })
    .join('')

  elements.resultList.innerHTML = cards || ''
  ensureGridState(elements.resultList, state.results.length)
  updateResultActionAvailability()
}

async function renderPreview(target) {
  if (!elements.previewCanvas || !elements.previewCtx || !elements.previewEmpty || !elements.previewMeta) return

  if (!target) {
    elements.previewCtx.clearRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height)
    elements.previewCanvas.classList.remove('is-visible')
    elements.previewEmpty.classList.remove('is-hidden')
    elements.previewMeta.innerHTML = '<span class="meta__placeholder">파일을 선택하면 상세 정보가 표시됩니다.</span>'
    state.preview = null
    displayAnalysisFor(null)
    return
  }

  let item
  let src

  if (target.type === 'upload') {
    item = state.uploads.find((upload) => upload.id === target.id)
    if (!item) {
      elements.previewCanvas.classList.remove('is-visible')
      elements.previewEmpty.classList.remove('is-hidden')
      elements.previewCtx.clearRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height)
      elements.previewMeta.innerHTML = '<span class="meta__placeholder">파일을 선택하면 상세 정보가 표시됩니다.</span>'
      state.preview = null
      displayAnalysisFor(null)
      return
    }
    src = item.dataUrl
  } else {
    item = state.results.find((result) => result.id === target.id)
    if (!item) {
      elements.previewCanvas.classList.remove('is-visible')
      elements.previewEmpty.classList.remove('is-hidden')
      elements.previewCtx.clearRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height)
      elements.previewMeta.innerHTML = '<span class="meta__placeholder">파일을 선택하면 상세 정보가 표시됩니다.</span>'
      state.preview = null
      displayAnalysisFor(null)
      return
    }
    src = item.objectUrl
  }

  state.preview = target
  displayAnalysisFor(target)

  try {
    const image = await loadImage(src)
    const canvasWidth = elements.previewCanvas.width
    const canvasHeight = elements.previewCanvas.height
    elements.previewCtx.clearRect(0, 0, canvasWidth, canvasHeight)

    const ratio = Math.min(canvasWidth / image.width, canvasHeight / image.height, 1)
    const renderedWidth = image.width * ratio
    const renderedHeight = image.height * ratio
    const dx = (canvasWidth - renderedWidth) / 2
    const dy = (canvasHeight - renderedHeight) / 2

    elements.previewCtx.drawImage(image, dx, dy, renderedWidth, renderedHeight)
    elements.previewCanvas.classList.add('is-visible')
    elements.previewEmpty.classList.add('is-hidden')

    elements.previewMeta.innerHTML = `
      <span>${item.name}</span>
      <span>${item.width}×${item.height}px · ${formatBytes(item.size)}</span>
    `
  } catch (error) {
    console.error(error)
    elements.previewCanvas.classList.remove('is-visible')
    elements.previewEmpty.classList.remove('is-hidden')
    elements.previewCtx.clearRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height)
    elements.previewMeta.innerHTML = '<span class="meta__placeholder">파일을 선택하면 상세 정보가 표시됩니다.</span>'
    setStatus('미리보기를 불러오지 못했습니다.', 'danger')
    state.preview = null
    displayAnalysisFor(null)
  }
}

function setPreview(target) {
  renderPreview(target)
}

async function ingestFiles(fileList) {
  if (!fileList || fileList.length === 0) {
    setStatus('불러올 이미지가 없습니다.', 'danger')
    return
  }

  const existing = state.uploads.length
  if (existing >= MAX_FILES) {
    setStatus('이미 최대 50개의 이미지를 업로드했습니다.', 'danger')
    return
  }

  const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'))
  const availableSlots = MAX_FILES - existing

  if (files.length === 0) {
    setStatus('이미지 파일만 업로드할 수 있습니다.', 'danger')
    return
  }

  const trimmedFiles = files.slice(0, availableSlots)
  const skipped = files.length - trimmedFiles.length

  try {
    const newUploads = []
    for (const file of trimmedFiles) {
      const dataUrl = await readFileAsDataUrl(file)
      const image = await loadImage(dataUrl)
      newUploads.push({
        id: uuid(),
        name: file.name,
        size: file.size,
        type: file.type,
        dataUrl,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        createdAt: Date.now(),
      })
    }

    state.uploads.push(...newUploads)
    newUploads.forEach((upload) => state.selectedUploads.add(upload.id))
    renderUploads()
    updateOperationAvailability()

    if (newUploads.length > 0) {
      setPreview({ type: 'upload', id: newUploads[newUploads.length - 1].id })
      setStatus(`${newUploads.length}개의 이미지를 불러왔어요.${skipped > 0 ? ` (${skipped}개는 제한으로 건너뛰었습니다.)` : ''}`, 'success')
    }
  } catch (error) {
    console.error(error)
    setStatus('이미지를 불러오는 중 문제가 발생했습니다.', 'danger')
  }
}

function deleteUploads(ids) {
  if (!ids || ids.length === 0) return
  state.uploads = state.uploads.filter((upload) => {
    if (ids.includes(upload.id)) {
      state.selectedUploads.delete(upload.id)
      removeAnalysisFor('upload', upload.id)
      if (state.preview && state.preview.type === 'upload' && state.preview.id === upload.id) {
        setPreview(null)
      }
      return false
    }
    return true
  })
  renderUploads()
  updateOperationAvailability()
  setStatus(`${ids.length}개의 업로드 이미지를 삭제했습니다.`, 'info')
}

function deleteResults(ids) {
  if (!ids || ids.length === 0) return
  state.results = state.results.filter((result) => {
    if (ids.includes(result.id)) {
      URL.revokeObjectURL(result.objectUrl)
      state.selectedResults.delete(result.id)
      removeAnalysisFor('result', result.id)
      if (state.preview && state.preview.type === 'result' && state.preview.id === result.id) {
        setPreview(null)
      }
      return false
    }
    return true
  })
  renderResults()
  updateResultActionAvailability()
  updateOperationAvailability()
  setStatus(`${ids.length}개의 처리 결과를 삭제했습니다.`, 'info')
}

async function processRemoveBackground(upload) {
  const { canvas, ctx } = await canvasFromDataUrl(upload.dataUrl)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyBackgroundRemoval(imageData, canvas.width, canvas.height)
  ctx.putImageData(imageData, 0, 0)
  const blob = await canvasToBlob(canvas, 'image/png', 0.95)
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    operations: ['배경 제거'],
    name: `${baseName(upload.name)}__bg-removed.png`,
  }
}

async function processAutoCrop(upload) {
  const { canvas, ctx } = await canvasFromDataUrl(upload.dataUrl)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const bounds = findBoundingBox(imageData, canvas.width, canvas.height, 12, 60)
  const { canvas: cropped } = cropCanvas(canvas, ctx, bounds)
  const blob = await canvasToBlob(cropped, 'image/png', 0.95)
  return {
    blob,
    width: cropped.width,
    height: cropped.height,
    operations: ['피사체 크롭'],
    name: `${baseName(upload.name)}__cropped.png`,
  }
}

async function processRemoveBackgroundAndCrop(upload) {
  const { canvas, ctx } = await canvasFromDataUrl(upload.dataUrl)
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  imageData = applyBackgroundRemoval(imageData, canvas.width, canvas.height)
  ctx.putImageData(imageData, 0, 0)
  const bounds = findBoundingBox(imageData, canvas.width, canvas.height, 10, 40)
  const { canvas: cropped, ctx: croppedCtx } = cropCanvas(canvas, ctx, bounds)
  const croppedData = croppedCtx.getImageData(0, 0, cropped.width, cropped.height)
  croppedCtx.putImageData(croppedData, 0, 0)
  const blob = await canvasToBlob(cropped, 'image/png', 0.95)
  return {
    blob,
    width: cropped.width,
    height: cropped.height,
    operations: ['배경 제거', '피사체 크롭'],
    name: `${baseName(upload.name)}__bg-cropped.png`,
  }
}

async function processDenoise(upload) {
  const { canvas, ctx } = await canvasFromDataUrl(upload.dataUrl)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyBoxBlur(imageData, canvas.width, canvas.height)
  ctx.putImageData(imageData, 0, 0)
  const blob = await canvasToBlob(canvas, 'image/png', 0.95)
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    operations: ['노이즈 제거'],
    name: `${baseName(upload.name)}__denoised.png`,
  }
}

async function processResize(upload, targetWidth, previousOperations = []) {
  let source = typeof upload.dataUrl === 'string' && upload.dataUrl ? upload.dataUrl : null

  if (!source && typeof upload.objectUrl === 'string' && upload.objectUrl) {
    source = upload.objectUrl
  }

  if (!source && upload.blob instanceof Blob) {
    const fromBlob = await blobToDataUrl(upload.blob)
    if (typeof fromBlob === 'string') {
      source = fromBlob
    }
  }

  if (!source) {
    throw new Error('리사이즈할 이미지 데이터를 찾지 못했습니다.')
  }

  const normalizedSource = await ensureDataUrl(source)
  const { canvas } = await canvasFromDataUrl(normalizedSource)
  const normalizedWidth = Math.max(1, Math.round(targetWidth))
  const history = Array.isArray(previousOperations) ? [...previousOperations] : []

  let workingCanvas = canvas
  let operationLabel = '리사이즈'

  if (normalizedWidth !== canvas.width) {
    const { canvas: resizedCanvas } = resizeCanvas(canvas, normalizedWidth)
    workingCanvas = resizedCanvas
    operationLabel = normalizedWidth > canvas.width ? '리사이즈(확대)' : '리사이즈(축소)'
  } else {
    operationLabel = '리사이즈(동일 너비)'
  }

  const blob = await canvasToBlob(workingCanvas, 'image/png', 0.95)
  history.push(operationLabel)

  return {
    blob,
    width: workingCanvas.width,
    height: workingCanvas.height,
    operations: history,
    name: `${baseName(upload.name)}__resized-${workingCanvas.width}px.png`,
  }
}

function appendResult(upload, result) {
  const objectUrl = URL.createObjectURL(result.blob)
  state.results.unshift({
    id: uuid(),
    sourceId: upload.id,
    name: result.name,
    width: result.width,
    height: result.height,
    size: result.blob.size,
    blob: result.blob,
    objectUrl,
    operations: result.operations,
    createdAt: Date.now(),
  })
  renderResults()
  updateResultActionAvailability()
  updateOperationAvailability()
}

async function runOperation(operation) {
  if (state.processing) return
  const uploadIds = Array.from(state.selectedUploads)
  const resultIds = Array.from(state.selectedResults)

  if (operation === 'resize') {
    if (uploadIds.length === 0 && resultIds.length === 0) {
      setStatus('리사이즈할 업로드 또는 결과 이미지를 선택해주세요.', 'danger')
      return
    }
  } else if (uploadIds.length === 0) {
    setStatus('먼저 처리할 업로드 이미지를 선택해주세요.', 'danger')
    return
  }

  toggleProcessing(true)
  setStatus('이미지를 처리하는 중입니다…', 'info', 0)

  const handlerMap = {
    'remove-bg': processRemoveBackground,
    'auto-crop': processAutoCrop,
    'remove-bg-crop': processRemoveBackgroundAndCrop,
    denoise: processDenoise,
  }

  let targetWidth = null
  if (operation === 'resize') {
    if (!(elements.resizeInput instanceof HTMLInputElement)) {
      setStatus('리사이즈 입력값을 확인해주세요.', 'danger')
      toggleProcessing(false)
      return
    }
    const value = parseInt(elements.resizeInput.value, 10)
    if (Number.isNaN(value) || value < 32 || value > 4096) {
      setStatus('리사이즈 가로 값은 32~4096 사이의 숫자여야 합니다.', 'danger')
      toggleProcessing(false)
      return
    }
    targetWidth = value
  }

  try {
    if (operation === 'resize') {
      const targets = []
      for (const uploadId of uploadIds) {
        const upload = state.uploads.find((item) => item.id === uploadId)
        if (upload) targets.push({ type: 'upload', payload: upload })
      }
      for (const resultId of resultIds) {
        const result = state.results.find((item) => item.id === resultId)
        if (result) targets.push({ type: 'result', payload: result })
      }

      for (const target of targets) {
        if (target.type === 'upload') {
          const upload = target.payload
          // eslint-disable-next-line no-await-in-loop
          const resizeResult = await processResize(upload, targetWidth)
          appendResult(upload, resizeResult)
        } else {
          const resultItem = target.payload
          const pseudoUpload = {
            id: resultItem.id,
            name: resultItem.name,
            size: resultItem.size,
            type: resultItem.blob?.type || 'image/png',
            dataUrl: resultItem.objectUrl,
            objectUrl: resultItem.objectUrl,
            blob: resultItem.blob,
            width: resultItem.width,
            height: resultItem.height,
          }
          const previousOps = Array.isArray(resultItem.operations) ? resultItem.operations : []
          // eslint-disable-next-line no-await-in-loop
          const resizeResult = await processResize(pseudoUpload, targetWidth, previousOps)
          appendResult(resultItem, resizeResult)
        }
      }
    } else {
      const handler = handlerMap[operation]
      if (!handler) {
        setStatus('해당 작업은 아직 준비 중입니다.', 'danger')
        toggleProcessing(false)
        return
      }
      for (const uploadId of uploadIds) {
        const upload = state.uploads.find((item) => item.id === uploadId)
        if (!upload) continue
        // eslint-disable-next-line no-await-in-loop
        const result = await handler(upload)
        appendResult(upload, result)
      }
    }

    const successMessage =
      operation === 'resize' ? '리사이즈가 완료되었습니다.' : '이미지 처리가 완료되었습니다.'
    setStatus(successMessage, 'success')
  } catch (error) {
    console.error(error)
    setStatus('이미지 처리 중 오류가 발생했습니다.', 'danger')
  } finally {
    toggleProcessing(false)
  }
}

function handleUploadListClick(event) {
  if (!elements.uploadList) return
  const checkbox = resolveCheckbox(event, 'input[data-role="upload-checkbox"]')
  if (checkbox instanceof HTMLInputElement) {
    const card = checkbox.closest('[data-type="upload"]')
    if (!card) return
    const id = card.dataset.id
    if (!id) return
    if (checkbox.checked) {
      state.selectedUploads.add(id)
    } else {
      state.selectedUploads.delete(id)
    }
    card.classList.toggle('is-selected', checkbox.checked)
    updateOperationAvailability()
    return
  }

  const button = event.target.closest('button[data-action], .asset-card__thumb[data-action]')
  if (!button) return
  const card = button.closest('[data-type="upload"]')
  if (!card) return
  const id = card.dataset.id
  if (!id) return

  const action = button.dataset.action
  if (action === 'preview-upload') {
    setPreview({ type: 'upload', id })
  }
  if (action === 'delete-upload') {
    deleteUploads([id])
  }
}

function handleResultListClick(event) {
  if (!elements.resultList) return
  const checkbox = resolveCheckbox(event, 'input[data-role="result-checkbox"]')
  if (checkbox instanceof HTMLInputElement) {
    const card = checkbox.closest('[data-type="result"]')
    if (!card) return
    const id = card.dataset.id
    if (!id) return
    if (checkbox.checked) {
      state.selectedResults.add(id)
    } else {
      state.selectedResults.delete(id)
    }
    card.classList.toggle('is-selected', checkbox.checked)
    updateResultActionAvailability()
    updateOperationAvailability()
    return
  }

  const button = event.target.closest('button[data-action], .asset-card__thumb[data-action]')
  if (!button) return
  const card = button.closest('[data-type="result"]')
  if (!card) return
  const id = card.dataset.id
  if (!id) return
  const result = state.results.find((item) => item.id === id)
  if (!result) return

  const action = button.dataset.action
  if (action === 'preview-result') {
    setPreview({ type: 'result', id })
  }
  if (action === 'download-result') {
    downloadResults([id])
  }
  if (action === 'delete-result') {
    deleteResults([id])
  }
}

async function fetchSampleImage() {
  try {
    setStatus('샘플 이미지를 불러오는 중입니다…', 'info', 0)
    const response = await fetch(SAMPLE_IMAGE_URL)
    if (!response.ok) throw new Error('샘플 이미지를 가져오지 못했습니다.')
    const blob = await response.blob()
    const sampleFile = new File([blob], `sample-${Date.now()}.jpg`, { type: blob.type })
    await ingestFiles([sampleFile])
  } catch (error) {
    console.error(error)
    setStatus('샘플 이미지를 불러오지 못했습니다.', 'danger')
  }
}

function selectAllUploads() {
  state.uploads.forEach((upload) => state.selectedUploads.add(upload.id))
  renderUploads()
  updateOperationAvailability()
}

function clearUploadsSelection() {
  state.selectedUploads.clear()
  renderUploads()
  updateOperationAvailability()
}

function selectAllResults() {
  state.results.forEach((result) => state.selectedResults.add(result.id))
  renderResults()
  updateResultActionAvailability()
  updateOperationAvailability()
}

function clearResultsSelection() {
  state.selectedResults.clear()
  renderResults()
  updateResultActionAvailability()
  updateOperationAvailability()
}

async function downloadResults(ids) {
  const targets = ids.map((id) => state.results.find((result) => result.id === id)).filter(Boolean)
  if (targets.length === 0) {
    setStatus('다운로드할 결과를 선택해주세요.', 'danger')
    return
  }

  try {
    const zip = new window.JSZip()
    for (const result of targets) {
      // eslint-disable-next-line no-await-in-loop
      const arrayBuffer = await result.blob.arrayBuffer()
      zip.file(result.name, arrayBuffer)
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `easy-image-results-${Date.now()}.zip`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setStatus(`${targets.length}개의 결과를 ZIP으로 다운로드했습니다.`, 'success')
  } catch (error) {
    console.error(error)
    setStatus('다운로드 중 오류가 발생했습니다.', 'danger')
  }
}

function attachEventListeners() {
  if (elements.fileInput) {
    elements.fileInput.addEventListener('change', (event) => {
      const target = event.currentTarget
      if (!(target instanceof HTMLInputElement) || !target.files) return
      const files = Array.from(target.files)
      ingestFiles(files)
      target.value = ''
    })
  }

  if (elements.dropZone) {
    elements.dropZone.addEventListener('click', () => {
      elements.fileInput?.click()
    })
    elements.dropZone.addEventListener('dragover', (event) => {
      event.preventDefault()
      elements.dropZone?.classList.add('is-active')
    })
    elements.dropZone.addEventListener('dragleave', () => {
      elements.dropZone?.classList.remove('is-active')
    })
    elements.dropZone.addEventListener('drop', (event) => {
      event.preventDefault()
      elements.dropZone?.classList.remove('is-active')
      const files = event.dataTransfer?.files
      if (files?.length) {
        ingestFiles(Array.from(files))
      }
    })
  }

  elements.heroTriggers?.forEach((trigger) => {
    trigger.addEventListener('click', () => elements.fileInput?.click())
  })

  if (elements.sampleButton) {
    elements.sampleButton.addEventListener('click', fetchSampleImage)
  }

  document.querySelectorAll('[data-action="show-login"]').forEach((button) => {
    if (button instanceof HTMLButtonElement) {
      button.addEventListener('click', openLoginModal)
    }
  })

  document.querySelectorAll('[data-action="close-login"]').forEach((button) => {
    if (button instanceof HTMLButtonElement) {
      button.addEventListener('click', closeLoginModal)
    }
  })

  const loginBackdrop = elements.loginModal?.querySelector('[data-action="close-login"]')
  if (loginBackdrop instanceof HTMLElement) {
    loginBackdrop.addEventListener('click', closeLoginModal)
  }

  const googleLoginButton = document.querySelector('[data-action="login-google"]')
  if (googleLoginButton instanceof HTMLButtonElement) {
    googleLoginButton.addEventListener('click', handleGoogleLogin)
  }

  if (elements.loginEmailForm instanceof HTMLFormElement) {
    elements.loginEmailForm.addEventListener('submit', handleEmailLogin)
  }

  if (elements.analysisButton instanceof HTMLButtonElement) {
    elements.analysisButton.addEventListener('click', analyzeCurrentImage)
  }

  if (elements.resizeInput instanceof HTMLInputElement) {
    elements.resizeInput.addEventListener('input', () => updateOperationAvailability())
  }

  elements.operationButtons?.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return
    const operation = button.dataset.operation
    if (!operation) return
    if (operation === 'svg') {
      button.addEventListener('click', () => {
        setStatus('PNG → SVG 변환 기능은 준비 중입니다.', 'info')
      })
      return
    }
    button.addEventListener('click', () => runOperation(operation))
  })

  if (elements.uploadList) {
    elements.uploadList.addEventListener('click', handleUploadListClick)
  }

  if (elements.resultList) {
    elements.resultList.addEventListener('click', handleResultListClick)
  }

  if (elements.uploadSelectAll instanceof HTMLButtonElement) {
    elements.uploadSelectAll.addEventListener('click', selectAllUploads)
  }

  if (elements.uploadClear instanceof HTMLButtonElement) {
    elements.uploadClear.addEventListener('click', clearUploadsSelection)
  }

  if (elements.uploadDeleteSelected instanceof HTMLButtonElement) {
    elements.uploadDeleteSelected.addEventListener('click', () => {
      deleteUploads(Array.from(state.selectedUploads))
    })
  }

  if (elements.resultSelectAll instanceof HTMLButtonElement) {
    elements.resultSelectAll.addEventListener('click', selectAllResults)
  }

  if (elements.resultClear instanceof HTMLButtonElement) {
    elements.resultClear.addEventListener('click', clearResultsSelection)
  }

  if (elements.resultDeleteSelected instanceof HTMLButtonElement) {
    elements.resultDeleteSelected.addEventListener('click', () => {
      deleteResults(Array.from(state.selectedResults))
    })
  }

  elements.resultDownloadButtons?.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return
    const mode = button.dataset.resultDownload
    if (!mode) return
    button.addEventListener('click', () => {
      if (!window.JSZip) {
        setStatus('ZIP 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.', 'danger')
        return
      }
      if (mode === 'all') {
        downloadResults(state.results.map((result) => result.id))
      } else {
        downloadResults(Array.from(state.selectedResults))
      }
    })
  })

  document.addEventListener('keydown', handleGlobalKeydown)
}

function init() {
  updateOperationAvailability()
  updateResultActionAvailability()
  attachEventListeners()
  initCookieBanner()
  renderUploads()
  renderResults()
  displayAnalysisFor(null)
  setPreview(null)
}

document.addEventListener('DOMContentLoaded', init)
