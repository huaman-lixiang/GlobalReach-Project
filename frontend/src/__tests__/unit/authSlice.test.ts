import { describe, it, expect, beforeEach } from 'vitest'
import authReducer, {
  login,
  register,
  getProfile,
  logout,
  clearError,
} from '@/store/slices/authSlice'

const initialState = {
  user: null,
  token: null,
  isAuthenticated: false,
  loading: false,
  error: null,
}

describe('authSlice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should return initial state', () => {
    const state = authReducer(undefined, { type: 'unknown' })
    expect(state).toEqual(initialState)
  })

  it('handles login.pending', () => {
    const state = authReducer(initialState, { type: login.pending.type })
    expect(state.loading).toBe(true)
    expect(state.error).toBeNull()
  })

  it('handles login.fulfilled', () => {
    const mockUser = { id: '1', email: 'test@test.com', name: 'Test User', role: 'user' }
    const mockToken = 'mock-jwt-token'
    
    const state = authReducer(initialState, {
      type: login.fulfilled.type,
      payload: { user: mockUser, token: mockToken },
    })

    expect(state.loading).toBe(false)
    expect(state.isAuthenticated).toBe(true)
    expect(state.user).toEqual(mockUser)
    expect(state.token).toBe(mockToken)
    expect(localStorage.getItem('token')).toBe(mockToken)
  })

  it('handles login.rejected', () => {
    const state = authReducer(initialState, {
      type: login.rejected.type,
      error: { message: 'Invalid credentials' },
    })

    expect(state.loading).toBe(false)
    expect(state.error).toBe('Invalid credentials')
  })

  it('handles register.fulfilled', () => {
    const mockUser = { id: '2', email: 'new@test.com', name: 'New User', role: 'user' }
    const mockToken = 'new-jwt-token'
    
    const state = authReducer(initialState, {
      type: register.fulfilled.type,
      payload: { user: mockUser, token: mockToken },
    })

    expect(state.isAuthenticated).toBe(true)
    expect(state.user).toEqual(mockUser)
    expect(localStorage.getItem('token')).toBe(mockToken)
  })

  it('handles getProfile.fulfilled', () => {
    const existingState = { ...initialState, isAuthenticated: true, token: 'existing-token' }
    const mockProfile = { id: '1', email: 'test@test.com', name: 'Updated Name', role: 'admin' }

    const state = authReducer(existingState, {
      type: getProfile.fulfilled.type,
      payload: mockProfile,
    })

    expect(state.user).toEqual(mockProfile)
  })

  it('handles logout action', () => {
    const loggedInState = {
      ...initialState,
      isAuthenticated: true,
      user: { id: '1', email: 'test@test.com', name: 'Test', role: 'user' },
      token: 'some-token',
    }
    localStorage.setItem('token', 'some-token')

    const state = authReducer(loggedInState, logout())

    expect(state.user).toBeNull()
    expect(state.token).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('handles clearError action', () => {
    const errorState = { ...initialState, error: 'Some error' }
    const state = authReducer(errorState, clearError())
    expect(state.error).toBeNull()
  })
})
