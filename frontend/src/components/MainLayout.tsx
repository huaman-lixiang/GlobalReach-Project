import React, { useState } from 'react'
import { Layout, Menu, Avatar, Dropdown, Typography, Space, theme, Badge, Tag } from 'antd'
import {
  DashboardOutlined,
  MailOutlined,
  TeamOutlined,
  BarChartOutlined,
  SettingOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SendOutlined,
  BellOutlined,
  GlobalOutlined,
  ApartmentOutlined,
} from '@ant-design/icons'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '@/store'
import { logoutUser } from '@/store/slices/authSlice'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher'
import MobileNav from './MobileNav'
import useMobile from '@/hooks/useMobile'

const { Header, Sider, Content } = Layout
const { Text } = Typography

const MainLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAppSelector((state) => state.auth)
  const { t } = useTranslation()
  const mobile = useMobile()

  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken()

  // 移动端强制不显示侧边栏
  const isMobileMode = mobile.isMobile
  const isTabletMode = mobile.isTablet

  // 平板端默认折叠侧边栏
  const effectiveCollapsed = isMobileMode ? true : (isTabletMode ? true : collapsed)

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: t('common.dashboard'),
    },
    {
      key: '/accounts',
      icon: <TeamOutlined />,
      label: t('common.accounts'),
    },
    {
      key: '/campaigns',
      icon: <MailOutlined />,
      label: t('common.campaigns'),
    },
    {
      key: '/emails',
      icon: <SendOutlined />,
      label: t('common.emails'),
    },
    {
      key: '/reports',
      icon: <BarChartOutlined />,
      label: t('common.reports'),
    },
    {
      key: '/tenant-admin',
      icon: <ApartmentOutlined />,
      label: '租户管理',
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: t('common.settings'),
    },
  ]

  const userMenuItems = [
    {
      key: 'profile',
      icon: <SettingOutlined />,
      label: t('settings.profile'),
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('auth.logout'),
      danger: true,
    },
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      dispatch(logoutUser())
      navigate('/login')
    } else if (key === 'profile') {
      navigate('/settings')
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 侧边栏 - 桌面端/平板端显示，移动端隐藏 */}
      {!isMobileMode && (
        <Sider
          trigger={null}
          collapsible
          collapsed={effectiveCollapsed}
          width={250}
          collapsedWidth={isTabletMode ? 0 : 80}
          className={`desktop-sidebar ${isTabletMode ? 'tablet-collapsible-sider' : ''}`}
          style={{
            background: 'linear-gradient(180deg, #111827 0%, #1e293b 100%)',
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 100,
            overflow: 'auto',
            overflowX: 'hidden',
          }}
        >
          {/* Logo Area */}
          <div
            style={{
              height: 64,
              display: 'flex',
              alignItems: 'center',
              justifyContent: effectiveCollapsed ? 'center' : 'flex-start',
              padding: effectiveCollapsed ? '0' : '0 20px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #1a56db 0%, #7c3aed 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 4px 12px rgba(26, 86, 219, 0.4)',
              }}
            >
              <GlobalOutlined style={{ color: '#fff', fontSize: 18 }} />
            </div>
            {!effectiveCollapsed && (
              <div style={{ marginLeft: 12 }}>
                <Text
                  strong
                  style={{ color: '#fff', fontSize: 16, letterSpacing: '-0.02em', display: 'block', lineHeight: 1.2 }}
                >
                  GlobalReach
                </Text>
                <Text
                  style={{
                    color: 'rgba(255,255,255,0.45)',
                    fontSize: 11,
                    fontWeight: 500,
                    display: 'block',
                    lineHeight: 1.2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  Enterprise V2.0
                </Text>
              </div>
            )}
          </div>

          {/* Navigation Menu */}
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{
              background: 'transparent',
              border: 'none',
              marginTop: 12,
            }}
          />

          {/* Bottom section - version info */}
          {!effectiveCollapsed && (
            <div
              style={{
                position: 'absolute',
                bottom: 20,
                left: 20,
                right: 20,
              }}
            >
              <Tag
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  borderColor: 'rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 6,
                  display: 'block',
                  textAlign: 'center',
                  cursor: 'default',
                }}
              >
                v2.0 Enterprise Edition
              </Tag>
            </div>
          )}
        </Sider>
      )}

      {/* 主内容区域 */}
      <Layout
        style={{
          marginLeft: isMobileMode ? 0 : (effectiveCollapsed && !isTabletMode ? 80 : (isTabletMode ? 0 : 250)),
          transition: 'margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          minHeight: '100vh',
        }}
      >
        {/* 顶部 Header */}
        <Header
          style={{
            padding: isMobileMode ? '0 12px' : '0 28px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--gr-gray-200)',
            position: 'sticky',
            top: 0,
            zIndex: 99,
            height: 64,
          }}
          className={isMobileMode ? 'mobile-simplified-header' : ''}
        >
          <Space size={16}>
            {/* 桌面端：折叠按钮 */}
            {!isMobileMode && (
              <span className="sidebar-toggle-btn">
                {React.createElement(effectiveCollapsed ? MenuUnfoldOutlined : MenuFoldOutlined, {
                  className: 'trigger',
                  onClick: () => setCollapsed(!collapsed),
                  style: {
                    fontSize: 18,
                    cursor: 'pointer',
                    color: 'var(--gr-gray-600)',
                    transition: 'color 0.15s',
                    padding: '8px',
                    borderRadius: 8,
                  },
                  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
                    ;(e.currentTarget as HTMLElement).style.background = 'var(--gr-gray-100)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--gr-primary)'
                  },
                  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
                    ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--gr-gray-600)'
                  },
                })}
              </span>
            )}
            {/* 移动端：菜单按钮（可扩展为 Drawer 导航） */}
            {isMobileMode && (
              <MenuOutlined
                style={{
                  fontSize: 20,
                  cursor: 'pointer',
                  color: 'var(--gr-gray-600)',
                  padding: '8px',
                }}
                onClick={() => {
                  // 可扩展：打开抽屉式导航菜单
                }}
              />
            )}
          </Space>

          <Space size={isMobileMode ? 12 : 20} align="center">
            {/* S130/N01: 租户切换器（超级管理员可见） */}
            {user?.role === 'ADMIN' && !isMobileMode && (
              <Dropdown
                menu={{
                  items: [
                    { key: 'default', label: '默认租户 (ID: 1)' },
                    { type: 'divider' as const },
                    { key: 'manage', label: '管理所有租户', icon: <ApartmentOutlined /> },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'manage') {
                      navigate('/tenant-admin')
                    }
                  },
                }}
                placement="bottomRight"
              >
                <Tag
                  style={{
                    cursor: 'pointer',
                    padding: '4px 12px',
                    borderRadius: 12,
                    background: 'var(--gr-primary-bg, #f0f5ff)',
                    borderColor: 'var(--gr-primary-light, #adc6ff)',
                    color: 'var(--gr-primary, #1677ff)',
                    transition: 'all 0.15s',
                  }}
                >
                  <ApartmentOutlined style={{ marginRight: 4 }} />
                  默认租户
                </Tag>
              </Dropdown>
            )}

            {/* 语言切换器 - 移动端保留 */}
            <LanguageSwitcher />

            {/* 通知铃铛 - 桌面端显示 */}
            {!isMobileMode && (
              <Badge count={0} size="small">
                <BellOutlined
                  style={{
                    fontSize: 18,
                    cursor: 'pointer',
                    color: 'var(--gr-gray-500)',
                    transition: 'color 0.15s',
                  }}
                />
              </Badge>
            )}

            {/* 分隔线 - 桌面端显示 */}
            {!isMobileMode && (
              <div
                style={{
                  width: 1,
                  height: 28,
                  background: 'var(--gr-gray-200)',
                }}
              />
            )}

            {/* 用户信息区域 */}
            <Dropdown menu={{ items: userMenuItems, onClick: handleMenuClick }} placement="bottomRight" trigger={['click']}>
              <Space
                style={{
                  cursor: 'pointer',
                  padding: isMobileMode ? '4px 8px' : '6px 12px',
                  borderRadius: 10,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gr-gray-50)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <Avatar
                  size={isMobileMode ? 30 : 34}
                  icon={<TeamOutlined />}
                  style={{
                    background: 'linear-gradient(135deg, #1a56db 0%, #7c3aed 100%)',
                    flexShrink: 0,
                  }}
                />
                {/* 移动端隐藏用户名和邮箱 */}
                {!isMobileMode && (
                  <div style={{ lineHeight: 1.3 }}>
                    <Text strong style={{ fontSize: 13, display: 'block' }}>
                      {user?.name || t('auth.name')}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: 'var(--gr-gray-400)',
                        display: 'block',
                        maxWidth: 140,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {user?.email || ''}
                    </Text>
                  </div>
                )}
              </Space>
            </Dropdown>
          </Space>
        </Header>

        {/* 页面内容区 */}
        <Content
          style={{
            margin: isMobileMode ? 12 : 24,
            minHeight: `calc(100vh - 64px - ${isMobileMode ? 24 : 48}px)`,
            padding: isMobileMode ? 14 : 24,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            overflow: 'auto',
          }}
          className={`${isMobileMode ? 'mobile-content-area has-mobile-nav' : ''}`}
        >
          <Outlet />
        </Content>

        {/* 移动端底部导航栏 */}
        {isMobileMode && <MobileNav />}
      </Layout>
    </Layout>
  )
}

export default MainLayout
