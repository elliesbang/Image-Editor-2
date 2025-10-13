(() => {
  const STORAGE_KEY = 'adminSessionState';
  const SESSION_ID_KEY = 'adminSessionId';
  const CHANNEL_NAME = 'admin-auth-channel';
  const ADMIN_SESSION_KEY = 'admin_session';
  const ADMIN_EMAIL = document.body?.dataset?.adminEmail || 'admin@local';
  const LOGIN_URL = new URL('/admin-login/', window.location.origin).toString();

  const DEFAULT_UPLOAD_FILENAME = '선택된 파일이 없습니다.';

  const MESSAGE_TONES = {
    info: 'text-[#6f5a26]',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-rose-600',
  };

  const TOAST_TONES = {
    info: 'bg-[#333]/90 text-white',
    success: 'bg-emerald-500/95 text-white',
    warning: 'bg-amber-400/90 text-[#472800]',
    danger: 'bg-rose-500/95 text-white',
  };

  const MESSAGE_TONE_CLASS_LIST = Object.values(MESSAGE_TONES)
    .map((value) => value.split(' '))
    .flat();

  const elements = {
    toast: document.querySelector('[data-role="dashboard-toast"]'),
    welcome: document.querySelector('[data-role="welcome"]'),
    sessionInfo: document.querySelector('[data-role="session-info"]'),
    logout: document.querySelector('[data-role="logout"]'),
    periodForm: document.querySelector('[data-role="challenge-form"]'),
    periodStart: document.querySelector('[data-role="start"]'),
    periodEnd: document.querySelector('[data-role="end"]'),
    periodSubmit: document.querySelector('[data-role="challenge-form"] button[type="submit"]'),
    periodList: document.querySelector('[data-role="challenge-list"]'),
    periodDelete: document.querySelector('[data-role="challenge-delete"]'),
    uploadHint: document.querySelector('[data-role="upload-hint"]'),
    participantsForm: document.querySelector('[data-role="participants-form"]'),
    participantsFile: document.querySelector('[data-role="participants-file"]'),
    participantsFilename: document.querySelector('[data-role="participants-filename"]'),
    participantsUploadButton: document.querySelector('[data-role="participants-upload"]'),
    participantsStatus: document.querySelector('[data-role="participants-status"]'),
    participantsTable: document.querySelector('[data-role="participants-table"]'),
    participantsCount: document.querySelector('[data-role="participants-count"]'),
    participantsMessage: document.querySelector('[data-role="participants-message"]'),
  };

  const state = {
    periods: [],
    isSavingPeriod: false,
    isDeletingPeriod: false,
    selectedPeriodId: null,
    participants: [],
    isUploading: false,
  };

  let toastTimer = null;
  let broadcast = null;

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return char;
      }
    });
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

  function setStatusMessage(element, message, tone = 'info') {
    if (!(element instanceof HTMLElement)) return;
    element.classList.remove(...MESSAGE_TONE_CLASS_LIST);
    const toneClass = MESSAGE_TONES[tone] || MESSAGE_TONES.info;
    toneClass
      .split(' ')
      .filter(Boolean)
      .forEach((className) => element.classList.add(className));
    element.textContent = message;
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) return value;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
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
    if (broadcast) return broadcast;
    try {
      broadcast = new BroadcastChannel(CHANNEL_NAME);
      broadcast.addEventListener('message', handleBroadcastMessage);
    } catch (error) {
      console.warn('[dashboard] failed to initialize channel', error);
      broadcast = null;
    }
    return broadcast;
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
    if (event.key !== STORAGE_KEY) return;
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
        }).format(new Date(session.loginTime));
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

  function normalizePeriods(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const idRaw = item.id ?? item.ID ?? item.period_id;
        const id = Number(idRaw);
        const start = typeof item.startDate === 'string' ? item.startDate : typeof item.start_date === 'string' ? item.start_date : '';
        const end = typeof item.endDate === 'string' ? item.endDate : typeof item.end_date === 'string' ? item.end_date : '';
        const saved = typeof item.savedAt === 'string' ? item.savedAt : typeof item.saved_at === 'string' ? item.saved_at : '';
        if (!Number.isFinite(id) || !start || !end || !saved) return null;
        return { id, startDate: start, endDate: end, savedAt: saved };
      })
      .filter((value) => value !== null)
      .sort((a, b) => {
        const savedDiff = String(b.savedAt).localeCompare(String(a.savedAt));
        if (savedDiff !== 0) return savedDiff;
        return Number(b.id) - Number(a.id);
      });
  }

  function normalizeParticipants(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const id = Number(item.id ?? item.ID ?? 0);
        const name = typeof item.name === 'string' ? item.name : '';
        const email = typeof item.email === 'string' ? item.email : '';
        const approved =
          typeof item.approvedAt === 'string' ? item.approvedAt : typeof item.approved_at === 'string' ? item.approved_at : '';
        if (!email) return null;
        return { id, name, email, approvedAt: approved };
      })
      .filter((value) => value !== null)
      .sort((a, b) => {
        const approvedDiff = String(b.approvedAt).localeCompare(String(a.approvedAt));
        if (approvedDiff !== 0) return approvedDiff;
        return Number(b.id) - Number(a.id);
      });
  }

  function applyLatestPeriodToInputs(latest) {
    if (!(elements.periodStart instanceof HTMLInputElement) || !(elements.periodEnd instanceof HTMLInputElement)) {
      return;
    }
    if (!latest) {
      if (!elements.periodStart.matches(':focus')) {
        elements.periodStart.value = '';
      }
      if (!elements.periodEnd.matches(':focus')) {
        elements.periodEnd.value = '';
      }
      return;
    }
    if ((!elements.periodStart.value || !elements.periodStart.matches(':focus')) && latest.startDate) {
      elements.periodStart.value = latest.startDate;
    }
    if ((!elements.periodEnd.value || !elements.periodEnd.matches(':focus')) && latest.endDate) {
      elements.periodEnd.value = latest.endDate;
    }
  }

  function renderPeriods() {
    const list = elements.periodList;
    if (!(list instanceof HTMLElement)) return;

    if (!state.periods.length) {
      state.selectedPeriodId = null;
      list.innerHTML = '<li class="challenge-list__empty">저장된 챌린지 기간이 없습니다.</li>';
      applyLatestPeriodToInputs(null);
      updatePeriodButtons();
      return;
    }

    if (!state.periods.some((period) => period.id === state.selectedPeriodId)) {
      state.selectedPeriodId = state.periods[0]?.id ?? null;
    }

    const rows = state.periods.map((period) => {
      const range =
        `${escapeHtml(formatDateTime(period.startDate))} ~ ${escapeHtml(formatDateTime(period.endDate))}`;
      const saved = escapeHtml(formatDateTime(period.savedAt));
      const checked = state.selectedPeriodId === period.id ? ' checked' : '';
      return (
        '<li class="challenge-list__item">' +
        '<label class="flex cursor-pointer items-start gap-3">' +
        `<input type="radio" name="challenge-period" value="${escapeHtml(String(period.id))}"${checked} />` +
        '<span class="challenge-list__info">' +
        `<span class="challenge-list__range">${range}</span>` +
        `<span class="challenge-list__saved">저장 ${saved}</span>` +
        '</span>' +
        '</label>' +
        '</li>'
      );
    });
    list.innerHTML = rows.join('');

    const latest = state.periods[0] || null;
    applyLatestPeriodToInputs(latest);
    updatePeriodButtons();
  }

  function renderParticipants() {
    if (!(elements.participantsTable instanceof HTMLElement)) return;
    if (!(elements.participantsCount instanceof HTMLElement)) return;
    if (!(elements.participantsMessage instanceof HTMLElement)) return;

    if (!state.participants.length) {
      elements.participantsTable.innerHTML =
        '<tr><td colspan="3" class="px-4 py-6 text-center text-sm text-[#7a5a00]">등록된 참가자 정보가 없습니다.</td></tr>';
      elements.participantsCount.textContent = '0명';
      elements.participantsMessage.textContent = '등록된 참가자 정보가 없습니다.';
      return;
    }

    const rows = state.participants.map((participant) => {
      const name = participant.name ? escapeHtml(participant.name) : '-';
      const email = escapeHtml(participant.email);
      const approved = escapeHtml(formatDateTime(participant.approvedAt));
      return (
        '<tr class="transition hover:bg-[#fef568]/20">' +
        `<td class="px-4 py-3 text-sm font-medium text-[#3f2f00]">${name}</td>` +
        `<td class="px-4 py-3 text-sm text-[#6f5a26]">${email}</td>` +
        `<td class="px-4 py-3 text-sm text-[#6f5a26]">${approved}</td>` +
        '</tr>'
      );
    });
    elements.participantsTable.innerHTML = rows.join('');
    elements.participantsCount.textContent = `${state.participants.length}명`;
    elements.participantsMessage.textContent = `최근 등록된 참가자 ${state.participants.length}명`;
  }

  function updatePeriodButtons() {
    if (elements.periodSubmit instanceof HTMLButtonElement) {
      if (state.isSavingPeriod) {
        elements.periodSubmit.disabled = true;
        elements.periodSubmit.textContent = '저장 중…';
      } else {
        elements.periodSubmit.disabled = false;
        elements.periodSubmit.textContent = '저장';
      }
    }
    if (elements.periodDelete instanceof HTMLButtonElement) {
      if (state.isDeletingPeriod) {
        elements.periodDelete.disabled = true;
        elements.periodDelete.textContent = '삭제 중…';
      } else {
        const disabled = state.periods.length === 0 || !Number.isFinite(state.selectedPeriodId);
        elements.periodDelete.disabled = disabled;
        elements.periodDelete.textContent = '선택된 기간 삭제';
      }
    }
  }

  function updateUploadAvailability() {
    const hasPeriod = state.periods.length > 0;
    if (elements.participantsUploadButton instanceof HTMLButtonElement) {
      elements.participantsUploadButton.disabled = !hasPeriod || state.isUploading;
      elements.participantsUploadButton.textContent = state.isUploading ? '업로드 중…' : '명단 업로드';
    }
    if (elements.participantsFile instanceof HTMLInputElement) {
      elements.participantsFile.disabled = !hasPeriod || state.isUploading;
    }
    if (elements.uploadHint instanceof HTMLElement) {
      if (hasPeriod) {
        elements.uploadHint.textContent = 'CSV 파일(name,email)을 업로드하면 참가자 명단이 저장됩니다.';
        elements.uploadHint.classList.remove('text-amber-600');
      } else {
        elements.uploadHint.textContent = '챌린지 기간을 먼저 저장해야 참가자 명단을 업로드할 수 있습니다.';
        elements.uploadHint.classList.add('text-amber-600');
      }
    }
  }

  async function loadPeriods() {
    try {
      const response = await fetch('/api/admin/challenge-periods', { credentials: 'include' });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) throw new Error('failed_to_load_periods');
      const payload = await response.json().catch(() => ({}));
      state.periods = normalizePeriods(payload?.periods);
      state.selectedPeriodId = state.periods[0]?.id ?? null;
    } catch (error) {
      console.error('[dashboard] failed to load challenge periods', error);
      state.periods = [];
      state.selectedPeriodId = null;
      showToast('챌린지 기간 정보를 불러오지 못했습니다.', 'danger');
    }
    renderPeriods();
    updatePeriodButtons();
    updateUploadAvailability();
  }

  async function handlePeriodSubmit(event) {
    event.preventDefault();
    if (state.isSavingPeriod) return;
    const start = elements.periodStart instanceof HTMLInputElement ? elements.periodStart.value : '';
    const end = elements.periodEnd instanceof HTMLInputElement ? elements.periodEnd.value : '';
    if (!start || !end) {
      showToast('시작일과 종료일을 모두 선택해주세요.', 'warning');
      return;
    }
    if (start > end) {
      showToast('종료일은 시작일 이후여야 합니다.', 'warning');
      return;
    }
    state.isSavingPeriod = true;
    updatePeriodButtons();
    try {
      const response = await fetch('/api/admin/challenge-periods', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: start, endDate: end }),
      });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload?.message === 'string' ? payload.message : '챌린지 기간을 저장하지 못했습니다.';
        throw new Error(message);
      }
      const payload = await response.json().catch(() => ({}));
      state.periods = normalizePeriods(payload?.periods);
      state.selectedPeriodId = state.periods[0]?.id ?? null;
      renderPeriods();
      showToast('챌린지 기간이 저장되었습니다.', 'success');
    } catch (error) {
      console.error('[dashboard] failed to save challenge period', error);
      showToast('챌린지 기간을 저장하지 못했습니다.', 'danger');
    } finally {
      state.isSavingPeriod = false;
      updatePeriodButtons();
      updateUploadAvailability();
    }
  }

  async function handlePeriodDelete(id) {
    if (!Number.isFinite(id) || !id) return false;
    try {
      const response = await fetch(`/api/admin/challenge-periods/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return false;
      }
      if (!response.ok) throw new Error('failed_to_delete_period');
      const payload = await response.json().catch(() => ({}));
      state.periods = normalizePeriods(payload?.periods);
      if (!state.periods.some((period) => period.id === state.selectedPeriodId)) {
        state.selectedPeriodId = state.periods[0]?.id ?? null;
      }
      renderPeriods();
      showToast('선택한 챌린지 기간을 삭제했습니다.', 'success');
      return true;
    } catch (error) {
      console.error('[dashboard] failed to delete challenge period', error);
      showToast('챌린지 기간을 삭제하지 못했습니다.', 'danger');
      return false;
    } finally {
      updatePeriodButtons();
      updateUploadAvailability();
    }
  }

  async function handlePeriodClear() {
    if (state.periods.length === 0) {
      showToast('삭제할 기간이 없습니다.', 'warning');
      return;
    }
    if (!Number.isFinite(state.selectedPeriodId)) {
      showToast('삭제할 기간을 선택해주세요.', 'warning');
      return;
    }
    const confirmed = window.confirm('선택한 챌린지 기간을 삭제하시겠어요?');
    if (!confirmed) return;
    state.isDeletingPeriod = true;
    updatePeriodButtons();
    const deleted = await handlePeriodDelete(Number(state.selectedPeriodId));
    state.isDeletingPeriod = false;
    updatePeriodButtons();
    if (deleted) {
      updateUploadAvailability();
    }
  }

  function handlePeriodSelectionChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name !== 'challenge-period') return;
    const id = Number(target.value);
    if (!Number.isFinite(id)) return;
    state.selectedPeriodId = id;
    updatePeriodButtons();
  }

  function splitCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells.map((value) => value.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
  }

  function parseCsv(text) {
    if (typeof text !== 'string') return [];
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return [];
    const headerCells = splitCsvLine(lines[0].replace(/﻿/g, ''));
    const normalizedHeaders = headerCells.map((value) => value.toLowerCase());
    const emailIndex = normalizedHeaders.findIndex((value) => value.includes('email') || value.includes('이메일'));
    if (emailIndex === -1) return [];
    const nameIndex = normalizedHeaders.findIndex((value) => value.includes('name') || value.includes('이름'));
    const map = new Map();
    for (let i = 1; i < lines.length; i += 1) {
      const cells = splitCsvLine(lines[i]);
      if (emailIndex >= cells.length) continue;
      const rawEmail = cells[emailIndex] ? cells[emailIndex].trim().toLowerCase() : '';
      if (!rawEmail || !rawEmail.includes('@')) continue;
      const name = nameIndex >= 0 && cells[nameIndex] ? cells[nameIndex].trim() : '';
      map.set(rawEmail, { name, email: rawEmail });
    }
    return Array.from(map.values());
  }

  async function loadParticipants() {
    try {
      const response = await fetch('/api/admin/michina-list', { credentials: 'include' });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) throw new Error('failed_to_load_participants');
      const payload = await response.json().catch(() => ({}));
      state.participants = normalizeParticipants(payload?.entries);
    } catch (error) {
      console.error('[dashboard] failed to load participants', error);
      state.participants = [];
      showToast('참가자 정보를 불러오지 못했습니다.', 'danger');
    }
    renderParticipants();
  }

  async function handleParticipantsUpload(event) {
    event.preventDefault();
    if (state.isUploading) return;
    if (state.periods.length === 0) {
      showToast('챌린지 기간을 먼저 설정해주세요.', 'warning');
      return;
    }
    const file = elements.participantsFile instanceof HTMLInputElement ? elements.participantsFile.files?.[0] : null;
    if (!file) {
      showToast('업로드할 CSV 파일을 선택해주세요.', 'warning');
      return;
    }
    let entries = [];
    try {
      const text = await file.text();
      entries = parseCsv(text);
    } catch (error) {
      console.error('[dashboard] failed to read csv', error);
      showToast('CSV 파일을 읽지 못했습니다.', 'danger');
      return;
    }
    if (entries.length === 0) {
      setStatusMessage(elements.participantsStatus, 'CSV에서 유효한 참가자 정보를 찾지 못했습니다.', 'warning');
      showToast('CSV에서 참가자 정보를 찾지 못했습니다.', 'warning');
      return;
    }
    state.isUploading = true;
    updateUploadAvailability();
    setStatusMessage(elements.participantsStatus, '참가자 명단을 업로드하고 있습니다…', 'info');
    try {
      const response = await fetch('/api/admin/michina-list', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload?.message === 'string' ? payload.message : '참가자 명단을 저장하지 못했습니다.';
        throw new Error(message);
      }
      const payload = await response.json().catch(() => ({}));
      state.participants = normalizeParticipants(payload?.entries);
      renderParticipants();
      setStatusMessage(elements.participantsStatus, '참가자 명단이 저장되었습니다.', 'success');
      showToast('참가자 명단이 업로드되었습니다.', 'success');
      if (elements.participantsForm instanceof HTMLFormElement) {
        elements.participantsForm.reset();
      }
      if (elements.participantsFilename instanceof HTMLElement) {
        elements.participantsFilename.textContent = DEFAULT_UPLOAD_FILENAME;
      }
    } catch (error) {
      console.error('[dashboard] failed to upload participants', error);
      setStatusMessage(
        elements.participantsStatus,
        error instanceof Error ? error.message : '참가자 명단을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.',
        'danger',
      );
      showToast('참가자 명단을 업로드하지 못했습니다.', 'danger');
    } finally {
      state.isUploading = false;
      updateUploadAvailability();
    }
  }

  function handleFileChange() {
    if (!(elements.participantsFile instanceof HTMLInputElement)) return;
    const file = elements.participantsFile.files?.[0];
    if (elements.participantsFilename instanceof HTMLElement) {
      elements.participantsFilename.textContent = file ? file.name : DEFAULT_UPLOAD_FILENAME;
    }
    if (!file) {
      setStatusMessage(elements.participantsStatus, 'CSV 파일을 선택하면 상태가 표시됩니다.', 'info');
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
    showToast('로그아웃되었습니다. 로그인 화면으로 이동합니다.', 'success', 1100);
    window.setTimeout(() => {
      window.location.replace(LOGIN_URL);
    }, 1100);
  }

  function initialize() {
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
    if (elements.periodDelete instanceof HTMLButtonElement) {
      elements.periodDelete.addEventListener('click', handlePeriodClear);
    }
    if (elements.periodList instanceof HTMLElement) {
      elements.periodList.addEventListener('change', handlePeriodSelectionChange);
    }
    if (elements.participantsForm instanceof HTMLFormElement) {
      elements.participantsForm.addEventListener('submit', handleParticipantsUpload);
    }
    if (elements.participantsFile instanceof HTMLInputElement) {
      elements.participantsFile.addEventListener('change', handleFileChange);
    }
    if (elements.participantsFilename instanceof HTMLElement) {
      elements.participantsFilename.textContent = DEFAULT_UPLOAD_FILENAME;
    }

    setStatusMessage(elements.participantsStatus, 'CSV 파일을 선택하면 상태가 표시됩니다.', 'info');
    renderParticipants();
    updatePeriodButtons();
    updateUploadAvailability();

    Promise.all([loadPeriods(), loadParticipants()]).catch((error) => {
      console.warn('[dashboard] initialization warning', error);
    });
  }

  initialize();
})();
