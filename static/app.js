(function () {
  const SESSION_KEY = 'ellies-admin-session';
  const CREDIT_KEY = 'ellies-user-credits';
  const TOAST_DURATION = 4200;

  const storage = {
    get(key) {
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        console.warn('[ElliesApp] Failed to read storage', error);
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.warn('[ElliesApp] Failed to write storage', error);
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.warn('[ElliesApp] Failed to remove storage', error);
      }
    }
  };

  function ensureToastContainer() {
    let container = document.querySelector('.toast-stack');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-stack';
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(message, variant = 'info', options = {}) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.variant = variant;
    toast.innerHTML = `<span>${message}</span>`;

    if (!options.persistent) {
      const close = document.createElement('button');
      close.type = 'button';
      close.setAttribute('aria-label', '닫기');
      close.innerHTML = '&times;';
      close.addEventListener('click', () => toast.remove());
      toast.appendChild(close);
    }

    container.appendChild(toast);

    if (!options.persistent) {
      setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(6px)';
      }, options.duration || TOAST_DURATION);
    }
    return toast;
  }

  function getSession() {
    return storage.get(SESSION_KEY);
  }

  function setSession(payload) {
    storage.set(SESSION_KEY, payload);
  }

  function clearSession() {
    storage.remove(SESSION_KEY);
  }

  function getCredits() {
    const credits = storage.get(CREDIT_KEY);
    if (credits && typeof credits.amount === 'number') {
      return credits.amount;
    }
    return null;
  }

  function setCredits(amount) {
    storage.set(CREDIT_KEY, { amount });
  }

  function adjustCredits(delta) {
    const current = getCredits();
    const next = typeof current === 'number' ? Math.max(0, current + delta) : null;
    if (next !== null) {
      setCredits(next);
    }
    updateCreditBadge();
    return next;
  }

  function formatCredits(value) {
    return new Intl.NumberFormat('ko-KR').format(value);
  }

  function updateCreditBadge() {
    const badge = document.querySelector('[data-credit-badge]');
    if (!badge) return;

    const session = getSession();
    const credits = getCredits();

    if (!session) {
      badge.dataset.state = 'locked';
      badge.textContent = '로그인 필요';
      return;
    }

    const amount = typeof credits === 'number' ? credits : 0;
    let state = 'success';
    if (amount < 5) state = 'danger';
    else if (amount < 20) state = 'warning';

    badge.dataset.state = state;
    badge.textContent = `잔여 크레딧 ${formatCredits(amount)}개`;
  }

  function renderSessionBanner() {
    const banner = document.querySelector('[data-session-banner]');
    if (!banner) return;

    const session = getSession();
    if (!session) {
      banner.classList.remove('visible');
      return;
    }

    banner.classList.add('visible');
    banner.querySelector('[data-session-email]').textContent = session.email || '관리자';

    banner.querySelectorAll('[data-action="open-dashboard"]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        const target = event.currentTarget.dataset.target;
        const url = 'dashboard.html';
        if (target === 'self') {
          window.location.href = url;
        } else {
          window.open(url, '_blank', 'noopener');
        }
      });
    });
  }

  function handleCommunityLink() {
    const button = document.querySelector('[data-action="community"]');
    if (!button) return;

    const fallback = '/?view=community';
    const fromBody = document.body.dataset.communityUrl;
    const communityUrl = window.MICHINA_COMMUNITY_URL || fromBody || fallback;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (communityUrl.startsWith('/')) {
        const target = communityUrl.includes('#') || communityUrl.includes('?')
          ? communityUrl
          : `${communityUrl}#community`;
        window.location.href = target;
      } else {
        window.open(communityUrl, '_blank', 'noopener');
      }
    });
  }

  async function safeFetch(url, options = {}) {
    const finalOptions = Object.assign({ credentials: 'include' }, options);
    try {
      const response = await fetch(url, finalOptions);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      console.warn('[ElliesApp] fetch failed, switching to demo mode', error);
      showToast('연결된 서버가 없어 데모 모드로 전환합니다.', 'warning');
      return {
        ok: false,
        status: 0,
        error,
        async json() {
          return {};
        },
        async text() {
          return '';
        }
      };
    }
  }

  function initHeaderActions() {
    const loginButton = document.querySelector('[data-action="login"]');
    if (loginButton) {
      loginButton.addEventListener('click', (event) => {
        event.preventDefault();
        window.location.href = 'login.html';
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureToastContainer();
    updateCreditBadge();
    renderSessionBanner();
    handleCommunityLink();
    initHeaderActions();
  });

  window.ElliesApp = Object.assign(window.ElliesApp || {}, {
    showToast,
    safeFetch,
    storage,
    getSession,
    setSession,
    clearSession,
    getCredits,
    setCredits,
    adjustCredits,
    formatCredits,
    updateCreditBadge,
    renderSessionBanner
  });
})();
