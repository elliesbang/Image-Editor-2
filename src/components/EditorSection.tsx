const editorTools = ['배경제거', '크롭', '배경제거 + 크롭', '노이즈 제거', '리사이즈']

function EditorSection() {
  return (
    <section aria-labelledby="editor-heading" className="space-y-4">
      <div className="flex flex-col gap-1">
        <h2 id="editor-heading" className="text-lg font-semibold text-ellie-text">
          편집 도구
        </h2>
        <p className="text-sm text-ellie-text/70">필요한 도구를 선택하고 원하는 작업을 진행해보세요.</p>
      </div>
      <div className="-mx-4 flex overflow-x-auto px-4 pb-2">
        <div className="flex w-full max-w-full gap-2">
          {editorTools.map((tool) => (
            <button
              key={tool}
              type="button"
              className="min-h-[44px] shrink-0 rounded-full border border-ellie-border bg-white px-5 text-sm font-semibold text-ellie-text shadow-sm transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
            >
              {tool}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-ellie-text/60">필요한 도구를 선택한 뒤 상단 메뉴에서 작업을 진행해보세요.</p>
    </section>
  )
}

export default EditorSection
