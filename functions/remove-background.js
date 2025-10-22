import OpenAI from 'openai'

export const onRequestPost = async (context) => {
  const { env, request } = context
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY })

  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!file) {
      return new Response('No file received', { status: 400 })
    }

    const cacheBuster = Date.now()

    async function callOpenAI(retries = 3) {
      for (let i = 0; i < retries; i += 1) {
        try {
          const result = await client.images.edit({
            image: file,
            mask: null,
            prompt:
              'Remove all background cleanly, preserve subject edges and natural shadows, output transparent PNG, crop tightly to subject.',
            size: '1024x1024',
          })
          return result.data?.[0]?.url
        } catch (err) {
          if (i === retries - 1) {
            throw err
          }
          const delay = 1500 * (i + 1)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
      throw new Error('OPENAI_IMAGE_EDIT_FAILED')
    }

    const imageUrl = await callOpenAI()
    if (!imageUrl) {
      throw new Error('OPENAI_IMAGE_URL_MISSING')
    }

    const imageResponse = await fetch(`${imageUrl}?cb=${cacheBuster}`)
    if (!imageResponse.ok) {
      throw new Error(`IMAGE_DOWNLOAD_FAILED_${imageResponse.status}`)
    }

    const buffer = await imageResponse.arrayBuffer()

    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('❌ Background removal failed:', error)
    return new Response(
      JSON.stringify({
        error: 'Background removal failed',
        detail: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        date: '2025-10-22',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
