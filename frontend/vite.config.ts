import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 默认指向契约 Mock（:4010）；联调真实后端时可设 VITE_PROXY_TARGET=http://127.0.0.1:4000
  const apiTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:4010'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
