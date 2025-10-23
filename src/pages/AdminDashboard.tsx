import { useMemo, useState } from 'react'
import Sidebar, { type MenuKey } from '../components/Sidebar'
import Topbar from '../components/Topbar'
import MichinaPanel from '../components/MichinaPanel'

const AdminDashboard = () => {
  const [selectedMenu, setSelectedMenu] = useState<MenuKey>('미치나 관리')

  const contentTitle = useMemo(() => selectedMenu, [selectedMenu])

  const renderContent = () => {
    if (selectedMenu === '미치나 관리') {
      return <MichinaPanel />
    }

    return (
      <div className="bg-white rounded-xl p-6 shadow-md space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">{contentTitle}</h3>
        <p className="text-sm text-gray-500">
          {contentTitle} 메뉴의 상세 기능은 아직 준비 중입니다. 현재는 UI 틀만 확인할 수 있습니다.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5eee9] p-6">
      <div className="mx-auto flex max-w-6xl gap-6">
        <Sidebar selectedMenu={selectedMenu} onSelect={setSelectedMenu} />
        <main className="flex-1 space-y-6">
          <Topbar />
          {renderContent()}
        </main>
      </div>
    </div>
  )
}

export default AdminDashboard
