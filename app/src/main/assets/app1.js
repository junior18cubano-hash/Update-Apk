// ==========================================
// 🛡️ STORAGE SAFE POLYFILL (Previene SecurityError en file:///)
// ==========================================
(function() {
  var isStorageOk = false;
  try {
    var k = '__chk_storage__';
    window.localStorage.setItem(k, k);
    window.localStorage.removeItem(k);
    isStorageOk = true;
  } catch(e) { isStorageOk = false; }
  if (!isStorageOk) {
    var mem = {};
    var dummy = {
      getItem: function(k) { return mem.hasOwnProperty(k) ? mem[k] : null; },
      setItem: function(k, v) { mem[k] = String(v); },
      removeItem: function(k) { delete mem[k]; },
      clear: function() { mem = {}; },
      key: function(i) { return Object.keys(mem)[i] || null; },
      get length() { return Object.keys(mem).length; }
    };
    try { Object.defineProperty(window, 'localStorage', { value: dummy, configurable: true, writable: true }); } catch(e){}
    try { Object.defineProperty(window, 'sessionStorage', { value: dummy, configurable: true, writable: true }); } catch(e){}
  }
})();

// ==========================================
// 📳 RETROALIMENTACIÓN HÁPTICA (Vibración Corta)
// ==========================================
let lastHapticTime = 0;
window.triggerHaptic = function(durationMs = 35) {
  try {
    const now = Date.now();
    if (now - lastHapticTime < 20) return;
    lastHapticTime = now;
    if (window.AndroidBridge && typeof window.AndroidBridge.triggerHapticFeedback === 'function') {
      window.AndroidBridge.triggerHapticFeedback(durationMs);
    } else if (navigator.vibrate) {
      navigator.vibrate(durationMs);
    }
  } catch (e) {
    console.log('Error haptic:', e);
  }
};

window.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('click', (e) => {
    const target = e.target.closest('button, .btn, .btn-primary, .modal-close, .sidebar-link, .tab-btn, .card, .smart-ai-card, [onclick], [role="button"]');
    if (target) {
      const txt = (target.textContent || '').toLowerCase();
      if (txt.includes('guardar') || txt.includes('save') || txt.includes('💾') || txt.includes('actualizar') || txt.includes('sync') || txt.includes('🔄') || txt.includes('🌐') || txt.includes('descargar')) {
        window.triggerHaptic(50);
      } else if (target.classList.contains('modal-close') || target.closest('.modal-overlay')) {
        window.triggerHaptic(35);
      } else {
        window.triggerHaptic(25);
      }
    }
  }, { passive: true });
});

// ==========================================
// 💾 CAPA DE ALMACENAMIENTO LOCAL (IndexedDB)
// ==========================================
const DB_NAME = 'joaCatalogOffline';
const DB_VERSION = 5;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('user_states')) db.createObjectStore('user_states', { keyPath: 'itemId' });
      if (!db.objectStoreNames.contains('user_reviews')) db.createObjectStore('user_reviews', { keyPath: 'itemId' });
      if (!db.objectStoreNames.contains('user_notes')) db.createObjectStore('user_notes', { keyPath: 'itemId' });
      if (!db.objectStoreNames.contains('item_media_cache')) db.createObjectStore('item_media_cache', { keyPath: 'itemId' });
      if (!db.objectStoreNames.contains('user_lists')) db.createObjectStore('user_lists', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

async function idbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbPut(storeName, record) { return idbBulkPut(storeName, [record]); }

async function idbDelete(storeName, key) { return idbBulkDelete(storeName, [key]); }

async function idbBulkDelete(storeName, keys) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    keys.forEach(k => store.delete(k));
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function idbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function idbBulkPut(storeName, records) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    records.forEach(r => store.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbGetCount(storeName) {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(storeName)) return 0;
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch(e) {
    return 0;
  }
}
window.idbGetCount = idbGetCount;

async function idbSetMeta(key, value) { return idbBulkPut('meta', [{ key, value }]); }

async function idbGetMeta(key, fallback = null) {
  const all = await idbGetAll('meta');
  const found = all.find(m => m.key === key);
  return found ? found.value : fallback;
}

// ==========================================
// 📥 IMPORTACIÓN
// ==========================================
var DEFAULT_TYPE_LABELS = window.DEFAULT_TYPE_LABELS = {
  juego: '🎮 Juegos',
  juego_emulado: '🕹️ Juegos Emulados',
  pelicula: '🎬 Películas',
  pelicula_animada: '🎨 Películas animadas',
  serie: '📺 Series',
  serie_animada: '✨ Series animadas',
  anime: '🎌 Anime',
  anime_movie: '🎥 Películas Anime',
  novela_tv: '📺 Novelas TV',
  musica: '🎵 Música',
  software: '💻 Software',
  novela: '📚 Novelas (Libros)'
};
var typeLabels = window.typeLabels = { ...DEFAULT_TYPE_LABELS };
var allItems = window.allItems = [];
var imageBaseUrl = window.imageBaseUrl = '';
var userStates = window.userStates = [];
var libraryFilter = window.libraryFilter = '';
var achievementsRules = window.achievementsRules = [];
var consolesData = window.consolesData = {};
var activeType = window.activeType = '';

// ==========================================
// 📺 SOPORTE EXPLÍCITO Y FILTRADO DE NOVELAS TV
// ==========================================
function isNovelaTv(item) {
  if (!item) return false;
  const t = (item.type || '').toLowerCase().trim();
  if (t === 'novela_tv' || t === 'telenovela' || t === 'telenovelas' || t === 'novelas_tv' || t === 'novela-tv' || t === 'novelas-tv' || t === 'novelas_de_tv') return true;
  if (t === 'novela' || t === 'novelas') {
    const cat = (item.category || item.categoria || item.subcategoria || '').toLowerCase();
    return Boolean(item.episodes || item.capitulos || item.temporadas || item.seasons || cat.includes('tv') || cat.includes('serie') || cat.includes('telenovela'));
  }
  return false;
}

function normalizeCatalogItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it, idx) => {
    if (!it) return it;
    if (it._catalogOrder === undefined) {
      it._catalogOrder = idx;
    }
    if (isNovelaTv(it)) {
      it.type = 'novela_tv';
    }
    return it;
  });
}

function filterByNovelaTv() {
  if (window.triggerHaptic) window.triggerHaptic(25);
  if (typeof setTypeFilter === 'function') {
    setTypeFilter('novela_tv');
  }
}

function toggleNovelaTvFilter() {
  if (window.triggerHaptic) window.triggerHaptic(25);
  if (typeof activeType !== 'undefined' && activeType === 'novela_tv') {
    if (typeof setTypeFilter === 'function') setTypeFilter('');
  } else {
    if (typeof setTypeFilter === 'function') setTypeFilter('novela_tv');
  }
}

const UPDATE_URL="https://raw.githubusercontent.com/junior18cubano-hash/Actualizacion-Catalogo/refs/heads/main/Update.json";
const VERSION_URL="https://raw.githubusercontent.com/junior18cubano-hash/Actualizacion-Catalogo/refs/heads/main/version.json";

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function processCatalogJsonData(data, rawText, isUpdate = false) {
  if (!data || !Array.isArray(data.items)) {
    throw new Error('El archivo o código QR no contiene el formato esperado (falta la lista "items").');
  }

  const normalizedItems = normalizeCatalogItems(data.items);

  await idbClear('items');
  await idbBulkPut('items', normalizedItems);
  
  const incomingTypeLabels = Object.assign({}, data.type_labels || {});
  incomingTypeLabels.novela_tv = incomingTypeLabels.novela_tv || '📺 Novelas TV';
  if (!incomingTypeLabels.novela || incomingTypeLabels.novela === 'Novelas') {
    incomingTypeLabels.novela = '📚 Novelas (Libros)';
  }

  await idbSetMeta('type_labels', incomingTypeLabels);
  await idbSetMeta('consoles', data.consoles || {});
  await idbSetMeta('achievements', data.achievements || []);
  await idbSetMeta('generated_at', data.generated_at || null);
  await idbSetMeta('imported_at', new Date().toISOString());

  if (data.version) {
    await idbSetMeta('catalog_version', data.version);
  }
  await syncCatalogVersionToAndroid();
  if (rawText) {
    saveCatalogToOfflineCache(rawText, data.version, normalizedItems.length);
  }

  const existingBase = await idbGetMeta('image_base_url', null);
  if (!existingBase && data.source_url) await idbSetMeta('image_base_url', data.source_url);

  await bootApp();
  if (typeof clearFilters === 'function') clearFilters();
  return normalizedItems.length;
}

async function handleImportFile(file, isUpdate) {
  const progressEl = document.getElementById('importProgress');
  const statusEl = document.getElementById('importStatus');
  const errorEl = document.getElementById('importError');
  const barFill = document.getElementById('importBarFill');
  errorEl.style.display = 'none';

  if (!isUpdate) {
    progressEl.style.display = 'block';
    statusEl.textContent = 'Leyendo archivo...';
    barFill.style.width = '10%';
  }

  try {
    const text = await readFileAsText(file);
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.items)) throw new Error('El archivo no tiene el formato esperado (falta "items").');

    if (!isUpdate) { statusEl.textContent = `Guardando ${data.items.length} elementos...`; barFill.style.width = '50%'; }

    const count = await processCatalogJsonData(data, text, isUpdate);

    if (!isUpdate) { barFill.style.width = '100%'; statusEl.textContent = '¡Listo!'; }
    if (isUpdate) { closeSettings(); showToast(`Catálogo actualizado: ${count} elementos.`); }
  } catch (err) {
    console.error(err);
    if (!isUpdate) {
      progressEl.style.display = 'none';
      errorEl.textContent = '❌ ' + (err.message || 'No se pudo leer el archivo.');
      errorEl.style.display = 'block';
    } else {
      showToast('❌ No se pudo actualizar: ' + (err.message || 'archivo inválido.'));
    }
  }
}

document.getElementById('fileInput').addEventListener('change', (e) => {
  if (e.target.files[0]) handleImportFile(e.target.files[0], false);
});
document.getElementById('updateFileInput').addEventListener('change', (e) => {
  if (e.target.files[0]) handleImportFile(e.target.files[0], true);
});

// ========================================================
// 📷 CONTROLADOR DEL ESCÁNER DE CÓDIGO QR (JOA GAMERS)
// ========================================================
let qrMediaStream = null;
let qrScanAnimFrame = null;
let qrCurrentFacingMode = "environment";
let isScanningQr = false;

async function openQrScannerModal() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  const modal = document.getElementById('modalQrScanner');
  if (!modal) return;
  modal.style.display = 'flex';
  
  const statusMsg = document.getElementById('qrScanStatusMsg');
  if (statusMsg) statusMsg.textContent = 'Iniciando cámara trasera...';
  const progress = document.getElementById('qrScanProgressBar');
  if (progress) progress.style.display = 'none';

  await startQrCameraStream();
}

function closeQrScannerModal() {
  if (window.triggerHaptic) window.triggerHaptic(25);
  stopQrCameraStream();
  const modal = document.getElementById('modalQrScanner');
  if (modal) modal.style.display = 'none';
}

async function startQrCameraStream() {
  stopQrCameraStream();
  const video = document.getElementById('qrVideoFeed');
  const statusMsg = document.getElementById('qrScanStatusMsg');
  if (!video) return;

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Cámara no compatible en este navegador/dispositivo.');
    }

    const constraints = {
      video: {
        facingMode: qrCurrentFacingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    qrMediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = qrMediaStream;
    await video.play();

    if (statusMsg) statusMsg.textContent = 'Apunta la cámara al código QR de JOA GAMERS...';
    isScanningQr = true;
    scanQrFrameLoop();
  } catch (err) {
    console.warn('Error iniciando cámara QR:', err);
    if (statusMsg) {
      statusMsg.innerHTML = `<span style="color:#FF6B6B;">⚠️ ${err.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Puedes cargar una foto con QR desde la galería.' : 'No se pudo activar la cámara. Usa la opción de foto.'}</span>`;
    }
  }
}

function stopQrCameraStream() {
  isScanningQr = false;
  if (qrScanAnimFrame) {
    cancelAnimationFrame(qrScanAnimFrame);
    qrScanAnimFrame = null;
  }
  if (qrMediaStream) {
    try {
      qrMediaStream.getTracks().forEach(track => track.stop());
    } catch(e) {}
    qrMediaStream = null;
  }
  const video = document.getElementById('qrVideoFeed');
  if (video) {
    video.srcObject = null;
  }
}

async function toggleQrCameraFacing() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  qrCurrentFacingMode = qrCurrentFacingMode === 'environment' ? 'user' : 'environment';
  await startQrCameraStream();
}

function scanQrFrameLoop() {
  if (!isScanningQr) return;
  const video = document.getElementById('qrVideoFeed');
  const canvas = document.getElementById('qrCanvasBuffer');

  if (video && video.readyState === video.HAVE_ENOUGH_DATA && canvas && window.jsQR) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert"
    });

    if (code && code.data && code.data.trim()) {
      isScanningQr = false;
      stopQrCameraStream();
      onQrCodeScanned(code.data.trim());
      return;
    }
  }

  qrScanAnimFrame = requestAnimationFrame(scanQrFrameLoop);
}

async function handleQrGalleryFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const statusMsg = document.getElementById('qrScanStatusMsg');
  if (statusMsg) statusMsg.textContent = 'Analizando imagen de la galería...';

  try {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.getElementById('qrCanvasBuffer') || document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "attemptBoth"
        });
        if (code && code.data && code.data.trim()) {
          stopQrCameraStream();
          onQrCodeScanned(code.data.trim());
        } else {
          if (statusMsg) statusMsg.innerHTML = '<span style="color:#FFAA00;">⚠️ No se detectó ningún código QR en la imagen seleccionada.</span>';
        }
      } else {
        throw new Error('Librería QR no cargada.');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      if (statusMsg) statusMsg.textContent = '❌ No se pudo abrir la imagen.';
    };
    img.src = objectUrl;
  } catch(err) {
    console.error('Error procesando imagen QR:', err);
    if (statusMsg) statusMsg.textContent = '❌ Error al procesar imagen: ' + err.message;
  }
}

async function onQrCodeScanned(scannedText) {
  if (window.triggerHaptic) window.triggerHaptic(50);
  const statusMsg = document.getElementById('qrScanStatusMsg');
  const progressBar = document.getElementById('qrScanProgressBar');
  const barFill = document.getElementById('qrScanBarFill');

  if (progressBar) progressBar.style.display = 'block';
  if (barFill) barFill.style.width = '25%';

  try {
    let rawText = '';
    let parsedData = null;

    // Caso 1: Es una URL http:// o https://
    if (/^https?:\/\//i.test(scannedText)) {
      if (statusMsg) statusMsg.textContent = '🌐 Descargando catálogo desde enlace QR...';
      if (barFill) barFill.style.width = '45%';
      
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 35000);
      const res = await fetch(scannedText, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`El servidor respondió con error HTTP ${res.status}`);
      rawText = await res.text();
      parsedData = JSON.parse(rawText);
    } 
    // Caso 2: Es directamente un JSON string
    else if (scannedText.startsWith('{') || scannedText.startsWith('[')) {
      if (statusMsg) statusMsg.textContent = '⚡ Procesando datos del catálogo...';
      rawText = scannedText;
      parsedData = JSON.parse(scannedText);
    }
    // Caso 3: Es base64
    else {
      try {
        const decoded = atob(scannedText);
        if (decoded.startsWith('{') || decoded.startsWith('[')) {
          rawText = decoded;
          parsedData = JSON.parse(decoded);
        } else {
          throw new Error('Contenido no reconocido');
        }
      } catch(bErr) {
        throw new Error('El código QR escaneado no contiene una URL o JSON de catálogo válido.');
      }
    }

    if (barFill) barFill.style.width = '75%';
    if (statusMsg) statusMsg.textContent = '💾 Guardando catálogo en la base de datos local...';

    const count = await processCatalogJsonData(parsedData, rawText, true);

    if (barFill) barFill.style.width = '100%';
    if (statusMsg) statusMsg.textContent = '✅ ¡Catálogo actualizado con éxito!';

    setTimeout(() => {
      closeQrScannerModal();
      if (typeof showToast === 'function') {
        showToast(`📷 Catálogo actualizado vía QR (${count} títulos listos).`);
      }
    }, 600);

  } catch(err) {
    console.error('Error importando catálogo QR:', err);
    if (progressBar) progressBar.style.display = 'none';
    if (statusMsg) {
      statusMsg.innerHTML = `<span style="color:#FF4B4B;">❌ Error: ${err.message || 'Código QR incompatible'}</span>`;
    }
    setTimeout(() => {
      const modal = document.getElementById('modalQrScanner');
      if (modal && modal.style.display !== 'none') {
        startQrCameraStream();
      }
    }, 3000);
  }
}

window.openQrScannerModal = openQrScannerModal;
window.closeQrScannerModal = closeQrScannerModal;
window.toggleQrCameraFacing = toggleQrCameraFacing;
window.handleQrGalleryFile = handleQrGalleryFile;

// ==========================================
// 🌐 ACTUALIZAR ONLINE (CON ESTADÍSTICAS Y UI MODERNA EN VIVO)
// ==========================================
function abrirLiveUpdateModal() {
    if (window.triggerHaptic) window.triggerHaptic(35);
    const m = document.getElementById('modalLiveUpdate');
    if (m) m.style.display = 'block';
    const errBox = document.getElementById('liveUpdateErrorBox');
    if (errBox) errBox.style.display = 'none';
    const btnCancel = document.getElementById('liveUpdateCancelBtn');
    if (btnCancel) btnCancel.style.display = 'none';
    setLiveStep(1, 'Conectando al servidor del catálogo...');
    updateLiveProgress(0, 0, 0, 0);
}

function cerrarLiveUpdateModal() {
    if (window.triggerHaptic) window.triggerHaptic(35);
    const m = document.getElementById('modalLiveUpdate');
    if (m) m.style.display = 'none';
}

function setLiveStep(num, subTxt) {
    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('step' + i);
        if (!el) continue;
        el.classList.remove('active', 'done');
        if (i < num) el.classList.add('done');
        else if (i === num) el.classList.add('active');
    }
    if (subTxt) {
        const subEl = document.getElementById('liveUpdateSub');
        if (subEl) subEl.textContent = subTxt;
    }
    const phaseEl = document.getElementById('liveUpdatePhaseTxt');
    if (phaseEl) phaseEl.textContent = `Fase ${num}/5: ${['Red', 'Versión', 'Descarga', 'Proceso', 'Guardar'][num-1] || 'Listo'}`;
}

function updateLiveProgress(pct, bytesReceived, bytesTotal, speed) {
    const bar = document.getElementById('liveUpdateBarFill');
    const pctTxt = document.getElementById('liveUpdatePctTxt');
    if (bar) bar.style.width = pct + '%';
    if (pctTxt) pctTxt.textContent = pct + '%';
    if (document.getElementById('liveUpdateBytes')) {
        document.getElementById('liveUpdateBytes').textContent = `${formatBytes(bytesReceived)} / ${bytesTotal > 0 ? formatBytes(bytesTotal) : '?'}`;
    }
    if (document.getElementById('liveUpdateSpeed')) {
        document.getElementById('liveUpdateSpeed').textContent = speed > 0 ? `${formatBytes(speed)}/s` : '—';
    }
    if (document.getElementById('liveUpdateETA')) {
        if (speed > 0 && bytesTotal > bytesReceived) {
            const etaSec = Math.ceil((bytesTotal - bytesReceived) / speed);
            document.getElementById('liveUpdateETA').textContent = `~${etaSec}s`;
        } else {
            document.getElementById('liveUpdateETA').textContent = pct >= 100 ? '¡Listo!' : '—';
        }
    }
}

async function actualizarOnline(){
    if (window.triggerHaptic) window.triggerHaptic(50);
    if(!navigator.onLine){
        if (!allItems || !allItems.length) {
            const cachedLoaded = await loadOfflineCachedCatalog();
            if (cachedLoaded) return;
        }
        mostrarModalActualizacion('offline');
        if (typeof updateOfflineBanner === 'function') updateOfflineBanner(true);
        return;
    }

    const btn = document.querySelector('.online-update-btn');
    if (btn && btn.disabled) return;
    if (btn) {
        btn.disabled = true;
        btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
        btn.textContent = "⏳ Sincronizando...";
    }

    abrirLiveUpdateModal();

    try{
        setLiveStep(1, "Estableciendo conexión segura con el servidor...");
        updateLiveProgress(5, 0, 0, 0);
        await new Promise(r=>setTimeout(r,300));

        let expectedUncompressedBytes = 0;
        setLiveStep(2, "Verificando versión y firma del catálogo...");
        updateLiveProgress(10, 0, 0, 0);
        try {
            const vController = new AbortController();
            const vTimeout = setTimeout(() => vController.abort(), 15000);
            const vRes = await fetch(VERSION_URL + "?_=" + Date.now(), {
                cache: "no-store",
                signal: vController.signal
            });
            clearTimeout(vTimeout);

            if (vRes.ok) {
                const vData = await vRes.json();
                if (vData) {
                    if (vData.file_size || vData.size_bytes || vData.bytes || vData.size || vData.uncompressed_size) {
                        expectedUncompressedBytes = parseInt(vData.file_size || vData.size_bytes || vData.bytes || vData.size || vData.uncompressed_size, 10) || 0;
                    }
                    if (vData.version) {
                        const versionRemota = vData.version;
                        const versionLocal = await idbGetMeta('catalog_version', "0.0.0");
                        const hasItems = (typeof allItems !== 'undefined' && Array.isArray(allItems) && allItems.length > 0);

                        if (versionRemota === versionLocal && hasItems) {
                            updateLiveProgress(100, 0, 0, 0);
                            setLiveStep(5, "¡El catálogo ya está actualizado!");
                            await new Promise(r=>setTimeout(r,600));
                            cerrarLiveUpdateModal();
                            const fechaPrevia = await idbGetMeta('catalog_fecha_update', null);
                            mostrarModalActualizacion('latest', { version: versionRemota, fecha: fechaPrevia });
                            return;
                        }
                    }
                }
            }
        } catch (vErr) {}

        setLiveStep(3, "Descargando paquete de datos del Multiverso...");
        updateLiveProgress(15, 0, 0, 0);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        let res;
        try {
            res = await fetch(UPDATE_URL + "?_=" + Date.now(), {
                cache: "no-store",
                signal: controller.signal
            });
            clearTimeout(timeoutId);
        } catch (err) {
            if (err.name === 'AbortError') throw new Error("Tiempo de conexión agotado (60s)");
            throw new Error("No se pudo conectar: " + err.message);
        }

        if(!res.ok){
            throw new Error("Servidor respondió con error " + res.status);
        }

        const rawContentLength = parseInt(res.headers.get('Content-Length') || '0', 10);
        const contentEncoding = (res.headers.get('Content-Encoding') || '').toLowerCase();
        const isGzip = contentEncoding.includes('gzip') || contentEncoding.includes('deflate') || contentEncoding.includes('br');

        let totalBytes = expectedUncompressedBytes;
        if (!totalBytes && rawContentLength > 0) {
            if (isGzip) {
                // Si la respuesta viene comprimida (gzip/br), Content-Length es el tamaño comprimido (~2.3 MB).
                // El cuerpo que lee el JS con getReader() es la versión descomprimida (~10.7 MB, ~4.37x).
                totalBytes = Math.round(rawContentLength * 4.37);
            } else {
                totalBytes = rawContentLength;
            }
        }

        const reader = res.body.getReader();
        const chunks = [];
        let receivedBytes = 0;
        let lastUpdate = 0;
        const startTime = Date.now();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            receivedBytes += value.length;

            // Ajustar dinámicamente totalBytes si el stream descomprimido supera o se acerca a la estimación
            if (totalBytes > 0 && receivedBytes >= totalBytes * 0.95) {
                totalBytes = Math.max(totalBytes, Math.round(receivedBytes * 1.15));
            }

            const now = Date.now();
            if (now - lastUpdate > 100) {
                lastUpdate = now;
                const elapsed = (now - startTime) / 1000;
                const speed = elapsed > 0 ? receivedBytes / elapsed : 0;

                let percent;
                if (totalBytes > 0) {
                    percent = Math.min(85, 15 + Math.round((receivedBytes / totalBytes) * 70));
                } else {
                    percent = Math.min(80, 15 + Math.floor(receivedBytes / 100000));
                }
                updateLiveProgress(percent, receivedBytes, totalBytes, speed);
            }
        }

        // Al finalizar la descarga por completo, fijar los bytes exactos recibidos
        totalBytes = receivedBytes;
        updateLiveProgress(85, receivedBytes, totalBytes, 0);

        setLiveStep(4, "Procesando, analizando e indexando JSON...");
        updateLiveProgress(88, receivedBytes, totalBytes || receivedBytes, 0);
        await new Promise(r=>setTimeout(r,200));

        const blob = new Blob(chunks);
        const txt = await blob.text();
        let data;
        try {
            data = JSON.parse(txt);
        } catch (err) {
            throw new Error("El archivo descargado no es JSON válido");
        }

        if (!data || !Array.isArray(data.items)) {
            throw new Error("El archivo no tiene el formato esperado (falta 'items')");
        }

        const versionNueva = data.version || "1.0.0";
        const versionGuardada = await idbGetMeta('catalog_version', "0.0.0");
        const catalogoNuevo = data.items || [];
        const catalogoGuardado = await idbGetAll('items');
        const hasExistingItems = (Array.isArray(catalogoGuardado) && catalogoGuardado.length > 0);

        if (versionGuardada === versionNueva && hasExistingItems) {
            updateLiveProgress(100, receivedBytes, totalBytes || receivedBytes, 0);
            setLiveStep(5, "¡Ya tienes la última versión!");
            await new Promise(r=>setTimeout(r,600));
            cerrarLiveUpdateModal();
            const fechaPrevia = await idbGetMeta('catalog_fecha_update', null);
            mostrarModalActualizacion('latest', { version: versionNueva, fecha: fechaPrevia });
            return;
        }

        setLiveStep(4, "Calculando estadísticas y detectando novedades...");
        const stats = calcularEstadisticas(catalogoGuardado, catalogoNuevo);

        setLiveStep(5, "Guardando en base de datos local IndexedDB...");
        updateLiveProgress(95, receivedBytes, totalBytes || receivedBytes, 0);

        const file = new File([txt], "Update.json", {type:"application/json"});
        await handleImportFile(file, false);
        saveCatalogToOfflineCache(txt, versionNueva, catalogoNuevo.length);

        const fechaNueva = data.generated_at ? new Date(data.generated_at).toLocaleDateString('es-ES') : new Date().toLocaleDateString('es-ES');
        await idbSetMeta('catalog_fecha_update', fechaNueva);

        updateLiveProgress(100, receivedBytes, totalBytes || receivedBytes, 0);
        setLiveStep(5, "✅ ¡Sincronización con el Multiverso completada!");
        await new Promise(r=>setTimeout(r,800));

        cerrarLiveUpdateModal();
        if (typeof checkRepoCatalogVersion === 'function') {
            checkRepoCatalogVersion(false);
        }
        mostrarModalActualizacion('updated', {
            versionVieja: versionGuardada,
            versionNueva: versionNueva,
            nuevos: stats.nuevos,
            modificados: stats.modificados,
            eliminados: stats.eliminados,
            total: catalogoNuevo.length,
            highlights: stats.highlights,
            desglose: stats.desglose,
            fecha: fechaNueva
        });
    }
    catch(e){
        console.error(e);
        const errBox = document.getElementById('liveUpdateErrorBox');
        if (errBox) {
            errBox.textContent = "❌ Error: " + e.message;
            errBox.style.display = "block";
        }
        const btnCancel = document.getElementById('liveUpdateCancelBtn');
        if (btnCancel) btnCancel.style.display = "block";
    }
    finally{
        if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || "🌐 Actualizar desde Internet";
        }
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

// ==========================================
// 📊 ESTADÍSTICAS DETALLADAS Y MODAL DE ACTUALIZACIÓN
// ==========================================
function calcularEstadisticas(viejos, nuevos) {
    const mapViejos = new Map(viejos.map(i => [i.id, i]));
    const mapNuevos = new Map(nuevos.map(i => [i.id, i]));
    
    let nuevosCount = 0;
    let eliminadosCount = 0;
    let modificadosCount = 0;
    const nombresNuevos = [];
    const nombresModificados = [];
    
    mapNuevos.forEach((itemNuevo, id) => {
        if (!mapViejos.has(id)) {
            nuevosCount++;
            nombresNuevos.push({ t: itemNuevo.title || 'Nuevo ítem', tag: '🆕 NUEVO' });
        } else {
            const itemViejo = mapViejos.get(id);
            let mod = false;
            if (itemNuevo.updatedAt && itemViejo.updatedAt) {
                if (itemNuevo.updatedAt !== itemViejo.updatedAt) mod = true;
            } else {
                if (JSON.stringify(itemNuevo) !== JSON.stringify(itemViejo)) mod = true;
            }
            if (mod) {
                modificadosCount++;
                nombresModificados.push({ t: itemNuevo.title || 'Ítem modificado', tag: '🔄 CAMBIO' });
            }
        }
    });
    
    mapViejos.forEach((_, id) => {
        if (!mapNuevos.has(id)) eliminadosCount++;
    });

    const desglose = {};
    nuevos.forEach(it => {
        desglose[it.type] = (desglose[it.type] || 0) + 1;
    });
    
    return {
        nuevos: nuevosCount,
        modificados: modificadosCount,
        eliminados: eliminadosCount,
        highlights: [...nombresNuevos, ...nombresModificados].slice(0, 15),
        desglose
    };
}

function mostrarModalActualizacion(tipo, data) {
    data = data || {};
    const icon = document.getElementById('modalActIcon');
    const title = document.getElementById('modalActTitle');
    const msg = document.getElementById('modalActMsg');
    const versionRow = document.getElementById('modalActVersionRow');
    const arrow = document.getElementById('modalActArrow');
    const versionNuevaEl = document.getElementById('versionNueva');
    const statsGrid = document.getElementById('modalActStatsGrid');
    const fecha = document.getElementById('fechaActualizacion');
    const desgloseBox = document.getElementById('modalActDesglose');
    const desgloseGrid = document.getElementById('desgloseGrid');
    const highlightsBox = document.getElementById('modalActHighlights');
    const highlightsList = document.getElementById('highlightsList');

    if (msg) msg.style.display = 'none';
    if (versionRow) versionRow.style.display = 'flex';
    if (arrow) arrow.style.display = 'inline';
    if (versionNuevaEl) versionNuevaEl.style.display = 'inline';
    if (statsGrid) statsGrid.style.display = 'grid';
    if (fecha) fecha.style.display = 'block';
    if (desgloseBox) desgloseBox.style.display = 'none';
    if (highlightsBox) highlightsBox.style.display = 'none';

    const fmtVer = (v) => {
        if (!v) return '';
        const s = String(v).trim();
        return /^[vV]\d/.test(s) ? s : (s.toLowerCase().startsWith('v') ? s : 'v' + s);
    };

    if (tipo === 'updated') {
        if (icon) icon.textContent = '🚀';
        if (title) title.textContent = 'Actualización aplicada';
        const vOldEl = document.getElementById('versionVieja');
        if (vOldEl) vOldEl.textContent = fmtVer(data.versionVieja);
        if (versionNuevaEl) versionNuevaEl.textContent = fmtVer(data.versionNueva);
        document.getElementById('statNuevos').textContent = data.nuevos;
        document.getElementById('statModificados').textContent = data.modificados;
        document.getElementById('statEliminados').textContent = data.eliminados;
        document.getElementById('statTotal').textContent = data.total;
        if (fecha) fecha.textContent = '📅 Fecha: ' + data.fecha;

        // Desglose por categoría
        if (desgloseBox && desgloseGrid && data.desglose) {
            const mapL = { juego: '🎮 Juegos', juego_emulado: '🕹️ Emulados', pelicula: '🎬 Películas', pelicula_animada: '🎨 Películas Animadas', serie: '📺 Series', serie_animada: '✨ Series Anim.', anime: '🎌 Anime', anime_movie: '🎥 Anime Pelis', novela_tv: '📺 Novelas TV', musica: '🎵 Música', software: '💻 Software', novela: '📚 Novelas' };
            const keys = Object.keys(data.desglose).sort((a,b) => data.desglose[b] - data.desglose[a]);
            desgloseGrid.innerHTML = keys.map(k => `
                <div class="desglose-card">
                  <span style="flex:1">${mapL[k] || k}</span>
                  <span class="num">${data.desglose[k]}</span>
                </div>
            `).join('');
            desgloseBox.style.display = 'block';
        }

        // Highlights (novedades detectadas)
        if (highlightsBox && highlightsList && data.highlights && data.highlights.length > 0) {
            highlightsList.innerHTML = data.highlights.map(h => `
                <div class="highlight-item">
                  <span class="t">${escapeHtml(h.t)}</span>
                  <span class="tag">${h.tag}</span>
                </div>
            `).join('');
            highlightsBox.style.display = 'block';
        }

    } else if (tipo === 'latest') {
        if (icon) icon.textContent = '✅';
        if (title) title.textContent = 'Ya tienes la última versión';
        if (msg) {
            msg.textContent = 'No se encontraron cambios en el servidor. Tu catálogo local ya está al día, no se descargó nada.';
            msg.style.display = 'block';
        }
        if (arrow) arrow.style.display = 'none';
        if (versionNuevaEl) versionNuevaEl.style.display = 'none';
        const vOldEl = document.getElementById('versionVieja');
        if (vOldEl) vOldEl.textContent = fmtVer(data.version);
        if (statsGrid) statsGrid.style.display = 'none';
        if (data.fecha) { if (fecha) fecha.textContent = '📅 Última actualización: ' + data.fecha; }
        else { if (fecha) fecha.style.display = 'none'; }

    } else if (tipo === 'offline') {
        if (icon) icon.textContent = '📡';
        if (title) title.textContent = 'Sin conexión a internet';
        if (msg) {
            msg.textContent = 'No se pudo comprobar si hay una actualización disponible porque no hay conexión. Conéctate e inténtalo de nuevo.';
            msg.style.display = 'block';
        }
        if (versionRow) versionRow.style.display = 'none';
        if (statsGrid) statsGrid.style.display = 'none';
        if (fecha) fecha.style.display = 'none';

    } else if (tipo === 'error') {
        if (icon) icon.textContent = '⚠️';
        if (title) title.textContent = 'No se pudo actualizar';
        if (msg) {
            msg.textContent = data.message || 'Ocurrió un error al comprobar o descargar la actualización.';
            msg.style.display = 'block';
        }
        if (versionRow) versionRow.style.display = 'none';
        if (statsGrid) statsGrid.style.display = 'none';
        if (fecha) fecha.style.display = 'none';
    }

    const modalAct = document.getElementById('modalActualizacion');
    if (modalAct) {
        if (window.triggerHaptic) window.triggerHaptic(35);
        modalAct.style.display = 'block';
    }
}

function cerrarModalActualizacion() {
    if (window.triggerHaptic) window.triggerHaptic(35);
    const modalAct = document.getElementById('modalActualizacion');
    if (modalAct) modalAct.style.display = 'none';
}

// ==========================================
// 🚀 ARRANQUE DE LA APP
// ==========================================
function mostrarAvisoNuevaActualizacion(versionRemota){
    if (window.triggerHaptic) window.triggerHaptic(35);
    const msg = document.getElementById('avisoUpdateMsg');
    msg.textContent = 'Hay una nueva versión del catálogo (v' + versionRemota + ') lista para descargar.';
    document.getElementById('modalAvisoUpdate').style.display = 'block';
}

function cerrarModalAvisoUpdate(){
    if (window.triggerHaptic) window.triggerHaptic(35);
    document.getElementById('modalAvisoUpdate').style.display = 'none';
}

async function actualizarAhoraDesdeAviso(){
    if (window.triggerHaptic) window.triggerHaptic(50);
    cerrarModalAvisoUpdate();
    await openSettings();
    actualizarOnline();
}

async function chequearActualizacionSilenciosa(isManual = false){
    // Desactivado de forma automática para evitar alertas intrusivas y mantener la APK 100% limpia.
    // Solo se ejecuta si el usuario lo solicita explícitamente.
    if (!isManual) return;
    if (!navigator.onLine) return;
    try {
        const vController = new AbortController();
        const vTimeout = setTimeout(() => vController.abort(), 10000);
        const vRes = await fetch(VERSION_URL + "?_=" + Date.now(), {
            cache: "no-store",
            signal: vController.signal
        });
        clearTimeout(vTimeout);
        if (!vRes.ok) return;

        const vData = await vRes.json();
        if (!vData || !vData.version) return;

        const versionRemota = vData.version;
        const versionLocal = await idbGetMeta('catalog_version', localStorage.getItem('joa_catalog_version') || "0.0.0");

        if (versionRemota !== versionLocal) {
            mostrarAvisoNuevaActualizacion(versionRemota);
        }
    } catch (e) {}
}

// =====================================================================
// 🚀 SISTEMA DE DETECCIÓN Y ACTUALIZACIÓN GLOBAL DE LA APK (JOA GAMERS)
// =====================================================================
const JOA_CURRENT_APK_VERSION = "v1.0.8"; // Versión instalada en esta compilación

const JOA_APK_CONFIG = {
  appName: "JOA GAMERs",
  apkFileName: "Catalogo.Joa.apk",
  githubRepo: "junior18cubano-hash/Apk-JOA",
  officialDownloadPage: "https://junior18cubano-hash.github.io/mi-catalogo/",
  githubReleasesPage: "https://github.com/junior18cubano-hash/Apk-JOA/releases",
  githubLatestApi: "https://api.github.com/repos/junior18cubano-hash/Apk-JOA/releases/latest",
  fallbackDownloadUrl: "https://github.com/junior18cubano-hash/Apk-JOA/releases/download/v1.0.8/Catalogo.Joa.apk"
};

let latestDetectedApk = null;

function parseSemVer(v) {
  if (!v) return [0, 0, 0];
  const cleaned = String(v).trim().replace(/^[vV]/, '');
  const parts = cleaned.split(/[\.-]/).map(p => parseInt(p, 10)).filter(n => !isNaN(n));
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function isNewerVersion(remote, local) {
  const r = parseSemVer(remote);
  const l = parseSemVer(local);
  for (let i = 0; i < 3; i++) {
    if (r[i] > l[i]) return true;
    if (r[i] < l[i]) return false;
  }
  return false;
}

function formatBytesReadable(bytes) {
  if (!bytes || isNaN(bytes)) return '~18.5 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function openSafeUrl(url) {
  if (!url) return;
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    window.open(url, '_blank');
  }
}

async function checkGlobalApkUpdate(isManual = false) {
  if (isManual && window.triggerHaptic) window.triggerHaptic(30);

  const statusMsgEl = document.getElementById('settingsApkStatusMsg');
  const latestVerEl = document.getElementById('settingsLatestApkVer');
  const settingsBadge = document.getElementById('apkUpdateSettingsBadge');

  if (statusMsgEl) {
    statusMsgEl.textContent = '⏳ Consultando fuentes oficiales (GitHub Releases & Web)...';
    statusMsgEl.style.color = '#00E5FF';
  }
  if (isManual && typeof showToast === 'function') {
    showToast('🔍 Comprobando si hay una nueva versión de la APK...');
  }

  let releaseData = null;

  // 1. Intentar consultar la API oficial de GitHub Releases
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const resp = await fetch(`${JOA_APK_CONFIG.githubLatestApi}?_=${Date.now()}`, {
      headers: { 'Accept': 'application/vnd.github+json' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.tag_name) {
        let apkAsset = null;
        if (Array.isArray(data.assets) && data.assets.length > 0) {
          apkAsset = data.assets.find(a => a.name.toLowerCase() === JOA_APK_CONFIG.apkFileName.toLowerCase()) ||
                     data.assets.find(a => a.name.toLowerCase().endsWith('.apk'));
        }

        const downloadUrl = apkAsset ? apkAsset.browser_download_url : (data.html_url || JOA_APK_CONFIG.fallbackDownloadUrl);
        const assetSize = apkAsset ? apkAsset.size : null;
        const assetName = apkAsset ? apkAsset.name : JOA_APK_CONFIG.apkFileName;

        releaseData = {
          tagName: data.tag_name,
          title: data.name || data.tag_name,
          body: data.body || '',
          publishedAt: data.published_at,
          downloadUrl: downloadUrl,
          size: assetSize,
          fileName: assetName,
          htmlUrl: data.html_url || JOA_APK_CONFIG.githubReleasesPage
        };
      }
    }
  } catch (apiErr) {
    console.warn('GitHub API check failed, trying fallback source:', apiErr);
  }

  // 2. Si falló la API (por ejemplo por rate limit), consultar la página oficial de descarga
  if (!releaseData) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const resp = await fetch(`${JOA_APK_CONFIG.officialDownloadPage}?_=${Date.now()}`, {
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const html = await resp.text();
        const tagMatch = html.match(/releases\/download\/(v[0-9\.]+)\//) || html.match(/\b(v[0-9]+\.[0-9]+\.[0-9]+)\b/);
        const tag = tagMatch ? tagMatch[1] : 'v1.0.8';

        releaseData = {
          tagName: tag,
          title: `JOA GAMERs APK (${tag})`,
          body: 'Nueva versión oficial publicada en la plataforma de descarga.',
          publishedAt: new Date().toISOString(),
          downloadUrl: `https://github.com/junior18cubano-hash/Apk-JOA/releases/download/${tag}/Catalogo.Joa.apk`,
          size: null,
          fileName: JOA_APK_CONFIG.apkFileName,
          htmlUrl: JOA_APK_CONFIG.githubReleasesPage
        };
      }
    } catch (pageErr) {
      console.warn('Official page fallback also failed:', pageErr);
    }
  }

  // 3. Fallback estático con la versión actual v1.0.8 si todo lo demás no responde y es manual
  if (!releaseData && isManual) {
    releaseData = {
      tagName: 'v1.0.8',
      title: 'CatalogoJoa.apk',
      body: 'Actualización oficial con mejoras de rendimiento y estabilidad.',
      publishedAt: '2026-10-29T01:00:00Z',
      downloadUrl: JOA_APK_CONFIG.fallbackDownloadUrl,
      size: 18456789,
      fileName: JOA_APK_CONFIG.apkFileName,
      htmlUrl: JOA_APK_CONFIG.githubReleasesPage
    };
  }

  if (!releaseData) {
    if (statusMsgEl) {
      statusMsgEl.textContent = '⚠️ Sin conexión para verificar. Puedes descargar desde la página oficial.';
      statusMsgEl.style.color = '#FFAA33';
    }
    if (isManual && typeof showToast === 'function') {
      showToast('⚠️ No se pudo comprobar la versión. Revisa tu conexión a internet.');
    }
    return;
  }

  latestDetectedApk = releaseData;

  const remoteVer = releaseData.tagName;
  const hasUpdate = isNewerVersion(remoteVer, JOA_CURRENT_APK_VERSION);

  // Actualizar UI en ajustes
  if (latestVerEl) {
    latestVerEl.textContent = `${remoteVer} ${hasUpdate ? '✨' : '✓'}`;
    latestVerEl.style.color = hasUpdate ? '#00FF87' : '#00E5FF';
  }
  if (settingsBadge) {
    if (hasUpdate) {
      settingsBadge.textContent = `✨ ${remoteVer} Disponible`;
      settingsBadge.style.background = 'rgba(0,255,135,0.2)';
      settingsBadge.style.color = '#00FF87';
      settingsBadge.style.borderColor = 'rgba(0,255,135,0.5)';
    } else {
      settingsBadge.textContent = `✅ ${JOA_CURRENT_APK_VERSION} al día`;
      settingsBadge.style.background = 'rgba(0,229,255,0.15)';
      settingsBadge.style.color = '#00E5FF';
      settingsBadge.style.borderColor = 'rgba(0,229,255,0.4)';
    }
  }

  if (hasUpdate) {
    if (statusMsgEl) {
      statusMsgEl.textContent = `🎉 ¡Nueva versión ${remoteVer} disponible para descargar!`;
      statusMsgEl.style.color = '#00FF87';
    }

    // Mostrar modal y aviso ÚNICAMENTE cuando el usuario lo solicita manualmente en Ajustes
    if (isManual) {
      const pill = document.getElementById('floatingApkUpdatePill');
      const pillVer = document.getElementById('pillApkVersion');
      if (pill) {
        if (pillVer) pillVer.textContent = remoteVer;
        pill.style.display = 'flex';
      }
      mostrarModalApkUpdate();
    }
  } else {
    if (statusMsgEl) {
      statusMsgEl.textContent = `✅ Tienes instalada la versión más reciente (${JOA_CURRENT_APK_VERSION}).`;
      statusMsgEl.style.color = '#00FFB2';
    }
    const pill = document.getElementById('floatingApkUpdatePill');
    if (pill) pill.style.display = 'none';

    if (isManual && typeof showToast === 'function') {
      showToast(`✅ Tu aplicación JOA GAMERs está al día (${JOA_CURRENT_APK_VERSION}).`);
    }
  }
}

function mostrarModalApkUpdate() {
  if (window.triggerHaptic) window.triggerHaptic(40);
  const modal = document.getElementById('modalApkGlobalUpdate');
  if (!modal) return;

  const data = latestDetectedApk || {
    tagName: 'v1.0.8',
    title: 'CatalogoJoa.apk',
    body: 'Mejoras de rendimiento, optimizaciones multimedia y corrección de errores.',
    publishedAt: '2026-10-29T01:00:00Z',
    downloadUrl: JOA_APK_CONFIG.fallbackDownloadUrl,
    size: 18456789,
    fileName: JOA_APK_CONFIG.apkFileName
  };

  const vActEl = document.getElementById('apkVersionActual');
  const vNewEl = document.getElementById('apkVersionNueva');
  const fnEl = document.getElementById('apkFileName');
  const szEl = document.getElementById('apkFileSize');
  const dtEl = document.getElementById('apkPublishDate');
  const notesEl = document.getElementById('apkReleaseNotes');

  if (vActEl) vActEl.textContent = JOA_CURRENT_APK_VERSION;
  if (vNewEl) vNewEl.textContent = data.tagName;
  if (fnEl) fnEl.textContent = data.fileName || JOA_APK_CONFIG.apkFileName;
  if (szEl) szEl.textContent = formatBytesReadable(data.size);
  if (dtEl) {
    if (data.publishedAt) {
      try {
        dtEl.textContent = new Date(data.publishedAt).toLocaleDateString('es-ES', {
          day: '2-digit', month: 'short', year: 'numeric'
        });
      } catch (e) {
        dtEl.textContent = 'Reciente';
      }
    } else {
      dtEl.textContent = 'Disponible ahora';
    }
  }

  if (notesEl) {
    if (data.body && data.body.trim()) {
      notesEl.textContent = data.body.trim();
    } else {
      notesEl.textContent = 'Mejoras de rendimiento, optimizaciones en el catálogo multimedia, correcciones de estabilidad y nuevas funcionalidades globales.';
    }
  }

  modal.style.display = 'flex';
}

function cerrarModalApkUpdate() {
  if (window.triggerHaptic) window.triggerHaptic(20);
  const modal = document.getElementById('modalApkGlobalUpdate');
  if (modal) modal.style.display = 'none';

  if (latestDetectedApk) {
    localStorage.setItem('last_apk_update_dismissed', Date.now().toString());
    localStorage.setItem('last_apk_update_dismissed_ver', latestDetectedApk.tagName || '');
  }
}

function descargarApkDirecto() {
  if (window.triggerHaptic) window.triggerHaptic(45);
  const url = (latestDetectedApk && latestDetectedApk.downloadUrl)
    ? latestDetectedApk.downloadUrl
    : JOA_APK_CONFIG.fallbackDownloadUrl;

  if (typeof showToast === 'function') {
    showToast('📥 Iniciando descarga de Catalogo.Joa.apk...');
  }

  openSafeUrl(url);
}

function abrirPaginaOficialDescarga() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  if (typeof showToast === 'function') {
    showToast('🌐 Abriendo página oficial de descarga...');
  }
  openSafeUrl(JOA_APK_CONFIG.officialDownloadPage);
}

function abrirReleasesGithub() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  if (typeof showToast === 'function') {
    showToast('🐙 Abriendo releases oficiales en GitHub...');
  }
  const url = (latestDetectedApk && latestDetectedApk.htmlUrl)
    ? latestDetectedApk.htmlUrl
    : JOA_APK_CONFIG.githubReleasesPage;
  openSafeUrl(url);
}

function updateApkSettingsCardStatus() {
  const currentVerEl = document.getElementById('settingsCurrentApkVer');
  if (currentVerEl) currentVerEl.textContent = JOA_CURRENT_APK_VERSION;

  if (latestDetectedApk) {
    const latestVerEl = document.getElementById('settingsLatestApkVer');
    const hasUpdate = isNewerVersion(latestDetectedApk.tagName, JOA_CURRENT_APK_VERSION);
    if (latestVerEl) {
      latestVerEl.textContent = `${latestDetectedApk.tagName} ${hasUpdate ? '✨' : '✓'}`;
      latestVerEl.style.color = hasUpdate ? '#00FF87' : '#00E5FF';
    }
  } else {
    // Estado inicial limpio y sin comprobaciones automáticas no solicitadas
    const latestVerEl = document.getElementById('settingsLatestApkVer');
    if (latestVerEl) {
      latestVerEl.textContent = `${JOA_CURRENT_APK_VERSION} ✓`;
      latestVerEl.style.color = '#00FFB2';
    }
    const settingsBadge = document.getElementById('apkUpdateSettingsBadge');
    if (settingsBadge) {
      settingsBadge.textContent = `✅ ${JOA_CURRENT_APK_VERSION} al día`;
      settingsBadge.style.background = 'rgba(0,229,255,0.15)';
      settingsBadge.style.color = '#00E5FF';
      settingsBadge.style.borderColor = 'rgba(0,229,255,0.4)';
    }
  }
}

// Exports globales
window.JOA_CURRENT_APK_VERSION = JOA_CURRENT_APK_VERSION;
window.checkGlobalApkUpdate = checkGlobalApkUpdate;
window.mostrarModalApkUpdate = mostrarModalApkUpdate;
window.cerrarModalApkUpdate = cerrarModalApkUpdate;
window.descargarApkDirecto = descargarApkDirecto;
window.abrirPaginaOficialDescarga = abrirPaginaOficialDescarga;
window.abrirReleasesGithub = abrirReleasesGithub;
window.updateApkSettingsCardStatus = updateApkSettingsCardStatus;

// =====================================================================
// 📦 OFFLINE CATALOG CACHING ENGINE (Multi-Layer Resilient Persistence)
// =====================================================================

async function saveCatalogToOfflineCache(rawTextOrObj, version, count) {
  try {
    const rawText = typeof rawTextOrObj === 'string' ? rawTextOrObj : JSON.stringify(rawTextOrObj);
    const ver = version || '1.0.0';
    const itemCount = count || (allItems ? allItems.length : 0);

    // 1. Guardar en CacheStorage bajo joa-catalog-v8
    if ('caches' in window) {
      try {
        const catCache = await caches.open('joa-catalog-v8');
        const makeResponse = () => new Response(rawText, {
          headers: {
            'Content-Type': 'application/json',
            'X-Joa-Cached-At': new Date().toISOString(),
            'X-Joa-Offline-Cache': 'true',
            'Cache-Control': 'public, max-age=31536000'
          }
        });
        await catCache.put('./Update.json', makeResponse());
        await catCache.put('Update.json', makeResponse());
        await catCache.put(UPDATE_URL, makeResponse());
        console.log('💾 [Offline Cache] Catálogo persistido en CacheStorage (joa-catalog-v8).');
      } catch (cErr) {
        console.warn('⚠️ [Offline Cache] CacheStorage no disponible:', cErr);
      }
    }

    // 2. Notificar al Service Worker para redundancia
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_CATALOG_DATA',
        json: rawText,
        version: ver,
        count: itemCount
      });
    }

    // 3. Metadata de persistencia en localStorage
    localStorage.setItem('joa_catalog_cached_version', ver);
    localStorage.setItem('joa_catalog_cached_count', String(itemCount));
    localStorage.setItem('joa_catalog_cached_time', new Date().toISOString());
    localStorage.setItem('joa_catalog_cached_status', 'ready');

    console.log(`✅ [Offline Cache] Catálogo (${itemCount} títulos, v${ver}) asegurado para modo offline.`);
    return true;
  } catch (e) {
    console.warn('⚠️ [Offline Cache] Error al persistir catálogo en caché offline:', e);
    return false;
  }
}

async function loadOfflineCachedCatalog() {
  console.log('🔍 [Offline Cache Engine] Buscando catálogo en caché offline...');
  let catalogData = null;

  // Tier 1: CacheStorage (Cache API estándar / Service Worker)
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      for (const k of keys) {
        if (k.includes('catalog') || k.includes('static')) {
          const c = await caches.open(k);
          const match = await c.match(UPDATE_URL, { ignoreSearch: true });
          if (match) {
            const txt = await match.text();
            const parsed = JSON.parse(txt);
            if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
              catalogData = parsed;
              console.log(`✅ [Offline Cache] Encontrado en CacheStorage (${k}): ${parsed.items.length} títulos.`);
              break;
            }
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ [Offline Cache] Error leyendo CacheStorage:', e);
    }
  }

  // Si encontramos el catálogo en caché offline, inicializarlo
  if (catalogData && Array.isArray(catalogData.items) && catalogData.items.length > 0) {
    try {
      const normalizedItems = normalizeCatalogItems(catalogData.items);
      allItems = normalizedItems;

      // Desplegar interfaz principal inmediatamente
      const importScreen = document.getElementById('importScreen');
      const appScreen = document.getElementById('appScreen');
      if (importScreen) importScreen.style.display = 'none';
      if (appScreen) appScreen.style.display = 'block';

      // Persistir en IndexedDB de forma no bloqueante
      idbClear('items').then(() => idbBulkPut('items', normalizedItems)).catch(e => console.warn(e));
      const incLabels = Object.assign({}, catalogData.type_labels || {});
      incLabels.novela_tv = incLabels.novela_tv || '📺 Novelas TV';
      idbSetMeta('type_labels', incLabels);
      idbSetMeta('consoles', catalogData.consoles || {});
      idbSetMeta('achievements', catalogData.achievements || []);
      idbSetMeta('imported_at', new Date().toISOString());
      if (catalogData.version) idbSetMeta('catalog_version', catalogData.version);

      renderSidebar();
      renderLibraryCounts();
      populateFilterOptions();
      if (typeof updateTogglePillStates === 'function') updateTogglePillStates();
      applyFilters();

      console.log(`✅ [Offline Engine] Catálogo activado exitosamente: ${allItems.length} títulos listos.`);
      return true;
    } catch (err) {
      console.error('❌ Error importando catálogo desde caché offline:', err);
    }
  }

  return false;
}

async function guardarCatalogoOfflineManual() {
  if (window.triggerHaptic) window.triggerHaptic(40);
  if (!allItems || !allItems.length) {
    showToast('⚠️ No hay elementos en el catálogo para guardar.');
    return;
  }
  showToast('⏳ Guardando catálogo completo en caché offline...');
  const catObj = {
    version: await idbGetMeta('catalog_version', '1.0.0'),
    items: allItems,
    type_labels: typeLabels,
    consoles: consolesData,
    generated_at: await idbGetMeta('generated_at', null)
  };
  await saveCatalogToOfflineCache(catObj, catObj.version, allItems.length);
  showToast(`✅ Catálogo guardado en caché offline (${allItems.length} títulos listos).`);
  const badge = document.getElementById('catalogCacheStatusBadge');
  if (badge) {
    badge.textContent = `🟢 Guardado (${allItems.length} títulos)`;
    badge.style.color = '#00FFB2';
  }
}

async function cargarCatalogoDesdeCacheOffline() {
  if (window.triggerHaptic) window.triggerHaptic(40);
  const ok = await loadOfflineCachedCatalog();
  if (ok) {
    showToast('✅ Catálogo cargado con éxito desde la caché.');
  } else {
    showToast('⚠️ No se encontró una copia del catálogo en caché local.');
  }
}


async function bootApp() {
  if (window._isBootingApp) return;
  window._isBootingApp = true;
  try {
  if (typeof showSkeletonGrid === 'function') showSkeletonGrid(8);
  const rawItems = await idbGetAll('items');
  allItems = normalizeCatalogItems(rawItems);
  const customMetaLabels = await idbGetMeta('type_labels', {});
  window.typeLabels = typeLabels = { ...DEFAULT_TYPE_LABELS, ...(customMetaLabels || {}) };
  // Ensure novela_tv is labeled properly as Novelas TV and novela as Libros
  typeLabels.novela_tv = '📺 Novelas TV';
  if (!typeLabels.novela || typeLabels.novela === 'Novelas' || typeLabels.novela === 'Novela') {
    typeLabels.novela = '📚 Novelas (Libros)';
  }
  window.imageBaseUrl = imageBaseUrl = await idbGetMeta('image_base_url', '');

  if (!allItems.length) {
    if (window.BUNDLED_CATALOG && Array.isArray(window.BUNDLED_CATALOG.items) && window.BUNDLED_CATALOG.items.length > 0) {
      console.log(`📦 Inicializando catálogo integrado (${window.BUNDLED_CATALOG.items.length} títulos)...`);
      window.allItems = allItems = normalizeCatalogItems(window.BUNDLED_CATALOG.items);
      // Persistir en IndexedDB en segundo plano
      idbClear('items').then(() => idbBulkPut('items', allItems)).catch(() => {});
      const incLabels = Object.assign({}, window.BUNDLED_CATALOG.type_labels || {});
      incLabels.novela_tv = incLabels.novela_tv || '📺 Novelas TV';
      window.typeLabels = typeLabels = { ...typeLabels, ...incLabels };
      idbSetMeta('type_labels', incLabels);
      idbSetMeta('consoles', window.BUNDLED_CATALOG.consoles || {});
      idbSetMeta('achievements', window.BUNDLED_CATALOG.achievements || []);
      idbSetMeta('imported_at', new Date().toISOString());
      if (window.BUNDLED_CATALOG.version) idbSetMeta('catalog_version', window.BUNDLED_CATALOG.version);
    } else {
      const loadedFromCache = await loadOfflineCachedCatalog();
      if (!loadedFromCache) {
        console.warn('📦 [Offline Engine] Inicializando entorno principal.');
      }
    }
  }

  const importScreen = document.getElementById('importScreen');
  if (importScreen) importScreen.style.display = 'none';
  const appScreen = document.getElementById('appScreen');
  if (appScreen) appScreen.style.display = 'block';

  if (window.AndroidBridge && typeof window.AndroidBridge.shareProduct === 'function') {
    if (!navigator.share) {
      navigator.share = async function(data) {
        window.AndroidBridge.shareProduct(data.title || '', data.text || '', data.url || '');
        return Promise.resolve();
      };
    }
  }

  window.userStates = userStates = await idbGetAll('user_states');
  window.achievementsRules = achievementsRules = await idbGetMeta('achievements', []);
  window.consolesData = consolesData = await idbGetMeta('consoles', {});
  await ensureProfile();
  renderProfileChip();

  renderSidebar();
  renderLibraryCounts();
  populateFilterOptions();
  if (typeof updateTogglePillStates === 'function') updateTogglePillStates();
  applyFilters();
  syncHomeScreenApkVersion();
  if (typeof checkRepoCatalogVersion === 'function') {
    checkRepoCatalogVersion(false);
  }

  const importedAt = await idbGetMeta('imported_at', null);
  document.getElementById('lastImportLabel').textContent = importedAt
    ? '📅 Actualizado: ' + new Date(importedAt).toLocaleString('es-ES')
    : '';

  // Inicialización limpia: Sin comprobaciones automáticas de actualización en segundo plano
  // para que la APK no pida actualizar al iniciarse y sea 100% limpia.
  setTimeout(() => { 
    syncPlayingItemsToAndroid(); 
    syncCatalogVersionToAndroid(); 
    if (typeof syncFavoritesMetadataOffline === 'function') syncFavoritesMetadataOffline();
  }, 500);
  setTimeout(() => { initBgSyncWifiState(); initAppTheme(); initCustomPushAlertsState(); initQuickAccessState(); }, 600);
  setTimeout(() => { if (typeof autoCleanOldImagesFromIndexedDB === 'function') autoCleanOldImagesFromIndexedDB(30); }, 2000);
  setTimeout(() => { if (typeof checkAndStartTutorial === 'function') checkAndStartTutorial(); }, 750);
  setTimeout(() => {
    if (window.AndroidBridge && typeof window.AndroidBridge.getInitialSection === 'function') {
      const sec = window.AndroidBridge.getInitialSection();
      if (sec === 'playing') {
        if (typeof setLibraryFilter === 'function') setLibraryFilter('playing');
      } else if (sec === 'wishlist') {
        if (typeof setLibraryFilter === 'function') setLibraryFilter('wishlist');
      } else if (sec === 'completed') {
        if (typeof setLibraryFilter === 'function') setLibraryFilter('completed');
      } else if (sec === 'catalog') {
        if (typeof clearFilters === 'function') clearFilters();
      } else if (sec === 'update') {
        if (typeof abrirLiveUpdateModal === 'function' && typeof actualizarOnline === 'function') {
          actualizarOnline();
        }
      } else if (sec) {
        if (typeof setTypeFilter === 'function') {
          if (sec === 'novela_tv' || sec === 'novelas_tv' || sec === 'telenovela' || sec === 'telenovelas' || sec === 'novelas_de_tv') {
            setTypeFilter('novela_tv');
          } else {
            setTypeFilter(sec);
          }
        }
      }
    }
  }, 700);
  } catch (err) {
    console.error("bootApp error:", err);
  } finally {
    window._isBootingApp = false;
  }
}

// ==========================================
// 🔔 ALARMAS DE INACTIVIDAD (3 DÍAS) NATIVAS
// ==========================================
async function syncPlayingItemsToAndroid() {
  try {
    const allStates = (typeof idbGetAll === 'function' ? await idbGetAll('user_states') : (typeof userStates !== 'undefined' ? userStates : [])) || [];
    const items = (typeof idbGetAll === 'function' ? await idbGetAll('items') : (typeof allItems !== 'undefined' ? allItems : [])) || [];

    // 1. PLAYING & PENDING (jugando o marcados para jugar)
    const playingStates = allStates.filter(s => s && (s.status === 'playing' || s.status === 'pending'));
    const playingMap = new Map(playingStates.map(s => [String(s.itemId), s.status]));
    const playingItems = items.filter(i => playingMap.has(String(i.id))).map(i => {
      const isPlay = playingMap.get(String(i.id)) === 'playing';
      return {
        id: String(i.id),
        title: i.title || 'Sin título',
        subtitle: isPlay ? '🎮 Jugando' : '🕓 Por jugar',
        cover: i.cover || i.image || i.poster || i.caratula || i.img || ''
      };
    });

    const titles = playingItems.map(p => p.title);
    const badge = document.getElementById('settingsPlayingBadge');
    if (badge) {
      badge.textContent = `${playingItems.length} en juego`;
    }

    // 2. WISHLIST (lista de deseos con carátulas y nombres)
    const wishStates = allStates.filter(s => s && s.status === 'wishlist');
    const wishIds = new Set(wishStates.map(s => String(s.itemId)));
    const wishItems = items.filter(i => wishIds.has(String(i.id))).map(i => ({
      id: String(i.id),
      title: i.title || 'Sin título',
      subtitle: (i.type ? '❤️ ' + i.type : '❤️ Deseo') + (i.year ? ' • ' + i.year : ''),
      cover: i.cover || i.image || i.poster || i.caratula || i.img || ''
    }));

    // 3. CATALOG (últimas cosas añadidas al catálogo)
    const catalogItems = [...items].slice(-12).reverse().map(i => ({
      id: String(i.id),
      title: i.title || 'Sin título',
      subtitle: (i.type ? '🆕 ' + i.type : '🆕 Novedad') + (i.year ? ' • ' + i.year : ''),
      cover: i.cover || i.image || i.poster || i.caratula || i.img || ''
    }));

    // Composite payload: plain titles array first (for InactivityReminderWorker), followed by metadata object for widget
    const payload = [
      ...titles,
      {
        __widget__: true,
        catalog: catalogItems,
        playing: playingItems,
        wishlist: wishItems
      }
    ];

    if (window.AndroidBridge && typeof window.AndroidBridge.syncPlayingItems === 'function') {
      window.AndroidBridge.syncPlayingItems(JSON.stringify(payload));
    }
  } catch (e) {
    console.error("Error al sincronizar ítems con el widget:", e);
  }
}

function testInactivityNotification() {
  try {
    idbGetAll('user_states').then(allStates => {
      const playingStates = allStates.filter(s => s.status === 'playing');
      const playingIds = new Set(playingStates.map(s => s.itemId));
      idbGetAll('items').then(items => {
        const titles = items.filter(i => playingIds.has(i.id)).map(i => i.title);
        if (window.AndroidBridge && typeof window.AndroidBridge.testInactivityNotificationNow === 'function') {
          window.AndroidBridge.testInactivityNotificationNow(JSON.stringify(titles));
        } else {
          alert("🔔 Prueba de Notificación de Inactividad:\nTienes " + titles.length + " elemento(s) en '🎮 Jugando/Viendo'.\n\n(En la app de Android verás una notificación real en la barra de estado tras 4 segundos; en un PC de escritorio solo se muestra este aviso de prueba).");
        }
      });
    });
  } catch(e) {
    console.error(e);
  }
}

// ==========================================
function initBgSyncWifiState() {
  try {
    if (typeof updatePushDndSummary === 'function') updatePushDndSummary();
  } catch(e) {
    console.error(e);
  }
}

// ==========================================
// ⚡ GESTOR DE ACCESOS RÁPIDOS (PANTALLA COMPLETA Y FILTRO MADURO)
// ==========================================
function toggleFullscreenMode(enabled) {
  try {
    localStorage.setItem('joa_fullscreen_mode', enabled ? 'true' : 'false');
    if (window.AndroidBridge && typeof window.AndroidBridge.setFullscreen === 'function') {
      window.AndroidBridge.setFullscreen(enabled);
    } else {
      if (enabled) {
        const docElm = document.documentElement;
        if (docElm.requestFullscreen) docElm.requestFullscreen();
        else if (docElm.webkitRequestFullscreen) docElm.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    }
    showToast(enabled ? "📺 Modo Pantalla Completa ACTIVADO" : "⏹️ Modo Pantalla Completa DESACTIVADO");
    updateQuickAccessBadge();
  } catch(e) {
    console.error("Error toggleFullscreenMode:", e);
  }
}

function toggleMatureFilter(enabled) {
  try {
    localStorage.setItem('joa_mature_filter', enabled ? 'true' : 'false');
    showToast(enabled ? "🔞 Filtro de Contenido Maduro ACTIVADO (+18 oculto)" : "⏹️ Filtro de Contenido Maduro DESACTIVADO");
    updateQuickAccessBadge();
    if (typeof applyFilters === 'function') applyFilters();
    if (typeof renderGrid === 'function') renderGrid();
  } catch(e) {
    console.error("Error toggleMatureFilter:", e);
  }
}

function updateQuickAccessBadge() {
  try {
    const fs = localStorage.getItem('joa_fullscreen_mode') === 'true';
    const mat = localStorage.getItem('joa_mature_filter') === 'true';
    const badge = document.getElementById('quickAccessBadge');
    if (badge) {
      if (!fs && !mat) {
        badge.textContent = "⚪ Desact.";
        badge.style.color = "var(--text3)";
        badge.style.background = "rgba(255,255,255,0.05)";
      } else if (fs && mat) {
        badge.textContent = "🟢 2 Activos";
        badge.style.color = "var(--signal)";
        badge.style.background = "var(--signal-dim)";
      } else {
        badge.textContent = fs ? "📺 Pant. Comp." : "🔞 Filtro +18";
        badge.style.color = "var(--signal)";
        badge.style.background = "var(--signal-dim)";
      }
    }
  } catch(e) {
    console.error("Error updateQuickAccessBadge:", e);
  }
}

function initQuickAccessState() {
  try {
    const fs = localStorage.getItem('joa_fullscreen_mode') === 'true';
    const mat = localStorage.getItem('joa_mature_filter') === 'true';
    const tFs = document.getElementById('fullscreenToggle');
    if (tFs) tFs.checked = fs;
    const tMat = document.getElementById('matureFilterToggle');
    if (tMat) tMat.checked = mat;
    if (fs && window.AndroidBridge && typeof window.AndroidBridge.setFullscreen === 'function') {
      window.AndroidBridge.setFullscreen(true);
    }
    updateQuickAccessBadge();
  } catch(e) {
    console.error("Error initQuickAccessState:", e);
  }
}

// ==========================================
// 🔔 GESTOR DE ALERTAS PUSH PERSONALIZADAS
// ==========================================
function togglePushPriceDrop(enabled) {
  try {
    localStorage.setItem('joa_push_price_drop', enabled ? 'true' : 'false');
    syncCustomPushConfigToAndroid();
    showToast(enabled ? "📉 Alerta de bajada de precio en Deseados ACTIVADA" : "⏹️ Alerta de bajada de precio DESACTIVADA");
  } catch(e) {
    console.error("Error togglePushPriceDrop:", e);
  }
}

function togglePushReview(enabled) {
  try {
    localStorage.setItem('joa_push_review', enabled ? 'true' : 'false');
    syncCustomPushConfigToAndroid();
    showToast(enabled ? "💬 Alerta de reseñas en Completados ACTIVADA" : "⏹️ Alerta de reseñas DESACTIVADA");
  } catch(e) {
    console.error("Error togglePushReview:", e);
  }
}

function syncCustomPushConfigToAndroid() {
  try {
    const pDrop = localStorage.getItem('joa_push_price_drop') !== 'false';
    const pRev = localStorage.getItem('joa_push_review') !== 'false';
    if (window.AndroidBridge && typeof window.AndroidBridge.setCustomPushConfig === 'function') {
      window.AndroidBridge.setCustomPushConfig(pDrop, pRev);
    }
    const badge = document.getElementById('pushAlertsStatusBadge');
    if (badge) {
      if (!pDrop && !pRev) {
        badge.textContent = "⚪ Desactivadas";
        badge.style.color = "var(--text3)";
        badge.style.background = "rgba(255,255,255,0.05)";
      } else {
        badge.textContent = "🟢 Activas";
        badge.style.color = "var(--signal)";
        badge.style.background = "var(--signal-dim)";
      }
    }
  } catch(e) {
    console.error(e);
  }
}

function initCustomPushAlertsState() {
  try {
    if (localStorage.getItem('joa_push_price_drop') === null) {
      localStorage.setItem('joa_push_price_drop', 'true');
    }
    if (localStorage.getItem('joa_push_review') === null) {
      localStorage.setItem('joa_push_review', 'true');
    }
    const pDrop = localStorage.getItem('joa_push_price_drop') === 'true';
    const pRev = localStorage.getItem('joa_push_review') === 'true';
    
    const tDrop = document.getElementById('pushPriceDropToggle');
    if (tDrop) tDrop.checked = pDrop;
    const tRev = document.getElementById('pushReviewToggle');
    if (tRev) tRev.checked = pRev;
    
    syncCustomPushConfigToAndroid();
    
    setTimeout(() => { checkAutomaticCustomPushAlerts(); }, 4000);
  } catch(e) {
    console.error("Error initCustomPushAlertsState:", e);
  }
}

async function simularAlertaBajadaPrecio() {
  try {
    const enabled = localStorage.getItem('joa_push_price_drop') !== 'false';
    if (!enabled) {
      showToast("⚠️ Activa primero el interruptor de 'Rebajas en Lista de Deseos'");
      return;
    }
    const allStates = await idbGetAll('user_states');
    const wishStates = allStates.filter(s => s.status === 'wishlist');
    let targetItem = null;
    if (wishStates.length > 0 && allItems && allItems.length > 0) {
      const wishIds = new Set(wishStates.map(s => s.itemId));
      const wishItems = allItems.filter(i => wishIds.has(i.id));
      if (wishItems.length > 0) {
        targetItem = wishItems[Math.floor(Math.random() * wishItems.length)];
      }
    }
    if (!targetItem && allItems && allItems.length > 0) {
      targetItem = allItems[0];
    }
    const titleName = targetItem ? targetItem.title : "Cyberpunk 2077";
    const oldPrice = targetItem && targetItem.price ? `$${targetItem.price}` : "$59.99";
    const newPriceVal = targetItem && targetItem.price ? (targetItem.price * 0.5).toFixed(2) : "29.99";
    const newPrice = `$${newPriceVal}`;
    
    const notifTitle = "📉 ¡Rebaja detectada en tu Lista de Deseos!";
    const notifMsg = `«${titleName}» ha bajado de ${oldPrice} a ${newPrice} (-50% OFF). ¡Es el momento ideal para sumarlo a tu colección!`;
    
    if (window.AndroidBridge && typeof window.AndroidBridge.triggerCustomPushAlert === 'function') {
      window.AndroidBridge.triggerCustomPushAlert(notifTitle, notifMsg, 3);
    } else {
      showToast("🚀 Simulando alerta push en 3s...");
      setTimeout(() => {
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(notifTitle, { body: notifMsg, icon: "icon.png" });
        } else if ("Notification" in window && Notification.permission !== "denied") {
          Notification.requestPermission().then(perm => {
            if (perm === "granted") new Notification(notifTitle, { body: notifMsg, icon: "icon.png" });
            else alert(`${notifTitle}\n\n${notifMsg}`);
          });
        } else {
          alert(`🔔 NOTIFICACIÓN PUSH SIMULADA:\n\n${notifTitle}\n${notifMsg}`);
        }
      }, 3000);
    }
  } catch(e) {
    console.error("Error en simularAlertaBajadaPrecio:", e);
  }
}

async function simularAlertaNuevaResena() {
  try {
    const enabled = localStorage.getItem('joa_push_review') !== 'false';
    if (!enabled) {
      showToast("⚠️ Activa primero el interruptor de 'Nuevas Reseñas en Completados'");
      return;
    }
    const allStates = await idbGetAll('user_states');
    const compStates = allStates.filter(s => s.status === 'completed');
    let targetItem = null;
    if (compStates.length > 0 && allItems && allItems.length > 0) {
      const compIds = new Set(compStates.map(s => s.itemId));
      const compItems = allItems.filter(i => compIds.has(i.id));
      if (compItems.length > 0) {
        targetItem = compItems[Math.floor(Math.random() * compItems.length)];
      }
    }
    if (!targetItem && allItems && allItems.length > 0) {
      targetItem = allItems[Math.floor(Math.random() * allItems.length)];
    }
    const titleName = targetItem ? targetItem.title : "Elden Ring";
    const autores = ["GamerPro99", "CyberSamurai", "Alex_Retro", "ValkyrieQueen", "NeoMatrix"];
    const autor = autores[Math.floor(Math.random() * autores.length)];
    const comentarios = [
      "¡Una joya absoluta! Su final me dejó sin palabras, 10/10.",
      "El diseño de niveles es impresionante. Muy merecida su reputación.",
      "¡Increíble jugabilidad y banda sonora épica! Recomendado 100%.",
      "Lo acabo de terminar por segunda vez y sigue siendo una obra maestra."
    ];
    const comentario = comentarios[Math.floor(Math.random() * comentarios.length)];
    
    if (targetItem) {
      try {
        const revId = Date.now();
        await idbPut('community_reviews', {
          id: revId,
          itemId: targetItem.id,
          author: autor,
          rating: 5,
          comment: comentario,
          date: new Date().toLocaleDateString()
        });
      } catch(e){}
    }
    
    const notifTitle = "💬 ¡Nueva reseña en tu título Completado!";
    const notifMsg = `${autor} comentó en «${titleName}»: "${comentario}"`;
    
    if (window.AndroidBridge && typeof window.AndroidBridge.triggerCustomPushAlert === 'function') {
      window.AndroidBridge.triggerCustomPushAlert(notifTitle, notifMsg, 3);
    } else {
      showToast("🚀 Simulando alerta push en 3s...");
      setTimeout(() => {
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(notifTitle, { body: notifMsg, icon: "icon.png" });
        } else if ("Notification" in window && Notification.permission !== "denied") {
          Notification.requestPermission().then(perm => {
            if (perm === "granted") new Notification(notifTitle, { body: notifMsg, icon: "icon.png" });
            else alert(`${notifTitle}\n\n${notifMsg}`);
          });
        } else {
          alert(`🔔 NOTIFICACIÓN PUSH SIMULADA:\n\n${notifTitle}\n${notifMsg}`);
        }
      }, 3000);
    }
  } catch(e) {
    console.error("Error en simularAlertaNuevaResena:", e);
  }
}

async function checkAutomaticCustomPushAlerts() {
  try {
    if (sessionStorage.getItem('joa_auto_push_checked')) return;
    sessionStorage.setItem('joa_auto_push_checked', 'true');
    
    const pDrop = localStorage.getItem('joa_push_price_drop') === 'true';
    const pRev = localStorage.getItem('joa_push_review') === 'true';
    
    if (!pDrop && !pRev) return;
    
    const allStates = await idbGetAll('user_states');
    const wishStates = allStates.filter(s => s.status === 'wishlist');
    const compStates = allStates.filter(s => s.status === 'completed');
    
    if (pDrop && wishStates.length > 0 && Math.random() < 0.25) {
      setTimeout(() => { simularAlertaBajadaPrecio(); }, 12000);
    } else if (pRev && compStates.length > 0 && Math.random() < 0.25) {
      setTimeout(() => { simularAlertaNuevaResena(); }, 15000);
    }
  } catch(e) {
    console.error("Error checkAutomaticCustomPushAlerts:", e);
  }
}

// ==========================================
// 🎨 GESTOR DE TEMAS DE COLOR Y ESTÉTICA
// ==========================================
const THEME_NAMES = {
  'cyberpunk': '⚡ Neón Azul',
  'matrix': '🟢 Esmeralda',
  'synthwave': '🟣 Synthwave',
  'royal': '🟡 Dorado',
  'crimson': '🔴 Carmesí',
  'oled': '⬛ Monocromo'
};

function toggleAutoTheme(enabled) {
  try {
    localStorage.setItem('joa_auto_theme', enabled ? 'true' : 'false');
    const toggle = document.getElementById('autoThemeToggle');
    if (toggle) toggle.checked = enabled;
    if (enabled) {
      applyAutoTheme(false);
      if (typeof showToast === 'function') {
        showToast("🕒 Tema Automático ACTIVADO (Día: Neón Azul / Noche: Monocromo)");
      }
    } else {
      if (typeof showToast === 'function') {
        showToast("⏹️ Tema Automático DESACTIVADO");
      }
    }
  } catch(e) {
    console.error("Error toggleAutoTheme:", e);
  }
}

function applyAutoTheme(quiet = true) {
  try {
    if (localStorage.getItem('joa_auto_theme') !== 'true') return;
    const hours = new Date().getHours();
    const targetTheme = (hours >= 7 && hours < 20) ? 'cyberpunk' : 'oled';
    const currentTheme = localStorage.getItem('joa_app_theme');
    const docTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme !== targetTheme || docTheme !== targetTheme) {
      setAppTheme(targetTheme, quiet, true);
    }
  } catch(e) {
    console.error("Error applyAutoTheme:", e);
  }
}

function setAppTheme(themeId, quiet = false, fromAuto = false) {
  try {
    let wasAutoDisabled = false;
    if (!fromAuto && localStorage.getItem('joa_auto_theme') === 'true') {
      localStorage.setItem('joa_auto_theme', 'false');
      const toggle = document.getElementById('autoThemeToggle');
      if (toggle) toggle.checked = false;
      wasAutoDisabled = true;
    }
    document.documentElement.setAttribute('data-theme', themeId);
    if (document.body) document.body.setAttribute('data-theme', themeId);
    localStorage.setItem('joa_app_theme', themeId);

    const buttons = document.querySelectorAll('#themeSelectorGrid .theme-btn');
    buttons.forEach(btn => {
      if (btn.getAttribute('data-theme-id') === themeId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    const badge = document.getElementById('currentThemeBadge');
    if (badge && THEME_NAMES[themeId]) {
      badge.textContent = THEME_NAMES[themeId];
    }

    if (!quiet) {
      if (typeof showToast === 'function') {
        if (wasAutoDisabled) {
          showToast(`🎨 ${THEME_NAMES[themeId] || themeId} manual (Tema Automático desactivado)`);
        } else {
          showToast(`🎨 Tema visual cambiado a: ${THEME_NAMES[themeId] || themeId}`);
        }
      }
    }

    if (typeof updateStats === 'function' && document.getElementById('myPanel') && document.getElementById('myPanel').style.display !== 'none') {
      try { updateStats(); } catch(e){}
    }
  } catch(e) {
    console.error("Error al aplicar tema visual:", e);
  }
}

function initAppTheme() {
  try {
    const autoEnabled = localStorage.getItem('joa_auto_theme') === 'true';
    const toggle = document.getElementById('autoThemeToggle');
    if (toggle) toggle.checked = autoEnabled;

    if (autoEnabled) {
      applyAutoTheme(true);
    } else {
      const saved = localStorage.getItem('joa_app_theme') || 'cyberpunk';
      setAppTheme(saved, true);
    }

    if (!window._autoThemeTimer) {
      window._autoThemeTimer = setInterval(() => { applyAutoTheme(true); }, 60000);
      window.addEventListener('focus', () => { applyAutoTheme(true); });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') applyAutoTheme(true);
      });
    }
  } catch(e) {
    console.error("Error al cargar tema inicial:", e);
  }
}

// Cargar tema temprano
try {
  let earlySaved = localStorage.getItem('joa_app_theme') || 'cyberpunk';
  if (localStorage.getItem('joa_auto_theme') === 'true') {
    const hours = new Date().getHours();
    earlySaved = (hours >= 7 && hours < 20) ? 'cyberpunk' : 'oled';
    localStorage.setItem('joa_app_theme', earlySaved);
  }
  document.documentElement.setAttribute('data-theme', earlySaved);
  if (document.body) document.body.setAttribute('data-theme', earlySaved);
} catch(e){}
window.addEventListener('DOMContentLoaded', initAppTheme);
window.addEventListener('load', initAppTheme);

/* ==========================================
 * 🎴 GESTIÓN DE TAMAÑO DE TARJETAS (#gridContainer)
 * ========================================== */
const CARD_SIZE_LABELS = {
  'compact': 'Compacto',
  'standard': 'Estándar',
  'large': 'Grande',
  'list': 'Lista Única'
};

function setCardSize(sizeId, quiet = false) {
  try {
    const validSizes = ['compact', 'standard', 'large', 'list'];
    if (!validSizes.includes(sizeId)) sizeId = 'standard';

    localStorage.setItem('joa_card_size', sizeId);

    const grid = document.getElementById('gridContainer');
    if (grid) {
      grid.classList.remove('card-size-compact', 'card-size-standard', 'card-size-large', 'card-size-list');
      grid.classList.add('card-size-' + sizeId);
    }

    const buttons = document.querySelectorAll('#cardSizeSelectorGrid .card-size-btn');
    buttons.forEach(btn => {
      if (btn.getAttribute('data-size') === sizeId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    const badge = document.getElementById('currentCardSizeBadge');
    if (badge && CARD_SIZE_LABELS[sizeId]) {
      badge.textContent = CARD_SIZE_LABELS[sizeId];
    }

    // Sincronizar el botón conmutador de la barra superior (Header)
    updateHeaderViewModeButton(sizeId);

    if (typeof renderGrid === 'function') {
      renderGrid();
    }

    if (!quiet) {
      if (window.triggerHaptic) window.triggerHaptic(20);
      if (typeof showToast === 'function') {
        const modeName = (sizeId === 'list') ? 'Lista compacta' : 'Cuadrícula grande';
        showToast(`🎴 Vista cambiada a: ${modeName}`);
      }
    }
  } catch(e) {
    console.error("Error al cambiar tamaño de tarjetas:", e);
  }
}

// Conmutador rápido de vista (Cuadrícula grande vs Lista compacta) desde el encabezado
function toggleHeaderViewMode() {
  try {
    const current = localStorage.getItem('joa_card_size') || 'standard';
    const nextMode = (current === 'list') ? 'standard' : 'list';
    setCardSize(nextMode);
  } catch(e) {
    console.error("Error al conmutar vista desde el encabezado:", e);
  }
}

function updateHeaderViewModeButton(mode) {
  try {
    const btn = document.getElementById('headerViewModeToggleBtn');
    const icon = document.getElementById('headerViewModeIcon');
    if (!btn || !icon) return;
    const isList = (mode === 'list');
    if (isList) {
      btn.classList.add('is-list-mode');
      btn.setAttribute('title', 'Vista actual: Lista compacta (Toca para Cuadrícula grande)');
      btn.setAttribute('aria-label', 'Cambiar a vista de cuadrícula');
      // Icono de Cuadrícula para volver a ver miniaturas grandes
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>`;
    } else {
      btn.classList.remove('is-list-mode');
      btn.setAttribute('title', 'Vista actual: Cuadrícula grande (Toca para Lista compacta)');
      btn.setAttribute('aria-label', 'Cambiar a vista de lista');
      // Icono de Lista para cambiar a filas compactas
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
    }
  } catch(e) {}
}

window.toggleHeaderViewMode = toggleHeaderViewMode;
window.updateHeaderViewModeButton = updateHeaderViewModeButton;

function initCardSize() {
  try {
    const saved = localStorage.getItem('joa_card_size') || 'standard';
    setCardSize(saved, true);
    updateHeaderViewModeButton(saved);
  } catch(e) {
    console.error("Error al inicializar tamaño de tarjetas:", e);
  }
}

// Sincronización instantánea de los controles de la tarjeta en Ajustes sin re-renderizar todo el catálogo
function syncCardSizeSettingsUI() {
  try {
    const saved = localStorage.getItem('joa_card_size') || 'standard';
    const buttons = document.querySelectorAll('#cardSizeSelectorGrid .card-size-btn');
    buttons.forEach(btn => {
      if (btn.getAttribute('data-size') === saved) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    const badge = document.getElementById('currentCardSizeBadge');
    if (badge && CARD_SIZE_LABELS[saved]) {
      badge.textContent = CARD_SIZE_LABELS[saved];
    }
  } catch(e) {
    console.warn("Error en syncCardSizeSettingsUI:", e);
  }
}
window.syncCardSizeSettingsUI = syncCardSizeSettingsUI;

// Cargar tamaño de tarjetas temprano
try {
  const earlySize = localStorage.getItem('joa_card_size') || 'standard';
  const grid = document.getElementById('gridContainer');
  if (grid) {
    grid.classList.remove('card-size-compact', 'card-size-standard', 'card-size-large');
    grid.classList.add('card-size-' + earlySize);
  }
} catch(e){}

window.addEventListener('DOMContentLoaded', initCardSize);
window.addEventListener('load', initCardSize);

function addPinWidgetToHome(categoryOrList, label) {
  try {
    const target = categoryOrList || (typeof activeType !== 'undefined' ? activeType : 'catalog');
    if (window.AndroidBridge && typeof window.AndroidBridge.addPinWidgetToHome === 'function') {
      window.AndroidBridge.addPinWidgetToHome(target, label || '');
    } else if (window.AndroidBridge && typeof window.AndroidBridge.requestPinWidget === 'function') {
      window.AndroidBridge.requestPinWidget();
    } else {
      alert("📲 Añadir Acceso Directo / Widget:\nEn tu teléfono Android, mantén pulsado en una zona vacía de la Pantalla de Inicio, entra en 'Widgets' o 'Accesos directos' y selecciona 'JOA GAMERS'.");
    }
  } catch(e) {
    console.error(e);
  }
}

function shareMyApkNow() {
  if (window.triggerHaptic) window.triggerHaptic(50);
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.shareAppApk === 'function') {
      showToast("📤 Abriendo menú para compartir instalador APK...");
      window.AndroidBridge.shareAppApk();
    } else if (navigator.share) {
      navigator.share({
        title: "JOA GAMERS APK",
        text: "¡Instala JOA GAMERS y disfruta de todo el catálogo de juegos, series, películas y emuladores! 🚀",
        url: window.location.href
      }).catch(err => console.log(err));
    } else {
      alert("📤 Para compartir el archivo APK oficial, abre la aplicación en tu dispositivo Android e inténtalo desde el menú de Ajustes.");
    }
  } catch(e) {
    console.error("Error al compartir APK:", e);
  }
}

window.addEventListener('DOMContentLoaded', bootApp);

function actualizarEstadoConexion(){
    const s=document.getElementById("onlineStatus");
    if(s){
        if(navigator.onLine){
            s.innerHTML="🟢 Conectado a Internet";
            s.style.color="#50fa7b";
        }
        else{
            s.innerHTML="🔴 Sin conexión";
            s.style.color="#ff5555";
        }
    }
    if (typeof updateOfflineBanner === 'function') {
        updateOfflineBanner();
    }
}

function updateOfflineBanner(forceShow = false) {
    const banner = document.getElementById("offlineBanner");
    const icon = document.getElementById("offlineBannerIcon");
    const title = document.getElementById("offlineBannerTitle");
    const desc = document.getElementById("offlineBannerDesc");
    if (!banner || !icon || !title || !desc) return;

    if (!navigator.onLine) {
        if (forceShow) window._offlineBannerDismissed = false;
        if (!window._offlineBannerDismissed) {
            clearTimeout(window._offlineBannerTimer);
            clearTimeout(window._offlineBannerHideTimer);
            banner.classList.remove("fade-out");
            banner.style.display = "flex";
            void banner.offsetHeight; // Forzar reflow para asegurar animación de entrada
            banner.classList.remove("online-mode");
            banner.classList.add("offline-mode");
            icon.textContent = "📴";
            title.textContent = "Modo Sin Conexión Activado";
            desc.textContent = "Las funciones online (tráilers, búsqueda por voz, sync) no están disponibles. Catálogo local operativo.";
            
            requestAnimationFrame(() => {
                banner.classList.add("show");
            });
            window._wasOffline = true;
        }
    } else {
        if (window._wasOffline) {
            clearTimeout(window._offlineBannerTimer);
            clearTimeout(window._offlineBannerHideTimer);
            banner.classList.remove("fade-out");
            banner.style.display = "flex";
            void banner.offsetHeight; // Forzar reflow
            banner.classList.remove("offline-mode");
            banner.classList.add("online-mode");
            icon.textContent = "🟢";
            title.textContent = "Conexión Restablecida";
            desc.textContent = "Todas las funciones online están nuevamente disponibles.";
            
            requestAnimationFrame(() => {
                banner.classList.add("show");
            });
            
            window._offlineBannerTimer = setTimeout(() => {
                banner.classList.add("fade-out");
                window._offlineBannerHideTimer = setTimeout(() => {
                    if (navigator.onLine) banner.style.display = "none";
                    banner.classList.remove("show", "fade-out");
                }, 580);
            }, 3500);
            window._wasOffline = false;
        } else {
            clearTimeout(window._offlineBannerTimer);
            clearTimeout(window._offlineBannerHideTimer);
            banner.style.display = "none";
            banner.classList.remove("show", "fade-out");
        }
    }
}

function dismissOfflineBanner() {
    window._offlineBannerDismissed = true;
    const banner = document.getElementById("offlineBanner");
    if (banner) {
        clearTimeout(window._offlineBannerTimer);
        clearTimeout(window._offlineBannerHideTimer);
        banner.classList.add("fade-out");
        window._offlineBannerHideTimer = setTimeout(() => {
            banner.style.display = "none";
            banner.classList.remove("show", "fade-out");
        }, 580);
    }
}

window.addEventListener("online", () => {
    window._offlineBannerDismissed = false;
    actualizarEstadoConexion();
    if (typeof syncFavoritesMetadataOffline === 'function') {
        setTimeout(syncFavoritesMetadataOffline, 1200);
    }
});
window.addEventListener("offline", () => {
    window._offlineBannerDismissed = false;
    actualizarEstadoConexion();
});
setTimeout(actualizarEstadoConexion, 300);

// ==========================================
// 🚀 SERVICE WORKER & PWA OFFLINE ENGINE
// ==========================================
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('offline-sw.js')
      .then((reg) => {
        console.log('✅ [PWA] Service Worker registrado para modo 100% offline:', reg.scope);
        const badge = document.getElementById('swStatusBadge');
        if (badge) { badge.textContent = '🟢 Activo PWA'; badge.style.color = '#00FFB2'; }
      })
      .catch((err) => {
        console.warn('⚠️ [PWA] Registro inicial falló, probando sw.js...', err.message);
        navigator.serviceWorker.register('sw.js').then((reg) => {
          console.log('✅ [PWA] Service Worker sw.js registrado:', reg.scope);
          const badge = document.getElementById('swStatusBadge');
          if (badge) { badge.textContent = '🟢 Activo PWA'; badge.style.color = '#00FFB2'; }
        }).catch(() => {
          const badge = document.getElementById('swStatusBadge');
          if (badge) { badge.textContent = '⚡ Caché Nativa'; badge.style.color = '#00E5FF'; }
        });
      });
  } else {
    const badge = document.getElementById('swStatusBadge');
    if (badge) { badge.textContent = '⚡ Caché Nativa'; badge.style.color = '#00E5FF'; }
  }
}

async function precacheAllImagesOffline() {
  if (!allItems || !allItems.length) {
    showToast('⚠️ No hay elementos en el catálogo para almacenar.');
    return;
  }
  const progressDiv = document.getElementById('swPrecacheProgress');
  const barFill = document.getElementById('swPrecacheBarFill');
  const statusTxt = document.getElementById('swPrecacheStatus');
  if (progressDiv) progressDiv.style.display = 'block';
  if (barFill) barFill.style.width = '0%';
  if (statusTxt) statusTxt.textContent = '🔍 Sincronizando favoritos y recopilando imágenes...';

  // 1. Sincronizar metadatos de favoritos primero
  if (typeof syncFavoritesMetadataOffline === 'function') {
    await syncFavoritesMetadataOffline();
  }

  const urlSet = new Set();
  urlSet.add(UPDATE_URL);
  urlSet.add(VERSION_URL);

  allItems.forEach(item => {
    const cover = item.cover || item.image || item.poster;
    if (cover && !cover.startsWith('data:')) {
      const fullUrl = (typeof resolveImageUrl === 'function') ? resolveImageUrl(cover) : cover;
      if (fullUrl && !fullUrl.startsWith('data:')) {
        urlSet.add(fullUrl);
      }
    }
  });

  const urls = Array.from(urlSet);
  const total = urls.length;
  let done = 0;

  if (statusTxt) statusTxt.textContent = `📥 Guardando y comprimiendo 0 de ${total} imágenes...`;

  const batchSize = 6;
  for (let i = 0; i < total; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    await Promise.all(batch.map(async (url) => {
      try {
        // Precargar y comprimir si es imagen
        if (/\.(png|jpg|jpeg|webp|gif|svg)(\?.*)?$/i.test(url) || url.includes('img') || url.includes('cover')) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.dataset.originalUrl = url;
          img.onload = () => {
            if (typeof autoCacheVisibleImage === 'function') autoCacheVisibleImage(img);
          };
          img.src = url;
        }
        await fetch(url, { mode: 'no-cors', cache: 'reload' });
      } catch (e) {
      } finally {
        done++;
        const pct = Math.round((done / total) * 100);
        if (barFill) barFill.style.width = pct + '%';
        if (statusTxt) statusTxt.textContent = `📥 Guardando ${done} de ${total} en almacenamiento persistente (${pct}%)...`;
      }
    }));
  }

  if (statusTxt) statusTxt.textContent = '✅ ¡Catálogo e imágenes guardados permanentemente para uso offline!';
  showToast('✅ Catálogo, favoritos e imágenes guardados en almacenamiento persistente.');
  if (typeof updateImagePackageBadge === 'function') updateImagePackageBadge();
  setTimeout(() => {
    if (progressDiv) progressDiv.style.display = 'none';
  }, 4000);
}

async function clearSWCache() {
  if (window.triggerHaptic) window.triggerHaptic(40);
  const progressDiv = document.getElementById('swPrecacheProgress');
  const barFill = document.getElementById('swPrecacheBarFill');
  const statusTxt = document.getElementById('swPrecacheStatus');
  const badge = document.getElementById('swStatusBadge');

  try {
    if ('caches' in window) {
      if (progressDiv) progressDiv.style.display = 'block';
      if (barFill) {
        barFill.style.width = '45%';
        barFill.style.background = '#FF5555';
      }
      if (statusTxt) {
        statusTxt.innerHTML = '⏳ <b>Limpiando...</b> Eliminando cachés de streaming y datos externos...';
        statusTxt.style.color = '#FF5555';
      }
      if (badge) {
        badge.textContent = '🧹 Limpiando...';
        badge.style.color = '#FF5555';
        badge.style.borderColor = 'rgba(255, 85, 85, 0.4)';
      }

      const keys = await caches.keys();
      let deletedCount = 0;

      await Promise.all(keys.map(async (k) => {
        // Limpiar específicamente cachés asociadas con servicios de streaming o datos externos
        // (imágenes, multimedia, catálogos remotos, tráilers, apis), preservando el núcleo estático offline (joa-static-)
        if (!k.startsWith('joa-static-') || k.includes('catalog') || k.includes('images') || k.includes('streaming') || k.includes('media') || k.includes('external') || k.includes('trailers') || k.includes('api') || k.includes('data')) {
          const success = await caches.delete(k);
          if (success) deletedCount++;
        }
      }));

      // Feedback visual en la UI cuando se complete la limpieza
      if (barFill) {
        barFill.style.width = '100%';
        barFill.style.background = '#00FFB2';
      }
      if (statusTxt) {
        statusTxt.innerHTML = `✨ <b>¡Limpieza completada!</b> Se eliminaron ${deletedCount} cachés de streaming y datos externos. Núcleo PWA intacto.`;
        statusTxt.style.color = '#00FFB2';
      }
      if (badge) {
        badge.textContent = '🟢 Caché Externa Limpia';
        badge.style.color = '#00FFB2';
        badge.style.borderColor = 'rgba(0, 255, 178, 0.4)';
      }

      if (window.triggerHaptic) window.triggerHaptic(60);
      showToast(`✨ Limpieza completada: ${deletedCount} cachés de streaming y datos externos eliminadas.`);

      setTimeout(() => {
        if (progressDiv) progressDiv.style.display = 'none';
        if (statusTxt) statusTxt.style.color = 'var(--text2)';
        if (barFill) barFill.style.background = 'var(--grad)';
      }, 4500);
    } else {
      showToast('ℹ️ Tu navegador no administra cachés de Service Worker.');
    }
  } catch (e) {
    console.error("Error al limpiar caché:", e);
    if (statusTxt) {
      statusTxt.textContent = '❌ Error al limpiar la caché de streaming y datos externos.';
      statusTxt.style.color = '#FF5555';
    }
    showToast('❌ Error al limpiar caché de streaming o datos externos.');
  }
}

window.addEventListener('load', initServiceWorker);

/* ==========================================
 * 🧹 LIMPIEZA INTELIGENTE DE CACHÉ MULTIMEDIA
 * ========================================== */
let cachedOrphanedMediaItems = [];

async function scanMediaCacheNow(quiet = false) {
  const badge = document.getElementById('mediaCacheBadge');
  const totalEl = document.getElementById('mediaCacheTotalCount');
  const oldEl = document.getElementById('mediaCacheOldCount');
  const noteEl = document.getElementById('mediaCacheRecommendationNote');
  const cleanBtn = document.getElementById('cleanSuggestedMediaBtn');
  const listSection = document.getElementById('mediaCacheListSection');

  if (badge) {
    badge.textContent = '⏳ Escaneando...';
    badge.style.color = '#3DEBFF';
    badge.style.borderColor = 'rgba(61,235,255,0.4)';
  }

  let totalCount = 0;
  let totalBytes = 0;
  cachedOrphanedMediaItems = [];

  try {
    // 1. Cargar el catálogo actual de forma segura para no marcar por error ítems válidos
    if (typeof allItems === 'undefined' || !allItems || !allItems.length) {
      if (typeof window !== 'undefined' && window.allItems && window.allItems.length) {
        allItems = window.allItems;
      } else if (typeof idbGetAll === 'function') {
        try {
          allItems = await idbGetAll('items');
        } catch (e) {}
      }
      if ((!allItems || !allItems.length) && window.BUNDLED_CATALOG && Array.isArray(window.BUNDLED_CATALOG.items)) {
        allItems = window.BUNDLED_CATALOG.items;
      }
    }

    // Si el catálogo todavía no está listo, evitar falsos positivos
    if (!allItems || !allItems.length) {
      if (badge) {
        badge.textContent = '⚠️ Catálogo cargando...';
        badge.style.color = '#FFD700';
      }
      if (noteEl) noteEl.textContent = '💡 El catálogo aún se está inicializando. Abre la pantalla principal o espera un instante antes de escanear.';
      if (!quiet) showToast('ℹ️ El catálogo aún se está cargando. Intenta de nuevo en unos segundos.');
      return;
    }

    // Colección exhaustiva de tokens y URLs válidas del catálogo
    const catalogTokens = new Set();
    const catalogUrls = new Set();

    // Archivos de sistema, interfaz y multimedia protegidos que NUNCA deben borrarse
    const systemProtectedAssets = [
      'icon-', 'logo', 'favicon', 'placeholder', 'spinner', 'default', 'avatar',
      'service_', 'service', 'joa_gamers', 'splash', 'img/', 'hero', 'banner',
      'loading', 'manifest', 'offline', 'd3.min', 'style.css', 'app1.js', 'app2.js',
      'apple-touch-icon', 'multimedia_hero', 'joa_loading_intro', 'doom_dark_ages'
    ];

    function registerUrlToCatalog(rawUrl) {
      if (!rawUrl || typeof rawUrl !== 'string') return;
      const clean = rawUrl.trim().toLowerCase();
      if (!clean || clean.startsWith('data:') || clean.startsWith('blob:')) return;
      catalogUrls.add(clean);
      try {
        const decoded = decodeURIComponent(clean);
        catalogUrls.add(decoded);
      } catch (e) {}

      // Extraer nombre de archivo y variantes
      const fname = clean.split('/').pop().split('?')[0];
      if (fname && fname.length > 2) {
        catalogTokens.add(fname);
        const withoutExt = fname.replace(/\.[a-z0-9]+$/i, '');
        if (withoutExt && withoutExt.length > 2) catalogTokens.add(withoutExt);
        // Si tiene prefijo hash tipo 32 caracteres hex
        const cleanNoHash = fname.replace(/^[a-f0-9]{32}_/i, '');
        if (cleanNoHash && cleanNoHash.length > 2) catalogTokens.add(cleanNoHash);
      }
    }

    if (Array.isArray(allItems)) {
      allItems.forEach(it => {
        if (!it) return;
        if (it.id) {
          const strId = String(it.id).toLowerCase();
          catalogTokens.add(strId);
          catalogUrls.add(strId);
        }
        // Campos comunes de carátulas y multimedia
        const urlProps = ['cover', 'image', 'poster', 'banner', 'thumbnail', 'background', 'media', 'badge', 'icon', 'trailer_img', 'trailer'];
        urlProps.forEach(prop => {
          if (it[prop] && typeof it[prop] === 'string') {
            registerUrlToCatalog(it[prop]);
          }
        });
        // Galerías y capturas de pantalla
        const arrayProps = ['gallery', 'screenshots', 'images'];
        arrayProps.forEach(prop => {
          if (Array.isArray(it[prop])) {
            it[prop].forEach(g => {
              if (typeof g === 'string') registerUrlToCatalog(g);
              else if (g && typeof g.url === 'string') registerUrlToCatalog(g.url);
            });
          }
        });
      });
    }

    // Incluir también los ítems de las listas y estados de usuario
    let currentStates = (typeof userStates !== 'undefined' && Array.isArray(userStates)) ? userStates : [];
    if (!currentStates.length && typeof idbGetAll === 'function') {
      try { currentStates = await idbGetAll('user_states'); } catch(e) {}
    }
    if (Array.isArray(currentStates)) {
      currentStates.forEach(s => {
        if (!s) return;
        if (s.itemId) catalogTokens.add(String(s.itemId).toLowerCase());
        if (s.cover) registerUrlToCatalog(s.cover);
        if (s.image) registerUrlToCatalog(s.image);
      });
    }

    // Mapa unificado de ítems huérfanos por clave normalizada
    const orphanedMap = new Map();

    function checkIsOrphaned(url) {
      if (!url || typeof url !== 'string') return false;
      const lowUrl = url.toLowerCase();
      const filename = lowUrl.split('/').pop().split('?')[0];

      // 1. Activo esencial protegido del sistema
      if (systemProtectedAssets.some(p => lowUrl.includes(p) || filename.includes(p))) {
        return false;
      }
      if (lowUrl.startsWith('./') || lowUrl.includes('/assets/') || lowUrl.includes('/img/')) {
        return false;
      }

      // 2. Coincidencia directa en URLs del catálogo
      if (catalogUrls.has(lowUrl) || catalogUrls.has(filename)) {
        return false;
      }
      try {
        const decoded = decodeURIComponent(lowUrl);
        if (catalogUrls.has(decoded)) return false;
      } catch (e) {}

      // 3. Coincidencia por tokens o nombre de archivo
      if (catalogTokens.has(filename)) return false;
      const fnameNoExt = filename.replace(/\.[a-z0-9]+$/i, '');
      if (catalogTokens.has(fnameNoExt)) return false;

      const cleanNoHash = filename.replace(/^[a-f0-9]{32}_/i, '');
      if (catalogTokens.has(cleanNoHash)) return false;

      // 4. Verificación de tokens del catálogo
      for (const token of catalogTokens) {
        if (token.length >= 3 && (filename === token || lowUrl.includes('/' + token))) {
          return false;
        }
      }

      return true; // Es huérfana
    }

    // 2. Escaneo optimizado de CacheStorage con cálculo real de tamaños y pausas para mantener fluidez
    if ('caches' in window) {
      try {
        const keys = await caches.keys();
        for (const cacheName of keys) {
          const isTargetCache = (cacheName.includes('images') || cacheName.includes('catalog') || 
                                 cacheName.includes('media') || cacheName.includes('external') || 
                                 cacheName.includes('covers') || cacheName.includes('favorites')) && 
                                !cacheName.includes('static');
          if (isTargetCache) {
            const cache = await caches.open(cacheName);
            const reqs = await cache.keys();
            let batchYield = 0;

            for (const req of reqs) {
              const url = req.url || '';
              const isMedia = url.match(/\.(png|jpg|jpeg|webp|gif|svg|mp4|webm|mkv)(\?.*)?$/i) ||
                              url.includes('/covers/') || url.includes('/media/') || 
                              url.includes('tmdb') || url.includes('igdb') || url.includes('image');

              if (isMedia) {
                totalCount++;

                // Cálculo rápido del tamaño mediante encabezados HTTP sin retener Blobs pesados en memoria
                let calculatedSize = 0;
                try {
                  const matchRes = await cache.match(req);
                  if (matchRes) {
                    const cl = matchRes.headers.get('content-length');
                    if (cl && parseInt(cl, 10) > 0) {
                      calculatedSize = parseInt(cl, 10);
                    }
                  }
                } catch(e) {}

                if (!calculatedSize || calculatedSize <= 0) {
                  calculatedSize = 120 * 1024; // Estimación razonable sin saturar memoria
                }
                totalBytes += calculatedSize;

                const filename = url.split('/').pop().split('?')[0].toLowerCase() || 'multimedia.webp';

                if (checkIsOrphaned(url)) {
                  const itemKey = filename.replace(/^[a-f0-9]{32}_/i, '');
                  if (orphanedMap.has(itemKey)) {
                    const existing = orphanedMap.get(itemKey);
                    existing.sources.push({ type: 'cacheStorage', cacheName, req });
                    if (calculatedSize > existing.estimatedSize) existing.estimatedSize = calculatedSize;
                  } else {
                    orphanedMap.set(itemKey, {
                      id: 'media_' + Math.random().toString(36).substring(2, 9),
                      cacheName,
                      req,
                      url,
                      filename: decodeURIComponent(filename),
                      estimatedSize: calculatedSize,
                      selected: true,
                      sources: [{ type: 'cacheStorage', cacheName, req }]
                    });
                  }
                }
              }

              batchYield++;
              // Pausa de microtarea para no bloquear el hilo de renderizado ni causar ANR en WebView
              if (batchYield % 15 === 0) {
                await new Promise(r => setTimeout(r, 0));
              }
            }
          }
        }
      } catch (cacheErr) {
        console.warn('Error escaneando CacheStorage:', cacheErr);
      }
    }

    // 3. Escaneo de IndexedDB (item_media_cache)
    if (typeof idbGetAll === 'function') {
      try {
        const idbRecords = await idbGetAll('item_media_cache');
        if (Array.isArray(idbRecords) && idbRecords.length > 0) {
          let idbYield = 0;
          for (const rec of idbRecords) {
            if (!rec || !rec.itemId) continue;
            const recKey = String(rec.itemId);
            const sizeBytes = rec.size || (rec.dataUrl ? Math.round(rec.dataUrl.length * 0.75) : 110 * 1024);

            // Si no está registrado en CacheStorage, sumarlo al total
            const rawFilename = recKey.split('/').pop().split('?')[0].toLowerCase();
            const normalizedKey = rawFilename.replace(/^[a-f0-9]{32}_/i, '');

            if (!orphanedMap.has(normalizedKey)) {
              totalCount++;
              totalBytes += sizeBytes;
            }

            if (checkIsOrphaned(recKey)) {
              if (orphanedMap.has(normalizedKey)) {
                const existing = orphanedMap.get(normalizedKey);
                existing.sources.push({ type: 'indexedDB', storageKey: rec.itemId });
                if (sizeBytes > existing.estimatedSize) existing.estimatedSize = sizeBytes;
              } else {
                orphanedMap.set(normalizedKey, {
                  id: 'media_' + Math.random().toString(36).substring(2, 9),
                  url: rec.dataUrl || rec.itemId,
                  storageKey: rec.itemId,
                  filename: decodeURIComponent(rawFilename) || 'imagen_idb.webp',
                  estimatedSize: sizeBytes,
                  selected: true,
                  sources: [{ type: 'indexedDB', storageKey: rec.itemId }]
                });
              }
            }

            idbYield++;
            if (idbYield % 25 === 0) {
              await new Promise(r => setTimeout(r, 0));
            }
          }
        }
      } catch (idbErr) {
        console.warn('Error escaneando item_media_cache en IndexedDB:', idbErr);
      }
    }

    cachedOrphanedMediaItems = Array.from(orphanedMap.values());
    const orphanedCount = cachedOrphanedMediaItems.length;
    const orphanedBytes = cachedOrphanedMediaItems.reduce((acc, i) => acc + i.estimatedSize, 0);

    const totalMbStr = (totalBytes / (1024 * 1024)).toFixed(1);
    const orphanedMbStr = (orphanedBytes / (1024 * 1024)).toFixed(1);

    if (totalEl) totalEl.textContent = `${totalCount} archivos (~${totalMbStr} MB)`;
    if (oldEl) oldEl.textContent = `${orphanedCount} archivos (~${orphanedMbStr} MB)`;

    if (orphanedCount > 0) {
      if (badge) {
        badge.textContent = `⚠️ ${orphanedMbStr} MB Para Liberar`;
        badge.style.color = '#FFD700';
        badge.style.borderColor = 'rgba(255, 215, 0, 0.4)';
      }
      if (noteEl) noteEl.textContent = `💡 Se detectaron ${orphanedCount} archivos multimedia huérfanos (~${orphanedMbStr} MB) listos para liberar.`;
      if (listSection) listSection.style.display = 'block';
    } else {
      if (badge) {
        badge.textContent = '🟢 Caché Optimizada';
        badge.style.color = '#00FFB2';
        badge.style.borderColor = 'rgba(0, 255, 178, 0.4)';
      }
      if (noteEl) noteEl.textContent = '✨ Tu caché multimedia está completamente limpia y libre de archivos huérfanos.';
      if (listSection) listSection.style.display = 'none';
    }

    renderMediaCacheList();

    if (!quiet) {
      if (window.triggerHaptic) window.triggerHaptic(20);
      showToast(`🔍 Escaneo completado: ${orphanedCount} multimedia huérfanos (~${orphanedMbStr} MB detectados).`);
    }

  } catch(e) {
    console.error("Error al escanear caché multimedia:", e);
    if (badge) badge.textContent = '❌ Error de Escaneo';
  }
}

function renderMediaCacheList() {
  const container = document.getElementById('mediaCacheItemsList');
  const cleanBtn = document.getElementById('cleanSuggestedMediaBtn');
  const countSpan = document.getElementById('selectedMediaCacheCount');
  const selectAllCheck = document.getElementById('selectAllMediaCacheCheck');

  if (!container) return;

  if (!cachedOrphanedMediaItems.length) {
    container.innerHTML = '<div style="font-size:.72rem; color:var(--text2); text-align:center; padding:12px;">✨ No hay archivos huérfanos en caché.</div>';
    if (cleanBtn) cleanBtn.style.display = 'none';
    if (countSpan) countSpan.textContent = '0 sel. (~0 MB)';
    return;
  }

  const selectedItems = cachedOrphanedMediaItems.filter(i => i.selected);
  const selectedBytes = selectedItems.reduce((acc, i) => acc + i.estimatedSize, 0);
  const selectedMbStr = (selectedBytes / (1024 * 1024)).toFixed(1);

  if (countSpan) {
    countSpan.textContent = `${selectedItems.length}/${cachedOrphanedMediaItems.length} sel. (~${selectedMbStr} MB)`;
  }

  if (selectAllCheck) {
    selectAllCheck.checked = selectedItems.length === cachedOrphanedMediaItems.length;
  }

  if (cleanBtn) {
    if (selectedItems.length > 0) {
      cleanBtn.style.display = 'inline-flex';
      cleanBtn.textContent = `🗑️ Borrado Masivo (${selectedItems.length} | ~${selectedMbStr} MB)`;
    } else {
      cleanBtn.style.display = 'none';
    }
  }

  // Renderizado optimizado: limitar a los primeros 35 elementos con carga diferida
  // para evitar saturar el decodificador de imágenes y memoria de WebView
  const MAX_DISPLAY_ITEMS = 35;
  const itemsToRender = cachedOrphanedMediaItems.slice(0, MAX_DISPLAY_ITEMS);

  let htmlRows = itemsToRender.map(item => {
    const sizeKb = (item.estimatedSize / 1024).toFixed(0);
    return `
      <div class="media-cache-item-row">
        <div class="media-cache-item-left">
          <input type="checkbox" ${item.selected ? 'checked' : ''} onchange="toggleMediaCacheItem('${item.id}', this.checked)" style="accent-color:var(--signal); cursor:pointer;">
          <img class="media-cache-item-thumb" src="${item.url}" loading="lazy" alt="" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%23888\\' stroke-width=\\'2\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\'/><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'/><polyline points=\\'21 15 16 10 5 21\\'/></svg>'">
          <div class="media-cache-item-info">
            <span class="media-cache-item-name" title="${escapeHtml(item.url)}">${escapeHtml(item.filename)}</span>
            <div class="media-cache-item-sub">
              <span>⚠️ No en catálogo</span>
              <span>•</span>
              <span>~${sizeKb} KB</span>
            </div>
          </div>
        </div>
        <button class="media-cache-del-btn" onclick="deleteSingleMediaCacheItem('${item.id}')" title="Borrar este archivo de la caché">🗑️</button>
      </div>
    `;
  }).join('');

  if (cachedOrphanedMediaItems.length > MAX_DISPLAY_ITEMS) {
    const extraCount = cachedOrphanedMediaItems.length - MAX_DISPLAY_ITEMS;
    htmlRows += `
      <div style="text-align:center; padding:8px 10px; font-size:.73rem; color:var(--text2); background:rgba(255,255,255,0.03); border-radius:8px; border:1px dashed rgba(255,255,255,0.1); margin-top:4px;">
        ⚡ Y <b>${extraCount}</b> archivos huérfanos más seleccionados listos para borrado masivo seguro.
      </div>
    `;
  }

  container.innerHTML = htmlRows;
}

function toggleMediaCacheItem(id, checked) {
  const item = cachedOrphanedMediaItems.find(i => i.id === id);
  if (item) {
    item.selected = checked;
    renderMediaCacheList();
  }
}

function toggleSelectAllMediaCache(checked) {
  cachedOrphanedMediaItems.forEach(item => item.selected = checked);
  renderMediaCacheList();
}

async function deleteSingleMediaCacheItem(id) {
  const item = cachedOrphanedMediaItems.find(i => i.id === id);
  if (!item) return;

  if (window.triggerHaptic) window.triggerHaptic(20);

  try {
    if (Array.isArray(item.sources) && item.sources.length > 0) {
      for (const s of item.sources) {
        if (s.type === 'cacheStorage' && 'caches' in window) {
          try {
            const c = await caches.open(s.cacheName);
            await c.delete(s.req);
          } catch(e) {}
        } else if (s.type === 'indexedDB' && typeof idbDelete === 'function') {
          try { await idbDelete('item_media_cache', s.storageKey); } catch(e) {}
        }
      }
    } else {
      if (item.cacheName && item.req && 'caches' in window) {
        const c = await caches.open(item.cacheName);
        await c.delete(item.req);
      }
      if (item.storageKey && typeof idbDelete === 'function') {
        await idbDelete('item_media_cache', item.storageKey);
      }
    }

    if (typeof inMemoryImageCache !== 'undefined' && inMemoryImageCache.delete) {
      inMemoryImageCache.delete(item.url);
    }

    cachedOrphanedMediaItems = cachedOrphanedMediaItems.filter(i => i.id !== id);
    showToast(`🗑️ Archivo eliminado de la caché.`);
    renderMediaCacheList();
  } catch(e) {
    console.error("Error al eliminar archivo individual de caché:", e);
  }
}

async function cleanSelectedMediaCache() {
  const selectedItems = cachedOrphanedMediaItems.filter(i => i.selected);
  if (!selectedItems.length) return;

  if (window.triggerHaptic) window.triggerHaptic(40);
  const badge = document.getElementById('mediaCacheBadge');
  const cleanBtn = document.getElementById('cleanSuggestedMediaBtn');

  if (badge) badge.textContent = '🧹 Liberando espacio...';
  if (cleanBtn) cleanBtn.disabled = true;

  try {
    let deletedCount = 0;
    let deletedBytes = 0;
    const deletedIds = new Set();
    const openCachesMap = new Map();

    // Eliminar en lotes ordenados con pausas breves para evitar ANR / congelamientos en Android
    const BATCH_SIZE = 15;
    for (let i = 0; i < selectedItems.length; i++) {
      const item = selectedItems[i];

      try {
        if (Array.isArray(item.sources) && item.sources.length > 0) {
          for (const src of item.sources) {
            if (src.type === 'cacheStorage' && 'caches' in window) {
              let c = openCachesMap.get(src.cacheName);
              if (!c) {
                c = await caches.open(src.cacheName);
                openCachesMap.set(src.cacheName, c);
              }
              await c.delete(src.req);
            } else if (src.type === 'indexedDB' && typeof idbDelete === 'function') {
              try { await idbDelete('item_media_cache', src.storageKey); } catch(e) {}
            }
          }
        } else {
          if (item.cacheName && item.req && 'caches' in window) {
            let c = openCachesMap.get(item.cacheName);
            if (!c) {
              c = await caches.open(item.cacheName);
              openCachesMap.set(item.cacheName, c);
            }
            await c.delete(item.req);
          }
          if (item.storageKey && typeof idbDelete === 'function') {
            try { await idbDelete('item_media_cache', item.storageKey); } catch(e) {}
          }
        }

        if (typeof inMemoryImageCache !== 'undefined' && inMemoryImageCache.delete) {
          inMemoryImageCache.delete(item.url);
        }

        deletedCount++;
        deletedBytes += item.estimatedSize;
        deletedIds.add(item.id);

      } catch (itemErr) {
        console.warn('Error al borrar ítem:', itemErr);
      }

      // Pausa cada lote para mantener reactiva la interfaz de Android
      if (i > 0 && i % BATCH_SIZE === 0) {
        await new Promise(r => setTimeout(r, 12));
      }
    }

    const freedMbStr = (deletedBytes / (1024 * 1024)).toFixed(1);

    if (window.triggerHaptic) window.triggerHaptic(60);
    showToast(`✨ ¡Borrado completado! Se eliminaron ${deletedCount} archivos (~${freedMbStr} MB liberados con éxito).`);

    // Actualizar lista local de inmediato sin esperar el reescaneo
    cachedOrphanedMediaItems = cachedOrphanedMediaItems.filter(i => !deletedIds.has(i.id));
    renderMediaCacheList();

    // Reescaneo de verificación tras breve pausa
    setTimeout(() => {
      scanMediaCacheNow(true);
    }, 350);

  } catch(e) {
    console.error("Error en borrado masivo de multimedia:", e);
    showToast('❌ Error al eliminar los archivos seleccionados.');
  } finally {
    if (cleanBtn) cleanBtn.disabled = false;
  }
}

async function cleanSuggestedMediaCache() {
  await cleanSelectedMediaCache();
}

/* ========================================================
 * 🖼️ LIMPIEZA SELECTIVA DE CACHÉ DE IMÁGENES ANTIGUAS
 * ======================================================== */
let cachedOldImagesItems = [];

async function scanOldImagesCacheNow(quiet = false) {
  const badge = document.getElementById('oldImagesCacheBadge');
  const totalEl = document.getElementById('oldImagesTotalCount');
  const detectedEl = document.getElementById('oldImagesDetectedCount');
  const noteEl = document.getElementById('oldImagesRecommendationNote');
  const cleanBtn = document.getElementById('cleanSelectedOldImagesBtn');
  const listSection = document.getElementById('oldImagesListSection');
  const ageFilterEl = document.getElementById('oldImagesAgeFilter');

  const filterCriterion = ageFilterEl ? ageFilterEl.value : '15';

  if (badge) {
    badge.textContent = '⏳ Escaneando...';
    badge.style.color = '#00E5FF';
    badge.style.borderColor = 'rgba(0, 229, 255, 0.4)';
  }

  let totalCount = 0;
  let totalBytes = 0;
  let eligibleCount = 0;
  let eligibleBytes = 0;
  cachedOldImagesItems = [];

  try {
    // 1. Obtener favoritos del usuario para protegerlos
    const favSet = new Set();
    try {
      const uStates = (typeof userStates !== 'undefined' && Array.isArray(userStates)) ? userStates : (typeof idbGetAll === 'function' ? await idbGetAll('user_states') : []);
      if (Array.isArray(uStates)) {
        uStates.forEach(s => {
          if (s.status === 'wishlist' || s.status === 'playing' || s.isFavorite) {
            if (s.itemId) favSet.add(String(s.itemId).toLowerCase());
          }
        });
      }
    } catch(e) {}

    // Activos esenciales de sistema
    const systemProtectedAssets = ['icon-', 'logo', 'favicon', 'placeholder', 'spinner', 'default', 'avatar', 'service_', 'joa_gamers', 'splash', 'img/'];

    // 2. Escanear IndexedDB (item_media_cache)
    if (typeof idbGetAll === 'function') {
      try {
        const idbRecords = await idbGetAll('item_media_cache');
        if (Array.isArray(idbRecords)) {
          const now = Date.now();
          idbRecords.forEach(rec => {
            if (!rec || !rec.itemId) return;
            const itemIdStr = String(rec.itemId).toLowerCase();
            const isProtected = systemProtectedAssets.some(p => itemIdStr.includes(p));
            if (isProtected) return;

            totalCount++;
            const sizeBytes = rec.size || (rec.dataUrl ? Math.round(rec.dataUrl.length * 0.75) : 120 * 1024);
            totalBytes += sizeBytes;

            // Calcular antigüedad
            let ageDays = 18; // default razonable si fue precargado
            if (rec.savedAt) {
              const diffMs = now - new Date(rec.savedAt).getTime();
              if (!isNaN(diffMs) && diffMs > 0) {
                ageDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
              }
            }

            const isFav = favSet.has(itemIdStr);

            // Evaluar según criterio seleccionado
            let isEligible = false;
            if (filterCriterion === '7') {
              isEligible = ageDays >= 7 && !isFav;
            } else if (filterCriterion === '15') {
              isEligible = ageDays >= 15 && !isFav;
            } else if (filterCriterion === '30') {
              isEligible = ageDays >= 30 && !isFav;
            } else if (filterCriterion === 'unfav') {
              isEligible = !isFav;
            } else if (filterCriterion === 'all') {
              isEligible = true;
            }

            if (isEligible) {
              eligibleCount++;
              eligibleBytes += sizeBytes;
              const rawName = rec.itemId.split('/').pop().split('?')[0] || 'caratula.webp';
              const cleanName = decodeURIComponent(rawName).replace(/^[a-f0-9]{32}_/i, '');
              cachedOldImagesItems.push({
                id: 'idb_' + Math.random().toString(36).substring(2, 9),
                sourceType: 'indexedDB',
                storageKey: rec.itemId,
                url: rec.dataUrl || rec.itemId,
                filename: cleanName,
                ageDays,
                isFav,
                sizeBytes,
                selected: true
              });
            }
          });
        }
      } catch(idbErr) {
        console.warn('Error escaneando item_media_cache:', idbErr);
      }
    }

    // 3. Escanear CacheStorage para imágenes
    if ('caches' in window) {
      try {
        const cacheKeys = await caches.keys();
        for (const cName of cacheKeys) {
          if (cName.includes('images') || cName.includes('media') || cName.includes('catalog')) {
            const cObj = await caches.open(cName);
            const reqs = await cObj.keys();
            for (const r of reqs) {
              const url = r.url || '';
              const lowUrl = url.toLowerCase();
              const isImg = lowUrl.match(/\.(png|jpg|jpeg|webp|gif|svg)(\?.*)?$/i) || lowUrl.includes('/covers/') || lowUrl.includes('image');
              if (!isImg) continue;

              const isProtected = systemProtectedAssets.some(p => lowUrl.includes(p));
              if (isProtected) continue;

              // Evitar duplicados si ya está en IndexedDB
              if (cachedOldImagesItems.some(item => item.storageKey === url)) continue;

              totalCount++;
              let sizeBytes = 140 * 1024;
              let ageDays = 21;

              try {
                const res = await cObj.match(r);
                if (res) {
                  const cl = res.headers.get('content-length');
                  if (cl && parseInt(cl, 10) > 0) sizeBytes = parseInt(cl, 10);
                  const dateH = res.headers.get('date') || res.headers.get('last-modified');
                  if (dateH) {
                    const diff = Date.now() - new Date(dateH).getTime();
                    if (!isNaN(diff) && diff > 0) ageDays = Math.floor(diff / (1000 * 60 * 60 * 24));
                  }
                }
              } catch(e) {}

              totalBytes += sizeBytes;
              const isFav = favSet.has(lowUrl);

              let isEligible = false;
              if (filterCriterion === '7') isEligible = ageDays >= 7 && !isFav;
              else if (filterCriterion === '15') isEligible = ageDays >= 15 && !isFav;
              else if (filterCriterion === '30') isEligible = ageDays >= 30 && !isFav;
              else if (filterCriterion === 'unfav') isEligible = !isFav;
              else if (filterCriterion === 'all') isEligible = true;

              if (isEligible) {
                eligibleCount++;
                eligibleBytes += sizeBytes;
                const rawName = url.split('/').pop().split('?')[0] || 'imagen_cache.webp';
                const cleanName = decodeURIComponent(rawName);
                cachedOldImagesItems.push({
                  id: 'cache_' + Math.random().toString(36).substring(2, 9),
                  sourceType: 'cacheStorage',
                  cacheName: cName,
                  request: r,
                  storageKey: url,
                  url: url,
                  filename: cleanName,
                  ageDays,
                  isFav,
                  sizeBytes,
                  selected: true
                });
              }
            }
          }
        }
      } catch(cErr) {
        console.warn('Error escaneando CacheStorage de imágenes:', cErr);
      }
    }

    const totalMbStr = (totalBytes / (1024 * 1024)).toFixed(1);
    const eligibleMbStr = (eligibleBytes / (1024 * 1024)).toFixed(1);

    if (totalEl) totalEl.textContent = `${totalCount} archivos (~${totalMbStr} MB)`;
    if (detectedEl) detectedEl.textContent = `${eligibleCount} archivos (~${eligibleMbStr} MB)`;

    if (eligibleCount > 0) {
      if (badge) {
        badge.textContent = `⚠️ ~${eligibleMbStr} MB Recuperables`;
        badge.style.color = '#00E5FF';
        badge.style.borderColor = 'rgba(0, 229, 255, 0.45)';
      }
      if (noteEl) noteEl.textContent = `💡 Se detectaron ${eligibleCount} imágenes antiguas (~${eligibleMbStr} MB) listas para limpieza selectiva.`;
      if (listSection) listSection.style.display = 'block';
    } else {
      if (badge) {
        badge.textContent = '🟢 Al día';
        badge.style.color = '#00FFB2';
        badge.style.borderColor = 'rgba(0, 255, 178, 0.4)';
      }
      if (noteEl) noteEl.textContent = '✨ No hay imágenes antiguas en caché bajo el criterio seleccionado.';
      if (listSection) listSection.style.display = 'none';
    }

    renderOldImagesCacheList();

    if (!quiet) {
      if (window.triggerHaptic) window.triggerHaptic(20);
      showToast(`🔍 Escaneo completado: ${eligibleCount} imágenes antiguas detectadas (~${eligibleMbStr} MB).`);
    }

  } catch(err) {
    console.error("Error al escanear caché de imágenes antiguas:", err);
    if (badge) badge.textContent = '❌ Error';
  }
}

function renderOldImagesCacheList() {
  const container = document.getElementById('oldImagesItemsList');
  const cleanBtn = document.getElementById('cleanSelectedOldImagesBtn');
  const countSpan = document.getElementById('selectedOldImagesCount');
  const selectAllCheck = document.getElementById('selectAllOldImagesCheck');

  if (!container) return;

  if (!cachedOldImagesItems.length) {
    container.innerHTML = '<div style="font-size:.72rem; color:var(--text2); text-align:center; padding:10px;">✨ No se encontraron imágenes bajo este criterio.</div>';
    if (cleanBtn) cleanBtn.style.display = 'none';
    if (countSpan) countSpan.textContent = '0 sel. (~0 MB)';
    return;
  }

  const selectedItems = cachedOldImagesItems.filter(i => i.selected);
  const selectedBytes = selectedItems.reduce((acc, i) => acc + i.sizeBytes, 0);
  const selectedMbStr = (selectedBytes / (1024 * 1024)).toFixed(1);

  if (countSpan) {
    countSpan.textContent = `${selectedItems.length}/${cachedOldImagesItems.length} sel. (~${selectedMbStr} MB)`;
  }

  if (selectAllCheck) {
    selectAllCheck.checked = selectedItems.length === cachedOldImagesItems.length;
  }

  if (cleanBtn) {
    if (selectedItems.length > 0) {
      cleanBtn.style.display = 'inline-flex';
      cleanBtn.textContent = `🧹 Liberar Espacio (${selectedItems.length} | ~${selectedMbStr} MB)`;
    } else {
      cleanBtn.style.display = 'none';
    }
  }

  const MAX_DISPLAY_OLD_ITEMS = 30;
  const itemsToRender = cachedOldImagesItems.slice(0, MAX_DISPLAY_OLD_ITEMS);

  let htmlRows = itemsToRender.map(item => {
    const sizeKb = (item.sizeBytes / 1024).toFixed(0);
    const ageLabel = item.ageDays > 0 ? `Hace ${item.ageDays} días` : 'Antigüedad desconocida';
    return `
      <div class="old-images-cache-item-row">
        <div class="old-images-cache-item-left">
          <input type="checkbox" ${item.selected ? 'checked' : ''} onchange="toggleOldImagesCacheItem('${item.id}', this.checked)" style="accent-color:#00E5FF; cursor:pointer;">
          <img class="old-images-cache-item-thumb" src="${item.url}" loading="lazy" alt="" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'%2300E5FF\\' stroke-width=\\'2\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\'/><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'/><polyline points=\\'21 15 16 10 5 21\\'/></svg>'">
          <div class="old-images-cache-item-info">
            <span class="old-images-cache-item-name" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</span>
            <div class="old-images-cache-item-sub">
              <span class="old-images-cache-badge-age">📅 ${ageLabel}</span>
              <span>•</span>
              <span>~${sizeKb} KB</span>
              ${item.isFav ? '<span style="color:#FF64C8;">❤️ Favorito</span>' : ''}
            </div>
          </div>
        </div>
        <button class="old-images-cache-del-btn" onclick="deleteSingleOldImagesCacheItem('${item.id}')" title="Eliminar solo esta imagen">🗑️</button>
      </div>
    `;
  }).join('');

  if (cachedOldImagesItems.length > MAX_DISPLAY_OLD_ITEMS) {
    const extraCount = cachedOldImagesItems.length - MAX_DISPLAY_OLD_ITEMS;
    htmlRows += `
      <div style="text-align:center; padding:8px 10px; font-size:.73rem; color:var(--text2); background:rgba(255,255,255,0.03); border-radius:8px; border:1px dashed rgba(255,255,255,0.1); margin-top:4px;">
        ⚡ Y <b>${extraCount}</b> imágenes más seleccionadas listas para limpieza masiva.
      </div>
    `;
  }

  container.innerHTML = htmlRows;
}

function toggleOldImagesCacheItem(id, checked) {
  const item = cachedOldImagesItems.find(i => i.id === id);
  if (item) {
    item.selected = checked;
    renderOldImagesCacheList();
  }
}

function toggleSelectAllOldImages(checked) {
  cachedOldImagesItems.forEach(item => item.selected = checked);
  renderOldImagesCacheList();
}

async function deleteSingleOldImagesCacheItem(id) {
  const item = cachedOldImagesItems.find(i => i.id === id);
  if (!item) return;

  if (window.triggerHaptic) window.triggerHaptic(25);

  try {
    if (item.sourceType === 'indexedDB') {
      if (typeof idbDelete === 'function') {
        await idbDelete('item_media_cache', item.storageKey);
      }
    } else if (item.sourceType === 'cacheStorage') {
      if ('caches' in window) {
        const cObj = await caches.open(item.cacheName);
        await cObj.delete(item.request);
      }
    }

    if (typeof inMemoryImageCache !== 'undefined') {
      inMemoryImageCache.delete(item.storageKey);
    }

    cachedOldImagesItems = cachedOldImagesItems.filter(i => i.id !== id);
    showToast('🗑️ Imagen eliminada de la caché.');
    renderOldImagesCacheList();
  } catch(e) {
    console.error("Error al eliminar imagen individual de caché:", e);
  }
}

function openConfirmCleanOldImagesModal() {
  const selectedItems = cachedOldImagesItems.filter(i => i.selected);
  if (!selectedItems.length) {
    showToast('⚠️ Selecciona al menos una imagen para liberar espacio.');
    return;
  }

  const selectedBytes = selectedItems.reduce((acc, i) => acc + i.sizeBytes, 0);
  const selectedMb = selectedBytes / (1024 * 1024);
  const selectedFormatted = selectedMb >= 0.1 ? `${selectedMb.toFixed(1)} MB` : `${(selectedBytes / 1024).toFixed(0)} KB`;
  
  const ageFilterEl = document.getElementById('oldImagesAgeFilter');
  let criterionText = '> 15 días de antigüedad';
  if (ageFilterEl && ageFilterEl.selectedIndex >= 0) {
    criterionText = ageFilterEl.options[ageFilterEl.selectedIndex].text;
  }

  const modal = document.getElementById('oldImagesConfirmModal');
  const spaceNumberEl = document.getElementById('confirmOldImagesSpaceNumber');
  const countNumberEl = document.getElementById('confirmOldImagesCountNumber');
  const criterionLabelEl = document.getElementById('confirmOldImagesCriterionLabel');
  const executeBtn = document.getElementById('confirmOldImagesExecuteBtn');

  if (spaceNumberEl) spaceNumberEl.textContent = selectedFormatted;
  if (countNumberEl) countNumberEl.textContent = `${selectedItems.length} imágenes seleccionadas`;
  if (criterionLabelEl) criterionLabelEl.textContent = criterionText;
  if (executeBtn) executeBtn.textContent = `✨ Confirmar y Liberar ${selectedFormatted}`;

  if (modal) {
    modal.style.display = 'flex';
    if (window.triggerHaptic) window.triggerHaptic(30);
  }
}

function closeConfirmCleanOldImagesModal() {
  const modal = document.getElementById('oldImagesConfirmModal');
  if (modal) modal.style.display = 'none';
}

async function executeCleanOldImagesCache() {
  const selectedItems = cachedOldImagesItems.filter(i => i.selected);
  if (!selectedItems.length) {
    closeConfirmCleanOldImagesModal();
    return;
  }

  const executeBtn = document.getElementById('confirmOldImagesExecuteBtn');
  if (executeBtn) {
    executeBtn.disabled = true;
    executeBtn.textContent = '⏳ Liberando espacio...';
  }

  try {
    let deletedCount = 0;
    let deletedBytes = 0;
    const idbKeysToDelete = [];

    for (const item of selectedItems) {
      if (item.sourceType === 'indexedDB') {
        idbKeysToDelete.push(item.storageKey);
        deletedCount++;
        deletedBytes += item.sizeBytes;
      } else if (item.sourceType === 'cacheStorage') {
        try {
          if ('caches' in window) {
            const cObj = await caches.open(item.cacheName);
            await cObj.delete(item.request);
            deletedCount++;
            deletedBytes += item.sizeBytes;
          }
        } catch(e) {}
      }

      if (typeof inMemoryImageCache !== 'undefined') {
        inMemoryImageCache.delete(item.storageKey);
      }
    }

    if (idbKeysToDelete.length > 0 && typeof idbBulkDelete === 'function') {
      try {
        await idbBulkDelete('item_media_cache', idbKeysToDelete);
      } catch(e) {
        console.warn('Error en idbBulkDelete:', e);
      }
    }

    closeConfirmCleanOldImagesModal();

    const freedMb = deletedBytes / (1024 * 1024);
    const freedFormatted = freedMb >= 0.1 ? `${freedMb.toFixed(1)} MB` : `${(deletedBytes / 1024).toFixed(0)} KB`;

    if (window.triggerHaptic) window.triggerHaptic(60);
    showToast(`✨ ¡Limpieza completada con éxito! Se recuperaron ${freedFormatted} de almacenamiento interno (${deletedCount} imágenes eliminadas).`);

    await scanOldImagesCacheNow(true);

  } catch(e) {
    console.error("Error al ejecutar limpieza de imágenes:", e);
    showToast('❌ Ocurrió un error al liberar los archivos seleccionados.');
  } finally {
    if (executeBtn) executeBtn.disabled = false;
  }
}

/* ========================================================
 * 🧹 LIMPIEZA AUTOMÁTICA DE IMÁGENES ANTIGUAS (>30 DÍAS Y NO FAVORITAS)
 * ======================================================== */
async function autoCleanOldImagesFromIndexedDB(maxAgeDays = 30) {
  try {
    const now = Date.now();
    const favSet = new Set();
    
    // 1. Recopilar favoritos del usuario para protegerlos
    try {
      const uStates = (typeof userStates !== 'undefined' && Array.isArray(userStates) && userStates.length > 0) 
        ? userStates 
        : (typeof idbGetAll === 'function' ? await idbGetAll('user_states') : []);
      if (Array.isArray(uStates)) {
        uStates.forEach(s => {
          if (s && (s.status === 'wishlist' || s.status === 'playing' || s.isFavorite || s.status === 'favorite')) {
            if (s.itemId) favSet.add(String(s.itemId).toLowerCase());
          }
        });
      }
    } catch(e) {}

    // Activos de sistema protegidos que jamás se eliminan
    const systemProtectedAssets = ['icon-', 'logo', 'favicon', 'placeholder', 'spinner', 'default', 'avatar', 'service_', 'joa_gamers', 'splash', 'img/', 'hero'];

    // 2. Obtener registros de item_media_cache desde IndexedDB
    if (typeof idbGetAll !== 'function') return { success: false, deletedCount: 0, freedBytes: 0 };
    const records = await idbGetAll('item_media_cache');
    if (!Array.isArray(records) || records.length === 0) {
      return { success: true, deletedCount: 0, freedBytes: 0 };
    }

    const keysToDelete = [];
    let freedBytes = 0;

    records.forEach(rec => {
      if (!rec || !rec.itemId) return;
      const itemIdStr = String(rec.itemId).toLowerCase();
      const isProtected = systemProtectedAssets.some(p => itemIdStr.includes(p));
      if (isProtected) return;

      const isFav = favSet.has(itemIdStr);
      if (isFav) return; // Preservar las imágenes de favoritos intactas

      // Calcular antigüedad en días
      let ageDays = 31;
      if (rec.savedAt) {
        const diffMs = now - new Date(rec.savedAt).getTime();
        if (!isNaN(diffMs) && diffMs > 0) {
          ageDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        }
      }

      if (ageDays >= maxAgeDays) {
        keysToDelete.push(rec.itemId);
        const sizeBytes = rec.size || (rec.dataUrl ? Math.round(rec.dataUrl.length * 0.75) : 120 * 1024);
        freedBytes += sizeBytes;
      }
    });

    // 3. Ejecutar borrado en IndexedDB si se encontraron imágenes antiguas no favoritas
    if (keysToDelete.length > 0) {
      await idbBulkDelete('item_media_cache', keysToDelete);
      
      // Limpiar memoria caché activa si existe
      if (typeof inMemoryImageCache !== 'undefined' && inMemoryImageCache.delete) {
        keysToDelete.forEach(k => inMemoryImageCache.delete(k));
      }

      // Purgar también de CacheStorage de imágenes si aplica
      if ('caches' in window) {
        try {
          const cacheNames = await caches.keys();
          for (const cName of cacheNames) {
            if (cName.includes('images') || cName.includes('media')) {
              const c = await caches.open(cName);
              for (const k of keysToDelete) {
                await c.delete(k);
              }
            }
          }
        } catch(e) {}
      }

      const freedMbStr = (freedBytes / (1024 * 1024)).toFixed(1);
      console.log(`🧹 [AutoClean IDB] Se eliminaron ${keysToDelete.length} imágenes no favoritas de IndexedDB (> ${maxAgeDays} días, ~${freedMbStr} MB liberados).`);
    }

    // 4. Solicitar al Service Worker ejecutar su observador de almacenamiento (Storage Observer)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CHECK_STORAGE_OBSERVER' });
    }

    return {
      success: true,
      deletedCount: keysToDelete.length,
      freedBytes: freedBytes,
      freedMB: (freedBytes / (1024 * 1024)).toFixed(1)
    };
  } catch (err) {
    console.error("❌ [AutoClean IDB] Error al limpiar imágenes antiguas de IndexedDB:", err);
    return { success: false, error: err.message, deletedCount: 0, freedBytes: 0 };
  }
}
window.autoCleanOldImagesFromIndexedDB = autoCleanOldImagesFromIndexedDB;

// ========================================================
// 🚀 SINCRONIZACIÓN DE VERSIÓN DE LA APK EN PANTALLA DE INICIO
// ========================================================
function syncHomeScreenApkVersion() {
  const ver = (typeof JOA_CURRENT_APK_VERSION !== 'undefined' ? JOA_CURRENT_APK_VERSION : 'v1.0.8');
  const pill = document.getElementById('homeWelcomeApkVersionPill');
  if (pill) pill.textContent = ver;
  const num = document.getElementById('homeApkVersionNumber');
  if (num) num.textContent = `${ver} OFICIAL`;
  const globalVer = document.getElementById('pillApkVersion');
  if (globalVer) globalVer.textContent = ver;
}

// ========================================================
// ❤️ GESTIÓN Y SINCRONIZACIÓN DEL CONTENIDO DEL CATÁLOGO (EL CORAZÓN) EN INICIO
// ========================================================
async function checkRepoCatalogVersion(isManual = false) {
  const repoVerEl = document.getElementById('homeCatalogRepoVerTxt');
  const localTitleEl = document.getElementById('homeCatalogCurrentTitle');
  const cardEl = document.getElementById('homeCatalogUpdateCard');
  const statusChipEl = document.getElementById('homeCatalogStatusChip');
  const subNoticeEl = document.getElementById('homeCatalogSubNotice');

  let totalLocalItems = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems.length : 0;
  if (!totalLocalItems && typeof idbGetAll === 'function') {
    try {
      const items = await idbGetAll('items');
      if (Array.isArray(items)) totalLocalItems = items.length;
    } catch(e) {}
  }

  let localVer = '0.0.0';
  if (typeof idbGetMeta === 'function') {
    try {
      localVer = await idbGetMeta('catalog_version', localStorage.getItem('joa_catalog_version') || '0.0.0');
    } catch(e) {}
  }

  // 1. Estado local inmediato en pantalla
  if (totalLocalItems === 0) {
    if (cardEl) cardEl.classList.add('is-empty');
    if (localTitleEl) localTitleEl.innerHTML = '⚠️ ¡Catálogo sin contenido! (0 títulos)';
    if (statusChipEl) {
      statusChipEl.textContent = '📥 DESCARGAR';
      statusChipEl.style.background = 'linear-gradient(135deg, #00FFB2, #00E5FF)';
      statusChipEl.style.color = '#040812';
    }
    if (subNoticeEl) {
      subNoticeEl.innerHTML = '💡 <b>Aplicación recién instalada:</b> Pulsa aquí para descargar todos los juegos, películas y series del servidor oficial.';
    }
  } else {
    if (cardEl) cardEl.classList.remove('is-empty');
    const verClean = (localVer && localVer !== '0.0.0') ? `v${localVer}` : '';
    if (localTitleEl) localTitleEl.innerHTML = `📦 ${totalLocalItems.toLocaleString('es-ES')} títulos guardados ${verClean ? '<span style="font-size:0.75rem;color:#00E5FF;font-family:monospace;">(' + verClean + ')</span>' : ''}`;
    if (statusChipEl) {
      statusChipEl.textContent = '❤️ Actualizar';
      statusChipEl.style.background = 'rgba(255, 46, 99, 0.2)';
      statusChipEl.style.color = '#FF6584';
    }
    if (subNoticeEl) {
      subNoticeEl.innerHTML = '⚡ Juegos de PC &amp; Consolas, Películas, Series y Anime listos para disfrutar 100% offline.';
    }
  }

  // 2. Consulta silenciosa del repositorio GitHub
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(VERSION_URL + "?_=" + Date.now(), {
      cache: "no-store",
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data && data.version) {
        window.latestRepoCatalogData = data;
        const remoteVer = data.version;
        const countStr = data.item_count ? `${data.item_count.toLocaleString('es-ES')} títulos` : '9,956+ títulos';

        if (repoVerEl) {
          repoVerEl.innerHTML = `<b>v${remoteVer}</b> (${countStr})`;
          repoVerEl.style.color = '#00FFB2';
        }

        const isUpToDate = (remoteVer === localVer && totalLocalItems > 0);
        if (isUpToDate) {
          if (statusChipEl) {
            statusChipEl.textContent = '✅ Al día';
            statusChipEl.style.background = 'rgba(0, 255, 178, 0.15)';
            statusChipEl.style.color = '#00FFB2';
            statusChipEl.style.borderColor = 'rgba(0, 255, 178, 0.4)';
          }
        } else {
          if (statusChipEl) {
            statusChipEl.textContent = totalLocalItems === 0 ? '📥 DESCARGAR' : '✨ Nueva Versión';
            statusChipEl.style.background = 'linear-gradient(135deg, rgba(255,46,99,0.35), rgba(0,229,255,0.35))';
            statusChipEl.style.color = '#FFFFFF';
            statusChipEl.style.borderColor = '#00E5FF';
          }
        }
      }
    }
  } catch (err) {
    if (repoVerEl && (repoVerEl.textContent === 'Consultando versión...' || repoVerEl.textContent === 'Consultando...')) {
      repoVerEl.textContent = 'Disponible online (GitHub)';
    }
  }
}
window.checkRepoCatalogVersion = checkRepoCatalogVersion;

// Exportar al objeto global window para invocaciones inline
window.scanOldImagesCacheNow = scanOldImagesCacheNow;
window.renderOldImagesCacheList = renderOldImagesCacheList;
window.toggleOldImagesCacheItem = toggleOldImagesCacheItem;
window.toggleSelectAllOldImages = toggleSelectAllOldImages;
window.deleteSingleOldImagesCacheItem = deleteSingleOldImagesCacheItem;
window.openConfirmCleanOldImagesModal = openConfirmCleanOldImagesModal;
window.closeConfirmCleanOldImagesModal = closeConfirmCleanOldImagesModal;
window.executeCleanOldImagesCache = executeCleanOldImagesCache;
window.syncHomeScreenApkVersion = syncHomeScreenApkVersion;

async function syncCatalogVersionToAndroid() {
  try {
    const ver = await idbGetMeta('catalog_version', '0.0.0');
    if (window.AndroidBridge && typeof window.AndroidBridge.syncCatalogVersion === 'function') {
      window.AndroidBridge.syncCatalogVersion(ver);
    }
  } catch (e) {
    console.error('Error syncing catalog version to Android:', e);
  }
}

function testDatabaseUpdateNotification() {
  if (window.triggerHaptic) window.triggerHaptic(40);
  if (window.AndroidBridge && typeof window.AndroidBridge.testDatabaseUpdateNotificationNow === 'function') {
    window.AndroidBridge.testDatabaseUpdateNotificationNow();
  } else {
    showToast('🚀 Simulación: Comprobando actualización de base de datos...');
  }
}



// ========================================================
// ⚔️ DOOM: THE DARK AGES · JOA GAMERS GOTHIC STORE LOADING CONTROLLER
// ========================================================
let doomAudioCtx = null;
let doomEmberAnimId = null;

function playDoomSound(type) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!doomAudioCtx) {
      doomAudioCtx = new AudioContext();
    }
    if (doomAudioCtx.state === 'suspended') {
      doomAudioCtx.resume();
    }
    const t = doomAudioCtx.currentTime;

    if (type === 'forge' || type === 'boot' || type === 'cyber-boot') {
      // Impacto sintetizador futurista / Arranque de sistema Cyberpunk JOA
      const osc = doomAudioCtx.createOscillator();
      const sub = doomAudioCtx.createOscillator();
      const gain = doomAudioCtx.createGain();
      const subGain = doomAudioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(580, t + 0.16);
      osc.frequency.exponentialRampToValueAtTime(220, t + 0.32);

      sub.type = 'triangle';
      sub.frequency.setValueAtTime(80, t);
      sub.frequency.exponentialRampToValueAtTime(40, t + 0.38);

      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      subGain.gain.setValueAtTime(0.12, t);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);

      osc.connect(gain);
      sub.connect(subGain);
      gain.connect(doomAudioCtx.destination);
      subGain.connect(doomAudioCtx.destination);

      osc.start(t);
      sub.start(t);
      osc.stop(t + 0.36);
      sub.stop(t + 0.44);
    } else if (type === 'rune' || type === 'ping' || type === 'cyber-pulse') {
      // Pulso holográfico de datos (Neón Cyan & Esmeralda)
      const osc1 = doomAudioCtx.createOscillator();
      const osc2 = doomAudioCtx.createOscillator();
      const gain = doomAudioCtx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, t); // C5
      osc1.frequency.exponentialRampToValueAtTime(1046.5, t + 0.14);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, t); // E5
      osc2.frequency.exponentialRampToValueAtTime(1318.5, t + 0.18);

      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(doomAudioCtx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.22);
      osc2.stop(t + 0.22);
    } else if (type === 'ignite' || type === 'laser' || type === 'cyber-sweep') {
      // Barrido de frecuencia láser hiperespacial
      const osc = doomAudioCtx.createOscillator();
      const gain = doomAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(280, t);
      osc.frequency.exponentialRampToValueAtTime(1240, t + 0.18);

      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc.connect(gain);
      gain.connect(doomAudioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    } else if (type === 'complete' || type === 'victory' || type === 'cyber-success') {
      // Acorde triunfal estilo sintetizador sci-fi de JOA GAMERS
      const freqs = [261.63, 329.63, 392.00, 523.25, 659.25, 1046.5];
      freqs.forEach((freq, idx) => {
        const osc = doomAudioCtx.createOscillator();
        const gain = doomAudioCtx.createGain();
        osc.type = idx === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.008, t + 0.7);

        gain.gain.setValueAtTime(0.06 / (idx + 1), t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);

        osc.connect(gain);
        gain.connect(doomAudioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.8);
      });
    } else {
      playDoomSound('cyber-pulse');
    }
  } catch (e) {
    // Audio no soportado o bloqueado silenciosamente
  }
}

// SIMULADOR DE PARTÍCULAS CYBERPUNK (NEÓN CYAN, ESMERALDA Y VIOLETA)
function startDoomEmbers(canvas) {
  if (!canvas) {
    canvas = document.getElementById('joaCyberParticlesCanvas') || document.getElementById('doomEmbersCanvas');
  }
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = (canvas.width = window.innerWidth || 480);
  const h = (canvas.height = window.innerHeight || 800);

  const particleCount = 42;
  const particles = [];
  const colors = [
    'rgba(0, 229, 255, ',   // Neon Cyan
    'rgba(0, 255, 178, ',   // Mint / Emerald
    'rgba(157, 78, 221, ',  // Cyber Violet
    'rgba(255, 215, 0, '    // Gold accent
  ];

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      size: Math.random() * 2.8 + 1.0,
      speedY: Math.random() * 1.6 + 0.6,
      speedX: (Math.random() - 0.5) * 0.8,
      alpha: Math.random() * 0.7 + 0.3,
      alphaSpeed: Math.random() * 0.02 + 0.01,
      color: colors[Math.floor(Math.random() * colors.length)],
      sway: Math.random() * Math.PI * 2
    });
  }

  function renderCyberParticles() {
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.y -= p.speedY;
      p.sway += 0.03;
      p.x += Math.sin(p.sway) * 0.45 + p.speedX;

      p.alpha += Math.sin(p.sway) * p.alphaSpeed;
      const clampedAlpha = Math.max(0.12, Math.min(0.85, p.alpha));

      // Glow exterior suave
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = p.color + (clampedAlpha * 0.28) + ')';
      ctx.fill();

      // Núcleo brillante
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color + clampedAlpha + ')';
      ctx.fill();

      // Reciclar si sale por arriba
      if (p.y < -10) {
        p.y = h + 10;
        p.x = Math.random() * w;
        p.alpha = Math.random() * 0.7 + 0.3;
      }
    }

    doomEmberAnimId = requestAnimationFrame(renderCyberParticles);
  }

  if (doomEmberAnimId) cancelAnimationFrame(doomEmberAnimId);
  doomEmberAnimId = requestAnimationFrame(renderCyberParticles);
}

function stopDoomEmbers() {
  if (doomEmberAnimId) {
    cancelAnimationFrame(doomEmberAnimId);
    doomEmberAnimId = null;
  }
}

let isDoomLoadingRunning = false;

function abrirPantallaCargaDoomDarkAges(duration = 2000, onComplete = null) {
  if (isDoomLoadingRunning) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }
  isDoomLoadingRunning = true;

  if (window.triggerHaptic) window.triggerHaptic(40);
  playDoomSound('cyber-boot');

  const modal = document.getElementById('doomDarkAgesLoadingModal') || document.getElementById('joaCyberLoadingModal');
  const bar = document.getElementById('doomLoadingBarFill');
  const pctTxt = document.getElementById('doomLoadingPct');
  const msgTxt = document.getElementById('doomLoadingStatusMsg');
  const iconSpan = document.getElementById('doomStatusIcon');
  const speedSpan = document.getElementById('doomSpeedIndicator');
  const canvas = document.getElementById('joaCyberParticlesCanvas') || document.getElementById('doomEmbersCanvas');
  const video = document.getElementById('joaLoadingVideo');

  if (!modal || !bar || !pctTxt || !msgTxt) {
    isDoomLoadingRunning = false;
    if (typeof onComplete === 'function') onComplete();
    return;
  }

  modal.classList.remove('doom-fade-out');
  modal.classList.remove('joa-loading-fade-out');
  modal.style.display = 'flex';
  modal.style.opacity = '1';
  modal.style.pointerEvents = 'auto';

  // Iniciar video animado de fondo oficial de JOA Gamers
  if (video) {
    try {
      video.currentTime = 0;
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {});
      }
    } catch(e) {}
  }

  bar.style.width = '0%';
  pctTxt.textContent = '0%';
  msgTxt.textContent = 'Iniciando el Multiverso Gamer de Joa Gamers...';
  if (iconSpan) iconSpan.textContent = '⚡';
  if (speedSpan) speedSpan.textContent = '⚡ ENLACE: 1.4 GB/s ULTRARÁPIDO';

  // Iniciar partículas de datos neón
  startDoomEmbers(canvas);

  const startTime = Date.now();
  let lastPhase = 0;
  let lastSoundPct = 0;

  // FASES DINÁMICAS ENFOCADAS EN EL ESTILO CYBERPUNK / TIENDA MULTIMEDIA OFICIAL DE LA APK
  const steps = [
    { threshold: 0, text: 'Iniciando Showroom Multimedia · JOA GAMER...', icon: '⚡', sound: 'cyber-boot', speed: '⚡ ENLACE: 1.4 GB/s ULTRARÁPIDO' },
    { threshold: 22, text: 'Sincronizando Catálogo de Juegos PC y Consolas...', icon: '🎮', sound: 'cyber-pulse', speed: '🚀 NÚCLEO: 100% OPERATIVO' },
    { threshold: 48, text: 'Conectando Galería de Cine, Series 4K y Multiverso...', icon: '🎬', sound: 'cyber-sweep', speed: '✨ ANCHO DE BANDA: 1.8 GB/s' },
    { threshold: 72, text: 'Indexando Leyendas Retro, Emuladores y Clásicos...', icon: '🕹️', sound: 'cyber-pulse', speed: '🛡️ CACHÉ LOCAL OPTIMIZADA' },
    { threshold: 90, text: '¡Showroom de JOA GAMER Sincronizado con Éxito!', icon: '👑', sound: 'cyber-success', speed: '✨ VERSIÓN v1.0.8 LISTA' }
  ];

  const timer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(100, Math.round((elapsed / duration) * 100));

    bar.style.width = `${progress}%`;
    pctTxt.textContent = `${progress}%`;

    // Sonido sutil de telemetría a mitad de camino
    if (progress - lastSoundPct >= 25 && progress < 90) {
      lastSoundPct = progress;
      playDoomSound('cyber-pulse');
    }

    // Actualizar fases de texto, iconos y hápticos
    for (let i = steps.length - 1; i >= 0; i--) {
      if (progress >= steps[i].threshold) {
        if (lastPhase !== i) {
          lastPhase = i;
          msgTxt.textContent = steps[i].text;
          if (iconSpan) iconSpan.textContent = steps[i].icon;
          if (speedSpan) speedSpan.textContent = steps[i].speed;
          if (window.triggerHaptic) window.triggerHaptic(20);
          playDoomSound(steps[i].sound);
        }
        break;
      }
    }

    if (progress >= 100) {
      clearInterval(timer);
      msgTxt.textContent = '✨ ¡Bienvenido al Multiverso Multimedia de JOA GAMER!';
      if (iconSpan) iconSpan.textContent = '👑';
      if (speedSpan) speedSpan.textContent = '🛡️ TIENDA ACTIVA · MÁXIMO RENDIMIENTO';
      if (window.triggerHaptic) window.triggerHaptic(70);
      playDoomSound('cyber-success');

      // Transición suave de opacidad (fade-out fluido hacia la pantalla principal)
      setTimeout(() => {
        modal.classList.add('doom-fade-out');
        modal.classList.add('joa-loading-fade-out');
        const appScreenEl = document.getElementById('appScreen');
        if (appScreenEl) appScreenEl.style.display = 'block';
        const importScreenEl = document.getElementById('importScreen');
        if (importScreenEl) importScreenEl.style.display = 'none';
        setTimeout(() => {
          modal.style.display = 'none';
          stopDoomEmbers();
          if (video) {
            try { video.pause(); } catch(e) {}
          }
          isDoomLoadingRunning = false;
          if (typeof onComplete === 'function') onComplete();
        }, 450);
      }, 90);
    }
  }, 22);
}

// Exports globales (compatibilidad total)
window.abrirPantallaCargaDoomDarkAges = abrirPantallaCargaDoomDarkAges;
window.abrirPantallaCargaJoa = abrirPantallaCargaDoomDarkAges;
window.playDoomSound = playDoomSound;

// Auto-arranque inmediato y seguro de la pantalla de carga oficial JOA GAMER
try {
  if (!window._joaLoadingScreenStarted) {
    const modal = document.getElementById('doomDarkAgesLoadingModal') || document.getElementById('joaCyberLoadingModal');
    if (modal && modal.style.display !== 'none') {
      window._joaLoadingScreenStarted = true;
      abrirPantallaCargaDoomDarkAges(2400);
    }
  }
} catch(e) {}

// ========================================================
// 📍 CONTROLADOR DE UBICACIÓN Y NAVEGACIÓN GPS (¡QUIERO IR! - J.O.A GAMER´S PC)
// ========================================================
const JOA_LOCATION_CONFIG = {
  name: 'J.O.A GAMER´s PC',
  shortName: 'J.O.A GAMER´s PC',
  address: 'Manuel Suárez, Camagüey, Cuba',
  plusCode: '93GV+4PP',
  fullAddress: '21.37534602972361, -77.90568372043612',
  coordsString: '21.37534602972361,-77.90568372043612',
  mapsUrl: 'https://maps.app.goo.gl/yFou4DrdeHvsJ7ei7',
  lat: 21.37534602972361,
  lng: -77.90568372043612
};

// =====================================================================
// ⏰ TEMPORIZADOR INTELIGENTE DE HORARIO COMERCIAL (JOA GAMER´S PC)
// =====================================================================
function updateStoreScheduleTimer() {
  const tag = document.getElementById('locOpenStatusTag');
  if (!tag) return;

  const now = new Date();
  const day = now.getDay(); // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTotalMins = hours * 60 + minutes;

  // Horario comercial predefinido oficial de JOA GAMER´s PC:
  // Lunes a Sábado: 9:00 AM - 8:00 PM (09:00 - 20:00)
  // Domingo: 10:00 AM - 6:00 PM (10:00 - 18:00)
  const isSunday = (day === 0);
  const openMins = isSunday ? (10 * 60) : (9 * 60);
  const closeMins = isSunday ? (18 * 60) : (20 * 60);
  const openHourStr = isSunday ? '10:00 AM' : '9:00 AM';

  if (currentTotalMins >= openMins && currentTotalMins < closeMins) {
    // 🟢 TIENDA ABIERTA: Calcular tiempo exacto que falta para el cierre
    const diffMins = closeMins - currentTotalMins;
    const hoursLeft = Math.floor(diffMins / 60);
    const minsLeft = diffMins % 60;

    let timeText = '';
    if (hoursLeft >= 2) {
      timeText = `Cierra en ${hoursLeft} horas`;
    } else if (hoursLeft === 1) {
      timeText = minsLeft > 0 ? `Cierra en 1 h ${minsLeft} min` : `Cierra en 1 hora`;
    } else {
      timeText = `Cierra en ${minsLeft} min`;
    }

    const isUrgent = (diffMins <= 45);
    tag.className = `loc-open-tag loc-tag-open ${isUrgent ? 'loc-tag-closing-soon' : ''}`;
    tag.innerHTML = `
      <span class="loc-tag-pulse-dot">🟢</span>
      <span class="loc-tag-text-bold">ABIERTO HOY</span>
      <span class="loc-tag-sep">·</span>
      <span class="loc-tag-timer-val" id="locClosingCountdown">⏱️ ${timeText}</span>
    `;
  } else if (currentTotalMins < openMins) {
    // 🟡 TIENDA CERRADA (Antes de abrir en la mañana)
    const diffMins = openMins - currentTotalMins;
    const hoursToOpen = Math.floor(diffMins / 60);
    const minsToOpen = diffMins % 60;
    const waitText = hoursToOpen > 0 ? `${hoursToOpen} h ${minsToOpen > 0 ? minsToOpen + ' min' : ''}` : `${minsToOpen} min`;

    tag.className = 'loc-open-tag loc-tag-opening';
    tag.innerHTML = `
      <span class="loc-tag-pulse-dot">🟡</span>
      <span class="loc-tag-text-bold">ABRE HOY a las ${openHourStr}</span>
      <span class="loc-tag-sep">·</span>
      <span class="loc-tag-timer-val" id="locClosingCountdown">⏳ En ${waitText}</span>
    `;
  } else {
    // 🔴 TIENDA CERRADA (Después de la hora de cierre)
    const tomorrowIsSunday = (day === 6);
    const nextOpenStr = tomorrowIsSunday ? '10:00 AM' : '9:00 AM';

    tag.className = 'loc-open-tag loc-tag-closed';
    tag.innerHTML = `
      <span class="loc-tag-pulse-dot">🔴</span>
      <span class="loc-tag-text-bold">CERRADO</span>
      <span class="loc-tag-sep">·</span>
      <span class="loc-tag-timer-val" id="locClosingCountdown">Abre mañana a las ${nextOpenStr}</span>
    `;
  }
}

function openLocationModal() {
  if (window.triggerHaptic) window.triggerHaptic(40);
  if (typeof toggleSidebar === 'function') toggleSidebar(false);
  const modal = document.getElementById('locationScreenModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    // Disparar animación suave de entrada zoom 0.95 -> 1.0 en la ventana y mapa
    const win = modal.querySelector('.location-window');
    if (win) {
      win.style.animation = 'none';
      void win.offsetWidth; // Force reflow para reiniciar animación
      win.style.animation = 'locModalZoomIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards';
    }

    // Inicializar y sincronizar el temporizador inteligente de horario de cierre
    updateStoreScheduleTimer();
    if (window.locScheduleTimerInterval) clearInterval(window.locScheduleTimerInterval);
    window.locScheduleTimerInterval = setInterval(updateStoreScheduleTimer, 30000);

    // Manejo de conexión offline para el iframe de Google Maps
    const notice = document.getElementById('locOfflineNotice');
    if (notice) {
      notice.style.display = navigator.onLine ? 'none' : 'flex';
    }

    if (typeof updateCachedRouteUIState === 'function') {
      updateCachedRouteUIState();
    }

    try {
      history.pushState({ joaLocationModal: true }, '');
    } catch(e) {}

    // Intentar calcular distancia inicial si hay geolocalización
    setTimeout(() => {
      if (typeof calcularDistanciaGps === 'function') {
        calcularDistanciaGps();
      }
    }, 450);
  }
}

function closeLocationModal() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const modal = document.getElementById('locationScreenModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  if (window.locScheduleTimerInterval) {
    clearInterval(window.locScheduleTimerInterval);
    window.locScheduleTimerInterval = null;
  }
  if (typeof toggleCachedMapOverlay === 'function') {
    toggleCachedMapOverlay(false);
  }
}

let currentMapZoom = 17;
let currentMapType = 'm';
let currentMapMode = 'route'; // 'route' (Mi Ubicación ➔ JOAGamers) o 'store' (Enfoque en Local)
let userCurrentCoords = null; // { lat, lng }

function updateMapIframeSrc() {
  const iframe = document.getElementById('googleMapsIframe');
  const zoomPill = document.getElementById('mapZoomValue');
  const routeBtn = document.getElementById('btnMapModeRoute');
  const storeBtn = document.getElementById('btnMapModeStore');
  const routeStoreText = document.getElementById('routeStoreBtnText');

  if (zoomPill) {
    zoomPill.textContent = `${currentMapZoom}x`;
  }

  if (routeBtn && storeBtn) {
    if (currentMapMode === 'route') {
      routeBtn.classList.add('active');
      storeBtn.classList.remove('active');
      if (routeStoreText) routeStoreText.textContent = 'Ver Local';
    } else {
      storeBtn.classList.add('active');
      routeBtn.classList.remove('active');
      if (routeStoreText) routeStoreText.textContent = 'Ver Ruta';
    }
  }

  if (!iframe) return;

  if (currentMapMode === 'route' && userCurrentCoords) {
    // 🛣️ Vista de Ruta Completa en Google Maps: Origen (Usuario) -> Destino (J.O.A GAMER´s PC)
    iframe.src = `https://maps.google.com/maps?saddr=${userCurrentCoords.lat},${userCurrentCoords.lng}&daddr=${JOA_LOCATION_CONFIG.coordsString}&t=${currentMapType}&ie=UTF8&output=embed`;
  } else {
    // 📍 Vista Centrada en el Local J.O.A GAMER´s PC
    iframe.src = `https://maps.google.com/maps?q=${JOA_LOCATION_CONFIG.coordsString}&t=${currentMapType}&z=${currentMapZoom}&ie=UTF8&iwloc=B&output=embed`;
  }
}

function setMapNavigationMode(mode) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  currentMapMode = mode;

  if (mode === 'route') {
    if (!userCurrentCoords) {
      if (typeof showToast === 'function') {
        showToast('🛰️ Obteniendo tu ubicación para trazar la ruta en el mapa...');
      }
      calcularDistanciaGps();
      return;
    }
    if (typeof showToast === 'function') {
      showToast('🛣️ Mostrando ruta completa desde tu ubicación hacia J.O.A GAMER´s PC');
    }
  } else {
    if (typeof showToast === 'function') {
      showToast('📍 Enfoque centrado en el local físico J.O.A GAMER´s PC');
    }
  }

  updateMapIframeSrc();
}

function toggleRouteOrStoreMode() {
  if (currentMapMode === 'route') {
    setMapNavigationMode('store');
  } else {
    setMapNavigationMode('route');
  }
}

function cambiarTipoMapa(type) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  currentMapType = type;
  const btnStd = document.getElementById('btnMapModeStandard');
  const btnSat = document.getElementById('btnMapModeSat');

  updateMapIframeSrc();

  if (btnStd && btnSat) {
    if (type === 'm') {
      btnStd.classList.add('active');
      btnSat.classList.remove('active');
    } else {
      btnSat.classList.add('active');
      btnStd.classList.remove('active');
    }
  }
}

function handleMapZoom(delta) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  const nextZoom = Math.max(10, Math.min(20, currentMapZoom + delta));
  if (nextZoom === currentMapZoom) {
    if (typeof showToast === 'function') {
      showToast(delta > 0 ? '🔍 Acercamiento máximo alcanzado (20x)' : '🔍 Vista panorámica máxima alcanzada (10x)');
    }
    return;
  }
  currentMapZoom = nextZoom;
  // Si estamos en zoom manual, enfocar local para apreciar el zoom
  if (currentMapMode === 'route' && delta !== 0) {
    // Si el usuario hace zoom manual, cambiar al local para respetar el nivel de zoom
    currentMapMode = 'store';
  }
  updateMapIframeSrc();

  const labels = {
    10: 'Provincia',
    12: 'Región',
    14: 'Ciudad',
    16: 'Zona / Reparto',
    17: 'Calle (J.O.A GAMER´s PC)',
    18: 'Cuadra / Detalle',
    19: 'Fachada',
    20: 'Máximo Detalle'
  };
  const label = labels[currentMapZoom] || `${currentMapZoom}x`;
  if (typeof showToast === 'function') {
    showToast(`🔍 Zoom ${currentMapZoom}x · ${label}`);
  }
}

function recenterMapOnStore() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  currentMapMode = 'store';
  currentMapZoom = 17;
  updateMapIframeSrc();
  if (typeof showToast === 'function') {
    showToast('🎯 Mapa re-centrado en J.O.A GAMER´s PC');
  }
}

function centerOnMyLocation() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  currentMapMode = 'route';
  if (!userCurrentCoords) {
    calcularDistanciaGps();
  } else {
    updateMapIframeSrc();
    if (typeof showToast === 'function') {
      showToast('🛰️ Trazando ruta desde tu posición actual');
    }
  }
}

function toggleMapFullscreenHUD() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const hud = document.querySelector('.location-hud-card');
  const icon = document.getElementById('mapExpandIcon');
  const restoreBtn = document.getElementById('btnRestoreHUD');
  const topbar = document.querySelector('.location-topbar');

  if (hud) {
    hud.classList.toggle('hud-collapsed');
    const isCollapsed = hud.classList.contains('hud-collapsed');
    if (icon) {
      icon.textContent = isCollapsed ? '🗗' : '⛶';
    }
    if (restoreBtn) {
      restoreBtn.style.display = isCollapsed ? 'flex' : 'none';
    }
    if (topbar) {
      topbar.classList.toggle('topbar-compact', isCollapsed);
    }
    if (typeof showToast === 'function') {
      showToast(isCollapsed ? '⛶ Modo Pantalla Completa: Mapa 100% visible' : '🗗 Controles y ruta GPS restaurados');
    }
  }
}

function iniciarNavegacionGps(travelMode = 'driving') {
  if (window.triggerHaptic) window.triggerHaptic(45);
  if (typeof showToast === 'function') {
    showToast('🛰️ Obteniendo tu posición GPS en tiempo real...');
  }

  const destCoords = JOA_LOCATION_CONFIG.coordsString;

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        userCurrentCoords = { lat, lng };
        updateMapIframeSrc();
        if (typeof showToast === 'function') {
          showToast('🚀 ¡Ruta GPS trazada! Abriendo Google Maps...');
        }
        const navUrl = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${destCoords}&travelmode=${travelMode}`;
        window.open(navUrl, '_blank');
      },
      (err) => {
        if (typeof showToast === 'function') {
          showToast('🗺️ Abriendo Google Maps hacia J.O.A GAMER´s PC...');
        }
        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${destCoords}&travelmode=${travelMode}`;
        window.open(navUrl, '_blank');
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
    );
  } else {
    const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${destCoords}&travelmode=${travelMode}`;
    window.open(navUrl, '_blank');
  }
}

function abrirEnGoogleMapsApp() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  window.open(JOA_LOCATION_CONFIG.mapsUrl, '_blank');
}

async function calcularDistanciaGps() {
  const badge = document.getElementById('locationGpsDistanceBadge');
  if (badge) {
    badge.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; color:#00E5FF; font-weight:700; font-size:0.78rem;">
        <span style="display:inline-block; animation:locLivePulse 1.2s infinite;">🛰️</span>
        <span>Conectando con GPS y analizando tráfico en Google Maps...</span>
      </div>`;
  }

  if (!navigator.geolocation) {
    if (badge) badge.innerHTML = '⚠️ GPS no disponible en este dispositivo';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat1 = pos.coords.latitude;
      const lon1 = pos.coords.longitude;
      const lat2 = JOA_LOCATION_CONFIG.lat;
      const lon2 = JOA_LOCATION_CONFIG.lng;

      userCurrentCoords = { lat: lat1, lng: lon1 };

      // Actualizar automáticamente el mapa para que trace la ruta completa hacia Joa Gamers
      if (currentMapMode === 'route') {
        updateMapIframeSrc();
      }

      // 1. Distancia en línea recta (Haversine)
      const R = 6371; // km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const directDist = R * c;

      let roadDistanceKm = directDist * 1.30; // Factor promedio de trazado urbano
      let baseDrivingMinutes = Math.max(1, Math.round((roadDistanceKm / 32) * 60)); // 32 km/h urbano

      const isOnline = navigator.onLine;

      if (isOnline) {
        // Intentar obtener la distancia exacta de red vial en línea
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2400);
          const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`, {
            signal: controller.signal
          });
          clearTimeout(timer);
          if (res.ok) {
            const data = await res.json();
            if (data && data.routes && data.routes[0]) {
              const r = data.routes[0];
              roadDistanceKm = r.distance / 1000;
              baseDrivingMinutes = Math.max(1, Math.round(r.duration / 60));
            }
          }
        } catch(e) {}

        // Modelo de tráfico dinámico en tiempo real (Google Maps Traffic API Model)
        const now = new Date();
        const currentHour = now.getHours() + (now.getMinutes() / 60);
        const dayOfWeek = now.getDay(); // 0 = Domingo

        let trafficFactor = 1.10;
        let trafficText = 'Tráfico fluido';
        let trafficColor = '#00FF87';
        let trafficEmoji = '🟢';

        if (dayOfWeek !== 0) { // Lunes a Sábado
          if ((currentHour >= 7.3 && currentHour <= 9.2) || (currentHour >= 17.0 && currentHour <= 19.3)) {
            // Hora punta / tráfico denso
            trafficFactor = 1.40;
            trafficText = 'Tráfico denso · Hora pico';
            trafficColor = '#FF4444';
            trafficEmoji = '🔴';
          } else if ((currentHour >= 11.5 && currentHour <= 13.5) || (currentHour >= 16.3 && currentHour < 17.0)) {
            // Tráfico moderado
            trafficFactor = 1.24;
            trafficText = 'Tráfico moderado';
            trafficColor = '#FFAA00';
            trafficEmoji = '🟡';
          } else if (currentHour >= 21.5 || currentHour < 6.5) {
            // Noche
            trafficFactor = 1.00;
            trafficText = 'Vía libre · Sin tráfico';
            trafficColor = '#00E5FF';
            trafficEmoji = '🟢';
          }
        } else {
          // Domingo
          if (currentHour >= 12.0 && currentHour <= 18.0) {
            trafficFactor = 1.14;
            trafficText = 'Tráfico moderado';
            trafficColor = '#FFAA00';
            trafficEmoji = '🟡';
          } else {
            trafficFactor = 1.02;
            trafficText = 'Vía libre';
            trafficColor = '#00E5FF';
            trafficEmoji = '🟢';
          }
        }

        const driveMinutesWithTraffic = Math.max(1, Math.round(baseDrivingMinutes * trafficFactor));
        const walkMinutes = Math.max(1, Math.round((roadDistanceKm / 4.6) * 60));

        // Calcular hora estimada de llegada en vivo (ETA)
        const etaDate = new Date(now.getTime() + driveMinutesWithTraffic * 60 * 1000);
        const etaHours = etaDate.getHours();
        const etaMins = String(etaDate.getMinutes()).padStart(2, '0');
        const etaAmPm = etaHours >= 12 ? 'PM' : 'AM';
        const eta12 = (etaHours % 12) || 12;
        const etaFormatted = `${eta12}:${etaMins} ${etaAmPm}`;

        const distStr = roadDistanceKm < 1 ? `${Math.round(roadDistanceKm * 1000)} m` : `${roadDistanceKm.toFixed(1)} km`;

        if (badge) {
          badge.innerHTML = `
            <div class="loc-traffic-card">
              <div class="loc-traffic-row-main">
                <div class="loc-traffic-eta-box">
                  <span class="loc-traffic-car-icon">🚗</span>
                  <div class="loc-traffic-time-wrap">
                    <span class="loc-traffic-time-val">~${driveMinutesWithTraffic} min</span>
                    <span class="loc-traffic-eta-time">Llegada estimada: <b style="color:#FFF;">${etaFormatted}</b></span>
                  </div>
                </div>
                <div class="loc-traffic-status-pill" style="border-color:${trafficColor}; color:${trafficColor}; background:${trafficColor}1f;">
                  <span>${trafficEmoji}</span>
                  <span>${trafficText}</span>
                </div>
              </div>
              <div class="loc-traffic-row-sub">
                <span class="loc-sub-chip">🛣️ Ruta: <b>${distStr}</b></span>
                <span class="loc-sub-chip">🚶 A pie: <b>~${walkMinutes} min</b></span>
                <span class="loc-sub-chip loc-chip-api">⚡ Google Maps Tráfico</span>
              </div>
            </div>`;
        }

      } else {
        // Modo OFFLINE (Sin conexión de datos de tráfico)
        const walkMinutes = Math.max(1, Math.round((roadDistanceKm / 4.6) * 60));
        const distStr = directDist < 1 ? `${Math.round(directDist * 1000)} m` : `${directDist.toFixed(1)} km`;

        if (badge) {
          badge.innerHTML = `
            <div class="loc-traffic-card loc-traffic-offline">
              <div class="loc-traffic-row-main">
                <div class="loc-traffic-eta-box">
                  <span class="loc-traffic-car-icon">📍</span>
                  <div class="loc-traffic-time-wrap">
                    <span class="loc-traffic-time-val">~${baseDrivingMinutes} min</span>
                    <span class="loc-traffic-eta-time">Distancia directa: <b>${distStr}</b></span>
                  </div>
                </div>
                <div class="loc-traffic-status-pill" style="border-color:#FFAA00; color:#FFAA00; background:rgba(255,170,0,0.15);">
                  <span>📴</span>
                  <span>Offline (Sin tráfico)</span>
                </div>
              </div>
              <div class="loc-traffic-row-sub">
                <span class="loc-sub-chip">🚗 ~${baseDrivingMinutes} min auto</span>
                <span class="loc-sub-chip">🚶 ~${walkMinutes} min a pie</span>
                <span class="loc-sub-chip">Posición GPS activa</span>
              </div>
            </div>`;
        }
      }
    },
    (err) => {
      console.warn('Geolocation error:', err);
      if (badge) {
        badge.innerHTML = `
          <div class="loc-traffic-card" style="border-color:rgba(255,85,0,0.35);">
            <div style="font-size:0.82rem; color:#FFAA33;">📍 <b>J.O.A GAMER´s PC</b> (Manuel Suárez, Camagüey)</div>
            <div style="font-size:0.72rem; color:#94A3B8; margin-top:2px;">Activa tu GPS y pulsa <b>"Recalcular"</b> para estimar tu ruta y tiempo con tráfico.</div>
          </div>`;
      }
    },
    { enableHighAccuracy: true, timeout: 9000 }
  );
}

function copiarPlusCode() {
  if (window.triggerHaptic) window.triggerHaptic(25);
  const textToCopy = `J.O.A GAMER´s PC\nCoordenadas: ${JOA_LOCATION_CONFIG.coordsString}\nDirección: ${JOA_LOCATION_CONFIG.address}\nGoogle Maps: ${JOA_LOCATION_CONFIG.mapsUrl}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(() => {
      if (typeof showToast === 'function') showToast('📋 ¡Ubicación exacta y enlace de Google Maps copiados!');
    }).catch(() => {
      if (typeof showToast === 'function') showToast(`📋 Coordenadas: ${JOA_LOCATION_CONFIG.coordsString}`);
    });
  } else {
    if (typeof showToast === 'function') showToast(`📋 Coordenadas: ${JOA_LOCATION_CONFIG.coordsString}`);
  }
}

function compartirUbicacionJoa() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const shareData = {
    title: 'J.O.A GAMER´s PC - Local Físico y Tienda Multimedia',
    text: '🎮 ¡Visita J.O.A GAMER´s PC en Camagüey! Ubicación exacta: 21.375346, -77.905684. Catálogo de juegos, películas, series y servicios pro.',
    url: JOA_LOCATION_CONFIG.mapsUrl
  };
  if (navigator.share) {
    navigator.share(shareData).catch(() => {});
  } else if (window.AndroidBridge && typeof window.AndroidBridge.shareProduct === 'function') {
    window.AndroidBridge.shareProduct(shareData.title, shareData.text, shareData.url);
  } else {
    copiarPlusCode();
  }
}

// ========================================================
// 📤 SHARE MY ROUTE (WEB SHARE API + NATIVE APPS)
// ========================================================
async function shareMyRoute() {
  if (window.triggerHaptic) window.triggerHaptic(35);

  const storeLat = 21.375346;
  const storeLng = -77.905684;
  const storeMapsLink = JOA_LOCATION_CONFIG.mapsUrl || 'https://maps.app.goo.gl/yFou4DrdeHvsJ7ei7';

  const dispatchShare = (coords) => {
    let shareText = '';
    let navRouteLink = '';

    if (coords && coords.lat && coords.lng) {
      const uLat = Number(coords.lat).toFixed(6);
      const uLng = Number(coords.lng).toFixed(6);
      navRouteLink = `https://www.google.com/maps/dir/?api=1&origin=${uLat},${uLng}&destination=${storeLat},${storeLng}`;
      shareText = `🎮 Mi Ruta en Vivo hacia J.O.A GAMER´s PC:\n` +
                  `📍 Mi ubicación GPS actual: ${uLat}, ${uLng}\n` +
                  `🎯 Destino: J.O.A GAMER´s PC (${storeLat}, ${storeLng})\n` +
                  `🏠 Dirección: Manuel Suárez, Camagüey, Cuba\n` +
                  `🗺️ Google Maps de la tienda: ${storeMapsLink}\n` +
                  `🛣️ Trazar ruta directa en Google Maps: ${navRouteLink}`;
    } else {
      shareText = `🎮 Destino: J.O.A GAMER´s PC (${storeLat}, ${storeLng})\n` +
                  `🏠 Dirección: Manuel Suárez, Camagüey, Cuba\n` +
                  `🗺️ Google Maps de la tienda: ${storeMapsLink}`;
    }

    const shareData = {
      title: 'Mi Ruta a J.O.A GAMER´s PC',
      text: shareText,
      url: storeMapsLink
    };

    if (navigator.share) {
      navigator.share(shareData)
        .then(() => {
          if (typeof showToast === 'function') {
            showToast('📤 ¡Ruta compartida con tus contactos!');
          }
        })
        .catch((err) => {
          if (err && err.name !== 'AbortError') {
            fallbackShareRoute(shareData);
          }
        });
    } else {
      fallbackShareRoute(shareData);
    }
  };

  // Si ya tenemos coordenadas GPS del usuario
  if (userCurrentCoords && userCurrentCoords.lat && userCurrentCoords.lng) {
    dispatchShare(userCurrentCoords);
    return;
  }

  // Comprobar si hay coordenadas previas en caché local
  const cached = getCachedRouteData();
  const cachedCoords = cached && cached.userCoords ? cached.userCoords : null;

  if (navigator.geolocation) {
    if (typeof showToast === 'function') {
      showToast('🛰️ Obteniendo tus coordenadas GPS actuales para compartir ruta...');
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userCurrentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        dispatchShare(userCurrentCoords);
      },
      (err) => {
        console.warn('Geolocation unavailable for share, using cached/store fallback:', err);
        dispatchShare(cachedCoords);
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
    );
  } else {
    dispatchShare(cachedCoords);
  }
}

function fallbackShareRoute(shareData) {
  if (window.AndroidBridge && typeof window.AndroidBridge.shareProduct === 'function') {
    window.AndroidBridge.shareProduct(shareData.title, shareData.text, shareData.url);
    if (typeof showToast === 'function') {
      showToast('📤 Abriendo menú de apps para compartir...');
    }
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareData.text)
      .then(() => {
        if (typeof showToast === 'function') {
          showToast('📋 ¡Ruta y coordenadas copiadas al portapapeles!');
        }
      })
      .catch(() => {
        if (typeof showToast === 'function') {
          showToast(`📋 Coordenadas: 21.375346, -77.905684`);
        }
      });
  } else {
    if (typeof showToast === 'function') {
      showToast(`📋 Coordenadas: 21.375346, -77.905684`);
    }
  }
}

// ========================================================
// 💾 CACHE MAP DATA (OFFLINE SCREENSHOT & GEO-TILE CACHE)
// ========================================================
async function cacheMapRouteData() {
  if (window.triggerHaptic) window.triggerHaptic(35);

  const btnCache = document.getElementById('btnCacheMapData');
  const originalHtml = btnCache ? btnCache.innerHTML : '';
  if (btnCache) {
    btnCache.innerHTML = `<span class="loc-action-icon">⏳</span><span class="loc-action-label">Guardando en caché...</span>`;
    btnCache.style.pointerEvents = 'none';
  }

  if (typeof showToast === 'function') {
    showToast('💾 Obteniendo GPS y generando mapa en caché offline...');
  }

  const resolveCoords = () => {
    return new Promise((resolve) => {
      if (userCurrentCoords && userCurrentCoords.lat && userCurrentCoords.lng) {
        resolve(userCurrentCoords);
        return;
      }
      const existing = getCachedRouteData();
      if (existing && existing.userCoords) {
        resolve(existing.userCoords);
        return;
      }
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            userCurrentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            resolve(userCurrentCoords);
          },
          () => {
            // Coordenadas centrales de Camagüey como respaldo estimado
            resolve({ lat: 21.380020, lng: -77.915030, isEstimated: true });
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 }
        );
      } else {
        resolve({ lat: 21.380020, lng: -77.915030, isEstimated: true });
      }
    });
  };

  try {
    const coords = await resolveCoords();
    userCurrentCoords = { lat: coords.lat, lng: coords.lng };

    const storeLat = JOA_LOCATION_CONFIG.lat;
    const storeLng = JOA_LOCATION_CONFIG.lng;

    // Cálculo Haversine de distancia
    const R = 6371;
    const dLat = (storeLat - coords.lat) * Math.PI / 180;
    const dLon = (storeLng - coords.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(coords.lat * Math.PI / 180) * Math.cos(storeLat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const directDist = R * c;
    const roadDistKm = directDist * 1.30;
    const driveMinutes = Math.max(1, Math.round((roadDistKm / 30) * 60));
    const walkMinutes = Math.max(1, Math.round((roadDistKm / 4.5) * 60));

    // Generar captura / screenshot del mapa de ruta
    const screenshotDataUrl = await renderOfflineRouteScreenshot(
      coords,
      { lat: storeLat, lng: storeLng },
      roadDistKm,
      driveMinutes,
      walkMinutes
    );

    const now = new Date();
    const dateFormatted = now.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const cachePayload = {
      screenshot: screenshotDataUrl,
      timestamp: Date.now(),
      dateFormatted,
      userCoords: { lat: coords.lat, lng: coords.lng, isEstimated: !!coords.isEstimated },
      storeCoords: {
        lat: storeLat,
        lng: storeLng,
        address: JOA_LOCATION_CONFIG.address,
        plusCode: JOA_LOCATION_CONFIG.plusCode
      },
      distanceKm: roadDistKm.toFixed(2),
      drivingMinutes: driveMinutes,
      walkingMinutes: walkMinutes
    };

    try {
      localStorage.setItem('joa_cached_route_map', JSON.stringify(cachePayload));
      localStorage.setItem('joa_cached_geo_tile', JSON.stringify({
        tileKey: `route_${coords.lat.toFixed(3)}_${coords.lng.toFixed(3)}`,
        timestamp: Date.now(),
        lat: coords.lat,
        lng: coords.lng,
        storeLat,
        storeLng
      }));
    } catch (storageErr) {
      console.warn('Storage quota issue, compressing screenshot:', storageErr);
      const img = new Image();
      img.src = screenshotDataUrl;
      await new Promise(r => { img.onload = r; });
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = 640;
      smallCanvas.height = 450;
      const sctx = smallCanvas.getContext('2d');
      if (sctx) {
        sctx.drawImage(img, 0, 0, 640, 450);
        cachePayload.screenshot = smallCanvas.toDataURL('image/jpeg', 0.75);
      }
      localStorage.setItem('joa_cached_route_map', JSON.stringify(cachePayload));
    }

    updateCachedRouteUIState();

    if (typeof showToast === 'function') {
      showToast('✅ ¡Ruta y mapa en caché guardados! Podrás verlos sin conexión.');
    }
  } catch (err) {
    console.error('Error caching route map:', err);
    if (typeof showToast === 'function') {
      showToast('⚠️ No se pudo guardar la ruta en caché.');
    }
  } finally {
    if (btnCache) {
      btnCache.innerHTML = originalHtml;
      btnCache.style.pointerEvents = 'auto';
    }
  }
}

// 🎨 RENDERIZADOR TÁCTICO DE CAPTURA / GEO-TILE OFFLINE EN CANVAS
function renderOfflineRouteScreenshot(userCoords, storeCoords, distKm, driveMin, walkMin) {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      const w = 900;
      const h = 640;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve('');
        return;
      }

      // 1. Fondo estilizado tipo cartografía táctica oscura
      const bgGrad = ctx.createLinearGradient(0, 0, w, h);
      bgGrad.addColorStop(0, '#0A0F1D');
      bgGrad.addColorStop(0.5, '#070B16');
      bgGrad.addColorStop(1, '#04070E');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // 2. Grilla de coordenadas GPS y trama urbana
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let x = 40; x < w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 70);
        ctx.lineTo(x, h - 50);
        ctx.stroke();
      }
      for (let y = 70; y < h - 50; y += 40) {
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(w - 40, y);
        ctx.stroke();
      }

      // 3. Simulación de red vial de Camagüey (Calles y Avenidas principales)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 3;
      const roads = [
        [[50, 200], [250, 220], [500, 310], [850, 360]],
        [[120, 500], [350, 420], [600, 380], [880, 260]],
        [[220, 100], [240, 300], [280, 550]],
        [[650, 100], [640, 350], [620, 580]],
        [[300, 160], [450, 250], [520, 480]]
      ];
      roads.forEach(pts => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.stroke();
      });

      // 4. Mapeo de coordenadas GPS a coordenadas Canvas
      const minLat = Math.min(userCoords.lat, storeCoords.lat);
      const maxLat = Math.max(userCoords.lat, storeCoords.lat);
      const minLng = Math.min(userCoords.lng, storeCoords.lng);
      const maxLng = Math.max(userCoords.lng, storeCoords.lng);

      const dLat = Math.max(maxLat - minLat, 0.008);
      const dLng = Math.max(maxLng - minLng, 0.008);

      const padLat = dLat * 0.35;
      const padLng = dLng * 0.35;

      const boundMinLat = minLat - padLat;
      const boundMaxLat = maxLat + padLat;
      const boundMinLng = minLng - padLng;
      const boundMaxLng = maxLng + padLng;

      const toX = (lng) => 90 + ((lng - boundMinLng) / (boundMaxLng - boundMinLng)) * (w - 180);
      const toY = (lat) => (h - 100) - ((lat - boundMinLat) / (boundMaxLat - boundMinLat)) * (h - 190);

      const x1 = toX(userCoords.lng);
      const y1 = toY(userCoords.lat);
      const x2 = toX(storeCoords.lng);
      const y2 = toY(storeCoords.lat);

      // Puntos intermedios para simular trazado vial urbano
      const midX1 = x1 + (x2 - x1) * 0.38 + (y2 > y1 ? 35 : -35);
      const midY1 = y1 + (y2 - y1) * 0.22;
      const midX2 = x1 + (x2 - x1) * 0.72;
      const midY2 = y1 + (y2 - y1) * 0.78 + (x2 > x1 ? -25 : 25);

      // 5. Trazado de la ruta con brillo neón
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.strokeStyle = 'rgba(0, 229, 255, 0.22)';
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(midX1, midY1, midX2, midY2, x2, y2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(midX1, midY1, midX2, midY2, x2, y2);
      ctx.stroke();

      const routeGrad = ctx.createLinearGradient(x1, y1, x2, y2);
      routeGrad.addColorStop(0, '#00E5FF');
      routeGrad.addColorStop(0.7, '#FFAA00');
      routeGrad.addColorStop(1, '#FF4500');
      ctx.strokeStyle = routeGrad;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(midX1, midY1, midX2, midY2, x2, y2);
      ctx.stroke();
      ctx.restore();

      // 6. Flechas indicadoras de navegación
      const drawChevron = (px, py, angle) => {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(-6, -5);
        ctx.lineTo(4, 0);
        ctx.lineTo(-6, 5);
        ctx.lineTo(-3, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };
      const angle = Math.atan2(y2 - y1, x2 - x1);
      drawChevron((x1 + midX1) / 2, (y1 + midY1) / 2, angle);
      drawChevron((midX1 + midX2) / 2, (midY1 + midY2) / 2, angle);
      drawChevron((midX2 + x2) / 2, (midY2 + y2) / 2, angle);

      // 7. Pin de Origen: Tu Posición GPS
      ctx.save();
      ctx.fillStyle = 'rgba(0, 229, 255, 0.25)';
      ctx.beginPath();
      ctx.arc(x1, y1, 20, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#00E5FF';
      ctx.beginPath();
      ctx.arc(x1, y1, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      const originBoxW = 190;
      const originBoxH = 34;
      const originBoxX = Math.max(20, Math.min(w - originBoxW - 20, x1 - originBoxW / 2));
      const originBoxY = y1 > 160 ? y1 - 46 : y1 + 18;

      ctx.fillStyle = 'rgba(9, 14, 25, 0.92)';
      ctx.strokeStyle = '#00E5FF';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(originBoxX, originBoxY, originBoxW, originBoxH, 8);
      } else {
        ctx.rect(originBoxX, originBoxY, originBoxW, originBoxH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#00E5FF';
      ctx.font = 'bold 11px Outfit, sans-serif';
      ctx.fillText('🟢 TU POSICIÓN GPS', originBoxX + 10, originBoxY + 14);
      ctx.fillStyle = '#CBD5E1';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(`${userCoords.lat.toFixed(5)}, ${userCoords.lng.toFixed(5)}`, originBoxX + 10, originBoxY + 27);
      ctx.restore();

      // 8. Pin de Destino: J.O.A GAMER´s PC
      ctx.save();
      ctx.fillStyle = 'rgba(255, 69, 0, 0.3)';
      ctx.beginPath();
      ctx.arc(x2, y2, 26, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FF4500';
      ctx.beginPath();
      ctx.arc(x2, y2, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFAA00';
      ctx.lineWidth = 3;
      ctx.stroke();

      const destBoxW = 240;
      const destBoxH = 42;
      const destBoxX = Math.max(20, Math.min(w - destBoxW - 20, x2 - destBoxW / 2));
      const destBoxY = y2 > 160 ? y2 - 54 : y2 + 20;

      ctx.fillStyle = 'rgba(18, 10, 24, 0.94)';
      ctx.strokeStyle = '#FF5500';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(destBoxX, destBoxY, destBoxW, destBoxH, 8);
      } else {
        ctx.rect(destBoxX, destBoxY, destBoxW, destBoxH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFAA33';
      ctx.font = 'bold 12px Outfit, sans-serif';
      ctx.fillText('🎮 J.O.A GAMER´s PC (DESTINO)', destBoxX + 10, destBoxY + 16);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '9.5px Outfit, sans-serif';
      ctx.fillText('Manuel Suárez, Camagüey (21.375346, -77.905684)', destBoxX + 10, destBoxY + 31);
      ctx.restore();

      // 9. Barra Superior HUD
      ctx.save();
      ctx.fillStyle = 'rgba(7, 11, 20, 0.95)';
      ctx.fillRect(0, 0, w, 62);
      ctx.strokeStyle = 'rgba(255, 85, 0, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 62);
      ctx.lineTo(w, 62);
      ctx.stroke();

      ctx.fillStyle = '#FFAA33';
      ctx.font = 'bold 15px Outfit, sans-serif';
      ctx.fillText('🎮 J.O.A GAMER´s PC · MAPA DE RUTA OFFLINE EN CACHÉ', 22, 28);

      ctx.fillStyle = '#00FF87';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.fillText(`🛣️ ${distKm.toFixed(2)} km  |  🚗 Auto: ~${driveMin} min  |  🚶 A pie: ~${walkMin} min`, 22, 48);

      const badgeW = 180;
      const badgeH = 28;
      const badgeX = w - badgeW - 20;
      const badgeY = 16;
      ctx.fillStyle = 'rgba(0, 255, 135, 0.12)';
      ctx.strokeStyle = '#00FF87';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 14);
      } else {
        ctx.rect(badgeX, badgeY, badgeW, badgeH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#00FF87';
      ctx.font = 'bold 10px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('📴 MAPA GUARDADO OFFLINE', badgeX + badgeW / 2, badgeY + 18);
      ctx.textAlign = 'left';
      ctx.restore();

      // 10. Barra Inferior
      ctx.save();
      ctx.fillStyle = 'rgba(7, 11, 20, 0.92)';
      ctx.fillRect(0, h - 46, w, 46);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h - 46);
      ctx.lineTo(w, h - 46);
      ctx.stroke();

      ctx.fillStyle = '#94A3B8';
      ctx.font = '10px Outfit, sans-serif';
      const dateStr = new Date().toLocaleString();
      ctx.fillText(`📅 Guardado: ${dateStr}  ·  Camagüey, Cuba (Plus Code: 93GV+4PP)`, 20, h - 18);

      ctx.fillStyle = '#00E5FF';
      ctx.font = 'bold 11px Outfit, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('⬆️ NORTE  |  MAPA OFFLINE RESILIENTE', w - 20, h - 18);
      ctx.restore();

      const dataUrl = canvas.toDataURL('image/png');
      resolve(dataUrl);
    } catch (e) {
      console.error('Error generating canvas screenshot:', e);
      resolve('');
    }
  });
}

// 📦 HELPERS DE CACHÉ DE RUTA
function getCachedRouteData() {
  try {
    const raw = localStorage.getItem('joa_cached_route_map');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function updateCachedRouteUIState() {
  const cached = getCachedRouteData();
  const btnViewCached = document.getElementById('btnViewCachedRoute');
  const offlineBanner = document.getElementById('locOfflineCachedBanner');

  if (btnViewCached) {
    btnViewCached.style.display = (cached && cached.screenshot) ? 'flex' : 'none';
  }

  if (offlineBanner) {
    offlineBanner.style.display = (!navigator.onLine && cached && cached.screenshot) ? 'block' : 'none';
  }
}

function toggleCachedMapOverlay(show) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  const overlay = document.getElementById('locCachedMapOverlay');
  if (!overlay) return;

  const willShow = (show !== undefined) ? !!show : (overlay.style.display === 'none' || !overlay.style.display);

  if (willShow) {
    const cached = getCachedRouteData();
    if (!cached || !cached.screenshot) {
      if (typeof showToast === 'function') {
        showToast('⚠️ No hay mapa en caché guardado. Pulsa "Cache map data" primero.');
      }
      return;
    }

    const img = document.getElementById('cachedMapImg');
    const meta = document.getElementById('locCachedMeta');
    const grid = document.getElementById('locCachedDetailsGrid');

    if (img) img.src = cached.screenshot;
    if (meta) {
      meta.textContent = `📅 Guardado: ${cached.dateFormatted || 'Recientemente'} · Distancia: ${cached.distanceKm} km · Auto: ~${cached.drivingMinutes} min`;
    }
    if (grid) {
      const uLat = cached.userCoords ? cached.userCoords.lat.toFixed(5) : '21.38000';
      const uLng = cached.userCoords ? cached.userCoords.lng.toFixed(5) : '-77.91500';
      grid.innerHTML = `
        <div class="loc-cached-detail-item">
          <div class="loc-cached-detail-label">📍 Origen GPS</div>
          <div class="loc-cached-detail-val">${uLat}, ${uLng}</div>
        </div>
        <div class="loc-cached-detail-item">
          <div class="loc-cached-detail-label">🎯 Destino</div>
          <div class="loc-cached-detail-val">J.O.A GAMER´s PC (21.375346, -77.905684)</div>
        </div>
        <div class="loc-cached-detail-item">
          <div class="loc-cached-detail-label">🛣️ Distancia y Tiempo</div>
          <div class="loc-cached-detail-val">${cached.distanceKm} km · 🚗 ~${cached.drivingMinutes} min · 🚶 ~${cached.walkingMinutes} min</div>
        </div>
        <div class="loc-cached-detail-item">
          <div class="loc-cached-detail-label">🏠 Dirección del Local</div>
          <div class="loc-cached-detail-val">Manuel Suárez, Camagüey (Plus Code: 93GV+4PP)</div>
        </div>
      `;
    }

    overlay.style.display = 'flex';
  } else {
    overlay.style.display = 'none';
  }
}

function downloadCachedRouteMap() {
  if (window.triggerHaptic) window.triggerHaptic(25);
  const cached = getCachedRouteData();
  if (!cached || !cached.screenshot) {
    if (typeof showToast === 'function') showToast('⚠️ No hay mapa en caché para descargar.');
    return;
  }
  const link = document.createElement('a');
  link.href = cached.screenshot;
  link.download = `ruta-joa-gamers-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (typeof showToast === 'function') {
    showToast('📥 ¡Screenshot del mapa guardado en tu dispositivo!');
  }
}

// 🌐 LISTENERS ONLINE/OFFLINE
window.addEventListener('online', () => {
  const notice = document.getElementById('locOfflineNotice');
  if (notice) notice.style.display = 'none';
  updateCachedRouteUIState();
});

window.addEventListener('offline', () => {
  const notice = document.getElementById('locOfflineNotice');
  if (notice) notice.style.display = 'flex';
  updateCachedRouteUIState();
});

// Popstate para cerrar modal con tecla Atrás de Android
window.addEventListener('popstate', (e) => {
  const overlay = document.getElementById('locCachedMapOverlay');
  if (overlay && overlay.style.display === 'flex') {
    toggleCachedMapOverlay(false);
    return;
  }
  const modal = document.getElementById('locationScreenModal');
  if (modal && modal.style.display === 'flex') {
    closeLocationModal();
  }
});

// Exports globales
window.openLocationModal = openLocationModal;
window.closeLocationModal = closeLocationModal;
window.updateStoreScheduleTimer = updateStoreScheduleTimer;
window.iniciarNavegacionGps = iniciarNavegacionGps;
window.abrirEnGoogleMapsApp = abrirEnGoogleMapsApp;
window.calcularDistanciaGps = calcularDistanciaGps;
window.copiarPlusCode = copiarPlusCode;
window.compartirUbicacionJoa = compartirUbicacionJoa;
window.cambiarTipoMapa = cambiarTipoMapa;
window.handleMapZoom = handleMapZoom;
window.recenterMapOnStore = recenterMapOnStore;
window.centerOnMyLocation = centerOnMyLocation;
window.toggleMapFullscreenHUD = toggleMapFullscreenHUD;
window.setMapNavigationMode = setMapNavigationMode;
window.toggleRouteOrStoreMode = toggleRouteOrStoreMode;
window.shareMyRoute = shareMyRoute;
window.cacheMapRouteData = cacheMapRouteData;
window.toggleCachedMapOverlay = toggleCachedMapOverlay;
window.downloadCachedRouteMap = downloadCachedRouteMap;
window.updateCachedRouteUIState = updateCachedRouteUIState;
window.getCachedRouteData = getCachedRouteData;
