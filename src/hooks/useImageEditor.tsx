import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { base64ToBlob, cropToSubject, loadImageDimensions, removeBackgroundLocally, resizeImage } from '../utils/imageProcessing'

type ToastStatus = 'info' | 'success' | 'error'

type ToastState = {
  id: string
  message: string
  status: ToastStatus
}

type ToastOptions = {
  duration?: number
}

type UploadedImage = {
  id: string
  name: string
  blob: Blob
  url: string
  width: number
  height: number
  size: number
  selected: boolean
}

type ResultImage = {
  id: string
  sourceId: string
  name: string
  blob: Blob
  url: string
  width: number
  height: number
  size: number
  selected: boolean
}

type CropTarget = Pick<UploadedImage, 'blob' | 'name'>

type ImageEditorContextValue = {
  readonly uploadedImages: readonly UploadedImage[]
  readonly resultImages: readonly ResultImage[]
  readonly isProcessing: boolean
  readonly hasSelectedUploads: boolean
  readonly hasSelectedResults: boolean
  readonly areAllUploadsSelected: boolean
  readonly areAllResultsSelected: boolean
  readonly uploadImages: (files: FileList | File[] | null) => Promise<void>
  readonly toggleUploadSelection: (id: string) => void
  readonly selectAllUploads: () => void
  readonly clearUploadSelection: () => void
  readonly removeUpload: (id: string) => void
  readonly removeAllUploads: () => void
  readonly toggleResultSelection: (id: string) => void
  readonly selectAllResults: () => void
  readonly clearResultSelection: () => void
  readonly removeResult: (id: string) => void
  readonly removeAllResults: () => void
  readonly removeBackground: () => Promise<void>
  readonly cropToSubjectBounds: () => Promise<void>
  readonly removeBackgroundAndCrop: () => Promise<void>
  readonly denoiseWithOpenAI: (noiseLevel: number) => Promise<void>
  readonly resizeToWidth: (width: number) => Promise<void>
  readonly addResultFromBlob: (
    blob: Blob,
    options: { baseName: string; sourceId?: string; suffix?: string; extension?: string },
  ) => Promise<ResultImage>
  readonly showToast: (message: string, status?: ToastStatus, options?: ToastOptions) => string
  readonly dismissToast: (id: string) => void
  readonly toast: ToastState | null
}

const ImageEditorContext = createContext<ImageEditorContextValue | null>(null)

const MAX_FILE_SIZE_MB = 20
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024
const MAX_BATCH_SIZE = 50

function revokeUrl(url: string | null | undefined) {
  if (!url) return
  URL.revokeObjectURL(url)
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

type ProviderProps = {
  children: ReactNode
}

export function ImageEditorProvider({ children }: ProviderProps) {
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([])
  const [resultImages, setResultImages] = useState<ResultImage[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const clearToastTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const scheduleToastDismiss = useCallback(
    (id: string, duration: number | undefined) => {
      clearToastTimeout()
      if (Number.isFinite(duration) && duration && duration > 0) {
        timeoutRef.current = window.setTimeout(() => {
          setToast((current) => (current?.id === id ? null : current))
        }, duration)
      }
    },
    [clearToastTimeout],
  )

  useEffect(() => () => clearToastTimeout(), [clearToastTimeout])

  const showToast = useCallback(
    (message: string, status: ToastStatus = 'info', options: ToastOptions = {}): string => {
      const id = createId()
      setToast({ id, message, status })
      const duration = options.duration ?? 3200
      scheduleToastDismiss(id, duration)
      return id
    },
    [scheduleToastDismiss],
  )

  const dismissToast = useCallback(
    (id: string) => {
      clearToastTimeout()
      setToast((current) => (current?.id === id ? null : current))
    },
    [clearToastTimeout],
  )

  const createUploadedImage = useCallback(async (file: File): Promise<UploadedImage> => {
    const { width, height } = await loadImageDimensions(file)
    return {
      id: createId(),
      name: file.name,
      blob: file,
      url: URL.createObjectURL(file),
      width,
      height,
      size: file.size,
      selected: false,
    }
  }, [])

  const uploadImages = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) {
        showToast('업로드할 이미지를 선택해주세요.', 'error')
        return
      }

      const normalized = Array.from(files).filter((file) => file.type.startsWith('image/'))
      if (normalized.length === 0) {
        showToast('이미지 파일만 업로드할 수 있어요.', 'error')
        return
      }

      const limited = normalized.slice(0, MAX_BATCH_SIZE)
      if (normalized.length > MAX_BATCH_SIZE) {
        showToast('이미지는 한 번에 최대 50장까지 업로드할 수 있어요.', 'error')
      }

      const accepted: UploadedImage[] = []
      let skippedForSize = 0

      for (const file of limited) {
        if (file.size > MAX_FILE_SIZE) {
          skippedForSize += 1
          continue
        }
        const created = await createUploadedImage(file)
        accepted.push(created)
      }

      if (accepted.length === 0) {
        if (skippedForSize > 0) {
          showToast(`각 이미지의 용량은 최대 ${MAX_FILE_SIZE_MB}MB까지 업로드할 수 있어요.`, 'error')
        } else {
          showToast('업로드할 수 있는 이미지가 없어요.', 'error')
        }
        return
      }

      if (skippedForSize > 0) {
        showToast(`용량이 큰 ${skippedForSize}개의 이미지는 제외되었어요.`, 'info')
      }

      setUploadedImages((previous) => [...previous, ...accepted])
      showToast(`${accepted.length}개의 이미지를 불러왔어요. 원하는 편집을 시작해보세요!`, 'success')
    },
    [createUploadedImage, showToast],
  )

  const toggleUploadSelection = useCallback((id: string) => {
    setUploadedImages((previous) =>
      previous.map((image) => (image.id === id ? { ...image, selected: !image.selected } : image)),
    )
  }, [])

  const selectAllUploads = useCallback(() => {
    setUploadedImages((previous) => previous.map((image) => ({ ...image, selected: true })))
  }, [])

  const clearUploadSelection = useCallback(() => {
    setUploadedImages((previous) => previous.map((image) => ({ ...image, selected: false })))
  }, [])

  const removeUpload = useCallback((id: string) => {
    setUploadedImages((previous) => {
      const target = previous.find((image) => image.id === id)
      revokeUrl(target?.url)
      return previous.filter((image) => image.id !== id)
    })
  }, [])

  const removeAllUploads = useCallback(() => {
    setUploadedImages((previous) => {
      previous.forEach((image) => revokeUrl(image.url))
      return []
    })
  }, [])

  const toggleResultSelection = useCallback((id: string) => {
    setResultImages((previous) =>
      previous.map((image) => (image.id === id ? { ...image, selected: !image.selected } : image)),
    )
  }, [])

  const selectAllResults = useCallback(() => {
    setResultImages((previous) => previous.map((image) => ({ ...image, selected: true })))
  }, [])

  const clearResultSelection = useCallback(() => {
    setResultImages((previous) => previous.map((image) => ({ ...image, selected: false })))
  }, [])

  const removeResult = useCallback((id: string) => {
    setResultImages((previous) => {
      const target = previous.find((image) => image.id === id)
      revokeUrl(target?.url)
      return previous.filter((image) => image.id !== id)
    })
  }, [])

  const removeAllResults = useCallback(() => {
    setResultImages((previous) => {
      previous.forEach((image) => revokeUrl(image.url))
      return []
    })
  }, [])

  const uploadedImagesRef = useRef<UploadedImage[]>([])
  const resultImagesRef = useRef<ResultImage[]>([])

  useEffect(() => {
    uploadedImagesRef.current = uploadedImages
  }, [uploadedImages])

  useEffect(() => {
    resultImagesRef.current = resultImages
  }, [resultImages])

  useEffect(
    () => () => {
      uploadedImagesRef.current.forEach((image) => revokeUrl(image.url))
      resultImagesRef.current.forEach((image) => revokeUrl(image.url))
    },
    [],
  )

  const getSelectedUploads = useCallback(() => uploadedImages.filter((image) => image.selected), [uploadedImages])

  const withProcessing = useCallback(
    async (task: () => Promise<void>) => {
      if (isProcessing) {
        throw new Error('PROCESS_ALREADY_RUNNING')
      }
      setIsProcessing(true)
      try {
        await task()
      } finally {
        setIsProcessing(false)
      }
    },
    [isProcessing],
  )

  const buildResultImage = useCallback(
    async (
      blob: Blob,
      { baseName, sourceId, suffix = '', extension }: { baseName: string; sourceId?: string; suffix?: string; extension?: string },
    ): Promise<ResultImage> => {
      const { width, height } = await loadImageDimensions(blob)
      const normalizedBase = baseName.replace(/\.[^.]+$/, '') || 'result'
      const inferredExtension =
        typeof extension === 'string' && extension.trim()
          ? extension.trim()
          : blob.type.split('/')[1]?.toLowerCase() || 'png'
      const filename = `${normalizedBase}${suffix}.${inferredExtension}`
      return {
        id: createId(),
        sourceId: sourceId ?? 'custom',
        name: filename,
        blob,
        url: URL.createObjectURL(blob),
        width,
        height,
        size: blob.size,
        selected: false,
      }
    },
    [],
  )

  const addResultFromBlob = useCallback(
    async (
      blob: Blob,
      options: { baseName: string; sourceId?: string; suffix?: string; extension?: string },
    ): Promise<ResultImage> => {
      const result = await buildResultImage(blob, options)
      setResultImages((previous) => [result, ...previous])
      return result
    },
    [buildResultImage],
  )

  const createResultImageFromBlob = useCallback(
    async (blob: Blob, source: UploadedImage, suffix: string): Promise<ResultImage> => {
      return buildResultImage(blob, { baseName: source.name, sourceId: source.id, suffix, extension: 'png' })
    },
    [buildResultImage],
  )

  const nameWithoutExtension = useCallback((filename: string) => {
    const lastDot = filename.lastIndexOf('.')
    return lastDot === -1 ? filename : filename.slice(0, lastDot)
  }, [])

  const findResultForSource = useCallback(
    (sourceId: string, predicate: (normalizedName: string) => boolean): ResultImage | null => {
      for (const image of resultImagesRef.current) {
        if (image.sourceId !== sourceId) {
          continue
        }
        if (predicate(nameWithoutExtension(image.name))) {
          return image
        }
      }
      return null
    },
    [nameWithoutExtension],
  )

  const findBackgroundRemovedResult = useCallback(
    (sourceId: string): ResultImage | null =>
      findResultForSource(sourceId, (normalized) => normalized.endsWith('-bg-removed')),
    [findResultForSource],
  )

  const findBackgroundRemovedOrCroppedResult = useCallback(
    (sourceId: string): ResultImage | null =>
      findBackgroundRemovedResult(sourceId) ??
      findResultForSource(sourceId, (normalized) => normalized.endsWith('-bg-removed-cropped')),
    [findBackgroundRemovedResult, findResultForSource],
  )

  const processSelectedUploads = useCallback(
    async (operation: (image: UploadedImage) => Promise<{ blob: Blob; suffix: string }>) => {
      let targets = getSelectedUploads()
      if (targets.length === 0) {
        const allUploads = uploadedImagesRef.current
        if (allUploads.length === 0) {
          throw new Error('NO_UPLOADS_SELECTED')
        }
        setUploadedImages((previous) => previous.map((image) => ({ ...image, selected: true })))
        targets = allUploads
      }

      await withProcessing(async () => {
        const results: ResultImage[] = []
        for (const image of targets) {
          const { blob, suffix } = await operation(image)
          const result = await createResultImageFromBlob(blob, image, suffix)
          results.push(result)
        }
        setResultImages((previous) => [...results, ...previous])
      })
    },
    [createResultImageFromBlob, getSelectedUploads, setUploadedImages, withProcessing],
  )

  const tryCallImageEditApi = useCallback(async (operation: string, image: UploadedImage) => {
    try {
      const formData = new FormData()
      formData.append('operation', operation)
      formData.append('image', image.blob, image.name || 'image.png')
      const response = await fetch('/api/image-edit', {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        throw new Error('IMAGE_EDIT_REQUEST_FAILED')
      }
      const payload = (await response.json()) as { image?: string }
      if (!payload?.image) {
        throw new Error('IMAGE_EDIT_INVALID_PAYLOAD')
      }
      return base64ToBlob(payload.image, 'image/png')
    } catch (error) {
      console.warn('[ImageEditor] remote image edit failed', operation, error)
      return null
    }
  }, [])

  const tryRemoveBackground = useCallback(
    async (image: UploadedImage) => {
      try {
        const blob = await removeBackgroundLocally(image.blob)
        return blob
      } catch (error) {
        console.error('[ImageEditor] local background removal failed', error)
        throw new Error('BACKGROUND_REMOVAL_FAILED')
      }
    },
    [],
  )

  const tryCropToSubject = useCallback(
    async (image: CropTarget) => {
      try {
        const formData = new FormData()
        formData.append('operation', 'crop_to_subject')
        formData.append('image', image.blob, image.name || 'image.png')
        const response = await fetch('/api/image-edit', {
          method: 'POST',
          body: formData,
        })
        if (!response.ok) {
          throw new Error('CROP_FAILED')
        }
        const payload = (await response.json()) as { image?: string }
        if (!payload?.image) {
          throw new Error('CROP_INVALID_PAYLOAD')
        }
        return base64ToBlob(payload.image, 'image/png')
      } catch (error) {
        console.warn('[ImageEditor] crop to subject failed, using local fallback', error)
        return cropToSubject(image.blob)
      }
    },
    [],
  )

  const removeBackground = useCallback(async () => {
    await processSelectedUploads(async (image) => ({
      blob: await tryRemoveBackground(image),
      suffix: '-bg-removed',
    }))
  }, [processSelectedUploads, tryRemoveBackground])

  const cropToSubjectBounds = useCallback(async () => {
    await processSelectedUploads(async (image) => {
      const cachedBackgroundRemoved = findBackgroundRemovedOrCroppedResult(image.id)
      const backgroundRemovedBlob = cachedBackgroundRemoved?.blob ?? (await tryRemoveBackground(image).catch(() => null))

      if (backgroundRemovedBlob) {
        try {
          const cropped = await cropToSubject(backgroundRemovedBlob)
          return { blob: cropped, suffix: '-bg-removed-cropped' }
        } catch (cropError) {
          console.error('[ImageEditor] crop after cached background removal failed', cropError)
          try {
            const fallback = await tryCropToSubject(image)
            return { blob: fallback, suffix: '-cropped' }
          } catch (fallbackError) {
            console.error('[ImageEditor] fallback crop failed', fallbackError)
            return { blob: backgroundRemovedBlob, suffix: '-bg-removed' }
          }
        }
      }

      return { blob: await tryCropToSubject(image), suffix: '-cropped' }
    })
  }, [
    findBackgroundRemovedOrCroppedResult,
    processSelectedUploads,
    tryCropToSubject,
    tryRemoveBackground,
  ])

  const removeBackgroundAndCrop = useCallback(async () => {
    await processSelectedUploads(async (image) => {
      const backgroundRemoved = await tryRemoveBackground(image)
      try {
        const cropped = await cropToSubject(backgroundRemoved)
        return { blob: cropped, suffix: '-bg-removed-cropped' }
      } catch (cropError) {
        console.error(
          '[ImageEditor] crop after background removal failed, returning background-only result',
          cropError,
        )
        return { blob: backgroundRemoved, suffix: '-bg-removed' }
      }
    })
  }, [processSelectedUploads, tryRemoveBackground])

  const denoiseWithOpenAI = useCallback(
    async (noiseLevel: number) => {
      await processSelectedUploads(async (image) => {
        const formData = new FormData()
        formData.append('operation', 'denoise')
        formData.append('noiseLevel', String(noiseLevel))
        formData.append('image', image.blob, image.name || 'image.png')
        const response = await fetch('/api/image-edit', {
          method: 'POST',
          body: formData,
        })
        if (!response.ok) {
          throw new Error('DENOISE_FAILED')
        }
        const payload = (await response.json()) as { image?: string }
        if (!payload?.image) {
          throw new Error('DENOISE_INVALID_PAYLOAD')
        }
        return { blob: base64ToBlob(payload.image, 'image/png'), suffix: '-denoised' }
      })
    },
    [processSelectedUploads],
  )

  const resizeToWidth = useCallback(
    async (width: number) => {
      await processSelectedUploads(async (image) => ({
        blob: await resizeImage(image.blob, width),
        suffix: `-resized-${width}`,
      }))
    },
    [processSelectedUploads],
  )

  const areAllUploadsSelected = useMemo(
    () => uploadedImages.length > 0 && uploadedImages.every((image) => image.selected),
    [uploadedImages],
  )

  const areAllResultsSelected = useMemo(
    () => resultImages.length > 0 && resultImages.every((image) => image.selected),
    [resultImages],
  )

  const hasSelectedUploads = useMemo(
    () => uploadedImages.some((image) => image.selected),
    [uploadedImages],
  )

  const hasSelectedResults = useMemo(
    () => resultImages.some((image) => image.selected),
    [resultImages],
  )

  const value = useMemo<ImageEditorContextValue>(
    () => ({
      uploadedImages,
      resultImages,
      isProcessing,
      hasSelectedUploads,
      hasSelectedResults,
      areAllUploadsSelected,
      areAllResultsSelected,
      uploadImages,
      toggleUploadSelection,
      selectAllUploads,
      clearUploadSelection,
      removeUpload,
      removeAllUploads,
      toggleResultSelection,
      selectAllResults,
      clearResultSelection,
      removeResult,
      removeAllResults,
      removeBackground,
      cropToSubjectBounds,
      removeBackgroundAndCrop,
      denoiseWithOpenAI,
      resizeToWidth,
      addResultFromBlob,
      showToast,
      dismissToast,
      toast,
    }),
    [
      addResultFromBlob,
      areAllResultsSelected,
      areAllUploadsSelected,
      clearResultSelection,
      clearUploadSelection,
      denoiseWithOpenAI,
      dismissToast,
      hasSelectedResults,
      hasSelectedUploads,
      isProcessing,
      removeAllResults,
      removeAllUploads,
      removeBackground,
      removeBackgroundAndCrop,
      removeResult,
      removeUpload,
      resultImages,
      cropToSubjectBounds,
      resizeToWidth,
      selectAllResults,
      selectAllUploads,
      showToast,
      toggleResultSelection,
      toggleUploadSelection,
      toast,
      uploadImages,
      uploadedImages,
    ],
  )

  return <ImageEditorContext.Provider value={value}>{children}</ImageEditorContext.Provider>
}

export function useImageEditor() {
  const context = useContext(ImageEditorContext)
  if (!context) {
    throw new Error('useImageEditor must be used within an ImageEditorProvider')
  }
  return context
}

export default useImageEditor
