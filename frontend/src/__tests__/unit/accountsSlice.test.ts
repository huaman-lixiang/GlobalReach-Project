import { describe, it, expect, beforeEach } from 'vitest'
import accountsReducer, {
  fetchAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} from '@/store/slices/accountsSlice'

const mockAccount = {
  id: '1',
  email: 'test@gmail.com',
  platform: 'gmail',
  status: 'active' as const,
}

const initialState = {
  items: [],
  loading: false,
  error: null,
  total: 0,
}

describe('accountsSlice', () => {
  it('should return initial state', () => {
    const state = accountsReducer(undefined, { type: 'unknown' })
    expect(state).toEqual(initialState)
  })

  it('handles fetchAccounts.pending', () => {
    const state = accountsReducer(initialState, { type: fetchAccounts.pending.type })
    expect(state.loading).toBe(true)
  })

  it('handles fetchAccounts.fulfilled with rows', () => {
    const mockData = {
      rows: [mockAccount],
      count: 1,
    }

    const state = accountsReducer(initialState, {
      type: fetchAccounts.fulfilled.type,
      payload: mockData,
    })

    expect(state.loading).toBe(false)
    expect(state.items).toEqual([mockAccount])
    expect(state.total).toBe(1)
  })

  it('handles fetchAccounts.fulfilled without rows', () => {
    const mockAccounts = [mockAccount, { ...mockAccount, id: '2', email: 'test2@gmail.com' }]

    const state = accountsReducer(initialState, {
      type: fetchAccounts.fulfilled.type,
      payload: mockAccounts,
    })

    expect(state.items).toHaveLength(2)
    expect(state.total).toBe(2)
  })

  it('handles fetchAccounts.rejected', () => {
    const state = accountsReducer(initialState, {
      type: fetchAccounts.rejected.type,
      error: { message: 'Network error' },
    })

    expect(state.loading).toBe(false)
    expect(state.error).toBe('Network error')
  })

  it('handles createAccount.fulfilled', () => {
    const newAccount = { id: '3', email: 'new@gmail.com', platform: 'gmail', status: 'active' as const }
    const existingState = { ...initialState, items: [mockAccount], total: 1 }

    const state = accountsReducer(existingState, {
      type: createAccount.fulfilled.type,
      payload: newAccount,
    })

    expect(state.items).toHaveLength(2)
    expect(state.items[0]).toEqual(newAccount)
    expect(state.total).toBe(2)
  })

  it('handles deleteAccount.fulfilled', () => {
    const existingState = { ...initialState, items: [mockAccount], total: 1 }

    const state = accountsReducer(existingState, {
      type: deleteAccount.fulfilled.type,
      payload: '1',
    })

    expect(state.items).toHaveLength(0)
  })
})
