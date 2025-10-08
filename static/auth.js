(() => {
  const CODE_DURATION_MS = 5 * 60 * 1000;
  const ADMIN_EMAIL = 'ellie@elliesbang.kr';
  const ADMIN_PASSWORD = 'Ssh121015!!';

  const redirectIfLoggedIn = () => {
    const isAdmin = localStorage.getItem('adminLoggedIn') === 'true';
    const isUser = localStorage.getItem('userLoggedIn') === 'true';

    if (isUser) {
      window.location.replace('./dashboard.html');
      return true;
    }

    if (isAdmin) {
      // 관리자 로그인 상태에서 로그인 페이지를 열면 콘솔로 안내합니다.
      const adminMessage = document.querySelector('[data-role="admin-message"]');
      if (adminMessage) {
        adminMessage.textContent = '이미 관리자 인증이 완료되어 대시보드로 이동합니다.';
        adminMessage.dataset.state = 'success';
      }
      window.location.replace('./admin.html');
      return true;
    }

    return false;
  };

  if (redirectIfLoggedIn()) {
    return;
  }

  const tabButtons = Array.from(document.querySelectorAll('.auth-tab'));
  const panels = Array.from(document.querySelectorAll('.auth-panel'));

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.target;

      tabButtons.forEach((tab) => {
        const isActive = tab === button;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      panels.forEach((panel) => {
        const isActive = panel.id === targetId;
        panel.classList.toggle('is-active', isActive);
        panel.toggleAttribute('hidden', !isActive);
      });
    });
  });

  const userForm = document.querySelector('#user-login-form');
  const requestCodeButton = document.querySelector('[data-role="request-code"]');
  const codePreview = document.querySelector('[data-role="code-preview"]');
  const codeValue = document.querySelector('[data-role="code-value"]');
  const codeCountdown = document.querySelector('[data-role="code-countdown"]');
  const copyCodeButton = document.querySelector('[data-role="copy-code"]');
  const userMessage = document.querySelector('[data-role="user-message"]');

  const adminForm = document.querySelector('#admin-login-form');
  const adminMessage = document.querySelector('[data-role="admin-message"]');
  const passwordToggle = document.querySelector('[data-role="toggle-password"]');
  const adminPasswordInput = document.querySelector('#admin-password');

  let generatedCode = '';
  let expiresAt = 0;
  let countdownTimer = null;

  const setUserMessage = (text, state) => {
    if (!userMessage) return;
    userMessage.textContent = text || '';
    if (state) {
      userMessage.dataset.state = state;
    } else {
      userMessage.removeAttribute('data-state');
    }
  };

  const setAdminMessage = (text, state) => {
    if (!adminMessage) return;
    adminMessage.textContent = text || '';
    if (state) {
      adminMessage.dataset.state = state;
    } else {
      adminMessage.removeAttribute('data-state');
    }
  };

  const clearCountdown = () => {
    if (countdownTimer) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (codeCountdown) {
      codeCountdown.textContent = '';
    }
  };

  const updateCountdown = () => {
    const remaining = Math.max(0, expiresAt - Date.now());
    if (!codeCountdown) return;

    if (remaining <= 0) {
      codeCountdown.textContent = '코드가 만료되었습니다. 다시 받아주세요.';
      clearCountdown();
      generatedCode = '';
      expiresAt = 0;
      return;
    }

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000)
      .toString()
      .padStart(2, '0');
    codeCountdown.textContent = `코드 유효 시간 ${minutes}:${seconds}`;
  };

  const startCountdown = () => {
    clearCountdown();
    updateCountdown();
    countdownTimer = window.setInterval(updateCountdown, 1000);
  };

  const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

  if (passwordToggle && adminPasswordInput) {
    passwordToggle.addEventListener('click', () => {
      const isHidden = adminPasswordInput.getAttribute('type') === 'password';
      adminPasswordInput.setAttribute('type', isHidden ? 'text' : 'password');
      passwordToggle.textContent = isHidden ? '가리기' : '보기';
      passwordToggle.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
      adminPasswordInput.focus();
    });
  }

  if (requestCodeButton && userForm) {
    requestCodeButton.addEventListener('click', () => {
      const emailInput = /** @type {HTMLInputElement | null} */ (document.querySelector('#user-email'));
      if (!emailInput) return;

      const email = emailInput.value.trim();
      if (!email) {
        setUserMessage('이메일 주소를 입력해 주세요.', 'error');
        emailInput.focus();
        return;
      }

      generatedCode = generateCode();
      expiresAt = Date.now() + CODE_DURATION_MS;

      if (codeValue) {
        codeValue.textContent = generatedCode;
      }

      if (codePreview) {
        codePreview.hidden = false;
      }

      startCountdown();
      setUserMessage('인증코드가 생성되었습니다. 아래 번호를 입력해 주세요.', 'success');
    });
  }

  if (copyCodeButton) {
    copyCodeButton.addEventListener('click', async () => {
      if (!generatedCode) {
        setUserMessage('먼저 인증코드를 생성해 주세요.', 'error');
        return;
      }

      try {
        await navigator.clipboard.writeText(generatedCode);
        setUserMessage('인증코드가 복사되었습니다.', 'success');
      } catch (error) {
        console.error('Clipboard copy failed', error);
        setUserMessage('복사에 실패했어요. 직접 입력해 주세요.', 'error');
      }
    });
  }

  if (userForm) {
    userForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const emailInput = /** @type {HTMLInputElement | null} */ (document.querySelector('#user-email'));
      const codeInput = /** @type {HTMLInputElement | null} */ (document.querySelector('#verification-code'));
      if (!emailInput || !codeInput) return;

      const email = emailInput.value.trim();
      const code = codeInput.value.trim();

      if (!email) {
        setUserMessage('이메일 주소를 입력해 주세요.', 'error');
        emailInput.focus();
        return;
      }

      if (!code || code.length !== 6) {
        setUserMessage('6자리 인증코드를 입력해 주세요.', 'error');
        codeInput.focus();
        return;
      }

      if (!generatedCode || !expiresAt) {
        setUserMessage('먼저 인증코드를 생성해 주세요.', 'error');
        return;
      }

      if (Date.now() > expiresAt) {
        setUserMessage('인증코드가 만료되었습니다. 새로운 코드를 받아주세요.', 'error');
        generatedCode = '';
        clearCountdown();
        if (codePreview) {
          codePreview.hidden = true;
        }
        return;
      }

      if (code !== generatedCode) {
        setUserMessage('인증코드가 올바르지 않아요.', 'error');
        return;
      }

      localStorage.setItem('userLoggedIn', 'true');
      localStorage.setItem('userEmail', email);
      localStorage.setItem('userLoginAt', new Date().toISOString());
      setUserMessage('로그인에 성공했습니다. 잠시 후 이동합니다.', 'success');

      setTimeout(() => {
        window.location.href = './dashboard.html';
      }, 600);
    });
  }

  if (adminForm) {
    adminForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const emailInput = /** @type {HTMLInputElement | null} */ (document.querySelector('#admin-email'));
      const passwordInput = /** @type {HTMLInputElement | null} */ (document.querySelector('#admin-password'));
      if (!emailInput || !passwordInput) return;

      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (!email || !password) {
        setAdminMessage('이메일과 비밀번호를 모두 입력해 주세요.', 'error');
        return;
      }

      if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
        setAdminMessage('계정 정보가 일치하지 않습니다. 운영팀에 확인해 주세요.', 'error');
        return;
      }

      localStorage.setItem('adminLoggedIn', 'true');
      localStorage.setItem('adminEmail', email);
      setAdminMessage('관리자 인증이 완료되었습니다. 잠시 후 이동합니다.', 'success');
      setTimeout(() => {
        window.location.href = './admin.html';
      }, 500);
    });
  }
})();
