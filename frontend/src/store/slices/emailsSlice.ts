import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '@/services/api'

// ============================================
// Types
// ============================================

interface EmailRecord {
  id: string
  campaignId?: string
  toAddress: string
  fromAddress: string
  subject: string
  status: 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed'
  sentAt?: string
  errorMessage?: string
  createdAt: string
}

interface EmailsState {
  items: EmailRecord[]
  loading: boolean
  error: string | null
  total: number
}

const initialState: EmailsState = {
  items: [],
  loading: false,
  error: null,
  total: 0,
}

// ============================================
// Async Thunks
// ============================================

export const fetchEmails = createAsyncThunk(
  'emails/fetchAll',
  async (params?: { page?: number; pageSize?: number; status?: string; search?: string }) => {
    const response: any = await api.get('/emails', { params })
    const data = response.data || response
    return {
      rows: data.rows || data.data || [],
      count: data.count || data.total || (Array.isArray(data) ? data.length : 0),
    }
  },
)

export const resendEmail = createAsyncThunk(
  'emails/resend',
  async (id: string) => {
    const response: any = await api.post(`/emails/${id}/resend`)
    return response.data || response
  },
)

export const fetchEmailStats = createAsyncThunk('emails/fetchStats', async () => {
  const response: any = await api.get('/emails/stats')
  return response.data || response
})

// ============================================
// Slice
// ============================================

const emailsSlice = createSlice({
  name: 'emails',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchEmails.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchEmails.fulfilled, (state, action) => {
        state.loading = false
        state.items = action.payload.rows
        state.total = action.payload.count
      })
      .addCase(fetchEmails.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '获取邮件记录失败'
      })
      .addCase(resendEmail.pending, (state) => {
        state.loading = true
      })
      .addCase(resendEmail.fulfilled, (state) => {
        state.loading = false
      })
      .addCase(resendEmail.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '重发失败'
      })
  },
})

export default emailsSlice.reducer
