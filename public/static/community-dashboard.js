const TOTAL_DAYS = 15
const STORAGE_KEY = 'michina-preview-progress'

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
    progressText: document.querySelector('[data-role="progress-text"]'),
    progressBar: document.querySelector('[data-role="progress-bar"]'),
    completedList: document.querySelector('[data-role="completed-list"]'),
    certificateButton: document.querySelector('[data-role="certificate-button"]'),
  }

  if (!elements.daySelect || !elements.fileInput || !elements.submissionForm) {
    console.error('필수 폼 요소를 찾을 수 없습니다.')
    return
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
  }

  function renderCompletedDays() {
    if (!elements.completedList) return
    elements.completedList.innerHTML = ''
    const completedDays = state.submissions
      .map((entry, index) => (entry ? index + 1 : null))
      .filter((day) => day !== null)

    if (completedDays.length === 0) {
      const emptyItem = document.createElement('li')
      emptyItem.className = 'completed-list__item completed-list__item--empty'
      emptyItem.textContent = '아직 제출된 미션이 없어요.'
      elements.completedList.appendChild(emptyItem)
      return
    }

    completedDays.forEach((day) => {
      const item = document.createElement('li')
      item.className = 'completed-list__item completed-list__item--filled'
      item.textContent = `✅ ${day}일차 완료`
      elements.completedList.appendChild(item)
    })
  }

  function updateProgress() {
    const completed = getCompletedCount(state)
    const ratio = Math.round((completed / TOTAL_DAYS) * 100)
    if (elements.progressText) {
      elements.progressText.textContent = `${completed} / ${TOTAL_DAYS}일차 완료`
    }
    if (elements.progressBar) {
      elements.progressBar.style.width = `${Math.min(100, Math.max(0, ratio))}%`
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

  elements.submissionForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const selectedDay = Number(elements.daySelect.value)
    if (!Number.isInteger(selectedDay) || selectedDay < 1 || selectedDay > TOTAL_DAYS) {
      window.alert('제출할 일차를 선택해주세요.')
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
      window.alert(`${selectedDay}일차 업로드 완료!`)
      elements.fileInput.value = ''
      elements.daySelect.value = String(getNextAvailableDay(state))
      updateProgress()
      renderCompletedDays()
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
  renderCompletedDays()
  updateProgress()
  updateCertificateButtonVisibility()

  if (state.completedAt) {
    updateCertificateButtonVisibility()
  }
})
