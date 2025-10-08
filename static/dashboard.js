(function () {
  const state = {
    participants: []
  };

  const demoParticipants = [
    { name: '김엘리', email: 'ellie@example.com', submissions: 12, target: 15 },
    { name: '박미나', email: 'mina@example.com', submissions: 15, target: 15 },
    { name: '이준호', email: 'junho@example.com', submissions: 7, target: 15 },
    { name: '정수빈', email: 'soobin@example.com', submissions: 18, target: 15 }
  ];

  function computeParticipantMeta(participant) {
    const clamped = Math.max(0, participant.submissions || 0);
    const target = participant.target || 15;
    const completion = Math.min(100, Math.round((clamped / target) * 100));
    const completed = clamped >= target;
    return { completion, completed };
  }

  function renderParticipants() {
    const tableBody = document.querySelector('[data-table-body]');
    const emptyState = document.querySelector('[data-empty-state]');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (!state.participants.length) {
      emptyState?.classList.remove('hidden');
      return;
    }

    emptyState?.classList.add('hidden');

    state.participants.forEach((participant) => {
      const { completion, completed } = computeParticipantMeta(participant);
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${participant.name}</td>
        <td>${participant.email}</td>
        <td>
          <div class="progress">
            <span style="width:${completion}%"></span>
          </div>
        </td>
        <td>${participant.submissions}/${participant.target}</td>
        <td><span class="tag" data-variant="${completed ? 'completed' : completion > 0 ? 'progress' : 'pending'}">${completed ? '완료' : completion > 0 ? '진행 중' : '대기'}</span></td>
      `;
      tableBody.appendChild(row);
    });
  }

  async function loadParticipants() {
    if (!window.ElliesApp?.safeFetch) {
      state.participants = demoParticipants.map((item) => ({ ...item }));
      renderParticipants();
      return;
    }

    const response = await window.ElliesApp.safeFetch('/api/admin/challenge/participants');
    if (response.ok) {
      try {
        const data = await response.json();
        state.participants = (data?.participants || []).map((item) => ({
          name: item.name,
          email: item.email,
          submissions: Number(item.submissions || 0),
          target: Number(item.target || 15)
        }));
        window.ElliesApp.showToast('실제 참가자 데이터를 불러왔습니다.', 'success');
      } catch (error) {
        console.warn('[dashboard] Failed to parse response', error);
        state.participants = demoParticipants.map((item) => ({ ...item }));
      }
    } else {
      state.participants = demoParticipants.map((item) => ({ ...item }));
    }
    renderParticipants();
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
    const rows = lines.map((line) => line.split(',').map((cell) => cell.trim()));
    const participants = rows.map((row) => ({
      name: row[0] || '',
      email: row[1] || '',
      submissions: Number(row[2] || 0),
      target: Number(row[3] || 15)
    }));
    return participants.filter((row) => row.email.includes('@'));
  }

  function toCSV(participants) {
    const header = 'name,email,submissions,target';
    const lines = participants.map((participant) => [
      participant.name,
      participant.email,
      participant.submissions,
      participant.target
    ].join(','));
    return [header].concat(lines).join('\n');
  }

  function handleImport(text) {
    const parsed = parseCSV(text);
    if (!parsed.length) {
      window.ElliesApp?.showToast('가져올 데이터가 없습니다.', 'warning');
      return;
    }
    state.participants = parsed;
    renderParticipants();
    window.ElliesApp?.showToast(`${parsed.length}명의 참가자를 불러왔습니다.`, 'success');
  }

  function handleExport() {
    if (!state.participants.length) {
      window.ElliesApp?.showToast('내보낼 참가자가 없습니다.', 'warning');
      return;
    }
    const csv = toCSV(state.participants);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ellies-challenge-participants.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function runCompletionCheck() {
    if (!state.participants.length) {
      window.ElliesApp?.showToast('완주 판별 대상이 없습니다.', 'warning');
      return;
    }
    state.participants = state.participants.map((participant) => {
      const updated = { ...participant };
      if (updated.submissions < updated.target) {
        updated.submissions = Math.min(updated.target, updated.submissions + 1);
      }
      return updated;
    });
    renderParticipants();
    window.ElliesApp?.showToast('데모 모드: 완주 판별이 실행되었습니다.', 'success');
  }

  function bindDashboardEvents() {
    document.querySelector('[data-action="run-completion"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      runCompletionCheck();
    });

    document.querySelector('[data-action="export-csv"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      handleExport();
    });

    document.querySelector('[data-action="import-csv"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      const textarea = document.querySelector('[data-import-text]');
      const value = textarea?.value || '';
      handleImport(value);
    });

    document.querySelector('[data-action="load-demo"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      state.participants = demoParticipants.map((item) => ({ ...item }));
      renderParticipants();
      window.ElliesApp?.showToast('데모 참가자 데이터를 불러왔습니다.', 'info');
    });

    document.querySelector('[data-action="refresh"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      loadParticipants();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindDashboardEvents();
    loadParticipants();
  });
})();
