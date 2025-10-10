const FALLBACK_KEYWORDS = [
  '이미지',
  '사진',
  '디자인',
  '그래픽',
  '브랜딩',
  '콘텐츠',
  '마케팅',
  '소셜 미디어',
  '프로모션',
  '브랜드',
  '광고',
  '썸네일',
  '배너',
  '포스터',
  '프레젠테이션',
  '템플릿',
  '고화질',
  '투명 배경',
  '배경 제거',
  '크롭',
  '비주얼',
  '크리에이티브',
  '트렌디',
  '감각적인',
  '현대적인',
  '컬러 팔레트',
  '제품 촬영',
  '브랜드 아이덴티티',
  'SNS 콘텐츠',
  '웹디자인',
  'e커머스',
  '프리미엄',
  '스토리텔링',
  '모델 컷',
  '프로덕트',
  '무드 보드',
  '트렌드',
  '스타일링',
  '크리에이터',
  '비즈니스',
  '세일즈',
  '디지털 마케팅',
  '브랜드 캠페인',
  '온라인 쇼핑',
  '이커머스',
  '소셜 캠페인',
  '비주얼 아이덴티티',
  '랜딩페이지',
  '콘텐츠 전략',
]

const KEYWORD_COUNT = 25

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  })
}

function cleanKeyword(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/^[`"'•·\-]+/, '')
    .replace(/[`"'•·\-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function addKeywordUnique(list, value, seen) {
  const keyword = cleanKeyword(value)
  if (!keyword || keyword.length > 48) return
  if (seen.has(keyword)) return
  seen.add(keyword)
  list.push(keyword)
}

function parseGeminiKeywords(text) {
  if (typeof text !== 'string') return []
  const seen = new Set()
  const keywords = []
  const cleaned = text
    .replace(/키워드\s*[:：-]?/gi, '')
    .replace(/제목\s*[:：-]?.*/gi, '')
  const parts = cleaned.split(/[\n,，、·•|\\\/;:+]+/)
  for (const part of parts) {
    addKeywordUnique(keywords, part, seen)
    if (keywords.length >= 50) {
      break
    }
  }
  return keywords
}

function parseOpenAIContent(content) {
  if (typeof content !== 'string') {
    return { keywords: [], title: '' }
  }

  const seen = new Set()
  const keywords = []
  let title = ''
  let inKeywordBlock = false

  const lines = content.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      if (inKeywordBlock) {
        inKeywordBlock = false
      }
      continue
    }

    const titleMatch = line.match(/^(?:SEO\s*)?제목\s*[:：-]?\s*(.+)$/i)
    if (titleMatch && titleMatch[1]) {
      title = cleanKeyword(titleMatch[1])
      inKeywordBlock = false
      continue
    }

    if (/^(?:SEO\s*)?제목\s*$/i.test(line)) {
      inKeywordBlock = false
      continue
    }

    const keywordHeaderMatch = line.match(/^키워드(?:\s*\(.*\))?\s*[:：-]?\s*(.*)$/i)
    if (keywordHeaderMatch) {
      inKeywordBlock = true
      const remainder = keywordHeaderMatch[1]
      if (remainder) {
        for (const part of remainder.split(/[\,，、·•|\\\/;:+]+/)) {
          addKeywordUnique(keywords, part, seen)
        }
      }
      continue
    }

    if (inKeywordBlock) {
      if (/^(?:SEO\s*)?제목\b/i.test(line)) {
        const directTitle = line.replace(/^(?:SEO\s*)?제목\s*[:：-]?\s*/i, '')
        if (directTitle) {
          title = cleanKeyword(directTitle)
        }
        inKeywordBlock = false
        continue
      }
      const numbered = line.match(/^\d+\s*[\.\)]\s*(.+)$/)
      if (numbered && numbered[1]) {
        addKeywordUnique(keywords, numbered[1], seen)
        continue
      }
      addKeywordUnique(keywords, line, seen)
      continue
    }

    const numbered = line.match(/^\d+\s*[\.\)]\s*(.+)$/)
    if (numbered && numbered[1]) {
      addKeywordUnique(keywords, numbered[1], seen)
      continue
    }

    if (/[\,，、·•|\\\/;:+]+/.test(line)) {
      for (const part of line.split(/[\,，、·•|\\\/;:+]+/)) {
        addKeywordUnique(keywords, part, seen)
      }
      continue
    }
  }

  return { keywords, title }
}

function ensureKeywordCount(keywords, seen) {
  const list = [...keywords]
  for (const fallback of FALLBACK_KEYWORDS) {
    if (list.length >= KEYWORD_COUNT) break
    addKeywordUnique(list, fallback, seen)
  }
  while (list.length < KEYWORD_COUNT) {
    addKeywordUnique(list, `키워드 ${list.length + 1}`, seen)
  }
  return list.slice(0, KEYWORD_COUNT)
}

function arrayBufferToBase64(buffer) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64')
  }
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk)
  }
  return btoa(binary)
}

async function resolveImagePayload(imageUrl, fetchImpl) {
  if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
    throw new Error('IMAGE_URL_REQUIRED')
  }
  const trimmed = imageUrl.trim()
  const dataUrlMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1]
    const base64 = dataUrlMatch[2]
    return {
      mimeType,
      base64,
      dataUrl: trimmed,
    }
  }

  const response = await fetchImpl(trimmed)
  if (!response || !response.ok) {
    throw new Error(`IMAGE_FETCH_FAILED:${response ? response.status : 'NETWORK'}`)
  }
  const contentType = response.headers.get('content-type') || 'image/png'
  const arrayBuffer = await response.arrayBuffer()
  const base64 = arrayBufferToBase64(arrayBuffer)
  const dataUrl = `data:${contentType.split(';')[0]};base64,${base64}`
  return {
    mimeType: contentType.split(';')[0],
    base64,
    dataUrl,
  }
}

function buildTitleFromKeywords(keywords) {
  const list = keywords.filter(Boolean).map((keyword) => cleanKeyword(keyword)).filter(Boolean)
  if (list.length === 0) {
    return '이미지 키워드 분석 결과'
  }

  if (list.length === 1) {
    return `${list[0]} 감성 비주얼 키워드 모음`
  }

  if (list.length === 2) {
    return `${list[0]}와 ${list[1]} 감성의 비주얼 스토리`
  }

  const [first, second, third, fourth, fifth] = list
  if (list.length === 3) {
    return `${first}, ${second} 감성과 ${third} 무드의 크리에이티브`
  }

  if (list.length === 4) {
    return `${first}, ${second}, ${third} 감성의 ${fourth} 비주얼 무드`
  }

  const tail = fifth ? `${fourth}와 ${fifth}` : fourth
  return `${first}, ${second}, ${third} 감성을 담은 ${tail} 크리에이티브 컬렉션`
}

function normalizeImageInputs(body) {
  const urls = []
  const seen = new Set()
  if (Array.isArray(body?.imageUrls)) {
    for (const value of body.imageUrls) {
      if (typeof value === 'string' && value.trim()) {
        const trimmed = value.trim()
        if (!seen.has(trimmed)) {
          seen.add(trimmed)
          urls.push(trimmed)
        }
      }
    }
  }

  if (typeof body?.imageUrl === 'string' && body.imageUrl.trim()) {
    const trimmed = body.imageUrl.trim()
    if (!seen.has(trimmed)) {
      seen.add(trimmed)
      urls.push(trimmed)
    }
  }

  return urls
}

function createGeminiContentForImage(imagePayload) {
  return {
    contents: [
      {
        parts: [
          {
            text: '이 이미지를 실제로 분석해서 시각적으로 인식되는 주요 사물, 색상, 질감, 분위기, 스타일 등을 한국어 키워드로 25개 생성해줘. 쉼표로 구분해.',
          },
          {
            inline_data: {
              mime_type: imagePayload.mimeType || 'image/png',
              data: imagePayload.base64,
            },
          },
        ],
      },
    ],
  }
}

async function analyzeImageWithGemini(imagePayload, apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(createGeminiContentForImage(imagePayload)),
    },
  )

  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    const message = detail?.error?.message || `Gemini API 오류(${response.status})`
    throw new Error(message)
  }

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n') || ''
  const keywords = parseGeminiKeywords(text)
  return { keywords, raw: text }
}

async function analyzeGeminiCommonKeywords(perImageKeywords, apiKey) {
  const lines = perImageKeywords.map((keywords, index) => `이미지 ${index + 1}: ${keywords.join(', ') || '키워드 추출 실패'}`)
  const prompt =
    '다음은 여러 이미지에서 추출된 키워드 목록입니다. 모든 이미지에 공통적으로 나타나는 주제나 요소를 한국어 키워드 25개로 요약해줘. 쉼표로 구분하고 중복은 제거해.'

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${prompt}\n\n${lines.join('\n')}`,
              },
            ],
          },
        ],
      }),
    },
  )

  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    const message = detail?.error?.message || `Gemini API 오류(${response.status})`
    throw new Error(message)
  }

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n') || ''
  const keywords = parseGeminiKeywords(text)
  return { keywords, raw: text }
}

function buildOpenAIUserContent(imagePayload) {
  return [
    {
      type: 'text',
      text: '이 이미지를 시각적으로 분석해 주요 사물, 색감, 분위기, 질감, 스타일 등을 기반으로 한국어 SEO 키워드 25개를 생성해줘. 키워드는 번호와 함께 줄바꿈으로 나열하고, 다른 설명은 하지 마.',
    },
    {
      type: 'image_url',
      image_url: {
        url: imagePayload.dataUrl,
      },
    },
  ]
}

async function analyzeImageWithOpenAI(imagePayload, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content:
            '너는 한국어 SEO 전략가야. 이미지를 바탕으로 핵심 키워드만을 간결하게 추출해야 해. 응답은 "키워드" 제목과 번호 매긴 25개의 키워드만 포함해야 해.',
        },
        {
          role: 'user',
          content: buildOpenAIUserContent(imagePayload),
        },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    const message = detail?.error?.message || `OpenAI API 오류(${response.status})`
    throw new Error(message)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  const parsed = parseOpenAIContent(content)
  return { keywords: parsed.keywords, raw: typeof content === 'string' ? content : '' }
}

async function analyzeOpenAICommonKeywords(perImageKeywords, apiKey) {
  const bulletList = perImageKeywords
    .map((keywords, index) => `이미지 ${index + 1}: ${keywords.join(', ') || '키워드 추출 실패'}`)
    .join('\n')
  const instructions =
    '여러 이미지를 대표하는 공통 SEO 키워드를 25개 선정하고, 해당 키워드를 자연스럽게 엮은 한 문장 제목을 1개 작성해줘. 응답은 "키워드" 목록과 "SEO 제목" 한 줄만 포함해.'

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content:
            '너는 한국어 SEO 카피라이터야. 공통 키워드를 추리고 해당 키워드로 자연스러운 제목을 만들어야 해. 응답은 키워드 목록과 SEO 제목만 포함해.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${instructions}\n\n${bulletList}`,
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    const message = detail?.error?.message || `OpenAI API 오류(${response.status})`
    throw new Error(message)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  const parsed = parseOpenAIContent(content)
  return {
    keywords: parsed.keywords,
    title: parsed.title,
    raw: typeof content === 'string' ? content : '',
  }
}

export async function onRequestPost(context) {
  const { request, env } = context
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 })
  }

  let body
  try {
    body = await request.json()
  } catch (error) {
    console.error('[keyword-analyze] invalid json', error)
    return jsonResponse({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const imageUrls = normalizeImageInputs(body)
  if (imageUrls.length === 0) {
    return jsonResponse({ error: 'IMAGE_URL_REQUIRED', message: '이미지 URL이 없습니다.' }, { status: 400 })
  }

  const payloads = []
  const failedPayloads = []
  for (const url of imageUrls) {
    try {
      const payload = await resolveImagePayload(url, fetch)
      payloads.push({ url, payload })
    } catch (error) {
      console.error('[keyword-analyze] failed to resolve image payload', error)
      failedPayloads.push({ url, error: error instanceof Error ? error.message : String(error) })
    }
  }

  if (payloads.length === 0) {
    return jsonResponse({ error: 'IMAGE_RESOLVE_FAILED', message: '이미지를 불러오지 못했습니다.' }, { status: 400 })
  }

  const gemini = {
    success: false,
    keywords: [],
    keywordsByImage: [],
    commonKeywords: [],
    raw: '',
    error: '',
    errors: [],
  }

  const openai = {
    success: false,
    keywords: [],
    keywordsByImage: [],
    commonKeywords: [],
    title: '',
    raw: '',
    error: '',
    errors: [],
  }

  if (env?.GEMINI_API_KEY) {
    const geminiResults = await Promise.all(
      payloads.map(async ({ payload }, index) => {
        try {
          const result = await analyzeImageWithGemini(payload, env.GEMINI_API_KEY)
          gemini.keywordsByImage[index] = result.keywords
          return result
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          gemini.errors[index] = message
          console.error('[keyword-analyze] gemini image error', message)
          gemini.keywordsByImage[index] = []
          return null
        }
      }),
    )

    const perImageRaw = geminiResults
      .map((result, index) => `이미지 ${index + 1}: ${(result && result.raw) || gemini.errors[index] || ''}`)
      .join('\n\n')

    gemini.success = gemini.keywordsByImage.some((keywords) => keywords.length > 0)
    gemini.raw = perImageRaw

    if (gemini.success && payloads.length > 1) {
      try {
        const { keywords, raw } = await analyzeGeminiCommonKeywords(gemini.keywordsByImage, env.GEMINI_API_KEY)
        gemini.commonKeywords = keywords
        gemini.raw = `${perImageRaw}\n\n[공통]\n${raw}`.trim()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        gemini.errors.push(`common: ${message}`)
        console.error('[keyword-analyze] gemini common error', message)
      }
    }

    gemini.keywords = [...gemini.keywordsByImage.flat(), ...gemini.commonKeywords]
  } else {
    gemini.error = 'GEMINI_API_KEY_MISSING'
  }

  if (env?.OPENAI_API_KEY) {
    const openaiResults = await Promise.all(
      payloads.map(async ({ payload }, index) => {
        try {
          const result = await analyzeImageWithOpenAI(payload, env.OPENAI_API_KEY)
          openai.keywordsByImage[index] = result.keywords
          return result
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          openai.errors[index] = message
          console.error('[keyword-analyze] openai image error', message)
          openai.keywordsByImage[index] = []
          return null
        }
      }),
    )

    const perImageRaw = openaiResults
      .map((result, index) => `이미지 ${index + 1}: ${(result && result.raw) || openai.errors[index] || ''}`)
      .join('\n\n')

    openai.success = openai.keywordsByImage.some((keywords) => keywords.length > 0)
    openai.raw = perImageRaw

    if (openai.success) {
      try {
        const { keywords, title, raw } = await analyzeOpenAICommonKeywords(openai.keywordsByImage, env.OPENAI_API_KEY)
        openai.commonKeywords = keywords
        openai.title = cleanKeyword(title)
        openai.raw = `${perImageRaw}\n\n[공통]\n${raw}`.trim()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        openai.errors.push(`common: ${message}`)
        console.error('[keyword-analyze] openai common error', message)
      }
    }

    openai.keywords = [...openai.keywordsByImage.flat(), ...openai.commonKeywords]
  } else {
    openai.error = 'OPENAI_API_KEY_MISSING'
  }

  const seen = new Set()
  let finalKeywords = []

  const appendKeywords = (keywords) => {
    for (const keyword of keywords || []) {
      addKeywordUnique(finalKeywords, keyword, seen)
      if (finalKeywords.length >= KEYWORD_COUNT) {
        break
      }
    }
  }

  appendKeywords(openai.keywordsByImage.flat())
  appendKeywords(openai.commonKeywords)
  appendKeywords(gemini.keywordsByImage.flat())
  appendKeywords(gemini.commonKeywords)

  if (finalKeywords.length < KEYWORD_COUNT) {
    finalKeywords = ensureKeywordCount(finalKeywords, seen)
  } else {
    finalKeywords = finalKeywords.slice(0, KEYWORD_COUNT)
  }

  let finalTitle = openai.title || buildTitleFromKeywords(finalKeywords)

  if (!openai.success && gemini.success && !openai.title) {
    finalTitle = buildTitleFromKeywords([...gemini.commonKeywords, ...gemini.keywordsByImage.flat()])
  }

  const openaiSuccess = openai.success || (openai.commonKeywords.length > 0 && openai.title)
  const geminiSuccess = gemini.success || gemini.commonKeywords.length > 0

  if (!openaiSuccess && !geminiSuccess) {
    return jsonResponse(
      {
        error: 'ANALYSIS_FAILED',
        message: '분석 결과를 가져올 수 없습니다.',
        sources: { gemini, openai },
      },
      { status: 502 },
    )
  }

  const summaryParts = []
  summaryParts.push(`${payloads.length}개의 이미지를 분석했습니다.`)
  if (openaiSuccess) {
    const analyzedCount = openai.keywordsByImage.filter((keywords) => keywords.length > 0).length
    summaryParts.push(`OpenAI가 ${analyzedCount}개 이미지에서 키워드를 추출했습니다.`)
    if (openai.commonKeywords.length > 0) {
      summaryParts.push('OpenAI 공통 키워드를 반영했습니다.')
    }
  } else if (openai.error) {
    summaryParts.push('OpenAI 분석에 실패하여 Gemini 결과를 사용했습니다.')
  }

  if (geminiSuccess) {
    const analyzedCount = gemini.keywordsByImage.filter((keywords) => keywords.length > 0).length
    summaryParts.push(`Gemini가 ${analyzedCount}개 이미지에서 키워드를 추출했습니다.`)
    if (gemini.commonKeywords.length > 0) {
      summaryParts.push('Gemini 공통 키워드를 반영했습니다.')
    }
  } else if (gemini.error) {
    summaryParts.push('Gemini 분석에 실패하여 OpenAI 결과를 사용했습니다.')
  }

  if (failedPayloads.length > 0) {
    summaryParts.push(`${failedPayloads.length}개의 이미지는 불러오지 못했습니다.`)
  }

  const summary = summaryParts.join(' ')

  return jsonResponse({
    title: finalTitle,
    summary,
    keywords: finalKeywords,
    sources: {
      gemini,
      openai,
      failed: failedPayloads,
    },
  })
}
