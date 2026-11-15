/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vitest reads this same file, so tests get the app's React plugin and
  // settings. See src/test/ for the shared set-up and helpers.
  test: {
    environment: 'jsdom',
    // A page address for jsdom, so relative /api/v1/... URLs resolve the way
    // they do behind the Vite proxy.
    environmentOptions: { jsdom: { url: 'http://localhost:5173' } },
    // One time zone on every machine: due dates, overdue cards and the time
    // tracker depend on it.
    env: { TZ: 'Europe/Madrid' },
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Vitest's default of 5 s is tight for the heaviest dialog tests (the time
    // entry's date fields, menus) once every file runs in parallel, and more
    // so with coverage: 2-5 s on a development machine. A test that hangs
    // still fails, just later.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/types/**', 'src/main.tsx', 'src/**/*.d.ts'],
      reporter: [['text', { skipFull: true }], 'html'],
      reportsDirectory: 'coverage-reports',
    },
  },
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
