import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import Login from '@/pages/Login'
import { store } from '@/store'

const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <Provider store={store}>
      <BrowserRouter>
        {component}
      </BrowserRouter>
    </Provider>
  )
}

describe('Login Page', () => {
  it('renders login form correctly', () => {
    renderWithProviders(<Login />)
    
    expect(screen.getByText('🚀 GlobalReach V2.0')).toBeInTheDocument()
    expect(screen.getByText('企业级邮件营销平台')).toBeInTheDocument()
    expect(screen.getByLabelText(/邮箱地址/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/密码/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /登录/i })).toBeInTheDocument()
  })

  it('shows email input field with correct placeholder', () => {
    renderWithProviders(<Login />)
    
    const emailInput = screen.getByPlaceholderText('邮箱地址')
    expect(emailInput).toBeInTheDocument()
  })

  it('shows password input field', () => {
    renderWithProviders(<Login />)
    
    const passwordInput = screen.getByPlaceholderText('密码')
    expect(passwordInput).toBeInTheDocument()
    expect(passwordInput).toHaveAttribute('type', 'password')
  })

  it('displays register link', () => {
    renderWithProviders(<Login />)
    
    const registerLink = screen.getByText('立即注册')
    expect(registerLink).toBeInTheDocument()
    expect(registerLink.closest('a')).toHaveAttribute('href', '/register')
  })

  it('has submit button', () => {
    renderWithProviders(<Login />)
    
    const submitButton = screen.getByRole('button', { name: /登录/i })
    expect(submitButton).toBeInTheDocument()
    expect(submitButton).toHaveAttribute('type', 'submit')
  })

  it('renders within a card component', () => {
    const { container } = renderWithProviders(<Login />)
    
    const card = container.querySelector('.ant-card')
    expect(card).toBeInTheDocument()
  })

  it('displays title and subtitle', () => {
    renderWithProviders(<Login />)
    
    expect(screen.getByText('GlobalReach V2.0')).toBeInTheDocument()
    expect(screen.getByText('企业级邮件营销平台')).toBeInTheDocument()
  })
})
