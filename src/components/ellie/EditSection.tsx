const editOptions = [
  '배경제거',
  '크롭',
  '배경제거+크롭',
  '리사이즈',
  '노이즈 제거',
]

function EditSection() {
  return (
    <section className="rounded-2xl bg-[#f5eee9] p-6 shadow">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">이미지 편집</h2>
        <p className="text-sm text-[#6b6b6b]">원하는 편집 기능을 선택해보세요.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {editOptions.map((option) => (
          <button
            key={option}
            type="button"
            className="rounded-xl bg-[#fef568] py-3 text-sm font-semibold text-[#404040] shadow transition hover:-translate-y-0.5 hover:bg-[#fff59d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#404040]/30"
          >
            {option}
          </button>
        ))}
      </div>
    </section>
  )
}

export default EditSection
