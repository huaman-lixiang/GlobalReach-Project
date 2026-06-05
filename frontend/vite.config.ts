import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
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
        chunkFileNames: 'static/js/[name]-[hash].js',
        entryFileNames: 'static/js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const ext = assetInfo.name?.split('.').pop() || ''
          if (/\.(png|jpe?g|svg|gif|tiff|bmp|ico)$/i.test(ext)) {
            return `static/images/[name]-[hash].[ext]`
          }
          if (/\.(woff2?|eot|ttf|otf)$/i.test(ext)) {
            return `static/fonts/[name]-[hash].[ext]`
          }
          return `static/assets/[name]-[hash].[ext]`
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
