// Ядро без Android: модели API, клиент, вход через Telegram, логика и тексты. Тесты — JUnit на JVM, без эмулятора.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(17)
    compilerOptions {
        allWarningsAsErrors = true
        optIn.add("kotlinx.serialization.ExperimentalSerializationApi")
    }
}

dependencies {
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.core)
    api(libs.okhttp)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
