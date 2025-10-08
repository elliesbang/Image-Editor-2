import { jsonResponse, parseRequestJSON } from '../../_shared/http.js';
import { signJwt } from '../../_shared/jwt.js';

const ADMIN_SESSION_DURATION_SECONDS = 30 * 60;

export async function onRequestPost({ request, env }) {
  const { email, password } = await parseRequestJSON(request);
  const inputEmail = String(email || '').trim();
  const inputPassword = String(password || '').trim();

  if (!inputEmail || !inputPassword) {
    return jsonResponse(400, { message: '이메일과 비밀번호를 입력해주세요.' });
  }

  const { ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET } = env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !SESSION_SECRET) {
    return jsonResponse(500, { message: '관리자 인증 환경변수가 올바르게 설정되지 않았습니다.' });
  }

  if (inputEmail !== ADMIN_EMAIL || inputPassword !== ADMIN_PASSWORD) {
    return jsonResponse(401, { message: '관리자 인증 실패' });
  }

  const token = await signJwt({ sub: inputEmail, scope: 'admin' }, SESSION_SECRET, ADMIN_SESSION_DURATION_SECONDS);

  return jsonResponse(200, {
    message: '관리자 인증이 완료되었습니다.',
    token,
    expiresIn: ADMIN_SESSION_DURATION_SECONDS,
  });
}
