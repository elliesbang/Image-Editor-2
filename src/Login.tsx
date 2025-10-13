import GoogleLoginButton from "../components/GoogleLoginButton";

export default function LoginPage() {
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
      <h2 style={{ marginBottom: "20px", color: "#333" }}>로그인</h2>
      <GoogleLoginButton />
    </div>
  );
}