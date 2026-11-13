/**
 * ============================================================
 * 🎁 JOA GAMERS · NOTIFICACIONES, RECOMPENSAS Y SERVICIOS
 * Etapa 5: Integración completa con Supabase JOA Multiverso
 * Tablas: notifications, reward_campaigns, reward_claims, services
 * ============================================================
 */
(function() {
  'use strict';

  var notificationRows = [];
  var notificationsChannel = null;
  var cachedCampaigns = [];
  var cachedClaims = [];
  var cachedServices = [];
  var activeRewardCampaign = null;
  var selectedRewardProducts = [];

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatRelativeTime(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      var now = new Date();
      var diffMs = now - d;
      var diffMins = Math.floor(diffMs / (1000 * 60));
      if (diffMins < 1) return 'Ahora';
      if (diffMins < 60) return 'Hace ' + diffMins + ' min';
      var diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return 'Hace ' + diffHours + ' h';
      var diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return 'Hace ' + diffDays + ' d';
      return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    } catch (e) {
      return '';
    }
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

  /* ============================================================
   * 🔔 CENTRO DE NOTIFICACIONES (TABLA notifications)
   * ============================================================ */

  /**
   * Carga las notificaciones del usuario actual desde Supabase
   */
  window.loadUserNotifications = async function() {
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    var badge = document.getElementById("topbarNotifBadge");
    var host = document.getElementById("joaNotificationsListHost");

    if (!user || !supabase) {
      if (badge) badge.style.display = 'none';
      if (host) {
        host.innerHTML = '<div class="joa-feed-empty" style="padding:24px 10px;">' +
          '<div style="font-size:2rem; margin-bottom:8px;">🔔</div>' +
          '<p>Inicia sesión para recibir alertas de la comunidad, regalos y amigos.</p>' +
          '<button type="button" class="btn btn-primary" onclick="openJoaAuthModal()" style="margin-top:10px; padding:8px 16px;">👤 Iniciar Sesión</button>' +
          '</div>';
      }
      return;
    }

    try {
      var res = await supabase.from("notifications")
        .select("id,user_id,type,title,body,data,read_at,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(40);

      if (res.error) {
        console.error("Error al cargar notifications:", res.error);
        return;
      }

      notificationRows = res.data || [];
      var unreadCount = notificationRows.filter(function(n) { return !n.read_at; }).length;

      // Actualizar badge superior
      if (badge) {
        if (unreadCount > 0) {
          badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }

      renderNotificationsUI();
      ensureNotificationsRealtime();

    } catch (e) {
      console.error("Excepción en loadUserNotifications:", e);
    }
  };

  /**
   * Renderiza las notificaciones en el modal
   */
  function renderNotificationsUI() {
    var host = document.getElementById("joaNotificationsListHost");
    if (!host) return;

    if (notificationRows.length === 0) {
      host.innerHTML = '<div class="joa-feed-empty" style="padding:24px 10px;">' +
        '<div style="font-size:2rem; margin-bottom:8px;">🔕</div>' +
        '<p>No tienes notificaciones pendientes.</p>' +
        '<small style="color:#64748B;">Aquí verás avisos de regalos, amigos, chats y reseñas.</small>' +
        '</div>';
      return;
    }

    var html = '<div class="joa-notif-items-list">';
    notificationRows.forEach(function(item) {
      var isUnread = !item.read_at;
      var timeStr = formatRelativeTime(item.created_at);
      var typeIcon = '🔔';
      if (item.type === 'service_reward_claimed' || item.type === 'reward_approved' || item.type === 'reward_delivered') {
        typeIcon = '🎁';
      } else if (item.type === 'friend_request' || item.type === 'friend_accepted') {
        typeIcon = '👥';
      } else if (item.type === 'post_comment' || item.type === 'message') {
        typeIcon = '💬';
      } else if (item.type === 'post_reaction') {
        typeIcon = '❤️';
      }

      html += '<div class="joa-notif-item ' + (isUnread ? 'unread' : '') + '" onclick="handleNotificationClick(\'' + item.id + '\')">' +
        '<div class="joa-notif-icon-col">' +
          '<span class="joa-notif-type-icon">' + typeIcon + '</span>' +
          (isUnread ? '<span class="joa-notif-unread-dot"></span>' : '') +
        '</div>' +
        '<div class="joa-notif-body-col">' +
          '<div class="joa-notif-head">' +
            '<strong>' + escapeHtml(item.title || "Notificación de JOA") + '</strong>' +
            '<small class="joa-notif-time">' + timeStr + '</small>' +
          '</div>' +
          '<p class="joa-notif-desc">' + escapeHtml(item.body || "") + '</p>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';

    host.innerHTML = html;
  }

  /**
   * Abre el modal de notificaciones
   */
  window.openJoaNotificationsModal = function() {
    var modal = document.getElementById("joaNotificationsModal");
    if (!modal) return;
    modal.style.display = "flex";
    modal.classList.add("modal-active");
    document.body.style.overflow = "hidden";
    window.loadUserNotifications();
  };

  /**
   * Cierra el modal de notificaciones
   */
  window.closeJoaNotificationsModal = function() {
    var modal = document.getElementById("joaNotificationsModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.classList.remove("modal-active");
    document.body.style.overflow = "";
  };

  /**
   * Marca una notificación como leída y ejecuta su acción si la tiene
   */
  window.handleNotificationClick = async function(notificationId) {
    var item = notificationRows.find(function(n) { return n.id === notificationId; });
    if (!item) return;

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;

    if (supabase && user && !item.read_at) {
      item.read_at = new Date().toISOString();
      renderNotificationsUI();
      // Enviar actualización a Supabase
      supabase.from("notifications")
        .update({ read_at: item.read_at })
        .eq("id", notificationId)
        .eq("user_id", user.id)
        .then(function() {});
    }

    // Redirigir según el tipo
    if (item.type === 'service_reward_claimed' || item.type === 'reward_approved') {
      window.closeJoaNotificationsModal();
      window.openJoaRewardsModal();
    } else if (item.type === 'friend_request' || item.type === 'friend_accepted') {
      window.closeJoaNotificationsModal();
      if (window.openJoaCommunityTab) window.openJoaCommunityTab('friends');
    } else if (item.type === 'message') {
      window.closeJoaNotificationsModal();
      if (window.openJoaCommunityTab) window.openJoaCommunityTab('messages');
    } else if (item.type === 'post_comment' || item.type === 'post_reaction') {
      window.closeJoaNotificationsModal();
      if (window.openJoaCommunityTab) window.openJoaCommunityTab('feed');
    }
  };

  /**
   * Marca todas las notificaciones como leídas
   */
  window.markAllNotificationsRead = async function() {
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user) return;

    try {
      var nowIso = new Date().toISOString();
      var res = await supabase.from("notifications")
        .update({ read_at: nowIso })
        .eq("user_id", user.id)
        .is("read_at", null);

      if (res.error) {
        showToast("No se pudieron marcar como leídas.");
        return;
      }

      notificationRows.forEach(function(n) { n.read_at = nowIso; });
      var badge = document.getElementById("topbarNotifBadge");
      if (badge) badge.style.display = 'none';

      renderNotificationsUI();
      showToast("Todas las notificaciones marcadas como leídas.");
    } catch (e) {
      console.error("Error en markAllNotificationsRead:", e);
    }
  };

  /**
   * Suscribe en tiempo real a las notificaciones entrantes
   */
  function ensureNotificationsRealtime() {
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user || notificationsChannel) return;

    try {
      notificationsChannel = supabase.channel("joa-user-notifs-" + user.id)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: "user_id=eq." + user.id
        }, function(payload) {
          var newNotif = payload.new;
          if (newNotif) {
            notificationRows.unshift(newNotif);
            showToast("🔔 " + (newNotif.title || "Nueva notificación"));
            var badge = document.getElementById("topbarNotifBadge");
            if (badge) {
              var unread = notificationRows.filter(function(n) { return !n.read_at; }).length;
              badge.textContent = unread > 99 ? '99+' : unread;
              badge.style.display = 'inline-block';
            }
            renderNotificationsUI();
          }
        })
        .subscribe();
    } catch (err) {
      console.warn("No se pudo conectar realtime para notificaciones:", err);
    }
  }


  /* ============================================================
   * 🎁 SISTEMA JOA REWARDS Y REGALOS (reward_campaigns, reward_claims)
   * ============================================================ */

  /**
   * Lee la descripción o productos dentro de reward_details
   */
  function parseRewardBundle(details) {
    var raw = String(details || "");
    var prefix = "JOA_REWARD_BUNDLE_V1::";
    if (!raw.startsWith(prefix)) return { text: raw, products: [] };
    try {
      var data = JSON.parse(raw.slice(prefix.length));
      return {
        text: String(data.text || ""),
        products: Array.isArray(data.products) ? data.products.slice(0, 12) : []
      };
    } catch (e) {
      return { text: raw, products: [] };
    }
  }

  /**
   * Carga las campañas de recompensas activas y el historial del usuario
   */
  window.loadRewardCampaigns = async function() {
    var hostCampaigns = document.getElementById("joaRewardsCampaignsHost");
    var hostClaims = document.getElementById("joaMyRewardClaimsHost");
    if (!hostCampaigns) return;

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;

    hostCampaigns.innerHTML = '<p class="joa-loading-text">Cargando paquetes de recompensa...</p>';

    try {
      var nowIso = new Date().toISOString();
      var cQuery = supabase.from("reward_campaigns")
        .select("id,title,description,image_url,reward_type,reward_details,campaign_kind,service_id,reward_product_count,starts_at,ends_at,status,min_days_member,min_posts,min_comments,min_messages,min_reactions,min_merit_points")
        .eq("status", "published")
        .lte("starts_at", nowIso)
        .order("created_at", { ascending: false })
        .limit(20);

      var myClaimsQuery = (user && supabase) ?
        supabase.from("reward_claims").select("id,campaign_id,status,created_at,selected_products,eligibility_snapshot").eq("user_id", user.id) :
        Promise.resolve({ data: [] });

      var sQuery = supabase.from("services")
        .select("id,title,slug,description,is_active")
        .eq("is_active", true);

      var results = await Promise.all([cQuery, myClaimsQuery, sQuery]);
      cachedCampaigns = results[0].data || [];
      cachedClaims = results[1].data || [];
      cachedServices = results[2].data || [];

      var serviceMap = {};
      cachedServices.forEach(function(s) { serviceMap[s.id] = s; });

      var claimMap = {};
      cachedClaims.forEach(function(cl) { claimMap[cl.campaign_id] = cl; });

      // Renderizar campañas
      if (cachedCampaigns.length === 0) {
        hostCampaigns.innerHTML = '<div class="joa-feed-empty" style="padding:24px 10px;">' +
          '<div style="font-size:2rem; margin-bottom:8px;">🎁</div>' +
          '<p>Próximamente publicaremos nuevos paquetes de regalos y recompensas.</p>' +
          '<small style="color:#64748B;">¡Mantén tu actividad en la comunidad para participar!</small>' +
          '</div>';
      } else {
        var html = '<div class="joa-rewards-grid">';
        cachedCampaigns.forEach(function(c) {
          var bundle = parseRewardBundle(c.reward_details);
          var isService = (c.campaign_kind === 'service_purchase');
          var associatedService = c.service_id ? serviceMap[c.service_id] : null;
          var myClaim = claimMap[c.id];

          var actionHtml = '';
          if (myClaim) {
            var st = myClaim.status;
            if (st === 'approved') {
              actionHtml = '<span class="joa-claim-badge approved">✓ Aprobado para entrega</span>';
            } else if (st === 'delivered') {
              actionHtml = '<span class="joa-claim-badge delivered">🎁 Entregado en local</span>';
            } else if (st === 'rejected') {
              actionHtml = '<span class="joa-claim-badge rejected">✕ No aprobado</span>';
            } else {
              actionHtml = '<span class="joa-claim-badge pending">⏳ Solicitud Reservada</span>';
            }
          } else if (user) {
            if (isService) {
              actionHtml = '<button type="button" class="joa-btn-claim-reward" onclick="openServiceRewardPicker(\'' + c.id + '\')">' +
                '<span>🎁 Elegir ' + (c.reward_product_count || 3) + ' Productos</span>' +
              '</button>';
            } else {
              actionHtml = '<button type="button" class="joa-btn-claim-reward" onclick="claimCommunityReward(\'' + c.id + '\')">' +
                '<span>🚀 Participar</span>' +
              '</button>';
            }
          } else {
            actionHtml = '<button type="button" class="joa-btn-claim-reward" onclick="openJoaAuthModal()">' +
              '<span>👤 Iniciar Sesión para Reclamar</span>' +
            '</button>';
          }

          html += '<div class="joa-reward-card">' +
            '<div class="joa-reward-card-header">' +
              '<span class="joa-reward-kind-pill ' + (isService ? 'service' : 'community') + '">' +
                (isService ? '🛠️ Regalo con Servicio Informático' : '🌐 Recompensa de Comunidad') +
              '</span>' +
              '<span class="joa-reward-prize-txt">' + escapeHtml(c.reward_type || "Regalo JOA") + '</span>' +
            '</div>' +
            '<h4 class="joa-reward-title">' + escapeHtml(c.title) + '</h4>' +
            (c.description ? '<p class="joa-reward-desc">' + escapeHtml(c.description) + '</p>' : '') +
            (isService && associatedService ? 
              '<div class="joa-reward-req-box">🛠️ <b>Servicio:</b> ' + escapeHtml(associatedService.title) + '<br>🎁 <b>Elige:</b> exactamente ' + (c.reward_product_count || 3) + ' productos del catálogo JOA.</div>' : '') +
            (bundle.text ? '<div class="joa-reward-bundle-note">📦 ' + escapeHtml(bundle.text) + '</div>' : '') +
            '<div class="joa-reward-card-actions">' + actionHtml + '</div>' +
          '</div>';
        });
        html += '</div>';
        hostCampaigns.innerHTML = html;
      }

      // Renderizar Mis Solicitudes / Historial
      if (hostClaims) {
        if (!user || cachedClaims.length === 0) {
          hostClaims.innerHTML = '<p style="color:#64748B; font-size:0.82rem; text-align:center; padding:10px 0;">No tienes solicitudes de regalo activas.</p>';
        } else {
          var claimsHtml = '<div class="joa-claims-list">';
          cachedClaims.forEach(function(cl) {
            var camp = cachedCampaigns.find(function(c) { return c.id === cl.campaign_id; });
            var campTitle = camp ? camp.title : "Campaña de Regalo";
            var prods = Array.isArray(cl.selected_products) ? cl.selected_products : [];

            claimsHtml += '<div class="joa-claim-history-card">' +
              '<div class="joa-claim-history-top">' +
                '<strong>' + escapeHtml(campTitle) + '</strong>' +
                '<span class="joa-claim-badge ' + cl.status + '">' + cl.status.toUpperCase() + '</span>' +
              '</div>' +
              '<small style="color:#94A3B8;">Solicitado ' + formatRelativeTime(cl.created_at) + '</small>' +
              (prods.length > 0 ? 
                '<div class="joa-claim-prods-preview"><b>Productos seleccionados (' + prods.length + '):</b> ' + 
                escapeHtml(prods.map(function(p) { return p.title; }).join(", ")) + '</div>' : '') +
            '</div>';
          });
          claimsHtml += '</div>';
          hostClaims.innerHTML = claimsHtml;
        }
      }

    } catch (e) {
      console.error("Excepción en loadRewardCampaigns:", e);
      hostCampaigns.innerHTML = '<p class="joa-error-text">Ocurrió un error al cargar las recompensas.</p>';
    }
  };

  /**
   * Abre el modal principal de JOA Rewards
   */
  window.openJoaRewardsModal = function() {
    var modal = document.getElementById("joaRewardsModal");
    if (!modal) return;
    modal.style.display = "flex";
    modal.classList.add("modal-active");
    document.body.style.overflow = "hidden";
    window.loadRewardCampaigns();
  };

  /**
   * Cierra el modal principal de JOA Rewards
   */
  window.closeJoaRewardsModal = function() {
    var modal = document.getElementById("joaRewardsModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.classList.remove("modal-active");
    document.body.style.overflow = "";
  };

  /**
   * Participa en una campaña basada en méritos de la comunidad
   */
  window.claimCommunityReward = async function(campaignId) {
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user) {
      if (window.openJoaAuthModal) window.openJoaAuthModal();
      return;
    }

    try {
      var res = await supabase.rpc("claim_reward_campaign", { p_campaign_id: campaignId });
      if (res.error) {
        showToast(res.error.message || "No cumples todos los requisitos de actividad aún.");
        return;
      }

      showToast("¡Solicitud enviada con éxito! Revisa tus notificaciones.");
      window.loadRewardCampaigns();
      window.loadUserNotifications();
    } catch (e) {
      console.error("Error al reclamar recompensa:", e);
      showToast("Error de conexión al procesar la solicitud.");
    }
  };

  /* ============================================================
   * 🎁 SELECTOR DE PRODUCTOS DEL CATÁLOGO PARA REGALOS
   * ============================================================ */

  /**
   * Abre el selector de productos del catálogo para una campaña de servicio
   */
  window.openServiceRewardPicker = function(campaignId) {
    var campaign = cachedCampaigns.find(function(c) { return c.id === campaignId; });
    if (!campaign) return;

    activeRewardCampaign = campaign;
    selectedRewardProducts = [];

    var pickerModal = document.getElementById("joaServiceRewardPickerModal");
    var titleEl = document.getElementById("joaPickerCampaignTitle");
    var countTargetEl = document.getElementById("joaPickerTargetCount");
    var selectedCountEl = document.getElementById("joaPickerSelectedCount");

    if (titleEl) titleEl.textContent = campaign.title;
    if (countTargetEl) countTargetEl.textContent = campaign.reward_product_count || 3;
    if (selectedCountEl) selectedCountEl.textContent = '0';

    if (pickerModal) {
      pickerModal.style.display = "flex";
      pickerModal.classList.add("modal-active");
    }

    renderCatalogItemsForPicker();
  };

  /**
   * Cierra el selector de productos
   */
  window.closeServiceRewardPicker = function() {
    var pickerModal = document.getElementById("joaServiceRewardPickerModal");
    if (pickerModal) {
      pickerModal.style.display = "none";
      pickerModal.classList.remove("modal-active");
    }
    activeRewardCampaign = null;
    selectedRewardProducts = [];
  };

  /**
   * Renderiza los elementos del catálogo para selección
   */
  function renderCatalogItemsForPicker() {
    var host = document.getElementById("joaPickerCatalogGrid");
    var searchInput = document.getElementById("joaPickerSearchInput");
    if (!host) return;

    var query = searchInput ? searchInput.value.trim().toLowerCase() : "";
    var catalog = Array.isArray(window.catalog) ? window.catalog : [];

    var filtered = catalog.filter(function(item) {
      if (!query) return true;
      var title = (item.title || item.titulo || item.name || "").toLowerCase();
      var genre = (item.genre || item.genero || "").toLowerCase();
      var type = (item.type || item.tipo || "").toLowerCase();
      return title.includes(query) || genre.includes(query) || type.includes(query);
    }).slice(0, 50);

    if (filtered.length === 0) {
      host.innerHTML = '<div class="joa-feed-empty" style="grid-column:1/-1; padding:20px 0;"><p>No se encontraron productos en el catálogo.</p></div>';
      return;
    }

    var targetCount = activeRewardCampaign ? (activeRewardCampaign.reward_product_count || 3) : 3;
    var html = '';

    filtered.forEach(function(item) {
      var key = String(item.id || item.slug || item.title || "");
      var title = item.title || item.titulo || item.name || "Producto JOA";
      var cover = item.cover_url || item.image_url || item.image || item.poster_url || "img/joa_avatar_default.jpg";
      var type = item.type || item.tipo || "General";
      var isSelected = selectedRewardProducts.some(function(p) { return p.key === key; });

      html += '<div class="joa-picker-card ' + (isSelected ? 'selected' : '') + '" onclick="toggleRewardProductSelection(\'' + escapeHtml(key) + '\', \'' + escapeHtml(title) + '\', \'' + escapeHtml(cover) + '\', \'' + escapeHtml(type) + '\')">' +
        '<div class="joa-picker-cover-wrap">' +
          '<img src="' + escapeHtml(cover) + '" alt="" loading="lazy" onerror="this.src=\'img/joa_avatar_default.jpg\';">' +
          '<span class="joa-picker-check">' + (isSelected ? '✓' : '＋') + '</span>' +
        '</div>' +
        '<div class="joa-picker-info">' +
          '<strong class="joa-picker-title">' + escapeHtml(title) + '</strong>' +
          '<small class="joa-picker-type">' + escapeHtml(type) + '</small>' +
        '</div>' +
      '</div>';
    });

    host.innerHTML = html;
  }

  window.filterRewardPickerCatalog = function() {
    renderCatalogItemsForPicker();
  };

  /**
   * Conmuta la selección de un producto para el paquete de regalo
   */
  window.toggleRewardProductSelection = function(key, title, cover, type) {
    if (!activeRewardCampaign) return;
    var targetCount = activeRewardCampaign.reward_product_count || 3;

    var idx = selectedRewardProducts.findIndex(function(p) { return p.key === key; });
    if (idx >= 0) {
      selectedRewardProducts.splice(idx, 1);
    } else {
      if (selectedRewardProducts.length >= targetCount) {
        showToast("Ya has seleccionado los " + targetCount + " productos permitidos.");
        return;
      }
      selectedRewardProducts.push({
        key: key,
        title: title,
        image_url: cover,
        type: type,
        year: "",
        facts: []
      });
    }

    var selectedCountEl = document.getElementById("joaPickerSelectedCount");
    if (selectedCountEl) selectedCountEl.textContent = selectedRewardProducts.length;

    var submitBtn = document.getElementById("joaPickerSubmitBtn");
    if (submitBtn) {
      submitBtn.disabled = (selectedRewardProducts.length !== targetCount);
    }

    renderCatalogItemsForPicker();
  };

  /**
   * Envía la solicitud del regalo por servicio a Supabase
   */
  window.submitServiceRewardClaim = async function() {
    if (!activeRewardCampaign) return;
    var targetCount = activeRewardCampaign.reward_product_count || 3;

    if (selectedRewardProducts.length !== targetCount) {
      showToast("Debes seleccionar exactamente " + targetCount + " productos.");
      return;
    }

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user) {
      if (window.openJoaAuthModal) window.openJoaAuthModal();
      return;
    }

    var submitBtn = document.getElementById("joaPickerSubmitBtn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Reservando regalo...";
    }

    try {
      var res = await supabase.rpc("claim_service_reward", {
        p_campaign_id: activeRewardCampaign.id,
        p_selected_products: selectedRewardProducts
      });

      if (res.error) {
        console.error("Error en claim_service_reward:", res.error);
        showToast(res.error.message || "No se pudo procesar la solicitud de regalo.");
        return;
      }

      showToast("🎉 ¡Tu regalo especial de JOA está reservado!");
      window.closeServiceRewardPicker();
      window.loadRewardCampaigns();
      window.loadUserNotifications();

    } catch (e) {
      console.error("Excepción en submitServiceRewardClaim:", e);
      showToast("Error de conexión al enviar solicitud.");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "🎁 Confirmar Selección y Reservar";
      }
    }
  };


  /* ============================================================
   * 🛠️ SERVICIOS INFORMÁTICOS DE J.O.A GAMER's PC (TABLA services)
   * ============================================================ */

  /**
   * Carga los servicios oficiales activos desde Supabase
   */
  window.loadSupabaseServices = async function() {
    var supabase = window.joaSupabase;
    if (!supabase) return;

    try {
      var res = await supabase.from("services")
        .select("id,title,slug,description,is_active,sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (res.error) {
        console.warn("No se pudieron cargar services de Supabase:", res.error);
        return;
      }

      cachedServices = res.data || [];
      console.log("Servicios de JOA sincronizados:", cachedServices.length);
    } catch (e) {
      console.warn("Excepción al cargar services:", e);
    }
  };

  /* ============================================================
   * EVENTO DE CAMBIO DE SESIÓN
   * ============================================================ */
  window.addEventListener("joa-auth-change", function() {
    window.loadUserNotifications();
    window.loadRewardCampaigns();
  });

  // Inicialización automática tras cargar DOM
  window.addEventListener("DOMContentLoaded", function() {
    setTimeout(function() {
      window.loadSupabaseServices();
      window.loadUserNotifications();
    }, 1200);
  });

})();
