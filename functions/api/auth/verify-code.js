import { jsonResponse, parseRequestJSON } from '../../_shared/http.js';
import {
  clearExpiredEntries,
  consumeVerificationCode,
  getVerificationEntry,
  isEmailUsed,
  markEmailUsed,
} from '../../_shared/sessionStore.js';
import { signJwt } from '../../_shared/jwt.js';

const SESSION_DURATION_SECONDS = 60 * 60;

export async function onRequestPost({ request, env }) {
  clearExpiredEntries();
  const { email, code } = await parseRequestJSON(request);
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedCode = String(code || '').trim();

  if (!normalizedEmail || !normalizedCode) {
    return jsonResponse(400, { message: '이메일과 인증코드를 모두 입력해주세요.' });
  }

  if (isEmailUsed(normalizedEmail)) {
    return jsonResponse(409, { message: '이미 가입된 이메일입니다. 다른 이메일을 사용해주세요.' });
  }

  const stored = getVerificationEntry(normalizedEmail);
  if (!stored) {
    return jsonResponse(400, { message: '인증코드를 찾을 수 없습니다. 다시 요청해주세요.' });
  }

  if (stored.code !== normalizedCode) {
    return jsonResponse(401, { message: '인증 실패. 다시 시도해주세요.' });
  }

  if (!env.SESSION_SECRET) {
    return jsonResponse(500, { message: '세션 설정이 완료되지 않았습니다.' });
  }

  markEmailUsed(normalizedEmail);
  consumeVerificationCode(normalizedEmail);

  const token = await signJwt({ sub: normalizedEmail, scope: 'user' }, env.SESSION_SECRET, SESSION_DURATION_SECONDS);

  return jsonResponse(200, {
    message: '로그인 완료! 30 크레딧이 충전되었습니다.',
    token,
    email: normalizedEmail,
    credits: 30,
    expiresIn: SESSION_DURATION_SECONDS,
  });
}
