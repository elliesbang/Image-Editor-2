import KeywordProgress from '../../components/KeywordProgress'

export default function AnalyzePanel() {
  return (
    <section class="analysis" data-role="analysis-panel">
      <div class="analysis__header">
        <span class="analysis__title">키워드 분석</span>
        <div class="analysis__actions">
          <KeywordProgress status="idle" message="" percent={0} phase="precheck" />
          <button
            id="keyword-analyze-btn"
            class="btn btn--brand btn--sm"
            type="button"
            data-action="analyze-current"
          >
            키워드 분석
          </button>
        </div>
      </div>
      <p class="analysis__meta" data-role="analysis-meta" aria-live="polite"></p>
      <p class="analysis__hint" data-role="analysis-hint">
        분석할 이미지를 선택한 뒤 “키워드 분석” 버튼을 눌러보세요.
      </p>
      <p class="analysis__headline" data-role="analysis-title"></p>
      <ul class="analysis__keywords" data-role="analysis-keywords"></ul>
      <p class="analysis__summary" data-role="analysis-summary"></p>
      <div id="keyword-result" class="keyword-result" hidden>
        <h3 class="keyword-result__heading">🔍 키워드 (25개)</h3>
        <textarea id="keyword-list" class="keyword-result__textarea" readonly></textarea>
        <div class="keyword-result__actions">
          <button
            id="copy-keywords-btn"
            class="btn btn--outline btn--sm"
            type="button"
            data-action="copy-analysis"
          >
            📋 키워드 복사
          </button>
        </div>
        <h3 class="keyword-result__heading">✨ SEO 최적 제목</h3>
        <p id="seo-title" class="keyword-result__title"></p>
      </div>
    </section>
  )
}
