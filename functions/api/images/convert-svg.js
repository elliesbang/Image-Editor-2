import OpenAI from 'openai';
import { jsonResponse, parseRequestJSON } from '../../_shared/http.js';
import { verifyJwt } from '../../_shared/jwt.js';

const MAX_SVG_BYTES = 150 * 1024;
const encoder = new TextEncoder();

function parseResponse(response) {
  if (response.output_text) {
    return response.output_text;
  }
  const segments = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text') {
        segments.push(content.text);
      }
    }
  }
  return segments.join('');
}

function sanitizeColorCount(input) {
  const value = Number(input);
  if (Number.isNaN(value)) return 4;
  return Math.min(Math.max(Math.round(value), 1), 6);
}

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
    const { image, colorCount = 4 } = await parseRequestJSON(request);
    if (!image) {
      return jsonResponse(400, { message: '이미지 데이터가 필요합니다.' });
    }

    const paletteSize = sanitizeColorCount(colorCount);

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `이 이미지를 분석해 주요 색상 1~6개 팔레트로 단순화하고, viewBox 포함된 SVG path 데이터로 변환하라. 결과는 150KB 이하로 제한하며, 정확한 JSON 형식으로만 응답해라. colorCount=${paletteSize}. JSON 구조: {"svg":"<svg ...>", "colors":["#hex"]}.`,
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
          name: 'svg_conversion',
          schema: {
            type: 'object',
            properties: {
              svg: { type: 'string' },
              colors: {
                type: 'array',
                minItems: 1,
                maxItems: 6,
                items: { type: 'string' },
              },
            },
            required: ['svg', 'colors'],
          },
        },
      },
    });

    const text = parseResponse(response);
    const data = JSON.parse(text);
    const svgBytes = encoder.encode(data.svg);
    if (svgBytes.length > MAX_SVG_BYTES) {
      return jsonResponse(422, { message: '생성된 SVG가 150KB를 초과합니다. 설정을 조정해주세요.' });
    }

    if (!data.svg.includes('viewBox')) {
      return jsonResponse(422, { message: 'SVG에 viewBox가 포함되지 않았습니다.' });
    }

    return jsonResponse(200, {
      svg: data.svg,
      colors: data.colors,
    });
  } catch (error) {
    console.error('convert-svg error', error);
    return jsonResponse(500, { message: 'SVG 변환에 실패했습니다.' });
  }
}
