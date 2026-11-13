tasks.register("assembleDebug") {
    dependsOn(":app:assembleDebug")
}

tasks.register("assembleRelease") {
    dependsOn(":app:assembleRelease")
}

tasks.register("assemble") {
    dependsOn(":app:assemble")
}
