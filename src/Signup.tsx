type SignupPageProps = {
  status?: 'success' | 'error'
  message?: string
  values?: {
    name?: string
    email?: string
  }
}

export default function SignupPage({ status, message, values }: SignupPageProps = {}) {
  const nameValue = values?.name ?? ''
  const emailValue = values?.email ?? ''

  return (
    <main className="signup-page" aria-labelledby="signup-heading">
      <section className="signup-card">
        <header className="signup-card__header">
          <h1 className="signup-card__title" id="signup-heading">
            회원가입
          </h1>
        </header>
        {status && message ? (
          <p
            className={`signup-form__notice signup-form__notice--${status}`}
            role={status === 'error' ? 'alert' : 'status'}
          >
            {message}
            {status === 'success' ? (
              <>
                {' '}
                <a className="signup-form__notice-link" href="/">
                  로그인 화면으로 이동하기
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        <form className="signup-form" method="post" action="/signup">
          <label className="signup-form__field" htmlFor="signup-name">
            <span className="signup-form__label">이름</span>
            <input
              className="signup-form__input"
              id="signup-name"
              name="name"
              type="text"
              placeholder="이름을 입력하세요"
              autoComplete="name"
              value={nameValue}
              required
            />
          </label>
          <label className="signup-form__field" htmlFor="signup-email">
            <span className="signup-form__label">이메일</span>
            <input
              className="signup-form__input"
              id="signup-email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={emailValue}
              required
            />
          </label>
          <label className="signup-form__field" htmlFor="signup-password">
            <span className="signup-form__label">비밀번호</span>
            <input
              className="signup-form__input"
              id="signup-password"
              name="password"
              type="password"
              placeholder="비밀번호를 입력하세요"
              autoComplete="new-password"
              required
            />
          </label>
          <button className="signup-form__submit" type="submit">
            회원가입하기
          </button>
        </form>
      </section>
    </main>
  )
}
