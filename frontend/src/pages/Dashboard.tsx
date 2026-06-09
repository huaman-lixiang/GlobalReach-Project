import React, { useEffect } from 'react'
import { Row, Col, Card, Statistic, Typography, Spin, Alert, Table, Tag, Timeline, Empty } from 'antd'
import {
  MailOutlined,
  TeamOutlined,
  SendOutlined,
  EyeOutlined,
  RiseOutlined,
  FallOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts'
import { useAppDispatch, useAppSelector } from '@/store'
import { fetchStats } from '@/store/slices/statsSlice'
import { useTranslation } from 'react-i18next'

const { Title, Text } = Typography

const COLORS = ['#1a56db', '#0d9488', '#f59e0b', '#dc2626', '#7c3aed']

// Platform display name mapping
const platformLabels: Record<string, string> = {
  GMAIL: t('accounts.gmail'),
  OUTLOOK: t('accounts.outlook'),
  QQ: t('accounts.qq'),
  NETEASE_163: t('accounts.163'),
  CUSTOM_SMTP: t('accounts.custom'),
}

const Dashboard: React.FC = () => {
  const dispatch = useAppDispatch()
  const { data: stats, loading, error } = useAppSelector((state) => state.stats)
  const { t } = useTranslation()

  useEffect(() => {
    dispatch(fetchStats())
  }, [dispatch])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" tip={t('common.loading')} />
      </div>
    )
  }

  if (error) {
    return <Alert message={t('errors.internalServerError')} description={error} type="error" showIcon />
  }

  const statCards = [
    {
      title: t('dashboard.totalEmails'),
      value: stats?.totalEmailsSent || 0,
      icon: <SendOutlined style={{ color: 'var(--gr-primary)', fontSize: 22 }} />,
      suffix: '封',
      cardClass: 'primary',
    },
    {
      title: t('dashboard.totalAccounts'),
      value: stats?.totalAccounts || 0,
      icon: <TeamOutlined style={{ color: 'var(--gr-success)', fontSize: 22 }} />,
      suffix: '个',
      cardClass: 'success',
    },
    {
      title: t('dashboard.activeCampaigns'),
      value: stats?.activeCampaigns || 0,
      icon: <MailOutlined style={{ color: 'var(--gr-warning)', fontSize: 22 }} />,
      suffix: '个',
      cardClass: 'warning',
    },
    {
      title: t('dashboard.openRate'),
      value: stats?.openRate || 0,
      icon: <EyeOutlined style={{ color: '#7c3aed', fontSize: 22 }} />,
      prefix: stats?.openRate && stats.openRate > 50 ? <RiseOutlined /> : <FallOutlined />,
      suffix: '%',
      cardClass: '',
    },
  ]

  // Use real data or fallback
  const platformData = (stats?.emailsByPlatform || []).map((p: any) => ({
    platform: platformLabels[p.platform] || p.platform,
    count: p.count || 0,
  }))

  const dailyStats = stats?.dailyStats || []

  // Recent activity data
  const recentActivity = stats?.recentActivity || []

  // Activity timeline items
  const timelineItems = recentActivity.slice(0, 8).map((item: any) => {
    const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
      sent: { color: 'green', icon: <CheckCircleOutlined /> },
      delivered: { color: 'green', icon: <CheckCircleOutlined /> },
      pending: { color: 'blue', icon: <ClockCircleOutlined /> },
      failed: { color: 'red', icon: <CloseCircleOutlined /> },
      bounced: { color: 'orange', icon: <CloseCircleOutlined /> },
    }
    const cfg = statusConfig[item.status] || statusConfig.pending
    return {
      color: cfg.color,
      children: (
        <div>
          <Text strong>{item.subject || '(无主题)'}</Text>
          <br />
          <Text type="secondary">
            → {item.toAddress} | <Tag>{item.status}</Tag>
            {item.campaignName && ` | ${item.campaignName}`}
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
          </Text>
        </div>
      ),
    }
  })

  return (
    <div>
      {/* Page Header */}
      <div className="gr-page-header">
        <Title level={3}>
          <SendOutlined style={{ color: 'var(--gr-primary)' }} />
          仪表盘概览
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          实时数据 · 自动刷新
        </Text>
      </div>

      {/* Stat Cards */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        {statCards.map((card, index) => (
          <Col xs={24} sm={12} lg={6} key={index}>
            <Card className={`gr-stat-card ${card.cardClass}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background:
                      card.cardClass === 'primary' ? 'var(--gr-primary-bg)' :
                      card.cardClass === 'success' ? 'var(--gr-success-bg)' :
                      card.cardClass === 'warning' ? 'var(--gr-warning-bg)' :
                      'var(--gr-gray-100)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {card.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Statistic
                    title={card.title}
                    value={card.value}
                    prefix={card.prefix}
                    suffix={card.suffix}
                    valueStyle={{
                      fontSize: 26,
                      fontWeight: 800,
                      color: 'var(--gr-gray-900)',
                    }}
                  />
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Click rate & Bounce rate */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12}>
          <Card className="gr-stat-card success">
            <Statistic
              title="点击率"
              value={stats?.clickRate || 0}
              precision={1}
              prefix={<RiseOutlined style={{ color: 'var(--gr-success)', fontSize: 18 }} />}
              suffix="%"
              valueStyle={{ color: 'var(--gr-success)', fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card className="gr-stat-card error">
            <Statistic
              title="退信率"
              value={stats?.bounceRate || 0}
              precision={1}
              prefix={<FallOutlined style={{ color: 'var(--gr-error)', fontSize: 18 }} />}
              suffix="%"
              valueStyle={{ color: 'var(--gr-error)', fontWeight: 700 }}
            />
          </Card>
        </Col>
      </Row>

      {/* Charts Row */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={16}>
          <Card title={
            <span>
              <BarChartOutlined style={{ marginRight: 8, color: 'var(--gr-primary)' }} />
              {t('dashboard.recentCampaigns')}
            </span>
          }>
            {dailyStats.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gr-gray-200)" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--gr-gray-500)' }} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--gr-gray-500)' }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid var(--gr-gray-200)',
                      boxShadow: 'var(--gr-shadow-md)',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="sent"
                    name="发送数"
                    stroke="#1a56db"
                    strokeWidth={2.5}
                    dot={{ fill: '#1a56db', r: 4 }}
                    activeDot={{ r: 6, stroke: '#1a56db', strokeWidth: 2 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="opened"
                    name="打开数"
                    stroke="#0d9488"
                    strokeWidth={2.5}
                    dot={{ fill: '#0d9488', r: 4 }}
                    activeDot={{ r: 6, stroke: '#0d9488', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty description={t('dashboard.noData')} style={{ padding: 80 }} />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title={
            <span>
              <PieChartOutlined style={{ marginRight: 8, color: 'var(--gr-success)' }} />
              {t('reports.platformBreakdown')}
            </span>
          }>
            {platformData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={platformData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ platform, percent }: any) =>
                      `${platform} ${(percent * 100).toFixed(0)}%`
                    }
                    outerRadius={120}
                    innerRadius={60}
                    fill="#8884d8"
                    dataKey="count"
                    paddingAngle={2}
                  >
                    {platformData.map((_: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid var(--gr-gray-200)',
                      boxShadow: 'var(--gr-shadow-md)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无平台数据" style={{ padding: 80 }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* Bar Chart + Recent Activity */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        <Col span={24}>
          <Card title={
            <span>
              <BarChartOutlined style={{ marginRight: 8, color: 'var(--gr-warning)' }} />
              各平台发送量对比
            </span>
          }>
            {platformData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={platformData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gr-gray-200)" />
                  <XAxis dataKey="platform" tick={{ fontSize: 13, fill: 'var(--gr-gray-600)', fontWeight: 600 }} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--gr-gray-500)' }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid var(--gr-gray-200)',
                      boxShadow: 'var(--gr-shadow-md)',
                    }}
                  />
                  <Bar dataKey="count" name="发送量" fill="#1a56db" radius={[6, 6, 0, 0]} maxBarSize={50} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description={t('common.noRecords')} style={{ padding: 60 }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* Recent Activity Timeline */}
      <Row gutter={[20, 20]}>
        <Col span={24}>
          <Card
            title={
              <span>
                <ClockCircleOutlined style={{ marginRight: 8, color: 'var(--gr-primary)' }} />
                {t('dashboard.recentCampaigns')}
              </span>
            }
            extra={
              <a onClick={() => dispatch(fetchStats())} style={{ fontWeight: 600, color: 'var(--gr-primary)' }}>
                {t('common.refresh')}
              </a>
            }
          >
            {timelineItems.length > 0 ? (
              <Timeline items={timelineItems} />
            ) : (
              <Empty description={t('dashboard.noData')} />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}

// Import chart icons for card titles
import { BarChartOutlined, PieChartOutlined } from '@ant-design/icons'

export default Dashboard
