import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#8b5cf6" />
        <meta
          name="description"
          content="모던하고 직관적인 Easy Image Editor에서 드래그 앤 드롭으로 이미지를 업로드하고, 실시간으로 필터와 회전을 조정해 감각적인 이미지를 완성해 보세요."
        />
        <title>멀티 이미지 편집 스튜디오</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/remixicon@4.3.0/fonts/remixicon.css" />
        <link href="/static/style.css" rel="stylesheet" />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/imagetracerjs/1.2.6/imagetracer_v1.2.6.min.js" defer data-lib="imagetracer"></script>
        <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js" defer></script>
        <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js" defer></script>
        <script src="https://accounts.google.com/gsi/client" async defer data-role="google-sdk"></script>
      </head>
      <body>
        {children}
        <script type="module" src="/static/app.js"></script>
      </body>
    </html>
  )
})
