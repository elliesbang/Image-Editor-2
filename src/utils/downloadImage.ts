export type DownloadImageOptions = {
  /**
   * When false, the function resolves with the Blob without triggering a file download.
   * This is useful for callers that want to handle the blob manually (e.g. upload).
   */
  triggerDownload?: boolean
  /**
   * Optional filename override. When omitted the provided filename argument is used.
   */
  filename?: string
}

/**
 * Converts a canvas element to a PNG Blob while preserving transparency and, optionally,
 * triggers a download of the generated file.
 */
export async function downloadImage(
  sourceCanvas: HTMLCanvasElement,
  filename: string,
  options: DownloadImageOptions = {},
): Promise<Blob> {
  if (!(sourceCanvas instanceof HTMLCanvasElement)) {
    throw new TypeError('A valid canvas element is required to export an image.')
  }

  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = sourceCanvas.width
  exportCanvas.height = sourceCanvas.height

  const ctx = exportCanvas.getContext('2d', { alpha: true })
  if (!ctx) {
    throw new Error('Failed to acquire a 2D rendering context for export.')
  }

  const previousCompositeOperation = ctx.globalCompositeOperation
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height)
  ctx.drawImage(sourceCanvas, 0, 0)
  ctx.globalCompositeOperation = previousCompositeOperation

  const blob = await new Promise<Blob>((resolve, reject) => {
    exportCanvas.toBlob((result) => {
      if (!result) {
        reject(new Error('Failed to export canvas as PNG.'))
        return
      }
      resolve(result)
    }, 'image/png')
  })

  if (options.triggerDownload !== false) {
    const resolvedFilename = options.filename ?? filename ?? 'image.png'
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = resolvedFilename.endsWith('.png') ? resolvedFilename : `${resolvedFilename}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return blob
}
