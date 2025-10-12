const TOTAL_DAYS = 15
const STORAGE_KEY = 'michina-preview-progress'
const challengeConfig = { deadlines: [], period: null }

function formatDeadlineWindow(startIso, endIso) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '-'
  }
  const toLabel = (date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  }
  return `${toLabel(start)} ~ ${toLabel(end)}`
}

function createEmptyState() {
  return {
    submissions: Array.from({ length: TOTAL_DAYS }, () => null),
    completedAt: null,
  }
}

function loadState() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY)
    if (!raw) {
      return createEmptyState()
    }
    const parsed = JSON.parse(raw)
    const submissions = Array.from({ length: TOTAL_DAYS }, (_, index) => {
      const entry = parsed?.submissions?.[index]
      if (!entry || typeof entry !== 'object') {
        return null
      }
      const day = Number(entry.day)
      const imageBase64 = typeof entry.imageBase64 === 'string' ? entry.imageBase64 : null
      const submittedAt = typeof entry.submittedAt === 'string' ? entry.submittedAt : new Date().toISOString()
      if (!Number.isInteger(day) || day < 1 || day > TOTAL_DAYS || !imageBase64) {
        return null
      }
      return { day, imageBase64, submittedAt }
    })
    const completedAt = typeof parsed?.completedAt === 'string' ? parsed.completedAt : null
    return { submissions, completedAt }
  } catch (error) {
    console.error('미치나 미리보기 진행 데이터를 불러오지 못했습니다.', error)
    return createEmptyState()
  }
}

function saveState(state) {
  try {
    const payload = {
      submissions: state.submissions.map((entry, index) => {
        if (!entry) {
          return null
        }
        return {
          day: entry.day ?? index + 1,
          imageBase64: entry.imageBase64,
          submittedAt: entry.submittedAt,
        }
      }),
      completedAt: state.completedAt,
    }
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    console.error('미치나 미리보기 진행 데이터를 저장하지 못했습니다.', error)
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

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getCompletedCount(state) {
  return state.submissions.reduce((total, entry) => (entry ? total + 1 : total), 0)
}

function getNextAvailableDay(state) {
  const next = state.submissions.findIndex((entry) => !entry)
  return next === -1 ? TOTAL_DAYS : next + 1
}

async function issueCertificate(state, { silent = false } = {}) {
  if (typeof window.html2canvas !== 'function') {
    console.error('html2canvas 라이브러리를 불러오지 못했습니다.')
    if (!silent) {
      window.alert('수료증 이미지를 생성하지 못했습니다. 잠시 후 다시 시도해주세요.')
    }
    return
  }

  const template = document.querySelector('[data-role="certificate-template"]')
  if (!template) {
    console.error('수료증 템플릿 요소를 찾을 수 없습니다.')
    if (!silent) {
      window.alert('수료증 템플릿이 준비되지 않았습니다.')
    }
    return
  }

  const dateElement = template.querySelector('[data-role="certificate-date"]')
  const issuedDate = state.completedAt ? new Date(state.completedAt) : new Date()
  dateElement.textContent = `수료일: ${formatDate(issuedDate)}`

  try {
    const canvas = await window.html2canvas(template, {
      backgroundColor: '#f5eee9',
      scale: Math.max(window.devicePixelRatio || 1, 1.5),
      useCORS: true,
    })

    await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('CERTIFICATE_BLOB_FAILED'))
          return
        }
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        const filename = `Elliesbang-Michina-Certificate-${formatDate(issuedDate)}.png`
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setTimeout(() => URL.revokeObjectURL(url), 0)
        resolve()
      }, 'image/png')
    })
  } catch (error) {
    console.error('수료증 이미지를 생성하는 중 오류가 발생했습니다.', error)
    if (!silent) {
      window.alert('수료증 이미지를 생성하지 못했습니다. 잠시 후 다시 시도해주세요.')
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const state = loadState()

  const elements = {
    daySelect: document.querySelector('[data-role="day-select"]'),
    fileInput: document.querySelector('[data-role="file-input"]'),
    submissionForm: document.querySelector('[data-role="submission-form"]'),
    missionStatus: document.getElementById('missionStatus'),
    progressFill: document.querySelector('.progress-fill'),
    submittedDays: document.getElementById('submittedDays'),
    unsubmittedDays: document.getElementById('unsubmittedDays'),
    certificateButton: document.querySelector('[data-role="certificate-button"]'),
    deadlineStatus: document.querySelector('[data-role="deadline-status"]'),
  }

  if (elements.submissionForm instanceof HTMLFormElement) {
    elements.submitButton = elements.submissionForm.querySelector('button[type="submit"]')
  }

  if (!elements.daySelect || !elements.fileInput || !elements.submissionForm) {
    console.error('필수 폼 요소를 찾을 수 없습니다.')
    return
  }

  function getDeadlineForDay(day) {
    const target = Number.isInteger(day) ? day : Number.NaN
    if (!Number.isFinite(target)) {
      return null
    }
    return challengeConfig.deadlines.find((deadline) => deadline.dayIndex === target) || null
  }

  function setSubmitDisabled(disabled) {
    if (elements.submitButton instanceof HTMLButtonElement) {
      elements.submitButton.disabled = disabled
      if (disabled) {
        elements.submitButton.setAttribute('aria-disabled', 'true')
      } else {
        elements.submitButton.removeAttribute('aria-disabled')
      }
    }
  }

  function updateDeadlineStatus(selectedDay) {
    if (!(elements.deadlineStatus instanceof HTMLElement)) {
      return
    }
    const deadlines = Array.isArray(challengeConfig.deadlines) ? challengeConfig.deadlines : []
    if (!deadlines.length) {
      elements.deadlineStatus.textContent = '⚠️ 챌린지 기간이 설정되지 않았습니다.'
      setSubmitDisabled(true)
      return
    }
    const dayNumber = Number.isInteger(selectedDay) && selectedDay > 0 ? selectedDay : deadlines[0].dayIndex
    if (elements.daySelect instanceof HTMLSelectElement && dayNumber) {
      const hasOption = Array.from(elements.daySelect.options).some((option) => Number(option.value) === dayNumber)
      if (!hasOption) {
        elements.daySelect.value = String(deadlines[0].dayIndex)
      }
    }
    const deadline = getDeadlineForDay(dayNumber)
    if (!deadline) {
      elements.deadlineStatus.textContent = '⚠️ 선택한 일차의 데드라인 정보를 찾을 수 없습니다.'
      setSubmitDisabled(true)
      return
    }
    const now = Date.now()
    const start = new Date(deadline.startAt).getTime()
    const end = new Date(deadline.endAt).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) {
      elements.deadlineStatus.textContent = '⚠️ 데드라인 정보를 불러오지 못했습니다.'
      setSubmitDisabled(true)
      return
    }
    let message = `오늘은 ${deadline.dayIndex}일차: ${formatDeadlineWindow(deadline.startAt, deadline.endAt)}`
    setSubmitDisabled(false)
    if (now < start) {
      message = `⏳ ${deadline.dayIndex}일차 제출은 ${formatDeadlineWindow(deadline.startAt, deadline.endAt)}에 가능합니다.`
      setSubmitDisabled(true)
    } else if (now > end) {
      message = '⏰ 제출 기간이 지났습니다.'
      setSubmitDisabled(true)
    }
    elements.deadlineStatus.textContent = message
  }

  async function loadChallengeConfig() {
    try {
      const response = await fetch('/api/michina/deadlines')
      if (!response.ok) {
        throw new Error('FAILED_TO_LOAD_DEADLINES')
      }
      const payload = await response.json()
      challengeConfig.period = payload?.period || null
      challengeConfig.deadlines = Array.isArray(payload?.deadlines) ? payload.deadlines : []
      const active = payload?.active
      if (elements.daySelect instanceof HTMLSelectElement && active?.dayIndex) {
        elements.daySelect.value = String(active.dayIndex)
      }
      const selectedDay = elements.daySelect instanceof HTMLSelectElement ? Number(elements.daySelect.value) : Number.NaN
      updateDeadlineStatus(selectedDay)
    } catch (error) {
      console.error('챌린지 기간 정보를 불러오지 못했습니다.', error)
      if (elements.deadlineStatus instanceof HTMLElement) {
        elements.deadlineStatus.textContent = '⚠️ 챌린지 기간 정보를 불러오지 못했습니다.'
      }
      setSubmitDisabled(true)
    }
  }

  function populateDayOptions() {
    elements.daySelect.innerHTML = ''
    for (let day = 1; day <= TOTAL_DAYS; day += 1) {
      const option = document.createElement('option')
      option.value = String(day)
      option.textContent = `${day}일차`
      elements.daySelect.appendChild(option)
    }
    elements.daySelect.value = String(getNextAvailableDay(state))
    updateDeadlineStatus(Number(elements.daySelect.value))
  }

  function updateProgress() {
    const completed = getCompletedCount(state)
    const ratio = Math.round((completed / TOTAL_DAYS) * 100)
    if (elements.missionStatus) {
      elements.missionStatus.textContent = `${completed} / ${TOTAL_DAYS}일차 완료 · ${ratio}%`
    }
    if (elements.progressFill) {
      elements.progressFill.style.width = `${Math.min(100, Math.max(0, ratio))}%`
    }

    const submittedDays = state.submissions
      .map((entry, index) => (entry ? index + 1 : null))
      .filter((day) => day !== null)

    const unsubmittedDays = Array.from({ length: TOTAL_DAYS }, (_, index) => index + 1).filter(
      (day) => !submittedDays.includes(day),
    )

    if (elements.submittedDays) {
      elements.submittedDays.textContent = submittedDays.length > 0 ? submittedDays.join(', ') : '없음'
    }

    if (elements.unsubmittedDays) {
      elements.unsubmittedDays.textContent =
        unsubmittedDays.length > 0 ? unsubmittedDays.join(', ') : '없음'
    }
  }

  function updateCertificateButtonVisibility() {
    if (!elements.certificateButton) {
      return
    }
    if (getCompletedCount(state) === TOTAL_DAYS) {
      elements.certificateButton.classList.remove('hidden')
    } else {
      elements.certificateButton.classList.add('hidden')
    }
  }

  async function handleCompletion() {
    if (getCompletedCount(state) !== TOTAL_DAYS) {
      return
    }

    if (!state.completedAt) {
      state.completedAt = new Date().toISOString()
      saveState(state)
      await issueCertificate(state)
      window.alert('🎉 축하합니다! 수료증이 자동 발급되었습니다.')
    }
  }

  if (elements.daySelect instanceof HTMLSelectElement) {
    elements.daySelect.addEventListener('change', () => {
      const selectedDay = Number(elements.daySelect.value)
      updateDeadlineStatus(selectedDay)
    })
  }

  elements.submissionForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const selectedDay = Number(elements.daySelect.value)
    if (!Number.isInteger(selectedDay) || selectedDay < 1 || selectedDay > TOTAL_DAYS) {
      window.alert('제출할 일차를 선택해주세요.')
      return
    }

    if (!challengeConfig.deadlines.length) {
      window.alert('⚠️ 챌린지 기간이 설정되지 않았습니다.')
      return
    }

    const deadline = getDeadlineForDay(selectedDay)
    if (!deadline) {
      window.alert('⚠️ 선택한 일차의 데드라인 정보를 찾을 수 없습니다.')
      return
    }

    const now = Date.now()
    const start = new Date(deadline.startAt).getTime()
    const end = new Date(deadline.endAt).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) {
      window.alert('⚠️ 데드라인 정보를 불러오지 못했습니다.')
      return
    }
    if (now < start) {
      window.alert('⏳ 제출 가능 시간이 아직 시작되지 않았습니다.')
      updateDeadlineStatus(selectedDay)
      return
    }
    if (now > end) {
      window.alert('⏰ 제출 기간이 지났습니다.')
      updateDeadlineStatus(selectedDay)
      return
    }

    if (state.submissions[selectedDay - 1]) {
      window.alert('이미 제출한 일차입니다. 다른 날짜를 선택해주세요.')
      return
    }

    const file = elements.fileInput.files?.[0]
    if (!file) {
      window.alert('업로드할 이미지를 선택해주세요.')
      return
    }

    try {
      const imageBase64 = await readFileAsDataURL(file)
      state.submissions[selectedDay - 1] = {
        day: selectedDay,
        imageBase64,
        submittedAt: new Date().toISOString(),
      }
      saveState(state)
      window.alert('✅ 오늘의 미션이 성공적으로 업로드되었습니다.')
      elements.fileInput.value = ''
      elements.daySelect.value = String(getNextAvailableDay(state))
      updateDeadlineStatus(Number(elements.daySelect.value))
      updateProgress()
      updateCertificateButtonVisibility()
      await handleCompletion()
    } catch (error) {
      console.error('이미지를 저장하는 중 문제가 발생했습니다.', error)
      window.alert('이미지를 불러오지 못했습니다. 다시 시도해주세요.')
    }
  })

  if (elements.certificateButton) {
    elements.certificateButton.addEventListener('click', async () => {
      if (getCompletedCount(state) !== TOTAL_DAYS) {
        window.alert('아직 모든 미션을 완료하지 않았어요.')
        return
      }
      if (!state.completedAt) {
        state.completedAt = new Date().toISOString()
        saveState(state)
      }
      await issueCertificate(state, { silent: true })
    })
  }

  populateDayOptions()
  loadChallengeConfig()
  updateProgress()
  updateCertificateButtonVisibility()

  if (state.completedAt) {
    updateCertificateButtonVisibility()
  }

  function initOverallProgressChart() {
    const chartCanvas = document.getElementById('overallProgressChart')
    if (!chartCanvas) {
      return
    }

    if (typeof window.Chart !== 'function') {
      console.error('Chart.js를 불러오지 못했습니다.')
      return
    }

    const context = chartCanvas.getContext('2d')
    if (!context) {
      return
    }

    const labels = ['1주차', '2주차', '3주차', '4주차']
    const data = [85, 78, 91, 88]

    // eslint-disable-next-line no-new
    new window.Chart(context, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '제출률 (%)',
            data,
            backgroundColor: '#fef568',
            borderRadius: 8,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback: (value) => `${value}%`,
              stepSize: 20,
            },
            grid: {
              color: 'rgba(0, 0, 0, 0.05)',
            },
          },
          x: {
            grid: {
              display: false,
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (context) => `${context.parsed.y}%`,
            },
          },
        },
      },
    })
  }

  initOverallProgressChart()
})
