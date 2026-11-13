/**
 * ============================================================
 * 👥 JOA GAMERS · AMIGOS, MENSAJERÍA PRIVADA Y GRUPOS DE JUGADORES
 * Etapa 4: Integración completa con Supabase JOA Multiverso
 * Tablas: friendships, conversations, conversation_members,
 *         messages, community_groups, group_members, profiles
 * ============================================================
 */
(function() {
  'use strict';

  var activeTab = 'feed';
  var activeConversationId = null;
  var activeConversationPeer = null;
  var chatRealtimeChannel = null;
  var chatPollTimer = null;
  var cachedFriends = [];
  var cachedFriendships = [];
  var cachedGroups = [];
  var myGroupMemberships = [];
  var directoryProfiles = [];

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

  function formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      var now = new Date();
      var diffMs = now - d;
      var diffMins = Math.floor(diffMs / (1000 * 60));
      if (diffMins < 1) return 'Ahora';
      if (diffMins < 60) return diffMins + ' min';
      var diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return diffHours + ' h';
      return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
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

  /**
   * Cambia de pestaña dentro del modal de comunidad
   */
  window.switchCommunityTab = function(tabName) {
    activeTab = tabName || 'feed';

    // Actualizar botones de pestaña
    var tabBtns = document.querySelectorAll(".joa-comm-tab");
    tabBtns.forEach(function(btn) {
      var target = btn.getAttribute("data-tab");
      if (target === activeTab) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // Actualizar paneles
    var panels = ["feed", "friends", "messages", "groups"];
    panels.forEach(function(p) {
      var el = document.getElementById("joaTabPanel-" + p);
      if (el) {
        el.style.display = (p === activeTab) ? "flex" : "none";
      }
    });

    // Si salimos de mensajes, limpiar canal de chat si estaba abierto
    if (activeTab !== 'messages' && chatRealtimeChannel) {
      stopChatRealtime();
    }

    // Cargar datos según la pestaña activa
    if (activeTab === 'feed') {
      if (window.loadCommunityFeed) window.loadCommunityFeed();
    } else if (activeTab === 'friends') {
      window.loadCommunityFriends();
      window.loadCommunityDirectory();
    } else if (activeTab === 'messages') {
      window.loadCommunityChats();
    } else if (activeTab === 'groups') {
      window.loadCommunityGroups();
    }
  };

  /**
   * Abre directamente la pestaña deseada en el modal de comunidad
   */
  window.openJoaCommunityTab = function(tabName) {
    if (window.openJoaCommunityModal) {
      window.openJoaCommunityModal();
    }
    window.switchCommunityTab(tabName || 'feed');
  };

  /* ============================================================
   * 👥 AMIGOS & SOLICITUDES (TABLA friendships)
   * ============================================================ */

  /**
   * Carga la lista de amigos y solicitudes pendientes
   */
  window.loadCommunityFriends = async function() {
    var hostFriends = document.getElementById("joaFriendsListHost");
    var hostRequests = document.getElementById("joaPendingRequestsHost");
    var badgeEl = document.getElementById("joaPendingRequestsBadge");
    if (!hostFriends) return;

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;

    if (!user || !supabase) {
      hostFriends.innerHTML = '<div class="joa-guest-prompt-card" style="margin-top:10px;">' +
        '<div class="joa-guest-prompt-text"><b>👋 Inicia sesión en JOA Multiverso</b><br>Para conectar con otros jugadores, agregar amigos y enviar mensajes privados.</div>' +
        '<button type="button" class="btn btn-primary" onclick="openJoaAuthModal()" style="padding:8px 16px; font-size:0.82rem; font-weight:800; border-radius:10px;">👤 Iniciar Sesión</button>' +
        '</div>';
      if (hostRequests) hostRequests.innerHTML = '';
      if (badgeEl) badgeEl.style.display = 'none';
      return;
    }

    hostFriends.innerHTML = '<p class="joa-loading-text">Cargando tus amigos...</p>';

    try {
      var res = await supabase.from("friendships")
        .select("*")
        .or("requester_id.eq." + user.id + ",addressee_id.eq." + user.id)
        .order("created_at", { ascending: false });

      if (res.error) {
        console.error("Error al cargar friendships:", res.error);
        hostFriends.innerHTML = '<p class="joa-error-text">No se pudieron cargar tus amigos.</p>';
        return;
      }

      var friendships = res.data || [];
      cachedFriendships = friendships;

      // Obtener perfiles de los participantes
      var otherIds = [];
      friendships.forEach(function(f) {
        var otherId = (f.requester_id === user.id) ? f.addressee_id : f.requester_id;
        if (otherId && !otherIds.includes(otherId)) otherIds.push(otherId);
      });

      var profileMap = {};
      if (otherIds.length > 0) {
        var pRes = await supabase.from("profiles")
          .select("id,username,display_name,avatar_url,bio,game_preferences")
          .in("id", otherIds);
        if (pRes.data) {
          pRes.data.forEach(function(p) { profileMap[p.id] = p; });
        }
      }

      // Separar aceptadas y pendientes recibidas
      var accepted = [];
      var pendingReceived = [];
      var pendingSent = [];

      friendships.forEach(function(f) {
        if (f.status === 'accepted') {
          accepted.push(f);
        } else if (f.status === 'pending') {
          if (f.addressee_id === user.id) {
            pendingReceived.push(f);
          } else {
            pendingSent.push(f);
          }
        }
      });

      cachedFriends = accepted;

      // Actualizar badge de solicitudes
      if (badgeEl) {
        if (pendingReceived.length > 0) {
          badgeEl.textContent = pendingReceived.length;
          badgeEl.style.display = 'inline-block';
        } else {
          badgeEl.style.display = 'none';
        }
      }

      // Renderizar solicitudes pendientes
      if (hostRequests) {
        if (pendingReceived.length === 0) {
          hostRequests.innerHTML = '';
          hostRequests.style.display = 'none';
        } else {
          hostRequests.style.display = 'flex';
          var reqHtml = '<div class="joa-requests-header"><span>📬 Solicitudes de Amistad Recibidas (' + pendingReceived.length + ')</span></div><div class="joa-requests-grid">';
          pendingReceived.forEach(function(req) {
            var profile = profileMap[req.requester_id] || {};
            var name = escapeHtml(profile.display_name || profile.username || "Jugador");
            var handle = profile.username ? "@" + escapeHtml(profile.username) : "";
            var avatarUrl = profile.avatar_url;
            var initials = getInitials(profile.display_name || profile.username);

            reqHtml += '<div class="joa-request-card" id="req-card-' + req.id + '">' +
              '<div class="joa-user-mini-avatar">' +
                (avatarUrl ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" onerror="this.onerror=null; this.parentElement.textContent=\'' + initials + '\';">' : initials) +
              '</div>' +
              '<div class="joa-request-info">' +
                '<strong>' + name + '</strong>' +
                (handle ? '<small>' + handle + '</small>' : '') +
              '</div>' +
              '<div class="joa-request-actions">' +
                '<button type="button" class="joa-btn-accept-friend" onclick="respondFriendRequest(\'' + req.id + '\', true)">✓ Aceptar</button>' +
                '<button type="button" class="joa-btn-reject-friend" onclick="respondFriendRequest(\'' + req.id + '\', false)">✕ Rechazar</button>' +
              '</div>' +
            '</div>';
          });
          reqHtml += '</div>';
          hostRequests.innerHTML = reqHtml;
        }
      }

      // Renderizar amigos aceptados
      if (accepted.length === 0) {
        hostFriends.innerHTML = '<div class="joa-feed-empty" style="padding:20px 10px;">' +
          '<div style="font-size:2rem; margin-bottom:6px;">👥</div>' +
          '<p>Todavía no tienes amigos agregados.</p>' +
          '<small style="color:#64748B;">¡Busca jugadores abajo en el directorio y envíales una solicitud!</small>' +
          '</div>';
        return;
      }

      var friendsHtml = '<div class="joa-friends-grid">';
      accepted.forEach(function(f) {
        var otherId = (f.requester_id === user.id) ? f.addressee_id : f.requester_id;
        var profile = profileMap[otherId] || {};
        var name = escapeHtml(profile.display_name || profile.username || "Amigo");
        var handle = profile.username ? "@" + escapeHtml(profile.username) : "";
        var avatarUrl = profile.avatar_url;
        var initials = getInitials(profile.display_name || profile.username);
        var games = profile.game_preferences ? escapeHtml(profile.game_preferences) : "";

        friendsHtml += '<div class="joa-friend-card">' +
          '<div class="joa-friend-card-head">' +
            '<div class="joa-user-mini-avatar">' +
              (avatarUrl ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" onerror="this.onerror=null; this.parentElement.textContent=\'' + initials + '\';">' : initials) +
            '</div>' +
            '<div class="joa-friend-card-info">' +
              '<strong>' + name + '</strong>' +
              '<div class="joa-friend-sub">' + (handle ? '<span>' + handle + '</span>' : '') + '<span class="joa-friend-online-dot">● Amigo</span></div>' +
              (games ? '<div class="joa-friend-games">🎮 ' + games + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="joa-friend-card-actions">' +
            '<button type="button" class="joa-friend-msg-btn" onclick="startDirectChat(\'' + otherId + '\', \'' + escapeHtml(profile.display_name || profile.username || "Amigo") + '\')">' +
              '<span>💬 Mensaje</span>' +
            '</button>' +
            '<button type="button" class="joa-friend-del-btn" title="Eliminar amistad" onclick="removeFriendship(\'' + f.id + '\')">' +
              '<span>✕</span>' +
            '</button>' +
          '</div>' +
        '</div>';
      });
      friendsHtml += '</div>';

      hostFriends.innerHTML = friendsHtml;

    } catch (e) {
      console.error("Excepción en loadCommunityFriends:", e);
      hostFriends.innerHTML = '<p class="joa-error-text">Ocurrió un error al cargar la lista.</p>';
    }
  };

  /**
   * Responde a una solicitud de amistad (Aceptar o Rechazar)
   */
  window.respondFriendRequest = async function(friendshipId, accept) {
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user) return;

    try {
      var statusVal = accept ? 'accepted' : 'rejected';
      var res = await supabase.from("friendships")
        .update({ status: statusVal, updated_at: new Date().toISOString() })
        .eq("id", friendshipId)
        .eq("addressee_id", user.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (res.error || !res.data) {
        showToast("No se pudo procesar la solicitud.");
        return;
      }

      showToast(accept ? "¡Ahora son amigos en JOA Multiverso!" : "Solicitud rechazada.");
      window.loadCommunityFriends();
      window.loadCommunityDirectory();
    } catch (e) {
      console.error("Error en respondFriendRequest:", e);
      showToast("Error al responder solicitud.");
    }
  };

  /**
   * Elimina una amistad
   */
  window.removeFriendship = async function(friendshipId) {
    if (!confirm("¿Deseas eliminar a este jugador de tus amigos?")) return;
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user) return;

    try {
      var res = await supabase.from("friendships")
        .delete()
        .eq("id", friendshipId)
        .or("requester_id.eq." + user.id + ",addressee_id.eq." + user.id)
        .select("id")
        .maybeSingle();

      if (res.error) {
        showToast("No se pudo eliminar la amistad.");
        return;
      }

      showToast("Amistad eliminada.");
      window.loadCommunityFriends();
      window.loadCommunityDirectory();
    } catch (e) {
      console.error("Error al eliminar amistad:", e);
      showToast("Error al eliminar amistad.");
    }
  };

  /**
   * Carga el directorio de jugadores de la comunidad
   */
  window.loadCommunityDirectory = async function() {
    var host = document.getElementById("joaDirectoryListHost");
    if (!host) return;

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;

    if (!user || !supabase) {
      host.innerHTML = '';
      return;
    }

    try {
      var res = await supabase.from("profiles")
        .select("id,username,display_name,avatar_url,bio,game_preferences,updated_at")
        .neq("id", user.id)
        .order("updated_at", { ascending: false })
        .limit(60);

      if (res.error) {
        console.error("Error al cargar directorio:", res.error);
        return;
      }

      directoryProfiles = res.data || [];
      renderCommunityDirectory();
    } catch (e) {
      console.error("Error en loadCommunityDirectory:", e);
    }
  };

  /**
   * Renderiza el directorio filtrado por el campo de búsqueda
   */
  window.renderCommunityDirectory = function() {
    var host = document.getElementById("joaDirectoryListHost");
    var input = document.getElementById("joaDirectorySearchInput");
    if (!host) return;

    var user = window.joaCurrentUser;
    var query = input ? input.value.trim().toLowerCase() : "";

    var matches = directoryProfiles.filter(function(p) {
      if (!query) return true;
      var text = [p.username, p.display_name, p.bio, p.game_preferences].join(" ").toLowerCase();
      return text.includes(query);
    });

    if (matches.length === 0) {
      host.innerHTML = '<div class="joa-feed-empty" style="padding:16px 0;"><p>No se encontraron jugadores que coincidan.</p></div>';
      return;
    }

    var html = '<div class="joa-directory-grid">';
    matches.forEach(function(p) {
      var rel = cachedFriendships.find(function(f) {
        return (f.requester_id === user.id && f.addressee_id === p.id) ||
               (f.addressee_id === user.id && f.requester_id === p.id);
      });

      var name = escapeHtml(p.display_name || p.username || "Jugador");
      var handle = p.username ? "@" + escapeHtml(p.username) : "";
      var avatarUrl = p.avatar_url;
      var initials = getInitials(p.display_name || p.username);
      var bio = p.bio ? escapeHtml(p.bio) : "";
      var games = p.game_preferences ? escapeHtml(p.game_preferences) : "";

      var actionHtml = '';
      if (rel) {
        if (rel.status === 'accepted') {
          actionHtml = '<button type="button" class="joa-dir-btn-chat" onclick="startDirectChat(\'' + p.id + '\', \'' + escapeHtml(p.display_name || p.username || "Amigo") + '\')">💬 Chat</button>';
        } else if (rel.status === 'pending' && rel.requester_id === user.id) {
          actionHtml = '<button type="button" class="joa-dir-btn-cancel" onclick="cancelSentFriendRequest(\'' + rel.id + '\')">⏳ Cancelar</button>';
        } else if (rel.status === 'pending' && rel.addressee_id === user.id) {
          actionHtml = '<button type="button" class="joa-dir-btn-accept" onclick="respondFriendRequest(\'' + rel.id + '\', true)">✓ Aceptar</button>';
        } else {
          actionHtml = '<span class="joa-dir-state-pill">' + (rel.status === 'rejected' ? 'Rechazada' : 'Bloqueado') + '</span>';
        }
      } else {
        actionHtml = '<button type="button" class="joa-dir-btn-add" id="btn-add-' + p.id + '" onclick="sendFriendRequest(\'' + p.id + '\')">＋ Añadir</button>';
      }

      html += '<div class="joa-directory-card">' +
        '<div class="joa-directory-card-top">' +
          '<div class="joa-user-mini-avatar">' +
            (avatarUrl ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" onerror="this.onerror=null; this.parentElement.textContent=\'' + initials + '\';">' : initials) +
          '</div>' +
          '<div class="joa-directory-card-info">' +
            '<strong>' + name + '</strong>' +
            (handle ? '<small>' + handle + '</small>' : '') +
          '</div>' +
          '<div class="joa-directory-action-wrap">' + actionHtml + '</div>' +
        '</div>' +
        (bio ? '<p class="joa-dir-bio">' + bio + '</p>' : '') +
        (games ? '<div class="joa-dir-games">🎮 ' + games + '</div>' : '') +
      '</div>';
    });
    html += '</div>';

    host.innerHTML = html;
  };

  /**
   * Envía una nueva solicitud de amistad
   */
  window.sendFriendRequest = async function(targetUserId) {
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user) {
      if (window.openJoaAuthModal) window.openJoaAuthModal();
      return;
    }

    var btn = document.getElementById("btn-add-" + targetUserId);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Enviando...";
    }

    try {
      var res = await supabase.from("friendships")
        .insert({
          requester_id: user.id,
          addressee_id: targetUserId,
          status: 'pending'
        })
        .select("id")
        .single();

      if (res.error) {
        console.error("Error al enviar solicitud:", res.error);
        showToast("No se pudo enviar la solicitud.");
        if (btn) {
          btn.disabled = false;
          btn.textContent = "＋ Añadir";
        }
        return;
      }

      showToast("¡Solicitud de amistad enviada!");
      await window.loadCommunityFriends();
      window.renderCommunityDirectory();
    } catch (e) {
      console.error("Excepción al enviar solicitud:", e);
      showToast("Error de conexión al enviar solicitud.");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "＋ Añadir";
      }
    }
  };

  /**
   * Cancela una solicitud que el usuario había enviado
   */
  window.cancelSentFriendRequest = async function(friendshipId) {
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user) return;

    try {
      var res = await supabase.from("friendships")
        .delete()
        .eq("id", friendshipId)
        .eq("requester_id", user.id)
        .select("id")
        .maybeSingle();

      if (res.error) {
        showToast("No se pudo cancelar la solicitud.");
        return;
      }

      showToast("Solicitud cancelada.");
      await window.loadCommunityFriends();
      window.renderCommunityDirectory();
    } catch (e) {
      console.error("Error al cancelar solicitud:", e);
      showToast("Error al cancelar solicitud.");
    }
  };


  /* ============================================================
   * 💬 MENSAJERÍA PRIVADA (conversations, conversation_members, messages)
   * ============================================================ */

  /**
   * Carga la lista de chats privados activos del usuario
   */
  window.loadCommunityChats = async function() {
    var host = document.getElementById("joaChatListHost");
    var activeView = document.getElementById("joaActiveChatView");
    var listView = document.getElementById("joaChatsListView");

    if (activeView) activeView.style.display = "none";
    if (listView) listView.style.display = "flex";

    if (!host) return;

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;

    if (!user || !supabase) {
      host.innerHTML = '<div class="joa-guest-prompt-card" style="margin-top:10px;">' +
        '<div class="joa-guest-prompt-text"><b>👋 Inicia sesión en JOA Multiverso</b><br>Para acceder a tus chats y enviar mensajes a tus amigos.</div>' +
        '<button type="button" class="btn btn-primary" onclick="openJoaAuthModal()" style="padding:8px 16px; font-size:0.82rem; font-weight:800; border-radius:10px;">👤 Iniciar Sesión</button>' +
        '</div>';
      return;
    }

    host.innerHTML = '<p class="joa-loading-text">Cargando tus conversaciones...</p>';

    try {
      var mRes = await supabase.from("conversation_members")
        .select("conversation_id")
        .eq("user_id", user.id);

      if (mRes.error) {
        console.error("Error al cargar conversation_members:", mRes.error);
        host.innerHTML = '<p class="joa-error-text">No se pudieron cargar tus conversaciones.</p>';
        return;
      }

      var convIds = (mRes.data || []).map(function(x) { return x.conversation_id; });
      if (convIds.length === 0) {
        host.innerHTML = '<div class="joa-feed-empty" style="padding:24px 10px;">' +
          '<div style="font-size:2rem; margin-bottom:8px;">💬</div>' +
          '<p>Todavía no tienes conversaciones iniciadas.</p>' +
          '<button type="button" class="btn btn-primary" onclick="switchCommunityTab(\'friends\')" style="margin-top:10px; padding:6px 14px; font-size:0.82rem;">👥 Ir a Amigos para chatear</button>' +
          '</div>';
        return;
      }

      // Traer conversaciones directas (sin group_id)
      var cRes = await supabase.from("conversations")
        .select("id,title,created_by,direct_user_id,group_id,created_at")
        .in("id", convIds)
        .order("created_at", { ascending: false });

      if (cRes.error) {
        console.error("Error al cargar conversations:", cRes.error);
        host.innerHTML = '<p class="joa-error-text">Error al consultar chats.</p>';
        return;
      }

      var directConvs = (cRes.data || []).filter(function(c) { return !c.group_id; });
      if (directConvs.length === 0) {
        host.innerHTML = '<div class="joa-feed-empty" style="padding:24px 10px;">' +
          '<div style="font-size:2rem; margin-bottom:8px;">💬</div>' +
          '<p>No tienes chats privados abiertos.</p>' +
          '</div>';
        return;
      }

      // Obtener IDs de los otros participantes
      var peerIds = [];
      directConvs.forEach(function(c) {
        var pid = (c.created_by === user.id) ? c.direct_user_id : c.created_by;
        if (pid && !peerIds.includes(pid)) peerIds.push(pid);
      });

      // Obtener perfiles de los participantes y últimos mensajes en paralelo
      var promises = [
        peerIds.length > 0 ? supabase.from("profiles").select("id,display_name,username,avatar_url").in("id", peerIds) : Promise.resolve({ data: [] }),
        Promise.all(directConvs.map(function(c) {
          return supabase.from("messages")
            .select("id,conversation_id,sender_id,body,created_at")
            .eq("conversation_id", c.id)
            .order("created_at", { ascending: false })
            .limit(1);
        }))
      ];

      var results = await Promise.all(promises);
      var profilesData = results[0].data || [];
      var messagesData = results[1] || [];

      var profileMap = {};
      profilesData.forEach(function(p) { profileMap[p.id] = p; });

      var lastMsgMap = {};
      messagesData.forEach(function(r) {
        if (r.data && r.data[0]) {
          lastMsgMap[r.data[0].conversation_id] = r.data[0];
        }
      });

      var html = '<div class="joa-chat-entries-list">';
      directConvs.forEach(function(c) {
        var peerId = (c.created_by === user.id) ? c.direct_user_id : c.created_by;
        var peer = profileMap[peerId] || {};
        var peerName = escapeHtml(peer.display_name || peer.username || c.title || "Amigo");
        var avatarUrl = peer.avatar_url;
        var initials = getInitials(peer.display_name || peer.username || c.title);
        var lastMsg = lastMsgMap[c.id];
        var lastBody = lastMsg ? escapeHtml(lastMsg.body) : "Sin mensajes aún.";
        var lastTime = lastMsg ? formatTime(lastMsg.created_at) : "";
        var isMine = lastMsg && lastMsg.sender_id === user.id;

        html += '<div class="joa-chat-entry-card" onclick="openDirectChatWindow(\'' + c.id + '\', \'' + peerName + '\', \'' + (avatarUrl ? escapeHtml(avatarUrl) : '') + '\')">' +
          '<div class="joa-user-mini-avatar">' +
            (avatarUrl ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" onerror="this.onerror=null; this.parentElement.textContent=\'' + initials + '\';">' : initials) +
          '</div>' +
          '<div class="joa-chat-entry-content">' +
            '<div class="joa-chat-entry-top">' +
              '<strong>' + peerName + '</strong>' +
              (lastTime ? '<span class="joa-chat-entry-time">' + lastTime + '</span>' : '') +
            '</div>' +
            '<div class="joa-chat-entry-preview">' +
              (isMine ? '<span style="color:#00E5FF;">Tú: </span>' : '') + lastBody +
            '</div>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';

      host.innerHTML = html;

    } catch (e) {
      console.error("Excepción al cargar chats:", e);
      host.innerHTML = '<p class="joa-error-text">Ocurrió un error al cargar los chats.</p>';
    }
  };

  /**
   * Inicia o busca una conversación directa con un amigo y abre el chat
   */
  window.startDirectChat = async function(friendId, friendName) {
    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user) {
      if (window.openJoaAuthModal) window.openJoaAuthModal();
      return;
    }

    try {
      // Buscar conversación existente entre los dos usuarios
      var found = await supabase.from("conversations")
        .select("id,created_at")
        .or("and(created_by.eq." + user.id + ",direct_user_id.eq." + friendId + "),and(created_by.eq." + friendId + ",direct_user_id.eq." + user.id + ")")
        .order("created_at", { ascending: false })
        .limit(1);

      var conversationId = found.data?.[0]?.id;

      if (!conversationId) {
        // Crear nueva conversación
        var created = await supabase.from("conversations")
          .insert({
            created_by: user.id,
            direct_user_id: friendId,
            title: friendName
          })
          .select("id")
          .single();

        if (created.error) throw created.error;
        conversationId = created.data.id;

        // Añadir a ambos miembros
        var memRes = await supabase.from("conversation_members").insert([
          { conversation_id: conversationId, user_id: user.id },
          { conversation_id: conversationId, user_id: friendId }
        ]);
        if (memRes.error) {
          console.warn("Advertencia al insertar miembros en conversation_members:", memRes.error);
        }
      }

      window.switchCommunityTab('messages');
      window.openDirectChatWindow(conversationId, friendName);

    } catch (e) {
      console.error("Error al iniciar direct chat:", e);
      showToast("No se pudo abrir la conversación.");
    }
  };

  /**
   * Abre la vista interactiva de chat para una conversación específica
   */
  window.openDirectChatWindow = function(conversationId, peerName, avatarUrl) {
    activeConversationId = conversationId;
    activeConversationPeer = { name: peerName, avatarUrl: avatarUrl };

    var activeView = document.getElementById("joaActiveChatView");
    var listView = document.getElementById("joaChatsListView");
    var peerNameEl = document.getElementById("joaChatHeaderName");
    var avatarEl = document.getElementById("joaChatHeaderAvatar");

    if (listView) listView.style.display = "none";
    if (activeView) activeView.style.display = "flex";

    if (peerNameEl) peerNameEl.textContent = peerName || "Amigo JOA";
    if (avatarEl) {
      var initials = getInitials(peerName);
      if (avatarUrl) {
        avatarEl.innerHTML = '<img src="' + escapeHtml(avatarUrl) + '" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" onerror="this.onerror=null; this.parentElement.textContent=\'' + initials + '\';">';
      } else {
        avatarEl.textContent = initials;
      }
    }

    // Cargar historial de mensajes
    loadConversationMessages(conversationId);

    // Iniciar realtime / polling
    startChatRealtime(conversationId);
  };

  /**
   * Vuelve a la lista de conversaciones
   */
  window.closeActiveChatWindow = function() {
    stopChatRealtime();
    activeConversationId = null;
    activeConversationPeer = null;

    var activeView = document.getElementById("joaActiveChatView");
    var listView = document.getElementById("joaChatsListView");
    if (activeView) activeView.style.display = "none";
    if (listView) listView.style.display = "flex";

    window.loadCommunityChats();
  };

  /**
   * Carga los mensajes de la conversación activa
   */
  async function loadConversationMessages(conversationId) {
    var host = document.getElementById("joaChatMessagesHost");
    if (!host) return;

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user) return;

    try {
      var res = await supabase.from("messages")
        .select("id,conversation_id,sender_id,body,created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (res.error) {
        console.error("Error al cargar mensajes:", res.error);
        host.innerHTML = '<p class="joa-error-text">No se pudieron cargar los mensajes.</p>';
        return;
      }

      var messages = res.data || [];
      if (messages.length === 0) {
        host.innerHTML = '<div class="joa-feed-empty" style="padding:20px 0;"><p>Envía un mensaje para saludar a tu amigo.</p></div>';
        return;
      }

      var html = '';
      messages.forEach(function(m) {
        var isMine = (m.sender_id === user.id);
        var timeStr = formatTime(m.created_at);
        var bodyEscaped = escapeHtml(m.body).replace(/\n/g, '<br>');

        html += '<div class="joa-chat-bubble-wrap ' + (isMine ? 'mine' : 'theirs') + '">' +
          '<div class="joa-chat-bubble">' +
            '<div class="joa-chat-text">' + bodyEscaped + '</div>' +
            '<span class="joa-chat-time">' + timeStr + '</span>' +
          '</div>' +
        '</div>';
      });

      host.innerHTML = html;
      host.scrollTop = host.scrollHeight;

    } catch (e) {
      console.error("Excepción en loadConversationMessages:", e);
    }
  }

  /**
   * Envía un mensaje en la conversación activa
   */
  window.sendActiveChatMessage = async function(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!activeConversationId) return;

    var input = document.getElementById("joaChatMessageInput");
    var btn = document.getElementById("joaChatMessageSubmitBtn");
    if (!input) return;

    var text = input.value.trim();
    if (!text) return;

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;
    if (!supabase || !user) {
      if (window.openJoaAuthModal) window.openJoaAuthModal();
      return;
    }

    input.value = '';
    if (btn) btn.disabled = true;

    try {
      var res = await supabase.from("messages")
        .insert({
          conversation_id: activeConversationId,
          sender_id: user.id,
          body: text
        })
        .select("id,conversation_id,sender_id,body,created_at")
        .single();

      if (res.error) {
        console.error("Error al enviar mensaje:", res.error);
        showToast("Error al enviar el mensaje.");
        input.value = text;
        return;
      }

      // Añadir directamente a la vista
      var host = document.getElementById("joaChatMessagesHost");
      if (host) {
        var emptyEl = host.querySelector(".joa-feed-empty");
        if (emptyEl) host.innerHTML = '';

        var bubble = document.createElement("div");
        bubble.className = "joa-chat-bubble-wrap mine";
        bubble.innerHTML = '<div class="joa-chat-bubble">' +
          '<div class="joa-chat-text">' + escapeHtml(res.data.body).replace(/\n/g, '<br>') + '</div>' +
          '<span class="joa-chat-time">Ahora</span>' +
        '</div>';
        host.appendChild(bubble);
        host.scrollTop = host.scrollHeight;
      }

    } catch (e) {
      console.error("Excepción al enviar mensaje:", e);
      showToast("Error de conexión al enviar.");
      input.value = text;
    } finally {
      if (btn) btn.disabled = false;
      if (input) input.focus();
    }
  };

  /**
   * Configura la suscripción en tiempo real y sondeo de respaldo para el chat
   */
  function startChatRealtime(conversationId) {
    stopChatRealtime();

    var supabase = window.joaSupabase;
    if (supabase && supabase.channel) {
      try {
        chatRealtimeChannel = supabase.channel("joa-chat-" + conversationId)
          .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: "conversation_id=eq." + conversationId
          }, function(payload) {
            var newMsg = payload.new;
            var user = window.joaCurrentUser;
            if (newMsg && user && newMsg.sender_id !== user.id) {
              loadConversationMessages(conversationId);
            }
          })
          .subscribe();
      } catch (err) {
        console.warn("Realtime no disponible para chat, usando sondeo:", err);
      }
    }

    // Sondeo de respaldo cada 5 segundos mientras el chat esté abierto
    chatPollTimer = setInterval(function() {
      if (activeConversationId === conversationId) {
        loadConversationMessages(conversationId);
      } else {
        stopChatRealtime();
      }
    }, 5000);
  }

  function stopChatRealtime() {
    var supabase = window.joaSupabase;
    if (chatRealtimeChannel && supabase && supabase.removeChannel) {
      try {
        supabase.removeChannel(chatRealtimeChannel);
      } catch (e) {}
      chatRealtimeChannel = null;
    }
    if (chatPollTimer) {
      clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
  }


  /* ============================================================
   * 🎮 GRUPOS DE JUGADORES (community_groups, group_members)
   * ============================================================ */

  /**
   * Carga los grupos disponibles y las membresías del usuario
   */
  window.loadCommunityGroups = async function() {
    var host = document.getElementById("joaGroupsListHost");
    if (!host) return;

    var supabase = window.joaSupabase;
    var user = window.joaCurrentUser;

    host.innerHTML = '<p class="joa-loading-text">Cargando grupos de la comunidad...</p>';

    try {
      var publicQuery = supabase.from("community_groups")
        .select("id,name,slug,description,created_by,is_public,category,platform,tags,rules,created_at,updated_at")
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(60);

      var memberQuery = (user && supabase) ?
        supabase.from("group_members").select("group_id,user_id,role").eq("user_id", user.id) :
        Promise.resolve({ data: [] });

      var results = await Promise.all([publicQuery, memberQuery]);
      var publicGroups = results[0].data || [];
      var myMembers = results[1].data || [];
      myGroupMemberships = myMembers;

      // Traer miembros totales de estos grupos
      var groupIds = publicGroups.map(function(g) { return g.id; });
      var membersCountMap = {};
      var creatorIds = [];

      publicGroups.forEach(function(g) {
        if (g.created_by && !creatorIds.includes(g.created_by)) {
          creatorIds.push(g.created_by);
        }
      });

      var rosterQuery = groupIds.length > 0 ?
        supabase.from("group_members").select("group_id,user_id").in("group_id", groupIds) :
        Promise.resolve({ data: [] });

      var profilesQuery = creatorIds.length > 0 ?
        supabase.from("profiles").select("id,display_name,username").in("id", creatorIds) :
        Promise.resolve({ data: [] });

      var subResults = await Promise.all([rosterQuery, profilesQuery]);
      (subResults[0].data || []).forEach(function(m) {
        membersCountMap[m.group_id] = (membersCountMap[m.group_id] || 0) + 1;
      });

      var creatorMap = {};
      (subResults[1].data || []).forEach(function(p) {
        creatorMap[p.id] = p;
      });

      cachedGroups = publicGroups;

      if (publicGroups.length === 0) {
        host.innerHTML = '<div class="joa-feed-empty" style="padding:24px 10px;">' +
          '<div style="font-size:2rem; margin-bottom:8px;">🎮</div>' +
          '<p>Todavía no hay grupos públicos creados.</p>' +
          (user ? '<button type="button" class="btn btn-primary" onclick="toggleCreateGroupForm(true)" style="margin-top:10px; padding:8px 16px;">＋ Crear el primer grupo</button>' : '') +
          '</div>';
        return;
      }

      var myMap = {};
      myMembers.forEach(function(m) { myMap[m.group_id] = m; });

      var html = '<div class="joa-groups-grid">';
      publicGroups.forEach(function(g) {
        var membership = myMap[g.id];
        var isOwner = (user && g.created_by === user.id);
        var creator = creatorMap[g.created_by] || {};
        var creatorName = escapeHtml(creator.display_name || creator.username || "Jugador");
        var count = membersCountMap[g.id] || 0;
        var category = escapeHtml(g.category || "General");
        var platform = escapeHtml(g.platform || "Todas");

        var actionHtml = '';
        if (user) {
          if (isOwner) {
            actionHtml = '<span class="joa-group-role-badge owner">👑 Creador</span>';
          } else if (membership) {
            actionHtml = '<div style="display:flex; align-items:center; gap:6px;">' +
              '<span class="joa-group-role-badge member">⭐ Miembro</span>' +
              '<button type="button" class="joa-btn-leave-group" onclick="leaveCommunityGroup(\'' + g.id + '\', \'' + escapeHtml(g.name) + '\')">Salir</button>' +
              '</div>';
          } else {
            actionHtml = '<button type="button" class="joa-btn-join-group" onclick="joinCommunityGroup(\'' + g.id + '\', \'' + escapeHtml(g.name) + '\')">🎮 Unirme</button>';
          }
        } else {
          actionHtml = '<button type="button" class="joa-btn-join-group" onclick="openJoaAuthModal()">Unirse</button>';
        }

        html += '<div class="joa-group-card">' +
          '<div class="joa-group-card-top">' +
            '<div>' +
              '<h4 class="joa-group-title">' + escapeHtml(g.name) + '</h4>' +
              '<div class="joa-group-meta-tags">' +
                '<span class="joa-group-pill">' + category + '</span>' +
                '<span class="joa-group-pill">' + platform + '</span>' +
                '<span class="joa-group-pill count">👥 ' + count + ' miembros</span>' +
              '</div>' +
            '</div>' +
            '<div>' + actionHtml + '</div>' +
          '</div>' +
          (g.description ? '<p class="joa-group-desc">' + escapeHtml(g.description) + '</p>' : '') +
          (g.rules ? '<div class="joa-group-rules-preview">📜 <b>Reglas:</b> ' + escapeHtml(g.rules) + '</div>' : '') +
          '<div class="joa-group-footer">' +
            '<small>Creado por ' + creatorName + ' · ' + formatTime(g.created_at) + '</small>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';

      host.innerHTML = html;

    } catch (e) {
      console.error("Excepción al cargar grupos:", e);
      host.innerHTML = '<p class="joa-error-text">Ocurrió un error al cargar los grupos.</p>';
    }
  };

  /**
   * Muestra u oculta el formulario para crear un nuevo grupo
   */
  window.toggleCreateGroupForm = function(forceShow) {
    var formWrap = document.getElementById("joaCreateGroupFormWrap");
    if (!formWrap) return;
    var user = window.joaCurrentUser;
    if (!user) {
      if (window.openJoaAuthModal) window.openJoaAuthModal();
      return;
    }
    if (forceShow === true) {
      formWrap.style.display = "block";
    } else if (forceShow === false) {
      formWrap.style.display = "none";
    } else {
      formWrap.style.display = (formWrap.style.display === "none" || !formWrap.style.display) ? "block" : "none";
    }
  };

  /**
   * Crea un nuevo grupo en la tabla community_groups
   */
  window.submitNewCommunityGroup = async function(e) {
    if (e && e.preventDefault) e.preventDefault();

    var user = window.joaCurrentUser;
    var supabase = window.joaSupabase;
    if (!user || !supabase) {
      if (window.openJoaAuthModal) window.openJoaAuthModal();
      return;
    }

    var nameInput = document.getElementById("joaNewGroupName");
    var descInput = document.getElementById("joaNewGroupDesc");
    var catInput = document.getElementById("joaNewGroupCategory");
    var platInput = document.getElementById("joaNewGroupPlatform");
    var rulesInput = document.getElementById("joaNewGroupRules");
    var submitBtn = document.getElementById("joaSubmitNewGroupBtn");

    var name = nameInput ? nameInput.value.trim() : "";
    if (!name) {
      showToast("Por favor ingresa un nombre para el grupo.");
      return;
    }

    var desc = descInput ? descInput.value.trim() : "";
    var category = catInput ? catInput.value : "General";
    var platform = platInput ? platInput.value : "Todas";
    var rules = rulesInput ? rulesInput.value.trim() : "";

    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.random().toString(36).substring(2, 6);

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creando grupo...";
    }

    try {
      var res = await supabase.from("community_groups")
        .insert({
          name: name,
          slug: slug,
          description: desc,
          category: category,
          platform: platform,
          rules: rules,
          is_public: true,
          created_by: user.id
        })
        .select("id,name")
        .single();

      if (res.error) {
        console.error("Error al crear grupo:", res.error);
        showToast("No se pudo crear el grupo.");
        return;
      }

      var newGroup = res.data;

      // Unirse automáticamente como owner en group_members
      var memRes = await supabase.from("group_members").insert({
        group_id: newGroup.id,
        user_id: user.id,
        role: "owner"
      });
      if (memRes.error) {
        console.warn("Advertencia al registrar membresía de creador:", memRes.error);
      }

      showToast("¡Grupo '" + newGroup.name + "' creado con éxito!");

      // Limpiar formulario y ocultar
      if (nameInput) nameInput.value = '';
      if (descInput) descInput.value = '';
      if (rulesInput) rulesInput.value = '';
      window.toggleCreateGroupForm(false);

      // Recargar grupos
      window.loadCommunityGroups();

    } catch (e) {
      console.error("Excepción al crear grupo:", e);
      showToast("Error de conexión al crear el grupo.");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "🚀 Crear Grupo";
      }
    }
  };

  /**
   * Unirse a un grupo público
   */
  window.joinCommunityGroup = async function(groupId, groupName) {
    var user = window.joaCurrentUser;
    var supabase = window.joaSupabase;
    if (!user || !supabase) {
      if (window.openJoaAuthModal) window.openJoaAuthModal();
      return;
    }

    try {
      var res = await supabase.from("group_members").insert({
        group_id: groupId,
        user_id: user.id,
        role: "member"
      });

      if (res.error) {
        console.error("Error al unirse al grupo:", res.error);
        showToast("No fue posible unirte al grupo.");
        return;
      }

      showToast("¡Te has unido a " + (groupName || "el grupo") + "!");
      window.loadCommunityGroups();
    } catch (e) {
      console.error("Excepción al unirse al grupo:", e);
      showToast("Error de conexión al unirse.");
    }
  };

  /**
   * Salir de un grupo
   */
  window.leaveCommunityGroup = async function(groupId, groupName) {
    if (!confirm("¿Deseas salir de este grupo?")) return;

    var user = window.joaCurrentUser;
    var supabase = window.joaSupabase;
    if (!user || !supabase) return;

    try {
      var res = await supabase.from("group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", user.id);

      if (res.error) {
        console.error("Error al salir del grupo:", res.error);
        showToast("No se pudo salir del grupo.");
        return;
      }

      showToast("Has salido de " + (groupName || "el grupo") + ".");
      window.loadCommunityGroups();
    } catch (e) {
      console.error("Excepción al salir del grupo:", e);
      showToast("Error al salir del grupo.");
    }
  };

  /* ============================================================
   * SINCRONIZACIÓN DE ESTADO DE SESIÓN
   * ============================================================ */
  window.addEventListener("joa-auth-change", function() {
    if (activeTab === 'friends') {
      window.loadCommunityFriends();
      window.loadCommunityDirectory();
    } else if (activeTab === 'messages') {
      window.loadCommunityChats();
    } else if (activeTab === 'groups') {
      window.loadCommunityGroups();
    }
  });

})();
