const configElement = document.querySelector('[data-role="dashboard-config"]')
let adminConfig = {}
if (configElement instanceof HTMLElement) {
  try {
    adminConfig = JSON.parse(configElement.textContent || '{}')
  } catch (error) {
    console.warn('관리자 대시보드 구성을 불러오지 못했습니다.', error)
  }
}

const adminEmailLabel = document.querySelector('[data-role="admin-email"]')
if (adminEmailLabel instanceof HTMLElement && typeof adminConfig.adminEmail === 'string') {
  adminEmailLabel.textContent = adminConfig.adminEmail
}

const state = {
  period: null,
  users: [],
  logs: [],
}

const elements = {
  periodForm: document.querySelector('[data-role="period-form"]'),
  periodStart: document.querySelector('[data-role="period-start"]'),
  periodEnd: document.querySelector('[data-role="period-end"]'),
  periodStatus: document.querySelector('[data-role="period-status"]'),
  periodSubmit: document.querySelector('[data-role="period-submit"]'),
  userSearch: document.querySelector('[data-role="user-search"]'),
  userTbody: document.querySelector('[data-role="user-tbody"]'),
  userEmpty: document.querySelector('[data-role="user-empty"]'),
  logTbody: document.querySelector('[data-role="log-tbody"]'),
  logEmpty: document.querySelector('[data-role="log-empty"]'),
  toast: document.querySelector('[data-role="toast"]'),
}

let toastTimer = 0

function showSection(section) {
  const navButtons = Array.from(document.querySelectorAll('[data-section]'))
  const panels = Array.from(document.querySelectorAll('[data-panel]'))
  navButtons.forEach((button) => {
    if (!(button instanceof HTMLElement)) return
    const target = button.dataset.section || ''
    button.classList.toggle('is-active', target === section)
  })
  panels.forEach((panel) => {
    if (!(panel instanceof HTMLElement)) return
    const target = panel.dataset.panel || ''
    panel.classList.toggle('is-active', target === section)
  })
}

function showToast(message, tone = 'info') {
  if (!(elements.toast instanceof HTMLElement)) {
    return
  }
  elements.toast.textContent = message
  elements.toast.dataset.tone = tone
  elements.toast.hidden = false
  elements.toast.classList.add('is-visible')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    elements.toast?.classList.remove('is-visible')
    if (elements.toast) {
      elements.toast.hidden = true
    }
  }, 3200)
}

function handleUnauthorized() {
  showToast('접근 권한이 없습니다. 로그인 페이지로 이동합니다.', 'danger')
  window.setTimeout(() => {
    window.location.href = '/admin-login/'
  }, 600)
}

function updatePeriodStatus(message, tone) {
  if (!(elements.periodStatus instanceof HTMLElement)) {
    return
  }
  elements.periodStatus.textContent = message || ''
  if (tone) {
    elements.periodStatus.dataset.tone = tone
  } else {
    elements.periodStatus.removeAttribute('data-tone')
  }
}

function setPeriodLoading(isLoading) {
  if (elements.periodForm instanceof HTMLElement) {
    elements.periodForm.dataset.state = isLoading ? 'loading' : 'idle'
  }
  if (elements.periodSubmit instanceof HTMLButtonElement) {
    elements.periodSubmit.disabled = isLoading
  }
}

function formatDateDisplay(value) {
  if (!value || typeof value !== 'string') {
    return '미설정'
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.slice(0, 10)
  }
  const parsed = Date.parse(value)
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10)
  }
  return value
}

function formatRemainingDays(value) {
  if (!value || typeof value !== 'string') {
    return '미설정'
  }
  const normalized = value.includes('T') ? value : `${value}T23:59:59`
  const endDate = new Date(normalized)
  if (Number.isNaN(endDate.getTime())) {
    return '미설정'
  }
  const now = new Date()
  const diffMs = endDate.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays > 0) {
    return `D-${diffDays}`
  }
  if (diffDays === 0) {
    return 'D-DAY'
  }
  return '만료'
}

function formatDateTime(value) {
  if (!value || typeof value !== 'string') {
    return '—'
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function renderPeriod(period) {
  const startInput = elements.periodStart instanceof HTMLInputElement ? elements.periodStart : null
  const endInput = elements.periodEnd instanceof HTMLInputElement ? elements.periodEnd : null
  if (!startInput || !endInput) {
    return
  }
  if (period && typeof period === 'object') {
    startInput.value = typeof period.startDate === 'string' ? period.startDate : ''
    endInput.value = typeof period.endDate === 'string' ? period.endDate : ''
  } else {
    startInput.value = ''
    endInput.value = ''
  }
}

function renderUsers() {
  if (!(elements.userTbody instanceof HTMLElement)) {
    return
  }
  const keyword = elements.userSearch instanceof HTMLInputElement ? elements.userSearch.value.trim().toLowerCase() : ''
  const filtered = keyword
    ? state.users.filter((user) => user.email.toLowerCase().includes(keyword))
    : state.users

  elements.userTbody.innerHTML = ''

  if (elements.userEmpty instanceof HTMLElement) {
    if (filtered.length === 0) {
      elements.userEmpty.hidden = false
      elements.userEmpty.textContent = keyword ? '검색 결과가 없습니다.' : '표시할 사용자가 없습니다.'
    } else {
      elements.userEmpty.hidden = true
    }
  }

  for (const entry of filtered) {
    const tr = document.createElement('tr')
    const nameCell = document.createElement('td')
    nameCell.textContent = entry.name || '이름 미등록'

    const emailCell = document.createElement('td')
    emailCell.textContent = entry.email

    const startCell = document.createElement('td')
    startCell.textContent = formatDateDisplay(entry.startDate || entry.startDateTime)

    const endCell = document.createElement('td')
    endCell.textContent = formatDateDisplay(entry.endDate || entry.endDateTime)

    const remainingCell = document.createElement('td')
    remainingCell.textContent = formatRemainingDays(entry.endDateTime || entry.endDate)

    tr.appendChild(nameCell)
    tr.appendChild(emailCell)
    tr.appendChild(startCell)
    tr.appendChild(endCell)
    tr.appendChild(remainingCell)

    elements.userTbody.appendChild(tr)
  }
}

function renderLogs() {
  if (!(elements.logTbody instanceof HTMLElement)) {
    return
  }
  elements.logTbody.innerHTML = ''

  if (elements.logEmpty instanceof HTMLElement) {
    if (state.logs.length === 0) {
      elements.logEmpty.hidden = false
      elements.logEmpty.textContent = '최근 실행 로그가 없습니다.'
    } else {
      elements.logEmpty.hidden = true
    }
  }

  for (const log of state.logs) {
    const tr = document.createElement('tr')

    const executedCell = document.createElement('td')
    executedCell.textContent = formatDateTime(log.executedAt)

    const countCell = document.createElement('td')
    countCell.textContent = Number.isFinite(Number(log.updatedCount)) ? String(log.updatedCount) : '0'

    const statusCell = document.createElement('td')
    const statusChip = document.createElement('span')
    statusChip.className = `status-chip status-chip--${log.status === 'failure' ? 'failure' : 'success'}`
    statusChip.textContent = log.status === 'failure' ? '실패' : '성공'
    statusCell.appendChild(statusChip)

    const messageCell = document.createElement('td')
    messageCell.textContent = log.message || '—'

    tr.appendChild(executedCell)
    tr.appendChild(countCell)
    tr.appendChild(statusCell)
    tr.appendChild(messageCell)

    elements.logTbody.appendChild(tr)
  }
}

async function loadPeriod() {
  try {
    const response = await fetch('/api/admin/dashboard/periods', { credentials: 'include' })
    if (response.status === 401) {
      handleUnauthorized()
      return
    }
    const payload = await response.json().catch(() => ({}))
    state.period = payload?.period ?? null
    renderPeriod(state.period)
  } catch (error) {
    console.error('챌린지 기간을 불러오지 못했습니다.', error)
    updatePeriodStatus('기간 정보를 불러오지 못했습니다.', 'error')
  }
}

async function loadUsers(options = {}) {
  if (elements.userEmpty instanceof HTMLElement) {
    elements.userEmpty.hidden = false
    elements.userEmpty.textContent = '사용자 정보를 불러오는 중입니다…'
  }
  try {
    const response = await fetch('/api/admin/dashboard/users', { credentials: 'include' })
    if (response.status === 401) {
      handleUnauthorized()
      return
    }
    const payload = await response.json().catch(() => ({}))
    state.users = Array.isArray(payload?.users) ? payload.users : []
    renderUsers()
    if (options.showToast) {
      showToast('사용자 현황을 갱신했습니다.', 'info')
    }
  } catch (error) {
    console.error('사용자 현황을 불러오지 못했습니다.', error)
    if (elements.userEmpty instanceof HTMLElement) {
      elements.userEmpty.hidden = false
      elements.userEmpty.textContent = '사용자 정보를 불러오지 못했습니다.'
    }
  }
}

async function loadLogs(options = {}) {
  if (elements.logEmpty instanceof HTMLElement) {
    elements.logEmpty.hidden = false
    elements.logEmpty.textContent = '로그를 불러오는 중입니다…'
  }
  try {
    const response = await fetch('/api/admin/dashboard/demotion-logs', { credentials: 'include' })
    if (response.status === 401) {
      handleUnauthorized()
      return
    }
    const payload = await response.json().catch(() => ({}))
    state.logs = Array.isArray(payload?.logs) ? payload.logs : []
    renderLogs()
    if (options.showToast) {
      showToast('자동 하향 로그를 갱신했습니다.', 'info')
    }
  } catch (error) {
    console.error('자동 하향 로그를 불러오지 못했습니다.', error)
    if (elements.logEmpty instanceof HTMLElement) {
      elements.logEmpty.hidden = false
      elements.logEmpty.textContent = '로그를 불러오지 못했습니다.'
    }
  }
}

if (elements.periodForm instanceof HTMLFormElement) {
  elements.periodForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const startInput = elements.periodStart instanceof HTMLInputElement ? elements.periodStart.value : ''
    const endInput = elements.periodEnd instanceof HTMLInputElement ? elements.periodEnd.value : ''

    if (!startInput || !endInput) {
      updatePeriodStatus('시작일과 종료일을 모두 선택해주세요.', 'error')
      return
    }
    if (endInput < startInput) {
      updatePeriodStatus('종료일은 시작일 이후여야 합니다.', 'error')
      return
    }

    setPeriodLoading(true)
    updatePeriodStatus('저장 중입니다…', 'info')

    try {
      const response = await fetch('/api/admin/dashboard/periods', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ startDate: startInput, endDate: endInput }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 401) {
        handleUnauthorized()
        return
      }
      if (!response.ok || payload?.success !== true) {
        updatePeriodStatus('기간을 저장하지 못했습니다. 다시 시도해주세요.', 'error')
        return
      }
      state.period = payload.period ?? null
      renderPeriod(state.period)
      updatePeriodStatus('✅ 챌린지 기간이 저장되었습니다', 'success')
      showToast('✅ 챌린지 기간이 저장되었습니다', 'success')
    } catch (error) {
      console.error('챌린지 기간 저장에 실패했습니다.', error)
      updatePeriodStatus('기간을 저장하지 못했습니다. 다시 시도해주세요.', 'error')
    } finally {
      setPeriodLoading(false)
    }
  })
}

if (elements.userSearch instanceof HTMLInputElement) {
  elements.userSearch.addEventListener('input', () => {
    renderUsers()
  })
}

const refreshUsersButton = document.querySelector('[data-action="refresh-users"]')
if (refreshUsersButton instanceof HTMLElement) {
  refreshUsersButton.addEventListener('click', () => {
    loadUsers({ showToast: true })
  })
}

const refreshLogsButton = document.querySelector('[data-action="refresh-logs"]')
if (refreshLogsButton instanceof HTMLElement) {
  refreshLogsButton.addEventListener('click', () => {
    loadLogs({ showToast: true })
  })
}

const navButtons = Array.from(document.querySelectorAll('[data-section]'))
navButtons.forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault()
    const target = button.dataset.section || 'period'
    showSection(target)
  })
})

showSection('period')
renderUsers()
renderLogs()

loadPeriod()
loadUsers()
loadLogs()

window.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    loadUsers()
    loadLogs()
  }
})
