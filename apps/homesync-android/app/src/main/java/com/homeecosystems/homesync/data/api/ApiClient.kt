package com.homeecosystems.homesync.data.api

import com.homeecosystems.homesync.BuildConfig
import com.homeecosystems.homesync.data.SessionManager
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Builds (and rebuilds, when needed) the Retrofit client used for every
 * network call. Deliberately not a single client built once and kept for
 * the app's whole lifetime: the server address isn't known until the
 * person types it in on the login screen (see LoginScreen/LoginViewModel),
 * and this caches one client per address rather than assuming it's fixed.
 */
class ApiClient(private val sessionManager: SessionManager) {

    @Volatile private var cachedApi: HomeSyncApi? = null
    @Volatile private var cachedForUrl: String? = null

    /**
     * Returns a client pointed at whatever server address SessionManager
     * currently has. Rebuilds automatically if the address has changed
     * since the last call — callers don't need to think about caching at
     * all, they just call this whenever they need the API.
     */
    fun getApi(): HomeSyncApi {
        val url = sessionManager.currentServerUrl().orEmpty()
        val existing = cachedApi
        if (existing != null && cachedForUrl == url) return existing

        val built = build(url)
        cachedApi = built
        cachedForUrl = url
        return built
    }

    /**
     * Call right after the server address changes (see
     * LoginViewModel.submitCredentials, which calls this immediately
     * after sessionManager.saveSession with a new address) so the *next*
     * getApi() call is forced to rebuild against the new address instead
     * of the `cachedForUrl == url` check above quietly reusing a client
     * still pointed at the old one for one extra call.
     */
    fun invalidate() {
        cachedApi = null
        cachedForUrl = null
    }

    private fun build(rawUrl: String): HomeSyncApi {
        // Attaches the signed-in token to every outgoing request. Harmless
        // to attach it even to /auth/login and /auth/2fa/verify, which
        // don't require it — homecore's auth middleware simply doesn't
        // check for one on those routes, so an extra header there is
        // ignored, not rejected.
        val authInterceptor = Interceptor { chain ->
            val requestBuilder = chain.request().newBuilder()
            sessionManager.currentToken()?.takeIf { it.isNotBlank() }?.let { token ->
                requestBuilder.addHeader("Authorization", "Bearer $token")
            }
            chain.proceed(requestBuilder.build())
        }

        val clientBuilder = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            // Generous read/write timeouts: this is a home Wi-Fi network,
            // not a datacenter link, and uploads can be large videos —
            // see BackupWorker's streamingRequestBody, which streams
            // straight from disk rather than buffering, but the transfer
            // itself can still legitimately take a while.
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor(authInterceptor)

        // Full request/response logging only in debug builds. This would
        // otherwise print auth tokens straight to Logcat on every request
        // — fine while developing, a real problem in anything installed
        // on someone's actual phone.
        if (BuildConfig.DEBUG) {
            val logging = HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC }
            clientBuilder.addInterceptor(logging)
        }

        return Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(rawUrl))
            .client(clientBuilder.build())
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(HomeSyncApi::class.java)
    }

    /**
     * The person types a bare address like "192.168.1.50:8080" (see the
     * main README's HomeSync section) — no scheme, since that's what
     * most people naturally type for a home server. Retrofit requires a
     * full URL ending in "/". Default to plain http:// — see
     * AndroidManifest.xml's usesCleartextTraffic comment for why that's
     * the deliberate, expected case here, not a fallback for something
     * broken — unless the person already typed a scheme themselves, in
     * which case it's left alone: an https:// address still gets real
     * TLS exactly as normal, this only fills in the common case where
     * nobody thinks to type "http://" in front of a LAN IP address.
     */
    internal fun normalizeBaseUrl(input: String): String {
        val trimmed = input.trim()
        val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            trimmed
        } else {
            "http://$trimmed"
        }
        return if (withScheme.endsWith("/")) withScheme else "$withScheme/"
    }
}
