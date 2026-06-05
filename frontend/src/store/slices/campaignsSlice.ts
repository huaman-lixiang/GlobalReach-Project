import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '@/services/api'

interface Campaign {
  id: string
  name: string
  subject: string
  status: 'draft' | 'scheduled' | 'sending' | 'completed'
  sentCount: number
  totalCount: number
}

interface CampaignsState {
  items: Campaign[]
  loading: boolean
  error: string | null
  total: number
}

const initialState: CampaignsState = {
  items: [],
  loading: false,
  error: null,
  total: 0,
}

export const fetchCampaigns = createAsyncThunk('campaigns/fetchAll', async (_params?: Record<string, unknown>) => {
  const response = await api.get('/campaigns', { params: _params })
  return response.data
})

export const createCampaign = createAsyncThunk('campaigns/create', async (data: Partial<Campaign>) => {
  const response = await api.post('/campaigns', data)
  return response.data
})

const campaignsSlice = createSlice({
  name: 'campaigns',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchCampaigns.pending, (state) => {
        state.loading = true
      })
      .addCase(fetchCampaigns.fulfilled, (state, action) => {
        state.loading = false
        state.items = action.payload.rows || action.payload
        state.total = action.payload.count || action.payload.length
      })
      .addCase(createCampaign.fulfilled, (state, action) => {
        state.items.unshift(action.payload)
        state.total += 1
      })
  },
})

export default campaignsSlice.reducer
