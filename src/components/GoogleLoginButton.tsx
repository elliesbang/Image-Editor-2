import { useEffect } from "react";

export default function GoogleLoginButton() {
  useEffect(() => {
    const clientId =
      import.meta.env.VITE_GOOGLE_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID ||
      (typeof GOOGLE_CLIENT_ID !== "undefined" ? GOOGLE_CLIENT_ID : null);

    if (!clientId) {
      console.error("❌ Google Client ID not found");
      return;
    }

    // Google Identity Services 스크립트 추가
    if (!document.getElementById("google-client-script")) {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.id = "google-client-script";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }

    window.onload = () => {
      if (typeof google === "undefined") {
        console.error("❌ Google script failed to load");
        return;
      }

      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
      });

      google.accounts.id.renderButton(
        document.getElementById("google-login-button"),
        { theme: "outline", size: "large" }
      );
    };

    function handleCredentialResponse(response: any) {
      const token = response.credential;
      if (!token) {
        console.error("❌ No credential returned");
        return;
      }

      localStorage.setItem("google_token", token);
      alert("✅ 로그인 성공!");
    }
  }, []);

  return <div id="google-login-button" style={{ marginTop: "1rem" }}></div>;
}
