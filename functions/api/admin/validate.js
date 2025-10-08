import { jsonResponse, parseRequestJSON } from '../../_shared/http.js';
import { verifyJwt } from '../../_shared/jwt.js';

export async function onRequestPost({ request, env }) {
  const { token } = await parseRequestJSON(request);
  const provided = token || request.headers.get('authorization')?.replace(/bearer\s+/i, '');

  if (!provided) {
    return jsonResponse(401, { message: '토큰이 필요합니다.' });
  }

  try {
    const payload = await verifyJwt(provided, env.SESSION_SECRET);
    if (payload.scope !== 'admin') {
      return jsonResponse(403, { message: '관리자 권한이 필요합니다.' });
    }
    return jsonResponse(200, {
      valid: true,
      email: payload.sub,
      expiresAt: payload.exp,
    });
  } catch (error) {
    return jsonResponse(401, { message: error.message || '유효하지 않은 토큰입니다.' });
  }
}
