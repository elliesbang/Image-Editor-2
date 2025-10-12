import OpenAI from 'openai'

const MODEL = 'gpt-4o-mini'
const TEMPERATURE = 0.3
const MAX_COMBINED_KEYWORDS = 25

const SYSTEM_PROMPT = `너는 시각적 데이터 분석 전문가야.
사용자가 여러 장의 이미지를 업로드하면 다음 순서로 분석해.

1️⃣ **공통 키워드(common_keywords)**
- 모든 이미지에서 겹치는 특징만 요약해 5~10개의 핵심 키워드로 작성.
- 실제 눈에 보이는 시각적 요소 중심 (사물, 배경, 색상, 분위기 등).

2️⃣ **각 이미지별 키워드(image_keywords)**
- 각 이미지마다 독립적으로 주요 특징을 3~5개씩 추출.
- 공통 키워드에 포함된 단어는 중복하지 말고, 각 이미지의 독특한 부분만 담아.

3️⃣ **통합 키워드(combined_keywords)**
- 공통 키워드와 개별 키워드를 통합해서 총 25개 키워드로 정리.
- 중복 단어 제거 후 중요도 순으로 배열.
- 반드시 **한국어 쉼표 구분 키워드 25개만**.

4️⃣ **제목(title)**
- 공통 키워드 2~3개를 조합해서 감각적이고 간결한 제목을 만들어.
- 10자 이내, 문장형이 아닌 명사형 제목.
  (예: “바다의 기억”, “봄날의 거리”, “푸른 정원”)

출력은 반드시 아래 JSON 형식만 사용해:
{
  "common_keywords": ["", "", ...],
  "image_keywords": [
    ["", "", ...],
    ["", "", ...]
  ],
  "combined_keywords": ["", "", ...],
  "title": ""
}`

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

function arrayBufferToBase64(buffer) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64')
  }
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function buildUserPrompt(files) {
  const descriptionLines = [
    `사용자가 총 ${files.length}장의 이미지를 업로드했습니다.`,
    '각 이미지를 시각적으로 분석하여 요구 조건을 충족하는 JSON을 생성하세요.',
    '이미지 정보:',
  ]
  files.forEach((file, index) => {
    const label = file.name ? `${file.name}` : `이미지 ${index + 1}`
    const typeInfo = file.type ? ` (${file.type})` : ''
    descriptionLines.push(`- 이미지 ${index + 1}: ${label}${typeInfo}`)
  })
  descriptionLines.push('출력은 반드시 지정된 JSON 형식만 사용하세요.')
  return descriptionLines.join('\n')
}

function extractJsonBlock(text) {
  if (typeof text !== 'string') return ''
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : text
}

function normalizeKeywordList(list, limit = Infinity) {
  if (!Array.isArray(list)) return []
  const normalized = []
  const seen = new Set()
  for (const item of list) {
    const keyword = typeof item === 'string' ? item.trim() : String(item ?? '').trim()
    if (!keyword) continue
    if (seen.has(keyword)) continue
    seen.add(keyword)
    normalized.push(keyword)
    if (normalized.length >= limit) break
  }
  return normalized
}

function normalizeImageKeywords(groups) {
  if (!Array.isArray(groups)) return []
  return groups.map((group) => normalizeKeywordList(group))
}

function validateResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('INVALID_RESPONSE_FORMAT')
  }
  const commonKeywords = normalizeKeywordList(result.common_keywords, 10)
  const imageKeywords = normalizeImageKeywords(result.image_keywords)
  const combinedKeywords = normalizeKeywordList(result.combined_keywords, MAX_COMBINED_KEYWORDS)
  const title = typeof result.title === 'string' ? result.title.trim() : ''

  if (commonKeywords.length === 0 || imageKeywords.length === 0 || combinedKeywords.length === 0 || !title) {
    throw new Error('MISSING_KEYWORD_FIELDS')
  }

  return {
    common_keywords: commonKeywords,
    image_keywords: imageKeywords,
    combined_keywords: combinedKeywords.slice(0, MAX_COMBINED_KEYWORDS),
    title,
  }
}

export const onRequestPost = async ({ request, env }) => {
  try {
    const apiKey = env?.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY_MISSING')
    }

    const formData = await request.formData()
    const files = []
    for (const value of formData.values()) {
      if (value instanceof File && value.size > 0) {
        files.push(value)
      }
    }

    if (files.length === 0) {
      throw new Error('NO_IMAGES_PROVIDED')
    }

    const preparedImages = await Promise.all(
      files.map(async (file) => {
        const buffer = await file.arrayBuffer()
        const base64 = arrayBufferToBase64(buffer)
        const mimeType = file.type || 'application/octet-stream'
        return {
          name: file.name || undefined,
          type: mimeType,
          dataUrl: `data:${mimeType};base64,${base64}`,
        }
      })
    )

    const client = new OpenAI({ apiKey })

    const userContent = [
      { type: 'text', text: buildUserPrompt(files) },
      ...preparedImages.map((image) => ({
        type: 'input_image',
        image_url: { url: image.dataUrl },
      })),
    ]

    const response = await client.responses.create({
      model: MODEL,
      temperature: TEMPERATURE,
      input: [
        {
          role: 'system',
          content: [{ type: 'text', text: SYSTEM_PROMPT }],
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    })

    const rawText = response?.output_text?.trim()
    if (!rawText) {
      throw new Error('EMPTY_OPENAI_RESPONSE')
    }

    const jsonText = extractJsonBlock(rawText)
    let parsed
    try {
      parsed = JSON.parse(jsonText)
    } catch (error) {
      throw new Error('OPENAI_JSON_PARSE_ERROR')
    }

    const normalized = validateResult(parsed)

    return jsonResponse(normalized, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    return jsonResponse({ error: 'KEYWORD_ANALYSIS_FAILED', message }, { status: 500 })
  }
}
