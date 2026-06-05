import React from 'react'
import { useLocation } from 'react-router-dom'

const PerformanceMonitor: React.FC = () => {
  const location = useLocation()

  React.useEffect(() => {
    if ('performance' in window && 'PerformanceObserver' in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'navigation') {
              const navEntry = entry as PerformanceNavigationTiming
              console.log('[Performance]', {
                DNS: navEntry.domainLookupEnd - navEntry.domainLookupStart,
                TCP: navEntry.connectEnd - navEntry.connectStart,
                TTFB: navEntry.responseStart - navEntry.requestStart,
                DOMContentLoaded: navEntry.domContentLoadedEventEnd - navEntry.startTime,
                Load: navEntry.loadEventEnd - navEntry.startTime,
              })
            }

            if (entry.entryType === 'largest-contentful-paint') {
              console.log('[LCP]', entry.startTime)
            }

            if (entry.entryType === 'first-input') {
              const fidEntry = entry as PerformanceEventTiming
              console.log('[FID]', fidEntry.processingStart - fidEntry.startTime)
            }

            if (entry.entryType === 'layout-shift' && !(entry as any).hadRecentInput) {
              console.log('[CLS]', (entry as any).value)
            }
          }
        })

        observer.observe({ type: 'navigation', buffered: true })
        observer.observe({ type: 'largest-contentful-paint', buffered: true })
        observer.observe({ type: 'first-input', buffered: true })
        observer.observe({ type: 'layout-shift', buffered: true })

        return () => observer.disconnect()
      } catch (e) {
        console.warn('Performance monitoring not supported')
      }
    }
  }, [location.pathname])

  return null
}

export default PerformanceMonitor
