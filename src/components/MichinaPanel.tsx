import { useMemo, useState } from 'react'

type MemberStatus = '활성' | '만료됨'

interface MichinaMember {
  name: string
  email: string
  startDate: string
  endDate: string
  status: MemberStatus
}

const mockMembers: MichinaMember[] = [
  {
    name: '김미치',
    email: 'michi.kim@example.com',
    startDate: '2024-12-01',
    endDate: '2025-03-01',
    status: '활성',
  },
  {
    name: '이치나',
    email: 'chinna.lee@example.com',
    startDate: '2024-09-15',
    endDate: '2024-12-15',
    status: '만료됨',
  },
  {
    name: '박유지',
    email: 'yuji.park@example.com',
    startDate: '2025-01-10',
    endDate: '2025-04-10',
    status: '활성',
  },
]

const MichinaPanel = () => {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [showDurationToast, setShowDurationToast] = useState(false)
  const [showUploadToast, setShowUploadToast] = useState(false)
  const [fileName, setFileName] = useState('')

  const orderedMembers = useMemo(() => {
    return [...mockMembers].sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  const handleSaveDuration = () => {
    if (!startDate || !endDate) {
      setShowDurationToast(false)
      return
    }

    setShowDurationToast(true)
    setTimeout(() => setShowDurationToast(false), 2000)
  }

  const handleUploadList = () => {
    if (!fileName) {
      setShowUploadToast(false)
      return
    }

    setShowUploadToast(true)
    setTimeout(() => setShowUploadToast(false), 2000)
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-xl p-6 shadow-md space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">📅 미치나 유지 기간 설정</h3>
          <p className="text-sm text-gray-500">미치나 등급을 유지할 시작일과 종료일을 입력하세요.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="startDate" className="text-sm font-medium text-gray-700">
              시작일
            </label>
            <input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 w-full"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="endDate" className="text-sm font-medium text-gray-700">
              종료일
            </label>
            <input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 w-full"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveDuration}
            className="bg-yellow-400 text-gray-900 font-semibold px-4 py-2 rounded-lg hover:bg-yellow-300 transition"
          >
            저장
          </button>
          {showDurationToast && (
            <span className="text-sm font-medium text-green-600 bg-green-100 px-3 py-1 rounded-lg">
              ✅ 기간이 저장되었습니다
            </span>
          )}
        </div>
      </section>

      <section className="bg-white rounded-xl p-6 shadow-md space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">📤 미치나 명단 업로드</h3>
          <p className="text-sm text-gray-500">
            엑셀 또는 CSV 파일을 업로드하면 해당 사용자가 미치나 등급으로 지정됩니다.
          </p>
        </div>
        <div className="space-y-3">
          <input
            id="file"
            type="file"
            className="block w-full text-sm text-gray-600"
            onChange={(event) => {
              const file = event.target.files?.[0]
              setFileName(file ? file.name : '')
            }}
          />
          {fileName && (
            <p className="text-sm text-gray-500">선택된 파일: {fileName}</p>
          )}
          <button
            type="button"
            onClick={handleUploadList}
            className="bg-yellow-400 text-gray-900 font-semibold px-4 py-2 rounded-lg hover:bg-yellow-300 transition"
          >
            업로드
          </button>
          {showUploadToast && (
            <span className="text-sm font-medium text-green-600 bg-green-100 px-3 py-1 rounded-lg">
              ✅ 명단이 등록되었습니다
            </span>
          )}
        </div>
      </section>

      <section className="bg-white rounded-xl p-6 shadow-md space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">👥 현재 미치나 회원</h3>
          <span className="text-sm text-gray-500">총 {orderedMembers.length}명</span>
        </div>
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">이름</th>
                <th className="px-4 py-3">이메일</th>
                <th className="px-4 py-3">시작일</th>
                <th className="px-4 py-3">종료일</th>
                <th className="px-4 py-3">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {orderedMembers.map((member) => (
                <tr key={member.email} className="hover:bg-yellow-50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900">{member.name}</td>
                  <td className="px-4 py-3 text-gray-600">{member.email}</td>
                  <td className="px-4 py-3 text-gray-600">{member.startDate}</td>
                  <td className="px-4 py-3 text-gray-600">{member.endDate}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        member.status === '만료됨'
                          ? 'bg-red-100 text-red-600'
                          : 'bg-green-100 text-green-600'
                      }`}
                    >
                      {member.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default MichinaPanel
