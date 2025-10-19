import { downloadImage, type DownloadImageOptions } from '../utils/downloadImage'

export type CanvasRef = {
  current: HTMLCanvasElement | null
}

export type CanvasExportResult = {
  readonly isExporting: boolean
  exportAsPng: (overrideOptions?: {
    filename?: string
    downloadOptions?: Omit<DownloadImageOptions, 'filename'>
  }) => Promise<Blob | null>
}

/**
 * Lightweight utility inspired by React hooks that performs the PNG export
 * while ensuring the transparency settings remain intact.
 */
export function useCanvasExport(
  canvasRef: CanvasRef,
  defaultFilename = 'image.png',
): CanvasExportResult {
  const state = { isExporting: false }

  const exportAsPng: CanvasExportResult['exportAsPng'] = async (
    overrideOptions = {},
  ) => {
    const target = canvasRef.current
    if (!(target instanceof HTMLCanvasElement) || state.isExporting) {
      return null
    }

    state.isExporting = true
    try {
      const filename = overrideOptions.filename ?? defaultFilename
      const downloadOptions: DownloadImageOptions = {
        ...overrideOptions.downloadOptions,
        filename,
      }
      return await downloadImage(target, filename, downloadOptions)
    } finally {
      state.isExporting = false
    }
  }

  return {
    get isExporting() {
      return state.isExporting
    },
    exportAsPng,
  }
}
