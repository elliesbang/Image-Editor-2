import { FormEvent, useMemo, useState } from "react";
import GoogleLoginButton from "../components/GoogleLoginButton";

const COLORS = {
  accent: "#fef568",
  backdrop: "#f5eee9",
  text: "#404040",
  google: "#d9d9d9",
  overlay: "rgba(64, 64, 64, 0.35)",
};

export default function LoginPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const typographyStyle = useMemo(
    () => ({
      fontFamily: "sans-serif",
      color: COLORS.text,
    }),
    [],
  );

  const handleOpenModal = () => {
    console.log("🔓 로그인 모달을 열었습니다.");
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    console.log("🔒 로그인 모달을 닫았습니다.");
    setIsModalOpen(false);
  };

  const handleEmailLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log(`✉️ 이메일 로그인 시도 - email: ${email}`);
  };

  const handleSignUpClick = () => {
    console.log("🧸 회원가입 페이지로 이동합니다.");
  };

  const handleMichinaLogin = () => {
    console.log("🌟 미치나 로그인 버튼이 클릭되었습니다.");
  };

  const handleGoogleLogin = () => {
    console.log("🔍 Google 로그인 버튼이 클릭되었습니다.");

    const googleButton = document.querySelector<HTMLDivElement>(
      "#google-login-button div[role='button']",
    );

    if (googleButton) {
      googleButton.click();
    } else {
      console.warn("⚠️ Google 로그인 버튼이 아직 준비되지 않았습니다.");
    }
  };

  return (
    <div
      style={{
        ...typographyStyle,
        minHeight: "100vh",
        background: COLORS.backdrop,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <button
        onClick={handleOpenModal}
        style={{
          ...typographyStyle,
          background: COLORS.accent,
          border: "none",
          borderRadius: "999px",
          padding: "14px 32px",
          fontSize: "1rem",
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 10px 20px rgba(0, 0, 0, 0.12)",
          transition: "transform 0.2s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.transform = "translateY(-2px)";
          event.currentTarget.style.boxShadow = "0 12px 24px rgba(0, 0, 0, 0.18)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.transform = "translateY(0)";
          event.currentTarget.style.boxShadow = "0 10px 20px rgba(0, 0, 0, 0.12)";
        }}
      >
        엘리의 방 로그인
      </button>

      {isModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            background: COLORS.overlay,
            zIndex: 999,
          }}
        >
          <div
            style={{
              ...typographyStyle,
              position: "relative",
              width: "100%",
              maxWidth: "420px",
              background: "linear-gradient(145deg, #fffef2, " + COLORS.backdrop + ")",
              borderRadius: "26px",
              boxShadow: "0 28px 64px rgba(0, 0, 0, 0.18)",
              padding: "36px 32px",
              display: "flex",
              flexDirection: "column",
              gap: "24px",
            }}
          >
            <button
              aria-label="로그인 창 닫기"
              onClick={handleCloseModal}
              style={{
                position: "absolute",
                top: "18px",
                right: "18px",
                background: "transparent",
                border: "none",
                fontSize: "20px",
                cursor: "pointer",
                color: COLORS.text,
              }}
            >
              ×
            </button>

            <header style={{ textAlign: "center" }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: "1.5rem",
                  fontWeight: 700,
                }}
              >
                엘리의 방에 오신 것을 환영해요
              </h2>
              <p style={{ margin: "8px 0 0", fontSize: "0.95rem", color: "#5c5c5c" }}>
                따스한 노랑빛 속에서 마음 편히 로그인해보세요.
              </p>
            </header>

            <section
              style={{
                background: "rgba(255, 255, 255, 0.85)",
                borderRadius: "18px",
                padding: "22px",
                boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.04)",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>이메일 로그인</h3>
                <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "#5c5c5c" }}>
                  이메일과 비밀번호를 입력하고 로그인 버튼을 눌러주세요.
                </p>
              </div>

              <form onSubmit={handleEmailLogin} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.85rem" }}>
                  이메일
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    style={{
                      padding: "12px 14px",
                      borderRadius: "12px",
                      border: "1px solid rgba(0,0,0,0.08)",
                      fontSize: "0.95rem",
                      color: COLORS.text,
                      background: "rgba(255, 255, 255, 0.9)",
                    }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.85rem" }}>
                  비밀번호
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="비밀번호를 입력하세요"
                    style={{
                      padding: "12px 14px",
                      borderRadius: "12px",
                      border: "1px solid rgba(0,0,0,0.08)",
                      fontSize: "0.95rem",
                      color: COLORS.text,
                      background: "rgba(255, 255, 255, 0.9)",
                    }}
                  />
                </label>

                <button
                  type="submit"
                  style={{
                    marginTop: "4px",
                    padding: "12px 14px",
                    borderRadius: "999px",
                    border: "none",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    background: COLORS.accent,
                    color: COLORS.text,
                    boxShadow: "0 12px 24px rgba(0, 0, 0, 0.12)",
                  }}
                >
                  로그인
                </button>
              </form>

              <a
                href="#signup"
                onClick={(event) => {
                  event.preventDefault();
                  handleSignUpClick();
                }}
                style={{
                  alignSelf: "center",
                  marginTop: "2px",
                  fontSize: "0.85rem",
                  color: "#6a6a6a",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                아직 회원이 아니신가요? 회원가입
              </a>
            </section>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <button
                onClick={handleMichinaLogin}
                style={{
                  padding: "14px",
                  borderRadius: "16px",
                  border: "none",
                  fontSize: "1rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  background: COLORS.accent,
                  color: COLORS.text,
                  boxShadow: "0 16px 28px rgba(254, 245, 104, 0.45)",
                }}
              >
                미치나로 로그인
              </button>

              <button
                onClick={handleGoogleLogin}
                style={{
                  padding: "14px",
                  borderRadius: "16px",
                  border: "none",
                  fontSize: "1rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  background: COLORS.google,
                  color: COLORS.text,
                  boxShadow: "0 12px 26px rgba(0, 0, 0, 0.08)",
                }}
              >
                Google 계정으로 로그인
              </button>
            </div>

            <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
              <GoogleLoginButton />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
