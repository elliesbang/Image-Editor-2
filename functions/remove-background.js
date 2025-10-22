export const onRequestPost = async () => {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  }

  return new Response(
    JSON.stringify({
      error: 'BACKGROUND_REMOVAL_LOCAL_ONLY',
      message:
        'Background removal must be processed locally via the HTML5 Canvas workflow. Please open the editor UI and run the local pipeline instead of calling this endpoint.',
    }),
    { status: 410, headers },
  )
}
