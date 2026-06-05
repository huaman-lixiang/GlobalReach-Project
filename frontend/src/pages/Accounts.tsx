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
} from '@ant-design/icons'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  fetchAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} from '@/store/slices/accountsSlice'
import api from '@/services/api'

const { Title } = Typography
const { Option } = Select
const { TextArea } = Input

// Platform config: backend values → display names
const PLATFORM_OPTIONS = [
  { value: 'GMAIL', label: 'Gmail', color: '#ea4335' },
  { value: 'OUTLOOK', label: 'Outlook', color: '#0078d4' },
  { value: 'QQ', label: 'QQ邮箱', color: '#12b7f5' },
  { value: 'NETEASE_163', label: '163邮箱', color: '#f60' },
  { value: 'CUSTOM_SMTP', label: '企业自定义SMTP', color: '#722ed1' },
]

// Platform-specific form fields (shown when creating/editing)
const PLATFORM_EXTRA_FIELDS: Record<string, { imapHost?: string; smtpHost?: string; imapPort?: number; smtpPort?: number }> = {
  GMAIL: { imapHost: 'imap.gmail.com', smtpHost: 'smtp.gmail.com', imapPort: 993, smtpPort: 587 },
  OUTLOOK: { imapHost: 'outlook.office365.com', smtpHost: 'smtp.office365.com', imapPort: 993, smtpPort: 587 },
  QQ: { imapHost: 'imap.qq.com', smtpHost: 'smtp.qq.com', imapPort: 993, smtpPort: 465 },
  NETEASE_163: { imapHost: 'imap.163.com', smtpHost: 'smtp.163.com', imapPort: 993, smtpPort: 465 },
}

const statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
  ACTIVE: { color: 'success', text: '正常', icon: <CheckCircleOutlined /> },
  INACTIVE: { color: 'default', text: '停用', icon: <PauseCircleOutlined /> },
  RESTRICTED: { color: 'warning', text: '受限', icon: <CloseCircleOutlined /> },
  BANNED: { color: 'error', text: '封禁', icon: <CloseCircleOutlined /> },
  ERROR: { color: 'error', text: '异常', icon: <CloseCircleOutlined /> },
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
      message.success('删除成功')
      dispatch(fetchAccounts(searchParams))
    } catch (error) {
      message.error('删除失败')
    }
  }

  const handleTestConnection = async (id: string) => {
    setTestingId(id)
    try {
      const res: any = await api.post(`/accounts/${id}/test-connection`)
      const data = res.data || res
      if (data.connected) {
        message.success(`连接成功! 延迟: ${data.latencyMs || '?'}ms`)
      } else {
        message.warning(`连接失败: ${data.reason || '未知错误'}`)
      }
    } catch (err: any) {
      message.error(err.message || '测试连接失败')
    } finally {
      setTestingId(null)
    }
  }

  const handleActivate = async (id: string) => {
    try {
      await api.post(`/accounts/${id}/activate`)
      message.success('账号已激活')
      dispatch(fetchAccounts(searchParams))
    } catch (err: any) {
      message.error(err.message || '激活失败')
    }
  }

  const handleDeactivate = async (id: string) => {
    try {
      await api.post(`/accounts/${id}/deactivate`)
      message.success('账号已停用')
      dispatch(fetchAccounts(searchParams))
    } catch (err: any) {
      message.error(err.message || '停用失败')
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingAccount) {
        await dispatch(updateAccount({ id: editingAccount.id, ...values })).unwrap()
        message.success('更新成功')
      } else {
        await dispatch(createAccount(values)).unwrap()
        message.success('创建成功')
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
      title: '邮箱地址',
      dataIndex: 'email',
      key: 'email',
      render: (text: string) => <a>{text}</a>,
    },
    {
      title: '平台类型',
      dataIndex: 'platform',
      key: 'platform',
      render: (platform: string) => {
        const opt = PLATFORM_OPTIONS.find(o => o.value === platform)
        return <Tag color={opt?.color || 'default'}>{opt?.label || platform}</Tag>
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const cfg = statusConfig[status] || statusConfig.ERROR
        return <Tag color={cfg.color} icon={cfg.icon}>{cfg.text}</Tag>
      },
    },
    {
      title: '健康度',
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
      title: '今日发送',
      dataIndex: 'sentToday',
      key: 'sentToday',
      width: 90,
      render: (val: number) => val || 0,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (val: string) => val ? new Date(val).toLocaleDateString() : '-',
      sorter: (a: any, b: any) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      title: '操作',
      key: 'action',
      width: 320,
      render: (_: any, record: any) => (
        <Space size="small" wrap>
          <Tooltip title="测试连接">
            <Button
              type="link" size="small"
              icon={<ApiOutlined />}
              loading={testingId === record.id}
              onClick={() => handleTestConnection(record.id)}
            />
          </Tooltip>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          {record.status !== 'ACTIVE' ? (
            <Button
              type="link" size="small" icon={<PlayCircleOutlined />}
              style={{ color: '#52c41a' }}
              onClick={() => handleActivate(record.id)}
            >
              激活
            </Button>
          ) : (
            <Button
              type="link" size="small" icon={<PauseCircleOutlined />}
              onClick={() => handleDeactivate(record.id)}
            >
              停用
            </Button>
          )}
          <Popconfirm
            title="确定要删除这个账号吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Card>
        <Title level={4} style={{ marginBottom: 16 }}>
          账号管理中心
        </Title>

        {/* Engine Health Summary */}
        {healthData && (
          <div style={{
            background: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: 8,
            padding: '12px 20px',
            marginBottom: 16,
            display: 'flex',
            gap: 24,
            alignItems: 'center',
          }}>
            <Badge status="success" text={`引擎状态: ${healthData.engineStatus || 'ONLINE'}`} />
            <span>注册账号: <strong>{healthData.totalRegistered || accounts.length}</strong></span>
            <span>活跃账号: <strong>{healthData.activeCount || accounts.filter((a: any) => a.status === 'ACTIVE').length}</strong></span>
            <span>平均健康度: <strong>{healthData.avgHealthScore || '-'}</strong></span>
            <Button size="small" icon={<ReloadOutlined />} onClick={loadHealthStatus}>
              刷新状态
            </Button>
          </div>
        )}

        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            placeholder="筛选平台"
            allowClear
            style={{ width: 160 }}
            onChange={(value) => setSearchParams({ ...searchParams, platform: value })}
          >
            {PLATFORM_OPTIONS.map(opt => (
              <Option key={opt.value} value={opt.value}>{opt.label}</Option>
            ))}
          </Select>

          <Select
            placeholder="筛选状态"
            allowClear
            style={{ width: 130 }}
            onChange={(value) => setSearchParams({ ...searchParams, status: value })}
          >
            <Option value="ACTIVE">正常</Option>
            <Option value="INACTIVE">停用</Option>
            <Option value="ERROR">异常</Option>
            <Option value="RESTRICTED">受限</Option>
          </Select>

          <Button icon={<SearchOutlined />} onClick={() => setSearchParams({ ...searchParams, page: 1 })}>
            搜索
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => dispatch(fetchAccounts(searchParams))}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            新增账号
          </Button>
        </Space>

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
            showTotal: (total) => `共 ${total} 条记录`,
            onChange: (page, pageSize) =>
              setSearchParams({ ...searchParams, page, pageSize }),
          }}
          size="middle"
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        title={editingAccount ? '编辑账号' : '新增邮箱账号'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={650}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="email"
            label="邮箱地址"
            rules={[
              { required: true, message: '请输入邮箱地址' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
          >
            <Input placeholder="example@gmail.com" />
          </Form.Item>

          <Form.Item
            name="platform"
            label="平台类型"
            rules={[{ required: true, message: '请选择平台类型' }]}
          >
            <Select placeholder="选择平台">
              {PLATFORM_OPTIONS.map(opt => (
                <Option key={opt.value} value={opt.value}>{opt.label}</Option>
              ))}
            </Select>
          </Form.Item>

          {!editingAccount && (
            <>
              <Form.Item name="password" label="密码/应用专用密码"
                rules={[{ required: true, message: '请输入密码或应用专用密码' }]}
              >
                <Input.Password placeholder="对于Gmail请使用应用专用密码" />
              </Form.Item>

              <Form.Item name="encryptionType" label="加密方式" initialValue="SSL">
                <Select>
                  <Option value="SSL">SSL/TLS</Option>
                  <Option value="STARTTLS">STARTTLS</Option>
                  <Option value="NONE">无加密(不推荐)</Option>
                </Select>
              </Form.Item>
            </>
          )}

          {editingAccount && (
            <Form.Item name="status" label="状态" initialValue="ACTIVE">
              <Select>
                <Option value="ACTIVE">正常</Option>
                <Option value="INACTIVE">停用</Option>
                <Option value="RESTRICTED">受限</Option>
              </Select>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}

export default AccountsPage
