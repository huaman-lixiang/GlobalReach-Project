import React from 'react'
import { Spin } from 'antd'

const LoadingSpinner: React.FC = () => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--gr-gray-50)',
      gap: 20,
    }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          background: 'linear-gradient(135deg, #1a56db 0%, #7c3aed 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(26, 86, 219, 0.3)',
          animation: 'pulse 2s ease-in-out infinite',
        }}
      >
        <span style={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>G</span>
      </div>
      <Spin size="large" />
      <p style={{
        color: 'var(--gr-gray-400)',
        fontSize: 13,
        fontWeight: 500,
        margin: 0,
      }}>
        正在加载 GlobalReach...
      </p>
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.85; }
        }
      `}</style>
    </div>
  )
}

export default React.memo(LoadingSpinner)
