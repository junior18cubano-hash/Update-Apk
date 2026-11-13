#!/usr/bin/env python3
import os
import sys
import shutil
import subprocess
import zipfile

def patch_apk(apk_path):
    print("=== Patching APK for Supabase Auth and Encrypted Storage ===")
    if not os.path.exists(apk_path):
        print(f"Error: APK not found at {apk_path}")
        return False

    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build_dir = "/tmp/apk_auth_patch_work"
    if os.path.exists(build_dir):
        shutil.rmtree(build_dir)
    os.makedirs(build_dir, exist_ok=True)

    # 1. Extract security-crypto.jar
    aar_path = "/opt/gradle/.gradle/caches/modules-2/files-2.1/androidx.security/security-crypto/1.1.0-alpha03/f54110eab7610d08d7c41c594b3a248dac488e00/security-crypto-1.1.0-alpha03.aar"
    tink_path = "/opt/gradle/.gradle/caches/modules-2/files-2.1/com.google.crypto.tink/tink-android/1.5.0/3d728fc1c43446a7a1e602c896b67cce2d57281d/tink-android-1.5.0.jar"
    sec_jar = os.path.join(build_dir, "security-crypto.jar")
    with zipfile.ZipFile(aar_path, "r") as z:
        with open(sec_jar, "wb") as f:
            f.write(z.read("classes.jar"))

    # 2. Compile Java sources
    classes_dir = os.path.join(build_dir, "classes")
    os.makedirs(classes_dir, exist_ok=True)
    android_jar = "/opt/android/sdk/platforms/android-36/android.jar"
    cp = ":".join([android_jar, sec_jar, tink_path])
    src_files = [
        os.path.join(root_dir, "app/src/main/java/com/example/JoaSecureStorage.java"),
        os.path.join(root_dir, "app/src/main/java/com/example/JoaAuthHandler.java")
    ]
    cmd_javac = ["javac", "-cp", cp, "-d", classes_dir] + src_files
    subprocess.run(cmd_javac, check=True)
    print("Compiled JoaSecureStorage and JoaAuthHandler successfully")

    # 3. Create classes6.dex using d8
    dex_out_dir = os.path.join(build_dir, "dex_out")
    os.makedirs(dex_out_dir, exist_ok=True)
    d8_bin = "/opt/android/sdk/build-tools/36.0.0/d8"
    java_classes = [
        os.path.join(classes_dir, "com/example", f)
        for f in os.listdir(os.path.join(classes_dir, "com/example"))
        if f.endswith(".class")
    ]
    cmd_d8 = [d8_bin, "--min-api", "24", "--lib", android_jar, "--output", dex_out_dir] + java_classes + [sec_jar, tink_path]
    subprocess.run(cmd_d8, check=True)
    classes6_dex = os.path.join(build_dir, "classes6.dex")
    shutil.move(os.path.join(dex_out_dir, "classes.dex"), classes6_dex)
    print("Built classes6.dex with EncryptedSharedPreferences, size:", os.path.getsize(classes6_dex))

    # 4. Extract classes4.dex and disassemble with baksmali
    with zipfile.ZipFile(apk_path, "r") as z:
        z.extract("classes4.dex", build_dir)
    smali_dir = os.path.join(build_dir, "smali4")
    smali_cp = "/tmp/smali-3.0.3.jar:/tmp/antlr-runtime-3.5.2.jar:/opt/android/sdk/cmdline-tools/latest/lib/*:/opt/android/sdk/cmdline-tools/latest/lib/external/*"
    cmd_baksmali = [
        "java", "-cp", smali_cp,
        "com.android.tools.smali.baksmali.Main", "d",
        os.path.join(build_dir, "classes4.dex"), "-o", smali_dir
    ]
    subprocess.run(cmd_baksmali, check=True)
    print("Disassembled classes4.dex")

    # 5. Patch WebViewClient: MainActivityKt$CatalogWebViewScreen$2$1$1$2.smali
    client_smali_path = os.path.join(smali_dir, "com/example/MainActivityKt$CatalogWebViewScreen$2$1$1$2.smali")
    with open(client_smali_path, "r") as f:
        client_code = f.read()

    new_should_override = """.method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Z
    .registers 5
    .param p1, "view"    # Landroid/webkit/WebView;
    .param p2, "request"    # Landroid/webkit/WebResourceRequest;

    if-eqz p2, :cond_15

    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;
    move-result-object v0

    if-eqz v0, :cond_15

    invoke-virtual {v0}, Landroid/net/Uri;->toString()Ljava/lang/String;
    move-result-object v0

    if-eqz v0, :cond_15

    iget-object v1, p0, Lcom/example/MainActivityKt$CatalogWebViewScreen$2$1$1$2;->$ctx:Landroid/content/Context;

    invoke-static {v1, p1, v0}, Lcom/example/JoaAuthHandler;->shouldOverride(Landroid/content/Context;Landroid/webkit/WebView;Ljava/lang/String;)Z
    move-result v0
    return v0

    :cond_15
    const/4 v0, 0x0
    return v0
.end method

.method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Ljava/lang/String;)Z
    .registers 4
    .param p1, "view"    # Landroid/webkit/WebView;
    .param p2, "url"    # Ljava/lang/String;

    if-eqz p2, :cond_b

    iget-object v0, p0, Lcom/example/MainActivityKt$CatalogWebViewScreen$2$1$1$2;->$ctx:Landroid/content/Context;

    invoke-static {v0, p1, p2}, Lcom/example/JoaAuthHandler;->shouldOverride(Landroid/content/Context;Landroid/webkit/WebView;Ljava/lang/String;)Z
    move-result v0
    return v0

    :cond_b
    const/4 v0, 0x0
    return v0
.end method

.method public onPageStarted(Landroid/webkit/WebView;Ljava/lang/String;Landroid/graphics/Bitmap;)V
    .registers 5
    .param p1, "view"    # Landroid/webkit/WebView;
    .param p2, "url"    # Ljava/lang/String;
    .param p3, "favicon"    # Landroid/graphics/Bitmap;

    invoke-super {p0, p1, p2, p3}, Landroid/webkit/WebViewClient;->onPageStarted(Landroid/webkit/WebView;Ljava/lang/String;Landroid/graphics/Bitmap;)V

    if-eqz p2, :cond_a

    iget-object v0, p0, Lcom/example/MainActivityKt$CatalogWebViewScreen$2$1$1$2;->$ctx:Landroid/content/Context;

    invoke-static {v0, p1, p2}, Lcom/example/JoaAuthHandler;->onPageStarted(Landroid/content/Context;Landroid/webkit/WebView;Ljava/lang/String;)V

    :cond_a
    return-void
.end method

.method public onPageFinished(Landroid/webkit/WebView;Ljava/lang/String;)V
    .registers 4
    .param p1, "view"    # Landroid/webkit/WebView;
    .param p2, "url"    # Ljava/lang/String;

    invoke-super {p0, p1, p2}, Landroid/webkit/WebViewClient;->onPageFinished(Landroid/webkit/WebView;Ljava/lang/String;)V

    if-eqz p2, :cond_a

    iget-object v0, p0, Lcom/example/MainActivityKt$CatalogWebViewScreen$2$1$1$2;->$ctx:Landroid/content/Context;

    invoke-static {v0, p1, p2}, Lcom/example/JoaAuthHandler;->onPageFinished(Landroid/content/Context;Landroid/webkit/WebView;Ljava/lang/String;)V

    :cond_a
    return-void
.end method
"""
    start_idx = client_code.find(".method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Z")
    if start_idx != -1:
        end_idx = client_code.find(".end method", start_idx) + len(".end method")
        client_code = client_code[:start_idx] + new_should_override + client_code[end_idx:]
        with open(client_smali_path, "w") as f:
            f.write(client_code)
        print("Patched MainActivityKt$CatalogWebViewScreen$2$1$1$2.smali with JoaAuthHandler interception")

    # 6. Patch AndroidBridge.smali
    bridge_smali_path = os.path.join(smali_dir, "com/example/AndroidBridge.smali")
    with open(bridge_smali_path, "r") as f:
        bridge_code = f.read()

    new_bridge_methods = """.method public final saveSupabaseTokens(Ljava/lang/String;)V
    .registers 3
    .param p1, "sessionJson"    # Ljava/lang/String;
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-object v0, p0, Lcom/example/AndroidBridge;->context:Landroid/content/Context;
    invoke-static {v0, p1}, Lcom/example/JoaSecureStorage;->saveSessionJson(Landroid/content/Context;Ljava/lang/String;)V
    return-void
.end method

.method public final getSupabaseTokens()Ljava/lang/String;
    .registers 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-object v0, p0, Lcom/example/AndroidBridge;->context:Landroid/content/Context;
    invoke-static {v0}, Lcom/example/JoaSecureStorage;->getSessionJson(Landroid/content/Context;)Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method

.method public final clearSupabaseTokens()V
    .registers 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-object v0, p0, Lcom/example/AndroidBridge;->context:Landroid/content/Context;
    invoke-static {v0}, Lcom/example/JoaSecureStorage;->clearSession(Landroid/content/Context;)V
    return-void
.end method

.method public final getPendingAuthCallbackUrl()Ljava/lang/String;
    .registers 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-object v0, p0, Lcom/example/AndroidBridge;->context:Landroid/content/Context;
    invoke-static {v0}, Lcom/example/JoaSecureStorage;->getPendingCallback(Landroid/content/Context;)Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method

.method public final clearPendingAuthCallbackUrl()V
    .registers 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-object v0, p0, Lcom/example/AndroidBridge;->context:Landroid/content/Context;
    invoke-static {v0}, Lcom/example/JoaSecureStorage;->clearPendingCallback(Landroid/content/Context;)V
    return-void
.end method
"""
    if "saveSupabaseTokens" not in bridge_code:
        bridge_code = bridge_code + "\n" + new_bridge_methods
        with open(bridge_smali_path, "w") as f:
            f.write(bridge_code)
        print("Patched AndroidBridge.smali with Supabase token storage methods")

    # 7. Patch MainActivity.smali onNewIntent
    main_act_path = os.path.join(smali_dir, "com/example/MainActivity.smali")
    with open(main_act_path, "r") as f:
        main_act_code = f.read()

    target_needle = "invoke-super {p0, p1}, Landroidx/activity/ComponentActivity;->onNewIntent(Landroid/content/Intent;)V"
    if target_needle in main_act_code and "JoaAuthHandler" not in main_act_code:
        insertion = target_needle + "\n    invoke-static {p0, p1}, Lcom/example/JoaAuthHandler;->handleActivityIntent(Landroid/app/Activity;Landroid/content/Intent;)Z\n"
        main_act_code = main_act_code.replace(target_needle, insertion, 1)
        with open(main_act_path, "w") as f:
            f.write(main_act_code)
        print("Patched MainActivity.smali onNewIntent with JoaAuthHandler")

    # 8. Reassemble classes4.dex
    classes4_rebuilt = os.path.join(build_dir, "classes4.dex")
    cmd_smali = [
        "java", "-cp", smali_cp,
        "com.android.tools.smali.smali.Main", "a",
        smali_dir, "-o", classes4_rebuilt
    ]
    subprocess.run(cmd_smali, check=True)
    print("Reassembled classes4.dex successfully, size:", os.path.getsize(classes4_rebuilt))

    # 9. Compile AndroidManifest.xml with deep links using aapt
    manifest_src = os.path.join(root_dir, "app/src/main/AndroidManifest.xml")
    if os.path.exists(manifest_src):
        manifest_apk = os.path.join(build_dir, "manifest_out.apk")
        aapt_bin = "/opt/android/sdk/build-tools/36.0.0/aapt"
        android_jar = "/opt/android/sdk/platforms/android-36/android.jar"
        cmd_aapt = [aapt_bin, "package", "-f", "-m", "-J", build_dir, "-M", manifest_src, "-I", android_jar, "-F", manifest_apk]
        subprocess.run(cmd_aapt, check=True)
        with zipfile.ZipFile(manifest_apk, "r") as mz:
            mz.extract("AndroidManifest.xml", build_dir)
        print("Compiled AndroidManifest.xml with deep links intent-filters successfully")

    # 10. Update APK with classes4.dex, classes6.dex, and compiled AndroidManifest.xml
    if os.path.exists(os.path.join(build_dir, "AndroidManifest.xml")):
        subprocess.run(["zip", "-d", os.path.abspath(apk_path), "AndroidManifest.xml"], cwd=build_dir, check=False)
        subprocess.run(["zip", os.path.abspath(apk_path), "AndroidManifest.xml"], cwd=build_dir, check=True)

    subprocess.run(["zip", "-u", os.path.abspath(apk_path), "classes4.dex", "classes6.dex"], cwd=build_dir, check=True)
    print("Successfully patched APK with auth handler, encrypted storage, and deep links:", apk_path)
    return True

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else ".build-outputs/app-debug.apk"
    patch_apk(target)
