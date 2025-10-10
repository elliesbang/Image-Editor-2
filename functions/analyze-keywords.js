const OPENAI_KEYWORD_FALLBACK_POOL = [
  '이미지',
  '사진',
  '디자인',
  '그래픽',
  '브랜딩',
  '콘텐츠',
  '마케팅',
  '소셜미디어',
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
  '크롭',
  '배경 제거',
  '비주얼',
  '크리에이티브',
  '트렌디',
  '감각적인',
  '현대적인',
  '컬러 팔레트',
  '하이라이트',
  '제품 촬영',
  '모델 컷',
  'SNS 콘텐츠',
  '웹디자인',
  'e커머스',
  '프리미엄',
  '상업용',
  '브랜드 아이덴티티',
  '컨셉 아트',
  '라이프스타일',
  '무드 보드',
  '스토리텔링',
]

const KEYWORD_TEXT_SPLIT_PATTERN = /[,\n，、·•|\/\\;:()\[\]{}<>!?！？]+/

function normalizeKeywordCandidate(keyword) {
  return keyword
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[#"'`•·\-]+/, '')
    .replace(/[#"'`•·\-]+$/, '')
    .trim()
}

function collectKeywordsFromRaw(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item : String(item ?? '')))
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  }
  if (typeof raw === 'string') {
    return raw
      .split(KEYWORD_TEXT_SPLIT_PATTERN)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  }
  return []
}

function extractKeywordTokensFromText(text) {
  if (typeof text !== 'string') return []
  const trimmed = text.trim()
  if (!trimmed) return []
  const tokens = new Set()

  const normalizedWhole = normalizeKeywordCandidate(trimmed)
  if (normalizedWhole.length >= 2) {
    tokens.add(normalizedWhole)
  }

  const segments = trimmed.split(KEYWORD_TEXT_SPLIT_PATTERN)
  for (const segment of segments) {
    const normalizedSegment = normalizeKeywordCandidate(segment)
    if (!normalizedSegment || normalizedSegment.length < 2) {
      continue
    }
    tokens.add(normalizedSegment)

    const words = normalizedSegment.split(/\s+/)
    if (words.length > 1 && words.length <= 4) {
      tokens.add(words.join(' '))
    }
    for (const word of words) {
      const normalizedWord = normalizeKeywordCandidate(word)
      if (normalizedWord.length >= 2) {
        tokens.add(normalizedWord)
      }
    }
  }

  return Array.from(tokens).filter((value) => value.length >= 2 && value.length <= 32)
}

function buildKeywordListFromOpenAI(raw, context) {
  const keywords = []
  const seen = new Set()

  const pushKeyword = (value) => {
    const normalized = normalizeKeywordCandidate(typeof value === 'string' ? value : String(value ?? ''))
    if (!normalized) return
    if (normalized.length > 48) return
    if (seen.has(normalized)) return
    seen.add(normalized)
    keywords.push(normalized)
  }

  for (const candidate of collectKeywordsFromRaw(raw)) {
    pushKeyword(candidate)
  }

  if (keywords.length < 25) {
    const contextTokens = [
      ...extractKeywordTokensFromText(context.title),
      ...extractKeywordTokensFromText(context.summary),
      ...extractKeywordTokensFromText(context.name),
    ]
    for (const token of contextTokens) {
      pushKeyword(token)
      if (keywords.length >= 25) {
        break
      }
    }
  }

  if (keywords.length < 25) {
    for (const fallback of OPENAI_KEYWORD_FALLBACK_POOL) {
      pushKeyword(fallback)
      if (keywords.length >= 25) {
        break
      }
    }
  }

  let fillerIndex = 1
  while (keywords.length < 25) {
    pushKeyword(`키워드 ${fillerIndex}`)
    fillerIndex += 1
  }

  return keywords.slice(0, 25)
}

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

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 })
  }

  let apiKey = ''
  try {
    if (typeof process !== 'undefined' && process?.env && typeof process.env.OPENAI_API_KEY === 'string') {
      apiKey = process.env.OPENAI_API_KEY.trim()
    }
  } catch (error) {
    console.warn('[functions/analyze-keywords] process.env access failed', error)
  }

  if (!apiKey && typeof env?.OPENAI_API_KEY === 'string') {
    apiKey = env.OPENAI_API_KEY.trim()
  }

  if (!apiKey) {
    return jsonResponse({ error: 'API_KEY_MISSING', message: 'API 키가 감지되지 않음' }, { status: 401 })
  }

  let payload
  try {
    payload = await request.json()
  } catch (error) {
    console.error('[functions/analyze-keywords] invalid json', error)
    return jsonResponse({ error: 'INVALID_JSON_BODY' }, { status: 400 })
  }

  const imageDataInput = typeof payload?.image === 'string' ? payload.image.trim() : ''
  const directImageUrl = typeof payload?.imageUrl === 'string' ? payload.imageUrl.trim() : ''

  if (!imageDataInput && !directImageUrl) {
    return jsonResponse({ error: 'IMAGE_DATA_URL_REQUIRED' }, { status: 400 })
  }

  let imageUrl = ''
  if (directImageUrl) {
    imageUrl = directImageUrl
  } else {
    if (!imageDataInput.startsWith('data:image')) {
      return jsonResponse({ error: 'IMAGE_DATA_URL_REQUIRED' }, { status: 400 })
    }
    const base64Source = imageDataInput.replace(/^data:[^;]+;base64,/, '')
    imageUrl = imageDataInput.startsWith('data:') ? imageDataInput : `data:image/png;base64,${base64Source}`
  }

  const requestedName = typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim() : '이미지'

  const systemPrompt = `당신은 한국어 기반의 시각 콘텐츠 마케터입니다. 이미지를 분석하여 SEO에 최적화된 메타데이터를 작성하세요.
반드시 JSON 포맷으로만 응답하고, 형식은 다음과 같습니다:
{
  "title": "SEO 최적화 제목 (60자 이내)",
  "summary": "이미지 특징과 활용 맥락을 간결히 설명한 문장 (120자 이내)",
  "keywords": ["키워드1", "키워드2", ..., "키워드25"]
}
조건:
- keywords 배열은 정확히 25개의 한글 키워드로 구성합니다.
- 제목은 한국어로 작성하고, '미리캔버스'를 활용하는 마케터가 검색할 법한 문구를 넣습니다.
- 요약은 이미지의 메시지, 분위기, 활용처를 한 문장으로 설명합니다.
- 필요 시 색상, 분위기, 활용 매체 등을 키워드에 조합합니다.`

  const userInstruction = `다음 이미지를 분석하여 한국어 키워드 25개와 SEO 제목, 요약을 JSON 형식으로 작성해 주세요.
이미지 파일명: ${requestedName}`

  const responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'SeoMetadata',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'keywords'],
        properties: {
          title: {
            type: 'string',
            description: 'SEO 최적화 제목 (한국어, 60자 이내)',
            maxLength: 120,
          },
          summary: {
            type: 'string',
            description: '이미지 특징과 활용 맥락을 설명하는 문장 (120자 이내)',
            maxLength: 240,
          },
          keywords: {
            type: 'array',
            description: '정확히 25개의 한국어 키워드',
            minItems: 25,
            maxItems: 25,
            items: {
              type: 'string',
              minLength: 1,
              maxLength: 48,
            },
          },
        },
      },
    },
  }

  const requestId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`)

  try {
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.6,
        top_p: 0.9,
        response_format: responseFormat,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userInstruction },
              { type: 'input_image', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    })

    if (!openaiResponse.ok) {
      const detailText = await openaiResponse.text()
      console.error('[functions/analyze-keywords] openai request failed', openaiResponse.status, detailText)
      return jsonResponse(
        { error: 'OPENAI_REQUEST_FAILED', status: openaiResponse.status, message: 'API 키가 감지되지 않음', requestId },
        { status: 502 },
      )
    }

    let result
    try {
      result = await openaiResponse.json()
    } catch (error) {
      console.error('[functions/analyze-keywords] failed to parse OpenAI JSON', error)
      return jsonResponse({ error: 'OPENAI_RESPONSE_INVALID', message: 'API 키가 감지되지 않음', requestId }, { status: 502 })
    }

    const model = typeof result?.model === 'string' ? result.model : 'gpt-4o-mini'
    const choice = Array.isArray(result?.choices) ? result.choices[0] : null
    const messageContent = choice?.message?.content
    if (!messageContent) {
      console.error('[functions/analyze-keywords] missing message content', result)
      return jsonResponse({ error: 'OPENAI_MESSAGE_MISSING', message: 'API 키가 감지되지 않음', requestId }, { status: 502 })
    }

    let parsed
    if (typeof messageContent === 'string') {
      try {
        parsed = JSON.parse(messageContent)
      } catch (error) {
        console.error('[functions/analyze-keywords] failed to parse content string', error, messageContent)
        return jsonResponse({ error: 'OPENAI_CONTENT_INVALID', message: 'API 키가 감지되지 않음', requestId }, { status: 502 })
      }
    } else if (Array.isArray(messageContent)) {
      const joined = messageContent
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
      try {
        parsed = JSON.parse(joined)
      } catch (error) {
        console.error('[functions/analyze-keywords] failed to parse content parts', error, joined)
        return jsonResponse({ error: 'OPENAI_CONTENT_INVALID', message: 'API 키가 감지되지 않음', requestId }, { status: 502 })
      }
    } else {
      console.error('[functions/analyze-keywords] unsupported content format', messageContent)
      return jsonResponse({ error: 'OPENAI_CONTENT_UNSUPPORTED', message: 'API 키가 감지되지 않음', requestId }, { status: 502 })
    }

    const rawTitle = typeof parsed?.title === 'string' ? parsed.title.trim() : ''
    const rawSummary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
    const keywords = buildKeywordListFromOpenAI(parsed?.keywords, {
      title: rawTitle,
      summary: rawSummary,
      name: requestedName,
    })

    const fallbackTitle = `${requestedName} 이미지 SEO 제목`
    const fallbackSummary = `${requestedName}의 특징을 설명하는 요약 콘텐츠입니다.`

    const safeTitle = (rawTitle || fallbackTitle).slice(0, 120)
    const safeSummary = (rawSummary || fallbackSummary).slice(0, 240)

    return jsonResponse({
      title: safeTitle,
      summary: safeSummary,
      keywords,
      provider: 'openai',
      model,
      requestId: typeof result?.id === 'string' ? result.id : requestId,
    })
  } catch (error) {
    console.error('[functions/analyze-keywords] unhandled error', error)
    return jsonResponse({ error: 'OPENAI_UNHANDLED_ERROR', message: 'API 키가 감지되지 않음', requestId }, { status: 502 })
  }
}
