// LifeCommit для Android — Kotlin и Jetpack Compose. Устройство и решения — docs/mobile.md (раздел «Android»).
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "LifeCommit"
include(":core", ":app")
