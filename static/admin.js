import {
  apiRequest,
  bindModalDismiss,
  clearAdminSession,
  closeModal,
  getAdminSession,
  openModal,
  registerModal,
  setAdminSession,
  showToast,
} from './utils.js';

const adminModal = registerModal('admin');
const adminButton = document.querySelector('[data-action="admin-login"]');
const dashboardButton = document.querySelector('[data-action="open-dashboard"]');
const adminForm = adminModal?.querySelector('[data-role="admin-form"]');

bindModalDismiss('admin', '.modal__close');

async function validateAdminSession() {
  const session = getAdminSession();
  if (!session?.token) {
    return false;
  }
  try {
    await apiRequest('admin/validate', {
      body: { token: session.token },
      auth: false,
    });
    return true;
  } catch (error) {
    clearAdminSession();
    return false;
  }
}

adminButton?.addEventListener('click', () => {
  openModal('admin');
});

dashboardButton?.addEventListener('click', async () => {
  const session = getAdminSession();
  if (!session || !(await validateAdminSession())) {
    showToast('관리자 인증이 필요합니다.');
    return;
  }
  const url = new URL('./dashboard.html', window.location.href);
  url.searchParams.set('token', session.token);
  window.open(url.toString(), '_blank', 'noopener');
});

adminForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(adminForm);
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '').trim();

  if (!email || !password) {
    showToast('이메일과 비밀번호를 입력해주세요.');
    return;
  }

  try {
    const response = await apiRequest('admin/login', {
      body: { email, password },
      auth: false,
    });
    const expiresAt = Date.now() + (response.expiresIn || 1800) * 1000;
    setAdminSession({ token: response.token, email, expiresAt });
    showToast('관리자 인증이 완료되었습니다.');
    closeModal('admin');
    dashboardButton?.removeAttribute('disabled');
  } catch (error) {
    showToast(error.message || '관리자 인증 실패');
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  if (await validateAdminSession()) {
    dashboardButton?.removeAttribute('disabled');
  } else {
    dashboardButton?.setAttribute('disabled', 'true');
  }
});
