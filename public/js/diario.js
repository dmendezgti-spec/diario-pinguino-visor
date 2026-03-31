import * as pdfjsLib from '/pdfjs/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.mjs';

const viewerDateElement = document.getElementById('viewer-fecha');
const downloadLinkElement = document.getElementById('viewer-download-link');
const viewerShellElement = document.getElementById('viewer-shell');
const viewerErrorElement = document.getElementById('viewer-error');
const viewerEditionNumberElement = document.getElementById('viewer-edition-number');
const viewerYearElement = document.getElementById('viewer-year');
const thumbsListElement = document.getElementById('thumbs-list');
const leftCanvasElement = document.getElementById('pdf-canvas-left');
const rightCanvasElement = document.getElementById('pdf-canvas-right');
const stageElement = document.getElementById('reader-stage');
const spreadElement = document.getElementById('pdf-spread');
const viewportElement = document.getElementById('pdf-viewport');
const flipWrapElement = document.getElementById('flip-wrap');
const flipFrontCanvas = document.getElementById('flip-front');
const flipBackCanvas = document.getElementById('flip-back');
const flipStaticCanvas = document.getElementById('flip-static');

const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const zoomOutButton = document.getElementById('zoom-out');
const zoomInButton = document.getElementById('zoom-in');
const fitWidthButton = document.getElementById('fit-width');
const pageIndicatorElement = document.getElementById('page-indicator');
const zoomIndicatorElement = document.getElementById('zoom-indicator');
const bottomPrevButton = document.getElementById('bottom-prev');
const bottomNextButton = document.getElementById('bottom-next');
const bottomPageLabelElement = document.getElementById('bottom-page-label');
const bottomPageRangeElement = document.getElementById('bottom-page-range');
const navLeftButton = document.getElementById('nav-left');
const navRightButton = document.getElementById('nav-right');
const readerLoadingElement = document.getElementById('reader-loading');
const fullscreenToggleButton = document.getElementById('fullscreen-toggle');
const searchQueryElement = document.getElementById('search-query');
const searchSubmitButton = document.getElementById('search-submit');
const searchPrevButton = document.getElementById('search-prev');
const searchNextButton = document.getElementById('search-next');
const searchStatusElement = document.getElementById('search-status');

let pdfDocument = null;
let currentPage = 1;
let currentScale = 1;
let isRendering = false;
const pageCache = new Map();
let activeDateSlug = '';
let searchIndex = [];
let searchMatches = [];
let currentMatchIndex = -1;
let telemetry = null;
let sessionStartedAt = 0;
let fitScale = 1;
let panX = 0;
let panY = 0;
let isPanDragging = false;
let panStartX = 0;
let panStartY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;
let centerAfterRender = false;
let isFlipping = false;

const leftCtx = leftCanvasElement.getContext('2d');
const rightCtx = rightCanvasElement.getContext('2d');

function extractDateSlugFromPath() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments.length >= 2 ? segments[1] : null;
}

function formatDateLabel(dateSlug) {
  const [day, month, year] = dateSlug.split('-');
  return `${day}/${month}/${year}`;
}

function parseDateSlug(dateSlug) {
  const [day, month, year] = dateSlug.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

function buildEditionNumber(date) {
  const number = String(getDayOfYear(date)).padStart(3, '0');
  return `N. Edicion ${number}`;
}

function getReadingStorageKey(dateSlug) {
  return `elpinguino:reader:${dateSlug}`;
}

function createTelemetrySnapshot() {
  return {
    opens: 0,
    pageTurns: 0,
    searches: 0,
    fullscreenEntries: 0,
    totalSeconds: 0,
    lastPage: 1,
    lastOpenedAt: ''
  };
}

function readTelemetry(dateSlug) {
  try {
    const raw = window.localStorage.getItem(getReadingStorageKey(dateSlug));
    if (!raw) {
      return createTelemetrySnapshot();
    }
    return { ...createTelemetrySnapshot(), ...JSON.parse(raw) };
  } catch {
    return createTelemetrySnapshot();
  }
}

function persistTelemetry() {
  if (!activeDateSlug || !telemetry) {
    return;
  }

  window.localStorage.setItem(getReadingStorageKey(activeDateSlug), JSON.stringify(telemetry));
}

function startReadingSession(dateSlug) {
  activeDateSlug = dateSlug;
  telemetry = readTelemetry(dateSlug);
  telemetry.opens += 1;
  telemetry.lastOpenedAt = new Date().toISOString();
  sessionStartedAt = Date.now();
  persistTelemetry();
}

function flushReadingSession() {
  if (!telemetry || !sessionStartedAt) {
    return;
  }

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - sessionStartedAt) / 1000));
  telemetry.totalSeconds += elapsedSeconds;
  sessionStartedAt = Date.now();
  persistTelemetry();
}

function rememberCurrentPage(pageNumber) {
  if (!telemetry) {
    return;
  }
  telemetry.lastPage = pageNumber;
  persistTelemetry();
}

function getPreferredInitialPage(dateSlug) {
  const pageFromUrl = getInitialPageFromUrl();
  if (pageFromUrl > 1) {
    return pageFromUrl;
  }

  const storedTelemetry = readTelemetry(dateSlug);
  return storedTelemetry.lastPage || 1;
}

function showLoading(visible) {
  if (visible) {
    readerLoadingElement.classList.remove('is-hidden');
  } else {
    readerLoadingElement.classList.add('is-hidden');
  }
}

function updateFullscreenButton() {
  const isFullscreen = document.fullscreenElement === viewerShellElement;
  fullscreenToggleButton.textContent = isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa';
}

async function toggleFullscreenMode() {
  if (document.fullscreenElement === viewerShellElement) {
    await document.exitFullscreen();
    return;
  }

  await viewerShellElement.requestFullscreen();
  if (telemetry) {
    telemetry.fullscreenEntries += 1;
    persistTelemetry();
  }
}

async function buildSearchIndex() {
  if (searchIndex.length > 0 || !pdfDocument) {
    return;
  }

  const items = [];
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await getPageCached(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => item.str).join(' ').toLowerCase();
    items.push({ pageNumber, text });
  }
  searchIndex = items;
}

async function runSearch() {
  const query = searchQueryElement.value.trim().toLowerCase();
  if (!query) {
    searchMatches = [];
    currentMatchIndex = -1;
    searchStatusElement.textContent = 'Sin busqueda';
    return;
  }

  searchStatusElement.textContent = 'Buscando...';
  await buildSearchIndex();
  searchMatches = searchIndex
    .filter((entry) => entry.text.includes(query))
    .map((entry) => entry.pageNumber);

  if (telemetry) {
    telemetry.searches += 1;
    persistTelemetry();
  }

  if (searchMatches.length === 0) {
    currentMatchIndex = -1;
    searchStatusElement.textContent = 'Sin coincidencias';
    return;
  }

  currentMatchIndex = 0;
  searchStatusElement.textContent = `${currentMatchIndex + 1} de ${searchMatches.length}`;
  renderPage(searchMatches[currentMatchIndex]);
}

function goToSearchMatch(direction) {
  if (searchMatches.length === 0) {
    return;
  }

  currentMatchIndex = (currentMatchIndex + direction + searchMatches.length) % searchMatches.length;
  searchStatusElement.textContent = `${currentMatchIndex + 1} de ${searchMatches.length}`;
  renderPage(searchMatches[currentMatchIndex]);
}

function isSpreadMode() {
  return window.innerWidth >= 1100 && pdfDocument && pdfDocument.numPages > 1;
}

function getInitialPageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get('page') || '1');
  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }
  return page;
}

function normalizePageForMode(page) {
  if (!pdfDocument) {
    return 1;
  }

  const bounded = Math.max(1, Math.min(pdfDocument.numPages, page));
  if (!isSpreadMode()) {
    return bounded;
  }

  if (bounded === 1) {
    return 1;
  }

  return bounded % 2 === 0 ? bounded : bounded - 1;
}

function getVisiblePages() {
  if (!pdfDocument) {
    return [];
  }

  if (!isSpreadMode()) {
    return [currentPage];
  }

  if (currentPage === 1) {
    return [1];
  }

  const pages = [currentPage];
  if (currentPage + 1 <= pdfDocument.numPages) {
    pages.push(currentPage + 1);
  }
  return pages;
}

function updateUrlPage(page) {
  const url = new URL(window.location.href);
  url.searchParams.set('page', String(page));
  window.history.replaceState({}, '', url);
}

function getDisplayPageLabel() {
  const visiblePages = getVisiblePages();
  if (visiblePages.length === 2) {
    return `Paginas ${visiblePages[0]}-${visiblePages[1]} / ${pdfDocument.numPages}`;
  }
  return `Pagina ${visiblePages[0]} / ${pdfDocument.numPages}`;
}

async function getPageCached(pageNumber) {
  if (!pageCache.has(pageNumber)) {
    pageCache.set(pageNumber, pdfDocument.getPage(pageNumber));
  }
  return pageCache.get(pageNumber);
}

function preloadAround(pageNumber) {
  if (!pdfDocument) {
    return;
  }

  for (let offset = -2; offset <= 4; offset += 1) {
    const candidate = pageNumber + offset;
    if (candidate >= 1 && candidate <= pdfDocument.numPages) {
      void getPageCached(candidate);
    }
  }
}

function getScaleForRender(pageViewportWidth, pageViewportHeight, isSinglePage = false) {
  const availableWidth = stageElement.clientWidth - 24;
  const availableHeight = stageElement.clientHeight - 24;
  const scaleByWidth = (isSpreadMode() && !isSinglePage)
    ? ((availableWidth / 2 - 8) / pageViewportWidth)
    : (availableWidth / pageViewportWidth);
  const scaleByHeight = pageViewportHeight > 0 ? availableHeight / pageViewportHeight : scaleByWidth;
  return Math.max(0.2, Math.min(4, Math.min(scaleByWidth, scaleByHeight)));
}

function updateControls() {
  if (!pdfDocument) {
    return;
  }

  prevPageButton.disabled = currentPage <= 1;
  nextPageButton.disabled = currentPage >= pdfDocument.numPages;
  bottomPrevButton.disabled = currentPage <= 1;
  bottomNextButton.disabled = currentPage >= pdfDocument.numPages;
  navLeftButton.disabled = currentPage <= 1;
  navRightButton.disabled = currentPage >= pdfDocument.numPages;
  pageIndicatorElement.textContent = getDisplayPageLabel();
  bottomPageLabelElement.textContent = getDisplayPageLabel();
  bottomPageRangeElement.max = String(pdfDocument.numPages);
  bottomPageRangeElement.value = String(currentPage);
  zoomIndicatorElement.textContent = `${Math.round(currentScale * 100)}%`;
  const bottomZoomRange = document.getElementById('bottom-zoom-range');
  if (bottomZoomRange) {
    bottomZoomRange.value = String(Math.round(currentScale * 100));
  }
  searchPrevButton.disabled = searchMatches.length === 0;
  searchNextButton.disabled = searchMatches.length === 0;
}

function setPanMode(_enabled) {
  // pan siempre activo via transform; mantenido por compatibilidad
}

function applyTransform() {
  if (isFlipping) {
    return;
  }

  viewportElement.style.transform = `translate(${panX}px, ${panY}px)`;
}

function clampPan() {
  const sw = stageElement.clientWidth;
  const sh = stageElement.clientHeight;
  const cw = viewportElement.offsetWidth;
  const ch = viewportElement.offsetHeight;
  panX = cw <= sw ? (sw - cw) / 2 : Math.min(16, Math.max(sw - cw - 16, panX));
  panY = ch <= sh ? (sh - ch) / 2 : Math.min(16, Math.max(sh - ch - 16, panY));
}

function centerSpreadInStage() {
  clampPan();
  applyTransform();
}

function getZoomAnchor(clientX, clientY) {
  const rect = stageElement.getBoundingClientRect();
  const cw = Math.max(1, viewportElement.offsetWidth);
  const ch = Math.max(1, viewportElement.offsetHeight);
  return {
    localX: clientX - rect.left,
    localY: clientY - rect.top,
    fx: (clientX - rect.left - panX) / cw,
    fy: (clientY - rect.top - panY) / ch
  };
}

function restoreZoomAnchor(anchor) {
  const cw = Math.max(1, viewportElement.offsetWidth);
  const ch = Math.max(1, viewportElement.offsetHeight);
  panX = anchor.localX - anchor.fx * cw;
  panY = anchor.localY - anchor.fy * ch;
  clampPan();
  applyTransform();
}

async function applyZoom(nextScale, anchor = null) {
  if (!pdfDocument) {
    return;
  }

  currentScale = Math.max(0.2, Math.min(4, nextScale));
  centerAfterRender = false;
  await renderPage(currentPage);
  if (anchor) {
    restoreZoomAnchor(anchor);
  } else {
    centerSpreadInStage();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFlipLeaf() {
  // no-op — flip leaf is no longer used
}

async function flipNavigate(targetPage, direction) {
  if (isFlipping || !pdfDocument) {
    return;
  }

  isFlipping = true;

  const SLIDE_MS = 280;
  const slideOffset = direction === 'next' ? -50 : 50; // Slide left for next, right for prev

  // Animate out
  spreadElement.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.4, 0.0, 0.2, 1), opacity ${SLIDE_MS}ms ease`;
  spreadElement.style.transform = `translateX(${slideOffset}px)`;
  spreadElement.style.opacity = '0';

  await sleep(SLIDE_MS);

  // Render new pages while hidden
  centerAfterRender = false;
  await renderPage(targetPage);
  clampPan();
  viewportElement.style.transform = `translate(${panX}px, ${panY}px)`;

  // Reset position to opposite side for animating in
  spreadElement.style.transition = 'none';
  spreadElement.style.transform = `translateX(${-slideOffset}px)`;

  // Force reflow
  spreadElement.offsetHeight;

  // Animate in
  spreadElement.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.4, 0.0, 0.2, 1), opacity ${SLIDE_MS}ms ease`;
  spreadElement.style.transform = 'translateX(0px)';
  spreadElement.style.opacity = '1';

  await sleep(SLIDE_MS);

  spreadElement.style.transition = '';
  spreadElement.style.transform = '';
  isFlipping = false;
}

async function renderCanvasPage({ canvas, context, pageNumber, scale }) {
  const page = await getPageCached(pageNumber);
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
}

async function renderPage(pageNumber) {
  if (!pdfDocument || isRendering) {
    return;
  }

  isRendering = true;

  try {
    const previousPage = currentPage;
    currentPage = normalizePageForMode(pageNumber);
    const visiblePages = getVisiblePages();
    const leadPage = await getPageCached(visiblePages[0]);
    const naturalViewport = leadPage.getViewport({ scale: 1 });
    fitScale = getScaleForRender(naturalViewport.width, naturalViewport.height, visiblePages.length === 1);

    if (currentScale <= 0) {
      currentScale = fitScale;
    }

    await renderCanvasPage({
      canvas: leftCanvasElement,
      context: leftCtx,
      pageNumber: visiblePages[0],
      scale: currentScale
    });

    if (visiblePages[1]) {
      rightCanvasElement.classList.remove('is-hidden');
      await renderCanvasPage({
        canvas: rightCanvasElement,
        context: rightCtx,
        pageNumber: visiblePages[1],
        scale: currentScale
      });
    } else {
      rightCanvasElement.classList.add('is-hidden');
    }

    spreadElement.dataset.mode = isSpreadMode() ? 'spread' : 'single';
    preloadAround(currentPage);
    updateUrlPage(currentPage);
    if (telemetry && previousPage !== currentPage) {
      telemetry.pageTurns += 1;
    }
    rememberCurrentPage(currentPage);
    if (centerAfterRender) {
      centerAfterRender = false;
      requestAnimationFrame(() => requestAnimationFrame(() => centerSpreadInStage()));
    } else {
      applyTransform();
    }
    updateControls();
    markActiveThumbnail(visiblePages);
  } finally {
    isRendering = false;
  }
}

function markActiveThumbnail(visiblePages) {
  const visibleSet = new Set(visiblePages);
  const items = thumbsListElement.querySelectorAll('.thumb-item');
  items.forEach((item) => {
    item.classList.toggle('is-active', visibleSet.has(Number(item.dataset.page)));
  });
}

async function renderThumbnailsProgressive() {
  thumbsListElement.innerHTML = '';
  const totalPages = pdfDocument.numPages;

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    // yield al navegador entre cada miniatura para no bloquear
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!pdfDocument) {
      return;
    }

    const page = await getPageCached(pageNumber);
    const viewport = page.getViewport({ scale: 0.18 });

    const wrapper = document.createElement('button');
    wrapper.type = 'button';
    wrapper.className = 'thumb-item';
    wrapper.dataset.page = String(pageNumber);

    const thumbCanvas = document.createElement('canvas');
    const thumbContext = thumbCanvas.getContext('2d');
    thumbCanvas.width = viewport.width;
    thumbCanvas.height = viewport.height;

    await page.render({ canvasContext: thumbContext, viewport }).promise;

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = `Pag. ${pageNumber}`;

    wrapper.appendChild(thumbCanvas);
    wrapper.appendChild(label);
    wrapper.addEventListener('click', () => renderPage(pageNumber));
    thumbsListElement.appendChild(wrapper);

    // marcar activa la miniatura recien creada si corresponde
    if (getVisiblePages().includes(pageNumber)) {
      wrapper.classList.add('is-active');
    }
  }
}

function applyFitPage() {
  if (!pdfDocument) {
    return;
  }

  getPageCached(currentPage).then((page) => {
    const naturalViewport = page.getViewport({ scale: 1 });
    currentScale = getScaleForRender(naturalViewport.width, naturalViewport.height);
    centerAfterRender = true;
    renderPage(currentPage);
  });
}

function goToPreviousPage() {
  if (!pdfDocument || currentPage <= 1 || isFlipping) {
    return;
  }

  // From page 2 (spread 2-3) go back to page 1 (single cover)
  // From page 4+ go back 2 pages to previous spread
  const step = isSpreadMode() && currentPage > 2 ? 2 : 1;
  void flipNavigate(currentPage - step, 'prev');
}

function goToNextPage() {
  if (!pdfDocument || currentPage >= pdfDocument.numPages || isFlipping) {
    return;
  }

  // From page 1 (single cover) go forward 1 to land on page 2 (spread 2-3)
  // From page 2+ go forward 2 pages to next spread
  const step = isSpreadMode() && currentPage >= 2 ? 2 : 1;
  void flipNavigate(currentPage + step, 'next');
}

function bindControls() {
  prevPageButton.addEventListener('click', goToPreviousPage);
  bottomPrevButton.addEventListener('click', goToPreviousPage);
  navLeftButton.addEventListener('click', goToPreviousPage);

  nextPageButton.addEventListener('click', goToNextPage);
  bottomNextButton.addEventListener('click', goToNextPage);
  navRightButton.addEventListener('click', goToNextPage);

  zoomOutButton.addEventListener('click', () => {
    void applyZoom(currentScale / 1.15);
  });

  zoomInButton.addEventListener('click', () => {
    void applyZoom(currentScale * 1.15);
  });

  const bottomZoomOutBtn = document.getElementById('bottom-zoom-out');
  const bottomZoomInBtn = document.getElementById('bottom-zoom-in');
  const bottomZoomRange = document.getElementById('bottom-zoom-range');

  bottomZoomOutBtn.addEventListener('click', () => {
    void applyZoom(currentScale / 1.15);
  });

  bottomZoomInBtn.addEventListener('click', () => {
    void applyZoom(currentScale * 1.15);
  });

  bottomZoomRange.addEventListener('input', () => {
    void applyZoom(Number(bottomZoomRange.value) / 100);
  });

  stageElement.addEventListener('dblclick', (event) => {
    if (!pdfDocument || isFlipping) {
      return;
    }
    const anchor = getZoomAnchor(event.clientX, event.clientY);
    const next = currentScale < fitScale * 1.8
      ? Math.min(currentScale * 2, 4)
      : fitScale;
    void applyZoom(next, anchor);
  });

  fitWidthButton.addEventListener('click', () => {
    applyFitPage();
  });

  stageElement.addEventListener('wheel', (event) => {
    // scroll reservado para el sistema
  }, { passive: true });

  stageElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    isPanDragging = true;
    panStartX = event.clientX;
    panStartY = event.clientY;
    panStartOffsetX = panX;
    panStartOffsetY = panY;
    stageElement.classList.add('is-panning');
    stageElement.setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    event.preventDefault();
  });

  window.addEventListener('pointermove', (event) => {
    if (!isPanDragging) {
      return;
    }

    panX = panStartOffsetX + (event.clientX - panStartX);
    panY = panStartOffsetY + (event.clientY - panStartY);
    clampPan();
    applyTransform();
    event.preventDefault();
  });

  function stopPanDrag() {
    if (!isPanDragging) {
      return;
    }

    isPanDragging = false;
    stageElement.classList.remove('is-panning');
    document.body.style.userSelect = '';
  }

  window.addEventListener('pointerup', stopPanDrag);
  window.addEventListener('pointercancel', stopPanDrag);

  bottomPageRangeElement.addEventListener('input', () => {
    const page = Number(bottomPageRangeElement.value);
    renderPage(page);
  });

  fullscreenToggleButton.addEventListener('click', () => {
    void toggleFullscreenMode();
  });

  const bottomDownloadLink = document.getElementById('bottom-download-link');
  const bottomFullscreenButton = document.getElementById('bottom-fullscreen');

  bottomFullscreenButton.addEventListener('click', () => {
    void toggleFullscreenMode();
  });

  searchSubmitButton.addEventListener('click', () => {
    void runSearch();
  });

  searchPrevButton.addEventListener('click', () => {
    goToSearchMatch(-1);
  });

  searchNextButton.addEventListener('click', () => {
    goToSearchMatch(1);
  });

  searchQueryElement.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void runSearch();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (!pdfDocument) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      goToPreviousPage();
    }

    if (event.key === 'ArrowRight') {
      goToNextPage();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    updateFullscreenButton();
    if (pdfDocument) {
      renderPage(currentPage);
    }
  });

  window.addEventListener('pagehide', flushReadingSession);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      flushReadingSession();
    }
  });

  window.addEventListener('resize', () => {
    if (pdfDocument) {
      centerAfterRender = true;
      renderPage(currentPage);
    }
  });
}

async function loadPdfDocument(pdfPath) {
  showLoading(true);

  const loadingTask = pdfjsLib.getDocument({ url: pdfPath });
  pdfDocument = await loadingTask.promise;
  currentScale = 1;
  currentPage = normalizePageForMode(getPreferredInitialPage(activeDateSlug));
  bottomPageRangeElement.max = String(pdfDocument.numPages);
  centerAfterRender = true;

  // Renderizar primera pagina inmediatamente
  await renderPage(currentPage);
  showLoading(false);
}

async function fetchEditionMeta(dateSlug) {
  const response = await fetch(`/api/ediciones/${dateSlug}`);
  if (!response.ok) {
    throw new Error('No fue posible obtener la metadata de la edicion.');
  }
  return response.json();
}

function showUnavailableEdition() {
  viewerShellElement.classList.add('hidden');
  viewerErrorElement.classList.remove('hidden');
}

function showViewer() {
  viewerErrorElement.classList.add('hidden');
  viewerShellElement.classList.remove('hidden');
}

(async function initDiaryViewer() {
  const urlParams = new URLSearchParams(window.location.search);
  const externalPdfUrl = urlParams.get('pdf');
  const dateSlug = extractDateSlugFromPath();

  if (externalPdfUrl) {
    if (viewerDateElement) {
      viewerDateElement.textContent = dateSlug
        ? `Edicion oficial: ${formatDateLabel(dateSlug)}`
        : `Visor de Ediciones`;
    }

    if (dateSlug) {
      const editionDate = parseDateSlug(dateSlug);
      startReadingSession(dateSlug);
      if (viewerEditionNumberElement) {
        viewerEditionNumberElement.textContent = buildEditionNumber(editionDate);
      }
      if (viewerYearElement) {
        viewerYearElement.textContent = `Ano editorial ${editionDate.getFullYear()}`;
      }
    } else {
      if (viewerEditionNumberElement) viewerEditionNumberElement.textContent = 'Documento Externo';
      if (viewerYearElement) viewerYearElement.textContent = '';
    }

    if (downloadLinkElement) {
      downloadLinkElement.href = externalPdfUrl;
    }
    const bottomDownloadLink = document.getElementById('bottom-download-link');
    if (bottomDownloadLink) {
      bottomDownloadLink.href = externalPdfUrl;
    }

    bindControls();
    updateFullscreenButton();
    showViewer();

    try {
      await loadPdfDocument(externalPdfUrl);
      updateControls();
    } catch (err) {
      console.error('Error cargando PDF remoto:', err);
      showUnavailableEdition();
    }
    return;
  }

  // --- Modo Local ---
  if (!dateSlug) {
    showUnavailableEdition();
    return;
  }

  if (viewerDateElement) {
    viewerDateElement.textContent = `Edicion oficial: ${formatDateLabel(dateSlug)}`;
  }

  const editionDate = parseDateSlug(dateSlug);
  startReadingSession(dateSlug);

  if (viewerEditionNumberElement) {
    viewerEditionNumberElement.textContent = buildEditionNumber(editionDate);
  }

  if (viewerYearElement) {
    viewerYearElement.textContent = `Ano editorial ${editionDate.getFullYear()}`;
  }

  try {
    const meta = await fetchEditionMeta(dateSlug);

    if (!meta.disponible || !meta.pdfPath) {
      showUnavailableEdition();
      return;
    }

    if (downloadLinkElement) {
      downloadLinkElement.href = meta.pdfPath;
    }

    const bottomDownloadLink = document.getElementById('bottom-download-link');
    if (bottomDownloadLink) {
      bottomDownloadLink.href = meta.pdfPath;
    }

    bindControls();
    updateFullscreenButton();
    showViewer();
    await loadPdfDocument(meta.pdfPath);
    updateControls();
  } catch (error) {
    console.error(error);
    showUnavailableEdition();
  }
})();
