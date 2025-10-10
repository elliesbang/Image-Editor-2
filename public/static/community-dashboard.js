const totalSubmissionRate = 92
const popularKeywords = ['#AI디자인', '#미리캔버스', '#챌린지']
const totalDays = 15
const missionsSubmitted = [1, 2, 4, 5, 7, 8, 10]
const dailyMissionSubmitted = false

function renderSubmissionOverview() {
  const rateElement = document.getElementById('totalSubmissionRate')
  const overallProgressBar = document.querySelector('[data-role="overall-progress"]')
  if (rateElement) {
    rateElement.textContent = `${totalSubmissionRate}%`
  }
  if (overallProgressBar) {
    overallProgressBar.style.width = `${totalSubmissionRate}%`
  }
}

function renderPopularKeywords() {
  const keywordsElement = document.getElementById('popularKeywords')
  if (keywordsElement && popularKeywords.length > 0) {
    keywordsElement.textContent = popularKeywords.join(' ')
  }
}

function renderDailyMissionStatus() {
  const statusElement = document.getElementById('dailyMissionStatus')
  if (!statusElement) return
  statusElement.textContent = dailyMissionSubmitted
    ? '오늘의 미션이 제출되었습니다. 수고하셨어요!'
    : '오늘의 미션이 아직 제출되지 않았습니다.'
}

function renderPersonalProgress() {
  const completedCount = missionsSubmitted.length
  const percentage = Math.round((completedCount / totalDays) * 100)
  const unsubmittedDays = []
  for (let day = 1; day <= totalDays; day += 1) {
    if (!missionsSubmitted.includes(day)) {
      unsubmittedDays.push(day)
    }
  }

  const statusElement = document.getElementById('completedStatus')
  const personalProgressBar = document.querySelector('[data-role="personal-progress"]')
  const submittedDaysElement = document.getElementById('submittedDays')
  const unsubmittedDaysElement = document.getElementById('unsubmittedDays')

  if (statusElement) {
    statusElement.textContent = `${completedCount} / ${totalDays}일차 완료 · ${percentage}%`
  }
  if (personalProgressBar) {
    personalProgressBar.style.width = `${percentage}%`
  }
  if (submittedDaysElement) {
    submittedDaysElement.textContent =
      missionsSubmitted.length > 0 ? missionsSubmitted.join(', ') : '제출 내역 없음'
  }
  if (unsubmittedDaysElement) {
    unsubmittedDaysElement.textContent =
      unsubmittedDays.length > 0 ? unsubmittedDays.join(', ') : '모든 일차 완료'
  }
}

function createCharts() {
  if (typeof window.Chart !== 'function') {
    console.error('Chart.js 라이브러리를 불러오지 못했습니다.')
    return
  }

  window.Chart.defaults.font.family = "'Pretendard', 'Noto Sans KR', sans-serif"
  window.Chart.defaults.color = '#333'

  const participantsCtx = document.getElementById('participantsChart')
  if (participantsCtx) {
    new window.Chart(participantsCtx, {
      type: 'line',
      data: {
        labels: ['1일차', '3일차', '5일차', '7일차', '9일차', '11일차', '13일차', '15일차'],
        datasets: [
          {
            label: '참여자 수',
            data: [120, 138, 150, 162, 170, 176, 180, 182],
            borderColor: '#ff9a1f',
            backgroundColor: 'rgba(255, 154, 31, 0.2)',
            tension: 0.3,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: '#ff9a1f',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#333',
            titleColor: '#ffd331',
            bodyColor: '#fff',
            padding: 12,
          },
        },
        scales: {
          y: {
            beginAtZero: false,
            ticks: { stepSize: 10 },
            grid: { color: 'rgba(51, 51, 51, 0.08)' },
          },
          x: {
            grid: { display: false },
          },
        },
      },
    })
  }

  const submissionCtx = document.getElementById('submissionChart')
  if (submissionCtx) {
    new window.Chart(submissionCtx, {
      type: 'bar',
      data: {
        labels: Array.from({ length: totalDays }, (_, index) => `${index + 1}일차`),
        datasets: [
          {
            label: '제출률',
            data: [92, 88, 90, 94, 96, 91, 89, 93, 95, 97, 98, 96, 94, 93, 92],
            backgroundColor: 'rgba(255, 211, 49, 0.7)',
            borderColor: '#ffd331',
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#333',
            titleColor: '#ffd331',
            bodyColor: '#fff',
            padding: 12,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: { stepSize: 20, callback: (value) => `${value}%` },
            grid: { color: 'rgba(51, 51, 51, 0.08)' },
          },
          x: {
            grid: { display: false },
          },
        },
      },
    })
  }

  const completionCtx = document.getElementById('completionChart')
  if (completionCtx) {
    new window.Chart(completionCtx, {
      type: 'doughnut',
      data: {
        labels: ['완주', '진행 중'],
        datasets: [
          {
            data: [76, 24],
            backgroundColor: ['#ffd331', '#f5eee9'],
            borderColor: ['#f5eee9', '#f5eee9'],
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              padding: 16,
            },
          },
        },
        cutout: '65%',
      },
    })
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderSubmissionOverview()
  renderPopularKeywords()
  renderDailyMissionStatus()
  renderPersonalProgress()
  createCharts()
})
