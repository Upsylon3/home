package com.homeecosystems.homesync.data.api

import com.homeecosystems.homesync.data.ServerSession
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import java.io.IOException
import java.util.concurrent.TimeUnit

internal fun normalizeServerUrl(input: String): HttpUrl {
    val trimmed = input.trim()
    val url = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "http://$trimmed"
    return (if (url.endsWith("/")) url else "$url/").toHttpUrl()
}

/** A retained API cannot borrow a different server's session or follow redirects. */
internal fun serverHttpClient(base: HttpUrl, session: () -> ServerSession): OkHttpClient =
    OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        // Redirects can forward login bodies or uploads as well as bearer headers.
        // Require the user to enter the final HOME gateway address instead.
        .followRedirects(false)
        .followSslRedirects(false)
        .addInterceptor { chain ->
            val current = session()
            val currentUrl = current.serverUrl?.let { runCatching { normalizeServerUrl(it) }.getOrNull() }
            if (currentUrl != base) throw IOException("HOME server session changed. Retry with the selected server.")
            val destination = chain.request().url
            if (destination.scheme != base.scheme || destination.host != base.host || destination.port != base.port ||
                !destination.encodedPath.startsWith(base.encodedPath)) {
                throw IOException("Request destination does not match the HOME server.")
            }
            val request = chain.request().newBuilder().removeHeader("Authorization")
            current.token?.takeIf { it.isNotBlank() }?.let { request.header("Authorization", "Bearer $it") }
            chain.proceed(request.build())
        }
        .build()
