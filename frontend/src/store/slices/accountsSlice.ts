import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '@/services/api'

interface Account {
  id: string
  email: string
  platform: string
  status: 'active' | 'inactive' | 'error'
}

interface AccountsState {
  items: Account[]
  loading: boolean
  error: string | null
  total: number
}

const initialState: AccountsState = {
  items: [],
  loading: false,
  error: null,
  total: 0,
}

export const fetchAccounts = createAsyncThunk('accounts/fetchAll', async (params?: any) => {
  const response = await api.get('/accounts', { params })
  return response.data
})

export const createAccount = createAsyncThunk('accounts/create', async (data: Partial<Account>) => {
  const response = await api.post('/accounts', data)
  return response.data
})

export const updateAccount = createAsyncThunk(
  'accounts/update',
  async ({ id, ...data }: Partial<Account> & { id: string }) => {
    const response = await api.put(`/accounts/${id}`, data)
    return response.data
  },
)

export const deleteAccount = createAsyncThunk('accounts/delete', async (id: string) => {
  await api.delete(`/accounts/${id}`)
  return id
})

const accountsSlice = createSlice({
  name: 'accounts',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAccounts.pending, (state) => {
        state.loading = true
      })
      .addCase(fetchAccounts.fulfilled, (state, action) => {
        state.loading = false
        state.items = action.payload.rows || action.payload
        state.total = action.payload.count || action.payload.length
      })
      .addCase(fetchAccounts.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '获取账号列表失败'
      })
      .addCase(createAccount.fulfilled, (state, action) => {
        state.items.unshift(action.payload)
        state.total += 1
      })
  },
})

export default accountsSlice.reducer
