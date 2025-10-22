import type { PagesFunction } from '@cloudflare/workers-types'
import sharp from 'sharp'

let backgroundRemoverModule: any | null = null

const ensureBackgroundRemover = async () => {
  if (backgroundRemoverModule) {
    return backgroundRemoverModule
  }

  try {
    const mod: any = await import('backgroundremover')
    const candidate = mod?.removeBackground || mod?.default || mod
    if (typeof candidate !== 'function') {
      throw new Error('BACKGROUND_REMOVER_MODULE_INVALID')
    }
    backgroundRemoverModule = candidate
    return backgroundRemoverModule
  } catch (error) {
    const failure = new Error('BACKGROUND_REMOVER_MODULE_NOT_AVAILABLE')
    ;(failure as any).cause = error
    throw failure
  }
}

const arrayBufferToUint8Array = (arrayBuffer: ArrayBuffer): Uint8Array => new Uint8Array(arrayBuffer)

const base64ToUint8Array = (base64: string): Uint8Array => {
  const normalized = base64.replace(/\s+/g, '')
  const binaryString = atob(normalized)
  const length = binaryString.length
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

type ParsedBody = { buffer: Uint8Array; fileName: string }

const parseJsonBody = async (request: Request): Promise<ParsedBody> => {
  const body = await request.json()
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_JSON_BODY')
  }

  const imageValue = typeof (body as Record<string, unknown>).image === 'string' ? (body as Record<string, unknown>).image.trim() : ''
  if (!imageValue) {
    throw new Error('IMAGE_DATA_URL_REQUIRED')
  }

  const match = imageValue.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new Error('INVALID_IMAGE_DATA_URL')
  }

  const [, mimeType, base64] = match
  const bytes = base64ToUint8Array(base64)
  const extension = mimeType?.includes('jpeg') ? 'jpg' : mimeType?.split('/')[1] || 'png'
  const rawName = typeof (body as Record<string, unknown>).name === 'string' ? (body as Record<string, unknown>).name.trim() : ''
  const normalizedName = rawName || `image.${extension}`
  return { buffer: bytes, fileName: normalizedName }
}

const parseBinaryBody = async (request: Request): Promise<ParsedBody> => {
  const arrayBuffer = await request.arrayBuffer()
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error('IMAGE_PAYLOAD_REQUIRED')
  }
  const buffer = arrayBufferToUint8Array(arrayBuffer)
  const headerName = request.headers.get('x-file-name') || request.headers.get('x-filename') || ''
  const fileName = headerName ? headerName.trim() : 'image.png'
  return { buffer, fileName }
}

const removeEmptyMargins = async (input: Uint8Array): Promise<Uint8Array> => {
  const image = sharp(input, { failOnError: false }).ensureAlpha()
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true })
  const { channels, width, height } = info

  if (channels < 4 || width <= 0 || height <= 0) {
    return input
  }

  const alphaIndex = channels - 1
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * channels
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + x * channels + alphaIndex
      if (data[offset] > 0) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return input
  }

  const cropWidth = maxX - minX + 1
  const cropHeight = maxY - minY + 1
  if (cropWidth === width && cropHeight === height) {
    return input
  }

  const cropped = await sharp(input, { failOnError: false })
    .ensureAlpha()
    .extract({ left: minX, top: minY, width: cropWidth, height: cropHeight })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()

  return new Uint8Array(cropped)
}

const runBackgroundRemoval = async (buffer: Uint8Array): Promise<Uint8Array> => {
  const remover = await ensureBackgroundRemover()
  const result: any = await remover(buffer, {
    model: 'u2net',
    output: 'binary',
    format: 'png',
    alphaMatting: false,
    suppressNoise: true,
  })

  if (result instanceof Uint8Array) {
    return result
  }
  if (result instanceof ArrayBuffer) {
    return new Uint8Array(result)
  }
  if (result && typeof result === 'object') {
    if (result.buffer instanceof Uint8Array) {
      return result.buffer
    }
    if (result.data instanceof Uint8Array) {
      return result.data
    }
    if (typeof result.base64 === 'string' && result.base64) {
      return base64ToUint8Array(result.base64)
    }
    if (result.arrayBuffer instanceof ArrayBuffer) {
      return new Uint8Array(result.arrayBuffer)
    }
  }
  if (ArrayBuffer.isView(result)) {
    return new Uint8Array(result.buffer)
  }

  throw new Error('BACKGROUND_REMOVAL_FAILED')
}

export const onRequestPost: PagesFunction = async (context) => {
  const headers = new Headers({ 'Cache-Control': 'no-store' })

  try {
    const { request } = context
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''

    const parsed = contentType.includes('application/json')
      ? await parseJsonBody(request)
      : await parseBinaryBody(request)

    const backgroundRemoved = await runBackgroundRemoval(parsed.buffer)
    const cropped = await removeEmptyMargins(backgroundRemoved)
    const output = await sharp(cropped, { failOnError: false })
      .ensureAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer()

    headers.set('Content-Type', 'image/png')
    const trimmedName = parsed.fileName.replace(/[\r\n]+/g, ' ').trim() || 'image.png'
    const safeName = trimmedName.replace(/[^A-Za-z0-9._-]+/g, '-')
    const normalizedName = safeName.toLowerCase().endsWith('.png')
      ? safeName
      : `${safeName.replace(/\.[^./]+$/, '') || 'image'}.png`
    headers.set('Content-Disposition', `inline; filename="${normalizedName.replace(/"/g, '')}"`)

    return new Response(output, { headers })
  } catch (error) {
    console.error('🔥 Local background removal failed:', error)
    headers.set('Content-Type', 'application/json')
    const status =
      error instanceof Error && typeof (error as any).status === 'number' ? (error as any).status : 500
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'BACKGROUND_REMOVAL_FAILED'

    return new Response(JSON.stringify({ error: 'BACKGROUND_REMOVAL_FAILED', message }), {
      status,
      headers,
    })
  }
}

export const config = {
  runtime: 'edge',
}
