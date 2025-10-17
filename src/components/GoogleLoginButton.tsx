import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize(options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }): void;
          renderButton(container: HTMLElement, options?: Record<string, unknown>): void;
          prompt(): void;
          cancel(): void;
        };
      };
    };
    GOOGLE_CLIENT_ID?: string;
  }
}

type GoogleCredentialResponse = {
  credential?: string;
  clientId?: string;
  select_by?: string;
};

const GOOGLE_SDK_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_SDK_ID = "google-client-script";

type GoogleConfigResponse = {
  clientId?: unknown;
  redirectUri?: unknown;
  loginUrl?: unknown;
  error?: unknown;
};

let cachedGoogleClientId: string | undefined;
let googleClientIdPromise: Promise<string | undefined> | null = null;

const resolveGoogleClientId = (): string | undefined => {
  if (typeof window !== "undefined" && typeof window.GOOGLE_CLIENT_ID === "string") {
    const trimmed = window.GOOGLE_CLIENT_ID.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  const env = import.meta.env as Record<string, string | undefined>;
  for (const key of ["VITE_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"]) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      if (typeof window !== "undefined") {
        window.GOOGLE_CLIENT_ID = trimmed;
      }
      return trimmed;
    }
  }

  if (typeof document !== "undefined") {
    const configScript = document.querySelector<HTMLScriptElement>("script[data-role='app-config']");
    const raw = configScript?.textContent ?? "";
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { googleClientId?: unknown };
        if (typeof parsed.googleClientId === "string" && parsed.googleClientId.trim()) {
          const trimmed = parsed.googleClientId.trim();
          if (typeof window !== "undefined") {
            window.GOOGLE_CLIENT_ID = trimmed;
          }
          return trimmed;
        }
      } catch (error) {
        console.warn("⚠️ 앱 설정 스크립트에서 Google Client ID를 파싱하지 못했습니다.", error);
      }
    }
  }

  return undefined;
};

const fetchGoogleClientId = async (): Promise<string | undefined> => {
  if (cachedGoogleClientId) {
    return cachedGoogleClientId;
  }

  if (!googleClientIdPromise) {
    const pending = (async () => {
      const response = await fetch("/api/auth/google/config", {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });

      let payload: GoogleConfigResponse | null = null;
      try {
        payload = (await response.json()) as GoogleConfigResponse;
      } catch (error) {
        payload = null;
      }

      if (!response.ok) {
        const fallback = response.status >= 500 ? "GOOGLE_CONFIG_FETCH_FAILED" : "GOOGLE_AUTH_NOT_CONFIGURED";
        const message =
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : fallback;
        throw new Error(message);
      }

      const clientId = payload && typeof payload.clientId === "string" ? payload.clientId.trim() : "";

      if (!clientId) {
        throw new Error("GOOGLE_CLIENT_ID_MISSING");
      }

      if (typeof window !== "undefined") {
        window.GOOGLE_CLIENT_ID = clientId;
      }

      return clientId;
    })();

    googleClientIdPromise = pending
      .then((clientId) => {
        cachedGoogleClientId = clientId;
        return clientId;
      })
      .catch((error) => {
        cachedGoogleClientId = undefined;
        throw error;
      })
      .finally(() => {
        googleClientIdPromise = null;
      });
  }

  return googleClientIdPromise;
};

export default function GoogleLoginButton() {
  const buttonContainerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let disposed = false;

    const handleCredentialResponse = (response: GoogleCredentialResponse) => {
      if (!response || !response.credential) {
        console.error("❌ Google 로그인 실패: credential이 비어 있습니다.");
        alert("Google 인증 토큰을 확인하지 못했습니다. 다시 시도해주세요.");
        return;
      }

      console.log("✅ Google 로그인 성공", response);
      try {
        localStorage.setItem("google_token", response.credential);
      } catch (error) {
        console.warn("⚠️ Google 토큰을 저장하지 못했습니다.", error);
      }
      alert("Google 계정으로 로그인되었습니다.");
      window.location.href = "/";
    };

    const initializeButton = (clientId: string) => {
      const render = () => {
        if (disposed) {
          return;
        }
        const googleApi = window.google?.accounts?.id;
        if (!googleApi) {
          // 아직 SDK 로드가 완료되지 않은 경우 조금 뒤에 다시 시도
          window.setTimeout(render, 200);
          return;
        }

        try {
          googleApi.initialize({
            client_id: clientId,
            callback: handleCredentialResponse,
          });

          const container = buttonContainerRef.current;
          if (!container) {
            console.error("❌ Google 로그인 버튼 컨테이너를 찾을 수 없습니다.");
            setStatus("error");
            return;
          }

          container.innerHTML = ""; // 중복 렌더링 방지
          googleApi.renderButton(container, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            width: 260,
            shape: "rectangular",
          });
          googleApi.prompt();
          setStatus("ready");
        } catch (error) {
          console.error("❌ Google 로그인 초기화 중 오류 발생", error);
          setStatus("error");
        }
      };

      render();
    };

    const prepareClientId = async (): Promise<string | undefined> => {
      const cachedId = resolveGoogleClientId();
      if (cachedId) {
        return cachedId;
      }

      try {
        const fetchedId = await fetchGoogleClientId();
        return fetchedId;
      } catch (error) {
        console.error("❌ Google Client ID를 불러오지 못했습니다.", error);
        if (!disposed) {
          const message =
            error instanceof Error &&
            (error.message === "GOOGLE_AUTH_NOT_CONFIGURED" || error.message === "GOOGLE_CLIENT_ID_MISSING")
              ? "현재 Google 로그인을 사용할 수 없습니다. 이메일 로그인으로 계속 진행해주세요."
              : "Google 로그인 구성을 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
          alert(message);
          setStatus("error");
        }
        return undefined;
      }
    };

    let cleanupScript: HTMLScriptElement | null = null;
    let loadHandler: (() => void) | null = null;
    let errorHandler: ((event: Event) => void) | null = null;

    const start = async () => {
      const clientId = await prepareClientId();
      if (!clientId || disposed) {
        return;
      }

      const handleLoad = () => {
        initializeButton(clientId);
      };

      const handleError = (event: Event) => {
        if (!disposed) {
          console.error("❌ Google SDK 로드에 실패했습니다.", event);
          setStatus("error");
        }
      };

      const existingScript =
        document.querySelector<HTMLScriptElement>("script[data-role='google-sdk']") ||
        document.getElementById(GOOGLE_SDK_ID);

      loadHandler = handleLoad;
      errorHandler = handleError;

      if (window.google?.accounts?.id) {
        initializeButton(clientId);
        return;
      }

      if (existingScript instanceof HTMLScriptElement) {
        existingScript.addEventListener("load", handleLoad);
        existingScript.addEventListener("error", handleError);
        cleanupScript = existingScript;
        return;
      }

      const script = document.createElement("script");
      script.id = GOOGLE_SDK_ID;
      script.src = GOOGLE_SDK_SRC;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", handleLoad);
      script.addEventListener("error", handleError);
      document.head.appendChild(script);
      cleanupScript = script;
    };

    start();

    return () => {
      disposed = true;
      const script = cleanupScript ||
        document.querySelector<HTMLScriptElement>("script[data-role='google-sdk']") ||
        document.getElementById(GOOGLE_SDK_ID);
      if (script instanceof HTMLScriptElement) {
        if (loadHandler) {
          script.removeEventListener("load", loadHandler);
        }
        if (errorHandler) {
          script.removeEventListener("error", errorHandler);
        }
      }
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
      <div id="google-login-button" ref={buttonContainerRef} aria-live="polite" />
      {status === "loading" ? (
        <span style={{ fontSize: "12px", color: "#777" }}>Google 로그인 준비 중…</span>
      ) : null}
      {status === "error" ? (
        <span style={{ fontSize: "12px", color: "#d14343" }}>
          Google 로그인을 사용할 수 없습니다. 설정을 확인한 후 다시 시도해주세요.
        </span>
      ) : null}
    </div>
  );
}
