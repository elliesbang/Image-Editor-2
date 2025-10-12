(() => {
  const STORAGE_KEY = 'adminSessionState';
  const SESSION_ID_KEY = 'adminSessionId';
  const CHANNEL_NAME = 'admin-auth-channel';
  const ADMIN_SESSION_KEY = 'admin_session';
  const ADMIN_EMAIL = document.body?.dataset?.adminEmail || 'admin@local';
  const LOGIN_URL = new URL('/login.html', window.location.origin).toString();

  const DEFAULT_UPLOAD_FILENAME = '선택된 파일이 없습니다.';
  const DEFAULT_PERIOD_DELETE_LABEL = '기간 초기화';
  const DEFAULT_PERIOD_SAVE_LABEL = '저장';

  const MESSAGE_TONES = {
    info: 'text-[#6f5a26]',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-red-500',
  };

  const PERIOD_UPDATED_TONES = {
    info: 'text-[#8c7a4f]',
    success: 'text-emerald-700',
    warning: 'text-amber-600',
    danger: 'text-rose-600',
  };

  const BADGE_TONES = {
    info: 'bg-primary/80 text-[#3f2f00]',
    success: 'bg-emerald-200 text-emerald-800',
    warning: 'bg-amber-200 text-amber-800',
    danger: 'bg-rose-200 text-rose-800',
  };

  const MESSAGE_TONE_CLASS_LIST = Object.values(MESSAGE_TONES)
    .map((value) => value.split(' '))
    .flat();
  const PERIOD_UPDATED_TONE_CLASS_LIST = Object.values(PERIOD_UPDATED_TONES)
    .map((value) => value.split(' '))
    .flat();
  const BADGE_TONE_CLASS_LIST = Object.values(BADGE_TONES)
    .map((value) => value.split(' '))
    .flat();

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
    periodSubmit: document.querySelector('[data-role="period-form"] button[type="submit"]'),
    periodHistory: document.querySelector('[data-role="period-history"]'),
    periodHistoryEmpty: document.querySelector('[data-role="period-history-empty"]'),
    periodDelete: document.querySelector('[data-role="period-delete"]'),
    participantsForm: document.querySelector('[data-role="participants-form"]'),
    participantsFile: document.querySelector('[data-role="participants-file"]'),
    participantsFilename: document.querySelector('[data-role="participants-filename"]'),
    participantsStatus: document.querySelector('[data-role="participants-status"]'),
    participantsMessage: document.querySelector('[data-role="participants-message"]'),
    participantsTable: document.querySelector('[data-role="participants-table"]'),
    participantsCount: document.querySelector('[data-role="participants-count"]'),
    participantsDelete: document.querySelector('[data-role="participants-delete"]'),
    participantsUploadButton: document.querySelector('[data-role="participants-form"] button[type="submit"]'),
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
    periodHistory: [],
    participants: [],
    status: null,
    users: [],
    isUploading: false,
    isDeleting: false,
    isDeletingPeriod: false,
    isSavingPeriod: false,
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

  function setBadgeTone(element, tone = 'info') {
    if (!(element instanceof HTMLElement)) return;
    element.classList.remove(...BADGE_TONE_CLASS_LIST);
    const toneClass = BADGE_TONES[tone] || BADGE_TONES.info;
    toneClass
      .split(' ')
      .filter(Boolean)
      .forEach((className) => element.classList.add(className));
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

  function setPeriodUpdatedMessage(message, tone = 'info') {
    if (!(elements.periodUpdated instanceof HTMLElement)) {
      return;
    }
    elements.periodUpdated.classList.remove(...PERIOD_UPDATED_TONE_CLASS_LIST);
    const toneClass = PERIOD_UPDATED_TONES[tone] || PERIOD_UPDATED_TONES.info;
    toneClass
      .split(' ')
      .filter(Boolean)
      .forEach((className) => elements.periodUpdated.classList.add(className));
    elements.periodUpdated.textContent = message;
  }

  function updatePeriodSaveButton() {
    if (!(elements.periodSubmit instanceof HTMLButtonElement)) {
      return;
    }
    if (state.isSavingPeriod) {
      elements.periodSubmit.disabled = true;
      elements.periodSubmit.textContent = '저장 중…';
    } else {
      elements.periodSubmit.disabled = false;
      elements.periodSubmit.textContent = DEFAULT_PERIOD_SAVE_LABEL;
    }
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

  function formatCount(value) {
    const numberValue = Number.isFinite(Number(value)) ? Number(value) : 0;
    return numberValue.toLocaleString('ko-KR');
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
      state.periodHistory = Array.isArray(payload?.periods) ? payload.periods : [];
      renderPeriod();
      renderPeriodHistory();
    } catch (error) {
      console.error('[dashboard] failed to load period', error);
      state.period = null;
      state.periodHistory = [];
      renderPeriod();
      renderPeriodHistory();
      showToast('챌린지 기간 정보를 불러오지 못했습니다.', 'danger');
    }
  }

  function renderPeriod() {
    const period = state.period;
    const today = new Date().toISOString().slice(0, 10);
    let statusLabel = '기간 미설정';
    let statusTone = 'warning';
    let summary = '시작일과 종료일을 선택한 뒤 저장하면 챌린지 기준 기간이 업데이트됩니다.';
    let updated = '최근 업데이트 정보가 여기에 표시됩니다.';
    let startLabel = '';
    let endLabel = '';

    if (period && period.startDate && period.endDate) {
      startLabel = formatDate(period.startDate);
      endLabel = formatDate(period.endDate);
      summary = `설정된 기간: ${startLabel} ~ ${endLabel}`;
      if (period.updatedAt) {
        const updatedByLabel = period.updatedBy ? ` · 담당 ${period.updatedBy}` : '';
        updated = `최근 업데이트: ${formatDateTime(period.updatedAt)} 저장${updatedByLabel}`;
      }
      const ended = today > period.endDate;
      const upcoming = today < period.startDate;
      if (ended) {
        statusLabel = '⚠️ 챌린지 기간 종료됨';
        statusTone = 'danger';
      } else if (upcoming) {
        statusLabel = '시작 예정';
        statusTone = 'info';
      } else {
        statusLabel = '진행 중';
        statusTone = 'success';
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
      setBadgeTone(elements.periodStatus, statusTone);
    }
    if (elements.periodSummary instanceof HTMLElement) {
      elements.periodSummary.textContent = summary;
    }
    setPeriodUpdatedMessage(
      updated,
      period && period.startDate && period.endDate ? 'info' : 'warning',
    );
    if (elements.periodDelete instanceof HTMLButtonElement) {
      const hasPeriod = Boolean(period && period.startDate && period.endDate);
      if (state.isDeletingPeriod) {
        elements.periodDelete.disabled = true;
      } else {
        elements.periodDelete.disabled = !hasPeriod;
        elements.periodDelete.textContent = DEFAULT_PERIOD_DELETE_LABEL;
      }
    }
    if (elements.statusPeriod instanceof HTMLElement) {
      if (startLabel && endLabel) {
        elements.statusPeriod.textContent = `${startLabel} ~ ${endLabel}`;
        setBadgeTone(elements.statusPeriod, statusTone === 'danger' ? 'danger' : 'success');
      } else {
        elements.statusPeriod.textContent = '기간이 설정되지 않았습니다';
        setBadgeTone(elements.statusPeriod, 'warning');
      }
    }
    updatePeriodSaveButton();
  }

  function renderPeriodHistory() {
    const history = Array.isArray(state.periodHistory) ? state.periodHistory : [];
    if (elements.periodHistory instanceof HTMLElement) {
      if (history.length === 0) {
        elements.periodHistory.innerHTML = '';
        elements.periodHistory.setAttribute('hidden', 'true');
      } else {
        const rows = history.map((item, index) => {
          const start = formatDate(item.startDate);
          const end = formatDate(item.endDate);
          const range = `${start} ~ ${end}`;
          const details = [];
          const updatedLabel = formatDateTime(item.updatedAt);
          if (updatedLabel && updatedLabel !== '-') {
            details.push(`저장 ${escapeHtml(updatedLabel)}`);
          }
          if (item.updatedBy) {
            details.push(`담당 ${escapeHtml(item.updatedBy)}`);
          }
          const isLatest = index === 0;
          const badge = isLatest
            ? '<span class="ml-2 inline-flex items-center rounded-full bg-primary/80 px-2 py-0.5 text-[10px] font-semibold text-[#3f2f00]">현재 적용</span>'
            : '';
          const itemClasses =
            'rounded-2xl border border-[#f0dba5] bg-white/90 p-3 shadow-inner' +
            (isLatest ? ' ring-2 ring-primary/40' : '');
          return (
            `<li class="${itemClasses}">` +
            '<p class="text-sm font-semibold text-[#3f2f00]">' +
            escapeHtml(range) +
            '</p>' +
            badge +
            (details.length
              ? '<p class="mt-1 text-xs text-[#7a5a00]">' + details.join(' · ') + '</p>'
              : '') +
            '</li>'
          );
        });
        elements.periodHistory.innerHTML = rows.join('');
        elements.periodHistory.removeAttribute('hidden');
      }
    }
    if (elements.periodHistoryEmpty instanceof HTMLElement) {
      if (history.length === 0) {
        elements.periodHistoryEmpty.removeAttribute('hidden');
      } else {
        elements.periodHistoryEmpty.setAttribute('hidden', 'true');
      }
    }
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
    if (lines.length < 2) return [];

    const headerCells = splitCsvLine(lines[0].replace(/﻿/g, ''));
    const normalizedHeaders = headerCells.map((value) => value.toLowerCase());
    const emailIndex = normalizedHeaders.findIndex((value) => value.includes('이메일') || value === 'email');
    if (emailIndex === -1) {
      return [];
    }
    const nameIndex = normalizedHeaders.findIndex((value) => value.includes('이름') || value === 'name');
    const joinedIndex = normalizedHeaders.findIndex(
      (value) =>
        value.includes('등록일') ||
        value.includes('가입') ||
        value === 'joined_at' ||
        value === 'joined',
    );
    const records = [];
    for (let index = 1; index < lines.length; index += 1) {
      const cells = splitCsvLine(lines[index]);
      if (cells.every((value) => value.trim() === '')) {
        continue;
      }
      const emailRaw = cells[emailIndex] ? cells[emailIndex].trim().toLowerCase() : '';
      if (!emailRaw.includes('@')) {
        continue;
      }
      const name = nameIndex >= 0 && cells[nameIndex] ? cells[nameIndex].trim() : '';
      const joinedRaw = joinedIndex >= 0 && cells[joinedIndex] ? cells[joinedIndex].trim() : '';
      records.push({
        name,
        email: emailRaw,
        joined_at: joinedRaw,
      });
    }
    return records;

  async function handleParticipantsUpload(event) {
    event.preventDefault();
    if (state.isUploading || state.isDeleting) {
      return;
    }

    const fileInput = elements.participantsFile instanceof HTMLInputElement ? elements.participantsFile : null;
    const file = fileInput?.files?.[0];
    if (!file) {
      setStatusMessage(elements.participantsStatus, 'CSV 파일을 선택해주세요.', 'warning');
      showToast('업로드할 CSV 파일을 선택해주세요.', 'warning');
      return;
    }

    state.isUploading = true;
    if (elements.participantsUploadButton instanceof HTMLButtonElement) {
      elements.participantsUploadButton.disabled = true;
      elements.participantsUploadButton.textContent = '업로드 중...';
    }
    if (elements.participantsDelete instanceof HTMLButtonElement) {
      elements.participantsDelete.disabled = true;
    }
    if (fileInput) {
      fileInput.disabled = true;
    }
    if (elements.participantsFilename instanceof HTMLElement) {
      elements.participantsFilename.textContent = file.name;
    }
    setStatusMessage(elements.participantsStatus, 'CSV 파일을 확인하고 있습니다...', 'info');

    try {
      const text = await file.text();
      const records = parseCsv(text);
      if (!records.length) {
        setStatusMessage(elements.participantsStatus, '유효한 참가자 데이터를 찾지 못했습니다.', 'warning');
        showToast('유효한 참가자 데이터가 없습니다.', 'warning');
        return;
      }

      const normalized = records.map((item) => ({
        name: item.name || '',
        email: item.email,
        joined_at: item.joined_at || new Date().toISOString().slice(0, 10),
      }));

      const response = await fetch('/api/admin/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ participants: normalized }),
      });
      if (response.status === 401) {
        setStatusMessage(elements.participantsStatus, '관리자 세션이 만료되었습니다.', 'danger');
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        throw new Error('failed_to_upload');
      }
      const payload = await response.json().catch(() => ({}));
      const uploadedCount = Number(payload?.count ?? normalized.length) || normalized.length;
      if (Array.isArray(payload?.participants)) {
        state.participants = payload.participants;
        renderParticipants();
      }
      if (elements.participantsForm instanceof HTMLFormElement) {
        elements.participantsForm.reset();
      }
      setStatusMessage(
        elements.participantsStatus,
        `명단이 저장되었습니다. 총 ${formatCount(uploadedCount)}명 적용되었습니다.`,
        'success',
      );
      showToast('참가자 명단이 업로드되었습니다.', 'success');
      await Promise.all([loadParticipants(), loadStatus()]);
    } catch (error) {
      console.error('[dashboard] failed to upload participants', error);
      showToast('참가자 명단 업로드 중 오류가 발생했습니다.', 'danger');
      setStatusMessage(elements.participantsStatus, '참가자 명단 업로드 중 오류가 발생했습니다.', 'danger');
    } finally {
      state.isUploading = false;
      if (elements.participantsUploadButton instanceof HTMLButtonElement) {
        elements.participantsUploadButton.disabled = false;
        elements.participantsUploadButton.textContent = '명단 업로드';
      }
      if (elements.participantsDelete instanceof HTMLButtonElement && !state.isDeleting) {
        elements.participantsDelete.disabled = false;
      }
      if (fileInput) {
        fileInput.disabled = false;
        fileInput.value = '';
      }
      if (elements.participantsFilename instanceof HTMLElement) {
        elements.participantsFilename.textContent = DEFAULT_UPLOAD_FILENAME;
      }
    }
  }

  async function handleParticipantsDelete() {
    if (state.isDeleting || state.isUploading) {
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm('정말로 모든 명단을 삭제하시겠습니까?')) {
      return;
    }
    state.isDeleting = true;
    if (elements.participantsDelete instanceof HTMLButtonElement) {
      elements.participantsDelete.disabled = true;
      elements.participantsDelete.textContent = '삭제 중...';
    }
    if (elements.participantsUploadButton instanceof HTMLButtonElement) {
      elements.participantsUploadButton.disabled = true;
    }
    if (elements.participantsFile instanceof HTMLInputElement) {
      elements.participantsFile.disabled = true;
      elements.participantsFile.value = '';
    }
    if (elements.participantsFilename instanceof HTMLElement) {
      elements.participantsFilename.textContent = DEFAULT_UPLOAD_FILENAME;
    }
    setStatusMessage(elements.participantsStatus, '미치나 명단을 삭제하는 중입니다...', 'warning');
    try {
      const response = await fetch('/api/admin/participants/delete', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.status === 401) {
        setStatusMessage(elements.participantsStatus, '관리자 세션이 만료되었습니다.', 'danger');
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        throw new Error('failed_to_delete');
      }
      state.participants = [];
      renderParticipants();
      setStatusMessage(elements.participantsStatus, '미치나 명단이 모두 삭제되었습니다.', 'success');
      showToast('명단을 모두 삭제했습니다.', 'success');
      await Promise.all([loadParticipants(), loadStatus()]);
    } catch (error) {
      console.error('[dashboard] failed to delete participants', error);
      setStatusMessage(elements.participantsStatus, '명단 삭제에 실패했습니다. 다시 시도해주세요.', 'danger');
      showToast('명단 삭제 중 오류가 발생했습니다.', 'danger');
    } finally {
      state.isDeleting = false;
      if (elements.participantsDelete instanceof HTMLButtonElement) {
        elements.participantsDelete.disabled = false;
        elements.participantsDelete.textContent = '명단 전체 삭제';
      }
      if (elements.participantsUploadButton instanceof HTMLButtonElement && !state.isUploading) {
        elements.participantsUploadButton.disabled = false;
      }
      if (elements.participantsFile instanceof HTMLInputElement) {
        elements.participantsFile.disabled = false;
      }
      if (state.participants.length > 0) {
        setStatusMessage(elements.participantsStatus, '미치나 참가자 명단이 최신 상태입니다.', 'info');
      } else {
        setStatusMessage(elements.participantsStatus, '미치나 참가자 데이터가 아직 등록되지 않았습니다.', 'warning');
      }
      setStatusMessage(elements.participantsStatus, '참가자 정보를 불러오지 못했습니다.', 'danger');
        '<tr class="transition hover:bg-primary/30">' +
        '<td class="px-4 py-3 align-top text-sm font-medium text-[#3f2f00]">' +
        '<td class="px-4 py-3 align-top text-sm text-[#6f5a26]">' +
        '<td class="px-4 py-3 align-top text-sm text-[#6f5a26]">' +
        '<td class="px-4 py-3 align-top text-sm text-[#6f5a26]">' +
        '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-[#7a5a00]">등록된 참가자 정보가 없습니다.</td></tr>';
      elements.participantsCount.textContent = `${formatCount(state.participants.length)}명`;
      elements.participantsMessage.textContent = state.participants.length
        ? `최근 불러온 참가자 ${formatCount(state.participants.length)}명`
        : '등록된 참가자 정보가 없습니다.';
    const period = status.period;
    const today = new Date().toISOString().slice(0, 10);
      elements.statusTotal.textContent = formatCount(total);
      elements.statusActive.textContent = formatCount(active);
    }
      elements.statusExpired.textContent = formatCount(expired);
        const startLabel = formatDate(period.startDate);
        const endLabel = formatDate(period.endDate);
        elements.statusPeriod.textContent = `${startLabel} ~ ${endLabel}`;
        const ended = today > period.endDate;
        const upcoming = today < period.startDate;
        if (ended) {
          setBadgeTone(elements.statusPeriod, 'danger');
        } else if (upcoming) {
          setBadgeTone(elements.statusPeriod, 'info');
        } else {
          setBadgeTone(elements.statusPeriod, 'success');
        }
        setBadgeTone(elements.statusPeriod, 'warning');
        lines.push(`총 ${formatCount(total)}명의 미치나 참여자를 관리 중입니다.`);
        lines.push(`현재 ${formatCount(active)}명이 챌린지 기간 내에 있으며 ${formatCount(expired)}명은 종료 상태입니다.`);
    try {
        '<tr class="transition hover:bg-primary/30">' +
        '<td class="px-4 py-3 align-top text-sm font-medium text-[#3f2f00]">' +
        '<td class="px-4 py-3 align-top text-sm text-[#6f5a26]">' +
        '<td class="px-4 py-3 align-top text-sm text-[#6f5a26]">' +
        '<td class="px-4 py-3 align-top text-sm text-[#6f5a26]">' +
        '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-[#7a5a00]">불러온 사용자 정보가 없습니다.</td></tr>';
      elements.usersCount.textContent = `${formatCount(state.users.length)}명`;
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
      const payload = await response.json().catch(() => ({}));
      const uploadedCount = Number(payload?.count ?? normalized.length) || normalized.length;
      if (Array.isArray(payload?.participants)) {
        state.participants = payload.participants;
        renderParticipants();
      }
      elements.participantsForm?.reset();
      const successMessage = `참가자 명단이 업로드되었습니다. 총 ${formatCount(uploadedCount)}명 적용되었습니다.`;
      setStatusMessage(elements.participantsStatus, successMessage, 'success');
      showToast('참가자 명단이 업로드되었습니다.', 'success');
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
      if (payload?.period && payload.period.startDate && payload.period.endDate) {
        state.period = payload.period;
        renderPeriod();
      }
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
    if (state.isSavingPeriod) {
      return;
    }
    if (!(elements.periodStart instanceof HTMLInputElement) || !(elements.periodEnd instanceof HTMLInputElement)) {
      return;
    }
    const startDate = elements.periodStart.value;
    const endDate = elements.periodEnd.value;
    if (!startDate || !endDate) {
      showToast('시작일과 종료일을 모두 선택해주세요.', 'warning');
      setPeriodUpdatedMessage('시작일과 종료일을 모두 선택해주세요.', 'warning');
      return;
    }
    if (startDate > endDate) {
      showToast('종료일은 시작일 이후 날짜를 선택해주세요.', 'warning');
      setPeriodUpdatedMessage('종료일은 시작일 이후 날짜를 선택해주세요.', 'warning');
      return;
    }
    state.isSavingPeriod = true;
    updatePeriodSaveButton();
    setPeriodUpdatedMessage('챌린지 기간을 저장하고 있습니다…', 'info');
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
      state.periodHistory = Array.isArray(payload?.periods) ? payload.periods : [];
      renderPeriod();
      renderPeriodHistory();
      setPeriodUpdatedMessage(
        '저장되었습니다. 기간 변경 내역에서 저장 이력을 확인할 수 있습니다.',
        'success',
      );
      showToast('저장되었습니다.', 'success');
      await loadStatus();
      setPeriodUpdatedMessage(
        '저장되었습니다. 기간 변경 내역에서 저장 이력을 확인할 수 있습니다.',
        'success',
      );
    } catch (error) {
      console.error('[dashboard] failed to save period', error);
      showToast('챌린지 기간을 저장하지 못했습니다.', 'danger');
      setPeriodUpdatedMessage('챌린지 기간을 저장하지 못했습니다. 다시 시도해주세요.', 'danger');
    } finally {
      state.isSavingPeriod = false;
      updatePeriodSaveButton();
    }
  }

  async function handlePeriodDelete() {
    if (!(elements.periodDelete instanceof HTMLButtonElement)) {
      return;
    }
    if (state.isDeletingPeriod) {
      return;
    }
    if (!state.period || !state.period.startDate || !state.period.endDate) {
      showToast('삭제할 기간이 없습니다.', 'warning');
      return;
    }
    const confirmed = window.confirm('설정된 챌린지 기간을 삭제하시겠어요? 저장된 변경 내역은 계속 보관됩니다.');
    if (!confirmed) {
      return;
    }
    state.isDeletingPeriod = true;
    elements.periodDelete.disabled = true;
    elements.periodDelete.textContent = '삭제 중…';
    showToast('챌린지 기간을 삭제하고 있습니다…', 'info');
    try {
      const response = await fetch('/api/admin/period', { method: 'DELETE', credentials: 'include' });
      if (response.status === 401) {
        redirectToLogin('관리자 세션이 만료되었습니다.', 'danger');
        return;
      }
      if (!response.ok) {
        throw new Error('failed_to_delete_period');
      }
      const payload = await response.json();
      state.period = payload?.period || null;
      state.periodHistory = Array.isArray(payload?.periods) ? payload.periods : [];
      renderPeriod();
      renderPeriodHistory();
      showToast('챌린지 기간이 삭제되었습니다.', 'success');
      await loadStatus();
    } catch (error) {
      console.error('[dashboard] failed to delete period', error);
      showToast('챌린지 기간을 삭제하지 못했습니다.', 'danger');
    } finally {
      state.isDeletingPeriod = false;
      if (elements.periodDelete instanceof HTMLButtonElement) {
        elements.periodDelete.textContent = DEFAULT_PERIOD_DELETE_LABEL;
        elements.periodDelete.disabled = !(
          state.period && state.period.startDate && state.period.endDate
        );
      }
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
  if (elements.participantsDelete instanceof HTMLButtonElement) {
    elements.participantsDelete.addEventListener('click', handleParticipantsDelete);
  }
  if (elements.participantsFile instanceof HTMLInputElement) {
    elements.participantsFile.addEventListener('change', () => {
      const file = elements.participantsFile?.files?.[0];
      if (elements.participantsFilename instanceof HTMLElement) {
        elements.participantsFilename.textContent = file ? file.name : DEFAULT_UPLOAD_FILENAME;
      }
      if (!file) {
        setStatusMessage(elements.participantsStatus, 'CSV 파일을 선택하면 상태가 표시됩니다.', 'info');
      }
    });
  }
  if (elements.participantsFilename instanceof HTMLElement) {
    elements.participantsFilename.textContent = DEFAULT_UPLOAD_FILENAME;
  }
  setStatusMessage(elements.participantsStatus, 'CSV 파일을 선택하면 상태가 표시됩니다.', 'info');
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
  if (elements.periodDelete instanceof HTMLButtonElement) {
    elements.periodDelete.addEventListener('click', handlePeriodDelete);
  }
  if (elements.participantsForm instanceof HTMLFormElement) {
    elements.participantsForm.addEventListener('submit', handleParticipantsUpload);
  }

  Promise.all([loadPeriod(), loadParticipants(), loadStatus(), loadUsers()]).catch((error) => {
    console.warn('[dashboard] initialization warning', error);
  });
})();
