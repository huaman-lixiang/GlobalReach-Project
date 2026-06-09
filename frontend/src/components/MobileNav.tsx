import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  DashboardOutlined,
  MailOutlined,
  SendOutlined,
  BarChartOutlined,
  SettingOutlined,
} from '@ant-design/icons'

/**
 * MobileNav - 底部标签导航组件
 * 仅在移动端显示（isMobile 为 true 时渲染）
 * 包含 5 个 Tab：首页 / 营销 / 邮件 / 报表 / 设置
 */

interface NavItem {
  key: string
  icon: React.ReactNode
  labelKey: string  // i18n key
}

const navItems: NavItem[] = [
  { key: '/dashboard', icon: <DashboardOutlined />, labelKey: 'common.dashboard' },
  { key: '/campaigns', icon: <MailOutlined />, labelKey: 'common.campaigns' },
  { key: '/emails', icon: <SendOutlined />, labelKey: 'common.emails' },
  { key: '/reports', icon: <BarChartOutlined />, labelKey: 'common.reports' },
  { key: '/settings', icon: <SettingOutlined />, labelKey: 'common.settings' },
]

// 简化的中文标签（fallback）
const fallbackLabels: Record<string, string> = {
  '/dashboard': '首页',
  '/campaigns': '营销',
  '/emails': '邮件',
  '/reports': '报表',
  '/settings': '设置',
}

interface MobileNavProps {
  /** 自定义标签文本覆盖 */
  labels?: Record<string, string>
}

const MobileNav: React.FC<MobileNavProps> = ({ labels }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const currentPath = location.pathname

  // 匹配当前路由（支持子路径匹配）
  const isActive = (path: string) => {
    if (path === currentPath) return true
    // /accounts 在移动端归入设置区域，不单独显示 Tab
    return false
  }

  const handleNavClick = (key: string) => {
    navigate(key)
  }

  return (
    <nav className="mobile-nav-bar" role="navigation" aria-label="主导航">
      {navItems.map((item) => {
        const active = isActive(item.key)
        const label = labels?.[item.key] || fallbackLabels[item.key] || item.labelKey

        return (
          <button
            key={item.key}
            className={`mobile-nav-item${active ? ' active' : ''}`}
            onClick={() => handleNavClick(item.key)}
            aria-current={active ? 'page' : undefined}
            type="button"
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

export default MobileNav
