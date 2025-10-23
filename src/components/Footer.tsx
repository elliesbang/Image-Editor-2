import { useEffect, useState } from 'react'

const termsContent = [
  '[엘리의방 이미지 에디터 이용약관]',
  '',
  '제1조 (목적)',
  '이 약관은 엘리의방 이미지 에디터(이하 "서비스")의 이용조건과 운영에 관한 제반 사항을 규정함을 목적으로 합니다.',
  '',
  '제2조 (서비스 내용)',
  '1. 본 서비스는 AI 기술을 활용한 이미지 편집 및 학습용 툴입니다.  ',
  '2. 제공 기능에는 이미지 업로드, 배경제거, 크롭, 리사이즈, 키워드 분석 등의 AI 편집 도구가 포함됩니다.  ',
  '3. 일부 고급 기능은 로그인 또는 업그레이드 회원에게만 제공될 수 있습니다.',
  '',
  '제3조 (이용자의 의무)',
  '1. 이용자는 저작권, 초상권 등 제3자의 권리를 침해하지 않아야 합니다.  ',
  '2. 불법적이거나 상업적 목적의 무단 사용은 금지됩니다.  ',
  '',
  '제4조 (서비스의 변경 및 중단)',
  '운영상, 기술상의 필요에 따라 서비스의 일부 또는 전부가 변경되거나 중단될 수 있으며, 사전 공지 후 시행합니다.',
  '',
  '제5조 (면책)',
  '1. 본 서비스는 편집 결과의 완전성을 보장하지 않으며, 사용자가 업로드한 이미지에 대한 책임은 이용자에게 있습니다.  ',
  '2. 천재지변, 서버 장애 등의 불가항력으로 발생한 손해에 대해서는 책임을 지지 않습니다.'
].join('\n')

const privacyContent = [
  '[엘리의방 이미지 에디터 개인정보처리방침]',
  '',
  '1. 수집하는 개인정보 항목',
  '- 이메일, 이름, 로그인 기록, 서비스 이용 내역',
  '',
  '2. 개인정보의 수집 및 이용 목적',
  '- 사용자 식별 및 로그인 관리  ',
  '- 서비스 품질 향상을 위한 내부 분석  ',
  '',
  '3. 개인정보의 보유 및 이용 기간',
  '- 회원 탈퇴 시 즉시 파기  ',
  '- 단, 법적 보관 의무가 있는 경우 해당 기간 동안 보관',
  '',
  '4. 개인정보의 위탁 및 제공',
  '- 제3자에게 정보를 제공하지 않습니다.  ',
  '- 다만, 클라우드 서비스(AWS, Cloudflare 등) 내 보안 저장소에 암호화된 형태로 보관됩니다.',
  '',
  '5. 이용자의 권리',
  '- 언제든 자신의 개인정보를 열람, 수정, 삭제할 수 있습니다.  ',
  '- 요청은 “문의: ellie@elliesbang.kr”로 가능합니다.',
  '',
  '6. 개인정보 보호 책임자',
  '책임자: Ellie’s Bang 운영팀  ',
  '이메일: ellie@elliesbang.kr'
].join('\n')

const cookieContent = [
  '[엘리의방 이미지 에디터 쿠키정책]',
  '',
  '1. 쿠키 사용 목적',
  '- 로그인 상태 유지  ',
  '- 서비스 이용 통계 및 UX 개선  ',
  '',
  '2. 쿠키의 설치·운영 및 거부',
  '- 사용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있습니다.  ',
  '- 쿠키를 거부할 경우 일부 서비스 기능이 제한될 수 있습니다.  ',
  '',
  '3. 쿠키 보관 기간',
  '- 로그인 쿠키: 7일  ',
  '- 세션 쿠키: 브라우저 종료 시 삭제  ',
  '',
  '4. 쿠키 관련 문의',
  '문의 : ellie@elliesbang.kr'
].join('\n')

const MODALS = {
  terms: {
    title: '이용약관',
    content: termsContent
  },
  privacy: {
    title: '개인정보처리방침',
    content: privacyContent
  },
  cookie: {
    title: '쿠키정책',
    content: cookieContent
  }
} as const

type ModalKey = keyof typeof MODALS

function Footer() {
  const [openModal, setOpenModal] = useState<ModalKey | null>(null)

  const closeModal = () => setOpenModal(null)

  useEffect(() => {
    if (!openModal) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [openModal])

  const modal = openModal ? MODALS[openModal] : null

  return (
    <>
      <footer className="bg-ellie-yellow border-t border-[#e6dccc] py-6 text-center text-[#404040] text-xs sm:text-sm space-y-2">
        <p className="font-semibold">엘리의방 이미지 에디터</p>
        <p>
          문의 :{' '}
          <a href="mailto:ellie@elliesbang.kr" className="hover:text-[#ffd331]">
            ellie@elliesbang.kr
          </a>
        </p>
        <div className="flex justify-center gap-4 text-xs sm:text-sm">
          <button
            type="button"
            onClick={() => setOpenModal('terms')}
            className="hover:text-[#ffd331]"
          >
            이용약관
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setOpenModal('privacy')}
            className="hover:text-[#ffd331]"
          >
            개인정보처리방침
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setOpenModal('cookie')}
            className="hover:text-[#ffd331]"
          >
            쿠키정책
          </button>
        </div>
      </footer>

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={closeModal}
          aria-modal="true"
          role="dialog"
          aria-label={modal.title}
        >
          <div
            className="max-h-[80vh] w-[90%] max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold text-[#404040]">{modal.title}</h2>
            <p className="text-sm text-gray-600 whitespace-pre-line">{modal.content}</p>
            <button
              type="button"
              onClick={closeModal}
              className="mt-6 w-full rounded-xl bg-[#ffd331] py-2 font-medium text-[#404040] hover:bg-[#ffec8b]"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default Footer
