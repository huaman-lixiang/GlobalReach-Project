import { describe, it, expect, beforeEach } from 'vitest'
import statsReducer, { fetchStats } from '@/store/slices/statsSlice'

const mockStatsData = {
  totalEmailsSent: 12500,
  totalAccounts: 25,
  activeCampaigns: 8,
  openRate: 45.2,
  clickRate: 12.8,
  bounceRate: 2.1,
  emailsByPlatform: [
    { platform: 'Gmail', count: 4500 },
    { platform: 'Outlook', count: 3200 },
    { platform: 'QQ邮箱', count: 2100 },
  ],
  dailyStats: [
    { date: '06-01', sent: 500, opened: 250 },
    { date: '06-02', sent: 600, opened: 300 },
  ],
}

const initialState = {
  data: null,
  loading: false,
  error: null,
}

describe('statsSlice', () => {
  it('should return initial state', () => {
    const state = statsReducer(undefined, { type: 'unknown' })
    expect(state).toEqual(initialState)
  })

  it('handles fetchStats.pending', () => {
    const state = statsReducer(initialState, { type: fetchStats.pending.type })
    expect(state.loading).toBe(true)
  })

  it('handles fetchStats.fulfilled', () => {
    const state = statsReducer(initialState, {
      type: fetchStats.fulfilled.type,
      payload: mockStatsData,
    })

    expect(state.loading).toBe(false)
    expect(state.data).toEqual(mockStatsData)
    expect(state.data?.totalEmailsSent).toBe(12500)
    expect(state.data?.openRate).toBe(45.2)
  })

  it('handles fetchStats.rejected', () => {
    const state = statsReducer(initialState, {
      type: fetchStats.rejected.type,
      error: { message: 'Stats fetch failed' },
    })

    expect(state.loading).toBe(false)
    expect(state.error).toBe('Stats fetch failed')
    expect(state.data).toBeNull()
  })

  it('preserves existing data on pending', () => {
    const loadedState = { ...initialState, data: mockStatsData }
    const state = statsReducer(loadedState, { type: fetchStats.pending.type })
    expect(state.data).toEqual(mockStatsData)
    expect(state.loading).toBe(true)
  })
})
