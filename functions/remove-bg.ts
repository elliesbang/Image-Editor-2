import type { PagesFunction } from '@cloudflare/workers-types'

export const onRequestPost: PagesFunction = async () => {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  })

  return new Response(
    JSON.stringify({
      error: 'BACKGROUND_REMOVAL_LOCAL_ONLY',
      message:
        'This endpoint no longer performs remote background removal. Please use the client-side HTML5 Canvas tools to process images entirely offline.',
    }),
    { status: 410, headers },
  )
}
