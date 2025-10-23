function Footer() {
  return (
    <footer className="bg-ellie-ivory py-10 text-center text-sm text-ellie-text/80">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 sm:px-6 lg:px-8">
        <span className="font-semibold text-ellie-text">엘리의방 이미지 에디터</span>
        <span>문의 : ellie@elliesbang.kr</span>
        <nav className="flex flex-wrap items-center justify-center gap-4 text-xs">
          {['이용약관', '개인정보처리방침', '쿠키정책'].map((item) => (
            <a
              key={item}
              href="#"
              className="rounded-full px-3 py-1 transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
            >
              {item}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  )
}

export default Footer
