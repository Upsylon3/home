package com.homeecosystems.homesync.data

import org.junit.Assert.*
import org.junit.Test

class DestinationKeyTest {
    @Test fun `canonical URLs and token renewal retain the same ledger`() {
        val first = ServerSession(" EXAMPLE.test:80 ", "fixture-old", 7)
        val renewed = ServerSession("http://example.test/", "fixture-new", 7)
        assertEquals(first.destinationKey(), renewed.destinationKey())
        assertTrue(first.destinationKey()!!.matches(Regex("[a-f0-9]{64}")))
    }

    @Test fun `server scheme port path and account are distinct destinations`() {
        val addresses = listOf("http://a.test/", "https://a.test/", "http://a.test:8080/", "http://b.test/", "http://a.test/home/")
        val keys = addresses.flatMap { url -> listOf(1, 2).map { destinationKey(url, it) } }
        assertEquals(10, keys.toSet().size)
    }

    @Test fun `unverified legacy sessions have no deduplication identity`() {
        assertNull(ServerSession("http://a.test/", "fixture-token").destinationKey())
        assertNull(ServerSession().destinationKey())
        assertThrows(IllegalArgumentException::class.java) { destinationKey("http://a.test/", 0) }
    }
}
