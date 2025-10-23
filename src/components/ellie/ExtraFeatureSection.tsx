const extraFeatures = ['PNG → SVG', 'PNG → GIF', '키워드 분석']

function ExtraFeatureSection() {
  return (
    <section className="rounded-2xl bg-[#f5eee9] p-6 shadow">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">추가 기능</h2>
        <p className="text-sm text-[#6b6b6b]">이미지 활용을 넓혀주는 보너스 기능이에요.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {extraFeatures.map((feature) => (
          <button
            key={feature}
            type="button"
            className="rounded-xl bg-[#fef56833] py-3 text-sm font-semibold text-[#404040] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#fef568] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#404040]/30"
          >
            {feature}
          </button>
        ))}
      </div>
    </section>
  )
}

export default ExtraFeatureSection
