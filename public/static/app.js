const MAX_FILES = 50
const MAX_SVG_BYTES = 150 * 1024
const IMAGETRACER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/imagetracerjs/1.2.6/imagetracer_v1.2.6.min.js'
const FREEMIUM_INITIAL_CREDITS = 30
const MICHINA_INITIAL_CREDITS = 10000
const CREDIT_COSTS = {
  operation: 1,
  resize: 1,
  svg: 2,
  download: 1,
  downloadAll: 2,
  analysis: 1,
}
const STAGE_FLOW = ['upload', 'refine', 'export']
const GOOGLE_SDK_SRC = 'https://accounts.google.com/gsi/client'
const GOOGLE_SIGNIN_TEXT = {
  default: 'Google 계정으로 계속하기',
  idle: 'Google 계정으로 계속하기',
  initializing: 'Google 로그인 준비 중…',
  loading: 'Google 계정을 확인하는 중…',
  disabled: 'Google 로그인 준비 중',
  error: 'Google 로그인 다시 시도',
  retrying: 'Google 로그인 자동 재시도 준비 중…',
}

const GOOGLE_MAX_AUTO_RETRY = 3
const GOOGLE_BACKOFF_BASE_DELAY = 1500
const GOOGLE_BACKOFF_MAX_DELAY = 30000
const GOOGLE_BACKOFF_JITTER = 400

const GOOGLE_RECOVERABLE_ERRORS = new Set([
  'GOOGLE_SDK_TIMEOUT',
  'GOOGLE_SDK_UNAVAILABLE',
  'GOOGLE_SDK_LOAD_FAILED',
  'GOOGLE_CODE_MISSING',
  'GOOGLE_AUTH_REJECTED',
  'GOOGLE_TOKEN_EXCHANGE_FAILED',
  'GOOGLE_AUTH_UNEXPECTED_ERROR',
  'interaction_required',
])

const GOOGLE_POPUP_DISMISSED_ERRORS = new Set([
  'access_denied',
  'popup_closed_by_user',
  'popup_blocked_by_browser',
])

const GOOGLE_CONFIGURATION_ERRORS = new Set(['GOOGLE_CLIENT_ID_MISSING', 'GOOGLE_AUTH_NOT_CONFIGURED'])

const GOOGLE_RETRY_REASON_HINTS = {
  default: '일시적인 오류가 발생했습니다.',
  recoverable_error: '일시적인 오류가 발생했습니다.',
  GOOGLE_SDK_TIMEOUT: 'Google 로그인 응답이 지연되고 있습니다.',
  GOOGLE_SDK_UNAVAILABLE: 'Google 로그인 서비스와 연결이 원활하지 않습니다.',
  GOOGLE_SDK_LOAD_FAILED: 'Google 로그인 스크립트를 불러오는 중 문제가 발생했습니다.',
  GOOGLE_CODE_MISSING: 'Google에서 인증 코드가 전달되지 않았습니다.',
  GOOGLE_AUTH_REJECTED: 'Google 로그인 요청이 일시적으로 거절되었습니다.',
  GOOGLE_TOKEN_EXCHANGE_FAILED: 'Google 인증 서버 응답이 지연되고 있습니다.',
  GOOGLE_AUTH_UNEXPECTED_ERROR: 'Google 인증 서버에서 예기치 않은 응답을 받았습니다.',
  interaction_required: 'Google 계정 선택이 필요한 상태입니다.',
}

function describeGoogleRetry(reason) {
  if (!reason) {
    return GOOGLE_RETRY_REASON_HINTS.default
  }
  return GOOGLE_RETRY_REASON_HINTS[reason] || GOOGLE_RETRY_REASON_HINTS.default
}

function announceGoogleRetry(delayMs, reason = 'recoverable_error', attemptNumber) {
  const seconds = Math.max(1, Math.ceil(delayMs / 1000))
  const resolvedAttempt =
    typeof attemptNumber === 'number' && attemptNumber > 1
      ? attemptNumber
      : runtime.google.nextRetryAttempt && runtime.google.nextRetryAttempt > 1
        ? runtime.google.nextRetryAttempt
        : 0
  const attemptMessage =
    resolvedAttempt > 1 ? `${resolvedAttempt}번째 자동 재시도를 진행합니다.` : '자동으로 다시 시도합니다.'
  const message = `${describeGoogleRetry(reason)} 약 ${seconds}초 후 ${attemptMessage}`
  setGoogleLoginHelper(`${message}`, 'info')
}

const state = {
  uploads: [],
  results: [],
  selectedUploads: new Set(),
  selectedResults: new Set(),
  activeTarget: null,
  processing: false,
  analysis: new Map(),
  user: {
    isLoggedIn: false,
    name: '',
    email: '',
    plan: 'public',
    credits: 0,
    totalUsed: 0,
  },
  admin: {
    isLoggedIn: false,
    email: '',
    participants: [],
  },
  challenge: {
    profile: null,
    certificate: null,
    loading: false,
    submitting: false,
  },
  auth: {
    step: 'idle',
    pendingEmail: '',
    code: '',
    expiresAt: 0,
    attempts: 0,
  },
  stage: 'upload',
  view: 'home',
}

const runtime = {
  config: null,
  initialView: 'home',
  allowViewBypass: false,
  google: {
    codeClient: null,
    deferred: null,
    prefetchPromise: null,
    retryCount: 0,
    cooldownTimer: null,
    cooldownUntil: 0,
    cooldownAutoRetry: false,
    retryTimer: null,
    retryAt: 0,
    nextRetryReason: '',
    nextRetryAttempt: 0,
    lastErrorHint: '',
    lastErrorTone: 'muted',
  },
  admin: {
    retryCount: 0,
    cooldownTimer: null,
    cooldownUntil: 0,
  },
}

let googleSdkPromise = null
let hasAnnouncedAdminNav = false
let adminNavHighlightTimer = null
let hasShownAdminDashboardPrompt = false

function hasUnlimitedAccess() {
  return state.admin.isLoggedIn
}

function formatCreditsValue(value) {
  if (hasUnlimitedAccess()) return '∞'
  const numeric = typeof value === 'number' ? Math.max(0, Math.round(value)) : 0
  return numeric.toLocaleString('ko-KR')
}

function getPlanLabel() {
  if (state.admin.isLoggedIn) return '관리자 모드'
  if (state.user.plan === 'michina') return '미치나 플랜'
  if (state.user.plan === 'freemium') return 'Freemium'
  return '게스트'
}

function getAppConfig() {
  if (runtime.config) {
    return runtime.config
  }
  const script = document.querySelector('script[data-role="app-config"]')
  if (!script) {
    runtime.config = {}
    return runtime.config
  }
  try {
    runtime.config = JSON.parse(script.textContent || '{}') || {}
  } catch (error) {
    console.error('앱 설정을 불러오지 못했습니다.', error)
    runtime.config = {}
  }
  return runtime.config
}

function waitForGoogleSdk(timeout = 8000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve(window.google.accounts.oauth2)
      return
    }
    const timer = window.setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        window.clearInterval(timer)
        resolve(window.google.accounts.oauth2)
        return
      }
      if (Date.now() - start > timeout) {
        window.clearInterval(timer)
        reject(new Error('GOOGLE_SDK_TIMEOUT'))
      }
    }, 120)
  })
}

function loadGoogleSdk(timeout = 10000) {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve()
  }

  if (googleSdkPromise) {
    return googleSdkPromise
  }

  googleSdkPromise = new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-role="google-sdk"]')
    let settled = false
    let timer = null

    const cleanup = () => {
      if (script) {
        script.removeEventListener('load', handleLoad)
        script.removeEventListener('error', handleError)
      }
      if (timer) {
        window.clearTimeout(timer)
      }
    }

    const finish = (error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        googleSdkPromise = null
        reject(error)
        return
      }
      resolve(true)
    }

    const handleLoad = () => {
      if (script) {
        script.setAttribute('data-loaded', 'true')
      }
      finish()
    }

    const handleError = () => {
      if (script && script.parentNode) {
        script.parentNode.removeChild(script)
      }
      finish(new Error('GOOGLE_SDK_LOAD_FAILED'))
    }

    if (!script) {
      script = document.createElement('script')
      script.src = GOOGLE_SDK_SRC
      script.async = true
      script.defer = true
      script.dataset.role = 'google-sdk'
      script.addEventListener('load', handleLoad, { once: true })
      script.addEventListener('error', handleError, { once: true })
      document.head.appendChild(script)
    } else if (script.getAttribute('data-loaded') === 'true') {
      finish()
      return
    } else {
      script.addEventListener('load', handleLoad, { once: true })
      script.addEventListener('error', handleError, { once: true })
    }

    timer = window.setTimeout(() => {
      if (window.google?.accounts?.oauth2) {
        handleLoad()
        return
      }
      if (script && script.parentNode) {
        script.parentNode.removeChild(script)
      }
      finish(new Error('GOOGLE_SDK_TIMEOUT'))
    }, timeout)
  })

  return googleSdkPromise
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    promise,
    resolve,
    reject,
  }
}

async function ensureGoogleClient() {
  const config = getAppConfig()
  const clientId = typeof config.googleClientId === 'string' ? config.googleClientId.trim() : ''
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID_MISSING')
  }

  await loadGoogleSdk()
  await waitForGoogleSdk()

  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2 || typeof oauth2.initCodeClient !== 'function') {
    throw new Error('GOOGLE_SDK_UNAVAILABLE')
  }

  if (!runtime.google.codeClient) {
    const redirectConfig =
      typeof config.googleRedirectUri === 'string' ? config.googleRedirectUri.trim() : ''
    const fallbackRedirect = `${window.location.origin.replace(/\/$/, '')}/auth/google/callback`
    const redirectUri = redirectConfig || fallbackRedirect

    runtime.google.codeClient = oauth2.initCodeClient({
      client_id: clientId,
      scope: 'openid email profile',
      ux_mode: 'popup',
      prompt: 'select_account',
      redirect_uri: redirectUri,
      callback: (response) => {
        const deferred = runtime.google.deferred
        if (!deferred) {
          return
        }
        if (response.error) {
          deferred.reject(new Error(response.error))
        } else if (response.code) {
          deferred.resolve(response.code)
        } else {
          deferred.reject(new Error('GOOGLE_CODE_MISSING'))
        }
        runtime.google.deferred = null
      },
    })
    runtime.google.retryCount = 0
  }

  return runtime.google.codeClient
}

const elements = {
  fileInput: document.querySelector('#fileInput'),
  dropZone: document.querySelector('[data-role="dropzone"]'),
  uploadList: document.querySelector('#uploadList'),
  resultList: document.querySelector('#resultList'),
  status: document.querySelector('[data-role="status"]'),
  heroTriggers: document.querySelectorAll('[data-trigger="file"]'),
  operationButtons: document.querySelectorAll('[data-operation]'),
  resizeInput: document.querySelector('#resizeWidth'),
  resultDownloadButtons: document.querySelectorAll('[data-result-download]'),
  svgButton: document.querySelector('[data-result-operation="svg"]'),
  svgColorSelect: document.querySelector('#svgColorCount'),
  uploadSelectAll: document.querySelector('[data-action="upload-select-all"]'),
  uploadClear: document.querySelector('[data-action="upload-clear"]'),
  uploadDeleteSelected: document.querySelector('[data-action="upload-delete-selected"]'),
  resultSelectAll: document.querySelector('[data-action="result-select-all"]'),
  resultClear: document.querySelector('[data-action="result-clear"]'),
  resultDeleteSelected: document.querySelector('[data-action="result-delete-selected"]'),
  analysisPanel: document.querySelector('[data-role="analysis-panel"]'),
  analysisHint: document.querySelector('[data-role="analysis-hint"]'),
  analysisMeta: document.querySelector('[data-role="analysis-meta"]'),
  analysisHeadline: document.querySelector('[data-role="analysis-title"]'),
  adminNavButton: document.querySelector('[data-role="admin-nav"]'),
  adminLoginButton: document.querySelector('[data-role="admin-login"]'),
  adminModal: document.querySelector('[data-role="admin-modal"]'),
  adminLoginForm: document.querySelector('[data-role="admin-login-form"]'),
  adminEmailInput: document.querySelector('[data-role="admin-email"]'),
  adminPasswordInput: document.querySelector('[data-role="admin-password"]'),
  adminLoginMessage: document.querySelector('[data-role="admin-login-message"]'),
  adminModalSubtitle: document.querySelector('[data-role="admin-modal-subtitle"]'),
  adminModalActions: document.querySelector('[data-role="admin-modal-actions"]'),
  adminModalDashboardButton: document.querySelector('[data-role="admin-modal-dashboard"]'),
  adminModalLogoutButton: document.querySelector('[data-role="admin-modal-logout"]'),
  adminCategoryBadge: document.querySelector('[data-role="admin-category"]'),
  adminDashboard: document.querySelector('[data-role="admin-dashboard"]'),
  adminImportForm: document.querySelector('[data-role="admin-import-form"]'),
  adminImportFile: document.querySelector('[data-role="admin-import-file"]'),
  adminImportManual: document.querySelector('[data-role="admin-import-manual"]'),
  adminImportEndDate: document.querySelector('[data-role="admin-import-enddate"]'),
  adminParticipantsBody: document.querySelector('[data-role="admin-participants-body"]'),
  adminRunCompletionButton: document.querySelector('[data-role="admin-run-completion"]'),
  adminRefreshButton: document.querySelector('[data-role="admin-refresh"]'),
  adminDownloadCompletion: document.querySelector('[data-role="admin-download-completion"]'),
  adminLogoutButton: document.querySelector('[data-role="admin-logout"]'),
  planBadge: document.querySelector('[data-role="plan-badge"]'),
  challengeSection: document.querySelector('[data-role="challenge-section"]'),
  challengeDashboard: document.querySelector('[data-role="challenge-dashboard"]'),
  challengeLocked: document.querySelector('[data-role="challenge-locked"]'),
  challengeSummary: document.querySelector('[data-role="challenge-summary"]'),
  challengeProgress: document.querySelector('[data-role="challenge-progress"]'),
  challengeSubmitForm: document.querySelector('[data-role="challenge-submit-form"]'),
  challengeDaySelect: document.querySelector('[data-role="challenge-day"]'),
  challengeUrlInput: document.querySelector('[data-role="challenge-url"]'),
  challengeFileInput: document.querySelector('[data-role="challenge-file"]'),
  challengeSubmitHint: document.querySelector('[data-role="challenge-submit-hint"]'),
  challengeDays: document.querySelector('[data-role="challenge-days"]'),
  challengeCertificate: document.querySelector('[data-role="challenge-certificate"]'),
  certificatePreview: document.querySelector('[data-role="certificate-preview"]'),
  certificateDownload: document.querySelector('[data-role="certificate-download"]'),
  analysisKeywords: document.querySelector('[data-role="analysis-keywords"]'),
  analysisSummary: document.querySelector('[data-role="analysis-summary"]'),
  analysisButton: document.querySelector('[data-action="analyze-current"]'),
  navButtons: Array.from(document.querySelectorAll('[data-view-target]')),
  viewSections: Array.from(document.querySelectorAll('[data-view]')),
  loginModal: document.querySelector('[data-role="login-modal"]'),
  googleLoginButton: document.querySelector('[data-role="google-login-button"]'),
  googleLoginText: document.querySelector('[data-role="google-login-text"]'),
  googleLoginSpinner: document.querySelector('[data-role="google-login-spinner"]'),
  googleLoginHelper: document.querySelector('[data-role="google-login-helper"]'),
  communityLink: document.querySelector('[data-role="community-link"]'),
  loginEmailForm: document.querySelector('[data-role="login-email-form"]'),
  loginEmailInput: document.querySelector('[data-role="login-email-input"]'),
  loginEmailCodeInput: document.querySelector('[data-role="login-email-code"]'),
  loginEmailSubmit: document.querySelector('[data-role="login-email-submit"]'),
  loginEmailResend: document.querySelector('[data-role="login-email-resend"]'),
  loginEmailHelper: document.querySelector('[data-role="login-email-helper"]'),
  cookieBanner: document.querySelector('[data-role="cookie-banner"]'),
  cookieAnalytics: document.querySelector('[data-role="cookie-analytics"]'),
  cookieMarketing: document.querySelector('[data-role="cookie-marketing"]'),
  cookieConfirm: document.querySelector('[data-role="cookie-confirm"]'),
  cookieAcceptButton: document.querySelector('[data-action="accept-cookies"]'),
  creditDisplay: document.querySelector('[data-role="credit-display"]'),
  creditLabel: document.querySelector('[data-role="credit-label"]'),
  creditCount: document.querySelector('[data-role="credit-count"]'),
  headerAuthButton: document.querySelector('[data-role="header-auth"]'),
  stageIndicator: document.querySelector('[data-role="stage-indicator"]'),
  stageItems: document.querySelectorAll('[data-role="stage-indicator"] .stage__item'),
  stageMessage: document.querySelector('[data-role="stage-message"]'),
  stageStatus: document.querySelector('[data-role="stage-status"]'),
  operationsGate: document.querySelector('[data-role="operations-gate"]'),
  resultsGate: document.querySelector('[data-role="results-gate"]'),
  resultsCreditCount: document.querySelector('[data-role="results-credit-count"]'),
}

let statusTimer = null
let imageTracerReadyPromise = null

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
  if (!(elements.status instanceof HTMLElement)) return

  let content = ''
  let useHtml = false
  let resolvedTone = tone
  let resolvedDuration = duration
  let isInteractive = false

  if (message && typeof message === 'object' && !Array.isArray(message)) {
    if (typeof message.html === 'string') {
      content = message.html
      useHtml = true
    } else if (typeof message.text === 'string') {
      content = message.text
    } else if (typeof message.message === 'string') {
      content = message.message
    }
    if (typeof message.tone === 'string') {
      resolvedTone = message.tone
    }
    if (typeof message.duration === 'number') {
      resolvedDuration = message.duration
    }
    if (typeof message.interactive === 'boolean') {
      isInteractive = message.interactive
    }
  } else if (typeof message === 'string') {
    content = message
  }

  window.clearTimeout(statusTimer)
  elements.status.classList.remove('status--interactive')

  if (useHtml) {
    elements.status.innerHTML = content
  } else {
    elements.status.textContent = content
  }

  if (isInteractive) {
    elements.status.classList.add('status--interactive')
  }

  elements.status.dataset.tone = resolvedTone
  elements.status.classList.remove('status--hidden')

  if (resolvedDuration > 0) {
    statusTimer = window.setTimeout(() => {
      elements.status?.classList.add('status--hidden')
    }, resolvedDuration)
  }
}

function setGoogleButtonState(state = 'idle', labelOverride) {
  const button = elements.googleLoginButton
  if (!(button instanceof HTMLButtonElement)) {
    return
  }

  const labelKey = typeof GOOGLE_SIGNIN_TEXT[state] === 'string' ? state : 'default'
  const label =
    typeof labelOverride === 'string' && labelOverride.trim().length > 0
      ? labelOverride.trim()
      : GOOGLE_SIGNIN_TEXT[labelKey] ?? GOOGLE_SIGNIN_TEXT.default

  if (elements.googleLoginText instanceof HTMLElement) {
    elements.googleLoginText.textContent = label
  }

  button.setAttribute('aria-label', label)

  const isPending = state === 'loading' || state === 'initializing' || state === 'retrying'
  const shouldDisable = isPending || state === 'disabled' || state === 'error'

  button.disabled = shouldDisable
  if (shouldDisable) {
    button.setAttribute('aria-disabled', 'true')
  } else {
    button.removeAttribute('aria-disabled')
  }
  button.setAttribute('aria-busy', isPending ? 'true' : 'false')

  if (isPending) {
    button.dataset.loading = 'true'
  } else if (button.dataset.loading) {
    delete button.dataset.loading
  }

  if (state === 'disabled' || state === 'error' || state === 'retrying') {
    button.dataset.state = state
  } else if (button.dataset.state) {
    delete button.dataset.state
  }
}

function setGoogleLoginHelper(message = '', tone = 'muted') {
  if (!(elements.googleLoginHelper instanceof HTMLElement)) {
    return
  }
  const trimmed = typeof message === 'string' ? message.trim() : ''
  elements.googleLoginHelper.textContent = trimmed
  elements.googleLoginHelper.hidden = !trimmed
  runtime.google.lastErrorHint = trimmed
  if (!trimmed) {
    delete elements.googleLoginHelper.dataset.tone
    runtime.google.lastErrorTone = 'muted'
    return
  }
  if (typeof tone === 'string' && tone !== 'muted') {
    elements.googleLoginHelper.dataset.tone = tone
    runtime.google.lastErrorTone =
      tone === 'danger' || tone === 'warning' || tone === 'info' ? tone : 'muted'
  } else {
    delete elements.googleLoginHelper.dataset.tone
    runtime.google.lastErrorTone = 'muted'
  }
}

function updateGoogleProviderAvailability() {
  if (!(elements.googleLoginButton instanceof HTMLButtonElement)) {
    return
  }

  const now = Date.now()
  if (runtime.google.cooldownUntil && now < runtime.google.cooldownUntil) {
    const remaining = Math.max(0, runtime.google.cooldownUntil - now)
    const seconds = Math.max(1, Math.ceil(remaining / 1000))
    if (runtime.google.cooldownAutoRetry) {
      setGoogleButtonState('retrying', `자동 재시도까지 ${seconds}초`)
      announceGoogleRetry(remaining, runtime.google.nextRetryReason || 'recoverable_error')
    } else {
      setGoogleButtonState('error', `${seconds}초 후 다시 시도`)
    }
    return
  }

  if (runtime.google.retryTimer && runtime.google.retryAt && now < runtime.google.retryAt) {
    const remaining = Math.max(0, runtime.google.retryAt - now)
    const seconds = Math.max(1, Math.ceil(remaining / 1000))
    setGoogleButtonState('retrying', `자동 재시도까지 ${seconds}초`)
    announceGoogleRetry(remaining, runtime.google.nextRetryReason || 'recoverable_error')
    return
  }

  const config = getAppConfig()
  const clientId = typeof config.googleClientId === 'string' ? config.googleClientId.trim() : ''
  if (!clientId) {
    setGoogleButtonState('disabled')
    setGoogleLoginHelper('현재 Google 로그인을 사용할 수 없습니다. 이메일 로그인으로 계속 진행해주세요.', 'info')
    return
  }
  if (runtime.google.codeClient) {
    setGoogleButtonState('idle')
    return
  }
  if (runtime.google.prefetchPromise) {
    setGoogleButtonState('initializing')
    return
  }
  setGoogleButtonState('idle')
}

async function prefetchGoogleClient() {
  const config = getAppConfig()
  const clientId = typeof config.googleClientId === 'string' ? config.googleClientId.trim() : ''
  if (!clientId) {
    setGoogleButtonState('disabled')
    return null
  }
  if (runtime.google.codeClient) {
    setGoogleButtonState('idle')
    return runtime.google.codeClient
  }
  if (runtime.google.prefetchPromise) {
    return runtime.google.prefetchPromise
  }

  setGoogleButtonState('initializing')

  runtime.google.prefetchPromise = ensureGoogleClient()
    .then((client) => {
      runtime.google.retryCount = 0
      setGoogleButtonState('idle')
      setGoogleLoginHelper('Google 로그인을 사용할 준비가 되었습니다.', 'info')
      return client
    })
    .catch((error) => {
      console.warn('Google client 초기화 실패', error)
      if (error instanceof Error && error.message === 'GOOGLE_CLIENT_ID_MISSING') {
        setGoogleButtonState('disabled')
        setGoogleLoginHelper('현재 Google 로그인을 사용할 수 없습니다. 이메일 로그인으로 계속 진행해주세요.', 'info')
      } else {
        setGoogleButtonState('error')
        setGoogleLoginHelper('Google 로그인 초기화 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.', 'warning')
        window.setTimeout(() => {
          updateGoogleProviderAvailability()
        }, 2400)
      }
      return null
    })
    .finally(() => {
      runtime.google.prefetchPromise = null
    })

  return runtime.google.prefetchPromise
}

function clearGoogleAutoRetry() {
  if (runtime.google.retryTimer) {
    window.clearTimeout(runtime.google.retryTimer)
  }
  runtime.google.retryTimer = null
  runtime.google.retryAt = 0
  runtime.google.nextRetryReason = ''
  runtime.google.nextRetryAttempt = 0
}

function clearGoogleCooldown() {
  if (runtime.google.cooldownTimer) {
    window.clearTimeout(runtime.google.cooldownTimer)
  }
  runtime.google.cooldownTimer = null
  runtime.google.cooldownUntil = 0
  runtime.google.cooldownAutoRetry = false
  clearGoogleAutoRetry()
  setGoogleLoginHelper('', 'muted')
  updateGoogleProviderAvailability()
}

function startGoogleCooldown(durationMs, options = {}) {
  if (!(elements.googleLoginButton instanceof HTMLButtonElement)) {
    return
  }
  const { autoRetry = false, attemptNumber } = options
  const normalized = Math.max(1000, durationMs)
  const target = Date.now() + normalized
  const upcomingAttempt =
    typeof attemptNumber === 'number' && attemptNumber > 0
      ? attemptNumber
      : runtime.google.nextRetryAttempt || runtime.google.retryCount + 1

  if (autoRetry && upcomingAttempt > 0) {
    runtime.google.nextRetryAttempt = upcomingAttempt
  }

  const helperElement =
    elements.googleLoginHelper instanceof HTMLElement ? elements.googleLoginHelper : null
  const baseHelperMessage = helperElement ? (helperElement.textContent || '').trim() : ''
  const fallbackTone =
    runtime.google.lastErrorTone && runtime.google.lastErrorTone !== 'muted'
      ? runtime.google.lastErrorTone
      : autoRetry
        ? 'info'
        : 'warning'
  const baseHelperTone =
    helperElement && helperElement.dataset.tone && helperElement.dataset.tone !== 'muted'
      ? helperElement.dataset.tone
      : fallbackTone

  if (runtime.google.cooldownTimer) {
    window.clearTimeout(runtime.google.cooldownTimer)
  }
  if (!autoRetry) {
    clearGoogleAutoRetry()
  }

  runtime.google.cooldownAutoRetry = autoRetry
  runtime.google.cooldownUntil = target

  const update = () => {
    const remaining = Math.max(0, runtime.google.cooldownUntil - Date.now())
    if (remaining <= 0) {
      clearGoogleCooldown()
      return
    }
    const seconds = Math.ceil(remaining / 1000)
    const attemptLabel = autoRetry && upcomingAttempt > 1 ? ` (다음 시도 ${upcomingAttempt}번째)` : ''
    const label = autoRetry
      ? `자동 재시도까지 ${seconds}초${attemptLabel}`
      : `${seconds}초 후 다시 시도`
    setGoogleButtonState(autoRetry ? 'retrying' : 'error', label)
    if (autoRetry) {
      announceGoogleRetry(remaining, runtime.google.nextRetryReason || 'recoverable_error', upcomingAttempt)
    } else {
      const hint =
        baseHelperMessage || runtime.google.lastErrorHint || 'Google 로그인에 잠시 문제가 발생했습니다.'
      setGoogleLoginHelper(`${hint} 약 ${seconds}초 후 다시 시도할 수 있습니다.`, baseHelperTone)
    }
    runtime.google.cooldownTimer = window.setTimeout(update, 1000)
  }

  update()
}

function calculateGoogleBackoffDelay(retryCount) {
  const exponent = Math.max(0, retryCount - 1)
  const baseDelay = GOOGLE_BACKOFF_BASE_DELAY * Math.pow(2, exponent)
  const cappedDelay = Math.min(GOOGLE_BACKOFF_MAX_DELAY, baseDelay)
  const jitter = Math.random() * GOOGLE_BACKOFF_JITTER
  return Math.round(cappedDelay + jitter)
}

function scheduleGoogleAutoRetry(reason = 'recoverable_error') {
  if (runtime.google.retryCount > GOOGLE_MAX_AUTO_RETRY) {
    return false
  }

  const upcomingAttempt = Math.max(2, runtime.google.retryCount + 1)
  const delay = calculateGoogleBackoffDelay(runtime.google.retryCount || 1)
  runtime.google.nextRetryAttempt = upcomingAttempt
  startGoogleCooldown(delay, { autoRetry: true, attemptNumber: upcomingAttempt })

  if (runtime.google.retryTimer) {
    window.clearTimeout(runtime.google.retryTimer)
  }

  runtime.google.retryAt = Date.now() + delay
  runtime.google.nextRetryReason = reason
  runtime.google.lastErrorHint = describeGoogleRetry(reason)
  runtime.google.lastErrorTone = 'info'
  runtime.google.retryTimer = window.setTimeout(() => {
    runtime.google.retryTimer = null
    runtime.google.retryAt = 0
    runtime.google.nextRetryReason = ''
    runtime.google.nextRetryAttempt = upcomingAttempt
    setGoogleLoginHelper(`Google 로그인 ${upcomingAttempt}번째 자동 재시도를 시작합니다…`, 'info')
    runtime.google.lastErrorTone = 'info'
    handleGoogleLogin(new Event('retry'))
  }, delay)

  setStatus(
    `Google 로그인 ${upcomingAttempt}번째 자동 재시도를 준비하고 있습니다.`,
    'info',
    3600,
  )
  announceGoogleRetry(delay, reason, upcomingAttempt)
  return true
}

function activateEmailFallback() {
  encourageEmailFallback()
  if (elements.loginEmailForm instanceof HTMLFormElement) {
    if (state.auth.step !== 'code') {
      updateLoginFormState('idle')
    }
  }
  setLoginHelper('Google 로그인에 문제가 발생했습니다. 이메일 인증으로 계속 진행해주세요.', 'warning')
  if (elements.loginEmailInput instanceof HTMLInputElement) {
    window.requestAnimationFrame(() => elements.loginEmailInput.focus())
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

  if (elements.svgButton instanceof HTMLButtonElement) {
    if (isProcessing) {
      elements.svgButton.disabled = true
    } else {
      const hasSvgSelection = state.selectedResults.size > 0 || state.selectedUploads.size > 0
      elements.svgButton.disabled = !hasSvgSelection
    }
  }

  if (elements.svgColorSelect instanceof HTMLSelectElement) {
    elements.svgColorSelect.disabled = isProcessing
  }

  updateOperationAvailability()
  if (!isProcessing) {
    updateResultActionAvailability()
  }
}

function getCreditCost(action, count = 1) {
  const base = CREDIT_COSTS[action] ?? 0
  return base * Math.max(1, count)
}

function creditStateFromBalance(credits) {
  if (credits <= 0) return 'danger'
  if (credits <= 2) return 'warning'
  return 'success'
}

function findItemByTarget(target) {
  if (!target) return null
  const collection = target.type === 'upload' ? state.uploads : state.results
  return collection.find((item) => item.id === target.id) || null
}

function normalizeTarget(target) {
  if (!target || typeof target !== 'object') return null
  const { type, id } = target
  if ((type !== 'upload' && type !== 'result') || typeof id !== 'string' || !id) return null
  const collection = type === 'upload' ? state.uploads : state.results
  return collection.some((item) => item.id === id) ? { type, id } : null
}

function firstFromSet(value) {
  if (!(value instanceof Set) || value.size === 0) return null
  const iterator = value.values()
  const result = iterator.next()
  return result.done ? null : result.value
}

function resolveActiveTarget(preferred) {
  const candidates = []
  if (preferred) candidates.push(preferred)
  if (state.activeTarget) candidates.push(state.activeTarget)
  const primaryResult = firstFromSet(state.selectedResults)
  if (primaryResult) candidates.push({ type: 'result', id: primaryResult })
  const primaryUpload = firstFromSet(state.selectedUploads)
  if (primaryUpload) candidates.push({ type: 'upload', id: primaryUpload })
  if (state.results.length > 0) candidates.push({ type: 'result', id: state.results[0].id })
  if (state.uploads.length > 0) candidates.push({ type: 'upload', id: state.uploads[0].id })

  for (const candidate of candidates) {
    const normalized = normalizeTarget(candidate)
    if (normalized) {
      return normalized
    }
  }

  return null
}

function updateHeaderState() {
  const loggedIn = state.user.isLoggedIn || state.admin.isLoggedIn
  const creditsNumeric = Math.max(0, state.user.credits)
  const isAdmin = state.admin.isLoggedIn
  const isMichina = state.user.plan === 'michina' && !isAdmin
  const formattedCredits = formatCreditsValue(state.user.credits)

  if (elements.creditDisplay instanceof HTMLElement) {
    if (!loggedIn) {
      elements.creditDisplay.dataset.state = 'locked'
    } else if (isAdmin) {
      elements.creditDisplay.dataset.state = 'unlimited'
    } else {
      elements.creditDisplay.dataset.state = creditStateFromBalance(creditsNumeric)
    }
  }

  if (elements.planBadge instanceof HTMLElement) {
    elements.planBadge.textContent = getPlanLabel()
  }

  if (elements.creditLabel instanceof HTMLElement) {
    if (!loggedIn) {
      elements.creditLabel.textContent = '로그인하고 무료 30 크레딧 받기'
    } else if (isAdmin) {
      elements.creditLabel.textContent = '관리자 모드 · 무제한 이용'
    } else if (isMichina) {
      elements.creditLabel.textContent = '미치나 플랜 · 잔여 크레딧'
    } else {
      elements.creditLabel.textContent = 'Freemium · 잔여 크레딧'
    }
  }

  if (elements.creditCount instanceof HTMLElement) {
    elements.creditCount.textContent = formattedCredits
  }

  if (elements.headerAuthButton instanceof HTMLButtonElement) {
    elements.headerAuthButton.textContent = state.user.isLoggedIn ? '로그아웃' : '로그인'
    elements.headerAuthButton.dataset.action = state.user.isLoggedIn ? 'logout' : 'show-login'
  }

  if (elements.resultsCreditCount instanceof HTMLElement) {
    elements.resultsCreditCount.textContent = formattedCredits
  }
}

function setGateContent(element, { state, title, copy }) {
  if (!(element instanceof HTMLElement)) return
  element.dataset.state = state
  const titleElement = element.querySelector('.gate__title, .results-gate__title')
  if (titleElement) {
    titleElement.textContent = title
  }
  const copyElement = element.querySelector('.gate__copy, .results-gate__copy')
  if (copyElement) {
    copyElement.innerHTML = copy
  }
}

function updateOperationsGate() {
  const gate = elements.operationsGate
  if (!(gate instanceof HTMLElement)) return

  const loggedIn = state.user.isLoggedIn || state.admin.isLoggedIn
  const isAdmin = state.admin.isLoggedIn
  const isMichina = state.user.plan === 'michina' && !isAdmin
  const credits = Math.max(0, state.user.credits)
  const formattedCredits = formatCreditsValue(state.user.credits)

  let stateName = 'unlocked'
  let title = '작업 실행 크레딧 안내'
  let copy = `현재 잔여 크레딧: <strong>${formattedCredits}</strong> · 이미지당 ${CREDIT_COSTS.operation} 크레딧이 차감됩니다.`

  if (!loggedIn) {
    stateName = 'locked'
    title = '로그인 후 도구를 실행해 주세요.'
    copy = `실행 시 크레딧이 차감됩니다. 로그인하면 무료 ${FREEMIUM_INITIAL_CREDITS} 크레딧을 드립니다.`
  } else if (isAdmin) {
    stateName = 'success'
    title = '관리자 모드가 활성화되어 있습니다.'
    copy = '테스트를 위해 모든 기능을 무제한으로 사용할 수 있습니다.'
  } else if (isMichina) {
    stateName = 'success'
    title = '미치나 플랜이 활성화되어 있습니다.'
    copy = `미치나 플랜 잔여 크레딧 <strong>${formattedCredits}</strong>개 · 작업당 ${CREDIT_COSTS.operation} 크레딧이 차감됩니다.`
  } else if (credits <= 0) {
    stateName = 'danger'
    title = '크레딧이 부족합니다.'
    copy = '크레딧을 충전한 뒤 다시 시도해주세요.'
  } else if (credits <= 2) {
    stateName = 'warning'
    title = '잔여 크레딧이 적습니다.'
    copy = `남은 크레딧 <strong>${formattedCredits}</strong>개 · 이미지당 ${CREDIT_COSTS.operation} 크레딧이 사용됩니다.`
  }

  setGateContent(gate, { state: stateName, title, copy })

  const loginButton = gate.querySelector('[data-role="operations-gate-login"]')
  if (loginButton instanceof HTMLButtonElement) {
    loginButton.hidden = loggedIn
    if (loginButton.parentElement instanceof HTMLElement) {
      loginButton.parentElement.hidden = loggedIn
    }
  }
}

function updateResultsGate() {
  const gate = elements.resultsGate
  if (!(gate instanceof HTMLElement)) return

  const loggedIn = state.user.isLoggedIn || state.admin.isLoggedIn
  const isAdmin = state.admin.isLoggedIn
  const isMichina = state.user.plan === 'michina' && !isAdmin
  const credits = Math.max(0, state.user.credits)
  const formattedCredits = formatCreditsValue(state.user.credits)
  const hasResults = state.results.length > 0

  let stateName = 'unlocked'
  let title = '결과 저장 준비 완료'
  let copy = `남은 크레딧 <strong>${formattedCredits}</strong>개 · PNG→SVG 변환 ${CREDIT_COSTS.svg} 크레딧, 다운로드 ${CREDIT_COSTS.download} 크레딧이 차감됩니다.`

  if (!hasResults) {
    stateName = 'locked'
    title = '처리 결과를 먼저 만들어보세요.'
    copy = '좌측 도구로 결과를 생성하면 다운로드와 PNG→SVG 변환을 사용할 수 있어요.'
  } else if (!loggedIn) {
    stateName = 'locked'
    title = '로그인 후 결과를 저장할 수 있어요.'
    copy = `다운로드/벡터 변환 시 크레딧이 차감됩니다. 로그인하면 무료 ${FREEMIUM_INITIAL_CREDITS} 크레딧을 받습니다.`
  } else if (isAdmin) {
    stateName = 'success'
    title = '관리자 모드가 활성화되어 있습니다.'
    copy = '테스트를 위해 다운로드와 벡터 변환을 무제한으로 사용할 수 있습니다.'
  } else if (isMichina) {
    stateName = 'success'
    title = '미치나 플랜 잔여 크레딧 안내'
    copy = `미치나 플랜 잔여 크레딧 <strong>${formattedCredits}</strong>개 · PNG→SVG 변환 ${CREDIT_COSTS.svg} 크레딧, 다운로드 ${CREDIT_COSTS.download} 크레딧이 차감됩니다.`
  } else if (credits <= 0) {
    stateName = 'danger'
    title = '크레딧이 부족합니다.'
    copy = '크레딧을 충전한 뒤 다운로드하거나 변환을 시도하세요.'
  } else if (credits <= 1) {
    stateName = 'warning'
    title = '잔여 크레딧이 1개 이하입니다.'
    copy = `남은 크레딧 <strong>${formattedCredits}</strong>개 · PNG→SVG 변환은 이미지당 ${CREDIT_COSTS.svg} 크레딧이 필요합니다.`
  }

  setGateContent(gate, { state: stateName, title, copy })

  const loginButton = gate.querySelector('[data-role="results-gate-login"]')
  if (loginButton instanceof HTMLButtonElement) {
    loginButton.hidden = loggedIn
    if (loginButton.parentElement instanceof HTMLElement) {
      loginButton.parentElement.hidden = loggedIn
    }
  }

  if (elements.resultsCreditCount instanceof HTMLElement) {
    elements.resultsCreditCount.textContent = formattedCredits
  }
}

function updateAccessGates() {
  updateOperationsGate()
  updateResultsGate()
}

function getStageMessage(stageName) {
  const loggedIn = state.user.isLoggedIn
  const credits = Math.max(0, state.user.credits)

  switch (stageName) {
    case 'upload':
      return loggedIn
        ? `업로드한 이미지를 선택하고 다음 단계를 준비하세요. 현재 잔여 크레딧은 ${credits}개입니다.`
        : `로그인 전에 업로드 목록을 확인할 수 있어요. 계정을 연결하면 무료 ${FREEMIUM_INITIAL_CREDITS} 크레딧이 즉시 지급됩니다.`
    case 'refine':
      return loggedIn
        ? `도구 실행 시 이미지당 ${CREDIT_COSTS.operation} 크레딧이 차감됩니다. 남은 크레딧 ${credits}개로 편집을 진행해보세요.`
        : `도구 실행에는 로그인과 크레딧이 필요합니다. 로그인하면 무료 ${FREEMIUM_INITIAL_CREDITS} 크레딧으로 바로 시작할 수 있어요.`
    case 'export':
      return loggedIn
        ? `다운로드는 항목당 ${CREDIT_COSTS.download} 크레딧, PNG→SVG 변환은 ${CREDIT_COSTS.svg} 크레딧이 차감됩니다. 남은 크레딧 ${credits}개입니다.`
        : '로그인 후 결과를 다운로드하거나 PNG→SVG 변환을 이용할 수 있어요.'
    default:
      return ''
  }
}

function updateStageUI() {
  const stageIndex = STAGE_FLOW.indexOf(state.stage)

  if (elements.stageItems && typeof elements.stageItems.forEach === 'function') {
    elements.stageItems.forEach((item) => {
      if (!(item instanceof HTMLElement)) return
      const order = Number(item.dataset.stage) - 1
      const relation = order < stageIndex ? 'complete' : order === stageIndex ? 'active' : 'locked'
      item.dataset.state = relation
      item.classList.toggle('is-active', relation === 'active')
    })
  }

  if (elements.stageMessage instanceof HTMLElement) {
    elements.stageMessage.textContent = getStageMessage(state.stage)
  }
}

function setStage(stageName) {
  if (!STAGE_FLOW.includes(stageName)) return
  if (state.stage !== stageName) {
    state.stage = stageName
  }
  updateStageUI()
}

function recomputeStage() {
  let nextStage = 'upload'
  if (state.results.length > 0) {
    nextStage = 'export'
  } else if (state.uploads.length > 0) {
    nextStage = 'refine'
  }
  setStage(nextStage)
  updateAccessGates()
}

function refreshAccessStates() {
  updateHeaderState()
  updateAccessGates()
  updateStageUI()
  updatePlanExperience()
  updateNavigationAccess()
}

function canAccessView(rawView) {
  const view = typeof rawView === 'string' ? rawView.trim() : ''
  if (!view || view === 'home') {
    return true
  }
  if (view === 'community') {
    return state.user.isLoggedIn && state.user.plan === 'michina'
  }
  if (view === 'admin') {
    return state.admin.isLoggedIn
  }
  return false
}

function determineDefaultView() {
  return 'home'
}

function updateNavActiveState() {
  const buttons = elements.navButtons || []
  buttons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return
    const target = button.dataset.viewTarget || 'home'
    const isActive = state.view === target
    button.classList.toggle('is-active', isActive)
    if (isActive) {
      button.setAttribute('aria-current', 'page')
    } else {
      button.removeAttribute('aria-current')
    }
  })
}

function updateViewVisibility() {
  const sections = elements.viewSections || []
  sections.forEach((section) => {
    if (!(section instanceof HTMLElement)) return
    const target = section.dataset.view || 'home'
    const isActive = state.view === target
    section.hidden = !isActive
    section.classList.toggle('is-active-view', isActive)
  })
}

function setView(rawView, options = {}) {
  const requested = typeof rawView === 'string' && rawView.trim() ? rawView.trim() : 'home'
  const forceUpdate = Boolean(options.force)
  const bypassAccess = Boolean(options.bypassAccess)
  const accessible = bypassAccess || canAccessView(requested)
  const targetView = accessible ? requested : determineDefaultView()
  if (!forceUpdate && state.view === targetView) {
    updateNavActiveState()
    updateViewVisibility()
    if (document.body) {
      document.body.dataset.activeView = targetView
    }
    return targetView
  }
  state.view = targetView
  if (targetView === 'admin') {
    clearAdminNavHighlight()
    dismissAdminDashboardPrompt()
  }
  updateNavActiveState()
  updateViewVisibility()
  if (document.body) {
    document.body.dataset.activeView = targetView
  }
  return targetView
}

function handleNavigationClick(targetView) {
  const view = typeof targetView === 'string' ? targetView.trim() : ''
  if (!view || view === 'home') {
    setView('home')
    return
  }
  if (canAccessView(view)) {
    if (view === 'admin') {
      clearAdminNavHighlight()
    }
    setView(view)
    return
  }
  if (view === 'community') {
    if (!state.user.isLoggedIn && !state.admin.isLoggedIn) {
      setStatus('미치나 커뮤니티는 로그인 후 이용할 수 있습니다.', 'warning')
      openLoginModal()
    } else {
      setStatus('미치나 플랜 참가자로 등록된 계정만 접근할 수 있습니다.', 'warning')
    }
    return
  }
  if (view === 'admin') {
    setStatus('관리자 로그인이 필요합니다.', 'warning')
    openAdminModal()
  }
}

function updateNavigationAccess() {
  const buttons = elements.navButtons || []
  let requiresFallback = false

  buttons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return
    const target = button.dataset.viewTarget || 'home'
    const accessible = canAccessView(target)
    if (target === 'home') {
      button.hidden = false
      button.disabled = false
    } else {
      button.hidden = !accessible
      button.disabled = !accessible
    }
    if (!accessible && state.view === target) {
      requiresFallback = true
    }
  })

  if (requiresFallback) {
    setView(determineDefaultView(), { force: true, bypassAccess: runtime.allowViewBypass })
  } else {
    setView(state.view, { force: true, bypassAccess: runtime.allowViewBypass })
  }
}

function clearAdminNavHighlight() {
  if (adminNavHighlightTimer) {
    window.clearTimeout(adminNavHighlightTimer)
    adminNavHighlightTimer = null
  }
  if (elements.adminNavButton instanceof HTMLButtonElement) {
    elements.adminNavButton.classList.remove('nav-button--highlight')
  }
}

function highlightAdminNavButton(duration = 12000) {
  if (!(elements.adminNavButton instanceof HTMLButtonElement)) {
    return
  }
  clearAdminNavHighlight()
  elements.adminNavButton.classList.add('nav-button--highlight')
  adminNavHighlightTimer = window.setTimeout(() => {
    if (elements.adminNavButton instanceof HTMLButtonElement) {
      elements.adminNavButton.classList.remove('nav-button--highlight')
    }
    adminNavHighlightTimer = null
  }, Math.max(1000, duration))
}

function showAdminDashboardShortcut(options = {}) {
  if (!(elements.status instanceof HTMLElement)) {
    return
  }
  const { force = false } = options
  if (hasShownAdminDashboardPrompt && !force) {
    highlightAdminNavButton()
    return
  }

  hasShownAdminDashboardPrompt = true

  const existingActions = elements.status.querySelector('[data-role="status-actions"]')
  if (existingActions instanceof HTMLElement) {
    existingActions.remove()
  }

  const actions = document.createElement('span')
  actions.className = 'status__actions'
  actions.dataset.role = 'status-actions'

  const openButton = document.createElement('button')
  openButton.type = 'button'
  openButton.className = 'status__link status__link--primary'
  openButton.textContent = '대시보드 바로가기'
  openButton.addEventListener('click', () => {
    closeAdminModal()
    setView('admin')
    if (elements.adminDashboard instanceof HTMLElement) {
      elements.adminDashboard.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    if (elements.adminNavButton instanceof HTMLButtonElement) {
      elements.adminNavButton.focus()
    }
    dismissAdminDashboardPrompt()
    clearAdminNavHighlight()
  })
  actions.appendChild(openButton)

  let adminUrl = '/?view=admin'
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('view', 'admin')
    url.hash = ''
    adminUrl = url.toString()
  } catch (error) {
    // ignore URL parse errors
  }

  const newTabLink = document.createElement('a')
  newTabLink.href = adminUrl
  newTabLink.target = '_blank'
  newTabLink.rel = 'noopener noreferrer'
  newTabLink.className = 'status__link status__link--ghost'
  newTabLink.textContent = '새 탭에서 열기'
  newTabLink.addEventListener('click', () => {
    dismissAdminDashboardPrompt()
    clearAdminNavHighlight()
  })
  actions.appendChild(newTabLink)

  elements.status.appendChild(actions)
  elements.status.classList.add('status--interactive')
  highlightAdminNavButton()
}

function getActivePlanKey() {
  if (state.admin.isLoggedIn) return 'admin'
  if (state.user.plan === 'michina') return 'michina'
  if (state.user.isLoggedIn) return 'freemium'
  return 'public'
}

function updatePlanExperience() {
  const currentPlan = getActivePlanKey()
  const profile = state.challenge.profile
  const isExpired = Boolean(profile?.expired)

  if (elements.challengeSection instanceof HTMLElement) {
    let planState = 'guest'
    if (state.admin.isLoggedIn) {
      planState = 'admin'
    } else if (isExpired) {
      planState = 'expired'
    } else if (profile?.completed) {
      planState = 'completed'
    } else if (currentPlan === 'michina') {
      planState = 'michina'
    } else if (currentPlan === 'freemium') {
      planState = 'freemium'
    }
    elements.challengeSection.dataset.planState = planState
  }
}

function ensureActionAllowed(action, options = {}) {
  const count = options.count ?? 1
  const gateKey = options.gate === 'results' ? 'results' : 'operations'
  const cost = getCreditCost(action, count)
  const loggedIn = state.user.isLoggedIn || state.admin.isLoggedIn

  if (!loggedIn) {
    setStatus('로그인 후 이용 가능한 기능입니다.', 'danger')
    refreshAccessStates()
    openLoginModal()
    return false
  }

  if (hasUnlimitedAccess()) {
    return true
  }

  if (cost > 0 && state.user.credits < cost) {
    setStatus('크레딧이 부족합니다. 충전 후 다시 시도해주세요.', 'danger')
    const gateElement = gateKey === 'results' ? elements.resultsGate : elements.operationsGate
    if (gateElement instanceof HTMLElement) {
      gateElement.dataset.state = 'danger'
    }
    refreshAccessStates()
    return false
  }

  if (cost > 0 && state.user.credits <= 2) {
    const gateElement = gateKey === 'results' ? elements.resultsGate : elements.operationsGate
    if (gateElement instanceof HTMLElement && gateElement.dataset.state !== 'danger') {
      gateElement.dataset.state = 'warning'
      updateAccessGates()
    }
  }

  return true
}

function consumeCredits(action, count = 1) {
  const cost = getCreditCost(action, count)
  if (cost <= 0 || hasUnlimitedAccess()) return
  state.user.credits = Math.max(0, state.user.credits - cost)
  state.user.totalUsed += cost
  refreshAccessStates()
}

function applyLoginProfile({ name, email, credits = FREEMIUM_INITIAL_CREDITS, plan = 'freemium' } = {}) {
  const normalizedName = typeof name === 'string' && name.trim().length > 0 ? name.trim() : '크리에이터'
  state.user.isLoggedIn = true
  state.user.name = normalizedName
  state.user.email = typeof email === 'string' ? email : state.user.email
  state.user.plan = plan
  if (plan === 'michina' || plan === 'admin') {
    state.user.credits = Number.MAX_SAFE_INTEGER
  } else {
    state.user.credits = Math.max(state.user.credits, credits)
  }
  state.user.totalUsed = 0
  refreshAccessStates()
}

async function handleLogout() {
  try {
    await fetch('/api/auth/admin/logout', { method: 'POST' })
  } catch (error) {
    // ignore network errors
  }
  state.admin.isLoggedIn = false
  state.admin.email = ''
  state.admin.participants = []
  state.user.isLoggedIn = false
  state.user.name = ''
  state.user.email = ''
  state.user.plan = 'public'
  state.user.credits = 0
  state.user.totalUsed = 0
  state.challenge.profile = null
  state.challenge.certificate = null
  hasShownAdminDashboardPrompt = false
  dismissAdminDashboardPrompt()
  clearAdminNavHighlight()
  setView('home', { force: true })
  refreshAccessStates()
  renderChallengeDashboard()
  setStatus('로그아웃되었습니다. 언제든 다시 로그인하여 편집을 이어가세요.', 'info')
  resetLoginFlow()
  clearAdminCooldown()
  updateAdminUI()
}

function clearAdminCooldown(restoreForm = true) {
  if (runtime.admin.cooldownTimer) {
    window.clearTimeout(runtime.admin.cooldownTimer)
  }
  runtime.admin.cooldownTimer = null
  runtime.admin.cooldownUntil = 0
  if (!restoreForm) {
    return
  }
  if (elements.adminLoginForm instanceof HTMLFormElement && elements.adminLoginForm.dataset.state === 'cooldown') {
    elements.adminLoginForm.dataset.state = 'idle'
  }
  const controls = [elements.adminEmailInput, elements.adminPasswordInput, elements.adminLoginForm?.querySelector('button[type="submit"]')]
  controls.forEach((control) => {
    if (control instanceof HTMLElement) {
      control.removeAttribute('disabled')
    }
  })
}

function startAdminCooldown(durationMs = 15000) {
  if (!(elements.adminLoginForm instanceof HTMLFormElement)) return
  const normalized = Math.max(3000, durationMs)
  clearAdminCooldown(false)
  const end = Date.now() + normalized
  runtime.admin.cooldownUntil = end
  elements.adminLoginForm.dataset.state = 'cooldown'
  const controls = [elements.adminEmailInput, elements.adminPasswordInput, elements.adminLoginForm.querySelector('button[type="submit"]')]
  controls.forEach((control) => {
    if (control instanceof HTMLElement) {
      control.setAttribute('disabled', 'true')
    }
  })
  const update = () => {
    const remaining = Math.max(0, runtime.admin.cooldownUntil - Date.now())
    if (remaining <= 0) {
      clearAdminCooldown()
      setAdminMessage('다시 시도할 수 있습니다. 정확한 관리자 자격을 입력해주세요.', 'info')
      return
    }
    const seconds = Math.max(1, Math.ceil(remaining / 1000))
    setAdminMessage(`보안 보호를 위해 ${seconds}초 뒤에 다시 시도할 수 있습니다.`, 'warning')
    runtime.admin.cooldownTimer = window.setTimeout(update, 1000)
  }
  update()
}

function setAdminMessage(message = '', tone = 'info') {
  if (!(elements.adminLoginMessage instanceof HTMLElement)) return
  elements.adminLoginMessage.textContent = message
  elements.adminLoginMessage.hidden = !message
  elements.adminLoginMessage.dataset.tone = tone
}

function openAdminModal() {
  if (!(elements.adminModal instanceof HTMLElement)) return
  const isAdmin = state.admin.isLoggedIn

  if (isAdmin) {
    setAdminMessage('', 'info')
    setStatus('관리자 모드가 활성화되어 있습니다. 필요한 작업을 선택하세요.', 'info')
  } else {
    setAdminMessage('등록된 관리자만 접근할 수 있습니다.', 'muted')
    if (elements.adminLoginForm instanceof HTMLFormElement) {
      elements.adminLoginForm.dataset.state = 'idle'
      elements.adminLoginForm.reset()
    }
    if (elements.adminPasswordInput instanceof HTMLInputElement) {
      elements.adminPasswordInput.value = ''
    }
    if (elements.adminEmailInput instanceof HTMLInputElement) {
      elements.adminEmailInput.value = state.admin.email || ''
    }
  }

  updateAdminModalState()

  elements.adminModal.classList.add('is-active')
  elements.adminModal.setAttribute('aria-hidden', 'false')
  document.body.classList.add('is-modal-open')

  window.requestAnimationFrame(() => {
    if (isAdmin) {
      if (elements.adminModalDashboardButton instanceof HTMLButtonElement) {
        elements.adminModalDashboardButton.focus()
        return
      }
      if (elements.adminModalLogoutButton instanceof HTMLButtonElement) {
        elements.adminModalLogoutButton.focus()
        return
      }
    }
    if (elements.adminEmailInput instanceof HTMLInputElement) {
      elements.adminEmailInput.focus()
    }
  })
}

function closeAdminModal() {
  if (!(elements.adminModal instanceof HTMLElement)) return
  elements.adminModal.classList.remove('is-active')
  elements.adminModal.setAttribute('aria-hidden', 'true')
  document.body.classList.remove('is-modal-open')
}

function revokeAdminSessionState() {
  const wasAdmin = state.admin.isLoggedIn
  state.admin.isLoggedIn = false
  state.admin.email = ''
  state.admin.participants = []
  if (state.user.plan === 'admin') {
    state.user.isLoggedIn = false
    state.user.name = ''
    state.user.email = ''
    state.user.plan = 'public'
    state.user.credits = 0
    state.user.totalUsed = 0
  }
  hasShownAdminDashboardPrompt = false
  dismissAdminDashboardPrompt()
  clearAdminNavHighlight()
  if (wasAdmin) {
    refreshAccessStates()
    updateAdminUI()
  }
}

async function syncAdminSession() {
  try {
    const response = await fetch('/api/auth/session', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'include',
    })
    if (!response.ok) {
      revokeAdminSessionState()
      return
    }
    const payload = await response.json().catch(() => ({}))
    if (payload && payload.admin) {
      const email = typeof payload.email === 'string' ? payload.email : ''
      state.admin.isLoggedIn = true
      state.admin.email = email
      applyLoginProfile({ name: '관리자', email, plan: 'admin', credits: Number.MAX_SAFE_INTEGER })
      updateAdminUI()
      if (runtime.initialView === 'admin') {
        setView('admin', { force: true })
      }
      await fetchAdminParticipants()
      announceAdminDashboardAccess()
    } else {
      revokeAdminSessionState()
    }
  } catch (error) {
    console.warn('관리자 세션 확인 중 오류', error)
  }
}

function formatDateLabel(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('ko', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function isPlanExpired(endDate) {
  if (!endDate) return false
  const timestamp = Date.parse(endDate)
  if (Number.isNaN(timestamp)) return false
  return timestamp < Date.now()
}

function renderAdminParticipants() {
  if (!(elements.adminParticipantsBody instanceof HTMLElement)) return
  if (!state.admin.isLoggedIn) {
    elements.adminParticipantsBody.innerHTML = '<tr><td colspan="5">관리자 로그인 후 참가자 정보를 확인할 수 있습니다.</td></tr>'
    return
  }
  if (!Array.isArray(state.admin.participants) || state.admin.participants.length === 0) {
    elements.adminParticipantsBody.innerHTML = '<tr><td colspan="5">등록된 참가자가 없습니다. CSV 업로드 또는 수동 입력으로 참가자를 추가하세요.</td></tr>'
    return
  }
  const rows = state.admin.participants
    .map((participant) => {
      const total = Number(participant.totalSubmissions ?? Object.keys(participant.submissions ?? {}).length ?? 0)
      const required = Number(participant.required ?? 15)
      const missing = Number(participant.missingDays ?? Math.max(0, required - total))
      const progress = required > 0 ? Math.min(100, Math.round((total / required) * 100)) : 0
      const status = participant.completed
        ? '완주'
        : missing === 0
          ? '검토 필요'
          : `미제출 ${missing}`
      const statusClass = participant.completed ? 'is-completed' : missing === 0 ? 'is-review' : 'is-active'
      const range = `${formatDateLabel(participant.startDate)} ~ ${formatDateLabel(participant.endDate)}`
      const nameLabel = participant.name ? `${participant.name} (${participant.email})` : participant.email
      return `
        <tr>
          <td>${nameLabel}</td>
          <td>
            <div class="challenge-progress-bar">
              <div class="challenge-progress-bar__meter" style="width:${progress}%"></div>
              <span class="challenge-progress-bar__label">${total}/${required}</span>
            </div>
          </td>
          <td>${missing}</td>
          <td>${range}</td>
          <td><span class="challenge-status ${statusClass}">${status}</span></td>
        </tr>
      `
    })
    .join('')
  elements.adminParticipantsBody.innerHTML = rows
}

function updateAdminModalState() {
  const isAdmin = state.admin.isLoggedIn

  if (elements.adminLoginForm instanceof HTMLFormElement) {
    elements.adminLoginForm.hidden = isAdmin
  }

  if (elements.adminModalActions instanceof HTMLElement) {
    elements.adminModalActions.hidden = !isAdmin
  }

  if (elements.adminModalSubtitle instanceof HTMLElement) {
    elements.adminModalSubtitle.textContent = isAdmin
      ? '관리자 모드가 활성화되어 있습니다. 아래 바로가기를 사용해 대시보드를 열거나 로그아웃할 수 있어요.'
      : '등록된 관리자만 접근할 수 있습니다. 자격 증명을 안전하게 입력하세요.'
  }
}

function updateAdminUI() {
  const isAdmin = state.admin.isLoggedIn
  if (!isAdmin) {
    clearAdminNavHighlight()
  }
  updateAdminModalState()
  if (elements.adminDashboard instanceof HTMLElement) {
    elements.adminDashboard.hidden = !isAdmin
  }
  if (elements.adminCategoryBadge instanceof HTMLElement) {
    elements.adminCategoryBadge.hidden = !isAdmin
    if (isAdmin) {
      elements.adminCategoryBadge.textContent = '카테고리: 미치나'
    }
  }
  if (elements.adminLoginButton instanceof HTMLButtonElement) {
    elements.adminLoginButton.textContent = isAdmin ? '관리자 패널' : '관리자 전용'
    elements.adminLoginButton.dataset.mode = isAdmin ? 'panel' : 'login'
  }
  if (elements.adminNavButton instanceof HTMLButtonElement) {
    elements.adminNavButton.hidden = !isAdmin
    elements.adminNavButton.disabled = !isAdmin
    if (isAdmin) {
      elements.adminNavButton.removeAttribute('aria-disabled')
    } else {
      elements.adminNavButton.setAttribute('aria-disabled', 'true')
    }
  }
  if (isAdmin && !hasAnnouncedAdminNav) {
    hasAnnouncedAdminNav = true
    window.setTimeout(() => {
      if (elements.adminNavButton instanceof HTMLButtonElement && document.body.contains(elements.adminNavButton)) {
        elements.adminNavButton.focus()
      }
    }, 150)
  } else if (!isAdmin && hasAnnouncedAdminNav) {
    hasAnnouncedAdminNav = false
  }
  if (elements.adminRunCompletionButton instanceof HTMLButtonElement) {
    elements.adminRunCompletionButton.disabled = !isAdmin
  }
  if (elements.adminRefreshButton instanceof HTMLButtonElement) {
    elements.adminRefreshButton.disabled = !isAdmin
  }
  if (elements.adminDownloadCompletion instanceof HTMLButtonElement) {
    elements.adminDownloadCompletion.disabled = !isAdmin
  }
  if (elements.adminLogoutButton instanceof HTMLButtonElement) {
    elements.adminLogoutButton.disabled = !isAdmin
  }
  if (elements.adminImportForm instanceof HTMLFormElement) {
    elements.adminImportForm.classList.toggle('is-disabled', !isAdmin)
  }
  renderAdminParticipants()
}

function getOrCreateAdminDashboardPrompt() {
  let prompt = document.querySelector('[data-role="admin-dashboard-prompt"]')
  if (!(prompt instanceof HTMLElement)) {
    prompt = document.createElement('div')
    prompt.dataset.role = 'admin-dashboard-prompt'
    prompt.className = 'admin-dashboard-prompt'
    prompt.innerHTML = `
      <div class="admin-dashboard-prompt__body" role="alert" aria-live="assertive">
        <strong class="admin-dashboard-prompt__title">관리자 대시보드 안내</strong>
        <p class="admin-dashboard-prompt__description">
          관리자 대시보드는 상단 내비게이션의 <span class="admin-dashboard-prompt__highlight">관리자 대시보드</span> 섹션에서 확인할 수 있습니다. 동일 창 이동 또는 새 탭 열기 중 원하는 방식을 선택해 주세요.
        </p>
        <div class="admin-dashboard-prompt__actions">
          <button type="button" class="admin-dashboard-prompt__action" data-action="open-admin-dashboard" data-open-target="self">
            현재 페이지에서 이동
          </button>
          <button type="button" class="admin-dashboard-prompt__action admin-dashboard-prompt__action--secondary" data-action="open-admin-dashboard" data-open-target="new">
            새 탭에서 열기
          </button>
        </div>
        <button type="button" class="admin-dashboard-prompt__close" data-action="dismiss-admin-dashboard-prompt" aria-label="안내 닫기">
          <span aria-hidden="true">×</span>
        </button>
      </div>
    `
    prompt.hidden = true
    document.body.appendChild(prompt)
  }
  return prompt
}

function announceAdminDashboardAccess(options = {}) {
  if (!state.admin.isLoggedIn) {
    return
  }
  if (hasShownAdminDashboardPrompt && !options.force) {
    return
  }

  const prompt = getOrCreateAdminDashboardPrompt()
  prompt.hidden = false
  window.requestAnimationFrame(() => {
    prompt.classList.add('is-visible')
  })

  const primaryAction = prompt.querySelector('[data-open-target="self"]')
  if (primaryAction instanceof HTMLElement) {
    window.requestAnimationFrame(() => {
      primaryAction.focus()
    })
  }

  const duration = Number.isFinite(options.duration) ? options.duration : 8000
  const dashboardUrl = `${window.location.origin.replace(/\/$/, '')}/?view=admin`
  setStatus({
    html: `
      <span><strong>관리자 로그인 완료!</strong> 대시보드를 현재 페이지에서 열거나 새 탭으로 띄울 수 있습니다.</span>
      <div class="status__actions" role="group" aria-label="관리자 대시보드 바로가기">
        <button type="button" class="status__link status__link--primary" data-action="open-admin-dashboard" data-open-target="self">
          대시보드 이동
        </button>
        <a href="${dashboardUrl}" class="status__link status__link--ghost" data-action="open-admin-dashboard" data-open-target="new" target="_blank" rel="noopener">
          새 탭에서 열기
        </a>
      </div>
    `,
    tone: options.tone || 'success',
    duration,
    interactive: true,
  })

  showAdminDashboardShortcut({ force: Boolean(options.force) })

  hasShownAdminDashboardPrompt = true
}

function dismissAdminDashboardPrompt() {
  const prompt = document.querySelector('[data-role="admin-dashboard-prompt"]')
  if (!(prompt instanceof HTMLElement)) {
    return
  }
  prompt.classList.remove('is-visible')
  window.setTimeout(() => {
    prompt.hidden = true
  }, 220)
}

document.addEventListener('click', (event) => {
  const origin = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null
  if (!(origin instanceof HTMLElement)) {
    return
  }
  const action = origin.dataset.action
  if (action === 'open-admin-dashboard') {
    event.preventDefault()
    const openTarget = origin.dataset.openTarget || 'self'
    const dashboardUrl = `${window.location.origin.replace(/\/$/, '')}/?view=admin`
    if (openTarget === 'new') {
      window.open(dashboardUrl, '_blank', 'noopener')
    } else {
      setView('admin', { force: true })
      if (elements.adminDashboard instanceof HTMLElement) {
        elements.adminDashboard.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    dismissAdminDashboardPrompt()
    clearAdminNavHighlight()
  } else if (action === 'dismiss-admin-dashboard-prompt') {
    event.preventDefault()
    dismissAdminDashboardPrompt()
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return
  }
  const prompt = document.querySelector('[data-role="admin-dashboard-prompt"]')
  if (prompt instanceof HTMLElement && prompt.classList.contains('is-visible')) {
    dismissAdminDashboardPrompt()
  }
})

function parseManualParticipants(input) {
  if (typeof input !== 'string' || !input.trim()) return []
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [emailRaw, nameRaw, endDateRaw] = line.split(',').map((part) => part.trim())
      if (!isValidEmail(emailRaw)) {
        return null
      }
      const entry = { email: emailRaw.toLowerCase() }
      if (nameRaw) entry.name = nameRaw
      if (endDateRaw && !Number.isNaN(Date.parse(endDateRaw))) {
        entry.endDate = new Date(endDateRaw).toISOString()
      }
      return entry
    })
    .filter(Boolean)
}

function parseCsvParticipants(text) {
  if (typeof text !== 'string' || !text.trim()) return []
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length === 0) return []
  const entries = []
  for (const line of lines) {
    const sanitized = line.trim()
    if (!sanitized) continue
    const parts = sanitized.split(',').map((part) => part.replace(/^"|"$/g, '').trim())
    if (parts.length === 0) continue
    const [emailRaw, nameRaw, endDateRaw] = parts
    if (!isValidEmail(emailRaw) || /email/i.test(emailRaw)) {
      continue
    }
    const entry = { email: emailRaw.toLowerCase() }
    if (nameRaw) entry.name = nameRaw
    if (endDateRaw && !Number.isNaN(Date.parse(endDateRaw))) {
      entry.endDate = new Date(endDateRaw).toISOString()
    }
    entries.push(entry)
  }
  return entries
}

function dedupeParticipants(entries) {
  const map = new Map()
  for (const entry of entries) {
    if (!entry || !entry.email) continue
    if (!map.has(entry.email)) {
      map.set(entry.email, entry)
    } else {
      const existing = map.get(entry.email)
      map.set(entry.email, {
        ...existing,
        ...entry,
        name: entry.name || existing.name,
        endDate: entry.endDate || existing.endDate,
      })
    }
  }
  return Array.from(map.values())
}

async function fetchAdminParticipants() {
  if (!state.admin.isLoggedIn) {
    renderAdminParticipants()
    return []
  }
  try {
    const response = await fetch('/api/admin/challenge/participants', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'include',
    })
    if (response.status === 401) {
      revokeAdminSessionState()
      setStatus('관리자 세션이 만료되었습니다. 다시 로그인해 주세요.', 'danger')
      return []
    }
    if (!response.ok) {
      throw new Error(`participants_fetch_failed_${response.status}`)
    }
    const payload = await response.json().catch(() => ({}))
    if (Array.isArray(payload.participants)) {
      state.admin.participants = payload.participants
    } else {
      state.admin.participants = []
    }
    renderAdminParticipants()
    return state.admin.participants
  } catch (error) {
    console.error('참가자 목록을 불러오지 못했습니다.', error)
    setStatus('참가자 목록을 불러오는 중 오류가 발생했습니다.', 'danger')
    return []
  }
}

async function handleAdminLogin(event) {
  event.preventDefault()
  if (!(elements.adminLoginForm instanceof HTMLFormElement)) return
  if (elements.adminLoginForm.dataset.state === 'loading') return

  if (runtime.admin.cooldownUntil && Date.now() < runtime.admin.cooldownUntil) {
    const seconds = Math.max(1, Math.ceil((runtime.admin.cooldownUntil - Date.now()) / 1000))
    setAdminMessage(`보안 보호를 위해 ${seconds}초 뒤에 다시 시도할 수 있습니다.`, 'warning')
    return
  }

  clearAdminCooldown()

  const email = elements.adminEmailInput instanceof HTMLInputElement ? elements.adminEmailInput.value.trim().toLowerCase() : ''
  const password = elements.adminPasswordInput instanceof HTMLInputElement ? elements.adminPasswordInput.value : ''

  if (!isValidEmail(email)) {
    setAdminMessage('유효한 관리자 이메일을 입력해주세요.', 'danger')
    if (elements.adminEmailInput instanceof HTMLInputElement) {
      elements.adminEmailInput.setAttribute('aria-invalid', 'true')
      elements.adminEmailInput.focus()
    }
    return
  }
  if (!password) {
    setAdminMessage('비밀번호를 입력해주세요.', 'danger')
    if (elements.adminPasswordInput instanceof HTMLInputElement) {
      elements.adminPasswordInput.setAttribute('aria-invalid', 'true')
      elements.adminPasswordInput.focus()
    }
    return
  }

  if (elements.adminEmailInput instanceof HTMLInputElement) {
    elements.adminEmailInput.removeAttribute('aria-invalid')
  }
  if (elements.adminPasswordInput instanceof HTMLInputElement) {
    elements.adminPasswordInput.removeAttribute('aria-invalid')
  }

  elements.adminLoginForm.dataset.state = 'loading'
  setAdminMessage('관리자 자격을 확인하는 중입니다…', 'info')

  const submitButton = elements.adminLoginForm.querySelector('button[type="submit"]')
  if (submitButton instanceof HTMLButtonElement) {
    submitButton.disabled = true
  }

  try {
    const response = await fetch('/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) {
      if (response.status === 401) {
        setAdminMessage('관리자 인증에 실패했습니다. 이메일 또는 비밀번호를 확인하세요.', 'danger')
        if (elements.adminEmailInput instanceof HTMLInputElement) {
          elements.adminEmailInput.setAttribute('aria-invalid', 'true')
        }
        if (elements.adminPasswordInput instanceof HTMLInputElement) {
          elements.adminPasswordInput.setAttribute('aria-invalid', 'true')
          elements.adminPasswordInput.value = ''
          elements.adminPasswordInput.focus()
        }
        runtime.admin.retryCount += 1
        if (runtime.admin.retryCount >= 3) {
          startAdminCooldown(20000)
          runtime.admin.retryCount = 0
        }
      } else if (response.status === 429) {
        const detail = await response.json().catch(() => ({}))
        const retryAfterSeconds = Number(detail?.retryAfter ?? 0)
        const boundedSeconds = Number.isFinite(retryAfterSeconds) ? Math.max(1, Math.ceil(retryAfterSeconds)) : 0
        const message =
          boundedSeconds > 0
            ? `로그인 시도가 너무 많습니다. 약 ${boundedSeconds}초 후 다시 시도해주세요.`
            : '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.'
        setAdminMessage(message, 'danger')
        const cooldownMs = boundedSeconds > 0 ? boundedSeconds * 1000 : 20000
        startAdminCooldown(Math.max(15000, cooldownMs))
        runtime.admin.retryCount = 0
      } else if (response.status === 500) {
        setAdminMessage('관리자 인증이 구성되지 않았습니다. 서버 환경 변수를 확인하세요.', 'danger')
        startAdminCooldown(12000)
        runtime.admin.retryCount = 0
      } else {
        setAdminMessage(`관리자 로그인 중 오류(${response.status})가 발생했습니다.`, 'danger')
        runtime.admin.retryCount += 1
        if (runtime.admin.retryCount >= 2) {
          startAdminCooldown(12000)
          runtime.admin.retryCount = 0
        }
      }
      return
    }
    const payload = await response.json().catch(() => ({}))
    const sessionEmail = typeof payload?.email === 'string' ? payload.email : email
    runtime.admin.retryCount = 0
    clearAdminCooldown()
    state.admin.isLoggedIn = true
    state.admin.email = sessionEmail
    applyLoginProfile({ name: '관리자', email: sessionEmail, plan: 'admin', credits: Number.MAX_SAFE_INTEGER })
    refreshAccessStates()
    closeAdminModal()
    announceAdminDashboardAccess({ force: true })
    await fetchAdminParticipants()
    updateAdminUI()
    if (elements.adminPasswordInput instanceof HTMLInputElement) {
      elements.adminPasswordInput.value = ''
      elements.adminPasswordInput.removeAttribute('aria-invalid')
    }
    if (elements.adminEmailInput instanceof HTMLInputElement) {
      elements.adminEmailInput.removeAttribute('aria-invalid')
    }
  } catch (error) {
    console.error('관리자 로그인 중 오류', error)
    setAdminMessage('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'danger')
    runtime.admin.retryCount += 1
    if (runtime.admin.retryCount >= 2) {
      startAdminCooldown(10000)
      runtime.admin.retryCount = 0
    }
  } finally {
    if (elements.adminLoginForm instanceof HTMLFormElement && elements.adminLoginForm.dataset.state !== 'cooldown') {
      elements.adminLoginForm.dataset.state = 'idle'
      const submit = elements.adminLoginForm.querySelector('button[type="submit"]')
      if (submit instanceof HTMLButtonElement) {
        submit.disabled = false
      }
      const controls = [elements.adminEmailInput, elements.adminPasswordInput]
      controls.forEach((control) => {
        if (control instanceof HTMLElement) {
          control.removeAttribute('disabled')
        }
      })
    }
  }
}

async function handleAdminImport(event) {
  event.preventDefault()
  if (!state.admin.isLoggedIn) {
    setStatus('관리자 로그인 후 사용할 수 있습니다.', 'danger')
    openAdminModal()
    return
  }
  if (!(elements.adminImportForm instanceof HTMLFormElement)) return
  if (elements.adminImportForm.dataset.state === 'loading') return

  elements.adminImportForm.dataset.state = 'loading'
  setStatus('참가자 명단을 등록하는 중입니다…', 'info')

  try {
    const manualEntries = elements.adminImportManual instanceof HTMLTextAreaElement ? parseManualParticipants(elements.adminImportManual.value) : []
    let fileEntries = []
    if (elements.adminImportFile instanceof HTMLInputElement && elements.adminImportFile.files && elements.adminImportFile.files.length > 0) {
      const file = elements.adminImportFile.files[0]
      const text = await file.text()
      fileEntries = parseCsvParticipants(text)
    }

    const combined = dedupeParticipants([...fileEntries, ...manualEntries])
    if (combined.length === 0) {
      setStatus('등록할 유효한 참가자 정보를 찾지 못했습니다.', 'danger')
      return
    }

    let endDateIso
    if (elements.adminImportEndDate instanceof HTMLInputElement && elements.adminImportEndDate.value) {
      const parsed = new Date(elements.adminImportEndDate.value)
      if (!Number.isNaN(parsed.getTime())) {
        endDateIso = parsed.toISOString()
      }
    }

    const response = await fetch('/api/admin/challenge/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        participants: combined,
        endDate: endDateIso,
      }),
    })

    if (response.status === 401) {
      revokeAdminSessionState()
      setStatus('관리자 세션이 만료되었습니다. 다시 로그인해 주세요.', 'danger')
      openAdminModal()
      return
    }

    if (!response.ok) {
      const errorDetail = await response.json().catch(() => ({}))
      const message = typeof errorDetail?.error === 'string' ? errorDetail.error : `오류 코드 ${response.status}`
      setStatus(`참가자 등록에 실패했습니다. (${message})`, 'danger')
      return
    }

    const payload = await response.json().catch(() => ({}))
    setStatus(`참가자 ${payload?.imported ?? combined.length}명을 등록했습니다.`, 'success')
    if (elements.adminImportForm instanceof HTMLFormElement) {
      elements.adminImportForm.reset()
    }
    if (elements.adminImportFile instanceof HTMLInputElement) {
      elements.adminImportFile.value = ''
    }
    if (elements.adminImportManual instanceof HTMLTextAreaElement) {
      elements.adminImportManual.value = ''
    }
    await fetchAdminParticipants()
    updateAdminUI()
  } catch (error) {
    console.error('참가자 등록 중 오류', error)
    setStatus('참가자 명단을 등록하는 중 오류가 발생했습니다.', 'danger')
  } finally {
    if (elements.adminImportForm instanceof HTMLFormElement) {
      elements.adminImportForm.dataset.state = 'idle'
    }
  }
}

async function handleAdminRefresh() {
  if (!state.admin.isLoggedIn) {
    openAdminModal()
    return
  }
  await fetchAdminParticipants()
}

async function handleAdminRunCompletion() {
  if (!state.admin.isLoggedIn) {
    setStatus('관리자 로그인 후 사용할 수 있습니다.', 'danger')
    openAdminModal()
    return
  }
  try {
    const response = await fetch('/api/admin/challenge/run-completion-check', {
      method: 'POST',
      credentials: 'include',
    })
    if (response.status === 401) {
      revokeAdminSessionState()
      setStatus('관리자 세션이 만료되었습니다. 다시 로그인해 주세요.', 'danger')
      openAdminModal()
      return
    }
    if (!response.ok) {
      throw new Error(`completion_check_failed_${response.status}`)
    }
    const payload = await response.json().catch(() => ({}))
    const newlyCompleted = Number(payload.newlyCompleted ?? 0)
    setStatus(`완주 판별이 완료되었습니다. 새롭게 완주로 판정된 인원 ${newlyCompleted}명`, 'success')
    await fetchAdminParticipants()
  } catch (error) {
    console.error('완주 판별 실행 중 오류', error)
    setStatus('완주 판별 실행 중 오류가 발생했습니다.', 'danger')
  }
}

async function handleAdminDownloadCompletion() {
  if (!state.admin.isLoggedIn) {
    setStatus('관리자 로그인 후 사용할 수 있습니다.', 'danger')
    openAdminModal()
    return
  }
  try {
    const response = await fetch('/api/admin/challenge/completions?format=csv', {
      credentials: 'include',
    })
    if (response.status === 401) {
      revokeAdminSessionState()
      setStatus('관리자 세션이 만료되었습니다. 다시 로그인해 주세요.', 'danger')
      openAdminModal()
      return
    }
    if (!response.ok) {
      throw new Error(`csv_download_failed_${response.status}`)
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `michina-completions-${Date.now()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setStatus('완주자 CSV 파일을 다운로드했습니다.', 'success')
  } catch (error) {
    console.error('완주자 CSV 다운로드 중 오류', error)
    setStatus('완주자 CSV를 다운로드하는 중 오류가 발생했습니다.', 'danger')
  }
}

function formatSubmissionTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function clearChallengeSubmissionForm() {
  if (elements.challengeSubmitForm instanceof HTMLFormElement) {
    elements.challengeSubmitForm.reset()
  }
  if (elements.challengeUrlInput instanceof HTMLInputElement) {
    elements.challengeUrlInput.value = ''
  }
  if (elements.challengeFileInput instanceof HTMLInputElement) {
    elements.challengeFileInput.value = ''
  }
}

function renderChallengeProgress(profile) {
  if (!(elements.challengeProgress instanceof HTMLElement)) return
  if (!profile) {
    elements.challengeProgress.innerHTML = '<p class="challenge-progress__empty">참가자로 등록되면 진행률이 표시됩니다.</p>'
    return
  }
  const required = Number(profile.required ?? 15)
  const total = Number(profile.totalSubmissions ?? Object.keys(profile.submissions ?? {}).length)
  const percent = required > 0 ? Math.min(100, Math.round((total / required) * 100)) : 0
  const remaining = Math.max(0, required - total)
  const deadline = formatDateLabel(profile.endDate)
  elements.challengeProgress.innerHTML = `
    <div class="challenge-progress__bar">
      <div class="challenge-progress__meter" style="width:${percent}%"></div>
    </div>
    <p class="challenge-progress__label">총 ${required}회 중 <strong>${total}</strong>회 제출 완료 (${percent}%)</p>
    <p class="challenge-progress__meta">남은 제출 <strong>${remaining}</strong>회 · 종료일 ${deadline}</p>
  `
}

function renderChallengeDays(profile) {
  if (!(elements.challengeDays instanceof HTMLElement)) return
  if (!profile) {
    elements.challengeDays.innerHTML = ''
    return
  }
  const required = Number(profile.required ?? 15)
  const submissions = profile.submissions ?? {}
  const totalSubmitted = Object.keys(submissions).length
  const nextDay = Math.min(required, totalSubmitted + 1)
  const items = []
  for (let day = 1; day <= required; day += 1) {
    const submission = submissions[String(day)]
    let statusText = '예정'
    let className = 'is-upcoming'
    if (submission) {
      const typeLabel = submission.type === 'image' ? '이미지' : 'URL'
      statusText = `${typeLabel} 제출 · ${formatSubmissionTimestamp(submission.submittedAt)}`
      className = 'is-complete'
    } else if (profile.completed) {
      statusText = '완주 완료'
      className = 'is-complete'
    } else if (day === nextDay) {
      statusText = '제출 대기'
      className = 'is-current'
    } else if (day < nextDay) {
      statusText = '기록 없음'
      className = 'is-pending'
    }
    items.push(`
      <li class="challenge-day ${className}" data-day="${day}">
        <span class="challenge-day__index">Day ${day}</span>
        <span class="challenge-day__status">${statusText}</span>
      </li>
    `)
  }
  elements.challengeDays.innerHTML = items.join('')
}

function updateChallengeSubmitState(profile) {
  const isSubmitting = state.challenge.submitting
  const submitButton = elements.challengeSubmitForm?.querySelector('button[type="submit"]')
  const controls = [elements.challengeDaySelect, elements.challengeUrlInput, elements.challengeFileInput]
  if (!(elements.challengeSubmitForm instanceof HTMLFormElement)) return
  if (!profile) {
    elements.challengeSubmitForm.dataset.state = 'locked'
    elements.challengeSubmitForm.hidden = true
    controls.forEach((control) => {
      if (control instanceof HTMLElement) control.setAttribute('disabled', 'true')
    })
    if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true
    if (elements.challengeSubmitHint instanceof HTMLElement) {
      elements.challengeSubmitHint.textContent = '참가자 등록 후 제출 기능을 이용할 수 있습니다.'
    }
    return
  }
  elements.challengeSubmitForm.hidden = false
  const isCompleted = Boolean(profile.completed)
  elements.challengeSubmitForm.dataset.state = isSubmitting ? 'loading' : isCompleted ? 'completed' : 'active'
  controls.forEach((control) => {
    if (!(control instanceof HTMLElement)) return
    if (isSubmitting || isCompleted) {
      control.setAttribute('disabled', 'true')
    } else {
      control.removeAttribute('disabled')
    }
  })
  if (submitButton instanceof HTMLButtonElement) {
    submitButton.disabled = isSubmitting || isCompleted
  }
  if (elements.challengeSubmitHint instanceof HTMLElement) {
    if (isCompleted) {
      elements.challengeSubmitHint.textContent = '축하합니다! 이미 완주하셨습니다. 수정이 필요하면 관리자에게 문의하세요.'
    } else {
      elements.challengeSubmitHint.textContent = 'URL 또는 이미지를 첨부해 제출하세요. 파일을 선택하면 URL보다 우선합니다.'
    }
  }
}

function buildCertificateMarkup(certificate) {
  if (!certificate) return ''
  const issueDate = formatDateLabel(certificate.completedAt)
  const range = `${formatDateLabel(certificate.startDate)} ~ ${formatDateLabel(certificate.endDate)}`
  const total = Number(certificate.totalSubmissions ?? certificate.required ?? 15)
  const required = Number(certificate.required ?? total)
  return `
    <div class="certificate-card">
      <div class="certificate-card__inner">
        <header class="certificate-card__header">
          <span class="certificate-card__badge">Michina Plan</span>
          <h3 class="certificate-card__title">Completion Certificate</h3>
          <p class="certificate-card__subtitle">미치나 플랜 3주 챌린지 수료증</p>
        </header>
        <section class="certificate-card__body">
          <p class="certificate-card__recipient">${certificate.name ?? certificate.email}</p>
          <p class="certificate-card__statement">위 참가자는 미치나 플랜 3주 챌린지 ${required}회 제출 과제를 모두 수행하여<br />챌린지를 성공적으로 완주했음을 증명합니다.</p>
          <dl class="certificate-card__stats">
            <div>
              <dt>참가 구간</dt>
              <dd>${range}</dd>
            </div>
            <div>
              <dt>제출 현황</dt>
              <dd>${total}/${required}회</dd>
            </div>
            <div>
              <dt>완주 일자</dt>
              <dd>${issueDate}</dd>
            </div>
          </dl>
        </section>
        <footer class="certificate-card__footer">
          <div class="certificate-card__issuer">
            <span class="certificate-card__issuer-label">발급</span>
            <span class="certificate-card__issuer-name">Ellie’s Bang</span>
          </div>
          <div class="certificate-card__serial">${certificate.email}</div>
        </footer>
      </div>
    </div>
  `
}

function renderCertificateSection(profile) {
  if (!(elements.challengeCertificate instanceof HTMLElement)) return
  if (!profile || !profile.completed) {
    elements.challengeCertificate.hidden = true
    if (elements.certificatePreview instanceof HTMLElement) {
      elements.certificatePreview.innerHTML = ''
    }
    if (elements.certificateDownload instanceof HTMLButtonElement) {
      elements.certificateDownload.disabled = true
    }
    return
  }

  elements.challengeCertificate.hidden = false

  if (!state.challenge.certificate) {
    if (elements.certificatePreview instanceof HTMLElement) {
      elements.certificatePreview.innerHTML = '<p class="certificate__loading">수료증 정보를 불러오는 중입니다…</p>'
    }
    if (elements.certificateDownload instanceof HTMLButtonElement) {
      elements.certificateDownload.disabled = true
    }
    ensureChallengeCertificate(profile.email)
    return
  }

  if (elements.certificatePreview instanceof HTMLElement) {
    elements.certificatePreview.innerHTML = buildCertificateMarkup(state.challenge.certificate)
  }
  if (elements.certificateDownload instanceof HTMLButtonElement) {
    elements.certificateDownload.disabled = false
  }
}

async function ensureChallengeCertificate(email) {
  if (!isValidEmail(email)) {
    state.challenge.certificate = null
    renderCertificateSection(state.challenge.profile)
    return null
  }
  try {
    const response = await fetch(`/api/challenge/certificate?email=${encodeURIComponent(email)}`, {
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(`certificate_fetch_failed_${response.status}`)
    }
    state.challenge.certificate = await response.json()
    renderCertificateSection(state.challenge.profile)
    return state.challenge.certificate
  } catch (error) {
    console.error('수료증 정보를 불러오는 중 오류', error)
    setStatus('수료증 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'danger')
    return null
  }
}

function renderChallengeDashboard() {
  const profile = state.challenge.profile
  const isAdmin = state.admin.isLoggedIn

  if (elements.challengeDashboard instanceof HTMLElement) {
    elements.challengeDashboard.hidden = !profile
  }
  if (elements.challengeLocked instanceof HTMLElement) {
    elements.challengeLocked.hidden = Boolean(profile) || isAdmin
  }

  if (elements.challengeSummary instanceof HTMLElement) {
    if (!profile) {
      elements.challengeSummary.textContent = '참가자 등록 후 일일 제출 현황과 진행률을 확인할 수 있습니다.'
    } else if (profile.completed) {
      elements.challengeSummary.textContent = `${profile.name ?? profile.email} 님, ${Number(profile.totalSubmissions ?? Object.keys(profile.submissions ?? {}).length)}/${Number(profile.required ?? 15)}회 제출로 챌린지를 완주하셨습니다!`
    } else {
      const required = Number(profile.required ?? 15)
      const total = Number(profile.totalSubmissions ?? Object.keys(profile.submissions ?? {}).length)
      const remaining = Math.max(0, required - total)
      elements.challengeSummary.textContent = `${profile.name ?? profile.email} 님, 총 ${required}회 중 ${total}회 제출 완료 · ${remaining}회 남았습니다.`
    }
  }

  renderChallengeProgress(profile)
  renderChallengeDays(profile)
  updateChallengeSubmitState(profile)
  renderCertificateSection(profile)
  updatePlanExperience()
}

async function syncChallengeProfile(explicitEmail) {
  const email = explicitEmail || state.user.email
  if (!isValidEmail(email)) {
    state.challenge.profile = null
    state.challenge.certificate = null
    renderChallengeDashboard()
    return null
  }
  state.challenge.loading = true
  try {
    const response = await fetch(`/api/challenge/profile?email=${encodeURIComponent(email)}`, {
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(`profile_fetch_failed_${response.status}`)
    }
    const payload = await response.json().catch(() => ({}))
    if (payload && payload.exists && payload.participant) {
      state.challenge.profile = payload.participant
      if (state.user.plan !== 'admin') {
        state.user.plan = payload.participant.plan ?? state.user.plan
        state.user.email = payload.participant.email
        if (!state.user.name && payload.participant.name) {
          state.user.name = payload.participant.name
        }
      }
      renderChallengeDashboard()
      refreshAccessStates()
      if (payload.participant.completed) {
        await ensureChallengeCertificate(payload.participant.email)
      } else {
        state.challenge.certificate = null
      }
      return state.challenge.profile
    }
    state.challenge.profile = null
    state.challenge.certificate = null
    if (state.user.plan === 'michina' && state.user.plan !== 'admin') {
      state.user.plan = state.user.isLoggedIn ? 'freemium' : 'public'
      refreshAccessStates()
    }
    renderChallengeDashboard()
    return null
  } catch (error) {
    console.error('챌린지 정보를 불러오는 중 오류', error)
    setStatus('챌린지 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'danger')
    return null
  } finally {
    state.challenge.loading = false
  }
}

async function handleChallengeSubmit(event) {
  event.preventDefault()
  if (state.challenge.submitting) return
  const profile = state.challenge.profile
  if (!profile) {
    setStatus('미치나 플랜 참가자로 등록된 계정으로 로그인해주세요.', 'danger')
    return
  }
  if (profile.completed) {
    setStatus('이미 챌린지를 완주했습니다.', 'info')
    return
  }
  if (!(elements.challengeSubmitForm instanceof HTMLFormElement)) return

  let day = elements.challengeDaySelect instanceof HTMLSelectElement ? parseInt(elements.challengeDaySelect.value, 10) : NaN
  if (!Number.isFinite(day)) {
    day = 1
  }
  const required = Number(profile.required ?? 15)
  if (day < 1 || day > required) {
    setStatus('제출할 Day를 선택해주세요.', 'danger')
    return
  }

  let type = 'url'
  let value = elements.challengeUrlInput instanceof HTMLInputElement ? elements.challengeUrlInput.value.trim() : ''
  if (elements.challengeFileInput instanceof HTMLInputElement && elements.challengeFileInput.files && elements.challengeFileInput.files.length > 0) {
    const file = elements.challengeFileInput.files[0]
    if (!file.type.startsWith('image/')) {
      setStatus('이미지 파일만 업로드할 수 있습니다.', 'danger')
      return
    }
    try {
      value = await readFileAsDataUrl(file)
      if (typeof value !== 'string') {
        setStatus('이미지 파일을 읽는 중 오류가 발생했습니다.', 'danger')
        return
      }
      type = 'image'
    } catch (error) {
      console.error('challenge file read error', error)
      setStatus('이미지 파일을 읽는 중 오류가 발생했습니다.', 'danger')
      return
    }
  }

  if (!value) {
    setStatus('URL을 입력하거나 이미지를 업로드해주세요.', 'danger')
    return
  }

  state.challenge.submitting = true
  updateChallengeSubmitState(profile)
  setStatus(`Day ${day} 제출을 저장하는 중입니다…`, 'info')

  try {
    const response = await fetch('/api/challenge/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: profile.email,
        day,
        type,
        value,
      }),
    })
    if (!response.ok) {
      throw new Error(`challenge_submit_failed_${response.status}`)
    }
    const payload = await response.json().catch(() => ({}))
    if (payload && payload.ok && payload.participant) {
      state.challenge.profile = payload.participant
      state.challenge.certificate = null
      renderChallengeDashboard()
      if (payload.participant.completed) {
        await ensureChallengeCertificate(payload.participant.email)
        setStatus('모든 과제를 제출하여 챌린지를 완주했습니다! 수료증을 확인하세요.', 'success')
      } else {
        setStatus(`Day ${day} 제출이 저장되었습니다.`, 'success')
      }
      clearChallengeSubmissionForm()
    } else {
      throw new Error('challenge_submit_invalid_payload')
    }
  } catch (error) {
    console.error('챌린지 제출 중 오류', error)
    setStatus('제출을 저장하는 중 오류가 발생했습니다.', 'danger')
  } finally {
    state.challenge.submitting = false
    updateChallengeSubmitState(state.challenge.profile)
  }
}

async function handleCertificateDownload() {
  const profile = state.challenge.profile
  if (!profile || !profile.completed) {
    setStatus('수료증은 챌린지를 완주한 뒤 다운로드할 수 있습니다.', 'danger')
    return
  }
  if (!state.challenge.certificate) {
    await ensureChallengeCertificate(profile.email)
    if (!state.challenge.certificate) return
  }
  if (!(elements.certificatePreview instanceof HTMLElement)) {
    setStatus('수료증 미리보기를 찾을 수 없습니다.', 'danger')
    return
  }
  const target = elements.certificatePreview.querySelector('.certificate-card__inner') || elements.certificatePreview
  if (!target) {
    setStatus('수료증 미리보기를 찾을 수 없습니다.', 'danger')
    return
  }
  if (typeof window.html2canvas !== 'function') {
    setStatus('수료증 렌더 도구를 불러오는 중입니다. 잠시 후 다시 시도해주세요.', 'danger')
    return
  }
  try {
    const canvas = await window.html2canvas(target, {
      backgroundColor: '#fef568',
      scale: 2,
    })
    const dataUrl = canvas.toDataURL('image/png')
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `michina-certificate-${Date.now()}.png`
    link.click()
    setStatus('수료증 PNG 파일을 다운로드했습니다.', 'success')
  } catch (error) {
    console.error('수료증 다운로드 생성 중 오류', error)
    setStatus('수료증 이미지를 생성하는 중 오류가 발생했습니다.', 'danger')
  }
}

function handleChallengeDayClick(event) {
  const target = event.target instanceof HTMLElement ? event.target.closest('[data-day]') : null
  if (!target) return
  const day = parseInt(target.dataset.day ?? '', 10)
  if (!Number.isFinite(day)) return
  if (elements.challengeDaySelect instanceof HTMLSelectElement) {
    elements.challengeDaySelect.value = String(day)
  }
}

function setLoginHelper(message) {
  if (elements.loginEmailHelper instanceof HTMLElement) {
    elements.loginEmailHelper.textContent = message
  }
}

function encourageEmailFallback() {
  if (state.auth.step !== 'idle') return
  if (!(elements.loginEmailHelper instanceof HTMLElement)) return
  const current = (elements.loginEmailHelper.textContent || '').trim()
  if (!current || current.includes('이메일 주소를 입력') || current.includes('팝업')) {
    setLoginHelper('팝업이 차단되면 아래 이메일 로그인으로 계속 진행할 수 있습니다.')
  }
}

function updateLoginFormState(step) {
  state.auth.step = step
  if (elements.loginEmailForm instanceof HTMLFormElement) {
    elements.loginEmailForm.dataset.state = step
  }
  if (elements.loginEmailSubmit instanceof HTMLButtonElement) {
    elements.loginEmailSubmit.textContent = step === 'code' ? '코드 확인 후 로그인' : '인증 코드 받기'
    elements.loginEmailSubmit.disabled = false
  }
  if (elements.loginEmailResend instanceof HTMLButtonElement) {
    elements.loginEmailResend.hidden = step !== 'code'
    elements.loginEmailResend.disabled = step !== 'code'
  }
  if (elements.loginEmailInput instanceof HTMLInputElement) {
    elements.loginEmailInput.readOnly = step === 'code'
  }
  if (elements.loginEmailCodeInput instanceof HTMLInputElement) {
    elements.loginEmailCodeInput.disabled = step !== 'code'
    if (step !== 'code') {
      elements.loginEmailCodeInput.value = ''
    }
  }
}

function resetLoginFlow() {
  state.auth.step = 'idle'
  state.auth.pendingEmail = ''
  state.auth.code = ''
  state.auth.expiresAt = 0
  state.auth.attempts = 0

  if (elements.loginEmailForm instanceof HTMLFormElement) {
    elements.loginEmailForm.reset()
    elements.loginEmailForm.dataset.state = 'idle'
  }
  if (elements.loginEmailInput instanceof HTMLInputElement) {
    elements.loginEmailInput.readOnly = false
  }
  if (elements.loginEmailCodeInput instanceof HTMLInputElement) {
    elements.loginEmailCodeInput.disabled = true
    elements.loginEmailCodeInput.value = ''
  }
  if (elements.loginEmailSubmit instanceof HTMLButtonElement) {
    elements.loginEmailSubmit.textContent = '인증 코드 받기'
    elements.loginEmailSubmit.disabled = false
  }
  if (elements.loginEmailResend instanceof HTMLButtonElement) {
    elements.loginEmailResend.hidden = true
    elements.loginEmailResend.disabled = true
  }
  setLoginHelper('이메일 주소를 입력하면 인증 코드를 보내드립니다.')
  clearGoogleCooldown()
  runtime.google.retryCount = 0
  updateGoogleProviderAvailability()
}

function generateVerificationCode() {
  return `${Math.floor(100000 + Math.random() * 900000)}`
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function startEmailVerification(email) {
  const normalizedEmail = email.trim().toLowerCase()
  state.auth.pendingEmail = normalizedEmail
  state.auth.code = generateVerificationCode()
  state.auth.expiresAt = Date.now() + 5 * 60 * 1000
  state.auth.attempts = 0

  if (elements.loginEmailInput instanceof HTMLInputElement) {
    elements.loginEmailInput.value = normalizedEmail
  }

  updateLoginFormState('code')

  if (elements.loginEmailCodeInput instanceof HTMLInputElement) {
    window.requestAnimationFrame(() => elements.loginEmailCodeInput.focus())
  }

  const helperMessage = `입력한 주소(${normalizedEmail})로 인증 코드를 전송했습니다. 5분 내에 6자리 코드를 입력하세요. (샌드박스 테스트용 코드: ${state.auth.code})`
  setLoginHelper(helperMessage)
  setStatus(`${normalizedEmail} 주소로 인증 코드를 전송했습니다. 이메일을 확인한 뒤 코드를 입력해주세요.`, 'info')
}

function isVerificationCodeValid(code) {
  if (!state.auth.code || Date.now() > state.auth.expiresAt) {
    return { valid: false, reason: 'expired' }
  }
  if (code !== state.auth.code) {
    state.auth.attempts += 1
    return { valid: false, reason: 'mismatch' }
  }
  return { valid: true }
}

function updateOperationAvailability() {
  const hasUploadSelection = state.selectedUploads.size > 0
  const hasResultSelection = state.selectedResults.size > 0
  const hasResizeSelection = hasUploadSelection || hasResultSelection
  const resizeValue =
    elements.resizeInput instanceof HTMLInputElement ? elements.resizeInput.value.trim() : ''
  const isProcessing = state.processing

  elements.operationButtons?.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return
    const operation = button.dataset.operation
    if (operation === 'svg') return
    if (operation === 'resize') {
      button.disabled = isProcessing || !hasResizeSelection || !resizeValue
    } else {
      button.disabled = isProcessing || !hasUploadSelection
    }
  })

  if (elements.uploadDeleteSelected instanceof HTMLButtonElement) {
    elements.uploadDeleteSelected.disabled = isProcessing || state.selectedUploads.size === 0
  }
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
    elements.resultDeleteSelected.disabled = state.processing || selectedCount === 0
  }
  if (elements.svgButton instanceof HTMLButtonElement) {
    const hasSvgSelection = selectedCount > 0 || state.selectedUploads.size > 0
    elements.svgButton.disabled = state.processing || !hasSvgSelection
  }
}

function openLoginModal() {
  if (!elements.loginModal) return
  resetLoginFlow()
  elements.loginModal.classList.add('is-active')
  elements.loginModal.setAttribute('aria-hidden', 'false')
  document.body.classList.add('is-modal-open')
  prefetchGoogleClient().catch((error) => {
    console.warn('Google 로그인 초기화 중 오류', error)
  })
  if (elements.loginEmailInput instanceof HTMLInputElement) {
    window.requestAnimationFrame(() => elements.loginEmailInput.focus())
  }
}

function closeLoginModal() {
  if (!elements.loginModal) return
  elements.loginModal.classList.remove('is-active')
  elements.loginModal.setAttribute('aria-hidden', 'true')
  document.body.classList.remove('is-modal-open')
  resetLoginFlow()
}

async function handleGoogleLogin(event) {
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault()
  }

  const isAutoRetry = event instanceof Event && event.type === 'retry'

  const config = getAppConfig()
  const clientId = typeof config.googleClientId === 'string' ? config.googleClientId.trim() : ''
  if (!clientId) {
    setStatus('현재 Google 로그인을 사용할 수 없습니다. 이메일 로그인으로 계속 진행해주세요.', 'info')
    setGoogleButtonState('disabled')
    setGoogleLoginHelper('현재 Google 로그인을 사용할 수 없습니다. 이메일 로그인으로 계속 진행해주세요.', 'info')
    return
  }

  if (runtime.google.cooldownUntil && Date.now() < runtime.google.cooldownUntil) {
    const remaining = Math.max(0, runtime.google.cooldownUntil - Date.now())
    const seconds = Math.max(1, Math.ceil(remaining / 1000))
    setStatus(`보안 보호를 위해 ${seconds}초 후 다시 시도해주세요.`, 'warning')
    updateGoogleProviderAvailability()
    return
  }

  let disableDueToConfig = false

  try {
    clearGoogleCooldown()
    const loadingLabel = isAutoRetry ? 'Google 로그인을 다시 시도하는 중…' : undefined
    if (isAutoRetry) {
      setGoogleButtonState('loading', loadingLabel)
      setStatus('Google 로그인을 자동으로 다시 시도하는 중입니다…', 'info', 0)
      setGoogleLoginHelper('자동 재시도를 시작합니다. 잠시만 기다려주세요.', 'info')
    } else {
      const initialState = runtime.google.codeClient ? 'loading' : 'initializing'
      setGoogleButtonState(initialState, loadingLabel)
      setStatus('Google 로그인 준비 중입니다…', 'info', 0)
    }

    const codeClient = await ensureGoogleClient()
    if (!codeClient) {
      throw new Error('GOOGLE_SDK_UNAVAILABLE')
    }

    setGoogleButtonState('loading', loadingLabel)

    const deferred = createDeferred()
    runtime.google.deferred = deferred

    try {
      codeClient.requestCode()
    } catch (clientError) {
      runtime.google.deferred = null
      throw clientError
    }

    const authCode = await deferred.promise

    setStatus('Google 계정을 확인하고 있습니다…', 'info', 0)

    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: authCode }),
      credentials: 'include',
    })

    if (!response.ok) {
      let detail = null
      try {
        detail = await response.json()
      } catch (parseError) {
        detail = null
      }
      const errorCode = detail?.error
      if (errorCode === 'GOOGLE_EMAIL_NOT_VERIFIED') {
        throw new Error('GOOGLE_EMAIL_NOT_VERIFIED')
      }
      if (errorCode === 'GOOGLE_AUTH_NOT_CONFIGURED') {
        throw new Error('GOOGLE_CLIENT_ID_MISSING')
      }
      if (errorCode === 'GOOGLE_AUTH_NOT_AVAILABLE') {
        throw new Error('GOOGLE_SDK_UNAVAILABLE')
      }
      if (typeof errorCode === 'string' && errorCode.startsWith('GOOGLE_ID_TOKEN_')) {
        throw new Error(errorCode)
      }
      throw new Error('GOOGLE_AUTH_REJECTED')
    }

    const payload = await response.json().catch(() => ({}))
    const profile = payload?.profile ?? {}
    const email = typeof profile.email === 'string' ? profile.email : ''
    const displayName =
      typeof profile.name === 'string' && profile.name.trim().length > 0
        ? profile.name.trim()
        : email || 'Google 사용자'

    applyLoginProfile({ name: displayName, email: email || undefined, plan: 'freemium' })
    runtime.google.retryCount = 0
    clearGoogleCooldown()
    runtime.google.lastErrorHint = ''
    runtime.google.lastErrorTone = 'muted'
    setGoogleLoginHelper('Google 계정으로 로그인되었습니다.', 'success')
    window.setTimeout(() => setGoogleLoginHelper('', 'muted'), 3200)
    closeLoginModal()
    setStatus(
      `${displayName} Google 계정으로 로그인되었습니다. 무료 ${FREEMIUM_INITIAL_CREDITS} 크레딧이 충전되었습니다.`,
      'success',
    )

    if (email) {
      await syncChallengeProfile(email)
    }

    setGoogleButtonState('idle')
  } catch (error) {
    console.error('Google 로그인 중 오류', error)
    let message = 'Google 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.'
    const errorCode = error instanceof Error && error.message ? error.message : ''

    if (error instanceof Error) {
      switch (error.message) {
        case 'GOOGLE_CLIENT_ID_MISSING':
          message = '현재 Google 로그인을 사용할 수 없습니다. 이메일 로그인으로 계속 진행해주세요.'
          disableDueToConfig = true
          break
        case 'GOOGLE_EMAIL_NOT_VERIFIED':
          message = 'Google 계정 이메일 인증이 필요합니다. Google 계정에서 이메일 인증을 완료한 뒤 다시 시도해주세요.'
          break
        case 'GOOGLE_EMAIL_INVALID':
          message = 'Google에서 반환된 이메일 정보를 확인할 수 없습니다. 다른 계정으로 다시 시도해주세요.'
          break
        case 'GOOGLE_SDK_TIMEOUT':
        case 'GOOGLE_SDK_UNAVAILABLE':
        case 'GOOGLE_SDK_LOAD_FAILED':
          message = 'Google 로그인 스크립트를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.'
          break
        case 'GOOGLE_CODE_MISSING':
        case 'GOOGLE_AUTH_REJECTED':
          message = 'Google 로그인 요청이 취소되었거나 거절되었습니다. 다시 시도해주세요.'
          break
        case 'GOOGLE_ID_TOKEN_AUDIENCE_MISMATCH':
        case 'GOOGLE_ID_TOKEN_ISSUER_INVALID':
        case 'GOOGLE_ID_TOKEN_INVALID':
        case 'GOOGLE_ID_TOKEN_MISSING':
        case 'GOOGLE_TOKEN_EXCHANGE_FAILED':
        case 'GOOGLE_AUTH_UNEXPECTED_ERROR':
          message = 'Google 인증 토큰을 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
          break
        case 'access_denied':
        case 'popup_closed_by_user':
          message = 'Google 로그인 창이 닫혔습니다. 다시 시도해주세요.'
          break
        case 'popup_blocked_by_browser':
          message = '브라우저가 팝업을 차단했습니다. 팝업을 허용하거나 아래 이메일 로그인을 이용해주세요.'
          break
        case 'interaction_required':
          message = 'Google 계정 선택이 필요합니다. 다시 시도하여 계정을 선택해주세요.'
          break
        default:
          if (error.message && error.message.startsWith('clientId')) {
            message = '현재 Google 로그인을 사용할 수 없습니다. 이메일 로그인으로 계속 진행해주세요.'
            disableDueToConfig = true
          }
          break
      }
    }

    if (GOOGLE_CONFIGURATION_ERRORS.has(errorCode)) {
      disableDueToConfig = true
    }

    const isPopupDismissed = GOOGLE_POPUP_DISMISSED_ERRORS.has(errorCode)
    const isRecoverable = GOOGLE_RECOVERABLE_ERRORS.has(errorCode)

    if (isRecoverable && !disableDueToConfig) {
      message = `${describeGoogleRetry(errorCode || 'recoverable_error')} 자동으로 다시 시도합니다.`
    }

    let helperMessage = ''
    let helperTone = 'danger'
    if (disableDueToConfig) {
      helperMessage = '현재 Google 로그인을 사용할 수 없습니다. 이메일 로그인으로 계속 진행해주세요.'
      helperTone = 'info'
    } else if (isPopupDismissed) {
      helperMessage = 'Google 로그인 창이 닫혔습니다. 버튼을 다시 눌러 진행해주세요.'
      helperTone = 'warning'
    } else if (!isRecoverable) {
      helperMessage = message
    }

    if (helperMessage) {
      setGoogleLoginHelper(helperMessage, helperTone)
      runtime.google.lastErrorHint = helperMessage
      runtime.google.lastErrorTone = helperTone
    } else {
      const fallbackReason = errorCode || 'recoverable_error'
      runtime.google.lastErrorHint = describeGoogleRetry(fallbackReason)
      runtime.google.lastErrorTone =
        fallbackReason === 'interaction_required' ? 'info' : isRecoverable ? 'warning' : 'danger'
    }

    const statusTone = disableDueToConfig ? 'info' : isPopupDismissed ? 'warning' : isRecoverable ? 'info' : 'danger'
    setStatus(message, statusTone)

    if (!disableDueToConfig) {
      if (isRecoverable && !isPopupDismissed) {
        runtime.google.retryCount += 1
        const scheduled = scheduleGoogleAutoRetry(errorCode || 'recoverable_error')
        if (!scheduled) {
          const cooldown = Math.min(15000, 2000 * runtime.google.retryCount)
          startGoogleCooldown(cooldown)
        }
      } else if (!isPopupDismissed) {
        runtime.google.retryCount = Math.min(runtime.google.retryCount + 1, 5)
        const fallbackCooldown = Math.min(10000, 2000 * runtime.google.retryCount)
        startGoogleCooldown(fallbackCooldown)
      }

      if (runtime.google.retryCount >= 3 && state.auth.step === 'idle') {
        activateEmailFallback()
      }
    }

    if (disableDueToConfig) {
      setGoogleButtonState('disabled')
    } else if (runtime.google.cooldownUntil && Date.now() < runtime.google.cooldownUntil) {
      // countdown handler controls button state
    } else if (isPopupDismissed) {
      setGoogleButtonState('idle')
    } else if (runtime.google.retryTimer) {
      setGoogleButtonState('retrying', 'Google 로그인 자동 재시도 준비 중…')
    } else {
      setGoogleButtonState('error')
    }
  } finally {
    runtime.google.deferred = null
    if (!disableDueToConfig && (!runtime.google.cooldownUntil || Date.now() >= runtime.google.cooldownUntil)) {
      updateGoogleProviderAvailability()
    }
  }
}

function handleEmailResend(event) {
  event.preventDefault()
  const currentEmail =
    state.auth.pendingEmail ||
    (elements.loginEmailInput instanceof HTMLInputElement ? elements.loginEmailInput.value.trim() : '')
  if (!currentEmail) {
    setStatus('이메일을 먼저 입력해주세요.', 'danger')
    updateLoginFormState('idle')
    if (elements.loginEmailInput instanceof HTMLInputElement) {
      elements.loginEmailInput.focus()
    }
    return
  }
  if (!isValidEmail(currentEmail)) {
    setStatus('유효한 이메일 주소인지 확인해주세요.', 'danger')
    updateLoginFormState('idle')
    return
  }
  startEmailVerification(currentEmail)
  setStatus(`${currentEmail} 주소로 새로운 인증 코드를 전송했습니다.`, 'success')
}

function handleEmailLogin(event) {
  event.preventDefault()
  if (!(elements.loginEmailForm instanceof HTMLFormElement)) return

  if (state.auth.step === 'code') {
    if (!(elements.loginEmailCodeInput instanceof HTMLInputElement)) return
    const submittedCode = elements.loginEmailCodeInput.value.trim()
    if (!submittedCode) {
      setStatus('이메일로 받은 인증 코드를 입력해주세요.', 'danger')
      return
    }
    const result = isVerificationCodeValid(submittedCode)
    if (!result.valid) {
      if (result.reason === 'expired') {
        setStatus('인증 코드가 만료되었습니다. 새 코드를 요청해주세요.', 'danger')
        state.auth.pendingEmail = ''
        state.auth.code = ''
        state.auth.expiresAt = 0
        updateLoginFormState('idle')
        setLoginHelper('인증 코드가 만료되었습니다. 이메일을 확인한 뒤 다시 요청해주세요.')
        if (elements.loginEmailInput instanceof HTMLInputElement) {
          elements.loginEmailInput.focus()
        }
        return
      }
      if (result.reason === 'mismatch') {
        const remaining = Math.max(0, 5 - state.auth.attempts)
        const helper =
          remaining > 0
            ? `코드가 일치하지 않습니다. 다시 입력해주세요. (남은 시도 ${remaining}회)`
            : '인증 코드를 여러 번 잘못 입력했습니다. 새 코드를 요청해주세요.'
        setLoginHelper(helper)
        setStatus('인증 코드가 일치하지 않습니다.', 'danger')
        if (remaining <= 0) {
          state.auth.pendingEmail = ''
          state.auth.code = ''
          state.auth.expiresAt = 0
          updateLoginFormState('idle')
          setLoginHelper('이메일 주소를 입력하면 인증 코드를 보내드립니다.')
          if (elements.loginEmailInput instanceof HTMLInputElement) {
            elements.loginEmailInput.focus()
          }
        } else if (elements.loginEmailCodeInput instanceof HTMLInputElement) {
          elements.loginEmailCodeInput.select()
        }
        return
      }
    }

    const email = state.auth.pendingEmail
    if (!email) {
      setStatus('이메일 정보를 확인할 수 없습니다. 다시 시도해주세요.', 'danger')
      state.auth.pendingEmail = ''
      state.auth.code = ''
      state.auth.expiresAt = 0
      updateLoginFormState('idle')
      setLoginHelper('이메일 주소를 입력하면 인증 코드를 보내드립니다.')
      return
    }
    const nickname = email.includes('@') ? email.split('@')[0] : email
    applyLoginProfile({ name: nickname, email })
    closeLoginModal()
    setStatus(`${email} 계정으로 로그인되었습니다. 무료 ${FREEMIUM_INITIAL_CREDITS} 크레딧이 충전되었습니다.`, 'success')
    return
  }

  const email =
    elements.loginEmailInput instanceof HTMLInputElement ? elements.loginEmailInput.value.trim() : ''
  if (!email) {
    setStatus('이메일을 입력해주세요.', 'danger')
    return
  }
  if (!isValidEmail(email)) {
    setStatus('유효한 이메일 주소인지 확인해주세요.', 'danger')
    return
  }
  startEmailVerification(email)
}

function handleGlobalKeydown(event) {
  if (event.key !== 'Escape') return
  if (elements.loginModal?.classList.contains('is-active')) {
    closeLoginModal()
  }
  if (elements.adminModal?.classList.contains('is-active')) {
    closeAdminModal()
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

function injectViewBoxAttribute(svgString, width, height) {
  if (!svgString.includes('viewBox')) {
    return svgString.replace('<svg ', `<svg viewBox="0 0 ${width} ${height}" `)
  }
  return svgString
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

function waitForCondition(condition, timeout = 10000, interval = 60) {
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
        reject(new Error('Timeout'))
        return
      }

      window.setTimeout(check, interval)
    }
    check()
  })
}

function ensureImageTracerReady() {
  if (window.ImageTracer && typeof window.ImageTracer.imagedataToSVG === 'function') {
    return Promise.resolve(true)
  }

  if (!imageTracerReadyPromise) {
    const loadPromise = new Promise((resolve, reject) => {
      const script = ensureScriptElement(IMAGETRACER_SRC, 'imagetracer')
      if (!script) {
        reject(new Error('SVG 변환 엔진 스크립트를 초기화하지 못했습니다.'))
        return
      }

      const fail = (reason) => {
        script.removeEventListener('error', onScriptError)
        if (script.parentElement) {
          script.parentElement.removeChild(script)
        }
        const error = reason instanceof Error ? reason : new Error(String(reason || 'SVG 변환 엔진을 불러오는 중 오류가 발생했습니다.'))
        reject(error)
      }

      const onScriptError = (event) => {
        fail(new Error(`SVG 변환 엔진을 불러오는 중 네트워크 오류가 발생했습니다. (${event?.type || 'error'})`))
      }

      script.addEventListener('error', onScriptError, { once: true })

      waitForCondition(
        () => window.ImageTracer && typeof window.ImageTracer.imagedataToSVG === 'function',
        12000,
        80,
      )
        .then(() => {
          script.removeEventListener('error', onScriptError)
          resolve(true)
        })
        .catch((error) => {
          fail(error)
        })
    })

    imageTracerReadyPromise = loadPromise.catch((error) => {
      imageTracerReadyPromise = null
      throw error
    })
  }

  return imageTracerReadyPromise
}

async function resolveDataUrlForTarget(target) {
  if (target.type === 'upload') {
    return ensureDataUrl(target.item.dataUrl)
  }

  if (target.item.blob instanceof Blob) {
    const inline = await blobToDataUrl(target.item.blob)
    if (typeof inline === 'string') {
      return ensureDataUrl(inline)
    }
  }

  return ensureDataUrl(target.item.objectUrl)
}

async function convertTargetToSvg(target, desiredColors) {
  await ensureImageTracerReady()

  if (!window.ImageTracer || typeof window.ImageTracer.imagedataToSVG !== 'function') {
    return { success: false, message: 'SVG 변환 엔진을 불러오지 못했습니다.' }
  }

  try {
    const dataUrl = await resolveDataUrlForTarget(target)
    const { canvas, ctx } = await canvasFromDataUrl(dataUrl)
    const width = canvas.width
    const height = canvas.height
    const imageData = ctx.getImageData(0, 0, width, height)

    const baseColors = Number.isFinite(desiredColors) ? desiredColors : 4
    const clampedColors = Math.max(1, Math.min(8, Math.round(baseColors)))

    let options = {
      numberofcolors: clampedColors,
      pathomit: 4,
      ltres: 1,
      qtres: 1,
      colorsampling: 0,
      colorquantcycles: 3,
      blurradius: 0,
      blurdelta: 20,
      strokewidth: 0,
      linefilter: true,
      scale: 1,
      viewbox: false,
    }

    const adjustments = [
      (opts) => ({ ...opts, pathomit: opts.pathomit + 8 }),
      (opts) => ({ ...opts, qtres: opts.qtres * 1.35 }),
      (opts) => ({ ...opts, ltres: opts.ltres * 1.3 }),
      (opts) => (opts.numberofcolors > 1 ? { ...opts, numberofcolors: opts.numberofcolors - 1 } : opts),
      (opts) => ({ ...opts, pathomit: opts.pathomit + 16, qtres: opts.qtres * 1.6 }),
    ]

    let svgString = ''
    let svgBlob = null
    let sizeOk = false
    let reducedColors = false

    for (let step = 0; step <= adjustments.length; step += 1) {
      svgString = window.ImageTracer.imagedataToSVG(imageData, options)
      svgString = injectViewBoxAttribute(svgString, width, height)
      svgBlob = new Blob([svgString], { type: 'image/svg+xml' })
      if (svgBlob.size <= MAX_SVG_BYTES) {
        sizeOk = true
        break
      }
      if (step === adjustments.length) {
        break
      }
      const nextOptions = adjustments[step](options)
      if (nextOptions.numberofcolors < options.numberofcolors) {
        reducedColors = true
      }
      options = nextOptions
    }

    if (!sizeOk || !svgBlob) {
      return { success: false, message: 'SVG 파일이 150KB 이하로 압축되지 않았습니다.' }
    }

    const finalColors = options.numberofcolors
    const operations = Array.isArray(target.item.operations) ? [...target.item.operations] : []
    operations.push(`SVG 변환(${finalColors}색)`)

    const filenameBase = baseName(target.item.name || 'image')
    const resultName = `${filenameBase}__vector-${finalColors}c.svg`

    return {
      success: true,
      blob: svgBlob,
      width,
      height,
      name: resultName,
      operations,
      colors: finalColors,
      reducedColors,
    }
  } catch (error) {
    console.error('SVG 변환 중 오류', error)
    return { success: false, message: 'SVG 변환 과정에서 오류가 발생했습니다.' }
  }
}

async function convertSelectionsToSvg() {
  if (state.processing) return

  const resultIds = Array.from(state.selectedResults)
  const uploadIds = Array.from(state.selectedUploads)

  if (resultIds.length === 0 && uploadIds.length === 0) {
    setStatus('SVG로 변환할 이미지를 선택해주세요.', 'danger')
    return
  }

  const targetCount = resultIds.length + uploadIds.length
  if (!ensureActionAllowed('svg', { count: Math.max(1, targetCount), gate: 'results' })) {
    return
  }

  setStage('export')

  toggleProcessing(true)
  setStatus('SVG 변환 엔진을 불러오는 중입니다…', 'info', 0)

  try {
    await ensureImageTracerReady()
  } catch (error) {
    console.error('ImageTracer load error', error)
    toggleProcessing(false)
    const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
    setStatus(`SVG 변환 엔진을 불러오는 중 문제가 발생했습니다.${detail} 새로고침 후 다시 시도해주세요.`, 'danger')
    return
  }

  if (!window.ImageTracer || typeof window.ImageTracer.imagedataToSVG !== 'function') {
    toggleProcessing(false)
    setStatus('SVG 변환 엔진을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.', 'danger')
    return
  }

  let colorCount = 4
  if (elements.svgColorSelect instanceof HTMLSelectElement) {
    const parsed = parseInt(elements.svgColorSelect.value, 10)
    if (!Number.isNaN(parsed)) {
      colorCount = parsed
    }
  }

  setStatus('SVG로 변환하는 중입니다…', 'info', 0)

  const conversions = []
  const targets = []

  for (const id of resultIds) {
    const resultItem = state.results.find((item) => item.id === id)
    if (resultItem) {
      targets.push({ type: 'result', item: resultItem })
    }
  }

  for (const id of uploadIds) {
    const uploadItem = state.uploads.find((item) => item.id === id)
    if (uploadItem) {
      targets.push({ type: 'upload', item: uploadItem })
    }
  }

  const failures = []
  const colorAdjustments = []

  try {
    for (const target of targets) {
      // eslint-disable-next-line no-await-in-loop
      const conversion = await convertTargetToSvg(target, colorCount)
      if (!conversion.success || !conversion.blob) {
        console.warn('SVG 변환 실패:', target.item?.name || '(이름 없음)', conversion.message)
        failures.push({
          name: target.item.name,
          message: conversion.message || '알 수 없는 이유로 실패했습니다.',
        })
        continue
      }

      const sourceReference = target.item
      const resultPayload = {
        blob: conversion.blob,
        width: conversion.width,
        height: conversion.height,
        operations: conversion.operations,
        name: conversion.name,
        type: 'image/svg+xml',
      }

      appendResult(sourceReference, resultPayload)
      conversions.push(conversion)
      if (conversion.reducedColors) {
        colorAdjustments.push(conversion)
      }
    }
  } finally {
    toggleProcessing(false)
    recomputeStage()
  }

  if (conversions.length > 0) {
    consumeCredits('svg', conversions.length)
    let message = `${conversions.length}개의 이미지를 SVG로 변환했습니다.`
    if (colorAdjustments.length > 0) {
      message += ` (용량 제한으로 색상 수를 자동 조정한 항목 ${colorAdjustments.length}개)`
    }
    if (failures.length > 0) {
      message += ` · 실패 ${failures.length}개는 콘솔 로그를 확인해주세요.`
      setStatus(message, 'info')
    } else {
      setStatus(message, 'success')
    }
  } else if (failures.length > 0) {
    const firstFailure = failures[0]
    setStatus(`SVG 변환에 실패했습니다: ${firstFailure.message}`, 'danger')
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
  const previousComposite = ctx.globalCompositeOperation
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'copy'
  ctx.drawImage(image, 0, 0)
  ctx.globalCompositeOperation = previousComposite
  return { canvas, ctx }
}

async function canvasFromBlob(blob) {
  if (!(blob instanceof Blob)) {
    throw new Error('유효한 이미지 Blob이 필요합니다.')
  }
  if (typeof createImageBitmap !== 'function') {
    const dataUrl = await blobToDataUrl(blob)
    if (typeof dataUrl !== 'string') {
      throw new Error('이미지 Blob을 로드할 수 없습니다.')
    }
    return canvasFromDataUrl(dataUrl)
  }
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = createCanvas(bitmap.width || 1, bitmap.height || 1)
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true })
    if (!ctx) throw new Error('캔버스를 초기화할 수 없습니다.')
    const previousComposite = ctx.globalCompositeOperation
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'copy'
    ctx.drawImage(bitmap, 0, 0)
    ctx.globalCompositeOperation = previousComposite
    return { canvas, ctx }
  } finally {
    if (typeof bitmap.close === 'function') {
      bitmap.close()
    }
  }
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

function findAlphaBounds(imageData, width, height, alphaThreshold = 6) {
  const { data } = imageData
  let top = height
  let left = width
  let right = -1
  let bottom = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > alphaThreshold) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }

  if (right === -1 || bottom === -1) {
    return null
  }

  return { top, left, right, bottom }
}

function boundsArea(bounds) {
  if (!bounds) return 0
  return Math.max(0, bounds.right - bounds.left + 1) * Math.max(0, bounds.bottom - bounds.top + 1)
}

function expandBounds(bounds, width, height, padding = 0) {
  if (!bounds) {
    return { top: 0, left: 0, right: width - 1, bottom: height - 1 }
  }
  const pad = Math.max(0, Math.floor(padding))
  return {
    top: Math.max(0, bounds.top - pad),
    left: Math.max(0, bounds.left - pad),
    right: Math.min(width - 1, bounds.right + pad),
    bottom: Math.min(height - 1, bounds.bottom + pad),
  }
}

function detectSubjectBounds(imageData, width, height) {
  const clone = new ImageData(new Uint8ClampedArray(imageData.data), width, height)
  applyBackgroundRemoval(clone, width, height)
  const alphaBounds = findAlphaBounds(clone, width, height, 8)
  if (alphaBounds) {
    return expandBounds(alphaBounds, width, height, 1)
  }

  const broad = findBoundingBox(imageData, width, height, 10, 70)
  const tighter = findBoundingBox(imageData, width, height, 8, 42)

  const broadArea = boundsArea(broad)
  const tightArea = boundsArea(tighter)

  if (tighter && tightArea > 0 && tightArea <= broadArea * 0.92) {
    return expandBounds(tighter, width, height, 1)
  }

  return expandBounds(broad, width, height, 1)
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
  const safeWidth = Math.max(1, Math.round(width))
  const sourceWidth = Math.max(1, canvas.width)
  const ratio = safeWidth / sourceWidth
  const height = Math.max(1, Math.round(canvas.height * ratio))
  const resized = createCanvas(safeWidth, height)
  const ctx = resized.getContext('2d', { willReadFrequently: true, alpha: true })
  if (!ctx) throw new Error('리사이즈 캔버스를 초기화할 수 없습니다.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const previousComposite = ctx.globalCompositeOperation
  ctx.clearRect(0, 0, resized.width, resized.height)
  ctx.globalCompositeOperation = 'copy'
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, safeWidth, height)
  ctx.globalCompositeOperation = previousComposite
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
    !elements.analysisMeta ||
    !elements.analysisKeywords ||
    !elements.analysisSummary ||
    !elements.analysisHeadline
  ) {
    return
  }

  const normalizedTarget = resolveActiveTarget(target)
  state.activeTarget = normalizedTarget

  const button = elements.analysisButton instanceof HTMLButtonElement ? elements.analysisButton : null
  if (button) {
    button.disabled = state.processing || !normalizedTarget
  }

  const resetView = (hintText) => {
    elements.analysisPanel.classList.remove('analysis--has-data')
    elements.analysisPanel.dataset.provider = ''
    elements.analysisHint.textContent = hintText
    elements.analysisMeta.textContent = ''
    elements.analysisHeadline.textContent = ''
    elements.analysisKeywords.innerHTML = ''
    elements.analysisSummary.textContent = ''
  }

  if (!normalizedTarget) {
    resetView('이미지를 선택하면 25개의 SEO 키워드와 요약이 표시됩니다.')
    return
  }

  const item = findItemByTarget(normalizedTarget)
  const data = state.analysis.get(getAnalysisKey(normalizedTarget))

  if (!data) {
    const nameHint = item?.name ? ` (${item.name})` : ''
    resetView(`“분석 실행” 버튼을 눌러 선택한 이미지${nameHint}의 키워드를 생성하세요.`)
    return
  }

  elements.analysisPanel.classList.add('analysis--has-data')
  const provider = typeof data.provider === 'string' ? data.provider : ''
  elements.analysisPanel.dataset.provider = provider
  if (provider === 'openai') {
    elements.analysisMeta.textContent = 'OpenAI GPT-4o-mini 분석 결과'
  } else if (provider === 'local') {
    const reason = typeof data.reason === 'string' && data.reason ? ` (${data.reason})` : ''
    elements.analysisMeta.textContent = `로컬 Canvas 분석 결과${reason}`
  } else {
    elements.analysisMeta.textContent = ''
  }
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
  const target = resolveActiveTarget()
  if (!target) {
    setStatus('먼저 분석할 이미지를 선택해주세요.', 'danger')
    return
  }

  const item = findItemByTarget(target)

  if (!item) {
    setStatus('선택한 이미지를 찾을 수 없습니다.', 'danger')
    displayAnalysisFor()
    return
  }

  const { type, id } = target

  if (!ensureActionAllowed('analysis', { gate: 'results', count: 1 })) {
    return
  }

  setStage('export')
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

    let fallbackReason = ''
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
        const reason = typeof detail?.error === 'string' && detail.error ? detail.error : `OpenAI API 오류(${response.status})`
        throw new Error(reason)
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
        keywords: payload.keywords
          .map((keyword) => (typeof keyword === 'string' ? keyword.trim() : ''))
          .filter(Boolean)
          .slice(0, 25),
        provider: 'openai',
      }
    } catch (apiError) {
      fallbackReason = apiError instanceof Error ? apiError.message : String(apiError)
      console.warn('OpenAI 분석 실패, 로컬 분석으로 대체합니다.', fallbackReason)
      const fallbackAnalysis = analyzeCanvasForKeywords(surface.canvas, surface.ctx)
      const fallbackReasonLabel =
        typeof fallbackReason === 'string' && fallbackReason.includes('OPENAI_API_KEY_NOT_CONFIGURED')
          ? 'OpenAI API 키 미설정'
          : 'OpenAI API 호출 실패'
      analysis = { ...fallbackAnalysis, provider: 'local', reason: fallbackReasonLabel }
      usedFallback = true
    }

    const key = getAnalysisKey(target)
    if (key) {
      state.analysis.set(key, analysis)
    }
    displayAnalysisFor(target)
    consumeCredits('analysis', 1)

    const statusHeadline = analysis.title || analysis.keywords.slice(0, 3).join(', ')
    if (usedFallback) {
      const baseMessage = statusHeadline
        ? `로컬 분석으로 키워드 생성: ${statusHeadline}`
        : '로컬 분석으로 키워드를 생성했습니다.'
      let reasonMessage = ''
      if (fallbackReason) {
        if (fallbackReason.includes('OPENAI_API_KEY_NOT_CONFIGURED')) {
          reasonMessage = ' (OpenAI API 키가 설정되지 않았습니다.)'
        } else {
          reasonMessage = ` (사유: ${fallbackReason})`
        }
      }
      setStatus(`${baseMessage}${reasonMessage}`, 'danger')
    } else {
      const successMessage = statusHeadline
        ? `OpenAI 키워드 분석 완료: ${statusHeadline}`
        : 'OpenAI 키워드 분석이 완료되었습니다.'
      setStatus(successMessage, 'success')
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
          <button class="asset-card__remove" type="button" aria-label="업로드 이미지 삭제" data-role="upload-remove">
            <i class="ri-close-line" aria-hidden="true"></i>
          </button>
          <div class="asset-card__selection-indicator" aria-hidden="true">
            <span class="asset-card__selection-icon">✔</span>
            <span class="asset-card__selection-label">선택됨</span>
          </div>
          <label class="asset-card__checkbox">
            <input type="checkbox" aria-label="이미지 선택" data-role="upload-checkbox" ${selected ? 'checked' : ''} />
          </label>
          <div class="asset-card__thumb">
            <img src="${upload.dataUrl}" alt="${upload.name}" loading="lazy" />
          </div>
          <div class="asset-card__meta">
            <span class="asset-card__name" title="${upload.name}">${upload.name}</span>
            <span class="asset-card__info">${upload.width}×${upload.height}px · ${formatBytes(upload.size)}</span>
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
          <button class="asset-card__remove" type="button" aria-label="결과 삭제" data-role="result-remove">
            <i class="ri-close-line" aria-hidden="true"></i>
          </button>
          <div class="asset-card__selection-indicator" aria-hidden="true">
            <span class="asset-card__selection-icon">✔</span>
            <span class="asset-card__selection-label">선택됨</span>
          </div>
          <label class="asset-card__checkbox">
            <input type="checkbox" aria-label="결과 선택" data-role="result-checkbox" ${selected ? 'checked' : ''} />
          </label>
          <div class="asset-card__thumb">
            <img src="${result.objectUrl}" alt="${result.name}" loading="lazy" />
          </div>
          <div class="asset-card__meta">
            <span class="asset-card__name" title="${result.name}">${result.name}</span>
            <span class="asset-card__info">${result.width}×${result.height}px · ${formatBytes(result.size)}</span>
            <span class="asset-card__info">${result.operations.join(' · ')}</span>
          </div>
          <div class="asset-card__actions">
            <button class="asset-card__button" type="button" data-action="download-result">다운로드</button>
          </div>
        </div>
      `
    })
    .join('')

  elements.resultList.innerHTML = cards || ''
  ensureGridState(elements.resultList, state.results.length)
  updateResultActionAvailability()
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
    recomputeStage()

    if (newUploads.length > 0) {
      displayAnalysisFor({ type: 'upload', id: newUploads[newUploads.length - 1].id })
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
      return false
    }
    return true
  })
  renderUploads()
  updateOperationAvailability()
  recomputeStage()
  displayAnalysisFor()
  setStatus(`${ids.length}개의 업로드 이미지를 삭제했습니다.`, 'info')
}

function deleteResults(ids) {
  if (!ids || ids.length === 0) return
  state.results = state.results.filter((result) => {
    if (ids.includes(result.id)) {
      URL.revokeObjectURL(result.objectUrl)
      state.selectedResults.delete(result.id)
      removeAnalysisFor('result', result.id)
      return false
    }
    return true
  })
  renderResults()
  updateResultActionAvailability()
  updateOperationAvailability()
  recomputeStage()
  displayAnalysisFor()
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
  const bounds = detectSubjectBounds(imageData, canvas.width, canvas.height)
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

  const alphaBounds = findAlphaBounds(imageData, canvas.width, canvas.height, 6)
  const fallbackBounds = findBoundingBox(imageData, canvas.width, canvas.height, 8, 36)
  const bounds = expandBounds(alphaBounds ?? fallbackBounds, canvas.width, canvas.height, 1)

  const { canvas: cropped } = cropCanvas(canvas, ctx, bounds)
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
  const normalizedWidth = Math.max(1, Math.round(targetWidth))
  const history = Array.isArray(previousOperations) ? [...previousOperations] : []

  const sources = []
  if (upload && upload.blob instanceof Blob) {
    sources.push({ type: 'blob', value: upload.blob })
  }
  if (typeof upload?.dataUrl === 'string' && upload.dataUrl) {
    sources.push({ type: 'url', value: upload.dataUrl })
  }
  if (
    typeof upload?.objectUrl === 'string' &&
    upload.objectUrl &&
    (!upload?.dataUrl || upload.objectUrl !== upload.dataUrl)
  ) {
    sources.push({ type: 'url', value: upload.objectUrl })
  }

  let baseCanvas = null
  let lastError = null

  for (const source of sources) {
    try {
      if (source.type === 'blob') {
        ;({ canvas: baseCanvas } = await canvasFromBlob(source.value))
      } else {
        const raw = source.value
        if (raw.startsWith('data:')) {
          ;({ canvas: baseCanvas } = await canvasFromDataUrl(raw))
        } else if (raw.startsWith('blob:')) {
          const response = await fetch(raw)
          if (!response.ok) {
            throw new Error('리사이즈할 이미지를 불러오지 못했습니다.')
          }
          const blob = await response.blob()
          ;({ canvas: baseCanvas } = await canvasFromBlob(blob))
        } else {
          const normalized = await ensureDataUrl(raw)
          ;({ canvas: baseCanvas } = await canvasFromDataUrl(normalized))
        }
      }
      if (baseCanvas) {
        break
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  if (!baseCanvas) {
    throw lastError || new Error('리사이즈할 이미지 데이터를 찾지 못했습니다.')
  }

  let workingCanvas = baseCanvas
  let operationLabel = '리사이즈'

  if (normalizedWidth !== baseCanvas.width) {
    const { canvas: resizedCanvas } = resizeCanvas(baseCanvas, normalizedWidth)
    workingCanvas = resizedCanvas
    operationLabel = normalizedWidth > baseCanvas.width ? '리사이즈(확대)' : '리사이즈(축소)'
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

function findLatestResultForSource(sourceId) {
  if (!sourceId) return null
  return state.results.find((result) => result.sourceId === sourceId) || null
}

function appendResult(upload, result, options = {}) {
  const { transferSelection = true, selectResult = true } = options
  const objectUrl = URL.createObjectURL(result.blob)
  const record = {
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
  }

  let shouldRefreshUploads = false
  if (transferSelection && upload && upload.id && state.selectedUploads.has(upload.id)) {
    state.selectedUploads.delete(upload.id)
    shouldRefreshUploads = true
  }

  if (selectResult && record.id) {
    state.selectedResults.add(record.id)
  }

  state.results.unshift(record)
  renderResults()
  if (shouldRefreshUploads) {
    renderUploads()
  }
  updateResultActionAvailability()
  updateOperationAvailability()
  recomputeStage()
  return record
}

function replaceResult(existingResult, updatedPayload) {
  const index = state.results.findIndex((item) => item.id === existingResult.id)
  if (index === -1) return

  const previous = state.results[index]
  if (previous.objectUrl) {
    try {
      URL.revokeObjectURL(previous.objectUrl)
    } catch (error) {
      console.warn('결과 객체 URL 해제 중 오류', error)
    }
  }

  const objectUrl = URL.createObjectURL(updatedPayload.blob)
  const updated = {
    ...previous,
    name: updatedPayload.name,
    width: updatedPayload.width,
    height: updatedPayload.height,
    size: updatedPayload.blob.size,
    blob: updatedPayload.blob,
    objectUrl,
    operations: updatedPayload.operations,
    updatedAt: Date.now(),
  }

  state.results[index] = updated
  removeAnalysisFor('result', updated.id)
  renderResults()
  updateResultActionAvailability()
  updateOperationAvailability()
  displayAnalysisFor({ type: 'result', id: updated.id })
  recomputeStage()
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

  const targetCount = operation === 'resize' ? uploadIds.length + resultIds.length : uploadIds.length
  if (!ensureActionAllowed(operation === 'resize' ? 'resize' : 'operation', { count: Math.max(1, targetCount), gate: 'operations' })) {
    return
  }

  setStage('refine')

  toggleProcessing(true)
  setStatus('이미지를 처리하는 중입니다…', 'info', 0)

  const handlerMap = {
    'remove-bg': processRemoveBackground,
    'auto-crop': processAutoCrop,
    'remove-bg-crop': processRemoveBackgroundAndCrop,
    denoise: processDenoise,
  }

  let targetWidth = null
  let processedCount = 0
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
      const blockedUploadIds = new Set()
      const targetedResultIds = new Set()

      for (const resultId of resultIds) {
        const relatedResult = state.results.find((item) => item.id === resultId)
        if (relatedResult?.sourceId) {
          blockedUploadIds.add(relatedResult.sourceId)
        }
      }

      for (const uploadId of uploadIds) {
        if (blockedUploadIds.has(uploadId)) {
          continue
        }
        const upload = state.uploads.find((item) => item.id === uploadId)
        if (!upload) continue
        const latestResult = findLatestResultForSource(upload.id)
        if (latestResult && !targetedResultIds.has(latestResult.id)) {
          targets.push({ type: 'result', payload: latestResult })
          targetedResultIds.add(latestResult.id)
        } else if (!latestResult) {
          targets.push({ type: 'upload', payload: upload })
        }
      }
      for (const resultId of resultIds) {
        if (targetedResultIds.has(resultId)) continue
        const result = state.results.find((item) => item.id === resultId)
        if (result) {
          targets.push({ type: 'result', payload: result })
          targetedResultIds.add(result.id)
        }
      }

      for (const target of targets) {
        if (target.type === 'upload') {
          const upload = target.payload
          // eslint-disable-next-line no-await-in-loop
          const resizeResult = await processResize(upload, targetWidth)
          if (resizeResult && resizeResult.blob) {
            processedCount += 1
            appendResult(upload, resizeResult)
          }
        } else {
          const resultItem = target.payload
          if (!resultItem) {
            // eslint-disable-next-line no-continue
            continue
          }

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
          const previousOps = Array.isArray(resultItem.operations) ? [...resultItem.operations] : []
          // eslint-disable-next-line no-await-in-loop
          const resizeResult = await processResize(pseudoUpload, targetWidth, previousOps)
          if (resizeResult && resizeResult.blob) {
            processedCount += 1
            replaceResult(resultItem, resizeResult)
          }
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
        if (result && result.blob) {
          processedCount += 1
        }
        appendResult(upload, result)
      }
    }

    if (processedCount > 0) {
      consumeCredits(operation === 'resize' ? 'resize' : 'operation', processedCount)
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

function handleUploadListChange(event) {
  if (!elements.uploadList) return
  const input = event.target
  if (!(input instanceof HTMLInputElement) || input.dataset.role !== 'upload-checkbox') return
  const card = input.closest('[data-type="upload"]')
  if (!card) return
  const id = card.dataset.id
  if (!id) return

  if (input.checked) {
    state.selectedUploads.add(id)
    displayAnalysisFor({ type: 'upload', id })
  } else {
    state.selectedUploads.delete(id)
    displayAnalysisFor()
  }

  card.classList.toggle('is-selected', input.checked)
  updateOperationAvailability()
  updateResultActionAvailability()
}

function handleUploadListClick(event) {
  if (!elements.uploadList) return
  const target = event.target instanceof HTMLElement ? event.target : null
  if (!target) return

  const removeButton = target.closest('[data-role="upload-remove"]')
  if (removeButton) {
    const card = removeButton.closest('[data-type="upload"]')
    if (!card) return
    const id = card.dataset.id
    if (!id) return
    deleteUploads([id])
    return
  }

  if (target.closest('.asset-card__checkbox')) {
    return
  }

  const card = target.closest('[data-type="upload"]')
  if (!card) return
  const checkbox = card.querySelector('input[data-role="upload-checkbox"]')
  if (!(checkbox instanceof HTMLInputElement)) return

  checkbox.checked = !checkbox.checked
  checkbox.dispatchEvent(new Event('change', { bubbles: true }))
}

function handleResultListChange(event) {
  if (!elements.resultList) return
  const input = event.target
  if (!(input instanceof HTMLInputElement) || input.dataset.role !== 'result-checkbox') return
  const card = input.closest('[data-type="result"]')
  if (!card) return
  const id = card.dataset.id
  if (!id) return

  if (input.checked) {
    state.selectedResults.add(id)
    displayAnalysisFor({ type: 'result', id })
  } else {
    state.selectedResults.delete(id)
    displayAnalysisFor()
  }

  card.classList.toggle('is-selected', input.checked)
  updateResultActionAvailability()
  updateOperationAvailability()
}

function handleResultListClick(event) {
  if (!elements.resultList) return
  const target = event.target instanceof HTMLElement ? event.target : null
  if (!target) return

  const removeButton = target.closest('[data-role="result-remove"]')
  if (removeButton) {
    const card = removeButton.closest('[data-type="result"]')
    if (!card) return
    const id = card.dataset.id
    if (!id) return
    deleteResults([id])
    return
  }

  const downloadButton = target.closest('button[data-action="download-result"]')
  if (downloadButton) {
    const card = downloadButton.closest('[data-type="result"]')
    if (!card) return
    const id = card.dataset.id
    if (!id) return
    downloadResults([id])
    return
  }

  if (target.closest('.asset-card__checkbox')) {
    return
  }

  const card = target.closest('[data-type="result"]')
  if (!card) return
  const checkbox = card.querySelector('input[data-role="result-checkbox"]')
  if (!(checkbox instanceof HTMLInputElement)) return

  checkbox.checked = !checkbox.checked
  checkbox.dispatchEvent(new Event('change', { bubbles: true }))
}

function selectAllUploads() {
  state.uploads.forEach((upload) => state.selectedUploads.add(upload.id))
  renderUploads()
  updateOperationAvailability()
  updateResultActionAvailability()
}

function clearUploadsSelection() {
  state.selectedUploads.clear()
  renderUploads()
  updateOperationAvailability()
  updateResultActionAvailability()
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

async function downloadResults(ids, mode = 'selected') {
  const targets = ids.map((id) => state.results.find((result) => result.id === id)).filter(Boolean)
  if (targets.length === 0) {
    setStatus('다운로드할 결과를 선택해주세요.', 'danger')
    return
  }

  setStage('export')

  const actionType = mode === 'all' ? 'downloadAll' : 'download'
  if (!ensureActionAllowed(actionType, { count: Math.max(1, targets.length), gate: 'results' })) {
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
    consumeCredits(actionType, targets.length)
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

  if (elements.headerAuthButton instanceof HTMLButtonElement) {
    elements.headerAuthButton.addEventListener('click', () => {
      const action = elements.headerAuthButton.dataset.action
      if (action === 'logout') {
        handleLogout()
      } else {
        openLoginModal()
      }
    })
  }

  if (elements.adminLoginButton instanceof HTMLButtonElement) {
    elements.adminLoginButton.addEventListener('click', () => {
      if (state.admin.isLoggedIn) {
        setView('admin')
        if (elements.adminDashboard instanceof HTMLElement) {
          elements.adminDashboard.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        if (elements.adminNavButton instanceof HTMLButtonElement) {
          elements.adminNavButton.focus()
        }
      } else {
        openAdminModal()
      }
    })
  }

  elements.navButtons?.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return
    button.addEventListener('click', () => handleNavigationClick(button.dataset.viewTarget || 'home'))
  })

  if (elements.adminModalDashboardButton instanceof HTMLButtonElement) {
    elements.adminModalDashboardButton.addEventListener('click', () => {
      closeAdminModal()
      setView('admin')
      if (elements.adminDashboard instanceof HTMLElement) {
        elements.adminDashboard.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }

  if (elements.adminModalLogoutButton instanceof HTMLButtonElement) {
    elements.adminModalLogoutButton.addEventListener('click', () => {
      closeAdminModal()
      handleLogout()
    })
  }

  document.querySelectorAll('[data-action="close-login"]').forEach((button) => {
    if (button instanceof HTMLButtonElement) {
      button.addEventListener('click', closeLoginModal)
    }
  })

  document.querySelectorAll('[data-action="close-admin"]').forEach((button) => {
    if (button instanceof HTMLButtonElement) {
      button.addEventListener('click', closeAdminModal)
    }
  })

  const adminBackdrop = elements.adminModal?.querySelector('.admin-modal__backdrop')
  if (adminBackdrop instanceof HTMLElement) {
    adminBackdrop.addEventListener('click', closeAdminModal)
  }

  const logoutButton = document.querySelector('[data-action="logout"]')
  if (logoutButton instanceof HTMLButtonElement) {
    logoutButton.addEventListener('click', handleLogout)
  }

  if (elements.loginEmailResend instanceof HTMLButtonElement) {
    elements.loginEmailResend.addEventListener('click', handleEmailResend)
  }

  const loginBackdrop = elements.loginModal?.querySelector('.login-modal__backdrop')
  if (loginBackdrop instanceof HTMLElement) {
    loginBackdrop.addEventListener('click', closeLoginModal)
  }

  if (elements.googleLoginButton instanceof HTMLButtonElement) {
    elements.googleLoginButton.addEventListener('click', handleGoogleLogin)
    elements.googleLoginButton.addEventListener('pointerenter', () => {
      if (!runtime.google.codeClient && !runtime.google.prefetchPromise) {
        prefetchGoogleClient().catch((error) => {
          console.warn('Google client prefetch 중 오류', error)
        })
      }
    })
    elements.googleLoginButton.addEventListener('focus', () => {
      if (!runtime.google.codeClient && !runtime.google.prefetchPromise) {
        prefetchGoogleClient().catch((error) => {
          console.warn('Google client prefetch 중 오류', error)
        })
      }
    })
  }

  if (elements.loginEmailForm instanceof HTMLFormElement) {
    elements.loginEmailForm.addEventListener('submit', handleEmailLogin)
  }

  if (elements.adminLoginForm instanceof HTMLFormElement) {
    elements.adminLoginForm.addEventListener('submit', handleAdminLogin)
  }

  if (elements.adminImportForm instanceof HTMLFormElement) {
    elements.adminImportForm.addEventListener('submit', handleAdminImport)
  }

  if (elements.adminRefreshButton instanceof HTMLButtonElement) {
    elements.adminRefreshButton.addEventListener('click', handleAdminRefresh)
  }

  if (elements.adminRunCompletionButton instanceof HTMLButtonElement) {
    elements.adminRunCompletionButton.addEventListener('click', handleAdminRunCompletion)
  }

  if (elements.adminDownloadCompletion instanceof HTMLButtonElement) {
    elements.adminDownloadCompletion.addEventListener('click', handleAdminDownloadCompletion)
  }

  if (elements.adminLogoutButton instanceof HTMLButtonElement) {
    elements.adminLogoutButton.addEventListener('click', handleLogout)
  }

  if (elements.loginEmailInput instanceof HTMLInputElement) {
    elements.loginEmailInput.addEventListener('input', () => {
      if (state.auth.step !== 'code') {
        const value = elements.loginEmailInput.value.trim()
        if (!value) {
          setLoginHelper('이메일 주소를 입력하면 인증 코드를 보내드립니다.')
        }
      }
    })
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
    button.addEventListener('click', () => runOperation(operation))
  })

  if (elements.svgButton instanceof HTMLButtonElement) {
    elements.svgButton.addEventListener('click', convertSelectionsToSvg)
  }

  if (elements.uploadList) {
    elements.uploadList.addEventListener('change', handleUploadListChange)
    elements.uploadList.addEventListener('click', handleUploadListClick)
  }

  if (elements.resultList) {
    elements.resultList.addEventListener('change', handleResultListChange)
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
      if (state.selectedUploads.size === 0) {
        setStatus('삭제할 업로드 이미지를 선택해주세요.', 'danger')
        return
      }
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
      if (state.selectedResults.size === 0) {
        setStatus('삭제할 결과 이미지를 선택해주세요.', 'danger')
        return
      }
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
        downloadResults(state.results.map((result) => result.id), 'all')
      } else {
        downloadResults(Array.from(state.selectedResults), mode)
      }
    })
  })

  document
    .querySelectorAll('[data-role="operations-gate-login"], [data-role="results-gate-login"]')
    .forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return
      button.addEventListener('click', () => {
        openLoginModal()
      })
    })

  document.addEventListener('keydown', handleGlobalKeydown)
}

function init() {
  const config = getAppConfig()
  const allowedViews = new Set(['home', 'community', 'admin'])
  const normalizeView = (value) => {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim().toLowerCase()
    return allowedViews.has(trimmed) ? trimmed : ''
  }

  let requestedView = ''
  try {
    const url = new URL(window.location.href)
    requestedView = normalizeView(url.searchParams.get('view'))
    if (!requestedView && url.hash) {
      requestedView = normalizeView(url.hash.replace('#', ''))
    }
  } catch (error) {
    requestedView = ''
  }

  const configInitial = normalizeView(config.initialView)
  const initialView = requestedView || configInitial || 'home'

  runtime.config = config
  runtime.initialView = initialView
  const allowBypass = initialView !== 'home' && initialView !== 'admin'
  runtime.allowViewBypass = allowBypass
  state.view = initialView

  if (elements.communityLink instanceof HTMLAnchorElement) {
    const configuredUrl = typeof config.communityUrl === 'string' ? config.communityUrl.trim() : ''
    if (configuredUrl) {
      elements.communityLink.href = configuredUrl
    }
  }

  if (runtime.allowViewBypass) {
    setView(initialView, { force: true, bypassAccess: true })
  } else {
    setView(initialView, { force: true })
  }

  updateOperationAvailability()
  updateResultActionAvailability()
  attachEventListeners()
  updateAdminUI()
  initCookieBanner()
  resetLoginFlow()
  prefetchGoogleClient()
  renderUploads()
  renderResults()
  displayAnalysisFor(null)
  refreshAccessStates()

  syncAdminSession().finally(() => {
    if (runtime.initialView === 'admin' && !state.admin.isLoggedIn) {
      window.setTimeout(() => {
        if (!state.admin.isLoggedIn) {
          openAdminModal()
        }
      }, 400)
    }
  })
}

document.addEventListener('DOMContentLoaded', init)
