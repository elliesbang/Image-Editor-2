import { useCallback, useMemo, useRef, useState } from 'react'
import { useImageEditor } from '../hooks/useImageEditor'

function formatBytes(bytes: number) {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    return `${mb.toFixed(1)}MB`
  }
  const kb = bytes / 1024
  return `${kb.toFixed(0)}KB`
}

function UploadSection() {
  const {
    uploadImages,
    uploadedImages,
    toggleUploadSelection,
    selectAllUploads,
    clearUploadSelection,
    removeUpload,
    removeAllUploads,
    areAllUploadsSelected,
    hasSelectedUploads,
    isProcessing,
    showToast,
  } = useImageEditor()
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const selectedCount = useMemo(
    () => uploadedImages.filter((image) => image.selected).length,
    [uploadedImages],
  )

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      await uploadImages(fileList)
      if (inputRef.current) {
        inputRef.current.value = ''
      }
    },
    [uploadImages],
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

  const handleSelectAllToggle = () => {
    if (areAllUploadsSelected) {
      clearUploadSelection()
    } else {
      selectAllUploads()
    }
  }

  const handleRemoveAll = () => {
    if (uploadedImages.length === 0) {
      showToast('삭제할 이미지가 없어요.', 'error')
      return
    }
    removeAllUploads()
    showToast('업로드한 이미지를 모두 삭제했어요.', 'success')
  }

  const handleRemoveSingle = (id: string) => {
    removeUpload(id)
    showToast('선택한 이미지를 삭제했어요.', 'success')
  }

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
          편집하고 싶은 이미지를 업로드하면 원하는 도구를 눌러 직접 처리할 수 있어요.
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
          multiple
          className="hidden"
          onChange={handleInputChange}
          disabled={isProcessing}
        />
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ellie-yellow text-ellie-text shadow-sm">
            <span className="text-2xl font-semibold">+</span>
          </div>
          <span className="text-sm text-ellie-text">
            이미지를 드래그하거나 클릭해서 업로드하세요 (한 번에 최대 50장)
          </span>
        </div>
        <span className="text-xs text-ellie-text/60">
          지원 형식: PNG, JPG, JPEG, GIF 등 이미지 파일 · 최대 20MB/장
        </span>
      </label>

      {uploadedImages.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-ellie-text/70">
              총 {uploadedImages.length}장의 이미지 중 {selectedCount}장 선택됨
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllToggle}
                disabled={isProcessing}
                className="rounded-full border border-ellie-border bg-white px-4 py-2 text-xs font-medium text-ellie-text transition hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {areAllUploadsSelected ? '선택 해제' : '전체 선택'}
              </button>
              {hasSelectedUploads && (
                <button
                  type="button"
                  onClick={clearUploadSelection}
                  disabled={isProcessing}
                  className="rounded-full border border-ellie-border bg-white px-4 py-2 text-xs font-medium text-ellie-text transition hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  선택 해제
                </button>
              )}
              <button
                type="button"
                onClick={handleRemoveAll}
                disabled={isProcessing}
                className="rounded-full border border-ellie-border bg-white px-4 py-2 text-xs font-medium text-ellie-text transition hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                전체 삭제
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
            {uploadedImages.map((image) => (
              <div
                key={image.id}
                className="group relative"
                title={`${image.name} • ${image.width}×${image.height}px • ${formatBytes(image.size)}`}
              >
                <button
                  type="button"
                  onClick={() => toggleUploadSelection(image.id)}
                  disabled={isProcessing}
                  aria-pressed={image.selected}
                  className={`relative aspect-square w-full overflow-hidden rounded-lg border border-ellie-border bg-white transition hover:-translate-y-0.5 hover:shadow disabled:cursor-not-allowed disabled:opacity-60 ${
                    image.selected ? 'ring-2 ring-ellie-yellow ring-offset-2 ring-offset-white' : ''
                  }`}
                >
                  <img
                    src={image.url}
                    alt={image.name}
                    className="h-full w-full object-cover"
                  />
                  <span className="pointer-events-none absolute inset-0 bg-ellie-yellow/0 transition group-hover:bg-ellie-yellow/10" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveSingle(image.id)}
                  disabled={isProcessing}
                  className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full bg-black/70 text-xs font-semibold text-white shadow-sm transition group-hover:flex disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="이미지 삭제"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default UploadSection
