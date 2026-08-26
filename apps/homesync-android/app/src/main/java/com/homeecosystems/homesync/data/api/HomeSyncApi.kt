package com.homeecosystems.homesync.data.api

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part

/**
 * One method per real HTTP route this app calls — see Models.kt's header
 * comment for exactly which backend file each route is defined in. Every
 * path here is relative (no leading "/"), which Retrofit resolves against
 * whatever base URL ApiClient built from the address the person typed in
 * on the login screen (see ApiClient.normalizeBaseUrl) — so these paths
 * never need to change no matter what server address someone's actually
 * running this against.
 *
 * All `suspend` — Retrofit runs suspend interface methods as real
 * coroutines under the hood, which is what lets every call site (e.g.
 * BackupWorker.doWork, LoginViewModel.submitCredentials) just write
 * ordinary sequential code instead of callbacks.
 */
interface HomeSyncApi {

    @POST("api/homesync/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("api/homesync/auth/2fa/verify")
    suspend fun verify2fa(@Body request: TwoFactorVerifyRequest): Response<LoginResponse>

    @POST("api/homesync/devices")
    suspend fun registerDevice(@Body request: RegisterDeviceRequest): Response<RegisterDeviceResponse>

    @POST("api/homesync/check")
    suspend fun check(@Body request: CheckRequest): Response<CheckResponse>

    /**
     * Multipart because it's a real file upload, not JSON — the other
     * fields ride alongside the file as plain form parts (matching
     * exactly what homesync-backend/src/sync.js reads off `req.body` for
     * a multipart request: deviceId, category, contentHash, and an
     * optional capturedAt). See BackupWorker.uploadOne for how each
     * RequestBody is built from a plain String via `.toRequestBody()`.
     */
    @Multipart
    @POST("api/homesync/upload")
    suspend fun upload(
        @Part file: MultipartBody.Part,
        @Part("deviceId") deviceId: RequestBody,
        @Part("category") category: RequestBody,
        @Part("contentHash") contentHash: RequestBody,
        @Part("capturedAt") capturedAt: RequestBody?
    ): Response<UploadResponse>

    @GET("api/homesync/history")
    suspend fun history(): Response<HistoryResponse>
}
