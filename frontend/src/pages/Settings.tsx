import React, { useState, useEffect } from 'react'
import { Card, Typography, Descriptions, Divider, Tag, Form, Input, Button, message, Modal, Space, List, Avatar, Popconfirm, Spin } from 'antd'
import {
  UserOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  LockOutlined,
  EditOutlined,
  CheckCircleOutlined,
  GoogleOutlined,
  GithubOutlined,
  WechatOutlined,
  DingtalkOutlined,
  KeyOutlined,
  CloudServerOutlined,
  LinkOutlined,
  DisconnectOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { useAppSelector, useAppDispatch } from '@/store'
import api from '@/services/api'
import { useTranslation } from 'react-i18next'

const { Title, Text } = Typography

// SSO Provider 图标和名称映射
const SSO_PROVIDER_CONFIG: Record<string, { icon: React.ReactNode; name: string; color: string }> = {
  google: { icon: <GoogleOutlined />, name: 'Google', color: '#DB4437' },
  github: { icon: <GithubOutlined />, name: 'GitHub', color: '#333' },
  wecom: { icon: <WechatOutlined />, name: '企业微信', color: '#07C160' },
  dingtalk: { icon: <DingtalkOutlined />, name: '钉钉', color: '#0089FF' },
  keycloak: { icon: <KeyOutlined />, name: 'Keycloak', color: '#4A90D9' },
  auth0: { icon: <CloudServerOutlined />, name: 'Auth0', color: '#EB5424' },
  ldap: { icon: <SafetyCertificateOutlined />, name: 'Active Directory', color: '#00A4EF' },
}

const SettingsPage: React.FC = () => {
  const { user } = useAppSelector((state) => state.auth)
  const dispatch = useAppDispatch()
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm] = Form.useForm()
  const [passwordModalVisible, setPasswordModalVisible] = useState(false)
  const [passwordForm] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const { t } = useTranslation()

  // SSO 相关状态
  const [ssoStatus, setSsoStatus] = useState<{
    linkedProviders: Array<{ provider: string; providerUserId: string; linkedAt: string; lastLoginAt: string }>
    availableProviders: string[]
    authMethod: string
  } | null>(null)
  const [ssoLoading, setSsoLoading] = useState(false)

  // 获取 SSO 绑定状态
  useEffect(() => {
    const fetchSSOStatus = async () => {
      try {
        const res = await api.get('/sso/status')
        if (res.data.success) {
          setSsoStatus(res.data.data)
        }
      } catch (err: any) {
        console.warn('[Settings] 获取 SSO 状态失败:', err.message)
      }
    }
    // 仅在已登录时获取
    if (user) {
      fetchSSOStatus()
    }
  }, [user])

  // SSO 解绑处理
  const handleSSOUnlink = async (provider: string) => {
    try {
      setSsoLoading(true)
      const res = await api.post('/sso/unlink', { provider })
      if (res.data.success) {
        message.success(res.data.message || `已解除 ${provider} 绑定`)
        if (res.data.data?.warning) {
          message.warning(res.data.data.warning)
        }
        // 刷新状态
        const statusRes = await api.get('/sso/status')
        if (statusRes.data.success) {
          setSsoStatus(statusRes.data.data)
        }
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || '解绑失败')
    } finally {
      setSsoLoading(false)
    }
  }

  const roleConfig: Record<string, { color: string; label: string }> = {
    ADMIN: { color: 'red', label: t('auth.role') + ' - Admin' },
    USER: { color: 'blue', label: t('auth.role') + ' - User' },
    VIEWER: { color: 'default', label: t('auth.role') + ' - Viewer' },
  }

  const handleSaveProfile = async () => {
    try {
      setSaving(true)
      const values = await profileForm.validateFields()
      // TODO: Call profile update API when available
      message.success(t('settings.changesSaved'))
      setEditingProfile(false)
    } catch (_) {
      // Validation failed
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    try {
      setSaving(true)
      const values = await passwordForm.validateFields()
      if (values.newPassword !== values.confirmPassword) {
        message.error('两次输入的密码不一致')
        return
      }
      await api.post('/auth/reset-password', {
        email: user?.email,
        token: '', // In-session password change would need a different endpoint
        password: values.newPassword,
        confirmPassword: values.confirmPassword,
      })
      message.success('密码修改成功，请重新登录')
      setPasswordModalVisible(false)
      passwordForm.resetFields()
    } catch (err: any) {
      message.error(err.message || t('settings.invalidCurrentPassword'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* Page Header */}
      <div className="gr-page-header">
        <Title level={3}>
          <SettingOutlined style={{ color: 'var(--gr-primary)' }} />
          {t('settings.title')}
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('settings.account')} · {t('settings.security')}
        </Text>
      </div>

      {/* 移动端使用 Collapse 折叠面板；桌面端保持独立 Card */}
      {mobile.isMobile ? (
        <Collapse
          defaultActiveKey={['profile']}
          size="large"
          style={{ background: 'transparent' }}
          items={[
            {
              key: 'profile',
              label: (
                <Space><UserOutlined /> 个人信息</Space>
              ),
              children: (
                <div style={{ padding: '8px 0' }}>
                  {editingProfile ? (
                    <Form form={profileForm} layout="vertical" onFinish={handleSaveProfile}>
                      <Form.Item name="name" label={t('auth.name')} rules={[{ required: true }]}>
                        <Input placeholder={t('auth.name')} />
                      </Form.Item>
                      <Form.Item>
                        <Space className="mobile-action-buttons" style={{ width: '100%' }}>
                          <Button type="primary" htmlType="submit" loading={saving} block>保存</Button>
                          <Button onClick={() => setEditingProfile(false)} block>取消</Button>
                        </Space>
                      </Form.Item>
                    </Form>
                  ) : (
                    <>
                      <Descriptions column={1} bordered size="small">
                        <Descriptions.Item label="用户名">{user?.name || '-'}</Descriptions.Item>
                        <Descriptions.Item label="邮箱地址">{user?.email || '-'}</Descriptions.Item>
                        <Descriptions.Item label="角色">
                          <Tag color={roleConfig[user?.role as string]?.color || 'default'}>
                            {roleConfig[user?.role as string]?.label || user?.role}
                          </Tag>
                        </Descriptions.Item>
                      </Descriptions>
                      <Button
                        type="primary"
                        block
                        icon={<EditOutlined />}
                        onClick={() => { setEditingProfile(true); profileForm.setFieldsValue({ name: user?.name }) }}
                        style={{ marginTop: 12 }}
                      >
                        编辑资料
                      </Button>
                    </>
                  )}
                </div>
              ),
            },
            {
              key: 'security',
              label: (
                <Space><SafetyCertificateOutlined /> 安全设置</Space>
              ),
              children: (
                <div style={{ padding: '8px 0' }}>
                  <Descriptions column={1} bordered size="small">
                    <Descriptions.Item label="认证方式">JWT Dual-Token</Descriptions.Item>
                    <Descriptions.Item label="Token 有效期">15分钟 / 7天</Descriptions.Item>
                    <Descriptions.Item label="密码策略">最少8位，bcrypt加密</Descriptions.Item>
                  </Descriptions>
                  <Button
                    type="primary"
                    block
                    icon={<LockOutlined />}
                    onClick={() => setPasswordModalVisible(true)}
                    style={{ marginTop: 12 }}
                  >
                    修改密码
                  </Button>
                </div>
              ),
            },
            {
              key: 'system',
              label: (
                <Space><MailOutlined /> 系统信息</Space>
              ),
              children: (
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="版本">GlobalReach V2.0 Enterprise</Descriptions.Item>
                  <Descriptions.Item label="后端 ORM">Sequelize (PostgreSQL)</Descriptions.Item>
                  <Descriptions.Item label="引擎状态">AccountPoolManager + PlatformAdapter</Descriptions.Item>
                </Descriptions>
              ),
            },
          ]}
        />
      ) : (
        <>
        {/* 桌面端：原有布局 */}
      {/* Profile Section */}
      <Card
        title={
          <Space>
            <UserOutlined /> 个人信息
            {!editingProfile && (
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditingProfile(true); profileForm.setFieldsValue({ name: user?.name }) }}>
                编辑
              </Button>
            )}
          </Space>
        }
      >
        {editingProfile ? (
          <Form form={profileForm} layout="vertical" onFinish={handleSaveProfile} style={{ maxWidth: 400 }}>
            <Form.Item name="name" label={t('auth.name')} rules={[{ required: true }]}>
              <Input placeholder={t('auth.name')} />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" loading={saving}>保存</Button>
                <Button onClick={() => setEditingProfile(false)}>取消</Button>
              </Space>
            </Form.Item>
          </Form>
        ) : (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="用户ID">
              <Text copyable>{user?.id || '-'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="用户名">{user?.name || '-'}</Descriptions.Item>
            <Descriptions.Item label="邮箱地址">
              <Text copyable>{user?.email || '-'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="角色">
              <Tag color={roleConfig[user?.role as string]?.color || 'default'}>
                {roleConfig[user?.role as string]?.label || user?.role}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      <Divider />

      {/* Security Section */}
      <Card
        title={<Space><SafetyCertificateOutlined /> 安全设置</Space>}
        extra={
          <Button icon={<LockOutlined />} onClick={() => setPasswordModalVisible(true)}>
            修改密码
          </Button>
        }
      >
        <Descriptions column={1} bordered>
          <Descriptions.Item label="认证方式">JWT Dual-Token (D05)</Descriptions.Item>
          <Descriptions.Item label="Access Token 有效期">15 分钟 (短期)</Descriptions.Item>
          <Descriptions.Item label="Refresh Token 有效期">7 天 (长期，支持轮转)</Descriptions.Item>
          <Descriptions.Item label="密码策略">最少8位，bcrypt 12轮哈希</Descriptions.Item>
          <Descriptions.Item label="安全头">CSP + HSTS + X-Frame-Options</Descriptions.Item>
          <Descriptions.Item label="权限控制">RBAC 资源级所有权验证</Descriptions.Item>
        </Descriptions>
      </Card>

      <Divider />

      {/* SSO 单点登录绑定管理 */}
      <Card
        title={<Space><LinkOutlined /> SSO 单点登录</Space>}
        extra={
          <Tag color={ssoStatus?.authMethod === 'sso' ? 'blue' : 'default'}>
            {ssoStatus?.authMethod === 'sso' ? 'SSO 账号' : '本地账号'}
          </Tag>
        }
      >
        {ssoLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin tip="处理中..." />
          </div>
        ) : ssoStatus ? (
          <>
            {/* 已绑定的 SSO 身份列表 */}
            {ssoStatus.linkedProviders.length > 0 && (
              <>
                <Text strong style={{ display: 'block', marginBottom: 12 }}>已绑定的账号</Text>
                <List
                  dataSource={ssoStatus.linkedProviders}
                  renderItem={(item) => {
                    const config = SSO_PROVIDER_CONFIG[item.provider]
                    return (
                      <List.Item
                        actions={[
                          <Popconfirm
                            key="unlink"
                            title="确认解绑"
                            description={`确定要解除 ${config?.name || item.provider} 账号的绑定吗？`}
                            onConfirm={() => handleSSOUnlink(item.provider)}
                            okText="确认解绑"
                            cancelText="取消"
                          >
                            <Button type="text" danger size="small" icon={<DisconnectOutlined />}>
                              解绑
                            </Button>
                          </Popconfirm>,
                        ]}
                      >
                        <List.Item.Meta
                          avatar={
                            <Avatar
                              style={{ backgroundColor: config?.color || '#999', flexShrink: 0 }}
                              icon={config?.icon || <LinkOutlined />}
                              size={40}
                            />
                          }
                          title={<span>{config?.name || item.provider}</span>}
                          description={
                            <Space direction="vertical" size={2}>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                绑定时间：{new Date(item.linkedAt).toLocaleDateString('zh-CN')}
                              </Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                最后登录：{new Date(item.lastLoginAt).toLocaleString('zh-CN')}
                              </Text>
                            </Space>
                          }
                        />
                      </List.Item>
                    )
                  }}
                />
                <Divider style={{ margin: '16px 0' }} />
              </>
            )}

            {/* 可用的 SSO 提供商（未绑定的） */}
            <Text strong style={{ display: 'block', marginBottom: 12 }}>可绑定的登录方式</Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ssoStatus.availableProviders.map((provider) => {
                const isLinked = ssoStatus.linkedProviders.some(lp => lp.provider === provider)
                const config = SSO_PROVIDER_CONFIG[provider]
                return (
                  <Tag
                    key={provider}
                    color={isLinked ? 'green' : undefined}
                    icon={config?.icon}
                    style={{
                      padding: '4px 12px',
                      fontSize: 13,
                      borderRadius: 6,
                      cursor: isLinked ? 'default' : 'pointer',
                      opacity: isLinked ? 0.7 : 1,
                    }}
                  >
                    {config?.name || provider}
                    {isLinked ? ' (已绑定)' : ''}
                  </Tag>
                )
              })}
            </div>

            {ssoStatus.linkedProviders.length === 0 && (
              <div style={{ marginTop: 12, padding: '12px 16px', background: 'var(--gr-info-bg)', border: '1px solid var(--gr-info-border)', borderRadius: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  尚未绑定任何 SSO 账号。您可以在登录页面使用 SSO 登录，系统会自动关联到当前账户。
                </Text>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <Text type="secondary">加载中...</Text>
          </div>
        )}
      </Card>

      <Divider />

      {/* System Info */}
      <Card title={<Space><MailOutlined /> 系统信息</Space>}>
        <Descriptions column={1} bordered>
          <Descriptions.Item label="API Base URL">/api</Descriptions.Item>
          <Descriptions.Item label="健康检查">
            <a href="/api/health" target="_blank" rel="noopener noreferrer">/api/health</a>
          </Descriptions.Item>
          <Descriptions.Item label="统计概览">
            <a href="/api/stats/overview" target="_blank" rel="noopener noreferrer">/api/stats/overview</a>
          </Descriptions.Item>
          <Descriptions.Item label="版本">GlobalReach V2.0 Enterprise</Descriptions.Item>
          <Descriptions.Item label="后端 ORM">Sequelize (PostgreSQL)</Descriptions.Item>
          <Descriptions.Item label="引擎状态">M7 AccountPoolManager + M8 PlatformAdapter</Descriptions.Item>
          <Descriptions.Item label="管道状态">TemplateEngine + EmailQueue + SendWorker</Descriptions.Item>
        </Descriptions>
      </Card>
      </>
      )}

      {/* Change Password Modal */}
      <Modal
        title="修改密码"
        open={passwordModalVisible}
        onCancel={() => { setPasswordModalVisible(false); passwordForm.resetFields() }}
        onOk={handleChangePassword}
        confirmLoading={saving}
        okText="确认修改"
        cancelText="取消"
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item
            name="currentPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="当前密码" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '密码至少8位字符' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="新密码 (至少8位)" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default SettingsPage
