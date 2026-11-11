package com.homeecosystems.homesync.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first

// `preferencesDataStore` is an extension property builder from Jetpack
// DataStore — it hands back one shared DataStore<Preferences> instance
// per `name`, backed by a small file on disk (the modern, coroutine-based
// replacement for SharedPreferences). Declaring it at file scope like
// this — once, outside the class — is the standard pattern: it guarantees
// every SessionManager instance in the app talks to the exact same
// underlying file instead of each accidentally creating its own.
private val Context.sessionDataStore by preferencesDataStore(name = "homesync_session")

/**
 * Where the signed-in session lives: the server address, the auth token,
 * and this device's registered ID (see BackupWorker.ensureDeviceId).
 * Two things worth understanding before changing this file:
 *
 * 1. Everything is persisted via DataStore, so it survives app restarts
 *    and device reboots — that's the whole point of a session that
 *    doesn't ask you to log in again every time.
 *
 * 2. Some callers need a *synchronous* read — most importantly, an
 *    OkHttp interceptor (see ApiClient) runs on a plain background
 *    thread and can't `suspend` to await a DataStore read for every
 *    single network call. So this class keeps an in-memory copy in
 *    immutable URL/token snapshot, loaded by [initialize] at app startup
 *    (see HomeSyncApplication and MainActivity, both of which call it
 *    before doing anything else), and every write updates the in-memory
 *    copy *and* the persisted value together — so a read immediately
 *    after a write always sees the new value.
 */
class SessionManager(private val context: Context) {

    private object Keys {
        val SERVER_URL = stringPreferencesKey("server_url")
        val TOKEN = stringPreferencesKey("token")
        val DEVICE_ID = intPreferencesKey("device_id")
        val ACCOUNT_ID = intPreferencesKey("account_id")
    }

    @Volatile private var session = ServerSession()

    /**
     * This device's ID once registered with homesync-backend, or `null`
     * before the first successful backup run registers one. Exposed
     * directly as a StateFlow (not behind a getter function) because
     * BackupWorker reads `.value` on it straight off the property — see
     * BackupWorker.ensureDeviceId.
     */
    val deviceId = MutableStateFlow<Int?>(null)

    /**
     * Loads whatever was persisted from a previous run into the
     * in-memory StateFlows above. Safe to call more than once (it just
     * re-reads the same file), but pointless to — call it once, early,
     * before checking [isSignedIn] or reading anything else here.
     */
    suspend fun initialize() {
        val prefs = context.sessionDataStore.data.first()
        session = ServerSession(prefs[Keys.SERVER_URL], prefs[Keys.TOKEN], prefs[Keys.ACCOUNT_ID])
        deviceId.value = prefs[Keys.DEVICE_ID]
    }

    fun isSignedIn(): Boolean = session.let { !it.serverUrl.isNullOrBlank() && !it.token.isNullOrBlank() }

    fun currentServerUrl(): String? = session.serverUrl

    /** Read by ApiClient's auth interceptor on every request — see ApiClient.kt. */
    fun currentToken(): String? = session.token

    internal fun currentSession(): ServerSession = session

    fun currentDestinationKey(): String? = session.destinationKey()

    /** Adopt legacy identity only after Core verifies this exact URL/token pair. */
    internal suspend fun bindAccount(expected: ServerSession, accountId: Int): Boolean {
        require(accountId > 0)
        var bound = false
        context.sessionDataStore.edit { prefs ->
            if (prefs[Keys.SERVER_URL] == expected.serverUrl && prefs[Keys.TOKEN] == expected.token) {
                prefs[Keys.ACCOUNT_ID] = accountId
                session = expected.copy(accountId = accountId)
                bound = true
            }
        }
        return bound
    }

    /**
     * Called twice in a normal login flow (see LoginViewModel.submitCredentials):
     * once with an empty token right after the person enters a server
     * address, so ApiClient has somewhere to actually send the login
     * request to, then again with the real token once login succeeds.
     */
    suspend fun saveSession(serverUrl: String, token: String, accountId: Int? = null) {
        require(accountId == null || accountId > 0)
        session = ServerSession(serverUrl, token, accountId)
        context.sessionDataStore.edit { prefs ->
            prefs[Keys.SERVER_URL] = serverUrl
            prefs[Keys.TOKEN] = token
            if (accountId == null) prefs.remove(Keys.ACCOUNT_ID) else prefs[Keys.ACCOUNT_ID] = accountId
        }
    }

    /** Called once, the first time a backup run successfully registers this device — see BackupWorker.ensureDeviceId. */
    suspend fun saveDeviceId(id: Int) {
        deviceId.value = id
        context.sessionDataStore.edit { prefs -> prefs[Keys.DEVICE_ID] = id }
    }

    /**
     * Not called anywhere yet — HomeScreen has no "Sign out" button today
     * (see MainActivity, which only ever reads isSignedIn(), never clears
     * it) — but a real session store needs a real way to clear itself for
     * whenever that's added, rather than that being an afterthought bolted
     * on later. Clears both the in-memory state and everything persisted.
     */
    suspend fun clearSession() {
        session = ServerSession()
        deviceId.value = null
        context.sessionDataStore.edit { it.clear() }
    }
}
