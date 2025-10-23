import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'

type UploadImage = {
  id: string
  name: string
  preview: string
  selected: boolean
}

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function ImageUploadSection() {
  const [images, setImages] = useState<UploadImage[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  const allSelected = useMemo(
    () => images.length > 0 && images.every((image) => image.selected),
    [images],
  )

  useEffect(() => {
    return () => {
      images.forEach((image) => URL.revokeObjectURL(image.preview))
    }
  }, [images])

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) {
      return
    }

    const incoming = Array.from(files)
    const remainingSlots = 50 - images.length

    if (remainingSlots <= 0) {
      alert('이미지는 최대 50장까지 업로드할 수 있어요.')
      event.target.value = ''
      return
    }

    const allowedFiles = incoming.slice(0, remainingSlots)
    const nextImages = allowedFiles.map((file) => ({
      id: generateId(),
      name: file.name,
      preview: URL.createObjectURL(file),
      selected: false,
    }))

    if (incoming.length > allowedFiles.length) {
      alert('한 번에 최대 50장까지만 업로드할 수 있어요. 초과된 이미지는 제외되었어요.')
    }

    setImages((prev) => [...prev, ...nextImages])
    event.target.value = ''
  }

  const handleSelectAllToggle = () => {
    setImages((prev) => prev.map((image) => ({ ...image, selected: !allSelected })))
  }

  const handleRemoveAll = () => {
    images.forEach((image) => URL.revokeObjectURL(image.preview))
    setImages([])
  }

  const toggleImageSelection = (id: string) => {
    setImages((prev) =>
      prev.map((image) => (image.id === id ? { ...image, selected: !image.selected } : image)),
    )
  }

  const handleRemoveSingle = (id: string) => {
    setImages((prev) => {
      const target = prev.find((image) => image.id === id)
      if (target) {
        URL.revokeObjectURL(target.preview)
      }
      return prev.filter((image) => image.id !== id)
    })
  }

  return (
    <section className="rounded-2xl bg-[#f5eee9] p-6 shadow">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">이미지 업로드</h2>
          <p className="text-sm text-[#6b6b6b]">최대 50장까지 한 번에 업로드할 수 있어요.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={handleSelectAllToggle}
            className="rounded-lg border border-[#ddd] px-3 py-1 transition hover:bg-[#fef56833]"
          >
            {allSelected ? '전체해제' : '전체선택'}
          </button>
          <button
            type="button"
            onClick={handleRemoveAll}
            className="rounded-lg border border-[#ddd] px-3 py-1 transition hover:bg-[#fef56833]"
          >
            전체삭제
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-lg bg-[#fef568] px-4 py-1 font-semibold text-[#404040] transition hover:bg-[#fff59d]"
          >
            이미지 업로드
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleUpload}
            className="hidden"
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
        {images.map((image) => (
          <div key={image.id} className="group relative">
            <button
              type="button"
              onClick={() => toggleImageSelection(image.id)}
              className={`relative block h-20 w-full overflow-hidden rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fef568] ${
                image.selected ? 'ring-2 ring-[#fef568]' : ''
              }`}
            >
              <img
                src={image.preview}
                alt={image.name}
                className="h-full w-full object-cover"
              />
            </button>
            <button
              type="button"
              onClick={() => handleRemoveSingle(image.id)}
              className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-[#404040]/80 text-xs font-bold text-white transition group-hover:flex"
              aria-label="이미지 삭제"
            >
              ×
            </button>
          </div>
        ))}
        {images.length === 0 && (
          <div className="col-span-full flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-[#ddd] bg-white/60 text-sm text-[#9a9a9a]">
            <span className="mb-2 text-3xl">📤</span>
            아직 업로드된 이미지가 없습니다.
          </div>
        )}
      </div>
    </section>
  )
}

export default ImageUploadSection
