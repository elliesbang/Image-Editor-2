import type { FC } from 'react'

const Topbar: FC = () => {
  return (
    <header className="flex items-center justify-between bg-white rounded-2xl px-8 py-5 shadow-md">
      <div className="text-lg font-semibold text-gray-900">관리자님 환영합니다</div>
      <button
        type="button"
        className="bg-yellow-400 text-gray-900 font-semibold px-4 py-2 rounded-lg hover:bg-yellow-300 transition"
      >
        로그아웃
      </button>
    </header>
  )
}

export default Topbar
