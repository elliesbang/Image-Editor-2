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
  return new Response(JSON.stringify(body), { ...init, headers })
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

  const apiKey = env.OPENAI_API_KEY || env.GPT5_VISION_API_KEY
  if (!apiKey) {
    return jsonResponse({ error: 'API_KEY_MISSING' }, { status: 500 })
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

  const requestId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-vision',
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

    if (!response.ok) {
      const detail = await response.text()
      console.error('[functions/analyzeImage] OpenAI request failed', response.status, detail)
      return jsonResponse({ error: 'OPENAI_REQUEST_FAILED', requestId }, { status: 502 })
    }

    const result = await response.json()
    const messageContent = result?.choices?.[0]?.message?.content

    if (!messageContent) {
      console.error('[functions/analyzeImage] Missing message content', result)
      return jsonResponse({ error: 'OPENAI_EMPTY_RESPONSE', requestId }, { status: 502 })
    }

    let parsed
    if (typeof messageContent === 'string') {
      try {
        parsed = JSON.parse(messageContent)
      } catch (error) {
        console.error('[functions/analyzeImage] Failed to parse string content', error, messageContent)
        return jsonResponse({ error: 'OPENAI_RESPONSE_INVALID', requestId }, { status: 502 })
      }
    } else if (Array.isArray(messageContent)) {
      const text = messageContent.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        console.error('[functions/analyzeImage] Failed to parse segmented content', error, text)
        return jsonResponse({ error: 'OPENAI_RESPONSE_INVALID', requestId }, { status: 502 })
      }
    } else {
      console.error('[functions/analyzeImage] Unsupported content format', messageContent)
      return jsonResponse({ error: 'OPENAI_RESPONSE_INVALID', requestId }, { status: 502 })
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
      model: typeof result?.model === 'string' ? result.model : 'gpt-5-vision',
    })
  } catch (error) {
    console.error('[functions/analyzeImage] Unexpected error', error)
    return jsonResponse({ error: 'OPENAI_UNHANDLED_ERROR', requestId }, { status: 500 })
  }
}
