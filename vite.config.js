import { defineConfig } from 'vite'

export default defineConfig({
  // Wrangler 的自动配置会把 @cloudflare/vite-plugin 写进这个数组。
  plugins: [],
  base: './',
  server: { port: 5188, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
