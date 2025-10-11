const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
let toastTimer = 0;

const state = {
  period: null,
  participants: [],
  isSavingPeriod: false,
  isUploading: false,
};

const elements = {
  periodForm: document.querySelector('[data-role="period-form"]'),
  periodStart: document.querySelector('[data-role="period-start"]'),
  periodEnd: document.querySelector('[data-role="period-end"]'),
  periodSummary: document.querySelector('[data-role="period-summary"]'),
  periodStatus: document.querySelector('[data-role="period-status"]'),
  periodSubmit: document.querySelector('[data-role="period-form"] button[type="submit"]'),
  uploadTrigger: document.querySelector('[data-role="upload-trigger"]'),
  uploadInput: document.querySelector('[data-role="upload-input"]'),
  uploadFilename: document.querySelector('[data-role="upload-filename"]'),
  uploadStatus: document.querySelector('[data-role="upload-status"]'),
  participantRows: document.querySelector('[data-role="participant-rows"]'),
  participantCount: document.querySelector('[data-role="participant-count"]'),
  toast: document.querySelector('[data-role="admin-toast"]'),
  logoutButton: document.querySelector('[data-action="logout"]'),
};

function setMessage(element, message, tone) {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  if (message) {
    element.textContent = message;
    element.dataset.tone = tone || 'info';
    element.hidden = false;
  } else {
    element.textContent = '';
    element.dataset.tone = 'info';
    element.hidden = true;
  }
}

function showToast(message) {
  if (!(elements.toast instanceof HTMLElement)) {
    return;
  }
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3600);
}

function formatDate(value) {
  if (typeof value !== 'string' || !value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('ko', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatDateTime(value) {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('ko', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function normalizeDateValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const normalized = trimmed.replace(/[.\/]/g, '-');
  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().split('T')[0];
  }
  return trimmed;
}

function describeRole(role) {
  if (!role) return 'free';
  if (role.toLowerCase() === 'free') return 'free';
  return role;
}

function renderPeriod() {
  if (elements.periodSummary instanceof HTMLElement) {
    if (state.period && state.period.startDate && state.period.endDate) {
      const startLabel = formatDate(state.period.startDate);
      const endLabel = formatDate(state.period.endDate);
      elements.periodSummary.textContent = `${startLabel} ~ ${endLabel}`;
    } else {
      elements.periodSummary.textContent = '저장된 챌린지 기간이 없습니다.';
    }
  }
  if (state.period && state.period.updatedAt) {
    setMessage(elements.periodStatus, `마지막 저장: ${formatDateTime(state.period.updatedAt)}`, 'success');
  } else {
    setMessage(elements.periodStatus, '', 'info');
  }
  if (elements.periodStart instanceof HTMLInputElement && state.period?.startDate) {
    elements.periodStart.value = state.period.startDate;
  }
  if (elements.periodEnd instanceof HTMLInputElement && state.period?.endDate) {
    elements.periodEnd.value = state.period.endDate;
  }
}

function renderParticipants() {
  if (!(elements.participantRows instanceof HTMLElement)) {
    return;
  }
  const list = Array.isArray(state.participants) ? state.participants : [];
  if (elements.participantCount instanceof HTMLElement) {
    elements.participantCount.textContent = `${list.length}명`;
  }
  if (list.length === 0) {
    elements.participantRows.innerHTML = '<tr><td colspan="4" class="admin-empty">등록된 참가자가 없습니다.</td></tr>';
    return;
  }
  const rows = list
    .map((participant) => {
      const name = typeof participant.name === 'string' && participant.name.trim() ? participant.name.trim() : '-';
      const email = typeof participant.email === 'string' ? participant.email : '-';
      const joinedAt = typeof participant.joined_at === 'string' ? participant.joined_at : participant.joinedAt;
      const joinedLabel = formatDate(joinedAt || '');
      const role = describeRole(participant.role || participant.roleName || 'free');
      return `<tr><td>${name}</td><td>${email}</td><td>${joinedLabel}</td><td>${role}</td></tr>`;
    })
    .join('');
  elements.participantRows.innerHTML = rows;
}

async function loadPeriod() {
  try {
    const response = await fetch('/api/admin/period', { credentials: 'include' });
    if (response.status === 401) {
      setMessage(elements.periodStatus, '관리자 인증이 필요합니다.', 'danger');
      return;
    }
    if (!response.ok) {
      throw new Error('failed');
    }
    const payload = await response.json();
    state.period = payload?.period ?? null;
    renderPeriod();
  } catch (error) {
    setMessage(elements.periodStatus, '기간 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'danger');
  }
}

async function savePeriod(startDate, endDate) {
  if (state.isSavingPeriod) {
    return;
  }
  state.isSavingPeriod = true;
  if (elements.periodSubmit instanceof HTMLButtonElement) {
    elements.periodSubmit.disabled = true;
    elements.periodSubmit.textContent = '저장 중...';
  }
  try {
    const response = await fetch('/api/admin/period', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ startDate, endDate }),
    });
    if (response.status === 401) {
      setMessage(elements.periodStatus, '관리자 인증이 필요합니다.', 'danger');
      return;
    }
    if (!response.ok) {
      throw new Error('failed');
    }
    const payload = await response.json();
    state.period = payload?.period ?? null;
    renderPeriod();
    setMessage(elements.periodStatus, '챌린지 기간이 저장되었습니다.', 'success');
    showToast('챌린지 기간이 저장되었습니다.');
  } catch (error) {
    setMessage(elements.periodStatus, '기간을 저장하지 못했습니다. 입력 값을 확인해주세요.', 'danger');
  } finally {
    state.isSavingPeriod = false;
    if (elements.periodSubmit instanceof HTMLButtonElement) {
      elements.periodSubmit.disabled = false;
      elements.periodSubmit.textContent = '기간 저장';
    }
  }
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
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
  if (typeof text !== 'string') {
    return [];
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return [];
  }
  const headerCells = splitCsvLine(lines[0].replace(/\ufeff/g, ''));
  const normalizedHeaders = headerCells.map((value) => value.toLowerCase());
  const emailIndex = normalizedHeaders.findIndex((value) => value.includes('이메일') || value === 'email');
  if (emailIndex === -1) {
    return [];
  }
  const nameIndex = normalizedHeaders.findIndex((value) => value.includes('이름') || value === 'name');
  const joinedIndex = normalizedHeaders.findIndex(
    (value) => value.includes('등록일') || value.includes('가입') || value === 'joined_at' || value === 'joined',
  );
  const records = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    if (cells.every((value) => value.trim() === '')) {
      continue;
    }
    const emailRaw = cells[emailIndex] ? cells[emailIndex].trim().toLowerCase() : '';
    if (!emailPattern.test(emailRaw)) {
      continue;
    }
    const name = nameIndex >= 0 && cells[nameIndex] ? cells[nameIndex].trim() : '';
    const joinedRaw = joinedIndex >= 0 && cells[joinedIndex] ? cells[joinedIndex].trim() : '';
    records.push({
      name,
      email: emailRaw,
      joined_at: normalizeDateValue(joinedRaw),
    });
  }
  return records;
}

async function loadParticipants() {
  try {
    const response = await fetch('/api/admin/participants', { credentials: 'include' });
    if (response.status === 401) {
      if (elements.uploadStatus) {
        setMessage(elements.uploadStatus, '관리자 인증이 필요합니다.', 'danger');
      }
      return;
    }
    if (!response.ok) {
      throw new Error('failed');
    }
    const payload = await response.json();
    state.participants = Array.isArray(payload?.participants) ? payload.participants : [];
    renderParticipants();
  } catch (error) {
    if (elements.uploadStatus) {
      setMessage(elements.uploadStatus, '참가자 명단을 불러오지 못했습니다.', 'danger');
    }
  }
}

async function handleUploadFile(file) {
  if (!file || state.isUploading) {
    return;
  }
  state.isUploading = true;
  if (elements.uploadTrigger instanceof HTMLButtonElement) {
    elements.uploadTrigger.disabled = true;
    elements.uploadTrigger.textContent = '업로드 중...';
  }
  if (elements.uploadFilename instanceof HTMLElement) {
    elements.uploadFilename.textContent = file.name;
  }
  try {
    const text = await file.text();
    const records = parseCsv(text);
    if (records.length === 0) {
      setMessage(elements.uploadStatus, 'CSV에서 유효한 참가자를 찾지 못했습니다.', 'danger');
      return;
    }
    const response = await fetch('/api/admin/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(records),
    });
    if (response.status === 401) {
      setMessage(elements.uploadStatus, '관리자 인증이 필요합니다.', 'danger');
      return;
    }
    if (!response.ok) {
      throw new Error('failed');
    }
    const payload = await response.json();
    if (Array.isArray(payload?.participants)) {
      state.participants = payload.participants;
    }
    renderParticipants();
    setMessage(elements.uploadStatus, '명단이 저장되었습니다.', 'success');
    showToast('명단이 저장되었습니다.');
  } catch (error) {
    setMessage(elements.uploadStatus, '업로드에 실패했습니다. CSV 파일을 확인해주세요.', 'danger');
  } finally {
    state.isUploading = false;
    if (elements.uploadTrigger instanceof HTMLButtonElement) {
      elements.uploadTrigger.disabled = false;
      elements.uploadTrigger.textContent = 'CSV 업로드';
    }
    if (elements.uploadInput instanceof HTMLInputElement) {
      elements.uploadInput.value = '';
    }
  }
}

function handleLogout() {
  fetch('/api/auth/admin/logout', {
    method: 'POST',
    credentials: 'include',
  })
    .then(() => {
      window.location.href = '/';
    })
    .catch(() => {
      window.location.href = '/';
    });
}

function initialize() {
  if (elements.logoutButton instanceof HTMLButtonElement) {
    elements.logoutButton.addEventListener('click', handleLogout);
  }
  if (elements.periodForm instanceof HTMLFormElement) {
    elements.periodForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!(elements.periodStart instanceof HTMLInputElement) || !(elements.periodEnd instanceof HTMLInputElement)) {
        return;
      }
      const startDate = elements.periodStart.value;
      const endDate = elements.periodEnd.value;
      if (!startDate || !endDate) {
        setMessage(elements.periodStatus, '시작일과 종료일을 모두 입력해주세요.', 'danger');
        return;
      }
      if (startDate > endDate) {
        setMessage(elements.periodStatus, '시작일은 종료일보다 빠르거나 같아야 합니다.', 'danger');
        return;
      }
      savePeriod(startDate, endDate);
    });
  }
  if (elements.uploadTrigger instanceof HTMLButtonElement && elements.uploadInput instanceof HTMLInputElement) {
    elements.uploadTrigger.addEventListener('click', () => {
      elements.uploadInput.click();
    });
    elements.uploadInput.addEventListener('change', () => {
      const [file] = elements.uploadInput.files || [];
      if (!file) {
        return;
      }
      handleUploadFile(file);
    });
  }
  renderPeriod();
  renderParticipants();
  loadPeriod();
  loadParticipants();
}

initialize();
