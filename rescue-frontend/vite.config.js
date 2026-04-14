import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1', // บังคับให้ใช้ IPv4
    port: 3001,        // หนีไปใช้ Port 3001 แทน 5173 ที่โดนบล็อก
  }
})