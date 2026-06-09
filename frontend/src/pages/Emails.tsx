import React, { useEffect, useState } from 'react'
import {
  Table, Card, Button, Space, Typography, Tag, Modal, Descriptions,
  message, Input, Select, Tooltip, Popconfirm, Drawer, Empty,
} from 'antd'
import {
  ReloadOutlined, SearchOutlined, EyeOutlined, SendOutlined,
  FilterOutlined,
} from '@ant-design/icons'
import { useAppDispatch, useAppSelector } from '@/store'
import { fetchEmails, resendEmail } from '@/store/slices/emailsSlice'
import { useTranslation } from 'react-i18next'
import useMobile from '@/hooks/useMobile'

const { Title, Text } = Typography

const { Option } = Select

interface EmailDetailModalProps {
  visible: boolean
  record: any
  onClose: () => void
}

const EmailDetailModal: React.FC<EmailDetailModalProps> = ({ visible, record, onClose }) => {
  if (!record) return null
  const { t } = useTranslation()
  const mobile = useMobile()

  const statusColors: Record<string, string> = {
    pending: 'default', sent: 'processing', delivered: 'success',
    bounced: 'warning', failed: 'error',
  }
  const statusLabels: Record<string, string> = {
    pending: t('emails.pending'),
    sent: t('emails.delivered'),
    delivered: t('emails.delivered'),
    bounced: t('emails.bounced'),
    failed: t('emails.failed'),
  }

  return (
    Modal.info({
      title: t('emails.viewDetails'),
      icon: null,
      content: (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="ID">
            <Text copyable>{record.id}</Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('emails.to')}>{record.toAddress}</Descriptions.Item>
          <Descriptions.Item label={t('emails.from')}>{record.fromAddress}</Descriptions.Item>
          <Descriptions.Item label={t('emails.subject')}>{record.subject}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusColors[record.status] || 'default'}>
              {statusLabels[record.status] || record.status}
            </Tag>
          </Descriptions.Item>
          {record.sentAt && (
            <Descriptions.Item label="发送时间">{new Date(record.sentAt).toLocaleString()}</Descriptions.Item>
          )}
          <Descriptions.Item label="创建时间">{new Date(record.createdAt).toLocaleString()}</Descriptions.Item>
          {record.errorMessage && (
            <Descriptions.Item label="错误信息">
              <Text type="danger">{record.errorMessage}</Text>
            </Descriptions.Item>
          )}
        </Descriptions>
      ),
      onOk: onClose,
      okText: '关闭',
      width: mobile.isMobile ? '95%' : 650,
      centered: true,
    })
  )
}

// ============================================
// 移动端邮件卡片列表项
// ============================================

interface EmailCardItemProps {
  record: any
  onView: (record: any) => void
  onResend: (id: string) => void
  resendingId: string | null
}

const EmailCardItem: React.FC<EmailCardItemProps> = ({ record, onView, onResend, resendingId }) => {
  const config: Record<string, { color: string; text: string }> = {
    pending: { color: 'default', text: '待发送' },
    sent: { color: 'processing', text: '发送中' },
    delivered: { color: 'success', text: '已送达' },
    bounced: { color: 'warning', text: '退信' },
    failed: { color: 'error', text: '失败' },
  }
  const c = config[record.status] || config.pending

  return (
    <div className="mobile-card-item" onClick={() => onView(record)}>
      <div className="mobile-card-header">
        <span className="mobile-card-title" style={{ maxWidth: '70%' }}>
          {record.toAddress}
        </span>
        <Tag color={c.color}>{c.text}</Tag>
      </div>
      {record.subject && (
        <div style={{ fontSize: 13, color: 'var(--gr-gray-600)', marginBottom: 6 }}>
          {record.subject.length > 50 ? record.subject.substring(0, 50) + '...' : record.subject}
        </div>
      )}
      <div className="mobile-card-meta">
        <span className="mobile-card-meta-item">
          {record.sentAt ? new Date(record.sentAt).toLocaleDateString() : '-'}
        </span>
      </div>
      <div className="mobile-card-actions mobile-action-buttons">
        <Button size="small" icon={<EyeOutlined />} onClick={(e) => { e?.stopPropagation(); onView(record) }}>
          详情
        </Button>
        {(record.status === 'failed' || record.status === 'bounced') && (
          <Popconfirm
            title="确定要重新发送这封邮件吗？"
            onConfirm={(e) => { e?.stopPropagation(); onResend(record.id) }}
            okText="确定"
            cancelText="取消"
          >
            <Button
              size="small"
              icon={<SendOutlined />}
              loading={resendingId === record.id}
              onClick={(e) => e.stopPropagation()}
              style={{ color: 'var(--gr-primary)', fontWeight: 600 }}
            >
              重发
            </Button>
          </Popconfirm>
        )}
      </div>
    </div>
  )
}

const EmailsPage: React.FC = () => {
  const dispatch = useAppDispatch()
  const { items: emails, loading, total } = useAppSelector((state) => state.emails)
  const [searchParams, setSearchParams] = useState({
    page: 1,
    pageSize: 10,
    status: undefined as string | undefined,
    search: undefined as string | undefined,
  })
  const [detailVisible, setDetailVisible] = useState(false)
  const [selectedEmail, setSelectedEmail] = useState<any>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [filterDrawerVisible, setFilterDrawerVisible] = useState(false)
  const mobile = useMobile()
  const { t } = useTranslation()

  useEffect(() => {
    dispatch(fetchEmails(searchParams))
  }, [dispatch, searchParams])

  const handleResend = async (id: string) => {
    setResendingId(id)
    try {
      await dispatch(resendEmail(id)).unwrap()
      message.success('重发请求已提交')
      dispatch(fetchEmails(searchParams))
    } catch (err: any) {
      message.error(err.message || '重发失败')
    } finally {
      setResendingId(null)
    }
  }

  const columns = [
    {
      title: '收件人',
      dataIndex: 'toAddress',
      key: 'toAddress',
      ellipsis: true,
      render: (text: string) => <a>{text}</a>,
    },
    {
      title: '主题',
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const config: Record<string, { color: string; text: string }> = {
          pending: { color: 'default', text: '待发送' },
          sent: { color: 'processing', text: '发送中' },
          delivered: { color: 'success', text: '已送达' },
          bounced: { color: 'warning', text: '退信' },
          failed: { color: 'error', text: '失败' },
        }
        const c = config[status] || config.pending
        return <Tag color={c.color}>{c.text}</Tag>
      },
    },
    {
      title: '发送时间',
      dataIndex: 'sentAt',
      key: 'sentAt',
      width: 170,
      render: (val: string) => val ? new Date(val).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, record: any) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button
              type="link" size="small"
              icon={<EyeOutlined />}
              onClick={() => { setSelectedEmail(record); setDetailVisible(true) }}
            />
          </Tooltip>
          {(record.status === 'failed' || record.status === 'bounced') && (
            <Popconfirm
              title="确定要重新发送这封邮件吗？"
              onConfirm={() => handleResend(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button
                type="link" size="small" icon={<SendOutlined />}
                loading={resendingId === record.id}
                style={{ color: 'var(--gr-primary)', fontWeight: 600 }}
              >
                重发
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* Page Header */}
      <div className="gr-page-header">
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <SendOutlined style={{ color: 'var(--gr-primary)', fontSize: 20 }} />
          邮件发送记录
        </Title>
        {!mobile.isMobile && (
          <Button icon={<ReloadOutlined />} onClick={() => dispatch(fetchEmails(searchParams))}>
            刷新数据
          </Button>
        )}
      </div>

      <Card>

        {/* 筛选区域 - 移动端使用抽屉 */}
        {mobile.isMobile ? (
          <div style={{ marginBottom: 12 }}>
            <button
              className="mobile-filter-trigger"
              onClick={() => setFilterDrawerVisible(true)}
              type="button"
            >
              <FilterOutlined /> 筛选与搜索
            </button>

            <Drawer
              title="筛选条件"
              placement="bottom"
              height="auto"
              open={filterDrawerVisible}
              onClose={() => setFilterDrawerVisible(false)}
              styles={{ body: { paddingTop: 16 } }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Input placeholder="搜索收件人或主题..." allowClear prefix={<SearchOutlined />} />
                <Select placeholder="状态筛选" allowClear style={{ width: '100%' }}>
                  <Option value="pending">待发送</Option>
                  <Option value="sent">已发送</Option>
                  <Option value="delivered">已送达</Option>
                  <Option value="bounced">退信</Option>
                  <Option value="failed">失败</Option>
                </Select>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button block onClick={() => setFilterDrawerVisible(false)}>取消</Button>
                  <Button type="primary" block icon={<SearchOutlined />}>搜索</Button>
                </div>
              </Space>
            </Drawer>
          </div>
        ) : (
          <Space style={{ marginBottom: 16 }} wrap>
            <Input
              placeholder="搜索收件人或主题..."
              allowClear
              style={{ width: 250 }}
              prefix={<SearchOutlined />}
              onChange={(e) => setSearchParams({ ...searchParams, search: e.target.value || undefined })}
              onPressEnter={() => setSearchParams({ ...searchParams, page: 1 })}
            />
            <Select
              placeholder="筛选状态"
              allowClear
              style={{ width: 140 }}
              onChange={(value) => setSearchParams({ ...searchParams, status: value })}
            >
              <Option value="pending">待发送</Option>
              <Option value="sent">已发送</Option>
              <Option value="delivered">已送达</Option>
              <Option value="bounced">退信</Option>
              <Option value="failed">失败</Option>
            </Select>
            <Button icon={<FilterOutlined />} onClick={() => setSearchParams({ ...searchParams, page: 1 })}>
              筛选
            </Button>
          </Space>
        )}

        {/* 移动端：卡片列表视图；桌面端：表格视图 */}
        {mobile.isMobile ? (
          <div className="mobile-card-list">
            {emails.length === 0 && !loading && (
              <Empty description="暂无邮件记录" style={{ padding: '40px 0' }} />
            )}
            {emails.map((record: any) => (
              <EmailCardItem
                key={record.id}
                record={record}
                onView={(rec) => { setSelectedEmail(rec); setDetailVisible(true) }}
                onResend={handleResend}
                resendingId={resendingId}
              />
            ))}

            {/* 移动端刷新按钮 */}
            <Button
              type="primary"
              shape="circle"
              icon={<ReloadOutlined />}
              className="fab-button"
              onClick={() => dispatch(fetchEmails(searchParams))}
              style={{ bottom: 84 }}
            />

            {total > 10 && (
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>共 {total} 条记录</Text>
              </div>
            )}
          </div>
        ) : (
          <Table
            columns={columns}
            dataSource={emails}
            rowKey="id"
            loading={loading}
            pagination={{
              current: searchParams.page,
              pageSize: searchParams.pageSize,
              total,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 条记录`,
              onChange: (page, pageSize) =>
                setSearchParams({ ...searchParams, page, pageSize }),
            }}
            size="middle"
          />
        )}
      </Card>

      {/* 邮件详情弹窗 - 移动端全屏化 */}
      <EmailDetailModal
        visible={detailVisible}
        record={selectedEmail}
        onClose={() => { setDetailVisible(false); setSelectedEmail(null) }}
      />
    </div>
  )
}

export default EmailsPage
