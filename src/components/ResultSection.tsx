import { useState } from 'react'
import { useImageEditor } from '../hooks/useImageEditor'

function ResultSection() {
  const { currentImage, isProcessing, showToast } = useImageEditor()
  const [fileName, setFileName] = useState('edited-image.png')

  const handleDownload = async () => {
    if (!currentImage) {
      showToast('다운로드할 이미지가 없어요.', 'error')
      return
    }
    const link = document.createElement('a')
    link.href = currentImage.url
    link.download = fileName.trim() || 'edited-image.png'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
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
            {currentImage
              ? '편집 결과를 바로 확인하고 저장할 수 있어요.'
              : '아직 처리된 결과가 없어요. 편집 도구를 이용해 이미지를 가공해보세요.'}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-ellie-border bg-white p-6 shadow-sm">
        {currentImage ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-ellie-text/70">
              <p>
                크기: {currentImage.width} × {currentImage.height} px ·{' '}
                {(currentImage.blob.size / 1024).toFixed(1)} KB
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="result-filename" className="text-xs font-medium text-ellie-text">
                  파일명
                </label>
                <input
                  id="result-filename"
                  type="text"
                  value={fileName}
                  onChange={(event) => setFileName(event.target.value)}
                  className="w-48 rounded-full border border-ellie-border px-3 py-2 text-sm text-ellie-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
                  placeholder="edited-image.png"
                />
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={isProcessing}
                  className="rounded-full bg-ellie-yellow px-4 py-2 text-sm font-semibold text-ellie-text transition hover:bg-[#ffe35d] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  PNG 다운로드
                </button>
              </div>
            </div>
            <div className="flex justify-center">
              <img
                src={currentImage.url}
                alt="편집된 이미지 결과"
                className="max-h-[480px] w-auto rounded-lg border border-ellie-border bg-ellie-ivory object-contain"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-sm text-ellie-text/60">
            <span role="img" aria-hidden="true" className="text-3xl">
              🪄
            </span>
            <p>결과가 여기에 표시돼요. 먼저 이미지를 업로드하고 원하는 기능을 실행해보세요.</p>
          </div>
        )}
      </div>
    </section>
  )
}

export default ResultSection
