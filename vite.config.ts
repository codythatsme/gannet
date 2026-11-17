/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// One build produces the extension:
//   app.html + assets/*  – the Gannet app (an extension page)
//   background.js        – MV3 service worker (ES module)
//   content.js           – content script on Jira pages (must stay import-free; checked by scripts/check-build.mjs)
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: { port: 5199, open: '/app.html' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: true,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'app.html'),
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content/jira.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' || chunk.name === 'content' ? '[name].js' : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
