import { describe, it, expect, beforeEach } from 'vitest'
import campaignsReducer, { fetchCampaigns, createCampaign } from '@/store/slices/campaignsSlice'

const mockCampaign = {
  id: '1',
  name: 'Test Campaign',
  subject: 'Test Subject',
  status: 'draft' as const,
  sentCount: 0,
  totalCount: 100,
}

const initialState = {
  items: [],
  loading: false,
  error: null,
  total: 0,
}

describe('campaignsSlice', () => {
  it('should return initial state', () => {
    const state = campaignsReducer(undefined, { type: 'unknown' })
    expect(state).toEqual(initialState)
  })

  it('handles fetchCampaigns.pending', () => {
    const state = campaignsReducer(initialState, { type: fetchCampaigns.pending.type })
    expect(state.loading).toBe(true)
  })

  it('handles fetchCampaigns.fulfilled with rows', () => {
    const mockData = {
      rows: [mockCampaign],
      count: 1,
    }

    const state = campaignsReducer(initialState, {
      type: fetchCampaigns.fulfilled.type,
      payload: mockData,
    })

    expect(state.loading).toBe(false)
    expect(state.items).toEqual([mockCampaign])
    expect(state.total).toBe(1)
  })

  it('handles createCampaign.fulfilled', () => {
    const newCampaign = { 
      id: '2', 
      name: 'New Campaign', 
      subject: 'New Subject',
      status: 'draft' as const,
      sentCount: 0,
      totalCount: 200,
    }
    const existingState = { ...initialState, items: [mockCampaign], total: 1 }

    const state = campaignsReducer(existingState, {
      type: createCampaign.fulfilled.type,
      payload: newCampaign,
    })

    expect(state.items).toHaveLength(2)
    expect(state.items[0]).toEqual(newCampaign)
    expect(state.total).toBe(2)
  })

  it('handles fetchCampaigns.rejected', () => {
    const state = campaignsReducer(initialState, {
      type: fetchCampaigns.rejected.type,
      error: { message: 'Failed to fetch' },
    })

    expect(state.loading).toBe(false)
    expect(state.error).toBe('Failed to fetch')
  })
})
