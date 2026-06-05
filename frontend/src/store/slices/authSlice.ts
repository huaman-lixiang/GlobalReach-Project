import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import api from '@/services/api'
import { setTokens, clearTokens, getAccessToken } from '@/services/api'

// ============================================
// Types
// ============================================

interface User {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'USER' | 'VIEWER'
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  loading: boolean
  error: string | null
}

// ============================================
// Initial State
// ============================================

const initialState: AuthState = {
  user: null,
  isAuthenticated: !!getAccessToken(),
  loading: false,
  error: null,
}

// ============================================
// Async Thunks
// ============================================

export const login = createAsyncThunk(
  'auth/login',
  async (credentials: { email: string; password: string }) => {
    const response: any = await api.post('/auth/login', credentials)
    const data = response.data || response

    // D05 Dual-Token: store both tokens
    if (data.accessToken) {
      setTokens(data.accessToken, data.refreshToken)
    }

    return data.user || data
  },
)

export const register = createAsyncThunk(
  'auth/register',
  async (userData: { email: string; password: string; name: string }) => {
    const response: any = await api.post('/auth/register', userData)
    const data = response.data || response

    if (data.accessToken) {
      setTokens(data.accessToken, data.refreshToken)
    }

    return data.user || data
  },
)

export const getProfile = createAsyncThunk('auth/getProfile', async () => {
  const response: any = await api.get('/auth/me')
  return response.data || response
})

export const logoutUser = createAsyncThunk('auth/logout', async () => {
  try {
    await api.post('/auth/logout')
  } catch (_) {
    // Continue logout even if API call fails
  } finally {
    clearTokens()
  }
})

// ============================================
// Slice
// ============================================

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    forceLogout: (state) => {
      state.user = null
      state.isAuthenticated = false
      state.loading = false
      clearTokens()
    },
  },
  extraReducers: (builder) => {
    builder
      // Login
      .addCase(login.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(login.fulfilled, (state, action: PayloadAction<any>) => {
        state.loading = false
        state.isAuthenticated = true
        state.user = action.payload
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '登录失败'
      })
      // Register
      .addCase(register.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(register.fulfilled, (state, action: PayloadAction<any>) => {
        state.loading = false
        state.isAuthenticated = true
        state.user = action.payload
      })
      .addCase(register.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '注册失败'
      })
      // Get Profile
      .addCase(getProfile.fulfilled, (state, action: PayloadAction<any>) => {
        state.user = action.payload
      })
      // Logout
      .addCase(logoutUser.fulfilled, (state) => {
        state.user = null
        state.isAuthenticated = false
        state.loading = false
      })
  },
})

export const { clearError, forceLogout } = authSlice.actions
export default authSlice.reducer
