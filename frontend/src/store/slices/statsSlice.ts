import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '@/services/api'

interface StatsData {
  totalEmailsSent: number
  totalAccounts: number
  activeCampaigns: number
  openRate: number
  clickRate: number
  bounceRate: number
  emailsByPlatform: { platform: string; count: number }[]
  dailyStats: { date: string; sent: number; opened: number }[]
  recentActivity?: {
    id: string
    toAddress: string
    subject: string
    status: string
    createdAt: string
    campaignName?: string
  }[]
}

interface StatsState {
  data: StatsData | null
  loading: boolean
  error: string | null
}

const initialState: StatsState = {
  data: null,
  loading: false,
  error: null,
}

export const fetchStats = createAsyncThunk('stats/fetch', async () => {
  const response = await api.get('/stats/overview')
  return response.data
})

const statsSlice = createSlice({
  name: 'stats',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchStats.pending, (state) => {
        state.loading = true
      })
      .addCase(fetchStats.fulfilled, (state, action) => {
        state.loading = false
        state.data = action.payload
      })
      .addCase(fetchStats.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '获取统计数据失败'
      })
  },
})

export default statsSlice.reducer
