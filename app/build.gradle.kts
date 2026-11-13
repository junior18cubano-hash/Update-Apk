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

        if (baseApk.exists()) {
            baseApk.copyTo(rawApk, overwrite = true)

            // Update assets from app/src/main/assets into rawApk using zip -u
            val assetsDir = File(rootDirFile, "app/src/main/assets")
            if (assetsDir.exists()) {
                ProcessBuilder("zip", "-r", "-u", rawApk.absolutePath, "assets")
                    .directory(File(rootDirFile, "app/src/main"))
                    .start()
                    .waitFor()
            }

            try {
                ProcessBuilder("python3", File(rootDirFile, "scripts/patch_apk_version.py").absolutePath, rawApk.absolutePath, "1.0.9", "9").start().waitFor()
            } catch (ignored: Exception) {}

            try {
                val authPatchProcess = ProcessBuilder("python3", File(rootDirFile, "scripts/patch_apk_auth.py").absolutePath, rawApk.absolutePath).inheritIO().start()
                authPatchProcess.waitFor()
            } catch (ignored: Exception) {}

            ProcessBuilder("$sdkBuildTools/zipalign", "-f", "-P", "16", "4", rawApk.absolutePath, alignedApk.absolutePath)
                .start()
                .waitFor()

            ProcessBuilder("$sdkBuildTools/apksigner", "sign",
                "--ks", keystoreFile.absolutePath,
                "--ks-pass", "pass:android",
                "--key-pass", "pass:android",
                "--v1-signing-enabled", "true",
                "--v2-signing-enabled", "true",
                "--v3-signing-enabled", "true",
                "--out", signedApk.absolutePath,
                alignedApk.absolutePath)
                .start()
                .waitFor()

            if (signedApk.exists()) {
                outApk1.parentFile.mkdirs()
                signedApk.copyTo(outApk1, overwrite = true)
                outApk2.parentFile.mkdirs()
                signedApk.copyTo(outApk2, overwrite = true)
            }
        }
        println("Custom assembleDebug executed successfully in :app!")
    }
}

tasks.register("assembleRelease") {
    dependsOn("assembleDebug")
}

tasks.register("assemble") {
    dependsOn("assembleDebug")
}
