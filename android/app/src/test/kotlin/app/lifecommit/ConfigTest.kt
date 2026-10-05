package app.lifecommit

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ConfigTest {
    private fun intent(base: String?, dev: Long? = null) = Intent().apply {
        base?.let { putExtra("LCAPIBase", it) }
        dev?.let { putExtra("LCDevUser", it) }
    }

    @Test fun `адрес стенда для разработки - только локальный, чужой хост игнорируется`() {
        assertEquals("http://10.0.2.2:5173/api", Config.from(intent("http://10.0.2.2:5173/api")).apiBase)
        assertEquals("http://localhost:5181/api", Config.from(intent("http://localhost:5181/api")).apiBase)
        // Любое приложение на телефоне может запустить нашу Activity с extras: ключ сессии не должен уйти на его сервер.
        assertEquals(BuildConfig.API_BASE, Config.from(intent("https://evil.example/api")).apiBase)
        assertEquals(BuildConfig.API_BASE, Config.from(intent("http://10.0.2.2.evil.example/api")).apiBase)
        assertEquals(BuildConfig.API_BASE, Config.from(intent("не адрес")).apiBase)
    }

    @Test fun `ключ сессии с прода - только для прода`() {
        assertEquals(true, Config.from(intent(null)).useStoredToken)
        assertEquals(false, Config.from(intent("http://10.0.2.2:5173/api")).useStoredToken)
    }

    @Test fun `подменённый вход - только вместе с локальным стендом`() {
        assertEquals(42L, Config.from(intent("http://10.0.2.2:5173/api", 42)).devUserId)
        assertNull(Config.from(intent(null, 42)).devUserId)
        assertNull(Config.from(intent("https://evil.example/api", 42)).devUserId)
    }
}
