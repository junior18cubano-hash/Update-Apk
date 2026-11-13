package com.example;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebView;

public class JoaAuthHandler {
    private static final String TAG = "JoaAuthHandler";
    public static final String AUTH_REDIRECT_URL = "https://junior18cubano-hash.github.io/mi-catalogo/";

    public static boolean shouldOverride(Context context, WebView view, String url) {
        if (url == null) return false;
        if (view != null) setActiveWebView(view);
        Log.d(TAG, "shouldOverride: " + url);

        // 1. Intercept the Supabase OAuth callback URL
        if (isAuthCallback(url)) {
            Log.i(TAG, "Intercepted auth callback URL: " + url);
            JoaSecureStorage.savePendingCallback(context, url);

            if (view != null) {
                final String targetUrl = url;
                view.post(new Runnable() {
                    @Override
                    public void run() {
                        String js = "if(typeof window.handleJoaAuthRedirect === 'function'){ window.handleJoaAuthRedirect('" + escapeJs(targetUrl) + "'); } else { window.location.hash = '" + escapeJs(extractHash(targetUrl)) + "'; }";
                        view.evaluateJavascript(js, null);
                        String currentUrl = view.getUrl();
                        if (currentUrl == null || !currentUrl.startsWith("file:///android_asset/")) {
                            view.loadUrl("file:///android_asset/index.html#" + extractHash(targetUrl));
                        }
                    }
                });
            }
            return true; // Handled! Do NOT open external browser or load github.io website!
        }

        // 2. Allow OAuth authentication URLs to load INSIDE the WebView
        if (isAuthFlowUrl(url)) {
            Log.d(TAG, "Allowing in-app navigation for auth URL: " + url);
            return false; // Load inside WebView
        }

        // 3. Local file URLs and YouTube embeds load in webview
        if (url.startsWith("file://") ||
            url.contains("youtube.com") ||
            url.contains("youtu.be") ||
            url.contains("youtube-nocookie.com") ||
            url.contains("googlevideo.com") ||
            url.contains("ytimg.com")) {
            return false;
        }

        // 4. Other external links open in external browser
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            if (context != null) {
                context.startActivity(intent);
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch intent for: " + url, e);
            return false;
        }
    }

    public static void onPageStarted(Context context, WebView view, String url) {
        if (url == null) return;
        if (view != null) setActiveWebView(view);
        if (isAuthCallback(url)) {
            Log.i(TAG, "onPageStarted intercepted auth callback URL: " + url);
            JoaSecureStorage.savePendingCallback(context, url);
            if (view != null) {
                view.stopLoading();
                final String targetUrl = url;
                view.post(new Runnable() {
                    @Override
                    public void run() {
                        String js = "if(typeof window.handleJoaAuthRedirect === 'function'){ window.handleJoaAuthRedirect('" + escapeJs(targetUrl) + "'); } else { window.location.hash = '" + escapeJs(extractHash(targetUrl)) + "'; }";
                        view.evaluateJavascript(js, null);
                        String currentUrl = view.getUrl();
                        if (currentUrl == null || !currentUrl.startsWith("file:///android_asset/")) {
                            view.loadUrl("file:///android_asset/index.html#" + extractHash(targetUrl));
                        }
                    }
                });
            }
        }
    }

    public static void onPageFinished(Context context, WebView view, String url) {
        if (url == null) return;
        if (url.startsWith("file:///android_asset/")) {
            String pending = JoaSecureStorage.getPendingCallback(context);
            if (pending != null && !pending.isEmpty()) {
                Log.i(TAG, "Delivering pending auth callback on page finished");
                JoaSecureStorage.clearPendingCallback(context);
                if (view != null) {
                    final String targetUrl = pending;
                    view.post(new Runnable() {
                        @Override
                        public void run() {
                            String js = "if(typeof window.handleJoaAuthRedirect === 'function'){ window.handleJoaAuthRedirect('" + escapeJs(targetUrl) + "'); }";
                            view.evaluateJavascript(js, null);
                        }
                    });
                }
            }
        }
    }

    private static java.lang.ref.WeakReference<WebView> activeWebView = null;

    public static void setActiveWebView(WebView view) {
        if (view != null) {
            activeWebView = new java.lang.ref.WeakReference<>(view);
            try {
                android.webkit.WebSettings settings = view.getSettings();
                settings.setJavaScriptEnabled(true);
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setJavaScriptCanOpenWindowsAutomatically(true);
                settings.setSupportMultipleWindows(false);

                // Remove '; wv' from User-Agent string to prevent Google OAuth 'disallowed_useragent' error in WebView
                String defaultUa = settings.getUserAgentString();
                if (defaultUa != null && defaultUa.contains("; wv")) {
                    String cleanUa = defaultUa.replace("; wv", "");
                    settings.setUserAgentString(cleanUa);
                }

                // Enable Cookies and Third-Party Cookies for OAuth authentication flows inside WebView
                android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
                cookieManager.setAcceptCookie(true);
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                    cookieManager.setAcceptThirdPartyCookies(view, true);
                }
            } catch (Throwable t) {
                Log.e(TAG, "Error configuring webview settings", t);
            }
        }
    }

    public static boolean handleActivityIntent(Activity activity, Intent intent) {
        if (activity == null || intent == null) return false;
        Uri uri = intent.getData();
        if (uri != null) {
            String url = uri.toString();
            if (isAuthCallback(url)) {
                Log.i(TAG, "handleActivityIntent intercepted callback: " + url);
                JoaSecureStorage.savePendingCallback(activity, url);
                try {
                    WebView wv = activeWebView != null ? activeWebView.get() : null;
                    if (wv == null) {
                        try {
                            Class<?> holderClass = Class.forName("com.example.WebViewHolder");
                            Object instance = holderClass.getField("INSTANCE").get(null);
                            wv = (WebView) holderClass.getMethod("getWebView").invoke(instance);
                        } catch (Throwable ignored) {}
                    }
                    if (wv != null) {
                        final WebView targetWv = wv;
                        final String targetUrl = url;
                        targetWv.post(new Runnable() {
                            @Override
                            public void run() {
                                String js = "if(typeof window.handleJoaAuthRedirect === 'function'){ window.handleJoaAuthRedirect('" + escapeJs(targetUrl) + "'); } else { window.location.hash = '" + escapeJs(extractHash(targetUrl)) + "'; }";
                                targetWv.evaluateJavascript(js, null);
                                String currentUrl = targetWv.getUrl();
                                if (currentUrl == null || !currentUrl.startsWith("file:///android_asset/")) {
                                    targetWv.loadUrl("file:///android_asset/index.html#" + extractHash(targetUrl));
                                }
                            }
                        });
                    }
                } catch (Throwable t) {
                    Log.e(TAG, "Error handling activity intent in WebViewHolder", t);
                }
                return true;
            }
        }
        return false;
    }

    public static boolean isAuthCallback(String url) {
        if (url == null) return false;
        boolean isCallbackHost = url.contains("junior18cubano-hash.github.io");
        boolean hasAuthTokens = url.contains("access_token=") || url.contains("refresh_token=") || url.contains("code=") || url.contains("error_description=");
        return isCallbackHost || hasAuthTokens;
    }

    public static boolean isAuthFlowUrl(String url) {
        if (url == null) return false;
        return url.contains("accounts.google.com") ||
               url.contains("accounts.youtube.com") ||
               url.contains("apis.google.com") ||
               url.contains("ssl.gstatic.com") ||
               url.contains("gstatic.com") ||
               url.contains("google.com/signin") ||
               url.contains("google.com/accounts") ||
               url.contains("google.com/oauth") ||
               url.contains("googleusercontent.com") ||
               url.contains("googleapis.com") ||
               url.contains("dezyngtzzblzqmofesxg.supabase.co") ||
               url.contains("supabase.co");
    }

    private static String extractHash(String url) {
        if (url == null) return "";
        int hashIdx = url.indexOf('#');
        if (hashIdx != -1) return url.substring(hashIdx + 1);
        int queryIdx = url.indexOf('?');
        if (queryIdx != -1) return url.substring(queryIdx + 1);
        return "";
    }

    private static String escapeJs(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("'", "\\'").replace("\"", "\\\"").replace("\n", "").replace("\r", "");
    }
}
