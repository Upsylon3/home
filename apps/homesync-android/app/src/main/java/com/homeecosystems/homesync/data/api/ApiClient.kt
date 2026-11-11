package com.homeecosystems.homesync.data.api

import com.homeecosystems.homesync.BuildConfig
import com.homeecosystems.homesync.data.SessionManager
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/**
 * Builds (and rebuilds, when needed) the Retrofit client used for every
 * network call. Deliberately not a single client built once and kept for
 * the app's whole lifetime: the server address isn't known until the
 * person types it in on the login screen (see LoginScreen/LoginViewModel),
 * and this caches one client per address rather than assuming it's fixed.
 */
class ApiClient(private val sessionManager: SessionManager) {

    private data class CachedApi(val url: String, val api: HomeSyncApi)
    @Volatile private var cached: CachedApi? = null

    /**
     * Returns a client pointed at whatever server address SessionManager
     * currently has. Rebuilds automatically if the address has changed
     * since the last call — callers don't need to think about caching at
     * all, they just call this whenever they need the API.
     */
    fun getApi(): HomeSyncApi {
        val url = normalizeBaseUrl(sessionManager.currentServerUrl().orEmpty())
        val existing = cached
        if (existing != null && existing.url == url) return existing.api

        val built = build(url)
        // Publish the key/client together; concurrent builds cannot mix them.
        cached = CachedApi(url, built)
        return built
    }

    /**
     * Call right after the server address changes (see
     * LoginViewModel.submitCredentials, which calls this immediately
     * after sessionManager.saveSession with a new address) so the *next*
     * getApi() call rebuilds its cached client. Retained clients also check
     * the URL/token snapshot before every new request.
     */
    fun invalidate() {
        cached = null
    }

    private fun build(rawUrl: String): HomeSyncApi {
        val clientBuilder = serverHttpClient(normalizeServerUrl(rawUrl), sessionManager::currentSession).newBuilder()

        // Full request/response logging only in debug builds. This would
        // otherwise print auth tokens straight to Logcat on every request
        // — unsafe even during development. BASIC logs no headers/body.
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
        return normalizeServerUrl(input).toString()
    }
}
