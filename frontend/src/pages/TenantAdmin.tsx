import React, { useEffect, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  message,
  Popconfirm,
  Statistic,
  Row,
  Col,
  Descriptions,
  Tabs,
  Progress,
  Switch,
  InputNumber,
  Divider,
  Tooltip,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  BankOutlined,
  TeamOutlined,
  MailOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  ApartmentOutlined,
} from '@ant-design/icons'
import api from '@/services/api'
import { useTranslation } from 'react-i18next'

const { Title, Text } = Typography
const { Option } = Select
const { TextArea } = Input

// ============================================
// 类型定义
// ============================================

interface Tenant {
  id: number
  name: string
  slug: string
  domain: string | null
  plan: 'basic' | 'professional' | 'enterprise'
  quota: TenantQuota
  status: 'active' | 'suspended' | 'terminated'
  createdAt: string
  updatedAt: string
}

interface TenantQuota {
  maxUsers: number
  maxClients: number
  maxEmailAccounts: number
  maxEmailsPerDay: number
  maxEmailsPerMonth: number
  maxActiveCampaigns: number
  maxStorageMB: number
  apiRateLimit: number
  features: {
    customDomain: boolean
    webhook: boolean
    analytics: boolean
    export: boolean
    sso: boolean
  }
}

interface UsageStats {
  usersCount: number
  clientsCount: number
  accountsCount: number
  campaignsActive: number
  emailsThisMonth: number
}

// ============================================
// 常量配置
// ============================================

const planConfig: Record<string, { color: string; label: string }> = {
  basic: { color: 'default', label: '基础版' },
  professional: { color: 'blue', label: '专业版' },
  enterprise: { color: 'gold', label: '企业版' },
}

const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  active: { color: 'success', icon: <CheckCircleOutlined />, label: '正常' },
  suspended: { color: 'warning', icon: <WarningOutlined />, label: '已暂停' },
  terminated: { color: 'error', icon: <CloseCircleOutlined />, label: '已终止' },
}

// ============================================
// 创建/编辑租户弹窗
// ============================================

interface TenantFormModalProps {
  visible: boolean
  editingTenant: Tenant | null
  onClose: () => void
  onSuccess: () => void
}

const TenantFormModal: React.FC<TenantFormModalProps> = ({
  visible,
  editingTenant,
  onClose,
  onSuccess,
}) => {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const isEdit = !!editingTenant

  useEffect(() => {
    if (visible) {
      if (editingTenant) {
        form.setFieldsValue({
          name: editingTenant.name,
          slug: editingTenant.slug,
          domain: editingTenant.domain || '',
          plan: editingTenant.plan,
          status: editingTenant.status,
        })
      } else {
        form.resetFields()
      }
    }
  }, [visible, editingTenant, form])

  const handleSubmit = async () => {
    try {
      setSubmitting(true)
      const values = await form.validateFields()

      if (isEdit) {
        await api.put(`/tenants/${editingTenant.id}`, values)
        message.success('租户更新成功')
      } else {
        await api.post('/tenants', values)
        message.success('租户创建成功')
      }

      form.resetFields()
      onClose()
      onSuccess()
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={isEdit ? `编辑租户: ${editingTenant.name}` : '创建新租户'}
      open={visible}
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText={isEdit ? '保存' : '创建'}
      cancelText="取消"
      width={600}
      destroyOnClose
    >
      <Form form={form} layout="vertical" size="large" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label="租户名称"
              rules={[{ required: true, message: '请输入租户名称' }, { min: 2, max: 100, message: '长度 2-100 个字符' }]}
            >
              <Input placeholder="例如：Acme Corporation" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="slug"
              label="标识符 (Slug)"
              rules={[
                { required: true, message: '请输入标识符' },
                { pattern: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/, message: '只允许小写字母、数字、连字符' },
              ]}
            >
              <Input placeholder="例如：acme-corp" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="domain" label="自定义域名（可选）">
              <Input placeholder="例如：acme.example.com" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="plan"
              label="套餐计划"
              rules={[{ required: true, message: '请选择套餐' }]}
              initialValue="basic"
            >
              <Select placeholder="选择套餐">
                {Object.entries(planConfig).map(([key, cfg]) => (
                  <Option key={key} value={key}>{cfg.label}</Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>

        {isEdit && (
          <Form.Item
            name="status"
            label="状态"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select placeholder="选择状态">
              <Option value="active">正常</Option>
              <Option value="suspended">已暂停</Option>
              <Option value="terminated">已终止</Option>
            </Select>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

// ============================================
// 配额设置弹窗
// ============================================

interface QuotaModalProps {
  visible: boolean
  tenant: Tenant | null
  usage: UsageStats | null
  onClose: () => void
  onSuccess: () => void
}

const QuotaModal: React.FC<QuotaModalProps> = ({ visible, tenant, usage, onClose, onSuccess }) => {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (visible && tenant) {
      form.setFieldsValue(tenant.quota || {})
    }
  }, [visible, tenant, form])

  const handleSubmit = async () => {
    try {
      setSubmitting(true)
      const values = await form.validateFields()
      await api.put(`/tenants/${tenant!.id}/quota`, values)
      message.success('配额更新成功')
      onClose()
      onSuccess()
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const getPercent = (used: number, limit: number) =>
    limit > 0 ? Math.round((used / limit) * 100) : 0

  const getPercentColor = (percent: number) => {
    if (percent >= 90) return '#ff4d4f'
    if (percent >= 70) return '#faad14' return '#52c41a'
  }

  if (!tenant) return null

  const q = tenant.quota || {}

  return (
    <Modal
      title={`配额管理 - ${tenant.name}`}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
    >
      <Tabs
        defaultActiveKey="view"
        items={[
          {
            key: 'view',
            label: '用量概览',
            children: (
              <div style={{ padding: '16px 0' }}>
                <Row gutter={[16, 16]}>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic title="用户数" value={usage?.usersCount || 0} suffix={`/ ${q.maxUsers}`} />
                      <Progress
                        percent={getPercent(usage?.usersCount || 0, q.maxUsers)}
                        strokeColor={getPercentColor(getPercent(usage?.usersCount || 0, q.maxUsers))}
                        size="small"
                        style={{ marginTop: 8 }}
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic title="客户数" value={usage?.clientsCount || 0} suffix={`/ ${q.maxClients}`} />
                      <Progress
                        percent={getPercent(usage?.clientsCount || 0, q.maxClients)}
                        strokeColor={getPercentColor(getPercent(usage?.clientsCount || 0, q.maxClients))}
                        size="small"
                        style={{ marginTop: 8 }}
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic title="邮箱账号" value={usage?.accountsCount || 0} suffix={`/ ${q.maxEmailAccounts}`} />
                      <Progress
                        percent={getPercent(usage?.accountsCount || 0, q.maxEmailAccounts)}
                        strokeColor={getPercentColor(getPercent(usage?.accountsCount || 0, q.maxEmailAccounts))}
                        size="small"
                        style={{ marginTop: 8 }}
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic title="活跃活动" value={usage?.campaignsActive || 0} suffix={`/ ${q.maxActiveCampaigns}`} />
                      <Progress
                        percent={getPercent(usage?.campaignsActive || 0, q.maxActiveCampaigns)}
                        strokeColor={getPercentColor(getPercent(usage?.campaignsActive || 0, q.maxActiveCampaigns))}
                        size="small"
                        style={{ marginTop: 8 }}
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic title="本月邮件" value={usage?.emailsThisMonth || 0} suffix={`/ ${q.maxEmailsPerMonth}`} />
                      <Progress
                        percent={getPercent(usage?.emailsThisMonth || 0, q.maxEmailsPerMonth)}
                        strokeColor={getPercentColor(getPercent(usage?.emailsThisMonth || 0, q.maxEmailsPerMonth))}
                        size="small"
                        style={{ marginTop: 8 }}
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic title="每日限额" value={q.maxEmailsPerDay} suffix="/ 天" />
                      <Text type="secondary" style={{ fontSize: 12 }}>每日发送量上限</Text>
                    </Card>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'edit',
            label: '修改配额',
            children: (
              <Form form={form} layout="vertical" style={{ padding: '16px 0' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="maxUsers" label="最大用户数">
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxClients" label="最大客户数">
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxEmailAccounts" label="最大邮箱账号">
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxEmailsPerDay" label="每日发送上限">
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxEmailsPerMonth" label="每月发送上限">
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxActiveCampaigns" label="最大活动数">
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxStorageMB" label="存储空间 (MB)">
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="apiRateLimit" label="API 速率限制 (请求/分)">
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider>功能开关</Divider>

                <Form.Item name={['features', 'customDomain']} label="自定义域名" valuePropName="checked">
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>
                <Form.Item name={['features', 'webhook']} label="Webhook 集成" valuePropName="checked">
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>
                <Form.Item name={['features', 'analytics']} label="高级分析" valuePropName="checked">
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>
                <Form.Item name={['features', 'export']} label="数据导出" valuePropName="checked">
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>
                <Form.Item name={['features', 'sso']} label="单点登录 (SSO)" valuePropName="checked">
                  <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                </Form.Item>

                <Button type="primary" onClick={handleSubmit} loading={submitting} block>
                  保存配额设置
                </Button>
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  )
}

// ============================================
// 主页面组件
// ============================================

const TenantAdminPage: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // 弹窗状态
  const [formVisible, setFormVisible] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [quotaVisible, setQuotaVisible] = useState(false)
  const [quotaTenant, setQuotaTenant] = useState<Tenant | null>(null)
  const [quotaUsage, setQuotaUsage] = useState<UsageStats | null>(null)

  // 全局摘要数据
  const [summary, setSummary] = useState<any>(null)

  const { t } = useTranslation()

  // 加载租户列表
  const fetchTenants = async (p = page, ps = pageSize) => {
    try {
      setLoading(true)
      const res: any = await api.get('/tenants', {
        params: { page: p, pageSize: ps },
      })
      const data = res.data || res
      setTenants(data.data || [])
      setTotal(data.pagination?.total || data.count || 0)
    } catch (err: any) {
      message.error('获取租户列表失败')
    } finally {
      setLoading(false)
    }
  }

  // 加载全局摘要
  const fetchSummary = async () => {
    try {
      const res: any = await api.get('/tenants/summary')
      setSummary(res.data?.data || res.data || null)
    } catch (_) {
      // 静默失败
    }
  }

  useEffect(() => {
    fetchTenants()
    fetchSummary()
  }, [])

  const handleCreateSuccess = () => {
    fetchTenants(page, pageSize)
    fetchSummary()
  }

  // 打开配额弹窗并加载用量
  const handleOpenQuota = async (tenant: Tenant) => {
    setQuotaTenant(tenant)
    setQuotaVisible(true)
    try {
      const res: any = await api.get(`/tenants/${tenant.id}/usage`)
      setQuotaUsage(res.data?.data || res.data || null)
    } catch (_) {
      setQuotaUsage(null)
    }
  }

  // 删除租户
  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/tenants/${id}`)
      message.success('租户已终止')
      fetchTenants(page, pageSize)
      fetchSummary()
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败')
    }
  }

  // 表格列定义
  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 60,
    },
    {
      title: '租户名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: '标识符',
      dataIndex: 'slug',
      key: 'slug',
      width: 140,
      render: (text: string) => <Tag>{text}</Tag>,
    },
    {
      title: '套餐',
      dataIndex: 'plan',
      key: 'plan',
      width: 100,
      render: (plan: string) => {
        const cfg = planConfig[plan]
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : <Tag>{plan}</Tag>
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => {
        const cfg = statusConfig[status]
        return cfg ? <Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag> : <Tag>{status}</Tag>
      },
    },
    {
      title: '域名',
      dataIndex: 'domain',
      key: 'domain',
      width: 180,
      render: (domain: string | null) =>
        domain ? (
          <Text copyable style={{ fontSize: 12 }}>{domain}</Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (val: string) => val ? new Date(val).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 240,
      fixed: 'right' as const,
      render: (_: unknown, record: Tenant) => (
        <Space size="small">
          <Tooltip title="查看/编辑">
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => { setEditingTenant(record); setFormVisible(true) }}
            />
          </Tooltip>
          <Tooltip title="配额管理">
            <Button
              type="link"
              size="small"
              icon={<DatabaseOutlined />}
              onClick={() => handleOpenQuota(record)}
            />
          </Tooltip>
          {record.id !== 1 && (
            <Popconfirm
              title={`确定要终止租户 "${record.name}" 吗？`}
              description="此操作不可撤销，该租户的所有服务将被停止。"
              onConfirm={() => handleDelete(record.id)}
              okText="确认终止"
              okType="danger"
              cancelText="取消"
            >
              <Tooltip title="终止租户">
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* 页面标题 */}
      <div className="gr-page-header">
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ApartmentOutlined style={{ color: 'var(--gr-primary)', fontSize: 20 }} />
          多租户管理
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchTenants(); fetchSummary() }}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingTenant(null); setFormVisible(true) }}>
            创建租户
          </Button>
        </Space>
      </div>

      {/* 全局统计卡片 */}
      {summary && (
        <Row gutter={16} style={{ marginBottom: 20 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="总租户数"
                value={summary.totalTenants}
                prefix={<BankOutlined />}
                valueStyle={{ fontSize: 22 }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="活跃租户"
                value={summary.activeTenants}
                prefix={<CheckCircleOutlined />}
                valueStyle={{ color: '#3f8600', fontSize: 22 }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="总用户数"
                value={summary.totalUsers}
                prefix={<TeamOutlined />}
                valueStyle={{ fontSize: 22 }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="总客户数"
                value={summary.totalClients}
                prefix={<MailOutlined />}
                valueStyle={{ fontSize: 22 }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 租户列表表格 */}
      <Card>
        <Table
          columns={columns}
          dataSource={tenants}
          rowKey="id"
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (t) => `${t} 个租户`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); fetchTenants(p, ps) },
          }}
          size="middle"
        />
      </Card>

      {/* 创建/编辑弹窗 */}
      <TenantFormModal
        visible={formVisible}
        editingTenant={editingTenant}
        onClose={() => { setFormVisible(false); setEditingTenant(null) }}
        onSuccess={handleCreateSuccess}
      />

      {/* 配额管理弹窗 */}
      <QuotaModal
        visible={quotaVisible}
        tenant={quotaTenant}
        usage={quotaUsage}
        onClose={() => { setQuotaVisible(false); setQuotaTenant(null); setQuotaUsage(null) }}
        onSuccess={handleCreateSuccess}
      />
    </div>
  )
}

export default TenantAdminPage
