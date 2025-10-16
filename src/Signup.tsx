export default function SignupPage() {
  return (
    <main class="signup-page" aria-labelledby="signup-heading">
      <section class="signup-card">
        <header class="signup-card__header">
          <h1 class="signup-card__title" id="signup-heading">
            회원가입
          </h1>
        </header>
        <form class="signup-form" method="post" action="#">
          <label class="signup-form__field" for="signup-name">
            <span class="signup-form__label">이름</span>
            <input
              class="signup-form__input"
              id="signup-name"
              name="name"
              type="text"
              placeholder="이름을 입력하세요"
              autocomplete="name"
              required
            />
          </label>
          <label class="signup-form__field" for="signup-email">
            <span class="signup-form__label">이메일</span>
            <input
              class="signup-form__input"
              id="signup-email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              required
            />
          </label>
          <label class="signup-form__field" for="signup-password">
            <span class="signup-form__label">비밀번호</span>
            <input
              class="signup-form__input"
              id="signup-password"
              name="password"
              type="password"
              placeholder="비밀번호를 입력하세요"
              autocomplete="new-password"
              required
            />
          </label>
          <button class="signup-form__submit" type="submit">
            회원가입하기
          </button>
        </form>
      </section>
    </main>
  )
}
