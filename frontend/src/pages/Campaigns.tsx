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
  Progress,
  Tag,
  message,
  Steps,
  Alert,
  Tooltip,
  Popconfirm,
  Badge,
  Descriptions,
  Drawer,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  SendOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  MailOutlined,
  FilterOutlined,
} from '@ant-design/icons'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  fetchCampaigns,
  createCampaign,
} from '@/store/slices/campaignsSlice'
import api from '@/services/api'
import { useTranslation } from 'react-i18next'
import useMobile from '@/hooks/useMobile'

const { Title, Text } = Typography
const { Option } = Select
const { TextArea } = Input

// ============================================
// Campaign Status Config
// ============================================

const statusConfig: Record<string, { color: string; text: string; icon?: string }> = {
  DRAFT: { color: 'default', text: '草稿' },
  SCHEDULED: { color: 'processing', text: '已计划' },
  SENDING: { color: 'active', text: '发送中', icon: 'processing' },
  COMPLETED: { color: 'success', text: '已完成' },
}

const typeOptions = [
  { value: 'COLD_OUTREACH', label: '冷启动开发信' },
  { value: 'FOLLOW_UP', label: '跟进邮件' },
  { value: 'NEWSLETTER', label: '新闻通讯' },
  { value: 'TRANSACTIONAL', label: '事务通知' },
]

// ============================================
// Create Wizard Modal
// ============================================

interface CreateWizardProps {
  visible: boolean
  onClose: () => void
  onSuccess: () => void
}

const CreateWizardModal: React.FC<CreateWizardProps> = ({ visible, onClose, onSuccess }) => {
  const [form] = Form.useForm()
  const [currentStep, setCurrentStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const { t } = useTranslation()

  const steps = [
    { title: t('settings.personalInfo'), description: t('campaigns.name') },
    { title: t('emails.body'), description: t('campaigns.subject') },
    { title: t('emails.sendEmail'), description: t('emails.to') },
  ]

  const handleNext = async () => {
    try {
      if (currentStep === 0) {
        await form.validateFields(['name', 'type'])
      } else if (currentStep === 1) {
        await form.validateFields(['subject_template', 'body_template'])
      }
      setCurrentStep(currentStep + 1)
    } catch (_) {
      // Validation failed — stay on current step
    }
  }

  const handlePrev = () => setCurrentStep(currentStep - 1)

  const handleSubmit = async () => {
    try {
      setSubmitting(true)
      const values = await form.validateFields()
      await api.post('/campaigns', values)
      message.success('活动创建成功!')
      form.resetFields()
      setCurrentStep(0)
      onClose()
      onSuccess()
    } catch (err: any) {
      message.error(err.message || t('errors.internalServerError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={t('campaigns.createCampaign')}
      open={visible}
      onCancel={() => { form.resetFields(); setCurrentStep(0); onClose() }}
      width={720}
      footer={null}
      destroyOnClose
    >
      <Steps current={currentStep} items={steps} style={{ marginBottom: 32 }} />

      <Form form={form} layout="vertical" size="large">
        {/* Step 0: Basic Info */}
        {currentStep === 0 && (
          <>
            <Form.Item name="name" label="活动名称"
              rules={[{ required: true, message: '请输入活动名称' }]}
            >
              <Input placeholder="例如：Q2 产品推广 - 北美市场" />
            </Form.Item>
            <Form.Item name="type" label="活动类型"
              rules={[{ required: true, message: '请选择活动类型' }]}
              initialValue="COLD_OUTREACH"
            >
              <Select placeholder="选择类型">
                {typeOptions.map(opt => (
                  <Option key={opt.value} value={opt.value}>{opt.label}</Option>
                ))}
              </Select>
            </Form.Item>
          </>
        )}

        {/* Step 1: Email Content */}
        {currentStep === 1 && (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="支持 Handlebars 模板变量"
              description="可用变量: {{client.name}}, {{client.company}}, {{client.email}}, {{user.name}}, {{campaign.name}}, {{date}}"
            />
            <Form.Item name="subject_template" label="邮件主题"
              rules={[{ required: true, message: '请输入邮件主题' }]}
            >
              <Input placeholder="例如: Hi {{client.name}} - 关于{{company}}的合作邀请" />
            </Form.Item>
            <Form.Item name="body_template" label={t('emails.body') + ' (支持HTML)'}
              rules={[{ required: true, message: t('validation.required', { field: t('emails.body') }) }]}
            >
              <TextArea
                rows={10}
                placeholder={`<h2>Dear {{client.name}},</h2>\n<p>We'd like to invite you...</p>\n<p>Best regards,<br/>{{user.name}}</p>`}
              />
            </Form.Item>
          </>
        )}

        {/* Step 2: Send Settings */}
        {currentStep === 2 && (
          <>
            <Form.Item name="accountIds" label="发送账号">
              <Select mode="multiple" placeholder="选择要使用的邮箱账号（可选，不选则自动分配）">
                <Option value="auto">系统自动分配最优账号</Option>
              </Select>
            </Form.Item>
            <Form.Item name="scheduleConfig" label="计划设置">
              <Text type="secondary">当前版本为立即发送模式。计划发送功能将在后续版本提供。</Text>
            </Form.Item>

            <div style={{
              background: '#fafafa',
              border: '1px dashed #d9d9d9',
              borderRadius: 8,
              padding: 20,
              marginTop: 8,
            }}>
              <Title level={5}>创建摘要</Title>
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) => (
                  <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label="活动名称">{getFieldValue('name') || '-'}</Descriptions.Item>
                    <Descriptions.Item label="活动类型">
                      {typeOptions.find(t => t.value === getFieldValue('type'))?.label || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="邮件主题">{getFieldValue('subject_template') || '-'}</Descriptions.Item>
                  </Descriptions>
                )}
              </Form.Item>
            </div>
          </>
        )}
      </Form>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Button disabled={currentStep === 0} onClick={handlePrev}>
          {t('common.previous')}
        </Button>
        <Space>
          <Button onClick={() => { form.resetFields(); setCurrentStep(0); onClose() }}>
            {t('common.cancel')}
          </Button>
          {currentStep < 2 ? (
            <Button type="primary" onClick={handleNext}>
              {t('common.next')}
            </Button>
          ) : (
            <Button type="primary" loading={submitting} onClick={handleSubmit} icon={<SendOutlined />}>
              {t('campaigns.createCampaign')}
            </Button>
          )}
        </Space>
      </div>
    </Modal>
  )
}

// ============================================
// Send Progress Modal (SSE)
// ============================================

interface ProgressModalProps {
  visible: boolean
  campaignId: string | null
  onClose: () => void
}

const SendProgressModal: React.FC<ProgressModalProps> = ({ visible, campaignId, onClose }) => {
  const [progress, setProgress] = useState<any>(null)
  const [eventSource, setEventSource] = useState<EventSource | null>(null)

  useEffect(() => {
    if (!visible || !campaignId) return

    // Connect to SSE progress endpoint
    const es = new EventSource(`/api/progress/campaign/${campaignId}`)
    setEventSource(es)

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setProgress(data)
      } catch (_) {}
    }

    es.onerror = () => {
      console.warn('[SSE] Connection lost')
      es.close()
    }

    return () => {
      es.close()
      setEventSource(null)
      setProgress(null)
    }
  }, [visible, campaignId])

  const percent = progress?.totalJobs > 0
    ? Math.round(((progress.completedJobs || 0) / progress.totalJobs) * 100)
    : 0
  const isComplete = percent === 100 || progress?.status === 'complete'

  return (
    <Modal
      title={t('emails.sendEmail')}
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          {isComplete ? t('common.success') : t('campaigns.sending')}
        </Button>,
      ]}
      width={550}
    >
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <Progress
          type="circle"
          percent={percent}
          status={isComplete ? 'success' : 'active'}
          size={160}
          format={(p) => `${p}%`}
        />
        <div style={{ marginTop: 16 }}>
          <Text>
            {t('common.completed')}: <strong>{progress?.completedJobs || 0}</strong> / {progress?.totalJobs || 0}
          </Text>
        </div>
        {progress?.failedJobs > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="warning">{t('emails.failed')}: {progress.failedJobs}</Text>
          </div>
        )}
        {isComplete && (
          <Alert
            type="success"
            showIcon
            style={{ marginTop: 16 }}
            message={t('emails.emailSent')}
            description={`${t('dashboard.totalEmails')} ${progress.totalJobs}`}
          />
        )}
      </div>
    </Modal>
  )
}

// ============================================
// 移动端卡片列表项组件
// ============================================

interface CampaignCardItemProps {
  record: any
  onSend: (record: any) => void
  sendingId: string | null
  onDetail: (record: any) => void
}

const CampaignCardItem: React.FC<CampaignCardItemProps> = ({ record, onSend, sendingId, onDetail }) => {
  const total = record.emailCount || record.totalCount || 0
  const sent = record.sentCount || 0
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0
  const cfg = statusConfig[record.status] || statusConfig.DRAFT
  const typeOpt = typeOptions.find(t => t.value === record.type)

  return (
    <div className="mobile-card-item" onClick={() => onDetail(record)}>
      <div className="mobile-card-header">
        <span className="mobile-card-title">{record.name}</span>
        <Tag color={cfg.color}>{cfg.text}</Tag>
      </div>
      <div className="mobile-card-meta">
        <span className="mobile-card-meta-item">
          {typeOpt ? <Tag>{typeOpt.label}</Tag> : <Tag>{record.type}</Tag>}
        </span>
        <span className="mobile-card-meta-item">
          {record.createdAt ? new Date(record.createdAt).toLocaleDateString() : '-'}
        </span>
      </div>
      {total > 0 && (
        <div style={{ marginTop: 8 }}>
          <Progress
            percent={pct}
            size="small"
            status={pct === 100 ? 'success' : record.status === 'SENDING' ? 'active' : 'normal'}
            format={() => `${sent}/${total}`}
          />
        </div>
      )}
      <div className="mobile-card-actions mobile-action-buttons">
        {(record.status === 'DRAFT' || record.status === 'SCHEDULED') && (
          <Popconfirm
            title={t('campaigns.confirmDelete')}
            onConfirm={(e) => { e?.stopPropagation(); onSend(record) }}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
          >
            <Button
              type="primary"
              size="small"
              icon={<PlayCircleOutlined />}
              loading={sendingId === record.id}
              onClick={(e) => e.stopPropagation()}
            >
              {t('campaigns.start')}
            </Button>
          </Popconfirm>
        )}
        {record.status === 'SENDING' && (
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={(e) => { e?.stopPropagation(); onSend(record) }}
          >
            {t('emails.viewDetails')}
          </Button>
        )}
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={(e) => { e?.stopPropagation(); }}
        >
          {t('common.edit')}
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Main Campaigns Page
// ============================================

const CampaignsPage: React.FC = () => {
  const dispatch = useAppDispatch()
  const { items: campaigns, loading, total } = useAppSelector((state) => state.campaigns)
  const [wizardVisible, setWizardVisible] = useState(false)
  const [progressVisible, setProgressVisible] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [progressCampaignId, setProgressCampaignId] = useState<string | null>(null)
  const [filterDrawerVisible, setFilterDrawerVisible] = useState(false)
  const { t } = useTranslation()
  const mobile = useMobile()

  useEffect(() => {
    dispatch(fetchCampaigns())
  }, [dispatch])

  const handleCreateSuccess = () => {
    dispatch(fetchCampaigns())
  }

  const handleSend = async (record: any) => {
    setSendingId(record.id)
    try {
      const res: any = await api.post(`/emails/campaign/${record.id}/execute`, {})
      const data = res.data || res

      if (data.success !== false) {
        message.success(`活动已加入发送队列! 共 ${data.totalEnqueued || '?'} 封邮件`)
        // Open progress modal for SSE tracking
        setProgressCampaignId(record.id)
        setProgressVisible(true)
        dispatch(fetchCampaigns())
      } else {
        message.error(data.message || '发送失败')
      }
    } catch (err: any) {
      message.error(err.message || t('errors.internalServerError'))
    } finally {
      setSendingId(null)
    }
  }

  const getStatusTag = (status: string) => {
    const cfg = statusConfig[status] || statusConfig.DRAFT
    return <Tag color={cfg.color}>{cfg.text}</Tag>
  }

  const columns = [
    {
      title: t('campaigns.name'),
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: t('campaigns.type'),
      dataIndex: 'type',
      key: 'type',
      width: 130,
      render: (type: string) => {
        const opt = typeOptions.find(t => t.value === type)
        return opt ? <Tag>{opt.label}</Tag> : <Tag>{type}</Tag>
      },
    },
    {
      title: t('campaigns.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => getStatusTag(status),
    },
    {
      title: t('emails.history'),
      key: 'progress',
      width: 200,
      render: (_: any, record: any) => {
        const total = record.emailCount || record.totalCount || 0
        const sent = record.sentCount || 0
        const pct = total > 0 ? Math.round((sent / total) * 100) : 0

        if (total === 0) return <Text type="secondary">-</Text>

        return (
          <Space>
            <Progress
              percent={pct}
              size="small"
              style={{ width: 120 }}
              status={pct === 100 ? 'success' : record.status === 'SENDING' ? 'active' : 'normal'}
            />
            <Text type="secondary">{sent}/{total}</Text>
          </Space>
        )
      },
    },
    {
      title: t('emails.sentAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (val: string) => val ? new Date(val).toLocaleString() : '-',
    },
    {
      title: t('common.actions'),
      key: 'action',
      width: 220,
      render: (_: any, record: any) => (
        <Space size="small">
          <Tooltip title={t('common.details')}>
            <Button type="link" size="small" icon={<EyeOutlined />} />
          </Tooltip>
          <Tooltip title={t('common.edit')}>
            <Button type="link" size="small" icon={<EditOutlined />} />
          </Tooltip>
          {(record.status === 'DRAFT' || record.status === 'SCHEDULED') && (
            <Popconfirm
              title={t('campaigns.confirmDelete')}
              onConfirm={() => handleSend(record)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
            >
                <Button
                  type="link" size="small"
                  icon={<PlayCircleOutlined />}
                  loading={sendingId === record.id}
                  style={{ color: 'var(--gr-primary)', fontWeight: 600 }}
                >
                  {t('campaigns.start')}
                </Button>
            </Popconfirm>
          )}
          {record.status === 'SENDING' && (
            <Button
              type="link" size="small"
              icon={<ReloadOutlined />}
              onClick={() => { setProgressCampaignId(record.id); setProgressVisible(true) }}
            >
              {t('emails.viewDetails')}
            </Button>
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
          <MailOutlined style={{ color: 'var(--gr-primary)', fontSize: 20 }} />
          营销活动管理
        </Title>
        {/* 移动端：创建按钮移入 FAB 或保留在 header */}
        {!mobile.isMobile && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardVisible(true)}>
            创建活动
          </Button>
        )}
      </div>

      <Card>

        {/* 筛选区域 - 移动端使用抽屉触发器 */}
        {mobile.isMobile ? (
          <div style={{ marginBottom: 12 }}>
            <button
              className="mobile-filter-trigger"
              onClick={() => setFilterDrawerVisible(true)}
              type="button"
            >
              <FilterOutlined /> 筛选与搜索
            </button>

            {/* 移动端筛选抽屉 */}
            <Drawer
              title="筛选条件"
              placement="bottom"
              height="auto"
              open={filterDrawerVisible}
              onClose={() => setFilterDrawerVisible(false)}
              styles={{ body: { paddingTop: 16 } }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Input placeholder="搜索活动名称..." allowClear prefix={<SearchOutlined />} />
                <Select placeholder="活动类型" allowClear style={{ width: '100%' }}>
                  {typeOptions.map(opt => (
                    <Option key={opt.value} value={opt.value}>{opt.label}</Option>
                  ))}
                </Select>
                <Select placeholder="状态筛选" allowClear style={{ width: '100%' }}>
                  <Option value="DRAFT">草稿</Option>
                  <Option value="SCHEDULED">已计划</Option>
                  <Option value="SENDING">发送中</Option>
                  <Option value="COMPLETED">已完成</Option>
                </Select>
                <Button type="primary" block onClick={() => setFilterDrawerVisible(false)}>
                  应用筛选
                </Button>
              </Space>
            </Drawer>
          </div>
        ) : (
          <Space style={{ marginBottom: 16 }} wrap>
            <Input
              placeholder="搜索活动名称..."
              allowClear
              style={{ width: 250 }}
              prefix={<SearchOutlined />}
            />
            <Select placeholder="活动类型" allowClear style={{ width: 140 }}>
              {typeOptions.map(opt => (
                <Option key={opt.value} value={opt.value}>{opt.label}</Option>
              ))}
            </Select>
            <Select placeholder="状态筛选" allowClear style={{ width: 120 }}>
              <Option value="DRAFT">草稿</Option>
              <Option value="SCHEDULED">已计划</Option>
              <Option value="SENDING">发送中</Option>
              <Option value="COMPLETED">已完成</Option>
            </Select>
            <Button icon={<FilterOutlined />}>筛选</Button>
          </Space>
        )}

        {/* 移动端：卡片列表视图；桌面端：表格视图 */}
        {mobile.isMobile ? (
          <div className="mobile-card-list">
            {campaigns.length === 0 && !loading && (
              <Empty description={t('dashboard.noData')} style={{ padding: '40px 0' }} />
            )}
            {campaigns.map((record: any) => (
              <CampaignCardItem
                key={record.id}
                record={record}
                onSend={handleSend}
                sendingId={sendingId}
                onDetail={() => {}}
              />
            ))}

            {/* 移动端 FAB 创建按钮 */}
            <Button
              type="primary"
              shape="circle"
              icon={<PlusOutlined />}
              className="fab-button"
              onClick={() => setWizardVisible(true)}
            />

            {/* 分页 - 移动端简化 */}
            {total > 10 && (
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共 {total} 条记录
                </Text>
              </div>
            )}
          </div>
        ) : (
          <Table
            columns={columns}
            dataSource={campaigns}
            rowKey="id"
            loading={loading}
            pagination={{
              total,
              pageSize: 10,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `${t('common.total')} ${total} ${t('campaigns.title')}`,
            }}
            size="middle"
          />
        )}
      </Card>

      <CreateWizardModal
        visible={wizardVisible}
        onClose={() => setWizardVisible(false)}
        onSuccess={handleCreateSuccess}
      />

      <SendProgressModal
        visible={progressVisible}
        campaignId={progressCampaignId}
        onClose={() => { setProgressVisible(false); setProgressCampaignId(null) }}
      />
    </div>
  )
}

export default CampaignsPage
