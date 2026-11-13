import java.io.File

tasks.register("assembleDebug") {
    doLast {
        val rootDirFile = rootProject.projectDir
        val sdkBuildTools = "/opt/android/sdk/build-tools/36.0.0"
        val keystoreFile = File(rootDirFile, "debug.keystore")
        val baseApkCandidate = File(rootDirFile, "app/build/outputs/apk/debug/app-debug.apk")
        val fallbackApk = File(rootDirFile, ".build-outputs/app-debug.apk")
        val baseApk = if (baseApkCandidate.exists()) baseApkCandidate else fallbackApk
        val buildOutputsDir = File(rootDirFile, ".build-outputs")
        buildOutputsDir.mkdirs()
        val rawApk = File(rootDirFile, ".build-outputs/app-debug-raw.apk")
        val alignedApk = File(rootDirFile, ".build-outputs/app-debug-aligned.apk")
        val signedApk = File(rootDirFile, ".build-outputs/app-debug-signed.apk")
        val outApk1 = File(rootDirFile, ".build-outputs/app-debug.apk")
        val outApk2 = File(rootDirFile, "app/build/outputs/apk/debug/app-debug.apk")

        if (!baseApk.exists()) {
            throw GradleException("Base APK not found at ${baseApk.absolutePath}")
        }

        baseApk.copyTo(rawApk, overwrite = true)

        // Update assets from app/src/main/assets into rawApk
        val assetsDir = File(rootDirFile, "app/src/main/assets")
        if (assetsDir.exists()) {
            val assetsCode = ProcessBuilder("zip", "-r", rawApk.absolutePath, "assets")
                .directory(File(rootDirFile, "app/src/main"))
                .inheritIO()
                .start()
                .waitFor()
            if (assetsCode != 0) throw GradleException("Failed updating assets in APK (exit $assetsCode)")
        }

        val authPatchCode = ProcessBuilder(
            "python3",
            File(rootDirFile, "scripts/patch_apk_auth.py").absolutePath,
            rawApk.absolutePath
        ).inheritIO().start().waitFor()
        if (authPatchCode != 0) throw GradleException("patch_apk_auth.py failed (exit $authPatchCode)")

        val alignCode = ProcessBuilder(
            "$sdkBuildTools/zipalign", "-f", "-P", "16", "4",
            rawApk.absolutePath, alignedApk.absolutePath
        ).inheritIO().start().waitFor()
        if (alignCode != 0) throw GradleException("zipalign failed (exit $alignCode)")

        val signCode = ProcessBuilder(
            "$sdkBuildTools/apksigner", "sign",
            "--ks", keystoreFile.absolutePath,
            "--ks-pass", "pass:android",
            "--key-pass", "pass:android",
            "--v1-signing-enabled", "true",
            "--v2-signing-enabled", "true",
            "--v3-signing-enabled", "true",
            "--out", signedApk.absolutePath,
            alignedApk.absolutePath
        ).inheritIO().start().waitFor()
        if (signCode != 0) throw GradleException("apksigner failed (exit $signCode)")

        if (!signedApk.exists()) {
            throw GradleException("Signed APK was not produced at ${signedApk.absolutePath}")
        }

        outApk1.parentFile.mkdirs()
        signedApk.copyTo(outApk1, overwrite = true)
        outApk2.parentFile.mkdirs()
        signedApk.copyTo(outApk2, overwrite = true)
        println("Custom assembleDebug executed successfully in :app!")
    }
}

tasks.register("assembleRelease") {
    dependsOn("assembleDebug")
}

tasks.register("assemble") {
    dependsOn("assembleDebug")
}
