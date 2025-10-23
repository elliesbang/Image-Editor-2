import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useImageEditor } from '../hooks/useImageEditor'

const NOISE_MIN = 0
const NOISE_MAX = 100

function EditorSection() {
  const {
    currentImage,
    isProcessing,
    removeBackgroundWithOpenAI,
    cropToSubjectBounds,
    denoiseWithOpenAI,
    resizeToWidth,
    showToast,
    dismissToast,
  } = useImageEditor()
  const [noiseLevel, setNoiseLevel] = useState(40)
  const [widthInput, setWidthInput] = useState('')

  const resizePlaceholder = useMemo(() => {
    if (!currentImage) {
      return '가로 픽셀 입력'
    }
    return `${currentImage.width}`
  }, [currentImage])

  useEffect(() => {
    if (!currentImage) {
      setWidthInput('')
      return
    }
    setWidthInput(String(currentImage.width))
  }, [currentImage])

  const requireImage = () => {
    if (currentImage) {
      return true
    }
    showToast('이미지를 먼저 업로드해주세요.', 'error')
    return false
  }

  const runWithToast = async (
    action: () => Promise<void>,
    pendingMessage: string,
    successMessage: string,
    errorMessage: string,
  ) => {
    if (isProcessing) {
      showToast('이전 작업이 끝날 때까지 기다려주세요.', 'info')
      return
    }
    if (!requireImage()) {
      return
    }
    const toastId = showToast(pendingMessage, 'info', { duration: 0 })
    try {
      await action()
      dismissToast(toastId)
      showToast(successMessage, 'success')
    } catch (error) {
      console.error('[EditorSection] operation failed', error)
      dismissToast(toastId)
      showToast(errorMessage, 'error')
    }
  }

  const handleBackgroundRemoval = async () => {
    await runWithToast(
      removeBackgroundWithOpenAI,
      '배경을 제거하는 중이에요...',
      '배경제거가 완료되었어요!',
      '배경제거에 실패했어요. 잠시 후 다시 시도해주세요.',
    )
  }

  const handleCrop = async () => {
    await runWithToast(
      cropToSubjectBounds,
      '피사체에 맞춰 크롭하는 중이에요...',
      '여백 없이 크롭이 완료되었어요!',
      '크롭에 실패했어요. 다시 시도해주세요.',
    )
  }

  const handleDenoise = async () => {
    await runWithToast(
      () => denoiseWithOpenAI(noiseLevel),
      '노이즈를 줄이는 중이에요...',
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
      '이미지를 리사이즈하는 중이에요...',
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
          각 기능 버튼을 눌러 이미지를 편집하고 실시간으로 결과를 확인해보세요.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="flex flex-col gap-4 rounded-2xl border border-ellie-border bg-white p-5 shadow-sm">
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-ellie-text">배경제거</h3>
            <p className="text-sm text-ellie-text/70">
              OpenAI API를 사용해 배경을 투명하게 만들고 피사체만 또렷하게 남겨요.
            </p>
          </div>
          <button
            type="button"
            onClick={handleBackgroundRemoval}
            disabled={isProcessing}
            className="min-h-[44px] rounded-full bg-ellie-yellow px-6 text-sm font-semibold text-ellie-text transition hover:bg-[#ffe35d] disabled:cursor-not-allowed disabled:opacity-60"
          >
            배경제거 실행
          </button>
        </article>

        <article className="flex flex-col gap-4 rounded-2xl border border-ellie-border bg-white p-5 shadow-sm">
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-ellie-text">크롭</h3>
            <p className="text-sm text-ellie-text/70">
              배경제거 후 남은 투명 영역을 계산해 피사체에 꼭 맞게 잘라줘요.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCrop}
            disabled={isProcessing}
            className="min-h-[44px] rounded-full border border-ellie-border bg-white px-6 text-sm font-semibold text-ellie-text transition hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            피사체 기준 크롭
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
            노이즈 제거 실행
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
