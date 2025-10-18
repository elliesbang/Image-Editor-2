export async function onRequestPost(context) {
  try {
    const { env, request } = context
    const apiKey = env.REMOVE_BG_API_KEY
    const imageArrayBuffer = await request.arrayBuffer()
    const imageBlob = new Blob([imageArrayBuffer])

    let outputBuffer = null

    if (apiKey) {
      const response = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
        },
        body: imageBlob,
      })

      if (response.ok) {
        outputBuffer = await response.arrayBuffer()
        console.log('✅ remove.bg 성공')
      } else {
        console.warn('⚠️ remove.bg 실패, 캔버스로 전환')
      }
    }

    if (!outputBuffer) {
      console.log('🖌️ 캔버스 폴백 실행')
      const base64 = arrayBufferToBase64(imageArrayBuffer)
      return new Response(JSON.stringify({ fallback: true, base64 }), {
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }

    return new Response(outputBuffer, {
      headers: {
        'Content-Type': 'image/png',
      },
    })
  } catch (error) {
    console.error('🔥 Background removal error:', error)
    return new Response('배경 제거 실패', { status: 500 })
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
