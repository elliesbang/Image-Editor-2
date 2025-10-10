const sampleImages = [
  {
    id: 'sample-1',
    type: 'sample',
    name: '봄 플로럴 프로모션',
    src: 'https://images.unsplash.com/photo-1498931299472-f7a63a5a1cfa?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'sample-2',
    type: 'sample',
    name: '미니멀 패키지 모형',
    src: 'https://images.unsplash.com/photo-1618005198919-d3d4b5a92eee?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'sample-3',
    type: 'sample',
    name: '파스텔 브랜딩 카드',
    src: 'https://images.unsplash.com/photo-1618005198900-81f472679f9e?auto=format&fit=crop&w=900&q=80',
  },
]

const galleryEl = document.getElementById('gallery')
const dropzoneEl = document.getElementById('dropzone')
const fileInputEl = document.getElementById('file-input')
const fileTriggerButton = document.getElementById('file-trigger')
const analyzeButton = document.getElementById('analyze-button')
const analyzeStatusEl = document.getElementById('analyze-status')
const errorBannerEl = document.getElementById('error-banner')
const resultCardEl = document.getElementById('result-card')
const resultPlaceholderEl = document.getElementById('result-placeholder')
const resultTitleEl = document.getElementById('result-panel-title')
const resultDescriptionEl = document.getElementById('result-description')
const keywordListEl = document.getElementById('keyword-list')
const copyButton = document.getElementById('copy-button')
const copyToast = document.getElementById('copy-toast')

let galleryItems = [...sampleImages]
let selectedId = null
let copyToastTimer = null
let latestKeywords = []

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function setAnalyzeStatus(content) {
  if (!content) {
    analyzeStatusEl.innerHTML = ''
    return
  }
  analyzeStatusEl.innerHTML = content
}

function hideError() {
  errorBannerEl.style.display = 'none'
}

function showError() {
  errorBannerEl.style.display = 'block'
}

function renderGallery() {
  galleryEl.innerHTML = ''
  if (galleryItems.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'status-text'
    empty.textContent = '표시할 이미지가 없습니다. 이미지를 업로드해 주세요.'
    galleryEl.appendChild(empty)
    return
  }

  for (const item of galleryItems) {
    const wrapper = document.createElement('button')
    wrapper.type = 'button'
    wrapper.className = 'gallery-item'
    wrapper.dataset.id = item.id

    if (item.id === selectedId) {
      wrapper.classList.add('is-selected')
    }

    const img = document.createElement('img')
    img.src = item.src
    img.alt = `${item.name} 미리보기`
    img.loading = 'lazy'
    wrapper.appendChild(img)

    const label = document.createElement('span')
    label.textContent = item.name
    wrapper.appendChild(label)

    wrapper.addEventListener('click', () => {
      selectGalleryItem(item.id)
    })

    galleryEl.appendChild(wrapper)
  }
}

function selectGalleryItem(id) {
  selectedId = id
  const buttons = galleryEl.querySelectorAll('.gallery-item')
  buttons.forEach((button) => {
    if (button.dataset.id === id) {
      button.classList.add('is-selected')
    } else {
      button.classList.remove('is-selected')
    }
  })
  analyzeButton.disabled = !id
  hideError()
}

async function handleFiles(files) {
  const validFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
  if (validFiles.length === 0) {
    setAnalyzeStatus('<span style="color: var(--danger);">이미지 형식의 파일만 업로드할 수 있습니다.</span>')
    return
  }

  setAnalyzeStatus('이미지를 불러오고 있습니다...')

  const reads = validFiles.map(
    (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          resolve({
            id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'upload',
            name: normalizeText(file.name) || '업로드 이미지',
            src: reader.result,
          })
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      }),
  )

  try {
    const results = await Promise.all(reads)
    galleryItems = [...results, ...galleryItems]
    renderGallery()
    selectGalleryItem(results[0].id)
    setAnalyzeStatus(`${results.length}개의 이미지가 추가되었습니다.`)
  } catch (error) {
    console.error('이미지 읽기 오류', error)
    setAnalyzeStatus('<span style="color: var(--danger);">이미지를 불러오지 못했습니다.</span>')
  }
}

function resetCopyToast() {
  copyToast.classList.remove('is-visible')
  if (copyToastTimer) {
    clearTimeout(copyToastTimer)
    copyToastTimer = null
  }
}

async function analyzeSelectedImage() {
  if (!selectedId) return
  const target = galleryItems.find((item) => item.id === selectedId)
  if (!target) return

  analyzeButton.disabled = true
  setAnalyzeStatus('<span class="loading-spinner" role="status" aria-label="분석 중"></span>')
  hideError()
  resetCopyToast()

  const payload = {
    name: target.name,
  }

  if (target.type === 'upload') {
    payload.image = target.src
  } else if (target.type === 'sample') {
    payload.imageUrl = target.src
  }

  try {
    const response = await fetch('/functions/analyzeImage', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()

    if (data?.error) {
      throw new Error(data.error)
    }

    const title = normalizeText(data?.title) || '대표 제목을 생성하지 못했습니다.'
    const keywords = Array.isArray(data?.keywords) ? data.keywords.map(normalizeText).filter(Boolean) : []

    latestKeywords = keywords

    resultTitleEl.textContent = title
    resultDescriptionEl.textContent = `선택한 이미지를 기반으로 추출된 한국어 키워드 ${keywords.length}개입니다.`

    keywordListEl.innerHTML = ''
    for (const keyword of keywords) {
      const li = document.createElement('li')
      li.className = 'keyword-chip'
      li.textContent = keyword
      keywordListEl.appendChild(li)
    }

    resultPlaceholderEl.style.display = 'none'
    resultCardEl.style.display = 'flex'
    setAnalyzeStatus('분석이 완료되었습니다.')
  } catch (error) {
    console.error('분석 실패', error)
    showError()
    setAnalyzeStatus('<span style="color: var(--danger);">분석을 진행할 수 없습니다.</span>')
  } finally {
    analyzeButton.disabled = !selectedId
  }
}

async function handleCopyKeywords() {
  if (!latestKeywords.length) {
    resetCopyToast()
    return
  }

  const text = latestKeywords.join(', ')
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }

    resetCopyToast()
    copyToast.classList.add('is-visible')
    copyToastTimer = setTimeout(() => {
      copyToast.classList.remove('is-visible')
    }, 2000)
  } catch (error) {
    console.error('복사 실패', error)
    setAnalyzeStatus('<span style="color: var(--danger);">키워드를 복사하지 못했습니다.</span>')
  }
}

function setupDropzone() {
  const activate = (event) => {
    event.preventDefault()
    event.stopPropagation()
    dropzoneEl.classList.add('is-dragover')
  }

  const deactivate = (event) => {
    event.preventDefault()
    event.stopPropagation()
    dropzoneEl.classList.remove('is-dragover')
  }

  ;['dragenter', 'dragover'].forEach((type) => {
    dropzoneEl.addEventListener(type, activate)
  })
  ;['dragleave', 'drop'].forEach((type) => {
    dropzoneEl.addEventListener(type, deactivate)
  })

  dropzoneEl.addEventListener('drop', (event) => {
    const files = event.dataTransfer?.files
    if (files?.length) {
      handleFiles(files)
    }
  })

  dropzoneEl.addEventListener('click', () => {
    fileInputEl.click()
  })

  dropzoneEl.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      fileInputEl.click()
    }
  })
}

function setupFileInput() {
  fileInputEl.addEventListener('change', (event) => {
    const files = event.target?.files
    if (files?.length) {
      handleFiles(files)
      fileInputEl.value = ''
    }
  })
}

function setupSampleSelection() {
  renderGallery()
  if (galleryItems.length > 0) {
    selectGalleryItem(galleryItems[0].id)
  }
}

function init() {
  setupSampleSelection()
  setupDropzone()
  setupFileInput()

  fileTriggerButton.addEventListener('click', () => {
    fileInputEl.click()
  })

  analyzeButton.addEventListener('click', () => {
    analyzeSelectedImage()
  })

  copyButton.addEventListener('click', () => {
    handleCopyKeywords()
  })
}

init()
