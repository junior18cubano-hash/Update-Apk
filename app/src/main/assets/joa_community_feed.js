/**
 * ============================================================
 * 🌐 JOA GAMERS · MURO SOCIAL DE LA COMUNIDAD (SUPABASE)
 * Etapa 3: Publicaciones, Comentarios y Reacciones en tiempo real
 * ============================================================
 */
(function() {
  'use strict';

  var isFeedLoading = false;
  var currentFeedPosts = [];

  function getInitials(name) {
    if (!name) return "JOA";
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
   * Abre la ventana flotante del Muro de la Comunidad
   */
  window.openJoaCommunityModal = function() {
    var modal = document.getElementById("joaCommunityModal");
    if (!modal) return;
    modal.style.display = "flex";
    modal.classList.add("modal-active");
    document.body.style.overflow = "hidden";

    // Actualizar formulario de creación con datos del usuario activo
    updateComposerProfileUI();

    // Activar pestaña por defecto si no hay una activa
    if (window.switchCommunityTab) {
      var activeTabBtn = document.querySelector(".joa-comm-tab.active");
      var currentTab = activeTabBtn ? activeTabBtn.getAttribute("data-tab") : "feed";
      window.switchCommunityTab(currentTab || "feed");
    } else {
      window.loadCommunityFeed();
    }
  };

  /**
   * Cierra la ventana del Muro de la Comunidad
   */
  window.closeJoaCommunityModal = function() {
    var modal = document.getElementById("joaCommunityModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.classList.remove("modal-active");
    document.body.style.overflow = "";

    // Cerrar cualquier chat activo y detener sondas en segundo plano
    if (window.closeActiveChatWindow) {
      window.closeActiveChatWindow();
    }
  };

  /**
   * Actualiza el compositor según si el usuario está autenticado o no
   */
  function updateComposerProfileUI() {
    var composerWrap = document.getElementById("joaCommunityComposer");
    var guestPrompt = document.getElementById("joaCommunityGuestPrompt");
    var avatarEl = document.getElementById("joaComposerAvatar");
    var nameEl = document.getElementById("joaComposerName");

    var user = window.joaCurrentUser;
    var profile = window.joaCurrentProfile;

    if (user) {
      if (composerWrap) composerWrap.style.display = "block";
      if (guestPrompt) guestPrompt.style.display = "none";

      var displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Jugador JOA";
      var username = profile?.username ? "@" + profile.username : "";
      var avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url;

      if (nameEl) nameEl.textContent = displayName + (username ? " (" + username + ")" : "");
      if (avatarEl) {
        if (avatarUrl) {
          avatarEl.innerHTML = '<img src="' + avatarUrl + '" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" onerror="this.onerror=null; this.parentElement.textContent=\'' + getInitials(displayName) + '\';">';
        } else {
          avatarEl.textContent = getInitials(displayName);
        }
      }
    } else {
      if (composerWrap) composerWrap.style.display = "none";
      if (guestPrompt) guestPrompt.style.display = "flex";
    }
  }

  /**
   * Carga las publicaciones del feed social desde Supabase
   */
  window.loadCommunityFeed = async function() {
    var host = document.getElementById("joaCommunityFeedList");
    if (!host) return;

    var supabase = window.joaSupabase;
    if (!supabase) {
      host.innerHTML = '<div class="joa-feed-empty"><p>Conectando con el servidor de la comunidad...</p></div>';
      return;
    }

    if (isFeedLoading) return;
    isFeedLoading = true;

    host.innerHTML = '<div style="text-align:center; padding:28px 10px; color:#00E5FF; font-weight:700;">' +
      '<div style="font-size:1.8rem; margin-bottom:8px;">⏳</div>' +
      '<div>Cargando publicaciones de la comunidad JOA...</div>' +
      '</div>';

    try {
      // 1. Obtener publicaciones (tabla 'posts')
      var postsRes = await supabase
        .from("posts")
        .select("id,author_id,body,media_url,created_at")
        .order("created_at", { ascending: false })
        .limit(40);

      if (postsRes.error) throw postsRes.error;

      var posts = postsRes.data || [];
      currentFeedPosts = posts;

      if (!posts.length) {
        host.innerHTML = '<div class="joa-feed-empty" style="text-align:center; padding:35px 15px; color:#94A3B8;">' +
          '<div style="font-size:2.5rem; margin-bottom:10px;">✦</div>' +
          '<h3 style="color:#FFF; font-size:1.15rem; margin:0 0 6px;">La comunidad espera su primera publicación</h3>' +
          '<p style="font-size:0.85rem; margin:0;">Publica algo arriba y abre la conversación con los jugadores de JOA Multiverso.</p>' +
          '</div>';
        isFeedLoading = false;
        return;
      }

      var authorIds = Array.from(new Set(posts.map(function(p) { return p.author_id; }).filter(Boolean)));
      var postIds = posts.map(function(p) { return p.id; });

      // 2. Cargar perfiles, reacciones y comentarios en paralelo
      var results = await Promise.all([
        supabase.from("profiles").select("id,username,display_name,avatar_url").in("id", authorIds),
        supabase.from("post_reactions").select("post_id,user_id,reaction").in("post_id", postIds),
        supabase.from("post_comments").select("id,post_id,author_id,body,created_at").in("post_id", postIds).order("created_at", { ascending: true })
      ]);

      var profilesRes = results[0];
      var reactionsRes = results[1];
      var commentsRes = results[2];

      var profilesMap = new Map();
      if (!profilesRes.error && Array.isArray(profilesRes.data)) {
        profilesRes.data.forEach(function(p) { profilesMap.set(p.id, p); });
      }

      var reactions = (!reactionsRes.error && Array.isArray(reactionsRes.data)) ? reactionsRes.data : [];
      var comments = (!commentsRes.error && Array.isArray(commentsRes.data)) ? commentsRes.data : [];

      // Cargar perfiles de autores de comentarios faltantes
      var commentAuthorIds = Array.from(new Set(comments.map(function(c) { return c.author_id; }).filter(function(id) {
        return id && !profilesMap.has(id);
      })));

      if (commentAuthorIds.length > 0) {
        var extraProf = await supabase.from("profiles").select("id,username,display_name,avatar_url").in("id", commentAuthorIds);
        if (!extraProf.error && Array.isArray(extraProf.data)) {
          extraProf.data.forEach(function(p) { profilesMap.set(p.id, p); });
        }
      }

      // 3. Renderizar cada publicación
      var currentUser = window.joaCurrentUser;
      var currentUserId = currentUser ? currentUser.id : null;

      var html = '';
      posts.forEach(function(post) {
        var profile = profilesMap.get(post.author_id) || {};
        var authorName = profile.display_name || profile.username || "Jugador JOA";
        var authorHandle = profile.username ? "@" + profile.username : "";
        var authorAvatar = profile.avatar_url;
        var isMine = currentUserId && post.author_id === currentUserId;

        var postReactions = reactions.filter(function(r) { return r.post_id === post.id; });
        var ownReaction = currentUserId ? postReactions.find(function(r) { return r.user_id === currentUserId; }) : null;
        var postComments = comments.filter(function(c) { return c.post_id === post.id; });

        var dateStr = post.created_at ? new Date(post.created_at).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" }) : "";

        html += '<article class="joa-feed-card" id="post-' + post.id + '">';
        
        // Cabecera del post
        html += '  <div class="joa-feed-head">';
        html += '    <div class="joa-feed-author-wrap">';
        html += '      <div class="joa-feed-avatar">';
        if (authorAvatar) {
          html += '        <img src="' + escapeHtml(authorAvatar) + '" alt="" onerror="this.remove()">';
        } else {
          html += '        <span>' + getInitials(authorName) + '</span>';
        }
        html += '      </div>';
        html += '      <div class="joa-feed-author-info">';
        html += '        <b class="joa-feed-author-name">' + escapeHtml(authorName) + '</b>';
        html += '        <small class="joa-feed-author-meta">' + (authorHandle ? escapeHtml(authorHandle) + ' · ' : '') + escapeHtml(dateStr) + '</small>';
        html += '      </div>';
        html += '    </div>';

        if (isMine) {
          html += '    <button type="button" class="joa-feed-delete-btn" onclick="deleteCommunityPost(\'' + post.id + '\')" title="Eliminar publicación">🗑️</button>';
        }
        html += '  </div>';

        // Cuerpo del post
        html += '  <p class="joa-feed-body">' + escapeHtml(post.body) + '</p>';

        if (post.media_url) {
          html += '  <a href="' + escapeHtml(post.media_url) + '" target="_blank" rel="noopener" class="joa-feed-media-link">📎 Ver contenido adjunto ↗</a>';
        }

        // Barra de acciones (Me gusta / Comentar)
        var reactedClass = ownReaction ? ' is-reacted' : '';
        var heartIcon = ownReaction ? '❤️' : '🤍';

        html += '  <div class="joa-feed-actions">';
        html += '    <button type="button" class="joa-feed-action-btn' + reactedClass + '" onclick="toggleCommunityReaction(\'' + post.id + '\', ' + (ownReaction ? 'true' : 'false') + ')">';
        html += '      <span>' + heartIcon + '</span><span>' + postReactions.length + ' Me gusta</span>';
        html += '    </button>';
        html += '    <button type="button" class="joa-feed-action-btn" onclick="togglePostCommentsView(\'' + post.id + '\')">';
        html += '      <span>💬</span><span>' + postComments.length + ' Comentarios</span>';
        html += '    </button>';
        html += '  </div>';

        // Caja desplegable de comentarios
        html += '  <div class="joa-feed-comments-box" id="comments-box-' + post.id + '" style="display:none;">';
        html += '    <div class="joa-comments-list" id="comments-list-' + post.id + '">';
        
        if (postComments.length === 0) {
          html += '      <p class="joa-no-comments">No hay comentarios aún. ¡Escribe el primero!</p>';
        } else {
          postComments.forEach(function(c) {
            var cProfile = profilesMap.get(c.author_id) || {};
            var cName = cProfile.display_name || cProfile.username || "Jugador";
            var cDate = c.created_at ? new Date(c.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "";
            html += '      <div class="joa-comment-item">';
            html += '        <b class="joa-comment-author">' + escapeHtml(cName) + ':</b> ';
            html += '        <span class="joa-comment-text">' + escapeHtml(c.body) + '</span>';
            if (cDate) {
              html += '        <small class="joa-comment-time">' + escapeHtml(cDate) + '</small>';
            }
            html += '      </div>';
          });
        }
        html += '    </div>';

        // Formulario de nuevo comentario
        if (currentUser) {
          html += '    <form class="joa-comment-form" onsubmit="submitCommunityComment(event, \'' + post.id + '\')">';
          html += '      <input type="text" id="comment-input-' + post.id + '" class="joa-comment-input" placeholder="Escribe un comentario..." maxlength="2000" required>';
          html += '      <button type="submit" class="joa-comment-send-btn">Enviar</button>';
          html += '    </form>';
        } else {
          html += '    <div style="font-size:0.75rem; color:#94A3B8; margin-top:8px; text-align:center;">';
          html += '      <a href="javascript:void(0)" onclick="openJoaAuthModal()" style="color:#00E5FF; text-decoration:underline;">Inicia sesión</a> para comentar.';
          html += '    </div>';
        }

        html += '  </div>'; // fin joa-feed-comments-box
        html += '</article>';
      });

      host.innerHTML = html;

    } catch (err) {
      console.error("JOA Community Feed Error:", err);
      host.innerHTML = '<div class="joa-feed-empty"><p style="color:#FF5252;">Error al cargar publicaciones: ' + (err.message || 'Sin conexión') + '</p></div>';
    } finally {
      isFeedLoading = false;
    }
  };

  /**
   * Publicar un nuevo mensaje en el feed ('posts')
   */
  window.submitCommunityPost = async function(event) {
    if (event) event.preventDefault();
    var user = window.joaCurrentUser;
    if (!user) {
      if (typeof window.openJoaAuthModal === "function") window.openJoaAuthModal();
      showToast("Inicia sesión para publicar en la comunidad.");
      return;
    }

    var supabase = window.joaSupabase;
    if (!supabase) return;

    var input = document.getElementById("joaCommunityPostBody");
    var submitBtn = document.getElementById("joaCommunityPostBtn");
    var body = input ? input.value.trim() : "";

    if (!body) {
      showToast("Escribe algo antes de publicar.");
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳ Publicando...</span>';
    }

    try {
      var res = await supabase.from("posts").insert({
        author_id: user.id,
        body: body
      });

      if (res.error) throw res.error;

      if (input) input.value = "";
      showToast("¡Publicación compartida en JOA Multiverso!");
      await window.loadCommunityFeed();

    } catch (err) {
      console.error("JOA Post Error:", err);
      showToast("Error al publicar: " + (err.message || "Revisa tu conexión"));
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>🚀 Publicar</span>';
      }
    }
  };

  /**
   * Alternar Me gusta / Reacción ('post_reactions')
   */
  window.toggleCommunityReaction = async function(postId, isCurrentlyReacted) {
    var user = window.joaCurrentUser;
    if (!user) {
      if (typeof window.openJoaAuthModal === "function") window.openJoaAuthModal();
      showToast("Inicia sesión para reaccionar a las publicaciones.");
      return;
    }

    var supabase = window.joaSupabase;
    if (!supabase) return;

    try {
      if (isCurrentlyReacted) {
        var delRes = await supabase
          .from("post_reactions")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", user.id);

        if (delRes.error) throw delRes.error;
      } else {
        var insRes = await supabase
          .from("post_reactions")
          .insert({
            post_id: postId,
            user_id: user.id,
            reaction: "like"
          });

        if (insRes.error) throw insRes.error;
      }

      await window.loadCommunityFeed();

    } catch (err) {
      console.error("JOA Reaction Error:", err);
      showToast("Error al registrar reacción: " + (err.message || "Revisa tu conexión"));
    }
  };

  /**
   * Mostrar u ocultar comentarios de una publicación
   */
  window.togglePostCommentsView = function(postId) {
    var box = document.getElementById("comments-box-" + postId);
    if (!box) return;
    if (box.style.display === "none" || !box.style.display) {
      box.style.display = "block";
      var input = document.getElementById("comment-input-" + postId);
      if (input) setTimeout(function() { input.focus(); }, 100);
    } else {
      box.style.display = "none";
    }
  };

  /**
   * Enviar un comentario en una publicación ('post_comments')
   */
  window.submitCommunityComment = async function(event, postId) {
    if (event) event.preventDefault();
    var user = window.joaCurrentUser;
    if (!user) {
      if (typeof window.openJoaAuthModal === "function") window.openJoaAuthModal();
      showToast("Inicia sesión para comentar.");
      return;
    }

    var supabase = window.joaSupabase;
    if (!supabase) return;

    var input = document.getElementById("comment-input-" + postId);
    var body = input ? input.value.trim() : "";
    if (!body) return;

    try {
      var res = await supabase.from("post_comments").insert({
        post_id: postId,
        author_id: user.id,
        body: body
      });

      if (res.error) throw res.error;

      if (input) input.value = "";
      showToast("Comentario publicado.");
      await window.loadCommunityFeed();

      // Mantener caja de comentarios abierta
      var box = document.getElementById("comments-box-" + postId);
      if (box) box.style.display = "block";

    } catch (err) {
      console.error("JOA Comment Error:", err);
      showToast("Error al enviar comentario: " + (err.message || "Revisa tu conexión"));
    }
  };

  /**
   * Eliminar una publicación propia ('posts')
   */
  window.deleteCommunityPost = async function(postId) {
    if (!confirm("¿Deseas eliminar esta publicación?")) return;
    var user = window.joaCurrentUser;
    if (!user) return;

    var supabase = window.joaSupabase;
    if (!supabase) return;

    try {
      var res = await supabase
        .from("posts")
        .delete()
        .eq("id", postId)
        .eq("author_id", user.id);

      if (res.error) throw res.error;

      showToast("Publicación eliminada.");
      await window.loadCommunityFeed();

    } catch (err) {
      console.error("JOA Delete Post Error:", err);
      showToast("Error al eliminar: " + (err.message || "No autorizado"));
    }
  };

  // Re-evaluar UI de compositor en cambios de autenticación
  window.addEventListener("joa-auth-change", function() {
    updateComposerProfileUI();
  });

})();
