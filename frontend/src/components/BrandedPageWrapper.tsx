import React from 'react'
import { Spin } from 'antd'
import { useBranding } from '../hooks/useBranding'

interface BrandedPageWrapperProps {
  children: React.ReactNode
  /** 是否在加载中显示loading覆盖层（默认false） */
  showLoadingOverlay?: boolean
  /** 自定义页面级样式覆盖 */
  style?: React.CSSProperties
  /** 自定义className */
  className?: string
  /** 模式：'inherit' 继承父容器背景 | 'brand' 使用品牌背景色 */
  mode?: 'inherit' | 'brand'
}

/**
 * BrandedPageWrapper — 页面级品牌化包装器
 *
 * 功能：
 *   - 自动从useBranding hook获取品牌配置
 *   - 注入页面背景色、文字颜色、主题色等CSS变量
 *   - 支持inherit/brand两种模式
 *   - 品牌切换时实时响应（无需刷新）
 *   - 可选loading状态显示
 *
 * 用法：
 *   <BrandedPageWrapper>
 *     <YourPageContent />
 *   </BrandedPageWrapper>
 */
const BrandedPageWrapper: React.FC<BrandedPageWrapperProps> = ({
  children,
  showLoadingOverlay = false,
  style,
  className,
  mode = 'inherit',
}) => {
  const { brand, loading } = useBranding()

  const wrapperStyle: React.CSSProperties = {
    ...(mode === 'brand'
      ? {
          backgroundColor: brand.backgroundColor,
          color: brand.textColor,
          minHeight: '100%',
          transition: 'background-color 0.3s ease, color 0.3s ease',
        }
      : {
          transition: 'color 0.3s ease',
        }),
    ...style,
  }

  return (
    <div className={`branded-page-wrapper ${className || ''}`} style={wrapperStyle}>
      {showLoadingOverlay && loading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.7)',
            zIndex: 100,
            borderRadius: 'inherit',
          }}
        >
          <Spin tip="加载品牌配置..." />
        </div>
      )}
      {children}
    </div>
  )
}

export default BrandedPageWrapper
