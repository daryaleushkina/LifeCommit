// Сценарии как у человека: приложение целиком (Root), подменённый сервер, свой пользователь в каждом тесте.
package app.lifecommit

import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performClick
import app.lifecommit.core.ApiClient
import app.lifecommit.core.Strings
import app.lifecommit.ui.LifeCommitTheme
import app.lifecommit.ui.Links
import app.lifecommit.ui.Root
import kotlinx.coroutines.CoroutineScope
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.android.asCoroutineDispatcher
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Before
import org.junit.Rule
import java.util.concurrent.TimeUnit
import org.robolectric.shadows.ShadowLooper

abstract class AppTest {
    @get:Rule val compose = createComposeRule()

    val server = FakeServer()
    val tokens = MemoryTokenStore("session-key")
    val prefs = MemoryPrefs()
    val opened = mutableListOf<Pair<String, Boolean>>()
    var telegramInstalled = false

    /** false — на телефоне нечем открыть ссылку (нет браузера). */
    var linksWork = true
    var dark = false
    lateinit var model: AppModel
    // Главный поток, как у viewModelScope в приложении; не Dispatchers.Main — его тестовое правило Compose подменяет
    // своим диспетчером, и корутины, запущенные из нажатий, ждали бы его, а не главный цикл.
    private val scope = CoroutineScope(SupervisorJob() + Handler(Looper.getMainLooper()).asCoroutineDispatcher())

    @Before fun startServer() {
        server.start()
    }

    @After fun stop() {
        // Что ушло на сервер — в вывод теста: по нему видно, где сценарий остановился.
        println(server.calls.joinToString("\n") { "${it.method} ${it.path} ${it.body.take(120)}" })
        scope.cancel()
        server.close()
    }

    /** Запустить приложение. undoMillis — сколько живёт «Вернуть» (в тестах короче, чем 5 секунд). */
    fun launch(undoMillis: Long = 5_000) {
        model = AppModel(
            api = ApiClient(server.api, OkHttpClient()),
            tokens = tokens,
            prefs = prefs,
            config = Config(apiBase = server.api, isTest = true, useStoredToken = true),
            scope = scope,
            systemLanguage = { "ru-RU" },
            oauthHttp = OkHttpClient(),
            oauthBase = server.oauth,
            undoMillis = undoMillis,
        )
        compose.setContent {
            LifeCommitTheme(dark, model.strings) {
                Root(model, Links { url, inBrowser ->
                    opened += url to inBrowser
                    linksWork
                }, telegramInstalled = { telegramInstalled })
            }
        }
        model.start()
    }

    val t: Strings get() = Strings.ru

    /** Редактор привычки — как человек: тап по названию (экран привычки), потом карандаш. */
    fun openEditor(title: String) {
        compose.waitText(title).performClick()
        compose.waitLabel(t.editTask).performClick()
        compose.waitText(t.save)
    }

    /**
     * Ждать условия, прокручивая главный цикл: ответы сервера и корутины модели идут через него, а ожидание Compose
     * само его не крутит, пока на экране идёт бесконечная анимация (индикатор загрузки).
     */
    fun ComposeContentTestRule.waitFor(timeout: Long = 5_000, what: () -> Boolean) = waitUntil(timeout) {
        // Время главного цикла в Robolectric стоит, пока его не сдвинуть: таймер «Вернуть» (delay) иначе не истёк бы.
        ShadowLooper.idleMainLooper(10, TimeUnit.MILLISECONDS)
        what()
    }

    fun ComposeContentTestRule.waitText(text: String, timeout: Long = 5_000): SemanticsNodeInteraction {
        waitFor(timeout) { onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }
        return onNode(hasText(text))
    }

    fun ComposeContentTestRule.waitLabel(label: String, timeout: Long = 5_000): SemanticsNodeInteraction {
        waitFor(timeout) { onAllNodes(hasContentDescription(label)).fetchSemanticsNodes().isNotEmpty() }
        return onNode(hasContentDescription(label))
    }
}
