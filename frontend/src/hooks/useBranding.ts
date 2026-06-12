import { useState, useEffect, useCallback } from 'react'
import api from '@/services/api'

/**
 * 品牌配置接口
 */
export interface BrandConfig {
  id?: string
  tenantId?: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  backgroundColor: string
  surfaceColor: string
  textColor: string
  textSecondary: string
  borderColor: string
  borderRadius: string
  fontFamily: string
  logoUrl?: string
  faviconUrl?: string
  companyName: string
  themeMode: 'light' | 'dark'
  customCss?: string
}

const DEFAULT_BRAND: BrandConfig = {
  primaryColor: '#1677ff',
  secondaryColor: '#7c3aed',
  accentColor: '#0d9488',
  backgroundColor: '#ffffff',
  surfaceColor: '#f5f5f5',
  textColor: '#1f2937',
  textSecondary: '#6b7280',
  borderColor: '#e5e7eb',
  borderRadius: '8px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  companyName: 'GlobalReach',
  themeMode: 'light',
}

/**
 * useBranding Hook — 获取并应用品牌配置到CSS变量
 *
 * 功能：
 *   - 从API获取当前租户的品牌配置
 *   - 将品牌值注入为CSS自定义属性（--gr-*）
 *   - 支持实时切换，无需刷新页面
 *   - 缓存机制避免重复请求
 */
export function useBranding() {
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const injectCSSVars = useCallback((config: BrandConfig) => {
    if (typeof document === 'undefined') return

    const root = document.documentElement
    const vars: Record<string, string> = {
      '--gr-primary': config.primaryColor,
      '--gr-secondary': config.secondaryColor,
      '--gr-accent': config.accentColor,
      '--gr-bg': config.backgroundColor,
      '--gr-surface': config.surfaceColor,
      '--gr-text': config.textColor,
      '--gr-text-secondary': config.textSecondary,
      '--gr-border': config.borderColor,
      '--gr-radius': config.borderRadius,
      '--gr-font-family': config.fontFamily,
      // 兼容现有CSS变量命名
      '--gr-primary-bg': `${config.primaryColor}0a`,
      '--gr-primary-light': `${config.primaryColor}33`,
      '--gr-success': '#52c41a',
      '--gr-warning': '#faad14',
      '--gr-error': '#ff4d4f',
      '--gr-gray-50': '#f9fafb',
      '--gr-gray-100': '#f3f4f6',
      '--gr-gray-200': '#e5e7eb',
      '--gr-gray-300': '#d1d5db',
      '--gr-gray-400': '#9ca3af',
      '--gr-gray-500': '#6b7280',
      '--gr-gray-600': '#4b5563',
      '--gr-gray-700': '#374151',
      '--gr-gray-800': '#1f2937',
      '--gr-gray-900': '#111827',
      '--gr-info-bg': `${config.primaryColor}0a`,
      '--gr-info-border': `${config.primaryColor}33`,
      '--gr-shadow-md': '0 4px 12px rgba(0,0,0,0.08)',
      '--gr-shadow-lg': '0 10px 30px rgba(0,0,0,0.12)',
    }

    Object.entries(vars).forEach(([key, value]) => {
      root.style.setProperty(key, value)
    })

    // 应用字体
    root.style.setProperty('font-family', config.fontFamily)

    // 如果有自定义CSS，注入style标签
    if (config.customCss) {
      let styleEl = document.getElementById('brand-custom-css')
      if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = 'brand-custom-css'
        document.head.appendChild(styleEl)
      }
      styleEl.textContent = config.customCss
    }
  }, [])

  const fetchBrand = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res: any = await api.get('/branding/current')
      const data = res.data || res
      if (data && typeof data === 'object' && data.primaryColor) {
        setBrand(data)
        injectCSSVars(data)
      }
    } catch (err: any) {
      console.warn('[useBranding] 使用默认品牌配置:', err?.message)
      // 使用默认品牌配置
      setBrand(DEFAULT_BRAND)
      injectCSSVars(DEFAULT_BRAND)
    } finally {
      setLoading(false)
    }
  }, [injectCSSVars])

  useEffect(() => {
    fetchBrand()
  }, [fetchBrand])

  return {
    brand,
    loading,
    error,
    refresh: fetchBrand,
    /**
     * 获取品牌颜色值（带回退）
     */
    color: (key: keyof BrandConfig, fallback?: string) => {
      return brand[key] || fallback || DEFAULT_BRAND[key] || ''
    },
  }
}

export default useBranding
