#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

function printUsageAndExit(message) {
  if (message) {
    console.error(message)
  }
  console.error('Usage: node scripts/generate-mask.js --input <input.png> [--mask <mask.png>] [--output <output.png>]')
  process.exit(1)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

function ensurePositiveInteger(value, fallback = 0) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function createImageData(data, width, height) {
  return { data, width, height }
}

function colorDistanceSq(r, g, b, ref) {
  const dr = r - ref.r
  const dg = g - ref.g
  const db = b - ref.b
  return dr * dr + dg * dg + db * db
}

function analyzeBackground(imageData, width, height) {
  const { data } = imageData
  const step = Math.max(1, Math.floor(Math.min(width, height) / 48))
  const samples = []

  const addSample = (x, y) => {
    const idx = (y * width + x) * 4
    const alpha = data[idx + 3]
    if (alpha <= 255) {
      samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2], alpha })
    }
  }

  for (let x = 0; x < width; x += step) {
    addSample(x, 0)
    addSample(x, height - 1)
  }

  for (let y = 0; y < height; y += step) {
    addSample(0, y)
    addSample(width - 1, y)
  }

  if (samples.length === 0) {
    return {
      meanColor: { r: 255, g: 255, b: 255 },
      tolerance: 60,
      toleranceSq: 3600,
      relaxedTolerance: 95,
      relaxedToleranceSq: 9025,
    }
  }

  let totalR = 0
  let totalG = 0
  let totalB = 0
  for (const sample of samples) {
    totalR += sample.r
    totalG += sample.g
    totalB += sample.b
  }

  const meanColor = {
    r: totalR / samples.length,
    g: totalG / samples.length,
    b: totalB / samples.length,
  }

  let sumDistance = 0
  for (const sample of samples) {
    sumDistance += Math.sqrt(colorDistanceSq(sample.r, sample.g, sample.b, meanColor))
  }
  const meanDistance = sumDistance / samples.length

  let variance = 0
  for (const sample of samples) {
    const distance = Math.sqrt(colorDistanceSq(sample.r, sample.g, sample.b, meanColor))
    variance += (distance - meanDistance) ** 2
  }
  const stdDev = Math.sqrt(variance / Math.max(1, samples.length - 1))

  const tolerance = Math.min(185, Math.max(38, meanDistance + stdDev * 2.4 + 12))
  const relaxedTolerance = tolerance + 35

  return {
    meanColor,
    tolerance,
    toleranceSq: tolerance * tolerance,
    relaxedTolerance,
    relaxedToleranceSq: relaxedTolerance * relaxedTolerance,
  }
}

function buildForegroundMask(imageData, width, height, stats) {
  const { data } = imageData
  const pixelCount = width * height
  const mask = new Uint8Array(pixelCount)
  const rowStride = width * 4
  const backgroundLuma = 0.2126 * stats.meanColor.r + 0.7152 * stats.meanColor.g + 0.0722 * stats.meanColor.b
  const baseColorThresholdSq = Math.max(stats.toleranceSq * 0.55, 900)
  const relaxedColorThresholdSq = Math.max(stats.relaxedToleranceSq * 0.38, baseColorThresholdSq * 0.8)
  const luminanceThreshold = Math.max(10, stats.tolerance * 0.28)
  const gradientThreshold = Math.max(16, stats.tolerance * 0.35)

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowStride
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x * 4
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]
      const alpha = data[index + 3]
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const colorDiffSq = colorDistanceSq(r, g, b, stats.meanColor)
      const luminanceDiff = Math.abs(luminance - backgroundLuma)

      let maxGradient = 0

      const updateGradient = (neighborIndex, weight = 1) => {
        const nr = data[neighborIndex]
        const ng = data[neighborIndex + 1]
        const nb = data[neighborIndex + 2]
        const neighborLuma = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb
        const gradient = Math.abs(luminance - neighborLuma) * weight
        if (gradient > maxGradient) maxGradient = gradient
      }

      if (x + 1 < width) updateGradient(index + 4)
      if (x > 0) updateGradient(index - 4)
      if (y + 1 < height) updateGradient(index + rowStride)
      if (y > 0) updateGradient(index - rowStride)
      if (x > 0 && y > 0) updateGradient(index - rowStride - 4, 0.85)
      if (x + 1 < width && y > 0) updateGradient(index - rowStride + 4, 0.85)
      if (x > 0 && y + 1 < height) updateGradient(index + rowStride - 4, 0.85)
      if (x + 1 < width && y + 1 < height) updateGradient(index + rowStride + 4, 0.85)

      let isForeground = false

      if (alpha > 250) {
        isForeground = true
      } else if (colorDiffSq > baseColorThresholdSq) {
        isForeground = true
      } else if (colorDiffSq > relaxedColorThresholdSq && maxGradient > gradientThreshold * 0.9) {
        isForeground = true
      } else if (luminanceDiff > luminanceThreshold && maxGradient > gradientThreshold * 0.85) {
        isForeground = true
      } else if (maxGradient > gradientThreshold * 1.15 && alpha > 24) {
        isForeground = true
      } else if (alpha > 210 && (colorDiffSq > relaxedColorThresholdSq * 0.65 || luminanceDiff > luminanceThreshold * 0.9)) {
        isForeground = true
      }

      if (isForeground) {
        mask[y * width + x] = 1
      }
    }
  }

  return mask
}

function dilateMask(mask, width, height, radius = 1) {
  const output = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0
      for (let ky = -radius; ky <= radius && value === 0; ky += 1) {
        const ny = y + ky
        if (ny < 0 || ny >= height) continue
        for (let kx = -radius; kx <= radius; kx += 1) {
          const nx = x + kx
          if (nx < 0 || nx >= width) continue
          if (mask[ny * width + nx]) {
            value = 1
            break
          }
        }
      }
      output[y * width + x] = value
    }
  }
  return output
}

function erodeMask(mask, width, height, radius = 1) {
  const output = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 1
      for (let ky = -radius; ky <= radius && value === 1; ky += 1) {
        const ny = y + ky
        if (ny < 0 || ny >= height) {
          value = 0
          break
        }
        for (let kx = -radius; kx <= radius; kx += 1) {
          const nx = x + kx
          if (nx < 0 || nx >= width) {
            value = 0
            break
          }
          if (!mask[ny * width + nx]) {
            value = 0
            break
          }
        }
      }
      output[y * width + x] = value
    }
  }
  return output
}

function closeMask(mask, width, height, iterations = 1) {
  let result = mask
  for (let i = 0; i < iterations; i += 1) {
    result = dilateMask(result, width, height, 1)
  }
  for (let i = 0; i < iterations; i += 1) {
    result = erodeMask(result, width, height, 1)
  }
  return result
}

function fillMaskHoles(mask, width, height) {
  const length = width * height
  const visited = new Uint8Array(length)
  const queue = []

  const enqueue = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return
    const index = y * width + x
    if (visited[index] || mask[index]) return
    visited[index] = 1
    queue.push(index)
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0)
    enqueue(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y)
    enqueue(width - 1, y)
  }

  let head = 0
  while (head < queue.length) {
    const index = queue[head]
    head += 1
    const x = index % width
    const y = Math.floor(index / width)

    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const neighborIndex = ny * width + nx
      if (visited[neighborIndex] || mask[neighborIndex]) continue
      visited[neighborIndex] = 1
      queue.push(neighborIndex)
    }
  }

  const filled = mask.slice()
  for (let i = 0; i < length; i += 1) {
    if (!mask[i] && !visited[i]) {
      filled[i] = 1
    }
  }
  return filled
}

function isolateLargestComponent(mask, width, height) {
  const length = width * height
  const visited = new Uint8Array(length)
  let bestIndices = null
  let bestBounds = null
  let bestSize = 0

  for (let i = 0; i < length; i += 1) {
    if (!mask[i] || visited[i]) continue
    const queue = [i]
    visited[i] = 1
    const component = []
    let size = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1

    while (queue.length > 0) {
      const index = queue.pop()
      component.push(index)
      size += 1
      const x = index % width
      const y = Math.floor(index / width)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      const neighbors = [
        index - 1,
        index + 1,
        index - width,
        index + width,
      ]

      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= length) continue
        if (visited[neighbor]) continue
        const nx = neighbor % width
        const ny = Math.floor(neighbor / width)
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue
        if (!mask[neighbor]) continue
        visited[neighbor] = 1
        queue.push(neighbor)
      }
    }

    if (size > bestSize) {
      bestSize = size
      bestIndices = component
      bestBounds = { top: minY, left: minX, right: maxX, bottom: maxY }
    }
  }

  if (!bestIndices || bestSize === 0 || !bestBounds) {
    return { mask: null, bounds: null }
  }

  const resultMask = new Uint8Array(length)
  for (const index of bestIndices) {
    resultMask[index] = 1
  }

  return { mask: resultMask, bounds: bestBounds }
}

function refineMask(mask, width, height) {
  if (!mask) {
    return null
  }
  let refined = closeMask(mask, width, height, 2)
  refined = fillMaskHoles(refined, width, height)
  const { mask: largestMask } = isolateLargestComponent(refined, width, height)
  if (largestMask) {
    refined = largestMask
  }
  refined = closeMask(refined, width, height, 1)
  refined = dilateMask(refined, width, height, 1)
  return refined
}

async function generateMaskAndCutout(inputPath, maskPath, outputPath) {
  const inputFullPath = path.resolve(inputPath)
  const maskFullPath = path.resolve(maskPath)
  const outputFullPath = path.resolve(outputPath)

  const bufferInfo = await sharp(inputFullPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const width = ensurePositiveInteger(bufferInfo.info.width)
  const height = ensurePositiveInteger(bufferInfo.info.height)
  if (!width || !height) {
    throw new Error('이미지 크기를 판별할 수 없습니다.')
  }

  const rgba = new Uint8ClampedArray(bufferInfo.data)
  const imageData = createImageData(rgba, width, height)

  const stats = analyzeBackground(imageData, width, height)
  const baseMask = buildForegroundMask(imageData, width, height, stats)
  const refinedMask = refineMask(baseMask, width, height)
  let mask = refinedMask || baseMask

  const pixelCount = width * height
  let hasForeground = false
  if (mask) {
    for (let i = 0; i < pixelCount; i += 1) {
      if (mask[i]) {
        hasForeground = true
        break
      }
    }
  }
  if (!hasForeground) {
    const fallbackMask = new Uint8Array(pixelCount)
    fallbackMask.fill(1)
    mask = fallbackMask
  }

  const alphaMask = new Uint8ClampedArray(pixelCount)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let i = 0; i < pixelCount; i += 1) {
    if (mask[i]) {
      alphaMask[i] = 255
      const x = i % width
      const y = Math.floor(i / width)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    } else {
      alphaMask[i] = 0
    }
  }

  if (minX > maxX || minY > maxY) {
    minX = 0
    minY = 0
    maxX = width - 1
    maxY = height - 1
    for (let i = 0; i < pixelCount; i += 1) {
      alphaMask[i] = 255
    }
  }

  const rgbaWithAlpha = new Uint8ClampedArray(rgba.length)
  rgbaWithAlpha.set(rgba)
  for (let i = 0; i < pixelCount; i += 1) {
    const alphaIndex = i * 4 + 3
    rgbaWithAlpha[alphaIndex] = alphaMask[i]
    if (alphaMask[i] === 0) {
      rgbaWithAlpha[alphaIndex - 3] = 0
      rgbaWithAlpha[alphaIndex - 2] = 0
      rgbaWithAlpha[alphaIndex - 1] = 0
    }
  }

  const cropWidth = Math.max(1, maxX - minX + 1)
  const cropHeight = Math.max(1, maxY - minY + 1)
  const cropped = new Uint8ClampedArray(cropWidth * cropHeight * 4)

  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const sourceX = minX + x
      const sourceY = minY + y
      const sourceIndex = (sourceY * width + sourceX) * 4
      const targetIndex = (y * cropWidth + x) * 4
      cropped[targetIndex] = rgbaWithAlpha[sourceIndex]
      cropped[targetIndex + 1] = rgbaWithAlpha[sourceIndex + 1]
      cropped[targetIndex + 2] = rgbaWithAlpha[sourceIndex + 2]
      cropped[targetIndex + 3] = rgbaWithAlpha[sourceIndex + 3]
    }
  }

  const maskBuffer = new Uint8ClampedArray(pixelCount)
  for (let i = 0; i < pixelCount; i += 1) {
    maskBuffer[i] = mask[i] ? 0 : 255
  }

  await fs.mkdir(path.dirname(maskFullPath), { recursive: true })
  await fs.mkdir(path.dirname(outputFullPath), { recursive: true })

  await sharp(Buffer.from(maskBuffer), {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(maskFullPath)

  await sharp(Buffer.from(cropped), {
    raw: {
      width: cropWidth,
      height: cropHeight,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9 })
    .toFile(outputFullPath)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.input || args.i || 'input.png'
  const mask = args.mask || args.m || 'mask.png'
  const output = args.output || args.o || 'output.png'

  try {
    await fs.access(input)
  } catch (error) {
    printUsageAndExit(`Input file not found: ${input}`)
  }

  try {
    await generateMaskAndCutout(input, mask, output)
    console.log(`Mask saved to ${mask}`)
    console.log(`Cutout saved to ${output}`)
  } catch (error) {
    console.error('Failed to generate mask/cutout:')
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
