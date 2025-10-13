import { useEffect } from "react";

export default function GoogleLoginButton() {
  useEffect(() => {
    const clientId =
      import.meta.env.GOOGLE_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID ||
      window.GOOGLE_CLIENT_ID;

    if (!clientId) {
      console.error("❌ Google Client ID 누락됨");
      alert("Google Client ID가 설정되어 있지 않습니다.");
      return;
    }

    const handleCredentialResponse = (response) => {
      if (!response?.credential) {
        console.error("❌ Google credential 비어 있음");
        return alert("로그인에 실패했습니다. 다시 시도해주세요.");
      }
      localStorage.setItem("google_token", response.credential);
      alert("로그인 성공!");
      window.location.href = "/";
    };

    const initGoogle = () => {
      if (typeof window.google === "undefined") {
        console.warn("⏳ Google SDK 로드 대기 중...");
        setTimeout(initGoogle, 400);
        return;
      }
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
        });
        window.google.accounts.id.renderButton(
          document.getElementById("google-login-button"),
          { theme: "outline", size: "large", width: 250 }
        );
      } catch (error) {
        console.error("⚠️ Google 로그인 초기화 오류:", error);
      }
    };

    if (!document.getElementById("google-client-script")) {
      const script = document.createElement("script");
      script.id = "google-client-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = initGoogle;
      document.body.appendChild(script);
    } else {
      initGoogle();
    }
  }, []);

  return (
    <div
      id="google-login-button"
      style={{
        display: "flex",
        justifyContent: "center",
        marginTop: "20px",
      }}
    ></div>
  );
}
