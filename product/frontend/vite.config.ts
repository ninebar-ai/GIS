import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8765'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/geo': { target: BACKEND, changeOrigin: true },
      '/published': { target: BACKEND, changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
})
