import type { FC } from 'react'

const MENU_ITEMS = [
  '대시보드 홈',
  '사용자 관리',
  '구독 관리',
  '미치나 관리',
  '시스템 로그',
] as const

type MenuKey = typeof MENU_ITEMS[number]

interface SidebarProps {
  selectedMenu: MenuKey
  onSelect: (menu: MenuKey) => void
}

const Sidebar: FC<SidebarProps> = ({ selectedMenu, onSelect }) => {
  return (
    <aside className="bg-white shadow-md rounded-2xl p-6 w-64 space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">관리자 메뉴</h2>
      <nav className="space-y-2">
        {MENU_ITEMS.map((item) => {
          const baseClasses =
            'w-full text-left px-4 py-3 rounded-xl font-medium transition border hover:bg-yellow-100 hover:border-yellow-300'
          const activeClasses =
            selectedMenu === item
              ? 'bg-yellow-400 text-gray-900 border-yellow-400 shadow'
              : 'bg-white text-gray-700 border-gray-200'

          return (
            <button
              key={item}
              type="button"
              onClick={() => onSelect(item)}
              className={`${baseClasses} ${activeClasses}`}
            >
              {item}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

export type { MenuKey }
export { MENU_ITEMS }
export default Sidebar
