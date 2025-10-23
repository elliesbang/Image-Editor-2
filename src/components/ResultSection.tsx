import { useMemo } from 'react'
import { useImageEditor } from '../hooks/useImageEditor'

function formatBytes(bytes: number) {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    return `${mb.toFixed(1)}MB`
  }
  const kb = bytes / 1024
  return `${kb.toFixed(1)}KB`
}

function downloadBlob(url: string, filename: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function ResultSection() {
  const {
    resultImages,
    toggleResultSelection,
    selectAllResults,
    clearResultSelection,
    removeResult,
    removeAllResults,
    areAllResultsSelected,
    hasSelectedResults,
    isProcessing,
    showToast,
  } = useImageEditor()

  const selectedResults = useMemo(
    () => resultImages.filter((image) => image.selected),
    [resultImages],
  )

  const handleSelectAllToggle = () => {
    if (areAllResultsSelected) {
      clearResultSelection()
    } else {
      selectAllResults()
    }
  }

  const handleRemoveAll = () => {
    if (resultImages.length === 0) {
      showToast('삭제할 결과가 없어요.', 'error')
      return
    }
    removeAllResults()
    showToast('처리된 이미지를 모두 삭제했어요.', 'success')
  }

  const handleRemoveSingle = (id: string) => {
    removeResult(id)
    showToast('선택한 결과 이미지를 삭제했어요.', 'success')
  }

  const handleDownloadSelected = () => {
    if (selectedResults.length === 0) {
      showToast('다운로드할 이미지를 먼저 선택해주세요.', 'error')
      return
    }
    selectedResults.forEach((image) => {
      downloadBlob(image.url, image.name)
    })
    showToast(`${selectedResults.length}개의 이미지를 다운로드했어요!`, 'success')
  }

  const handleDownloadSingle = (id: string) => {
    const target = resultImages.find((image) => image.id === id)
    if (!target) {
      showToast('다운로드할 이미지를 찾지 못했어요.', 'error')
      return
    }
    downloadBlob(target.url, target.name)
    showToast('이미지를 다운로드했어요!', 'success')
  }

  return (
    <section aria-labelledby="result-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 id="result-heading" className="text-lg font-semibold text-ellie-text">
            처리 결과
          </h2>
          <p className="text-sm text-ellie-text/70">
            선택한 편집 기능을 실행하면 결과가 여기에 누적되고, 동일하게 선택/삭제/다운로드할 수 있어요.
          </p>
        </div>
      </div>

      {resultImages.length > 0 ? (
        <div className="space-y-4 rounded-2xl border border-dashed border-ellie-border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-ellie-text/70">
              총 {resultImages.length}개의 결과 중 {selectedResults.length}개 선택됨
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllToggle}
                disabled={isProcessing}
                className="rounded-full border border-ellie-border bg-white px-4 py-2 text-xs font-medium text-ellie-text transition hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {areAllResultsSelected ? '선택 해제' : '전체 선택'}
              </button>
              {hasSelectedResults && (
                <button
                  type="button"
                  onClick={clearResultSelection}
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
              <button
                type="button"
                onClick={handleDownloadSelected}
                disabled={!hasSelectedResults || isProcessing}
                className="rounded-full bg-ellie-yellow px-4 py-2 text-xs font-semibold text-ellie-text transition hover:bg-[#ffe35d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                선택 다운로드
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
            {resultImages.map((image) => (
              <div key={image.id} className="group flex flex-col gap-2" title={`${image.name} • ${image.width}×${image.height}px • ${formatBytes(image.size)}`}>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => toggleResultSelection(image.id)}
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
                    aria-label="결과 이미지 삭제"
                  >
                    ×
                  </button>
                </div>
                <div className="flex items-center justify-between text-[11px] text-ellie-text/70">
                  <span>
                    {image.width}×{image.height}px · {formatBytes(image.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDownloadSingle(image.id)}
                    disabled={isProcessing}
                    className="rounded-full border border-ellie-border bg-white px-2 py-1 text-[11px] font-medium text-ellie-text transition hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    다운로드
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-ellie-border bg-white py-16 text-center text-sm text-ellie-text/60">
          <span role="img" aria-hidden="true" className="text-3xl">
            🪄
          </span>
          <p>결과가 여기에 표시돼요. 먼저 이미지를 업로드하고 원하는 기능을 실행해보세요.</p>
        </div>
      )}
    </section>
  )
}

export default ResultSection
