const TOTAL_DAYS = 15
const DAYS_PER_WEEK = 5
const STORAGE_KEY = 'michina-community-submissions'
const ROLE_STORAGE_KEY = 'role'

const STATUS_TONE_CLASSES = {
  info: 'border-white/15 bg-slate-900/70 text-white/80',
  success: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100',
  warning: 'border-amber-400/40 bg-amber-500/15 text-amber-100',
  error: 'border-rose-500/40 bg-rose-500/20 text-rose-100',
}

function createDefaultState() {
  return {
    submissions: Array.from({ length: TOTAL_DAYS }, () => null),
    completedAt: null,
  }
}

function loadState() {
  const fallback = createDefaultState()
  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY)
    if (!stored) {
      return fallback
    }
    const parsed = JSON.parse(stored)
    const submissions = Array.from({ length: TOTAL_DAYS }, (_, index) => {
      const entry = Array.isArray(parsed?.submissions) ? parsed.submissions[index] : null
      if (!entry || typeof entry !== 'object') {
        return null
      }
      const type = entry.type === 'image' || entry.type === 'url' ? entry.type : null
      const value = typeof entry.value === 'string' && entry.value.length > 0 ? entry.value : null
      if (!type || !value) {
        return null
      }
      return {
        type,
        value,
        submittedAt:
          typeof entry.submittedAt === 'string' && entry.submittedAt.length > 0
            ? entry.submittedAt
            : new Date().toISOString(),
        name: typeof entry.name === 'string' ? entry.name : undefined,
        size: Number.isFinite(entry.size) ? entry.size : undefined,
      }
    })
    const completedAt = typeof parsed?.completedAt === 'string' ? parsed.completedAt : null
    return { submissions, completedAt }
  } catch (error) {
    console.error('커뮤니티 진행 데이터를 불러오는 데 실패했습니다.', error)
    return fallback
  }
}

function saveState(state) {
  try {
    const payload = {
      submissions: state.submissions.map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }
        return {
          type: entry.type,
          value: entry.value,
          submittedAt: entry.submittedAt,
          name: entry.name,
          size: entry.size,
        }
      }),
      completedAt: state.completedAt,
    }
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch (error) {
    console.error('커뮤니티 진행 데이터를 저장하는 데 실패했습니다.', error)
    return false
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('UNEXPECTED_FILE_READER_RESULT'))
      }
    }
    reader.onerror = () => {
      reject(reader.error || new Error('FILE_READER_ERROR'))
    }
    reader.readAsDataURL(file)
  })
}

function formatSubmittedMeta(submission) {
  if (!submission?.submittedAt) {
    return '제출 대기 중'
  }
  const date = new Date(submission.submittedAt)
  if (Number.isNaN(date.getTime())) {
    return '제출됨'
  }
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return match
    }
  })
}

function createCertificateSvg(dateText) {
  const issuedDate = escapeHtml(dateText)
  const displayName = escapeHtml('미치나 챌린저')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="780" viewBox="0 0 1120 780">
  <defs>
    <linearGradient id="michinaGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="50%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#14b8a6" />
    </linearGradient>
    <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="lighter" />
    </filter>
  </defs>
  <rect width="1120" height="780" fill="#020617" rx="32" />
  <rect x="36" y="36" width="1048" height="708" fill="url(#michinaGradient)" opacity="0.28" rx="24" />
  <rect x="60" y="60" width="1000" height="660" fill="#0b1628" rx="24" filter="url(#softGlow)" />
  <text x="560" y="180" text-anchor="middle" fill="#34d399" font-size="32" font-family="'Inter', 'Pretendard', sans-serif" letter-spacing="8">MICHINA PROGRAM</text>
  <text x="560" y="250" text-anchor="middle" fill="#e2e8f0" font-size="54" font-family="'Inter', 'Pretendard', sans-serif" font-weight="700">커뮤니티 미션 수료증</text>
  <text x="560" y="335" text-anchor="middle" fill="#cbd5f5" font-size="24" font-family="'Inter', 'Pretendard', sans-serif">Ellie Image Editor는 아래 참가자가 15일 챌린지를 완주했음을 인증합니다.</text>
  <text x="560" y="430" text-anchor="middle" fill="#f8fafc" font-size="72" font-family="'Inter', 'Pretendard', sans-serif" font-weight="700">${displayName}</text>
  <text x="560" y="500" text-anchor="middle" fill="#bae6fd" font-size="26" font-family="'Inter', 'Pretendard', sans-serif">완주일: ${issuedDate}</text>
  <text x="560" y="585" text-anchor="middle" fill="#38bdf8" font-size="22" font-family="'Inter', 'Pretendard', sans-serif">Ellie Image Editor · Michina Community Team</text>
</svg>`
}

class CommunityDashboard {
  constructor(root) {
    this.root = root
    this.state = loadState()
    this.elements = {}
  }

  init() {
    this.renderShell()
    const hadExistingRecords = this.state.submissions.some(Boolean)
    this.renderDays()
    const completedNow = this.updateProgress()

    if (hadExistingRecords) {
      if (this.state.completedAt) {
        this.showMessage('이전에 저장된 완주 기록을 불러왔습니다. 축하합니다!', 'success')
      } else {
        this.showMessage('저장된 미션 진행 내역을 불러왔습니다. 이어서 도전해보세요.', 'info')
      }
    } else if (!completedNow) {
      this.showMessage('오늘의 미션을 제출하면 진행률이 올라가고 자동으로 저장됩니다.', 'info')
    }
  }

  renderShell() {
    const year = new Date().getFullYear()
    this.root.innerHTML = `
      <div class="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        <header class="border-b border-white/10 bg-slate-900/60 backdrop-blur">
          <div class="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300/80">Michina Program</p>
              <h1 class="mt-2 text-3xl font-bold md:text-4xl">미치나 커뮤니티 대시보드</h1>
              <p class="mt-3 max-w-xl text-sm text-white/70 md:text-base">
                3주(15일) 동안 주 5일 미션을 제출하고 완주하면 Ellie Image Editor의 모든 이미지 편집 기능이 해금됩니다.
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span data-role="role-status" class="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 backdrop-blur">
                미션을 완주하면 모든 이미지 편집 기능이 해금됩니다.
              </span>
            </div>
          </div>
        </header>
        <main class="flex-1 w-full max-w-6xl space-y-10 px-6 py-10 mx-auto" data-role="dashboard-main">
          <section class="rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-2xl">
            <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 class="text-xl font-semibold text-white">미션 진행 현황</h2>
                <p class="mt-1 text-sm text-white/70">평일 기준 3주(15일) 동안 도전하세요.</p>
              </div>
              <div class="text-right">
                <p class="text-3xl font-bold text-emerald-300" data-role="progress-percent">0%</p>
                <p class="text-sm text-white/60" data-role="progress-label">0 / 15 제출</p>
              </div>
            </div>
            <div class="mt-5 h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div class="h-full rounded-full bg-emerald-400 transition-[width] duration-500 ease-out" data-role="progress-bar" style="width: 0%"></div>
            </div>
            <div class="mt-5">
              <div class="rounded-2xl border border-white/15 bg-slate-900/70 px-4 py-3 text-sm font-medium text-white/80" data-role="status-banner">
                오늘의 미션을 완료하면 진행률이 올라갑니다.
              </div>
            </div>
            <div class="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div class="text-sm text-white/60" data-role="completion-note">
                제출 자료는 이 브라우저의 localStorage에 저장되며 서버로 전송되지 않습니다.
              </div>
              <button
                type="button"
                class="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/60 px-4 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:border-white/20 disabled:text-white/40 disabled:hover:bg-transparent"
                data-role="certificate-button"
                disabled
                aria-disabled="true"
              >
                <i class="ri-award-line text-lg"></i>
                수료증 다운로드
              </button>
            </div>
          </section>
          <section class="space-y-10" data-role="weeks"></section>
        </main>
        <footer class="border-t border-white/10 bg-slate-900/80">
          <div class="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-6 text-sm text-white/60 md:flex-row md:items-center md:justify-between">
            <p>&copy; ${year} Ellie Image Editor · Michina Program</p>
            <p>미션 데이터는 브라우저에만 저장되며 언제든지 이 페이지에서 업데이트할 수 있습니다.</p>
          </div>
        </footer>
      </div>
    `

    this.elements.progressPercent = this.root.querySelector('[data-role="progress-percent"]')
    this.elements.progressLabel = this.root.querySelector('[data-role="progress-label"]')
    this.elements.progressBar = this.root.querySelector('[data-role="progress-bar"]')
    this.elements.status = this.root.querySelector('[data-role="status-banner"]')
    this.elements.certificateButton = this.root.querySelector('[data-role="certificate-button"]')
    this.elements.weeks = this.root.querySelector('[data-role="weeks"]')
    this.elements.roleStatus = this.root.querySelector('[data-role="role-status"]')
    this.elements.completionNote = this.root.querySelector('[data-role="completion-note"]')

    if (this.elements.certificateButton instanceof HTMLButtonElement) {
      this.elements.certificateButton.addEventListener('click', () => {
        this.handleCertificateDownload()
      })
    }
  }

  renderDays() {
    if (!(this.elements.weeks instanceof HTMLElement)) {
      return
    }

    this.elements.weeks.innerHTML = ''
    const weekCount = Math.ceil(TOTAL_DAYS / DAYS_PER_WEEK)

    for (let week = 0; week < weekCount; week += 1) {
      const section = document.createElement('section')
      section.className = 'space-y-4'

      const header = document.createElement('div')
      header.className = 'flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between'

      const title = document.createElement('h3')
      title.className = 'text-lg font-semibold text-white'
      title.textContent = `Week ${week + 1}`

      const subtitle = document.createElement('p')
      subtitle.className = 'text-sm text-white/60'
      subtitle.textContent = '주 5일 챌린지'

      header.append(title, subtitle)

      const grid = document.createElement('div')
      grid.className = 'grid gap-6 md:grid-cols-2 xl:grid-cols-3'

      for (let day = 0; day < DAYS_PER_WEEK; day += 1) {
        const dayIndex = week * DAYS_PER_WEEK + day
        if (dayIndex >= TOTAL_DAYS) {
          break
        }
        grid.appendChild(this.createDayCard(dayIndex))
      }

      section.append(header, grid)
      this.elements.weeks.append(section)
    }
  }

  createDayCard(dayIndex) {
    const card = document.createElement('article')
    card.className = 'flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900/60 p-6 shadow-xl transition-all hover:border-emerald-400/40 hover:shadow-emerald-400/10'
    card.dataset.dayIndex = String(dayIndex)

    const header = document.createElement('div')
    header.className = 'flex items-start justify-between gap-3'

    const headingGroup = document.createElement('div')
    const badge = document.createElement('p')
    badge.className = 'text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300/80'
    badge.textContent = `Day ${dayIndex + 1}`
    const heading = document.createElement('h4')
    heading.className = 'mt-1 text-xl font-semibold text-white'
    heading.textContent = '미션 제출'
    headingGroup.append(badge, heading)

    const statusBadge = document.createElement('span')
    statusBadge.dataset.role = 'day-status'
    statusBadge.className = 'rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/70'
    statusBadge.textContent = '대기 중'

    header.append(headingGroup, statusBadge)

    const preview = document.createElement('div')
    preview.dataset.role = 'day-preview'
    preview.className = 'flex h-44 w-full items-center justify-center rounded-xl border border-white/10 bg-slate-950/40 p-4 text-sm text-white/50'
    preview.textContent = '이미지를 업로드하거나 URL을 제출해주세요.'

    const controls = document.createElement('div')
    controls.className = 'space-y-3'

    const uploadWrapper = document.createElement('div')
    uploadWrapper.className = 'flex flex-col gap-2'

    const uploadButton = document.createElement('button')
    uploadButton.type = 'button'
    uploadButton.className = 'inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200'
    uploadButton.innerHTML = '<i class="ri-upload-2-line"></i><span>이미지 업로드</span>'

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif'
    fileInput.hidden = true

    uploadButton.addEventListener('click', (event) => {
      event.preventDefault()
      fileInput.click()
    })

    fileInput.addEventListener('change', async (event) => {
      const target = event.target
      const selectedFile = target?.files?.[0]
      if (selectedFile) {
        await this.handleFileUpload(dayIndex, selectedFile)
      }
      target.value = ''
    })

    uploadWrapper.append(uploadButton, fileInput)

    const urlForm = document.createElement('form')
    urlForm.className = 'flex flex-col gap-2 sm:flex-row'
    urlForm.dataset.role = 'url-form'

    const urlInput = document.createElement('input')
    urlInput.type = 'url'
    urlInput.placeholder = '미션 결과 URL을 입력하세요'
    urlInput.className = 'flex-1 rounded-lg border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300'
    urlInput.dataset.role = 'url-input'

    const urlSubmit = document.createElement('button')
    urlSubmit.type = 'submit'
    urlSubmit.className = 'inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-400/60 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300'
    urlSubmit.innerHTML = '<i class="ri-link-m"></i><span>URL 제출</span>'

    urlForm.addEventListener('submit', (event) => {
      event.preventDefault()
      this.handleUrlSubmit(dayIndex, urlInput.value)
    })

    urlForm.append(urlInput, urlSubmit)

    const footerRow = document.createElement('div')
    footerRow.className = 'flex items-center justify-between text-xs text-white/50'

    const submittedMeta = document.createElement('span')
    submittedMeta.dataset.role = 'submitted-meta'
    submittedMeta.textContent = '제출 대기 중'

    const clearButton = document.createElement('button')
    clearButton.type = 'button'
    clearButton.dataset.role = 'clear-button'
    clearButton.className = 'text-xs font-semibold text-white/50 underline-offset-2 transition hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:text-white/20'
    clearButton.textContent = '제출 초기화'
    clearButton.disabled = true

    clearButton.addEventListener('click', (event) => {
      event.preventDefault()
      this.clearSubmission(dayIndex)
    })

    footerRow.append(submittedMeta, clearButton)

    controls.append(uploadWrapper, urlForm, footerRow)

    card.append(header, preview, controls)
    this.updateCardState(card, dayIndex)
    return card
  }

  updateCardState(card, dayIndex) {
    const submission = this.state.submissions[dayIndex]
    const statusBadge = card.querySelector('[data-role="day-status"]')
    const preview = card.querySelector('[data-role="day-preview"]')
    const submittedMeta = card.querySelector('[data-role="submitted-meta"]')
    const clearButton = card.querySelector('[data-role="clear-button"]')
    const urlInput = card.querySelector('[data-role="url-input"]')

    if (!(preview instanceof HTMLElement)) {
      return
    }

    preview.innerHTML = ''

    if (submission) {
      if (statusBadge instanceof HTMLElement) {
        statusBadge.className = 'rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200'
        statusBadge.textContent = '완료'
      }

      if (submittedMeta instanceof HTMLElement) {
        const meta = formatSubmittedMeta(submission)
        const typeLabel = submission.type === 'image' ? '이미지 제출' : 'URL 제출'
        submittedMeta.textContent = `${meta} · ${typeLabel}`
      }

      if (clearButton instanceof HTMLButtonElement) {
        clearButton.disabled = false
      }

      if (urlInput instanceof HTMLInputElement) {
        urlInput.value = submission.type === 'url' ? submission.value : ''
      }

      if (submission.type === 'image') {
        const image = new Image()
        image.src = submission.value
        image.alt = `Day ${dayIndex + 1} 제출 이미지`
        image.className = 'h-36 w-full rounded-lg border border-white/10 bg-slate-950/80 object-contain p-2 shadow-inner'
        preview.append(image)
      } else {
        const link = document.createElement('a')
        link.href = submission.value
        link.target = '_blank'
        link.rel = 'noopener'
        link.className = 'inline-flex items-center gap-2 text-sm font-semibold text-emerald-200 hover:text-emerald-100'
        link.innerHTML = '<i class="ri-external-link-line text-base"></i><span>제출한 링크 열기</span>'
        preview.append(link)
      }
    } else {
      if (statusBadge instanceof HTMLElement) {
        statusBadge.className = 'rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/70'
        statusBadge.textContent = '대기 중'
      }
      if (submittedMeta instanceof HTMLElement) {
        submittedMeta.textContent = '제출 대기 중'
      }
      if (clearButton instanceof HTMLButtonElement) {
        clearButton.disabled = true
      }
      if (urlInput instanceof HTMLInputElement) {
        urlInput.value = ''
      }
      preview.textContent = '이미지를 업로드하거나 URL을 제출해주세요.'
    }
  }

  async handleFileUpload(dayIndex, file) {
    if (!(file instanceof File)) {
      return
    }

    if (!file.type.startsWith('image/')) {
      this.showMessage('이미지 파일만 업로드할 수 있습니다.', 'warning')
      return
    }

    try {
      const dataUrl = await readFileAsDataURL(file)
      this.state.submissions[dayIndex] = {
        type: 'image',
        value: dataUrl,
        submittedAt: new Date().toISOString(),
        name: file.name,
        size: file.size,
      }
      if (!saveState(this.state)) {
        this.showMessage('진행 상황을 저장하지 못했습니다. 저장 공간을 확인해주세요.', 'error')
      }
      this.renderDays()
      const completedNow = this.updateProgress()
      if (completedNow) {
        this.showMessage('15일 미션을 모두 완료했습니다! 수료증을 다운로드해보세요.', 'success')
      } else {
        this.showMessage(`DAY ${dayIndex + 1} 이미지가 업로드되었습니다.`, 'success')
      }
    } catch (error) {
      console.error('이미지 업로드 처리 중 오류가 발생했습니다.', error)
      this.showMessage('이미지를 불러오지 못했습니다. 다시 시도해주세요.', 'error')
    }
  }

  handleUrlSubmit(dayIndex, rawValue) {
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!value) {
      this.showMessage('제출할 URL을 입력해주세요.', 'warning')
      return
    }

    let normalized
    try {
      normalized = new URL(value, window.location.origin).toString()
    } catch (error) {
      console.error('제출 URL 검증에 실패했습니다.', error)
      this.showMessage('올바른 URL을 입력해주세요.', 'warning')
      return
    }

    this.state.submissions[dayIndex] = {
      type: 'url',
      value: normalized,
      submittedAt: new Date().toISOString(),
    }

    if (!saveState(this.state)) {
      this.showMessage('진행 상황을 저장하지 못했습니다. 저장 공간을 확인해주세요.', 'error')
    }

    this.renderDays()
    const completedNow = this.updateProgress()
    if (completedNow) {
      this.showMessage('15일 미션을 모두 완료했습니다! 수료증을 다운로드해보세요.', 'success')
    } else {
      this.showMessage(`DAY ${dayIndex + 1} URL이 제출되었습니다.`, 'success')
    }
  }

  clearSubmission(dayIndex) {
    if (!this.state.submissions[dayIndex]) {
      return
    }

    this.state.submissions[dayIndex] = null
    if (!saveState(this.state)) {
      this.showMessage('제출 내역을 업데이트하지 못했습니다. 잠시 후 다시 시도해주세요.', 'error')
    }
    this.renderDays()
    this.updateProgress()
    this.showMessage(`DAY ${dayIndex + 1} 제출이 초기화되었습니다.`, 'info')
  }

  updateProgress() {
    const completed = this.state.submissions.filter(Boolean).length
    const percent = Math.round((completed / TOTAL_DAYS) * 100)

    if (this.elements.progressPercent instanceof HTMLElement) {
      this.elements.progressPercent.textContent = `${percent}%`
    }

    if (this.elements.progressLabel instanceof HTMLElement) {
      this.elements.progressLabel.textContent = `${completed} / ${TOTAL_DAYS} 제출`
    }

    if (this.elements.progressBar instanceof HTMLElement) {
      this.elements.progressBar.style.width = `${percent}%`
    }

    const wasComplete = Boolean(this.state.completedAt)
    const isComplete = completed >= TOTAL_DAYS

    if (isComplete && !this.state.completedAt) {
      this.state.completedAt = new Date().toISOString()
      saveState(this.state)
    } else if (!isComplete && this.state.completedAt) {
      this.state.completedAt = null
      saveState(this.state)
    }

    if (this.elements.certificateButton instanceof HTMLButtonElement) {
      this.elements.certificateButton.disabled = !isComplete
      this.elements.certificateButton.setAttribute('aria-disabled', String(!isComplete))
    }

    if (this.elements.roleStatus instanceof HTMLElement) {
      if (isComplete) {
        this.elements.roleStatus.textContent = '미치나 멤버십이 활성화되었습니다. 이제 모든 편집 기능을 이용할 수 있어요.'
        this.elements.roleStatus.className = 'rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 shadow-[0_0_25px_rgba(16,185,129,0.25)]'
      } else {
        this.elements.roleStatus.textContent = '미션을 완주하면 모든 이미지 편집 기능이 해금됩니다.'
        this.elements.roleStatus.className = 'rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 backdrop-blur'
      }
    }

    if (this.elements.completionNote instanceof HTMLElement) {
      if (completed === 0) {
        this.elements.completionNote.textContent = '제출 자료는 이 브라우저의 localStorage에 저장되며 서버로 전송되지 않습니다.'
      } else if (!isComplete) {
        this.elements.completionNote.textContent = `현재 ${completed}일 제출 완료 · 남은 ${TOTAL_DAYS - completed}일을 이어서 도전해보세요.`
      } else {
        this.elements.completionNote.textContent = '완주를 축하드립니다! Ellie Image Editor의 모든 편집 기능이 해금되었습니다.'
      }
    }

    if (isComplete) {
      try {
        window.localStorage?.setItem(ROLE_STORAGE_KEY, 'michina')
      } catch (error) {
        console.error('미치나 역할 정보를 저장하지 못했습니다.', error)
      }
    }

    return isComplete && !wasComplete
  }

  handleCertificateDownload() {
    if (!this.state.completedAt) {
      this.showMessage('아직 모든 미션을 완료하지 않았습니다.', 'warning')
      return
    }

    try {
      const completionDate = new Date(this.state.completedAt)
      const formatted = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long' }).format(completionDate)
      const svg = createCertificateSvg(formatted)
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `michina-certificate-${completionDate.getFullYear()}${String(completionDate.getMonth() + 1).padStart(2, '0')}${String(completionDate.getDate()).padStart(2, '0')}.svg`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      this.showMessage('수료증이 다운로드되었습니다. 축하합니다!', 'success')
    } catch (error) {
      console.error('수료증 파일을 생성하는 중 오류가 발생했습니다.', error)
      this.showMessage('수료증 파일을 만드는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.', 'error')
    }
  }

  showMessage(message, tone = 'info') {
    if (!(this.elements.status instanceof HTMLElement)) {
      if (tone === 'error') {
        window.alert(message)
      }
      return
    }
    const toneClass = STATUS_TONE_CLASSES[tone] || STATUS_TONE_CLASSES.info
    this.elements.status.className = `rounded-2xl border px-4 py-3 text-sm font-medium transition-colors ${toneClass}`
    this.elements.status.textContent = message
  }
}

export function bootstrapCommunityDashboard() {
  const root = document.getElementById('community-dashboard-root')
  if (!(root instanceof HTMLElement)) {
    console.warn('커뮤니티 대시보드 루트 요소를 찾을 수 없습니다.')
    return null
  }
  const dashboard = new CommunityDashboard(root)
  dashboard.init()
  return dashboard
}
