import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Needed so Vercel rewrites all routes to index.html for SPA routing
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
