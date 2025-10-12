const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const DEFAULT_UPLOAD_FILENAME = '선택된 파일이 없습니다.';
const toneClassMap = {
  info: 'text-gray-600',
  success: 'text-green-600',
  danger: 'text-red-500',
  warning: 'text-yellow-600',
};
const toneClassList = Object.values(toneClassMap)
  .map((value) => value.split(' '))
  .flat();
let toastTimer = 0;

const state = {
  period: null,
  periodHistory: [],
  summary: { total: 0, active: 0, expired: 0 },
  users: [],
  isSavingPeriod: false,
  isUploading: false,
  isDeleting: false,
};

const elements = {
  startDate: document.getElementById('startDate'),
  endDate: document.getElementById('endDate'),
  savePeriodBtn: document.getElementById('savePeriodBtn'),
  periodStatus: document.getElementById('periodStatus'),
  statusPeriod: document.getElementById('statusPeriod'),
  recentPeriodContainer: document.getElementById('recentPeriodContainer'),
  recentPeriodText: document.getElementById('recentPeriodText'),
  recentPeriodMeta: document.getElementById('recentPeriodMeta'),
  periodHistoryList: document.getElementById('periodHistoryList'),
  periodHistoryCount: document.getElementById('periodHistoryCount'),
  statusMessage: document.getElementById('statusMessage'),
  uploadInput: document.getElementById('csvUpload'),
  uploadFilename: document.getElementById('uploadFilename'),
  uploadStatus: document.getElementById('uploadStatus'),
  uploadBtn: document.getElementById('uploadBtn'),
  deleteBtn: document.getElementById('deleteListBtn'),
  totalCount: document.getElementById('totalCount'),
  activeCount: document.getElementById('activeCount'),
  expiredCount: document.getElementById('expiredCount'),
  usersTableBody: document.getElementById('userTableBody'),
  usersStatus: document.querySelector('[data-role="users-status"]'),
  usersBreakdown: document.querySelector('[data-role="users-breakdown"]'),
  toast: document.querySelector('[data-role="admin-toast"]'),
  logoutButton: document.querySelector('[data-action="logout"]'),
};

function setMessage(element, message, tone = 'info') {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  element.classList.remove(...toneClassList);
  const toneClass = toneClassMap[tone] || toneClassMap.info;
  if (message) {
    element.textContent = message;
    element.classList.add(...toneClass.split(' '));
    element.hidden = false;
  } else {
    element.textContent = '';
    element.classList.add(...toneClassMap.info.split(' '));
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

function formatIsoDate(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function formatCount(value) {
  const numberValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return numberValue.toLocaleString('ko-KR');
}

function buildPeriodSummary(period) {
  if (!period || !period.startDate || !period.endDate) {
    return '';
  }
  const startLabel = formatDate(period.startDate);
  const endLabel = formatDate(period.endDate);
  return `현재 설정 기간: ${startLabel} ~ ${endLabel}`;
}

function renderPeriod() {
  const period = state.period;
  if (elements.startDate instanceof HTMLInputElement) {
    elements.startDate.value = period?.startDate ?? '';
  }
  if (elements.endDate instanceof HTMLInputElement) {
    elements.endDate.value = period?.endDate ?? '';
  }
  if (period && period.startDate && period.endDate) {
    const summaryText = buildPeriodSummary(period);
    setMessage(elements.periodStatus, summaryText, 'info');
    if (elements.statusPeriod instanceof HTMLElement) {
      elements.statusPeriod.textContent = summaryText;
    }
  } else {
    setMessage(elements.periodStatus, '⚠️ 챌린지 기간이 아직 설정되지 않았습니다.', 'warning');
    if (elements.statusPeriod instanceof HTMLElement) {
      elements.statusPeriod.textContent = '챌린지 기간을 설정하면 현황이 계산됩니다.';
    }
  }
  if (elements.recentPeriodContainer instanceof HTMLElement && elements.recentPeriodText instanceof HTMLElement) {
    if (period && period.startDate && period.endDate) {
      const startLabel = formatIsoDate(period.startDate);
      const endLabel = formatIsoDate(period.endDate);
      elements.recentPeriodText.textContent = `최근 저장된 기간: ${startLabel} ~ ${endLabel}`;
      if (elements.recentPeriodMeta instanceof HTMLElement) {
        const updatedLabel = period.updatedAt ? formatDateTime(period.updatedAt) : '';
        const updatedBy = typeof period.updatedBy === 'string' && period.updatedBy.trim() ? period.updatedBy.trim() : '';
        const metaParts = [];
        if (updatedLabel) {
          metaParts.push(`저장: ${updatedLabel}`);
        }
        if (updatedBy) {
          metaParts.push(`관리자: ${updatedBy}`);
        }
        elements.recentPeriodMeta.textContent = metaParts.length > 0 ? metaParts.join(' · ') : '저장 시간이 기록되지 않았습니다.';
      }
    } else {
      const history = Array.isArray(state.periodHistory) ? state.periodHistory : [];
      const latest = history.length > 0 ? history[0] : null;
      if (latest && latest.startDate && latest.endDate) {
        const startLabel = formatIsoDate(latest.startDate);
        const endLabel = formatIsoDate(latest.endDate);
        elements.recentPeriodText.textContent = `최근 저장된 기간: ${startLabel} ~ ${endLabel}`;
        if (elements.recentPeriodMeta instanceof HTMLElement) {
          const updatedLabel = formatDateTime(latest.updatedAt);
          const updatedBy = typeof latest.updatedBy === 'string' && latest.updatedBy.trim() ? latest.updatedBy.trim() : '';
          const metaParts = [];
          if (updatedLabel) {
            metaParts.push(`저장: ${updatedLabel}`);
          }
          if (updatedBy) {
            metaParts.push(`관리자: ${updatedBy}`);
          }
          elements.recentPeriodMeta.textContent = metaParts.length > 0 ? metaParts.join(' · ') : '저장 시간이 기록되지 않았습니다.';
        }
      } else {
        elements.recentPeriodText.textContent = '저장된 기간이 없습니다';
        if (elements.recentPeriodMeta instanceof HTMLElement) {
          elements.recentPeriodMeta.textContent = '저장 내역이 등록되면 여기에 표시됩니다.';
        }
      }
    }
  }
}

function renderPeriodHistory() {
  if (!(elements.periodHistoryList instanceof HTMLElement)) {
    return;
  }
  const history = Array.isArray(state.periodHistory) ? state.periodHistory : [];
  if (elements.periodHistoryCount instanceof HTMLElement) {
    elements.periodHistoryCount.textContent = history.length > 0 ? `총 ${history.length}건` : '';
  }
  if (history.length === 0) {
    elements.periodHistoryList.innerHTML =
      '<li class="rounded-md bg-[#fff7bf] px-3 py-2 text-xs text-[#a17f20]">저장된 이력이 아직 없습니다.</li>';
    return;
  }

  const items = history
    .map((item, index) => {
      const startLabel = formatIsoDate(item.startDate);
      const endLabel = formatIsoDate(item.endDate);
      const updatedLabel = formatDateTime(item.updatedAt);
      const updatedBy = typeof item.updatedBy === 'string' && item.updatedBy.trim() ? item.updatedBy.trim() : '';
      const badge =
        index === 0
          ? '<span class="ml-3 rounded-full bg-[#fef08a] px-2 py-1 text-[11px] font-semibold text-[#3f2f00]">최신</span>'
          : '';
      const metaParts = [];
      if (updatedLabel) {
        metaParts.push(`저장: ${updatedLabel}`);
      }
      if (updatedBy) {
        metaParts.push(`관리자: ${updatedBy}`);
      }
      const metaText = metaParts.length > 0 ? metaParts.join(' · ') : '저장 정보를 불러오지 못했습니다.';
      return `<li class="flex items-start justify-between gap-3 rounded-md bg-white/70 px-3 py-2 shadow-sm">
          <div>
            <p class="text-sm font-semibold text-[#4f3b0f]">${startLabel} ~ ${endLabel}</p>
            <p class="mt-0.5 text-xs text-[#8c6d10]">${metaText}</p>
          </div>
          ${badge}
        </li>`;
    })
    .join('');

  elements.periodHistoryList.innerHTML = items;
}

function renderMichinaStatus() {
  const { summary } = state;
  if (elements.totalCount instanceof HTMLElement) {
    elements.totalCount.textContent = formatCount(summary.total);
  }
  if (elements.activeCount instanceof HTMLElement) {
    elements.activeCount.textContent = formatCount(summary.active);
  }
  if (elements.expiredCount instanceof HTMLElement) {
    elements.expiredCount.textContent = formatCount(summary.expired);
  }
  if (elements.statusMessage instanceof HTMLElement) {
    if (summary.total === 0) {
      setMessage(elements.statusMessage, '미치나 챌린저 데이터가 아직 등록되지 않았습니다.', 'warning');
    } else {
      const totalLabel = formatCount(summary.total);
      const activeLabel = formatCount(summary.active);
      const expiredLabel = formatCount(summary.expired);
      setMessage(
        elements.statusMessage,
        `총 ${totalLabel}명 중 ${activeLabel}명이 진행 중이며 ${expiredLabel}명은 종료 상태입니다.`,
        'info',
      );
    }
  }
}

function renderUsers() {
  if (!(elements.usersTableBody instanceof HTMLElement)) {
    return;
  }
  const list = Array.isArray(state.users) ? state.users : [];
  if (list.length === 0) {
    elements.usersTableBody.innerHTML =
      '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-gray-500">등록된 사용자 정보가 없습니다.</td></tr>';
    if (elements.usersBreakdown instanceof HTMLElement) {
      elements.usersBreakdown.innerHTML =
        '<p class="col-span-full text-center text-sm text-[#6f5a26]">사용자 데이터가 등록되면 카테고리 요약이 표시됩니다.</p>';
    }
    return;
  }
  const rows = list
    .map((user) => {
      const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : '-';
      const email = typeof user.email === 'string' ? user.email : '-';
      const role = typeof user.role === 'string' && user.role.trim() ? user.role.trim() : 'guest';
      const lastLoginLabel = formatDateTime(user.lastLogin || '');
      const safeLastLogin = lastLoginLabel || '—';
      return `<tr class="even:bg-ivory/40 odd:bg-white/80 transition hover:bg-primary/25">
          <td class="px-4 py-3 font-medium text-[#4f3b0f]">${name}</td>
          <td class="px-4 py-3 text-sm text-gray-700">${email}</td>
          <td class="px-4 py-3 text-sm text-gray-700">${role}</td>
          <td class="px-4 py-3 text-sm text-gray-700">${safeLastLogin}</td>
        </tr>`;
    })
    .join('');
  elements.usersTableBody.innerHTML = rows;
  renderUsersBreakdown();
}

function resolveUserCategory(role) {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (['admin', 'administrator', 'superadmin', 'owner'].includes(normalized)) {
    return { key: 'admin', label: '관리자', accent: 'bg-[#fde68a] text-[#78350f]' };
  }
  if (['michina', 'challenger', 'participant', 'challenge', 'michina-challenger'].includes(normalized)) {
    return { key: 'michina', label: '미치나 챌린저', accent: 'bg-[#fef08a] text-[#854d0e]' };
  }
  if (['user', 'member', 'basic', 'standard', 'pro', 'premium'].includes(normalized)) {
    return { key: 'user', label: '일반 사용자', accent: 'bg-[#dcfce7] text-[#166534]' };
  }
  if (['guest', 'viewer'].includes(normalized)) {
    return { key: 'guest', label: '게스트', accent: 'bg-[#e9d5ff] text-[#6b21a8]' };
  }
  if (['pending', 'wait', 'waiting', 'invited', 'requested'].includes(normalized)) {
    return { key: 'pending', label: '승인 대기', accent: 'bg-[#e0e7ff] text-[#3730a3]' };
  }
  if (!normalized) {
    return { key: 'unknown', label: '미확인', accent: 'bg-[#f3f4f6] text-[#4b5563]' };
  }
  return { key: normalized, label: role, accent: 'bg-[#e0f2fe] text-[#075985]' };
}

function renderUsersBreakdown() {
  if (!(elements.usersBreakdown instanceof HTMLElement)) {
    return;
  }
  const list = Array.isArray(state.users) ? state.users : [];
  if (list.length === 0) {
    elements.usersBreakdown.innerHTML =
      '<p class="col-span-full text-center text-sm text-[#6f5a26]">사용자 데이터가 등록되면 카테고리 요약이 표시됩니다.</p>';
    return;
  }
  const categories = new Map();
  list.forEach((user) => {
    const category = resolveUserCategory(user.role);
    const current = categories.get(category.key) || { ...category, count: 0 };
    current.count += 1;
    categories.set(category.key, current);
  });
  const totalCard = `<article class="rounded-2xl bg-primary/40 p-4 shadow-ellie">
      <p class="text-xs font-semibold uppercase tracking-wide text-[#6f5a26]">전체 사용자</p>
      <p class="mt-1 text-2xl font-bold text-[#5b4100]">${formatCount(list.length)}</p>
    </article>`;
  const categoryCards = Array.from(categories.values())
    .sort((a, b) => b.count - a.count)
    .map(
      (item) => `<article class="rounded-2xl ${item.accent} p-4 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-wide">${item.label}</p>
          <p class="mt-1 text-xl font-bold">${formatCount(item.count)}</p>
        </article>`,
    )
    .join('');
  elements.usersBreakdown.innerHTML = totalCard + categoryCards;
}

async function loadPeriod() {
  try {
    const response = await fetch('/api/admin/period', { credentials: 'include' });
    if (response.status === 401) {
      state.period = null;
      state.periodHistory = [];
      renderPeriod();
      renderPeriodHistory();
      setMessage(elements.periodStatus, '관리자 인증이 필요합니다.', 'danger');
      if (elements.statusPeriod instanceof HTMLElement) {
        elements.statusPeriod.textContent = '관리자 인증 후 기간 정보를 확인할 수 있습니다.';
      }
      return;
    }
    if (!response.ok) {
      throw new Error('failed');
    }
    const payload = await response.json();
    state.period = payload?.period ?? null;
    state.periodHistory = Array.isArray(payload?.periods) ? payload.periods : [];
    renderPeriod();
    renderPeriodHistory();
  } catch (error) {
    state.period = null;
    state.periodHistory = [];
    renderPeriod();
    renderPeriodHistory();
    setMessage(elements.periodStatus, '기간 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'danger');
    if (elements.statusPeriod instanceof HTMLElement) {
      elements.statusPeriod.textContent = '기간 정보를 불러오지 못했습니다.';
    }
  }
}

async function savePeriod(startDate, endDate) {
  if (state.isSavingPeriod) {
    return;
  }
  state.isSavingPeriod = true;
  if (elements.savePeriodBtn instanceof HTMLButtonElement) {
    elements.savePeriodBtn.disabled = true;
    elements.savePeriodBtn.textContent = '저장 중...';
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
    state.periodHistory = Array.isArray(payload?.periods) ? payload.periods : state.periodHistory;
    renderPeriod();
    renderPeriodHistory();
    const summaryText = buildPeriodSummary(state.period);
    const message = summaryText ? `✔️ 기간이 저장되었습니다. ${summaryText}` : '✔️ 기간이 저장되었습니다.';
    setMessage(elements.periodStatus, message, 'success');
    showToast('✔️ 기간이 저장되었습니다');
    console.log('기간이 D1에 저장되었습니다');
    await loadMichinaStatus();
  } catch (error) {
    setMessage(elements.periodStatus, '❌ 저장에 실패했습니다. 다시 시도해주세요.', 'danger');
    showToast('❌ 저장에 실패했습니다. 다시 시도해주세요.');
  } finally {
    state.isSavingPeriod = false;
    if (elements.savePeriodBtn instanceof HTMLButtonElement) {
      elements.savePeriodBtn.disabled = false;
      elements.savePeriodBtn.textContent = '저장';
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
  const headerCells = splitCsvLine(lines[0].replace(/﻿/g, ''));
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

async function loadMichinaStatus() {
  try {
    const response = await fetch('/api/admin/michina-status', { credentials: 'include' });
    if (response.status === 401) {
      state.summary = { total: 0, active: 0, expired: 0 };
      renderMichinaStatus();
      setMessage(elements.statusMessage, '관리자 인증이 필요합니다.', 'danger');
      return;
    }
    if (!response.ok) {
      throw new Error('failed');
    }
    const payload = await response.json();
    state.summary = {
      total: Number(payload?.total ?? 0) || 0,
      active: Number(payload?.active ?? 0) || 0,
      expired: Number(payload?.expired ?? 0) || 0,
    };
    renderMichinaStatus();
    if (payload?.period) {
      state.period = payload.period;
      renderPeriod();
    }
  } catch (error) {
    state.summary = { total: 0, active: 0, expired: 0 };
    renderMichinaStatus();
    setMessage(elements.statusMessage, '챌린지 현황을 불러오지 못했습니다.', 'danger');
  }
}

async function loadUsers() {
  try {
    const response = await fetch('/api/admin/users', { credentials: 'include' });
    if (response.status === 401) {
      setMessage(elements.usersStatus, '관리자 인증이 필요합니다.', 'danger');
      state.users = [];
      renderUsers();
      renderUsersBreakdown();
      return;
    }
    if (!response.ok) {
      throw new Error('failed');
    }
    const payload = await response.json();
    state.users = Array.isArray(payload?.users) ? payload.users : [];
    renderUsers();
    renderUsersBreakdown();
    setMessage(elements.usersStatus, '', 'info');
  } catch (error) {
    setMessage(elements.usersStatus, '사용자 목록을 불러오지 못했습니다.', 'danger');
    state.users = [];
    renderUsers();
    renderUsersBreakdown();
  }
}

async function handleUploadFile(file) {
  if (!file || state.isUploading || state.isDeleting) {
    return;
  }
  state.isUploading = true;
  if (elements.uploadBtn instanceof HTMLButtonElement) {
    elements.uploadBtn.disabled = true;
    elements.uploadBtn.textContent = '업로드 중...';
  }
  if (elements.deleteBtn instanceof HTMLButtonElement) {
    elements.deleteBtn.disabled = true;
  }
  if (elements.uploadInput instanceof HTMLInputElement) {
    elements.uploadInput.disabled = true;
  }
  if (elements.uploadFilename instanceof HTMLElement) {
    elements.uploadFilename.textContent = file.name;
  }
  setMessage(elements.uploadStatus, 'CSV 파일을 확인하고 있습니다...', 'info');
  try {
    const text = await file.text();
    const records = parseCsv(text);
    if (records.length === 0) {
      setMessage(elements.uploadStatus, 'CSV에서 유효한 참가자를 찾지 못했습니다.', 'warning');
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
    if (payload?.summary) {
      const { total = 0, active = 0, expired = 0 } = payload.summary;
      state.summary = {
        total: Number(total) || 0,
        active: Number(active) || 0,
        expired: Number(expired) || 0,
      };
      renderMichinaStatus();
    }
    const uploadedCount = Number(payload?.count ?? records.length) || records.length;
    const successMessage = `명단이 저장되었습니다. 총 ${uploadedCount.toLocaleString('ko-KR')}명 적용.`;
    setMessage(elements.uploadStatus, successMessage, 'success');
    showToast('명단이 저장되었습니다.');
    await Promise.all([loadMichinaStatus(), loadUsers()]);
  } catch (error) {
    setMessage(elements.uploadStatus, '업로드에 실패했습니다. CSV 파일을 확인해주세요.', 'danger');
  } finally {
    state.isUploading = false;
    if (elements.uploadInput instanceof HTMLInputElement) {
      elements.uploadInput.disabled = false;
      elements.uploadInput.value = '';
    }
    if (elements.uploadBtn instanceof HTMLButtonElement) {
      elements.uploadBtn.disabled = false;
      elements.uploadBtn.textContent = '명단 업로드';
    }
    if (elements.deleteBtn instanceof HTMLButtonElement) {
      elements.deleteBtn.disabled = state.isDeleting;
    }
    if (elements.uploadFilename instanceof HTMLElement) {
      elements.uploadFilename.textContent = DEFAULT_UPLOAD_FILENAME;
    }
  }
}

async function handleDeleteList() {
  if (state.isDeleting || state.isUploading) {
    return;
  }
  if (typeof window !== 'undefined' && !window.confirm('정말로 모든 명단을 삭제하시겠습니까?')) {
    return;
  }
  state.isDeleting = true;
  if (elements.deleteBtn instanceof HTMLButtonElement) {
    elements.deleteBtn.disabled = true;
    elements.deleteBtn.textContent = '삭제 중...';
  }
  if (elements.uploadBtn instanceof HTMLButtonElement) {
    elements.uploadBtn.disabled = true;
  }
  if (elements.uploadInput instanceof HTMLInputElement) {
    elements.uploadInput.disabled = true;
  }
  setMessage(elements.uploadStatus, '명단을 삭제하는 중입니다...', 'warning');
  try {
    const response = await fetch('/api/admin/participants/delete', {
      method: 'DELETE',
      credentials: 'include',
    });
    if (response.status === 401) {
      setMessage(elements.uploadStatus, '관리자 인증이 필요합니다.', 'danger');
      return;
    }
    if (!response.ok) {
      throw new Error('failed');
    }
    state.summary = { total: 0, active: 0, expired: 0 };
    renderMichinaStatus();
    setMessage(elements.uploadStatus, '미치나 명단이 모두 삭제되었습니다.', 'success');
    showToast('명단을 모두 삭제했습니다.');
    if (typeof window !== 'undefined') {
      window.alert('기존 명단이 초기화되었습니다.');
    }
    await Promise.all([loadMichinaStatus(), loadUsers()]);
  } catch (error) {
    setMessage(elements.uploadStatus, '명단 삭제에 실패했습니다. 다시 시도해주세요.', 'danger');
  } finally {
    state.isDeleting = false;
    if (elements.deleteBtn instanceof HTMLButtonElement) {
      elements.deleteBtn.disabled = false;
      elements.deleteBtn.textContent = '명단 전체 삭제';
    }
    if (elements.uploadBtn instanceof HTMLButtonElement) {
      elements.uploadBtn.disabled = false;
      elements.uploadBtn.textContent = '명단 업로드';
    }
    if (elements.uploadInput instanceof HTMLInputElement) {
      elements.uploadInput.disabled = false;
      elements.uploadInput.value = '';
    }
    if (elements.uploadFilename instanceof HTMLElement) {
      elements.uploadFilename.textContent = DEFAULT_UPLOAD_FILENAME;
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
  if (elements.savePeriodBtn instanceof HTMLButtonElement) {
    elements.savePeriodBtn.addEventListener('click', () => {
      if (!(elements.startDate instanceof HTMLInputElement) || !(elements.endDate instanceof HTMLInputElement)) {
        return;
      }
      const startDate = elements.startDate.value;
      const endDate = elements.endDate.value;
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
  if (elements.uploadInput instanceof HTMLInputElement) {
    elements.uploadInput.addEventListener('change', () => {
      const [file] = elements.uploadInput.files || [];
      if (elements.uploadFilename instanceof HTMLElement) {
        elements.uploadFilename.textContent = file ? file.name : DEFAULT_UPLOAD_FILENAME;
      }
      if (!file) {
        return;
      }
      setMessage(elements.uploadStatus, '', 'info');
    });
  }
  if (elements.uploadBtn instanceof HTMLButtonElement) {
    elements.uploadBtn.addEventListener('click', () => {
      if (!(elements.uploadInput instanceof HTMLInputElement)) {
        return;
      }
      const [file] = elements.uploadInput.files || [];
      if (!file) {
        setMessage(elements.uploadStatus, 'CSV 파일을 선택해주세요.', 'warning');
        return;
      }
      handleUploadFile(file);
    });
  }
  if (elements.deleteBtn instanceof HTMLButtonElement) {
    elements.deleteBtn.addEventListener('click', () => {
      handleDeleteList();
    });
  }
  if (elements.uploadFilename instanceof HTMLElement) {
    elements.uploadFilename.textContent = DEFAULT_UPLOAD_FILENAME;
  }
  setMessage(elements.uploadStatus, '', 'info');
  renderPeriod();
  renderPeriodHistory();
  renderMichinaStatus();
  renderUsers();
  setMessage(elements.usersStatus, '사용자 정보를 불러오는 중입니다...', 'info');
  loadPeriod();
  loadMichinaStatus();
  loadUsers();
}

initialize();
