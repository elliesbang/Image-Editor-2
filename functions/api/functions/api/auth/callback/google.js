import { google } from "googleapis";

export async function onRequestGet(context) {
  try {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = context.env;
    const url = new URL(context.request.url);
    const code = url.searchParams.get("code");

    if (!code) {
      return new Response("Missing authorization code", { status: 400 });
    }

    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const headers = new Headers({
      "Set-Cookie": `user_email=${userInfo.email}; Path=/; HttpOnly; SameSite=Lax`,
      "Content-Type": "text/html",
    });

    return new Response(
      `<script>
         alert("Google 로그인 성공! ${userInfo.email}님 환영합니다.");
         window.location.href = "/";
       </script>`,
      { headers }
    );
  } catch (error) {
    console.error("Google Auth Error:", error);
    return new Response("Google 로그인 처리 중 오류 발생", { status: 500 });
  }
}