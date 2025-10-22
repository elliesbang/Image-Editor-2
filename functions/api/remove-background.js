export async function onRequestPost() {
  return new Response(
    JSON.stringify({
      error: 'BACKGROUND_REMOVAL_LOCAL_ONLY',
      message: '배경 제거는 브라우저에서만 지원됩니다.',
    }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  )
}
