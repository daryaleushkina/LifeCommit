// Одно окно: edge-to-edge, тема — как в системе (или выбранная в «Я»), вход через Telegram возвращается сюда же
// (lifecommit://tglogin, launchMode singleTask → onNewIntent).
package app.lifecommit

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import app.lifecommit.core.ApiClient
import app.lifecommit.ui.LifeCommitTheme
import app.lifecommit.ui.Links
import app.lifecommit.ui.Root
import app.lifecommit.ui.rememberHaptics
import java.util.Locale
import java.util.logging.Logger

/** Модель живёт дольше Activity (поворот, смена темы); её корутины — viewModelScope. */
class MainViewModel(app: LifeCommitApp, config: Config) : ViewModel() {
    val model = AppModel(
        api = ApiClient(config.apiBase),
        tokens = EncryptedTokenStore(app),
        prefs = SharedPrefs(app),
        config = config,
        scope = viewModelScope,
        systemLanguage = { Locale.getDefault().toLanguageTag() },
    ).also { it.start() }

    class Factory(private val config: Config) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
            val app = checkNotNull(extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY]) as LifeCommitApp
            @Suppress("UNCHECKED_CAST")
            return MainViewModel(app, config) as T
        }
    }
}

class MainActivity : ComponentActivity() {
    private val log = Logger.getLogger("app.lifecommit.activity")
    private lateinit var model: AppModel

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        model = ViewModelProvider(this, MainViewModel.Factory(Config.from(intent)))[MainViewModel::class.java].model
        intent?.data?.let { model.handleCallback(it.toString()) }

        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            when (event) {
                // Свернули приложение — отложенное удаление уходит на сервер сейчас, а не теряется.
                Lifecycle.Event.ON_STOP -> model.flushRemoval()
                Lifecycle.Event.ON_RESUME -> {
                    model.refreshIfStale()
                    model.returnedWithoutCallback()
                }
                else -> Unit
            }
        })

        val links = Links { url, inBrowser -> open(url, inBrowser) }
        setContent {
            val haptics = rememberHaptics()
            LaunchedEffect(haptics) { model.haptics = haptics }
            val choice = model.prefs.string(THEME_KEY)
            val dark = when (choice) {
                "dark" -> true
                "light" -> false
                else -> isSystemInDarkTheme()
            }
            LifeCommitTheme(dark, model.strings) {
                Root(model, links, telegramInstalled = ::telegramInstalled)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { model.handleCallback(it.toString()) }
    }

    private fun telegramInstalled(): Boolean = listOf("org.telegram.messenger", "org.telegram.messenger.web").any {
        try {
            packageManager.getPackageInfo(it, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    /** Ссылки Telegram (tg://, t.me) — в приложение Telegram; страница входа — в Custom Tab. */
    private fun open(url: String, inBrowser: Boolean) {
        val uri = Uri.parse(url)
        try {
            if (inBrowser) {
                CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, uri)
            } else {
                startActivity(Intent(Intent.ACTION_VIEW, uri))
            }
        } catch (e: android.content.ActivityNotFoundException) {
            log.warning("no app for $url: $e")
            if (!inBrowser) startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        }
    }

    companion object {
        const val THEME_KEY = "lc-theme"
    }
}

/** Настройки устройства (как localStorage мини-аппа) — обычные SharedPreferences: секретов тут нет. */
class SharedPrefs(app: LifeCommitApp) : Prefs {
    private val prefs = app.getSharedPreferences("lc", android.content.Context.MODE_PRIVATE)
    override fun bool(key: String) = prefs.getBoolean(key, false)
    override fun setBool(key: String, value: Boolean) = prefs.edit().putBoolean(key, value).apply()
    override fun string(key: String): String? = prefs.getString(key, null)
    override fun setString(key: String, value: String?) = prefs.edit().putString(key, value).apply()
}
