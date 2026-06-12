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
import { emailsTexts } from '../i18n/emails'

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
          <Descriptions.Item label={emailsTexts.detail.id}>
            <Text copyable>{record.id}</Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('emails.to')}>{record.toAddress}</Descriptions.Item>
          <Descriptions.Item label={t('emails.from')}>{record.fromAddress}</Descriptions.Item>
          <Descriptions.Item label={t('emails.subject')}>{record.subject}</Descriptions.Item>
          <Descriptions.Item label={t('emails.status')}>
            <Tag color={statusColors[record.status] || 'default'}>
              {statusLabels[record.status] || record.status}
            </Tag>
          </Descriptions.Item>
          {record.sentAt && (
            <Descriptions.Item label={emailsTexts.detail.sentTime}>{new Date(record.sentAt).toLocaleString()}</Descriptions.Item>
          )}
          <Descriptions.Item label={emailsTexts.detail.createdAt}>{new Date(record.createdAt).toLocaleString()}</Descriptions.Item>
          {record.errorMessage && (
            <Descriptions.Item label={emailsTexts.detail.errorMessage}>
              <Text type="danger">{record.errorMessage}</Text>
            </Descriptions.Item>
          )}
        </Descriptions>
      ),
      onOk: onClose,
      okText: emailsTexts.messages.close,
      width: mobile.isMobile ? '95%' : 650,
      centered: true,
    })
  )
}

// ============================================
// Mobile email card list item
// ============================================

interface EmailCardItemProps {
  record: any
  onView: (record: any) => void
  onResend: (id: string) => void
  resendingId: string | null
}

const EmailCardItem: React.FC<EmailCardItemProps> = ({ record, onView, onResend, resendingId }) => {
  const config: Record<string, { color: string; text: string }> = {
    pending: { color: 'default', text: emailsTexts.status.pending },
    sent: { color: 'processing', text: emailsTexts.status.sending },
    delivered: { color: 'success', text: emailsTexts.status.delivered },
    bounced: { color: 'warning', text: emailsTexts.status.bounced },
    failed: { color: 'error', text: emailsTexts.status.failed },
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
          {emailsTexts.actions.details}
        </Button>
        {(record.status === 'failed' || record.status === 'bounced') && (
          <Popconfirm
            title={emailsTexts.actions.resendConfirm}
            onConfirm={(e) => { e?.stopPropagation(); onResend(record.id) }}
            okText={emailsTexts.actions.resendOk}
            cancelText={emailsTexts.actions.resendCancel}
          >
            <Button
              size="small"
              icon={<SendOutlined />}
              loading={resendingId === record.id}
              onClick={(e) => e.stopPropagation()}
              style={{ color: 'var(--gr-primary)', fontWeight: 600 }}
            >
              {emailsTexts.actions.resend}
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
      message.success(emailsTexts.messages.resendSubmitted)
      dispatch(fetchEmails(searchParams))
    } catch (err: any) {
      message.error(err.message || emailsTexts.messages.resendFailed)
    } finally {
      setResendingId(null)
    }
  }

  const columns = [
    {
      title: emailsTexts.table.recipient,
      dataIndex: 'toAddress',
      key: 'toAddress',
      ellipsis: true,
      render: (text: string) => <a>{text}</a>,
    },
    {
      title: emailsTexts.table.subject,
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
    },
    {
      title: emailsTexts.table.status,
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const config: Record<string, { color: string; text: string }> = {
          pending: { color: 'default', text: emailsTexts.status.pending },
          sent: { color: 'processing', text: emailsTexts.status.sending },
          delivered: { color: 'success', text: emailsTexts.status.delivered },
          bounced: { color: 'warning', text: emailsTexts.status.bounced },
          failed: { color: 'error', text: emailsTexts.status.failed },
        }
        const c = config[status] || config.pending
        return <Tag color={c.color}>{c.text}</Tag>
      },
    },
    {
      title: emailsTexts.table.sentAt,
      dataIndex: 'sentAt',
      key: 'sentAt',
      width: 170,
      render: (val: string) => val ? new Date(val).toLocaleString() : '-',
    },
    {
      title: emailsTexts.table.actions,
      key: 'action',
      width: 180,
      render: (_: any, record: any) => (
        <Space size="small">
          <Tooltip title={emailsTexts.actions.viewDetails}>
            <Button
              type="link" size="small"
              icon={<EyeOutlined />}
              onClick={() => { setSelectedEmail(record); setDetailVisible(true) }}
            />
          </Tooltip>
          {(record.status === 'failed' || record.status === 'bounced') && (
            <Popconfirm
              title={emailsTexts.actions.resendConfirm}
              onConfirm={() => handleResend(record.id)}
              okText={emailsTexts.actions.resendOk}
              cancelText={emailsTexts.actions.resendCancel}
            >
              <Button
                type="link" size="small" icon={<SendOutlined />}
                loading={resendingId === record.id}
                style={{ color: 'var(--gr-primary)', fontWeight: 600 }}
              >
                {emailsTexts.actions.resend}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <BrandedPageWrapper>
    <div>
      {/* Page Header */}
      <div className="gr-page-header">
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <SendOutlined style={{ color: 'var(--gr-primary)', fontSize: 20 }} />
          {emailsTexts.page.title}
        </Title>
        {!mobile.isMobile && (
          <Button icon={<ReloadOutlined />} onClick={() => dispatch(fetchEmails(searchParams))}>
            {emailsTexts.page.refreshData}
          </Button>
        )}
      </div>

      <Card>

        {/* Filter area - mobile uses drawer */}
        {mobile.isMobile ? (
          <div style={{ marginBottom: 12 }}>
            <button
              className="mobile-filter-trigger"
              onClick={() => setFilterDrawerVisible(true)}
              type="button"
            >
              <FilterOutlined /> {emailsTexts.filter.filterAndSearch}
            </button>

            <Drawer
              title={emailsTexts.filter.drawerTitle}
              placement="bottom"
              height="auto"
              open={filterDrawerVisible}
              onClose={() => setFilterDrawerVisible(false)}
              styles={{ body: { paddingTop: 16 } }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Input placeholder={emailsTexts.filter.searchPlaceholder} allowClear prefix={<SearchOutlined />} />
                <Select placeholder={emailsTexts.filter.statusPlaceholder} allowClear style={{ width: '100%' }}>
                  <Option value="pending">{emailsTexts.status.pending}</Option>
                  <Option value="sent">{emailsTexts.status.sending}</Option>
                  <Option value="delivered">{emailsTexts.status.delivered}</Option>
                  <Option value="bounced">{emailsTexts.status.bounced}</Option>
                  <Option value="failed">{emailsTexts.status.failed}</Option>
                </Select>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button block onClick={() => setFilterDrawerVisible(false)}>{emailsTexts.filter.cancel}</Button>
                  <Button type="primary" block icon={<SearchOutlined />}>{emailsTexts.filter.search}</Button>
                </div>
              </Space>
            </Drawer>
          </div>
        ) : (
          <Space style={{ marginBottom: 16 }} wrap>
            <Input
              placeholder={emailsTexts.filter.searchPlaceholder}
              allowClear
              style={{ width: 250 }}
              prefix={<SearchOutlined />}
              onChange={(e) => setSearchParams({ ...searchParams, search: e.target.value || undefined })}
              onPressEnter={() => setSearchParams({ ...searchParams, page: 1 })}
            />
            <Select
              placeholder={emailsTexts.filter.statusPlaceholder}
              allowClear
              style={{ width: 140 }}
              onChange={(value) => setSearchParams({ ...searchParams, status: value })}
            >
              <Option value="pending">{emailsTexts.status.pending}</Option>
              <Option value="sent">{emailsTexts.status.sending}</Option>
              <Option value="delivered">{emailsTexts.status.delivered}</Option>
              <Option value="bounced">{emailsTexts.status.bounced}</Option>
              <Option value="failed">{emailsTexts.status.failed}</Option>
            </Select>
            <Button icon={<FilterOutlined />} onClick={() => setSearchParams({ ...searchParams, page: 1 })}>
              {emailsTexts.filter.filterBtn}
            </Button>
          </Space>
        )}

        {/* Mobile: card list view; Desktop: table view */}
        {mobile.isMobile ? (
          <div className="mobile-card-list">
            {emails.length === 0 && !loading && (
              <Empty description={emailsTexts.empty.noRecords} style={{ padding: '40px 0' }} />
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

            {/* Mobile refresh button (FAB) */}
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
                <Text type="secondary" style={{ fontSize: 12 }}>{emailsTexts.table.totalRecords(total)}</Text>
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
              showTotal: (total) => emailsTexts.table.totalRecords(total),
              onChange: (page, pageSize) =>
                setSearchParams({ ...searchParams, page, pageSize }),
            }}
            size="middle"
          />
        )}
      </Card>

      {/* Email detail modal - fullscreen on mobile */}
      <EmailDetailModal
        visible={detailVisible}
        record={selectedEmail}
        onClose={() => { setDetailVisible(false); setSelectedEmail(null) }}
      />
    </div>
    </BrandedPageWrapper>
  )
}

export default EmailsPage
