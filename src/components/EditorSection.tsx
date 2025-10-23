const editorTools = ['배경제거', '배경제거 + 크롭', '크롭', '노이즈 제거', '리사이즈']

function EditorSection() {
  return (
    <section aria-labelledby="editor-heading" className="space-y-4">
      <div className="flex flex-col gap-1">
        <h2 id="editor-heading" className="text-lg font-semibold text-ellie-text">
          편집 도구
        </h2>
        <p className="text-sm text-ellie-text/70">필요한 도구를 선택하고 아래의 실행 버튼을 눌러보세요.</p>
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
      <p className="text-xs text-ellie-text/60">사용 준비가 완료되면 아래의 &lsquo;작업 실행&rsquo; 버튼을 눌러주세요.</p>
      <div className="pointer-events-none fixed bottom-6 left-0 right-0 z-40 flex justify-center px-4">
        <button
          type="button"
          className="pointer-events-auto w-full max-w-md min-h-[56px] rounded-full bg-ellie-yellow text-base font-semibold text-ellie-text shadow-ellie transition-colors hover:bg-ellie-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
        >
          작업 실행
        </button>
      </div>
    </section>
  )
}

export default EditorSection
