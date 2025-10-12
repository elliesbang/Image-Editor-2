(() => {
  const STORAGE_KEY = 'adminSessionState';
  const SESSION_ID_KEY = 'adminSessionId';
  const CHANNEL_NAME = 'admin-auth-channel';
  const ADMIN_SESSION_KEY = 'admin_session';
  const ADMIN_EMAIL = document.body?.dataset?.adminEmail || 'admin@local';
  const LOGIN_URL = new URL('/login.html', window.location.origin).toString();

  const elements = {
    toast: document.querySelector('[data-role="dashboard-toast"]'),
    welcome: document.querySelector('[data-role="welcome"]'),
    sessionInfo: document.querySelector('[data-role="session-info"]'),
    logout: document.querySelector('[data-role="logout"]'),
    periodForm: document.querySelector('[data-role="period-form"]'),
    periodStart: document.querySelector('[data-role="period-start"]'),
    periodEnd: document.querySelector('[data-role="period-end"]'),
    periodStatus: document.querySelector('[data-role="period-status"]'),
    periodSummary: document.querySelector('[data-role="period-summary"]'),
    periodUpdated: document.querySelector('[data-role="period-updated"]'),
    participantsForm: document.querySelector('[data-role="participants-form"]'),
    participantsFile: document.querySelector('[data-role="participants-file"]'),
    participantsMessage: document.querySelector('[data-role="participants-message"]'),
    participantsTable: document.querySelector('[data-role="participants-table"]'),
    participantsCount: document.querySelector('[data-role="participants-count"]'),
    statusPeriod: document.querySelector('[data-role="status-period"]'),
    statusTotal: document.querySelector('[data-role="status-total"]'),
    statusActive: document.querySelector('[data-role="status-active"]'),
    statusExpired: document.querySelector('[data-role="status-expired"]'),
    statusChart: document.querySelector('[data-role="status-chart"]'),
    statusChartLabel: document.querySelector('[data-role="status-chart-label"]'),
    statusDescription: document.querySelector('[data-role="status-description"]'),
    usersTable: document.querySelector('[data-role="users-table"]'),
    usersCount: document.querySelector('[data-role="users-count"]'),
  };

  const state = {
    period: null,
    participants: [],
    status: null,
    users: [],
  };

  let broadcast = null;
  let toastTimer = null;

  const TOAST_TONES = {
    info: 'bg-[#333]/90 text-white',
    success: 'bg-emerald-500/95 text-white',
    warning: 'bg-amber-400/90 text-[#472800]',
    danger: 'bg-rose-500/95 text-white',
  };

  const ENTITY_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).replace(/[&<>"']/g, (char) => ENTITY_MAP[char] || char);
  }

  function setAdminSessionFlag(active) {
    try {
      if (active) {
        window.localStorage?.setItem(ADMIN_SESSION_KEY, 'active');
      } else {
        window.localStorage?.removeItem(ADMIN_SESSION_KEY);
      }
    } catch (error) {
      console.warn('[dashboard] failed to update admin session flag', error);
    }
  }

  function showToast(message, tone = 'info', duration = 2400) {
    if (!(elements.toast instanceof HTMLElement)) return;
    const toneClass = TOAST_TONES[tone] || TOAST_TONES.info;
    elements.toast.className =
      'pointer-events-auto w-full max-w-sm rounded-2xl px-5 py-4 text-sm font-medium shadow-2xl backdrop-blur transition ' +
      toneClass;
    elements.toast.textContent = message;
    elements.toast.classList.remove('hidden');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      elements.toast?.classList.add('hidden');
    }, duration);
  }

  function readStoredSession() {
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      console.warn('[dashboard] failed to parse stored session', error);
      return null;
    }
  }

  function getTabSessionId() {
    try {
      return window.sessionStorage?.getItem(SESSION_ID_KEY) || '';
    } catch (error) {
      console.warn('[dashboard] failed to read tab session id', error);
      return '';
    }
  }

  function ensureBroadcastChannel() {
    if (broadcast) {
      return broadcast;
    }
    try {
      broadcast = new BroadcastChannel(CHANNEL_NAME);
      broadcast.addEventListener('message', handleBroadcastMessage);
    } catch (error) {
      console.warn('[dashboard] failed to initialize channel', error);
      broadcast = null;
    }
    return broadcast;
  }

  function updateSessionDetails(session) {
    setAdminSessionFlag(true);
    if (elements.welcome instanceof HTMLElement) {
      elements.welcome.textContent = `${session.email}님, 엘리의방 관리자 공간에 오신 것을 환영합니다.`;
    }
    if (elements.sessionInfo instanceof HTMLElement) {
      try {
        const formatted = new Intl.DateTimeFormat('ko', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(session.loginTime);
        elements.sessionInfo.textContent = `로그인 시각 ${formatted}`;
      } catch (error) {
        elements.sessionInfo.textContent = '로그인 세션 확인 완료';
      }
    }
  }

  function redirectToLogin(message, tone = 'warning', delay = 1400) {
    showToast(message, tone, Math.max(delay, 900));
    if (elements.logout instanceof HTMLButtonElement) {
      elements.logout.disabled = true;
      elements.logout.textContent = '로그아웃 중…';
    }
    window.setTimeout(() => {
      window.location.replace(LOGIN_URL);
    }, Math.max(delay, 900));
  }

  function handleBroadcastMessage(event) {
    const data = event?.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'login') {
      redirectToLogin('다른 위치에서 로그인되었습니다.', 'warning');
    } else if (data.type === 'logout') {
      redirectToLogin('다른 위치에서 로그아웃되었습니다.', 'info');
    }
  }

  function handleStorageEvent(event) {
    if (!event || event.storageArea !== window.localStorage) return;
    if (event.key === null) {
      redirectToLogin('로그인 세션이 종료되었습니다.', 'info');
      return;
    }
    if (event.key !== STORAGE_KEY) {
      return;
    }
    if (!event.newValue) {
      redirectToLogin('로그인 세션이 종료되었습니다.', 'info');
      return;
    }
    try {
      const session = JSON.parse(event.newValue);
      if (!session || session.sessionId !== getTabSessionId()) {
        redirectToLogin('다른 위치에서 로그인되었습니다.', 'warning');
      }
    } catch (error) {
      console.warn('[dashboard] failed to parse sync payload', error);
    }
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) {
      return value;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) {
      return value;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }

  async function loadPeriod() {
    try {
      const response = await fetch('/api/admin/period', { credentials: 'include' });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        throw new Error('failed_to_load_period');
      }
      const payload = await response.json();
      state.period = payload?.period || null;
      renderPeriod();
    } catch (error) {
      console.error('[dashboard] failed to load period', error);
      showToast('챌린지 기간 정보를 불러오지 못했습니다.', 'danger');
    }
  }

  function renderPeriod() {
    const period = state.period;
    const today = new Date().toISOString().slice(0, 10);
    let statusLabel = '기간 미설정';
    let statusColor = '#6b4b00';
    let summary = '시작일과 종료일을 선택한 뒤 저장하면 챌린지 기준 기간이 업데이트됩니다.';
    let updated = '최근 업데이트 정보가 여기에 표시됩니다.';

    if (period && period.startDate && period.endDate) {
      const startLabel = formatDate(period.startDate);
      const endLabel = formatDate(period.endDate);
      summary = `설정된 기간: ${startLabel} ~ ${endLabel}`;
      if (period.updatedAt) {
        updated = `최근 업데이트: ${formatDateTime(period.updatedAt)} 저장`;
      }
      const ended = today > period.endDate;
      if (ended) {
        statusLabel = '⚠️ 챌린지 기간 종료됨';
        statusColor = '#b91c1c';
      } else {
        statusLabel = '진행 중';
        statusColor = '#245501';
      }
      if (elements.periodStart instanceof HTMLInputElement) {
        elements.periodStart.value = period.startDate;
      }
      if (elements.periodEnd instanceof HTMLInputElement) {
        elements.periodEnd.value = period.endDate;
      }
    } else {
      if (elements.periodStart instanceof HTMLInputElement) {
        elements.periodStart.value = '';
      }
      if (elements.periodEnd instanceof HTMLInputElement) {
        elements.periodEnd.value = '';
      }
    }

    if (elements.periodStatus instanceof HTMLElement) {
      elements.periodStatus.textContent = statusLabel;
      elements.periodStatus.style.color = statusColor;
    }
    if (elements.periodSummary instanceof HTMLElement) {
      elements.periodSummary.textContent = summary;
    }
    if (elements.periodUpdated instanceof HTMLElement) {
      elements.periodUpdated.textContent = updated;
    }
    if (elements.statusPeriod instanceof HTMLElement) {
      if (period && period.startDate && period.endDate) {
        elements.statusPeriod.textContent = `${formatDate(period.startDate)} ~ ${formatDate(period.endDate)}`;
      } else {
        elements.statusPeriod.textContent = '기간이 설정되지 않았습니다';
      }
    }
  }

  function parseCsv(text) {
    if (!text) return [];
    const lines = text.split(/?
/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(',').map((value) => value.trim().toLowerCase());
    const records = [];

    for (let index = 1; index < lines.length; index += 1) {
      const columns = lines[index].split(',').map((value) => value.trim());
      if (!columns.length) continue;
      const record = {};
      headers.forEach((header, headerIndex) => {
        record[header] = columns[headerIndex] || '';
      });
      const email =
        record.email ||
        record['e-mail'] ||
        record['메일'] ||
        record['이메일'] ||
        columns.find((value) => value.includes('@')) ||
        '';
      if (!email) continue;
      records.push({
        name: record.name || record['이름'] || '',
        email: email.toLowerCase(),
        joined_at:
          record.joined_at ||
          record.joinedat ||
          record.joined ||
          record['가입일'] ||
          record['등록일'] ||
          '',
      });
    }

    return records;
  }

  async function handleParticipantsUpload(event) {
    event.preventDefault();
    if (!(elements.participantsFile instanceof HTMLInputElement)) {
      return;
    }
    const file = elements.participantsFile.files?.[0];
    if (!file) {
      showToast('업로드할 CSV 파일을 선택해주세요.', 'warning');
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.length) {
        showToast('유효한 참가자 데이터를 찾지 못했습니다.', 'warning');
        return;
      }
      const normalized = parsed.map((item) => ({
        name: item.name || '',
        email: item.email,
        joined_at: item.joined_at || new Date().toISOString().slice(0, 10),
      }));
      const response = await fetch('/api/admin/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(normalized),
      });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        throw new Error('failed_to_upload');
      }
      elements.participantsForm?.reset();
      showToast('명단 업로드 완료', 'success');
      await Promise.all([loadParticipants(), loadStatus()]);
    } catch (error) {
      console.error('[dashboard] failed to upload participants', error);
      showToast('참가자 명단 업로드 중 오류가 발생했습니다.', 'danger');
    }
  }

  async function loadParticipants() {
    try {
      const response = await fetch('/api/admin/participants?role=%EB%AF%B8%EC%B9%98%EB%82%98', {
        credentials: 'include',
      });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        throw new Error('failed_to_load_participants');
      }
      const payload = await response.json();
      const participants = Array.isArray(payload?.participants) ? payload.participants : [];
      state.participants = participants;
      renderParticipants();
    } catch (error) {
      console.error('[dashboard] failed to load participants', error);
      showToast('참가자 정보를 불러오지 못했습니다.', 'danger');
    }
  }

  function renderParticipants() {
    if (!(elements.participantsTable instanceof HTMLElement)) return;
    const rows = state.participants.map((item) => {
      const name = escapeHtml(item.name || '-');
      const email = escapeHtml(item.email);
      const role = escapeHtml(item.role || '미치나');
      const joined = escapeHtml(formatDate(item.joinedAt || item.joined_at || ''));
      return (
        '<tr class="transition hover:bg-[#fef568]/25">' +
        '<td class="px-4 py-3 align-top text-sm font-medium text-[#333]">' +
        name +
        '</td>' +
        '<td class="px-4 py-3 align-top text-sm text-[#555]">' +
        email +
        '</td>' +
        '<td class="px-4 py-3 align-top text-sm text-[#555]">' +
        role +
        '</td>' +
        '<td class="px-4 py-3 align-top text-sm text-[#555]">' +
        joined +
        '</td>' +
        '</tr>'
      );
    });
    if (!rows.length) {
      elements.participantsTable.innerHTML =
        '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-[#777]">등록된 참가자 정보가 없습니다.</td></tr>';
    } else {
      elements.participantsTable.innerHTML = rows.join('');
    }
    if (elements.participantsCount instanceof HTMLElement) {
      elements.participantsCount.textContent = `${state.participants.length}명`;
    }
    if (elements.participantsMessage instanceof HTMLElement) {
      if (state.participants.length) {
        elements.participantsMessage.textContent = `최근 불러온 참가자 ${state.participants.length}명`;
      } else {
        elements.participantsMessage.textContent = '최근 업로드 내역이 여기에 표시됩니다.';
      }
    }
  }

  async function loadStatus() {
    try {
      const response = await fetch('/api/admin/michina-status', { credentials: 'include' });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        throw new Error('failed_to_load_status');
      }
      const payload = await response.json();
      state.status = payload;
      renderStatus();
    } catch (error) {
      console.error('[dashboard] failed to load michina status', error);
      showToast('미치나 현황을 불러오지 못했습니다.', 'danger');
    }
  }

  function renderStatus() {
    const status = state.status || { total: 0, active: 0, expired: 0, period: null };
    const total = Number(status.total || 0);
    const active = Number(status.active || 0);
    const expired = Number(status.expired || 0);

    if (elements.statusTotal instanceof HTMLElement) {
      elements.statusTotal.textContent = total.toLocaleString();
    }
    if (elements.statusActive instanceof HTMLElement) {
      elements.statusActive.textContent = active.toLocaleString();
    }
    if (elements.statusExpired instanceof HTMLElement) {
      elements.statusExpired.textContent = expired.toLocaleString();
    }
    if (elements.statusPeriod instanceof HTMLElement) {
      const period = status.period;
      if (period && period.startDate && period.endDate) {
        elements.statusPeriod.textContent = `${formatDate(period.startDate)} ~ ${formatDate(period.endDate)}`;
      } else {
        elements.statusPeriod.textContent = '기간이 설정되지 않았습니다';
      }
    }

    const ratio = total > 0 ? Math.round((active / total) * 100) : 0;
    if (elements.statusChart instanceof HTMLElement) {
      elements.statusChart.style.background = `conic-gradient(#d6f8a1 ${ratio}%, #fcd1c5 ${ratio}% 100%)`;
    }
    if (elements.statusChartLabel instanceof HTMLElement) {
      elements.statusChartLabel.textContent = `${ratio}%`;
    }
    if (elements.statusDescription instanceof HTMLElement) {
      const lines = [];
      if (total === 0) {
        lines.push('미치나 챌린저 데이터가 아직 등록되지 않았습니다.');
      } else {
        lines.push(`총 ${total.toLocaleString()}명의 미치나 참여자를 관리 중입니다.`);
        lines.push(`현재 ${active.toLocaleString()}명이 챌린지 기간 내에 있으며 ${expired.toLocaleString()}명은 종료 상태입니다.`);
      }
      elements.statusDescription.innerHTML = '<li>' + lines.join('</li><li>') + '</li>';
    }
  }

  async function loadUsers() {
    try {
      const response = await fetch('/api/admin/users', { credentials: 'include' });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        throw new Error('failed_to_load_users');
      }
      const payload = await response.json();
      const users = Array.isArray(payload?.users) ? payload.users : [];
      state.users = users;
      renderUsers();
    } catch (error) {
      console.error('[dashboard] failed to load users', error);
      showToast('사용자 정보를 불러오지 못했습니다.', 'danger');
    }
  }

  function renderUsers() {
    if (!(elements.usersTable instanceof HTMLElement)) return;
    const rows = state.users.map((user) => {
      const name = escapeHtml(user.name || '-');
      const email = escapeHtml(user.email);
      const role = escapeHtml(user.role || '-');
      const lastLogin = escapeHtml(formatDateTime(user.lastLogin));
      return (
        '<tr class="transition hover:bg-[#fef568]/25">' +
        '<td class="px-4 py-3 align-top text-sm font-medium text-[#333]">' +
        name +
        '</td>' +
        '<td class="px-4 py-3 align-top text-sm text-[#555]">' +
        email +
        '</td>' +
        '<td class="px-4 py-3 align-top text-sm text-[#555]">' +
        role +
        '</td>' +
        '<td class="px-4 py-3 align-top text-sm text-[#555]">' +
        lastLogin +
        '</td>' +
        '</tr>'
      );
    });
    if (!rows.length) {
      elements.usersTable.innerHTML =
        '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-[#777]">불러온 사용자 정보가 없습니다.</td></tr>';
    } else {
      elements.usersTable.innerHTML = rows.join('');
    }
    if (elements.usersCount instanceof HTMLElement) {
      elements.usersCount.textContent = `${state.users.length}명`;
    }
  }

  async function handlePeriodSubmit(event) {
    event.preventDefault();
    if (!(elements.periodStart instanceof HTMLInputElement) || !(elements.periodEnd instanceof HTMLInputElement)) {
      return;
    }
    const startDate = elements.periodStart.value;
    const endDate = elements.periodEnd.value;
    if (!startDate || !endDate) {
      showToast('시작일과 종료일을 모두 선택해주세요.', 'warning');
      return;
    }
    try {
      const response = await fetch('/api/admin/period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ startDate, endDate }),
      });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        throw new Error('failed_to_save_period');
      }
      const payload = await response.json();
      state.period = payload?.period || { startDate, endDate };
      renderPeriod();
      showToast('챌린지 기간이 저장되었습니다.', 'success');
      await loadStatus();
    } catch (error) {
      console.error('[dashboard] failed to save period', error);
      showToast('챌린지 기간을 저장하지 못했습니다.', 'danger');
    }
  }

  async function handleLogoutClick() {
    if (!(elements.logout instanceof HTMLButtonElement)) return;
    elements.logout.disabled = true;
    elements.logout.textContent = '로그아웃 중…';
    showToast('로그아웃을 진행하고 있습니다…', 'info');
    try {
      await fetch('/api/auth/admin/logout', { method: 'POST', credentials: 'include' });
    } catch (error) {
      console.warn('[dashboard] logout request failed', error);
    }
    try {
      window.localStorage?.clear();
    } catch (error) {
      console.warn('[dashboard] failed to clear storage', error);
    }
    try {
      window.sessionStorage?.removeItem(SESSION_ID_KEY);
    } catch (error) {
      console.warn('[dashboard] failed to clear session id', error);
    }
    setAdminSessionFlag(false);
    ensureBroadcastChannel();
    try {
      broadcast?.postMessage({ type: 'logout' });
    } catch (error) {
      console.warn('[dashboard] failed to broadcast logout', error);
    }
    showToast('로그아웃되었습니다. 로그인 페이지로 이동합니다.', 'success', 1100);
    window.setTimeout(() => {
      window.location.replace(LOGIN_URL);
    }, 1100);
  }

  const activeSession = readStoredSession();
  if (!activeSession || activeSession.email !== ADMIN_EMAIL) {
    redirectToLogin('관리자 세션을 확인할 수 없습니다. 다시 로그인해주세요.', 'warning', 1200);
    return;
  }
  if (!activeSession.sessionId || activeSession.sessionId !== getTabSessionId()) {
    redirectToLogin('다른 위치에서 로그인되었습니다.', 'warning', 1200);
    return;
  }

  updateSessionDetails(activeSession);
  ensureBroadcastChannel();
  window.addEventListener('storage', handleStorageEvent);

  if (elements.logout instanceof HTMLButtonElement) {
    elements.logout.addEventListener('click', handleLogoutClick);
  }
  if (elements.periodForm instanceof HTMLFormElement) {
    elements.periodForm.addEventListener('submit', handlePeriodSubmit);
  }
  if (elements.participantsForm instanceof HTMLFormElement) {
    elements.participantsForm.addEventListener('submit', handleParticipantsUpload);
  }

  Promise.all([loadPeriod(), loadParticipants(), loadStatus(), loadUsers()]).catch((error) => {
    console.warn('[dashboard] initialization warning', error);
  });
})();
