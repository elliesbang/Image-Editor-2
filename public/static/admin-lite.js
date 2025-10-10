const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
let toastTimer = 0;

const state = {
  view: 'period',
  period: null,
  periodUpdatedAt: '',
  periodUpdatedBy: '',
  challengers: [],
  challengersUpdatedAt: '',
  challengersUpdatedBy: '',
  users: [],
  periodLoaded: false,
  challengersLoaded: false,
  usersLoaded: false,
};

const elements = {
  buttons: Array.prototype.slice.call(document.querySelectorAll('.admin-sidebar button[data-view]')),
  views: Array.prototype.slice.call(document.querySelectorAll('[data-admin-view]')),
  periodForm: document.querySelector('[data-role="period-form"]'),
  periodStart: document.querySelector('[data-role="period-start"]'),
  periodEnd: document.querySelector('[data-role="period-end"]'),
  periodSummary: document.querySelector('[data-role="period-summary"]'),
  periodMeta: document.querySelector('[data-role="period-meta"]'),
  periodStatus: document.querySelector('[data-role="period-status"]'),
  challengerUpload: document.querySelector('[data-role="challenger-upload"]'),
  challengerStatus: document.querySelector('[data-role="upload-status"]'),
  challengerMeta: document.querySelector('[data-role="challenger-meta"]'),
  challengerList: document.querySelector('[data-role="challenger-list"]'),
  statusCount: document.querySelector('[data-role="status-count"]'),
  statusTable: document.querySelector('[data-role="status-table"]'),
  usersTable: document.querySelector('[data-role="users-table"]'),
  toast: document.querySelector('[data-role="admin-toast"]'),
  refreshButtons: Array.prototype.slice.call(document.querySelectorAll('[data-action="refresh-view"]')),
};

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function formatDate(value) {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('ko', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function describeRole(role) {
  if (role === 'michina') {
    return '미치나 챌린저';
  }
  if (role === 'admin') {
    return '관리자';
  }
  if (role === 'guest') {
    return '게스트';
  }
  return '회원';
}

function showToast(message, tone) {
  if (!(elements.toast instanceof HTMLElement)) {
    return;
  }
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone || 'info';
  elements.toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3600);
}

function setHint(element, message, tone) {
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

function persistPeriod(record) {
  try {
    if (!window.localStorage) {
      return;
    }
    if (record) {
      window.localStorage.setItem('michinaPeriod', JSON.stringify(record));
    } else {
      window.localStorage.removeItem('michinaPeriod');
    }
  } catch (error) {
    console.warn('기간 정보를 저장하지 못했습니다.', error);
  }
}

function persistChallengers(record) {
  try {
    if (!window.localStorage) {
      return;
    }
    if (record && record.challengers) {
      window.localStorage.setItem('michinaChallengers', JSON.stringify(record));
    } else {
      window.localStorage.removeItem('michinaChallengers');
    }
  } catch (error) {
    console.warn('명단 정보를 저장하지 못했습니다.', error);
  }
}

function restoreFromStorage() {
  try {
    if (window.localStorage) {
      const storedPeriod = window.localStorage.getItem('michinaPeriod');
      if (storedPeriod) {
        try {
          const parsed = JSON.parse(storedPeriod);
          if (parsed && typeof parsed === 'object') {
            state.period = {
              start: typeof parsed.start === 'string' ? parsed.start : '',
              end: typeof parsed.end === 'string' ? parsed.end : '',
            };
            state.periodUpdatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '';
            state.periodUpdatedBy = typeof parsed.updatedBy === 'string' ? parsed.updatedBy : '';
          }
        } catch (error) {
          console.warn('저장된 기간 정보를 해석하지 못했습니다.', error);
        }
      }
      const storedChallengers = window.localStorage.getItem('michinaChallengers');
      if (storedChallengers) {
        try {
          const parsed = JSON.parse(storedChallengers);
          if (Array.isArray(parsed)) {
            state.challengers = parsed.map((value) => normalizeEmail(value)).filter(Boolean);
          } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.challengers)) {
            state.challengers = parsed.challengers.map((value) => normalizeEmail(value)).filter(Boolean);
            state.challengersUpdatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '';
            state.challengersUpdatedBy = typeof parsed.updatedBy === 'string' ? parsed.updatedBy : '';
          }
        } catch (error) {
          console.warn('저장된 명단 정보를 해석하지 못했습니다.', error);
        }
      }
    }
  } catch (error) {
    console.warn('저장된 설정을 불러오지 못했습니다.', error);
  }
  renderPeriod();
  renderChallengers();
}

function setActiveView(view) {
  state.view = view;
  elements.buttons.forEach((button) => {
    if (!(button instanceof HTMLElement)) {
      return;
    }
    button.classList.toggle('is-active', button.dataset.view === view);
  });
  elements.views.forEach((section) => {
    if (!(section instanceof HTMLElement)) {
      return;
    }
    section.classList.toggle('is-active', section.dataset.adminView === view);
  });
  if (view === 'period' && !state.periodLoaded) {
    loadPeriod();
  } else if ((view === 'upload' || view === 'status') && !state.challengersLoaded) {
    loadChallengers();
  } else if (view === 'users' && !state.usersLoaded) {
    loadUsers();
  }
}

function renderPeriod() {
  if (elements.periodStart instanceof HTMLInputElement) {
    elements.periodStart.value = state.period && state.period.start ? state.period.start : '';
  }
  if (elements.periodEnd instanceof HTMLInputElement) {
    elements.periodEnd.value = state.period && state.period.end ? state.period.end : '';
  }
  if (elements.periodSummary instanceof HTMLElement) {
    if (state.period && state.period.start && state.period.end) {
      elements.periodSummary.textContent = state.period.start + ' ~ ' + state.period.end;
    } else {
      elements.periodSummary.textContent = '저장된 기간이 없습니다.';
    }
  }
  if (elements.periodMeta instanceof HTMLElement) {
    if (state.periodUpdatedAt) {
      let meta = '마지막 업데이트: ' + formatDate(state.periodUpdatedAt);
      if (state.periodUpdatedBy) {
        meta += ' · ' + state.periodUpdatedBy;
      }
      setHint(elements.periodMeta, meta, 'info');
    } else {
      setHint(elements.periodMeta, '', 'info');
    }
  }
}

function renderChallengers() {
  const sorted = state.challengers.slice().sort();
  if (elements.challengerList instanceof HTMLElement) {
    elements.challengerList.innerHTML = '';
    if (sorted.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'admin-empty';
      empty.textContent = '등록된 챌린저 명단이 없습니다.';
      elements.challengerList.appendChild(empty);
    } else {
      sorted.forEach((email) => {
        const tag = document.createElement('span');
        tag.className = 'admin-tag';
        tag.textContent = email;
        elements.challengerList.appendChild(tag);
      });
    }
  }
  if (elements.statusCount instanceof HTMLElement) {
    elements.statusCount.textContent = String(sorted.length);
  }
  if (elements.statusTable instanceof HTMLElement) {
    if (sorted.length === 0) {
      elements.statusTable.innerHTML = '<tr><td colspan="2" class="admin-empty">등록된 명단이 없습니다.</td></tr>';
    } else {
      const rows = sorted.map((email, index) => {
        return '<tr><td>' + (index + 1) + '</td><td>' + email + '</td></tr>';
      });
      elements.statusTable.innerHTML = rows.join('');
    }
  }
  if (elements.challengerMeta instanceof HTMLElement) {
    if (state.challengersUpdatedAt) {
      let meta = '마지막 업데이트: ' + formatDate(state.challengersUpdatedAt);
      if (state.challengersUpdatedBy) {
        meta += ' · ' + state.challengersUpdatedBy;
      }
      setHint(elements.challengerMeta, meta, 'info');
    } else {
      setHint(elements.challengerMeta, '', 'info');
    }
  }
}

function renderUsers() {
  if (!(elements.usersTable instanceof HTMLElement)) {
    return;
  }
  if (!Array.isArray(state.users) || state.users.length === 0) {
    elements.usersTable.innerHTML = '<tr><td colspan="4" class="admin-empty">아직 저장된 로그인 정보가 없습니다.</td></tr>';
    return;
  }
  const rows = state.users.map((user) => {
    const name = user.name && user.name.trim().length > 0 ? user.name : '미등록';
    const email = user.email;
    const joined = user.joinedAt ? formatDate(user.joinedAt) : '-';
    const role = describeRole(user.role);
    return '<tr><td>' + name + '</td><td>' + email + '</td><td>' + joined + '</td><td>' + role + '</td></tr>';
  });
  elements.usersTable.innerHTML = rows.join('');
}

async function loadPeriod() {
  if (elements.periodStatus instanceof HTMLElement && !state.periodLoaded) {
    setHint(elements.periodStatus, '미치나 기간 정보를 불러오는 중입니다…', 'info');
  }
  try {
    const response = await fetch('/api/admin/michina/period', {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) {
      setHint(elements.periodStatus, '관리자 인증이 필요합니다. 로그인 후 다시 시도해주세요.', 'warning');
      state.period = null;
      state.periodUpdatedAt = '';
      state.periodUpdatedBy = '';
      persistPeriod(null);
      renderPeriod();
      return;
    }
    if (!response.ok) {
      throw new Error('PERIOD_FETCH_FAILED');
    }
    const payload = await response.json().catch(() => ({}));
    if (payload && payload.period) {
      state.period = {
        start: typeof payload.period.start === 'string' ? payload.period.start : '',
        end: typeof payload.period.end === 'string' ? payload.period.end : '',
      };
      state.periodUpdatedAt = typeof payload.period.updatedAt === 'string' ? payload.period.updatedAt : '';
      state.periodUpdatedBy = typeof payload.period.updatedBy === 'string' ? payload.period.updatedBy : '';
      persistPeriod({
        start: state.period.start,
        end: state.period.end,
        updatedAt: state.periodUpdatedAt,
        updatedBy: state.periodUpdatedBy,
      });
    } else {
      state.period = null;
      state.periodUpdatedAt = '';
      state.periodUpdatedBy = '';
      persistPeriod(null);
    }
    renderPeriod();
    setHint(elements.periodStatus, '', 'info');
  } catch (error) {
    console.warn('미치나 기간 정보를 불러오지 못했습니다.', error);
    setHint(elements.periodStatus, '미치나 기간 정보를 불러오지 못했습니다.', 'danger');
  } finally {
    state.periodLoaded = true;
  }
}

async function savePeriod(start, end) {
  if (elements.periodStatus instanceof HTMLElement) {
    setHint(elements.periodStatus, '기간을 저장하는 중입니다…', 'info');
  }
  try {
    const response = await fetch('/api/admin/michina/period', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ start, end }),
    });
    if (response.status === 401) {
      setHint(elements.periodStatus, '관리자 인증이 필요합니다. 로그인 후 다시 시도해주세요.', 'warning');
      return;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (payload && payload.error === 'INVALID_RANGE') {
        setHint(elements.periodStatus, '종료일은 시작일 이후여야 합니다.', 'warning');
        return;
      }
      if (payload && payload.error === 'INVALID_PERIOD') {
        setHint(elements.periodStatus, '시작일과 종료일을 모두 입력해주세요.', 'warning');
        return;
      }
      throw new Error('PERIOD_SAVE_FAILED');
    }
    const result = await response.json().catch(() => ({}));
    if (result && result.period) {
      state.period = {
        start: typeof result.period.start === 'string' ? result.period.start : start,
        end: typeof result.period.end === 'string' ? result.period.end : end,
      };
      state.periodUpdatedAt = typeof result.period.updatedAt === 'string' ? result.period.updatedAt : '';
      state.periodUpdatedBy = typeof result.period.updatedBy === 'string' ? result.period.updatedBy : '';
      persistPeriod({
        start: state.period.start,
        end: state.period.end,
        updatedAt: state.periodUpdatedAt,
        updatedBy: state.periodUpdatedBy,
      });
      renderPeriod();
      setHint(elements.periodStatus, '', 'info');
      showToast('✅ 챌린지 기간이 저장되었습니다.', 'success');
    }
  } catch (error) {
    console.warn('기간 저장 중 오류가 발생했습니다.', error);
    setHint(elements.periodStatus, '기간을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.', 'danger');
  }
}

async function loadChallengers() {
  if (elements.challengerStatus instanceof HTMLElement && !state.challengersLoaded) {
    setHint(elements.challengerStatus, '챌린저 명단을 불러오는 중입니다…', 'info');
  }
  try {
    const response = await fetch('/api/admin/michina/challengers', {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) {
      setHint(elements.challengerStatus, '관리자 인증이 필요합니다. 로그인 후 다시 시도해주세요.', 'warning');
      state.challengers = [];
      state.challengersUpdatedAt = '';
      state.challengersUpdatedBy = '';
      persistChallengers(null);
      renderChallengers();
      return;
    }
    if (!response.ok) {
      throw new Error('CHALLENGERS_FETCH_FAILED');
    }
    const payload = await response.json().catch(() => ({}));
    if (payload && Array.isArray(payload.challengers)) {
      state.challengers = payload.challengers.map((value) => normalizeEmail(value)).filter(Boolean);
      state.challengersUpdatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : '';
      state.challengersUpdatedBy = typeof payload.updatedBy === 'string' ? payload.updatedBy : '';
      persistChallengers({
        challengers: state.challengers,
        updatedAt: state.challengersUpdatedAt,
        updatedBy: state.challengersUpdatedBy,
      });
    } else {
      state.challengers = [];
      state.challengersUpdatedAt = '';
      state.challengersUpdatedBy = '';
      persistChallengers(null);
    }
    renderChallengers();
    setHint(elements.challengerStatus, '', 'info');
  } catch (error) {
    console.warn('챌린저 명단을 불러오지 못했습니다.', error);
    setHint(elements.challengerStatus, '챌린저 명단을 불러오지 못했습니다.', 'danger');
  } finally {
    state.challengersLoaded = true;
  }
}

async function saveChallengers(emails) {
  if (elements.challengerStatus instanceof HTMLElement) {
    setHint(elements.challengerStatus, '명단을 저장하는 중입니다…', 'info');
  }
  try {
    const response = await fetch('/api/admin/michina/challengers', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ challengers: emails, allowEmpty: true }),
    });
    if (response.status === 401) {
      setHint(elements.challengerStatus, '관리자 인증이 필요합니다. 로그인 후 다시 시도해주세요.', 'warning');
      return;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (payload && payload.error === 'NO_CHALLENGERS') {
        setHint(elements.challengerStatus, '추출된 이메일이 없습니다. CSV 또는 XLSX 파일을 확인해주세요.', 'warning');
        return;
      }
      throw new Error('CHALLENGERS_SAVE_FAILED');
    }
    const result = await response.json().catch(() => ({}));
    if (result && Array.isArray(result.challengers)) {
      state.challengers = result.challengers.map((value) => normalizeEmail(value)).filter(Boolean);
      state.challengersUpdatedAt = typeof result.updatedAt === 'string' ? result.updatedAt : '';
      state.challengersUpdatedBy = typeof result.updatedBy === 'string' ? result.updatedBy : '';
      persistChallengers({
        challengers: state.challengers,
        updatedAt: state.challengersUpdatedAt,
        updatedBy: state.challengersUpdatedBy,
      });
      renderChallengers();
      setHint(elements.challengerStatus, '', 'info');
      showToast('✅ 챌린저 명단이 등록되었습니다.', 'success');
    }
  } catch (error) {
    console.warn('챌린저 명단 저장 중 오류가 발생했습니다.', error);
    setHint(elements.challengerStatus, '챌린저 명단을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.', 'danger');
  }
}

async function loadUsers() {
  if (elements.usersTable instanceof HTMLElement && !state.usersLoaded) {
    elements.usersTable.innerHTML = '<tr><td colspan="4" class="admin-empty">데이터를 불러오는 중입니다…</td></tr>';
  }
  try {
    const response = await fetch('/api/users', {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) {
      if (elements.usersTable instanceof HTMLElement) {
        elements.usersTable.innerHTML = '<tr><td colspan="4" class="admin-empty">관리자 인증이 필요합니다.</td></tr>';
      }
      state.users = [];
      return;
    }
    if (!response.ok) {
      throw new Error('USERS_FETCH_FAILED');
    }
    const payload = await response.json().catch(() => ({}));
    if (payload && Array.isArray(payload.users)) {
      state.users = payload.users.map((user) => ({
        name: typeof user.name === 'string' ? user.name : '',
        email: normalizeEmail(user.email),
        joinedAt: typeof user.joinedAt === 'string' ? user.joinedAt : '',
        role: typeof user.role === 'string' ? user.role : 'member',
      }));
    } else {
      state.users = [];
    }
    renderUsers();
  } catch (error) {
    console.warn('로그인 DB를 불러오지 못했습니다.', error);
    if (elements.usersTable instanceof HTMLElement) {
      elements.usersTable.innerHTML = '<tr><td colspan="4" class="admin-empty">로그인 DB를 불러오지 못했습니다.</td></tr>';
    }
  } finally {
    state.usersLoaded = true;
  }
}

function parseCsv(text) {
  const values = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const parts = line.split(/[;,\t]/);
    for (let j = 0; j < parts.length; j += 1) {
      values.push(parts[j]);
    }
  }
  return values;
}

function extractValuesFromRows(rows) {
  const values = [];
  if (!Array.isArray(rows)) {
    return values;
  }
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (Array.isArray(row)) {
      for (let j = 0; j < row.length; j += 1) {
        values.push(row[j]);
      }
    } else if (row && typeof row === 'object') {
      for (const key in row) {
        if (Object.prototype.hasOwnProperty.call(row, key)) {
          values.push(row[key]);
        }
      }
    } else if (typeof row === 'string') {
      values.push(row);
    }
  }
  return values;
}

function collectEmails(values) {
  const unique = new Set();
  for (let i = 0; i < values.length; i += 1) {
    const normalized = normalizeEmail(values[i]);
    if (normalized && emailPattern.test(normalized)) {
      unique.add(normalized);
    }
  }
  return Array.from(unique).sort();
}

async function extractEmailsFromFile(file) {
  const extension = typeof file.name === 'string' && file.name.includes('.')
    ? file.name.split('.').pop().toLowerCase()
    : '';
  if (extension === 'xlsx' || extension === 'xls') {
    const xlsxLib = window.XLSX;
    if (!xlsxLib || typeof xlsxLib.read !== 'function' || !xlsxLib.utils) {
      throw new Error('XLSX_UNAVAILABLE');
    }
    const buffer = await file.arrayBuffer();
    const workbook = xlsxLib.read(buffer, { type: 'array' });
    const collected = [];
    workbook.SheetNames.forEach((name) => {
      const sheet = workbook.Sheets[name];
      if (!sheet) {
        return;
      }
      const rows = xlsxLib.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      collected.push(...extractValuesFromRows(rows));
    });
    return collectEmails(collected);
  }
  const text = await file.text();
  return collectEmails(parseCsv(text));
}

function handlePeriodSubmit(event) {
  event.preventDefault();
  if (!(elements.periodStart instanceof HTMLInputElement) || !(elements.periodEnd instanceof HTMLInputElement)) {
    return;
  }
  const start = elements.periodStart.value;
  const end = elements.periodEnd.value;
  if (!start || !end) {
    setHint(elements.periodStatus, '시작일과 종료일을 모두 입력해주세요.', 'warning');
    return;
  }
  if (start > end) {
    setHint(elements.periodStatus, '종료일은 시작일 이후여야 합니다.', 'warning');
    return;
  }
  savePeriod(start, end);
}

async function handleChallengerUpload(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) {
    return;
  }
  const file = input.files[0];
  input.value = '';
  setHint(elements.challengerStatus, '명단을 분석하는 중입니다…', 'info');
  try {
    const emails = await extractEmailsFromFile(file);
    if (emails.length === 0) {
      setHint(elements.challengerStatus, '유효한 이메일을 찾지 못했습니다. 파일을 다시 확인해주세요.', 'warning');
      return;
    }
    await saveChallengers(emails);
  } catch (error) {
    if (error && error.message === 'XLSX_UNAVAILABLE') {
      setHint(elements.challengerStatus, 'XLSX 파일을 읽을 수 없습니다. CSV 형식으로 다시 시도해주세요.', 'danger');
      return;
    }
    console.warn('명단 업로드 처리 중 오류', error);
    setHint(elements.challengerStatus, '명단을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.', 'danger');
  }
}

function handleRefresh(event) {
  const button = event.currentTarget;
  if (!(button instanceof HTMLElement)) {
    return;
  }
  const target = button.dataset.target;
  if (target === 'period') {
    state.periodLoaded = false;
    loadPeriod();
  } else if (target === 'challengers') {
    state.challengersLoaded = false;
    loadChallengers();
  } else if (target === 'users') {
    state.usersLoaded = false;
    loadUsers();
  }
}

function attachEvents() {
  elements.buttons.forEach((button) => {
    if (!(button instanceof HTMLElement)) {
      return;
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      setActiveView(button.dataset.view || 'period');
    });
  });

  if (elements.periodForm instanceof HTMLFormElement) {
    elements.periodForm.addEventListener('submit', handlePeriodSubmit);
  }

  if (elements.challengerUpload instanceof HTMLInputElement) {
    elements.challengerUpload.addEventListener('change', handleChallengerUpload);
  }

  elements.refreshButtons.forEach((button) => {
    if (!(button instanceof HTMLElement)) {
      return;
    }
    button.addEventListener('click', handleRefresh);
  });
}

function init() {
  restoreFromStorage();
  attachEvents();
  setActiveView('period');
  loadPeriod();
  loadChallengers();
}

document.addEventListener('DOMContentLoaded', init);
