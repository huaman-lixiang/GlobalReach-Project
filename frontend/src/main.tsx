import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { ConfigProvider } from 'antd'
import { store } from './store'
import App from './App'
import './index.css'
import './i18n'

// Enterprise Theme Configuration for Ant Design
const enterpriseTheme = {
  token: {
    // Primary color system
    colorPrimary: '#1a56db',
    colorPrimaryHover: '#1544b8',
    colorPrimaryActive: '#1237a0',
    colorPrimaryBg: '#eef2ff',
    colorPrimaryBgHover: '#e0e7ff',
    colorPrimaryBorder: '#c7d7fe',
    colorPrimaryBorderHover: '#a5b4fc',
    colorPrimaryText: '#1a56db',
    colorPrimaryTextActive: '#1544b8',

    // Success
    colorSuccess: '#0d9488',
    colorSuccessBg: '#f0fdfa',
    colorSuccessBorder: '#99f6e4',

    // Warning
    colorWarning: '#f59e0b',
    colorWarningBg: '#fffbeb',
    colorWarningBorder: '#fde68a',

    // Error
    colorError: '#dc2626',
    colorErrorBg: '#fef2f2',
    colorErrorBorder: '#fecaca',

    // Info
    colorInfo: '#3b82f6',
    colorInfoBg: '#eff6ff',
    colorInfoBorder: '#bfdbfe',

    // Font
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    fontSizeLG: 16,
    fontSizeSM: 12,
    fontWeightStrong: 700,

    // Border radius
    borderRadius: 10,
    borderRadiusLG: 16,
    borderRadiusSM: 6,
    borderRadiusXS: 4,

    // Layout
    sizeUnit: 4,
    sizeStep: 4,
    controlHeight: 38,
    inputPaddingVertical: 8,
    inputPaddingVerticalLG: 11,
    controlHeightLG: 44,
    controlHeightSM: 28,

    // Colors (neutral)
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f9fafb',
    colorBgMask: 'rgba(0, 0, 0, 0.45)',
    colorText: '#1f2937',
    colorTextSecondary: '#6b7280',
    colorTextTertiary: '#9ca3af',
    colorTextQuaternary: '#d1d5db',
    colorBorder: '#e5e7eb',
    colorBorderSecondary: '#f3f4f6',

    // Shadow
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
    boxShadowSecondary: '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',

    // Motion
    motionDurationFast: '0.15s',
    motionDurationMid: '0.25s',
    motionDurationSlow: '0.35s',
    motionEaseInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    motionEaseOut: 'cubic-bezier(0, 0, 0.2, 1)',
    motionEaseIn: 'cubic-bezier(0.4, 0, 1, 1)',

    // Wireframe
    wireframe: false,
  },
  components: {
    Button: {
      primaryShadow: '0 1px 2px rgba(26, 86, 219, 0.25)',
      contentFontSizeLG: 16,
      contentFontSizeSM: 12,
      paddingInline: 18,
      paddingInlineLG: 24,
      paddingInlineSM: 10,
    },
    Card: {
      paddingLG: 20,
      borderRadiusLG: 16,
    },
    Table: {
      headerBg: '#f9fafb',
      headerColor: '#6b7280',
      headerSortActiveBg: '#eef2ff',
      headerSortHoverBg: '#f3f4f6',
      rowHoverBg: '#eef2ff',
      borderColor: '#e5e7eb',
      cellPaddingBlock: 14,
      cellPaddingInline: 18,
    },
    Input: {
      activeBorderColor: '#1a56db',
      hoverBorderColor: '#1a56db',
      activeShadow: '0 0 0 3px #eef2ff',
      paddingBlock: 8,
      paddingInline: 13,
      borderRadius: 8,
    },
    Select: {
      optionSelectedBg: '#eef2ff',
      activeBorderColor: '#1a56db',
    },
    Menu: {
      itemBorderRadius: 8,
      itemMarginInline: 8,
      itemHeight: 44,
      iconSize: 17,
      iconMarginInlineEnd: 10,
    },
    Modal: {
      borderRadiusLG: 16,
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Pagination: {
      itemBorderRadius: 8,
      itemActiveBg: '#1a56db',
    },
    Progress: {
      circleTextColor: '#1f2937',
      defaultColor: '#1a56db',
    },
    Form: {
      itemMarginBottom: 22,
      verticalLabelPadding: '0 0 8px',
    },
    Steps: {
      iconSize: 32,
      iconFontSize: 15,
      dotCurrentSize: 10,
    },
    Layout: {
      siderBg: '#111827',
      headerBg: '#ffffff',
      bodyBg: '#f9fafb',
      headerHeight: 64,
      headerPadding: '0 24px',
    },
  },
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ConfigProvider theme={enterpriseTheme}>
        <App />
      </ConfigProvider>
    </Provider>
  </React.StrictMode>,
)
