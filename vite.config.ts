import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext'
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    },
    exclude: ['mupdf']
  },
  resolve: {
    alias: {
      'node:fs': path.resolve(__dirname, 'src/empty.js'),
      'module': path.resolve(__dirname, 'src/empty.js'),
    }
  }
})
