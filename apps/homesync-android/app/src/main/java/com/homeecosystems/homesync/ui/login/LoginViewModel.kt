package com.homeecosystems.homesync.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.homeecosystems.homesync.data.SessionManager
import com.homeecosystems.homesync.data.api.ApiClient
import com.homeecosystems.homesync.data.api.LoginRequest
import com.homeecosystems.homesync.data.api.TwoFactorVerifyRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val serverUrl: String = "",
    val username: String = "",
    val password: String = "",
    val code: String = "",
    val pendingToken: String? = null,
    val isLoading: Boolean = false,
    val errorMessage: String? = null
)

class LoginViewModel(
    private val apiClient: ApiClient,
    private val sessionManager: SessionManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState(serverUrl = sessionManager.currentServerUrl() ?: ""))
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onServerUrlChange(value: String) = _uiState.update { it.copy(serverUrl = value, errorMessage = null) }
    fun onUsernameChange(value: String) = _uiState.update { it.copy(username = value, errorMessage = null) }
    fun onPasswordChange(value: String) = _uiState.update { it.copy(password = value, errorMessage = null) }
    fun onCodeChange(value: String) = _uiState.update { it.copy(code = value, errorMessage = null) }

    fun submitCredentials(onSuccess: () -> Unit) {
        val state = _uiState.value
        if (state.serverUrl.isBlank() || state.username.isBlank() || state.password.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Fill in the server address, username, and password.") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                // Save the address (with no token yet) first so ApiClient
                // has somewhere to actually send the login request to.
                sessionManager.saveSession(state.serverUrl.trim(), "")
                apiClient.invalidate()

                val response = apiClient.getApi().login(LoginRequest(state.username.trim(), state.password))
                val body = response.body()

                when {
                    !response.isSuccessful || body == null ->
                        _uiState.update { it.copy(errorMessage = "That username or password wasn't right.") }
                    body.requires2fa == true && body.pendingToken != null ->
                        _uiState.update { it.copy(pendingToken = body.pendingToken) }
                    body.token != null -> {
                        sessionManager.saveSession(state.serverUrl.trim(), body.token)
                        onSuccess()
                    }
                    else -> _uiState.update { it.copy(errorMessage = "Unexpected response from the server.") }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(errorMessage = "Couldn't reach \"${state.serverUrl}\" — check the address and that HomeSync is running.")
                }
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun submitCode(onSuccess: () -> Unit) {
        val state = _uiState.value
        val pendingToken = state.pendingToken ?: return
        if (state.code.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Enter your code.") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                val response = apiClient.getApi().verify2fa(TwoFactorVerifyRequest(pendingToken, state.code.trim()))
                val body = response.body()
                if (response.isSuccessful && body?.token != null) {
                    sessionManager.saveSession(state.serverUrl.trim(), body.token)
                    onSuccess()
                } else {
                    _uiState.update { it.copy(errorMessage = "That code didn't work — try again.") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(errorMessage = "Couldn't reach the server.") }
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun backToCredentials() = _uiState.update { it.copy(pendingToken = null, code = "", errorMessage = null) }

    class Factory(private val apiClient: ApiClient, private val sessionManager: SessionManager) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = LoginViewModel(apiClient, sessionManager) as T
    }
}
