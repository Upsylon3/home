package com.homeecosystems.homesync.data

import com.homeecosystems.homesync.data.api.normalizeServerUrl
import java.security.MessageDigest

/** Local ledger identity, never an authentication credential or federation ID. */
internal fun destinationKey(serverUrl: String, accountId: Int): String {
    require(accountId > 0) { "A verified account ID is required." }
    val canonical = normalizeServerUrl(serverUrl).toString()
    return MessageDigest.getInstance("SHA-256")
        .digest("home-destination-v1\n$canonical\n$accountId".toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}
