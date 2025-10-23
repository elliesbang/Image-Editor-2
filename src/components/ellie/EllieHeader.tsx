import { useNavigate } from 'react-router-dom'

type EllieHeaderProps = {
  onLoginClick?: () => void
  onUpgradeClick?: () => void
}

function EllieHeader({ onLoginClick, onUpgradeClick }: EllieHeaderProps) {
  const navigate = useNavigate()

  return (
    <header className="fixed left-0 right-0 top-0 z-50 bg-[#f5eee9] text-[#404040] shadow-sm">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-lg font-semibold tracking-tight transition hover:text-[#fef568] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fef568]"
        >
          Easy Image Editor
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onLoginClick}
            className="rounded-lg px-4 py-2 text-sm font-semibold transition hover:text-[#fef568] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fef568]"
          >
            로그인
          </button>
          <button
            type="button"
            onClick={onUpgradeClick}
            className="rounded-lg bg-[#fef568] px-4 py-2 text-sm font-semibold text-[#404040] shadow transition hover:bg-[#fff59d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#404040]/20"
          >
            업그레이드
          </button>
        </div>
      </div>
    </header>
  )
}

export default EllieHeader
