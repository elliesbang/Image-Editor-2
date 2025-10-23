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
import {
  base64ToBlob,
  cropToSubject,
  loadImageDimensions,
  resizeImage,
} from '../utils/imageProcessing'

type ProcessedImage = {
  blob: Blob
  url: string
  width: number
  height: number
}

type ToastStatus = 'info' | 'success' | 'error'

type ToastState = {
  id: string
  message: string
  status: ToastStatus
}

type ToastOptions = {
  duration?: number
}

type ImageEditorContextValue = {
  originalFile: File | null
  currentImage: ProcessedImage | null
  isProcessing: boolean
  setOriginalFile: (file: File) => Promise<void>
  setProcessedImageFromBlob: (blob: Blob) => Promise<void>
  reset: () => void
  showToast: (message: string, status?: ToastStatus, options?: ToastOptions) => string
  dismissToast: (id: string) => void
  toast: ToastState | null
  removeBackgroundWithOpenAI: () => Promise<void>
  cropToSubjectBounds: () => Promise<void>
  denoiseWithOpenAI: (noiseLevel: number) => Promise<void>
  resizeToWidth: (width: number) => Promise<void>
}

const ImageEditorContext = createContext<ImageEditorContextValue | null>(null)

function revokeUrl(url: string | null | undefined) {
  if (!url) return
  URL.revokeObjectURL(url)
}

type ProviderProps = {
  children: ReactNode
}

export function ImageEditorProvider({ children }: ProviderProps) {
  const [originalFile, setOriginalFileState] = useState<File | null>(null)
  const [currentImage, setCurrentImage] = useState<ProcessedImage | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const clearToastTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const scheduleToastDismiss = useCallback((id: string, duration: number | undefined) => {
    clearToastTimeout()
    if (Number.isFinite(duration) && duration && duration > 0) {
      timeoutRef.current = window.setTimeout(() => {
        setToast((current) => (current?.id === id ? null : current))
      }, duration)
    }
  }, [clearToastTimeout])

  useEffect(() => () => clearToastTimeout(), [clearToastTimeout])

  const showToast = useCallback(
    (message: string, status: ToastStatus = 'info', options: ToastOptions = {}): string => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      setToast({ id, message, status })
      const duration = options.duration ?? 3200
      scheduleToastDismiss(id, duration)
      return id
    },
    [scheduleToastDismiss],
  )

  const dismissToast = useCallback((id: string) => {
    clearToastTimeout()
    setToast((current) => (current?.id === id ? null : current))
  }, [clearToastTimeout])

  const setProcessedImageFromBlob = useCallback(async (blob: Blob) => {
    const { width, height } = await loadImageDimensions(blob)
    setCurrentImage((previous) => {
      if (previous?.url) {
        revokeUrl(previous.url)
      }
      return {
        blob,
        url: URL.createObjectURL(blob),
        width,
        height,
      }
    })
  }, [])

  const setOriginalFile = useCallback(async (file: File) => {
    setOriginalFileState(file)
    await setProcessedImageFromBlob(file)
  }, [setProcessedImageFromBlob])

  const reset = useCallback(() => {
    revokeUrl(currentImage?.url)
    setCurrentImage(null)
    setOriginalFileState(null)
    setIsProcessing(false)
    clearToastTimeout()
    setToast(null)
  }, [clearToastTimeout, currentImage?.url])

  const ensureImage = useCallback(() => {
    if (!currentImage) {
      throw new Error('IMAGE_NOT_READY')
    }
    return currentImage
  }, [currentImage])

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

  const removeBackgroundWithOpenAI = useCallback(async () => {
    await withProcessing(async () => {
      const image = ensureImage()
      const formData = new FormData()
      formData.append('operation', 'remove_background')
      formData.append('image', image.blob, 'image.png')
      const response = await fetch('/api/image-edit', {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        throw new Error('BACKGROUND_REMOVAL_FAILED')
      }
      const payload = (await response.json()) as { image?: string }
      if (!payload?.image) {
        throw new Error('BACKGROUND_REMOVAL_INVALID_PAYLOAD')
      }
      const blob = base64ToBlob(payload.image, 'image/png')
      await setProcessedImageFromBlob(blob)
    })
  }, [ensureImage, setProcessedImageFromBlob, withProcessing])

  const cropToSubjectBounds = useCallback(async () => {
    await withProcessing(async () => {
      const image = ensureImage()
      const croppedBlob = await cropToSubject(image.blob)
      await setProcessedImageFromBlob(croppedBlob)
    })
  }, [ensureImage, setProcessedImageFromBlob, withProcessing])

  const denoiseWithOpenAI = useCallback(
    async (noiseLevel: number) => {
      await withProcessing(async () => {
        const image = ensureImage()
        const formData = new FormData()
        formData.append('operation', 'denoise')
        formData.append('noiseLevel', String(noiseLevel))
        formData.append('image', image.blob, 'image.png')
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
        const blob = base64ToBlob(payload.image, 'image/png')
        await setProcessedImageFromBlob(blob)
      })
    },
    [ensureImage, setProcessedImageFromBlob, withProcessing],
  )

  const resizeToWidth = useCallback(
    async (width: number) => {
      await withProcessing(async () => {
        const image = ensureImage()
        const resizedBlob = await resizeImage(image.blob, width)
        await setProcessedImageFromBlob(resizedBlob)
      })
    },
    [ensureImage, setProcessedImageFromBlob, withProcessing],
  )

  useEffect(() => () => revokeUrl(currentImage?.url), [currentImage?.url])

  const value = useMemo<ImageEditorContextValue>(
    () => ({
      originalFile,
      currentImage,
      isProcessing,
      setOriginalFile,
      setProcessedImageFromBlob,
      reset,
      showToast,
      dismissToast,
      toast,
      removeBackgroundWithOpenAI,
      cropToSubjectBounds,
      denoiseWithOpenAI,
      resizeToWidth,
    }),
    [
      cropToSubjectBounds,
      currentImage,
      denoiseWithOpenAI,
      dismissToast,
      isProcessing,
      originalFile,
      removeBackgroundWithOpenAI,
      reset,
      resizeToWidth,
      setOriginalFile,
      setProcessedImageFromBlob,
      showToast,
      toast,
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
