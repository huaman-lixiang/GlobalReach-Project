import axios from 'axios'
import { message } from 'antd'

// ============================================
// Token Management (D05 Dual-Token Support + D10 CSRF)
// ============================================

const TOKEN_KEY = 'accessToken'
const REFRESH_KEY = 'refreshToken'
const CSRF_KEY = 'csrfToken'

export const getAccessToken = (): string | null => localStorage.getItem(TOKEN_KEY)
export const getRefreshToken = (): string | null => localStorage.getItem(REFRESH_KEY)

// D10: CSRF Token Management
export const getCsrfToken = (): string | null => localStorage.getItem(CSRF_KEY)
export const setCsrfToken = (token: string): void => localStorage.setItem(CSRF_KEY, token)
export const clearCsrfToken = (): void => localStorage.removeItem(CSRF_KEY)

export const setTokens = (accessToken: string, refreshToken?: string, csrfToken?: string): void => {
  localStorage.setItem(TOKEN_KEY, accessToken)
  if (refreshToken) {
    localStorage.setItem(REFRESH_KEY, refreshToken)
  }
  // D10: Store CSRF token if provided (from login/register response)
  if (csrfToken) {
    setCsrfToken(csrfToken)
  }
}

export const clearTokens = (): void => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
  clearCsrfToken() // D10: Clear CSRF token on logout
}

// Track in-flight refresh to prevent multiple simultaneous refresh calls
let refreshPromise: Promise<string> | null = null

// D10: Track in-flight CSRF token fetch to prevent duplicate requests
let csrfFetchPromise: Promise<string> | null = null

const attemptRefresh = async (): Promise<string | null> => {
  const rt = getRefreshToken()
  if (!rt) return null

  // If a refresh is already in flight, reuse the same promise
  if (refreshPromise) return refreshPromise

  refreshPromise = axios
    .post('/auth/refresh', { refreshToken: rt })
    .then((res: any) => {
      const data = res.data?.data || res.data
      if (data.accessToken) {
        setTokens(data.accessToken, data.refreshToken, data.csrfToken)
        return data.accessToken
      }
      throw new Error('No accessToken in refresh response')
    })
    .catch((err) => {
      console.error('[API] Token refresh failed:', err.message)
      clearTokens()
      window.location.href = '/login'
      return null
    })
    .finally(() => {
      refreshPromise = null
    })

  return refreshPromise
}

// D10: Fetch a fresh CSRF token from server
const fetchCsrfToken = async (): Promise<string | null> => {
  if (csrfFetchPromise) return csrfFetchPromise

  csrfFetchPromise = axios
    .get('/auth/csrf-token')
    .then((res: any) => {
      const data = res.data?.data || res.data
      if (data.csrfToken) {
        setCsrfToken(data.csrfToken)
        return data.csrfToken
      }
      throw new Error('No csrfToken in response')
    })
    .catch((err) => {
      console.error('[API] CSRF token fetch failed:', err.message)
      return null
    })
    .finally(() => {
      csrfFetchPromise = null
    })

  return csrfFetchPromise
}

// ============================================
// Safe HTTP Methods — no CSRF needed
// ============================================

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
function isSafeMethod(method?: string): boolean {
  return !!method && SAFE_METHODS.has(method.toUpperCase())
}

// ============================================
// Axios Instance
// ============================================

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor — attach access token + CSRF token
api.interceptors.request.use(
  (config) => {
    // D05: Attach JWT Bearer token
    const token = getAccessToken()
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }

    // D10: Attach CSRF token on mutating requests only (POST/PUT/PATCH/DELETE)
    if (!isSafeMethod(config.method) && config.headers) {
      const csrfToken = getCsrfToken()
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken
      }
    }

    return config
  },
  (error) => Promise.reject(error),
)

// Response interceptor — handle 401 with auto-refresh, 403 with CSRF retry
api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const originalRequest = error.config

    // D10: Handle CSRF validation failure — fetch new token and retry once
    if (
      error.response?.status === 403 &&
      (error.response.data?.code === 'CSRF_001' ||
       error.response.data?.code === 'CSRF_002') &&
      !originalRequest._csrfRetry
    ) {
      originalRequest._csrfRetry = true

      const newCsrfToken = await fetchCsrfToken()
      if (newCsrfToken && originalRequest.headers) {
        originalRequest.headers['X-CSRF-Token'] = newCsrfToken
        return api(originalRequest) // Retry with fresh CSRF token
      }

      // CSRF token fetch failed
      message.error('安全验证失败，请重新登录')
      clearTokens()
      window.location.href = '/login'
      return Promise.reject(error)
    }

    // Handle 401 — try to refresh the token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      const newToken = await attemptRefresh()
      if (newToken && originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        // D10: Also refresh CSRF token after token rotation
        const csrfToken = getCsrfToken()
        if (csrfToken && !isSafeMethod(originalRequest.method)) {
          originalRequest.headers['X-CSRF-Token'] = csrfToken
        }
        return api(originalRequest) // Retry the original request
      }

      // Refresh failed or no refresh token
      message.error('登录已过期，请重新登录')
      return Promise.reject(error)
    }

    // Handle other errors
    if (error.response) {
      switch (error.response.status) {
        case 403:
          message.error(error.response.data?.message || '没有权限执行此操作')
          break
        case 404:
          message.error('请求的资源不存在')
          break
        case 429:
          message.error('请求过于频繁，请稍后再试')
          break
        case 500:
          message.error('服务器内部错误，请联系管理员')
          break
        default:
          message.error(error.response.data?.message || '请求失败')
      }
    } else if (error.request) {
      message.error('网络连接失败，请检查网络设置')
    } else {
      message.error('请求配置错误')
    }

    return Promise.reject(error)
  },
)

export default api
