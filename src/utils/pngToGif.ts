import { loadImageDimensions } from './imageProcessing'

export type AnimationEase = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

export type AnimationKeyframe = {
  time: number
  translate?: { x?: number; y?: number }
  scale?: number
  rotate?: number
  opacity?: number
  ease?: AnimationEase
}

export type AnimationPlan = {
  fps: number
  loop: boolean
  duration_ms: number
  keyframes: AnimationKeyframe[]
}

type NormalizedKeyframe = {
  time: number
  translateX: number
  translateY: number
  scale: number
  rotate: number
  opacity: number
  ease: AnimationEase
}

type NormalizedPlan = {
  fps: number
  durationMs: number
  loop: boolean
  keyframes: NormalizedKeyframe[]
}

type AnimationPlanResponse = {
  plan?: AnimationPlan
  error?: string
  message?: string
}

const MAX_SIZE_BYTES = 25 * 1024 * 1024
const MAX_FRAMES = 48
const MAX_DIMENSION = 720
const MIN_SCALE_FACTOR = 0.35
const ALPHA_THRESHOLD = 30

const easeFunctions: Record<AnimationEase, (t: number) => number> = {
  linear: (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => 1 - (1 - t) * (1 - t),
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function ensureKeyframes(plan: AnimationPlan): NormalizedPlan {
  const fps = clamp(Math.round(plan.fps || 8), 4, 15)
  const durationMs = clamp(Math.round(plan.duration_ms || 3200), 800, 8000)
  const keyframes = Array.isArray(plan.keyframes) ? [...plan.keyframes] : []

  const defaults: NormalizedKeyframe = {
    time: 0,
    translateX: 0,
    translateY: 0,
    scale: 1,
    rotate: 0,
    opacity: 1,
    ease: 'linear',
  }

  const normalized = keyframes
    .map((frame) => ({
      time: clamp(typeof frame.time === 'number' ? frame.time : 0, 0, 1),
      translateX: clamp(frame.translate?.x ?? 0, -120, 120),
      translateY: clamp(frame.translate?.y ?? 0, -120, 120),
      scale: clamp(typeof frame.scale === 'number' ? frame.scale : 1, 0.4, 2.5),
      rotate: clamp(typeof frame.rotate === 'number' ? frame.rotate : 0, -180, 180),
      opacity: clamp(typeof frame.opacity === 'number' ? frame.opacity : 1, 0, 1),
      ease: (frame.ease ?? 'linear') as AnimationEase,
    }))
    .filter((frame) => Number.isFinite(frame.time))

  normalized.sort((a, b) => a.time - b.time)

  const first = normalized[0]
  if (!first || first.time > 0) {
    normalized.unshift({ ...defaults, ...(first ? { ...first, time: 0 } : {}) })
  }
  const last = normalized[normalized.length - 1]
  if (!last || last.time < 1) {
    normalized.push({ ...(last ?? defaults), time: 1 })
  }

  // Deduplicate by time, keeping first occurrence
  const deduped: NormalizedKeyframe[] = []
  const seen = new Set<number>()
  for (const frame of normalized) {
    const rounded = Number(frame.time.toFixed(4))
    if (seen.has(rounded)) continue
    seen.add(rounded)
    deduped.push({ ...frame, time: rounded })
  }

  // Ensure ease values are valid
  deduped.forEach((frame, index) => {
    if (!easeFunctions[frame.ease]) {
      deduped[index] = { ...frame, ease: 'linear' }
    }
  })

  return {
    fps,
    durationMs,
    loop: !!plan.loop,
    keyframes: deduped,
  }
}

function interpolateFrames(plan: NormalizedPlan, totalFrames: number) {
  const frames: NormalizedKeyframe[] = []
  const { keyframes } = plan

  for (let index = 0; index < totalFrames; index += 1) {
    const progress = totalFrames === 1 ? 0 : index / (totalFrames - 1)
    let start = keyframes[0]
    let end = keyframes[keyframes.length - 1]

    for (let pointer = 0; pointer < keyframes.length - 1; pointer += 1) {
      const current = keyframes[pointer]
      const next = keyframes[pointer + 1]
      if (progress >= current.time && progress <= next.time) {
        start = current
        end = next
        break
      }
    }

    const span = clamp(end.time - start.time, 0.0001, 1)
    const localProgress = clamp((progress - start.time) / span, 0, 1)
    const ease = easeFunctions[start.ease] ?? easeFunctions.linear
    const eased = ease(localProgress)

    const blend = (from: number, to: number) => from + (to - from) * eased

    frames.push({
      time: progress,
      translateX: blend(start.translateX, end.translateX),
      translateY: blend(start.translateY, end.translateY),
      scale: blend(start.scale, end.scale),
      rotate: blend(start.rotate, end.rotate),
      opacity: blend(start.opacity, end.opacity),
      ease: start.ease,
    })
  }

  return frames
}

async function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = (event) => reject(event instanceof ErrorEvent ? event.error : new Error('IMAGE_LOAD_FAILED'))
      image.src = url
    })
    return element
  } finally {
    URL.revokeObjectURL(url)
  }
}

type FrameImage = {
  width: number
  height: number
  data: Uint8ClampedArray
}

function renderFrames(image: HTMLImageElement, plan: NormalizedPlan, scaleFactor: number) {
  const baseWidth = image.naturalWidth || image.width
  const baseHeight = image.naturalHeight || image.height

  let scaledWidth = Math.max(32, Math.round(baseWidth * scaleFactor))
  let scaledHeight = Math.max(32, Math.round(baseHeight * scaleFactor))

  const largestSide = Math.max(scaledWidth, scaledHeight)
  if (largestSide > MAX_DIMENSION) {
    const adjust = MAX_DIMENSION / largestSide
    scaledWidth = Math.max(32, Math.round(scaledWidth * adjust))
    scaledHeight = Math.max(32, Math.round(scaledHeight * adjust))
  }

  const totalFrames = clamp(
    Math.max(2, Math.round((plan.durationMs / 1000) * plan.fps)),
    2,
    MAX_FRAMES,
  )

  const canvas = document.createElement('canvas')
  canvas.width = scaledWidth
  canvas.height = scaledHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('CANVAS_CONTEXT_UNAVAILABLE')
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const keyframes = interpolateFrames(plan, totalFrames)
  const frames: FrameImage[] = []

  for (const keyframe of keyframes) {
    ctx.clearRect(0, 0, scaledWidth, scaledHeight)
    ctx.save()
    ctx.globalAlpha = clamp(keyframe.opacity, 0, 1)

    const translateX = (keyframe.translateX / 100) * scaledWidth
    const translateY = (keyframe.translateY / 100) * scaledHeight
    const drawWidth = scaledWidth * keyframe.scale
    const drawHeight = scaledHeight * keyframe.scale

    ctx.translate(scaledWidth / 2 + translateX, scaledHeight / 2 + translateY)
    ctx.rotate((keyframe.rotate * Math.PI) / 180)
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
    ctx.restore()

    const { data } = ctx.getImageData(0, 0, scaledWidth, scaledHeight)
    frames.push({ width: scaledWidth, height: scaledHeight, data })
  }

  const delay = Math.max(2, Math.round(100 / plan.fps))

  return { frames, width: scaledWidth, height: scaledHeight, delay }
}

function quantizeColor(value: number, levels: number) {
  const step = levels - 1
  if (step <= 0) return 0
  return Math.round((value / 255) * step)
}

function expandColor(level: number, levels: number) {
  if (levels <= 1) return 0
  const step = levels - 1
  return Math.round((level / step) * 255)
}

type PaletteInfo = {
  palette: Array<[number, number, number]>
  colorLevels: number
  lookup: Map<number, number>
}

function buildPalette(frames: FrameImage[]): PaletteInfo {
  let levels = 6
  while (levels >= 2) {
    const lookup = new Map<number, number>()
    const palette: Array<[number, number, number]> = [[0, 0, 0]]

    outer: for (const frame of frames) {
      const { data } = frame
      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3]
        if (alpha < ALPHA_THRESHOLD) {
          continue
        }
        const rLevel = quantizeColor(data[index], levels)
        const gLevel = quantizeColor(data[index + 1], levels)
        const bLevel = quantizeColor(data[index + 2], levels)
        const key = rLevel * levels * levels + gLevel * levels + bLevel
        if (!lookup.has(key)) {
          lookup.set(key, palette.length)
          palette.push([
            expandColor(rLevel, levels),
            expandColor(gLevel, levels),
            expandColor(bLevel, levels),
          ])
          if (palette.length >= 256) {
            break outer
          }
        }
      }
    }

    if (palette.length <= 256) {
      return { palette, colorLevels: levels, lookup }
    }

    levels -= 1
  }

  // Fallback: heavily quantize to 3 levels
  const lookup = new Map<number, number>()
  const palette: Array<[number, number, number]> = [[0, 0, 0]]
  const fallbackLevels = 3
  for (const frame of frames) {
    const { data } = frame
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3]
      if (alpha < ALPHA_THRESHOLD) continue
      const rLevel = quantizeColor(data[index], fallbackLevels)
      const gLevel = quantizeColor(data[index + 1], fallbackLevels)
      const bLevel = quantizeColor(data[index + 2], fallbackLevels)
      const key = rLevel * fallbackLevels * fallbackLevels + gLevel * fallbackLevels + bLevel
      if (!lookup.has(key)) {
        lookup.set(key, palette.length)
        palette.push([
          expandColor(rLevel, fallbackLevels),
          expandColor(gLevel, fallbackLevels),
          expandColor(bLevel, fallbackLevels),
        ])
        if (palette.length >= 256) break
      }
    }
  }

  return { palette, colorLevels: fallbackLevels, lookup }
}

function findNearestColor(palette: Array<[number, number, number]>, r: number, g: number, b: number) {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 1; index < palette.length; index += 1) {
    const [pr, pg, pb] = palette[index]
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }
  return bestIndex
}

function mapFrameToIndices(frame: FrameImage, paletteInfo: PaletteInfo) {
  const { data, width, height } = frame
  const { palette, lookup, colorLevels } = paletteInfo
  const totalPixels = width * height
  const indices = new Uint8Array(totalPixels)

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * 4
    const alpha = data[offset + 3]
    if (alpha < ALPHA_THRESHOLD) {
      indices[pixel] = 0
      continue
    }

    const rLevel = quantizeColor(data[offset], colorLevels)
    const gLevel = quantizeColor(data[offset + 1], colorLevels)
    const bLevel = quantizeColor(data[offset + 2], colorLevels)
    const key = rLevel * colorLevels * colorLevels + gLevel * colorLevels + bLevel

    if (lookup.has(key)) {
      indices[pixel] = lookup.get(key) ?? 0
    } else {
      const paletteIndex = findNearestColor(palette, data[offset], data[offset + 1], data[offset + 2])
      indices[pixel] = paletteIndex
    }
  }

  return indices
}

function lzwCompress(indices: Uint8Array, minCodeSize: number) {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1

  const output: number[] = []
  let buffer = 0
  let bitsInBuffer = 0

  let codeSize = minCodeSize + 1
  let nextCode = endCode + 1

  const emit = (code: number) => {
    buffer |= code << bitsInBuffer
    bitsInBuffer += codeSize
    while (bitsInBuffer >= 8) {
      output.push(buffer & 0xff)
      buffer >>= 8
      bitsInBuffer -= 8
    }
  }

  const resetDictionary = () => {
    dictionary.clear()
    for (let i = 0; i < clearCode; i += 1) {
      dictionary.set(String.fromCharCode(i), i)
    }
    codeSize = minCodeSize + 1
    nextCode = endCode + 1
  }

  const dictionary = new Map<string, number>()
  resetDictionary()
  emit(clearCode)

  let phrase = ''

  for (let i = 0; i < indices.length; i += 1) {
    const symbol = String.fromCharCode(indices[i])
    const joined = phrase + symbol
    if (dictionary.has(joined)) {
      phrase = joined
    } else {
      const code = dictionary.get(phrase)
      if (typeof code === 'number') {
        emit(code)
      }
      if (nextCode < 4096) {
        dictionary.set(joined, nextCode)
        nextCode += 1
        if (nextCode === 1 << codeSize && codeSize < 12) {
          codeSize += 1
        }
      } else {
        emit(clearCode)
        resetDictionary()
      }
      phrase = symbol
    }
  }

  if (phrase) {
    const code = dictionary.get(phrase)
    if (typeof code === 'number') {
      emit(code)
    }
  }

  emit(endCode)

  if (bitsInBuffer > 0) {
    output.push(buffer & 0xff)
  }

  return new Uint8Array(output)
}

function writeSubBlocks(bytes: Uint8Array, target: number[]) {
  let offset = 0
  while (offset < bytes.length) {
    const blockSize = Math.min(255, bytes.length - offset)
    target.push(blockSize)
    for (let i = 0; i < blockSize; i += 1) {
      target.push(bytes[offset + i])
    }
    offset += blockSize
  }
  target.push(0)
}

function buildGif(frames: Uint8Array[], palette: Array<[number, number, number]>, width: number, height: number, delay: number, loop: boolean) {
  const colorCount = palette.length
  let minCodeSize = 2
  while ((1 << minCodeSize) < colorCount) {
    minCodeSize += 1
  }
  minCodeSize = clamp(minCodeSize, 2, 12)

  const globalColorTableSize = 1 << Math.ceil(Math.log2(colorCount || 1))
  const colorTablePow = Math.max(0, Math.ceil(Math.log2(globalColorTableSize)) - 1)

  const bytes: number[] = []
  const writeString = (value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      bytes.push(value.charCodeAt(i) & 0xff)
    }
  }
  const writeWord = (value: number) => {
    bytes.push(value & 0xff)
    bytes.push((value >> 8) & 0xff)
  }

  // Header
  writeString('GIF89a')

  // Logical Screen Descriptor
  writeWord(width)
  writeWord(height)
  const gctFlag = 1 << 7
  const colorResolution = 7 << 4
  const sortFlag = 0
  const gctSize = colorTablePow & 0x07
  bytes.push(gctFlag | colorResolution | sortFlag | gctSize)
  bytes.push(0) // background color index
  bytes.push(0) // pixel aspect ratio

  // Global Color Table
  for (let i = 0; i < globalColorTableSize; i += 1) {
    const color = palette[i] ?? [0, 0, 0]
    bytes.push(color[0] & 0xff)
    bytes.push(color[1] & 0xff)
    bytes.push(color[2] & 0xff)
  }

  // Looping extension
  bytes.push(0x21, 0xff, 0x0b)
  writeString('NETSCAPE2.0')
  bytes.push(0x03, 0x01)
  writeWord(loop ? 0 : 1)
  bytes.push(0x00)

  const frameDelay = clamp(delay, 2, 255)

  for (const indices of frames) {
    // Graphics Control Extension
    bytes.push(0x21, 0xf9, 0x04)
    const disposal = 0x02 << 2
    const transparentFlag = 0x01
    bytes.push(disposal | transparentFlag)
    writeWord(frameDelay)
    bytes.push(0x00) // transparent color index
    bytes.push(0x00)

    // Image Descriptor
    bytes.push(0x2c)
    writeWord(0)
    writeWord(0)
    writeWord(width)
    writeWord(height)
    bytes.push(0x00)

    bytes.push(minCodeSize)
    const compressed = lzwCompress(indices, minCodeSize)
    writeSubBlocks(compressed, bytes)
  }

  // Trailer
  bytes.push(0x3b)

  return new Uint8Array(bytes)
}

async function generateGif(blob: Blob, plan: AnimationPlan) {
  const normalized = ensureKeyframes(plan)
  const imageElement = await loadImageElement(blob)

  let scaleFactor = 1
  const attempts: Array<{ gif: Uint8Array; width: number; height: number }> = []

  while (scaleFactor >= MIN_SCALE_FACTOR) {
    const { frames, width, height, delay } = renderFrames(imageElement, normalized, scaleFactor)
    const paletteInfo = buildPalette(frames)
    const mappedFrames = frames.map((frame) => mapFrameToIndices(frame, paletteInfo))
    const gifBytes = buildGif(mappedFrames, paletteInfo.palette, width, height, delay, normalized.loop)
    attempts.push({ gif: gifBytes, width, height })

    const blobResult = new Blob([gifBytes], { type: 'image/gif' })
    if (blobResult.size <= MAX_SIZE_BYTES) {
      return { blob: blobResult, width, height }
    }

    scaleFactor *= 0.8
  }

  const last = attempts[attempts.length - 1]
  return {
    blob: new Blob([last.gif], { type: 'image/gif' }),
    width: last.width,
    height: last.height,
  }
}

export async function requestAnimationPlan(prompt: string, dimensions?: { width?: number; height?: number }) {
  const response = await fetch('/api/png-to-gif', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, width: dimensions?.width, height: dimensions?.height }),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as AnimationPlanResponse
    const message = payload?.message || '애니메이션 정보를 불러오지 못했어요.'
    const error = payload?.error || 'REQUEST_FAILED'
    const err = new Error(message)
    ;(err as Error & { code?: string }).code = error
    throw err
  }

  const payload = (await response.json()) as AnimationPlanResponse
  if (!payload?.plan) {
    throw new Error('생성된 애니메이션 계획이 없어요.')
  }
  return payload.plan
}

export async function createAnimatedGif(blob: Blob, plan: AnimationPlan) {
  const gif = await generateGif(blob, plan)
  return gif
}

export async function createGifFromImage(
  image: Blob,
  prompt: string,
  options: { width?: number; height?: number } = {},
) {
  const dimensions = await loadImageDimensions(image)
  const plan = await requestAnimationPlan(prompt, {
    width: options.width ?? dimensions.width,
    height: options.height ?? dimensions.height,
  })
  return createAnimatedGif(image, plan)
}

