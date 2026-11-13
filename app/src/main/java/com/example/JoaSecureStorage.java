package com.example;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

public class JoaSecureStorage {
    private static final String TAG = "JoaSecureStorage";
    private static final String PREF_NAME = "joa_supabase_secure_prefs";
    private static final String KEY_SESSION_JSON = "session_json";
    private static final String KEY_PENDING_CALLBACK = "pending_auth_callback";

    private static SharedPreferences getPrefs(Context context) {
        if (context == null) return null;
        try {
            MasterKey masterKey = new MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
            return EncryptedSharedPreferences.create(
                context,
                PREF_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Throwable t) {
            Log.w(TAG, "EncryptedSharedPreferences init failed, fallback to app-private preferences", t);
            return context.getSharedPreferences(PREF_NAME + "_fallback", Context.MODE_PRIVATE);
        }
    }

    public static void saveSessionJson(Context context, String sessionJson) {
        if (context == null || sessionJson == null) return;
        try {
            SharedPreferences sp = getPrefs(context);
            if (sp != null) {
                sp.edit().putString(KEY_SESSION_JSON, sessionJson).apply();
                Log.d(TAG, "Supabase session saved successfully in secure EncryptedSharedPreferences");
            }
        } catch (Throwable t) {
            Log.e(TAG, "Error saving session in secure storage", t);
        }
    }

    public static String getSessionJson(Context context) {
        if (context == null) return "";
        try {
            SharedPreferences sp = getPrefs(context);
            if (sp != null) {
                String s = sp.getString(KEY_SESSION_JSON, "");
                return s != null ? s : "";
            }
        } catch (Throwable t) {
            Log.e(TAG, "Error reading session from secure storage", t);
        }
        return "";
    }

    public static void clearSession(Context context) {
        if (context == null) return;
        try {
            SharedPreferences sp = getPrefs(context);
            if (sp != null) {
                sp.edit().remove(KEY_SESSION_JSON).apply();
                Log.d(TAG, "Supabase session cleared from secure EncryptedSharedPreferences");
            }
        } catch (Throwable t) {
            Log.e(TAG, "Error clearing session from secure storage", t);
        }
    }

    public static void savePendingCallback(Context context, String callbackUrl) {
        if (context == null || callbackUrl == null) return;
        try {
            SharedPreferences sp = getPrefs(context);
            if (sp != null) {
                sp.edit().putString(KEY_PENDING_CALLBACK, callbackUrl).apply();
                Log.d(TAG, "Pending auth callback URL saved to secure storage");
            }
        } catch (Throwable t) {
            Log.e(TAG, "Error saving pending callback URL", t);
        }
    }

    public static String getPendingCallback(Context context) {
        if (context == null) return "";
        try {
            SharedPreferences sp = getPrefs(context);
            if (sp != null) {
                String s = sp.getString(KEY_PENDING_CALLBACK, "");
                return s != null ? s : "";
            }
        } catch (Throwable t) {
            Log.e(TAG, "Error getting pending callback URL", t);
        }
        return "";
    }

    public static void clearPendingCallback(Context context) {
        if (context == null) return;
        try {
            SharedPreferences sp = getPrefs(context);
            if (sp != null) {
                sp.edit().remove(KEY_PENDING_CALLBACK).apply();
            }
        } catch (Throwable t) {}
    }
}
