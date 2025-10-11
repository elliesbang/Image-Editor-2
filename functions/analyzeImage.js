const FALLBACK_KEYWORDS = [
  '수채화 배경',
  '파스텔 감성',
  '빈티지 질감',
  '모던 그래픽',
  '미니멀 디자인',
  '봄 꽃 패턴',
  '드라마틱 라이팅',
  '따뜻한 톤',
  '차분한 분위기',
  '북유럽 스타일',
  '자연 질감',
  '보타니컬 일러스트',
  '차콜 스케치',
  '골드 포일 포인트',
  '페일 핑크',
  '그라데이션 하늘',
  '필름 카메라 무드',
  '따뜻한 조명',
  '라이트 브라운',
  '딥 블루 악센트',
  '캘리그래피 타이틀',
  '리넨 텍스처',
  '라이트 베이지 배경',
  '청량한 컬러',
  '네온 포인트',
  '세련된 구성',
  '감성적인 연출',
  '클래식 패턴',
  '빈티지 포스터',
  '로맨틱 플로럴',
  '우아한 실루엣',
  '메탈릭 하이라이트',
  '러프 브러시 스트로크',
  '부드러운 그라데이션',
  '모노톤 팔레트',
  '대비감 있는 쉐도우',
  '고급스러운 분위기',
  '햇살 가득',
  '차가운 톤',
  '딥 그린 포인트',
  '우디 텍스처',
  '미묘한 명암',
  '꿈결 같은',
  '자연광 연출',
  '트렌디 무드',
  '산뜻한 파스텔',
  '포근한 컬러',
  '감각적인 비주얼',
]

function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {})
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  headers.set('cache-control', 'no-store')
  if (!headers.has('Access-Control-Allow-Origin')) {
    headers.set('Access-Control-Allow-Origin', '*')
  }
  return new Response(JSON.stringify(body), { ...init, headers })
}

function resolveOpenAIApiKey(env) {
  if (!env || typeof env !== 'object') {
    return { key: '', source: 'unavailable' }
  }

  const candidateNames = [
    'OPENAI_API_KEY',
    'openai_api_key',
    'openaiApiKey',
    'openaiApi',
    'OPENAI_APIKEY',
    'OPENAI_KEY',
    'openaiKey',
    'GPT5_VISION_API_KEY',
    'gpt5VisionApiKey',
    'apiKey',
    'API_KEY',
  ]

  for (const name of candidateNames) {
    const value = env[name]
    if (typeof value === 'string' && value.trim()) {
      const trimmed = value.trim()
      if (!env.OPENAI_API_KEY) {
        try {
          // eslint-disable-next-line no-param-reassign
          env.OPENAI_API_KEY = trimmed
        } catch (_) {
          // ignore assignment errors on read-only bindings
        }
      }
      return { key: trimmed, source: name }
    }
  }

  return { key: '', source: 'missing' }
}

function buildErrorResponse({ error, message, requestId, status = 502 }) {
  return jsonResponse(
    {
      error,
      message,
      requestId,
    },
    { status },
  )
}

function normalizeKeyword(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[#"'`•·\-]+/, '')
    .replace(/[#"'`•·\-]+$/, '')
    .trim()
}

function finalizeKeywords(rawKeywords = []) {
  const seen = new Set()
  const keywords = []

  const push = (candidate) => {
    const normalized = normalizeKeyword(candidate)
    if (!normalized) return
    if (normalized.length < 2 || normalized.length > 48) return
    if (seen.has(normalized)) return
    seen.add(normalized)
    keywords.push(normalized)
  }

  for (const keyword of rawKeywords) {
    push(keyword)
    if (keywords.length === 25) break
  }

  if (keywords.length < 25) {
    for (const fallback of FALLBACK_KEYWORDS) {
      push(fallback)
      if (keywords.length === 25) break
    }
  }

  if (keywords.length < 25) {
    const baseLength = keywords.length
    for (let i = 0; keywords.length < 25; i += 1) {
      push(`${FALLBACK_KEYWORDS[i % FALLBACK_KEYWORDS.length]} ${i + baseLength + 1}`)
    }
  }

  return keywords.slice(0, 25)
}

function parseJsonBody(request) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return null
  }
  return request
    .json()
    .then((data) => (typeof data === 'object' && data !== null ? data : null))
    .catch(() => null)
}

function isDataUrl(value) {
  return /^data:image\//i.test(value || '')
}

export async function onRequestPost(context) {
  const { request, env } = context

  const body = await parseJsonBody(request)
  if (!body) {
    return jsonResponse({ error: 'INVALID_JSON_BODY' }, { status: 400 })
  }

  const imageDataUrl = typeof body.image === 'string' ? body.image : ''
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : ''
  const imageName = typeof body.name === 'string' ? body.name.trim() : ''

  if (!imageDataUrl && !imageUrl) {
    return jsonResponse({ error: 'IMAGE_REQUIRED' }, { status: 400 })
  }

  if (imageDataUrl && !isDataUrl(imageDataUrl)) {
    return jsonResponse({ error: 'INVALID_IMAGE_DATA_URL' }, { status: 400 })
  }

  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`

  const { key: apiKey, source: keySource } = resolveOpenAIApiKey(env)

  if (!apiKey) {
    console.error('[functions/analyzeImage] API Key가 로드되지 않았습니다.', {
      source: keySource,
    })
    return buildErrorResponse({
      error: 'API_KEY_MISSING',
      message: 'API 키 인증 오류 또는 연결 실패',
      requestId,
      status: 401,
    })
  }

  if (keySource !== 'OPENAI_API_KEY') {
    console.log('[functions/analyzeImage] Resolved OPENAI_API_KEY from alternate binding', {
      source: keySource,
    })
  }

  const systemPrompt = `너는 한국어 SEO 전문가이자 비주얼 디자이너야. 사용자가 전달한 이미지를 보고 디자인 플랫폼(미리캔버스, 캔바, 툴디 등)에 업로드했을 때 검색 노출에 유리한 25개의 한국어 키워드를 도출해. 키워드는 명사 또는 형용사 위주로 구성하고, 스타일·색감·소재·감정·분위기·카테고리 등을 폭넓게 포괄해야 해. 모든 출력은 한국어여야 한다.`

  const analysisContext = imageName ? `이미지 이름: ${imageName}` : '이미지 이름이 제공되지 않았습니다.'

  const userInstruction = `다음 이미지를 분석하여 한국어 키워드 25개와 대표 제목을 생성해. 결과는 반드시 JSON으로 반환하고, 키워드는 중복 없이 25개여야 해.`

  const responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'VisionKeywordResponse',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'keywords'],
        properties: {
          title: {
            type: 'string',
            description: '이미지의 SEO에 적합한 대표 제목',
            minLength: 1,
            maxLength: 120,
          },
          keywords: {
            type: 'array',
            description: '이미지 SEO를 위한 한국어 키워드 25개',
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

  const contentBlocks = [
    { type: 'text', text: `${userInstruction}\n\n${analysisContext}` },
  ]

  if (imageDataUrl) {
    contentBlocks.push({ type: 'input_image', image_url: { url: imageDataUrl } })
  } else if (imageUrl) {
    contentBlocks.push({ type: 'input_image', image_url: { url: imageUrl } })
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.5,
        top_p: 0.9,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: contentBlocks,
          },
        ],
        response_format: responseFormat,
      }),
    })

    const responseText = await response.text()
    let result

    if (responseText) {
      try {
        result = JSON.parse(responseText)
      } catch (parseError) {
        console.error('[functions/analyzeImage] Failed to parse OpenAI response body', parseError, responseText)
      }
    }

    if (!response.ok) {
      const isUnauthorized = response.status === 401 || response.status === 403
      const messageFromBody = typeof result?.message === 'string' ? result.message.trim() : ''
      const message = messageFromBody
        || (isUnauthorized ? 'API 키 인증 오류 또는 연결 실패' : '분석 기능이 일시적으로 중지되었습니다.')

      console.error('[functions/analyzeImage] OpenAI request failed', {
        status: response.status,
        label: isUnauthorized ? 'Unauthorized' : `HTTP_${response.status}`,
        detail: responseText || null,
        requestId,
      })

      return buildErrorResponse({
        error: isUnauthorized ? 'OPENAI_UNAUTHORIZED' : 'OPENAI_REQUEST_FAILED',
        message,
        requestId,
        status: isUnauthorized ? 401 : 502,
      })
    }

    if (!result) {
      console.error('[functions/analyzeImage] Empty response payload', { responseText, requestId })
      return buildErrorResponse({
        error: 'OPENAI_EMPTY_RESPONSE',
        message: '분석 기능이 일시적으로 중지되었습니다.',
        requestId,
      })
    }

    const messageContent = result?.choices?.[0]?.message?.content

    if (!messageContent) {
      console.error('[functions/analyzeImage] Missing message content', { result, requestId })
      return buildErrorResponse({
        error: 'OPENAI_EMPTY_RESPONSE',
        message: '분석 기능이 일시적으로 중지되었습니다.',
        requestId,
      })
    }

    let parsed
    if (typeof messageContent === 'string') {
      try {
        parsed = JSON.parse(messageContent)
      } catch (parseError) {
        console.error('[functions/analyzeImage] Failed to parse string content', parseError, messageContent)
        return buildErrorResponse({
          error: 'OPENAI_RESPONSE_INVALID',
          message: '분석 기능이 일시적으로 중지되었습니다.',
          requestId,
        })
      }
    } else if (Array.isArray(messageContent)) {
      const text = messageContent.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
      try {
        parsed = JSON.parse(text)
      } catch (parseError) {
        console.error('[functions/analyzeImage] Failed to parse segmented content', parseError, text)
        return buildErrorResponse({
          error: 'OPENAI_RESPONSE_INVALID',
          message: '분석 기능이 일시적으로 중지되었습니다.',
          requestId,
        })
      }
    } else {
      console.error('[functions/analyzeImage] Unsupported content format', { messageContent, requestId })
      return buildErrorResponse({
        error: 'OPENAI_RESPONSE_INVALID',
        message: '분석 기능이 일시적으로 중지되었습니다.',
        requestId,
      })
    }

    const rawTitle = typeof parsed?.title === 'string' ? parsed.title.trim() : ''
    const rawKeywords = Array.isArray(parsed?.keywords) ? parsed.keywords : []

    const title = rawTitle || (imageName ? `${imageName} 대표 제목` : '이미지 기반 SEO 대표 제목')
    const keywords = finalizeKeywords(rawKeywords)

    return jsonResponse({
      title,
      keywords,
      requestId: typeof result?.id === 'string' ? result.id : requestId,
      provider: 'openai',
      model: typeof result?.model === 'string' ? result.model : 'gpt-4o',
    })
  } catch (error) {
    const isNetworkError = error?.name === 'TypeError' || /fetch/i.test(error?.message || '')
    const label = isNetworkError ? 'FetchError' : error?.name || 'UnhandledError'
    console.error('[functions/analyzeImage] Unexpected error', { label, error, requestId })
    return buildErrorResponse({
      error: 'OPENAI_UNHANDLED_ERROR',
      message: isNetworkError ? '분석 기능이 일시적으로 중지되었습니다.' : '분석 기능이 일시적으로 중지되었습니다.',
      requestId,
      status: isNetworkError ? 502 : 500,
    })
  }
}
