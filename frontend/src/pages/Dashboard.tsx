import React, { useEffect } from 'react'
import { Row, Col, Card, Statistic, Typography, Spin, Alert, Table, Tag, Timeline, Empty } from 'antd'
import {
  MailOutlined,
  UserOutlined,
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

const { Title, Text } = Typography

const COLORS = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1']

// Platform display name mapping
const platformLabels: Record<string, string> = {
  GMAIL: 'Gmail',
  OUTLOOK: 'Outlook',
  QQ: 'QQ邮箱',
  NETEASE_163: '163邮箱',
  CUSTOM_SMTP: '企业邮',
}

const Dashboard: React.FC = () => {
  const dispatch = useAppDispatch()
  const { data: stats, loading, error } = useAppSelector((state) => state.stats)

  useEffect(() => {
    dispatch(fetchStats())
  }, [dispatch])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" tip="加载统计数据..." />
      </div>
    )
  }

  if (error) {
    return <Alert message="数据加载错误" description={error} type="error" showIcon />
  }

  const statCards = [
    {
      title: '已发送邮件',
      value: stats?.totalEmailsSent || 0,
      icon: <SendOutlined style={{ color: '#1890ff' }} />,
      suffix: '封',
    },
    {
      title: '活跃账号',
      value: stats?.totalAccounts || 0,
      icon: <UserOutlined style={{ color: '#52c41a' }} />,
      suffix: '个',
    },
    {
      title: '进行中活动',
      value: stats?.activeCampaigns || 0,
      icon: <MailOutlined style={{ color: '#faad14' }} />,
      suffix: '个',
    },
    {
      title: '打开率',
      value: stats?.openRate || 0,
      icon: <EyeOutlined style={{ color: '#722ed1' }} />,
      prefix: stats?.openRate && stats.openRate > 50 ? <RiseOutlined /> : <FallOutlined />,
      suffix: '%',
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
      <Title level={3} style={{ marginBottom: 24 }}>
        仪表盘概览
      </Title>

      {/* Stat Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statCards.map((card, index) => (
          <Col xs={24} sm={12} lg={6} key={index}>
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {card.icon}
                <div>
                  <Statistic
                    title={card.title}
                    value={card.value}
                    prefix={card.prefix}
                    suffix={card.suffix}
                  />
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Click rate & Bounce rate */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12}>
          <Card>
            <Statistic
              title="点击率"
              value={stats?.clickRate || 0}
              precision={1}
              prefix={<RiseOutlined style={{ color: '#52c41a' }} />}
              suffix="%"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card>
            <Statistic
              title="退信率"
              value={stats?.bounceRate || 0}
              precision={1}
              prefix={<FallOutlined style={{ color: '#f5222d' }} />}
              suffix="%"
              valueStyle={{ color: '#f5222d' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Charts Row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={16}>
          <Card title="每日发送趋势 (近7天)">
            {dailyStats.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="sent"
                    name="发送数"
                    stroke="#1890ff"
                    strokeWidth={2}
                    dot={{ fill: '#1890ff' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="opened"
                    name="打开数"
                    stroke="#52c41a"
                    strokeWidth={2}
                    dot={{ fill: '#52c41a' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无发送数据" style={{ padding: 80 }} />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="平台分布">
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
                    fill="#8884d8"
                    dataKey="count"
                  >
                    {platformData.map((_: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无平台数据" style={{ padding: 80 }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* Bar Chart + Recent Activity */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={24}>
          <Card title="各平台发送量对比">
            {platformData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={platformData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="platform" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" name="发送量" fill="#1890ff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="暂无数据" style={{ padding: 60 }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* Recent Activity Timeline */}
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card
            title="最近活动"
            extra={
              <a onClick={() => dispatch(fetchStats())}>刷新</a>
            }
          >
            {timelineItems.length > 0 ? (
              <Timeline items={timelineItems} />
            ) : (
              <Empty description="暂无活动记录" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Dashboard
