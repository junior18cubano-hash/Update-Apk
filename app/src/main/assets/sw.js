// =====================================================================
// 🚀 SERVICE WORKER - CATÁLOGO JOA · MULTIVERSO PWA & OFFLINE ENGINE
// Versión: v8 (Caché Integral del Catálogo, Offline Resiliente & Portadas)
// =====================================================================

const VERSION = 'v12';
const CACHE_STATIC = `joa-static-${VERSION}`;
const CACHE_CATALOG = `joa-catalog-${VERSION}`;
const CACHE_IMAGES = `joa-images-${VERSION}`;
const CACHE_FAVORITES = `joa-favorites-${VERSION}`;

const UPDATE_URL_DEFAULT = 'https://raw.githubusercontent.com/junior18cubano-hash/Actualizacion-Catalogo/refs/heads/main/Update.json';
const VERSION_URL_DEFAULT = 'https://raw.githubusercontent.com/junior18cubano-hash/Actualizacion-Catalogo/refs/heads/main/version.json';

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app1.js',
  './app2.js',
  './d3.min.js',
  './offline-manifest.json',
  './assets/icons/icon-192x192.png',
  './assets/icons/icon-512x512.png',
  './img/service_maintenance.jpg',
  './img/service_os_install.jpg',
  './img/service_software.jpg',
  './img/service_retro_revival.jpg',
  './img/joa_gamers_logo.jpg',
  './img/joa_gamers_splash.jpg',
  './video/joa_loading_intro.mp4',
  './img/joa_app_icon.png',
  './img/joa_gothic_crest.jpg',
  './img/joa_gothic_logo.jpg',
  './img/joa_location_pin.jpg',
  './multimedia_hero.jpg',
  './multimedia_hero.webp',
  './img/multimedia_hero.jpg',
  './hero_data.js',
  './services_data.js'
];

// SVG de respaldo para imágenes cuando se está offline y no están en caché
const OFFLINE_SVG_PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="100%" height="100%" fill="#0F131A"/><path d="M120 200 L180 260 M180 200 L120 260" stroke="#4E5262" stroke-width="6" stroke-linecap="round"/><text x="50%" y="60%" fill="#4E5262" font-size="16" font-family="monospace" text-anchor="middle" font-weight="bold">📴 OFFLINE</text><text x="50%" y="66%" fill="#3A3D4A" font-size="12" font-family="monospace" text-anchor="middle">IMAGEN NO CACHADA</text></svg>`;

// 1. INSTALACIÓN (Pre-caché de recursos estáticos básicos del núcleo y catálogo offline)
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      console.log(`📦 [SW ${VERSION}] Pre-cargando recursos estáticos del núcleo...`);
      const staticCache = await caches.open(CACHE_STATIC);

      for (const asset of STATIC_ASSETS) {
        try {
          await staticCache.add(asset);
        } catch (e) {
          console.warn(`⚠️ [SW] No se pudo pre-cargar asset: ${asset}`, e);
        }
      }

      return self.skipWaiting();
    })()
  );
});

// 2. ACTIVACIÓN (Limpieza de versiones anteriores obsoletas, preservando imágenes y favoritos válidos)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (![CACHE_STATIC, CACHE_CATALOG, CACHE_IMAGES, CACHE_FAVORITES].includes(key) && key.startsWith('joa-')) {
            console.log('🧹 [SW] Eliminando caché obsoleta:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      runStorageObserverCleanup();
      return self.clients.claim();
    })
  );
});

// =====================================================================
// 📊 OBSERVADOR DE ALMACENAMIENTO (STORAGE OBSERVER - LÍMITE 500MB & LIMPIEZA DE UNUSED/OLD IMAGES)
// =====================================================================
const STORAGE_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB

async function openSWIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('joaCatalogOffline', 5);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getSWFavoritesSet(db) {
  const favSet = new Set();
  try {
    if (db.objectStoreNames.contains('user_states')) {
      await new Promise((resolve) => {
        const tx = db.transaction('user_states', 'readonly');
        const req = tx.objectStore('user_states').getAll();
        req.onsuccess = () => {
          (req.result || []).forEach(s => {
            if (s && (s.status === 'wishlist' || s.status === 'playing' || s.isFavorite || s.status === 'favorite')) {
              if (s.itemId) favSet.add(String(s.itemId).toLowerCase());
            }
          });
          resolve();
        };
        req.onerror = () => resolve();
      });
    }
  } catch(e) {}
  return favSet;
}

async function runStorageObserverCleanup() {
  try {
    let usageBytes = 0;
    if (self.navigator && self.navigator.storage && self.navigator.storage.estimate) {
      try {
        const estimate = await self.navigator.storage.estimate();
        usageBytes = estimate.usage || 0;
      } catch(e) {}
    }

    const db = await openSWIndexedDB();
    if (!db || !db.objectStoreNames.contains('item_media_cache')) return;

    const favSet = await getSWFavoritesSet(db);
    const systemProtectedAssets = ['icon-', 'logo', 'favicon', 'placeholder', 'spinner', 'default', 'avatar', 'service_', 'joa_gamers', 'splash', 'img/', 'hero'];

    const records = await new Promise((resolve) => {
      const tx = db.transaction('item_media_cache', 'readonly');
      const req = tx.objectStore('item_media_cache').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    if (!records || !records.length) return;

    const now = Date.now();
    const toDeleteKeys = [];
    let totalMediaBytes = 0;

    records.forEach(rec => {
      if (!rec || !rec.itemId) return;
      const itemIdStr = String(rec.itemId).toLowerCase();
      const isProtected = systemProtectedAssets.some(p => itemIdStr.includes(p));
      if (isProtected) return;

      const sizeBytes = rec.size || (rec.dataUrl ? Math.round(rec.dataUrl.length * 0.75) : 120 * 1024);
      totalMediaBytes += sizeBytes;

      const isFav = favSet.has(itemIdStr);
      let ageDays = 31;
      if (rec.savedAt) {
        const diffMs = now - new Date(rec.savedAt).getTime();
        if (!isNaN(diffMs) && diffMs > 0) ageDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      }

      // Eliminar imágenes que tienen más de 30 días y NO son favoritas
      if (ageDays >= 30 && !isFav) {
        toDeleteKeys.push({ key: rec.itemId, size: sizeBytes });
      }
    });

    // Observador de cuota: Si el uso de espacio supera los 500MB, purgar proactivamente imágenes no utilizadas/no favoritas
    const effectiveUsage = Math.max(usageBytes, totalMediaBytes);
    if (effectiveUsage > STORAGE_LIMIT_BYTES) {
      console.log(`⚠️ [Storage Observer SW] El uso de almacenamiento (~${(effectiveUsage/(1024*1024)).toFixed(1)}MB) supera 500MB. Iniciando purga proactiva de caché de imágenes...`);
      
      const remainingUnfav = records.filter(rec => {
        if (!rec || !rec.itemId) return false;
        const itemIdStr = String(rec.itemId).toLowerCase();
        const isProtected = systemProtectedAssets.some(p => itemIdStr.includes(p));
        const isFav = favSet.has(itemIdStr);
        const alreadyAdded = toDeleteKeys.some(k => k.key === rec.itemId);
        return !isProtected && !isFav && !alreadyAdded;
      }).sort((a, b) => {
        const timeA = a.savedAt ? new Date(a.savedAt).getTime() : 0;
        const timeB = b.savedAt ? new Date(b.savedAt).getTime() : 0;
        return timeA - timeB;
      });

      let currentUsage = effectiveUsage - toDeleteKeys.reduce((acc, k) => acc + k.size, 0);
      for (const rec of remainingUnfav) {
        if (currentUsage <= STORAGE_LIMIT_BYTES * 0.85) break;
        const sizeBytes = rec.size || (rec.dataUrl ? Math.round(rec.dataUrl.length * 0.75) : 120 * 1024);
        toDeleteKeys.push({ key: rec.itemId, size: sizeBytes });
        currentUsage -= sizeBytes;
      }
    }

    if (toDeleteKeys.length > 0) {
      const keysArray = toDeleteKeys.map(k => k.key);
      await new Promise((resolve) => {
        const tx = db.transaction('item_media_cache', 'readwrite');
        const store = tx.objectStore('item_media_cache');
        keysArray.forEach(k => store.delete(k));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });

      try {
        const imgCache = await caches.open(CACHE_IMAGES);
        for (const k of keysArray) {
          await imgCache.delete(k);
        }
      } catch(e) {}

      console.log(`🧹 [Storage Observer SW] Purga completada: ${toDeleteKeys.length} archivos eliminados de IndexedDB / CacheStorage.`);
    }
  } catch(err) {
    console.warn('⚠️ [Storage Observer SW] Error en observador de almacenamiento:', err);
  }
}

// Helper: Fetch con Timeout Inteligente (Previene bloqueos de red en conexiones 2G/3G inestables)
function fetchWithTimeout(request, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout de red superado (${timeoutMs}ms)`));
    }, timeoutMs);
    fetch(request).then((res) => {
      clearTimeout(timer);
      resolve(res);
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// 🗜️ Helper: Compresión automática de imágenes en WebP
async function compressImageBlob(blob, maxWidth = 440, quality = 0.70) {
  if (!blob) return blob;
  if (blob.size < 22000 && (blob.type.includes('webp') || blob.type.includes('svg'))) {
    return blob;
  }
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      let w = bitmap.width;
      let h = bitmap.height;
      if (w > maxWidth || h > maxWidth) {
        if (w > h) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        } else {
          w = Math.round((w * maxWidth) / h);
          h = maxWidth;
        }
      }
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const compressed = await canvas.convertToBlob({ type: 'image/webp', quality });
        if (compressed && compressed.size > 0 && compressed.size < blob.size) {
          return compressed;
        }
      }
      if (bitmap) bitmap.close();
    } catch (e) {
    }
  }
  return blob;
}

// 🧹 Control de cuota y minimización de almacenamiento (LRU Pruning)
async function pruneImageCache(cache, maxItems = 350) {
  try {
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const toDelete = keys.slice(0, keys.length - maxItems);
      for (const k of toDelete) {
        await cache.delete(k);
      }
    }
  } catch (e) {}
}

// 💾 Almacenar respuesta de imagen comprimida en CacheStorage
async function storeCompressedImageInCache(cache, request, netResponse) {
  try {
    const contentType = netResponse.headers.get('content-type') || '';
    if (contentType.includes('svg') || contentType.includes('gif')) {
      await cache.put(request, netResponse.clone());
      return;
    }
    const blob = await netResponse.blob();
    const compressedBlob = await compressImageBlob(blob, 440, 0.70);
    const newHeaders = new Headers(netResponse.headers);
    newHeaders.set('Content-Type', 'image/webp');
    newHeaders.set('Content-Length', String(compressedBlob.size));
    newHeaders.set('Cache-Control', 'public, max-age=31536000');
    newHeaders.set('X-Joa-Compressed', 'true');
    const compressedResponse = new Response(compressedBlob, {
      status: netResponse.status,
      statusText: netResponse.statusText,
      headers: newHeaders
    });
    await cache.put(request, compressedResponse);
    await pruneImageCache(cache, 350);
  } catch (err) {
    try {
      await cache.put(request, netResponse.clone());
    } catch (putErr) {}
  }
}

// 3. INTERCEPTOR DE PETICIONES (Estrategias de Caché Offline Adaptativas)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignorar peticiones que no sean GET o esquemas no soportados
  if (req.method !== 'GET' || url.protocol === 'chrome-extension:' || url.protocol === 'file:') {
    return;
  }

  // A0. METADATOS DE FAVORITOS SINCRONIZADOS
  if (url.pathname.includes('joa_favorites_metadata') || url.pathname.includes('joa_item_')) {
    event.respondWith(
      caches.open(CACHE_FAVORITES).then(async (favCache) => {
        const cached = await favCache.match(req);
        if (cached) return cached;
        return fetchWithTimeout(req, 2000).then((netRes) => {
          if (netRes && netRes.ok) {
            favCache.put(req, netRes.clone());
          }
          return netRes;
        }).catch(() => new Response(JSON.stringify({ error: 'offline', favorites: [] }), {
          headers: { 'Content-Type': 'application/json' }
        }));
      })
    );
    return;
  }

  // A. ACTUALIZACIONES DE CATÁLOGO Y METADATOS JSON (Network-First con Timeout 2.5s y Resiliente Cache Fallback)
  if (url.pathname.endsWith('.json') || url.hostname.includes('githubusercontent.com') || url.pathname.includes('Actualizacion-Catalogo')) {
    event.respondWith(
      (async () => {
        const catCache = await caches.open(CACHE_CATALOG);
        const isUpdateUrl = url.pathname.endsWith('Update.json') || url.href.includes('Update.json');
        const isVersionUrl = url.pathname.endsWith('version.json') || url.href.includes('version.json');

        try {
          // Intentar red primero
          const networkRes = await fetchWithTimeout(req, 2500);
          if (networkRes && networkRes.ok) {
            // Guardar copia fresca en caché bajo la petición completa
            await catCache.put(req, networkRes.clone());

            // También guardar bajo la URL limpia (sin query params como ?_=timestamp)
            const cleanUrl = url.origin + url.pathname;
            await catCache.put(cleanUrl, networkRes.clone());

            if (isUpdateUrl) {
              await catCache.put('./Update.json', networkRes.clone());
              await catCache.put('Update.json', networkRes.clone());
            } else if (isVersionUrl) {
              await catCache.put('./version.json', networkRes.clone());
              await catCache.put('version.json', networkRes.clone());
            }
            return networkRes;
          }
        } catch (netErr) {
          console.log(`📴 [SW ${VERSION}] Red inaccesible. Recuperando catálogo desde caché para:`, req.url);
        }

        // Si la red falló (offline): buscar en CACHE_CATALOG ignorando query params (?_=...)
        let cached = await catCache.match(req, { ignoreSearch: true });

        if (!cached) {
          const cleanUrl = url.origin + url.pathname;
          cached = await catCache.match(cleanUrl);
        }

        if (!cached && isUpdateUrl) {
          cached = await catCache.match('./Update.json') ||
                   await catCache.match('Update.json') ||
                   await catCache.match(UPDATE_URL_DEFAULT) ||
                   await caches.match('./Update.json') ||
                   await caches.match('Update.json');
        }

        if (!cached && isVersionUrl) {
          cached = await catCache.match('./version.json') ||
                   await catCache.match('version.json') ||
                   await catCache.match(VERSION_URL_DEFAULT) ||
                   await caches.match('./version.json') ||
                   await caches.match('version.json');
        }

        if (!cached) {
          cached = await caches.match(req, { ignoreSearch: true });
        }

        if (cached) {
          console.log('✅ [SW] Catálogo recuperado exitosamente desde caché offline.');
          const headers = new Headers(cached.headers);
          headers.set('X-Joa-Offline-Cache', 'true');
          headers.set('Content-Type', 'application/json');
          return new Response(await cached.blob(), {
            status: 200,
            statusText: 'OK (Offline Cache)',
            headers
          });
        }

        // Respuesta sintética si no hay nada en caché
        return new Response(JSON.stringify({
          error: 'offline',
          offline: true,
          message: 'Modo sin conexión. Cargando datos desde almacenamiento local.'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      })()
    );
    return;
  }

  // B. IMÁGENES DEL CATÁLOGO Y MULTIMEDIA (Cache-First con Auto-Compresión y Persistencia)
  if (req.destination === 'image' || /\.(png|jpg|jpeg|webp|gif|svg|ico|bmp)(\?.*)?$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_IMAGES).then(async (imgCache) => {
        const cachedImg = await imgCache.match(req);
        if (cachedImg) {
          if (!cachedImg.headers.get('X-Joa-Compressed')) {
            fetch(req).then((netImg) => {
              if (netImg && (netImg.ok || netImg.type === 'opaque')) {
                storeCompressedImageInCache(imgCache, req, netImg);
              }
            }).catch(() => {});
          }
          return cachedImg;
        }

        return fetch(req).then((netImg) => {
          if (netImg && (netImg.ok || netImg.type === 'opaque')) {
            const cloneForStorage = netImg.clone();
            storeCompressedImageInCache(imgCache, req, cloneForStorage);
          }
          return netImg;
        }).catch(() => {
          console.log('📴 [SW] Imagen no disponible offline:', req.url);
          return new Response(OFFLINE_SVG_PLACEHOLDER, {
            status: 200,
            headers: { 'Content-Type': 'image/svg+xml' }
          });
        });
      })
    );
    return;
  }

  // C. ARCHIVOS ESTÁTICOS Y UI DE LA APLICACIÓN (Stale-While-Revalidate)
  if (req.destination === 'script' || req.destination === 'style' || req.destination === 'document' || STATIC_ASSETS.some(a => url.pathname.endsWith(a.replace('./', '')))) {
    event.respondWith(
      caches.match(req).then((cachedRes) => {
        const fetchPromise = fetch(req).then((netRes) => {
          if (netRes && netRes.ok) {
            caches.open(CACHE_STATIC).then((cache) => cache.put(req, netRes.clone()));
          }
          return netRes;
        }).catch(() => cachedRes);
        return cachedRes || fetchPromise;
      }).catch(async () => {
        if (req.mode === 'navigate' || req.destination === 'document') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      })
    );
    return;
  }

  // D. RESTO DE PETICIONES (Network-First)
  event.respondWith(
    fetch(req).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});

// 4. BACKGROUND SYNC & PRECARGA INTELIGENTE DE METADATOS DE FAVORITOS
async function syncFavoritesMetadata(favoritesList) {
  if (!Array.isArray(favoritesList) || favoritesList.length === 0) return { success: true, count: 0 };
  console.log(`⚡ [SW ${VERSION}] Iniciando precarga inteligente de metadatos para ${favoritesList.length} favoritos...`);
  
  const favCache = await caches.open(CACHE_FAVORITES);
  const imgCache = await caches.open(CACHE_IMAGES);
  
  const favMetadataResponse = new Response(JSON.stringify(favoritesList), {
    headers: {
      'Content-Type': 'application/json',
      'X-Joa-Sync-Time': new Date().toISOString(),
      'X-Joa-Count': String(favoritesList.length)
    }
  });
  await favCache.put('/joa_favorites_metadata.json', favMetadataResponse.clone());
  await favCache.put('./joa_favorites_metadata.json', favMetadataResponse);

  let cachedImagesCount = 0;
  for (const item of favoritesList) {
    if (item.id) {
      const itemDetailResponse = new Response(JSON.stringify(item), {
        headers: { 'Content-Type': 'application/json', 'X-Joa-Sync-Time': new Date().toISOString() }
      });
      await favCache.put(`/joa_item_${item.id}.json`, itemDetailResponse.clone());
      await favCache.put(`./joa_item_${item.id}.json`, itemDetailResponse);
    }
    const imgUrl = item.cover || item.image || item.poster || item.caratula || item.img;
    if (imgUrl && typeof imgUrl === 'string' && !imgUrl.startsWith('data:') && !imgUrl.startsWith('blob:')) {
      try {
        const alreadyCached = await imgCache.match(imgUrl);
        if (!alreadyCached) {
          const imgRes = await fetch(imgUrl, { mode: 'no-cors' });
          if (imgRes && (imgRes.ok || imgRes.type === 'opaque')) {
            await imgCache.put(imgUrl, imgRes);
            cachedImagesCount++;
          }
        }
      } catch (e) {}
    }
  }

  const allClients = await self.clients.matchAll();
  allClients.forEach((client) => {
    client.postMessage({
      type: 'FAVORITES_SYNC_COMPLETE',
      count: favoritesList.length,
      imagesPreloaded: cachedImagesCount,
      timestamp: Date.now()
    });
  });
  return { success: true, count: favoritesList.length, imagesPreloaded: cachedImagesCount };
}

// 5. EVENTOS DE MENSAJERÍA (Comunicación con el Front-End)
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  // CACHEAR CATÁLOGO COMPLETO DESDE EL FRONT-END
  if (data.type === 'CACHE_CATALOG_DATA') {
    event.waitUntil(
      (async () => {
        try {
          const catCache = await caches.open(CACHE_CATALOG);
          const rawText = typeof data.json === 'string' ? data.json : JSON.stringify(data.json || {});
          const response = new Response(rawText, {
            headers: {
              'Content-Type': 'application/json',
              'X-Joa-Cached-At': new Date().toISOString(),
              'X-Joa-Offline-Cache': 'true',
              'Cache-Control': 'public, max-age=31536000'
            }
          });
          await catCache.put('./Update.json', response.clone());
          await catCache.put('Update.json', response.clone());
          await catCache.put(UPDATE_URL_DEFAULT, response.clone());
          console.log('💾 [SW] Catálogo guardado en CACHE_CATALOG exitosamente.');
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: true, count: data.count || 0 });
          }
        } catch (e) {
          console.error('[SW] Error al cachear catálogo en SW:', e);
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: false, error: e.message });
          }
        }
      })()
    );
  }

  if (data.type === 'PRECACHE_FAVORITES') {
    event.waitUntil(
      syncFavoritesMetadata(data.favorites || []).then((res) => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage(res);
        }
      })
    );
  }

  if (data.type === 'CACHE_COMPRESSED_IMAGE') {
    if (data.url && data.base64) {
      event.waitUntil(
        (async () => {
          try {
            const imgCache = await caches.open(CACHE_IMAGES);
            const byteString = atob(data.base64.split(',')[1] || data.base64);
            const mimeString = data.mimeType || 'image/webp';
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: mimeString });
            const response = new Response(blob, {
              headers: {
                'Content-Type': mimeString,
                'Content-Length': String(blob.size),
                'Cache-Control': 'public, max-age=31536000',
                'X-Joa-Compressed': 'true'
              }
            });
            await imgCache.put(data.url, response);
            await pruneImageCache(imgCache, 350);
          } catch (e) {
            console.warn('[SW] Error al guardar imagen comprimida en CacheStorage:', e);
          }
        })()
      );
    }
  }

  if (data.type === 'CHECK_STORAGE_OBSERVER' || data.type === 'ENFORCE_STORAGE_LIMIT') {
    event.waitUntil(
      runStorageObserverCleanup().then(() => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true });
        }
      })
    );
  }

  if (data.type === 'GET_OFFLINE_STATS') {
    event.waitUntil(
      (async () => {
        const imgCache = await caches.open(CACHE_IMAGES);
        const favCache = await caches.open(CACHE_FAVORITES);
        const catCache = await caches.open(CACHE_CATALOG);
        const imgKeys = await imgCache.keys();
        const favKeys = await favCache.keys();
        const catKeys = await catCache.keys();
        const stats = {
          imagesCount: imgKeys.length,
          favoritesCount: favKeys.length,
          catalogEntries: catKeys.length,
          version: VERSION
        };
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage(stats);
        }
      })()
    );
  }
});

// 6. SYNC EVENT
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-favorites' || event.tag === 'sync-catalog') {
    event.waitUntil(
      (async () => {
        console.log(`🔄 [SW ${VERSION}] Evento background sync activado:`, event.tag);
      })()
    );
  }
});
