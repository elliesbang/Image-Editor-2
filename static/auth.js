import {
  apiRequest,
  bindModalDismiss,
  clearUserSession,
  closeModal,
  copyText,
  openModal,
  registerModal,
  setUserSession,
  showToast,
  updateUserState,
} from './utils.js';

const loginModal = registerModal('login');
const requiredModal = registerModal('login-required');
const loginForm = loginModal?.querySelector('[data-role="login-form"]');
const codeSection = loginModal?.querySelector('[data-role="code-section"]');
const displayCode = loginModal?.querySelector('[data-role="display-code"]');
const sendCodeButton = loginModal?.querySelector('[data-action="send-code"]');
const copyCodeButton = loginModal?.querySelector('[data-action="copy-code"]');
const loginButton = document.querySelector('[data-action="user-login"]');
const logoutButton = document.querySelector('[data-action="user-logout"]');
const requiredLoginButton = requiredModal?.querySelector('[data-action="open-login-from-required"]');

let lastRequestedEmail = '';
let lastGeneratedCode = '';

bindModalDismiss('login', '.modal__close');
bindModalDismiss('admin', '.modal__close');
bindModalDismiss('login-required', '.modal__close');

loginModal?.addEventListener('modal:open', () => {
  loginForm?.reset();
  codeSection.hidden = true;
  displayCode.textContent = '------';
  copyCodeButton.disabled = true;
  lastRequestedEmail = '';
  lastGeneratedCode = '';
});

loginButton?.addEventListener('click', () => {
  openModal('login');
});

requiredLoginButton?.addEventListener('click', () => {
  closeModal('login-required');
  openModal('login');
});

logoutButton?.addEventListener('click', () => {
  clearUserSession();
  updateUserState();
  showToast('로그아웃되었습니다.');
});

sendCodeButton?.addEventListener('click', async () => {
  if (!loginForm) return;
  const formData = new FormData(loginForm);
  const email = String(formData.get('email') || '').trim().toLowerCase();
  if (!email) {
    showToast('이메일을 입력해주세요.');
    return;
  }

  sendCodeButton.disabled = true;
  sendCodeButton.textContent = '코드 생성 중...';
  try {
    const response = await apiRequest('auth/send-code', {
      method: 'POST',
      body: { email },
      auth: false,
    });
    lastRequestedEmail = email;
    lastGeneratedCode = response.code;
    displayCode.textContent = response.code;
    copyCodeButton.disabled = false;
    codeSection.hidden = false;
    showToast('인증코드를 생성했습니다. 복사하여 입력해주세요.');
  } catch (error) {
    showToast(error.message);
  } finally {
    sendCodeButton.disabled = false;
    sendCodeButton.textContent = '인증코드 받기';
  }
});

copyCodeButton?.addEventListener('click', async () => {
  if (!lastGeneratedCode) {
    showToast('생성된 인증코드가 없습니다.');
    return;
  }
  try {
    await copyText(lastGeneratedCode);
    showToast('인증코드를 복사했습니다.');
  } catch (error) {
    showToast('클립보드 복사에 실패했습니다.');
  }
});

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const code = String(formData.get('code') || '').trim();

  if (!email || !code) {
    showToast('이메일과 인증코드를 모두 입력해주세요.');
    return;
  }

  if (email !== lastRequestedEmail || code !== lastGeneratedCode) {
    showToast('표시된 인증코드를 정확히 입력해주세요.');
    return;
  }

  try {
    const response = await apiRequest('auth/verify-code', {
      method: 'POST',
      body: { email, code },
      auth: false,
    });

    const expiresAt = Date.now() + (response.expiresIn || 3600) * 1000;
    setUserSession({
      token: response.token,
      email: response.email,
      credits: response.credits ?? 30,
      expiresAt,
    });
    updateUserState();
    showToast(response.message || '로그인 완료! 30 크레딧이 충전되었습니다.');
    closeModal('login');
  } catch (error) {
    showToast(error.message || '인증 실패. 다시 시도해주세요.');
  }
});

window.addEventListener('DOMContentLoaded', () => {
  updateUserState();
});
