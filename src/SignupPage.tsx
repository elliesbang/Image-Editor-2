export default function SignupPage() {
  return (
    <main class="signup-page" style={{ backgroundColor: '#f5eee9' }}>
      <style>
        {`
          :root {
            color-scheme: light;
          }

          .signup-page {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px 16px;
            font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            color: #404040;
          }

          .signup-card {
            width: min(480px, 100%);
            background: rgba(255, 255, 255, 0.9);
            border-radius: 24px;
            box-shadow: 0 20px 60px rgba(240, 204, 115, 0.35);
            padding: clamp(24px, 5vw, 48px);
            display: flex;
            flex-direction: column;
            gap: clamp(18px, 3vw, 28px);
          }

          .signup-card__header {
            display: flex;
            flex-direction: column;
            gap: 8px;
            text-align: center;
          }

          .signup-card__title {
            font-size: clamp(1.75rem, 5vw, 2.1rem);
            font-weight: 700;
            letter-spacing: -0.01em;
          }

          .signup-form {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .signup-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .signup-label {
            font-size: 0.92rem;
            font-weight: 600;
            color: rgba(64, 64, 64, 0.9);
          }

          .signup-input {
            border: 1px solid rgba(64, 64, 64, 0.15);
            border-radius: 12px;
            padding: 14px 16px;
            font-size: 1rem;
            background: rgba(255, 255, 255, 0.95);
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
          }

          .signup-input:focus {
            outline: none;
            border-color: #f0c347;
            box-shadow: 0 0 0 4px rgba(254, 245, 104, 0.35);
          }

          .signup-button {
            border: none;
            border-radius: 999px;
            padding: 16px;
            background: linear-gradient(135deg, #fef568 0%, #f0c347 100%);
            color: #404040;
            font-size: 1.05rem;
            font-weight: 700;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            box-shadow: 0 12px 24px rgba(240, 204, 115, 0.45);
          }

          .signup-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 18px 32px rgba(240, 204, 115, 0.55);
          }

          .signup-button:focus {
            outline: none;
            box-shadow: 0 0 0 4px rgba(254, 245, 104, 0.45);
          }

          @media (max-width: 520px) {
            .signup-card {
              border-radius: 20px;
              padding: 28px 22px;
              box-shadow: 0 16px 40px rgba(240, 204, 115, 0.3);
            }

            .signup-button {
              padding: 14px;
              font-size: 1rem;
            }
          }
        `}
      </style>
      <div class="signup-card">
        <header class="signup-card__header">
          <h1 class="signup-card__title">회원가입</h1>
        </header>
        <form class="signup-form" data-role="signup-form">
          <div class="signup-field">
            <label class="signup-label" htmlFor="signupName">
              이름
            </label>
            <input
              id="signupName"
              class="signup-input"
              type="text"
              name="name"
              required
            />
          </div>
          <div class="signup-field">
            <label class="signup-label" htmlFor="signupEmail">
              이메일
            </label>
            <input
              id="signupEmail"
              class="signup-input"
              type="email"
              name="email"
              required
              autoComplete="email"
            />
          </div>
          <div class="signup-field">
            <label class="signup-label" htmlFor="signupPassword">
              비밀번호
            </label>
            <input
              id="signupPassword"
              class="signup-input"
              type="password"
              name="password"
              required
              autoComplete="new-password"
            />
          </div>
          <button class="signup-button" type="submit" data-role="signup-button">
            회원가입하기
          </button>
        </form>
      </div>
      <script>{`
        document.addEventListener('DOMContentLoaded', function () {
          const signupButton = document.querySelector('[data-role="signup-button"]');
          const signupForm = document.querySelector('[data-role="signup-form"]');
          if (signupButton) {
            signupButton.addEventListener('click', function (event) {
              event.preventDefault();
              console.log('회원가입 버튼 클릭됨');
            });
          }
          if (signupForm) {
            signupForm.addEventListener('submit', function (event) {
              event.preventDefault();
              console.log('회원가입 버튼 클릭됨');
            });
          }
        });
      `}</script>
    </main>
  )
}
