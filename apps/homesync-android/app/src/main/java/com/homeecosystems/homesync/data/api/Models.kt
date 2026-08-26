package com.homeecosystems.homesync.data.api

// Every data class below is deliberately shaped to match the JSON a real
// backend route sends or expects, checked directly against the source
// rather than guessed:
//   - Auth shapes  -> homecore/src/auth.js's /login and /2fa/verify routes
//                     (reached through homesync-backend/src/authProxy.js,
//                     which forwards the request/response unchanged)
//   - Device shapes -> homesync-backend/src/devices.js
//   - Check/Upload/History -> homesync-backend/src/sync.js
//
// Field names here match the JSON field names exactly (Retrofit's Gson
// converter matches by name, case-sensitively) — this is why, for
// example, `requires2fa` isn't renamed to something more Kotlin-idiomatic
// like `requiresTwoFactor`: it has to be the literal wire name.

// ---------------------------------------------------------------------
// Auth — POST /api/homesync/auth/login, POST /api/homesync/auth/2fa/verify
// ---------------------------------------------------------------------

data class LoginRequest(val username: String, val password: String)

/**
 * The one response shape both /login and /2fa/verify return (see
 * homecore/src/auth.js) — which fields are actually populated tells the
 * caller which of three outcomes happened:
 *   - `requires2fa == true` + `pendingToken` set -> correct password,
 *     needs a 2FA code next (see LoginViewModel.submitCredentials)
 *   - `token` set -> fully logged in
 *   - neither -> something else went wrong (handled as an error)
 */
data class LoginResponse(
    val token: String? = null,
    val user: UserSummary? = null,
    val requires2fa: Boolean? = null,
    val pendingToken: String? = null
)

data class UserSummary(val id: Int, val username: String, val role: String)

data class TwoFactorVerifyRequest(val pendingToken: String, val code: String)

// ---------------------------------------------------------------------
// Devices — POST/GET /api/homesync/devices
// ---------------------------------------------------------------------

data class RegisterDeviceRequest(val name: String, val platform: String = "android")

data class RegisterDeviceResponse(val device: DeviceSummary)

data class DeviceSummary(
    val id: Int,
    val name: String,
    val platform: String,
    val createdAt: String,
    val lastSeenAt: String
)

// ---------------------------------------------------------------------
// Check (dedup) — POST /api/homesync/check
// ---------------------------------------------------------------------

/**
 * One file's hash+size, sent as part of a batch (server caps batches at
 * 500 entries — see sync/SyncLogic.kt's `chunked()`, which BackupWorker
 * uses to respect that limit client-side too).
 */
data class CheckFileEntry(val hash: String, val size: Long)

data class CheckRequest(val files: List<CheckFileEntry>)

data class CheckResult(val hash: String, val alreadySynced: Boolean)

data class CheckResponse(val results: List<CheckResult>)

// ---------------------------------------------------------------------
// Upload — POST /api/homesync/upload (multipart)
// ---------------------------------------------------------------------

/**
 * What the server sends back after a successful upload. BackupWorker
 * itself only checks `response.isSuccessful` today and doesn't read this
 * body — but it's the real contract (homesync-backend/src/sync.js), typed
 * out for whatever reads it next (a future "recently uploaded" list, for
 * instance) instead of needing to be reverse-engineered again then.
 */
data class UploadResponse(
    val deduped: Boolean,
    val homecloudFileId: Int,
    val folderId: Int? = null
)

// ---------------------------------------------------------------------
// History — GET /api/homesync/history
// ---------------------------------------------------------------------

data class HistoryFile(
    val id: Int,
    val deviceName: String,
    val category: String,
    val size: Long,
    val homecloudFileId: Int,
    val syncedAt: String
)

/**
 * The Home screen's summary card (see HomeViewModel.refreshSummary). Also
 * constructed directly in Kotlin — not just deserialized from JSON — when
 * the server can't be reached and HomeViewModel falls back to the local
 * Room cache, which is why the field *order* matters here as much as the
 * names: that fallback builds one with positional arguments
 * `HistorySummary(count, bytes, lastSyncedAtIso)`.
 */
data class HistorySummary(
    val fileCount: Int,
    val totalBytes: Long,
    val lastSyncedAt: String? = null
)

data class HistoryResponse(val files: List<HistoryFile>, val summary: HistorySummary)
