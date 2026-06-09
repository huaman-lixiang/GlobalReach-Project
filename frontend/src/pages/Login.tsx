import React, { useState } from 'react'
import { Form, Input, Button, Card, Typography, message, Divider } from 'antd'
import { UserOutlined, LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '@/store'
import { login, clearError } from '@/store/slices/authSlice'
import { useTranslation } from 'react-i18next'

const { Title, Text } = Typography

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const { error } = useAppSelector((state) => state.auth)
  const { t } = useTranslation()

  const onFinish = async (values: { email: string; password: string }) => {
    try {
      setLoading(true)
      await dispatch(login(values)).unwrap()
      message.success(t('auth.loginSuccess'))
      navigate('/dashboard')
    } catch (err: any) {
      message.error(err.message || '登录失败，请检查邮箱和密码')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left Panel - Branding */}
      <div
        style={{
          flex: '1',
          background: 'linear-gradient(135deg, #1a56db 0%, #1e40af 50%, #7c3aed 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 60,
          position: 'relative',
        }}
      >
        {/* Decorative circles */}
        <div style={{
          position: 'absolute', top: -80, right: -80,
          width: 300, height: 300, borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)',
        }} />
        <div style={{
          position: 'absolute', bottom: -60, left: -60,
          width: 240, height: 240, borderRadius: '50%',
          background: 'rgba(255,255,255,0.04)',
        }} />
        <div style={{
          position: 'absolute', top: '40%', left: '20%',
          width: 160, height: 160, borderRadius: '50%',
          background: 'rgba(255,255,255,0.03)',
        }} />

        {/* Brand content */}
        <div style={{ zIndex: 1, textAlign: 'center' }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(10px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 28px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            }}
          >
            <SafetyCertificateOutlined style={{ color: '#fff', fontSize: 36 }} />
          </div>
          <Title level={1} style={{ color: '#fff', marginBottom: 12, fontWeight: 800 }}>
            GlobalReach V2.0
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 17, lineHeight: 1.7, display: 'block', maxWidth: 360 }}>
            企业级智能邮件营销平台<br />
            多渠道触达 · 精准投放 · 数据驱动
          </Text>

          <Divider style={{ borderColor: 'rgba(255,255,255,0.2)', maxWidth: 280, margin: '36px auto' }} />

          <div style={{ display: 'flex', gap: 32, justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <Text strong style={{ color: '#fff', fontSize: 24, display: 'block' }}>99.9%</Text>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>送达率</Text>
            </div>
            <div style={{ textAlign: 'center' }}>
              <Text strong style={{ color: '#fff', fontSize: 24, display: 'block' }}>5+</Text>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>邮件平台</Text>
            </div>
            <div style={{ textAlign: 'center' }}>
              <Text strong style={{ color: '#fff', fontSize: 24, display: 'block' }}>JWT</Text>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>安全认证</Text>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div
        style={{
          flex: '1',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 40,
          background: '#ffffff',
        }}
      >
        <Card
          style={{
            width: 420,
            border: 'none',
            boxShadow: 'none',
            padding: '8px 0',
          }}
        >
          <div style={{ marginBottom: 36 }}>
            <Title level={3} style={{ marginBottom: 6, fontWeight: 800 }}>
              {t('dashboard.welcome')}
            </Title>
            <Text type="secondary" style={{ fontSize: 14 }}>
              {t('auth.pleaseLogin')}
            </Text>
          </div>

          <Form
            name="login"
            onFinish={onFinish}
            layout="vertical"
            size="large"
          >
            <Form.Item
              name="email"
              label={<span style={{ fontWeight: 600, fontSize: 13 }}>{t('auth.email')}</span>}
              rules={[
                { required: true, message: t('validation.required', { field: t('auth.email') }) },
                { type: 'email', message: t('common.invalidEmail') },
              ]}
            >
              <Input
                prefix={<UserOutlined style={{ color: 'var(--gr-gray-400)' }} />}
                placeholder={t('auth.email')}
                autoComplete="email"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label={<span style={{ fontWeight: 600, fontSize: 13 }}>{t('auth.password')}</span>}
              rules={[{ required: true, message: t('validation.required', { field: t('auth.password') }) }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'var(--gr-gray-400)' }} />}
                placeholder={t('auth.password')}
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 20 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                style={{ height: 46, fontSize: 15 }}
              >
                登录系统
              </Button>
            </Form.Item>
          </Form>

          <div style={{ textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t('auth.register')}?{' '}
              <Link to="/register" style={{ fontWeight: 700, color: 'var(--gr-primary)' }}>
                {t('auth.register')}
              </Link>
            </Text>
          </div>

          {/* Security badge */}
          <div
            style={{
              marginTop: 28,
              padding: '12px 16px',
              background: 'var(--gr-success-bg)',
              border: '1px solid var(--gr-success-border)',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <SafetyCertificateOutlined style={{ color: 'var(--gr-success)', fontSize: 16, flexShrink: 0 }} />
            <Text style={{ color: 'var(--gr-success)', fontSize: 12, fontWeight: 500 }}>
              采用 JWT Dual-Token 安全认证，数据传输全程加密保护
            </Text>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default LoginPage
