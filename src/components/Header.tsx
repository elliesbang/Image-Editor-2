import type { MouseEventHandler } from 'react'

type HeaderProps = {
  onLoginClick: MouseEventHandler<HTMLButtonElement>
  onUpgradeClick?: MouseEventHandler<HTMLButtonElement>
}

function Header({ onLoginClick, onUpgradeClick }: HeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-ellie-border bg-ellie-ivory/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-col">
          <span className="text-base font-semibold text-ellie-text sm:text-lg">엘리의방 이미지 에디터</span>
          <span className="text-xs text-ellie-text/60 sm:hidden">Ellie&apos;s Image Editor</span>
        </div>
        <div className="flex items-center gap-2 max-[379px]:flex-col">
          <button
            type="button"
            onClick={onLoginClick}
            className="min-h-[44px] rounded-full border border-ellie-border bg-white px-4 text-sm font-semibold text-ellie-text shadow-sm transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow max-[379px]:w-full"
          >
            로그인
          </button>
          <button
            type="button"
            onClick={onUpgradeClick}
            className="min-h-[44px] rounded-full bg-ellie-yellow px-4 text-sm font-semibold text-ellie-text shadow-sm transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow max-[379px]:w-full"
          >
            업그레이드
          </button>
        </div>
      </div>
    </header>
  )
}

export default Header
