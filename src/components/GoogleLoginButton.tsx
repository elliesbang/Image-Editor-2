import { useEffect } from "react";

export default function GoogleLoginButton() {
  useEffect(() => {
    const clientId =
      import.meta.env.VITE_GOOGLE_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID ||
      window.GOOGLE_CLIENT_ID;

    if (!clientId) {
      console.error("❌ Google Client ID가 없습니다. Cloudflare 환경변수를 확인하세요.");
      return;
    }

    const handleCredentialResponse = (response: any) => {
      if (!response.credential) {
        console.error("❌ 로그인 실패: credential이 비어 있습니다.");
        alert("로그인에 실패했습니다. 다시 시도해주세요.");
        return;
      }

      console.log("✅ 구글 로그인 성공:", response);
      localStorage.setItem("google_token", response.credential);
      alert("✅ 로그인 성공!");
      // ✅ 로그인 성공 후 이동 (원하시는 경로로 수정 가능)
      window.location.href = "/";
    };

    const initGoogle = () => {
      if (typeof window.google === "undefined") {
        console.warn("⏳ Google SDK가 아직 로드되지 않았습니다. 재시도 중...");
        setTimeout(initGoogle, 500);
        return;
      }

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
      });

      window.google.accounts.id.renderButton(
        document.getElementById("google-login-button"),
        { theme: "filled_black", size: "large", width: 280 }
      );
    };

    if (!document.getElementById("google-client-script")) {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.id = "google-client-script";
      script.async = true;
      script.defer = true;
      script.onload = initGoogle;
      document.body.appendChild(script);
    } else {
      initGoogle();
    }
  }, []);

  return (
    <div style={{ marginTop: "20px", textAlign: "center" }}>
      <div id="google-login-button"></div>
      <p style={{ marginTop: "10px", color: "#666", fontSize: "14px" }}>
        Google 계정으로 로그인
      </p>
    </div>
  );
}