// Куда ходит приложение и как входит. Прод — https://lifecommit.app/api (BuildConfig.API_BASE). Для разработки —
// параметры запуска, только в сборке Debug и только не на прод (сервер с DEV_AUTH_BYPASS):
//   adb shell am start -n app.lifecommit/.MainActivity -e LCAPIBase http://10.0.2.2:5173/api --el LCDevUser 123 (только 10.0.2.2)
// LCDevUser — войти подменённым Telegram с этим id (docs/mobile.md, «Для разработки и тестов»).
package app.lifecommit

import android.content.Intent
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

data class Config(
    val apiBase: String = BuildConfig.API_BASE,
    /** Пользователь Telegram для подменённого входа (локальный стенд). В сборке для людей — всегда null. */
    val devUserId: Long? = null,
    /** Тесты: «Пропустить» онбординга не запоминается между запусками. */
    val isTest: Boolean = false,
    /** Сохранённый ключ сессии отправляется только туда, где его выдали (прод): на стенд разработки он не уходит. */
    val useStoredToken: Boolean = apiBase == BuildConfig.API_BASE,
) {
    companion object {
        /** Устройство для сессии на сервере. */
        const val DEVICE = "android"

        /**
         * Стенд разработки — только компьютер разработчика, каким его видит эмулятор (10.0.2.2). localhost и 127.0.0.1
         * на телефоне — сам телефон: там может слушать чужое приложение и получить id_token входа (/code-review 05.10).
         */
        private val LOCAL_HOSTS = setOf("10.0.2.2")

        fun from(intent: Intent?): Config {
            if (!BuildConfig.DEBUG || intent == null) return Config()
            // Activity открыта наружу (вход Telegram возвращается в неё), запустить её с extras может любое приложение
            // на телефоне. Чужой адрес не принимаем: иначе ключ сессии ушёл бы на его сервер (ревью безопасности 05.10).
            val base = intent.getStringExtra("LCAPIBase")?.takeIf { url ->
                url.toHttpUrlOrNull()?.let { it.host in LOCAL_HOSTS } == true
            } ?: return Config()
            val dev = intent.getLongExtra("LCDevUser", 0L).takeIf { it > 0 }
            return Config(apiBase = base, devUserId = dev, isTest = intent.getBooleanExtra("LCTest", false))
        }
    }
}
