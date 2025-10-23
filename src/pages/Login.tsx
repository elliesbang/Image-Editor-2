import { useNavigate } from 'react-router-dom'

const Login = () => {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#f5eee9] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">관리자 로그인</h1>
          <p className="text-sm text-gray-500">
            관리자 전용 대시보드에 접근하려면 아래 버튼을 눌러주세요.
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-1 text-left">
            <label htmlFor="email" className="text-sm font-medium text-gray-700">
              이메일
            </label>
            <input
              id="email"
              type="email"
              placeholder="admin@example.com"
              className="border border-gray-300 rounded-lg px-3 py-2 w-full"
            />
          </div>
          <div className="space-y-1 text-left">
            <label htmlFor="password" className="text-sm font-medium text-gray-700">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              placeholder="비밀번호를 입력하세요"
              className="border border-gray-300 rounded-lg px-3 py-2 w-full"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/admin')}
          className="w-full bg-yellow-400 text-gray-900 font-semibold px-4 py-3 rounded-lg hover:bg-yellow-300 transition"
        >
          관리자 로그인
        </button>
        <p className="text-xs text-gray-400 text-center">
          버튼 클릭 시 관리자 대시보드 UI 페이지로 이동합니다.
        </p>
      </div>
    </div>
  )
}

export default Login
