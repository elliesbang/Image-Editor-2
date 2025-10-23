import type { FormEventHandler } from 'react'

type ModalLoginProps = {
  open: boolean
  onClose: () => void
}

function ModalLogin({ open, onClose }: ModalLoginProps) {
  if (!open) {
    return null
  }

  const preventDefault: FormEventHandler = (event) => event.preventDefault()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4 py-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-ellie-text shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">로그인</h2>
            <p className="mt-1 text-sm text-ellie-text/70">Ellie&apos;s Image Editor에 다시 오신 것을 환영합니다.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-full border border-ellie-border px-3 text-xs font-medium text-ellie-text transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
          >
            닫기
          </button>
        </div>
        <form onSubmit={preventDefault} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium">이메일</span>
            <input
              type="email"
              placeholder="이메일을 입력하세요"
              className="mt-2 w-full rounded-xl border border-ellie-border bg-ellie-ivory/60 px-4 py-3 text-sm shadow-inner focus:border-ellie-yellow focus:outline-none focus:ring-2 focus:ring-ellie-yellow"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">비밀번호</span>
            <input
              type="password"
              placeholder="비밀번호를 입력하세요"
              className="mt-2 w-full rounded-xl border border-ellie-border bg-ellie-ivory/60 px-4 py-3 text-sm shadow-inner focus:border-ellie-yellow focus:outline-none focus:ring-2 focus:ring-ellie-yellow"
            />
          </label>
          <div className="space-y-3 pt-2">
            <button
              type="submit"
              className="w-full min-h-[48px] rounded-full bg-ellie-yellow text-sm font-semibold text-ellie-text shadow transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
            >
              로그인
            </button>
            <button
              type="button"
              className="w-full min-h-[48px] rounded-full border border-ellie-border bg-white text-sm font-semibold text-ellie-text shadow-sm transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
            >
              Google 로그인
            </button>
            <button
              type="button"
              className="w-full min-h-[48px] rounded-full border border-ellie-border bg-white text-sm font-semibold text-ellie-text shadow-sm transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
            >
              미치나 로그인
            </button>
            <button
              type="button"
              disabled
              className="w-full min-h-[48px] cursor-not-allowed rounded-full border border-ellie-border bg-ellie-ivory text-sm font-semibold text-ellie-text/50 opacity-60"
            >
              관리자 로그인
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ModalLogin
