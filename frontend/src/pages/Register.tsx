import React, { useState } from 'react'
import { Form, Input, Button, Card, Typography, message } from 'antd'
import { UserOutlined, LockOutlined, MailOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useNavigate, Link } from 'react-router-dom'
import { useAppDispatch } from '@/store'
import { register } from '@/store/slices/authSlice'
import { useMobile } from '@/hooks/useMobile'
import { registerTexts } from '@/i18n/register'

const { Title, Text } = Typography

const RegisterPage: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const mobile = useMobile()

  const onFinish = async (values: { name: string; email: string; password: string; confirmPassword: string }) => {
    if (values.password !== values.confirmPassword) {
      message.error(registerTexts.messages.passwordMismatch)
      return
    }
    try {
      setLoading(true)
      await dispatch(register({
        name: values.name,
        email: values.email,
        password: values.password,
      })).unwrap()
      message.success(registerTexts.messages.registerSuccess)
      navigate('/dashboard')
    } catch (err: any) {
      message.error(err.message || registerTexts.messages.registerFailed)
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
      {/* Left Panel - Branding - hide on mobile */}
      {!mobile.isMobile ? (
      <div
        style={{
          flex: '1',
          background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #1a56db 100%)',
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
            <MailOutlined style={{ color: '#fff', fontSize: 36 }} />
          </div>
          <Title level={1} style={{ color: '#fff', marginBottom: 12, fontWeight: 800 }}>
            {registerTexts.brand.title}
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 17, lineHeight: 1.7, display: 'block', maxWidth: 360 }}>
            {registerTexts.brand.tagline1}<br />
            {registerTexts.brand.tagline2}
          </Text>

          {/* Feature highlights */}
          <div style={{ marginTop: 40, display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { icon: '\u2705', label: registerTexts.brand.featureMultiPlatform },
              { icon: '\uD83D\uDCCA', label: registerTexts.brand.featureRealtimeAnalytics },
              { icon: '\uD83E\uDD11', label: registerTexts.brand.featureSecureEncryption },
            ].map((feat, i) => (
              <div key={i} style={{
                padding: '10px 18px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 10,
                backdropFilter: 'blur(4px)',
              }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
                  {feat.icon} {feat.label}
                </Text>
              </div>
            ))}
          </div>
        </div>
      </div>
      ) : null}

      {/* Right Panel - Registration Form - fullscreen on mobile */}
      <div
        style={{
          flex: '1',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: mobile.isMobile ? '24px 16px' : 40,
          background: mobile.isMobile ? 'linear-gradient(135deg, #0d9488 0%, #1a56db 100%)' : '#ffffff',
          minHeight: mobile.isMobile ? '100vh' : 'auto',
        }}
      >
        <Card
          style={{
            width: mobile.isMobile ? '100%' : 440,
            maxWidth: mobile.isMobile ? 400 : 'auto',
            border: 'none',
            boxShadow: mobile.isMobile ? '0 8px 32px rgba(0,0,0,0.15)' : 'none',
            padding: mobile.isMobile ? '20px 16px' : '8px 0',
            borderRadius: mobile.isMobile ? 16 : undefined,
            background: '#ffffff',
          }}
        >
          {/* Mobile Logo */}
          {mobile.isMobile && (
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: 'rgba(255,255,255,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 10px',
                }}
              >
                <MailOutlined style={{ color: '#fff', fontSize: 26 }} />
              </div>
              <Title level={4} style={{ color: '#fff', marginBottom: 2 }}>{registerTexts.mobile.title}</Title>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{registerTexts.mobile.subtitle}</Text>
            </div>
          )}

          <div style={{ marginBottom: mobile.isMobile ? 24 : 32 }}>
            <Title level={3} style={{ marginBottom: 6, fontWeight: 800 }}>
              {registerTexts.form.title}
            </Title>
            <Text type="secondary" style={{ fontSize: 14 }}>
              {registerTexts.form.subtitle}
            </Text>
          </div>

          <Form
            name="register"
            onFinish={onFinish}
            layout="vertical"
            size="large"
          >
            <Form.Item
              name="name"
              label={<span style={{ fontWeight: 600, fontSize: 13 }}>{registerTexts.form.nameLabel}</span>}
              rules={[
                { required: true, message: registerTexts.form.nameRequired },
                { min: 2, message: registerTexts.form.nameMinLength },
              ]}
            >
              <Input
                prefix={<UserOutlined style={{ color: 'var(--gr-gray-400)' }} />}
                placeholder={registerTexts.form.namePlaceholder}
                autoComplete="name"
              />
            </Form.Item>

            <Form.Item
              name="email"
              label={<span style={{ fontWeight: 600, fontSize: 13 }}>{registerTexts.form.emailLabel}</span>}
              rules={[
                { required: true, message: registerTexts.form.emailRequired },
                { type: 'email', message: registerTexts.form.emailInvalid },
              ]}
            >
              <Input
                prefix={<MailOutlined style={{ color: 'var(--gr-gray-400)' }} />}
                placeholder={registerTexts.form.emailPlaceholder}
                autoComplete="email"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label={<span style={{ fontWeight: 600, fontSize: 13 }}>{registerTexts.form.passwordLabel}</span>}
              rules={[
                { required: true, message: registerTexts.form.passwordRequired },
                { min: 8, message: registerTexts.form.passwordMinLength },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'var(--gr-gray-400)' }} />}
                placeholder={registerTexts.form.passwordPlaceholder}
                autoComplete="new-password"
              />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label={<span style={{ fontWeight: 600, fontSize: 13 }}>{registerTexts.form.confirmPasswordLabel}</span>}
              dependencies={['password']}
              rules={[
                { required: true, message: registerTexts.form.confirmPasswordRequired },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) {
                      return Promise.resolve()
                    }
                    return Promise.reject(new Error(registerTexts.messages.passwordMismatch))
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'var(--gr-gray-400)' }} />}
                placeholder={registerTexts.form.confirmPasswordPlaceholder}
                autoComplete="new-password"
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
                {registerTexts.form.submitBtn}
              </Button>
            </Form.Item>
          </Form>

          <div style={{ textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {registerTexts.footer.hasAccount}{' '}
              <Link to="/login" style={{ fontWeight: 700, color: 'var(--gr-primary)' }}>
                {registerTexts.footer.backToLogin}
              </Link>
            </Text>
          </div>

          {/* Security badge */}
          <div
            style={{
              marginTop: 24,
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
              {registerTexts.security.badgeText}
            </Text>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default RegisterPage
