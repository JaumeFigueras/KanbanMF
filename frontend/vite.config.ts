import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
      // The MCP server and its OAuth discovery documents (see
      // backend/src/api/mcp_server and backend/src/api/well_known.py).
      '/mcp': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/.well-known/oauth-': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
