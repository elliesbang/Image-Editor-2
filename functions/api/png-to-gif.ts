import type { PagesFunction } from '@cloudflare/workers-types'

const OPENAI_API_URL = 'https://api.openai.com/v1/responses'

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

type AnimationPlan = {
  fps: number
  loop: boolean
  duration_ms: number
  keyframes: Array<{
    time: number
    translate?: { x?: number; y?: number }
    scale?: number
    rotate?: number
    opacity?: number
    ease?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  }>
}

type RequestBody = {
  prompt?: string
  width?: number
  height?: number
}

function buildSchema(width: number | null, height: number | null) {
  const extraContext: string[] = []
  if (Number.isFinite(width) && width && width > 0) {
    extraContext.push(`원본 너비: ${Math.round(width)}px`)
  }
  if (Number.isFinite(height) && height && height > 0) {
    extraContext.push(`원본 높이: ${Math.round(height)}px`)
  }

  return extraContext.join('\n')
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
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonResponse(
      {
        error: 'INVALID_CONTENT_TYPE',
        message: 'application/json 형식으로 요청해주세요.',
      },
      400,
    )
  }

  try {
    const body = (await request.json()) as RequestBody
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt) {
      return jsonResponse(
        {
          error: 'PROMPT_REQUIRED',
          message: '움직임을 설명할 텍스트를 입력해주세요.',
        },
        400,
      )
    }

    const width = Number.isFinite(body?.width) ? Number(body?.width) : null
    const height = Number.isFinite(body?.height) ? Number(body?.height) : null

    const contextText = buildSchema(width, height)

    const responseFormat = {
      type: 'json_schema',
      json_schema: {
        name: 'AnimationPlan',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['fps', 'loop', 'duration_ms', 'keyframes'],
          properties: {
            fps: {
              type: 'integer',
              minimum: 4,
              maximum: 18,
              description: '초당 프레임 수',
            },
            loop: {
              type: 'boolean',
              description: 'GIF 반복 여부. true면 무한 반복.',
            },
            duration_ms: {
              type: 'integer',
              minimum: 800,
              maximum: 10000,
              description: '전체 애니메이션 길이(밀리초).',
            },
            keyframes: {
              type: 'array',
              minItems: 2,
              maxItems: 8,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['time'],
                properties: {
                  time: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description: '애니메이션 진행률 (0~1).',
                  },
                  translate: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      x: {
                        type: 'number',
                        minimum: -120,
                        maximum: 120,
                        description: '너비 대비 이동 비율(%)',
                      },
                      y: {
                        type: 'number',
                        minimum: -120,
                        maximum: 120,
                        description: '높이 대비 이동 비율(%)',
                      },
                    },
                  },
                  scale: {
                    type: 'number',
                    minimum: 0.4,
                    maximum: 2.5,
                    description: '배율 (1=원본 크기).',
                  },
                  rotate: {
                    type: 'number',
                    minimum: -180,
                    maximum: 180,
                    description: '회전 각도(도).',
                  },
                  opacity: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description: '투명도(0~1).',
                  },
                  ease: {
                    type: 'string',
                    enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out'],
                    description: '다음 키프레임으로의 보간 방식.',
                  },
                },
              },
            },
          },
        },
      },
    }

    const promptBlocks = [
      {
        type: 'text',
        text: [
          '다음은 정적인 PNG 이미지를 자연어 설명에 맞춰 애니메이션화하기 위한 요청입니다.',
          '아래 조건을 모두 지켜 JSON 형식의 키프레임 계획을 생성해주세요.',
          '- JSON 이외의 설명을 덧붙이지 말 것',
          '- 최소 2개의 키프레임 포함 (시작 0, 종료 1)',
          '- 이동, 확대/축소, 회전, 투명도 중 필요한 속성만 제공 (생략 시 기본값 사용)',
          '- ease 값은 구간의 전환 특성을 설명',
          contextText,
          `사용자 설명: ${prompt}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ]

    const openAIResponse = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'text',
                text:
                  'You are an animation planning assistant. Respond only with JSON matching the provided schema. Avoid extra commentary.',
              },
            ],
          },
          {
            role: 'user',
            content: promptBlocks,
          },
        ],
        response_format: responseFormat,
      }),
    })

    if (!openAIResponse.ok) {
      const detail = await openAIResponse.text().catch(() => '')
      console.error('[png-to-gif] openai request failed', openAIResponse.status, detail)
      return jsonResponse(
        {
          error: 'OPENAI_REQUEST_FAILED',
          message: '애니메이션 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.',
        },
        502,
      )
    }

    const payload = (await openAIResponse.json()) as { output_text?: string }
    const planText = payload?.output_text || ''
    if (!planText) {
      return jsonResponse(
        {
          error: 'EMPTY_PLAN',
          message: '생성된 애니메이션 계획을 해석할 수 없어요.',
        },
        500,
      )
    }

    let plan: AnimationPlan | null = null
    try {
      plan = JSON.parse(planText) as AnimationPlan
    } catch (error) {
      console.error('[png-to-gif] failed to parse plan', error, planText)
      return jsonResponse(
        {
          error: 'INVALID_PLAN_FORMAT',
          message: '애니메이션 계획 JSON을 해석하지 못했어요.',
        },
        500,
      )
    }

    if (!Array.isArray(plan?.keyframes) || typeof plan?.fps !== 'number') {
      return jsonResponse(
        {
          error: 'INVALID_PLAN_STRUCTURE',
          message: '애니메이션 계획 구조가 올바르지 않아요.',
        },
        500,
      )
    }

    return jsonResponse({ plan })
  } catch (error) {
    console.error('[png-to-gif] unexpected error', error)
    return jsonResponse(
      {
        error: 'PNG_TO_GIF_PLAN_FAILED',
        message: '애니메이션 정보를 생성하는 중 문제가 발생했어요.',
      },
      500,
    )
  }
}

