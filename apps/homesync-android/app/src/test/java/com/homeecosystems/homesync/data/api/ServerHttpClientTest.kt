package com.homeecosystems.homesync.data.api

import com.homeecosystems.homesync.data.ServerSession
import com.sun.net.httpserver.HttpServer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.*
import org.junit.Test
import java.io.Closeable
import java.io.IOException
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList

class ServerHttpClientTest {
    private class Server(private val redirect: String? = null) : Closeable {
        val authorizations = CopyOnWriteArrayList<String>()
        val bodies = CopyOnWriteArrayList<String>()
        private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            createContext("/") { exchange ->
                authorizations.add(exchange.requestHeaders.getFirst("Authorization") ?: "")
                bodies.add(exchange.requestBody.bufferedReader().use { it.readText() })
                if (redirect != null) exchange.responseHeaders.add("Location", redirect)
                exchange.sendResponseHeaders(if (redirect != null) 307 else 200, 2)
                exchange.responseBody.use { it.write("ok".toByteArray()) }
            }
            start()
        }
        val url get() = normalizeServerUrl("http://127.0.0.1:${server.address.port}/")
        override fun close() = server.stop(0)
    }

    @Test fun `retained client cannot send another server's token or body`() {
        Server().use { a -> Server().use { b ->
            var session = ServerSession(a.url.toString(), "fixture-token-a")
            val clientA = serverHttpClient(a.url) { session }
            clientA.newCall(Request.Builder().url(a.url).build()).execute().use { assertEquals(200, it.code) }
            session = ServerSession(b.url.toString(), "fixture-token-b")
            val request = Request.Builder().url(a.url).post("fixture-upload".toRequestBody()).build()
            assertThrows(IOException::class.java) { clientA.newCall(request).execute() }
            assertEquals(listOf("Bearer fixture-token-a"), a.authorizations.toList())
            assertTrue(b.authorizations.isEmpty())
            val clientB = serverHttpClient(b.url) { session }
            clientB.newCall(Request.Builder().url(b.url).build()).execute().close()
            assertEquals(listOf("Bearer fixture-token-b"), b.authorizations.toList())
        } }
    }

    @Test fun `same-server renewal replaces stale headers and logout refuses new work`() {
        Server().use { a ->
            var session = ServerSession(a.url.toString(), "fixture-old")
            val client = serverHttpClient(a.url) { session }
            val request = Request.Builder().url(a.url).header("Authorization", "Bearer stale-header").build()
            client.newCall(request).execute().close()
            session = session.copy(token = "fixture-renewed")
            client.newCall(request).execute().close()
            session = ServerSession()
            assertThrows(IOException::class.java) { client.newCall(request).execute() }
            assertEquals(listOf("Bearer fixture-old", "Bearer fixture-renewed"), a.authorizations.toList())
        }
    }

    @Test fun `login may have an empty token but must use the bound destination`() {
        Server().use { a -> Server().use { b ->
            val client = serverHttpClient(a.url) { ServerSession(a.url.toString(), "") }
            client.newCall(Request.Builder().url(a.url).build()).execute().close()
            assertEquals(listOf(""), a.authorizations.toList())
            assertThrows(IOException::class.java) { client.newCall(Request.Builder().url(b.url).build()).execute() }
            assertTrue(b.authorizations.isEmpty())
        } }
    }

    @Test fun `redirect cannot forward passwords tokens or uploads to another server`() {
        Server().use { b -> Server(b.url.toString()).use { a ->
            val client = serverHttpClient(a.url) { ServerSession(a.url.toString(), "fixture-token-a") }
            val body = "fixture-password-and-upload".toRequestBody("text/plain".toMediaType())
            client.newCall(Request.Builder().url(a.url).post(body).build()).execute().use { assertEquals(307, it.code) }
            assertEquals(listOf("fixture-password-and-upload"), a.bodies.toList())
            assertTrue(b.authorizations.isEmpty())
            assertTrue(b.bodies.isEmpty())
        } }
    }

    @Test fun `URL normalization preserves identity and bounds scheme port and path`() {
        assertEquals("http://example.test/", normalizeServerUrl(" EXAMPLE.test:80 ").toString())
        Server().use { a ->
            val base = a.url.resolve("home/")!!
            val client = serverHttpClient(base) { ServerSession(base.toString(), "fixture-token") }
            for (destination in listOf(a.url, a.url.newBuilder().scheme("https").build())) {
                assertThrows(IOException::class.java) { client.newCall(Request.Builder().url(destination).build()).execute() }
            }
            assertTrue(a.authorizations.isEmpty())
            assertFalse(ServerSession(base.toString(), "fixture-token").toString().contains("fixture-token"))
        }
    }
}
