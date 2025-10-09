const elements = {
  logoutButton: document.querySelector('[data-role="dashboard-logout"]'),
  uploadForm: document.querySelector('[data-role="dashboard-upload-form"]'),
  uploadFile: document.querySelector('[data-role="dashboard-upload-file"]'),
  startDate: document.querySelector('[data-role="dashboard-start-date"]'),
  endDate: document.querySelector('[data-role="dashboard-end-date"]'),
  uploadStatus: document.querySelector('[data-role="dashboard-upload-status"]'),
  refreshStats: document.querySelector('[data-role="dashboard-refresh-stats"]'),
  totalParticipants: document.querySelector('[data-role="dashboard-total-participants"]'),
  completedCount: document.querySelector('[data-role="dashboard-completed-count"]'),
  pendingCount: document.querySelector('[data-role="dashboard-pending-count"]'),
  runCompletionCheck: document.querySelector('[data-role="dashboard-run-check"]'),
  refreshCompletions: document.querySelector('[data-role="dashboard-refresh-completions"]'),
  completionsTableBody: document.querySelector('[data-role="dashboard-completions-body"]'),
  completionsEmpty: document.querySelector('[data-role="dashboard-completions-empty"]'),
  completionsStatus: document.querySelector('[data-role="dashboard-completions-status"]'),
  downloadCompletions: document.querySelector('[data-role="dashboard-download-completions"]'),
  downloadTemplate: document.querySelector('[data-role="dashboard-download-template"]'),
}

const state = {
  participants: [],
  completions: [],
}

function isValidEmail(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
}

function parseCsvParticipants(text) {
  if (typeof text !== 'string' || !text.trim()) return []
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length === 0) return []
  const entries = []
  for (const line of lines) {
    const sanitized = line.trim()
    if (!sanitized) continue
    const parts = sanitized
      .split(',')
      .map((part) => part.replace(/^"|"$/g, '').trim())
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

function toIsoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const normalized = value.trim()
  const isoCandidate = `${normalized}T00:00:00Z`
  const parsed = new Date(isoCandidate)
  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }
  return parsed.toISOString()
}

function setStatus(element, message, tone = 'muted') {
  if (!(element instanceof HTMLElement)) return
  element.textContent = message || ''
  element.dataset.tone = tone
  element.hidden = !message
}

function formatDateTime(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

async function handleLogout() {
  try {
    await fetch('/api/auth/admin/logout', {
      method: 'POST',
      credentials: 'include',
    })
  } catch (error) {
    console.warn('logout_failed', error)
  } finally {
    window.location.href = '/'
  }
}

async function handleUpload(event) {
  event.preventDefault()
  if (!(elements.uploadForm instanceof HTMLFormElement)) return

  const file = elements.uploadFile?.files?.[0]
  if (!file) {
    setStatus(elements.uploadStatus, '업로드할 CSV 파일을 선택해주세요.', 'warning')
    return
  }

  setStatus(elements.uploadStatus, '참가자 명단을 업로드하는 중입니다…', 'info')

  try {
    const text = await file.text()
    const parsed = parseCsvParticipants(text)
    const deduped = dedupeParticipants(parsed)

    if (deduped.length === 0) {
      setStatus(elements.uploadStatus, '유효한 참가자 정보를 찾지 못했습니다.', 'danger')
      return
    }

    const startDateIso = toIsoDate(elements.startDate?.value || '')
    const endDateIso = toIsoDate(elements.endDate?.value || '')

    const payload = {
      participants: deduped,
    }
    if (startDateIso) payload.startDate = startDateIso
    if (endDateIso) payload.endDate = endDateIso

    const response = await fetch('/api/admin/challenge/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })

    if (response.status === 401) {
      setStatus(elements.uploadStatus, '세션이 만료되었습니다. 다시 로그인해주세요.', 'danger')
      window.setTimeout(() => {
        window.location.href = '/'
      }, 1200)
      return
    }

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}))
      const message = typeof detail?.error === 'string' ? detail.error : '명단 업로드에 실패했습니다.'
      setStatus(elements.uploadStatus, message, 'danger')
      return
    }

    const result = await response.json().catch(() => ({}))
    const imported = Number.isFinite(Number(result?.imported)) ? Number(result.imported) : deduped.length
    setStatus(elements.uploadStatus, `참가자 ${imported}명을 성공적으로 업로드했습니다.`, 'success')
    elements.uploadForm.reset()
    await Promise.all([fetchParticipants(), fetchCompletions()])
  } catch (error) {
    console.error('dashboard_upload_failed', error)
    setStatus(elements.uploadStatus, '명단 업로드 중 오류가 발생했습니다.', 'danger')
  }
}

function updateStats() {
  const total = state.participants.length
  const completed = state.participants.filter((participant) => Boolean(participant?.completed)).length
  const pending = Math.max(0, total - completed)

  if (elements.totalParticipants) {
    elements.totalParticipants.textContent = `${total.toLocaleString('ko-KR')}명`
  }
  if (elements.completedCount) {
    elements.completedCount.textContent = `${completed.toLocaleString('ko-KR')}명`
  }
  if (elements.pendingCount) {
    elements.pendingCount.textContent = `${pending.toLocaleString('ko-KR')}명`
  }
}

function renderCompletions() {
  if (!(elements.completionsTableBody instanceof HTMLElement)) return

  const hasData = state.completions.length > 0
  elements.completionsTableBody.innerHTML = ''

  if (elements.completionsEmpty instanceof HTMLElement) {
    elements.completionsEmpty.hidden = hasData
  }

  if (!hasData) {
    return
  }

  const fragment = document.createDocumentFragment()
  state.completions
    .slice()
    .sort((a, b) => {
      const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0
      const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0
      return timeB - timeA
    })
    .forEach((entry) => {
      const row = document.createElement('tr')
      const nameCell = document.createElement('td')
      nameCell.textContent = entry.name || '-'
      const emailCell = document.createElement('td')
      emailCell.textContent = entry.email
      const dateCell = document.createElement('td')
      dateCell.textContent = formatDateTime(entry.completedAt)
      const countCell = document.createElement('td')
      const submissions = Number.isFinite(Number(entry.totalSubmissions)) ? Number(entry.totalSubmissions) : 0
      countCell.textContent = `${submissions}회`
      row.append(nameCell, emailCell, dateCell, countCell)
      fragment.append(row)
    })

  elements.completionsTableBody.append(fragment)
}

async function fetchParticipants() {
  try {
    const response = await fetch('/api/admin/challenge/participants', {
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store',
    })

    if (response.status === 401) {
      window.location.href = '/'
      return []
    }

    if (!response.ok) {
      throw new Error(`participants_fetch_failed_${response.status}`)
    }

    const payload = await response.json().catch(() => ({}))
    state.participants = Array.isArray(payload.participants) ? payload.participants : []
    updateStats()
    return state.participants
  } catch (error) {
    console.error('participants_fetch_failed', error)
    updateStats()
    return []
  }
}

async function fetchCompletions() {
  setStatus(elements.completionsStatus, '미션 완료 현황을 불러오는 중입니다…', 'info')
  try {
    const response = await fetch('/api/admin/challenge/completions', {
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store',
    })

    if (response.status === 401) {
      setStatus(elements.completionsStatus, '세션이 만료되었습니다. 다시 로그인해주세요.', 'danger')
      window.setTimeout(() => {
        window.location.href = '/'
      }, 1200)
      return []
    }

    if (!response.ok) {
      throw new Error(`completions_fetch_failed_${response.status}`)
    }

    const payload = await response.json().catch(() => ({}))
    state.completions = Array.isArray(payload.completed) ? payload.completed : []
    renderCompletions()
    setStatus(elements.completionsStatus, `총 ${state.completions.length.toLocaleString('ko-KR')}명이 미션을 완료했습니다.`, 'success')
    updateStats()
    return state.completions
  } catch (error) {
    console.error('completions_fetch_failed', error)
    setStatus(elements.completionsStatus, '미션 완료 현황을 불러오지 못했습니다.', 'danger')
    renderCompletions()
    return []
  }
}

async function handleRunCompletionCheck() {
  setStatus(elements.completionsStatus, '완료 상태를 갱신하는 중입니다…', 'info')
  try {
    const response = await fetch('/api/admin/challenge/run-completion-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (response.status === 401) {
      setStatus(elements.completionsStatus, '세션이 만료되었습니다. 다시 로그인해주세요.', 'danger')
      window.setTimeout(() => {
        window.location.href = '/'
      }, 1200)
      return
    }

    if (!response.ok) {
      throw new Error(`completion_check_failed_${response.status}`)
    }

    const payload = await response.json().catch(() => ({}))
    const newlyCompleted = Number.isFinite(Number(payload?.newlyCompleted)) ? Number(payload.newlyCompleted) : 0
    if (newlyCompleted > 0) {
      setStatus(elements.completionsStatus, `새롭게 완료된 참가자 ${newlyCompleted}명을 반영했습니다.`, 'success')
    } else {
      setStatus(elements.completionsStatus, '최신 완료 현황이 유지되고 있습니다.', 'muted')
    }
    await fetchCompletions()
  } catch (error) {
    console.error('completion_check_failed', error)
    setStatus(elements.completionsStatus, '완료 상태 갱신 중 오류가 발생했습니다.', 'danger')
  }
}

function handleDownloadCompletions() {
  window.open('/api/admin/challenge/completions?format=csv', '_blank', 'noopener')
}

function handleDownloadTemplate() {
  const csv = ['email,name,endDate', 'example@email.com,홍길동,2025-12-31'].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'michina-participants-template.csv'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function init() {
  if (elements.logoutButton instanceof HTMLButtonElement) {
    elements.logoutButton.addEventListener('click', handleLogout)
  }

  if (elements.uploadForm instanceof HTMLFormElement) {
    elements.uploadForm.addEventListener('submit', handleUpload)
  }

  if (elements.refreshStats instanceof HTMLButtonElement) {
    elements.refreshStats.addEventListener('click', () => {
      fetchParticipants()
      fetchCompletions()
    })
  }

  if (elements.runCompletionCheck instanceof HTMLButtonElement) {
    elements.runCompletionCheck.addEventListener('click', handleRunCompletionCheck)
  }

  if (elements.refreshCompletions instanceof HTMLButtonElement) {
    elements.refreshCompletions.addEventListener('click', fetchCompletions)
  }

  if (elements.downloadCompletions instanceof HTMLButtonElement) {
    elements.downloadCompletions.addEventListener('click', handleDownloadCompletions)
  }

  if (elements.downloadTemplate instanceof HTMLButtonElement) {
    elements.downloadTemplate.addEventListener('click', handleDownloadTemplate)
  }

  fetchParticipants()
  fetchCompletions()
}

init()
