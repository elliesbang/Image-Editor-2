import React from "react";
import { useState } from "react";
import GoogleLoginButton from "../components/GoogleLoginButton";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");

  const handleSendCode = () => {
    if (!email) {
      alert("이메일을 입력해주세요.");
      return;
    }
    // ✅ 이메일 인증 코드 발송 로직 (임시 알림)
    alert(`인증 코드가 ${email}로 전송되었습니다.`);
    setCodeSent(true);
  };

  const handleVerifyCode = () => {
    if (code === "123456") {
      alert("이메일 로그인 성공!");
      // ✅ 로그인 처리 로직 (예: 세션 저장)
    } else {
      alert("인증 코드가 올바르지 않습니다.");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#fffdf2",
      }}
    >
      <h2 style={{ marginBottom: "30px", color: "#333" }}>로그인</h2>

      {/* ✅ 이메일 로그인 영역 */}
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "30px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
          width: "280px",
          textAlign: "center",
        }}
      >
        <p style={{ fontWeight: "bold", marginBottom: "10px" }}>이메일로 로그인</p>
        <input
          type="email"
          placeholder="이메일 주소를 입력하세요"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #ddd",
            marginBottom: "10px",
          }}
        />
        {codeSent ? (
          <>
            <input
              type="text"
              placeholder="6자리 인증 코드 입력"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                border: "1px solid #ddd",
                marginBottom: "10px",
              }}
            />
            <button
              onClick={handleVerifyCode}
              style={{
                backgroundColor: "#fef568",
                border: "none",
                borderRadius: "6px",
                padding: "10px 20px",
                width: "100%",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              인증하기
            </button>
          </>
        ) : (
          <button
            onClick={handleSendCode}
            style={{
              backgroundColor: "#fef568",
              border: "none",
              borderRadius: "6px",
              padding: "10px 20px",
              width: "100%",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            6자리 인증 코드 받기
          </button>
        )}
      </div>

      {/* ✅ 구글 로그인 버튼 */}
      <div style={{ marginTop: "40px", textAlign: "center" }}>
        <p style={{ color: "#777", marginBottom: "10px" }}>또는 Google로 로그인</p>
        <GoogleLoginButton />
      </div>
    </div>
  );
}