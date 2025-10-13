import { useEffect } from "react";

export default function GoogleLoginButton() {
  useEffect(() => {
    // ✅ 다양한 환경변수 이름을 모두 지원하도록 통합
    const clientId =
      import.meta.env.VITE_GOOGLE_CLIENT_ID ||
      import.meta.env.GOOGLE_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID ||
      window.GOOGLE_CLIENT_ID;

    if (!clientId) {
      console.error("❌ Google Client ID가 설정되어 있지 않습니다.");
      alert("Google Client ID가 누락되어 있습니다. 관리자에게 문의하세요.");
      return;
    }

    // ✅ 로그인 성공 시 실행되는 콜백
    const handleCredentialResponse = (response: any) => {
      if (!response || !response.credential) {
        console.error("❌ Google 로그인 실패: credential이 비어 있습니다.");
        alert("로그인에 실패했습니다. 다시 시도해주세요.");
        return;
      }

      console.log("✅ 구글 로그인 성공:", response);
      localStorage.setItem("google_token", response.credential);
      alert("로그인 성공!");
      window.location.href = "/"; // 로그인 후 이동할 경로 (원하면 수정)
    };

    // ✅ 구글 SDK 초기화
    const initGoogle = () => {
      if (typeof window.google === "undefined") {
        console.warn("⏳ Google SDK가 아직 로드되지 않았습니다. 0.5초 후 재시도...");
        setTimeout(initGoogle, 500);
        return;
      }

      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
        });

        window.google.accounts.id.renderButton(
          document.getElementById("google-login-button"),
          {
            theme: "outline",
            size: "large",
            text: "continue_with",
            width: 260,
          }
        );
      } catch (err) {
        console.error("❌ Google 로그인 초기화 중 오류 발생:", err);
      }
    };

    // ✅ SDK 스크립트 로드
    if (!document.getElementById("google-client-script")) {
      const script = document.createElement("script");
      script.id = "google-client-script";
      script