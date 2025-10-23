import KeywordProgress from '../../components/KeywordProgress'

export default function AnalyzePanel() {
  return (
    <section className="analysis" data-role="analysis-panel">
      <div className="analysis__header">
        <span className="analysis__title">키워드 분석</span>
        <div className="analysis__actions">
          <KeywordProgress status="idle" message="" percent={0} phase="precheck" />
          <button
            id="keyword-analyze-btn"
            className="btn btn--brand btn--sm"
            type="button"
            data-action="analyze-current"
          >
            키워드 분석
          </button>
        </div>
      </div>
      <p className="analysis__meta" data-role="analysis-meta" aria-live="polite"></p>
      <p className="analysis__hint" data-role="analysis-hint">
        분석할 이미지를 선택한 뒤 “키워드 분석” 버튼을 눌러보세요.
      </p>
      <p className="analysis__headline" data-role="analysis-title"></p>
      <ul className="analysis__keywords" data-role="analysis-keywords"></ul>
      <p className="analysis__summary" data-role="analysis-summary"></p>
      <div id="keyword-result" className="keyword-result" hidden>
        <h3 className="keyword-result__heading">🔍 키워드 (25개)</h3>
        <textarea id="keyword-list" className="keyword-result__textarea" readOnly></textarea>
        <div className="keyword-result__actions">
          <button
            id="copy-keywords-btn"
            className="btn btn--outline btn--sm"
            type="button"
            data-action="copy-analysis"
          >
            📋 키워드 복사
          </button>
        </div>
        <h3 className="keyword-result__heading">✨ SEO 최적 제목</h3>
        <p id="seo-title" className="keyword-result__title"></p>
      </div>
    </section>
  )
}
