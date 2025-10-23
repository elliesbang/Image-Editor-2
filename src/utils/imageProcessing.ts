async function loadImageElement(blob: Blob): Promise<{ image: HTMLImageElement; revoke: () => void }> {
  const url = URL.createObjectURL(blob)
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = (event) => {
      URL.revokeObjectURL(url)
      reject(event instanceof ErrorEvent ? event.error : new Error('IMAGE_LOAD_FAILED'))
    }
    element.src = url
  })

  const revoke = () => {
    URL.revokeObjectURL(url)
  }

  return { image, revoke }
}

export async function loadImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const { image, revoke } = await loadImageElement(blob)
  try {
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }
  } finally {
    revoke()
  }
}

export function base64ToBlob(base64: string, mimeType = 'image/png'): Blob {
  const normalized = base64.includes(',') ? base64.split(',').pop() ?? '' : base64
  const binary = atob(normalized)
  const length = binary.length
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

async function createCanvasFromBlob(blob: Blob): Promise<{
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  cleanup: () => void
}> {
  const { image, revoke } = await loadImageElement(blob)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    revoke()
    throw new Error('CANVAS_CONTEXT_UNAVAILABLE')
  }
  ctx.drawImage(image, 0, 0, width, height)
  const cleanup = () => {
    revoke()
  }
  return { canvas, ctx, width, height, cleanup }
}

export async function cropToSubject(blob: Blob, alphaThreshold = 10): Promise<Blob> {
  const { canvas, ctx, width, height, cleanup } = await createCanvasFromBlob(blob)
  try {
    const { data } = ctx.getImageData(0, 0, width, height)

    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4 + 3
        const alpha = data[index]
        if (alpha > alphaThreshold) {
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return blob
    }

    const cropWidth = maxX - minX + 1
    const cropHeight = maxY - minY + 1

    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = cropWidth
    outputCanvas.height = cropHeight
    const outputCtx = outputCanvas.getContext('2d')
    if (!outputCtx) {
      throw new Error('CROP_CONTEXT_UNAVAILABLE')
    }
    outputCtx.drawImage(canvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)

    const croppedBlob = await new Promise<Blob>((resolve, reject) => {
      outputCanvas.toBlob((result) => {
        if (result) {
          resolve(result)
        } else {
          reject(new Error('CROP_EXPORT_FAILED'))
        }
      }, 'image/png')
    })

    return croppedBlob
  } finally {
    cleanup()
  }
}

export async function resizeImage(blob: Blob, width: number): Promise<Blob> {
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error('INVALID_RESIZE_WIDTH')
  }
  const { canvas, cleanup, width: sourceWidth, height: sourceHeight } = await createCanvasFromBlob(blob)
  try {
    const aspectRatio = sourceHeight / sourceWidth
    const targetWidth = Math.round(width)
    const targetHeight = Math.max(1, Math.round(targetWidth * aspectRatio))

    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = targetWidth
    outputCanvas.height = targetHeight
    const outputCtx = outputCanvas.getContext('2d')
    if (!outputCtx) {
      throw new Error('RESIZE_CONTEXT_UNAVAILABLE')
    }
    outputCtx.imageSmoothingEnabled = true
    outputCtx.imageSmoothingQuality = 'high'
    outputCtx.drawImage(canvas, 0, 0, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight)

    const resizedBlob = await new Promise<Blob>((resolve, reject) => {
      outputCanvas.toBlob((result) => {
        if (result) {
          resolve(result)
        } else {
          reject(new Error('RESIZE_EXPORT_FAILED'))
        }
      }, 'image/png')
    })

    return resizedBlob
  } finally {
    cleanup()
  }
}

type BackgroundRemovalOptions = {
  tolerance?: number
  softness?: number
}

export async function removeBackgroundLocally(
  blob: Blob,
  { tolerance = 45, softness = 20 }: BackgroundRemovalOptions = {},
): Promise<Blob> {
  const { canvas, ctx, width, height, cleanup } = await createCanvasFromBlob(blob)
  try {
    const imageData = ctx.getImageData(0, 0, width, height)
    const { data } = imageData

    if (width === 0 || height === 0) {
      return blob
    }

    const samplePoints: Array<[number, number]> = [
      [0, 0],
      [Math.max(width - 1, 0), 0],
      [0, Math.max(height - 1, 0)],
      [Math.max(width - 1, 0), Math.max(height - 1, 0)],
      [Math.floor(width / 2), 0],
      [Math.floor(width / 2), Math.max(height - 1, 0)],
      [0, Math.floor(height / 2)],
      [Math.max(width - 1, 0), Math.floor(height / 2)],
    ]

    let baseR = 0
    let baseG = 0
    let baseB = 0

    for (const [x, y] of samplePoints) {
      const index = (y * width + x) * 4
      baseR += data[index]
      baseG += data[index + 1]
      baseB += data[index + 2]
    }

    const sampleCount = samplePoints.length || 1
    baseR /= sampleCount
    baseG /= sampleCount
    baseB /= sampleCount

    const softThreshold = tolerance + softness
    const visited = new Uint8Array(width * height)
    const queue: number[] = []

    const enqueue = (x: number, y: number) => {
      if (x < 0 || x >= width || y < 0 || y >= height) {
        return
      }
      const index = y * width + x
      if (visited[index]) {
        return
      }
      visited[index] = 1
      queue.push(index)
    }

    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0)
      enqueue(x, height - 1)
    }
    for (let y = 0; y < height; y += 1) {
      enqueue(0, y)
      enqueue(width - 1, y)
    }

    let head = 0
    while (head < queue.length) {
      const flatIndex = queue[head]
      head += 1

      const x = flatIndex % width
      const y = Math.floor(flatIndex / width)
      const dataIndex = flatIndex * 4
      const r = data[dataIndex]
      const g = data[dataIndex + 1]
      const b = data[dataIndex + 2]
      const a = data[dataIndex + 3]

      const diff = Math.sqrt((r - baseR) ** 2 + (g - baseG) ** 2 + (b - baseB) ** 2)

      if (diff <= tolerance) {
        data[dataIndex + 3] = 0
      } else if (diff < softThreshold) {
        const ratio = (diff - tolerance) / Math.max(1, softThreshold - tolerance)
        data[dataIndex + 3] = Math.min(255, Math.round(a * ratio))
      } else {
        // Stop flood fill propagation when the pixel differs greatly from the sampled background.
        continue
      }

      enqueue(x - 1, y)
      enqueue(x + 1, y)
      enqueue(x, y - 1)
      enqueue(x, y + 1)
    }

    for (let index = 3; index < data.length; index += 4) {
      if (data[index] < 16) {
        data[index] = 0
      }
    }

    ctx.putImageData(imageData, 0, 0)

    const processedBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result)
        } else {
          reject(new Error('BACKGROUND_REMOVAL_EXPORT_FAILED'))
        }
      }, 'image/png')
    })

    return processedBlob
  } finally {
    cleanup()
  }
}
