package com.homeecosystems.homesync.data

/** One immutable URL/token pair; network threads must never read them separately. */
internal data class ServerSession(val serverUrl: String? = null, val token: String? = null) {
    override fun toString(): String = "ServerSession(credentials redacted)"
}
