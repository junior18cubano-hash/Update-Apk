#!/usr/bin/env python3
import glob
import os
import shutil
import subprocess
import sys
import zipfile


def find_sdk_jars(base_dir):
    return sorted(glob.glob(os.path.join(base_dir, "**", "*.jar"), recursive=True))


def compile_manifest_with_res_ids(aapt_bin, android_jar, manifest_src, apk_path, build_dir):
    stub_res = os.path.join(build_dir, "stub_res")
    os.makedirs(os.path.join(stub_res, "values"), exist_ok=True)
    os.makedirs(os.path.join(stub_res, "mipmap-mdpi"), exist_ok=True)
    os.makedirs(os.path.join(stub_res, "xml"), exist_ok=True)

    with zipfile.ZipFile(apk_path, "r") as z:
        with open(os.path.join(stub_res, "mipmap-mdpi", "ic_launcher.png"), "wb") as f:
            f.write(z.read("res/mipmap-mdpi/ic_launcher.png"))
        with open(os.path.join(stub_res, "mipmap-mdpi", "ic_launcher_round.png"), "wb") as f:
            f.write(z.read("res/mipmap-mdpi/ic_launcher_round.png"))

    for xml_name in [
        "backup_rules.xml",
        "data_extraction_rules.xml",
        "file_paths.xml",
        "joa_gamers_widget_info.xml",
    ]:
        with open(os.path.join(stub_res, "xml", xml_name), "w") as f:
            f.write("<resources/>\n")

    with open(os.path.join(stub_res, "values", "styles.xml"), "w") as f:
        f.write(
            '<resources>\n'
            '  <style name="Theme.MyApplication" parent="android:Theme.Material.NoActionBar" />\n'
            '</resources>\n'
        )

    with open(os.path.join(stub_res, "values", "public.xml"), "w") as f:
        f.write(
            '<resources>\n'
            '  <public type="mipmap" name="ic_launcher" id="0x7f090000" />\n'
            '  <public type="mipmap" name="ic_launcher_round" id="0x7f090001" />\n'
            '  <public type="style" name="Theme.MyApplication" id="0x7f0b000a" />\n'
            '  <public type="xml" name="backup_rules" id="0x7f0d0000" />\n'
            '  <public type="xml" name="data_extraction_rules" id="0x7f0d0001" />\n'
            '  <public type="xml" name="file_paths" id="0x7f0d0002" />\n'
            '  <public type="xml" name="joa_gamers_widget_info" id="0x7f0d0003" />\n'
            '</resources>\n'
        )

    manifest_apk = os.path.join(build_dir, "manifest_out.apk")
    cmd_aapt = [
        aapt_bin,
        "package",
        "-f",
        "-M",
        manifest_src,
        "-S",
        stub_res,
        "-I",
        android_jar,
        "-F",
        manifest_apk,
    ]
    subprocess.run(cmd_aapt, check=True)
    with zipfile.ZipFile(manifest_apk, "r") as mz:
        mz.extract("AndroidManifest.xml", build_dir)
    print("Compiled AndroidManifest.xml with SDK, version, icons, meta-data, and deep links successfully")


def patch_apk(apk_path):
    print("=== Patching APK for Supabase Auth, Deep Links, and Encrypted Storage ===")
    if not os.path.exists(apk_path):
        print(f"Error: APK not found at {apk_path}")
        return False

    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build_dir = "/tmp/apk_auth_patch_work"
    if os.path.exists(build_dir):
        shutil.rmtree(build_dir)
    os.makedirs(build_dir, exist_ok=True)

    # 1. Locate and extract security-crypto.jar & tink-android
    aar_path = "/opt/gradle/.gradle/caches/modules-2/files-2.1/androidx.security/security-crypto/1.1.0-alpha03/f54110eab7610d08d7c41c594b3a248dac488e00/security-crypto-1.1.0-alpha03.aar"
    tink_path = "/opt/gradle/.gradle/caches/modules-2/files-2.1/com.google.crypto.tink/tink-android/1.5.0/3d728fc1c43446a7a1e602c896b67cce2d57281d/tink-android-1.5.0.jar"
    if not os.path.exists(aar_path):
        matches = glob.glob("/opt/gradle/.gradle/caches/**/security-crypto-*.aar", recursive=True)
        if not matches:
            raise FileNotFoundError("security-crypto AAR not found in Gradle cache")
        aar_path = matches[0]
    if not os.path.exists(tink_path):
        matches = glob.glob("/opt/gradle/.gradle/caches/**/tink-android-*.jar", recursive=True)
        if not matches:
            raise FileNotFoundError("tink-android JAR not found in Gradle cache")
        tink_path = matches[0]

    sec_jar = os.path.join(build_dir, "security-crypto.jar")
    with zipfile.ZipFile(aar_path, "r") as z:
        with open(sec_jar, "wb") as f:
            f.write(z.read("classes.jar"))

    # 2. Compile Java auth/storage sources
    classes_dir = os.path.join(build_dir, "classes")
    os.makedirs(classes_dir, exist_ok=True)
    android_jar = "/opt/android/sdk/platforms/android-36/android.jar"
    cp = ":".join([android_jar, sec_jar, tink_path])
    src_files = [
        os.path.join(root_dir, "app/src/main/java/com/example/JoaSecureStorage.java"),
        os.path.join(root_dir, "app/src/main/java/com/example/JoaAuthHandler.java"),
    ]
    subprocess.run(["javac", "-cp", cp, "-d", classes_dir] + src_files, check=True)
    print("Compiled JoaSecureStorage and JoaAuthHandler successfully")

    # 3. Build classes6.dex using d8
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
    print("Built classes6.dex, size:", os.path.getsize(classes6_dex))

    # 4. Compile and run dexlib2-based DexAuthPatcher on classes4.dex (no external /tmp smali jars required)
    with zipfile.ZipFile(apk_path, "r") as z:
        z.extract("classes4.dex", build_dir)

    sdk_jars = find_sdk_jars("/opt/android/sdk/cmdline-tools/latest/lib")
    dexlib_cp = ":".join(sdk_jars)
    patcher_classes_dir = os.path.join(build_dir, "patcher_classes")
    os.makedirs(patcher_classes_dir, exist_ok=True)
    patcher_java = os.path.join(root_dir, "scripts/DexAuthPatcher.java")
    subprocess.run(["javac", "-cp", dexlib_cp, "-d", patcher_classes_dir, patcher_java], check=True)

    classes4_in = os.path.join(build_dir, "classes4.dex")
    classes4_out = os.path.join(build_dir, "classes4_patched.dex")
    subprocess.run(
        ["java", "-cp", f"{patcher_classes_dir}:{dexlib_cp}", "DexAuthPatcher", classes4_in, classes4_out],
        check=True,
    )
    shutil.move(classes4_out, classes4_in)
    print("Patched and deduplicated classes4.dex successfully, size:", os.path.getsize(classes4_in))

    # 5. Compile AndroidManifest.xml with full resources and deep links
    manifest_src = os.path.join(root_dir, "app/src/main/AndroidManifest.xml")
    aapt_bin = "/opt/android/sdk/build-tools/36.0.0/aapt"
    if os.path.exists(manifest_src):
        compile_manifest_with_res_ids(aapt_bin, android_jar, manifest_src, apk_path, build_dir)

    # 6. Replace AndroidManifest.xml, classes4.dex, and classes6.dex cleanly inside APK
    abs_apk = os.path.abspath(apk_path)
    files_to_replace = []
    if os.path.exists(os.path.join(build_dir, "AndroidManifest.xml")):
        files_to_replace.append("AndroidManifest.xml")
    files_to_replace.extend(["classes4.dex", "classes6.dex"])

    subprocess.run(["zip", "-d", abs_apk] + files_to_replace, cwd=build_dir, check=False)
    subprocess.run(["zip", abs_apk] + files_to_replace, cwd=build_dir, check=True)
    print("Successfully patched APK:", apk_path)
    return True


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else ".build-outputs/app-debug.apk"
    ok = patch_apk(target)
    sys.exit(0 if ok else 1)
