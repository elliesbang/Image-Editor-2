import { useEffect } from 'react'

type SubscriptionPlan = {
  id: string
  name: string
  price: string
  description?: string
  features: string[]
}

type ModalSubscriptionPlansProps = {
  open: boolean
  onClose: () => void
  currentPlanId?: string
}

const PLANS: SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'Free (프리)',
    price: '₩0 / month',
    features: [
      '업로드 최대 3장',
      '배경 제거, 크롭, 노이즈 제거, 리사이즈(비율 자동)',
      'SVG / 키워드 분석 각 1회 제공',
      '월 30크레딧 (1장당 1크레딧 차감)',
      '일반화질 다운로드',
    ],
  },
  {
    id: 'basic',
    name: 'Basic (베이직)',
    price: '₩9,900 / month',
    features: [
      '업로드 최대 5장',
      '프리 기능 포함 + 일괄 편집 + 고화질 다운로드',
      'SVG / 키워드 분석 각 5회 제공',
      '크레딧 없음',
    ],
  },
  {
    id: 'standard',
    name: 'Standard (스탠다드)',
    price: '₩19,900 / month',
    features: [
      '업로드 최대 30장',
      '베이직 기능 포함 + 자동저장 + AI 보정',
      'SVG / 키워드 분석 각 20회 제공',
      '크레딧 없음',
    ],
  },
  {
    id: 'premium',
    name: 'Premium (프리미엄)',
    price: '₩39,900 / month',
    features: [
      '업로드 최대 50장',
      '모든 기능 무제한 (AI 키워드, SVG, 배경제거, 노이즈, 리사이즈 등)',
      'SVG / 키워드 분석 무제한',
      '크레딧 없음',
      '고화질 다운로드',
    ],
  },
  {
    id: 'michina',
    name: 'Michina (미치나)',
    price: '관리자 승인 전용',
    features: [
      '업로드 최대 50장',
      '프리미엄과 동일 기능',
      '무제한 사용',
      '고화질 다운로드',
    ],
  },
]

function ModalSubscriptionPlans({ open, onClose, currentPlanId = 'free' }: ModalSubscriptionPlansProps) {
  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg text-ellie-text sm:max-w-2xl lg:max-w-4xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">구독 플랜 업그레이드</h2>
              <p className="mt-2 text-sm text-ellie-text/70">
                나에게 꼭 맞는 플랜을 선택하고 Ellie&apos;s Image Editor의 모든 기능을 활용해 보세요.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
            className="-mt-1 rounded-full p-2 text-2xl font-semibold text-ellie-text transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
            aria-label="닫기"
          >
            ×
          </button>
          </div>

          <div className="mt-6 flex-1 overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              {PLANS.map((plan) => {
                const isCurrentPlan = plan.id === currentPlanId

                return (
                  <div
                    key={plan.id}
                    className={`flex h-full flex-col justify-between rounded-xl border p-4 transition-all duration-200 hover:shadow-lg ${
                      isCurrentPlan ? 'border-yellow-400 shadow-lg' : 'border-gray-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-bold">{plan.name}</h3>
                          <p className="mt-2 text-lg font-semibold text-ellie-text">{plan.price}</p>
                        </div>
                        {isCurrentPlan ? (
                          <span className="rounded-full border border-yellow-400 bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-600">
                            현재 플랜
                          </span>
                        ) : null}
                      </div>

                      <ul className="mt-4 space-y-2 text-sm">
                        {plan.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-2">
                            <span className="pt-0.5 text-base">✅</span>
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <button
                      type="button"
                      disabled={isCurrentPlan}
                      className={`mt-6 w-full rounded-full px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow ${
                        isCurrentPlan
                          ? 'cursor-not-allowed bg-ellie-ivory text-ellie-text/50'
                          : 'bg-[#ffd331] text-ellie-text hover:brightness-95'
                      }`}
                    >
                      {isCurrentPlan ? '현재 이용 중' : '업그레이드'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-ellie-text/20 px-6 py-3 text-sm font-semibold text-ellie-text transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModalSubscriptionPlans
