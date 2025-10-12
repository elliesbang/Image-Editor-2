const state = {
  periods: [],
  currentPeriod: null,
  deadlines: [],
  participantsPreview: [],
  participantsTotal: 0,
  pendingUpload: null,
  isUploading: false,
}

const elements = {
  toast: document.querySelector('[data-role="toast"]'),
  logout: document.querySelector('[data-action="logout"]'),
  periodBadge: document.querySelector('[data-role="period-badge"]'),
  periodForm: document.querySelector('[data-role="period-form"]'),
  periodStart: document.querySelector('[data-role="period-start"]'),
  periodEnd: document.querySelector('[data-role="period-end"]'),
  periodSubmit: document.querySelector('[data-role="period-submit"]'),
  periodMessage: document.querySelector('[data-role="period-message"]'),
  periodCurrentLabel: document.querySelector('[data-role="period-current-label"]'),
  periodCurrentRange: document.querySelector('[data-role="period-current-range"]'),
  periodList: document.querySelector('[data-role="period-list"]'),
  periodCount: document.querySelector('[data-role="period-count"]'),
  participantsFile: document.querySelector('[data-role="participants-file"]'),
  participantsFilename: document.querySelector('[data-role="participants-filename"]'),
  participantsUpload: document.querySelector('[data-role="participants-upload"]'),
  participantsReset: document.querySelector('[data-role="participants-reset"]'),
  participantsRefresh: document.querySelector('[data-role="participants-refresh"]'),
  participantsStatus: document.querySelector('[data-role="participants-status"]'),
  participantsTotal: document.querySelector('[data-role="participants-total"]'),
  participantsTable: document.querySelector('[data-role="participants-table"]'),
  participantsViewAll: document.querySelector('[data-role="participants-view-all"]'),
  deadlineList: document.querySelector('[data-role="deadline-list"]'),
  deadlineCount: document.querySelector('[data-role="deadline-count"]'),
  usersTable: document.querySelector('[data-role="users-table"]'),
  usersCount: document.querySelector('[data-role="users-count"]'),
  modalBackdrop: document.querySelector('[data-role="modal-backdrop"]'),
  modalTitle: document.querySelector('[data-role="modal-title"]'),
  modalMessage: document.querySelector('[data-role="modal-message"]'),
  modalConfirm: document.querySelector('[data-role="modal-confirm"]'),
  modalCancel: document.querySelector('[data-role="modal-cancel"]'),
  previewBackdrop: document.querySelector('[data-role="preview-backdrop"]'),
  previewClose: document.querySelector('[data-role="preview-close"]'),
  previewTable: document.querySelector('[data-role="preview-table"]'),
}

const TONE_CLASS_MAP = {
  success: 'bg-[#15803d] text-white',
  warning: 'bg-[#ca8a04] text-white',
  danger: 'bg-[#b91c1c] text-white',
  info: 'bg-[#1f2937] text-white',
}

let modalResolve = null

function formatDateTime(isoString) {
  if (!isoString) {
    return '-'
  }
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return isoString
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

function formatDateRange(start, end) {
  if (!start || !end) {
    return '기간 정보가 없습니다.'
  }
  return `${formatDateTime(start)} ~ ${formatDateTime(end)}`
}

function clearToastClasses(element) {
  element.classList.remove(...Object.values(TONE_CLASS_MAP))
}

function showToast(message, tone = 'info', duration = 3200) {
  if (!(elements.toast instanceof HTMLElement)) {
    return
  }
  clearToastClasses(elements.toast)
  const toneClass = TONE_CLASS_MAP[tone] || TONE_CLASS_MAP.info
  elements.toast.classList.remove('hidden')
  toneClass.split(' ').forEach((className) => {
    if (className) {
      elements.toast.classList.add(className)
    }
  })
  elements.toast.textContent = message
  window.setTimeout(() => {
    if (elements.toast) {
      elements.toast.classList.add('hidden')
    }
  }, duration)
}

function setPeriodBadge(label, tone = 'info') {
  if (!(elements.periodBadge instanceof HTMLElement)) {
    return
  }
  elements.periodBadge.textContent = label
  elements.periodBadge.classList.remove('bg-primary/80', 'bg-[#fcd34d]', 'bg-[#fecaca]', 'text-[#3f2f00]', 'text-[#7c2d12]')
  if (tone === 'success') {
    elements.periodBadge.classList.add('bg-primary/80', 'text-[#3f2f00]')
  } else if (tone === 'warning') {
    elements.periodBadge.classList.add('bg-[#fcd34d]', 'text-[#3f2f00]')
  } else if (tone === 'danger') {
    elements.periodBadge.classList.add('bg-[#fecaca]', 'text-[#7c2d12]')
  } else {
    elements.periodBadge.classList.add('bg-primary/80', 'text-[#3f2f00]')
  }
}

function openConfirmModal({ title, message, confirmLabel = '예', cancelLabel = '아니오' }) {
  if (!(elements.modalBackdrop instanceof HTMLElement)) {
    return Promise.resolve(false)
  }
  if (modalResolve) {
    modalResolve(false)
  }
  if (elements.modalTitle) {
    elements.modalTitle.textContent = title
  }
  if (elements.modalMessage) {
    elements.modalMessage.textContent = message
  }
  if (elements.modalConfirm instanceof HTMLElement) {
    elements.modalConfirm.textContent = confirmLabel
  }
  if (elements.modalCancel instanceof HTMLElement) {
    elements.modalCancel.textContent = cancelLabel
  }
  elements.modalBackdrop.classList.remove('hidden')
  return new Promise((resolve) => {
    modalResolve = resolve
  })
}

function closeConfirmModal(result = false) {
  if (!(elements.modalBackdrop instanceof HTMLElement)) {
    return
  }
  elements.modalBackdrop.classList.add('hidden')
  if (modalResolve) {
    modalResolve(result)
    modalResolve = null
  }
}

function openPreviewModal(rows) {
  if (!(elements.previewBackdrop instanceof HTMLElement) || !(elements.previewTable instanceof HTMLElement)) {
    return
  }
  elements.previewTable.innerHTML = ''
  if (!rows || rows.length === 0) {
    elements.previewTable.innerHTML = '<tr><td colspan="4" class="px-4 py-5 text-center text-sm text-[#7a5a00]">불러온 명단이 없습니다.</td></tr>'
  } else {
    elements.previewTable.innerHTML = rows
      .map(
        (participant) =>
          `<tr class="bg-white">
            <td class="px-4 py-3 text-sm text-[#3f2f00]">${participant.name || '-'}</td>
            <td class="px-4 py-3 text-sm text-[#5b4100]">${participant.email}</td>
            <td class="px-4 py-3 text-sm text-[#5b4100]">${participant.round ?? '-'}</td>
            <td class="px-4 py-3 text-sm text-[#7a5a00]">${formatDateTime(participant.createdAt)}</td>
          </tr>`,
      )
      .join('')
  }
  elements.previewBackdrop.classList.remove('hidden')
}

function closePreviewModal() {
  if (elements.previewBackdrop instanceof HTMLElement) {
    elements.previewBackdrop.classList.add('hidden')
  }
}

function deduplicateParticipants(list) {
  const map = new Map()
  for (const entry of list) {
    const email = typeof entry.email === 'string' ? entry.email.trim().toLowerCase() : ''
    if (!email) {
      continue
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const roundRaw = Number.parseInt(entry.round, 10)
    const round = Number.isFinite(roundRaw) && roundRaw > 0 ? roundRaw : 1
    map.set(email, { name: name || '-', email, round })
  }
  return Array.from(map.values())
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) {
    return []
  }
  const headers = lines[0]
    .split(',')
    .map((value) => value.trim().toLowerCase())
  const nameIndex = headers.findIndex((header) => header.includes('name') || header.includes('이름'))
  const emailIndex = headers.findIndex((header) => header.includes('email') || header.includes('메일'))
  const roundIndex = headers.findIndex((header) => header.includes('round') || header.includes('라운드'))
  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    const columns = lines[i].split(',')
    const email = columns[emailIndex]?.trim()
    if (!email) {
      continue
    }
    const name = nameIndex >= 0 ? columns[nameIndex]?.trim() ?? '' : ''
    const roundRaw = roundIndex >= 0 ? columns[roundIndex]?.trim() ?? '' : ''
    rows.push({ name, email, round: roundRaw })
  }
  return deduplicateParticipants(rows)
}

function parseXlsx(workbook) {
  const sheetName = workbook.SheetNames?.[0]
  if (!sheetName) {
    return []
  }
  const sheet = workbook.Sheets[sheetName]
  const json = window.XLSX.utils.sheet_to_json(sheet, { defval: '' })
  const rows = []
  for (const entry of json) {
    const entries = Object.entries(entry).reduce((acc, [key, value]) => {
      acc[key.toLowerCase()] = value
      return acc
    }, {})
    const email = (entries.email || entries['이메일'] || entries['mail'] || '').toString().trim()
    if (!email) {
      continue
    }
    const name = (entries.name || entries['이름'] || '').toString().trim()
    const round = (entries.round || entries['라운드'] || entries['회차'] || '').toString().trim()
    rows.push({ name, email, round })
  }
  return deduplicateParticipants(rows)
}

async function parseParticipantsFile(file) {
  if (!file) {
    return []
  }
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'csv') {
    const text = await file.text()
    return parseCsv(text)
  }
  if (extension === 'xlsx') {
    if (!window.XLSX || typeof window.XLSX.read !== 'function') {
      throw new Error('XLSX_LIBRARY_MISSING')
    }
    const buffer = await file.arrayBuffer()
    const workbook = window.XLSX.read(buffer, { type: 'array' })
    return parseXlsx(workbook)
  }
  throw new Error('UNSUPPORTED_FORMAT')
}

function renderParticipantsTable(data) {
  if (!(elements.participantsTable instanceof HTMLElement)) {
    return
  }
  if (!data || data.length === 0) {
    elements.participantsTable.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-[#7a5a00]">저장된 명단이 없습니다.</td></tr>'
    return
  }
  elements.participantsTable.innerHTML = data
    .map(
      (participant) =>
        `<tr class="bg-white">
          <td class="px-4 py-3 text-sm text-[#3f2f00]">${participant.name || '-'}</td>
          <td class="px-4 py-3 text-sm text-[#5b4100]">${participant.email}</td>
          <td class="px-4 py-3 text-sm text-[#5b4100]">${participant.round ?? '-'}</td>
          <td class="px-4 py-3 text-sm text-[#7a5a00]">${formatDateTime(participant.createdAt)}</td>
        </tr>`,
    )
    .join('')
}

function renderDeadlineList() {
  if (!(elements.deadlineList instanceof HTMLElement)) {
    return
  }
  if (!state.deadlines || state.deadlines.length === 0) {
    elements.deadlineList.innerHTML = '<li class="rounded-xl bg-[#fff7bf] px-3 py-2 text-xs text-[#a17f20]">저장된 데드라인이 없습니다.</li>'
    if (elements.deadlineCount) {
      elements.deadlineCount.textContent = '0일차'
    }
    return
  }
  if (elements.deadlineCount) {
    elements.deadlineCount.textContent = `${state.deadlines.length}일차`
  }
  elements.deadlineList.innerHTML = state.deadlines
    .map((deadline) => {
      return `<li class="flex items-center justify-between rounded-2xl bg-[#fff7bf]/60 px-4 py-3">
        <div>
          <p class="text-sm font-semibold text-[#4f3b0f]">✅ ${deadline.dayIndex}일차</p>
          <p class="text-xs text-[#7a5a00]">${formatDateRange(deadline.startAt, deadline.endAt)}</p>
        </div>
      </li>`
    })
    .join('')
}

function renderPeriodList() {
  if (!(elements.periodList instanceof HTMLElement)) {
    return
  }
  const periods = Array.isArray(state.periods) ? state.periods : []
  if (periods.length === 0) {
    elements.periodList.innerHTML = '<li class="rounded-xl bg-[#fff7bf] px-3 py-2 text-xs text-[#a17f20]">저장된 내역이 없습니다.</li>'
    if (elements.periodCount) {
      elements.periodCount.textContent = '0건'
    }
    return
  }
  if (elements.periodCount) {
    elements.periodCount.textContent = `${periods.length}건`
  }
  elements.periodList.innerHTML = periods
    .map((period) => {
      const range = formatDateRange(period.startDate, period.endDate)
      const created = formatDateTime(period.createdAt)
      return `<li class="flex items-center justify-between gap-3 rounded-2xl bg-[#fff7bf]/60 px-4 py-3">
        <div>
          <p class="text-sm font-semibold text-[#4f3b0f]">✅ ${range}</p>
          <p class="text-xs text-[#7a5a00]">저장일: ${created} · 총 ${period.dayCount || '-'}일</p>
        </div>
        <button type="button" data-period-id="${period.id}" class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#9a3412] transition hover:bg-[#fee2e2]">❌</button>
      </li>`
    })
    .join('')
}

function updatePeriodSection() {
  const current = state.currentPeriod
  if (!current) {
    setPeriodBadge('기간 미설정', 'warning')
    if (elements.periodCurrentLabel) {
      elements.periodCurrentLabel.textContent = '-'
    }
    if (elements.periodCurrentRange) {
      elements.periodCurrentRange.textContent = '저장된 기간이 없습니다.'
    }
    if (elements.periodMessage) {
      elements.periodMessage.textContent = '새로운 기간을 저장하면 이곳에 표시됩니다.'
    }
  } else {
    const now = Date.now()
    const start = new Date(current.startDate).getTime()
    const end = new Date(current.endDate).getTime()
    let badgeLabel = '진행 중'
    let tone = 'success'
    if (now < start) {
      badgeLabel = '예정'
      tone = 'warning'
    } else if (now > end) {
      badgeLabel = '종료'
      tone = 'danger'
    }
    setPeriodBadge(badgeLabel, tone)
    if (elements.periodCurrentLabel) {
      elements.periodCurrentLabel.textContent = badgeLabel
    }
    if (elements.periodCurrentRange) {
      elements.periodCurrentRange.textContent = `${formatDateRange(current.startDate, current.endDate)} · 총 ${current.dayCount || '-'}일`
    }
    if (elements.periodMessage) {
      elements.periodMessage.textContent = '새로 저장된 기간이 즉시 적용되었습니다.'
    }
    if (elements.periodStart instanceof HTMLInputElement) {
      elements.periodStart.value = current.startDate.slice(0, 16)
    }
    if (elements.periodEnd instanceof HTMLInputElement) {
      elements.periodEnd.value = current.endDate.slice(0, 16)
    }
  }
  renderPeriodList()
  renderDeadlineList()
}

function updateParticipantsSection() {
  if (elements.participantsFilename) {
    const pendingName = state.pendingUpload?.fileName
    elements.participantsFilename.textContent = pendingName ? `선택된 파일: ${pendingName}` : '선택된 파일이 없습니다.'
  }
  if (elements.participantsStatus) {
    elements.participantsStatus.textContent = 'CSV 또는 XLSX 파일을 업로드해주세요.'
  }
  if (elements.participantsTotal) {
    elements.participantsTotal.textContent = `${state.participantsTotal}명`
  }
  renderParticipantsTable(state.participantsPreview)
}

function updateUsersTable(users) {
  if (!(elements.usersTable instanceof HTMLElement)) {
    return
  }
  if (!users || users.length === 0) {
    elements.usersTable.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-[#7a5a00]">불러온 사용자 정보가 없습니다.</td></tr>'
    if (elements.usersCount) {
      elements.usersCount.textContent = '0명'
    }
    return
  }
  if (elements.usersCount) {
    elements.usersCount.textContent = `${users.length}명`
  }
  elements.usersTable.innerHTML = users
    .map(
      (user) =>
        `<tr class="bg-white">
          <td class="px-4 py-3 text-sm text-[#3f2f00]">${user.name || '-'}</td>
          <td class="px-4 py-3 text-sm text-[#5b4100]">${user.email}</td>
          <td class="px-4 py-3 text-sm text-[#5b4100]">${user.role}</td>
          <td class="px-4 py-3 text-sm text-[#7a5a00]">${user.lastLogin ? formatDateTime(user.lastLogin) : '-'}</td>
        </tr>`,
    )
    .join('')
}

async function fetchPeriods() {
  try {
    const response = await fetch('/api/admin/michina/period', { credentials: 'include' })
    if (!response.ok) {
      throw new Error('FAILED_TO_LOAD_PERIODS')
    }
    const payload = await response.json()
    state.periods = Array.isArray(payload.periods) ? payload.periods : []
    state.currentPeriod = payload.current || null
    state.deadlines = Array.isArray(payload.deadlines) ? payload.deadlines : []
    updatePeriodSection()
  } catch (error) {
    console.error('[admin] failed to fetch periods', error)
    showToast('챌린지 기간 정보를 불러오지 못했습니다.', 'warning')
  }
}

async function savePeriod(startValue, endValue) {
  if (!startValue || !endValue) {
    showToast('⚠️ 시작일과 종료일을 모두 선택해주세요.', 'warning')
    return
  }
  const start = new Date(startValue)
  const end = new Date(endValue)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    showToast('⚠️ 올바른 날짜와 시간을 입력해주세요.', 'warning')
    return
  }
  if (start.getTime() > end.getTime()) {
    showToast('⚠️ 종료일이 시작일보다 이전입니다', 'warning')
    return
  }
  if (elements.periodSubmit instanceof HTMLButtonElement) {
    elements.periodSubmit.disabled = true
    elements.periodSubmit.textContent = '저장 중…'
  }
  try {
    const response = await fetch('/api/admin/michina/period', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: startValue, end: endValue }),
    })
    const payload = await response.json()
    if (!response.ok || payload?.error) {
      if (payload?.error === 'INVALID_RANGE') {
        showToast('⚠️ 종료일이 시작일보다 이전입니다', 'warning')
      } else {
        showToast('챌린지 기간을 저장하지 못했습니다.', 'danger')
      }
      return
    }
    showToast('✅ 챌린지 기간이 저장되었습니다', 'success')
    state.periods = Array.isArray(payload.periods) ? payload.periods : []
    state.currentPeriod = payload.current || null
    state.deadlines = Array.isArray(payload.deadlines) ? payload.deadlines : []
    updatePeriodSection()
  } catch (error) {
    console.error('[admin] failed to save period', error)
    showToast('챌린지 기간을 저장하지 못했습니다.', 'danger')
  } finally {
    if (elements.periodSubmit instanceof HTMLButtonElement) {
      elements.periodSubmit.disabled = false
      elements.periodSubmit.textContent = '저장'
    }
  }
}

async function deletePeriod(periodId) {
  const confirmed = await openConfirmModal({
    title: '기간 삭제',
    message: '선택한 기간을 삭제할까요? 일차별 데드라인도 함께 제거됩니다.',
    confirmLabel: '삭제',
    cancelLabel: '취소',
  })
  closeConfirmModal()
  if (!confirmed) {
    return
  }
  try {
    const response = await fetch(`/api/admin/michina/period/${periodId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    const payload = await response.json()
    if (!response.ok || payload?.error) {
      showToast('기간을 삭제하지 못했습니다.', 'danger')
      return
    }
    showToast('✅ 선택한 기간이 삭제되었습니다', 'success')
    state.periods = Array.isArray(payload.periods) ? payload.periods : []
    state.currentPeriod = payload.current || null
    state.deadlines = Array.isArray(payload.deadlines) ? payload.deadlines : []
    updatePeriodSection()
  } catch (error) {
    console.error('[admin] failed to delete period', error)
    showToast('기간을 삭제하지 못했습니다.', 'danger')
  }
}

async function fetchParticipants(limit = 'preview') {
  try {
    const query = limit === 'all' ? '?limit=all' : ''
    const response = await fetch(`/api/admin/michina/participants${query}`, { credentials: 'include' })
    if (!response.ok) {
      throw new Error('FAILED_TO_FETCH_PARTICIPANTS')
    }
    const payload = await response.json()
    const list = Array.isArray(payload.preview) ? payload.preview : []
    if (limit !== 'all') {
      state.participantsPreview = list
      state.participantsTotal = Number(payload.total ?? list.length)
      updateParticipantsSection()
    }
    return list
  } catch (error) {
    console.error('[admin] failed to fetch participants', error)
    showToast('참가자 명단을 불러오지 못했습니다.', 'warning')
    return []
  }
}

async function uploadParticipants({ replaceExisting = false } = {}) {
  if (!state.pendingUpload || !state.pendingUpload.participants || state.pendingUpload.participants.length === 0) {
    showToast('⚠️ 명단이 존재하지 않습니다.', 'warning')
    return
  }
  if (state.isUploading) {
    return
  }
  state.isUploading = true
  if (elements.participantsUpload instanceof HTMLButtonElement) {
    elements.participantsUpload.disabled = true
    elements.participantsUpload.textContent = '업로드 중…'
  }
  try {
    const response = await fetch('/api/admin/michina/participants/import', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participants: state.pendingUpload.participants, replaceExisting }),
    })
    const payload = await response.json()
    if (payload?.error === 'EXISTING_DATA' && !replaceExisting) {
      const confirmed = await openConfirmModal({
        title: '명단 덮어쓰기',
        message: '기존 명단을 삭제하고 새로 업로드할까요?',
        confirmLabel: '예',
        cancelLabel: '아니오',
      })
      closeConfirmModal()
      if (confirmed) {
        state.isUploading = false
        if (elements.participantsUpload instanceof HTMLButtonElement) {
          elements.participantsUpload.disabled = false
          elements.participantsUpload.textContent = '명단 업로드'
        }
        await uploadParticipants({ replaceExisting: true })
        return
      }
      showToast('업로드가 취소되었습니다.', 'info')
      return
    }
    if (!response.ok || payload?.error) {
      if (payload?.error === 'EMPTY_UPLOAD') {
        showToast('⚠️ 명단이 존재하지 않습니다.', 'warning')
      } else {
        showToast('명단을 업로드하지 못했습니다.', 'danger')
      }
      return
    }
    const uploadedCount = payload.total ?? state.pendingUpload.participants.length
    showToast(`✅ 명단이 업로드되었습니다 (총 ${uploadedCount}명)`, 'success')
    if (elements.participantsStatus instanceof HTMLElement) {
      elements.participantsStatus.textContent = `✅ 명단이 업로드되었습니다. (총 ${uploadedCount}명)`
    }
    state.pendingUpload = null
    if (elements.participantsFile instanceof HTMLInputElement) {
      elements.participantsFile.value = ''
    }
    await fetchParticipants()
  } catch (error) {
    console.error('[admin] failed to upload participants', error)
    showToast('명단을 업로드하지 못했습니다.', 'danger')
  } finally {
    state.isUploading = false
    if (elements.participantsUpload instanceof HTMLButtonElement) {
      elements.participantsUpload.disabled = false
      elements.participantsUpload.textContent = '명단 업로드'
    }
  }
}

async function resetParticipants() {
  const confirmed = await openConfirmModal({
    title: '명단 초기화',
    message: '저장된 명단을 모두 삭제할까요? 되돌릴 수 없습니다.',
    confirmLabel: '초기화',
    cancelLabel: '취소',
  })
  closeConfirmModal()
  if (!confirmed) {
    return
  }
  try {
    const response = await fetch('/api/admin/michina/participants', { method: 'DELETE', credentials: 'include' })
    const payload = await response.json()
    if (!response.ok || payload?.error) {
      showToast('명단을 초기화하지 못했습니다.', 'danger')
      return
    }
    showToast('✅ 명단이 초기화되었습니다.', 'success')
    state.pendingUpload = null
    if (elements.participantsFile instanceof HTMLInputElement) {
      elements.participantsFile.value = ''
    }
    if (elements.participantsStatus instanceof HTMLElement) {
      elements.participantsStatus.textContent = '✅ 명단이 초기화되었습니다.'
    }
    await fetchParticipants()
  } catch (error) {
    console.error('[admin] failed to delete participants', error)
    showToast('명단을 초기화하지 못했습니다.', 'danger')
  }
}

async function fetchUsers() {
  try {
    const response = await fetch('/api/admin/users', { credentials: 'include' })
    if (!response.ok) {
      throw new Error('FAILED_TO_FETCH_USERS')
    }
    const payload = await response.json()
    const users = Array.isArray(payload.users) ? payload.users : []
    updateUsersTable(users)
  } catch (error) {
    console.error('[admin] failed to fetch users', error)
    showToast('사용자 정보를 불러오지 못했습니다.', 'warning')
  }
}

async function handleFileSelection(event) {
  const file = event.target?.files?.[0]
  if (!file) {
    state.pendingUpload = null
    updateParticipantsSection()
    return
  }
  try {
    const participants = await parseParticipantsFile(file)
    if (participants.length === 0) {
      showToast('⚠️ 명단이 존재하지 않습니다.', 'warning')
      state.pendingUpload = null
    } else {
      state.pendingUpload = { fileName: file.name, participants }
      showToast(`파일이 준비되었습니다. (${participants.length}명)`, 'info')
    }
  } catch (error) {
    console.error('[admin] failed to parse file', error)
    if (error.message === 'UNSUPPORTED_FORMAT') {
      showToast('⚠️ 지원하지 않는 파일 형식입니다. (CSV, XLSX만 가능)', 'warning')
    } else {
      showToast('파일을 읽는 중 오류가 발생했습니다.', 'danger')
    }
    state.pendingUpload = null
  }
  updateParticipantsSection()
}

async function handleLogout() {
  try {
    await fetch('/api/auth/admin/logout', { method: 'POST', credentials: 'include' })
  } catch (error) {
    console.error('[admin] failed to logout', error)
  } finally {
    window.location.href = '/'
  }
}

function registerEventListeners() {
  if (elements.logout instanceof HTMLElement) {
    elements.logout.addEventListener('click', handleLogout)
  }
  if (elements.periodForm instanceof HTMLFormElement) {
    elements.periodForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (!(elements.periodStart instanceof HTMLInputElement) || !(elements.periodEnd instanceof HTMLInputElement)) {
        return
      }
      await savePeriod(elements.periodStart.value, elements.periodEnd.value)
    })
  }
  if (elements.periodList instanceof HTMLElement) {
    elements.periodList.addEventListener('click', async (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      const periodId = target.getAttribute('data-period-id')
      if (!periodId) {
        return
      }
      const id = Number.parseInt(periodId, 10)
      if (Number.isNaN(id)) {
        return
      }
      await deletePeriod(id)
    })
  }
  if (elements.participantsFile instanceof HTMLInputElement) {
    elements.participantsFile.addEventListener('change', handleFileSelection)
  }
  if (elements.participantsUpload instanceof HTMLButtonElement) {
    elements.participantsUpload.addEventListener('click', () => uploadParticipants({ replaceExisting: false }))
  }
  if (elements.participantsReset instanceof HTMLButtonElement) {
    elements.participantsReset.addEventListener('click', resetParticipants)
  }
  if (elements.participantsRefresh instanceof HTMLButtonElement) {
    elements.participantsRefresh.addEventListener('click', () => fetchParticipants())
  }
  if (elements.participantsViewAll instanceof HTMLButtonElement) {
    elements.participantsViewAll.addEventListener('click', async () => {
      const full = await fetchParticipants('all')
      openPreviewModal(full)
    })
  }
  if (elements.modalConfirm instanceof HTMLElement) {
    elements.modalConfirm.addEventListener('click', () => closeConfirmModal(true))
  }
  if (elements.modalCancel instanceof HTMLElement) {
    elements.modalCancel.addEventListener('click', () => closeConfirmModal(false))
  }
  if (elements.previewClose instanceof HTMLElement) {
    elements.previewClose.addEventListener('click', closePreviewModal)
  }
  if (elements.previewBackdrop instanceof HTMLElement) {
    elements.previewBackdrop.addEventListener('click', (event) => {
      if (event.target === elements.previewBackdrop) {
        closePreviewModal()
      }
    })
  }
  if (elements.modalBackdrop instanceof HTMLElement) {
    elements.modalBackdrop.addEventListener('click', (event) => {
      if (event.target === elements.modalBackdrop) {
        closeConfirmModal(false)
      }
    })
  }
}

async function initialize() {
  registerEventListeners()
  await Promise.all([fetchPeriods(), fetchParticipants(), fetchUsers()])
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize)
} else {
  initialize()
}
