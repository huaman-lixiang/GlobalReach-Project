import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// M-E02: CDN Base Path支持
// 通过环境变量VITE_CDN_BASE_URL配置CDN基础路径
// 示例: VITE_CDN_BASE_URL=https://cdn.example.com/globalreach/ npm run build
const CDN_BASE_URL = process.env.VITE_CDN_BASE_URL || ''

export default defineConfig({
  // M-E02: 支持CDN部署 - 默认使用相对路径（兼容本地和传统部署）
  base: CDN_BASE_URL || '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
      },
      mangle: {
        safari10: true,
      },
      output: {
        comments: false,
        beautify: false,
      },
    },
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'redux': ['@reduxjs/toolkit', 'react-redux'],
          'antd-vendor': ['antd', '@ant-design/icons', '@ant-design/charts', '@ant-design/plots'],
          'charts': ['recharts', 'dayjs'],
          'utils': ['axios'],
        },
        // M-E02: 使用contenthash确保只有内容变化时才更新hash
        // 8位hash长度平衡唯一性和可读性
        chunkFileNames: 'static/js/[name].[contenthash:8].js',
        entryFileNames: 'static/js/[name].[contenthash:8].js',
        assetFileNames: (assetInfo) => {
          const ext = assetInfo.name?.split('.').pop() || ''
          if (/\.(png|jpe?g|svg|gif|tiff|bmp|ico)$/i.test(ext)) {
            return `static/images/[name].[contenthash:8].[ext]`
          }
          if (/\.(woff2?|eot|ttf|otf)$/i.test(ext)) {
            return `static/fonts/[name].[contenthash:8].[ext]`
          }
          return `static/assets/[name].[contenthash:8].[ext]`
        },
      },
    },
    chunkSizeWarningLimit: 500,
    reportCompressed: true,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@reduxjs/toolkit',
      'react-redux',
      'antd',
      'axios',
      'recharts',
    ],
  },
})
