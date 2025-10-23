import { useEffect, useMemo, useState } from 'react'
import { useImageEditor } from '../../hooks/useImageEditor'
import type { AnimationPlan } from '../../utils/pngToGif'
import { createAnimatedGif, requestAnimationPlan } from '../../utils/pngToGif'

function truncate(text: string, max = 48) {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function formatPlan(plan: AnimationPlan | null) {
  if (!plan) return null
  return plan.keyframes
    .map((frame) => {
      const parts: string[] = []
      parts.push(`${Math.round(frame.time * 100)}%`)
      if (frame.translate?.x || frame.translate?.y) {
        parts.push(
          `이동 ${Math.round(frame.translate?.x ?? 0)}%, ${Math.round(frame.translate?.y ?? 0)}%`,
        )
      }
      if (typeof frame.scale === 'number') {
        parts.push(`배율 ×${frame.scale.toFixed(2)}`)
      }
      if (typeof frame.rotate === 'number') {
        parts.push(`회전 ${Math.round(frame.rotate)}°`)
      }
      if (typeof frame.opacity === 'number' && frame.opacity !== 1) {
        parts.push(`투명도 ${(frame.opacity * 100).toFixed(0)}%`)
      }
      return parts.join(' · ')
    })
    .filter(Boolean)
}

function PngToGifTool() {
  const {
    resultImages,
    addResultFromBlob,
    showToast,
    isProcessing,
  } = useImageEditor()
  const [selectedId, setSelectedId] = useState<string>('')
  const [prompt, setPrompt] = useState('부드럽게 확대된 후 원래 위치로 돌아오는 움직임')
  const [isGenerating, setIsGenerating] = useState(false)
  const [previewId, setPreviewId] = useState<string>('')
  const [plan, setPlan] = useState<AnimationPlan | null>(null)

  useEffect(() => {
    if (!selectedId && resultImages.length > 0) {
      setSelectedId(resultImages[0].id)
    } else if (selectedId && !resultImages.some((image) => image.id === selectedId)) {
      setSelectedId(resultImages[0]?.id ?? '')
    }
  }, [resultImages, selectedId])

  const selectedImage = useMemo(() => resultImages.find((image) => image.id === selectedId) ?? null, [
    resultImages,
    selectedId,
  ])

  const previewImage = useMemo(
    () => (previewId ? resultImages.find((image) => image.id === previewId) ?? null : null),
    [previewId, resultImages],
  )

  const handleGenerate = async () => {
    if (!selectedImage) {
      showToast('먼저 GIF로 만들 이미지를 선택해주세요.', 'error')
      return
    }
    const description = prompt.trim()
    if (!description) {
      showToast('움직임 설명을 입력해주세요.', 'error')
      return
    }

    setIsGenerating(true)
    try {
      const animationPlan = await requestAnimationPlan(description, {
        width: selectedImage.width,
        height: selectedImage.height,
      })
      setPlan(animationPlan)

      const { blob, width, height } = await createAnimatedGif(selectedImage.blob, animationPlan)
      const result = await addResultFromBlob(blob, {
        baseName: selectedImage.name,
        sourceId: selectedImage.sourceId,
        suffix: '-animated',
        extension: 'gif',
      })

      setPreviewId(result.id)
      showToast(`GIF를 생성했어요! (${width}×${height}px)`, 'success')
    } catch (error) {
      console.error('[PngToGifTool] failed to generate gif', error)
      const message = error instanceof Error ? error.message : 'GIF를 생성하지 못했어요.'
      showToast(message, 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-ellie-border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ellie-text">PNG → GIF 애니메이션</h3>
            <p className="mt-1 text-sm text-ellie-text/70">
              처리된 PNG 이미지를 선택하고 원하는 움직임을 입력하면 OpenAI가 애니메이션 계획을 만들고 GIF로 변환해요. 결과는 자동으로 25MB 이하로 압축됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selectedImage || isGenerating || isProcessing}
            className="min-h-[44px] rounded-full border border-ellie-border bg-ellie-ivory px-4 text-sm font-medium text-ellie-text transition-colors hover:bg-ellie-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? '생성 중…' : 'GIF 만들기'}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <label className="flex flex-col gap-2 text-sm text-ellie-text/80">
              <span className="font-medium text-ellie-text">대상 이미지</span>
              <select
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="w-full rounded-xl border border-ellie-border bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
                disabled={resultImages.length === 0 || isGenerating || isProcessing}
              >
                {resultImages.length === 0 ? (
                  <option value="">처리된 이미지가 없어요</option>
                ) : (
                  resultImages.map((image) => (
                    <option key={image.id} value={image.id}>
                      {truncate(image.name)} · {image.width}×{image.height}px
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm text-ellie-text/80">
              <span className="font-medium text-ellie-text">움직임 설명</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="예: 부드럽게 확대 후 좌우로 흔들리는 효과"
                rows={4}
                className="w-full resize-none rounded-xl border border-ellie-border bg-white px-3 py-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ellie-yellow"
                disabled={isGenerating || isProcessing}
              />
            </label>

            <p className="text-xs text-ellie-text/60">
              · 결과는 추가 도구 영역과 처리 결과 목록에 함께 저장돼요.
              <br />· GIF 용량은 자동으로 25MB 이하로 줄여집니다.
            </p>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-ellie-border bg-ellie-ivory/60 p-4">
            <span className="text-sm font-medium text-ellie-text">최근 생성된 GIF 미리보기</span>
            {previewImage ? (
              <div className="flex flex-col items-center gap-2">
                <img
                  src={previewImage.url}
                  alt={previewImage.name}
                  className="max-h-60 w-full max-w-full rounded-xl border border-white/80 object-contain shadow"
                />
                <span className="text-xs text-ellie-text/70">{previewImage.name}</span>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ellie-border/70 bg-white/80 py-10 text-sm text-ellie-text/60">
                <span role="img" aria-hidden="true" className="text-2xl">
                  🎞️
                </span>
                <p className="px-4 text-center">아직 생성된 GIF가 없어요. 원하는 움직임을 입력하고 버튼을 눌러보세요.</p>
              </div>
            )}

            {plan && (
              <div className="rounded-xl border border-white/80 bg-white/90 p-3 text-xs text-ellie-text/70">
                <p className="mb-2 font-semibold text-ellie-text">애니메이션 요약</p>
                <ul className="space-y-1">
                  <li>FPS: {plan.fps} · 길이: {(plan.duration_ms / 1000).toFixed(1)}초 · 반복: {plan.loop ? '무한' : '1회'}</li>
                  {formatPlan(plan)?.map((item, index) => (
                    <li key={index}>- {item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

export default PngToGifTool

