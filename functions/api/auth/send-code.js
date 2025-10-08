import { jsonResponse, parseRequestJSON } from '../../_shared/http.js';
import {
  clearExpiredEntries,
  createVerificationCode,
  isEmailUsed,
  resetVerificationCode,
} from '../../_shared/sessionStore.js';

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function validateEmail(email) {
  return /.+@.+\..+/.test(email);
}

export async function onRequestPost({ request }) {
  clearExpiredEntries();
  const { email } = await parseRequestJSON(request);
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !validateEmail(normalizedEmail)) {
    return jsonResponse(400, { message: '유효한 이메일을 입력해주세요.' });
  }

  if (isEmailUsed(normalizedEmail)) {
    return jsonResponse(409, { message: '이미 가입된 이메일입니다. 다른 이메일을 사용해주세요.' });
  }

  const code = generateCode();
  resetVerificationCode(normalizedEmail);
  createVerificationCode(normalizedEmail, code);

  return jsonResponse(200, {
    message: '인증코드를 생성했습니다. 화면에 표시된 코드를 입력해주세요.',
    code,
    expiresIn: 300,
  });
}
