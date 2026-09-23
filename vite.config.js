import { defineConfig } from 'vite'

// 两个页面：2D 像素版 index.html 和 3D 版 3d.html（路径相对项目根目录）
export default defineConfig({
  base: './',
  server: { port: 5188, strictPort: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: 'index.html', three: '3d.html' } },
  },
})
