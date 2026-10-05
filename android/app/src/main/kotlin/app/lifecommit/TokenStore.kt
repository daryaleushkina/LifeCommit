// Ключ сессии хранится зашифрованным: AEAD (AES-256-GCM) из Tink, ключ шифрования — в Android Keystore, шифротекст —
// в DataStore. Не в обычных SharedPreferences и не в EncryptedSharedPreferences (устарело). В резервную копию не уезжает
// (allowBackup=false, data_extraction_rules.xml).
package app.lifecommit

import android.content.Context
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.crypto.tink.Aead
import com.google.crypto.tink.KeyTemplates
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.integration.android.AndroidKeysetManager
import kotlinx.coroutines.flow.first

interface TokenStore {
    suspend fun load(): String?
    suspend fun save(token: String)
    suspend fun clear()
}

private val Context.sessionStore by preferencesDataStore(name = "session")

class EncryptedTokenStore(private val context: Context) : TokenStore {
    private val key = stringPreferencesKey("token")

    /** Связывает шифротекст с назначением: чужой шифротекст из того же набора ключей сюда не подставить. */
    private val associated = "lifecommit-session".toByteArray()

    private val aead: Aead by lazy {
        AeadConfig.register()
        AndroidKeysetManager.Builder()
            .withSharedPref(context, "lc_session_keyset", "lc_session_keyset_prefs")
            .withKeyTemplate(KeyTemplates.get("AES256_GCM"))
            .withMasterKeyUri("android-keystore://lc_session_master")
            .build()
            .keysetHandle
            .getPrimitive(RegistryConfiguration.get(), Aead::class.java)
    }

    override suspend fun load(): String? {
        val stored = context.sessionStore.data.first()[key] ?: return null
        return String(aead.decrypt(Base64.decode(stored, Base64.NO_WRAP), associated))
    }

    override suspend fun save(token: String) {
        val sealed = Base64.encodeToString(aead.encrypt(token.toByteArray(), associated), Base64.NO_WRAP)
        context.sessionStore.edit { it[key] = sealed }
    }

    override suspend fun clear() {
        context.sessionStore.edit { it.remove(key) }
    }
}

/** Хранилище в памяти — для тестов и превью. */
class MemoryTokenStore(private var token: String? = null) : TokenStore {
    override suspend fun load() = token
    override suspend fun save(token: String) {
        this.token = token
    }
    override suspend fun clear() {
        token = null
    }
}
