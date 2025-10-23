import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './', // ✅ AWS Amplify에서 index.html과 JS/CSS 경로가 깨지지 않게
  plugins: [react()],
  build: {
    outDir: 'dist'
  }
})
