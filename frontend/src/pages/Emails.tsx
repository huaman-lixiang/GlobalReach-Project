import React, { useEffect, useState } from 'react'
import {
  Table, Card, Button, Space, Typography, Tag, Modal, Descriptions,
  message, Input, Select, Tooltip, Popconfirm,
} from 'antd'
import {
  ReloadOutlined, SearchOutlined, EyeOutlined, SendOutlined,
  FilterOutlined,
} from '@ant-design/icons'
import { useAppDispatch, useAppSelector } from '@/store'
import { fetchEmails, resendEmail } from '@/store/slices/emailsSlice'

const { Title, Text } = Typography

const { Option } = Select

interface EmailDetailModalProps {
  visible: boolean
  record: any
  onClose: () => void
}

const EmailDetailModal: React.FC<EmailDetailModalProps> = ({ visible, record, onClose }) => {
  if (!record) return null

  const statusColors: Record<string, string> = {
    pending: 'default', sent: 'processing', delivered: 'success',
    bounced: 'warning', failed: 'error',
  }
  const statusLabels: Record<string, string> = {
    pending: '待发送', sent: '已发送', delivered: '已送达',
    bounced: '退信', failed: '失败',
  }

  return (
    <Modal title="邮件详情" open={visible} onCancel={onClose} footer={null} width={650}>
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="邮件ID">
          <Text copyable>{record.id}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="收件人">{record.toAddress}</Descriptions.Item>
        <Descriptions.Item label="发件人">{record.fromAddress}</Descriptions.Item>
        <Descriptions.Item label="主题">{record.subject}</Descriptions.Item>
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
    </Modal>
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
                style={{ color: '#1890ff' }}
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
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>
            📨 邮件发送记录
          </Title>
          <Button icon={<ReloadOutlined />} onClick={() => dispatch(fetchEmails(searchParams))}>
            刷新
          </Button>
        </div>

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
      </Card>

      <EmailDetailModal
        visible={detailVisible}
        record={selectedEmail}
        onClose={() => { setDetailVisible(false); setSelectedEmail(null) }}
      />
    </div>
  )
}

export default EmailsPage
