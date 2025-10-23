import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useImageEditor } from '../hooks/useImageEditor'

type IconProps = {
  className?: string
}

function IconEraser({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <path
        d="M4.75 14.5 13.38 5.87a2.25 2.25 0 0 1 3.18 0l2.57 2.56a2.25 2.25 0 0 1 0 3.18l-8.63 8.63H7.32a2.25 2.25 0 0 1-1.59-.66l-1-1a2.25 2.25 0 0 1 0-3.18Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="M9.5 18.5 5.5 14.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

function IconCrop({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <path
        d="M7.5 3.5v13a1 1 0 0 0 1 1h13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M20.5 16.5v-13a1 1 0 0 0-1-1h-13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="M3.5 7.5h13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <path d="M16.5 20.5h-13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

function IconMagicCrop({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <path
        d="M7.5 3.5v13a1 1 0 0 0 1 1h13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M20.5 16.5v-13a1 1 0 0 0-1-1h-13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path d="M3.5 7.5h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <path d="M16.5 20.5h-4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <path
        d="m5.5 19.5 1.5-3 1.5 3 3 .5-2.5 2 1 3-3-1.8-3 1.8 1-3-2.5-2 3-.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

function IconSparkle({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <path
        d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z"
        fill="currentColor"
      />
      <path d="m5 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" fill="currentColor" opacity="0.6" />
      <path d="m19 14 0.8 1.6L21.5 16l-1.2 1 0.4 1.8-1.7-0.9-1.7 0.9 0.4-1.8-1.2-1 1.7-0.4Z" fill="currentColor" opacity="0.6" />
    </svg>
  )
}

const NOISE_MIN = 0
const NOISE_MAX = 100

function EditorSection() {
  const {
    uploadedImages,
    isProcessing,
    removeBackground,
    cropToSubjectBounds,
    removeBackgroundAndCrop,
    denoiseWithOpenAI,
    resizeToWidth,
    showToast,
    dismissToast,
  } = useImageEditor()
  const [noiseLevel, setNoiseLevel] = useState(40)
  const [widthInput, setWidthInput] = useState('')
  const [backgroundMessage, setBackgroundMessage] = useState<
    | {
        message: string
        status: 'pending' | 'success' | 'error'
      }
    | null
  >(null)
  const backgroundMessageTimeoutRef = useRef<number | null>(null)

  const selectedUploads = useMemo(
    () => uploadedImages.filter((image) => image.selected),
    [uploadedImages],
  )

  const firstSelected = selectedUploads[0]

  const resizePlaceholder = useMemo(() => {
    if (!firstSelected) {
      return '가로 픽셀 입력'
    }
    return `${firstSelected.width}`
  }, [firstSelected])

  const clearBackgroundMessageTimeout = useCallback(() => {
    if (backgroundMessageTimeoutRef.current !== null) {
      window.clearTimeout(backgroundMessageTimeoutRef.current)
      backgroundMessageTimeoutRef.current = null
    }
  }, [])

  const clearBackgroundMessage = useCallback(() => {
    clearBackgroundMessageTimeout()
    setBackgroundMessage(null)
  }, [clearBackgroundMessageTimeout])

  const updateBackgroundMessage = useCallback(
    (message: string, status: 'pending' | 'success' | 'error') => {
      clearBackgroundMessageTimeout()
      setBackgroundMessage({ message, status })
      if (status !== 'pending') {
        backgroundMessageTimeoutRef.current = window.setTimeout(() => {
          setBackgroundMessage(null)
          backgroundMessageTimeoutRef.current = null
        }, 3000)
      }
    },
    [clearBackgroundMessageTimeout],
  )

  useEffect(() => {
    if (!firstSelected) {
      setWidthInput('')
      return
    }
    setWidthInput(String(firstSelected.width))
  }, [firstSelected])

  useEffect(() => () => clearBackgroundMessageTimeout(), [clearBackgroundMessageTimeout])

  type RunWithToastResult<T> =
    | { success: true; data: T }
    | { success: false; aborted: boolean }

  const runWithToast = async <T>(
    action: () => Promise<T>,
    pendingMessage: string,
    successMessage: string,
    errorMessage: string,
  ): Promise<RunWithToastResult<T>> => {
    if (isProcessing) {
      showToast('이전 작업이 끝날 때까지 기다려주세요.', 'info')
      return { success: false, aborted: true }
    }

    const toastId = showToast(pendingMessage, 'info', { duration: 0 })
    try {
      const data = await action()
      dismissToast(toastId)
      showToast(successMessage, 'success')
      return { success: true, data }
    } catch (error) {
      dismissToast(toastId)
      if (error instanceof Error) {
        if (error.message === 'NO_UPLOADS_SELECTED') {
          showToast('편집할 이미지를 먼저 선택해주세요.', 'error')
          return { success: false, aborted: true }
        }
        if (error.message === 'PROCESS_ALREADY_RUNNING') {
          showToast('이미 처리가 진행 중이에요. 잠시만 기다려주세요.', 'info')
          return { success: false, aborted: true }
        }
      }
      console.error('[EditorSection] operation failed', error)
      showToast(errorMessage, 'error')
      return { success: false, aborted: false }
    }
  }

  const handleBackgroundRemoval = async () => {
    updateBackgroundMessage('배경제거 진행 중입니다...', 'pending')
    const result = await runWithToast(
      removeBackground,
      '선택한 이미지의 배경을 제거하는 중이에요...',
      '배경이 제거된 이미지가 처리결과에 추가되었습니다.',
      '배경제거 중 오류가 발생했습니다.',
    )
    if (result.success) {
      if (result.data.usedFallback) {
        updateBackgroundMessage('배경제거 중 오류가 발생했습니다.', 'error')
      } else {
        updateBackgroundMessage('배경제거 완료!', 'success')
      }
    } else if (result.aborted) {
      clearBackgroundMessage()
    } else {
      updateBackgroundMessage('배경제거 중 오류가 발생했습니다.', 'error')
    }
  }

  const handleCrop = async () => {
    await runWithToast(
      cropToSubjectBounds,
      '선택한 이미지를 피사체에 맞춰 자르는 중이에요...',
      '크롭이 완료되었어요!',
      '크롭에 실패했어요. 다시 시도해주세요.',
    )
  }

  const handleBackgroundAndCrop = async () => {
    await runWithToast(
      removeBackgroundAndCrop,
      '배경제거 후 크롭까지 진행하는 중이에요...',
      '배경제거와 크롭이 함께 완료되었어요!',
      '배경제거+크롭 작업에 실패했어요. 다시 시도해주세요.',
    )
  }

  const handleDenoise = async () => {
    await runWithToast(
      () => denoiseWithOpenAI(noiseLevel),
      '선택한 이미지의 노이즈를 줄이는 중이에요...',
      '노이즈 제거가 완료되었어요!',
      '노이즈 제거에 실패했어요. 잠시 후 다시 시도해주세요.',
    )
  }

  const handleResize = async (event: FormEvent) => {
    event.preventDefault()
    const parsedWidth = Number.parseInt(widthInput, 10)
    if (!Number.isFinite(parsedWidth) || parsedWidth <= 0) {
      showToast('올바른 가로 픽셀 값을 입력해주세요.', 'error')
      return
    }
    await runWithToast(
      () => resizeToWidth(parsedWidth),
      '선택한 이미지를 리사이즈하는 중이에요...',
      '리사이즈가 완료되었어요!',
      '리사이즈에 실패했어요. 값을 확인한 뒤 다시 시도해주세요.',
    )
  }

  return (
    <section aria-labelledby="editor-heading" className="space-y-6">
      <div className="space-y-1">
        <h2 id="editor-heading" className="text-lg font-semibold text-ellie-text">
          편집 도구
        </h2>
        <p className="text-sm text-ellie-text/70">
          편집할 이미지를 선택한 뒤 원하는 기능 버튼을 눌러주세요. 처리 결과는 별도 영역에 저장돼요.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="flex flex-col gap-4 rounded-2xl border border-ellie-border bg-white p-5 shadow-sm">
          <button
            type="button"
            onClick={handleBackgroundRemoval}
            disabled={isProcessing}
            className="min-h-[44px] rounded-full bg-ellie-yellow px-6 text-sm font-semibold text-ellie-text transition hover:bg-[#ffe35d] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex items-center justify-center gap-2">
              <IconEraser className="text-ellie-text" />
              <span>배경제거</span>
            </span>
          </button>
          {backgroundMessage && (
            <p
              className={`text-center text-sm font-medium ${
                backgroundMessage.status === 'success'
                  ? 'text-green-600'
                  : backgroundMessage.status === 'error'
                  ? 'text-red-600'
                  : 'text-yellow-600'
              }`}
            >
              {backgroundMessage.message}
            </p>
          )}
        </article>

        <article className="flex flex-col gap-4 rounded-2xl border border-ellie-border bg-white p-5 shadow-sm">
          <button
            type="button"
            onClick={handleCrop}
            disabled={isProcessing}
            className="min-h-[44px] rounded-full border border-ellie-border bg-white px-6 text-sm font-semibold text-ellie-text transition hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex items-center justify-center gap-2">
              <IconCrop className="text-ellie-text" />
              <span>크롭</span>
            </span>
          </button>
        </article>

        <article className="flex flex-col gap-4 rounded-2xl border border-ellie-border bg-white p-5 shadow-sm">
          <button
            type="button"
            onClick={handleBackgroundAndCrop}
            disabled={isProcessing}
            className="min-h-[44px] rounded-full border border-ellie-border bg-white px-6 text-sm font-semibold text-ellie-text transition hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex items-center justify-center gap-2">
              <IconMagicCrop className="text-ellie-text" />
              <span>배경제거+크롭</span>
            </span>
          </button>
        </article>

        <article className="flex flex-col gap-4 rounded-2xl border border-ellie-border bg-white p-5 shadow-sm">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-ellie-text">노이즈 제거</h3>
              <span className="text-xs text-ellie-text/60">강도: {noiseLevel}</span>
            </div>
            <p className="text-sm text-ellie-text/70">
              OpenAI API로 이미지 노이즈를 줄이고, 슬라이더로 강도를 조절할 수 있어요.
            </p>
          </div>
          <input
            type="range"
            min={NOISE_MIN}
            max={NOISE_MAX}
            value={noiseLevel}
            onChange={(event) => setNoiseLevel(Number(event.target.value))}
            className="w-full accent-ellie-yellow"
            disabled={isProcessing}
          />
          <button
            type="button"
            onClick={handleDenoise}
            disabled={isProcessing}
            className="min-h-[44px] rounded-full border border-ellie-border bg-white px-6 text-sm font-semibold text-ellie-text transition hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex items-center justify-center gap-2">
              <IconSparkle className="text-ellie-text" />
              <span>노이즈 제거</span>
            </span>
          </button>
        </article>

        <article className="flex flex-col gap-4 rounded-2xl border border-ellie-border bg-white p-5 shadow-sm">
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-ellie-text">리사이즈</h3>
            <p className="text-sm text-ellie-text/70">
              가로 픽셀을 입력하면 세로는 자동으로 비율에 맞춰 조정돼요.
            </p>
          </div>
          <form onSubmit={handleResize} className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={widthInput}
                onChange={(event) => setWidthInput(event.target.value)}
                placeholder={resizePlaceholder}
                className="w-full rounded-full border border-ellie-border px-4 py-2 text-sm text-ellie-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
                disabled={isProcessing}
              />
              <span className="text-sm text-ellie-text/70">px</span>
            </div>
            <button
              type="submit"
              disabled={isProcessing}
              className="min-h-[44px] rounded-full bg-ellie-yellow px-6 text-sm font-semibold text-ellie-text transition hover:bg-[#ffe35d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              리사이즈 실행
            </button>
          </form>
        </article>
      </div>
    </section>
  )
}

export default EditorSection
