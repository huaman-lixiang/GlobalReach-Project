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
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  SendOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  fetchCampaigns,
  createCampaign,
} from '@/store/slices/campaignsSlice'
import api from '@/services/api'

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

  const steps = [
    { title: '基本信息', description: '活动名称与类型' },
    { title: '邮件内容', description: '主题与正文模板' },
    { title: '发送设置', description: '目标账号选择' },
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
      message.error(err.message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="创建营销活动"
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
            <Form.Item name="body_template" label="邮件正文 (支持HTML)"
              rules={[{ required: true, message: '请输入邮件内容' }]}
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
          上一步
        </Button>
        <Space>
          <Button onClick={() => { form.resetFields(); setCurrentStep(0); onClose() }}>
            取消
          </Button>
          {currentStep < 2 ? (
            <Button type="primary" onClick={handleNext}>
              下一步
            </Button>
          ) : (
            <Button type="primary" loading={submitting} onClick={handleSubmit} icon={<SendOutlined />}>
              创建活动
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
      title="发送进度"
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          {isComplete ? '完成' : '后台运行'}
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
            已完成: <strong>{progress?.completedJobs || 0}</strong> / {progress?.totalJobs || 0}
          </Text>
        </div>
        {progress?.failedJobs > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="warning">失败: {progress.failedJobs}</Text>
          </div>
        )}
        {isComplete && (
          <Alert
            type="success"
            showIcon
            style={{ marginTop: 16 }}
            message="发送完成!"
            description={`共处理 ${progress.totalJobs} 封邮件`}
          />
        )}
      </div>
    </Modal>
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
      message.error(err.message || '发送请求失败')
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
      title: '活动名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 130,
      render: (type: string) => {
        const opt = typeOptions.find(t => t.value === type)
        return opt ? <Tag>{opt.label}</Tag> : <Tag>{type}</Tag>
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => getStatusTag(status),
    },
    {
      title: '发送进度',
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
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (val: string) => val ? new Date(val).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_: any, record: any) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button type="link" size="small" icon={<EyeOutlined />} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="link" size="small" icon={<EditOutlined />} />
          </Tooltip>
          {(record.status === 'DRAFT' || record.status === 'SCHEDULED') && (
            <Popconfirm
              title="确定要立即发送此活动吗？"
              onConfirm={() => handleSend(record)}
              okText="确认发送"
              cancelText="取消"
            >
              <Button
                type="link" size="small"
                icon={<PlayCircleOutlined />}
                loading={sendingId === record.id}
                style={{ color: '#1890ff' }}
              >
                发送
              </Button>
            </Popconfirm>
          )}
          {record.status === 'SENDING' && (
            <Button
              type="link" size="small"
              icon={<ReloadOutlined />}
              onClick={() => { setProgressCampaignId(record.id); setProgressVisible(true) }}
            >
              查看进度
            </Button>
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
            营销活动管理
          </Title>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardVisible(true)}>
            创建活动
          </Button>
        </div>

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
            showTotal: (total) => `共 ${total} 个活动`,
          }}
          size="middle"
        />
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
