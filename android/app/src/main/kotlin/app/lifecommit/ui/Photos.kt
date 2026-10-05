// Фото людей из Telegram для аватарок — как <img> в мини-аппе (groupUi.tsx): есть фото — фото, нет — буква на цвете.
// Только https, не больше 1 МБ, уменьшаем до размера аватарки, держим в памяти. Фото — украшение: не загрузилось —
// остаётся буква, ошибка только в лог.
package app.lifecommit.ui

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.annotation.VisibleForTesting
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import app.lifecommit.core.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import okhttp3.Response
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

fun interface PhotoLoader {
    suspend fun load(url: String): ImageBitmap?

    /** Уже загруженное — чтобы аватарка не мигала буквой при каждой перерисовке списка. */
    fun cached(url: String): ImageBitmap? = null
}

object Photos {
    /** Подменяется в тестах (без сети). */
    @VisibleForTesting
    var loader: PhotoLoader = NetPhotos
}

private object NetPhotos : PhotoLoader {
    private val log = Logger.getLogger("app.lifecommit.photos")
    private const val MAX_BYTES = 1L shl 20

    /** Сторона в пикселях, до которой уменьшаем (аватарка 48 dp на плотном экране). */
    private const val SIDE = 160
    private val cache = LruCache<String, ImageBitmap>(96)

    // Свой клиент: без ключа сессии, короткий таймаут, с https на http не переходим.
    private val http = ApiClient.defaultHttp.newBuilder()
        .callTimeout(10, TimeUnit.SECONDS)
        .followSslRedirects(false)
        .build()

    override fun cached(url: String): ImageBitmap? = cache.get(url)

    override suspend fun load(url: String): ImageBitmap? {
        if (!url.startsWith("https://")) return null
        cache.get(url)?.let { return it }
        val request = try {
            Request.Builder().url(url).build()
        } catch (e: IllegalArgumentException) {
            log.info("photo url rejected: $e")
            return null
        }
        return try {
            http.newCall(request).bytes(MAX_BYTES)?.let { bytes -> withContext(Dispatchers.Default) { decode(bytes) } }?.also { cache.put(url, it) }
        } catch (e: IOException) {
            log.info("photo not loaded: $e")
            null
        }
    }

    private fun decode(bytes: ByteArray): ImageBitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= SIDE) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)?.asImageBitmap()
    }
}

/** Тело ответа (https, 2xx, не больше max) — читается в колбэке OkHttp, не на главном потоке; иначе null. */
private suspend fun Call.bytes(max: Long): ByteArray? = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) {
            val bytes = try {
                response.use { r ->
                    if (!r.isSuccessful || r.request.url.scheme != "https") return@use null
                    val src = r.body.source()
                    // Больше лимита — не грузим целиком.
                    if (src.request(max + 1)) null else src.buffer.readByteArray()
                }
            } catch (e: IOException) {
                if (!cont.isCancelled) cont.resumeWithException(e)
                return
            }
            cont.resume(bytes)
        }

        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }
    })
}
