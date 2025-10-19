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
  periodHistory: [],
  users: [],
  logs: [],
  michinaMembers: [],
}

const elements = {
  periodForm: document.querySelector('[data-role="period-form"]'),
  periodStart: document.querySelector('[data-role="period-start"]'),
  periodEnd: document.querySelector('[data-role="period-end"]'),
  periodStatus: document.querySelector('[data-role="period-status"]'),
  periodSubmit: document.querySelector('[data-role="period-submit"]'),
  periodHistoryCard: document.querySelector('[data-role="period-history-card"]'),
  periodHistoryTbody: document.querySelector('[data-role="period-history-tbody"]'),
  periodHistoryEmpty: document.querySelector('[data-role="period-history-empty"]'),
  userSearch: document.querySelector('[data-role="user-search"]'),
  userTbody: document.querySelector('[data-role="user-tbody"]'),
  userEmpty: document.querySelector('[data-role="user-empty"]'),
  logTbody: document.querySelector('[data-role="log-tbody"]'),
  logEmpty: document.querySelector('[data-role="log-empty"]'),
  toast: document.querySelector('[data-role="toast"]'),
  michinaUploadForm: document.querySelector('[data-role="michina-upload-form"]'),
  michinaUploadFile: document.querySelector('[data-role="michina-upload-file"]'),
  michinaUploadStatus: document.querySelector('[data-role="michina-upload-status"]'),
  michinaUploadButton: document.querySelector('[data-role="michina-upload-button"]'),
  michinaMembersTbody: document.querySelector('[data-role="michina-members-tbody"]'),
  michinaMembersEmpty: document.querySelector('[data-role="michina-members-empty"]'),
  michinaResetButton: document.querySelector('[data-role="michina-reset-button"]'),
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

function setPeriodHistoryLoading(isLoading) {
  if (elements.periodHistoryCard instanceof HTMLElement) {
    elements.periodHistoryCard.dataset.state = isLoading ? 'loading' : 'idle'
  }
  const refreshButton = document.querySelector('[data-action="refresh-period-history"]')
  if (refreshButton instanceof HTMLButtonElement) {
    refreshButton.disabled = isLoading
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

function splitCsvLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result.map((value) => value.trim())
}

function parseMichinaCsv(content) {
  if (typeof content !== 'string') {
    return []
  }
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (!lines.length) {
    return []
  }
  const headerLine = lines.shift()
  if (!headerLine) {
    return []
  }
  const headers = splitCsvLine(headerLine.toLowerCase())
  const indexFor = (...keys) => {
    for (const key of keys) {
      const idx = headers.indexOf(key)
      if (idx !== -1) {
        return idx
      }
    }
    return -1
  }

  const nameIndex = indexFor('name', '이름')
  const emailIndex = indexFor('email', '이메일')
  const batchIndex = indexFor('batch', '기수')
  const startIndex = indexFor('start_date', 'start date', '시작일', 'start')
  const endIndex = indexFor('end_date', 'end date', '종료일', 'end')

  const records = []
  for (const line of lines) {
    const cells = splitCsvLine(line)
    const readCell = (index) => {
      if (index < 0 || index >= cells.length) {
        return ''
      }
      return cells[index]?.replace(/^"|"$/g, '').trim() || ''
    }

    const name = readCell(nameIndex)
    const email = readCell(emailIndex)
    if (!name && !email) {
      continue
    }
    const record = {
      name,
      email,
      batch: readCell(batchIndex),
      startDate: readCell(startIndex),
      endDate: readCell(endIndex),
    }
    records.push(record)
  }
  return records
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

function renderPeriodHistory() {
  if (!(elements.periodHistoryTbody instanceof HTMLElement)) {
    return
  }

  elements.periodHistoryTbody.innerHTML = ''

  if (elements.periodHistoryEmpty instanceof HTMLElement) {
    if (!state.periodHistory.length) {
      elements.periodHistoryEmpty.hidden = false
      elements.periodHistoryEmpty.textContent = '저장 내역이 없습니다.'
    } else {
      elements.periodHistoryEmpty.hidden = true
    }
  }

  for (const entry of state.periodHistory) {
    const tr = document.createElement('tr')

    const savedAtCell = document.createElement('td')
    savedAtCell.textContent = formatDateTime(entry.updatedAt)

    const startCell = document.createElement('td')
    startCell.textContent = formatDateDisplay(entry.startDate)

    const endCell = document.createElement('td')
    endCell.textContent = formatDateDisplay(entry.endDate)

    const actorCell = document.createElement('td')
    actorCell.textContent = entry.updatedBy || entry.savedBy || '—'

    const actionsCell = document.createElement('td')
    actionsCell.className = 'table-action-cell'

    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'table-action table-action--danger'
    deleteButton.dataset.action = 'delete-period-history'
    deleteButton.dataset.updatedAt = entry.updatedAt || ''
    deleteButton.innerHTML = '<i class="ri-delete-bin-6-line" aria-hidden="true"></i><span>삭제</span>'

    actionsCell.appendChild(deleteButton)

    tr.appendChild(savedAtCell)
    tr.appendChild(startCell)
    tr.appendChild(endCell)
    tr.appendChild(actorCell)
    tr.appendChild(actionsCell)

    elements.periodHistoryTbody.appendChild(tr)
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

function renderMichinaMembers() {
  if (!(elements.michinaMembersTbody instanceof HTMLElement)) {
    return
  }

  elements.michinaMembersTbody.innerHTML = ''

  if (elements.michinaMembersEmpty instanceof HTMLElement) {
    if (state.michinaMembers.length === 0) {
      elements.michinaMembersEmpty.hidden = false
      elements.michinaMembersEmpty.textContent = '등록된 명단이 없습니다.'
    } else {
      elements.michinaMembersEmpty.hidden = true
    }
  }

  for (const member of state.michinaMembers) {
    const tr = document.createElement('tr')

    const nameCell = document.createElement('td')
    nameCell.textContent = member.name || '—'

    const emailCell = document.createElement('td')
    emailCell.textContent = member.email

    const batchCell = document.createElement('td')
    batchCell.textContent = Number.isFinite(Number(member.batch)) ? String(member.batch) : '—'

    const startCell = document.createElement('td')
    startCell.textContent = member.startDate ? formatDateDisplay(member.startDate) : '—'

    const endCell = document.createElement('td')
    endCell.textContent = member.endDate ? formatDateDisplay(member.endDate) : '—'

    tr.appendChild(nameCell)
    tr.appendChild(emailCell)
    tr.appendChild(batchCell)
    tr.appendChild(startCell)
    tr.appendChild(endCell)

    elements.michinaMembersTbody.appendChild(tr)
  }
}

function setMichinaUploadLoading(isLoading) {
  if (elements.michinaUploadForm instanceof HTMLElement) {
    elements.michinaUploadForm.dataset.state = isLoading ? 'loading' : 'idle'
  }
  if (elements.michinaUploadFile instanceof HTMLInputElement) {
    elements.michinaUploadFile.disabled = isLoading
  }
  if (elements.michinaUploadButton instanceof HTMLButtonElement) {
    elements.michinaUploadButton.disabled = isLoading
    if (isLoading) {
      elements.michinaUploadButton.dataset.loading = 'true'
    } else {
      delete elements.michinaUploadButton.dataset.loading
    }
  }
  if (elements.michinaResetButton instanceof HTMLButtonElement) {
    elements.michinaResetButton.disabled = isLoading
  }
}

function updateMichinaUploadStatus(message, tone = 'success') {
  if (!(elements.michinaUploadStatus instanceof HTMLElement)) {
    return
  }
  if (!message) {
    elements.michinaUploadStatus.hidden = true
    return
  }
  elements.michinaUploadStatus.hidden = false
  elements.michinaUploadStatus.textContent = message
  if (tone === 'error') {
    elements.michinaUploadStatus.style.color = '#c0392b'
  } else {
    elements.michinaUploadStatus.style.color = '#2c7a36'
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
    if (Array.isArray(payload?.history)) {
      state.periodHistory = payload.history
      renderPeriodHistory()
    } else if (!state.periodHistory.length) {
      loadPeriodHistory()
    }
  } catch (error) {
    console.error('챌린지 기간을 불러오지 못했습니다.', error)
    updatePeriodStatus('기간 정보를 불러오지 못했습니다.', 'error')
    if (!state.periodHistory.length) {
      loadPeriodHistory()
    }
  }
}

async function loadPeriodHistory(options = {}) {
  if (elements.periodHistoryEmpty instanceof HTMLElement) {
    elements.periodHistoryEmpty.hidden = false
    elements.periodHistoryEmpty.textContent = '저장 내역을 불러오는 중입니다…'
  }
  setPeriodHistoryLoading(true)
  try {
    const response = await fetch('/api/admin/dashboard/period-history', { credentials: 'include' })
    if (response.status === 401) {
      handleUnauthorized()
      return
    }
    const payload = await response.json().catch(() => ({}))
    state.periodHistory = Array.isArray(payload?.history) ? payload.history : []
    renderPeriodHistory()
    if (options.showToast) {
      showToast('저장 내역을 갱신했습니다.', 'info')
    }
  } catch (error) {
    console.error('저장 내역을 불러오지 못했습니다.', error)
    if (elements.periodHistoryEmpty instanceof HTMLElement) {
      elements.periodHistoryEmpty.hidden = false
      elements.periodHistoryEmpty.textContent = '저장 내역을 불러오지 못했습니다.'
    }
  } finally {
    setPeriodHistoryLoading(false)
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

async function loadMichinaMembers(options = {}) {
  if (elements.michinaMembersEmpty instanceof HTMLElement) {
    elements.michinaMembersEmpty.hidden = false
    elements.michinaMembersEmpty.textContent = '명단을 불러오는 중입니다…'
  }

  try {
    const response = await fetch('/api/admin/dashboard/michina-members', { credentials: 'include' })
    if (response.status === 401) {
      handleUnauthorized()
      return
    }
    const payload = await response.json().catch(() => ({}))
    state.michinaMembers = Array.isArray(payload?.members) ? payload.members : []
    renderMichinaMembers()
    if (options.showToast) {
      showToast('미치나 명단을 갱신했습니다.', 'info')
    }
  } catch (error) {
    console.error('미치나 명단을 불러오지 못했습니다.', error)
    if (elements.michinaMembersEmpty instanceof HTMLElement) {
      elements.michinaMembersEmpty.hidden = false
      elements.michinaMembersEmpty.textContent = '명단을 불러오지 못했습니다.'
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

async function deletePeriodHistoryEntry(updatedAt) {
  if (!updatedAt) {
    return
  }
  const confirmed = window.confirm('선택한 저장 내역을 삭제할까요?')
  if (!confirmed) {
    return
  }
  setPeriodHistoryLoading(true)
  try {
    const response = await fetch('/api/admin/dashboard/period-history', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ updatedAt }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 401) {
      handleUnauthorized()
      return
    }
    if (!response.ok || payload?.success !== true) {
      const message = typeof payload?.error === 'string' && payload.error === 'NOT_FOUND'
        ? '이미 삭제된 내역입니다.'
        : '저장 내역을 삭제하지 못했습니다. 다시 시도해주세요.'
      showToast(message, 'danger')
      return
    }
    state.periodHistory = Array.isArray(payload?.history) ? payload.history : []
    renderPeriodHistory()
    showToast('선택한 저장 내역을 삭제했습니다.', 'success')
  } catch (error) {
    console.error('저장 내역 삭제에 실패했습니다.', error)
    showToast('저장 내역을 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.', 'danger')
  } finally {
    setPeriodHistoryLoading(false)
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
      if (Array.isArray(payload?.history)) {
        state.periodHistory = payload.history
        renderPeriodHistory()
      } else {
        loadPeriodHistory()
      }
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

const refreshPeriodHistoryButton = document.querySelector('[data-action="refresh-period-history"]')
if (refreshPeriodHistoryButton instanceof HTMLElement) {
  refreshPeriodHistoryButton.addEventListener('click', () => {
    loadPeriodHistory({ showToast: true })
  })
}

const refreshLogsButton = document.querySelector('[data-action="refresh-logs"]')
if (refreshLogsButton instanceof HTMLElement) {
  refreshLogsButton.addEventListener('click', () => {
    loadLogs({ showToast: true })
  })
}

if (elements.michinaUploadForm instanceof HTMLFormElement) {
  elements.michinaUploadForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!(elements.michinaUploadFile instanceof HTMLInputElement)) {
      return
    }
    const file = elements.michinaUploadFile.files && elements.michinaUploadFile.files[0]
    if (!file) {
      updateMichinaUploadStatus('업로드할 CSV 파일을 선택해주세요.', 'error')
      return
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      updateMichinaUploadStatus('CSV 파일만 업로드할 수 있습니다.', 'error')
      return
    }

    updateMichinaUploadStatus('')
    setMichinaUploadLoading(true)

    let text = ''
    try {
      text = await file.text()
    } catch (error) {
      console.error('CSV 파일을 읽지 못했습니다.', error)
      updateMichinaUploadStatus('CSV 파일을 읽는 중 문제가 발생했습니다.', 'error')
      setMichinaUploadLoading(false)
      return
    }

    const parsed = parseMichinaCsv(text)
    const records = parsed
      .map((entry) => ({
        name: typeof entry.name === 'string' ? entry.name.trim() : '',
        email: typeof entry.email === 'string' ? entry.email.trim().toLowerCase() : '',
        batch: entry.batch,
        startDate: typeof entry.startDate === 'string' ? entry.startDate.trim() : '',
        endDate: typeof entry.endDate === 'string' ? entry.endDate.trim() : '',
      }))
      .filter((entry) => entry.name && entry.email)

    if (!records.length) {
      updateMichinaUploadStatus('유효한 데이터를 찾지 못했습니다. CSV 내용을 확인해주세요.', 'error')
      setMichinaUploadLoading(false)
      return
    }

    try {
      const response = await fetch('/api/admin/dashboard/michina-members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ members: records }),
      })
      if (response.status === 401) {
        handleUnauthorized()
        return
      }
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success !== true) {
        const message =
          typeof payload?.error === 'string' && payload.error === 'INVALID_MEMBER'
            ? 'CSV 데이터 형식을 다시 확인해주세요.'
            : '명단 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.'
        updateMichinaUploadStatus(message, 'error')
        showToast(message, 'danger')
        return
      }
      state.michinaMembers = Array.isArray(payload?.members) ? payload.members : []
      renderMichinaMembers()
      updateMichinaUploadStatus('✅ 명단 업로드가 완료되었습니다.', 'success')
      showToast('✅ 미치나 명단을 업데이트했습니다.', 'success')
      if (elements.michinaUploadForm instanceof HTMLFormElement) {
        elements.michinaUploadForm.reset()
      }
      if (elements.michinaUploadFile instanceof HTMLInputElement) {
        elements.michinaUploadFile.value = ''
      }
    } catch (error) {
      console.error('미치나 명단 업로드 실패', error)
      updateMichinaUploadStatus('명단 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error')
      showToast('명단 업로드에 실패했습니다.', 'danger')
    } finally {
      setMichinaUploadLoading(false)
    }
  })
}

if (elements.michinaResetButton instanceof HTMLButtonElement) {
  elements.michinaResetButton.addEventListener('click', async () => {
    const confirmed = window.confirm('등록된 미치나 명단을 모두 삭제할까요?')
    if (!confirmed) {
      return
    }
    updateMichinaUploadStatus('')
    setMichinaUploadLoading(true)
    try {
      const response = await fetch('/api/admin/dashboard/michina-members', {
        method: 'DELETE',
        credentials: 'include',
      })
      if (response.status === 401) {
        handleUnauthorized()
        return
      }
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success !== true) {
        updateMichinaUploadStatus('명단 초기화에 실패했습니다.', 'error')
        showToast('명단 초기화에 실패했습니다.', 'danger')
        return
      }
      state.michinaMembers = []
      renderMichinaMembers()
      updateMichinaUploadStatus('✅ 명단을 초기화했습니다.', 'success')
      showToast('미치나 명단을 초기화했습니다.', 'success')
    } catch (error) {
      console.error('미치나 명단 초기화 실패', error)
      updateMichinaUploadStatus('명단 초기화에 실패했습니다.', 'error')
      showToast('명단 초기화에 실패했습니다.', 'danger')
    } finally {
      setMichinaUploadLoading(false)
    }
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

if (elements.periodHistoryTbody instanceof HTMLElement) {
  elements.periodHistoryTbody.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }
    const button = target.closest('[data-action="delete-period-history"]')
    if (!(button instanceof HTMLButtonElement)) {
      return
    }
    const updatedAt = button.dataset.updatedAt || ''
    if (updatedAt) {
      deletePeriodHistoryEntry(updatedAt)
    }
  })
}

showSection('period')
renderUsers()
renderLogs()
renderPeriodHistory()
renderMichinaMembers()

loadPeriod()
loadUsers()
loadLogs()
loadMichinaMembers()

window.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    loadUsers()
    loadLogs()
    loadPeriodHistory()
    loadMichinaMembers()
  }
})
