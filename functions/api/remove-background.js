export async function onRequestPost(context) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })

  try {
    const { env, request } = context
    const rawApiKey = typeof env.REMOVE_BG_API_KEY === 'string' ? env.REMOVE_BG_API_KEY : ''
    const apiKey = rawApiKey.trim()

    const arrayBuffer = await request.arrayBuffer()
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return new Response(JSON.stringify({ error: 'IMAGE_PAYLOAD_REQUIRED' }), {
        status: 400,
        headers,
      })
    }

    const requestContentType = request.headers.get('content-type') || ''
    const requestedFileName =
      request.headers.get('x-file-name') || request.headers.get('x-filename') || 'image.png'

    if (apiKey) {
      try {
        const normalizedType = requestContentType && requestContentType !== 'application/octet-stream'
          ? requestContentType
          : 'image/png'
        const uploadBlob = new Blob([arrayBuffer], { type: normalizedType })
        const formData = new FormData()
        formData.append('image_file', uploadBlob, requestedFileName)
        formData.append('size', 'auto')

        const response = await fetch('https://api.remove.bg/v1.0/removebg', {
          method: 'POST',
          headers: { 'X-Api-Key': apiKey },
          body: formData,
        })

        if (response.ok) {
          const outputBuffer = await response.arrayBuffer()
          const base64 = arrayBufferToBase64(outputBuffer)
          console.log('✅ remove.bg background removal succeeded')
          return new Response(JSON.stringify({ base64 }), { headers })
        }

        const status = response.status
        let detail = ''
        try {
          const payload = await response.json()
          detail = typeof payload?.errors === 'object' ? JSON.stringify(payload.errors) : JSON.stringify(payload)
        } catch {
          try {
            detail = await response.text()
          } catch {
            detail = ''
          }
        }

        if (status === 402 || status === 429) {
          console.warn('⚠️ remove.bg credits exhausted or rate limited. Falling back to canvas.', detail)
          return new Response(
            JSON.stringify({ fallback: true, reason: 'REMOVE_BG_CREDIT_EXHAUSTED', detail }),
            { headers },
          )
        }

        console.warn('⚠️ remove.bg request failed. Falling back to canvas.', detail)
      } catch (error) {
        console.error('⚠️ remove.bg request threw an error. Falling back to canvas.', error)
      }
    } else {
      console.warn('⚠️ REMOVE_BG_API_KEY is not configured. Falling back to canvas background removal.')
    }

    const reason = apiKey ? 'REMOVE_BG_REQUEST_FAILED' : 'REMOVE_BG_API_KEY_MISSING'
    return new Response(
      JSON.stringify({ fallback: true, reason }),
      { headers },
    )
  } catch (error) {
    console.error('🔥 Background removal error:', error)
    return new Response(JSON.stringify({ error: 'BACKGROUND_REMOVAL_FAILED' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
}

function arrayBufferToBase64(arrayBuffer) {
  let binary = ''
  const bytes = new Uint8Array(arrayBuffer)
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk)
  }

  return btoa(binary)
}
