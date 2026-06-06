import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  base: '/marktest/',
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
