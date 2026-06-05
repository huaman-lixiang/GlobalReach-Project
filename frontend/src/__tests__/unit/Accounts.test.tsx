import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import Accounts from '@/pages/Accounts'
import { store } from '@/store'

vi.mock('@/store', async () => {
  const actual = await vi.importActual('@/store')
  return {
    ...actual,
    useAppSelector: vi.fn(),
    useAppDispatch: vi.fn(() => vi.fn()),
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

const mockAccounts = [
  { id: '1', email: 'test@gmail.com', platform: 'gmail', status: 'active', createdAt: '2026-06-01' },
  { id: '2', email: 'test@outlook.com', platform: 'outlook', status: 'inactive', createdAt: '2026-06-02' },
]

const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <Provider store={store}>
      <BrowserRouter>
        {component}
      </BrowserRouter>
    </Provider>
  )
}

describe('Accounts Page', () => {
  beforeEach(() => {
    vi.mocked(require('@/store').useAppSelector).mockImplementation((selector: any) => {
      if (selector.toString().includes('accounts')) {
        return { items: mockAccounts, loading: false, total: 2, error: null }
      }
      return {}
    })
  })

  it('renders accounts page title', () => {
    renderWithProviders(<Accounts />)
    expect(screen.getByText('👥 账号管理中心')).toBeInTheDocument()
  })

  it('displays add account button', () => {
    renderWithProviders(<Accounts />)
    expect(screen.getByRole('button', { name: /新增账号/i })).toBeInTheDocument()
  })

  it('shows refresh button', () => {
    renderWithProviders(<Accounts />)
    expect(screen.getByRole('button', { name: /刷新/i })).toBeInTheDocument()
  })

  it('displays search button', () => {
    renderWithProviders(<Accounts />)
    expect(screen.getByRole('button', { name: /搜索/i })).toBeInTheDocument()
  })

  it('renders table with account data', () => {
    renderWithProviders(<Accounts />)
    
    expect(screen.getByText('test@gmail.com')).toBeInTheDocument()
    expect(screen.getByText('test@outlook.com')).toBeInTheDocument()
  })

  it('shows platform filters', () => {
    renderWithProviders(<Accounts />)
    
    expect(screen.getByText('Gmail')).toBeInTheDocument()
    expect(screen.getByText('Outlook')).toBeInTheDocument()
  })

  it('shows status filters', () => {
    renderWithProviders(<Accounts />)
    
    expect(screen.getByText('正常')).toBeInTheDocument()
    expect(screen.getByText('停用')).toBeInTheDocument()
  })

  it('displays edit buttons for each account', () => {
    renderWithProviders(<Accounts />)
    
    const editButtons = screen.getAllByRole('button', { name: /编辑/i })
    expect(editButtons).toHaveLength(2)
  })

  it('displays delete buttons for each account', () => {
    renderWithProviders(<Accounts />)
    
    const deleteButtons = screen.getAllByRole('button', { name: /删除/i })
    expect(deleteButtons).toHaveLength(2)
  })
})
