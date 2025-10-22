import OpenAI from '../utils/openai-lite.js'

const decodeBase64ToUint8Array = (base64) => {
  const normalized = (base64 || '').replace(/\s+/g, '')

  if (typeof atob === 'function') {
    const binary = atob(normalized)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  }

  const globalBuffer =
    typeof globalThis !== 'undefined' && globalThis && globalThis.Buffer ? globalThis.Buffer : null
  if (globalBuffer && typeof globalBuffer.from === 'function') {
    const buffer = globalBuffer.from(normalized, 'base64')
    if (buffer instanceof Uint8Array) {
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    }
    return new Uint8Array(buffer)
  }

  throw new Error('BASE64_DECODING_NOT_SUPPORTED')
}

const parseImageDataUrl = (value) => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed.startsWith('data:image')) {
    return null
  }
  const match = trimmed.match(/^data:(image\/[a-z0-9.+\-]+);base64,(.+)$/i)
  if (!match) {
    return null
  }
  const mimeType = (match[1] || '').toLowerCase()
  const base64 = (match[2] || '').trim()
  if (!mimeType || !base64) {
    return null
  }
  return { mimeType, base64 }
}

const sanitizeFileName = (value, fallback = 'image.png') => {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return fallback
  }
  const safe = trimmed.replace(/[\r\n\t]+/g, ' ').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').trim()
  if (!safe) {
    return fallback
  }
  return safe.toLowerCase().endsWith('.png') ? safe : `${safe.replace(/\.[^./]+$/, '') || 'image'}.png`
}

const toUploadBlob = (bytes, mimeType, name) => {
  const type = mimeType && typeof mimeType === 'string' ? mimeType : 'image/png'
  if (typeof File === 'function') {
    try {
      return new File([bytes], name, { type })
    } catch (error) {
      console.warn('File constructor not available, falling back to Blob.', error)
    }
  }
  return new Blob([bytes], { type })
}

const extractImageFromRequest = async (request) => {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  let imageBlob = null
  let fileName = 'image.png'

  if (contentType.includes('application/json')) {
    let body
    try {
      body = await request.json()
    } catch (error) {
      return { imageBlob: null, fileName: null, error: 'INVALID_JSON_BODY' }
    }
    if (!body || typeof body.image !== 'string') {
      return { imageBlob: null, fileName: null, error: 'IMAGE_DATA_URL_REQUIRED' }
    }
    const parsed = parseImageDataUrl(body.image)
    if (!parsed) {
      return { imageBlob: null, fileName: null, error: 'INVALID_IMAGE_DATA_URL' }
    }
    fileName = sanitizeFileName(body.name, 'image.png')
    imageBlob = toUploadBlob(decodeBase64ToUint8Array(parsed.base64), parsed.mimeType, fileName)
    return { imageBlob, fileName }
  }

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const fileEntry = formData.get('file') ?? formData.get('image')
    const nameEntry = formData.get('name')
    fileName = sanitizeFileName(
      typeof nameEntry === 'string' && nameEntry ? nameEntry : fileEntry && typeof fileEntry.name === 'string' ? fileEntry.name : null,
      'image.png',
    )

    if (fileEntry && typeof fileEntry === 'object' && 'arrayBuffer' in fileEntry) {
      const fileLike = fileEntry
      const arrayBuffer = await fileLike.arrayBuffer()
      const mimeType = typeof fileLike.type === 'string' && fileLike.type ? fileLike.type : 'image/png'
      imageBlob = toUploadBlob(new Uint8Array(arrayBuffer), mimeType, fileName)
      return { imageBlob, fileName }
    }

    if (typeof fileEntry === 'string' && fileEntry.startsWith('data:')) {
      const parsed = parseImageDataUrl(fileEntry)
      if (!parsed) {
        return { imageBlob: null, fileName: null, error: 'INVALID_IMAGE_DATA_URL' }
      }
      imageBlob = toUploadBlob(decodeBase64ToUint8Array(parsed.base64), parsed.mimeType, fileName)
      return { imageBlob, fileName }
    }

    return { imageBlob: null, fileName: null, error: 'IMAGE_FILE_REQUIRED' }
  }

  if (contentType.startsWith('image/') || contentType === 'application/octet-stream') {
    const arrayBuffer = await request.arrayBuffer()
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return { imageBlob: null, fileName: null, error: 'IMAGE_PAYLOAD_REQUIRED' }
    }
    const headerName = request.headers.get('x-file-name') || request.headers.get('x-filename')
    fileName = sanitizeFileName(headerName, 'image.png')
    const mimeType = contentType.startsWith('image/') ? contentType : 'image/png'
    imageBlob = toUploadBlob(new Uint8Array(arrayBuffer), mimeType, fileName)
    return { imageBlob, fileName }
  }

  const textBody = await request.text()
  if (textBody) {
    try {
      const fallback = JSON.parse(textBody)
      if (fallback && typeof fallback.image === 'string') {
        const parsed = parseImageDataUrl(fallback.image)
        if (!parsed) {
          return { imageBlob: null, fileName: null, error: 'INVALID_IMAGE_DATA_URL' }
        }
        fileName = sanitizeFileName(fallback.name, 'image.png')
        imageBlob = toUploadBlob(decodeBase64ToUint8Array(parsed.base64), parsed.mimeType, fileName)
        return { imageBlob, fileName }
      }
    } catch (error) {
      return { imageBlob: null, fileName: null, error: 'INVALID_JSON_BODY' }
    }
  }

  return { imageBlob: null, fileName: null, error: 'IMAGE_FILE_REQUIRED' }
}

export const onRequestPost = async (context) => {
  const { env, request } = context

  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY_NOT_CONFIGURED' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { imageBlob, fileName, error } = await extractImageFromRequest(request)
  if (!imageBlob) {
    return new Response(JSON.stringify({ error: error || 'IMAGE_FILE_REQUIRED' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
  const prompt =
    'Remove all background cleanly, preserve subject edges and natural shadows, output transparent PNG, crop tightly to subject.'

  const callOpenAI = async (retries = 3) => {
    let lastError = null
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const result = await client.images.edit({
          image: imageBlob,
          mask: null,
          prompt,
          size: '1024x1024',
          response_format: 'b64_json',
        })

        const payload = result?.data?.[0]
        if (!payload) {
          throw new Error('OPENAI_IMAGE_EDIT_NO_RESULT')
        }

        if (typeof payload.b64_json === 'string' && payload.b64_json.trim()) {
          return decodeBase64ToUint8Array(payload.b64_json.trim())
        }

        if (typeof payload.url === 'string' && payload.url.trim()) {
          const cacheBuster = Date.now()
          const imageResponse = await fetch(`${payload.url.trim()}?cb=${cacheBuster}`)
          if (!imageResponse.ok) {
            throw new Error(`IMAGE_DOWNLOAD_FAILED_${imageResponse.status}`)
          }
          const buffer = await imageResponse.arrayBuffer()
          return new Uint8Array(buffer)
        }

        throw new Error('OPENAI_IMAGE_EDIT_EMPTY_PAYLOAD')
      } catch (err) {
        lastError = err
        if (attempt === retries - 1) {
          break
        }
        const delay = 1500 * (attempt + 1)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    throw lastError || new Error('OPENAI_IMAGE_EDIT_FAILED')
  }

  try {
    const imageBytes = await callOpenAI()
    const safeName = sanitizeFileName(fileName, 'image.png')
    return new Response(imageBytes, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename="${safeName.replace(/"/g, '')}"`,
      },
    })
  } catch (error) {
    console.error('❌ Background removal failed:', error)
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'BACKGROUND_REMOVAL_FAILED'
    return new Response(
      JSON.stringify({ error: 'BACKGROUND_REMOVAL_FAILED', detail: message }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}
