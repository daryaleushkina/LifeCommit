// Приложение LifeCommit для Android: Jetpack Compose, вид — копия мини-аппа, поведение — родное (docs/mobile.md).
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.roborazzi)
}

// Постоянный ключ подписи (решение владелицы 05.10.2026): ~/.android/lifecommit-upload.jks вне git, пароль — в Связке
// ключей macOS (служба app.lifecommit.android.keystore). Его отпечаток стоит в assetlinks.json сайта (App Link
// lifecommit.app/j/…); потом он станет upload-ключом Google Play. Нет ключа (облако, другой компьютер) — подпись
// отладочным ключом, App Link тогда не проверится.
val uploadKeystore = file("${System.getProperty("user.home")}/.android/lifecommit-upload.jks")
val uploadPassword: String? = if (!uploadKeystore.exists()) null else providers.exec {
    commandLine("security", "find-generic-password", "-a", "lifecommit-upload", "-s", "app.lifecommit.android.keystore", "-w")
    isIgnoreExitValue = true
}.standardOutput.asText.get().trim().ifEmpty { null }

android {
    namespace = "app.lifecommit"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.lifecommit"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "0.1"
        // Адрес API; в сборке Debug перебивается при запуске (Config.kt): adb shell am start … -e LCAPIBase http://10.0.2.2:5173/api
        buildConfigField("String", "API_BASE", "\"https://lifecommit.app/api\"")
    }

    signingConfigs {
        if (uploadPassword != null) {
            create("upload") {
                storeFile = uploadKeystore
                storePassword = uploadPassword
                keyAlias = "upload"
                keyPassword = uploadPassword
            }
        }
    }

    buildTypes {
        debug {
            signingConfigs.findByName("upload")?.let { signingConfig = it }
        }
        release {
            signingConfigs.findByName("upload")?.let { signingConfig = it }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all { it.systemProperty("robolectric.pixelCopyRenderMode", "hardware") }
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    jvmToolchain(17)
    compilerOptions {
        allWarningsAsErrors = true
    }
}

roborazzi {
    // Эталоны снимков — в git, рядом с тестами; переснимать только при намеренной правке вида (CLAUDE.md).
    outputDir.set(file("src/test/screenshots"))
}

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.navigation3.runtime)
    implementation(libs.navigation3.ui)
    implementation(libs.datastore.preferences)
    implementation(libs.tink.android)
    implementation(libs.browser)
    implementation(libs.core.ktx)
    implementation(libs.kotlinx.coroutines.android)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
