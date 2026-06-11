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
import { tenantAdminTexts } from '../i18n/tenantAdmin'

const { Title, Text } = Typography
const { Option } = Select
const { TextArea } = Input

// ============================================
// Type definitions
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
// Constants configuration
// ============================================

const planConfig: Record<string, { color: string; label: string }> = {
  basic: { color: 'default', label: tenantAdminTexts.plans.basic },
  professional: { color: 'blue', label: tenantAdminTexts.plans.professional },
  enterprise: { color: 'gold', label: tenantAdminTexts.plans.enterprise },
}

const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  active: { color: 'success', icon: <CheckCircleOutlined />, label: tenantAdminTexts.statuses.active },
  suspended: { color: 'warning', icon: <WarningOutlined />, label: tenantAdminTexts.statuses.suspended },
  terminated: { color: 'error', icon: <CloseCircleOutlined />, label: tenantAdminTexts.statuses.terminated },
}

// ============================================
// Create/Edit tenant modal
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
        message.success(tenantAdminTexts.messages.updateSuccess)
      } else {
        await api.post('/tenants', values)
        message.success(tenantAdminTexts.messages.createSuccess)
      }

      form.resetFields()
      onClose()
      onSuccess()
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message || tenantAdminTexts.messages.operationFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={isEdit ? `${tenantAdminTexts.form.editTitlePrefix}${editingTenant.name}` : tenantAdminTexts.form.createTitle}
      open={visible}
      onCancel={() => { form.resetFields(); onClose() }}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText={isEdit ? tenantAdminTexts.form.saveBtn : tenantAdminTexts.form.createBtn}
      cancelText={tenantAdminTexts.form.cancelBtn}
      width={600}
      destroyOnClose
    >
      <Form form={form} layout="vertical" size="large" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label={tenantAdminTexts.form.name.label}
              rules={[{ required: true, message: tenantAdminTexts.form.name.requiredMsg }, { min: 2, max: 100, message: tenantAdminTexts.form.name.lengthMsg }]}
            >
              <Input placeholder={tenantAdminTexts.form.name.placeholder} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="slug"
              label={tenantAdminTexts.form.slug.label}
              rules={[
                { required: true, message: tenantAdminTexts.form.slug.requiredMsg },
                { pattern: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/, message: tenantAdminTexts.form.slug.patternMsg },
              ]}
            >
              <Input placeholder={tenantAdminTexts.form.slug.placeholder} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="domain" label={tenantAdminTexts.form.domain.label}>
              <Input placeholder={tenantAdminTexts.form.domain.placeholder} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="plan"
              label={tenantAdminTexts.form.plan.label}
              rules={[{ required: true, message: tenantAdminTexts.form.plan.requiredMsg }]}
              initialValue="basic"
            >
              <Select placeholder={tenantAdminTexts.form.plan.placeholder}>
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
            label={tenantAdminTexts.form.status.label}
            rules={[{ required: true, message: tenantAdminTexts.form.status.requiredMsg }]}
          >
            <Select placeholder={tenantAdminTexts.form.status.placeholder}>
              <Option value="active">{tenantAdminTexts.statuses.active}</Option>
              <Option value="suspended">{tenantAdminTexts.statuses.suspended}</Option>
              <Option value="terminated">{tenantAdminTexts.statuses.terminated}</Option>
            </Select>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

// ============================================
// Quota settings modal
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
      message.success(tenantAdminTexts.messages.quotaUpdateSuccess)
      onClose()
      onSuccess()
    } catch (err: any) {
      message.error(err.response?.data?.message || err.message || tenantAdminTexts.messages.quotaUpdateFailed)
    } finally {
      setSubmitting(false)
    }
  }

  const getPercent = (used: number, limit: number) =>
    limit > 0 ? Math.round((used / limit) * 100) : 0

  const getPercentColor = (percent: number) => {
    if (percent >= 90) return '#ff4d4f'
    if (percent >= 70) return '#faad14'
    return '#52c41a'
  }

  if (!tenant) return null

  const q = tenant.quota || {}

  return (
    <Modal
      title={`${tenantAdminTexts.quota.titlePrefix}${tenant.name}`}
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
            label: tenantAdminTexts.quota.usageOverview,
            children: (
              <div style={{ padding: '16px 0' }}>
                <Row gutter={[16, 16]}>
                  <Col span={8}>
                    <Card size="small">
                      <Statistic title={tenantAdminTexts.quota.usersCount} value={usage?.usersCount || 0} suffix={`/ ${q.maxUsers}`} />
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
                      <Statistic title={tenantAdminTexts.quota.clientsCount} value={usage?.clientsCount || 0} suffix={`/ ${q.maxClients}`} />
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
                      <Statistic title={tenantAdminTexts.quota.accountsCount} value={usage?.accountsCount || 0} suffix={`/ ${q.maxEmailAccounts}`} />
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
                      <Statistic title={tenantAdminTexts.quota.campaignsActive} value={usage?.campaignsActive || 0} suffix={`/ ${q.maxActiveCampaigns}`} />
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
                      <Statistic title={tenantAdminTexts.quota.emailsThisMonth} value={usage?.emailsThisMonth || 0} suffix={`/ ${q.maxEmailsPerMonth}`} />
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
                      <Statistic title={tenantAdminTexts.quota.dailyLimit} value={q.maxEmailsPerDay} suffix={tenantAdminTexts.quota.dailyLimitSuffix} />
                      <Text type="secondary" style={{ fontSize: 12 }}>{tenantAdminTexts.quota.dailyLimitDesc}</Text>
                    </Card>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'edit',
            label: tenantAdminTexts.quota.editLabel,
            children: (
              <Form form={form} layout="vertical" style={{ padding: '16px 0' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="maxUsers" label={tenantAdminTexts.quota.maxUsers}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxClients" label={tenantAdminTexts.quota.maxClients}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxEmailAccounts" label={tenantAdminTexts.quota.maxEmailAccounts}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxEmailsPerDay" label={tenantAdminTexts.quota.maxEmailsPerDay}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxEmailsPerMonth" label={tenantAdminTexts.quota.maxEmailsPerMonth}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxActiveCampaigns" label={tenantAdminTexts.quota.maxActiveCampaigns}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="maxStorageMB" label={tenantAdminTexts.quota.maxStorageMB}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="apiRateLimit" label={tenantAdminTexts.quota.apiRateLimit}>
                      <InputNumber min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider>{tenantAdminTexts.quota.featureDivider}</Divider>

                <Form.Item name={['features', 'customDomain']} label={tenantAdminTexts.quota.customDomain} valuePropName="checked">
                  <Switch checkedChildren={tenantAdminTexts.quota.switchOn} unCheckedChildren={tenantAdminTexts.quota.switchOff} />
                </Form.Item>
                <Form.Item name={['features', 'webhook']} label={tenantAdminTexts.quota.webhook} valuePropName="checked">
                  <Switch checkedChildren={tenantAdminTexts.quota.switchOn} unCheckedChildren={tenantAdminTexts.quota.switchOff} />
                </Form.Item>
                <Form.Item name={['features', 'analytics']} label={tenantAdminTexts.quota.analytics} valuePropName="checked">
                  <Switch checkedChildren={tenantAdminTexts.quota.switchOn} unCheckedChildren={tenantAdminTexts.quota.switchOff} />
                </Form.Item>
                <Form.Item name={['features', 'export']} label={tenantAdminTexts.quota.export} valuePropName="checked">
                  <Switch checkedChildren={tenantAdminTexts.quota.switchOn} unCheckedChildren={tenantAdminTexts.quota.switchOff} />
                </Form.Item>
                <Form.Item name={['features', 'sso']} label={tenantAdminTexts.quota.sso} valuePropName="checked">
                  <Switch checkedChildren={tenantAdminTexts.quota.switchOn} unCheckedChildren={tenantAdminTexts.quota.switchOff} />
                </Form.Item>

                <Button type="primary" onClick={handleSubmit} loading={submitting} block>
                  {tenantAdminTexts.quota.saveBtn}
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
// Main page component
// ============================================

const TenantAdminPage: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Modal state
  const [formVisible, setFormVisible] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [quotaVisible, setQuotaVisible] = useState(false)
  const [quotaTenant, setQuotaTenant] = useState<Tenant | null>(null)
  const [quotaUsage, setQuotaUsage] = useState<UsageStats | null>(null)

  // Global summary data
  const [summary, setSummary] = useState<any>(null)

  const { t } = useTranslation()

  // Load tenant list
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
      message.error(tenantAdminTexts.messages.fetchFailed)
    } finally {
      setLoading(false)
    }
  }

  // Load global summary
  const fetchSummary = async () => {
    try {
      const res: any = await api.get('/tenants/summary')
      setSummary(res.data?.data || res.data || null)
    } catch (_) {
      // Silent failure
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

  // Open quota modal and load usage
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

  // Delete tenant
  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/tenants/${id}`)
      message.success(tenantAdminTexts.messages.terminateSuccess)
      fetchTenants(page, pageSize)
      fetchSummary()
    } catch (err: any) {
      message.error(err.response?.data?.message || tenantAdminTexts.messages.deleteFailed)
    }
  }

  // Table column definitions
  const columns = [
    {
      title: tenantAdminTexts.table.id,
      dataIndex: 'id',
      key: 'id',
      width: 60,
    },
    {
      title: tenantAdminTexts.table.tenantName,
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: tenantAdminTexts.table.slug,
      dataIndex: 'slug',
      key: 'slug',
      width: 140,
      render: (text: string) => <Tag>{text}</Tag>,
    },
    {
      title: tenantAdminTexts.table.plan,
      dataIndex: 'plan',
      key: 'plan',
      width: 100,
      render: (plan: string) => {
        const cfg = planConfig[plan]
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : <Tag>{plan}</Tag>
      },
    },
    {
      title: tenantAdminTexts.table.status,
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => {
        const cfg = statusConfig[status]
        return cfg ? <Tag color={cfg.color} icon={cfg.icon}>{cfg.label}</Tag> : <Tag>{status}</Tag>
      },
    },
    {
      title: tenantAdminTexts.table.domain,
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
      title: tenantAdminTexts.table.createdAt,
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (val: string) => val ? new Date(val).toLocaleString() : '-',
    },
    {
      title: tenantAdminTexts.table.actions,
      key: 'action',
      width: 240,
      fixed: 'right' as const,
      render: (_: unknown, record: Tenant) => (
        <Space size="small">
          <Tooltip title={tenantAdminTexts.table.tooltipEdit}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => { setEditingTenant(record); setFormVisible(true) }}
            />
          </Tooltip>
          <Tooltip title={tenantAdminTexts.table.tooltipQuota}>
            <Button
              type="link"
              size="small"
              icon={<DatabaseOutlined />}
              onClick={() => handleOpenQuota(record)}
            />
          </Tooltip>
          {record.id !== 1 && (
            <Popconfirm
              title={`${tenantAdminTexts.table.terminateConfirm(record.name)}`}
              description={tenantAdminTexts.table.terminateDesc}
              onConfirm={() => handleDelete(record.id)}
              okText={tenantAdminTexts.table.terminateOk}
              okType="danger"
              cancelText={tenantAdminTexts.table.terminateCancel}
            >
              <Tooltip title={tenantAdminTexts.table.tooltipTerminate}>
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
      {/* Page header */}
      <div className="gr-page-header">
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ApartmentOutlined style={{ color: 'var(--gr-primary)', fontSize: 20 }} />
          {tenantAdminTexts.page.title}
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchTenants(); fetchSummary() }}>
            {tenantAdminTexts.page.refreshBtn}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingTenant(null); setFormVisible(true) }}>
            {tenantAdminTexts.page.createTenantBtn}
          </Button>
        </Space>
      </div>

      {/* Global statistics cards */}
      {summary && (
        <Row gutter={16} style={{ marginBottom: 20 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={tenantAdminTexts.page.totalTenants}
                value={summary.totalTenants}
                prefix={<BankOutlined />}
                valueStyle={{ fontSize: 22 }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={tenantAdminTexts.page.activeTenants}
                value={summary.activeTenants}
                prefix={<CheckCircleOutlined />}
                valueStyle={{ color: '#3f8600', fontSize: 22 }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={tenantAdminTexts.page.totalUsers}
                value={summary.totalUsers}
                prefix={<TeamOutlined />}
                valueStyle={{ fontSize: 22 }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={tenantAdminTexts.page.totalClients}
                value={summary.totalClients}
                prefix={<MailOutlined />}
                valueStyle={{ fontSize: 22 }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* Tenant list table */}
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
            showTotal: (t) => `${t} ${tenantAdminTexts.pagination.totalSuffix}`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); fetchTenants(p, ps) },
          }}
          size="middle"
        />
      </Card>

      {/* Create/Edit modal */}
      <TenantFormModal
        visible={formVisible}
        editingTenant={editingTenant}
        onClose={() => { setFormVisible(false); setEditingTenant(null) }}
        onSuccess={handleCreateSuccess}
      />

      {/* Quota management modal */}
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
