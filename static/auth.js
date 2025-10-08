(function () {
  let currentEmail = '';
  let otpModal = null;
  let otpInput = null;
  let modalBackdrop = null;
  let requestForm = null;
  let verifyButton = null;
  let resendButton = null;
  let successPanel = null;

  function openModal() {
    if (!modalBackdrop) return;
    modalBackdrop.classList.add('visible');
    otpInput?.focus();
  }

  function closeModal() {
    if (!modalBackdrop) return;
    modalBackdrop.classList.remove('visible');
    if (otpInput) {
      otpInput.value = '';
    }
  }

  function simulateRequest() {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ success: true, code: '000000' }), 800);
    });
  }

  function simulateVerify() {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ success: true }), 700);
    });
  }

  async function handleRequest(event) {
    event.preventDefault();
    const formData = new FormData(requestForm);
    const email = (formData.get('email') || '').toString().trim();
    if (!email || !email.includes('@')) {
      window.ElliesApp?.showToast('유효한 이메일 주소를 입력해 주세요.', 'warning');
      return;
    }

    currentEmail = email;
    requestForm.querySelector('button[type="submit"]').disabled = true;
    window.ElliesApp?.showToast('인증 코드를 전송 중입니다. (데모 모드)', 'info');

    await simulateRequest();

    window.ElliesApp?.showToast('데모 모드: 가상의 인증 코드가 전송되었습니다.', 'success');
    requestForm.querySelector('button[type="submit"]').disabled = false;
    openModal();
  }

  async function handleVerify() {
    const value = otpInput?.value?.trim();
    if (!value || value.length !== 6) {
      window.ElliesApp?.showToast('6자리 인증 코드를 입력해 주세요.', 'warning');
      otpInput?.focus();
      return;
    }

    verifyButton.disabled = true;
    resendButton.disabled = true;
    window.ElliesApp?.showToast('코드를 확인 중입니다. (데모 모드)', 'info');

    await simulateVerify();

    window.ElliesApp?.setSession({ email: currentEmail, issuedAt: Date.now() });
    window.ElliesApp?.setCredits(30);
    window.ElliesApp?.updateCreditBadge();
    window.ElliesApp?.showToast('로그인 되었습니다! 홈으로 이동하여 편집을 시작하세요.', 'success');

    closeModal();
    successPanel?.classList.remove('hidden');
  }

  function bindEvents() {
    requestForm = document.querySelector('[data-email-form]');
    otpModal = document.querySelector('[data-otp-modal]');
    otpInput = document.querySelector('[data-otp-input]');
    modalBackdrop = document.querySelector('[data-modal-backdrop]');
    verifyButton = document.querySelector('[data-action="verify-otp"]');
    resendButton = document.querySelector('[data-action="resend-code"]');
    successPanel = document.querySelector('[data-success-panel]');

    requestForm?.addEventListener('submit', handleRequest);
    verifyButton?.addEventListener('click', handleVerify);
    resendButton?.addEventListener('click', async (event) => {
      event.preventDefault();
      if (!currentEmail) return;
      resendButton.disabled = true;
      window.ElliesApp?.showToast('인증 코드를 다시 전송 중입니다. (데모 모드)', 'info');
      await simulateRequest();
      window.ElliesApp?.showToast('데모 모드: 새 인증 코드가 전송되었습니다.', 'success');
      resendButton.disabled = false;
    });

    modalBackdrop?.addEventListener('click', (event) => {
      if (event.target === modalBackdrop) {
        closeModal();
      }
    });

    otpInput?.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') {
        handleVerify();
      }
    });

    document.querySelectorAll('[data-action="close-modal"]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        closeModal();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', bindEvents);
})();
