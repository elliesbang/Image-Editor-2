const FALLBACK_KEYWORDS = [
  '그래픽',
  '브랜딩',
  '콘텐츠',
  '소셜미디어',
  '프로모션',
  '브랜드',
  '썸네일',
  '배너',
  '프레젠테이션',
  '템플릿',
  '고화질',
  '크롭',
  '비주얼',
  '크리에이티브',
  '트렌디',
  '감각적인',
  '현대적인',
  '하이라이트',
  '제품 촬영',
  '모델 컷',
  'SNS 콘텐츠',
  'e커머스',
  '프리미엄',
  '브랜드 아이덴티티',
  '컨셉 아트',
  '라이프스타일',
  '무드 보드',
  '스토리텔링',
  '프로덕트',
  '소셜 캠페인',
  '브랜드 캠페인',
  '비주얼 아이덴티티',
  '랜딩페이지',
  '콘텐츠 전략',
  '온라인 쇼핑',
  '트렌드',
  '스타일링',
  '크리에이터',
  '비즈니스',
  '세일즈',
  '프리미엄 감성',
  '하이라이트 조명',
  '브랜드 스토리',
  '라이프스타일 무드',
]

const BANNED_KEYWORD_FRAGMENTS = [
  '비율',
  '톤',
  '팔레트',
  '색상코드',
  '픽셀',
  '배경',
  '구도',
  '정렬',
  '디자인',
  '상품',
  '포스터',
  '마케팅',
  '광고',
  '이미지',
  'ai',
  '일러스트',
  '파일',
  '사진',
]

const BANNED_KEYWORD_LABEL = BANNED_KEYWORD_FRAGMENTS.map((fragment) =>
  fragment === 'ai' ? 'AI' : fragment,
).join(', ')

const KEYWORD_RULE_PROMPT =
  '여러 장의 장면이 함께 제공되면 하나의 세트로 보고 공통된 시각 요소를 반영해. ' +
  '원본과 편집된 결과물이 함께 보이면 모두 참고해 공통 맥락을 정리해. ' +
  '눈에 보이는 사물·인물·공간·색감·질감·문자·기호 중심으로 한글 키워드를 작성하고, ' +
  '추상적 감정이나 해석형 표현은 최대 5개까지만 포함해. ' +
  `다음 금지어는 절대 포함하지 마: ${BANNED_KEYWORD_LABEL}. ` +
  '숫자나 특수기호는 실제 시각 요소로 확인될 때에만 그대로 사용해.'

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
  const lower = keyword.toLowerCase()
  if (BANNED_KEYWORD_FRAGMENTS.some((fragment) => lower.includes(fragment))) return
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

  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : ''
  if (!imageUrl) {
    return jsonResponse({ error: 'IMAGE_URL_REQUIRED', message: '이미지 URL이 없습니다.' }, { status: 400 })
  }

  let imagePayload
  try {
    imagePayload = await resolveImagePayload(imageUrl, fetch)
  } catch (error) {
    console.error('[keyword-analyze] failed to resolve image payload', error)
    return jsonResponse({ error: 'IMAGE_RESOLVE_FAILED', message: '이미지를 불러오지 못했습니다.' }, { status: 400 })
  }

  const gemini = {
    success: false,
    keywords: [],
    raw: '',
    error: '',
  }

  const openai = {
    success: false,
    keywords: [],
    title: '',
    raw: '',
    error: '',
  }

  if (env?.GEMINI_API_KEY) {
    try {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${env.GEMINI_API_KEY}`,
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
                    text: `${KEYWORD_RULE_PROMPT} 눈에 보이는 요소를 기반으로 한국어 키워드 50개를 생성하고 쉼표로 구분해.`,
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
          }),
        },
      )

      if (!geminiResponse.ok) {
        const detail = await geminiResponse.json().catch(() => null)
        const message = detail?.error?.message || `Gemini API 오류(${geminiResponse.status})`
        throw new Error(message)
      }

      const geminiData = await geminiResponse.json()
      const text = geminiData?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n') || ''
      gemini.raw = text
      gemini.keywords = parseGeminiKeywords(text)
      gemini.success = gemini.keywords.length > 0
    } catch (error) {
      gemini.error = error instanceof Error ? error.message : String(error)
      console.error('[keyword-analyze] gemini error', error)
    }
  } else {
    gemini.error = 'GEMINI_API_KEY_MISSING'
  }

  if (env?.OPENAI_API_KEY) {
    try {
      const dataUrlForOpenAI = imagePayload.dataUrl
      const userContent = []
      if (gemini.success) {
        userContent.push({
          type: 'text',
          text: `다음 키워드를 참고해서 중복 없이 핵심적인 SEO 키워드 25개와 자연스럽고 매력적인 제목 1개를 한국어로 작성해줘. ${KEYWORD_RULE_PROMPT} 키워드는 번호와 함께 줄바꿈으로 구분해줘: ${gemini.keywords
            .slice(0, 50)
            .join(', ')}`,
        })
      } else {
        userContent.push({
          type: 'text',
          text: `이 이미지를 분석해 핵심 SEO 키워드 25개와 자연스러운 SEO 제목 1개를 한국어로 작성해줘. ${KEYWORD_RULE_PROMPT} 키워드는 번호와 함께 줄바꿈으로 구분해줘.`,
        })
      }
      userContent.push({
        type: 'image_url',
        image_url: {
          url: dataUrlForOpenAI,
        },
      })

      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.6,
          max_tokens: 800,
          messages: [
            {
              role: 'system',
              content: `너는 미리캔버스 SEO 전문가야. ${KEYWORD_RULE_PROMPT} 이미지를 기반으로 중복 없는 핵심 SEO 키워드 25개와 간결하면서 매력적인 한국어 SEO 제목 1개를 반드시 만들어. 응답은 명확하게 키워드와 제목을 구분해서 제공해.`,
            },
            {
              role: 'user',
              content: userContent,
            },
          ],
        }),
      })

      if (!openaiResponse.ok) {
        const detail = await openaiResponse.json().catch(() => null)
        const message = detail?.error?.message || `OpenAI API 오류(${openaiResponse.status})`
        throw new Error(message)
      }

      const openaiData = await openaiResponse.json()
      const content = openaiData?.choices?.[0]?.message?.content
      openai.raw = typeof content === 'string' ? content : ''
      const parsed = parseOpenAIContent(content)
      openai.keywords = parsed.keywords
      openai.title = parsed.title
      openai.success = openai.keywords.length > 0 && !!openai.title
    } catch (error) {
      openai.error = error instanceof Error ? error.message : String(error)
      console.error('[keyword-analyze] openai error', error)
    }
  } else {
    openai.error = 'OPENAI_API_KEY_MISSING'
  }

  const seen = new Set()
  let finalKeywords = []
  let finalTitle = ''

  if (openai.success) {
    for (const keyword of openai.keywords) {
      addKeywordUnique(finalKeywords, keyword, seen)
    }
    finalTitle = cleanKeyword(openai.title)
  }

  if (finalKeywords.length < KEYWORD_COUNT && gemini.keywords.length > 0) {
    for (const keyword of gemini.keywords) {
      if (finalKeywords.length >= KEYWORD_COUNT) break
      addKeywordUnique(finalKeywords, keyword, seen)
    }
  }

  if (finalKeywords.length < KEYWORD_COUNT) {
    finalKeywords = ensureKeywordCount(finalKeywords, seen)
  } else {
    finalKeywords = finalKeywords.slice(0, KEYWORD_COUNT)
  }

  if (!finalTitle) {
    if (gemini.keywords.length > 0) {
      const headline = gemini.keywords.slice(0, 3).join(' · ')
      finalTitle = headline ? `${headline} 감성 이미지` : '이미지 SEO 키워드 추천'
    } else if (finalKeywords.length > 0) {
      const headline = finalKeywords.slice(0, 3).join(' · ')
      finalTitle = headline ? `${headline} 이미지 키워드` : '이미지 SEO 키워드 추천'
    } else {
      finalTitle = '이미지 SEO 키워드 추천'
    }
  }

  const openaiSuccess = openai.success
  const geminiSuccess = gemini.success

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
  if (geminiSuccess && openaiSuccess) {
    summaryParts.push('Gemini 키워드를 기반으로 OpenAI가 최종 결과를 생성했습니다.')
  } else if (openaiSuccess) {
    summaryParts.push('OpenAI가 이미지 분석을 통해 결과를 생성했습니다.')
  } else if (geminiSuccess) {
    summaryParts.push('Gemini 키워드를 정제하여 결과를 생성했습니다.')
  }

  const summary = summaryParts.join(' ')

  return jsonResponse({
    title: finalTitle,
    summary,
    keywords: finalKeywords,
    sources: {
      gemini,
      openai,
    },
  })
}
