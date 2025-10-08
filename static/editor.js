import { apiRequest, clamp, debounce, ensureLoggedIn, fileToDataURL, showToast } from './utils.js';

const uploadArea = document.querySelector('[data-role="upload-area"]');
const fileInput = document.querySelector('[data-role="file-input"]');
const workspace = document.querySelector('[data-role="workspace"]');
const stage = document.querySelector('[data-role="stage"]');
const canvas = document.querySelector('[data-role="canvas"]');
const resizeRange = document.querySelector('[data-role="resize-range"]');
const resizeOutput = document.querySelector('[data-role="resize-output"]');
const ratioToggle = document.querySelector('[data-role="ratio-lock"]');
const widthInput = document.querySelector('[data-role="width-input"]');
const heightInput = document.querySelector('[data-role="height-input"]');
const applyResizeButton = document.querySelector('[data-action="apply-resize"]');
const svgPanel = document.querySelector('[data-role="svg-panel"]');
const svgPreview = document.querySelector('[data-role="svg-preview"]');
const svgColors = document.querySelector('[data-role="svg-colors"]');
const colorCountInput = document.querySelector('[data-role="color-count"]');
const analysisSection = document.querySelector('[data-role="analysis"]');
const analysisTitle = document.querySelector('[data-role="analysis-title"]');
const analysisKeywords = document.querySelector('[data-role="analysis-keywords"]');
const copyKeywordsButton = document.querySelector('[data-action="copy-keywords"]');
const cropOverlay = document.querySelector('[data-role="crop-overlay"]');
const cropSelection = document.querySelector('[data-role="crop-selection"]');
const removeBgButton = document.querySelector('[data-action="remove-bg"]');
const autoCropButton = document.querySelector('[data-action="auto-crop"]');
const manualCropButton = document.querySelector('[data-action="manual-crop"]');
const denoiseButton = document.querySelector('[data-action="denoise"]');
const resetButton = document.querySelector('[data-action="reset"]');
const downloadPngButton = document.querySelector('[data-action="download-png"]');
const requestSvgButton = document.querySelector('[data-action="request-svg"]');
const downloadSvgButton = document.querySelector('[data-action="download-svg"]');
const closeSvgButton = document.querySelector('[data-action="close-svg"]');
const analyzeButton = document.querySelector('[data-action="analyze-keywords"]');

const ctx = canvas.getContext('2d');

const state = {
  originalCanvas: document.createElement('canvas'),
  sourceCanvas: document.createElement('canvas'),
  scale: 1,
  aspectRatio: 1,
  svgContent: null,
  originalSvgContent: null,
  svgColors: [],
  svgUrl: null,
  manualCropActive: false,
  manualCropStart: null,
  lastKeywords: [],
  lastTitle: '',
};

function setWorkspaceVisible(visible) {
  workspace.hidden = !visible;
}

function syncResizeInputs() {
  widthInput.value = String(Math.max(1, Math.round(state.sourceCanvas.width * state.scale)));
  heightInput.value = String(Math.max(1, Math.round(state.sourceCanvas.height * state.scale)));
  resizeOutput.textContent = `${Math.round(state.scale * 100)}%`;
}

function syncOverlaySize() {
  if (!stage || !canvas || !cropOverlay) return;
  const rect = canvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  cropOverlay.style.width = `${rect.width}px`;
  cropOverlay.style.height = `${rect.height}px`;
  cropOverlay.style.transform = `translate(${rect.left - stageRect.left}px, ${rect.top - stageRect.top}px)`;
}

function drawToSource(image) {
  const { width, height } = image;
  state.originalCanvas.width = width;
  state.originalCanvas.height = height;
  const originalCtx = state.originalCanvas.getContext('2d');
  originalCtx.drawImage(image, 0, 0, width, height);

  state.sourceCanvas.width = width;
  state.sourceCanvas.height = height;
  const sourceCtx = state.sourceCanvas.getContext('2d');
  sourceCtx.drawImage(image, 0, 0, width, height);
  state.aspectRatio = width / height;
}

function renderDisplay() {
  const width = Math.max(1, Math.round(state.sourceCanvas.width * state.scale));
  const height = Math.max(1, Math.round(state.sourceCanvas.height * state.scale));
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(state.sourceCanvas, 0, 0, width, height);
  syncResizeInputs();
  requestAnimationFrame(syncOverlaySize);
}

async function handleFile(file) {
  if (!ensureLoggedIn()) return;
  if (!file) return;
  const dataUrl = await fileToDataURL(file);
  const image = new Image();
  image.onload = () => {
    if (state.svgUrl) {
      URL.revokeObjectURL(state.svgUrl);
      state.svgUrl = null;
    }
    state.svgContent = null;
    state.originalSvgContent = null;
    state.svgColors = [];
    svgPreview.innerHTML = '';
    svgColors.innerHTML = '';
    drawToSource(image);
    state.scale = 1;
    renderDisplay();
    setWorkspaceVisible(true);
    svgPanel.hidden = true;
    analysisSection.hidden = true;
    state.lastKeywords = [];
    state.lastTitle = '';
    analysisTitle.textContent = '';
    analysisKeywords.innerHTML = '';
    showToast('이미지를 불러왔습니다.');
  };
  image.src = dataUrl;
}

function getSourceContext() {
  return state.sourceCanvas.getContext('2d');
}

function resetEdits() {
  const ctxOriginal = state.originalCanvas.getContext('2d');
  const data = ctxOriginal.getImageData(0, 0, state.originalCanvas.width, state.originalCanvas.height);
  state.sourceCanvas.width = state.originalCanvas.width;
  state.sourceCanvas.height = state.originalCanvas.height;
  getSourceContext().putImageData(data, 0, 0);
  state.scale = 1;
  state.aspectRatio = state.sourceCanvas.width / state.sourceCanvas.height;
  renderDisplay();
  svgPanel.hidden = true;
  analysisSection.hidden = true;
  state.lastKeywords = [];
  state.lastTitle = '';
  deactivateManualCrop();
  showToast('원본으로 복원했습니다.');
}

function removeBackground() {
  const { width, height } = state.sourceCanvas;
  if (!width || !height) {
    showToast('먼저 이미지를 업로드해주세요.');
    return;
  }
  const sourceCtx = getSourceContext();
  const imageData = sourceCtx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const borderSamples = [];
  const stepX = Math.max(1, Math.floor(width / 20));
  const stepY = Math.max(1, Math.floor(height / 20));
  for (let x = 0; x < width; x += stepX) {
    const idxTop = (x * 4);
    const idxBottom = ((height - 1) * width + x) * 4;
    borderSamples.push([data[idxTop], data[idxTop + 1], data[idxTop + 2]]);
    borderSamples.push([data[idxBottom], data[idxBottom + 1], data[idxBottom + 2]]);
  }
  for (let y = 0; y < height; y += stepY) {
    const idxLeft = (y * width) * 4;
    const idxRight = (y * width + (width - 1)) * 4;
    borderSamples.push([data[idxLeft], data[idxLeft + 1], data[idxLeft + 2]]);
    borderSamples.push([data[idxRight], data[idxRight + 1], data[idxRight + 2]]);
  }
  const threshold = 40;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let transparent = false;
    for (const sample of borderSamples) {
      const dr = r - sample[0];
      const dg = g - sample[1];
      const db = b - sample[2];
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      if (distance < threshold) {
        transparent = true;
        break;
      }
    }
    if (transparent) {
      data[i + 3] = clamp(data[i + 3] - 160, 0, 255);
    }
  }
  sourceCtx.putImageData(imageData, 0, 0);
  renderDisplay();
  showToast('배경을 투명 처리했습니다.');
}

function autoCrop() {
  const { width, height } = state.sourceCanvas;
  if (!width || !height) {
    showToast('먼저 이미지를 업로드해주세요.');
    return;
  }
  const sourceCtx = getSourceContext();
  const imageData = sourceCtx.getImageData(0, 0, width, height);
  const data = imageData.data;
  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  let count = 0;
  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 40));
  for (let x = 0; x < width; x += sampleStep) {
    const top = (x * 4);
    const bottom = ((height - 1) * width + x) * 4;
    avgR += data[top];
    avgG += data[top + 1];
    avgB += data[top + 2];
    avgR += data[bottom];
    avgG += data[bottom + 1];
    avgB += data[bottom + 2];
    count += 2;
  }
  for (let y = 0; y < height; y += sampleStep) {
    const left = (y * width) * 4;
    const right = (y * width + (width - 1)) * 4;
    avgR += data[left];
    avgG += data[left + 1];
    avgB += data[left + 2];
    avgR += data[right];
    avgG += data[right + 1];
    avgB += data[right + 2];
    count += 2;
  }
  avgR /= count;
  avgG /= count;
  avgB /= count;

  let top = height;
  let bottom = 0;
  let left = width;
  let right = 0;
  const colorThreshold = 35;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      const dr = data[index] - avgR;
      const dg = data[index + 1] - avgG;
      const db = data[index + 2] - avgB;
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      if (alpha > 16 && distance > colorThreshold) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (left > right || top > bottom) {
    showToast('자동으로 크롭할 영역을 찾지 못했습니다.');
    return;
  }

  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const cropped = sourceCtx.getImageData(left, top, cropWidth, cropHeight);
  state.sourceCanvas.width = cropWidth;
  state.sourceCanvas.height = cropHeight;
  getSourceContext().putImageData(cropped, 0, 0);
  state.scale = 1;
  state.aspectRatio = cropWidth / cropHeight;
  renderDisplay();
  showToast('자동 크롭을 적용했습니다.');
}

function deactivateManualCrop() {
  if (!cropOverlay || !cropSelection) return;
  state.manualCropActive = false;
  state.manualCropStart = null;
  cropOverlay.hidden = true;
  cropOverlay.classList.remove('is-active');
  cropSelection.style.width = '0px';
  cropSelection.style.height = '0px';
  cropSelection.style.transform = 'translate(0, 0)';
  manualCropButton?.classList.remove('is-active');
}

function activateManualCrop() {
  if (!ensureLoggedIn()) return;
  if (!state.sourceCanvas.width || !state.sourceCanvas.height) {
    showToast('먼저 이미지를 업로드해주세요.');
    return;
  }
  if (!cropOverlay || !cropSelection) return;
  if (state.manualCropActive) {
    deactivateManualCrop();
    return;
  }
  state.manualCropActive = true;
  cropOverlay.hidden = false;
  cropOverlay.classList.add('is-active');
  cropSelection.style.width = '0px';
  cropSelection.style.height = '0px';
  manualCropButton?.classList.add('is-active');
  showToast('크롭할 영역을 드래그하여 선택하세요.');
}

function applyManualCrop(start, end) {
  if (!start || !end) return;
  const rect = canvas.getBoundingClientRect();
  const x1 = clamp(Math.min(start.x, end.x), 0, rect.width);
  const y1 = clamp(Math.min(start.y, end.y), 0, rect.height);
  const x2 = clamp(Math.max(start.x, end.x), 0, rect.width);
  const y2 = clamp(Math.max(start.y, end.y), 0, rect.height);
  const widthRatio = state.sourceCanvas.width / rect.width;
  const heightRatio = state.sourceCanvas.height / rect.height;
  const cropLeft = Math.round(x1 * widthRatio);
  const cropTop = Math.round(y1 * heightRatio);
  const cropWidth = Math.max(1, Math.round((x2 - x1) * widthRatio));
  const cropHeight = Math.max(1, Math.round((y2 - y1) * heightRatio));
  if (cropWidth < 5 || cropHeight < 5) {
    showToast('크롭 영역이 너무 작습니다. 다시 시도해주세요.');
    return;
  }
  const sourceCtx = getSourceContext();
  const cropped = sourceCtx.getImageData(cropLeft, cropTop, cropWidth, cropHeight);
  state.sourceCanvas.width = cropWidth;
  state.sourceCanvas.height = cropHeight;
  getSourceContext().putImageData(cropped, 0, 0);
  state.scale = 1;
  state.aspectRatio = cropWidth / cropHeight;
  renderDisplay();
  showToast('수동 크롭을 적용했습니다.');
}

function denoise() {
  const { width, height } = state.sourceCanvas;
  if (!width || !height) {
    showToast('먼저 이미지를 업로드해주세요.');
    return;
  }
  const sourceCtx = getSourceContext();
  const imageData = sourceCtx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const output = new Uint8ClampedArray(data.length);
  const kernel = [
    [1, 2, 1],
    [2, 4, 2],
    [1, 2, 1],
  ];
  const kernelWeight = 16;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const px = clamp(x + kx, 0, width - 1);
          const py = clamp(y + ky, 0, height - 1);
          const weight = kernel[ky + 1][kx + 1];
          const index = (py * width + px) * 4;
          r += data[index] * weight;
          g += data[index + 1] * weight;
          b += data[index + 2] * weight;
          a += data[index + 3] * weight;
        }
      }
      const outIndex = (y * width + x) * 4;
      output[outIndex] = Math.round(r / kernelWeight);
      output[outIndex + 1] = Math.round(g / kernelWeight);
      output[outIndex + 2] = Math.round(b / kernelWeight);
      output[outIndex + 3] = Math.round(a / kernelWeight);
    }
  }
  const smoothed = new ImageData(output, width, height);
  sourceCtx.putImageData(smoothed, 0, 0);
  renderDisplay();
  showToast('노이즈를 완화했습니다.');
}

function downloadPNG() {
  if (!ensureLoggedIn()) return;
  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = 'elliesbang-edited.png';
  link.click();
}

async function requestSvgConversion() {
  if (!ensureLoggedIn()) return;
  if (state.sourceCanvas.width === 0 || state.sourceCanvas.height === 0) {
    showToast('먼저 이미지를 업로드해주세요.');
    return;
  }
  const colorCount = clamp(Number(colorCountInput.value) || 4, 1, 6);
  showToast('SVG 변환을 요청했습니다. 잠시만 기다려주세요.');
  const imageDataUrl = state.sourceCanvas.toDataURL('image/png');
  try {
    const response = await apiRequest('images/convert-svg', {
      body: { image: imageDataUrl, colorCount },
    });
    state.originalSvgContent = response.svg;
    state.svgContent = response.svg;
    state.svgColors = (response.colors || []).map((color) => ({ original: color, current: color }));
    updateSvgPreview();
    renderColorControls();
    svgPanel.hidden = false;
    showToast('SVG 변환이 완료되었습니다.');
  } catch (error) {
    showToast(error.message);
  }
}

function updateSvgPreview() {
  if (state.svgUrl) {
    URL.revokeObjectURL(state.svgUrl);
  }
  const blob = new Blob([state.svgContent || ''], { type: 'image/svg+xml' });
  state.svgUrl = URL.createObjectURL(blob);
  svgPreview.innerHTML = '';
  const object = document.createElement('object');
  object.type = 'image/svg+xml';
  object.data = state.svgUrl;
  svgPreview.appendChild(object);
}

function renderColorControls() {
  svgColors.innerHTML = '';
  state.svgColors.forEach((entry, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'svg-panel__color';
    const label = document.createElement('span');
    label.textContent = `색상 ${index + 1}`;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = entry.current;
    input.addEventListener('input', () => {
      updateSvgColor(index, input.value);
    });
    wrapper.append(label, input);
    svgColors.appendChild(wrapper);
  });
}

function updateSvgColor(index, newColor) {
  const colorEntry = state.svgColors[index];
  if (!colorEntry) return;
  colorEntry.current = newColor;
  let updatedSvg = state.originalSvgContent;
  state.svgColors.forEach(({ original, current }) => {
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    updatedSvg = updatedSvg.replace(regex, current);
  });
  state.svgContent = updatedSvg;
  updateSvgPreview();
}

function downloadSVG() {
  if (!state.svgContent) {
    showToast('먼저 SVG를 생성해주세요.');
    return;
  }
  const blob = new Blob([state.svgContent], { type: 'image/svg+xml' });
  if (blob.size > 150 * 1024) {
    showToast('SVG 파일이 150KB를 초과합니다. 색상을 조정한 뒤 다시 시도하세요.');
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'elliesbang-vector.svg';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function analyzeKeywords() {
  if (!ensureLoggedIn()) return;
  if (state.sourceCanvas.width === 0 || state.sourceCanvas.height === 0) {
    showToast('먼저 이미지를 편집해주세요.');
    return;
  }
  showToast('편집된 이미지로 키워드를 분석 중입니다.');
  const dataUrl = state.sourceCanvas.toDataURL('image/png');
  try {
    const response = await apiRequest('images/analyze', { body: { image: dataUrl } });
    const { title, keywords } = response;
    state.lastTitle = title;
    state.lastKeywords = keywords || [];
    analysisSection.hidden = false;
    analysisTitle.textContent = title ? `🎯 추천 제목: ${title}` : '추천 제목을 생성하지 못했습니다.';
    analysisKeywords.innerHTML = '';
    (keywords || []).forEach((keyword) => {
      const tag = document.createElement('span');
      tag.className = 'analysis__keyword';
      tag.textContent = keyword;
      analysisKeywords.appendChild(tag);
    });
    if (!keywords || keywords.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = '키워드를 생성하지 못했습니다. 다시 시도해주세요.';
      analysisKeywords.appendChild(empty);
    }
    showToast('키워드 분석이 완료되었습니다.');
  } catch (error) {
    showToast(error.message);
  }
}

function copyKeywords() {
  if (!state.lastKeywords.length && !state.lastTitle) {
    showToast('복사할 키워드가 없습니다.');
    return;
  }
  const payload = [state.lastTitle ? `제목: ${state.lastTitle}` : null, state.lastKeywords.join(', ')].filter(Boolean).join('\n');
  navigator.clipboard.writeText(payload).then(() => {
    showToast('키워드와 제목을 복사했습니다.');
  }).catch(() => {
    showToast('클립보드 복사에 실패했습니다.');
  });
}

function applyResize() {
  const targetWidth = Math.max(1, Math.round(Number(widthInput.value) || state.sourceCanvas.width));
  const targetHeight = Math.max(1, Math.round(Number(heightInput.value) || state.sourceCanvas.height));
  const temp = document.createElement('canvas');
  temp.width = targetWidth;
  temp.height = targetHeight;
  const tempCtx = temp.getContext('2d');
  tempCtx.imageSmoothingEnabled = true;
  tempCtx.imageSmoothingQuality = 'high';
  tempCtx.drawImage(state.sourceCanvas, 0, 0, targetWidth, targetHeight);
  state.sourceCanvas.width = targetWidth;
  state.sourceCanvas.height = targetHeight;
  state.aspectRatio = targetWidth / targetHeight;
  getSourceContext().drawImage(temp, 0, 0, targetWidth, targetHeight);
  state.scale = 1;
  renderDisplay();
  showToast('리사이즈를 적용했습니다.');
}

function handleResizeInputs() {
  const widthValue = Number(widthInput.value) || state.sourceCanvas.width;
  if (ratioToggle?.checked) {
    const heightValue = Math.round(widthValue / state.aspectRatio);
    heightInput.value = String(Math.max(1, heightValue));
  }
  const newScale = widthValue / state.sourceCanvas.width;
  state.scale = clamp(newScale, 0.1, 5);
  renderDisplay();
}

function handleHeightInput() {
  const heightValue = Number(heightInput.value) || state.sourceCanvas.height;
  if (ratioToggle?.checked) {
    const widthValue = Math.round(heightValue * state.aspectRatio);
    widthInput.value = String(Math.max(1, widthValue));
  }
  const newScale = heightValue / state.sourceCanvas.height;
  state.scale = clamp(newScale, 0.1, 5);
  renderDisplay();
}

function pointerToCanvas(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

if (cropOverlay) {
  let isPointerDown = false;
  cropOverlay.addEventListener('pointerdown', (event) => {
    if (!state.manualCropActive) return;
    isPointerDown = true;
    cropOverlay.setPointerCapture(event.pointerId);
    const point = pointerToCanvas(event);
    state.manualCropStart = point;
    cropSelection.style.transform = `translate(${point.x}px, ${point.y}px)`;
    cropSelection.style.width = '0px';
    cropSelection.style.height = '0px';
  });

  cropOverlay.addEventListener('pointermove', (event) => {
    if (!state.manualCropActive || !isPointerDown) return;
    const current = pointerToCanvas(event);
    const start = state.manualCropStart || current;
    const minX = Math.min(start.x, current.x);
    const minY = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);
    cropSelection.style.transform = `translate(${minX}px, ${minY}px)`;
    cropSelection.style.width = `${width}px`;
    cropSelection.style.height = `${height}px`;
  });

  cropOverlay.addEventListener('pointerup', (event) => {
    if (!state.manualCropActive || !isPointerDown) return;
    isPointerDown = false;
    cropOverlay.releasePointerCapture(event.pointerId);
    const end = pointerToCanvas(event);
    applyManualCrop(state.manualCropStart, end);
    deactivateManualCrop();
  });
}

uploadArea?.addEventListener('dragenter', (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!ensureLoggedIn()) return;
  uploadArea.classList.add('is-dragging');
});

uploadArea?.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (!ensureLoggedIn()) return;
});

uploadArea?.addEventListener('dragleave', (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadArea.classList.remove('is-dragging');
});

uploadArea?.addEventListener('drop', (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadArea.classList.remove('is-dragging');
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    handleFile(file);
  }
});

fileInput?.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) {
    handleFile(file);
  }
});

resizeRange?.addEventListener('input', () => {
  state.scale = Number(resizeRange.value) / 100;
  renderDisplay();
});

widthInput?.addEventListener('input', debounce(handleResizeInputs, 150));
heightInput?.addEventListener('input', debounce(handleHeightInput, 150));
applyResizeButton?.addEventListener('click', () => {
  if (!ensureLoggedIn()) return;
  applyResize();
});

removeBgButton?.addEventListener('click', () => {
  if (!ensureLoggedIn()) return;
  removeBackground();
});

autoCropButton?.addEventListener('click', () => {
  if (!ensureLoggedIn()) return;
  autoCrop();
});

manualCropButton?.addEventListener('click', () => {
  activateManualCrop();
});

denoiseButton?.addEventListener('click', () => {
  if (!ensureLoggedIn()) return;
  denoise();
});

resetButton?.addEventListener('click', () => {
  if (!ensureLoggedIn()) return;
  resetEdits();
});

downloadPngButton?.addEventListener('click', downloadPNG);

requestSvgButton?.addEventListener('click', requestSvgConversion);

downloadSvgButton?.addEventListener('click', downloadSVG);

closeSvgButton?.addEventListener('click', () => {
  svgPanel.hidden = true;
  if (state.svgUrl) {
    URL.revokeObjectURL(state.svgUrl);
    state.svgUrl = null;
  }
});

analyzeButton?.addEventListener('click', analyzeKeywords);

copyKeywordsButton?.addEventListener('click', copyKeywords);
