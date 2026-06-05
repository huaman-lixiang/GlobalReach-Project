import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import Dashboard from '@/pages/Dashboard'
import { store } from '@/store'

vi.mock('@/store', async () => {
  const actual = await vi.importActual('@/store')
  return {
    ...actual,
    useAppSelector: vi.fn(),
    useAppDispatch: vi.fn(),
  }
})

vi.mock('@/services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

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
  ],
  dailyStats: [
    { date: '06-01', sent: 500, opened: 250 },
    { date: '06-02', sent: 600, opened: 300 },
  ],
}

const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <Provider store={store}>
      <BrowserRouter>
        {component}
      </BrowserRouter>
    </Provider>
  )
}

describe('Dashboard Page', () => {
  beforeEach(() => {
    vi.mocked(require('@/store').useAppSelector).mockImplementation((selector: any) => {
      if (selector.toString().includes('stats')) {
        return { data: mockStatsData, loading: false, error: null }
      }
      return {}
    })
  })

  it('renders dashboard title', () => {
    renderWithProviders(<Dashboard />)
    expect(screen.getByText('📊 仪表盘概览')).toBeInTheDocument()
  })

  it('displays statistics cards', () => {
    renderWithProviders(<Dashboard />)
    
    expect(screen.getByText('已发送邮件')).toBeInTheDocument()
    expect(screen.getByText('活跃账号')).toBeInTheDocument()
    expect(screen.getByText('进行中活动')).toBeInTheDocument()
    expect(screen.getByText('打开率')).toBeInTheDocument()
  })

  it('shows email sent statistic', () => {
    renderWithProviders(<Dashboard />)
    expect(screen.getByText('12500')).toBeInTheDocument()
  })

  it('shows accounts count', () => {
    renderWithProviders(<Dashboard />)
    expect(screen.getByText('25')).toBeInTheDocument()
  })

  it('shows active campaigns count', () => {
    renderWithProviders(<Dashboard />)
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('displays chart sections', () => {
    renderWithProviders(<Dashboard />)
    
    expect(screen.getByText('每日发送趋势 (近7天)')).toBeInTheDocument()
    expect(screen.getByText('平台分布')).toBeInTheDocument()
    expect(screen.getByText('各平台发送量对比')).toBeInTheDocument()
  })
})
