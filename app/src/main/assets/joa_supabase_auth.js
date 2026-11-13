/**
 * ============================================================
 * 🌐 JOA GAMERS · CLIENTE SUPABASE & AUTENTICACIÓN UNIFICADA
 * Ecosistema JOA Multiverso (APK Android ↔ Plataforma Web)
 * ============================================================
 */
(function() {
  'use strict';

  var supabase = null;
  var currentUser = null;
  var currentSession = null;
  var currentProfile = null;
  var authMode = 'signin'; // 'signin' | 'signup'

  // Exponer estado global
  window.joaSupabase = null;
  window.joaCurrentUser = null;
  window.joaCurrentProfile = null;
  window.joaCurrentSession = null;

  /**
   * Inicialización del cliente Supabase
   */
  function initSupabase() {
    var config = window.JOA_CONFIG || {};
    var url = config.supabaseUrl || "https://dezyngtzzblzqmofesxg.supabase.co";
    var key = config.supabasePublishableKey || "sb_publishable_ddFEt_bHXdf2eCFlmKKqQg_mW0mXQoY";

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.warn("JOA Auth: SDK de Supabase no disponible en window.supabase.");
      return null;
    }

    try {
      supabase = window.supabase.createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: "pkce"
        },
        global: {
          headers: {
            "X-Client-Info": "joa-gamers-android/1.0.8"
          }
        }
      });
      window.joaSupabase = supabase;
      console.info("JOA Auth: Cliente Supabase inicializado correctamente.");
      return supabase;
    } catch (err) {
      console.error("JOA Auth: Error al inicializar cliente Supabase:", err);
      return null;
    }
  }

  /**
   * Obtiene las iniciales de un nombre
   */
  function getInitials(name) {
    if (!name) return "JOA";
    var parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  /**
   * Formatea errores de autenticación a mensajes claros en español
   */
  function formatAuthError(err) {
    if (!err) return "Ocurrió un error inesperado.";
    var msg = (err.message || "").toLowerCase();
    if (msg.indexOf("invalid login credentials") !== -1 || msg.indexOf("invalid_credentials") !== -1) {
      return "Correo o contraseña incorrectos. Verifica tus datos.";
    }
    if (msg.indexOf("user already registered") !== -1) {
      return "Este correo ya está registrado. Prueba a iniciar sesión.";
    }
    if (msg.indexOf("password should be at least") !== -1) {
      return "La contraseña debe tener al menos 6 caracteres.";
    }
    if (msg.indexOf("email not confirmed") !== -1) {
      return "Confirma tu correo electrónico para poder acceder.";
    }
    if (msg.indexOf("network") !== -1 || msg.indexOf("fetch") !== -1) {
      return "Sin conexión con el servidor. Revisa tu internet.";
    }
    return err.message || "Error al autenticar con JOA Multiverso.";
  }

  /**
   * Muestra mensaje flotante tipo Toast
   */
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
   * Asegura que el usuario tenga un perfil en la tabla 'profiles'
   */
  async function ensureCommunityProfile(user) {
    if (!user || !supabase) return null;
    try {
      var meta = user.user_metadata || {};
      var display = meta.full_name || meta.name || (user.email ? user.email.split("@")[0] : "Jugador JOA");
      var defaultUsername = "joa_" + user.id.replace(/-/g, "").slice(0, 10);

      var sel = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (sel.error) throw sel.error;

      var existing = sel.data;
      if (existing) {
        var patch = {};
        if (!existing.username) patch.username = defaultUsername;
        if (!existing.display_name) patch.display_name = display;
        if (!existing.avatar_url && (meta.avatar_url || meta.picture)) {
          patch.avatar_url = meta.avatar_url || meta.picture;
        }
        if (Object.keys(patch).length > 0) {
          patch.updated_at = new Date().toISOString();
          var upd = await supabase.from("profiles").update(patch).eq("id", user.id).select().maybeSingle();
          currentProfile = upd.data || existing;
        } else {
          currentProfile = existing;
        }
      } else {
        var newProfile = {
          id: user.id,
          username: defaultUsername,
          display_name: display,
          avatar_url: meta.avatar_url || meta.picture || null,
          created_at: new Date().toISOString()
        };
        var ins = await supabase.from("profiles").insert(newProfile).select().maybeSingle();
        if (ins.error) throw ins.error;
        currentProfile = ins.data || newProfile;
      }

      window.joaCurrentProfile = currentProfile;
      return currentProfile;
    } catch (err) {
      console.warn("JOA Auth: No se pudo verificar el perfil en la tabla profiles:", err);
      // Fallback seguro usando metadatos
      currentProfile = {
        id: user.id,
        display_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "Jugador JOA",
        username: "joa_" + user.id.replace(/-/g, "").slice(0, 10),
        avatar_url: user.user_metadata?.avatar_url || null
      };
      window.joaCurrentProfile = currentProfile;
      return currentProfile;
    }
  }

  /**
   * Actualiza los elementos visuales de la interfaz de usuario con la sesión activa
   */
  function updateAuthUI() {
    var topbarBtn = document.getElementById("topbarAuthBtn");
    var sidebarCard = document.getElementById("sidebarProfileCard");
    var sidebarAvatar = document.getElementById("profileAvatarChip");
    var sidebarName = document.getElementById("profileNameChip");

    if (currentUser) {
      var displayName = currentProfile?.display_name || currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "Jugador JOA";
      var username = currentProfile?.username ? "@" + currentProfile.username : "@" + currentUser.id.slice(0, 8);
      var avatarUrl = currentProfile?.avatar_url || currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture;

      // Actualizar botón de Topbar
      if (topbarBtn) {
        topbarBtn.classList.add("is-logged-in");
        topbarBtn.title = "Cuenta JOA: " + displayName + " (" + username + ")";
        if (avatarUrl) {
          topbarBtn.innerHTML = '<span class="topbar-user-avatar-wrap"><img src="' + avatarUrl + '" alt="" class="topbar-user-img" onerror="this.onerror=null; this.parentElement.innerHTML=\'' + getInitials(displayName) + '\';"><span class="topbar-online-dot"></span></span><span class="topbar-user-name-txt">' + displayName + '</span>';
        } else {
          topbarBtn.innerHTML = '<span class="topbar-user-avatar-wrap"><span class="topbar-user-initials">' + getInitials(displayName) + '</span><span class="topbar-online-dot"></span></span><span class="topbar-user-name-txt">' + displayName + '</span>';
        }
      }

      // Actualizar tarjeta del Sidebar
      if (sidebarCard) {
        sidebarCard.classList.add("is-synced-cloud");
        sidebarCard.onclick = function() { window.openJoaAccountModal(); };
      }
      if (sidebarAvatar) {
        if (avatarUrl) {
          sidebarAvatar.innerHTML = '<img src="' + avatarUrl + '" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" onerror="this.onerror=null; this.parentElement.textContent=\'' + getInitials(displayName) + '\';">';
        } else {
          sidebarAvatar.textContent = getInitials(displayName);
        }
      }
      if (sidebarName) {
        sidebarName.innerHTML = '<span>' + displayName + '</span> <span style="font-size:0.6rem; background:#00FFB2; color:#04050A; padding:1px 5px; border-radius:4px; font-weight:800; margin-left:4px;">ONLINE</span>';
        var subEl = sidebarCard ? sidebarCard.querySelector(".sub") : null;
        if (subEl) subEl.textContent = username + " · Cuenta JOA";
      }

    } else {
      // Estado desconectado / Invitado
      if (topbarBtn) {
        topbarBtn.classList.remove("is-logged-in");
        topbarBtn.title = "Iniciar sesión en JOA Multiverso";
        topbarBtn.innerHTML = '<span class="topbar-auth-icon">👤</span><span class="topbar-auth-txt">Acceder</span>';
      }

      if (sidebarCard) {
        sidebarCard.classList.remove("is-synced-cloud");
        sidebarCard.onclick = function() { window.openJoaAuthModal(); };
      }
      if (sidebarAvatar) {
        sidebarAvatar.textContent = "🙂";
      }
      if (sidebarName) {
        sidebarName.textContent = "Invitado";
        var subEl = sidebarCard ? sidebarCard.querySelector(".sub") : null;
        if (subEl) subEl.textContent = "Toca para iniciar sesión";
      }
    }

    // Notificar a otros módulos suscritos al evento
    window.dispatchEvent(new CustomEvent("joa-auth-change", {
      detail: {
        user: currentUser,
        profile: currentProfile,
        session: currentSession
      }
    }));
  }

  /**
   * Renderiza el estado del modal de login/registro (modo Iniciar sesión vs Registro)
   */
  function renderModalMode() {
    var titleEl = document.getElementById("joaAuthModalTitle");
    var descEl = document.getElementById("joaAuthModalDesc");
    var submitBtn = document.getElementById("joaAuthSubmitBtn");
    var switchBtn = document.getElementById("joaAuthSwitchBtn");
    var forgotBtn = document.getElementById("joaAuthForgotBtn");
    var passInput = document.getElementById("joaAuthPassword");
    var msgEl = document.getElementById("joaAuthMsg");

    if (msgEl) msgEl.textContent = "";

    if (authMode === "signin") {
      if (titleEl) titleEl.innerHTML = 'Entra en tu <span class="hl-cyan">universo.</span>';
      if (descEl) descEl.textContent = "Inicia sesión con tu cuenta de JOA Multiverso.";
      if (submitBtn) submitBtn.innerHTML = '<span>⚡ Iniciar Sesión</span>';
      if (switchBtn) switchBtn.textContent = "¿No tienes cuenta? Regístrate gratis";
      if (forgotBtn) forgotBtn.style.display = "inline-block";
      if (passInput) passInput.autocomplete = "current-password";
    } else {
      if (titleEl) titleEl.innerHTML = 'Crea tu <span class="hl-green">cuenta JOA.</span>';
      if (descEl) descEl.textContent = "Regístrate para compartir favoritos, reseñas y conectar con la comunidad.";
      if (submitBtn) submitBtn.innerHTML = '<span>✨ Crear Cuenta</span>';
      if (switchBtn) switchBtn.textContent = "¿Ya tienes cuenta? Inicia sesión";
      if (forgotBtn) forgotBtn.style.display = "none";
      if (passInput) passInput.autocomplete = "new-password";
    }
  }

  /**
   * Abre el modal de autenticación
   */
  window.openJoaAuthModal = function(mode) {
    if (currentUser) {
      window.openJoaAccountModal();
      return;
    }
    if (mode === "signup" || mode === "signin") {
      authMode = mode;
    }
    renderModalMode();
    var modal = document.getElementById("joaAuthModal");
    if (modal) {
      modal.style.display = "flex";
      modal.classList.add("modal-active");
      var emailInp = document.getElementById("joaAuthEmail");
      if (emailInp) setTimeout(function() { emailInp.focus(); }, 150);
    }
  };

  /**
   * Cierra el modal de autenticación
   */
  window.closeJoaAuthModal = function() {
    var modal = document.getElementById("joaAuthModal");
    if (modal) {
      modal.style.display = "none";
      modal.classList.remove("modal-active");
    }
  };

  /**
   * Abre el modal de perfil de cuenta activa
   */
  window.openJoaAccountModal = function() {
    if (!currentUser) {
      window.openJoaAuthModal();
      return;
    }
    var modal = document.getElementById("joaAccountModal");
    if (!modal) return;

    var displayName = currentProfile?.display_name || currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "Jugador JOA";
    var username = currentProfile?.username ? "@" + currentProfile.username : "@" + currentUser.id.slice(0, 8);
    var email = currentUser.email || "Sin correo";
    var avatarUrl = currentProfile?.avatar_url || currentUser.user_metadata?.avatar_url;

    var nameEl = document.getElementById("joaAccDisplayName");
    var userEl = document.getElementById("joaAccUsername");
    var emailEl = document.getElementById("joaAccEmail");
    var avatarEl = document.getElementById("joaAccAvatar");

    if (nameEl) nameEl.textContent = displayName;
    if (userEl) userEl.textContent = username;
    if (emailEl) emailEl.textContent = email;
    if (avatarEl) {
      if (avatarUrl) {
        avatarEl.innerHTML = '<img src="' + avatarUrl + '" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" onerror="this.onerror=null; this.parentElement.textContent=\'' + getInitials(displayName) + '\';">';
      } else {
        avatarEl.textContent = getInitials(displayName);
      }
    }

    modal.style.display = "flex";
    modal.classList.add("modal-active");
  };

  /**
   * Cierra el modal de cuenta
   */
  window.closeJoaAccountModal = function() {
    var modal = document.getElementById("joaAccountModal");
    if (modal) {
      modal.style.display = "none";
      modal.classList.remove("modal-active");
    }
  };

  /**
   * Manejador de Login / Registro por Correo y Contraseña
   */
  window.handleJoaAuthSubmit = async function(event) {
    if (event) event.preventDefault();
    if (!supabase) {
      supabase = initSupabase();
      if (!supabase) {
        showToast("Error: No se pudo conectar con el servidor de autenticación.");
        return;
      }
    }

    var emailInput = document.getElementById("joaAuthEmail");
    var passInput = document.getElementById("joaAuthPassword");
    var submitBtn = document.getElementById("joaAuthSubmitBtn");
    var msgEl = document.getElementById("joaAuthMsg");

    var email = emailInput ? emailInput.value.trim() : "";
    var password = passInput ? passInput.value : "";

    if (!email || !password) {
      if (msgEl) msgEl.textContent = "Por favor, escribe tu correo y contraseña.";
      return;
    }
    if (password.length < 6) {
      if (msgEl) msgEl.textContent = "La contraseña debe tener al menos 6 caracteres.";
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>⏳ Conectando...</span>';
    }
    if (msgEl) msgEl.textContent = "Verificando con JOA Multiverso...";

    try {
      if (authMode === "signup") {
        var resSignup = await supabase.auth.signUp({
          email: email,
          password: password,
          options: {
            emailRedirectTo: window.JOA_CONFIG?.authRedirectUrl || "https://junior18cubano-hash.github.io/mi-catalogo/"
          }
        });
        if (resSignup.error) throw resSignup.error;

        if (resSignup.data && resSignup.data.user && resSignup.data.session) {
          currentUser = resSignup.data.user;
          currentSession = resSignup.data.session;
          window.joaCurrentUser = currentUser;
          window.joaCurrentSession = currentSession;
          await ensureCommunityProfile(currentUser);
          updateAuthUI();
          window.closeJoaAuthModal();
          showToast("¡Cuenta creada con éxito! Bienvenido a JOA.");
        } else {
          if (msgEl) {
            msgEl.innerHTML = '<span style="color:#00FFB2;">✅ Registro enviado. Revisa tu correo electrónico para confirmar tu cuenta.</span>';
          }
          showToast("Registro completado. Revisa tu correo de confirmación.");
        }
      } else {
        // Modo Inicio de Sesión
        var resSignin = await supabase.auth.signInWithPassword({
          email: email,
          password: password
        });
        if (resSignin.error) throw resSignin.error;

        currentUser = resSignin.data.user;
        currentSession = resSignin.data.session;
        window.joaCurrentUser = currentUser;
        window.joaCurrentSession = currentSession;

        await ensureCommunityProfile(currentUser);
        updateAuthUI();
        window.closeJoaAuthModal();
        showToast("¡Bienvenido de nuevo a JOA!");
      }
    } catch (err) {
      console.error("JOA Auth Error:", err);
      var userMsg = formatAuthError(err);
      if (msgEl) msgEl.textContent = userMsg;
      showToast(userMsg);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        renderModalMode();
      }
    }
  };

  /**
   * Manejador de "¿Olvidaste tu contraseña?"
   */
  window.handleJoaForgotPass = async function() {
    if (!supabase) supabase = initSupabase();
    var emailInput = document.getElementById("joaAuthEmail");
    var msgEl = document.getElementById("joaAuthMsg");
    var email = emailInput ? emailInput.value.trim() : "";

    if (!email) {
      if (msgEl) msgEl.textContent = "Escribe tu correo arriba para enviarte el enlace de restablecimiento.";
      showToast("Ingresa tu correo electrónico primero.");
      return;
    }

    try {
      if (msgEl) msgEl.textContent = "Enviando solicitud de restablecimiento...";
      var res = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.JOA_CONFIG?.authRedirectUrl || "https://junior18cubano-hash.github.io/mi-catalogo/"
      });
      if (res.error) throw res.error;
      if (msgEl) msgEl.innerHTML = '<span style="color:#00FFB2;">Enlace enviado a ' + email + '. Revisa tu bandeja de entrada o spam.</span>';
      showToast("Enlace de restablecimiento enviado.");
    } catch (err) {
      var userMsg = formatAuthError(err);
      if (msgEl) msgEl.textContent = userMsg;
      showToast(userMsg);
    }
  };

  /**
   * Manejador de alternar entre Iniciar Sesión y Registro
   */
  window.toggleJoaAuthMode = function() {
    authMode = (authMode === "signin") ? "signup" : "signin";
    renderModalMode();
  };

  /**
   * Inicio de sesión con Google OAuth
   */
  window.handleJoaGoogleOAuth = async function(chooseAccount) {
    if (!supabase) supabase = initSupabase();
    var msgEl = document.getElementById("joaAuthMsg");
    var googleBtn = document.getElementById("joaGoogleAuthBtn");
    if (!supabase) { showToast("No se pudo conectar con el servidor de autenticación."); return; }
    try {
      if (googleBtn) googleBtn.disabled = true;
      if (msgEl) msgEl.textContent = "Abriendo el acceso seguro de Google...";
      var res = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: "joacatalogo://auth",
          skipBrowserRedirect: true,
          ...(chooseAccount ? { queryParams: { prompt: "select_account" } } : {})
        }
      });
      if (res.error) throw res.error;
      if (!res.data?.url) throw new Error("Google no devolvió la dirección de acceso.");
      if (window.AndroidBridge && typeof window.AndroidBridge.openExternalAuthUrl === "function") {
        window.AndroidBridge.openExternalAuthUrl(res.data.url);
      } else {
        window.location.href = res.data.url;
      }
      showToast("Continúa el acceso en Google. Volverás a JOA automáticamente.");
    } catch (err) {
      console.error("JOA Google OAuth Error:", err);
      var userMsg = formatAuthError(err);
      if (msgEl) msgEl.textContent = userMsg;
      showToast(userMsg);
    } finally {
      if (googleBtn) googleBtn.disabled = false;
    }
  };

  /**
   * Cierre de sesión
   */
  window.joaSignOut = async function() {
    if (!supabase) supabase = initSupabase();
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
      currentUser = null;
      currentSession = null;
      currentProfile = null;
      window.joaCurrentUser = null;
      window.joaCurrentSession = null;
      window.joaCurrentProfile = null;
      updateAuthUI();
      window.closeJoaAccountModal();
      showToast("Has cerrado sesión en JOA.");
    } catch (err) {
      console.error("Error al cerrar sesión:", err);
      showToast("Error al cerrar sesión.");
    }
  };

  /**
   * Manejador global para redirecciones de autenticación por Deep Link o WebView Interception
   */
  var oauthCallbackInFlight = null;
  var lastSuccessfulOAuthCallback = null;

  window.handleJoaAuthRedirect = async function(url) {
    if (!url) return false;
    if (lastSuccessfulOAuthCallback === url) return true;
    if (oauthCallbackInFlight) return oauthCallbackInFlight;
    if (!supabase) supabase = initSupabase();
    if (!supabase) return false;

    oauthCallbackInFlight = (async function() {
      try {
        console.info("JOA Auth: Procesando callback OAuth:", url);
        var parsed = new URL(url, window.location.href);
        var queryParams = new URLSearchParams(parsed.search || "");
        var hashParams = new URLSearchParams((parsed.hash || "").replace(/^#/, ""));
        var code = queryParams.get("code") || hashParams.get("code");
        var accessToken = queryParams.get("access_token") || hashParams.get("access_token");
        var refreshToken = queryParams.get("refresh_token") || hashParams.get("refresh_token");
        var oauthError = queryParams.get("error_description") || hashParams.get("error_description") ||
          queryParams.get("error") || hashParams.get("error");
        if (oauthError) throw new Error(String(oauthError).replace(/\+/g, " "));

        var sessionRes;
        if (code) {
          sessionRes = await supabase.auth.exchangeCodeForSession(code);
        } else if (accessToken && refreshToken) {
          sessionRes = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        } else {
          throw new Error("Google regresó sin código de autorización ni tokens de sesión.");
        }
        if (sessionRes.error) throw sessionRes.error;
        currentSession = sessionRes.data?.session || null;
        currentUser = sessionRes.data?.user || currentSession?.user || null;
        if (!currentUser || !currentSession) throw new Error("Google no devolvió una sesión válida para JOA.");

        window.joaCurrentUser = currentUser;
        window.joaCurrentSession = currentSession;
        await ensureCommunityProfile(currentUser);
        updateAuthUI();
        window.closeJoaAuthModal();
        if (window.AndroidBridge && typeof window.AndroidBridge.clearPendingAuthCallbackUrl === "function") {
          try { window.AndroidBridge.clearPendingAuthCallbackUrl(); } catch (bridgeErr) {}
        }
        lastSuccessfulOAuthCallback = url;
        showToast("¡Sesión iniciada con Google en JOA Multiverso!");
        return true;
      } catch (err) {
        console.error("JOA Auth OAuth Callback Error:", err);
        var userMsg = formatAuthError(err);
        var msgEl = document.getElementById("joaAuthMsg");
        if (msgEl) msgEl.textContent = userMsg;
        showToast(userMsg);
        return false;
      }
    })();
    try { return await oauthCallbackInFlight; }
    finally { oauthCallbackInFlight = null; }
  };

  /**
   * Arranque del módulo al cargar la página
   */
  function bootAuth() {
    initSupabase();
    if (!supabase) return;

    // El callback nativo se limpia únicamente después de procesar correctamente el código PKCE.
    if (window.AndroidBridge && typeof window.AndroidBridge.getPendingAuthCallbackUrl === 'function') {
      try {
        var pendingUrl = window.AndroidBridge.getPendingAuthCallbackUrl();
        if (pendingUrl) window.handleJoaAuthRedirect(pendingUrl);
      } catch(e) { console.warn("JOA Auth: No se pudo leer el callback pendiente:", e); }
    }

    if (/[?&]code=/.test(window.location.search || "") ||
        /(?:^|[&#])(?:access_token|code)=/.test((window.location.hash || "").replace(/^#/, ""))) {
      window.handleJoaAuthRedirect(window.location.href);
    }

    // Escuchar cambios de estado en segundo plano
    supabase.auth.onAuthStateChange(async function(event, session) {
      console.info("JOA Auth Event:", event);
      if (event === "INITIAL_SESSION" && !session) return;
      currentSession = session || null;
      currentUser = session?.user || null;
      window.joaCurrentUser = currentUser;
      window.joaCurrentSession = currentSession;

      if (currentSession && window.AndroidBridge && typeof window.AndroidBridge.saveSupabaseTokens === 'function') {
        try { window.AndroidBridge.saveSupabaseTokens(JSON.stringify(currentSession)); } catch(e) {}
      } else if (event === "SIGNED_OUT" && window.AndroidBridge && typeof window.AndroidBridge.clearSupabaseTokens === 'function') {
        try { window.AndroidBridge.clearSupabaseTokens(); } catch(e) {}
      }

      if (currentUser) {
        await ensureCommunityProfile(currentUser);
      } else {
        currentProfile = null;
        window.joaCurrentProfile = null;
      }
      updateAuthUI();
    });

    // Comprobación inicial de sesión persistida
    supabase.auth.getSession().then(async function(res) {
      if (res.data?.session?.user) {
        currentUser = res.data.session.user;
        currentSession = res.data.session;
        window.joaCurrentUser = currentUser;
        window.joaCurrentSession = currentSession;
        if (window.AndroidBridge && typeof window.AndroidBridge.saveSupabaseTokens === 'function') {
          try { window.AndroidBridge.saveSupabaseTokens(JSON.stringify(currentSession)); } catch(e) {}
        }
        await ensureCommunityProfile(currentUser);
        updateAuthUI();
        console.info("JOA Auth: Sesión restaurada para", currentUser.email);
      } else {
        // Fallback: Intentar restaurar la sesión desde EncryptedSharedPreferences nativo de Android
        if (window.AndroidBridge && typeof window.AndroidBridge.getSupabaseTokens === 'function') {
          try {
            var storedJson = window.AndroidBridge.getSupabaseTokens();
            if (storedJson) {
              var savedSess = JSON.parse(storedJson);
              if (savedSess && savedSess.access_token) {
                console.info("JOA Auth: Restaurando sesión guardada en EncryptedSharedPreferences...");
                var setRes = await supabase.auth.setSession({
                  access_token: savedSess.access_token,
                  refresh_token: savedSess.refresh_token || ""
                });
                if (setRes.data?.session?.user) {
                  currentUser = setRes.data.session.user;
                  currentSession = setRes.data.session;
                  window.joaCurrentUser = currentUser;
                  window.joaCurrentSession = currentSession;
                  await ensureCommunityProfile(currentUser);
                  updateAuthUI();
                  console.info("JOA Auth: Sesión restaurada exitosamente desde EncryptedSharedPreferences para", currentUser.email);
                  return;
                }
              }
            }
          } catch(errEnc) {
            console.warn("JOA Auth: Error al restaurar tokens desde EncryptedSharedPreferences:", errEnc);
          }
        }
        updateAuthUI();
      }
    }).catch(function(err) {
      console.warn("JOA Auth: No se pudo restaurar sesión:", err);
      updateAuthUI();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootAuth);
  } else {
    bootAuth();
  }

})();
