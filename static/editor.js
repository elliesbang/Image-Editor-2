(function () {
  const MAX_FILES = 50;
  const state = {
    items: []
  };

  const galleryGrid = () => document.querySelector('[data-gallery]');
  const dropzone = () => document.querySelector('[data-dropzone]');
  const resizeInput = () => document.querySelector('[data-resize-width]');

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getPipelineConfig() {
    const config = {
      removeBackground: !!document.querySelector('[data-step="remove-bg"]:checked'),
      tightCrop: !!document.querySelector('[data-step="tight-crop"]:checked'),
      denoise: !!document.querySelector('[data-step="denoise"]:checked'),
      resize: true,
      resizeWidth: parseInt(resizeInput()?.value || '1024', 10),
      svg: !!document.querySelector('[data-step="svg"]:checked')
    };
    if (!Number.isFinite(config.resizeWidth) || config.resizeWidth <= 0) {
      config.resizeWidth = 1024;
    }
    return config;
  }

  function canvasFromImage(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return canvas;
  }

  function cloneCanvas(source) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(source, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    return canvas;
  }

  function removeBackground(source) {
    const canvas = cloneCanvas(source);
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const { data } = imageData;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const brightness = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (a > 0 && brightness > 245 && spread < 26) {
        data[i + 3] = 0;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function tightCrop(source) {
    const ctx = source.getContext('2d');
    const { width, height } = source;
    const imageData = ctx.getImageData(0, 0, width, height);
    const { data } = imageData;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let hasAlpha = false;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const alpha = data[index + 3];
        if (alpha > 10) {
          hasAlpha = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!hasAlpha) {
      return source;
    }

    const cropWidth = maxX - minX + 1;
    const cropHeight = maxY - minY + 1;
    const canvas = document.createElement('canvas');
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const context = canvas.getContext('2d');
    context.globalCompositeOperation = 'copy';
    context.drawImage(source, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    context.globalCompositeOperation = 'source-over';
    return canvas;
  }

  function reduceNoise(source) {
    const canvas = cloneCanvas(source);
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imageData = ctx.getImageData(0, 0, width, height);
    const { data } = imageData;
    const output = ctx.createImageData(width, height);

    const offsets = [-1, 0, 1];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let count = 0;

        offsets.forEach((dy) => {
          const yy = y + dy;
          if (yy < 0 || yy >= height) return;
          offsets.forEach((dx) => {
            const xx = x + dx;
            if (xx < 0 || xx >= width) return;
            const index = (yy * width + xx) * 4;
            r += data[index];
            g += data[index + 1];
            b += data[index + 2];
            a += data[index + 3];
            count += 1;
          });
        });

        const index = (y * width + x) * 4;
        output.data[index] = r / count;
        output.data[index + 1] = g / count;
        output.data[index + 2] = b / count;
        output.data[index + 3] = a / count;
      }
    }

    ctx.putImageData(output, 0, 0);
    return canvas;
  }

  function resizeToWidth(source, width) {
    if (!width || width <= 0 || width === source.width) {
      return source;
    }
    const scale = width / source.width;
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(source, 0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    return canvas;
  }

  function generateSVGFromCanvas(canvas) {
    try {
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (window.ImageTracer && typeof window.ImageTracer.imageDataToSVG === 'function') {
        return window.ImageTracer.imageDataToSVG(imageData, { scale: 1, ltres: 1, qtres: 1, numberofcolors: 16 });
      }
    } catch (error) {
      console.warn('[editor] SVG conversion failed', error);
    }
    const dataUrl = canvas.toDataURL('image/png');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}"><image href="${dataUrl}" width="${canvas.width}" height="${canvas.height}"/></svg>`;
  }

  function renderGalleryItem(item) {
    const grid = galleryGrid();
    const card = document.createElement('article');
    card.className = 'gallery-card';
    card.dataset.itemId = item.id;
    card.innerHTML = `
      <canvas data-preview width="${item.originalCanvas.width}" height="${item.originalCanvas.height}"></canvas>
      <footer>
        <div>
          <strong data-name>${item.file.name}</strong>
          <div class="badge-row">
            <span class="badge" data-dimensions>${item.originalCanvas.width}×${item.originalCanvas.height}</span>
            <span class="badge hidden" data-svg-indicator>SVG 변환</span>
          </div>
        </div>
        <label>
          <input type="checkbox" data-select-item checked>
          선택
        </label>
      </footer>
    `;
    const checkbox = card.querySelector('[data-select-item]');
    checkbox.addEventListener('change', (event) => {
      item.selected = event.currentTarget.checked;
    });

    grid.appendChild(card);
    item.element = card;
    item.canvas = card.querySelector('[data-preview]');
  }

  function updateCardMeta(item) {
    if (!item.element) return;
    const badge = item.element.querySelector('[data-dimensions]');
    if (badge) {
      badge.textContent = `${item.canvas.width}×${item.canvas.height}`;
    }
    const svgIndicator = item.element.querySelector('[data-svg-indicator]');
    if (svgIndicator) {
      svgIndicator.classList.toggle('hidden', !item.svgContent);
    }
  }

  function safeName(name) {
    return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
  }

  function applyOperations(item, config) {
    let working = cloneCanvas(item.originalCanvas);
    if (config.removeBackground) {
      working = removeBackground(working);
    }
    if (config.tightCrop) {
      working = tightCrop(working);
    }
    if (config.denoise) {
      working = reduceNoise(working);
    }
    if (config.resize && config.resizeWidth) {
      working = resizeToWidth(working, config.resizeWidth);
    }

    item.canvas.width = working.width;
    item.canvas.height = working.height;
    const ctx = item.canvas.getContext('2d');
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(working, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    if (config.svg) {
      item.svgContent = generateSVGFromCanvas(working);
    } else {
      item.svgContent = null;
    }

    updateCardMeta(item);
  }

  function applyToAllItems(reason = 'auto') {
    if (!state.items.length) return;
    const config = getPipelineConfig();
    state.items.forEach((item) => applyOperations(item, config));
    if (reason === 'manual') {
      deductCredits(state.items.length);
      window.ElliesApp?.showToast('선택한 파이프라인이 모든 이미지에 적용되었습니다.', 'info');
    }
  }

  function deductCredits(count) {
    if (!window.ElliesApp) return;
    const session = window.ElliesApp.getSession?.();
    if (!session) return;
    const current = window.ElliesApp.getCredits?.();
    if (typeof current !== 'number') {
      window.ElliesApp.setCredits(Math.max(0, 30 - count));
    } else {
      window.ElliesApp.adjustCredits(-Math.min(current, count));
    }
  }

  function addItemsFromFiles(files) {
    const incoming = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!incoming.length) {
      window.ElliesApp?.showToast('업로드 가능한 이미지가 없습니다.', 'warning');
      return;
    }

    const availableSlots = MAX_FILES - state.items.length;
    if (incoming.length > availableSlots) {
      window.ElliesApp?.showToast(`최대 ${MAX_FILES}장까지 업로드할 수 있습니다. ${availableSlots}장만 추가됩니다.`, 'warning');
    }

    incoming.slice(0, availableSlots).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const originalCanvas = canvasFromImage(image);
          const item = {
            id: createId(),
            file,
            originalCanvas,
            selected: true,
            svgContent: null
          };
          state.items.push(item);
          renderGalleryItem(item);
          applyOperations(item, getPipelineConfig());
          deductCredits(1);
        };
        image.onerror = () => {
          window.ElliesApp?.showToast(`${file.name}을(를) 불러오지 못했습니다.`, 'danger');
        };
        image.src = reader.result;
      };
      reader.onerror = () => {
        window.ElliesApp?.showToast(`${file.name} 파일을 읽을 수 없습니다.`, 'danger');
      };
      reader.readAsDataURL(file);
    });
  }

  function updateSelectedCount() {
    const selected = state.items.filter((item) => item.selected);
    const badge = document.querySelector('[data-selected-count]');
    if (badge) {
      badge.textContent = `${selected.length}개 선택됨`;
    }
    return selected;
  }

  function handleDrop(event) {
    event.preventDefault();
    dropzone()?.classList.remove('dragover');
    const files = event.dataTransfer?.files;
    if (files) {
      addItemsFromFiles(files);
      updateSelectedCount();
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
    dropzone()?.classList.add('dragover');
  }

  function handleDragLeave(event) {
    event.preventDefault();
    dropzone()?.classList.remove('dragover');
  }

  function downloadData(name, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function downloadSingle() {
    const selected = state.items.filter((item) => item.selected);
    const target = selected[0] || state.items[0];
    if (!target) {
      window.ElliesApp?.showToast('다운로드할 이미지를 선택해 주세요.', 'warning');
      return;
    }

    const dataUrl = target.canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const len = binary.length;
    const buffer = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      buffer[i] = binary.charCodeAt(i);
    }
    downloadData(`${safeName(target.file.name.replace(/\.[^.]+$/, ''))}.png`, new Blob([buffer], { type: 'image/png' }));
  }

  async function downloadZip({ onlySelected } = { onlySelected: false }) {
    if (typeof JSZip === 'undefined') {
      window.ElliesApp?.showToast('ZIP 라이브러리가 로드되지 않았습니다.', 'danger');
      return;
    }

    const items = onlySelected ? state.items.filter((item) => item.selected) : state.items;
    if (!items.length) {
      window.ElliesApp?.showToast('내보낼 이미지가 없습니다.', 'warning');
      return;
    }

    const zip = new JSZip();
    const imagesFolder = zip.folder('images');
    const vectorsFolder = zip.folder('vectors');

    items.forEach((item) => {
      const baseName = safeName(item.file.name.replace(/\.[^.]+$/, ''));
      const dataUrl = item.canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      imagesFolder.file(`${baseName}.png`, base64, { base64: true });
      if (item.svgContent) {
        vectorsFolder.file(`${baseName}.svg`, item.svgContent);
      }
    });

    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadData(`ellies-editor-${onlySelected ? 'selected' : 'all'}.zip`, blob);
    } catch (error) {
      console.warn('[editor] ZIP generation failed', error);
      window.ElliesApp?.showToast('ZIP 파일을 생성하지 못했습니다.', 'danger');
    }
  }

  function wireGalleryObserver() {
    const observer = new MutationObserver(() => {
      updateSelectedCount();
    });
    const grid = galleryGrid();
    if (grid) {
      observer.observe(grid, { childList: true, subtree: true });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.querySelector('[data-upload]');
    fileInput?.addEventListener('change', (event) => {
      if (event.target.files) {
        addItemsFromFiles(event.target.files);
        updateSelectedCount();
        event.target.value = '';
      }
    });

    const zone = dropzone();
    zone?.addEventListener('drop', handleDrop);
    zone?.addEventListener('dragover', handleDragOver);
    zone?.addEventListener('dragleave', handleDragLeave);
    zone?.addEventListener('dragend', handleDragLeave);

    document.querySelectorAll('[data-step]').forEach((element) => {
      element.addEventListener('change', () => applyToAllItems('auto'));
    });

    resizeInput()?.addEventListener('change', () => applyToAllItems('auto'));
    resizeInput()?.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') {
        applyToAllItems('manual');
      }
    });

    document.querySelector('[data-action="apply-all"]')?.addEventListener('click', () => applyToAllItems('manual'));
    document.querySelector('[data-action="download-one"]')?.addEventListener('click', downloadSingle);
    document.querySelector('[data-action="download-selected"]')?.addEventListener('click', () => downloadZip({ onlySelected: true }));
    document.querySelector('[data-action="download-all"]')?.addEventListener('click', () => downloadZip({ onlySelected: false }));

    document.addEventListener('change', (event) => {
      if (event.target.matches('[data-select-item]')) {
        updateSelectedCount();
      }
    });

    wireGalleryObserver();
  });
})();
