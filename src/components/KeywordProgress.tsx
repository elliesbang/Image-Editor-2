export type KeywordProgressStatus = 'idle' | 'running' | 'success' | 'error'

type Phase = 'precheck' | 'upload' | 'vision' | 'aggregate' | 'title' | 'finalize'

export interface KeywordProgressProps {
  status: KeywordProgressStatus
  message?: string
  percent?: number
  phase?: Phase
}

const clampPercent = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

export default function KeywordProgress({
  status,
  message = '',
  percent = 0,
  phase = 'precheck',
}: KeywordProgressProps) {
  const safePercent = clampPercent(percent)
  const isIdle = status === 'idle'

  return (
    <div
      class={`analysis-progress${isIdle ? ' is-idle' : ''}`}
      data-role="analysis-progress"
      data-status={status}
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-hidden={isIdle}
    >
      <div
        class="analysis-progress__message"
        data-role="analysis-progress-message"
      >
        {status === 'running' ? message : ''}
      </div>
      <div
        class="analysis-progress__bar"
        data-role="analysis-progress-bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={safePercent}
      >
        <div
          class="analysis-progress__fill"
          data-role="analysis-progress-fill"
          style={{ width: `${safePercent}%` }}
        />
      </div>
      <div
        class="analysis-progress__status analysis-progress__status--success"
        data-role="analysis-progress-success"
        hidden
      >
        분석 완료
      </div>
      <div
        class="analysis-progress__status analysis-progress__status--error"
        data-role="analysis-progress-error"
        hidden
      >
        <span data-role="analysis-progress-error-message">
          분석 실패. 잠시 후 다시 시도해 주세요.
        </span>
        <button type="button" class="analysis-progress__retry" data-action="analysis-retry">
          다시 시도
        </button>
      </div>
    </div>
  )
}
