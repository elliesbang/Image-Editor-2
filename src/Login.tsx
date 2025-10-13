const loginScript = `
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const emailInput = document.querySelector('[data-role="email-input"]');
    const codeInput = document.querySelector('[data-role="code-input"]');
    const sendButton = document.querySelector('[data-action="send-code"]');
    const verifyButton = document.querySelector('[data-action="verify-code"]');
    const codeSection = document.querySelector('[data-role="code-section"]');

    const alertMissingEmail = () => {
      window.alert('이메일을 입력해주세요.');
    };

    sendButton?.addEventListener('click', () => {
      const email = emailInput instanceof HTMLInputElement ? emailInput.value.trim() : '';
      if (!email) {
        alertMissingEmail();
        return;
      }
      window.alert('인증 코드가 ' + email + '로 전송되었습니다.');
      if (codeSection instanceof HTMLElement) {
        codeSection.hidden = false;
      }
      codeInput?.focus?.();
    });

    verifyButton?.addEventListener('click', () => {
      const code = codeInput instanceof HTMLInputElement ? codeInput.value.trim() : '';
      if (!code) {
        window.alert('인증 코드를 입력해주세요.');
        return;
      }
      if (code === '123456') {
        window.alert('이메일 로그인 성공!');
      } else {
        window.alert('인증 코드가 올바르지 않습니다.');
      }
    });
  });
})();
`;

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fffdf2',
      }}
    >
      <h2 style={{ marginBottom: '30px', color: '#333' }}>로그인</h2>

      <div
        style={{
          background: '#fff',
          borderRadius: '12px',
          padding: '30px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
          width: '280px',
          textAlign: 'center',
        }}
      >
        <p style={{ fontWeight: 'bold', marginBottom: '10px' }}>이메일로 로그인</p>
        <input
          type="email"
          placeholder="이메일 주소를 입력하세요"
          data-role="email-input"
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '6px',
            border: '1px solid #ddd',
            marginBottom: '10px',
          }}
        />
        <button
          type="button"
          data-action="send-code"
          style={{
            backgroundColor: '#fef568',
            border: 'none',
            borderRadius: '6px',
            padding: '10px 20px',
            width: '100%',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          6자리 인증 코드 받기
        </button>
        <div data-role="code-section" hidden style={{ marginTop: '16px' }}>
          <input
            type="text"
            placeholder="6자리 인증 코드 입력"
            data-role="code-input"
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '6px',
              border: '1px solid #ddd',
              marginBottom: '10px',
            }}
          />
          <button
            type="button"
            data-action="verify-code"
            style={{
              backgroundColor: '#fef568',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 20px',
              width: '100%',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            인증하기
          </button>
        </div>
      </div>

      <script>{loginScript}</script>
    </div>
  );
}
