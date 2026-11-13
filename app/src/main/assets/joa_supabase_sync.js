/**
 * ============================================================
 * 🌐 JOA GAMERS · SINCRONIZACIÓN DE FAVORITOS & RESEÑAS (SUPABASE)
 * Etapa 2: Sincronización en tiempo real con JOA Multiverso Web
 * ============================================================
 */
(function() {
  'use strict';

  var catalogFavorites = [];
  var catalogFavoritesByKey = new Map();
  var reviewsCacheByKey = new Map();

  window.joaCatalogFavorites = catalogFavorites;
  window.joaCatalogFavoritesByKey = catalogFavoritesByKey;

  /**
   * Normaliza el tipo del ítem
   */
  function normalizeType(val) {
    return String(val || "")
      .toLocaleLowerCase("es")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[ -]/g, "_");
  }

  function getItemType(item) {
    if (!item) return "otros";
    return normalizeType(item.type || item.tipo || item.category || item.categoria || "otros");
  }

  function getItemTitle(item) {
    if (!item) return "Contenido JOA";
    return String(item.title || item.name || item.titulo || item.nombre || item.game || "Contenido JOA");
  }

  function getItemCover(item) {
    if (!item) return "";
    return item.cover || item.image || item.poster || item.caratula || item.img || "";
  }

  /**
   * Genera la clave única compartida con la plataforma web (reviewItemKey)
   * Formato: "tipo:id_o_slug_o_titulo"
   */
  function getReviewItemKey(item) {
    if (!item) return "";
    var raw = item.id !== undefined ? item.id : (item.external_id || item.igdb_id || item.tmdb_id || item.slug || getItemTitle(item));
    return getItemType(item) + ":" + String(raw).trim().toLocaleLowerCase("es");
  }

  window.getJoaReviewItemKey = getReviewItemKey;

  /**
   * Genera el snapshot serializable para item_data en catalog_favorites
   */
  function favoriteSnapshot(item) {
    return {
      id: item.id !== undefined ? item.id : (item.external_id || item.igdb_id || item.tmdb_id || null),
      slug: item.slug || null,
      year: item.year || item.ano || item.año || item.release_year || null,
      platform: item.platform || item.platforms || item.consola || null,
      genre: item.genre || item.genres || item.generos || item.genero || null,
      description: item.synopsis || item.sinopsis || item.description || item.descripcion || ""
    };
  }

  function showToast(msg) {
    var toastEl = document.getElementById("toast");
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "toast";
      toastEl.className = "toast-message";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(window.__joaToastTimer);
    window.__joaToastTimer = setTimeout(function() {
      toastEl.classList.remove("show");
    }, 3500);
  }

  /**
   * Carga los favoritos del usuario desde la tabla 'catalog_favorites' de Supabase
   */
  async function loadUserCatalogFavorites() {
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;

    if (!supabase || !user) {
      catalogFavorites = [];
      catalogFavoritesByKey.clear();
      updateFavoriteCountBadge();
      updateFavoriteDetailBtn();
      return [];
    }

    try {
      var res = await supabase
        .from("catalog_favorites")
        .select("user_id,item_key,item_title,item_type,cover_url,item_data,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (res.error) throw res.error;

      catalogFavorites = res.data || [];
      catalogFavoritesByKey.clear();
      catalogFavorites.forEach(function(row) {
        if (row && row.item_key) {
          catalogFavoritesByKey.set(row.item_key, row);
        }
      });

      window.joaCatalogFavorites = catalogFavorites;
      window.joaCatalogFavoritesByKey = catalogFavoritesByKey;
      console.info("JOA Sync: " + catalogFavorites.length + " favoritos cargados desde Supabase.");

      updateFavoriteCountBadge();
      updateFavoriteDetailBtn();

      // Guardar también en IndexedDB local para persistencia offline
      if (typeof window.idbPut === "function") {
        catalogFavorites.forEach(function(fav) {
          var localId = fav.item_data?.id;
          if (localId !== undefined && localId !== null) {
            window.idbPut('user_states', {
              itemId: localId,
              status: 'wishlist',
              updatedAt: fav.created_at || new Date().toISOString()
            }).catch(function() {});
          }
        });
      }

      return catalogFavorites;
    } catch (err) {
      console.warn("JOA Sync: Error al cargar favoritos desde Supabase:", err);
      return [];
    }
  }

  window.loadUserCatalogFavorites = loadUserCatalogFavorites;

  /**
   * Actualiza el contador de favoritos en el menú lateral
   */
  function updateFavoriteCountBadge() {
    var favEl = document.getElementById("libFavCount");
    if (!favEl) return;
    var count = catalogFavoritesByKey.size;
    if (count > 0) {
      favEl.textContent = count;
    } else {
      // Si no hay en nube, mantener el conteo local existente
      if (typeof window.userStates !== 'undefined' && Array.isArray(window.userStates)) {
        var localCount = window.userStates.filter(function(s) { return s && s.status === 'wishlist'; }).length;
        favEl.textContent = localCount || 0;
      }
    }
  }

  /**
   * Determina si un ítem está marcado como favorito
   */
  window.isCatalogItemFavorite = function(item) {
    if (!item) return false;
    var key = getReviewItemKey(item);
    if (catalogFavoritesByKey.has(key)) return true;

    // Comprobación de contingencia en estado local
    if (typeof window.userStates !== 'undefined' && Array.isArray(window.userStates)) {
      var found = window.userStates.find(function(s) { return s && s.itemId === item.id && s.status === 'wishlist'; });
      if (found) return true;
    }
    return false;
  };

  /**
   * Actualiza el botón de Favorito dentro de la ficha de detalle (#favoriteDetailBtn)
   */
  function updateFavoriteDetailBtn() {
    var btn = document.getElementById("favoriteDetailBtn");
    var icon = document.getElementById("favoriteDetailIcon");
    var txt = document.getElementById("favoriteDetailTxt");
    if (!btn) return;

    var currentId = window.currentDetailId;
    if (!currentId) return;

    var it = null;
    if (typeof window.findCatalogItem === 'function') {
      it = window.findCatalogItem(currentId);
    } else if (Array.isArray(window.allItems)) {
      it = window.allItems.find(function(i) { return i.id === currentId; });
    }
    if (!it) return;

    var isFav = window.isCatalogItemFavorite(it);
    if (isFav) {
      btn.classList.add("is-active");
      if (icon) icon.textContent = "❤️";
      if (txt) txt.textContent = "En Favoritos";
      btn.title = "Guardado en tus favoritos de JOA Multiverso (Toca para quitar)";
    } else {
      btn.classList.remove("is-active");
      if (icon) icon.textContent = "🤍";
      if (txt) txt.textContent = "Favorito";
      btn.title = "Guardar en favoritos de JOA Multiverso";
    }
  }

  window.updateFavoriteDetailBtn = updateFavoriteDetailBtn;

  /**
   * Alterna el estado de favorito de un ítem (Crear / Eliminar en catalog_favorites)
   */
  window.toggleCatalogItemFavorite = async function(item) {
    if (!item) return;
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;

    if (!user || !supabase) {
      if (typeof window.openJoaAuthModal === 'function') {
        window.openJoaAuthModal();
      }
      showToast("Inicia sesión para sincronizar tus favoritos con JOA Multiverso.");
      return;
    }

    var key = getReviewItemKey(item);
    var isFav = catalogFavoritesByKey.has(key);
    var btn = document.getElementById("favoriteDetailBtn");
    if (btn) btn.disabled = true;

    try {
      if (isFav) {
        // Quitar de favoritos en Supabase
        var delRes = await supabase
          .from("catalog_favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("item_key", key);

        if (delRes.error) throw delRes.error;

        catalogFavoritesByKey.delete(key);
        catalogFavorites = catalogFavorites.filter(function(r) { return r.item_key !== key; });
        showToast("Se quitó de tus favoritos.");

        // Sincronizar localmente en IndexedDB
        if (typeof window.openDB === 'function') {
          var db = await window.openDB();
          await new Promise(function(resolve) {
            var tx = db.transaction('user_states', 'readwrite');
            tx.objectStore('user_states').delete(item.id);
            tx.oncomplete = resolve;
            tx.onerror = resolve;
          });
        }
      } else {
        // Añadir a favoritos en Supabase
        var payload = {
          user_id: user.id,
          item_key: key,
          item_title: getItemTitle(item).slice(0, 300),
          item_type: getItemType(item),
          cover_url: getItemCover(item) || null,
          item_data: favoriteSnapshot(item)
        };

        var insRes = await supabase
          .from("catalog_favorites")
          .insert(payload)
          .select("user_id,item_key,item_title,item_type,cover_url,item_data,created_at")
          .single();

        if (insRes.error) throw insRes.error;

        catalogFavorites.unshift(insRes.data);
        catalogFavoritesByKey.set(key, insRes.data);
        showToast("❤️ Añadido a tus favoritos de JOA Multiverso.");

        // Sincronizar localmente en IndexedDB
        if (typeof window.idbPut === 'function') {
          await window.idbPut('user_states', {
            itemId: item.id,
            status: 'wishlist',
            updatedAt: new Date().toISOString()
          });
        }
      }

      window.joaCatalogFavorites = catalogFavorites;
      window.joaCatalogFavoritesByKey = catalogFavoritesByKey;
      updateFavoriteCountBadge();
      updateFavoriteDetailBtn();

    } catch (err) {
      console.error("JOA Sync Favorite Error:", err);
      showToast("Error al sincronizar favorito: " + (err.message || "Revisa tu conexión"));
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  /**
   * Manejador desde el botón de la ficha de detalle
   */
  window.toggleCurrentItemFavoriteFromModal = function() {
    var currentId = window.currentDetailId;
    if (!currentId) return;
    var it = null;
    if (typeof window.findCatalogItem === 'function') {
      it = window.findCatalogItem(currentId);
    } else if (Array.isArray(window.allItems)) {
      it = window.allItems.find(function(i) { return i.id === currentId; });
    }
    if (it) {
      window.toggleCatalogItemFavorite(it);
    }
  };

  // ============================================================
  // ⭐ RESEÑAS Y VALORACIONES DE LA COMUNIDAD (catalog_reviews)
  // ============================================================

  /**
   * Carga las reseñas y valoraciones de un ítem desde 'catalog_reviews'
   */
  window.loadCatalogItemReviews = async function(item) {
    var communitySection = document.getElementById("communitySection");
    var communityList = document.getElementById("communityReviewsList");
    var starPicker = document.getElementById("starPicker");
    var reviewInput = document.getElementById("reviewTextInput");
    var saveReviewBtn = document.getElementById("saveReviewBtn");
    var reviewSavedNote = document.getElementById("reviewSavedNote");

    if (!item || !communitySection || !communityList) return;

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    var key = getReviewItemKey(item);

    communitySection.style.display = "block";
    communityList.innerHTML = '<div style="color:#00E5FF; font-size:0.85rem; padding:10px 0; text-align:center;">⏳ Cargando reseñas de la comunidad...</div>';

    if (!supabase) {
      communityList.innerHTML = '<div style="color:#94A3B8; font-size:0.82rem; padding:8px 0;">Las reseñas online se mostrarán al conectar con internet.</div>';
      return;
    }

    try {
      var res = await supabase
        .from("catalog_reviews")
        .select("id,user_id,rating,body,created_at")
        .eq("external_item_id", key)
        .order("created_at", { ascending: false })
        .limit(50);

      if (res.error) throw res.error;

      var reviews = res.data || [];
      reviewsCacheByKey.set(key, reviews);

      // Calcular promedio de estrellas
      var count = reviews.length;
      var average = count ? reviews.reduce(function(sum, r) { return sum + (Number(r.rating) || 0); }, 0) / count : 0;

      // Buscar nombres y perfiles de los autores de las reseñas
      var userIds = Array.from(new Set(reviews.map(function(r) { return r.user_id; }).filter(Boolean)));
      var profileMap = new Map();

      if (userIds.length > 0) {
        var profRes = await supabase
          .from("profiles")
          .select("id,display_name,username,avatar_url")
          .in("id", userIds);

        if (!profRes.error && Array.isArray(profRes.data)) {
          profRes.data.forEach(function(p) {
            profileMap.set(p.id, p);
          });
        }
      }

      // Comprobar si el usuario actual ya tiene una reseña para pre-rellenar el formulario
      var ownReview = user ? reviews.find(function(r) { return r.user_id === user.id; }) : null;
      if (ownReview) {
        if (reviewInput) reviewInput.value = ownReview.body || "";
        if (starPicker && typeof starPicker._setSelected === "function") {
          starPicker._setSelected(ownReview.rating);
        }
        if (saveReviewBtn) saveReviewBtn.textContent = "✏️ Actualizar mi reseña";
        if (reviewSavedNote) {
          reviewSavedNote.textContent = "✓ Tu reseña está publicada";
          reviewSavedNote.style.display = "inline";
        }
      } else {
        if (reviewSavedNote) reviewSavedNote.style.display = "none";
        if (saveReviewBtn) saveReviewBtn.textContent = "💾 Guardar y publicar reseña";
      }

      // Renderizar resumen de estrellas
      var html = '';
      if (count > 0) {
        var fullStars = Math.round(average);
        var starStr = "★".repeat(fullStars) + "☆".repeat(5 - fullStars);
        html += '<div class="joa-review-summary-banner">';
        html += '  <div class="joa-review-summary-left">';
        html += '    <span class="joa-review-big-score">' + average.toFixed(1) + '</span>';
        html += '    <div>';
        html += '      <div class="joa-review-stars">' + starStr + '</div>';
        html += '      <small style="color:#CBD5E1;">Basado en ' + count + (count === 1 ? ' reseña' : ' reseñas') + ' en JOA Multiverso</small>';
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
      }

      // Renderizar lista de opiniones
      if (reviews.length === 0) {
        html += '<div style="text-align:center; padding:16px 10px; color:#94A3B8; font-size:0.85rem; background:rgba(255,255,255,0.03); border-radius:10px;">';
        html += '  💬 Sé el primero en dejar una reseña para este título.';
        html += '</div>';
      } else {
        reviews.forEach(function(r) {
          var p = profileMap.get(r.user_id);
          var authorName = p?.display_name || p?.username || "Jugador JOA";
          var authorAvatar = p?.avatar_url || null;
          var stars = "★".repeat(r.rating || 0) + "☆".repeat(5 - (r.rating || 0));
          var dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : "";

          html += '<article class="joa-community-review-card">';
          html += '  <div class="joa-review-top-row">';
          html += '    <div class="joa-reviewer-info">';
          html += '      <div class="joa-reviewer-avatar">';
          if (authorAvatar) {
            html += '        <img src="' + authorAvatar + '" alt="" onerror="this.remove()">';
          } else {
            html += '        <span>' + authorName.slice(0, 2).toUpperCase() + '</span>';
          }
          html += '      </div>';
          html += '      <b class="joa-reviewer-name">' + authorName + '</b>';
          html += '    </div>';
          html += '    <span class="joa-review-stars">' + stars + '</span>';
          html += '  </div>';
          if (r.body) {
            html += '  <p class="joa-review-body">' + r.body + '</p>';
          }
          if (dateStr) {
            html += '  <small class="joa-review-date">' + dateStr + '</small>';
          }
          html += '</article>';
        });
      }

      communityList.innerHTML = html;

    } catch (err) {
      console.warn("JOA Sync: Error al cargar opiniones de la comunidad:", err);
      communityList.innerHTML = '<div style="color:#FF6B6B; font-size:0.82rem; padding:8px 0;">No se pudieron cargar las opiniones de la comunidad.</div>';
    }
  };

  /**
   * Guarda o actualiza una reseña en Supabase ('catalog_reviews') y en local
   */
  window.saveMyReviewUnified = async function() {
    if (window.triggerHaptic) window.triggerHaptic(50);
    var currentId = window.currentDetailId;
    if (!currentId) return;

    var it = null;
    if (typeof window.findCatalogItem === 'function') {
      it = window.findCatalogItem(currentId);
    } else if (Array.isArray(window.allItems)) {
      it = window.allItems.find(function(i) { return i.id === currentId; });
    }
    if (!it) return;

    var container = document.getElementById('starPicker');
    var rating = container && typeof container._getSelected === 'function' ? container._getSelected() : 0;
    var commentInput = document.getElementById('reviewTextInput');
    var comment = commentInput ? commentInput.value.trim() : "";
    var saveReviewBtn = document.getElementById("saveReviewBtn");
    var reviewSavedNote = document.getElementById("reviewSavedNote");

    if (rating === 0 && !comment) {
      showToast("Elige al menos una calificación de 1 a 5 estrellas o escribe tu opinión.");
      return;
    }

    // 1. Guardar siempre en IndexedDB local para persistencia offline
    if (typeof window.idbPut === 'function') {
      await window.idbPut('user_reviews', {
        itemId: currentId,
        rating: rating,
        comment: comment,
        updatedAt: new Date().toISOString()
      });
    }

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;

    // 2. Si el usuario está autenticado, sincronizar en tiempo real con Supabase
    if (supabase && user) {
      if (saveReviewBtn) {
        saveReviewBtn.disabled = true;
        saveReviewBtn.textContent = "⏳ Publicando en JOA...";
      }

      var key = getReviewItemKey(it);
      var payload = {
        external_item_id: key,
        item_title: getItemTitle(it).slice(0, 300),
        item_type: getItemType(it),
        cover_url: getItemCover(it) || null,
        user_id: user.id,
        rating: rating || 5,
        body: comment,
        updated_at: new Date().toISOString()
      };

      try {
        var upsertRes = await supabase
          .from("catalog_reviews")
          .upsert(payload, { onConflict: "external_item_id,user_id" });

        if (upsertRes.error) throw upsertRes.error;

        showToast("¡Reseña publicada en JOA Multiverso!");
        if (reviewSavedNote) {
          reviewSavedNote.textContent = "✓ Compartida en la web";
          reviewSavedNote.style.display = "inline";
        }

        // Recargar reseñas actualizadas
        await window.loadCatalogItemReviews(it);

      } catch (err) {
        console.error("JOA Review Supabase Error:", err);
        showToast("Guardada localmente. (Fallo al subir a la nube: " + (err.message || "Sin conexión") + ")");
      } finally {
        if (saveReviewBtn) {
          saveReviewBtn.disabled = false;
          saveReviewBtn.textContent = "✏️ Actualizar mi reseña";
        }
      }
    } else {
      // Usuario no autenticado
      if (reviewSavedNote) {
        reviewSavedNote.textContent = "✓ Guardada en este teléfono";
        reviewSavedNote.style.display = "inline";
      }
      showToast("Reseña guardada localmente. Inicia sesión para publicarla en la web.");
    }
  };

  // Escuchar eventos de cambio de autenticación
  window.addEventListener("joa-auth-change", function(e) {
    if (e.detail?.user) {
      loadUserCatalogFavorites();
    } else {
      catalogFavorites = [];
      catalogFavoritesByKey.clear();
      updateFavoriteCountBadge();
      updateFavoriteDetailBtn();
    }
  });

  // Carga inicial al arrancar
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      setTimeout(loadUserCatalogFavorites, 600);
    });
  } else {
    setTimeout(loadUserCatalogFavorites, 600);
  }

})();
