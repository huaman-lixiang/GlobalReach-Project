import React, { useEffect, useState } from 'react'
import {
  Table,
  Card,
  Button,
  Space,
  Typography,
  Modal,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Tag,
  Tooltip,
  Badge,
  Descriptions,
  Progress,
  Tabs,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  DashboardOutlined,
  TeamOutlined,
  FilterOutlined,
} from '@ant-design/icons'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  fetchAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} from '@/store/slices/accountsSlice'
import api from '@/services/api'
import useMobile from '@/hooks/useMobile'
import { accountsTexts } from '../i18n/accounts'

const { Title } = Typography
const { Option } = Select
const { TextArea } = Input

// Platform config: backend values → display names
const PLATFORM_OPTIONS = [
  { value: 'GMAIL', label: accountsTexts.platforms.gmail, color: '#ea4335' },
  { value: 'OUTLOOK', label: accountsTexts.platforms.outlook, color: '#0078d4' },
  { value: 'QQ', label: accountsTexts.platforms.qq, color: '#12b7f5' },
  { value: 'NETEASE_163', label: accountsTexts.platforms.netease163, color: '#f60' },
  { value: 'CUSTOM_SMTP', label: accountsTexts.platforms.customSmtp, color: '#722ed1' },
]

// Platform-specific form fields (shown when creating/editing)
const PLATFORM_EXTRA_FIELDS: Record<string, { imapHost?: string; smtpHost?: string; imapPort?: number; smtpPort?: number }> = {
  GMAIL: { imapHost: 'imap.gmail.com', smtpHost: 'smtp.gmail.com', imapPort: 993, smtpPort: 587 },
  OUTLOOK: { imapHost: 'outlook.office365.com', smtpHost: 'smtp.office365.com', imapPort: 993, smtpPort: 587 },
  QQ: { imapHost: 'imap.qq.com', smtpHost: 'smtp.qq.com', imapPort: 993, smtpPort: 465 },
  NETEASE_163: { imapHost: 'imap.163.com', smtpHost: 'smtp.163.com', imapPort: 993, smtpPort: 465 },
}

const statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
  ACTIVE: { color: 'success', text: accountsTexts.status.active, icon: <CheckCircleOutlined /> },
  INACTIVE: { color: 'default', text: accountsTexts.status.inactive, icon: <PauseCircleOutlined /> },
  RESTRICTED: { color: 'warning', text: accountsTexts.status.restricted, icon: <CloseCircleOutlined /> },
  BANNED: { color: 'error', text: accountsTexts.status.banned, icon: <CloseCircleOutlined /> },
  ERROR: { color: 'error', text: accountsTexts.status.error, icon: <CloseCircleOutlined /> },
}

const AccountsPage: React.FC = () => {
  const dispatch = useAppDispatch()
  const { items: accounts, loading, total } = useAppSelector((state) => state.accounts)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingAccount, setEditingAccount] = useState<any>(null)
  const [form] = Form.useForm()
  const [searchParams, setSearchParams] = useState({
    page: 1,
    pageSize: 10,
    platform: undefined as string | undefined,
    status: undefined as string | undefined,
  })
  const [testingId, setTestingId] = useState<string | null>(null)
  const [healthData, setHealthData] = useState<any>(null)
  const mobile = useMobile()

  useEffect(() => {
    dispatch(fetchAccounts(searchParams))
    loadHealthStatus()
  }, [dispatch, searchParams])

  const loadHealthStatus = async () => {
    try {
      const res: any = await api.get('/accounts/health')
      setHealthData(res.data || res)
    } catch (_) {
      // Health check is optional
    }
  }

  const handleAdd = () => {
    setEditingAccount(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (record: any) => {
    setEditingAccount(record)
    form.setFieldsValue({
      email: record.email,
      platform: record.platform,
      status: record.status,
    })
    setModalVisible(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await dispatch(deleteAccount(id)).unwrap()
      message.success(accountsTexts.messages.deleteSuccess)
      dispatch(fetchAccounts(searchParams))
    } catch (error) {
      message.error(accountsTexts.messages.deleteFailed)
    }
  }

  const handleTestConnection = async (id: string) => {
    setTestingId(id)
    try {
      const res: any = await api.post(`/accounts/${id}/test-connection`)
      const data = res.data || res
      if (data.connected) {
        message.success(accountsTexts.messages.connectionSuccess(String(data.latencyMs || '?')))
      } else {
        message.warning(accountsTexts.messages.connectionFailed(data.reason || ''))
      }
    } catch (err: any) {
      message.error(err.message || accountsTexts.messages.testConnectionFailed)
    } finally {
      setTestingId(null)
    }
  }

  const handleActivate = async (id: string) => {
    try {
      await api.post(`/accounts/${id}/activate`)
      message.success(accountsTexts.messages.activated)
      dispatch(fetchAccounts(searchParams))
    } catch (err: any) {
      message.error(err.message || accountsTexts.messages.activateFailed)
    }
  }

  const handleDeactivate = async (id: string) => {
    try {
      await api.post(`/accounts/${id}/deactivate`)
      message.success(accountsTexts.messages.deactivated)
      dispatch(fetchAccounts(searchParams))
    } catch (err: any) {
      message.error(err.message || accountsTexts.messages.deactivateFailed)
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingAccount) {
        await dispatch(updateAccount({ id: editingAccount.id, ...values })).unwrap()
        message.success(accountsTexts.messages.updateSuccess)
      } else {
        await dispatch(createAccount(values)).unwrap()
        message.success(accountsTexts.messages.createSuccess)
      }
      setModalVisible(false)
      form.resetFields()
      dispatch(fetchAccounts(searchParams))
    } catch (error) {
      console.error('Submit error:', error)
    }
  }

  const columns = [
    {
      title: accountsTexts.table.email,
      dataIndex: 'email',
      key: 'email',
      render: (text: string) => <a>{text}</a>,
    },
    {
      title: accountsTexts.table.platform,
      dataIndex: 'platform',
      key: 'platform',
      render: (platform: string) => {
        const opt = PLATFORM_OPTIONS.find(o => o.value === platform)
        return <Tag color={opt?.color || 'default'}>{opt?.label || platform}</Tag>
      },
    },
    {
      title: accountsTexts.table.status,
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const cfg = statusConfig[status] || statusConfig.ERROR
        return <Tag color={cfg.color} icon={cfg.icon}>{cfg.text}</Tag>
      },
    },
    {
      title: accountsTexts.table.health,
      dataIndex: 'healthScore',
      key: 'healthScore',
      width: 120,
      render: (score: number) => (
        <Progress
          percent={score || 0}
          size="small"
          status={score >= 80 ? 'success' : score >= 50 ? 'normal' : 'exception'}
          format={(p) => `${p}`}
        />
      ),
    },
    {
      title: accountsTexts.table.sentToday,
      dataIndex: 'sentToday',
      key: 'sentToday',
      width: 90,
      render: (val: number) => val || 0,
    },
    {
      title: accountsTexts.table.createdAt,
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (val: string) => val ? new Date(val).toLocaleDateString() : '-',
      sorter: (a: any, b: any) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      title: accountsTexts.table.actions,
      key: 'action',
      width: 320,
      render: (_: any, record: any) => (
        <Space size="small" wrap>
          <Tooltip title={accountsTexts.actions.testConnection}>
            <Button
              type="link" size="small"
              icon={<ApiOutlined />}
              loading={testingId === record.id}
              onClick={() => handleTestConnection(record.id)}
            />
          </Tooltip>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            {accountsTexts.actions.edit}
          </Button>
          {record.status !== 'ACTIVE' ? (
            <Button
              type="link" size="small" icon={<PlayCircleOutlined />}
              style={{ color: 'var(--gr-success)', fontWeight: 600 }}
              onClick={() => handleActivate(record.id)}
            >
              {accountsTexts.actions.activate}
            </Button>
          ) : (
            <Button
              type="link" size="small" icon={<PauseCircleOutlined />}
              onClick={() => handleDeactivate(record.id)}
            >
              {accountsTexts.actions.deactivate}
            </Button>
          )}
          <Popconfirm
            title={accountsTexts.actions.deleteConfirm}
            onConfirm={() => handleDelete(record.id)}
            okText={accountsTexts.actions.deleteOk}
            cancelText={accountsTexts.actions.deleteCancel}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              {accountsTexts.actions.delete}
            </Button>
          </Popconfirm>
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
          <TeamOutlined style={{ color: 'var(--gr-primary)', fontSize: 20 }} />
          {accountsTexts.page.title}
        </Title>
      </div>

      <Card>

        {/* Engine health summary - mobile simplified */}
        {healthData && (
          <div style={{
            background: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: 8,
            padding: mobile.isMobile ? '10px 14px' : '12px 20px',
            marginBottom: 16,
            display: mobile.isMobile ? 'grid' : 'flex',
            gap: mobile.isMobile ? 8 : 24,
            alignItems: 'center',
            gridTemplateColumns: mobile.isMobile ? '1fr 1fr' : undefined,
          }}>
            <Badge status="success" text={`${accountsTexts.health.engineStatus} ${healthData.engineStatus || 'ONLINE'}`} />
            <span>{accountsTexts.health.registeredAccounts} <strong>{healthData.totalRegistered || accounts.length}</strong></span>
            {!mobile.isMobile && (
              <>
                <span>{accountsTexts.health.activeAccounts} <strong>{healthData.activeCount || accounts.filter((a: any) => a.status === 'ACTIVE').length}</strong></span>
                <span>{accountsTexts.health.avgHealthScore} <strong>{healthData.avgHealthScore || '-'}</strong></span>
              </>
            )}
            <Button size="small" icon={<ReloadOutlined />} onClick={loadHealthStatus}>
              {accountsTexts.health.refresh}
            </Button>
          </div>
        )}

        {/* Filter area - mobile uses drawer */}
        {mobile.isMobile ? (
          <div style={{ marginBottom: 12 }}>
            <button className="mobile-filter-trigger" type="button">
              <FilterOutlined /> {accountsTexts.filter.filterAndSearch}
            </button>
          </div>
        ) : (
          <Space>
            <Select
              placeholder={accountsTexts.filter.platformPlaceholder}
              allowClear
              style={{ width: 160 }}
              onChange={(value) => setSearchParams({ ...searchParams, platform: value })}
            >
              {PLATFORM_OPTIONS.map(opt => (
                <Option key={opt.value} value={opt.value}>{opt.label}</Option>
              ))}
            </Select>

            <Select
              placeholder={accountsTexts.filter.statusPlaceholder}
              allowClear
              style={{ width: 130 }}
              onChange={(value) => setSearchParams({ ...searchParams, status: value })}
            >
              <Option value="ACTIVE">{accountsTexts.status.active}</Option>
              <Option value="INACTIVE">{accountsTexts.status.inactive}</Option>
              <Option value="ERROR">{accountsTexts.status.error}</Option>
              <Option value="RESTRICTED">{accountsTexts.status.restricted}</Option>
            </Select>

            <Button icon={<SearchOutlined />} onClick={() => setSearchParams({ ...searchParams, page: 1 })}>
              {accountsTexts.filter.search}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => dispatch(fetchAccounts(searchParams))}>
              {accountsTexts.filter.refresh}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              {accountsTexts.filter.newAccount}
            </Button>
          </Space>
        )}

        <Table
          columns={columns}
          dataSource={accounts}
          rowKey="id"
          loading={loading}
          pagination={{
            current: searchParams.page,
            pageSize: searchParams.pageSize,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => accountsTexts.table.totalRecords(total),
            onChange: (page, pageSize) =>
              setSearchParams({ ...searchParams, page, pageSize }),
          }}
          size="middle"
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        title={editingAccount ? accountsTexts.modal.editTitle : accountsTexts.modal.createTitle}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={650}
        okText={accountsTexts.modal.save}
        cancelText={accountsTexts.modal.cancel}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="email"
            label={accountsTexts.modal.emailLabel}
            rules={[
              { required: true, message: accountsTexts.modal.emailRequired },
              { type: 'email', message: accountsTexts.modal.emailInvalid },
            ]}
          >
            <Input placeholder={accountsTexts.modal.emailPlaceholder} />
          </Form.Item>

          <Form.Item
            name="platform"
            label={accountsTexts.modal.platformLabel}
            rules={[{ required: true, message: accountsTexts.modal.platformRequired }]}
          >
            <Select placeholder={accountsTexts.modal.platformPlaceholder}>
              {PLATFORM_OPTIONS.map(opt => (
                <Option key={opt.value} value={opt.value}>{opt.label}</Option>
              ))}
            </Select>
          </Form.Item>

          {!editingAccount && (
            <>
              <Form.Item name="password" label={accountsTexts.modal.passwordLabel}
                rules={[{ required: true, message: accountsTexts.modal.passwordRequired }]}
              >
                <Input.Password placeholder={accountsTexts.modal.passwordPlaceholder} />
              </Form.Item>

              <Form.Item name="encryptionType" label={accountsTexts.modal.encryptionLabel} initialValue="SSL">
                <Select>
                  <Option value="SSL">{accountsTexts.modal.ssl}</Option>
                  <Option value="STARTTLS">{accountsTexts.modal.starttls}</Option>
                  <Option value="NONE">{accountsTexts.modal.none}</Option>
                </Select>
              </Form.Item>
            </>
          )}

          {editingAccount && (
            <Form.Item name="status" label={accountsTexts.modal.statusLabel} initialValue="ACTIVE">
              <Select>
                <Option value="ACTIVE">{accountsTexts.status.active}</Option>
                <Option value="INACTIVE">{accountsTexts.status.inactive}</Option>
                <Option value="RESTRICTED">{accountsTexts.status.restricted}</Option>
              </Select>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
    </BrandedPageWrapper>
  )
}

export default AccountsPage
