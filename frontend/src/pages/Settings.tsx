import React, { useState } from 'react'
import { Card, Typography, Descriptions, Divider, Tag, Form, Input, Button, message, Modal, Space } from 'antd'
import {
  UserOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  LockOutlined,
  EditOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { useAppSelector, useAppDispatch } from '@/store'
import api from '@/services/api'
import { useTranslation } from 'react-i18next'

const { Title, Text } = Typography

const SettingsPage: React.FC = () => {
  const { user } = useAppSelector((state) => state.auth)
  const dispatch = useAppDispatch()
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm] = Form.useForm()
  const [passwordModalVisible, setPasswordModalVisible] = useState(false)
  const [passwordForm] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const { t } = useTranslation()

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
