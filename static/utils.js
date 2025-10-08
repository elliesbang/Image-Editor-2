const modalRegistry = new Map();
const toastContainer = document.querySelector('[data-role="toast-container"]');

function parseSession(value) {
  if (!value) return null;
  try {
    const session = JSON.parse(value);
    if (!session.expiresAt || Date.now() > Number(session.expiresAt)) {
      return null;
    }
    return session;
  } catch (error) {
    return null;
  }
}

export function getUserSession() {
  const stored = sessionStorage.getItem('user_session');
  const session = parseSession(stored);
  if (!session) {
    sessionStorage.removeItem('user_session');
    return null;
  }
  return session;
}

export function setUserSession(session) {
  sessionStorage.setItem('user_session', JSON.stringify(session));
}

export function clearUserSession() {
  sessionStorage.removeItem('user_session');
}

export function getAdminSession() {
  const stored = sessionStorage.getItem('admin_session');
  const session = parseSession(stored);
  if (!session) {
    sessionStorage.removeItem('admin_session');
    return null;
  }
  return session;
}

export function setAdminSession(session) {
  sessionStorage.setItem('admin_session', JSON.stringify(session));
}

export function clearAdminSession() {
  sessionStorage.removeItem('admin_session');
}

export function registerModal(name) {
  const modal = document.querySelector(`.modal[data-modal="${name}"]`);
  if (modal) {
    modalRegistry.set(name, modal);
  }
  return modal;
}

export function openModal(name) {
  const modal = modalRegistry.get(name);
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'false');
  modal.dispatchEvent(new CustomEvent('modal:open'));
}

export function closeModal(name) {
  const modal = modalRegistry.get(name);
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'true');
  modal.dispatchEvent(new CustomEvent('modal:close'));
}

export function bindModalDismiss(name, selector) {
  const modal = modalRegistry.get(name) || registerModal(name);
  if (!modal) return;
  modal.addEventListener('click', (event) => {
    const target = event.target;
    if (target.closest(selector)) {
      closeModal(name);
    }
    if (target === modal) {
      closeModal(name);
    }
  });
}

export function showToast(message) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast--visible');
  }, 10);
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3500);
}

export function ensureLoggedIn() {
  const session = getUserSession();
  if (!session) {
    showToast('로그인이 필요합니다.');
    openModal('login-required');
    return false;
  }
  return true;
}

export function ensureAdmin() {
  const session = getAdminSession();
  if (!session) {
    showToast('관리자 인증이 필요합니다.');
    return false;
  }
  return true;
}

export async function apiRequest(path, options = {}) {
  const method = options.method || 'POST';
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const userSession = getUserSession();
  if (options.auth !== false && userSession?.token) {
    headers.Authorization = `Bearer ${userSession.token}`;
  }
  const response = await fetch(`/api/${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let detail = '요청을 처리하지 못했습니다.';
    try {
      const data = await response.json();
      detail = data?.message || data?.error || detail;
    } catch (error) {
      // noop
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export function updateUserState() {
  const creditValue = document.querySelector('[data-role="credit-value"]');
  const userState = document.querySelector('[data-role="user-state"]');
  const loginButton = document.querySelector('[data-action="user-login"]');
  const logoutButton = document.querySelector('[data-action="user-logout"]');

  const session = getUserSession();
  if (session) {
    creditValue.textContent = String(session.credits ?? 30);
    userState.textContent = session.email || '로그인 사용자';
    loginButton.hidden = true;
    logoutButton.hidden = false;
  } else {
    creditValue.textContent = '0';
    userState.textContent = '게스트 모드';
    loginButton.hidden = false;
    logoutButton.hidden = true;
  }
}

export function dataURLToBlob(dataUrl) {
  const [meta, data] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)[1];
  const binary = atob(data);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function debounce(fn, wait = 250) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

export function copyText(text) {
  if (!text) return Promise.reject(new Error('복사할 텍스트가 없습니다.'));
  return navigator.clipboard.writeText(text);
}
