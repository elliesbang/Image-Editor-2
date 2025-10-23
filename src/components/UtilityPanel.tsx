const utilities = [
  {
    title: 'PNG → SVG 변환',
    description: '벡터 변환 결과가 여기에 표시됩니다.',
  },
  {
    title: '키워드 분석',
    description: '추천 키워드와 요약이 이 영역에 나타납니다.',
  },
]

function UtilityPanel() {
  return (
    <section aria-label="유틸리티" className="space-y-4">
      <h2 className="text-lg font-semibold text-ellie-text">추가 도구</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {utilities.map((utility) => (
          <article key={utility.title} className="flex flex-col gap-4 rounded-2xl border border-ellie-border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-ellie-text">{utility.title}</h3>
              <button
                type="button"
                className="min-h-[44px] rounded-full border border-ellie-border bg-ellie-ivory px-4 text-sm font-medium text-ellie-text transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
              >
                실행
              </button>
            </div>
            <div className="min-h-[120px] rounded-2xl border border-dashed border-ellie-border bg-ellie-ivory/60 p-4 text-sm text-ellie-text/70">
              {utility.description}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default UtilityPanel
