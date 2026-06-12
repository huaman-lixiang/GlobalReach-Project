import React, { useState } from 'react'
import {
  Card,
  Input,
  Button,
  Table,
  Tag,
  Progress,
  Alert,
  Typography,
  Space,
  Descriptions,
  Collapse,
  message,
  Spin,
  Badge,
  Tooltip,
} from 'antd'
import {
  SafetyCertificateOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  MailOutlined,
  ExportOutlined,
} from '@ant-design/icons'
import api from '@/services/api'
import { useTranslation } from 'react-i18next'
import useMobile from '@/hooks/useMobile'
import BrandedPageWrapper from '@/components/BrandedPageWrapper'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

// ============================================
// 类型定义
// ============================================

interface SPFResult {
  found: boolean
  record: string | null
  result: string
  score: number
}

interface DKIMResult {
  found: boolean
  selectors: Array<{ selector: string; found: boolean; record: string }>
  score: number
}

interface DMARCResult {
  found: boolean
  record: string | null
  policy: string
  score: number
}

interface OverallScore {
  score: number
  grade: string
  breakdown: {
    spf: SPFResult & { weight: string }
    dkim: DKIMResult & { weight: string }
    dmarc: DMARCResult & { weight: string }
  }
}

interface DomainResult {
  domain: string
  spf: SPFResult
  dkim: DKIMResult
  dmarc: DMARCResult
  overall: OverallScore
  recommendations: Array<{
    category: string
    priority: string
    title: string
    description: string
  }>
}

interface CheckResult {
  domain: string
  checkedAt: string
  spf: SPFResult
  dkim: DKIMResult
  dmarc: DMARCResult
  overall: OverallScore
  recommendations: any[]
}

// ============================================
// Grade配置
// ============================================

const gradeConfig: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  A: { color: '#52c41a', label: 'A - 优秀', icon: <CheckCircleOutlined /> },
  B: { color: '#1890ff', label: 'B - 良好', icon: <CheckCircleOutlined /> },
  C: { color: '#faad14', label: 'C - 一般', icon: <WarningOutlined /> },
  D: { color: '#ff7a45', label: 'D - 较差', icon: <WarningOutlined /> },
  F: { color: '#ff4d4f', label: 'F - 危险', icon: <CloseCircleOutlined /> },
}

const priorityConfig: Record<string, { color: string; label: string }> = {
  critical: { color: 'red', label: '紧急' },
  high: { color: 'orange', label: '高' },
  medium: { color: 'blue', label: '中' },
  low: { color: 'default', label: '低' },
}

// ============================================
// 评分圆环组件
// ============================================

const GradeCircle: React.FC<{ grade: string; score: number; size?: number }> = ({ grade, score, size = 120 }) => {
  const cfg = gradeConfig[grade] || gradeConfig.F
  const color = cfg.color
  const circumference = 2 * Math.PI * 45 // r=45
  const offset = circumference - (score / 100) * circumference

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" fill="none" stroke="#f0f0f0" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        <text x="50" y="48" textAnchor="middle" fontSize="24" fontWeight={800} fill={color}>
          {grade}
        </text>
        <text x="50" y="66" textAnchor="middle" fontSize="11" fill="#999">
          {score}/100
        </text>
      </svg>
      <Text strong style={{ color, fontSize: 13 }}>{cfg.label}</Text>
    </div>
  )
}

// ============================================
// 主页面组件
// ============================================

const DeliverabilityTestPage: React.FC = () => {
  const [domainInput, setDomainInput] = useState('')
  const [batchInput, setBatchInput] = useState('')
  const [results, setResults] = useState<CheckResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'single' | 'batch'>('single')
  const { t } = useTranslation()
  const mobile = useMobile()

  const handleSingleCheck = async () => {
    if (!domainInput.trim()) {
      message.warning('请输入域名')
      return
    }
    setLoading(true)
    try {
      const res: any = await api.post('/campaign-delivery/domain-score', { domain: domainInput.trim() })
      const data = res.data || res
      if (data.success !== false) {
        setResults(prev => [data.data, ...prev])
        message.success(`${domainInput.trim()} 检查完成`)
      } else {
        message.error(data.message || '检查失败')
      }
    } catch (err: any) {
      message.error(err.message || '域名检查失败')
    } finally {
      setLoading(false)
    }
  }

  const handleBatchCheck = async () => {
    const domains = batchInput
      .split(/[\n,]+/)
      .map(d => d.trim())
      .filter(d => d.length > 0)

    if (domains.length === 0) {
      message.warning('请输入至少一个域名')
      return
    }

    setLoading(true)
    try {
      const res: any = await api.post('/campaign-delivery/batch-check', { domains })
      const data = res.data || res
      if (data.success !== false) {
        setResults(data.data || [])
        message.success(`已完成 ${domains.length} 个域名的检查`)
      }
    } catch (err: any) {
      message.error(err.message || '批量检查失败')
    } finally {
      setLoading(false)
    }
  }

  // 结果表格列定义
  const columns = [
    {
      title: '域名',
      dataIndex: 'domain',
      key: 'domain',
      render: (domain: string) => <Text strong>{domain}</Text>,
    },
    {
      title: '等级',
      dataIndex: ['overall', 'grade'],
      key: 'grade',
      width: 90,
      render: (grade: string) => {
        const cfg = gradeConfig[grade]
        return (
          <Tag color={cfg?.color} style={{ fontWeight: 700, fontSize: 13 }}>
            {cfg?.icon} {grade}
          </Tag>
        )
      },
    },
    {
      title: '评分',
      dataIndex: ['overall', 'score'],
      key: 'score',
      width: 140,
      render: (score: number, record: CheckResult) => (
        <Progress
          percent={score}
          size="small"
          status={score >= 80 ? 'success' : score >= 60 ? 'normal' : 'exception'}
          format={() => `${score}/100`}
        />
      ),
    },
    {
      title: 'SPF',
      dataIndex: ['spf', 'found'],
      key: 'spf',
      width: 60,
      render: (found: boolean) =>
        found ? <Tag color="green">✓</Tag> : <Tag color="red">✗</Tag>,
    },
    {
      title: 'DKIM',
      dataIndex: ['dkim', 'found'],
      key: 'dkim',
      width: 60,
      render: (found: boolean) =>
        found ? <Tag color="green">✓</Tag> : <Tag color="red">✗</Tag>,
    },
    {
      title: 'DMARC',
      dataIndex: ['dmarc', 'found'],
      key: 'dmarc',
      width: 70,
      render: (found: boolean, record: CheckResult) =>
        found ? (
          <Tooltip title={`Policy: ${record.dmarc.policy}`}>
            <Tag color="green">{record.dmarc.policy}</Tag>
          </Tooltip>
        ) : (
          <Tag color="red">✗</Tag>
        ),
    },
    {
      title: '检查时间',
      dataIndex: 'checkedAt',
      key: 'checkedAt',
      width: 170,
      render: (val: string) => val ? new Date(val).toLocaleString() : '-',
    },
  ]

  return (
    <BrandedPageWrapper>
    <div>
      {/* Page Header */}
      <div className="gr-page-header">
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <SafetyCertificateOutlined style={{ color: 'var(--gr-primary)', fontSize: 20 }} />
          邮件投递性测试
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          SPF · DKIM · DMARC 域名认证检测
        </Text>
      </div>

      {/* 输入区域 */}
      <Card style={{ marginBottom: 24 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Space style={{ width: '100%' }} wrap>
            <Button
              type={activeTab === 'single' ? 'primary' : 'default'}
              onClick={() => setActiveTab('single')}
            >
              单域名检查
            </Button>
            <Button
              type={activeTab === 'batch' ? 'primary' : 'default'}
              onClick={() => setActiveTab('batch')}
            >
              批量检查
            </Button>
          </Space>

          {activeTab === 'single' ? (
            <Space.Compact style={{ width: mobile.isMobile ? '100%' : 500 }}>
              <Input
                placeholder="输入域名，例如：example.com"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onPressEnter={handleSingleCheck}
                prefix={<SearchOutlined />}
                size="large"
                style={{ flex: 1 }}
              />
              <Button
                type="primary"
                size="large"
                icon={<SearchOutlined />}
                loading={loading}
                onClick={handleSingleCheck}
              >
                检查
              </Button>
            </Space.Compact>
          ) : (
            <div>
              <TextArea
                rows={4}
                placeholder="每行或逗号分隔输入多个域名，例如：&#10;example.com&#10;mail.example.com&#10;smtp.company.org"
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <Button
                type="primary"
                icon={<SearchOutlined />}
                loading={loading}
                onClick={handleBatchCheck}
              >
                批量检查 ({batchInput.split(/[\n,]+/).filter(d => d.trim()).length} 个域名)
              </Button>
            </div>
          )}
        </Space>
      </Card>

      {/* 加载状态 */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin tip="正在检查DNS记录（SPF/DKIM/DMARC）..." size="large" />
        </div>
      )}

      {/* 结果展示区 */}
      {!loading && results.length > 0 && (
        <>
          {/* 最新结果详情卡片（第一个域名的完整结果） */}
          {results[0] && (
            <Card
              title={
                <Space>
                  <Badge count={results[0].overall.grade} style={{ backgroundColor: gradeConfig[results[0].overall.grade]?.color }}>
                    <MailOutlined />
                  </Badge>
                  <span>{results[0].domain} — 详细报告</span>
                </Space>
              }
              style={{ marginBottom: 24 }}
              extra={
                <Space>
                  <Tag color={gradeConfig[results[0].overall.grade]?.color} style={{ fontWeight: 700, fontSize: 14 }}>
                    综合评分: {results[0].overall.score}/100 ({results[0].overall.grade}级)
                  </Tag>
                </>
              }
            >
              <Row gutter={[24, 24]}>
                {/* 评分圆环 + 基本信息 */}
                <Col xs={24} sm={8} style={{ textAlign: 'center' }}>
                  <GradeCircle grade={results[0].overall.grade} score={results[0].overall.score} />
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      检查于 {new Date(results[0].checkedAt).toLocaleString()}
                    </Text>
                  </div>
                </Col>

                {/* 分项得分 */}
                <Col xs={24} sm={16}>
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="SPF 认证">
                      <Space>
                        <Progress
                          percent={results[0].spf.score}
                          size="small"
                          style={{ width: 120 }}
                          status={results[0].spf.found ? (results[0].spf.score >= 70 ? 'success' : 'exception') : 'exception'}
                          format={() => `${results[0].spf.score}`}
                        />
                        <Tag color={results[0].spf.found ? 'green' : 'red'}>
                          {results[0].spf.found ? results[0].spf.result : '未找到'}
                        </Tag>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="DKIM 签名">
                      <Space>
                        <Progress
                          percent={results[0].dkim.score}
                          size="small"
                          style={{ width: 120 }}
                          status={results[0].dkim.found ? 'success' : 'exception'}
                          format={() => `${results[0].dkim.score}`}
                        />
                        <Tag color={results[0].dkim.found ? 'green' : 'red'}>
                          {results[0].dkim.found ? `${results[0].dkim.selectors.length} 个选择器` : '未找到'}
                        </Tag>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="DMARC 策略">
                      <Space>
                        <Progress
                          percent={results[0].dmarc.score}
                          size="small"
                          style={{ width: 120 }}
                          status={results[0].dmarc.found ? (results[0].dmarc.score >= 70 ? 'success' : 'exception') : 'exception'}
                          format={() => `${results[0].dmarc.score}`}
                        />
                        <Tag color={results[0].dmarc.found ? 'blue' : 'red'}>
                          {results[0].dmarc.found ? `p=${results[0].dmarc.policy}` : '未找到'}
                        </Tag>
                      </Space>
                    </Descriptions.Item>
                  </Descriptions>

                  {/* 权重说明 */}
                  <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--gr-gray-50)', borderRadius: 6 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      评分权重: SPF 30% · DKIM 25% · DMARC 45%
                    </Text>
                  </div>
                </Col>
              </Row>

              {/* DNS记录详情（可折叠） */}
              {(results[0].spf.record || results[0].dmarc.record || results[0].dkim.selectors.length > 0) && (
                <Collapse
                  ghost
                  style={{ marginTop: 16 }}
                  items={[
                    {
                      key: 'dns-records',
                      label: <Text strong><InfoCircleOutlined /> 查看原始DNS记录</Text>,
                      children: (
                        <Space direction="vertical" style={{ width: '100%' }} size={12}>
                          {results[0].spf.record && (
                            <div>
                              <Text strong>SPF 记录:</Text>
                              <Paragraph code copyable ellipsis rows={2} style={{ marginTop: 4, marginBottom: 0 }}>
                                {results[0].spf.record}
                              </Paragraph>
                            </div>
                          )}
                          {results[0].dmarc.record && (
                            <div>
                              <Text strong>DMARC 记录:</Text>
                              <Paragraph code copyable ellipsis rows={2} style={{ marginTop: 4, marginBottom: 0 }}>
                                {results[0].dmarc.record}
                              </Paragraph>
                            </div>
                          )}
                          {results[0].dkim.selectors.map((s, i) => (
                            <div key={i}>
                              <Text strong>DKIM ({s.selector}):</Text>
                              <Paragraph code copyable ellipsis rows={2} style={{ marginTop: 4, marginBottom: 0 }}>
                                {s.record}
                              </Paragraph>
                            </div>
                          ))}
                        </Space>
                      ),
                    },
                  ]}
                />
              )}

              {/* 改进建议 */}
              {results[0].recommendations && results[0].recommendations.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <Title level={5}>
                    <WarningOutlined style={{ color: 'var(--gr-warning)' }} />
                    改进建议
                  </Title>
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {results[0].recommendations.map((rec, idx) => (
                      <Alert
                        key={idx}
                        type={rec.priority === 'critical' || rec.priority === 'high' ? 'warning' : 'info'}
                        showIcon
                        banner
                        message={
                          <Space>
                            <Tag color={priorityConfig[rec.priority]?.color}>{priorityConfig[rec.priority]?.label}</Tag>
                            <Text strong>{rec.title}</Text>
                          </Space>
                        }
                        description={rec.description}
                      />
                    ))}
                  </Space>
                </div>
              )}
            </Card>
          )}

          {/* 所有结果汇总表 */}
          {results.length > 1 && (
            <Card title={<Space><ExportOutlined /> 检查结果汇总</Space>} style={{ marginBottom: 24 }}>
              <Table
                columns={columns}
                dataSource={results}
                rowKey="domain"
                pagination={false}
                size="middle"
              />
            </Card>
          )}

          {/* 警告提示 */}
          {results[0]?.overall.grade === 'D' && (
            <Alert
              type="warning"
              showIcon
              banner
              style={{ marginBottom: 24 }}
              message="投递性评分较低"
              description="当前域名配置可能导致部分邮件被拒收或进入垃圾箱。建议根据上方改进建议进行修复后再发送邮件。"
            />
          )}
          {results[0]?.overall.grade === 'F' && (
            <Alert
              type="error"
              showIcon
              banner
              style={{ marginBottom: 24 }}
              message="投递性评分严重不足！"
              description="该域名缺乏基本的邮件安全配置，发送的邮件极有可能被拒收。强烈建议先完成SPF/DKIM/DMARC配置再进行发送操作。"
            />
          )}
        </>
      )}

      {/* 空状态引导 */}
      {!loading && results.length === 0 && (
        <Card>
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <SafetyCertificateOutlined style={{ fontSize: 64, color: 'var(--gr-gray-300)', marginBottom: 16 }} />
            <Title level={5} type="secondary">开始域名投递性检查</Title>
            <Text type="secondary" style={{ display: 'block', maxWidth: 400, margin: '0 auto 20px' }}>
              输入您的发件邮箱域名，系统将自动检查 SPF、DKIM、DMARC 配置，
              并给出综合评分和改进建议。
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              支持 A-F 五个等级评分制 · 100分满分
            </Text>
          </div>
        </Card>
      )}
    </div>
    </BrandedPageWrapper>
  )
}

export default DeliverabilityTestPage

// 需要额外引入 Row/Col
import { Row, Col } from 'antd'
