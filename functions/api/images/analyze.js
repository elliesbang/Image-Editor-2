import OpenAI from 'openai';
import { jsonResponse, parseRequestJSON } from '../../_shared/http.js';
import { verifyJwt } from '../../_shared/jwt.js';

export async function onRequestPost({ request, env }) {
  if (!env.OPENAI_API_KEY) {
    return jsonResponse(500, { message: 'OpenAI API 키가 설정되지 않았습니다.' });
  }

  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return jsonResponse(401, { message: '로그인이 필요합니다.' });
  }

  try {
    const token = authorization.replace(/bearer\s+/i, '');
    const payload = await verifyJwt(token, env.SESSION_SECRET);
    if (payload.scope !== 'user') {
      return jsonResponse(403, { message: '사용자 권한이 필요합니다.' });
    }
  } catch (error) {
    return jsonResponse(401, { message: error.message || '유효하지 않은 토큰입니다.' });
  }

  try {
    const { image } = await parseRequestJSON(request);
    if (!image) {
      return jsonResponse(400, { message: '이미지 데이터가 필요합니다.' });
    }

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '이 이미지는 사용자가 직접 편집한 최종 결과물입니다. 이 이미지의 실제 시각적 내용과 구성, 색상, 질감, 주제에 부합하는 SEO 키워드 25개와 미리캔버스 노출에 적합한 짧은 제목(title)을 JSON 형식으로 생성해줘. JSON 외의 다른 텍스트는 포함하지 마.',
            },
            {
              type: 'input_image',
              image_url: image,
            },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'seo_keywords',
          schema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              keywords: {
                type: 'array',
                items: { type: 'string' },
                minItems: 25,
                maxItems: 25,
              },
            },
            required: ['title', 'keywords'],
          },
        },
      },
    });

    let text = '';
    if (response.output_text) {
      text = response.output_text;
    } else {
      for (const item of response.output || []) {
        for (const content of item.content || []) {
          if (content.type === 'output_text') {
            text += content.text;
          }
        }
      }
    }

    const data = JSON.parse(text);
    return jsonResponse(200, {
      title: data.title,
      keywords: data.keywords,
    });
  } catch (error) {
    console.error('analyze-image error', error);
    return jsonResponse(500, { message: '키워드 분석에 실패했습니다.' });
  }
}
