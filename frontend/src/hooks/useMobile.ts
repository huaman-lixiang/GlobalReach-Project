import { useState, useEffect, useCallback } from 'react'

/**
 * 移动端检测 Hook
 * 基于 window.innerWidth + matchMedia 实现响应式断点检测
 * 支持防抖优化，避免频繁重渲染
 *
 * 断点定义（参考 Ant Design 5.x）:
 *   xs: < 576px   (手机竖屏)
 *   sm: >= 576px  (手机横屏/小平板)
 *   md: >= 768px  (平板竖屏)
 *   lg: >= 992px  (平板横屏/小桌面)
 *   xl: >= 1200px (桌面)
 *   xxl: >= 1600px(大桌面)
 */

export interface BreakpointState {
  isMobile: boolean       // <= 768px（手机）
  isTablet: boolean       // 769px ~ 1024px（平板）
  isDesktop: boolean      // > 1024px（桌面端）
  breakpoint: string      // 当前断点名
  width: number           // 当前视口宽度
  height: number          // 当前视口高度
}

const BREAKPOINTS = {
  xs: 480,
  sm: 576,
  md: 768,
  lg: 992,
  xl: 1200,
  xxl: 1600,
} as const

type BreakpointName = keyof typeof BREAKPOINTS

function getCurrentBreakpoint(width: number): BreakpointName {
  if (width < BREAKPOINTS.xs) return 'xs'
  if (width < BREAKPOINTS.sm) return 'xs'
  if (width < BREAKPOINTS.md) return 'sm'
  if (width < BREAKPOINTS.lg) return 'md'
  if (width < BREAKPOINTS.xl) return 'lg'
  if (width < BREAKPOINTS.xxl) return 'xl'
  return 'xxl'
}

function getBreakpointState(width: number, height: number): BreakpointState {
  const breakpoint = getCurrentBreakpoint(width)
  return {
    isMobile: width <= BREAKPOINTS.md,
    isTablet: width > BREAKPOINTS.md && width <= 1024,
    isDesktop: width > 1024,
    breakpoint,
    width,
    height,
  }
}

export function useMobile(debounceMs = 150): BreakpointState {
  const [state, setState] = useState<BreakpointState>(() =>
    getBreakpointState(
      typeof window !== 'undefined' ? window.innerWidth : 1200,
      typeof window !== 'undefined' ? window.innerHeight : 800
    )
  )

  const handleResize = useCallback(() => {
    setState(getBreakpointState(window.innerWidth, window.innerHeight))
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(handleResize, debounceMs)
    }

    // 使用 matchMedia 监听关键断点变化，更高效
    const mediaQueries = Object.entries(BREAKPOINTS).map(([name, value]) => ({
      name,
      mql: window.matchMedia(`(min-width: ${value}px)`),
    }))

    // 初始设置
    mediaQueries.forEach(({ mql }) => {
      mql.addEventListener('change', onResize)
    })

    // 回退：resize 事件监听
    window.addEventListener('resize', onResize)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
      mediaQueries.forEach(({ mql }) => {
        mql.removeEventListener('change', onResize)
      })
    }
  }, [handleResize, debounceMs])

  return state
}

export default useMobile
