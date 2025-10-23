import { useMemo, useState } from 'react'

type ResultImage = {
  id: string
  name: string
  url: string
  selected: boolean
}

const initialResults: ResultImage[] = []

function ResultSection() {
  const [results, setResults] = useState<ResultImage[]>(initialResults)

  const allSelected = useMemo(
    () => results.length > 0 && results.every((image) => image.selected),
    [results],
  )

  const toggleSelectAll = () => {
    setResults((prev) => prev.map((image) => ({ ...image, selected: !allSelected })))
  }

  const clearAll = () => {
    setResults([])
  }

  const toggleSelection = (id: string) => {
    setResults((prev) =>
      prev.map((image) => (image.id === id ? { ...image, selected: !image.selected } : image)),
    )
  }

  const removeSingle = (id: string) => {
    setResults((prev) => prev.filter((image) => image.id !== id))
  }

  const handleDownloadAll = () => {
    if (results.length === 0) {
      alert('다운로드할 이미지가 없습니다.')
      return
    }
    alert('다운로드 기능은 곧 제공될 예정이에요!')
  }

  return (
    <section className="rounded-2xl bg-[#f5eee9] p-6 shadow">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">처리 결과</h2>
          <p className="text-sm text-[#6b6b6b]">편집이 완료된 이미지를 관리하고 다운로드할 수 있어요.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="rounded-lg border border-[#ddd] px-3 py-1 transition hover:bg-[#fef56833]"
            disabled={results.length === 0}
          >
            {allSelected ? '전체해제' : '전체선택'}
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-lg border border-[#ddd] px-3 py-1 transition hover:bg-[#fef56833] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={results.length === 0}
          >
            전체삭제
          </button>
          <button
            type="button"
            onClick={handleDownloadAll}
            className="rounded-lg bg-[#fef568] px-4 py-1 font-semibold text-[#404040] transition hover:bg-[#fff59d] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={results.length === 0}
          >
            전체 다운로드
          </button>
        </div>
      </div>

      {results.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {results.map((image) => (
            <div key={image.id} className="group relative">
              <button
                type="button"
                onClick={() => toggleSelection(image.id)}
                className={`relative block h-20 w-full overflow-hidden rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fef568] ${
                  image.selected ? 'ring-2 ring-[#fef568]' : ''
                }`}
              >
                <img src={image.url} alt={image.name} className="h-full w-full object-cover" />
              </button>
              <button
                type="button"
                onClick={() => removeSingle(image.id)}
                className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-[#404040]/80 text-xs font-bold text-white transition group-hover:flex"
                aria-label="결과 이미지 삭제"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#ddd] bg-white/60 py-16 text-center text-sm italic text-[#aaaaaa]">
          아직 처리된 이미지가 없습니다.
        </div>
      )}
    </section>
  )
}

export default ResultSection
