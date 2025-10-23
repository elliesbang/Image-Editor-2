const resultPlaceholders = Array.from({ length: 3 })

function ResultSection() {
  return (
    <section aria-labelledby="result-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="result-heading" className="text-lg font-semibold text-ellie-text">
            처리 결과
          </h2>
          <p className="text-sm text-ellie-text/70">처리 결과가 없습니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="min-h-[40px] rounded-full border border-ellie-border bg-white px-4 text-sm font-medium text-ellie-text shadow-sm transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
          >
            전체 선택
          </button>
          <button
            type="button"
            className="min-h-[40px] rounded-full border border-ellie-border bg-white px-4 text-sm font-medium text-ellie-text shadow-sm transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
          >
            전체 삭제
          </button>
        </div>
      </div>
      <div className="rounded-2xl border-2 border-dashed border-ellie-border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {resultPlaceholders.map((_, index) => (
            <div
              key={`result-${index}`}
              className="group relative flex aspect-square items-center justify-center rounded-2xl bg-ellie-ivory/60 text-sm font-medium text-ellie-text/60 shadow-inner"
            >
              <span>결과 대기</span>
              <button
                type="button"
                className="absolute right-3 top-3 inline-flex min-h-[32px] items-center justify-center rounded-full border border-ellie-border bg-white px-2 text-xs font-semibold text-ellie-text opacity-100 transition-all duration-200 hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow md:opacity-0 md:group-hover:opacity-100"
              >
                ❌
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default ResultSection
