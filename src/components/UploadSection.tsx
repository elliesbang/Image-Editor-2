import { useCallback, useRef, useState } from 'react'
import { useImageEditor } from '../hooks/useImageEditor'

const MAX_FILE_SIZE_MB = 20

function formatBytes(bytes: number) {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    return `${mb.toFixed(1)}MB`
  }
  const kb = bytes / 1024
  return `${kb.toFixed(0)}KB`
}

function UploadSection() {
  const { setOriginalFile, currentImage, reset, isProcessing, showToast } = useImageEditor()
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) {
        return
      }
      const [file] = Array.from(fileList).filter((item) => item.type.startsWith('image/'))
      if (!file) {
        showToast('이미지 파일만 업로드할 수 있어요.', 'error')
        return
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        showToast(`최대 ${MAX_FILE_SIZE_MB}MB 이하의 이미지만 업로드할 수 있어요.`, 'error')
        return
      }
      try {
        await setOriginalFile(file)
        showToast('이미지를 불러왔어요. 원하는 편집을 시작해보세요!', 'success')
      } catch (error) {
        console.error('[UploadSection] failed to load image', error)
        showToast('이미지를 불러오지 못했어요. 다시 시도해주세요.', 'error')
      } finally {
        if (inputRef.current) {
          inputRef.current.value = ''
        }
      }
    },
    [setOriginalFile, showToast],
  )

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault()
      setIsDragging(false)
      await handleFiles(event.dataTransfer.files)
    },
    [handleFiles],
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return
    }
    setIsDragging(false)
  }, [])

  const handleInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      await handleFiles(event.target.files)
    },
    [handleFiles],
  )

  return (
    <section
      className="space-y-6 rounded-lg bg-white p-6 shadow-sm ring-1 ring-inset ring-ellie-border/60"
      aria-labelledby="upload-heading"
    >
      <div className="space-y-2">
        <h2 id="upload-heading" className="text-lg font-semibold text-ellie-text">
          이미지 업로드
        </h2>
        <p className="text-sm text-ellie-text/70">
          편집하고 싶은 이미지를 업로드하면 모든 도구를 사용할 수 있어요.
        </p>
      </div>

      <label
        htmlFor="upload-input"
        className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition ${
          isDragging ? 'border-ellie-yellow bg-ellie-hover' : 'border-ellie-border bg-ellie-ivory'
        } ${isProcessing ? 'pointer-events-none opacity-70' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input
          id="upload-input"
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleInputChange}
          disabled={isProcessing}
        />
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ellie-yellow text-ellie-text shadow-sm">
            <span className="text-2xl font-semibold">+</span>
          </div>
          <span className="text-sm text-ellie-text">
            이미지를 드래그하거나 클릭해서 업로드하세요 (최대 {MAX_FILE_SIZE_MB}MB)
          </span>
        </div>
        <span className="text-xs text-ellie-text/60">
          지원 형식: PNG, JPG, JPEG, GIF 등 이미지 파일
        </span>
      </label>

      {currentImage && (
        <div className="flex flex-col gap-4 rounded-lg bg-ellie-ivory p-4 text-sm text-ellie-text">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">선택된 이미지 정보</p>
              <p className="text-xs text-ellie-text/70">
                {currentImage.width} × {currentImage.height} px · {formatBytes(currentImage.blob.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              disabled={isProcessing}
              className="rounded-full border border-ellie-border bg-white px-4 py-2 text-xs font-medium text-ellie-text transition hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              초기화
            </button>
          </div>
          <div className="flex justify-center">
            <img
              src={currentImage.url}
              alt="업로드한 이미지 미리보기"
              className="max-h-64 w-auto rounded-md border border-ellie-border bg-white object-contain"
            />
          </div>
        </div>
      )}
    </section>
  )
}

export default UploadSection
