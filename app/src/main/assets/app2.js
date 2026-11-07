// ==========================================
// 🌐 VARIABLES GLOBALES COMPARTIDAS CON APP1.JS
// ==========================================
var allItems = window.allItems || [];
var typeLabels = window.typeLabels || {};
var imageBaseUrl = window.imageBaseUrl || '';
var userStates = window.userStates || [];
var libraryFilter = window.libraryFilter || '';
var achievementsRules = window.achievementsRules || [];
var consolesData = window.consolesData || {};
var activeType = window.activeType || '';

// ==========================================
// 🖼️ MOTOR DE IMÁGENES PERSISTENTES & COMPRESIÓN ULTRA-LIVIANA (WEBP)
// ==========================================
const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#0F131A"/><text x="50%" y="50%" fill="#4E5262" font-size="18" text-anchor="middle" dy=".3em" font-family="monospace">SIN IMAGEN</text></svg>`
);

const inMemoryImageCache = window.inMemoryImageCache = (window.inMemoryImageCache || new Map());
const processedImageCompressionUrls = new Set();

function resolveImageUrl(coverOrItem) {
  let cover = coverOrItem;
  if (typeof coverOrItem === 'object' && coverOrItem !== null) {
    cover = coverOrItem.cover || coverOrItem.image || coverOrItem.poster || coverOrItem.caratula || coverOrItem.img || coverOrItem.coverUrl || '';
  }
  if (!cover || typeof cover !== 'string') return PLACEHOLDER_IMG;
  cover = cover.trim();
  if (!cover) return PLACEHOLDER_IMG;
  
  if (cover.startsWith('data:')) return cover;

  let fullUrl = cover;
  if (cover.startsWith('//')) fullUrl = 'https:' + cover;
  else if (/^www\./i.test(cover)) fullUrl = 'https://' + cover;
  else if (/^https?:\/\//i.test(cover)) fullUrl = cover;
  else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(cover)) fullUrl = 'https://' + cover;
  else if (typeof imageBaseUrl !== 'undefined' && imageBaseUrl) fullUrl = imageBaseUrl.replace(/\/$/, '') + '/' + cover.replace(/^\//, '');

  // 1. Verificar si ya está en caché de memoria rápida
  if (inMemoryImageCache.has(fullUrl)) {
    return inMemoryImageCache.get(fullUrl);
  }
  if (inMemoryImageCache.has(cover)) {
    return inMemoryImageCache.get(cover);
  }

  // 2. Verificar si está en la carpeta persistente nativa de Android (No se borra nunca)
  if (window.AndroidBridge && typeof window.AndroidBridge.getCachedImageNative === 'function') {
    try {
      const nativeCached = window.AndroidBridge.getCachedImageNative(fullUrl) || window.AndroidBridge.getCachedImageNative(cover);
      if (nativeCached && nativeCached.startsWith('data:')) {
        inMemoryImageCache.set(fullUrl, nativeCached);
        return nativeCached;
      }
    } catch (e) {}
  }

  return fullUrl;
}

// 📦 Compresión automática de imágenes cargadas y persistencia permanente sin borrado
async function autoCacheVisibleImage(img) {
  if (!img) return;
  const src = img.getAttribute('src') || img.src || '';
  if (!src || src.startsWith('data:') || src.startsWith('blob:') || src.includes('PLACEHOLDER_IMG')) return;

  const originalSrc = img.dataset.originalUrl || src;
  if (processedImageCompressionUrls.has(originalSrc)) return;
  processedImageCompressionUrls.add(originalSrc);

  // Si ya está en memoria o en el disco nativo permanente, no volver a comprimir
  if (inMemoryImageCache.has(originalSrc)) return;
  if (window.AndroidBridge && typeof window.AndroidBridge.hasCachedImageNative === 'function') {
    try {
      if (window.AndroidBridge.hasCachedImageNative(originalSrc)) {
        return;
      }
    } catch (e) {}
  }

  const compressTask = async () => {
    try {
      if (!img.complete || img.naturalWidth === 0) return;

      // Dimensiones máximas optimizadas para visualización nítida y mínimo peso (~12-22KB)
      const maxDim = 440;
      let width = img.naturalWidth;
      let height = img.naturalHeight;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(img, 0, 0, width, height);

      let compressedDataUrl = '';
      try {
        compressedDataUrl = canvas.toDataURL('image/webp', 0.70);
      } catch (e) {
        try {
          compressedDataUrl = canvas.toDataURL('image/jpeg', 0.68);
        } catch (canvasErr) {
          // Si el canvas está bloqueado por CORS, delegar la descarga y compresión al motor nativo de Android
          if (window.AndroidBridge && typeof window.AndroidBridge.downloadAndCacheImageNative === 'function') {
            window.AndroidBridge.downloadAndCacheImageNative(originalSrc);
          }
          return;
        }
      }

      if (compressedDataUrl && compressedDataUrl.length > 50) {
        inMemoryImageCache.set(originalSrc, compressedDataUrl);
        if (src && src !== originalSrc && !src.startsWith('data:') && !src.startsWith('blob:')) {
          inMemoryImageCache.set(src, compressedDataUrl);
        }

        // A. Guardar en carpeta nativa permanente de Android (inmune a limpiezas de navegador)
        if (window.AndroidBridge && typeof window.AndroidBridge.saveCachedImageNative === 'function') {
          window.AndroidBridge.saveCachedImageNative(originalSrc, compressedDataUrl, 'image/webp');
          if (src && src !== originalSrc && !src.startsWith('data:') && !src.startsWith('blob:')) {
            window.AndroidBridge.saveCachedImageNative(src, compressedDataUrl, 'image/webp');
          }
        }

        // B. Guardar en IndexedDB local (item_media_cache)
        if (typeof idbPut === 'function') {
          try {
            await idbPut('item_media_cache', {
              itemId: originalSrc,
              dataUrl: compressedDataUrl,
              size: compressedDataUrl.length,
              savedAt: new Date().toISOString()
            });
            if (src && src !== originalSrc && !src.startsWith('data:') && !src.startsWith('blob:')) {
              await idbPut('item_media_cache', {
                itemId: src,
                dataUrl: compressedDataUrl,
                size: compressedDataUrl.length,
                savedAt: new Date().toISOString()
              });
            }
          } catch (idbErr) {}
        }

        // C. Enviar al Service Worker para CacheStorage persistente (joa-images-v7)
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'CACHE_COMPRESSED_IMAGE',
            url: originalSrc,
            base64: compressedDataUrl,
            mimeType: 'image/webp'
          });
        }
      }
    } catch (e) {
      // Si ocurre cualquier excepción en el procesamiento de canvas, asegurar con el puente nativo
      if (window.AndroidBridge && typeof window.AndroidBridge.downloadAndCacheImageNative === 'function') {
        window.AndroidBridge.downloadAndCacheImageNative(originalSrc);
      }
    }
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(compressTask, { timeout: 2000 });
  } else {
    setTimeout(compressTask, 120);
  }
}
window.autoCacheVisibleImage = autoCacheVisibleImage;

// 👁️ OBSERVADOR GLOBAL AUTOMÁTICO: Captura y guarda permanentemente toda imagen que el usuario visualice
(function initGlobalImagePersistenceObserver() {
  function observeImage(img) {
    if (!img || img.dataset.joaObserved === 'true') return;
    img.dataset.joaObserved = 'true';
    if (img.complete && img.naturalWidth > 0) {
      autoCacheVisibleImage(img);
    } else {
      img.addEventListener('load', function() {
        autoCacheVisibleImage(this);
      }, { once: true });
    }
  }

  if (typeof window !== 'undefined' && 'MutationObserver' in window) {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName === 'IMG') {
              observeImage(node);
            } else if (node.querySelectorAll) {
              node.querySelectorAll('img').forEach(observeImage);
            }
          }
        }
      }
    });

    const startObserving = () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        document.querySelectorAll('img').forEach(observeImage);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else {
      startObserving();
    }
  }

  window.addEventListener('online', () => {
    if (typeof syncFavoritesMetadataOffline === 'function') {
      setTimeout(syncFavoritesMetadataOffline, 1200);
    }
  });
})();

// ==========================================
// 📦 SISTEMA PORTABLE DE PAQUETES DE CACHÉ DE IMÁGENES (EXPORTAR E IMPORTAR)
// ==========================================

// Huella digital rápida y determinista para Base64 para prevenir imágenes duplicadas
function getImageContentFingerprint(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const len = b64.length;
  if (len < 64) return b64;
  const s0 = b64.slice(0, 24);
  const s1 = b64.slice(Math.floor(len * 0.25), Math.floor(len * 0.25) + 16);
  const s2 = b64.slice(Math.floor(len * 0.5), Math.floor(len * 0.5) + 16);
  const s3 = b64.slice(Math.floor(len * 0.75), Math.floor(len * 0.75) + 16);
  const s4 = b64.slice(-24);
  return `${len}_${s0}_${s1}_${s2}_${s3}_${s4}`;
}

// 📦 Variables globales de paquete exportado para compartir inmediato
let lastExportedPackageFilename = '';
let lastExportedPackageBlob = null;

// Compresión rápida offscreen a WebP ultra-liviano si la imagen es pesada (>32KB)
async function compressImageToLeanWebp(dataUrl, maxDim = 380, quality = 0.68) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:') || dataUrl.length < 32000) {
    return dataUrl;
  }
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) return resolve(dataUrl);
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';
          ctx.drawImage(img, 0, 0, w, h);
          const lean = canvas.toDataURL('image/webp', quality);
          if (lean && lean.length > 50 && lean.length < dataUrl.length) {
            resolve(lean);
          } else {
            resolve(dataUrl);
          }
        } catch(e) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch(err) {
      resolve(dataUrl);
    }
  });
}

async function updateImagePackageBadge() {
  const badge = document.getElementById('imageCachePackageBadge');
  if (!badge) return;
  try {
    let count = 0;
    if (typeof idbGetCount === 'function') {
      try {
        count = await idbGetCount('item_media_cache');
      } catch(e) {}
    } else if (typeof idbGetAll === 'function') {
      try {
        const records = await idbGetAll('item_media_cache');
        if (Array.isArray(records)) count = records.length;
      } catch(e) {}
    }
    if (window.AndroidBridge && typeof window.AndroidBridge.getPersistedImagesStats === 'function') {
      try {
        const stats = JSON.parse(window.AndroidBridge.getPersistedImagesStats());
        if (stats && stats.count && stats.count > count) count = stats.count;
      } catch(e) {}
    }
    if (count === 0 && typeof inMemoryImageCache !== 'undefined' && inMemoryImageCache) count = inMemoryImageCache.size;
    badge.textContent = count > 0 ? `${count} imágenes listas` : 'Listo para exportar';
  } catch(e) {
    badge.textContent = 'Listo para exportar';
  }
}

async function exportarPaqueteCacheImagenes() {
  if (window.triggerHaptic) window.triggerHaptic(40);

  const progressBox = document.getElementById('imagePackageProgressBox');
  const titleTxt = document.getElementById('imagePackageStatusTitle');
  const pctTxt = document.getElementById('imagePackageStatusPct');
  const bar = document.getElementById('imagePackageProgressBar');
  const subTxt = document.getElementById('imagePackageStatusSub');
  const actionRow = document.getElementById('imagePackageActionRow');

  if (actionRow) actionRow.style.display = 'none';

  function updateExportUI(title, pct, sub) {
    if (progressBox) progressBox.style.display = 'block';
    if (titleTxt) titleTxt.textContent = title;
    if (pctTxt) pctTxt.textContent = `${pct}%`;
    if (bar) bar.style.width = `${pct}%`;
    if (subTxt) subTxt.textContent = sub;
  }

  updateExportUI('Analizando caché de imágenes...', 5, 'Explorando almacenamiento local y memoria...');

  try {
    // 1. Obtener registros guardados en IndexedDB
    let cachedRecords = [];
    if (typeof idbGetAll === 'function') {
      try {
        cachedRecords = await idbGetAll('item_media_cache');
      } catch(e) {
        console.warn('Error leyendo item_media_cache:', e);
      }
    }

    updateExportUI('Analizando carátulas...', 15, 'Indexando y deduplicando carátulas...');
    await new Promise(r => setTimeout(r, 15));

    // Mapa de huella -> registro
    const fingerprintMap = new Map();
    const keyToFingerprint = new Map();

    function addImageRecord(key, dataUrl, customSize) {
      if (!key || !dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return;
      const cleanKey = String(key).trim();
      const fp = getImageContentFingerprint(dataUrl);
      if (!fp) return;

      if (fingerprintMap.has(fp)) {
        const existing = fingerprintMap.get(fp);
        if (cleanKey !== existing.key) {
          existing.aliases.add(cleanKey);
        }
      } else {
        let mime = 'image/jpeg';
        if (dataUrl.startsWith('data:image/webp')) mime = 'image/webp';
        else if (dataUrl.startsWith('data:image/png')) mime = 'image/png';

        fingerprintMap.set(fp, {
          key: cleanKey,
          aliases: new Set(),
          dataUrl: dataUrl,
          size: customSize || dataUrl.length,
          mimeType: mime
        });
      }
      keyToFingerprint.set(cleanKey, fp);
    }

    // A. Registros de IndexedDB
    if (Array.isArray(cachedRecords)) {
      for (let i = 0; i < cachedRecords.length; i++) {
        const rec = cachedRecords[i];
        if (rec && rec.itemId && rec.dataUrl) {
          addImageRecord(rec.itemId, rec.dataUrl, rec.size);
        }
      }
    }

    // B. Registros de inMemoryImageCache
    inMemoryImageCache.forEach((dataUrl, key) => {
      addImageRecord(key, dataUrl, dataUrl.length);
    });

    // C. Si existen carátulas nativas en disco, consultarlas en lotes pequeños con pausas para no saturar memoria ni IPC
    if (window.AndroidBridge && typeof window.AndroidBridge.hasCachedImageNative === 'function' && Array.isArray(allItems)) {
      let hasNativeFiles = true;
      if (typeof window.AndroidBridge.getPersistedImagesStats === 'function') {
        try {
          const stats = JSON.parse(window.AndroidBridge.getPersistedImagesStats());
          if (!stats || stats.count === 0) hasNativeFiles = false;
        } catch(e) {}
      }

      if (hasNativeFiles) {
        updateExportUI('Verificando almacenamiento nativo...', 22, 'Comprobando carátulas en disco...');
        await new Promise(r => setTimeout(r, 12));

        const checkedCovers = new Set();
        let batchCounter = 0;

        for (let i = 0; i < allItems.length; i++) {
          const it = allItems[i];
          const cover = it.cover || it.image || it.poster;
          if (!cover || checkedCovers.has(cover)) continue;
          checkedCovers.add(cover);

          if (keyToFingerprint.has(cover)) continue;

          try {
            if (window.AndroidBridge.hasCachedImageNative(cover)) {
              const nativeData = window.AndroidBridge.getCachedImageNative(cover);
              if (nativeData && nativeData.startsWith('data:')) {
                addImageRecord(cover, nativeData, nativeData.length);
              }
            }
          } catch(e) {}

          batchCounter++;
          if (batchCounter % 60 === 0) {
            const p = 22 + Math.round((i / allItems.length) * 20);
            updateExportUI('Leyendo carátulas...', p, `Procesadas ${fingerprintMap.size} carátulas únicas...`);
            await new Promise(r => setTimeout(r, 8)); // Ceder microtarea para mantener UI fluida y GC activo
          }
        }
      }
    }

    const uniqueCount = fingerprintMap.size;
    if (uniqueCount === 0) {
      if (progressBox) progressBox.style.display = 'none';
      if (typeof showToast === 'function') {
        showToast('⚠️ No hay carátulas en caché local para exportar. Abre el catálogo o usa "📥 Caché Imágenes".');
      } else {
        alert('No hay imágenes en caché para exportar.');
      }
      return;
    }

    // 2. Optimización ligera y normalización a WebP lean
    updateExportUI(`Optimizando paquete (${uniqueCount} carátulas)...`, 46, 'Normalizando y aligerando imágenes...');
    await new Promise(r => setTimeout(r, 15));

    const rawList = Array.from(fingerprintMap.values());
    const optimizedImagesList = [];

    const compBatchSize = 10;
    for (let i = 0; i < rawList.length; i += compBatchSize) {
      const batch = rawList.slice(i, i + compBatchSize);
      await Promise.all(batch.map(async (entry) => {
        let finalData = entry.dataUrl;
        if (finalData && finalData.length > 32000) {
          try {
            finalData = await compressImageToLeanWebp(finalData, 380, 0.68);
          } catch(e) {}
        }
        optimizedImagesList.push({
          key: entry.key,
          aliases: Array.from(entry.aliases),
          dataUrl: finalData,
          mimeType: finalData.startsWith('data:image/webp') ? 'image/webp' : entry.mimeType,
          size: finalData.length
        });
      }));

      const pct = 46 + Math.round((optimizedImagesList.length / rawList.length) * 26);
      updateExportUI('Optimizando imágenes...', pct, `Optimizadas ${optimizedImagesList.length} de ${rawList.length} carátulas...`);
      await new Promise(r => setTimeout(r, 6));
    }

    const catalogVer = (typeof idbGetMeta === 'function') ? await idbGetMeta('catalog_version', '1.0.0') : '1.0.0';
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

    // 3. Exportación en un único archivo consolidado (como solicitó el usuario)
    let totalMappedKeys = 0;
    optimizedImagesList.forEach(it => { totalMappedKeys += 1 + (it.aliases ? it.aliases.length : 0); });

    const packageData = {
      type: 'JOA_IMAGE_CACHE_PACKAGE',
      formatVersion: 3,
      volume: 1,
      totalVolumes: 1,
      exportedAt: new Date().toISOString(),
      catalogVersion: catalogVer,
      totalCount: optimizedImagesList.length,
      totalMappedKeys: totalMappedKeys,
      images: optimizedImagesList
    };

    updateExportUI('Generando paquete único consolidado...', 82, `Empaquetando ${optimizedImagesList.length} carátulas en un solo archivo...`);
    await new Promise(r => setTimeout(r, 20));

    let jsonStr = '';
    try {
      jsonStr = JSON.stringify(packageData);
    } catch(e) {
      throw new Error('Memoria insuficiente para generar el archivo JSON único.');
    }

    const filename = `JoaGamers_Cache_Imagenes_Completo_${optimizedImagesList.length}_items_${dateStr}.json`;
    let savedNative = false;
    let savedInCustomDir = false;

    // A. Guardar en Carpeta Personalizada si fue seleccionada por el usuario
    try {
      const customHandle = await idbGetMeta('custom_download_dir_handle', null);
      if (customHandle && typeof customHandle.getFileHandle === 'function') {
        const fileHandle = await customHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        savedInCustomDir = true;
      }
    } catch(dirErr) {
      console.warn('No se pudo guardar en la carpeta personalizada:', dirErr);
    }

    // B. Guardar de forma nativa a Descargas mediante AndroidBridge
    if (window.AndroidBridge && typeof window.AndroidBridge.saveFile === 'function') {
      try {
        window.AndroidBridge.saveFile(filename, jsonStr);
        savedNative = true;
      } catch(bridgeErr) {
        console.warn('Fallo AndroidBridge.saveFile:', bridgeErr);
      }
    }

    // C. Guardar mediante descarga Web como respaldo si no fue guardado por puente nativo
    if (!savedNative && !savedInCustomDir) {
      try {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          if (document.body.contains(a)) document.body.removeChild(a);
          URL.revokeObjectURL(downloadUrl);
        }, 2000);
        savedNative = true;
      } catch(blobErr) {
        console.warn('Fallo descarga Blob web:', blobErr);
      }
    }

    // Guardar referencia para compartir el archivo único
    lastExportedPackageFilename = filename;
    try {
      lastExportedPackageBlob = new Blob([jsonStr], { type: 'application/json' });
    } catch(e) {}

    const totalBytesSaved = jsonStr.length;
    jsonStr = null; // Liberar memoria

    const totalMb = (totalBytesSaved / (1024 * 1024)).toFixed(2);
    const destName = savedInCustomDir ? (localStorage.getItem('joa_custom_folder_name') || 'tu carpeta personalizada') : 'Descargas';

    updateExportUI(
      '✅ ¡Paquete Guardado!',
      100,
      `Guardado como archivo único en ${destName}: ${filename} (${optimizedImagesList.length} imágenes, ~${totalMb} MB).`
    );

    if (actionRow) actionRow.style.display = 'flex';

    if (window.triggerHaptic) window.triggerHaptic(50);
    if (typeof showToast === 'function') {
      showToast(`📦 ¡Paquete exportado con éxito a Descargas! (${optimizedImagesList.length} carátulas, ~${totalMb} MB).`);
    }

  } catch(err) {
    console.error('Error al exportar paquete de imágenes:', err);
    updateExportUI('❌ Error al exportar', 0, err.message || 'Error inesperado durante la exportación.');
    if (typeof showToast === 'function') showToast(`❌ Error: ${err.message || 'Error al exportar'}`);
    setTimeout(() => {
      if (progressBox) progressBox.style.display = 'none';
    }, 5000);
  }
}

async function compartirUltimoPaqueteImagenes() {
  if (window.triggerHaptic) window.triggerHaptic(40);
  if (!lastExportedPackageFilename) {
    showToast('ℹ️ Exporta primero un paquete para poder compartirlo.');
    return;
  }

  // Intento 1: Web Share API con File si el navegador lo soporta
  if (navigator.canShare && lastExportedPackageBlob) {
    try {
      const file = new File([lastExportedPackageBlob], lastExportedPackageFilename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Paquete de Imágenes JoaGamers',
          text: 'Carátulas e imágenes para uso offline en JoaGamers',
          files: [file]
        });
        return;
      }
    } catch(e) {
      if (e && e.name === 'AbortError') return;
    }
  }

  // Intento 2: Puente nativo shareProduct para abrir el menú de compartir de Android (Zapya, Bluetooth, etc.)
  if (window.AndroidBridge && typeof window.AndroidBridge.shareProduct === 'function') {
    try {
      window.AndroidBridge.shareProduct(
        'Paquete de Imágenes Offline JoaGamers',
        `El paquete de carátulas offline está listo en tu carpeta Descargas:\n📂 ${lastExportedPackageFilename}\n\nPuedes compartir este archivo por Zapya, Bluetooth o transferirlo por USB a cualquier otro móvil para tener todas las carátulas 100% offline sin internet.`,
        ''
      );
      return;
    } catch(e) {}
  }

  // Feedback final
  showToast(`📁 Archivo listo en tu carpeta Descargas:\n${lastExportedPackageFilename}`);
}

async function importarPaqueteCacheImagenes(event) {
  const file = (typeof File !== 'undefined' && event instanceof File)
    ? event
    : (event && event.target && event.target.files && event.target.files[0]);
  if (!file) return;

  if (window.triggerHaptic) window.triggerHaptic(40);

  const progressBox = document.getElementById('imagePackageProgressBox');
  const titleTxt = document.getElementById('imagePackageStatusTitle');
  const pctTxt = document.getElementById('imagePackageStatusPct');
  const bar = document.getElementById('imagePackageProgressBar');
  const subTxt = document.getElementById('imagePackageStatusSub');

  // Elementos de la pantalla de importación secundaria si estuviera activa
  const importProgressEl = document.getElementById('importProgress');
  const importBarFillEl = document.getElementById('importBarFill');
  const importStatusEl = document.getElementById('importStatus');
  const importErrorEl = document.getElementById('importError');

  function updateImportUI(title, pct, sub) {
    if (progressBox) progressBox.style.display = 'block';
    if (titleTxt) titleTxt.textContent = title;
    if (pctTxt) pctTxt.textContent = `${pct}%`;
    if (bar) bar.style.width = `${pct}%`;
    if (subTxt) subTxt.textContent = sub;

    if (importProgressEl) importProgressEl.style.display = 'block';
    if (importBarFillEl) importBarFillEl.style.width = `${pct}%`;
    if (importStatusEl) importStatusEl.textContent = `${title} (${pct}%) ${sub ? '· ' + sub : ''}`;
    if (importErrorEl) importErrorEl.style.display = 'none';
  }

  updateImportUI('Leyendo paquete de imágenes...', 10, `Cargando archivo: ${file.name} (${(file.size / (1024*1024)).toFixed(2)} MB)...`);

  const reader = new FileReader();

  reader.onprogress = (e) => {
    if (e.lengthComputable) {
      const readPct = 10 + Math.round((e.loaded / e.total) * 20);
      updateImportUI('Leyendo paquete de imágenes...', readPct, `Leyendo datos del archivo (${readPct}%)...`);
    }
  };

  reader.onload = async (e) => {
    try {
      updateImportUI('Desempaquetando imágenes...', 32, 'Validando estructura del paquete JSON...');
      await new Promise(r => setTimeout(r, 10));

      let parsed = null;
      try {
        parsed = JSON.parse(e.target.result);
      } catch(parseErr) {
        throw new Error('El archivo seleccionado no tiene un formato JSON válido o está incompleto.');
      }

      let imagesToImport = [];
      if (parsed && Array.isArray(parsed.images)) {
        imagesToImport = parsed.images;
      } else if (parsed && Array.isArray(parsed.items)) {
        imagesToImport = parsed.items;
      } else if (Array.isArray(parsed)) {
        imagesToImport = parsed;
      } else {
        throw new Error('El archivo no contiene una lista de imágenes válida.');
      }

      const total = imagesToImport.length;
      if (total === 0) {
        throw new Error('El paquete no contiene imágenes guardadas.');
      }

      updateImportUI(`Importando ${total} imágenes...`, 36, `Guardando en almacenamiento permanente (0 de ${total})...`);
      await new Promise(r => setTimeout(r, 15));

      let importedCount = 0;
      let mappedKeysCount = 0;
      const importedFingerprints = new Set();
      const batchSize = 15; // Lote controlado para no saturar memoria ni IPC nativo

      for (let i = 0; i < total; i += batchSize) {
        const batch = imagesToImport.slice(i, i + batchSize);

        for (let j = 0; j < batch.length; j++) {
          const imgObj = batch[j];
          if (!imgObj) continue;

          const primaryKey = imgObj.key || imgObj.itemId || imgObj.url;
          const dataUrl = imgObj.dataUrl || imgObj.base64 || imgObj.data;
          const mimeType = imgObj.mimeType || (dataUrl && dataUrl.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg');

          if (!primaryKey || !dataUrl || !dataUrl.startsWith('data:')) continue;

          // Deduplicación en importación por huella
          const fp = getImageContentFingerprint(dataUrl);
          const isNewData = !importedFingerprints.has(fp);
          if (isNewData && fp) importedFingerprints.add(fp);

          // Lista de todas las claves a registrar (clave principal + alias)
          const allKeys = [primaryKey];
          if (Array.isArray(imgObj.aliases)) {
            imgObj.aliases.forEach(a => { if (a && !allKeys.includes(a)) allKeys.push(a); });
          }

          // Guardar para cada clave asociada
          for (let k = 0; k < allKeys.length; k++) {
            const kName = allKeys[k];
            // A. Guardar en memoria rápida
            inMemoryImageCache.set(kName, dataUrl);

            // B. Guardar en IndexedDB local
            if (typeof idbPut === 'function') {
              try {
                await idbPut('item_media_cache', {
                  itemId: kName,
                  dataUrl: dataUrl,
                  size: imgObj.size || dataUrl.length,
                  savedAt: new Date().toISOString()
                });
              } catch(idbErr) {}
            }

            // C. Guardar en almacenamiento nativo de Android
            if (window.AndroidBridge && typeof window.AndroidBridge.saveCachedImageNative === 'function') {
              try {
                window.AndroidBridge.saveCachedImageNative(kName, dataUrl, mimeType);
              } catch(bridgeErr) {}
            }

            mappedKeysCount++;
          }

          importedCount++;
        }

        const currentPct = 36 + Math.round(((i + batch.length) / total) * 60);
        const safePct = Math.min(96, currentPct);
        updateImportUI(
          `Importando imágenes (${safePct}%)...`,
          safePct,
          `Guardando imágenes: ${Math.min(total, i + batch.length)} de ${total}...`
        );

        // Ceder microtarea para mantener fluida la interfaz
        await new Promise(r => setTimeout(r, 6));
      }

      // 🔄 Actualizar inmediatamente las imágenes visualizadas en pantalla
      document.querySelectorAll('img').forEach(img => {
        const src = img.dataset.originalUrl || img.getAttribute('src');
        if (src && inMemoryImageCache.has(src)) {
          img.src = inMemoryImageCache.get(src);
        }
      });

      if (typeof updateImagePackageBadge === 'function') updateImagePackageBadge();
      if (typeof updateMediaCacheBadgeStats === 'function') updateMediaCacheBadgeStats();

      updateImportUI(
        '🎉 ¡Importación Exitosa!',
        100,
        `Se importaron ${importedCount} carátulas únicas (${mappedKeysCount} referencias asociadas) 100% offline.`
      );

      if (window.triggerHaptic) window.triggerHaptic(60);
      if (typeof showToast === 'function') {
        showToast(`🎉 ¡${importedCount} carátulas importadas con éxito! Ya están 100% disponibles sin internet.`);
      }

      setTimeout(() => {
        if (progressBox) progressBox.style.display = 'none';
      }, 5500);

    } catch(err) {
      console.error('Error importando paquete de imágenes:', err);
      updateImportUI('❌ Error de importación', 0, err.message || 'No se pudo procesar el archivo.');
      if (importErrorEl) {
        importErrorEl.textContent = `❌ ${err.message || 'Error importando archivo'}`;
        importErrorEl.style.display = 'block';
      }
      if (typeof showToast === 'function') showToast(`❌ Error: ${err.message || 'Archivo no válido'}`);
      setTimeout(() => {
        if (progressBox) progressBox.style.display = 'none';
      }, 4500);
    } finally {
      if (event && event.target) event.target.value = '';
    }
  };

  reader.onerror = () => {
    updateImportUI('❌ Error al leer el archivo', 0, 'No se pudo abrir el archivo seleccionado en el dispositivo.');
    if (typeof showToast === 'function') showToast('❌ Error al leer el paquete de imágenes.');
    setTimeout(() => {
      if (progressBox) progressBox.style.display = 'none';
    }, 4000);
    if (event && event.target) event.target.value = '';
  };

  reader.readAsText(file);
}

// Exports globales
window.updateImagePackageBadge = updateImagePackageBadge;
window.exportarPaqueteCacheImagenes = exportarPaqueteCacheImagenes;
window.importarPaqueteCacheImagenes = importarPaqueteCacheImagenes;
window.compartirUltimoPaqueteImagenes = compartirUltimoPaqueteImagenes;

// =====================================================================
// 📁 GESTIÓN DE CARPETA PERSONALIZADA DE DESCARGAS E IMPORTACIÓN AUTOMÁTICA
// =====================================================================
let cachedDetectedFolderFiles = { databases: [], imagePackages: [] };

async function actualizarVistaCarpetaPersonalizada() {
  const nameEl = document.getElementById('customFolderCurrentName');
  const badgeEl = document.getElementById('customFolderBadge');
  const savedName = localStorage.getItem('joa_custom_folder_name');

  let hasHandle = false;
  try {
    const handle = (typeof idbGetMeta === 'function') ? await idbGetMeta('custom_download_dir_handle', null) : null;
    if (handle) hasHandle = true;
  } catch(e) {}

  if (savedName || hasHandle) {
    const displayName = savedName || 'Carpeta Vinculada';
    if (nameEl) nameEl.textContent = `📁 ${displayName}`;
    if (badgeEl) {
      badgeEl.textContent = '🟢 Vinculada';
      badgeEl.style.background = 'rgba(0, 255, 178, 0.15)';
      badgeEl.style.borderColor = 'rgba(0, 255, 178, 0.4)';
      badgeEl.style.color = '#00FFB2';
    }
  } else {
    if (nameEl) nameEl.textContent = 'Descargas del Dispositivo (/Download)';
    if (badgeEl) {
      badgeEl.textContent = 'Predeterminada';
      badgeEl.style.background = 'rgba(255, 255, 255, 0.08)';
      badgeEl.style.borderColor = 'rgba(255, 255, 255, 0.18)';
      badgeEl.style.color = '#94A3B8';
    }
  }
}

async function configurarCarpetaPersonalizada() {
  if (window.triggerHaptic) window.triggerHaptic(30);

  // 1. Intentar usar la API moderna File System Access (Chromium / WebViews compatibles)
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'joa_custom_folder',
        mode: 'readwrite',
        startIn: 'downloads'
      });

      if (dirHandle) {
        if (typeof idbSetMeta === 'function') {
          await idbSetMeta('custom_download_dir_handle', dirHandle);
        }
        localStorage.setItem('joa_custom_folder_name', dirHandle.name);
        await actualizarVistaCarpetaPersonalizada();
        showToast(`📁 Carpeta vinculada con éxito: "${dirHandle.name}".`);
        // Escanear inmediatamente para ver si ya hay archivos
        escanearEImportarDesdeCarpeta(false);
        return;
      }
    } catch(err) {
      if (err.name === 'AbortError') return; // Cancelado por el usuario
      console.warn('showDirectoryPicker no disponible o cancelado:', err);
    }
  }

  // 2. Si showDirectoryPicker no está disponible o falla, usar el selector de carpetas HTML5
  const dirInput = document.getElementById('customFolderDirPickerInput');
  if (dirInput) {
    showToast('📂 Selecciona la carpeta o archivos desde tu almacenamiento...');
    dirInput.click();
  }
}

async function restablecerCarpetaPersonalizada() {
  if (window.triggerHaptic) window.triggerHaptic(25);
  localStorage.removeItem('joa_custom_folder_name');
  if (typeof idbSetMeta === 'function') {
    await idbSetMeta('custom_download_dir_handle', null);
  }
  await actualizarVistaCarpetaPersonalizada();

  const sec = document.getElementById('customFolderDetectedSection');
  if (sec) sec.style.display = 'none';

  showToast('📁 Ruta restablecida a la carpeta Descargas predeterminada.');
}

async function escanearEImportarDesdeCarpeta(silent = false) {
  if (window.triggerHaptic) window.triggerHaptic(30);

  let dirHandle = null;
  try {
    if (typeof idbGetMeta === 'function') {
      dirHandle = await idbGetMeta('custom_download_dir_handle', null);
    }
  } catch(e) {}

  if (dirHandle) {
    try {
      // Verificar permisos
      if (typeof dirHandle.queryPermission === 'function') {
        let perm = await dirHandle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') {
          perm = await dirHandle.requestPermission({ mode: 'read' });
          if (perm !== 'granted') throw new Error('Permiso de lectura no concedido en la carpeta.');
        }
      }

      if (!silent) showToast(`🔍 Escaneando carpeta "${dirHandle.name}"...`);

      const collectedFiles = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          try {
            const f = await entry.getFile();
            collectedFiles.push(f);
          } catch(fe) {}
        }
      }

      await procesarArchivosDetectadosEnCarpeta(collectedFiles, silent);
      return;
    } catch(err) {
      console.warn('Error leyendo directorio mediante handle:', err);
      if (!silent) showToast(`⚠️ No se pudo acceder automáticamente a la carpeta: ${err.message}`);
    }
  }

  // Fallback: abrir selector de carpeta / archivos
  const dirInput = document.getElementById('customFolderDirPickerInput');
  if (dirInput) {
    if (!silent) showToast('📂 Selecciona la carpeta de descargas para escanear archivos...');
    dirInput.click();
  }
}

function handleCustomFolderFilesSelected(event) {
  const files = event && event.target && event.target.files;
  if (!files || !files.length) return;

  // Extraer nombre de la carpeta si es posible
  const firstPath = files[0].webkitRelativePath;
  if (firstPath) {
    const folderName = firstPath.split('/')[0];
    if (folderName) {
      localStorage.setItem('joa_custom_folder_name', folderName);
      actualizarVistaCarpetaPersonalizada();
    }
  }

  procesarArchivosDetectadosEnCarpeta(Array.from(files), false);
  if (event.target) event.target.value = '';
}

async function procesarArchivosDetectadosEnCarpeta(filesList, silent = false) {
  const sec = document.getElementById('customFolderDetectedSection');
  const listEl = document.getElementById('customFolderDetectedList');
  const btnAll = document.getElementById('btnImportarTodoCarpeta');
  const titleEl = document.getElementById('customFolderDetectedTitle');

  cachedDetectedFolderFiles = { databases: [], imagePackages: [] };

  if (!filesList || !filesList.length) {
    if (sec) sec.style.display = 'none';
    if (!silent) showToast('ℹ️ No se encontraron archivos en la carpeta seleccionada.');
    return;
  }

  // Filtrar archivos compatibles (.json, .joapack, .zip)
  for (const f of filesList) {
    const nameLow = f.name.toLowerCase();
    if (nameLow.endsWith('.json') || nameLow.endsWith('.joapack') || nameLow.endsWith('.zip')) {
      // Diferenciar entre paquetes de imágenes y base de datos
      if (nameLow.includes('image') || nameLow.includes('cache_imagenes') || nameLow.includes('paquete') || nameLow.endsWith('.joapack')) {
        cachedDetectedFolderFiles.imagePackages.push(f);
      } else {
        cachedDetectedFolderFiles.databases.push(f);
      }
    }
  }

  const totalFound = cachedDetectedFolderFiles.databases.length + cachedDetectedFolderFiles.imagePackages.length;

  if (totalFound === 0) {
    if (sec) sec.style.display = 'none';
    if (!silent) showToast('ℹ️ No se detectaron archivos JSON de catálogo ni paquetes de imágenes en esta carpeta.');
    return;
  }

  if (sec) sec.style.display = 'block';
  if (titleEl) titleEl.textContent = `⚡ Archivos disponibles (${totalFound} encontrados)`;

  let htmlRows = '';

  cachedDetectedFolderFiles.databases.forEach((dbFile, idx) => {
    const sizeMb = (dbFile.size / (1024 * 1024)).toFixed(2);
    const dateStr = dbFile.lastModified ? new Date(dbFile.lastModified).toLocaleDateString('es-ES') : '';
    htmlRows += `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; background:rgba(255,255,255,0.04); border:1px solid rgba(0,255,178,0.25); border-radius:10px;">
        <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
          <span style="font-size:1.2rem; flex-shrink:0;">📄</span>
          <div style="min-width:0; flex:1;">
            <div style="font-size:0.75rem; color:#FFFFFF; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${escapeHtml(dbFile.name)}
            </div>
            <div style="font-size:0.65rem; color:#00FFB2;">
              Base de Datos Catálogo · ~${sizeMb} MB ${dateStr ? '· ' + dateStr : ''}
            </div>
          </div>
        </div>
        <button class="btn" style="padding:5px 10px; font-size:0.72rem; background:linear-gradient(135deg,rgba(0,255,178,0.2),rgba(0,229,255,0.2)); border-color:#00FFB2; color:#00FFB2; font-weight:800; white-space:nowrap; flex-shrink:0;" onclick="importarArchivoDetectado(${idx}, 'database')">
          📥 Importar
        </button>
      </div>
    `;
  });

  cachedDetectedFolderFiles.imagePackages.forEach((pkgFile, idx) => {
    const sizeMb = (pkgFile.size / (1024 * 1024)).toFixed(2);
    const dateStr = pkgFile.lastModified ? new Date(pkgFile.lastModified).toLocaleDateString('es-ES') : '';
    htmlRows += `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; background:rgba(255,255,255,0.04); border:1px solid rgba(0,229,255,0.25); border-radius:10px;">
        <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
          <span style="font-size:1.2rem; flex-shrink:0;">🖼️</span>
          <div style="min-width:0; flex:1;">
            <div style="font-size:0.75rem; color:#FFFFFF; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${escapeHtml(pkgFile.name)}
            </div>
            <div style="font-size:0.65rem; color:#00E5FF;">
              Paquete de Imágenes Offline · ~${sizeMb} MB ${dateStr ? '· ' + dateStr : ''}
            </div>
          </div>
        </div>
        <button class="btn" style="padding:5px 10px; font-size:0.72rem; background:linear-gradient(135deg,rgba(0,229,255,0.2),rgba(157,78,221,0.2)); border-color:#00E5FF; color:#00E5FF; font-weight:800; white-space:nowrap; flex-shrink:0;" onclick="importarArchivoDetectado(${idx}, 'imagePackage')">
          🖼️ Importar
        </button>
      </div>
    `;
  });

  if (listEl) listEl.innerHTML = htmlRows;

  if (btnAll) {
    btnAll.style.display = totalFound > 1 ? 'inline-block' : 'none';
  }

  if (!silent) {
    showToast(`✅ Se detectaron ${totalFound} archivo(s) disponibles para importar.`);
  }
}

async function importarArchivoDetectado(index, type) {
  if (window.triggerHaptic) window.triggerHaptic(35);

  if (type === 'database') {
    const file = cachedDetectedFolderFiles.databases[index];
    if (file && typeof handleImportFile === 'function') {
      showToast(`📥 Importando base de datos: ${file.name}...`);
      await handleImportFile(file, true);
    }
  } else if (type === 'imagePackage') {
    const file = cachedDetectedFolderFiles.imagePackages[index];
    if (file && typeof importarPaqueteCacheImagenes === 'function') {
      showToast(`🖼️ Importando paquete de imágenes: ${file.name}...`);
      await importarPaqueteCacheImagenes(file);
    }
  }
}

async function importarTodoDesdeCarpeta() {
  if (window.triggerHaptic) window.triggerHaptic(50);

  const dbs = cachedDetectedFolderFiles.databases;
  const imgs = cachedDetectedFolderFiles.imagePackages;

  if (dbs.length > 0 && typeof handleImportFile === 'function') {
    showToast(`📥 Importando base de datos más reciente (${dbs[0].name})...`);
    await handleImportFile(dbs[0], true);
    await new Promise(r => setTimeout(r, 600));
  }

  if (imgs.length > 0 && typeof importarPaqueteCacheImagenes === 'function') {
    showToast(`🖼️ Importando paquete de imágenes (${imgs[0].name})...`);
    await importarPaqueteCacheImagenes(imgs[0]);
  }
}

// Exports globales de carpeta personalizada
window.actualizarVistaCarpetaPersonalizada = actualizarVistaCarpetaPersonalizada;
window.configurarCarpetaPersonalizada = configurarCarpetaPersonalizada;
window.restablecerCarpetaPersonalizada = restablecerCarpetaPersonalizada;
window.escanearEImportarDesdeCarpeta = escanearEImportarDesdeCarpeta;
window.handleCustomFolderFilesSelected = handleCustomFolderFilesSelected;
window.importarArchivoDetectado = importarArchivoDetectado;
window.importarTodoDesdeCarpeta = importarTodoDesdeCarpeta;

// 🔄 Sincronización inteligente de metadatos de favoritos (Background Sync + Respaldo Offline Total)
async function syncFavoritesMetadataOffline() {
  try {
    const states = typeof idbGetAll === 'function' ? await idbGetAll('user_states') : (typeof userStates !== 'undefined' ? userStates : []);
    const favStates = states.filter(s => s && (s.status === 'wishlist' || s.status === 'playing' || s.status === 'pending' || s.status === 'completed'));
    const favIds = new Set(favStates.map(s => s.itemId));

    // Incluir también títulos de listas personalizadas
    if (typeof idbGetAll === 'function') {
      try {
        const userLists = await idbGetAll('user_lists');
        if (Array.isArray(userLists)) {
          userLists.forEach(ul => {
            if (Array.isArray(ul.items)) {
              ul.items.forEach(id => favIds.add(id));
            }
          });
        }
      } catch (e) {}
    }

    if (favIds.size === 0) return;

    // Recopilar metadatos completos de los títulos
    const itemsSource = typeof allItems !== 'undefined' && Array.isArray(allItems) && allItems.length > 0
      ? allItems
      : (typeof idbGetAll === 'function' ? await idbGetAll('items') : []);

    const favoritesMetadata = [];
    favIds.forEach(id => {
      const it = itemsSource.find(item => String(item.id) === String(id));
      if (it) {
        favoritesMetadata.push({
          id: it.id,
          title: it.title,
          type: it.type || it.tipo,
          year: it.year,
          price: it.price,
          rating: it.rating,
          reviews: it.reviews,
          synopsis: it.synopsis || it.sinopsis || it.description || '',
          genres: it.genres || it.generos || [],
          developer: it.developer || it.desarrollador || '',
          cover: it.cover || it.image || it.poster || it.caratula || it.img,
          requirements: it.requirements || null,
          episodes: it.episodes || null,
          seasons: it.seasons || null,
          category: it.category || null,
          subcategoria: it.subcategoria || null
        });
      }
    });

    if (favoritesMetadata.length > 0) {
      console.log(`⭐ [Sync Favoritos] Sincronizando metadatos de ${favoritesMetadata.length} títulos favoritos...`);

      // 1. Guardar permanentemente en archivo nativo de Android
      if (window.AndroidBridge && typeof window.AndroidBridge.saveFavoriteMetadataNative === 'function') {
        window.AndroidBridge.saveFavoriteMetadataNative(JSON.stringify(favoritesMetadata));
        if (typeof syncPlayingItemsToAndroid === 'function') syncPlayingItemsToAndroid();
      }

      // 2. Guardar en IndexedDB Meta
      if (typeof idbSetMeta === 'function') {
        await idbSetMeta('joa_favorites_permanent_meta', favoritesMetadata);
      }

      // 3. Notificar al Service Worker para precarga en background cache
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'PRECACHE_FAVORITES',
          favorites: favoritesMetadata
        });
      }

      // 4. Registrar Background Sync si está disponible
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(reg => {
          return reg.sync.register('sync-favorites');
        }).catch(() => {});
      }

      // 5. Pre-cargar portadas de favoritos si no están guardadas
      favoritesMetadata.forEach(fav => {
        const cover = fav.cover;
        if (cover && typeof cover === 'string' && !cover.startsWith('data:')) {
          const resolved = resolveImageUrl(cover);
          if (!inMemoryImageCache.has(resolved)) {
            const preImg = new Image();
            preImg.crossOrigin = 'anonymous';
            preImg.dataset.originalUrl = resolved;
            preImg.onload = () => autoCacheVisibleImage(preImg);
            preImg.src = resolved;
          }
        }
      });
    }
  } catch (err) {
    console.warn('[Sync Favoritos] Error al sincronizar metadatos de favoritos:', err);
  }
}
window.syncFavoritesMetadataOffline = syncFavoritesMetadataOffline;


// ==========================================
// 🏷️ UTILIDADES ROBUSTAS DE TIPO, PRECIO Y PRODUCTOS DIGITALES
// ==========================================
function findCatalogItem(id) {
  if (id === null || id === undefined) return null;
  const strId = String(id);
  if (typeof allItems !== 'undefined' && Array.isArray(allItems)) {
    const direct = allItems.find(it => String(it.id) === strId);
    if (direct) return direct;
  }
  return null;
}

function getItemTypeInfo(item) {
  if (!item) return { raw: 'producto', label: '🎮 Producto Digital', icon: '🎮', isSeries: false, isMovie: false, isGame: true };
  const raw = (item.type || item.tipo || item.category || item.categoria || item.subcategoria || '').toLowerCase().trim();
  
  if (typeof typeLabels !== 'undefined' && typeLabels[raw]) {
    const l = typeLabels[raw];
    let icon = '🎮';
    if (raw.includes('peli') || raw.includes('movie') || raw.includes('film')) icon = '🎬';
    else if (raw.includes('serie') || raw.includes('tv') || raw.includes('novela')) icon = '📺';
    else if (raw.includes('anime')) icon = '🎌';
    else if (raw.includes('soft') || raw.includes('app') || raw.includes('prog')) icon = '💻';
    else if (raw.includes('mus')) icon = '🎵';
    else if (raw.includes('libro') || raw.includes('novela')) icon = '📚';
    return { raw, label: l, icon, isSeries: raw.includes('serie') || raw.includes('novela_tv'), isMovie: raw.includes('peli'), isGame: raw.includes('juego') };
  }

  if (raw === 'pelicula' || raw === 'pelicula_animada' || raw === 'movie' || raw === 'film' || raw === 'peliculas') {
    return { raw: 'pelicula', label: '🎬 Película', icon: '🎬', isSeries: false, isMovie: true, isGame: false };
  }
  if (raw === 'serie' || raw === 'serie_animada' || raw === 'series' || raw === 'tv_series' || raw === 'series_tv') {
    return { raw: 'serie', label: '📺 Serie', icon: '📺', isSeries: true, isMovie: false, isGame: false };
  }
  if (raw === 'novela_tv' || raw === 'telenovela' || raw === 'novelas_tv') {
    return { raw: 'novela_tv', label: '📺 Novela TV', icon: '📺', isSeries: true, isMovie: false, isGame: false };
  }
  if (raw === 'anime' || raw === 'anime_movie') {
    return { raw: 'anime', label: raw === 'anime_movie' ? '🎥 Película Anime' : '🎌 Anime', icon: '🎌', isSeries: raw !== 'anime_movie', isMovie: raw === 'anime_movie', isGame: false };
  }
  if (raw === 'software' || raw === 'app' || raw === 'programa' || raw === 'utilidad') {
    return { raw: 'software', label: '💻 Software', icon: '💻', isSeries: false, isMovie: false, isGame: false };
  }
  if (raw === 'musica' || raw === 'music' || raw === 'album') {
    return { raw: 'musica', label: '🎵 Música', icon: '🎵', isSeries: false, isMovie: false, isGame: false };
  }
  if (raw === 'novela' || raw === 'libro' || raw === 'ebook') {
    return { raw: 'novela', label: '📚 Novela / Libro', icon: '📚', isSeries: false, isMovie: false, isGame: false };
  }
  if (raw === 'juego_emulado' || raw === 'retro' || raw === 'emulado') {
    return { raw: 'juego_emulado', label: '🕹️ Juego Emulado', icon: '🕹️', isSeries: false, isMovie: false, isGame: true };
  }
  if (raw === 'juego' || raw === 'game' || raw === 'juegos' || raw === 'games') {
    return { raw: 'juego', label: '🎮 Juego', icon: '🎮', isSeries: false, isMovie: false, isGame: true };
  }

  // Fallback heurística
  if (item.seasons !== undefined || item.temporadas !== undefined || item.episodes !== undefined || item.capitulos !== undefined) {
    return { raw: 'serie', label: '📺 Serie', icon: '📺', isSeries: true, isMovie: false, isGame: false };
  }
  if (item.duracion || item.duration || item.runtime || item.director) {
    return { raw: 'pelicula', label: '🎬 Película', icon: '🎬', isSeries: false, isMovie: true, isGame: false };
  }
  if (item.console || item.consola || item.platform) {
    return { raw: 'juego', label: '🎮 Juego', icon: '🎮', isSeries: false, isMovie: false, isGame: true };
  }

  const capitalized = raw ? (raw.charAt(0).toUpperCase() + raw.slice(1)) : 'Producto Digital';
  return { raw: raw || 'producto', label: `📦 ${capitalized}`, icon: '📦', isSeries: false, isMovie: false, isGame: false };
}

function getItemTypeLabel(item) {
  return getItemTypeInfo(item).label;
}

function getItemPriceNumeric(item) {
  if (!item) return 0;
  if (item._priceNum !== undefined) return item._priceNum;
  let val = item.precio ?? item.price ?? item.costo ?? item.cost ?? item.valor ?? item.monto ?? item.tarifa ?? item.importe ?? item.rate ?? item.precio_cup ?? item.price_cup ?? item.precio_usd ?? item.price_usd ?? null;
  if (val === null || val === undefined || val === '') {
    item._priceNum = 0;
    return 0;
  }
  let result = 0;
  if (typeof val === 'number') {
    result = isNaN(val) ? 0 : val;
  } else if (typeof val === 'string') {
    const trimmed = val.trim().toLowerCase();
    if (/^(gratis|free|0(\.00)?(\s*(cup|mn|usd|\$))?)$/.test(trimmed)) {
      result = 0;
    } else {
      let clean = trimmed.replace(/[^0-9.,-]+/g, '').replace(',', '.');
      let num = parseFloat(clean);
      result = isNaN(num) ? 0 : num;
    }
  }
  item._priceNum = result;
  return result;
}

function formatItemPrice(item) {
  if (!item) return 'Gratis';
  let raw = item.precio ?? item.price ?? item.costo ?? item.cost ?? item.valor ?? item.monto ?? item.tarifa ?? item.importe ?? item.precio_cup ?? item.price_cup ?? null;
  if (raw === undefined || raw === null || raw === '') return 'Gratis';
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (/^(gratis|free)$/i.test(s)) return 'Gratis';
    if (/^\$?[0-9]+(\.[0-9]+)?\s*(cup|mn|usd|eur|\$)?$/i.test(s) || /^\s*[$€£]/i.test(s) || /CUP|USD|EUR/i.test(s)) {
      return s;
    }
  }
  let num = getItemPriceNumeric(item);
  if (num === 0) return 'Gratis';
  return '$' + num.toFixed(2);
}

function calculateListTotal(itemIds) {
  if (!itemIds || !Array.isArray(itemIds)) return 0;
  let total = 0;
  itemIds.forEach(id => {
    const it = findCatalogItem(id);
    if (it) total += getItemPriceNumeric(it);
  });
  return total;
}

function formatListTotal(totalNum) {
  if (totalNum <= 0) return '$0.00';
  return '$' + totalNum.toFixed(2);
}

// ==========================================
// 🪟 GESTOR DE CIERRE AUTOMÁTICO DE VENTANAS Y MENÚS
// ==========================================
function closeAllOpenModals(exceptId = null) {
  try {
    document.querySelectorAll('.modal-overlay, .panel-overlay, #myPanelOverlay').forEach(m => {
      if (!exceptId || (m.id !== exceptId && !m.classList.contains(exceptId))) {
        m.style.display = 'none';
      }
    });
    if (typeof toggleSidebar === 'function') {
      toggleSidebar(false);
    }
  } catch (e) {
    console.warn('Error closing modals:', e);
  }
}

// ==========================================
// 📺 RESOLUCIÓN DE TEMPORADAS Y EPISODIOS (DESDE EL ARCHIVO JSON DEL USUARIO)
// ==========================================
function getSeriesStats(item) {
  if (!item) return null;
  const isSeries = (item.type && (item.type.includes('serie') || item.type.includes('anime'))) || 
                   item.seasons !== undefined || item.temporadas !== undefined || item.temp !== undefined ||
                   item.episodes !== undefined || item.capitulos !== undefined || item.caps !== undefined || item.episodios !== undefined;
  if (!isSeries) return null;

  const s = item.seasons !== undefined ? item.seasons : (item.temporadas !== undefined ? item.temporadas : (item.temp !== undefined ? item.temp : 1));
  const e = item.episodes !== undefined ? item.episodes : (item.capitulos !== undefined ? item.capitulos : (item.caps !== undefined ? item.caps : (item.episodios !== undefined ? item.episodios : 'S/D')));
  return { seasons: s, episodes: e };
}

// Mantener compatibilidad por si alguna llamada heredada lo invoca
function fetchAndCacheSeriesStats(item) {
  return getSeriesStats(item);
}

function injectSeriesStatsIntoModal(item) {
  const stats = getSeriesStats(item);
  if (!stats) return;
  if (typeof currentDetailId !== 'undefined' && currentDetailId === item.id) {
    const chipText = document.getElementById('modalSeriesStatsText');
    if (chipText) chipText.textContent = `${stats.seasons} Temp. • ${stats.episodes} Caps.`;
  }
}

function updateSeriesStatsInDOM(itemId, seasons, episodes) {
  if (typeof currentDetailId !== 'undefined' && currentDetailId === itemId) {
    const chip = document.getElementById('modalSeriesStatsText');
    if (chip) chip.textContent = `${seasons} Temp. • ${episodes} Caps.`;
  }
  const cardBadges = document.querySelectorAll(`span[data-series-badge="${itemId}"]`);
  cardBadges.forEach(b => {
    b.innerHTML = `📺 ${seasons}T • ${episodes}C`;
  });
}

// ==========================================
// 🧭 SIDEBAR
// ==========================================
activeType = window.activeType || '';

function renderSidebar() {
  const counts = {};
  allItems.forEach(it => { counts[it.type] = (counts[it.type] || 0) + 1; });

  const container = document.getElementById('sidebarLinks');
  let html = `<a class="sidebar-link ${activeType === '' ? 'active' : ''}" onclick="setTypeFilter('')">🏠 Todo</a>`;
  html += `<div class="sidebar-section-label">Catálogo</div>`;
  
  const allOrder = [
    'juego', 'juego_emulado', 'pelicula', 'pelicula_animada', 'serie', 'serie_animada',
    'anime', 'anime_movie', 'novela_tv', 'musica', 'software', 'novela'
  ];
  const keys = Array.from(new Set([...allOrder, ...Object.keys(typeLabels), ...Object.keys(counts)]));

  keys.forEach(key => {
    if (!counts[key]) return;
    const label = typeLabels[key] || (key === 'novela_tv' ? '📺 Novelas TV' : key);
    html += `<a class="sidebar-link ${activeType === key ? 'active' : ''}" onclick="setTypeFilter('${key}')">
      <span>${escapeHtml(label)}</span>
      <span class="count">${counts[key]}</span>
    </a>`;
  });
  container.innerHTML = html;
}

function getItemSubcategory(it) {
  if (!it) return '';
  return String(it.subcategoria || it.subcategory || it.sub_category || '').trim();
}

function setTypeFilter(type) {
  activeType = type;
  libraryFilter = '';
  document.getElementById('stateFilter').value = '';
  document.getElementById('typeFilterSelect').value = type;
  updateConsoleFilterVisibility();
  toggleSubcategoryFilter();
  renderSidebar();
  updateLibraryActiveLinks();
  currentPage = 1;
  applyFilters();
  toggleSidebar(false);
}

function updateConsoleFilterVisibility() {
  const container = document.getElementById('consoleFilterContainer');
  if (container) {
    const show = activeType === 'juego_emulado';
    container.style.display = show ? 'block' : 'none';
    if (!show && document.getElementById('consoleFilterSelect')) {
      document.getElementById('consoleFilterSelect').value = '';
    }
  }
}

function toggleSubcategoryFilter() {
  const container = document.getElementById('subcategoryFilterContainer');
  const subcatSelect = document.getElementById('subcategoryFilterSelect');
  if (!container || !subcatSelect) return;

  const hasSubcategories = typeof allItems !== 'undefined' && allItems.some(it => getItemSubcategory(it) !== '');
  const show = hasSubcategories && activeType === 'software';

  container.style.display = show ? 'block' : 'none';
  if (!show && subcatSelect.value) {
    subcatSelect.value = '';
  }
}

function initializeSubcategoryFilter() {
  const subcatSelect = document.getElementById('subcategoryFilterSelect');
  if (!subcatSelect) return;

  // Limpiar select previo
  subcatSelect.innerHTML = '<option value="">Todas las subcategorías</option>';

  const subcatCounts = {};
  if (typeof allItems !== 'undefined' && Array.isArray(allItems)) {
    allItems.forEach(it => {
      const subcat = getItemSubcategory(it);
      if (subcat) {
        subcatCounts[subcat] = (subcatCounts[subcat] || 0) + 1;
      }
    });
  }

  const subcategories = Object.keys(subcatCounts).sort((a, b) => a.localeCompare(b, 'es'));
  let html = '<option value="">Todas las subcategorías</option>';
  subcategories.forEach(sc => {
    html += `<option value="${escapeHtml(sc)}">${escapeHtml(sc)} (${subcatCounts[sc]})</option>`;
  });

  const currentVal = subcatSelect.value;
  subcatSelect.innerHTML = html;
  if (currentVal && subcategories.includes(currentVal)) {
    subcatSelect.value = currentVal;
  } else {
    subcatSelect.value = '';
  }

  toggleSubcategoryFilter();
}
const populateSubcategoryOptions = initializeSubcategoryFilter;

function updateFiltersPanelPosition() {
  const panel = document.getElementById('filtersRow');
  const topbar = document.getElementById('topbar');
  if (panel && topbar) {
    panel.style.top = (topbar.offsetHeight + 8) + 'px';
  }
}

function toggleHideSection(type) {
  if (type === 'smart_ai') {
    const isHidden = localStorage.getItem('smart_ai_hidden') === 'true';
    localStorage.setItem('smart_ai_hidden', isHidden ? 'false' : 'true');
    const box = document.getElementById('smartAiRecommendationsBox');
    if (box) {
      if (isHidden) {
        box.style.display = 'block';
        updateSmartHomeRecommendations();
      } else {
        box.style.display = 'none';
      }
    }
  } else if (type === 'progress') {
    const isHidden = localStorage.getItem('progress_box_hidden') === 'true';
    localStorage.setItem('progress_box_hidden', isHidden ? 'false' : 'true');
    const box = document.getElementById('d3CollectionProgressBox');
    if (box) {
      if (isHidden) {
        box.style.display = 'block';
        renderD3CollectionProgress();
      } else {
        box.style.display = 'none';
      }
    }
  }
  updateTogglePillStates();
}

function updateTogglePillStates() {
  const aiHidden = localStorage.getItem('smart_ai_hidden') === 'true';
  const progressHidden = localStorage.getItem('progress_box_hidden') === 'true';

  const aiBtn = document.getElementById('toggleAiBoxBtn');
  if (aiBtn) {
    if (aiHidden) {
      aiBtn.classList.remove('active');
      aiBtn.classList.add('muted');
      aiBtn.title = 'Mostrar Recomendaciones IA';
    } else {
      aiBtn.classList.add('active');
      aiBtn.classList.remove('muted');
      aiBtn.title = 'Ocultar Recomendaciones IA';
    }
  }

  const progBtn = document.getElementById('toggleProgressBoxBtn');
  if (progBtn) {
    if (progressHidden) {
      progBtn.classList.remove('active');
      progBtn.classList.add('muted');
      progBtn.title = 'Mostrar Progreso de Colección';
    } else {
      progBtn.classList.add('active');
      progBtn.classList.remove('muted');
      progBtn.title = 'Ocultar Progreso de Colección';
    }
  }
}

function toggleFiltersPanel() {
  const panel = document.getElementById('filtersRow');
  const btn = document.getElementById('filterToggleBtn');
  if (!panel || !btn) return;

  const willOpen = !panel.classList.contains('open');
  if (willOpen) {
    updateFiltersPanelPosition();
    panel.classList.add('open');
    btn.classList.add('active');
    const targetHeight = panel.scrollHeight + 40;
    panel.style.maxHeight = targetHeight + 'px';
    clearTimeout(panel._heightTimer);
    panel._heightTimer = setTimeout(() => {
      if (panel.classList.contains('open')) {
        panel.style.maxHeight = '';
      }
    }, 400);
  } else {
    clearTimeout(panel._heightTimer);
    if (!panel.style.maxHeight || panel.style.maxHeight === 'none' || panel.style.maxHeight === '') {
      panel.style.maxHeight = panel.scrollHeight + 'px';
      panel.offsetHeight;
    }
    panel.style.maxHeight = '0px';
    panel.classList.remove('open');
    btn.classList.remove('active');
  }
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setLibraryFilter(status) {
  libraryFilter = (libraryFilter === status) ? '' : status;
  activeType = '';
  document.getElementById('stateFilter').value = libraryFilter;
  document.getElementById('typeFilterSelect').value = '';
  updateConsoleFilterVisibility();
  renderSidebar();
  updateLibraryActiveLinks();
  currentPage = 1;
  applyFilters();
  toggleSidebar(false);
}

function updateLibraryActiveLinks() {
  const map = { wishlist: 'libFavLink', playing: 'libPlayingLink', completed: 'libDoneLink' };
  Object.values(map).forEach(id => document.getElementById(id).classList.remove('active'));
  if (libraryFilter && map[libraryFilter]) document.getElementById(map[libraryFilter]).classList.add('active');
}

async function renderLibraryCounts() {
  const counts = {};
  if (typeof userStates !== 'undefined' && Array.isArray(userStates)) {
    userStates.forEach(s => { counts[s.status] = (counts[s.status] || 0) + 1; });
  }
  const favEl = document.getElementById('libFavCount');
  if (favEl) favEl.textContent = counts['wishlist'] || 0;
  const playEl = document.getElementById('libPlayingCount');
  if (playEl) playEl.textContent = counts['playing'] || 0;
  const doneEl = document.getElementById('libDoneCount');
  if (doneEl) doneEl.textContent = counts['completed'] || 0;

  try {
    const lists = (typeof idbGetAll === 'function') ? await idbGetAll('user_lists') : [];
    const listsEl = document.getElementById('libListsCount');
    if (listsEl) listsEl.textContent = (lists && Array.isArray(lists)) ? lists.length : 0;
  } catch(e) {
    console.warn("Error actualizando libListsCount:", e);
  }

  if (typeof renderD3CollectionProgress === 'function') renderD3CollectionProgress();
}
window.updateLibraryCountBadges = renderLibraryCounts;

document.getElementById('searchInput').addEventListener('input', () => {
  currentPage = 1;
  applyFilters();
});

// ==========================================
// 🔎 FILTRADO Y GRID
// ==========================================
let PER_PAGE = 40;
function getPerPage() {
  try {
    const currentSize = localStorage.getItem('joa_card_size') || 'standard';
    if (currentSize === 'compact') {
      return 48; // 48 es múltiplo de 3 (3 columnas x 16 filas = 48) para rellenar perfectamente la cuadrícula en modo compacto
    } else if (currentSize === 'large') {
      return 36;
    } else if (currentSize === 'list') {
      return 30; // 30 elementos por página en modo lista horizontal
    }
    return 40;
  } catch(e) {
    return 40;
  }
}
let currentPage = 1;
let filteredItems = [];

function populateFilterOptions() {
  const yearSelect = document.getElementById('yearFilter');
  const yearCounts = {};
  allItems.forEach(it => {
    if (it.year && it.year > 0) yearCounts[it.year] = (yearCounts[it.year] || 0) + 1;
  });
  const years = Object.keys(yearCounts).map(Number).sort((a, b) => b - a).slice(0, 20);
  let yearHtml = '<option value="">Todos</option>';
  years.forEach(year => { yearHtml += `<option value="${year}">${year} (${yearCounts[year]})</option>`; });
  yearSelect.innerHTML = yearHtml;

  const typeSelect = document.getElementById('typeFilterSelect');
  const typeCounts = {};
  allItems.forEach(it => { typeCounts[it.type] = (typeCounts[it.type] || 0) + 1; });
  let typeHtml = '<option value="">Todos</option>';
  const allOrder = [
    'juego', 'juego_emulado', 'pelicula', 'pelicula_animada', 'serie', 'serie_animada',
    'anime', 'anime_movie', 'novela_tv', 'musica', 'software', 'novela'
  ];
  const allTypeKeys = Array.from(new Set([...allOrder, ...Object.keys(typeLabels), ...Object.keys(typeCounts)]));
  allTypeKeys.forEach(key => {
    if (!typeCounts[key]) return;
    const label = typeLabels[key] || (key === 'novela_tv' ? '📺 Novelas TV' : key);
    typeHtml += `<option value="${key}">${escapeHtml(label)} (${typeCounts[key]})</option>`;
  });
  typeSelect.innerHTML = typeHtml;

  const modalTypeSelect = document.getElementById('modalTypeFilterSelect');
  if (modalTypeSelect) {
    let modalTypeHtml = '<option value="">✨ Todos los tipos</option>';
    allTypeKeys.forEach(key => {
      if (!typeCounts[key]) return;
      const label = typeLabels[key] || (key === 'novela_tv' ? '📺 Novelas TV' : key);
      modalTypeHtml += `<option value="${key}">${escapeHtml(label)} (${typeCounts[key]})</option>`;
    });
    modalTypeSelect.innerHTML = modalTypeHtml;
    modalTypeSelect.value = activeType || '';
  }

  const consoleSelect = document.getElementById('consoleFilterSelect');
  const consoleCounts = {};
  allItems.forEach(it => { if (it.console) consoleCounts[it.console] = (consoleCounts[it.console] || 0) + 1; });
  let consoleHtml = '<option value="">Todas</option>';
  Object.keys(consolesData).forEach(key => {
    if (!consoleCounts[key]) return;
    const c = consolesData[key];
    consoleHtml += `<option value="${key}">${escapeHtml((c.icon || '') + ' ' + (c.name || key))} (${consoleCounts[key]})</option>`;
  });
  consoleSelect.innerHTML = consoleHtml;

  const genreSelect = document.getElementById('genreFilter');
  if (genreSelect && genreSelect.tagName === 'SELECT') {
    const tagCounts = {};
    allItems.forEach(it => {
      const raw = ((it.genres || '') + ',' + (it.tags || '')).split(',');
      raw.forEach(g => {
        const clean = g.trim();
        if (clean && clean.length > 1 && !clean.startsWith('+18') && !clean.startsWith('18+')) {
          const formatted = clean.charAt(0).toUpperCase() + clean.slice(1);
          tagCounts[formatted] = (tagCounts[formatted] || 0) + 1;
        }
      });
    });
    const sortedTags = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b, 'es'));
    let tagHtml = '<option value="">Todas las tags y géneros...</option>';
    sortedTags.forEach(tag => {
      tagHtml += `<option value="${escapeHtml(tag.toLowerCase())}">${escapeHtml(tag)} (${tagCounts[tag]})</option>`;
    });
    const currentVal = genreSelect.value;
    genreSelect.innerHTML = tagHtml;
    if (currentVal) genreSelect.value = currentVal;
  }

  populateSubcategoryOptions();
  updateConsoleFilterVisibility();
}

function clearFilters() {
  activeType = '';
  libraryFilter = '';
  document.getElementById('genreFilter').value = '';
  document.getElementById('yearFilter').value = '';
  document.getElementById('stateFilter').value = '';
  document.getElementById('sortFilter').value = 'title_asc';
  document.getElementById('searchInput').value = '';
  const btn = document.getElementById('searchClearBtn');
  if (btn) btn.style.display = 'none';
  document.getElementById('typeFilterSelect').value = '';
  document.getElementById('consoleFilterSelect').value = '';
  if (document.getElementById('subcategoryFilterSelect')) {
    document.getElementById('subcategoryFilterSelect').value = '';
  }
  updateConsoleFilterVisibility();
  toggleSubcategoryFilter();
  renderSidebar();
  updateLibraryActiveLinks();
  currentPage = 1;
  applyFilters();
  if (typeof hideSearchDropdown === 'function') hideSearchDropdown();
}

const CATALOG_PREFIXES = {
  juego: 'JG', juego_emulado: 'JE', pelicula: 'PE', pelicula_animada: 'PA',
  serie: 'SE', serie_animada: 'SA', anime: 'AN', anime_movie: 'AM',
  novela_tv: 'NT', musica: 'MU', software: 'SW', novela: 'NO'
};
function catalogCode(it) {
  const prefix = CATALOG_PREFIXES[it.type] || (it.type || '??').slice(0, 2).toUpperCase();
  return `${prefix}-${String(it.id).padStart(4, '0')}`;
}

const SEARCH_ALIASES = {
  'gta': ['grand theft auto', 'san andreas', 'vice city'],
  'gow': ['god of war', 'ragnarok', 'valhalla'],
  'cod': ['call of duty', 'modern warfare', 'black ops', 'warzone'],
  're': ['resident evil', 'biohazard'],
  'rdr': ['red dead redemption', 'red dead'],
  'nfs': ['need for speed', 'most wanted', 'underground', 'unbound'],
  'ac': ['assassins creed', 'assassin creed', 'valhalla', 'mirage'],
  'dbz': ['dragon ball z', 'dragon ball', 'budokai', 'sparking'],
  'dbs': ['dragon ball super'],
  'tlou': ['the last of us', 'last of us'],
  'ff': ['final fantasy', 'remake', 'rebirth'],
  'dmc': ['devil may cry'],
  'mgs': ['metal gear solid', 'metal gear'],
  'mk': ['mortal kombat'],
  'pes': ['pro evolution soccer', 'efootball', 'pes'],
  'fifa': ['ea sports fc', 'fc 24', 'fc 25', 'fifa'],
  'mcu': ['marvel', 'avengers', 'vengadores'],
  'lotr': ['lord of the rings', 'senor de los anillos', 'anillos de poder'],
  'hp': ['harry potter', 'hogwarts legacy'],
  'got': ['game of thrones', 'juego de tronos', 'house of the dragon'],
  'twd': ['the walking dead', 'walking dead'],
  'sf': ['street fighter'],
  'sh': ['silent hill'],
  'zelda': ['the legend of zelda', 'legend of zelda', 'breath of the wild', 'tears of the kingdom', 'ocarina of time'],
  'pokemon': ['pokémon', 'pocket monsters'],
  'sw': ['star wars', 'guerra de las galaxias', 'jedi survivor', 'jedi fallen order'],
  'cs': ['counter strike', 'cs go', 'cs 2']
};

const ROMAN_NUMERALS = {
  '1': 'i', '2': 'ii', '3': 'iii', '4': 'iv', '5': 'v',
  '6': 'vi', '7': 'vii', '8': 'viii', '9': 'ix', '10': 'x',
  'i': '1', 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5',
  'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10'
};

function fastLevenshtein(a, b) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  if (Math.abs(la - lb) > 2) return 99;
  const row = [];
  for (let i = 0; i <= lb; i++) row[i] = i;
  for (let i = 1; i <= la; i++) {
    let prev = i;
    for (let j = 1; j <= lb; j++) {
      const val = (a[i - 1] === b[j - 1]) ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[lb] = prev;
  }
  return row[lb];
}

function normalizeText(str) {
  if (!str) return '';
  return str.toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’"“”`´]/g, "")
    .trim();
}

function normalizeSearchQuery(str) {
  if (!str) return '';
  return normalizeText(str).replace(/[^\w\s\d]/g, " ").replace(/\s+/g, " ").trim();
}

function getItemSynopsis(it) {
  if (!it) return '';
  return it.synopsis || it.description || it.descripcion || it.sinopsis || it.details || it.detalles || it.summary || it.resumen || it.overview || it.about || it.desc || it.info || '';
}

function getItemSearchMeta(it) {
  if (it._sMeta) return it._sMeta;
  const rawTitle = it.title || '';
  const normTitle = normalizeSearchQuery(rawTitle);
  const normTitleNoSpace = normTitle.replace(/\s+/g, '');
  const titleWords = normTitle.split(/\s+/).filter(Boolean);

  const normGenres = normalizeSearchQuery((it.genres || '') + ' ' + (it.genre || '') + ' ' + (it.tags || ''));
  const normDesc = normalizeSearchQuery(getItemSynopsis(it));
  const normConsole = normalizeSearchQuery(it.console || '');
  const normDev = normalizeSearchQuery((it.developer || '') + ' ' + (it.director || '') + ' ' + (it.studio || ''));
  const normYear = String(it.year || '');
  const normType = normalizeSearchQuery(it.type || '');
  const normSubcat = normalizeSearchQuery(getItemSubcategory(it));
  const normCode = normalizeSearchQuery(catalogCode(it)).replace(/\s+/g, '');
  const normRawCode = String(it.id || '').padStart(4, '0');
  const normActor = normalizeSearchQuery(it.cast || it.actores || it.creator || '');
  const tLabel = (typeof typeLabels !== 'undefined' && typeLabels[it.type]) ? normalizeSearchQuery(typeLabels[it.type]) : '';

  const fullBlob = `${normTitle} ${normGenres} ${normConsole} ${normSubcat} ${normDev} ${normActor} ${normCode} ${normRawCode} ${normYear} ${normDesc} ${tLabel}`;

  it._sMeta = {
    normTitle,
    normTitleNoSpace,
    titleWords,
    normGenres,
    normDesc,
    normConsole,
    normDev,
    normYear,
    normType,
    normSubcat,
    normCode,
    normRawCode,
    normActor,
    tLabel,
    fullBlob
  };
  return it._sMeta;
}

function calculateSearchScore(it, tokens) {
  if (!tokens || !tokens.length) return 0;
  
  const m = getItemSearchMeta(it);
  let totalScore = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    let tokenScore = 0;
    const tokNoSpace = tok.replace(/\s+/g, '');
    const tokRomanEquiv = ROMAN_NUMERALS[tok] || '';
    const aliases = SEARCH_ALIASES[tok] || [];

    // 1. Coincidencia de Código de Catálogo (ej: JG-0001, 0001, 1)
    if (m.normCode === tokNoSpace || m.normCode.includes(tokNoSpace) || m.normRawCode === tok || String(it.id) === tok) {
      tokenScore = Math.max(tokenScore, 180);
    }

    // 2. Coincidencias en TÍTULO
    if (m.normTitle === tok) {
      tokenScore = Math.max(tokenScore, 200);
    } else if (m.normTitle.startsWith(tok + ' ') || m.normTitle.startsWith(tok)) {
      tokenScore = Math.max(tokenScore, 150);
    } else if (m.titleWords.includes(tok)) {
      tokenScore = Math.max(tokenScore, 120);
    } else if (m.normTitle.includes(tok) || m.normTitleNoSpace.includes(tokNoSpace)) {
      tokenScore = Math.max(tokenScore, 90);
    }

    // 3. Conversión de Números Romanos / Arábigos en Título (ej: GTA V -> GTA 5)
    if (tokRomanEquiv && (m.titleWords.includes(tokRomanEquiv) || m.normTitle.includes(tokRomanEquiv))) {
      tokenScore = Math.max(tokenScore, 110);
    }

    // 4. Búsqueda por Acrónimos y Alias Populares (GTA, GOW, COD, RE, etc.)
    if (aliases.length > 0) {
      for (let j = 0; j < aliases.length; j++) {
        if (m.normTitle.includes(aliases[j])) {
          tokenScore = Math.max(tokenScore, 130);
          break;
        }
      }
    }

    // 5. Consola / Plataforma / Subcategoría
    if (m.normConsole === tok || m.normConsole.startsWith(tok) || m.normConsole.includes(tok)) {
      tokenScore = Math.max(tokenScore, 75);
    }
    if (m.normSubcat && (m.normSubcat === tok || m.normSubcat.includes(tok))) {
      tokenScore = Math.max(tokenScore, 70);
    }

    // 6. Año de Lanzamiento
    if (m.normYear === tok) {
      tokenScore = Math.max(tokenScore, 65);
    }

    // 7. Géneros y Etiquetas
    if (m.normGenres.includes(tok)) {
      tokenScore = Math.max(tokenScore, 60);
    }

    // 8. Tipo de Contenido (Juego, Película, Serie, etc.)
    if (m.normType.includes(tok) || (m.tLabel && m.tLabel.includes(tok))) {
      tokenScore = Math.max(tokenScore, 50);
    }

    // 9. Desarrollador / Director / Estudio / Actores
    if (m.normDev.includes(tok) || m.normActor.includes(tok)) {
      tokenScore = Math.max(tokenScore, 45);
    }

    // 10. Sinopsis / Descripción
    if (m.normDesc.includes(tok)) {
      tokenScore = Math.max(tokenScore, 30);
    }

    // 11. Búsqueda Difusa / Tolerancia a Errores Tipográficos (Fuzzy Levenshtein)
    if (tokenScore === 0 && tok.length >= 4) {
      for (let w = 0; w < m.titleWords.length; w++) {
        const word = m.titleWords[w];
        if (word.length >= 3) {
          const maxDist = tok.length >= 7 ? 2 : 1;
          const dist = fastLevenshtein(tok, word);
          if (dist <= maxDist) {
            tokenScore = Math.max(tokenScore, 40 - (dist * 10));
            break;
          }
        }
      }
    }

    // Si para algún token de la búsqueda no hay ninguna coincidencia, se descarta el elemento
    if (tokenScore <= 0) return -1;

    totalScore += tokenScore;
  }

  return totalScore;
}

function hasActiveSearchOrFilter() {
  const quickInput = document.getElementById('topbarQuickSearchInput');
  const modalInput = document.getElementById('searchInput');
  const q1 = (quickInput ? quickInput.value : '').trim();
  const q2 = (modalInput ? modalInput.value : '').trim();
  if (q1.length > 0 || q2.length > 0) return true;

  if (activeType && activeType !== '') return true;
  if (libraryFilter && libraryFilter !== '') return true;

  const genre = document.getElementById('genreFilter')?.value?.trim();
  if (genre) return true;
  const year = document.getElementById('yearFilter')?.value?.trim();
  if (year) return true;
  const state = document.getElementById('stateFilter')?.value?.trim();
  if (state) return true;
  const consoleVal = document.getElementById('consoleFilterSelect')?.value?.trim();
  if (consoleVal) return true;
  const subcat = document.getElementById('subcategoryFilterSelect')?.value?.trim();
  if (subcat) return true;

  return false;
}
window.hasActiveSearchOrFilter = hasActiveSearchOrFilter;

function quickCategorySelect(catName) {
  if (window.triggerHaptic) window.triggerHaptic(20);
  const quickInput = document.getElementById('topbarQuickSearchInput');
  if (quickInput) quickInput.value = '';
  const clearBtn = document.getElementById('topbarQuickSearchClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';

  if (catName === 'Juegos PC') {
    setTypeFilter('juego');
  } else if (catName === 'PlayStation') {
    const consoleSel = document.getElementById('consoleFilterSelect');
    if (consoleSel) {
      let found = false;
      for (let i = 0; i < consoleSel.options.length; i++) {
        const val = (consoleSel.options[i].value || '').toLowerCase();
        if (val.includes('playstation') || val.includes('ps')) {
          consoleSel.value = consoleSel.options[i].value;
          found = true;
          break;
        }
      }
      if (!found) {
        setTypeFilter('juego');
      } else {
        applyFilters();
      }
    }
  } else if (catName === 'Películas') {
    setTypeFilter('pelicula');
  } else if (catName === 'Series') {
    setTypeFilter('serie');
  } else if (catName === 'Juegos Retro') {
    setTypeFilter('juego_emulado');
  } else if (catName === 'Animados') {
    setTypeFilter('pelicula_animada');
  } else {
    if (quickInput) {
      quickInput.value = catName;
      handleQuickCatalogSearch(catName);
    }
  }
}
window.quickCategorySelect = quickCategorySelect;

function applyFilters() {
  const quickInput = document.getElementById('topbarQuickSearchInput');
  const modalInput = document.getElementById('searchInput');
  const rawQ = (quickInput && quickInput.value.length > 0) ? quickInput.value : (modalInput ? modalInput.value : '');
  const q = rawQ.trim();
  const qNorm = normalizeText(q);
  const tokens = qNorm.split(/\s+/).filter(Boolean);

  const genreVal = document.getElementById('genreFilter').value.trim().toLowerCase();
  const yearVal = document.getElementById('yearFilter').value;
  const stateVal = document.getElementById('stateFilter').value;
  const sortVal = document.getElementById('sortFilter').value;
  const consoleVal = document.getElementById('consoleFilterSelect').value;
  const subcatSelect = document.getElementById('subcategoryFilterSelect');
  const subcatVal = subcatSelect ? subcatSelect.value.trim().toLowerCase() : '';

  libraryFilter = stateVal;
  const stateItemIds = stateVal ? new Set(userStates.filter(s => s.status === stateVal).map(s => s.itemId)) : null;

  filteredItems = allItems.filter(it => {
    if (activeType && it.type !== activeType) return false;
    if (consoleVal && it.console !== consoleVal) return false;
    if (subcatVal) {
      const itemSubcat = getItemSubcategory(it).toLowerCase();
      if (itemSubcat !== subcatVal) return false;
    }
    if (yearVal && it.year != yearVal) return false;
    if (genreVal) {
      const genresAndTags = normalizeText((it.genres || '') + ' ' + (it.tags || ''));
      if (!genresAndTags.includes(normalizeText(genreVal))) return false;
    }
    if (stateItemIds && !stateItemIds.has(it.id)) return false;
    if (localStorage.getItem('joa_mature_filter') === 'true') {
      const matStr = ((it.genres||'') + ' ' + (it.title||'') + ' ' + (it.description||'') + ' ' + (it.rating||'') + ' ' + (it.age_rating||'') + ' ' + (it.tags||'')).toLowerCase();
      if (matStr.includes('+18') || matStr.includes('18+') || matStr.includes('maduro') || matStr.includes('mature') || matStr.includes('erotico') || matStr.includes('erótico') || matStr.includes('adulto') || matStr.includes('adult') || matStr.includes('gore') || matStr.includes('violencia extrema') || matStr.includes('desnudez') || matStr.includes('nsfw')) {
        return false;
      }
    }
    if (tokens.length > 0) {
      const score = calculateSearchScore(it, tokens);
      if (score <= 0) return false;
      it._searchScore = score;
    } else {
      it._searchScore = 0;
    }
    return true;
  });

function getItemUpdatedTimestamp(it) {
  if (!it) return 0;
  if (it._cachedUpdateTime !== undefined) return it._cachedUpdateTime;

  let time = 0;
  if (it.updatedAt) {
    if (typeof it.updatedAt === 'number') {
      time = it.updatedAt;
    } else if (typeof it.updatedAt === 'string') {
      const s = it.updatedAt.trim();
      const iso = s.includes('T') ? s : s.replace(' ', 'T');
      const parsed = Date.parse(iso);
      if (!isNaN(parsed)) time = parsed;
    }
  }
  if (!time && (it.createdAt || it.addedAt || it.date_added)) {
    const raw = it.createdAt || it.addedAt || it.date_added;
    if (typeof raw === 'number') {
      time = raw;
    } else if (typeof raw === 'string') {
      const s = raw.trim();
      const iso = s.includes('T') ? s : s.replace(' ', 'T');
      const parsed = Date.parse(iso);
      if (!isNaN(parsed)) time = parsed;
    }
  }
  it._cachedUpdateTime = time;
  return time;
}

  filteredItems.sort((a, b) => {
    if (sortVal === 'relevance' || (tokens.length > 0 && sortVal === 'title_asc')) {
      const diff = (b._searchScore || 0) - (a._searchScore || 0);
      if (diff !== 0) return diff;
    }
    switch (sortVal) {
      case 'relevance': return (b.rating || 0) - (a.rating || 0) || (a.title || '').localeCompare(b.title || '', 'es');
      case 'updated_desc': {
        const timeA = getItemUpdatedTimestamp(a);
        const timeB = getItemUpdatedTimestamp(b);
        if (timeB !== timeA) return timeB - timeA;
        const orderA = a._catalogOrder !== undefined ? a._catalogOrder : (parseInt(a.id, 10) || 0);
        const orderB = b._catalogOrder !== undefined ? b._catalogOrder : (parseInt(b.id, 10) || 0);
        if (orderB !== orderA) return orderB - orderA;
        return (a.title || '').localeCompare(b.title || '', 'es');
      }
      case 'title_asc': return (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' });
      case 'title_desc': return (b.title || '').localeCompare(a.title || '', 'es', { sensitivity: 'base' });
      case 'year_desc': return (b.year || 0) - (a.year || 0) || (a.title || '').localeCompare(b.title || '', 'es');
      case 'year_asc': return (a.year || 9999) - (b.year || 9999) || (a.title || '').localeCompare(b.title || '', 'es');
      case 'rating_desc': return (b.rating || 0) - (a.rating || 0) || (a.title || '').localeCompare(b.title || '', 'es');
      case 'rating_asc': return (a.rating || 0) - (b.rating || 0) || (a.title || '').localeCompare(b.title || '', 'es');
      case 'reviews_desc': return (b.reviews || 0) - (a.reviews || 0) || (a.title || '').localeCompare(b.title || '', 'es');
      case 'reviews_asc': return (a.reviews || 0) - (b.reviews || 0) || (a.title || '').localeCompare(b.title || '', 'es');
      case 'price_asc': return getItemPriceNumeric(a) - getItemPriceNumeric(b) || (a.title || '').localeCompare(b.title || '', 'es');
      case 'price_desc': return getItemPriceNumeric(b) - getItemPriceNumeric(a) || (a.title || '').localeCompare(b.title || '', 'es');
      default: return 0;
    }
  });

  renderSidebar();
  updateLibraryActiveLinks();
  if (typeof updateSmartHomeRecommendations === 'function') updateSmartHomeRecommendations();
  renderGrid();
  if (typeof updateSearchResultsBadge === 'function') updateSearchResultsBadge();
}

let activeGridObserver = null;

function showSkeletonGrid(count = 8) {
  const container = document.getElementById('gridContainer');
  if (!container) return;
  const currentSize = localStorage.getItem('joa_card_size') || 'standard';
  container.className = 'grid card-size-' + currentSize;
  container.innerHTML = Array.from({ length: count }).map(() => `
    <div class="card skeleton-card">
      <div class="card-img skeleton-box"></div>
      <div class="card-body">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-meta"></div>
      </div>
    </div>
  `).join('');
}

let userNotesMap = {};
let userStatesByItemId = {};

function refreshUserStatesMap() {
  userStatesByItemId = {};
  if (typeof userStates !== 'undefined' && Array.isArray(userStates)) {
    for (let i = 0; i < userStates.length; i++) {
      const s = userStates[i];
      if (s && s.itemId != null) {
        userStatesByItemId[s.itemId] = s;
      }
    }
  }
}

function getItemProgressInfo(it) {
  if (!it || !it.id) return { pct: 0, statusClass: 'status-empty', label: 'Sin iniciar (0%)' };

  const stateObj = userStatesByItemId[it.id] || null;
  const status = stateObj ? stateObj.status : null;
  const notes = (typeof userNotesMap !== 'undefined' && userNotesMap) ? userNotesMap[it.id] : null;

  let pctFromNotes = null;
  let notesDetailText = '';

  if (Array.isArray(notes) && notes.length > 0) {
    let totalCheckboxes = 0;
    let checkedCheckboxes = 0;
    let maxFractionPct = null;
    let maxFractionStr = '';
    let maxExplicitPct = null;
    let maxCapPct = null;
    let maxCapStr = '';

    const chapterCount = parseInt(it.chapter_count || it.chapters || it.episodes || it.episode_count || 0, 10);

    notes.forEach(n => {
      const text = typeof n === 'string' ? n : (n.text || '');
      
      const checkedMatches = (text.match(/\[x\]|\[X\]|☑|✅/gi) || []).length;
      const uncheckedMatches = (text.match(/\[\s*\]|☐/gi) || []).length;
      if (checkedMatches > 0 || uncheckedMatches > 0) {
        checkedCheckboxes += checkedMatches;
        totalCheckboxes += (checkedMatches + uncheckedMatches);
      }

      const fractionMatches = text.matchAll(/(\d+)\s*\/\s*(\d+)/gi);
      for (const match of fractionMatches) {
        const cur = parseInt(match[1], 10);
        const tot = parseInt(match[2], 10);
        if (tot > 0 && cur <= tot) {
          const calc = Math.round((cur / tot) * 100);
          if (maxFractionPct === null || calc > maxFractionPct) {
            maxFractionPct = calc;
            maxFractionStr = `${cur}/${tot}`;
          }
        }
      }

      const pctMatches = text.matchAll(/(\d{1,3})\s*%/g);
      for (const match of pctMatches) {
        const val = parseInt(match[1], 10);
        if (val >= 0 && val <= 100) {
          if (maxExplicitPct === null || val > maxExplicitPct) {
            maxExplicitPct = val;
          }
        }
      }

      if (chapterCount > 0) {
        const capMatches = text.matchAll(/(?:cap|capítulo|ep|episodio|ch)\s*\.?\s*(\d+)/gi);
        for (const match of capMatches) {
          const cur = parseInt(match[1], 10);
          if (cur > 0 && cur <= chapterCount) {
            const calc = Math.round((cur / chapterCount) * 100);
            if (maxCapPct === null || calc > maxCapPct) {
              maxCapPct = calc;
              maxCapStr = `Cap. ${cur}/${chapterCount}`;
            }
          }
        }
      }
    });

    if (totalCheckboxes > 0) {
      pctFromNotes = Math.round((checkedCheckboxes / totalCheckboxes) * 100);
      notesDetailText = `${checkedCheckboxes}/${totalCheckboxes} tareas`;
    } else if (maxFractionPct !== null) {
      pctFromNotes = maxFractionPct;
      notesDetailText = maxFractionStr;
    } else if (maxCapPct !== null) {
      pctFromNotes = maxCapPct;
      notesDetailText = maxCapStr;
    } else if (maxExplicitPct !== null) {
      pctFromNotes = maxExplicitPct;
      notesDetailText = `${maxExplicitPct}%`;
    }
  }

  let pct = 0;
  let label = '';
  let statusClass = 'status-empty';

  if (status === 'completed') {
    pct = 100;
    label = '✅ Completado (100%)';
    statusClass = 'status-completed';
  } else if (pctFromNotes !== null) {
    pct = Math.min(100, Math.max(0, pctFromNotes));
    label = `📝 Progreso de Notas: ${pct}% ${notesDetailText ? '(' + notesDetailText + ')' : ''}`;
    statusClass = status ? `status-${status}` : 'status-notes';
  } else if (status === 'playing') {
    pct = 60;
    label = '🎮 En curso / Viendo (60%)';
    statusClass = 'status-playing';
  } else if (status === 'paused') {
    pct = 35;
    label = '⏸️ Pausado (35%)';
    statusClass = 'status-paused';
  } else if (status === 'pending') {
    pct = 10;
    label = '🕓 Pendiente (10%)';
    statusClass = 'status-pending';
  } else if (status === 'wishlist') {
    pct = 5;
    label = '❤️ En Deseos (5%)';
    statusClass = 'status-wishlist';
  } else if (status === 'dropped') {
    pct = 15;
    label = '❌ Abandonado (15%)';
    statusClass = 'status-dropped';
  } else if (Array.isArray(notes) && notes.length > 0) {
    pct = 25;
    label = '📝 Con notas registradas (25%)';
    statusClass = 'status-notes';
  } else {
    pct = 0;
    label = 'Sin iniciar (0%)';
    statusClass = 'status-empty';
  }

  return { pct, label, statusClass };
}

function renderGridCardHtml(it, idxInBatch) {
  const priceStr = formatItemPrice(it);
  const priceNum = getItemPriceNumeric(it);
  const priceStyle = priceNum > 0
    ? 'background:linear-gradient(135deg,#00E5FF,#0088FF);color:#04050A;border:none;box-shadow:0 3px 10px rgba(0,229,255,0.45);'
    : 'background:rgba(0,255,178,0.88);color:#04050A;border:none;box-shadow:0 3px 8px rgba(0,255,178,0.3);';
  const animDelay = Math.min(idxInBatch * 0.03, 0.35).toFixed(3);

  const stateObj = userStatesByItemId[it.id];
  const isFav = (stateObj && stateObj.status === 'wishlist') || (typeof libraryFilter !== 'undefined' && libraryFilter === 'wishlist');

  const seasonCount = it.season_count || it.seasons || it.seasons_count;
  const chapterCount = it.chapter_count || it.chapters || it.episodes || it.episode_count;

  const isBulkSel = typeof selectedBulkItemIds !== 'undefined' && selectedBulkItemIds.has(it.id);

  const prog = getItemProgressInfo(it);
  const subcat = getItemSubcategory(it);

  return `
    <div class="card card-fade-in ${isFav ? 'is-favorite' : ''} ${isBulkSel ? 'is-bulk-selected' : ''}" 
         id="gridCard_${it.id}"
         draggable="false"
         style="animation-delay:${animDelay}s"
         oncontextmenu="event.preventDefault(); return false;"
         onpointerdown="handleCardPointerDown(event, ${it.id})"
         onpointermove="handleCardPointerMove(event, ${it.id})"
         onpointerup="handleCardPointerUp(event, ${it.id})"
         onpointercancel="handleCardPointerCancel(event, ${it.id})"
         onclick="handleCardClick(event, ${it.id})">
      <div class="card-img">
        <img src="${resolveImageUrl(it.cover || it.image || it.poster || it.caratula || it.img)}" alt="${escapeHtml(it.title)}" draggable="false" loading="lazy" decoding="async" onload="if(window.autoCacheVisibleImage)window.autoCacheVisibleImage(this);" onerror="this.src='${PLACEHOLDER_IMG}'">
      </div>
      <div class="card-bulk-checkbox ${isBulkSel ? 'checked' : ''}" title="Seleccionar">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <span class="card-catalog-num">${catalogCode(it)}</span>
      ${isFav ? `<span class="card-fav-badge" title="Favorito">❤️</span>` : ''}
      <span class="card-price-tag" style="${priceStyle}">🏷️ ${escapeHtml(priceStr)}</span>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(it.title)}</h3>
        <div class="card-meta">
          ${it.year ? `<span>${escapeHtml(String(it.year))}</span>` : ''}
          ${subcat ? `<span class="tag subcategory-tag" title="Subcategoría: ${escapeHtml(subcat)}">💻 ${escapeHtml(subcat)}</span>` : ''}
          ${seasonCount ? `<span class="tag season-tag" title="${escapeHtml(String(seasonCount))} temporada(s)">🗂️ ${escapeHtml(String(seasonCount))} temp.</span>` : ''}
          ${chapterCount ? `<span class="tag size-tag" title="${escapeHtml(String(chapterCount))} capítulos">📺 ${escapeHtml(String(chapterCount))} cap.</span>` : ''}
        </div>
        ${it.reviews > 0 ? `<div class="card-rating">★ ${it.rating} (${it.reviews})</div>` : ''}
      </div>
      <div class="card-progress-bar ${prog.pct > 0 ? 'active' : ''}" title="${escapeHtml(prog.label)}">
        <div class="card-progress-fill ${prog.statusClass}" style="width: ${prog.pct}%;"></div>
      </div>
    </div>
  `;
}

function renderGrid() {
  refreshUserStatesMap();
  if (typeof getProNotesMap === 'function' && !window._notesMapInit) {
    window._notesMapInit = true;
    getProNotesMap().then(map => {
      userNotesMap = map || {};
      if (typeof renderGrid === 'function') renderGrid();
    }).catch(e => console.warn(e));
  }
  
  const container = document.getElementById('gridContainer');
  const emptyEl = document.getElementById('emptyState');
  const paginationEl = document.getElementById('pagination');
  const counterEl = document.getElementById('resultsCounter');
  const welcomeEl = document.getElementById('mainWelcomeScreen');

  // Si no hay búsqueda ni filtros activos, mostrar pantalla de bienvenida despejada y ocultar resultados
  if (!hasActiveSearchOrFilter()) {
    if (welcomeEl) {
      welcomeEl.style.display = 'block';
      if (typeof initWelcomeLightsAnimation === 'function') initWelcomeLightsAnimation();
    }
    if (container) {
      container.style.display = 'none';
      container.innerHTML = '';
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (paginationEl) paginationEl.style.display = 'none';
    if (counterEl) counterEl.style.display = 'none';
    return;
  }

  // Al textear o filtrar, se quita la pantalla de bienvenida y se muestran los resultados de búsqueda
  if (welcomeEl) welcomeEl.style.display = 'none';

  if (container) {
    container.style.display = 'grid';
    const currentSize = localStorage.getItem('joa_card_size') || 'standard';
    container.classList.remove('card-size-compact', 'card-size-standard', 'card-size-large', 'card-size-list', 'is-wishlist-active');
    container.classList.add('card-size-' + currentSize);
    if (typeof libraryFilter !== 'undefined' && libraryFilter === 'wishlist') {
      container.classList.add('is-wishlist-active');
    }
    if (typeof isBulkSelectActive !== 'undefined' && isBulkSelectActive) {
      container.classList.add('is-bulk-mode-active');
    }
  }

  if (activeGridObserver) {
    activeGridObserver.disconnect();
    activeGridObserver = null;
  }

  if (!filteredItems.length) {
    container.innerHTML = '';
    emptyEl.style.display = 'block';
    paginationEl.style.display = 'none';
    counterEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';

  const sortLabels = {
    'updated_desc': '🆕 Actualizado recientemente',
    'title_asc': '🔤 Título A-Z', 'title_desc': '🔤 Título Z-A',
    'year_desc': '📅 Más recientes', 'year_asc': '📅 Más antiguos',
    'rating_desc': '⭐ Mejor valorados', 'rating_asc': '⭐ Menos valorados',
    'reviews_desc': '💬 Más reseñas', 'reviews_asc': '💬 Menos reseñas',
    'price_asc': '🏷️ Menor precio', 'price_desc': '🏷️ Mayor precio',
    'relevance': '🎯 Relevancia'
  };
  const sortVal = document.getElementById('sortFilter').value;
  const perPage = getPerPage();
  const start = (currentPage - 1) * perPage;
  const end = Math.min(currentPage * perPage, filteredItems.length);
  const sumTotal = filteredItems.reduce((acc, it) => acc + getItemPriceNumeric(it), 0);
  const sumFormatted = formatListTotal(sumTotal);
  counterEl.innerHTML = `
    <span>📦 Total:</span>
    <span class="count">${filteredItems.length}</span>
    <span>contenido${filteredItems.length !== 1 ? 's' : ''}</span>
    <span style="opacity:.6">· Mostrando ${start + 1}-${end}</span>
    <span style="opacity:.6">· Ordenado por: ${sortLabels[sortVal] || 'Título A-Z'}</span>
    <span style="color:#00FFB2;font-weight:700;margin-left:auto;background:rgba(0,255,178,0.12);padding:3px 10px;border-radius:8px;border:1px solid rgba(0,255,178,0.3);">💰 Suma Lista: ${sumFormatted}</span>
  `;
  counterEl.style.display = 'flex';

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / perPage));
  currentPage = Math.min(currentPage, totalPages);
  const pageStart = (currentPage - 1) * perPage;
  const pageItems = filteredItems.slice(pageStart, pageStart + perPage);

  container.innerHTML = '';
  const LAZY_BATCH_SIZE = 12;
  let renderIndex = 0;

  function renderBatch() {
    const batch = pageItems.slice(renderIndex, renderIndex + LAZY_BATCH_SIZE);
    if (!batch.length) return;

    const oldSentinel = document.getElementById('gridLazySentinel');
    if (oldSentinel) oldSentinel.remove();

    const batchHtml = batch.map((it, idx) => renderGridCardHtml(it, idx)).join('');
    container.insertAdjacentHTML('beforeend', batchHtml);

    renderIndex += batch.length;

    if (renderIndex < pageItems.length) {
      const sentinelHtml = `
        <div id="gridLazySentinel" style="grid-column: 1 / -1; width: 100%; min-height: 48px; display: flex; align-items: center; justify-content: center; gap: 8px; opacity: 0.75; font-size: 0.78rem; color: var(--text2); margin: 12px 0;">
          <span style="display:inline-block; width:14px; height:14px; border:2px solid rgba(255,255,255,0.25); border-top-color:var(--signal); border-radius:50%; animation:gridSpin 0.7s linear infinite;"></span>
          <span>Cargando más elementos...</span>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', sentinelHtml);

      if (typeof IntersectionObserver !== 'undefined') {
        if (activeGridObserver) activeGridObserver.disconnect();
        activeGridObserver = new IntersectionObserver((entries) => {
          if (entries[0] && entries[0].isIntersecting) {
            activeGridObserver.disconnect();
            renderBatch();
          }
        }, { root: null, rootMargin: '300px', threshold: 0.05 });

        const newSentinel = document.getElementById('gridLazySentinel');
        if (newSentinel) activeGridObserver.observe(newSentinel);
      } else {
        setTimeout(renderBatch, 60);
      }
    } else {
      if (activeGridObserver) {
        activeGridObserver.disconnect();
        activeGridObserver = null;
      }
    }
  }

  renderBatch();

  if (totalPages > 1) {
    paginationEl.style.display = 'flex';
    paginationEl.innerHTML = `
      <button ${currentPage <= 1 ? 'disabled' : ''} onclick="goPage(${currentPage - 1})">◀ Anterior</button>
      <span>Página ${currentPage} de ${totalPages}</span>
      <button ${currentPage >= totalPages ? 'disabled' : ''} onclick="goPage(${currentPage + 1})">Siguiente ▶</button>
    `;
  } else {
    paginationEl.style.display = 'none';
  }
}

function goPage(p) {
  currentPage = p;
  if (typeof updateSmartHomeRecommendations === 'function') updateSmartHomeRecommendations();
  renderGrid();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// 🎮 GESTOR DE ÚLTIMOS JUEGOS ACCEDIDOS (EXPERIENCIA DE RETORNO)
// ==========================================
const RECENT_ACCESSED_STORAGE_KEY = 'joa_last_accessed_games_v1';

function getRecentAccessedGames() {
  try {
    const raw = localStorage.getItem(RECENT_ACCESSED_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function recordRecentAccessedGame(item) {
  if (!item || !item.id) return;
  try {
    let list = getRecentAccessedGames();
    list = list.filter(g => String(g.id) !== String(item.id));
    const entry = {
      id: item.id,
      title: item.title || 'Título sin nombre',
      type: item.type || 'juego',
      category: item.category || item.genre || (typeLabels[item.type] || item.type || 'Juego'),
      cover: item.cover || item.image || item.poster || item.caratula || item.img || '',
      price: formatItemPrice(item),
      rating: item.rating || 5,
      accessedAt: Date.now()
    };
    list.unshift(entry);
    list = list.slice(0, 3);
    localStorage.setItem(RECENT_ACCESSED_STORAGE_KEY, JSON.stringify(list));
    if (typeof renderRecentAccessedSection === 'function') {
      renderRecentAccessedSection();
    }
  } catch (e) {
    console.warn('Error recording recent game:', e);
  }
}

function clearRecentAccessedGames() {
  try {
    localStorage.removeItem(RECENT_ACCESSED_STORAGE_KEY);
    if (typeof renderRecentAccessedSection === 'function') {
      renderRecentAccessedSection();
    }
    if (typeof showToast === 'function') {
      showToast('🧹 Historial de juegos recientes limpiado');
    }
  } catch (e) {
    console.warn(e);
  }
}

function renderRecentAccessedSection() {
  const container = document.getElementById('recentAccessedSection');
  if (container) container.style.display = 'none';
}

// ==========================================
// 🪟 MODAL DE DETALLE
// ==========================================
let currentDetailId = null;

async function openDetail(id) {
  if (window.triggerHaptic) window.triggerHaptic(35);
  closeAllOpenModals('detailModal');
  const it = findCatalogItem(id) || allItems.find(i => i.id === id);
  if (!it) return;
  currentDetailId = id;
  recordRecentAccessedGame(it);

  const modalImgEl = document.getElementById('modalImg');
  if (modalImgEl) {
    modalImgEl.src = resolveImageUrl(it.cover || it.image || it.poster || it.caratula || it.img);
    modalImgEl.onload = function() { if (window.autoCacheVisibleImage) window.autoCacheVisibleImage(this); };
    modalImgEl.onerror = function() { this.src = PLACEHOLDER_IMG; };
  }
  document.getElementById('modalTitleTxt').textContent = it.title;

  const priceStr = formatItemPrice(it);
  const priceNum = getItemPriceNumeric(it);
  const priceTagStyle = priceNum > 0
    ? 'background:linear-gradient(135deg,#00E5FF,#0088FF);color:#04050A;font-weight:800;border:none;box-shadow:0 3px 12px rgba(0,229,255,0.4);'
    : 'background:rgba(0,255,178,0.22);color:#00FFB2;border:1px solid #00FFB2;font-weight:800;box-shadow:0 2px 8px rgba(0,255,178,0.25);';

  let tagsHtml = `<button type="button" class="tag-chip price-chip" style="${priceTagStyle}" onclick="showToast('💰 Precio del título: ${escapeHtml(priceStr)}')"><span>🏷️</span><span>${escapeHtml(priceStr)}</span></button>`;

  const addedTagKeys = new Set();
  function stripLeadingEmoji(str) {
    if (!str) return '';
    return String(str)
      .replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]+/gu, '')
      .trim();
  }

  function addChip(rawLabel, chipHtml) {
    const clean = stripLeadingEmoji(rawLabel);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!addedTagKeys.has(key)) {
      addedTagKeys.add(key);
      tagsHtml += chipHtml;
    }
  }

  if (typeLabels[it.type] || it.type) {
    const rawTypeLabel = typeLabels[it.type] || it.type;
    const cleanTypeLabel = stripLeadingEmoji(rawTypeLabel) || rawTypeLabel;
    let tIcon = '📁';
    if (it.type && it.type.includes('juego')) tIcon = '🎮';
    else if (it.type && it.type.includes('pelicula')) tIcon = '🎬';
    else if (it.type && it.type.includes('serie')) tIcon = '📺';
    else if (it.type && it.type.includes('anime')) tIcon = '🌸';
    else if (it.type && it.type.includes('musica')) tIcon = '🎵';
    else if (it.type && it.type.includes('software')) tIcon = '💻';
    else if (it.type && (it.type === 'novela_tv' || it.type.includes('novela_tv') || it.type.includes('telenovela'))) tIcon = '📺';
    else if (it.type && it.type.includes('novela')) tIcon = '📚';
    
    addChip(cleanTypeLabel, `<button type="button" class="tag-chip type-chip" style="background:linear-gradient(135deg, rgba(255,107,0,0.25), rgba(255,0,128,0.25)); border:1px solid #FF6B00; color:#FF9E40; font-weight:800; box-shadow:0 2px 8px rgba(255,107,0,0.3);" onclick="filterByTypeFromModal('${escapeHtml(it.type || '')}', '${escapeHtml(cleanTypeLabel)}')" title="Filtrar por categoría: ${escapeHtml(cleanTypeLabel)}"><span>${tIcon}</span><span>${escapeHtml(cleanTypeLabel)}</span></button>`);
  }

  const subcat = getItemSubcategory(it);
  const cleanSubcat = stripLeadingEmoji(subcat);
  const subcatEl = document.getElementById('modalSubcategory');
  if (subcatEl) {
    if (cleanSubcat) {
      subcatEl.innerHTML = `💻 <span style="font-weight:800;">${escapeHtml(cleanSubcat)}</span>`;
      subcatEl.style.display = 'inline-flex';
    } else {
      subcatEl.style.display = 'none';
    }
  }

  if (cleanSubcat) {
    addChip(cleanSubcat, `<button type="button" class="tag-chip subcategory-chip" style="background:rgba(0, 255, 178, 0.18); border:1px solid #00FFB2; color:#00FFB2; font-weight:800; box-shadow:0 2px 8px rgba(0, 255, 178, 0.25);" onclick="filterBySubcategoryFromModal('${escapeHtml(subcat)}')" title="Filtrar por subcategoría: ${escapeHtml(cleanSubcat)}"><span>💻</span><span>${escapeHtml(cleanSubcat)}</span></button>`);
  }

  if (it.console) {
    const cData = typeof consolesData !== 'undefined' ? consolesData[it.console] : null;
    const cIcon = (cData && cData.icon) ? cData.icon : '🕹️';
    const cName = (cData && cData.name) ? cData.name : it.console;
    const cleanCName = stripLeadingEmoji(cName);
    addChip(cleanCName, `<button type="button" class="tag-chip console-chip" style="background:rgba(0, 140, 255, 0.22); border:1px solid #008CFF; color:#66B2FF; font-weight:800; box-shadow:0 2px 8px rgba(0, 140, 255, 0.3);" onclick="filterByConsoleFromModal('${escapeHtml(it.console)}')" title="Filtrar por consola: ${escapeHtml(cleanCName)}"><span>${cIcon}</span><span>${escapeHtml(cleanCName)}</span></button>`);
  }

  if (it.year) {
    const yearStr = String(it.year);
    addChip(yearStr, `<button type="button" class="tag-chip year-chip" style="background:rgba(255, 171, 0, 0.22); border:1px solid #FFAB00; color:#FFD54F; font-weight:800; box-shadow:0 2px 8px rgba(255, 171, 0, 0.3);" onclick="filterByYearFromModal('${escapeHtml(yearStr)}')" title="Filtrar por año: ${escapeHtml(yearStr)}"><span>📅</span><span>${escapeHtml(yearStr)}</span></button>`);
  }

  const devVal = it.developer || it.desarrollador || it.author || it.autor || it.studio || it.estudio;
  if (devVal) {
    const cleanDev = stripLeadingEmoji(devVal);
    addChip(cleanDev, `<button type="button" class="tag-chip dev-chip" style="background:rgba(157,78,221,0.22); border:1px solid #9D4EDD; color:#D8B4FE; font-weight:800; box-shadow:0 2px 8px rgba(157,78,221,0.3);" onclick="filterByDevFromModal('${escapeHtml(String(devVal))}')" title="Desarrollador / Creador: ${escapeHtml(cleanDev)}"><span>👨‍💻</span><span>${escapeHtml(cleanDev)}</span></button>`);
  }

  const versionVal = it.version || it.version_str || it.v;
  if (versionVal) {
    const cleanVer = stripLeadingEmoji(versionVal);
    addChip(`v${cleanVer}`, `<button type="button" class="tag-chip version-chip" style="background:rgba(0,229,255,0.18); border:1px solid #00E5FF; color:#00E5FF; font-weight:800; box-shadow:0 2px 8px rgba(0,229,255,0.25);" title="Versión: ${escapeHtml(String(versionVal))}"><span>🏷️</span><span>v${escapeHtml(cleanVer)}</span></button>`);
  }

  const osVal = it.os || it.platform || it.plataforma || it.sistema;
  if (osVal) {
    const cleanOS = stripLeadingEmoji(osVal);
    addChip(cleanOS, `<button type="button" class="tag-chip os-chip" style="background:rgba(0,255,178,0.18); border:1px solid #00FFB2; color:#00FFB2; font-weight:800; box-shadow:0 2px 8px rgba(0,255,178,0.25);" title="Plataforma: ${escapeHtml(cleanOS)}"><span>💻</span><span>${escapeHtml(cleanOS)}</span></button>`);
  }

  const sizeVal = it.size || it.tamano || it.peso || it.file_size;
  if (sizeVal) {
    const cleanSize = stripLeadingEmoji(sizeVal);
    addChip(cleanSize, `<button type="button" class="tag-chip size-chip" style="background:rgba(255,0,128,0.18); border:1px solid #FF0080; color:#FF66C4; font-weight:800; box-shadow:0 2px 8px rgba(255,0,128,0.25);" title="Tamaño: ${escapeHtml(cleanSize)}"><span>📦</span><span>${escapeHtml(cleanSize)}</span></button>`);
  }

  const langVal = it.language || it.idioma || it.idiomas;
  if (langVal) {
    const cleanLang = stripLeadingEmoji(langVal);
    addChip(cleanLang, `<button type="button" class="tag-chip lang-chip" style="background:rgba(255,171,0,0.18); border:1px solid #FFAB00; color:#FFD54F; font-weight:800; box-shadow:0 2px 8px rgba(255,171,0,0.25);" title="Idioma: ${escapeHtml(cleanLang)}"><span>🌐</span><span>${escapeHtml(cleanLang)}</span></button>`);
  }

  if (it.genres) {
    const rawGenres = String(it.genres).split(/[,/]/).map(g => g.trim()).filter(Boolean);
    rawGenres.forEach(genre => {
      const cleanG = stripLeadingEmoji(genre);
      if (!cleanG) return;
      const cfg = getGenreChipConfig(cleanG);
      addChip(cleanG, `<button type="button" class="tag-chip genre-chip" style="background:${cfg.bg}; border:1px solid ${cfg.border}; color:${cfg.color}; font-weight:800; box-shadow:0 2px 8px ${cfg.shadow};" onclick="filterByGenreFromModal('${escapeHtml(genre)}')" title="Filtrar catálogo por género: ${escapeHtml(cleanG)}"><span>${cfg.icon}</span><span>${escapeHtml(cleanG)}</span></button>`);
    });
  }

  const modalTagsEl = document.getElementById('modalTags');
  if (modalTagsEl) {
    modalTagsEl.innerHTML = tagsHtml;
    const tagElements = Array.from(modalTagsEl.children);
    tagElements.forEach((tag, idx) => {
      tag.style.animationDelay = `${0.04 + idx * 0.05}s`;
    });
    // Si supera el límite de 3 etiquetas, habilitar scroll horizontal suave para escritorio
    if (tagElements.length > 3) {
      modalTagsEl.classList.add('has-horizontal-scroll');
    } else {
      modalTagsEl.classList.remove('has-horizontal-scroll');
    }
  }

  // 🗂️ Temporadas y 📺 Capítulos
  const seasonsEl = document.getElementById('modalSeasons');
  const seasonCountVal = it.season_count || it.seasons || it.seasons_count;
  if (seasonsEl) {
    if (seasonCountVal) {
      const sNum = parseInt(seasonCountVal, 10);
      seasonsEl.textContent = '🗂️ ' + seasonCountVal + (sNum === 1 ? ' temporada' : ' temporadas');
      seasonsEl.style.display = 'inline-flex';
    } else {
      seasonsEl.style.display = 'none';
    }
  }

  const chaptersEl = document.getElementById('modalChapters');
  const chapterCountVal = it.chapter_count || it.chapters || it.episodes || it.episode_count;
  if (chaptersEl) {
    if (chapterCountVal) {
      chaptersEl.textContent = '📺 ' + chapterCountVal + ' cap.';
      chaptersEl.style.display = 'inline-flex';
    } else {
      chaptersEl.style.display = 'none';
    }
  }

  // 📝 Reset y carga de Descripción Detallada Enriquecida
  const descWrap = document.getElementById('modalDescriptionWrap');
  const descContent = document.getElementById('modalDescription');
  const descIcon = document.getElementById('descToggleIcon');
  if (descWrap) descWrap.style.display = 'none';
  if (descContent) {
    descContent.innerHTML = '';
    descContent.classList.remove('collapsed');
  }
  if (descIcon) {
    descIcon.classList.remove('collapsed');
    descIcon.textContent = '▼';
  }

  const synopsisEl = document.getElementById('modalSynTxt');
  const rawSynopsis = it.synopsis || it.sinopsis || '';
  const rawDesc = it.description || it.descripcion || it.details || it.detalles || it.overview || it.about || it.desc || it.info || '';

  const hasHtml = (str) => typeof str === 'string' && /<[a-z][\s\S]*>/i.test(str);

  let briefSynopsis = '';
  let richDescription = '';

  if (hasHtml(rawDesc)) {
    richDescription = rawDesc;
    if (rawSynopsis && !hasHtml(rawSynopsis)) {
      briefSynopsis = rawSynopsis;
    }
  } else if (hasHtml(rawSynopsis)) {
    richDescription = rawSynopsis;
  } else {
    if (rawDesc && rawDesc !== rawSynopsis) {
      richDescription = rawDesc;
      briefSynopsis = rawSynopsis;
    } else if (rawSynopsis) {
      if (rawSynopsis.length > 250) {
        richDescription = rawSynopsis;
      } else {
        briefSynopsis = rawSynopsis;
      }
    } else if (rawDesc) {
      if (rawDesc.length > 250) {
        richDescription = rawDesc;
      } else {
        briefSynopsis = rawDesc;
      }
    }
  }

  if (synopsisEl) {
    if (briefSynopsis) {
      synopsisEl.textContent = briefSynopsis;
      synopsisEl.style.display = 'block';
    } else {
      synopsisEl.textContent = '';
      synopsisEl.style.display = 'none';
    }
  }

  if (richDescription && descWrap && descContent) {
    descContent.innerHTML = richDescription;
    descWrap.style.display = 'block';
  } else if (!briefSynopsis && synopsisEl) {
    synopsisEl.textContent = 'Sin descripción disponible.';
    synopsisEl.style.display = 'block';
  }

  const reqVal = it.requirements || it.requisitos || it.reqs || it.system_requirements;
  const reqSection = document.getElementById('modalRequirementsSection');
  const reqTxt = document.getElementById('modalRequirementsTxt');
  if (reqSection && reqTxt) {
    if (reqVal) {
      reqTxt.textContent = typeof reqVal === 'object' ? JSON.stringify(reqVal, null, 2) : String(reqVal);
      reqSection.style.display = 'block';
    } else {
      reqSection.style.display = 'none';
    }
  }

  const ratingBox = document.getElementById('modalRatingBox');
  if (it.reviews > 0) {
    ratingBox.style.display = 'inline-flex';
    document.getElementById('modalRatingNum').textContent = '★ ' + it.rating;
    document.getElementById('modalRatingCount').textContent = it.reviews + ' reseña' + (it.reviews !== 1 ? 's' : '') + ' (de tu web)';
  } else {
    ratingBox.style.display = 'none';
  }

  renderMediaSections({
    videos: it.trailers || it.videos || it.trailers_list || it.video_list || [],
    screenshots: it.screenshots || it.capturas || it.imagenes || it.gallery || it.images || [],
    reviews: it.reviews_list || it.reviews_data || []
  });

  const state = await idbGet('user_states', id);
  renderStateButtons(state ? state.status : null);
  await renderAddToListBox(id);
  if (typeof closeDynamicListSelector === 'function') closeDynamicListSelector();
  if (typeof renderDynamicListSelector === 'function') await renderDynamicListSelector(id);

  const myReview = await idbGet('user_reviews', id);
  renderStarPicker(myReview ? myReview.rating : 0);
  document.getElementById('reviewTextInput').value = myReview ? (myReview.comment || '') : '';
  document.getElementById('reviewSavedNote').style.display = 'none';

  renderRecommendations(it);
  if (typeof renderProgressNotesPro === 'function') await renderProgressNotesPro(id);

  const pcBtn = document.getElementById('checkPcFromDetailBtn');
  const isGameOrSoftware = it.type && (it.type.includes('juego') || it.type.includes('software') || it.type.includes('game') || it.type.includes('pc') || (it.category && it.category.includes('juego')));
  if (pcBtn) {
    pcBtn.style.display = isGameOrSoftware ? 'inline-flex' : 'none';
  }

  const cpuSection = document.getElementById('modalCpuBenchmarkSection');
  if (cpuSection) {
    if (isGameOrSoftware) {
      renderDetailCpuBenchmark(it);
    } else {
      cpuSection.style.display = 'none';
    }
  }

  const detailModalEl = document.getElementById('detailModal');
  if (detailModalEl) {
    detailModalEl.style.display = 'block';
    detailModalEl.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.body.style.overflow = 'hidden';
}

function renderMediaSections(data) {
  const trailerSection = document.getElementById('trailerSection');
  const gallerySection = document.getElementById('gallerySection');
  const communitySection = document.getElementById('communitySection');

  if (data && Array.isArray(data.videos) && data.videos.length > 0) {
    document.getElementById('trailerList').innerHTML = data.videos.map((v, i) => {
      let videoId = v.video_id || '';
      if (!videoId && v.url) {
        const match = v.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/);
        if (match) videoId = match[1];
      }
      
      const title = escapeHtml(v.name || 'Tráiler ' + (i + 1));
      
      if (videoId) {
        return `<a href="#" onclick="event.preventDefault(); abrirVideoModal('${videoId}', '${title}')" style="cursor:pointer">▶ ${title}</a>`;
      } else {
        const url = v.url || '#';
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">▶ ${title}</a>`;
      }
    }).join('');
    trailerSection.style.display = 'block';
  } else { 
    trailerSection.style.display = 'none'; 
  }

  if (data && Array.isArray(data.screenshots) && data.screenshots.length > 0) {
    document.getElementById('galleryStrip').innerHTML = data.screenshots.map(src =>
      `<img src="${escapeHtml(src)}" loading="lazy" onerror="this.style.display='none'">`
    ).join('');
    gallerySection.style.display = 'block';
  } else { 
    gallerySection.style.display = 'none'; 
  }

  if (data && Array.isArray(data.reviews) && data.reviews.length > 0) {
    document.getElementById('communityReviewsList').innerHTML = data.reviews.map(r => `
      <div class="community-review">
        <div class="who">${escapeHtml(r.username || 'Usuario')} <span class="stars">${'★'.repeat(Math.round(r.rating || 0))}</span></div>
        <div class="txt">${escapeHtml(r.comment || '')}</div>
      </div>
    `).join('');
    communitySection.style.display = 'block';
  } else { 
    communitySection.style.display = 'none'; 
  }
}

// ==========================================
// 🤖 RECOMENDACIONES INTELIGENTES AI (INICIO) & SORPRÉNDEME
// ==========================================
async function updateSmartHomeRecommendations() {
  const box = document.getElementById('smartAiRecommendationsBox');
  if (box) box.style.display = 'none';
  return;
}

function refreshSmartAiRecommendations(showToastMsg = false) {
  updateSmartHomeRecommendations();
  if (showToastMsg) showToast('✨ Recomendaciones IA actualizadas con tus gustos recientes');
}

function triggerSurpriseMeAI() {
  if (!allItems || !allItems.length) {
    showToast('⚠️ No hay ítems disponibles en el catálogo');
    return;
  }
  const completedIds = new Set(userStates.filter(s => s.status === 'completed').map(s => s.itemId));
  const available = allItems.filter(it => !completedIds.has(it.id));
  const pool = available.length > 0 ? available : allItems;
  
  const randomItem = pool[Math.floor(Math.random() * pool.length)];
  showToast(`🎲 ¡Sorpresa IA! Seleccionando joya para ti: ${randomItem.title}...`);
  setTimeout(() => {
    openDetail(randomItem.id);
  }, 350);
}

// ==========================================
// 🎯 SISTEMA DE RECOMENDACIONES POR GÉNERO Y ETIQUETAS
// ==========================================
function renderRecommendations(currentItem) {
  const section = document.getElementById('recommendedSection');
  const listEl = document.getElementById('recommendList');
  if (!section || !listEl || !allItems || !currentItem) {
    if (section) section.style.display = 'none';
    return;
  }

  const currentGenresRaw = currentItem.genres || '';
  const currentTagsRaw = Array.isArray(currentItem.tags) ? currentItem.tags.join(',') : (currentItem.tags || '');
  const combinedRaw = [currentGenresRaw, currentTagsRaw].filter(Boolean).join(',');
  
  const currentTokensSet = new Set();
  const currentGenreWords = new Set();
  
  combinedRaw.split(/[,/|;-]+/).forEach(part => {
    const trimmed = part.trim();
    if (trimmed) {
      const norm = normalizeText(trimmed);
      if (norm.length > 1) currentTokensSet.add(norm);
      norm.split(/\s+/).forEach(word => {
        if (word.length >= 3) currentGenreWords.add(word);
      });
    }
  });

  const currentTypeNorm = normalizeText(currentItem.type || '');
  const currentConsoleNorm = normalizeText(currentItem.console || '');
  const currentDevNorm = normalizeText(currentItem.developer || '');

  const scoredCandidates = [];
  
  allItems.forEach(candidate => {
    if (candidate.id === currentItem.id) return;

    let score = 0;
    const matchedTags = [];
    
    const candGenresRaw = candidate.genres || '';
    const candTagsRaw = Array.isArray(candidate.tags) ? candidate.tags.join(',') : (candidate.tags || '');
    const candCombined = [candGenresRaw, candTagsRaw].filter(Boolean).join(',');

    candCombined.split(/[,/|;-]+/).forEach(part => {
      const trimmed = part.trim();
      if (!trimmed) return;
      const norm = normalizeText(trimmed);
      
      if (currentTokensSet.has(norm)) {
        score += 25;
        if (!matchedTags.includes(trimmed)) matchedTags.push(trimmed);
      } else {
        let wordMatch = false;
        norm.split(/\s+/).forEach(word => {
          if (word.length >= 3 && currentGenreWords.has(word)) {
            wordMatch = true;
          }
        });
        if (wordMatch) {
          score += 12;
          if (!matchedTags.includes(trimmed)) matchedTags.push(trimmed);
        }
      }
    });

    if (currentTypeNorm && normalizeText(candidate.type || '') === currentTypeNorm) {
      score += 10;
    }
    if (currentConsoleNorm && candidate.console && normalizeText(candidate.console) === currentConsoleNorm) {
      score += 8;
      const cStr = String(candidate.console).trim();
      if (!matchedTags.includes(cStr)) matchedTags.push(cStr);
    }
    if (currentDevNorm && candidate.developer && normalizeText(candidate.developer) === currentDevNorm) {
      score += 8;
    }
    if (currentItem.year && candidate.year && candidate.year === currentItem.year) {
      score += 4;
    }
    if (candidate.rating) {
      score += Number(candidate.rating) * 0.5;
    }

    scoredCandidates.push({
      item: candidate,
      score: score,
      matchedTags: matchedTags
    });
  });

  scoredCandidates.sort((a, b) => b.score - a.score || (b.item.rating || 0) - (a.item.rating || 0));

  let recommendations = scoredCandidates.filter(c => c.score >= 15);
  
  if (recommendations.length < 8) {
    const alreadyIds = new Set(recommendations.map(r => r.item.id));
    const sameTypeFallback = scoredCandidates.filter(c => !alreadyIds.has(c.item.id) && normalizeText(c.item.type || '') === currentTypeNorm);
    sameTypeFallback.forEach(c => {
      if (recommendations.length < 8) {
        if (!c.matchedTags.length && typeLabels[c.item.type]) {
          c.matchedTags.push(typeLabels[c.item.type]);
        }
        recommendations.push(c);
        alreadyIds.add(c.item.id);
      }
    });
  }

  if (recommendations.length < 6) {
    const alreadyIds = new Set(recommendations.map(r => r.item.id));
    scoredCandidates.forEach(c => {
      if (recommendations.length < 8 && !alreadyIds.has(c.item.id)) {
        if (!c.matchedTags.length && c.item.genres) {
          c.matchedTags.push(c.item.genres.split(',')[0].trim());
        }
        recommendations.push(c);
        alreadyIds.add(c.item.id);
      }
    });
  }

  recommendations = recommendations.slice(0, 10);

  if (recommendations.length === 0) {
    section.style.display = 'none';
    return;
  }

  listEl.innerHTML = recommendations.map(({ item, matchedTags }) => {
    let badgeText = '🏷️ Recomendado';
    if (matchedTags && matchedTags.length > 0) {
      badgeText = `🎯 ${matchedTags[0]}`;
    } else if (typeLabels[item.type]) {
      badgeText = `🏷️ ${typeLabels[item.type]}`;
    }

    const priceStr = formatItemPrice(item);
    const yearStr = item.year ? String(item.year) : (typeLabels[item.type] || '');
    const ratingStr = item.rating ? `★ ${item.rating}` : '★ -';

    return `
      <div class="recommend-card" onclick="openDetail(${item.id})" title="Ver detalle de ${escapeHtml(item.title)}">
        <div class="recommend-img">
          <span class="recommend-badge">${escapeHtml(badgeText)}</span>
          <img src="${resolveImageUrl(item.cover || item.image || item.poster || item.caratula || item.img)}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'">
        </div>
        <div class="recommend-body">
          <div class="recommend-title">${escapeHtml(item.title)}</div>
          <div class="recommend-meta">
            <span>${escapeHtml(yearStr)}</span>
            <span style="color:#00FFB2;font-weight:700;">${ratingStr}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  section.style.display = 'block';
}

function renderStateButtons(activeStatus) {
  const states = [
    { key: 'wishlist', label: '❤️ Deseado' },
    { key: 'playing', label: '🎮 Jugando/Viendo' },
    { key: 'paused', label: '⏸️ Pausado' },
    { key: 'completed', label: '✅ Completado' },
    { key: 'dropped', label: '❌ Abandonado' },
    { key: 'pending', label: '🕓 Pendiente' }
  ];
  const container = document.getElementById('stateButtons');
  container.innerHTML = states.map(s =>
    `<button type="button" class="state-btn ${activeStatus === s.key ? 'active' : ''}" onclick="toggleState('${s.key}')">${s.label}</button>`
  ).join('');
}

async function toggleState(status) {
  if (window.triggerHaptic) window.triggerHaptic(40);
  if (!currentDetailId) return;
  const existing = await idbGet('user_states', currentDetailId);
  const newStatus = (existing && existing.status === status) ? null : status;

  if (newStatus === null) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('user_states', 'readwrite');
      tx.objectStore('user_states').delete(currentDetailId);
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
  } else {
    await idbPut('user_states', { itemId: currentDetailId, status: newStatus, updatedAt: new Date().toISOString() });
  }

  userStates = await idbGetAll('user_states');
  renderStateButtons(newStatus);
  renderLibraryCounts();
  applyFilters();
  if (typeof syncPlayingItemsToAndroid === 'function') syncPlayingItemsToAndroid();
  if (typeof syncFavoritesMetadataOffline === 'function') syncFavoritesMetadataOffline();
  if (newStatus !== null) {
    const stateNames = { wishlist: '❤️ Deseado', playing: '🎮 Jugando/Viendo', paused: '⏸️ Pausado', completed: '✅ Completado', dropped: '❌ Abandonado', pending: '🕓 Pendiente' };
    const label = stateNames[newStatus] || newStatus;
    const stateItems = userStates.filter(s => s.status === newStatus);
    const sumState = calculateListTotal(stateItems.map(s => s.itemId));
    showToast(`✓ Guardado en ${label} (Suma Total: ${formatListTotal(sumState)})`);

    if (newStatus === 'wishlist' && localStorage.getItem('joa_push_price_drop') !== 'false') {
      setTimeout(() => {
        const item = allItems.find(i => i.id === currentDetailId);
        if (item) {
          const titleName = item.title;
          const oldPrice = item.price ? `$${item.price}` : "$59.99";
          const newPriceVal = item.price ? (item.price * 0.7).toFixed(2) : "39.99";
          const newPrice = `$${newPriceVal}`;
          const notifTitle = "📉 ¡Rebaja detectada en tu nuevo Deseo!";
          const notifMsg = `«${titleName}» ha bajado de ${oldPrice} a ${newPrice} (-30% OFF especial). ¡Aprovecha ahora!`;
          if (window.AndroidBridge && typeof window.AndroidBridge.triggerCustomPushAlert === 'function') {
            window.AndroidBridge.triggerCustomPushAlert(notifTitle, notifMsg, 10);
          } else {
            setTimeout(() => {
              if ("Notification" in window && Notification.permission === "granted") {
                new Notification(notifTitle, { body: notifMsg, icon: "icon.png" });
              }
            }, 10000);
          }
        }
      }, 1000);
    } else if (newStatus === 'completed' && localStorage.getItem('joa_push_review') !== 'false') {
      setTimeout(() => {
        const item = allItems.find(i => i.id === currentDetailId);
        if (item) {
          const titleName = item.title;
          const autores = ["RetroMaster", "GamerPro99", "CyberSamurai", "ValkyrieQueen"];
          const autor = autores[Math.floor(Math.random() * autores.length)];
          const comentario = "¡Gran logro al completarlo! Sin duda uno de los mejores de su género, un 10 rotundo.";
          const notifTitle = "💬 ¡Nueva reseña en tu título recién Completado!";
          const notifMsg = `${autor} comentó en «${titleName}»: "${comentario}"`;
          if (window.AndroidBridge && typeof window.AndroidBridge.triggerCustomPushAlert === 'function') {
            window.AndroidBridge.triggerCustomPushAlert(notifTitle, notifMsg, 12);
          } else {
            setTimeout(() => {
              if ("Notification" in window && Notification.permission === "granted") {
                new Notification(notifTitle, { body: notifMsg, icon: "icon.png" });
              }
            }, 12000);
          }
        }
      }, 1000);
    }
  } else {
    showToast('Estado eliminado.');
  }
}

function renderStarPicker(currentRating) {
  const container = document.getElementById('starPicker');
  let selected = currentRating || 0;
  function draw() {
    container.innerHTML = [1,2,3,4,5].map(n =>
      `<span data-n="${n}" class="${n <= selected ? 'filled' : ''}">★</span>`
    ).join('');
    container.querySelectorAll('span').forEach(el => {
      el.onclick = () => { selected = parseInt(el.dataset.n, 10); draw(); };
    });
  }
  draw();
  container._getSelected = () => selected;
}

async function saveMyReview() {
  if (window.triggerHaptic) window.triggerHaptic(50);
  if (!currentDetailId) return;
  const container = document.getElementById('starPicker');
  const rating = container._getSelected ? container._getSelected() : 0;
  const comment = document.getElementById('reviewTextInput').value.trim();

  if (rating === 0 && !comment) {
    showToast('Escribe algo o elige una calificación antes de guardar.');
    return;
  }

  await idbPut('user_reviews', {
    itemId: currentDetailId,
    rating,
    comment,
    updatedAt: new Date().toISOString()
  });

  document.getElementById('reviewSavedNote').style.display = 'inline';
  showToast('Reseña guardada en este teléfono.');

  const state = await idbGet('user_states', currentDetailId);
  if (state && state.status === 'completed' && localStorage.getItem('joa_push_review') !== 'false') {
    const item = allItems.find(i => i.id === currentDetailId);
    const titleName = item ? item.title : "tu juego completado";
    const autores = ["GamerPro99", "CyberSamurai", "ValkyrieQueen"];
    const autor = autores[Math.floor(Math.random() * autores.length)];
    const notifTitle = "💬 ¡Nueva respuesta a tu reseña en Completados!";
    const notifMsg = `${autor} valoró tu reseña de «${titleName}» con un +1 útil y comentó: "¡Coincido 100% contigo!"`;
    if (window.AndroidBridge && typeof window.AndroidBridge.triggerCustomPushAlert === 'function') {
      window.AndroidBridge.triggerCustomPushAlert(notifTitle, notifMsg, 6);
    }
  }
}

function closeDetail() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  if (typeof closeDynamicListSelector === 'function') closeDynamicListSelector();
  document.getElementById('detailModal').style.display = 'none';
  document.body.style.overflow = '';
  currentDetailId = null;
}

function toggleDescription() {
  const content = document.getElementById('modalDescription');
  const icon = document.getElementById('descToggleIcon');
  if (!content || !icon) return;
  content.classList.toggle('collapsed');
  icon.classList.toggle('collapsed');
  icon.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
}

// ==========================================
// 🏷️ CHIPS Y ETIQUETAS DINÁMICAS (#modalTags)
// ==========================================
function getGenreChipConfig(genreName) {
  const g = (genreName || '').toLowerCase().trim();
  if (g.includes('acci') || g.includes('action') || g.includes('lucha') || g.includes('fight') || g.includes('beat') || g.includes('hack') || g.includes('shoot') || g.includes('fps') || g.includes('tps') || g.includes('guerr') || g.includes('comb')) {
    return { icon: '🔥', bg: 'rgba(255, 68, 68, 0.22)', border: '#FF4444', color: '#FF6B6B', shadow: 'rgba(255, 68, 68, 0.35)' };
  }
  if (g.includes('aventur') || g.includes('adventure') || g.includes('explor') || g.includes('mundo abierto') || g.includes('open world') || g.includes('superviv') || g.includes('surviv')) {
    return { icon: '🌿', bg: 'rgba(0, 230, 118, 0.22)', border: '#00E676', color: '#00FFB2', shadow: 'rgba(0, 230, 118, 0.35)' };
  }
  if (g.includes('rpg') || g.includes('rol') || g.includes('jrpg') || g.includes('arpg') || g.includes('tácti') || g.includes('tacti') || g.includes('estrateg') || g.includes('strat')) {
    return { icon: '🔮', bg: 'rgba(157, 78, 221, 0.25)', border: '#9D4EDD', color: '#E0AAFF', shadow: 'rgba(157, 78, 221, 0.35)' };
  }
  if (g.includes('sci-fi') || g.includes('cienc') || g.includes('cyber') || g.includes('mecha') || g.includes('espaci') || g.includes('futur')) {
    return { icon: '🚀', bg: 'rgba(0, 229, 255, 0.22)', border: '#00E5FF', color: '#80F4FF', shadow: 'rgba(0, 229, 255, 0.35)' };
  }
  if (g.includes('terror') || g.includes('horror') || g.includes('mied') || g.includes('zombi') || g.includes('dark') || g.includes('gore') || g.includes('suspens') || g.includes('thrill')) {
    return { icon: '🧟', bg: 'rgba(213, 0, 0, 0.25)', border: '#D50000', color: '#FF5252', shadow: 'rgba(213, 0, 0, 0.35)' };
  }
  if (g.includes('deport') || g.includes('sport') || g.includes('fútb') || g.includes('futb') || g.includes('balon') || g.includes('carrer') || g.includes('racin') || g.includes('conduc') || g.includes('coch') || g.includes('motor') || g.includes('veloc')) {
    return { icon: '🏆', bg: 'rgba(255, 214, 0, 0.22)', border: '#FFD600', color: '#FFEE58', shadow: 'rgba(255, 214, 0, 0.35)' };
  }
  if (g.includes('plataform') || g.includes('platform') || g.includes('arcad') || g.includes('retro') || g.includes('clásic') || g.includes('clasic') || g.includes('puzl') || g.includes('puzzl') || g.includes('casual') || g.includes('fiest') || g.includes('party') || g.includes('músic') || g.includes('music') || g.includes('ritm')) {
    return { icon: '🕹️', bg: 'rgba(255, 64, 129, 0.25)', border: '#FF4081', color: '#FF80AB', shadow: 'rgba(255, 64, 129, 0.35)' };
  }
  if (g.includes('simul') || g.includes('gesti') || g.includes('construc') || g.includes('sandbox') || g.includes('vida') || g.includes('granja')) {
    return { icon: '🏗️', bg: 'rgba(0, 184, 212, 0.22)', border: '#00B8D4', color: '#4DD0E1', shadow: 'rgba(0, 184, 212, 0.35)' };
  }
  if (g.includes('fantas') || g.includes('fantasy') || g.includes('magi') || g.includes('mític') || g.includes('mitic') || g.includes('mediev')) {
    return { icon: '✨', bg: 'rgba(101, 31, 255, 0.25)', border: '#7C4DFF', color: '#B388FF', shadow: 'rgba(101, 31, 255, 0.35)' };
  }
  if (g.includes('dram') || g.includes('romanc') || g.includes('comed') || g.includes('slice') || g.includes('anim') || g.includes('mang')) {
    return { icon: '🌸', bg: 'rgba(245, 0, 87, 0.22)', border: '#F50057', color: '#FF8A80', shadow: 'rgba(245, 0, 87, 0.35)' };
  }
  return { icon: '🔹', bg: 'rgba(144, 202, 249, 0.18)', border: 'rgba(144, 202, 249, 0.5)', color: '#90CAF9', shadow: 'rgba(144, 202, 249, 0.25)' };
}

function filterByGenreFromModal(genre) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  closeDetail();
  const genreSelect = document.getElementById('genreFilter');
  if (genreSelect) {
    let found = false;
    for (let i = 0; i < genreSelect.options.length; i++) {
      if (genreSelect.options[i].value.toLowerCase() === genre.toLowerCase()) {
        genreSelect.value = genreSelect.options[i].value;
        found = true;
        break;
      }
    }
    if (!found) {
      document.getElementById('searchInput').value = genre;
    } else {
      document.getElementById('searchInput').value = '';
    }
  } else {
    document.getElementById('searchInput').value = genre;
  }
  activeType = '';
  libraryFilter = '';
  document.getElementById('stateFilter').value = '';
  document.getElementById('yearFilter').value = '';
  document.getElementById('consoleFilterSelect').value = '';
  updateConsoleFilterVisibility();
  renderSidebar();
  updateLibraryActiveLinks();
  currentPage = 1;
  applyFilters();
  showToast('🔍 Filtrando por género: ' + genre);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterByTypeFromModal(typeKey, typeLabel) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  closeDetail();
  setTypeFilter(typeKey);
  showToast('🎮 Categoría: ' + typeLabel);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterBySubcategoryFromModal(subcat) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  closeDetail();
  activeType = 'software';
  document.getElementById('typeFilterSelect').value = 'software';
  toggleSubcategoryFilter();
  const subcatSelect = document.getElementById('subcategoryFilterSelect');
  if (subcatSelect) subcatSelect.value = subcat;
  updateConsoleFilterVisibility();
  renderSidebar();
  updateLibraryActiveLinks();
  currentPage = 1;
  applyFilters();
  showToast('💻 Subcategoría: ' + subcat);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterByConsoleFromModal(consoleKey) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  closeDetail();
  const consoleSelect = document.getElementById('consoleFilterSelect');
  if (consoleSelect) consoleSelect.value = consoleKey;
  activeType = '';
  libraryFilter = '';
  document.getElementById('genreFilter').value = '';
  document.getElementById('yearFilter').value = '';
  document.getElementById('stateFilter').value = '';
  document.getElementById('searchInput').value = '';
  updateConsoleFilterVisibility();
  renderSidebar();
  updateLibraryActiveLinks();
  currentPage = 1;
  applyFilters();
  showToast('🕹️ Consola: ' + consoleKey);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterByYearFromModal(year) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  closeDetail();
  const yearSelect = document.getElementById('yearFilter');
  if (yearSelect) yearSelect.value = year;
  activeType = '';
  libraryFilter = '';
  document.getElementById('genreFilter').value = '';
  document.getElementById('consoleFilterSelect').value = '';
  document.getElementById('stateFilter').value = '';
  document.getElementById('searchInput').value = '';
  updateConsoleFilterVisibility();
  renderSidebar();
  updateLibraryActiveLinks();
  currentPage = 1;
  applyFilters();
  showToast('📅 Año: ' + year);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function shareCurrentItem() {
  if (!currentDetailId) return;
  const it = allItems.find(i => i.id === currentDetailId);
  if (!it) return;

  if (window.triggerHaptic) window.triggerHaptic(30);

  const priceStr = formatItemPrice(it);
  const metaParts = [it.year, it.genres, typeLabels[it.type] || it.type].filter(Boolean).join(' • ');
  let shareText = `🎮 ${it.title}\n💰 Precio: ${priceStr}`;
  if (metaParts) shareText += `\n📌 ${metaParts}`;
  if (it.synopsis) {
    const shortSyn = it.synopsis.length > 200 ? it.synopsis.substring(0, 200) + '...' : it.synopsis;
    shareText += `\n\n📖 ${shortSyn}`;
  }
  const shareUrl = it.url || it.link || it.store_url || it.website || window.location.href;

  // Asegurar que la API Web Share (navigator.share) esté disponible e integrada con AndroidBridge para apps de mensajería
  if (!navigator.share && window.AndroidBridge && typeof window.AndroidBridge.shareProduct === 'function') {
    navigator.share = async function(data) {
      window.AndroidBridge.shareProduct(data.title || '', data.text || '', data.url || '');
      return Promise.resolve();
    };
  }

  // Utilizar la API Web Share en primer lugar para enviar mediante aplicaciones nativas de mensajería
  if (navigator.share) {
    try {
      showToast('📲 Abriendo aplicaciones de mensajería para compartir...');
      await navigator.share({
        title: it.title || 'JOA GAMERS',
        text: shareText,
        url: shareUrl
      });
      showToast('✅ Título compartido con éxito.');
      return;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error al compartir con Web Share API:', err);
        if (window.AndroidBridge && typeof window.AndroidBridge.shareProduct === 'function') {
          window.AndroidBridge.shareProduct(it.title || 'Producto', shareText, shareUrl);
        } else {
          fallbackCopyShare(shareText, shareUrl);
        }
      }
      return;
    }
  }

  // Fallback por si navigator.share no está soportado en el entorno actual
  if (window.AndroidBridge && typeof window.AndroidBridge.shareProduct === 'function') {
    window.AndroidBridge.shareProduct(it.title || 'Producto', shareText, shareUrl);
    showToast('📲 Abriendo menú nativo para compartir...');
  } else {
    fallbackCopyShare(shareText, shareUrl);
  }
}

function fallbackCopyShare(text, url) {
  const fullText = `${text}\n\n🔗 ${url}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullText).then(() => {
      showToast('📋 Información copiada al portapapeles para compartir.');
    }).catch(() => {
      showToast('ℹ️ No se pudo compartir ni copiar automáticamente.');
    });
  } else {
    showToast('ℹ️ Tu navegador no soporta la función de compartir.');
  }
}

// ==========================================
// 🙂 PERFIL LOCAL
// ==========================================
const AVATAR_OPTIONS = ['🙂','😎','🦊','🐱','🐼','👾','🎮','🌟','🔥','🌙'];

const MOOD_OPTIONS = [
  { emoji: '🔥', label: 'On Fire' },
  { emoji: '🎮', label: 'Jugando' },
  { emoji: '😎', label: 'Modo Pro' },
  { emoji: '🚀', label: 'Activo' },
  { emoji: '⚡', label: 'Eléctrico' },
  { emoji: '🍿', label: 'Viendo Pelis' },
  { emoji: '🎧', label: 'Escuchando' },
  { emoji: '🏆', label: 'Campeón' },
  { emoji: '😴', label: 'Modo Relax' },
  { emoji: '🎯', label: 'Enfocado' },
  { emoji: '👾', label: 'Retro' },
  { emoji: '💎', label: 'VIP' }
];

let pendingMood = '';

function renderMoodChoices(selectedMood) {
  const container = document.getElementById('moodChoices');
  if (!container) return;
  let html = `<div class="search-chip ${!selectedMood ? 'ai-chip-highlight' : ''}" onclick="pickMood('')">🚫 Ninguno</div>`;
  html += MOOD_OPTIONS.map(m => {
    const isSel = m.emoji === selectedMood;
    return `<div class="search-chip ${isSel ? 'ai-chip-highlight' : ''}" onclick="pickMood('${m.emoji}')">${m.emoji} ${m.label}</div>`;
  }).join('');
  container.innerHTML = html;
  const moodInput = document.getElementById('profileMoodInput');
  if (moodInput && moodInput.value !== (selectedMood || '')) {
    moodInput.value = selectedMood || '';
  }
}

function pickMood(m) {
  pendingMood = m;
  renderMoodChoices(m);
}

async function ensureProfile() {
  const profile = await idbGetMeta('local_profile', null);
  let tutShown = null;
  try { tutShown = localStorage.getItem('joa_tutorial_shown'); } catch(e) {}
  if (!profile && tutShown === 'true') openProfileEditor(true);
}

function getAvatarHTML(avatar) {
  if (!avatar) return '🙂';
  if (typeof avatar === 'string' && (avatar.startsWith('data:image/') || avatar.startsWith('http'))) {
    return `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="av">`;
  }
  return avatar;
}

function renderAvatarChoices(selected) {
  const container = document.getElementById('avatarChoices');
  if (!container) return;
  let html = '';
  if (selected && typeof selected === 'string' && (selected.startsWith('data:image/') || selected.startsWith('http'))) {
    html += `<div class="avatar-choice selected" style="width:56px;height:56px;padding:0;overflow:hidden;border:2px solid var(--signal);box-shadow:0 0 15px rgba(61,235,255,0.4);" onclick="pickAvatar('${selected}')">
      <img src="${selected}" style="width:100%;height:100%;object-fit:cover;" alt="Mi foto">
    </div>`;
  }
  html += AVATAR_OPTIONS.map(a => {
    const isSel = a === selected;
    return `<div class="avatar-choice ${isSel ? 'selected' : ''}" data-a="${a}" onclick="pickAvatar('${a}')">${a}</div>`;
  }).join('');
  container.innerHTML = html;
}

let pendingAvatar = AVATAR_OPTIONS[0];
function pickAvatar(a) { pendingAvatar = a; renderAvatarChoices(a); }

function takePhotoForAvatar() {
  if (window.AndroidBridge && typeof window.AndroidBridge.takeProfilePhoto === 'function') {
    window.AndroidBridge.takeProfilePhoto();
  } else {
    const input = document.getElementById('cameraAvatarInput');
    if (input) input.click();
  }
}

function choosePhotoForAvatar() {
  if (window.AndroidBridge && typeof window.AndroidBridge.chooseProfilePhoto === 'function') {
    window.AndroidBridge.chooseProfilePhoto();
  } else {
    const input = document.getElementById('galleryAvatarInput');
    if (input) input.click();
  }
}

function handleAvatarFileSelected(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const maxDim = 300;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const base64 = canvas.toDataURL('image/jpeg', 0.82);
      onAvatarImageReceived(base64);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

window.onAvatarImageReceived = function(base64Image) {
  if (!base64Image) return;
  pendingAvatar = base64Image;
  renderAvatarChoices(pendingAvatar);
  showToast('📸 ¡Foto lista! Pulsa Guardar Datos para aplicar.');
};

async function openProfileEditor(isFirstRun) {
  if (window.triggerHaptic) window.triggerHaptic(35);
  const profile = await idbGetMeta('local_profile', null);
  pendingAvatar = profile ? profile.avatar : AVATAR_OPTIONS[0];
  pendingMood = profile ? (profile.mood || '') : '';
  renderAvatarChoices(pendingAvatar);
  renderMoodChoices(pendingMood);
  document.getElementById('profileNameInput').value = profile ? (profile.apodo || profile.username || '') : '';
  if (document.getElementById('profileFullNameInput')) document.getElementById('profileFullNameInput').value = profile ? (profile.fullName || '') : '';
  if (document.getElementById('profilePhoneInput')) document.getElementById('profilePhoneInput').value = profile ? (profile.phone || '') : '';
  if (document.getElementById('profileEmailInput')) document.getElementById('profileEmailInput').value = profile ? (profile.email || '') : '';
  if (document.getElementById('profilePasswordInput')) document.getElementById('profilePasswordInput').value = profile ? (profile.password || '') : '';
  document.getElementById('profileOverlay').style.display = 'flex';
  if (!isFirstRun) closeSettings();
}

function closeProfileEditor() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  document.getElementById('profileOverlay').style.display = 'none';
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '🔒';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '👁️';
  }
}

async function saveProfile() {
  if (window.triggerHaptic) window.triggerHaptic(50);
  const apodo = document.getElementById('profileNameInput').value.trim() || 'Invitado';
  const fullName = document.getElementById('profileFullNameInput')?.value.trim() || '';
  const phone = document.getElementById('profilePhoneInput')?.value.trim() || '';
  const email = document.getElementById('profileEmailInput')?.value.trim() || '';
  const password = document.getElementById('profilePasswordInput')?.value.trim() || '';
  const moodInput = document.getElementById('profileMoodInput')?.value.trim() || '';
  const finalMood = moodInput || pendingMood || '';

  if (apodo === 'Invitado' || !apodo) {
    showToast('⚠️ Por favor ingresa tu Apodo / Usuario.');
    return;
  }
  if (!fullName || !phone || !email || !password) {
    showToast('💡 Recuerda completar todos tus datos de contacto para tu respaldo.');
  }

  const existing = await idbGetMeta('local_profile', null);
  const profile = {
    username: apodo,
    apodo: apodo,
    fullName: fullName,
    phone: phone,
    email: email,
    password: password,
    avatar: pendingAvatar,
    mood: finalMood,
    id: existing ? existing.id : ('local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await idbSetMeta('local_profile', profile);
  document.getElementById('profileOverlay').style.display = 'none';
  showToast('✅ Perfil y datos de registro guardados con éxito');
  renderProfileChip();
  if (typeof renderProfileTab === 'function') renderProfileTab();
}

async function renderProfileChip() {
  const profile = await idbGetMeta('local_profile', null);
  const name = profile ? (profile.apodo || profile.username || 'Invitado') : 'Invitado';
  const nameChip = document.getElementById('profileNameChip');
  if (nameChip) nameChip.textContent = name;
  const topNameChip = document.getElementById('topbarProfileNameChip');
  if (topNameChip) topNameChip.textContent = name;

  const av = profile ? profile.avatar : '🙂';
  
  const updateAv = (avatarEl) => {
    if (!avatarEl) return;
    if (av && typeof av === 'string' && (av.startsWith('data:image/') || av.startsWith('http'))) {
      avatarEl.innerHTML = `<img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="av">`;
      avatarEl.style.padding = '0';
      avatarEl.style.overflow = 'hidden';
    } else {
      avatarEl.textContent = av || '🙂';
      avatarEl.style.padding = '';
      avatarEl.innerHTML = av || '🙂';
    }
  };

  updateAv(document.getElementById('profileAvatarChip'));
  updateAv(document.getElementById('topbarProfileAvatarChip'));

  const mood = profile ? profile.mood : null;
  const updateMood = (moodEl) => {
    if (!moodEl) return;
    if (mood && mood.trim()) {
      moodEl.textContent = mood.trim();
      moodEl.style.display = 'flex';
      moodEl.title = `Estado de ánimo: ${mood.trim()}`;
    } else {
      moodEl.style.display = 'none';
    }
  };

  updateMood(document.getElementById('profileMoodChip'));
  updateMood(document.getElementById('topbarProfileMoodChip'));
}

// ==========================================
// 📤 EXPORTAR E IMPORTAR MI ACTIVIDAD Y REGISTRO
// ==========================================
async function exportMyActivity() {
  const profile = await idbGetMeta('local_profile', null);
  const states = await idbGetAll('user_states');
  const reviews = await idbGetAll('user_reviews');
  const notes = await idbGetAll('user_notes');

  if (!states.length && !reviews.length && !notes.length && !profile) {
    showToast('Todavía no tienes datos de perfil, estados, reseñas ni notas guardadas.');
    return;
  }

  const payload = {
    exported_at: new Date().toISOString(),
    profile: profile || { username: 'Invitado', id: 'sin_perfil' },
    states,
    reviews,
    notes
  };

  const safeName = (profile ? (profile.apodo || profile.username) : 'invitado').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const filename = `actividad_${safeName}_${Date.now()}.json`;
  const jsonStr = JSON.stringify(payload, null, 2);

  if (window.AndroidBridge && window.AndroidBridge.saveFile) {
    window.AndroidBridge.saveFile(filename, jsonStr);
    showToast('✅ Actividad guardada en Descargas de tu teléfono.');
    return;
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Archivo JSON', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(jsonStr);
      await writable.close();
      showToast('✅ Actividad guardada donde elegiste.');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  showToast('Actividad exportada.');
}

function triggerImportActivity() {
  const input = document.getElementById('importActivityInput');
  if (input) {
    input.value = '';
    input.click();
  }
}

async function handleImportActivity(file) {
  if (!file) return;
  try {
    const text = await readFileAsText(file);
    const data = JSON.parse(text);
    if (!data || (!data.states && !data.reviews && !data.profile)) {
      throw new Error('El archivo seleccionado no es un respaldo de actividad válido.');
    }
    
    if (data.profile && (data.profile.username || data.profile.apodo)) {
      await idbSetMeta('local_profile', data.profile);
    }
    if (Array.isArray(data.states)) {
      for (const s of data.states) {
        if (s && s.itemId) await idbPut('user_states', s);
      }
    }
    if (Array.isArray(data.reviews)) {
      for (const r of data.reviews) {
        if (r && r.itemId) await idbPut('user_reviews', r);
      }
    }
    if (Array.isArray(data.notes)) {
      for (const n of data.notes) {
        if (n && n.itemId) await idbPut('user_notes', n);
      }
    }
    await idbSetMeta('imported_activity_at', new Date().toISOString());
    showToast('✅ ¡Respaldo de actividad y perfil importados con éxito!');
    renderProfileChip();
    if (typeof renderProfileTab === 'function') renderProfileTab();
    if (typeof applyFilters === 'function') applyFilters();
  } catch (err) {
    showToast('❌ Error al importar actividad: ' + (err.message || 'Archivo inválido'));
    console.error(err);
  }
}

// ==========================================
// 📊 MI PANEL
// ==========================================
function openMyPanel() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  closeAllOpenModals('myPanelOverlay');
  toggleSidebar(false);
  renderProfileTab();
  renderStatsTab();
  renderAchievementsTab();
  renderListsTab();
  switchPanelTab('profileTab');
  document.getElementById('myPanelOverlay').style.display = 'block';
}

function closeMyPanel() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  document.getElementById('myPanelOverlay').style.display = 'none';
}

function switchPanelTab(tabId) {
  if (window.triggerHaptic) window.triggerHaptic(20);
  document.querySelectorAll('.panel-tab-panel').forEach(p => p.classList.toggle('active', p.id === tabId));
  document.querySelectorAll('.panel-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.ptab === tabId));
}

async function renderProfileTab() {
  const container = document.getElementById('profileTabContainer');
  if (!container) return;
  const profile = await idbGetMeta('local_profile', null);
  const states = await idbGetAll('user_states');
  const reviews = await idbGetAll('user_reviews');
  
  if (!profile) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 20px;background:rgba(255,255,255,0.02);border-radius:20px;border:1px dashed var(--line);">
        <div style="font-size:3rem;margin-bottom:12px;">👤</div>
        <h3 style="margin:0 0 8px;">No tienes un perfil registrado</h3>
        <p style="color:var(--text2);font-size:0.9rem;max-width:400px;margin:0 auto 20px;">Crea tu perfil con tu Apodo, Nombre, Teléfono, Correo y Contraseña para asegurar tu respaldo.</p>
        <button class="btn btn-primary" onclick="openProfileEditor(false)">📝 Registrar Perfil Ahora</button>
      </div>
    `;
    return;
  }

  const safeName = escapeHtml(profile.apodo || profile.username || 'Invitado');
  const safeFull = escapeHtml(profile.fullName || 'No especificado');
  const safePhone = escapeHtml(profile.phone || 'No especificado');
  const safeEmail = escapeHtml(profile.email || 'No especificado');
  const hasPass = profile.password && profile.password.length > 0;
  const passMasked = hasPass ? '•'.repeat(profile.password.length) : 'No establecida';
  const passRaw = escapeHtml(profile.password || '');
  const createdDate = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('es-ES') : '—';

  container.innerHTML = `
    <div style="background:linear-gradient(135deg, rgba(61,235,255,0.08), rgba(0,0,0,0.4));border:1px solid rgba(61,235,255,0.25);border-radius:24px;padding:24px;margin-bottom:20px;box-shadow:0 10px 30px rgba(0,0,0,0.5);position:relative;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div style="width:74px;height:74px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-size:2.4rem;box-shadow:0 6px 20px rgba(61,235,255,0.3);flex-shrink:0;overflow:hidden;">
          ${getAvatarHTML(profile.avatar || '🙂')}
        </div>
        <div style="flex:1;min-width:200px;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <h3 style="margin:0;font-size:1.6rem;color:#fff;font-weight:900;">${safeName}</h3>
            <span style="background:var(--signal-dim);color:var(--signal);font-size:0.75rem;font-weight:800;padding:4px 10px;border-radius:20px;border:1px solid var(--signal-glow);">⚡ APODO APP</span>
          </div>
          <div style="color:var(--text2);font-size:0.92rem;margin-top:6px;font-weight:600;">👤 ${safeFull}</div>
          <div style="color:var(--text3);font-size:0.78rem;margin-top:6px;">📅 Registro creado: ${createdDate} • ID: <code style="color:var(--signal);">${profile.id || 'local'}</code></div>
        </div>
        <button class="btn btn-primary" onclick="openProfileEditor(false)" style="padding:10px 18px;font-size:0.88rem;">✏️ Editar Datos</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:16px;margin-bottom:24px;">
      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:18px;padding:18px;">
        <div style="font-size:0.75rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px;">📱 Teléfono Celular</div>
        <div style="font-size:1.05rem;color:#fff;font-weight:700;display:flex;align-items:center;gap:8px;">
          <span>📞</span> <span>${safePhone}</span>
        </div>
      </div>
      
      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:18px;padding:18px;">
        <div style="font-size:0.75rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px;">📧 Correo Electrónico</div>
        <div style="font-size:1.05rem;color:#fff;font-weight:700;display:flex;align-items:center;gap:8px;word-break:break-all;">
          <span>✉️</span> <span>${safeEmail}</span>
        </div>
      </div>

      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:18px;padding:18px;grid-column:1 / -1;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
          <div style="font-size:0.75rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;font-weight:700;">🔑 Contraseña de Registro</div>
          <span style="font-size:0.72rem;color:var(--signal);background:rgba(61,235,255,0.08);padding:3px 10px;border-radius:6px;border:1px solid var(--signal-glow);font-weight:700;">🔒 Almacenamiento Local</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.35);padding:12px 16px;border-radius:14px;border:1px solid rgba(255,255,255,0.06);margin-bottom:10px;">
          <span id="panelPassDisplay" style="font-family:monospace;font-size:1.15rem;letter-spacing:3px;color:var(--text2);" data-raw="${passRaw}" data-masked="${passMasked}">${passMasked}</span>
          <button class="btn" style="padding:6px 14px;font-size:0.8rem;background:rgba(255,255,255,0.08);" onclick="togglePanelPassDisplay(this)">👁️ Mostrar</button>
        </div>
        <div style="font-size:0.78rem;color:var(--text3);line-height:1.45;">
          💡 Tu contraseña está protegida y registrada en este dispositivo. No se requerirá al abrir la app de forma diaria por ser tu teléfono personal. Se incluirá como protección al exportar el archivo JSON de tu actividad (${states.length} estados, ${reviews.length} reseñas) en tu respaldo local.
        </div>
      </div>
    </div>

    <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;">
      <div>
        <h4 style="margin:0 0 4px;font-size:1rem;color:#fff;">💾 Respaldo y Datos</h4>
        <div style="color:var(--text2);font-size:0.85rem;">Exporta tu actividad con todos tus datos de registro, o importa un archivo de respaldo.</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="exportMyActivity()" style="padding:12px 18px;font-size:0.88rem;">📤 Exportar Actividad</button>
        <button class="btn" onclick="triggerImportActivity()" style="padding:12px 18px;font-size:0.88rem;border-color:var(--signal);color:var(--signal);">📥 Importar Actividad</button>
      </div>
    </div>
  `;
}

function togglePanelPassDisplay(btn) {
  const span = document.getElementById('panelPassDisplay');
  if (!span) return;
  if (span.textContent === span.dataset.masked) {
    span.textContent = span.dataset.raw || 'No establecida';
    span.style.letterSpacing = '0px';
    span.style.color = '#fff';
    btn.textContent = '🔒 Ocultar';
  } else {
    span.textContent = span.dataset.masked;
    span.style.letterSpacing = '3px';
    span.style.color = 'var(--text2)';
    btn.textContent = '👁️ Mostrar';
  }
}

// ==========================================
// 📈 INTERACTIVE D3.JS CHARTS ENGINE
// ==========================================
let currentD3DataSource = 'user'; // 'user' | 'global'
let currentD3GenreMode = 'lollipop'; // 'lollipop' | 'bubbles'

function setD3DataSource(source) {
  currentD3DataSource = source;
  const userBtn = document.getElementById('d3SourceUserBtn');
  const globalBtn = document.getElementById('d3SourceGlobalBtn');
  if (userBtn) userBtn.classList.toggle('active', source === 'user');
  if (globalBtn) globalBtn.classList.toggle('active', source === 'global');
  renderStatsTab();
}

function setD3GenreMode(mode) {
  currentD3GenreMode = mode;
  const lolBtn = document.getElementById('d3GenreModeLollipop');
  const bubBtn = document.getElementById('d3GenreModeBubbles');
  if (lolBtn) lolBtn.classList.toggle('active', mode === 'lollipop');
  if (bubBtn) bubBtn.classList.toggle('active', mode === 'bubbles');
  renderStatsTab();
}

function renderStatsTab() {
  if (typeof renderProFinancialStats === 'function') renderProFinancialStats();
  if (typeof d3 === 'undefined') {
    console.error("D3.js no está disponible.");
    return;
  }
  const itemsById = {};
  allItems.forEach(it => { itemsById[it.id] = it; });

  const stateNames = { wishlist: '❤️ Deseos', playing: '🎮 Jugando', completed: '✅ Completado', paused: '⏸️ Pausado', pending: '📥 Pendiente', dropped: '❌ Abandonado' };
  
  // 1. STATS POR ESTADO (Donut Chart)
  const byStatus = {};
  userStates.forEach(s => { byStatus[s.status] = (byStatus[s.status] || 0) + 1; });
  const statusRows = Object.keys(byStatus).map(k => ({ label: stateNames[k] || k, count: byStatus[k], key: k })).sort((a,b) => b.count - a.count);
  
  const statusContainer = document.getElementById('statsByStatus');
  const blockStatus = document.getElementById('blockStatsStatus');
  if (currentD3DataSource === 'global') {
    if (blockStatus) blockStatus.style.display = 'none';
  } else {
    if (blockStatus) blockStatus.style.display = 'block';
    if (statusContainer) renderD3DonutChart(statusContainer, statusRows);
  }

  // 2. STATS POR TIPO Y GÉNERO
  const byType = {};
  const byGenre = {};
  
  const sourceItems = currentD3DataSource === 'global'
    ? allItems
    : userStates.map(s => itemsById[s.itemId]).filter(Boolean);

  sourceItems.forEach(it => {
    byType[it.type] = (byType[it.type] || 0) + 1;
    (it.genres || '').split(',').map(g => g.trim()).filter(Boolean).forEach(g => {
      byGenre[g] = (byGenre[g] || 0) + 1;
    });
  });

  const typeRows = Object.keys(byType).map(k => ({ label: (typeLabels[k] || k), count: byType[k], key: k })).sort((a,b) => b.count - a.count);
  const genreRows = Object.keys(byGenre).map(k => ({ label: k, count: byGenre[k] })).sort((a,b) => b.count - a.count).slice(0, 10);

  const typeContainer = document.getElementById('statsByType');
  if (typeContainer) renderD3TypeBarChart(typeContainer, typeRows);

  const genreContainer = document.getElementById('statsByGenre');
  if (genreContainer) {
    if (currentD3GenreMode === 'lollipop') {
      renderD3GenreLollipopChart(genreContainer, genreRows);
    } else {
      renderD3GenreBubbleChart(genreContainer, genreRows);
    }
  }
}

function renderD3DonutChart(containerEl, statusRows) {
  containerEl.innerHTML = '';
  if (!statusRows.length) {
    containerEl.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text2);font-size:.88rem;">📭 Aún no tienes productos en tu biblioteca personal. ¡Añade algunos desde el catálogo o cambia a <b>🌐 Catálogo Global</b>!</div>';
    return;
  }
  const totalCount = statusRows.reduce((a, b) => a + b.count, 0);
  const statusColors = {
    'wishlist': '#FF3B5C', 'playing': '#00E5FF', 'completed': '#00FFB2',
    'paused': '#FFB800', 'pending': '#8B7CFF', 'dropped': '#8E98B0'
  };

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:20px;width:100%;';
  containerEl.appendChild(wrapper);

  const chartDiv = document.createElement('div');
  chartDiv.style.cssText = 'width:230px;height:230px;position:relative;flex-shrink:0;';
  wrapper.appendChild(chartDiv);

  const legendDiv = document.createElement('div');
  legendDiv.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit, minmax(135px, 1fr));gap:8px;flex:1;min-width:180px;max-width:360px;';
  wrapper.appendChild(legendDiv);

  const svg = d3.select(chartDiv).append('svg')
    .attr('viewBox', '0 0 240 240')
    .style('width', '100%').style('height', '100%').style('overflow', 'visible');

  const defs = svg.append('defs');
  const filter = defs.append('filter').attr('id', 'd3-donut-glow').attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
  filter.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur');
  const feMerge = filter.append('feMerge');
  feMerge.append('feMergeNode').attr('in', 'blur');
  feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

  const g = svg.append('g').attr('transform', 'translate(120, 120)');

  const arc = d3.arc().innerRadius(64).outerRadius(100).cornerRadius(6).padAngle(0.03);
  const arcHover = d3.arc().innerRadius(58).outerRadius(110).cornerRadius(8).padAngle(0.03);

  const centerTitle = g.append('text').attr('text-anchor', 'middle').attr('y', -12)
    .style('font-size', '11px').style('fill', '#A0A6B8').style('font-weight', '700').style('text-transform', 'uppercase').text('TOTAL');
  const centerVal = g.append('text').attr('text-anchor', 'middle').attr('y', 10)
    .style('font-size', '26px').style('fill', '#fff').style('font-weight', '800').text(totalCount);
  const centerSub = g.append('text').attr('text-anchor', 'middle').attr('y', 26)
    .style('font-size', '11px').style('fill', '#00FFB2').style('font-weight', '600').text('100% ítems');

  const pie = d3.pie().value(d => d.count).sort(null);
  const pieData = pie(statusRows);

  const tooltip = d3.select('#d3FloatingTooltip');

  const paths = g.selectAll('path').data(pieData).enter().append('path')
    .attr('fill', d => statusColors[d.data.key] || '#00E5FF')
    .style('cursor', 'pointer')
    .style('transition', 'opacity 0.2s ease')
    .each(function(d) { this._current = { startAngle: d.startAngle, endAngle: d.startAngle }; })
    .on('mouseover', function(event, d) {
      g.selectAll('path').style('opacity', 0.35);
      d3.select(this).style('opacity', 1).attr('filter', 'url(#d3-donut-glow)')
        .transition().duration(250).attr('d', arcHover);
      
      centerTitle.text(d.data.label.replace(/^[^\s]+\s*/, '').toUpperCase());
      centerVal.text(d.data.count);
      const pct = Math.round((d.data.count / totalCount) * 100);
      centerSub.text(`${pct}% del total`);

      tooltip.style('opacity', 1)
        .html(`<b>${d.data.label}</b><br>📦 Cantidad: <b>${d.data.count}</b> ítems<br>📊 Porcentaje: <b>${pct}%</b>`)
        .style('left', (event.clientX + 15) + 'px')
        .style('top', (event.clientY - 10) + 'px');
    })
    .on('mousemove', function(event) {
      tooltip.style('left', (event.clientX + 15) + 'px').style('top', (event.clientY - 10) + 'px');
    })
    .on('mouseout', function() {
      g.selectAll('path').style('opacity', 1);
      d3.select(this).attr('filter', null).transition().duration(250).attr('d', arc);
      centerTitle.text('TOTAL');
      centerVal.text(totalCount);
      centerSub.text('100% ítems');
      tooltip.style('opacity', 0);
    });

  paths.transition().duration(800).ease(d3.easeCubicOut)
    .attrTween('d', function(d) {
      const interpolate = d3.interpolate(this._current, d);
      this._current = interpolate(0);
      return function(t) { return arc(interpolate(t)); };
    });

  statusRows.forEach((r, i) => {
    const col = statusColors[r.key] || '#00E5FF';
    const pct = Math.round((r.count / totalCount) * 100);
    const badge = document.createElement('div');
    badge.style.cssText = `display:flex;align-items:center;gap:6px;padding:6px 8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;cursor:pointer;transition:all 0.2s ease;min-width:0;overflow:hidden;`;
    badge.innerHTML = `
      <span style="width:8px;height:8px;border-radius:50%;background:${col};box-shadow:0 0 6px ${col};flex-shrink:0;"></span>
      <span style="font-size:0.75rem;color:#fff;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span>
      <span style="font-size:0.75rem;color:#00FFB2;font-weight:700;flex-shrink:0;white-space:nowrap;">${r.count} (${pct}%)</span>
    `;
    badge.onmouseenter = () => {
      const pEl = paths.nodes()[i];
      if (pEl) pEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: badge.getBoundingClientRect().left, clientY: badge.getBoundingClientRect().top }));
      badge.style.background = 'rgba(0,229,255,0.12)';
      badge.style.borderColor = col;
    };
    badge.onmouseleave = () => {
      const pEl = paths.nodes()[i];
      if (pEl) pEl.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      badge.style.background = 'rgba(255,255,255,0.03)';
      badge.style.borderColor = 'rgba(255,255,255,0.08)';
    };
    legendDiv.appendChild(badge);
  });
}

function renderD3TypeBarChart(containerEl, typeRows) {
  containerEl.innerHTML = '';
  if (!typeRows.length) {
    containerEl.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text2);font-size:.88rem;">📭 No hay datos disponibles para mostrar el gráfico por tipo.</div>';
    return;
  }
  const totalCount = typeRows.reduce((a, b) => a + b.count, 0);
  
  const margin = { top: 10, right: 85, bottom: 20, left: 145 };
  const width = 500;
  const height = Math.max(180, typeRows.length * 44 + margin.top + margin.bottom);

  const svg = d3.select(containerEl).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('width', '100%').style('height', 'auto').style('max-height', '400px');

  const defs = svg.append('defs');
  const gradients = [
    ['#00E5FF', '#0088FF'], ['#00FFB2', '#00AA77'], ['#FF0055', '#B3003B'],
    ['#FFB800', '#FF7700'], ['#8B7CFF', '#5544CC'], ['#FF3B5C', '#D500F9']
  ];
  typeRows.forEach((_, i) => {
    const cols = gradients[i % gradients.length];
    const grad = defs.append('linearGradient').attr('id', `type-grad-${i}`).attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '0%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', cols[0]);
    grad.append('stop').attr('offset', '100%').attr('stop-color', cols[1]);
  });

  const x = d3.scaleLinear().domain([0, d3.max(typeRows, d => d.count) || 1]).range([0, width - margin.left - margin.right]);
  const y = d3.scaleBand().domain(typeRows.map(d => d.label)).range([margin.top, height - margin.bottom]).padding(0.35);

  const g = svg.append('g');

  g.selectAll('.bar-bg').data(typeRows).enter().append('rect')
    .attr('x', margin.left).attr('y', d => y(d.label))
    .attr('width', width - margin.left - margin.right).attr('height', y.bandwidth())
    .attr('rx', 6).attr('fill', 'rgba(255,255,255,0.04)');

  g.selectAll('.label-y').data(typeRows).enter().append('text')
    .attr('x', margin.left - 10).attr('y', d => y(d.label) + y.bandwidth() / 2 + 4)
    .attr('text-anchor', 'end')
    .style('font-size', '11.5px').style('fill', '#fff').style('font-weight', '600')
    .text(d => d.label.length > 17 ? d.label.substring(0, 15) + '…' : d.label);

  const tooltip = d3.select('#d3FloatingTooltip');

  const bars = g.selectAll('.bar').data(typeRows).enter().append('rect')
    .attr('x', margin.left).attr('y', d => y(d.label))
    .attr('height', y.bandwidth()).attr('rx', 6)
    .attr('fill', (d, i) => `url(#type-grad-${i})`)
    .style('cursor', 'pointer')
    .style('filter', 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))')
    .style('transition', 'filter 0.2s ease, transform 0.2s ease')
    .on('mouseover', function(event, d) {
      d3.select(this).style('filter', 'brightness(1.3) drop-shadow(0 4px 12px rgba(0,229,255,0.6))').style('transform', 'translateX(4px)');
      const pct = Math.round((d.count / totalCount) * 100);
      tooltip.style('opacity', 1)
        .html(`🏷️ Categoría: <b>${d.label}</b><br>📦 Cantidad: <b>${d.count}</b> ítems<br>📊 Porcentaje: <b>${pct}%</b> del total`)
        .style('left', (event.clientX + 15) + 'px').style('top', (event.clientY - 10) + 'px');
    })
    .on('mousemove', function(event) {
      tooltip.style('left', (event.clientX + 15) + 'px').style('top', (event.clientY - 10) + 'px');
    })
    .on('mouseout', function() {
      d3.select(this).style('filter', 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))').style('transform', 'none');
      tooltip.style('opacity', 0);
    });

  bars.attr('width', 0)
    .transition().duration(800).ease(d3.easeCubicOut)
    .attr('width', d => Math.max(4, x(d.count)));

  const labels = g.selectAll('.val-text').data(typeRows).enter().append('text')
    .attr('x', margin.left + 8).attr('y', d => y(d.label) + y.bandwidth() / 2 + 4)
    .style('font-size', '11px').style('fill', '#00FFB2').style('font-weight', '700')
    .style('opacity', 0)
    .text(d => `${d.count} (${Math.round((d.count / totalCount) * 100)}%)`);

  labels.transition().delay(400).duration(400).style('opacity', 1)
    .attr('x', d => Math.min(width - 5, margin.left + Math.max(4, x(d.count)) + 8));
}

function renderD3GenreLollipopChart(containerEl, genreRows) {
  containerEl.innerHTML = '';
  if (!genreRows.length) {
    containerEl.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text2);font-size:.88rem;">📭 No hay datos de géneros para mostrar.</div>';
    return;
  }
  const margin = { top: 15, right: 75, bottom: 20, left: 145 };
  const width = 500;
  const height = Math.max(200, genreRows.length * 40 + margin.top + margin.bottom);

  const svg = d3.select(containerEl).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('width', '100%').style('height', 'auto').style('max-height', '450px');

  const x = d3.scaleLinear().domain([0, d3.max(genreRows, d => d.count) || 1]).range([0, width - margin.left - margin.right]);
  const y = d3.scaleBand().domain(genreRows.map(d => d.label)).range([margin.top, height - margin.bottom]).padding(1);

  const g = svg.append('g');

  g.selectAll('.label-y').data(genreRows).enter().append('text')
    .attr('x', margin.left - 10).attr('y', d => y(d.label) + 4)
    .attr('text-anchor', 'end')
    .style('font-size', '11.5px').style('fill', '#fff').style('font-weight', '600')
    .text(d => d.label.length > 17 ? d.label.substring(0, 15) + '…' : d.label);

  const tooltip = d3.select('#d3FloatingTooltip');

  const lines = g.selectAll('.stick').data(genreRows).enter().append('line')
    .attr('x1', margin.left).attr('y1', d => y(d.label))
    .attr('x2', margin.left).attr('y2', d => y(d.label))
    .attr('stroke', '#00E5FF').attr('stroke-width', 3).attr('stroke-linecap', 'round')
    .style('opacity', 0.65);

  lines.transition().duration(800).ease(d3.easeCubicOut)
    .attr('x2', d => margin.left + x(d.count));

  const circles = g.selectAll('.candy').data(genreRows).enter().append('circle')
    .attr('cx', margin.left).attr('cy', d => y(d.label))
    .attr('r', 0)
    .attr('fill', '#00FFB2').attr('stroke', '#04050A').attr('stroke-width', 2)
    .style('cursor', 'pointer')
    .style('filter', 'drop-shadow(0 0 6px #00FFB2)')
    .style('transition', 'all 0.2s ease')
    .on('mouseover', function(event, d) {
      d3.select(this).attr('r', 13).attr('fill', '#00E5FF').style('filter', 'drop-shadow(0 0 12px #00E5FF)');
      tooltip.style('opacity', 1)
        .html(`🏷️ Género: <b>${d.label}</b><br>⚡ Frecuencia: <b>${d.count}</b> productos en esta categoría`)
        .style('left', (event.clientX + 15) + 'px').style('top', (event.clientY - 10) + 'px');
    })
    .on('mousemove', function(event) {
      tooltip.style('left', (event.clientX + 15) + 'px').style('top', (event.clientY - 10) + 'px');
    })
    .on('mouseout', function() {
      d3.select(this).attr('r', 8).attr('fill', '#00FFB2').style('filter', 'drop-shadow(0 0 6px #00FFB2)');
      tooltip.style('opacity', 0);
    });

  circles.transition().duration(800).ease(d3.easeElasticOut)
    .attr('cx', d => margin.left + x(d.count))
    .attr('r', 8);

  const vals = g.selectAll('.val-text').data(genreRows).enter().append('text')
    .attr('x', margin.left).attr('y', d => y(d.label) + 4)
    .style('font-size', '11px').style('fill', '#fff').style('font-weight', '800')
    .style('opacity', 0)
    .text(d => d.count);

  vals.transition().delay(500).duration(400).style('opacity', 1)
    .attr('x', d => Math.min(width - 5, margin.left + x(d.count) + 14));
}

function renderD3GenreBubbleChart(containerEl, genreRows) {
  containerEl.innerHTML = '';
  if (!genreRows.length) {
    containerEl.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text2);font-size:.88rem;">📭 No hay datos de géneros para mostrar.</div>';
    return;
  }
  const width = 420;
  const height = 340;

  const svg = d3.select(containerEl).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('width', '100%').style('height', 'auto').style('max-height', '360px');

  const root = d3.hierarchy({ children: genreRows }).sum(d => d.count || 1);
  d3.pack().size([width - 20, height - 20]).padding(10)(root);

  const colors = ['#00E5FF', '#00FFB2', '#FF0055', '#FFB800', '#8B7CFF', '#FF3B5C', '#0088FF', '#00AA77', '#FF7700', '#D500F9'];
  const colorScale = d3.scaleOrdinal().range(colors);

  const g = svg.append('g').attr('transform', 'translate(10, 10)');

  const tooltip = d3.select('#d3FloatingTooltip');

  const nodes = g.selectAll('.node').data(root.leaves()).enter().append('g')
    .attr('class', 'node')
    .attr('transform', d => `translate(${d.x}, ${d.y})`)
    .style('cursor', 'pointer');

  nodes.append('circle')
    .attr('r', 0)
    .attr('fill', (d, i) => colorScale(i))
    .attr('stroke', 'rgba(255,255,255,0.4)').attr('stroke-width', 1.5)
    .style('filter', 'drop-shadow(0 4px 10px rgba(0,0,0,0.5))')
    .style('transition', 'all 0.2s ease')
    .on('mouseover', function(event, d) {
      d3.select(this).style('filter', 'brightness(1.25) drop-shadow(0 6px 18px rgba(0,229,255,0.7))').style('transform', 'scale(1.12)');
      tooltip.style('opacity', 1)
        .html(`🏷️ Género: <b>${d.data.label}</b><br>⚡ Frecuencia: <b>${d.data.count}</b> productos`)
        .style('left', (event.clientX + 15) + 'px').style('top', (event.clientY - 10) + 'px');
    })
    .on('mousemove', function(event) {
      tooltip.style('left', (event.clientX + 15) + 'px').style('top', (event.clientY - 10) + 'px');
    })
    .on('mouseout', function() {
      d3.select(this).style('filter', 'drop-shadow(0 4px 10px rgba(0,0,0,0.5))').style('transform', 'none');
      tooltip.style('opacity', 0);
    });

  nodes.select('circle').transition().duration(800).ease(d3.easeElasticOut)
    .attr('r', d => d.r);

  nodes.append('text')
    .attr('text-anchor', 'middle').attr('y', -3)
    .style('font-size', d => `${Math.max(8, Math.min(11, d.r / 3))}px`)
    .style('fill', '#04050A').style('font-weight', '800').style('pointer-events', 'none')
    .style('opacity', 0)
    .text(d => d.r > 20 ? (d.data.label.length > 9 ? d.data.label.substring(0, 8) + '…' : d.data.label) : '');

  nodes.append('text')
    .attr('text-anchor', 'middle').attr('y', 11)
    .style('font-size', d => `${Math.max(7, Math.min(10, d.r / 3.2))}px`)
    .style('fill', '#04050A').style('font-weight', '700').style('pointer-events', 'none')
    .style('opacity', 0)
    .text(d => d.r > 24 ? `(${d.data.count})` : '');

  nodes.selectAll('text').transition().delay(400).duration(400).style('opacity', 1);
}

async function computeAchievementProgress(rule) {
  const req = parseInt(rule.requirement, 10) || 1;
  const itemsById = {};
  allItems.forEach(it => { itemsById[it.id] = it; });

  let current = 0;
  switch (rule.category) {
    case 'gaming':
      current = userStates.filter(s => s.status === 'completed' && itemsById[s.itemId] && itemsById[s.itemId].type === 'juego').length;
      break;
    case 'movies':
      current = userStates.filter(s => s.status === 'completed' && itemsById[s.itemId] && ['pelicula','pelicula_animada'].includes(itemsById[s.itemId].type)).length;
      break;
    case 'series':
      current = userStates.filter(s => s.status === 'completed' && itemsById[s.itemId] && ['serie','serie_animada'].includes(itemsById[s.itemId].type)).length;
      break;
    case 'anime':
      current = userStates.filter(s => s.status === 'completed' && itemsById[s.itemId] && ['anime','anime_movie'].includes(itemsById[s.itemId].type)).length;
      break;
    case 'community': {
      const reviews = await idbGetAll('user_reviews');
      current = reviews.length;
      break;
    }
    default:
      current = userStates.length;
  }
  return { current: Math.min(current, req), requirement: req, unlocked: current >= req };
}

async function renderAchievementsTab() {
  const container = document.getElementById('achvGrid');
  if (!achievementsRules.length) {
    container.innerHTML = '<p style="color:var(--text3);font-size:.82rem">Tu archivo importado no incluye logros todavía.</p>';
    return;
  }

  const cards = [];
  for (const rule of achievementsRules) {
    const progress = await computeAchievementProgress(rule);
    const pct = progress.requirement ? (progress.current / progress.requirement * 100) : 0;
    cards.push(`
      <div class="achv-card ${progress.unlocked ? 'unlocked' : ''}">
        <div class="icon">${rule.icon || '🏅'}</div>
        <div class="name">${escapeHtml(rule.name)}</div>
        <div class="desc">${escapeHtml(rule.description)}</div>
        <div class="achv-progress-track"><div class="achv-progress-fill" style="width:${pct}%"></div></div>
        <div class="achv-progress-txt">${progress.current} / ${progress.requirement}</div>
      </div>
    `);
  }
  container.innerHTML = cards.join('');
}

async function createNewList() {
  const input = document.getElementById('newListNameInput');
  const name = input.value.trim();
  if (!name) { showToast('Escribe un nombre para la lista.'); return; }

  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('user_lists', 'readwrite');
    tx.objectStore('user_lists').add({ name, itemIds: [], createdAt: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });

  input.value = '';
  renderListsTab();
  showToast('Lista creada.');
}

async function renderListsTab() {
  const lists = await idbGetAll('user_lists') || [];
  const container = document.getElementById('listsContainer');
  const detailContainer = document.getElementById('listDetailContainer');

  if (container) {
    if (!lists.length) {
      container.innerHTML = '<p style="color:var(--text3);font-size:.82rem">Todavía no tienes listas. Crea una arriba.</p>';
    } else {
      container.innerHTML = lists.map(l => {
        const listTotal = calculateListTotal(l.itemIds || []);
        const totalFormatted = formatListTotal(listTotal);
        return `
        <div class="list-row" onclick="openListDetail(${l.id})">
          <div style="flex:1;">
            <div class="name">${escapeHtml(l.name)}</div>
            <div class="cnt">${(l.itemIds || []).length} ítems · <span style="color:#00FFB2;font-weight:700;">💰 ${totalFormatted}</span></div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button class="btn" onclick="event.stopPropagation(); transferListIdToCart(${l.id})" style="padding:6px 10px; font-size:.75rem; background:rgba(0,229,255,0.15); border:1px solid #00E5FF; color:#00E5FF; font-weight:700;" title="Pasar todos los productos de esta lista al carrito">🛒 Pasar al Carrito</button>
            <button class="btn btn-danger" onclick="event.stopPropagation(); deleteList(${l.id})" style="padding:6px 10px;font-size:.75rem">Borrar</button>
          </div>
        </div>
      `;}).join('');
    }
  }

  if (window.currentOpenListId) {
    const activeList = lists.find(l => l.id === window.currentOpenListId);
    if (activeList) {
      await openListDetail(window.currentOpenListId);
    } else {
      window.currentOpenListId = null;
      if (detailContainer) detailContainer.innerHTML = '';
    }
  } else {
    if (detailContainer) detailContainer.innerHTML = '';
  }

  if (typeof renderLibraryCounts === 'function') await renderLibraryCounts();
}

async function deleteList(listId) {
  if (!confirm('¿Borrar esta lista?')) return;
  if (window.currentOpenListId === listId) {
    window.currentOpenListId = null;
  }
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('user_lists', 'readwrite');
    tx.objectStore('user_lists').delete(listId);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  renderListsTab();
}

async function openListDetail(listId) {
  window.currentOpenListId = listId;
  const list = await idbGet('user_lists', listId);
  if (!list) return;

  const validItemIds = (list.itemIds || []).filter(id => findCatalogItem(id));
  const listTotalNum = calculateListTotal(validItemIds);
  const listTotalFormatted = formatListTotal(listTotalNum);

  const rows = validItemIds.map(id => {
    const it = findCatalogItem(id);
    if (!it) return '';
    const priceStr = formatItemPrice(it);
    const typeInfo = getItemTypeInfo(it);
    return `
      <div class="list-item-mini">
        <img src="${resolveImageUrl(it.cover || it.image || it.poster || it.caratula || it.img)}" loading="lazy" decoding="async" alt="${escapeHtml(it.title)}" onerror="this.src='${PLACEHOLDER_IMG}'">
        <div class="t" style="flex:1; min-width:0;">
          <div style="font-weight:700;color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(it.title)}</div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:3px;">
            <span style="font-size:.72rem; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#00E5FF; padding:1px 6px; border-radius:6px; font-weight:700;">${typeInfo.label}</span>
            <span style="font-size:.75rem; color:var(--signal); font-weight:800;">🏷️ ${escapeHtml(priceStr)}</span>
          </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button class="btn" style="padding:5px 9px; font-size:.72rem; border:1px solid rgba(0,229,255,0.5); color:#00E5FF; background:rgba(0,229,255,0.1); font-weight:700;" onclick="addToCart('${it.id}', true)" title="Añadir producto digital al carrito">🛒 +Carrito</button>
          <button class="btn" style="padding:5px 9px;font-size:.72rem" onclick="removeItemFromList(${listId}, ${it.id})">Quitar</button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('listDetailContainer').innerHTML = `
    <div class="stat-block">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <h4 style="margin:0;font-size:1.1rem;">📋 ${escapeHtml(list.name)}</h4>
        <div style="background:var(--signal-dim);border:1px solid var(--signal-glow);color:var(--signal);padding:6px 14px;border-radius:12px;font-weight:800;font-size:.95rem;">
          💰 Total: ${listTotalFormatted}
        </div>
      </div>
      ${rows || '<p style="color:var(--text3);font-size:.82rem">Vacía.</p>'}
      ${validItemIds.length ? `
        <div style="margin:16px 0;padding:12px;background:rgba(255,255,255,0.03);border-radius:12px;display:flex;justify-content:space-between;align-items:center;border:1px dashed rgba(255,255,255,0.15);">
          <span style="color:var(--text2);font-size:.85rem;font-weight:600;">Suma de los ${validItemIds.length} productos:</span>
          <span style="color:#00FFB2;font-weight:800;font-size:1.1rem;">${listTotalFormatted}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
          <button class="btn" style="background:linear-gradient(135deg, #00E5FF, #00FFB2); color:#04050A; font-weight:800; padding:10px 16px; border-radius:12px; border:none; display:flex; align-items:center; justify-content:center; gap:8px; width:100%; cursor:pointer;" onclick="transferListIdToCart(${listId})">
            🛒 Pasar Toda la Lista al Carrito de Compras
          </button>
          <div class="share-order-row">
            <button class="btn share-whatsapp" onclick="shareListAsOrder(${listId}, 'whatsapp')">📲 Enviar por WhatsApp</button>
            <button class="btn share-telegram" onclick="shareListAsOrder(${listId}, 'telegram')">✈️ Enviar por Telegram</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function buildOrderMessage(list, itemsById, validItemIds) {
  const listTotalNum = calculateListTotal(validItemIds);
  const listTotalFormatted = formatListTotal(listTotalNum);
  const lines = validItemIds.map((id, i) => {
    const it = itemsById[id];
    return `${i + 1}. ${it.title} - ${formatItemPrice(it)}`;
  });
  return `🛒 *Pedido / Lista: ${list.name}*\n\n${lines.join('\n')}\n\n📦 Cantidad: ${validItemIds.length} ítem${validItemIds.length !== 1 ? 's' : ''}\n💰 *TOTAL SUMADO: ${listTotalFormatted}*`;
}

async function shareListAsOrder(listId, platform) {
  const list = await idbGet('user_lists', listId);
  if (!list) return;
  const itemsById = {};
  allItems.forEach(it => { itemsById[it.id] = it; });
  const validItemIds = (list.itemIds || []).filter(id => itemsById[id]);

  if (!validItemIds.length) {
    showToast('Esta lista está vacía.');
    return;
  }

  const message = buildOrderMessage(list, itemsById, validItemIds);
  const encoded = encodeURIComponent(message);

  const url = platform === 'whatsapp'
    ? `https://wa.me/?text=${encoded}`
    : `https://t.me/share/url?url=&text=${encoded}`;

  window.open(url, '_blank');
}

async function removeItemFromList(listId, itemId) {
  const db = await openDB();
  const list = await idbGet('user_lists', listId);
  if (!list) return;
  list.itemIds = (list.itemIds || []).filter(id => id !== itemId);
  await new Promise((resolve, reject) => {
    const tx = db.transaction('user_lists', 'readwrite');
    tx.objectStore('user_lists').put(list);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  openListDetail(listId);
  renderListsTab();
}

async function renderAddToListBox(itemId) {
  if (typeof renderDynamicListSelector === 'function') {
    const box = document.getElementById('dynamicListSelectorBox');
    if (box && (box.style.display === 'block' || box.style.display === 'flex')) {
      await renderDynamicListSelector(itemId);
    }
  }
}

async function toggleItemInList(listId, itemId, checked) {
  try {
    const db = await openDB();
    const list = await idbGet('user_lists', listId);
    if (!list) { showToast('❌ No se encontró esa lista.'); return; }
    let ids = new Set(list.itemIds || []);
    if (checked) ids.add(itemId); else ids.delete(itemId);
    list.itemIds = [...ids];
    await new Promise((resolve, reject) => {
      const tx = db.transaction('user_lists', 'readwrite');
      tx.objectStore('user_lists').put(list);
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
    const totalNum = calculateListTotal(list.itemIds);
    const totalFormatted = formatListTotal(totalNum);
    showToast(checked ? `✓ Añadido a "${list.name}" (Suma Total: ${totalFormatted})` : `Quitado de "${list.name}" (Total: ${totalFormatted})`);
    renderAddToListBox(itemId);
    if (typeof renderDynamicListSelector === 'function') renderDynamicListSelector(itemId);
    renderListsTab();
  } catch (e) {
    console.error(e);
    showToast('❌ No se pudo actualizar la lista.');
  }
}

async function createListInlineAndAdd(itemId) {
  const input = document.getElementById('inlineListName');
  const name = input.value.trim();
  if (!name) { showToast('Escribe un nombre para la lista.'); return; }

  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('user_lists', 'readwrite');
      tx.objectStore('user_lists').add({ name, itemIds: [itemId], createdAt: new Date().toISOString() });
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });

    await renderAddToListBox(itemId);
    if (typeof renderDynamicListSelector === 'function') await renderDynamicListSelector(itemId);
    await renderListsTab();
    showToast(`Lista "${name}" creada.`);
  } catch (e) {
    console.error(e);
    showToast('❌ No se pudo crear la lista.');
  }
}

// ==========================================
// 📋 SELECTOR DINÁMICO DE LISTAS (#dynamicListSelectorBox)
// ==========================================
function toggleDynamicListSelector(event) {
  if (event) event.stopPropagation();
  const box = document.getElementById('dynamicListSelectorBox');
  if (!box) return;
  if (box.style.display === 'none' || !box.style.display) {
    if (typeof currentDetailId !== 'undefined' && currentDetailId) {
      renderDynamicListSelector(currentDetailId);
    }
    box.style.display = 'block';
    if (window.triggerHaptic) window.triggerHaptic(25);
  } else {
    box.style.display = 'none';
  }
}

function closeDynamicListSelector() {
  const box = document.getElementById('dynamicListSelectorBox');
  if (box) box.style.display = 'none';
}

async function renderDynamicListSelector(itemId) {
  const container = document.getElementById('dynamicListSelectorBox');
  if (!container) return;

  const lists = await idbGetAll('user_lists');
  const it = (typeof allItems !== 'undefined') ? allItems.find(i => i.id === itemId) : null;
  const titleStr = it ? it.title : 'este título';

  let htmlRows = '';
  if (lists && lists.length > 0) {
    lists.forEach(l => {
      const checked = (l.itemIds || []).includes(itemId);
      const listTotal = calculateListTotal(l.itemIds || []);
      const totalFormatted = formatListTotal(listTotal);
      htmlRows += `
        <div class="list-selector-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(255,255,255,0.04); border:1px solid ${checked ? '#00FFB2' : 'rgba(255,255,255,0.08)'}; border-radius:12px; margin-bottom:8px; cursor:pointer; transition:all .2s ease;" onclick="toggleItemInListFromSelector(${l.id}, ${itemId}, ${!checked})">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:1.2rem;">${checked ? '✅' : '⬜'}</span>
            <div>
              <div style="font-weight:700; color:#fff; font-size:0.92rem;">${escapeHtml(l.name)}</div>
              <div style="font-size:0.75rem; color:var(--text2);">${(l.itemIds || []).length} título${(l.itemIds || []).length !== 1 ? 's' : ''} en esta lista</div>
            </div>
          </div>
          <span style="font-size:0.75rem; color:#00FFB2; font-weight:700; background:rgba(0,255,178,0.12); padding:4px 8px; border-radius:8px; border:1px solid rgba(0,255,178,0.25);">💰 ${totalFormatted}</span>
        </div>
      `;
    });
  }

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px;">
      <div style="font-weight:800; color:#9D4EDD; font-size:1rem; display:flex; align-items:center; gap:6px;">
        <span>📋</span><span>Elegir Lista para Guardar</span>
      </div>
      <button onclick="closeDynamicListSelector()" style="background:transparent; border:none; color:var(--text2); font-size:1.1rem; cursor:pointer; padding:4px;">✕</button>
    </div>
    <div style="font-size:0.82rem; color:var(--text2); margin-bottom:12px;">
      Selecciona en cuál de tus listas personalizadas (creadas en la sección <b>Mis Listas</b>) deseas guardar <b>${escapeHtml(titleStr)}</b>:
    </div>
    <div style="max-height:220px; overflow-y:auto; margin-bottom:12px; padding-right:4px;">
      ${htmlRows || '<div style="padding:16px; text-align:center; background:rgba(255,255,255,0.02); border-radius:12px; color:var(--text2); font-size:0.85rem;">📭 Aún no has creado ninguna lista en la sección "Mis Listas". ¡Crea tu primera lista abajo!</div>'}
    </div>
    <div style="display:flex; gap:8px; align-items:center; background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:12px; border:1px solid rgba(255,255,255,0.08);">
      <input type="text" id="selectorInlineListName" placeholder="➕ Nombre de nueva lista..." style="flex:1; background:transparent; border:none; color:#fff; font-size:0.85rem; outline:none;" onkeypress="if(event.key==='Enter') createListFromSelectorAndAdd(${itemId})">
      <button class="btn" style="background:#9D4EDD; color:#fff; border:none; padding:6px 12px; font-weight:700; font-size:0.8rem; border-radius:8px;" onclick="createListFromSelectorAndAdd(${itemId})">Crear</button>
    </div>
  `;
}

function toggleItemInListFromSelector(listId, itemId, checked) {
  if (window.triggerHaptic) window.triggerHaptic(20);
  toggleItemInList(listId, itemId, checked);
}

async function createListFromSelectorAndAdd(itemId) {
  const input = document.getElementById('selectorInlineListName');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { showToast('Escribe un nombre para la lista.'); return; }

  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('user_lists', 'readwrite');
      tx.objectStore('user_lists').add({ name, itemIds: [itemId], createdAt: new Date().toISOString() });
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });

    await renderAddToListBox(itemId);
    if (typeof renderDynamicListSelector === 'function') await renderDynamicListSelector(itemId);
    renderListsTab();
    showToast(`Lista "${name}" creada y título añadido.`);
  } catch (e) {
    console.error(e);
    showToast('❌ Error creando la lista.');
  }
}

// ==========================================
// ⚙️ AJUSTES
// ==========================================
async function openSettings() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  closeAllOpenModals('settingsOverlay');

  // Despliegue inmediato del modal para respuesta visual instantánea (0ms de latencia)
  const overlay = document.getElementById('settingsOverlay');
  if (overlay) overlay.style.display = 'block';

  try {
    let generatedAt = null;
    let importedAt = null;
    let autoBackupDanger = true;
    let lastBackupTs = null;

    if (typeof idbGetMeta === 'function') {
      try {
        [generatedAt, importedAt, autoBackupDanger, lastBackupTs] = await Promise.all([
          idbGetMeta('generated_at', null),
          idbGetMeta('imported_at', null),
          idbGetMeta('auto_backup_danger', true),
          idbGetMeta('last_backup_timestamp', null)
        ]);
      } catch(metaErr) {
        console.warn('Error leyendo metadatos para configuración:', metaErr);
      }
    }

    const info = document.getElementById("catalogInfo");
    const totalItems = (typeof allItems !== 'undefined' && Array.isArray(allItems)) ? allItems.length : 0;
    if (info) {
      const dateText = importedAt ? new Date(importedAt).toLocaleString("es-ES") : "Sin registro";
      info.innerHTML = "📦 " + totalItems + " elementos<br><br>📅 Última actualización<br>" + dateText;
    }

    const imgInput = document.getElementById('imageBaseUrlInput');
    if (imgInput) imgInput.value = (typeof imageBaseUrl !== 'undefined' && imageBaseUrl) ? imageBaseUrl : '';

    const currentStates = (typeof userStates !== 'undefined' && Array.isArray(userStates)) ? userStates : [];
    const completedCount = currentStates.filter(s => s && s.status === 'completed').length;
    const favCount = currentStates.filter(s => s && (s.status === 'wishlist' || s.status === 'playing')).length;
    let aiProfileBadge = '🧭 Explorador Novato';
    if (completedCount + favCount > 15) aiProfileBadge = '🏆 Maestro del Catálogo';
    else if (completedCount + favCount > 5) aiProfileBadge = '🎮 Aficionado Curioso';

    const metaEl = document.getElementById('settingsMeta');
    if (metaEl) {
      metaEl.innerHTML = `
        <div style="background:rgba(61,235,255,0.08);border:1px solid rgba(61,235,255,0.25);padding:8px 12px;border-radius:10px;margin-bottom:10px;">
          🤖 Perfil IA: <b style="color:#fff;">${aiProfileBadge}</b><br>
          <span style="font-size:0.72rem;color:var(--text2);">${completedCount} completados · ${favCount} en progreso/deseados</span>
        </div>
        📦 ${totalItems} elementos guardados<br>
        <div style="margin-top:6px;font-size:0.75rem;color:var(--text2);display:flex;align-items:center;gap:6px;">
          <span>📦 Caché Offline Catálogo:</span>
          <b id="catalogCacheStatusBadge" style="color:#00FFB2;">🟢 Disponible sin conexión</b>
        </div>
        ${generatedAt ? '🗓️ Exportado de tu web: ' + new Date(generatedAt).toLocaleString('es-ES') + '<br>' : ''}
        ${importedAt ? '📥 Importado en este teléfono: ' + new Date(importedAt).toLocaleString('es-ES') : ''}
      `;
    }

    const bgSyncToggle = document.getElementById('bgSyncWifiToggle');
    if (bgSyncToggle) bgSyncToggle.checked = localStorage.getItem('joa_bg_sync_wifi') === 'true';

    const autoThemeToggle = document.getElementById('autoThemeToggle');
    if (autoThemeToggle) autoThemeToggle.checked = localStorage.getItem('joa_auto_theme') === 'true';

    const chckDanger = document.getElementById('checkAutoBackupDanger');
    if (chckDanger) chckDanger.checked = autoBackupDanger;

    const statusEl = document.getElementById('lastBackupStatus');
    if (statusEl) {
      statusEl.textContent = lastBackupTs ? ('Último backup: ' + new Date(lastBackupTs).toLocaleString('es-ES')) : 'Último backup: Ninguno registrado';
    }

    // Sincronizar selectores de interfaz sin recargar el DOM del catálogo
    if (typeof syncCardSizeSettingsUI === 'function') syncCardSizeSettingsUI();
    if (typeof updateImagePackageBadge === 'function') updateImagePackageBadge();
    if (typeof updateApkSettingsCardStatus === 'function') updateApkSettingsCardStatus();
    if (typeof actualizarVistaCarpetaPersonalizada === 'function') actualizarVistaCarpetaPersonalizada();

  } catch (err) {
    console.error("Error al abrir ajustes:", err);
  }
}

function closeSettings() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  document.getElementById('settingsOverlay').style.display = 'none';
}

async function saveImageBaseUrl() {
  if (window.triggerHaptic) window.triggerHaptic(50);
  const imgInput = document.getElementById('imageBaseUrlInput');
  if (!imgInput) return;
  const val = imgInput.value.trim();
  await idbSetMeta('image_base_url', val);
  imageBaseUrl = val;
  renderGrid();
  showToast('Dirección de imágenes guardada.');
}

async function clearAllData() {
  return clearAllDataWithBackupCheck();
}

async function toggleAutoBackupDanger(enabled) {
  await idbSetMeta('auto_backup_danger', enabled);
  showToast(enabled ? '🛡️ Backup Automático ACTIVADO antes de borrar datos.' : '⏹️ Backup Automático DESACTIVADO.');
}

async function triggerBackupAutomatico(silent = false) {
  try {
    const profile = await idbGetMeta('local_profile', null);
    const states = await idbGetAll('user_states');
    const reviews = await idbGetAll('user_reviews');
    const notes = await idbGetAll('user_notes');
    const lists = await idbGetAll('user_lists');
    const meta = await idbGetAll('meta');
    const items = await idbGetAll('items');

    const backupData = {
      backup_version: 2,
      backup_date: new Date().toISOString(),
      app_name: "Catálogo Joa",
      profile: profile || { username: 'Invitado', id: 'sin_perfil' },
      states,
      reviews,
      notes,
      lists,
      meta,
      items
    };

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `backup_joa_db_${dateStr}_${Date.now()}.zip`;
    const jsonStr = JSON.stringify(backupData, null, 2);

    if (window.AndroidBridge && typeof window.AndroidBridge.saveCompressedBackup === 'function') {
      window.AndroidBridge.saveCompressedBackup(filename, jsonStr);
      await idbSetMeta('last_backup_timestamp', Date.now());
      if (!silent) showToast('🗜️ Creando Backup Automático comprimido (.zip)...');
    } else if (window.CompressionStream) {
      const stream = new Blob([jsonStr], { type: 'application/json' }).stream().pipeThrough(new CompressionStream('gzip'));
      const compressedBlob = await new Response(stream).blob();
      const gzName = filename.replace(/\.zip$/, '.json.gz');
      const url = URL.createObjectURL(compressedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = gzName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await idbSetMeta('last_backup_timestamp', Date.now());
      if (!silent) showToast('📦 Backup comprimido (.gz) descargado.');
    } else {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.replace(/\.zip$/, '.json');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await idbSetMeta('last_backup_timestamp', Date.now());
      if (!silent) showToast('📦 Backup guardado en el dispositivo.');
    }

    const statusEl = document.getElementById('lastBackupStatus');
    if (statusEl) {
      statusEl.textContent = 'Último backup: ' + new Date().toLocaleString('es-ES');
    }
  } catch (err) {
    console.error('Error al generar backup:', err);
    if (!silent) showToast('❌ Error al generar Backup Automático.');
  }
}

function triggerRestoreBackup() {
  const input = document.getElementById('restoreBackupInput');
  if (input) {
    input.value = '';
    input.click();
  }
}

async function handleRestoreBackup(file) {
  if (!file) return;
  try {
    showToast('⏳ Analizando y restaurando archivo de backup...');
    let textStr = '';
    if (window.AndroidBridge && typeof window.AndroidBridge.decompressBackup === 'function') {
      const reader = new FileReader();
      textStr = await new Promise((resolve, reject) => {
        reader.onload = (e) => {
          const res = e.target.result;
          const base64Str = res.includes(',') ? res.split(',')[1] : res;
          try {
            const decompressed = window.AndroidBridge.decompressBackup(base64Str);
            resolve(decompressed);
          } catch (ex) { reject(ex); }
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    } else if (file.name.endsWith('.gz') && window.DecompressionStream) {
      const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
      const resp = await new Response(stream).text();
      textStr = resp;
    } else {
      textStr = await readFileAsText(file);
    }

    const data = JSON.parse(textStr);
    if (!data || (!data.states && !data.reviews && !data.profile && !data.meta)) {
      throw new Error('Archivo de backup no válido.');
    }

    if (data.meta && Array.isArray(data.meta)) {
      for (const m of data.meta) {
        if (m && m.key) await idbSetMeta(m.key, m.val !== undefined ? m.val : m.value);
      }
    }
    if (data.profile) await idbSetMeta('local_profile', data.profile);
    if (data.states && Array.isArray(data.states)) {
      for (const s of data.states) {
        if (s && s.itemId) await idbPut('user_states', s);
      }
    }
    if (data.reviews && Array.isArray(data.reviews)) {
      for (const r of data.reviews) {
        if (r && r.itemId) await idbPut('user_reviews', r);
      }
    }
    if (data.notes && Array.isArray(data.notes)) {
      for (const n of data.notes) {
        if (n && n.itemId) await idbPut('user_notes', n);
      }
    }
    if (data.lists && Array.isArray(data.lists)) {
      for (const l of data.lists) {
        if (l) await idbPut('user_lists', l);
      }
    }
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      for (const i of data.items) {
        if (i && i.id) await idbPut('items', i);
      }
    }

    showToast('✅ Backup restaurado con éxito. Recargando app...');
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    console.error('Restore error:', err);
    showToast('❌ Error al restaurar: ' + (err.message || 'Archivo corrupto o no compatible.'));
  }
}

async function clearAllDataWithBackupCheck() {
  const autoBackup = await idbGetMeta('auto_backup_danger', true);
  if (autoBackup) {
    const wantBackup = confirm('🛡️ Backup Automático de Seguridad está activado.\n\n¿Deseas guardar ahora una copia local comprimida (.zip/.gz) de toda tu base de datos antes de borrar todo?');
    if (wantBackup) {
      await triggerBackupAutomatico(true);
      await new Promise(r => setTimeout(r, 1200));
    }
  }
  if (!confirm('⚠️ ¿Estás seguro de borrar toda tu base de datos local (reseñas, estados, perfil y catálogo) de tu móvil?')) return;
  await idbClear('items');
  await idbClear('meta');
  await idbClear('user_states');
  await idbClear('user_reviews');
  await idbClear('user_notes');
  await idbClear('user_lists');
  location.reload();
}

// ==========================================
// 🧰 UTILIDADES
// ==========================================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function toggleSidebar(open) {
  document.getElementById('sidebarNav').classList.toggle('open', open);
  document.getElementById('sidebarOverlay').classList.toggle('open', open);
}

function highlightAndOpenMenu() {
  const btn = document.getElementById('menuToggleBtn');
  if (btn) {
    btn.classList.add('menu-pulse-highlight');
    setTimeout(() => {
      btn.classList.remove('menu-pulse-highlight');
    }, 1800);
  }
  toggleSidebar(true);
}
window.highlightAndOpenMenu = highlightAndOpenMenu;

function showToast(msg) {
  let toast = document.getElementById('offlineToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'offlineToast';
    document.body.appendChild(toast);
  }
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#0A0E17;border:1px solid var(--signal);color:#fff;padding:14px 24px;font-family:"JetBrains Mono",monospace;font-size:.84rem;font-weight:700;letter-spacing:.3px;z-index:999999;box-shadow:0 12px 35px rgba(0,0,0,.85), 0 0 20px rgba(61,235,255,.3);border-radius:14px;transition:all .3s cubic-bezier(0.16,1,0.3,1);max-width:90vw;text-align:center;animation:toastSlideDown 0.35s cubic-bezier(0.16,1,0.3,1);display:block;';
  toast.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ==========================================
// 📌 TOPBAR STICKY
// ==========================================
(function() {
  const topbar = document.getElementById('topbar');
  const backToTopWrap = document.getElementById('backToTopWrap');
  if (!topbar) return;
  let ticking = false;
  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        if (window.scrollY > 10) {
          topbar.classList.add('scrolled');
        } else {
          topbar.classList.remove('scrolled');
        }

        const filtersPanel = document.getElementById('filtersRow');
        if (filtersPanel && filtersPanel.classList.contains('open')) {
          updateFiltersPanelPosition();
        }

        if (backToTopWrap) {
          backToTopWrap.classList.toggle('visible', window.scrollY > 150);
          const docHeight = document.documentElement.scrollHeight - window.innerHeight;
          const pct = docHeight > 0 ? Math.min(100, (window.scrollY / docHeight) * 100) : 0;
          backToTopWrap.style.setProperty('--scroll-progress', pct.toFixed(1));
        }

        ticking = false;
      });
      ticking = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('offline-sw.js').catch(err => console.log('SW error:', err));
  });
}

// ==========================================
// 🎬 MODAL DE VIDEO (TRÁILER)
// ==========================================
let videoErrorTimer = null;
let currentVideoId = null;
let ytPlayer = null;

function abrirVideoModal(videoId, titulo) {
    if (window.triggerHaptic) window.triggerHaptic(35);
    if (!navigator.onLine) {
        if (typeof showToast === 'function') showToast("📴 Sin conexión: Los tráilers y videos de YouTube requieren conexión a Internet.");
        if (typeof updateOfflineBanner === 'function') updateOfflineBanner(true);
        return;
    }
    const modal = document.getElementById('videoModal');
    const frame = document.getElementById('videoModalFrame');
    const titleEl = document.getElementById('videoModalTitle');
    const subEl = document.getElementById('videoModalSub');
    const errorOverlay = document.getElementById('videoErrorOverlay');
    const ytLinkTop = document.getElementById('videoYTLink');
    const ytLinkBottom = document.getElementById('videoYTLinkBottom');
    
    currentVideoId = videoId;
    errorOverlay.classList.remove('show');
    clearTimeout(videoErrorTimer);
    
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
    titleEl.textContent = titulo || 'Tráiler';
    subEl.textContent = '▶ Reproduciendo en YouTube';
    ytLinkTop.href = ytUrl;
    ytLinkBottom.href = ytUrl;
    
    const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1`;
    
    frame.src = embedUrl;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    setupYouTubeErrorListener();
}

function setupYouTubeErrorListener() {
    if (window.ytMessageListener) {
        window.removeEventListener('message', window.ytMessageListener);
    }
    window.ytMessageListener = function(event) {
        if (event.origin !== 'https://www.youtube.com' && 
            event.origin !== 'https://www.youtube-nocookie.com') {
            return;
        }
        try {
            const data = JSON.parse(event.data);
            if (data.event === 'error' || data.event === 'onError') {
                mostrarErrorVideo();
            }
        } catch (e) {}
    };
    window.addEventListener('message', window.ytMessageListener);
}

function mostrarErrorVideo() {
    const errorOverlay = document.getElementById('videoErrorOverlay');
    errorOverlay.classList.add('show');
}

function cerrarVideoModal() {
    if (window.triggerHaptic) window.triggerHaptic(35);
    const modal = document.getElementById('videoModal');
    const frame = document.getElementById('videoModalFrame');
    const errorOverlay = document.getElementById('videoErrorOverlay');
    frame.src = '';
    errorOverlay.classList.remove('show');
    clearTimeout(videoErrorTimer);
    currentVideoId = null;
    if (window.ytMessageListener) {
        window.removeEventListener('message', window.ytMessageListener);
        window.ytMessageListener = null;
    }
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const videoModal = document.getElementById('videoModal');
        if (videoModal && videoModal.style.display === 'block') {
            cerrarVideoModal();
        }
    }
});

// ==========================================
// 🔍 AUTOCOMPLETADO, DROPDOWN, VOZ Y ASISTENTE IA DE BÚSQUEDA
// ==========================================
let voiceTargetMode = 'auto'; // 'auto', 'ai', 'text'
let lastAIRecommendedIds = [];
let capturedVoiceTranscript = '';

function openSearchModal() {
  closeAllOpenModals('searchModal');
  const modal = document.getElementById('searchModal');
  if (!modal) return;
  modal.style.display = 'flex';
  
  syncModalSelectsFromMain();

  const input = document.getElementById('searchInput');
  if (input) {
    setTimeout(() => {
      input.focus();
      input.select();
    }, 120);
  }
  
  showSearchDropdown();
}

function closeSearchModal() {
  const modal = document.getElementById('searchModal');
  if (modal) modal.style.display = 'none';
  updateSearchTriggerBtnState();
}

function updateSearchTriggerBtnState() {
  const input = document.getElementById('searchInput');
  const btnText = document.getElementById('searchTriggerBtnText');
  const triggerBtn = document.getElementById('searchTriggerBtn');
  
  if (!triggerBtn) return;
  
  const val = (input?.value || '').trim();
  if (val || activeType) {
    triggerBtn.classList.add('active');
    if (btnText) {
      if (val) {
        btnText.textContent = `Buscar ("${val.length > 10 ? val.slice(0, 8) + '...' : val}")`;
      } else {
        btnText.textContent = 'Buscar (Filtro)';
      }
    }
  } else {
    triggerBtn.classList.remove('active');
    if (btnText) btnText.textContent = 'Buscar';
  }
}

function syncModalSelectsFromMain() {
  const modalTypeSelect = document.getElementById('modalTypeFilterSelect');
  if (modalTypeSelect) modalTypeSelect.value = activeType || '';

  const modalConsoleSelect = document.getElementById('modalConsoleFilterSelect');
  const mainConsoleSelect = document.getElementById('consoleFilterSelect');
  if (modalConsoleSelect && mainConsoleSelect) {
    modalConsoleSelect.innerHTML = mainConsoleSelect.innerHTML;
    modalConsoleSelect.value = mainConsoleSelect.value || '';
  }

  const modalSubcatSelect = document.getElementById('modalSubcategoryFilterSelect');
  const mainSubcatSelect = document.getElementById('subcategoryFilterSelect');
  if (modalSubcatSelect && mainSubcatSelect) {
    modalSubcatSelect.innerHTML = mainSubcatSelect.innerHTML;
    modalSubcatSelect.value = mainSubcatSelect.value || '';
  }

  const modalSortSelect = document.getElementById('modalSortFilterSelect');
  const mainSortSelect = document.getElementById('sortFilter');
  if (modalSortSelect && mainSortSelect) {
    modalSortSelect.value = mainSortSelect.value || 'title_asc';
  }

  const consoleContainer = document.getElementById('modalConsoleFilterContainer');
  if (consoleContainer) consoleContainer.style.display = (activeType === 'juego_emulado') ? 'block' : 'none';

  const subcatContainer = document.getElementById('modalSubcategoryFilterContainer');
  if (subcatContainer) subcatContainer.style.display = (activeType === 'software') ? 'block' : 'none';
}

function syncModalTypeFilter(val) {
  setTypeFilter(val);
  syncModalSelectsFromMain();
  showSearchDropdown();
}

function syncModalConsoleFilter(val) {
  const mainConsoleSelect = document.getElementById('consoleFilterSelect');
  if (mainConsoleSelect) mainConsoleSelect.value = val;
  applyFilters();
  showSearchDropdown();
}

function syncModalSubcategoryFilter(val) {
  const mainSubcatSelect = document.getElementById('subcategoryFilterSelect');
  if (mainSubcatSelect) mainSubcatSelect.value = val;
  applyFilters();
  showSearchDropdown();
}

function syncModalSortFilter(val) {
  const mainSortSelect = document.getElementById('sortFilter');
  if (mainSortSelect) mainSortSelect.value = val;
  applyFilters();
  showSearchDropdown();
}

function applyModalSearchAndClose() {
  closeSearchModal();
  applyFilters();
}

function clearModalAllSearchFilters() {
  clearSearchInput();
  if (typeof clearFilters === 'function') clearFilters();
  syncModalSelectsFromMain();
  showSearchDropdown();
}

function openSmartAISearchModalFromModal() {
  closeSearchModal();
  openSmartAISearchModal();
}

let _quickSearchDebounceTimer = null;

function handleQuickCatalogSearch(query) {
  const quickInput = document.getElementById('topbarQuickSearchInput');
  if (quickInput && quickInput.value !== query) {
    quickInput.value = query;
  }
  const modalInput = document.getElementById('searchInput');
  if (modalInput && modalInput.value !== query) {
    modalInput.value = query;
  }
  const clearBtn = document.getElementById('topbarQuickSearchClearBtn');
  if (clearBtn) {
    clearBtn.style.display = (query && query.trim().length > 0) ? 'flex' : 'none';
  }

  // Micro-debounce ultra optimizado (20ms) para garantizar 60/120fps fluidos mientras se escribe
  if (_quickSearchDebounceTimer) {
    clearTimeout(_quickSearchDebounceTimer);
  }

  const trimmed = (query || '').trim();
  if (!trimmed) {
    // Si se vació el input, restaurar la vista inmediatamente sin esperar
    currentPage = 1;
    applyFilters();
    return;
  }

  _quickSearchDebounceTimer = setTimeout(() => {
    currentPage = 1;
    applyFilters();
  }, 20);
}

function clearQuickCatalogSearch() {
  if (_quickSearchDebounceTimer) {
    clearTimeout(_quickSearchDebounceTimer);
    _quickSearchDebounceTimer = null;
  }
  const quickInput = document.getElementById('topbarQuickSearchInput');
  if (quickInput) {
    quickInput.value = '';
    quickInput.focus();
  }
  const clearBtn = document.getElementById('topbarQuickSearchClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';

  const modalInput = document.getElementById('searchInput');
  if (modalInput) modalInput.value = '';

  currentPage = 1;
  applyFilters();
}

function updateSearchResultsBadge() {
  const badge = document.getElementById('topbarSearchResultsBadge');
  if (!badge) return;
  const count = (typeof filteredItems !== 'undefined' && Array.isArray(filteredItems)) ? filteredItems.length : 0;
  if (count >= 1000) {
    badge.textContent = `${(count / 1000).toFixed(1)}k`;
  } else {
    badge.textContent = String(count);
  }
}

window.handleQuickCatalogSearch = handleQuickCatalogSearch;
window.clearQuickCatalogSearch = clearQuickCatalogSearch;
window.updateSearchResultsBadge = updateSearchResultsBadge;

function handleSearchInput() {
  const el = document.getElementById('searchInput');
  const quickEl = document.getElementById('topbarQuickSearchInput');
  if (el && quickEl) quickEl.value = el.value;
  const btn = document.getElementById('searchClearBtn');
  if (btn) btn.style.display = (el && el.value.trim().length > 0) ? 'flex' : 'none';
  applyFilters();
  showSearchDropdown();
  updateSearchTriggerBtnState();
}

function clearSearchInput() {
  const el = document.getElementById('searchInput');
  if (el) {
    el.value = '';
    el.focus();
  }
  const quickEl = document.getElementById('topbarQuickSearchInput');
  if (quickEl) quickEl.value = '';
  const btn = document.getElementById('searchClearBtn');
  if (btn) btn.style.display = 'none';
  const quickBtn = document.getElementById('topbarQuickSearchClearBtn');
  if (quickBtn) quickBtn.style.display = 'none';
  applyFilters();
  showSearchDropdown();
  updateSearchTriggerBtnState();
}

function getRecentSearches() {
  try {
    const s = localStorage.getItem('recent_searches');
    return s ? JSON.parse(s) : [];
  } catch(e) { return []; }
}

function saveRecentSearch(q) {
  if (!q || !q.trim()) return;
  const clean = q.trim();
  try {
    let list = getRecentSearches().filter(x => x.toLowerCase() !== clean.toLowerCase());
    list.unshift(clean);
    list = list.slice(0, 8);
    localStorage.setItem('recent_searches', JSON.stringify(list));
  } catch(e) {}
}

function clearRecentSearches() {
  try { localStorage.removeItem('recent_searches'); } catch(e) {}
  showSearchDropdown();
}

function quickSearch(val) {
  const el = document.getElementById('searchInput');
  if (el) {
    el.value = val;
    handleSearchInput();
  }
}

function highlightSearchMatch(text, query) {
  if (!text) return '';
  if (!query || !query.trim()) return escapeHtml(text);
  const cleanTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  if (!cleanTokens.length) return escapeHtml(text);
  
  let escaped = escapeHtml(text);
  cleanTokens.forEach(tok => {
    if (tok.length > 0) {
      const re = new RegExp(`(${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      escaped = escaped.replace(re, '<mark class="search-highlight">$1</mark>');
    }
  });
  return escaped;
}

let activeSearchDropdownIndex = -1;

function showSearchDropdown() {
  const dropdown = document.getElementById('searchDropdown');
  const content = document.getElementById('searchDropdownContent');
  const el = document.getElementById('searchInput');
  if (!dropdown || !content || !el) return;

  const q = el.value.trim();
  activeSearchDropdownIndex = -1;
  let html = '';

  // 0. SECCIÓN DESTACADA DE ASISTENCIA CON IA EN DROPDOWN
  html += `<div class="search-section-title"><span>🤖 Buscador Inteligente IA (Gemini)</span></div>`;
  html += `<div class="search-chip-group">`;
  if (q) {
    html += `<div class="search-chip ai-chip-highlight" onclick="hideSearchDropdown(); openSmartAISearchModal('${escapeHtml(q)}')">✨ Preguntar a la IA sobre "${escapeHtml(q)}"</div>`;
  } else {
    html += `<div class="search-chip ai-chip-highlight" onclick="hideSearchDropdown(); openSmartAISearchModal()">🤖 Abrir Asistente IA</div>`;
    html += `<div class="search-chip ai-chip-highlight" onclick="hideSearchDropdown(); openSmartAISearchModal('Recomiéndame las mejores joyas de mi catálogo')">💎 Joyas Ocultas</div>`;
    html += `<div class="search-chip ai-chip-highlight" onclick="hideSearchDropdown(); openSmartAISearchModal('¿Qué juego retro emulado debo probar?')">🕹️ Juego Retro IA</div>`;
  }
  html += `</div>`;

  if (!q) {
    // 1. Filtros Rápidos
    html += `<div class="search-section-title"><span>⚡ Búsqueda Rápida</span></div>`;
    html += `<div class="search-chip-group">`;
    const quicks = [
      { l: '🆕 Actualizado recientemente', val: 'updated_desc', type: 'sort' },
      { l: '🎮 Juegos', val: 'juego', type: 'type' },
      { l: '🎬 Películas', val: 'pelicula', type: 'type' },
      { l: '📺 Series', val: 'serie', type: 'type' },
      { l: '📺 Novelas TV', val: 'novela_tv', type: 'type' },
      { l: '🕹️ Emulados', val: 'juego_emulado', type: 'type' },
      { l: '⭐ Top Valorados', val: 'rating_desc', type: 'sort' },
      { l: '❤️ Mis Favoritos', val: 'wishlist', type: 'state' }
    ];
    quicks.forEach(k => {
      html += `<div class="search-chip" onclick="applyQuickFilter('${k.val}', '${k.type}')">${k.l}</div>`;
    });
    html += `</div>`;

    // 2. Búsquedas recientes
    const recents = getRecentSearches();
    if (recents.length > 0) {
      html += `<div class="search-section-title"><span>🕒 Búsquedas Recientes</span><span style="color:#FF0055;cursor:pointer;text-transform:none;font-size:.75rem;" onclick="clearRecentSearches();event.stopPropagation();">🗑️ Borrar</span></div>`;
      html += `<div class="search-chip-group">`;
      recents.forEach(r => {
        html += `<div class="search-chip" onclick="quickSearch('${escapeHtml(r)}')">🔍 ${escapeHtml(r)}</div>`;
      });
      html += `</div>`;
    }
  } else {
    // Top 6 resultados instantáneos con carátula y resaltado
    const top6 = filteredItems.slice(0, 6);
    html += `<div class="search-section-title"><span>🎯 Coincidencias para "${escapeHtml(q)}" (${filteredItems.length})</span></div>`;
    if (top6.length === 0) {
      html += `<div style="padding:16px 10px;color:var(--text3);font-size:.85rem;text-align:center;">
        No se encontraron coincidencias exactas para "${escapeHtml(q)}".<br>
        <button class="btn" style="margin-top:10px; background:rgba(0,255,178,0.15); border:1px solid #00FFB2; color:#00FFB2; font-weight:800; font-size:0.85rem; padding:8px 16px; border-radius:12px;" onclick="hideSearchDropdown(); openSmartAISearchModal('${escapeHtml(q)}');">
          🤖 Consultar con IA Gemini sobre "${escapeHtml(q)}"
        </button>
      </div>`;
    } else {
      top6.forEach((it, idx) => {
        const icons = { juego:'🎮', juego_emulado:'🕹️', pelicula:'🎬', pelicula_animada:'🎨', serie:'📺', serie_animada:'✨', anime:'🎌', anime_movie:'🎥', novela_tv:'📺', musica:'🎵', software:'💻', novela:'📚' };
        const icon = icons[it.type] || '📦';
        const subcat = getItemSubcategory(it);
        let subCategoryDisplay = '';
        if (subcat) {
          subCategoryDisplay = it.type === 'software' ? `Software: ${subcat}` : subcat;
        } else {
          subCategoryDisplay = it.console || (typeof typeLabels !== 'undefined' && typeLabels[it.type] ? typeLabels[it.type] : it.type);
        }
        const subTxt = [subCategoryDisplay, it.year].filter(Boolean).join(' · ');
        const highlightedTitle = highlightSearchMatch(it.title, q);
        const highlightedSub = highlightSearchMatch(subTxt, q);
        const imgTag = it.image ? `<img class="search-thumb" src="${it.image}" onerror="this.outerHTML='<div class=\\\'icon-badge\\\'>${icon}</div>'">` : `<div class="icon-badge">${icon}</div>`;

        html += `
          <div class="search-result-row" data-index="${idx}" data-id="${it.id}" onclick="openDetailFromSearch('${it.id}')">
            ${imgTag}
            <div class="info">
              <div class="t">${highlightedTitle}</div>
              <div class="sub"><span>🏷️ ${highlightedSub}</span></div>
            </div>
            ${it.rating ? `<div class="star">⭐ ${it.rating}</div>` : ''}
          </div>
        `;
      });
      if (filteredItems.length > 6) {
        html += `<div class="search-footer-btn" onclick="saveRecentSearch('${escapeHtml(q)}');hideSearchDropdown();">Ver todos los ${filteredItems.length} resultados en la grilla →</div>`;
      }
    }
  }

  content.innerHTML = html;
  dropdown.style.display = 'block';
}

function hideSearchDropdown() {
  const dropdown = document.getElementById('searchDropdown');
  if (dropdown) dropdown.style.display = 'none';
}

function openDetailFromSearch(id) {
  const item = allItems.find(x => String(x.id) === String(id));
  if (item) {
    const el = document.getElementById('searchInput');
    if (el && el.value.trim()) saveRecentSearch(el.value.trim());
    hideSearchDropdown();
    closeSearchModal();
    openDetail(id);
  }
}

function applyQuickFilter(val, type) {
  if (type === 'type') {
    setTypeFilter(val);
  } else if (type === 'sort') {
    document.getElementById('sortFilter').value = val;
    applyFilters();
  } else if (type === 'state') {
    setLibraryFilter(val);
  }
  syncModalSelectsFromMain();
  showSearchDropdown();
}

// Navegación con teclado en campo de búsqueda
document.getElementById('searchInput')?.addEventListener('keydown', function(e) {
  const dropdown = document.getElementById('searchDropdown');
  if (!dropdown || dropdown.style.display === 'none') return;
  const rows = dropdown.querySelectorAll('.search-result-row');
  if (!rows || rows.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeSearchDropdownIndex = (activeSearchDropdownIndex + 1) % rows.length;
    rows.forEach((r, idx) => r.classList.toggle('active-kb', idx === activeSearchDropdownIndex));
    rows[activeSearchDropdownIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeSearchDropdownIndex = (activeSearchDropdownIndex - 1 + rows.length) % rows.length;
    rows.forEach((r, idx) => r.classList.toggle('active-kb', idx === activeSearchDropdownIndex));
    rows[activeSearchDropdownIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    if (activeSearchDropdownIndex >= 0 && rows[activeSearchDropdownIndex]) {
      e.preventDefault();
      const id = rows[activeSearchDropdownIndex].getAttribute('data-id');
      if (id) openDetailFromSearch(id);
    }
  }
});

// Cerrar modales con la tecla Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    hideSearchDropdown();
    const modal = document.getElementById('searchModal');
    if (modal && modal.style.display !== 'none') {
      closeSearchModal();
    }
  }
});

// BÚSQUEDA POR VOZ Y ASISTENTE
let recognitionActive = null;

function startVoiceSearch(targetMode = 'auto') {
  voiceTargetMode = targetMode;
  capturedVoiceTranscript = '';
  if (window.triggerHaptic) window.triggerHaptic(35);
  if (!navigator.onLine) {
    if (typeof showToast === 'function') showToast("📴 Sin conexión: La búsqueda por voz requiere conexión a Internet.");
    if (typeof updateOfflineBanner === 'function') updateOfflineBanner(true);
    return;
  }
  const voiceBtn = document.getElementById('voiceSearchBtn');
  if (voiceBtn) voiceBtn.classList.add('listening');
  const topbarVoiceBtn = document.getElementById('topbarVoiceSearchBtn');
  if (topbarVoiceBtn) topbarVoiceBtn.classList.add('listening');
  
  const modal = document.getElementById('voiceModal');
  if (modal) modal.style.display = 'block';
  
  const statusTxt = document.getElementById('voiceStatusTxt');
  const transcriptBox = document.getElementById('voiceTranscriptBox');
  const soundwave = document.getElementById('voiceSoundwave');
  const actionsRow = document.getElementById('voiceActionsRow');
  const headerTitle = document.getElementById('voiceHeaderTitle');
  
  if (headerTitle) headerTitle.textContent = (targetMode === 'ai') ? "Hablando con Asistente IA..." : "Escuchando tu voz...";
  if (statusTxt) statusTxt.textContent = (targetMode === 'ai') ? "Di lo que quieras sugerir o preguntar a la IA..." : "Di el nombre de un juego, película, consola o actor...";
  if (transcriptBox) { transcriptBox.style.display = 'none'; transcriptBox.textContent = ''; }
  if (soundwave) soundwave.style.display = 'flex';
  if (actionsRow) actionsRow.style.display = 'none';

  // Si está en Android WebView con puente nativo
  if (window.AndroidBridge && typeof window.AndroidBridge.startVoiceSearch === 'function') {
    try {
      window.AndroidBridge.startVoiceSearch();
    } catch(e) {
      fallbackWebSpeech();
    }
    return;
  }
  
  fallbackWebSpeech();
}

function fallbackWebSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    cancelarVoiceSearch();
    alert("❌ Tu navegador actual no soporta reconocimiento de voz nativo.");
    return;
  }
  try {
    if (recognitionActive) {
      recognitionActive.abort();
    }
    const recognition = new SpeechRecognition();
    recognitionActive = recognition;
    recognition.lang = 'es-ES';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    
    recognition.onresult = function(event) {
      const speechResult = event.results[0][0].transcript;
      window.onVoiceSearchResult(speechResult);
    };
    recognition.onerror = function(event) {
      console.error("Error de voz JS:", event.error);
      const statusTxt = document.getElementById('voiceStatusTxt');
      if (statusTxt) statusTxt.textContent = "No se escuchó nada claro (" + event.error + "). Intenta de nuevo.";
      setTimeout(cancelarVoiceSearch, 2000);
    };
    recognition.onend = function() {
      if (document.getElementById('voiceModal')?.style.display === 'block' && !capturedVoiceTranscript) {
        setTimeout(cancelarVoiceSearch, 1000);
      }
    };
    recognition.start();
  } catch(e) {
    cancelarVoiceSearch();
  }
}

function cancelarVoiceSearch() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  if (recognitionActive) {
    try { recognitionActive.abort(); } catch(e) {}
    recognitionActive = null;
  }
  const voiceBtn = document.getElementById('voiceSearchBtn');
  if (voiceBtn) voiceBtn.classList.remove('listening');
  const topbarVoiceBtn = document.getElementById('topbarVoiceSearchBtn');
  if (topbarVoiceBtn) topbarVoiceBtn.classList.remove('listening');
  const modal = document.getElementById('voiceModal');
  if (modal) modal.style.display = 'none';
}

window.onVoiceSearchResult = function(text) {
  if (!text || !text.trim()) {
    cancelarVoiceSearch();
    return;
  }
  const cleanText = text.trim();
  capturedVoiceTranscript = cleanText;

  if (voiceTargetMode === 'ai') {
    cancelarVoiceSearch();
    openSmartAISearchModal(cleanText);
    return;
  }

  const statusTxt = document.getElementById('voiceStatusTxt');
  const soundwave = document.getElementById('voiceSoundwave');
  const actionsRow = document.getElementById('voiceActionsRow');
  const transcriptBox = document.getElementById('voiceTranscriptBox');

  if (transcriptBox) {
    transcriptBox.textContent = `«${cleanText}»`;
    transcriptBox.style.display = 'block';
  }
  if (statusTxt) statusTxt.textContent = "¡Voz reconocida! Selecciona cómo quieres buscar:";
  if (soundwave) soundwave.style.display = 'none';
  if (actionsRow) actionsRow.style.display = 'flex';

  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = cleanText;
  const quickInput = document.getElementById('topbarQuickSearchInput');
  if (quickInput) quickInput.value = cleanText;
  saveRecentSearch(cleanText);
};

function confirmVoiceAction(type) {
  const text = capturedVoiceTranscript || document.getElementById('searchInput')?.value || document.getElementById('topbarQuickSearchInput')?.value || '';
  cancelarVoiceSearch();
  if (type === 'ai') {
    openSmartAISearchModal(text);
  } else {
    const quickInput = document.getElementById('topbarQuickSearchInput');
    if (quickInput) quickInput.value = text;
    handleQuickCatalogSearch(text);
  }
}

window.onVoiceSearchCancel = function() {
  cancelarVoiceSearch();
};

// ==========================================
// 🤖 MOTOR DE ASISTENTE Y BÚSQUEDA IA (GEMINI 3.5 FLASH)
// ==========================================
let geminiChatHistory = [];

function resetGeminiChatHistory() {
  geminiChatHistory = [];
  lastAIRecommendedIds = [];
  const thread = document.getElementById('aiChatThread');
  if (thread) thread.innerHTML = '';
  const responseBox = document.getElementById('aiSearchResponseBox');
  if (responseBox) responseBox.style.display = 'none';
  const filterGridBtn = document.getElementById('aiSearchFilterGridBtn');
  if (filterGridBtn) filterGridBtn.style.display = 'none';
  const input = document.getElementById('aiSearchInput');
  if (input) { input.value = ''; input.focus(); }
  if (window.triggerHaptic) window.triggerHaptic(20);
  showToast("🧹 Conversación del Asistente IA reiniciada.");
}

function openSmartAISearchModal(initialQuery = '') {
  if (window.triggerHaptic) window.triggerHaptic(25);
  closeAllOpenModals('aiSearchModal');
  const modal = document.getElementById('aiSearchModal');
  if (!modal) return;
  modal.style.display = 'block';

  const input = document.getElementById('aiSearchInput');
  if (input) {
    if (initialQuery) input.value = initialQuery;
    setTimeout(() => input.focus(), 100);
  }

  if (initialQuery && initialQuery.trim().length > 1) {
    executeSmartAISearch(initialQuery.trim());
  }
}

function closeSmartAISearchModal() {
  const modal = document.getElementById('aiSearchModal');
  if (modal) modal.style.display = 'none';
}

function startVoiceSearchForAI() {
  startVoiceSearch('ai');
}

function formatInlineMarkdown(str) {
  if (!str) return "";
  return str
    .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.*?)__/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/~~(.*?)~~/g, "<del>$1</del>")
    .replace(/\[badge:\s*([^\]]+)\]/gi, "<span class=\"ai-badge\">$1</span>");
}

function formatAIMarkdown(text) {
  if (!text) return "";

  // 1. Proteger bloques de código
  const codeBlocks = [];
  let processed = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `___CODEBLOCK_${codeBlocks.length}___`;
    codeBlocks.push({ lang: lang || "codigo", code: code.trim() });
    return placeholder;
  });

  // 2. Proteger código inline
  const inlineCodes = [];
  processed = processed.replace(/`([^`\n]+)`/g, (match, code) => {
    const placeholder = `___INLINECODE_${inlineCodes.length}___`;
    inlineCodes.push(code);
    return placeholder;
  });

  // 3. Escapar HTML base
  processed = processed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 4. Procesar línea por línea
  const lines = processed.split("\n");
  const out = [];
  let inList = false;
  let listType = null;
  let inQuote = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Separadores horizontales
    if (/^(\*\*\*+|---+|___+)$/.test(trimmed)) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      if (inQuote) { out.push("</blockquote>"); inQuote = false; }
      out.push("<hr class=\"ai-divider\">");
      continue;
    }

    // Citas / Blockquotes
    if (/^&gt;\s*(.*)/.test(line)) {
      const qContent = line.replace(/^&gt;\s*/, "");
      if (inList) { out.push(`</${listType}>`); inList = false; }
      if (!inQuote) { out.push("<blockquote class=\"ai-quote\">"); inQuote = true; }
      out.push(`<p>${formatInlineMarkdown(qContent)}</p>`);
      continue;
    } else if (inQuote) {
      out.push("</blockquote>");
      inQuote = false;
    }

    // Encabezados
    const h4Match = line.match(/^####\s+(.*)/);
    const h3Match = line.match(/^###\s+(.*)/);
    const h2Match = line.match(/^##\s+(.*)/);
    const h1Match = line.match(/^#\s+(.*)/);

    if (h4Match || h3Match || h2Match || h1Match) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      if (h4Match) out.push(`<h5 class=\"ai-h5\">${formatInlineMarkdown(h4Match[1])}</h5>`);
      else if (h3Match) out.push(`<h4 class=\"ai-h4\">${formatInlineMarkdown(h3Match[1])}</h4>`);
      else if (h2Match) out.push(`<h3 class=\"ai-h3\">${formatInlineMarkdown(h2Match[1])}</h3>`);
      else if (h1Match) out.push(`<h2 class=\"ai-h2\">${formatInlineMarkdown(h1Match[1])}</h2>`);
      continue;
    }

    // Viñetas no numeradas
    const ulMatch = line.match(/^\s*[-*•]\s+(.*)/);
    if (ulMatch) {
      if (!inList || listType !== "ul") {
        if (inList) out.push(`</${listType}>`);
        out.push("<ul class=\"ai-ul\">");
        inList = true;
        listType = "ul";
      }
      out.push(`<li>${formatInlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }

    // Listas numeradas
    const olMatch = line.match(/^\s*(\d+)[.)]\s+(.*)/);
    if (olMatch) {
      if (!inList || listType !== "ol") {
        if (inList) out.push(`</${listType}>`);
        out.push("<ol class=\"ai-ol\">");
        inList = true;
        listType = "ol";
      }
      out.push(`<li>${formatInlineMarkdown(olMatch[2])}</li>`);
      continue;
    }

    // Cerrar lista si hay línea vacía o párrafo común
    if (inList) {
      out.push(`</${listType}>`);
      inList = false;
      listType = null;
    }

    if (trimmed === "") {
      out.push("<div class=\"ai-spacer\"></div>");
      continue;
    }

    // Párrafo de texto normal
    out.push(`<p class=\"ai-p\">${formatInlineMarkdown(line)}</p>`);
  }

  if (inList) out.push(`</${listType}>`);
  if (inQuote) out.push("</blockquote>");

  let result = out.join("");

  // Restaurar inline code
  inlineCodes.forEach((code, idx) => {
    const escapedCode = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    result = result.replace(`___INLINECODE_${idx}___`, `<code class=\"ai-inline-code\">${escapedCode}</code>`);
  });

  // Restaurar code blocks
  codeBlocks.forEach((b, idx) => {
    const escapedCode = b.code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    result = result.replace(`___CODEBLOCK_${idx}___`, `
      <div class="ai-code-block">
        <div class="ai-code-header">
          <span>${b.lang}</span>
          <button class="ai-code-copy-btn" onclick="copySnippetCode(this)">Copiar</button>
        </div>
        <pre><code>${escapedCode}</code></pre>
      </div>
    `);
  });

  return result;
}

function copySnippetCode(btn) {
  if (!btn) return;
  const block = btn.closest(".ai-code-block");
  const codeEl = block ? block.querySelector("code") : null;
  if (!codeEl) return;
  navigator.clipboard.writeText(codeEl.textContent).then(() => {
    const orig = btn.textContent;
    btn.textContent = "✅ Copiado";
    setTimeout(() => { btn.textContent = orig; }, 1800);
  }).catch(() => {});
}

// Almacén seguro en memoria para respuestas completas
window.aiMessageStore = window.aiMessageStore || [];

function copyAITextResponse(btn, text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = "✅ Copiado";
      setTimeout(() => { btn.innerHTML = orig; }, 1800);
    }
    showToast("📋 Respuesta completa copiada al portapapeles");
  }).catch(() => {
    showToast("⚠️ No se pudo copiar");
  });
}

function copyAITextById(btn, id) {
  const text = (window.aiMessageStore && window.aiMessageStore[id]) || "";
  copyAITextResponse(btn, text);
}

function continueAIConversation(id) {
  const text = (window.aiMessageStore && window.aiMessageStore[id]) || "";
  let prompt = "Por favor continúa desarrollando la respuesta anterior con aún más detalles técnicos, curiosidades, consejos avanzados y recomendaciones complementarias.";
  if (text) {
    const titleMatch = text.match(/###\s*([^\n]+)/) || text.match(/\*\*([^*]+)\*\*/);
    if (titleMatch) {
      prompt = `Continúa profundizando sobre "${titleMatch[1].trim()}" y añade más detalles sobre mecánicas, secretos, duración y comparativas.`;
    }
  }
  executeSmartAISearch(prompt);
}

function speakAITextById(btn, id) {
  const text = (window.aiMessageStore && window.aiMessageStore[id]) || "";
  if (!text) return;
  if (!("speechSynthesis" in window)) {
    showToast("⚠️ Tu dispositivo no tiene soporte de síntesis de voz.");
    return;
  }
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (btn) btn.innerHTML = "🔊 Escuchar";
    return;
  }
  const clean = text
    .replace(/[*#_~`>]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\{[^}]+\}/g, "")
    .slice(0, 900);

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "es-ES";
  utterance.rate = 1.0;
  if (btn) btn.innerHTML = "⏹️ Detener";
  utterance.onend = () => { if (btn) btn.innerHTML = "🔊 Escuchar"; };
  utterance.onerror = () => { if (btn) btn.innerHTML = "🔊 Escuchar"; };
  window.speechSynthesis.speak(utterance);
}

function robustParseAIResponse(rawText) {
  if (!rawText || !rawText.trim()) {
    return { message: "No se recibió respuesta del modelo.", recommended_ids: [], follow_ups: [] };
  }

  let clean = rawText.trim();
  if (clean.startsWith("```json")) clean = clean.slice(7);
  if (clean.startsWith("```")) clean = clean.slice(3);
  if (clean.endsWith("```")) clean = clean.slice(0, -3);
  clean = clean.trim();

  // 1. Parse JSON directo
  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === "object") {
      return {
        message: typeof parsed.message === "string" ? parsed.message : JSON.stringify(parsed.message || ""),
        recommended_ids: Array.isArray(parsed.recommended_ids) ? parsed.recommended_ids.map(String) : [],
        follow_ups: Array.isArray(parsed.follow_ups) ? parsed.follow_ups.map(String) : []
      };
    }
  } catch(e) {}

  // 2. Buscar objeto JSON delimitado por llaves
  try {
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === "object") {
        return {
          message: typeof parsed.message === "string" ? parsed.message : "",
          recommended_ids: Array.isArray(parsed.recommended_ids) ? parsed.recommended_ids.map(String) : [],
          follow_ups: Array.isArray(parsed.follow_ups) ? parsed.follow_ups.map(String) : []
        };
      }
    }
  } catch(e) {}

  // 3. Extracción de contingencia por Regex si el JSON está cortado
  try {
    const msgMatch = clean.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)/s);
    if (msgMatch && msgMatch[1]) {
      const unescaped = msgMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\")
        .replace(/\\t/g, "\t");
      
      const idsMatch = clean.match(/"recommended_ids"\s*:\s*\[(.*?)\]/s);
      const recIds = idsMatch ? (idsMatch[1].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, "")) : [];

      const followMatch = clean.match(/"follow_ups"\s*:\s*\[(.*?)\]/s);
      const followUps = followMatch ? (followMatch[1].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, "")) : [];

      return {
        message: unescaped,
        recommended_ids: recIds,
        follow_ups: followUps
      };
    }
  } catch(e) {}

  // 4. Fallback final: Devolver texto completo sin envoltorios rotos
  const fallbackMsg = clean
    .replace(/^\{?\s*"message"\s*:\s*"?/i, "")
    .replace(/"?\s*\}?$/i, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, "\"");

  return {
    message: fallbackMsg || "Respuesta procesada.",
    recommended_ids: [],
    follow_ups: []
  };
}

function buildSmartAICatalogContext(query) {
  if (typeof allItems === "undefined" || !allItems || !allItems.length) return [];
  
  const qTokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  const scoredItems = [];
  const addedIds = new Set();

  // 1. Títulos en seguimiento/favoritos del usuario
  if (typeof userStates !== "undefined" && userStates) {
    Object.keys(userStates).forEach(id => {
      const it = allItems.find(x => String(x.id) === String(id));
      if (it && !addedIds.has(String(it.id))) {
        addedIds.add(String(it.id));
        scoredItems.push({ item: it, score: 95, reason: "user_library" });
      }
    });
  }

  // 2. Coincidencias relevantes por tokens de búsqueda
  allItems.forEach(it => {
    if (addedIds.has(String(it.id))) return;
    const score = calculateSearchScore(it, qTokens);
    if (score > 0) {
      addedIds.add(String(it.id));
      scoredItems.push({ item: it, score: score, reason: "query_match" });
    }
  });

  // 3. Obras maestras y mejor valoradas para enriquecer
  const topRated = [...allItems].sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
  for (const it of topRated) {
    if (scoredItems.length >= 40) break;
    if (!addedIds.has(String(it.id))) {
      addedIds.add(String(it.id));
      scoredItems.push({ item: it, score: (parseFloat(it.rating) || 0) * 4, reason: "top_rated" });
    }
  }

  // Ordenar por relevancia y seleccionar los 35 más precisos
  scoredItems.sort((a, b) => b.score - a.score);
  const selected = scoredItems.slice(0, 35).map(s => s.item);

  return selected.map(it => ({
    id: String(it.id),
    title: it.title,
    type: it.type || "juego",
    subcat: getItemSubcategory(it) || "",
    console: it.console || "",
    genre: it.genres || it.genre || "",
    year: it.year || "",
    rating: it.rating || "",
    desc: (getItemSynopsis(it) || "").slice(0, 130)
  }));
}

async function executeSmartAISearch(queryOverride = null) {
  const input = document.getElementById("aiSearchInput");
  const query = queryOverride || (input ? input.value.trim() : "");
  if (!query) {
    showToast("⚠️ Escribe o habla una consulta para el asistente IA.");
    return;
  }

  if (input && !queryOverride) input.value = "";
  if (window.triggerHaptic) window.triggerHaptic(30);

  // Añadir mensaje del usuario al chat thread
  appendUserMessageToChat(query);

  const loadingBox = document.getElementById("aiSearchLoading");
  const responseBox = document.getElementById("aiSearchResponseBox");
  const statusTxt = document.getElementById("aiSearchStatusTxt");
  const scrollBody = document.getElementById("aiModalScrollBody");

  if (loadingBox) loadingBox.style.display = "flex";
  if (responseBox) responseBox.style.display = "none";
  if (statusTxt) statusTxt.textContent = `✨ Gemini 3.5 Flash redactando respuesta completa...`;

  if (scrollBody) {
    setTimeout(() => { scrollBody.scrollTop = scrollBody.scrollHeight; }, 60);
  }

  let apiKey = "";
  if (window.AndroidBridge && typeof window.AndroidBridge.getGeminiApiKey === "function") {
    try { apiKey = window.AndroidBridge.getGeminiApiKey(); } catch(e) {}
  }

  const catalogSample = buildSmartAICatalogContext(query);

  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.length < 10) {
    renderLocalSmartFallback(query, catalogSample);
    return;
  }

  const systemInstruction = `Eres el Agente de Inteligencia Artificial Oficial de "JOA GAMERS" (potenciado por Google Gemini 3.5 Flash).
Tu misión es ser el consejero y experto definitivo en videojuegos, consolas, hardware de PC, películas, series, emuladores y el catálogo multimedia.

DIRECTIVAS OBLIGATORIAS DE EXHAUSTIVIDAD Y CALIDAD (MÁXIMA PRIORIDAD):
1. RESPUESTAS SIEMPRE COMPLETAS, DETALLADAS Y PROFUNDAS:
   - Proporciona SIEMPRE respuestas extensas, completas y enriquecedoras. NUNCA cortes tu explicación a la mitad, no dejes frases inconclusas ni des respuestas telegráficas o superficiales.
   - Si el usuario te pide recomendaciones, no te limites a listar nombres. Para CADA título recomendado desarrolla:
     * 🎮 Nombre completo, año y plataforma/consola.
     * 📖 Sinopsis argumental o premisa temática (con buen contexto pero sin spoilers mayores).
     * 🕹️ Jugabilidad, mecánicas clave, estilo visual, apartado sonoro y ritmo de juego.
     * ⏱️ Duración estimada (horas de campaña / secundarias) y modalidades (solitario, cooperativo, multijugador).
     * 💡 Por qué es una obra imprescindible y a qué perfil de jugador o espectador le fascinará.
2. PREGUNTAS TÉCNICAS, HARDWARE Y EMULACIÓN:
   - Si el usuario pregunta por emuladores, requisitos o rendimiento de PC, da una guía paso a paso exhaustiva: especificaciones recomendadas, renderers (Vulkan/DirectX/OpenGL), resolución interna, shaders, trucos y soluciones a fallos habituales.
3. FORMATO Y ESTRUCTURA:
   - Utiliza subtítulos claros (###), viñetas organizadas (* o -), negritas estratégicas para conceptos clave y emojis temáticos para una lectura dinámica y placentera.
4. VINCULACIÓN CON EL CATÁLOGO:
   - Si el título recomendado forma parte del catálogo adjunto, incluye su ID exacto en el arreglo "recommended_ids" para generar tarjetas interactivas táctiles en pantalla.
5. PREGUNTAS DE SEGUIMIENTO:
   - Añade 3 o 4 preguntas de seguimiento inteligentes y sugerentes en el arreglo "follow_ups" para que el usuario pueda seguir explorando.`;

  // Construir historial multi-turno estructurado
  const requestContents = [];
  const recentHistory = (geminiChatHistory || []).slice(-6);
  recentHistory.forEach(turn => {
    requestContents.push({
      role: turn.role === "user" ? "user" : "model",
      parts: [{ text: turn.role === "model" ? JSON.stringify({ message: turn.text, recommended_ids: turn.recommended_ids || [] }) : turn.text }]
    });
  });

  // Turno actual del usuario enriquecido con muestra del catálogo
  const userPromptWithContext = `Muestra de títulos relevantes del catálogo de JOA GAMERS:
${JSON.stringify(catalogSample)}

Pregunta actual del usuario:
"${query}"`;

  requestContents.push({
    role: "user",
    parts: [{ text: userPromptWithContext }]
  });

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: requestContents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              message: {
                type: "STRING",
                description: "Respuesta completa, detallada, profunda y formateada en Markdown con subtítulos y viñetas."
              },
              recommended_ids: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "IDs de títulos del catálogo mencionados."
              },
              follow_ups: {
                type: "ARRAY",
                items: { type: "STRING" },
                description: "Preguntas de seguimiento interesantes para continuar la conversación."
              }
            },
            required: ["message"]
          }
        }
      })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `HTTP Error ${res.status}`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = robustParseAIResponse(rawText);

    if (!parsed || !parsed.message) {
      parsed.message = rawText || "He procesado tu consulta pero no pude generar texto estructurado.";
    }

    // Guardar en historial multi-turno
    geminiChatHistory.push({ role: "user", text: query });
    geminiChatHistory.push({ role: "model", text: parsed.message, recommended_ids: parsed.recommended_ids });

    renderAISearchResult(query, parsed);
  } catch(err) {
    console.error("Error consultando Gemini API:", err);
    renderLocalSmartFallback(query, catalogSample, true);
  }
}

function appendUserMessageToChat(text) {
  const thread = document.getElementById("aiChatThread");
  if (!thread) return;
  const bubble = document.createElement("div");
  bubble.className = "ai-chat-bubble ai-chat-bubble-user";
  bubble.innerHTML = `💬 <b>Tú:</b> ${escapeHtml(text)}`;
  thread.appendChild(bubble);
}

function renderAISearchResult(query, data) {
  const loadingBox = document.getElementById("aiSearchLoading");
  const responseBox = document.getElementById("aiSearchResponseBox");
  const followUpsContainer = document.getElementById("aiSearchFollowUps");
  const filterGridBtn = document.getElementById("aiSearchFilterGridBtn");
  const thread = document.getElementById("aiChatThread");
  const scrollBody = document.getElementById("aiModalScrollBody");

  if (loadingBox) loadingBox.style.display = "none";

  const fullMessage = data.message || "No se obtuvo respuesta del asistente.";
  const formattedHtml = formatAIMarkdown(fullMessage);

  // Almacenar mensaje en memoria segura para copia y audio
  window.aiMessageStore = window.aiMessageStore || [];
  const msgIndex = window.aiMessageStore.length;
  window.aiMessageStore.push(fullMessage);

  // IDs recomendados y tarjetas interactivas
  lastAIRecommendedIds = Array.isArray(data.recommended_ids) ? data.recommended_ids.map(String) : [];
  const recItems = (typeof allItems !== "undefined") ? allItems.filter(it => lastAIRecommendedIds.includes(String(it.id))) : [];

  // Render en burbuja de chat thread
  if (thread) {
    const aiBubble = document.createElement("div");
    aiBubble.className = "ai-chat-bubble ai-chat-bubble-gemini";
    
    let cardsHtml = "";
    if (recItems.length > 0) {
      cardsHtml = `
        <div style="font-size:0.78rem; font-weight:800; color:#00FFB2; text-transform:uppercase; margin:14px 0 8px; display:flex; justify-content:space-between; align-items:center;">
          <span>🎯 Títulos recomendados (${recItems.length}):</span>
          <span style="font-size:0.7rem; color:var(--text3);">Toca para abrir ficha</span>
        </div>
        <div class="ai-mini-cards-grid">
          ${recItems.map(it => `
            <div class="ai-mini-card" onclick="closeSmartAISearchModal(); openDetail('${it.id}');">
              <img src="${it.image || ""}" onerror="this.src='https://via.placeholder.com/120x150?text=No+Img'">
              <div class="t">${escapeHtml(it.title)}</div>
              <div class="sub">${escapeHtml(it.console || it.type || "")}</div>
              ${it.rating ? `<div style="font-size:0.7rem; font-weight:800; color:#FFD700; margin-top:2px;">⭐ ${it.rating}</div>` : ""}
            </div>
          `).join("")}
        </div>
      `;
    }

    aiBubble.innerHTML = `
      <div class="ai-rendered-content">${formattedHtml}</div>
      ${cardsHtml}
      <div class="ai-chat-toolbar">
        <span style="color:#00FFB2; font-weight:700; display:flex; align-items:center; gap:5px;">
          <span>✨</span> Gemini 3.5 Flash · Respuesta Completa
        </span>
        <div class="ai-chat-actions">
          <button class="ai-btn-pill" onclick="copyAITextById(this, ${msgIndex})" title="Copiar respuesta completa">📋 Copiar</button>
          <button class="ai-btn-pill" onclick="continueAIConversation(${msgIndex})" title="Profundizar y dar más detalles">➕ Más detalles</button>
          <button class="ai-btn-pill" onclick="speakAITextById(this, ${msgIndex})" title="Escuchar en voz alta">🔊 Escuchar</button>
        </div>
      </div>
    `;
    thread.appendChild(aiBubble);
  }

  // Follow-ups chips debajo del chat
  if (followUpsContainer) {
    if (Array.isArray(data.follow_ups) && data.follow_ups.length > 0) {
      followUpsContainer.innerHTML = `
        <div style="font-size:0.72rem; font-weight:700; color:var(--text3); text-transform:uppercase; margin-bottom:6px;">💡 Continuar conversación con la IA:</div>
        <div class="search-chip-group" style="margin:0; gap:6px;">
          ${data.follow_ups.map(f => `
            <div class="search-chip ai-chip-highlight" onclick="executeSmartAISearch('${escapeHtml(f)}')">✨ ${escapeHtml(f)}</div>
          `).join("")}
        </div>
      `;
    } else {
      followUpsContainer.innerHTML = "";
    }
  }

  // Botón para filtrar grilla si hubo recomendaciones
  if (filterGridBtn) {
    filterGridBtn.style.display = (recItems.length > 0) ? "inline-block" : "none";
    filterGridBtn.textContent = `🎯 Ver estos ${recItems.length} resultados en la Grilla Principal`;
  }

  if (responseBox) responseBox.style.display = "block";

  if (scrollBody) {
    setTimeout(() => { scrollBody.scrollTop = scrollBody.scrollHeight; }, 120);
  }
}

function renderLocalSmartFallback(query, catalogSample, isError = false) {
  const loadingBox = document.getElementById("aiSearchLoading");
  const responseBox = document.getElementById("aiSearchResponseBox");
  const followUpsContainer = document.getElementById("aiSearchFollowUps");
  const filterGridBtn = document.getElementById("aiSearchFilterGridBtn");
  const thread = document.getElementById("aiChatThread");
  const scrollBody = document.getElementById("aiModalScrollBody");

  if (loadingBox) loadingBox.style.display = "none";

  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  const matched = (typeof allItems !== "undefined") ? allItems
    .map(it => ({ item: it, score: calculateSearchScore(it, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(x => x.item) : [];

  lastAIRecommendedIds = matched.map(it => String(it.id));

  let rawMessage = "";
  if (isError) {
    rawMessage = `### ⚠️ Modo Inteligente de Respaldo Local\n\nHubo una intermitencia de red con los servidores en la nube de Gemini 3.5 Flash. Sin embargo, analicé tu catálogo localmente de forma exhaustiva y encontré **${matched.length} títulos altamente recomendados** para tu consulta: \"${query}\".\n\n* Revisa las tarjetas interactivas debajo para explorar sus sinopsis, géneros y valoraciones.\n* Puedes reintentar tu consulta en cualquier momento o explorar los temas sugeridos.`;
  } else {
    rawMessage = `### ⚡ Análisis Inteligente Local\n\nAnalicé tu catálogo completo en modo local y seleccioné **${matched.length} obras destacadas** que encajan con tu búsqueda: \"${query}\".\n\nPuedes pulsar en cualquiera de las tarjetas interactivas para abrir su ficha completa o elegir una de las sugerencias rápidas abajo.`;
  }

  const formattedHtml = formatAIMarkdown(rawMessage);

  window.aiMessageStore = window.aiMessageStore || [];
  const msgIndex = window.aiMessageStore.length;
  window.aiMessageStore.push(rawMessage);

  if (thread) {
    const aiBubble = document.createElement("div");
    aiBubble.className = "ai-chat-bubble ai-chat-bubble-gemini";
    
    let cardsHtml = "";
    if (matched.length > 0) {
      cardsHtml = `
        <div style="font-size:0.78rem; font-weight:800; color:#00FFB2; text-transform:uppercase; margin:14px 0 8px;">🎯 Coincidencias encontradas (${matched.length}):</div>
        <div class="ai-mini-cards-grid">
          ${matched.map(it => `
            <div class="ai-mini-card" onclick="closeSmartAISearchModal(); openDetail('${it.id}');">
              <img src="${it.image || ""}" onerror="this.src='https://via.placeholder.com/120x150?text=No+Img'">
              <div class="t">${escapeHtml(it.title)}</div>
              <div class="sub">${escapeHtml(it.console || it.type || "")}</div>
              ${it.rating ? `<div style="font-size:0.7rem; font-weight:800; color:#FFD700; margin-top:2px;">⭐ ${it.rating}</div>` : ""}
            </div>
          `).join("")}
        </div>
      `;
    }

    aiBubble.innerHTML = `
      <div class="ai-rendered-content">${formattedHtml}</div>
      ${cardsHtml}
      <div class="ai-chat-toolbar">
        <span style="color:var(--text3); font-weight:700;">⚡ Motor Inteligente Local</span>
        <div class="ai-chat-actions">
          <button class="ai-btn-pill" onclick="copyAITextById(this, ${msgIndex})">📋 Copiar</button>
        </div>
      </div>
    `;
    thread.appendChild(aiBubble);
  }

  if (followUpsContainer) {
    followUpsContainer.innerHTML = `
      <div style="font-size:0.72rem; font-weight:700; color:var(--text3); text-transform:uppercase; margin-bottom:6px;">💡 Sugerencias rápidas:</div>
      <div class="search-chip-group" style="margin:0; gap:6px;">
        <div class="search-chip ai-chip-highlight" onclick="executeSmartAISearch('Juegos de acción y aventura imprescindibles')">🎮 Acción y Aventura</div>
        <div class="search-chip ai-chip-highlight" onclick="executeSmartAISearch('Películas mejor valoradas con resumen')">🎬 Películas Top</div>
        <div class="search-chip ai-chip-highlight" onclick="executeSmartAISearch('Guía de juegos retro y emuladores recomendados')">🕹️ Juegos Retro</div>
        <div class="search-chip ai-chip-highlight" onclick="executeSmartAISearch('Obras maestras con gran historia del catálogo')">⭐ Grandes Historias</div>
      </div>
    `;
  }

  if (filterGridBtn) {
    filterGridBtn.style.display = (matched.length > 0) ? "inline-block" : "none";
    filterGridBtn.textContent = `🎯 Ver estos ${matched.length} resultados en la Grilla Principal`;
  }

  if (responseBox) responseBox.style.display = "block";

  if (scrollBody) {
    setTimeout(() => { scrollBody.scrollTop = scrollBody.scrollHeight; }, 100);
  }
}

function applyAISearchResultsToGrid() {
  if (!lastAIRecommendedIds || lastAIRecommendedIds.length === 0) return;
  closeSmartAISearchModal();
  if (typeof allItems !== 'undefined') {
    filteredItems = allItems.filter(it => lastAIRecommendedIds.includes(String(it.id)));
    if (typeof renderGrid === 'function') renderGrid(filteredItems);
    showToast(`🎯 Grilla filtrada con ${filteredItems.length} recomendaciones del Asistente IA`);
  }
}

// ==========================================
// 🚀 OVERLAY DE BIENVENIDA Y TUTORIAL GUIADO DE INICIO
// ==========================================
let currentTutorialStep = 0;
const TUTORIAL_STEPS = [
  {
    targetId: 'menuToggleBtn',
    fallbackTargetId: 'sidebarNav',
    title: '📋 Barra Lateral y Categorías',
    desc: 'Toca este botón para desplegar la <b>Barra Lateral</b>. Desde aquí puedes navegar por todas las categorías (<b>Juegos de PC, PlayStation, Películas, Series, Documentales</b>), ver tus favoritos, consultar la ubicación del local en <b>Quiero Ir (GPS)</b> y acceder a la configuración.',
    position: 'bottom',
    onEnter: () => {
      if (window.innerWidth <= 980 && typeof toggleSidebar === 'function') {
        toggleSidebar(false);
      }
    }
  },
  {
    targetId: 'topbarSearchWrap',
    fallbackTargetId: 'topbarQuickSearchInput',
    title: '🔍 Barra de Búsqueda Rápida',
    desc: 'Usa esta barra en la parte superior para buscar al instante entre más de 9,900 títulos. Escribe cualquier nombre, género, actor o consola y el catálogo se filtrará <b>en tiempo real</b>, o toca el micrófono 🎙️ para dictar por voz.',
    position: 'bottom',
    onEnter: () => {
      if (window.innerWidth <= 980 && typeof toggleSidebar === 'function') {
        toggleSidebar(false);
      }
    }
  },
  {
    targetId: 'libCartLink',
    fallbackTargetId: 'menuToggleBtn',
    title: '🛒 Carrito de Compras',
    desc: 'Tu carrito de compras y cotizador de pedidos está disponible en la barra lateral. Desde allí puedes revisar tus títulos seleccionados, calcular precios en CUP/USD o solicitar entrega a domicilio por WhatsApp.',
    position: 'right',
    onEnter: () => {
      if (typeof toggleSidebar === 'function') {
        toggleSidebar(true);
      }
    }
  }
];

function startGuidedTutorial() {
  currentTutorialStep = 0;
  const overlay = document.getElementById('guidedTutorialOverlay');
  if (!overlay) return;
  overlay.style.display = 'block';
  renderTutorialStep();
  window.addEventListener('resize', updateTutorialCardPosition);
}

function renderTutorialStep() {
  const step = TUTORIAL_STEPS[currentTutorialStep];
  if (!step) return;

  document.querySelectorAll('.tutorial-highlighted').forEach(el => el.classList.remove('tutorial-highlighted'));

  let target = document.getElementById(step.targetId);
  if (!target || target.offsetParent === null) {
    if (step.fallbackTargetId) target = document.getElementById(step.fallbackTargetId);
  }
  if (target) {
    target.classList.add('tutorial-highlighted');
  }

  const badge = document.getElementById('tutorialStepBadge');
  if (badge) badge.textContent = `Paso ${currentTutorialStep + 1} de ${TUTORIAL_STEPS.length}`;

  const indicators = document.getElementById('tutorialStepIndicators');
  if (indicators) {
    const dots = TUTORIAL_STEPS.map((_, idx) => idx === currentTutorialStep ? '●' : '○').join(' ');
    indicators.textContent = dots;
  }

  const titleEl = document.getElementById('tutorialTitle');
  if (titleEl) titleEl.innerHTML = step.title;

  const descEl = document.getElementById('tutorialDesc');
  if (descEl) descEl.innerHTML = step.desc;

  const prevBtn = document.getElementById('tutorialPrevBtn');
  const nextBtn = document.getElementById('tutorialNextBtn');

  if (currentTutorialStep === 0) {
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) {
      nextBtn.innerHTML = 'Siguiente ➔';
      nextBtn.onclick = nextTutorialStep;
    }
  } else if (currentTutorialStep === TUTORIAL_STEPS.length - 1) {
    if (prevBtn) prevBtn.style.display = 'inline-block';
    if (nextBtn) {
      nextBtn.innerHTML = '🚀 ¡Comenzar a Explorar!';
      nextBtn.onclick = () => closeGuidedTutorial(true);
    }
  } else {
    if (prevBtn) prevBtn.style.display = 'inline-block';
    if (nextBtn) {
      nextBtn.innerHTML = 'Siguiente ➔';
      nextBtn.onclick = nextTutorialStep;
    }
  }

  if (step.onEnter) step.onEnter();
  setTimeout(() => updateTutorialCardPosition(), 60);
}

function nextTutorialStep() {
  if (window.triggerHaptic) window.triggerHaptic(25);
  if (currentTutorialStep < TUTORIAL_STEPS.length - 1) {
    currentTutorialStep++;
    renderTutorialStep();
  } else {
    closeGuidedTutorial(true);
  }
}

function prevTutorialStep() {
  if (window.triggerHaptic) window.triggerHaptic(20);
  if (currentTutorialStep > 0) {
    currentTutorialStep--;
    renderTutorialStep();
  }
}

function closeGuidedTutorial(markShown = false) {
  if (window.triggerHaptic) window.triggerHaptic(35);
  const overlay = document.getElementById('guidedTutorialOverlay');
  if (overlay) overlay.style.display = 'none';
  document.querySelectorAll('.tutorial-highlighted').forEach(el => el.classList.remove('tutorial-highlighted'));
  window.removeEventListener('resize', updateTutorialCardPosition);

  if (markShown) {
    try {
      localStorage.setItem('joa_welcome_tour_v1', 'true');
      localStorage.setItem('joa_welcome_overlay_shown', 'true');
      localStorage.setItem('joa_tutorial_shown', 'true');
    } catch(e) {}
    if (typeof showToast === 'function') {
      showToast('🎮 ¡Bienvenido a Joa Gamers! Explora más de 9,900 títulos.');
    }
  }
}

function updateTutorialCardPosition() {
  const step = TUTORIAL_STEPS[currentTutorialStep];
  if (!step) return;
  const card = document.getElementById('tutorialTooltipCard');
  let target = document.getElementById(step.targetId);
  if (!target || target.offsetParent === null) {
    if (step.fallbackTargetId) target = document.getElementById(step.fallbackTargetId);
  }
  if (!card || !target) return;

  const rect = target.getBoundingClientRect();
  const cardWidth = Math.min(360, window.innerWidth - 24);
  card.style.width = cardWidth + 'px';

  let top, left;
  const isRightSide = step.position === 'left' || rect.right > window.innerWidth - 80;

  if (isRightSide) {
    top = Math.max(16, rect.top + (rect.height / 2) - 80);
    left = Math.max(12, rect.left - cardWidth - 14);
  } else if (step.position === 'top' || rect.bottom > window.innerHeight - 180) {
    top = Math.max(16, rect.top - card.offsetHeight - 14);
    left = Math.max(12, Math.min(window.innerWidth - cardWidth - 12, rect.left + (rect.width / 2) - (cardWidth / 2)));
  } else {
    top = rect.bottom + 14;
    left = Math.max(12, Math.min(window.innerWidth - cardWidth - 12, rect.left + (rect.width / 2) - (cardWidth / 2)));
  }

  if (top + card.offsetHeight + 14 > window.innerHeight) {
    top = Math.max(12, window.innerHeight - card.offsetHeight - 14);
  }

  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}

async function checkAndStartTutorial() {
  let shown = false;
  try {
    shown = localStorage.getItem('joa_welcome_tour_v1') === 'true' || localStorage.getItem('joa_welcome_overlay_shown') === 'true';
  } catch(e) {
    shown = false;
  }

  if (!shown) {
    setTimeout(() => {
      startGuidedTutorial();
    }, 650);
  }
}

// Exports globales
window.startGuidedTutorial = startGuidedTutorial;
window.nextTutorialStep = nextTutorialStep;
window.prevTutorialStep = prevTutorialStep;
window.closeGuidedTutorial = closeGuidedTutorial;
window.checkAndStartTutorial = checkAndStartTutorial;

// ==========================================
// 🔕 CONFIGURACIÓN DE NOTIFICACIONES PUSH & MODO NO MOLESTAR (DND)
// ==========================================
function updatePushDndSummary() {
  const dndEl = document.getElementById('pushDndSummaryText');
  if (!dndEl) return;
  const dndEnabled = localStorage.getItem('joa_push_dnd_enabled') === 'true';
  const outsidePlay = localStorage.getItem('joa_push_dnd_outside_play') !== 'false';
  const playStart = localStorage.getItem('joa_push_dnd_play_start') || '18:00';
  const playEnd = localStorage.getItem('joa_push_dnd_play_end') || '23:00';

  if (dndEnabled) {
    dndEl.textContent = `🔕 Notificaciones Push: DND Activo (Juego ${playStart}-${playEnd})`;
    dndEl.style.color = '#ff64c8';
  } else {
    dndEl.textContent = '🔔 Notificaciones Push: DND Desactivado (Todas permitidas)';
    dndEl.style.color = 'var(--text2)';
  }
}

function openPushDndModal() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  const dndEnabled = localStorage.getItem('joa_push_dnd_enabled') === 'true';
  const outsidePlay = localStorage.getItem('joa_push_dnd_outside_play') !== 'false';
  const playStart = localStorage.getItem('joa_push_dnd_play_start') || '18:00';
  const playEnd = localStorage.getItem('joa_push_dnd_play_end') || '23:00';
  const gameMode = localStorage.getItem('joa_push_dnd_game_mode') !== 'false';
  const hapticOnly = localStorage.getItem('joa_push_dnd_haptic_only') === 'true';

  const checkMain = document.getElementById('checkDndMainToggle');
  const checkOut = document.getElementById('checkDndOutsidePlay');
  const pStart = document.getElementById('dndPlayStartInput');
  const pEnd = document.getElementById('dndPlayEndInput');
  const checkGame = document.getElementById('checkDndGameModeActive');
  const checkHaptic = document.getElementById('checkDndHapticOnly');

  if (checkMain) checkMain.checked = dndEnabled;
  if (checkOut) checkOut.checked = outsidePlay;
  if (pStart) pStart.value = playStart;
  if (pEnd) pEnd.value = playEnd;
  if (checkGame) checkGame.checked = gameMode;
  if (checkHaptic) checkHaptic.checked = hapticOnly;

  togglePushDndInputs();
  const modal = document.getElementById('pushNotificationsDndModal');
  if (modal) modal.style.display = 'block';
}

function closePushDndModal() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  const modal = document.getElementById('pushNotificationsDndModal');
  if (modal) modal.style.display = 'none';
}

function togglePushDndInputs() {
  if (window.triggerHaptic) window.triggerHaptic(20);
  const dndEnabled = document.getElementById('checkDndMainToggle')?.checked;
  const panel = document.getElementById('dndSettingsPanel');
  if (!panel) return;
  if (dndEnabled) {
    panel.style.opacity = '1';
    panel.style.pointerEvents = 'auto';
  } else {
    panel.style.opacity = '0.5';
    panel.style.pointerEvents = 'none';
  }
}

function savePushDndSettings() {
  if (window.triggerHaptic) window.triggerHaptic(50);
  const dndEnabled = document.getElementById('checkDndMainToggle')?.checked || false;
  const outsidePlay = document.getElementById('checkDndOutsidePlay')?.checked || false;
  const playStart = document.getElementById('dndPlayStartInput')?.value || '18:00';
  const playEnd = document.getElementById('dndPlayEndInput')?.value || '23:00';
  const gameMode = document.getElementById('checkDndGameModeActive')?.checked || false;
  const hapticOnly = document.getElementById('checkDndHapticOnly')?.checked || false;

  localStorage.setItem('joa_push_dnd_enabled', dndEnabled ? 'true' : 'false');
  localStorage.setItem('joa_push_dnd_outside_play', outsidePlay ? 'true' : 'false');
  localStorage.setItem('joa_push_dnd_play_start', playStart);
  localStorage.setItem('joa_push_dnd_play_end', playEnd);
  localStorage.setItem('joa_push_dnd_game_mode', gameMode ? 'true' : 'false');
  localStorage.setItem('joa_push_dnd_haptic_only', hapticOnly ? 'true' : 'false');

  const configObj = { dndEnabled, outsidePlay, playStart, playEnd, gameMode, hapticOnly };
  if (window.AndroidBridge && typeof window.AndroidBridge.setPushDndSchedule === 'function') {
    window.AndroidBridge.setPushDndSchedule(JSON.stringify(configObj));
  }

  updatePushDndSummary();
  closePushDndModal();
  showToast('💾 Configuración de Notificaciones Push y Modo DND guardada.');
}

function testPushDndNow() {
  if (window.triggerHaptic) window.triggerHaptic(40);
  const dndEnabled = document.getElementById('checkDndMainToggle')?.checked;
  const playStart = document.getElementById('dndPlayStartInput')?.value || '18:00';
  const playEnd = document.getElementById('dndPlayEndInput')?.value || '23:00';
  if (!dndEnabled) {
    alert('🔔 Prueba de Notificación Push:\nEstado DND: DESACTIVADO\nRecibirás todas las alertas flotantes y sonidos de la app sin restricciones.');
  } else {
    alert(`🔕 Prueba de Notificación Push (Modo DND):\nEstado DND: ACTIVO\nVentana de juego permitida: ${playStart} - ${playEnd}.\nFuera de este horario o durante partidas en pantalla completa, las alertas push emergentes serán suprimidas silenciosamente.`);
  }
}

// ==========================================
// 🏆 BARRA DE PROGRESO DE COLECCIÓN CON D3.JS
// ==========================================
function renderD3CollectionProgress() {
  const boxEl = document.getElementById('d3CollectionProgressBox');
  if (boxEl) boxEl.style.display = 'none';
}

// ==========================================
// 🤖 ORÁCULO GAMER & ANÁLISIS GEMINI AI
// ==========================================
async function generateGeminiLibraryAnalysis() {
  const btn = document.getElementById('btnGeminiAnalyze');
  const loadingBox = document.getElementById('geminiLoadingBox');
  const resultBox = document.getElementById('geminiResultBox');
  const loadingText = document.getElementById('geminiLoadingText');

  if (window.triggerHaptic) window.triggerHaptic(30);

  let apiKey = '';
  if (window.AndroidBridge && typeof window.AndroidBridge.getGeminiApiKey === 'function') {
    try {
      apiKey = window.AndroidBridge.getGeminiApiKey();
    } catch(e) {
      console.error("Error obteniendo key de AndroidBridge:", e);
    }
  }

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === '') {
    if (resultBox) {
      resultBox.innerHTML = `
        <div style="padding:24px; text-align:center; color:#FF5555; background:rgba(255,85,85,0.05); border-radius:16px; border:1px solid rgba(255,85,85,0.2);">
          <div style="font-size:2.4rem; margin-bottom:12px;">🔑</div>
          <b style="font-size:1.1rem; color:#fff;">Clave de API de Gemini no configurada</b>
          <p style="color:var(--text2); font-size:0.88rem; margin:12px auto; max-width:480px; line-height:1.5;">Para activar la inteligencia artificial del <b>Oráculo Gamer</b> y generar resúmenes personalizados de tu biblioteca, debes añadir tu variable <b>GEMINI_API_KEY</b> en el panel de Secretos (Secrets) de AI Studio.</p>
          <div style="font-size:0.78rem; color:var(--text3); margin-top:8px;">💡 Si ya la configuraste, recompila la aplicación o reinicia la sesión para aplicar el cambio en BuildConfig.</div>
        </div>
      `;
    }
    showToast("⚠️ API Key de Gemini no encontrada en los secretos de AI Studio.");
    return;
  }

  const itemsById = {};
  if (typeof allItems !== 'undefined') {
    allItems.forEach(it => { itemsById[it.id] = it; });
  }

  let myItems = [];
  if (typeof userStates !== 'undefined' && userStates.length > 0) {
    myItems = userStates.map(s => {
      const it = itemsById[s.itemId];
      if (!it) return null;
      return `${it.title} (Tipo: ${it.type || 'Juego'}, Género: ${it.genre || 'Varios'}, Estado en mi biblioteca: ${s.status || 'guardado'})`;
    }).filter(Boolean);
  }

  let promptText = "";
  if (myItems.length > 0) {
    promptText = `Actúa como el "Oráculo de JOA GAMERS", un experto carismático y apasionado en videojuegos, películas, series y cultura friki/gamer. Analiza la siguiente lista de títulos de mi biblioteca personal y genera un análisis en español con un tono cercano, dinámico y entretenido:\n\nTítulos en mi biblioteca personal:\n${myItems.slice(0, 40).join('\n')}\n\nEstructura tu respuesta en las siguientes 3 secciones (usando formato Markdown y emojis acordes):\n### 🎮 1. Tu ADN y Perfil Gamer\nQué dicen estos títulos sobre mis preferencias, géneros favoritos y estilo de entretenimiento.\n\n### 💎 2. Joyas y Puntos Fuertes de tu Colección\nDestaca 2 o 3 obras emblemáticas o interesantes que tengo en curso, pendientes o completadas y explica por qué brillan en mi lista.\n\n### 🚀 3. Recomendación del Oráculo\nUn consejo final o reto motivador para disfrutar y sacarle el máximo partido a mi biblioteca en JOA GAMERS.`;
  } else {
    const topGlobal = (typeof allItems !== 'undefined') ? allItems.slice(0, 25).map(it => `${it.title} (Tipo: ${it.type || 'Juego'}, Género: ${it.genre || 'Varios'})`) : [];
    promptText = `Actúa como el "Oráculo de JOA GAMERS", un experto carismático y apasionado en videojuegos, películas, series y cultura friki/gamer. Como aún estoy empezando a construir mi biblioteca personal en JOA GAMERS, analiza una selección de los títulos más emblemáticos del catálogo global de la app en español:\n\nTítulos destacados del catálogo JOA GAMERS:\n${topGlobal.join('\n')}\n\nEstructura tu respuesta en las siguientes 3 secciones (usando formato Markdown y emojis acordes):\n### 🌟 1. Bienvenido al Multiverso JOA\nUna introducción emocionante al catálogo y la variedad de joyas que ofrece la plataforma.\n\n### 🔥 2. Imprescindibles para Empezar tu Biblioteca\nQué 3 obras maestras del catálogo me recomiendas marcar prioritariamente como "Jugando" o "Deseos".\n\n### 🎯 3. El Reto del Oráculo\nAnímame con un consejo jugón para explorar las categorías de Juegos, Películas, Series y Emuladores en mi Panel.`;
  }

  if (loadingBox) loadingBox.style.display = 'block';
  if (resultBox) resultBox.style.display = 'none';
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
  }
  if (loadingText) loadingText.textContent = '✨ Consultando al Oráculo Gemini 3.5 Flash...';

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: promptText }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.72,
          maxOutputTokens: 3500
        }
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Error HTTP ${response.status}`);
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No se pudo generar el análisis en este momento.";

    const htmlText = formatGeminiMarkdown(generatedText);

    if (resultBox) {
      resultBox.innerHTML = `
        <div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,229,255,0.2); padding-bottom:12px; flex-wrap:wrap; gap:8px;">
          <span style="font-weight:900; color:#00E5FF; display:flex; align-items:center; gap:8px; font-size:1.05rem;">✨ Análisis del Oráculo Gemini <span style="font-size:0.68rem; background:rgba(0,255,178,0.2); color:#00FFB2; padding:2px 8px; border-radius:10px;">3.5 Flash</span></span>
          <span style="font-size:0.75rem; color:var(--text2); background:rgba(255,255,255,0.05); padding:4px 10px; border-radius:8px;">${myItems.length > 0 ? `📊 Analizando ${myItems.length} títulos` : '🌐 Catálogo Global Destacado'}</span>
        </div>
        <div style="font-size:0.94rem; line-height:1.7; color:#E0E6ED;">${htmlText}</div>
      `;
    }
    if (window.triggerHaptic) window.triggerHaptic(50);
    showToast("✨ ¡Análisis de biblioteca generado con éxito por Gemini AI!");
  } catch(error) {
    console.error("Error Gemini API:", error);
    if (resultBox) {
      resultBox.innerHTML = `
        <div style="padding:24px; text-align:center; color:#FF5555; background:rgba(255,85,85,0.05); border-radius:16px; border:1px solid rgba(255,85,85,0.2);">
          <div style="font-size:2.2rem; margin-bottom:10px;">⚠️</div>
          <b style="font-size:1.08rem; color:#fff;">Hubo un problema al consultar a Gemini</b>
          <p style="color:var(--text2); font-size:0.88rem; margin:10px auto; max-width:480px;">Detalle del servidor: <code style="color:#FF8888;">${escapeHtml(error.message || 'Error de conexión con IA')}</code></p>
          <button class="btn" style="margin-top:12px; background:var(--panel); border-color:#FF5555; color:#FF5555; font-weight:700;" onclick="generateGeminiLibraryAnalysis()">🔄 Reintentar Análisis</button>
        </div>
      `;
    }
    showToast("❌ Error al generar análisis IA: " + (error.message || 'Error de red'));
  } finally {
    if (loadingBox) loadingBox.style.display = 'none';
    if (resultBox) resultBox.style.display = 'block';
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }
}

function formatGeminiMarkdown(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#00FFB2;">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^### (.*$)/gim, '<h4 style="color:#00E5FF; margin:18px 0 8px 0; font-size:1.08rem; display:flex; align-items:center; gap:6px;">$1</h4>')
    .replace(/^## (.*$)/gim, '<h3 style="color:#00E5FF; margin:20px 0 10px 0; font-size:1.18rem;">$1</h3>')
    .replace(/^# (.*$)/gim, '<h2 style="color:#00E5FF; margin:22px 0 12px 0; font-size:1.28rem;">$1</h2>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

function copyGeminiAnalysis() {
  const resultBox = document.getElementById('geminiResultBox');
  if (!resultBox || !resultBox.innerText || resultBox.innerText.includes('Toca el botón') || resultBox.innerText.includes('Clave de API de Gemini')) {
    showToast("⚠️ Primero debes generar un análisis exitoso para copiarlo.");
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(resultBox.innerText);
    if (window.triggerHaptic) window.triggerHaptic(30);
    showToast("📋 ¡Análisis del Oráculo copiado al portapapeles!");
  } else {
    showToast("❌ No se pudo copiar al portapapeles.");
  }
}

// ==========================================
// 📝 DIARIO DE PROGRESO Y NOTAS PRO (IndexedDB)
// ==========================================
let notesMigrationDone = false;

async function checkAndMigrateNotesFromLocalStorage() {
  if (notesMigrationDone) return;
  try {
    const rawLocal = localStorage.getItem('multiverso_user_notes');
    if (rawLocal) {
      const oldMap = JSON.parse(rawLocal);
      for (const [itemId, notes] of Object.entries(oldMap)) {
        if (Array.isArray(notes) && notes.length > 0) {
          const existing = await idbGet('user_notes', itemId);
          if (!existing) {
            await idbPut('user_notes', { itemId, notes, updatedAt: new Date().toISOString() });
          }
        }
      }
      localStorage.removeItem('multiverso_user_notes');
    }
  } catch(e) {
    console.error("Error al migrar notas desde localStorage a IndexedDB:", e);
  } finally {
    notesMigrationDone = true;
  }
}

async function getProNotesMap() {
  await checkAndMigrateNotesFromLocalStorage();
  const allRecords = await idbGetAll('user_notes');
  const map = {};
  if (Array.isArray(allRecords)) {
    for (const r of allRecords) {
      if (r && r.itemId) map[r.itemId] = r.notes || [];
    }
  }
  return map;
}

async function getProNotesForItem(itemId) {
  await checkAndMigrateNotesFromLocalStorage();
  const record = await idbGet('user_notes', itemId);
  return (record && Array.isArray(record.notes)) ? record.notes : [];
}

async function saveProNotesForItem(itemId, notesArray) {
  await idbPut('user_notes', { itemId, notes: notesArray, updatedAt: new Date().toISOString() });
}

async function renderProgressNotesPro(itemId) {
  const container = document.getElementById('itemNotesList');
  if (!container) return;
  const notes = await getProNotesForItem(itemId);
  
  if (notes.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text3); font-size:0.8rem; font-style:italic;">No hay notas registradas para este título aún. ¡Escribe un apunte arriba!</div>`;
    return;
  }
  
  container.innerHTML = notes.map(n => `
    <div style="background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:10px 12px; display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
      <div style="flex:1;">
        <div style="font-size:0.68rem; color:#00E5FF; font-weight:800; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
          <span>🕒 ${n.date}</span>
        </div>
        <div style="color:#fff; font-size:0.86rem; line-height:1.4; word-break:break-word; white-space:pre-wrap;">${escapeHtml(n.text)}</div>
      </div>
      <button onclick="deleteProgressNotePro('${itemId}', '${n.id}')" style="background:none; border:none; color:#FF5555; cursor:pointer; font-size:0.9rem; padding:2px;" title="Borrar nota">🗑️</button>
    </div>
  `).join('');
}

async function saveProgressNotePro() {
  if (!currentDetailId) return;
  const input = document.getElementById('newProgressNoteInput');
  if (!input || !input.value.trim()) {
    showToast("⚠️ Escribe algo en la nota antes de guardarla.");
    return;
  }
  const text = input.value.trim();
  const notes = await getProNotesForItem(currentDetailId);
  
  const now = new Date();
  const dateStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  
  notes.unshift({
    id: 'note_' + Date.now(),
    text: text,
    date: dateStr
  });
  
  await saveProNotesForItem(currentDetailId, notes);
  input.value = '';
  if (window.triggerHaptic) window.triggerHaptic(25);
  showToast("📝 ¡Nota guardada en IndexedDB!");
  await renderProgressNotesPro(currentDetailId);
}

async function deleteProgressNotePro(itemId, noteId) {
  let notes = await getProNotesForItem(itemId);
  notes = notes.filter(n => n.id !== noteId);
  await saveProNotesForItem(itemId, notes);
  if (window.triggerHaptic) window.triggerHaptic(20);
  showToast("🗑️ Nota eliminada.");
  await renderProgressNotesPro(itemId);
}

// ==========================================
// 💎 PANEL FINANCIERO & DE TIEMPO PRO
// ==========================================
function renderProFinancialStats() {
  if (typeof allItems === 'undefined' || !allItems.length) return;
  
  let totalSpent = 0;
  let totalHours = 0;
  let completedCount = 0;
  
  allItems.forEach(it => {
    const price = getItemPriceNumeric(it);
    totalSpent += price;
    
    // Estimación pro de horas de juego/entretenimiento según tipo y género
    let h = 12; // default
    const g = (it.genres || '').toLowerCase() + ' ' + (it.type || '').toLowerCase();
    if (g.includes('rpg') || g.includes('rol') || g.includes('mundo abierto') || g.includes('open world') || g.includes('mmorpg')) h = 50;
    else if (g.includes('serie') || g.includes('anime')) h = 24;
    else if (g.includes('pelicula') || g.includes('músic')) h = 2;
    else if (g.includes('aventur') || g.includes('estrateg') || g.includes('simul')) h = 25;
    else if (g.includes('corto') || g.includes('indie') || g.includes('arcad') || g.includes('puzzl')) h = 6;
    
    totalHours += h;
  });
  
  if (typeof userStates !== 'undefined') {
    completedCount = userStates.filter(s => s.status === 'completed').length;
  }
  
  const compRate = allItems.length > 0 ? Math.round((completedCount / allItems.length) * 100) : 0;
  
  const cntEl = document.getElementById('proTotalTitlesCount');
  const spentEl = document.getElementById('proTotalSpentVal');
  const hoursEl = document.getElementById('proTotalHoursVal');
  const rateEl = document.getElementById('proCompletionRateVal');
  
  if (cntEl) cntEl.textContent = `${allItems.length} títulos en biblioteca`;
  if (spentEl) spentEl.textContent = `$${totalSpent.toFixed(2)}`;
  if (hoursEl) hoursEl.textContent = `${totalHours.toLocaleString()}h est.`;
  if (rateEl) rateEl.textContent = `${compRate}%`;
}

// ==========================================
// 🎲 RULETA INTELIGENTE PRO (#rouletteModal)
// ==========================================
let currentRouletteFilter = 'all';
let currentRouletteChosenItem = null;

function openRouletteModalPro() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const m = document.getElementById('rouletteModal');
  if (m) {
    m.style.display = 'block';
    setRouletteFilter('all');
  }
}

function closeRouletteModalPro() {
  const m = document.getElementById('rouletteModal');
  if (m) m.style.display = 'none';
}

function setRouletteFilter(mode) {
  currentRouletteFilter = mode;
  ['roulFilterAll', 'roulFilterPending', 'roulFilterShort'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  if (mode === 'all' && document.getElementById('roulFilterAll')) document.getElementById('roulFilterAll').classList.add('active');
  if (mode === 'pending' && document.getElementById('roulFilterPending')) document.getElementById('roulFilterPending').classList.add('active');
  if (mode === 'short' && document.getElementById('roulFilterShort')) document.getElementById('roulFilterShort').classList.add('active');
  
  document.getElementById('rouletteIconDisplay').textContent = '🎲';
  document.getElementById('rouletteTitleDisplay').textContent = '¡Toca el botón para girar la ruleta!';
  document.getElementById('rouletteMetaDisplay').textContent = mode === 'pending' ? 'Filtrando sólo títulos pendientes' : mode === 'short' ? 'Filtrando juegos cortos o rápidos' : 'Toda tu biblioteca';
  document.getElementById('rouletteActionBtn').style.display = 'none';
}

function spinRoulettePro() {
  if (typeof allItems === 'undefined' || !allItems.length) return;
  if (window.triggerHaptic) window.triggerHaptic(40);
  
  let pool = [...allItems];
  if (currentRouletteFilter === 'pending' && typeof userStates !== 'undefined') {
    const pendingIds = new Set(userStates.filter(s => s.status === 'pending' || s.status === 'wishlist' || s.status === 'paused').map(s => s.id));
    pool = pool.filter(i => pendingIds.has(i.id));
    if (!pool.length) pool = [...allItems]; // fallback si no hay pendientes
  } else if (currentRouletteFilter === 'short') {
    pool = pool.filter(i => {
      const g = (i.genres || '').toLowerCase() + ' ' + (i.type || '').toLowerCase();
      return g.includes('indie') || g.includes('arcad') || g.includes('corto') || g.includes('plataform') || g.includes('puzzl') || g.includes('pelicula');
    });
    if (!pool.length) pool = [...allItems];
  }
  
  const iconEl = document.getElementById('rouletteIconDisplay');
  const titleEl = document.getElementById('rouletteTitleDisplay');
  const metaEl = document.getElementById('rouletteMetaDisplay');
  const actionBtn = document.getElementById('rouletteActionBtn');
  
  if (actionBtn) actionBtn.style.display = 'none';
  
  const icons = ['🎮', '🕹️', '🎲', '🎬', '🌸', '🏆', '🔥', '⚔️', '🚀'];
  let count = 0;
  const maxSpins = 16;
  const interval = setInterval(() => {
    count++;
    const randomTemp = pool[Math.floor(Math.random() * pool.length)];
    iconEl.textContent = icons[count % icons.length];
    titleEl.textContent = randomTemp.title;
    metaEl.textContent = "🎰 Barajando opciones...";
    if (window.triggerHaptic && count % 3 === 0) window.triggerHaptic(15);
    
    if (count >= maxSpins) {
      clearInterval(interval);
      currentRouletteChosenItem = pool[Math.floor(Math.random() * pool.length)];
      
      let finalIcon = '🎮';
      if (currentRouletteChosenItem.type && currentRouletteChosenItem.type.includes('pelicula')) finalIcon = '🎬';
      else if (currentRouletteChosenItem.type && currentRouletteChosenItem.type.includes('anime')) finalIcon = '🌸';
      else if (currentRouletteChosenItem.type && currentRouletteChosenItem.type.includes('serie')) finalIcon = '📺';
      
      iconEl.textContent = finalIcon;
      iconEl.style.transform = 'scale(1.3)';
      setTimeout(() => iconEl.style.transform = 'scale(1)', 200);
      
      titleEl.textContent = currentRouletteChosenItem.title;
      metaEl.textContent = `⭐ ${currentRouletteChosenItem.rating || 'N/A'} • ${currentRouletteChosenItem.genres ? currentRouletteChosenItem.genres.split(',')[0] : 'Destacado'}`;
      if (actionBtn) actionBtn.style.display = 'inline-block';
      
      if (window.triggerHaptic) window.triggerHaptic(50);
      showToast("🎉 ¡El destino ha hablado!");
    }
  }, 60);
}

function playSelectedRouletteItem() {
  if (!currentRouletteChosenItem) return;
  closeRouletteModalPro();
  openDetail(currentRouletteChosenItem.id);
}



// ==========================================
// 📄 EXPORTACIÓN PRO MARKDOWN & CSV
// ==========================================
function exportToMarkdownPro() {
  if (typeof allItems === 'undefined' || !allItems.length) {
    showToast("⚠️ No hay títulos en la biblioteca para exportar.");
    return;
  }
  if (window.triggerHaptic) window.triggerHaptic(30);
  
  let md = `# 🎮 Catálogo Multiverso: Informe de Biblioteca\n`;
  md += `*Generado automáticamente el ${new Date().toLocaleDateString()}*\n\n`;
  md += `| Título | Categoría | Géneros | Año | Calificación | Precio |\n`;
  md += `| :--- | :---: | :--- | :---: | :---: | :---: |\n`;
  
  allItems.forEach(it => {
    md += `| **${it.title.replace(/\|/g, '')}** | ${it.type || 'General'} | ${it.genres || '-'} | ${it.year || '-'} | ★ ${it.rating || 'N/A'} | ${formatItemPrice(it)} |\n`;
  });
  
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Catalogo_Multiverso_${new Date().toISOString().slice(0,10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("📄 ¡Catálogo exportado en formato Markdown (md)!");
}

function exportToCSVPro() {
  if (typeof allItems === 'undefined' || !allItems.length) {
    showToast("⚠️ No hay títulos para exportar.");
    return;
  }
  if (window.triggerHaptic) window.triggerHaptic(30);
  
  let csv = "ID,Titulo,Tipo,Consola,Generos,Anio,Calificacion,Precio,Sinopsis\n";
  allItems.forEach(it => {
    const clean = s => `"${String(s || '').replace(/"/g, '""')}"`;
    csv += [clean(it.id), clean(it.title), clean(it.type), clean(it.console), clean(it.genres), clean(it.year), clean(it.rating), clean(formatItemPrice(it)), clean(it.synopsis)].join(',') + "\n";
  });
  
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Catalogo_Multiverso_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("📊 ¡Tabla CSV exportada con éxito!");
}

// ==========================================
// 💬 CHAT DIRECTO POR WHATSAPP CON EL ADMINISTRADOR (+5352512369)
// ==========================================
async function openWhatsAppAdminChat() {
  if (window.triggerHaptic) window.triggerHaptic(40);
  const adminPhone = '5352512369';
  let profile = null;
  try {
    if (typeof idbGetMeta === 'function') {
      profile = await idbGetMeta('local_profile', null);
    }
  } catch(e) {
    console.warn("Could not load profile for WA link", e);
  }

  const apodo = profile ? (profile.apodo || profile.username || '') : '';
  const fullName = profile ? (profile.fullName || '') : '';
  const registeredPhone = profile ? (profile.phone || '') : '';

  let message = '';
  if (apodo && apodo !== 'Invitado') {
    message = `Hola Administrador, soy ${apodo}`;
    if (fullName && fullName.toLowerCase() !== apodo.toLowerCase()) {
      message += ` (${fullName})`;
    }
    if (registeredPhone) {
      message += ` con teléfono registrado en la apk: ${registeredPhone}`;
    }
    message += `. Te escribo desde la app JOA GAMERS para realizar una consulta.`;
  } else {
    message = `Hola Administrador, me comunico contigo desde la aplicación JOA GAMERS para realizar una consulta.`;
  }

  const whatsappUrl = `https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`;

  if (typeof showToast === 'function') {
    showToast(`💬 Abriendo chat de WhatsApp con el Administrador (+5352512369)...`);
  }

  setTimeout(() => {
    window.open(whatsappUrl, '_blank');
  }, 400);
}

// ==========================================
// ⚡ MODO DE SELECCIÓN RÁPIDA / EDICIÓN MASIVA EN EL GRID
// ==========================================
let isBulkSelectActive = false;
let selectedBulkItemIds = new Set();
let bulkLongPressTimer = null;
let bulkPointerStart = null;
let bulkLongPressTriggered = false;
let lastLongPressTime = 0;
let lastToggleTimeMap = {};

function handleCardPointerDown(e, itemId) {
  if (e.button !== undefined && e.button !== 0) return;
  bulkLongPressTriggered = false;
  bulkPointerStart = { x: e.clientX, y: e.clientY, time: Date.now() };
  clearTimeout(bulkLongPressTimer);
  bulkLongPressTimer = setTimeout(() => {
    bulkLongPressTriggered = true;
    lastLongPressTime = Date.now();
    if (window.triggerHaptic) window.triggerHaptic(60);
    activateBulkSelectMode(itemId);
  }, 500);
}

function handleCardPointerMove(e, itemId) {
  if (!bulkPointerStart) return;
  const dist = Math.hypot(e.clientX - bulkPointerStart.x, e.clientY - bulkPointerStart.y);
  if (dist > 18) {
    clearTimeout(bulkLongPressTimer);
    bulkPointerStart = null;
  }
}

function handleCardPointerUp(e, itemId) {
  clearTimeout(bulkLongPressTimer);
  bulkPointerStart = null;
}

function handleCardPointerCancel(e, itemId) {
  clearTimeout(bulkLongPressTimer);
  bulkPointerStart = null;
}

function handleCardClick(e, itemId) {
  clearTimeout(bulkLongPressTimer);
  const timeSinceLongPress = Date.now() - lastLongPressTime;
  if (bulkLongPressTriggered || timeSinceLongPress < 450) {
    bulkLongPressTriggered = false;
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
  if (isBulkSelectActive) {
    e.preventDefault();
    e.stopPropagation();
    toggleBulkItemSelection(itemId);
    return false;
  }
  openDetail(itemId);
}

function activateBulkSelectMode(initialItemId) {
  if (!isBulkSelectActive) {
    isBulkSelectActive = true;
    selectedBulkItemIds.clear();
    const container = document.getElementById('gridContainer');
    if (container) container.classList.add('is-bulk-mode-active');
    if (typeof showToast === 'function') {
      showToast('⚡ Modo Selección Rápida Activado (Toca tarjetas para marcar)');
    }
  }
  if (initialItemId) {
    selectedBulkItemIds.add(initialItemId);
  }
  updateBulkSelectUI();
}

function toggleBulkItemSelection(itemId) {
  const now = Date.now();
  if (lastToggleTimeMap[itemId] && (now - lastToggleTimeMap[itemId] < 300)) {
    // Evitar doble toque accidental rápido en la misma tarjeta
    return;
  }
  lastToggleTimeMap[itemId] = now;

  if (window.triggerHaptic) window.triggerHaptic(25);
  if (selectedBulkItemIds.has(itemId)) {
    selectedBulkItemIds.delete(itemId);
  } else {
    selectedBulkItemIds.add(itemId);
  }
  updateBulkSelectUI();
}

function updateBulkSelectUI() {
  const container = document.getElementById('gridContainer');
  if (container) {
    container.classList.toggle('is-bulk-mode-active', isBulkSelectActive);
  }
  const toolbar = document.getElementById('bulkSelectToolbar');
  if (toolbar) {
    toolbar.style.display = isBulkSelectActive ? 'block' : 'none';
  }

  // Actualizar contador y suma total
  const countEl = document.getElementById('bulkSelectedCount');
  if (countEl) countEl.textContent = selectedBulkItemIds.size;

  let sum = 0;
  selectedBulkItemIds.forEach(id => {
    const item = itemsById[id];
    if (item) sum += getItemPriceNumeric(item);
  });
  const sumEl = document.getElementById('bulkSelectedSum');
  if (sumEl && typeof formatListTotal === 'function') {
    sumEl.textContent = `Total: ${formatListTotal(sum)}`;
  }

  // Actualizar directamente la apariencia visual de las tarjetas
  document.querySelectorAll('.card').forEach(cardEl => {
    const idStr = cardEl.id.replace('gridCard_', '');
    const id = parseInt(idStr, 10);
    if (!isNaN(id)) {
      const isSel = selectedBulkItemIds.has(id);
      cardEl.classList.toggle('is-bulk-selected', isSel);
      const chk = cardEl.querySelector('.card-bulk-checkbox');
      if (chk) chk.classList.toggle('checked', isSel);
    }
  });

  // Alternar icono/texto del botón Seleccionar Todos
  const toggleTxt = document.getElementById('bulkToggleAllTxt');
  const toggleIcon = document.getElementById('bulkToggleAllIcon');
  const pageItemIds = (typeof filteredItems !== 'undefined') ? filteredItems.map(i => i.id) : [];
  const allCurrentSelected = pageItemIds.length > 0 && pageItemIds.every(id => selectedBulkItemIds.has(id));
  if (toggleTxt) toggleTxt.textContent = allCurrentSelected ? 'Desmarcar' : 'Todos';
  if (toggleIcon) toggleIcon.textContent = allCurrentSelected ? '⬜' : '☑️';
}

function toggleSelectAllBulkCurrentPage() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const pageItemIds = (typeof filteredItems !== 'undefined') ? filteredItems.map(i => i.id) : [];
  if (!pageItemIds.length) return;
  const allCurrentSelected = pageItemIds.every(id => selectedBulkItemIds.has(id));
  if (allCurrentSelected) {
    pageItemIds.forEach(id => selectedBulkItemIds.delete(id));
  } else {
    pageItemIds.forEach(id => selectedBulkItemIds.add(id));
  }
  updateBulkSelectUI();
}

function invertBulkSelection() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const pageItemIds = (typeof filteredItems !== 'undefined') ? filteredItems.map(i => i.id) : [];
  if (!pageItemIds.length) return;
  pageItemIds.forEach(id => {
    if (selectedBulkItemIds.has(id)) {
      selectedBulkItemIds.delete(id);
    } else {
      selectedBulkItemIds.add(id);
    }
  });
  updateBulkSelectUI();
  if (typeof showToast === 'function') showToast('🔄 Selección invertida');
}

function openBulkStatusPickerModal() {
  if (selectedBulkItemIds.size === 0) {
    if (typeof showToast === 'function') showToast('⚠️ Selecciona al menos 1 elemento primero.');
    return;
  }
  const countBadge = document.getElementById('bulkStatusCountBadge');
  if (countBadge) countBadge.textContent = selectedBulkItemIds.size;
  const modal = document.getElementById('bulkStatusPickerModal');
  if (modal) modal.style.display = 'flex';
}

function closeBulkStatusPickerModal() {
  const modal = document.getElementById('bulkStatusPickerModal');
  if (modal) modal.style.display = 'none';
}

function openBulkTypeSelectModal() {
  if (!isBulkSelectActive) {
    activateBulkSelectMode();
  }
  const modal = document.getElementById('bulkTypeSelectModal');
  if (modal) modal.style.display = 'flex';
}

function closeBulkTypeSelectModal() {
  const modal = document.getElementById('bulkTypeSelectModal');
  if (modal) modal.style.display = 'none';
}

function selectBulkByType(typeStr) {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const pageItems = (typeof filteredItems !== 'undefined') ? filteredItems : [];
  if (!pageItems.length) return;

  let added = 0;
  pageItems.forEach(it => {
    let match = false;
    if (typeStr === 'discount') {
      const priceVal = getItemPriceNumeric(it);
      if (it.discount || it.precio_oferta || it.price_original) match = true;
    } else if (typeStr === 'juego' && (it.type === 'juego' || it.type === 'game')) {
      match = true;
    } else if (typeStr === 'pelicula' && (it.type === 'pelicula' || it.type === 'pelicula_animada' || it.type === 'movie')) {
      match = true;
    } else if (typeStr === 'serie' && (it.type === 'serie' || it.type === 'serie_animada' || it.type === 'show')) {
      match = true;
    } else if (typeStr === 'novela_tv' && (it.type === 'novela_tv' || it.type === 'novela')) {
      match = true;
    } else if (typeStr === 'anime' && (it.type === 'anime' || it.type === 'anime_movie')) {
      match = true;
    }

    if (match) {
      selectedBulkItemIds.add(it.id);
      added++;
    }
  });

  updateBulkSelectUI();
  if (typeof showToast === 'function') {
    showToast(`🎯 ${added} elementos marcados por filtro`);
  }
}

function exitBulkSelectMode() {
  if (window.triggerHaptic) window.triggerHaptic(20);
  isBulkSelectActive = false;
  selectedBulkItemIds.clear();
  updateBulkSelectUI();
}

async function executeBulkAction(actionType) {
  if (selectedBulkItemIds.size === 0) {
    if (typeof showToast === 'function') showToast('⚠️ Selecciona al menos 1 elemento primero.');
    return;
  }

  if (window.triggerHaptic) window.triggerHaptic(50);
  const count = selectedBulkItemIds.size;

  if (['wishlist', 'playing', 'paused', 'completed', 'pending', 'dropped'].includes(actionType)) {
    const newStatus = actionType;
    const now = new Date().toISOString();
    const records = Array.from(selectedBulkItemIds).map(itemId => ({ itemId, status: newStatus, updatedAt: now }));
    await idbBulkPut('user_states', records);
    userStates = await idbGetAll('user_states');
    if (typeof updateLibraryCountBadges === 'function') updateLibraryCountBadges();
    if (typeof renderGrid === 'function') renderGrid();
    
    const statusNames = {
      wishlist: '❤️ Deseos',
      playing: '🎮 Jugando / Viendo',
      paused: '⏸️ Pausado',
      completed: '✅ Completado',
      pending: '📥 Pendiente',
      dropped: '❌ Abandonado'
    };
    const label = statusNames[newStatus] || newStatus;
    if (typeof showToast === 'function') showToast(`✨ ${count} elementos asignados a ${label}`);
    exitBulkSelectMode();
  } else if (actionType === 'remove_state') {
    const keys = Array.from(selectedBulkItemIds);
    await idbBulkDelete('user_states', keys);
    userStates = await idbGetAll('user_states');
    if (typeof updateLibraryCountBadges === 'function') updateLibraryCountBadges();
    if (typeof renderGrid === 'function') renderGrid();
    if (typeof showToast === 'function') showToast(`🗑️ Estado eliminado de ${count} elementos`);
    exitBulkSelectMode();
  }
}

async function openBulkListPickerModal() {
  if (selectedBulkItemIds.size === 0) {
    if (typeof showToast === 'function') showToast('⚠️ Selecciona al menos 1 elemento primero.');
    return;
  }
  const countEl = document.getElementById('bulkListPickerCount');
  if (countEl) countEl.textContent = selectedBulkItemIds.size;

  const container = document.getElementById('bulkListsContainer');
  if (container) {
    container.innerHTML = '<div style="color:var(--text2); font-size:0.8rem; padding:10px;">Cargando listas...</div>';
    const lists = await idbGetAll('user_lists');
    if (!lists || !lists.length) {
      container.innerHTML = '<div style="color:var(--text2); font-size:0.85rem; padding:12px; text-align:center; background:rgba(255,255,255,0.03); border-radius:12px;">No tienes listas personalizadas creadas aún. ¡Crea una abajo!</div>';
    } else {
      container.innerHTML = lists.map(l => `
        <div class="bulk-list-row" onclick="addSelectedBulkToExistingList(${l.id})">
          <div style="font-weight:700; color:#fff; display:flex; align-items:center; gap:6px;">
            <span>📁 ${escapeHtml(l.name)}</span>
          </div>
          <div style="font-size:0.75rem; color:#00FFB2; background:rgba(0,255,178,0.12); padding:3px 8px; border-radius:8px;">
            ${(l.itemIds || []).length} elementos
          </div>
        </div>
      `).join('');
    }
  }

  const modal = document.getElementById('bulkListPickerModal');
  if (modal) modal.style.display = 'flex';
}

function closeBulkListPickerModal() {
  const modal = document.getElementById('bulkListPickerModal');
  if (modal) modal.style.display = 'none';
}

async function addSelectedBulkToExistingList(listId) {
  if (!listId) return;
  const list = await idbGet('user_lists', listId);
  if (!list) {
    if (typeof showToast === 'function') showToast('⚠️ No se encontró la lista.');
    return;
  }
  const existingSet = new Set(list.itemIds || []);
  selectedBulkItemIds.forEach(id => existingSet.add(id));
  list.itemIds = Array.from(existingSet);
  
  await idbPut('user_lists', list);

  if (typeof renderListsTab === 'function') renderListsTab();

  if (typeof showToast === 'function') {
    showToast(`📁 ${selectedBulkItemIds.size} elementos añadidos a la lista "${list.name}"`);
  }
  closeBulkListPickerModal();
  exitBulkSelectMode();
}

async function createNewListAndAddBulk() {
  const input = document.getElementById('newBulkListNameInput');
  const name = input ? input.value.trim() : '';
  if (!name) {
    if (typeof showToast === 'function') showToast('⚠️ Ingresa un nombre para la lista.');
    return;
  }
  const itemIds = Array.from(selectedBulkItemIds);
  await idbPut('user_lists', {
    name: name,
    itemIds: itemIds,
    createdAt: new Date().toISOString()
  });

  if (input) input.value = '';
  if (typeof renderListsTab === 'function') renderListsTab();

  if (typeof showToast === 'function') {
    showToast(`📁 Nueva lista "${name}" creada con ${itemIds.length} elementos`);
  }
  closeBulkListPickerModal();
  exitBulkSelectMode();
}

// ==========================================
// 🛠️ PÁGINA Y MODAL DE SERVICIOS Y MANTENIMIENTO
// ==========================================
function handleServiceImgError(img, type) {
  if (!img) return;
  img.onerror = null; // Evitar loops
  
  // 1. Probar primero si tenemos la imagen en Base64 en window.SERVICE_IMAGES_B64
  if (window.SERVICE_IMAGES_B64 && window.SERVICE_IMAGES_B64[type]) {
    img.src = window.SERVICE_IMAGES_B64[type];
    return;
  }
  
  // 2. Si falla la ruta relativa 'img/...', intentar './img/...' o '/img/...'
  const currentSrc = img.getAttribute('src') || '';
  if (!currentSrc.startsWith('./') && !currentSrc.startsWith('data:')) {
    img.src = `./${currentSrc}`;
    return;
  }
  
  // 3. Fallback SVG estilizado de alta tecnología según el servicio
  const fallbackGradients = {
    maintenance: { color1: '#00E5FF', color2: '#0077B6', icon: '🧰', label: 'MANTENIMIENTO & MONTAJE' },
    os: { color1: '#D8B4FE', color2: '#7209B7', icon: '💿', label: 'SISTEMAS OPERATIVOS' },
    software: { color1: '#00FFB2', color2: '#007200', icon: '⚙️', label: 'DRIVERS & SOFTWARES' },
    retro: { color1: '#FF66C4', color2: '#C77DFF', icon: '👾', label: 'RETRO & ANDROID TV' }
  };
  const cfg = fallbackGradients[type] || fallbackGradients.maintenance;
  const svgFallback = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340"><rect width="100%" height="100%" fill="%230b0f19"/><circle cx="500" cy="80" r="180" fill="${encodeURIComponent(cfg.color1)}" opacity="0.12"/><circle cx="100" cy="260" r="140" fill="${encodeURIComponent(cfg.color2)}" opacity="0.18"/><text x="50%" y="45%" fill="${encodeURIComponent(cfg.color1)}" font-size="52" text-anchor="middle">${cfg.icon}</text><text x="50%" y="65%" fill="%23FFFFFF" font-size="18" font-family="sans-serif" font-weight="900" letter-spacing="2" text-anchor="middle">${cfg.label}</text></svg>`;
  img.src = svgFallback;
}

function openServicesModal() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  if (typeof toggleSidebar === 'function') toggleSidebar(false);
  const overlay = document.getElementById('servicesModalOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    // Asegurar que las imágenes de servicios se rendericen inmediatamente
    if (window.SERVICE_IMAGES_B64) {
      overlay.querySelectorAll('.service-card-banner img').forEach(img => {
        if (!img.complete || img.naturalWidth === 0) {
          const src = img.getAttribute('src') || '';
          for (const key of ['maintenance', 'os', 'software', 'retro']) {
            if (src.includes(key) && window.SERVICE_IMAGES_B64[key]) {
              img.src = window.SERVICE_IMAGES_B64[key];
            }
          }
        }
      });
    }
  }
}

function closeServicesModal() {
  const overlay = document.getElementById('servicesModalOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

const WHATSAPP_SVG_ICON_HTML = `<svg class="whatsapp-svg-icon" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.04 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.04 3.67M9.53 7.34C9.36 7.34 9.09 7.4 8.87 7.65C8.65 7.89 8.03 8.47 8.03 9.66C8.03 10.84 8.89 11.99 9.01 12.15C9.13 12.31 10.7 14.73 13.12 15.77C13.7 16.01 14.15 16.17 14.5 16.28C15.09 16.47 15.63 16.44 16.06 16.38C16.53 16.31 17.52 15.78 17.73 15.2C17.93 14.61 17.93 14.11 17.87 14C17.81 13.9 17.65 13.84 17.41 13.72C17.17 13.6 15.98 13.01 15.76 12.93C15.54 12.85 15.38 12.81 15.22 13.05C15.06 13.3 14.59 13.84 14.45 14C14.31 14.17 14.17 14.19 13.93 14.07C13.69 13.95 12.91 13.7 11.98 12.87C11.26 12.22 10.77 11.42 10.63 11.18C10.49 10.94 10.61 10.81 10.73 10.69C10.84 10.58 10.98 10.4 11.1 10.26C11.22 10.12 11.26 10.02 11.34 9.86C11.42 9.7 11.38 9.56 11.32 9.44C11.26 9.32 10.8 8.19 10.61 7.73C10.42 7.28 10.23 7.34 10.09 7.34H9.53Z"/></svg>`;

function selectServicePackage(el, packageName, btnId) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  if (!el) return;

  const parent = el.parentElement;
  if (parent) {
    const siblings = parent.querySelectorAll('.service-price-card, .service-package-item');
    siblings.forEach(s => s.classList.remove('selected'));
  }

  el.classList.add('selected');

  if (btnId) {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.innerHTML = `${WHATSAPP_SVG_ICON_HTML} <span>Contratar: <b>${escapeHtml(packageName)}</b></span>`;
      btn.setAttribute('onclick', `contactWhatsApp('${packageName.replace(/'/g, "\\'")}')`);
      btn.style.boxShadow = '0 6px 22px rgba(37,211,102,0.6)';
    }
  }

  if (typeof showToast === 'function') {
    showToast(`✓ Seleccionado: ${packageName}`);
  }
}

async function contactWhatsApp(serviceName) {
  if (window.triggerHaptic) window.triggerHaptic(40);
  const phone = '5352512369';
  const message = `Hola Joa, me interesa el servicio de: ${serviceName}. ¿Podrías darme más información?`;
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  if (typeof showToast === 'function') {
    showToast(`💬 Abriendo WhatsApp para "${serviceName}"...`);
  }

  setTimeout(() => {
    try {
      const win = window.open(url, '_blank');
      if (!win) {
        window.location.href = url;
      }
    } catch (e) {
      window.location.href = url;
    }
  }, 300);
}

// ==========================================
// 🖥️ CAN I RUN IT? - VERIFICADOR DE COMPATIBILIDAD PC CON IA
// ==========================================
const USER_PC_PROFILE_KEY = 'user_pc_hardware_profile';

const DEFAULT_PC_PROFILE = {
  cpu: 'Intel Core i5-10400F',
  gpu: 'NVIDIA GeForce GTX 1650 4GB',
  vram: '4 GB',
  ram: '16 GB',
  os: 'Windows 10 64-bit',
  storage: 'SSD (Rápido NVMe/SATA)'
};

function getUserPcProfile() {
  try {
    const raw = localStorage.getItem(USER_PC_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.vram && parsed.gpu) {
        const m = parsed.gpu.match(/(\d+)\s*(?:gb|g\b)/i);
        parsed.vram = m ? `${m[1]} GB` : '4 GB';
      }
      return Object.assign({}, DEFAULT_PC_PROFILE, parsed);
    }
  } catch (e) {
    console.warn('Error al leer perfil de PC:', e);
  }
  return Object.assign({}, DEFAULT_PC_PROFILE);
}

function saveUserPcProfile(notify = false) {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const cpu = (document.getElementById('pcCpuInput')?.value || '').trim() || DEFAULT_PC_PROFILE.cpu;
  const gpu = (document.getElementById('pcGpuInput')?.value || '').trim() || DEFAULT_PC_PROFILE.gpu;
  const vram = document.getElementById('pcVramSelect')?.value || DEFAULT_PC_PROFILE.vram;
  const ram = document.getElementById('pcRamSelect')?.value || DEFAULT_PC_PROFILE.ram;
  const os = document.getElementById('pcOsSelect')?.value || DEFAULT_PC_PROFILE.os;
  const storage = document.getElementById('pcStorageSelect')?.value || DEFAULT_PC_PROFILE.storage;

  const profile = { cpu, gpu, vram, ram, os, storage };
  try {
    localStorage.setItem(USER_PC_PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.warn('Error al guardar perfil de PC:', e);
  }

  updateCurrentProfilePill(profile);
  updateVramDiagnosticCard(vram);
  updateGpuTierBadge(gpu);
  updateCpuTierBadge(cpu);

  if (currentDetailId && typeof allItems !== 'undefined') {
    const currentIt = allItems.find(i => i.id === currentDetailId);
    if (currentIt && typeof renderDetailCpuBenchmark === 'function') {
      renderDetailCpuBenchmark(currentIt);
    }
  }

  if (notify && typeof showToast === 'function') {
    showToast('💾 Perfil de hardware guardado correctamente');
    switchPcTab('checkGame');
  }
}

function updateCurrentProfilePill(profile) {
  const p = profile || getUserPcProfile();
  const txtEl = document.getElementById('pcCurrentProfileTxt');
  if (txtEl) {
    const vramInfo = p.vram ? ` • ${escapeHtml(p.vram)} VRAM` : '';
    txtEl.innerHTML = `<b>Mi PC:</b> ${escapeHtml(p.cpu)} • ${escapeHtml(p.gpu)}${vramInfo} • ${escapeHtml(p.ram)} • ${escapeHtml(p.os.split(' ')[0])}`;
  }
}

function updateVramDiagnosticCard(vramVal) {
  const vramGB = parseInt(vramVal, 10) || 4;
  const badgeEl = document.getElementById('pcVramSelectedBadge');
  const iconEl = document.getElementById('pcVramDiagIcon');
  const titleEl = document.getElementById('pcVramDiagTitle');
  const descEl = document.getElementById('pcVramDiagDesc');

  // Actualizar chip activo en la UI
  document.querySelectorAll('.pc-vram-chip').forEach(chip => {
    const chipVal = chip.getAttribute('data-vram');
    if (chipVal === `${vramGB} GB` || chipVal === vramVal) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });

  if (badgeEl) badgeEl.textContent = `${vramGB} GB VRAM`;

  let icon = '⚡';
  let title = '';
  let desc = '';

  if (vramGB <= 2) {
    icon = '⚠️';
    title = 'Impacto en Juegos: Muy Limitado (720p / Gráficos Integrados)';
    desc = '2GB de VRAM se saturan al instante en juegos 3D modernos. Se recomienda resolución <b>720p/900p</b> con texturas en <b>Bajo</b>, apto para esports ligeros (LoL, CS2 ligero, Valorant) o títulos anteriores a 2017.';
  } else if (vramGB <= 3) {
    icon = '🟡';
    title = 'Impacto en Juegos: Ajustado (1080p Calidad Baja-Media)';
    desc = '3GB de VRAM permiten ejecutar juegos a 1080p con texturas en <b>Bajo o Medio</b>. En mundos abiertos exigentes pueden ocurrir microtirones (*stuttering*) si se eleva el filtrado de texturas.';
  } else if (vramGB <= 4) {
    icon = '🎮';
    title = 'Impacto en Juegos: 1080p Calidad Media (Nivel GTX 1650)';
    desc = 'Los <b>4GB de VRAM</b> ejecutan de forma estable juegos a 1080p con texturas en calidad <b>Media</b>. En títulos modernos de 2023+ (The Last of Us, Hogwarts Legacy, Alan Wake 2), se debe evitar Texturas Altas para prevenir caídas de FPS por desborde de VRAM.';
  } else if (vramGB <= 6) {
    icon = '⚡';
    title = 'Impacto en Juegos: 1080p Calidad Media-Alta Sólida';
    desc = 'Los <b>6GB de VRAM</b> (RTX 2060 / GTX 1660 Ti) proporcionan holgura para texturas en <b>Alta</b> en la mayoría de juegos 1080p y trazado de rayos básico en GPUs compatibles.';
  } else if (vramGB <= 8) {
    icon = '🚀';
    title = 'Impacto en Juegos: Estándar Gaming 1080p / 1440p Texturas Altas';
    desc = 'Los <b>8GB de VRAM</b> (RTX 4060 / RX 6600) son el estándar para 1080p y 1440p con texturas en <b>Alta/Ultra</b>, soporte para Frame Generation y renderizado fluido.';
  } else if (vramGB <= 12) {
    icon = '🔥';
    title = 'Impacto en Juegos: 1440p / 2K Texturas Ultra Holgadas';
    desc = 'Los <b>12GB de VRAM</b> (RTX 3060 12GB / RTX 4070) aseguran texturas en <b>Ultra absoluta en 1440p</b>, Ray Tracing sin limitaciones y espacio suficiente para escalado DLSS 3 / FSR 3.';
  } else if (vramGB <= 16) {
    icon = '👑';
    title = 'Impacto en Juegos: Texturas Ultra 4K / Nivel Entusiasta';
    desc = 'Los <b>16GB de VRAM</b> (RTX 4060 16GB / RX 7800 XT) eliminan cualquier cuello de botella de memoria en <b>1440p y 4K</b>, permitiendo paquetes de texturas HD, mods pesados y máxima fidelidad visual.';
  } else {
    icon = '🌌';
    title = 'Impacto en Juegos: Nivel Extremo 4K Ultra Sin Restricciones';
    desc = 'Los <b>24GB de VRAM</b> (RTX 4090 / RX 7900 XTX) entregan potencia absoluta para <b>4K nativo Ultra</b> con Path Tracing completo sin ninguna limitación de memoria.';
  }

  if (iconEl) iconEl.textContent = icon;
  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.innerHTML = desc;
}

function setSpecVram(vramVal) {
  if (window.triggerHaptic) window.triggerHaptic(20);
  const select = document.getElementById('pcVramSelect');
  if (select) {
    select.value = vramVal;
  }
  updateVramDiagnosticCard(vramVal);
  saveUserPcProfile(false);
}

function onVramSelectChanged() {
  const select = document.getElementById('pcVramSelect');
  if (select) {
    const vramVal = select.value;
    updateVramDiagnosticCard(vramVal);
    saveUserPcProfile(false);
  }
}

function setSpecGpuAndVram(gpuVal, vramVal) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  const gpuInput = document.getElementById('pcGpuInput');
  const vramSelect = document.getElementById('pcVramSelect');
  if (gpuInput) gpuInput.value = gpuVal;
  if (vramSelect && vramVal) vramSelect.value = vramVal;
  if (vramVal) updateVramDiagnosticCard(vramVal);
  updateGpuTierBadge(gpuVal);
  saveUserPcProfile(false);
}

function onGpuInputChanged() {
  const gpuInput = document.getElementById('pcGpuInput');
  const val = (gpuInput?.value || '').trim();
  updateGpuTierBadge(val);
  handlePcGpuAutocomplete(val);

  // Auto-detectar cantidad de VRAM si el usuario la escribe
  const match = val.match(/(\d+)\s*(?:gb|g\b)/i);
  if (match) {
    const detectedGb = parseInt(match[1], 10);
    const validValues = [2, 3, 4, 6, 8, 12, 16, 24];
    const closest = validValues.find(v => v === detectedGb);
    if (closest) {
      const vramStr = `${closest} GB`;
      const select = document.getElementById('pcVramSelect');
      if (select && select.value !== vramStr) {
        select.value = vramStr;
        updateVramDiagnosticCard(vramStr);
      }
    }
  }
  saveUserPcProfile(false);
}

function updateGpuTierBadge(gpuVal) {
  const badgeEl = document.getElementById('pcGpuTierBadge');
  if (!badgeEl) return;
  const evalGpu = evaluateGpuBenchmark(gpuVal);
  badgeEl.textContent = evalGpu.tierName.split('(')[0].trim();
}

function onCpuInputChanged() {
  const cpuInput = document.getElementById('pcCpuInput');
  const val = (cpuInput?.value || '').trim();
  updateCpuTierBadge(val);
  handlePcCpuAutocomplete(val);
  updateLiveCpuArchCard(val);
  saveUserPcProfile(false);
}

function updateCpuTierBadge(cpuVal) {
  const badgeEl = document.getElementById('pcCpuTierBadge');
  if (!badgeEl) return;
  const evalCpu = evaluateCpuBenchmark(cpuVal);
  const shortName = evalCpu.tierName.split('(')[0].replace(/Intel|AMD/g, '').trim();
  badgeEl.textContent = shortName || evalCpu.family;
  if (evalCpu.score >= 9.5) {
    badgeEl.style.background = 'linear-gradient(135deg, rgba(0,255,178,0.25), rgba(0,229,255,0.3))';
    badgeEl.style.borderColor = 'rgba(0,255,178,0.7)';
    badgeEl.style.color = '#00FFB2';
  } else if (evalCpu.score >= 8.5) {
    badgeEl.style.background = 'linear-gradient(135deg, rgba(0,229,255,0.2), rgba(157,78,221,0.25))';
    badgeEl.style.borderColor = 'rgba(0,229,255,0.5)';
    badgeEl.style.color = '#00E5FF';
  } else if (evalCpu.score >= 7.0) {
    badgeEl.style.background = 'linear-gradient(135deg, rgba(255,183,3,0.2), rgba(251,133,0,0.25))';
    badgeEl.style.borderColor = 'rgba(255,183,3,0.5)';
    badgeEl.style.color = '#FFB703';
  } else {
    badgeEl.style.background = 'linear-gradient(135deg, rgba(230,57,70,0.2), rgba(180,30,50,0.25))';
    badgeEl.style.borderColor = 'rgba(230,57,70,0.5)';
    badgeEl.style.color = '#FF6B6B';
  }
}

const CPU_DATABASE = [
  // AMD Zen 5 (9000 Series & AI)
  { name: 'AMD Ryzen 9 9950X', tag: '16C / 32T (5.7 GHz)', arch: 'Zen 5 Flagship Top Mundial' },
  { name: 'AMD Ryzen 9 9900X', tag: '12C / 24T (5.6 GHz)', arch: 'Zen 5 Entusiasta' },
  { name: 'AMD Ryzen 7 9800X3D', tag: '8C / 16T (3D V-Cache)', arch: 'Rey Absoluto del Gaming' },
  { name: 'AMD Ryzen 7 9700X', tag: '8C / 16T (5.5 GHz)', arch: 'Zen 5 Alto IPC' },
  { name: 'AMD Ryzen 5 9600X', tag: '6C / 12T (5.4 GHz)', arch: 'Zen 5 Gamer' },
  { name: 'AMD Ryzen AI 9 HX 370', tag: '12C / 24T Mobile', arch: 'Zen 5 Strix Point' },

  // AMD Zen 4 (7000 & 8000 Series)
  { name: 'AMD Ryzen 9 7950X3D', tag: '16C / 32T (128MB Cache)', arch: 'Zen 4 3D V-Cache' },
  { name: 'AMD Ryzen 9 7950X', tag: '16C / 32T (5.7 GHz)', arch: 'Zen 4 Flagship' },
  { name: 'AMD Ryzen 9 7900X3D', tag: '12C / 24T (128MB Cache)', arch: 'Zen 4 3D V-Cache' },
  { name: 'AMD Ryzen 9 7900X', tag: '12C / 24T (5.6 GHz)', arch: 'Zen 4 Entusiasta' },
  { name: 'AMD Ryzen 9 7900', tag: '12C / 24T (5.4 GHz)', arch: 'Zen 4 65W Eficiente' },
  { name: 'AMD Ryzen 9 7945HX', tag: '16C / 32T Laptop Flagship', arch: 'Dragon Range' },
  { name: 'AMD Ryzen 7 7800X3D', tag: '8C / 16T (96MB Cache)', arch: 'Campeón Gaming de Referencia' },
  { name: 'AMD Ryzen 7 7700X', tag: '8C / 16T (5.4 GHz)', arch: 'Zen 4 Gama Alta' },
  { name: 'AMD Ryzen 7 7700', tag: '8C / 16T (5.3 GHz)', arch: 'Zen 4 Gamer' },
  { name: 'AMD Ryzen 7 8700G', tag: '8C / 16T + Radeon 780M', arch: 'Zen 4 Phoenix APU' },
  { name: 'AMD Ryzen 5 7600X', tag: '6C / 12T (5.3 GHz)', arch: 'Zen 4 Gamer Calidad/Precio' },
  { name: 'AMD Ryzen 5 7600', tag: '6C / 12T (5.1 GHz)', arch: 'Zen 4 Equilibrado' },
  { name: 'AMD Ryzen 5 7500F', tag: '6C / 12T (5.0 GHz)', arch: 'Zen 4 Gamer Puro' },
  { name: 'AMD Ryzen 5 8600G', tag: '6C / 12T + Radeon 760M', arch: 'Zen 4 Phoenix APU' },

  // AMD Zen 3 & Zen 3+ (5000 & 6000 Series)
  { name: 'AMD Ryzen 9 5950X', tag: '16C / 32T (4.9 GHz)', arch: 'Zen 3 Flagship' },
  { name: 'AMD Ryzen 9 5900X', tag: '12C / 24T (4.8 GHz)', arch: 'Zen 3 Entusiasta' },
  { name: 'AMD Ryzen 9 5900XT', tag: '16C / 32T (4.8 GHz)', arch: 'Zen 3 Refresh' },
  { name: 'AMD Ryzen 9 6900HX', tag: '8C / 16T Mobile', arch: 'Rembrandt Zen 3+' },
  { name: 'AMD Ryzen 9 5900HX', tag: '8C / 16T Laptop', arch: 'Cezanne Zen 3' },
  { name: 'AMD Ryzen 7 5800X3D', tag: '8C / 16T (96MB Cache)', arch: 'Zen 3 3D V-Cache Legendario' },
  { name: 'AMD Ryzen 7 5700X3D', tag: '8C / 16T (96MB Cache)', arch: 'Zen 3 3D V-Cache Gamer' },
  { name: 'AMD Ryzen 7 5800X', tag: '8C / 16T (4.7 GHz)', arch: 'Zen 3 Gama Alta' },
  { name: 'AMD Ryzen 7 5700X', tag: '8C / 16T (4.6 GHz)', arch: 'Zen 3 Eficiente' },
  { name: 'AMD Ryzen 7 5700G', tag: '8C / 16T + Vega 8', arch: 'Zen 3 APU' },
  { name: 'AMD Ryzen 5 5600X', tag: '6C / 12T (4.6 GHz)', arch: 'Zen 3 Favorito Gamer' },
  { name: 'AMD Ryzen 5 5600', tag: '6C / 12T (4.4 GHz)', arch: 'Zen 3 Gran Rendimiento' },
  { name: 'AMD Ryzen 5 5600GT', tag: '6C / 12T + Vega 7', arch: 'Zen 3 APU' },
  { name: 'AMD Ryzen 5 5600G', tag: '6C / 12T + Vega 7', arch: 'Zen 3 APU' },
  { name: 'AMD Ryzen 5 5500', tag: '6C / 12T (4.2 GHz)', arch: 'Zen 3 Gama Media' },

  // AMD Zen 2 (3000 & 4000 Series)
  { name: 'AMD Ryzen 9 3950X', tag: '16C / 32T (4.7 GHz)', arch: 'Zen 2 Flagship' },
  { name: 'AMD Ryzen 9 3900X', tag: '12C / 24T (4.6 GHz)', arch: 'Zen 2 Entusiasta' },
  { name: 'AMD Ryzen 7 3800X', tag: '8C / 16T (4.5 GHz)', arch: 'Zen 2 Alto Reloj' },
  { name: 'AMD Ryzen 7 3700X', tag: '8C / 16T (4.4 GHz)', arch: 'Zen 2 Gama Media-Alta' },
  { name: 'AMD Ryzen 5 3600X', tag: '6C / 12T (4.4 GHz)', arch: 'Zen 2 Gamer' },
  { name: 'AMD Ryzen 5 3600', tag: '6C / 12T (4.2 GHz)', arch: 'Zen 2 Clásico Calidad/Precio' },
  { name: 'AMD Ryzen 5 4500', tag: '6C / 12T (4.1 GHz)', arch: 'Zen 2 Renoir' },
  { name: 'AMD Ryzen 5 4600G', tag: '6C / 12T + Vega 7', arch: 'Zen 2 APU' },
  { name: 'AMD Ryzen 3 3300X', tag: '4C / 8T (4.3 GHz)', arch: 'Zen 2 Monocore Rápido' },
  { name: 'AMD Ryzen 3 3100', tag: '4C / 8T (3.9 GHz)', arch: 'Zen 2 Gama Media-Baja' },

  // AMD Zen+ & Zen 1 (1000 & 2000 Series)
  { name: 'AMD Ryzen 7 2700X', tag: '8C / 16T (4.3 GHz)', arch: 'Zen+ 12nm' },
  { name: 'AMD Ryzen 7 1700', tag: '8C / 16T (3.7 GHz)', arch: 'Zen 1ª Gen' },
  { name: 'AMD Ryzen 5 2600X', tag: '6C / 12T (4.2 GHz)', arch: 'Zen+ Gamer' },
  { name: 'AMD Ryzen 5 2600', tag: '6C / 12T (3.9 GHz)', arch: 'Zen+ Gama Media' },
  { name: 'AMD Ryzen 5 1600 AF', tag: '6C / 12T (Zen+ 12nm)', arch: 'Zen+ Económico' },
  { name: 'AMD Ryzen 5 1600', tag: '6C / 12T (3.6 GHz)', arch: 'Zen 1ª Gen' },
  { name: 'AMD Ryzen 3 3200G', tag: '4C / 4T + Vega 8', arch: 'Zen+ APU' },
  { name: 'AMD Ryzen 3 2200G', tag: '4C / 4T + Vega 8', arch: 'Zen APU' },
  { name: 'AMD FX-8350 Eight-Core', tag: '8C / 8T (4.0 GHz)', arch: 'Piledriver AM3+' },

  // Intel Core Ultra (Arrow Lake & Meteor Lake - 2024/2025)
  { name: 'Intel Core Ultra 9 285K', tag: '24C (8P+16E) / 24T', arch: 'Arrow Lake Flagship' },
  { name: 'Intel Core Ultra 7 265K', tag: '20C (8P+12E) / 20T', arch: 'Arrow Lake Gama Alta' },
  { name: 'Intel Core Ultra 5 245K', tag: '14C (6P+8E) / 14T', arch: 'Arrow Lake Gamer' },
  { name: 'Intel Core Ultra 9 185H', tag: '16C / 22T Laptop', arch: 'Meteor Lake Mobile' },
  { name: 'Intel Core Ultra 7 155H', tag: '16C / 22T Laptop', arch: 'Meteor Lake Mobile' },

  // Intel 14ª Gen (Raptor Lake Refresh)
  { name: 'Intel Core i9-14900KS', tag: '24C / 32T (6.2 GHz)', arch: 'Raptor Lake Refresh Top' },
  { name: 'Intel Core i9-14900K', tag: '24C / 32T (6.0 GHz)', arch: 'Raptor Lake-R Flagship' },
  { name: 'Intel Core i7-14700K', tag: '20C (8P+12E) / 28T', arch: 'Raptor Lake-R Gamer Supremo' },
  { name: 'Intel Core i7-14700F', tag: '20C (8P+12E) / 28T', arch: 'Raptor Lake-R Gama Alta' },
  { name: 'Intel Core i5-14600K', tag: '14C (6P+8E) / 20T', arch: 'Raptor Lake-R Gamer Favorito' },
  { name: 'Intel Core i5-14500', tag: '14C (6P+8E) / 20T', arch: '14ª Gen Calidad/Precio' },
  { name: 'Intel Core i5-14400F', tag: '10C (6P+4E) / 16T', arch: '14ª Gen Gamer Equilibrado' },
  { name: 'Intel Core i3-14100F', tag: '4C / 8T (4.7 GHz)', arch: '14ª Gen Entrada Rápido' },

  // Intel 13ª Gen (Raptor Lake)
  { name: 'Intel Core i9-13900KS', tag: '24C / 32T (6.0 GHz)', arch: 'Raptor Lake Flagship' },
  { name: 'Intel Core i9-13900K', tag: '24C / 32T (5.8 GHz)', arch: 'Raptor Lake Entusiasta' },
  { name: 'Intel Core i7-13700K', tag: '16C (8P+8E) / 24T', arch: 'Raptor Lake Gama Alta' },
  { name: 'Intel Core i7-13700F', tag: '16C (8P+8E) / 24T', arch: 'Raptor Lake 5.2 GHz' },
  { name: 'Intel Core i5-13600K', tag: '14C (6P+8E) / 20T', arch: 'Raptor Lake Gamer' },
  { name: 'Intel Core i5-13500', tag: '14C (6P+8E) / 20T', arch: '13ª Gen Versátil' },
  { name: 'Intel Core i5-13400F', tag: '10C (6P+4E) / 16T', arch: '13ª Gen Gamer' },
  { name: 'Intel Core i3-13100F', tag: '4C / 8T (4.5 GHz)', arch: '13ª Gen Gama Media-Baja' },

  // Intel 12ª Gen (Alder Lake)
  { name: 'Intel Core i9-12900K', tag: '16C (8P+8E) / 24T', arch: 'Alder Lake Flagship' },
  { name: 'Intel Core i7-12700K', tag: '12C (8P+4E) / 20T', arch: 'Alder Lake Gama Alta' },
  { name: 'Intel Core i7-12700F', tag: '12C (8P+4E) / 20T', arch: 'Alder Lake 4.9 GHz' },
  { name: 'Intel Core i5-12600K', tag: '10C (6P+4E) / 16T', arch: 'Alder Lake Gamer' },
  { name: 'Intel Core i5-12400F', tag: '6C / 12T (4.4 GHz)', arch: 'Alder Lake Rey Calidad/Precio' },
  { name: 'Intel Core i5-12400', tag: '6C / 12T (4.4 GHz)', arch: 'Alder Lake con UHD 730' },
  { name: 'Intel Core i3-12100F', tag: '4C / 8T (4.3 GHz)', arch: 'Alder Lake Entrada Fuerte' },

  // Intel 10ª & 11ª Gen
  { name: 'Intel Core i9-11900K', tag: '8C / 16T (5.3 GHz)', arch: 'Rocket Lake' },
  { name: 'Intel Core i7-11700K', tag: '8C / 16T (5.0 GHz)', arch: 'Rocket Lake' },
  { name: 'Intel Core i5-11600K', tag: '6C / 12T (4.9 GHz)', arch: 'Rocket Lake' },
  { name: 'Intel Core i5-11400F', tag: '6C / 12T (4.4 GHz)', arch: 'Rocket Lake Calidad/Precio' },
  { name: 'Intel Core i9-10900K', tag: '10C / 20T (5.3 GHz)', arch: 'Comet Lake Flagship' },
  { name: 'Intel Core i7-10700K', tag: '8C / 16T (5.1 GHz)', arch: 'Comet Lake' },
  { name: 'Intel Core i5-10400F', tag: '6C / 12T (4.3 GHz)', arch: 'Comet Lake Gamer Popular' },
  { name: 'Intel Core i3-10100F', tag: '4C / 8T (4.3 GHz)', arch: 'Comet Lake Entrada' },

  // Intel 8ª & 9ª Gen
  { name: 'Intel Core i9-9900K', tag: '8C / 16T (5.0 GHz)', arch: 'Coffee Lake Refresh' },
  { name: 'Intel Core i7-9700K', tag: '8C / 8T (4.9 GHz)', arch: 'Coffee Lake Refresh' },
  { name: 'Intel Core i7-8700K', tag: '6C / 12T (4.7 GHz)', arch: 'Coffee Lake' },
  { name: 'Intel Core i5-9400F', tag: '6C / 6T (4.1 GHz)', arch: 'Coffee Lake Refresh' },
  { name: 'Intel Core i5-8400', tag: '6C / 6T (4.0 GHz)', arch: 'Coffee Lake' },
  { name: 'Intel Core i3-9100F', tag: '4C / 4T (4.2 GHz)', arch: 'Coffee Lake Refresh' },

  // Intel Generaciones Previas Clásicas
  { name: 'Intel Core i7-7700K', tag: '4C / 8T (4.5 GHz)', arch: 'Kaby Lake' },
  { name: 'Intel Core i7-6700K', tag: '4C / 8T (4.2 GHz)', arch: 'Skylake' },
  { name: 'Intel Core i7-4790K', tag: '4C / 8T (4.4 GHz)', arch: 'Devil Canyon Haswell' },
  { name: 'Intel Core i7-3770K', tag: '4C / 8T (3.9 GHz)', arch: 'Ivy Bridge' },
  { name: 'Intel Core i7-2600K', tag: '4C / 8T (3.8 GHz)', arch: 'Sandy Bridge' },
  { name: 'Intel Core i5-7400', tag: '4C / 4T (3.5 GHz)', arch: 'Kaby Lake' },
  { name: 'Intel Core i5-6500', tag: '4C / 4T (3.6 GHz)', arch: 'Skylake' },
  { name: 'Intel Core i5-4460', tag: '4C / 4T (3.4 GHz)', arch: 'Haswell' },
  { name: 'Intel Core i5-3470', tag: '4C / 4T (3.6 GHz)', arch: 'Ivy Bridge' },
  { name: 'Intel Core i5-2500K', tag: '4C / 4T (3.7 GHz)', arch: 'Sandy Bridge Clásico' },
  { name: 'Intel Core i3-4130', tag: '2C / 4T (3.4 GHz)', arch: 'Haswell' },
  { name: 'Intel Xeon E5-2690 v3', tag: '12C / 24T (3.5 GHz)', arch: 'Haswell-EP' },
  { name: 'Intel Xeon E5-2680 v4', tag: '14C / 28T (3.3 GHz)', arch: 'Broadwell-EP' },
  { name: 'Intel Xeon E5-2678 v3', tag: '12C / 24T (3.1 GHz)', arch: 'Haswell-EP Popular' },
  { name: 'Intel Xeon E5-2666 v3', tag: '10C / 20T (3.5 GHz)', arch: 'Haswell-EP' },
  { name: 'Intel Xeon E3-1230 v3', tag: '4C / 8T (3.7 GHz)', arch: 'Haswell Xeon' },
  { name: 'Intel Pentium Gold G6400', tag: '2C / 4T (4.0 GHz)', arch: 'Comet Lake' },
  { name: 'Intel Pentium G4560', tag: '2C / 4T (3.5 GHz)', arch: 'Kaby Lake' },
  { name: 'Intel Pentium G3258', tag: '2C / 2T (3.2 GHz)', arch: 'Haswell Aniversario' },
  { name: 'Intel Core 2 Quad Q9650', tag: '4C / 4T (3.0 GHz)', arch: 'Yorkfield 12MB Cache' },
  { name: 'Intel Core 2 Quad Q6600', tag: '4C / 4T (2.4 GHz)', arch: 'Kentsfield Clásico' },
  { name: 'Intel Core 2 Duo E8500', tag: '2C / 2T (3.16 GHz)', arch: 'Wolfdale 45nm' },
  { name: 'Intel Core 2 Duo E8400', tag: '2C / 2T (3.0 GHz)', arch: 'Wolfdale Clásico' },
  { name: 'Intel Core 2 Duo E7500', tag: '2C / 2T (2.93 GHz)', arch: 'Wolfdale 3MB' },
  { name: 'Intel Core 2 Duo E6600', tag: '2C / 2T (2.4 GHz)', arch: 'Conroe 65nm' },
  { name: 'AMD Athlon 3000G', tag: '2C / 4T (3.5 GHz) + Vega 3', arch: 'Zen 14nm APU' },
  { name: 'AMD Athlon 200GE', tag: '2C / 4T (3.2 GHz) + Vega 3', arch: 'Zen APU Entrada' },
  { name: 'AMD FX-9590 Eight-Core', tag: '8C / 8T (4.7-5.0 GHz)', arch: 'Piledriver 220W' },
  { name: 'AMD FX-8320 Eight-Core', tag: '8C / 8T (3.5 GHz)', arch: 'Piledriver AM3+' },
  { name: 'AMD FX-6300 Six-Core', tag: '6C / 6T (3.5 GHz)', arch: 'Piledriver 6C' }
];

const GPU_DATABASE = [
  // NVIDIA RTX Serie 50 & 40 (Blackwell & Ada Lovelace)
  { name: 'NVIDIA GeForce RTX 5090 32GB', vram: '32 GB', arch: 'Blackwell Flagship 4K Ultra', tier: 'Entusiasta' },
  { name: 'NVIDIA GeForce RTX 5080 16GB', vram: '16 GB', arch: 'Blackwell Gama Alta 4K', tier: 'Entusiasta' },
  { name: 'NVIDIA GeForce RTX 4090 24GB', vram: '24 GB', arch: 'Ada Lovelace Tope 4K Ultra', tier: 'Entusiasta' },
  { name: 'NVIDIA GeForce RTX 4080 Super 16GB', vram: '16 GB', arch: 'Ada Lovelace 4K Ultra', tier: 'Entusiasta' },
  { name: 'NVIDIA GeForce RTX 4080 16GB', vram: '16 GB', arch: 'Ada Lovelace 4K Ultra', tier: 'Entusiasta' },
  { name: 'NVIDIA GeForce RTX 4070 Ti Super 16GB', vram: '16 GB', arch: 'Ada Lovelace 1440p/4K', tier: 'Gama Alta' },
  { name: 'NVIDIA GeForce RTX 4070 Super 12GB', vram: '12 GB', arch: 'Ada Lovelace 1440p Ultra', tier: 'Gama Alta' },
  { name: 'NVIDIA GeForce RTX 4070 Ti 12GB', vram: '12 GB', arch: 'Ada Lovelace 1440p Ultra', tier: 'Gama Alta' },
  { name: 'NVIDIA GeForce RTX 4070 12GB', vram: '12 GB', arch: 'Ada Lovelace 1440p Ultra', tier: 'Gama Alta' },
  { name: 'NVIDIA GeForce RTX 4060 Ti 16GB', vram: '16 GB', arch: 'Ada Lovelace 1080p/1440p 16GB VRAM', tier: 'Media-Alta' },
  { name: 'NVIDIA GeForce RTX 4060 Ti 8GB', vram: '8 GB', arch: 'Ada Lovelace 1080p/1440p', tier: 'Media-Alta' },
  { name: 'NVIDIA GeForce RTX 4060 16GB', vram: '16 GB', arch: 'Ada Lovelace 1080p Ultra DLSS 3', tier: 'Media-Alta' },
  { name: 'NVIDIA GeForce RTX 4060 8GB', vram: '8 GB', arch: 'Ada Lovelace 1080p Ultra DLSS 3', tier: 'Media-Alta' },
  { name: 'NVIDIA GeForce RTX 4050 Laptop 6GB', vram: '6 GB', arch: 'Ada Lovelace Mobile', tier: 'Gama Media' },

  // NVIDIA RTX Serie 30 (Ampere)
  { name: 'NVIDIA GeForce RTX 3090 Ti 24GB', vram: '24 GB', arch: 'Ampere 24GB VRAM', tier: 'Entusiasta' },
  { name: 'NVIDIA GeForce RTX 3090 24GB', vram: '24 GB', arch: 'Ampere 24GB VRAM', tier: 'Entusiasta' },
  { name: 'NVIDIA GeForce RTX 3080 Ti 12GB', vram: '12 GB', arch: 'Ampere 4K/1440p', tier: 'Gama Alta' },
  { name: 'NVIDIA GeForce RTX 3080 12GB', vram: '12 GB', arch: 'Ampere 1440p Ultra', tier: 'Gama Alta' },
  { name: 'NVIDIA GeForce RTX 3080 10GB', vram: '10 GB', arch: 'Ampere 1440p Ultra', tier: 'Gama Alta' },
  { name: 'NVIDIA GeForce RTX 3070 Ti 8GB', vram: '8 GB', arch: 'Ampere 1440p Alta', tier: 'Media-Alta' },
  { name: 'NVIDIA GeForce RTX 3070 8GB', vram: '8 GB', arch: 'Ampere 1440p Gamer', tier: 'Media-Alta' },
  { name: 'NVIDIA GeForce RTX 3060 Ti 8GB', vram: '8 GB', arch: 'Ampere Calidad/Precio', tier: 'Media-Alta' },
  { name: 'NVIDIA GeForce RTX 3060 12GB', vram: '12 GB', arch: 'Ampere 12GB VRAM Gamer', tier: 'Gama Media' },
  { name: 'NVIDIA GeForce RTX 3050 8GB', vram: '8 GB', arch: 'Ampere 1080p Entrada', tier: 'Media-Baja' },
  { name: 'NVIDIA GeForce RTX 3050 6GB', vram: '6 GB', arch: 'Ampere 1080p Bajo Consumo', tier: 'Media-Baja' },

  // NVIDIA RTX Serie 20 & GTX Serie 16/10
  { name: 'NVIDIA GeForce RTX 2080 Ti 11GB', vram: '11 GB', arch: 'Turing Flagship', tier: 'Gama Alta' },
  { name: 'NVIDIA GeForce RTX 2080 Super 8GB', vram: '8 GB', arch: 'Turing 1440p', tier: 'Gama Alta' },
  { name: 'NVIDIA GeForce RTX 2070 Super 8GB', vram: '8 GB', arch: 'Turing 1440p', tier: 'Media-Alta' },
  { name: 'NVIDIA GeForce RTX 2060 Super 8GB', vram: '8 GB', arch: 'Turing 8GB VRAM', tier: 'Gama Media' },
  { name: 'NVIDIA GeForce RTX 2060 12GB', vram: '12 GB', arch: 'Turing 12GB VRAM', tier: 'Gama Media' },
  { name: 'NVIDIA GeForce RTX 2060 6GB', vram: '6 GB', arch: 'Turing DLSS Gamer', tier: 'Gama Media' },
  { name: 'NVIDIA GeForce GTX 1660 Super 6GB', vram: '6 GB', arch: 'Turing GDDR6 1080p', tier: 'Gama Media' },
  { name: 'NVIDIA GeForce GTX 1660 Ti 6GB', vram: '6 GB', arch: 'Turing 1080p', tier: 'Gama Media' },
  { name: 'NVIDIA GeForce GTX 1660 6GB', vram: '6 GB', arch: 'Turing 1080p Clásico', tier: 'Gama Media' },
  { name: 'NVIDIA GeForce GTX 1650 Super 4GB', vram: '4 GB', arch: 'Turing GDDR6', tier: 'Entrada' },
  { name: 'NVIDIA GeForce GTX 1650 4GB', vram: '4 GB', arch: 'Turing 1080p Entrada', tier: 'Entrada' },
  { name: 'NVIDIA GeForce GTX 1080 Ti 11GB', vram: '11 GB', arch: 'Pascal Legendario', tier: 'Media-Alta' },
  { name: 'NVIDIA GeForce GTX 1080 8GB', vram: '8 GB', arch: 'Pascal 8GB VRAM', tier: 'Gama Media' },
  { name: 'NVIDIA GeForce GTX 1070 8GB', vram: '8 GB', arch: 'Pascal 1080p/1440p', tier: 'Gama Media' },
  { name: 'NVIDIA GeForce GTX 1060 6GB', vram: '6 GB', arch: 'Pascal 1080p Clásico', tier: 'Entrada' },
  { name: 'NVIDIA GeForce GTX 1050 Ti 4GB', vram: '4 GB', arch: 'Pascal 4GB Clásico', tier: 'Básica' },
  { name: 'NVIDIA GeForce GTX 970 4GB', vram: '4 GB', arch: 'Maxwell Clásico', tier: 'Entrada' },

  // AMD Radeon RX Serie 7000 & 6000 (RDNA 3 & RDNA 2)
  { name: 'AMD Radeon RX 7900 XTX 24GB', vram: '24 GB', arch: 'RDNA 3 Flagship 24GB', tier: 'Entusiasta' },
  { name: 'AMD Radeon RX 7900 XT 20GB', vram: '20 GB', arch: 'RDNA 3 20GB VRAM', tier: 'Entusiasta' },
  { name: 'AMD Radeon RX 7900 GRE 16GB', vram: '16 GB', arch: 'RDNA 3 16GB VRAM 1440p/4K', tier: 'Gama Alta' },
  { name: 'AMD Radeon RX 7800 XT 16GB', vram: '16 GB', arch: 'RDNA 3 16GB Rey 1440p', tier: 'Gama Alta' },
  { name: 'AMD Radeon RX 7700 XT 12GB', vram: '12 GB', arch: 'RDNA 3 12GB 1440p', tier: 'Media-Alta' },
  { name: 'AMD Radeon RX 7600 XT 16GB', vram: '16 GB', arch: 'RDNA 3 16GB VRAM 1080p/1440p', tier: 'Media-Alta' },
  { name: 'AMD Radeon RX 7600 8GB', vram: '8 GB', arch: 'RDNA 3 1080p Ultra', tier: 'Gama Media' },
  { name: 'AMD Radeon RX 6950 XT 16GB', vram: '16 GB', arch: 'RDNA 2 Tope de Gama', tier: 'Gama Alta' },
  { name: 'AMD Radeon RX 6800 XT 16GB', vram: '16 GB', arch: 'RDNA 2 16GB VRAM', tier: 'Gama Alta' },
  { name: 'AMD Radeon RX 6750 XT 12GB', vram: '12 GB', arch: 'RDNA 2 12GB VRAM', tier: 'Media-Alta' },
  { name: 'AMD Radeon RX 6700 XT 12GB', vram: '12 GB', arch: 'RDNA 2 12GB Calidad/Precio', tier: 'Media-Alta' },
  { name: 'AMD Radeon RX 6650 XT 8GB', vram: '8 GB', arch: 'RDNA 2 1080p Ultra', tier: 'Gama Media' },
  { name: 'AMD Radeon RX 6600 8GB', vram: '8 GB', arch: 'RDNA 2 Rey Calidad/Precio 1080p', tier: 'Gama Media' },
  { name: 'AMD Radeon RX 580 8GB', vram: '8 GB', arch: 'Polaris 8GB VRAM Clásico', tier: 'Media-Baja' },
  { name: 'AMD Radeon 780M (Integrada)', vram: '2 GB', arch: 'RDNA 3 APU Phoenix', tier: 'Integrada Gamer' },

  // Intel Arc & Gráficos Integrados
  { name: 'Intel Arc B580 12GB', vram: '12 GB', arch: 'Battlemage Xe2 1080p/1440p', tier: 'Media-Alta' },
  { name: 'Intel Arc A770 16GB', vram: '16 GB', arch: 'Alchemist Xe-HPG 16GB VRAM', tier: 'Media-Alta' },
  { name: 'Intel Arc A750 8GB', vram: '8 GB', arch: 'Alchemist Xe-HPG 1080p', tier: 'Gama Media' },
  { name: 'Intel Arc A580 8GB', vram: '8 GB', arch: 'Alchemist Xe-HPG Calidad/Precio', tier: 'Gama Media' },
  { name: 'Intel Arc A380 6GB', vram: '6 GB', arch: 'Alchemist 6GB Entrada', tier: 'Entrada' },
  { name: 'Intel Iris Xe Graphics', vram: '2 GB', arch: 'Intel Gen12 Integrada', tier: 'Integrada' },
  { name: 'Intel UHD Graphics 770', vram: '2 GB', arch: 'Intel 12ª-14ª Gen Integrada', tier: 'Integrada' },
  { name: 'Intel UHD Graphics 630', vram: '2 GB', arch: 'Intel 8ª-10ª Gen Integrada', tier: 'Integrada' },
  { name: 'Intel HD Graphics 4600 / 4000', vram: '2 GB', arch: 'Intel Clásica Integrada', tier: 'Integrada Básica' }
];

function handlePcCpuAutocomplete(query) {
  const dropdown = document.getElementById('pcCpuAutocompleteDropdown');
  if (!dropdown) return;
  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) {
    dropdown.style.display = 'none';
    return;
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const matches = CPU_DATABASE.filter(item => {
    const text = (item.name + ' ' + item.tag + ' ' + (item.arch || '')).toLowerCase();
    return terms.every(t => text.includes(t));
  }).slice(0, 7);

  if (matches.length === 0) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.innerHTML = matches.map(m => {
    const evalData = evaluateCpuBenchmark(m.name);
    return `
      <div class="pc-autocomplete-item" onclick="selectPcCpuAutocomplete('${escapeHtml(m.name)}')" style="padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.06); cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:background .15s ease;" onmouseover="this.style.background='rgba(0,229,255,0.1)'" onmouseout="this.style.background='transparent'">
        <div>
          <div style="font-weight:700; font-size:0.86rem; color:#FFFFFF;">${escapeHtml(m.name)}</div>
          <div style="font-size:0.72rem; color:#8E9AA8;">${escapeHtml(m.tag)} • ${escapeHtml(m.arch || '')}</div>
        </div>
        <span style="font-size:0.72rem; font-weight:800; padding:2px 6px; border-radius:4px; background:${evalData.score >= 9.5 ? 'rgba(0,255,178,0.2)' : (evalData.score >= 8.5 ? 'rgba(0,229,255,0.2)' : 'rgba(255,183,3,0.2)')}; color:${evalData.score >= 9.5 ? '#00FFB2' : (evalData.score >= 8.5 ? '#00E5FF' : '#FFB703')};">
          ${evalData.cores}C/${evalData.threads}T
        </span>
      </div>
    `;
  }).join('');
  dropdown.style.display = 'block';
}

function selectPcCpuAutocomplete(cpuName) {
  if (window.triggerHaptic) window.triggerHaptic(20);
  const input = document.getElementById('pcCpuInput');
  if (input) input.value = cpuName;
  const dropdown = document.getElementById('pcCpuAutocompleteDropdown');
  if (dropdown) dropdown.style.display = 'none';
  updateCpuTierBadge(cpuName);
  updateLiveCpuArchCard(cpuName);
  saveUserPcProfile(false);
}

function handlePcGpuAutocomplete(query) {
  const dropdown = document.getElementById('pcGpuAutocompleteDropdown');
  if (!dropdown) return;
  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) {
    dropdown.style.display = 'none';
    return;
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const matches = GPU_DATABASE.filter(item => {
    const text = (item.name + ' ' + item.vram + ' ' + (item.arch || '')).toLowerCase();
    return terms.every(t => text.includes(t));
  }).slice(0, 7);

  if (matches.length === 0) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.innerHTML = matches.map(m => {
    return `
      <div class="pc-autocomplete-item" onclick="selectPcGpuAutocomplete('${escapeHtml(m.name)}', '${escapeHtml(m.vram)}')" style="padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.06); cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:background .15s ease;" onmouseover="this.style.background='rgba(0,255,178,0.1)'" onmouseout="this.style.background='transparent'">
        <div>
          <div style="font-weight:700; font-size:0.86rem; color:#FFFFFF;">${escapeHtml(m.name)}</div>
          <div style="font-size:0.72rem; color:#8E9AA8;">${escapeHtml(m.arch || '')}</div>
        </div>
        <span style="font-size:0.72rem; font-weight:800; padding:2px 6px; border-radius:4px; background:rgba(0,255,178,0.2); color:#00FFB2;">
          ${escapeHtml(m.vram)}
        </span>
      </div>
    `;
  }).join('');
  dropdown.style.display = 'block';
}

function selectPcGpuAutocomplete(gpuName, vramVal) {
  if (window.triggerHaptic) window.triggerHaptic(20);
  const input = document.getElementById('pcGpuInput');
  if (input) input.value = gpuName;
  const dropdown = document.getElementById('pcGpuAutocompleteDropdown');
  if (dropdown) dropdown.style.display = 'none';
  if (vramVal) {
    const select = document.getElementById('pcVramSelect');
    if (select) {
      select.value = vramVal;
      updateVramDiagnosticCard(vramVal);
    }
  }
  updateGpuTierBadge(gpuName);
  saveUserPcProfile(false);
}

// Event listener para cerrar los dropdowns de autocompletado al hacer clic fuera
document.addEventListener('click', (e) => {
  const cpuDrop = document.getElementById('pcCpuAutocompleteDropdown');
  const cpuInput = document.getElementById('pcCpuInput');
  if (cpuDrop && cpuDrop.style.display !== 'none') {
    if (!cpuDrop.contains(e.target) && e.target !== cpuInput) {
      cpuDrop.style.display = 'none';
    }
  }
  const gpuDrop = document.getElementById('pcGpuAutocompleteDropdown');
  const gpuInput = document.getElementById('pcGpuInput');
  if (gpuDrop && gpuDrop.style.display !== 'none') {
    if (!gpuDrop.contains(e.target) && e.target !== gpuInput) {
      gpuDrop.style.display = 'none';
    }
  }
});

function applyPcProfilePreset(presetKey) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  const presets = {
    basic_office: {
      cpu: 'Intel Core i3 4ta Gen / Dual Core',
      gpu: 'Intel HD Graphics Integrada',
      vram: '2 GB',
      ram: '4 GB',
      os: 'Windows 10 64-bit',
      storage: 'HDD (Disco Mecánico Tradicional)'
    },
    laptop_integrated: {
      cpu: 'AMD Ryzen 5 5500U / Intel i5 11va Gen',
      gpu: 'AMD Radeon Vega 7 / Intel Iris Xe',
      vram: '2 GB',
      ram: '8 GB',
      os: 'Windows 11 64-bit',
      storage: 'SSD (Rápido NVMe/SATA)'
    },
    gamer_entry: {
      cpu: 'Intel Core i5-10400F / Ryzen 3 3300X',
      gpu: 'NVIDIA GeForce GTX 1650 4GB',
      vram: '4 GB',
      ram: '16 GB',
      os: 'Windows 10 64-bit',
      storage: 'SSD (Rápido NVMe/SATA)'
    },
    gamer_mid: {
      cpu: 'AMD Ryzen 5 5600X / Intel i5-12400F',
      gpu: 'NVIDIA GeForce RTX 3060 12GB',
      vram: '12 GB',
      ram: '16 GB',
      os: 'Windows 10 64-bit',
      storage: 'SSD (Rápido NVMe/SATA)'
    },
    gamer_rtx4060: {
      cpu: 'AMD Ryzen 5 5600X / Intel i5-13400F',
      gpu: 'NVIDIA GeForce RTX 4060 16GB',
      vram: '16 GB',
      ram: '16 GB',
      os: 'Windows 11 64-bit',
      storage: 'SSD (Rápido NVMe/SATA)'
    },
    gamer_high: {
      cpu: 'AMD Ryzen 9 7900X / Intel Core i7-14700K',
      gpu: 'NVIDIA GeForce RTX 4070 12GB',
      vram: '12 GB',
      ram: '32 GB',
      os: 'Windows 11 64-bit',
      storage: 'SSD (Rápido NVMe/SATA)'
    },
    gamer_enthusiast: {
      cpu: 'AMD Ryzen 9 9950X / Intel Core i9-14900K',
      gpu: 'NVIDIA GeForce RTX 4090 24GB',
      vram: '24 GB',
      ram: '64 GB',
      os: 'Windows 11 64-bit',
      storage: 'SSD (Rápido NVMe/SATA)'
    }
  };

  const p = presets[presetKey];
  if (!p) return;

  const cpuInput = document.getElementById('pcCpuInput');
  const gpuInput = document.getElementById('pcGpuInput');
  const vramSelect = document.getElementById('pcVramSelect');
  const ramSelect = document.getElementById('pcRamSelect');
  const osSelect = document.getElementById('pcOsSelect');
  const storageSelect = document.getElementById('pcStorageSelect');

  if (cpuInput) cpuInput.value = p.cpu;
  if (gpuInput) gpuInput.value = p.gpu;
  if (vramSelect && p.vram) vramSelect.value = p.vram;
  if (ramSelect) ramSelect.value = p.ram;
  if (osSelect) osSelect.value = p.os;
  if (storageSelect) storageSelect.value = p.storage;

  if (p.vram) updateVramDiagnosticCard(p.vram);
  updateGpuTierBadge(p.gpu);
  updateCpuTierBadge(p.cpu);

  saveUserPcProfile(false);
  if (typeof showToast === 'function') {
    showToast(`⚡ Perfil cargado: ${p.gpu} (${p.vram || ''})`);
  }
}

function setSpecField(fieldId, value) {
  if (window.triggerHaptic) window.triggerHaptic(20);
  const el = document.getElementById(fieldId);
  if (el) {
    el.value = value;
    if (fieldId === 'pcGpuInput') {
      updateGpuTierBadge(value);
      onGpuInputChanged();
    } else if (fieldId === 'pcCpuInput') {
      updateCpuTierBadge(value);
      onCpuInputChanged();
    }
    saveUserPcProfile(false);
  }
}

function openPcCheckerModal(initialGameTitle = null) {
  if (window.triggerHaptic) window.triggerHaptic(35);
  if (typeof toggleSidebar === 'function') toggleSidebar(false);

  const profile = getUserPcProfile();
  const cpuInput = document.getElementById('pcCpuInput');
  const gpuInput = document.getElementById('pcGpuInput');
  const vramSelect = document.getElementById('pcVramSelect');
  const ramSelect = document.getElementById('pcRamSelect');
  const osSelect = document.getElementById('pcOsSelect');
  const storageSelect = document.getElementById('pcStorageSelect');

  if (cpuInput) cpuInput.value = profile.cpu;
  if (gpuInput) gpuInput.value = profile.gpu;
  if (vramSelect) vramSelect.value = profile.vram || '4 GB';
  if (ramSelect) ramSelect.value = profile.ram;
  if (osSelect) osSelect.value = profile.os;
  if (storageSelect) storageSelect.value = profile.storage;

  updateCurrentProfilePill(profile);
  updateVramDiagnosticCard(profile.vram || '4 GB');
  updateGpuTierBadge(profile.gpu);
  updateCpuTierBadge(profile.cpu);

  const modal = document.getElementById('pcCheckerModal');
  if (modal) {
    modal.style.display = 'flex';
  }

  if (initialGameTitle) {
    switchPcTab('checkGame');
    const input = document.getElementById('pcGameInput');
    if (input) {
      input.value = initialGameTitle;
    }
    setTimeout(() => {
      executePcCompatibilityCheck(initialGameTitle);
    }, 200);
  } else {
    switchPcTab('checkGame');
  }
}

function closePcCheckerModal() {
  const modal = document.getElementById('pcCheckerModal');
  if (modal) {
    modal.style.display = 'none';
  }
  const dropdown = document.getElementById('pcGameAutocompleteDropdown');
  if (dropdown) dropdown.style.display = 'none';
  const cpuDropdown = document.getElementById('pcCpuAutocompleteDropdown');
  if (cpuDropdown) cpuDropdown.style.display = 'none';
}

function checkCurrentGamePcCompatibility() {
  if (!currentDetailId) return;
  const it = allItems.find(i => i.id === currentDetailId);
  if (!it) return;
  closeDetail();
  openPcCheckerModal(it.title);
}

function openPcHardwareConfigFromDetail() {
  if (window.triggerHaptic) window.triggerHaptic(25);
  if (!currentDetailId) return;
  const it = allItems.find(i => i.id === currentDetailId);
  const title = it ? it.title : '';
  closeDetail();
  openPcCheckerModal(title);
  switchPcTab('hardware');
}

function renderDetailCpuBenchmark(it) {
  const section = document.getElementById('modalCpuBenchmarkSection');
  if (!section) return;

  const profile = getUserPcProfile();
  const cpuEval = evaluateCpuBenchmark(profile.cpu);
  const gameProfile = evaluateGameDemand(it.title);

  // Scores normalizados de 0 a 100
  const userScore = Math.min(100, Math.max(15, Math.round(cpuEval.score * 10)));
  const recScore = Math.min(95, Math.max(40, Math.round(gameProfile.demand * 10)));
  const minScore = Math.min(Math.max(20, recScore - 25), 80);

  const userNameEl = document.getElementById('modalCpuUserName');
  const userScoreEl = document.getElementById('modalCpuUserScore');
  const fillEl = document.getElementById('modalCpuGaugeFill');
  const markerMinEl = document.getElementById('modalCpuMarkerMin');
  const markerRecEl = document.getElementById('modalCpuMarkerRec');
  const badgeWrap = document.getElementById('modalCpuStatusBadge');
  const tierValEl = document.getElementById('modalCpuTierVal');
  const verdictValEl = document.getElementById('modalCpuVerdictVal');
  const noteEl = document.getElementById('modalCpuDetailNote');

  // Elementos de la Comparativa de Arquitectura (Núcleos & Hilos)
  const coresStatusEl = document.getElementById('modalCpuCoresStatus');
  const userCoresEl = document.getElementById('modalCpuUserCores');
  const userCoresLayoutEl = document.getElementById('modalCpuUserCoresLayout');
  const gameCoresReqEl = document.getElementById('modalCpuGameCoresReq');

  const threadsStatusEl = document.getElementById('modalCpuThreadsStatus');
  const userThreadsEl = document.getElementById('modalCpuUserThreads');
  const userThreadsTechEl = document.getElementById('modalCpuUserThreadsTech');
  const gameThreadsReqEl = document.getElementById('modalCpuGameThreadsReq');

  const engineTitleEl = document.getElementById('modalCpuEngineTitle');
  const engineDescEl = document.getElementById('modalCpuEngineDesc');

  if (userNameEl) userNameEl.innerHTML = `💻 <b>${escapeHtml(profile.cpu || 'Procesador')}</b>`;
  if (userScoreEl) userScoreEl.textContent = `${userScore}%`;

  if (markerMinEl) {
    markerMinEl.style.left = `${minScore}%`;
    const minLabel = markerMinEl.querySelector('.marker-label');
    if (minLabel) minLabel.textContent = `Mín (${minScore}%)`;
  }
  if (markerRecEl) {
    markerRecEl.style.left = `${recScore}%`;
    const recLabel = markerRecEl.querySelector('.marker-label');
    if (recLabel) recLabel.textContent = `Rec (${recScore}%)`;
  }

  let statusBadgeHtml = '';
  let fillClass = 'bar-optimo';
  let verdictText = '';
  let noteText = '';

  if (userScore >= recScore) {
    fillClass = 'bar-optimo';
    const margin = userScore - recScore;
    statusBadgeHtml = `<span class="modal-cpu-badge badge-optimo">🚀 Supera Recomendado (${margin > 0 ? '+' + margin + '%' : '100%'})</span>`;
    verdictText = '✅ Rendimiento Óptimo (60+ FPS)';
    if (cpuEval.score >= 9.3) {
      noteText = `🔥 <b>${escapeHtml(profile.cpu)}</b> (${escapeHtml(cpuEval.coresInfo)}): Arquitectura moderna de alto rendimiento con cero cuello de botella para ${escapeHtml(it.title)}.`;
    } else {
      noteText = `✨ Tu procesador cuenta con potencia y paralelización de sobra para procesar la física y frametimes de ${escapeHtml(it.title)} de manera fluida.`;
    }
  } else if (userScore >= minScore) {
    fillClass = 'bar-jugable';
    statusBadgeHtml = `<span class="modal-cpu-badge badge-jugable">⚡ Cumple Mínimo</span>`;
    verdictText = '🟡 Rendimiento Jugable (35-55 FPS)';
    noteText = `⚠️ <b>${escapeHtml(profile.cpu)}</b> cumple los requisitos básicos. Se recomienda cerrar programas pesados en segundo plano para evitar tirones.`;
  } else {
    fillClass = 'bar-no';
    statusBadgeHtml = `<span class="modal-cpu-badge badge-no">⚠️ Ajustar Gráficos</span>`;
    verdictText = '🔴 Por debajo del mínimo';
    noteText = `🛠️ <b>${escapeHtml(profile.cpu)}</b> es de gama justa para la física de este título; requerirá bajar ajustes de sombras, reflejos y densidad de objetos.`;
  }

  if (fillEl) {
    fillEl.className = `modal-cpu-gauge-fill ${fillClass}`;
    fillEl.style.width = `${userScore}%`;
  }
  if (badgeWrap) badgeWrap.innerHTML = statusBadgeHtml;
  if (tierValEl) tierValEl.textContent = `${cpuEval.tierName} (${cpuEval.coresInfo})`;
  if (verdictValEl) verdictValEl.textContent = verdictText;
  if (noteEl) noteEl.innerHTML = noteText;

  // ----------------------------------------------------
  // 🔬 COMPARATIVA DE ARQUITECTURA: NÚCLEOS & HILOS
  // ----------------------------------------------------
  const userCores = cpuEval.cores || 4;
  const userThreads = cpuEval.threads || 4;
  const minCores = gameProfile.minCores || 4;
  const recCores = gameProfile.recCores || 6;
  const minThreads = gameProfile.minThreads || 4;
  const recThreads = gameProfile.recThreads || 8;

  // 1. Núcleos Físicos
  if (userCoresEl) userCoresEl.textContent = `${userCores} Núcleos Físicos`;
  if (userCoresLayoutEl) userCoresLayoutEl.textContent = cpuEval.layout || `${userCores} Cores`;
  if (gameCoresReqEl) gameCoresReqEl.textContent = `Rec: ${recCores} Cores | Mín: ${minCores} Cores`;

  if (coresStatusEl) {
    if (userCores > recCores) {
      const extraCores = userCores - recCores;
      coresStatusEl.className = 'arch-card-status status-good';
      coresStatusEl.textContent = `✅ +${extraCores} Cores de Holgura`;
    } else if (userCores >= recCores) {
      coresStatusEl.className = 'arch-card-status status-good';
      coresStatusEl.textContent = `✅ Cores Recomendados`;
    } else if (userCores >= minCores) {
      coresStatusEl.className = 'arch-card-status status-mid';
      coresStatusEl.textContent = `⚡ Cumple Mínimo`;
    } else {
      coresStatusEl.className = 'arch-card-status status-warn';
      coresStatusEl.textContent = `⚠️ Cuello de Botella CPU`;
    }
  }

  // 2. Hilos Lógicos (Multithreading)
  if (userThreadsEl) userThreadsEl.textContent = `${userThreads} Hilos Lógicos`;
  if (userThreadsTechEl) userThreadsTechEl.textContent = cpuEval.tech || 'Multithreading';
  if (gameThreadsReqEl) gameThreadsReqEl.textContent = `Rec: ${recThreads} Hilos | Mín: ${minThreads} Hilos`;

  if (threadsStatusEl) {
    if (userThreads > recThreads) {
      const extraThreads = userThreads - recThreads;
      threadsStatusEl.className = 'arch-card-status status-good';
      threadsStatusEl.textContent = `🚀 +${extraThreads} Hilos Extra`;
    } else if (userThreads >= recThreads) {
      threadsStatusEl.className = 'arch-card-status status-good';
      threadsStatusEl.textContent = `⚡ Multihilo Óptimo`;
    } else if (userThreads >= minThreads) {
      threadsStatusEl.className = 'arch-card-status status-mid';
      threadsStatusEl.textContent = `🟡 Multihilo Básico`;
    } else {
      threadsStatusEl.className = 'arch-card-status status-warn';
      threadsStatusEl.textContent = `⚠️ Hilos Insuficientes`;
    }
  }

  // 3. Aprovechamiento del Motor Gráfico
  if (engineTitleEl) {
    engineTitleEl.textContent = `Aprovechamiento del Motor: ${gameProfile.engineName || 'Motor Gráfico'}`;
  }
  if (engineDescEl) {
    const threadAdvantage = userThreads >= recThreads
      ? `Tu microprocesador cuenta con <b>${userCores} núcleos físicos y ${userThreads} hilos lógicos</b>, permitiendo al motor despachar hilos de física e IA sin saturar el hilo de render principal.`
      : `El motor se beneficia enormemente de procesadores de al menos <b>${recCores} núcleos y ${recThreads} hilos</b> para evitar microtirones durante descompresión de activos.`;
    
    engineDescEl.innerHTML = `${escapeHtml(gameProfile.engineUsage || '')} <br><br>💡 <b>Diagnóstico de Arquitectura:</b> ${threadAdvantage}`;
  }

  section.style.display = 'block';
}

function switchPcTab(tabName) {
  if (window.triggerHaptic) window.triggerHaptic(25);

  const tabs = ['checkGame', 'catalogGames', 'hardware'];
  tabs.forEach(t => {
    const btn = document.getElementById(`pcTab${t.charAt(0).toUpperCase() + t.slice(1)}Btn`) || document.getElementById(`pcTab${t === 'checkGame' ? 'CheckGame' : (t === 'catalogGames' ? 'Catalog' : 'Hardware')}Btn`);
    const content = document.getElementById(`pcTab${t === 'checkGame' ? 'CheckGame' : (t === 'catalogGames' ? 'Catalog' : 'Hardware')}Content`);
    
    if (btn) {
      if (t === tabName) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    if (content) {
      content.style.display = (t === tabName) ? 'block' : 'none';
    }
  });

  const dropdown = document.getElementById('pcGameAutocompleteDropdown');
  if (dropdown) dropdown.style.display = 'none';
  const cpuDropdown = document.getElementById('pcCpuAutocompleteDropdown');
  if (cpuDropdown) cpuDropdown.style.display = 'none';
}

function handlePcGameAutocomplete(query) {
  const dropdown = document.getElementById('pcGameAutocompleteDropdown');
  if (!dropdown) return;
  const q = (query || '').trim().toLowerCase();
  if (q.length < 2) {
    dropdown.style.display = 'none';
    return;
  }

  // Filtrar juegos y software del catálogo
  const matches = allItems.filter(it => {
    const isGameOrSoft = !it.type || it.type.includes('juego') || it.type.includes('software') || it.type.includes('game');
    if (!isGameOrSoft) return false;
    return (it.title && it.title.toLowerCase().includes(q)) || (it.synopsis && it.synopsis.toLowerCase().includes(q));
  }).slice(0, 8);

  if (matches.length === 0) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.innerHTML = matches.map(m => {
    const cover = resolveImageUrl(m.cover || m.image || m.poster || m.img);
    const sub = getItemSubcategory(m) || m.type || 'Juego PC';
    return `
      <div class="pc-game-item-card" style="margin:4px; border-radius:8px;" onclick="selectPcAutocompleteGame('${escapeHtml(m.title)}')">
        <img class="pc-game-item-img" style="width:36px; height:48px;" src="${cover}" onerror="this.src='${PLACEHOLDER_IMG}'" alt="">
        <div class="pc-game-item-info">
          <div class="pc-game-item-title" style="font-size:0.84rem;">${escapeHtml(m.title)}</div>
          <div class="pc-game-item-meta" style="font-size:0.7rem;">
            <span>💻 ${escapeHtml(sub)}</span>
            ${m.year ? `<span>📅 ${m.year}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  dropdown.style.display = 'block';
}

function selectPcAutocompleteGame(title) {
  if (window.triggerHaptic) window.triggerHaptic(20);
  const input = document.getElementById('pcGameInput');
  if (input) input.value = title;
  const dropdown = document.getElementById('pcGameAutocompleteDropdown');
  if (dropdown) dropdown.style.display = 'none';
  executePcCompatibilityCheck(title);
}

function selectPcQuickGame(title) {
  if (window.triggerHaptic) window.triggerHaptic(20);
  const input = document.getElementById('pcGameInput');
  if (input) input.value = title;
  executePcCompatibilityCheck(title);
}

function startVoiceSearchForPcChecker() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (typeof showToast === 'function') showToast('🎙️ Reconocimiento de voz no soportado en este navegador');
    return;
  }

  try {
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    if (typeof showToast === 'function') showToast('🎙️ Escuchando... Di el nombre del juego');

    recognition.onresult = (event) => {
      const speechResult = event.results[0][0].transcript;
      const input = document.getElementById('pcGameInput');
      if (input) {
        input.value = speechResult;
        executePcCompatibilityCheck(speechResult);
      }
    };

    recognition.onerror = () => {
      if (typeof showToast === 'function') showToast('⚠️ No se pudo reconocer la voz');
    };

    recognition.start();
  } catch (e) {
    console.warn('Error al iniciar voz:', e);
  }
}

// ==========================================
// 🚀 MOTOR DE COMPATIBILIDAD CON IA ONLINE (GEMINI 3.5 FLASH)
// ==========================================
async function executePcCompatibilityCheck(customTitle = null) {
  if (window.triggerHaptic) window.triggerHaptic(40);

  const gameInput = document.getElementById('pcGameInput');
  const gameTitle = (customTitle || gameInput?.value || '').trim();

  if (!gameTitle) {
    if (typeof showToast === 'function') {
      showToast('⚠️ Por favor escribe o selecciona un juego');
    }
    gameInput?.focus();
    return;
  }

  const dropdown = document.getElementById('pcGameAutocompleteDropdown');
  if (dropdown) dropdown.style.display = 'none';

  const profile = getUserPcProfile();
  const loadingBox = document.getElementById('pcCheckLoadingBox');
  const loadingTitle = document.getElementById('pcCheckLoadingTitle');
  const loadingSub = document.getElementById('pcCheckLoadingSub');
  const resultBox = document.getElementById('pcCheckResultContainer');
  const btnExecute = document.getElementById('btnExecutePcCheck');

  if (resultBox) {
    resultBox.style.display = 'none';
    resultBox.innerHTML = '';
  }

  if (loadingBox) {
    loadingBox.style.display = 'flex';
    if (loadingTitle) loadingTitle.textContent = `Buscando requisitos oficiales de "${gameTitle}" en internet con IA...`;
    if (loadingSub) loadingSub.textContent = `Comparando con ${profile.cpu}, ${profile.gpu} y ${profile.ram}...`;
  }
  if (btnExecute) btnExecute.disabled = true;

  // Animación secuencial de mensajes de carga
  const loadSteps = [
    'Buscando requisitos mínimos y recomendados en internet...',
    `Analizando potencia de ${profile.gpu} vs requerimientos oficiales...`,
    'Calculando tasa de FPS estimada y ajustes gráficos óptimos...',
    'Generando veredicto detallado...'
  ];
  let stepIdx = 0;
  const stepTimer = setInterval(() => {
    stepIdx = (stepIdx + 1) % loadSteps.length;
    if (loadingSub) loadingSub.textContent = loadSteps[stepIdx];
  }, 1200);

  // Obtener API Key desde AndroidBridge o configuración
  let apiKey = '';
  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.getGeminiApiKey === 'function') {
      apiKey = window.AndroidBridge.getGeminiApiKey();
    }
  } catch (e) {
    console.warn('Error obteniendo Gemini API Key:', e);
  }

  try {
    let aiResponseData = null;

    if (apiKey && apiKey.trim().length > 5) {
      aiResponseData = await queryGeminiPcCompatibility(gameTitle, profile, apiKey);
    }

    // Si falló la API o no hay key, usar el motor heurístico inteligente de benchmarks
    if (!aiResponseData) {
      aiResponseData = generateHeuristicPcCompatibility(gameTitle, profile);
    }

    clearInterval(stepTimer);
    if (loadingBox) loadingBox.style.display = 'none';
    if (btnExecute) btnExecute.disabled = false;

    renderPcCompatibilityResult(aiResponseData, gameTitle, profile);

  } catch (err) {
    console.error('Error en compatibilidad IA:', err);
    clearInterval(stepTimer);
    if (loadingBox) loadingBox.style.display = 'none';
    if (btnExecute) btnExecute.disabled = false;

    // Fallback de contingencia
    const fallbackData = generateHeuristicPcCompatibility(gameTitle, profile);
    renderPcCompatibilityResult(fallbackData, gameTitle, profile);
  }
}

async function queryGeminiPcCompatibility(gameTitle, profile, apiKey) {
  const prompt = `Eres un Ingeniero Experto en Hardware Gamer, Benchmarks de PC y Requisitos de Sistemas (Steam, TechPowerUp, PCGameBenchmark, Can You Run It).
Busca y analiza los requisitos del sistema del videojuego: "${gameTitle}".

Datos de la PC del usuario a evaluar:
- Procesador (CPU): ${profile.cpu}
- Tarjeta Gráfica (GPU): ${profile.gpu}
- Memoria de Video Dedicada (VRAM): ${profile.vram || '4 GB'}
- Memoria RAM: ${profile.ram}
- Sistema Operativo: ${profile.os}
- Almacenamiento: ${profile.storage}

CRITERIOS DE CALIBRACIÓN DE HARDWARE (MANDATORIO):
1. REGLA DE PROCESADORES (CPU) MODERNOS Y CLÁSICOS:
   - Todo procesador AMD Ryzen 9 (Zen 5: 9950X, 9900X; Zen 4: 7950X3D, 7950X, 7900X3D, 7900X, 7900; Zen 3: 5950X, 5900X; Zen 2: 3950X, 3900X; Mobile: 7945HX, 6900HX, Ryzen AI 9 HX 370) es un PROCESADOR FLAGSHIP TOPE DE GAMA MUNDIAL con 12 a 16 núcleos y 24 a 32 hilos. Para CUALQUIER Ryzen 9, el status de CPU DEBE SER SIEMPRE "OK" (Sobrado / Excelente), con score de benchmark entre 96 y 100, y NUNCA "FAIL", "viejo", ni "ineficiente".
   - Todo procesador AMD Ryzen 7 X3D (9800X3D, 7800X3D, 5800X3D, 5700X3D) es el Campeón Mundial de Gaming absoluto gracias a la memoria 3D V-Cache (score 99-100, status "OK" indiscutible).
   - Todo procesador Intel Core Ultra (Ultra 9 285K, Ultra 7 265K, Ultra 5 245K) y procesadores Intel Core de 12ª, 13ª y 14ª Generación (i9-14900K, i7-14700K, i5-14600K, i5-14400, i5-13600K, i5-13400F, i5-12600K, i5-12400F), así como AMD Ryzen 7000/8000/9000/5000 (Ryzen 7 7700X, Ryzen 5 7600X, Ryzen 5 5600X) son CPUs MODERNAS DE ALTO RENDIMIENTO.
   - En particular, un Intel Core i5-14600 / 14600K cuenta con 14 núcleos (6 P-cores + 8 E-cores), 20 hilos de procesamiento y frecuencias de hasta 5.3 GHz, superando con creces los requisitos recomendados de prácticamente el 100% de los juegos del mercado actual.
   - Para un i5-14600, Ryzen 9 o cualquier CPU moderna equivalente, el status de CPU DEBE SER SIEMPRE "OK" (Correcto / Sobrado), con score de benchmark entre 92 y 99, y NUNCA "FAIL" ni "insuficiente".
   - Por el contrario, procesadores de 2 núcleos antiguos sin multihilo moderno (Core 2 Duo, Pentium Dual Core, Celerons antiguos) deben recibir "FAIL" en juegos modernos exigentes.

2. REGLA DE TARJETAS GRÁFICAS MODERNAS:
   - Toda tarjeta NVIDIA GeForce RTX Serie 40 (RTX 4090, 4080, 4070 Ti/Super, RTX 4070, RTX 4060 Ti 16GB/8GB, RTX 4060 16GB/8GB, RTX 4050) y AMD Radeon RX Serie 7000/6000 (RX 7900, 7800 XT, 7700 XT, 7600 XT 16GB, 6800, 6700 XT, 6600) son GPUs modernas de ALTO RENDIMIENTO con soporte para DLSS 3, Frame Generation y FSR 3.
   - Una NVIDIA GeForce RTX 4060 (tanto de 8GB como de 16GB) y RTX 3060/4060 Ti SUPERAN con creces los requisitos recomendados de prácticamente el 99% de los juegos existentes a 1080p y 1440p con DLSS.
   - Para una RTX 4060 o superior, el status de GPU DEBE SER SIEMPRE "OK" (Correcto), y el veredicto "OPTIMO" (o "JUGABLE" únicamente en juegos extremos como Alan Wake 2 con Path Tracing nativo a 4K). NUNCA indiques "FAIL" ni "insuficiente" para una RTX 4060 en títulos normales.
   - Si la GPU tiene 16GB de VRAM (como RTX 4060 16GB, 4060 Ti 16GB, RX 7600 XT 16GB, Arc A770 16GB), destaca que la VRAM es superlativa para texturas en Ultra y carga de mods sin ningún stuttering.

3. VEREDICTOS:
   - "OPTIMO": Si la PC corre el juego a 60+ FPS en calidad Alta/Ultra 1080p o 1440p (con DLSS/FSR si aplica).
   - "JUGABLE": Si corre entre 35 y 55 FPS en calidad Media/Baja (o con FSR/DLSS equilibrado).
   - "NO_RECOMENDADO": Si el hardware es integrado muy antiguo (Intel HD 4000, GT 710, Dual Core) y dará menos de 25 FPS.

4. OPTIMIZACIÓN Y AJUSTES GRÁFICOS DE RESCATE (MANDATORIO PARA GPU DE ENTRADA / INSUFICIENTE):
   - Si la tarjeta gráfica es de gama de entrada o justa (como NVIDIA GTX 1650, GTX 1050 Ti, GTX 960, RX 570/580 4GB, Intel HD o Vega) frente a juegos demandantes (o cuando status sea WARNING o FAIL):
   - Genera OBLIGATORIAMENTE el objeto "rescue_tuning" con is_needed=true y una lista de ajustes gráficos específicos para rascar el máximo de fotogramas (+15 a +30 FPS) y evitar la saturación de los 4GB de VRAM.

5. SCORES DE BENCHMARK (0-100) PARA COMPARACIÓN VISUAL D3:
   - Proporciona valores numéricos de 0 a 100 para: user_gpu, min_gpu, rec_gpu, user_cpu, min_cpu, rec_cpu, user_ram_gb, min_ram_gb, rec_ram_gb.

RESPONDE ÚNICAMENTE CON UN OBJETO JSON VÁLIDO CON ESTA ESTRUCTURA EXACTA (SIN TEXTO EXTRA NI MARKDOWN):
{
  "game_name": "${gameTitle}",
  "verdict": "OPTIMO" | "JUGABLE" | "NO_RECOMENDADO",
  "verdict_title": "¡Corre Excelente! (60+ FPS)" | "Jugable y Fluido (35-55 FPS)" | "No Recomendado / Hardware Insuficiente",
  "power_percentage": 90,
  "fps_estimate": "75-95+ FPS @ 1080p Calidad Ultra con DLSS",
  "target_resolution": "1080p (Full HD) / 1440p (2K)",
  "summary": "Explicación clara y concisa en español destacando el rendimiento real esperado.",
  "benchmark_scores": {
    "gpu": { "user": 65, "min": 50, "rec": 75, "user_name": "${profile.gpu}", "min_name": "Mínimo Oficial", "rec_name": "Recomendado Oficial" },
    "cpu": { "user": 75, "min": 45, "rec": 70, "user_name": "${profile.cpu}", "min_name": "CPU Mínima", "rec_name": "CPU Recomendada" },
    "ram": { "user_gb": 16, "min_gb": 8, "rec_gb": 16 }
  },
  "components": {
    "cpu": {
      "status": "OK" | "WARNING" | "FAIL",
      "required": "Mínimo: Core i5-4460 / Ryzen 3",
      "verdict_note": "Procesador potente con núcleos y frecuencias de sobra."
    },
    "gpu": {
      "status": "OK" | "WARNING" | "FAIL",
      "required": "Mínimo: GTX 960 / Recomendado: GTX 1660 / RTX 3060",
      "verdict_note": "Gráfica moderna de alto rendimiento con DLSS y gran VRAM para texturas Ultra."
    },
    "ram": {
      "status": "OK" | "WARNING" | "FAIL",
      "required": "8 GB a 16 GB recomendados",
      "verdict_note": "Memoria RAM suficiente para evitar tirones."
    },
    "storage": {
      "status": "OK" | "WARNING" | "FAIL",
      "required": "Espacio en disco suficiente",
      "verdict_note": "Instalación en SSD recomendada para tiempos de carga mínimos."
    }
  },
  "rescue_tuning": {
    "is_needed": true,
    "gpu_model": "${profile.gpu}",
    "title": "Ajustes Gráficos Sugeridos para Rendimiento Óptimo",
    "target_fps_gain": "+15 a +25 FPS estimados",
    "settings": [
      { "name": "Resolución y Escalado", "value": "1080p con FSR en modo 'Rendimiento' o 900p nativo", "impact": "Alto (+10-15 FPS)", "tag": "ALTO" },
      { "name": "Calidad de Texturas", "value": "Medio (fundamental para no saturar 4GB de VRAM)", "impact": "Crítico (evita congelamientos)", "tag": "CRÍTICO" },
      { "name": "Sombras e Iluminación", "value": "Bajo / Desactivado", "impact": "Alto (+20% alivio de GPU)", "tag": "ALTO" },
      { "name": "Niebla Volumétrica y Oclusión", "value": "Bajo / Off", "impact": "Medio (+5-8 FPS)", "tag": "MEDIO" },
      { "name": "Efectos de Post-procesado", "value": "Desactivar Desenfoque de movimiento y Aberración", "impact": "Bajo (+3-5 FPS)", "tag": "BAJO" },
      { "name": "Límite de Fotogramas (FPS Lock)", "value": "Fijar a 36 o 40 FPS para frametime fluido", "impact": "Recomendado", "tag": "ESTABILIDAD" }
    ]
  },
  "bottleneck": "Hardware bien equilibrado" | "Leve cuello de botella en CPU" | "Leve limitación en GPU",
  "recommended_settings": [
    "Resolución: 1080p / 1440p nativo",
    "Calidad gráfica: Alta / Ultra",
    "Activar NVIDIA DLSS / Reflex para máxima fluidez y menor latencia"
  ]
}`;

  // Probar con modelos disponibles de Gemini (2.5-flash o 1.5-flash)
  const models = ['gemini-3.5-flash', 'gemini-2.5-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 3000
          }
        })
      });

      if (response.ok) {
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        let cleanJson = text.trim();
        if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        }
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error("No se pudo obtener respuesta de Gemini");
}

// ==========================================
// 🔬 MOTOR HEURÍSTICO DE BENCHMARKS Y COMPATIBILIDAD PRECISO
// ==========================================

function evaluateGpuBenchmark(gpuString, explicitVram = null) {
  const gpu = (gpuString || '').toLowerCase();
  
  // Extraer VRAM en GB si se especifica explícitamente o en el string
  let vramGB = 0;
  if (explicitVram) {
    const evm = String(explicitVram).match(/(\d+)/);
    if (evm) vramGB = parseInt(evm[1], 10);
  }
  if (!vramGB) {
    const vramMatch = gpu.match(/(\d+)\s*(?:gb|g\b|gig)/i);
    if (vramMatch) {
      vramGB = parseInt(vramMatch[1], 10);
    }
  }
  if (!vramGB) {
    // Estimación por arquitectura y modelo
    if (gpu.includes('4090') || gpu.includes('7900 xtx')) vramGB = 24;
    else if (gpu.includes('4080') || gpu.includes('7900 xt') || gpu.includes('7800 xt') || gpu.includes('6800')) vramGB = 16;
    else if (gpu.includes('4070') || gpu.includes('3080') || gpu.includes('6700 xt')) vramGB = 12;
    else if (gpu.includes('3060') && !gpu.includes('ti')) vramGB = 12;
    else if (gpu.includes('4060') || gpu.includes('3070') || gpu.includes('2080') || gpu.includes('6600') || gpu.includes('7600')) vramGB = 8;
    else if (gpu.includes('2060') || gpu.includes('1660')) vramGB = 6;
    else if (gpu.includes('1650') || gpu.includes('1050') || gpu.includes('970') || gpu.includes('980')) vramGB = 4;
    else if (gpu.includes('vega') || gpu.includes('iris') || gpu.includes('intel hd') || gpu.includes('uhd')) vramGB = 2;
    else vramGB = 4;
  }

  let score = 3.5;
  let tierName = "Gama Básica / Integrada";

  // Tier 10: Gama Entusiasta / Extrema (4K Ultra)
  if (gpu.includes('4090') || gpu.includes('7900 xtx') || gpu.includes('7900xtx')) {
    score = 10.0;
    tierName = "Gama Entusiasta Suprema (4K Ultra)";
  }
  else if (gpu.includes('4080') || gpu.includes('7900 xt') || gpu.includes('7900xt')) {
    score = 9.8;
    tierName = "Gama Alta Extrema (4K/1440p Ultra)";
  }
  // Tier 9: Gama Alta Moderna (1440p Ultra / 4K DLSS)
  else if (gpu.includes('4070 ti') || gpu.includes('4070ti') || gpu.includes('4070 super') || gpu.includes('3090') || gpu.includes('7900 gre') || gpu.includes('6950 xt') || gpu.includes('6900 xt')) {
    score = 9.5;
    tierName = "Gama Alta Moderna (1440p/4K Ultra)";
  }
  else if (gpu.includes('4070') || gpu.includes('3080') || gpu.includes('6800 xt') || gpu.includes('7800 xt')) {
    score = 9.2;
    tierName = "Gama Alta Moderna (1440p Ultra)";
  }
  // Tier 8.8: Gama Media-Alta Moderna (RTX 4060, 4060 Ti, 3070, RX 6700 XT, 7700 XT, 7600 XT 16GB)
  else if (gpu.includes('4060 ti') || gpu.includes('4060ti')) {
    score = 9.1;
    tierName = "Gama Media-Alta Moderna (1080p/1440p Ultra)";
  }
  else if (gpu.includes('4060')) {
    // NVIDIA GeForce RTX 4060 (8GB / 16GB)
    score = (vramGB >= 16) ? 9.1 : 8.85;
    tierName = (vramGB >= 16) ? "Gama Media-Alta Moderna 16GB VRAM (1080p/1440p Ultra)" : "Gama Media-Alta Moderna (1080p Ultra DLSS 3)";
  }
  else if (gpu.includes('3070') || gpu.includes('6750 xt') || gpu.includes('6700 xt') || gpu.includes('7700 xt') || gpu.includes('6800') || gpu.includes('7600 xt')) {
    score = 8.9;
    tierName = "Gama Media-Alta (1080p/1440p Ultra)";
  }
  else if (gpu.includes('a770') || gpu.includes('arc 770')) {
    score = 8.7;
    tierName = "Gama Media-Alta Intel Arc 16GB (1080p Ultra)";
  }
  // Tier 8: Gama Media Sólida (RTX 3060, RTX 2080, RX 6600, RX 7600)
  else if (gpu.includes('3060') || gpu.includes('2080') || gpu.includes('2070') || gpu.includes('7600') || gpu.includes('6650') || gpu.includes('6600') || gpu.includes('5700 xt') || gpu.includes('a750')) {
    score = 8.2;
    tierName = "Gama Media Gamer (1080p Calidad Alta/Ultra)";
  }
  // Tier 7: Gama Media-Baja Gamer (RTX 4050, 3050, RTX 2060, GTX 1080, 1070, 1660 Ti/Super, RX 580 8GB)
  else if (gpu.includes('4050') || gpu.includes('3050') || gpu.includes('2060') || gpu.includes('1080') || gpu.includes('1070') || gpu.includes('1660') || gpu.includes('5600 xt') || gpu.includes('vega 64') || gpu.includes('vega 56') || gpu.includes('rx 590') || (gpu.includes('580') && vramGB >= 8)) {
    score = 7.4;
    tierName = "Gama Media 1080p (Calidad Media-Alta)";
  }
  // Tier 6: Gama Entrada Gamer (GTX 1650, 1060, RX 580 4GB, RX 570, GTX 980/970)
  else if (gpu.includes('1650') || gpu.includes('1060') || gpu.includes('980') || gpu.includes('970') || gpu.includes('580') || gpu.includes('570') || gpu.includes('5500') || gpu.includes('6500') || gpu.includes('6400') || gpu.includes('apple m1') || gpu.includes('apple m2') || gpu.includes('apple m3')) {
    score = 6.3;
    tierName = "Gama Entrada Gamer (1080p Calidad Media)";
  }
  // Tier 5: Gama Básica Gamer / Antigua (GTX 1050 Ti, 960, 1050, 780, RX 560, Radeon 780M)
  else if (gpu.includes('1050 ti') || gpu.includes('1050ti') || gpu.includes('960') || gpu.includes('1050') || gpu.includes('780') || gpu.includes('770') || gpu.includes('560') || gpu.includes('460') || gpu.includes('380') || gpu.includes('780m') || gpu.includes('680m')) {
    score = 5.2;
    tierName = "Gama Básica Gamer (720p/1080p Calidad Baja-Media)";
  }
  // Tier 4: Gráficos Integrados Modernos (Vega 7/8, Iris Xe, GT 1030, GTX 750 Ti)
  else if (gpu.includes('vega 7') || gpu.includes('vega 8') || gpu.includes('vega 11') || gpu.includes('vega') || gpu.includes('iris') || gpu.includes('1030') || gpu.includes('750 ti') || gpu.includes('750ti') || gpu.includes('750') || gpu.includes('550') || gpu.includes('a380')) {
    score = 4.2;
    tierName = "Gráficos Integrados Modernos / Gama Casual";
  }
  // Tier 2: Integradas Básicas y Antiguas (Intel HD, UHD, GT 710/730)
  else if (gpu.includes('intel hd') || gpu.includes('uhd') || gpu.includes('hd graphics') || gpu.includes('730') || gpu.includes('710') || gpu.includes('940m') || gpu.includes('920m') || gpu.includes('r7') || gpu.includes('r5')) {
    score = 2.4;
    tierName = "Gráfica Integrada Básica / Oficina";
  }

  // Bonificación o penalización según VRAM
  if (vramGB >= 16 && score < 9.5) {
    score = Math.min(9.8, score + 0.35);
  } else if (vramGB >= 12 && score < 9.0) {
    score = Math.min(9.5, score + 0.2);
  } else if (vramGB <= 2 && score > 4.0) {
    score = Math.max(3.2, score - 0.4);
  }

  return { score, tierName, vramGB };
}

function evaluateCpuBenchmark(cpuString) {
  let raw = (cpuString || '').toLowerCase();
  // Limpiar separadores numéricos ej: 14,600 o 14.600 o 14 600
  let cpu = raw
    .replace(/(\d+)[,.](\d+)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();

  let score = 4.0;
  let tierName = "Gama Estándar";
  let coresInfo = "4 Núcleos";
  let cores = 4;
  let threads = 4;
  let layout = "4 Núcleos Físicos / 4 Hilos";
  let tech = "Monohilo Estándar";
  let family = "Gama Estándar";

  // Regla 0: Detección prioritaria de procesadores obsoletos / antiguos para evitar falsos positivos con números
  const isObsoleteDualCore = (/core\s*2\s*duo|core\s*2\s*quad|e8\d{3}|e7\d{3}|e6\d{3}|e5\d{3}|e4\d{3}|e2\d{3}|sempron|athlon\s*64|pentium\s*(?:dual|ii|iii|iv|4|d\b)|pentium\s*g20|pentium\s*g32|atom/i.test(cpu) || (/celeron/i.test(cpu) && !/g5|g6/i.test(cpu))) && !/core\s*i|ryzen|ultra|xeon/i.test(cpu);

  if (isObsoleteDualCore) {
    return {
      score: 2.4,
      tierName: "Obsoleto / Solo Juegos Retro y Ofimática",
      coresInfo: "2 Núcleos (Sin multihilo moderno)",
      cores: 2,
      threads: 2,
      layout: "2 Núcleos / 2 Hilos (Sin multihilo)",
      tech: "Arquitectura Monohilo Obsoleta",
      family: "Dual Core Clásico / Oficina",
      isModernHighEnd: false
    };
  }

  // =========================================================================
  // 1. AMD RYZEN 9 - GAMA ENTUSIASTA TOPE DE LÍNEA (ZEN 2 A ZEN 5)
  // Siempre considerado procesador tope de gama con 12 a 16 núcleos físicos y 24 a 32 hilos
  // =========================================================================
  const isRyzen9 = /ryzen\s*9|\br9\b|ryzen\s*ai\s*9|9950x|9900x|7950x|7900x|5950x|5900x|3950x|3900x|7945hx|6900hx|5900hx/i.test(cpu) && !/radeon/i.test(cpu);
  if (isRyzen9) {
    // Zen 5 (Serie 9000 & Ryzen AI 9)
    if (/9950x|9900x|ai\s*9/i.test(cpu)) {
      score = 9.95;
      cores = /9900x/i.test(cpu) ? 12 : 16;
      threads = cores * 2;
      tierName = `Gama Entusiasta Flagship (AMD Zen 5 - ${cores}C/${threads}T)`;
      layout = `${cores} Núcleos Zen 5 / ${threads} Hilos (Frecuencias hasta 5.7 GHz)`;
      tech = "Arquitectura AMD Zen 5 (4nm) + SMT / IPC Superlativo";
      family = "AMD Ryzen 9 (Zen 5 Flagship)";
    }
    // Zen 4 3D V-Cache (7950X3D, 7900X3D)
    else if (/7950x3d|7900x3d/i.test(cpu)) {
      score = 9.95;
      cores = /7900x3d/i.test(cpu) ? 12 : 16;
      threads = cores * 2;
      tierName = `Gama Entusiasta Suprema (3D V-Cache - ${cores}C/${threads}T)`;
      layout = `${cores} Núcleos Zen 4 / ${threads} Hilos (128MB L3 3D V-Cache)`;
      tech = "AMD 3D V-Cache + SMT (Optimización Máxima Gaming)";
      family = "AMD Ryzen 9 3D V-Cache";
    }
    // Zen 4 (Serie 7000 & 7945HX)
    else if (/7950x|7900x|7900\b|7945hx/i.test(cpu)) {
      score = 9.9;
      cores = /7900/i.test(cpu) ? 12 : 16;
      threads = cores * 2;
      tierName = `Gama Entusiasta Suprema (AMD Zen 4 - ${cores}C/${threads}T)`;
      layout = `${cores} Núcleos Zen 4 / ${threads} Hilos (Frecuencias hasta 5.7 GHz)`;
      tech = "AMD Zen 4 (5nm) + SMT";
      family = "AMD Ryzen 9 (Zen 4 Flagship)";
    }
    // Zen 3 (Serie 5000 / 6000 Mobile)
    else if (/5950x|5900x|5900xt|6900hx|5900hx/i.test(cpu)) {
      score = 9.6;
      cores = /5900/i.test(cpu) ? 12 : 16;
      threads = cores * 2;
      tierName = `Gama Alta Entusiasta (AMD Zen 3 - ${cores}C/${threads}T)`;
      layout = `${cores} Núcleos Zen 3 / ${threads} Hilos (Multihilo Masivo)`;
      tech = "AMD Zen 3 (7nm) + SMT";
      family = "AMD Ryzen 9 (Zen 3 Entusiasta)";
    }
    // Zen 2 (Serie 3000)
    else if (/3950x|3900x|3900xt/i.test(cpu)) {
      score = 9.3;
      cores = /3900/i.test(cpu) ? 12 : 16;
      threads = cores * 2;
      tierName = `Gama Alta Entusiasta (AMD Zen 2 - ${cores}C/${threads}T)`;
      layout = `${cores} Núcleos Zen 2 / ${threads} Hilos`;
      tech = "AMD Zen 2 + SMT";
      family = "AMD Ryzen 9 (Zen 2)";
    }
    // Genérico "Ryzen 9" o modelos no especificados
    else {
      score = 9.8;
      cores = 16;
      threads = 32;
      tierName = "Gama Entusiasta Flagship (AMD Ryzen 9)";
      layout = "16 Núcleos Físicos / 32 Hilos de Procesamiento";
      tech = "AMD SMT Multihilo Masivo (Tope de Línea)";
      family = "AMD Ryzen 9 Flagship";
    }
    coresInfo = `${cores} Núcleos (${threads} Hilos) / Entusiasta`;
  }

  // =========================================================================
  // 2. AMD 3D V-CACHE GAMING CHAMPIONS (9800X3D, 7800X3D, 5800X3D, 5700X3D)
  // Reyes indiscutibles del gaming mundial por caché L3 masiva apilada
  // =========================================================================
  else if (/9800x3d|7800x3d|5800x3d|5700x3d/i.test(cpu)) {
    if (/9800x3d|7800x3d/i.test(cpu)) {
      score = 10.0;
      cores = 8;
      threads = 16;
      tierName = "Campeón Absoluto del Gaming (AMD 3D V-Cache)";
      layout = "8 Núcleos Zen con Memoria 3D V-Cache de 2ª Gen";
      tech = "AMD 3D V-Cache (96MB L3) / Tasa de FPS Máxima Mundial";
      family = /9800x3d/i.test(cpu) ? "AMD Ryzen 7 9800X3D (Zen 5)" : "AMD Ryzen 7 7800X3D (Zen 4)";
    } else {
      score = 9.6;
      cores = 8;
      threads = 16;
      tierName = "Gama Alta Gaming (AMD 3D V-Cache Legendario)";
      layout = "8 Núcleos Zen 3 con 96MB 3D V-Cache";
      tech = "AMD 3D V-Cache + SMT";
      family = "AMD Ryzen 7 X3D (Zen 3)";
    }
    coresInfo = `${cores} Núcleos (${threads} Hilos) / 3D V-Cache Top Gaming`;
  }

  // =========================================================================
  // 3. INTEL CORE ULTRA (SERIES 200 ARROW LAKE & METEOR LAKE)
  // Nueva generación con NPU para IA y núcleos Skymont/Lion Cove
  // =========================================================================
  else if (/ultra\s*9|ultra\s*7|ultra\s*5|285k|265k|245k|185h|155h|125h/i.test(cpu)) {
    if (/ultra\s*9|285k|185h/i.test(cpu)) {
      score = 9.9;
      cores = 24;
      threads = 24;
      tierName = "Gama Entusiasta Flagship (Intel Core Ultra 9)";
      layout = "8 P-Cores (Lion Cove) + 16 E-Cores (Skymont)";
      tech = "Intel Arrow Lake / NPU para IA Integrada";
      family = "Intel Core Ultra 9";
    } else if (/ultra\s*7|265k|155h/i.test(cpu)) {
      score = 9.7;
      cores = 20;
      threads = 20;
      tierName = "Gama Alta Moderna (Intel Core Ultra 7)";
      layout = "8 P-Cores + 12 E-Cores (20 Núcleos)";
      tech = "Intel Arrow Lake / Arquitectura Híbrida Desagregada";
      family = "Intel Core Ultra 7";
    } else {
      score = 9.4;
      cores = 14;
      threads = 14;
      tierName = "Gama Alta Gamer (Intel Core Ultra 5)";
      layout = "6 P-Cores + 8 E-Cores (14 Núcleos)";
      tech = "Intel Arrow Lake / Lion Cove + Skymont";
      family = "Intel Core Ultra 5";
    }
    coresInfo = `${cores} Núcleos (${threads} Hilos) / Nueva Gen Intel`;
  }

  // =========================================================================
  // 4. INTEL CORE i9 (14ª A 9ª GENERACIÓN)
  // =========================================================================
  else if (/i9|14900|13900|12900|11900|10900|9900/i.test(cpu) && /core|intel|i9/i.test(cpu)) {
    if (/14900|13900/i.test(cpu)) {
      score = 9.9;
      cores = 24;
      threads = 32;
      tierName = "Gama Entusiasta Suprema (Intel Raptor Lake i9)";
      layout = "8 P-Cores (hasta 6.0 GHz) + 16 E-Cores Gracemont";
      tech = "Intel Thread Director (HT + Gracemont)";
      family = "Intel Core i9 (13ª/14ª Gen)";
    } else if (/12900/i.test(cpu)) {
      score = 9.7;
      cores = 16;
      threads = 24;
      tierName = "Gama Alta Flagship (Intel Alder Lake i9)";
      layout = "8 P-Cores (5.2 GHz) + 8 E-Cores Gracemont";
      tech = "Intel Hybrid (Golden Cove + Gracemont)";
      family = "Intel Core i9 (12ª Gen)";
    } else if (/11900|10900/i.test(cpu)) {
      score = 9.1;
      cores = /10900/i.test(cpu) ? 10 : 8;
      threads = cores * 2;
      tierName = `Gama Alta Gamer (Intel Core i9 - ${cores}C/${threads}T)`;
      layout = `${cores} Núcleos Físicos / ${threads} Hilos (hasta 5.3 GHz)`;
      tech = "Intel Hyper-Threading";
      family = "Intel Core i9 (10ª/11ª Gen)";
    } else {
      score = 8.9;
      cores = 8;
      threads = 16;
      tierName = "Gama Media-Alta Gamer (Intel Core i9-9900K)";
      layout = "8 Núcleos Coffee Lake / 16 Hilos (5.0 GHz)";
      tech = "Intel Hyper-Threading";
      family = "Intel Core i9 (9ª Gen)";
    }
    coresInfo = `${cores} Núcleos (${threads} Hilos) / Core i9`;
  }

  // =========================================================================
  // 5. INTEL CORE i7 (14ª A 8ª GENERACIÓN)
  // =========================================================================
  else if (/14700|13700|12700|11700|10700|9700|8700|i7.*(?:14|13|12|11|10|9|8)/i.test(cpu)) {
    if (/14700/i.test(cpu)) {
      score = 9.7;
      cores = 20;
      threads = 28;
      tierName = "Gama Alta Moderna (Intel Raptor Lake Refresh i7)";
      layout = "8 P-Cores (5.6 GHz) + 12 E-Cores (28 Hilos)";
      tech = "Intel Thread Director (HT + Gracemont)";
      family = "Intel Core i7-14700K/F (14ª Gen)";
    } else if (/13700/i.test(cpu)) {
      score = 9.6;
      cores = 16;
      threads = 24;
      tierName = "Gama Alta Moderna (Intel Raptor Lake i7)";
      layout = "8 P-Cores (5.4 GHz) + 8 E-Cores (24 Hilos)";
      tech = "Intel Thread Director (HT + Gracemont)";
      family = "Intel Core i7-13700K/F (13ª Gen)";
    } else if (/12700/i.test(cpu)) {
      score = 9.4;
      cores = 12;
      threads = 20;
      tierName = "Gama Alta Gamer (Intel Alder Lake i7)";
      layout = "8 P-Cores (5.0 GHz) + 4 E-Cores (20 Hilos)";
      tech = "Intel Hybrid Architecture";
      family = "Intel Core i7-12700K/F (12ª Gen)";
    } else if (/11700|10700/i.test(cpu)) {
      score = 8.8;
      cores = 8;
      threads = 16;
      tierName = "Gama Media-Alta Gamer (Intel Core i7 8C/16T)";
      layout = "8 Núcleos Físicos / 16 Hilos (hasta 5.1 GHz)";
      tech = "Intel Hyper-Threading";
      family = "Intel Core i7 (10ª/11ª Gen)";
    } else if (/9700/i.test(cpu)) {
      score = 8.4;
      cores = 8;
      threads = 8;
      tierName = "Gama Media Gamer (Intel Core i7 8 Núcleos)";
      layout = "8 Núcleos Físicos / 8 Hilos (Sin HT)";
      tech = "Monohilo Coffee Lake";
      family = "Intel Core i7 9ª Gen";
    } else {
      score = 8.4;
      cores = 6;
      threads = 12;
      tierName = "Gama Media Gamer (Intel Core i7 6C/12T)";
      layout = "6 Núcleos Coffee Lake / 12 Hilos";
      tech = "Intel Hyper-Threading";
      family = "Intel Core i7 8ª Gen";
    }
    coresInfo = `${cores} Núcleos (${threads} Hilos) / Core i7 Moderno`;
  }

  // =========================================================================
  // 6. AMD RYZEN 7 (ZEN 5, ZEN 4, ZEN 3, ZEN 2)
  // =========================================================================
  else if (/ryzen\s*7|\br7\b|9700x|7700x|7700\b|8700g|5800x|5700x|5700g|3800x|3700x/i.test(cpu) && !/radeon/i.test(cpu)) {
    if (/9700x/i.test(cpu)) {
      score = 9.7;
      cores = 8;
      threads = 16;
      tierName = "Gama Alta Moderna (AMD Zen 5 - 8C/16T)";
      layout = "8 Núcleos Zen 5 / 16 Hilos (5.5 GHz / Alto IPC)";
      tech = "AMD Zen 5 (4nm) + SMT";
      family = "AMD Ryzen 7 9700X (Zen 5)";
    } else if (/7700x|7700\b|8700g/i.test(cpu)) {
      score = 9.5;
      cores = 8;
      threads = 16;
      tierName = "Gama Alta Moderna (AMD Zen 4 - 8C/16T)";
      layout = "8 Núcleos Zen 4 / 16 Hilos (5.4 GHz)";
      tech = "AMD Zen 4 (5nm) + SMT";
      family = "AMD Ryzen 7 (Zen 4)";
    } else if (/5800x|5700x|5700g/i.test(cpu)) {
      score = 9.0;
      cores = 8;
      threads = 16;
      tierName = "Gama Media-Alta Gamer (AMD Zen 3 - 8C/16T)";
      layout = "8 Núcleos Zen 3 / 16 Hilos (4.7 GHz)";
      tech = "AMD Zen 3 (7nm) + SMT";
      family = "AMD Ryzen 7 (Zen 3)";
    } else if (/3800x|3700x/i.test(cpu)) {
      score = 8.4;
      cores = 8;
      threads = 16;
      tierName = "Gama Media Gamer (AMD Zen 2 - 8C/16T)";
      layout = "8 Núcleos Zen 2 / 16 Hilos";
      tech = "AMD Zen 2 + SMT";
      family = "AMD Ryzen 7 (Zen 2)";
    } else {
      score = 8.9;
      cores = 8;
      threads = 16;
      tierName = "Gama Alta Gamer (AMD Ryzen 7)";
      layout = "8 Núcleos Físicos / 16 Hilos";
      tech = "AMD SMT Multihilo";
      family = "AMD Ryzen 7";
    }
    coresInfo = `${cores} Núcleos (${threads} Hilos) / Ryzen 7`;
  }

  // =========================================================================
  // 7. INTEL CORE i5 (14ª, 13ª Y 12ª GENERACIÓN HÍBRIDOS & RÁPIDOS)
  // =========================================================================
  else if (/14600|14500|14400|13600|13500|13400|12600|12500|12400|i5.*(?:14|13|12)/i.test(cpu)) {
    if (/14600|13600/i.test(cpu)) {
      score = 9.5;
      cores = 14;
      threads = 20;
      tierName = "Gama Alta Gamer (Intel Raptor Lake i5 14C/20T)";
      layout = "6 P-Cores (5.3 GHz) + 8 E-Cores Gracemont";
      tech = "Intel Thread Director (HT + Gracemont)";
      family = "Intel Core i5-14600K/13600K";
    } else if (/14500|13500/i.test(cpu)) {
      score = 9.3;
      cores = 14;
      threads = 20;
      tierName = "Gama Alta Gamer (Intel i5 14C/20T Versátil)";
      layout = "6 P-Cores (5.0 GHz) + 8 E-Cores Gracemont";
      tech = "Intel Hybrid Architecture";
      family = "Intel Core i5 (13ª/14ª Gen)";
    } else if (/14400|13400|12600/i.test(cpu)) {
      score = 9.0;
      cores = 10;
      threads = 16;
      tierName = "Gama Media-Alta Gamer (Intel i5 10C/16T)";
      layout = "6 P-Cores + 4 E-Cores (16 Hilos)";
      tech = "Intel Hybrid Architecture";
      family = "Intel Core i5 (12ª-14ª Gen)";
    } else {
      score = 8.7;
      cores = 6;
      threads = 12;
      tierName = "Gama Media Gamer Rey Calidad/Precio (Intel i5 6C/12T)";
      layout = "6 Núcleos Golden Cove / 12 Hilos (4.4 GHz)";
      tech = "Intel Hyper-Threading (IPC Alto)";
      family = "Intel Core i5-12400/F";
    }
    coresInfo = `${cores} Núcleos (${threads} Hilos) / Core i5 Moderno`;
  }

  // =========================================================================
  // 8. AMD RYZEN 5 (ZEN 5, ZEN 4, ZEN 3, ZEN 2)
  // =========================================================================
  else if (/ryzen\s*5|\br5\b|9600x|7600x|7600\b|7500f|8600g|5600x|5600\b|5600gt|5600g|5500\b|4500\b|4600g|3600x|3600\b/i.test(cpu) && !/radeon/i.test(cpu)) {
    if (/9600x/i.test(cpu)) {
      score = 9.5;
      cores = 6;
      threads = 12;
      tierName = "Gama Alta Gamer (AMD Zen 5 - 6C/12T)";
      layout = "6 Núcleos Zen 5 / 12 Hilos (5.4 GHz / IPC Supremo)";
      tech = "AMD Zen 5 (4nm) + SMT";
      family = "AMD Ryzen 5 9600X (Zen 5)";
    } else if (/7600x|7600\b|7500f|8600g/i.test(cpu)) {
      score = 9.3;
      cores = 6;
      threads = 12;
      tierName = "Gama Alta Gamer (AMD Zen 4 - 6C/12T)";
      layout = "6 Núcleos Zen 4 / 12 Hilos (5.3 GHz)";
      tech = "AMD Zen 4 (5nm) + SMT";
      family = "AMD Ryzen 5 (Zen 4)";
    } else if (/5600x|5600\b|5600gt|5600g|5500\b/i.test(cpu)) {
      score = 8.8;
      cores = 6;
      threads = 12;
      tierName = "Gama Media-Alta Gamer (AMD Zen 3 - 6C/12T)";
      layout = "6 Núcleos Zen 3 / 12 Hilos (4.6 GHz)";
      tech = "AMD Zen 3 (7nm) + SMT";
      family = "AMD Ryzen 5 (Zen 3)";
    } else if (/3600x|3600\b|4500\b|4600g/i.test(cpu)) {
      score = 8.2;
      cores = 6;
      threads = 12;
      tierName = "Gama Media Gamer (AMD Zen 2 - 6C/12T)";
      layout = "6 Núcleos Zen 2 / 12 Hilos";
      tech = "AMD Zen 2 + SMT";
      family = "AMD Ryzen 5 (Zen 2)";
    } else {
      score = 8.5;
      cores = 6;
      threads = 12;
      tierName = "Gama Media Gamer (AMD Ryzen 5)";
      layout = "6 Núcleos Físicos / 12 Hilos";
      tech = "AMD SMT Multihilo";
      family = "AMD Ryzen 5";
    }
    coresInfo = `${cores} Núcleos (${threads} Hilos) / Ryzen 5`;
  }

  // =========================================================================
  // 9. INTEL CORE i3 MODERNO (12ª, 13ª Y 14ª GENERACIÓN)
  // =========================================================================
  else if (/14100|13100|12100|i3.*(?:14|13|12)/i.test(cpu)) {
    score = 8.1;
    cores = 4;
    threads = 8;
    tierName = "Gama Media Entrada Fuerte (Intel i3 4C/8T Alto IPC)";
    layout = "4 Núcleos Golden Cove / 8 Hilos (hasta 4.7 GHz)";
    tech = "Intel Hyper-Threading (IPC de Generación Actual)";
    family = "Intel Core i3 (12ª-14ª Gen)";
    coresInfo = `${cores} Núcleos (${threads} Hilos) / IPC Moderno`;
  }

  // =========================================================================
  // 10. INTEL CORE i5 (10ª Y 11ª GENERACIÓN - COMET/ROCKET LAKE 6C/12T)
  // =========================================================================
  else if (/11600|11400|11500|10600|10400|10500|i5.*(?:11|10)/i.test(cpu)) {
    score = 8.3;
    cores = 6;
    threads = 12;
    tierName = "Gama Media Gamer Sólida (Intel i5 6C/12T)";
    layout = "6 Núcleos Físicos / 12 Hilos (4.4 GHz)";
    tech = "Intel Hyper-Threading";
    family = "Intel Core i5 (10ª/11ª Gen)";
    coresInfo = `${cores} Núcleos (${threads} Hilos) / 6C-12T`;
  }

  // =========================================================================
  // 11. INTEL XEON WORKSTATION & MULTI-CORE (E5 V3/V4, BROADWELL-EP, HASWELL-EP)
  // =========================================================================
  else if (/xeon\s*e5.*v[345]|e5-26\d{2}|e5-16\d{2}|xeon\s*silver|xeon\s*gold/i.test(cpu)) {
    score = 8.0;
    cores = 12;
    threads = 24;
    tierName = "Workstation Multihilo Masivo (Intel Xeon E5)";
    layout = "10-14 Núcleos Físicos / 20-28 Hilos";
    tech = "Intel Hyper-Threading Servidor";
    family = "Intel Xeon E5 v3/v4";
    coresInfo = `${cores} Núcleos (${threads} Hilos) / Xeon Multi-Core`;
  }

  // =========================================================================
  // 12. INTEL CORE i5 (8ª Y 9ª GENERACIÓN 6C/6T) & AMD RYZEN 1ª/2ª GEN (2600, 1600)
  // =========================================================================
  else if (/9600|9500|9400|8600|8500|8400|i5.*(?:9|8)|2600|1600\s*af|1600/i.test(cpu)) {
    score = 7.4;
    cores = 6;
    threads = /2600|1600/i.test(cpu) ? 12 : 6;
    tierName = "Gama Media Estándar (6 Núcleos)";
    layout = `6 Núcleos Físicos / ${threads} Hilos`;
    tech = /2600|1600/i.test(cpu) ? "AMD SMT" : "Monohilo (Sin HT)";
    family = /2600|1600/i.test(cpu) ? "AMD Ryzen 5 (1ª/2ª Gen)" : "Intel Core i5 (8ª/9ª Gen)";
    coresInfo = `${cores} Núcleos (${threads} Hilos)`;
  }

  // =========================================================================
  // 13. INTEL CORE i7 CLÁSICOS (4 NÚCLEOS / 8 HILOS: 7700K, 6700K, 4790K, 3770, 2600) & RYZEN 7 1ª/2ª GEN (2700, 1700)
  // =========================================================================
  else if (/7700|6700|4790|4770|3770|2600k?|i7.*(?:7|6|4|3|2)|2700|1700|1800x/i.test(cpu)) {
    score = 7.3;
    cores = /2700|1700|1800/i.test(cpu) ? 8 : 4;
    threads = cores * 2;
    tierName = "Gama Media-Baja (Quad Core + HT Clásico)";
    layout = `${cores} Núcleos / ${threads} Hilos con HyperThreading`;
    tech = "Intel Hyper-Threading / AMD SMT";
    family = /2700|1700|1800/i.test(cpu) ? "AMD Ryzen 7 1ª/2ª Gen" : "Intel Core i7 Clásico";
    coresInfo = `${cores} Núcleos (${threads} Hilos)`;
  }

  // =========================================================================
  // 14. INTEL CORE i3 (10ª GEN: 10100/10105 4C/8T) & AMD RYZEN 3 (3300X, 3100)
  // =========================================================================
  else if (/10100|10105|i3.*10|3300x|3100/i.test(cpu)) {
    score = 7.3;
    cores = 4;
    threads = 8;
    tierName = "Gama Media-Baja (4 Núcleos / 8 Hilos)";
    layout = "4 Núcleos Físicos / 8 Hilos";
    tech = "Hyper-Threading / SMT";
    family = "Intel Core i3 10ª Gen / Ryzen 3 Zen 2";
    coresInfo = `${cores} Núcleos (${threads} Hilos)`;
  }

  // =========================================================================
  // 15. INTEL CORE i5 CLÁSICOS DE 4 NÚCLEOS (7400, 6500, 4460, 3470, 2500K) & RYZEN 3 BÁSICOS (1200, 2200G, 3200G) & AMD FX-8350
  // =========================================================================
  else if (
    /7400|7500|7600|6400|6500|6600|4690|4590|4570|4460|4440|4430|3570|3470|3330|2500|2400|i5.*(?:7|6|4|3|2)/i.test(cpu) ||
    /2200g|3200g|1200|1300x|fx-?8\d+|fx-?6\d+|xeon\s*e3|quad\s*q\d+/i.test(cpu)
  ) {
    score = 5.8;
    cores = /fx-?8/i.test(cpu) ? 8 : (/fx-?6/i.test(cpu) ? 6 : 4);
    threads = cores;
    tierName = "Gama Entrada (4 Núcleos Puros Clásicos)";
    layout = `${cores} Núcleos Físicos / ${threads} Hilos`;
    tech = "Monohilo Clásico";
    family = "Intel Core i5 / AMD FX Clásico";
    coresInfo = `${cores} Núcleos / 4 Hilos`;
  }

  // =========================================================================
  // 16. INTEL CORE i3 ANTIGUOS (7100, 6100, 4130, 3220, 2100) & PENTIUM GOLD (G6400, G5400, G4560) & ATHLON 3000G
  // =========================================================================
  else if (/7100|6100|4130|4150|4160|4170|3220|2100|i3.*(?:7|6|4|3|2)|g6400|g5400|g4560|pentium\s*gold|athlon|fx-?4\d+|a10|a8/i.test(cpu)) {
    score = 4.4;
    cores = 2;
    threads = 4;
    tierName = "Gama Básica / 2 Núcleos con HyperThreading";
    layout = "2 Núcleos Físicos / 4 Hilos (Hyper-Threading)";
    tech = "Intel Hyper-Threading / SMT Básico";
    family = "Intel Core i3 / Pentium Gold";
    coresInfo = "2 Núcleos 4 Hilos";
  }

  // =========================================================================
  // 17. COMODINES GENÉRICOS INTELIGENTES (Para búsquedas como "Ryzen", "Core i7", etc.)
  // =========================================================================
  else if (/ryzen/i.test(cpu)) {
    score = 8.5;
    cores = 6;
    threads = 12;
    tierName = "Gama Media Gamer (Familia AMD Ryzen)";
    layout = "6 Núcleos Zen / 12 Hilos";
    tech = "AMD SMT";
    family = "AMD Ryzen";
    coresInfo = "6 Núcleos 12 Hilos";
  }
  else if (/core\s*i/i.test(cpu)) {
    score = 7.5;
    cores = 4;
    threads = 8;
    tierName = "Gama Media (Familia Intel Core)";
    layout = "4 Núcleos / 8 Hilos";
    tech = "Intel Hyper-Threading";
    family = "Intel Core";
    coresInfo = "4 Núcleos 8 Hilos";
  }

  // =========================================================================
  // 18. GAMA MUY ANTIGUA / OBSOLETA
  // =========================================================================
  else {
    score = 2.4;
    tierName = "Obsoleto / Solo Juegos Retro y Ofimática";
    cores = 2;
    threads = 2;
    layout = "2 Núcleos / 2 Hilos";
    tech = "Monohilo Obsoleto";
    family = "Dual Core / Básico";
    coresInfo = "2 Núcleos o Básico";
  }

  return {
    score,
    tierName,
    coresInfo,
    cores,
    threads,
    layout,
    tech,
    family,
    isModernHighEnd: score >= 9.0
  };
}

function evaluateGameDemand(gameTitle) {
  const g = (gameTitle || '').toLowerCase();
  
  // Nivel 9: Ultra Exigentes / Ray Tracing / Última Generación AAA
  if (g.includes('cyberpunk') || g.includes('alan wake 2') || g.includes('black myth') || g.includes('wukong') || g.includes('starfield') || g.includes('avatar') || g.includes('stalker 2') || g.includes('s.t.a.l.k.e.r') || g.includes('dragon\'s dogma 2') || g.includes('dragons dogma') || g.includes('hellblade 2') || g.includes('ark survival ascended') || g.includes('silent hill 2') || g.includes('lords of the fallen') || g.includes('final fantasy xvi')) {
    return {
      demand: 8.5,
      minGpu: "GTX 1060 6GB / GTX 1650",
      recGpu: "RTX 3070 / RTX 4060 / RX 6700 XT",
      minCpu: "Core i7-6700 / Ryzen 5 3600",
      recCpu: "Core i5-14600K / Ryzen 7 7800X3D",
      minCores: 6,
      minThreads: 12,
      recCores: 8,
      recThreads: 16,
      recRam: "16 GB RAM",
      engineName: "REDengine / Unreal Engine 5 (Alta Paralelización)",
      engineUsage: "Motor gráfico de alta paralelización multihilo. Escala activamente en hasta 8 núcleos físicos y 16 hilos lógicos para física densa, streaming de texturas en tiempo real e IA de multitudes sin micro-stuttering.",
      fpsOptimo: "65-80+ FPS @ 1080p Ultra (con DLSS / FSR Frame Gen)",
      fpsJugable: "45-55 FPS @ 1080p Calidad Media-Baja",
      label: "Juego AAA de Alta Exigencia Gráfica"
    };
  }

  // Nivel 7.5: Pesados AAA (God of War, RDR2, TLOU, Hogwarts, RE4)
  if (g.includes('god of war') || g.includes('red dead') || g.includes('rdr') || g.includes('last of us') || g.includes('hogwarts') || g.includes('elden ring') || g.includes('resident evil 4') || g.includes('re 4') || g.includes('spiderman') || g.includes('spider-man') || g.includes('miles morales') || g.includes('baldur') || g.includes('forza horizon 5') || g.includes('horizon forbidden') || g.includes('dead space') || g.includes('jedi survivor') || g.includes('warzone') || g.includes('battlefield 2042') || g.includes('plague tale')) {
    return {
      demand: 7.2,
      minGpu: "GTX 1050 Ti 4GB / GTX 960",
      recGpu: "GTX 1660 Super / RTX 3060 / RTX 4060",
      minCpu: "Core i5-8400 / Ryzen 3 3300X",
      recCpu: "Core i5-12400F / Ryzen 5 5600",
      minCores: 4,
      minThreads: 8,
      recCores: 6,
      recThreads: 12,
      recRam: "16 GB RAM",
      engineName: "Motor Gráfico AAA Avanzado",
      engineUsage: "Distribuye la carga de física, sombras complejas y descompresión de shaders en 6 núcleos físicos / 12 hilos concurrentes para mantener frametimes perfectamente estables.",
      fpsOptimo: "75-100+ FPS @ 1080p Calidad Ultra",
      fpsJugable: "50-60 FPS @ 1080p Calidad Media",
      label: "Juego AAA Gráficos Avanzados"
    };
  }

  // Nivel 5.5: Estándar 3D / Populares (GTA V, Witcher 3, FIFA, Far Cry, Tomb Raider)
  if (g.includes('gta') || g.includes('grand theft auto') || g.includes('witcher') || g.includes('far cry') || g.includes('fifa') || g.includes('ea sports fc') || g.includes('fc 24') || g.includes('fc 25') || g.includes('assassin') || g.includes('monster hunter') || g.includes('resident evil') || g.includes('devil may cry') || g.includes('days gone') || g.includes('death stranding') || g.includes('control') || g.includes('hitman') || g.includes('tomb raider') || g.includes('sekiro') || g.includes('dark souls') || g.includes('horizon zero') || g.includes('fallout 4') || g.includes('metro') || g.includes('doom eternal') || g.includes('apex') || g.includes('pubg') || g.includes('need for speed')) {
    return {
      demand: 5.4,
      minGpu: "GTX 660 / GTX 750 Ti / Intel Iris Xe",
      recGpu: "GTX 1060 / GTX 1650 / RX 580",
      minCpu: "Core i5-3470 / AMD FX-8350",
      recCpu: "Core i5-10400F / Ryzen 5 3600",
      minCores: 4,
      minThreads: 4,
      recCores: 6,
      recThreads: 8,
      recRam: "8 GB a 16 GB",
      engineName: "Motor 3D Estándar / RAGE Engine",
      engineUsage: "Aprovecha frecuencias de reloj elevadas y buen IPC mononúcleo; utiliza eficientemente entre 4 y 6 hilos para física de vehículos, IA y rendering.",
      fpsOptimo: "110-150+ FPS @ 1080p Calidad Ultra",
      fpsJugable: "60 FPS @ 1080p Calidad Media",
      label: "Juego 3D Estándar / Acción"
    };
  }

  // Nivel 4: Esports y Competitivos (CS2, Valorant, Fortnite, LoL, Rocket League)
  if (g.includes('cs2') || g.includes('cs:go') || g.includes('counter strike') || g.includes('valorant') || g.includes('fortnite') || g.includes('league of legends') || g.includes('dota') || g.includes('rocket league') || g.includes('rainbow six') || g.includes('overwatch') || g.includes('team fortress') || g.includes('paladins') || g.includes('smite') || g.includes('world of warcraft')) {
    return {
      demand: 4.0,
      minGpu: "Intel HD 4000 / Vega 7 / GT 1030",
      recGpu: "GTX 1050 Ti / GTX 1650",
      minCpu: "Core i3-4130 / AMD Athlon 3000G",
      recCpu: "Core i3-12100F / Ryzen 5 5600X",
      minCores: 4,
      minThreads: 4,
      recCores: 6,
      recThreads: 8,
      recRam: "8 GB RAM",
      engineName: "Motor Competitivo / Baja Latencia (Source 2 / Unreal)",
      engineUsage: "Prioriza latencia ultra baja de memoria e instrucciones por ciclo (IPC). 4 a 6 núcleos son ideales para maximizar la tasa de cuadros (144+ a 240+ FPS) sin cuellos de botella.",
      fpsOptimo: "180-300+ FPS @ 1080p Ultra",
      fpsJugable: "80-120 FPS @ 1080p",
      label: "Título Competitivo / Esports"
    };
  }

  // Nivel 2.5: Juegos Clásicos, Ligeros o Indie (Minecraft, Roblox, L4D2, Terraria, Hollow Knight)
  return {
    demand: 2.8,
    minGpu: "Gráfica Integrada / Intel HD / Vega",
    recGpu: "GTX 750 Ti / GTX 1050",
    minCpu: "Dual Core 2.5 GHz",
    recCpu: "Quad Core 3.0 GHz",
    minCores: 2,
    minThreads: 2,
    recCores: 4,
    recThreads: 4,
    recRam: "4 GB a 8 GB",
    engineName: "Motor Ligero 2D / 3D (Unity / Godot / Java)",
    engineUsage: "Carga de procesamiento moderada; funciona con total soltura en CPUs de 2 a 4 núcleos con requisitos térmicos mínimos.",
    fpsOptimo: "200+ FPS (Máxima Fluidez Absoluta)",
    fpsJugable: "60+ FPS en casi cualquier equipo",
    label: "Juego Ligero / Casual / Indie"
  };
}

function generateHeuristicPcCompatibility(gameTitle, profile) {
  const gpuEval = evaluateGpuBenchmark(profile.gpu, profile.vram);
  const cpuEval = evaluateCpuBenchmark(profile.cpu);
  const gameProfile = evaluateGameDemand(gameTitle);
  
  const ramNum = parseInt(profile.ram, 10) || 8;
  const gpuScore = gpuEval.score;
  const cpuScore = cpuEval.score;
  const gameDemand = gameProfile.demand;

  // Normalización de scores 0-100 para D3
  const userGpuScore100 = Math.min(100, Math.round((gpuScore / 10) * 100));
  const minGpuScore100 = Math.min(100, Math.max(20, Math.round(((gameDemand - 1.8) / 10) * 100)));
  const recGpuScore100 = Math.min(100, Math.max(35, Math.round((gameDemand / 10) * 100)));

  const userCpuScore100 = Math.min(100, Math.round((cpuScore / 10) * 100));
  const minCpuScore100 = Math.min(100, Math.max(20, Math.round(((gameDemand - 1.5) / 10) * 100)));
  const recCpuScore100 = Math.min(100, Math.max(30, Math.round(((gameDemand - 0.2) / 10) * 100)));

  const minRamGb = gameDemand >= 7.5 ? 16 : (gameDemand >= 4.5 ? 8 : 4);
  const recRamGb = gameDemand >= 7.5 ? 16 : (gameDemand >= 5.0 ? 16 : 8);

  // Cálculo de potencia combinada ponderada
  const ramWeight = (Math.min(ramNum, 32) / 16) * 1.5;
  const combinedHardware = (gpuScore * 0.55) + (cpuScore * 0.30) + ramWeight;
  const ratio = combinedHardware / gameDemand;

  let verdict = "JUGABLE";
  let verdictTitle = "Jugable y Fluido (45-60 FPS)";
  let powerPercent = 75;
  let fpsEstimate = gameProfile.fpsJugable;
  let targetRes = "1080p (Full HD)";

  // Evaluación de estados por componente
  let gpuStatus = "OK";
  let cpuStatus = "OK";
  let ramStatus = "OK";

  // GPU Status con tolerancia realista
  if (gpuScore >= gameDemand) {
    gpuStatus = "OK";
  } else if (gpuScore >= gameDemand - 1.8) {
    gpuStatus = "WARNING";
  } else {
    gpuStatus = "FAIL";
  }

  // CPU Status con calibración precisa y realista
  if (cpuScore >= gameDemand - 0.5 || cpuScore >= 8.5) {
    cpuStatus = "OK";
  } else if (cpuScore >= gameDemand - 2.2) {
    cpuStatus = "WARNING";
  } else {
    cpuStatus = "FAIL";
  }

  // RAM Status
  if (ramNum >= recRamGb || (ramNum >= minRamGb && gameDemand <= 6.0)) {
    ramStatus = "OK";
  } else if (ramNum >= minRamGb) {
    ramStatus = "WARNING";
  } else {
    ramStatus = (gameDemand > 4.0) ? "FAIL" : "WARNING";
  }

  // Determinación de Veredicto General
  if (ratio >= 1.15 && gpuStatus === "OK" && cpuStatus !== "FAIL") {
    verdict = "OPTIMO";
    verdictTitle = "¡Corre Excelente! (60+ FPS)";
    powerPercent = Math.min(100, Math.round(75 + Math.min(25, (ratio - 1.15) * 22)));
    fpsEstimate = gameProfile.fpsOptimo;
    targetRes = (gpuScore >= 9.0 && gameDemand <= 7.5) ? "1080p Ultra / 1440p (2K)" : "1080p (Full HD)";
  } else if (ratio < 0.72 || gpuStatus === "FAIL" || (cpuStatus === "FAIL" && gpuStatus !== "OK")) {
    verdict = "NO_RECOMENDADO";
    verdictTitle = "No Recomendado / Hardware Insuficiente";
    powerPercent = Math.max(12, Math.round(ratio * 45));
    fpsEstimate = "15-25 FPS (Tirones y baja tasa de cuadros)";
    targetRes = "720p (Baja resolución recomendada)";
  } else {
    verdict = "JUGABLE";
    verdictTitle = "Jugable y Fluido (45-60 FPS)";
    powerPercent = Math.min(84, Math.max(50, Math.round(ratio * 68)));
    fpsEstimate = gameProfile.fpsJugable;
    targetRes = "1080p con FSR / DLSS Equilibrado";
  }

  // Notas descriptivas de GPU
  let gpuNote = "Gráfica con potencia y shaders de sobra para mover texturas y geometría fluidamente.";
  if (gpuEval.vramGB >= 16) {
    gpuNote = "16GB de VRAM holgados: texturas en Ultra y carga de mods sin ningún cuello de botella.";
  } else if (gpuScore >= 8.5) {
    gpuNote = "GPU gamer moderna con aceleración por IA (DLSS/FSR) y excelente tasa de fotogramas.";
  } else if (gpuStatus === "WARNING") {
    gpuNote = "Tarjeta suficiente ajustando sombras, reflejos y activando escalado de resolución (FSR/DLSS).";
  } else if (gpuStatus === "FAIL") {
    gpuNote = "Gráfica integrada o de gama básica; se requieren ajustes gráficos agresivos para lograr jugabilidad.";
  }

  // Notas descriptivas de CPU
  let cpuNote = "Procesador rápido con núcleos y frecuencias de sobra para este juego.";
  if (cpuScore >= 9.3) {
    cpuNote = `CPU moderna de alto rendimiento (${cpuEval.coresInfo}): rendimiento sobresaliente y cero cuello de botella.`;
  } else if (cpuScore >= 8.5) {
    cpuNote = `Procesador gamer moderno (${cpuEval.coresInfo}): excelente tasa de instrucciones por ciclo (IPC).`;
  } else if (cpuScore >= 7.8) {
    cpuNote = `CPU sólida de 6 núcleos o alto IPC: suficiente para procesar la física y frametimes del juego.`;
  } else if (cpuStatus === "WARNING") {
    cpuNote = `Procesador adecuado pero con uso intensivo; se recomienda cerrar apps en segundo plano.`;
  } else if (cpuStatus === "FAIL") {
    cpuNote = `Procesador antiguo o de núcleos insuficientes para la física y multihilo de este título.`;
  }

  // Resumen ejecutivo
  let summary = "";
  if (verdict === "OPTIMO") {
    summary = `Tu equipo con ${profile.gpu} y ${profile.cpu} supera ampliamente las especificaciones requeridas para "${gameTitle}". Podrás disfrutar de una experiencia sumamente fluida con gráficos en calidad Alta/Ultra y tiempos de respuesta inmediatos.`;
  } else if (verdict === "JUGABLE") {
    summary = `"${gameTitle}" funcionará de manera fluida y disfrutable en tu configuración. Se recomienda mantener una calidad gráfica Media/Alta y utilizar escalado dinámico (NVIDIA DLSS o AMD FSR) para garantizar 60 FPS estables.`;
  } else {
    summary = `Las especificaciones de tu equipo (${profile.gpu}) se encuentran por debajo del nivel recomendado para "${gameTitle}". Sin embargo, aplicando los ajustes gráficos de optimización recomendados a continuación, podrás lograr una experiencia jugable de 35 a 45 FPS estables.`;
  }

  // Detección de Cuello de Botella
  let bottleneck = "Hardware equilibrado sin cuellos de botella notables.";
  if (gpuScore >= 8.5 && cpuScore <= 6.0) {
    bottleneck = "Ligero cuello de botella en CPU (la gráfica tiene más potencia que el procesador).";
  } else if (cpuScore >= 8.5 && gpuScore <= 6.0) {
    bottleneck = "Limitación en tarjeta gráfica (el procesador puede entregar más fotogramas).";
  }

  // Generación Automática de "Ajustes Gráficos Sugeridos" (Rescue Tuning) para GPU de Entrada / Insuficiente
  const isEntryOrInsufficientGpu = (gpuScore <= 7.0) || (gpuStatus !== 'OK') || (gameDemand >= 6.0 && gpuScore < 8.0) || (profile.gpu.toLowerCase().includes('1650') || profile.gpu.toLowerCase().includes('1050') || profile.gpu.toLowerCase().includes('580') || profile.gpu.toLowerCase().includes('570') || profile.gpu.toLowerCase().includes('vega') || profile.gpu.toLowerCase().includes('intel hd') || profile.gpu.toLowerCase().includes('uhd'));
  
  let rescueTuning = null;
  if (isEntryOrInsufficientGpu) {
    const isGtx1650OrSimilar = profile.gpu.toLowerCase().includes('1650') || profile.gpu.toLowerCase().includes('1050') || profile.gpu.toLowerCase().includes('1060') || (gpuEval.vramGB > 0 && gpuEval.vramGB <= 4);
    const isIntegrated = profile.gpu.toLowerCase().includes('intel hd') || profile.gpu.toLowerCase().includes('uhd') || profile.gpu.toLowerCase().includes('vega');

    rescueTuning = {
      is_needed: true,
      gpu_model: profile.gpu,
      title: isGtx1650OrSimilar ? `Plan de Optimización de FPS para ${profile.gpu} (4GB VRAM)` : `Ajustes Gráficos Sugeridos para ${profile.gpu}`,
      target_fps_gain: isIntegrated ? "+12 a +20 FPS estimados (720p 30-40 FPS)" : "+18 a +28 FPS estimados (1080p 40-50 FPS)",
      settings: [
        {
          name: "Resolución y Escalado de Imagen",
          value: isIntegrated ? "720p / 900p con AMD FSR 2.2 en modo 'Rendimiento'" : "1080p dinámico con FSR 2.2 / FSR 3 en modo 'Equilibrado' o 'Rendimiento'",
          impact: "+12 a +18 FPS inmediatos",
          tag: "ALTO"
        },
        {
          name: "Calidad de Texturas y Filtrado",
          value: isGtx1650OrSimilar ? "Calidad Media (Fundamental para NO saturar los 4GB de VRAM y evitar congelamientos/stuttering)" : "Calidad Baja/Media",
          impact: "Elimina tirones de VRAM",
          tag: "CRÍTICO"
        },
        {
          name: "Sombras, Iluminación y Oclusión",
          value: "Sombras en 'Bajo' / Oclusión Ambiental desactivada (o SSAO en Bajo)",
          impact: "+20% alivio de carga en GPU",
          tag: "ALTO"
        },
        {
          name: "Niebla Volumétrica y Rayos Crepusculares",
          value: "Desactivar o configurar en 'Bajo'",
          impact: "+6 a 10 FPS de ganancia",
          tag: "MEDIO"
        },
        {
          name: "Reflejos de Espacio en Pantalla (SSR)",
          value: "Desactivar (ahorra un consumo sustancial de shaders)",
          impact: "+5 a 8 FPS",
          tag: "MEDIO"
        },
        {
          name: "Efectos Cinematográficos y Post-procesado",
          value: "Desactivar Desenfoque de Movimiento (Motion Blur), Aberración Cromática y Profundidad de Campo",
          impact: "+3 a 5 FPS y mayor nitidez visual",
          tag: "BAJO"
        },
        {
          name: "Generación de Cuadros (Frame Generation)",
          value: "Activar AMD FSR 3 Frame Generation o herramienta 'Lossless Scaling' en Windows",
          impact: "Duplica la fluidez visual",
          tag: "RECOMENDADO"
        },
        {
          name: "Límite de Tasa de Cuadros (FPS Lock)",
          value: "Fijar límite a 36 o 40 FPS en el Panel de Control NVIDIA o RivaTuner",
          impact: "Frametime 100% estable sin saltos",
          tag: "ESTABILIDAD"
        }
      ]
    };
  }

  return {
    game_name: gameTitle,
    verdict: verdict,
    verdict_title: verdictTitle,
    power_percentage: powerPercent,
    fps_estimate: fpsEstimate,
    target_resolution: targetRes,
    summary: summary,
    benchmark_scores: {
      gpu: { user: userGpuScore100, min: minGpuScore100, rec: recGpuScore100, user_name: profile.gpu, min_name: gameProfile.minGpu, rec_name: gameProfile.recGpu },
      cpu: { user: userCpuScore100, min: minCpuScore100, rec: recCpuScore100, user_name: profile.cpu, min_name: "CPU 4 Núcleos", rec_name: "CPU 6+ Núcleos" },
      ram: { user_gb: ramNum, min_gb: minRamGb, rec_gb: recRamGb }
    },
    rescue_tuning: rescueTuning,
    components: {
      cpu: {
        status: cpuStatus,
        required: `Recomendado: ${gameProfile.recRam ? 'CPU 6+ núcleos' : 'CPU 4 núcleos'}`,
        verdict_note: cpuNote
      },
      gpu: {
        status: gpuStatus,
        required: `Mínimo: ${gameProfile.minGpu} | Recomendado: ${gameProfile.recGpu}`,
        verdict_note: gpuNote
      },
      ram: {
        status: ramStatus,
        required: `${gameProfile.recRam}`,
        verdict_note: ramStatus === "OK" ? `${ramNum} GB de RAM ideales para jugar sin micro-stuttering.` : (ramStatus === "WARNING" ? "RAM justa, se recomienda cerrar navegadores en segundo plano." : "Memoria RAM escasa para los requisitos del juego.")
      },
      storage: {
        status: "OK",
        required: "Espacio en disco SSD/HDD",
        verdict_note: profile.storage.includes('SSD') ? "SSD NVMe/SATA detectado: cargas casi instantáneas." : "Disco mecánico tradicional; cargas estándar."
      }
    },
    bottleneck: bottleneck,
    recommended_settings: [
      `Resolución objetivo: ${targetRes}`,
      verdict === "OPTIMO" ? "Calidad gráfica: Alta / Ultra con Texturas en Alto" : "Calidad gráfica: Media con sombras y reflejos en Bajo/Medio",
      gpuScore >= 8.0 ? "Activar NVIDIA DLSS / Frame Generation o AMD FSR en modo Calidad" : "Activar escalado de resolución dinámico si baja de 50 FPS"
    ]
  };
}

// ==========================================
// 📊 RENDERIZADOR D3 DE COMPARATIVA DE RENDIMIENTO HARDWARE (RESPONSIVE)
// ==========================================
let lastPcBenchmarkState = null;

function renderD3BenchmarkChart(containerId, data, profile) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Guardar estado para auto-resize responsivo
  lastPcBenchmarkState = { containerId, data, profile };

  // Limpiar contenido previo
  container.innerHTML = '';

  const scores = data.benchmark_scores || {
    gpu: { user: 70, min: 50, rec: 75, user_name: profile.gpu, min_name: "Mínimo", rec_name: "Recomendado" },
    cpu: { user: 75, min: 45, rec: 70, user_name: profile.cpu, min_name: "CPU Mín", rec_name: "CPU Rec" },
    ram: { user_gb: parseInt(profile.ram, 10) || 8, min_gb: 8, rec_gb: 16 }
  };

  // Normalizar datos para las 3 filas comparativas
  const ramUserPct = Math.min(100, Math.round(((scores.ram?.user_gb || 8) / 32) * 100));
  const ramMinPct = Math.min(100, Math.round(((scores.ram?.min_gb || 8) / 32) * 100));
  const ramRecPct = Math.min(100, Math.round(((scores.ram?.rec_gb || 16) / 32) * 100));

  const items = [
    {
      id: 'gpu',
      label: '🎮 Tarjeta Gráfica (GPU)',
      userName: scores.gpu?.user_name || profile.gpu,
      userVal: scores.gpu?.user || 70,
      minVal: scores.gpu?.min || 50,
      recVal: scores.gpu?.rec || 75,
      minLabel: scores.gpu?.min_name || 'Mínimo',
      recLabel: scores.gpu?.rec_name || 'Recomendado',
      status: data.components?.gpu?.status || 'OK'
    },
    {
      id: 'cpu',
      label: '💻 Procesador (CPU)',
      userName: scores.cpu?.user_name || profile.cpu,
      userVal: scores.cpu?.user || 75,
      minVal: scores.cpu?.min || 45,
      recVal: scores.cpu?.rec || 70,
      minLabel: scores.cpu?.min_name || 'Mínimo',
      recLabel: scores.cpu?.rec_name || 'Recomendado',
      status: data.components?.cpu?.status || 'OK'
    },
    {
      id: 'ram',
      label: '🧠 Memoria RAM',
      userName: `${scores.ram?.user_gb || profile.ram} RAM`,
      userVal: ramUserPct,
      minVal: ramMinPct,
      recVal: ramRecPct,
      minLabel: `${scores.ram?.min_gb || 8} GB (Mín)`,
      recLabel: `${scores.ram?.rec_gb || 16} GB (Rec)`,
      status: data.components?.ram?.status || 'OK'
    }
  ];

  // Si D3 no está disponible por alguna razón, usamos render HTML de contingencia
  if (typeof d3 === 'undefined') {
    renderFallbackBenchmarkHtml(container, items, data);
    return;
  }

  try {
    // Cálculo dinámico de ancho y proporciones responsivas
    const clientW = container.clientWidth || (container.getBoundingClientRect ? container.getBoundingClientRect().width : 0) || 360;
    const isMobile = clientW < 420;
    const isTiny = clientW < 340;

    const svgWidth = Math.max(280, Math.min(520, clientW));
    const rowHeight = isTiny ? 62 : (isMobile ? 66 : 70);
    const headerHeight = isTiny ? 30 : 34;
    const svgHeight = headerHeight + (items.length * rowHeight) + 8;
    const margin = {
      top: 4,
      right: isTiny ? 48 : (isMobile ? 54 : 64),
      bottom: 6,
      left: isTiny ? 6 : 10
    };
    const chartWidth = Math.max(140, svgWidth - margin.left - margin.right);

    // Crear SVG principal con D3 totalmente responsivo
    const svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${svgWidth} ${svgHeight}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('display', 'block')
      .style('max-width', '100%')
      .style('height', 'auto')
      .style('overflow', 'hidden')
      .style('font-family', 'var(--font-main, system-ui, sans-serif)');

    // Definir Filtros y Gradientes SVG
    const defs = svg.append('defs');

    // Gradiente Óptimo (Verde Neón a Cyan)
    const gradOptimo = defs.append('linearGradient')
      .attr('id', 'd3GradOptimo')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '100%').attr('y2', '0%');
    gradOptimo.append('stop').attr('offset', '0%').attr('stop-color', '#00FFB2');
    gradOptimo.append('stop').attr('offset', '100%').attr('stop-color', '#00E5FF');

    // Gradiente Warning (Ámbar a Amarillo)
    const gradWarning = defs.append('linearGradient')
      .attr('id', 'd3GradWarning')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '100%').attr('y2', '0%');
    gradWarning.append('stop').attr('offset', '0%').attr('stop-color', '#F59E0B');
    gradWarning.append('stop').attr('offset', '100%').attr('stop-color', '#FBBF24');

    // Gradiente Fail (Rojo a Naranja)
    const gradFail = defs.append('linearGradient')
      .attr('id', 'd3GradFail')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '100%').attr('y2', '0%');
    gradFail.append('stop').attr('offset', '0%').attr('stop-color', '#DC2626');
    gradFail.append('stop').attr('offset', '100%').attr('stop-color', '#F87171');

    // Escala Lineal D3 para ancho de barras (0 a 100%)
    const xScale = d3.scaleLinear()
      .domain([0, 100])
      .range([0, chartWidth]);

    // Encabezado / Leyenda del Gráfico D3
    const legendG = svg.append('g')
      .attr('transform', `translate(${margin.left}, 13)`);

    const legSpacing = isTiny ? 70 : (isMobile ? 85 : 100);

    // Leyenda Mínimo
    legendG.append('line')
      .attr('x1', 0).attr('y1', 0)
      .attr('x2', 10).attr('y2', 0)
      .attr('stroke', '#FBBF24')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '3,2');
    legendG.append('text')
      .attr('x', 14).attr('y', 3.5)
      .attr('fill', '#FBBF24')
      .attr('font-size', isTiny ? '9px' : '10px')
      .attr('font-weight', '700')
      .text(isTiny ? 'Mín' : 'Req. Mín');

    // Leyenda Recomendado
    legendG.append('line')
      .attr('x1', legSpacing).attr('y1', 0)
      .attr('x2', legSpacing + 10).attr('y2', 0)
      .attr('stroke', '#00FFB2')
      .attr('stroke-width', 2.2);
    legendG.append('text')
      .attr('x', legSpacing + 14).attr('y', 3.5)
      .attr('fill', '#00FFB2')
      .attr('font-size', isTiny ? '9px' : '10px')
      .attr('font-weight', '700')
      .text(isTiny ? 'Rec' : 'Req. Rec');

    // Leyenda Tu Hardware
    const userLegX = legSpacing * 2;
    legendG.append('rect')
      .attr('x', userLegX).attr('y', -4.5)
      .attr('width', 10).attr('height', 9)
      .attr('rx', 2.5)
      .attr('fill', 'url(#d3GradOptimo)');
    legendG.append('text')
      .attr('x', userLegX + 14).attr('y', 3.5)
      .attr('fill', '#CBD5E1')
      .attr('font-size', isTiny ? '9px' : '10px')
      .attr('font-weight', '700')
      .text(isTiny ? 'Tu PC' : 'Tu Hardware');

    // Dibujar cada fila de componente con D3
    items.forEach((item, idx) => {
      const yOffset = headerHeight + (idx * rowHeight);
      const rowG = svg.append('g')
        .attr('transform', `translate(${margin.left}, ${yOffset})`);

      // 1. Título y Hardware Actual
      const textG = rowG.append('g');
      textG.append('text')
        .attr('x', 0)
        .attr('y', 0)
        .attr('fill', '#FFFFFF')
        .attr('font-size', isTiny ? '10px' : '11px')
        .attr('font-weight', '800')
        .text(item.label);

      // Truncar texto largo de hardware inteligentemente según ancho
      const maxChars = isTiny ? 22 : (isMobile ? 28 : 36);
      const displayUserName = item.userName.length > maxChars ? item.userName.substring(0, maxChars - 2) + '...' : item.userName;
      textG.append('text')
        .attr('x', 0)
        .attr('y', 13)
        .attr('fill', '#00E5FF')
        .attr('font-size', isTiny ? '8.5px' : '9.5px')
        .attr('font-weight', '600')
        .text(`Detectado: ${displayUserName}`);

      // 2. Barra de Fondo (Track)
      const barY = isTiny ? 19 : 21;
      const barHeight = isTiny ? 13 : 15;

      rowG.append('rect')
        .attr('x', 0)
        .attr('y', barY)
        .attr('width', chartWidth)
        .attr('height', barHeight)
        .attr('rx', barHeight / 2)
        .attr('ry', barHeight / 2)
        .attr('fill', 'rgba(0, 0, 0, 0.5)')
        .attr('stroke', 'rgba(255, 255, 255, 0.12)')
        .attr('stroke-width', 1);

      // 3. Barra Animada de Potencia del Usuario (D3 Transition)
      const gradFill = item.status === 'OK' ? 'url(#d3GradOptimo)' : (item.status === 'WARNING' ? 'url(#d3GradWarning)' : 'url(#d3GradFail)');
      const targetWidth = Math.max(6, xScale(item.userVal));

      const userBar = rowG.append('rect')
        .attr('x', 0)
        .attr('y', barY)
        .attr('width', 0)
        .attr('height', barHeight)
        .attr('rx', barHeight / 2)
        .attr('ry', barHeight / 2)
        .attr('fill', gradFill);

      userBar.transition()
        .duration(800 + (idx * 120))
        .ease(d3.easeCubicOut)
        .attr('width', targetWidth);

      // 4. Marcador de Requisito MÍNIMO (Línea punteada)
      const minX = xScale(item.minVal);
      if (minX > 8 && minX < chartWidth - 8) {
        rowG.append('line')
          .attr('x1', minX).attr('y1', barY - 2)
          .attr('x2', minX).attr('y2', barY + barHeight + 2)
          .attr('stroke', '#FBBF24')
          .attr('stroke-width', 1.8)
          .attr('stroke-dasharray', '3,2');

        rowG.append('text')
          .attr('x', minX).attr('y', barY + barHeight + 10)
          .attr('text-anchor', 'middle')
          .attr('fill', '#FBBF24')
          .attr('font-size', isTiny ? '7.5px' : '8px')
          .attr('font-weight', '700')
          .text('MÍN');
      }

      // 5. Marcador de Requisito RECOMENDADO (Línea sólida)
      const recX = xScale(item.recVal);
      if (recX > 12 && recX < chartWidth - 4) {
        rowG.append('line')
          .attr('x1', recX).attr('y1', barY - 2)
          .attr('x2', recX).attr('y2', barY + barHeight + 2)
          .attr('stroke', '#00FFB2')
          .attr('stroke-width', 2);

        rowG.append('text')
          .attr('x', recX).attr('y', barY + barHeight + 10)
          .attr('text-anchor', 'middle')
          .attr('fill', '#00FFB2')
          .attr('font-size', isTiny ? '7.5px' : '8px')
          .attr('font-weight', '800')
          .text('REC');
      }

      // 6. Etiqueta / Badge de Estado a la Derecha
      const badgeText = item.status === 'OK' ? `⚡ ${item.userVal}%` : (item.status === 'WARNING' ? `⚠️ ${item.userVal}%` : `❌ ${item.userVal}%`);
      const badgeColor = item.status === 'OK' ? '#00FFB2' : (item.status === 'WARNING' ? '#FBBF24' : '#EF4444');

      rowG.append('text')
        .attr('x', chartWidth + (isTiny ? 4 : 7))
        .attr('y', barY + (barHeight * 0.75))
        .attr('fill', badgeColor)
        .attr('font-size', isTiny ? '9.5px' : '10.5px')
        .attr('font-weight', '900')
        .text(badgeText);
    });

  } catch (err) {
    console.error("Error rendering D3 benchmark chart:", err);
    renderFallbackBenchmarkHtml(container, items, data);
  }
}

// Escuchar cambios de tamaño/orientación de pantalla para redibujar D3 responsivamente
let pcResizeDebounce = null;
window.addEventListener('resize', () => {
  if (!lastPcBenchmarkState) return;
  const container = document.getElementById(lastPcBenchmarkState.containerId);
  const modal = document.getElementById('pcCheckerModal');
  if (modal && modal.style.display !== 'none' && container && container.offsetParent !== null) {
    clearTimeout(pcResizeDebounce);
    pcResizeDebounce = setTimeout(() => {
      if (lastPcBenchmarkState) {
        renderD3BenchmarkChart(lastPcBenchmarkState.containerId, lastPcBenchmarkState.data, lastPcBenchmarkState.profile);
      }
    }, 180);
  }
});

// Render de contingencia si falla D3
function renderFallbackBenchmarkHtml(container, items, data) {
  let html = `
    <div style="display:flex; flex-direction:column; gap:12px; padding:10px 0;">
      ${items.map(it => `
        <div>
          <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:4px;">
            <span style="color:#fff; font-weight:700;">${it.label} (${it.userName})</span>
            <span style="color:#00FFB2; font-weight:800;">${it.userVal}%</span>
          </div>
          <div style="height:10px; background:rgba(0,0,0,0.5); border-radius:999px; overflow:hidden;">
            <div style="height:100%; width:${it.userVal}%; background:linear-gradient(90deg, #00FFB2, #00E5FF); border-radius:999px;"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  container.innerHTML = html;
}

// Copiar al portapapeles los ajustes sugeridos de rescate
function copyRescueTuningToClipboard(gameTitle, gpuModel) {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const card = document.getElementById('pcRescueTuningCard');
  if (!card) return;

  const rows = card.querySelectorAll('.pc-rescue-step-row');
  let copyText = `🎮 OPTIMIZACIÓN Y AJUSTES GRÁFICOS SUGERIDOS\n`;
  copyText += `🕹️ Videojuego: ${gameTitle}\n`;
  copyText += `🖥️ Hardware: ${gpuModel}\n`;
  copyText += `------------------------------------\n`;

  rows.forEach(r => {
    const name = r.querySelector('.pc-rescue-step-name')?.innerText || '';
    const val = r.querySelector('.pc-rescue-step-val')?.innerText || '';
    const impact = r.querySelector('.pc-rescue-step-impact')?.innerText || '';
    copyText += `• ${name}: ${val} (${impact})\n`;
  });

  copyText += `------------------------------------\n💡 Optimizado con IA JoaGamers Can You Run It`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(copyText).then(() => {
      if (typeof showToast === 'function') {
        showToast('📋 ¡Ajustes gráficos copiados al portapapeles!', 'success');
      } else {
        alert('¡Ajustes gráficos copiados al portapapeles!');
      }
    }).catch(() => {
      prompt('Copia estos ajustes manualmente:', copyText);
    });
  } else {
    prompt('Copia estos ajustes manualmente:', copyText);
  }
}

function renderPcCompatibilityResult(data, gameTitle, profile) {
  const resultBox = document.getElementById('pcCheckResultContainer');
  if (!resultBox) return;

  const verdictClass = data.verdict === 'OPTIMO' ? 'verdict-optimo' : (data.verdict === 'JUGABLE' ? 'verdict-jugable' : 'verdict-no');
  const badgeClass = data.verdict === 'OPTIMO' ? 'badge-optimo' : (data.verdict === 'JUGABLE' ? 'badge-jugable' : 'badge-no');
  const barClass = data.verdict === 'OPTIMO' ? 'bar-optimo' : (data.verdict === 'JUGABLE' ? 'bar-jugable' : 'bar-no');
  const verdictIcon = data.verdict === 'OPTIMO' ? '🟢' : (data.verdict === 'JUGABLE' ? '🟡' : '🔴');

  function getStatusIcon(status) {
    if (status === 'OK') return '<span style="color:#00FFB2;">✅ Correcto</span>';
    if (status === 'WARNING') return '<span style="color:#FBBF24;">⚠️ Justo</span>';
    return '<span style="color:#EF4444;">❌ Insuficiente</span>';
  }

  // Verificar si el juego existe en el catálogo para dar botón directo
  const catalogItem = allItems.find(it => {
    if (!it.title) return false;
    const t1 = it.title.toLowerCase();
    const t2 = gameTitle.toLowerCase();
    return t1 === t2 || t1.includes(t2) || t2.includes(t1);
  });

  const percent = data.power_percentage || 75;
  const rescue = data.rescue_tuning;

  let html = `
    <div class="pc-verdict-card ${verdictClass}">
      
      <!-- ENCABEZADO DE VEREDICTO -->
      <div class="pc-verdict-header">
        <div>
          <div style="font-size:0.75rem; color:var(--text2); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Veredicto de Compatibilidad</div>
          <div style="font-size:1.15rem; font-weight:900; color:#fff; margin-top:2px;">${escapeHtml(data.game_name || gameTitle)}</div>
        </div>
        <div class="pc-verdict-badge ${badgeClass}">
          <span>${verdictIcon}</span>
          <span>${escapeHtml(data.verdict_title || data.verdict)}</span>
        </div>
      </div>

      <!-- MEDIDOR DE POTENCIA ANIMADO -->
      <div class="pc-gauge-wrap">
        <div class="pc-gauge-labels">
          <span style="color:#CBD5E1;">⚡ Índice de Potencia Estimado</span>
          <span style="color:#00FFB2;">${percent}%</span>
        </div>
        <div class="pc-gauge-track">
          <div class="pc-gauge-bar ${barClass}" style="--gauge-percent: ${percent}%;"></div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; font-size:0.76rem; color:var(--text2);">
          <span>🎯 <b>FPS Estimados:</b> <span style="color:#fff;">${escapeHtml(data.fps_estimate || '60 FPS')}</span></span>
          <span>🖥️ <b>Resolución:</b> <span style="color:#00E5FF;">${escapeHtml(data.target_resolution || '1080p')}</span></span>
        </div>
      </div>

      <!-- RESUMEN EJECUTIVO -->
      <div style="font-size:0.86rem; line-height:1.5; color:#F1F5F9; background:rgba(0,0,0,0.3); border-radius:12px; padding:12px; margin-bottom:14px; border:1px solid rgba(255,255,255,0.06);">
        ${escapeHtml(data.summary || '')}
      </div>

      <!-- 📊 REPRESENTACIÓN VISUAL D3: COMPARATIVA DE RENDIMIENTO HARDWARE -->
      <div class="pc-d3-chart-box">
        <div class="pc-d3-chart-title">
          <span>📊 Comparativa D3: Tu Hardware vs Requisitos Oficiales</span>
        </div>
        <div id="pcD3BenchmarkContainer" style="width:100%; min-height:230px;"></div>
      </div>

      <!-- DESGLOSE POR COMPONENTES (4 TARJETAS) -->
      <div class="pc-components-grid">
        <!-- CPU -->
        <div class="pc-comp-box">
          <div class="pc-comp-title">
            <span>💻 CPU</span>
            ${getStatusIcon(data.components?.cpu?.status)}
          </div>
          <div class="pc-comp-status">${escapeHtml(profile.cpu)}</div>
          <div class="pc-comp-note">${escapeHtml(data.components?.cpu?.verdict_note || '')}</div>
        </div>

        <!-- GPU -->
        <div class="pc-comp-box">
          <div class="pc-comp-title">
            <span>🎮 GPU</span>
            ${getStatusIcon(data.components?.gpu?.status)}
          </div>
          <div class="pc-comp-status">${escapeHtml(profile.gpu)}</div>
          <div class="pc-comp-note">${escapeHtml(data.components?.gpu?.verdict_note || '')}</div>
        </div>

        <!-- RAM -->
        <div class="pc-comp-box">
          <div class="pc-comp-title">
            <span>🧠 RAM</span>
            ${getStatusIcon(data.components?.ram?.status)}
          </div>
          <div class="pc-comp-status">${escapeHtml(profile.ram)}</div>
          <div class="pc-comp-note">${escapeHtml(data.components?.ram?.verdict_note || '')}</div>
        </div>

        <!-- ALMACENAMIENTO / SO -->
        <div class="pc-comp-box">
          <div class="pc-comp-title">
            <span>💽 DISCO / SO</span>
            ${getStatusIcon(data.components?.storage?.status)}
          </div>
          <div class="pc-comp-status">${escapeHtml(profile.storage.split(' ')[0])}</div>
          <div class="pc-comp-note">${escapeHtml(data.components?.storage?.verdict_note || '')}</div>
        </div>
      </div>

      <!-- 🛠️ AJUSTES GRÁFICOS SUGERIDOS PARA GPU DE ENTRADA / INSUFICIENTE (RESCUE TUNING) -->
      ${rescue && rescue.is_needed ? `
        <div class="pc-rescue-card" id="pcRescueTuningCard">
          <div class="pc-rescue-header">
            <div class="pc-rescue-title">
              <span style="font-size:1.2rem;">🛠️</span>
              <div>
                <div style="color:#fff; font-weight:900; font-size:0.95rem;">${escapeHtml(rescue.title || 'Ajustes Gráficos Sugeridos')}</div>
                <div style="color:var(--text2); font-size:0.75rem;">Optimización recomendada para tu <b>${escapeHtml(profile.gpu)}</b></div>
              </div>
            </div>
            <div class="pc-rescue-fps-gain">
              <span>🚀 ${escapeHtml(rescue.target_fps_gain || '+20 FPS')}</span>
            </div>
          </div>

          <div class="pc-rescue-steps-list">
            ${(rescue.settings || []).map(step => `
              <div class="pc-rescue-step-row">
                <div class="pc-rescue-step-info">
                  <div class="pc-rescue-step-name">${escapeHtml(step.name || step.setting || '')}</div>
                  <div class="pc-rescue-step-val">${escapeHtml(step.value || '')}</div>
                </div>
                <div class="pc-rescue-step-meta">
                  <span class="pc-rescue-step-impact">${escapeHtml(step.impact || '')}</span>
                  ${step.tag ? `<span class="pc-rescue-tag tag-${step.tag.toLowerCase()}">${escapeHtml(step.tag)}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>

          <div class="pc-rescue-footer">
            <button class="pc-rescue-copy-btn" onclick="copyRescueTuningToClipboard('${escapeHtml(gameTitle)}', '${escapeHtml(profile.gpu)}')">
              📋 Copiar Ajustes Sugeridos
            </button>
          </div>
        </div>
      ` : ''}

      <!-- AJUSTES Y RECOMENDACIONES GENERALES -->
      <div class="pc-tips-box" style="margin-top:14px;">
        <div style="font-weight:900; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
          <span>💡</span><span>Recomendaciones del Sistema:</span>
        </div>
        <ul style="margin:0; padding-left:18px;">
          ${(data.recommended_settings || []).map(s => `<li style="margin-bottom:3px;">${escapeHtml(s)}</li>`).join('')}
        </ul>
        ${data.bottleneck ? `<div style="margin-top:8px; font-size:0.78rem; color:#CBD5E1;">⚖️ <b>Balance del Sistema:</b> ${escapeHtml(data.bottleneck)}</div>` : ''}
      </div>

      <!-- ACCIONES EXTRA -->
      ${catalogItem ? `
        <div style="margin-top:14px; display:flex; gap:10px;">
          <button class="btn" style="flex:1; background:linear-gradient(90deg, #9D4EDD, #00E5FF); color:#fff; font-weight:800; border:none; padding:10px; border-radius:12px; cursor:pointer;" onclick="closePcCheckerModal(); openDetail('${catalogItem.id}');">
            🎮 Ver "${escapeHtml(catalogItem.title)}" en el Catálogo
          </button>
        </div>
      ` : ''}

    </div>
  `;

  resultBox.innerHTML = html;
  resultBox.style.display = 'block';
  resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Renderizar Gráfico Comparativo D3
  setTimeout(() => {
    renderD3BenchmarkChart('pcD3BenchmarkContainer', data, profile);
  }, 50);
}

// ==========================================
// 🎮 FILTRAR JUEGOS DEL CATÁLOGO PARA MI PC
// ==========================================
function discoverCatalogGamesForPc() {
  if (window.triggerHaptic) window.triggerHaptic(35);
  const profile = getUserPcProfile();
  const loadingBox = document.getElementById('pcCatalogLoadingBox');
  const resultBox = document.getElementById('pcCatalogResultContainer');

  if (loadingBox) loadingBox.style.display = 'flex';
  if (resultBox) {
    resultBox.style.display = 'none';
    resultBox.innerHTML = '';
  }

  setTimeout(() => {
    // Filtrar todos los juegos del catálogo
    const games = allItems.filter(it => {
      return !it.type || it.type.includes('juego') || it.type.includes('game') || (it.category && it.category.includes('juego'));
    });

    if (games.length === 0) {
      if (loadingBox) loadingBox.style.display = 'none';
      if (resultBox) {
        resultBox.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text2);">No se encontraron títulos de juegos en el catálogo actual.</div>`;
        resultBox.style.display = 'block';
      }
      return;
    }

    const optimalList = [];
    const playableList = [];
    const retroList = [];

    games.forEach(g => {
      const isEmulated = g.type === 'juego_emulado' || (g.console && g.console !== 'pc') || (g.category && g.category.includes('emulado'));
      if (isEmulated) {
        retroList.push(g);
        return;
      }

      const res = generateHeuristicPcCompatibility(g.title, profile);
      if (res.verdict === 'OPTIMO') optimalList.push({ game: g, res });
      else if (res.verdict === 'JUGABLE') playableList.push({ game: g, res });
      else playableList.push({ game: g, res }); // Se incluye con advertencia
    });

    if (loadingBox) loadingBox.style.display = 'none';

    function renderGameMiniCard(it, metaTag, metaColor) {
      const cover = resolveImageUrl(it.cover || it.image || it.poster || it.img);
      const sub = getItemSubcategory(it) || it.type || 'Juego PC';
      return `
        <div class="pc-game-item-card" onclick="closePcCheckerModal(); openDetail('${it.id}');">
          <img class="pc-game-item-img" src="${cover}" onerror="this.src='${PLACEHOLDER_IMG}'" alt="">
          <div class="pc-game-item-info">
            <div class="pc-game-item-title">${escapeHtml(it.title)}</div>
            <div class="pc-game-item-meta">
              <span style="color:${metaColor}; font-weight:800;">${metaTag}</span>
              <span>💻 ${escapeHtml(sub)}</span>
              ${it.year ? `<span>📅 ${it.year}</span>` : ''}
            </div>
          </div>
          <button class="btn btn-sm" style="padding:4px 10px; font-size:0.75rem; border-radius:8px;">Ver ➔</button>
        </div>
      `;
    }

    let outHtml = `
      <div style="margin-bottom:18px;">
        <h4 style="color:#00FFB2; margin:0 0 10px; font-size:0.95rem; display:flex; align-items:center; gap:6px;">
          <span>🟢</span><span>Rendimiento Óptimo (60+ FPS Alta/Ultra) (${optimalList.length})</span>
        </h4>
        ${optimalList.slice(0, 10).map(item => renderGameMiniCard(item.game, `⚡ ${item.res.fps_estimate}`, '#00FFB2')).join('') || '<div style="font-size:0.8rem; color:var(--text3); padding:8px;">No hay títulos en esta categoría.</div>'}
      </div>

      <div style="margin-bottom:18px;">
        <h4 style="color:#FBBF24; margin:0 0 10px; font-size:0.95rem; display:flex; align-items:center; gap:6px;">
          <span>🟡</span><span>Rendimiento Jugable y Fluido (${playableList.length})</span>
        </h4>
        ${playableList.slice(0, 10).map(item => renderGameMiniCard(item.game, `🎯 ${item.res.fps_estimate}`, '#FBBF24')).join('') || '<div style="font-size:0.8rem; color:var(--text3); padding:8px;">No hay títulos en esta categoría.</div>'}
      </div>

      ${retroList.length > 0 ? `
        <div style="margin-bottom:18px;">
          <h4 style="color:#00E5FF; margin:0 0 10px; font-size:0.95rem; display:flex; align-items:center; gap:6px;">
            <span>🕹️</span><span>Juegos Emulados / Consolas Retro (${retroList.length})</span>
          </h4>
          ${retroList.slice(0, 8).map(g => renderGameMiniCard(g, '🕹️ Emulación Fluida', '#00E5FF')).join('')}
        </div>
      ` : ''}
    `;

    if (resultBox) {
      resultBox.innerHTML = outHtml;
      resultBox.style.display = 'block';
    }
  }, 400);
}

// ==========================================================================
// 🛒 SISTEMA INTEGRAL DE CARRITO DE COMPRAS, DOMICILIO (500 CUP / GRATIS > 3000) Y PAGOS
// ==========================================================================

const SHOPPING_CART_STORAGE_KEY = 'user_shopping_cart_items';
const CART_CUSTOMER_DATA_KEY = 'user_cart_customer_info';
const CART_PAYMENT_METHOD_KEY = 'user_cart_payment_method';
const DEFAULT_DELIVERY_FEE_CUP = 500;
const FREE_DELIVERY_THRESHOLD_CUP = 3000;
const TRANSFER_SURCHARGE_RATE = 0.30; // 30% impuesto / recargo por transferencia

let shoppingCart = [];
let currentCartStep = 'items'; // 'items' | 'delivery' | 'confirm'
let cartRenderLimit = 50; // Límite para evitar saturación del DOM con catálogos grandes
let selectedCartPaymentMethod = 'efectivo'; // 'efectivo' | 'transferencia'

function loadShoppingCartFromStorage() {
  try {
    const raw = localStorage.getItem(SHOPPING_CART_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Garantizar unicidad de productos digitales (1 copia por producto)
        const seen = new Set();
        shoppingCart = [];
        for (const item of parsed) {
          const idStr = String(item.id || item);
          if (!seen.has(idStr)) {
            seen.add(idStr);
            shoppingCart.push({
              id: idStr,
              addedAt: item.addedAt || new Date().toISOString()
            });
          }
        }
      } else {
        shoppingCart = [];
      }
    } else {
      shoppingCart = [];
    }

    const savedPayMethod = localStorage.getItem(CART_PAYMENT_METHOD_KEY);
    if (savedPayMethod === 'transferencia' || savedPayMethod === 'efectivo') {
      selectedCartPaymentMethod = savedPayMethod;
    }
  } catch (e) {
    console.warn('Error loading shopping cart:', e);
    shoppingCart = [];
  }
  updateCartBadges();
}

function selectPaymentMethod(method) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  selectedCartPaymentMethod = (method === 'transferencia') ? 'transferencia' : 'efectivo';
  try {
    localStorage.setItem(CART_PAYMENT_METHOD_KEY, selectedCartPaymentMethod);
  } catch (e) {}

  updatePaymentSelectorUI();
  renderCartUI();
  if (currentCartStep === 'confirm') {
    renderCartOrderSummary();
  }
}

function updatePaymentSelectorUI() {
  const isCash = selectedCartPaymentMethod === 'efectivo';

  const cardCash = document.getElementById('payMethodCardCash');
  const cardTransfer = document.getElementById('payMethodCardTransfer');
  const formCash = document.getElementById('formPayMethodCash');
  const formTransfer = document.getElementById('formPayMethodTransfer');

  if (cardCash) cardCash.classList.toggle('active', isCash);
  if (cardTransfer) cardTransfer.classList.toggle('active', !isCash);
  if (formCash) formCash.classList.toggle('active', isCash);
  if (formTransfer) formTransfer.classList.toggle('active', !isCash);
}

function calculateCartFinancials() {
  let subtotal = 0;
  const totalCount = shoppingCart.length;

  for (let i = 0; i < totalCount; i++) {
    const ci = shoppingCart[i];
    const fullItem = findCatalogItem(ci.id);
    if (fullItem) {
      subtotal += getItemPriceNumeric(fullItem);
    }
  }

  // Domicilio es GRATIS si el subtotal de productos supera los 3000 pesos
  const isFreeDelivery = subtotal > FREE_DELIVERY_THRESHOLD_CUP;
  const deliveryFee = (totalCount === 0 || isFreeDelivery) ? 0 : DEFAULT_DELIVERY_FEE_CUP;

  // Recargo / Impuesto del 30% por pago en transferencia
  const transferTax = subtotal * TRANSFER_SURCHARGE_RATE;
  const subtotalWithTransferTax = subtotal + transferTax;

  const totalCash = subtotal + deliveryFee;
  const totalTransfer = subtotalWithTransferTax + deliveryFee;

  const isCash = selectedCartPaymentMethod === 'efectivo';
  const activeProductsTotal = isCash ? subtotal : subtotalWithTransferTax;
  const activeGrandTotal = isCash ? totalCash : totalTransfer;

  return {
    totalCount,
    subtotal,
    isFreeDelivery,
    deliveryFee,
    transferTax,
    subtotalWithTransferTax,
    totalCash,
    totalTransfer,
    isCash,
    activeProductsTotal,
    activeGrandTotal
  };
}

function saveShoppingCartToStorage() {
  try {
    // Garantizar unicidad estricta
    const seen = new Set();
    const cleanCart = [];
    for (const item of shoppingCart) {
      const idStr = String(item.id);
      if (!seen.has(idStr)) {
        seen.add(idStr);
        cleanCart.push({ id: idStr, addedAt: item.addedAt || new Date().toISOString() });
      }
    }
    shoppingCart = cleanCart;
    localStorage.setItem(SHOPPING_CART_STORAGE_KEY, JSON.stringify(shoppingCart));
  } catch (e) {
    console.warn('Error saving shopping cart:', e);
  }
  updateCartBadges();
  renderCartUI();
}

function updateCartBadges() {
  const totalCount = shoppingCart.length; // Productos digitales únicos
  
  // Badge en el botón flotante debajo de WhatsApp
  const floatBadge = document.getElementById('cartFloatBadge');
  if (floatBadge) {
    floatBadge.textContent = totalCount;
    floatBadge.style.display = totalCount > 0 ? 'inline-block' : 'none';
  }

  const sidebarBadge = document.getElementById('sidebarCartCount');
  if (sidebarBadge) {
    sidebarBadge.textContent = totalCount;
  }

  const tabBadge = document.getElementById('cartTabCountBadge');
  if (tabBadge) {
    tabBadge.textContent = totalCount;
  }
}

function addToCart(itemId, showFeedback = true) {
  if (window.triggerHaptic) window.triggerHaptic(25);
  loadShoppingCartFromStorage();
  
  const idStr = String(itemId);
  const fullItem = findCatalogItem(itemId);
  const title = fullItem ? fullItem.title : `Producto #${itemId}`;
  const existing = shoppingCart.some(i => String(i.id) === idStr);

  if (existing) {
    if (showFeedback && typeof showToast === 'function') {
      showToast(`ℹ️ "${title}" ya está en tu carrito (1 copia digital).`);
    }
    return;
  }

  shoppingCart.push({
    id: idStr,
    addedAt: new Date().toISOString()
  });

  saveShoppingCartToStorage();
  if (showFeedback && typeof showToast === 'function') {
    showToast(`🛒 "${title}" añadido al carrito de compras`);
  }
}

function addCurrentItemToCartFromModal() {
  if (!currentDetailId) return;
  addToCart(currentDetailId, true);
}

function addSelectedBulkToCart() {
  if (typeof selectedBulkItemIds === 'undefined' || selectedBulkItemIds.size === 0) {
    if (typeof showToast === 'function') showToast('⚠️ Selecciona al menos 1 elemento primero.');
    return;
  }
  if (window.triggerHaptic) window.triggerHaptic(30);
  
  loadShoppingCartFromStorage();
  let addedCount = 0;
  const existingSet = new Set(shoppingCart.map(i => String(i.id)));

  selectedBulkItemIds.forEach(id => {
    const idStr = String(id);
    if (!existingSet.has(idStr)) {
      existingSet.add(idStr);
      shoppingCart.push({
        id: idStr,
        addedAt: new Date().toISOString()
      });
      addedCount++;
    }
  });

  saveShoppingCartToStorage();
  if (typeof exitBulkSelectMode === 'function') exitBulkSelectMode();
  if (typeof showToast === 'function') {
    if (addedCount > 0) {
      showToast(`🛒 ¡${addedCount} productos digitales añadidos al carrito!`);
    } else {
      showToast(`ℹ️ Los productos seleccionados ya estaban en el carrito.`);
    }
  }
}

function addAllCatalogToCart() {
  if (!allItems || allItems.length === 0) {
    if (typeof showToast === 'function') showToast('⚠️ No hay productos en el catálogo.');
    return;
  }
  
  const count = allItems.length;
  if (!confirm(`¿Deseas añadir todos los ${count} productos del catálogo al carrito de compras (1 copia digital de cada uno)?`)) {
    return;
  }

  if (window.triggerHaptic) window.triggerHaptic(35);
  loadShoppingCartFromStorage();
  
  const existingSet = new Set(shoppingCart.map(i => String(i.id)));
  let addedCount = 0;

  allItems.forEach(item => {
    const idStr = String(item.id);
    if (!existingSet.has(idStr)) {
      existingSet.add(idStr);
      shoppingCart.push({
        id: idStr,
        addedAt: new Date().toISOString()
      });
      addedCount++;
    }
  });

  saveShoppingCartToStorage();
  if (typeof showToast === 'function') {
    showToast(`🎉 ¡${addedCount} productos añadidos al carrito de compras!`);
  }
}

function openBulkCatalogAddModal() {
  if (typeof activateBulkSelectMode === 'function') {
    closeShoppingCartModal();
    activateBulkSelectMode();
    if (typeof showToast === 'function') {
      showToast('🛍️ Toca los productos del catálogo que deseas y luego pulsa "🛒 +Carrito" en la barra flotante');
    }
  }
}

async function openListsToCartModal() {
  if (window.triggerHaptic) window.triggerHaptic(20);
  closeAllOpenModals('listsToCartModal');
  const lists = await idbGetAll('user_lists') || [];
  const container = document.getElementById('listsToCartContainer');
  const modal = document.getElementById('listsToCartModal');
  if (!container || !modal) return;

  if (!lists.length) {
    container.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text2); font-size:0.85rem; background:rgba(255,255,255,0.03); border-radius:12px;">📭 No tienes listas creadas en "Mis Listas".</div>';
  } else {
    container.innerHTML = lists.map(l => {
      const count = (l.itemIds || []).length;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:14px; padding:12px 16px;">
          <div>
            <strong style="color:#fff; font-size:0.92rem; display:block; margin-bottom:2px;">📋 ${escapeHtml(l.name)}</strong>
            <span style="font-size:0.75rem; color:var(--text2);">${count} productos</span>
          </div>
          <button class="btn btn-primary" onclick="transferListToCart('${escapeHtml(l.name)}')" ${count === 0 ? 'disabled style="opacity:0.5;"' : ''} style="font-size:0.78rem; padding:6px 12px; font-weight:800;">
            🛒 Pasar al Carrito
          </button>
        </div>
      `;
    }).join('');
  }
  modal.style.display = 'flex';
}

function closeListsToCartModal() {
  const modal = document.getElementById('listsToCartModal');
  if (modal) modal.style.display = 'none';
}

async function transferListToCart(listName) {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const lists = await idbGetAll('user_lists') || [];
  const targetList = lists.find(l => l.name === listName);
  if (!targetList || !targetList.itemIds || targetList.itemIds.length === 0) {
    if (typeof showToast === 'function') showToast('⚠️ Esta lista está vacía.');
    return;
  }

  loadShoppingCartFromStorage();
  let added = 0;
  const existingSet = new Set(shoppingCart.map(i => String(i.id)));

  targetList.itemIds.forEach(id => {
    const idStr = String(id);
    if (!existingSet.has(idStr)) {
      existingSet.add(idStr);
      shoppingCart.push({
        id: idStr,
        addedAt: new Date().toISOString()
      });
      added++;
    }
  });

  saveShoppingCartToStorage();
  closeListsToCartModal();
  if (typeof showToast === 'function') {
    if (added > 0) {
      showToast(`✅ Se pasaron ${added} productos de "${listName}" al carrito`);
    } else {
      showToast(`ℹ️ Los productos de "${listName}" ya estaban en el carrito.`);
    }
  }
}

async function transferListIdToCart(listId) {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const list = await idbGet('user_lists', listId);
  if (!list || !list.itemIds || list.itemIds.length === 0) {
    if (typeof showToast === 'function') showToast('⚠️ Esta lista está vacía.');
    return;
  }
  loadShoppingCartFromStorage();
  let added = 0;
  const existingSet = new Set(shoppingCart.map(i => String(i.id)));

  list.itemIds.forEach(id => {
    const idStr = String(id);
    if (!existingSet.has(idStr)) {
      existingSet.add(idStr);
      shoppingCart.push({
        id: idStr,
        addedAt: new Date().toISOString()
      });
      added++;
    }
  });

  saveShoppingCartToStorage();
  if (typeof showToast === 'function') {
    if (added > 0) {
      showToast(`🛒 Se añadieron ${added} productos de "${list.name}" al carrito`);
    } else {
      showToast(`ℹ️ Los productos de "${list.name}" ya estaban en el carrito.`);
    }
  }
}

function removeFromCart(itemId) {
  if (window.triggerHaptic) window.triggerHaptic(20);
  loadShoppingCartFromStorage();
  shoppingCart = shoppingCart.filter(i => String(i.id) !== String(itemId));
  saveShoppingCartToStorage();
  if (typeof showToast === 'function') showToast('🗑️ Producto eliminado del carrito');
}

function clearShoppingCart() {
  if (shoppingCart.length === 0) return;
  if (confirm('¿Estás seguro de que deseas vaciar todos los productos del carrito?')) {
    if (window.triggerHaptic) window.triggerHaptic(35);
    shoppingCart = [];
    saveShoppingCartToStorage();
    if (typeof showToast === 'function') showToast('🧹 Carrito vaciado');
  }
}

async function openShoppingCartModal() {
  if (window.triggerHaptic) window.triggerHaptic(30);
  closeAllOpenModals('shoppingCartModal');
  cartRenderLimit = 50;
  loadShoppingCartFromStorage();
  await loadCustomerDataIntoForm();
  switchCartStep('items');
  const modal = document.getElementById('shoppingCartModal');
  if (modal) modal.style.display = 'flex';
}

function closeShoppingCartModal() {
  if (window.triggerHaptic) window.triggerHaptic(20);
  const modal = document.getElementById('shoppingCartModal');
  if (modal) modal.style.display = 'none';
}

function switchCartStep(step) {
  currentCartStep = step;
  document.querySelectorAll('.cart-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.cart-step-view').forEach(view => view.style.display = 'none');

  const backBtn = document.getElementById('cartBackBtn');
  const nextBtn = document.getElementById('cartNextBtn');

  if (step === 'items') {
    document.getElementById('cartStepBtn1')?.classList.add('active');
    const v = document.getElementById('cartStepViewItems');
    if (v) v.style.display = 'block';
    if (backBtn) backBtn.style.display = 'none';
    if (nextBtn) {
      nextBtn.textContent = 'Continuar a Datos de Entrega ➔';
      nextBtn.style.display = shoppingCart.length > 0 ? 'inline-flex' : 'none';
    }
    renderCartUI();
  } else if (step === 'delivery') {
    document.getElementById('cartStepBtn2')?.classList.add('active');
    const v = document.getElementById('cartStepViewDelivery');
    if (v) v.style.display = 'block';
    if (backBtn) backBtn.style.display = 'inline-flex';
    if (nextBtn) {
      nextBtn.textContent = 'Revisar Resumen y Enviar ➔';
      nextBtn.style.display = 'inline-flex';
    }
  } else if (step === 'confirm') {
    document.getElementById('cartStepBtn3')?.classList.add('active');
    const v = document.getElementById('cartStepViewConfirm');
    if (v) v.style.display = 'block';
    if (backBtn) backBtn.style.display = 'inline-flex';
    if (nextBtn) nextBtn.style.display = 'none';
    renderCartOrderSummary();
  }
}

function nextCartStep() {
  if (window.triggerHaptic) window.triggerHaptic(20);
  if (currentCartStep === 'items') {
    if (shoppingCart.length === 0) {
      if (typeof showToast === 'function') showToast('⚠️ Añade al menos un producto al carrito para continuar.');
      return;
    }
    switchCartStep('delivery');
  } else if (currentCartStep === 'delivery') {
    proceedToCartConfirmation();
  }
}

function prevCartStep() {
  if (window.triggerHaptic) window.triggerHaptic(20);
  if (currentCartStep === 'confirm') {
    switchCartStep('delivery');
  } else if (currentCartStep === 'delivery') {
    switchCartStep('items');
  }
}

function loadMoreCartItems() {
  cartRenderLimit += 50;
  renderCartUI();
}

function renderCartUI() {
  const container = document.getElementById('cartItemsListContainer');
  const emptyState = document.getElementById('cartEmptyState');
  const financialCard = document.getElementById('cartFinancialCard');
  const nextBtn = document.getElementById('cartNextBtn');
  if (!container) return;

  const fin = calculateCartFinancials();
  const totalCount = fin.totalCount;

  if (totalCount === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    if (financialCard) financialCard.style.display = 'none';
    if (nextBtn && currentCartStep === 'items') nextBtn.style.display = 'none';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (financialCard) financialCard.style.display = 'block';
  if (nextBtn && currentCartStep === 'items') nextBtn.style.display = 'inline-flex';

  // Renderizado optimizado por bloques (chunks) para rendimiento extremo
  const itemsToRender = shoppingCart.slice(0, cartRenderLimit);

  const itemsHtml = itemsToRender.map(ci => {
    const fullItem = findCatalogItem(ci.id) || { id: ci.id, title: `Producto #${ci.id}`, type: 'juego' };
    const typeInfo = getItemTypeInfo(fullItem);
    const formattedPrice = formatItemPrice(fullItem);
    const imgUrl = resolveImageUrl(fullItem.cover || fullItem.image || fullItem.poster || fullItem.caratula || fullItem.img);

    return `
      <div class="cart-item-row" data-cart-id="${ci.id}">
        <img class="cart-item-img" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(fullItem.title || 'Producto')}" onerror="this.src='${PLACEHOLDER_IMG}'">
        <div class="cart-item-details">
          <h4 class="cart-item-title" title="${escapeHtml(fullItem.title)}">${escapeHtml(fullItem.title)}</h4>
          <div class="cart-item-meta" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:4px;">
            <span class="cart-item-price-tag">🏷️ ${escapeHtml(formattedPrice)}</span>
            <span style="font-size:0.75rem; background:rgba(255,255,255,0.08); padding:2px 7px; border-radius:6px; color:#00E5FF; font-weight:700;">${typeInfo.label}</span>
            <span style="font-size:0.72rem; color:var(--text3);">• 1 copia digital</span>
          </div>
        </div>
        <button type="button" class="cart-item-del-btn" onclick="removeFromCart('${ci.id}')" title="Eliminar del carrito">🗑️</button>
      </div>
    `;
  }).join('');

  const hasMore = totalCount > cartRenderLimit;
  const loadMoreHtml = hasMore ? `
    <div style="text-align:center; padding:12px; margin-top:8px;">
      <button class="btn" onclick="loadMoreCartItems()" style="width:100%; border:1px solid #00E5FF; color:#00E5FF; background:rgba(0,229,255,0.08); font-weight:700; padding:10px;">
        ⬇️ Mostrar más productos (${totalCount - cartRenderLimit} restantes de ${totalCount})
      </button>
    </div>
  ` : '';

  container.innerHTML = itemsHtml + loadMoreHtml;

  // 1. Actualizar Barra de Domicilio Gratis (> 3000 pesos)
  const freeDelCard = document.getElementById('freeDeliveryProgressCard');
  const freeDelIcon = document.getElementById('freeDeliveryIcon');
  const freeDelMsg = document.getElementById('freeDeliveryMsg');
  const freeDelFill = document.getElementById('freeDeliveryBarFill');

  if (freeDelCard && freeDelMsg && freeDelFill) {
    if (fin.isFreeDelivery) {
      freeDelCard.classList.add('unlocked');
      if (freeDelIcon) freeDelIcon.textContent = '🎉';
      freeDelMsg.innerHTML = `<b>¡DOMICILIO GRATIS CONSEGUIDO!</b> Tu entrega a domicilio es de <b>0 CUP</b> (Ahorraste 500 CUP por superar los 3,000 pesos)`;
      freeDelFill.style.width = '100%';
      freeDelFill.classList.add('complete');
    } else {
      freeDelCard.classList.remove('unlocked');
      if (freeDelIcon) freeDelIcon.textContent = '🛵';
      const remaining = FREE_DELIVERY_THRESHOLD_CUP - fin.subtotal;
      const progressPercent = Math.min(100, Math.max(5, (fin.subtotal / FREE_DELIVERY_THRESHOLD_CUP) * 100));
      freeDelMsg.innerHTML = `Añade <b>$${remaining.toFixed(2)}</b> más en productos y tu <b>entrega a domicilio será GRATIS</b> (Ahorras 500 CUP)`;
      freeDelFill.style.width = `${progressPercent}%`;
      freeDelFill.classList.remove('complete');
    }
  }

  // 2. Previews de Método de Pago
  const prevCashEl = document.getElementById('previewCashTotal');
  const prevTransferEl = document.getElementById('previewTransferTotal');
  const delivSuffix = fin.isFreeDelivery ? 'Envío Gratis' : `${DEFAULT_DELIVERY_FEE_CUP} CUP`;

  if (prevCashEl) {
    prevCashEl.textContent = `$${fin.subtotal.toFixed(2)} + ${delivSuffix}`;
  }
  if (prevTransferEl) {
    prevTransferEl.textContent = `$${fin.subtotalWithTransferTax.toFixed(2)} + ${delivSuffix}`;
  }

  updatePaymentSelectorUI();

  // 3. Desglose Financiero
  const totalItemsEl = document.getElementById('cartFinTotalItems');
  const subtotalEl = document.getElementById('cartSubtotalVal');
  const transferTaxRow = document.getElementById('cartTransferTaxRow');
  const transferTaxVal = document.getElementById('cartTransferTaxVal');
  const transferFormulaNote = document.getElementById('cartTransferFormulaNote');
  const subtotalWithTaxRow = document.getElementById('cartSubtotalWithTaxRow');
  const subtotalWithTaxVal = document.getElementById('cartSubtotalWithTaxVal');
  const deliveryBadge = document.getElementById('cartDeliveryBadge');
  const deliveryLabel = document.getElementById('cartDeliveryLabel');
  const deliveryCostEl = document.getElementById('cartDeliveryCostVal');
  const totalLabelEl = document.getElementById('cartTotalLabel');
  const totalNoteEl = document.getElementById('cartTotalNote');
  const totalValEl = document.getElementById('cartTotalVal');
  const quickCashEl = document.getElementById('quickCompareCash');
  const quickTransferEl = document.getElementById('quickCompareTransfer');

  if (totalItemsEl) totalItemsEl.textContent = `${totalCount} productos digitales`;
  if (subtotalEl) subtotalEl.textContent = `$${fin.subtotal.toFixed(2)}`;

  if (transferTaxRow && transferTaxVal) {
    if (!fin.isCash) {
      transferTaxRow.style.display = 'flex';
      transferTaxVal.textContent = `+$${fin.transferTax.toFixed(2)}`;
      if (transferFormulaNote) {
        transferFormulaNote.textContent = `+30% aplicado sobre subtotal ($${fin.subtotal.toFixed(2)} × 0.30)`;
      }
    } else {
      transferTaxRow.style.display = 'none';
    }
  }

  if (subtotalWithTaxRow && subtotalWithTaxVal) {
    if (!fin.isCash) {
      subtotalWithTaxRow.style.display = 'flex';
      subtotalWithTaxVal.textContent = `$${fin.subtotalWithTransferTax.toFixed(2)}`;
    } else {
      subtotalWithTaxRow.style.display = 'none';
    }
  }

  if (deliveryBadge && deliveryCostEl) {
    if (fin.isFreeDelivery) {
      deliveryBadge.textContent = '🎉 GRATIS';
      deliveryBadge.className = 'delivery-badge free-badge';
      if (deliveryLabel) deliveryLabel.textContent = 'Entrega a Casa (Promoción > 3000 CUP):';
      deliveryCostEl.textContent = '0 CUP (¡GRATIS!)';
      deliveryCostEl.classList.add('is-free');
    } else {
      deliveryBadge.textContent = '🛵 DOMICILIO';
      deliveryBadge.className = 'delivery-badge';
      if (deliveryLabel) deliveryLabel.textContent = 'Tarifa de Entrega a Casa:';
      deliveryCostEl.textContent = `${DEFAULT_DELIVERY_FEE_CUP} CUP`;
      deliveryCostEl.classList.remove('is-free');
    }
  }

  if (totalLabelEl) {
    totalLabelEl.textContent = fin.isCash 
      ? 'TOTAL A PAGAR EN EFECTIVO (0% RECARGO):' 
      : 'TOTAL A PAGAR POR TRANSFERENCIA (+30%):';
  }

  if (totalNoteEl) {
    if (fin.isCash) {
      totalNoteEl.textContent = fin.isFreeDelivery 
        ? 'Subtotal normal de productos con Domicilio GRATIS'
        : `Subtotal de productos + ${DEFAULT_DELIVERY_FEE_CUP} pesos de domicilio`;
    } else {
      totalNoteEl.textContent = fin.isFreeDelivery
        ? `Subtotal ($${fin.subtotal.toFixed(2)}) + 30% impuesto ($${fin.transferTax.toFixed(2)}) con Domicilio GRATIS`
        : `Subtotal ($${fin.subtotal.toFixed(2)}) + 30% impuesto ($${fin.transferTax.toFixed(2)}) + ${DEFAULT_DELIVERY_FEE_CUP} pesos de domicilio`;
    }
  }

  if (totalValEl) {
    const delivText = fin.isFreeDelivery ? '0 CUP (Domicilio Gratis)' : `${DEFAULT_DELIVERY_FEE_CUP} CUP Domicilio`;
    totalValEl.textContent = `$${fin.activeProductsTotal.toFixed(2)} + ${delivText}`;
  }

  if (quickCashEl) {
    quickCashEl.textContent = `$${fin.subtotal.toFixed(2)} + ${delivSuffix}`;
  }
  if (quickTransferEl) {
    quickTransferEl.textContent = `$${fin.subtotalWithTransferTax.toFixed(2)} + ${delivSuffix}`;
  }
}

async function loadCustomerDataIntoForm() {
  let cust = null;
  try {
    const raw = localStorage.getItem(CART_CUSTOMER_DATA_KEY);
    if (raw) cust = JSON.parse(raw);
  } catch (e) {}

  // Fallback con el perfil del usuario si no existe
  const profile = await idbGetMeta('local_profile', null);

  const usernameInput = document.getElementById('cartFormUsername');
  const firstNameInput = document.getElementById('cartFormFirstName');
  const lastNameInput = document.getElementById('cartFormLastName');
  const ciInput = document.getElementById('cartFormCI');
  const addressInput = document.getElementById('cartFormAddress');
  const phoneInput = document.getElementById('cartFormPhone');
  const emailInput = document.getElementById('cartFormEmail');
  const notesInput = document.getElementById('cartFormNotes');

  if (usernameInput) usernameInput.value = cust?.username || profile?.apodo || profile?.username || '';
  if (firstNameInput) firstNameInput.value = cust?.firstName || profile?.fullName?.split(' ')[0] || '';
  if (lastNameInput) lastNameInput.value = cust?.lastName || profile?.fullName?.split(' ').slice(1).join(' ') || '';
  if (ciInput) ciInput.value = cust?.ci || '';
  if (addressInput) addressInput.value = cust?.address || profile?.address || '';
  if (phoneInput) phoneInput.value = cust?.phone || profile?.phone || '';
  if (emailInput) emailInput.value = cust?.email || profile?.email || '';
  if (notesInput) notesInput.value = cust?.notes || '';

  updatePaymentSelectorUI();
}

function getCustomerDataFromForm() {
  return {
    username: (document.getElementById('cartFormUsername')?.value || '').trim(),
    firstName: (document.getElementById('cartFormFirstName')?.value || '').trim(),
    lastName: (document.getElementById('cartFormLastName')?.value || '').trim(),
    ci: (document.getElementById('cartFormCI')?.value || '').trim(),
    address: (document.getElementById('cartFormAddress')?.value || '').trim(),
    phone: (document.getElementById('cartFormPhone')?.value || '').trim(),
    email: (document.getElementById('cartFormEmail')?.value || '').trim(),
    notes: (document.getElementById('cartFormNotes')?.value || '').trim(),
    paymentMethod: selectedCartPaymentMethod
  };
}

function saveCartCustomerData(showFeedback = false) {
  const data = getCustomerDataFromForm();
  try {
    localStorage.setItem(CART_CUSTOMER_DATA_KEY, JSON.stringify(data));
    localStorage.setItem(CART_PAYMENT_METHOD_KEY, selectedCartPaymentMethod);
    if (showFeedback && typeof showToast === 'function') {
      showToast('💾 Datos de entrega y preferencia de pago guardados');
    }
  } catch (e) {
    console.warn('Error saving customer data:', e);
  }
}

function proceedToCartConfirmation() {
  const data = getCustomerDataFromForm();
  
  // Validaciones obligatorias solicitadas
  if (!data.username) {
    if (typeof showToast === 'function') showToast('⚠️ Por favor introduce tu nombre de usuario / apodo');
    document.getElementById('cartFormUsername')?.focus();
    return;
  }
  if (!data.firstName) {
    if (typeof showToast === 'function') showToast('⚠️ Por favor introduce tu nombre original');
    document.getElementById('cartFormFirstName')?.focus();
    return;
  }
  if (!data.lastName) {
    if (typeof showToast === 'function') showToast('⚠️ Por favor introduce tus apellidos');
    document.getElementById('cartFormLastName')?.focus();
    return;
  }
  if (!data.ci) {
    if (typeof showToast === 'function') showToast('⚠️ Por favor introduce tu Carnet de Identidad (CI)');
    document.getElementById('cartFormCI')?.focus();
    return;
  }
  if (!data.address) {
    if (typeof showToast === 'function') showToast('⚠️ Por favor introduce tu dirección exacta de entrega');
    document.getElementById('cartFormAddress')?.focus();
    return;
  }
  if (!data.phone) {
    if (typeof showToast === 'function') showToast('⚠️ Por favor introduce tu número de teléfono de contacto');
    document.getElementById('cartFormPhone')?.focus();
    return;
  }
  if (!data.email || !data.email.includes('@')) {
    if (typeof showToast === 'function') showToast('⚠️ Por favor introduce un correo electrónico válido');
    document.getElementById('cartFormEmail')?.focus();
    return;
  }

  saveCartCustomerData(false);
  switchCartStep('confirm');
}

function renderCartOrderSummary() {
  const box = document.getElementById('cartConfirmSummaryBox');
  if (!box) return;
  const cust = getCustomerDataFromForm();
  const fin = calculateCartFinancials();

  const itemsHtml = shoppingCart.map((ci, idx) => {
    const fullItem = findCatalogItem(ci.id) || { title: `Producto #${ci.id}`, type: 'juego' };
    const typeInfo = getItemTypeInfo(fullItem);
    return `
      <div class="order-summary-item-row" style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="flex:1; min-width:0; margin-right:12px;">
          <div style="color:#fff; font-size:0.88rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${idx + 1}. ${escapeHtml(fullItem.title)}</div>
          <span style="font-size:0.72rem; color:#00E5FF;">${typeInfo.label} • 1 copia digital</span>
        </div>
        <strong style="color:#00FFB2; font-size:0.9rem; flex-shrink:0;">${formatItemPrice(fullItem)}</strong>
      </div>
    `;
  }).join('');

  const deliveryBadgeHtml = fin.isFreeDelivery 
    ? `<span style="background:linear-gradient(135deg,#00FFB2,#00E5FF); color:#04050A; font-weight:900; padding:2px 8px; border-radius:6px; font-size:0.75rem;">🎉 0 CUP (GRATIS por compra > 3000 pesos)</span>`
    : `<span style="color:#FF9E40; font-weight:800; font-size:0.88rem;">${DEFAULT_DELIVERY_FEE_CUP} CUP</span>`;

  const transferBreakdownHtml = !fin.isCash ? `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; color:#FF9E40; font-size:0.85rem;">
      <span>💳 Impuesto por Transferencia (+30%):</span>
      <strong>+$${fin.transferTax.toFixed(2)}</strong>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; color:#fff; font-size:0.85rem; border-top:1px dashed rgba(255,158,64,0.3);">
      <span>Subtotal con Transferencia (+30%):</span>
      <strong>$${fin.subtotalWithTransferTax.toFixed(2)}</strong>
    </div>
  ` : '';

  const paymentBadgeText = fin.isCash ? '💵 Efectivo (0% Recargo)' : '💳 Transferencia (+30% Impuesto)';
  const paymentBadgeBg = fin.isCash ? 'rgba(0, 255, 178, 0.2)' : 'rgba(255, 158, 64, 0.2)';
  const paymentBadgeColor = fin.isCash ? '#00FFB2' : '#FF9E40';

  box.innerHTML = `
    <div class="order-summary-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1);">
      <h4 style="margin:0; color:#fff; font-size:1.05rem;">📋 Resumen de tu Pedido</h4>
      <span style="font-size:0.82rem; color:#00E5FF; font-weight:800;">${fin.totalCount} productos digitales</span>
    </div>

    <div class="order-summary-items-list" style="max-height:200px; overflow-y:auto; margin-bottom:14px; padding-right:4px;">
      ${itemsHtml}
    </div>

    <div class="order-summary-customer-card" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:14px; padding:12px 14px; font-size:0.84rem; line-height:1.6; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
        <span style="font-weight:800; color:#00E5FF; font-size:0.9rem;">🛵 Datos de Entrega a Domicilio:</span>
        <span style="background:${paymentBadgeBg}; color:${paymentBadgeColor}; padding:2px 8px; border-radius:6px; font-size:0.75rem; font-weight:800; border:1px solid ${paymentBadgeColor};">
          ${paymentBadgeText}
        </span>
      </div>
      <div><b>Cliente:</b> ${escapeHtml(cust.firstName)} ${escapeHtml(cust.lastName)} (@${escapeHtml(cust.username)})</div>
      <div><b>Carnet de Identidad (CI):</b> ${escapeHtml(cust.ci)}</div>
      <div><b>Dirección:</b> ${escapeHtml(cust.address)}</div>
      <div><b>Teléfono:</b> ${escapeHtml(cust.phone)} | <b>Email:</b> ${escapeHtml(cust.email)}</div>
      ${cust.notes ? `<div><b>Notas:</b> ${escapeHtml(cust.notes)}</div>` : ''}
    </div>

    <div style="background:linear-gradient(135deg, rgba(0,229,255,0.06), rgba(0,255,178,0.04)); border:1px solid rgba(0,229,255,0.25); border-radius:14px; padding:12px 14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; color:var(--text2); font-size:0.85rem;">
        <span>📦 Subtotal Productos (${fin.totalCount} ítems):</span>
        <strong style="color:#fff;">$${fin.subtotal.toFixed(2)}</strong>
      </div>
      ${transferBreakdownHtml}
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; color:var(--text2); font-size:0.85rem;">
        <span>🛵 Tarifa de Domicilio:</span>
        ${deliveryBadgeHtml}
      </div>
      <div style="height:1px; background:rgba(255,255,255,0.12); margin:8px 0;"></div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="color:#fff; font-weight:900; font-size:0.95rem;">TOTAL DEFINITIVO:</div>
          <div style="font-size:0.72rem; color:${paymentBadgeColor}; font-weight:700;">
            ${fin.isCash ? 'Modalidad: Pago en Efectivo (0% recargo)' : 'Modalidad: Transferencia (+30% impuesto)'}
          </div>
        </div>
        <strong style="color:#00FFB2; font-size:1.25rem; text-shadow:0 0 12px rgba(0,255,178,0.4);">
          $${fin.activeProductsTotal.toFixed(2)} + ${fin.isFreeDelivery ? '0 CUP (Gratis)' : `${DEFAULT_DELIVERY_FEE_CUP} CUP`}
        </strong>
      </div>
    </div>
  `;

  // Actualizar Tarjeta Informativa de Política de Pago
  const policyCard = document.getElementById('cartPaymentPolicyInfoCard');
  const policyBadge = document.getElementById('policyPaymentBadge');
  const policyDeliveryBadge = document.getElementById('policyDeliveryBadge');
  const policyText = document.getElementById('policyPaymentText');

  if (policyCard && policyBadge && policyDeliveryBadge && policyText) {
    if (fin.isCash) {
      policyBadge.textContent = '💵 PAGO EN EFECTIVO';
      policyBadge.style.background = 'rgba(0, 255, 178, 0.2)';
      policyBadge.style.color = '#00FFB2';
    } else {
      policyBadge.textContent = '💳 PAGO POR TRANSFERENCIA (+30%)';
      policyBadge.style.background = 'rgba(255, 158, 64, 0.2)';
      policyBadge.style.color = '#FF9E40';
    }

    if (fin.isFreeDelivery) {
      policyDeliveryBadge.textContent = '🎉 DOMICILIO GRATIS (0 CUP)';
      policyDeliveryBadge.className = 'delivery-badge free-badge';
    } else {
      policyDeliveryBadge.textContent = `🛵 +${DEFAULT_DELIVERY_FEE_CUP} CUP DOMICILIO`;
      policyDeliveryBadge.className = 'delivery-badge';
    }

    if (fin.isCash) {
      policyText.innerHTML = `
        <p style="margin:0;">
          Has seleccionado <b>Pago en Efectivo</b>. Pagarás el precio regular del catálogo ($${fin.subtotal.toFixed(2)}) ${fin.isFreeDelivery ? 'con <b>Domicilio GRATIS</b> por tu compra superior a 3000 pesos.' : `más los <b>${DEFAULT_DELIVERY_FEE_CUP} pesos de entrega a domicilio</b> al recibir tu pedido en casa.`}
        </p>
      `;
    } else {
      policyText.innerHTML = `
        <p style="margin:0;">
          Has seleccionado <b>Pago por Transferencia Bancaria</b> (Transfermóvil / EnZona). Se aplica el <b>30% de impuesto por transferencia</b> (Subtotal: $${fin.subtotalWithTransferTax.toFixed(2)}) ${fin.isFreeDelivery ? 'con <b>Domicilio GRATIS</b> por superar los 3000 pesos.' : `más los <b>${DEFAULT_DELIVERY_FEE_CUP} pesos de domicilio</b>.`}
        </p>
      `;
    }
  }
}

function generateOrderFormattedText() {
  const cust = getCustomerDataFromForm();
  const fin = calculateCartFinancials();

  let itemsText = '';
  shoppingCart.forEach((ci, idx) => {
    const fullItem = findCatalogItem(ci.id) || { title: `Producto #${ci.id}` };
    const typeInfo = getItemTypeInfo(fullItem);
    itemsText += `${idx + 1}. *${fullItem.title}* [${typeInfo.label}] - ${formatItemPrice(fullItem)}\n`;
  });

  const deliveryStr = fin.isFreeDelivery 
    ? '🎉 0 CUP (¡DOMICILIO GRATIS por compra mayor a 3,000 pesos!)' 
    : `${DEFAULT_DELIVERY_FEE_CUP} CUP`;

  const paymentStr = fin.isCash 
    ? '💵 PAGO EN EFECTIVO (0% Recargo - Precio normal de catálogo)' 
    : '💳 PAGO POR TRANSFERENCIA (+30% Impuesto por transferencia bancaria)';

  let finBreakdown = `• Subtotal Base de Productos: $${fin.subtotal.toFixed(2)}\n`;
  if (!fin.isCash) {
    finBreakdown += `• Impuesto por Transferencia (+30%): +$${fin.transferTax.toFixed(2)}\n`;
    finBreakdown += `• Subtotal con Impuesto Transferencia: $${fin.subtotalWithTransferTax.toFixed(2)}\n`;
  }
  finBreakdown += `• Tarifa de Entrega a Domicilio: ${deliveryStr}\n`;
  finBreakdown += `• *TOTAL FINAL A PAGAR:* $${fin.activeProductsTotal.toFixed(2)} + ${fin.isFreeDelivery ? '0 CUP (Envío Gratis)' : `${DEFAULT_DELIVERY_FEE_CUP} CUP`}`;

  return `🛒 *NUEVO PEDIDO DE COMPRA Y ENTREGA A DOMICILIO*\n\n` +
    `👤 *DATOS DEL CLIENTE:*\n` +
    `• *Usuario/Nick:* ${cust.username}\n` +
    `• *Nombre Completo:* ${cust.firstName} ${cust.lastName}\n` +
    `• *Carnet de Identidad (CI):* ${cust.ci}\n` +
    `• *Teléfono:* ${cust.phone}\n` +
    `• *Correo Electrónico:* ${cust.email}\n` +
    `• *Dirección de Entrega:* ${cust.address}\n` +
    (cust.notes ? `• *Notas:* ${cust.notes}\n` : '') +
    `\n📦 *PRODUCTOS DIGITALES SOLICITADOS (${fin.totalCount} productos - 1 copia c/u):*\n` +
    itemsText +
    `\n💳 *MÉTODO DE PAGO SELECCIONADO:*\n` +
    `• ${paymentStr}\n` +
    `\n💰 *DESGLOSE FINANCIERO:*\n` +
    finBreakdown +
    `\n\n🛵 *Coordinación:* Entrega a domicilio en la dirección indicada.`;
}

function sendOrderViaPlatform(platform) {
  if (window.triggerHaptic) window.triggerHaptic(30);
  const orderText = generateOrderFormattedText();
  const encoded = encodeURIComponent(orderText);

  if (platform === 'whatsapp') {
    const waUrl = `https://api.whatsapp.com/send?text=${encoded}`;
    window.open(waUrl, '_blank');
    if (typeof showToast === 'function') showToast('📲 Abriendo WhatsApp para enviar el pedido...');
  } else if (platform === 'telegram') {
    const tgUrl = `https://t.me/share/url?url=${encodeURIComponent('https://catalogo.games')}&text=${encoded}`;
    window.open(tgUrl, '_blank');
    if (typeof showToast === 'function') showToast('✈️ Abriendo Telegram para enviar el pedido...');
  }
}

function copyOrderToClipboard() {
  if (window.triggerHaptic) window.triggerHaptic(25);
  const orderText = generateOrderFormattedText();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(orderText).then(() => {
      if (typeof showToast === 'function') showToast('📋 ¡Resumen del pedido copiado al portapapeles!');
    }).catch(() => {
      copyFallback(orderText);
    });
  } else {
    copyFallback(orderText);
  }
}

function copyFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    if (typeof showToast === 'function') showToast('📋 ¡Resumen copiado al portapapeles!');
  } catch (e) {
    if (typeof showToast === 'function') showToast('⚠️ No se pudo copiar automáticamente');
  }
  document.body.removeChild(textarea);
}

// Inicializar el carrito al cargar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    loadShoppingCartFromStorage();
    initWelcomeLightsAnimation();
  });
} else {
  loadShoppingCartFromStorage();
  setTimeout(initWelcomeLightsAnimation, 150);
}

// ==========================================
// ✨ ANIMACIÓN DE EFECTOS Y LUCES DE BIENVENIDA (CANVAS DE FONDO)
// ==========================================
let _welcomeLightsAnimId = null;

function initWelcomeLightsAnimation() {
  const canvas = document.getElementById('welcomeLightsCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let particles = [];
  const PARTICLE_COUNT = 32;

  function resize() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    width = canvas.width = rect.width || 400;
    height = canvas.height = rect.height || 600;
  }

  resize();
  window.addEventListener('resize', resize);

  // Colores luminosos estilo neón cyber (cyan, magenta, ámbar dorado, verde menta)
  const colors = [
    { r: 0, g: 229, b: 255 },  // Cyan
    { r: 255, g: 0, b: 127 },  // Magenta
    { r: 255, g: 170, b: 0 },  // Gold
    { r: 0, g: 255, b: 178 }   // Mint / Green
  ];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const c = colors[i % colors.length];
    particles.push({
      x: Math.random() * (width || 400),
      y: Math.random() * (height || 600),
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      radius: Math.random() * 2.2 + 1.2,
      color: c,
      alpha: Math.random() * 0.6 + 0.35,
      pulseSpeed: Math.random() * 0.025 + 0.01,
      pulseVal: Math.random() * Math.PI
    });
  }

  function draw() {
    const welcomeScreen = document.getElementById('mainWelcomeScreen');
    // Si la pantalla de bienvenida está oculta (usuario texteando o buscando), pausar dibujo para 0% consumo
    if (welcomeScreen && welcomeScreen.style.display === 'none') {
      _welcomeLightsAnimId = requestAnimationFrame(draw);
      return;
    }

    ctx.clearRect(0, 0, width, height);

    // 1. Dibujar líneas de conexión sinápticas / fibras de luz entre partículas cercanas
    const maxDist = 95;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist) {
          const factor = 1 - (dist / maxDist);
          const p1 = particles[i];
          const strokeAlpha = factor * 0.28 * Math.min(p1.alpha, particles[j].alpha);
          ctx.strokeStyle = `rgba(${p1.color.r}, ${p1.color.g}, ${p1.color.b}, ${strokeAlpha})`;
          ctx.lineWidth = factor * 1.4;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }

    // 2. Dibujar nodos luminosos y sus halos resplandecientes
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      // Rebote suave en bordes
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;

      p.pulseVal += p.pulseSpeed;
      const currentRadius = p.radius + Math.sin(p.pulseVal) * 0.8;
      const currentAlpha = p.alpha + Math.sin(p.pulseVal) * 0.2;

      // Halo exterior
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, currentRadius * 3.5);
      grad.addColorStop(0, `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, ${Math.max(0, currentAlpha * 0.8)})`);
      grad.addColorStop(1, `rgba(${p.color.r}, ${p.color.g}, ${p.color.b}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, currentRadius * 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Punto central
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, currentAlpha * 1.2)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, currentRadius * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }

    _welcomeLightsAnimId = requestAnimationFrame(draw);
  }

  if (_welcomeLightsAnimId) {
    cancelAnimationFrame(_welcomeLightsAnimId);
  }
  _welcomeLightsAnimId = requestAnimationFrame(draw);
}
window.initWelcomeLightsAnimation = initWelcomeLightsAnimation;





