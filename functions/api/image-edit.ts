import type { PagesFunction } from '@cloudflare/workers-types'

const OPENAI_API_URL = 'https://api.openai.com/v1/images/edits'

type JsonBody = {
  error?: string
  message?: string
  image?: string
}

function jsonResponse(data: JsonBody, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

async function callOpenAI(formData: FormData, apiKey: string) {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('[image-edit] openai request failed', response.status, detail)
    throw new Error('OPENAI_REQUEST_FAILED')
  }

  const result = await response.json()
  const image = result?.data?.[0]?.b64_json
  if (typeof image !== 'string' || image.length === 0) {
    throw new Error('OPENAI_INVALID_RESPONSE')
  }
  return image
}

async function handleRemoveBackground(image: File, apiKey: string) {
  const formData = new FormData()
  formData.append('model', 'gpt-image-1')
  formData.append('image', image, image.name || 'image.png')
  formData.append(
    'prompt',
    'Remove the background completely and return only the subject with a perfectly transparent background. Preserve all visible details and deliver clean, natural edges around the subject.',
  )
  return callOpenAI(formData, apiKey)
}

async function handleDenoise(image: File, apiKey: string, noiseLevel: number) {
  const normalized = Math.min(Math.max(Number.isFinite(noiseLevel) ? noiseLevel : 50, 0), 100)
  const formData = new FormData()
  formData.append('model', 'gpt-image-1')
  formData.append('image', image, image.name || 'image.png')
  formData.append(
    'prompt',
    `Reduce visible noise while preserving fine details. Apply a denoise strength of ${normalized} out of 100 and keep the existing transparency intact.`,
  )
  return callOpenAI(formData, apiKey)
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  if (!env?.OPENAI_API_KEY) {
    return jsonResponse(
      {
        error: 'OPENAI_API_KEY_MISSING',
        message: 'OpenAI API 키가 설정되지 않았어요. 관리자에게 문의해주세요.',
      },
      500,
    )
  }

  if (request.method.toUpperCase() !== 'POST') {
    return jsonResponse(
      {
        error: 'METHOD_NOT_ALLOWED',
        message: 'POST 메서드만 지원합니다.',
      },
      405,
      { Allow: 'POST' },
    )
  }

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return jsonResponse(
      {
        error: 'INVALID_CONTENT_TYPE',
        message: 'multipart/form-data 형식으로 요청해주세요.',
      },
      400,
    )
  }

  try {
    const formData = await request.formData()
    const operation = String(formData.get('operation') ?? '')
    const image = formData.get('image')

    if (!(image instanceof File) || image.size === 0) {
      return jsonResponse(
        {
          error: 'INVALID_IMAGE',
          message: '유효한 이미지 파일이 필요합니다.',
        },
        400,
      )
    }

    let base64Image: string | null = null

    if (operation === 'remove_background') {
      base64Image = await handleRemoveBackground(image, env.OPENAI_API_KEY)
    } else if (operation === 'denoise') {
      const noiseLevelRaw = formData.get('noiseLevel')
      const noiseLevel = noiseLevelRaw == null ? 50 : Number(noiseLevelRaw)
      base64Image = await handleDenoise(image, env.OPENAI_API_KEY, noiseLevel)
    } else {
      return jsonResponse(
        {
          error: 'UNSUPPORTED_OPERATION',
          message: '지원하지 않는 편집 작업이에요.',
        },
        400,
      )
    }

    return jsonResponse({ image: base64Image })
  } catch (error) {
    console.error('[image-edit] unexpected error', error)
    return jsonResponse(
      {
        error: 'IMAGE_EDIT_FAILED',
        message: '이미지 편집 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.',
      },
      500,
    )
  }
}
